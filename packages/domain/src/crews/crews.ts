import type { Tournament } from '../model.js';

/**
 * A crew ("compagnia"): friends who share matches and levels. Not to be confused with the
 * groups of a tournament. Local-first: every device keeps its copy and copies are merged.
 */
export interface Crew {
  id: string;
  name: string;
  memberIds: string[];
  /** Tournaments shared on purpose, beyond the automatic rule. */
  tournamentIds: string[];
  /** Tournaments kept out even when the automatic rule would share them. */
  excludedTournamentIds: string[];
  /** Share every tournament whose players are all members. */
  autoShare: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Membership as dated operations, so that merging an old copy cannot bring a removed member
   * back: the latest operation per player wins, a removal wins a tie. Absent in older crews:
   * their members count as joined when the crew was created.
   */
  joinedAt?: Record<string, string>;
  removedMembers?: { playerId: string; removedAt: string }[];
  /** Play spaces the friends meet at; the favourite is only a default for new matches. */
  playSpaceIds?: string[];
  favoritePlaySpaceId?: string | null;
}

/**
 * Two player records found to be the same person (created separately on two phones). `from`
 * resolves to `to`. The older record is always kept, so devices linking independently agree.
 */
export interface PlayerLink {
  from: string;
  to: string;
  createdAt: string;
}

/** Maps a player id to the one it was linked to, following chains and ignoring cycles. */
export function linkResolver(links: readonly PlayerLink[]) {
  const next = new Map(links.map((l) => [l.from, l.to]));
  return (id: string) => {
    const seen = new Set<string>();
    let current = id;
    while (next.has(current) && !seen.has(current)) {
      seen.add(current);
      current = next.get(current)!;
    }
    return current;
  };
}

/**
 * Which of two records of the same person survives a link: an active record is never given up
 * for an inactive one; between two alike, the older one, then the smaller id.
 */
export function linkDirection(
  a: { id: string; createdAt: string; status?: string },
  b: { id: string; createdAt: string; status?: string },
): PlayerLink {
  const live = (p: { status?: string }) => (p.status === 'inactive' ? 1 : 0);
  const aFirst =
    live(a) !== live(b)
      ? live(a) < live(b)
      : a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
  return aFirst ? { from: b.id, to: a.id, createdAt: '' } : { from: a.id, to: b.id, createdAt: '' };
}

/** Every player of a tournament, team members included. */
export function tournamentPlayerIds(t: Tournament): string[] {
  const ids = new Set<string>();
  for (const e of t.entries)
    if (e.members.length) for (const m of e.members) ids.add(m.playerId);
    else ids.add(e.playerId);
  return [...ids];
}

/** The tournaments a crew shares: chosen ones, plus those played only by members (automatic). */
export function crewTournaments(
  crew: Crew,
  tournaments: readonly Tournament[],
  resolve: (id: string) => string = (id) => id,
): Tournament[] {
  const members = new Set(crew.memberIds.map(resolve));
  const chosen = new Set(crew.tournamentIds);
  const excluded = new Set(crew.excludedTournamentIds);
  return tournaments.filter((t) => {
    if (chosen.has(t.id)) return true;
    if (!crew.autoShare || excluded.has(t.id)) return false;
    const players = tournamentPlayerIds(t);
    return players.length > 0 && players.every((id) => members.has(resolve(id)));
  });
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

const joinedOf = (c: Crew, playerId: string) => c.joinedAt?.[playerId] ?? c.createdAt;
const removedOf = (c: Crew, playerId: string) =>
  c.removedMembers?.find((r) => r.playerId === playerId)?.removedAt ?? null;

/**
 * Records the membership operations between the stored crew and the edited one: who joined and
 * who was removed, with the time. Removing a person from a crew deletes neither the player, nor
 * their history, nor their membership in other crews or play spaces.
 */
export function withMembership(previous: Crew | undefined, next: Crew, at: string): Crew {
  const before = new Set(previous?.memberIds ?? []);
  const after = new Set(next.memberIds);
  const joinedAt = { ...(previous?.joinedAt ?? {}), ...(next.joinedAt ?? {}) };
  const removed = new Map(
    [...(previous?.removedMembers ?? []), ...(next.removedMembers ?? [])].map((r) => [
      r.playerId,
      r.removedAt,
    ]),
  );
  for (const id of after) {
    if (!before.has(id)) {
      joinedAt[id] = at;
    } else joinedAt[id] ??= previous ? joinedOf(previous, id) : at;
  }
  for (const id of before) if (!after.has(id)) removed.set(id, at);
  return {
    ...next,
    // An editor that knows nothing of play spaces must not drop them.
    ...(next.playSpaceIds === undefined && previous?.playSpaceIds
      ? { playSpaceIds: previous.playSpaceIds }
      : {}),
    ...(next.favoritePlaySpaceId === undefined && previous?.favoritePlaySpaceId !== undefined
      ? { favoritePlaySpaceId: previous.favoritePlaySpaceId }
      : {}),
    joinedAt,
    removedMembers: [...removed].map(([playerId, removedAt]) => ({ playerId, removedAt })),
  };
}

/**
 * Merges two copies of the same crew. Settings and tournaments follow the copy changed last;
 * membership follows the dated operations of both copies, so a removal made on one phone
 * survives an old copy from another, while a later re-join survives an old removal.
 */
export function mergeCrew(a: Crew, b: Crew): Crew {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
  const included = new Set(newer.tournamentIds);
  const excluded = new Set(newer.excludedTournamentIds);
  const people = union(newer.memberIds, older.memberIds, [
    ...(newer.removedMembers ?? []).map((r) => r.playerId),
    ...(older.removedMembers ?? []).map((r) => r.playerId),
  ]);
  const later = (x: string | null, y: string | null) => (x && y ? (x > y ? x : y) : (x ?? y));
  const joinedAt: Record<string, string> = {};
  const removedMembers: { playerId: string; removedAt: string }[] = [];
  const memberIds: string[] = [];
  for (const id of people) {
    // A copy that lists the member and never recorded a join: joined at its creation.
    const join = (c: Crew) =>
      c.memberIds.includes(id) || c.joinedAt?.[id] ? joinedOf(c, id) : null;
    const joined = later(join(newer), join(older));
    const removed = later(removedOf(newer, id), removedOf(older, id));
    if (joined) joinedAt[id] = joined;
    if (removed) removedMembers.push({ playerId: id, removedAt: removed });
    if (joined && (!removed || joined > removed)) memberIds.push(id);
  }
  return {
    ...newer,
    memberIds,
    joinedAt,
    removedMembers,
    ...(newer.playSpaceIds || older.playSpaceIds
      ? { playSpaceIds: union(newer.playSpaceIds ?? [], older.playSpaceIds ?? []) }
      : {}),
    tournamentIds: union(newer.tournamentIds, older.tournamentIds).filter(
      (id) => !excluded.has(id),
    ),
    excludedTournamentIds: union(newer.excludedTournamentIds, older.excludedTournamentIds).filter(
      (id) => !included.has(id),
    ),
    createdAt: older.createdAt < newer.createdAt ? older.createdAt : newer.createdAt,
  };
}
