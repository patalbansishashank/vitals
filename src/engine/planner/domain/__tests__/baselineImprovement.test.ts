import { describe, expect, it } from 'vitest';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import type { SimulationResult } from '../../../types/result';
import { crossImprovementFamily, declaredImprovementFamily, deriveEnergyCycleBounds, diagnosticRanking, improvementEndpoint, searchBaselineImprovement, type ImprovementCandidate, type PairedComparison } from '../baselineImprovement';

const rt: DayTemplate = {
  id: 'rt', label: 'actual resistance day', energy: { kind: 'kcal', kcal: 1500 },
  macros: { protein: { unit: 'g', value: 125 }, fat: { unit: 'g', value: 30 }, carbs: { unit: 'remainder' } },
  steps: 15312, stepsScope: 'totalDay', sleep: { hours: 6.86 },
  exercise: [{ kind: 'resistance', durationMin: 45, startH: 18, met: 3.5, style: 'general' }],
};
const rest: DayTemplate = { ...rt, id: 'rest', label: 'actual non-resistance day', exercise: [] };
const baseline: Schedule = {
  schemaVersion: 1, startDate: '2026-11-06', horizonDays: 15,
  programs: [rt, rest],
  days: Array.from({ length: 15 }, (_, d) => ({ program: d % 7 < 3 ? 0 : 1 })),
};
const day = (s: Schedule, d: number) => ({ ...s.programs[s.days[d]!.program]!, ...s.days[d]!.override });
const sum = (s: Schedule, from: number, to: number, field: 'energy' | 'protein' | 'fat') => {
  let total = 0;
  for (let d = from; d < to; d++) {
    const p = day(s, d);
    if (field === 'energy') total += p.energy.kind === 'kcal' ? p.energy.kcal : NaN;
    else {
      const x = p.macros[field];
      total += x.unit === 'g' ? x.value : NaN;
    }
  }
  return total;
};

describe('baseline-anchored improvement family', () => {
  it('contains the exact baseline and changes only nutrition fields', () => {
    const family = declaredImprovementFamily(baseline, 149);
    expect(family[0]!.schedule).toBe(baseline);
    expect(family.map((c) => c.id)).toContain('p1-e400-lowcarb-rest');
    expect(family.length).toBeLessThanOrEqual(24);
    for (const candidate of family) for (let d = 0; d < baseline.horizonDays; d++) {
      const before = day(baseline, d), after = day(candidate.schedule, d);
      expect(after.exercise).toEqual(before.exercise);
      expect(after.steps).toBe(before.steps);
      expect(after.sleep).toEqual(before.sleep);
      expect(after.habitualTraining).toBe(before.habitualTraining);
      expect(after.energy.kind === 'kcal' ? after.energy.kcal : 0).toBeGreaterThanOrEqual(1200);
    }
  });

  it('keeps every full and partial calendar week calorie matched, with explicit macro controls', () => {
    const family = declaredImprovementFamily(baseline, 149);
    const control = family.find((c) => c.id === 'p0-e0-flat-macro-control')!.schedule;
    const lowcarb = family.find((c) => c.id === 'p0-e0-lowcarb-rest')!.schedule;
    for (const candidate of family) for (let from = 0; from < baseline.horizonDays; from += 7) {
      const to = Math.min(from + 7, baseline.horizonDays);
      expect(sum(candidate.schedule, from, to, 'energy')).toBeCloseTo(sum(baseline, from, to, 'energy'), 8);
      const comparator = family.find((c) => c.id === candidate.comparatorId)!.schedule;
      if (candidate.family !== 'higherProtein') expect(sum(candidate.schedule, from, to, 'protein')).toBeCloseTo(sum(comparator, from, to, 'protein'), 8);
      if (candidate.family !== 'flatMacroControl') expect(sum(candidate.schedule, from, to, 'fat')).toBeCloseTo(sum(comparator, from, to, 'fat'), 8);
    }
    expect(day(lowcarb, 4).macros.fat).toEqual({ unit: 'g', value: expect.closeTo(88.89, 1) });
    expect(family.find((c) => c.id === 'higher-protein-steady')!.comparatorId).toBe('baseline');
    expect(sum(control, 0, 7, 'fat')).toBeCloseTo(sum(lowcarb, 0, 7, 'fat'), 8);
  });

  it('reports an unsupported baseline without simulation when intake is not fixed', async () => {
    const changed = structuredClone(baseline);
    changed.days[1]!.override = { energy: { kind: 'kcal', kcal: 1400 } };
    expect(declaredImprovementFamily(changed)).toEqual([]);
    // The request is not used until after the unsupported-baseline guard.
    const result = await searchBaselineImprovement({ baseline: changed, request: { profile: {} as never, goals: [], horizonDays: 15 } });
    expect(result.status).toBe('unsupportedBaseline');
    expect(result.evaluatedNominal).toBe(0);
  });

  it('accepts a partial day macro override that leaves the fixed intake unchanged', () => {
    const changed = structuredClone(baseline);
    changed.days[1]!.override = { macros: { fat: { unit: 'g', value: 30 } } as never };
    expect(declaredImprovementFamily(changed, 149).length).toBeGreaterThan(0);
  });

  it('crosses every nutrition row with both training variants and retains independent control links', () => {
    const nutrition = declaredImprovementFamily(baseline, 149);
    const training = (['balanced-rt', 'progressed-rt'] as const).map((id, index) => {
      const schedule = structuredClone(baseline);
      for (let d = 0; d < schedule.horizonDays; d++) if (day(baseline, d).exercise?.some((e) => e.kind === 'resistance')) {
        schedule.days[d]!.override = { exercise: [{ kind: 'resistance', durationMin: 50 + 5 * index, startH: 18, met: 3.5, style: 'general' }] };
      }
      return { id, schedule, provenance: 'proposedEquipmentComposedTraining' as const, trainingMinutesByDay: [], countedSetsByRegionByWeek: [], unfulfilledTargets: [], doseTradeoffsVsBalanced: [], unavailableReason: null };
    });
    const crossed = crossImprovementFamily(nutrition, training);
    expect(crossed).toHaveLength(nutrition.length * 3);
    expect(crossed[0]!.schedule).toBe(baseline);
    for (const c of crossed.filter((x) => x.trainingVariantId)) {
      expect(c.exerciseControlId).toBe(c.id.split('__')[1]);
      const source = nutrition.find((x) => x.id === c.exerciseControlId)!;
      for (let d = 0; d < baseline.horizonDays; d++) {
        expect(day(c.schedule, d).macros).toEqual(day(source.schedule, d).macros);
        expect(day(c.schedule, d).energy).toEqual(day(source.schedule, d).energy);
        expect(day(c.schedule, d).steps).toBe(day(baseline, d).steps);
        expect(day(c.schedule, d).sleep).toEqual(day(baseline, d).sleep);
      }
    }
    const joint = crossed.find((x) => x.id === 'training-progressed-rt__p1-e400-lowcarb-rest')!;
    expect(joint.nutritionControlId).toBe('training-progressed-rt__p1-e400-flat-macro-control');
    expect(joint.exerciseControlId).toBe('p1-e400-lowcarb-rest');
  });

  it('derives the full high-day boundary from 10500 weekly kcal and keeps the partial week flat', () => {
    const bounds = deriveEnergyCycleBounds(baseline)!;
    expect(bounds.sourceDailyKcal).toBe(1500);
    expect(bounds.maxShiftKcal).toBe(400);
    expect(bounds.shiftsKcal).toEqual([0, 200, 400]);
    expect(bounds.mixedWeekBounds).toEqual([
      { week: 0, resistanceDays: 3, otherDays: 4, maxShiftKcal: 400 },
      { week: 1, resistanceDays: 3, otherDays: 4, maxShiftKcal: 400 },
    ]);
    expect(bounds.dayTargets.find((x) => x.shiftKcal === 400)).toEqual({ shiftKcal: 400, resistanceKcal: 1900, otherKcalMin: 1200, otherKcalMax: 1200 });
    const full = declaredImprovementFamily(baseline, 149).find((c) => c.id === 'p0-e400-balanced')!.schedule;
    expect(sum(full, 0, 7, 'energy')).toBe(10500);
    expect(day(full, 0).energy).toEqual({ kind: 'kcal', kcal: 1900 });
    expect(day(full, 3).energy).toEqual({ kind: 'kcal', kcal: 1200 });
    expect(day(full, 14).energy).toEqual({ kind: 'kcal', kcal: 1500 });
  });

  it('rejects an aborted, short, or unsupported end trajectory instead of using its last finite value', () => {
    const sim = {
      meta: { nDays: 2, outputStatus: {} },
      initial: { fatMass: 24, skeletalMuscle: 27 },
      daily: { fatMass: Float32Array.from([23, 22]), skeletalMuscle: Float32Array.from([27, 27]) },
    } as unknown as SimulationResult;
    expect(improvementEndpoint(sim, 2).status).toBe('available');
    expect(improvementEndpoint({ ...sim, meta: { ...sim.meta, aborted: { day: 0, bound: 'HC-E3', magnitude: 1 } } }, 2).status).toBe('unavailable');
    expect(improvementEndpoint(sim, 3).status).toBe('unavailable');
    expect(improvementEndpoint({ ...sim, meta: { ...sim.meta, outputStatus: { skeletalMuscle: { status: 'unavailable', reasonCode: 'test', fromDay: 1 } } } }, 2).status).toBe('unavailable');
    expect(improvementEndpoint({ ...sim, daily: { ...sim.daily, fatMass: Float32Array.from([Number.NaN, 22]) } }, 2).status).toBe('unavailable');
  });

  it('accepts a robust actual-baseline gain even when one component loses to its matched control', () => {
    const paired = (fat: number, muscle: number, dominatesComparator: boolean): PairedComparison => ({ draws: 32, validDraws: 32, meanFatDeltaKg: fat, meanMuscleDeltaKg: muscle, fatDeltaRangeKg: [fat, fat], muscleDeltaRangeKg: [muscle, muscle], allMembersNonWorse: true, membersWithinMuscleBudget: 32, dominatesComparator });
    const row = (id: string, fat: number, muscle: number, controlDominates: boolean) => ({ id, nominal: { status: 'available' }, vsBaseline: paired(fat, muscle, true), vsMatchedMacroControl: paired(0.01, -0.01, controlDominates), conservation: { weeklyEnergyKcalDelta: [0], matchedCompiledWeekly: true } }) as ImprovementCandidate;
    const muscle = row('combined-muscle', -0.2, 0.3, false);
    const fat = row('combined-fat', -0.4, 0.1, true);
    const ranked = diagnosticRanking([muscle, fat], 32, 26);
    expect(ranked.verdict).toBe('diagnosticModelImprovementFound');
    expect(ranked.baselineDominatorIds).toEqual(['combined-fat', 'combined-muscle']);
    expect(ranked.bestFatLossDiagnosticId).toBe('combined-fat');
    expect(ranked.bestMuscleWithoutLessFatDiagnosticId).toBe('combined-muscle');
    expect(ranked.paretoFrontierIds).toEqual(['combined-fat', 'combined-muscle']);
  });
});
