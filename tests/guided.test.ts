import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Backend, CommandName } from '../packages/application/src/index.js';
import {
  evaluateTurn,
  matchById,
  matchStandings,
  roundHistory,
  roundProgress,
  turnPlan,
  type DartThrow,
  type GameMode,
  type Tournament,
} from '../packages/domain/src/index.js';
import { setup } from './helpers.js';

const S = (sector: number): DartThrow => ({ kind: 'single', sector });
const D = (sector: number): DartThrow => ({ kind: 'double', sector });
const T = (sector: number): DartThrow => ({ kind: 'triple', sector });
const MISS: DartThrow = { kind: 'miss', sector: null };
const UNSEEN: DartThrow = { kind: 'unobserved', sector: null };
const B50: DartThrow = { kind: 'bull50', sector: null };

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'NO_ERROR';
};
function run(
  backend: Backend,
  t: Tournament,
  name: CommandName,
  body: Record<string, unknown> = {},
  matchId?: string,
  key = randomUUID(),
) {
  const m = matchId ? matchById(t, matchId) : undefined;
  return backend.execute(
    name,
    t.id,
    { expectedVersion: t.version, ...(m ? { expectedMatchVersion: m.version } : {}), ...body },
    { matchId, idempotencyKey: key },
  );
}
/** A started match of the given units (player names), rounds tracked. */
function game(
  units: string[][],
  options: {
    gameMode?: GameMode;
    mode?: Tournament['mode'];
    tracking?: Tournament['tracking'];
    config?: Record<string, unknown>;
  } = {},
) {
  const { backend } = setup();
  const people = new Map<string, string>();
  for (const name of units.flat()) people.set(name, backend.createPlayer({ displayName: name }).id);
  let t = backend.createTournament({
    name: 'Serata guidata',
    mode: options.mode ?? 'SINGLE_MATCH',
    gameMode: options.gameMode ?? 'HI_SCORE',
    tracking: options.tracking ?? 'FLEXIBLE',
    tournamentConfiguration: options.config ?? {},
  });
  t = run(backend, t, 'ComposeEntries', {
    entries: units.map((names) => ({ playerIds: names.map((n) => people.get(n)!) })),
  });
  t = run(backend, t, 'StartTournament');
  const byId = new Map([...people].map(([n, id]) => [id, n]));
  return {
    backend,
    t,
    m: t.matches[0]!.id,
    who: (playerId: string | null | undefined) => (playerId ? byId.get(playerId) : null),
    entry: (name: string) =>
      t.entries.find((e) => e.members.some((x) => x.playerId === people.get(name)))!.id,
  };
}
const planOf = (t: Tournament, m: string, heatId?: string) =>
  turnPlan(t, matchById(t, m), heatId ?? null);
/** Confirms the turn at the board, as the guided screen does. */
function confirm(
  backend: Backend,
  t: Tournament,
  m: string,
  input: { darts?: DartThrow[]; value?: number | null; reason?: string } = {},
  heatId?: string,
) {
  const current = planOf(t, m, heatId).current!;
  return run(
    backend,
    t,
    'RecordTurn',
    { entryId: current.entryId, round: current.round, ...input },
    m,
  );
}

describe('Scenario A: guided Hi-Score of four singles over seven rounds', () => {
  it('follows the throwing order round after round until the end', () => {
    let { backend, t, m, who } = game([['Frank'], ['Salvo'], ['Marco'], ['Luca']]);
    let plan = planOf(t, m);
    expect(plan).toMatchObject({ state: 'ready', round: 1, thrown: 0, expected: 28 });
    expect(who(plan.current!.playerId)).toBe('Frank');
    expect(who(plan.next!.playerId)).toBe('Salvo');
    const order: string[] = [];
    for (let i = 0; i < 28; i++) {
      plan = planOf(t, m);
      order.push(`${who(plan.current!.playerId)}${plan.current!.round}`);
      t = confirm(backend, t, m, { darts: [T(20), S(20), S(5)] });
    }
    expect(order.slice(0, 6)).toEqual(['Frank1', 'Salvo1', 'Marco1', 'Luca1', 'Frank2', 'Salvo2']);
    expect(order.at(-1)).toBe('Luca7');
    plan = planOf(t, m);
    expect(plan).toMatchObject({ state: 'completed', current: null, thrown: 28, gaps: [] });
    for (const e of t.entries)
      expect(roundProgress(t, matchById(t, m), e.id)).toMatchObject({
        complete: true,
        computed: 7 * 85,
      });
    // The totals stay provisional: the official result is still the totem's.
    expect(matchById(t, m).result).toBeNull();
  });
  it('proposes the next player in the CTA and moves on only after a save', () => {
    let { backend, t, m, who } = game([['Frank'], ['Salvo'], ['Marco'], ['Luca']]);
    t = confirm(backend, t, m, { darts: [S(20), S(20), S(20)] });
    const plan = planOf(t, m);
    expect(who(plan.current!.playerId)).toBe('Salvo');
    expect(plan.before).toBe(0);
    // A refused save (invalid darts) leaves the turn where it was.
    expect(code(() => confirm(backend, t, m, { darts: [S(20), S(20)] }))).toBe('DARTS_INCOMPLETE');
    expect(who(planOf(t, m).current!.playerId)).toBe('Salvo');
  });
});

describe('Scenario B: a dart off the board', () => {
  it('records single 20, miss, triple 20 as 80', () => {
    let { backend, t, m, entry } = game([['Frank'], ['Salvo']]);
    t = confirm(backend, t, m, { darts: [S(20), MISS, T(20)] });
    const round = roundProgress(t, matchById(t, m), entry('Frank')).rounds[0]!;
    expect(round).toMatchObject({ value: 80, state: 'complete', dartsValue: 80 });
    expect(round.darts).toEqual([S(20), MISS, T(20)]);
  });
  it('keeps a miss, a zero by rule, an unobserved dart and an unused dart apart', () => {
    // Miss: on the record, worth zero.
    expect(
      evaluateTurn({ game: 'HI_SCORE', round: 1, remaining: null }, [MISS, MISS, MISS]),
    ).toMatchObject({
      points: 0,
      scores: [0, 0, 0],
    });
    // Zero by rule: Shanghai round 3 counts only the 3s.
    expect(
      evaluateTurn({ game: 'SHANGHAI', round: 3, remaining: null }, [T(20), S(3), MISS]),
    ).toMatchObject({ points: 3, scores: [0, 3, 0] });
    // Unobserved: never zero, the turn stays undecided.
    expect(
      evaluateTurn({ game: 'HI_SCORE', round: 1, remaining: null }, [S(20), UNSEEN, S(1)]),
    ).toMatchObject({ points: null, unknown: 'unobserved', scores: [20, null, 1] });
    // Unused: the turn ended on the first dart, nothing else is recorded.
    expect(evaluateTurn({ game: '501', round: 9, remaining: 40 }, [D(20)])).toMatchObject({
      points: 40,
      closed: true,
      endedAt: 0,
      complete: true,
    });
  });
  it('asks the totem for a turn with an unobserved dart, and keeps a partial turn apart', () => {
    let { backend, t, m, entry } = game([['Frank'], ['Salvo']]);
    expect(code(() => confirm(backend, t, m, { darts: [S(20), UNSEEN, S(1)] }))).toBe(
      'VALUE_REQUIRED',
    );
    t = confirm(backend, t, m, { darts: [S(20), UNSEEN, S(1)], value: 41 });
    expect(roundProgress(t, matchById(t, m), entry('Frank')).rounds[0]).toMatchObject({
      value: 41,
      state: 'complete',
      dartsValue: null,
    });
    // Salvo: two darts seen, the total not known. Not a complete round, not zero.
    t = confirm(backend, t, m, { darts: [S(20), S(20), UNSEEN], value: null });
    const salvo = roundProgress(t, matchById(t, m), entry('Salvo'));
    expect(salvo.rounds[0]).toMatchObject({ status: 'skipped', state: 'partial', value: null });
    expect(salvo.partialValue).toBeNull();
    expect(salvo.complete).toBe(false);
  });
  it('refuses darts that contradict the value unless the difference is explained', () => {
    let { backend, t, m, entry } = game([['Frank'], ['Salvo']]);
    expect(code(() => confirm(backend, t, m, { darts: [S(20), MISS, T(20)], value: 85 }))).toBe(
      'DARTS_MISMATCH',
    );
    t = confirm(backend, t, m, {
      darts: [S(20), MISS, T(20)],
      value: 85,
      reason: 'Il totem segna 85',
    });
    expect(roundProgress(t, matchById(t, m), entry('Frank')).rounds[0]).toMatchObject({
      value: 85,
      state: 'review',
      dartsValue: 80,
    });
  });
});

describe('Scenario C: quick total', () => {
  it('saves 85 without inventing the darts', () => {
    let { backend, t, m, entry } = game([['Frank'], ['Salvo']]);
    t = confirm(backend, t, m, { value: 85 });
    const record = matchById(t, m).rounds[0]!;
    expect(record).toMatchObject({ value: 85, darts: null, status: 'recorded' });
    expect(roundProgress(t, matchById(t, m), entry('Frank')).rounds[0]).toMatchObject({
      state: 'complete',
      darts: null,
      dartsValue: null,
    });
  });
});

describe('Scenario D: corrections never move the turn at the board', () => {
  it('corrects an earlier turn, keeps the history, the current turn and the rotation', () => {
    let { backend, t, m, who, entry } = game([
      ['Frank', 'Marco'],
      ['Salvo', 'Luca'],
    ]);
    const a = entry('Frank');
    t = confirm(backend, t, m, { darts: [S(20), S(20), S(20)] });
    t = confirm(backend, t, m, { value: 45 });
    t = confirm(backend, t, m, { value: 26 });
    let plan = planOf(t, m);
    expect([who(plan.current!.playerId), plan.current!.round]).toEqual(['Luca', 2]);
    const rotations = structuredClone(matchById(t, m).rotations);
    // Frank's round 1 was misread: 60 becomes 100 (the darts stay, flagged for review).
    t = run(backend, t, 'RecordRound', { entryId: a, round: 1, value: 100 }, m);
    const progress = roundProgress(t, matchById(t, m), a);
    expect(progress.rounds[0]).toMatchObject({
      value: 100,
      corrected: true,
      state: 'review',
      dartsValue: 60,
      playerId: matchById(t, m).rounds[0]!.playerId,
    });
    expect(roundHistory(matchById(t, m), a).map((r) => [r.round, r.value, r.status])).toEqual([
      [1, 60, 'corrected'],
      [2, 26, 'recorded'],
      [1, 100, 'recorded'],
    ]);
    plan = planOf(t, m);
    expect([who(plan.current!.playerId), plan.current!.round]).toEqual(['Luca', 2]);
    expect(matchById(t, m).rotations).toEqual(rotations);
    // Annulling it does not move the turn either: the round waits to be entered again.
    t = run(backend, t, 'VoidRound', { entryId: a, round: 1, reason: 'Da verificare' }, m);
    plan = planOf(t, m);
    expect([who(plan.current!.playerId), plan.current!.round]).toEqual(['Luca', 2]);
    expect(plan.gaps).toEqual([{ entryId: a, round: 1 }]);
    expect(roundProgress(t, matchById(t, m), a).rounds[0]!.state).toBe('reenter');
    // Restoring the gap from the matrix keeps the thrower of round 1 (Frank).
    t = run(backend, t, 'RecordRound', { entryId: a, round: 1, value: 60 }, m);
    expect(who(roundProgress(t, matchById(t, m), a).rounds[0]!.playerId)).toBe('Frank');
    expect(matchById(t, m).rotations).toEqual(rotations);
  });
  it('takes back the last turns with undo and proposes them again in order', () => {
    let { backend, t, m, who } = game([['Frank'], ['Salvo'], ['Marco']]);
    t = confirm(backend, t, m, { value: 60 });
    t = confirm(backend, t, m, { value: 45 });
    t = run(backend, t, 'GuideTurn', { action: 'undo' }, m);
    t = run(backend, t, 'GuideTurn', { action: 'undo' }, m);
    let plan = planOf(t, m);
    expect([who(plan.current!.playerId), who(plan.next!.playerId)]).toEqual(['Frank', 'Salvo']);
    t = confirm(backend, t, m, { value: 61 });
    plan = planOf(t, m);
    expect(who(plan.current!.playerId)).toBe('Salvo');
    t = confirm(backend, t, m, { value: 46 });
    expect(who(planOf(t, m).current!.playerId)).toBe('Marco');
    // Both values replaced the annulled ones, which stay in the history.
    expect(matchById(t, m).rounds.map((r) => [r.value, r.status])).toEqual([
      [60, 'voided'],
      [45, 'voided'],
      [61, 'recorded'],
      [46, 'recorded'],
    ]);
  });
  it('picks a turn by hand, pauses and resumes the rotation', () => {
    let { backend, t, m, who, entry } = game([['Frank'], ['Salvo'], ['Marco']]);
    t = run(backend, t, 'GuideTurn', { action: 'pick', entryId: entry('Marco') }, m);
    expect(who(planOf(t, m).current!.playerId)).toBe('Marco');
    t = confirm(backend, t, m, { value: 60 });
    // Frank and Salvo were passed: they wait as gaps, the turn goes on after Marco.
    let plan = planOf(t, m);
    expect([who(plan.current!.playerId), plan.current!.round]).toEqual(['Frank', 2]);
    expect(plan.gaps.map((g) => g.entryId)).toEqual([entry('Frank'), entry('Salvo')]);
    t = run(backend, t, 'GuideTurn', { action: 'pause' }, m);
    plan = planOf(t, m);
    expect(plan).toMatchObject({ state: 'paused', current: null });
    expect(
      code(() => run(backend, t, 'RecordTurn', { entryId: entry('Frank'), round: 2, value: 1 }, m)),
    ).toBe('TURN_MOVED');
    t = run(backend, t, 'GuideTurn', { action: 'resume' }, m);
    expect(who(planOf(t, m).current!.playerId)).toBe('Frank');
    expect(
      code(() =>
        run(backend, t, 'GuideTurn', { action: 'pick', entryId: entry('Marco'), round: 1 }, m),
      ),
    ).toBe('ALREADY_RECORDED');
  });
});

describe('Scenario E: uneven teams', () => {
  it('rotates the actual throwers of three pairs and a single', () => {
    let { backend, t, m, who } = game(
      [['Frank', 'Marco'], ['Salvo', 'Luca'], ['Giulia', 'Nico'], ['Elena']],
      { mode: 'SINGLE_MATCH' },
    );
    const throwers: string[] = [];
    for (let i = 0; i < 12; i++) {
      throwers.push(who(planOf(t, m).current!.playerId)!);
      t = confirm(backend, t, m, { value: 40 });
    }
    expect(throwers).toEqual([
      'Frank',
      'Salvo',
      'Giulia',
      'Elena',
      'Marco',
      'Luca',
      'Nico',
      'Elena',
      'Frank',
      'Salvo',
      'Giulia',
      'Elena',
    ]);
    // The recorded thrower of every round is the one who was expected.
    const rounds = matchById(t, m).rounds;
    expect(rounds.map((r) => who(r.playerId))).toEqual(throwers);
    // The next thrower after a team's turn is announced correctly.
    const plan = planOf(t, m);
    expect([who(plan.current!.playerId), who(plan.next!.playerId)]).toEqual(['Marco', 'Luca']);
  });
});

describe('Scenario F: seventeen Hi-Score entries over several heats', () => {
  it('plays every heat in order and ranks everyone together', () => {
    const names = Array.from({ length: 17 }, (_, i) => [`P${i + 1}`]);
    let { backend, t, m, entry } = game(names, { mode: 'QUICK_HIGH_SCORE' });
    const heats = matchById(t, m).heats;
    expect(heats.map((h) => h.entryIds.length)).toEqual([4, 4, 4, 4, 1]);
    const value = (id: string, round: number) =>
      20 + t.entries.findIndex((e) => e.id === id) + round;
    for (const heat of heats) {
      let plan = planOf(t, m, heat.id);
      expect(plan.expected).toBe(heat.entryIds.length * 7);
      while (plan.current) {
        t = confirm(
          backend,
          t,
          m,
          { value: value(plan.current.entryId, plan.current.round) },
          heat.id,
        );
        plan = planOf(t, m, heat.id);
      }
      expect(plan.state).toBe('completed');
      // The totem shows the same totals: enter them as the official results.
      for (const id of heat.entryIds) {
        const computed = roundProgress(t, matchById(t, m), id).computed!;
        t = run(backend, t, 'RecordResult', { scores: { [id]: computed } }, m);
      }
      expect(matchById(t, m).heats.find((h) => h.id === heat.id)!.status).toBe('completed');
    }
    const standings = matchStandings(t, matchById(t, m));
    expect(standings).toHaveLength(17);
    expect(standings[0]!.tournamentEntryId).toBe(entry('P17'));
    expect(standings.at(-1)!.tournamentEntryId).toBe(entry('P1'));
  });
});

describe('Scenario G: X01', () => {
  const x01 = (gameMode: GameMode, x01Entry: 'SCORED' | 'REMAINING') =>
    game([['Frank'], ['Salvo']], { gameMode, config: { x01Entry } });
  it('records darts, points left, a bust and a checkout with fewer darts (points scored)', () => {
    let { backend, t, m, entry } = x01('501', 'SCORED');
    const f = entry('Frank');
    t = confirm(backend, t, m, { darts: [T(20), T(20), T(20)] }); // Frank 321
    t = confirm(backend, t, m, { value: 180 }); // Salvo 321
    expect(planOf(t, m).before).toBe(321);
    t = confirm(backend, t, m, { darts: [T(20), T(20), T(20)] }); // 141
    t = confirm(backend, t, m, { value: 180 }); // Salvo 141
    t = confirm(backend, t, m, { darts: [T(20), T(19), D(12)] }); // 141 - 141 = 0 on the third
    expect(roundProgress(t, matchById(t, m), f)).toMatchObject({ partialValue: 0 });
    let plan = planOf(t, m);
    expect(plan.closed).toEqual([{ entryId: f, round: 3 }]);
    // Salvo goes on alone, then busts with 21 left.
    t = confirm(backend, t, m, { darts: [T(20), T(20), MISS] }); // 21 left
    plan = planOf(t, m);
    expect(plan.current).toMatchObject({ entryId: entry('Salvo'), round: 4 });
    expect(plan.before).toBe(21);
    // Unused darts after a bust are refused, then the bust is saved with one dart: worth 0.
    expect(code(() => confirm(backend, t, m, { darts: [T(20), MISS, MISS] }))).toBe(
      'DARTS_AFTER_END',
    );
    t = confirm(backend, t, m, { darts: [T(20)] });
    const salvo = roundProgress(t, matchById(t, m), entry('Salvo'));
    expect(salvo.rounds[3]).toMatchObject({ value: 0, state: 'early', darts: [T(20)], bust: true });
    // The darts set the same persisted flag as a declared bust.
    expect(matchById(t, m).rounds.at(-1)).toMatchObject({ bust: true, reason: 'Eccesso' });
    expect(salvo.partialValue).toBe(21);
  });
  it('keeps points left (REMAINING) and recalculates after a correction', () => {
    let { backend, t, m, entry } = x01('301', 'REMAINING');
    const f = entry('Frank');
    t = confirm(backend, t, m, { darts: [T(20), S(20), S(1)] }); // 301 - 81 = 220
    expect(matchById(t, m).rounds[0]!.value).toBe(220);
    t = confirm(backend, t, m, { value: 250 });
    t = confirm(backend, t, m, { darts: [S(20), S(20), S(20)] }); // 160
    // Round 1 was 85, not 81: the points left of round 1 are corrected by hand.
    t = run(
      backend,
      t,
      'RecordRound',
      { entryId: f, round: 1, value: 216, darts: [T(20), S(20), S(5)] },
      m,
    );
    const rounds = roundProgress(t, matchById(t, m), f).rounds;
    expect(rounds[0]).toMatchObject({ value: 216, state: 'complete' });
    // Round 2 now reads 216 - 60 = 156 from its darts, not 160: flagged, never changed silently.
    expect(rounds[1]).toMatchObject({ value: 160, dartsValue: 156, state: 'review' });
  });
  it('records one bust flag from the darts or declared without them', () => {
    let { backend, t, m, entry } = x01('501', 'REMAINING');
    const f = entry('Frank');
    t = confirm(backend, t, m, { darts: [T(20), T(20), T(20)] }); // Frank 321
    t = confirm(backend, t, m, { value: 400 });
    // Declared bust, no darts: the points left stay 321.
    t = confirm(backend, t, m, { bust: true } as never);
    let rounds = roundProgress(t, matchById(t, m), f).rounds;
    expect(rounds[1]).toMatchObject({ value: 321, bust: true, state: 'complete' });
    expect(matchById(t, m).rounds.at(-1)).toMatchObject({ bust: true, reason: 'Eccesso' });
  });
  it('declares a bust only in X01, never with a value', () => {
    const hs = game([['Frank'], ['Salvo']]);
    expect(code(() => confirm(hs.backend, hs.t, hs.m, { bust: true } as never))).toBe(
      'INVALID_ROUND',
    );
    const { backend, t, m } = x01('501', 'SCORED');
    expect(code(() => confirm(backend, t, m, { bust: true, value: 60 } as never))).toBe(
      'INVALID_ROUND',
    );
    const saved = confirm(backend, t, m, { bust: true } as never);
    expect(matchById(saved, m).rounds[0]).toMatchObject({
      value: 0,
      bust: true,
      status: 'recorded',
    });
  });
  it('does not guess points left after a missing round', () => {
    let { backend, t, m } = x01('501', 'SCORED');
    t = confirm(backend, t, m, { value: null }); // Frank not observed
    t = confirm(backend, t, m, { value: 60 });
    expect(planOf(t, m).before).toBeNull();
    expect(code(() => confirm(backend, t, m, { darts: [T(20), T(20), T(20)] }))).toBe(
      'VALUE_REQUIRED',
    );
    t = confirm(backend, t, m, { darts: [T(20), T(20), T(20)], value: 180 });
    expect(matchById(t, m).rounds.at(-1)!.value).toBe(180);
  });
  it('applies Double In/Out and Masters only to what was observed', () => {
    const ev = (game: GameMode, remaining: number | null, darts: DartThrow[]) =>
      evaluateTurn({ game, round: 1, remaining }, darts);
    // Not opened: nothing counts before the double.
    expect(ev('301_DOUBLE_IN_OUT', 301, [S(20), D(10), S(5)])).toMatchObject({
      points: 25,
      scores: [0, 20, 5],
    });
    // Closing on a single is a bust; 1 left is a bust.
    expect(ev('301_DOUBLE_IN_OUT', 40, [S(20), S(20)])).toMatchObject({ bust: true, points: 0 });
    expect(ev('301_DOUBLE_IN_OUT', 21, [S(20)])).toMatchObject({ bust: true, endedAt: 0 });
    expect(ev('301_DOUBLE_IN_OUT', 40, [D(20)])).toMatchObject({ closed: true, points: 40 });
    // Masters closes on double, triple or bull 50.
    expect(ev('301_MASTERS', 60, [T(20)])).toMatchObject({ closed: true });
    expect(ev('301_MASTERS', 50, [B50])).toMatchObject({ closed: true });
    expect(ev('301_MASTERS', 20, [S(20)])).toMatchObject({ bust: true });
    // Unknown points left: nothing decided.
    expect(ev('301_DOUBLE_IN_OUT', null, [D(20), S(1), S(1)])).toMatchObject({
      points: null,
      unknown: 'remaining',
    });
  });
});

describe('Integrity of guided confirmations', () => {
  it('saves a double tap once and refuses a stale turn', () => {
    let { backend, t, m } = game([['Frank'], ['Salvo']]);
    const current = planOf(t, m).current!;
    const key = randomUUID();
    const body = { entryId: current.entryId, round: current.round, value: 60 };
    const first = run(backend, t, 'RecordTurn', body, m, key);
    expect(run(backend, t, 'RecordTurn', body, m, key)).toEqual(first);
    expect(matchById(first, m).rounds).toHaveLength(1);
    // A second tap with a new key: the versions moved on.
    expect(code(() => run(backend, t, 'RecordTurn', body, m))).toBe('VERSION_CONFLICT');
    // A screen still showing Frank after the turn moved: refused, nothing written.
    t = first;
    expect(code(() => run(backend, t, 'RecordTurn', body, m))).toBe('TURN_MOVED');
    expect(matchById(t, m).rounds).toHaveLength(1);
  });
  it('requires an idempotency key for a guided confirmation', () => {
    const { backend, t, m } = game([['Frank'], ['Salvo']]);
    const current = planOf(t, m).current!;
    expect(
      code(() =>
        backend.execute(
          'RecordTurn',
          t.id,
          {
            expectedVersion: t.version,
            expectedMatchVersion: matchById(t, m).version,
            entryId: current.entryId,
            round: current.round,
            value: 1,
          },
          { matchId: m },
        ),
      ),
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('detects a Shanghai and ends the game on it', () => {
    let { backend, t, m, entry } = game([['Frank'], ['Salvo']], { gameMode: 'SHANGHAI' });
    t = confirm(backend, t, m, { darts: [S(1), D(1), T(1)] });
    const plan = planOf(t, m);
    expect(plan).toMatchObject({
      state: 'completed',
      shanghai: { entryId: entry('Frank'), round: 1 },
    });
  });
});
