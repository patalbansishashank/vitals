// @vitest-environment node
/**
 * Entry of `pnpm bench:planner` (vitest.bench.config.ts). Not part of `pnpm test`: the file name does not end in
 * `.test.ts`. Selection by environment, see runner.ts.
 */
import path from 'node:path';
import { expect, it } from 'vitest';
import { optionsFromEnv, runBenchmark } from './runner';

it('planner benchmark', async () => {
  const root = path.resolve(__dirname, '..', '..', '..', '..');
  const { summary } = await runBenchmark(optionsFromEnv(root, process.env, (line) => process.stdout.write(`${line}\n`)));
  expect(summary.headline.length + Object.keys(summary.suites).length).toBeGreaterThan(0);
}, 6 * 3600_000);
