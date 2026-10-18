import { randomUUID } from 'node:crypto';
import { Backend } from '../packages/application/src/index.js';
import { SqliteStore } from '../packages/database/src/index.js';
import { currentTurn, matchById, type Tournament } from '../packages/domain/src/index.js';

const path = process.env.DATABASE_PATH ?? './data/demo.sqlite';
const store = new SqliteStore(path);
const backend = new Backend(store);
function cmd(
  t: Tournament,
  name: Parameters<Backend['execute']>[0],
  input: Record<string, unknown> = {},
  matchId?: string,
) {
  return backend.execute(
    name,
    t.id,
    {
      expectedVersion: t.version,
      ...(matchId ? { expectedMatchVersion: matchById(t, matchId).version } : {}),
      ...input,
    },
    { matchId, idempotencyKey: randomUUID() },
  );
}
function play(t: Tournament, matchId: string, scores: number[]) {
  t = cmd(t, 'StartMatch', {}, matchId);
  while (matchById(t, matchId).status === 'active') {
    const turn = currentTurn(matchById(t, matchId))!;
    const index = t.entries.findIndex((e) => e.id === turn.participantId);
    t = cmd(
      t,
      'RecordScore',
      { turnId: turn.id, score: scores[index]! + turn.turnNumber },
      matchId,
    );
    t = cmd(t, 'CompleteTurn', { turnId: turn.id }, matchId);
  }
  return t;
}
try {
  const summary = store.transaction(() => {
    if (
      store.listPlayers({ limit: 1, offset: 0 }).total ||
      store.listTournaments({ limit: 1, offset: 0 }).total
    )
      throw new Error(
        'Seed requires an empty database. Choose a new DATABASE_PATH; existing data was preserved.',
      );
    const event = backend.createEvent({
      name: 'Serata Pub Time 1987',
      description: 'Demo con punteggi manuali, senza collegamento al bersaglio.',
    });
    const players = [
      'Francesca',
      'Marco',
      'Giulia',
      'Luca',
      'Sara',
      'Paolo',
      'Elena',
      'Davide',
    ].map((displayName, i) =>
      backend.createPlayer({
        displayName,
        nickname: ['Bull', 'Triplo', 'Ace', 'Doc', 'Flash', 'Baffo', 'Dart', 'Rock'][i],
      }),
    );
    const create = (name: string, mode: Tournament['mode']) => {
      let t = backend.createTournament({
        name,
        mode,
        eventId: event.id,
        scoringConfiguration: { turns: 2, dartsPerTurn: 3 },
        tournamentConfiguration: { groupCount: 2, qualifiersPerGroup: 2 },
      });
      players.forEach((p, i) => {
        t = cmd(t, 'RegisterPlayer', { playerId: p.id, seed: i + 1 });
      });
      return cmd(t, 'StartTournament');
    };
    let quick = create('Quick High Score — esempio concluso', 'QUICK_HIGH_SCORE');
    quick = play(quick, quick.matches[0]!.id, [95, 88, 80, 76, 70, 64, 58, 44]);
    quick = cmd(quick, 'FinalizeQualification');
    quick = cmd(quick, 'GenerateFinal');
    quick = play(quick, quick.matches.at(-1)!.id, [80, 112, 90, 68, 0, 0, 0, 0]);
    quick = cmd(quick, 'CompleteTournament');
    let groups = create('Torneo a gironi — in corso', 'GROUPS');
    groups = play(groups, groups.matches[0]!.id, [110, 100, 90, 80, 70, 60, 50, 40]);
    return {
      database: path,
      eventId: event.id,
      completedQuickTournamentId: quick.id,
      activeGroupTournamentId: groups.id,
    };
  });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  store.close();
}
