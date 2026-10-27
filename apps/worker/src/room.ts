import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectNamespace, DurableObjectState, Fetcher, R2Bucket } from './cf.js';
import { uuid } from '../../../packages/application/src/portable.js';
import type { Context } from '../../../packages/domain/src/index.js';
import { SqlEngineDatabase } from '../../../packages/local-store/src/sql-database.js';
import { LocalGameAdapter } from '../../web/src/services/local.js';
import { Accounts, isAdmin, type Account } from './accounts.js';
import { Passkeys, type RelyingParty } from './passkeys.js';
import { dispatch } from './rpc.js';
import { errorResponse, json, readJson, sessionCookie, sessionToken } from './http.js';

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  BACKUPS?: R2Bucket;
  /** Creates the owner account while there is none (wrangler secret put OWNER_SETUP_CODE). */
  OWNER_SETUP_CODE?: string;
  APP_VERSION?: string;
}

/**
 * The whole pub in one Durable Object: the same engine the phones run in standalone mode, on the
 * object's SQLite, plus the accounts. Requests are handled one at a time, so every command sees
 * the state left by the previous one and its audit names the account that made it.
 */
export class GameRoom extends DurableObject<Env> {
  private readonly db: SqlEngineDatabase;
  private readonly accounts: Accounts;
  private readonly passkeys: Passkeys;
  private readonly context: Context;
  private readonly adapter: LocalGameAdapter;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new SqlEngineDatabase(ctx.storage);
    this.accounts = new Accounts(ctx.storage);
    this.passkeys = new Passkeys(this.accounts);
    this.context = {
      id: uuid,
      now: () => new Date().toISOString(),
      operator: 'server',
      role: 'organizer',
    };
    this.adapter = new LocalGameAdapter({
      storage: () => this.db,
      channel: null,
      context: this.context,
      app: env.APP_VERSION ?? 'cloud',
    });
  }

  override fetch(request: Request): Promise<Response> {
    const run = this.queue.then(() => this.handle(request).catch(errorResponse));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    const rp: RelyingParty = { id: url.hostname, origin: url.origin };
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    const token = sessionToken(request);
    // The daily copy kept in R2: only the scheduled handler calls this path, which the Worker
    // never forwards from the internet (it forwards /api only).
    if (route === 'POST /internal/backup') {
      this.context.operator = 'backup';
      return json(await this.adapter.exportBackup());
    }
    if (request.method !== 'GET') {
      // Cookies are SameSite=Strict; the origin check also refuses cross-site form posts.
      const origin = request.headers.get('Origin');
      if (origin !== null && origin !== url.origin)
        return json({ error: { code: 'FORBIDDEN', message: 'Cross-site request' } }, 403);
    }
    const signIn = async (account: Account) => {
      const session = await this.accounts.createSession(account.id);
      return json({ account }, 200, { 'Set-Cookie': sessionCookie(session.token, session.maxAge) });
    };

    // Without a session.
    switch (route) {
      case 'GET /api/session':
        return json({
          account: await this.accounts.session(token),
          ownerExists: this.accounts.hasOwner(),
        });
      case 'POST /api/auth/register':
        return signIn(
          await this.accounts.register(await readJson(request), this.env.OWNER_SETUP_CODE, ip),
        );
      case 'POST /api/auth/login':
        return signIn(await this.accounts.login(await readJson(request), ip));
      case 'POST /api/auth/reset':
        return signIn(await this.accounts.resetPassword(await readJson(request), ip));
      case 'POST /api/auth/logout':
        await this.accounts.logout(token);
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
      case 'POST /api/passkeys/login/options':
        return json(await this.passkeys.authenticationOptions(rp));
      case 'POST /api/passkeys/login':
        return signIn(await this.passkeys.authenticate(await readJson(request), rp));
    }

    const account = await this.accounts.session(token);
    if (!account)
      return json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } }, 401);
    this.context.operator = account.username;
    const body = request.method === 'GET' ? {} : await readJson(request);
    switch (route) {
      case 'GET /api/revision':
        return json({ revision: this.db.revision() });
      case 'POST /api/rpc':
        return json({
          result:
            (await dispatch(this.adapter, account, body.method, body.args, this.accounts)) ?? null,
        });
      case 'POST /api/auth/password':
        await this.accounts.changePassword(account, body.current, body.next);
        return json({ ok: true });
      case 'GET /api/passkeys':
        return json({ passkeys: this.passkeys.list(account) });
      case 'POST /api/passkeys/register/options':
        return json(await this.passkeys.registrationOptions(account, rp));
      case 'POST /api/passkeys/register':
        return json({ passkey: await this.passkeys.register(account, body, rp) });
      case 'POST /api/passkeys/remove':
        this.passkeys.remove(account, body.id);
        return json({ ok: true });
    }

    if (!isAdmin(account))
      return json({ error: { code: 'ADMIN_REQUIRED', message: 'Only an admin can do this' } }, 403);
    switch (route) {
      case 'GET /api/admin/users':
        return json({ users: this.accounts.list(), invites: this.accounts.invites(account) });
      case 'POST /api/admin/invites':
        return json(
          await this.accounts.createInvite(
            account,
            typeof body.playerId === 'string' ? body.playerId : null,
          ),
        );
      case 'POST /api/admin/invites/revoke':
        this.accounts.revokeInvite(account, body.id);
        return json({ ok: true });
      case 'POST /api/admin/users/role':
        return json({ user: this.accounts.setRole(account, body.userId, body.role) });
      case 'POST /api/admin/users/link':
        return json({ user: this.accounts.linkPlayer(account, body.userId, body.playerId) });
      case 'POST /api/admin/users/reset':
        return json(await this.accounts.resetCode(account, body.userId));
      case 'POST /api/admin/users/disable':
        return json({ user: this.accounts.setDisabled(account, body.userId, body.disabled) });
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
  }
}
