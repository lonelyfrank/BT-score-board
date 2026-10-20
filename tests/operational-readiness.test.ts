import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Backend, CommandName } from '../packages/application/src/index.js';
import {
  buildTeams,
  checkComposition,
  heatOverview,
  matchById,
  matchStandings,
  planHeats,
  roundHistory,
  roundProgress,
  type Tournament,
} from '../packages/domain/src/index.js';
import { setup } from './helpers.js';

// V1.2 operational readiness: the cases of a real evening, at the domain and application level.
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const sizes = (groups: unknown[][]) => groups.map((g) => g.length);
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
) {
  const m = matchId ? matchById(t, matchId) : undefined;
  return backend.execute(
    name,
    t.id,
    { expectedVersion: t.version, ...(m ? { expectedMatchVersion: m.version } : {}), ...body },
    { matchId, idempotencyKey: randomUUID() },
  );
}
const players = (backend: Backend, count: number, name = 'Player') =>
  Array.from(
    { length: count },
    (_, i) => backend.createPlayer({ displayName: `${name} ${i + 1}` }).id,
  );
function tournament(
  backend: Backend,
  units: string[][],
  options: {
    mode?: Tournament['mode'];
    tracking?: Tournament['tracking'];
    config?: Record<string, unknown>;
    start?: boolean;
  } = {},
) {
  let t = backend.createTournament({
    name: 'Serata al Bite the Trouble',
    mode: options.mode ?? 'QUICK_HIGH_SCORE',
    gameMode: 'HI_SCORE',
    tracking: options.tracking ?? 'FINAL_ONLY',
    tournamentConfiguration: options.config ?? {},
  });
  t = run(backend, t, 'ComposeEntries', { entries: units.map((playerIds) => ({ playerIds })) });
  return options.start === false ? t : run(backend, t, 'StartTournament');
}
const score = (backend: Backend, t: Tournament, m: string, scores: Record<string, number>) => {
  for (const [entryId, value] of Object.entries(scores))
    t = run(backend, t, 'RecordResult', { scores: { [entryId]: value } }, m);
  return t;
};

describe('Participants and teams of a real evening', () => {
  it('keeps players with the same name apart and refuses a player twice', () => {
    const backend = setup().backend;
    const a = backend.createPlayer({ displayName: 'Marco' }).id;
    const b = backend.createPlayer({ displayName: 'Marco' }).id;
    expect(a).not.toBe(b);
    let t = backend.createTournament({ name: 'x', mode: 'QUICK_HIGH_SCORE' });
    t = run(backend, t, 'RegisterPlayer', { playerId: a });
    t = run(backend, t, 'RegisterPlayer', { playerId: b });
    expect(t.entries.map((e) => e.playerId)).toEqual([a, b]);
    expect(code(() => run(backend, t, 'RegisterPlayer', { playerId: a }))).toBe('DUPLICATE_ENTRY');
    // A registered player is reused by another tournament without being created again.
    const other = run(
      backend,
      backend.createTournament({ name: 'y', mode: 'QUICK_HIGH_SCORE' }),
      'RegisterPlayer',
      { playerId: a },
    );
    expect(other.entries[0]!.playerId).toBe(a);
    expect(backend.store.listPlayers({ limit: 10, offset: 0 }).total).toBe(2);
  });
  it('composes 9 players into uneven teams and starts with them', () => {
    expect(
      sizes(buildTeams(ids(9), { teamSize: 2, strategy: 'sequential' }).map((x) => x.playerIds)),
    ).toEqual([2, 2, 2, 2, 1]);
    const fours = buildTeams(ids(9), { teamSize: 4, strategy: 'balanced' });
    expect(sizes(fours.map((x) => x.playerIds))).toEqual([3, 3, 3]);
    expect(checkComposition(fours, ids(9)).errors).toEqual([]);
    const backend = setup().backend;
    const p = players(backend, 9);
    const t = tournament(backend, [p.slice(0, 4), p.slice(4, 7), p.slice(7)]);
    expect(t.entries.map((e) => e.members.length)).toEqual([4, 3, 2]);
    // Three units fit one session of the totem: no heats.
    expect(t.matches[0]!.heats).toEqual([]);
  });
  it('composes 16 players into four teams of four', () => {
    const teams = buildTeams(ids(16), { teamSize: 4, strategy: 'random' });
    expect(sizes(teams.map((x) => x.playerIds))).toEqual([4, 4, 4, 4]);
    expect(checkComposition(teams, ids(16))).toMatchObject({ errors: [], warnings: [] });
  });
  it('splits 19 players in pairs into ten units and three heats', () => {
    const pairs = buildTeams(ids(19), { teamSize: 2, strategy: 'sequential' });
    expect(sizes(pairs.map((x) => x.playerIds))).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 1]);
    const backend = setup().backend;
    const p = players(backend, 19);
    const units = pairs.map((x) => x.playerIds.map((id) => p[Number(id.slice(1)) - 1]!));
    const t = tournament(backend, units, { config: { heatStrategy: 'balanced' } });
    expect(sizes(t.matches[0]!.heats.map((h) => h.entryIds))).toEqual([4, 3, 3]);
    const sequential = tournament(
      backend,
      units.map((u) => u.slice()),
      {
        config: { heatStrategy: 'sequential' },
        start: false,
      },
    );
    expect(sequential.entries).toHaveLength(10);
  });
  it('removes a unit before the start and closes the composition afterwards', () => {
    const backend = setup().backend;
    const p = players(backend, 5);
    let t = tournament(backend, [p.slice(0, 2), p.slice(2, 4), [p[4]!]], { start: false });
    t = run(backend, t, 'UnregisterPlayer', { entryId: t.entries[2]!.id });
    expect(t.entries).toHaveLength(2);
    // The player who left is free again and could join another unit.
    t = run(backend, t, 'ComposeEntries', {
      entries: [{ playerIds: [p[0], p[1], p[4]] }, { playerIds: [p[2], p[3]] }],
    });
    expect(t.entries.map((e) => e.members.length)).toEqual([3, 2]);
    t = run(backend, t, 'StartTournament');
    expect(
      code(() =>
        run(backend, t, 'ComposeEntries', {
          entries: [{ playerIds: [p[0]] }, { playerIds: [p[1]] }],
        }),
      ),
    ).toBe('REGISTRATION_CLOSED');
    expect(code(() => run(backend, t, 'UnregisterPlayer', { entryId: t.entries[0]!.id }))).toBe(
      'REGISTRATION_CLOSED',
    );
  });
});

describe('Heats of a real evening', () => {
  it('plans 7, 16, 17 and 19 entries on four seats without dropping anyone', () => {
    expect(sizes(planHeats(ids(7), 4, 'balanced'))).toEqual([4, 3]);
    expect(sizes(planHeats(ids(16), 4, 'balanced'))).toEqual([4, 4, 4, 4]);
    expect(sizes(planHeats(ids(16), 4, 'sequential'))).toEqual([4, 4, 4, 4]);
    expect(sizes(planHeats(ids(17), 4, 'balanced'))).toEqual([4, 4, 3, 3, 3]);
    expect(sizes(planHeats(ids(19), 4, 'sequential'))).toEqual([4, 4, 4, 4, 3]);
    expect(sizes(planHeats(ids(5), 4, 'sequential'))).toEqual([4, 1]);
    expect(sizes(planHeats(ids(6), 4, 'sequential'))).toEqual([4, 2]);
  });
  it('plays a heat of one player and ranks everyone together', () => {
    const backend = setup().backend;
    const p = players(backend, 5);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { mode: 'SINGLE_MATCH', config: { heatStrategy: 'sequential' } },
    );
    const m = t.matches[0]!.id;
    const [first, second] = matchById(t, m).heats;
    expect(sizes([first!.entryIds, second!.entryIds])).toEqual([4, 1]);
    t = score(backend, t, m, Object.fromEntries(first!.entryIds.map((id, i) => [id, 300 + i])));
    expect(heatOverview(t, matchById(t, m))).toMatchObject({
      currentHeatId: null,
      nextHeatId: second!.id,
      completed: 1,
    });
    t = run(backend, t, 'StartHeat', { heatId: second!.id }, m);
    t = score(backend, t, m, { [second!.entryIds[0]!]: 450 });
    expect(matchById(t, m).status).toBe('completed');
    expect(matchStandings(t, matchById(t, m))[0]!.tournamentEntryId).toBe(second!.entryIds[0]);
  });
  it('never writes a value of the next heat while one is at the board', () => {
    const backend = setup().backend;
    const p = players(backend, 7);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { mode: 'SINGLE_MATCH' },
    );
    const m = t.matches[0]!.id;
    const [first, second] = matchById(t, m).heats;
    t = score(backend, t, m, { [first!.entryIds[0]!]: 500 });
    const before = matchById(t, m);
    expect(
      code(() => run(backend, t, 'RecordResult', { scores: { [second!.entryIds[0]!]: 400 } }, m)),
    ).toBe('HEAT_BUSY');
    // Nothing was written: the refused value is nowhere, the board is unchanged.
    const after = matchById(backend.tournament(t.id), m);
    expect(after.result!.scores).toEqual(before.result!.scores);
    expect(after.heats.map((h) => h.status)).toEqual(['active', 'pending']);
  });
});

describe('Rotation of the throwers', () => {
  function pair(tracking: Tournament['tracking'] = 'FLEXIBLE') {
    const backend = setup().backend;
    const p = players(backend, 4);
    const t = tournament(backend, [p.slice(0, 2), p.slice(2)], { mode: 'SINGLE_MATCH', tracking });
    return { backend, t, p, m: t.matches[0]!.id, team: t.entries[0]!.id };
  }
  const round = (
    backend: Backend,
    t: Tournament,
    m: string,
    entryId: string,
    n: number,
    value: number | null,
  ) => run(backend, t, 'RecordRound', { entryId, round: n, value, advanceRotation: true }, m);
  const current = (backend: Backend, m: string, team: string) =>
    backend.liveMatch(m).rotationViews.find((r) => r.entryId === team)!.current;

  it('keeps the thrower of a round when its value is corrected', () => {
    let { backend, t, p, m, team } = pair();
    t = round(backend, t, m, team, 1, 60);
    expect(current(backend, m, team)).toBe(p[1]);
    t = round(backend, t, m, team, 1, 45);
    const history = roundHistory(matchById(t, m), team);
    expect(history.map((r) => [r.value, r.status, r.playerId])).toEqual([
      [60, 'corrected', p[0]],
      [45, 'recorded', p[0]],
    ]);
    // A correction is not a new throw: the rotation stays where it was.
    expect(current(backend, m, team)).toBe(p[1]);
  });
  it('does not advance again when an annulled round is entered again', () => {
    let { backend, t, p, m, team } = pair();
    t = round(backend, t, m, team, 1, 60);
    t = run(backend, t, 'VoidRound', { entryId: team, round: 1, reason: 'Errore' }, m);
    expect(current(backend, m, team)).toBe(p[1]);
    t = round(backend, t, m, team, 1, 50);
    expect(current(backend, m, team)).toBe(p[1]);
    expect(matchById(t, m).rounds.at(-1)!.playerId).toBe(p[0]);
    // The next new round goes to the expected thrower and moves the rotation once.
    t = round(backend, t, m, team, 2, 40);
    expect(matchById(t, m).rounds.at(-1)!.playerId).toBe(p[1]);
    expect(current(backend, m, team)).toBe(p[0]);
  });
  it('advances once for a skipped round and keeps its position after a reload', () => {
    let { backend, t, p, m, team } = pair();
    t = round(backend, t, m, team, 1, null);
    expect(current(backend, m, team)).toBe(p[1]);
    // Same command tapped twice: one record, one advance.
    t = round(backend, t, m, team, 1, null);
    expect(matchById(t, m).rounds).toHaveLength(1);
    expect(current(backend, m, team)).toBe(p[1]);
    expect(matchById(backend.tournament(t.id), m).rotations[0]).toMatchObject({ position: 1 });
  });
});

describe('Official result against rounds', () => {
  it('ROUND_BY_ROUND waits for every round, then keeps both values on a difference', () => {
    const backend = setup().backend;
    const p = players(backend, 2);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { mode: 'SINGLE_MATCH', tracking: 'ROUND_BY_ROUND' },
    );
    const m = t.matches[0]!.id;
    const [a, b] = t.entries.map((e) => e.id);
    const rounds = matchById(t, m).scoringConfiguration.turns;
    for (let r = 1; r < rounds; r++)
      t = run(backend, t, 'RecordRound', { entryId: a, round: r, value: 50 }, m);
    expect(code(() => run(backend, t, 'RecordResult', { scores: { [a!]: 400 } }, m))).toBe(
      'ROUNDS_MISSING',
    );
    // The last round was not seen: skipped explicitly, the progression is not comparable.
    t = run(backend, t, 'RecordRound', { entryId: a, round: rounds, value: null }, m);
    t = run(backend, t, 'RecordResult', { scores: { [a!]: 400 } }, m);
    expect(matchById(t, m).result!.scores[a!]).toBe(400);
    for (let r = 1; r <= rounds; r++)
      t = run(backend, t, 'RecordRound', { entryId: b, round: r, value: 40 }, m);
    const computed = 40 * rounds;
    expect(
      code(() => run(backend, t, 'RecordResult', { scores: { [b!]: computed + 20 } }, m)),
    ).toBe('RESULT_DIFFERS_FROM_ROUNDS');
    const roundsBefore = structuredClone(matchById(t, m).rounds);
    t = run(
      backend,
      t,
      'RecordResult',
      { scores: { [b!]: computed + 20 }, reconciliation: { [b!]: 'R3 letto male' } },
      m,
    );
    const match = matchById(t, m);
    expect(match.result!.reconciliation).toMatchObject([
      { entryId: b, computed, official: computed + 20, reason: 'R3 letto male' },
    ]);
    // The rounds are never adjusted and the ranking uses the official value only.
    expect(match.rounds).toEqual(roundsBefore);
    expect(roundProgress(t, match, b!)).toMatchObject({ computed, official: computed + 20 });
    expect(matchStandings(t, match).map((r) => [r.tournamentEntryId, r.total])).toEqual([
      [a, 400],
      [b, computed + 20],
    ]);
  });
});

describe('Corrections of a qualification', () => {
  it('cancels a pending playoff only after confirmation', () => {
    const backend = setup().backend;
    const p = players(backend, 6);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { config: { qualifiers: 2, heatCapacity: 8 } },
    );
    const q = t.matches[0]!.id;
    const e = t.entries.map((x) => x.id);
    t = score(backend, t, q, {
      [e[0]!]: 600,
      [e[1]!]: 450,
      [e[2]!]: 450,
      [e[3]!]: 300,
      [e[4]!]: 200,
      [e[5]!]: 100,
    });
    t = run(backend, t, 'CreateTieBreak', { targetId: q, entryIds: [e[1], e[2]] });
    const playoff = t.matches.at(-1)!.id;
    expect(code(() => run(backend, t, 'RecordResult', { scores: { [e[2]!]: 460 } }, q))).toBe(
      'RESULT_HAS_DEPENDENTS',
    );
    expect(matchById(backend.tournament(t.id), playoff).status).not.toBe('cancelled');
    t = run(backend, t, 'RecordResult', { scores: { [e[2]!]: 460 }, confirmInvalidation: true }, q);
    expect(matchById(t, playoff).status).toBe('cancelled');
    t = run(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([e[0], e[2]]);
  });
});
