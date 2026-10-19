import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../packages/application/src/index.js';
import { currentTurn, matchById, type Tournament } from '../packages/domain/src/index.js';
import {
  LocalEngine,
  SCHEMA_VERSION,
  migrations,
  readBackup,
  type EngineEvent,
  type Migration,
} from '../packages/local-store/src/index.js';

const engines: LocalEngine[] = [];
let name = '';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  name = `bt-test-${randomUUID()}`;
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
const key = () => randomUUID();
function openDB(dbName: string, version?: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function exec(
  b: Backend,
  t: Tournament,
  name: Parameters<Backend['execute']>[0],
  body: Record<string, unknown> = {},
  matchId?: string,
) {
  const m = matchId ? matchById(t, matchId) : undefined;
  return b.execute(
    name,
    t.id,
    { expectedVersion: t.version, ...(m ? { expectedMatchVersion: m.version } : {}), ...body },
    { matchId, idempotencyKey: key() },
  );
}
async function startedMatch(engine: LocalEngine, players = 4) {
  const ids: string[] = [];
  for (let i = 0; i < players; i++)
    ids.push((await engine.write((b) => b.createPlayer({ displayName: `Player ${i + 1}` }))).id);
  let t = await engine.write((b) =>
    b.createTournament({
      name: 'Venerdì',
      mode: 'QUICK_HIGH_SCORE',
      recording: 'turns',
      scoringConfiguration: { turns: 2 },
      tournamentConfiguration: { qualifiers: 2 },
    }),
  );
  for (const playerId of ids)
    t = await engine.write((b) => exec(b, t, 'RegisterPlayer', { playerId }));
  t = await engine.write((b) => exec(b, t, 'StartTournament'));
  const matchId = t.matches[0]!.id;
  t = await engine.write((b) => exec(b, t, 'StartMatch', {}, matchId));
  return { t, matchId };
}
/** Records and completes the current turn in one durable command, as the live keypad does. */
function submit(engine: LocalEngine, t: Tournament, matchId: string, score: number) {
  return engine.write((b) => {
    const turn = currentTurn(matchById(t, matchId))!;
    const recorded = exec(b, t, 'RecordScore', { turnId: turn.id, score }, matchId);
    return exec(b, recorded, 'CompleteTurn', { turnId: turn.id }, matchId);
  });
}
const code = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; name?: string }) => error.code ?? error.name,
  );

describe('IndexedDB persistence', () => {
  it('restores tournament, live match, current player and last score after reopening the app', async () => {
    const engine = await open();
    let { t, matchId } = await startedMatch(engine);
    t = await submit(engine, t, matchId, 140);
    engine.close();
    const reopened = await open();
    const restored = reopened.read((b) => b.tournament(t.id));
    expect(restored).toEqual(t);
    const live = reopened.read((b) => b.liveMatch(matchId));
    expect(live.status).toBe('active');
    expect(live.turnState.currentTurn!.participantId).toBe(t.entries[1]!.id);
    expect(live.scores.filter((s) => !s.voided).map((s) => s.score)).toEqual([140]);
    t = await submit(reopened, restored, matchId, 60);
    expect(matchById(t, matchId).scores).toHaveLength(2);
  });
  it('commits score and turn completion as one transaction and leaves no trace of rejected commands', async () => {
    const engine = await open();
    let { t, matchId } = await startedMatch(engine);
    const revision = engine.status().meta.revision;
    t = await submit(engine, t, matchId, 100);
    expect(engine.status().meta.revision).toBe(revision + 1);
    expect(await code(submit(engine, t, matchId, 181))).toBe('INVALID_SCORE');
    expect(engine.status().meta.revision).toBe(revision + 1);
    expect(engine.read((b) => b.tournament(t.id))).toEqual(t);
  });
  it('rolls back memory and disk when the IndexedDB transaction fails midway, then recovers', async () => {
    const engine = await open();
    const { t, matchId } = await startedMatch(engine);
    const before = await engine.exportBackup().then((b) => b.data);
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => {
      throw new DOMException('Disk full', 'QuotaExceededError');
    });
    expect(await code(submit(engine, t, matchId, 100))).toBe('STORAGE_FULL');
    expect(IDBObjectStore.prototype.add).not.toBe(add);
    vi.restoreAllMocks();
    expect(engine.read((b) => b.tournament(t.id))).toEqual(t);
    engine.close();
    const reopened = await open();
    expect((await reopened.exportBackup()).data).toEqual(before);
    const saved = await submit(reopened, t, matchId, 100);
    expect(matchById(saved, matchId).scores).toHaveLength(1);
  });
  it('accepts a double tap once: the stale repeat is rejected and an exact replay writes nothing', async () => {
    const engine = await open();
    const { t, matchId } = await startedMatch(engine);
    const results = await Promise.allSettled([
      submit(engine, t, matchId, 60),
      submit(engine, t, matchId, 60),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason.code).toBe('VERSION_CONFLICT');
    const saved = engine.read((b) => b.tournament(t.id));
    expect(matchById(saved, matchId).scores).toHaveLength(1);
    const turn = currentTurn(matchById(saved, matchId))!;
    const input = {
      expectedVersion: saved.version,
      expectedMatchVersion: matchById(saved, matchId).version,
      turnId: turn.id,
      score: 45,
    };
    const replayKey = key();
    const first = await engine.write((b) =>
      b.execute('RecordScore', t.id, input, { matchId, idempotencyKey: replayKey }),
    );
    const revision = engine.status().meta.revision;
    const replay = await engine.write((b) =>
      b.execute('RecordScore', t.id, input, { matchId, idempotencyKey: replayKey }),
    );
    expect(replay).toEqual(first);
    expect(engine.status().meta.revision).toBe(revision);
    engine.close();
    // After a restart the record is still known: the replay neither duplicates nor fails.
    const reopened = await open();
    const again = await reopened.write((b) =>
      b.execute('RecordScore', t.id, input, { matchId, idempotencyKey: replayKey }),
    );
    expect(matchById(again, matchId).scores.filter((s) => !s.voided)).toHaveLength(2);
  });
  it('rejects a write from a stale tab without overwriting the other tab, then continues', async () => {
    const one = await open();
    const { t, matchId } = await startedMatch(one);
    const two = await open();
    await submit(one, t, matchId, 100);
    expect(await code(two.write((b) => b.createPlayer({ displayName: 'Late' })))).toBe(
      'STALE_DATA',
    );
    // The stale tab reloaded: its state now includes the other tab's score.
    expect(
      matchById(
        two.read((b) => b.tournament(t.id)),
        matchId,
      ).scores,
    ).toHaveLength(1);
    await two.write((b) => b.createPlayer({ displayName: 'Late' }));
    one.close();
    const check = await open();
    expect(check.read((_, s) => s.listPlayers({ limit: 100, offset: 0 })).total).toBe(5);
    expect(
      matchById(
        check.read((b) => b.tournament(t.id)),
        matchId,
      ).scores,
    ).toHaveLength(1);
  });
  it('refreshes other tabs through BroadcastChannel after a commit', async () => {
    const channel = `bt-test-${randomUUID()}`;
    const one = await open({ channel });
    const two = await open({ channel });
    const changed = new Promise<EngineEvent>((resolve) => two.subscribe(resolve));
    await one.write((b) => b.createPlayer({ displayName: 'Shared' }));
    expect(await changed).toEqual({ type: 'changed', origin: 'remote' });
    expect(two.read((_, s) => s.listPlayers({ limit: 10, offset: 0 })).items[0]!.displayName).toBe(
      'Shared',
    );
  });
  it('reads the audit trail from IndexedDB without keeping it in memory', async () => {
    const engine = await open();
    const { t } = await startedMatch(engine);
    const audit = await engine.audit(t.id, 100);
    expect(audit.items.map((a) => a.type)).toEqual([
      'StartMatch',
      'StartTournament',
      'RegisterPlayer',
      'RegisterPlayer',
      'RegisterPlayer',
      'RegisterPlayer',
      'TournamentCreated',
    ]);
    expect(() => engine.read((_, s) => s.audit(t.id, { limit: 10, offset: 0 }))).toThrow(
      'local database',
    );
  });
});

describe('Backup and restore', () => {
  async function exported() {
    const engine = await open();
    let { t, matchId } = await startedMatch(engine);
    t = await submit(engine, t, matchId, 99);
    const backup = await engine.exportBackup();
    return { engine, t, text: JSON.stringify(backup), backup };
  }
  it('moves a complete archive to a new device with identical data and history', async () => {
    const { engine, t, text, backup } = await exported();
    const source = await engine.exportBackup();
    name = `bt-test-${randomUUID()}`;
    const device = await open();
    await device.importBackup(await readBackup(text), { replaceExisting: false });
    expect(device.read((b) => b.tournament(t.id))).toEqual(t);
    expect(await device.audit(t.id, 100)).toEqual(await engine.audit(t.id, 100));
    const copy = await device.exportBackup();
    expect(copy.data).toEqual(source.data);
    const meta = device.status().meta;
    expect(meta.deviceId).not.toBe(backup.source.deviceId);
    expect(meta.lastImport).toMatchObject({
      deviceId: backup.source.deviceId,
      exportedAt: backup.exportedAt,
    });
    expect(device.status().backupRecommended).toBe(false);
    // The live match continues on the new device.
    const live = device.read((b) => b.liveMatch(t.matches[0]!.id));
    expect(live.turnState.currentTurn!.participantId).toBe(t.entries[1]!.id);
  });
  it('rejects damaged, foreign, newer or inconsistent files before touching local data', async () => {
    const { text } = await exported();
    const file = JSON.parse(text);
    await expect(readBackup('{not json')).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    await expect(readBackup(JSON.stringify({ format: 'other' }))).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
    });
    await expect(
      readBackup(JSON.stringify({ ...file, schemaVersion: SCHEMA_VERSION + 1 })),
    ).rejects.toMatchObject({ code: 'BACKUP_UNSUPPORTED' });
    const tampered = structuredClone(file);
    tampered.data.tournaments[0].matches[0].scores[0].score = 180;
    await expect(readBackup(JSON.stringify(tampered))).rejects.toMatchObject({
      code: 'BACKUP_INTEGRITY',
    });
    // A consistent checksum is not enough: references are verified too.
    const orphan = structuredClone(file);
    orphan.data.players.shift();
    orphan.counts.players--;
    const { createBackup } = await import('../packages/local-store/src/backup.js');
    const resigned = await createBackup(orphan.data, orphan.source, orphan.exportedAt);
    await expect(readBackup(JSON.stringify(resigned))).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
    });
  });
  it('replaces existing data only after explicit confirmation, atomically', async () => {
    const { engine, text, t } = await exported();
    const other = await open({ database: { name: `bt-test-${randomUUID()}` } });
    await other.write((b) => b.createPlayer({ displayName: 'Only here' }));
    const backup = await readBackup(text);
    expect(await code(other.importBackup(backup, { replaceExisting: false }))).toBe(
      'CONFIRMATION_REQUIRED',
    );
    expect(
      other.read((_, s) => s.listPlayers({ limit: 10, offset: 0 })).items.map((p) => p.displayName),
    ).toEqual(['Only here']);
    await other.importBackup(backup, { replaceExisting: true });
    expect(other.read((b) => b.tournament(t.id))).toEqual(engine.read((b) => b.tournament(t.id)));
    expect(
      other.read((_, s) => s.listPlayers({ limit: 10, offset: 0 })).items.map((p) => p.displayName),
    ).not.toContain('Only here');
  });
  it('recommends a backup after a completed tournament and clears it after export', async () => {
    const engine = await open();
    let t = await engine.write((b) =>
      b.createTournament({
        name: 'Finale',
        mode: 'QUICK_HIGH_SCORE',
        recording: 'turns',
        scoringConfiguration: { turns: 1 },
        tournamentConfiguration: { qualifiers: 2 },
      }),
    );
    for (const displayName of ['A', 'B']) {
      const p = await engine.write((b) => b.createPlayer({ displayName }));
      t = await engine.write((b) => exec(b, t, 'RegisterPlayer', { playerId: p.id }));
    }
    t = await engine.write((b) => exec(b, t, 'StartTournament'));
    const play = async (matchId: string, scores: number[]) => {
      t = await engine.write((b) => exec(b, t, 'StartMatch', {}, matchId));
      for (const score of scores) t = await submit(engine, t, matchId, score);
    };
    await play(t.matches[0]!.id, [50, 40]);
    t = await engine.write((b) => exec(b, exec(b, t, 'FinalizeQualification'), 'GenerateFinal'));
    expect(engine.status().backupRecommended).toBe(false);
    await play(t.matches.at(-1)!.id, [60, 20]);
    t = await engine.write((b) => exec(b, t, 'CompleteTournament'));
    expect(engine.status().backupRecommended).toBe(true);
    await engine.exportBackup();
    expect(engine.status()).toMatchObject({
      backupRecommended: false,
      meta: { changesSinceBackup: 0 },
    });
    await engine.write((b) => b.createPlayer({ displayName: 'C' }));
    expect(engine.status().meta.changesSinceBackup).toBe(1);
  });
});

describe('Local schema and storage errors', () => {
  it('creates the schema once and upgrades existing data through ordered migrations', async () => {
    const engine = await open();
    await engine.write((b) => b.createPlayer({ displayName: '  Ada  ' }));
    engine.close();
    const raw = await openDB(name);
    expect(raw.version).toBe(SCHEMA_VERSION);
    expect([...raw.objectStoreNames].sort()).toEqual([
      'audit',
      'commands',
      'events',
      'meta',
      'outbox',
      'players',
      'tournaments',
    ]);
    raw.close();
    let runs = 0;
    const v2: Migration = async (_db, tx) => {
      runs++;
      let cursor = await tx.objectStore('players').openCursor();
      while (cursor) {
        await cursor.update({ ...cursor.value, displayName: cursor.value.displayName.trim() });
        cursor = await cursor.continue();
      }
    };
    const upgraded = await open({ database: { migrations: [...migrations, v2] } });
    expect(
      upgraded.read((_, s) => s.listPlayers({ limit: 10, offset: 0 })).items[0]!.displayName,
    ).toBe('Ada');
    upgraded.close();
    await open({ database: { migrations: [...migrations, v2] } });
    expect(runs).toBe(1);
  });
  it('refuses to open data written by a newer schema instead of discarding it', async () => {
    const raw = await openDB(name, SCHEMA_VERSION + 1);
    raw.close();
    expect(await code(open())).toBe('LOCAL_SCHEMA_NEWER');
  });
  it('closes an open tab when a newer version upgrades the database, and refuses further writes', async () => {
    const old = await open();
    const closed = new Promise<EngineEvent>((resolve) => old.subscribe(resolve));
    const newer = await open({ database: { migrations: [...migrations, () => undefined] } });
    expect(await closed).toEqual({ type: 'closed', reason: 'upgrade' });
    expect(await code(old.write((b) => b.createPlayer({ displayName: 'Lost?' })))).toBe(
      'STORAGE_CLOSED',
    );
    await newer.write((b) => b.createPlayer({ displayName: 'Saved' }));
  });
  it('reports missing IndexedDB clearly', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error Simulates a browser without IndexedDB.
    delete globalThis.indexedDB;
    try {
      expect(await code(open())).toBe('STORAGE_UNAVAILABLE');
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
