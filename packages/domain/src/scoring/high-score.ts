import {
  ensure,
  type HighScoreConfiguration,
  type Match,
  type ScoreEntry,
  type Turn,
  type X01Configuration,
} from '../model.js';
export interface ScoringRule<C, S, I> {
  readonly kind: string;
  initial(configuration: C): S;
  apply(state: S, input: I, configuration: C): S;
  isComplete(state: S, configuration: C): boolean;
}
export interface HighScoreState {
  total: number;
  completedTurns: number;
  bestTurn: number;
}
export const highScoreRule: ScoringRule<HighScoreConfiguration, HighScoreState, number> = {
  kind: 'HIGH_SCORE',
  initial: () => ({ total: 0, completedTurns: 0, bestTurn: 0 }),
  apply(state, score, config) {
    validateScore(score, config.maxTurnScore);
    ensure(!this.isComplete(state, config), 'TURNS_COMPLETE', 'All turns completed');
    return {
      total: state.total + score,
      completedTurns: state.completedTurns + 1,
      bestTurn: Math.max(state.bestTurn, score),
    };
  },
  isComplete: (state, config) => state.completedTurns === config.turns,
};
// Extension contract only: hardware-specific finish detection is deliberately absent.
export interface X01Input {
  score: number;
  declaredFinish: 'single' | 'double' | 'triple' | null;
}
export interface X01State {
  remaining: number;
  bust: boolean;
  won: boolean;
}
export type X01Rule = ScoringRule<X01Configuration, X01State, X01Input>;
export function validateScore(score: number, maximum: number) {
  ensure(
    Number.isSafeInteger(score) && score >= 0 && score <= maximum,
    'INVALID_SCORE',
    `Score must be an integer between 0 and ${maximum}`,
    422,
  );
}
export function effectiveScores(match: Match, turnId?: string): ScoreEntry[] {
  return match.scores.filter((s) => !s.voided && (!turnId || s.turnId === turnId));
}
export function turnTotal(match: Match, turn: Turn): number {
  return effectiveScores(match, turn.id).reduce((sum, s) => sum + s.score, 0);
}
export function turnIsComplete(match: Match, turn: Turn): boolean {
  const scores = effectiveScores(match, turn.id);
  return (
    (scores.length === 1 && scores[0]!.dartIndex === null) ||
    (scores.length === match.scoringConfiguration.dartsPerTurn &&
      scores.every((s) => s.dartIndex !== null))
  );
}
export function playerPerformance(match: Match, entryId: string) {
  const turns = match.turns.filter((t) => t.participantId === entryId && t.status === 'completed');
  const values = turns.map((t) => turnTotal(match, t));
  const completedTotal = values.reduce((a, b) => a + b, 0);
  const total = effectiveScores(match)
    .filter((s) => s.tournamentEntryId === entryId)
    .reduce((sum, s) => sum + s.score, 0);
  return {
    total,
    turns: turns.length,
    bestTurn: Math.max(0, ...values),
    average: turns.length ? completedTotal / turns.length : 0,
    progression: values.map((_, i) => values.slice(0, i + 1).reduce((a, b) => a + b, 0)),
  };
}
