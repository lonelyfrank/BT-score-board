import {
  ensure,
  type Context,
  type DartThrow,
  type Match,
  type RoundRecord,
  type RoundValueKind,
  type Tournament,
} from '../model.js';
import { games } from '../games/catalog.js';
import { heatForEntry } from '../competition/heats.js';
import { rotate, rotationFor } from '../competition/rotation.js';
import { assertTurn, evaluateTurn, type TurnEvaluation } from './darts.js';

/** Open-ended games (X01, Odd & Even) still stop somewhere: a guard against typos. */
export const MAX_OPEN_ROUNDS = 99;

export interface TrackingSpec {
  kind: RoundValueKind;
  /** Rounds of the game on the totem; null when the game ends by itself (X01, Odd & Even). */
  rounds: number | null;
  /** Highest valid value of a round. */
  max: (round: number) => number;
  /**
   * How a complete progression gives a value comparable with the official result:
   * sum (Hi-Score, Shanghai, Exacta), start − sum (X01 scored), last value (X01 remaining,
   * Odd & Even).
   */
  computed: 'sum' | 'start-minus-sum' | 'last';
  label: string;
}

/**
 * What one progressive value means for the game of the tournament. Only observed values are
 * kept: nothing is deduced from a value alone (no bust, opening or closing is inferred for X01;
 * only darts entered one by one are read with the rules of the game, see darts.ts).
 */
export function trackingSpec(t: Tournament, m: Match): TrackingSpec {
  const g = games[t.gameMode];
  const turn = m.scoringConfiguration.maxTurnScore;
  switch (g.scoring) {
    case 'remaining':
      return t.tournamentConfiguration.x01Entry === 'SCORED'
        ? {
            kind: 'points',
            rounds: null,
            max: () => Math.min(turn, g.startingScore!),
            computed: 'start-minus-sum',
            label: 'Punti del turno',
          }
        : {
            kind: 'remaining',
            rounds: null,
            max: () => g.startingScore!,
            computed: 'last',
            label: 'Punti rimasti',
          };
    case 'progress':
      return {
        kind: 'progress',
        rounds: null,
        max: () => g.maxScore,
        computed: 'last',
        label: 'Numero raggiunto',
      };
    default:
      return {
        kind: 'points',
        rounds: t.gameMode === 'HI_SCORE' ? m.scoringConfiguration.turns : g.rounds,
        // Shanghai: three triples of the round number at most.
        max: (round) => (g.specialWin === 'SHANGHAI' ? 9 * round : turn),
        computed: 'sum',
        label: 'Punti del round',
      };
  }
}

const effective = (r: RoundRecord) => r.status === 'recorded' || r.status === 'skipped';
/** The record that currently stands for an entry's round, if any. */
export function currentRound(m: Match, entryId: string, round: number) {
  return (
    m.rounds.find((r) => r.tournamentEntryId === entryId && r.round === round && effective(r)) ??
    null
  );
}

/**
 * A turn as the organizer reads it. complete: value recorded. early: recorded, the turn ended
 * before the third dart (bust, checkout). partial: some darts seen, no value. skipped: not
 * observed. review: the darts entered give another value than the one recorded. reenter: the
 * value was annulled and the turn waits for a new one. missing: nothing was ever recorded.
 */
export type TurnState =
  'complete' | 'early' | 'partial' | 'skipped' | 'review' | 'reenter' | 'missing';
export interface RoundView {
  round: number;
  status: 'recorded' | 'skipped' | 'missing';
  value: number | null;
  playerId: string | null;
  /** The value replaced an earlier one. */
  corrected: boolean;
  recordId: string | null;
  state: TurnState;
  /** Darts of the turn when entered one by one; null when only the value is known. */
  darts: DartThrow[] | null;
  /** Value the darts give under the game rules, when they decide it. */
  dartsValue: number | null;
  /** X01 bust, recorded as such or given by the darts: the turn is worth nothing. */
  bust: boolean;
}
export interface Progress {
  tournamentEntryId: string;
  rounds: RoundView[];
  recorded: number;
  missing: number[];
  skipped: number[];
  /** Every round of the game (open-ended: every round up to the last) has a recorded value. */
  complete: boolean;
  /** Sum (points) or last value of what was recorded; partial unless `complete`. */
  partialValue: number | null;
  /** Value comparable with the official result: only for a complete progression. */
  computed: number | null;
  best: number | null;
  average: number | null;
  /** Official final result, when recorded: it always prevails. */
  official: number | null;
}

/**
 * X01: points left before a round, from the standing values of the rounds before it. Null when
 * one of them is missing or skipped: nothing is assumed about a turn nobody recorded.
 */
export function remainingBefore(t: Tournament, m: Match, entryId: string, round: number) {
  const g = games[t.gameMode];
  if (g.scoring !== 'remaining') return null;
  const start = g.startingScore!;
  if (round === 1) return start;
  if (trackingSpec(t, m).kind === 'remaining') {
    const previous = currentRound(m, entryId, round - 1);
    return previous?.status === 'recorded' ? previous.value : null;
  }
  let left = start;
  for (let r = 1; r < round; r++) {
    const record = currentRound(m, entryId, r);
    if (record?.status !== 'recorded') return null;
    left -= record.value!;
  }
  return left >= 0 ? left : null;
}
/** The darts of an entry's round evaluated in the context of the rounds before it. */
export function evaluateRecordDarts(
  t: Tournament,
  m: Match,
  entryId: string,
  round: number,
  darts: DartThrow[],
) {
  const remaining = remainingBefore(t, m, entryId, round);
  const ev = evaluateTurn({ game: t.gameMode, round, remaining }, darts);
  return { ev, value: valueOfDarts(trackingSpec(t, m), ev, remaining) };
}
/** The progressive value the darts give: points of the turn, or points left after it. */
function valueOfDarts(spec: TrackingSpec, ev: TurnEvaluation, remaining: number | null) {
  if (ev.points === null) return null;
  if (spec.kind === 'points') return ev.points;
  if (spec.kind === 'remaining') return remaining === null ? null : remaining - ev.points;
  return null;
}

/** An entry's progression: missing rounds are missing, never zero. */
export function roundProgress(t: Tournament, m: Match, entryId: string): Progress {
  const spec = trackingSpec(t, m);
  const all = m.rounds.filter((r) => r.tournamentEntryId === entryId);
  const records = all.filter(effective);
  const last = Math.max(0, ...records.map((r) => r.round));
  const count = spec.rounds ?? last;
  const rounds: RoundView[] = Array.from({ length: count }, (_, i) => {
    const r = records.find((x) => x.round === i + 1);
    const darts = r?.darts ?? null;
    const evaluated = darts ? evaluateRecordDarts(t, m, entryId, i + 1, darts) : null;
    const dartsValue = evaluated?.value ?? null;
    let state: TurnState;
    if (!r) state = all.some((x) => x.round === i + 1) ? 'reenter' : 'missing';
    else if (r.status === 'skipped')
      state = darts?.some((d) => d.kind !== 'unobserved') ? 'partial' : 'skipped';
    else if (dartsValue !== null && dartsValue !== r.value) state = 'review';
    else state = darts && darts.length < 3 ? 'early' : 'complete';
    return {
      round: i + 1,
      status: r ? (r.status as 'recorded' | 'skipped') : 'missing',
      value: r?.value ?? null,
      playerId: r?.playerId ?? null,
      corrected: !!r?.correctsId,
      recordId: r?.id ?? null,
      state,
      darts,
      dartsValue,
      bust: !!r?.bust || !!evaluated?.ev.bust,
    };
  });
  const values = rounds.filter((r) => r.status === 'recorded').map((r) => r.value!);
  const complete = count > 0 && rounds.every((r) => r.status === 'recorded');
  const sum = values.reduce((a, b) => a + b, 0);
  const lastValue = [...rounds].reverse().find((r) => r.status === 'recorded')?.value ?? null;
  const start = games[t.gameMode].startingScore ?? 0;
  const partialValue = !values.length
    ? null
    : spec.computed === 'sum'
      ? sum
      : spec.computed === 'start-minus-sum'
        ? start - sum
        : lastValue;
  let computed = complete ? partialValue : null;
  // Points above the start mean an unrecorded bust: the total is not comparable.
  if (spec.computed === 'start-minus-sum' && computed !== null && computed < 0) computed = null;
  return {
    tournamentEntryId: entryId,
    rounds,
    recorded: values.length,
    missing: rounds.filter((r) => r.status === 'missing').map((r) => r.round),
    skipped: rounds.filter((r) => r.status === 'skipped').map((r) => r.round),
    complete,
    partialValue,
    computed,
    best: spec.kind === 'points' && values.length ? Math.max(...values) : null,
    average: spec.kind === 'points' && values.length ? sum / values.length : null,
    official: m.result?.scores[entryId] ?? null,
  };
}

function assertTracking(t: Tournament, m: Match, entryId: string) {
  ensure(t.recording === 'result', 'RECORDING_MISMATCH', 'This tournament records turns');
  ensure(t.tracking !== 'FINAL_ONLY', 'TRACKING_DISABLED', 'Rounds are not tracked here');
  ensure(
    t.status === 'active' || t.status === 'completed',
    'TOURNAMENT_NOT_ACTIVE',
    'Tournament must be active',
  );
  ensure(m.status !== 'cancelled', 'MATCH_CANCELLED', 'The match was cancelled');
  const stage = t.stages.find((s) => s.id === m.stageId);
  ensure(stage && stage.status !== 'invalidated', 'STAGE_CLOSED', 'This phase was invalidated');
  ensure(
    m.participants.some((p) => p.tournamentEntryId === entryId) &&
      !stage.excludedEntryIds.includes(entryId),
    'INVALID_RESULT',
    'Withdrawn players and players outside the match have no rounds',
    422,
  );
}

export interface RecordRoundInput {
  entryId: string;
  round: number;
  /**
   * null: the round was not observed (skipped), which is not zero. Left out with darts that
   * decide the turn: the value follows from them.
   */
  value?: number | null;
  /**
   * The darts one by one. Left out on a correction: the darts already entered stay as they
   * were (a value that no longer matches them is shown for review). null: no detail.
   */
  darts?: DartThrow[] | null;
  /**
   * X01: this round's points do not count and the running total is retained. Darts that go
   * past zero mark the bust by themselves.
   */
  bust?: boolean;
  playerId?: string | null;
  reason?: string | null;
  /** Teams: move the rotation to the next thrower after a new round. */
  advanceRotation?: boolean;
}

/**
 * Records a round, or replaces the one standing (which becomes `corrected` and stays in the
 * history). Rounds are provisional: they never change the official result or the standings.
 */
export function recordRound(t: Tournament, m: Match, input: RecordRoundInput, c: Context) {
  assertTracking(t, m, input.entryId);
  const spec = trackingSpec(t, m);
  const declaredBust = input.bust ?? false;
  ensure(
    !declaredBust || (games[t.gameMode].scoring === 'remaining' && input.value == null),
    'INVALID_ROUND',
    'A bust is only valid for X01 and cannot include a round score',
    422,
  );
  const limit = spec.rounds ?? MAX_OPEN_ROUNDS;
  ensure(
    Number.isInteger(input.round) && input.round >= 1 && input.round <= limit,
    'INVALID_ROUND',
    `Round between 1 and ${limit}`,
    422,
  );
  let value = input.value;
  let bust = declaredBust;
  if (input.darts) {
    const remaining = remainingBefore(t, m, input.entryId, input.round);
    const ev = assertTurn({ game: t.gameMode, round: input.round, remaining }, input.darts);
    const derived = valueOfDarts(spec, ev, remaining);
    ensure(
      !declaredBust || ev.points === null || ev.bust,
      'DARTS_MISMATCH',
      'The darts do not go past zero: this turn is not a bust',
      422,
    );
    bust ||= ev.bust;
    if (value === undefined && derived !== null) value = derived;
    else if (value === undefined)
      ensure(
        declaredBust,
        'VALUE_REQUIRED',
        'The darts do not decide this turn: enter the value shown by the totem',
        422,
      );
    else if (derived !== null && value !== derived)
      // Darts and value disagree: kept only as an explicit, explained correction.
      ensure(
        input.reason?.trim(),
        'DARTS_MISMATCH',
        `The darts give ${derived}: correct them or give a reason for another value`,
        422,
      );
  }
  if (declaredBust && value == null)
    // A declared bust keeps the running total: 0 points scored, or the points left before.
    value =
      t.tournamentConfiguration.x01Entry === 'SCORED'
        ? 0
        : (() => {
            for (let round = input.round - 1; round >= 1; round--) {
              const earlier = currentRound(m, input.entryId, round);
              if (earlier?.status === 'recorded' && earlier.value !== null) return earlier.value;
            }
            return games[t.gameMode].startingScore!;
          })();
  ensure(value !== undefined, 'VALUE_REQUIRED', 'Enter the value of the round', 422);
  if (value !== null)
    ensure(
      Number.isSafeInteger(value) && value >= 0 && value <= spec.max(input.round),
      'INVALID_SCORE',
      `${spec.label}: an integer between 0 and ${spec.max(input.round)}`,
      422,
    );
  const entry = t.entries.find((e) => e.id === input.entryId)!;
  // Any earlier observation of this round (also corrected or voided): the round was thrown.
  const earlier = m.rounds
    .filter((r) => r.tournamentEntryId === input.entryId && r.round === input.round)
    .at(-1);
  let playerId = input.playerId ?? null;
  if (playerId !== null)
    ensure(
      entry.members.some((p) => p.playerId === playerId),
      'INVALID_PLAYER',
      'The thrower is not a member of the unit',
      422,
    );
  else if (entry.members.length === 1) playerId = entry.members[0]!.playerId;
  // A new value of a round already thrown keeps its thrower, wherever the rotation is now.
  else if (earlier) playerId = earlier.playerId;
  else if (input.advanceRotation || m.rotations.some((r) => r.entryId === entry.id)) {
    // The team follows a rotation: the expected thrower is the one at the board.
    const rotation = rotationFor(t, m, entry.id);
    if (!rotation.paused) playerId = rotation.order[rotation.position]!;
  }
  if (t.status === 'active') {
    heatForEntry(t, m, input.entryId, c);
    if (m.status === 'ready') {
      ensure(
        !t.matches.some((x) => x.id !== m.id && ['active', 'paused'].includes(x.status)),
        'BOARD_BUSY',
        'Another match is using the board',
      );
      m.status = 'active';
      m.startedAt ??= c.now();
    }
  }
  const previous = currentRound(m, input.entryId, input.round);
  const status = value === null ? 'skipped' : 'recorded';
  const darts = input.darts !== undefined ? input.darts : (previous?.darts ?? null);
  // The same value (and darts) tapped twice is not a correction.
  if (
    previous &&
    previous.value === value &&
    (previous.bust ?? false) === bust &&
    previous.status === status &&
    JSON.stringify(previous.darts ?? null) === JSON.stringify(darts)
  )
    return previous;
  if (previous) previous.status = 'corrected';
  const record: RoundRecord = {
    id: c.id(),
    matchId: m.id,
    tournamentEntryId: input.entryId,
    round: input.round,
    playerId,
    value,
    bust,
    kind: spec.kind,
    status,
    correctsId: previous?.id ?? null,
    reason: input.reason?.trim() || (bust ? 'Eccesso' : null),
    source: 'manual',
    createdAt: c.now(),
    recordedBy: c.operator,
    darts: darts ? darts.map((d) => ({ kind: d.kind, sector: d.sector })) : null,
  };
  m.rounds.push(record);
  // A turn chosen by hand or taken back is no longer waiting once it has a value.
  if (m.guide) {
    const same = (s: { entryId: string; round: number } | null) =>
      s?.entryId === input.entryId && s.round === input.round;
    if (same(m.guide.pick)) m.guide.pick = null;
    m.guide.replay = m.guide.replay.filter((s) => !same(s));
  }
  // Only the first observation of a round moves the rotation: corrections never do.
  if (input.advanceRotation && !earlier && entry.members.length > 1) {
    const rotation = rotationFor(t, m, entry.id);
    if (!rotation.paused)
      m.rotations = [
        ...m.rotations.filter((r) => r.entryId !== entry.id),
        rotate(rotation, 'advance'),
      ];
  }
  m.version++;
  return record;
}

/**
 * Annuls the standing record of a round: the round becomes missing again, or, with
 * `restorePrevious`, the value it had corrected stands again.
 */
export function voidRound(
  t: Tournament,
  m: Match,
  input: { entryId: string; round: number; restorePrevious?: boolean },
) {
  assertTracking(t, m, input.entryId);
  const record = currentRound(m, input.entryId, input.round);
  ensure(record, 'NOT_FOUND', 'Nothing recorded for this round', 404);
  record.status = 'voided';
  if (input.restorePrevious) {
    const previous = m.rounds.find((r) => r.id === record.correctsId);
    ensure(previous, 'NOTHING_TO_RESTORE', 'This value did not replace another one');
    previous.status = previous.value === null ? 'skipped' : 'recorded';
  }
  m.version++;
}

/** Every observation of an entry, oldest first, voided and corrected ones included. */
export const roundHistory = (m: Match, entryId: string) =>
  m.rounds
    .filter((r) => r.tournamentEntryId === entryId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.round - b.round);
