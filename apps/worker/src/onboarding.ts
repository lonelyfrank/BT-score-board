import { DomainError, ensure, linkResolver } from '../../../packages/domain/src/index.js';
import type { LocalGameAdapter } from '../../web/src/services/local.js';
import type { Account, Accounts } from './accounts.js';

/** Players nobody plays as yet: the ones a newcomer may recognise as themselves. */
export async function candidates(adapter: LocalGameAdapter, accounts: Accounts, account: Account) {
  if (account.playerId) return [];
  const resolve = linkResolver(await adapter.links());
  const { items } = await adapter.players('', 0, 'active');
  return items
    .filter((p) => resolve(p.id) === p.id && !accounts.byPlayer(p.id))
    .map((p) => ({ id: p.id, displayName: p.displayName, nickname: p.nickname }));
}

/**
 * First-run wizard: the account creates its own player and, if it recognises itself in records
 * made before (the same person added by an admin or on a phone), merges them into it. Only
 * players without an account can be merged, so nobody takes over someone else's profile.
 */
export async function createOwnPlayer(
  adapter: LocalGameAdapter,
  accounts: Accounts,
  account: Account,
  body: Record<string, unknown>,
) {
  ensure(!account.playerId, 'ALREADY_LINKED', 'This account already has a player', 409);
  const ids = Array.isArray(body.mergeIds) ? [...new Set(body.mergeIds.map(String))] : [];
  ensure(ids.length <= 10, 'TOO_MANY', 'Too many players to merge', 422);
  const allowed = new Set((await candidates(adapter, accounts, account)).map((p) => p.id));
  for (const id of ids)
    if (!allowed.has(id))
      throw new DomainError('PLAYER_TAKEN', 'This player already has an account', 409);
  const player = await adapter.createPlayer(
    String(body.displayName ?? ''),
    typeof body.nickname === 'string' && body.nickname.trim() ? body.nickname.trim() : null,
  );
  accounts.adoptPlayer(account.id, player.id);
  for (const id of ids) {
    const { kept, linked } = await adapter.linkPlayers(player.id, id);
    accounts.movePlayer(linked, kept);
  }
  return accounts.get(account.id)!;
}
