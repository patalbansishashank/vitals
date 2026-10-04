// @vitest-environment node
/**
 * Level matrix runs (PLANNER_V2_SPEC §12.6): every QA request at tiers S → M → X (each longer tier gets the shorter
 * one's ladder as `previous`), digested to qa/results/levels/<key>.json; `checks.qa.ts` asserts on them. The audit
 * (`pnpm audit:planner`, part.levels.*) runs the same chains. Select requests with QA_KEYS=a,c,fuzz3.
 * Run: pnpm vitest run --config src/engine/planner/__tests__/qa/vitest.qa.config.ts levels.qa
 */
import { it } from 'vitest';
import { runLevelChain } from '../../audit/levelsRun';
import { QA_KEYS } from './requests';

const keys = (process.env['QA_KEYS'] ?? QA_KEYS.join(',')).split(',').filter(Boolean);

for (const key of keys)
  it(`level chain ${key}`, async () => {
    await runLevelChain(key);
  }, 6 * 3600_000);
