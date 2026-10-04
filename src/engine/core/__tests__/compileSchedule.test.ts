// @vitest-environment node
import { compileSchedule, DayHourTable, expandDayToHours, resolveDayInPlace } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { runEngine } from '../loop';
import { MODULES } from '../moduleRegistry';
import { defineModule } from '../moduleKit';
import { ATWATER, RT_PRESETS } from '../defaults';
import type { AnyEngineModule } from '../../types/module';
import type { DayTemplate, Schedule } from '../../types/schedule';
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
      for (let d = 0; d < 14; d++) {
        const a = JSON.stringify({ ...fix[d]!, ...cal });
        const b = JSON.stringify({ ...week[(rp.startWeekday + d) % 7]!, ...cal });
        expect(a === b, `day ${d} differs from habitualWeek`).toBe(true);
      }
    }
  });
});
