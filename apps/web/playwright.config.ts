import { defineConfig } from '@playwright/test';

const chromium = { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH };
const phone = { width: 390, height: 844 };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    viewport: phone,
    deviceScaleFactor: 2,
    trace: 'retain-on-failure',
    launchOptions: chromium,
  },
  projects: [
    // Optional shared mode: Fastify API with SQLite in memory, serving dist-shared.
    { name: 'shared', testMatch: 'frontend.spec.ts', use: { baseURL: 'http://127.0.0.1:3107' } },
    // Default standalone PWA: a static build with no backend at all.
    {
      name: 'standalone',
      testMatch: 'standalone*.spec.ts',
      use: { baseURL: 'http://127.0.0.1:3108', serviceWorkers: 'allow' },
    },
  ],
  webServer: [
    {
      command:
        './node_modules/.bin/vite build --mode shared --logLevel error && node ../../node_modules/tsx/dist/cli.mjs e2e/server.ts',
      url: 'http://127.0.0.1:3107/health',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command:
        './node_modules/.bin/vite build --logLevel error && ./node_modules/.bin/vite preview --host 127.0.0.1 --port 3108 --strictPort',
      url: 'http://127.0.0.1:3108/',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
