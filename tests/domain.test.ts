import { describe, expect, it } from 'vitest';
import {
  highScoreRule,
  validateScore,
  roundRobin,
  seededBracket,
  distributeGroups,
  transitionTournament,
  transitionMatch,
} from '../packages/domain/src/index.js';
const config = {
  kind: 'HIGH_SCORE' as const,
  turns: 2,
  dartsPerTurn: 4,
  maxDartScore: 60,
  maxTurnScore: 240,
};
describe('Pure HIGH_SCORE rules', () => {
  it('accumulates totals, best turn and completion independently of HTTP/database', () => {
    const one = highScoreRule.apply(highScoreRule.initial(config), 180, config);
    expect(one).toEqual({ total: 180, completedTurns: 1, bestTurn: 180 });
    expect(highScoreRule.isComplete(one, config)).toBe(false);
    const two = highScoreRule.apply(one, 200, config);
    expect(two.total).toBe(380);
    expect(highScoreRule.isComplete(two, config)).toBe(true);
    expect(() => highScoreRule.apply(two, 0, config)).toThrow();
  });
  it.each([-1, 241, 1.2, NaN, Infinity])('rejects invalid score %s', (score) =>
    expect(() => validateScore(score, 240)).toThrow(),
  );
  it('accepts zero and configured maximum', () => {
    expect(() => validateScore(0, 240)).not.toThrow();
    expect(() => validateScore(240, 240)).not.toThrow();
  });
});
describe('Schedule properties', () => {
  it.each(Array.from({ length: 19 }, (_, i) => i + 2))(
    'round robin with %i participants has every pair once and no simultaneous participation',
    (count) => {
      const ids = Array.from({ length: count }, (_, i) => `p${i}`),
        schedule = roundRobin(ids);
      expect(schedule).toHaveLength((count * (count - 1)) / 2);
      expect(new Set(schedule.map((m) => [m.home, m.away].sort().join(':'))).size).toBe(
        schedule.length,
      );
      for (const round of new Set(schedule.map((m) => m.scheduleRound))) {
        const players = schedule
          .filter((m) => m.scheduleRound === round)
          .flatMap((m) => [m.home, m.away]);
        expect(new Set(players).size).toBe(players.length);
      }
    },
  );
  it.each([2, 3, 5, 6, 7, 8, 12, 17])(
    'brackets retain all %i entrants exactly once, awarding byes to higher seeds',
    (count) => {
      const ids = Array.from({ length: count }, (_, i) => `p${i}`);
      const pairs = seededBracket(ids);
      expect(pairs.flat().filter(Boolean).sort()).toEqual([...ids].sort());
      expect(pairs.every((p) => p.some(Boolean))).toBe(true);
      expect(pairs.length * 2).toBe(2 ** Math.ceil(Math.log2(count)));
      if (count === 6)
        expect(
          pairs
            .filter((p) => p.includes(null))
            .flat()
            .filter(Boolean)
            .sort(),
        ).toEqual(['p0', 'p1']);
    },
  );
  it('snake allocation balances seeded groups', () => {
    expect(distributeGroups(['1', '2', '3', '4', '5', '6'], 2)).toEqual([
      ['1', '4', '5'],
      ['2', '3', '6'],
    ]);
  });
});
describe('State machines', () => {
  it('permits normal flow and prohibits completed writes', () => {
    expect(() => transitionTournament('active', 'paused')).not.toThrow();
    expect(() => transitionTournament('completed', 'active')).toThrow();
    expect(() => transitionMatch('ready', 'active')).not.toThrow();
    expect(() => transitionMatch('ready', 'completed')).toThrow();
  });
});
