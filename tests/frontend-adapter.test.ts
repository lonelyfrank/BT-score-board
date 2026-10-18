import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/api/src/server/app.js';
import { readConfig } from '../apps/api/src/server/config.js';
import { HttpAdapter } from '../apps/web/src/services/http.js';

let app: FastifyInstance;
let adapter: HttpAdapter;
const token = 'frontend-integration-test-token-32-characters';
let failPath = '';
const calls: { path: string; body?: string; key?: string }[] = [];
beforeEach(async () => {
  const memory = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  app = await buildApp(
    readConfig({
      ORGANIZER_TOKEN: token,
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_MAX: '10000',
    }),
  );
  calls.length = 0;
  failPath = '';
  vi.stubGlobal('fetch', async (path: string, options: RequestInit) => {
    const headers = options.headers as Record<string, string>;
    calls.push({ path, body: options.body as string, key: headers['Idempotency-Key'] });
    const response = await app.inject({
      method: options.method as 'GET' | 'POST',
      url: path,
      headers,
      payload: options.body as string | undefined,
    });
    if (path.endsWith(failPath) && failPath) {
      failPath = '';
      throw new TypeError('Lost response after commit');
    }
    return new Response(response.body, {
      status: response.statusCode,
      headers: { 'content-type': 'application/json' },
    });
  });
  adapter = new HttpAdapter();
  adapter.setToken(token);
});
afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});
async function setup() {
  const players = await Promise.all(['Ada', 'Bea'].map((name) => adapter.createPlayer(name)));
  let t = await adapter.createTournament({
    name: 'Frontend test',
    mode: 'QUICK_HIGH_SCORE',
    scoringConfiguration: { turns: 1 },
    tournamentConfiguration: { qualifiers: 2 },
  });
  for (const player of players)
    t = await adapter.tournamentCommand(t, 'players', { playerId: player.id });
  t = await adapter.tournamentCommand(t, 'start');
  return adapter.matchCommand(await adapter.match(t.matches[0]!.id), 'start');
}
it('maps live totals from the backend, completes turns and undoes the last score', async () => {
  let m = await setup();
  const first = m.turnState.currentTurn!.participantId;
  m = await adapter.submitTurn(m, 140);
  expect(m.scoreboard.find((p) => p.tournamentEntryId === first)).toMatchObject({
    total: 140,
    average: 140,
    bestTurn: 140,
    turns: 1,
  });
  expect(m.turnState.currentTurn!.participantId).not.toBe(first);
  m = await adapter.undo(m);
  expect(m.scoreboard.find((p) => p.tournamentEntryId === first)?.total).toBe(0);
  expect(m.turnState.currentTurn!.participantId).toBe(first);
});
it('replays the exact score request after an uncertain response and a client reload', async () => {
  const m = await setup();
  failPath = `/matches/${m.id}/scores`;
  await expect(adapter.submitTurn(m, 120)).rejects.toMatchObject({ uncertain: true });
  adapter = new HttpAdapter();
  const fresh = await adapter.match(m.id);
  const recovered = await adapter.submitTurn(fresh, 180);
  expect(recovered.scores.filter((s) => !s.voided)).toHaveLength(1);
  expect(recovered.scores[0]!.score).toBe(120);
  const scoreCalls = calls.filter((c) => c.path.endsWith('/scores'));
  expect(scoreCalls).toHaveLength(2);
  expect(scoreCalls[0]).toEqual(scoreCalls[1]);
});
it('recovers a completed turn response without scoring the next player', async () => {
  const m = await setup();
  failPath = `/matches/${m.id}/turns/complete`;
  await expect(adapter.submitTurn(m, 100)).rejects.toMatchObject({ uncertain: true });
  adapter = new HttpAdapter();
  const recovered = await adapter.submitTurn(await adapter.match(m.id), 100);
  expect(recovered.scores).toHaveLength(1);
  expect(recovered.turns.filter((t) => t.status === 'completed')).toHaveLength(1);
  const completions = calls.filter((c) => c.path.endsWith('/turns/complete'));
  expect(completions).toHaveLength(2);
  expect(completions[0]).toEqual(completions[1]);
});
it('completes an already recorded open turn after reload without resending its score', async () => {
  const m = await setup();
  await adapter.matchCommand(m, 'scores', { turnId: m.turnState.currentTurn!.id, score: 80 });
  const recovered = await adapter.submitTurn(await adapter.match(m.id), 80);
  expect(recovered.scores).toHaveLength(1);
  expect(calls.filter((c) => c.path.endsWith('/scores'))).toHaveLength(1);
  expect(recovered.turns[0]!.status).toBe('completed');
});
