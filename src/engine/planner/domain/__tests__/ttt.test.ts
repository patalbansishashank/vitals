// @vitest-environment node
/**
 * Time-to-target (QA item 7; ruling R-TTT, release check 2026-10-01). Body-composition targets get their time-to-target
 * from the fastest-safe-rate route (`reach.ts` `targetReach`) — the same function the Goals screen calls before the run
 * for "reachable in this horizon" — so the two can never contradict each other; horizons are capped at two years
 * ("more than two years at the safe rate"), never extrapolated to absurd values. Cases on the QA persona (88 kg, 178 cm,
 * 34-year-old man, 1-3 training years, 3 sessions a week): the reproduction (10 kg of fat), +2 kg of skeletal muscle,
 * and targets that are truly out of reach (past the body-fat floor; more than two years away).
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '../../../types/profile';
import { runDomainPlanner, tttText } from '../planner';
import { ROUTE_MAX_WEEKS, estimateTargets, targetReach } from '../reach';
import type { PlannerRequest, RankedGoal } from '../types';

const MAN_88: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88 }, habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' }, startDate: '2026-10-05' };
const req = (goals: RankedGoal[], horizonDays: number): PlannerRequest => ({
  profile: MAN_88,
  goals,
  horizonDays,
  seed: 7,
  budget: { tier: 'S', ensembleSize: 0 },
  constraints: { trainingDaysPerWeek: { min: 0, max: 3 } },
});
const OPTS = { tier: 'S' as const, totalEU: 400, tttBudgetEU: 600 };
const FAT_10: RankedGoal = { metric: 'fatMass', direction: 'target', target: -10, targetKind: 'change' };

describe('time-to-target and the pre-run estimate (R-TTT)', () => {
  it('the reproduction: 10 kg of fat takes ≈ 25-40 weeks at 0.5-1 %BW/week, and the pre-run estimate says the same', async () => {
    const request: PlannerRequest = {
      ...req([FAT_10, { metric: 'skeletalMuscle', direction: 'maximise' }, { metric: 'autophagyIdx', direction: 'maximise' }], 84),
    };
    // pre-run (Goals screen): same function, before any optimiser work
    const pre = estimateTargets(request)[0]!;
    expect(pre.supported).toBe(true);
    expect(pre.reachableInHorizon).toBe(false);
    expect(pre.weeks).not.toBeNull();
    expect(pre.weeks!).toBeGreaterThanOrEqual(25);
    expect(pre.weeks!).toBeLessThanOrEqual(40);
    // what 12 weeks reach at the fastest safe rate: ≈ 0.5 %BW/week of weight (the 25 % deficit cap and the energy-
    // availability floor bind before the 0.75 % rate cap for this man), mostly fat
    expect(-pre.changeAtHorizon).toBeGreaterThan(4);
    expect(-pre.changeAtHorizon).toBeLessThan(10);
    expect(pre.ratePerWeek).toBeGreaterThan(0.3);
    expect(pre.text).toMatch(/about \d+ weeks/);

    const res = await runDomainPlanner(request, OPTS);
    const f = res.feasibility[0]!;
    expect(f.status).toBe('unattainable');
    expect(f.requiredWeeks).toBe(pre.weeks);
    expect(f.reach?.weeks).toBe(pre.weeks);
    expect(f.reach?.changeAtHorizon).toBeCloseTo(pre.changeAtHorizon, 9);
    expect(f.text).toContain(pre.text);
    expect(f.text).not.toMatch(/extrapolation|roughly \d{3} weeks/);
    // the plans themselves come close to what the route reaches in the horizon (they also serve goals 2 and 3)
    const best = Math.min(...res.options.map((o) => o.scorecard[0]!.change));
    expect(best).toBeLessThan(0.8 * pre.changeAtHorizon);
  }, 300_000);

  it('+2 kg of skeletal muscle: a long but finite estimate at dossier 09 rates for 1-3 training years', () => {
    const r = targetReach(req([{ metric: 'skeletalMuscle', direction: 'target', target: 2, targetKind: 'change' }, { metric: 'fatMass', direction: 'target', target: 0, targetKind: 'change' }], 112), 0)!;
    expect(r.supported).toBe(true);
    expect(r.kind).toBe('gain');
    expect(r.reachableInHorizon).toBe(false);
    expect(r.weeks).not.toBeNull();
    expect(r.weeks!).toBeGreaterThan(16);
    expect(r.weeks!).toBeLessThanOrEqual(ROUTE_MAX_WEEKS);
    // 09 §4.6: trained (TS ≈ 0.6) lean gains of ≈ 0.1-0.6 kg a month; skeletal muscle is about half of lean tissue
    const perMonth = (2 / r.weeks!) * 4.345;
    expect(perMonth).toBeGreaterThan(0.03);
    expect(perMonth).toBeLessThan(0.35);
    expect(r.text).toMatch(/about \d+ weeks/);
  }, 120_000);

  it('2 kg lean tissue in 8 weeks: the planner reports the route’s weeks', async () => {
    const res = await runDomainPlanner(req([{ metric: 'leanTissue', direction: 'target', target: 2, targetKind: 'change' }], 56), OPTS);
    const f = res.feasibility[0]!;
    expect(f.status).toBe('unattainable');
    expect(f.requiredWeeks).not.toBeNull();
    expect(f.requiredWeeks!).toBeGreaterThan(8);
    expect(f.requiredWeeks!).toBeLessThanOrEqual(ROUTE_MAX_WEEKS);
    expect(f.searchedWeeks).toBe(ROUTE_MAX_WEEKS);
    expect(f.text).toMatch(/about \d+ weeks/);
  }, 300_000);

  it('truly unattainable targets: past the body-fat floor (no claim), or more than two years at the safe rate', async () => {
    const res = await runDomainPlanner(req([{ metric: 'fatMass', direction: 'target', target: -30, targetKind: 'change' }], 84), OPTS);
    const f = res.feasibility[0]!;
    expect(f.status).toBe('unattainable');
    expect(f.beyondSafetyLimits).toBe(true);
    expect(f.requiredWeeks).toBeNull();
    expect(f.text).toMatch(/safety floor/);
    expect(f.text).not.toMatch(/about \d+ weeks/);

    const far = targetReach(req([{ metric: 'skeletalMuscle', direction: 'target', target: 8, targetKind: 'change' }], 84), 0)!;
    expect(far.weeks).toBeNull();
    expect(far.beyondTwoYears).toBe(true);
    expect(far.text).toMatch(/more than two years/);
    expect(far.text).not.toMatch(/\d{3} weeks/);
  }, 300_000);

  it('the extended-horizon search text (metrics without a route) is capped at two years', () => {
    expect(tttText({ weeks: 23, days: 159, searchedDays: 168, estimatedWeeks: null, ratePerWeek: null, bestValue: 14 }, 'kg')).toBe('At the fastest safe rate the model finds it takes about 23 weeks.');
    const est = tttText({ weeks: null, days: null, searchedDays: 365, estimatedWeeks: 70, ratePerWeek: 0.034, bestValue: 35 }, 'kg');
    expect(est).toMatch(/not reached within 52 weeks/);
    expect(est).toMatch(/roughly 70 weeks/);
    expect(est).toMatch(/0\.03 kg a week/);
    const long = tttText({ weeks: null, days: null, searchedDays: 365, estimatedWeeks: 248, ratePerWeek: 0.01, bestValue: 35 }, 'kg');
    expect(long).toMatch(/more than two years/);
    expect(long).not.toMatch(/248/);
    expect(tttText({ weeks: null, days: null, searchedDays: 365, estimatedWeeks: null, ratePerWeek: null, bestValue: 35 }, 'kg')).toMatch(/not reached within 52 weeks/);
  });
});
