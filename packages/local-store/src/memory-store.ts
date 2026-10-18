import {
  DomainError,
  type ApplicationEvent,
  type Operation,
  type Player,
  type PubEvent,
  type Tournament,
} from '../../domain/src/index.js';
import type { ListOptions, Page, Store } from '../../application/src/ports.js';
import { assertTournamentIntegrity } from './integrity.js';

export type AuditRecord = Operation & { sequence: number };
export type OutboxRecord = ApplicationEvent & { sequence: number };
/** Compact idempotency record: the persisted form keeps the fingerprint, not a full snapshot. */
export interface CommandRecord {
  key: string;
  fingerprint: string;
  tournamentId: string | null;
  version: number | null;
  createdAt: string;
}
export interface Snapshot {
  players: Player[];
  events: PubEvent[];
  tournaments: Tournament[];
  commands: CommandRecord[];
  audit?: AuditRecord[];
  outbox?: OutboxRecord[];
}
/** Every write of one outer transaction, in a form a durable store can commit atomically. */
export interface ChangeSet {
  players: Player[];
  events: PubEvent[];
  tournaments: Tournament[];
  audit: AuditRecord[];
  outbox: OutboxRecord[];
  commands: CommandRecord[];
}
interface Overlay {
  players: Map<string, Player>;
  events: Map<string, PubEvent>;
  tournaments: Map<string, Tournament>;
  audit: AuditRecord[];
  outbox: OutboxRecord[];
  commands: Map<string, { record: CommandRecord; response: unknown }>;
}
export interface MemoryStoreOptions {
  /** Keep audit and outbox readable in memory. Off when they are read from IndexedDB instead. */
  retainHistory?: boolean;
  /** Last persisted sequences, so appended records continue the durable numbering. */
  sequences?: { audit: number; outbox: number };
}

const clone = <T>(value: T): T => structuredClone(value);
// The same matching as SQLite LIKE '%term%': case-insensitive, with % and _ as wildcards.
function like(term: string) {
  const pattern = term
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  const regex = new RegExp(pattern, 'i');
  return (value: string | null) => value !== null && regex.test(value);
}
// SQLite's default BINARY collation, used by the server listings.
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const newestFirst = (a: Tournament, b: Tournament) =>
  binary(b.createdAt, a.createdAt) || binary(b.id, a.id);
function page<T>(items: T[], o: ListOptions): Page<T> {
  return {
    items: items.slice(o.offset, o.offset + o.limit),
    total: items.length,
    limit: o.limit,
    offset: o.offset,
  };
}

/**
 * Store port over an in-memory snapshot. Writes go to an overlay that is either applied at the
 * end of the transaction (like SQLite) or, through stage(), handed to the caller so that it can
 * be committed durably first and applied only once the commit succeeded.
 */
export class MemoryStore implements Store {
  private players = new Map<string, Player>();
  private events_ = new Map<string, PubEvent>();
  private tournaments = new Map<string, Tournament>();
  private commands = new Map<string, { record: CommandRecord }>();
  private responses = new Map<string, unknown>();
  private matchIndex = new Map<string, string>();
  private scoreIndex = new Map<string, string>();
  private auditLog: AuditRecord[] = [];
  private outbox: OutboxRecord[] = [];
  private sequences = { audit: 0, outbox: 0 };
  private overlay: Overlay | null = null;
  private staged: ChangeSet | null = null;
  private readonly retainHistory: boolean;
  // Bounded: replays only happen right after the original command.
  private static readonly responseLimit = 200;

  constructor(snapshot?: Snapshot, options: MemoryStoreOptions = {}) {
    this.retainHistory = options.retainHistory ?? true;
    if (options.sequences) this.sequences = { ...options.sequences };
    for (const p of snapshot?.players ?? []) this.players.set(p.id, p);
    for (const e of snapshot?.events ?? []) this.events_.set(e.id, e);
    for (const t of snapshot?.tournaments ?? []) this.index(t);
    for (const record of snapshot?.commands ?? []) this.commands.set(record.key, { record });
    if (this.retainHistory) {
      this.auditLog = [...(snapshot?.audit ?? [])].sort((a, b) => a.sequence - b.sequence);
      this.outbox = [...(snapshot?.outbox ?? [])].sort((a, b) => a.sequence - b.sequence);
      this.sequences.audit = Math.max(this.sequences.audit, this.auditLog.at(-1)?.sequence ?? 0);
      this.sequences.outbox = Math.max(this.sequences.outbox, this.outbox.at(-1)?.sequence ?? 0);
    }
  }

  transaction<T>(work: () => T): T {
    if (this.overlay) return work();
    const changes = this.run(work);
    this.apply(changes.changes);
    return changes.result;
  }
  /** Runs one outer transaction and returns its changes without applying them. */
  stage<T>(work: () => T): { result: T; changes: ChangeSet } {
    if (this.staged) throw new Error('A staged change set must be applied or discarded first');
    const staged = this.run(work);
    this.staged = staged.changes;
    return staged;
  }
  /** Applies a change set that is now durable (or, for plain transactions, immediately). */
  apply(changes: ChangeSet) {
    if (this.staged && this.staged !== changes) throw new Error('Unexpected change set');
    this.staged = null;
    for (const p of changes.players) this.players.set(p.id, p);
    for (const e of changes.events) this.events_.set(e.id, e);
    for (const t of changes.tournaments) this.index(t);
    for (const record of changes.commands) this.commands.set(record.key, { record });
    if (changes.audit.length) this.sequences.audit = changes.audit.at(-1)!.sequence;
    if (changes.outbox.length) this.sequences.outbox = changes.outbox.at(-1)!.sequence;
    if (this.retainHistory) {
      this.auditLog.push(...changes.audit);
      this.outbox.push(...changes.outbox);
    }
  }
  discard() {
    this.staged = null;
  }
  isEmpty() {
    return !this.players.size && !this.events_.size && !this.tournaments.size;
  }
  counts() {
    return {
      players: this.players.size,
      events: this.events_.size,
      tournaments: this.tournaments.size,
    };
  }
  private run<T>(work: () => T) {
    const overlay: Overlay = {
      players: new Map(),
      events: new Map(),
      tournaments: new Map(),
      audit: [],
      outbox: [],
      commands: new Map(),
    };
    this.overlay = overlay;
    try {
      const result = work();
      for (const [key, { response }] of overlay.commands) this.remember(key, response);
      return {
        result,
        changes: {
          players: [...overlay.players.values()],
          events: [...overlay.events.values()],
          tournaments: [...overlay.tournaments.values()],
          audit: overlay.audit,
          outbox: overlay.outbox,
          commands: [...overlay.commands.values()].map((c) => c.record),
        },
      };
    } finally {
      this.overlay = null;
    }
  }
  private remember(key: string, response: unknown) {
    this.responses.set(key, response);
    if (this.responses.size > MemoryStore.responseLimit)
      this.responses.delete(this.responses.keys().next().value!);
  }
  private index(t: Tournament) {
    const previous = this.tournaments.get(t.id);
    for (const m of previous?.matches ?? []) {
      this.matchIndex.delete(m.id);
      for (const s of m.scores) this.scoreIndex.delete(s.id);
    }
    this.tournaments.set(t.id, t);
    for (const m of t.matches) {
      this.matchIndex.set(m.id, t.id);
      for (const s of m.scores) this.scoreIndex.set(s.id, t.id);
    }
  }
  private current<T>(overlay: Map<string, T> | undefined, base: Map<string, T>, id: string) {
    return overlay?.get(id) ?? base.get(id);
  }
  private all<T>(overlay: Map<string, T> | undefined, base: Map<string, T>) {
    if (!overlay?.size) return [...base.values()];
    const merged = new Map(base);
    for (const [id, value] of overlay) merged.set(id, value);
    return [...merged.values()];
  }
  private write() {
    if (!this.overlay) throw new Error('Writes require a transaction');
    return this.overlay;
  }

  getPlayer(id: string) {
    const p = this.current(this.overlay?.players, this.players, id);
    return p && clone(p);
  }
  savePlayer(player: Player) {
    this.write().players.set(player.id, clone(player));
  }
  listPlayers(o: ListOptions) {
    const match = o.search ? like(o.search) : null;
    return page(
      this.all(this.overlay?.players, this.players)
        .filter(
          (p) =>
            (!match || match(p.displayName) || match(p.nickname)) &&
            (!o.status || p.status === o.status),
        )
        .sort((a, b) => binary(a.displayName, b.displayName) || binary(a.id, b.id))
        .map(clone),
      o,
    );
  }
  getEvent(id: string) {
    const e = this.current(this.overlay?.events, this.events_, id);
    return e && clone(e);
  }
  saveEvent(event: PubEvent) {
    this.write().events.set(event.id, clone(event));
  }
  listEvents(o: ListOptions) {
    const match = o.search ? like(o.search) : null;
    return page(
      this.all(this.overlay?.events, this.events_)
        .filter((e) => (!match || match(e.name)) && (!o.status || e.status === o.status))
        .sort((a, b) => binary(a.name, b.name) || binary(a.id, b.id))
        .map(clone),
      o,
    );
  }
  getTournament(id: string) {
    const t = this.current(this.overlay?.tournaments, this.tournaments, id);
    return t && clone(t);
  }
  saveTournament(t: Tournament, expectedVersion?: number) {
    const overlay = this.write();
    const existing = this.current(overlay.tournaments, this.tournaments, t.id);
    if (expectedVersion === undefined) {
      if (existing)
        throw new DomainError('INTEGRITY_CONFLICT', 'The operation conflicts with persisted data');
    } else if (existing?.version !== expectedVersion)
      throw new DomainError('VERSION_CONFLICT', 'Tournament was concurrently updated');
    assertTournamentIntegrity(
      t,
      (id) => !!this.current(overlay.players, this.players, id),
      (id) => !!this.current(overlay.events, this.events_, id),
    );
    overlay.tournaments.set(t.id, clone(t));
  }
  listTournaments(o: ListOptions) {
    const match = o.search ? like(o.search) : null;
    return page(
      this.all(this.overlay?.tournaments, this.tournaments)
        .filter(
          (t) =>
            (!match || match(t.name)) &&
            (!o.status || t.status === o.status) &&
            (!o.eventId || t.eventId === o.eventId),
        )
        .sort(newestFirst)
        .map(clone),
      o,
    );
  }
  tournamentsForPlayer(playerId: string) {
    return this.all(this.overlay?.tournaments, this.tournaments)
      .filter((t) => t.entries.some((e) => e.playerId === playerId))
      .sort(newestFirst)
      .map(clone);
  }
  tournamentForMatch(id: string) {
    const staged = [...(this.overlay?.tournaments.values() ?? [])].find((t) =>
      t.matches.some((m) => m.id === id),
    );
    const tournamentId = staged?.id ?? this.matchIndex.get(id);
    return tournamentId ? this.getTournament(tournamentId) : undefined;
  }
  tournamentForScore(id: string) {
    const staged = [...(this.overlay?.tournaments.values() ?? [])].find((t) =>
      t.matches.some((m) => m.scores.some((s) => s.id === id)),
    );
    const tournamentId = staged?.id ?? this.scoreIndex.get(id);
    return tournamentId ? this.getTournament(tournamentId) : undefined;
  }
  appendAudit(operation: Operation) {
    const overlay = this.write();
    overlay.audit.push({
      ...clone(operation),
      sequence: this.sequences.audit + overlay.audit.length + 1,
    });
  }
  audit(tournamentId: string, o: ListOptions) {
    this.requireHistory();
    return page(
      [...this.auditLog, ...(this.overlay?.audit ?? [])]
        .filter((a) => a.tournamentId === tournamentId)
        .reverse()
        .map(({ sequence: _, ...operation }) => clone(operation)),
      o,
    );
  }
  appendEvent(event: ApplicationEvent) {
    const overlay = this.write();
    overlay.outbox.push({
      ...clone(event),
      sequence: this.sequences.outbox + overlay.outbox.length + 1,
    });
  }
  events(tournamentId: string, after: number, limit: number) {
    this.requireHistory();
    return [...this.outbox, ...(this.overlay?.outbox ?? [])]
      .filter((e) => e.tournamentId === tournamentId && e.sequence > after)
      .slice(0, limit)
      .map(clone);
  }
  getIdempotency(key: string) {
    const staged = this.overlay?.commands.get(key);
    if (staged) return { fingerprint: staged.record.fingerprint, response: clone(staged.response) };
    const stored = this.commands.get(key);
    if (!stored) return undefined;
    const response = this.responses.has(key)
      ? this.responses.get(key)
      : // Persisted records keep no snapshot: replays across reloads return the current aggregate,
        // which clients re-read after every command anyway.
        stored.record.tournamentId && this.tournaments.get(stored.record.tournamentId);
    return { fingerprint: stored.record.fingerprint, response: clone(response) };
  }
  saveIdempotency(key: string, fingerprint: string, response: unknown) {
    const overlay = this.write();
    if (overlay.commands.has(key) || this.commands.has(key))
      throw new DomainError('INTEGRITY_CONFLICT', 'The operation conflicts with persisted data');
    const t = response as Partial<Tournament> | null;
    overlay.commands.set(key, {
      record: {
        key,
        fingerprint,
        tournamentId: typeof t?.id === 'string' ? t.id : null,
        version: typeof t?.version === 'number' ? t.version : null,
        createdAt: new Date().toISOString(),
      },
      response: clone(response),
    });
  }
  private requireHistory() {
    if (!this.retainHistory)
      throw new DomainError('NOT_SUPPORTED', 'History is read from the local database', 501);
  }
}
