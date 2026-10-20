import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Backend, CommandName } from '../packages/application/src/index.js';
import { buildApp } from '../apps/api/src/server/app.js';
import { readConfig } from '../apps/api/src/server/config.js';
import {
  matchById,
  roundProgress,
  turnPlan,
  type DartThrow,
  type Tournament,
} from '../packages/domain/src/index.js';
import { LocalEngine, readBackup } from '../packages/local-store/src/index.js';

const S = (sector: number): DartThrow => ({ kind: 'single', sector });
const T = (sector: number): DartThrow => ({ kind: 'triple', sector });
const MISS: DartThrow = { kind: 'miss', sector: null };

const engines: LocalEngine[] = [];
let name = '';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  name = `bt-guided-${randomUUID()}`;
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.close());
  vi.restoreAllMocks();
});
async function open() {
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
  key = randomUUID(),
) {
  const m = matchId ? matchById(t, matchId) : undefined;
  return b.execute(
    command,
    t.id,
    { expectedVersion: t.version, ...(m ? { expectedMatchVersion: m.version } : {}), ...body },
    { matchId, idempotencyKey: key },
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
/** A guided Hi-Score: a pair and two singles, rounds tracked. */
async function evening(engine: LocalEngine) {
  const ids: string[] = [];
  for (const n of ['Frank', 'Marco', 'Salvo', 'Luca'])
    ids.push((await engine.write((b) => b.createPlayer({ displayName: n }))).id);
  let t = await engine.write((b) =>
    b.createTournament({
      name: 'Hi-Score guidato',
      mode: 'SINGLE_MATCH',
      gameMode: 'HI_SCORE',
      tracking: 'FLEXIBLE',
    }),
  );
  t = await engine.write((b) =>
    exec(b, t, 'ComposeEntries', {
      entries: [{ playerIds: [ids[0], ids[1]] }, { playerIds: [ids[2]] }, { playerIds: [ids[3]] }],
    }),
  );
  t = await engine.write((b) => exec(b, t, 'StartTournament'));
  return { t, m: t.matches[0]!.id, players: ids };
}
const plan = (t: Tournament, m: string) => turnPlan(t, matchById(t, m));
async function confirm(
  engine: LocalEngine,
  t: Tournament,
  m: string,
  body: Record<string, unknown>,
) {
  const current = plan(t, m).current!;
  return engine.write((b) =>
    exec(b, t, 'RecordTurn', { entryId: current.entryId, round: current.round, ...body }, m),
  );
}

describe('Scenario H: resume after closing the app', () => {
  it('restores match, round, player at the board, values and next thrower', async () => {
    const engine = await open();
    let { t, m, players } = await evening(engine);
    t = await confirm(engine, t, m, { darts: [S(20), MISS, T(20)] }); // Frank 80
    t = await confirm(engine, t, m, { value: 85 }); // Salvo
    t = await confirm(engine, t, m, { value: 60 }); // Luca
    const before = engine.read((b) => b.liveMatch(m));
    expect(before.turnPlans[0]).toMatchObject({
      round: 2,
      current: { entryId: t.entries[0]!.id, round: 2, playerId: players[1] }, // Marco
      next: { entryId: t.entries[1]!.id, round: 2, playerId: players[2] },
    });
    engine.close();
    const reopened = await open();
    const after = reopened.read((b) => b.liveMatch(m));
    expect(after.turnPlans).toEqual(before.turnPlans);
    expect(after.progress).toEqual(before.progress);
    expect(after.progress[0]!.rounds[0]).toMatchObject({
      value: 80,
      darts: [S(20), MISS, T(20)],
      state: 'complete',
    });
    // The organizer goes on from the same turn.
    const restored = reopened.read((b) => b.tournament(t.id));
    const next = await confirm(reopened, restored, m, { value: 41 });
    expect(plan(next, m).current).toMatchObject({ entryId: t.entries[1]!.id, round: 2 });
  });
});

describe('Scenario I: integrity on the device', () => {
  it('saves a double tap once', async () => {
    const engine = await open();
    const { t, m } = await evening(engine);
    const current = plan(t, m).current!;
    const key = randomUUID();
    const body = { entryId: current.entryId, round: current.round, value: 60 };
    const [one, two] = await Promise.all([
      engine.write((b) => exec(b, t, 'RecordTurn', body, m, key)),
      engine.write((b) => exec(b, t, 'RecordTurn', body, m, key)),
    ]);
    expect(two).toEqual(one);
    expect(
      matchById(
        engine.read((b) => b.tournament(t.id)),
        m,
      ).rounds,
    ).toHaveLength(1);
    // A second tap with another key, from the same stale screen, is refused.
    expect(await code(engine.write((b) => exec(b, t, 'RecordTurn', body, m)))).toBe(
      'VERSION_CONFLICT',
    );
  });
  it('refuses a turn from a tab that did not see the other tab move on', async () => {
    const one = await open();
    const { t, m } = await evening(one);
    const two = await open();
    await confirm(one, t, m, { value: 60 });
    expect(await code(confirm(two, t, m, { value: 99 }))).toBe('STALE_DATA');
    const reloaded = await open();
    const fresh = reloaded.read((b) => b.tournament(t.id));
    expect(matchById(fresh, m).rounds.map((r) => r.value)).toEqual([60]);
    expect(plan(fresh, m).current!.entryId).toBe(t.entries[1]!.id);
  });
  it('does not move to the next player when IndexedDB fails', async () => {
    const engine = await open();
    const { t, m } = await evening(engine);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Disk full', 'QuotaExceededError');
    });
    expect(await code(confirm(engine, t, m, { darts: [T(20), T(20), T(20)] }))).toBe(
      'STORAGE_FULL',
    );
    vi.restoreAllMocks();
    const live = engine.read((b) => b.liveMatch(m));
    expect(live.rounds).toEqual([]);
    expect(live.turnPlans[0]!.current).toMatchObject({ entryId: t.entries[0]!.id, round: 1 });
  });
  it('keeps darts and coordinator choices through a backup', async () => {
    const engine = await open();
    let { t, m } = await evening(engine);
    t = await confirm(engine, t, m, { darts: [S(20), MISS, T(20)] });
    t = await confirm(engine, t, m, { value: 85 });
    t = await engine.write((b) => exec(b, t, 'GuideTurn', { action: 'undo' }, m));
    t = await engine.write((b) => exec(b, t, 'GuideTurn', { action: 'pause' }, m));
    const text = JSON.stringify(await engine.exportBackup());
    name = `bt-guided-${randomUUID()}`;
    const device = await open();
    await device.importBackup(await readBackup(text), { replaceExisting: false });
    const copy = device.read((b) => b.tournament(t.id));
    expect(copy).toEqual(t);
    expect(matchById(copy, m).rounds[0]!.darts).toEqual([S(20), MISS, T(20)]);
    expect(matchById(copy, m).guide).toEqual({
      pick: null,
      replay: [{ entryId: t.entries[1]!.id, round: 1 }],
      paused: true,
    });
    expect(device.read((b) => b.liveMatch(m)).turnPlans).toEqual(
      engine.read((b) => b.liveMatch(m)).turnPlans,
    );
  });
  it('reads a V1.2 match with value-only rounds and goes on guided', async () => {
    const engine = await open();
    let { t, m } = await evening(engine);
    t = await engine.write((b) =>
      exec(
        b,
        t,
        'RecordRound',
        { entryId: t.entries[0]!.id, round: 1, value: 60, advanceRotation: true },
        m,
      ),
    );
    t = await engine.write((b) =>
      exec(b, t, 'RecordRound', { entryId: t.entries[1]!.id, round: 1, value: 45 }, m),
    );
    engine.close();
    // As V1.2 stored it: no darts on the rounds, no guide on the match.
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = raw.transaction(['tournaments'], 'readwrite');
    const store = tx.objectStore('tournaments');
    for (const stored of await request(store.getAll())) {
      for (const match of stored.matches) {
        delete match.guide;
        for (const r of match.rounds) delete r.darts;
      }
      store.put(stored);
    }
    await new Promise((resolve) => (tx.oncomplete = resolve));
    raw.close();
    const reopened = await open();
    const old = reopened.read((b) => b.tournament(t.id));
    expect(matchById(old, m).rounds[0]!.darts).toBeUndefined();
    const live = reopened.read((b) => b.liveMatch(m));
    expect(live.progress[0]!.rounds[0]).toMatchObject({
      value: 60,
      darts: null,
      state: 'complete',
    });
    // Luca is next: the position follows from the old rounds, nothing invented.
    expect(live.turnPlans[0]!.current).toMatchObject({ entryId: t.entries[2]!.id, round: 1 });
    const next = await confirm(reopened, old, m, { darts: [S(1), S(2), S(3)] });
    expect(roundProgress(next, matchById(next, m), t.entries[2]!.id).rounds[0]!.value).toBe(6);
    // The old records come out of a backup with explicit nulls, still equivalent.
    const backup = await readBackup(JSON.stringify(await reopened.exportBackup()));
    const copy = backup.data.tournaments.find((x) => x.id === t.id)!;
    expect(copy.matches[0]!.rounds[0]!.darts).toBeNull();
  });
});

describe('Shared mode (Fastify + SQLite)', () => {
  const token = 'test-only-organizer-secret-with-32-characters';
  let app: FastifyInstance;
  afterEach(async () => app?.close());
  async function call(method: 'GET' | 'POST', url: string, payload?: unknown, key?: string) {
    const response = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });
    return { status: response.statusCode, body: response.json() };
  }
  it('confirms guided turns over HTTP with the same rules', async () => {
    app = await buildApp(
      readConfig({
        ORGANIZER_TOKEN: token,
        DATABASE_PATH: ':memory:',
        LOG_LEVEL: 'silent',
        RATE_LIMIT_MAX: '10000',
      }),
    );
    const ids: string[] = [];
    for (const n of ['Frank', 'Salvo'])
      ids.push((await call('POST', '/players', { displayName: n })).body.id);
    let t: Tournament = (
      await call('POST', '/tournaments', {
        name: 'Condivisa',
        mode: 'SINGLE_MATCH',
        gameMode: 'HI_SCORE',
        tracking: 'FLEXIBLE',
      })
    ).body;
    const post = async (path: string, body: Record<string, unknown>, key = randomUUID()) =>
      call('POST', path, { expectedVersion: t.version, ...body }, key);
    t = (
      await post(`/tournaments/${t.id}/entries/compose`, {
        entries: ids.map((id) => ({ playerIds: [id] })),
      })
    ).body;
    t = (await post(`/tournaments/${t.id}/start`, {})).body;
    const m = t.matches[0]!;
    const turn = { expectedMatchVersion: m.version, entryId: t.entries[0]!.id, round: 1 };
    // Without a key the turn is refused, as RecordRound and RecordScore.
    expect(
      (
        await call('POST', `/matches/${m.id}/turns/record`, {
          expectedVersion: t.version,
          ...turn,
          value: 1,
        })
      ).status,
    ).toBe(400);
    const saved = await post(`/matches/${m.id}/turns/record`, {
      ...turn,
      darts: [S(20), MISS, T(20)],
    });
    expect(saved.status).toBe(200);
    t = saved.body;
    const live = (await call('GET', `/matches/${m.id}`)).body;
    expect(live.rounds[0]).toMatchObject({ value: 80, darts: [S(20), MISS, T(20)] });
    expect(live.turnPlans[0].current).toMatchObject({ entryId: t.entries[1]!.id, round: 1 });
    const stale = await post(`/matches/${m.id}/turns/record`, {
      ...turn,
      expectedMatchVersion: matchById(t, m.id).version,
      value: 60,
    });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'TURN_MOVED']);
    const undo = await post(`/matches/${m.id}/turns/guide`, {
      expectedMatchVersion: matchById(t, m.id).version,
      action: 'undo',
    });
    expect(undo.status).toBe(200);
    expect(matchById(undo.body, m.id).guide!.replay).toEqual([
      { entryId: t.entries[0]!.id, round: 1 },
    ]);
  });
});
