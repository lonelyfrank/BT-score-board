import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Backend, type CommandName } from '../packages/application/src/index.js';
import {
  evaluateResult,
  gameModes,
  games,
  groupStandings,
  matchById,
  matchStandings,
  resultDependencies,
  type GameMode,
  type Tournament,
} from '../packages/domain/src/index.js';
import { MemoryStore } from '../packages/local-store/src/index.js';

function setup() {
  return new Backend(new MemoryStore());
}
function create(
  backend: Backend,
  count: number,
  options: {
    mode?: Tournament['mode'];
    gameMode?: GameMode;
    config?: Record<string, unknown>;
    start?: boolean;
  } = {},
) {
  let t = backend.createTournament({
    name: 'Serata al pub',
    mode: options.mode ?? 'QUICK_HIGH_SCORE',
    gameMode: options.gameMode ?? 'HI_SCORE',
    scoringConfiguration: { turns: 7 },
    tournamentConfiguration: options.config ?? {},
  });
  for (let i = 0; i < count; i++) {
    const p = backend.createPlayer({ displayName: `Player ${i + 1}` });
    t = cmd(backend, t, 'RegisterPlayer', { playerId: p.id, seed: i + 1 });
  }
  return options.start === false ? t : cmd(backend, t, 'StartTournament');
}
function cmd(
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
const entry = (t: Tournament, i: number) => t.entries[i]!.id;
const ready = (t: Tournament, type?: string) =>
  t.matches
    .filter((m) => m.status === 'ready' && (!type || m.matchType === type))
    .sort((a, b) => a.sequence - b.sequence);
/** Records one Hi-Score total at a time, as the organizer reads them from the totem. */
function scoreEach(backend: Backend, t: Tournament, matchId: string, totals: number[]) {
  for (const [i, p] of matchById(t, matchId).participants.entries())
    t = cmd(backend, t, 'RecordResult', { scores: { [p.tournamentEntryId]: totals[i]! } }, matchId);
  return t;
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'NO_ERROR';
};

describe('Game catalog', () => {
  it('offers exactly the eight games of the totem with their rules', () => {
    expect(gameModes).toEqual([
      '301',
      '301_DOUBLE_IN_OUT',
      '501',
      'HI_SCORE',
      '301_MASTERS',
      'EXACTA',
      'ODD_EVEN',
      'SHANGHAI',
    ]);
    expect(games['501'].startingScore).toBe(501);
    expect(games.HI_SCORE.rounds).toBe(7);
    expect(games.EXACTA.target).toEqual({ min: 250, max: 350 });
    expect(games.SHANGHAI.maxScore).toBe(252);
    expect(games.ODD_EVEN.players).toEqual({ min: 2, max: 2 });
  });
  it('validates final results per game without asking for what the totem does not show', () => {
    const ids = ['a', 'b'];
    const none = { declaredWinnerEntryId: null, targetScore: null, special: null };
    // Hi-Score: the totals are the result.
    expect(evaluateResult('HI_SCORE', ids, { ...none, scores: { a: 300 } })).toEqual({
      complete: false,
      winnerEntryId: null,
    });
    expect(evaluateResult('HI_SCORE', ids, { ...none, scores: { a: 300, b: 280 } })).toEqual({
      complete: true,
      winnerEntryId: 'a',
    });
    expect(evaluateResult('HI_SCORE', ids, { ...none, scores: { a: 300, b: 300 } })).toEqual({
      complete: true,
      winnerEntryId: null,
    });
    expect(() => evaluateResult('HI_SCORE', ids, { ...none, scores: { a: 1261 } })).toThrow(
      'between 0 and 1260',
    );
    // 301/501: the winner is enough; points left are optional and must agree with it.
    expect(evaluateResult('501', ids, { ...none, scores: {}, declaredWinnerEntryId: 'b' })).toEqual(
      { complete: true, winnerEntryId: 'b' },
    );
    expect(evaluateResult('501', ids, { ...none, scores: {} }).complete).toBe(false);
    expect(evaluateResult('301', ids, { ...none, scores: { a: 0, b: 41 } }).winnerEntryId).toBe(
      'a',
    );
    expect(() =>
      evaluateResult('301', ids, { ...none, scores: { a: 0, b: 41 }, declaredWinnerEntryId: 'b' }),
    ).toThrow('does not match');
    expect(() => evaluateResult('301', ids, { ...none, scores: { a: 302 } })).toThrow('301');
    // Exacta: closest to the target, which must be in range.
    expect(
      evaluateResult('EXACTA', ids, { ...none, scores: { a: 290, b: 330 }, targetScore: 315 })
        .winnerEntryId,
    ).toBe('b');
    expect(() => evaluateResult('EXACTA', ids, { ...none, scores: {}, targetScore: 400 })).toThrow(
      '250',
    );
    // Shanghai: an instant win needs its player; points are optional.
    expect(() =>
      evaluateResult('SHANGHAI', ids, { ...none, scores: {}, special: 'SHANGHAI' }),
    ).toThrow('Shanghai');
    expect(
      evaluateResult('SHANGHAI', ids, {
        ...none,
        scores: { a: 120, b: 40 },
        special: 'SHANGHAI',
        declaredWinnerEntryId: 'b',
      }).winnerEntryId,
    ).toBe('b');
    expect(() =>
      evaluateResult('ODD_EVEN', ids, { ...none, scores: {}, special: 'SHANGHAI' }),
    ).toThrow();
  });
  it('keeps a quick Hi-Score tournament on Hi-Score and odd/even matches between two players', () => {
    const backend = setup();
    expect(code(() => create(backend, 4, { gameMode: '501' }))).toBe('INVALID_GAME_MODE');
    expect(code(() => create(backend, 3, { mode: 'SINGLE_MATCH', gameMode: 'ODD_EVEN' }))).toBe(
      'INVALID_PLAYER_COUNT',
    );
    expect(
      code(() =>
        create(backend, 4, {
          mode: 'GROUPS',
          gameMode: '501',
          config: { groupRanking: 'POINTS_SCORE' },
        }),
      ),
    ).toBe('INVALID_RANKING');
  });
});

describe('Quick Hi-Score tournament with final results', () => {
  it('qualifies the best four and decides the winner on a fresh final only', () => {
    const backend = setup();
    let t = create(backend, 8);
    const q = t.matches[0]!.id;
    expect(t.matches[0]!.turns).toEqual([]);
    // Partial entry is durable and ranked; players still to play stay unranked at the bottom.
    t = cmd(backend, t, 'RecordResult', { scores: { [entry(t, 5)]: 610 } }, q);
    expect(matchById(t, q).status).toBe('active');
    const partial = matchStandings(t, matchById(t, q));
    expect(partial[0]).toMatchObject({
      tournamentEntryId: entry(t, 5),
      recorded: true,
      total: 610,
    });
    expect(partial.filter((r) => !r.recorded)).toHaveLength(7);
    expect(code(() => cmd(backend, t, 'FinalizeQualification'))).toBe('INCOMPLETE_QUALIFICATION');
    t = scoreEach(backend, t, q, [500, 480, 700, 420, 300, 610, 350, 455]);
    expect(matchById(t, q).status).toBe('completed');
    t = cmd(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([2, 5, 0, 1].map((i) => entry(t, i)));
    t = cmd(backend, t, 'GenerateFinal');
    const final = t.matches.at(-1)!;
    expect(final.participants.map((p) => p.tournamentEntryId)).toEqual(
      [0, 1, 2, 5].map((i) => entry(t, i)),
    );
    // Final totals start from zero: the 700 of the qualification counts for nothing here.
    t = scoreEach(backend, t, final.id, [520, 610, 400, 590]);
    expect(matchStandings(t, matchById(t, final.id)).map((r) => r.total)).toEqual([
      610, 590, 520, 400,
    ]);
    t = cmd(backend, t, 'CompleteTournament');
    const placed = Object.fromEntries(t.results.map((r) => [r.tournamentEntryId, r]));
    expect(placed[entry(t, 1)]).toMatchObject({ finalPlacement: 1, points: 610 });
    expect(placed[entry(t, 2)]).toMatchObject({ finalPlacement: 4, points: 400 });
    // Non-finalists keep their qualification place.
    expect(placed[entry(t, 7)]!.finalPlacement).toBe(5);
    expect(placed[entry(t, 4)]!.finalPlacement).toBe(8);
    expect(placed[entry(t, 1)]!.statistics.kind).toBe('RESULT');
  });
  it('requires a playoff or an explicit organizer decision for a tie on fourth place', () => {
    const backend = setup();
    let t = create(backend, 6);
    const q = t.matches[0]!.id;
    t = scoreEach(backend, t, q, [700, 650, 600, 450, 450, 300]);
    expect(code(() => cmd(backend, t, 'FinalizeQualification'))).toBe('TIE_REQUIRES_PLAYOFF');
    const tied = [entry(t, 3), entry(t, 4)];
    // The decision must name exactly the tied group, with a reason; nothing is random.
    expect(
      code(() =>
        cmd(backend, t, 'DecideTie', {
          targetId: q,
          orderedEntryIds: [entry(t, 3), entry(t, 5)],
          reason: 'x',
        }),
      ),
    ).toBe('INVALID_TIE_GROUP');
    const decided = cmd(backend, t, 'DecideTie', {
      targetId: q,
      orderedEntryIds: [tied[1], tied[0]],
      reason: 'Il giocatore 4 ha lasciato il locale',
    });
    expect(decided.matches.at(-1)!.result!.decision!.reason).toContain('lasciato');
    expect(cmd(backend, decided, 'FinalizeQualification').stages[0]!.qualifiedEntryIds).toContain(
      tied[1],
    );
    // Or a playoff on the board, recorded as a Hi-Score result of its own (same situation).
    let p = create(backend, 6);
    const pq = p.matches[0]!.id;
    p = scoreEach(backend, p, pq, [700, 650, 600, 450, 450, 300]);
    const pair = [entry(p, 3), entry(p, 4)];
    p = cmd(backend, p, 'CreateTieBreak', { targetId: pq, entryIds: pair });
    const playoff = p.matches.at(-1)!.id;
    p = cmd(backend, p, 'RecordResult', { scores: { [pair[0]!]: 140, [pair[1]!]: 95 } }, playoff);
    p = cmd(backend, p, 'FinalizeQualification');
    expect(p.stages[0]!.qualifiedEntryIds).toEqual([0, 1, 2, 3].map((i) => entry(p, i)));
    // Qualification totals are untouched by the playoff.
    expect(
      matchStandings(p, matchById(p, pq)).find((r) => r.tournamentEntryId === pair[0])!.total,
    ).toBe(450);
  });
  it('plays the final directly with fewer players than finalists, and refuses a single player', () => {
    const backend = setup();
    expect(code(() => create(backend, 1))).toBe('INSUFFICIENT_PLAYERS');
    let t = create(backend, 3);
    expect(t.stages.map((s) => s.kind)).toEqual(['final']);
    expect(t.matches[0]!.participants).toHaveLength(3);
    t = scoreEach(backend, t, t.matches[0]!.id, [300, 410, 280]);
    t = cmd(backend, t, 'CompleteTournament');
    expect(
      t.results.map((r) => [
        t.entries.findIndex((e) => e.id === r.tournamentEntryId),
        r.finalPlacement,
      ]),
    ).toEqual([
      [0, 2],
      [1, 1],
      [2, 3],
    ]);
  });
  it('excludes a player who withdraws during the qualification', () => {
    const backend = setup();
    let t = create(backend, 6);
    const q = t.matches[0]!.id;
    t = cmd(backend, t, 'RecordResult', { scores: { [entry(t, 0)]: 500 } }, q);
    t = cmd(backend, t, 'WithdrawEntry', { entryId: entry(t, 5), reason: 'Uscito' });
    expect(t.entries[5]!.status).toBe('withdrawn');
    expect(code(() => cmd(backend, t, 'RecordResult', { scores: { [entry(t, 5)]: 1 } }, q))).toBe(
      'INVALID_RESULT',
    );
    for (const [i, s] of [480, 470, 460, 450].entries())
      t = cmd(backend, t, 'RecordResult', { scores: { [entry(t, i + 1)]: s } }, q);
    expect(matchById(t, q).status).toBe('completed');
    t = cmd(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).not.toContain(entry(t, 5));
    expect(t.entries[5]!.status).toBe('withdrawn');
  });
});

describe('Group tournament with any game', () => {
  it('runs 501 groups with an odd number of players on points and wins, then semifinals and final', () => {
    const backend = setup();
    let t = create(backend, 5, {
      mode: 'GROUPS',
      gameMode: '501',
      config: { groupCount: 2, qualifiersPerGroup: 2 },
    });
    // Snake distribution: 3 + 2 players; a group of three plays three matches with rests.
    expect(t.groups.map((g) => g.entryIds.length)).toEqual([3, 2]);
    expect(t.matches.filter((m) => m.matchType === 'group')).toHaveLength(4);
    // Lower seed wins every group match; the totem's winner is all that is entered.
    while (ready(t, 'group').length) {
      const m = ready(t, 'group')[0]!;
      const [a, b] = m.participants.map((p) => p.tournamentEntryId);
      const winner =
        t.entries.findIndex((e) => e.id === a) < t.entries.findIndex((e) => e.id === b) ? a : b;
      t = cmd(backend, t, 'RecordResult', { winnerEntryId: winner }, m.id);
    }
    const table = groupStandings(t, t.groups[0]!.id);
    expect(table.map((r) => [r.points, r.wins, r.difference])).toEqual([
      [6, 2, 0],
      [3, 1, 0],
      [0, 0, 0],
    ]);
    // Raw points left are never a ranking criterion outside Hi-Score.
    expect(table[0]!.criteria).toEqual([6, 2, 0]);
    t = cmd(backend, t, 'FinalizeQualification');
    t = cmd(backend, t, 'GenerateFinal');
    expect(t.stages.at(-1)!.kind).toBe('semifinal');
    for (const m of ready(t, 'knockout'))
      t = cmd(
        backend,
        t,
        'RecordResult',
        {
          winnerEntryId: m.participants[0]!.tournamentEntryId,
          scores: {
            [m.participants[0]!.tournamentEntryId]: 0,
            [m.participants[1]!.tournamentEntryId]: 87,
          },
        },
        m.id,
      );
    expect(t.stages.at(-1)!.kind).toBe('final');
    const final = ready(t, 'final')[0]!;
    t = cmd(
      backend,
      t,
      'RecordResult',
      { winnerEntryId: final.participants[1]!.tournamentEntryId },
      final.id,
    );
    t = cmd(backend, t, 'CompleteTournament');
    expect(t.status).toBe('completed');
    expect(t.results.find((r) => r.finalPlacement === 1)!.tournamentEntryId).toBe(
      final.participants[1]!.tournamentEntryId,
    );
    expect(t.results.filter((r) => r.finalPlacement === 3)).toHaveLength(2);
  });
  it('ranks Hi-Score groups on points, then score difference', () => {
    const backend = setup();
    let t = create(backend, 4, {
      mode: 'GROUPS',
      config: { groupCount: 1, qualifiersPerGroup: 2 },
    });
    const totals: Record<number, number> = { 0: 600, 1: 500, 2: 400, 3: 390 };
    for (const m of ready(t, 'group')) {
      const scores = Object.fromEntries(
        m.participants.map((p) => [
          p.tournamentEntryId,
          totals[t.entries.findIndex((e) => e.id === p.tournamentEntryId)]!,
        ]),
      );
      t = cmd(backend, t, 'RecordResult', { scores }, m.id);
    }
    const table = groupStandings(t, t.groups[0]!.id);
    expect(table.map((r) => r.points)).toEqual([9, 6, 3, 0]);
    expect(table[0]).toMatchObject({ scored: 1800, bestScore: 600, averageScore: 600 });
    expect(table[0]!.criteria.slice(0, 3)).toEqual([9, 1800 - 1290, 1800]);
  });
  it('awards walkovers after a withdrawal and leaves cancelled matches out of the standings', () => {
    const backend = setup();
    let t = create(backend, 4, {
      mode: 'GROUPS',
      gameMode: '301',
      config: { groupCount: 1, qualifiersPerGroup: 2 },
    });
    const first = ready(t, 'group')[0]!;
    t = cmd(
      backend,
      t,
      'RecordResult',
      { winnerEntryId: first.participants[0]!.tournamentEntryId },
      first.id,
    );
    const leaving = entry(t, 3);
    t = cmd(backend, t, 'WithdrawEntry', { entryId: leaving, reason: 'Infortunio' });
    const walkovers = t.matches.filter((m) => m.result?.walkover);
    expect(walkovers.length).toBeGreaterThan(0);
    expect(walkovers.every((m) => m.winnerEntryId !== leaving)).toBe(true);
    // A–C will not be played; A–B decides the head-to-head between the leaders.
    const toCancel = ready(t, 'group').find((m) =>
      [entry(t, 0), entry(t, 2)].every((id) =>
        m.participants.some((p) => p.tournamentEntryId === id),
      ),
    )!;
    t = cmd(backend, t, 'CancelMatch', { reason: 'Chiusura locale' }, toCancel.id);
    for (const m of ready(t, 'group'))
      t = cmd(
        backend,
        t,
        'RecordResult',
        { winnerEntryId: m.participants[0]!.tournamentEntryId },
        m.id,
      );
    const table = groupStandings(t, t.groups[0]!.id);
    expect(table.reduce((n, r) => n + r.played, 0)).toBe(2 * (6 - 1));
    expect(table.find((r) => r.tournamentEntryId === leaving)!.withdrawn).toBe(true);
    t = cmd(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).not.toContain(leaving);
    // Walkovers decide standings but are not played matches in personal statistics.
    const stats = backend.statistics(
      t.entries.find((e) => e.id === walkovers[0]!.winnerEntryId)!.playerId,
    );
    expect(stats.recentMatches.every((m) => m.matchId !== walkovers[0]!.id)).toBe(true);
  });
});

describe('Result corrections', () => {
  it('corrects freely inside an open phase and recomputes standings', () => {
    const backend = setup();
    let t = create(backend, 5);
    const q = t.matches[0]!.id;
    t = scoreEach(backend, t, q, [500, 400, 300, 200, 100]);
    t = cmd(backend, t, 'RecordResult', { scores: { [entry(t, 4)]: 800 } }, q);
    expect(matchStandings(t, matchById(t, q))[0]!.tournamentEntryId).toBe(entry(t, 4));
    // Clearing a score reopens the match.
    t = cmd(backend, t, 'RecordResult', { scores: { [entry(t, 0)]: null } }, q);
    expect(matchById(t, q).status).toBe('active');
  });
  it('warns before invalidating a confirmed phase, then reopens it only on explicit confirmation', () => {
    const backend = setup();
    let t = create(backend, 5);
    const q = t.matches[0]!.id;
    t = scoreEach(backend, t, q, [500, 400, 300, 200, 100]);
    t = cmd(backend, t, 'FinalizeQualification');
    t = cmd(backend, t, 'GenerateFinal');
    const final = t.matches.at(-1)!.id;
    t = scoreEach(backend, t, final, [100, 200, 300, 400]);
    t = cmd(backend, t, 'CompleteTournament');
    expect(resultDependencies(t, matchById(t, q))).toMatchObject({
      required: true,
      tournamentCompleted: true,
    });
    let error: { code?: string; details?: unknown } = {};
    try {
      cmd(backend, t, 'RecordResult', { scores: { [entry(t, 4)]: 900 } }, q);
    } catch (e) {
      error = e as typeof error;
    }
    expect(error).toMatchObject({
      code: 'RESULT_HAS_DEPENDENTS',
      details: { reopensStage: 'qualification', stages: ['final'], matches: 1 },
    });
    // Nothing changed.
    expect(backend.tournament(t.id)).toEqual(t);
    const before = backend.statistics(t.entries[3]!.playerId);
    expect(before.tournamentsWon).toBe(1);
    t = cmd(
      backend,
      t,
      'RecordResult',
      { scores: { [entry(t, 4)]: 900 }, confirmInvalidation: true },
      q,
    );
    expect(t.status).toBe('active');
    expect(t.results).toEqual([]);
    expect(t.stages.map((s) => s.status)).toEqual(['open', 'invalidated']);
    expect(matchById(t, final).status).toBe('cancelled');
    // Derived statistics follow the corrected data immediately.
    expect(backend.statistics(t.entries[3]!.playerId).tournamentsWon).toBe(0);
    t = cmd(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toContain(entry(t, 4));
  });
  it('replays an exact repeated confirmation once and rejects a stale double tap', () => {
    const backend = setup();
    let t = create(backend, 2, { mode: 'SINGLE_MATCH', gameMode: '501' });
    const id = t.matches[0]!.id;
    const key = randomUUID();
    const body = { winnerEntryId: entry(t, 0) };
    const once = cmd(backend, t, 'RecordResult', body, id, key);
    const again = cmd(backend, t, 'RecordResult', body, id, key);
    expect(again).toEqual(once);
    expect(code(() => cmd(backend, t, 'RecordResult', body, id))).toBe('VERSION_CONFLICT');
    t = once;
    expect(t.status).toBe('completed');
  });
});

describe('Single match and statistics', () => {
  it('ends a free match with its result and keeps games apart in the statistics', () => {
    const backend = setup();
    let t = create(backend, 3, { mode: 'SINGLE_MATCH', gameMode: '301' });
    expect(t.stages[0]!.kind).toBe('final');
    expect(
      code(() =>
        cmd(backend, t, 'RecordResult', { scores: { [entry(t, 0)]: 0 } }, t.matches[0]!.id),
      ),
    ).toBe('WINNER_REQUIRED');
    t = cmd(
      backend,
      t,
      'RecordResult',
      { winnerEntryId: entry(t, 1), scores: { [entry(t, 0)]: 40, [entry(t, 2)]: 12 } },
      t.matches[0]!.id,
    );
    expect(t.status).toBe('completed');
    expect(t.results.map((r) => r.finalPlacement)).toEqual([3, 1, 2]);
    // A tied Hi-Score match waits for a decision before ending.
    const players = t.entries.map((e) => e.playerId);
    let hs = backend.createTournament({ name: 'HS', mode: 'SINGLE_MATCH', gameMode: 'HI_SCORE' });
    for (const playerId of players.slice(0, 2))
      hs = cmd(backend, hs, 'RegisterPlayer', { playerId });
    hs = cmd(backend, hs, 'StartTournament');
    hs = scoreEach(backend, hs, hs.matches[0]!.id, [640, 640]);
    expect(hs.status).toBe('active');
    hs = cmd(backend, hs, 'DecideTie', {
      targetId: hs.matches[0]!.id,
      orderedEntryIds: [hs.entries[0]!.id, hs.entries[1]!.id],
      reason: 'Spareggio rinunciato',
    });
    expect(hs.status).toBe('completed');
    const stats = backend.statistics(players[0]!);
    expect(stats.byGameMode.map((r) => r.gameMode).sort()).toEqual(['301', 'HI_SCORE']);
    const hiScore = stats.byGameMode.find((r) => r.gameMode === 'HI_SCORE')!;
    expect(hiScore).toMatchObject({ bestScore: 640, averageScore: 640, rounds: 7 });
    expect(stats.byGameMode.find((r) => r.gameMode === '301')).toMatchObject({
      matchesPlayed: 1,
      losses: 1,
      winRate: 0,
      bestScore: null,
    });
    expect(stats.placements.map((p) => p.placement).sort()).toEqual([1, 3]);
    expect(stats.tournamentsWon).toBe(1);
  });
});
