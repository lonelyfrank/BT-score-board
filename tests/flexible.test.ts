import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Backend, CommandName } from '../packages/application/src/index.js';
import {
  buildTeams,
  checkComposition,
  dissolveTeam,
  heatOverview,
  matchById,
  matchStandings,
  movePlayer,
  planHeats,
  renameTeam,
  reshuffleTeams,
  reverseTeam,
  roundHistory,
  roundProgress,
  seededRandom,
  setTeamLocked,
  singles,
  swapPlayers,
  swapTeams,
  type GameMode,
  type Tournament,
} from '../packages/domain/src/index.js';
import { setup } from './helpers.js';

const ids = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
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
function players(backend: Backend, count: number) {
  return Array.from(
    { length: count },
    (_, i) => backend.createPlayer({ displayName: `Player ${i + 1}` }).id,
  );
}
/** A tournament composed of the given units (arrays of player ids), started unless told not to. */
function tournament(
  backend: Backend,
  units: string[][],
  options: {
    mode?: Tournament['mode'];
    gameMode?: GameMode;
    tracking?: Tournament['tracking'];
    config?: Record<string, unknown>;
    start?: boolean;
  } = {},
) {
  let t = backend.createTournament({
    name: 'Serata al Bite the Trouble',
    mode: options.mode ?? 'QUICK_HIGH_SCORE',
    gameMode: options.gameMode ?? 'HI_SCORE',
    tracking: options.tracking ?? 'FINAL_ONLY',
    tournamentConfiguration: options.config ?? {},
  });
  t = run(backend, t, 'ComposeEntries', {
    entries: units.map((playerIds) => ({ playerIds })),
  });
  return options.start === false ? t : run(backend, t, 'StartTournament');
}
const entryOf = (t: Tournament, playerId: string) =>
  t.entries.find((e) => e.members.some((m) => m.playerId === playerId))!.id;
function score(backend: Backend, t: Tournament, matchId: string, scores: Record<string, number>) {
  for (const [entryId, value] of Object.entries(scores))
    t = run(backend, t, 'RecordResult', { scores: { [entryId]: value } }, matchId);
  return t;
}

describe('Teams and competitive units', () => {
  it('composes 7 players into three pairs and a single', () => {
    const teams = buildTeams(ids(7), { teamSize: 2, strategy: 'sequential' });
    expect(sizes(teams.map((t) => t.playerIds))).toEqual([2, 2, 2, 1]);
    const check = checkComposition(teams, ids(7));
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual(['UNEVEN_TEAMS']);

    const backend = setup().backend;
    const p = players(backend, 7);
    const t = tournament(backend, [[p[0]!, p[1]!], [p[2]!, p[3]!], [p[4]!, p[5]!], [p[6]!]], {
      mode: 'GROUPS',
      gameMode: '501',
      config: { groupCount: 1, qualifiersPerGroup: 2 },
      start: false,
    });
    expect(t.entries.map((e) => [e.kind, e.members.length])).toEqual([
      ['team', 2],
      ['team', 2],
      ['team', 2],
      ['single', 1],
    ]);
    expect(t.entries[0]!.displayNameAtRegistration).toBe('Player 1 + Player 2');
    expect(t.entries[3]!.displayNameAtRegistration).toBe('Player 7');
  });
  it('composes 8 players into four pairs and 11 players into uneven teams', () => {
    expect(
      sizes(buildTeams(ids(8), { teamSize: 2, strategy: 'random' }).map((t) => t.playerIds)),
    ).toEqual([2, 2, 2, 2]);
    const eleven = buildTeams(ids(11), { teamSize: 3, strategy: 'balanced' });
    expect(sizes(eleven.map((t) => t.playerIds))).toEqual([3, 3, 3, 2]);
    expect(checkComposition(eleven, ids(11))).toMatchObject({
      errors: [],
      warnings: ['UNEVEN_TEAMS'],
    });
    // The organizer confirms the uneven composition: the engine accepts it.
    const backend = setup().backend;
    const p = players(backend, 11);
    const t = tournament(backend, [p.slice(0, 4), p.slice(4, 7), p.slice(7, 9), p.slice(9)], {
      mode: 'GROUPS',
      gameMode: 'HI_SCORE',
      config: { groupCount: 1, qualifiersPerGroup: 2 },
    });
    expect(t.entries.map((e) => e.members.length)).toEqual([4, 3, 2, 2]);
    expect(t.status).toBe('active');
  });
  it('registers 19 singles without any limit tied to the totem', () => {
    const backend = setup().backend;
    const p = players(backend, 19);
    const t = tournament(
      backend,
      p.map((id) => [id]),
    );
    expect(t.entries).toHaveLength(19);
    expect(t.matches[0]!.participants).toHaveLength(19);
    expect(sizes(t.matches[0]!.heats.map((h) => h.entryIds))).toEqual([4, 4, 4, 4, 3]);
  });
  it('generates random teams without duplicating or losing anyone, whatever the seed', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const players = ids(7 + (seed % 13));
      const teams = buildTeams(players, {
        teamSize: 1 + (seed % 4),
        strategy: 'random',
        random: seededRandom(seed),
      });
      const all = teams.flatMap((t) => t.playerIds);
      expect([...all].sort()).toEqual([...players].sort());
      expect(checkComposition(teams, players).errors).toEqual([]);
    }
    // Same seed, same draw: a composition can be reproduced.
    const a = buildTeams(ids(10), { teamSize: 2, strategy: 'random', random: seededRandom(7) });
    const b = buildTeams(ids(10), { teamSize: 2, strategy: 'random', random: seededRandom(7) });
    expect(a.map((t) => t.playerIds)).toEqual(b.map((t) => t.playerIds));
  });
  it('swaps players across teams and keeps locked groups through a reshuffle', () => {
    let teams = buildTeams(ids(8), { teamSize: 2, strategy: 'sequential', locked: [['p7', 'p8']] });
    expect(teams[0]).toMatchObject({ playerIds: ['p7', 'p8'], locked: true });
    teams = swapPlayers(teams, 'p1', 'p3');
    expect(teams[1]!.playerIds).toEqual(['p3', 'p2']);
    expect(teams[2]!.playerIds).toEqual(['p1', 'p4']);
    expect(code(() => swapPlayers(teams, 'p7', 'p1'))).toBe('TEAM_LOCKED');
    for (let seed = 1; seed <= 20; seed++) {
      const shuffled = reshuffleTeams(teams, 'random', seededRandom(seed));
      expect(shuffled[0]!.playerIds).toEqual(['p7', 'p8']);
      expect(sizes(shuffled.map((t) => t.playerIds))).toEqual([2, 2, 2, 2]);
      expect(checkComposition(shuffled, ids(8)).errors).toEqual([]);
    }
  });
  it('edits a generated composition by hand before confirming it', () => {
    let teams = buildTeams(ids(6), { teamSize: 2, strategy: 'sequential' });
    const [a, b, c] = teams.map((t) => t.key);
    teams = reverseTeam(teams, a!);
    expect(teams[0]!.playerIds).toEqual(['p2', 'p1']);
    teams = movePlayer(teams, 'p3', a!);
    expect(teams[0]!.playerIds).toEqual(['p2', 'p1', 'p3']);
    expect(teams[1]!.playerIds).toEqual(['p4']);
    teams = swapTeams(teams, a!, c!);
    expect(teams[0]!.key).toBe(c);
    teams = renameTeam(teams, b!, '  I Bersaglieri ');
    expect(teams.find((t) => t.key === b)!.name).toBe('I Bersaglieri');
    teams = dissolveTeam(teams, a!);
    expect(teams.filter((t) => t.playerIds.length === 1)).toHaveLength(4);
    teams = setTeamLocked(teams, c!, true);
    expect(checkComposition(teams, ids(6)).errors).toEqual([]);
    expect(checkComposition(singles(ids(5)), ids(6)).errors).toEqual(['MISSING_PLAYER']);
  });
  it('refuses a player in two units, at the engine and in the database', () => {
    const { backend, store } = setup();
    const p = players(backend, 3);
    const t = backend.createTournament({
      name: 'x',
      mode: 'GROUPS',
      tournamentConfiguration: { groupCount: 1 },
    });
    expect(
      code(() =>
        run(backend, t, 'ComposeEntries', {
          entries: [{ playerIds: [p[0], p[1]] }, { playerIds: [p[1], p[2]] }],
        }),
      ),
    ).toBe('DUPLICATE_ENTRY');
    const composed = run(backend, t, 'ComposeEntries', {
      entries: [{ playerIds: [p[0], p[1]], name: 'Coppia' }, { playerIds: [p[2]] }],
    });
    expect(composed.entries[0]).toMatchObject({
      name: 'Coppia',
      displayNameAtRegistration: 'Coppia',
    });
    // A recomposition replaces the previous one: no stale rows block the players.
    const again = run(backend, composed, 'ComposeEntries', {
      entries: [{ playerIds: [p[1], p[0]] }, { playerIds: [p[2]] }],
    });
    expect(again.entries[0]!.playerId).toBe(p[1]);
    expect(
      store.sqlite
        .prepare('SELECT count(*) n FROM entry_members WHERE tournament_id = ?')
        .get(t.id),
    ).toEqual({ n: 3 });
    expect(() =>
      store.sqlite
        .prepare(
          'INSERT INTO entry_members (tournament_id, entry_id, player_id, position) VALUES (?, ?, ?, 2)',
        )
        .run(t.id, again.entries[1]!.id, p[0]),
    ).toThrow(/UNIQUE/);
    // Composition is closed once the tournament starts.
    const started = run(backend, again, 'StartTournament');
    expect(
      code(() => run(backend, started, 'ComposeEntries', { entries: [{ playerIds: [p[0]] }] })),
    ).toBe('REGISTRATION_CLOSED');
  });
});

describe('Heats', () => {
  it('plans heats that need not be full', () => {
    expect(sizes(planHeats(ids(3), 4, 'balanced'))).toEqual([3]);
    expect(sizes(planHeats(ids(7), 4, 'balanced'))).toEqual([4, 3]);
    expect(sizes(planHeats(ids(17), 4, 'balanced'))).toEqual([4, 4, 3, 3, 3]);
    expect(sizes(planHeats(ids(17), 4, 'sequential'))).toEqual([4, 4, 4, 4, 1]);
    expect(sizes(planHeats(ids(19), 4, 'sequential'))).toEqual([4, 4, 4, 4, 3]);
    expect(sizes(planHeats(ids(19), 4, 'balanced'))).toEqual([4, 4, 4, 4, 3]);
    expect(planHeats(ids(19), 4, 'sequential').flat()).toEqual(ids(19));
    const random = planHeats(ids(19), 4, 'random', seededRandom(3));
    expect(random.flat().sort()).toEqual(ids(19).sort());
    expect(code(() => planHeats(ids(3), 0, 'balanced'))).toBe('INVALID_HEAT_CAPACITY');
  });
  it('plays a free Hi-Score match of 7 players over two heats, with one global ranking', () => {
    const backend = setup().backend;
    const p = players(backend, 7);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { mode: 'SINGLE_MATCH' },
    );
    const m = t.matches[0]!;
    expect(sizes(m.heats.map((h) => h.entryIds))).toEqual([4, 3]);
    t = run(backend, t, 'StartMatch', {}, m.id);
    expect(matchById(t, m.id).heats.map((h) => h.status)).toEqual(['active', 'pending']);
    // A player of the second heat cannot be recorded while the first is at the board.
    expect(
      code(() => run(backend, t, 'RecordResult', { scores: { [entryOf(t, p[5]!)]: 300 } }, m.id)),
    ).toBe('HEAT_BUSY');
    // Over several heats the scores rank: a declared winner is refused.
    expect(
      code(() => run(backend, t, 'RecordResult', { winnerEntryId: entryOf(t, p[0]!) }, m.id)),
    ).toBe('INVALID_RESULT');
    t = score(backend, t, m.id, {
      [entryOf(t, p[0]!)]: 300,
      [entryOf(t, p[1]!)]: 410,
      [entryOf(t, p[2]!)]: 250,
      [entryOf(t, p[3]!)]: 390,
    });
    expect(matchById(t, m.id).heats.map((h) => h.status)).toEqual(['completed', 'pending']);
    t = score(backend, t, m.id, {
      [entryOf(t, p[4]!)]: 505,
      [entryOf(t, p[5]!)]: 120,
      [entryOf(t, p[6]!)]: 380,
    });
    expect(t.status).toBe('completed');
    expect(t.results.find((r) => r.finalPlacement === 1)!.tournamentEntryId).toBe(
      entryOf(t, p[4]!),
    );
  });
  it('accepts one-player Hi-Score practice, refuses more players than seats for winner games', () => {
    const backend = setup().backend;
    const p = players(backend, 5);
    let solo = tournament(backend, [[p[0]!]], { mode: 'SINGLE_MATCH' });
    solo = run(
      backend,
      solo,
      'RecordResult',
      { scores: { [solo.entries[0]!.id]: 420 } },
      solo.matches[0]!.id,
    );
    expect(solo.status).toBe('completed');
    const x01 = tournament(
      backend,
      p.map((id) => [id]),
      { mode: 'SINGLE_MATCH', gameMode: '501', start: false },
    );
    expect(code(() => run(backend, x01, 'StartTournament'))).toBe('INVALID_PLAYER_COUNT');
    // Two teams of two are two seats: an X01 match is fine.
    const teams = tournament(backend, [p.slice(0, 2), p.slice(2, 4)], {
      mode: 'SINGLE_MATCH',
      gameMode: '501',
    });
    expect(teams.status).toBe('active');
    expect(teams.matches[0]!.heats).toEqual([]);
  });
  it('arranges heats by hand: move, swap, merge, split, confirm', () => {
    const backend = setup().backend;
    const p = players(backend, 9);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { config: { heatStrategy: 'balanced' } },
    );
    const q = t.matches[0]!;
    expect(sizes(q.heats.map((h) => h.entryIds))).toEqual([3, 3, 3]);
    const [h1, h2, h3] = q.heats;
    // Swap the first entries of heats 1 and 2, move one entry of heat 3 to heat 1.
    t = run(
      backend,
      t,
      'ArrangeHeats',
      {
        heats: [
          {
            heatId: h1!.id,
            entryIds: [h2!.entryIds[0], ...h1!.entryIds.slice(1), h3!.entryIds[0]],
          },
          { heatId: h2!.id, entryIds: [h1!.entryIds[0], ...h2!.entryIds.slice(1)] },
          { heatId: h3!.id, entryIds: h3!.entryIds.slice(1) },
        ],
      },
      q.id,
    );
    expect(sizes(matchById(t, q.id).heats.map((h) => h.entryIds))).toEqual([4, 3, 2]);
    // An entry left out (or placed twice) is refused.
    expect(
      code(() => run(backend, t, 'ArrangeHeats', { heats: [{ entryIds: h1!.entryIds }] }, q.id)),
    ).toBe('INVALID_HEATS');
    // Confirm heat 1: a reshuffle keeps it, the others are planned again.
    t = run(backend, t, 'LockHeat', { heatId: h1!.id, locked: true }, q.id);
    const locked = matchById(t, q.id).heats[0]!;
    t = run(backend, t, 'GenerateHeats', { strategy: 'random', seed: 42 }, q.id);
    const after = matchById(t, q.id);
    expect(after.heats[0]).toMatchObject({
      id: locked.id,
      entryIds: locked.entryIds,
      status: 'ready',
    });
    expect(after.heats.flatMap((h) => h.entryIds).sort()).toEqual(
      after.participants.map((x) => x.tournamentEntryId).sort(),
    );
    expect(
      code(() =>
        run(
          backend,
          t,
          'ArrangeHeats',
          {
            heats: [
              { heatId: locked.id, entryIds: [...locked.entryIds].reverse() },
              ...after.heats.slice(1).map((h) => ({ heatId: h.id, entryIds: h.entryIds })),
            ],
          },
          q.id,
        ),
      ),
    ).toBe('HEAT_LOCKED');
    // Merge the unconfirmed heats into new ones of the same entries.
    const rest = after.heats.slice(1).flatMap((h) => h.entryIds);
    t = run(
      backend,
      t,
      'ArrangeHeats',
      {
        heats: [
          { heatId: locked.id, entryIds: locked.entryIds },
          { entryIds: rest.slice(0, 4) },
          { entryIds: rest.slice(4) },
        ],
      },
      q.id,
    );
    expect(sizes(matchById(t, q.id).heats.map((h) => h.entryIds))).toEqual([4, 4, 1]);
    expect(matchById(t, q.id).heats.map((h) => h.number)).toEqual([1, 2, 3]);
  });
  it('never overwrites a played heat and tracks what is missing', () => {
    const backend = setup().backend;
    const p = players(backend, 7);
    let t = tournament(
      backend,
      p.map((id) => [id]),
    );
    const q = t.matches[0]!.id;
    const [first, second] = matchById(t, q).heats;
    t = run(backend, t, 'StartHeat', { heatId: first!.id }, q);
    expect(code(() => run(backend, t, 'StartHeat', { heatId: second!.id }, q))).toBe('HEAT_BUSY');
    t = score(backend, t, q, { [first!.entryIds[0]!]: 400, [first!.entryIds[1]!]: 380 });
    // The organizer frees the board with two results missing: they stay visible as missing.
    t = run(backend, t, 'CompleteHeat', { heatId: first!.id }, q);
    let overview = heatOverview(t, matchById(t, q));
    expect(overview.heats[0]).toMatchObject({
      status: 'completed',
      missing: first!.entryIds.slice(2),
    });
    expect(overview.nextHeatId).toBe(second!.id);
    // Reshuffling keeps the played heat untouched.
    t = run(backend, t, 'GenerateHeats', { strategy: 'random', seed: 1 }, q);
    expect(matchById(t, q).heats[0]).toMatchObject({ id: first!.id, entryIds: first!.entryIds });
    expect(
      code(() => run(backend, t, 'ArrangeHeats', { heats: [{ entryIds: first!.entryIds }] }, q)),
    ).toBe('INVALID_HEATS');
    // Late entry of a missing result goes to the played heat; the qualification waits for all.
    t = run(backend, t, 'RecordResult', { scores: { [first!.entryIds[2]!]: 200 } }, q);
    expect(code(() => run(backend, t, 'FinalizeQualification'))).toBe('INCOMPLETE_QUALIFICATION');
    overview = heatOverview(t, matchById(t, q));
    expect(overview.heats[0]!.missing).toEqual([first!.entryIds[3]]);
    expect(overview.waiting).toEqual(matchById(t, q).heats[1]!.entryIds);
  });
});

describe('Progressive scoring', () => {
  function hiScore(tracking: Tournament['tracking'], count = 2) {
    const backend = setup().backend;
    const p = players(backend, count);
    const t = tournament(
      backend,
      p.map((id) => [id]),
      { mode: 'SINGLE_MATCH', tracking },
    );
    return { backend, t, m: t.matches[0]!.id, e: t.entries.map((x) => x.id) };
  }
  const round = (
    backend: Backend,
    t: Tournament,
    m: string,
    entryId: string,
    n: number,
    value: number | null,
    extra: Record<string, unknown> = {},
  ) => run(backend, t, 'RecordRound', { entryId, round: n, value, ...extra }, m);

  it('tracks a complete Hi-Score of seven rounds and proposes the total', () => {
    let { backend, t, m, e } = hiScore('ROUND_BY_ROUND');
    const values = [60, 85, 100, 140, 45, 26, 180];
    values.forEach((v, i) => (t = round(backend, t, m, e[0]!, i + 1, v)));
    const progress = roundProgress(t, matchById(t, m), e[0]!);
    expect(progress).toMatchObject({
      complete: true,
      computed: 636,
      best: 180,
      missing: [],
      official: null,
    });
    expect(progress.average).toBeCloseTo(636 / 7);
    // The rounds are provisional: the ranking still waits for the official totals.
    expect(matchById(t, m).result).toBeNull();
    t = run(backend, t, 'RecordResult', { scores: { [e[0]!]: 636 } }, m);
    expect(matchById(t, m).result!.reconciliation).toEqual([]);
  });
  it('keeps missing rounds apart from zero', () => {
    let { backend, t, m, e } = hiScore('FLEXIBLE');
    t = round(backend, t, m, e[0]!, 1, 100);
    t = round(backend, t, m, e[0]!, 2, 0);
    t = round(backend, t, m, e[0]!, 4, 60);
    t = round(backend, t, m, e[0]!, 5, null);
    const progress = roundProgress(t, matchById(t, m), e[0]!);
    expect(progress.rounds.map((r) => r.status)).toEqual([
      'recorded',
      'recorded',
      'missing',
      'recorded',
      'skipped',
      'missing',
      'missing',
    ]);
    expect(progress).toMatchObject({
      complete: false,
      partialValue: 160,
      computed: null,
      missing: [3, 6, 7],
      skipped: [5],
    });
  });
  it('corrects a round, keeps the history and restores the previous value', () => {
    let { backend, t, m, e } = hiScore('FLEXIBLE');
    t = round(backend, t, m, e[0]!, 1, 100);
    t = round(backend, t, m, e[0]!, 1, 120, { reason: 'Letto male' });
    let progress = roundProgress(t, matchById(t, m), e[0]!);
    expect(progress.rounds[0]).toMatchObject({ value: 120, corrected: true });
    expect(roundHistory(matchById(t, m), e[0]!).map((r) => [r.value, r.status])).toEqual([
      [100, 'corrected'],
      [120, 'recorded'],
    ]);
    t = run(
      backend,
      t,
      'VoidRound',
      { entryId: e[0]!, round: 1, restorePrevious: true, reason: 'Era giusto' },
      m,
    );
    progress = roundProgress(t, matchById(t, m), e[0]!);
    expect(progress.rounds[0]).toMatchObject({ value: 100, status: 'recorded' });
    t = run(backend, t, 'VoidRound', { entryId: e[0]!, round: 1, reason: 'Errore' }, m);
    expect(roundProgress(t, matchById(t, m), e[0]!).rounds[0]!.status).toBe('missing');
    expect(roundHistory(matchById(t, m), e[0]!)).toHaveLength(2);
  });
  it('saves a double tap once', () => {
    let { backend, t, m, e } = hiScore('FLEXIBLE');
    const key = randomUUID();
    const body = {
      expectedVersion: t.version,
      expectedMatchVersion: matchById(t, m).version,
      entryId: e[0]!,
      round: 1,
      value: 45,
    };
    const first = backend.execute('RecordRound', t.id, body, { matchId: m, idempotencyKey: key });
    const replay = backend.execute('RecordRound', t.id, body, { matchId: m, idempotencyKey: key });
    expect(replay).toEqual(first);
    expect(matchById(replay, m).rounds).toHaveLength(1);
    // A second tap with a new key and the same value is not a correction either.
    t = round(backend, first, m, e[0]!, 1, 45);
    expect(matchById(t, m).rounds).toHaveLength(1);
    // Without a key the command is refused: a retry could not be recognized.
    expect(
      code(() =>
        backend.execute(
          'RecordRound',
          t.id,
          { ...body, expectedVersion: t.version, expectedMatchVersion: matchById(t, m).version },
          { matchId: m },
        ),
      ),
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('accepts a partial tracking completed by the official final result', () => {
    let { backend, t, m, e } = hiScore('FLEXIBLE');
    t = round(backend, t, m, e[0]!, 1, 100);
    t = round(backend, t, m, e[0]!, 2, 60);
    t = score(backend, t, m, { [e[0]!]: 512, [e[1]!]: 430 });
    expect(t.status).toBe('completed');
    expect(matchStandings(t, matchById(t, m)).map((r) => r.total)).toEqual([512, 430]);
    expect(roundProgress(t, matchById(t, m), e[0]!)).toMatchObject({
      partialValue: 160,
      complete: false,
      official: 512,
    });
  });
  it('asks for a reason when the official result differs, and keeps both values', () => {
    let { backend, t, m, e } = hiScore('ROUND_BY_ROUND');
    for (let i = 1; i <= 7; i++) t = round(backend, t, m, e[0]!, i, 50);
    // ROUND_BY_ROUND requires every entry to finish its progression before the result.
    expect(code(() => run(backend, t, 'RecordResult', { scores: { [e[1]!]: 200 } }, m))).toBe(
      'ROUNDS_MISSING',
    );
    for (const [i, value] of [50, 50, 50, 50, 0, 0, 0].entries())
      t = round(backend, t, m, e[1]!, i + 1, value);
    expect(code(() => run(backend, t, 'RecordResult', { scores: { [e[0]!]: 360 } }, m))).toBe(
      'RESULT_DIFFERS_FROM_ROUNDS',
    );
    t = run(
      backend,
      t,
      'RecordResult',
      { scores: { [e[0]!]: 360 }, reconciliation: { [e[0]!]: 'Il totem mostra 360' } },
      m,
    );
    const result = matchById(t, m).result!;
    expect(result.scores[e[0]!]).toBe(360);
    expect(result.reconciliation).toEqual([
      expect.objectContaining({ entryId: e[0], computed: 350, official: 360 }),
    ]);
    // The rounds were not touched to make the numbers match.
    expect(roundProgress(t, matchById(t, m), e[0]!).computed).toBe(350);
    t = run(backend, t, 'RecordResult', { scores: { [e[1]!]: 200 } }, m);
    // The ranking uses the official values.
    expect(matchStandings(t, matchById(t, m)).map((r) => r.total)).toEqual([360, 200]);
  });
  it('tracks 501 by points left, without inferring busts', () => {
    const backend = setup().backend;
    const p = players(backend, 2);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      {
        mode: 'SINGLE_MATCH',
        gameMode: '501',
        tracking: 'FLEXIBLE',
        config: { x01Entry: 'REMAINING' },
      },
    );
    const m = t.matches[0]!.id;
    const [a, b] = t.entries.map((x) => x.id);
    // Round 3 left the score unchanged (a bust on the totem): recorded as observed.
    for (const [i, left] of [441, 341, 341, 200].entries())
      t = round(backend, t, m, a!, i + 1, left);
    expect(roundProgress(t, matchById(t, m), a!)).toMatchObject({ computed: 200, complete: true });
    t = round(backend, t, m, a!, 5, 0);
    expect(code(() => round(backend, t, m, a!, 5, 502))).toBe('INVALID_SCORE');
    t = run(
      backend,
      t,
      'RecordResult',
      { scores: { [a!]: 0, [b!]: 120 }, winnerEntryId: a },
      m,
      randomUUID(),
    );
    expect(t.status).toBe('completed');
    expect(matchById(t, m).result!.reconciliation).toEqual([]);
  });
  it('flags a 501 result that differs from points left until it is explained', () => {
    const backend = setup().backend;
    const p = players(backend, 2);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      {
        mode: 'SINGLE_MATCH',
        gameMode: '501',
        tracking: 'FLEXIBLE',
        config: { x01Entry: 'SCORED' },
      },
    );
    const m = t.matches[0]!.id;
    const [a] = t.entries.map((x) => x.id);
    for (const [i, scored] of [100, 140, 60].entries()) t = round(backend, t, m, a!, i + 1, scored);
    expect(roundProgress(t, matchById(t, m), a!)).toMatchObject({ computed: 201 });
    expect(
      code(() => run(backend, t, 'RecordResult', { scores: { [a!]: 0 }, winnerEntryId: a }, m)),
    ).toBe('RESULT_DIFFERS_FROM_ROUNDS');
  });
  it('keeps an X01 total unchanged on a bust and reconciles it to the final result', () => {
    const backend = setup().backend;
    const p = players(backend, 2);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      {
        mode: 'SINGLE_MATCH',
        gameMode: '301',
        tracking: 'ROUND_BY_ROUND',
        config: { x01Entry: 'SCORED' },
      },
    );
    const m = t.matches[0]!.id;
    const [a, b] = t.entries.map((x) => x.id);
    expect(code(() => run(backend, t, 'RecordResult', { winnerEntryId: a }, m))).toBe(
      'ROUNDS_MISSING',
    );
    t = round(backend, t, m, a!, 1, 10);
    t = round(backend, t, m, a!, 2, null, { bust: true });
    t = round(backend, t, m, b!, 1, 0);
    expect(
      matchById(t, m).rounds.find((r) => r.tournamentEntryId === a && r.round === 2),
    ).toMatchObject({ value: 0, bust: true });
    expect(roundProgress(t, matchById(t, m), a!)).toMatchObject({
      complete: true,
      computed: 291,
    });
    t = run(backend, t, 'RecordResult', { scores: { [a!]: 291, [b!]: 301 }, winnerEntryId: a }, m);
    expect(matchById(t, m).winnerEntryId).toBe(a);
  });
  it('keeps the last remaining X01 total when a bust is recorded in remaining-score mode', () => {
    const backend = setup().backend;
    const p = players(backend, 2);
    const t = tournament(
      backend,
      p.map((id) => [id]),
      {
        mode: 'SINGLE_MATCH',
        gameMode: '301',
        tracking: 'ROUND_BY_ROUND',
        config: { x01Entry: 'REMAINING' },
      },
    );
    const m = t.matches[0]!.id;
    const entry = t.entries[0]!.id;
    const afterFirst = round(backend, t, m, entry, 1, 291);
    const afterBust = round(backend, afterFirst, m, entry, 2, null, { bust: true });
    expect(matchById(afterBust, m).rounds.at(-1)).toMatchObject({
      value: 291,
      bust: true,
    });
    expect(roundProgress(afterBust, matchById(afterBust, m), entry).partialValue).toBe(291);
  });
  it('rotates a pair between its two players without recording scores by itself', () => {
    const backend = setup().backend;
    const p = players(backend, 4);
    let t = tournament(backend, [p.slice(0, 2), p.slice(2)], {
      mode: 'SINGLE_MATCH',
      tracking: 'FLEXIBLE',
    });
    const m = t.matches[0]!.id;
    const team = t.entries[0]!.id;
    const live = () => backend.liveMatch(m).rotationViews.find((r) => r.entryId === team)!;
    expect(live()).toMatchObject({ current: p[0], next: p[1], paused: false });
    for (let i = 1; i <= 4; i++)
      t = round(backend, t, m, team, i, 20 * i, { advanceRotation: true });
    expect(matchById(t, m).rounds.map((r) => r.playerId)).toEqual([p[0], p[1], p[0], p[1]]);
    t = run(backend, t, 'RotateTeam', { entryId: team, action: 'advance' }, m);
    expect(live().current).toBe(p[1]);
    // Advancing never adds a round.
    expect(matchById(t, m).rounds).toHaveLength(4);
    t = run(backend, t, 'RotateTeam', { entryId: team, action: 'undo' }, m);
    expect(live().current).toBe(p[0]);
    t = run(backend, t, 'RotateTeam', { entryId: team, action: 'reorder', order: [p[1], p[0]] }, m);
    expect(live()).toMatchObject({ order: [p[1], p[0]], current: p[0] });
    // Free mode: no thrower is assumed.
    t = run(backend, t, 'RotateTeam', { entryId: team, action: 'pause' }, m);
    t = round(backend, t, m, team, 5, 10, { advanceRotation: true });
    expect(matchById(t, m).rounds.at(-1)!.playerId).toBeNull();
    expect(code(() => run(backend, t, 'RotateTeam', { entryId: team, action: 'advance' }, m))).toBe(
      'ROTATION_PAUSED',
    );
    expect(code(() => round(backend, t, m, team, 6, 10, { playerId: p[2] }))).toBe(
      'INVALID_PLAYER',
    );
  });
  it('reopens a finished match for a correction and keeps its rounds', () => {
    let { backend, t, m, e } = hiScore('FLEXIBLE');
    t = round(backend, t, m, e[0]!, 1, 90);
    t = score(backend, t, m, { [e[0]!]: 500, [e[1]!]: 450 });
    expect(t.status).toBe('completed');
    expect(code(() => run(backend, t, 'RecordResult', { scores: { [e[1]!]: 520 } }, m))).toBe(
      'RESULT_HAS_DEPENDENTS',
    );
    t = run(backend, t, 'RecordResult', { scores: { [e[1]!]: 520 }, confirmInvalidation: true }, m);
    expect(t.status).toBe('completed');
    expect(t.results.find((r) => r.finalPlacement === 1)!.tournamentEntryId).toBe(e[1]);
    expect(matchById(t, m).rounds).toHaveLength(1);
  });
  it('refuses rounds when only final results are recorded', () => {
    const { backend, t, m, e } = hiScore('FINAL_ONLY');
    expect(code(() => round(backend, t, m, e[0]!, 1, 60))).toBe('TRACKING_DISABLED');
  });
});

describe('Competitions', () => {
  it('runs a Hi-Score Night of 19 over five heats with one global top 4', () => {
    const backend = setup().backend;
    const p = players(backend, 19);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { tracking: 'FLEXIBLE' },
    );
    const q = t.matches[0]!.id;
    const heats = matchById(t, q).heats;
    expect(sizes(heats.map((h) => h.entryIds))).toEqual([4, 4, 4, 4, 3]);
    // Totals chosen so that two finalists share heat 2 and one comes from the heat of three.
    const totals = new Map<string, number>();
    heats.forEach((h, hi) => h.entryIds.forEach((id, i) => totals.set(id, 300 + hi * 7 + i * 3)));
    const [h2a, h2b] = heats[1]!.entryIds;
    const [h5a] = heats[4]!.entryIds;
    const [h1a] = heats[0]!.entryIds;
    totals.set(h2a!, 700).set(h2b!, 650).set(h5a!, 690).set(h1a!, 600);
    t = run(backend, t, 'StartMatch', {}, q);
    for (const h of heats) {
      // Round-by-round tracking of the first player of every heat, then the finals from the totem.
      t = run(backend, t, 'RecordRound', { entryId: h.entryIds[0], round: 1, value: 60 }, q);
      for (const id of h.entryIds) t = score(backend, t, q, { [id]: totals.get(id)! });
      expect(matchById(t, q).heats.find((x) => x.id === h.id)!.status).toBe('completed');
    }
    expect(matchById(t, q).status).toBe('completed');
    t = run(backend, t, 'FinalizeQualification');
    // Nobody qualifies "per heat": the four best totals overall, wherever they played.
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([h2a, h5a, h2b, h1a]);
    t = run(backend, t, 'GenerateFinal');
    const final = t.matches.at(-1)!;
    expect(final.participants).toHaveLength(4);
    expect(final.heats).toEqual([]);
    expect(final.result).toBeNull();
    t = score(backend, t, final.id, { [h2a!]: 410, [h2b!]: 520, [h5a!]: 480, [h1a!]: 300 });
    t = run(backend, t, 'CompleteTournament');
    expect(t.results.find((r) => r.finalPlacement === 1)!.tournamentEntryId).toBe(h2b);
    expect(t.results.filter((r) => r.finalPlacement > 4)).toHaveLength(15);
    // The qualification history stays as it was.
    expect(matchById(t, q).result!.scores[h2a!]).toBe(700);
  });
  it('resolves a decisive tie between players of different heats', () => {
    const backend = setup().backend;
    const p = players(backend, 6);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { config: { qualifiers: 2, heatStrategy: 'balanced' } },
    );
    const q = t.matches[0]!.id;
    const [h1, h2] = matchById(t, q).heats;
    t = score(backend, t, q, {
      [h1!.entryIds[0]!]: 600,
      [h1!.entryIds[1]!]: 450,
      [h1!.entryIds[2]!]: 300,
    });
    t = score(backend, t, q, {
      [h2!.entryIds[0]!]: 450,
      [h2!.entryIds[1]!]: 200,
      [h2!.entryIds[2]!]: 100,
    });
    expect(code(() => run(backend, t, 'FinalizeQualification'))).toBe('TIE_REQUIRES_PLAYOFF');
    const tied = [h1!.entryIds[1]!, h2!.entryIds[0]!];
    t = run(backend, t, 'CreateTieBreak', { targetId: q, entryIds: tied });
    const playoff = t.matches.at(-1)!;
    // The playoff is a short Hi-Score (one round by default).
    expect(playoff.scoringConfiguration.turns).toBe(1);
    t = score(backend, t, playoff.id, { [tied[0]!]: 100, [tied[1]!]: 140 });
    t = run(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([h1!.entryIds[0], tied[1]]);
  });
  it('plays groups with teams, an odd number of units, a withdrawal and a walkover', () => {
    const backend = setup().backend;
    const p = players(backend, 9);
    let t = tournament(
      backend,
      [p.slice(0, 2), p.slice(2, 4), p.slice(4, 6), p.slice(6, 8), [p[8]!]],
      { mode: 'GROUPS', gameMode: '501', config: { groupCount: 1, qualifiersPerGroup: 2 } },
    );
    expect(t.matches).toHaveLength(10);
    expect(t.matches.every((m) => m.heats.length === 0)).toBe(true);
    const [a, b, c, d, single] = t.entries.map((e) => e.id);
    // The single withdraws: its unplayed matches become walkovers.
    t = run(backend, t, 'WithdrawEntry', { entryId: single, reason: 'Uscito presto' });
    const walkovers = t.matches.filter((m) => m.result?.walkover);
    expect(walkovers).toHaveLength(4);
    expect(walkovers.every((m) => m.winnerEntryId !== single)).toBe(true);
    const beats: Record<string, string> = {};
    for (const m of t.matches.filter((m) => m.status === 'ready')) {
      const [x, y] = m.participants.map((p) => p.tournamentEntryId);
      const order = [a, b, c, d];
      const winner = order.indexOf(x!) < order.indexOf(y!) ? x! : y!;
      beats[m.id] = winner;
      t = run(backend, t, 'RecordResult', { winnerEntryId: winner }, m.id);
    }
    t = run(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([a, b]);
    t = run(backend, t, 'GenerateFinal');
    const final = t.matches.at(-1)!;
    t = run(backend, t, 'RecordResult', { winnerEntryId: b }, final.id);
    t = run(backend, t, 'CompleteTournament');
    expect(t.results.find((r) => r.finalPlacement === 1)!.tournamentEntryId).toBe(b);
    // Statistics reach every member of the winning team, not only its first player.
    const second = backend.statistics(p[3]!);
    expect(second.tournamentsWon).toBe(1);
    expect(backend.history(p[3]!, { limit: 10, offset: 0 }).total).toBe(1);
  });
  it('invalidates the final when a qualification result is corrected', () => {
    const backend = setup().backend;
    const p = players(backend, 6);
    let t = tournament(
      backend,
      p.map((id) => [id]),
      { config: { qualifiers: 2 } },
    );
    const q = t.matches[0]!.id;
    const all = matchById(t, q).heats.flatMap((h) => h.entryIds);
    t = score(backend, t, q, Object.fromEntries(all.map((id, i) => [id, 600 - i * 50])));
    t = run(backend, t, 'FinalizeQualification');
    t = run(backend, t, 'GenerateFinal');
    expect(code(() => run(backend, t, 'RecordResult', { scores: { [all[5]!]: 900 } }, q))).toBe(
      'RESULT_HAS_DEPENDENTS',
    );
    t = run(
      backend,
      t,
      'RecordResult',
      { scores: { [all[5]!]: 900 }, confirmInvalidation: true },
      q,
    );
    expect(t.stages.map((s) => s.status)).toEqual(['open', 'invalidated']);
    expect(t.matches.at(-1)!.status).toBe('cancelled');
    t = run(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([all[5], all[0]]);
  });
});
