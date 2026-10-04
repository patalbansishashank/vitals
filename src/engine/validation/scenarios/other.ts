/**
 * Dossiers 06 (lipids and cardiometabolic markers), 08 (autophagy and longevity pathways), 12 (hormones, appetite),
 * 14 (anthropometrics), 15 (micronutrients, fibre, hydration, substances) and 19 (performance, bone, other outcomes):
 * the end-to-end targets of MODEL_SPEC §9.2 rows 06, 08, 12, 14, 15 and 19.
 *
 * Dossiers 17 (safety golden tests) and 21 (intervention-lever checks) are level U in §9.2 (module-owner tests on
 * canonical trajectories and lever values), and the unit rows of 08, 12, 14 and 15 (ASI anchor table, regression tables,
 * the `src/engine/body` suite, closed-form kinetics) are not scenarios; they are not encoded here.
 *
 * Blood markers and hormones are compared as changes or ratios to the person's own baseline (R-PRES). Studies whose
 * baseline laboratory values are given enter them through `PersonProfile.labs`.
 */
import { resolveProfile } from '../../core/resolveProfile';
import type { PersonProfile } from '../../types';
import { MAN, person, personWithTdee, tdee0Of } from '../fixtures/personas';
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
  proteinPerKgMacros,
  rtSession,
  segmentSchedule,
  trainingSchedule,
  waterOnlyProgram,
} from '../fixtures/programs';
import { above, below, range, rel, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { ArmSpec, Scenario } from '../harness/types';
import type { ArmView } from '../harness/view';
import type { SeriesId } from '../../types/metrics';
import { CALERIE2 } from './d01';
import { A1, D13_V2_YANG } from './fasting';
import { scaleDelta } from './util';

const FULL = REQUIRES.FULL;
const CORE = REQUIRES.CORE;
const FULL_RUN = { record: 'full' as const };

/** Percent change of a daily series after n days vs its t = 0 value. */
const pctChange = (v: ArmView, id: SeriesId, n: number): number => 100 * (v.after(id, n) / v.initial(id) - 1);
const MG_DL_PER_MMOL_TG = 88.57;

/** Day index at which the scale first reaches `lossPct` % below the entered weight; NaN if never. */
function firstDayAtLoss(v: ArmView, lossPct: number): number {
  const a = v.daily('scaleWeight');
  if (!a) return Number.NaN;
  const target = v.profile.weightKg * (1 - lossPct / 100);
  for (let d = 0; d < a.length; d++) if (a[d]! <= target) return d;
  return Number.NaN;
}
/** Value of a daily series on the day a given weight loss is first reached. */
function atLoss(v: ArmView, id: SeriesId, lossPct: number): number {
  const d = firstDayAtLoss(v, lossPct);
  return Number.isNaN(d) ? Number.NaN : v.day(id, d);
}

// =====================================================================================================================
// Dossier 06 §7
// =====================================================================================================================

// ---- V1 Mensink 2016: isocaloric fatty-acid and carbohydrate swaps

const SWAP_MAN = person({ sex: 'male', ageYears: 40, heightCm: 180, weightKg: 85 });
const swapArm = (macros: ReturnType<typeof neutralMacros>): ArmSpec => ({ profile: SWAP_MAN, schedule: constantSchedule(42, pctProgram('swap', 100, macros)) });
const base = neutralMacros('male');

export const D06_V1_MENSINK: Scenario = {
  id: '06-V1-mensink-2016-fat-swaps',
  dossier: '06',
  target: 'V1',
  title: 'Mensink 2016: 10 %E SFA → cis-PUFA and 10 %E carbohydrate → SFA, isocaloric, 6 weeks',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Mensink 2016 WHO meta-regression (dossier 06 ref R1); dossier 06 §7 V1',
  notes:
    'A 40-y man (180 cm, 85 kg) at 100 % of maintenance for 6 weeks. Habitual diet: fat ≈ 36 %E with SFA 11.6, MUFA 12.4, PUFA 8.4 %E (dossier 06 §2.4 shares 0.32/0.34/0.23). Arm PUFA: SFA 11.6 → 1.6 %E and PUFA 8.4 → 18.4 %E (fat shares 0.044 / 0.34 / 0.51); ' +
    'arm SFA: carbohydrate 45.4 → 35.4 %E with the 10 %E added as SFA (fat 46 %E: shares 0.47 / 0.27 / 0.18). Differences to the habitual arm at day 42 (±25 %): SFA→PUFA LDL −0.55, HDL −0.05, TG −0.10; carbohydrate→SFA LDL +0.36, HDL +0.11, TG −0.12 mmol/L.',
  arms: {
    base: swapArm(base),
    pufa: swapArm({ ...base, fatTypes: { satShare: 0.044, mufaShare: 0.34, pufaShare: 0.51 } }),
    sfa: swapArm({ ...base, carbs: { unit: 'pctEnergy', value: 35.4 }, fatTypes: { satShare: 0.47, mufaShare: 0.27, pufaShare: 0.18 } }),
  },
  expectations: [
    { id: 'ldlPufa', label: 'SFA → PUFA: LDL change (−0.55 mmol/L)', unit: 'mmol/L', measure: (c) => c.arm('pufa').after('ldl', 42) - c.arm('base').after('ldl', 42), check: rel(-0.55, 0.25), source: 'dossier 06 V1 (±25 %)' },
    { id: 'hdlPufa', label: 'SFA → PUFA: HDL change (−0.05 mmol/L)', unit: 'mmol/L', measure: (c) => c.arm('pufa').after('hdl', 42) - c.arm('base').after('hdl', 42), check: rel(-0.05, 0.25), source: 'dossier 06 V1 (±25 %)' },
    { id: 'tgPufa', label: 'SFA → PUFA: TG change (−0.10 mmol/L)', unit: 'mmol/L', measure: (c) => c.arm('pufa').after('triglycerides', 42) - c.arm('base').after('triglycerides', 42), check: rel(-0.1, 0.25), source: 'dossier 06 V1 (±25 %)' },
    { id: 'ldlSfa', label: 'carbohydrate → SFA: LDL change (+0.36 mmol/L)', unit: 'mmol/L', measure: (c) => c.arm('sfa').after('ldl', 42) - c.arm('base').after('ldl', 42), check: rel(0.36, 0.25), source: 'dossier 06 V1 (±25 %)' },
    { id: 'hdlSfa', label: 'carbohydrate → SFA: HDL change (+0.11 mmol/L)', unit: 'mmol/L', measure: (c) => c.arm('sfa').after('hdl', 42) - c.arm('base').after('hdl', 42), check: rel(0.11, 0.25), source: 'dossier 06 V1 (±25 %)' },
    { id: 'tgSfa', label: 'carbohydrate → SFA: TG change (−0.12 mmol/L)', unit: 'mmol/L', measure: (c) => c.arm('sfa').after('triglycerides', 42) - c.arm('base').after('triglycerides', 42), check: rel(-0.12, 0.25), source: 'dossier 06 V1 (±25 %)' },
  ],
};

// ---- V3 Skulas-Ray 2011: EPA + DHA and triglycerides

const HTG_MAN = person({ sex: 'male', ageYears: 45, heightCm: 180, weightKg: 90, extra: { labs: { tgMmolL: 237 / MG_DL_PER_MMOL_TG } } });
const omegaArm = (g: number): ArmSpec => ({ profile: HTG_MAN, schedule: constantSchedule(56, pctProgram(`epaDha${g}`, 100, { ...base, fatTypes: { omega3G: g } })) });

export const D06_V3_SKULAS_RAY: Scenario = {
  id: '06-V3-skulas-ray-2011-omega3',
  dossier: '06',
  target: 'V3',
  title: 'Skulas-Ray 2011: 0.85 vs 3.4 g/d EPA + DHA for 8 weeks in men with TG 150-500 mg/dL',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Skulas-Ray et al. 2011 (dossier 06 ref R38b); dossier 06 §7 V3',
  notes: 'A 45-y man (180 cm, 90 kg) with baseline TG 237 mg/dL (2.68 mmol/L, entered as a lab baseline), otherwise habitual. TG change at 8 weeks: −27 % at 3.4 g/d (±8 points), no effect at 0.85 g/d (0 ± 8); LDL, HDL and CRP unchanged (Q, ±5 %).',
  arms: { low: omegaArm(0.85), high: omegaArm(3.4) },
  expectations: [
    { id: 'high', label: '3.4 g/d: TG change after 8 wk (−27 %)', unit: '%', measure: (c) => pctChange(c.arm('high'), 'triglycerides', 56), check: val(-27, 8), source: 'dossier 06 V3 (±8 points)' },
    { id: 'low', label: '0.85 g/d: TG change after 8 wk (no effect)', unit: '%', measure: (c) => pctChange(c.arm('low'), 'triglycerides', 56), check: val(0, 8), source: 'dossier 06 V3 (±8 points)' },
    { id: 'ldl', label: '3.4 g/d: LDL unchanged (0 ± 5 %)', unit: '%', measure: (c) => pctChange(c.arm('high'), 'ldl', 56), check: val(0, 5), gate: 'Q', source: 'dossier 06 V3', note: 'Band ±5 % assumed.' },
    { id: 'crp', label: '3.4 g/d: CRP unchanged (0 ± 5 %)', unit: '%', measure: (c) => pctChange(c.arm('high'), 'crp', 56), check: val(0, 5), gate: 'Q', source: 'dossier 06 V3', note: 'Band ±5 % assumed.' },
  ],
};

// ---- V4 Browning 2011 / V5 Mardinoglu 2018 / V6 Lim 2011: liver fat and TG with diets

const NAFLD_W = person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 95, extra: { labs: { liverFatPct: 20 } } }); // BMI 35
const browningArm = (carbG: number): ArmSpec => ({ profile: NAFLD_W, schedule: constantSchedule(14, kcalProgram(`kcal1350c${carbG}`, 1350, gramMacros(85, carbG))) });

export const D06_V4_BROWNING: Scenario = {
  id: '06-V4-browning-2011-nafld',
  dossier: '06',
  target: 'V4',
  title: 'Browning 2011: NAFLD, 2 weeks of 1 200-1 500 kcal vs < 20 g carbohydrate/d',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Browning et al. 2011 (dossier 06 ref R53b); dossier 06 §7 V4',
  notes: 'NAFLD, BMI 35: a 45-y woman, 165 cm, 95 kg, liver fat 20 % (baseline not in the dossier: assumption). Both arms 1 350 kcal/d for 14 d with 85 g protein: mixed (carbohydrate 160 g) vs low-carbohydrate (18 g). IHTG −28 % vs −55 % (±10 points); weight −4.0 vs −4.6 kg (Q, ±1.0 kg assumed).',
  arms: { mixed: browningArm(160), lowCarb: browningArm(18) },
  expectations: [
    { id: 'mixed', label: 'hypocaloric mixed diet: liver-fat change after 14 d (−28 %)', unit: '%', measure: (c) => pctChange(c.arm('mixed'), 'liverFat', 14), check: val(-28, 10), source: 'dossier 06 V4 (±10 points)' },
    { id: 'lowCarb', label: 'low-carbohydrate: liver-fat change after 14 d (−55 %)', unit: '%', measure: (c) => pctChange(c.arm('lowCarb'), 'liverFat', 14), check: val(-55, 10), source: 'dossier 06 V4 (±10 points)' },
    { id: 'wMixed', label: 'mixed: weight change (−4.0 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('mixed'), 14), check: val(-4.0, 1.0), gate: 'Q', source: 'dossier 06 V4' },
    { id: 'wLc', label: 'low-carbohydrate: weight change (−4.6 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('lowCarb'), 14), check: val(-4.6, 1.0), gate: 'Q', source: 'dossier 06 V4' },
  ],
};

const MARDINOGLU = personWithTdee({ sex: 'male', ageYears: 50, heightCm: 178, weightKg: 105, extra: { labs: { liverFatPct: 16.0 } } }, 3115).profile;

export const D06_V5_MARDINOGLU: Scenario = {
  id: '06-V5-mardinoglu-2018-isocaloric-low-carb',
  dossier: '06',
  target: 'V5',
  title: 'Mardinoglu 2018: obese NAFLD adults, 14 d isocaloric (3 115 kcal/d), < 30 g carbohydrate',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Mardinoglu et al. 2018 Cell Metab (dossier 06 ref R53c); dossier 06 §7 V5',
  notes: 'A 50-y man, 178 cm, 105 kg, IHTG 16.0 %, step count solved so the engine maintenance = 3 115 kcal/d; 14 d at 3 115 kcal/d with 28 g carbohydrate and 110 g protein. IHTG −43.8 % (±10 points); weight −1.8 %, plasma TG −48 % (Q, ±1.0 point / ±15 points assumed).',
  arms: { main: { profile: MARDINOGLU, schedule: constantSchedule(14, kcalProgram('isoLc', 3115, gramMacros(110, 28))) } },
  expectations: [
    { id: 'ihtg', label: 'liver-fat change after 14 d (−43.8 %)', unit: '%', measure: (c) => pctChange(c.main, 'liverFat', 14), check: val(-43.8, 10), source: 'dossier 06 V5 (±10 points)' },
    { id: 'ihtgDay1', label: 'liver-fat fall is already significant on day 1 (< −5 %)', unit: '%', measure: (c) => pctChange(c.main, 'liverFat', 1), check: below(-5), gate: 'Q', source: 'dossier 06 V5 ("significant at day 1")', note: 'Threshold assumed.' },
    { id: 'weight', label: 'weight change (−1.8 %)', unit: '%', measure: (c) => c.main.pct('scaleWeight', 14), check: val(-1.8, 1.0), gate: 'Q', source: 'dossier 06 V5' },
    { id: 'tg', label: 'plasma TG change (−48 %)', unit: '%', measure: (c) => pctChange(c.main, 'triglycerides', 14), check: val(-48, 15), gate: 'Q', source: 'dossier 06 V5' },
  ],
};

const LIM = person({ sex: 'male', ageYears: 50, heightCm: 175, weightKg: 103, extra: { labs: { fastingGlucoseMmolL: 9.2, tgMmolL: 2.4, liverFatPct: 12.8 } } }); // BMI 33.6

export const D06_V6_LIM: Scenario = {
  id: '06-V6-lim-2011-600kcal',
  dossier: '06',
  target: 'V6',
  title: 'Lim 2011: type 2 diabetes, 600 kcal/d for 8 weeks (glucose, TG and liver fat)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Lim et al. 2011 Diabetologia (dossier 06 ref R56); dossier 06 §7 V6',
  notes: '11 people with type 2 diabetes, BMI 33.6: a 50-y man, 175 cm, 103 kg with baseline fasting glucose 9.2 mmol/L, TG 2.4 mmol/L, IHTG 12.8 % (lab baselines). 600 kcal/d for 56 d (protein 25 %E, carbohydrate 45 %E). Rows (±20 %): fasting glucose 5.9 mmol/L and TG 1.2 mmol/L by week 1 (day 7), IHTG 2.9 % at 8 wk. Weight −15.3 kg at 8 wk is Q (±3 kg).',
  arms: { main: { profile: LIM, schedule: constantSchedule(56, kcalProgram('vlcd600', 600, pctMacros(25, 45))) } },
  expectations: [
    { id: 'fpg', label: 'fasting glucose at week 1 (5.9 mmol/L)', unit: 'mmol/L', measure: (c) => c.main.after('fastingGlucose', 7), check: rel(5.9, 0.2), source: 'dossier 06 V6 (±20 %)' },
    { id: 'tg', label: 'TG at week 1 (1.2 mmol/L)', unit: 'mmol/L', measure: (c) => c.main.after('triglycerides', 7), check: rel(1.2, 0.2), source: 'dossier 06 V6 (±20 %)' },
    { id: 'ihtg', label: 'IHTG at 8 weeks (2.9 %)', unit: '%', measure: (c) => c.main.after('liverFat', 56), check: rel(2.9, 0.2), source: 'dossier 06 V6 (±20 %)' },
    { id: 'weight', label: 'weight change at 8 weeks (−15.3 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 56), check: val(-15.3, 3), gate: 'Q', source: 'dossier 06 V6' },
  ],
};

// ---- V7 Luukkonen 2018 / Rosqvist: liver fat in +1000 kcal/d overfeeding with SFA, unsaturated fat, sugar

const LUUK = person({ sex: 'male', ageYears: 45, heightCm: 178, weightKg: 88 });
const luukRp = resolveProfile(LUUK);
/**
 * Energy surplus that reproduces the observed weight gain (+1.4 kg in 3 weeks) rather than the prescribed +1 000 kcal/d
 * (fixture fix 2026-09-30): 11 §4.9's k_SFA / k_unsat / k_sugar are "% IHTG per % of observed body-weight gain", and the
 * engine turns a full +1 000 kcal/d into +2.8 kg (the participants' free-living compensation is not modelled), which would
 * double the liver-fat stimulus the coefficients were fitted to.
 */
const LUUK_SURPLUS_KCAL = 550;
const luukProg = (kind: 'sfa' | 'unsat' | 'sugar') =>
  kcalProgram(
    `over_${kind}`,
    Math.round(luukRp.tdee0Kcal + LUUK_SURPLUS_KCAL),
    kind === 'sugar'
      ? { protein: { unit: 'g', value: luukRp.habitualProteinG }, carbs: { unit: 'remainder' }, fat: { unit: 'g', value: luukRp.habitualFatG }, sugarsShare: 0.85 }
      : { protein: { unit: 'g', value: luukRp.habitualProteinG }, carbs: { unit: 'g', value: luukRp.habitualCarbG }, fat: { unit: 'remainder' }, fatTypes: kind === 'sfa' ? { satShare: 0.6, mufaShare: 0.25, pufaShare: 0.1 } : { satShare: 0.12, mufaShare: 0.48, pufaShare: 0.35 } },
  );
const luukArm = (kind: 'sfa' | 'unsat' | 'sugar'): ArmSpec => ({ profile: LUUK, schedule: constantSchedule(21, luukProg(kind)) });

export const D06_V7_LUUKKONEN: Scenario = {
  id: '06-V7-luukkonen-2018-overfeeding',
  dossier: '06',
  target: 'V7',
  title: 'Luukkonen 2018: +1 000 kcal/d for 3 weeks as saturated fat, unsaturated fat or simple sugar (liver fat)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Luukkonen et al. 2018 (dossier 06 ref R54); dossier 06 §7 V7',
  notes: 'A 45-y man (178 cm, 88 kg, habitual liver fat), 21 days at maintenance + 550 kcal/d (the surplus that reproduces the observed +1.4 kg; prescribed +1 000 kcal/d) with protein and the other macro at the habitual grams: SFA (fat SFA share 0.6), UNSAT (SFA 0.12, MUFA 0.48, PUFA 0.35), or sugar (carbohydrate 85 % sugars). IHTG +55 / +15 / +33 % (±15 points).',
  arms: { sfa: luukArm('sfa'), unsat: luukArm('unsat'), sugar: luukArm('sugar') },
  expectations: [
    { id: 'sfa', label: 'SFA overfeeding: liver-fat change (+55 %)', unit: '%', measure: (c) => pctChange(c.arm('sfa'), 'liverFat', 21), check: val(55, 15), source: 'dossier 06 V7 (±15 points)' },
    { id: 'unsat', label: 'unsaturated overfeeding: liver-fat change (+15 %)', unit: '%', measure: (c) => pctChange(c.arm('unsat'), 'liverFat', 21), check: val(15, 15), source: 'dossier 06 V7 (±15 points)' },
    { id: 'sugar', label: 'sugar overfeeding: liver-fat change (+33 %)', unit: '%', measure: (c) => pctChange(c.arm('sugar'), 'liverFat', 21), check: val(33, 15), source: 'dossier 06 V7 (±15 points)' },
  ],
};

// ---- V8 Magkos 2016: weight-stable after 5.1 / 10.8 / 16.4 % weight loss (read at the weight reached)

const MAGKOS = person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 100, extra: { labs: { liverFatPct: 8.5, tgMmolL: 153 / MG_DL_PER_MMOL_TG } } });

export const D06_V8_MAGKOS: Scenario = {
  id: '06-V8-magkos-2016-weight-loss-dose',
  dossier: '06',
  target: 'V8',
  title: 'Magkos 2016: liver fat and triglycerides after 5.1 / 10.8 / 16.4 % weight loss',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Magkos et al. 2016 Cell Metab (dossier 06 ref R30); dossier 06 §7 V8',
  notes:
    'Obese adults (baseline IHTG 8.5 %, TG 153 mg/dL entered as lab baselines): a 45-y woman, 165 cm, 100 kg at 70 % of maintenance for 420 days (the BWP oracle reaches −16.4 % on day 279). The markers are read on the day the scale first reaches −5.1 / −10.8 / −16.4 % (the study measured after weight stabilisation; the engine markers respond ' +
    'to the loss, not to the stabilisation, so this compares the same weight-loss dose). IHTG 8.5 → 7.4 / 4.1 / 3.0 %; TG 153 → 130 / 110 / 97 mg/dL (±15 %); LDL, HDL and fasting glucose ≈ unchanged (Q).',
  arms: { main: { profile: MAGKOS, schedule: constantSchedule(420, pctProgram('loss', 70, neutralMacros('female'))) } },
  expectations: [
    { id: 'ihtg5', label: 'IHTG at −5.1 % weight (7.4 %)', unit: '%', measure: (c) => atLoss(c.main, 'liverFat', 5.1), check: rel(7.4, 0.15), source: 'dossier 06 V8 (±15 %)' },
    { id: 'ihtg11', label: 'IHTG at −10.8 % weight (4.1 %)', unit: '%', measure: (c) => atLoss(c.main, 'liverFat', 10.8), check: rel(4.1, 0.15), source: 'dossier 06 V8 (±15 %)' },
    { id: 'ihtg16', label: 'IHTG at −16.4 % weight (3.0 %)', unit: '%', measure: (c) => atLoss(c.main, 'liverFat', 16.4), check: rel(3.0, 0.15), source: 'dossier 06 V8 (±15 %)' },
    { id: 'tg5', label: 'TG at −5.1 % weight (130 mg/dL)', unit: 'mg/dL', measure: (c) => MG_DL_PER_MMOL_TG * atLoss(c.main, 'triglycerides', 5.1), check: rel(130, 0.15), source: 'dossier 06 V8 (±15 %)' },
    { id: 'tg11', label: 'TG at −10.8 % weight (110 mg/dL)', unit: 'mg/dL', measure: (c) => MG_DL_PER_MMOL_TG * atLoss(c.main, 'triglycerides', 10.8), check: rel(110, 0.15), source: 'dossier 06 V8 (±15 %)' },
    { id: 'tg16', label: 'TG at −16.4 % weight (97 mg/dL)', unit: 'mg/dL', measure: (c) => MG_DL_PER_MMOL_TG * atLoss(c.main, 'triglycerides', 16.4), check: rel(97, 0.15), source: 'dossier 06 V8 (±15 %)' },
  ],
};

// ---- V9 sodium step (the DASH diet pattern itself has no engine input beyond potassium/fibre)

// DASH-Sodium enrolled SBP 120-159 mmHg (mean ≈ 135): the entered lab sets the baseline (fixture fix 2026-09-30; the NHANES
// default of ≈ 124 mmHg for this man puts the sodium effect near its normotensive floor)
const SODIUM_MAN = person({ sex: 'male', ageYears: 50, heightCm: 178, weightKg: 88, habitualProteinGPerKg: 1.2, extra: { habits: { habitualSodiumG: 3.45 }, labs: { sbpMmHg: 135 } } });

export const D06_V9_SODIUM: Scenario = {
  id: '06-V9-sacks-2001-sodium',
  dossier: '06',
  target: 'V9 (sodium)',
  title: 'Sacks 2001: sodium 150 → 50 mmol/d on the control diet, systolic BP',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Sacks et al. 2001 DASH-Sodium (dossier 06 ref R46); dossier 06 §7 V9',
  notes: 'A 50-y man (178 cm, 88 kg) whose habitual sodium is 150 mmol/d (3.45 g) at 50 mmol/d (1.15 g) for 4 weeks, weight-stable. SBP −6.7 mmHg (± 1.5), no plateau at 4 weeks (−0.94 mmHg/week ⇒ weeks 3-4 fall > 0.3 mmHg). The DASH dietary pattern rows (−5.5/−3.0, hypertensives −11.4/−5.5) need food-group inputs the schedule does not have (only sodium, potassium and fibre): not encoded.',
  arms: {
    main: {
      profile: { ...SODIUM_MAN, habits: { ...SODIUM_MAN.habits, habitualSodiumG: 3.45 } },
      schedule: constantSchedule(28, pctProgram('lowSodium', 100, neutralMacros('male'), { hydration: { sodiumG: 1.15 } })),
    },
  },
  expectations: [
    { id: 'sbp', label: 'SBP change after 4 weeks (−6.7 mmHg)', unit: 'mmHg', measure: (c) => c.main.delta('sbp', 28), check: val(-6.7, 1.5), source: 'dossier 06 V9 (±1.5 mmHg)' },
    { id: 'noPlateau', label: 'SBP still falling in weeks 3-4 (day-28 minus day-21 < 0)', unit: 'mmHg', measure: (c) => c.main.after('sbp', 28) - c.main.after('sbp', 21), check: below(0), gate: 'Q', source: 'dossier 06 V9 (no plateau at 4 wk)' },
  ],
};

// ---- V11 keto diet and LDL by BMI (sign flip)

const ketoLean = person({ sex: 'female', ageYears: 25, heightCm: 168, weightKg: 58 });
const ketoNorm = person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 72 });
const ketoObese = person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 106 }); // BMI 38.9
const ketoArm = (p: PersonProfile, days: number, pct: number): ArmSpec => ({ profile: p, schedule: constantSchedule(days, pctProgram('keto', pct, pctMacros(20, 4))) });

export const D06_V11_KETO_LDL: Scenario = {
  id: '06-V11-keto-ldl-by-bmi',
  dossier: '06',
  target: 'V11',
  title: 'Buren 2021 / Retterstøl 2018 vs Petersen 2026: LDL on a ketogenic diet flips sign with BMI',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Buren 2021, Retterstøl 2018, Petersen 2026 (dossier 06 refs R11, R12, R24); dossier 06 §7 V11 (LMHR heavy tail is Q and lives in the ensemble bands, §8)',
  notes:
    '(a) A lean young woman (25 y, 168 cm, 58 kg) on a ketogenic diet (4 %E carbohydrate, 20 % protein) for 4 weeks at maintenance: LDL +70 mg/dL (+1.81 mmol/L); (b) a normal-weight man (35 y, 178 cm, 72 kg) for 3 weeks: LDL +0.9 mmol/L; ' +
    '(c) BMI 39 (45-y woman, 165 cm, 106 kg) at 78 % of maintenance for 12 weeks to lose ≈ 10.5 % of weight: LDL −10 mg/dL (−0.26 mmol/L). "Sign and order of magnitude": accepted within a factor of 2 of the published change, sign strict.',
  arms: { lean: ketoArm(ketoLean, 28, 100), normal: ketoArm(ketoNorm, 21, 100), obese: ketoArm(ketoObese, 84, 78) },
  expectations: [
    { id: 'lean', label: 'lean woman: LDL change after 4 wk (+1.81 mmol/L; sign and order)', unit: 'mmol/L', measure: (c) => c.arm('lean').delta('ldl', 28), check: range(0.9, 3.6), source: 'dossier 06 V11 (sign and order of magnitude)' },
    { id: 'normal', label: 'normal-weight adult: LDL change after 3 wk (+0.9 mmol/L; sign and order)', unit: 'mmol/L', measure: (c) => c.arm('normal').delta('ldl', 21), check: range(0.45, 1.8), source: 'dossier 06 V11 (sign and order of magnitude)' },
    { id: 'obese', label: 'BMI 39 with ≈ 10 % loss: LDL change (−0.26 mmol/L; sign and order)', unit: 'mmol/L', measure: (c) => c.arm('obese').delta('ldl', 84), check: range(-0.52, -0.13), source: 'dossier 06 V11 (the engine must flip sign with BMI)' },
    { id: 'obeseLoss', label: 'BMI 39 arm: weight lost (≈ 10.5 %)', unit: '%', measure: (c) => -c.arm('obese').pct('scaleWeight', 84), check: val(10.5, 4), gate: 'Q', source: 'dossier 06 V11', note: 'Intake (78 % of maintenance) chosen to give a ≈ 10 % loss; not gated.' },
  ],
};

// ---- V12 DIETFITS (12 months, healthy low-fat vs low-carbohydrate)

const DIETFITS = person({ sex: 'male', ageYears: 40, heightCm: 172, weightKg: 92, extra: { sexUnspecified: true } });
const dietfitsArm = (macros: ReturnType<typeof pctMacros>): ArmSpec => ({ profile: DIETFITS, schedule: constantSchedule(365, pctProgram('dietfits', 88, macros)) });

export const D06_V12_DIETFITS: Scenario = {
  id: '06-V12-dietfits-12mo',
  dossier: '06',
  target: 'V12',
  title: 'DIETFITS: 12 months of healthy low-fat vs healthy low-carbohydrate diets (≈ −5.3 vs −6.0 kg)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Gardner et al. 2018 (dossier 06 ref R20); dossier 06 §7 V12',
  notes:
    'A sex-unspecified 40-y adult, 172 cm, 92 kg at 88 % of maintenance for 365 days (a mild deficit chosen so that the loss is ≈ 5-6 kg; the trial diets were ad libitum). Low-fat: protein 18 %E, carbohydrate 52 %E (fat ≈ 28 %); low-carbohydrate: carbohydrate 30 %E, protein 20 %E (fat ≈ 48 %); the macro splits are assumptions. ' +
    'Published changes: LDL −2.1 vs +3.6 mg/dL, TG −10 vs −28, HDL +0.4 vs +2.6, SBP −3.2 vs −3.7 mmHg (lipids ±4 mg/dL, BP ±1 mmHg). Weight rows are Q.',
  arms: { lowFat: dietfitsArm(pctMacros(18, 52)), lowCarb: dietfitsArm(pctMacros(20, 30)) },
  expectations: [
    { id: 'ldlLf', label: 'low-fat: LDL change (−2.1 mg/dL)', unit: 'mg/dL', measure: (c) => c.arm('lowFat').delta('ldl', 365) * 38.67, check: val(-2.1, 4), source: 'dossier 06 V12 (±4 mg/dL)' },
    { id: 'ldlLc', label: 'low-carbohydrate: LDL change (+3.6 mg/dL)', unit: 'mg/dL', measure: (c) => c.arm('lowCarb').delta('ldl', 365) * 38.67, check: val(3.6, 4), source: 'dossier 06 V12 (±4 mg/dL)' },
    { id: 'tgLf', label: 'low-fat: TG change (−10 mg/dL)', unit: 'mg/dL', measure: (c) => c.arm('lowFat').delta('triglycerides', 365) * MG_DL_PER_MMOL_TG, check: val(-10, 4), source: 'dossier 06 V12 (±4 mg/dL)' },
    { id: 'tgLc', label: 'low-carbohydrate: TG change (−28 mg/dL)', unit: 'mg/dL', measure: (c) => c.arm('lowCarb').delta('triglycerides', 365) * MG_DL_PER_MMOL_TG, check: val(-28, 4), source: 'dossier 06 V12 (±4 mg/dL)' },
    { id: 'hdlLf', label: 'low-fat: HDL change (+0.4 mg/dL)', unit: 'mg/dL', measure: (c) => c.arm('lowFat').delta('hdl', 365) * 38.67, check: val(0.4, 4), source: 'dossier 06 V12 (±4 mg/dL)' },
    { id: 'hdlLc', label: 'low-carbohydrate: HDL change (+2.6 mg/dL)', unit: 'mg/dL', measure: (c) => c.arm('lowCarb').delta('hdl', 365) * 38.67, check: val(2.6, 4), source: 'dossier 06 V12 (±4 mg/dL)' },
    { id: 'sbpLf', label: 'low-fat: SBP change (−3.2 mmHg)', unit: 'mmHg', measure: (c) => c.arm('lowFat').delta('sbp', 365), check: val(-3.2, 1), source: 'dossier 06 V12 (±1 mmHg)' },
    { id: 'sbpLc', label: 'low-carbohydrate: SBP change (−3.7 mmHg)', unit: 'mmHg', measure: (c) => c.arm('lowCarb').delta('sbp', 365), check: val(-3.7, 1), source: 'dossier 06 V12 (±1 mmHg)' },
    { id: 'wLf', label: 'low-fat: weight change (−5.3 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('lowFat'), 365), check: val(-5.3, 2), gate: 'Q', source: 'dossier 06 V12' },
    { id: 'wLc', label: 'low-carbohydrate: weight change (−6.0 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('lowCarb'), 365), check: val(-6.0, 2), gate: 'Q', source: 'dossier 06 V12' },
  ],
};

// ---- V14 Neter 2003: BP per kg of weight loss

const NETER = person({ sex: 'male', ageYears: 50, heightCm: 178, weightKg: 100 });

export const D06_V14_NETER: Scenario = {
  id: '06-V14-neter-2003-bp-per-kg',
  dossier: '06',
  target: 'V14',
  title: 'Neter 2003 / Dattilo 1992: blood pressure change per kg of weight lost',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Neter et al. 2003, Dattilo & Kris-Etherton 1992 (dossier 06 refs R41, R39); dossier 06 §7 V14',
  notes: 'A 50-y man (178 cm, 100 kg): 16 weeks at 75 % of maintenance then 8 weeks at 100 % of the current maintenance (weight-stable). Ratios at the end per kg lost: SBP −1.05, DBP −0.92 mmHg/kg (±30 %). DBP is not a series: SBP only.',
  arms: { main: { profile: NETER, schedule: segmentSchedule([pctProgram('lose', 75, neutralMacros('male')), pctProgram('hold', 100, neutralMacros('male'), {}, 'current')], [{ days: 112, program: 0 }, { days: 56, program: 1 }]) } },
  expectations: [{ id: 'sbpPerKg', label: 'SBP change per kg lost, weight-stable (−1.05 mmHg/kg)', unit: 'mmHg/kg', measure: (c) => c.main.delta('sbp', 168) / scaleDelta(c.main, 168), check: rel(1.05, 0.3), source: 'dossier 06 V14 (±30 %)' }],
};

// =====================================================================================================================
// Dossier 08 §7 (I-level rows)
// =====================================================================================================================

// ---- V1 / V3 / V4: fasting rows

export const D08_V1_V3_FASTING: Scenario = {
  id: '08-V1-V3-V4-fasting-pathways',
  dossier: '08',
  target: 'V1, V3, V4',
  title: 'Vendelbo 2014, Wijngaarden 2013, Hollstein / Chan / Isley / Clemmons: mTOR, AMPK, autophagy signal and IGF-1 across fasts',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Vendelbo 2014, Wijngaarden 2013 (dossier 08 refs [1,4]); Hollstein 2022, Chan 2008, Isley 1983, Clemmons 1981 (refs [81,82,78,79]); dossier 08 §7 V1, V3, V4',
  notes:
    'Lean man of dossier 20 Table A1: a 10-day water-only fast from the 20:00 last meal (hours counted from it) and a second arm with a 5-d fast then 5 d of normal refeeding. Rows: mTOR index at 72 h = 0.50-0.65 × its 12-h value; ' +
    'autophagy signal ≥ 60 at 72 h; AMPK at 48 h ≤ its 12-h value; IGF-1 relative: 24 h ≥ 0.93, 72 h 0.50 ± 0.08, 5 d 0.36 ± 0.08, 10 d 0.25 ± 0.06, after 5 d of refeeding 0.68 ± 0.10.',
  arms: {
    fast: { profile: A1, schedule: buildSchedule({ days: 12, programs: [pctProgram('maintenance', 100, neutralMacros('male'))], use: 0, events: [fastEvent(0, 240, 20)] }), options: FULL_RUN },
    refeed: { profile: A1, schedule: buildSchedule({ days: 11, programs: [pctProgram('maintenance', 100, neutralMacros('male'))], use: 0, events: [fastEvent(0, 120, 20)] }) },
  },
  expectations: [
    { id: 'mtor', label: 'mTOR index at 72 h relative to 12 h (0.50-0.65)', unit: 'ratio', measure: (c) => c.arm('fast').hour('mtorIdx', 20 + 72 - 1) / c.arm('fast').hour('mtorIdx', 20 + 12 - 1), check: range(0.5, 0.65), source: 'dossier 08 V1' },
    { id: 'asi', label: 'autophagy signal at 72 h (≥ 60, central 75)', unit: 'index', measure: (c) => c.arm('fast').hour('autophagyIdx', 20 + 72 - 1), check: above(60), source: 'dossier 08 V1' },
    { id: 'ampk', label: 'AMPK at 48 h minus its 12-h value (≤ 0)', unit: 'index', measure: (c) => c.arm('fast').hour('ampkIdx', 20 + 48 - 1) - c.arm('fast').hour('ampkIdx', 20 + 12 - 1), check: below(1e-9), source: 'dossier 08 V3 (no increase)' },
    { id: 'igf24', label: 'IGF-1 at 24 h of fasting (≥ 0.93)', unit: 'ratio', measure: (c) => c.arm('fast').after('igf1', 2) / c.arm('fast').initial('igf1'), check: above(0.93), source: 'dossier 08 V4', note: 'Day 2 end = 28 h from the 20:00 last meal.' },
    { id: 'igf72', label: 'IGF-1 at 72 h (0.50 ± 0.08)', unit: 'ratio', measure: (c) => c.arm('fast').after('igf1', 4) / c.arm('fast').initial('igf1'), check: val(0.5, 0.08), source: 'dossier 08 V4', note: 'Day 4 end = 76 h from the last meal.' },
    { id: 'igf5', label: 'IGF-1 at 5 d (0.36 ± 0.08)', unit: 'ratio', measure: (c) => c.arm('fast').after('igf1', 5) / c.arm('fast').initial('igf1'), check: val(0.36, 0.08), source: 'dossier 08 V4' },
    { id: 'igf10', label: 'IGF-1 at 10 d (0.25 ± 0.06)', unit: 'ratio', measure: (c) => c.arm('fast').after('igf1', 10) / c.arm('fast').initial('igf1'), check: val(0.25, 0.06), source: 'dossier 08 V4' },
    { id: 'igfRefeed', label: 'IGF-1 after 5 d of fasting and 5 d of normal refeeding (0.68 ± 0.10)', unit: 'ratio', measure: (c) => c.arm('refeed').after('igf1', 10) / c.arm('refeed').initial('igf1'), check: val(0.68, 0.1), source: 'dossier 08 V4' },
  ],
};

// ---- V2 exercise AMPK

const ampkArm = (pct: number, minutes: number): ArmSpec => ({
  profile: A1,
  schedule: buildSchedule({ days: 2, programs: [pctProgram('exercise', 100, neutralMacros('male'), { exercise: [cardioSession('cycle', 8, minutes, { pctVo2max: pct })] })], use: 0 }),
  options: FULL_RUN,
});

export const D08_V2_AMPK: Scenario = {
  id: '08-V2-wojtaszewski-ampk',
  dossier: '08',
  target: 'V2',
  title: 'Wojtaszewski 2000: AMPK after 60 min at 75 % VO2max vs 90 min at 50 %',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Wojtaszewski et al. 2000 (dossier 08 ref [33]); dossier 08 §7 V2',
  notes: 'Lean man (Table A1); the session starts at 08:00, rest is the 06:00 hour. End-of-bout = the last hour of exercise, +3 h = the hour that ends 3 h after the bout. AMPK ≥ 3.0 × rest after 60 min at 75 %; ≤ 1.3 × at 50 %; ≤ 1.2 × rest 3 h after the bout.',
  arms: { hard: ampkArm(0.75, 60), easy: ampkArm(0.5, 90) },
  expectations: [
    { id: 'hard', label: '75 % VO2max: AMPK at the end of the bout relative to rest (≥ 3.0)', unit: 'ratio', measure: (c) => c.arm('hard').hour('ampkIdx', 8) / c.arm('hard').hour('ampkIdx', 6), check: above(3.0), source: 'dossier 08 V2' },
    { id: 'easy', label: '50 % VO2max: AMPK at the end of the bout relative to rest (≤ 1.3)', unit: 'ratio', measure: (c) => c.arm('easy').hour('ampkIdx', 9) / c.arm('easy').hour('ampkIdx', 6), check: below(1.3), source: 'dossier 08 V2' },
    { id: 'recover', label: '75 % VO2max: AMPK 3 h after the bout relative to rest (≤ 1.2)', unit: 'ratio', measure: (c) => c.arm('hard').hour('ampkIdx', 12) / c.arm('hard').hour('ampkIdx', 6), check: below(1.2), source: 'dossier 08 V2' },
  ],
};

// ---- V5 Fontana protein restriction and CALERIE, V6 Wei fasting-mimicking diet

const FONTANA = person({ sex: 'male', ageYears: 50, heightCm: 178, weightKg: 75, habitualProteinGPerKg: 1.67, bodyFatPct: 18 });
const CAL_IGF = person({ sex: 'female', ageYears: 38, heightCm: 165, weightKg: 68, habitualProteinGPerKg: 1.2 });

export const D08_V5_FONTANA: Scenario = {
  id: '08-V5-fontana-igf1',
  dossier: '08',
  target: 'V5',
  title: 'Fontana 2008 / 2016: IGF-1 with protein 1.67 → 0.95 g/kg for 3 weeks and with 2 years of 12 % CR at unchanged protein',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Fontana et al. 2008, Fontana 2016 CALERIE (dossier 08 refs [55,56]); dossier 08 §7 V5',
  notes: 'Arm protein: a 50-y man (75 kg) with habitual protein 1.67 g/kg switched to 0.95 g/kg for 21 days at 100 % of maintenance; IGF-1 0.78 ± 0.06. Arm CR: a 38-y woman (68 kg, habitual protein 1.2 g/kg) at 88 % of maintenance with protein held at 1.2 g/kg for 730 days; IGF-1 1.00 ± 0.05.',
  arms: {
    protein: { profile: FONTANA, schedule: constantSchedule(21, pctProgram('lowProtein', 100, proteinPerKgMacros(0.95, 50))) },
    cr: { profile: CAL_IGF, schedule: constantSchedule(730, pctProgram('cr12', 88, proteinPerKgMacros(1.2, 50))) },
  },
  expectations: [
    { id: 'protein', label: 'IGF-1 after 3 weeks at 0.95 g/kg protein (0.78 ± 0.06)', unit: 'ratio', measure: (c) => c.arm('protein').after('igf1', 21) / c.arm('protein').initial('igf1'), check: val(0.78, 0.06), source: 'dossier 08 V5' },
    { id: 'cr', label: 'IGF-1 after 2 years of 12 % CR at unchanged protein g/kg (1.00 ± 0.05)', unit: 'ratio', measure: (c) => c.arm('cr').after('igf1', 730) / c.arm('cr').initial('igf1'), check: val(1.0, 0.05), source: 'dossier 08 V5' },
  ],
};

const fmdDay = (kcal: number) => kcalProgram(`fmd${kcal}`, kcal, { protein: { unit: 'pctEnergy', value: 10 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } });
const FMD_PROGS = [pctProgram('habitual', 100, neutralMacros('male')), fmdDay(1100), fmdDay(720)];

export const D08_V6_FMD: Scenario = {
  id: '08-V6-wei-2017-fmd',
  dossier: '08',
  target: 'V6',
  title: 'Wei 2017: fasting-mimicking diet, 5 days/month × 3, IGF-1 5-7 days after the third cycle',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Wei et al. 2017 Sci Transl Med (dossier 08 ref [71]); dossier 08 §7 V6',
  notes: 'A 45-y man (180 cm, 85 kg): FMD cycles start on days 0, 30 and 60; day 1 1 100 kcal, days 2-5 720 kcal (protein 10 %E, carbohydrate 45 %E); all other days at 100 % of maintenance. IGF-1 6 days after the third cycle ended (day 71): ≈ −13 % (0.87 ± 0.08).',
  arms: {
    main: {
      profile: person({ sex: 'male', ageYears: 45, heightCm: 180, weightKg: 85 }),
      schedule: buildSchedule({ days: 75, programs: FMD_PROGS, use: (d) => { const k = d % 30; return d < 65 && k < 5 ? (k === 0 ? 1 : 2) : 0; } }),
    },
  },
  expectations: [{ id: 'igf', label: 'IGF-1 on day 71, 6 d after the third cycle (0.87 ± 0.08)', unit: 'ratio', measure: (c) => c.main.day('igf1', 71) / c.main.initial('igf1'), check: val(0.87, 0.08), source: 'dossier 08 V6' }],
};

// =====================================================================================================================
// Dossier 12 §7 (targets 1-6; ±15 percentage points unless stated)
// =====================================================================================================================

const NONOBESE_F = person({ sex: 'female', ageYears: 30, heightCm: 165, weightKg: 58, bodyFatPct: 26 });
const NONOBESE_M = person({ sex: 'male', ageYears: 26, heightCm: 180, weightKg: 72, bodyFatPct: 15 });

export const D12_1_WEIGLE: Scenario = {
  id: '12-1-weigle-1997-leptin-fast',
  dossier: '12',
  target: '#1',
  title: 'Weigle 1997: leptin in a 3-day fast and 24 h after refeeding, non-obese women',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Weigle et al. 1997 (dossier 12 ref [12]); dossier 12 §7 #1',
  notes: '7 non-obese women (≈ 2.6 % weight loss): a 30-y woman (165 cm, 58 kg, 26 % BF), 72-h FastEvent from t = 0 then one refeeding day at maintenance. Leptin 8.5 → 2.4 ng/mL (−62 ± 25 %); engine −50 to −75 % at 72 h and ≥ 85 % of baseline 24 h after refeeding.',
  // 72-h fast from t = 0 (after the habitual evening meal): the three covered days are water-only (see fasting.ts fastArm)
  arms: { main: { profile: NONOBESE_F, schedule: buildSchedule({ days: 6, programs: [pctProgram('maintenance', 100, neutralMacros('female')), waterOnlyProgram('water')], use: (d) => (d < 3 ? 1 : 0), events: [fastEvent(0, 72, 0)] }) } },
  expectations: [
    { id: 'fall', label: 'leptin change at 72 h (−62 %; engine −50 … −75 %)', unit: '%', measure: (c) => pctChange(c.main, 'leptin', 3), check: range(-75, -50), source: 'dossier 12 #1' },
    { id: 'recover', label: 'leptin 24 h after refeeding relative to baseline (≥ 0.85)', unit: 'ratio', measure: (c) => c.main.after('leptin', 4) / c.main.initial('leptin'), check: above(0.85), source: 'dossier 12 #1' },
  ],
};

const dubuc = (p: PersonProfile): ArmSpec => ({ profile: p, schedule: constantSchedule(7, pctProgram('minus68', 32, neutralMacros(p.body.sex))) });

export const D12_2_DUBUC: Scenario = {
  id: '12-2-dubuc-1998-sex-leptin',
  dossier: '12',
  target: '#2',
  title: 'Dubuc 1998: 7 d at −68 % energy, sex difference in the leptin and insulin response',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Dubuc et al. 1998 (dossier 12 ref [18]); dossier 12 §7 #2',
  notes: 'Normal-weight man (26 y, 180 cm, 72 kg, 15 % BF) and woman (30 y, 165 cm, 58 kg, 26 % BF) at 32 % of maintenance for 7 days. Leptin men −36 %, women −61 % (±15 points); engine: the women\'s fall ≥ 1.4 × the men\'s. Insulin (−74 % men, −31 % women) uses the relative insulin series at day 7.',
  arms: { men: dubuc(NONOBESE_M), women: dubuc(NONOBESE_F) },
  expectations: [
    { id: 'lepM', label: 'men: leptin change (−36 %)', unit: '%', measure: (c) => pctChange(c.arm('men'), 'leptin', 7), check: val(-36, 15), source: 'dossier 12 #2 (±15 points)' },
    { id: 'lepF', label: 'women: leptin change (−61 %)', unit: '%', measure: (c) => pctChange(c.arm('women'), 'leptin', 7), check: val(-61, 15), source: 'dossier 12 #2 (±15 points)' },
    { id: 'ratio', label: "women's leptin fall / men's leptin fall (≥ 1.4)", unit: 'ratio', measure: (c) => pctChange(c.arm('women'), 'leptin', 7) / pctChange(c.arm('men'), 'leptin', 7), check: above(1.4), source: 'dossier 12 #2' },
  ],
};

const KIEL = person({ sex: 'male', ageYears: 26, heightCm: 180, weightKg: 72, bodyFatPct: 15 });

export const D12_3_KIEL: Scenario = {
  id: '12-3-mueller-2015-kiel-semistarvation',
  dossier: '12',
  target: '#3',
  title: 'Müller 2015 (Kiel): 1 wk +50 %, 3 wk at −50 %, 2 wk refeeding in non-obese men',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Müller et al. 2015 (dossier 12 ref [98]); dossier 12 §7 #3',
  notes: '32 non-obese men: a 26-y man (180 cm, 72 kg, 15 % BF), 7 d at 150 % of maintenance, 21 d at 50 %, 14 d refeeding at 100 %. Rows at the end of the restriction (day 28): leptin −35…−55 % (study −44 %), T3 −20…−40 %, testosterone 0…−20 % (all ±15 points of the study); insulin −54 % (Q), weight −6.0 kg (Q, ±1.5), REE −266 kcal/d (Q, ±60).',
  arms: { main: { profile: KIEL, schedule: segmentSchedule([pctProgram('over', 150, neutralMacros('male')), pctProgram('half', 50, neutralMacros('male')), pctProgram('refeed', 100, neutralMacros('male'))], [{ days: 7, program: 0 }, { days: 21, program: 1 }, { days: 14, program: 2 }]) } },
  expectations: [
    { id: 'leptin', label: 'leptin change at the end of restriction (−44 %; engine −35 … −55 %)', unit: '%', measure: (c) => 100 * (c.main.after('leptin', 28) / c.main.after('leptin', 7) - 1), check: range(-55, -35), source: 'dossier 12 #3' },
    { id: 't3', label: 'T3 change (−39 %; engine −20 … −40 %)', unit: '%', measure: (c) => 100 * (c.main.after('t3', 28) / c.main.after('t3', 7) - 1), check: range(-40, -20), source: 'dossier 12 #3' },
    { id: 'testosterone', label: 'testosterone change (−11 %; engine 0 … −20 %)', unit: '%', measure: (c) => 100 * (c.main.after('testosterone', 28) / c.main.after('testosterone', 7) - 1), check: range(-20, 0), source: 'dossier 12 #3' },
    { id: 'weight', label: 'weight lost in the restriction (−6.0 kg)', unit: 'kg', measure: (c) => c.main.after('scaleWeight', 28) - c.main.after('scaleWeight', 7), check: val(-6.0, 1.5), gate: 'Q', source: 'dossier 12 #3' },
    { id: 'ree', label: 'REE change at the end of restriction (−266 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.after('rmr', 28) - c.main.after('rmr', 7), check: val(-266, 60), gate: 'Q', source: 'dossier 12 #3' },
  ],
};

const EBBELING = person({ sex: 'male', ageYears: 27, heightCm: 178, weightKg: 95 });
const ebbArm = (carbPct: number, gi: number): ArmSpec => ({
  profile: EBBELING,
  schedule: segmentSchedule([pctProgram('lose', 72, neutralMacros('male')), pctProgram(`hold${carbPct}`, 100, { protein: { unit: 'pctEnergy', value: 20 }, carbs: { unit: 'pctEnergy', value: carbPct }, fat: { unit: 'remainder' } }, { food: { glycaemicIndex: gi } }, 'current')], [{ days: 98, program: 0 }, { days: 28, program: 1 }]),
});

export const D12_4_EBBELING: Scenario = {
  id: '12-4-ebbeling-2012-diet-composition',
  dossier: '12',
  target: '#4',
  title: 'Ebbeling 2012: leptin and T3 after 10-15 % weight loss on low-fat, low-glycaemic-index or very-low-carbohydrate maintenance',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Ebbeling et al. 2012 JAMA (dossier 12 ref [94]); dossier 12 §7 #4',
  notes: '21 young adults: a 27-y man (178 cm, 95 kg) losing weight for 14 weeks at 72 % of maintenance (≈ 12 %), then a 4-week isocaloric period (100 % of the current maintenance, protein 20 %E) as low-fat (carbohydrate 60 %E, GI 65), low-GI (45 %E, GI 40) or very-low-carbohydrate (10 %E). ' +
    'Study leptin 14.9 / 12.7 / 11.2 ng/mL and T3 121 / 123 / 108 ng/dL (pre-loss 29.2 and 137). Engine: the ordering (low-fat > low-GI > very-low-carbohydrate) with ≥ 20 % lower leptin and ≥ 10 % lower T3 on very-low-carbohydrate than low-fat.',
  arms: { lowFat: ebbArm(60, 65), lowGi: ebbArm(45, 40), vlc: ebbArm(10, 55) },
  expectations: [
    { id: 'leptin', label: 'leptin, very-low-carbohydrate / low-fat (≤ 0.8)', unit: 'ratio', measure: (c) => c.arm('vlc').after('leptin', 126) / c.arm('lowFat').after('leptin', 126), check: below(0.8), source: 'dossier 12 #4 (≥ 20 % lower)' },
    { id: 't3', label: 'T3, very-low-carbohydrate / low-fat (≤ 0.9)', unit: 'ratio', measure: (c) => c.arm('vlc').after('t3', 126) / c.arm('lowFat').after('t3', 126), check: below(0.9), source: 'dossier 12 #4 (≥ 10 % lower)' },
    { id: 'order', label: 'leptin ordering low-fat ≥ low-GI ≥ very-low-carbohydrate (low-fat − vlc > 0)', unit: 'rel', measure: (c) => c.arm('lowFat').after('leptin', 126) - c.arm('vlc').after('leptin', 126), check: above(0), source: 'dossier 12 #4 (ordering)' },
  ],
};

const MILITARY = person({ sex: 'male', ageYears: 24, heightCm: 178, weightKg: 78, bodyFatPct: 16.8 });
const milT = tdee0Of(MILITARY);

export const D12_5_MILITARY: Scenario = {
  id: '12-5-friedl-2000-military-semistarvation',
  dossier: '12',
  target: '#5',
  title: 'Friedl 2000 / Henning 2014: 8 weeks at a ≈ 1 100 kcal/d deficit, then recovery',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Friedl et al. 2000, Henning et al. 2014 (dossier 12 refs [116,117]); dossier 12 §7 #5',
  notes: 'Young men, body fat 16.8 % → ≈ 7.7 %: a 24-y man (178 cm, 78 kg, 16.8 % BF), 56 days at a deficit of 1 100 kcal/d held against the current maintenance (the study\'s 1 000-1 200 kcal/d is the realised deficit; fixture fix 2026-09-30 — a fixed intake of baseline − 1 100 decayed to a −690 kcal/d deficit by week 8), sleep deprivation not modelled (no duration in the dossier), then 42 days at maintenance. Engine: testosterone −55…−80 %, IGF-1 −30…−50 % at day 56; testosterone recovery > 90 % of baseline by 6 weeks.',
  arms: { main: { profile: MILITARY, schedule: segmentSchedule([pctProgram('deficit', (100 * (milT - 1100)) / milT, neutralMacros('male'), {}, 'current'), pctProgram('recover', 100, neutralMacros('male'), {}, 'current')], [{ days: 56, program: 0 }, { days: 42, program: 1 }]) } },
  expectations: [
    { id: 't', label: 'testosterone change at day 56 (−70 %; engine −55 … −80 %)', unit: '%', measure: (c) => pctChange(c.main, 'testosterone', 56), check: range(-80, -55), source: 'dossier 12 #5' },
    { id: 'igf', label: 'IGF-1 change at day 56 (−39 … −50 %; engine −30 … −50 %)', unit: '%', measure: (c) => pctChange(c.main, 'igf1', 56), check: range(-50, -30), source: 'dossier 12 #5' },
    { id: 'recovery', label: 'testosterone 6 weeks into recovery relative to baseline (> 0.9)', unit: 'ratio', measure: (c) => c.main.after('testosterone', 98) / c.main.initial('testosterone'), check: above(0.9), source: 'dossier 12 #5' },
    { id: 'fat', label: 'body fat at day 56 (≈ 7.7 %)', unit: '%', measure: (c) => c.main.after('bodyFatPct', 56), check: val(7.7, 3), gate: 'Q', source: 'dossier 12 #5', note: 'Band ±3 points assumed (the deficit is a stand-in for the field conditions).' },
  ],
};

const BODYBUILDER = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 85, bodyFatPct: 13.8, trainingYears: 8, trainingHistory: 'gt3y', sessionsPerWeek: 5, liftingCardioMix: 0.2 });
const prepKcal = Array.from({ length: 8 }, (_, i) => Math.round(3860 - ((3860 - 1724) * (i + 0.5)) / 8));
const prepSchedule = buildSchedule({
  days: 240,
  programs: prepKcal.map((k, i) => kcalProgram(`prep${i}`, k, neutralMacros('male'), { exercise: [rtSession(17, { volume: 'high' })] })),
  use: (d) => Math.min(7, Math.floor(d / 30)),
});

export const D12_6_CONTEST_PREP: Scenario = {
  id: '12-6-pardue-2017-contest-prep',
  dossier: '12',
  target: '#6',
  title: 'Pardue 2017 / Rossow 2013: 8 months of contest preparation, intake 3 860 → 1 724 kcal/d',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Pardue et al. 2017, Rossow et al. 2013 (dossier 12 refs [119,118]); dossier 12 §7 #6',
  notes:
    'Drug-free male bodybuilder: a 30-y man (178 cm, 85 kg, 13.8 % BF, 8 y of training); monthly steps of energy from 3 860 down to 1 724 kcal/d (mid-month values of a linear decline) with a daily high-volume RT session, 240 days. ' +
    'Engine: testosterone −60…−80 %; T3 no more than −45 % (the dossier\'s current fit gives −53 %, so this row is expected to be tight); hunger index ≥ 90 at the end. Diet strain ≥ 60 is a state (`dietFatigue`) that is not a recorded series (CONTRACT REQUEST); body fat 13.8 → 5.1 % is Q (±3 points).',
  arms: { main: { profile: BODYBUILDER, schedule: prepSchedule } },
  expectations: [
    { id: 't', label: 'testosterone change at the end of preparation (−60 … −80 %)', unit: '%', measure: (c) => pctChange(c.main, 'testosterone', 240), check: range(-80, -60), source: 'dossier 12 #6' },
    { id: 't3', label: 'T3 change at the end of preparation (≥ −45 %; observed 123 → 40 ng/dL)', unit: '%', measure: (c) => pctChange(c.main, 't3', 240), check: range(-45, 0), source: 'dossier 12 #6 (current fit −53 %)' },
    { id: 'hunger', label: 'hunger pressure index at the end (≥ 90)', unit: 'index', measure: (c) => c.main.after('hunger', 240), check: above(90), source: 'dossier 12 #6' },
    { id: 'fat', label: 'body fat at the end (5.1 %)', unit: '%', measure: (c) => c.main.after('bodyFatPct', 240), check: val(5.1, 3), gate: 'Q', source: 'dossier 12 #6' },
  ],
};

// =====================================================================================================================
// Dossier 14 §7 (I-level rows)
// =====================================================================================================================

export const D14_V3_CALERIE2_WAIST: Scenario = {
  id: '14-V3-calerie2-waist-per-fat',
  dossier: '14',
  target: 'V3',
  title: 'CALERIE-2 regional: waist change per kg of fat lost (ΔWC −6.2 cm for ΔFM −5.4 kg)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'CALERIE-2 (dossier 14 ref [49]); dossier 14 §7 V3',
  notes: 'The CALERIE-2 arm of 01-7.4 (38-y woman, 68.5 kg, ≈ 12 % CR). Published dWC −6.1 cm (women) at dFM −5.4 kg with ψ = 0.83: 1.13 cm per kg of fat; tolerance ±1.5 cm at dFM −5.4 kg ⇒ ±0.28 cm/kg. VAT share and trunk-fat rows need regional depot series (not recorded).',
  arms: CALERIE2.arms,
  expectations: [{ id: 'wcPerFm', label: 'waist change per kg of fat mass lost, 2 y (1.13 cm/kg)', unit: 'cm/kg', measure: (c) => c.main.delta('waist', 728) / c.main.delta('fatMass', 728), check: val(1.13, 0.28), source: 'dossier 14 V3 (±1.5 cm at ΔFM −5.4 kg)' }],
};

const ROSS = person({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 100, bodyFatPct: 33 });

export const D14_V4_ROSS: Scenario = {
  id: '14-V4-ross-1996-vat',
  dossier: '14',
  target: 'V4',
  title: 'Ross 1996: visceral fat after ≈ 10 % weight loss in obese men (VAT −35 %)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Ross et al. 1996 (dossier 14 ref [51]); dossier 14 §7 V4',
  notes: 'A 40-y man (178 cm, 100 kg, 33 % BF) at 75 % of maintenance; VAT is read on the day the scale reaches −10 %. Dossier model: ΔFM −7.5…−8.5 kg gives VAT −28…−32 % (±8 points around −30). The trunk-SAT and leg-fat rows need regional series.',
  arms: { main: { profile: ROSS, schedule: constantSchedule(240, pctProgram('lose', 75, neutralMacros('male'))) } },
  expectations: [{ id: 'vat', label: 'VAT change at −10 % body weight (−30 %)', unit: '%', measure: (c) => { const d = firstDayAtLoss(c.main, 10); return Number.isNaN(d) ? Number.NaN : 100 * (c.main.day('visceralFat', d) / c.main.initial('visceralFat') - 1); }, check: val(-30, 8), source: 'dossier 14 V4 (±8 points)' }],
};

export const D14_V5_VAT_SLOPE: Scenario = {
  id: '14-V5-hallgreen-hall-vat-slope',
  dossier: '14',
  target: 'V5',
  title: 'Hallgreen & Hall 2008: dVAT/VAT = 1.3 × dFM/FM (log-log slope 1.29-1.34)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Hallgreen & Hall 2008 (dossier 14 ref [48]); dossier 14 §7 V5',
  notes: 'The arm of 14-V4 over a 240-day loss: the least-squares slope of ln(VAT) on ln(FM) over the daily series; accepted k in 1.2-1.4 (model 1.29-1.34).',
  arms: { main: { profile: ROSS, schedule: constantSchedule(240, pctProgram('lose', 75, neutralMacros('male'))) } },
  expectations: [{ id: 'slope', label: 'log-log slope of VAT on FM over the loss (1.29-1.34)', unit: 'k', measure: (c) => { const v = c.main.daily('visceralFat'); const f = c.main.daily('fatMass'); if (!v || !f) return Number.NaN; let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = v.length; for (let i = 0; i < n; i++) { const x = Math.log(f[i]!); const y = Math.log(v[i]!); sx += x; sy += y; sxx += x * x; sxy += x * y; } return (n * sxy - sx * sy) / (n * sxx - sx * sx); }, check: range(1.2, 1.4), source: 'dossier 14 V5 (k in 1.2-1.4)' }],
};

export const D14_V9_VAT_BASELINE: Scenario = {
  id: '14-V9-vat-baseline',
  dossier: '14',
  target: 'V9',
  title: 'MRI/CT visceral fat: man (BMI 26, 42 y) 2.5 kg, woman (BMI 27, 48 y) 1.6 kg',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'MRI/CT VAT studies (dossier 14 refs [42-44]); dossier 14 §7 V9',
  notes: 'A 42-y man (178 cm, 82.4 kg = BMI 26) and a 48-y woman (165 cm, 73.5 kg = BMI 27) with no waist or fat input: the engine\'s day-0 visceral fat against 2.5 and 1.6 kg (±30 %).',
  arms: {
    man: { profile: person({ sex: 'male', ageYears: 42, heightCm: 178, weightKg: 82.4 }), schedule: constantSchedule(2, pctProgram('maintenance', 100, neutralMacros('male'))) },
    woman: { profile: person({ sex: 'female', ageYears: 48, heightCm: 165, weightKg: 73.5 }), schedule: constantSchedule(2, pctProgram('maintenance', 100, neutralMacros('female'))) },
  },
  expectations: [
    { id: 'man', label: 'man: visceral fat at t = 0 (2.5 kg)', unit: 'kg', measure: (c) => c.arm('man').initial('visceralFat'), check: rel(2.5, 0.3), source: 'dossier 14 V9 (±30 %)' },
    { id: 'woman', label: 'woman: visceral fat at t = 0 (1.6 kg)', unit: 'kg', measure: (c) => c.arm('woman').initial('visceralFat'), check: rel(1.6, 0.3), source: 'dossier 14 V9 (±30 %)' },
  ],
};

export const D14_V10_MENOPAUSE_WAIST: Scenario = {
  id: '14-V10-ambikairajah-waist-drift',
  dossier: '14',
  target: 'V10',
  title: 'Ambikairajah 2019: waist at fixed BMI, woman 45 → 57 y (+2.0 cm)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Ambikairajah et al. 2019 (dossier 14 ref [47]); dossier 14 §7 V10',
  notes: 'A 45-y woman (165 cm, 73.5 kg, BMI 27) at 100 % of maintenance for 12 years (4 383 days, weight-stable): the waist gain from age effects alone, +2.0 ± 1 cm (dossier model +2.0). Menopause status follows the profile default (pre) and the body-module age handling.',
  arms: { main: { profile: person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 73.5 }), schedule: constantSchedule(4383, pctProgram('maintenance', 100, neutralMacros('female'))) } },
  expectations: [{ id: 'wc', label: 'waist change over 12 years at maintenance (+2.0 cm)', unit: 'cm', measure: (c) => c.main.delta('waist', 4383), check: val(2.0, 1.0), source: 'dossier 14 V10 (±1 cm)' }],
};

const HAN_W = person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 90, bodyFatPct: 45 });
const HAN_M = person({ sex: 'male', ageYears: 45, heightCm: 178, weightKg: 100, bodyFatPct: 33 });
const hanArm = (p: PersonProfile, pct: number): ArmSpec => ({ profile: p, schedule: constantSchedule(182, pctProgram('diet', pct, neutralMacros(p.body.sex))) });

export const D14_V11_HAN: Scenario = {
  id: '14-V11-han-1997-waist-vs-weight-loss',
  dossier: '14',
  target: 'V11',
  title: 'Han 1997: waist reduction per 1 % weight loss (0.73 cm per 1 %)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Han et al. 1997 (dossier 14 ref [62]); dossier 14 §7 V11',
  notes: 'A 90-kg, 165-cm, 45 % BF woman (model 0.67-0.68 cm per 1 %) and a 100-kg, 33 % BF man (0.79) losing weight for 26 weeks at 80 % of maintenance; waist change / % weight change at the end, ±20 %.',
  arms: { woman: hanArm(HAN_W, 80), man: hanArm(HAN_M, 80) },
  expectations: [
    { id: 'woman', label: 'woman: waist reduction per 1 % weight loss (0.675 cm)', unit: 'cm/%', measure: (c) => c.arm('woman').delta('waist', 182) / c.arm('woman').pct('scaleWeight', 182), check: rel(0.675, 0.2), source: 'dossier 14 V11 (±20 %)' },
    { id: 'man', label: 'man: waist reduction per 1 % weight loss (0.79 cm)', unit: 'cm/%', measure: (c) => c.arm('man').delta('waist', 182) / c.arm('man').pct('scaleWeight', 182), check: rel(0.79, 0.2), source: 'dossier 14 V11 (±20 %)' },
  ],
};

// =====================================================================================================================
// Dossier 15 §7 (I-level rows)
// =====================================================================================================================

const fibreArm = (g: number): ArmSpec => ({ profile: MAN, schedule: constantSchedule(28, kcalProgram(`fibre${g}`, 2550, { protein: { unit: 'pctEnergy', value: 15.6 }, carbs: { unit: 'pctEnergy', value: 45.4 }, fat: { unit: 'remainder' }, fibre: { unit: 'g', value: g } })) });

export const D15_V1_KARL: Scenario = {
  id: '15-V1-karl-2017-fibre-me',
  dossier: '15',
  target: 'V1',
  title: 'Karl 2017: fibre 21 → 40 g/d at ≈ 2 550 kcal lowers metabolisable energy by 30-90 kcal/d',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Karl et al. 2017 (dossier 15 ref [2]); dossier 15 §7 V1',
  notes: 'MAN (§9.3) at 2 550 kcal/d with fibre 21 vs 40 g/d for 28 days, other macros at the habitual split. ME effect = mean energy balance over days 14-28 of the high-fibre arm minus the low-fibre arm (−30 to −90 kcal/d, the model dME with c_f = 2; RMR +43 optional). Faecal energy and stool weight are not series.',
  arms: { low: fibreArm(21), high: fibreArm(40) },
  expectations: [{ id: 'dme', label: 'metabolisable-energy change with +19 g fibre (−30 … −90 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('high').mean('energyBalance', 13, 28) - c.arm('low').mean('energyBalance', 13, 28), check: range(-90, -30), source: 'dossier 15 V1' }],
};

/**
 * Finisher fixture fix 2026-09-30: the almonds bring their own fibre (0.11 g/g, intake.nutFibreGPerG) on top of the diet's
 * other fibre (8 g/1000 kcal in both arms) — at equal total fibre the almond arm lost 9 g of other fibre and its fibre
 * penalty — and the row compares absorbed (metabolisable) energy, energy balance + TDEE, which is what Novotny measured;
 * the energy-balance difference also carried the TEF response to the lower ME.
 */
const NUT_FIBRE_G_PER_G = 0.11;
const almondArm = (nuts: number): ArmSpec => {
  const fibreG = (8 * tdee0Of(MAN)) / 1000 + NUT_FIBRE_G_PER_G * nuts;
  return { profile: MAN, schedule: constantSchedule(14, pctProgram(`nuts${nuts}`, 100, { ...neutralMacros('male'), fibre: { unit: 'g', value: fibreG } }, nuts > 0 ? { food: { nutsG: nuts, nutForm: 'wholeRaw' } } : {})) };
};
const absorbedKcal = (v: ArmView, from: number, to: number): number => v.mean('energyBalance', from, to) + v.mean('tdee', from, to);

export const D15_V3_NOVOTNY: Scenario = {
  id: '15-V3-novotny-2012-almonds',
  dossier: '15',
  target: 'V3',
  title: 'Novotny 2012: 84 g/d whole raw almonds, Atwater over-estimates measured ME (−120 to −140 kcal/d)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Novotny et al. 2012 (dossier 15 ref [33]); dossier 15 §7 V3',
  notes: 'MAN (§9.3), habitual intake with 84 g of whole raw almonds flagged as part of the diet vs none (same energy and macros; the almonds\' 9 g of fibre added to the diet\'s other fibre); the ME difference is the mean absorbed-energy (energy balance + TDEE) difference over days 3-14.',
  arms: { none: almondArm(0), almonds: almondArm(84) },
  expectations: [{ id: 'dmeNut', label: 'metabolisable-energy change from 84 g whole raw almonds (−120 … −140 kcal/d)', unit: 'kcal/d', measure: (c) => absorbedKcal(c.arm('almonds'), 3, 14) - absorbedKcal(c.arm('none'), 3, 14), check: range(-140, -120), source: 'dossier 15 V3' }],
};

const sodiumArm = (naMmol: number): ArmSpec => ({ profile: { ...MAN, habits: { ...MAN.habits, habitualSodiumG: 50 * 0.02299 } }, schedule: constantSchedule(14, pctProgram(`na${naMmol}`, 100, neutralMacros('male'), { hydration: { sodiumG: naMmol * 0.02299 } })) });

export const D15_V6_SODIUM: Scenario = {
  id: '15-V6-visser-sodium-weight',
  dossier: '15',
  target: 'V6',
  title: 'Visser 2009 / van den Bosch 2021 / Krikken 2012: 7 d at 50 vs 200 mmol Na/d (+1.4 kg)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Visser 2009, van den Bosch 2021, Krikken 2012 (dossier 15 refs [162-164]); dossier 15 §7 V6',
  notes: 'MAN (§9.3) with a habitual sodium intake of 50 mmol/d held for 7 days (burn-in habit 50 mmol/d), then 7 days at 200 mmol/d in the second arm: weight difference on day 7 between the 200 and 50 mmol/d arms +0.5 to +1.6 kg (model +0.9).',
  arms: { low: sodiumArm(50), high: sodiumArm(200) },
  expectations: [{ id: 'dBw', label: 'weight difference after 7 d, 200 minus 50 mmol Na/d (+0.5 … +1.6 kg)', unit: 'kg', measure: (c) => c.arm('high').after('scaleWeight', 7) - c.arm('low').after('scaleWeight', 7), check: range(0.5, 1.6), source: 'dossier 15 V6' }],
};

export const D15_V8_YANG_WATER: Scenario = {
  id: '15-V8-yang-water-fraction',
  dossier: '15',
  target: 'V8',
  title: 'Yang & Van Itallie 1976: water is 50-70 % of the weight lost on an 800-kcal ketogenic diet',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FASTING,
  citation: 'Yang & Van Itallie 1976 (dossier 15 ref [56]); dossier 15 §7 V8',
  notes: 'The ketogenic arm of 13-V2 (obese woman, 800 kcal/d, 10 d). Water share of the loss = (weight lost − fat lost − protein-tissue lost)/weight lost, using the lean-tissue series for protein; target 50-70 % (observed 61 %).',
  arms: { main: D13_V2_YANG.arms['ketogenic'] as ArmSpec },
  expectations: [{ id: 'waterShare', label: 'water share of the weight lost, ketogenic arm (50-70 %)', unit: '%', measure: (c) => { const w = -scaleDelta(c.main, 10); const f = -c.main.delta('fatMass', 10); const l = -c.main.delta('leanTissue', 10); return (100 * (w - f - l)) / w; }, check: range(50, 70), source: 'dossier 15 V8' }],
};

const caffeineArm = (mgList: readonly number[]): ArmSpec => ({
  profile: { ...MAN, habits: { ...MAN.habits, habitualCaffeineMg: 0 } },
  schedule: constantSchedule(3, pctProgram(`caffeine${mgList.length}`, 100, neutralMacros('male'), { substances: { caffeine: mgList.map((mg, i) => ({ clockH: 8 + 2 * i, mg })) } })),
});

export const D15_V12_CAFFEINE: Scenario = {
  id: '15-V12-dulloo-caffeine-ee',
  dossier: '15',
  target: 'V12',
  title: 'Dulloo 1989 / Hursel 2011: 6 × 100 mg caffeine over 12 h raises 24-h EE in a caffeine-naive person by 50-170 kcal',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Dulloo et al. 1989, Hursel et al. 2011 (dossier 15 refs [118,121]); dossier 15 §7 V12',
  notes: 'MAN (§9.3) with habitual caffeine 0 mg/d: six 100-mg doses at 08:00, 10:00 … 18:00 vs none; expenditure difference on day 1 (index 0..1 mean); dossier acceptance 50-170 kcal (default sits at the low end on purpose, +60).',
  arms: { none: caffeineArm([]), doses: caffeineArm([100, 100, 100, 100, 100, 100]) },
  expectations: [{ id: 'dEE', label: '24-h EE change from 600 mg caffeine (+50 … +170 kcal)', unit: 'kcal', measure: (c) => c.arm('doses').day('tdee', 0) - c.arm('none').day('tdee', 0), check: range(50, 170), source: 'dossier 15 V12' }],
};

/**
 * Suter's ethanol was ADDED to an unchanged diet (finisher fixture fix 2026-09-30): both arms eat the same protein,
 * carbohydrate, fat and fibre grams (the habitual split of TDEE0); the alcohol arm's energy is TDEE0 + 7 kcal/g × ethanol.
 * With %E macros the ethanol arm had eaten +26 g protein, +76 g carbohydrate and −47 g fat.
 */
const SUTER_T = tdee0Of(MAN);
const suterFoodMacros = {
  ...gramMacros(Math.round((0.156 * SUTER_T) / 4), Math.round((0.454 * SUTER_T) / 4)),
  fibre: { unit: 'g' as const, value: Math.round((8 * SUTER_T) / 100) / 10 },
};
const alcoholArm = (drinks: number): ArmSpec => ({
  profile: MAN,
  schedule: constantSchedule(6, kcalProgram(`alc${drinks}`, Math.round(SUTER_T + drinks * 14 * 7), suterFoodMacros, drinks > 0 ? { substances: { alcohol: [{ clockH: 19, drinks, withMeal: true }] } } : {})),
});

export const D15_V10_SUTER: Scenario = {
  id: '15-V10-suter-1992-alcohol',
  dossier: '15',
  target: 'V10',
  title: 'Suter 1992: 96 g/d ethanol added (25 % of energy) lowers fat oxidation by 400-480 kcal/d and raises EE by 4-7 %',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Suter et al. 1992 (dossier 15 ref [98]); dossier 15 §7 V10',
  notes: 'MAN (§9.3) at baseline maintenance + 96 g ethanol (6.86 drinks of 14 g, 672 kcal) vs baseline maintenance, the same food grams in both arms, evening drinks with the meal, 6 days, day 5 compared. Row: fat oxidation change −400…−480 kcal/d (fat oxidation × 9.44 kcal/g) and EE +4-7 %.',
  arms: { none: alcoholArm(0), alcohol: alcoholArm(96 / 14) },
  expectations: [
    { id: 'fatOx', label: 'fat oxidation change with 96 g ethanol (−400 … −480 kcal/d)', unit: 'kcal/d', measure: (c) => 9.44 * (c.arm('alcohol').day('fatOxidation', 4) - c.arm('none').day('fatOxidation', 4)), check: range(-480, -400), source: 'dossier 15 V10' },
    { id: 'ee', label: '24-h EE change with 96 g ethanol (+4 … +7 %)', unit: '%', measure: (c) => 100 * (c.arm('alcohol').day('tdee', 4) / c.arm('none').day('tdee', 4) - 1), check: range(4, 7), source: 'dossier 15 V10' },
  ],
};

const creatineArm = (): ArmSpec => ({ profile: MAN, schedule: buildSchedule({ days: 35, programs: [pctProgram('loading', 100, neutralMacros('male'), { substances: { creatineG: 25, creatineLoading: true } }), pctProgram('maintenance', 100, neutralMacros('male'), { substances: { creatineG: 5 } })], use: (d) => (d < 7 ? 0 : 1) }) });
const noCreatine = (): ArmSpec => ({ profile: MAN, schedule: constantSchedule(35, pctProgram('none', 100, neutralMacros('male'))) });

export const D15_V15_POWERS: Scenario = {
  id: '15-V15-powers-2003-creatine',
  dossier: '15',
  target: 'V15',
  title: 'Powers 2003: creatine 25 g/d × 7 d then 5 g/d × 21 d, body mass and water',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Powers et al. 2003 (dossier 15 ref [137]); dossier 15 §7 V15',
  notes: 'MAN (§9.3): creatine loading 25 g/d for 7 days then 5 g/d for 21 days vs no creatine; W_Cr = the scale-weight difference between the arms: 0.5-1.0 kg at day 7 and 0.7-1.2 kg at day 28.',
  arms: { creatine: creatineArm(), none: noCreatine() },
  expectations: [
    { id: 'd7', label: 'creatine body-mass difference at day 7 (0.5-1.0 kg)', unit: 'kg', measure: (c) => c.arm('creatine').after('scaleWeight', 7) - c.arm('none').after('scaleWeight', 7), check: range(0.5, 1.0), source: 'dossier 15 V15' },
    { id: 'd28', label: 'creatine body-mass difference at day 28 (0.7-1.2 kg)', unit: 'kg', measure: (c) => c.arm('creatine').after('scaleWeight', 28) - c.arm('none').after('scaleWeight', 28), check: range(0.7, 1.2), source: 'dossier 15 V15' },
  ],
};

// =====================================================================================================================
// Dossier 19 §7 (I-level rows)
// =====================================================================================================================

export const D19_V5_CALERIE2_BONE: Scenario = {
  id: '19-V5-calerie2-hip-bmd',
  dossier: '19',
  target: 'V5',
  title: 'CALERIE-2 bone: hip BMD −1.7 % after ≈ 10 % weight loss over 2 years',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'CALERIE-2 bone study (dossier 19 ref [5]); dossier 19 §7 V5',
  notes: 'The CALERIE-2 arm of 01-7.4. Published hip −0.017 g/cm² (≈ −1.7 %); the dossier engine expectation is −1.5 to −2.0 % when the weight loss is ≈ 10 %; tolerance ±0.7 points around −1.75. The engine\'s weight loss in this arm differs from 10 % (asserted in 01-7.4).',
  arms: CALERIE2.arms,
  expectations: [{ id: 'hip', label: 'hip BMD change after 2 y (−1.75 %)', unit: '%', measure: (c) => c.main.after('hipBmdChange', 728), check: val(-1.75, 0.7), source: 'dossier 19 V5 (±0.7 points)' }],
};

const VILLA06 = person({ sex: 'male', ageYears: 57, heightCm: 172, weightKg: 80, extra: { sexUnspecified: true } }); // BMI 27
const villaT06 = tdee0Of(VILLA06);
const villa06Arm = (exercise: boolean): ArmSpec => ({
  profile: VILLA06,
  schedule: exercise
    ? trainingSchedule({ days: 365, sessionsPerWeek: 5, session: [cardioSession('other', 17, 60, { met: 6 })], energy: { kind: 'kcal', kcal: Math.round(villaT06 - 40) }, macros: neutralMacros('male') })
    : constantSchedule(365, pctProgram('cr', 78, neutralMacros('male'))),
});

export const D19_V6_VILLAREAL_2006: Scenario = {
  id: '19-V6-villareal-2006-bone',
  dossier: '19',
  target: 'V6',
  title: 'Villareal 2006: 1 year of CR (−10.7 %) vs exercise-induced deficit (−8.4 %), hip BMD',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Villareal et al. 2006 (dossier 19 ref [3]); dossier 19 §7 V6',
  notes: 'n = 48, age 57, BMI 27: a sex-unspecified 57-y adult (172 cm, 80 kg). CR arm: 78 % of maintenance for 365 d; exercise arm: 5 × 60-min moderate sessions/wk (6 MET) at baseline maintenance − 40 kcal/d. Hip BMD: CR −2 to −2.5 %, exercise-deficit ≈ −0.5 % (±1 point).',
  arms: { cr: villa06Arm(false), exercise: villa06Arm(true) },
  expectations: [
    { id: 'cr', label: 'CR arm: hip BMD change after 1 y (−2.2 %)', unit: '%', measure: (c) => c.arm('cr').after('hipBmdChange', 365), check: val(-2.25, 1.0), source: 'dossier 19 V6 (±1 point)' },
    { id: 'ex', label: 'exercise-deficit arm: hip BMD change after 1 y (≈ −0.5 %)', unit: '%', measure: (c) => c.arm('exercise').after('hipBmdChange', 365), check: val(-0.5, 1.0), source: 'dossier 19 V6 (±1 point)' },
  ],
};

const LCHF_WALKER = person({ sex: 'male', ageYears: 27, heightCm: 178, weightKg: 68, bodyFatPct: 8, trainingYears: 6, trainingHistory: 'gt3y' });
const burke17Arm = (lchf: boolean): ArmSpec => ({
  profile: LCHF_WALKER,
  schedule: trainingSchedule({ days: 21, sessionsPerWeek: 6, session: [cardioSession('walk', 7, 120, { pctVo2max: 0.65 })], energy: AT_CURRENT, macros: lchf ? pctMacros(20, 4) : { protein: { unit: 'pctEnergy', value: 15 }, carbs: { unit: 'pctEnergy', value: 65 }, fat: { unit: 'remainder' } } }),
});
const AT_CURRENT = { kind: 'pctMaintenance', pct: 100, reference: 'current' } as const;

export const D19_V2_BURKE_2017: Scenario = {
  id: '19-V2-burke-2017-lchf-vs-hcho',
  dossier: '19',
  target: 'V2',
  title: 'Burke 2017: 3 weeks of intensified training on LCHF vs HCHO (iso-energetic), performance gap ≈ 8 points',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Burke et al. 2017 (dossier 19 ref [49]); dossier 19 §7 V2',
  notes: 'Race walkers: a 27-y lean man (178 cm, 68 kg, 8 % BF, trained 6 y), 21 days of 6 × 120-min walks/week at 100 % of the current maintenance with LCHF (20 % protein, 4 % carbohydrate) vs HCHO (15 % protein, 65 % carbohydrate). Published 10-km time: HCHO 6.6 % faster, LCHF 1.6 % slower ⇒ the endurance-capacity gap HCHO − LCHF ≈ 8 points (±3).',
  arms: { lchf: burke17Arm(true), hcho: burke17Arm(false) },
  expectations: [{ id: 'gap', label: 'endurance-capacity gap, HCHO − LCHF (8 ± 3 points)', unit: '% points', measure: (c) => c.arm('hcho').after('enduranceCapacity', 21) - c.arm('lchf').after('enduranceCapacity', 21), check: val(8, 3), source: 'dossier 19 V2 (±3 points)' }],
};

const V9_PERSON = person({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 78, bodyFatPct: 18, trainingYears: 1, trainingHistory: 'lt1y' });
const v9T = tdee0Of(V9_PERSON);
const v9Arm = (energy: 'current' | 'deficit'): ArmSpec => ({
  profile: V9_PERSON,
  schedule: trainingSchedule({ days: 84, sessionsPerWeek: 3, session: [rtSession(17, { volume: 'moderate' })], energy: energy === 'current' ? AT_CURRENT : { kind: 'kcal', kcal: Math.round(v9T - 500) }, macros: proteinPerKgMacros(1.8, 45) }),
});

export const D19_V9_STRENGTH_DEFICIT: Scenario = {
  id: '19-V9-murphy-koehler-strength-in-deficit',
  dossier: '19',
  target: 'V9',
  title: 'Murphy & Koehler 2022 / Longland 2016: strength gain is preserved in a ≈ 500 kcal/d deficit',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Murphy & Koehler 2022, Longland 2016 (dossier 19 refs [27,34]); dossier 19 §7 V9',
  notes: 'A 25-y man (78 kg, 1 y of training), 3 moderate RT sessions/wk for 12 weeks at protein 1.8 g/kg: energy balance (100 % of the current maintenance) vs baseline maintenance − 500 kcal/d. Published: strength gain preserved (ES 0.84 vs 0.81), lean-mass gain ≈ 0; M_EA = 1.0 while EA_c ≥ 30 ⇒ the strength index differs by ≤ 5 % between the arms.',
  arms: { balance: v9Arm('current'), deficit: v9Arm('deficit') },
  expectations: [{ id: 'strength', label: 'strength index, deficit vs balance at 12 wk (|difference| ≤ 5 %)', unit: '%', measure: (c) => 100 * (c.arm('deficit').after('strength', 84) / c.arm('balance').after('strength', 84) - 1), check: range(-5, 5), source: 'dossier 19 V9 (±5 %)' }],
};

const NINDL = person({ sex: 'male', ageYears: 24, heightCm: 178, weightKg: 78, bodyFatPct: 14.7, sessionsPerWeek: 5, liftingCardioMix: 0.5 });
const nindlT = tdee0Of(NINDL);

export const D19_V10_NINDL: Scenario = {
  id: '19-V10-nindl-2007-military',
  dossier: '19',
  target: 'V10',
  title: 'Nindl 2007: 8 weeks at ≈ −1 000 kcal/d in lean soldiers (strength −20 %)',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Nindl et al. 2007 (dossier 19 ref [30]); dossier 19 §7 V10',
  notes: '50 lean soldiers: a 24-y man (178 cm, 78 kg, 14.7 % BF), 56 days at baseline maintenance − 1 000 kcal/d with the habitual sessions (5/wk) continuing on top. Published: BM −13 %, FFM −6 %, strength −20 % (±7 points; M_EA ≈ 0.80-0.90 at 8 wk). Body-mass and FFM rows are Q.',
  arms: { main: { profile: NINDL, schedule: trainingSchedule({ days: 56, sessionsPerWeek: 5, session: [cardioSession('other', 17, 45, { met: 6 })], energy: { kind: 'kcal', kcal: Math.round(nindlT - 1000) }, macros: neutralMacros('male') }) } },
  expectations: [
    { id: 'strength', label: 'strength change at 8 weeks (−20 %)', unit: '%', measure: (c) => c.main.after('strength', 56) - 100, check: val(-20, 7), source: 'dossier 19 V10 (±7 points)' },
    { id: 'bm', label: 'body-mass change (−13 %)', unit: '%', measure: (c) => c.main.pct('scaleWeight', 56), check: val(-13, 4), gate: 'Q', source: 'dossier 19 V10' },
    { id: 'ffm', label: 'lean change (−6 %)', unit: '%', measure: (c) => c.main.pct('leanMass', 56), check: val(-6, 3), gate: 'Q', source: 'dossier 19 V10' },
  ],
};

const ea = (deficitPct: number): ArmSpec => ({
  profile: person({ sex: 'female', ageYears: 25, heightCm: 165, weightKg: 58, bodyFatPct: 22, sessionsPerWeek: 4, liftingCardioMix: 1 }),
  // the study's groups are its realised mean deficits, so the deficit is held relative to the current maintenance
  // (fixture fix 2026-09-30: against the baseline, the −22 % arm's realised deficit decayed to −14 % by week 12)
  schedule: trainingSchedule({ days: 84, sessionsPerWeek: 4, session: [cardioSession('run', 7, 45, { pctVo2max: 0.7 })], energy: { kind: 'pctMaintenance', pct: 100 - deficitPct, reference: 'current' }, macros: neutralMacros('female') }),
});

export const D19_V8_WILLIAMS: Scenario = {
  id: '19-V8-williams-2015-lpd',
  dossier: '19',
  target: 'V8',
  title: 'Williams 2015: menstrual disturbance risk over 3 cycles at energy deficits 0 / 8 / 22 / 42 %',
  level: 'I',
  gate: 'M',
  requires: FULL,
  citation: 'Williams et al. 2015 (dossier 19 ref [21]); dossier 19 §7 V8',
  notes: 'An active young woman (25 y, 165 cm, 58 kg, 22 % BF, 4 running sessions/week, tracking no cycle): 84 days at (100 − deficit) % of the current maintenance (the study grouped women by their realised mean deficit; the exercise is habitual: the deficit is imposed on top of it). P(≥ 1 LPD) 0.13 / 0.17 / 0.83 / 0.88, tolerance ±0.15; the engine\'s `menstrualRisk` (%/cycle) is divided by 100.',
  arms: { d0: ea(0), d8: ea(8), d22: ea(22), d42: ea(42) },
  expectations: [
    { id: 'd0', label: 'no deficit: P(LPD) (0.13)', unit: 'prob', measure: (c) => c.arm('d0').after('menstrualRisk', 84) / 100, check: val(0.13, 0.15), source: 'dossier 19 V8 (±0.15)' },
    { id: 'd8', label: '−8 %: P(LPD) (0.17)', unit: 'prob', measure: (c) => c.arm('d8').after('menstrualRisk', 84) / 100, check: val(0.17, 0.15), source: 'dossier 19 V8 (±0.15)' },
    { id: 'd22', label: '−22 %: P(LPD) (0.83)', unit: 'prob', measure: (c) => c.arm('d22').after('menstrualRisk', 84) / 100, check: val(0.83, 0.15), source: 'dossier 19 V8 (±0.15)' },
    { id: 'd42', label: '−42 %: P(LPD) (0.88)', unit: 'prob', measure: (c) => c.arm('d42').after('menstrualRisk', 84) / 100, check: val(0.88, 0.15), source: 'dossier 19 V8 (±0.15)' },
  ],
};

export const SCENARIOS_OTHER: Scenario[] = [
  D06_V1_MENSINK,
  D06_V3_SKULAS_RAY,
  D06_V4_BROWNING,
  D06_V5_MARDINOGLU,
  D06_V6_LIM,
  D06_V7_LUUKKONEN,
  D06_V8_MAGKOS,
  D06_V9_SODIUM,
  D06_V11_KETO_LDL,
  D06_V12_DIETFITS,
  D06_V14_NETER,
  D08_V1_V3_FASTING,
  D08_V2_AMPK,
  D08_V5_FONTANA,
  D08_V6_FMD,
  D12_1_WEIGLE,
  D12_2_DUBUC,
  D12_3_KIEL,
  D12_4_EBBELING,
  D12_5_MILITARY,
  D12_6_CONTEST_PREP,
  D14_V3_CALERIE2_WAIST,
  D14_V4_ROSS,
  D14_V5_VAT_SLOPE,
  D14_V9_VAT_BASELINE,
  D14_V10_MENOPAUSE_WAIST,
  D14_V11_HAN,
  D15_V1_KARL,
  D15_V3_NOVOTNY,
  D15_V6_SODIUM,
  D15_V8_YANG_WATER,
  D15_V10_SUTER,
  D15_V12_CAFFEINE,
  D15_V15_POWERS,
  D19_V2_BURKE_2017,
  D19_V5_CALERIE2_BONE,
  D19_V6_VILLAREAL_2006,
  D19_V8_WILLIAMS,
  D19_V9_STRENGTH_DEFICIT,
  D19_V10_NINDL,
];
