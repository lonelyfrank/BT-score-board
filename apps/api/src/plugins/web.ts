import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    publicWeb?: boolean;
  }
}

// Only the compiled client is public. API routes retain bearer authentication.
export function registerWeb(app: FastifyInstance, directory = resolve('apps/web/dist')) {
  if (!existsSync(resolve(directory, 'index.html'))) return;
  const options = { config: { publicWeb: true }, schema: { hide: true } };
  for (const path of [
    '/',
    '/partite/*',
    '/tornei',
    '/tornei/*',
    '/hiscore',
    '/hiscore/*',
    '/giocatori',
    '/impostazioni',
  ]) {
    app.get(path, options, async (_request, reply) => {
      reply.header('Cache-Control', 'no-cache');
      return reply
        .type('text/html; charset=utf-8')
        .send(await readFile(resolve(directory, 'index.html')));
    });
  }
  app.get<{ Params: { '*': string } }>('/assets/*', options, async (request, reply) => {
    const root = resolve(directory, 'assets');
    const file = resolve(root, request.params['*']);
    if (!file.startsWith(root + sep)) return reply.code(404).send();
    const types: Record<string, string> = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.txt': 'text/plain',
    };
    if (!types[extname(file)]) return reply.code(404).send();
    try {
      const content = await readFile(file);
      return reply
        .header('X-Content-Type-Options', 'nosniff')
        .type(types[extname(file)]!)
        .send(content);
    } catch {
      return reply.code(404).send();
    }
  });
}
