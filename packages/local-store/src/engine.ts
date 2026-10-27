import { Backend } from '../../application/src/services/backend.js';
import { uuid } from '../../application/src/portable.js';
import {
  DomainError,
  computeProgression,
  crewTournaments,
  linkDirection,
  linkResolver,
  playerCard,
  tournamentPlayerIds,
  type Context,
  type Crew,
  type Progression,
} from '../../domain/src/index.js';
import { MemoryStore } from './memory-store.js';
import {
  openLocalDatabase,
  type BackupData,
  type LocalDatabase,
  type LocalMeta,
  type OpenOptions,
  type SocialData,
} from './indexeddb.js';
import { createBackup, type BackupFile } from './backup.js';
import { mergeBackupData, type MergeReport } from './merge.js';

/** What the engine needs from durable storage: IndexedDB on a phone, SQLite on the server. */
export type EngineDatabase = Pick<
  LocalDatabase,
  'load' | 'commit' | 'exportAll' | 'replaceAll' | 'writeSocial' | 'markBackup' | 'audit' | 'close'
>;
export interface EngineOptions {
  database?: OpenOptions;
  /** Opens another durable store instead of IndexedDB (the cloud server's SQLite). */
  storage?: () => EngineDatabase | Promise<EngineDatabase>;
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
  private social!: SocialData;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: EngineEvent) => void>();
  private channel: BroadcastChannel | null = null;
  private closed = false;
  private readonly id = uuid();
  private readonly now: () => string;

  private constructor(
    private readonly db: EngineDatabase,
    private readonly options: EngineOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  static async open(options: EngineOptions = {}): Promise<LocalEngine> {
    let engine: LocalEngine | undefined;
    const db = options.storage
      ? await options.storage()
      : await openLocalDatabase({
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
    this.social = loaded.social;
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
  /** Crews, player cards and links as committed. */
  socialData(): SocialData {
    this.ensureOpen();
    return structuredClone(this.social);
  }
  /** Levels, statistics and records over every tournament on the device and the cards received. */
  progression(): Progression {
    this.ensureOpen();
    return computeProgression(this.allTournaments(), {
      cards: this.social.cards,
      links: this.social.links,
    });
  }
  /** The same, over what a crew shares: its records are the records among its members. */
  crewProgression(crewId: string): Progression {
    const crew = this.crew(crewId);
    const members = new Set(crew.memberIds.map(linkResolver(this.social.links)));
    return computeProgression(this.crewTournaments(crewId), {
      cards: this.social.cards.filter((c) => members.has(c.playerId)),
      links: this.social.links,
    });
  }
  crewTournaments(crewId: string) {
    return crewTournaments(
      this.crew(crewId),
      this.allTournaments(),
      linkResolver(this.social.links),
    );
  }
  private allTournaments() {
    return this.store.listTournaments({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }).items;
  }
  private crew(id: string) {
    this.ensureOpen();
    const crew = this.social.crews.find((c) => c.id === id);
    if (!crew) throw new DomainError('CREW_NOT_FOUND', 'Crew not found', 404);
    return crew;
  }
  /** Creates or updates a crew; `updatedAt` is set here, for merges between devices. */
  saveCrew(crew: Omit<Crew, 'updatedAt' | 'createdAt'> & { createdAt?: string }): Promise<Crew> {
    const at = this.now();
    const saved: Crew = { ...crew, createdAt: crew.createdAt ?? at, updatedAt: at };
    return this.writeSocial({ crews: [saved] }).then(() => saved);
  }
  /** Removes the crew from this device only: other members keep their copy. */
  deleteCrew(id: string): Promise<void> {
    return this.writeSocial({ deleteCrews: [id] });
  }
  /**
   * Merges two player records of the same person. The survivor (see linkDirection) stays active
   * and takes the nickname and avatar the other had and it lacks; crews point to it, and the
   * history of the other counts for it. The absorbed record is deactivated so it leaves new
   * line-ups, but it stays readable under its old id.
   */
  async linkPlayers(a: string, b: string): Promise<{ kept: string; linked: string }> {
    const [pa, pb] = this.read((_, store) => [store.getPlayer(a), store.getPlayer(b)]);
    if (!pa || !pb || a === b)
      throw new DomainError('PLAYER_NOT_FOUND', 'Choose two different players', 404);
    const link = { ...linkDirection(pa, pb), createdAt: this.now() };
    const crews = this.social.crews
      .filter((c) => c.memberIds.includes(link.from))
      .map((c) => ({
        ...c,
        memberIds: [...new Set(c.memberIds.map((id) => (id === link.from ? link.to : id)))],
        updatedAt: link.createdAt,
      }));
    await this.writeSocial({ links: [link], crews });
    const [kept, linked] = link.from === a ? [pb, pa] : [pa, pb];
    const keep: Record<string, unknown> = {};
    if (!kept.nickname && linked.nickname) keep.nickname = linked.nickname;
    if (!kept.avatar && linked.avatar) keep.avatar = linked.avatar;
    await this.write((backend) => {
      if (Object.keys(keep).length) backend.updatePlayer(kept.id, keep);
      if (linked.status === 'active') backend.updatePlayer(linked.id, { status: 'inactive' });
    });
    return { kept: kept.id, linked: linked.id };
  }
  private writeSocial(changes: Partial<SocialData> & { deleteCrews?: string[] }) {
    return this.enqueue(async () => {
      this.ensureOpen();
      try {
        this.meta = await this.db.writeSocial(changes, this.meta.revision, this.now());
      } catch (error) {
        if (error instanceof DomainError && error.code === 'STALE_DATA') {
          await this.reload();
          this.emit({ type: 'changed', origin: 'remote' });
        }
        throw error;
      }
      const replace = <T>(list: T[], items: T[] | undefined, key: (item: T) => string) => {
        const map = new Map(list.map((item) => [key(item), item]));
        for (const item of items ?? []) map.set(key(item), item);
        return [...map.values()];
      };
      const deleted = new Set(changes.deleteCrews ?? []);
      this.social = {
        crews: replace(this.social.crews, changes.crews, (c) => c.id).filter(
          (c) => !deleted.has(c.id),
        ),
        cards: replace(this.social.cards, changes.cards, (c) => c.playerId),
        links: replace(this.social.links, changes.links, (l) => l.from),
      };
      this.broadcast();
      this.emit({ type: 'changed', origin: 'local' });
    });
  }
  /**
   * A crew package: the crew, the tournaments it shares with their players and history, and a
   * card per member with the level and bests this device knows of (from all its data), so the
   * level follows the person. Nothing else on the device is included.
   */
  exportCrew(crewId: string): Promise<BackupFile> {
    return this.enqueue(async () => {
      const crew = this.crew(crewId);
      const { data, meta } = await this.db.exportAll();
      const at = this.now();
      const resolve = linkResolver(data.links);
      const tournaments = crewTournaments(crew, data.tournaments, resolve);
      const ids = new Set(tournaments.map((t) => t.id));
      const playerIds = new Set([...crew.memberIds, ...tournaments.flatMap(tournamentPlayerIds)]);
      for (const id of [...playerIds]) playerIds.add(resolve(id));
      const links = data.links.filter((l) => playerIds.has(l.from) || playerIds.has(l.to));
      for (const l of links) playerIds.add(l.from).add(l.to);
      const events = new Set(tournaments.map((t) => t.eventId).filter((id) => id !== null));
      const progression = computeProgression(data.tournaments, {
        cards: data.cards,
        links: data.links,
      });
      const cards = [...new Set(crew.memberIds.map(resolve))]
        .map((id) => progression.players.get(id))
        .filter((p) => p !== undefined)
        .map((p) => playerCard(p, at));
      const subset: BackupData = {
        players: data.players.filter((p) => playerIds.has(p.id)),
        events: data.events.filter((e) => events.has(e.id)),
        tournaments,
        audit: data.audit.filter((a) => a.tournamentId !== null && ids.has(a.tournamentId)),
        outbox: data.outbox.filter((o) => ids.has(o.tournamentId)),
        commands: [],
        crews: [crew],
        cards,
        links,
      };
      return createBackup(
        subset,
        { deviceId: meta.deviceId, revision: meta.revision, app: this.options.app ?? 'unknown' },
        at,
        'crew',
      );
    });
  }
  /** What merging a verified backup or crew package would change, without writing anything. */
  previewMerge(backup: BackupFile): Promise<MergeReport> {
    return this.enqueue(async () => {
      this.ensureOpen();
      const { data } = await this.db.exportAll();
      return mergeBackupData(data, backup.data).report;
    });
  }
  /**
   * Adds a verified backup or crew package to the local data (see mergeBackupData) in one
   * transaction: the union or nothing. Nothing local is removed.
   */
  mergeBackup(backup: BackupFile): Promise<MergeReport> {
    return this.enqueue(async () => {
      this.ensureOpen();
      const { data } = await this.db.exportAll();
      const merged = mergeBackupData(data, backup.data);
      if (merged.report.unchanged) return merged.report;
      try {
        this.meta = await this.db.replaceAll(
          merged.data,
          { deviceId: backup.source.deviceId, exportedAt: backup.exportedAt },
          this.meta.revision,
          this.now(),
          'merge',
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
      return merged.report;
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
