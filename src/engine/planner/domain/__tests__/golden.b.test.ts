// @vitest-environment node
/** Golden plan (b): 88-kg man, 1) gain 2 kg skeletal muscle 2) keep fat mass — 16 weeks, tier M (QA item 6). */
import { describe, expect, it } from 'vitest';
import { runDomainPlanner } from '../planner';
import { ROUTE_MAX_WEEKS, targetReach } from '../reach';
import { describe2, expectGoldenBasics, expectHonestText, phaseStats } from './golden';
import { GOLDEN } from './golden.requests';

describe('golden plan (b): gain muscle, keep fat mass', () => {
  it('returns 2-3 safe muscle-first plans: no deficit opening, a modest surplus at most, productive training volume', async () => {
    const req = { ...GOLDEN.b, budget: { tier: 'M' as const } };
    const res = await runDomainPlanner(req, { tier: 'M' });
    const ctx = expectGoldenBasics(req, res);
    for (const o of res.options) {
      const st = phaseStats(ctx, o);
      const msg = describe2(o, st);
      expectHonestText(ctx, o, st);
      expect(o.schedule.events ?? [], msg).toEqual([]);
      expect(st[0]!.energyPct, msg).toBeGreaterThanOrEqual(98); // never opens with deficit weeks
      for (const p of st) {
        expect(p.energyPct, msg).toBeLessThanOrEqual(111); // modest surplus (09 §4.8, 11 §4.8)
        expect(p.rtSessionsPerWeek, msg).toBeGreaterThanOrEqual(1.9);
        expect(p.rtSetsPerMuscleWeek, msg).toBeGreaterThanOrEqual(9.5); // 09 §4.2 productive range
        expect(p.proteinGPerKg, msg).toBeGreaterThanOrEqual(1.55);
        expect(p.proteinGPerKg, msg).toBeLessThanOrEqual(2.25);
      }
      expect(o.scorecard[0]!.change, msg).toBeGreaterThan(0);
      expect(o.scorecard[1]!.change, msg).toBeLessThanOrEqual(1.5); // fat mass kept within ≈ 1.5 kg
    }
    // R-TTT: +2 kg of skeletal muscle is a long but finite estimate, the same one the Goals screen shows before the run
    const f = res.feasibility[0]!;
    expect(f.status).toBe('unattainable');
    expect(f.requiredWeeks).toBe(targetReach(req, 0)!.weeks);
    expect(f.requiredWeeks!).toBeGreaterThan(16);
    expect(f.requiredWeeks!).toBeLessThanOrEqual(ROUTE_MAX_WEEKS);
  }, 1_800_000);
});
