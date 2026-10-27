import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The real Workers runtime (workerd through `wrangler dev`): the Durable Object, its SQLite
 * storage and the WebSocket Hibernation API, driven over HTTP and WebSocket like a browser.
 * Run with `npm run test:workers`.
 */
const port = 8790 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${port}`;
const setupCode = 'WORKERS-SETUP-CODE';
const BT = '00000000-0000-4000-8000-00000000b7d1';
let child: ChildProcess;
let persist: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  persist = mkdtempSync(join(tmpdir(), 'bt-workers-'));
  child = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '-c',
      'wrangler.test.jsonc',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      persist,
      '--var',
      `OWNER_SETUP_CODE:${setupCode}`,
      '--log-level',
      'warn',
    ],
    { cwd: join(process.cwd(), 'apps/worker'), stdio: 'pipe', env: { ...process.env, CI: '1' } },
  );
  let output = '';
  child.stdout?.on('data', (d) => (output += d));
  child.stderr?.on('data', (d) => (output += d));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/session`);
      if (r.ok) return;
    } catch {
      /* Not up yet. */
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev did not start:\n${output}`);
}, 90_000);
afterAll(() => {
  child?.kill('SIGTERM');
  if (persist) rmSync(persist, { recursive: true, force: true });
});

/** A browser: a cookie, and the origin it speaks from. */
class Client {
  cookie = '';
  async call(path: string, body?: unknown, origin = base) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Origin: origin,
        Cookie: this.cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = response.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const data = (await response.json()) as any;
    return { status: response.status, data };
  }
  async rpc(method: string, args: unknown[], commandId: string = randomUUID()) {
    const r = await this.call('/api/rpc', { method, args, commandId });
    return { ...r, result: r.data?.result, error: r.data?.error, replayed: r.data?.replayed };
  }
  socket(tournamentId: string, origin = base) {
    return new Live(`ws://127.0.0.1:${port}/api/live/${tournamentId}`, this.cookie, origin);
  }
}
class Live {
  messages: any[] = [];
  closed: Promise<number>;
  opened: Promise<void>;
  private waiters: ((m: any) => boolean)[] = [];
  readonly ws: WebSocket;
  constructor(url: string, cookie: string, origin: string) {
    this.ws = new (WebSocket as any)(url, { headers: { Cookie: cookie, Origin: origin } });
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('socket refused'));
    });
    this.opened.catch(() => undefined);
    this.closed = new Promise((resolve) => (this.ws.onclose = (e) => resolve(e.code)));
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      m.receivedAt = Date.now();
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => !w(m));
    };
  }
  next(match: (m: any) => boolean, ms = 8000): Promise<any> {
    const seen = this.messages.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no message')), ms);
      this.waiters.push((m) => {
        if (!match(m)) return false;
        clearTimeout(timer);
        resolve(m);
        return true;
      });
    });
  }
}

async function pub() {
  const owner = new Client();
  await owner.call('/api/auth/register', {
    username: 'salvo',
    password: 'password-1',
    code: setupCode,
  });
  const join = async (username: string, playerId: string | null = null) => {
    const invite = await owner.call('/api/admin/invites', { playerId });
    const c = new Client();
    const r = await c.call('/api/auth/register', {
      username,
      password: 'password-3',
      code: invite.data.code,
    });
    expect(r.status).toBe(200);
    return Object.assign(c, { id: r.data.account.id as string });
  };
  const frankPlayer = (await owner.rpc('createPlayer', ['Frank'])).result as { id: string };
  const salvoPlayer = (await owner.rpc('createPlayer', ['Salvo'])).result as { id: string };
  const ann = await join('ann');
  const frank = await join('frank', frankPlayer.id);
  const carl = await join('carl');
  return { owner, ann, frank, carl, frankPlayer, salvoPlayer };
}

describe('live channel on the Workers runtime', () => {
  let w: Awaited<ReturnType<typeof pub>>;
  let tournament: any;
  beforeAll(async () => {
    w = await pub();
    const space = (await w.ann.rpc('createPlaySpace', [{ name: 'Da Gino' }])).result;
    const created = await w.ann.rpc('createTournament', [
      {
        playSpaceId: space.id,
        name: 'Sfida',
        mode: 'SINGLE_MATCH',
        gameMode: 'HI_SCORE',
        scoringConfiguration: { turns: 7 },
      },
    ]);
    tournament = created.result;
    for (const playerId of [w.frankPlayer.id, w.salvoPlayer.id])
      tournament = (await w.ann.rpc('tournamentCommand', [tournament, 'players', { playerId }]))
        .result;
  }, 60_000);

  it('refuses sockets without a session, from another origin, or without access', async () => {
    const anon = new Client();
    await expect(anon.socket(tournament.id).opened).rejects.toThrow();
    await expect(w.frank.socket(tournament.id, 'https://evil.example').opened).rejects.toThrow();
    await expect(w.carl.socket(tournament.id).opened).rejects.toThrow();
    await expect(w.frank.socket('not-an-id').opened).rejects.toThrow();
  });

  it('retrying a command with the same id applies it once', async () => {
    const id = randomUUID();
    const first = await w.ann.rpc('tournamentCommand', [tournament, 'start'], id);
    expect(first.error).toBeUndefined();
    const retry = await w.ann.rpc('tournamentCommand', [tournament, 'start'], id);
    expect(retry.replayed).toBe(true);
    expect(retry.result.version).toBe(first.result.version);
    tournament = first.result;
    // Another account cannot use the same id.
    const stolen = await w.frank.rpc('createPlayer', ['X'], id);
    expect(stolen.error?.code).toBe('COMMAND_ID_TAKEN');
  });

  it('shows the participant the scorer’s entry within a second, without a reload', async () => {
    const live = w.frank.socket(tournament.id);
    await live.opened;
    const snapshot = await live.next((m) => m.type === 'state');
    expect(snapshot.tournament.id).toBe(tournament.id);
    const match = snapshot.match;
    expect(match.turnState).toBeTruthy();
    const latencies: number[] = [];
    // Only the scorer writes; the participant's own attempt is refused by the server.
    const denied = await w.frank.rpc('recordResult', [
      { id: match.id, version: match.version, tournamentVersion: match.tournamentVersion },
      { scores: {} },
      randomUUID().replace(/-/g, ''),
    ]);
    expect(denied.error?.code).toBe('NOT_SCORER');

    const scores = Object.fromEntries(
      tournament.entries.map((e: any, i: number) => [e.id, i ? 200 : 300]),
    );
    const sent = Date.now();
    const done = await w.ann.rpc('recordResult', [
      { id: match.id, version: match.version, tournamentVersion: match.tournamentVersion },
      { scores },
      randomUUID().replace(/-/g, ''),
    ]);
    expect(done.error).toBeUndefined();
    const update = await live.next((m) => m.type === 'state' && m.version > snapshot.version);
    latencies.push(update.receivedAt - sent);
    expect(update.tournament.status).toBe('completed');
    console.log(`commit -> participant update: ${latencies[0]} ms (local workerd)`);
    expect(latencies[0]).toBeLessThan(1000);
    // Older or repeated states are ignored by comparing versions: the stream never goes back.
    const versions = live.messages.filter((m) => m.type === 'state').map((m) => m.version);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    live.ws.close();
  });

  it('keeps delivering updates after the object has been idle (hibernation)', async () => {
    const t2 = (
      await w.ann.rpc('createTournament', [
        { playSpaceId: BT, name: 'Seconda', mode: 'SINGLE_MATCH', gameMode: 'HI_SCORE' },
      ])
    ).result;
    const live = w.frank.socket(t2.id);
    // Frank is not a participant of t2 and the canonical space is open to every account.
    await live.opened;
    const first = await live.next((m) => m.type === 'state');
    await sleep(12_000);
    await w.ann.rpc('tournamentCommand', [t2, 'players', { playerId: w.salvoPlayer.id }]);
    const update = await live.next((m) => m.type === 'state' && m.version > first.version);
    expect(update.tournament.entries).toHaveLength(1);
    // A resync after the idle period returns the complete state.
    live.ws.send(JSON.stringify({ type: 'resync' }));
    await sleep(500);
    expect(live.messages.filter((m) => m.type === 'state').length).toBeGreaterThanOrEqual(3);
    live.ws.close();
  }, 40_000);

  it('ends open sockets when the session ends or the access is revoked', async () => {
    const space = (await w.ann.rpc('createPlaySpace', [{ name: 'Privato' }])).result;
    const t3 = (
      await w.ann.rpc('createTournament', [
        { playSpaceId: space.id, name: 'Privata', mode: 'SINGLE_MATCH' },
      ])
    ).result;
    const invite = await w.ann.call('/api/spaces/invites', { spaceId: space.id });
    expect(invite.status).toBe(200);
    const joined = await w.carl.call('/api/spaces/join', { code: invite.data.code });
    expect(joined.data.space.id).toBe(space.id);

    // Revoking the member closes their socket.
    const carlSocket = w.carl.socket(t3.id);
    await carlSocket.opened;
    await carlSocket.next((m) => m.type === 'state');
    await w.owner.call('/api/admin/spaces/members/remove', {
      spaceId: space.id,
      accountId: w.carl.id,
    });
    expect(await carlSocket.closed).toBe(4403);
    expect((await w.carl.rpc('tournament', [t3.id])).error?.code).toBe('NOT_ALLOWED');

    // Logging out closes the socket of that session.
    const annSocket = w.ann.socket(t3.id);
    await annSocket.opened;
    await annSocket.next((m) => m.type === 'state');
    await w.ann.call('/api/auth/logout', {});
    expect(await annSocket.closed).toBe(4401);
  }, 30_000);
});
