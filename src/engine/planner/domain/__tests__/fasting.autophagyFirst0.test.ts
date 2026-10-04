// @vitest-environment node
/** R-FAST-GATE regression, second case (PLANNER_V2_SPEC §3.8.1): autophagy first with T3 and no training days. */
import { describe, expect, it } from 'vitest';
import { fastingKind, usesFast } from '../fastMath';
import { runDomainPlanner } from '../planner';
import { AUTOPHAGY_FIRST_T3 } from './golden.requests';

describe('autophagy first, T3 opted in, no training (R-FAST-GATE regression)', () => {
  it('returns safe plans, at least one with a fast', async () => {
    const res = await runDomainPlanner(AUTOPHAGY_FIRST_T3(0), { tier: 'M', timeToTarget: false });
    expect(res.status).toBe('ok');
    expect(res.options.some((o) => usesFast(fastingKind(o.schedule)))).toBe(true);
  }, 1_800_000);
});
