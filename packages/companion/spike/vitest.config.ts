import { defineConfig } from 'vitest/config';

// `pnpm spike:sync`: manual R7 §7.3 measurements, kept out of `pnpm test`.
export default defineConfig({
  test: { include: ['packages/companion/spike/**/*.test.ts'], environment: 'node', testTimeout: 300_000 },
});
