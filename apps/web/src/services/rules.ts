// The game rules come from the domain itself, never copied into the screens.
import {
  HI_SCORE_ROUNDS,
  evaluateResult,
  gameModes,
  games,
  maxScore,
  sideOf,
  type GameDefinition,
} from '../../../../packages/domain/src/games/catalog.js';
import { resultDependencies } from '../../../../packages/domain/src/tournaments/results.js';
import {
  MAX_TEAM_MEMBERS,
  buildTeams,
  checkComposition,
  dissolveTeam,
  movePlayer,
  renameTeam,
  reshuffleTeams,
  reverseTeam,
  setTeamLocked,
  singles,
  swapPlayers,
  swapTeams,
  type TeamDraft,
  type TeamStrategy,
} from '../../../../packages/domain/src/competition/teams.js';
import {
  planHeats,
  heatSlots,
  canArrangeHeat,
  physicalSeat,
} from '../../../../packages/domain/src/competition/heats.js';
import { comparableAcrossHeats } from '../../../../packages/domain/src/games/catalog.js';
import type {
  GameMode,
  Match as DomainMatch,
  Tournament as DomainTournament,
} from '../../../../packages/domain/src/model.js';
import type { Match, Tournament } from './game';

export {
  MAX_TEAM_MEMBERS,
  buildTeams,
  checkComposition,
  comparableAcrossHeats,
  dissolveTeam,
  movePlayer,
  planHeats,
  renameTeam,
  reshuffleTeams,
  reverseTeam,
  setTeamLocked,
  singles,
  swapPlayers,
  swapTeams,
  type TeamDraft,
  type TeamStrategy,
  HI_SCORE_ROUNDS,
  evaluateResult,
  gameModes,
  games,
  maxScore,
  sideOf,
  type GameDefinition,
  type GameMode,
};

export const gameOf = (t: { gameMode?: string }) => games[(t.gameMode ?? 'HI_SCORE') as GameMode];
export const isResultRecording = (t: { recording?: string }) => t.recording !== 'turns';

/** What correcting `m` would invalidate (reopened phase, later matches, playoffs). */
export function dependenciesOf(t: Tournament, m: Pick<Match, 'id'>) {
  const domain = t as unknown as DomainTournament;
  const match = domain.matches.find((x) => x.id === m.id);
  return match ? resultDependencies(domain, match) : null;
}

/** Short description of the formats, as the organizer reads them. */
export const formatLabel = (mode: string) =>
  mode === 'GROUPS' ? 'A gironi' : mode === 'SINGLE_MATCH' ? 'Partita singola' : 'Hi-Score rapido';

/** Units a free match accepts: beyond the seats of the totem only games scored in points. */
export function freeMatchLimits(mode: GameMode) {
  const g = games[mode];
  return {
    min: g.scoreRequired ? 1 : g.players.min,
    max: comparableAcrossHeats(mode) ? 256 : g.players.max,
    seats: g.players.max,
  };
}
/** Sizes of the heats a number of units would need on the totem ("4 · 4 · 3"). */
export const heatSizes = (
  units: number,
  seats: number,
  strategy: 'sequential' | 'balanced' | 'random' = 'sequential',
) =>
  planHeats(
    Array.from({ length: units }, (_, i) => String(i)),
    seats,
    strategy,
  ).map((h) => h.length);

export const trackingLabels = {
  FINAL_ONLY: 'Solo finale',
  ROUND_BY_ROUND: 'Round per round',
  FLEXIBLE: 'Flessibile',
} as const;
export type Tracking = keyof typeof trackingLabels;
export const trackingHints: Record<Tracking, string> = {
  FINAL_ONLY: 'Si inserisce solo il risultato finale mostrato dal totem.',
  ROUND_BY_ROUND:
    'Si registra ogni round (o lo si salta esplicitamente); in X01 si può segnare Eccesso.',
  FLEXIBLE: 'Round facoltativi: si può saltare e chiudere con il risultato finale del totem.',
};
/** Keeps a composition in line with the selected players: removed ones leave, new ones join as singles. */
export function syncTeams(teams: TeamDraft[], playerIds: string[]): TeamDraft[] {
  const kept = teams
    .map((t) => ({ ...t, playerIds: t.playerIds.filter((id) => playerIds.includes(id)) }))
    .filter((t) => t.playerIds.length > 0);
  const placed = new Set(kept.flatMap((t) => t.playerIds));
  return [...kept, ...singles(playerIds.filter((id) => !placed.has(id)))];
}

export { heatSlots };
export const seatOf = (m: Match, entryId: string) =>
  physicalSeat(m as unknown as DomainMatch, entryId);
export const canOrganizeHeat = (m: Match, h: Match['heats'][number]) =>
  canArrangeHeat(m as unknown as DomainMatch, h);
export const canOrganizeMatch = (m: Match) =>
  !['completed', 'cancelled', 'paused'].includes(m.status) &&
  (m.heats.length
    ? m.heats.some((h) => canOrganizeHeat(m, h))
    : !m.startedAt && !m.rounds.length && !m.result);
