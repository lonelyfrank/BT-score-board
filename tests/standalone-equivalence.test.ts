import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Backend, sha256Hex, uuid, type Store } from '../packages/application/src/index.js';
import { SqliteStore } from '../packages/database/src/index.js';
import { MemoryStore } from '../packages/local-store/src/index.js';
import {
  currentTurn,
  matchById,
  type Context,
  type Tournament,
} from '../packages/domain/src/index.js';
import { command, fixture, play } from './helpers.js';

// Same ids and clock for both stores, so results must be identical value by value.
function deterministic(): Context {
  let id = 0,
    clock = Date.parse('2026-10-18T20:00:00.000Z');
  return {
    id: () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}`,
    now: () => new Date((clock += 1000)).toISOString(),
    operator: 'organizer',
    role: 'organizer',
  };
}
const sqliteStores: SqliteStore[] = [];
afterEach(() => sqliteStores.splice(0).forEach((s) => s.close()));
function both() {
  const sqlite = new SqliteStore(':memory:');
  sqliteStores.push(sqlite);
  const memory = new MemoryStore();
  return [
    { store: sqlite as Store, backend: new Backend(sqlite, deterministic()) },
    { store: memory as Store, backend: new Backend(memory, deterministic()) },
  ];
}
function attempt(work: () => unknown) {
  try {
    work();
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).name;
  }
}
// Observable state of a store after a scenario: everything a client or an export can read.
// Lineage stamps are random provenance kept by the local store only.
const withoutLineage = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value, (key, v) => (key === 'lineage' ? undefined : v)));
function observe(store: Store, backend: Backend, tournamentIds: string[]) {
  return withoutLineage(observeRaw(store, backend, tournamentIds));
}
function observeRaw(store: Store, backend: Backend, tournamentIds: string[]) {
  const all = { limit: 1000, offset: 0 };
  const players = store.listPlayers(all);
  return {
    players,
    tournaments: store.listTournaments(all),
    perTournament: tournamentIds.map((id) => ({
      tournament: backend.tournament(id),
      standings: backend.standings(id),
      audit: store.audit(id, all),
      events: store.events(id, 0, 1000),
      live: backend.tournament(id).matches.map((m) => backend.liveMatch(m.id)),
    })),
    statistics: players.items.map((p) => backend.statistics(p.id)),
    history: players.items.map((p) => backend.history(p.id, all)),
  };
}

function quickScenario(backend: Backend) {
  const errors: string[] = [];
  let t = fixture(backend, 8);
  t = command(backend, t, 'StartTournament');
  const q = t.matches[0]!.id;
  t = command(backend, t, 'StartMatch', {}, q);
  const first = currentTurn(matchById(t, q))!;
  errors.push(attempt(() => command(backend, t, 'CompleteTurn', { turnId: first.id }, q)));
  t = command(backend, t, 'RecordScore', { turnId: first.id, score: 45 }, q);
  // Undo and re-enter: the voided entry stays in history.
  const scoreId = matchById(t, q).scores[0]!.id;
  t = command(backend, t, 'VoidScore', { reason: 'Wrong player' }, undefined, scoreId);
  t = command(backend, t, 'RecordScore', { turnId: first.id, score: 100 }, q);
  t = command(backend, t, 'CompleteTurn', { turnId: first.id }, q);
  const stale = { ...t, version: t.version - 1 };
  errors.push(attempt(() => command(backend, stale, 'FinalizeQualification')));
  const scores = [100, 90, 80, 70, 70, 50, 40, 30];
  while (matchById(t, q).status === 'active') {
    const turn = currentTurn(matchById(t, q))!;
    const score = scores[t.entries.findIndex((e) => e.id === turn.participantId)]!;
    t = command(backend, t, 'RecordScore', { turnId: turn.id, score }, q);
    t = command(backend, t, 'CompleteTurn', { turnId: turn.id }, q);
  }
  errors.push(attempt(() => command(backend, t, 'FinalizeQualification')));
  const tied = t.entries.slice(3, 5).map((e) => e.id);
  t = command(backend, t, 'CreateTieBreak', { targetId: q, entryIds: tied });
  t = play(backend, t, t.matches.at(-1)!.id, (id) => (id === tied[1] ? 60 : 20));
  t = command(backend, t, 'FinalizeQualification');
  t = command(backend, t, 'GenerateFinal');
  errors.push(attempt(() => command(backend, t, 'GenerateFinal')));
  const final = t.matches.at(-1)!.id;
  t = play(backend, t, final, (id) => 10 + t.entries.findIndex((e) => e.id === id));
  t = command(backend, t, 'CompleteTournament');
  return { t, errors };
}
function groupScenario(backend: Backend) {
  let t = fixture(backend, 6, 'GROUPS', { groupCount: 2, qualifiersPerGroup: 2 });
  t = command(backend, t, 'StartTournament');
  for (const id of t.matches.map((m) => m.id)) t = play(backend, t, id);
  t = command(backend, t, 'FinalizeQualification');
  t = command(backend, t, 'GenerateFinal');
  while (t.status === 'active') {
    const ready = t.matches.find((m) => m.status === 'ready');
    if (ready) t = play(backend, t, ready.id);
    else t = command(backend, t, 'CompleteTournament');
  }
  return t;
}

describe('portable primitives', () => {
  it('computes the same SHA-256 as node:crypto, including multi-block and non-ASCII input', () => {
    for (const text of [
      '',
      'abc',
      'é🎯 Bite the Trouble',
      'x'.repeat(55),
      'y'.repeat(64),
      'z'.repeat(1000),
    ])
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
  });
  it('produces RFC 4122 v4 identifiers, also without crypto.randomUUID', () => {
    const original = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: undefined,
        configurable: true,
      });
      const id = uuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(new Set(Array.from({ length: 100 }, uuid)).size).toBe(100);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original,
        configurable: true,
      });
    }
  });
});

describe('Standalone store equivalence with SQLite', () => {
  it('produces identical tournaments, standings, statistics, audit and events for Quick High Score', () => {
    const [sqlite, memory] = both();
    const a = quickScenario(sqlite!.backend),
      b = quickScenario(memory!.backend);
    expect(a.errors).toEqual([
      'INCOMPLETE_TURN',
      'VERSION_CONFLICT',
      'TIE_REQUIRES_PLAYOFF',
      'QUALIFICATION_NOT_FINALIZED',
    ]);
    expect(b.errors).toEqual(a.errors);
    expect(b.t.status).toBe('completed');
    expect(observe(memory!.store, memory!.backend, [b.t.id])).toEqual(
      observe(sqlite!.store, sqlite!.backend, [a.t.id]),
    );
  });
  it('produces identical results for a group tournament with knockout', () => {
    const [sqlite, memory] = both();
    const a = groupScenario(sqlite!.backend),
      b = groupScenario(memory!.backend);
    expect(b.status).toBe('completed');
    expect(b.results).toHaveLength(6);
    expect(observe(memory!.store, memory!.backend, [b.id])).toEqual(
      observe(sqlite!.store, sqlite!.backend, [a.id]),
    );
  });
  it('replays an idempotent command and rejects a reused key with another payload in both stores', () => {
    for (const { backend } of both()) {
      let t = fixture(backend, 2, 'QUICK_HIGH_SCORE', { qualifiers: 2 });
      t = command(backend, t, 'StartTournament');
      const m = t.matches[0]!.id;
      t = command(backend, t, 'StartMatch', {}, m);
      const input = {
        expectedVersion: t.version,
        expectedMatchVersion: matchById(t, m).version,
        turnId: currentTurn(matchById(t, m))!.id,
        score: 60,
      };
      const key = randomUUID();
      const first = backend.execute('RecordScore', t.id, input, {
        matchId: m,
        idempotencyKey: key,
      });
      expect(
        backend.execute('RecordScore', t.id, input, { matchId: m, idempotencyKey: key }),
      ).toEqual(first);
      expect(
        attempt(() =>
          backend.execute(
            'RecordScore',
            t.id,
            { ...input, score: 61 },
            { matchId: m, idempotencyKey: key },
          ),
        ),
      ).toBe('IDEMPOTENCY_CONFLICT');
      expect(matchById(backend.tournament(t.id), m).scores).toHaveLength(1);
    }
  });
  it('rolls back every write of a failed command, like a SQLite transaction', () => {
    const store = new MemoryStore();
    const backend = new Backend(store);
    let t: Tournament = fixture(backend, 2, 'QUICK_HIGH_SCORE', { qualifiers: 2 });
    t = command(backend, t, 'StartTournament');
    const m = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, m);
    const before = backend.tournament(t.id);
    const auditBefore = store.audit(t.id, { limit: 1000, offset: 0 });
    const original = store.appendEvent.bind(store);
    store.appendEvent = () => {
      throw new Error('Simulated failure');
    };
    const turn = currentTurn(matchById(t, m))!;
    expect(() => command(backend, t, 'RecordScore', { turnId: turn.id, score: 60 }, m)).toThrow(
      'Simulated',
    );
    store.appendEvent = original;
    expect(backend.tournament(t.id)).toEqual(before);
    expect(store.audit(t.id, { limit: 1000, offset: 0 })).toEqual(auditBefore);
    t = command(backend, t, 'RecordScore', { turnId: turn.id, score: 60 }, m);
    expect(matchById(t, m).scores).toHaveLength(1);
  });
  it('rejects aggregates that would violate the SQLite constraints', () => {
    const store = new MemoryStore();
    const backend = new Backend(store);
    let t = fixture(backend, 2, 'QUICK_HIGH_SCORE', { qualifiers: 2 });
    t = command(backend, t, 'StartTournament');
    const m = t.matches[0]!.id;
    t = command(backend, t, 'StartMatch', {}, m);
    const turn = currentTurn(matchById(t, m))!;
    t = command(backend, t, 'RecordScore', { turnId: turn.id, score: 60 }, m);
    const corrupt = structuredClone(t);
    const score = matchById(corrupt, m).scores[0]!;
    matchById(corrupt, m).scores.push({ ...score, id: randomUUID() });
    expect(attempt(() => store.transaction(() => store.saveTournament(corrupt, t.version)))).toBe(
      'INTEGRITY_CONFLICT',
    );
    const orphan = structuredClone(t);
    orphan.entries[0]!.playerId = randomUUID();
    expect(attempt(() => store.transaction(() => store.saveTournament(orphan, t.version)))).toBe(
      'INTEGRITY_CONFLICT',
    );
    expect(backend.tournament(t.id)).toEqual(t);
  });
});
