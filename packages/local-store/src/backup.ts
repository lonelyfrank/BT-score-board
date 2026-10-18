import { z } from 'zod';
import * as s from '../../contracts/src/index.js';
import { sha256Hex } from '../../application/src/portable.js';
import { DomainError } from '../../domain/src/index.js';
import { assertTournamentIntegrity } from './integrity.js';
import { SCHEMA_VERSION, dataStores, type BackupData } from './indexeddb.js';

export const BACKUP_FORMAT = 'bt-darts-scoreboard-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  source: { deviceId: string; revision: number; app: string };
  counts: Record<(typeof dataStores)[number], number>;
  integrity: { algorithm: 'SHA-256'; digest: string };
  data: BackupData;
}
export interface BackupSummary {
  exportedAt: string;
  deviceId: string;
  counts: BackupFile['counts'];
  tournaments: { name: string; status: string; createdAt: string }[];
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
  counts: z.record(z.string(), z.number().int().nonnegative()),
  integrity: z.object({ algorithm: z.literal('SHA-256'), digest: z.string().regex(hex64) }),
  data: z.unknown(),
});
const tournament = s.tournamentResponse.extend({
  mode: z.enum(['QUICK_HIGH_SCORE', 'GROUPS']),
  status: z.enum(['draft', 'registration', 'ready', 'active', 'paused', 'completed', 'cancelled']),
});
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
});

const invalid = (code: string, message: string) => new DomainError(code, message, 422);

async function digest(text: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Hex(text);
  const hash = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
const countsOf = (d: BackupData) =>
  Object.fromEntries(dataStores.map((store) => [store, d[store].length])) as BackupFile['counts'];

export async function createBackup(
  backupData: BackupData,
  source: BackupFile['source'],
  exportedAt: string,
): Promise<BackupFile> {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    source,
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
  const parsed = data.safeParse(head.data.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw invalid('BACKUP_INVALID', `Invalid backup data at ${issue.path.join('.')}`);
  }
  const content = parsed.data as BackupData;
  const counts = countsOf(content);
  if (dataStores.some((store) => head.data.counts[store] !== counts[store]))
    throw invalid('BACKUP_INTEGRITY', 'The backup record counts do not match');
  verifyReferences(content);
  return { ...(head.data as Omit<BackupFile, 'data'>), data: content };
}

function verifyReferences(d: BackupData) {
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
  };
}
