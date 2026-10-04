/** Slow audit, planner runs part 3 (checks 1c and 5; see plan.ts). */
import { it } from 'vitest';
import { runPlanPart } from './runPart';

it('planner runs, part 3', { timeout: 3 * 60 * 60 * 1000 }, async () => {
  await runPlanPart(3);
});
