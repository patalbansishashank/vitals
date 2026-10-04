// @vitest-environment node
// Review V1a pass 2: after-midnight carry (V1a-M2, V1a-L2), a drink inside a planned fast (V1a-L5), bed time equal
// to wake time (V1a-L9). Each test failed before the fix.
import { compileSchedule, DayHourTable, expandDayToHours } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { runEngine } from '../loop';
import { DEFAULTS } from '../defaults';
import type { DayTemplate, Schedule } from '../../types/schedule';
import { MAN } from './fixtures';

const p = resolveProfile(MAN);
const base: DayTemplate = {
  id: 'K',
  label: 'kcal day',
  energy: { kind: 'kcal', kcal: 2400 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 250 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 10 } },
  steps: 8000,
};
const sched = (tmpl: DayTemplate, days: number, extra: Partial<Schedule> = {}): Schedule => ({
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: days,
  programs: [tmpl],
  days: Array.from({ length: days }, () => ({ program: 0 })),
  ...extra,
});
const sum = (a: ArrayLike<number>, from = 0, to = a.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]!;
  return s;
};

describe('V1a-M2: exercise minutes after midnight carry into the next day', () => {
  const run = (startH: number) => ({ ...base, exercise: [{ kind: 'cardio' as const, modality: 'run' as const, startH, durationMin: 120 }] });

  it('the hour tables step every minute of a 23:00 session exactly once', () => {
    const c = compileSchedule(sched(run(23), 2), p);
    const t0 = new DayHourTable();
    expandDayToHours(c.days[0]!, 23, 8, null, 0, t0);
    expect(sum(t0.exMin)).toBeCloseTo(60, 9); // 23:00-24:00 today
    const t1 = new DayHourTable();
    expandDayToHours(c.days[1]!, c.days[0]!.sleepBedH, c.days[0]!.sleepHours, null, 24, t1, c.days[0]!);
    // day 1: its own 23:00-24:00 plus the 00:00-01:00 carried from day 0
    expect(t1.exMin[0]).toBeCloseTo(60, 9);
    expect(t1.exMin[23]).toBeCloseTo(60, 9);
    expect(sum(t1.exMin)).toBeCloseTo(120, 9);
  });

  it('the simulated exercise energy over the horizon matches the same session at 21:00 (not the last day)', () => {
    const opts = { burnInDays: 0, series: ['exerciseEE' as const] };
    const late = runEngine(p, compileSchedule(sched({ ...run(23), exercise: [] }, 3, { days: [{ program: 0, override: { exercise: [{ kind: 'cardio', modality: 'run', startH: 23, durationMin: 120 }] } }, { program: 0 }, { program: 0 }] }), p), opts);
    const early = runEngine(p, compileSchedule(sched({ ...run(21), exercise: [] }, 3, { days: [{ program: 0, override: { exercise: [{ kind: 'cardio', modality: 'run', startH: 21, durationMin: 120 }] } }, { program: 0 }, { program: 0 }] }), p), opts);
    const lateTot = sum(late.daily.exerciseEE!);
    const earlyTot = sum(early.daily.exerciseEE!);
    expect(earlyTot).toBeGreaterThan(500);
    expect(lateTot).toBeGreaterThan(0.85 * earlyTot); // before the fix: about half (60 of 120 min)
    expect(late.daily.exerciseEE![1]!).toBeGreaterThan(0.25 * earlyTot); // the after-midnight hour lands on day 1
  });

  it('the last day notes that its after-midnight part is not simulated', () => {
    const c = compileSchedule(sched(run(23), 2), p);
    expect(c.notes.filter((n) => n.code === 'pastHorizonDropped').map((n) => n.day)).toEqual([1]);
    expect(compileSchedule(sched(run(20), 2), p).notes.some((n) => n.code === 'pastHorizonDropped')).toBe(false);
  });
});

describe('V1a-L2: meal clock times past 24:00 wrap into the next day', () => {
  const late: DayTemplate = { ...base, meals: { count: 3, window: { startH: 20, lengthH: 8 } } }; // 20:00, 24:00, 28:00

  it('meals at 24:00 and 28:00 land at hours 0 and 4 of the next day, not hour 23', () => {
    const c = compileSchedule(sched(late, 2), p);
    const d0 = c.days[0]!;
    expect(Array.from({ length: d0.nMeals }, (_, i) => d0.meals[i]!.clockH)).toEqual([20, 24, 28]);
    const t0 = new DayHourTable();
    expandDayToHours(d0, 23, 8, null, 0, t0);
    expect(t0.kcal[23]).toBe(0);
    expect(t0.kcal[20]).toBeCloseTo(d0.meals[0]!.kcal, 9);
    const t1 = new DayHourTable();
    expandDayToHours(c.days[1]!, 23, 8, null, 24, t1, d0);
    expect(t1.kcal[0]).toBeCloseTo(d0.meals[1]!.kcal, 9);
    expect(t1.kcal[4]).toBeCloseTo(d0.meals[2]!.kcal, 9);
    expect(t1.mealStart[0]).toBe(1);
    // each day's meals are stepped exactly once: day 0's evening meal + day 1's 20:00 meal + the carried ones
    expect(sum(t0.kcal) + sum(t1.kcal)).toBeCloseTo(d0.energyKcal + c.days[1]!.meals[0]!.kcal, 6);
  });

  it('a carried meal that falls in the next day\'s planned fast is dropped from the day\'s totals', () => {
    // a fast from 01:00 on day 1 for 30 h: the 28:00 meal of day 0 (04:00 on day 1) is inside it
    const c = compileSchedule(sched(late, 3, { events: [{ kind: 'fast', startDay: 1, startH: 1, durationH: 30 }] }), p);
    const d0 = c.days[0]!;
    expect(d0.meals[2]!.kcal).toBe(0);
    expect(d0.meals[1]!.kcal).toBeGreaterThan(0); // 24:00 = the last intake before the fast window is kept
    expect(c.notes.some((n) => n.code === 'mealDroppedInFast' && n.day === 0)).toBe(true);
  });
});

describe('V1a-L5: a drink inside a planned fast is counted and noted', () => {
  const drinks: DayTemplate = { ...base, substances: { alcohol: [{ clockH: 12, drinks: 3 }], exogenousKetones: [{ clockH: 13, gBhb: 10, form: 'ester' }] } };

  it('keeps the drink and the ketones in the hour table and adds plain notes', () => {
    const c = compileSchedule(sched(drinks, 3, { events: [{ kind: 'fast', startDay: 0, startH: 20, durationH: 20 }] }), p);
    const mask = new Uint8Array(3 * 24);
    for (const sp of c.fastSpans) for (let h = sp.startHour; h < sp.endHour; h++) mask[h] = 1;
    expect(mask[24 + 12]).toBe(1);
    const t = new DayHourTable();
    expandDayToHours(c.days[1]!, 23, 8, mask, 24, t, c.days[0]!);
    expect(t.alcoholG[12]).toBeCloseTo(3 * DEFAULTS.gramsPerDrink, 9);
    expect(t.exoKetoneG[13]).toBeCloseTo(10, 9);
    const drink = c.notes.find((n) => n.code === 'drinkInFast');
    expect(drink?.day).toBe(1);
    expect(drink?.message).toBe('the drink at 12:00 is inside the planned fast; it is counted and breaks the fast');
    expect(c.notes.find((n) => n.code === 'ketonesInFast')?.day).toBe(1);
    // outside the fast (day 0 and day 2 at 12:00, 13:00): no note
    expect(c.notes.filter((n) => n.code === 'drinkInFast')).toHaveLength(1);
  });
});

describe('V1a-L9: bed time equal to wake time is no sleep data', () => {
  it('uses the usual sleep instead of 24 h asleep', () => {
    const c = compileSchedule(sched({ ...base, sleep: { bedH: 7, wakeH: 7 } }, 1), p);
    const d = c.days[0]!;
    expect(d.sleepBedH).toBe(p.habits.bedTimeH);
    expect(d.sleepWakeH).toBe(p.habits.wakeTimeH);
    expect(d.sleepHours).toBeCloseTo((p.habits.wakeTimeH - p.habits.bedTimeH + 24) % 24, 9);
    const t = new DayHourTable();
    expandDayToHours(d, d.sleepBedH, d.sleepHours, null, 0, t);
    expect(sum(t.steps)).toBeCloseTo(8000, 6); // before the fix: every hour asleep, steps dropped
  });

  it('falls back to the defaults when the usual times are equal too', () => {
    const q = resolveProfile({ ...MAN, habits: { ...MAN.habits, bedTimeH: 22, wakeTimeH: 22 } });
    const d = compileSchedule(sched(base, 1), q).days[0]!;
    expect(d.sleepBedH).toBe(DEFAULTS.bedTimeH);
    expect(d.sleepWakeH).toBe(DEFAULTS.wakeTimeH);
    expect(d.sleepHours).toBeCloseTo((DEFAULTS.wakeTimeH - DEFAULTS.bedTimeH + 24) % 24, 9);
  });

  it('an explicit sleep length still wins', () => {
    const d = compileSchedule(sched({ ...base, sleep: { bedH: 7, wakeH: 7, hours: 6 } }, 1), p).days[0]!;
    expect(d.sleepHours).toBe(6);
  });
});
