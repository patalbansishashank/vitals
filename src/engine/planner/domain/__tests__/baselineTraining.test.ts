// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PlannerRequestV2 } from '../types';
import type { DayTemplate, Schedule, ResistanceSession } from '../../../types/schedule';
import { mergeDay } from '../dayMath';
import { generateBaselineTrainingVariants } from '../baselineTraining';

const rt: DayTemplate = {
  id: 'rt', label: 'reported session, dose uncertain',
  energy: { kind: 'kcal', kcal: 2100 },
  macros: { protein: { unit: 'g', value: 135 }, fat: { unit: 'g', value: 65 }, carbs: { unit: 'remainder' } },
  steps: 8000, sleep: { hours: 7.5 },
  exercise: [
    { kind: 'cardio', modality: 'cycle', startH: 17, durationMin: 15, met: 4.5 },
    { kind: 'resistance', startH: 18, durationMin: 45, style: 'general' },
  ],
};
const rest: DayTemplate = { ...rt, id: 'rest', label: 'rest', exercise: rt.exercise!.slice(0, 1) };
const baseline: Schedule = {
  schemaVersion: 1, startDate: '2026-10-05', horizonDays: 28,
  programs: [rt, rest],
  days: Array.from({ length: 28 }, (_, d) => ({ program: [0, 2, 4].includes(d % 7) ? 0 : 1 })),
};
const request: PlannerRequestV2 = {
  profile: {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 27, heightCm: 178, weightKg: 80, trainingYears: 0.1 },
    habits: { sessionsPerWeek: 3, trainingHistory: 'lt1y' },
    startDate: baseline.startDate,
  },
  goals: [{ metric: 'skeletalMuscle', direction: 'maximise' }],
  horizonDays: baseline.horizonDays,
  startDate: baseline.startDate,
  constraints: { trainingDaysPerWeek: { min: 3, max: 3 }, maxSessionMin: 60 },
  training: { owned: ['dumbbell', 'bench'], access: [], refused: [], liked: [], injuries: [], skill: 2, loadsKg: { dumbbell: [10] }, purchaseAllowance: { maxPriceTier: 0, maxItems: 0 } },
};
const day = (s: Schedule, d: number) => mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override);
const resistance = (s: Schedule, d: number): ResistanceSession[] => (day(s, d).exercise ?? []).filter((x): x is ResistanceSession => x.kind === 'resistance');

describe('baseline training variants', () => {
  it('returns materialized, time-capped exercises on the same days while retaining every other baseline input', async () => {
    const result = await generateBaselineTrainingVariants(request, baseline);
    expect(result.variants.length).toBeGreaterThan(0);
    expect(result.variants.length).toBeLessThanOrEqual(2);
    for (const variant of result.variants) {
      expect(variant.provenance).toBe('proposedEquipmentComposedTraining');
      for (let d = 0; d < baseline.horizonDays; d++) {
        const before = day(baseline, d), after = day(variant.schedule, d);
        expect(after.energy).toEqual(before.energy);
        expect(after.macros).toEqual(before.macros);
        expect(after.steps).toBe(before.steps);
        expect(after.sleep).toEqual(before.sleep);
        expect(after.exercise?.filter((x) => x.kind === 'cardio')).toEqual(before.exercise?.filter((x) => x.kind === 'cardio'));
        expect(resistance(variant.schedule, d).length).toBe(resistance(baseline, d).length);
        expect(variant.trainingMinutesByDay[d]).toBeLessThanOrEqual(60);
        for (const s of resistance(variant.schedule, d)) {
          expect(s.groups?.length).toBeGreaterThan(0);
          expect(s.rir).toBeGreaterThanOrEqual(0);
          expect(s.rir).toBeLessThanOrEqual(3);
        }
      }
      for (const [week, dose] of variant.countedSetsByRegionByWeek.entries()) {
        const cap = 10 + 2 * week;
        for (const delivered of Object.values(dose)) expect(delivered).toBeLessThanOrEqual(cap + 0.01);
      }
      expect(variant.unfulfilledTargets.every((x) => x.delivered < x.target)).toBe(true);
      expect(variant.doseTradeoffsVsBalanced.every((x) => x.delivered < x.balanced)).toBe(true);
    }
  });

  it('states why concrete training cannot be generated without equipment information', async () => {
    const result = await generateBaselineTrainingVariants({ ...request, training: undefined } as PlannerRequestV2, baseline);
    expect(result.variants).toEqual([]);
    expect(result.unavailableReason).toMatch(/equipment\/profile is absent/);
  });

  it('keeps the normal per-session dose in a partial final week', async () => {
    const short = { ...baseline, horizonDays: 15, days: baseline.days.slice(0, 15) };
    const result = await generateBaselineTrainingVariants({ ...request, horizonDays: 15 }, short);
    expect(result.variants.length).toBeGreaterThan(0);
    for (const variant of result.variants) {
      expect(variant.trainingMinutesByDay[14]).toBeGreaterThan(0);
      expect(variant.trainingMinutesByDay[14]).toBeLessThanOrEqual(60);
      expect(variant.countedSetsByRegionByWeek[2]?.chest ?? 0).toBeLessThanOrEqual(4);
    }
  });
});
