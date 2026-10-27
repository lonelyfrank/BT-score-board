import { describe, expect, it } from 'vitest';
import {
  computeProgression,
  levelFor,
  levelProgress,
  levels,
  maxLevel,
  xpRules,
  type GameMode,
  type Match,
  type Tournament,
  type TournamentEntry,
} from '../packages/domain/src/index.js';

let seq = 0;
const entry = (id: string, playerId: string): TournamentEntry => ({
  id,
  tournamentId: 't',
  playerId,
  displayNameAtRegistration: playerId,
  kind: 'single',
  name: null,
  members: [{ playerId, displayName: playerId }],
  seed: null,
  status: 'registered',
  registeredAt: '2026-01-01T00:00:00.000Z',
});
interface MatchSpec {
  a: string;
  b: string;
  winner?: string | null;
  scores?: Record<string, number>;
  at?: string;
  target?: number | null;
  rounds?: number[];
  walkover?: boolean;
}
/** A completed match between entries named e-<player>; `rounds` are X01 remaining values of `a`. */
function match(s: MatchSpec): Match {
  const at = s.at ?? '2026-02-01T20:00:00.000Z';
  const id = `m${++seq}`;
  return {
    id,
    status: 'completed',
    completedAt: at,
    winnerEntryId: s.winner === undefined ? `e-${s.a}` : s.winner && `e-${s.winner}`,
    participants: [`e-${s.a}`, `e-${s.b}`].map((tournamentEntryId) => ({ tournamentEntryId })),
    scoringConfiguration: { turns: 7 },
    result: {
      scores: Object.fromEntries(Object.entries(s.scores ?? {}).map(([k, v]) => [`e-${k}`, v])),
      targetScore: s.target ?? null,
      walkover: s.walkover ?? false,
      recordedAt: at,
    },
    rounds: (s.rounds ?? []).map((value, i) => ({
      id: `r${id}-${i}`,
      tournamentEntryId: `e-${s.a}`,
      round: i + 1,
      value,
      bust: false,
      playerId: null,
      kind: 'remaining',
      status: 'recorded',
    })),
  } as unknown as Match;
}
function tournament(
  gameMode: GameMode,
  matches: Match[],
  extra: Partial<Tournament> = {},
): Tournament {
  const players = new Set(
    matches.flatMap((m) => m.participants.map((p) => p.tournamentEntryId.slice(2))),
  );
  return {
    id: `t${++seq}`,
    mode: 'GROUPS',
    gameMode,
    recording: 'result',
    tracking: 'ROUND_BY_ROUND',
    status: 'active',
    tournamentConfiguration: { x01Entry: 'REMAINING' },
    entries: [...players].map((p) => entry(`e-${p}`, p)),
    matches,
    results: [],
    ...extra,
  } as unknown as Tournament;
}

describe('levels', () => {
  it('has 12 ascending levels, the first within reach and the last very far', () => {
    expect(levels).toHaveLength(12);
    expect(levels[0]!.xp).toBe(0);
    for (let i = 1; i < levels.length; i++)
      expect(levels[i]!.xp).toBeGreaterThan(levels[i - 1]!.xp);
    expect(levels[1]!.xp).toBeLessThanOrEqual(100);
    expect(maxLevel.title).toBe('Master Birraio');
    expect(maxLevel.xp).toBeGreaterThan(levels[10]!.xp * 1.5);
  });
  it('maps xp to a level at the boundaries', () => {
    expect(levelFor(-5).level).toBe(1);
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(119_999).level).toBe(11);
    expect(levelFor(120_000).level).toBe(12);
    expect(levelFor(10 ** 9).level).toBe(12);
  });
  it('reports progress to the next level', () => {
    expect(levelProgress(175)).toMatchObject({ into: 75, span: 150, ratio: 0.5 });
    expect(levelProgress(10 ** 9)).toMatchObject({ next: null, ratio: 1, span: 0 });
  });
});

describe('experience', () => {
  it('grants participation and win xp, without any confirmation', () => {
    const t = tournament('501', [match({ a: 'ann', b: 'bob' })]);
    const { players } = computeProgression([t]);
    expect(players.get('ann')!.xp).toBe(xpRules.participation + xpRules.win);
    expect(players.get('bob')!.xp).toBe(xpRules.participation);
    expect(players.get('ann')!.stats).toMatchObject({ matches: 1, wins: 1 });
  });
  it('counts a match once however many copies are merged', () => {
    const t = tournament('501', [match({ a: 'ann', b: 'bob' })]);
    const copy = structuredClone(t);
    const once = computeProgression([t]).players.get('ann')!.xp;
    expect(computeProgression([t, copy, t]).players.get('ann')!.xp).toBe(once);
  });
  it('ignores walkovers, withdrawn entries and unfinished matches', () => {
    const walk = match({ a: 'ann', b: 'bob', walkover: true });
    const open = { ...match({ a: 'ann', b: 'bob' }), status: 'active' } as Match;
    const t = tournament('501', [walk, open]);
    expect(computeProgression([t]).players.size).toBe(0);
    const solo = tournament('501', [match({ a: 'ann', b: 'bob' })]);
    solo.entries.find((e) => e.id === 'e-bob')!.status = 'withdrawn';
    expect(computeProgression([solo]).players.size).toBe(0);
  });
  it('stops match xp after the daily cap but keeps counting statistics', () => {
    const matches = Array.from({ length: xpRules.dailyMatchCap + 5 }, (_, i) =>
      match({ a: 'ann', b: 'bob', at: `2026-03-01T${String(i % 24).padStart(2, '0')}:00:00.000Z` }),
    );
    const ann = computeProgression([tournament('501', matches)]).players.get('ann')!;
    expect(ann.xp).toBe(xpRules.dailyMatchCap * (xpRules.participation + xpRules.win));
    expect(ann.stats.matches).toBe(xpRules.dailyMatchCap + 5);
  });
  it('adds tournament bonuses for groups, not for a single match', () => {
    const results = [{ tournamentEntryId: 'e-ann', finalPlacement: 1 }] as Tournament['results'];
    const groups = tournament('501', [match({ a: 'ann', b: 'bob' })], {
      status: 'completed',
      results,
    });
    const ann = computeProgression([groups]).players.get('ann')!;
    expect(ann.breakdown.tournaments).toBe(xpRules.tournamentCompleted + xpRules.tournamentWon);
    expect(ann.stats).toMatchObject({ tournamentsCompleted: 1, tournamentsWon: 1 });
    const single = tournament('501', [match({ a: 'ann', b: 'bob' })], {
      status: 'completed',
      mode: 'SINGLE_MATCH',
      results,
    });
    expect(computeProgression([single]).players.get('ann')!.breakdown.tournaments).toBe(0);
  });
  it('gives xp to every member of a team', () => {
    const t = tournament('HI_SCORE', [match({ a: 'ann', b: 'bob' })]);
    const team = t.entries.find((e) => e.id === 'e-ann')!;
    team.kind = 'team';
    team.members = [
      { playerId: 'ann', displayName: 'ann' },
      { playerId: 'cat', displayName: 'cat' },
    ];
    const { players } = computeProgression([t]);
    expect(players.get('cat')!.xp).toBe(players.get('ann')!.xp);
  });
});

describe('records', () => {
  it('holds the highest Hi-Score and rewards improving your own best', () => {
    const t = tournament('HI_SCORE', [
      match({ a: 'ann', b: 'bob', scores: { ann: 300, bob: 280 }, at: '2026-02-01T20:00:00.000Z' }),
      match({
        a: 'ann',
        b: 'bob',
        scores: { ann: 340, bob: 360 },
        winner: 'bob',
        at: '2026-02-08T20:00:00.000Z',
      }),
      match({ a: 'ann', b: 'bob', scores: { ann: 350, bob: 100 }, at: '2026-02-15T20:00:00.000Z' }),
    ]);
    const { players, records } = computeProgression([t]);
    expect(records.HI_SCORE).toMatchObject({ playerId: 'bob', value: 360 });
    expect(players.get('bob')!.records).toHaveLength(1);
    expect(players.get('bob')!.cosmetics.nameEffect).toBe('record');
    expect(players.get('bob')!.cosmetics.recordTitles).toEqual(['Re dell’Hi-Score']);
    // ann: 300, then 340 (+bonus), then 350 (+bonus); bob: 280, then 360 (+bonus), then 100.
    expect(players.get('ann')!.breakdown.personalBest).toBe(2 * xpRules.personalBest);
    expect(players.get('bob')!.breakdown.personalBest).toBe(xpRules.personalBest);
  });
  it('keeps the first player to reach a value when it is equalled', () => {
    const t = tournament('SHANGHAI', [
      match({ a: 'ann', b: 'bob', scores: { ann: 80, bob: 70 }, at: '2026-02-01T20:00:00.000Z' }),
      match({ a: 'bob', b: 'ann', scores: { bob: 80, ann: 10 }, at: '2026-02-08T20:00:00.000Z' }),
    ]);
    expect(computeProgression([t]).records.SHANGHAI!.playerId).toBe('ann');
  });
  it('ranks a countdown game by fewest rounds to close, when tracked to zero', () => {
    const slow = match({ a: 'ann', b: 'bob', rounds: [400, 300, 200, 100, 0] });
    const fast = match({ a: 'bob', b: 'ann', rounds: [300, 120, 0] });
    const untracked = match({ a: 'ann', b: 'bob', rounds: [] });
    const unfinished = match({ a: 'bob', b: 'ann', rounds: [400, 100] });
    const { records } = computeProgression([
      tournament('501', [slow, fast, untracked, unfinished]),
    ]);
    expect(records['501']).toMatchObject({ playerId: 'bob', value: 3 });
  });
  it('ranks Exacta by the smallest distance from the target', () => {
    const t = tournament('EXACTA', [
      match({ a: 'ann', b: 'bob', scores: { ann: 298, bob: 310 }, target: 300 }),
      match({ a: 'ann', b: 'bob', scores: { ann: 300, bob: 311 }, target: 300 }),
      match({ a: 'ann', b: 'bob', scores: { ann: 200, bob: 311 }, target: null }),
    ]);
    expect(computeProgression([t]).records.EXACTA).toMatchObject({ playerId: 'ann', value: 0 });
  });
  it('has no record for Odd & Even, nor for a Hi-Score over other rounds', () => {
    const odd = tournament('ODD_EVEN', [
      match({ a: 'ann', b: 'bob', scores: { ann: 20, bob: 5 } }),
    ]);
    const short = match({ a: 'ann', b: 'bob', scores: { ann: 90, bob: 80 } });
    (short as { scoringConfiguration: { turns: number } }).scoringConfiguration.turns = 3;
    expect(computeProgression([odd, tournament('HI_SCORE', [short])]).records).toEqual({});
  });
  it('gives the name effect of the level, and the top level keeps its own', () => {
    const t = tournament('HI_SCORE', [match({ a: 'ann', b: 'bob', scores: { ann: 300, bob: 1 } })]);
    const ann = computeProgression([t]).players.get('ann')!;
    expect(ann.cosmetics.badges.map((b) => b.id)).toEqual(['level:1', 'record:HI_SCORE']);
    expect(ann.cosmetics.levelTitle).toBe('Assetato');
  });
});
