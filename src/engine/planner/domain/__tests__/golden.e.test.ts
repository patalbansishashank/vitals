// @vitest-environment node
/** Golden plan (e): lean trained man, 1) gain muscle 2) minimise fat gain — 16 weeks, tier M. */
import { describe, expect, it } from 'vitest';
import { runDomainPlanner } from '../planner';
import { describe2, expectGoldenBasics, expectHonestText, phaseStats } from './golden';
import { GOLDEN, GOLDEN_SUPPLEMENT_CONSENT } from './golden.requests';

describe('golden plan (e): lean gain for a trained man', () => {
  it('returns 2-3 safe lean-gain plans: small surplus, advanced gain rate, productive volume, no deficit opening', async () => {
    // the golden persona consents to supplements (GOLDEN_SUPPLEMENT_CONSENT says why)
    const req = { ...GOLDEN_SUPPLEMENT_CONSENT(GOLDEN.e), budget: { tier: 'M' as const } };
    const res = await runDomainPlanner(req, { tier: 'M' });
    const ctx = expectGoldenBasics(req, res);
    for (const o of res.options) {
      const st = phaseStats(ctx, o);
      const msg = describe2(o, st);
      expectHonestText(ctx, o, st);
      expect(o.schedule.events ?? [], msg).toEqual([]);
      expect(st[0]!.energyPct, msg).toBeGreaterThanOrEqual(98);
      for (const p of st) {
        expect(p.energyPct, msg).toBeLessThanOrEqual(111);
        expect(p.rtSessionsPerWeek, msg).toBeGreaterThanOrEqual(1.9);
        expect(p.rtSetsPerMuscleWeek, msg).toBeGreaterThanOrEqual(9.5);
        expect(p.proteinGPerKg, msg).toBeGreaterThanOrEqual(1.55);
        expect(p.proteinGPerKg, msg).toBeLessThanOrEqual(2.25);
      }
      expect(o.scorecard[0]!.change, msg).toBeGreaterThan(0);
      // advanced lifter: tissue gain ≤ ≈ 0.25 % of body weight a week (13 §4C B21; 11 §6)
      const w = o.simulation.safety.tissueMassKg;
      const weeks = w.length / 7;
      expect((100 * (w[w.length - 1]! - w[0]!)) / ctx.rp.weightKg / weeks, msg).toBeLessThanOrEqual(0.3);
    }
  }, 1_800_000);
});
