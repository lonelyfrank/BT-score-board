import { existsSync } from 'node:fs';
import { readConfig } from './config.js';
import { buildApp } from './app.js';
if (existsSync('.env')) process.loadEnvFile('.env');
const config = readConfig();
const app = await buildApp(config);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app.close().then(() => {
      process.exitCode = 0;
    });
  });
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
