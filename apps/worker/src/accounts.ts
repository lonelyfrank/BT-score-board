import { DomainError, ensure } from '../../../packages/domain/src/index.js';
import { uuid } from '../../../packages/application/src/portable.js';
import type { SqlHost } from '../../../packages/local-store/src/sql-database.js';

export type Role = 'owner' | 'admin' | 'player';
export interface Account {
  id: string;
  username: string;
  role: Role;
  /** The player record this person plays as; null until an admin links it. */
  playerId: string | null;
  disabled: boolean;
  createdAt: string;
  passkeys: number;
}
export interface Invite {
  id: string;
  role: Role;
  playerId: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
}

const day = 24 * 3600 * 1000;
const sessionTtl = 60 * day;
const inviteTtl = 7 * day;
const resetTtl = day;
// Workers caps PBKDF2 at 100k iterations; the salt is per password.
const iterations = 100_000;
const attemptWindow = 15 * 60 * 1000;
const maxAttempts = 10;

const encoder = new TextEncoder();
export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (length: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
export async function sha256(text: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}
/** Constant-time comparison of two strings of any length. */
export function sameText(a: string, b: string) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds },
    key,
    256,
  );
  return base64url(new Uint8Array(bits));
}
export async function hashPassword(password: string) {
  const salt = random(16);
  return `pbkdf2-sha256$${iterations}$${base64url(salt)}$${await derive(password, salt, iterations)}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, rounds, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !rounds || !salt || !hash) return false;
  return sameText(await derive(password, fromBase64url(salt), Number(rounds)), hash);
}
/** Readable one-time code: no 0/O, 1/I/L. */
function code() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const chars = Array.from(random(12), (b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}
const normalizeCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function validUsername(username: unknown): string {
  const value = typeof username === 'string' ? username.trim().toLowerCase() : '';
  ensure(
    /^[a-z0-9._-]{3,24}$/.test(value),
    'INVALID_USERNAME',
    'Username: 3–24 characters among letters, digits, dot, dash and underscore',
    422,
  );
  return value;
}
export function validPassword(password: unknown): string {
  ensure(
    typeof password === 'string' && password.length >= 8 && password.length <= 128,
    'WEAK_PASSWORD',
    'The password needs 8 to 128 characters',
    422,
  );
  return password as string;
}

const schema = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','player')), player_id TEXT UNIQUE, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
  'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
  "CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('invite','reset')), role TEXT NOT NULL, player_id TEXT, user_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT)",
  'CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, since INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT)',
  'CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id)',
  'CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, user_id TEXT, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL)',
];

type Row = Record<string, unknown>;
const toAccount = (r: Row): Account => ({
  id: r.id as string,
  username: r.username as string,
  role: r.role as Role,
  playerId: (r.player_id as string | null) ?? null,
  disabled: !!r.disabled,
  createdAt: r.created_at as string,
  passkeys: (r.passkeys as number) ?? 0,
});
const accountColumns =
  'u.*, (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys FROM users u';

const forbidden = (message: string) => new DomainError('ADMIN_REQUIRED', message, 403);
export const isAdmin = (a: Account) => a.role === 'owner' || a.role === 'admin';

/**
 * Accounts of the people who use the app. The owner (first account, created with the setup code)
 * appoints admins; admins invite players and link each account to the player record whose
 * history it continues. Passwords are salted PBKDF2; sessions and codes are stored hashed.
 */
export class Accounts {
  constructor(
    readonly host: SqlHost,
    private readonly clock: () => number = Date.now,
  ) {
    for (const statement of schema) host.sql.exec(statement);
  }
  private all(query: string, ...bindings: unknown[]) {
    return this.host.sql.exec(query, ...bindings).toArray();
  }
  private iso(ms = this.clock()) {
    return new Date(ms).toISOString();
  }
  hasOwner() {
    return this.all("SELECT 1 FROM users WHERE role = 'owner'").length > 0;
  }
  get(id: string): Account | undefined {
    const row = this.all(`SELECT ${accountColumns} WHERE u.id = ?`, id)[0];
    return row && toAccount(row);
  }
  list(): Account[] {
    return this.all(`SELECT ${accountColumns} ORDER BY u.username`).map(toAccount);
  }
  byPlayer(playerId: string): Account | undefined {
    const row = this.all(`SELECT ${accountColumns} WHERE u.player_id = ?`, playerId)[0];
    return row && toAccount(row);
  }

  /** Two player records were merged: the account of the absorbed one now plays as the survivor. */
  movePlayer(from: string, to: string) {
    this.host.sql.exec('UPDATE users SET player_id = ? WHERE player_id = ?', to, from);
  }

  /** Too many failures for this key in the window: refuses before checking anything. */
  private throttle(keys: string[]) {
    const now = this.clock();
    for (const key of keys) {
      const row = this.all('SELECT count, since FROM attempts WHERE key = ?', key)[0];
      if (
        row &&
        now - (row.since as number) < attemptWindow &&
        (row.count as number) >= maxAttempts
      )
        throw new DomainError(
          'TOO_MANY_ATTEMPTS',
          'Too many attempts: retry in a few minutes',
          429,
        );
    }
  }
  private failed(keys: string[]) {
    const now = this.clock();
    for (const key of keys) {
      const row = this.all('SELECT count, since FROM attempts WHERE key = ?', key)[0];
      const fresh = !row || now - (row.since as number) >= attemptWindow;
      this.host.sql.exec(
        'INSERT OR REPLACE INTO attempts (key, count, since) VALUES (?, ?, ?)',
        key,
        fresh ? 1 : (row!.count as number) + 1,
        fresh ? now : row!.since,
      );
    }
  }

  /**
   * Creates an account with an invite code, or the owner's with the setup code while there is
   * no owner yet. An invite may carry the player the account is linked to.
   */
  async register(
    input: { username?: unknown; password?: unknown; code?: unknown },
    setupCode: string | undefined,
    ip: string,
  ): Promise<Account> {
    const username = validUsername(input.username);
    const password = validPassword(input.password);
    const given = typeof input.code === 'string' ? normalizeCode(input.code) : '';
    this.throttle([`ip:${ip}`]);
    const owner = !this.hasOwner() && !!setupCode && sameText(given, normalizeCode(setupCode));
    const hashed = await sha256(given);
    const invite = owner
      ? undefined
      : this.all(
          "SELECT * FROM invites WHERE code = ? AND kind = 'invite' AND used_by IS NULL AND expires_at > ?",
          hashed,
          this.clock(),
        )[0];
    if (!owner && !invite) {
      this.failed([`ip:${ip}`]);
      throw new DomainError('INVALID_CODE', 'The invite code is not valid or has expired', 403);
    }
    ensure(
      !this.all('SELECT 1 FROM users WHERE username = ?', username).length,
      'USERNAME_TAKEN',
      'This username is already taken',
      409,
    );
    const hash = await hashPassword(password);
    const id = uuid();
    const playerId = (invite?.player_id as string | null) ?? null;
    this.host.transactionSync(() => {
      // The linked player may have been given to someone else since the invite was created.
      const link =
        playerId && !this.all('SELECT 1 FROM users WHERE player_id = ?', playerId).length;
      this.host.sql.exec(
        'INSERT INTO users (id, username, password, role, player_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        username,
        hash,
        owner ? 'owner' : (invite!.role as Role),
        link ? playerId : null,
        this.iso(),
      );
      if (invite) this.host.sql.exec('UPDATE invites SET used_by = ? WHERE id = ?', id, invite.id);
    });
    return this.get(id)!;
  }
  async login(input: { username?: unknown; password?: unknown }, ip: string): Promise<Account> {
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const keys = [`ip:${ip}`, `user:${username}`];
    this.throttle(keys);
    const row = this.all('SELECT * FROM users WHERE username = ?', username)[0];
    // A missing user costs the same hashing as a wrong password.
    const ok = await verifyPassword(
      password,
      (row?.password as string) ?? `pbkdf2-sha256$${iterations}$AAAAAAAAAAAAAAAAAAAAAA$x`,
    );
    if (!row || !ok) {
      this.failed(keys);
      throw new DomainError('INVALID_LOGIN', 'Wrong username or password', 401);
    }
    ensure(!row.disabled, 'ACCOUNT_DISABLED', 'This account has been disabled', 403);
    this.host.sql.exec('DELETE FROM attempts WHERE key = ?', `user:${username}`);
    return this.get(row.id as string)!;
  }
  async createSession(userId: string) {
    const token = base64url(random(32));
    const expiresAt = this.clock() + sessionTtl;
    this.host.sql.exec(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
      await sha256(token),
      userId,
      expiresAt,
    );
    this.host.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', this.clock());
    return { token, maxAge: sessionTtl / 1000 };
  }
  /** The account of a session token; a session in use is extended (sliding expiry). */
  async session(token: string | null): Promise<Account | null> {
    if (!token) return null;
    const hashed = await sha256(token);
    const row = this.all(
      'SELECT user_id, expires_at FROM sessions WHERE token = ? AND expires_at > ?',
      hashed,
      this.clock(),
    )[0];
    if (!row) return null;
    const account = this.get(row.user_id as string);
    if (!account || account.disabled) return null;
    if ((row.expires_at as number) - this.clock() < sessionTtl - day)
      this.host.sql.exec(
        'UPDATE sessions SET expires_at = ? WHERE token = ?',
        this.clock() + sessionTtl,
        hashed,
      );
    return account;
  }
  async logout(token: string | null) {
    if (token) this.host.sql.exec('DELETE FROM sessions WHERE token = ?', await sha256(token));
  }
  async changePassword(account: Account, current: unknown, next: unknown) {
    const row = this.all('SELECT password FROM users WHERE id = ?', account.id)[0]!;
    ensure(
      typeof current === 'string' && (await verifyPassword(current, row.password as string)),
      'INVALID_LOGIN',
      'The current password is wrong',
      401,
    );
    const hash = await hashPassword(validPassword(next));
    this.host.sql.exec('UPDATE users SET password = ? WHERE id = ?', hash, account.id);
  }
  /** Sets a new password with a reset code from an admin; every session of the account ends. */
  async resetPassword(
    input: { username?: unknown; code?: unknown; password?: unknown },
    ip: string,
  ) {
    const username = validUsername(input.username);
    const password = validPassword(input.password);
    this.throttle([`ip:${ip}`]);
    const hashed = await sha256(typeof input.code === 'string' ? normalizeCode(input.code) : '');
    const user = this.all('SELECT id FROM users WHERE username = ?', username)[0];
    const reset =
      user &&
      this.all(
        "SELECT id FROM invites WHERE code = ? AND kind = 'reset' AND user_id = ? AND used_by IS NULL AND expires_at > ?",
        hashed,
        user.id,
        this.clock(),
      )[0];
    if (!reset) {
      this.failed([`ip:${ip}`]);
      throw new DomainError('INVALID_CODE', 'The reset code is not valid or has expired', 403);
    }
    const hash = await hashPassword(password);
    this.host.transactionSync(() => {
      this.host.sql.exec('UPDATE users SET password = ? WHERE id = ?', hash, user.id);
      this.host.sql.exec('UPDATE invites SET used_by = ? WHERE id = ?', user.id, reset.id);
      this.host.sql.exec('DELETE FROM sessions WHERE user_id = ?', user.id);
    });
    return this.get(user.id as string)!;
  }

  // Administration. Every method checks the acting account.
  private requireAdmin(by: Account) {
    if (!isAdmin(by)) throw forbidden('Only an admin can do this');
  }
  private target(id: unknown): Account {
    const account = typeof id === 'string' ? this.get(id) : undefined;
    if (!account) throw new DomainError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
    return account;
  }
  /** An invite for a new player account, optionally linked to an existing player record. */
  async createInvite(by: Account, playerId: string | null) {
    this.requireAdmin(by);
    if (playerId)
      ensure(!this.byPlayer(playerId), 'PLAYER_TAKEN', 'This player already has an account', 409);
    const value = code();
    const id = uuid();
    const expiresAt = this.clock() + inviteTtl;
    this.host.sql.exec(
      "INSERT INTO invites (id, code, kind, role, player_id, created_by, created_at, expires_at) VALUES (?, ?, 'invite', 'player', ?, ?, ?, ?)",
      id,
      await sha256(normalizeCode(value)),
      playerId,
      by.id,
      this.iso(),
      expiresAt,
    );
    return { id, code: value, expiresAt: this.iso(expiresAt) };
  }
  invites(by: Account): Invite[] {
    this.requireAdmin(by);
    return this.all(
      "SELECT * FROM invites WHERE kind = 'invite' AND used_by IS NULL AND expires_at > ? ORDER BY created_at DESC",
      this.clock(),
    ).map((r) => ({
      id: r.id as string,
      role: r.role as Role,
      playerId: (r.player_id as string | null) ?? null,
      createdBy: r.created_by as string,
      createdAt: r.created_at as string,
      expiresAt: this.iso(r.expires_at as number),
      usedBy: null,
    }));
  }
  revokeInvite(by: Account, id: unknown) {
    this.requireAdmin(by);
    this.host.sql.exec(
      "DELETE FROM invites WHERE id = ? AND kind = 'invite' AND used_by IS NULL",
      String(id ?? ''),
    );
  }
  /** Only the owner appoints or removes admins; the owner's role never changes. */
  setRole(by: Account, userId: unknown, role: unknown) {
    if (by.role !== 'owner') throw forbidden('Only the owner can appoint admins');
    const target = this.target(userId);
    ensure(role === 'admin' || role === 'player', 'INVALID_ROLE', 'Role: admin or player', 422);
    ensure(target.role !== 'owner', 'OWNER_ROLE', 'The owner stays owner', 409);
    this.host.sql.exec('UPDATE users SET role = ? WHERE id = ?', role, target.id);
    return this.get(target.id)!;
  }
  /** Links an account to the player record it plays as (null unlinks). */
  linkPlayer(by: Account, userId: unknown, playerId: unknown) {
    this.requireAdmin(by);
    const target = this.target(userId);
    ensure(
      playerId === null || typeof playerId === 'string',
      'INVALID_PLAYER',
      'Choose a player',
      422,
    );
    if (playerId) {
      const holder = this.byPlayer(playerId as string);
      ensure(
        !holder || holder.id === target.id,
        'PLAYER_TAKEN',
        `This player is already linked to ${holder?.username}`,
        409,
      );
    }
    this.host.sql.exec('UPDATE users SET player_id = ? WHERE id = ?', playerId, target.id);
    return this.get(target.id)!;
  }
  /** A one-time code with which the person sets a new password (forgotten password). */
  async resetCode(by: Account, userId: unknown) {
    this.requireAdmin(by);
    const target = this.target(userId);
    if (target.role !== 'player' && by.role !== 'owner')
      throw forbidden('Only the owner can reset an admin');
    const value = code();
    const expiresAt = this.clock() + resetTtl;
    this.host.sql.exec(
      "INSERT INTO invites (id, code, kind, role, user_id, created_by, created_at, expires_at) VALUES (?, ?, 'reset', ?, ?, ?, ?, ?)",
      uuid(),
      await sha256(normalizeCode(value)),
      target.role,
      target.id,
      by.id,
      this.iso(),
      expiresAt,
    );
    return { code: value, expiresAt: this.iso(expiresAt) };
  }
  /** A disabled account cannot sign in and loses its sessions; its player history stays. */
  setDisabled(by: Account, userId: unknown, disabled: unknown) {
    this.requireAdmin(by);
    const target = this.target(userId);
    ensure(target.role !== 'owner', 'OWNER_ROLE', 'The owner cannot be disabled', 409);
    if (target.role === 'admin' && by.role !== 'owner')
      throw forbidden('Only the owner can disable an admin');
    this.host.transactionSync(() => {
      this.host.sql.exec('UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, target.id);
      if (disabled) this.host.sql.exec('DELETE FROM sessions WHERE user_id = ?', target.id);
    });
    return this.get(target.id)!;
  }
}
