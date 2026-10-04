// @vitest-environment node
/** Golden plan (c): 88-kg man, 1) fat loss 2) low hunger 3) keep strength — 8 weeks, 3 training days, ≤ 8-h window, tier M. */
import { describe, expect, it } from 'vitest';
import { mergeDay } from '../dayMath';
import { runDomainPlanner } from '../planner';
import { describe2, expectGoldenBasics, expectHonestText, phaseStats } from './golden';
import { GOLDEN } from './golden.requests';

describe('golden plan (c): fat loss, low hunger, keep strength', () => {
  it('returns 2-3 safe deficits with 3 heavy sessions a week, hunger-aware choices and no interfering cardio', async () => {
    const req = { ...GOLDEN.c, budget: { tier: 'M' as const } };
    const res = await runDomainPlanner(req, { tier: 'M' });
    const ctx = expectGoldenBasics(req, res);
    for (const o of res.options) {
      const st = phaseStats(ctx, o);
      const msg = describe2(o, st);
      expectHonestText(ctx, o, st);
      for (const p of st.filter((q) => q.energyPct < 97)) {
        expect(100 - p.energyPct, msg).toBeLessThanOrEqual(ctx.caps.deficitCapPct + 2);
        expect(p.proteinGPerKg, msg).toBeGreaterThanOrEqual(1.55);
        expect(p.rtSessionsPerWeek, msg).toBeGreaterThanOrEqual(2.9);
        expect(p.rtSetsPerMuscleWeek, msg).toBeGreaterThanOrEqual(5.5);
        expect(p.windowH, msg).toBeLessThanOrEqual(8 + 1e-9);
      }
      expect(o.scorecard[0]!.change, msg).toBeLessThan(-1);
      // strength: heavy loads, no running (10 §4.11), cardio never in the same session as lifting
      for (let d = 0; d < o.schedule.horizonDays; d++) {
        const ex = mergeDay(o.schedule.programs[o.schedule.days[d]!.program]!, o.schedule.days[d]!.override).exercise ?? [];
        for (const x of ex) if (x.kind === 'resistance') expect(x.loadPct1RM ?? 70).toBeGreaterThanOrEqual(80);
        for (const x of ex) if (x.kind === 'cardio') expect(x.modality).not.toBe('run');
        expect(ex.some((x) => x.kind === 'resistance') && ex.some((x) => x.kind === 'cardio'), `day ${d + 1}: lifting and cardio in one session`).toBe(false);
      }
      const text = o.explanation.join(' ');
      expect(text).toMatch(/Goal 2 \(hunger\) is served by/);
      expect(text).toMatch(/Goal 3 \(strength\)/);
    }
  }, 1_800_000);
});
