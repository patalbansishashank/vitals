/**
 * TEST-ONLY: BHB calibration targets of the coupled engine (integrator A2) — the fuel → ketones → fasting coupling
 * evaluated through the real input schema (`runKit`). Used by the integration tests and by the calibration probes.
 *
 * Fasting convention: the last meal is the habitual 20:00 dinner of day 0 (a maintenance day); the following days are
 * water-only programs covered by a FastEvent from 20:00 (durationH meal to meal, ruling of 2026-09-30 18:10), so no meal
 * is moved by the compiler. "t" = hours since the start of that last meal (dossier 05 §4.6 "time since last meal";
 * dossier 20 §4.3.4 counts from the start of zero intake ≈ 1 h later — within the ±3 h timing tolerance of 05 §7).
 */
import type { PersonProfile } from '../../../types/profile';
import type { DayTemplate, FastEvent } from '../../../types/schedule';
import { gramsCP, kitPerson, kitPersonWithTdee, kitSchedule, neutral, pctCP, program, runKit, waterDay, type KitRun } from './engineKit';

/** Dossier 20 Table A1-A3 reference people (maintenance TEE matched by the habitual step count). */
export const PEOPLE = {
  leanMan: kitPersonWithTdee({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 75, bodyFatPct: 15 }, 2633),
  leanWoman: kitPersonWithTdee({ sex: 'female', ageYears: 35, heightCm: 165, weightKg: 60, bodyFatPct: 25 }, 2015),
  obeseWoman: kitPersonWithTdee({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 100, bodyFatPct: 45 }, 2468),
  obeseMan: kitPersonWithTdee({ sex: 'male', ageYears: 45, heightCm: 178, weightKg: 115, bodyFatPct: 35 }, 3064),
} as const;

export const LAST_MEAL_H = 20;

/** Water-only fast of `fastDays` whole days after the day-0 dinner, then `refeedDays` of maintenance. */
export function runFast(person: PersonProfile, fastDays: number, refeedDays = 1, params?: Record<string, number>, extraFastH = 12): KitRun {
  const sex = person.body.sex;
  const total = 1 + fastDays + refeedDays;
  // meal to meal: dinner 20:00 day 0 → breakfast 08:00 of the first refeed day
  const ev: FastEvent = { kind: 'fast', startDay: 0, startH: LAST_MEAL_H, durationH: 24 * fastDays + extraFastH, refeed: 'none' };
  const sched = kitSchedule(total, [program('maint', 100, neutral(sex)), waterDay()], (d) => (d >= 1 && d <= fastDays ? 1 : 0), [ev]);
  return runKit(person, sched, params ? { params } : {});
}

/** BHB (hour mean) at t hours after the start of the day-0 dinner. */
export const bhbAt = (r: KitRun, t: number): number => r.probe.bhb[LAST_MEAL_H + t - 1]!;

// ================================================================================================ calibration targets

export interface TargetValue {
  name: string;
  /** Model value. */
  v: number;
  target: number;
  /** Tolerance (05 §7: ±30 % or ±0.15 mM for BHB; ±3 h for timing; the dossier row's own otherwise). */
  tol: number;
  /** Weight in the calibration objective. */
  w: number;
  source: string;
}

/** 05 §7 BHB tolerance: ±30 % or ±0.15 mM, whichever is larger. */
export const bhbTol = (t: number): number => Math.max(0.3 * t, 0.15);

const morningMean = (r: KitRun, d0: number, d1: number): number => {
  let s = 0;
  for (let d = d0; d < d1; d++) s += r.probe.bhb[24 * d + 7]!;
  return s / (d1 - d0);
};

export const PERSONS_05 = {
  /** Hall 2016 / Rosenbaum 2019: overweight men (validation 01-7.6 persona). */
  hall16: kitPerson({ sex: 'male', ageYears: 34, heightCm: 178, weightKg: 95, bodyFatPct: 30 }),
  /** Harvey 2019 reference body (validation MEN70). */
  men70: kitPerson({ sex: 'male', ageYears: 21, heightCm: 178, weightKg: 70, bodyFatPct: 13 }),
  /** Urbain & Bertz 2016 (validation 05-V9 persona; body fat from the body module). */
  urbain: kitPerson({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 88 }),
  /** Burke 2021 elite race walkers. */
  walker: kitPerson({ sex: 'male', ageYears: 28, heightCm: 178, weightKg: 68, bodyFatPct: 8 }),
  /** 05 §4.7 dose-response reference adult: 80 kg, 62 kg FFM. */
  man80: kitPerson({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 80, bodyFatPct: 22 }),
  /** Féry & Balasse 1983 / Deru young adult. */
  young: kitPerson({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 75, bodyFatPct: 15 }),
} as const;

/** Burke 2021 LCHF block: 45 g/d carbohydrate, 2.2 g/kg protein, 2 × 90 min walking at 60 % VO2max, energy = TEE. */
export function runBurke(params?: Record<string, number>): KitRun {
  const walks: DayTemplate['exercise'] = [
    { kind: 'cardio', modality: 'walk', startH: 7, durationMin: 90, pctVo2max: 0.6 },
    { kind: 'cardio', modality: 'walk', startH: 16, durationMin: 90, pctVo2max: 0.6 },
  ];
  const mk = (kcal: number): DayTemplate => ({ id: 'lchf', label: 'lchf', energy: { kind: 'kcal', kcal }, macros: gramsCP(2.2 * 68, 45), exercise: walks });
  // eucaloric (the study's athletes were in energy balance): intake = the model's own TEE of the training day
  const first = runKit(PERSONS_05.walker, kitSchedule(3, [mk(3000)], () => 0), params ? { params } : {});
  let tee = 0;
  for (let h = 24; h < 72; h++) tee += first.probe.teeKcalH[h]!;
  return runKit(PERSONS_05.walker, kitSchedule(7, [mk(Math.round(tee / 2))], () => 0), params ? { params } : {});
}

/** Evaluate the BHB calibration targets of the coupled engine (groups: fast, diet, exit, ex, vlc). */
export function evaluateTargets(params: Record<string, number> | undefined, groups: ReadonlySet<string>): TargetValue[] {
  const out: TargetValue[] = [];
  const add = (name: string, v: number, target: number, tol: number, w: number, source: string): void => {
    out.push({ name, v, target, tol, w, source });
  };
  const P = params && Object.keys(params).length ? params : undefined;
  if (groups.has('fast')) {
    const lm = runFast(PEOPLE.leanMan, 21, 1, P);
    add('lean man 12 h', bhbAt(lm, 12), 0.1, 0.15, 0.5, '05 V1 McDougal 2018');
    add('lean man 24 h', bhbAt(lm, 24), 0.5, 0.15, 1, 'ruling 18:10 (0.5 accepted); 05 §4.6 Deru 2024 0.56; 20 Browning M 0.41');
    add('lean man 30 h', bhbAt(lm, 30), 0.9, 0.27, 1, '05 V2 Haymond 1982 men');
    add('lean man 48 h', bhbAt(lm, 48), 1.65, 0.3, 1.5, '20 §4.3.4 / §4B.3 1.4-1.9');
    add('lean man 72 h', bhbAt(lm, 72), 2.5, 0.35, 1.5, '20 §4B.3 2.3-2.7; 05 V1 2.3');
    add('lean man day 7', bhbAt(lm, 168), 4.2, 0.6, 1.5, '20 BHB_ref d7 4.15; Kolnes d6 4.0');
    add('lean man day 8', bhbAt(lm, 192), 4.6, 0.7, 1, '20 V7 Ogłodek d8 4.77');
    add('lean man day 14', bhbAt(lm, 336), 5.5, 0.8, 1, '20 BHB_ref d14 5.30; Dai 2024 d10-15 5.36');
    add('lean man day 21', bhbAt(lm, 504), 6.2, 0.6, 1.5, '20 BHB_ref d21 5.73; Dai 2024 d21 6.61');
    let t05 = Number.NaN;
    for (let h = 0; h < 48; h++) {
      if (lm.probe.bhb[LAST_MEAL_H + h]! >= 0.5) {
        t05 = h + 1;
        break;
      }
    }
    add('lean man t(0.5 mM)', t05, 21.1, 3, 1, '05 V3 Deru 2021 rest 21.1 h (±3 h)');
    let auc = 0;
    for (let h = 0; h < 36; h++) auc += lm.probe.bhb[LAST_MEAL_H + h]!;
    add('lean man AUC 0-36 h', auc, 19.2, 5.76, 0.7, '05 V3 Deru 2021 rest AUC (mixed M/F cohort)');
    const ow = runFast(PEOPLE.obeseWoman, 24, 1, P);
    add('obese woman 48 h', bhbAt(ow, 48), 0.88, bhbTol(0.88), 0.7, '20 BHB_ref obese 48 h');
    add('obese woman 72 h', bhbAt(ow, 72), 2.0, 0.6, 1, '20 BHB_ref obese 1.68; 05 V4 Owen 3 d 2.23');
    add('obese woman day 7', bhbAt(ow, 168), 2.8, 0.84, 1, '20 BHB_ref obese d7 2.79');
    add('obese woman day 21', bhbAt(ow, 504), 4.5, 1.35, 1, '20 BHB_ref obese d21 4.48');
    add('obese woman day 24', bhbAt(ow, 576), 5.29, 1.59, 1, '05 V4 Owen & Reichard 1971 d24');
    const lw = runFast(PEOPLE.leanWoman, 3, 1, P);
    add('lean woman 24 h', bhbAt(lw, 24), 0.33, 0.15, 0.5, '20 V8 Browning F 0.33');
    add('lean woman 30 h', bhbAt(lw, 30), 1.3, 0.5, 0.3, '05 V2 Haymond F 1.7 (05 model 1.28; data conflict with Browning)');
    add('lean woman 48 h', bhbAt(lw, 48), 1.22, 0.37, 0.5, '20 V8 Browning F 1.22');
    add('lean woman 72 h', bhbAt(lw, 72), 2.3, 0.69, 0.5, '20 V8 / McDougal 2.3');
  }
  if (groups.has('diet')) {
    const hall = runKit(PERSONS_05.hall16, kitSchedule(56, [program('bd', 90, pctCP(15, 48.4)), program('kd', 90, pctCP(15, 5))], (d) => (d < 28 ? 0 : 1)), P ? { params: P } : {});
    add('Hall 2016 baseline 07:00', morningMean(hall, 21, 28), 0.1, 0.15, 0.5, '05 V5 baseline 0.09-0.11');
    add('Hall 2016 KD wk 3-4 07:00', morningMean(hall, 42, 56), 0.77, bhbTol(0.77), 1.5, '05 V5 Hall 2016 / Rosenbaum 2019');
    for (const [c, t] of [[5, 0.62], [15, 0.41], [25, 0.27]] as const) {
      const r = runKit(PERSONS_05.men70, kitSchedule(21, [program(`c${c}`, 100, pctCP(15, c))], () => 0), P ? { params: P } : {});
      add(`Harvey ${c} %E ΔBHB`, morningMean(r, 17, 21) - r.initial('bhb'), t, bhbTol(t), 1, '05 V6 Harvey 2019');
    }
    const ub = runKit(PERSONS_05.urbain, kitSchedule(42, [program('kd', 100, pctCP(15, 5))], () => 0), P ? { params: P } : {});
    let mn = Infinity;
    let mx = -Infinity;
    for (let h = 24 * 41; h < 24 * 42; h++) {
      mn = Math.min(mn, ub.probe.bhb[h]!);
      mx = Math.max(mx, ub.probe.bhb[h]!);
    }
    add('Urbain wk 6 min', mn, 0.33, bhbTol(0.33), 1, '05 V9 Urbain & Bertz 2016');
    add('Urbain wk 6 max', mx, 0.7, bhbTol(0.7), 1, '05 V9 Urbain & Bertz 2016');
    const bu = runBurke(P);
    add('Burke day 6 07:00', bu.probe.bhb[24 * 5 + 6]!, 1.2, bhbTol(1.2), 1, '05 V13 Burke 2021 (eucaloric)');
  }
  if (groups.has('vlc')) {
    // 05 §4.7 surface (80-kg / 62-kg-FFM adult, protein ≈ 1.3 g/kg, 3 meals): mixed diet for 7 d, then the VLC diet
    const man = PERSONS_05.man80;
    const sw = 7;
    const run = (carb: number, pct: number, prot = 104, days = 28): KitRun =>
      runKit(man, kitSchedule(sw + days, [program('mixed', 100, neutral('male')), program('vlc', pct, gramsCP(prot, carb))], (d) => (d < sw ? 0 : 1)), P ? { params: P } : {});
    const firstMorning = (r: KitRun): number => {
      for (let d = sw + 1; d < r.result.meta.nDays; d++) if (r.probe.bhb[24 * d + 7]! >= 0.5) return d - sw;
      return 30;
    };
    const mean24 = (r: KitRun, d: number): number => {
      let x = 0;
      for (let h = 24 * d; h < 24 * d + 24; h++) x += r.probe.bhb[h]! / 24;
      return x;
    };
    for (const [c, pct, t] of [[20, 100, 2], [30, 100, 2], [50, 100, 3], [20, 75, 2], [30, 75, 2], [50, 75, 2]] as const) {
      const r = run(c, pct, 104, c === 30 ? 28 : 10);
      // 05 §4.7: the surface's model reaches 0.5 mM on day 2-3 at ≤ 50 g/d; Harvey 2018 (3-6 %E): cohort mean on day 4
      add(`VLC ${c} g ${pct} %: first 07:00 ≥ 0.5 (d)`, firstMorning(r), t + 1, 1.5, 0.7, '05 §4.7 table (day 2-3 at ≤ 50 g/d); Harvey 2018 day 4');
      if (c === 30) {
        add(`VLC 30 g ${pct} %: wk-4 07:00`, r.probe.bhb[24 * (sw + 27) + 7]!, pct === 100 ? 0.64 : 1.04, bhbTol(pct === 100 ? 0.64 : 1.04), 1, '05 §4.7 surface');
        add(`VLC 30 g ${pct} %: wk-4 24-h mean`, mean24(r, sw + 27), pct === 100 ? 0.43 : 0.68, bhbTol(pct === 100 ? 0.43 : 0.68), 1, '05 §4.7 surface');
      }
    }
    const hp = run(30, 100, 0.3 * 2500 / 4, 21); // 30 %E protein (≈ 190 g) at 30 g carbohydrate
    add('VLC 30 g, 30 %E protein: wk-3 07:00 ≥ 0.5 of the 104-g value', hp.probe.bhb[24 * (sw + 20) + 7]!, 0.6, 0.25, 0.5, '05 §4.8 (1.2-2.2 g/kg still 0.8-1.5 mM in diet data; model −25 %)');
  }
  if (groups.has('exit')) {
    // Deru 2024: 24-h fast (dinner 20:00 → 110 g dextrose at 20:00), then fasting again
    const dex: DayTemplate = { id: 'dex', label: 'dex', energy: { kind: 'kcal', kcal: 440 }, macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 110 }, fat: { unit: 'g', value: 0 } }, meals: { meals: [{ clockH: 20, share: 1 }] } };
    const sched = kitSchedule(4, [program('m', 100, neutral('male')), dex, waterDay()], (d) => (d === 1 ? 1 : d === 2 ? 2 : 0), [
      { kind: 'fast', startDay: 0, startH: 20, durationH: 24 },
      { kind: 'fast', startDay: 1, startH: 20, durationH: 36 },
    ]);
    const r = runKit(PEOPLE.leanMan, sched, P ? { params: P } : {});
    add('Deru 2024 pre (24 h)', r.probe.bhb[43]!, 0.59, bhbTol(0.59), 1, '05 V7');
    add('Deru 2024 +1 h', r.probe.bhb[44]!, 0.28, 0.15, 1.5, '05 V7');
    add('Deru 2024 +4 h', r.probe.bhb[47]!, 0.19, 0.15, 1, '05 V7');
    add('Deru 2024 +14 h', r.probe.bhb[57]!, 0.44, 0.15, 1, '05 V7');
  }
  if (groups.has('ex')) {
    // Féry & Balasse 1983: overnight fast, 2 h walking at 50 % VO2max from 08:00, first meal 12:00 (TKB compared)
    const late = program('late', 100, neutral('male'), {
      meals: { meals: [{ clockH: 12, share: 0.34 }, { clockH: 16, share: 0.33 }, { clockH: 20, share: 0.33 }] },
      exercise: [{ kind: 'cardio', modality: 'walk', startH: 8, durationMin: 120, pctVo2max: 0.5 }],
    });
    const r = runKit(PERSONS_05.young, kitSchedule(2, [late], () => 0), P ? { params: P } : {});
    add('Féry TKB pre', r.probe.tkb[7]!, 0.2, 0.15, 0.5, '05 V10');
    add('Féry TKB end of walk', r.probe.tkb[9]!, 0.39, 0.15, 1, '05 V10');
    add('Féry TKB +30 min', r.probe.tkb[10]!, 0.93, 0.28, 1, '05 V10');
  }
  return out;
}
