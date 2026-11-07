// @vitest-environment node
/** A2-020/A2-022: elapsed, independently covered exposure windows and the shared provisional review policy. */
import { describe, expect, it } from 'vitest';
import type { DayInput } from '../../types/inputs';
import { EA_EXERCISE_SCOPE, EA_EXPOSURE_COVERAGE, type RunOptions } from '../../types/result';
import { SAFETY_TRACE_KEYS } from '../../core/loop';
import { calendarEaSummary, eaExposureReview, repeatedCalendarEaPolicy } from './constraints';
import { EXPOSURE_RING_VERSION } from './state';
import { person, prog, runScenario, sched } from './testkit';
import { calendarEnergyAvailability, dailyEa, repeatedCalendarEaReview, type EaLedgerDay } from '@/living/energyAvailability';
import { rawEnergyAvailability } from '@/living/wellbeing';
import { addDays } from '@/living/dates';

const START = '2026-10-05';
const MAN = person({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 78 });
const low = prog('low', 1050, { proteinG: 90, carbsG: 100 });

function run(patch?: (days: DayInput[]) => void, options?: RunOptions, ffmKg: (d: number) => number = () => 60) {
  return runScenario({
    person: MAN, schedule: sched(28, [low], () => 0),
    plant: { scaleKg: () => 78, ffmKg, exNet: () => 0 },
    patchDays: (days) => {
      for (const d of days) { d.coverage = { energy: 'complete', exercise: 'confirmedZero' }; d.exerciseCoverageScope = 'actualDay'; }
      patch?.(days);
    }, options,
  }).res;
}

const samples = (length: number, unknownDay = -1) => Array.from({ length }, (_, day) => ({
  day, ea7: 20, coverage7: day < 6 ? day + 1 : day >= unknownDay && day <= unknownDay + 6 ? 6 : 7,
}));
const ledger = (n = 28): EaLedgerDay[] => Array.from({ length: n }, (_, day) => ({
  date: addDays(START, day), eiKcal: 1050, eiCoverage: 'complete', eeeNetKcal: 0,
  exerciseCoverage: 'confirmedZero', exerciseScope: 'actualDay', knownEeeNetKcal: 0,
  ffmKg: 60, ffmBasis: 'model', fastDay: day % 7 === 1,
}));

describe('A2-020: consecutive fully covered elapsed calendar windows', () => {
  it('one day and exactly 14 eligible windows do not review; the 15th first ends on plan day 20', () => {
    expect(repeatedCalendarEaPolicy(samples(1))).toMatchObject({ needed: false, consecutiveEligibleWindows: 0 });
    expect(repeatedCalendarEaPolicy(samples(20))).toMatchObject({ needed: false, consecutiveEligibleWindows: 14 });
    expect(repeatedCalendarEaPolicy(samples(21))).toEqual({ needed: true, consecutiveEligibleWindows: 15, reasonCodes: ['repeatedCalendarEaBelowReference'] });
    const t = run().safety;
    expect(calendarEaSummary(t, 5)?.calendarRunBelowReference).toBe(0);
    expect(eaExposureReview(calendarEaSummary(t, 19)).status).toBe('none');
    expect(eaExposureReview(calendarEaSummary(t, 20))).toEqual({ status: 'review', reasons: ['repeatedCalendarEaBelowReference'], probability: null, newFastingProhibition: false });
    expect(calendarEaSummary(t)?.calendarRunBelowReference).toBe(22);
  });

  it.each(['intake', 'exercise', 'ffm'] as const)('an earlier unknown %s resets the run despite complete current coverage7', (channel) => {
    const t = run((days) => {
      if (channel !== 'ffm') days[15]!.coverage = { energy: channel === 'intake' ? 'unknown' : 'complete', exercise: channel === 'exercise' ? 'unknown' : 'confirmedZero' };
    }, undefined, (d) => channel === 'ffm' && d === 15 ? 0 : 60).safety;
    expect(t.eaCoverage7![27]).toBe(7);
    expect(t.calendarEa7![27]).toBeCloseTo(17.5, 6);
    expect(calendarEaSummary(t)?.calendarRunBelowReference).toBe(6);
    expect(eaExposureReview(calendarEaSummary(t)).status).toBe('none');
    // Incomplete known-day mean 17.5 cannot establish persistence through day 21.
    expect(t.eaCoverage7![21]).toBe(6);
    expect(eaExposureReview(calendarEaSummary(t, 21)).status).toBe('incomplete');
  });

  it('a missing evaluation day, an unknown value or a reference-or-higher window resets persistence', () => {
    expect(repeatedCalendarEaPolicy(samples(28).filter((d) => d.day !== 15)).consecutiveEligibleWindows).toBe(12);
    for (const ea7 of [null, Number.NaN, 30, 40]) {
      const xs: Array<{ day: number; ea7: number | null; coverage7: number }> = samples(28);
      xs[15]!.ea7 = ea7;
      expect(repeatedCalendarEaPolicy(xs).consecutiveEligibleWindows).toBe(12);
    }
  });

  it('independent current concerns stay Review above the reference, with no new fasting prohibition', () => {
    const summary = calendarEaSummary(run().safety)!;
    const high = { ...summary, calendarEa7: 45, calendarRunBelowReference: 0 };
    for (const concern of ['menstrualChange', 'persistentFatigue', 'performanceDecline', 'injury'] as const) {
      expect(eaExposureReview(high, [concern])).toEqual({ status: 'review', reasons: [`concern:${concern}`], probability: null, newFastingProhibition: false });
    }
  });

  it('the same shared policy evaluates living windows without a weigh-in and retains the FFM basis', () => {
    const l = ledger();
    expect(repeatedCalendarEaReview(l, addDays(START, 19))).toMatchObject({ needed: false, consecutiveEligibleWindows: 14, version: 2 });
    expect(repeatedCalendarEaReview(l, addDays(START, 20))).toMatchObject({ needed: true, consecutiveEligibleWindows: 15, reasonCodes: ['repeatedCalendarEaBelowReference'] });
    expect(calendarEnergyAvailability(l, addDays(START, 27), 28)).toMatchObject({ covered: 28, ea: { value: 17.5, status: 'scenario', reasonCode: 'modelFfm' } });
    l[15]!.exerciseCoverage = 'unknown';
    l[15]!.eeeNetKcal = null;
    expect(repeatedCalendarEaReview(l, addDays(START, 27))).toMatchObject({ needed: false, consecutiveEligibleWindows: 6 });
  });
});

describe('A2-022: independent intake/exercise knowledge in core and living', () => {
  it.each(['unknown', 'partial'] as const)('complete intake with %s exercise has no observed daily or calendar EA', (exercise) => {
    const t = run((days) => { for (const d of days) { d.coverage = { energy: 'complete', exercise }; d.exerciseCoverageScope = 'unknown'; } }).safety;
    expect(t.eaIntakeCoverage![27]).toBe(EA_EXPOSURE_COVERAGE.complete);
    expect(t.eaExerciseCoverage![27]).toBe(EA_EXPOSURE_COVERAGE[exercise]);
    expect(t.eaExerciseScope![27]).toBe(EA_EXERCISE_SCOPE.unknown);
    expect(t.eaCoverage7![27]).toBe(0);
    expect(t.eaCoverage28![27]).toBe(0);
    expect(Number.isNaN(t.eaRawDaily![27])).toBe(true);
    expect(Number.isNaN(t.eeeNetKcal![27])).toBe(true);
    expect(eaExposureReview(calendarEaSummary(t)).status).toBe('incomplete');
    const d = { ...ledger(1)[0]!, exerciseCoverage: exercise, eeeNetKcal: 0 };
    expect(dailyEa(d)).toBeNull();
    expect(calendarEnergyAvailability([d], START, 7).ea.reasonCode).toBe('exerciseIncomplete');
  });

  it('2100 kcal with an unlogged prescribed 60-minute cardio stays unknown through daily/calendar7/calendar28', () => {
    const prescription = prog('cardio', 2100, { proteinG: 100, carbsG: 200, exercise: [{ kind: 'cardio', modality: 'run', startH: 17, durationMin: 60 }] });
    const schedule = sched(28, [prescription], () => 0);
    const before = JSON.stringify(schedule);
    const t = runScenario({ person: MAN, schedule,
      plant: { scaleKg: () => 78, ffmKg: () => 60, exNet: (_d, h) => h === 17 ? 450 : 0 },
      patchDays: (days) => { for (const d of days) d.coverage = { energy: 'complete', exercise: 'unknown' }; },
    }).res.safety;
    expect(JSON.stringify(schedule)).toBe(before);
    expect(t.eiKcal![27]).toBe(2100);
    expect(t.eaExerciseCoverage![27]).toBe(EA_EXPOSURE_COVERAGE.unknown);
    expect(Number.isNaN(t.eaRawDaily![27])).toBe(true);
    expect(t.eaCoverage7![27]).toBe(0);
    expect(t.eaCoverage28![27]).toBe(0);
    expect(eaExposureReview(calendarEaSummary(t)).status).toBe('incomplete');
  });

  it('absence of prescriptions/logs and energy-only coverage never imply actual exercise zero', () => {
    const t = run((days) => { for (const d of days) d.coverage = { energy: 'complete' }; }).safety;
    expect(t.eaExerciseCoverage![0]).toBe(EA_EXPOSURE_COVERAGE.unknown);
    expect(Number.isNaN(t.eaRawDaily![0])).toBe(true);
    const scenario = run((days) => { for (const d of days) { delete d.coverage; delete d.exerciseCoverageScope; } }).safety;
    expect(scenario.eaExerciseCoverage![0]).toBe(EA_EXPOSURE_COVERAGE.scenario);
    expect(scenario.eaExerciseScope![0]).toBe(EA_EXERCISE_SCOPE.prescribedScenario);
    expect(scenario.eaRawDaily![0]).toBeCloseTo(17.5, 6);
  });

  it('retains RMR-net exercise semantics, signed negative EA and independent scope', () => {
    const r = runScenario({ person: MAN, schedule: sched(7, [prog('zero', 0, { proteinG: 0, carbsG: 0 })], () => 0),
      plant: { scaleKg: () => 78, ffmKg: () => 60, exNet: (_d, h) => h === 17 ? 600 : 0 },
      patchDays: (days) => { for (const d of days) { d.coverage = { energy: 'confirmedZero', exercise: 'complete' }; d.exerciseCoverageScope = 'coveredSessions'; } },
    }).res.safety;
    expect(r.eeeNetKcal![6]).toBe(600);
    expect(r.eaRawDaily![6]).toBe(-10);
    expect(r.calendarEa7![6]).toBe(-10);
    expect(r.eaExerciseScope![6]).toBe(EA_EXERCISE_SCOPE.coveredSessions);
  });

  it('partial EI supplies a lower bound only with covered exercise; unknown extra exercise defeats it', () => {
    const d = { ...ledger(1)[0]!, eiKcal: 1200, eiCoverage: 'partial' as const, eeeNetKcal: 450, exerciseCoverage: 'complete' as const };
    expect(calendarEnergyAvailability([d], START, 1).lowerBound).toBeCloseTo(750 / 60, 8);
    const unknown = { ...d, exerciseCoverage: 'partial' as const, knownEeeNetKcal: 450 };
    expect(calendarEnergyAvailability([unknown], START, 1).lowerBound).toBeUndefined();
    expect(rawEnergyAvailability({ intakeKcal: 1200, intakeCoverage: 'partial', netSessionKcal: null, exerciseCoverage: 'partial', knownSessionKcal: 450, ffmKg: 60, ffmBasis: 'model' }).lowerBound).toBeUndefined();
    expect(JSON.stringify(calendarEnergyAvailability([unknown], START, 1))).not.toMatch(/Infinity|NaN/);
  });

  it.each([
    ['complete', 'complete'], ['complete', 'confirmedZero'], ['complete', 'unknown'], ['complete', 'partial'],
    ['partial', 'complete'], ['unknown', 'complete'],
  ] as const)('core and living agree for the same realised intake %s / exercise %s', (energy, exercise) => {
    const t = run((days) => { for (const d of days) { d.coverage = { energy, exercise }; d.exerciseCoverageScope = exercise === 'unknown' || exercise === 'partial' ? 'unknown' : 'actualDay'; } }).safety;
    const d = { ...ledger(1)[0]!, eiCoverage: energy, exerciseCoverage: exercise };
    const value = dailyEa(d);
    expect(Number.isFinite(t.eaRawDaily![0])).toBe(value !== null);
    expect(t.eaCoverage7![0]).toBe(value === null ? 0 : 1);
    if (value !== null) expect(t.eaRawDaily![0]).toBeCloseTo(value, 7);
  });

  it('a finite explicit exercise upper bound can support a partial-intake lower bound only', () => {
    const d = { ...ledger(1)[0]!, eiCoverage: 'partial' as const, eiKcal: 1200, exerciseCoverage: 'partial' as const, eeeNetKcal: null, knownEeeNetKcal: 100, exerciseUpperBoundKcal: 500 };
    const r = calendarEnergyAvailability([d], START, 1);
    expect(r.ea.value).toBeUndefined();
    expect(r.lowerBound).toBeCloseTo(700 / 60, 8);
    expect(dailyEa(d)).toBeNull();
    expect(repeatedCalendarEaReview([d], START).needed).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0])('non-finite or nonpositive FFM %s cannot turn into a low-exposure proof', (ffmKg) => {
    const d = { ...ledger(1)[0]!, ffmKg };
    expect(dailyEa(d)).toBeNull();
    expect(calendarEnergyAvailability([d], START, 1).ea.value).toBeUndefined();
    const t = run(undefined, undefined, () => ffmKg).safety;
    expect(t.eaCoverage7![27]).toBe(0);
    expect(Number.isNaN(t.eaRawDaily![27])).toBe(true);
    expect(eaExposureReview(calendarEaSummary(t)).status).toBe('incomplete');
  });

  it('full replay and day snapshot continuation preserve all coverage, persistence and review', () => {
    const patch = (days: DayInput[]) => { days[15]!.coverage = { energy: 'complete', exercise: 'unknown' }; days[15]!.exerciseCoverageScope = 'unknown'; };
    for (const change of [undefined, patch]) {
      const full = run(change, { captureSnapshotAt: [14] });
      const resumed = run(change, { initialSnapshot: full.snapshots![14]! });
      for (const key of ['eaIntakeCoverage', 'eaExerciseCoverage', 'eaExerciseScope', 'eaCoverage7', 'eaCoverage28', 'eaRawDaily', 'calendarEa7', 'calendarEa28'] as const) {
        expect(SAFETY_TRACE_KEYS).toContain(key);
        expect(Array.from(resumed.safety[key]!)).toEqual(Array.from(full.safety[key]!));
      }
      expect(calendarEaSummary(resumed.safety)).toEqual(calendarEaSummary(full.safety));
      expect(eaExposureReview(calendarEaSummary(resumed.safety))).toEqual(eaExposureReview(calendarEaSummary(full.safety)));
    }
    expect(EXPOSURE_RING_VERSION).toBe(2);
  });
});
