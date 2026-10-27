import { DomainError } from '../../../packages/domain/src/index.js';
import type { Match, Tournament } from '../../web/src/services/game.js';
import type { LocalGameAdapter } from '../../web/src/services/local.js';
import { isAdmin, type Account, type Accounts } from './accounts.js';

/**
 * The live channel of a match. A socket belongs to one tournament, one account and one session,
 * all recorded in the socket's attachment so that they survive the object's hibernation.
 * Every update is the complete state after a commit (never a delta), tagged with the version of
 * the tournament: a client applies it only when newer, so duplicates and out-of-order messages
 * are harmless and a missed message is repaired by the next one or by `resync`.
 */
export interface LiveSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
export interface Attachment {
  tournamentId: string;
  accountId: string;
  /** Hash of the session token: the socket ends when that session does. */
  session: string;
  /** Last tournament version sent, to skip sockets already up to date. */
  version: number;
}
export interface LiveState {
  type: 'state';
  /** Tournament version: the ordering of updates. */
  version: number;
  /** Engine revision at the time, for diagnostics. */
  revision: number;
  /** Server time the state was produced at, to measure latency in tests. */
  sentAt: number;
  tournament: Tournament;
  /** The match being played (or next in line) with its turn state; null when there is none. */
  match: Match | null;
}
export const closeCodes = { unauthenticated: 4401, forbidden: 4403, badRequest: 4400 } as const;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = (value: unknown): value is string =>
  typeof value === 'string' && idPattern.test(value);

/** The state a participant sees: the tournament and its current match, as the engine has it. */
export async function liveState(
  adapter: LocalGameAdapter,
  tournamentId: string,
  revision: number,
  now = Date.now(),
): Promise<LiveState> {
  const tournament = await adapter.tournament(tournamentId);
  const current =
    tournament.matches.find((m) => m.status === 'active' || m.status === 'paused') ??
    tournament.matches.find((m) => m.status === 'ready');
  return {
    type: 'state',
    version: tournament.version,
    revision,
    sentAt: now,
    tournament,
    match: current ? await adapter.match(current.id) : null,
  };
}

/** Whether a session may still follow a tournament: valid session, enabled account, access. */
export async function mayFollow(
  accounts: Accounts,
  attachment: Attachment,
  readable: (account: Account) => Promise<boolean>,
): Promise<'ok' | 'unauthenticated' | 'forbidden'> {
  const account = accounts.bySessionKey(attachment.session);
  if (!account || account.id !== attachment.accountId) return 'unauthenticated';
  if (isAdmin(account) || (await readable(account))) return 'ok';
  return 'forbidden';
}

export function parseClientMessage(message: string | ArrayBuffer): { type: string } {
  if (typeof message !== 'string' || message.length > 256)
    throw new DomainError('BAD_REQUEST', 'Invalid message', 400);
  const value: unknown = JSON.parse(message);
  const type = (value as { type?: unknown } | null)?.type;
  if (type !== 'resync' && type !== 'ping')
    throw new DomainError('BAD_REQUEST', 'Unknown message', 400);
  return { type };
}
