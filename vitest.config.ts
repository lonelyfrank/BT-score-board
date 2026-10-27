import { defineConfig } from 'vitest/config';
export default defineConfig({
  // tests/workers needs the Workers runtime: `npm run test:workers`.
  test: { include: ['tests/*.test.ts'], testTimeout: 15000 },
});
