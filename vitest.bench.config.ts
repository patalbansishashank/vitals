/**
 * Planner benchmark harness (`pnpm bench:planner`): runs `src/engine/planner/bench/runner.entry.ts` in Node. The runner
 * bundles its worker (`bench/node/worker.ts`, which serves the browser pool code from `src/workers/planner.pool.ts`) and
 * spreads the runs over `worker_threads`. Selection by environment: BENCH_SUITE=T2,R1 BENCH_TIER=S BENCH_SEEDS=31
 * BENCH_SPLIT=train|holdout BENCH_ALGOS=v1,v2 (see bench/runner.ts for the rest).
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: [process.env.BENCH_ENTRY ?? 'src/engine/planner/bench/runner.entry.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 6 * 3600_000,
    hookTimeout: 600_000,
    reporters: ['default'],
  },
});
