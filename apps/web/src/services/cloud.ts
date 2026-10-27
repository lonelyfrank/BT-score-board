import { useSyncExternalStore } from 'react';
import { readBackup, summarizeBackup } from '../../../../packages/local-store/src/backup.js';
import type { BackupFile, EngineEvent } from '../../../../packages/local-store/src/index.js';
import type { Account, Invite } from '../../../worker/src/accounts.js';
import type { Passkey } from '../../../worker/src/passkeys.js';
import {
  adminReadMethods,
  backupMethods,
  readMethods,
  writeMethods,
  type AccessMethod,
  type CloudMethod,
} from '../../../worker/src/methods.js';
import { decode } from '../../../worker/src/codec.js';
import { ApiError, messages, type GameAdapter } from './game.js';
import type { LocalGameAdapter } from './local.js';

export type { Account, Invite, Passkey };
/** What the screens use of the device engine: the cloud adapter runs it on the server. */
export type EngineApi = Pick<
  LocalGameAdapter,
  | 'connect'
  | 'subscribe'
  | 'status'
  | 'exportBackup'
  | 'readBackup'
  | 'importBackup'
  | 'progression'
  | 'crews'
  | 'links'
  | 'crewProgression'
  | 'crewTournaments'
  | 'allTournaments'
  | 'saveCrew'
  | 'deleteCrew'
  | 'linkPlayers'
  | 'removeTournament'
  | 'removedTournaments'
  | 'exportCrew'
  | 'previewMerge'
  | 'mergeBackup'
  | 'playSpaces'
  | 'createPlaySpace'
  | 'moveTournament'
  | 'unclassifiedTournaments'
  | 'assignUnclassified'
  | 'variants'
  | 'resolveVariant'
>;
/** Who scores a match, as the server records it. */
export interface MatchAccessInfo {
  tournamentId: string;
  createdBy: string | null;
  scorerId: string | null;
  epoch: number;
  scorer: { id: string; username: string } | null;
  /** The signed-in account is the scorer (it may still be on another device). */
  mine: boolean;
  /** For the scorer: whether this device holds the match, or another phone does. */
  device: 'here' | 'elsewhere' | 'free' | null;
}
export interface ScorerCandidate {
  id: string;
  username: string;
  playerId: string | null;
}
export interface SpaceInviteInfo {
  id: string;
  spaceId: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}
type Remote = {
  [K in Exclude<CloudMethod, AccessMethod>]: (
    ...args: Parameters<LocalGameAdapter[K]>
  ) => Promise<Awaited<ReturnType<LocalGameAdapter[K]>>>;
};

export async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('NETWORK', messages.NETWORK!, true);
  }
  const data = (await response
    .text()
    .then(decode)
    .catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    const code: string = data?.error?.code ?? `HTTP_${response.status}`;
    if (code === 'UNAUTHENTICATED') session.set(null);
    throw new ApiError(
      code,
      messages[code] ?? data?.error?.message ?? messages.SERVER_DOWN!,
      response.status >= 500 || response.status === 429,
    );
  }
  if (data === null) throw new ApiError('NETWORK', messages.NETWORK!, true);
  return data as T;
}

/** The signed-in account, shared by every screen; undefined until the first check. */
let current: Account | null | undefined;
const listeners = new Set<() => void>();
export const session = {
  get: () => current,
  set(account: Account | null) {
    current = account;
    listeners.forEach((listener) => listener());
  },
};
export function useAccount(): Account | null | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => current,
  );
}
export const isAdmin = (a: Account | null | undefined) =>
  a?.role === 'owner' || a?.role === 'admin';

const uuid = () => crypto.randomUUID();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Sends one rpc. A change that fails for lack of network is repeated, with the same command id,
 * a couple of times: if the first attempt did reach the server, the repeat returns its outcome
 * instead of running it again. If every attempt fails the error is "uncertain": the screen
 * must not show the change as saved.
 */
async function sendRpc<T>(body: {
  method: string;
  args: unknown[];
  commandId?: string;
}): Promise<T> {
  const attempts = body.commandId ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await request<T>('/rpc', body);
    } catch (error) {
      const network = error instanceof ApiError && error.code === 'NETWORK';
      if (!network || attempt >= attempts) throw error;
      await wait(attempt * 1000);
    }
  }
}

// Backups are verified here for the preview, and sent as their exported text: the server checks
// their integrity again before writing.
const backupTexts = new WeakMap<BackupFile, string>();

/**
 * Cloud mode: the engine of the standalone app runs in the Cloudflare Durable Object, and each
 * method is called there for the signed-in account. Changes by others arrive with the revision,
 * polled while the app is visible.
 */
export class CloudAdapter {
  readonly mode = 'cloud' as const;
  private listeners = new Set<(event: EngineEvent) => void>();
  private revision: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  declare matchAccess: (tournamentId: string) => Promise<MatchAccessInfo>;
  declare scorerCandidates: (tournamentId: string) => Promise<ScorerCandidate[]>;
  declare transferScorer: (tournamentId: string, toAccountId: string) => Promise<MatchAccessInfo>;
  declare takeOverScoring: (tournamentId: string) => Promise<MatchAccessInfo>;
  declare recoverScorer: (
    tournamentId: string,
    toAccountId: string,
    reason: string,
  ) => Promise<MatchAccessInfo>;

  constructor() {
    const remote = this as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const call =
      (method: CloudMethod, write: boolean) =>
      async (...args: unknown[]) => {
        // Every change carries an id of its own: if the answer is lost and the call is repeated,
        // the server returns the first outcome instead of applying it twice.
        const commandId = write ? uuid() : undefined;
        const { result } = await sendRpc<{ result: unknown }>({ method, args, commandId });
        if (write) {
          this.revision = null;
          this.emit({ type: 'changed', origin: 'local' });
        }
        return result;
      };
    // Backup imports and merges are methods of this class: they send the file's text.
    for (const method of [...readMethods, ...adminReadMethods])
      remote[method] = call(method, false);
    for (const method of writeMethods)
      if (!(backupMethods as readonly string[]).includes(method))
        remote[method] = call(method, true);
    // Join/follow links, invites and play space membership go through plain routes.
  }

  // Sessions and accounts.
  async refreshSession() {
    const data = await request<{ account: Account | null; ownerExists: boolean }>('/session');
    session.set(data.account);
    return data;
  }
  private async signIn(path: string, body: unknown) {
    const { account } = await request<{ account: Account }>(path, body);
    session.set(account);
    return account;
  }
  login(username: string, password: string) {
    return this.signIn('/auth/login', { username, password });
  }
  register(username: string, password: string, code: string) {
    return this.signIn('/auth/register', { username, password, code });
  }
  resetPassword(username: string, code: string, password: string) {
    return this.signIn('/auth/reset', { username, code, password });
  }
  async logout() {
    await request('/auth/logout', {});
    session.set(null);
  }
  changePassword(current: string, next: string) {
    return request('/auth/password', { current, next });
  }
  async passkeys() {
    return (await request<{ passkeys: Passkey[] }>('/passkeys')).passkeys;
  }
  async addPasskey(name: string) {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const { options, challengeId } = await request<{
      options: Parameters<typeof startRegistration>[0]['optionsJSON'];
      challengeId: string;
    }>('/passkeys/register/options', {});
    const response = await startRegistration({ optionsJSON: options }).catch(passkeyError);
    await request('/passkeys/register', { challengeId, response, name });
    await this.refreshSession();
  }
  async removePasskey(id: string) {
    await request('/passkeys/remove', { id });
    await this.refreshSession();
  }
  async passkeyLogin() {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const { options, challengeId } = await request<{
      options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
      challengeId: string;
    }>('/passkeys/login/options', {});
    const response = await startAuthentication({ optionsJSON: options }).catch(passkeyError);
    return this.signIn('/passkeys/login', { challengeId, response });
  }
  /** Wizard: players that nobody plays as yet, which a newcomer may recognise as themselves. */
  async candidates() {
    return (
      await request<{
        players: { id: string; displayName: string; nickname: string | null }[];
      }>('/me/candidates')
    ).players;
  }
  /** Wizard: creates the player of this account, merging the ones it recognises as itself. */
  async createOwnPlayer(displayName: string, nickname: string, mergeIds: string[]) {
    const { account } = await request<{ account: Account }>('/me/player', {
      displayName,
      nickname,
      mergeIds,
    });
    session.set(account);
    this.revision = null;
    this.emit({ type: 'changed', origin: 'local' });
    return account;
  }
  /** A link code for a play space: members can share it; it carries no write right. */
  createSpaceInvite(spaceId: string) {
    return request<{ id: string; code: string }>('/spaces/invites', { spaceId });
  }
  async spaceInvites(spaceId: string) {
    return (await request<{ invites: SpaceInviteInfo[] }>('/spaces/invites/list', { spaceId }))
      .invites;
  }
  revokeSpaceInvite(id: string) {
    return request('/spaces/invites/revoke', { id });
  }
  /** Accepts an invite: the account becomes a member of that very play space, once. */
  async joinSpace(code: string) {
    const { space } = await request<{ space: { id: string; name: string } }>('/spaces/join', {
      code,
    });
    this.revision = null;
    this.emit({ type: 'changed', origin: 'remote' });
    return space;
  }
  async leaveSpace(spaceId: string) {
    await request('/spaces/leave', { spaceId });
    this.emit({ type: 'changed', origin: 'remote' });
  }
  users() {
    return request<{ users: Account[]; invites: Invite[] }>('/admin/users');
  }
  createInvite(playerId: string | null) {
    return request<{ id: string; code: string; expiresAt: string }>('/admin/invites', {
      playerId,
    });
  }
  revokeInvite(id: string) {
    return request('/admin/invites/revoke', { id });
  }
  setRole(userId: string, role: 'admin' | 'player') {
    return request<{ user: Account }>('/admin/users/role', { userId, role });
  }
  linkAccount(userId: string, playerId: string | null) {
    return request<{ user: Account }>('/admin/users/link', { userId, playerId });
  }
  resetCode(userId: string) {
    return request<{ code: string; expiresAt: string }>('/admin/users/reset', { userId });
  }
  setDisabled(userId: string, disabled: boolean) {
    return request<{ user: Account }>('/admin/users/disable', { userId, disabled });
  }

  // The engine surface (EngineApi) beyond the forwarded methods.
  async connect() {
    if (session.get() === undefined) await this.refreshSession();
    return null as never;
  }
  subscribe(listener: (event: EngineEvent) => void) {
    this.listeners.add(listener);
    this.timer ??= setInterval(() => void this.poll(), 5000);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }
  private emit(event: EngineEvent) {
    for (const listener of this.listeners) listener(event);
  }
  /** Another phone changed something: every screen refreshes. */
  private async poll() {
    if (!session.get() || document.visibilityState !== 'visible' || !navigator.onLine) return;
    const { revision } = await request<{ revision: number }>('/revision').catch(() => ({
      revision: this.revision,
    }));
    if (this.revision !== null && revision !== this.revision)
      this.emit({ type: 'changed', origin: 'remote' });
    this.revision = revision;
  }
  async readBackup(text: string) {
    try {
      const backup = await readBackup(text);
      backupTexts.set(backup, text);
      return { backup, summary: summarizeBackup(backup) };
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'BACKUP_INVALID';
      throw new ApiError(code, messages[code] ?? messages.BACKUP_INVALID!);
    }
  }
  private text(backup: BackupFile) {
    return backupTexts.get(backup) ?? JSON.stringify(backup);
  }
  private async send<T>(method: CloudMethod, args: unknown[]): Promise<T> {
    const { result } = await request<{ result: T }>('/rpc', { method, args });
    this.emit({ type: 'changed', origin: 'import' });
    return result;
  }
  importBackup(backup: BackupFile, replaceExisting: boolean): Promise<void> {
    return this.send('importBackup', [this.text(backup), replaceExisting]);
  }
  previewMerge(backup: BackupFile): ReturnType<LocalGameAdapter['previewMerge']> {
    return request<{ result: Awaited<ReturnType<LocalGameAdapter['previewMerge']>> }>('/rpc', {
      method: 'previewMerge',
      args: [this.text(backup)],
    }).then((r) => r.result);
  }
  mergeBackup(backup: BackupFile): ReturnType<LocalGameAdapter['mergeBackup']> {
    return this.send('mergeBackup', [this.text(backup)]);
  }
  getPending() {
    // Commands carry the versions the screen saw: a retry after a lost answer is refused, not
    // applied twice.
    return undefined;
  }
}
function passkeyError(error: unknown): never {
  const name = (error as { name?: string }).name;
  throw new ApiError(
    'PASSKEY_CANCELLED',
    name === 'NotAllowedError' || name === 'AbortError'
      ? messages.PASSKEY_CANCELLED!
      : messages.PASSKEY_UNSUPPORTED!,
  );
}
export type Cloud = CloudAdapter & Remote & GameAdapter & EngineApi;
export const createCloud = () => new CloudAdapter() as Cloud;
