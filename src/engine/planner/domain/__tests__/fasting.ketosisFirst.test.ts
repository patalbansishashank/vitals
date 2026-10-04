// @vitest-environment node
/**
 * R-FAST-GATE (PLANNER_V2_SPEC §3.8.1, ketosis case): ketones first with the 24-48-h tier (T2) opted in and training.
 * Fasting is offered and the plans are safe; whether a fast is used is the optimiser's call. In this engine a
 * ketogenic deficit alone already gives a mean BHB of ≈ 4.5 mmol/L (tier M), above every plan with a fast, so the options
 * may carry no fast — then each must say which plan with a fast it was compared with and why it lost on the goals
 * (spec deviation reported: the ketone over-read is QA engine item 2; at tier S the search returns weekly 24-h fasts).
 */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '../context';
import { fastingKind, usesFast } from '../fastMath';
import { runDomainPlanner } from '../planner';
import type { PlannerRequest } from '../types';
import { validatePlan } from '../validate';
import { expectSimulatorAgrees } from './golden';
import { WOMAN_78 } from './golden.requests';

const KETO_FIRST_T2: PlannerRequest = {
  profile: WOMAN_78,
  goals: [
    { metric: 'bhb', direction: 'maximise' },
    { metric: 'fatMass', direction: 'minimise' },
  ],
  horizonDays: 84,
  constraints: { trainingDaysPerWeek: { min: 2, max: 3 }, maxFastHours: 48 },
  safety: { mode: 'M0', optIns: { fastingTier: 'T2' }, fasting: { maxFastHours: 48 } },
  seed: 10,
  budget: { tier: 'M' },
};

describe('ketosis first, T2 opted in (R-FAST-GATE regression)', () => {
  it('offers fasting, returns safe plans, fasts ≤ 48 h; a plan without a fast names the fasting plan it beat on the goals', async () => {
    const res = await runDomainPlanner(KETO_FIRST_T2, { tier: 'M', timeToTarget: false });
    expect(res.status).toBe('ok');
    expect(res.fasting?.offered).toBe(true);
    const ctx = compileRequest(KETO_FIRST_T2);
    for (const o of res.options) {
      expect(validatePlan(ctx, o.schedule).ok).toBe(true);
      expectSimulatorAgrees(KETO_FIRST_T2, o);
      for (const e of o.schedule.events ?? []) expect(e.durationH).toBeLessThanOrEqual(48 + 1e-6);
      if (!usesFast(fastingKind(o.schedule))) {
        expect(o.fasting?.rival?.reason).toMatch(/^(goalLoss|noGoalGain|safetyMargin|chance|validator|shortlist|alternative|difficulty)$/);
        expect(o.fasting?.text).toMatch(/A plan with .* was considered/);
      }
    }
  }, 1_800_000);
});
