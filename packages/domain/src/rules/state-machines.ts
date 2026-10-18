import { ensure, type MatchStatus, type TournamentStatus } from '../model.js';
export const tournamentTransitions: Record<TournamentStatus, TournamentStatus[]> = {
  draft: ['registration', 'cancelled'],
  registration: ['ready', 'cancelled'],
  ready: ['registration', 'active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};
export const matchTransitions: Record<MatchStatus, MatchStatus[]> = {
  scheduled: ['ready', 'cancelled'],
  ready: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};
export function transitionTournament(from: TournamentStatus, to: TournamentStatus) {
  ensure(
    tournamentTransitions[from].includes(to),
    'INVALID_STATE',
    `Cannot transition tournament from ${from} to ${to}`,
  );
}
export function transitionMatch(from: MatchStatus, to: MatchStatus) {
  ensure(
    matchTransitions[from].includes(to),
    'INVALID_STATE',
    `Cannot transition match from ${from} to ${to}`,
  );
}
