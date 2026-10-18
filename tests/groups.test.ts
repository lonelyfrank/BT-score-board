import { afterEach, describe, expect, it } from 'vitest';
import { command, fixture, play, setup } from './helpers.js';
import {
  groupStandings,
  matchById,
  currentStage,
  type Tournament,
} from '../packages/domain/src/index.js';
const resources: ReturnType<typeof setup>[] = [];
function testSetup() {
  const r = setup();
  resources.push(r);
  return r;
}
afterEach(() => resources.splice(0).forEach((r) => r.store.close()));
describe('Group tournaments', () => {
  it.each([
    [8, 2, 2],
    [9, 3, 2],
    [10, 2, 3],
  ])(
    'completes %i players / %i groups / %i qualifiers with byes and automatic knockout advancement',
    (count, groups, qualifiers) => {
      const { backend } = testSetup();
      let t = fixture(backend, count, 'GROUPS', {
        groupCount: groups,
        qualifiersPerGroup: qualifiers,
      });
      t = command(backend, t, 'StartTournament');
      const ids = t.matches.map((m) => m.id);
      for (const id of ids) t = play(backend, t, id);
      for (const g of t.groups) {
        const standings = groupStandings(t, g.id);
        expect(standings.every((r) => r.played === g.entryIds.length - 1)).toBe(true);
        expect(standings[0]!.wins).toBe(g.entryIds.length - 1);
        expect(standings[0]!.points).toBe(3 * standings[0]!.wins);
      }
      t = command(backend, t, 'FinalizeQualification');
      expect(new Set(t.stages[0]!.qualifiedEntryIds).size).toBe(groups * qualifiers);
      t = command(backend, t, 'GenerateFinal');
      const byes = t.matches.filter((m) => m.participants.length === 1);
      expect(byes).toHaveLength(
        2 ** Math.ceil(Math.log2(groups * qualifiers)) - groups * qualifiers,
      );
      expect(byes.every((m) => m.scores.length === 0 && m.winnerEntryId)).toBe(true);
      while (
        t.currentPhase !== 'final' ||
        t.matches.some((m) => m.matchType === 'final' && m.status === 'ready')
      ) {
        const match = t.matches.find((m) => m.status === 'ready');
        expect(match).toBeDefined();
        t = play(backend, t, match!.id);
      }
      expect(t.stages.some((s) => s.kind === 'semifinal')).toBe(true);
      t = command(backend, t, 'CompleteTournament');
      expect(t.status).toBe('completed');
      expect(t.results).toHaveLength(count);
      expect(t.results.filter((r) => r.finalPlacement === 1)).toHaveLength(1);
      expect(t.results.find((r) => r.finalPlacement === 1)!.tournamentEntryId).toBe(
        t.entries[0]!.id,
      );
    },
  );
  it('accepts manual group allocation and rejects repeated or missing entries', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 6, 'GROUPS');
    const ids = t.entries.map((e) => e.id);
    t = command(backend, t, 'ConfigureTournament', {
      tournamentConfiguration: { groupAssignments: [ids.slice(0, 3), ids.slice(3)] },
    });
    t = command(backend, t, 'StartTournament');
    expect(t.groups.map((g) => g.entryIds)).toEqual([ids.slice(0, 3), ids.slice(3)]);
    let invalid = fixture(backend, 6, 'GROUPS');
    const entries = invalid.entries.map((e) => e.id);
    invalid = command(backend, invalid, 'ConfigureTournament', {
      tournamentConfiguration: { groupAssignments: [entries.slice(0, 3), entries.slice(0, 3)] },
    });
    expect(() => command(backend, invalid, 'StartTournament')).toThrow('exactly once');
  });
  it('ranks configurable draw points then resolves a multi-way tie with a recorded playoff', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 3, 'GROUPS', { groupCount: 1, qualifiersPerGroup: 2, drawPoints: 2 });
    t = command(backend, t, 'StartTournament');
    const group = t.groups[0]!;
    for (const m of [...t.matches]) t = play(backend, t, m.id, () => 40);
    const rows = groupStandings(t, group.id);
    expect(rows.every((r) => r.draws === 2 && r.points === 4 && r.tied && r.difference === 0)).toBe(
      true,
    );
    expect(() => command(backend, t, 'FinalizeQualification')).toThrow('playoff');
    t = command(backend, t, 'CreateTieBreak', { targetId: group.id, entryIds: group.entryIds });
    t = play(backend, t, t.matches.at(-1)!.id);
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual(t.entries.slice(0, 2).map((e) => e.id));
  });
  it('uses score difference before points scored and applies head-to-head only to two equal players', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 3, 'GROUPS', { groupCount: 1, qualifiersPerGroup: 2 });
    t = command(backend, t, 'StartTournament');
    const [a, b, c] = t.entries.map((e) => e.id);
    // A beats B 100:90, B beats C 100:90, C beats A 100:80. All have one win.
    for (const m of [...t.matches]) {
      const ids = m.participants.map((p) => p.tournamentEntryId);
      const scores =
        ids.includes(a!) && ids.includes(b!)
          ? { [a!]: 100, [b!]: 90 }
          : ids.includes(b!) && ids.includes(c!)
            ? { [b!]: 100, [c!]: 90 }
            : { [c!]: 100, [a!]: 80 };
      t = play(backend, t, m.id, (id) => scores[id]!);
    }
    const rows = groupStandings(t, t.groups[0]!.id);
    expect(rows.map((r) => r.tournamentEntryId)).toEqual([c, b, a]);
    expect(rows.map((r) => r.difference)).toEqual([10, 0, -10]);
  });
  it('requires match playoffs when draws are disabled and separates standings points from dart scores', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 2, 'GROUPS', {
      groupCount: 1,
      qualifiersPerGroup: 2,
      allowDraws: false,
      winPoints: 5,
      lossPoints: 1,
    });
    t = command(backend, t, 'StartTournament');
    const m = t.matches[0]!.id;
    t = play(backend, t, m, () => 60);
    expect(groupStandings(t, t.groups[0]!.id).every((r) => r.played === 0)).toBe(true);
    expect(() => command(backend, t, 'FinalizeQualification')).toThrow('playoffs');
    t = command(backend, t, 'CreateTieBreak', {
      targetId: m,
      entryIds: t.entries.map((e) => e.id),
    });
    t = play(backend, t, t.matches.at(-1)!.id);
    const rows = groupStandings(t, t.groups[0]!.id);
    expect(rows.map((r) => r.points)).toEqual([5, 1]);
    expect(rows.map((r) => r.scored)).toEqual([60, 60]);
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toHaveLength(2);
  });
  it('uses the direct result only for the remaining pair tied on points, difference and scored points', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 3, 'GROUPS', { groupCount: 1, qualifiersPerGroup: 2 });
    t = command(backend, t, 'StartTournament');
    const [a, b, c] = t.entries.map((e) => e.id);
    for (const m of [...t.matches]) {
      const ids = m.participants.map((p) => p.tournamentEntryId);
      const scores =
        ids.includes(a!) && ids.includes(b!)
          ? { [a!]: 20, [b!]: 10 }
          : ids.includes(b!) && ids.includes(c!)
            ? { [b!]: 30, [c!]: 20 }
            : { [c!]: 30, [a!]: 20 };
      t = play(backend, t, m.id, (id) => scores[id]!);
    }
    const rows = groupStandings(t, t.groups[0]!.id);
    expect(rows.map((r) => r.tournamentEntryId)).toEqual([c, a, b]);
    expect(rows[1]!.criteria).toEqual([3, 0, 40, 1]);
    expect(rows[2]!.criteria).toEqual([3, 0, 40, 0]);
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([c, a]);
  });
  it('blocks two matches on one board and preserves bracket pairing when playing order changes', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 8, 'GROUPS', { groupCount: 2, qualifiersPerGroup: 4 });
    t = command(backend, t, 'StartTournament');
    const first = t.matches[0]!,
      second = t.matches[1]!;
    t = command(backend, t, 'StartMatch', {}, first.id);
    expect(() => command(backend, t, 'StartMatch', {}, second.id)).toThrow('board');
    t = command(backend, t, 'PauseMatch', {}, first.id);
    expect(() => command(backend, t, 'StartMatch', {}, second.id)).toThrow('board');
    t = command(backend, t, 'ResumeMatch', {}, first.id);
    // Finish the already active match through the same explicit turn commands.
    for (const turn of first.turns) {
      t = command(
        backend,
        t,
        'RecordScore',
        { turnId: turn.id, score: 100 - t.entries.findIndex((e) => e.id === turn.participantId) },
        first.id,
      );
      t = command(backend, t, 'CompleteTurn', { turnId: turn.id }, first.id);
    }
    for (const m of t.matches.filter((m) => m.status === 'ready')) t = play(backend, t, m.id);
    t = command(backend, t, 'FinalizeQualification');
    t = command(backend, t, 'GenerateFinal');
    const originals = t.matches.filter((m) => m.stageId === currentStage(t).id);
    t = command(backend, t, 'ReorderMatches', {
      matchIds: [...originals].reverse().map((m) => m.id),
    });
    for (const m of [...originals].reverse()) t = play(backend, t, m.id);
    const winners = originals.map((m) => matchById(t, m.id).winnerEntryId);
    const semifinals = t.matches.filter((m) => m.stageId === currentStage(t).id);
    expect(semifinals.map((m) => m.participants.map((p) => p.tournamentEntryId))).toEqual([
      winners.slice(0, 2),
      winners.slice(2),
    ]);
  });
  it('reopens semifinals, cancels dependent finals, corrects a result and regenerates advancement', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 8, 'GROUPS');
    t = command(backend, t, 'StartTournament');
    for (const m of [...t.matches]) t = play(backend, t, m.id);
    t = command(backend, t, 'FinalizeQualification');
    t = command(backend, t, 'GenerateFinal');
    const semi = currentStage(t);
    for (const m of t.matches.filter((m) => m.stageId === semi.id)) t = play(backend, t, m.id);
    const final = t.matches.at(-1)!;
    const semifinal = t.matches.find((m) => m.stageId === semi.id)!;
    const loser = semifinal.participants.find(
      (p) => p.tournamentEntryId !== semifinal.winnerEntryId,
    )!;
    const score = semifinal.scores.find((s) => s.tournamentEntryId === loser.tournamentEntryId)!;
    t = command(backend, t, 'ReopenStage', { stageId: semi.id, reason: 'Wrong semifinal score' });
    t = command(backend, t, 'CorrectScore', { score: 180 }, undefined, score.id);
    t = command(backend, t, 'AdvanceKnockout');
    expect(matchById(t, final.id).status).toBe('cancelled');
    expect(t.matches.at(-1)!.participants.map((p) => p.tournamentEntryId)).toContain(
      loser.tournamentEntryId,
    );
  });
});
