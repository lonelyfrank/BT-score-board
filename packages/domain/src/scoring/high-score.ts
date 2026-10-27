import { ensure, type Match, type ScoreEntry, type Turn } from '../model.js';
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
