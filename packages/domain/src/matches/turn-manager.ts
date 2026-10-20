import {
  ensure,
  type Context,
  type DartThrow,
  type Heat,
  type Match,
  type Tournament,
  type TurnGuide,
  type TurnSlot,
} from '../model.js';
import { games } from '../games/catalog.js';
import { heatOf } from '../competition/heats.js';
import { rotationFor } from '../competition/rotation.js';
import {
  MAX_OPEN_ROUNDS,
  currentRound,
  evaluateRecordDarts,
  recordRound,
  remainingBefore,
  trackingSpec,
} from '../scoring/rounds.js';

export function currentTurn(match: Match) {
  return match.turns.find((t) => !['completed', 'skipped'].includes(t.status)) ?? null;
}
export function turnState(match: Match) {
  const remaining = match.turns.filter((t) => !['completed', 'skipped'].includes(t.status));
  return {
    matchId: match.id,
    matchStatus: match.status,
    currentTurn: remaining[0] ?? null,
    nextTurn: remaining[1] ?? null,
    turnsRemaining: remaining.length,
    completedEntryIds: match.participants
      .filter((p) =>
        match.turns
          .filter((t) => t.participantId === p.tournamentEntryId)
          .every((t) => t.status === 'completed'),
      )
      .map((p) => p.tournamentEntryId),
  };
}

/*
 * Turn coordinator for matches recorded as results with progressive tracking. Turns follow the
 * throwing order of the seats at the board, round after round: Frank, Salvo, Marco, Luca, then
 * round 2. Where the coordinator stands is derived from the rounds recorded (the turn after the
 * last one thrown), plus the few choices of the organizer kept in `match.guide`, so it is the
 * same after a reload, on another tab or after a backup. It never records a score by itself.
 */

/** A turn and the person expected to throw it (null in a team's free rotation). */
export interface PlannedTurn extends TurnSlot {
  playerId: string | null;
}
/**
 * ready: nothing thrown yet. in_progress: a turn is expected. paused: free mode, the organizer
 * picks who throws. interrupted: the tournament or match is paused. completed: every turn of
 * the game was thrown, the heat is closed, or a Shanghai ended the game.
 */
export type PlanState = 'ready' | 'in_progress' | 'paused' | 'interrupted' | 'completed';
export interface TurnPlan {
  heatId: string | null;
  heatNumber: number | null;
  /** Competitive units at the board, in throwing order (withdrawn ones left out). */
  seats: string[];
  /** Rounds of the game; null when it ends by itself (X01, Odd & Even). */
  rounds: number | null;
  state: PlanState;
  current: PlannedTurn | null;
  /** Turn proposed after the current one (before its result is known). */
  next: PlannedTurn | null;
  /** Round in play: the current turn's, else the last one thrown. */
  round: number;
  /** Turns thrown (a value, a skip or an annulled value) and turns expected (fixed rounds). */
  thrown: number;
  expected: number | null;
  /** The last turn with a standing value: "undo" takes it back and proposes it again. */
  undoable: TurnSlot | null;
  /** X01 seats that reached zero, with their round: they throw no more. */
  closed: TurnSlot[];
  /** Turns already passed without a standing value: to record or verify before the result. */
  gaps: TurnSlot[];
  /** Shanghai made: the game ends on the totem. */
  shanghai: TurnSlot | null;
  /** Before the current turn: running total of the values recorded, or X01 points left. */
  before: number | null;
}

const emptyGuide = (): TurnGuide => ({ pick: null, replay: [], paused: false });
const guideOf = (m: Match): TurnGuide => m.guide ?? emptyGuide();
const same = (a: TurnSlot | null | undefined, b: TurnSlot | null | undefined) =>
  !!a && !!b && a.entryId === b.entryId && a.round === b.round;

/** Seats of a heat (or of the whole match) in throwing order, withdrawn entries left out. */
function seatsOf(t: Tournament, m: Match, heat: Heat | null) {
  const excluded = t.stages.find((s) => s.id === m.stageId)?.excludedEntryIds ?? [];
  const ids = heat
    ? heat.entryIds
    : [...m.participants]
        .sort((a, b) => a.playingOrder - b.playingOrder)
        .map((p) => p.tournamentEntryId);
  return ids.filter((id) => !excluded.includes(id));
}
/** X01: the round in which an entry reached zero, if it did. */
function closedRound(t: Tournament, m: Match, entryId: string, rounds: number) {
  if (games[t.gameMode].scoring !== 'remaining') return null;
  for (let r = 1; r <= rounds; r++) {
    const record = currentRound(m, entryId, r);
    if (record?.status !== 'recorded') continue;
    const left =
      trackingSpec(t, m).kind === 'remaining'
        ? record.value
        : (() => {
            const before = remainingBefore(t, m, entryId, r);
            return before === null ? null : before - record.value!;
          })();
    if (left === 0) return r;
  }
  return null;
}
function shanghaiOf(t: Tournament, m: Match, seats: string[]): TurnSlot | null {
  if (games[t.gameMode].specialWin !== 'SHANGHAI') return null;
  for (const r of m.rounds)
    if (
      (r.status === 'recorded' || r.status === 'skipped') &&
      r.darts &&
      seats.includes(r.tournamentEntryId) &&
      evaluateRecordDarts(t, m, r.tournamentEntryId, r.round, r.darts).ev.shanghai
    )
      return { entryId: r.tournamentEntryId, round: r.round };
  return null;
}

/** The heat the coordinator follows by default: at the board, else the next one to play. */
export function guidedHeat(m: Match) {
  const live = m.heats.filter((h) => h.status !== 'cancelled');
  return (
    live.find((h) => h.status === 'active') ??
    live.find((h) => h.status === 'pending' || h.status === 'ready') ??
    live.at(-1) ??
    null
  );
}

/** Where the turns of a heat (or of a match played in one session) stand. */
export function turnPlan(t: Tournament, m: Match, heatId?: string | null): TurnPlan {
  const heat = heatId ? (m.heats.find((h) => h.id === heatId) ?? null) : guidedHeat(m);
  const seats = seatsOf(t, m, heat);
  const spec = trackingSpec(t, m);
  const guide = guideOf(m);
  const observed = m.rounds.filter((r) => seats.includes(r.tournamentEntryId));
  const lastObserved = Math.max(0, ...observed.map((r) => r.round));
  // Open-ended games get one round more than the last one thrown.
  const limit = spec.rounds ?? Math.min(MAX_OPEN_ROUNDS, lastObserved + 1);
  const n = seats.length;
  const index = (s: TurnSlot) => (s.round - 1) * n + seats.indexOf(s.entryId);
  const slotAt = (i: number): TurnSlot => ({
    entryId: seats[i % n]!,
    round: Math.floor(i / n) + 1,
  });
  const thrown = (s: TurnSlot) =>
    observed.some((r) => r.tournamentEntryId === s.entryId && r.round === s.round);
  const standing = (s: TurnSlot) => !!currentRound(m, s.entryId, s.round);
  const closedAt = new Map(
    seats.flatMap((id) => {
      const r = closedRound(t, m, id, limit);
      return r === null ? [] : [[id, r] as const];
    }),
  );
  const playable = (s: TurnSlot) =>
    seats.includes(s.entryId) &&
    s.round >= 1 &&
    s.round <= limit &&
    !(closedAt.has(s.entryId) && s.round > closedAt.get(s.entryId)!);
  // The frontier: the last turn thrown in throwing order (any observation, annulled included).
  let frontier = -1;
  for (const r of observed)
    if (r.round <= limit)
      frontier = Math.max(frontier, index({ entryId: r.tournamentEntryId, round: r.round }));
  const after = (i: number) => {
    for (let j = i + 1; j < limit * n; j++) if (playable(slotAt(j))) return slotAt(j);
    return null;
  };
  const shanghai = shanghaiOf(t, m, seats);
  const pick = guide.pick && playable(guide.pick) && !standing(guide.pick) ? guide.pick : null;
  const replay = guide.replay
    .filter((s) => playable(s) && !standing(s))
    .sort((a, b) => index(a) - index(b));
  const interrupted = t.status === 'paused' || m.status === 'paused';
  const finished =
    !!shanghai ||
    heat?.status === 'completed' ||
    m.status === 'completed' ||
    m.status === 'cancelled';
  let current: TurnSlot | null = null;
  if (!finished && n) current = pick ?? (guide.paused ? null : (replay[0] ?? after(frontier)));
  let next: TurnSlot | null = null;
  if (current && !guide.paused) {
    const rest = replay.filter((s) => !same(s, current));
    next = rest[0] ?? after(Math.max(frontier, index(current)));
  }
  const throwerOf = (s: TurnSlot, advancedBefore: number): string | null => {
    const earlier = m.rounds
      .filter((r) => r.tournamentEntryId === s.entryId && r.round === s.round)
      .at(-1);
    if (earlier?.playerId) return earlier.playerId;
    const entry = t.entries.find((e) => e.id === s.entryId);
    if (!entry) return null;
    if (entry.members.length === 1) return entry.members[0]!.playerId;
    const rotation = rotationFor(t, m, s.entryId);
    if (rotation.paused) return null;
    return rotation.order[(rotation.position + advancedBefore) % rotation.order.length]!;
  };
  const plan = (s: TurnSlot | null, advancedBefore = 0): PlannedTurn | null =>
    s ? { ...s, playerId: throwerOf(s, advancedBefore) } : null;
  // The current turn of the same team, thrown for the first time, moves its rotation on.
  const shift = current && next && current.entryId === next.entryId && !thrown(current) ? 1 : 0;
  const allSlots = Array.from({ length: limit * n }, (_, i) => slotAt(i)).filter(playable);
  const lastStanding = [...allSlots].reverse().find(standing) ?? null;
  const round = current?.round ?? (frontier >= 0 ? slotAt(frontier).round : 1);
  let before: number | null = null;
  if (current) {
    // X01 shows the points left whichever value is entered; other sums show the running total.
    if (games[t.gameMode].scoring === 'remaining')
      before = remainingBefore(t, m, current.entryId, current.round);
    else if (spec.kind === 'points') {
      before = 0;
      for (let r = 1; r < current.round; r++)
        before += currentRound(m, current.entryId, r)?.value ?? 0;
    }
  }
  const state: PlanState = finished
    ? 'completed'
    : interrupted
      ? 'interrupted'
      : !current
        ? guide.paused
          ? 'paused'
          : 'completed'
        : frontier < 0
          ? 'ready'
          : 'in_progress';
  return {
    heatId: heat?.id ?? null,
    heatNumber: heat?.number ?? null,
    seats,
    rounds: spec.rounds,
    state,
    current: plan(current),
    next: plan(next, shift),
    round,
    thrown: allSlots.filter(thrown).length,
    expected: spec.rounds === null ? null : allSlots.length,
    undoable: lastStanding,
    closed: [...closedAt].map(([entryId, r]) => ({ entryId, round: r })),
    gaps: allSlots.filter((s) => index(s) <= frontier && !standing(s) && !same(s, current)),
    shanghai,
    before,
  };
}

/** Plans of every heat of the match, or of the single session. */
export function turnPlans(t: Tournament, m: Match): TurnPlan[] {
  const live = m.heats.filter((h) => h.status !== 'cancelled');
  return live.length ? live.map((h) => turnPlan(t, m, h.id)) : [turnPlan(t, m, null)];
}

export interface RecordTurnInput {
  entryId: string;
  round: number;
  /** Left out when the darts decide the turn. */
  value?: number | null;
  darts?: DartThrow[] | null;
  /** Another member than the one expected throws for the team. */
  playerId?: string | null;
  reason?: string | null;
}
/**
 * Confirms the turn at the board: records its round, moves the team rotation on and lets the
 * coordinator propose the next turn, in one change. Refused when another turn is at the board
 * (a stale screen, another tab, a repeated tap after the turn moved on).
 */
export function recordTurn(t: Tournament, m: Match, input: RecordTurnInput, c: Context) {
  const heat = heatOf(m, input.entryId);
  const plan = turnPlan(t, m, heat?.id ?? null);
  ensure(plan.state !== 'interrupted', 'TOURNAMENT_NOT_ACTIVE', 'Resume the match first');
  ensure(
    plan.current?.entryId === input.entryId && plan.current.round === input.round,
    'TURN_MOVED',
    'Another turn is at the board: reload the match',
  );
  return recordRound(
    t,
    m,
    {
      entryId: input.entryId,
      round: input.round,
      value: input.value,
      darts: input.darts,
      playerId: input.playerId ?? undefined,
      reason: input.reason,
      advanceRotation: true,
    },
    c,
  );
}

export type GuideAction = 'pick' | 'undo' | 'pause' | 'resume';
/**
 * The organizer's controls of the coordinator. pick: this turn is at the board now (no score
 * recorded); its round defaults to the first one still open for that entry. undo: the last turn
 * confirmed is annulled (kept in the history) and proposed again with its thrower; the team
 * rotation is not moved twice. pause / resume: free mode, then automatic proposals again.
 */
export function guideTurn(
  t: Tournament,
  m: Match,
  input: {
    action: GuideAction;
    entryId?: string | null;
    round?: number | null;
    heatId?: string | null;
  },
) {
  ensure(t.status === 'active', 'TOURNAMENT_NOT_ACTIVE', 'Tournament must be active');
  ensure(
    t.recording === 'result' && t.tracking !== 'FINAL_ONLY',
    'TRACKING_DISABLED',
    'Rounds are not tracked here',
  );
  ensure(!['completed', 'cancelled'].includes(m.status), 'INVALID_STATE', 'The match is over');
  const guide = guideOf(m);
  switch (input.action) {
    case 'pause':
      guide.paused = true;
      break;
    case 'resume':
      guide.paused = false;
      break;
    case 'pick': {
      const entryId = input.entryId ?? '';
      const plan = turnPlan(t, m, heatOf(m, entryId)?.id ?? null);
      ensure(plan.seats.includes(entryId), 'INVALID_RESULT', 'This entry is not at the board', 422);
      const limit = plan.rounds ?? MAX_OPEN_ROUNDS;
      let round = input.round ?? plan.round;
      if (input.round == null) while (round <= limit && currentRound(m, entryId, round)) round++;
      ensure(
        Number.isInteger(round) && round >= 1 && round <= limit,
        'INVALID_ROUND',
        `Round between 1 and ${limit}`,
        422,
      );
      ensure(
        !plan.closed.some((s) => s.entryId === entryId && round > s.round),
        'ENTRY_CLOSED',
        'This entry has already reached zero',
      );
      ensure(
        !currentRound(m, entryId, round),
        'ALREADY_RECORDED',
        'This turn has a value: correct it from the round matrix',
      );
      guide.pick = { entryId, round };
      break;
    }
    case 'undo': {
      const plan = turnPlan(t, m, input.heatId ?? null);
      ensure(plan.undoable, 'NOTHING_TO_UNDO', 'No turn to take back');
      const record = currentRound(m, plan.undoable.entryId, plan.undoable.round)!;
      record.status = 'voided';
      guide.pick = null;
      guide.replay = [
        ...guide.replay.filter((s) => !same(s, plan.undoable)),
        { entryId: plan.undoable.entryId, round: plan.undoable.round },
      ];
      break;
    }
  }
  m.guide = guide;
  m.version++;
  return guide;
}
