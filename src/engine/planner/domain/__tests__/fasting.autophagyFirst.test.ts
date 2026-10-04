// @vitest-environment node
/**
 * Ruling R-FAST-GATE regression (PLAN item 8 decision 2; PLANNER_V2_SPEC §3.8.1): an autophagy-first request with the
 * 24-72-h tier opted in and training present returned NO plan at all (the 7-day energy availability counted the fast days
 * and the "ketones while eating" warning fired for a person without diabetes). It must now return safe plans, at least one
 * with a fast; the same holds without training. Tier M (real engine).
 */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '../context';
import { fastingKind, usesFast } from '../fastMath';
import { runDomainPlanner } from '../planner';
import type { PlannerRequest } from '../types';
import { validatePlan } from '../validate';
import { expectSimulatorAgrees } from './golden';
import { AUTOPHAGY_FIRST_T3 } from './golden.requests';

async function expectFastingPlans(req: PlannerRequest): Promise<string[]> {
  const res = await runDomainPlanner(req, { tier: 'M', timeToTarget: false });
  expect(res.status).toBe('ok');
  expect(res.fasting?.offered).toBe(true);
  const ctx = compileRequest(req);
  const kinds = res.options.map((o) => fastingKind(o.schedule));
  expect(kinds.some(usesFast), kinds.join(',')).toBe(true);
  for (const o of res.options) {
    expect(validatePlan(ctx, o.schedule).ok).toBe(true);
    expectSimulatorAgrees(req, o); // R-PLAN-SAFETY: no caution or danger the plan may not carry
    expect(o.simulation.warnings.some((w) => w.id === 'W-E08' || w.id === 'W-05-KETO-FED')).toBe(false);
    if (usesFast(fastingKind(o.schedule))) expect(o.fasting?.used).toBe(true);
    else expect(o.fasting?.rival?.reason).toBeDefined();
  }
  return res.options.map((o) => `${o.id}:${fastingKind(o.schedule)}:${Math.max(0, ...(o.schedule.events ?? []).map((e) => e.durationH))}h`);
}

describe('autophagy first, T3 opted in (R-FAST-GATE regression)', () => {
  it('with 2-4 training days a week: safe plans, at least one with a fast', async () => {
    const fasts = await expectFastingPlans(AUTOPHAGY_FIRST_T3(4));
    expect(fasts.length).toBeGreaterThanOrEqual(1);
  }, 1_800_000);
});
