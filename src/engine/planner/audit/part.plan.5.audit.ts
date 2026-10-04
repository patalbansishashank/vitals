/** Slow audit, planner runs part 5 (checks 1c and 5; see plan.ts). */
import { it } from 'vitest';
import { runPlanPart } from './runPart';

it('planner runs, part 5', { timeout: 3 * 60 * 60 * 1000 }, async () => {
  await runPlanPart(5);
});
