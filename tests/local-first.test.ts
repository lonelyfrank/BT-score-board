import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend, CommandName } from '../packages/application/src/index.js';
import { matchById, matchStandings, type Tournament } from '../packages/domain/src/index.js';
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
  name = `bt-local-first-${randomUUID()}`;
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
async function hiScoreNight(engine: LocalEngine, players = 6) {
  let t = await engine.write((b) =>
    b.createTournament({ name: 'Hi-Score Night', mode: 'QUICK_HIGH_SCORE' }),
  );
  for (let i = 0; i < players; i++) {
    const p = await engine.write((b) => b.createPlayer({ displayName: `Player ${i + 1}` }));
    t = await engine.write((b) => exec(b, t, 'RegisterPlayer', { playerId: p.id }));
  }
  return engine.write((b) => exec(b, t, 'StartTournament'));
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

describe('Local-first persistence of results', () => {
  it('keeps every recorded score across a restart of the app', async () => {
    const first = await open();
    let t = await hiScoreNight(first);
    const q = t.matches[0]!.id;
    t = await first.write((b) =>
      exec(b, t, 'RecordResult', { scores: { [t.entries[2]!.id]: 777 } }, q),
    );
    first.close();
    const reopened = await open();
    const restored = reopened.read((b) => b.tournament(t.id));
    expect(restored).toEqual(t);
    expect(matchStandings(restored, matchById(restored, q))[0]).toMatchObject({
      tournamentEntryId: t.entries[2]!.id,
      total: 777,
    });
  });
  it('saves nothing when the IndexedDB transaction fails, then records on retry', async () => {
    const engine = await open();
    let t = await hiScoreNight(engine);
    const q = t.matches[0]!.id;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Disk full', 'QuotaExceededError');
    });
    const body = { scores: { [t.entries[0]!.id]: 500 } };
    expect(await code(engine.write((b) => exec(b, t, 'RecordResult', body, q)))).toBe(
      'STORAGE_FULL',
    );
    expect(engine.read((b) => b.tournament(t.id))).toEqual(t);
    engine.close();
    const reopened = await open();
    expect(reopened.read((b) => b.tournament(t.id))).toEqual(t);
    t = await reopened.write((b) => exec(b, t, 'RecordResult', body, q));
    expect(matchById(t, q).result!.scores).toEqual({ [t.entries[0]!.id]: 500 });
  });
});

describe('Upgrade of data written before game modes', () => {
  /** A database at schema 1 holding records exactly as the previous app version wrote them. */
  async function legacyDatabase() {
    const old = await open({ database: { migrations: migrations.slice(0, 1) } });
    const p = await old.write((b) => b.createPlayer({ displayName: 'Veterano' }));
    let t = await old.write((b) =>
      b.createTournament({
        name: 'Torneo 2025',
        mode: 'QUICK_HIGH_SCORE',
        recording: 'turns',
        scoringConfiguration: { turns: 3 },
        tournamentConfiguration: { qualifiers: 2 },
      }),
    );
    t = await old.write((b) => exec(b, t, 'RegisterPlayer', { playerId: p.id }));
    old.close();
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    expect(raw.version).toBe(1);
    const tx = raw.transaction(['players', 'tournaments'], 'readwrite');
    const players = tx.objectStore('players');
    const tournaments = tx.objectStore('tournaments');
    for (const player of await request(players.getAll())) {
      delete player.avatar;
      players.put(player);
    }
    for (const tournament of await request(tournaments.getAll())) {
      delete tournament.gameMode;
      delete tournament.recording;
      delete tournament.tournamentConfiguration.groupRanking;
      tournaments.put(tournament);
    }
    await new Promise((resolve) => (tx.oncomplete = resolve));
    raw.close();
    return { tournamentId: t.id, playerId: p.id };
  }
  it('migrates schema 1 to the current schema in place, as Hi-Score with turn entry', async () => {
    const { tournamentId, playerId } = await legacyDatabase();
    const engine = await open();
    const t = engine.read((b) => b.tournament(tournamentId));
    expect(t).toMatchObject({ gameMode: 'HI_SCORE', recording: 'turns' });
    expect(t.tournamentConfiguration.groupRanking).toBeNull();
    expect(engine.read((b) => b.player(playerId)).avatar).toBeNull();
    expect(SCHEMA_VERSION).toBe(migrations.length);
  });
  it('imports a backup exported by the previous version through the same upgrade', async () => {
    const { tournamentId } = await legacyDatabase();
    // Read the legacy records without migrating them, as the old app exported them.
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, 1);
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
    expect(data.tournaments[0].gameMode).toBeUndefined();
    const file = {
      ...(await createBackup(
        data,
        { deviceId: 'old-phone', revision: 3, app: '0.2.0' },
        new Date().toISOString(),
      )),
      schemaVersion: 1,
    };
    const backup = await readBackup(JSON.stringify(file));
    expect(backup.data.tournaments[0]).toMatchObject({ gameMode: 'HI_SCORE', recording: 'turns' });
    name = `bt-local-first-${randomUUID()}`;
    const device = await open();
    await device.importBackup(backup, { replaceExisting: false });
    expect(device.read((b) => b.tournament(tournamentId)).gameMode).toBe('HI_SCORE');
  });
});
