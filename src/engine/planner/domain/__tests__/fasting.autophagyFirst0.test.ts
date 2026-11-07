// @vitest-environment node
/**
 * R-FAST-GATE regression, second case (PLANNER_V2_SPEC §3.8.1): a fasting-served goal first with T3 and no training days
 * (formerly the autophagy index, no goal since D2-02; blood ketones keep the same fasting conditions).
 */
import { describe, expect, it } from 'vitest';
import { fastingKind, usesFast } from '../fastMath';
import { runDomainPlanner } from '../planner';
import { KETOSIS_FIRST_T3 } from './golden.requests';

describe('ketosis first, T3 opted in, no training (R-FAST-GATE regression)', () => {
  it('returns safe plans, at least one with a fast', async () => {
    const res = await runDomainPlanner(KETOSIS_FIRST_T3(0), { tier: 'M', timeToTarget: false });
    expect(res.status).toBe('ok');
    expect(res.options.some((o) => usesFast(fastingKind(o.schedule)))).toBe(true);
  }, 1_800_000);
});
