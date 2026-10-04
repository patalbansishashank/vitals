/**
 * Dossier 20 (extended water-only fasting) end-to-end scenarios: §7 V1-V10 and the §4B.3 schedule behaviours, MODEL_SPEC §9.2 row 20;
 * plus the shared fasting/transition studies of dossiers 07 and 13 (see the end of the file).
 *
 * Conventions (all rows of this file)
 *  - A fast starts at t = 0 (00:00 of day 0) as an hour-exact `FastEvent`, the reference-implementation convention of dossier 20 §4A
 *    ("start of zero intake at t = 0"). The 14-day burn-in ends with the last habitual meal at 20:00, so the engine's fast has 4 h more
 *    fasting time than the dossier's t = 0; endpoints are read from the hourly series at hour 24·n − 1 ("end of day n"), record 'full'.
 *  - Persona bodies come from dossier 20 Table A1-A3 (lean man, lean woman, obese woman) with the step count solved so the engine's
 *    baseline maintenance equals the table's maintenance TEE, or from the study's stated participants (assumptions in `notes`).
 *  - Tolerances are the V-table tolerances; the §4B.3 rows carry no tolerance in the dossier, so the dossier's own PROPOSED uncertainty
 *    bands (§4A: ΔBW ±15 %, fat ±25 %, protein ±25 %, BHB ±30 %, RMR ±6 points) are used and stated in each `note`.
 */
import { person, personWithTdee, type PersonaSpec } from '../fixtures/personas';
import { buildSchedule, fastEvent, gramMacros, kcalProgram, neutralMacros, pctMacros, pctProgram, rtSession, segmentSchedule, waterOnlyProgram } from '../fixtures/programs';
import { HALL2016 } from './d01';
import { above, below, range, rel, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { ArmSpec, Expectation, Scenario } from '../harness/types';
import type { ArmView } from '../harness/view';
import type { SeriesId } from '../../types/metrics';
import type { DayTemplate, PersonProfile } from '../../types';

const FASTING = REQUIRES.FASTING;
const FULL_RUN = { record: 'full' as const };
/** The Hall 2016 arm of 01-7.6 (shared with 13-V1). */
const HALL2016_ARM: ArmSpec = HALL2016.arms['main'] as ArmSpec;

// ------------------------------------------------------------------ people (dossier 20 Table A1-A3)

const A1_SPEC: PersonaSpec = { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 75, bodyFatPct: 15 };
const A3_SPEC: PersonaSpec = { sex: 'female', ageYears: 45, heightCm: 165, weightKg: 100, bodyFatPct: 45 };
/** Lean man, Table A1: RMR 1 692, maintenance TEE 2 633 kcal/d. */
export const A1 = personWithTdee(A1_SPEC, 2633).profile;
/** Obese woman, Table A3: maintenance TEE 2 468 kcal/d. */
export const A3 = personWithTdee(A3_SPEC, 2468).profile;

// ------------------------------------------------------------------ measure helpers (hour-exact endpoints)

/**
 * Hourly-series change from t = 0 to the end of a fast of `hours` hours (hour index hours − 1). The fasts start at t = 0
 * (after the habitual last meal), so the baseline is the t = 0 state itself (dossier 20 Table A1: change from the start of
 * zero intake) — for scale weight the midnight value, not the day-0 wake-hour value of the morning anchor.
 */
const dHour = (v: ArmView, id: SeriesId, hours: number): number => v.hour(id, hours - 1) - v.t0(id);
/** Value of an hourly series at the end of hour `hours`. */
export const atHour = (v: ArmView, id: SeriesId, hours: number): number => v.hour(id, hours - 1);
/** Total urinary-nitrogen-equivalent loss over days [from, to), g N (nitrogen balance is negative when losing protein). */
const nLoss = (v: ArmView, from: number, to: number): number => -v.sum('nitrogenBalance', from, to);
/** Percent change of an hourly series from t = 0 to the end of hour `hours`. */
const pctHour = (v: ArmView, id: SeriesId, hours: number): number => 100 * (v.hour(id, hours - 1) / v.t0(id) - 1);
/** RMR (daily sum of hourly kcal) after n days relative to the engine baseline RMR0, %. */
const rmrPct = (v: ArmView, n: number): number => 100 * (v.after('rmr', n) / v.profile.rmr0Kcal - 1);

/** Zero-intake fast of `fastH` hours from t = 0 over an otherwise maintenance-at-habitual-macros schedule of `days` days. */
export function fastArm(profile: PersonProfile, fastH: number, days: number, opts: { refeed?: 'none' | 'auto'; electrolytes?: boolean } = {}): ArmSpec {
  const sex = profile.body.sex;
  // The fast starts at t = 0, i.e. after the habitual last meal of the evening before (burn-in window 08-20 h), and every
  // calendar day it covers completely is a water-only day. (Integration fix 2026-09-30: with maintenance programs on the
  // covered days the compiler — "meal-to-meal" fast semantics, ruling 18:10 — moved the whole day-0 food to 00:00 before
  // the span, so each "N-h fast" started with a 2 600 kcal meal and BHB/weight/N rows missed by construction.) Meals of
  // the partial last day that fall inside the span are moved after it by the compiler, as in the studies' refeed.
  return {
    profile,
    schedule: buildSchedule({
      days,
      programs: [pctProgram('maintenance', 100, neutralMacros(sex)), waterOnlyProgram('water')],
      use: (d) => (d * 24 + 24 <= fastH ? 1 : 0),
      events: [fastEvent(0, fastH, 0, { refeed: opts.refeed ?? 'none', ...(opts.electrolytes !== undefined ? { electrolytes: opts.electrolytes } : {}) })],
    }),
    options: FULL_RUN,
  };
}

const fastGrade = (): Pick<Scenario, 'level' | 'requires' | 'gate'> => ({ level: 'I', requires: FASTING, gate: 'M' });

/** Hours of fasting since a 20:00 last meal (the habitual window ends at 20:00): `dinnerFast` events start at 20:00 on day 0. */
const DINNER_H = 20;
export const atFast = (v: ArmView, id: SeriesId, hours: number): number => v.hour(id, DINNER_H + hours - 1);
/** A normal maintenance day 0 whose 20:00 dinner is the last meal, then a `fastH`-hour fast (read with `atFast`). */
export const dinnerFast = (profile: PersonProfile, fastH: number, days: number, startH = DINNER_H): ArmSpec => ({
  profile,
  schedule: buildSchedule({ days, programs: [pctProgram('maintenance', 100, neutralMacros(profile.body.sex))], use: 0, events: [fastEvent(0, fastH, startH)] }),
  options: FULL_RUN,
});
/**
 * Hours between the last habitual meal (20:00 on the burn-in's last day) and a `fastArm` fast's t = 0 (00:00 of day 0).
 * BHB rises steeply over the first two days, so BHB rows of `fastArm` scenarios are read at the stated hours since the last
 * meal (the studies' and dossier 20 Table A1's "start of zero intake"), i.e. `hours − FAST_ARM_GAP_H` (finisher fixture fix
 * 2026-09-30: at "24 h" the arm had fasted 28 h). Weight, composition and nitrogen rows keep the t = 0 convention.
 */
const FAST_ARM_GAP_H = 4;
const bhbSinceMeal = (v: ArmView, hours: number): number => v.hour('bhb', hours - FAST_ARM_GAP_H - 1);

// ------------------------------------------------------------------ V1 Kolnes 2025, 7-d water-only

const KOLNES = person({ sex: 'male', ageYears: 29.7, heightCm: 178, weightKg: 79.6, bodyFatPct: 23.4 });

export const V1_KOLNES: Scenario = {
  id: '20-V1-kolnes-7d',
  dossier: '20',
  target: 'V1',
  title: 'Kolnes 2025, 7-d water-only fast (13 adults)',
  ...fastGrade(),
  citation: 'Kolnes et al. 2025 (dossier 20 ref [4]); dossier 20 §7 V1, §4A Table A1',
  notes:
    '13 adults (7 M), 29.7 y, 79.6 kg, 23.4 % fat, usual routines: modelled as a 29.7-y man, 178 cm (height not in the dossier; BMI 25.1), fat 23.4 %, habitual steps. ' +
    'A 168-h FastEvent from t = 0 over a maintenance schedule (electrolytes on = engine default). DXA fat ↔ `fatMass`, DXA lean ↔ `leanMass` (DXA-equivalent, includes glycogen/water/gut), ' +
    'urinary N ↔ −Σ nitrogenBalance, muscle glycogen ↔ `muscleGlycogen`, RMR ↔ `rmr` against RMR0. RER, VO2peak and strength are not V1 engine rows.',
  arms: { main: fastArm(KOLNES, 168, 8) },
  expectations: [
    { id: 'bw', label: 'body weight change after 7 d (−5.8 ± 0.3 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 168), check: val(-5.8, 0.8), source: 'dossier 20 V1 (ΔBW ±0.8 kg)' },
    { id: 'fat', label: 'fat mass change after 7 d (−1.4 ± 0.1 kg)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 7), check: val(-1.4, 0.5), source: 'dossier 20 V1 (fat ±0.5 kg)' },
    { id: 'lean', label: 'DXA-lean change after 7 d (−4.6 ± 0.3 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'leanMass', 168), check: val(-4.6, 1.0), source: 'dossier 20 V1 (DXA-lean ±1.0 kg)' },
    { id: 'n', label: 'urinary N over 7 d (83.9 ± 6.7 g)', unit: 'g N', measure: (c) => nLoss(c.main, 0, 7), check: val(83.9, 15), source: 'dossier 20 V1 (N ±15 g)' },
    { id: 'glycogen', label: 'muscle glycogen change after 7 d (−53 %)', unit: '%', measure: (c) => pctHour(c.main, 'muscleGlycogen', 168), check: val(-53, 15), source: 'dossier 20 V1 (±15 points)' },
    { id: 'rmr', label: 'RMR change on day 5 (unchanged)', unit: '%', measure: (c) => rmrPct(c.main, 5), check: val(0, 6), source: 'dossier 20 V1 (RMR ±6 %)' },
  ],
};

// ------------------------------------------------------------------ V2 Pietzner 2024, 7-d water-only then 3 d ad lib

const PIETZNER = person({ sex: 'male', ageYears: 35, heightCm: 174.7, weightKg: 77.5 });

export const V2_PIETZNER: Scenario = {
  id: '20-V2-pietzner-7d-refeed3d',
  dossier: '20',
  target: 'V2',
  title: 'Pietzner 2024, 7-d water-only fast then 3 d ad libitum (12 adults)',
  ...fastGrade(),
  citation: 'Pietzner et al. 2024 (dossier 20 ref [3]; also dossier 13 V3); dossier 20 §7 V2, §4B.3 "+3 d after"',
  notes:
    '12 adults (5 F), 77.5 kg, BMI 25.4: modelled as a 35-y man (age not in the dossier), 174.7 cm (BMI 25.4). 168-h FastEvent then 3 d at maintenance with the engine\'s graded refeed (refeed: auto = 50 % / 90 % of the ' +
    'planned energy for a 3-7 d fast, dossier 17 HC-F3); the study\'s intake was ad libitum, so the +3 d rows depend on this stand-in. Rows are the changes from t = 0.',
  arms: { main: fastArm(PIETZNER, 168, 10, { refeed: 'auto' }) },
  expectations: [
    { id: 'bwEnd', label: 'weight change at the end of the fast (−5.7 ± 0.8 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 168), check: val(-5.7, 1.0), source: 'dossier 20 V2 (end ±1 kg)' },
    { id: 'leanEnd', label: 'lean change at the end of the fast (−3.6 ± 0.49 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'leanMass', 168), check: val(-3.6, 1.0), gate: 'Q', source: 'dossier 20 V2', note: 'The dossier gives no end-of-fast lean/fat tolerance for V2; ±1.0 kg (V1 band) assumed, Q.' },
    { id: 'fatEnd', label: 'fat change at the end of the fast (−1.6 ± 1.3 kg)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 7), check: val(-1.6, 1.3), gate: 'Q', source: 'dossier 20 V2', note: 'Study SD 1.3 kg used as the Q band.' },
    { id: 'bw3d', label: 'weight change 3 d after refeeding (−3.1 ± 0.6 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 240), check: val(-3.1, 0.8), source: 'dossier 20 V2 (+3 d weight ±0.8)' },
    { id: 'lean3d', label: 'lean change 3 d after refeeding (−0.69 ± 0.49 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'leanMass', 240), check: val(-0.69, 0.6), source: 'dossier 20 V2 (+3 d lean ±0.6)' },
    { id: 'fat3d', label: 'fat change 3 d after refeeding (−1.85 ± 0.34 kg)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 10), check: val(-1.85, 0.5), source: 'dossier 20 V2 (+3 d fat ±0.5)' },
  ],
};

// ------------------------------------------------------------------ V3 Dai 2024, 21-d water-only

/**
 * Baseline REE as measured (finisher fixture fix 2026-09-30): dossier 20 gives ≈ 1 306 kcal/d at day 15 = −13.7 %, so the
 * cohort's baseline REE is ≈ 1 306 / 0.863 ≈ 1 513 kcal/d, 7 % above the prediction equation (1 411) the persona otherwise uses.
 */
const DAI_REE0_KCAL = Math.round(1306 / (1 - 0.137));
const DAI = person({ sex: 'male', ageYears: 40.5, heightCm: 164.5, weightKg: 66.3, extra: { sexUnspecified: true, labs: { measuredRmrKcal: DAI_REE0_KCAL } } });

export const V3_DAI: Scenario = {
  id: '20-V3-dai-21d',
  dossier: '20',
  target: 'V3',
  title: 'Dai 2024, 21-d water-only fast (13 adults)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Dai et al. 2024 (dossier 20 ref [9]); dossier 20 §7 V3, §4B.3 21-d row, dossier 17 W-F rules (danger banner)',
  notes:
    '13 adults (5 F), 40.5 y, 66.3 kg, BMI 24.5, light activity, mineral water: modelled as a sex-unspecified 40.5-y adult, 164.5 cm (BMI 24.5; the height is derived from BMI), male equation set, with the baseline REE derived from the study (≈ 1 513 kcal/d) entered as a measured RMR. ' +
    '504-h FastEvent from t = 0. Requires FULL because the "danger banner from day 8" row reads the safety module. BHB rows are Q: the dossier gives no BHB tolerance for V3 (MODEL 3.4/4.5/5.3 mM are ≈ 30 % below the ' +
    'observed 4.74/5.36/6.03 mM), so the V8 ±30 % band is applied as a non-gating check. REE percentages are relative to RMR0.',
  arms: { main: fastArm(DAI, 504, 22) },
  expectations: [
    { id: 'bw', label: 'weight change after 21 d (−10.0 ± 1.66 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 504), check: val(-10.0, 1.5), source: 'dossier 20 V3 (ΔBW ±1.5 kg)' },
    { id: 'glucoseMean', label: 'mean glucose days 5-21 (3.86 mM)', unit: 'mmol/L', measure: (c) => c.main.mean('glucose', 4, 21), check: val(3.86, 0.4), source: 'dossier 20 V3 (glucose ±0.4)' },
    { id: 'glucoseNadir', label: 'glucose nadir around day 4 (3.27 mM)', unit: 'mmol/L', measure: (c) => c.main.min('glucose', 2, 7), check: val(3.27, 0.4), source: 'dossier 20 V3 (glucose ±0.4)' },
    { id: 'ree3', label: 'REE change day 3 (not significant, ≈ 0 %)', unit: '%', measure: (c) => rmrPct(c.main, 3), check: val(0, 6), source: 'dossier 20 V3 (REE ±6 points)' },
    { id: 'ree9', label: 'REE change day 9 (−7.5 %)', unit: '%', measure: (c) => rmrPct(c.main, 9), check: val(-7.5, 6), source: 'dossier 20 V3 (REE ±6 points)' },
    { id: 'ree15', label: 'REE change day 15 (−13.7 %)', unit: '%', measure: (c) => rmrPct(c.main, 15), check: val(-13.7, 6), source: 'dossier 20 V3 (REE ±6 points)' },
    { id: 'ree20', label: 'REE change day 20 (−20.3 %)', unit: '%', measure: (c) => rmrPct(c.main, 20), check: val(-20.3, 6), source: 'dossier 20 V3 (REE ±6 points)' },
    { id: 'bhb5', label: 'BHB days 5-9 (4.74 mM)', unit: 'mmol/L', measure: (c) => c.main.mean('bhb', 4, 9), check: rel(4.74, 0.3), gate: 'Q', source: 'dossier 20 V3 (Q band ±30 % from V8)' },
    { id: 'bhb10', label: 'BHB days 10-15 (5.36 mM)', unit: 'mmol/L', measure: (c) => c.main.mean('bhb', 9, 15), check: rel(5.36, 0.3), gate: 'Q', source: 'dossier 20 V3 (Q band ±30 % from V8)' },
    { id: 'bhb15', label: 'BHB days 15-21 (6.03 mM)', unit: 'mmol/L', measure: (c) => c.main.mean('bhb', 14, 21), check: rel(6.03, 0.3), gate: 'Q', source: 'dossier 20 V3 (Q band ±30 % from V8)' },
    { id: 'uric', label: 'uric acid at day 21 relative to baseline (385 → 866 µmol/L, ×2.25)', unit: 'ratio', measure: (c) => c.main.after('uricAcid', 21) / c.main.initial('uricAcid'), check: val(2.25, 0.4), gate: 'Q', source: 'dossier 20 V3, §4B.3 (×2.2)', note: 'Band ±0.4 from V7 assumed.' },
    { id: 'danger', label: 'a danger-severity warning starts by day 8 (17: danger banner from day 8)', unit: 'count', measure: (c) => c.main.result.warnings.filter((w) => w.severity === 'danger' && w.startDay <= 8).length, check: above(0), source: 'dossier 20 §4B.3 21-d row' },
  ],
};

// ------------------------------------------------------------------ V4 Laurens 2021, 10-d modified fast (also 07 #7, 13 V4)

const LAURENS = person({ sex: 'male', ageYears: 44, heightCm: 178, weightKg: 83, extra: {} }); // BMI 26.2
/**
 * 200-250 kcal/d with ≈ 40-50 g carbohydrate: 225 kcal, carbohydrate 45 g, protein 0 g ("protein intake was virtually zero",
 * Laurens 2021: juice, vegetable broth, honey), remainder fat; daily steps +60 % during the fast (Laurens 2021: 7 000 → 11 200).
 * Finisher fixture fix 2026-09-30: the former 10 g/d protein kept the fasting overlay off (modified-fast criterion < 5 g/d).
 */
const LAURENS_FAST_STEPS = Math.round(7000 * 1.6);
const laurensFast = kcalProgram('modifiedFast', 225, gramMacros(0, 45), { steps: LAURENS_FAST_STEPS });
const laurensRefeed = (i: number, kcal: number) => kcalProgram(`refeed${i}`, kcal, pctMacros(15.6, 45.4));

export const V4_LAURENS: Scenario = {
  id: '20-V4-laurens-modified-fast-10d',
  dossier: '20',
  target: 'V4 (07 #7, 13 V4)',
  title: 'Laurens 2021, 10-d modified fast at 200-250 kcal/d (16 men)',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Laurens et al. 2021 (dossier 20 ref [7]); dossier 20 §7 V4, dossier 07 §7 item 7 (weight ±0.8, FM ±0.6), dossier 13 V4',
  notes:
    '16 men, 44 y, BMI 26.2 (178 cm assumed → 83 kg); 10 d at 225 kcal/d (carbohydrate 45 g, protein ≈ 0 g, fat remainder; steps +60 % as reported) then refeeding 800 → 1 600 kcal over 4 d (800/1 100/1 350/1 600). ' +
    'Light activity ≤ 3 h/d (0.45-0.6 × RMR0): the persona\'s 7 000 habitual steps, raised by the study\'s measured +60 % on the fasting days. The strictest tolerances of the three dossiers are used (dossier 07: weight ±0.8, FM ±0.6; 20: ±1.0/±0.6). ' +
    'Hydrated protein tissue ↔ `leanTissue`; BMR ↔ `rmr` vs RMR0. The N fall (−41 %) is relative to the fed pre-fast excretion, which the dossier states is not modelled: no row.',
  arms: {
    main: {
      profile: LAURENS,
      schedule: segmentSchedule(
        [laurensFast, laurensRefeed(1, 800), laurensRefeed(2, 1100), laurensRefeed(3, 1350), laurensRefeed(4, 1600)],
        [
          { days: 10, program: 0 },
          { days: 1, program: 1 },
          { days: 1, program: 2 },
          { days: 1, program: 3 },
          { days: 1, program: 4 },
        ],
      ),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'bw', label: 'weight change after 10 d (−5.9 ± 0.2 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 240), check: val(-5.9, 0.8), source: 'dossier 07 #7 (±0.8 kg); 20 V4 (±1.0)' },
    { id: 'fat', label: 'fat change after 10 d (−2.3 kg)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 10), check: val(-2.3, 0.6), source: 'dossier 07 #7 / 20 V4 (±0.6 kg)' },
    { id: 'protein', label: 'hydrated protein-tissue change after 10 d (−1.65 kg model; study active tissue −1.5)', unit: 'kg', measure: (c) => c.main.delta('leanTissue', 10), check: val(-1.65, 0.5), source: 'dossier 20 V4 (±0.5 kg)' },
    { id: 'bmr', label: 'BMR change after 10 d (−12 %)', unit: '%', measure: (c) => rmrPct(c.main, 10), check: val(-12, 5), source: 'dossier 20 V4 (BMR ±5 points)' },
  ],
};

// ------------------------------------------------------------------ V5 Benedict 1915, 31-d water-only

const BENEDICT = person({ sex: 'male', ageYears: 31, heightCm: 170, weightKg: 60.6, bodyFatPct: 12 });

export const V5_BENEDICT: Scenario = {
  id: '20-V5-benedict-31d',
  dossier: '20',
  target: 'V5',
  title: 'Benedict 1915 / Levanzin, 31-d water-only fast (1 lean man)',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Benedict 1915 (dossier 20 ref [19]); dossier 20 §7 V5',
  notes:
    '1 lean man, 60.6 kg, laboratory life. Height 170 cm, age 31 y and 12 % body fat are assumptions (not in the dossier; fat lost 3.65 kg of it). 744-h FastEvent. ' +
    'Cumulative N over the 31 days ↔ −Σ nitrogenBalance (observed 277 g; the MODEL 289 g and the dossier ±15 % band are applied to 277 g). Late N = mean of days 20-31.',
  arms: { main: fastArm(BENEDICT, 744, 32) },
  expectations: [
    { id: 'bw', label: 'weight change after 31 d (−13.25 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 744), check: val(-13.25, 2), source: 'dossier 20 V5 (ΔBW ±2 kg)' },
    { id: 'nCum', label: 'cumulative N over 31 d (277 g)', unit: 'g N', measure: (c) => nLoss(c.main, 0, 31), check: rel(277, 0.15), source: 'dossier 20 V5 (±15 %)' },
    { id: 'nLate', label: 'late N days 20-31 (≈ 7.7 g/d)', unit: 'g N/d', measure: (c) => nLoss(c.main, 19, 31) / 12, check: val(7.7, 1.5), source: 'dossier 20 V5 (late N ±1.5 g/d)' },
    { id: 'rmr', label: 'RMR change at day 30 (−31 %)', unit: '%', measure: (c) => rmrPct(c.main, 30), check: val(-31, 8), source: 'dossier 20 V5 (RMR ±8 points)' },
  ],
};

// ------------------------------------------------------------------ V6 Göschke / Owen / Forbes & Drenick, N economy

export const V6_NITROGEN: Scenario = {
  id: '20-V6-nitrogen-normal-vs-obese',
  dossier: '20',
  target: 'V6',
  title: 'Göschke 1975 / Owen 1998 / Forbes & Drenick 1979: nitrogen economy, lean man vs obese woman',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Göschke 1975, Owen 1998, Forbes & Drenick 1979 (dossier 20 refs [31,33,34]); dossier 20 §7 V6',
  notes:
    'Lean man (Table A1: 35 y, 178 cm, 75 kg, 15 % BF; 21-d fast) and obese woman (Table A3: 45 y, 165 cm, 100 kg, 45 % BF; 28-d fast). Peak N in days 1-3 (14.5 g/d), obese week-4 N (3.0 g/d) and the lean 21-d ' +
    'N per kg of weight lost (23 g/kg) are the three V6 rows that are pure schedule outputs; the obese late-protein energy share (5-9 %) needs protein-oxidation energy, which is not a series.',
  arms: { lean21: fastArm(A1, 504, 22), obese28: fastArm(A3, 672, 29) },
  expectations: [
    { id: 'peakN', label: 'lean man: peak daily N in days 1-3 (14.5 g/d)', unit: 'g N/d', measure: (c) => -c.arm('lean21').min('nitrogenBalance', 0, 3), check: val(14.5, 2), source: 'dossier 20 V6 (peak ±2 g/d)' },
    { id: 'obeseWk4', label: 'obese woman: mean N in week 4 (3.0 g/d)', unit: 'g N/d', measure: (c) => nLoss(c.arm('obese28'), 21, 28) / 7, check: val(3.0, 1.5), source: 'dossier 20 V6 (obese week-4 N ±1.5 g/d)' },
    { id: 'nPerKg', label: 'lean man: N lost per kg of weight lost over 21 d (23 g/kg)', unit: 'g N/kg', measure: (c) => nLoss(c.arm('lean21'), 0, 21) / -dHour(c.arm('lean21'), 'scaleWeight', 504), check: val(23, 5), source: 'dossier 20 V6 (N/weight ±5)' },
  ],
};

// ------------------------------------------------------------------ V7 Ogłodek 2021, 8-d water-only

const OGLODEK = person({ sex: 'male', ageYears: 50, heightCm: 178, weightKg: 79.4, bodyFatPct: 18.7 });

export const V7_OGLODEK: Scenario = {
  id: '20-V7-ogl-odek-8d',
  dossier: '20',
  target: 'V7',
  title: 'Ogłodek 2021, 8-d water-only fast (12 men)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Ogłodek et al. 2021 (dossier 20 ref [10]); dossier 20 §7 V7',
  notes:
    '12 men, 50 y, 79.4 kg, 18.7 % fat (BIA): height 178 cm assumed. 192-h FastEvent. BHB is the end-of-fast hour value (0.30 → 4.77 mM, ±30 %), glucose 4.84 → 3.66 mM (end ±0.4), uric acid ×2.2 ± 0.4 vs baseline. ' +
    'FULL because uric acid is owned by cardiometabolic. The Na-drift index (−5 ± 2 mmol/L) is a warning index, not a series: no row.',
  arms: { main: fastArm(OGLODEK, 192, 9) },
  expectations: [
    { id: 'bw', label: 'weight change after 8 d (−5.96 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 192), check: val(-5.96, 1.0), source: 'dossier 20 V7 (ΔBW ±1.0 kg)' },
    { id: 'bhb', label: 'BHB at the end of day 8 (4.77 mM)', unit: 'mmol/L', measure: (c) => atHour(c.main, 'bhb', 192), check: rel(4.77, 0.3), source: 'dossier 20 V7 (BHB ±30 %)' },
    { id: 'glucose', label: 'glucose at the end of day 8 (3.66 mM)', unit: 'mmol/L', measure: (c) => atHour(c.main, 'glucose', 192), check: val(3.66, 0.4), source: 'dossier 20 V7 (glucose ±0.4)' },
    { id: 'uric', label: 'uric acid at day 8 relative to baseline (0.38 → 0.85 mmol/L, ×2.2)', unit: 'ratio', measure: (c) => c.main.after('uricAcid', 8) / c.main.initial('uricAcid'), check: val(2.2, 0.4), source: 'dossier 20 V7 (×2.2 ± 0.4)' },
  ],
};

// ------------------------------------------------------------------ V8 Browning 2012 / McDougal 2018 / Klein 1993: BHB at 24/48/72 h (07 #3)

export const YOUNG_M = personWithTdee({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 75, bodyFatPct: 15 }, 2633).profile;
export const YOUNG_F = personWithTdee({ sex: 'female', ageYears: 25, heightCm: 165, weightKg: 60, bodyFatPct: 25 }, 2015).profile;

export const V8_BROWNING: Scenario = {
  id: '20-V8-browning-bhb-24-48-72h',
  dossier: '20',
  target: 'V8 (07 #3)',
  title: 'Browning 2012 / McDougal 2018 / Klein 1993: BHB at 24, 48 and 72 h by sex',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Browning et al. 2012, McDougal 2018, Klein 1993 (dossier 20 refs [25,86,27]); dossier 20 §7 V8, dossier 07 §7 item 3 (BHB ±40 % by sex)',
  notes:
    'Young adults: a 25-y man (178 cm, 75 kg, 15 %) and woman (165 cm, 60 kg, 25 %) with the Table A1/A2 maintenance. A normal day 0 whose 20:00 dinner is the last meal, then a 72-h fast; BHB and glucose are read 24/48/72 h after that meal (`atFast`, the convention of 05 V1/V2; finisher fixture fix 2026-09-30: the former `fastArm` read "24 h" at 28 h of fasting). ' +
    'Observed BHB 24 h 0.33 F / 0.41 M, 48 h 1.22 F / 1.94 M, 72 h 2.3 ± 0.5 (both sexes); ±30 % (dossier 20) applied, which is inside the ±40 % of dossier 07. Glucose at 72 h 4.14 mM (±0.4). ' +
    'The 24 h target is the dossier-05 evidence (0.56 ± 0.28 mM in lean men) compatible value range; see MODEL_SPEC_DECISIONS on the 24-h BHB tension.',
  arms: { m: dinnerFast(YOUNG_M, 72, 5), f: dinnerFast(YOUNG_F, 72, 5) },
  expectations: [
    { id: 'm24', label: 'men: BHB at 24 h (0.41 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('m'), 'bhb', 24), check: rel(0.41, 0.3), source: 'dossier 20 V8 (±30 %)' },
    { id: 'm48', label: 'men: BHB at 48 h (1.94 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('m'), 'bhb', 48), check: rel(1.94, 0.3), source: 'dossier 20 V8 (±30 %)' },
    { id: 'm72', label: 'men: BHB at 72 h (2.3 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('m'), 'bhb', 72), check: rel(2.3, 0.3), source: 'dossier 20 V8 (±30 %)' },
    { id: 'f24', label: 'women: BHB at 24 h (0.33 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('f'), 'bhb', 24), check: rel(0.33, 0.3), source: 'dossier 20 V8 (±30 %)' },
    { id: 'f48', label: 'women: BHB at 48 h (1.22 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('f'), 'bhb', 48), check: rel(1.22, 0.3), source: 'dossier 20 V8 (±30 %)' },
    { id: 'f72', label: 'women: BHB at 72 h (2.3 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('f'), 'bhb', 72), check: rel(2.3, 0.3), source: 'dossier 20 V8 (±30 %)' },
    { id: 'glucose72', label: 'men: glucose at 72 h (4.14 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('m'), 'glucose', 72), check: val(4.14, 0.4), source: 'dossier 20 V8 (glucose ±0.4)' },
    { id: 'gluM48', label: 'men: glucose at 48 h (4.05 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('m'), 'glucose', 48), check: val(4.05, 0.4), source: 'dossier 07 #3 (glucose ±0.4 mM)' },
    { id: 'gluF48', label: 'women: glucose at 48 h (4.4 mM)', unit: 'mmol/L', measure: (c) => atFast(c.arm('f'), 'glucose', 48), check: val(4.4, 0.4), source: 'dossier 07 #3 (glucose ±0.4 mM)' },
    { id: 'sexOrder', label: 'BHB at 48 h higher in men than women (Browning)', unit: 'mmol/L', measure: (c) => atFast(c.arm('m'), 'bhb', 48) - atFast(c.arm('f'), 'bhb', 48), check: above(0), gate: 'Q', source: 'dossier 20 V8 / 07 #3' },
  ],
};

// ------------------------------------------------------------------ V9 Templeman 2021 (07 #9, 13 V10), 3 wk alternate-day fasting vs daily restriction

const TEMPLEMAN = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 70, bodyFatPct: 15 });
const tempMacros = neutralMacros('male');
const tempArm = (fedPct: number, fastDays: boolean): ArmSpec => ({
  profile: TEMPLEMAN,
  schedule: buildSchedule({
    days: 21,
    programs: [pctProgram(`fed${fedPct}`, fedPct, tempMacros), fastDays ? { id: 'fast', label: 'fast', energy: { kind: 'zero' }, macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 } } } : pctProgram(`fed${fedPct}b`, fedPct, tempMacros)],
    use: [0, 1],
  }),
});

export const V9_TEMPLEMAN: Scenario = {
  id: '20-V9-templeman-adf-3wk',
  dossier: '20',
  target: 'V9 (07 #9, 13 V10)',
  title: 'Templeman 2021, 3 wk alternate-day fasting vs 75 % daily vs 0:200',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Templeman et al. 2021 Sci Transl Med (dossier 20 ref [65]); dossier 20 §7 V9, dossier 07 §7 item 9, dossier 13 V10 (fat K)',
  notes:
    'Lean adults (BMI ≈ 22): a 30-y man, 178 cm, 70 kg, 15 % BF (the study mixed sexes; body not in the dossier). Arms: 0:150 = a water-only day alternating with a 150 % day; 75:75 = 75 % daily; 0:200 = water-only alternating with 200 % (eucaloric). ' +
    'Study: ΔBW −1.60 / −1.91 / −0.52 kg, fat −0.74 / −1.75 / −0.12 kg. Dossier 20 requires 0:150 fat loss < 75:75 by ≥ 0.5 kg, non-fat loss 0:150 > 75:75 and 0:200 fat ≈ 0 ± 0.3 kg, but §9.2 lists the Templeman FAT rows as known misses ' +
    '(dossier 07 #9 and 13 V10 "fat K"), so the fat rows here are K and the non-fat/weight rows M (spec discrepancy: dossier 20 V9 is listed M).',
  arms: { adf150: tempArm(150, true), daily75: tempArm(75, false), adf200: tempArm(200, true) },
  expectations: [
    { id: 'bw150', label: '0:150 weight change after 3 wk (−1.60 kg)', unit: 'kg', measure: (c) => c.arm('adf150').after('scaleWeight', 21) - c.arm('adf150').profile.weightKg, check: val(-1.6, 0.8), source: 'dossier 20 V9' },
    { id: 'bw75', label: '75:75 weight change after 3 wk (−1.91 kg)', unit: 'kg', measure: (c) => c.arm('daily75').after('scaleWeight', 21) - c.arm('daily75').profile.weightKg, check: val(-1.91, 0.8), source: 'dossier 20 V9' },
    { id: 'nonFat', label: 'non-fat mass loss 0:150 exceeds 75:75 (kg, > 0)', unit: 'kg', measure: (c) => -(c.arm('adf150').delta('leanMass', 21) - c.arm('daily75').delta('leanMass', 21)), check: above(0), source: 'dossier 20 V9' },
    { id: 'fatOrder', label: 'fat loss 0:150 smaller than 75:75 by ≥ 0.5 kg (study 0.74 vs 1.75)', unit: 'kg', measure: (c) => c.arm('adf150').delta('fatMass', 21) - c.arm('daily75').delta('fatMass', 21), check: above(0.5), gate: 'K', source: 'dossier 20 V9; §9.2 07 #9 / 13 V10 (fat K)' },
    { id: 'fat0200', label: '0:200 fat change (−0.12 ± 0.3 kg)', unit: 'kg', measure: (c) => c.arm('adf200').delta('fatMass', 21), check: val(-0.12, 0.3), gate: 'K', source: 'dossier 20 V9; §9.2 (fat K)' },
    { id: 'fat150', label: '0:150 fat change (−0.74 kg)', unit: 'kg', measure: (c) => c.arm('adf150').delta('fatMass', 21), check: val(-0.74, 0.5), gate: 'M' /* promoted from K at integration 2026-09-30: inside its band */, source: 'dossier 20 V9 (study value; band assumed)', note: 'No tolerance in the dossier; ±0.5 kg assumed.' },
  ],
};

// ------------------------------------------------------------------ V10 Sävendahl & Underwood 1999 (7 d) and Chan 2003 (72 h) hormone/lipid hooks

export const V10_HOOKS: Scenario = {
  id: '20-V10-savendahl-chan-hooks',
  dossier: '20',
  target: 'V10 (08, 12)',
  title: 'Sävendahl 1999 (7-d fast lipids, IGF-1) and Chan 2003 (72-h fast hormones)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Sävendahl & Underwood 1999, Chan 2003 (dossier 20 refs [59,53]); dossier 20 §7 V10, dossier 08 (IGF-1), dossier 12 (leptin K)',
  notes:
    'Lean man of Table A1; 168-h fast for the lipid/IGF-1 rows and a 72-h fast for the Chan panel (two arms). Relative changes from t = 0 must lie within ±30 % of the observed relative change (dossier 20: "within ±30 % of relative change"). ' +
    'Leptin is K (dossier 12 and 07: Chan leptin known miss). Series are compared as ratios, so absolute units cancel.',
  arms: { d7: fastArm(A1, 168, 8), h72: fastArm(A1, 72, 4) },
  expectations: [
    { id: 'ldl7', label: '7-d fast: LDL change (+66 %)', unit: '%', measure: (c) => 100 * (c.arm('d7').after('ldl', 7) / c.arm('d7').initial('ldl') - 1), check: rel(66, 0.3), source: 'dossier 20 V10 (±30 %)' },
    { id: 'apob7', label: '7-d fast: apoB change (+65 %)', unit: '%', measure: (c) => 100 * (c.arm('d7').after('apoB', 7) / c.arm('d7').initial('apoB') - 1), check: rel(65, 0.3), source: 'dossier 20 V10 (±30 %)' },
    { id: 'igf7', label: '7-d fast: IGF-1 change (246 → 87 µg/L, −65 %)', unit: '%', measure: (c) => 100 * (c.arm('d7').after('igf1', 7) / c.arm('d7').initial('igf1') - 1), check: rel(-64.6, 0.3), source: 'dossier 20 V10 (±30 %)' },
    { id: 'tg7', label: '7-d fast: triglycerides unchanged (0 ± 30 %)', unit: '%', measure: (c) => 100 * (c.arm('d7').after('triglycerides', 7) / c.arm('d7').initial('triglycerides') - 1), check: val(0, 30), gate: 'Q', source: 'dossier 20 V10', note: '"Unchanged" has no numeric band; ±30 % assumed.' },
    { id: 'igf72', label: '72-h fast: IGF-1 change (−50 %)', unit: '%', measure: (c) => 100 * (c.arm('h72').after('igf1', 3) / c.arm('h72').initial('igf1') - 1), check: rel(-50, 0.3), source: 'dossier 20 V10 (±30 %)' },
    { id: 'test72', label: '72-h fast: testosterone change (−40 %)', unit: '%', measure: (c) => 100 * (c.arm('h72').after('testosterone', 3) / c.arm('h72').initial('testosterone') - 1), check: rel(-40, 0.3), source: 'dossier 20 V10 (±30 %)' },
    { id: 't372', label: '72-h fast: T3 change (−30 %)', unit: '%', measure: (c) => 100 * (c.arm('h72').after('t3', 3) / c.arm('h72').initial('t3') - 1), check: rel(-30, 0.3), source: 'dossier 20 V10 (±30 %)' },
    { id: 'cort72', label: '72-h fast: cortisol change (4.84 → 7.84 µg/dL, +62 %)', unit: '%', measure: (c) => 100 * (c.arm('h72').after('cortisol', 3) / c.arm('h72').initial('cortisol') - 1), check: rel(62, 0.3), source: 'dossier 20 V10 (±30 %)' },
    { id: 'lept72', label: '72-h fast: leptin falls to ≈ 10 % of baseline (−90 %)', unit: '%', measure: (c) => 100 * (c.arm('h72').after('leptin', 3) / c.arm('h72').initial('leptin') - 1), check: rel(-90, 0.3), gate: 'K', source: 'dossier 20 V10; dossier 12/07 (Chan leptin K)' },
  ],
};

// ------------------------------------------------------------------ §4B.3 schedule behaviours (Table A1 lean man)

const band = (target: number, frac: number): ReturnType<typeof rel> => rel(target, frac);
const B_NOTE = 'Tolerance: the dossier\'s PROPOSED uncertainty bands (§4A: ΔBW ±15 %, fat ±25 %, BHB ±30 %, RMR ±6 points) applied to the MODEL value; §4B.3 states no tolerance.';

function behaviourRows(prefix: string, hours: number, days: number, spec: { bw: number; fat: number; bhb?: readonly [number, number]; rmrPct?: number; glucose?: number }): Expectation[] {
  const rows: Expectation[] = [
    { id: `${prefix}Bw`, label: `${hours} h: weight change (${spec.bw} kg)`, unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', hours), check: band(spec.bw, 0.15), source: `dossier 20 §4B.3 (${hours}-h row)`, note: B_NOTE },
    { id: `${prefix}Fat`, label: `${hours} h: fat change (${spec.fat} kg)`, unit: 'kg', measure: (c) => c.main.delta('fatMass', days), check: band(spec.fat, 0.25), source: `dossier 20 §4B.3 (${hours}-h row)`, note: B_NOTE },
  ];
  if (spec.bhb) rows.push({ id: `${prefix}Bhb`, label: `${hours} h: BHB at the end (${spec.bhb[0]}-${spec.bhb[1]} mM)`, unit: 'mmol/L', measure: (c) => bhbSinceMeal(c.main, hours), check: range(spec.bhb[0] * 0.7, spec.bhb[1] * 1.3), source: `dossier 20 §4B.3 (${hours}-h row)`, note: `${B_NOTE} Applied to both ends of the stated range; read ${hours} h after the last meal (Table A1 t = 0, "dinner → dinner" for 24 h).` });
  if (spec.rmrPct !== undefined) rows.push({ id: `${prefix}Rmr`, label: `${hours} h: RMR change (${spec.rmrPct > 0 ? '+' : ''}${spec.rmrPct} %)`, unit: '%', measure: (c) => rmrPct(c.main, days), check: val(spec.rmrPct, 6), source: `dossier 20 §4B.3 (${hours}-h row)`, note: B_NOTE });
  if (spec.glucose !== undefined) rows.push({ id: `${prefix}Glu`, label: `${hours} h: glucose (${spec.glucose} mM)`, unit: 'mmol/L', measure: (c) => atHour(c.main, 'glucose', hours), check: val(spec.glucose, 0.4), source: `dossier 20 §4B.3 (${hours}-h row); V8 glucose ±0.4` });
  return rows;
}

const behaviour = (id: string, hours: number, extra: Partial<Scenario>): Scenario => ({
  id: `20-4B3-${id}`,
  dossier: '20',
  target: `§4B.3 ${hours} h`,
  title: `§4B.3 schedule behaviour: ${hours >= 48 && hours % 24 === 0 ? `${hours / 24}-day` : `${hours}-h`} fast, lean man (Table A1)`,
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Dossier 20 §4B.3 acceptance table and §4A Table A1 (MODEL values)',
  // Refeed at pre-fast maintenance (finisher fixture fix 2026-09-30): the "+3 d after" rows are dossier 20 MODEL values, and its
  // §4.5.2 MODEL check refeeds "at pre-fast maintenance energy, ≈ 50 % carbohydrate" — not the engine's graded 50/90 % ramp.
  arms: { main: fastArm(A1, hours, Math.ceil(hours / 24) + 4, { refeed: 'none' }) },
  expectations: [],
  ...extra,
});

export const B_24H: Scenario = behaviour('24h', 24, {
  notes: 'Table A1 lean man; 24-h FastEvent from t = 0 then maintenance. ΔBW −1.6 kg, fat −0.17 kg, N 13-14 g, BHB 0.3-0.5 mM at the end; −0.2 kg by 3 d after refeeding.',
  expectations: [
    ...behaviourRows('h24', 24, 1, { bw: -1.6, fat: -0.17, bhb: [0.3, 0.5] }),
    { id: 'h24N', label: '24 h: N on day 1 (13-14 g)', unit: 'g N', measure: (c) => nLoss(c.main, 0, 1), check: val(13.5, 3.4), source: 'dossier 20 §4B.3 (24-h row)', note: 'Protein band ±25 % (dossier §4A).' },
    { id: 'h24After', label: '3 d after the 24-h fast: weight change vs baseline (−0.2 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 24 * 4), check: val(-0.2, 0.5), source: 'dossier 20 §4B.3 (24-h row)', note: 'Band ±0.5 kg assumed (short-fast ΔBW scale).' },
  ],
});

export const B_48H: Scenario = behaviour('48h', 48, {
  notes: 'Table A1 lean man; 48-h FastEvent from t = 0. ΔBW −2.7 kg, fat −0.35 kg, BHB ≈ 1.4-1.9 mM, RMR +4 %, glucose ≈ 4.0 mM.',
  expectations: behaviourRows('h48', 48, 2, { bw: -2.7, fat: -0.35, bhb: [1.4, 1.9], rmrPct: 4, glucose: 4.0 }),
});

export const B_72H: Scenario = behaviour('72h', 72, {
  requires: REQUIRES.FULL,
  notes: 'Table A1 lean man; 72-h FastEvent. ΔBW −3.5 kg, fat −0.55 kg, protein ≈ 270 g, BHB ≈ 2.3-2.7 mM, glucose 3.6-3.8 mM, IGF-1 ≈ −50 % (08), +3 d after: −1.1 kg. FULL for IGF-1.',
  expectations: [
    ...behaviourRows('h72', 72, 3, { bw: -3.5, fat: -0.55, bhb: [2.3, 2.7], glucose: 3.7 }),
    { id: 'h72Protein', label: '72 h: protein oxidised over 3 d (≈ 270 g)', unit: 'g', measure: (c) => 6.25 * nLoss(c.main, 0, 3), check: rel(270, 0.25), source: 'dossier 20 §4B.3 (72-h row)', note: 'Protein = 6.25 × N; ±25 % (dossier §4A).' },
    { id: 'h72Igf', label: '72 h: IGF-1 ≈ −50 %', unit: '%', measure: (c) => 100 * (c.main.after('igf1', 3) / c.main.initial('igf1') - 1), check: rel(-50, 0.3), source: 'dossier 20 §4B.3 (72-h row); dossier 08' },
    { id: 'h72After', label: '3 d after the 72-h fast: weight change vs baseline (−1.1 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 24 * 6), check: val(-1.1, 0.6), source: 'dossier 20 §4B.3 (72-h row)', note: 'Band ±0.6 kg assumed (15 % of the 3.5 kg loss plus refeed uncertainty).' },
  ],
});

export const B_7D: Scenario = behaviour('7d', 168, {
  notes: 'Table A1 lean man; 168-h FastEvent. ΔBW −5.7, fat −1.3, DXA-lean −4.4 kg, N 13 g/d on day 7, BHB ≈ 4, RMR −9 %; +3 d after: −2.6 kg, DXA-lean −1.2.',
  expectations: [
    ...behaviourRows('d7', 168, 7, { bw: -5.7, fat: -1.3, bhb: [3.7, 4.3], rmrPct: -9 }),
    { id: 'd7Lean', label: '7 d: DXA-lean change (−4.4 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'leanMass', 168), check: val(-4.4, 1.0), source: 'dossier 20 §4B.3 (7-d row); V1 DXA-lean ±1.0' },
    { id: 'd7N', label: '7 d: N on day 7 (13 g/d)', unit: 'g N/d', measure: (c) => nLoss(c.main, 6, 7), check: val(13, 3.25), source: 'dossier 20 §4B.3 (7-d row)', note: 'Protein band ±25 %.' },
    { id: 'd7After', label: '3 d after the 7-d fast: weight change vs baseline (−2.6 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'scaleWeight', 24 * 10), check: val(-2.6, 0.8), source: 'dossier 20 §4B.3 (7-d row); V2 (+3 d ±0.8)' },
    { id: 'd7LeanAfter', label: '3 d after the 7-d fast: DXA-lean change vs baseline (−1.2 kg)', unit: 'kg', measure: (c) => dHour(c.main, 'leanMass', 24 * 10), check: val(-1.2, 0.6), source: 'dossier 20 §4B.3 (7-d row); V2 (+3 d lean ±0.6)' },
  ],
});

export const B_21D: Scenario = behaviour('21d', 504, {
  requires: REQUIRES.FULL,
  notes: 'Table A1 lean man; 504-h FastEvent. ΔBW −11.0 kg, fat −3.8, protein 1.57 kg, BHB ≈ 5.7, RMR −21 %, uric acid ×2.2, danger banner from day 8.',
  expectations: [
    ...behaviourRows('d21', 504, 21, { bw: -11.0, fat: -3.84, bhb: [5.4, 6.0], rmrPct: -21 }),
    { id: 'd21Protein', label: '21 d: protein lost (1.57 kg)', unit: 'kg', measure: (c) => (6.25 * nLoss(c.main, 0, 21)) / 1000, check: rel(1.57, 0.25), source: 'dossier 20 §4B.3 (21-d row)', note: 'Protein = 6.25 × N; ±25 %.' },
    { id: 'd21Uric', label: '21 d: uric acid relative to baseline (×2.2)', unit: 'ratio', measure: (c) => c.main.after('uricAcid', 21) / c.main.initial('uricAcid'), check: val(2.2, 0.4), source: 'dossier 20 §4B.3 (21-d row); V7 (±0.4)' },
    { id: 'd21Banner', label: '21 d: a danger warning has started by day 8', unit: 'count', measure: (c) => c.main.result.warnings.filter((w) => w.severity === 'danger' && w.startDay <= 8).length, check: above(0), source: 'dossier 20 §4B.3 (21-d row)' },
  ],
});

// ---- repeated fasts

const weeklyProgram = pctProgram('maintenance', 100, neutralMacros('male'));
export const B_WEEKLY_24H: Scenario = {
  id: '20-4B3-weekly-24h-x12',
  dossier: '20',
  target: '§4B.3 weekly 24-h × 12 wk',
  title: '§4B.3: weekly 24-h fast for 12 weeks, lean man',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Dossier 20 §4B.3 ("Weekly 24-h fast × 12 wk"), §4C',
  notes:
    'Table A1 lean man, otherwise maintenance; a 24-h FastEvent every 7 days (day 3 of each week from 20:00, dinner → dinner) with the auto refeed. Rows: every fast ends below 0.5 mM BHB (so S_N stays ≈ 0; band ' +
    '0.3-0.5 mM ± 30 %), each fast re-enters the peak N (≈ 13-14 g/d) and the cumulative net protein is 12 × 35-45 g. Cumulative fat is not a row (12 × (0.17 + a refeed-day term) with an unspecified refeed-day term).',
  arms: {
    main: {
      profile: A1,
      schedule: buildSchedule({
        days: 84,
        programs: [weeklyProgram],
        use: 0,
        events: Array.from({ length: 12 }, (_, w) => fastEvent(7 * w + 2, 24, 20, { refeed: 'auto' })),
      }),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'bhbMax', label: 'highest end-of-fast BHB over the 12 fasts (≤ 0.65 mM)', unit: 'mmol/L', measure: (c) => Math.max(...Array.from({ length: 12 }, (_, w) => atHour(c.main, 'bhb', 24 * (7 * w + 2) + 20 + 24))), check: below(0.65), source: 'dossier 20 §4B.3 (weekly row: BHB < 0.5 mM); +30 % band' },
    { id: 'peakN', label: 'peak daily N of the last fast (13-14 g/d)', unit: 'g N/d', measure: (c) => Math.max(-c.main.min('nitrogenBalance', 7 * 11 + 2, 7 * 11 + 4)), check: val(13.5, 3.4), source: 'dossier 20 §4B.3 (weekly row: each fast re-enters peak N)', note: 'Band ±25 %.' },
    { id: 'proteinNet', label: 'net protein lost over 12 weeks (12 × 35-45 g = 420-540 g)', unit: 'g', measure: (c) => (6.25 * -c.main.sum('nitrogenBalance', 0, 84)), check: range(420 * 0.75, 540 * 1.25), source: 'dossier 20 §4B.3 (weekly row)', note: 'Protein = 6.25 × N (net of refeed balance); ±25 % band on the stated range.' },
  ],
};

export const B_MONTHLY_72H: Scenario = {
  id: '20-4B3-monthly-72h-x6',
  dossier: '20',
  target: '§4B.3 monthly 72-h × 6',
  title: '§4B.3: monthly 72-h fast for 6 months, lean man',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Dossier 20 §4B.3 ("Monthly 72-h fast × 6"), dossier 08 (IGF-1 τ_up 173 h)',
  notes:
    'Table A1 lean man, otherwise maintenance; a 72-h FastEvent every 28 days for 6 cycles with the auto refeed. Rows: IGF-1 recovers between fasts (dossier 20: "97 % recovered after 25 d", band ±30 % of the 50 % fall) ' +
    'and the fasting-adapted RMR returns to baseline (s_AT < 0.05 ⇒ RMR within ±6 points before the next fast).',
  arms: {
    main: {
      profile: A1,
      schedule: buildSchedule({ days: 168, programs: [weeklyProgram], use: 0, events: Array.from({ length: 6 }, (_, k) => fastEvent(28 * k + 7, 72, 20, { refeed: 'auto' })) }),
    },
  },
  expectations: [
    { id: 'igfRecovery', label: 'IGF-1 on the day before the 6th fast relative to baseline (≈ 97 %)', unit: 'ratio', measure: (c) => c.main.day('igf1', 28 * 5 + 6) / c.main.initial('igf1'), check: range(0.8, 1.1), source: 'dossier 20 §4B.3 (monthly row); dossier 08 τ_up' },
    { id: 'rmrRecovery', label: 'RMR on the day before the 6th fast vs baseline (0 ± 6 %)', unit: '%', measure: (c) => rmrPct(c.main, 28 * 5 + 7), check: val(0, 6), source: 'dossier 20 §4B.3 (monthly row: s_AT < 0.05)' },
  ],
};

// ---- fast broken by a carbohydrate meal

const BROKEN_PROG_FAST = pctProgram('maintenance', 100, neutralMacros('male'));
const BROKEN_MEAL = kcalProgram('carbMeal', 440, gramMacros(0, 110), { meals: { meals: [{ clockH: 12, share: 1 }] } });

export const B_BROKEN_FAST: Scenario = {
  id: '20-4B3-fast-broken-by-110g-carbohydrate',
  dossier: '20',
  target: '§4B.3 broken fast',
  title: '§4B.3: fast broken by a 110-g carbohydrate meal on day 3, lean man',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Dossier 20 §4B.3 ("Fast broken by a 110-g carbohydrate meal on day 3"); dossier 05 V7',
  notes:
    'Table A1 lean man: 60-h FastEvent from t = 0, then a 110 g carbohydrate meal at 12:00 on day 3 (day index 2) and nothing else that day; the fast resumes from 13:00 to the end of the study (5 days; a graded refeed is not requested). ' +
    'Row: BHB at the second hour after the meal is half of its pre-meal value (ratio 0.5, ±30 %), per the dossier ("BHB halves in 1 h").',
  arms: {
    main: {
      profile: A1,
      // days 0-1 are water-only (the 60-h fast starts after the habitual evening meal, see fastArm); day 2 = the carbohydrate meal
      schedule: segmentSchedule([BROKEN_PROG_FAST, BROKEN_MEAL, waterOnlyProgram('water')], [{ days: 2, program: 2 }, { days: 1, program: 1 }, { days: 1, program: 0 }], { events: [fastEvent(0, 60, 0), fastEvent(2, 59, 13)] }),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'bhbHalves', label: 'BHB 1 h after the meal / BHB just before it (0.5)', unit: 'ratio', measure: (c) => atHour(c.main, 'bhb', 24 * 2 + 12 + 2) / atHour(c.main, 'bhb', 24 * 2 + 12), check: rel(0.5, 0.3), source: 'dossier 20 §4B.3; dossier 05 V7', note: 'Band ±30 % (BHB band of §4A).' },
  ],
};

export const SCENARIOS_FASTING_20: Scenario[] = [
  V1_KOLNES,
  V2_PIETZNER,
  V3_DAI,
  V4_LAURENS,
  V5_BENEDICT,
  V6_NITROGEN,
  V7_OGLODEK,
  V8_BROWNING,
  V9_TEMPLEMAN,
  V10_HOOKS,
  B_24H,
  B_48H,
  B_72H,
  B_7D,
  B_21D,
  B_WEEKLY_24H,
  B_MONTHLY_72H,
  B_BROKEN_FAST,
];

// =================================================================================================================
// Dossier 07 (fasting, meal timing) targets 1-9 of §7 (MODEL_SPEC §9.2 row 07: M; Chan leptin and Templeman fat K)
// Items 10-18 are not in the §9.2 row (TRE at matched intake, ad libitum TRE, meal timing at equal intake, late dinner,
// breakfast, meal frequency, one meal/day, post-fast insulin resistance, next-day compensation): the meal-frequency null is
// covered by invariant O-4b and ad libitum modes are out of v1 (§11.1).
// =================================================================================================================


// ---- 07 #1 Rothman 1991 / Roden 2001: liver glycogen after a 650-kcal meal then a 68-h fast

/**
 * Rothman's 650-kcal meal was the evening meal of a normal day (fixture fix 2026-09-30, A2's report: at 12:00 after a 16-h
 * fast the liver started nearly empty). Day 0: the habitual breakfast (08:00) and lunch (13:00), one third of TDEE0 each, then
 * the 650-kcal meal (15 % protein, 50 % carbohydrate) at 18:00; the 68-h fast follows it.
 */
const ROTHMAN_MEAL_H = 18;
const rothmanDay = (tdee0: number): DayTemplate => {
  const e = (2 / 3) * tdee0 + 650;
  const s = tdee0 / 3 / e;
  return kcalProgram('normalDayThen650', e, pctMacros(15, 50), { meals: { meals: [{ clockH: 8, share: s }, { clockH: 13, share: s }, { clockH: ROTHMAN_MEAL_H, share: 650 / e }] } });
};

export const D07_1_ROTHMAN: Scenario = {
  id: '07-1-rothman-liver-glycogen',
  dossier: '07',
  target: '1',
  title: 'Rothman 1991 / Roden 2001: liver glycogen, 650-kcal meal then 68-h fast',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Rothman et al. 1991 Science 254:573; Roden et al. 2001 (dossier 07 refs [6,9]); dossier 07 §7 item 1',
  notes:
    'Healthy adult (Table A1 lean man). Day 0 is a normal day (habitual breakfast and lunch) ending with a 650-kcal mixed meal (15 % protein, 50 % carbohydrate) at 18:00, then a 68-h FastEvent from 19:00. Liver glycogen (`liverGlycogen`, hourly) is read 4 h, 15 h and 64 h after the meal: ' +
    '396 mM (≈ 94 g) at 4 h → 251 mM (≈ 60 g) at 15 h → −83 % by 64 h (relative to the 4-h value), tolerance ±15 %. The GNG-share rows (64/82/96 %, ±8 points) have no engine series and are not encoded.',
  arms: {
    main: {
      profile: A1,
      schedule: buildSchedule({ days: 5, programs: [rothmanDay(2633), pctProgram('maintenance', 100, neutralMacros('male'))], use: (d) => (d === 0 ? 0 : 1), events: [fastEvent(0, 68, ROTHMAN_MEAL_H + 1)] }),
      options: FULL_RUN,
    },
  },
  expectations: [
    { id: 'g4', label: 'liver glycogen 4 h after the meal (≈ 94 g)', unit: 'g', measure: (c) => c.main.hour('liverGlycogen', ROTHMAN_MEAL_H + 4 - 1), check: rel(94, 0.15), source: 'dossier 07 #1 (glycogen ±15 %)' },
    { id: 'g15', label: 'liver glycogen 15 h after the meal (≈ 60 g)', unit: 'g', measure: (c) => c.main.hour('liverGlycogen', ROTHMAN_MEAL_H + 15 - 1), check: rel(60, 0.15), source: 'dossier 07 #1 (glycogen ±15 %)' },
    { id: 'g64', label: 'liver glycogen 64 h after the meal (−83 % vs 4 h, ≈ 16 g)', unit: 'g', measure: (c) => c.main.hour('liverGlycogen', ROTHMAN_MEAL_H + 64 - 1), check: rel(94 * 0.17, 0.15), source: 'dossier 07 #1 (glycogen ±15 %)' },
  ],
};

// ---- 07 #2 Klein 1993: 12 → 72 h

export const D07_2_KLEIN: Scenario = {
  id: '07-2-klein-12-72h',
  dossier: '07',
  target: '2',
  title: 'Klein 1993: short-term fasting 12 → 72 h (glucose, insulin)',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Klein et al. 1993 Am J Physiol (dossier 07 ref [12]); dossier 07 §7 item 2',
  notes:
    '6 men (Table A1 lean man as the stand-in), a 72-h+ FastEvent from the 20:00 last meal; hours are counted from that meal. Glucose 5.58 → 4.14 mM (±15 %); insulin 64.6 → 30.1 pmol/L (ratio 0.466, ±15 % of the ratio) using the relative insulin series. ' +
    'Glycerol and palmitate turnover, glucose Ra are not engine series (not encoded).',
  arms: { main: dinnerFast(A1, 84, 5) },
  expectations: [
    { id: 'glu12', label: 'glucose at 12 h of fasting (5.58 mM)', unit: 'mmol/L', measure: (c) => atFast(c.main, 'glucose', 12), check: rel(5.58, 0.15), source: 'dossier 07 #2 (±15 %)' },
    { id: 'glu72', label: 'glucose at 72 h of fasting (4.14 mM)', unit: 'mmol/L', measure: (c) => atFast(c.main, 'glucose', 72), check: rel(4.14, 0.15), source: 'dossier 07 #2 (±15 %)' },
    { id: 'insRatio', label: 'insulin at 72 h / insulin at 12 h (30.1 / 64.6 = 0.466)', unit: 'ratio', measure: (c) => atFast(c.main, 'insulin', 72) / atFast(c.main, 'insulin', 12), check: rel(30.1 / 64.6, 0.15), source: 'dossier 07 #2 (±15 %)' },
    { id: 'insFall24', label: 'share of the insulin fall (12 → 72 h) reached by 24 h (≈ 70 %)', unit: 'fraction', measure: (c) => (atFast(c.main, 'insulin', 12) - atFast(c.main, 'insulin', 24)) / (atFast(c.main, 'insulin', 12) - atFast(c.main, 'insulin', 72)), check: rel(0.7, 0.15), source: 'dossier 07 #2 (±15 %)' },
  ],
};

// ---- 07 #3 eTRF: BHB after an 18-h fast

export const D07_3_ETRF: Scenario = {
  id: '07-3-etrf-bhb-18h',
  dossier: '07',
  target: '3 (eTRF)',
  title: 'Early time-restricted eating: BHB after an 18-h fast',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Dossier 07 §7 item 3 (eTRF BHB 0.15 mM after an 18-h fast, ref [68]); Browning by sex rows are in 20-V8',
  notes: 'Table A1 lean man, an 18-h FastEvent from the 20:00 last meal (an early-window eater fasts 18 h overnight). BHB 0.15 mM ± 0.1 mM at 18 h.',
  arms: { main: dinnerFast(A1, 18, 3) },
  expectations: [{ id: 'bhb18', label: 'BHB after 18 h of fasting (0.15 mM)', unit: 'mmol/L', measure: (c) => atFast(c.main, 'bhb', 18), check: val(0.15, 0.1), source: 'dossier 07 #3 (±0.1 mM)' }],
};

// ---- 07 #4 Hartman 1992 / Ho 1988: 5-day fast

export const D07_4_HARTMAN: Scenario = {
  id: '07-4-hartman-5d',
  dossier: '07',
  target: '4',
  title: 'Hartman 1992 / Ho 1988: 5-day fast (IGF-1, glucose)',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Hartman et al. 1992, Ho et al. 1988 (dossier 07 refs [15,14]); dossier 07 §7 item 4',
  notes:
    'Table A1 lean man, 120-h FastEvent from t = 0. IGF-1 −41 % from day 1 to day 5 and glucose 4.9 → 3.2 mM, tolerance ±20 %. GH production (×4.8) and pulse frequency are not engine series; FFA (0.43 → 1.55 mM) is not a series.',
  arms: { main: fastArm(A1, 120, 6) },
  expectations: [
    { id: 'igf1', label: 'IGF-1 change day 1 → day 5 (−41 %)', unit: '%', measure: (c) => 100 * (c.main.after('igf1', 5) / c.main.after('igf1', 1) - 1), check: rel(-41, 0.2), source: 'dossier 07 #4 (±20 %)' },
    { id: 'glucose5', label: 'glucose at day 5 (3.2 mM)', unit: 'mmol/L', measure: (c) => atHour(c.main, 'glucose', 120), check: rel(3.2, 0.2), source: 'dossier 07 #4 (±20 %)' },
  ],
};

// ---- 07 #5 Chan 2003: 72-h fast endocrine panel (±15 points)

export const D07_5_CHAN: Scenario = {
  id: '07-5-chan-72h-panel',
  dossier: '07',
  target: '5',
  title: 'Chan 2003: 72-h fast endocrine panel in lean men',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Chan et al. 2003 J Clin Endocrinol Metab (dossier 07 ref [23]); dossier 07 §7 item 5; dossier 12 (Chan 72-h leptin K)',
  notes:
    'Table A1 lean man, 72-h FastEvent from t = 0. Relative changes within ±15 percentage points: leptin to ≈ 10 % of fed (K), T3 −30 %, testosterone −40 %, IGF-1 more than −50 % (checked as ≤ −35 %), insulin more than −70 % (≤ −55 %), cortisol 4.84 → 7.84 µg/dL (+62 %). ' +
    'FFA +300 % is not a series. The ±30 % (relative) version of the same data is in 20-V10.',
  arms: { main: fastArm(A1, 72, 4) },
  expectations: [
    { id: 'leptin', label: 'leptin change (−90 %)', unit: '%', measure: (c) => 100 * (c.main.after('leptin', 3) / c.main.initial('leptin') - 1), check: val(-90, 15), gate: 'K', source: 'dossier 07 #5; §9.2 (Chan leptin K)' },
    { id: 't3', label: 'T3 change (−30 %)', unit: '%', measure: (c) => 100 * (c.main.after('t3', 3) / c.main.initial('t3') - 1), check: val(-30, 15), source: 'dossier 07 #5 (±15 points)' },
    { id: 'testosterone', label: 'testosterone change (−40 %)', unit: '%', measure: (c) => 100 * (c.main.after('testosterone', 3) / c.main.initial('testosterone') - 1), check: val(-40, 15), source: 'dossier 07 #5 (±15 points)' },
    { id: 'igf1', label: 'IGF-1 change (more than −50 %: ≤ −35 %)', unit: '%', measure: (c) => 100 * (c.main.after('igf1', 3) / c.main.initial('igf1') - 1), check: below(-35), source: 'dossier 07 #5 (> −50 % with ±15 points)' },
    { id: 'insulin', label: 'insulin change (more than −70 %: ≤ −55 %)', unit: '%', measure: (c) => 100 * (atHour(c.main, 'insulin', 72) / c.main.initial('insulin') - 1), check: below(-55), source: 'dossier 07 #5 (> −70 % with ±15 points)', note: 'Uses the relative insulin series (1 = the fed-baseline value).' },
    { id: 'cortisol', label: 'cortisol change (4.84 → 7.84 µg/dL, +62 %)', unit: '%', measure: (c) => 100 * (c.main.after('cortisol', 3) / c.main.initial('cortisol') - 1), check: val(62, 15), source: 'dossier 07 #5 (±15 points)' },
  ],
};

// ---- 07 #6 Webber 1994 / Zauner 2000: REE in early starvation

export const D07_6_WEBBER: Scenario = {
  id: '07-6-webber-zauner-ree',
  dossier: '07',
  target: '6',
  title: 'Webber 1994 / Zauner 2000: resting energy expenditure at 36 and 72 h of fasting',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Webber et al. 1994, Zauner et al. 2000 (dossier 07 refs [18,17]); dossier 07 §7 item 6',
  notes:
    'Table A1 lean man, FastEvent from the 20:00 last meal. RMR +6 % at 36 h and +2.6 % (n.s.) at 72 h, ±5 points; RMR is the hourly `rmr` value ×24 against RMR0. The RER rows (0.80 → 0.76 → 0.72, ±0.02) need an RQ series that is not recorded ' +
    '(CONTRACT REQUEST: record a 24-h/hourly RQ); heart rate and norepinephrine are not engine outputs.',
  arms: { main: dinnerFast(A1, 84, 5) },
  expectations: [
    { id: 'ree36', label: 'RMR at 36 h of fasting vs RMR0 (+6 %)', unit: '%', measure: (c) => 100 * ((24 * atFast(c.main, 'rmr', 36)) / c.main.profile.rmr0Kcal - 1), check: val(6, 5), source: 'dossier 07 #6 (REE ±5 points)' },
    { id: 'ree72', label: 'RMR at 72 h of fasting vs RMR0 (+2.6 %)', unit: '%', measure: (c) => 100 * ((24 * atFast(c.main, 'rmr', 72)) / c.main.profile.rmr0Kcal - 1), check: val(2.6, 5), source: 'dossier 07 #6 (REE ±5 points)' },
  ],
};

// ---- 07 #8 Buchinger cohort

const BUCHINGER = person({ sex: 'male', ageYears: 55, heightCm: 170, weightKg: 78, extra: { sexUnspecified: true } });
const buchingerArm = (days: number): ArmSpec => ({ profile: BUCHINGER, schedule: buildSchedule({ days, programs: [kcalProgram('buchinger', 250, pctMacros(8, 80))], use: 0 }) });

export const D07_8_BUCHINGER: Scenario = {
  id: '07-8-buchinger-5d-20d',
  dossier: '07',
  target: '8',
  title: 'Buchinger cohort: 5.4-d and 20.1-d therapeutic fasts',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Wilhelmi de Toledo et al. 2019 PLoS One (dossier 07 refs [37,38]); dossier 07 §7 item 8',
  notes:
    'Mixed-sex cohort, mean age ≈ 55 y, BMI not in the dossier: a sex-unspecified 55-y adult, 170 cm, 78 kg (BMI 27; assumption). Buchinger fasting is ≈ 250 kcal/d of juice and broth: modelled as 250 kcal/d (8 %E protein, 80 %E carbohydrate; assumption) for 5 and 20 days ' +
    '(the cohort means are 5.4 and 20.1 d). Weight −3.2 and −8.6 kg, tolerance ±1 kg (M). SBP 131.6 → 120.7 and uric acid 338 → 495 µmol/L have no dossier tolerance: Q rows with assumed bands (SBP ±5 mmHg on the change, uric acid ratio ±0.25).',
  arms: { d5: buchingerArm(5), d20: buchingerArm(20) },
  expectations: [
    { id: 'bw5', label: '5-d fast: weight change (−3.2 kg)', unit: 'kg', measure: (c) => scaleDeltaAny(c.arm('d5'), 5), check: val(-3.2, 1), source: 'dossier 07 #8 (weight ±1 kg)' },
    { id: 'bw20', label: '20-d fast: weight change (−8.6 kg)', unit: 'kg', measure: (c) => scaleDeltaAny(c.arm('d20'), 20), check: val(-8.6, 1), source: 'dossier 07 #8 (weight ±1 kg)' },
    { id: 'sbp20', label: '20-d fast: systolic BP change (131.6 → 120.7 mmHg)', unit: 'mmHg', measure: (c) => c.arm('d20').delta('sbp', 20), check: val(-10.9, 5), gate: 'Q', source: 'dossier 07 #8', note: 'No tolerance given; ±5 mmHg assumed.' },
    { id: 'uric20', label: '20-d fast: uric acid ratio (338 → 495 µmol/L = ×1.46)', unit: 'ratio', measure: (c) => c.arm('d20').after('uricAcid', 20) / c.arm('d20').initial('uricAcid'), check: val(1.46, 0.25), gate: 'Q', source: 'dossier 07 #8', note: 'No tolerance given; ±0.25 assumed.' },
  ],
};

function scaleDeltaAny(v: ArmView, n: number): number {
  return v.after('scaleWeight', n) - v.profile.weightKg;
}

// =================================================================================================================
// Dossier 13 (diet transitions and periodization) V1-V15 (MODEL_SPEC §9.2 row 13: M; V10 Templeman fat K, V14 Q)
// V3 Pietzner and V4 Laurens are 20-V2 and 20-V4; V10 Templeman is 20-V9. Not encoded (no engine series or ad libitum intake):
// V5 Burke (exercise fat oxidation), V6 Jansen (2-h OGTT), V13 Sciarrillo (ad libitum intake), V14 gallstone risk (Q, no series).
// =================================================================================================================

// ---- V1 Hall 2016 KD transition (arm of 01-7.6)

export const D13_V1_HALL_KD: Scenario = {
  id: '13-V1-hall2016-kd-transition',
  dossier: '13',
  target: 'V1',
  title: 'Hall 2016: rapid extra weight loss and fat-loss slowing after the switch to an isocaloric KD',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Hall et al. 2016 Am J Clin Nutr 104:324 (dossier 13 ref [3]); dossier 13 §7 V1',
  notes:
    'Same person and schedule as 01-7.6 (28 d baseline diet, 28 d isocaloric KD at 90 % of maintenance). "Rapid extra loss" = weight change of the first KD week minus that of the last baseline week (−1.6 ± 0.4 kg); ' +
    'FM over KD days 1-15 (−0.2 ± 0.2 kg, tolerance ±0.2) vs the last 15 baseline days (−0.5 ± 0.2). Urinary N +1.5 g/d early on KD is a Q row (no tolerance in the dossier, ±1 g/d assumed).',
  arms: { main: HALL2016_ARM },
  expectations: [
    { id: 'extraLoss', label: 'extra weight loss in the first KD week vs the last baseline week (−1.6 kg)', unit: 'kg', measure: (c) => c.main.after('scaleWeight', 35) - c.main.after('scaleWeight', 28) - (c.main.after('scaleWeight', 28) - c.main.after('scaleWeight', 21)), check: val(-1.6, 0.4), source: 'dossier 13 V1 (±0.4 kg)' },
    { id: 'fmKd', label: 'fat-mass change over KD days 1-15 (−0.2 kg)', unit: 'kg', measure: (c) => c.main.after('fatMass', 43) - c.main.after('fatMass', 28), check: val(-0.2, 0.2), source: 'dossier 13 V1 (FM ±0.2 kg)' },
    { id: 'fmBd', label: 'fat-mass change over the last 15 baseline days (−0.5 kg)', unit: 'kg', measure: (c) => c.main.after('fatMass', 28) - c.main.after('fatMass', 13), check: val(-0.5, 0.2), source: 'dossier 13 V1 (FM ±0.2 kg)' },
    { id: 'nEarly', label: 'extra urinary N early on KD (+1.5 g/d)', unit: 'g N/d', measure: (c) => nLoss(c.main, 28, 35) / 7 - nLoss(c.main, 14, 28) / 14, check: val(1.5, 1), gate: 'Q', source: 'dossier 13 V1', note: 'No tolerance given; ±1 g/d assumed.' },
  ],
};

// ---- V2 Yang & Van Itallie 1976: 800-kcal ketogenic vs mixed

const YANG = A3;
const yangArm = (carbG: number): ArmSpec => ({ profile: YANG, schedule: buildSchedule({ days: 10, programs: [kcalProgram(`kcal800c${carbG}`, 800, gramMacros(80, carbG))], use: 0 }) });

export const D13_V2_YANG: Scenario = {
  id: '13-V2-yang-van-itallie-800kcal',
  dossier: '13',
  target: 'V2',
  title: 'Yang & Van Itallie 1976: 800 kcal ketogenic vs mixed diet, 10 d',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Yang & Van Itallie 1976 J Clin Invest 58:722 (PMID 956398; dossier 13 ref [1]); dossier 13 §7 V2',
  notes:
    '6 obese adults, three 10-d periods. Modelled with the Table A3 obese woman (100 kg, 45 % BF; the study body is not in the dossier) at 800 kcal/d: ketogenic = 10 g carbohydrate, 80 g protein, fat remainder; mixed = 100 g carbohydrate, 80 g protein, fat remainder ' +
    '(the diet macros are not in the dossier: assumption). Weight loss 467 vs 278 g/d (±20 %); fat loss equal 163 vs 165 g/d (within ±15 g/d, i.e. ±0.15 kg over 10 d).',
  arms: { ketogenic: yangArm(10), mixed: yangArm(100) },
  expectations: [
    { id: 'wKd', label: 'ketogenic: mean weight loss (467 g/d)', unit: 'g/d', measure: (c) => -(1000 * scaleDeltaAny(c.arm('ketogenic'), 10)) / 10, check: rel(467, 0.2), source: 'dossier 13 V2 (±20 %)' },
    { id: 'wMixed', label: 'mixed: mean weight loss (278 g/d)', unit: 'g/d', measure: (c) => -(1000 * scaleDeltaAny(c.arm('mixed'), 10)) / 10, check: rel(278, 0.2), source: 'dossier 13 V2 (±20 %)' },
    { id: 'fatKd', label: 'ketogenic: mean fat loss (163 g/d)', unit: 'g/d', measure: (c) => -(1000 * c.arm('ketogenic').delta('fatMass', 10)) / 10, check: val(163, 15), source: 'dossier 13 V2 (fat ±15 g/d)' },
    { id: 'fatMixed', label: 'mixed: mean fat loss (165 g/d)', unit: 'g/d', measure: (c) => -(1000 * c.arm('mixed').delta('fatMass', 10)) / 10, check: val(165, 15), source: 'dossier 13 V2 (fat ±15 g/d)' },
  ],
};

// ---- V7 Peos 2021 diet break and V11 Wilson 2020 carbohydrate reintroduction (resistance-trained)

const RT_PERSON = person({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 78, bodyFatPct: 14, trainingYears: 3, trainingHistory: '1to3y', sessionsPerWeek: 3, liftingCardioMix: 0 });
const rtDay = [rtSession(17, { volume: 'moderate', durationMin: 60 })];
const trainProg = (id: string, pct: number, macros: ReturnType<typeof pctMacros>): [DayTemplateT, DayTemplateT] => [pctProgram(`${id}Train`, pct, macros, { exercise: rtDay }), pctProgram(`${id}Rest`, pct, macros)];
type DayTemplateT = ReturnType<typeof pctProgram>;
const week = (d: number): number => ([0, 2, 4].includes(d % 7) ? 0 : 1);

const [ierT, ierR] = trainProg('ier', 75, pctMacros(20, 45));
const [brkT, brkR] = trainProg('break', 100, pctMacros(20, 60));

export const D13_V7_PEOS: Scenario = {
  id: '13-V7-peos-diet-break',
  dossier: '13',
  target: 'V7',
  title: 'Peos 2021 (ICECAP): one-week diet break at maintenance after 12 wk of restriction, resistance-trained adults',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.TRAINING,
  citation: 'Peos et al. 2021 (dossier 13 refs [78,79]); dossier 13 §7 V7',
  notes:
    '26 resistance-trained adults: a 25-y resistance-trained man (3 y, 3 sessions/wk; 178 cm, 78 kg, 14 % BF) with RT on Mon/Wed/Fri throughout. The IER before the break is modelled as continuous 75 % of maintenance (deficit not in the dossier: assumption), ' +
    'protein 20 %E; the break is one week at 100 % of maintenance with carbohydrate 60 %E. Rows are changes over the break week: BW +0.6, DXA FFM +0.7, FM ≈ 0, all ±0.3 kg; REE +200 kJ/d (= +48 kcal/d) is Q (no tolerance).',
  arms: { main: { profile: RT_PERSON, schedule: buildSchedule({ days: 91, programs: [ierT, ierR, brkT, brkR], use: (d) => (d < 84 ? week(d) : 2 + week(d)) }) } },
  expectations: [
    { id: 'bw', label: 'body-weight change over the break week (+0.6 kg)', unit: 'kg', measure: (c) => c.main.after('scaleWeight', 91) - c.main.after('scaleWeight', 84), check: val(0.6, 0.3), source: 'dossier 13 V7 (±0.3 kg)' },
    { id: 'ffm', label: 'DXA-lean change over the break week (+0.7 kg)', unit: 'kg', measure: (c) => c.main.after('leanMass', 91) - c.main.after('leanMass', 84), check: val(0.7, 0.3), source: 'dossier 13 V7 (±0.3 kg)' },
    { id: 'fm', label: 'fat-mass change over the break week (≈ 0 kg)', unit: 'kg', measure: (c) => c.main.after('fatMass', 91) - c.main.after('fatMass', 84), check: val(0, 0.3), source: 'dossier 13 V7 (±0.3 kg)' },
    { id: 'ree', label: 'REE change over the break week (+200 kJ/d = +48 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.mean('rmr', 84, 91) - c.main.mean('rmr', 77, 84), check: val(48, 50), gate: 'Q', source: 'dossier 13 V7', note: 'No tolerance given; ±50 kcal/d assumed.' },
  ],
};

export const D13_V11_WILSON: Scenario = {
  id: '13-V11-wilson-carb-reintroduction',
  dossier: '13',
  target: 'V11',
  title: 'Wilson 2020: DXA lean mass in the week of carbohydrate reintroduction after 10 wk of ketogenic diet + RT',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.TRAINING,
  citation: 'Wilson et al. 2020 (dossier 13 ref [26]); dossier 13 §7 V11',
  notes:
    'Resistance-trained men: the 25-y resistance-trained man above (RT Mon/Wed/Fri). 10 weeks isocaloric ketogenic diet (100 % of maintenance, carbohydrate 5 %E, protein 20 %E), then one week of carbohydrate reintroduction (60 %E). ' +
    'Row: DXA-lean (`leanMass`) change over the reintroduction week as % of its start value, +4.8 ± 1.5 percentage points. Glycogen, water and gut contents refill; the dossier expects the lean-mass artefact.',
  arms: {
    main: {
      profile: RT_PERSON,
      schedule: buildSchedule({ days: 77, programs: [...trainProg('kd', 100, pctMacros(20, 5)), ...trainProg('reint', 100, pctMacros(20, 60))], use: (d) => (d < 70 ? week(d) : 2 + week(d)) }),
    },
  },
  expectations: [{ id: 'lbm', label: 'DXA-lean change over the reintroduction week (+4.8 %)', unit: '%', measure: (c) => (100 * (c.main.after('leanMass', 77) - c.main.after('leanMass', 70))) / c.main.after('leanMass', 70), check: val(4.8, 1.5), source: 'dossier 13 V11 (±1.5 points)' }],
};

// ---- V8 MATADOR (Byrne 2018)

const MATADOR = person({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 108 }); // BMI 34
const matMacros = neutralMacros('male');
const blocks2wk = (n: number): { name: string; startDay: number; endDay: number }[] => Array.from({ length: n }, (_, i) => ({ name: `block${i}`, startDay: 14 * i, endDay: 14 * (i + 1) }));
const matProg = [pctProgram('restrict', 67, matMacros, {}, 'blockStart'), pctProgram('balance', 100, matMacros, {}, 'blockStart')];

export const D13_V8_MATADOR: Scenario = {
  id: '13-V8-matador-intermittent',
  dossier: '13',
  target: 'V8',
  title: 'MATADOR (Byrne 2018): 16 wk of restriction at 67 % continuous vs eight 2-wk restriction blocks alternating with balance blocks (30 wk)',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Byrne et al. 2018 Int J Obes 42:129 (PMID 28925405; dossier 13 ref [77]); dossier 13 §7 V8',
  notes:
    '51 obese men: an obese man, 40 y, 178 cm, 108 kg (BMI 34; assumption). Restriction = 67 % of the block-start maintenance, balance = 100 % of the block-start maintenance (2-week blocks, energy reference blockStart). ' +
    'Continuous: 8 blocks of restriction (16 wk); intermittent: 8 restriction blocks alternating with 7 balance blocks (30 wk). Rows: weight change inside the balance blocks 0.0 ± 0.5 kg (dossier tolerance ±0.5 for balance blocks). ' +
    'The dossier tolerance for the loss totals is "directional" and dossier 13 itself concludes breaks are neutral per restriction-week (R-SEQ), so INT losing more than CONT is a Q row, not a gate.',
  arms: {
    cont: { profile: MATADOR, schedule: buildSchedule({ days: 112, programs: matProg, use: 0, blocks: blocks2wk(8) }) },
    int: { profile: MATADOR, schedule: buildSchedule({ days: 210, programs: matProg, use: (d) => (Math.floor(d / 14) % 2 === 0 ? 0 : 1), blocks: blocks2wk(15) }) },
  },
  expectations: [
    { id: 'balance', label: 'intermittent: weight change across balance blocks (0.0 ± 0.3 kg), mean of the 7 blocks', unit: 'kg', measure: (c) => { const v = c.arm('int'); let s = 0; for (let b = 1; b < 15; b += 2) s += v.after('scaleWeight', 14 * (b + 1)) - v.after('scaleWeight', 14 * b); return s / 7; }, check: val(0, 0.5), source: 'dossier 13 V8 (balance blocks ±0.5 kg)' },
    { id: 'contLoss', label: 'continuous: weight change at 16 wk (−9.1 kg)', unit: 'kg', measure: (c) => scaleDeltaAny(c.arm('cont'), 112), check: val(-9.1, 2.9), gate: 'Q', source: 'dossier 13 V8', note: 'Directional target; the study SD (2.9 kg) is used as the Q band.' },
    { id: 'intLoss', label: 'intermittent: weight change at 30 wk (−14.1 kg)', unit: 'kg', measure: (c) => scaleDeltaAny(c.arm('int'), 210), check: val(-14.1, 5.6), gate: 'Q', source: 'dossier 13 V8', note: 'Directional target; the study SD (5.6 kg) is used as the Q band.' },
    { id: 'intMore', label: 'intermittent loses more than continuous (direction)', unit: 'kg', measure: (c) => scaleDeltaAny(c.arm('cont'), 112) - scaleDeltaAny(c.arm('int'), 210), check: above(0), gate: 'Q', source: 'dossier 13 V8 (directional; breaks are "neutral per ER-week" per dossier 13)' },
  ],
};

// ---- V9 Vink 2016

const VINK = person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 88 }); // BMI 32.3
const vinkMacros = neutralMacros('female');

export const D13_V9_VINK: Scenario = {
  id: '13-V9-vink-rate-of-loss',
  dossier: '13',
  target: 'V9',
  title: 'Vink 2016: 500 kcal/d for 5 wk vs 1 250 kcal/d for 12 wk (equal-ish loss)',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Vink et al. 2016 Obesity 24:321 (PMID 26813524; dossier 13 ref [65]); dossier 13 §7 V9',
  notes:
    'Adults with BMI 28-35: a 45-y woman, 165 cm, 88 kg (BMI 32.3; assumption). VLCD 500 kcal/d for 5 weeks and LCD 1 250 kcal/d for 12 weeks; the weight loss rows (−9.0 vs −8.2 kg, ±1.5 kg) are gated. ' +
    'The 4-week stable phase and 9-month regain (4.5 vs 4.2 kg) depend on free-living intake (ad libitum is out of v1) and are not encoded.',
  arms: {
    vlcd: { profile: VINK, schedule: buildSchedule({ days: 35, programs: [kcalProgram('vlcd', 500, pctMacros(30, 40))], use: 0 }) },
    lcd: { profile: VINK, schedule: buildSchedule({ days: 84, programs: [kcalProgram('lcd', 1250, vinkMacros)], use: 0 }) },
  },
  expectations: [
    { id: 'vlcd', label: 'VLCD: weight change after 5 wk (−9.0 kg)', unit: 'kg', measure: (c) => scaleDeltaAny(c.arm('vlcd'), 35), check: val(-9.0, 1.5), source: 'dossier 13 V9 (±1.5 kg)' },
    { id: 'lcd', label: 'LCD: weight change after 12 wk (−8.2 kg)', unit: 'kg', measure: (c) => scaleDeltaAny(c.arm('lcd'), 84), check: val(-8.2, 1.5), source: 'dossier 13 V9 (±1.5 kg)' },
  ],
};

// ---- V12 Kerndt 1982

export const D13_V12_KERNDT: Scenario = {
  id: '13-V12-kerndt-total-fast-rate',
  dossier: '13',
  target: 'V12',
  title: 'Kerndt 1982: total-fast weight-loss rate, week 1 vs week 3',
  level: 'I',
  gate: 'M',
  requires: FASTING,
  citation: 'Kerndt et al. 1982 (review of fasting data; dossier 13 ref [29]); dossier 13 §7 V12',
  notes: 'Total fast in obese patients: the Table A3 obese woman (100 kg), a 504-h FastEvent from t = 0. Mean weight-loss rate of week 1 ≈ 0.9 kg/d and week 3 ≈ 0.3 kg/d, ±0.2 kg/d.',
  arms: { main: fastArm(A3, 504, 22) },
  expectations: [
    { id: 'wk1', label: 'week-1 weight-loss rate (0.9 kg/d)', unit: 'kg/d', measure: (c) => -dHour(c.main, 'scaleWeight', 168) / 7, check: val(0.9, 0.2), source: 'dossier 13 V12 (±0.2 kg/d)' },
    { id: 'wk3', label: 'week-3 weight-loss rate (0.3 kg/d)', unit: 'kg/d', measure: (c) => (atHour(c.main, 'scaleWeight', 336) - atHour(c.main, 'scaleWeight', 504)) / 7, check: val(0.3, 0.2), source: 'dossier 13 V12 (±0.2 kg/d)' },
  ],
};

// ---- V15 Schrauwen 1997: fat balance after an isocaloric switch from low-fat to high-fat

const SCHRAUWEN = person({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 72, bodyFatPct: 15, habitualCarbPctEnergy: 55 });
const MJ_PER_KG_FAT = 39.5;

export const D13_V15_SCHRAUWEN: Scenario = {
  id: '13-V15-schrauwen-fat-balance',
  dossier: '13',
  target: 'V15',
  title: 'Schrauwen 1997: fat balance after an isocaloric switch from a low-fat to a high-fat diet (55 → 25 %E carbohydrate)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.CORE,
  citation: 'Schrauwen et al. 1997 Am J Clin Nutr 66:276 (dossier 13 ref [37]; dossier 04 §4.11 [55,56]); dossier 13 §7 V15',
  notes:
    '12 lean men in a respiration chamber: a 25-y lean man (178 cm, 72 kg, 15 % BF) whose habitual (burn-in) carbohydrate intake is 55 %E, switched to 25 %E carbohydrate at 100 % of maintenance (protein 15.6 %E, fat remainder). ' +
    'Fat balance (MJ/d) = fat-mass change per day × 39.5 MJ/kg: +1.06, +0.75, +0.55 MJ/d on days 1-3 and ≈ 0 by day 7, tolerance ±0.3 MJ/d (emergent from 01/04).',
  arms: { main: { profile: SCHRAUWEN, schedule: buildSchedule({ days: 7, programs: [pctProgram('highFat', 100, pctMacros(15.6, 25))], use: 0 }) } },
  expectations: [
    { id: 'd1', label: 'fat balance day 1 (+1.06 MJ/d)', unit: 'MJ/d', measure: (c) => (c.main.after('fatMass', 1) - c.main.initial('fatMass')) * MJ_PER_KG_FAT, check: val(1.06, 0.3), source: 'dossier 13 V15 (±0.3 MJ/d)' },
    { id: 'd2', label: 'fat balance day 2 (+0.75 MJ/d)', unit: 'MJ/d', measure: (c) => (c.main.after('fatMass', 2) - c.main.after('fatMass', 1)) * MJ_PER_KG_FAT, check: val(0.75, 0.3), source: 'dossier 13 V15 (±0.3 MJ/d)' },
    { id: 'd3', label: 'fat balance day 3 (+0.55 MJ/d)', unit: 'MJ/d', measure: (c) => (c.main.after('fatMass', 3) - c.main.after('fatMass', 2)) * MJ_PER_KG_FAT, check: val(0.55, 0.3), source: 'dossier 13 V15 (±0.3 MJ/d)' },
    { id: 'd7', label: 'fat balance day 7 (≈ 0 MJ/d)', unit: 'MJ/d', measure: (c) => (c.main.after('fatMass', 7) - c.main.after('fatMass', 6)) * MJ_PER_KG_FAT, check: val(0, 0.3), source: 'dossier 13 V15 (±0.3 MJ/d)' },
  ],
};

export const SCENARIOS_FASTING_07: Scenario[] = [D07_1_ROTHMAN, D07_2_KLEIN, D07_3_ETRF, D07_4_HARTMAN, D07_5_CHAN, D07_6_WEBBER, D07_8_BUCHINGER];
export const SCENARIOS_DIET_13: Scenario[] = [D13_V1_HALL_KD, D13_V2_YANG, D13_V7_PEOS, D13_V8_MATADOR, D13_V9_VINK, D13_V11_WILSON, D13_V12_KERNDT, D13_V15_SCHRAUWEN];

export const SCENARIOS_FASTING: Scenario[] = [...SCENARIOS_FASTING_20, ...SCENARIOS_FASTING_07, ...SCENARIOS_DIET_13];
