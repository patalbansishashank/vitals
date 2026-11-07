// @vitest-environment node
import { compileSchedule, habitualWeek, habitualWeekPrograms } from '../compileSchedule';
import { activityReference } from '../activityReference';
import { DOCUMENTED_CYCLE_MET, HABIT_CARDIO_MET, HABIT_RT_MET, resolveProfile } from '../resolveProfile';
import { stepsOverlapAssumptions } from '../../model/activity';
import { compileRequest } from '../../planner/domain/context';
import { baselineSchedule } from '../../planner/domain/decode';
import { request } from '../../planner/domain/__tests__/personas';
import type { ActivityIntake, HabitProfile, PersonProfile, Schedule } from '../../types';
import { CARDIO_MODALITY_CODE } from '../../types/inputs';

const cardio: NonNullable<HabitProfile['habitualCardio']> = {
  modality: 'cycle', sessionsPerWeek: 6, minutesPerSession: 15, weekdays: [0, 1, 2, 3, 4, 5], source: 'userReport',
};
const steps: ActivityIntake['steps'] = { source: 'estimate', weeklyMean: 15312, daysOfHistory: 7 };
const person = (activity: ActivityIntake, habits: HabitProfile = {}): PersonProfile => ({
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 28, heightCm: 166, weightKg: 74.8 },
  habits: { sessionsPerWeek: 3, lifingCardioMix: 0, stepsScope: 'totalDay', ...habits, activity },
  startDate: '2026-11-02', // Monday
});
const weekSchedule = (programs: ReturnType<typeof habitualWeekPrograms>): Schedule => ({
  schemaVersion: 1, startDate: '2026-11-02', horizonDays: 7, programs,
  days: programs.map((_, program) => ({ program })),
});

describe('documented habitual cardio is one physical routine', () => {
  it('moves six 15-minute rides into EAT0 and the reference week; replaying it has zero activity delta', () => {
    const rp = resolveProfile(person({ steps }, { habitualCardio: cardio }));
    const expected = (3 * (HABIT_RT_MET - 1) * 74.8 + 90 * (DOCUMENTED_CYCLE_MET - 1) * 74.8 / 60) / 7;
    expect(rp.eat0Kcal).toBeCloseTo(expected, 9);
    expect(rp.activity?.recreationKcal).toBe(0);
    const programs = habitualWeekPrograms(rp);
    expect(programs.filter((p) => p.exercise?.some((e) => e.kind === 'cardio' && e.modality === 'cycle'))).toHaveLength(6);
    expect(programs[6]!.exercise?.some((e) => e.kind === 'cardio' && e.modality === 'cycle')).not.toBe(true);
    const compiled = compileSchedule(weekSchedule(programs), rp);
    for (const d of compiled.days) expect(d.activityDeltaKcal).toBeCloseTo(0, 6);
    const reference = habitualWeek(rp);
    for (const d of activityReference(rp, reference, [], 0, () => reference).delta) expect(d).toBeCloseTo(0, 6);
  });

  it('replaces generic cardio share, keeps generic RT, and preserves unrelated recreation', () => {
    const unrelated: ActivityIntake['recreation'] = [{ label: 'badminton', intensity: 'moderate', minPerWeek: 60 }];
    const typed = resolveProfile(person({ steps, recreation: unrelated }, { sessionsPerWeek: 4, lifingCardioMix: 0.5, habitualCardio: cardio }));
    const expected = (2 * (HABIT_RT_MET - 1) * 74.8 + 90 * (DOCUMENTED_CYCLE_MET - 1) * 74.8 / 60) / 7;
    expect(typed.eat0Kcal).toBeCloseTo(expected, 9);
    expect(typed.activity!.recreationKcal).toBeGreaterThan(0);
    const plain = resolveProfile(person({ steps }, { sessionsPerWeek: 4, lifingCardioMix: 0.5 }));
    expect(plain.eat0Kcal).toBeCloseTo(4 * ((HABIT_RT_MET + HABIT_CARDIO_MET) / 2 - 1) * 74.8 / 7, 9);
    expect(habitualWeekPrograms(typed).flatMap((p) => p.exercise ?? []).filter((e) => e.kind === 'cardio' && e.modality === 'other')).toHaveLength(0);
  });

  it('reclassifies only the explicitly linked source row and reports the derived projection', () => {
    const raw: ActivityIntake = { steps, recreation: [
      { id: 'reported-air-bike', label: 'reported air-bike', intensity: 'moderate', minPerWeek: 90 },
      { id: 'other-sport', label: 'badminton', intensity: 'moderate', minPerWeek: 60 },
    ] };
    const linked = { ...cardio, recreationSourceId: 'reported-air-bike' };
    const rp = resolveProfile(person(raw, { habitualCardio: linked }));
    expect(rp.input.habits?.activity?.recreation).toHaveLength(2); // raw evidence unchanged
    expect(rp.habits.activity?.recreation).toEqual([raw.recreation![1]]);
    expect(rp.habits.activity?.recreationProjection).toEqual({ basis: 'reclassifiedHabitualCardio', removedSourceIds: ['reported-air-bike'], sourceMinutesPerWeek: 90 });
    expect(rp.activity!.recreationKcal).toBeGreaterThan(0); // unrelated activity stays additive
    expect(() => resolveProfile(person(raw, { habitualCardio: { ...linked, minutesPerSession: 16 } }))).toThrow(/matching weekly minutes/);
    expect(() => resolveProfile(person(raw, { habitualCardio: { ...linked, recreationSourceId: 'missing' } }))).toThrow(/identify one recreation row/);
    const projected = rp.habits.activity!;
    expect(() => resolveProfile(person(projected, { habitualCardio: { ...linked, minutesPerSession: 16 } }))).toThrow(/projection conflicts/);
  });

  it('the planner status-quo schedule carries the same documented rides and has zero activity delta', () => {
    const ctx = compileRequest(request(person({ steps }, { habitualCardio: cardio }), [{ metric: 'fatMass', direction: 'minimise' }], { horizonDays: 28 }));
    const statusQuo = compileSchedule(baselineSchedule(ctx), ctx.rp);
    expect(statusQuo.days.slice(0, 7).filter((d) => d.sessions.some((s) => s.kind === 'cardio' && s.modality === CARDIO_MODALITY_CODE.cycle))).toHaveLength(6);
    for (const d of statusQuo.days) expect(d.activityDeltaKcal).toBeCloseTo(0, 6);
  });

  it('books only the extra cycling when a plan replaces 90 habitual minutes with 170; unknown walking overlap stays unknown', () => {
    const rp = resolveProfile(person({ steps }, { habitualCardio: cardio }));
    const programs = habitualWeekPrograms(rp).map((p, wd) => {
      const exercise = (p.exercise ?? []).filter((e) => !(e.kind === 'cardio' && e.modality === 'cycle'));
      if (wd === 1 || wd === 4) exercise.push({ kind: 'cardio', modality: 'cycle', startH: 17, durationMin: 85, met: DOCUMENTED_CYCLE_MET });
      return { ...p, exercise };
    });
    const replacement = compileSchedule(weekSchedule(programs), rp);
    const meanDelta = replacement.days.reduce((s, d) => s + d.activityDeltaKcal!, 0) / 7;
    expect(meanDelta).toBeGreaterThan(0);
    expect(meanDelta).toBeLessThan(200);
    const walking = compileSchedule(weekSchedule(programs.map((p, i) => i === 0
      ? { ...p, exercise: [...(p.exercise ?? []), { kind: 'cardio' as const, modality: 'walk' as const, startH: 12, durationMin: 45 }] }
      : p)), rp);
    expect(stepsOverlapAssumptions(walking.days, rp).current).toBe('unknown');
  });
});
