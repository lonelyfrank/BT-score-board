import { DomainError } from '../../../packages/domain/src/index.js';
import { encode } from './codec.js';
import { ApiError } from '../../web/src/services/game.js';
import { toApiError } from '../../web/src/services/local.js';

const cookieName = 'bt_session';
// Imports of a whole backup are the largest requests.
const maxBody = 32 * 1024 * 1024;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(encode(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new DomainError('BAD_REQUEST', 'Send JSON', 415);
  if (Number(request.headers.get('Content-Length') ?? 0) > maxBody)
    throw new DomainError('BAD_REQUEST', 'Request too large', 413);
  try {
    const value: unknown = await request.json();
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* Reported below. */
  }
  throw new DomainError('BAD_REQUEST', 'Invalid JSON', 400);
}
export function sessionToken(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) return value.join('=') || null;
  }
  return null;
}
/** HttpOnly and SameSite=Strict: scripts cannot read it and other sites cannot send it. */
export function sessionCookie(token: string, maxAge: number) {
  return `${cookieName}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
/** Errors keep the codes and Italian messages the screens already show. */
export function errorResponse(error: unknown) {
  const known = toApiError(error);
  const status =
    error instanceof DomainError
      ? error.status
      : error instanceof ApiError
        ? 409
        : known.code === 'VALIDATION_ERROR'
          ? 422
          : 500;
  if (status >= 500) console.error(error);
  return json({ error: { code: known.code, message: known.message } }, status);
}
