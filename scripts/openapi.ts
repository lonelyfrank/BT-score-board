import { writeFileSync, mkdirSync } from 'node:fs';
import { buildApp } from '../apps/api/src/server/app.js';
import { readConfig } from '../apps/api/src/server/config.js';
const app = await buildApp(
  readConfig({
    ORGANIZER_TOKEN: 'openapi-generator-not-an-access-secret',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
  }),
);
try {
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/openapi.json', JSON.stringify(app.swagger(), null, 2) + '\n');
  console.log('Generated docs/openapi.json');
} finally {
  await app.close();
}
