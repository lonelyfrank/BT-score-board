import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backend } from '../packages/application/src/index.js';
import { SqliteStore } from '../packages/database/src/index.js';
import { command, fixture, setup } from './helpers.js';
import { currentTurn, matchById } from '../packages/domain/src/index.js';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { migration1 } from '../packages/database/src/migrations/0001.js';
import { MemoryStore } from '../packages/local-store/src/index.js';
const stores: SqliteStore[] = [],
  directories: string[] = [];
function disk() {
  const dir = mkdtempSync(join(tmpdir(), 'bt-test-'));
  directories.push(dir);
  return join(dir, 'darts.sqlite');
}
function open(path = ':memory:') {
  const r = setup(path);
  stores.push(r.store);
  return r;
}
afterEach(() => {
  for (const s of stores.splice(0)) if (s.sqlite.open) s.close();
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe('SQLite reliability', () => {
  it('applies migrations once, enables FKs/WAL and preserves in-progress turns and idempotency after restart', () => {
    const path = disk();
    let { store, backend } = open(path);
    let t = fixture(backend, 4);
    t = command(backend, t, 'StartTournament');
    const id = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, id);
    const turn = currentTurn(matchById(t, id))!;
    const input = {
      expectedVersion: t.version,
      expectedMatchVersion: matchById(t, id).version,
      turnId: turn.id,
      score: 120,
    };
    const key = randomUUID();
    t = backend.execute('RecordScore', t.id, input, { matchId: id, idempotencyKey: key });
    store.close();
    ({ store, backend } = open(path));
    expect(store.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(store.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(store.sqlite.prepare('SELECT count(*) n FROM schema_migrations').get()).toEqual({
      n: 3,
    });
    expect(backend.tournament(t.id)).toEqual(t);
    expect(
      backend.execute('RecordScore', t.id, input, { matchId: id, idempotencyKey: key }),
    ).toEqual(t);
    expect(matchById(backend.tournament(t.id), id).scores).toHaveLength(1);
    t = command(backend, t, 'CompleteTurn', { turnId: turn.id }, id);
    expect(currentTurn(matchById(t, id))!.id).not.toBe(turn.id);
  });
  it('rolls back aggregate, normalized scores, audit, events and key when a transaction fails', () => {
    const { store, backend } = open();
    let t = fixture(backend, 4);
    t = command(backend, t, 'StartTournament');
    const id = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, id);
    const turn = currentTurn(matchById(t, id))!,
      key = randomUUID();
    const before = store.events(t.id, 0, 100);
    const spy = vi.spyOn(store, 'appendAudit').mockImplementationOnce(() => {
      throw new Error('Simulated disk failure');
    });
    expect(() =>
      command(backend, t, 'RecordScore', { turnId: turn.id, score: 60 }, id, undefined, key),
    ).toThrow('disk');
    spy.mockRestore();
    expect(backend.tournament(t.id)).toEqual(t);
    expect(store.sqlite.prepare('SELECT count(*) n FROM score_entries').get()).toEqual({ n: 0 });
    expect(store.events(t.id, 0, 100)).toEqual(before);
    expect(store.getIdempotency(key)).toBeUndefined();
    t = command(backend, t, 'RecordScore', { turnId: turn.id, score: 60 }, id, undefined, key);
    expect(matchById(t, id).scores).toHaveLength(1);
  });
  it('rejects stale writes from independent SQLite connections and mismatched match versions', () => {
    const path = disk();
    const one = open(path);
    const two = open(path);
    let t = fixture(one.backend, 4);
    const old = two.backend.tournament(t.id);
    t = command(one.backend, t, 'StartTournament');
    expect(() => command(two.backend, old, 'StartTournament')).toThrow('version');
    const m = t.matches[0]!;
    expect(() =>
      command(two.backend, t, 'StartMatch', { expectedMatchVersion: 999 }, m.id),
    ).toThrow('version');
    expect(two.backend.tournament(t.id)).toEqual(t);
  });
  it('replays exact requests, rejects reused keys with new payloads and protects against duplicate score slots', () => {
    const { backend } = open();
    let t = fixture(backend, 4);
    t = command(backend, t, 'StartTournament');
    const m = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, m);
    const turn = currentTurn(matchById(t, m))!;
    const key = randomUUID();
    const input = {
      expectedVersion: t.version,
      expectedMatchVersion: matchById(t, m).version,
      turnId: turn.id,
      score: 90,
    };
    const result = backend.execute('RecordScore', t.id, input, { matchId: m, idempotencyKey: key });
    expect(
      backend.execute('RecordScore', t.id, input, { matchId: m, idempotencyKey: key }),
    ).toEqual(result);
    expect(() =>
      backend.execute(
        'RecordScore',
        t.id,
        { ...input, score: 89 },
        { matchId: m, idempotencyKey: key },
      ),
    ).toThrow('different');
    expect(() =>
      command(backend, result, 'RecordScore', { turnId: turn.id, score: 90 }, m),
    ).toThrow('already');
    expect(() => backend.execute('RecordScore', t.id, input, { matchId: m })).toThrow(
      'Idempotency',
    );
  });
  it('enforces database constraints and append-only audit even outside HTTP', () => {
    const { store, backend } = open();
    const t = fixture(backend, 4),
      entry = t.entries[0]!;
    expect(() =>
      store.sqlite
        .prepare(
          'INSERT INTO tournament_entries (id,tournament_id,player_id,data) VALUES (?,?,?,?)',
        )
        .run(randomUUID(), t.id, entry.playerId, '{}'),
    ).toThrow('UNIQUE');
    expect(() =>
      store.sqlite
        .prepare(
          'INSERT INTO tournament_entries (id,tournament_id,player_id,data) VALUES (?,?,?,?)',
        )
        .run(randomUUID(), t.id, randomUUID(), '{}'),
    ).toThrow('FOREIGN KEY');
    expect(() => store.sqlite.exec('DELETE FROM audit_log')).toThrow('append only');
    expect(() => store.sqlite.exec("UPDATE audit_log SET data='{}'")).toThrow('append only');
  });
  it('makes a live SQLite backup that can be restored independently', async () => {
    const path = disk();
    const { store, backend } = open(path);
    const t = fixture(backend, 4);
    const backup = disk();
    await store.sqlite.backup(backup);
    const restored = open(backup);
    expect(restored.backend.tournament(t.id)).toEqual(t);
    expect(restored.store.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  });
  it('upgrades a 0001 database: legacy tournaments read as Hi-Score, single matches allowed', () => {
    const path = disk();
    const legacy = new Backend(new MemoryStore()).createTournament({
      playSpaceId: '00000000-0000-4000-8000-00000000b7d1',
      name: 'Old night',
      mode: 'QUICK_HIGH_SCORE',
      recording: 'turns',
    }) as unknown as Record<string, unknown>;
    delete legacy.gameMode;
    delete legacy.recording;
    const db = new Database(path);
    db.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    db.exec(migration1);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(
      1,
      createHash('sha256').update(migration1).digest('hex'),
      new Date().toISOString(),
    );
    db.prepare(
      'INSERT INTO tournaments (id, event_id, name, mode, status, version, data) VALUES (?, NULL, ?, ?, ?, 0, ?)',
    ).run(legacy.id, legacy.name, legacy.mode, legacy.status, JSON.stringify(legacy));
    db.close();
    const { store, backend } = open(path);
    expect(store.sqlite.prepare('SELECT max(version) v FROM schema_migrations').get()).toEqual({
      v: 3,
    });
    expect(backend.tournament(legacy.id as string)).toMatchObject({
      gameMode: 'HI_SCORE',
      recording: 'turns',
    });
    const single = backend.createTournament({
      playSpaceId: '00000000-0000-4000-8000-00000000b7d1',
      name: 'Free',
      mode: 'SINGLE_MATCH',
      gameMode: '501',
    });
    expect(backend.tournament(single.id).mode).toBe('SINGLE_MATCH');
    expect(store.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
  it('rejects migration checksum drift', () => {
    const path = disk();
    const { store } = open(path);
    store.sqlite.prepare("UPDATE schema_migrations SET checksum='tampered'").run();
    store.close();
    expect(() => new SqliteStore(path)).toThrow('checksum');
  });
  it('enforces organizer authorization at the application boundary', () => {
    const { store } = open();
    const spectator = new Backend(store, {
      id: randomUUID,
      now: () => new Date().toISOString(),
      operator: 'spectator',
      role: 'spectator',
    });
    expect(() => spectator.createPlayer({ displayName: 'Unauthorized' })).toThrow('Organizer');
  });
});
