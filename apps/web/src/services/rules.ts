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
import type {
  GameMode,
  Tournament as DomainTournament,
} from '../../../../packages/domain/src/model.js';
import type { Match, Tournament } from './game';

export {
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
