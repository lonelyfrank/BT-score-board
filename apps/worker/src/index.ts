import type { ExportedHandler } from './cf.js';
import type { Env } from './room.js';

export { GameRoom } from './room.js';

const room = (env: Env) => env.ROOM.get(env.ROOM.idFromName('main'));

export default {
  // Static assets are served before the Worker runs; only /api reaches it (wrangler.jsonc).
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return room(env).fetch(request);
    return env.ASSETS.fetch(request);
  },
  // Daily copy of all data in R2, when the bucket is bound: one file per day.
  async scheduled(controller, env) {
    if (!env.BACKUPS) return;
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    const response = await room(env).fetch('https://room/internal/backup', { method: 'POST' });
    if (!response.ok) throw new Error(`Backup failed: ${response.status}`);
    await env.BACKUPS.put(`backups/bt-darts-${day}.json`, await response.text(), {
      httpMetadata: { contentType: 'application/json' },
    });
  },
} satisfies ExportedHandler<Env>;
