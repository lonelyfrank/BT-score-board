import {
  linkResolver,
  mergeCards,
  mergeCrew,
  type Player,
  type Tournament,
} from '../../domain/src/index.js';
import type { BackupData } from './indexeddb.js';
import { verifyReferences } from './backup.js';

export interface MergeReport {
  players: { added: number; updated: number };
  events: { added: number; updated: number };
  tournaments: {
    added: number;
    updated: number;
    /**
     * Same version on both sides but different content: two devices changed the same
     * tournament. The local copy is kept and the other is reported by name.
     */
    diverged: string[];
  };
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

const newer = <T extends { updatedAt: string }>(a: T, b: T) => (b.updatedAt > a.updatedAt ? b : a);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
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
): { data: BackupData; report: MergeReport } {
  const known = new Set(local.players.map((p) => p.id));
  const newPlayers = new Set(incoming.players.map((p) => p.id).filter((id) => !known.has(id)));
  const players = byKey(local.players, incoming.players, (p) => p.id, newer);
  const events = byKey(local.events, incoming.events, (e) => e.id, newer);
  const diverged: string[] = [];
  const tournaments = byKey(
    local.tournaments,
    incoming.tournaments,
    (t) => t.id,
    (mine: Tournament, theirs: Tournament) => {
      if (theirs.version > mine.version) return theirs;
      if (theirs.version === mine.version && !same(mine, theirs)) diverged.push(mine.name);
      return mine;
    },
  );
  const crews = byKey(local.crews, incoming.crews, (c) => c.id, mergeCrew);
  const cards = byKey(local.cards, incoming.cards, (c) => c.playerId, mergeCards);
  const links = byKey(
    local.links,
    incoming.links,
    (l) => l.from,
    (mine) => mine,
  );
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
      .filter((r) => !known.has(r.id))
      .map((r) => ({ ...r, sequence: ++sequence }));
    return [...mine, ...added];
  };

  const data: BackupData = {
    players: players.items,
    events: events.items,
    tournaments: tournaments.items,
    audit: append(local.audit, incoming.audit),
    outbox: append(local.outbox, incoming.outbox),
    commands: commands.items,
    crews: crews.items,
    cards: cards.items,
    links: links.items,
  };
  verifyReferences(data);

  const report: MergeReport = {
    players: { added: players.added, updated: players.updated },
    events: { added: events.added, updated: events.updated },
    tournaments: { added: tournaments.added, updated: tournaments.updated, diverged },
    crews: { added: crews.added, updated: crews.updated },
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
    !links.added;
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
