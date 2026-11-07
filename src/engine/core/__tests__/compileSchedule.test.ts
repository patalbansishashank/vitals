// @vitest-environment node
import { compileSchedule, DayHourTable, expandDayToHours, loadHour, newHourInput, resolveDayInPlace, resolvedDayExposure } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { runEngine } from '../loop';
import { MODULES } from '../moduleRegistry';
import { defineModule } from '../moduleKit';
import { ATWATER, RT_PRESETS } from '../defaults';
import type { AnyEngineModule } from '../../types/module';
import type { DayTemplate, ResistanceSession, Schedule } from '../../types/schedule';
import { MAX_SET_GROUPS_PER_DAY, TRAINING_REGIONS, type DayInput } from '../../types/inputs';
import { MAN, PROGRAM_A, PROGRAM_B, repeatSchedule } from './fixtures';

const p = resolveProfile(MAN);
const one = (tmpl: DayTemplate, extra: Partial<Schedule> = {}): Schedule => ({
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: 1,
  programs: [tmpl],
  days: [{ program: 0 }],
  ...extra,
});
const conv = (d: { proteinG: number; carbG: number; fatG: number; fibreG: number; alcoholG: number }) =>
  ATWATER.protein * d.proteinG + ATWATER.carb * d.carbG + ATWATER.fat * d.fatG + ATWATER.fibre * d.fibreG + ATWATER.alcohol * d.alcoholG;

describe('documented habitual sleep duration', () => {
  const documented = resolveProfile({ ...MAN, habits: { ...MAN.habits, habitualSleepDurationH: 6.86, habitualSleepDurationSource: 'deviceSummary' } });

  it('uses duration for habitual nights and day-zero prior without inventing clock times', () => {
    const c = compileSchedule(one(PROGRAM_A), documented);
    expect(documented.input.habits?.bedTimeH).toBeUndefined();
    expect(documented.input.habits?.wakeTimeH).toBeUndefined();
    expect(documented.habits.habitualSleepDurationSource).toBe('deviceSummary');
    expect(c.days[0]).toMatchObject({ sleepBedH: 23, sleepWakeH: 7, sleepHours: 6.86, sleepSource: 'habitual' });
    expect(c.days[0]!.sleepEndingToday).toMatchObject({ hours: 6.86 });
  });

  it('lets explicit hours or clock edits override the habitual duration', () => {
    expect(compileSchedule(one({ ...PROGRAM_A, sleep: { hours: 7.25 } }), documented).days[0]!.sleepHours).toBe(7.25);
    expect(compileSchedule(one({ ...PROGRAM_A, sleep: { bedH: 22, wakeH: 6 } }), documented).days[0]!.sleepHours).toBe(8);
    expect(compileSchedule(one(PROGRAM_A), p).days[0]!.sleepHours).toBe(8);
  });
});

describe('energy resolution', () => {
  it('% of baseline maintenance resolves statically at compile time', () => {
    const c = compileSchedule(one(PROGRAM_A), p);
    const d = c.days[0]!;
    expect(d.runtime).toBe(false);
    // R-MAINT: the reference is the maintenance at the PLANNED activity (a training day with 9 000 steps: above TDEE0)
    expect(d.activityAdjKcal!).toBeGreaterThan(0);
    expect(d.maintenanceKcal).toBeCloseTo(p.tdee0Kcal + d.activityAdjKcal!, 6);
    expect(d.energyKcal).toBeCloseTo(0.85 * d.maintenanceKcal, 6);
    expect(d.plannedBalanceKcal).toBeCloseTo(d.energyKcal - d.maintenanceKcal, 6);
    expect(conv(d)).toBeCloseTo(d.energyKcal, 6);
  });

  it('absolute kcal ignores maintenance', () => {
    const c = compileSchedule(one({ ...PROGRAM_A, energy: { kind: 'kcal', kcal: 2000 } }), p);
    expect(c.days[0]!.energyKcal).toBeCloseTo(2000, 6);
  });

  it("'current' reference is marked runtime and re-resolves in place from the model state", () => {
    const tmpl: DayTemplate = { ...PROGRAM_A, energy: { kind: 'pctMaintenance', pct: 80, reference: 'current' } };
    const c = compileSchedule(one(tmpl), p);
    const d = c.days[0]!;
    expect(d.runtime).toBe(true);
    resolveDayInPlace(d, { maintenanceKcal: 2500, bodyMassKg: 80, ffmKg: 60 }, p);
    expect(d.energyKcal).toBeCloseTo(2000, 6);
    expect(d.proteinG).toBeCloseTo(2 * 80, 6); // g/kg follows the runtime reference mass
    expect(d.maintenanceKcal).toBe(2500);
  });

  it('the loop resolves current / blockStart days from the running maintenance estimate', () => {
    const drifting = defineModule<{ n: number }>({
      id: 'energy',
      specSection: 'test',
      dossiers: 'test',
      params: [],
      reads: [],
      writes: ['maintenanceKcalD'],
      records: [],
      init: (_k, _c, bus) => {
        bus.maintenanceKcalD = 2000;
        return { n: 0 };
      },
      endOfDay: (s, _k, bus) => {
        s.n++;
        bus.maintenanceKcalD = 2000 + 100 * s.n;
      },
    });
    const mods: AnyEngineModule[] = [drifting as unknown as AnyEngineModule];
    const cur: DayTemplate = { ...PROGRAM_B, energy: { kind: 'pctMaintenance', pct: 100, reference: 'current' } };
    const blk: DayTemplate = { ...PROGRAM_B, energy: { kind: 'pctMaintenance', pct: 100, reference: 'blockStart' } };
    const s: Schedule = {
      schemaVersion: 1,
      startDate: '2026-10-05',
      horizonDays: 6,
      programs: [cur, blk],
      days: [0, 0, 0, 1, 1, 1].map((program) => ({ program })),
      blocks: [
        { name: 'a', startDay: 0, endDay: 3 },
        { name: 'b', startDay: 3, endDay: 6 },
      ],
    };
    const cs = compileSchedule(s, p);
    const r = runEngine(p, cs, { burnInDays: 0, series: ['inEnergy'] }, mods);
    // running maintenance at habitual activity + the day's R-MAINT activity adjustment (these rest days have no sessions,
    // so the MAN's habitual training energy is removed)
    const base = [2000, 2100, 2200, 2300, 2300, 2300];
    const got = Array.from(r.daily.inEnergy!);
    for (let d = 0; d < 6; d++) expect(got[d]).toBeCloseTo(base[d]! + cs.days[d]!.activityAdjKcal!, 2);
    expect(cs.days[0]!.activityAdjKcal!).toBeLessThan(0);
  });
});

describe('macro units', () => {
  it('g, g/kg BW, g/kg FFM, % energy and remainder resolve to grams', () => {
    const tmpl: DayTemplate = {
      id: 'x',
      label: 'x',
      energy: { kind: 'kcal', kcal: 2400 },
      macros: {
        protein: { unit: 'gPerKgFfm', value: 2 },
        carbs: { unit: 'pctEnergy', value: 40 },
        fat: { unit: 'remainder' },
        fibre: { unit: 'g', value: 30 },
      },
    };
    const d = compileSchedule(one(tmpl), p).days[0]!;
    expect(d.proteinG).toBeCloseTo(2 * p.ffm0Kg, 6);
    expect(d.carbG).toBeCloseTo((0.4 * 2400) / 4, 6);
    expect(d.fibreG).toBe(30);
    expect(d.fatG).toBeCloseTo((2400 - 4 * d.proteinG - 4 * d.carbG - 2 * 30) / 9, 6);
    expect(conv(d)).toBeCloseTo(2400, 6);
    const bw = compileSchedule(one({ ...tmpl, macros: { ...tmpl.macros, protein: { unit: 'gPerKgBw', value: 1.5 } } }), p).days[0]!;
    expect(bw.proteinG).toBeCloseTo(1.5 * p.weightKg, 6);
  });

  it('defaults fibre to 8 g per 1000 kcal and flags macros that exceed energy', () => {
    const d = compileSchedule(one(PROGRAM_B), p).days[0]!;
    expect(d.fibreG).toBeCloseTo((8 * d.energyKcal) / 1000, 1);
    const over: DayTemplate = { ...PROGRAM_B, energy: { kind: 'kcal', kcal: 800 }, macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 150 }, fat: { unit: 'remainder' } } };
    const c = compileSchedule(one(over), p);
    expect(c.notes.some((n) => n.code === 'macrosExceedEnergy')).toBe(true);
    expect(c.days[0]!.fatG).toBe(0);
  });
});

describe('meal placement', () => {
  it('spreads n meals evenly over the eating window', () => {
    const d = compileSchedule(one(PROGRAM_A), p).days[0]!;
    expect(d.nMeals).toBe(3);
    expect([0, 1, 2].map((i) => d.meals[i]!.clockH)).toEqual([8, 14, 20]);
    expect(d.windowStartH).toBe(8);
    expect(d.windowLengthH).toBe(12);
    const b = compileSchedule(one(PROGRAM_B), p).days[0]!;
    expect([0, 1].map((i) => b.meals[i]!.clockH)).toEqual([12, 20]);
  });

  it('biggerLast weights meals 1:2:3 and explicit meals keep their clock times', () => {
    const d = compileSchedule(one({ ...PROGRAM_A, meals: { count: 3, window: { startH: 10, lengthH: 8 }, split: 'biggerLast' } }), p).days[0]!;
    expect(d.meals[2]!.proteinG / d.meals[0]!.proteinG).toBeCloseTo(3, 6);
    const e = compileSchedule(one({ ...PROGRAM_A, meals: { meals: [{ clockH: 7.5, share: 1 }, { clockH: 19, share: 3 }] } }), p).days[0]!;
    expect(e.meals[0]!.clockH).toBe(7.5);
    expect(e.meals[1]!.carbG / e.meals[0]!.carbG).toBeCloseTo(3, 6);
  });
});

describe('fasts across day boundaries', () => {
  const s: Schedule = { ...repeatSchedule(7, [0]), events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 72, refeed: 'auto' }] };
  const c = compileSchedule(s, p);

  // meal-to-meal semantics (ruling 2026-09-30 18:10): the 20:00 dinner on day 1 is the last intake, the first intake is at
  // 20:00 on day 4 (72 h later); the whole hours strictly between (day 1 21:00 … day 4 19:00) carry no intake
  it('zeroes fully covered days and keeps partial days around the span', () => {
    expect(c.days[1]!.zeroIntake).toBe(false);
    expect(c.days[2]!.zeroIntake).toBe(true);
    expect(c.days[3]!.zeroIntake).toBe(true);
    expect(c.days[2]!.energyKcal).toBe(0);
    expect(c.days[2]!.proteinG).toBe(0);
    expect(c.days[4]!.zeroIntake).toBe(false);
    expect(c.days[1]!.fastHours).toBe(3);
    expect(c.days[4]!.fastHours).toBe(20);
    expect(c.fastSpans).toEqual([{ startHour: 45, endHour: 116, electrolytes: true, mealToMealH: 72, refeed: 'auto', refeedDays: 2 }]);
    expect(c.days[3]!.fastStartDay).toBe(1);
  });

  it('keeps the last meal at the fast start and drops the meals inside the span (never relocated as a bolus)', () => {
    expect(c.days[1]!.meals[2]!.clockH).toBe(20); // the 20:00 dinner is the last intake (allowed at the boundary)
    expect(c.days[1]!.meals[2]!.kcal).toBeGreaterThan(0);
    // day 4: breakfast and lunch fall inside the fast and are dropped; the 20:00 dinner (= end of fast) stays
    expect(c.days[4]!.meals[0]!.kcal).toBe(0);
    expect(c.days[4]!.meals[1]!.kcal).toBe(0);
    expect(c.days[4]!.meals[2]!.kcal).toBeGreaterThan(0);
    expect(c.days[4]!.mealDropMask).toBe(0b011);
    expect(c.notes.filter((n) => n.code === 'mealDroppedInFast').length).toBe(2);
    expect(c.notes.filter((n) => n.code === 'mealMovedOutOfFast').length).toBe(0);
  });

  it("applies 17 HC-F3's graded refeed after a 72-h fast when refeed = 'auto'", () => {
    const base = compileSchedule(repeatSchedule(7, [0]), p);
    // the fast ends at day 4 20:00: only that day's dinner is eaten, at 50 % of its planned size
    expect(c.days[4]!.energyKcal).toBeCloseTo((0.5 * base.days[4]!.energyKcal) / 3, 6);
    expect(c.days[5]!.energyKcal).toBeCloseTo(0.9 * base.days[5]!.energyKcal, 6);
    expect(c.days[6]!.energyKcal).toBeCloseTo(base.days[6]!.energyKcal, 6);
  });

  it("a 'zero' program is a water-only day with electrolytes by default", () => {
    const z: DayTemplate = { id: 'F', label: 'water-only', energy: { kind: 'zero' }, macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 } } };
    const cz = compileSchedule({ ...repeatSchedule(3, [0, 1, 0], [PROGRAM_A, z]) }, p);
    expect(cz.days[1]!.zeroIntake).toBe(true);
    expect(cz.days[1]!.electrolytes).toBe(true);
    expect(cz.days[1]!.nMeals).toBe(0);
    expect(cz.fastSpans[0]).toEqual({ startHour: 24, endHour: 48, electrolytes: true, mealToMealH: 36, refeed: 'none', refeedDays: 0 });
  });

  it('the hour table carries the fast mask, zero intake and sleep/steps', () => {
    const t = new DayHourTable();
    const mask = new Uint8Array(7 * 24);
    for (const sp of c.fastSpans) for (let h = sp.startHour; h < sp.endHour; h++) mask[h] = 1;
    expandDayToHours(c.days[2]!, 23, 8, mask, 2 * 24, t);
    expect(Array.from(t.plannedFast).every((v) => v === 1)).toBe(true);
    expect(t.kcal.reduce((a, b) => a + b, 0)).toBe(0);
    expandDayToHours(c.days[0]!, 23, 8, mask, 0, t);
    expect(t.asleep[3]).toBe(1);
    expect(t.asleep[12]).toBe(0);
    expect(t.asleep[23]).toBe(1);
    expect(t.steps.reduce((a, b) => a + b, 0)).toBeCloseTo(9000, 6);
    expect(t.kcal.reduce((a, b) => a + b, 0)).toBeCloseTo(c.days[0]!.energyKcal, 6);
  });
});

describe('exercise resolution', () => {
  it('maps a volume preset onto per-region sets (09 §4.1 presets)', () => {
    const d = compileSchedule(one(PROGRAM_A), p).days[0]!;
    const per = RT_PRESETS.moderate.setsPerRegionWeek / RT_PRESETS.moderate.sessionsPerWeek;
    expect(d.nSessions).toBe(1);
    expect(d.sessions[0]!.kind).toBe('resistance');
    expect(d.sessions[0]!.setsByRegion[0]).toBeCloseTo(per, 9);
    expect(d.sessions[0]!.durationMin).toBeCloseTo(per * 9 * 2.5, 9);
  });

  it('adds carbohydrate eaten during exercise to the day totals and the hour rows, not to meals (review M8)', () => {
    const tmpl: DayTemplate = {
      id: 'ride', label: 'ride', energy: { kind: 'kcal', kcal: 2500 },
      macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 300 }, fat: { unit: 'remainder' } },
      meals: { count: 3, window: { startH: 8, lengthH: 12 } },
      exercise: [{ kind: 'cardio', modality: 'cycle', startH: 9.5, durationMin: 120, carbDuringGPerH: 60 }],
    };
    const c = compileSchedule(one(tmpl), p);
    const d = c.days[0]!;
    expect(d.exerciseCarbG).toBeCloseTo(120, 9);
    expect(d.carbG).toBeCloseTo(300 + 120, 9);
    expect(d.energyKcal).toBeCloseTo(2500 + 4 * 120, 6);
    let mealCarbs = 0;
    for (let i = 0; i < d.nMeals; i++) mealCarbs += d.meals[i]!.carbG;
    expect(mealCarbs).toBeCloseTo(300, 9);
    expect(c.notes.some((n) => n.code === 'carbsDuringExerciseAdded')).toBe(true);
    const t = new DayHourTable();
    expandDayToHours(d, 23, 8, null, 0, t);
    let hourSum = 0;
    for (let h = 0; h < 24; h++) hourSum += t.exCarbG[h]!;
    expect(hourSum).toBeCloseTo(120, 9);
    expect(t.exCarbG[9]).toBeCloseTo(30, 9); // 09:30-10:00
    expect(t.exCarbG[10]).toBeCloseTo(60, 9);
  });

  it('drops carbohydrate during a session inside a planned fast (review M8)', () => {
    const tmpl: DayTemplate = {
      id: 'x', label: 'x', energy: { kind: 'kcal', kcal: 2000 },
      macros: { protein: { unit: 'g', value: 120 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
      meals: { count: 2, window: { startH: 14, lengthH: 6 } },
      exercise: [{ kind: 'cardio', modality: 'run', startH: 7, durationMin: 60, carbDuringGPerH: 30 }],
    };
    const c = compileSchedule(one(tmpl, { events: [{ kind: 'fast', startDay: 0, startH: 0, durationH: 12 }] }), p);
    const d = c.days[0]!;
    expect(d.exerciseCarbG).toBe(0);
    expect(d.carbG).toBeCloseTo(200, 9);
    expect(c.notes.some((n) => n.code === 'carbsDuringExerciseDropped')).toBe(true);
  });

  it('resolves carbShareNonProtein against the energy left after protein, fibre and alcohol (review m8)', () => {
    const tmpl: DayTemplate = {
      id: 'np', label: 'np', energy: { kind: 'kcal', kcal: 2400 },
      macros: {
        carbShareNonProtein: 0.6,
        protein: { unit: 'g', value: 150 },
        carbs: { unit: 'remainder' },
        fat: { unit: 'remainder' },
        fibre: { unit: 'g', value: 30 },
      },
    };
    const d = compileSchedule(one(tmpl), p).days[0]!;
    const npE = 2400 - 4 * 150 - 2 * 30;
    expect(d.carbG).toBeCloseTo((0.6 * npE) / 4, 9);
    expect(d.fatG).toBeCloseTo((0.4 * npE) / 9, 9);
    expect(d.energyKcal).toBeCloseTo(2400, 6);
  });

  it('keeps the module list intact (sanity)', () => {
    expect(MODULES.length).toBe(16);
  });
});

describe('habitual week: one definition for burn-in and the O-12 fixture (MODEL_SPEC §3.4)', () => {
  it('validation/fixtures habitualWeekSchedule compiles to exactly core habitualWeek, weekday for weekday', async () => {
    const { habitualWeek } = await import('../compileSchedule');
    const { habitualWeekSchedule } = await import('../../validation/fixtures/programs');
    for (const person of [
      MAN,
      { ...MAN, habits: { typicalSteps: 9000, sessionsPerWeek: 4, lifingCardioMix: 0.5, habitualAlcoholDrinksPerWeek: 5 } },
      { ...MAN, habits: { sessionsPerWeek: 3, lifingCardioMix: 1 } },
    ]) {
      const rp = resolveProfile(person);
      const week = habitualWeek(rp);
      const fix = compileSchedule(habitualWeekSchedule(person, 14), rp).days;
      // calendar fields (day index, date, weekday, program index) differ by construction; everything physical must match
      const cal = { day: 0, dateISO: '', weekday: 0, program: 0, blockIndex: 0, blockStartDay: 0 };
      // R-MAINT fields: the fixture is compiled with the activity reference, which must be zero for the habitual week
      for (let d = 0; d < 14; d++) {
        expect(Math.abs(fix[d]!.activityAdjKcal!)).toBeLessThan(1e-9);
        expect(Math.abs(fix[d]!.activityDeltaKcal!)).toBeLessThan(1e-9);
        fix[d]!.activityAdjKcal = 0;
        fix[d]!.activityDeltaKcal = 0;
        fix[d]!.maintenanceKcal = week[(rp.startWeekday + d) % 7]!.maintenanceKcal;
        fix[d]!.plannedBalanceKcal = week[(rp.startWeekday + d) % 7]!.plannedBalanceKcal;
        week[(rp.startWeekday + d) % 7]!.activityAdjKcal = 0;
        week[(rp.startWeekday + d) % 7]!.activityDeltaKcal = 0;
      }
      // A1-020: a legacy identity-less bout key names its origin day (a calendar field like the others)
      const noKey = (x: DayInput) => ({ ...x, sessions: x.sessions.map((ss) => ({ ...ss, boutKey: undefined })) });
      for (let d = 0; d < 14; d++) {
        const a = JSON.stringify({ ...noKey(fix[d]!), ...cal });
        const b = JSON.stringify({ ...noKey(week[(rp.startWeekday + d) % 7]!), ...cal });
        expect(a === b, `day ${d} differs from habitualWeek`).toBe(true);
      }
    }
  });
});

// =====================================================================================================================
// 2026-10-18 contracts, W0-core provider side: D6-02 reported energy, D2-01 fast metadata/causality, D3-01 set groups,
// D4-01 resolved exposure. Same inputs, versions and seed as the legacy cases above (deterministic compile).
// =====================================================================================================================

const loggedDay = (meals: NonNullable<DayTemplate['meals']>['meals'], extra: Partial<DayTemplate> = {}): DayTemplate => ({
  id: 'L',
  label: 'as logged',
  energy: { kind: 'kcal', kcal: (meals ?? []).reduce((a, m) => a + (m.energyKcal ?? 0), 0) },
  macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'remainder' }, fat: { unit: 'remainder' } },
  meals: { meals },
  ...extra,
});
const hourSum = (a: Float64Array): number => a.reduce((s, v) => s + v, 0);

describe('D6-02 reported meal energy with unknown macros (compiler)', () => {
  it('600 kcal with 30 g protein stays 600 kcal: 480 kcal unallocated, unknown carbohydrate/fat are not zero-energy food', () => {
    const c = compileSchedule(one(loggedDay([{ clockH: 12.5, share: 1, energyKcal: 600, macros: { proteinG: 30 } }])), p);
    const d = c.days[0]!;
    const m = d.meals[0]!;
    expect(m.kcal).toBe(600);
    expect(m.reportedKcal).toBe(600);
    expect(m.unallocatedKcal).toBeCloseTo(480, 9);
    expect(m.energyStatus).toBe('energyOnly');
    expect([m.proteinG, m.carbG, m.fatG, m.fibreG]).toEqual([30, 0, 0, 0]);
    expect(d.energyKcal).toBeCloseTo(600, 9);
    expect(d.proteinG).toBe(30);
    expect(d.carbG).toBe(0);
    expect(d.fatG).toBe(0);
    expect(d.unallocatedKcal).toBeCloseTo(480, 9);
    expect(d.energyStatus).toBe('energyOnly');
    expect(c.notes.some((n) => n.code === 'energyOnlyMeal')).toBe(true);
    // hour expansion and the HourInput keep the energy and its unallocated part (the intake module routes it)
    const t = new DayHourTable();
    expandDayToHours(d, 23, 8, null, 0, t);
    expect(t.kcal[12]).toBeCloseTo(600, 9);
    expect(t.unallocatedKcal[12]).toBeCloseTo(480, 9);
    expect(hourSum(t.kcal)).toBeCloseTo(d.energyKcal, 9);
    const hi = newHourInput();
    loadHour(t, 12, hi);
    expect(hi.kcal).toBeCloseTo(600, 9);
    expect(hi.unallocatedKcal).toBeCloseTo(480, 9);
    loadHour(t, 13, hi);
    expect(hi.unallocatedKcal).toBe(0);
  });

  it('survives compile → engine: the energy echo is the logged 600 kcal', () => {
    const cs = compileSchedule(one(loggedDay([{ clockH: 12.5, share: 1, energyKcal: 600, macros: { proteinG: 30 } }])), p);
    const r = runEngine(p, cs, { record: 'daily', series: ['inEnergy', 'inProtein'] });
    expect(r.daily.inEnergy![0]).toBeCloseTo(600, 3);
    expect(r.daily.inProtein![0]).toBeCloseTo(30, 4);
  });

  it('a kcal-only meal keeps all its energy as unallocated (every macro unknown)', () => {
    const d = compileSchedule(one(loggedDay([{ clockH: 19, share: 1, energyKcal: 750 }])), p).days[0]!;
    expect(d.energyKcal).toBe(750);
    expect(d.unallocatedKcal).toBe(750);
    expect(d.proteinG + d.carbG + d.fatG + d.fibreG).toBe(0);
    expect(d.meals[0]!.energyStatus).toBe('energyOnly');
  });

  it('gram rounding is consistent; known grams above the report are a source conflict (grams kept, reported energy kept)', () => {
    // 30/50/20 g = 500 kcal against a 498 kcal label: within half a gram per known macro; A1-025: the 498 kcal stay the energy
    const ok = compileSchedule(one(loggedDay([{ clockH: 8, share: 1, energyKcal: 498, macros: { proteinG: 30, carbG: 50, fatG: 20 } }])), p);
    expect(ok.days[0]!.meals[0]!.energyStatus).toBe('consistent');
    expect(ok.days[0]!.meals[0]!.kcal).toBe(498);
    expect(ok.days[0]!.unallocatedKcal).toBeCloseTo(-2, 9);
    expect(ok.notes.some((n) => n.code === 'mealEnergyConflict' || n.code === 'energyOnlyMeal')).toBe(false);
    const bad = compileSchedule(one(loggedDay([{ clockH: 8, share: 1, energyKcal: 100, macros: { proteinG: 30 } }])), p);
    const m = bad.days[0]!.meals[0]!;
    expect(m.energyStatus).toBe('conflict');
    expect(m.reportedKcal).toBe(100);
    expect(m.kcal).toBe(100); // the reported energy is the energy; no negative substrate, the grams stay the record
    expect(m.proteinG).toBe(30);
    expect(m.unallocatedKcal).toBeCloseTo(-20, 9);
    expect(bad.days[0]!.energyStatus).toBe('conflict');
    expect(bad.notes.some((n) => n.code === 'mealEnergyConflict')).toBe(true);
  });

  it('a provider reconciliation keeps the reported energy exactly with a signed energy-only residual (W0-food ⇄ core, D6-02)', () => {
    // a food-table record with specific factors below 4/4/9 (ghee-like: 99.8 g fat at 876 kcal): never a conflict
    const below = compileSchedule(one(loggedDay([{ clockH: 8, share: 1, energyKcal: 876, macros: { proteinG: 0, carbG: 0, fatG: 99.8 }, energyResidual: 'reconciliation' }])), p);
    const m = below.days[0]!.meals[0]!;
    expect(m.energyStatus).toBe('consistent');
    expect(m.kcal).toBe(876);
    expect(m.unallocatedKcal).toBeCloseTo(876 - 9 * 99.8, 9);
    expect(below.days[0]!.energyKcal).toBeCloseTo(876, 9);
    expect(below.days[0]!.unallocatedKcal).toBeCloseTo(876 - 9 * 99.8, 9);
    expect(below.notes.some((n) => n.code === 'mealEnergyConflict')).toBe(false);
    const t = new DayHourTable();
    expandDayToHours(below.days[0]!, 23, 8, null, 0, t);
    expect(t.unallocatedKcal[8]).toBeCloseTo(876 - 9 * 99.8, 9); // the negative correction reaches the hour (intake carries it)
    // above the convention with every macro known: consistent, not energy-only; unknown macros stay energy-only
    const above = compileSchedule(one(loggedDay([{ clockH: 8, share: 1, energyKcal: 520, macros: { proteinG: 30, carbG: 50, fatG: 20 }, energyResidual: 'reconciliation' }])), p);
    expect(above.days[0]!.meals[0]!.energyStatus).toBe('consistent');
    expect(above.days[0]!.meals[0]!.kcal).toBe(520);
    const partial = compileSchedule(one(loggedDay([{ clockH: 8, share: 1, energyKcal: 100, macros: { proteinG: 30 }, energyResidual: 'reconciliation' }])), p);
    expect(partial.days[0]!.meals[0]!.energyStatus).toBe('energyOnly');
    expect(partial.days[0]!.meals[0]!.kcal).toBe(100);
  });

  it('counts a drink logged as a substance once and the meal energy as reported', () => {
    const d = compileSchedule(
      one(loggedDay([{ clockH: 19, share: 1, energyKcal: 600, macros: { proteinG: 30, alcoholG: 14 } }], { substances: { alcohol: [{ clockH: 20, drinks: 1 }] } })),
      p,
    ).days[0]!;
    expect(d.meals[0]!.alcoholG).toBe(0); // the drink is the substance entry, not meal alcohol
    expect(d.alcoholG).toBe(14);
    expect(d.energyKcal).toBeCloseTo(600 + 7 * 14, 9);
  });

  it('a planned fast drops a prescribed reported meal with its unallocated energy; refeed never rescales reported energy', () => {
    const tmpl = loggedDay([
      { clockH: 8, share: 1, energyKcal: 400 },
      { clockH: 14, share: 1, energyKcal: 300 },
    ]);
    const c = compileSchedule(one(tmpl, { events: [{ kind: 'fast', startDay: 0, startH: 8, durationH: 12 }] }), p);
    const d = c.days[0]!;
    expect(d.meals[1]!.kcal).toBe(0);
    expect(d.energyKcal).toBeCloseTo(400, 9);
    expect(d.unallocatedKcal).toBeCloseTo(400, 9);
    // 72-h fast with the graded refeed: the reported meal after it keeps its energy (known food is never renormalised)
    const s: Schedule = {
      ...repeatSchedule(6, [0, 0, 0, 0, 1, 1], [PROGRAM_B, loggedDay([{ clockH: 21, share: 1, energyKcal: 900, macros: { proteinG: 40 } }])]),
      events: [{ kind: 'fast', startDay: 0, startH: 20, durationH: 72, refeed: 'auto' }],
    };
    const r = compileSchedule(s, p);
    expect(r.days[4]!.refeedFactor).toBeLessThan(1);
    expect(r.days[4]!.energyKcal).toBeCloseTo(900, 9);
    expect(r.days[4]!.proteinG).toBe(40);
  });
});

describe('D2-01 fast length is policy metadata; verified intake ends an observed zero-calorie fast', () => {
  const base = (events: Schedule['events']): Schedule => ({ ...repeatSchedule(5, [1]), events });
  const rows = (c: ReturnType<typeof compileSchedule>, d: number) => {
    const mask = new Uint8Array(c.nDays * 24);
    for (const sp of c.fastSpans) for (let h = sp.startHour; h < sp.endHour; h++) mask[h] = 1;
    const t = new DayHourTable();
    expandDayToHours(c.days[d]!, 23, 8, mask, d * 24, t, d > 0 ? c.days[d - 1]! : null);
    return t;
  };

  it('identical realised inputs before the fast end regardless of the future fast label/duration (none, 23, 24, 48 h)', () => {
    const variants = [undefined, 23, 24, 48].map((dur) => compileSchedule(base(dur === undefined ? [] : [{ kind: 'fast', startDay: 2, startH: 20, durationH: dur }]), p));
    const strip = (d: DayInput) => JSON.stringify({ ...d, fastPolicy: undefined, fastStartDay: undefined });
    for (const v of variants.slice(1)) {
      for (const d of [0, 1]) expect(strip(v.days[d]!)).toBe(strip(variants[0]!.days[d]!));
      // the fast starts on day 2 at 20:00: every hour row up to and including 20:00 is the same
      const a = rows(variants[0]!, 2);
      const b = rows(v, 2);
      for (let h = 0; h <= 20; h++) {
        expect(b.kcal[h]).toBe(a.kcal[h]);
        expect(b.proteinG[h]).toBe(a.proteinG[h]);
        expect(b.carbG[h]).toBe(a.carbG[h]);
        expect(b.plannedFast[h]).toBe(a.plannedFast[h]);
      }
    }
    // the planned duration travels only as policy metadata
    expect(variants[3]!.days[2]!.fastPolicy).toEqual({ plannedDurationH: 48, startDay: 2, source: 'planned' });
    // meal to meal: the 23-h fast ends at 19:00 with the next meal at 20:00 (24 h), still metadata only
    expect(variants[1]!.days[3]!.fastPolicy?.plannedDurationH).toBe(variants[1]!.fastSpans[0]!.mealToMealH);
    expect(variants[0]!.days[2]!.fastPolicy).toBeUndefined();
  });

  it('an observed fast ends at the first logged intake inside it (the meal is kept, never dropped)', () => {
    // logged 40-h fast from day 0 20:00, but day 1 has meals at 12:00 and 20:00: the 12:00 meal ends the fast
    const planned = compileSchedule(base([{ kind: 'fast', startDay: 0, startH: 20, durationH: 40 }]), p);
    expect(planned.days[1]!.zeroIntake).toBe(true); // prescription semantics: intake inside a planned fast is dropped
    const obs = compileSchedule(base([{ kind: 'fast', startDay: 0, startH: 20, durationH: 40, source: 'observed', eventId: 'fast-1' }]), p);
    expect(obs.days[1]!.meals[0]!.kcal).toBeGreaterThan(0);
    expect(obs.days[1]!.meals[1]!.kcal).toBeGreaterThan(0);
    expect(obs.days[1]!.mealDropMask ?? 0).toBe(0);
    expect(obs.fastSpans).toHaveLength(1);
    expect(obs.fastSpans[0]!.startHour).toBe(21);
    expect(obs.fastSpans[0]!.endHour).toBe(36); // zero-intake hours end with the 12:00 meal
    expect(obs.fastSpans[0]!.source).toBe('observed');
    expect(obs.fastSpans[0]!.eventId).toBe('fast-1');
    expect(obs.days[1]!.fastPolicy?.source).toBe('observed');
    expect(rows(obs, 1).kcal[12]).toBeGreaterThan(0);
  });

  it('a logged day keeps its meals inside a planned fast, takes no refeed ramp and carries coverage and daily resolution', () => {
    const observedB: DayTemplate = { ...PROGRAM_B, observed: { coverage: { energy: 'complete', protein: 'complete' }, resolution: 'eventPrefix', historyHash: 'h1' } };
    const s: Schedule = {
      ...repeatSchedule(6, [0, 0, 0, 0, 1, 0], [PROGRAM_B, observedB]),
      events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 72, refeed: 'auto' }],
      realised: { historyHash: 'h1', asOf: '2026-10-10T12:00:00Z', contractVersion: 1, throughDay: 5 },
    };
    const c = compileSchedule(s, p);
    const d4 = c.days[4]!;
    expect(d4.resolution).toBe('daily');
    expect(d4.coverage).toEqual({ energy: 'complete', protein: 'complete' });
    expect(d4.refeedFactor).toBe(1);
    expect(d4.meals[0]!.kcal).toBeGreaterThan(0); // 12:00 meal ends the planned fast (verified intake)
    expect(d4.mealDropMask ?? 0).toBe(0);
    const plain = compileSchedule(repeatSchedule(6, [0], [PROGRAM_B]), p);
    expect(d4.energyKcal).toBeCloseTo(plain.days[4]!.energyKcal, 9);
    expect(c.days[5]!.refeedFactor).toBeLessThan(1); // the prospective day after it keeps the prescribed ramp
    expect(c.realised).toEqual({ historyHash: 'h1', asOf: '2026-10-10T12:00:00Z', contractVersion: 1, throughDay: 5 });
    expect(c.days[0]!.resolution).toBeUndefined();
  });

  it('a modified-protocol fast is never a zero-intake mask: its permitted intake is kept, the fast is policy metadata', () => {
    const c = compileSchedule(base([{ kind: 'fast', startDay: 1, startH: 0, durationH: 48, protocol: 'modified', source: 'observed' }]), p);
    expect(c.fastSpans).toHaveLength(0);
    expect(c.days[1]!.mealDropMask ?? 0).toBe(0);
    expect(c.days[1]!.energyKcal).toBeGreaterThan(0);
    expect(c.days[1]!.fastPolicy).toEqual({ plannedDurationH: 48, startDay: 1, source: 'observed' });
  });
});

describe('D3-01 set groups through compile and hour expansion', () => {
  const rt = (groups: NonNullable<ResistanceSession['groups']>, extra: Partial<ResistanceSession> = {}) =>
    ({ kind: 'resistance', startH: 17, durationMin: 60, groups, ...extra }) as ResistanceSession;
  const day = (exercise: DayTemplate['exercise']): DayTemplate => ({ ...PROGRAM_B, exercise });
  /** Region-weighted raw sets per region summed over the day's hours, from the group columns. */
  const regionDose = (d: DayInput, t: DayHourTable): number[] => {
    const out = new Array<number>(9).fill(0);
    for (let h = 0; h < 24; h++)
      for (let g = 0; g < (d.nRtGroups ?? 0); g++) {
        const s = t.rtGroupSets[h * MAX_SET_GROUPS_PER_DAY + g]!;
        for (let k = 0; k < 9; k++) out[k]! += s * d.rtGroups![g]!.regionWeights[k]!;
      }
    return out;
  };

  it('legacy sessions keep the legacy hour path (no groups compiled, no group columns)', () => {
    const d = compileSchedule(one(PROGRAM_A), p).days[0]!;
    expect(d.nRtGroups).toBe(0);
    expect(d.rtGroups).toBeUndefined();
    const t = new DayHourTable();
    expandDayToHours(d, 23, 8, null, 0, t);
    expect(t.groupCols).toBe(0);
    expect(hourSum(t.rtGroupSets)).toBe(0);
  });

  it('each group keeps its own physical sets, weights, contraction, effort and timing; unknown effort stays NaN and flagged', () => {
    const c = compileSchedule(
      one(day([rt([
        { sets: 3, regionWeights: { chest: 1, shoulders: 0.5 }, contraction: 'dynamic', loadPct1RM: 75, rir: 1, restSec: 150 },
        { sets: 4, regionWeights: { quads: 1, glutes: 0.5 }, contraction: 'isometric', holdSec: 30 },
      ], { rir: 2 })])),
      p,
    );
    const d = c.days[0]!;
    expect(d.nRtGroups).toBe(2);
    expect(d.sessions[0]!.groupStart).toBe(0);
    expect(d.sessions[0]!.groupCount).toBe(2);
    const [a, b] = d.rtGroups!;
    expect(a).toMatchObject({ session: 0, sets: 3, contraction: 'dynamic', loadPct1RM: 75, rir: 1, restSec: 150, typeFactorIncluded: false, assumed: 0, startH: 17, durationMin: 60 });
    expect(b!.contraction).toBe('isometric');
    expect(b!.rir).toBe(2); // the session's reported RIR is inherited
    expect(b!.loadPct1RM).toBeNaN(); // unknown load is not a known hard intensity
    expect(b!.assumed).toBe(1);
    // legacy merged view for the other modules: region-weighted physical sets
    const s = d.sessions[0]!;
    expect(s.setsByRegion[TRAINING_REGIONS.indexOf('chest')]).toBeCloseTo(3, 12);
    expect(s.setsByRegion[TRAINING_REGIONS.indexOf('glutes')]).toBeCloseTo(2, 12);
    // hour columns: every group's sets are stepped exactly once over its duration
    const t = new DayHourTable();
    expandDayToHours(d, 23, 8, null, 0, t);
    expect(t.groupCols).toBe(2);
    expect(t.rtGroupSets[17 * MAX_SET_GROUPS_PER_DAY + 0]).toBeCloseTo(3, 12);
    expect(t.rtGroupSets[17 * MAX_SET_GROUPS_PER_DAY + 1]).toBeCloseTo(4, 12);
    const hi = newHourInput();
    loadHour(t, 17, hi);
    expect(hi.rtGroupSets![1]).toBeCloseTo(4, 12);
    loadHour(t, 18, hi);
    expect(hi.rtGroupSets![0]).toBe(0);
  });

  it('splitting identical groups and permuting groups leave the per-region dose unchanged', () => {
    const g = { regionWeights: { chest: 1, arms: 0.5 }, contraction: 'dynamic' as const, loadPct1RM: 70, rir: 2, restSec: 120 };
    const h = { regionWeights: { upperBack: 1, arms: 0.5 }, contraction: 'dynamic' as const, loadPct1RM: 80, rir: 1, restSec: 180 };
    const dose = (groups: Parameters<typeof rt>[0]) => {
      const d = compileSchedule(one(day([rt(groups)])), p).days[0]!;
      const t = new DayHourTable();
      expandDayToHours(d, 23, 8, null, 0, t);
      return regionDose(d, t);
    };
    const ref = dose([{ ...g, sets: 4 }, { ...h, sets: 3 }]);
    const split = dose([{ ...g, sets: 2 }, { ...g, sets: 2 }, { ...h, sets: 1 }, { ...h, sets: 2 }]);
    const perm = dose([{ ...h, sets: 3 }, { ...g, sets: 4 }]);
    for (let k = 0; k < 9; k++) {
      expect(split[k]).toBeCloseTo(ref[k]!, 12);
      expect(perm[k]).toBeCloseTo(ref[k]!, 12);
    }
  });

  it('more than four heterogeneous groups keep their dose (no slot overflow or averaging)', () => {
    const regions = TRAINING_REGIONS;
    const groups = regions.map((r, i) => ({ sets: i + 1, regionWeights: { [r]: 1 }, contraction: 'dynamic' as const, rir: i % 3, loadPct1RM: 60 + i }));
    const d = compileSchedule(one(day([rt(groups, { durationMin: 90 })])), p).days[0]!;
    expect(d.nRtGroups).toBe(9);
    const t = new DayHourTable();
    expandDayToHours(d, 23, 8, null, 0, t);
    const dose = regionDose(d, t);
    regions.forEach((r, i) => expect(dose[TRAINING_REGIONS.indexOf(r)]).toBeCloseTo(i + 1, 12));
    expect(d.rtGroups!.map((x) => x.rir)).toEqual(groups.map((x) => x.rir));
  });

  it('a bout crossing midnight is stepped once: today before midnight, the next day as a carried group (session −1)', () => {
    const s: Schedule = {
      ...repeatSchedule(2, [0, 1], [day([rt([{ sets: 6, regionWeights: { quads: 1 }, contraction: 'dynamic', rir: 1 }], { startH: 23.5 })]), PROGRAM_B]),
    };
    const c = compileSchedule(s, p);
    const d0 = c.days[0]!;
    const d1 = c.days[1]!;
    expect(d1.nRtGroups).toBe(1);
    expect(d1.rtGroups![0]!.session).toBe(-1);
    expect(d1.rtGroups![0]!.startH).toBeCloseTo(-0.5, 12);
    const t = new DayHourTable();
    expandDayToHours(d0, 23, 8, null, 0, t);
    const before = hourSum(t.rtGroupSets);
    expandDayToHours(d1, d0.sleepBedH, d0.sleepHours, null, 24, t, d0);
    const after = hourSum(t.rtGroupSets);
    expect(before).toBeCloseTo(3, 12);
    expect(after).toBeCloseTo(3, 12);
    expect(t.rtGroupSets[0 * MAX_SET_GROUPS_PER_DAY + 0]).toBeCloseTo(3, 12);
  });

  it('on a day with groups a legacy session becomes one merged group (legacy provenance), so nothing is stepped twice', () => {
    const d = compileSchedule(
      one(day([rt([{ sets: 3, regionWeights: { chest: 1 }, contraction: 'dynamic' }], { startH: 9 }), { kind: 'resistance', startH: 18, setsByRegion: { quads: 4, glutes: 2 } }])),
      p,
    ).days[0]!;
    expect(d.nRtGroups).toBe(2);
    const legacy = d.rtGroups![1]!;
    expect(legacy.session).toBe(1);
    expect(legacy.sets).toBeCloseTo(6, 12);
    expect(legacy.regionWeights[TRAINING_REGIONS.indexOf('quads')]! * legacy.sets).toBeCloseTo(4, 12);
    expect(legacy.typeFactorIncluded).toBe(true); // catalogue counts already contain the set-type factor
    expect(legacy.assumed).toBe(1);
    expect(legacy.rir).toBe(2);
  });

  it('notes (never silently loses) groups beyond MAX_SET_GROUPS_PER_DAY', () => {
    const many = Array.from({ length: MAX_SET_GROUPS_PER_DAY + 3 }, () => ({ sets: 1, regionWeights: { chest: 1 }, contraction: 'dynamic' as const }));
    const c = compileSchedule(one(day([rt(many, { durationMin: 200 })])), p);
    expect(c.days[0]!.nRtGroups).toBe(MAX_SET_GROUPS_PER_DAY);
    expect(c.notes.some((n) => n.code === 'setGroupsTruncated')).toBe(true);
  });
});

describe('D4-01 resolved per-day exposure (final values, coverage, known sums)', () => {
  it('a prescription states its own exposure; engine defaults are unknown, never a prescribed amount', () => {
    const d = compileSchedule(one(PROGRAM_A), p).days[0]!;
    const e = resolvedDayExposure(d);
    expect(e.energy).toEqual({ knownSum: d.energyKcal, unit: 'kcal', coverage: 'complete' });
    expect(e.fat!.knownSum).toBe(d.fatG);
    expect(e.satFat).toEqual({ knownSum: 0, unit: 'g', coverage: 'unknown' }); // default share of fat, not a stated amount
    expect(e.caffeine!.coverage).toBe('unknown'); // habitual caffeine is a profile default
    expect(e.ethanol).toEqual({ knownSum: 0, unit: 'g', coverage: 'complete' });
    const stated = compileSchedule(
      one({ ...PROGRAM_A, macros: { ...PROGRAM_A.macros, fatTypes: { satShare: 0.1 } }, substances: { caffeine: [{ clockH: 8, mg: 200 }], creatineG: 5 } }),
      p,
    ).days[0]!;
    const s = resolvedDayExposure(stated);
    expect(s.satFat!.coverage).toBe('complete');
    expect(s.satFat!.knownSum).toBeCloseTo(0.1 * stated.fatG, 9);
    expect(s.caffeine).toEqual({ knownSum: 200, unit: 'mg', coverage: 'complete' });
    expect(s.creatine).toEqual({ knownSum: 5, unit: 'g', coverage: 'complete' });
  });

  it('uses the final resolved values (refeed, fast suppression) and observed channel coverage', () => {
    const s: Schedule = { ...repeatSchedule(6, [0]), events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 72, refeed: 'auto' }] };
    const c = compileSchedule(s, p, { exposure: true });
    expect(c.days[2]!.exposure!.energy).toEqual({ knownSum: 0, unit: 'kcal', coverage: 'complete' });
    expect(c.days[5]!.exposure!.energy!.knownSum).toBeCloseTo(c.days[5]!.energyKcal, 9);
    // an observed day whose meals carry no event identity: nothing on it is an identified observation
    const obs = compileSchedule(one({ ...PROGRAM_B, observed: { coverage: { energy: 'partial', protein: 'partial' }, resolution: 'daily' } }), p).days[0]!;
    const e = resolvedDayExposure(obs);
    expect(e.energy).toEqual({ knownSum: 0, unit: 'kcal', coverage: 'partial' });
    expect(e.fat).toEqual({ knownSum: 0, unit: 'g', coverage: 'unknown' }); // no coverage statement = nothing known
    expect(e.mct!.coverage).toBe('unknown');
  });

  it('a partial observed day counts its logged events only; the imputed remainder never enters a known lower bound', () => {
    // one logged meal (event identity) and the realised history's imputed remainder on an open slot (no identity)
    const mixed = compileSchedule(
      one({
        ...PROGRAM_B,
        energy: { kind: 'kcal', kcal: 1500 },
        meals: {
          meals: [
            { clockH: 8, share: 600, energyKcal: 600, macros: { proteinG: 40, carbG: 60, fatG: 20 }, eventId: 'm1' },
            { clockH: 13, share: 900, energyKcal: 900, macros: { proteinG: 50, carbG: 100, fatG: 30 } },
          ],
        },
        observed: { coverage: { energy: 'partial', protein: 'partial', carbohydrate: 'partial', fat: 'partial' }, resolution: 'scenario' },
      }),
      p,
    ).days[0]!;
    expect(mixed.energyKcal).toBeCloseTo(1500, 9);
    const e = resolvedDayExposure(mixed);
    expect(e.energy).toEqual({ knownSum: 600, unit: 'kcal', coverage: 'partial' });
    expect(e.protein!.knownSum).toBeCloseTo(40, 9);
    expect(e.carbAvailable!.knownSum).toBeCloseTo(60, 9);
    expect(e.fat!.knownSum).toBeCloseTo(20, 9);
    // complete coverage: the day's resolved value is exact (no remainder exists on an attested-complete day)
    const done = compileSchedule(one({ ...PROGRAM_B, energy: { kind: 'kcal', kcal: 600 }, meals: { meals: [{ clockH: 8, share: 600, energyKcal: 600, macros: { proteinG: 40, carbG: 60, fatG: 20 }, eventId: 'm1' }] }, observed: { coverage: { energy: 'complete' }, resolution: 'daily' } }), p).days[0]!;
    expect(resolvedDayExposure(done).energy).toEqual({ knownSum: 600, unit: 'kcal', coverage: 'complete' });
  });

  it('runtime-resolved days are refreshed in place by the loop (the compile-time value is provisional)', () => {
    const cur: DayTemplate = { ...PROGRAM_B, energy: { kind: 'pctMaintenance', pct: 80, reference: 'current' } };
    const cs = compileSchedule({ ...repeatSchedule(10, [0], [cur]) }, p, { exposure: true });
    const before = cs.days[9]!.exposure!.energy;
    const provisional = before!.knownSum;
    runEngine(p, cs, { record: 'none' });
    expect(cs.days[9]!.exposure!.energy).toBe(before); // same object, refreshed without allocation
    expect(before!.knownSum).toBeCloseTo(cs.days[9]!.energyKcal, 9);
    expect(before!.knownSum).not.toBe(provisional);
  });
});

// ---------------------------------------------------------------- W1-core contributions (2026-10-18)

describe('D3-03/D3-07: interval phases, health class and steps scope travel to the resolved day', () => {
  const hiit: DayTemplate = {
    ...PROGRAM_B,
    exercise: [
      {
        kind: 'cardio', modality: 'hiit', startH: 18, durationMin: 20, healthIntensityClass: 'vigorous', stepsIncluded: 1500, sessionId: 'b1',
        phases: Array.from({ length: 20 }, (_, i) => ({ kind: i % 2 === 0 ? ('work' as const) : ('recovery' as const), durationMin: 1, pctVo2max: i % 2 === 0 ? 0.9 : 0.4 })),
      },
    ],
    steps: 9000,
    stepsScope: 'totalDay',
  };

  it('phases keep their own durations and intensities (never a session mean); the class is carried, unknown stays absent', () => {
    const d = compileSchedule(one(hiit), p).days[0]!;
    const s = d.sessions[0]!;
    expect(s.phases).toHaveLength(20);
    expect(s.phases!.reduce((a, ph) => a + ph.durationMin, 0)).toBe(s.durationMin);
    expect(s.phases!.filter((ph) => ph.kind === 'work').reduce((a, ph) => a + ph.durationMin, 0)).toBe(10);
    expect(s.healthIntensityClass).toBe('vigorous');
    const plain = compileSchedule(one({ ...PROGRAM_B, exercise: [{ kind: 'cardio', modality: 'run', startH: 7, durationMin: 30 }] }), p).days[0]!.sessions[0]!;
    expect(plain.phases).toBeUndefined();
    expect(plain.healthIntensityClass).toBeUndefined();
  });

  it('a total-day step count carries the session steps; an excludes-training count and legacy (unknown) scope do not invent overlap', () => {
    const d = compileSchedule(one(hiit), p).days[0]!;
    expect(d.steps).toBe(9000); // the reported total is never changed
    expect(d.stepsScope).toBe('totalDay');
    expect(d.sessionIncludedSteps).toBe(1500);
    const stated = compileSchedule(one({ ...hiit, sessionIncludedSteps: 1200 }), p).days[0]!;
    expect(stated.sessionIncludedSteps).toBe(1200);
    const legacy = compileSchedule(one({ ...hiit, stepsScope: undefined }), p).days[0]!;
    expect(legacy.stepsScope).toBeUndefined();
    // a day on habitual steps takes the profile's habitual scope
    const habScope = resolveProfile({ ...MAN, habits: { ...MAN.habits, stepsScope: 'excludesTraining' } });
    expect(compileSchedule(one(PROGRAM_B), habScope).days[0]!.stepsScope).toBe('excludesTraining');
    expect(compileSchedule(one({ ...PROGRAM_B, steps: 5000 }), habScope).days[0]!.stepsScope).toBeUndefined();
  });

  it('the profile keeps its steps scope and growth state through resolution (context fields are never dropped)', () => {
    const rp = resolveProfile({ ...MAN, habits: { ...MAN.habits, stepsScope: 'totalDay', trainingGrowthState: 'plateaued', trainingGrowthStateSource: 'user' } });
    expect(rp.habits.stepsScope).toBe('totalDay');
    expect(rp.habits.trainingGrowthState).toBe('plateaued');
    expect(rp.habits.trainingGrowthStateSource).toBe('user');
    expect(p.habits.stepsScope).toBeUndefined();
  });
});

describe('D6-07: carbohydrate mixture, duration and form travel with the intake event', () => {
  const meals = (extra: Record<string, unknown>): DayTemplate => ({
    ...PROGRAM_B,
    energy: { kind: 'kcal', kcal: 2000 },
    meals: { meals: [{ clockH: 8, macros: { carbG: 60 }, ...extra }, { clockH: 13 }, { clockH: 19 }] },
  });

  it('a stated mixture sets the meal split; an unknown remainder is simulated at the default mixture and kept as unknown', () => {
    const d = compileSchedule(one(meals({ carbComposition: { glucoseEqG: 20, fructoseG: 30 }, intakeDurationH: 0.5, form: 'liquid' })), p).days[0]!;
    const m = d.meals[0]!;
    expect(m.fructoseG).toBeGreaterThanOrEqual(30);
    expect(m.galactoseG).toBe(0);
    expect(m.glucoseEqG + m.fructoseG + m.galactoseG).toBeCloseTo(60, 9);
    expect(m.carbUnknownMixG).toBeCloseTo(10, 9);
    expect(m.intakeDurationH).toBe(0.5);
    expect(m.form).toBe('liquid');
    // the day's totals follow the meal (carbohydrate conserved)
    expect(d.glucoseEqG + d.fructoseG + d.galactoseG).toBeCloseTo(d.carbG, 6);
    const full = compileSchedule(one(meals({ carbComposition: { glucoseEqG: 25, fructoseG: 25, galactoseG: 10 } })), p).days[0]!;
    expect(full.meals[0]!.carbUnknownMixG).toBe(0);
    expect(full.meals[0]!.galactoseG).toBe(10);
    // without a stated mixture nothing changes and nothing is claimed
    const none = compileSchedule(one(meals({})), p).days[0]!;
    expect(none.meals[0]!.carbUnknownMixG).toBeUndefined();
    expect(none.meals[0]!.form).toBeUndefined();
  });

  it('a known during-session mixture is not forced into glucose; an unknown one stays the glucose scenario', () => {
    const ride = (comp?: Record<string, number>): DayTemplate => ({
      ...PROGRAM_B,
      exercise: [{ kind: 'cardio', modality: 'cycle', startH: 9, durationMin: 120, carbDuringGPerH: 90, ...(comp ? { carbDuringComposition: comp } : {}) }],
    });
    const base = compileSchedule(one(ride()), p).days[0]!;
    const known = compileSchedule(one(ride({ glucoseEqG: 60, fructoseG: 30 })), p).days[0]!;
    expect(base.sessions[0]!.carbDuringFructoseShare).toBeUndefined();
    expect(known.sessions[0]!.carbDuringFructoseShare).toBeCloseTo(1 / 3, 9);
    expect(known.exerciseCarbG).toBeCloseTo(180, 9);
    expect(known.carbG).toBeCloseTo(base.carbG, 9);
    expect(known.energyKcal).toBeCloseTo(base.energyKcal, 9);
    expect(known.fructoseG - base.fructoseG).toBeCloseTo(60, 6);
    expect(base.glucoseEqG - known.glucoseEqG).toBeCloseTo(60, 6);
    // an unknown remainder or inconsistent g/h keeps the mixture unknown
    expect(compileSchedule(one(ride({ glucoseEqG: 60, fructoseG: 20, unknownG: 10 })), p).days[0]!.sessions[0]!.carbDuringFructoseShare).toBeUndefined();
    expect(compileSchedule(one(ride({ fructoseG: 30 })), p).days[0]!.sessions[0]!.carbDuringFructoseShare).toBeUndefined();
  });
});

describe('D6-08: nut ME delta only for a stated form', () => {
  it('unknown nut form gets no almond delta; stated forms keep theirs; butter none', () => {
    const nuts = (food: DayTemplate['food']): number => compileSchedule(one({ ...PROGRAM_B, food }), p).days[0]!.nutDelta;
    expect(nuts({ nutsG: 30 })).toBe(0);
    expect(nuts({ nutsG: 30, nutForm: 'wholeRaw' })).toBeCloseTo(0.25, 9);
    expect(nuts({ nutsG: 30, nutForm: 'butter' })).toBe(0);
  });
});

describe('D6-03/D7-04: resolved exposure carries nutrient classes and active-ingredient doses with coverage', () => {
  it('stated fatty-acid classes / EPA+DHA / magnesium are known; engine defaults are unknown', () => {
    const stated = compileSchedule(one({ ...PROGRAM_B, macros: { ...PROGRAM_B.macros, fatTypes: { mufaShare: 0.4, pufaShare: 0.2, omega3G: 1.2 } }, hydration: { magnesiumMg: 420 } }), p, { exposure: true }).days[0]!;
    expect(stated.exposure!.mufa).toMatchObject({ coverage: 'complete', unit: 'g' });
    expect(stated.exposure!.epaDha).toMatchObject({ knownSum: 1.2, coverage: 'complete', unit: 'g' });
    expect(stated.exposure!.magnesium).toMatchObject({ knownSum: 420, coverage: 'complete', unit: 'mg' });
    const dflt = compileSchedule(one(PROGRAM_B), p, { exposure: true }).days[0]!;
    expect(dflt.exposure!.epaDha).toMatchObject({ knownSum: 0, coverage: 'unknown' });
    expect(dflt.exposure!.magnesium!.coverage).toBe('unknown');
  });

  it('actives aggregate by ingredient across products in canonical units and keep the largest single dose', () => {
    const tmpl: DayTemplate = {
      ...PROGRAM_B,
      substances: {
        actives: [
          { ingredient: 'epaDha', amount: 0.5, unit: 'g', clockH: 8, eventId: 'fishoil:1', origin: 'observed' },
          { ingredient: 'epaDha', amount: 500, unit: 'mg', clockH: 20, eventId: 'fishoil:2', origin: 'observed' },
          { ingredient: 'vitD', amount: 1250, unit: 'ug', clockH: 8, origin: 'planned' },
          { ingredient: 'nitrate', amount: 6.4, unit: 'mmol', clockH: 7, origin: 'planned' },
        ],
      },
    };
    const x = compileSchedule(one(tmpl), p, { exposure: true }).days[0]!.exposure!;
    expect(x['active:epaDha']).toMatchObject({ knownSum: 1000, unit: 'mg', coverage: 'complete' });
    expect(x['activePeak:epaDha']!.knownSum).toBe(500);
    // a weekly bolus stays a bolus: the peak equals the dose, never a daily average
    expect(x['activePeak:vitD']).toMatchObject({ knownSum: 1.25, unit: 'mg' });
    expect(x['active:nitrate:mmol']).toMatchObject({ knownSum: 6.4, unit: 'mmol' });
    // no actives: no invented entry
    expect(Object.keys(compileSchedule(one(PROGRAM_B), p, { exposure: true }).days[0]!.exposure!).some((k) => k.startsWith('active'))).toBe(false);
  });
});

describe('D8-06: an observed sleep episode maps to its wake date', () => {
  const sched = (days: DayTemplate[]): Schedule => ({ schemaVersion: 1, startDate: '2026-10-05', horizonDays: days.length, programs: days, days: days.map((_, i) => ({ program: i })) });
  const obs = (bedAt: string, wakeAt: string, extra: Record<string, unknown> = {}): DayTemplate => ({
    ...PROGRAM_B,
    sleep: { observed: { bedAt, wakeAt, tz: 'Europe/Berlin', ...extra } },
  });

  it('a short night ending Tuesday is Tuesday’s sleep (the night before in the hour expansion), not Wednesday’s', () => {
    // 2026-10-05 is a Monday (day 0); a 5 h night Mon 01:30 → Tue 06:30 local, logged on Tuesday's day
    const c = compileSchedule(sched([PROGRAM_B, obs('2026-10-06T01:30:00+02:00', '2026-10-06T06:30:00+02:00'), PROGRAM_B]), p);
    const [mon, tue, wed] = c.days as [DayInput, DayInput, DayInput];
    expect(tue.sleepEndingToday).toEqual({ bedClockH: 1.5, wakeClockH: 6.5, hours: 5, totalAsleepHours: 5, qualityStatus: 'unrated', coverage: 'complete' });
    expect(tue.sleepSource).toBe('observed');
    // the night that ends Tuesday is Monday's night in the hour expansion (bed clock ≥ 24 after midnight)
    expect(mon.sleepBedH).toBeCloseTo(25.5, 9);
    expect(mon.sleepHours).toBeCloseTo(5, 9);
    // Tuesday's own wake hour is the observed one; its own night is the usual one, Wednesday wakes from it
    expect(tue.sleepWakeH).toBeCloseTo(6.5, 9);
    expect(mon.sleepWakeH).toBe(p.habits.wakeTimeH);
    expect(tue.sleepBedH).toBe(p.habits.bedTimeH);
    expect(wed.sleepEndingToday!.hours).toBe(tue.sleepHours);
    const t = new DayHourTable();
    expandDayToHours(tue, mon.sleepBedH, mon.sleepHours, null, 0, t, mon);
    expect(Array.from(t.asleep.slice(0, 8))).toEqual([0, 0.5, 1, 1, 1, 1, 0.5, 0]);
  });

  it('the observed episode ending on day 0 initialises the carried sleep; instant duration survives DST', () => {
    // DST end in Berlin: 2026-10-25 03:00 → 02:00; 22:00 → 07:00 local is 10 h of instant time
    const c = compileSchedule({ ...sched([obs('2026-10-24T22:00:00+02:00', '2026-10-25T07:00:00+01:00'), PROGRAM_B]), startDate: '2026-10-25' }, p);
    expect(c.initialSleep).toEqual({ bedClockH: 22, sleepHours: 10, totalAsleepHours: 10, qualityStatus: 'unrated', coverage: 'complete' });
    expect(c.days[0]!.sleepEndingToday).toMatchObject({ bedClockH: -2, wakeClockH: 7, hours: 10 });
    // a prescription without observations starts from the usual night
    const plain = compileSchedule(sched([PROGRAM_B]), p);
    expect(plain.initialSleep).toBeUndefined();
    expect(plain.days[0]!.sleepEndingToday).toEqual({ bedClockH: p.habits.bedTimeH - 24, wakeClockH: p.habits.wakeTimeH, hours: 8 });
  });

  it('daytime sleep after a night shift and overlapping episodes are mapped by instants, never double-counted', () => {
    const day = compileSchedule(sched([PROGRAM_B, obs('2026-10-06T08:00:00+02:00', '2026-10-06T15:00:00+02:00')]), p).days;
    expect(day[1]!.sleepEndingToday).toMatchObject({ bedClockH: 8, wakeClockH: 15, hours: 7, totalAsleepHours: 7 });
    expect(day[0]!.sleepBedH).toBe(32);
    const two: DayTemplate = { ...PROGRAM_B, sleep: { observed: { bedAt: '2026-10-05T23:00:00+02:00', wakeAt: '2026-10-06T05:00:00+02:00', tz: 'Europe/Berlin' } } };
    const dup: DayTemplate = { ...PROGRAM_B, sleep: { observed: { bedAt: '2026-10-06T03:00:00+02:00', wakeAt: '2026-10-06T07:00:00+02:00', tz: 'Europe/Berlin' } } };
    const merged = compileSchedule(sched([two, dup]), p).days;
    expect(merged[1]!.sleepEndingToday).toMatchObject({ bedClockH: -1, wakeClockH: 7, hours: 8, totalAsleepHours: 8 });
  });

  it('a nap-only record stays partial (its hours are the known dose, the night keeps its planned timing); an untimed instant keeps planned clocks', () => {
    const nap = compileSchedule(sched([PROGRAM_B, { ...PROGRAM_B, sleep: { observed: { bedAt: '2026-10-06T14:00:00+02:00', wakeAt: '2026-10-06T14:30:00+02:00', tz: 'Europe/Berlin', kind: 'nap' } } }]), p).days;
    // A1-053: no full night is invented from a nap: the planned night is the timing scenario, the nap the observed dose
    expect(nap[1]!.sleepEndingToday).toMatchObject({ hours: 8, totalAsleepHours: 0.5, coverage: 'partial' });
    expect(nap[1]!.sleepSource).not.toBe('observed');
    expect(nap[0]!.sleepBedH).toBe(p.habits.bedTimeH);
    const untimed = compileSchedule(sched([PROGRAM_B, { ...PROGRAM_B, sleep: { observed: { bedAt: '2026-10-05T21:00:00Z', wakeAt: '2026-10-06T03:00:00Z' } } }]), p).days;
    expect(untimed[1]!.sleepEndingToday).toMatchObject({ bedClockH: p.habits.bedTimeH - 24, wakeClockH: p.habits.bedTimeH - 24 + 6, hours: 6, totalAsleepHours: 6 });
    expect(untimed[0]!.sleepHours).toBe(6);
  });
});

describe('D3-09: dose provenance survives compilation; a cardio CR-10 rating never becomes resistance effort', () => {
  const group = (provenance?: NonNullable<ResistanceSession['groups']>[number]['provenance']) =>
    ({ sets: 3, regionWeights: { quads: 1 }, contraction: 'dynamic', loadPct1RM: 70, rir: 2, restSec: 120, ...(provenance ? { provenance } : {}) }) as const;
  const rtDay = (g: ReturnType<typeof group>): DayTemplate => ({ ...PROGRAM_B, exercise: [{ kind: 'resistance', startH: 17, durationMin: 30, groups: [g] }] });

  it('an inferred or default dose field keeps the group flagged as assumed even when every number is present', () => {
    expect(compileSchedule(one(rtDay(group({ sets: 'inferred' }))), p).days[0]!.rtGroups![0]!.assumed).toBe(1);
    expect(compileSchedule(one(rtDay(group({ rir: 'default' }))), p).days[0]!.rtGroups![0]!.assumed).toBe(1);
    expect(compileSchedule(one(rtDay(group({ sets: 'reported', load: 'reported', rir: 'reported', rest: 'reported', regions: 'reported' }))), p).days[0]!.rtGroups![0]!.assumed).toBe(0);
    // raw numbers are kept as entered (no promotion, no invented %1RM)
    expect(compileSchedule(one(rtDay(group({ sets: 'inferred' }))), p).days[0]!.rtGroups![0]).toMatchObject({ sets: 3, loadPct1RM: 70, rir: 2 });
  });

  it('a minutes-only cardio bout rated on CR-10 keeps its rating and adds no hard sets', () => {
    const d = compileSchedule(one({ ...PROGRAM_B, exercise: [{ kind: 'cardio', modality: 'other', startH: 18, durationMin: 40, rpe: 6, rpeScale: 'cr10' }] }), p).days[0]!;
    const s = d.sessions[0]!;
    expect(s.kind).toBe('cardio');
    expect(s.rpe).toBe(6);
    expect(Array.from(s.setsByRegion).every((x) => x === 0)).toBe(true);
    expect(d.nRtGroups ?? 0).toBe(0);
  });
});

describe('D1-03: resolution passes body-fat lineage to the estimator (no double-counted girth evidence)', () => {
  const girths = { ...MAN.body, waistCm: 92, neckCm: 39 };

  it('a known Navy value of unknown lineage is collapsed with the current girths; demonstrably independent readings are kept', () => {
    const same = resolveProfile({ ...MAN, body: { ...girths, knownBodyFatPct: 20, knownBodyFatSource: 'navy' } });
    expect(same.body.fusion.collapsed?.some((c) => c.reason === 'sameSource')).toBe(true);
    expect(same.body.fusion.coverage).toBe('unvalidated');
    const indep = resolveProfile({
      ...MAN,
      body: {
        ...girths,
        knownBodyFatPct: 20,
        knownBodyFatSource: 'navy',
        knownBodyFatMeta: { observationId: 'bf:1', parentIds: ['girth:old'], measuredOn: '2026-08-01' },
        girthMeta: { observationId: 'girth:new', measuredOn: '2026-10-04' },
      },
    });
    expect(indep.body.fusion.collapsed?.some((c) => c.reason === 'sameSource') ?? false).toBe(false);
    expect(indep.body.fusion.observations.find((o) => o.id === 'known')).toMatchObject({ sourceObservationId: 'bf:1' });
  });
});
