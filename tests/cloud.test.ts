import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SqlEngineDatabase, type SqlHost } from '../packages/local-store/src/index.js';
import { LocalGameAdapter } from '../apps/web/src/services/local.js';
import { Accounts, hashPassword, verifyPassword } from '../apps/worker/src/accounts.js';
import { candidates, createOwnPlayer } from '../apps/worker/src/onboarding.js';
import { dispatch } from '../apps/worker/src/rpc.js';

/** The Durable Object storage API over better-sqlite3: statements run when exec is called. */
function sqlHost(): SqlHost {
  const db = new Database(':memory:');
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const statement = db.prepare(query);
        const rows = statement.reader
          ? (statement.all(...bindings) as Record<string, unknown>[])
          : (statement.run(...bindings), []);
        return { toArray: () => rows };
      },
    },
    transactionSync: <T>(work: () => T) => db.transaction(work)(),
  };
}
function server(host = sqlHost()) {
  const db = new SqlEngineDatabase(host);
  const adapter = new LocalGameAdapter({ storage: () => db, channel: null, app: 'test' });
  return { host, db, adapter, accounts: new Accounts(host) };
}
const setup = 'OWNER-SETUP-CODE';
async function owner(accounts: Accounts) {
  return accounts.register({ username: 'Salvo', password: 'password-1', code: setup }, setup, 'ip');
}

describe('engine on Durable Object SQL', () => {
  it('keeps commands durable and moves data through a backup', async () => {
    const a = server();
    const player = await a.adapter.createPlayer('Anna');
    const t = await a.adapter.createTournament({ name: 'Venerdì', mode: 'QUICK_HIGH_SCORE' });
    await a.adapter.tournamentCommand(t, 'players', { playerId: player.id });
    expect(a.db.revision()).toBe(3);
    // A new engine over the same storage (an evicted object woken up) sees everything.
    const reopened = new LocalGameAdapter({ storage: () => new SqlEngineDatabase(a.host) });
    expect((await reopened.tournament(t.id)).entries).toHaveLength(1);
    expect((await reopened.players()).items.map((p) => p.displayName)).toEqual(['Anna']);

    const b = server();
    const text = JSON.stringify(await a.adapter.exportBackup());
    const { backup } = await b.adapter.readBackup(text);
    await b.adapter.importBackup(backup, false);
    expect((await b.adapter.tournament(t.id)).entries[0]!.playerId).toBe(player.id);
    expect((await b.adapter.status()).counts).toEqual((await a.adapter.status()).counts);
  });
});

describe('accounts', () => {
  it('hashes passwords with a salt', async () => {
    const one = await hashPassword('secret-pass');
    expect(one).not.toBe(await hashPassword('secret-pass'));
    expect(await verifyPassword('secret-pass', one)).toBe(true);
    expect(await verifyPassword('wrong-pass', one)).toBe(false);
  });
  it('creates the owner once, then only by invite', async () => {
    const { accounts } = server();
    await expect(
      accounts.register({ username: 'x', password: 'password-1', code: setup }, setup, 'ip'),
    ).rejects.toMatchObject({ code: 'INVALID_USERNAME' });
    const me = await owner(accounts);
    expect(me).toMatchObject({ username: 'salvo', role: 'owner', playerId: null });
    await expect(
      accounts.register({ username: 'other', password: 'password-1', code: setup }, setup, 'ip'),
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });
  });
  it('links an invited account to its player and signs in', async () => {
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    const anna = await adapter.createPlayer('Anna');
    const invite = await accounts.createInvite(me, anna.id);
    await expect(accounts.createInvite(me, null)).resolves.toBeTruthy();
    const account = await accounts.register(
      { username: 'anna', password: 'password-2', code: invite.code.toLowerCase() },
      setup,
      'ip',
    );
    expect(account).toMatchObject({ role: 'player', playerId: anna.id });
    // Single use, and the player cannot be given to a second account.
    await expect(
      accounts.register(
        { username: 'anna2', password: 'password-2', code: invite.code },
        setup,
        'ip',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });
    await expect(accounts.createInvite(me, anna.id)).rejects.toMatchObject({
      code: 'PLAYER_TAKEN',
    });

    const login = await accounts.login({ username: 'ANNA', password: 'password-2' }, 'ip');
    const session = await accounts.createSession(login.id);
    expect((await accounts.session(session.token))?.id).toBe(account.id);
    await accounts.logout(session.token);
    expect(await accounts.session(session.token)).toBeNull();
  });
  it('throttles repeated wrong passwords', async () => {
    const { accounts } = server();
    await owner(accounts);
    for (let i = 0; i < 10; i++)
      await expect(
        accounts.login({ username: 'salvo', password: 'nope-nope' }, `ip${i}`),
      ).rejects.toMatchObject({ code: 'INVALID_LOGIN' });
    await expect(
      accounts.login({ username: 'salvo', password: 'password-1' }, 'fresh'),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });
  it('lets only the owner appoint admins; admins link players and reset passwords', async () => {
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    const join = async (username: string) =>
      accounts.register(
        { username, password: 'password-3', code: (await accounts.createInvite(me, null)).code },
        setup,
        'ip',
      );
    const luca = await join('luca');
    const marco = await join('marco');
    const admin = accounts.setRole(me, luca.id, 'admin');
    expect(() => accounts.setRole(admin, marco.id, 'admin')).toThrow(/owner/);
    expect(() => accounts.setRole(me, me.id, 'player')).toThrow();

    const old = await adapter.createPlayer('Marco (vecchio profilo)');
    expect(accounts.linkPlayer(admin, marco.id, old.id).playerId).toBe(old.id);
    expect(() => accounts.linkPlayer(admin, luca.id, old.id)).toThrow(/marco/);
    expect(() => accounts.linkPlayer(marco, marco.id, null)).toThrow();

    const reset = await accounts.resetCode(admin, marco.id);
    await accounts.resetPassword(
      { username: 'marco', code: reset.code, password: 'new-pass-4' },
      'ip',
    );
    await expect(
      accounts.login({ username: 'marco', password: 'new-pass-4' }, 'ip'),
    ).resolves.toMatchObject({ id: marco.id });
    await expect(
      accounts.resetPassword({ username: 'marco', code: reset.code, password: 'again-pass' }, 'ip'),
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });

    accounts.setDisabled(admin, marco.id, true);
    await expect(
      accounts.login({ username: 'marco', password: 'new-pass-4' }, 'ip'),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });
});

describe('permissions on the engine', () => {
  it('lets players read and edit only their own profile', async () => {
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    const anna = (await dispatch(adapter, me, 'createPlayer', ['Anna'])) as { id: string };
    const bruno = await adapter.createPlayer('Bruno');
    const invite = await accounts.createInvite(me, anna.id);
    const player = await accounts.register(
      { username: 'anna', password: 'password-2', code: invite.code },
      setup,
      'ip',
    );
    await expect(dispatch(adapter, player, 'players', [])).resolves.toMatchObject({ total: 2 });
    await expect(
      dispatch(adapter, player, 'updatePlayer', [anna.id, { nickname: 'Freccia' }]),
    ).resolves.toMatchObject({ nickname: 'Freccia' });
    for (const [method, args] of [
      ['updatePlayer', [anna.id, { status: 'inactive' }]],
      ['updatePlayer', [bruno.id, { nickname: 'x' }]],
      ['createPlayer', ['Carla']],
      ['createTournament', [{ name: 'T', mode: 'QUICK_HIGH_SCORE' }]],
      ['importBackup', ['{}', true]],
    ] as const)
      await expect(dispatch(adapter, player, method, [...args])).rejects.toMatchObject({
        code: 'ADMIN_REQUIRED',
      });
    for (const method of ['constructor', 'connect', 'write', 'readBackup', '__proto__'])
      await expect(dispatch(adapter, me, method, [])).rejects.toMatchObject({
        code: 'NOT_SUPPORTED',
      });
  });
  it('lets only admins cancel, remove and see removed tournaments, and restores them', async () => {
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    const anna = await adapter.createPlayer('Anna');
    const invite = await accounts.createInvite(me, anna.id);
    const player = await accounts.register(
      { username: 'anna', password: 'password-2', code: invite.code },
      setup,
      'ip',
    );
    const t = await adapter.createTournament({ name: 'Prova', mode: 'QUICK_HIGH_SCORE' });
    const run = (who: typeof me, method: string, ...args: unknown[]) =>
      dispatch(adapter, who, method, args, accounts);
    await expect(run(player, 'removeTournament', t.id, true)).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });
    await expect(run(player, 'removedTournaments')).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });

    // In progress: cancel first, then remove.
    const bruno = await adapter.createPlayer('Bruno');
    await adapter.tournamentCommand(t, 'players', { playerId: anna.id });
    await adapter.tournamentCommand(await adapter.tournament(t.id), 'players', {
      playerId: bruno.id,
    });
    let live = await adapter.tournament(t.id);
    live = await adapter.tournamentCommand(live, 'start');
    await expect(run(me, 'removeTournament', t.id, true)).rejects.toMatchObject({
      code: 'TOURNAMENT_OPEN',
    });
    await run(me, 'tournamentCommand', live, 'cancel');
    await run(me, 'removeTournament', t.id, true);

    expect((await adapter.tournaments()).items).toHaveLength(0);
    expect((await adapter.allTournaments()).length).toBe(0);
    expect((await adapter.history(anna.id)).items).toHaveLength(0);
    await expect(run(me, 'removedTournaments')).resolves.toMatchObject([{ id: t.id }]);
    await run(me, 'removeTournament', t.id, false);
    expect((await adapter.tournaments()).items).toHaveLength(1);
    await expect(run(me, 'removedTournaments')).resolves.toHaveLength(0);
  });
  it('moves the account of a merged player to the survivor and refuses two accounts', async () => {
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    const old = await adapter.createPlayer('Anna');
    const dup = await adapter.createPlayer('Anna B');
    const invite = await accounts.createInvite(me, dup.id);
    const anna = await accounts.register(
      { username: 'anna', password: 'password-2', code: invite.code },
      setup,
      'ip',
    );
    const merged = (await dispatch(adapter, me, 'linkPlayers', [dup.id, old.id], accounts)) as {
      kept: string;
      linked: string;
    };
    expect(accounts.get(anna.id)!.playerId).toBe(merged.kept);

    const other = await adapter.createPlayer('Bruno');
    const second = await accounts.createInvite(me, other.id);
    await accounts.register(
      { username: 'bruno', password: 'password-3', code: second.code },
      setup,
      'ip',
    );
    await expect(
      dispatch(adapter, me, 'linkPlayers', [other.id, merged.kept], accounts),
    ).rejects.toMatchObject({ code: 'BOTH_HAVE_ACCOUNT' });
  });
  it('lets a newcomer create their player, merging the records they recognise', async () => {
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    const old = await adapter.createPlayer('Giulia');
    const taken = await adapter.createPlayer('Marco');
    const marco = await accounts.createInvite(me, taken.id);
    await accounts.register(
      { username: 'marco', password: 'password-2', code: marco.code },
      setup,
      'ip',
    );
    const invite = await accounts.createInvite(me, null);
    const newcomer = await accounts.register(
      { username: 'giulia', password: 'password-3', code: invite.code },
      setup,
      'ip',
    );
    expect(newcomer.playerId).toBeNull();
    // Only players nobody plays as are offered, and nobody else's profile can be taken.
    expect((await candidates(adapter, accounts, newcomer)).map((p) => p.id)).toEqual([old.id]);
    await expect(
      createOwnPlayer(adapter, accounts, newcomer, { displayName: 'Giulia', mergeIds: [taken.id] }),
    ).rejects.toMatchObject({ code: 'PLAYER_TAKEN' });

    const done = await createOwnPlayer(adapter, accounts, newcomer, {
      displayName: 'Giulia B',
      nickname: 'Gigi',
      mergeIds: [old.id],
    });
    expect(done.playerId).not.toBeNull();
    // One active record is left, and the account plays as it.
    const active = (await adapter.players('', 0, 'active')).items.map((p) => p.id);
    expect(active).toContain(done.playerId);
    expect(active.filter((id) => id === old.id || id === done.playerId)).toHaveLength(1);
    expect(await candidates(adapter, accounts, done)).toEqual([]);
    await expect(
      createOwnPlayer(adapter, accounts, done, { displayName: 'Altra' }),
    ).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
  });
  it('uses the server copy of a tournament and keeps the client version check', async () => {
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    const p = await adapter.createPlayer('Anna');
    const t = await adapter.createTournament({ name: 'T', mode: 'QUICK_HIGH_SCORE' });
    const forged = { ...t, name: 'Falso', entries: [] };
    const after = (await dispatch(adapter, me, 'tournamentCommand', [
      forged,
      'players',
      { playerId: p.id },
    ])) as { name: string; version: number };
    expect(after.name).toBe('T');
    await expect(
      dispatch(adapter, me, 'tournamentCommand', [t, 'registration/open', {}]),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('RPC encoding', () => {
  it('keeps the Maps of a progression', async () => {
    const { decode, encode } = await import('../apps/worker/src/codec.js');
    const { accounts, adapter } = server();
    const me = await owner(accounts);
    await adapter.createPlayer('Anna');
    const progression = decode(encode(await dispatch(adapter, me, 'progression', []))) as {
      players: Map<string, unknown>;
    };
    expect(progression.players).toBeInstanceOf(Map);
    const nested = { a: new Map([['x', { b: new Set([1, 2]) }]]) };
    expect(decode(encode(nested))).toEqual(nested);
  });
});
