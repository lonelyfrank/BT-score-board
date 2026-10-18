import { Backend } from '../../application/src/services/backend.js';
import { uuid } from '../../application/src/portable.js';
import { DomainError, type Context } from '../../domain/src/index.js';
import { MemoryStore } from './memory-store.js';
import {
  openLocalDatabase,
  type LocalDatabase,
  type LocalMeta,
  type OpenOptions,
} from './indexeddb.js';
import { createBackup, type BackupFile } from './backup.js';

export interface EngineOptions {
  database?: OpenOptions;
  /** BroadcastChannel used to refresh other tabs; null disables it. */
  channel?: string | null;
  context?: Context;
  /** Application version recorded in backups. */
  app?: string;
  now?: () => string;
}
export type EngineEvent =
  | { type: 'changed'; origin: 'local' | 'remote' | 'import' }
  | { type: 'closed'; reason: 'upgrade' | 'error' }
  | { type: 'blocked' };
export interface EngineStatus {
  meta: LocalMeta;
  counts: ReturnType<MemoryStore['counts']>;
  backupRecommended: boolean;
}

// Idempotency records loaded at startup: replays only follow the original command closely.
const commandWindowMs = 48 * 3600 * 1000;
// Unsaved changes after which a backup is suggested even without a completed tournament.
const backupThreshold = 50;

/**
 * Runs the unchanged Backend against an in-memory snapshot and makes every command durable:
 * the command's changes are committed in one IndexedDB transaction and applied to memory (and
 * returned to the caller) only after the commit completed. Commands run one at a time.
 */
export class LocalEngine {
  private store!: MemoryStore;
  private backend!: Backend;
  private meta!: LocalMeta;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: EngineEvent) => void>();
  private channel: BroadcastChannel | null = null;
  private closed = false;
  private readonly id = uuid();
  private readonly now: () => string;

  private constructor(
    private readonly db: LocalDatabase,
    private readonly options: EngineOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  static async open(options: EngineOptions = {}): Promise<LocalEngine> {
    let engine: LocalEngine | undefined;
    const db = await openLocalDatabase({
      ...options.database,
      onClosed: () => {
        options.database?.onClosed?.();
        engine?.shutdown('upgrade');
      },
      onBlocked: () => {
        options.database?.onBlocked?.();
        engine?.emit({ type: 'blocked' });
      },
    });
    engine = new LocalEngine(db, options);
    await engine.reload();
    const name = options.channel === undefined ? 'bt-darts-local' : options.channel;
    if (name && typeof BroadcastChannel !== 'undefined') {
      engine.channel = new BroadcastChannel(name);
      engine.channel.onmessage = (message: MessageEvent<{ source: string; revision: number }>) => {
        if (message.data.source !== engine!.id) engine!.refresh(message.data.revision);
      };
    }
    return engine;
  }

  subscribe(listener: (event: EngineEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  private emit(event: EngineEvent) {
    for (const listener of this.listeners) listener(event);
  }
  private ensureOpen() {
    if (this.closed)
      throw new DomainError(
        'STORAGE_CLOSED',
        'The local database was closed: reload the app to continue',
        503,
      );
  }
  /** Reads committed state. Never observes a command whose commit is still in progress. */
  read<T>(work: (backend: Backend, store: MemoryStore) => T): T {
    this.ensureOpen();
    return work(this.backend, this.store);
  }
  /** Runs one command; resolves only after its changes are durable on the device. */
  write<T>(work: (backend: Backend) => T): Promise<T> {
    return this.enqueue(async () => {
      this.ensureOpen();
      const { result, changes } = this.store.stage(() => work(this.backend));
      const empty = Object.values(changes).every((list) => !list.length);
      if (empty) {
        this.store.discard();
        return result;
      }
      try {
        this.meta = await this.db.commit(changes, this.meta.revision, this.now());
      } catch (error) {
        this.store.discard();
        if (error instanceof DomainError && error.code === 'STALE_DATA') {
          await this.reload();
          this.emit({ type: 'changed', origin: 'remote' });
        }
        throw error;
      }
      this.store.apply(changes);
      this.broadcast();
      this.emit({ type: 'changed', origin: 'local' });
      return result;
    });
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async reload() {
    const since = new Date(Date.parse(this.now()) - commandWindowMs).toISOString();
    const loaded = await this.db.load(since);
    this.store = new MemoryStore(loaded.snapshot, {
      retainHistory: false,
      sequences: loaded.sequences,
    });
    this.backend = new Backend(this.store, this.options.context);
    this.meta = loaded.meta;
  }
  private refresh(revision: number) {
    void this.enqueue(async () => {
      if (this.closed || revision <= this.meta.revision) return;
      await this.reload();
      this.emit({ type: 'changed', origin: 'remote' });
    });
  }
  private broadcast() {
    this.channel?.postMessage({ source: this.id, revision: this.meta.revision });
  }

  status(): EngineStatus {
    const since = this.meta.lastBackupAt ?? '';
    const tournaments = this.store.listTournaments({ limit: 1000, offset: 0, status: 'completed' });
    const completedSinceBackup = tournaments.items.some((t) => (t.completedAt ?? '') > since);
    return {
      meta: { ...this.meta },
      counts: this.store.counts(),
      backupRecommended:
        this.meta.changesSinceBackup > 0 &&
        (completedSinceBackup || this.meta.changesSinceBackup >= backupThreshold),
    };
  }
  audit(tournamentId: string, limit = 50, offset = 0) {
    this.ensureOpen();
    return this.db.audit(tournamentId, limit, offset);
  }
  /** Exports a consistent copy of every store and records it as the latest backup. */
  exportBackup(): Promise<BackupFile> {
    return this.enqueue(async () => {
      this.ensureOpen();
      const { data, meta } = await this.db.exportAll();
      const at = this.now();
      const backup = await createBackup(
        data,
        { deviceId: meta.deviceId, revision: meta.revision, app: this.options.app ?? 'unknown' },
        at,
      );
      this.meta = await this.db.markBackup(meta.revision, at);
      return backup;
    });
  }
  /**
   * Replaces all local data with a verified backup (see readBackup). Existing data is
   * replaced only with explicit confirmation.
   */
  importBackup(backup: BackupFile, options: { replaceExisting: boolean }): Promise<void> {
    return this.enqueue(async () => {
      this.ensureOpen();
      if (!this.store.isEmpty() && !options.replaceExisting)
        throw new DomainError(
          'CONFIRMATION_REQUIRED',
          'Local data exists: confirm before replacing it',
          409,
        );
      try {
        this.meta = await this.db.replaceAll(
          backup.data,
          { deviceId: backup.source.deviceId, exportedAt: backup.exportedAt },
          this.meta.revision,
          this.now(),
        );
      } catch (error) {
        if (error instanceof DomainError && error.code === 'STALE_DATA') {
          await this.reload();
          this.emit({ type: 'changed', origin: 'remote' });
        }
        throw error;
      }
      await this.reload();
      this.broadcast();
      this.emit({ type: 'changed', origin: 'import' });
    });
  }
  private shutdown(reason: 'upgrade' | 'error') {
    if (this.closed) return;
    this.closed = true;
    this.channel?.close();
    this.emit({ type: 'closed', reason });
  }
  close() {
    this.closed = true;
    this.channel?.close();
    this.db.close();
  }
}
