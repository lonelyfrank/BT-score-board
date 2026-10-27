import {
  ancestry,
  BT_PLAY_SPACE_ID,
  linkResolver,
  mergeCards,
  mergeCrew,
  type Player,
  type PlaySpace,
  type Tournament,
} from '../../domain/src/index.js';
import type { BackupData, TournamentVariant } from './indexeddb.js';
import { verifyReferences } from './backup.js';

export interface MergeReport {
  players: { added: number; updated: number };
  events: { added: number; updated: number };
  tournaments: {
    added: number;
    updated: number;
    /**
     * Copies that do not continue each other (see ancestry): two devices scored the same
     * tournament independently, or nothing proves that one continues the other. Neither is
     * overwritten: the local copy stays, the other is kept as a variant (excluded from every
     * scoreboard) until someone resolves it, and the tournament is reported by name.
     */
    diverged: string[];
  };
  playSpaces: { added: number; updated: number };
  /** Variants newly kept by this merge. */
  variants: number;
  /** Player links not applied: they would loop, or contradict a link already here. */
  linksRejected: number;
  /** History records added: audit entries, application events and idempotency keys. */
  history: number;
  crews: { added: number; updated: number };
  /** Players whose level arrived or grew with the other device's cards. */
  cards: number;
  /**
   * Same name, different records, not linked, one of them new here: maybe the same person
   * created on two phones, maybe two people with the same name. Only the user can tell.
   */
  homonyms: { name: string; players: { id: string; createdAt: string }[] }[];
  /** Nothing new: the incoming data was already here. */
  unchanged: boolean;
}

const withoutLineage = (t: Tournament) => ({ ...t, lineage: undefined });
/** A cheap content fingerprint (FNV-1a): the same variant received twice gets the same id. */
function fingerprint(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
const variantOf = (t: Tournament, origin: { at: string; source: string }): TournamentVariant => ({
  id: `${t.id}:${fingerprint(JSON.stringify(t))}`,
  tournamentId: t.id,
  tournament: t,
  receivedAt: origin.at,
  source: origin.source,
});
const newer = <T extends { updatedAt: string }>(a: T, b: T) => (b.updatedAt > a.updatedAt ? b : a);
// Key order and absent-versus-undefined must not make equal records look different.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const normalize = (name: string) => name.trim().toLocaleLowerCase('it-IT').replace(/\s+/g, ' ');

function byKey<T>(
  local: T[],
  incoming: T[],
  key: (item: T) => string,
  pick: (local: T, incoming: T) => T,
) {
  const result = new Map(local.map((item) => [key(item), item]));
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const k = key(item);
    const current = result.get(k);
    if (!current) {
      result.set(k, item);
      added++;
      continue;
    }
    const chosen = pick(current, item);
    if (!same(chosen, current)) {
      result.set(k, chosen);
      updated++;
    }
  }
  return { items: [...result.values()], added, updated };
}

/**
 * The union of two archives, keyed by the global ids every record already has: nothing on
 * either side is lost and merging the same data again changes nothing.
 *
 * - players, events: the latest change wins (`updatedAt`);
 * - tournaments: a tournament has one scorer, so the copy with the higher version is the most
 *   advanced one. Equal versions with different content are kept local and reported;
 * - audit and events history: records missing here are appended with new sequence numbers;
 * - crews: members and shared tournaments added from both; cards: the highest XP and the best
 *   values; links and idempotency keys: added.
 *
 * Statistics, levels and records are derived, so they follow from the merged data.
 */
export function mergeBackupData(
  local: BackupData,
  incoming: BackupData,
  origin: { at: string; source: string } = { at: new Date().toISOString(), source: 'backup' },
): { data: BackupData; report: MergeReport } {
  const known = new Set(local.players.map((p) => p.id));
  const newPlayers = new Set(incoming.players.map((p) => p.id).filter((id) => !known.has(id)));
  const players = byKey(local.players, incoming.players, (p) => p.id, newer);
  const events = byKey(local.events, incoming.events, (e) => e.id, newer);
  const diverged: string[] = [];
  const newVariants: TournamentVariant[] = [];
  const tournaments = byKey(
    local.tournaments,
    incoming.tournaments,
    (t) => t.id,
    (mine: Tournament, theirs: Tournament) => {
      // A higher version proves nothing: only provenance tells a continued copy from an
      // independent one. Without evidence the copies are treated as a conflict.
      if (same(withoutLineage(mine), withoutLineage(theirs))) return mine;
      const relation = ancestry(mine, theirs);
      if (relation === 'older') return theirs;
      if (relation === 'newer') return mine;
      diverged.push(mine.name);
      newVariants.push(variantOf(theirs, origin));
      return mine;
    },
  );
  const variants = byKey(
    [...local.variants, ...newVariants].filter(
      (v, i, all) => all.findIndex((o) => o.id === v.id) === i,
    ),
    incoming.variants,
    (v) => v.id,
    (mine) => mine,
  );
  const playSpaces = byKey(
    local.playSpaces.filter((p) => p.id !== BT_PLAY_SPACE_ID),
    incoming.playSpaces.filter((p) => p.id !== BT_PLAY_SPACE_ID),
    (p) => p.id,
    (mine: PlaySpace, theirs: PlaySpace) =>
      theirs.version > mine.version ||
      (theirs.version === mine.version && theirs.updatedAt > mine.updatedAt)
        ? theirs
        : mine,
  );
  const crews = byKey(local.crews, incoming.crews, (c) => c.id, mergeCrew);
  const cards = byKey(local.cards, incoming.cards, (c) => c.playerId, mergeCards);
  // A link joins two records of one person. One that loops, or whose source already points
  // elsewhere here, would make devices resolve the same player differently: it is not applied.
  let linksRejected = 0;
  const linkList = [...local.links];
  for (const l of [...incoming.links].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.from.localeCompare(b.from),
  )) {
    const existing = linkList.find((x) => x.from === l.from);
    if (existing) {
      if (existing.to !== l.to) linksRejected++;
      continue;
    }
    if (l.from === l.to || linkResolver(linkList)(l.to) === l.from) {
      linksRejected++;
      continue;
    }
    linkList.push(l);
  }
  const links = { items: linkList, added: linkList.length - local.links.length };
  const commands = byKey(
    local.commands,
    incoming.commands,
    (c) => c.key,
    (mine) => mine,
  );

  const append = <T extends { id: string; sequence: number }>(mine: T[], theirs: T[]) => {
    const known = new Set(mine.map((r) => r.id));
    let sequence = Math.max(0, ...mine.map((r) => r.sequence));
    const added = [...theirs]
      .sort((a, b) => a.sequence - b.sequence)
      .filter((r, i, all) => !known.has(r.id) && all.findIndex((o) => o.id === r.id) === i)
      .map((r) => ({ ...r, sequence: ++sequence }));
    return { items: [...mine, ...added], added: added.length };
  };
  const audit = append(local.audit, incoming.audit);
  const outbox = append(local.outbox, incoming.outbox);

  const data: BackupData = {
    players: players.items,
    events: events.items,
    tournaments: tournaments.items,
    audit: audit.items,
    outbox: outbox.items,
    commands: commands.items,
    crews: crews.items,
    cards: cards.items,
    links: links.items,
    playSpaces: playSpaces.items,
    variants: variants.items,
  };
  verifyReferences(data);

  const report: MergeReport = {
    players: { added: players.added, updated: players.updated },
    events: { added: events.added, updated: events.updated },
    tournaments: { added: tournaments.added, updated: tournaments.updated, diverged },
    crews: { added: crews.added, updated: crews.updated },
    playSpaces: { added: playSpaces.added, updated: playSpaces.updated },
    variants: variants.items.length - local.variants.length,
    linksRejected,
    history: audit.added + outbox.added + commands.added,
    cards: cards.added + cards.updated,
    homonyms: homonyms(data, newPlayers),
    unchanged: false,
  };
  report.unchanged =
    !players.added &&
    !players.updated &&
    !events.added &&
    !events.updated &&
    !tournaments.added &&
    !tournaments.updated &&
    !crews.added &&
    !crews.updated &&
    !report.cards &&
    !links.added &&
    !report.playSpaces.added &&
    !report.playSpaces.updated &&
    !report.variants &&
    !report.history;
  return { data, report };
}

/** Players sharing a name and not linked; with `among`, only groups holding one of those ids. */
export function homonyms(data: Pick<BackupData, 'players' | 'links'>, among?: Set<string>) {
  const resolve = linkResolver(data.links);
  const groups = new Map<string, Player[]>();
  for (const p of data.players) {
    if (resolve(p.id) !== p.id) continue;
    const key = normalize(p.displayName);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1 && (!among || g.some((p) => among.has(p.id))))
    .map((g) => ({
      name: g[0]!.displayName,
      players: g
        .map((p) => ({ id: p.id, createdAt: p.createdAt }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
}
