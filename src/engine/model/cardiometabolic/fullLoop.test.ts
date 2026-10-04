// @vitest-environment node
/**
 * Full-engine tests of the cardiometabolic module (they depend on every module; module.test.ts / validation.test.ts drive
 * the module alone). Covers: wiring against the real registry, a smoke run with an ensemble draw, the MODEL_SPEC §3.4
 * baseline contract (every marker exactly at its baseline at t = 0 and flat weekly means over 90 d when the person repeats
 * the habitual week — habitual exercisers included), and the direction of the main interventions (06 §7, 04 §7, 20 §4.7).
 */
import { MODULES, checkWiring } from '../../core/moduleRegistry';
import { buildModelParams, sampleParams } from '../../core/paramsRegistry';
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayTemplate, ExerciseSession, PersonProfile, Schedule, SeriesId } from '../../types';
import { cardiometabolicModule } from './index';
import { MAN, repeatSchedule } from '../../core/__tests__/fixtures';

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const mean = (a: ArrayLike<number>, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]!;
  return s / (to - from);
};

describe('wiring and smoke', () => {
  it('no wiring issue for this module against the real registry (checkWiring)', () => {
    expect(checkWiring().issues.filter((i) => i.module === 'cardiometabolic')).toEqual([]);
    expect(MODULES.some((m) => m.id === 'cardiometabolic')).toBe(true);
  });

  it('60-day run with checks: every recorded cardiometabolic series exists, is finite, and t = 0 equals the baseline', () => {
    const profile = resolveProfile(MAN);
    const compiled = compileSchedule(repeatSchedule(60, [0, 1, 0, 1, 0, 1, 1]), profile);
    const r = runEngine(profile, compiled, { checks: true });
    for (const id of cardiometabolicModule.records) {
      const daily = r.daily[id];
      expect(daily).toBeDefined();
      for (let d = 0; d < 60; d++) expect(Number.isFinite(daily![d]!)).toBe(true);
      expect(Number.isFinite(r.initial[id]!)).toBe(true);
    }
    // baseline of the man of the fixture: NHANES generator (no labs) — LDL mmol/L ≈ 2.8
    near(r.initial.ldl!, 2.8, 0.4);
    near(r.initial.crp!, 1, 1e-9);
    near(r.initial.uricAcid!, 1, 1e-9);
    // the same run with the ensemble parameters stays finite
    const mp = buildModelParams(MODULES);
    const draw = sampleParams(mp.defs, { count: 1, seed: 9 })[0]!;
    const r2 = runEngine(profile, compiled, { paramOverrides: draw, record: 'daily' });
    expect(Number.isFinite(r2.daily.ldl![59]!)).toBe(true);
  });
});

type Act = 'sed' | 'rt' | 'cardio';
function person(age: number, bmi: number, act: Act): PersonProfile {
  const h = 1.76;
  return {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: age, heightCm: 176, weightKg: Math.round(bmi * h * h * 10) / 10 },
    habits: {
      typicalSteps: act === 'sed' ? 5000 : 7000,
      sessionsPerWeek: act === 'sed' ? 0 : act === 'rt' ? 3 : 4,
      lifingCardioMix: act === 'cardio' ? 1 : 0,
      trainingHistory: act === 'sed' ? 'none' : '1to3y',
    },
    startDate: '2026-10-05',
  };
}
/** Weekdays of the habitual week's sessions (core/compileSchedule.habitualWeek: session i on weekday ⌊7i/N⌋). */
const weekdays = (n: number): number[] => Array.from({ length: n }, (_, i) => Math.floor((7 * i) / n));
const RT: ExerciseSession = { kind: 'resistance', startH: 18, durationMin: 60, volume: 'moderate', style: 'general' };
// the habitual week's cardio session (core habitualWeek: 'other' at the §5.3 default intensity since 2026-09-30)
const CARDIO: ExerciseSession = { kind: 'cardio', modality: 'other', startH: 18, durationMin: 60 };

/** The person's habitual week as a schedule, optionally with other energy / macros / extra resistance sessions. */
function week(p: PersonProfile, act: Act, days: number, opt: { pct?: number; macros?: DayTemplate['macros']; addRt?: boolean } = {}): Schedule {
  const rp = resolveProfile(p);
  const habDays = weekdays(p.habits!.sessionsPerWeek ?? 0);
  const macros: DayTemplate['macros'] = opt.macros ?? {
    protein: { unit: 'g', value: rp.habitualProteinG },
    carbs: { unit: 'g', value: rp.habitualCarbG },
    fat: { unit: 'remainder' },
    fibre: { unit: 'g', value: rp.habitualFibreG },
  };
  const programs: DayTemplate[] = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const ex: ExerciseSession[] = [];
    if (habDays.includes(wd)) ex.push(act === 'rt' ? RT : CARDIO);
    if (opt.addRt && act !== 'rt' && weekdays(3).includes(wd)) ex.push({ ...RT, startH: 7 });
    return { id: `w${wd}`, label: `w${wd}`, energy: { kind: 'pctMaintenance', pct: opt.pct ?? 100 }, macros, meals: { count: 3, window: { startH: 8, lengthH: 12 } }, exercise: ex };
  });
  return { schemaVersion: 1, startDate: '2026-10-05', horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: d % 7 })) };
}
function run(p: PersonProfile, s: Schedule) {
  const rp = resolveProfile(p);
  return runEngine(rp, compileSchedule(s, rp), { record: 'daily' });
}

const MARKERS: readonly SeriesId[] = ['ldl', 'apoB', 'hdl', 'triglycerides', 'sbp', 'fastingGlucose', 'crp', 'uricAcid', 'liverFat'];

describe('baseline contract at habitual maintenance (MODEL_SPEC §3.4): t = 0 at baseline, no drift over 90 days', () => {
  for (const [age, bmi, act] of [[45, 27, 'sed'], [22, 20, 'cardio'], [70, 38, 'cardio']] as const) {
    it(`male ${age} y, BMI ${bmi}, ${act}: day-0 change ≈ 0 and weekly means flat (week 13 vs week 1)`, () => {
      const p = person(age, bmi, act);
      const r = run(p, week(p, act, 91));
      for (const id of MARKERS) {
        const d = r.daily[id]!;
        const init = r.initial[id]!;
        // before these fixes: liver fat +0.21 %-points on day 0 and +9 %/90 d, HDL −4.3 %, hs-CRP +7.6 %, SBP +1.2 mmHg
        expect(Math.abs(d[0]! / init - 1), `${id} day 0`).toBeLessThan(0.002);
        expect(Math.abs(mean(d, 84, 91) / mean(d, 0, 7) - 1), `${id} drift`).toBeLessThan(id === 'liverFat' ? 0.01 : 0.005);
      }
      // S_I is absolute and follows VO2max through F_fit, so it is checked where activity keeps VO2max steady (sedentary)
      if (act === 'sed') {
        const si = r.daily.insulinSensitivity!;
        expect(Math.abs(mean(si, 84, 91) / mean(si, 0, 7) - 1)).toBeLessThan(0.01);
      }
    });
  }
});

describe('direction of the main interventions (male 45 y, BMI 27, sedentary)', () => {
  const p = person(45, 27, 'sed');
  const base = run(p, week(p, 'sed', 60));
  const rel = (r: ReturnType<typeof run>, id: SeriesId, d: number) => r.daily[id]![d]! / base.daily[id]![d]!;

  it('25 % deficit + 2 g/kg protein + resistance 3×/wk: S_I ↑, LDL ↓, TG ↓, SBP ↓, liver fat ↓, fasting glucose ↓ (06 §7, 04 §7)', () => {
    const r = run(p, week(p, 'sed', 60, { pct: 75, addRt: true, macros: { protein: { unit: 'gPerKgBw', value: 2 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } } }));
    expect(rel(r, 'insulinSensitivity', 59)).toBeGreaterThan(1.2);
    expect(rel(r, 'ldl', 59)).toBeLessThan(0.97);
    expect(rel(r, 'triglycerides', 59)).toBeLessThan(0.9);
    expect(r.daily.sbp![59]! - base.daily.sbp![59]!).toBeLessThan(-3);
    expect(rel(r, 'liverFat', 59)).toBeLessThan(0.8);
    expect(rel(r, 'fastingGlucose', 59)).toBeLessThan(1);
    expect(rel(r, 'crp', 59)).toBeLessThanOrEqual(1);
  });

  it('very-low-carbohydrate maintenance (25 g/d): HDL ↑, TG ↓, and insulin sensitivity does not fall (04 §4.18 F_SFA domain, 04 §8 myth 10)', () => {
    const r = run(p, week(p, 'sed', 60, { macros: { protein: { unit: 'pctEnergy', value: 20 }, carbs: { unit: 'g', value: 25 }, fat: { unit: 'remainder' }, fibre: { unit: 'g', value: 15 } } }));
    expect(rel(r, 'hdl', 59)).toBeGreaterThan(1.05);
    expect(rel(r, 'triglycerides', 59)).toBeLessThan(0.9);
    expect(rel(r, 'insulinSensitivity', 59)).toBeGreaterThan(0.97);
  });

  it('72-h water fast: urate and LDL rise, fasting glucose falls, insulin sensitivity does not rise during the fast (20 §4.7)', () => {
    const s = week(p, 'sed', 35);
    // meal to meal (ruling 18:10): from day 7's 20:00 dinner (a meal inside the window would be dropped)
    s.events = [{ kind: 'fast', startDay: 7, startH: 20, durationH: 72 }];
    const r = run(p, s);
    expect(rel(r, 'uricAcid', 10)).toBeGreaterThan(1.03);
    expect(rel(r, 'ldl', 10)).toBeGreaterThan(1.02);
    expect(rel(r, 'fastingGlucose', 10)).toBeLessThan(0.9);
    // the zero-intake days 8 and 9 carry no F_EBh credit (a fast transiently lowers insulin sensitivity, 20 §4.7 [69, 23]);
    // the refeed days that follow are hypocaloric and get 04's 3-day energy-balance credit like any CR day
    for (const d of [8, 9]) expect(rel(r, 'insulinSensitivity', d)).toBeLessThan(1.01);
  });
});
