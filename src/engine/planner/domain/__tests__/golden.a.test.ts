// @vitest-environment node
/**
 * Golden plan (a): 88-kg man, 1) lose 10 kg fat 2) gain muscle 3) autophagy index — 12 weeks, tier M.
 * Properties, not numbers (QA items 6, 9, 10): see golden.ts.
 */
import { describe, expect, it } from 'vitest';
import { fastingKind, usesFast } from '../fastMath';
import { runDomainPlanner } from '../planner';
import { targetReach } from '../reach';
import { describe2, expectGoldenBasics, expectHonestText, expectLadder, phaseStats } from './golden';
import { GOLDEN } from './golden.requests';
import type { PlannerResult } from '../types';

const req = { ...GOLDEN.a, budget: { tier: 'M' as const } };
let cached: Promise<PlannerResult> | null = null;
const run = () => (cached ??= runDomainPlanner(req, { tier: 'M' }));

describe('golden plan (a): fat loss first, muscle second, autophagy index third', () => {
  it('returns safe fat-loss plans with retained training, deficit-level protein and an honest time-to-target', async () => {
    const res = await run();
    const ctx = expectGoldenBasics(req, res, 1);
    expect(res.fasting?.offered).toBe(true);
    for (const o of res.options) {
      const st = phaseStats(ctx, o);
      const msg = describe2(o, st);
      expectHonestText(ctx, o, st);
      // R-FAST-GATE: the "no fasting with a muscle goal in the top two" rule is gone (no dossier source); with fat loss
      // first, 24-h fasts (default tier) are offered and the search keeps one where it serves a ranked goal — here a weekly
      // 24-h fast in a very-low-carbohydrate phase raises the autophagy index (goal 3) with fat loss at the same level and
      // muscle within its tolerance; only 24-h fasts without an opt-in; a plan without a fast says why
      for (const e of o.schedule.events ?? []) expect(e.durationH, msg).toBeLessThanOrEqual(24 + 1e-6);
      if (usesFast(fastingKind(o.schedule))) expect(o.fasting?.text, msg).toMatch(/^Includes /);
      else expect(o.fasting?.rival?.reason, msg).toBeDefined();
      expect(st[0]!.energyPct, msg).toBeLessThan(97); // opens with the deficit
      for (const p of st.filter((q) => q.energyPct < 97)) {
        expect(100 - p.energyPct, msg).toBeLessThanOrEqual(ctx.caps.deficitCapPct + 2);
        expect(p.proteinGPerKg, msg).toBeGreaterThanOrEqual(1.55);
        expect(p.proteinGPerKg, msg).toBeLessThanOrEqual(2.45);
        expect(p.rtSessionsPerWeek, msg).toBeGreaterThanOrEqual(1.9);
        expect(p.rtSetsPerMuscleWeek, msg).toBeGreaterThanOrEqual(9.5);
      }
      expect(o.scorecard[0]!.change, msg).toBeLessThan(-1.5);
      expect(o.explanation.join(' '), msg).toMatch(/low confidence/);
    }
    // R-EA-PLANNER: option A reaches dossier 17's rates for a non-athlete — a deficit of at least 15 % and ≈ 0.5 %BW a week
    // (the 25 % deficit cap and the 30 kcal/kg FFM energy-availability floor with training bind before the 0.75 % rate cap)
    const a = res.options[0]!;
    const aStats = phaseStats(ctx, a);
    // the deficit over every day of the first phase (fast days included: a weekly fast delivers part of it, R-FAST-GATE)
    const ph0 = a.phases.find((p) => p.weeks > 0)!;
    let eiSum = 0;
    let refSum = 0;
    for (let d = ph0.startDay; d < ph0.endDay; d++) {
      eiSum += a.simulation.daily.inEnergy![d]!;
      refSum += a.simulation.daily.inMaintRef![d]!;
    }
    expect(100 * (1 - eiSum / refSum), describe2(a, aStats)).toBeGreaterThanOrEqual(15);
    const tm = a.simulation.safety.tissueMassKg;
    const lossPctPerWeek = (100 * (tm[0]! - tm[tm.length - 1]!)) / GOLDEN.a.profile.body.weightKg / 12;
    expect(lossPctPerWeek, describe2(a, aStats)).toBeGreaterThanOrEqual(0.4);
    expect(a.scorecard[0]!.change).toBeLessThan(-4);
    // R-TTT: the time-to-target is the pre-run estimate's (same function), ≈ 25-40 weeks at 0.5-1 %BW a week
    const f = res.feasibility[0]!;
    expect(f.status).toBe('unattainable');
    const pre = targetReach(req, 0)!;
    expect(f.requiredWeeks).toBe(pre.weeks);
    expect(f.requiredWeeks!).toBeGreaterThanOrEqual(25);
    expect(f.requiredWeeks!).toBeLessThanOrEqual(40);
    expect(f.text).toMatch(/about \d+ weeks/);
    expect(f.text).not.toMatch(/extrapolation/);
  }, 1_800_000);

  // golden property "≥ 2 distinct options" (QA items 6, 9, 10) became the ladder property (PLANNER_V2_SPEC §9.6 item 6):
  // the easier rungs pass the distinctness thresholds (difficulty ≥ 0.15 apart, Gower ≥ 0.20, ordered), or each missing
  // rung carries a collapse reason with a sentence. Under v1 it was an expected failure (one fasting family only).
  it('ladder: distinct easier rungs or a stated collapse reason (was "at least two options")', async () => {
    const res = await run();
    expectLadder(res);
    expect(res.options.length + (res.v2?.ladder.collapsed.length ?? 0)).toBe(3);
  }, 1_800_000);
});
