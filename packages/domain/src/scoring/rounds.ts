import {
  ensure,
  type Context,
  type Match,
  type RoundRecord,
  type RoundValueKind,
  type Tournament,
} from '../model.js';
import { games } from '../games/catalog.js';
import { heatForEntry } from '../competition/heats.js';
import { rotate, rotationFor } from '../competition/rotation.js';

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
 * kept: nothing is deduced (no bust, opening or closing is inferred for X01).
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
      return { kind: 'progress', rounds: null, max: () => g.maxScore, computed: 'last', label: 'Numero raggiunto' };
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

export interface RoundView {
  round: number;
  status: 'recorded' | 'skipped' | 'missing';
  value: number | null;
  playerId: string | null;
  /** The value replaced an earlier one. */
  corrected: boolean;
  recordId: string | null;
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

/** An entry's progression: missing rounds are missing, never zero. */
export function roundProgress(t: Tournament, m: Match, entryId: string): Progress {
  const spec = trackingSpec(t, m);
  const records = m.rounds.filter((r) => r.tournamentEntryId === entryId && effective(r));
  const last = Math.max(0, ...records.map((r) => r.round));
  const count = spec.rounds ?? last;
  const rounds: RoundView[] = Array.from({ length: count }, (_, i) => {
    const r = records.find((x) => x.round === i + 1);
    return {
      round: i + 1,
      status: r ? (r.status as 'recorded' | 'skipped') : 'missing',
      value: r?.value ?? null,
      playerId: r?.playerId ?? null,
      corrected: !!r?.correctsId,
      recordId: r?.id ?? null,
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
  /** null: the round was not observed (skipped), which is not zero. */
  value: number | null;
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
  const limit = spec.rounds ?? MAX_OPEN_ROUNDS;
  ensure(
    Number.isInteger(input.round) && input.round >= 1 && input.round <= limit,
    'INVALID_ROUND',
    `Round between 1 and ${limit}`,
    422,
  );
  if (input.value !== null)
    ensure(
      Number.isSafeInteger(input.value) && input.value >= 0 && input.value <= spec.max(input.round),
      'INVALID_SCORE',
      `${spec.label}: an integer between 0 and ${spec.max(input.round)}`,
      422,
    );
  const entry = t.entries.find((e) => e.id === input.entryId)!;
  let playerId = input.playerId ?? null;
  if (playerId !== null)
    ensure(
      entry.members.some((p) => p.playerId === playerId),
      'INVALID_PLAYER',
      'The thrower is not a member of the unit',
      422,
    );
  else if (entry.members.length === 1) playerId = entry.members[0]!.playerId;
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
  const status = input.value === null ? 'skipped' : 'recorded';
  // The same value tapped twice is not a correction.
  if (previous && previous.value === input.value && previous.status === status) return previous;
  if (previous) previous.status = 'corrected';
  const record: RoundRecord = {
    id: c.id(),
    matchId: m.id,
    tournamentEntryId: input.entryId,
    round: input.round,
    playerId,
    value: input.value,
    kind: spec.kind,
    status,
    correctsId: previous?.id ?? null,
    reason: input.reason?.trim() || null,
    source: 'manual',
    createdAt: c.now(),
    recordedBy: c.operator,
  };
  m.rounds.push(record);
  if (input.advanceRotation && !previous && entry.members.length > 1) {
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
