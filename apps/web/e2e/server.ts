import { resolve } from 'node:path';
import { buildApp } from '../../api/src/server/app.js';
import { readConfig } from '../../api/src/server/config.js';
process.chdir(resolve('../..'));
const app = await buildApp(
  readConfig({
    ORGANIZER_TOKEN: 'browser-test-only-token-at-least-32-characters',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '10000',
  }),
);
await app.listen({ host: '127.0.0.1', port: 3107 });
process.on('SIGTERM', () => void app.close());
