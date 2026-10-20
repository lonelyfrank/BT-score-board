import type { FastifyInstance, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import * as s from '../../../../packages/contracts/src/index.js';
import {
  Backend,
  commandSchemas,
  matchCommandPaths,
  scoreCommandPaths,
  tournamentCommandPaths,
} from '../../../../packages/application/src/index.js';
import { DomainError, matchById, turnState } from '../../../../packages/domain/src/index.js';

function json(schema: z.ZodType, io: 'input' | 'output' = 'output') {
  const converted = z.toJSONSchema(schema, { io, target: 'openapi-3.0', unrepresentable: 'any' });
  delete (converted as Record<string, unknown>).$schema;
  return converted;
}
function queryJson(schema: z.ZodType) {
  const result = json(schema, 'input');
  // URL query values arrive as strings. Zod performs bounded numeric coercion;
  // JSON request bodies deliberately keep strict numeric types.
  for (const property of Object.values(result.properties ?? {})) {
    if (typeof property === 'object' && property !== null && property.type === 'integer') {
      property.description = `Integer encoded as a query string; minimum ${property.minimum ?? 0}${property.maximum === undefined ? '' : `, maximum ${property.maximum}`}.`;
      property.type = 'string';
      property.pattern = '^[0-9]+$';
      delete property.minimum;
      delete property.maximum;
      if (property.default !== undefined) property.default = String(property.default);
    }
  }
  return result;
}
export function registerRoutes(app: FastifyInstance, backend: Backend) {
  function route(
    method: HTTPMethods,
    path: string,
    summary: string,
    response: z.ZodType,
    handler: (req: FastifyRequest) => unknown,
    options: {
      body?: z.ZodType;
      query?: z.ZodType;
      created?: boolean;
      command?: boolean;
      score?: boolean;
    } = {},
  ) {
    const hasId = path.includes(':id');
    app.route({
      method,
      url: `/api/v1${path}`,
      schema: {
        summary,
        operationId: `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        tags: [path.split('/')[1]!],
        security: [{ organizerToken: [] }],
        ...(hasId ? { params: json(z.object({ id: s.id }), 'input') } : {}),
        ...(options.body ? { body: json(options.body, 'input') } : {}),
        ...(options.query ? { querystring: queryJson(options.query) } : {}),
        ...(options.command
          ? {
              headers: {
                type: 'object',
                properties: {
                  'idempotency-key': {
                    type: 'string',
                    pattern: '^[A-Za-z0-9._:-]{8,128}$',
                    description:
                      'Required for scores; recommended for every command. Retries must preserve the complete request body.',
                  },
                },
                ...(options.score ? { required: ['idempotency-key'] } : {}),
              },
            }
          : {}),
        response: {
          [options.created ? 201 : 200]: json(response),
          ...Object.fromEntries(
            [400, 401, 403, 404, 409, 422, 429, 500, 503].map((code) => [
              code,
              json(s.errorResponse),
            ]),
          ),
        },
      },
      handler: async (request, reply) => {
        const parsed = response.safeParse(await handler(request));
        if (!parsed.success) {
          request.log.error({ issues: parsed.error.issues }, 'Response contract violation');
          throw new DomainError('INTERNAL_ERROR', 'An internal error occurred', 500);
        }
        const data = parsed.data;
        if (options.created) reply.code(201);
        if (data && typeof data === 'object' && 'version' in data)
          reply.header('ETag', `"${data.version}"`);
        return data;
      },
    });
  }
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;
  route(
    'GET',
    '/players',
    'Search players',
    s.page(s.playerResponse),
    (r) => backend.store.listPlayers(s.listQuery.parse(r.query)),
    { query: s.listQuery },
  );
  route(
    'POST',
    '/players',
    'Create player',
    s.playerResponse,
    (r) => backend.createPlayer(r.body),
    { body: s.createPlayer, created: true },
  );
  route('GET', '/players/:id', 'Get player', s.playerResponse, (r) => backend.player(id(r)));
  route(
    'PATCH',
    '/players/:id',
    'Edit or deactivate player',
    s.playerResponse,
    (r) => backend.updatePlayer(id(r), r.body),
    { body: s.updatePlayer },
  );
  route(
    'GET',
    '/players/:id/statistics',
    'Statistics separated by scoring configuration',
    s.statisticsResponse,
    (r) => backend.statistics(id(r)),
  );
  route(
    'GET',
    '/players/:id/history',
    'Player participation history',
    s.page(s.tournamentSummary),
    (r) => backend.history(id(r), s.listQuery.parse(r.query)),
    { query: s.listQuery },
  );
  route(
    'GET',
    '/events',
    'List events',
    s.page(s.eventResponse),
    (r) => backend.store.listEvents(s.listQuery.parse(r.query)),
    { query: s.listQuery },
  );
  route('POST', '/events', 'Create event', s.eventResponse, (r) => backend.createEvent(r.body), {
    body: s.createEvent,
    created: true,
  });
  route('GET', '/events/:id', 'Get event', s.eventResponse, (r) => backend.event(id(r)));
  route(
    'PATCH',
    '/events/:id',
    'Edit event',
    s.eventResponse,
    (r) => backend.updateEvent(id(r), r.body),
    { body: s.updateEvent },
  );
  route(
    'GET',
    '/tournaments',
    'List tournaments',
    s.page(s.tournamentSummary),
    (r) => backend.store.listTournaments(s.listQuery.parse(r.query)),
    { query: s.listQuery },
  );
  route(
    'POST',
    '/tournaments',
    'Create tournament',
    s.tournamentResponse,
    (r) => backend.createTournament(r.body),
    { body: s.createTournament, created: true },
  );
  route(
    'GET',
    '/tournaments/:id',
    'Get tournament and current versions',
    s.tournamentResponse,
    (r) => backend.tournament(id(r)),
  );
  route(
    'GET',
    '/tournaments/:id/players',
    'Tournament entries',
    z.array(s.entryResponse),
    (r) => backend.tournament(id(r)).entries,
  );
  route(
    'GET',
    '/tournaments/:id/stages',
    'Stages including invalidated history',
    z.array(s.stageResponse),
    (r) => backend.tournament(id(r)).stages,
  );
  route(
    'GET',
    '/tournaments/:id/groups',
    'Tournament groups',
    z.array(s.groupResponse),
    (r) => backend.tournament(id(r)).groups,
  );
  route(
    'GET',
    '/tournaments/:id/matches',
    'Tournament matches including cancelled history',
    z.array(s.matchResponse),
    (r) => backend.tournament(id(r)).matches,
  );
  route(
    'GET',
    '/tournaments/:id/standings',
    'Derived standings for each stage',
    s.standingsResponse,
    (r) => backend.standings(id(r)),
  );
  route(
    'GET',
    '/tournaments/:id/results',
    'Confirmed tournament results',
    z.array(s.resultResponse),
    (r) => backend.tournament(id(r)).results,
  );
  route(
    'GET',
    '/tournaments/:id/audit',
    'Organizer operation audit',
    s.page(s.auditResponse),
    (r) => {
      backend.tournament(id(r));
      return backend.store.audit(id(r), s.listQuery.parse(r.query));
    },
    { query: s.listQuery },
  );
  route(
    'GET',
    '/tournaments/:id/changes',
    'Durable application event cursor',
    z.array(s.notificationResponse),
    (r) => {
      backend.tournament(id(r));
      const q = s.eventQuery.parse(r.query);
      return backend.store.events(id(r), q.after, q.limit);
    },
    { query: s.eventQuery },
  );
  route(
    'GET',
    '/matches/:id',
    'Match with tournament version and turn state',
    s.liveMatchResponse,
    (r) => backend.liveMatch(id(r)),
  );
  route(
    'GET',
    '/matches/:id/scores',
    'Score entries including voided entries',
    z.array(s.scoreResponse),
    (r) => matchById(backend.forMatch(id(r)), id(r)).scores,
  );
  route(
    'GET',
    '/matches/:id/turns',
    'Current, next and remaining turns',
    s.turnStateResponse,
    (r) => turnState(matchById(backend.forMatch(id(r)), id(r))),
  );
  for (const [path, name] of Object.entries(tournamentCommandPaths))
    route(
      'POST',
      `/tournaments/:id/${path}`,
      name,
      s.tournamentResponse,
      (r) =>
        backend.execute(name, id(r), r.body, {
          idempotencyKey: r.headers['idempotency-key'] as string | undefined,
        }),
      { body: commandSchemas[name], command: true },
    );
  for (const [path, name] of Object.entries(matchCommandPaths)) {
    route(
      'POST',
      `/matches/:id/${path}`,
      name,
      s.tournamentResponse,
      (r) =>
        backend.execute(name, backend.forMatch(id(r)).id, r.body, {
          matchId: id(r),
          idempotencyKey: r.headers['idempotency-key'] as string | undefined,
        }),
      {
        body: commandSchemas[name],
        command: true,
        score: name === 'RecordScore' || name === 'RecordRound' || name === 'RecordTurn',
      },
    );
  }
  for (const [path, name] of Object.entries(scoreCommandPaths))
    route(
      'POST',
      `/scores/:id/${path}`,
      name,
      s.tournamentResponse,
      (r) =>
        backend.execute(name, backend.forScore(id(r)).id, r.body, {
          scoreId: id(r),
          idempotencyKey: r.headers['idempotency-key'] as string | undefined,
        }),
      { body: commandSchemas[name], command: true },
    );
}
