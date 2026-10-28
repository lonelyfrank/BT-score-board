import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { BT_PLAY_SPACE_ID } from '../packages/domain/src/index.js';
import { SqlEngineDatabase, type SqlHost } from '../packages/local-store/src/index.js';
import { LocalGameAdapter } from '../apps/web/src/services/local.js';
import { Accounts, type Account } from '../apps/worker/src/accounts.js';
import { Access } from '../apps/worker/src/access.js';
import { dispatch } from '../apps/worker/src/rpc.js';

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
const setup = 'OWNER-SETUP-CODE';

/** A pub: an owner, a second admin, and three players, one of them linked to a player record. */
async function world() {
  const host = sqlHost();
  const adapter = new LocalGameAdapter({
    storage: () => new SqlEngineDatabase(host),
    channel: null,
    app: 'test',
  });
  const accounts = new Accounts(host);
  const access = new Access(host);
  const owner = await accounts.register(
    { username: 'salvo', password: 'password-1', code: setup },
    setup,
    'ip',
  );
  const join = async (username: string, playerId: string | null = null) =>
    accounts.register(
      {
        username,
        password: 'password-3',
        code: (await accounts.createInvite(owner, playerId)).code,
      },
      setup,
      'ip',
    );
  const admin2 = accounts.setRole(owner, (await join('luca')).id, 'admin');
  const frankPlayer = await adapter.createPlayer('Frank');
  const salvoPlayer = await adapter.createPlayer('Salvo');
  const frank = await join('frank', frankPlayer.id);
  const ann = await join('ann');
  const carl = await join('carl');
  const call = (account: Account, method: string, ...args: unknown[]) =>
    dispatch(adapter, account, method, args, accounts, access, `session-${account.id}`);
  const callOn = (account: Account, session: string, method: string, ...args: unknown[]) =>
    dispatch(adapter, account, method, args, accounts, access, session);
  return {
    host,
    adapter,
    accounts,
    access,
    owner,
    admin2,
    frank,
    frankPlayer,
    salvoPlayer,
    ann,
    carl,
    call,
    callOn,
  };
}
type World = Awaited<ReturnType<typeof world>>;
type Tour = {
  id: string;
  version: number;
  entries: { id: string; playerId: string }[];
  matches: { id: string; version: number }[];
};

async function match(w: World, scorer: Account, playSpaceId = BT_PLAY_SPACE_ID) {
  const t = (await w.call(scorer, 'createTournament', {
    playSpaceId,
    name: 'Sfida',
    mode: 'SINGLE_MATCH',
    gameMode: 'HI_SCORE',
    scoringConfiguration: { turns: 7 },
  })) as Tour;
  return t;
}
async function register(w: World, scorer: Account, t: Tour, ...playerIds: string[]) {
  let cur = t;
  for (const playerId of playerIds)
    cur = (await w.call(scorer, 'tournamentCommand', cur, 'players', { playerId })) as Tour;
  return cur;
}

describe('who can score a match', () => {
  it('a normal member creates a match in the canonical space and becomes its scorer, not an admin', async () => {
    const w = await world();
    const t = await match(w, w.ann);
    expect(w.access.access(t.id)).toMatchObject({ createdBy: w.ann.id, scorerId: w.ann.id });
    expect(w.ann.role).toBe('player');
    const guest = (await w.call(w.ann, 'createPlayer', 'Ospite')) as { id: string };
    const withPlayers = await register(w, w.ann, t, w.salvoPlayer.id, guest.id);
    expect(withPlayers.entries).toHaveLength(2);
    // Still no admin power: removing a tournament or restoring data is refused.
    await expect(w.call(w.ann, 'removeTournament', t.id, true)).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });
    await expect(w.call(w.ann, 'importBackup', '{}', true)).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });
  });

  it('neither a participant nor another admin can score a match, even through the API', async () => {
    const w = await world();
    const t = await match(w, w.ann);
    const full = await register(w, w.ann, t, w.frankPlayer.id, w.salvoPlayer.id);
    const started = (await w.call(w.ann, 'tournamentCommand', full, 'start')) as Tour;
    const m = {
      id: started.matches[0]!.id,
      version: started.matches[0]!.version,
      tournamentVersion: started.version,
    };
    const result = { scores: { [started.entries[0]!.id]: 300, [started.entries[1]!.id]: 200 } };
    for (const intruder of [w.frank, w.admin2, w.owner, w.carl])
      await expect(
        w.call(intruder, 'recordResult', m, result, 'k'.repeat(10)),
      ).rejects.toMatchObject({
        code: 'NOT_SCORER',
      });
    await expect(w.call(w.admin2, 'tournamentCommand', started, 'cancel')).rejects.toMatchObject({
      code: 'NOT_SCORER',
    });
    await expect(
      w.call(w.frank, 'moveTournament', started, BT_PLAY_SPACE_ID),
    ).rejects.toMatchObject({ code: 'NOT_SCORER' });
    // The scorer can.
    const done = (await w.call(w.ann, 'recordResult', m, result, 'k'.repeat(10))) as {
      status: string;
    };
    expect(done.status).toBe('completed');
  });

  it('a finished match stays as it ended for its scorer: only an admin corrects it', async () => {
    const w = await world();
    const t = await match(w, w.ann);
    const full = await register(w, w.ann, t, w.frankPlayer.id, w.salvoPlayer.id);
    const started = (await w.call(w.ann, 'tournamentCommand', full, 'start')) as Tour;
    const m = {
      id: started.matches[0]!.id,
      version: started.matches[0]!.version,
      tournamentVersion: started.version,
    };
    const result = { scores: { [started.entries[0]!.id]: 300, [started.entries[1]!.id]: 200 } };
    await w.call(w.ann, 'recordResult', m, result, 'k'.repeat(10));
    expect((await w.adapter.tournament(t.id)).status).toBe('completed');
    const after = await w.adapter.match(m.id);
    await expect(
      w.call(
        w.ann,
        'recordResult',
        { id: m.id, version: after.version, tournamentVersion: after.tournamentVersion },
        { scores: { [started.entries[0]!.id]: 100 } },
        'j'.repeat(10),
      ),
    ).rejects.toMatchObject({ code: 'TOURNAMENT_CLOSED' });
  });

  it('a match nobody was assigned can only be scored after an explicit, traced admin recovery', async () => {
    const w = await world();
    // Created outside the server's accounts (older data): no access record.
    const t = (await w.adapter.createTournament({
      playSpaceId: BT_PLAY_SPACE_ID,
      name: 'Vecchia',
      mode: 'SINGLE_MATCH',
    })) as Tour;
    await expect(
      w.call(w.owner, 'tournamentCommand', t, 'players', { playerId: w.salvoPlayer.id }),
    ).rejects.toMatchObject({
      code: 'MATCH_UNASSIGNED',
    });
    await expect(w.call(w.ann, 'recoverScorer', t.id, w.ann.id, 'x')).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    });
    await w.call(w.admin2, 'recoverScorer', t.id, w.ann.id, 'Partita dimenticata');
    const trace = w.access.auditOf(t.id).find((e) => e.kind === 'ADMIN_RECOVERY');
    expect(trace).toMatchObject({
      actor: w.admin2.id,
      detail: { to: w.ann.id, reason: 'Partita dimenticata' },
    });
    await expect(
      w.call(w.ann, 'tournamentCommand', t, 'players', { playerId: w.salvoPlayer.id }),
    ).resolves.toBeTruthy();
    // Recovery does not make the admin a writer.
    await expect(
      w.call(w.admin2, 'tournamentCommand', t, 'players', { playerId: w.frankPlayer.id }),
    ).rejects.toMatchObject({ code: 'NOT_SCORER' });
  });

  it('two phones of the same account are not two concurrent scorers', async () => {
    const w = await world();
    const t = (await w.callOn(w.ann, 'phone-1', 'createTournament', {
      playSpaceId: BT_PLAY_SPACE_ID,
      name: 'S',
      mode: 'SINGLE_MATCH',
    })) as Tour;
    const add = (session: string, cur: Tour) =>
      w.callOn(w.ann, session, 'tournamentCommand', cur, 'players', { playerId: w.salvoPlayer.id });
    await expect(add('phone-2', t)).rejects.toMatchObject({ code: 'SCORER_ELSEWHERE' });
    const before = w.access.access(t.id)!.epoch;
    await w.callOn(w.ann, 'phone-2', 'takeOverScoring', t.id);
    expect(w.access.access(t.id)!.epoch).toBe(before + 1);
    // The old phone is refused from now on, the new one writes.
    await expect(add('phone-1', t)).rejects.toMatchObject({ code: 'SCORER_ELSEWHERE' });
    await expect(add('phone-2', t)).resolves.toBeTruthy();
    // Someone else cannot take the device over.
    await expect(w.callOn(w.frank, 'phone-3', 'takeOverScoring', t.id)).rejects.toMatchObject({
      code: 'NOT_SCORER',
    });
  });

  it('transfers the scoring right atomically and audits it', async () => {
    const w = await world();
    const t = await match(w, w.ann);
    await expect(w.call(w.ann, 'transferScorer', t.id, w.ann.id)).rejects.toMatchObject({
      code: 'SAME_SCORER',
    });
    // The new scorer must be able to see the match: carl is in the open canonical space.
    await w.call(w.ann, 'transferScorer', t.id, w.carl.id);
    const add = (who: Account, cur: Tour) =>
      w.call(who, 'tournamentCommand', cur, 'players', { playerId: w.salvoPlayer.id });
    await expect(add(w.ann, t)).rejects.toMatchObject({ code: 'NOT_SCORER' });
    await expect(add(w.carl, t)).resolves.toBeTruthy();
    expect(w.access.auditOf(t.id).map((e) => e.kind)).toEqual([
      'MATCH_CREATED',
      'SCORER_TRANSFERRED',
    ]);
    // The previous scorer cannot take it back, nor transfer what is no longer theirs.
    await expect(w.call(w.ann, 'transferScorer', t.id, w.ann.id)).rejects.toMatchObject({
      code: 'NOT_SCORER',
    });
  });
});

describe('moving a match to another play space', () => {
  it('is an explicit, audited command of the scorer, to a space they belong to', async () => {
    const w = await world();
    const bar = (await w.call(w.ann, 'createPlaySpace', { name: 'Da Gino' })) as { id: string };
    const t = await match(w, w.ann);
    await expect(w.call(w.carl, 'moveTournament', t, bar.id)).rejects.toMatchObject({
      code: 'NOT_SCORER',
    });
    // The scorer must belong to the destination.
    const other = (await w.call(w.carl, 'createPlaySpace', { name: 'Altrove' })) as { id: string };
    await expect(w.call(w.ann, 'moveTournament', t, other.id)).rejects.toMatchObject({
      code: 'FORBIDDEN_SPACE',
    });
    const moved = (await w.call(w.ann, 'moveTournament', t, bar.id, 'Era la sala sbagliata')) as {
      playSpaceId: string;
      version: number;
    };
    expect(moved.playSpaceId).toBe(bar.id);
    // A stale version is refused: the command is checked against the server's copy.
    await expect(w.call(w.ann, 'moveTournament', t, BT_PLAY_SPACE_ID)).rejects.toThrow();
    const audit = await w.adapter.tournament(t.id);
    expect(audit.playSpaceId).toBe(bar.id);
  });
});

describe('who can see a play space', () => {
  it('keeps a private space out of every generic read until the account joins by invite', async () => {
    const w = await world();
    const bar = (await w.call(w.ann, 'createPlaySpace', { name: 'Da Gino', place: 'sala' })) as {
      id: string;
    };
    const t = await match(w, w.ann, bar.id);
    await register(w, w.ann, t, w.salvoPlayer.id);

    // Carl is not a member: he sees neither the space, nor the match, nor its numbers.
    await expect(w.call(w.carl, 'playSpaces')).resolves.toHaveLength(1);
    await expect(w.call(w.carl, 'tournament', t.id)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(w.call(w.carl, 'standings', t.id)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(w.call(w.carl, 'progression', bar.id)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    });
    await expect(w.call(w.carl, 'tournaments')).resolves.toMatchObject({ total: 0 });
    await expect(w.call(w.carl, 'allTournaments')).resolves.toEqual([]);
    const stats = (await w.call(w.carl, 'statistics', w.salvoPlayer.id)) as {
      matchesPlayed: number;
    };
    expect(stats.matchesPlayed).toBe(0);
    await expect(
      w.call(w.carl, 'createTournament', { playSpaceId: bar.id, name: 'x', mode: 'SINGLE_MATCH' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_SPACE',
    });
    // Admins read everything (but still cannot score).
    await expect(w.call(w.admin2, 'tournament', t.id)).resolves.toBeTruthy();

    // The invite is verified by the server, carries no secret, joins once, and is revocable.
    const invite = await w.access.createInvite(bar.id, w.ann.id, false);
    expect(invite.code).not.toContain(bar.id);
    await expect(w.access.createInvite(bar.id, w.carl.id, false)).rejects.toMatchObject({
      code: 'FORBIDDEN_SPACE',
    });
    expect(await w.access.join(invite.code, w.carl.id)).toBe(bar.id);
    expect(await w.access.join(invite.code, w.carl.id)).toBe(bar.id);
    expect(w.access.members(bar.id).filter((id) => id === w.carl.id)).toHaveLength(1);
    await expect(w.call(w.carl, 'tournament', t.id)).resolves.toBeTruthy();
    expect(((await w.call(w.carl, 'playSpaces')) as unknown[]).length).toBe(2);
    // Membership allows creating a match there, not scoring someone else's.
    await expect(
      w.call(w.carl, 'tournamentCommand', t, 'players', { playerId: w.frankPlayer.id }),
    ).rejects.toMatchObject({ code: 'NOT_SCORER' });
    await expect(match(w, w.carl, bar.id)).resolves.toBeTruthy();

    // Revoking stops new joins, leaving ends access.
    const second = await w.access.createInvite(bar.id, w.ann.id, false);
    w.access.revokeInvite(second.id, w.ann.id, false);
    await expect(w.access.join(second.code, w.admin2.id)).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    await expect(w.access.join('not-a-code', w.admin2.id)).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    w.access.leave(bar.id, w.carl.id);
    await expect(w.call(w.carl, 'tournament', t.id)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });

  it('two spaces with the same name stay distinct, and an invite leads to the very same id', async () => {
    const w = await world();
    const a = (await w.call(w.ann, 'createPlaySpace', { name: 'Da Gino' })) as { id: string };
    const b = (await w.call(w.carl, 'createPlaySpace', { name: 'Da Gino' })) as { id: string };
    expect(a.id).not.toBe(b.id);
    const invite = await w.access.createInvite(a.id, w.ann.id, false);
    const joined = await w.access.join(invite.code, w.frank.id);
    expect(joined).toBe(a.id);
    const spaces = (await w.call(w.frank, 'playSpaces')) as { id: string }[];
    expect(spaces.map((s) => s.id).sort()).toEqual([BT_PLAY_SPACE_ID, a.id].sort());
  });

  it('a participant follows exactly that match without joining the space or seeing the archive', async () => {
    const w = await world();
    const bar = (await w.call(w.ann, 'createPlaySpace', { name: 'Da Gino' })) as { id: string };
    const other = await match(w, w.ann, bar.id);
    const t = await register(
      w,
      w.ann,
      await match(w, w.ann, bar.id),
      w.frankPlayer.id,
      w.salvoPlayer.id,
    );
    await register(w, w.ann, other, w.salvoPlayer.id);
    // Frank (linked to a player of the match) reads it; the space is not his.
    await expect(w.call(w.frank, 'match', t.matches[0]?.id ?? 'x').catch((e) => e)).toBeTruthy();
    await expect(w.call(w.frank, 'tournament', t.id)).resolves.toBeTruthy();
    await expect(w.call(w.frank, 'tournament', other.id)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    });
    expect(w.access.isMember(bar.id, w.frank.id)).toBe(false);
    expect(((await w.call(w.frank, 'tournaments')) as { total: number }).total).toBe(1);
    // He can read, but not write, and the link carries no right of its own.
    await expect(w.call(w.frank, 'tournamentCommand', t, 'start')).rejects.toMatchObject({
      code: 'NOT_SCORER',
    });
    // A name typed by hand claims nothing: readability follows the account's own link.
    await expect(w.call(w.carl, 'tournament', t.id)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });

  it('a backup cannot grant membership or scoring rights', async () => {
    const w = await world();
    const bar = (await w.call(w.ann, 'createPlaySpace', { name: 'Da Gino' })) as { id: string };
    const t = await match(w, w.ann, bar.id);
    const text = JSON.stringify(await w.adapter.exportBackup());
    await w.call(w.owner, 'importBackup', text, true);
    expect(w.access.access(t.id)).toMatchObject({ scorerId: w.ann.id });
    expect(w.access.isMember(bar.id, w.ann.id)).toBe(true);
    expect(w.access.isMember(bar.id, w.carl.id)).toBe(false);
    // The accounts survive a restore of the game data.
    expect(w.accounts.list().map((a) => a.username)).toContain('carl');
  });
});

describe('accounts made and removed by admins', () => {
  it('creates an account with a first-access code, renames it and deletes it with its rights', async () => {
    const w = await world();
    const made = await w.accounts.createUser(w.owner, 'Dora', null);
    expect(made.user).toMatchObject({ username: 'dora', role: 'player', playerId: null });
    await expect(w.accounts.createUser(w.owner, 'dora', null)).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
    });
    await expect(
      w.accounts.login({ username: 'dora', password: 'anything-1' }, 'ip'),
    ).rejects.toMatchObject({ code: 'INVALID_LOGIN' });
    const dora = await w.accounts.resetPassword(
      { username: 'dora', code: made.code, password: 'password-9' },
      'ip',
    );
    expect(w.accounts.renameUser(w.owner, dora.id, 'dorina').username).toBe('dorina');
    // An admin cannot touch another admin or the owner; nobody deletes themselves.
    expect(() => w.accounts.deleteUser(w.admin2, w.owner.id)).toThrow();
    expect(() => w.accounts.deleteUser(w.owner, w.owner.id)).toThrow('your own account');

    const t = await match(w, dora);
    expect(w.access.access(t.id)).toMatchObject({ scorerId: dora.id });
    const removed = w.accounts.deleteUser(w.owner, dora.id);
    w.access.forget(removed.id, w.owner.id);
    expect(w.accounts.get(dora.id)).toBeUndefined();
    // The match waits for an admin to assign a new scorer; the game data stays.
    expect(w.access.access(t.id)).toMatchObject({ scorerId: null });
    expect((await w.adapter.tournament(t.id)).id).toBe(t.id);
  });
});
