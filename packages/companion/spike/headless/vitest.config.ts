import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// R17 headless spike: `pnpm vitest run --config packages/companion/spike/headless/vitest.config.ts`.
// Node environment (no jsdom), the app's `@` alias, kept out of `pnpm test`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../../../src', import.meta.url)) } },
  // R17_MODE=production runs the non-test branches (`import.meta.env.MODE !== 'test'`) a real server would take.
  mode: process.env.R17_MODE ?? 'test',
  test: {
    root: fileURLToPath(new URL('../../../..', import.meta.url)),
    include: ['packages/companion/spike/headless/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    setupFiles: ['packages/companion/spike/headless/traps.ts'],
    testTimeout: 300_000,
  },
});
