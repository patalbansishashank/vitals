import { describe, expect, it, vi } from 'vitest';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import type { PlannerRequest } from '../types';
import { declaredImprovementFamily, searchBaselineImprovement } from '../baselineImprovement';
import { compileSchedule } from '../../../core/compileSchedule';
import { resolveProfile } from '../../../core/resolveProfile';
import { EnginePlanModel } from '../model';
import { mergeDay } from '../dayMath';

const startDate = '2026-11-06';
const rt: DayTemplate = {
  id: 'rt', label: 'reported lifting day', energy: { kind: 'kcal', kcal: 1500 },
  macros: { protein: { unit: 'g', value: 125 }, fat: { unit: 'g', value: 30 }, carbs: { unit: 'remainder' }, fibre: { unit: 'g', value: 20 } },
  steps: 15312, stepsScope: 'totalDay', sleep: { hours: 6.86 },
  exercise: [{ kind: 'resistance', durationMin: 45, startH: 18, met: 3.5, style: 'general', rir: 2, loadPct1RM: 65 }],
};
const rest: DayTemplate = { ...rt, id: 'rest', exercise: [] };
const baseline: Schedule = { schemaVersion: 1, startDate, horizonDays: 15, programs: [rt, rest], days: Array.from({ length: 15 }, (_, d) => ({ program: d % 7 < 3 ? 0 : 1 })) };
const profile = {
  schemaVersion: 1 as const,
  body: { sex: 'male' as const, ageYears: 28, heightCm: 166, weightKg: 74.8, knownBodyFatPct: 30.7 },
  habits: { sessionsPerWeek: 3, trainingHistory: 'lt1y' as const, typicalSteps: 15312 }, startDate,
};
const request: PlannerRequest = { profile, startDate, horizonDays: 15, goals: [{ metric: 'fatMass', direction: 'minimise' }] };
const effective = (s: Schedule, d: number) => mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override);
const sum = (s: Schedule, lo: number, hi: number, metric: 'energy' | 'protein' | 'fat') => Array.from({ length: hi - lo }, (_, i) => effective(s, lo + i)).reduce((v, day) => v + (metric === 'energy' ? (day.energy.kind === 'kcal' ? day.energy.kcal : NaN) : (day.macros[metric].unit === 'g' ? day.macros[metric].value : NaN)), 0);

describe('independent baseline improvement validation', () => {
  it('retains the exact original and compares each declared intervention to an existing comparator', () => {
    const family = declaredImprovementFamily(baseline, 149);
    expect(family[0]).toMatchObject({ id: 'baseline', comparatorId: 'baseline' });
    expect(family[0]!.schedule).toBe(baseline);
    for (const candidate of family) {
      expect(family.some((member) => member.id === candidate.comparatorId)).toBe(true);
      for (let d = 0; d < 15; d++) {
        expect(effective(candidate.schedule, d).exercise).toEqual(effective(baseline, d).exercise);
        expect(effective(candidate.schedule, d).steps).toEqual(15312);
        expect(effective(candidate.schedule, d).sleep).toEqual({ hours: 6.86 });
      }
    }
  });

  it('conserves each seven-day block and the one-day tail, including compiled net carbohydrate and fibre against matched controls', () => {
    const family = declaredImprovementFamily(baseline, 149);
    const rp = resolveProfile(profile);
    for (const candidate of family) {
      const comparator = family.find((member) => member.id === candidate.comparatorId)!.schedule;
      for (const lo of [0, 7, 14]) {
        const hi = Math.min(lo + 7, 15);
        expect(sum(candidate.schedule, lo, hi, 'energy')).toBeCloseTo(sum(baseline, lo, hi, 'energy'), 8);
        if (candidate.family === 'energyCycle' || candidate.family === 'lowCarbRest' || candidate.family === 'mealTiming') {
          for (const metric of ['protein', 'fat'] as const) expect(sum(candidate.schedule, lo, hi, metric)).toBeCloseTo(sum(comparator, lo, hi, metric), 8);
          const a = compileSchedule(candidate.schedule, rp).days.slice(lo, hi);
          const b = compileSchedule(comparator, rp).days.slice(lo, hi);
          for (const field of ['energyKcal', 'proteinG', 'fatG', 'carbG', 'fibreG'] as const) {
            expect(a.reduce((n, day) => n + day[field], 0)).toBeCloseTo(b.reduce((n, day) => n + day[field], 0), 5);
          }
        }
      }
    }
  });

  it('rejects partial nested macro overrides without throwing', () => {
    const malformed = structuredClone(baseline);
    malformed.days[0]!.override = { macros: { fat: { unit: 'g', value: 35 } } } as never;
    expect(() => declaredImprovementFamily(malformed)).not.toThrow();
    expect(declaredImprovementFamily(malformed)).toEqual([]);
  });

  it('accepts an equivalent partial nested macro override through canonical day merge', () => {
    const equivalent = structuredClone(baseline);
    equivalent.days[0]!.override = { macros: { fat: { unit: 'g', value: 30 } } } as never;
    expect(() => declaredImprovementFamily(equivalent)).not.toThrow();
    const family = declaredImprovementFamily(equivalent);
    expect(family.length).toBeGreaterThan(0);
    for (let d = 0; d < 15; d++) expect(effective(equivalent, d).macros).toEqual(effective(baseline, d).macros);
  });

  it('runs matched-energy high-carb timing and keeps glycogen/water separate from skeletal muscle', async () => {
    const result = await searchBaselineImprovement({ request, baseline, auditMembers: 2, includeTrainingChanges: false, seed: 'independent-validation' });
    expect(result.status).toBe('complete');
    const original = result.candidates.find((c) => c.id === 'baseline')!;
    const timed = result.candidates.find((c) => c.id === 'timing-rt')!;
    expect(original.schedule).toBe(baseline);
    expect(timed.vsBaseline?.draws).toBe(2);
    expect(timed.vsMatchedMacroControl?.draws).toBe(2);
    expect(timed.conservation.matchedCompiledWeekly).toBe(true);
    expect(timed.conservation.compiledWeeklyDeltaFromComparator.every((w) => Object.values(w).every((x) => Math.abs(x) < 1e-6))).toBe(true);
    expect(timed.nominal.skeletalMuscleChangeKg).not.toBeNull();
    expect(timed.nominal.glycogenWaterKg).not.toBeNull();
    expect(timed.nominal.scaleWeightKg).not.toBeNull();
    // A change in scale mass or glycogen water is not counted as a skeletal-muscle change.
    expect(timed.vsBaseline?.meanMuscleDeltaKg).toBeCloseTo((timed.nominal.skeletalMuscleKg ?? NaN) - (original.nominal.skeletalMuscleKg ?? NaN), 1);
    expect(result.verdict === 'diagnosticModelImprovementFound').toBe(result.candidates.some((c) => c.id !== 'baseline' && c.vsBaseline?.dominatesComparator && (c.vsMatchedMacroControl === undefined || (c.conservation.matchedCompiledWeekly && c.vsMatchedMacroControl.dominatesComparator))));
  }, 120_000);

  it('does not turn an early-aborted nominal trajectory into an available endpoint', async () => {
    const original = EnginePlanModel.prototype.simulate;
    const spy = vi.spyOn(EnginePlanModel.prototype, 'simulate').mockImplementation(function (this: EnginePlanModel, schedule, draw) {
      const sim = original.call(this, schedule, draw);
      if (draw < 0) return { ...sim, meta: { ...sim.meta, aborted: { day: 0, bound: 'synthetic-adversarial', magnitude: 1 } } };
      return sim;
    });
    try {
      const result = await searchBaselineImprovement({ request, baseline, auditMembers: 1, includeTrainingChanges: false, seed: 'adversarial-incomplete' });
      expect(result.candidates.every((c) => c.nominal.status === 'unavailable')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  }, 120_000);

  it('does not turn a one-day truncated draw into a valid paired comparison', async () => {
    const original = EnginePlanModel.prototype.simulate;
    const spy = vi.spyOn(EnginePlanModel.prototype, 'simulate').mockImplementation(function (this: EnginePlanModel, schedule, draw) {
      const sim = original.call(this, schedule, draw);
      if (draw < 0) return sim;
      return { ...sim, daily: { ...sim.daily, fatMass: sim.daily.fatMass?.slice(0, 1), skeletalMuscle: sim.daily.skeletalMuscle?.slice(0, 1) } };
    });
    try {
      const result = await searchBaselineImprovement({ request, baseline, auditMembers: 1, includeTrainingChanges: false, seed: 'adversarial-truncated' });
      expect(result.candidates.every((c) => c.vsBaseline?.validDraws === 0 && c.vsBaseline.dominatesComparator === false)).toBe(true);
      expect(result.verdict).toBe('noPairedImprovementFound');
    } finally {
      spy.mockRestore();
    }
  }, 120_000);

  it('requires every paired draw to be non-worse even when the mean looks beneficial', async () => {
    const original = EnginePlanModel.prototype.simulate;
    const spy = vi.spyOn(EnginePlanModel.prototype, 'simulate').mockImplementation(function (this: EnginePlanModel, schedule, draw) {
      const sim = original.call(this, schedule, draw);
      if (draw < 0 || schedule.days[0]?.override?.meals?.meals?.[0]?.clockH !== 9) return sim;
      const control = original.call(this, baseline, draw);
      const fatMass = Float32Array.from(sim.daily.fatMass!);
      const skeletalMuscle = Float32Array.from(sim.daily.skeletalMuscle!);
      fatMass[fatMass.length - 1] = control.daily.fatMass![control.daily.fatMass!.length - 1]! - 0.2;
      skeletalMuscle[skeletalMuscle.length - 1] = control.daily.skeletalMuscle![control.daily.skeletalMuscle!.length - 1]! + (draw === 0 ? 0.5 : -0.1);
      return { ...sim, daily: { ...sim.daily, fatMass, skeletalMuscle } };
    });
    try {
      const result = await searchBaselineImprovement({ request, baseline, auditMembers: 2, includeTrainingChanges: false, seed: 'adversarial-mean' });
      const timed = result.candidates.find((c) => c.id === 'timing-rt')!;
      expect(timed.vsBaseline?.meanFatDeltaKg).toBeLessThan(0);
      expect(timed.vsBaseline?.meanMuscleDeltaKg).toBeGreaterThan(0);
      expect(timed.vsBaseline?.allMembersNonWorse).toBe(false);
      expect(timed.vsBaseline?.dominatesComparator).toBe(false);
    } finally {
      spy.mockRestore();
    }
  }, 120_000);
});
