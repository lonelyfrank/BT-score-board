import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    publicWeb?: boolean;
  }
}

/** Client routes of apps/web/src/main.tsx: a reload or a bookmark must get the SPA, not the API. */
export const clientRoutes = [
  '/',
  '/partite/*',
  '/tornei',
  '/tornei/*',
  '/hiscore',
  '/hiscore/*',
  '/serate',
  '/giocatori',
  '/impostazioni',
];

// Only the compiled client is public. API routes retain bearer authentication.
export function registerWeb(app: FastifyInstance, directory = resolve('apps/web/dist-shared')) {
  if (!existsSync(resolve(directory, 'index.html'))) return;
  const options = { config: { publicWeb: true }, schema: { hide: true } };
  for (const path of clientRoutes) {
    app.get(path, options, async (_request, reply) => {
      reply.header('Cache-Control', 'no-cache');
      return reply
        .type('text/html; charset=utf-8')
        .send(await readFile(resolve(directory, 'index.html')));
    });
  }
  for (const folder of ['assets', 'icons'])
    app.get<{ Params: { '*': string } }>(`/${folder}/*`, options, async (request, reply) => {
      const root = resolve(directory, folder);
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
