import {
  BT_PLAY_SPACE_ID,
  DomainError,
  ensure,
  linkResolver,
  tournamentPlayerIds,
  type PlaySpace,
} from '../../../packages/domain/src/index.js';
import { readBackup } from '../../../packages/local-store/src/backup.js';
import type { LocalGameAdapter } from '../../web/src/services/local.js';
import type { Match, Tournament } from '../../web/src/services/game.js';
import { isAdmin, type Accounts, type Account } from './accounts.js';
import type { Access } from './access.js';
import { adminReadMethods, backupMethods, readMethods, writeMethods } from './methods.js';

export type { CloudMethod } from './methods.js';

const reads = new Set<string>(readMethods);
const writes = new Set<string>(writeMethods);
const adminReads = new Set<string>(adminReadMethods);
const backups = new Set<string>(backupMethods);
const profileFields = new Set(['displayName', 'nickname', 'avatar']);
/** Commands that change a match: only its scorer, on the session that holds it. */
const scorerWrites = new Set([
  'tournamentCommand',
  'matchCommand',
  'recordResult',
  'submitTurn',
  'undo',
  'correct',
  'moveTournament',
  'transferScorer',
  'takeOverScoring',
]);
/** What any enabled account may do, besides its own profile. */
const accountWrites = new Set(['createTournament', 'createPlayer', 'createPlaySpace']);
const matchCommands = ['matchCommand', 'recordResult', 'submitTurn', 'undo', 'correct'];
const closed = new Set(['completed', 'cancelled']);

const forbidden = () =>
  new DomainError('ADMIN_REQUIRED', 'Only an admin can change this data', 403);
const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** What one account may read, decided from the server's own tables. */
export async function viewer(adapter: LocalGameAdapter, account: Account, access?: Access) {
  const admin = isAdmin(account);
  const spaces = access?.spacesOf(account.id) ?? new Set([BT_PLAY_SPACE_ID]);
  const scored = access?.scoredBy(account.id) ?? new Set<string>();
  const resolve = linkResolver(await adapter.links());
  const me = account.playerId ? resolve(account.playerId) : null;
  const readable = new Set<string>();
  const own = new Set<string>();
  for (const t of await adapter.fullTournaments()) {
    const plays = me !== null && tournamentPlayerIds(t).some((id) => resolve(id) === me);
    if (plays) own.add(t.id);
    if (admin || plays || scored.has(t.id) || spaces.has(t.playSpaceId ?? '')) readable.add(t.id);
  }
  return {
    admin,
    spaces,
    me,
    resolve,
    readable,
    can: (id: string) => readable.has(id),
    /** The spaces a read may cover for an account that is not an admin. */
    filter: spaces as ReadonlySet<string | null>,
  };
}
const notVisible = () =>
  new DomainError('NOT_ALLOWED', 'You do not have access to this match or play space', 403);

/**
 * Runs one adapter method for an account. Tournament and match arguments are replaced by the
 * server's copy: only the id and the versions the client saw are kept, so a command on stale
 * data is still rejected and a client cannot inject scores or turns. Every read is limited to
 * what the account may see; every change of a match requires being its scorer.
 *
 * Without `access` (tests of the engine alone) writes stay admin-only and reads unrestricted by
 * play space, as before play spaces existed.
 */
export async function dispatch(
  adapter: LocalGameAdapter,
  account: Account,
  method: unknown,
  input: unknown,
  accounts?: Accounts,
  access?: Access,
  session = 'local',
): Promise<unknown> {
  if (
    typeof method !== 'string' ||
    !(reads.has(method) || adminReads.has(method) || writes.has(method))
  )
    throw new DomainError('NOT_SUPPORTED', 'Unknown method', 404);
  if (adminReads.has(method) && !isAdmin(account)) throw forbidden();
  const args = Array.isArray(input) ? [...input] : [];
  if (access && !writes.has(method))
    return read(adapter, account, method, args, access, accounts, session);

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
    const member = !!access && (accountWrites.has(method) || scorerWrites.has(method));
    if (!own && !member) throw forbidden();
  }
  if (access && method === 'recoverScorer') {
    if (!isAdmin(account)) throw forbidden();
    const [id, to, reason] = args;
    ensure(!!accounts?.get(String(to)), 'ACCOUNT_NOT_FOUND', 'Account not found', 404);
    ensure(
      !accounts!.get(String(to))!.disabled,
      'ACCOUNT_DISABLED',
      'This account is disabled',
      409,
    );
    await adapter.tournament(String(id));
    access.recover(String(id), account.id, String(to), String(reason ?? 'recovery'));
    return access.access(String(id));
  }
  if (access && scorerWrites.has(method)) {
    const tournamentId = await tournamentOf(adapter, method, args);
    if (method === 'takeOverScoring') {
      access.takeOver(tournamentId, account.id, session);
      return access.access(tournamentId);
    }
    if (method === 'transferScorer') {
      const to = accounts?.get(String(args[1]));
      ensure(!!to && !to.disabled, 'ACCOUNT_NOT_FOUND', 'Choose an enabled account', 404);
      const v = await viewer(adapter, to!, access);
      ensure(v.can(tournamentId), 'NOT_ALLOWED', 'That account cannot see this match', 403);
      access.transfer(tournamentId, account.id, session, to!.id);
      return access.access(tournamentId);
    }
    access.assertScorer(tournamentId, account.id, session);
    // A finished tournament stays as it ended: only admins correct it.
    if (!isAdmin(account) && closed.has((await adapter.tournament(tournamentId)).status))
      throw new DomainError(
        'TOURNAMENT_CLOSED',
        'Only an admin can change a finished tournament',
        403,
      );
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
  if (method === 'tournamentCommand' || method === 'moveTournament') {
    const t = record(args[0]);
    args[0] = { ...(await adapter.tournament(String(t?.id))), version: t?.version } as Tournament;
  }
  if (matchCommands.includes(method)) {
    const m = record(args[0]);
    args[0] = {
      ...(await adapter.match(String(m?.id))),
      version: m?.version,
      tournamentVersion: m?.tournamentVersion,
    } as Match;
  }
  if (method === 'createTournament' && access) {
    const space = String(record(args[0])?.playSpaceId);
    if (!isAdmin(account) && !access.isMember(space, account.id))
      throw new DomainError('FORBIDDEN_SPACE', 'Join this play space to play there', 403);
  }
  if (method === 'moveTournament' && access && !isAdmin(account)) {
    // The match can only go where its scorer may play.
    if (!access.isMember(String(args[1]), account.id))
      throw new DomainError('FORBIDDEN_SPACE', 'Join the destination play space first', 403);
  }
  if (method === 'createPlaySpace') {
    const space = await adapter.createPlaySpace(
      (record(args[0]) ?? {}) as { name: string },
      account.id,
    );
    access?.addMember(space.id, account.id, account.id);
    return space;
  }
  if (backups.has(method)) {
    if (typeof args[0] !== 'string')
      throw new DomainError('BACKUP_INVALID', 'Send the backup file as text', 422);
    const backup = await readBackup(args[0]);
    if (accounts) await checkLinks(adapter, accounts, backup.data.links);
    args[0] = backup;
  }
  const fn = (adapter as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!;
  const result = await fn.apply(adapter, args);
  if (method === 'createTournament' && access)
    access.register((result as Tournament).id, account.id, session);
  if (method === 'linkPlayers' && accounts) {
    const { kept, linked } = result as { kept: string; linked: string };
    accounts.movePlayer(linked, kept);
  }
  if (method === 'mergeBackup' && accounts) {
    // Links that arrived with the backup move the accounts they absorb, never the other way:
    // an account keeps its own history and nobody can take over someone else's.
    const resolve = linkResolver(await adapter.links());
    for (const a of accounts.list())
      if (a.playerId && resolve(a.playerId) !== a.playerId)
        accounts.movePlayer(a.playerId, resolve(a.playerId));
  }
  return result;
}

/** A backup cannot merge two players that both belong to a signed-in account. */
async function checkLinks(
  adapter: LocalGameAdapter,
  accounts: Accounts,
  links: { from: string; to: string }[],
) {
  const resolve = linkResolver([
    ...(await adapter.links()),
    ...links.map((l) => ({ ...l, createdAt: '' })),
  ]);
  const owner = new Map<string, string>();
  for (const a of accounts.list()) {
    if (!a.playerId) continue;
    const root = resolve(a.playerId);
    if (owner.has(root) && owner.get(root) !== a.id)
      throw new DomainError(
        'BOTH_HAVE_ACCOUNT',
        'The backup would merge players that both have an account',
        409,
      );
    owner.set(root, a.id);
  }
}

async function tournamentOf(adapter: LocalGameAdapter, method: string, args: unknown[]) {
  const first = record(args[0]);
  if (matchCommands.includes(method)) return (await adapter.match(String(first?.id))).tournamentId;
  const id = typeof args[0] === 'string' ? args[0] : first?.id;
  ensure(typeof id === 'string', 'BAD_REQUEST', 'Tournament required', 422);
  await adapter.tournament(id as string);
  return id as string;
}

async function read(
  adapter: LocalGameAdapter,
  account: Account,
  method: string,
  args: unknown[],
  access: Access,
  accounts?: Accounts,
  session = 'local',
): Promise<unknown> {
  const v = await viewer(adapter, account, access);
  const call = (name: string, ...a: unknown[]) =>
    (adapter as unknown as Record<string, (...x: unknown[]) => unknown>)[name]!.apply(adapter, a);
  const space = (value: unknown) => {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && !v.admin && !v.spaces.has(value)) throw notVisible();
    return value;
  };
  const items = <T extends { id: string }>(list: T[]) =>
    v.admin ? list : list.filter((t) => v.can(t.id));
  const page = <T extends { id: string }>(p: { items: T[]; total: number }) =>
    v.admin ? p : { ...p, items: items(p.items), total: items(p.items).length };
  switch (method) {
    case 'matchAccess': {
      const id = String(args[0]);
      if (!v.can(id)) throw notVisible();
      const a = access.access(id);
      const holder = a?.scorerId ? accounts?.get(a.scorerId) : undefined;
      const scorer = holder ? { id: holder.id, username: holder.username } : null;
      return {
        ...a,
        scorer,
        mine: a?.scorerId === account.id,
        // Whether this very device holds the match (a second phone of the scorer does not).
        device: a?.scorerId === account.id ? access.holds(id, session) : null,
      };
    }
    case 'scorerCandidates': {
      // Accounts that can see the match and play in it: who the scoring right can pass to.
      const id = String(args[0]);
      if (!v.can(id)) throw notVisible();
      const t = (await call('tournament', id)) as Tournament;
      const resolve = v.resolve;
      const ids = new Set(tournamentPlayerIds(t as never).map((p) => resolve(p)));
      return (accounts?.list() ?? [])
        .filter(
          (a) => !a.disabled && a.id !== account.id && a.playerId && ids.has(resolve(a.playerId)),
        )
        .map((a) => ({ id: a.id, username: a.username, playerId: a.playerId }));
    }
    case 'tournament':
    case 'standings':
      if (!v.can(String(args[0]))) throw notVisible();
      return call(method, ...args);
    case 'match': {
      const m = (await call('match', ...args)) as Match;
      if (!v.can(m.tournamentId)) throw notVisible();
      return m;
    }
    case 'tournaments':
      return page(
        (await call('tournaments', ...args)) as { items: { id: string }[]; total: number },
      );
    case 'allTournaments':
    case 'crewTournaments':
      return items((await call(method, ...args)) as { id: string }[]);
    case 'playSpaces': {
      const all = (await call('playSpaces')) as PlaySpace[];
      return v.admin ? all : all.filter((p) => v.spaces.has(p.id));
    }
    case 'statistics':
    case 'history': {
      const mine = v.me !== null && v.resolve(String(args[0])) === v.me;
      const asked = space(args[1]);
      const filter = asked ?? (v.admin || mine ? undefined : v.filter);
      return call(method, args[0], filter);
    }
    case 'progression': {
      const asked = space(args[0]);
      if (v.admin || asked !== undefined) return call('progression', asked);
      return call('progressionView', (t: { id: string }) => v.can(t.id));
    }
    case 'crewProgression': {
      const asked = space(args[1]);
      if (v.admin || asked !== undefined) return call('crewProgression', args[0], asked);
      return call('crewProgressionView', args[0], (t: { id: string }) => v.can(t.id));
    }
    case 'crews': {
      const crews = (await call('crews')) as {
        playSpaceIds?: string[];
        favoritePlaySpaceId?: string | null;
      }[];
      if (v.admin) return crews;
      return crews.map((c) => ({
        ...c,
        ...(c.playSpaceIds
          ? { playSpaceIds: c.playSpaceIds.filter((id) => v.spaces.has(id)) }
          : {}),
        ...(c.favoritePlaySpaceId && !v.spaces.has(c.favoritePlaySpaceId)
          ? { favoritePlaySpaceId: null }
          : {}),
      }));
    }
    default:
      return call(method, ...args);
  }
}
