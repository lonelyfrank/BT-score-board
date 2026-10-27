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

/** Which of two records of the same person survives a link: the older one, then the smaller id. */
export function linkDirection(
  a: { id: string; createdAt: string },
  b: { id: string; createdAt: string },
): PlayerLink {
  const aFirst = a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
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

/**
 * Merges two copies of the same crew. Members and shared tournaments are added from both; for
 * settings and for a tournament chosen in one copy and excluded in the other, the copy changed
 * last wins.
 */
export function mergeCrew(a: Crew, b: Crew): Crew {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
  const included = new Set(newer.tournamentIds);
  const excluded = new Set(newer.excludedTournamentIds);
  return {
    ...newer,
    memberIds: union(newer.memberIds, older.memberIds),
    tournamentIds: union(newer.tournamentIds, older.tournamentIds).filter(
      (id) => !excluded.has(id),
    ),
    excludedTournamentIds: union(newer.excludedTournamentIds, older.excludedTournamentIds).filter(
      (id) => !included.has(id),
    ),
    createdAt: older.createdAt < newer.createdAt ? older.createdAt : newer.createdAt,
  };
}
