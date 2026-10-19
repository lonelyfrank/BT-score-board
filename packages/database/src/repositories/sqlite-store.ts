import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, count, desc, eq, gt, inArray, like, or, sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import * as schema from '../schema/index.js';
import { migration1 } from '../migrations/0001.js';
import { migration2 } from '../migrations/0002.js';
import { migration3 } from '../migrations/0003.js';
import {
  DomainError,
  ensure,
  upgradePlayer,
  upgradeTournament,
  type ApplicationEvent,
  type Operation,
  type Player,
  type PubEvent,
  type Tournament,
} from '../../../domain/src/index.js';
import type { ListOptions, Store } from '../../../application/src/ports.js';

/** Applied in order; version N is migrations[N - 1]. Applied ones must keep their checksum. */
const migrations = [migration1, migration2, migration3];
const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

export class SqliteStore implements Store {
  readonly sqlite: Database.Database;
  readonly db;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sqlite = new Database(path);
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('synchronous = FULL');
    try {
      this.migrate();
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
    this.db = drizzle(this.sqlite, { schema });
  }
  private migrate() {
    this.sqlite.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    // Rebuilding a referenced table requires foreign keys off, outside the transaction; the
    // check below verifies every reference before the migration commits.
    this.sqlite.pragma('foreign_keys = OFF');
    try {
      this.sqlite
        .transaction(() => {
          const rows = this.sqlite
            .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
            .all() as { version: number; checksum: string }[];
          ensure(
            rows.length <= migrations.length &&
              rows.every((r, i) => r.version === i + 1 && r.checksum === checksum(migrations[i]!)),
            'MIGRATION_MISMATCH',
            'Database migration version/checksum differs from this build',
            500,
          );
          for (let i = rows.length; i < migrations.length; i++) {
            this.sqlite.exec(migrations[i]!);
            this.sqlite
              .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
              .run(i + 1, checksum(migrations[i]!), new Date().toISOString());
          }
          ensure(
            !(this.sqlite.pragma('foreign_key_check') as unknown[]).length,
            'MIGRATION_FAILED',
            'A migration left broken references',
            500,
          );
        })
        .immediate();
    } finally {
      this.sqlite.pragma('foreign_keys = ON');
    }
  }
  transaction<T>(work: () => T): T {
    return this.sqlite.transaction(work).immediate();
  }
  close() {
    this.sqlite.close();
  }
  getPlayer(id: string) {
    const data = this.db.select().from(schema.players).where(eq(schema.players.id, id)).get()?.data;
    return data && upgradePlayer(data);
  }
  savePlayer(p: Player) {
    const values = {
      id: p.id,
      displayName: p.displayName,
      nickname: p.nickname,
      status: p.status,
      data: p,
    };
    this.db
      .insert(schema.players)
      .values(values)
      .onConflictDoUpdate({ target: schema.players.id, set: values })
      .run();
  }
  listPlayers(o: ListOptions) {
    const where = and(
      o.search
        ? or(
            like(schema.players.displayName, `%${escapeLike(o.search)}%`),
            like(schema.players.nickname, `%${escapeLike(o.search)}%`),
          )
        : undefined,
      o.status ? eq(schema.players.status, o.status) : undefined,
    );
    return {
      items: this.db
        .select()
        .from(schema.players)
        .where(where)
        .orderBy(schema.players.displayName, schema.players.id)
        .limit(o.limit)
        .offset(o.offset)
        .all()
        .map((r) => upgradePlayer(r.data)),
      total: this.db.select({ n: count() }).from(schema.players).where(where).get()!.n,
      limit: o.limit,
      offset: o.offset,
    };
  }
  getEvent(id: string) {
    return this.db.select().from(schema.events).where(eq(schema.events.id, id)).get()?.data;
  }
  saveEvent(e: PubEvent) {
    const values = { id: e.id, name: e.name, status: e.status, data: e };
    this.db
      .insert(schema.events)
      .values(values)
      .onConflictDoUpdate({ target: schema.events.id, set: values })
      .run();
  }
  listEvents(o: ListOptions) {
    const where = and(
      o.search ? like(schema.events.name, `%${escapeLike(o.search)}%`) : undefined,
      o.status ? eq(schema.events.status, o.status) : undefined,
    );
    return {
      items: this.db
        .select()
        .from(schema.events)
        .where(where)
        .orderBy(schema.events.name, schema.events.id)
        .limit(o.limit)
        .offset(o.offset)
        .all()
        .map((r) => r.data),
      total: this.db.select({ n: count() }).from(schema.events).where(where).get()!.n,
      limit: o.limit,
      offset: o.offset,
    };
  }
  getTournament(id: string) {
    const data = this.db
      .select()
      .from(schema.tournaments)
      .where(eq(schema.tournaments.id, id))
      .get()?.data;
    return data && upgradeTournament(data);
  }
  listTournaments(o: ListOptions) {
    const where = and(
      o.search ? like(schema.tournaments.name, `%${escapeLike(o.search)}%`) : undefined,
      o.status ? eq(schema.tournaments.status, o.status) : undefined,
      o.eventId ? eq(schema.tournaments.eventId, o.eventId) : undefined,
    );
    return {
      items: this.db
        .select()
        .from(schema.tournaments)
        .where(where)
        .orderBy(...newestTournamentsFirst)
        .limit(o.limit)
        .offset(o.offset)
        .all()
        .map((r) => upgradeTournament(r.data)),
      total: this.db.select({ n: count() }).from(schema.tournaments).where(where).get()!.n,
      limit: o.limit,
      offset: o.offset,
    };
  }
  tournamentsForPlayer(playerId: string) {
    // Members include every player of a team, not only the entry's first player.
    return this.db
      .select({ data: schema.tournaments.data })
      .from(schema.tournaments)
      .innerJoin(schema.entryMembers, eq(schema.entryMembers.tournamentId, schema.tournaments.id))
      .where(eq(schema.entryMembers.playerId, playerId))
      .orderBy(...newestTournamentsFirst)
      .all()
      .map((r) => upgradeTournament(r.data));
  }
  tournamentForMatch(id: string) {
    const row = this.db
      .select({ tournamentId: schema.matches.tournamentId })
      .from(schema.matches)
      .where(eq(schema.matches.id, id))
      .get();
    return row ? this.getTournament(row.tournamentId) : undefined;
  }
  tournamentForScore(id: string) {
    const row = this.db
      .select({ matchId: schema.scores.matchId })
      .from(schema.scores)
      .where(eq(schema.scores.id, id))
      .get();
    return row ? this.tournamentForMatch(row.matchId) : undefined;
  }
  saveTournament(t: Tournament, expectedVersion?: number) {
    const values = {
      id: t.id,
      eventId: t.eventId,
      name: t.name,
      mode: t.mode,
      status: t.status,
      version: t.version,
      data: t,
    };
    if (expectedVersion === undefined) this.db.insert(schema.tournaments).values(values).run();
    else {
      const changed = this.db
        .update(schema.tournaments)
        .set(values)
        .where(
          and(eq(schema.tournaments.id, t.id), eq(schema.tournaments.version, expectedVersion)),
        )
        .run();
      if (changed.changes !== 1)
        throw new DomainError('VERSION_CONFLICT', 'Tournament was concurrently updated');
    }
    // Registrations removed or recomposed before the start leave the aggregate: their rows go
    // too (members first), so a player can join another unit of the same tournament.
    this.db.delete(schema.entryMembers).where(eq(schema.entryMembers.tournamentId, t.id)).run();
    const stale = this.db
      .select({ id: schema.entries.id, playerId: schema.entries.playerId })
      .from(schema.entries)
      .where(eq(schema.entries.tournamentId, t.id))
      .all()
      .filter((row) => !t.entries.some((e) => e.id === row.id && e.playerId === row.playerId))
      .map((row) => row.id);
    if (stale.length)
      this.db
        .delete(schema.entries)
        .where(and(eq(schema.entries.tournamentId, t.id), inArray(schema.entries.id, stale)))
        .run();
    for (const e of t.entries) {
      const v = { id: e.id, tournamentId: t.id, playerId: e.playerId, seed: e.seed, data: e };
      this.db
        .insert(schema.entries)
        .values(v)
        .onConflictDoUpdate({ target: schema.entries.id, set: v })
        .run();
    }
    for (const e of t.entries)
      e.members.forEach((member, i) =>
        this.db
          .insert(schema.entryMembers)
          .values({
            tournamentId: t.id,
            entryId: e.id,
            playerId: member.playerId,
            position: i + 1,
          })
          .run(),
      );
    for (const s of t.stages) {
      const v = { id: s.id, tournamentId: t.id, ordering: s.ordering, status: s.status, data: s };
      this.db
        .insert(schema.stages)
        .values(v)
        .onConflictDoUpdate({ target: schema.stages.id, set: v })
        .run();
    }
    for (const g of t.groups) {
      const v = { id: g.id, stageId: g.stageId, data: g };
      this.db
        .insert(schema.groups)
        .values(v)
        .onConflictDoUpdate({ target: schema.groups.id, set: v })
        .run();
    }
    for (const m of t.matches) {
      const { participants: ps, turns: ts, scores: ss, ...data } = m;
      const v = {
        id: m.id,
        tournamentId: t.id,
        stageId: m.stageId,
        groupId: m.groupId,
        status: m.status,
        version: m.version,
        data,
      };
      this.db
        .insert(schema.matches)
        .values(v)
        .onConflictDoUpdate({ target: schema.matches.id, set: v })
        .run();
      for (const p of ps) {
        const v = {
          matchId: m.id,
          entryId: p.tournamentEntryId,
          tournamentId: t.id,
          playingOrder: p.playingOrder,
          data: p,
        };
        this.db
          .insert(schema.participants)
          .values(v)
          .onConflictDoUpdate({
            target: [schema.participants.matchId, schema.participants.entryId],
            set: v,
          })
          .run();
      }
      for (const turn of ts) {
        const v = {
          id: turn.id,
          matchId: m.id,
          entryId: turn.participantId,
          turnNumber: turn.turnNumber,
          status: turn.status,
          data: turn,
        };
        this.db
          .insert(schema.turns)
          .values(v)
          .onConflictDoUpdate({ target: schema.turns.id, set: v })
          .run();
      }
      for (const score of ss) {
        const v = {
          id: score.id,
          matchId: m.id,
          entryId: score.tournamentEntryId,
          turnId: score.turnId,
          score: score.score,
          dartIndex: score.dartIndex,
          voided: score.voided,
          data: score,
        };
        // Avoid firing insert-mode guards for updates to existing score slots.
        const found = this.db
          .select({ id: schema.scores.id })
          .from(schema.scores)
          .where(eq(schema.scores.id, score.id))
          .get();
        if (found) this.db.update(schema.scores).set(v).where(eq(schema.scores.id, score.id)).run();
        else this.db.insert(schema.scores).values(v).run();
      }
    }
    this.db.delete(schema.results).where(eq(schema.results.tournamentId, t.id)).run();
    for (const r of t.results)
      this.db
        .insert(schema.results)
        .values({
          tournamentId: t.id,
          entryId: r.tournamentEntryId,
          placement: r.finalPlacement,
          data: r,
        })
        .run();
  }
  appendAudit(operation: Operation) {
    this.db
      .insert(schema.auditLog)
      .values({ id: operation.id, tournamentId: operation.tournamentId, data: operation })
      .run();
  }
  audit(tournamentId: string, o: ListOptions) {
    const where = eq(schema.auditLog.tournamentId, tournamentId);
    return {
      items: this.db
        .select()
        .from(schema.auditLog)
        .where(where)
        .orderBy(desc(schema.auditLog.sequence))
        .limit(o.limit)
        .offset(o.offset)
        .all()
        .map((r) => r.data),
      total: this.db.select({ n: count() }).from(schema.auditLog).where(where).get()!.n,
      limit: o.limit,
      offset: o.offset,
    };
  }
  appendEvent(event: ApplicationEvent) {
    this.db
      .insert(schema.outbox)
      .values({ id: event.id, tournamentId: event.tournamentId, data: event })
      .run();
  }
  events(tournamentId: string, after: number, limit: number) {
    return this.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.tournamentId, tournamentId), gt(schema.outbox.sequence, after)))
      .orderBy(schema.outbox.sequence)
      .limit(limit)
      .all()
      .map((r) => ({ ...r.data, sequence: r.sequence }));
  }
  getIdempotency(key: string) {
    return this.db
      .select({
        fingerprint: schema.idempotency.fingerprint,
        response: schema.idempotency.response,
      })
      .from(schema.idempotency)
      .where(eq(schema.idempotency.key, key))
      .get();
  }
  saveIdempotency(key: string, fingerprint: string, response: unknown) {
    this.db
      .insert(schema.idempotency)
      .values({ key, fingerprint, response, createdAt: new Date().toISOString() })
      .run();
  }
}
// UUIDs carry no order: list by creation time, as the standalone store does.
const newestTournamentsFirst = [
  desc(sql`json_extract(${schema.tournaments.data}, '$.createdAt')`),
  desc(schema.tournaments.id),
];
// SQLite LIKE wildcards are documented as search syntax; parameters remain bound.
function escapeLike(value: string) {
  return value;
}
