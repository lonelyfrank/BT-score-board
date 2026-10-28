import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectNamespace, DurableObjectState, Fetcher, R2Bucket } from './cf.js';
import { uuid } from '../../../packages/application/src/portable.js';
import type { Context } from '../../../packages/domain/src/index.js';
import { SqlEngineDatabase } from '../../../packages/local-store/src/sql-database.js';
import { LocalGameAdapter } from '../../web/src/services/local.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { Accounts, isAdmin, sha256, type Account } from './accounts.js';
import { Access } from './access.js';
import {
  closeCodes,
  liveState,
  mayFollow,
  parseClientMessage,
  validId,
  type Attachment,
  type LiveSocket,
} from './live.js';
import { Passkeys, type RelyingParty } from './passkeys.js';
import { candidates, createOwnPlayer } from './onboarding.js';
import { dispatch, viewer } from './rpc.js';
import { encode } from './codec.js';
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
  private readonly access: Access;
  private readonly passkeys: Passkeys;
  private readonly context: Context;
  private readonly adapter: LocalGameAdapter;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new SqlEngineDatabase(ctx.storage);
    this.accounts = new Accounts(ctx.storage);
    this.access = new Access(ctx.storage);
    this.passkeys = new Passkeys(this.accounts);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS rpc_commands (command_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, method TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL)',
    );
    // Sockets keep their pings answered without waking the object.
    ctx.setWebSocketAutoResponse?.(new WebSocketRequestResponsePair('ping', 'pong'));
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

  /** Requests, socket messages and publications run one at a time, in arrival order. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }
  override fetch(request: Request): Promise<Response> {
    return this.enqueue(() => this.handle(request).catch(errorResponse));
  }

  private replay(commandId: string, accountId: string): { result: unknown } | null {
    const row = this.ctx.storage.sql
      .exec('SELECT result, account_id FROM rpc_commands WHERE command_id = ?', commandId)
      .toArray()[0];
    if (!row) return null;
    // Another account's command id is no business of this one.
    if (row.account_id !== accountId)
      throw new DomainError('COMMAND_ID_TAKEN', 'This command id belongs to someone else', 409);
    return { result: JSON.parse(row.result as string) as unknown };
  }
  private remember(commandId: string, accountId: string, method: string, result: unknown) {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'INSERT OR IGNORE INTO rpc_commands (command_id, account_id, method, result, created_at) VALUES (?, ?, ?, ?, ?)',
      commandId,
      accountId,
      method,
      JSON.stringify(result ?? null),
      Date.now(),
    );
    // Retries only follow the original command closely.
    sql.exec('DELETE FROM rpc_commands WHERE created_at < ?', Date.now() - 48 * 3600 * 1000);
  }

  // --- live channel (WebSocket Hibernation API) ------------------------------------------
  private sockets() {
    return this.ctx.getWebSockets() as unknown as LiveSocket[];
  }
  /**
   * Opens the live channel of one match. Everything is checked before the upgrade: a valid
   * session (the caller), the page's own origin, a well-formed id, and access to the match.
   */
  private async upgrade(request: Request, url: URL, account: Account, session: string) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return json({ error: { code: 'BAD_REQUEST', message: 'Expected a WebSocket' } }, 426);
    // Browsers always send Origin on a WebSocket: a missing or foreign one is refused.
    if (request.headers.get('Origin') !== url.origin)
      return json({ error: { code: 'FORBIDDEN', message: 'Cross-site request' } }, 403);
    const tournamentId = url.pathname.split('/').pop();
    if (!validId(tournamentId))
      return json({ error: { code: 'BAD_REQUEST', message: 'Invalid match id' } }, 400);
    const attachment: Attachment = { tournamentId, accountId: account.id, session, version: -1 };
    const verdict = await mayFollow(this.accounts, attachment, async (a) =>
      (await viewer(this.adapter, a, this.access)).can(tournamentId),
    );
    if (verdict !== 'ok')
      return json({ error: { code: 'NOT_ALLOWED', message: 'No access to this match' } }, 403);
    await this.adapter.tournament(tournamentId);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1] as unknown as LiveSocket;
    this.ctx.acceptWebSocket(server as never, [tournamentId]);
    const state = await liveState(this.adapter, tournamentId, this.db.revision());
    attachment.version = state.version;
    server.serializeAttachment(attachment);
    server.send(encode(state));
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }
  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    return this.enqueue(async () => {
      const socket = ws as LiveSocket;
      try {
        const { type } = parseClientMessage(message);
        if (type === 'ping') return void socket.send(encode({ type: 'pong' }));
      } catch {
        return void socket.close(closeCodes.badRequest, 'Invalid message');
      }
      const attachment = socket.deserializeAttachment() as Attachment;
      if (!(await this.admit(socket, attachment))) return;
      // `resync`: the complete state again, whatever was missed.
      const state = await liveState(this.adapter, attachment.tournamentId, this.db.revision());
      socket.serializeAttachment({ ...attachment, version: state.version });
      socket.send(encode(state));
    });
  }
  override webSocketClose(ws: WebSocket, code: number) {
    // Completes the closing handshake; the runtime forgets the socket.
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed');
    } catch {
      /* Already closed. */
    }
  }
  override webSocketError() {
    /* The socket is gone; nothing to release: the attachment lives with it. */
  }
  /** Re-checks a socket against the current sessions and rights; closes it when they ended. */
  private async admit(
    socket: LiveSocket,
    attachment: Attachment,
    views = new Map<string, boolean>(),
  ) {
    const verdict = await mayFollow(this.accounts, attachment, async (a) => {
      const key = `${a.id}:${attachment.tournamentId}`;
      if (!views.has(key))
        views.set(key, (await viewer(this.adapter, a, this.access)).can(attachment.tournamentId));
      return views.get(key)!;
    });
    if (verdict === 'ok') return true;
    const code = verdict === 'unauthenticated' ? closeCodes.unauthenticated : closeCodes.forbidden;
    try {
      socket.send(encode({ type: 'revoked', reason: verdict }));
      socket.close(code, verdict);
    } catch {
      /* Already closed. */
    }
    return false;
  }
  /**
   * After a commit: closes the sockets whose session or access ended and sends the new state to
   * those following a tournament that changed. Called on every change and on every logout,
   * disabling, role change or revocation, so open sockets lose access with the right.
   */
  private async publish() {
    const views = new Map<string, boolean>();
    const states = new Map<string, Awaited<ReturnType<typeof liveState>> | null>();
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment) continue;
      if (!(await this.admit(socket, attachment, views))) continue;
      let state = states.get(attachment.tournamentId);
      if (state === undefined) {
        state = await liveState(this.adapter, attachment.tournamentId, this.db.revision()).catch(
          () => null,
        );
        states.set(attachment.tournamentId, state);
      }
      if (!state || state.version === attachment.version) continue;
      socket.serializeAttachment({ ...attachment, version: state.version });
      try {
        socket.send(encode({ ...state, sentAt: Date.now() }));
      } catch {
        /* Closing: the client reconnects and asks for a snapshot. */
      }
    }
  }
  private sweep() {
    return this.publish();
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
        await this.sweep();
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
    // The session (device) that writes: a second phone of the same account has another one.
    const session = await sha256(token!);
    if (route.startsWith('GET /api/live/')) return this.upgrade(request, url, account, session);
    const body = request.method === 'GET' ? {} : await readJson(request);
    switch (route) {
      case 'GET /api/revision':
        return json({ revision: this.db.revision() });
      case 'POST /api/rpc': {
        const commandId = validId(body.commandId) ? body.commandId : null;
        // A retry after a lost response returns the stored outcome and runs nothing again.
        const done = commandId && this.replay(commandId, account.id);
        if (done) return json({ result: done.result, replayed: true });
        const result =
          (await dispatch(
            this.adapter,
            account,
            body.method,
            body.args,
            this.accounts,
            this.access,
            session,
          )) ?? null;
        if (commandId) this.remember(commandId, account.id, String(body.method), result);
        await this.publish();
        return json({ result });
      }
      case 'POST /api/spaces/invites': {
        const spaceId = String(body.spaceId);
        await this.adapter.playSpaces().then((all) => {
          if (!all.some((p) => p.id === spaceId))
            throw new DomainError('PLAY_SPACE_NOT_FOUND', 'Play space not found', 404);
        });
        return json(await this.access.createInvite(spaceId, account.id, isAdmin(account)));
      }
      case 'POST /api/spaces/invites/list':
        return json({
          invites: this.access
            .invites(String(body.spaceId))
            .filter((i) => isAdmin(account) || this.access.isMember(i.spaceId, account.id)),
        });
      case 'POST /api/spaces/invites/revoke':
        this.access.revokeInvite(String(body.id), account.id, isAdmin(account));
        return json({ ok: true });
      case 'POST /api/spaces/join': {
        const spaceId = await this.access.join(body.code, account.id);
        const space = (await this.adapter.playSpaces()).find((p) => p.id === spaceId);
        if (!space) throw new DomainError('PLAY_SPACE_NOT_FOUND', 'Play space not found', 404);
        return json({ space });
      }
      case 'POST /api/spaces/leave':
        this.access.leave(String(body.spaceId), account.id);
        await this.sweep();
        return json({ ok: true });
      case 'POST /api/auth/password':
        await this.accounts.changePassword(account, body.current, body.next);
        return json({ ok: true });
      case 'GET /api/passkeys':
        return json({ passkeys: this.passkeys.list(account) });
      case 'POST /api/passkeys/register/options':
        return json(await this.passkeys.registrationOptions(account, rp));
      case 'POST /api/passkeys/register':
        return json({ passkey: await this.passkeys.register(account, body, rp) });
      case 'GET /api/me/candidates':
        return json({ players: await candidates(this.adapter, this.accounts, account) });
      case 'POST /api/me/player':
        return json({ account: await createOwnPlayer(this.adapter, this.accounts, account, body) });
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
      case 'POST /api/admin/users/role': {
        const user = this.accounts.setRole(account, body.userId, body.role);
        await this.sweep();
        return json({ user });
      }
      case 'POST /api/admin/users/link': {
        const user = this.accounts.linkPlayer(account, body.userId, body.playerId);
        await this.sweep();
        return json({ user });
      }
      case 'POST /api/admin/spaces/members/remove':
        this.access.leave(String(body.spaceId), String(body.accountId));
        await this.sweep();
        return json({ ok: true });
      case 'POST /api/admin/users/reset':
        return json(await this.accounts.resetCode(account, body.userId));
      case 'POST /api/admin/users/disable': {
        const user = this.accounts.setDisabled(account, body.userId, body.disabled);
        await this.sweep();
        return json({ user });
      }
      case 'POST /api/admin/users/create':
        return json(await this.accounts.createUser(account, body.username, body.playerId));
      case 'POST /api/admin/users/rename':
        return json({ user: this.accounts.renameUser(account, body.userId, body.username) });
      case 'POST /api/admin/users/delete': {
        const removed = this.accounts.deleteUser(account, body.userId);
        this.access.forget(removed.id, account.id);
        await this.sweep();
        return json({ ok: true });
      }
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
  }
}
