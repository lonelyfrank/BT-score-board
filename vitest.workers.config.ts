import { defineConfig } from 'vitest/config';
// The suites that need the real Workers runtime (workerd through wrangler dev).
export default defineConfig({
  test: { include: ['tests/workers/**/*.test.ts'], testTimeout: 60000, hookTimeout: 120000 },
});
