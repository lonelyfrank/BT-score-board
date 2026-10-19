import { ensure } from '../model.js';
import { chunk, evenSizes, shuffle } from './random.js';

/** Upper bound of members in one competitive unit: the totem has one seat per unit. */
export const MAX_TEAM_MEMBERS = 8;
/** Upper bound of competitive units in one tournament (memory and screen limits, not the totem). */
export const MAX_ENTRIES = 256;

/**
 * A team being composed before the start: pure data, edited by the functions below and then
 * confirmed with one ComposeEntries command. A single is a team of one.
 */
export interface TeamDraft {
  key: string;
  name: string | null;
  playerIds: string[];
  /** Kept as it is by reshuffles. */
  locked: boolean;
}
export type TeamStrategy = 'sequential' | 'random' | 'balanced';
export interface TeamOptions {
  /** Target members per team (1 = singles). */
  teamSize: number;
  strategy: TeamStrategy;
  random?: () => number;
  /** Strength per player for the balanced strategy (e.g. average Hi-Score); missing = 0. */
  ratings?: Record<string, number>;
  /** Players to keep together; each group becomes one locked team. */
  locked?: string[][];
}

let counter = 0;
const nextKey = () => `team-${++counter}`;

/**
 * Splits the units' players into teams. The number of teams is ceil(n / size); sizes differ by
 * at most one (7 players in pairs: 2, 2, 2, 1). Balanced snakes the players by rating.
 */
function distribute(
  players: string[],
  sizes: number[],
  strategy: TeamStrategy,
  random: () => number,
  ratings: Record<string, number>,
): string[][] {
  if (strategy === 'sequential') return chunk(players, sizes);
  if (strategy === 'random') return chunk(shuffle(players, random), sizes);
  // Balanced: strongest first, snake over the teams that still have room.
  const order = [...players].sort(
    (a, b) => (ratings[b] ?? 0) - (ratings[a] ?? 0) || players.indexOf(a) - players.indexOf(b),
  );
  const teams = sizes.map(() => [] as string[]);
  let forward = true;
  while (order.length) {
    const indexes = sizes.map((_, i) => i);
    for (const i of forward ? indexes : indexes.reverse()) {
      if (!order.length) break;
      if (teams[i]!.length < sizes[i]!) teams[i]!.push(order.shift()!);
    }
    forward = !forward;
  }
  return teams;
}

export function buildTeams(playerIds: string[], options: TeamOptions): TeamDraft[] {
  ensure(
    new Set(playerIds).size === playerIds.length,
    'DUPLICATE_ENTRY',
    'Each player can be composed once',
    422,
  );
  ensure(
    Number.isInteger(options.teamSize) &&
      options.teamSize >= 1 &&
      options.teamSize <= MAX_TEAM_MEMBERS,
    'INVALID_TEAM_SIZE',
    `Team size between 1 and ${MAX_TEAM_MEMBERS}`,
    422,
  );
  const locked = (options.locked ?? []).filter((g) => g.length > 0);
  const lockedIds = locked.flat();
  ensure(
    new Set(lockedIds).size === lockedIds.length && lockedIds.every((id) => playerIds.includes(id)),
    'INVALID_TEAMS',
    'Locked groups must hold registered players once',
    422,
  );
  const free = playerIds.filter((id) => !lockedIds.includes(id));
  const sizes = evenSizes(free.length, Math.ceil(free.length / options.teamSize));
  return [
    ...locked.map((ids) => ({ key: nextKey(), name: null, playerIds: [...ids], locked: true })),
    ...distribute(
      free,
      sizes,
      options.strategy,
      options.random ?? Math.random,
      options.ratings ?? {},
    ).map((ids) => ({ key: nextKey(), name: null, playerIds: ids, locked: false })),
  ];
}

/**
 * Reshuffles the players of unlocked teams, keeping the number of teams, their sizes and names.
 * Locked teams and their position stay as they are.
 */
export function reshuffleTeams(
  teams: TeamDraft[],
  strategy: TeamStrategy = 'random',
  random: () => number = Math.random,
  ratings: Record<string, number> = {},
): TeamDraft[] {
  const open = teams.filter((t) => !t.locked);
  const players = open.flatMap((t) => t.playerIds);
  const parts = distribute(
    players,
    open.map((t) => t.playerIds.length),
    strategy,
    random,
    ratings,
  );
  let next = 0;
  return teams.map((t) => (t.locked ? t : { ...t, playerIds: parts[next++]! }));
}

const locate = (teams: TeamDraft[], playerId: string) => {
  const team = teams.findIndex((t) => t.playerIds.includes(playerId));
  ensure(team >= 0, 'NOT_FOUND', 'Player not composed', 404);
  return { team, index: teams[team]!.playerIds.indexOf(playerId) };
};
const unlockedAt = (teams: TeamDraft[], team: number) =>
  ensure(!teams[team]!.locked, 'TEAM_LOCKED', 'Unlock the team first', 409);

/** Exchanges two players (two taps): across teams, or their order inside the same team. */
export function swapPlayers(teams: TeamDraft[], a: string, b: string): TeamDraft[] {
  const x = locate(teams, a),
    y = locate(teams, b);
  unlockedAt(teams, x.team);
  unlockedAt(teams, y.team);
  const next = teams.map((t) => ({ ...t, playerIds: [...t.playerIds] }));
  next[x.team]!.playerIds[x.index] = b;
  next[y.team]!.playerIds[y.index] = a;
  return next;
}
/** Moves a player to another team (or to a new single when `toKey` is null). */
export function movePlayer(teams: TeamDraft[], playerId: string, toKey: string | null) {
  const from = locate(teams, playerId);
  unlockedAt(teams, from.team);
  const target = toKey === null ? -1 : teams.findIndex((t) => t.key === toKey);
  ensure(toKey === null || target >= 0, 'NOT_FOUND', 'Team not found', 404);
  if (target >= 0) unlockedAt(teams, target);
  ensure(
    target < 0 || teams[target]!.playerIds.length < MAX_TEAM_MEMBERS,
    'TEAM_FULL',
    `At most ${MAX_TEAM_MEMBERS} members per team`,
    422,
  );
  const next = teams.map((t, i) =>
    i === from.team ? { ...t, playerIds: t.playerIds.filter((id) => id !== playerId) } : t,
  );
  if (target >= 0)
    next[target] = { ...next[target]!, playerIds: [...next[target]!.playerIds, playerId] };
  else next.push({ key: nextKey(), name: null, playerIds: [playerId], locked: false });
  return next.filter((t) => t.playerIds.length > 0);
}
/** Reverses the throwing order inside a team. */
export function reverseTeam(teams: TeamDraft[], key: string): TeamDraft[] {
  return teams.map((t) => (t.key === key ? { ...t, playerIds: [...t.playerIds].reverse() } : t));
}
/** Exchanges the positions of two whole teams (order of the units). */
export function swapTeams(teams: TeamDraft[], a: string, b: string): TeamDraft[] {
  const i = teams.findIndex((t) => t.key === a),
    j = teams.findIndex((t) => t.key === b);
  ensure(i >= 0 && j >= 0, 'NOT_FOUND', 'Team not found', 404);
  const next = [...teams];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
export function renameTeam(teams: TeamDraft[], key: string, name: string | null): TeamDraft[] {
  return teams.map((t) => (t.key === key ? { ...t, name: name?.trim() || null } : t));
}
export function setTeamLocked(teams: TeamDraft[], key: string, locked: boolean): TeamDraft[] {
  return teams.map((t) => (t.key === key ? { ...t, locked } : t));
}
/** Splits a team into singles, in its order. */
export function dissolveTeam(teams: TeamDraft[], key: string): TeamDraft[] {
  return teams.flatMap((t) =>
    t.key !== key
      ? [t]
      : t.playerIds.map((id) => ({ key: nextKey(), name: null, playerIds: [id], locked: false })),
  );
}
/** Every player as a single, in the given order. */
export const singles = (playerIds: string[]): TeamDraft[] =>
  playerIds.map((id) => ({ key: nextKey(), name: null, playerIds: [id], locked: false }));

export interface CompositionCheck {
  /** Blocking problems: lost, duplicated or unknown players, empty or oversized teams. */
  errors: string[];
  /** Allowed after an explicit confirmation (e.g. teams of different sizes). */
  warnings: string[];
  sizes: number[];
}
/** Verifies that `teams` holds every one of `playerIds` exactly once. */
export function checkComposition(teams: TeamDraft[], playerIds: string[]): CompositionCheck {
  const errors: string[] = [],
    warnings: string[] = [];
  const composed = teams.flatMap((t) => t.playerIds);
  if (new Set(composed).size !== composed.length) errors.push('DUPLICATE_PLAYER');
  if (playerIds.some((id) => !composed.includes(id))) errors.push('MISSING_PLAYER');
  if (composed.some((id) => !playerIds.includes(id))) errors.push('UNKNOWN_PLAYER');
  if (teams.some((t) => t.playerIds.length === 0)) errors.push('EMPTY_TEAM');
  if (teams.some((t) => t.playerIds.length > MAX_TEAM_MEMBERS)) errors.push('TEAM_TOO_LARGE');
  if (teams.length > MAX_ENTRIES) errors.push('TOO_MANY_ENTRIES');
  const sizes = teams.map((t) => t.playerIds.length);
  if (new Set(sizes).size > 1) warnings.push('UNEVEN_TEAMS');
  return { errors, warnings, sizes };
}
