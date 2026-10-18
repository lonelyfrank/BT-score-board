import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/api/src/server/app.js';
import { readConfig } from '../apps/api/src/server/config.js';
import { currentTurn, matchById, type Tournament } from '../packages/domain/src/index.js';
const token = 'test-only-organizer-secret-with-32-characters';
const apps: FastifyInstance[] = [];
async function setup(extra: Record<string, string> = {}) {
  const app = await buildApp(
    readConfig({
      ORGANIZER_TOKEN: token,
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_MAX: '10000',
      ...extra,
    }),
  );
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function request(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  status = 200,
  key?: string,
) {
  const response = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) },
    ...(payload === undefined
      ? {}
      : {
          payload: JSON.stringify(payload),
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            ...(key ? { 'idempotency-key': key } : {}),
          },
        }),
  });
  expect(response.statusCode, response.body).toBe(status);
  return response;
}
async function cmd(
  app: FastifyInstance,
  t: Tournament,
  path: string,
  body: Record<string, unknown> = {},
  matchId?: string,
): Promise<Tournament> {
  return (
    await request(
      app,
      'POST',
      matchId ? `/matches/${matchId}/${path}` : `/tournaments/${t.id}/${path}`,
      {
        expectedVersion: t.version,
        ...(matchId ? { expectedMatchVersion: matchById(t, matchId).version } : {}),
        ...body,
      },
      200,
      randomUUID(),
    )
  ).json<Tournament>();
}
async function create(app: FastifyInstance, mode: Tournament['mode'], count: number) {
  const event = (await request(app, 'POST', '/events', { name: 'Pub Time Friday' }, 201)).json<{
    id: string;
  }>();
  let t = (
    await request(
      app,
      'POST',
      '/tournaments',
      {
        name: 'Pub Time 1987',
        eventId: event.id,
        mode,
        scoringConfiguration: { turns: 1 },
        tournamentConfiguration: { groupCount: 2, qualifiersPerGroup: 2 },
      },
      201,
    )
  ).json<Tournament>();
  for (let i = 0; i < count; i++) {
    const p = (
      await request(app, 'POST', '/players', { displayName: `Player ${i + 1}` }, 201)
    ).json<{ id: string }>();
    t = await cmd(app, t, 'players', { playerId: p.id });
  }
  return cmd(app, t, 'start');
}
async function play(app: FastifyInstance, initial: Tournament, matchId: string) {
  let t = await cmd(app, initial, 'start', {}, matchId);
  while (matchById(t, matchId).status === 'active') {
    const turn = currentTurn(matchById(t, matchId))!;
    t = await cmd(
      app,
      t,
      'scores',
      { turnId: turn.id, score: 100 - t.entries.findIndex((e) => e.id === turn.participantId) },
      matchId,
    );
    t = await cmd(app, t, 'turns/complete', { turnId: turn.id }, matchId);
  }
  return t;
}
describe('HTTP acceptance workflows', () => {
  it('completes Quick High Score entirely over the documented API', async () => {
    const app = await setup();
    let t = await create(app, 'QUICK_HIGH_SCORE', 8);
    const match = t.matches[0]!.id;
    t = await play(app, t, match);
    t = await cmd(app, t, 'qualification/finalize');
    expect(t.stages[0]!.qualifiedEntryIds).toHaveLength(4);
    t = await cmd(app, t, 'finals/generate');
    t = await play(app, t, t.matches.at(-1)!.id);
    t = await cmd(app, t, 'complete');
    const result = (await request(app, 'GET', `/tournaments/${t.id}/results`)).json();
    expect(
      result.find((r: { finalPlacement: number }) => r.finalPlacement === 1).tournamentEntryId,
    ).toBe(t.entries[0]!.id);
    expect((await request(app, 'GET', `/tournaments/${t.id}/standings`)).json()).toHaveLength(2);
    expect(
      (await request(app, 'GET', `/players/${t.entries[0]!.playerId}/statistics`)).json()
        .tournamentsWon,
    ).toBe(1);
    const response = await request(app, 'GET', `/tournaments/${t.id}`);
    expect(response.headers.etag).toBe(`"${t.version}"`);
    const events = (await request(app, 'GET', `/tournaments/${t.id}/changes?limit=100`)).json();
    expect(events.some((e: { type: string }) => e.type === 'TournamentCompleted')).toBe(true);
    expect(events.some((e: { type: string }) => e.type === 'FinalStarted')).toBe(true);
  });
  it('completes a group competition including semifinals and final over HTTP', async () => {
    const app = await setup();
    let t = await create(app, 'GROUPS', 6);
    for (const m of [...t.matches]) t = await play(app, t, m.id);
    t = await cmd(app, t, 'qualification/finalize');
    t = await cmd(app, t, 'finals/generate');
    while (t.matches.some((m) => m.status === 'ready'))
      t = await play(app, t, t.matches.find((m) => m.status === 'ready')!.id);
    t = await cmd(app, t, 'complete');
    expect(t.status).toBe('completed');
    expect(t.results).toHaveLength(6);
  });
  it('validates requests and response contracts, standardizes errors, filters and paginates', async () => {
    const app = await setup();
    await request(app, 'POST', '/players', { displayName: '' }, 400);
    await request(app, 'POST', '/players', { displayName: 'Ada', injected: true }, 400);
    await request(app, 'POST', '/players', { displayName: 'Ada', nickname: 'Ace' }, 201);
    await request(app, 'POST', '/players', { displayName: 'Ada', nickname: 'Ace' }, 201);
    await request(app, 'POST', '/players', { displayName: 'Bruno' }, 201);
    const page = (await request(app, 'GET', '/players?search=Ada&limit=1&offset=1')).json();
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.limit).toBe(1);
    const missing = (await request(app, 'GET', `/players/${randomUUID()}`, undefined, 404)).json();
    expect(missing.error).toMatchObject({ code: 'NOT_FOUND', message: 'Player not found' });
    expect(missing.error.requestId).toBeTypeOf('string');
    expect(missing).not.toHaveProperty('stack');
    await request(app, 'GET', '/players/not-a-uuid', undefined, 400);
    await request(app, 'GET', '/players?limit=0', undefined, 422);
  });
  it('requires idempotency keys and returns 409 for optimistic concurrency conflicts', async () => {
    const app = await setup();
    let t = await create(app, 'QUICK_HIGH_SCORE', 4);
    const id = t.matches[0]!.id;
    t = await cmd(app, t, 'start', {}, id);
    const turn = currentTurn(matchById(t, id))!;
    const input = {
        expectedVersion: t.version,
        expectedMatchVersion: matchById(t, id).version,
        turnId: turn.id,
        score: 40,
      },
      key = randomUUID();
    await request(app, 'POST', `/matches/${id}/scores`, input, 400);
    const one = await request(app, 'POST', `/matches/${id}/scores`, input, 200, key);
    const two = await request(app, 'POST', `/matches/${id}/scores`, input, 200, key);
    expect(two.json()).toEqual(one.json());
    await request(app, 'POST', `/matches/${id}/scores`, input, 409, randomUUID());
    await request(app, 'POST', `/matches/${id}/scores`, { ...input, score: 41 }, 409, key);
    const updated = one.json<Tournament>();
    expect((await request(app, 'GET', `/matches/${id}`)).json().tournamentVersion).toBe(
      updated.version,
    );
  });
});
describe('Operational security and API documentation', () => {
  it('protects reads and writes by default, with a public health endpoint', async () => {
    const app = await setup();
    expect((await app.inject('/health')).statusCode).toBe(200);
    for (const method of ['GET', 'POST'] as const) {
      const r = await app.inject({
        method,
        url: '/api/v1/players',
        ...(method === 'POST' ? { payload: { displayName: 'Unauthorized' } } : {}),
      });
      expect(r.statusCode).toBe(401);
      expect(r.headers['www-authenticate']).toBe('Bearer');
    }
    const r = await app.inject({
      url: '/api/v1/players',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(r.statusCode).toBe(401);
  });
  it('enables spectator reads without granting mutations or audit access', async () => {
    const app = await setup({ PUBLIC_READS: 'true' });
    expect((await app.inject('/api/v1/players')).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/players',
          payload: { displayName: 'Unauthorized' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject(`/api/v1/tournaments/${randomUUID()}/audit`)).statusCode).toBe(401);
  });
  it('rate limits clients', async () => {
    const app = await setup({ RATE_LIMIT_MAX: '2' });
    await app.inject('/health');
    await app.inject('/health');
    const limited = await app.inject('/health');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
  });
  it('validates configuration without echoing secrets', () => {
    expect(() => readConfig({ ORGANIZER_TOKEN: 'short' })).toThrow('ORGANIZER_TOKEN');
    expect(() => readConfig({ ORGANIZER_TOKEN: token, PUBLIC_READS: 'yes' })).toThrow(
      'PUBLIC_READS',
    );
    expect(() => readConfig({ ORGANIZER_TOKEN: token, PORT: '70000' })).toThrow('PORT');
  });
  it('generates valid OpenAPI with schemas, bearer security and all command endpoints', async () => {
    const app = await setup();
    const spec = app.swagger();
    await expect(SwaggerParser.validate(structuredClone(spec))).resolves.toBeDefined();
    expect(spec.paths).toHaveProperty('/api/v1/tournaments/{id}/qualification/finalize');
    expect(spec.paths).toHaveProperty('/api/v1/scores/{id}/correct');
    for (const [path, methods] of Object.entries(spec.paths!))
      for (const method of ['get', 'post', 'patch'] as const) {
        const operation = methods![method];
        if (operation && !path.endsWith('/health')) {
          expect(operation.responses).toHaveProperty('409');
          expect(operation.security).toEqual([{ organizerToken: [] }]);
        }
      }
    const checkedIn = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    expect(checkedIn).toEqual(spec);
  });
});
