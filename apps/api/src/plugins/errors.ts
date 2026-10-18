import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../../../../packages/domain/src/index.js';
export function registerErrors(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (typeof error !== 'object' || error === null) error = new Error('Unknown error');
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'An internal error occurred';
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 422;
      code = 'VALIDATION_ERROR';
      message = error.issues
        .map((i) => `${i.path.join('.') || 'request'}: ${i.message}`)
        .join('; ');
    } else if (typeof error === 'object' && error !== null) {
      if ('validation' in error && error.validation) {
        status = 400;
        code = 'VALIDATION_ERROR';
        message = 'Request does not match the API schema';
      } else if ('code' in error && String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        status = 409;
        code = 'INTEGRITY_CONFLICT';
        message = 'The operation conflicts with persisted data';
      } else if ('code' in error && String(error.code).startsWith('SQLITE_BUSY')) {
        status = 503;
        code = 'DATABASE_BUSY';
        message = 'Database is busy; retry the command with the same idempotency key';
      } else if (
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ) {
        status = error.statusCode;
        code = status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
        message = status === 429 ? 'Too many requests' : 'Invalid request';
      }
    }
    if (status >= 500) request.log.error({ err: error }, 'Request failed');
    reply.status(status).send({ error: { code, message, requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: request.id } }),
  );
}
