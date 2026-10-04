/**
 * Vitest configuration of the slow evidence-coverage audit (`pnpm audit:planner`, PLANNER_V2_SPEC §6.3 checks 1c, 2 full
 * and 5) and the ladder level matrix (§12.6, part.levels.*). Node environment, long timeouts; the audit writes
 * docs/PLANNER_COVERAGE.md, public/validation/planner-coverage.json and qa/results/levels/*.json (no timings; those go to
 * the uncommitted qa/results/.timing/). `pnpm test` never picks these files up (they end in `.audit.ts`).
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../../../..', import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { '@': fileURLToPath(new URL('../../..', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/engine/planner/audit/**/*.audit.ts'],
    testTimeout: 3 * 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
    fileParallelism: true,
    maxWorkers: 12,
    reporters: ['default'],
  },
});
