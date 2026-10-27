import type { GameMode, Match, Tournament, TournamentEntry } from '../model.js';
import { HI_SCORE_ROUNDS } from '../games/catalog.js';
import { roundProgress } from '../scoring/rounds.js';

/**
 * What is compared for a game: the highest total where the game is played for points, the
 * fewest rounds to close where it counts down (that needs the rounds to be tracked), the
 * smallest distance from the target in Exacta. Odd & Even has none: its progression is only
 * informative.
 */
export interface RecordSpec {
  game: GameMode;
  /** `max`: greater is better. `min`: smaller is better. */
  direction: 'max' | 'min';
  /** What the value is, shown next to it. */
  metric: string;
  /** Title of the holder. */
  title: string;
}

const x01 = (game: GameMode, label: string): RecordSpec => ({
  game,
  direction: 'min',
  metric: 'round per chiudere',
  title: `Re del ${label}`,
});

export const recordSpecs: Partial<Record<GameMode, RecordSpec>> = {
  '301': x01('301', '301'),
  '301_DOUBLE_IN_OUT': x01('301_DOUBLE_IN_OUT', '301 Double In/Out'),
  '501': x01('501', '501'),
  '301_MASTERS': x01('301_MASTERS', '301 Masters'),
  HI_SCORE: {
    game: 'HI_SCORE',
    direction: 'max',
    metric: 'punti',
    title: 'Re dell’Hi-Score',
  },
  EXACTA: {
    game: 'EXACTA',
    direction: 'min',
    metric: 'distanza dall’obiettivo',
    title: 'Cecchino dell’Exacta',
  },
  SHANGHAI: { game: 'SHANGHAI', direction: 'max', metric: 'punti', title: 'Re dello Shanghai' },
};

export interface RecordHolding {
  game: GameMode;
  spec: RecordSpec;
  value: number;
  playerId: string;
  /** Null when the record arrived with a player card from another device. */
  tournamentId: string | null;
  matchId: string | null;
  achievedAt: string;
}

/**
 * The comparable value an entry reached in a completed match, or null when the match gives
 * none: a walkover, a team, a missing score, a Hi-Score played over a different number of
 * rounds, a countdown game whose rounds were not all tracked down to zero.
 */
export function entryPerformance(t: Tournament, m: Match, entry: TournamentEntry): number | null {
  if (m.status !== 'completed' || !m.result || m.result.walkover || entry.kind !== 'single')
    return null;
  const score = m.result.scores[entry.id] ?? null;
  switch (t.gameMode) {
    case 'HI_SCORE':
      return m.scoringConfiguration.turns === HI_SCORE_ROUNDS ? score : null;
    case 'SHANGHAI':
      return score;
    case 'EXACTA':
      return score !== null && m.result.targetScore !== null
        ? Math.abs(score - m.result.targetScore)
        : null;
    case '301':
    case '301_DOUBLE_IN_OUT':
    case '501':
    case '301_MASTERS': {
      const progress = roundProgress(t, m, entry.id);
      return progress.complete && progress.computed === 0 ? progress.rounds.length : null;
    }
    default:
      return null;
  }
}

/** True when `a` is better than `b` for the record. */
export const beatsRecord = (spec: RecordSpec, a: number, b: number) =>
  spec.direction === 'max' ? a > b : a < b;

/** A better value wins; an equal one only when it was reached earlier. */
export const takesRecord = (
  spec: RecordSpec,
  a: { value: number; achievedAt: string },
  b: { value: number; achievedAt: string } | undefined,
) =>
  !b || beatsRecord(spec, a.value, b.value) || (a.value === b.value && a.achievedAt < b.achievedAt);

/** When a match was played: completion, else the moment its result was recorded. */
export const matchPlayedAt = (m: Match) => m.completedAt ?? m.result?.recordedAt ?? null;
