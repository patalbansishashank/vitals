// @vitest-environment node
/**
 * Input-side contract additions of the 2026-09-30 integration pass (MODEL_SPEC §5.2, §5.4): meal-to-meal fast
 * semantics (ruling 18:10), per-fast refeed descriptor, MCT at 8.3 kcal/g, cholesterol / DASH / sauna / cold-water
 * immersion / adherence levers, habitual alcohol in the burn-in template, menopause default, and the casual path.
 */
import { compileSchedule, DayHourTable, expandDayToHours, habitualTemplate, habitualWeek, loadHour, newHourInput, resolveDayInPlace } from '../compileSchedule';
import { defaultMenopause, resolveProfile } from '../resolveProfile';
import { ATWATER, DEFAULTS } from '../defaults';
import type { DayInput } from '../../types/inputs';
import type { DayTemplate, Schedule } from '../../types/schedule';
import type { PersonProfile } from '../../types/profile';
import { MAN, WOMAN } from './fixtures';

const p = resolveProfile(MAN);
const EAT: DayTemplate = {
  id: 'E',
  label: 'eat',
  energy: { kind: 'pctMaintenance', pct: 100 },
  macros: { protein: { unit: 'pctEnergy', value: 20 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
};
const sched = (n: number, extra: Partial<Schedule> = {}, programs: DayTemplate[] = [EAT]): Schedule => ({
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: n,
  programs,
  days: Array.from({ length: n }, () => ({ program: 0 })),
  ...extra,
});

/** Absolute hours with intake in the hour table of every day (meal rows), for meal-to-meal checks. */
function intakeHours(c: ReturnType<typeof compileSchedule>): number[] {
  const mask = new Uint8Array(c.nDays * 24);
  for (const sp of c.fastSpans) for (let h = sp.startHour; h < sp.endHour; h++) mask[h] = 1;
  const t = new DayHourTable();
  const out: number[] = [];
  for (const d of c.days) {
    expandDayToHours(d, 23, 8, mask, d.day * 24, t);
    for (let h = 0; h < 24; h++) if (t.kcal[h]! > 0) out.push(d.day * 24 + h);
  }
  return out;
}

describe('fast events: durationH is meal to meal (ruling 18:10)', () => {
  it('a 24-h fast after a 19:00 dinner is exactly 24 h between intake hours, not 23 or 25', () => {
    const c = compileSchedule(sched(4, { events: [{ kind: 'fast', startDay: 1, startH: 19, durationH: 24 }] }), p);
    expect(c.fastSpans).toHaveLength(1);
    const sp = c.fastSpans[0]!;
    expect(sp.startHour).toBe(44); // day 1 20:00
    expect(sp.endHour).toBe(67); // day 2 19:00 is the first intake hour
    expect(sp.mealToMealH).toBe(24);
    const hrs = intakeHours(c);
    const before = hrs.filter((h) => h < sp.startHour).pop()!;
    const after = hrs.find((h) => h >= sp.endHour)!;
    expect(before).toBe(43);
    expect(after).toBe(67);
    expect(after - before).toBe(24);
    // day 2's breakfast and lunch are inside the window → dropped (A2 request: never relocated as a bolus); dinner stays
    expect(c.days[2]!.energyKcal).toBeCloseTo(c.days[0]!.energyKcal / 3, 6);
    expect([0, 1, 2].map((i) => c.days[2]!.meals[i]!.kcal > 0)).toEqual([false, false, true]);
    expect(c.days[2]!.sodiumMg).toBeCloseTo(c.days[0]!.sodiumMg / 3, 6); // sodium follows the food that is eaten
  });

  it('the planner encoding (startH = first hour after the last meal, durationH = nominal − 1) still yields the nominal meal-to-meal gap', () => {
    const c = compileSchedule(sched(4, { events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 23 }] }), p);
    expect(c.fastSpans[0]!.mealToMealH).toBe(24);
  });

  it('handles fractional boundaries: intake is allowed exactly at both edges and nowhere between', () => {
    const c = compileSchedule(sched(4, { events: [{ kind: 'fast', startDay: 1, startH: 18.5, durationH: 24.25 }] }), p);
    const sp = c.fastSpans[0]!;
    expect(sp.startHour).toBe(43);
    expect(sp.endHour).toBe(66);
    // window (day 1 18:30, day 2 18:45): day 1's 19:00 dinner and day 2's breakfast and lunch are strictly inside → dropped;
    // day 2's 19:00 dinner is outside. The actual meal-to-meal gap is then lunch 13:30 → dinner 19:00 next day.
    expect(c.days[1]!.meals[2]!.kcal).toBe(0);
    expect(c.days[2]!.meals[0]!.kcal).toBe(0);
    expect(c.days[2]!.meals[1]!.kcal).toBe(0);
    expect(c.days[2]!.meals[2]!.kcal).toBeGreaterThan(0);
    expect(sp.mealToMealH).toBeCloseTo(29.5, 9);
    // a meal exactly at the boundary is kept
    const exact = compileSchedule(sched(4, { events: [{ kind: 'fast', startDay: 1, startH: 19, durationH: 24 }] }), p);
    expect(exact.days[1]!.meals[2]!.kcal).toBeGreaterThan(0);
  });

  it('a fast starting at 00:00 of a day drops that day\'s meals instead of stacking them at 00:00 (A2 bug report)', () => {
    const c = compileSchedule(sched(4, { events: [{ kind: 'fast', startDay: 1, startH: 0, durationH: 36 }] }), p);
    const t = new DayHourTable();
    const mask = new Uint8Array(4 * 24);
    for (const sp of c.fastSpans) for (let h = sp.startHour; h < sp.endHour; h++) mask[h] = 1;
    expandDayToHours(c.days[1]!, 23, 8, mask, 24, t);
    expect(Math.max(...Array.from(t.kcal))).toBe(0); // no bolus anywhere on the fasted day
    expect(c.days[1]!.energyKcal).toBe(0);
    // the fast ends day 2 12:00: the 13:30 and 19:00 meals of day 2 are kept at their planned size, breakfast is dropped
    expect([0, 1, 2].map((i) => c.days[2]!.meals[i]!.kcal > 0)).toEqual([false, true, true]);
    expect(c.days[2]!.energyKcal).toBeCloseTo((2 * c.days[0]!.energyKcal) / 3, 6);
  });

  it('a multi-day fast from mid-day to mid-day keeps the meals before and after the window and zeroes the days between', () => {
    const c = compileSchedule(sched(6, { events: [{ kind: 'fast', startDay: 1, startH: 13.5, durationH: 48 }] }), p);
    expect([0, 1, 2].map((i) => c.days[1]!.meals[i]!.kcal > 0)).toEqual([true, true, false]);
    expect(c.days[2]!.zeroIntake).toBe(true);
    // the fast ends day 3 13:30: breakfast dropped, the 13:30 meal (exactly at the boundary) and dinner kept
    expect(c.days[3]!.energyKcal).toBeCloseTo((2 * c.days[0]!.energyKcal) / 3, 6);
    expect(c.fastSpans[0]!.mealToMealH).toBeCloseTo(48, 9);
  });

  it('a fast shorter than one whole hour masks nothing', () => {
    const c = compileSchedule(sched(2, { events: [{ kind: 'fast', startDay: 0, startH: 19, durationH: 0.5 }] }), p);
    expect(c.fastSpans).toHaveLength(0);
  });

  it('per-fast refeed descriptor: custom factors replace the tier ramp and are reported on the span', () => {
    const base = compileSchedule(sched(8), p);
    const c = compileSchedule(sched(8, { events: [{ kind: 'fast', startDay: 1, startH: 19, durationH: 72, refeedFactors: [0.6, 0.8] }] }), p);
    const end = Math.floor((1 * 24 + 19 + 72) / 24);
    expect(c.days[end]!.refeedFactor).toBeCloseTo(0.6, 9);
    // the fast ends at 19:00 on that day: only its dinner is eaten, at 60 % of plan
    expect(c.days[end]!.energyKcal).toBeCloseTo((0.6 * base.days[end]!.energyKcal) / 3, 6);
    expect(c.days[end + 1]!.energyKcal).toBeCloseTo(0.8 * base.days[end + 1]!.energyKcal, 6);
    expect(c.days[end + 2]!.refeedFactor).toBe(1);
    expect(c.fastSpans[0]).toMatchObject({ refeed: 'auto', refeedDays: 2 });
    const none = compileSchedule(sched(8, { events: [{ kind: 'fast', startDay: 1, startH: 19, durationH: 72 }] }), p);
    expect(none.fastSpans[0]).toMatchObject({ refeed: 'none', refeedDays: 0 });
    expect(none.days[end]!.refeedFactor).toBe(1);
  });

  it('runtime re-resolution keeps the refeed factor and the fast-adjusted meal clocks', () => {
    const tmpl: DayTemplate = { ...EAT, energy: { kind: 'pctMaintenance', pct: 100, reference: 'current' } };
    const c = compileSchedule(sched(6, { events: [{ kind: 'fast', startDay: 1, startH: 19, durationH: 60, refeed: 'auto' }] }, [tmpl]), p);
    const end = Math.floor((24 + 19 + 60) / 24);
    const d = c.days[end]!;
    const clocks = Array.from({ length: d.nMeals }, (_, i) => d.meals[i]!.clockH);
    resolveDayInPlace(d, { maintenanceKcal: 2000, bodyMassKg: 80, ffmKg: 60 }, p);
    expect(d.energyKcal).toBeCloseTo(0.5 * 2000, 6);
    expect(Array.from({ length: d.nMeals }, (_, i) => d.meals[i]!.clockH)).toEqual(clocks);
  });
});

describe('energy convention: MCT at 8.3 kcal/g (05 §4.17)', () => {
  it('fat taking the remainder keeps the day at its energy target with MCT counted at 8.3', () => {
    const tmpl: DayTemplate = { ...EAT, energy: { kind: 'kcal', kcal: 2400 }, macros: { ...EAT.macros, fatTypes: { mctG: 30 } } };
    const d = compileSchedule(sched(1, {}, [tmpl]), p).days[0]!;
    expect(d.mctG).toBeCloseTo(30, 9);
    expect(d.energyKcal).toBeCloseTo(2400, 6);
    const conv = ATWATER.protein * d.proteinG + ATWATER.carb * d.carbG + ATWATER.fat * (d.fatG - d.mctG) + ATWATER.mct * d.mctG + ATWATER.fibre * d.fibreG;
    expect(conv).toBeCloseTo(d.energyKcal, 6);
    let meals = 0;
    for (let i = 0; i < d.nMeals; i++) meals += d.meals[i]!.kcal;
    expect(meals).toBeCloseTo(d.energyKcal, 6);
  });
});

describe('new optional inputs are compiled with defaults', () => {
  it('cholesterol, DASH fraction, sauna, cold-water immersion and adherence levers', () => {
    const tmpl: DayTemplate = {
      ...EAT,
      food: { cholesterolMg: 450, dashFraction: 1.4 },
      modifiers: { saunaSessionsPerWeek: 3 },
      exercise: [{ kind: 'resistance', startH: 17, volume: 'moderate', coldWaterImmersion: true }],
    };
    const c = compileSchedule(sched(1, { adherence: { selfMonitoring: true, preMealWater: true } }, [tmpl]), p);
    const d = c.days[0]!;
    expect(d.cholesterolMg).toBe(450);
    expect(d.dashFraction).toBe(1);
    expect(d.saunaSessionsPerWeek).toBe(3);
    expect(d.sessions[0]!.coldWaterImmersion).toBe(true);
    expect(c.adherence).toEqual({ selfMonitoring: true, mealReplacement: false, preMealWater: true, flexibleRestraint: false });
    const plain = compileSchedule(sched(1), p);
    const e = plain.days[0]!;
    expect(Number.isNaN(e.cholesterolMg!)).toBe(true);
    expect(Number.isNaN(e.dashFraction!)).toBe(true);
    expect(e.saunaSessionsPerWeek).toBe(0);
    expect(e.refeedFactor).toBe(1);
    expect(plain.adherence).toEqual({ selfMonitoring: false, mealReplacement: false, preMealWater: false, flexibleRestraint: false });
  });
});

describe('casual path: energy %, macro split, eating window and training yes/no only', () => {
  const casual: DayTemplate = {
    id: 'C',
    label: 'casual',
    energy: { kind: 'pctMaintenance', pct: 85 },
    macros: { protein: { unit: 'pctEnergy', value: 25 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } },
    meals: { window: { startH: 12, lengthH: 8 } },
    exercise: [{ kind: 'resistance', startH: 18 }],
  };
  it('gives a complete DayInput with every numeric field finite (NaN only where NaN means "not given")', () => {
    const d = compileSchedule(sched(1, {}, [casual]), p).days[0]!;
    const nanAllowed = new Set(['energyDensityKcalPerG', 'fluidL', 'cholesterolMg', 'dashFraction', 'energyPct']);
    for (const [k, v] of Object.entries(d as unknown as Record<string, unknown>)) {
      if (typeof v === 'number' && !nanAllowed.has(k)) expect(Number.isFinite(v), k).toBe(true);
    }
    // R-MAINT: 85 % of the maintenance at the planned activity (the session raises the reference above TDEE0)
    expect(d.maintenanceKcal).toBeCloseTo(p.tdee0Kcal + d.activityAdjKcal!, 6);
    expect(d.energyKcal).toBeCloseTo(0.85 * d.maintenanceKcal, 6);
    expect(d.nMeals).toBe(DEFAULTS.mealsPerDay);
    expect(d.nSessions).toBe(1);
    expect(d.sessions[0]!.durationMin).toBeGreaterThan(0);
    expect(d.fibreG).toBeCloseTo((DEFAULTS.fibreGPer1000Kcal * d.energyKcal) / 1000, 1);
    // sodium follows the food: the habitual sodium density per kcal when the template sets none (A1 request)
    expect(d.sodiumMg).toBeCloseTo((p.habitualSodiumMg * d.energyKcal) / p.tdee0Kcal, 6);
  });

  it('an explicit sodium wins; a water-only day keeps the habitual (electrolyte) sodium', () => {
    const explicit = compileSchedule(sched(1, {}, [{ ...casual, hydration: { sodiumG: 2 } }]), p).days[0]!;
    expect(explicit.sodiumMg).toBe(2000);
    const zero = compileSchedule(sched(1, {}, [{ ...casual, energy: { kind: 'zero' } }]), p).days[0]!;
    expect(zero.sodiumMg).toBe(p.habitualSodiumMg);
    // a day at 100 % of the habitual-activity maintenance eats the habitual food, hence the habitual sodium
    const maint = compileSchedule(sched(1, {}, [{ ...casual, energy: { kind: 'pctMaintenance', pct: 100, activity: 'habitual' } }]), p).days[0]!;
    expect(maint.sodiumMg).toBeCloseTo(p.habitualSodiumMg, 6);
  });
});

describe('profile-side defaults', () => {
  it('habitual alcohol enters the burn-in template inside TDEE0', () => {
    const drinker: PersonProfile = { ...MAN, habits: { ...MAN.habits, habitualAlcoholDrinksPerWeek: 7 } };
    const rp = resolveProfile(drinker);
    expect(habitualTemplate(rp).substances?.alcohol?.[0]?.drinks).toBeCloseTo(1, 9);
    for (const d of habitualWeek(rp) as DayInput[]) {
      expect(d.alcoholG).toBeCloseTo(DEFAULTS.gramsPerDrink, 9);
      expect(d.energyKcal - 4 * d.exerciseCarbG).toBeCloseTo(rp.tdee0Kcal, 6);
    }
  });

  it('menopause defaults from age (16 §4.7: < 50 pre, 50-53 peri, ≥ 54 post) unless entered', () => {
    expect(defaultMenopause('female', 49)).toBe('pre');
    expect(defaultMenopause('female', 51)).toBe('peri');
    expect(defaultMenopause('female', 70)).toBe('post');
    expect(defaultMenopause('male', 70)).toBe('pre');
    expect(resolveProfile({ ...WOMAN, body: { ...WOMAN.body, ageYears: 70 } }).menopause).toBe('post');
    expect(resolveProfile({ ...WOMAN, body: { ...WOMAN.body, ageYears: 70 }, menopause: 'pre' }).menopause).toBe('pre');
  });

  it('smoker and habitual liquid energy / energy density resolve with defaults', () => {
    expect(p.habits.smoker).toBe(false);
    expect(Number.isNaN(p.habits.habitualLiquidKcal)).toBe(true);
    expect(Number.isNaN(p.habits.habitualEnergyDensityKcalPerG)).toBe(true);
    const s = resolveProfile({ ...MAN, habits: { ...MAN.habits, smoker: true, habitualLiquidKcal: 300 } });
    expect(s.habits.smoker).toBe(true);
    expect(s.habits.habitualLiquidKcal).toBe(300);
  });
});

describe('hour expansion: group-wise reuse is exact (performance change, integration 2026-09-30)', () => {
  const FIELDS = [
    'kcal', 'proteinG', 'carbG', 'glucoseEqG', 'fructoseG', 'galactoseG', 'fatG', 'satFatG', 'mctG', 'fibreG', 'alcoholG',
    'proteinQMeal', 'proteinSpeed', 'timeToPeakH', 'glycaemicIndex', 'mealStart', 'caffeineMg', 'exoKetoneG', 'exMin',
    'exIntensityFrac', 'exModality', 'exMet', 'exCarbDuringGPerMin', 'exCarbG', 'rtSetsTotal', 'rtRir', 'rtLoadPct1RM',
    'rtToFailure', 'steps', 'asleep', 'plannedFast', 'electrolytes',
  ] as const;
  it('a reused table equals a fresh expansion and every HourInput row equals its table row', () => {
    const programs: DayTemplate[] = [
      { ...EAT, exercise: [{ kind: 'resistance', startH: 17.5, volume: 'high' }], substances: { caffeine: [{ clockH: 7, mg: 100 }, { clockH: 15, mg: 80 }], alcohol: [{ clockH: 20, drinks: 2 }] } },
      { ...EAT, meals: { count: 5, window: { startH: 7, lengthH: 13 } }, exercise: [{ kind: 'cardio', modality: 'run', startH: 6.25, durationMin: 50, carbDuringGPerH: 30 }] },
      { ...EAT, energy: { kind: 'zero' } },
      { ...EAT, substances: { exogenousKetones: [{ clockH: 9, gBhb: 12, form: 'ester' }] } },
    ];
    const c = compileSchedule(
      { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 12, programs, days: Array.from({ length: 12 }, (_, d) => ({ program: (d * 3) % 4 })), events: [{ kind: 'fast', startDay: 5, startH: 19, durationH: 30 }] },
      p,
    );
    const mask = new Uint8Array(12 * 24);
    for (const sp of c.fastSpans) for (let h = sp.startHour; h < sp.endHour; h++) mask[h] = 1;
    const reused = new DayHourTable();
    const out = newHourInput();
    for (const d of c.days) {
      expandDayToHours(d, 23, 8, mask, d.day * 24, reused);
      const fresh = new DayHourTable();
      expandDayToHours(d, 23, 8, mask, d.day * 24, fresh);
      for (const f of FIELDS) expect(Array.from(reused[f]), `${f} day ${d.day}`).toEqual(Array.from(fresh[f]));
      expect(Array.from(reused.rtSetsByRegion)).toEqual(Array.from(fresh.rtSetsByRegion));
      for (let h = 0; h < 24; h++) {
        loadHour(reused, h, out);
        for (const f of FIELDS) expect(out[f], `${f} d${d.day} h${h}`).toBe(reused[f][h]);
        for (let k = 0; k < 9; k++) expect(out.rtSetsByRegion[k]).toBe(reused.rtSetsByRegion[h * 9 + k]);
      }
    }
  });
});
