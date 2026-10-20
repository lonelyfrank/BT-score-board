import { ensure, type DartKind, type DartThrow, type GameMode } from '../model.js';
import { games } from '../games/catalog.js';

export const DARTS_PER_TURN = 3;
export const dartKinds: DartKind[] = [
  'single',
  'double',
  'triple',
  'bull25',
  'bull50',
  'miss',
  'unobserved',
];
const sectored = (kind: DartKind) => kind === 'single' || kind === 'double' || kind === 'triple';

/** Points of a dart where it landed, before any game rule; null when nobody saw it. */
export function dartFace(d: DartThrow): number | null {
  switch (d.kind) {
    case 'single':
      return d.sector!;
    case 'double':
      return 2 * d.sector!;
    case 'triple':
      return 3 * d.sector!;
    case 'bull25':
      return 25;
    case 'bull50':
      return 50;
    case 'miss':
      return 0;
    case 'unobserved':
      return null;
  }
}

export function assertDarts(darts: DartThrow[]) {
  ensure(
    darts.length >= 1 && darts.length <= DARTS_PER_TURN,
    'INVALID_DARTS',
    `A turn has 1 to ${DARTS_PER_TURN} darts`,
    422,
  );
  for (const d of darts)
    ensure(
      dartKinds.includes(d.kind) &&
        (sectored(d.kind)
          ? Number.isInteger(d.sector) && d.sector! >= 1 && d.sector! <= 20
          : d.sector === null),
      'INVALID_DARTS',
      'Single, double and triple need a sector from 1 to 20; bull, miss and unobserved none',
      422,
    );
}

/** What is known before a turn: the round (Shanghai) and the points left (X01). */
export interface TurnContext {
  game: GameMode;
  round: number;
  /** X01: points left before the turn; null when unknown (an earlier round is missing). */
  remaining: number | null;
}
export interface TurnEvaluation {
  /** Points of each dart under the game rules; null when not observed or not decidable. */
  scores: (number | null)[];
  /** Points scored in the turn (0 on a bust); null when the darts do not decide it. */
  points: number | null;
  bust: boolean;
  /** X01: the turn reached zero. */
  closed: boolean;
  /** Shanghai: single, double and triple of the round number in the same turn. */
  shanghai: boolean;
  /** Dart that ended the turn before the third (bust or checkout): later darts are unused. */
  endedAt: number | null;
  /** Every dart the turn could hold was entered: three, or fewer when it ended early. */
  complete: boolean;
  /** Why `points` is null: a dart nobody saw, unknown points left, or a game without sums. */
  unknown: 'unobserved' | 'remaining' | 'rules' | null;
}

/** Closing darts of the X01 variants, as the totem documents them. */
function closes(game: GameMode, d: DartThrow) {
  if (game === '301_DOUBLE_IN_OUT') return d.kind === 'double';
  if (game === '301_MASTERS')
    return d.kind === 'double' || d.kind === 'triple' || d.kind === 'bull50';
  return true;
}

/**
 * Applies the documented rule of the game to the darts observed. Nothing is assumed about what
 * was not observed: an unobserved dart, or unknown points left in X01, leaves the turn
 * undecided and the organizer reads its value on the totem.
 *
 * Hi-Score and Exacta add the darts. Shanghai counts only the round number (other sectors,
 * bull and misses are worth zero by rule). X01 subtracts from the points left: going below zero
 * is a bust (the turn is worth nothing), zero is a checkout; Double In/Out opens and closes on
 * a double and Masters closes on double, triple or bull 50, so 1 left is a bust for both.
 */
export function evaluateTurn(ctx: TurnContext, darts: DartThrow[]): TurnEvaluation {
  const g = games[ctx.game];
  const result: TurnEvaluation = {
    scores: darts.map(() => null),
    points: null,
    bust: false,
    closed: false,
    shanghai: false,
    endedAt: null,
    complete: darts.length === DARTS_PER_TURN,
    unknown: null,
  };
  if (g.scoring === 'progress') return { ...result, unknown: 'rules' };
  if (g.scoring !== 'remaining') {
    const target = g.specialWin === 'SHANGHAI' ? ctx.round : null;
    result.scores = darts.map((d) => {
      const face = dartFace(d);
      if (face === null || target === null) return face;
      return sectored(d.kind) && d.sector === target ? face : 0;
    });
    if (target !== null)
      result.shanghai = (['single', 'double', 'triple'] as const).every((kind) =>
        darts.some((d) => d.kind === kind && d.sector === target),
      );
    const unseen = result.scores.some((s) => s === null);
    result.points = unseen ? null : result.scores.reduce<number>((a, s) => a + s!, 0);
    result.unknown = unseen ? 'unobserved' : null;
    return result;
  }
  // X01: the turn depends on the points left before it.
  const start = g.startingScore!;
  let left = ctx.remaining;
  let opened = left === null ? null : left < start;
  let scored = 0;
  for (const [i, d] of darts.entries()) {
    const face = dartFace(d);
    if (face === null) {
      result.unknown = 'unobserved';
      break;
    }
    if (left === null) {
      result.scores[i] = face;
      result.unknown = 'remaining';
      continue;
    }
    if (ctx.game === '301_DOUBLE_IN_OUT' && !opened) {
      if (d.kind !== 'double') {
        // Before the opening double the totem counts nothing.
        result.scores[i] = 0;
        continue;
      }
      opened = true;
    }
    const after = left - face;
    const strict = ctx.game === '301_DOUBLE_IN_OUT' || ctx.game === '301_MASTERS';
    if (after < 0 || (strict && after === 1) || (after === 0 && !closes(ctx.game, d))) {
      result.scores[i] = face;
      result.bust = true;
      result.endedAt = i;
      break;
    }
    result.scores[i] = face;
    scored += face;
    left = after;
    if (left === 0) {
      result.closed = true;
      result.endedAt = i;
      break;
    }
  }
  if (result.endedAt !== null && result.endedAt < DARTS_PER_TURN - 1)
    result.complete = darts.length === result.endedAt + 1;
  if (result.unknown === null) result.points = result.bust ? 0 : scored;
  return result;
}

/**
 * Validates the darts of a turn: no dart after the one that ended it, and three darts unless it
 * ended early. A turn whose darts were only partly seen still lists three darts (the missing
 * ones as `unobserved`).
 */
export function assertTurn(ctx: TurnContext, darts: DartThrow[]) {
  assertDarts(darts);
  const ev = evaluateTurn(ctx, darts);
  ensure(
    ev.endedAt === null || darts.length === ev.endedAt + 1,
    'DARTS_AFTER_END',
    'The turn ended before the last dart entered: unused darts are not recorded',
    422,
  );
  ensure(
    darts.length === DARTS_PER_TURN || ev.endedAt !== null,
    'DARTS_INCOMPLETE',
    'Enter the three darts (an unseen dart is "unobserved"), or only the total of the turn',
    422,
  );
  return ev;
}
