import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import rateLimit from '@fastify/rate-limit';
import { Backend } from '../../../../packages/application/src/index.js';
import { SqliteStore } from '../../../../packages/database/src/index.js';
import { registerAuth } from '../middleware/auth.js';
import { registerErrors } from '../plugins/errors.js';
import { registerRoutes } from '../routes/index.js';
import { registerWeb } from '../plugins/web.js';
import type { Config } from './config.js';

export async function buildApp(config: Config, existingStore?: SqliteStore) {
  const store = existingStore ?? new SqliteStore(config.DATABASE_PATH);
  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 65536,
    trustProxy: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  registerErrors(app);
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: '1 minute' });
  registerAuth(app, config);
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BT Darts Score Board API',
        version: '1.0.0',
        description:
          'Manual darts scoring. All writes require an organizer token; optimistic versions and score idempotency protect data.',
      },
      components: { securitySchemes: { organizerToken: { type: 'http', scheme: 'bearer' } } },
    },
  });
  const health = async () => {
    store.sqlite.prepare('SELECT 1').get();
    return { status: 'ok' };
  };
  for (const url of ['/health', '/api/v1/health'])
    app.get(
      url,
      {
        schema: {
          summary: 'Health check',
          security: [],
          response: {
            200: {
              type: 'object',
              properties: { status: { type: 'string', enum: ['ok'] } },
              required: ['status'],
            },
          },
        },
      },
      health,
    );
  registerRoutes(app, new Backend(store));
  registerWeb(app);
  app.get('/api/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  app.addHook('onClose', async () => {
    if (!existingStore) store.close();
  });
  try {
    await app.ready();
    return app;
  } catch (error) {
    if (!existingStore) store.close();
    throw error;
  }
}
