import { afterEach, describe, expect, it } from 'vitest';
import { command, fixture, play, setup } from './helpers.js';
import { currentTurn, highScoreStandings, matchById } from '../packages/domain/src/index.js';
const resources: ReturnType<typeof setup>[] = [];
function testSetup() {
  const r = setup();
  resources.push(r);
  return r;
}
afterEach(() => resources.splice(0).forEach((r) => r.store.close()));
describe('Quick High Score tournament', () => {
  it.each([4, 8])(
    'runs %i players through fresh final scores, explicit confirmation and stable history',
    (count) => {
      const { backend } = testSetup();
      let t = fixture(backend, count);
      t = command(backend, t, 'StartTournament');
      const qualification = t.matches[0]!.id;
      t = play(backend, t, qualification);
      const qualificationScores = highScoreStandings(t, matchById(t, qualification));
      t = command(backend, t, 'FinalizeQualification');
      expect(t.stages[0]!.qualifiedEntryIds).toEqual(t.entries.slice(0, 4).map((e) => e.id));
      t = command(backend, t, 'GenerateFinal');
      const final = t.matches.at(-1)!;
      expect(final.scores).toHaveLength(0);
      t = play(backend, t, final.id, (id) => 20 + t.entries.findIndex((e) => e.id === id));
      t = command(backend, t, 'CompleteTournament');
      expect(t.status).toBe('completed');
      expect(t.results.find((r) => r.finalPlacement === 1)!.tournamentEntryId).toBe(
        t.entries[3]!.id,
      );
      expect(highScoreStandings(t, matchById(t, qualification))).toEqual(qualificationScores);
      const winner = t.entries[3]!;
      backend.updatePlayer(winner.playerId, { nickname: 'Champion', displayName: 'Renamed' });
      expect(backend.tournament(t.id).entries[3]!.displayNameAtRegistration).toBe('Player 4');
      expect(backend.statistics(winner.playerId).tournamentsWon).toBe(1);
      expect(() =>
        command(backend, t, 'RecordScore', { turnId: final.turns[0]!.id, score: 10 }, final.id),
      ).toThrow('active');
    },
  );
  it('rejects insufficient entrants, duplicate registration and duplicate seeds', () => {
    const { backend } = testSetup();
    const t = fixture(backend, 1);
    expect(() => command(backend, t, 'StartTournament')).toThrow('at least');
    // Fewer players than finalists: no qualification, everyone plays the final directly.
    const few = command(backend, fixture(backend, 3), 'StartTournament');
    expect(few.stages.map((s) => s.kind)).toEqual(['final']);
    expect(few.matches[0]!.participants).toHaveLength(3);
    expect(() =>
      command(backend, t, 'RegisterPlayer', { playerId: t.entries[0]!.playerId }),
    ).toThrow('already');
    const p = backend.createPlayer({ displayName: 'Same Name' });
    expect(() => command(backend, t, 'RegisterPlayer', { playerId: p.id, seed: 1 })).toThrow(
      'Seed',
    );
  });
  it('does not finalize while players are incomplete or start a final before confirmation', () => {
    const { backend } = testSetup();
    let t = fixture(backend);
    t = command(backend, t, 'StartTournament');
    expect(() => command(backend, t, 'FinalizeQualification')).toThrow('completed');
    expect(() => command(backend, t, 'GenerateFinal')).toThrow('Confirm');
  });
  it('requires an explicit playoff for a cutoff tie and records repeated ties without choosing a winner', () => {
    const { backend } = testSetup();
    let t = fixture(backend);
    t = command(backend, t, 'StartTournament');
    const q = t.matches[0]!.id;
    t = play(
      backend,
      t,
      q,
      (id) => [100, 90, 80, 70, 70, 50, 40, 30][t.entries.findIndex((e) => e.id === id)]!,
    );
    expect(() => command(backend, t, 'FinalizeQualification')).toThrow('playoff');
    const tied = t.entries.slice(3, 5).map((e) => e.id);
    t = command(backend, t, 'CreateTieBreak', { targetId: q, entryIds: tied });
    t = play(backend, t, t.matches.at(-1)!.id, () => 30);
    expect(() => command(backend, t, 'FinalizeQualification')).toThrow('playoff');
    t = command(backend, t, 'CreateTieBreak', { targetId: q, entryIds: tied });
    t = play(backend, t, t.matches.at(-1)!.id, (id) => (id === tied[1] ? 40 : 30));
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toContain(tied[1]);
    expect(t.stages[0]!.qualifiedEntryIds).not.toContain(tied[0]);
    t = command(backend, t, 'GenerateFinal');
    const final = t.matches.at(-1)!.id;
    t = play(backend, t, final, () => 50);
    expect(() => command(backend, t, 'CompleteTournament')).toThrow('playoff');
    const entries = matchById(t, final).participants.map((p) => p.tournamentEntryId);
    t = command(backend, t, 'CreateTieBreak', { targetId: final, entryIds: entries });
    t = play(backend, t, t.matches.at(-1)!.id);
    t = command(backend, t, 'CompleteTournament');
    expect(t.results.filter((r) => r.finalPlacement === 1)).toHaveLength(1);
  });
  it('supports configurable best-turn tie criterion before a playoff', () => {
    const { backend } = testSetup();
    let t = fixture(
      backend,
      4,
      'QUICK_HIGH_SCORE',
      { qualifiers: 2, tiePolicy: 'BEST_TURN_THEN_PLAYOFF' },
      { turns: 2 },
    );
    t = command(backend, t, 'StartTournament');
    const q = t.matches[0]!.id;
    t = play(backend, t, q, (id, turn) => {
      const i = t.entries.findIndex((e) => e.id === id);
      return i === 0 ? 60 : i === 1 ? (turn === 1 ? 90 : 10) : i === 2 ? 50 : 20;
    });
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual(t.entries.slice(0, 2).map((e) => e.id));
  });
  it('closes early only with explicit exclusions, preserves entered scores and never promotes incomplete players', () => {
    const { backend } = testSetup();
    let t = fixture(backend);
    t = command(backend, t, 'StartTournament');
    const id = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, id);
    for (let i = 0; i < 4; i++) {
      const turn = currentTurn(matchById(t, id))!;
      t = command(backend, t, 'RecordScore', { turnId: turn.id, score: 100 - i }, id);
      t = command(backend, t, 'CompleteTurn', { turnId: turn.id }, id);
    }
    const incomplete = t.entries.slice(4).map((e) => e.id);
    const current = currentTurn(matchById(t, id))!;
    t = command(backend, t, 'RecordScore', { turnId: current.id, score: 180 }, id);
    expect(() =>
      command(backend, t, 'CloseQualificationEarly', {
        excludedEntryIds: incomplete.slice(1),
        reason: 'Players left',
      }),
    ).toThrow('exactly');
    t = command(backend, t, 'CloseQualificationEarly', {
      excludedEntryIds: incomplete,
      reason: 'Four participants left before finishing',
    });
    expect(matchById(t, id).scores).toHaveLength(5);
    expect(currentTurn(matchById(t, id))).toBeNull();
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual(t.entries.slice(0, 4).map((e) => e.id));
    expect(highScoreStandings(t, matchById(t, id))).toHaveLength(4);
    t = command(backend, t, 'GenerateFinal');
    t = play(backend, t, t.matches.at(-1)!.id);
    t = command(backend, t, 'CompleteTournament');
    expect(t.results.filter((r) => r.finalPlacement === 1)).toHaveLength(1);
  });
  it('separates statistics when qualification and final have incompatible configurations', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 4, 'QUICK_HIGH_SCORE', {
      finalScoring: { turns: 2, dartsPerTurn: 4 },
    });
    t = command(backend, t, 'StartTournament');
    t = play(backend, t, t.matches[0]!.id);
    t = command(backend, t, 'FinalizeQualification');
    t = command(backend, t, 'GenerateFinal');
    t = play(backend, t, t.matches.at(-1)!.id);
    t = command(backend, t, 'CompleteTournament');
    const statistics = backend.statistics(t.entries[0]!.playerId);
    expect(statistics.byGameMode).toHaveLength(2);
    expect(statistics.byGameMode.map((s) => [s.gameMode, s.rounds, s.dartsPerTurn])).toEqual([
      ['HI_SCORE', 1, 3],
      ['HI_SCORE', 2, 4],
    ]);
  });
  it('applies the configured best-turn criterion consistently inside a playoff', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 4, 'QUICK_HIGH_SCORE', {
      qualifiers: 2,
      tiePolicy: 'BEST_TURN_THEN_PLAYOFF',
      tieBreakTurns: 2,
    });
    t = command(backend, t, 'StartTournament');
    const id = t.matches[0]!.id;
    t = play(backend, t, id, (entryId) => {
      const i = t.entries.findIndex((e) => e.id === entryId);
      return [100, 80, 80, 40][i]!;
    });
    const tied = t.entries.slice(1, 3).map((e) => e.id);
    t = command(backend, t, 'CreateTieBreak', { targetId: id, entryIds: tied });
    t = play(backend, t, t.matches.at(-1)!.id, (entryId, turn) =>
      entryId === tied[0] ? 50 : turn === 1 ? 80 : 20,
    );
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual([t.entries[0]!.id, tied[1]]);
  });
});
describe('Turn recording and corrections', () => {
  it('supports individual darts, incomplete detection, maxima and duplicate protection', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 4, 'QUICK_HIGH_SCORE', {}, { dartsPerTurn: 4, maxDartScore: 25 });
    t = command(backend, t, 'StartTournament');
    const m = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, m);
    const turn = currentTurn(matchById(t, m))!;
    expect(() => command(backend, t, 'CompleteTurn', { turnId: turn.id }, m)).toThrow('all darts');
    expect(() => command(backend, t, 'RecordScore', { turnId: turn.id, score: -1 }, m)).toThrow();
    expect(() => command(backend, t, 'RecordScore', { turnId: turn.id, score: 101 }, m)).toThrow(
      'between',
    );
    for (let i = 1; i <= 4; i++)
      t = command(backend, t, 'RecordScore', { turnId: turn.id, score: 25, dartIndex: i }, m);
    expect(() =>
      command(backend, t, 'RecordScore', { turnId: turn.id, score: 20, dartIndex: 1 }, m),
    ).toThrow('already');
    t = command(backend, t, 'CompleteTurn', { turnId: turn.id }, m);
    expect(highScoreStandings(t, matchById(t, m))[0]!.total).toBe(100);
    expect(() => command(backend, t, 'CompleteTurn', { turnId: turn.id }, m)).toThrow('current');
    const score = matchById(t, m).scores[0]!;
    t = command(
      backend,
      t,
      'CorrectScore',
      { score: 5, reason: 'Misread board' },
      undefined,
      score.id,
    );
    expect(highScoreStandings(t, matchById(t, m))[0]!.total).toBe(80);
    const audit = backend.store
      .audit(t.id, { limit: 100, offset: 0 })
      .items.find((a) => a.type === 'CorrectScore')!;
    expect((audit.before as { score: number }).score).toBe(25);
    expect((audit.after as { score: number }).score).toBe(5);
    t = command(backend, t, 'VoidScore', { reason: 'Wrong dart' }, undefined, score.id);
    expect(currentTurn(matchById(t, m))!.id).toBe(turn.id);
    t = command(backend, t, 'RecordScore', { turnId: turn.id, score: 20, dartIndex: 1 }, m);
    t = command(backend, t, 'CompleteTurn', { turnId: turn.id }, m);
    expect(highScoreStandings(t, matchById(t, m))[0]!.total).toBe(95);
  });
  it('corrects previous completed turns and invalidates dependent finals only with an explicit reopen', () => {
    const { backend } = testSetup();
    let t = fixture(backend);
    t = command(backend, t, 'StartTournament');
    t = play(backend, t, t.matches[0]!.id);
    const q = t.matches[0]!,
      score = q.scores[7]!;
    t = command(backend, t, 'FinalizeQualification');
    t = command(backend, t, 'GenerateFinal');
    const oldFinal = t.matches.at(-1)!.id;
    expect(() => command(backend, t, 'CorrectScore', { score: 180 }, undefined, score.id)).toThrow(
      'Reopen',
    );
    t = command(backend, t, 'ReopenStage', {
      stageId: q.stageId,
      reason: 'Operator entered wrong result',
    });
    expect(matchById(t, oldFinal).status).toBe('cancelled');
    t = command(backend, t, 'CorrectScore', { score: 180 }, undefined, score.id);
    t = command(backend, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds[0]).toBe(t.entries[7]!.id);
    t = command(backend, t, 'GenerateFinal');
    expect(t.matches.at(-1)!.id).not.toBe(oldFinal);
    expect(t.matches.at(-1)!.scores).toHaveLength(0);
  });
  it('suspends and resumes without moving the turn', () => {
    const { backend } = testSetup();
    let t = fixture(backend, 4);
    t = command(backend, t, 'StartTournament');
    const id = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, id);
    const turn = currentTurn(matchById(t, id))!;
    t = command(backend, t, 'PauseTournament');
    expect(() => command(backend, t, 'RecordScore', { turnId: turn.id, score: 0 }, id)).toThrow(
      'active',
    );
    t = command(backend, t, 'ResumeTournament');
    expect(currentTurn(matchById(t, id))!.id).toBe(turn.id);
    expect(matchById(t, id).status).toBe('active');
  });
});
