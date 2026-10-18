import { randomUUID } from 'node:crypto';
import { Backend, type CommandName } from '../packages/application/src/index.js';
import { SqliteStore } from '../packages/database/src/index.js';
import { currentTurn, matchById, type Tournament } from '../packages/domain/src/index.js';
export function setup(path = ':memory:') {
  const store = new SqliteStore(path);
  return { store, backend: new Backend(store) };
}
export function fixture(
  backend: Backend,
  count = 8,
  mode: Tournament['mode'] = 'QUICK_HIGH_SCORE',
  config: Record<string, unknown> = {},
  scoring: Record<string, unknown> = {},
) {
  let tournament = backend.createTournament({
    name: 'Friday at the pub',
    mode,
    scoringConfiguration: { turns: 1, ...scoring },
    tournamentConfiguration: config,
  });
  for (let i = 0; i < count; i++) {
    const p = backend.createPlayer({ displayName: `Player ${i + 1}`, nickname: 'Darts' });
    tournament = backend.execute('RegisterPlayer', tournament.id, {
      expectedVersion: tournament.version,
      playerId: p.id,
      seed: i + 1,
    });
  }
  return tournament;
}
export function command(
  backend: Backend,
  t: Tournament,
  name: CommandName,
  body: Record<string, unknown> = {},
  matchId?: string,
  scoreId?: string,
  key?: string,
) {
  const match = matchId
    ? matchById(t, matchId)
    : scoreId
      ? t.matches.find((m) => m.scores.some((s) => s.id === scoreId))
      : undefined;
  return backend.execute(
    name,
    t.id,
    {
      expectedVersion: t.version,
      ...(match ? { expectedMatchVersion: match.version } : {}),
      ...body,
    },
    { matchId, scoreId, idempotencyKey: key ?? randomUUID() },
  );
}
export function play(
  backend: Backend,
  t: Tournament,
  matchId: string,
  score: (entryId: string, turn: number) => number = (id) =>
    100 - t.entries.findIndex((e) => e.id === id),
) {
  t = command(backend, t, 'StartMatch', {}, matchId);
  while (matchById(t, matchId).status === 'active') {
    const turn = currentTurn(matchById(t, matchId))!;
    t = command(
      backend,
      t,
      'RecordScore',
      { turnId: turn.id, score: score(turn.participantId, turn.turnNumber) },
      matchId,
    );
    t = command(backend, t, 'CompleteTurn', { turnId: turn.id }, matchId);
  }
  return t;
}
