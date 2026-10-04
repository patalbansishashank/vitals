// @vitest-environment node
/** Golden plan (d): woman, 1) fat loss 2) autophagy index 3) muscle — 16 weeks, 24-72-h fasts opted in, tier M. */
import { describe, expect, it } from 'vitest';
import { fastingKind, usesFast } from '../fastMath';
import { runDomainPlanner } from '../planner';
import type { PlannerResult } from '../types';
import { describe2, expectGoldenBasics, expectHonestText, phaseStats } from './golden';
import { GOLDEN, GOLDEN_SUPPLEMENT_CONSENT } from './golden.requests';

// the golden persona consents to supplements (GOLDEN_SUPPLEMENT_CONSENT says why)
const req = { ...GOLDEN_SUPPLEMENT_CONSENT(GOLDEN.d), budget: { tier: 'M' as const } };
let cached: Promise<PlannerResult> | null = null;
const run = () => (cached ??= runDomainPlanner(req, { tier: 'M' }));

describe('golden plan (d): fat loss, autophagy index above muscle, fasting opted in', () => {
  it('returns 2-3 safe plans with the index described honestly; a plan without a fast says which fasting plan lost and why', async () => {
    const res = await run();
    const ctx = expectGoldenBasics(req, res);
    expect(res.fasting?.offered).toBe(true);
    for (const o of res.options) {
      const st = phaseStats(ctx, o);
      const msg = describe2(o, st);
      expectHonestText(ctx, o, st);
      for (const e of o.schedule.events ?? []) expect(e.durationH, msg).toBeLessThanOrEqual(72 + 1e-6);
      for (const p of st.filter((q) => q.energyPct < 97)) {
        expect(100 - p.energyPct, msg).toBeLessThanOrEqual(ctx.caps.deficitCapPct + 2);
        expect(p.proteinGPerKg, msg).toBeGreaterThanOrEqual(1.4);
        expect(p.rtSessionsPerWeek, msg).toBeGreaterThanOrEqual(1.9);
        expect(p.rtSetsPerMuscleWeek, msg).toBeGreaterThanOrEqual(7.5);
      }
      // R-FAST-GATE (PLANNER_V2_SPEC §3.5): a ≤ 8-h eating window is time-restricted eating, not a fast; a plan without a
      // fast says which plan with a fast it was compared with and why that one lost (never "not evaluated")
      if (!usesFast(fastingKind(o.schedule))) {
        expect(o.fasting?.rival?.reason, msg).toMatch(/^(goalLoss|noGoalGain|safetyMargin|chance|validator|shortlist|alternative|difficulty)$/);
        expect(o.fasting?.text, msg).toMatch(/A plan with .* was considered/);
        expect(o.fasting?.text, msg).not.toMatch(/dossier|§|R-[A-Z]|HC-|W-[A-Z]/);
      }
      expect(o.scorecard[0]!.change, msg).toBeLessThan(-1.5);
      expect(o.explanation.join(' '), msg).toMatch(/low confidence \(grade C\/D\)/);
      expect(o.explanation.join(' '), msg).toMatch(/muscle gain/);
    }
  }, 1_800_000);

  // PLANNER_V2_SPEC §3.8.2: ≥ 1 rung uses a fast, for the shipped hybrid and for the v2 search alone (re-examined
  // 2026-10-02: both meet it for the consenting persona; without the supplement opt-in neither does — without creatine
  // a different, fast-free plan family wins — recorded in the E6 report as an open fasting finding).
  it('includes at least one rung with a fast (spec §3.8.2)', async () => {
    const res = await run();
    expect(res.options.filter((o) => usesFast(fastingKind(o.schedule))).length).toBeGreaterThanOrEqual(1);
  }, 1_800_000);

  it('the v2 search alone includes at least one rung with a fast (spec §3.8.2)', async () => {
    const res = await runDomainPlanner(req, { tier: 'M', algorithm: 'v2' });
    expect(res.options.filter((o) => usesFast(fastingKind(o.schedule))).length).toBeGreaterThanOrEqual(1);
  }, 1_800_000);
});
