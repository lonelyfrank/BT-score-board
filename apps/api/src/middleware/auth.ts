import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../server/config.js';
import { DomainError } from '../../../../packages/domain/src/index.js';
export function registerAuth(app: FastifyInstance, config: Config) {
  const expected = createHash('sha256').update(config.ORGANIZER_TOKEN).digest();
  app.addHook('onRequest', async (request, reply) => {
    const path = request.routeOptions.url;
    if (request.routeOptions.config.publicWeb) return;
    if (path === '/health' || path === '/api/v1/health') return;
    const publicRead =
      config.PUBLIC_READS && request.method === 'GET' && path !== '/api/v1/tournaments/:id/audit';
    if (publicRead) return;
    const authorization = request.headers.authorization;
    if (
      !authorization?.startsWith('Bearer ') ||
      !timingSafeEqual(createHash('sha256').update(authorization.slice(7)).digest(), expected)
    ) {
      reply.header('WWW-Authenticate', 'Bearer');
      throw new DomainError('UNAUTHORIZED', 'A valid organizer bearer token is required', 401);
    }
  });
}
