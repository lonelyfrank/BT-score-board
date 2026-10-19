import { ensure, type GameMode, type HighScoreConfiguration } from '../model.js';

/**
 * What the final score entered for a player means, and so how it orders a match:
 * points (more is better), remaining (X01 points left, fewer is better), distance (Exacta, the
 * total closest to the target) or progress (Odd & Even, informative only).
 */
export type ScoreMeaning = 'points' | 'remaining' | 'distance' | 'progress';
export interface GameDefinition {
  id: GameMode;
  label: string;
  /** One line of the totem rule, shown when the game is chosen. */
  rules: string;
  /** Label of the optional (or required) final score field. */
  scoreLabel: string;
  scoring: ScoreMeaning;
  /** Hi-Score: the score is the result. Elsewhere the totem's winner is enough. */
  scoreRequired: boolean;
  /** Equal results are possible, so a match may end without a winner. */
  drawPossible: boolean;
  /** Players in one game on the totem (matches of a tournament format may hold fewer). */
  players: { min: number; max: number };
  startingScore: number | null;
  rounds: number | null;
  /** Exacta target drawn by the totem. */
  target: { min: number; max: number } | null;
  /** Shanghai: instant win with single, double and triple of the round number. */
  specialWin: 'SHANGHAI' | null;
  /** Entered scores must be integers between 0 and this bound (Hi-Score: see maxScore()). */
  maxScore: number;
  /** Assignment of the numbers to the players (Odd & Even: by playing order). */
  sides: string[] | null;
}

const x01 = (id: GameMode, label: string, start: number, rules: string): GameDefinition => ({
  id,
  label,
  rules,
  scoreLabel: 'Punti rimasti',
  scoring: 'remaining',
  scoreRequired: false,
  drawPossible: false,
  players: { min: 2, max: 4 },
  startingScore: start,
  rounds: null,
  target: null,
  specialWin: null,
  maxScore: start,
  sides: null,
});

export const HI_SCORE_ROUNDS = 7;
export const EXACTA_ROUNDS = 5;
export const SHANGHAI_NUMBERS = 7;

/** The eight games of the totem, in the order of its selector. */
export const games: Record<GameMode, GameDefinition> = {
  '301': x01('301', '301', 301, 'Da 301 a zero, chiusura esatta.'),
  '301_DOUBLE_IN_OUT': x01(
    '301_DOUBLE_IN_OUT',
    '301 Double In/Out',
    301,
    'Da 301 a zero: si apre e si chiude con un doppio.',
  ),
  '501': x01('501', '501', 501, 'Da 501 a zero, chiusura esatta.'),
  HI_SCORE: {
    id: 'HI_SCORE',
    label: 'Hi-Score',
    rules: `Vince il punteggio più alto dopo ${HI_SCORE_ROUNDS} round.`,
    scoreLabel: 'Punteggio finale',
    scoring: 'points',
    scoreRequired: true,
    drawPossible: true,
    players: { min: 2, max: 4 },
    startingScore: null,
    rounds: HI_SCORE_ROUNDS,
    target: null,
    specialWin: null,
    maxScore: HI_SCORE_ROUNDS * 180,
    sides: null,
  },
  '301_MASTERS': x01(
    '301_MASTERS',
    '301 Masters',
    301,
    'Da 301 a zero: si chiude con doppio, triplo o centro.',
  ),
  EXACTA: {
    id: 'EXACTA',
    label: 'Exacta',
    rules: `Obiettivo casuale 250–350 in ${EXACTA_ROUNDS} round: vince il totale più vicino.`,
    scoreLabel: 'Totale finale',
    scoring: 'distance',
    scoreRequired: false,
    drawPossible: true,
    players: { min: 2, max: 4 },
    startingScore: null,
    rounds: EXACTA_ROUNDS,
    target: { min: 250, max: 350 },
    specialWin: null,
    maxScore: EXACTA_ROUNDS * 180,
    sides: null,
  },
  ODD_EVEN: {
    id: 'ODD_EVEN',
    label: 'Odd & Even',
    rules: 'Progressione sui numeri dispari o pari assegnati: vince chi completa per primo.',
    scoreLabel: 'Numero raggiunto',
    scoring: 'progress',
    scoreRequired: false,
    drawPossible: false,
    // Assumption to confirm on the totem: one player on the odd numbers, one on the even.
    players: { min: 2, max: 2 },
    startingScore: null,
    rounds: null,
    target: null,
    specialWin: null,
    maxScore: 20,
    sides: ['Dispari', 'Pari'],
  },
  SHANGHAI: {
    id: 'SHANGHAI',
    label: 'Shanghai',
    rules: `Numeri da 1 a ${SHANGHAI_NUMBERS}: punteggio più alto, oppure vittoria immediata con Shanghai.`,
    scoreLabel: 'Punti',
    scoring: 'points',
    scoreRequired: false,
    drawPossible: true,
    players: { min: 2, max: 4 },
    startingScore: null,
    rounds: SHANGHAI_NUMBERS,
    target: null,
    specialWin: 'SHANGHAI',
    // Three triples of the round number, rounds 1 to 7: 9 × (1 + … + 7).
    maxScore: 9 * ((SHANGHAI_NUMBERS * (SHANGHAI_NUMBERS + 1)) / 2),
    sides: null,
  },
};
// Explicit: Object.keys would list the integer-like keys ('301', '501') first.
export const gameModes: GameMode[] = [
  '301',
  '301_DOUBLE_IN_OUT',
  '501',
  'HI_SCORE',
  '301_MASTERS',
  'EXACTA',
  'ODD_EVEN',
  'SHANGHAI',
];
export const game = (mode: GameMode) => games[mode];

/** Highest valid final score: Hi-Score follows the tournament's rounds and turn maximum. */
export function maxScore(mode: GameMode, config?: HighScoreConfiguration) {
  return mode === 'HI_SCORE' && config ? config.turns * config.maxTurnScore : games[mode].maxScore;
}
/** Side of a player by playing order (Odd & Even), or null. */
export function sideOf(mode: GameMode, playingOrder: number) {
  const sides = games[mode].sides;
  return sides ? sides[(playingOrder - 1) % sides.length]! : null;
}

export interface ResultInput {
  scores: Record<string, number | null>;
  declaredWinnerEntryId: string | null;
  targetScore: number | null;
  special: 'SHANGHAI' | null;
}
export interface ResultOutcome {
  /** Every required value is present: the match can be completed. */
  complete: boolean;
  /** Effective winner: declared, or decided by the scores. Null on a draw or while incomplete. */
  winnerEntryId: string | null;
}

/**
 * Validates a final result against the game and decides its winner. `entries` are the players
 * whose result counts (withdrawn players excluded). Throws a 422 DomainError when invalid.
 */
export function evaluateResult(
  mode: GameMode,
  entries: string[],
  input: ResultInput,
  config?: HighScoreConfiguration,
): ResultOutcome {
  const g = games[mode];
  const limit = maxScore(mode, config);
  for (const [entry, score] of Object.entries(input.scores)) {
    ensure(entries.includes(entry), 'INVALID_RESULT', 'Score for a player outside the match', 422);
    if (score !== null)
      ensure(
        Number.isSafeInteger(score) && score >= 0 && score <= limit,
        'INVALID_SCORE',
        `${g.scoreLabel}: an integer between 0 and ${limit}`,
        422,
      );
  }
  const winner = input.declaredWinnerEntryId;
  ensure(
    winner === null || entries.includes(winner),
    'INVALID_RESULT',
    'The winner must be a player of the match',
    422,
  );
  if (input.targetScore !== null)
    ensure(
      g.target !== null &&
        Number.isSafeInteger(input.targetScore) &&
        input.targetScore >= g.target.min &&
        input.targetScore <= g.target.max,
      'INVALID_TARGET',
      g.target ? `Target between ${g.target.min} and ${g.target.max}` : 'This game has no target',
      422,
    );
  if (input.special !== null) {
    ensure(g.specialWin === input.special, 'INVALID_RESULT', 'Not a win of this game', 422);
    ensure(winner !== null, 'WINNER_REQUIRED', 'A Shanghai needs the player who made it', 422);
  }
  const values = entries.map((e) => input.scores[e] ?? null);
  const scored = values.every((v) => v !== null);
  // Who the scores designate, when they decide: all present (and Exacta's target known).
  let byScores: string[] | null = null;
  if (scored && entries.length && g.scoring !== 'progress' && input.special === null) {
    const key = (v: number) =>
      g.scoring === 'points'
        ? v
        : g.scoring === 'remaining'
          ? -v
          : input.targetScore === null
            ? null
            : -Math.abs(v - input.targetScore);
    const keys = values.map((v) => key(v!));
    if (keys.every((k) => k !== null)) {
      const best = Math.max(...(keys as number[]));
      byScores = entries.filter((_, i) => keys[i] === best);
    }
  }
  if (winner !== null && byScores !== null && input.special === null)
    ensure(
      byScores.length === 1 && byScores[0] === winner,
      'RESULT_INCONSISTENT',
      'The declared winner does not match the scores',
      422,
    );
  if (g.scoreRequired) {
    // Hi-Score: the totals are the result; a tie leaves the match without a winner.
    return {
      complete: scored,
      winnerEntryId: scored && byScores?.length === 1 ? byScores[0]! : null,
    };
  }
  if (winner !== null) return { complete: true, winnerEntryId: winner };
  if (byScores?.length === 1) return { complete: true, winnerEntryId: byScores[0]! };
  // Equal scores decide a draw only where the totem can end level.
  if (byScores && g.drawPossible) return { complete: true, winnerEntryId: null };
  return { complete: false, winnerEntryId: null };
}

/**
 * Ordering key of a player in a match recorded as a result (greater is better): won, then
 * recorded, then the score as the game reads it. Unrecorded players sort last.
 */
export function resultCriteria(
  mode: GameMode,
  score: number | null,
  winner: boolean,
  targetScore: number | null,
): number[] {
  const g = games[mode];
  const recorded = score === null ? 0 : 1;
  const value =
    score === null
      ? 0
      : g.scoring === 'points'
        ? score
        : g.scoring === 'remaining'
          ? -score
          : g.scoring === 'distance'
            ? targetScore === null
              ? 0
              : -Math.abs(score - targetScore)
            : 0;
  return g.scoreRequired ? [recorded, value] : [winner ? 1 : 0, recorded, value];
}
