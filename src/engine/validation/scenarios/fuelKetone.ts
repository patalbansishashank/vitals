/**
 * Dossiers 04 (carbohydrate, glycogen, insulin) and 05 (fat oxidation, ketosis): the end-to-end targets of MODEL_SPEC §9.2
 * rows 04 (M) and 05 (M after the R-KET retune; V8, V11 fed Cmax, V14, V15, Neudorf lean 48 h and chronic MCT are K).
 *
 * BHB rows use dossier 05's own tolerance: ±30 % or ±0.15 mM, whichever is larger. Hourly rows read the `full` record.
 * Studies that report concentrations in mmol/kg or mmol/L convert with the dossier's conversion (glycogen 0.162 g/mmol) or use
 * ratios to the study's own starting value, so the engine's whole-body gram pools are compared without a body-mass assumption
 * beyond the stated persona.
 */
import { person } from '../fixtures/personas';
import {
  buildSchedule,
  cardioSession,
  constantSchedule,
  fastEvent,
  gramMacros,
  kcalProgram,
  neutralMacros,
  pctMacros,
  pctProgram,
  segmentSchedule, atModelTee } from '../fixtures/programs';
import { above, below, range, rel, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { ArmSpec, Check, Scenario } from '../harness/types';
import type { ArmView } from '../harness/view';
import type { SeriesId } from '../../types/metrics';
import type { PersonProfile } from '../../types';
import { HALL2015, HALL2016 } from './d01';
import { A3, D13_V15_SCHRAUWEN, YOUNG_F, YOUNG_M, atFast, atHour, dinnerFast, fastArm } from './fasting';
import { rqNonProtein } from './util';

const FULL_RUN = { record: 'full' as const };
const CORE = REQUIRES.CORE;
const FASTING = REQUIRES.FASTING;

/** Dossier 05 BHB tolerance: ±30 % or ±0.15 mM, whichever is larger. */
const bhbTol = (target: number): Check => ({ kind: 'value', target, tol: Math.max(0.3 * target, 0.15) });

/** First hour (counted from `fromHour`) at which an hourly series reaches `threshold`; NaN when it never does within `maxH`. */
function timeTo(v: ArmView, id: SeriesId, threshold: number, fromHour: number, maxH: number): number {
  for (let h = 0; h < maxH; h++) if (v.hour(id, fromHour + h) >= threshold) return h;
  return Number.NaN;
}
/** Sum of an hourly series over [h0, h1). */
const hourSum = (v: ArmView, id: SeriesId, h0: number, h1: number): number => {
  const a = v.hourly(id);
  if (!a) return Number.NaN;
  let s = 0;
  for (let h = h0; h < Math.min(h1, a.length); h++) s += a[h]!;
  return s;
};

// =====================================================================================================================
// Dossier 04 §7
// =====================================================================================================================

const MEN70 = person({ sex: 'male', ageYears: 21, heightCm: 178, weightKg: 70, bodyFatPct: 13 });

// ---- V1 Acheson 1982: a single 479 g starch meal after an overnight fast

export const D04_V1_ACHESON_1982: Scenario = {
  id: '04-V1-acheson-1982-starch-meal',
  dossier: '04',
  target: 'V1',
  title: 'Acheson 1982: a single 479 g starch meal after an overnight fast, 10 h of calorimetry',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Acheson et al. 1982 Am J Clin Nutr 36:1 (dossier 04 ref [41]); dossier 04 §7 V1',
  notes:
    '6 healthy men (70 kg, 21 y): a 21-y man, 178 cm, 70 kg, 13 % BF. Day 0 is a single meal of 479 g carbohydrate (bread, jam, juice; no protein or fat) at 08:00 after the habitual overnight fast, then nothing. Hours are counted from the meal. ' +
    'Rows (tolerance ±20 %): CHO oxidised in 10 h 133 g; glycogen +408 g at 5 h and +346 ± 12 g at 10 h; no net DNL (< 5 g over the day, assumed threshold for "no net DNL"); glucose peak 6.6 mM (Q, ±20 %). NPRQ < 1.0 needs an RQ series (CONTRACT REQUEST). ' +
    'Insulin peak (139 µU/mL) is not a series.',
  arms: {
    main: {
      profile: MEN70,
      // respiration chamber: resting (≈ 1 000 steps) instead of the habitual 7 000 — fixture fix 2026-09-30 (A2's report:
      // the chamber's non-protein EE was ≈ 705 kcal in 10 h, the habitual day 1 146)
      schedule: buildSchedule({ days: 2, programs: [kcalProgram('starch479', 1950, { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 479 }, fat: { unit: 'g', value: 0 } }, { meals: { meals: [{ clockH: 8, share: 1 }] }, steps: 1000 })], use: 0 }),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'choOx', label: 'CHO oxidised in the 10 h after the meal (133 g)', unit: 'g', measure: (c) => hourSum(c.main, 'choOxidation', 8, 18), check: rel(133, 0.2), source: 'dossier 04 V1 (CHO ox ±20 %)' },
    { id: 'gly5', label: 'glycogen gain 5 h after the meal (+408 g)', unit: 'g', measure: (c) => c.main.hour('glycogenTotal', 8 + 5 - 1) - c.main.hour('glycogenTotal', 7), check: rel(408, 0.2), source: 'dossier 04 V1 (glycogen ±20 %)' },
    { id: 'gly10', label: 'glycogen gain 10 h after the meal (+346 ± 12 g)', unit: 'g', measure: (c) => c.main.hour('glycogenTotal', 8 + 10 - 1) - c.main.hour('glycogenTotal', 7), check: rel(346, 0.2), source: 'dossier 04 V1 (glycogen ±20 %)' },
    { id: 'dnl', label: 'net DNL over the day (none, < 5 g)', unit: 'g', measure: (c) => c.main.day('dnl', 0), check: below(5), source: 'dossier 04 V1 (no net DNL)', note: 'Threshold assumed.' },
    { id: 'glucosePeak', label: 'glucose peak after the meal (6.6 mM)', unit: 'mmol/L', measure: (c) => Math.max(...Array.from({ length: 6 }, (_, k) => c.main.hour('glucose', 8 + k))), check: rel(6.6, 0.2), gate: 'Q', source: 'dossier 04 V1', note: 'Hourly-mean glucose; the ±20 % band is the V3 concentration band.' },
  ],
};

// ---- V2 Acheson 1988: glycogen depletion then 7 d of carbohydrate overfeeding

const ACHESON_MAN = person({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 70, bodyFatPct: 12 });
const overfeedKcal = [3642, 3900, 4100, 4300, 4500, 4700, 4930];
const ache88 = buildSchedule({
  days: 12,
  programs: [
    kcalProgram('depletion', 1700, pctMacros(20, 10), { exercise: [cardioSession('cycle', 8, 90, { pctVo2max: 0.65 })] }),
    ...overfeedKcal.map((k, i) => kcalProgram(`over${i + 1}`, k, pctMacros(9, 86))),
    kcalProgram('lowEnergy', 602, pctMacros(85, 10)),
  ],
  use: (d) => (d < 3 ? 0 : d < 10 ? 1 + (d - 3) : 8),
});

export const D04_V2_ACHESON_1988: Scenario = {
  id: '04-V2-acheson-1988-overfeeding',
  dossier: '04',
  target: 'V2',
  title: 'Acheson 1988: 3 d of glycogen depletion, then 7 d of carbohydrate overfeeding (86 % CHO, 3 642 → 4 930 kcal/d)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Acheson et al. 1988 Am J Clin Nutr 48:240 (dossier 04 ref [42]); dossier 04 §7 V2',
  notes:
    '3 men, 70 kg: a 25-y man, 178 cm, 70 kg, 12 % BF. Days 1-3: 1 700 kcal/d at 10 % carbohydrate plus 90 min of cycling (65 % VO2max; the dossier says only "≈ 1 360-2 000 kcal + exercise": assumption); days 4-10: 86 % carbohydrate overfeeding rising linearly from 3 642 to 4 930 kcal/d ' +
    '(interpolation assumed); days 11-12: 602 kcal (85 % protein). Rows: CHO oxidation 74 g/d at the end of depletion (±30 %, Q); glycogen gain over the overfeeding week ≈ +770 g (capacity ±20 %); maximum glycogen ≈ 15 g/kg × 70 kg = 1 050 g (±20 %); ' +
    'net DNL ≈ 146 g/d in the last three overfeeding days (±30 %, mean of the 142-150 range). 24-h NPRQ > 1 needs an RQ series (CONTRACT REQUEST).',
  arms: { main: { profile: ACHESON_MAN, schedule: ache88 } },
  expectations: [
    { id: 'choOxDepleted', label: 'CHO oxidation on the last depletion day (74 g/d)', unit: 'g/d', measure: (c) => c.main.day('choOxidation', 2), check: rel(74, 0.3), gate: 'Q', source: 'dossier 04 V2' },
    { id: 'gainWeek', label: 'glycogen gained over the 7 overfeeding days (≈ +770 g)', unit: 'g', measure: (c) => c.main.after('glycogenTotal', 10) - c.main.after('glycogenTotal', 3), check: rel(770, 0.2), source: 'dossier 04 V2 (capacity ±20 %)' },
    { id: 'capacity', label: 'peak total glycogen (≈ 15 g/kg × 70 kg)', unit: 'g', measure: (c) => c.main.max('glycogenTotal', 3, 10), check: rel(1050, 0.2), source: 'dossier 04 V2 (capacity ±20 %)' },
    { id: 'dnl', label: 'net DNL in the last three overfeeding days (≈ 146 g/d)', unit: 'g/d', measure: (c) => c.main.mean('dnl', 7, 10), check: rel(146, 0.3), source: 'dossier 04 V2 (DNL rate ±30 %)' },
  ],
};

// ---- V3 Taylor 1996 / Magnusson 1992: liver glycogen overnight and after a liquid meal with 139 g glucose

const LIVER_G_PER_MMOLL = 1.45 * 0.162; // g of liver glycogen per mmol/L (V_liv 1.45 L, 0.162 g/mmol glucosyl)
/**
 * Taylor 1996's overnight window: the 08:00 value follows 10.5 h of post-absorptive liver output that began ≈ 4 h after the
 * evening meal, i.e. a 17:30 dinner. Habitual meals 07:30 / 12:30 / 17:30 (fixture fix 2026-09-30, A2's report: with the
 * default 20:00 dinner the engine's 08:00 value followed only ≈ 5.6 unsuppressed hours).
 */
const TAYLOR_M: PersonProfile = { ...YOUNG_M, habits: { ...YOUNG_M.habits, habitualWindowStartH: 7.5, habitualWindowLengthH: 10 } };

export const D04_V3_LIVER: Scenario = {
  id: '04-V3-taylor-magnusson-liver-glycogen',
  dossier: '04',
  target: 'V3',
  title: 'Taylor 1996 / Magnusson 1992: liver glycogen after an overnight fast and after a liquid meal with 139 g glucose',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Taylor et al. 1996, Magnusson et al. 1992 (dossier 04 refs [8,7]); dossier 04 §7 V3',
  notes:
    'Healthy adult (Table A1-like 25-y man, 178 cm, 75 kg) with habitual meals at 07:30, 12:30 and 17:30, so the 08:00 value follows the study\'s 10.5 h of post-absorptive liver output. Day 0: a single liquid meal at 08:00 of 824 kcal (139 g glucose, 25 g protein, 18 g fat). Liver glycogen (g) is converted to mmol/L with V_liv = 1.45 L and 0.162 g/mmol ' +
    '(04 params): overnight value at 08:00 350 → 207 mmol/L (±20 %); meal peak 316 mmol/L at ≈ 5.3 h (timing ±1 h); +28 g (≈ 19 % of the carbohydrate, ±20 %). Part (c) (282 → 98 mmol/L from 4 → 22.5 h) is 07-1.',
  arms: {
    main: {
      profile: TAYLOR_M,
      schedule: buildSchedule({ days: 2, programs: [kcalProgram('liquidMeal', 824, gramMacros(25, 139), { meals: { meals: [{ clockH: 8, share: 1 }] } })], use: 0 }),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'overnight', label: 'liver glycogen at 08:00 after the overnight fast (207 mmol/L)', unit: 'mmol/L', measure: (c) => c.main.hour('liverGlycogen', 7) / LIVER_G_PER_MMOLL, check: rel(207, 0.2), source: 'dossier 04 V3 (±20 %)' },
    { id: 'peak', label: 'liver glycogen peak after the meal (316 mmol/L)', unit: 'mmol/L', measure: (c) => Math.max(...Array.from({ length: 12 }, (_, k) => c.main.hour('liverGlycogen', 8 + k))) / LIVER_G_PER_MMOLL, check: rel(316, 0.2), source: 'dossier 04 V3 (±20 %)' },
    { id: 'gain', label: 'liver glycogen gain at the peak (+28 g ≈ 19 % of the carbohydrate)', unit: 'g', measure: (c) => Math.max(...Array.from({ length: 12 }, (_, k) => c.main.hour('liverGlycogen', 8 + k))) - c.main.hour('liverGlycogen', 7), check: rel(28, 0.2), source: 'dossier 04 V3 (±20 %)' },
    { id: 'timing', label: 'time of the liver-glycogen peak after the meal (5.3 h)', unit: 'h', measure: (c) => { let best = -1; let at = 0; for (let k = 0; k < 14; k++) { const g = c.main.hour('liverGlycogen', 8 + k); if (g > best) { best = g; at = k + 1; } } return at; }, check: val(5.3, 1), source: 'dossier 04 V3 (timing ±1 h)' },
  ],
};

// ---- V4 Bussau 2002 / Shiose 2016: supercompensation and body water

const TRAINED = person({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 75, bodyFatPct: 12, trainingYears: 3, trainingHistory: '1to3y' });

/** Body water alone (kg): the `waterWeight` series (water & glycogen) minus the glycogen mass (g → kg). */
const bodyWaterOnly = (v: ArmView, h: number): number => v.hour('waterWeight', h) - (v.hour('muscleGlycogen', h) + v.hour('liverGlycogen', h)) / 1000;

export const D04_V4_BUSSAU: Scenario = {
  id: '04-V4-bussau-shiose-supercompensation',
  dossier: '04',
  target: 'V4',
  title: 'Bussau 2002 / Shiose 2016: muscle glycogen and body water with 10-12 g/kg/d carbohydrate',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Bussau et al. 2002, Shiose et al. 2016 (dossier 04 refs [22,3]); dossier 04 §7 V4',
  notes:
    'Trained men (25 y, 178 cm, 75 kg, 12 % BF). (a) 3 days at 10 g/kg/d of high-GI carbohydrate (750 g/d; protein 1.0 g/kg, fat remainder), inactive (2 000 steps, no training): muscle glycogen 95 → 180 mmol/kg ww after 24 h (× 1.89), no further rise at 72 h. ' +
    '(b) Glycogen-depleting cycling on day 0 (2 h at 70 % VO2max on 60 g carbohydrate), then 12 g/kg/d (900 g/d) for 72 h: 72.7 → 169.4 mmol/kg ww (× 2.33), total body water +0.9 kg (range +0.6 to +1.6). Ratios to the starting value are compared (±15 %) ' +
    'because the whole-body gram pool and the tissue-concentration measure differ by the (unchanged) muscle mass.',
  arms: {
    a: {
      profile: TRAINED,
      schedule: buildSchedule({ days: 4, programs: [kcalProgram('hiCho', 3800, gramMacros(75, 750), { steps: 2000 })], use: 0 }),
      options: FULL_RUN,
    },
    b: {
      profile: TRAINED,
      schedule: buildSchedule({
        days: 5,
        programs: [kcalProgram('deplete', 1700, gramMacros(100, 60), { exercise: [cardioSession('cycle', 8, 120, { pctVo2max: 0.7 })] }), kcalProgram('carbLoad', 4700, gramMacros(75, 900), { steps: 2000 })],
        use: (d) => (d === 0 ? 0 : 1),
      }),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'a24', label: 'muscle glycogen at 24 h of 10 g/kg/d relative to the start (95 → 180 mmol/kg, × 1.89)', unit: 'ratio', measure: (c) => c.arm('a').hour('muscleGlycogen', 23) / c.arm('a').initial('muscleGlycogen'), check: rel(180 / 95, 0.15), source: 'dossier 04 V4 (±15 %)' },
    { id: 'a72', label: 'no further rise between 24 h and 72 h (ratio ≤ 1.1)', unit: 'ratio', measure: (c) => c.arm('a').hour('muscleGlycogen', 71) / c.arm('a').hour('muscleGlycogen', 23), check: below(1.1), source: 'dossier 04 V4 (no further rise at 72 h)', note: '1.1 threshold assumed.' },
    { id: 'b72', label: 'muscle glycogen after 72 h at 12 g/kg/d relative to the depleted value (72.7 → 169.4, × 2.33)', unit: 'ratio', measure: (c) => c.arm('b').hour('muscleGlycogen', 24 + 72 - 1) / c.arm('b').hour('muscleGlycogen', 23), check: rel(169.4 / 72.7, 0.15), source: 'dossier 04 V4 (±15 %)' },
    { id: 'water', label: 'body water change over the 72 h of carbohydrate loading (+0.9 kg, range +0.6 … +1.6)', unit: 'kg', measure: (c) => bodyWaterOnly(c.arm('b'), 24 + 72 - 1) - bodyWaterOnly(c.arm('b'), 23), check: range(0.6, 1.6), source: 'dossier 04 V4 (water +0.6 to +1.6 kg)', note: 'Shiose measured total body water (D2O): the engine\'s water-and-glycogen weight minus the glycogen mass itself (finisher fixture fix 2026-09-30).' },
  ],
};

// ---- V5 Ivy 1988 / Fuchs 2016 (b): sucrose vs glucose liver repletion

const REPLETE = person({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 75, bodyFatPct: 12, trainingYears: 3, trainingHistory: '1to3y' });
const repleteArm = (fructoseShare: number): ArmSpec => ({
  profile: REPLETE,
  schedule: buildSchedule({
    days: 2,
    programs: [
      kcalProgram(
        `repl${fructoseShare}`,
        2900,
        { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 560 }, fat: { unit: 'g', value: 0 }, sugarsShare: 1, fructoseShareOfSugars: fructoseShare },
        { exercise: [cardioSession('cycle', 8, 120, { pctVo2max: 0.7 })], meals: { meals: [12, 13, 14, 15, 16].map((h) => ({ clockH: h, share: 1 })) } },
      ),
    ],
    use: 0,
  }),
  options: FULL_RUN,
});

export const D04_V5_FUCHS: Scenario = {
  id: '04-V5-ivy-fuchs-sucrose-glucose',
  dossier: '04',
  target: 'V5',
  title: 'Fuchs 2016: liver glycogen repletion with 1.5 g/kg/h sucrose vs glucose for 5 h after depletion',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Ivy 1988, Fuchs et al. 2016 (dossier 04 refs [26,15]); dossier 04 §7 V5',
  notes:
    'Trained man (75 kg): 2 h of cycling at 70 % VO2max at 08:00 (depletion), then 1.5 g/kg/h × 5 h = 112 g/h carbohydrate as hourly meals 12:00-16:00, either sucrose (fructose share of sugars 0.5) or glucose (0). Study: liver 53.6 → 86.8 g (sucrose) vs 49.3 → 65.7 g (glucose); ' +
    'the sucrose − glucose liver difference must be positive (≈ +3.4 g/h, ±25 % is Q). The muscle rows (85 → 140 vs 86 → 136 mmol/L) need a tissue concentration; the immediate-vs-delayed part (a) of the dossier row is not encoded.',
  arms: { sucrose: repleteArm(0.5), glucose: repleteArm(0) },
  expectations: [
    { id: 'direction', label: 'liver glycogen 5 h into refeeding: sucrose − glucose (> 0)', unit: 'g', measure: (c) => c.arm('sucrose').hour('liverGlycogen', 16) - c.arm('glucose').hour('liverGlycogen', 16), check: above(0), source: 'dossier 04 V5 (difference must be positive)' },
    { id: 'rate', label: 'liver-glycogen storage rate difference sucrose − glucose (≈ +3.4 g/h)', unit: 'g/h', measure: (c) => (c.arm('sucrose').hour('liverGlycogen', 16) - c.arm('sucrose').hour('liverGlycogen', 11) - (c.arm('glucose').hour('liverGlycogen', 16) - c.arm('glucose').hour('liverGlycogen', 11))) / 5, check: rel(3.4, 0.25), gate: 'Q', source: 'dossier 04 V5 (±25 % rates)' },
  ],
};

// ---- V6 Schrauwen 1997 (dossier 04 tolerances; the dossier 13 V15 arm)

export const D04_V6_SCHRAUWEN: Scenario = {
  id: '04-V6-schrauwen-fat-balance',
  dossier: '04',
  target: 'V6',
  title: 'Schrauwen 1997: fat balance after a low-fat → high-fat isocaloric switch (dossier 04 tolerances)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Schrauwen et al. 1997 (dossier 04 refs [55,56]); dossier 04 §7 V6 (same run as 13-V15)',
  notes: 'The arm of 13-V15. Dossier 04 tolerances: day-1 imbalance +1.06 MJ/d within ±50 %; the balance is reached (|fat balance| ≤ 0.3 MJ/d) by day 5-9.',
  arms: D13_V15_SCHRAUWEN.arms,
  expectations: [
    { id: 'day1', label: 'fat balance on day 1 (+1.06 MJ/d, ±50 %)', unit: 'MJ/d', measure: (c) => (c.main.after('fatMass', 1) - c.main.initial('fatMass')) * 39.5, check: rel(1.06, 0.5), source: 'dossier 04 V6 (±50 %)' },
    { id: 'balanced', label: 'fat balance on day 7 near zero (|·| ≤ 0.3 MJ/d)', unit: 'MJ/d', measure: (c) => Math.abs((c.main.after('fatMass', 7) - c.main.after('fatMass', 6)) * 39.5), check: below(0.3), source: 'dossier 04 V6 (balance reached by day 5-9)', note: '0.3 MJ/d threshold assumed.' },
  ],
};

// ---- V7 Hall 2015 (arms of 01-7.5, dossier 04 tolerances)

export const D04_V7_HALL2015: Scenario = {
  id: '04-V7-hall2015-oxidation',
  dossier: '04',
  target: 'V7',
  title: 'Hall 2015: fat loss and substrate oxidation with carbohydrate vs fat restriction (dossier 04 tolerances)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Hall et al. 2015 Cell Metab 22:427 (dossier 04 ref [58]); dossier 04 §7 V7',
  notes:
    'The arms of 01-7.5. Dossier 04: fat-loss difference has the right sign and ≥ 50 % of the magnitude (RF − RC = 218 g over 6 d ⇒ ≥ 109 g); RC net fat oxidation +463 kcal/d and CHO oxidation −595 kcal/d by day 6 relative to baseline (±30 %); RC has the larger weight loss. ' +
    'Oxidation energies use 9.44 kcal/g fat and 4.1 kcal/g carbohydrate against the baseline arm.',
  arms: HALL2015.arms,
  expectations: [
    { id: 'fatDiff', label: 'cumulative fat loss RF − RC (218 g; must be ≥ 109 g)', unit: 'kg', measure: (c) => c.arm('rf').delta('fatMass', 6) * -1 - c.arm('rc').delta('fatMass', 6) * -1, check: above(0.109), source: 'dossier 04 V7 (sign and ≥ 50 % of magnitude)' },
    { id: 'chOx', label: 'RC: CHO oxidation change by day 6 (−595 kcal/d)', unit: 'kcal/d', measure: (c) => 4.1 * (c.arm('rc').day('choOxidation', 5) - c.arm('base').day('choOxidation', 5)), check: rel(-595, 0.3), source: 'dossier 04 V7 (±30 %)' },
    { id: 'fatOx', label: 'RC: net fat oxidation change by day 6 (+463 kcal/d)', unit: 'kcal/d', measure: (c) => 9.44 * (c.arm('rc').day('fatOxidation', 5) - c.arm('base').day('fatOxidation', 5)), check: rel(463, 0.3), source: 'dossier 04 V7 (±30 %)' },
    { id: 'weight', label: 'RC loses more weight than RF (weight change RC − RF, < 0)', unit: 'kg', measure: (c) => c.arm('rc').after('scaleWeight', 6) - c.arm('rf').after('scaleWeight', 6), check: below(0), source: 'dossier 04 V7 (RC larger weight loss)' },
    { id: 'rqRc', label: 'RC: non-protein RQ falls vs baseline (< 0)', unit: 'RQ', measure: (c) => rqNonProtein(c.arm('rc').day('choOxidation', 5), c.arm('rc').day('fatOxidation', 5)) - rqNonProtein(c.arm('base').day('choOxidation', 5), c.arm('base').day('fatOxidation', 5)), check: below(0), gate: 'Q', source: 'dossier 04 V7 (RF: no sustained RQ change)' },
  ],
};

// =====================================================================================================================
// Dossier 05 §7 (tolerance: ±30 % or ±0.15 mM, whichever is larger; ±3 h for time to threshold)
// =====================================================================================================================

// ---- V1 McDougal 2018

export const D05_V1_MCDOUGAL: Scenario = {
  id: '05-V1-mcdougal-2018-fast',
  dossier: '05',
  target: 'V1',
  title: 'McDougal 2018: BHB at 12 h and 72 h of a water-only fast',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'McDougal et al. 2018 (dossier 05 ref [14]); dossier 05 §7 V1',
  notes: '6 healthy men (BMI 20-27.9): a 25-y man, 178 cm, 75 kg with the Table A1 maintenance. Fast from the 20:00 last meal; hours counted from it. BHB 0.1 at 12 h, 2.3 ± 0.5 at 72 h.',
  arms: { main: dinnerFast(YOUNG_M, 84, 5) },
  expectations: [
    { id: 'h12', label: 'BHB at 12 h (0.1 mM)', unit: 'mmol/L', measure: (c) => atFast(c.main, 'bhb', 12), check: bhbTol(0.1), source: 'dossier 05 V1' },
    { id: 'h72', label: 'BHB at 72 h (2.3 mM)', unit: 'mmol/L', measure: (c) => atFast(c.main, 'bhb', 72), check: bhbTol(2.3), source: 'dossier 05 V1' },
  ],
};

// ---- V2 Haymond 1982

export const D05_V2_HAYMOND: Scenario = {
  id: '05-V2-haymond-1982-sex',
  dossier: '05',
  target: 'V2',
  title: 'Haymond 1982: BHB at 30 h of fasting in men and women',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Haymond et al. 1982 (dossier 05 ref [12]); dossier 05 §7 V2',
  notes: 'A 25-y man and a 25-y woman (Table A1/A2-like bodies); fast from the 20:00 last meal. BHB at 30 h: men 0.9 ± 0.2, women 1.7 ± 0.2 mM; the dossier model gives 0.99 / 1.28 (women −25 %, inside ±30 %).',
  arms: { m: dinnerFast(YOUNG_M, 40, 3), f: dinnerFast(YOUNG_F, 40, 3) },
  expectations: [
    { id: 'men', label: 'men: BHB at 30 h (0.9 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('m'), 'bhb', 30), check: bhbTol(0.9), source: 'dossier 05 V2' },
    { id: 'women', label: 'women: BHB at 30 h (1.7 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('f'), 'bhb', 30), check: bhbTol(1.7), source: 'dossier 05 V2' },
  ],
};

// ---- V3 Deru 2021: 36-h fast with and without exercise at the start

/**
 * Exercise dose and timing of dossier 05's own Deru-2021 model check ("1 h at 65 % after dinner absorption", §4 worked results),
 * on day 0 only (finisher fixture fix 2026-09-30: the former 45-min run at 20:30 fell in the dinner-absorption hour, so dinner
 * glucose refilled the deficit, and the program repeated the run on day 1 inside the fast).
 */
const DERU_RUN_H = 22;
const deruArm = (exercise: boolean): ArmSpec => ({
  profile: YOUNG_M,
  schedule: buildSchedule({
    days: 3,
    programs: [
      // the same standardised intake in both arms (R-MAINT: % of the habitual-activity maintenance, so the run is not fed)
      pctProgram('maintenance', 100, neutralMacros('male'), {}, undefined, 'habitual'),
      pctProgram('maintenanceRun', 100, neutralMacros('male'), { exercise: [cardioSession('run', DERU_RUN_H, 60, { pctVo2max: 0.65 })] }, undefined, 'habitual'),
    ],
    use: (d) => (exercise && d === 0 ? 1 : 0),
    events: [fastEvent(0, 36, 20)],
  }),
  options: FULL_RUN,
});

export const D05_V3_DERU_2021: Scenario = {
  id: '05-V3-deru-2021-exercise',
  dossier: '05',
  target: 'V3',
  title: 'Deru 2021: time to 0.5 mM BHB in a 36-h fast, rest vs treadmill exercise at the start',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Deru et al. 2021 (dossier 05 ref [13]); dossier 05 §7 V3',
  notes:
    '11 M / 9 F: a 25-y man (Table A1-like). 36-h fast from the 20:00 last meal; the exercise arm runs 60 min at 65 % VO2max at 22:00, once (dossier: "treadmill exercise at start", dose not given; 05\'s model check uses 1 h at 65 % after dinner absorption). Rows: time to 0.5 mM 21.1 ± 3.0 h (rest) vs 17.5 ± 1.7 h (exercise), tolerance ±3 h; ' +
    'BHB AUC over 36 h 19.2 vs 27.5 mmol·h/L (±30 %); the exercise arm reaches 0.5 mM earlier.',
  arms: { rest: deruArm(false), exercise: deruArm(true) },
  expectations: [
    { id: 'tRest', label: 'time to 0.5 mM, rest (21.1 h)', unit: 'h', measure: (c) => timeTo(c.arm('rest'), 'bhb', 0.5, 20, 36), check: val(21.1, 3), source: 'dossier 05 V3 (±3 h)' },
    { id: 'tEx', label: 'time to 0.5 mM, exercise (17.5 h)', unit: 'h', measure: (c) => timeTo(c.arm('exercise'), 'bhb', 0.5, 20, 36), check: val(17.5, 3), source: 'dossier 05 V3 (±3 h)' },
    { id: 'order', label: 'exercise reaches 0.5 mM earlier than rest (h, > 0)', unit: 'h', measure: (c) => timeTo(c.arm('rest'), 'bhb', 0.5, 20, 36) - timeTo(c.arm('exercise'), 'bhb', 0.5, 20, 36), check: above(0), source: 'dossier 05 V3 (direction)' },
    { id: 'aucRest', label: 'BHB AUC over 36 h, rest (19.2 mmol·h/L)', unit: 'mmol·h/L', measure: (c) => hourSum(c.arm('rest'), 'bhb', 20, 56), check: rel(19.2, 0.3), source: 'dossier 05 V3 (±30 %)' },
    { id: 'aucEx', label: 'BHB AUC over 36 h, exercise (27.5 mmol·h/L)', unit: 'mmol·h/L', measure: (c) => hourSum(c.arm('exercise'), 'bhb', 20, 56), check: rel(27.5, 0.3), source: 'dossier 05 V3 (±30 %)' },
  ],
};

// ---- V4 Owen & Reichard 1971 / Balasse 1979: prolonged fast in obesity

export const D05_V4_OWEN: Scenario = {
  id: '05-V4-owen-balasse-prolonged-fast',
  dossier: '05',
  target: 'V4',
  title: 'Owen & Reichard 1971 / Balasse 1979: BHB at 3 d and 24 d of fasting in obesity',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Owen & Reichard 1971, Balasse 1979 (dossier 05 refs [6,3]); dossier 05 §7 V4',
  notes: 'Obese adult (Table A3: 45-y woman, 165 cm, 100 kg, 45 % BF); a 24-day water-only FastEvent from t = 0. BHB 2.23 mM at 3 d and 5.29 mM at 24 d (±30 %); total ketone bodies (6.8 mM) and production rates are not series.',
  arms: { main: fastArm(A3, 24 * 25, 26) },
  expectations: [
    { id: 'd3', label: 'BHB at 3 d (2.23 mM)', unit: 'mmol/L', measure: (c) => atHour(c.main, 'bhb', 72), check: bhbTol(2.23), source: 'dossier 05 V4' },
    { id: 'd24', label: 'BHB at 24 d (5.29 mM)', unit: 'mmol/L', measure: (c) => atHour(c.main, 'bhb', 576), check: bhbTol(5.29), source: 'dossier 05 V4' },
  ],
};

// ---- V5 Hall 2016 fasting BHB and V9 Urbain & Bertz (KD day profile)

const kdArm: ArmSpec = { profile: HALL2016.arms['main']!.profile, schedule: HALL2016.arms['main']!.schedule, options: FULL_RUN };
const morningBhb = (v: ArmView, d0: number, d1: number): number => {
  let s = 0;
  for (let d = d0; d < d1; d++) s += v.hour('bhb', 24 * d + 7);
  return s / (d1 - d0);
};

export const D05_V5_HALL2016: Scenario = {
  id: '05-V5-hall2016-fasting-bhb',
  dossier: '05',
  target: 'V5',
  title: 'Hall 2016 / Rosenbaum 2019: fasting BHB on a 5 % carbohydrate diet (weeks 3-4) vs baseline',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Hall et al. 2016, Rosenbaum 2019 (dossier 05 refs [18,19]); dossier 05 §7 V5',
  notes: 'The arm of 01-7.6 (28 d baseline diet, 28 d isocaloric KD) with hourly records; fasting BHB is the value in the 07:00 hour. Baseline 0.09-0.11 mM; weeks 3-4 of the KD 0.77 ± 0.49 mM (days 42-55 here).',
  arms: { main: kdArm },
  expectations: [
    { id: 'base', label: 'baseline fasting BHB, last week (0.10 mM)', unit: 'mmol/L', measure: (c) => morningBhb(c.main, 21, 28), check: bhbTol(0.1), source: 'dossier 05 V5' },
    { id: 'kd', label: 'fasting BHB in weeks 3-4 of the KD (0.77 mM)', unit: 'mmol/L', measure: (c) => morningBhb(c.main, 42, 56), check: bhbTol(0.77), source: 'dossier 05 V5' },
  ],
};

const urbain = person({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 88 });
export const D05_V9_URBAIN: Scenario = {
  id: '05-V9-urbain-bertz-24h-profile',
  dossier: '05',
  target: 'V9',
  title: 'Urbain & Bertz 2016: 24-h BHB range on a stable ketogenic diet (week 6)',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Urbain & Bertz 2016 (dossier 05 ref [24]); dossier 05 §7 V9',
  notes: 'A 35-y man (180 cm, 88 kg) on a ketogenic diet (5 % carbohydrate, 15 % protein, 100 % of maintenance) for 42 d; the daily minimum and maximum of the hourly BHB on day 42. Observed min 0.33 mM (10:00), max 0.70 mM (03:00); timing depends on the meal clock (not a row).',
  arms: { main: { profile: urbain, schedule: constantSchedule(42, pctProgram('kd', 100, pctMacros(15, 5))), options: FULL_RUN } },
  expectations: [
    { id: 'min', label: 'lowest hourly BHB on day 42 (0.33 mM)', unit: 'mmol/L', measure: (c) => Math.min(...Array.from({ length: 24 }, (_, h) => c.main.hour('bhb', 24 * 41 + h))), check: bhbTol(0.33), source: 'dossier 05 V9' },
    { id: 'max', label: 'highest hourly BHB on day 42 (0.70 mM)', unit: 'mmol/L', measure: (c) => Math.max(...Array.from({ length: 24 }, (_, h) => c.main.hour('bhb', 24 * 41 + h))), check: bhbTol(0.7), source: 'dossier 05 V9' },
  ],
};

// ---- V6 Harvey 2019

const harveyArm = (carbPct: number): ArmSpec => ({ profile: MEN70, schedule: constantSchedule(21, pctProgram(`c${carbPct}`, 100, pctMacros(15, carbPct))), options: FULL_RUN });

export const D05_V6_HARVEY: Scenario = {
  id: '05-V6-harvey-2019-carbohydrate-dose',
  dossier: '05',
  target: 'V6',
  title: 'Harvey 2019: BHB rise after 3 weeks at 5 / 15 / 25 % carbohydrate',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Harvey et al. 2019 (dossier 05 ref [22]); dossier 05 §7 V6',
  notes: '75 adults: a 21-y man (70 kg reference body; the study mixed sexes), three arms of 21 days at 100 % of maintenance with protein 15 %E and carbohydrate 5 / 15 / 25 %E. Fasting BHB (07:00 hour, last 4 days) minus the baseline value: +0.62 / +0.41 / +0.27 mM.',
  arms: { c5: harveyArm(5), c15: harveyArm(15), c25: harveyArm(25) },
  expectations: [
    { id: 'c5', label: '5 % carbohydrate: ΔBHB (+0.62 mM)', unit: 'mmol/L', measure: (c) => morningBhb(c.arm('c5'), 17, 21) - c.arm('c5').initial('bhb'), check: bhbTol(0.62), source: 'dossier 05 V6' },
    { id: 'c15', label: '15 % carbohydrate: ΔBHB (+0.41 mM)', unit: 'mmol/L', measure: (c) => morningBhb(c.arm('c15'), 17, 21) - c.arm('c15').initial('bhb'), check: bhbTol(0.41), source: 'dossier 05 V6' },
    { id: 'c25', label: '25 % carbohydrate: ΔBHB (+0.27 mM)', unit: 'mmol/L', measure: (c) => morningBhb(c.arm('c25'), 17, 21) - c.arm('c25').initial('bhb'), check: bhbTol(0.27), source: 'dossier 05 V6' },
  ],
};

// ---- V7 Deru 2024: 24-h fast broken by ~110 g dextrose

const deru24 = buildSchedule({
  days: 4,
  programs: [
    pctProgram('maintenance', 100, neutralMacros('male')),
    kcalProgram('dextrose', 440, { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 110 }, fat: { unit: 'g', value: 0 } }, { meals: { meals: [{ clockH: 20, share: 1 }] } }),
  ],
  use: (d) => (d === 1 ? 1 : 0),
  events: [fastEvent(0, 24, 20), fastEvent(1, 36, 21)],
});

export const D05_V7_DERU_2024: Scenario = {
  id: '05-V7-deru-2024-dextrose-exit',
  dossier: '05',
  target: 'V7',
  title: 'Deru 2024: BHB after a 24-h fast broken by a 110 g dextrose shake',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Deru et al. 2024 (dossier 05 ref [46]); dossier 05 §7 V7',
  notes: '27 overweight adults: a 25-y man (Table A1-like); 24-h fast from the 20:00 last meal (20:00 day 1 = 24 h), a 110 g dextrose drink at 20:00 (440 kcal), then fasting again. BHB 0.59 (24 h) → 0.28 (1 h) → 0.19 (4 h) → 0.44 (14 h) mM, ±30 % or ±0.15.',
  arms: { main: { profile: YOUNG_M, schedule: deru24, options: FULL_RUN } },
  expectations: [
    { id: 'pre', label: 'BHB just before the drink, 24 h (0.59 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('bhb', 43), check: bhbTol(0.59), source: 'dossier 05 V7' },
    { id: 'h1', label: 'BHB 1 h after the drink (0.28 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('bhb', 45), check: bhbTol(0.28), source: 'dossier 05 V7' },
    { id: 'h4', label: 'BHB 4 h after the drink (0.19 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('bhb', 48), check: bhbTol(0.19), source: 'dossier 05 V7' },
    { id: 'h14', label: 'BHB 14 h after the drink (0.44 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('bhb', 58), check: bhbTol(0.44), source: 'dossier 05 V7' },
  ],
};

// ---- V8 Gipson 2025 (K)

/**
 * Gipson 2025 protocol (finisher fixture fix 2026-09-30, from the paper): after the usual evening meal and an overnight fast the
 * shake is drunk by 08:00 and starts a 24-h water-only fast (08:00 → 08:00). The shakes are isocaloric at 25 % of BMR × 1.4;
 * LC/HF 4.36 % carbohydrate, 29.43 % protein, 66.21 % fat; HC/LF 56.78 % carbohydrate, 30.06 % protein, 13.15 % fat. Energy
 * follows from the dossier's carbohydrate grams (6 g → ≈ 550 kcal, 84 g → ≈ 590 kcal). The former fixture drank the shake at
 * 20:00 after a whole day without food, so "24 h" was 48 h of fasting.
 */
const GIPSON_SHAKE_H = 8;
const gipsonArm = (carbG: number, carbShare: number, proteinShare: number): ArmSpec => {
  const kcal = Math.round((4 * carbG) / carbShare);
  return {
    profile: person({ sex: 'male', ageYears: 58, heightCm: 172, weightKg: 88, extra: { sexUnspecified: true } }), // BMI ≥ 27, > 50 y
    schedule: buildSchedule({
      days: 3,
      programs: [kcalProgram(`shake${carbG}`, kcal, gramMacros(Math.round((proteinShare * kcal) / 4), carbG), { meals: { meals: [{ clockH: GIPSON_SHAKE_H, share: 1 }] } }), pctProgram('maintenance', 100, neutralMacros('male'))],
      use: (d) => (d === 0 ? 0 : 1),
      events: [fastEvent(0, 23, GIPSON_SHAKE_H + 1)],
    }),
    options: FULL_RUN,
  };
};
const gipsonBhb = (v: ArmView, hoursAfterShake: number): number => v.hour('bhb', GIPSON_SHAKE_H + hoursAfterShake - 1);

export const D05_V8_GIPSON: Scenario = {
  id: '05-V8-gipson-2025-carbohydrate-start',
  dossier: '05',
  target: 'V8',
  title: 'Gipson 2025: 24-h fast begun with 6 g vs 84 g of carbohydrate (known miss at 24 h)',
  level: 'I',
  gate: 'K',
  requires: FASTING,
  citation: 'Gipson et al. 2025 (dossier 05 ref [47]); dossier 05 §7 V8 (§9.2: K)',
  notes: '24 adults > 50 y, BMI ≥ 27: a 58-y sex-unspecified adult (172 cm, 88 kg). After the overnight fast the 6 g or 84 g carbohydrate shake at 08:00 (day 0) starts the 24-h fast; BHB at 12 and 24 h after the shake. LC 0.54 / 0.50, HC 0.32 / 0.31 mM. The dossier records the model as failing the 24-h values.',
  arms: {
    lc: gipsonArm(6, 0.0436, 0.2943),
    hc: gipsonArm(84, 0.5678, 0.3006),
  },
  expectations: [
    { id: 'lc12', label: 'low carbohydrate: BHB at 12 h (0.54 mM)', unit: 'mmol/L', measure: (c) => gipsonBhb(c.arm('lc'), 12), check: bhbTol(0.54), gate: 'M' /* promoted from K at integration 2026-09-30 under the former (wrong) timing; registered miss since the protocol fix */, source: 'dossier 05 V8' },
    { id: 'lc24', label: 'low carbohydrate: BHB at 24 h (0.50 mM)', unit: 'mmol/L', measure: (c) => gipsonBhb(c.arm('lc'), 24), check: bhbTol(0.5), source: 'dossier 05 V8' },
    { id: 'hc12', label: 'high carbohydrate: BHB at 12 h (0.32 mM)', unit: 'mmol/L', measure: (c) => gipsonBhb(c.arm('hc'), 12), check: bhbTol(0.32), gate: 'M' /* promoted from K at integration 2026-09-30 */, source: 'dossier 05 V8' },
    { id: 'hc24', label: 'high carbohydrate: BHB at 24 h (0.31 mM)', unit: 'mmol/L', measure: (c) => gipsonBhb(c.arm('hc'), 24), check: bhbTol(0.31), source: 'dossier 05 V8' },
  ],
};

// ---- V10 Féry & Balasse 1983: walking after an overnight fast

export const D05_V10_FERY: Scenario = {
  id: '05-V10-fery-balasse-1983-exercise',
  dossier: '05',
  target: 'V10',
  title: 'Féry & Balasse 1983: 2 h of walking at ≈ 50 % VO2max after an overnight fast',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Féry & Balasse 1983 (dossier 05 ref [37]); dossier 05 §7 V10',
  notes: 'A 25-y man (Table A1-like); the habitual overnight fast (last meal 20:00) continues to 12:00 with 120 min of walking at 50 % VO2max from 08:00. Total ketone bodies 0.20 → 0.39 mM, +0.73 mM at 30 min of recovery (0.93), compared with the engine\'s total-ketone series (`totalKetones`, the TKB mirror; fixture fix 2026-09-30 — the study reports TKB, not BHB).',
  arms: {
    main: {
      profile: YOUNG_M,
      schedule: buildSchedule({ days: 2, programs: [pctProgram('walkFasted', 100, neutralMacros('male'), { exercise: [cardioSession('walk', 8, 120, { pctVo2max: 0.5 })] })], use: 0, events: [fastEvent(0, 12, 0)] }),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'start', label: 'total ketones before exercise, 07:00 (0.20 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('totalKetones', 7), check: bhbTol(0.2), source: 'dossier 05 V10' },
    { id: 'end', label: 'total ketones at the end of 2 h of walking (0.39 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('totalKetones', 9), check: bhbTol(0.39), source: 'dossier 05 V10' },
    { id: 'recovery', label: 'total ketones 30 min into recovery (0.93 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('totalKetones', 10), check: bhbTol(0.93), source: 'dossier 05 V10' },
  ],
};

// ---- V11 ketone ester (fasted M; fed Cmax K)

const ESTER = person({ sex: 'male', ageYears: 28, heightCm: 178, weightKg: 75, bodyFatPct: 15 });
// Fasted arm (fixture fix 2026-09-30, A2's report): the day's food is eaten at 15:00 and 20:00 only, so nothing but the
// ester is taken between the habitual 20:00 dinner and 15:00 (the former fast events 00-08 and 09-15 left the 08:00
// breakfast in place). Fed arm: the habitual 08:00 breakfast with the ester.
const esterArm = (fasted: boolean): ArmSpec => ({
  profile: ESTER,
  schedule: buildSchedule({
    days: 2,
    programs: [
      pctProgram('day', 100, neutralMacros('male'), {
        substances: { exogenousKetones: [{ clockH: 8, gBhb: 25, form: 'ester' }] },
        ...(fasted ? { meals: { meals: [{ clockH: 15, share: 0.5 }, { clockH: 20, share: 0.5 }] } } : {}),
      }),
    ],
    use: 0,
  }),
  options: FULL_RUN,
});

export const D05_V11_ESTER: Scenario = {
  id: '05-V11-ketone-ester',
  dossier: '05',
  target: 'V11',
  title: 'Stubbs 2017 / Myette-Côté 2018: a ketone ester (25 g BHB equivalent) fasted and fed',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Stubbs et al. 2017, Myette-Côté et al. 2018 (dossier 05 refs [50,53]); dossier 05 §7 V11 (§9.2: fed Cmax K)',
  notes:
    'A 28-y man (75 kg): 25 g of ketone ester (0.33 g/kg) at 08:00 after the overnight fast (fasted arm: no intake until 15:00) or with the habitual breakfast (fed). Rows: fasted Cmax 2.8-3.3 mM (±30 %) within 0.5-1 h; baseline by 3-4 h (BHB at 4 h < 0.6 mM, assumed threshold, Q); ' +
    'fed Cmax 33 % lower than fasted (K: the model gives −58 %, too strong).',
  arms: { fasted: esterArm(true), fed: esterArm(false) },
  expectations: [
    { id: 'cmax', label: 'fasted: peak BHB within 3 h of the dose (2.8-3.3 mM)', unit: 'mmol/L', measure: (c) => Math.max(...Array.from({ length: 4 }, (_, k) => c.arm('fasted').hour('bhb', 8 + k))), check: range(2.8 * 0.7, 3.3 * 1.3), source: 'dossier 05 V11 (±30 %)' },
    { id: 'baseline', label: 'fasted: BHB 4 h after the dose back near baseline (< 0.6 mM)', unit: 'mmol/L', measure: (c) => c.arm('fasted').hour('bhb', 12), check: below(0.6), gate: 'Q', source: 'dossier 05 V11 (baseline by 3-4 h)' },
    { id: 'fedCmax', label: 'fed Cmax relative to fasted (−33 %)', unit: '%', measure: (c) => 100 * (Math.max(...Array.from({ length: 4 }, (_, k) => c.arm('fed').hour('bhb', 8 + k))) / Math.max(...Array.from({ length: 4 }, (_, k) => c.arm('fasted').hour('bhb', 8 + k))) - 1), check: rel(-33, 0.3), gate: 'K', source: 'dossier 05 V11 (fed Cmax K)' },
  ],
};

// ---- V12 Vandenberghe 2017 (MCT)

// Fixture fix 2026-09-30 (A2's report): MCT is apportioned to meals by their fat grams, so with a normal-fat diet 60 % of it
// went into dinner. Here the day's only fat is the 38 g of the test (C8 in the MCT arm, ordinary fat in the control arm),
// eaten as two 19-g doses with breakfast and at 12:00; the rest of the energy is protein and carbohydrate. The row
// compares the 8-h test-day mean (08:00-16:00), as the study did, not the 24-h mean. Finisher fixture fix 2026-09-30: the
// second dose is taken fasted (dossier 05 V12 "breakfast, +4 h fasted"; it came with a 260-kcal meal, which halves MCT
// ketogenesis), and the row reads total ketone bodies (the study's and the dossier's TKB), not BHB.
const mctArm = (mct: number): ArmSpec => ({
  profile: MEN70,
  schedule: buildSchedule({
    days: 3,
    programs: [
      pctProgram('day', 100, { protein: { unit: 'pctEnergy', value: 15.6 }, carbs: { unit: 'remainder' }, fat: { unit: 'g', value: 38 }, fatTypes: { mctG: mct } }, {
        meals: { meals: [{ clockH: 8, share: 0.3, macros: { fatG: 19 } }, { clockH: 12, share: 0, macros: { fatG: 19, carbG: 0, proteinG: 0 } }, { clockH: 18, share: 0.6, macros: { fatG: 0 } }] },
      }),
    ],
    use: 0,
  }),
  options: FULL_RUN,
});
const testDayMean = (v: ArmView, id: SeriesId): number => hourSum(v, id, 48 + 8, 48 + 16) / 8;

export const D05_V12_MCT: Scenario = {
  id: '05-V12-vandenberghe-2017-c8',
  dossier: '05',
  target: 'V12',
  title: 'Vandenberghe 2017: two doses of ≈ 19 g caprylic acid (C8), day-long mean ketones',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Vandenberghe et al. 2017 (dossier 05 ref [55]); dossier 05 §7 V12',
  notes: 'A 21-y man (70 kg) at 100 % of maintenance whose only fat is 38 g taken as 2 × 19 g with breakfast (08:00) and on its own 4 h later (12:00, fasted): C8 (MCT) in one arm, ordinary fat in the other; protein 15.6 %E, carbohydrate the remainder. Test-day (08:00-16:00, day 2) mean total-ketone difference +0.295 ± 0.155 mM.',
  arms: { control: mctArm(0), mct: mctArm(38) },
  expectations: [{ id: 'mean', label: 'test-day (08-16 h) mean total ketones, C8 minus control (+0.295 mM)', unit: 'mmol/L', measure: (c) => testDayMean(c.arm('mct'), 'totalKetones') - testDayMean(c.arm('control'), 'totalKetones'), check: val(0.295, 0.155), source: 'dossier 05 V12 (±0.155 mM)' }],
};

// ---- V13 Burke 2021

const WALKER_ELITE = person({ sex: 'male', ageYears: 28, heightCm: 178, weightKg: 68, bodyFatPct: 8, trainingYears: 6, trainingHistory: 'gt3y' });

export const D05_V13_BURKE: Scenario = {
  id: '05-V13-burke-2021-lchf',
  dossier: '05',
  target: 'V13',
  title: 'Burke 2021: elite walkers, 5-6 d at < 50 g carbohydrate and 2.2 g/kg protein with heavy training',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Burke et al. 2021 (dossier 05 ref [32]); dossier 05 §7 V13',
  notes: 'Elite walkers: a 28-y lean man (178 cm, 68 kg, 8 % BF); 6 days at 45 g carbohydrate, protein 2.2 g/kg, fat remainder, with 2 × 90 min of walking (60 % VO2max) daily as the "heavy training", fed to energy balance as in the study at the engine\'s own mean TEE on this schedule (`atModelTee`, ≈ 4 100 kcal/d ≈ 60 kcal/kg; finisher fixture fix 2026-09-30 — the earlier fixed 152 % of maintenance still left a 130-180 kcal/d deficit, which raises FFA and BHB). Resting BHB 1.2 ± 0.79 mM (±30 %). Reversal after 5-6 d HCHO and the exercise fat-oxidation rate are not rows.',
  arms: {
    main: {
      profile: WALKER_ELITE,
      schedule: atModelTee(
        WALKER_ELITE,
        buildSchedule({
          days: 6,
          programs: [{ id: 'lchf', label: 'lchf', energy: { kind: 'pctMaintenance', pct: 100, reference: 'current' }, macros: { protein: { unit: 'gPerKgBw', value: 2.2 }, carbs: { unit: 'g', value: 45 }, fat: { unit: 'remainder' } }, exercise: [cardioSession('walk', 7, 90, { pctVo2max: 0.6 }), cardioSession('walk', 16, 90, { pctVo2max: 0.6 })] }],
          use: 0,
        }),
      ),
      options: FULL_RUN,
    },
  },
  expectations: [{ id: 'bhb', label: 'resting BHB on day 6 (07:00 hour, 1.2 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('bhb', 24 * 5 + 6), check: bhbTol(1.2), source: 'dossier 05 V13' }],
};

// ---- V14 Johnstone 2008 / V15 Veldhorst 2010 (K)

const OBESE_M = person({ sex: 'male', ageYears: 45, heightCm: 178, weightKg: 110 });
/** Johnstone 2008: ad-libitum intake on the ketogenic (HPLC) diet 7.25 MJ/d. */
const JOHNSTONE_KCAL = Math.round(7250 / 4.184);

export const D05_V14_JOHNSTONE: Scenario = {
  id: '05-V14-johnstone-2008',
  dossier: '05',
  target: 'V14',
  title: 'Johnstone 2008: 4 weeks at 4 % carbohydrate and 30 % protein in obese men',
  level: 'I',
  gate: 'M', // promoted from K by the finisher 2026-09-30: inside its band once the study's measured intake is fed
  requires: FASTING,
  citation: 'Johnstone et al. 2008 (dossier 05 ref [27]); dossier 05 §7 V14 (§9.2: K)',
  notes: '17 obese men: a 45-y man, 178 cm, 110 kg. The study was ad libitum; the measured intake on the ketogenic diet, 7.25 MJ/d ≈ 1 733 kcal/d (Johnstone 2008), is fed (finisher fixture fix 2026-09-30; formerly an assumed 80 % of maintenance ≈ 2 300 kcal/d). Plasma BHB 1.52 mM (morning hour, last week); the dossier model gives 0.98 (its known under-prediction, at an assumed intake).',
  arms: { main: { profile: OBESE_M, schedule: constantSchedule(28, kcalProgram('lc', JOHNSTONE_KCAL, pctMacros(30, 4))), options: FULL_RUN } },
  expectations: [{ id: 'bhb', label: 'BHB in week 4 (1.52 mM)', unit: 'mmol/L', measure: (c) => morningBhb(c.main, 21, 28), check: bhbTol(1.52), source: 'dossier 05 V14' }],
};

export const D05_V15_VELDHORST: Scenario = {
  id: '05-V15-veldhorst-2010',
  dossier: '05',
  target: 'V15',
  title: 'Veldhorst 2010: one day at 0 % carbohydrate / 30 % protein after glycogen-lowering exercise (known under-prediction)',
  level: 'I',
  gate: 'K',
  requires: FASTING,
  citation: 'Veldhorst et al. 2010 (dossier 05 ref [28]); dossier 05 §7 V15 (§9.2: K)',
  notes: 'A 28-y man (75 kg): 2 h of cycling at 70 % VO2max in the evening of day 0 after the last meal (21:00), then a day at 0 % carbohydrate, 30 % protein, 70 % fat; BHB the next morning (07:00 of day 2), as in dossier 05 (finisher fixture fix 2026-09-30: the depletion was at 08:00 of a 47 %-carbohydrate day, refilled by the evening, and BHB was read after a second no-carbohydrate day). Observed 1.35 ± 0.65 mM; the dossier model gives 0.54.',
  arms: {
    main: {
      profile: ESTER,
      // glycogen-lowering ride after the last meal, not fed back (R-MAINT: % of the habitual-activity maintenance)
      schedule: segmentSchedule([pctProgram('deplete', 100, neutralMacros('male'), { exercise: [cardioSession('cycle', 21, 120, { pctVo2max: 0.7 })] }, undefined, 'habitual'), pctProgram('noCarb', 100, pctMacros(30, 0), {}, undefined, 'habitual')], [{ days: 1, program: 0 }, { days: 2, program: 1 }]),
      options: FULL_RUN,
    },
  },
  expectations: [{ id: 'bhb', label: 'BHB the morning after the 0 % carbohydrate day (1.35 mM)', unit: 'mmol/L', measure: (c) => c.main.hour('bhb', 24 * 2 + 6), check: bhbTol(1.35), source: 'dossier 05 V15' }],
};

export const SCENARIOS_FUEL_KETONE: Scenario[] = [
  D04_V1_ACHESON_1982,
  D04_V2_ACHESON_1988,
  D04_V3_LIVER,
  D04_V4_BUSSAU,
  D04_V5_FUCHS,
  D04_V6_SCHRAUWEN,
  D04_V7_HALL2015,
  D05_V1_MCDOUGAL,
  D05_V2_HAYMOND,
  D05_V3_DERU_2021,
  D05_V4_OWEN,
  D05_V5_HALL2016,
  D05_V6_HARVEY,
  D05_V7_DERU_2024,
  D05_V8_GIPSON,
  D05_V9_URBAIN,
  D05_V10_FERY,
  D05_V11_ESTER,
  D05_V12_MCT,
  D05_V13_BURKE,
  D05_V14_JOHNSTONE,
  D05_V15_VELDHORST,
];
