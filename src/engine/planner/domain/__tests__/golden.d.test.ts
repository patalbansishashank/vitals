// @vitest-environment node
/**
 * Golden plan (d): woman, 1) fat loss 2) muscle — 16 weeks, 24-72-h fasts opted in, tier M (the autophagy index the owner
 * request ranked second is no goal since D2-02; `GOLDEN` leaves it out).
 */
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

describe('golden plan (d): fat loss above muscle, fasting opted in', () => {
  it('returns 2-3 safe plans; a plan without a fast says which fasting plan lost and why', async () => {
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
      // (the "low confidence (grade C/D)" sentence and its muscle-gain cost belonged to the autophagy goal, no goal since D2-02)
      expect(o.explanation.join(' '), msg).not.toMatch(/autophagy/i);
    }
  }, 1_800_000);

  // PLANNER_V2_SPEC §3.8.2: ≥ 1 rung uses a fast. The spec target was set for the owner request with the autophagy index
  // ranked second, the goal that gave fasting its credit; that index is no goal since D2-02 (fasting keeps no fictional
  // benefit), so for fat loss above muscle a fast is kept only where the search finds it serves them. The shipped hybrid
  // still keeps one; the v2 search alone need not, and every plan without a fast says which fasting plan lost and why.
  it('includes at least one rung with a fast (spec §3.8.2)', async () => {
    const res = await run();
    expect(res.options.filter((o) => usesFast(fastingKind(o.schedule))).length).toBeGreaterThanOrEqual(1);
  }, 1_800_000);

  it('the v2 search alone: fasting is offered, and every plan without a fast names the fasting plan it lost to and why', async () => {
    const res = await runDomainPlanner(req, { tier: 'M', algorithm: 'v2' });
    expect(res.status).toBe('ok');
    expect(res.fasting?.offered).toBe(true);
    for (const o of res.options)
      if (!usesFast(fastingKind(o.schedule))) expect(o.fasting?.rival?.reason, o.name).toMatch(/^(goalLoss|noGoalGain|safetyMargin|chance|validator|shortlist|alternative|difficulty)$/);
  }, 1_800_000);
});
