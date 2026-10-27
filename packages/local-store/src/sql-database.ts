import { uuid } from '../../application/src/portable.js';
import {
  DomainError,
  upgradePlayer,
  upgradeTournament,
  type Player,
  type Tournament,
} from '../../domain/src/index.js';
import type { ChangeSet, CommandRecord } from './memory-store.js';
import type { BackupData, LoadedState, LocalMeta, SocialData } from './indexeddb.js';
import type { EngineDatabase } from './engine.js';

/**
 * The synchronous SQL of a Cloudflare Durable Object (`ctx.storage`). Tests drive the same
 * interface over better-sqlite3.
 */
export interface SqlHost {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(work: () => T): T;
}

type Store = keyof BackupData | 'meta';
const keyOf: Record<Store, (value: never) => string> = {
  meta: () => 'local',
  players: (p: { id: string }) => p.id,
  events: (e: { id: string }) => e.id,
  tournaments: (t: { id: string }) => t.id,
  audit: (a: { sequence: number }) => String(a.sequence),
  outbox: (o: { sequence: number }) => String(o.sequence),
  commands: (c: { key: string }) => c.key,
  crews: (c: { id: string }) => c.id,
  cards: (c: { playerId: string }) => c.playerId,
  links: (l: { from: string }) => l.from,
};

/**
 * The engine's stores as rows of one table: the same records IndexedDB keeps, so a backup moves
 * between a phone and the server unchanged. Every write runs in one SQL transaction and checks
 * the revision, as a commit between tabs does.
 */
export class SqlEngineDatabase implements EngineDatabase {
  constructor(
    private readonly host: SqlHost,
    now: () => string = () => new Date().toISOString(),
  ) {
    host.sql.exec(
      'CREATE TABLE IF NOT EXISTS engine_records (store TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER, tournament_id TEXT, created_at TEXT, data TEXT NOT NULL, PRIMARY KEY (store, key))',
    );
    host.sql.exec(
      'CREATE INDEX IF NOT EXISTS engine_records_tournament ON engine_records (store, tournament_id, seq)',
    );
    if (!this.meta())
      this.put('meta', {
        key: 'local',
        deviceId: uuid(),
        createdAt: now(),
        revision: 0,
        lastCommitAt: null,
        lastBackupAt: null,
        changesSinceBackup: 0,
        lastImport: null,
      } satisfies LocalMeta);
  }
  private rows<T>(store: Store, where = '', ...bindings: unknown[]): T[] {
    return this.host.sql
      .exec(`SELECT data FROM engine_records WHERE store = ? ${where}`, store, ...bindings)
      .toArray()
      .map((row) => JSON.parse(row.data as string) as T);
  }
  private meta(): LocalMeta | undefined {
    return this.rows<LocalMeta>('meta')[0];
  }
  private put(store: Store, value: object, insert = false) {
    const record = value as { sequence?: number; tournamentId?: string | null; createdAt?: string };
    this.host.sql.exec(
      `${insert ? 'INSERT' : 'INSERT OR REPLACE'} INTO engine_records (store, key, seq, tournament_id, created_at, data) VALUES (?, ?, ?, ?, ?, ?)`,
      store,
      keyOf[store](value as never),
      record.sequence ?? null,
      store === 'audit' || store === 'outbox' ? (record.tournamentId ?? null) : null,
      store === 'commands' ? (record.createdAt ?? null) : null,
      JSON.stringify(value),
    );
  }
  /** Runs `work` in one transaction after checking that nobody committed since `expected`. */
  private change(expected: number, work: (meta: LocalMeta) => LocalMeta): LocalMeta {
    return this.host.transactionSync(() => {
      const meta = this.meta()!;
      if (meta.revision !== expected)
        throw new DomainError('STALE_DATA', 'The data was changed by another request', 409);
      const next = work(meta);
      this.put('meta', next);
      return next;
    });
  }
  private social(): SocialData {
    return { crews: this.rows('crews'), cards: this.rows('cards'), links: this.rows('links') };
  }
  private lastSequence(store: 'audit' | 'outbox') {
    const row = this.host.sql
      .exec('SELECT MAX(seq) AS seq FROM engine_records WHERE store = ?', store)
      .toArray()[0];
    return (row?.seq as number | null) ?? 0;
  }

  async load(commandsSince: string): Promise<LoadedState> {
    return {
      snapshot: {
        players: this.rows<Player>('players').map(upgradePlayer),
        events: this.rows('events'),
        tournaments: this.rows<Tournament>('tournaments').map(upgradeTournament),
        commands: this.rows<CommandRecord>('commands', 'AND created_at >= ?', commandsSince),
      },
      social: this.social(),
      sequences: { audit: this.lastSequence('audit'), outbox: this.lastSequence('outbox') },
      meta: this.meta()!,
    };
  }
  async commit(changes: ChangeSet, expectedRevision: number, now: string): Promise<LocalMeta> {
    return this.change(expectedRevision, (meta) => {
      for (const p of changes.players) this.put('players', p);
      for (const e of changes.events) this.put('events', e);
      for (const t of changes.tournaments) this.put('tournaments', t);
      for (const a of changes.audit) this.put('audit', a, true);
      for (const o of changes.outbox) this.put('outbox', o, true);
      for (const c of changes.commands) this.put('commands', c);
      return {
        ...meta,
        revision: meta.revision + 1,
        lastCommitAt: now,
        changesSinceBackup: meta.changesSinceBackup + 1,
      };
    });
  }
  async exportAll(): Promise<{ data: BackupData; meta: LocalMeta }> {
    const ordered = 'ORDER BY seq';
    return {
      data: {
        players: this.rows('players'),
        events: this.rows('events'),
        tournaments: this.rows('tournaments'),
        audit: this.rows('audit', ordered),
        outbox: this.rows('outbox', ordered),
        commands: this.rows('commands'),
        ...this.social(),
      },
      meta: this.meta()!,
    };
  }
  async replaceAll(
    data: BackupData,
    source: { deviceId: string; exportedAt: string },
    expectedRevision: number,
    now: string,
    kind: 'restore' | 'merge' = 'restore',
  ): Promise<LocalMeta> {
    return this.change(expectedRevision, (meta) => {
      this.host.sql.exec("DELETE FROM engine_records WHERE store <> 'meta'");
      for (const [store, values] of Object.entries(data) as [keyof BackupData, object[]][])
        for (const value of values) this.put(store, value, true);
      return {
        ...meta,
        revision: meta.revision + 1,
        lastCommitAt: now,
        ...(kind === 'restore'
          ? { lastBackupAt: source.exportedAt, changesSinceBackup: 0 }
          : { changesSinceBackup: meta.changesSinceBackup + 1 }),
        lastImport: { at: now, ...source },
      };
    });
  }
  async writeSocial(
    changes: Partial<SocialData> & { deleteCrews?: string[] },
    expectedRevision: number,
    now: string,
  ): Promise<LocalMeta> {
    return this.change(expectedRevision, (meta) => {
      for (const c of changes.crews ?? []) this.put('crews', c);
      for (const id of changes.deleteCrews ?? [])
        this.host.sql.exec("DELETE FROM engine_records WHERE store = 'crews' AND key = ?", id);
      for (const c of changes.cards ?? []) this.put('cards', c);
      for (const l of changes.links ?? []) this.put('links', l);
      return {
        ...meta,
        revision: meta.revision + 1,
        lastCommitAt: now,
        changesSinceBackup: meta.changesSinceBackup + 1,
      };
    });
  }
  async markBackup(revision: number, at: string): Promise<LocalMeta> {
    return this.host.transactionSync(() => {
      const meta = this.meta()!;
      const next = {
        ...meta,
        lastBackupAt: at,
        changesSinceBackup: Math.max(0, meta.revision - revision),
      };
      this.put('meta', next);
      return next;
    });
  }
  async audit(tournamentId: string, limit: number, offset: number) {
    const where = 'AND tournament_id = ?';
    const total = this.host.sql
      .exec(`SELECT COUNT(*) AS n FROM engine_records WHERE store = 'audit' ${where}`, tournamentId)
      .toArray()[0]!.n as number;
    const items = this.rows<{ sequence: number }>(
      'audit',
      `${where} ORDER BY seq DESC LIMIT ? OFFSET ?`,
      tournamentId,
      limit,
      offset,
    ).map(({ sequence: _, ...operation }) => operation);
    return { items, total, limit, offset } as Awaited<ReturnType<EngineDatabase['audit']>>;
  }
  /** The current revision: clients compare it to know when to refresh. */
  revision() {
    return this.meta()!.revision;
  }
  close() {
    /* The Durable Object owns the storage. */
  }
}
