import { randomUUID } from 'node:crypto';
import { Backend } from '../packages/application/src/index.js';
import { SqliteStore } from '../packages/database/src/index.js';
import { matchById, type Tournament } from '../packages/domain/src/index.js';

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
/** Hi-Score: the final totals read from the totem, one entry per player. */
function play(t: Tournament, matchId: string, scores: number[]) {
  const totals = Object.fromEntries(
    matchById(t, matchId).participants.map((p) => [
      p.tournamentEntryId,
      scores[t.entries.findIndex((e) => e.id === p.tournamentEntryId)]!,
    ]),
  );
  return cmd(t, 'RecordResult', { scores: totals }, matchId);
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
    const create = (name: string, mode: Tournament['mode'], gameMode: Tournament['gameMode']) => {
      let t = backend.createTournament({
        name,
        mode,
        gameMode,
        eventId: event.id,
        tournamentConfiguration: { groupCount: 2, qualifiersPerGroup: 2 },
      });
      players.forEach((p, i) => {
        t = cmd(t, 'RegisterPlayer', { playerId: p.id, seed: i + 1 });
      });
      return cmd(t, 'StartTournament');
    };
    let quick = create('Hi-Score Night — esempio concluso', 'QUICK_HIGH_SCORE', 'HI_SCORE');
    quick = play(quick, quick.matches[0]!.id, [695, 588, 580, 476, 470, 464, 358, 244]);
    quick = cmd(quick, 'FinalizeQualification');
    quick = cmd(quick, 'GenerateFinal');
    quick = play(quick, quick.matches.at(-1)!.id, [580, 712, 590, 468, 0, 0, 0, 0]);
    quick = cmd(quick, 'CompleteTournament');
    let groups = create('Torneo 501 a gironi — in corso', 'GROUPS', '501');
    const first = groups.matches[0]!;
    // 501: the totem's winner, with the points left by the loser.
    groups = cmd(
      groups,
      'RecordResult',
      {
        winnerEntryId: first.participants[0]!.tournamentEntryId,
        scores: { [first.participants[1]!.tournamentEntryId]: 64 },
      },
      first.id,
    );
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
