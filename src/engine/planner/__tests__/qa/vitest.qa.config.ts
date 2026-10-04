/**
 * Vitest configuration of the QA pass 2 planner checks (release gate v0.2): `run.qa.ts` makes full tier-M planner runs
 * and writes digests to qa/results/q2/planner; `checks.qa.ts` asserts on them. `pnpm test` never picks these files up
 * (they end in `.qa.ts`).
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { '@': fileURLToPath(new URL('../../../..', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/engine/planner/__tests__/qa/**/*.qa.ts'],
    testTimeout: 3 * 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
    reporters: ['default'],
  },
});
