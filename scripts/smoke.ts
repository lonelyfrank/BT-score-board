import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../apps/api/src/server/app.js';
import { readConfig } from '../apps/api/src/server/config.js';

const directory = mkdtempSync(join(tmpdir(), 'bt-darts-smoke-'));
const token = randomBytes(32).toString('hex');
const config = readConfig({
  ORGANIZER_TOKEN: token,
  DATABASE_PATH: join(directory, 'smoke.sqlite'),
  LOG_LEVEL: 'silent',
});
let app = await buildApp(config);
try {
  let address = await app.listen({ host: '127.0.0.1', port: 0 });
  const health = await fetch(`${address}/health`);
  if (health.status !== 200) throw new Error('Health check failed');
  const unauthorized = await fetch(`${address}/api/v1/players`);
  if (unauthorized.status !== 401) throw new Error('Read authentication failed');
  const created = await fetch(`${address}/api/v1/players`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Smoke test player' }),
  });
  if (created.status !== 201) throw new Error(`Creation failed: ${await created.text()}`);
  const player = (await created.json()) as { id: string };
  await app.close();
  app = await buildApp(config);
  address = await app.listen({ host: '127.0.0.1', port: 0 });
  const restored = await fetch(`${address}/api/v1/players/${player.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (restored.status !== 200) throw new Error('Persistence after restart failed');
  console.log('HTTP smoke passed: compiled build, authentication, create, restart and recovery.');
} finally {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
