import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend, CommandName } from '../packages/application/src/index.js';
import { matchById, type Tournament } from '../packages/domain/src/index.js';
import { LocalEngine, readBackup } from '../packages/local-store/src/index.js';

// V1.2: a whole evening in progress moves to another device and goes on there.
const engines: LocalEngine[] = [];
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.close());
  vi.restoreAllMocks();
});
async function device(name = `bt-transfer-${randomUUID()}`) {
  const engine = await LocalEngine.open({ channel: null, database: { name } });
  engines.push(engine);
  return engine;
}
function exec(
  b: Backend,
  t: Tournament,
  command: CommandName,
  body: Record<string, unknown> = {},
  matchId?: string,
) {
  const m = matchId ? matchById(t, matchId) : undefined;
  return b.execute(
    command,
    t.id,
    { expectedVersion: t.version, ...(m ? { expectedMatchVersion: m.version } : {}), ...body },
    { matchId, idempotencyKey: randomUUID() },
  );
}
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'NO_ERROR',
    (error: { code?: string }) => error.code,
  );

/**
 * Twelve players on the evening: a pair and ten singles in a Hi-Score qualification over three
 * heats, with rounds, a rotation and a reconciled difference. Left in the middle of heat 2.
 */
async function evening(engine: LocalEngine) {
  const p: string[] = [];
  for (let i = 0; i < 12; i++)
    p.push((await engine.write((b) => b.createPlayer({ displayName: `Giocatore ${i + 1}` }))).id);
  const event = await engine.write((b) => b.createEvent({ name: 'Venerdì al pub' }));
  let t = await engine.write((b) =>
    b.createTournament({
      playSpaceId: '00000000-0000-4000-8000-00000000b7d1',
      name: 'Hi-Score Night',
      mode: 'QUICK_HIGH_SCORE',
      eventId: event.id,
      tracking: 'FLEXIBLE',
      tournamentConfiguration: { qualifiers: 4 },
    }),
  );
  t = await engine.write((b) =>
    exec(b, t, 'ComposeEntries', {
      entries: [
        { playerIds: [p[0], p[1]], name: 'I Gemelli' },
        ...p.slice(2).map((id) => ({ playerIds: [id] })),
      ],
    }),
  );
  t = await engine.write((b) => exec(b, t, 'StartTournament'));
  const q = t.matches[0]!.id;
  const heats = matchById(t, q).heats;
  expect(heats.map((h) => h.entryIds.length)).toEqual([4, 4, 3]);
  const team = t.entries[0]!.id;
  t = await engine.write((b) =>
    exec(b, t, 'RecordRound', { entryId: team, round: 1, value: 60, advanceRotation: true }, q),
  );
  let value = 300;
  for (const id of heats[0]!.entryIds) {
    const body: Record<string, unknown> = { scores: { [id]: (value += 37) } };
    t = await engine.write((b) => exec(b, t, 'RecordResult', body, q));
  }
  t = await engine.write((b) => exec(b, t, 'StartHeat', { heatId: heats[1]!.id }, q));
  for (const id of heats[1]!.entryIds.slice(0, 2))
    t = await engine.write((b) =>
      exec(b, t, 'RecordResult', { scores: { [id]: (value += 41) } }, q),
    );
  return { t, q, heats, team };
}
const snapshot = (engine: LocalEngine, t: Tournament, q: string) =>
  engine.read((b) => ({
    tournament: b.tournament(t.id),
    standings: b.standings(t.id),
    live: b.liveMatch(q),
    events: b.store.listEvents({ limit: 10, offset: 0 }),
    players: b.store.listPlayers({ limit: 100, offset: 0 }),
  }));

describe('Backup transfer of an evening in progress', () => {
  it('restores the same tournament, heats, rounds and standings, and goes on to the end', async () => {
    const pub = await device();
    const { t, q, heats, team } = await evening(pub);
    const before = snapshot(pub, t, q);
    const text = JSON.stringify(await pub.exportBackup());

    // A new device: empty, then the verified backup.
    const phone = await device();
    const backup = await readBackup(text);
    expect(backup.counts).toMatchObject({ players: 12, events: 1, tournaments: 1 });
    await phone.importBackup(backup, { replaceExisting: false });
    expect(snapshot(phone, t, q)).toEqual(before);
    expect(phone.read((b) => b.liveMatch(q)).heatOverview).toMatchObject({
      currentHeatId: heats[1]!.id,
      completed: 1,
    });
    expect(phone.read((b) => b.liveMatch(q)).rotationViews[0]).toMatchObject({ entryId: team });

    // The evening goes on on the new device: same versions, so commands apply as on the first.
    let next = phone.read((b) => b.tournament(t.id));
    let value = 200;
    for (const h of [heats[1]!, heats[2]!]) {
      if (h !== heats[1])
        next = await phone.write((b) => exec(b, next, 'StartHeat', { heatId: h.id }, q));
      for (const id of h.entryIds)
        if ((matchById(next, q).result?.scores[id] ?? null) === null)
          next = await phone.write((b) =>
            exec(b, next, 'RecordResult', { scores: { [id]: (value += 13) } }, q),
          );
    }
    expect(matchById(next, q).status).toBe('completed');
    next = await phone.write((b) => exec(b, next, 'FinalizeQualification'));
    next = await phone.write((b) => exec(b, next, 'GenerateFinal'));
    const final = next.matches.at(-1)!;
    for (const [i, entry] of final.participants.entries())
      next = await phone.write((b) =>
        exec(b, next, 'RecordResult', { scores: { [entry.tournamentEntryId]: 500 + i } }, final.id),
      );
    next = await phone.write((b) => exec(b, next, 'CompleteTournament'));
    expect(next.status).toBe('completed');
    expect(next.results).toHaveLength(11);
    // Results of the first device were carried over untouched.
    const carried = before.tournament.matches[0]!.result!.scores;
    for (const [id, score] of Object.entries(carried))
      expect(matchById(next, q).result!.scores[id]).toBe(score);
    // The first device keeps its own copy, unaffected by what happened on the phone.
    expect(snapshot(pub, t, q)).toEqual(before);
  });

  it('exports again exactly what it imported', async () => {
    const pub = await device();
    await evening(pub);
    const first = await pub.exportBackup();
    const phone = await device();
    await phone.importBackup(await readBackup(JSON.stringify(first)), { replaceExisting: false });
    const second = await phone.exportBackup();
    expect(second.data).toEqual(first.data);
    // Key order may differ after validation: the new file carries its own valid checksum.
    expect((await readBackup(JSON.stringify(second))).data).toEqual(first.data);
  });

  it('keeps the current data when the import fails midway', async () => {
    const pub = await device();
    const { t } = await evening(pub);
    const backup = await readBackup(JSON.stringify(await pub.exportBackup()));
    const name = `bt-transfer-${randomUUID()}`;
    const phone = await device(name);
    const mine = await phone.write((b) => b.createPlayer({ displayName: 'Solo qui' }));
    const add = IDBObjectStore.prototype.add;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['add']>
    ) {
      // Fails after the stores were cleared and some records were written again.
      if (++calls === 8) throw new DOMException('Disk full', 'QuotaExceededError');
      return add.apply(this, args);
    });
    expect(await code(phone.importBackup(backup, { replaceExisting: true }))).toBe('STORAGE_FULL');
    vi.restoreAllMocks();
    const players = (engine: LocalEngine) =>
      engine.read((_, s) => s.listPlayers({ limit: 100, offset: 0 })).items.map((p) => p.id);
    const tournament = (engine: LocalEngine) =>
      code(Promise.resolve().then(() => engine.read((b) => b.tournament(t.id))));
    // Nothing of the backup landed and nothing of the device was lost, in memory and on disk.
    expect(players(phone)).toEqual([mine.id]);
    expect(await tournament(phone)).toBe('NOT_FOUND');
    phone.close();
    const reopened = await device(name);
    expect(players(reopened)).toEqual([mine.id]);
    expect(await tournament(reopened)).toBe('NOT_FOUND');
    // A new attempt brings the whole evening.
    await reopened.importBackup(backup, { replaceExisting: true });
    expect(players(reopened)).toHaveLength(12);
    expect(await tournament(reopened)).toBe('NO_ERROR');
  });
});
