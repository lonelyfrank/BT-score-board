import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import { uuid } from '../../application/src/portable.js';
import {
  DomainError,
  upgradePlayer,
  upgradeTournament,
  type Player,
  type PubEvent,
  type Tournament,
} from '../../domain/src/index.js';
import type {
  AuditRecord,
  ChangeSet,
  CommandRecord,
  OutboxRecord,
  Snapshot,
} from './memory-store.js';

export const DATABASE_NAME = 'bt-darts-scoreboard';

export interface LocalMeta {
  key: 'local';
  deviceId: string;
  createdAt: string;
  /** Incremented by every durable data change; compared in each commit (CAS between tabs). */
  revision: number;
  lastCommitAt: string | null;
  lastBackupAt: string | null;
  changesSinceBackup: number;
  lastImport: { at: string; deviceId: string; exportedAt: string } | null;
}
export interface LocalSchema extends DBSchema {
  meta: { key: string; value: LocalMeta };
  players: { key: string; value: Player };
  events: { key: string; value: PubEvent };
  tournaments: { key: string; value: Tournament };
  audit: { key: number; value: AuditRecord; indexes: { tournamentId: string } };
  outbox: { key: number; value: OutboxRecord; indexes: { tournamentId: string } };
  commands: { key: string; value: CommandRecord; indexes: { createdAt: string } };
}
export type LocalStoreName = StoreNames<LocalSchema>;
export interface BackupData {
  players: Player[];
  events: PubEvent[];
  tournaments: Tournament[];
  audit: AuditRecord[];
  outbox: OutboxRecord[];
  commands: CommandRecord[];
}
export const dataStores = [
  'players',
  'events',
  'tournaments',
  'audit',
  'outbox',
  'commands',
] as const;
const allStores: LocalStoreName[] = ['meta', ...dataStores];

export type Migration = (
  db: IDBPDatabase<LocalSchema>,
  transaction: IDBPTransaction<LocalSchema, LocalStoreName[], 'versionchange'>,
) => void | Promise<void>;
/** Ordered, append-only: migration N upgrades the database from version N to N + 1. */
export const migrations: Migration[] = [
  (db, transaction) => {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('players', { keyPath: 'id' });
    db.createObjectStore('events', { keyPath: 'id' });
    // The tournament aggregate (matches, turns, scores, results) is the consistency unit, as
    // in the SQLite snapshot column: one record per tournament keeps every command atomic.
    db.createObjectStore('tournaments', { keyPath: 'id' });
    db.createObjectStore('audit', { keyPath: 'sequence' }).createIndex(
      'tournamentId',
      'tournamentId',
    );
    db.createObjectStore('outbox', { keyPath: 'sequence' }).createIndex(
      'tournamentId',
      'tournamentId',
    );
    db.createObjectStore('commands', { keyPath: 'key' }).createIndex('createdAt', 'createdAt');
    void transaction.objectStore('meta').put({
      key: 'local',
      deviceId: uuid(),
      createdAt: new Date().toISOString(),
      revision: 0,
      lastCommitAt: null,
      lastBackupAt: null,
      changesSinceBackup: 0,
      lastImport: null,
    });
  },
  // 2: game modes and final results. Existing tournaments become Hi-Score with turn entry,
  // players get an empty avatar. Runs inside the upgrade transaction: all or nothing.
  async (_db, transaction) => {
    const tournaments = transaction.objectStore('tournaments');
    for (let cursor = await tournaments.openCursor(); cursor; cursor = await cursor.continue())
      await cursor.update(upgradeTournament(cursor.value));
    const players = transaction.objectStore('players');
    for (let cursor = await players.openCursor(); cursor; cursor = await cursor.continue())
      await cursor.update(upgradePlayer(cursor.value));
  },
];
export const SCHEMA_VERSION = migrations.length;

export interface OpenOptions {
  name?: string;
  migrations?: Migration[];
  /** Another tab needs a newer schema: this connection has been closed. */
  onClosed?: () => void;
  /** An older tab keeps the database open and delays this upgrade. */
  onBlocked?: () => void;
}
// After an abort every queued request rejects too: each is marked handled when it is queued,
// and the first error is reported once by wait().
function requests() {
  const queued: Promise<unknown>[] = [];
  return {
    add(request: Promise<unknown>) {
      request.catch(() => undefined);
      queued.push(request);
    },
    wait: () => Promise.all(queued),
  };
}
const storageError = (code: string, message: string, cause?: unknown) =>
  Object.assign(new DomainError(code, message, 503), { cause });
function failure(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError')
    return storageError('STORAGE_FULL', 'Device storage is full', error);
  return storageError('STORAGE_FAILED', 'The local database could not save the change', error);
}
// Safari may drop idle connections. Only a failure to *create* a transaction is retried:
// nothing was written yet, so a second attempt cannot duplicate or split a commit.
const reconnectable = (error: unknown) =>
  ['InvalidStateError', 'UnknownError'].includes((error as { name?: string } | null)?.name ?? '');

export async function openLocalDatabase(options: OpenOptions = {}): Promise<LocalDatabase> {
  const name = options.name ?? DATABASE_NAME;
  const list = options.migrations ?? migrations;
  const connect = async () => {
    if (typeof indexedDB === 'undefined')
      throw storageError('STORAGE_UNAVAILABLE', 'IndexedDB is not available in this browser');
    try {
      const db = await openDB<LocalSchema>(name, list.length, {
        async upgrade(db, oldVersion, _newVersion, transaction) {
          for (let version = oldVersion; version < list.length; version++)
            await list[version]!(db, transaction);
        },
        blocked: () => options.onBlocked?.(),
        blocking: () => {
          db.close();
          options.onClosed?.();
        },
        terminated: () => local?.markLost(),
      });
      return db;
    } catch (error) {
      if ((error as { name?: string }).name === 'VersionError')
        throw storageError(
          'LOCAL_SCHEMA_NEWER',
          'The local data was written by a newer version of the app',
          error,
        );
      throw storageError('STORAGE_UNAVAILABLE', 'The local database cannot be opened', error);
    }
  };
  let local: LocalDatabase | undefined;
  local = new LocalDatabase(await connect(), connect);
  return local;
}

export interface LoadedState {
  snapshot: Snapshot;
  sequences: { audit: number; outbox: number };
  meta: LocalMeta;
}

export class LocalDatabase {
  private lost = false;
  constructor(
    private db: IDBPDatabase<LocalSchema>,
    private readonly connect: () => Promise<IDBPDatabase<LocalSchema>>,
  ) {}
  markLost() {
    this.lost = true;
  }
  close() {
    this.db.close();
  }
  private async run<T>(work: (db: IDBPDatabase<LocalSchema>) => Promise<T>): Promise<T> {
    if (this.lost) {
      this.db = await this.connect();
      this.lost = false;
    }
    return work(this.db);
  }
  private async begin<Mode extends 'readonly' | 'readwrite'>(
    mode: Mode,
  ): Promise<IDBPTransaction<LocalSchema, LocalStoreName[], Mode>> {
    const open = () =>
      this.db.transaction(allStores, mode, mode === 'readwrite' ? { durability: 'strict' } : {});
    try {
      return open();
    } catch (error) {
      if (!reconnectable(error)) throw failure(error);
      this.db = await this.connect();
      return open();
    }
  }
  /** Loads the working set: entities, recent command records, meta and history sequences. */
  load(commandsSince: string): Promise<LoadedState> {
    return this.run(async () => {
      const tx = await this.begin('readonly');
      const lastKey = async (store: 'audit' | 'outbox') =>
        ((await tx.objectStore(store).openKeyCursor(null, 'prev'))?.key as number | undefined) ?? 0;
      const [players, events, tournaments, commands, meta, audit, outbox] = await Promise.all([
        tx.objectStore('players').getAll(),
        tx.objectStore('events').getAll(),
        tx.objectStore('tournaments').getAll(),
        tx.objectStore('commands').index('createdAt').getAll(IDBKeyRange.lowerBound(commandsSince)),
        tx.objectStore('meta').get('local'),
        lastKey('audit'),
        lastKey('outbox'),
      ]);
      await tx.done;
      if (!meta) throw storageError('STORAGE_FAILED', 'Local metadata is missing');
      return {
        snapshot: { players, events, tournaments, commands },
        sequences: { audit, outbox },
        meta,
      };
    });
  }
  getMeta(): Promise<LocalMeta> {
    return this.run(async (db) => (await db.get('meta', 'local'))!);
  }
  /**
   * Writes one command's changes in a single strict-durability transaction. Rejects without
   * writing anything when another tab committed since `expectedRevision`.
   */
  commit(changes: ChangeSet, expectedRevision: number, now: string): Promise<LocalMeta> {
    return this.run(async () => {
      const tx = await this.begin('readwrite');
      const done = tx.done;
      done.catch(() => undefined);
      try {
        const meta = (await tx.objectStore('meta').get('local'))!;
        if (meta.revision !== expectedRevision) {
          tx.abort();
          throw new DomainError('STALE_DATA', 'The data was changed in another tab', 409);
        }
        const next: LocalMeta = {
          ...meta,
          revision: meta.revision + 1,
          lastCommitAt: now,
          changesSinceBackup: meta.changesSinceBackup + 1,
        };
        const writes = requests();
        for (const p of changes.players) writes.add(tx.objectStore('players').put(p));
        for (const e of changes.events) writes.add(tx.objectStore('events').put(e));
        for (const t of changes.tournaments) writes.add(tx.objectStore('tournaments').put(t));
        for (const a of changes.audit) writes.add(tx.objectStore('audit').add(a));
        for (const o of changes.outbox) writes.add(tx.objectStore('outbox').add(o));
        for (const c of changes.commands) writes.add(tx.objectStore('commands').put(c));
        writes.add(tx.objectStore('meta').put(next));
        writes.add(done);
        await writes.wait();
        return next;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already finished or aborted. */
        }
        throw failure(tx.error ?? error);
      }
    });
  }
  exportAll(): Promise<{ data: BackupData; meta: LocalMeta }> {
    return this.run(async () => {
      const tx = await this.begin('readonly');
      const [players, events, tournaments, audit, outbox, commands, meta] = await Promise.all([
        tx.objectStore('players').getAll(),
        tx.objectStore('events').getAll(),
        tx.objectStore('tournaments').getAll(),
        tx.objectStore('audit').getAll(),
        tx.objectStore('outbox').getAll(),
        tx.objectStore('commands').getAll(),
        tx.objectStore('meta').get('local'),
      ]);
      await tx.done;
      return { data: { players, events, tournaments, audit, outbox, commands }, meta: meta! };
    });
  }
  /** Replaces every data store in one transaction: either the whole backup or nothing. */
  replaceAll(
    data: BackupData,
    source: { deviceId: string; exportedAt: string },
    expectedRevision: number,
    now: string,
  ): Promise<LocalMeta> {
    return this.run(async () => {
      const tx = await this.begin('readwrite');
      const done = tx.done;
      done.catch(() => undefined);
      try {
        const meta = (await tx.objectStore('meta').get('local'))!;
        if (meta.revision !== expectedRevision) {
          tx.abort();
          throw new DomainError('STALE_DATA', 'The data was changed in another tab', 409);
        }
        const next: LocalMeta = {
          ...meta,
          revision: meta.revision + 1,
          lastCommitAt: now,
          lastBackupAt: source.exportedAt,
          changesSinceBackup: 0,
          lastImport: { at: now, ...source },
        };
        const writes = requests();
        for (const store of dataStores) writes.add(tx.objectStore(store).clear());
        for (const p of data.players) writes.add(tx.objectStore('players').add(p));
        for (const e of data.events) writes.add(tx.objectStore('events').add(e));
        for (const t of data.tournaments) writes.add(tx.objectStore('tournaments').add(t));
        for (const a of data.audit) writes.add(tx.objectStore('audit').add(a));
        for (const o of data.outbox) writes.add(tx.objectStore('outbox').add(o));
        for (const c of data.commands) writes.add(tx.objectStore('commands').add(c));
        writes.add(tx.objectStore('meta').put(next));
        writes.add(done);
        await writes.wait();
        return next;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already finished or aborted. */
        }
        throw failure(tx.error ?? error);
      }
    });
  }
  /** Records an export of `revision`: later commits still count as unsaved changes. */
  markBackup(revision: number, at: string): Promise<LocalMeta> {
    return this.run(async (db) => {
      const tx = db.transaction('meta', 'readwrite');
      const meta = (await tx.store.get('local'))!;
      const next = {
        ...meta,
        lastBackupAt: at,
        changesSinceBackup: Math.max(0, meta.revision - revision),
      };
      await Promise.all([tx.store.put(next), tx.done]);
      return next;
    });
  }
  audit(tournamentId: string, limit: number, offset: number) {
    return this.run(async (db) => {
      const rows = await db.getAllFromIndex('audit', 'tournamentId', tournamentId);
      rows.sort((a, b) => b.sequence - a.sequence);
      return {
        items: rows.slice(offset, offset + limit).map(({ sequence: _, ...operation }) => operation),
        total: rows.length,
        limit,
        offset,
      };
    });
  }
}
