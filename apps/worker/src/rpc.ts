import { DomainError, ensure, linkResolver } from '../../../packages/domain/src/index.js';
import { readBackup } from '../../../packages/local-store/src/backup.js';
import type { LocalGameAdapter } from '../../web/src/services/local.js';
import type { Match, Tournament } from '../../web/src/services/game.js';
import { isAdmin, type Accounts, type Account } from './accounts.js';
import { adminReadMethods, backupMethods, readMethods, writeMethods } from './methods.js';

export type { CloudMethod } from './methods.js';

const reads = new Set<string>(readMethods);
const writes = new Set<string>(writeMethods);
const adminReads = new Set<string>(adminReadMethods);
const backups = new Set<string>(backupMethods);
const profileFields = new Set(['displayName', 'nickname', 'avatar']);

const forbidden = () =>
  new DomainError('ADMIN_REQUIRED', 'Only an admin can change this data', 403);
const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Runs one adapter method for an account. Tournament and match arguments are replaced by the
 * server's copy: only the id and the versions the client saw are kept, so a command on stale
 * data is still rejected and a client cannot inject scores or turns.
 */
export async function dispatch(
  adapter: LocalGameAdapter,
  account: Account,
  method: unknown,
  input: unknown,
  accounts?: Accounts,
): Promise<unknown> {
  if (
    typeof method !== 'string' ||
    !(reads.has(method) || adminReads.has(method) || writes.has(method))
  )
    throw new DomainError('NOT_SUPPORTED', 'Unknown method', 404);
  if (adminReads.has(method) && !isAdmin(account)) throw forbidden();
  const args = Array.isArray(input) ? [...input] : [];
  if (writes.has(method) && !isAdmin(account)) {
    // A player edits the name, nickname and avatar of their own record, nothing else.
    const patch = record(args[1]);
    const resolve = linkResolver(await adapter.links());
    const own =
      method === 'updatePlayer' &&
      account.playerId !== null &&
      patch !== null &&
      Object.keys(patch).every((key) => profileFields.has(key)) &&
      resolve(String(args[0])) === resolve(account.playerId);
    if (!own) throw forbidden();
  }
  if (method === 'linkPlayers' && accounts) {
    // Two people with an account cannot become one player: an admin sorts that out first.
    const resolve = linkResolver(await adapter.links());
    const [a, b] = args.map((id) => accounts.byPlayer(resolve(String(id))));
    ensure(
      !(a && b),
      'BOTH_HAVE_ACCOUNT',
      'Both players have an account: unlink one before merging them',
      409,
    );
  }
  if (method === 'tournamentCommand') {
    const t = record(args[0]);
    args[0] = { ...(await adapter.tournament(String(t?.id))), version: t?.version } as Tournament;
  }
  if (['matchCommand', 'recordResult', 'submitTurn', 'undo', 'correct'].includes(method)) {
    const m = record(args[0]);
    args[0] = {
      ...(await adapter.match(String(m?.id))),
      version: m?.version,
      tournamentVersion: m?.tournamentVersion,
    } as Match;
  }
  if (backups.has(method)) {
    if (typeof args[0] !== 'string')
      throw new DomainError('BACKUP_INVALID', 'Send the backup file as text', 422);
    args[0] = await readBackup(args[0]);
  }
  const fn = (adapter as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!;
  const result = await fn.apply(adapter, args);
  if (method === 'linkPlayers' && accounts) {
    const { kept, linked } = result as { kept: string; linked: string };
    accounts.movePlayer(linked, kept);
  }
  return result;
}
