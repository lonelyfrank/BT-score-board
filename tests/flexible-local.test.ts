import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend, CommandName } from '../packages/application/src/index.js';
import { matchById, roundProgress, type Tournament } from '../packages/domain/src/index.js';
import {
  LocalEngine,
  SCHEMA_VERSION,
  createBackup,
  migrations,
  readBackup,
} from '../packages/local-store/src/index.js';

const engines: LocalEngine[] = [];
let name = '';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  name = `bt-flexible-${randomUUID()}`;
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.close());
  vi.restoreAllMocks();
});
async function open(options: Parameters<typeof LocalEngine.open>[0] = {}) {
  const engine = await LocalEngine.open({
    channel: null,
    ...options,
    database: { name, ...options.database },
  });
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
function request<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
/** A Hi-Score Night with pairs and singles, over several heats, rounds tracked when possible. */
async function night(engine: LocalEngine, count = 9) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++)
    ids.push((await engine.write((b) => b.createPlayer({ displayName: `Player ${i + 1}` }))).id);
  let t = await engine.write((b) =>
    b.createTournament({ name: 'Hi-Score Night', mode: 'QUICK_HIGH_SCORE', tracking: 'FLEXIBLE' }),
  );
  t = await engine.write((b) =>
    exec(b, t, 'ComposeEntries', {
      entries: [
        { playerIds: [ids[0], ids[1]], name: 'Coppia A' },
        ...ids.slice(2).map((id) => ({ playerIds: [id] })),
      ],
    }),
  );
  return { t: await engine.write((b) => exec(b, t, 'StartTournament')), players: ids };
}

describe('Heats and rounds on the device', () => {
  it('survives a refresh in the middle of a heat', async () => {
    const engine = await open();
    let { t } = await night(engine);
    const q = t.matches[0]!.id;
    const heat = matchById(t, q).heats[0]!;
    const team = t.entries[0]!.id;
    t = await engine.write((b) => exec(b, t, 'StartHeat', { heatId: heat.id }, q));
    t = await engine.write((b) =>
      exec(b, t, 'RecordRound', { entryId: team, round: 1, value: 81, advanceRotation: true }, q),
    );
    t = await engine.write((b) =>
      exec(b, t, 'RecordResult', { scores: { [heat.entryIds[1]!]: 420 } }, q),
    );
    engine.close();
    // The browser was closed: everything committed is back, the same heat at the board.
    const reopened = await open();
    const restored = reopened.read((b) => b.tournament(t.id));
    expect(restored).toEqual(t);
    const live = reopened.read((b) => b.liveMatch(q));
    expect(live.heatOverview.currentHeatId).toBe(heat.id);
    expect(live.rotationViews[0]).toMatchObject({
      entryId: team,
      current: t.entries[0]!.members[1]!.playerId,
    });
    expect(roundProgress(restored, matchById(restored, q), team).rounds[0]).toMatchObject({
      value: 81,
      status: 'recorded',
    });
    const next = await reopened.write((b) =>
      exec(b, restored, 'RecordRound', { entryId: team, round: 2, value: 60 }, q),
    );
    expect(matchById(next, q).rounds).toHaveLength(2);
  });
  it('commits a round atomically: a failed IndexedDB write leaves nothing behind', async () => {
    const engine = await open();
    const { t } = await night(engine);
    const q = t.matches[0]!.id;
    const before = await engine.exportBackup().then((b) => b.data);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Disk full', 'QuotaExceededError');
    });
    expect(
      await code(
        engine.write((b) =>
          exec(b, t, 'RecordRound', { entryId: t.entries[0]!.id, round: 1, value: 60 }, q),
        ),
      ),
    ).toBe('STORAGE_FULL');
    vi.restoreAllMocks();
    expect(engine.read((b) => b.tournament(t.id))).toEqual(t);
    engine.close();
    const reopened = await open();
    expect((await reopened.exportBackup()).data).toEqual(before);
  });
  it('rejects a round from a stale tab without overwriting the other tab', async () => {
    const one = await open();
    const { t } = await night(one);
    const q = t.matches[0]!.id;
    const two = await open();
    await one.write((b) =>
      exec(b, t, 'RecordRound', { entryId: t.entries[0]!.id, round: 1, value: 60 }, q),
    );
    expect(
      await code(
        two.write((b) =>
          exec(b, t, 'RecordRound', { entryId: t.entries[0]!.id, round: 1, value: 99 }, q),
        ),
      ),
    ).toBe('STALE_DATA');
    const reloaded = await open();
    const rounds = matchById(
      reloaded.read((b) => b.tournament(t.id)),
      q,
    ).rounds;
    expect(rounds.map((r) => r.value)).toEqual([60]);
  });
  it('moves teams, heats and rounds to another device through a backup', async () => {
    const engine = await open();
    let { t } = await night(engine);
    const q = t.matches[0]!.id;
    t = await engine.write((b) =>
      exec(b, t, 'RecordRound', { entryId: t.entries[0]!.id, round: 1, value: 100 }, q),
    );
    const text = JSON.stringify(await engine.exportBackup());
    name = `bt-flexible-${randomUUID()}`;
    const device = await open();
    await device.importBackup(await readBackup(text), { replaceExisting: false });
    const copy = device.read((b) => b.tournament(t.id));
    expect(copy).toEqual(t);
    expect(copy.entries[0]!.members).toHaveLength(2);
    expect(matchById(copy, q).heats.length).toBeGreaterThan(1);
  });
});

describe('Upgrade of data written by the previous version (schema 2)', () => {
  /** Strips everything schema 3 added, as the previous app version stored it. */
  function asSchema2(tournament: Record<string, any>) {
    delete tournament.tracking;
    delete tournament.tournamentConfiguration.heatCapacity;
    delete tournament.tournamentConfiguration.heatStrategy;
    delete tournament.tournamentConfiguration.x01Entry;
    for (const e of tournament.entries) {
      delete e.kind;
      delete e.name;
      delete e.members;
    }
    for (const m of tournament.matches) {
      delete m.heats;
      delete m.rounds;
      delete m.rotations;
      if (m.result) delete m.result.reconciliation;
    }
    return tournament;
  }
  async function schema2Database() {
    const old = await open({ database: { migrations: migrations.slice(0, 2) } });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push((await old.write((b) => b.createPlayer({ displayName: `Veterano ${i + 1}` }))).id);
    let t = await old.write((b) =>
      b.createTournament({ name: 'Serata 2025', mode: 'SINGLE_MATCH', gameMode: 'HI_SCORE' }),
    );
    for (const id of ids)
      t = await old.write((b) => exec(b, t, 'RegisterPlayer', { playerId: id }));
    t = await old.write((b) => exec(b, t, 'StartTournament'));
    const m = t.matches[0]!.id;
    t = await old.write((b) =>
      exec(b, t, 'RecordResult', { scores: { [t.entries[0]!.id]: 333 } }, m),
    );
    old.close();
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    expect(raw.version).toBe(2);
    const tx = raw.transaction(['tournaments'], 'readwrite');
    const store = tx.objectStore('tournaments');
    for (const tournament of await request(store.getAll())) store.put(asSchema2(tournament));
    await new Promise((resolve) => (tx.oncomplete = resolve));
    raw.close();
    return { tournamentId: t.id, matchId: m, players: ids };
  }
  it('migrates schema 2 in place: entries become singles, results and players intact', async () => {
    const { tournamentId, matchId, players } = await schema2Database();
    const engine = await open();
    expect(SCHEMA_VERSION).toBe(3);
    const t = engine.read((b) => b.tournament(tournamentId));
    expect(t.tracking).toBe('FINAL_ONLY');
    expect(t.entries.map((e) => [e.kind, e.members.map((m) => m.playerId)])).toEqual(
      players.map((id) => ['single', [id]]),
    );
    const m = matchById(t, matchId);
    expect(m).toMatchObject({ heats: [], rounds: [], rotations: [] });
    expect(m.result!.scores[t.entries[0]!.id]).toBe(333);
    expect(m.result!.reconciliation).toEqual([]);
    // The migrated tournament goes on with the new engine.
    const next = await engine.write((b) =>
      exec(b, t, 'RecordResult', { scores: { [t.entries[1]!.id]: 280 } }, matchId),
    );
    expect(matchById(next, matchId).result!.scores[t.entries[1]!.id]).toBe(280);
  });
  it('imports a schema 2 backup through the same upgrade', async () => {
    const { tournamentId } = await schema2Database();
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, 2);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = raw.transaction(['players', 'tournaments'], 'readonly');
    const data = {
      players: await request(tx.objectStore('players').getAll()),
      events: [],
      tournaments: await request(tx.objectStore('tournaments').getAll()),
      audit: [],
      outbox: [],
      commands: [],
    };
    raw.close();
    expect(data.tournaments[0].entries[0].members).toBeUndefined();
    const file = {
      ...(await createBackup(
        data,
        { deviceId: 'old-phone', revision: 9, app: '0.2.0' },
        new Date().toISOString(),
      )),
      schemaVersion: 2,
    };
    const backup = await readBackup(JSON.stringify(file));
    expect(backup.data.tournaments[0]!.entries[0]!.members).toHaveLength(1);
    name = `bt-flexible-${randomUUID()}`;
    const device = await open();
    await device.importBackup(backup, { replaceExisting: false });
    expect(device.read((b) => b.tournament(tournamentId)).entries[0]!.kind).toBe('single');
  });
});
