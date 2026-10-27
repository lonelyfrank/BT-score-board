import { BT_PLAY_SPACE_ID, DomainError, ensure } from '../../../packages/domain/src/index.js';
import { uuid } from '../../../packages/application/src/portable.js';
import type { SqlHost } from '../../../packages/local-store/src/sql-database.js';
import { base64url, sha256 } from './accounts.js';

/**
 * Who may see a play space and who scores a match. Everything here is decided on the server's
 * own tables, never on objects or account ids sent by a client, and none of it travels in
 * backups: a restore replaces game data but cannot hand out membership or scoring rights.
 *
 * - membership gives access to a play space's context (its matches, scoreboard) and the right to
 *   create matches in it; it never gives the right to score somebody else's match;
 * - a match has exactly one scorer account, bound to the session (device) that writes, with an
 *   epoch that grows at each transfer or device change, so an older session is refused;
 * - the canonical Bite the Trouble space is open to every enabled account.
 */
const schema = [
  'CREATE TABLE IF NOT EXISTS space_members (space_id TEXT NOT NULL, account_id TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (space_id, account_id))',
  'CREATE INDEX IF NOT EXISTS space_members_account ON space_members(account_id)',
  'CREATE TABLE IF NOT EXISTS space_invites (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at TEXT)',
  'CREATE TABLE IF NOT EXISTS match_access (tournament_id TEXT PRIMARY KEY, created_by TEXT, scorer_id TEXT, scorer_session TEXT, epoch INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS access_audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, tournament_id TEXT, detail TEXT NOT NULL)',
];
const day = 24 * 3600 * 1000;
const inviteTtl = 30 * day;

export interface MatchAccess {
  tournamentId: string;
  createdBy: string | null;
  scorerId: string | null;
  epoch: number;
}
export interface SpaceInvite {
  id: string;
  spaceId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}
type Row = Record<string, unknown>;

export class Access {
  constructor(
    private readonly host: SqlHost,
    private readonly clock: () => number = Date.now,
  ) {
    for (const statement of schema) host.sql.exec(statement);
  }
  private all(query: string, ...bindings: unknown[]): Row[] {
    return this.host.sql.exec(query, ...bindings).toArray();
  }
  private iso() {
    return new Date(this.clock()).toISOString();
  }
  private log(actor: string, kind: string, tournamentId: string | null, detail: unknown) {
    this.host.sql.exec(
      'INSERT INTO access_audit (id, at, actor, kind, tournament_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
      uuid(),
      this.iso(),
      actor,
      kind,
      tournamentId,
      JSON.stringify(detail),
    );
  }
  auditOf(tournamentId: string) {
    return this.all(
      'SELECT at, actor, kind, detail FROM access_audit WHERE tournament_id = ? ORDER BY at, rowid',
      tournamentId,
    ).map((r) => ({
      at: r.at as string,
      actor: r.actor as string,
      kind: r.kind as string,
      detail: JSON.parse(r.detail as string) as unknown,
    }));
  }

  // --- play space membership -------------------------------------------------------------
  isMember(spaceId: string, accountId: string) {
    return (
      spaceId === BT_PLAY_SPACE_ID ||
      this.all(
        'SELECT 1 FROM space_members WHERE space_id = ? AND account_id = ?',
        spaceId,
        accountId,
      ).length > 0
    );
  }
  /** Spaces an account belongs to, the canonical one included. */
  spacesOf(accountId: string): Set<string> {
    return new Set([
      BT_PLAY_SPACE_ID,
      ...this.all('SELECT space_id FROM space_members WHERE account_id = ?', accountId).map(
        (r) => r.space_id as string,
      ),
    ]);
  }
  addMember(spaceId: string, accountId: string, by: string) {
    if (spaceId === BT_PLAY_SPACE_ID) return;
    this.host.sql.exec(
      'INSERT OR IGNORE INTO space_members (space_id, account_id, added_by, added_at) VALUES (?, ?, ?, ?)',
      spaceId,
      accountId,
      by,
      this.iso(),
    );
  }
  members(spaceId: string): string[] {
    return this.all('SELECT account_id FROM space_members WHERE space_id = ?', spaceId).map(
      (r) => r.account_id as string,
    );
  }
  leave(spaceId: string, accountId: string) {
    this.host.sql.exec(
      'DELETE FROM space_members WHERE space_id = ? AND account_id = ?',
      spaceId,
      accountId,
    );
  }

  // --- invites ---------------------------------------------------------------------------
  /** A link code for one space: random, stored hashed, revocable. It carries no write right. */
  async createInvite(spaceId: string, accountId: string, admin: boolean) {
    ensure(
      spaceId !== BT_PLAY_SPACE_ID,
      'NOT_SHAREABLE',
      'Bite the Trouble is open to everyone',
      409,
    );
    ensure(
      admin || this.isMember(spaceId, accountId),
      'FORBIDDEN_SPACE',
      'Join this play space before sharing it',
      403,
    );
    const code = base64url(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(18))));
    const id = uuid();
    this.host.sql.exec(
      'INSERT INTO space_invites (id, space_id, code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      spaceId,
      await sha256(code),
      accountId,
      this.iso(),
      this.clock() + inviteTtl,
    );
    this.log(accountId, 'SPACE_INVITE_CREATED', null, { spaceId, id });
    return { id, code };
  }
  invites(spaceId: string): SpaceInvite[] {
    return this.all(
      'SELECT * FROM space_invites WHERE space_id = ? ORDER BY created_at',
      spaceId,
    ).map((r) => ({
      id: r.id as string,
      spaceId: r.space_id as string,
      createdBy: r.created_by as string,
      createdAt: r.created_at as string,
      expiresAt: new Date(r.expires_at as number).toISOString(),
      revoked: r.revoked_at !== null,
    }));
  }
  revokeInvite(id: string, accountId: string, admin: boolean) {
    const row = this.all('SELECT * FROM space_invites WHERE id = ?', id)[0];
    ensure(!!row, 'INVITE_NOT_FOUND', 'Invite not found', 404);
    ensure(
      admin || row!.created_by === accountId || this.isMember(row!.space_id as string, accountId),
      'FORBIDDEN_SPACE',
      'Only a member can revoke this invite',
      403,
    );
    this.host.sql.exec(
      'UPDATE space_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      this.iso(),
      id,
    );
    this.log(accountId, 'SPACE_INVITE_REVOKED', null, { id });
  }
  /** Accepting an invite makes the account a member, once: the same invite twice adds nothing. */
  async join(code: unknown, accountId: string): Promise<string> {
    const hashed = typeof code === 'string' && code ? await sha256(code) : '';
    const row = this.all(
      'SELECT * FROM space_invites WHERE code = ? AND revoked_at IS NULL AND expires_at > ?',
      hashed,
      this.clock(),
    )[0];
    ensure(!!row, 'INVALID_INVITE', 'This invite is not valid, was revoked, or has expired', 403);
    const spaceId = row!.space_id as string;
    const already = this.isMember(spaceId, accountId);
    this.addMember(spaceId, accountId, row!.created_by as string);
    if (!already) this.log(accountId, 'SPACE_JOINED', null, { spaceId, invite: row!.id });
    return spaceId;
  }

  // --- who scores a match ----------------------------------------------------------------
  access(tournamentId: string): MatchAccess | undefined {
    const r = this.all('SELECT * FROM match_access WHERE tournament_id = ?', tournamentId)[0];
    return (
      r && {
        tournamentId,
        createdBy: (r.created_by as string | null) ?? null,
        scorerId: (r.scorer_id as string | null) ?? null,
        epoch: r.epoch as number,
      }
    );
  }
  /** Whether this session holds the match: `free` until the first write after a transfer. */
  holds(tournamentId: string, session: string): 'here' | 'elsewhere' | 'free' {
    const r = this.all(
      'SELECT scorer_session FROM match_access WHERE tournament_id = ?',
      tournamentId,
    )[0];
    if (!r || r.scorer_session === null) return 'free';
    return r.scorer_session === session ? 'here' : 'elsewhere';
  }
  /** The author of a new match becomes its scorer, on the device that created it. */
  register(tournamentId: string, accountId: string, session: string) {
    this.host.sql.exec(
      'INSERT OR IGNORE INTO match_access (tournament_id, created_by, scorer_id, scorer_session, epoch, updated_at) VALUES (?, ?, ?, ?, 1, ?)',
      tournamentId,
      accountId,
      accountId,
      session,
      this.iso(),
    );
    this.log(accountId, 'MATCH_CREATED', tournamentId, { scorer: accountId });
  }
  /**
   * Checks the write right against the server's record: the scorer account, on the session that
   * holds the match. Admin role does not matter here. Returns the epoch the write happens in.
   */
  assertScorer(tournamentId: string, accountId: string, session: string): number {
    const r = this.all('SELECT * FROM match_access WHERE tournament_id = ?', tournamentId)[0];
    if (!r || r.scorer_id === null)
      throw new DomainError(
        'MATCH_UNASSIGNED',
        'This match has no scorer: an admin must assign one explicitly',
        403,
      );
    if (r.scorer_id !== accountId)
      throw new DomainError('NOT_SCORER', 'Only the scorer of this match can change it', 403);
    if (r.scorer_session === null) {
      // First write after a transfer: the receiving account binds its session, atomically.
      this.host.sql.exec(
        'UPDATE match_access SET scorer_session = ?, updated_at = ? WHERE tournament_id = ?',
        session,
        this.iso(),
        tournamentId,
      );
    } else if (r.scorer_session !== session)
      throw new DomainError(
        'SCORER_ELSEWHERE',
        'This match is being scored on another device: take it over here to continue',
        409,
      );
    return r.epoch as number;
  }
  /** The scorer moves the match to the session they are using now; the old session is refused. */
  takeOver(tournamentId: string, accountId: string, session: string) {
    const r = this.all('SELECT * FROM match_access WHERE tournament_id = ?', tournamentId)[0];
    ensure(
      r?.scorer_id === accountId,
      'NOT_SCORER',
      'Only the scorer can take over the device',
      403,
    );
    this.host.sql.exec(
      'UPDATE match_access SET scorer_session = ?, epoch = epoch + 1, updated_at = ? WHERE tournament_id = ?',
      session,
      this.iso(),
      tournamentId,
    );
    this.log(accountId, 'SCORER_DEVICE_TAKEN', tournamentId, { epoch: (r!.epoch as number) + 1 });
  }
  /** Explicit transfer: the previous scorer's right ends in the same write. */
  transfer(tournamentId: string, accountId: string, session: string, to: string) {
    this.assertScorer(tournamentId, accountId, session);
    ensure(to !== accountId, 'SAME_SCORER', 'Choose someone else', 409);
    const epoch = this.all(
      'SELECT epoch FROM match_access WHERE tournament_id = ?',
      tournamentId,
    )[0]!.epoch as number;
    this.host.sql.exec(
      'UPDATE match_access SET scorer_id = ?, scorer_session = NULL, epoch = epoch + 1, updated_at = ? WHERE tournament_id = ?',
      to,
      this.iso(),
      tournamentId,
    );
    this.log(accountId, 'SCORER_TRANSFERRED', tournamentId, {
      from: accountId,
      to,
      epoch: epoch + 1,
    });
  }
  /** An admin names a scorer for an unassigned or abandoned match. Always traced as a recovery. */
  recover(tournamentId: string, adminId: string, to: string, reason: string) {
    const r = this.access(tournamentId);
    this.host.sql.exec(
      'INSERT INTO match_access (tournament_id, created_by, scorer_id, scorer_session, epoch, updated_at) VALUES (?, NULL, ?, NULL, 1, ?) ON CONFLICT(tournament_id) DO UPDATE SET scorer_id = excluded.scorer_id, scorer_session = NULL, epoch = match_access.epoch + 1, updated_at = excluded.updated_at',
      tournamentId,
      to,
      this.iso(),
    );
    this.log(adminId, 'ADMIN_RECOVERY', tournamentId, { from: r?.scorerId ?? null, to, reason });
  }
  /** Every tournament the account scores or created, for listings. */
  scoredBy(accountId: string): Set<string> {
    return new Set(
      this.all(
        'SELECT tournament_id FROM match_access WHERE scorer_id = ? OR created_by = ?',
        accountId,
        accountId,
      ).map((r) => r.tournament_id as string),
    );
  }
}
