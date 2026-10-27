import { z } from 'zod';
import * as s from '../../contracts/src/index.js';
import { sha256Hex } from '../../application/src/portable.js';
import {
  BT_PLAY_SPACE_ID,
  DomainError,
  linkResolver,
  upgradePlayer,
  upgradeTournament,
  type Player,
  type Tournament,
} from '../../domain/src/index.js';
import { assertTournamentIntegrity } from './integrity.js';
import { SCHEMA_VERSION, dataStores, socialStores, type BackupData } from './indexeddb.js';

export const BACKUP_FORMAT = 'bt-darts-scoreboard-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  source: { deviceId: string; revision: number; app: string };
  /** `crew`: a crew package, only its shared tournaments and its members (merged, never restored). */
  scope?: 'full' | 'crew';
  counts: Record<(typeof dataStores)[number], number>;
  integrity: { algorithm: 'SHA-256'; digest: string };
  data: BackupData;
}
export interface BackupSummary {
  exportedAt: string;
  deviceId: string;
  counts: BackupFile['counts'];
  tournaments: { name: string; status: string; createdAt: string }[];
  scope: 'full' | 'crew';
  /** The crews carried, by name (a crew package carries one). */
  crews: string[];
}

const hex64 = /^[0-9a-f]{64}$/;
const envelope = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number().int().min(1),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.iso.datetime({ offset: true }),
  source: z.object({
    deviceId: z.string().min(1).max(128),
    revision: z.number().int().nonnegative(),
    app: z.string().max(64),
  }),
  scope: z.enum(['full', 'crew']).optional(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  integrity: z.object({ algorithm: z.literal('SHA-256'), digest: z.string().regex(hex64) }),
  data: z.unknown(),
});
const tournament = s.tournamentResponse.extend({
  status: z.enum(['draft', 'registration', 'ready', 'active', 'paused', 'completed', 'cancelled']),
});
const crew = z.object({
  id: s.id,
  name: z.string().min(1).max(120),
  memberIds: z.array(s.id),
  tournamentIds: z.array(s.id),
  excludedTournamentIds: z.array(s.id),
  autoShare: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  joinedAt: z.record(z.string(), z.string()).optional(),
  removedMembers: z.array(z.object({ playerId: s.id, removedAt: z.string() })).optional(),
  playSpaceIds: z.array(s.id).optional(),
  favoritePlaySpaceId: s.id.nullable().optional(),
});
const best = z.object({ value: z.number().int().nonnegative(), achievedAt: z.string() });
const card = z.object({
  playerId: s.id,
  xp: z.number().int().nonnegative(),
  bests: z.record(z.string(), best),
  updatedAt: z.string(),
  contributions: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        source: z.string().min(1).max(100),
        xp: z.number().int().nonnegative(),
        at: z.string(),
      }),
    )
    .optional(),
  legacy: z.object({ xp: z.number().int().nonnegative(), at: z.string() }).optional(),
});
const playSpace = s.playSpaceResponse;
const variant = z.object({
  id: z.string().min(1).max(200),
  tournamentId: s.id,
  tournament,
  receivedAt: z.string(),
  source: z.string().max(128),
});
const link = z.object({ from: s.id, to: s.id, createdAt: z.string() });
const data = z.strictObject({
  players: z.array(s.playerResponse),
  events: z.array(s.eventResponse),
  tournaments: z.array(tournament),
  audit: z.array(s.auditResponse.extend({ sequence: z.number().int().positive() })),
  outbox: z.array(s.notificationResponse),
  commands: z.array(
    z.object({
      key: z.string().min(8).max(128),
      fingerprint: z.string().regex(hex64),
      tournamentId: s.id.nullable(),
      version: z.number().int().nonnegative().nullable(),
      createdAt: z.string(),
    }),
  ),
  // Absent from backups written before crews existed.
  crews: z.array(crew).default([]),
  cards: z.array(card).default([]),
  links: z.array(link).default([]),
  playSpaces: z.array(playSpace).default([]),
  variants: z.array(variant).default([]),
});

const invalid = (code: string, message: string) => new DomainError(code, message, 422);

async function digest(text: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Hex(text);
  const hash = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
const countsOf = (d: BackupData) =>
  // `?? []`: files written before a store existed lack it (see readBackup).
  Object.fromEntries(
    dataStores.map((store) => [store, (d[store] ?? []).length]),
  ) as BackupFile['counts'];

export async function createBackup(
  backupData: BackupData,
  source: BackupFile['source'],
  exportedAt: string,
  scope: 'full' | 'crew' = 'full',
): Promise<BackupFile> {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    source,
    scope,
    counts: countsOf(backupData),
    integrity: { algorithm: 'SHA-256', digest: await digest(JSON.stringify(backupData)) },
    data: backupData,
  };
}

/** Parses and fully verifies a backup before anything on the device is touched. */
export async function readBackup(text: string): Promise<BackupFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalid('BACKUP_INVALID', 'The file is not valid JSON');
  }
  if ((raw as { format?: unknown } | null)?.format !== BACKUP_FORMAT)
    throw invalid('BACKUP_INVALID', 'The file is not a BT Darts Score Board backup');
  const head = envelope.safeParse(raw);
  if (!head.success) throw invalid('BACKUP_INVALID', 'The backup header is incomplete');
  if (head.data.formatVersion > BACKUP_FORMAT_VERSION || head.data.schemaVersion > SCHEMA_VERSION)
    throw invalid('BACKUP_UNSUPPORTED', 'The backup was created by a newer version of the app');
  // The digest covers the exact serialization written at export time.
  if ((await digest(JSON.stringify(head.data.data))) !== head.data.integrity.digest)
    throw invalid('BACKUP_INTEGRITY', 'The backup content does not match its checksum');
  const parsed = data.safeParse(upgradeData(head.data.data, head.data.schemaVersion));
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw invalid('BACKUP_INVALID', `Invalid backup data at ${issue.path.join('.')}`);
  }
  // Idempotent: data from before play spaces comes out unclassified (null), never guessed.
  const content = {
    ...parsed.data,
    tournaments: (parsed.data.tournaments as Tournament[]).map(upgradeTournament),
  } as BackupData;
  const counts = countsOf(content);
  const declared = (store: (typeof dataStores)[number]) =>
    head.data.counts[store] ??
    ((socialStores as readonly string[]).includes(store) ? 0 : undefined);
  if (dataStores.some((store) => declared(store) !== counts[store]))
    throw invalid('BACKUP_INTEGRITY', 'The backup record counts do not match');
  verifyReferences(content);
  return { ...(head.data as Omit<BackupFile, 'data'>), data: content };
}

/** Older backups get the same upgrade as the local database (see migrations). */
function upgradeData(raw: unknown, schemaVersion: number): unknown {
  if (schemaVersion >= SCHEMA_VERSION) return raw;
  const d = raw as { players?: unknown; tournaments?: unknown } | null;
  if (!d || !Array.isArray(d.players) || !Array.isArray(d.tournaments)) return raw;
  try {
    return {
      ...d,
      players: (d.players as Player[]).map(upgradePlayer),
      tournaments: (d.tournaments as Tournament[]).map(upgradeTournament),
    };
  } catch {
    // Malformed content: left as is, the schema check below reports it.
    return raw;
  }
}

/** Unique keys and valid references, as required of a backup (and of a merge result). */
export function verifyReferences(d: BackupData) {
  const unique = <T>(items: T[], key: (item: T) => string | number, what: string) => {
    const keys = new Set(items.map(key));
    if (keys.size !== items.length) throw invalid('BACKUP_INVALID', `Duplicate ${what} in backup`);
    return keys;
  };
  const players = unique(d.players, (p) => p.id, 'players');
  const events = unique(d.events, (e) => e.id, 'events');
  const tournaments = unique(d.tournaments, (t) => t.id, 'tournaments');
  unique(d.audit, (a) => a.sequence, 'audit sequences');
  unique(d.outbox, (o) => o.sequence, 'event sequences');
  unique(d.commands, (c) => c.key, 'command keys');
  unique(d.crews, (c) => c.id, 'crews');
  unique(d.cards, (c) => c.playerId, 'player cards');
  unique(d.links, (l) => l.from, 'player links');
  const spaces = unique(d.playSpaces, (p) => p.id, 'play spaces');
  unique(d.variants, (v) => v.id, 'tournament variants');
  // The canonical space is implicit: a stored record claiming its id is never accepted, and a
  // space is never recognised by its name.
  if (spaces.has(BT_PLAY_SPACE_ID) || d.playSpaces.some((p) => p.canonical))
    throw invalid('BACKUP_INVALID', 'A backup cannot define the canonical play space');
  spaces.add(BT_PLAY_SPACE_ID);
  for (const t of d.tournaments)
    if (t.playSpaceId && !spaces.has(t.playSpaceId))
      throw invalid('BACKUP_INVALID', `Tournament "${t.name}" refers to an unknown play space`);
  for (const c of d.crews)
    for (const id of [...(c.playSpaceIds ?? []), c.favoritePlaySpaceId ?? ''])
      if (id && !spaces.has(id))
        throw invalid('BACKUP_INVALID', `Crew "${c.name}" refers to an unknown play space`);
  for (const v of d.variants)
    if (!tournaments.has(v.tournamentId))
      throw invalid('BACKUP_INVALID', 'A tournament variant refers to a missing tournament');
  const aliases = linkResolver(d.links);
  for (const l of d.links)
    if (l.from === l.to || aliases(l.to) === l.from || !players.has(l.from) || !players.has(l.to))
      throw invalid('BACKUP_INVALID', 'Player links loop or refer to missing players');
  for (const t of d.tournaments) {
    try {
      assertTournamentIntegrity(
        t,
        (id) => players.has(id),
        (id) => events.has(id),
      );
    } catch (error) {
      throw invalid('BACKUP_INVALID', `Tournament "${t.name}": ${(error as Error).message}`);
    }
  }
  for (const a of d.audit)
    if (a.tournamentId !== null && !tournaments.has(a.tournamentId))
      throw invalid('BACKUP_INVALID', 'Audit entry references a missing tournament');
  for (const o of d.outbox)
    if (!tournaments.has(o.tournamentId))
      throw invalid('BACKUP_INVALID', 'Event references a missing tournament');
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    deviceId: backup.source.deviceId,
    counts: backup.counts,
    tournaments: [...backup.data.tournaments]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5)
      .map((t) => ({ name: t.name, status: t.status, createdAt: t.createdAt })),
    scope: backup.scope ?? 'full',
    crews: backup.data.crews.map((c) => c.name),
  };
}
