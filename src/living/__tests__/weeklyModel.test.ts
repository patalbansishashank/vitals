import { describe, expect, it } from 'vitest';
import { weeklyModelReview } from '../weeklyModel';
import type { ProjectionDigest } from '../types';
import type { PlannerRequestV2 } from '@/engine/planner/domain/types';

const request: PlannerRequestV2 = {
  profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 28, heightCm: 166, weightKg: 75 } },
  goals: [{ metric: 'fatMass', direction: 'minimise' }],
  horizonDays: 28,
  startDate: '2026-11-09',
  constraints: {
    muscleRetention: {
      maxLossPct: 5,
      baseline: { kg: 30, date: '2026-11-09', basis: 'modelSkeletalMuscle' },
    },
  },
};
const bands = (values: number[]) => ({ p10: [...values], p50: [...values], p90: [...values] });
const forecast = (): ProjectionDigest => ({
  fromDay: 0,
  goals: [],
  warnings: [],
  realistic: {},
  asPrescribed: {
    inEnergy: bands(Array<number>(28).fill(1500)),
    tdee: bands([...Array<number>(7).fill(2700), ...Array<number>(21).fill(2400)]),
    fatMass: bands(Array.from({ length: 28 }, (_, i) => 23 - (i + 1) * 0.1)),
    skeletalMuscle: bands(Array.from({ length: 28 }, (_, i) => 30 - (i + 1) * 0.01)),
  },
});
const inputs = () => ({
  request,
  forecast: forecast(),
  startDate: '2026-11-09',
  endDate: '2026-12-07',
  asOf: '2026-11-09',
  weighIns: 12,
  foodDays7: 6,
  foodDaysPrevious7: 6,
});

describe('weekly model recommendation', () => {
  it('holds a fixed 1500 target while the model deficit shrinks with expenditure', () => {
    const i = inputs();
    const first = weeklyModelReview(i)!;
    const next = weeklyModelReview({ ...i, asOf: '2026-11-16' })!;
    expect(first.targetKcal).toBe(1500);
    expect(next.targetKcal).toBe(1500);
    expect(first.deficitKcal).toBe(1200);
    expect(next.deficitKcal).toBe(900);
    expect(first.fatChangeKg).toBeNull();
    expect(next.fatChangeKg).toBeCloseTo(-0.7);
    expect(first.decision).toBe('keep');
  });

  it('uses the actual prescription instead of replacing it with the median of parameter scenarios', () => {
    const r = weeklyModelReview({ ...inputs(), prescribedKcal: Array<number>(7).fill(1650) })!;
    expect(r.targetKcal).toBe(1650);
    expect(r.deficitKcal).toBe(1050);
    expect(weeklyModelReview({ ...inputs(), prescribedKcal: [null, 1500] })!.targetKcal).toBeNull();
  });

  it('keeps the recommendation provisional when intake or weight evidence is insufficient', () => {
    const r = weeklyModelReview({ ...inputs(), foodDaysPrevious7: 0 })!;
    expect(r.decision).toBe('provisional');
    expect(r.reason).toBe('needsEvidence');
    expect(r.targetKcal).toBe(1500);
    expect(r.evidence.enoughInputs).toBe(false);
  });

  it('cannot report an unavailable old forecast as a supported recommendation', () => {
    const i = inputs();
    delete i.forecast.asPrescribed.tdee;
    expect(weeklyModelReview(i)!.reason).toBe('missingForecast');
    delete i.forecast.asPrescribed.skeletalMuscle;
    expect(weeklyModelReview(i)!.muscleBudget?.status).toBe('unavailable');
  });

  it('checks the original whole-cut budget through the horizon, not only the next seven days', () => {
    const i = inputs();
    i.forecast.asPrescribed.skeletalMuscle = bands([
      ...Array<number>(20).fill(29.5),
      ...Array<number>(8).fill(28.4),
    ]);
    const r = weeklyModelReview(i)!;
    expect(r.decision).toBe('review');
    expect(r.reason).toBe('muscleBudget');
    expect(r.muscleBudget?.floorKg).toBe(28.5);
    expect(weeklyModelReview({ ...i, asOf: '2026-11-23' })!.muscleBudget?.floorKg).toBe(28.5);
  });

  it('does not substitute the central path for missing lower-scenario evidence', () => {
    const i = inputs();
    i.forecast.asPrescribed.skeletalMuscle!.p10 = [];
    expect(weeklyModelReview(i)!.muscleBudget?.status).toBe('unavailable');
  });

  it('requires the full remaining trajectory, and reads a re-plan digest from its own day zero', () => {
    const i = inputs();
    i.forecast.fromDay = 7;
    i.forecast.asPrescribed.inEnergy = bands([1800, ...Array<number>(20).fill(1500)]);
    i.forecast.asPrescribed.tdee = bands(Array<number>(21).fill(2400));
    i.forecast.asPrescribed.skeletalMuscle = bands(Array<number>(20).fill(29));
    const r = weeklyModelReview({ ...i, asOf: '2026-11-16' })!;
    expect(r.targetKcal).toBeCloseTo((1800 + 6 * 1500) / 7);
    expect(r.fatChangeKg).toBeNull();
    expect(r.muscleBudget?.status).toBe('unavailable');
    expect(r.decision).toBe('provisional');
  });

  it('reports pending changes without changing the currently adopted target', () => {
    const r = weeklyModelReview({ ...inputs(), proposalPending: true })!;
    expect(r.decision).toBe('changeReady');
    expect(r.targetKcal).toBe(1500);
    expect(weeklyModelReview({ ...inputs(), proposalPending: true, reviewRequired: true })!.decision).toBe(
      'review',
    );
  });

  it('handles a partial final week and returns no recommendation outside the plan', () => {
    const i = { ...inputs(), asOf: '2026-12-04' };
    const r = weeklyModelReview(i)!;
    expect(r.days).toBe(3);
    expect(r.to).toBe('2026-12-06');
    expect(r.targetKcal).toBe(1500);
    expect(weeklyModelReview({ ...i, asOf: '2026-12-07' })).toBeNull();
  });
});
