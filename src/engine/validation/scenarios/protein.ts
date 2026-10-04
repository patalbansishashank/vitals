/**
 * Dossiers 09 (resistance-training hypertrophy), 03 (protein, lean retention) and 16 (sleep, stress, sex, age moderators):
 * the end-to-end targets of MODEL_SPEC §9.2 rows 03, 09 and 16. Longland 2016 is in `longland.ts` (it doubles as the O-2 control).
 *
 * Conventions
 *  - "RT at energy balance" studies are fed the model's own mean TDEE on the study schedule (`fixtures/programs.atModelTee`), i.e.
 *    e = 0 as review item m21 demands ("validation fixture must set energy to model TEE"; fixture fix 2026-09-30: 100 % of the
 *    'current' maintenance is the maintenance at HABITUAL activity, ≈ 12 % below balance once the study's sessions are added);
 *    deficit studies use % of baseline maintenance or absolute kcal.
 *  - Lean mass rows use `leanTissue` (protein-based lean tissue incl. its bound water, the quantity the muscle/composition modules
 *    own); DXA-lean studies with short durations also see glycogen and water, which the dossiers note explicitly (`leanMass` is used
 *    where the dossier compares DXA lean directly).
 *  - Every row names its dossier source; assumed bodies and session plans are in each scenario's `notes`.
 */
import { person, personWithTdee, tdee0Of, type PersonaSpec } from '../fixtures/personas';
import {
  atModelTee,
  buildSchedule,
  cardioSession,
  constantSchedule,
  kcalProgram,
  neutralMacros,
  pctProgram,
  proteinPerKgMacros,
  rtSession,
  trainingSchedule,
} from '../fixtures/programs';
import { above, below, range, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { ArmSpec, Scenario } from '../harness/types';
import type { ArmView } from '../harness/view';
import type { EnergySpec, ExerciseSession, MacroSpec, PersonProfile, TrainingRegion } from '../../types';
import { TRAINING_REGIONS } from '../../types';
import { BRAY2012 } from './d01';
import { buildModelParams } from '../../core/paramsRegistry';
import { readMuscleConstants, type MuscleConstants } from '../../model/muscle/constants';
import { muscleModule, trainedGainsAtStart } from '../../model/muscle/index';
import type { AnyEngineModule } from '../../types/module';
import { fatLossKg } from './util';

const TRAINING = REQUIRES.TRAINING;

/** Energy balance at the model's own maintenance (e = 0). */
const AT_BALANCE: EnergySpec = { kind: 'pctMaintenance', pct: 100, reference: 'current' };
/** One moderate whole-body resistance session (09 §4.1 preset). */
const RT_MODERATE: ExerciseSession[] = [rtSession(17, { volume: 'moderate' })];

const NOVICE_SPEC: PersonaSpec = { sex: 'male', ageYears: 25, heightCm: 178, weightKg: 75, bodyFatPct: 20, sessionsPerWeek: 0 };

const macrosP = (gPerKg: number): MacroSpec => proteinPerKgMacros(gPerKg, 45);

/** Lean-tissue change after n days, kg. */
const dLean = (v: ArmView, n: number): number => v.delta('leanTissue', n);
/** Share of the tissue lost that is lean (−ΔLT / (−ΔLT − ΔFM)). */
const leanShare = (v: ArmView, from: number, to: number): number => {
  const dl = v.after('leanTissue', to) - v.after('leanTissue', from);
  const df = v.after('fatMass', to) - v.after('fatMass', from);
  return -dl / (-dl - df);
};

// =====================================================================================================================
// Dossier 09 §7
// =====================================================================================================================

// ---- #1 Benito 2020: FFM after RT (10.4 wk, 3.5 d/wk), untrained vs trained

const benitoArm = (profile: PersonProfile): ArmSpec => ({
  profile,
  schedule: atModelTee(profile, trainingSchedule({ days: 73, sessionsPerWeek: [3, 4], session: RT_MODERATE, energy: AT_BALANCE, macros: macrosP(1.4) })),
});

export const D09_1_BENITO: Scenario = {
  id: '09-1-benito-ffm-untrained-trained',
  dossier: '09',
  target: '#1',
  title: 'Benito 2020: fat-free-mass gain with resistance training at energy balance (10.4 wk, 3.5 d/wk)',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Benito et al. 2020 (dossier 09 ref [21]); dossier 09 §7 #1; review m21 (e = 0)',
  notes:
    'Healthy men 18-40 y: a 25-y man, 178 cm, 75 kg, 20 % BF. Untrained = training history none; trained = 1.27 years of training (TS₀ = 1 − e^(−0.47·1.27) = 0.45, the dossier\'s trained group; fixture fix 2026-09-30 — 1.7 y gave TS₀ 0.55). Energy at the model\'s own TDEE on the study schedule (e = 0, review m21), ' +
    'protein 1.4 g/kg (the 09 f_P calibration point), moderate whole-body sessions on alternating 3/4 days per week (3.5 d/wk), 73 days (10.4 wk). Published FFM change +1.54 untrained, +0.98 trained; tolerance ±0.4 kg.',
  arms: {
    untrained: benitoArm(person({ ...NOVICE_SPEC, trainingHistory: 'none' })),
    trained: benitoArm(person({ ...NOVICE_SPEC, trainingYears: 1.27, trainingHistory: '1to3y' })),
  },
  expectations: [
    { id: 'untrained', label: 'untrained: lean-tissue change after 10.4 wk (+1.54 kg)', unit: 'kg', measure: (c) => dLean(c.arm('untrained'), 73), check: val(1.54, 0.4), source: 'dossier 09 #1 (±0.4 kg)' },
    { id: 'trained', label: 'trained (TS₀ 0.45): lean-tissue change after 10.4 wk (+0.98 kg)', unit: 'kg', measure: (c) => dLean(c.arm('trained'), 73), check: val(0.98, 0.4), source: 'dossier 09 #1 (±0.4 kg)' },
  ],
};

// ---- #2 Morton 2018 and 03 §7 #4: protein and RT-induced FFM

const MORTON_PERSON = person({ ...NOVICE_SPEC, trainingHistory: 'none' });
const mortonArm = (gPerKg: number, days: number): ArmSpec => ({
  profile: MORTON_PERSON,
  schedule: atModelTee(MORTON_PERSON, trainingSchedule({ days, sessionsPerWeek: 3, session: RT_MODERATE, energy: AT_BALANCE, macros: macrosP(gPerKg) })),
});

export const D09_2_MORTON: Scenario = {
  id: '09-2-morton-protein-supplement',
  dossier: '09',
  target: '#2',
  title: 'Morton 2018: 13 wk of RT with protein 1.4 g/kg vs +0.4 g/kg (ratio 1.27)',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Morton et al. 2018 Br J Sports Med (dossier 09 ref [22]); dossier 09 §7 #2',
  notes:
    'Young untrained man (25 y, 178 cm, 75 kg, 20 % BF), 3 moderate sessions/wk for 13 wk at e = 0, control 1.4 g/kg vs supplemented 1.8 g/kg. Rows: ratio of supplemented to control FFM gain 1.27 ± 0.15; RT alone FFM +1.1 ± 1.2 kg ' +
    '(Q: the dossier notes the young-man model gives 1.60 kg, above the mixed-population mean of the meta-analysis).',
  arms: { control: mortonArm(1.4, 91), supplement: mortonArm(1.8, 91) },
  expectations: [
    { id: 'ratio', label: 'FFM gain ratio, supplemented / control (1.27)', unit: 'ratio', measure: (c) => dLean(c.arm('supplement'), 91) / dLean(c.arm('control'), 91), check: val(1.27, 0.15), source: 'dossier 09 #2 (ratio ±0.15)' },
    { id: 'alone', label: 'RT alone: FFM change after 13 wk (+1.1 ± 1.2 kg)', unit: 'kg', measure: (c) => dLean(c.arm('control'), 91), check: val(1.1, 1.2), gate: 'Q', source: 'dossier 09 #2', note: 'Study SD used as the Q band.' },
  ],
};

export const D03_4_MORTON: Scenario = {
  id: '03-4-morton-plateau',
  dossier: '03',
  target: '#4',
  title: 'Morton 2018 (dossier 03): FFM added by protein 1.2 → 1.6 g/kg, none from 1.6 → 2.4',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Morton et al. 2018 (dossier 03 ref [1]); dossier 03 §7 #4',
  notes: 'Same person and RT as 09 #2, 12 wk at e = 0, protein 1.2 / 1.6 / 2.4 g/kg. Added FFM 0.1-0.5 kg from 1.2 → 1.6; additional gain from 1.6 → 2.4 below 0.15 kg.',
  arms: { p12: mortonArm(1.2, 84), p16: mortonArm(1.6, 84), p24: mortonArm(2.4, 84) },
  expectations: [
    { id: 'added', label: 'FFM added by raising protein 1.2 → 1.6 g/kg (0.1-0.5 kg)', unit: 'kg', measure: (c) => dLean(c.arm('p16'), 84) - dLean(c.arm('p12'), 84), check: range(0.1, 0.5), source: 'dossier 03 #4' },
    { id: 'plateau', label: 'additional FFM from 1.6 → 2.4 g/kg (< 0.15 kg)', unit: 'kg', measure: (c) => dLean(c.arm('p24'), 84) - dLean(c.arm('p16'), 84), check: below(0.15), source: 'dossier 03 #4' },
  ],
};

// ---- #3 Peterson 2011: older adults

const PETERSON = person({ sex: 'male', ageYears: 65.5, heightCm: 170, weightKg: 80, extra: { sexUnspecified: true } });
const allRegions = (sets: number): Partial<Record<TrainingRegion, number>> => Object.fromEntries(TRAINING_REGIONS.map((r) => [r, sets])) as Partial<Record<TrainingRegion, number>>;

export const D09_3_PETERSON: Scenario = {
  id: '09-3-peterson-older-adults',
  dossier: '09',
  target: '#3',
  title: 'Peterson 2011: lean-body-mass gain in adults ≥ 50 y (mean 65.5 y), 20.5 wk, 2.8 d/wk',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Peterson et al. 2011 (dossier 09 ref [24]); dossier 09 §7 #3',
  notes:
    'Mixed sex, mean age 65.5 y: a sex-unspecified 65.5-y adult, 170 cm, 80 kg. 20.5 wk (144 d), 2.75 sessions/wk (3,3,3,2 cycle), 2.9 hard sets per region per session ≈ V = 8 effective sets/wk (the dossier model run: V 8, P 1.1 g/kg), ' +
    'protein 1.1 g/kg, e = 0. LBM +1.1 kg (0.9-1.2), tolerance ±0.4 kg.',
  arms: {
    main: {
      profile: PETERSON,
      schedule: atModelTee(PETERSON, trainingSchedule({ days: 144, sessionsPerWeek: [3, 3, 3, 2], session: [rtSession(17, { setsByRegion: allRegions(2.9), loadPct1RM: 75 })], energy: AT_BALANCE, macros: macrosP(1.1) })),
    },
  },
  expectations: [{ id: 'lbm', label: 'lean-tissue change after 20.5 wk (+1.1 kg)', unit: 'kg', measure: (c) => dLean(c.main, 144), check: val(1.1, 0.4), source: 'dossier 09 #3 (±0.4 kg)' }],
};

// ---- #4 Murphy & Koehler 2022: RT with vs without a deficit

const MK_DEFICITS = [0, 250, 500, 750, 1000] as const;
const mkProfile = person({ ...NOVICE_SPEC, trainingHistory: 'none' });
const mkT = tdee0Of(mkProfile);
const mkArms: Record<string, ArmSpec> = Object.fromEntries(
  MK_DEFICITS.map((d) => [
    `d${d}`,
    { profile: mkProfile, schedule: trainingSchedule({ days: 84, sessionsPerWeek: 3, session: RT_MODERATE, energy: { kind: 'kcal', kcal: Math.round(mkT - d) }, macros: macrosP(1.6) }) } satisfies ArmSpec,
  ]),
);

/** Deficit (kcal/d) at which the 12-wk lean change crosses zero, linear interpolation across the arms; clamped to [0, 1000]. */
function zeroCrossing(c: { arm: (id?: string) => ArmView }): number {
  const y = MK_DEFICITS.map((d) => dLean(c.arm(`d${d}`), 84));
  for (let i = 1; i < y.length; i++) {
    if (y[i - 1]! >= 0 && y[i]! < 0) return MK_DEFICITS[i - 1]! + ((MK_DEFICITS[i]! - MK_DEFICITS[i - 1]!) * y[i - 1]!) / (y[i - 1]! - y[i]!);
  }
  return y[0]! < 0 ? 0 : 1000;
}

export const D09_4_MURPHY: Scenario = {
  id: '09-4-murphy-koehler-deficit',
  dossier: '09',
  target: '#4',
  title: 'Murphy & Koehler 2022: net lean change of 12 wk of RT at 0-1 000 kcal/d deficit',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Murphy & Koehler 2022 (dossier 09 ref [42]); dossier 09 §7 #4; MODEL_SPEC_DECISIONS M13 (Murphy zero-crossing re-verification)',
  notes:
    'Young novice man (25 y, 178 cm, 75 kg), 3 moderate sessions/wk for 12 wk, protein 1.6 g/kg, energy = engine baseline maintenance − {0, 250, 500, 750, 1 000} kcal/d (absolute). Published: effect size −0.031 per 100 kcal/d, zero at ≈ 500 kcal/d; ' +
    'the dossier model gives +1.44 / +0.83 / +0.22 / −0.41 / −0.58 kg and a zero crossing of 500-700 kcal/d (tolerance). The zero crossing is linearly interpolated between arms. The orchestrator carries "lower ρ_max to 0.5 if needed" as a calibration item for this row.',
  arms: mkArms,
  expectations: [
    { id: 'zero', label: 'deficit at which the 12-wk lean change crosses zero (500-700 kcal/d)', unit: 'kcal/d', measure: (c) => zeroCrossing(c), check: range(500, 700), source: 'dossier 09 #4 (zero-crossing 500-700 kcal/d)' },
    { id: 'monotone', label: 'lean change falls with the deficit (0 → 1 000 kcal/d, must be < 0)', unit: 'kg', measure: (c) => dLean(c.arm('d1000'), 84) - dLean(c.arm('d0'), 84), check: below(0), source: 'dossier 09 #4 (ΔES −0.031 per 100 kcal/d)' },
    { id: 'gainAt0', label: 'no deficit: net lean change (+1.44 kg model; positive gain)', unit: 'kg', measure: (c) => dLean(c.arm('d0'), 84), check: above(0), gate: 'Q', source: 'dossier 09 #4 (model +1.44)' },
  ],
};

// ---- #6 Garthe 2011: slow vs fast loss in elite athletes

const GARTHE = person({ sex: 'male', ageYears: 24, heightCm: 178, weightKg: 73, bodyFatPct: 14, trainingYears: 5, trainingHistory: 'gt3y' });
const garthe = (pct: number, days: number): ArmSpec => ({
  profile: GARTHE,
  schedule: trainingSchedule({ days, sessionsPerWeek: 4, session: RT_MODERATE, energy: { kind: 'pctMaintenance', pct }, macros: macrosP(1.8) }),
});

export const D09_6_GARTHE: Scenario = {
  id: '09-6-garthe-slow-vs-fast',
  dossier: '09',
  target: '#6 (03 Garthe)',
  title: 'Garthe 2011: elite athletes, −19 % energy for 8.5 wk vs −30 % for 5.3 wk (both −5.5 % BW)',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Garthe et al. 2011 Int J Sport Nutr Exerc Metab (dossier 09 ref [52], dossier 03 ref [21]); dossier 09 §7 #6',
  notes:
    '24 elite athletes, 4 RT/wk: a 24-y trained man (73 kg, 14 % BF per the dossier 03 model row, 5 y of training), protein 1.8 g/kg (dossier 03 assumption), 81 % vs 70 % of maintenance for 60 d (8.5 wk) vs 37 d (5.3 wk). ' +
    'Study: LBM +2.1 ± 0.4 % (slow) vs −0.2 ± 0.7 % (fast). Per §9.2 the magnitudes are K ("Longland/Garthe magnitudes K"); the direction (slow > fast) is gated.',
  arms: { slow: garthe(81, 60), fast: garthe(70, 37) },
  expectations: [
    { id: 'direction', label: 'slow loss gains more lean than fast loss (percentage points, > 0)', unit: '% points', measure: (c) => (100 * dLean(c.arm('slow'), 60)) / c.arm('slow').initial('leanTissue') - (100 * dLean(c.arm('fast'), 37)) / c.arm('fast').initial('leanTissue'), check: above(0), source: 'dossier 09 #6 (direction)' },
    { id: 'slow', label: 'slow arm: lean change (+2.1 %)', unit: '%', measure: (c) => (100 * dLean(c.arm('slow'), 60)) / c.arm('slow').initial('leanTissue'), check: val(2.1, 0.4), gate: 'K', source: 'dossier 09 #6 (SR under-predicted, −1.4 points)' },
    { id: 'fast', label: 'fast arm: lean change (−0.2 %)', unit: '%', measure: (c) => (100 * dLean(c.arm('fast'), 37)) / c.arm('fast').initial('leanTissue'), check: val(-0.2, 0.7), gate: 'M' /* promoted from K at integration 2026-09-30: inside its band */, source: 'dossier 09 #6 (FR pass; §9.2 lists Garthe magnitudes K)' },
  ],
};

// ---- #7 Villareal 2017: RT vs aerobic in obese older adults

const VILLAREAL = person({ sex: 'female', ageYears: 70, heightCm: 162, weightKg: 95 });
const vilT = tdee0Of(VILLAREAL);
const villareal = (session: ExerciseSession[]): ArmSpec => ({
  profile: VILLAREAL,
  schedule: trainingSchedule({ days: 182, sessionsPerWeek: 3, session, energy: { kind: 'kcal', kcal: Math.round(vilT - 500) }, macros: macrosP(1.0) }),
});

export const D09_7_VILLAREAL: Scenario = {
  id: '09-7-villareal-rt-vs-aerobic',
  dossier: '09',
  target: '#7',
  title: 'Villareal 2017: obese older adults, 6 months of diet + resistance vs diet + aerobic training',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Villareal et al. 2017 N Engl J Med (dossier 09 ref [59]); dossier 09 §7 #7',
  notes:
    '160 obese older adults (BMI ≈ 37, ~70 y): a 70-y woman, 162 cm, 95 kg; both arms at baseline maintenance − 500 kcal/d for 26 wk, protein 1.0 g/kg; RT arm 3 moderate sessions/wk, aerobic arm 3 × 60-min moderate cardio/wk ' +
    '(the trials matched −9 % BW; here the energy prescription is common, so the weight-loss totals differ slightly). Published lean change −1.0 kg (RT) vs −2.7 kg (aerobic), ±0.8 kg absolute; ratio RT/aerobic 0.37 (0.3 in the model) is Q (no tolerance).',
  arms: { rt: villareal(RT_MODERATE), aerobic: villareal([cardioSession('walk', 17, 60)]) },
  expectations: [
    // the trial measured DXA lean mass: compared with `leanMass` (DXA-equivalent; fixture fix 2026-09-30, formerly `leanTissue`)
    { id: 'rt', label: 'RT arm: DXA lean-mass change after 6 mo (−1.0 kg)', unit: 'kg', measure: (c) => c.arm('rt').delta('leanMass', 182), check: val(-1.0, 0.8), source: 'dossier 09 #7 (±0.8 kg)' },
    { id: 'aerobic', label: 'aerobic arm: DXA lean-mass change after 6 mo (−2.7 kg)', unit: 'kg', measure: (c) => c.arm('aerobic').delta('leanMass', 182), check: val(-2.7, 0.8), source: 'dossier 09 #7 (±0.8 kg)' },
    { id: 'ratio', label: 'lean loss ratio RT / aerobic (0.37)', unit: 'ratio', measure: (c) => c.arm('rt').delta('leanMass', 182) / c.arm('aerobic').delta('leanMass', 182), check: val(0.37, 0.15), gate: 'Q', source: 'dossier 09 #7 (pass on ratio 0.3 vs 0.37)', note: 'No tolerance given; ±0.15 assumed.' },
    { id: 'order', label: 'RT loses less lean than aerobic (direction)', unit: 'kg', measure: (c) => c.arm('rt').delta('leanMass', 182) - c.arm('aerobic').delta('leanMass', 182), check: above(0), source: 'dossier 09 #7' },
  ],
};

// ---- #8 Ballor & Poehlman 1994: FFM share of weight lost, diet vs diet + exercise

const BALLOR = person({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 100, bodyFatPct: 45 });
const ballT = tdee0Of(BALLOR);
const ballorArm = (withRt: boolean): ArmSpec => ({
  profile: BALLOR,
  schedule: trainingSchedule({ days: 90, sessionsPerWeek: withRt ? 3 : 0, session: RT_MODERATE, energy: { kind: 'kcal', kcal: Math.round(ballT - 750) }, macros: macrosP(1.0) }),
});

export const D09_8_BALLOR: Scenario = {
  id: '09-8-ballor-poehlman-ffm-share',
  dossier: '09',
  target: '#8',
  title: 'Ballor & Poehlman 1994: FFM share of weight lost, diet vs diet + exercise (≈ −10 kg)',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Ballor & Poehlman 1994 (dossier 09 ref [58]); dossier 09 §7 #8',
  notes:
    'Obese woman (Table A3-like: 40 y, 165 cm, 100 kg, 45 % BF), 90 d at baseline maintenance − 750 kcal/d (≈ −10 kg), protein 1.0 g/kg; the exercise arm adds 3 moderate resistance sessions/wk (the dossier maps the exercise arm to R_RT 0.75). ' +
    'FFM share = lean tissue lost / (lean + fat lost). Targets are the published ranges: 24-28 % (diet) vs 11-13 % (diet + exercise); the ranges are used as the tolerance.',
  arms: { diet: ballorArm(false), exercise: ballorArm(true) },
  expectations: [
    { id: 'diet', label: 'diet only: FFM share of the loss (24-28 %)', unit: '%', measure: (c) => 100 * leanShare(c.arm('diet'), 0, 90), check: range(24, 28), source: 'dossier 09 #8' },
    { id: 'exercise', label: 'diet + RT: FFM share of the loss (11-13 %)', unit: '%', measure: (c) => 100 * leanShare(c.arm('exercise'), 0, 90), check: range(11, 13), source: 'dossier 09 #8' },
    { id: 'ratio', label: 'FFM share with exercise is 0.25-0.5 of the diet-only share', unit: 'ratio', measure: (c) => leanShare(c.arm('exercise'), 0, 90) / leanShare(c.arm('diet'), 0, 90), check: range(0.25, 0.5), source: 'dossier 09 #8 (R_RT 0.75 → share ×0.25-0.5)' },
  ],
};

// ---- #9 Helms 2023: surplus does not change muscle gain in trained lifters

const HELMS = person({ sex: 'male', ageYears: 25, heightCm: 178, weightKg: 80, bodyFatPct: 15, trainingYears: 4, trainingHistory: 'gt3y' });
// energy relative to the model's TDEE with the 4 weekly sessions (the study's maintenance included the training; fixture fix
// 2026-09-30 — % of the baseline maintenance left the "maintenance" arm ≈ 6 % in deficit, body mass −1.3 kg)
const helmsArm = (pct: number): ArmSpec => {
  const sched = trainingSchedule({ days: 56, sessionsPerWeek: 4, session: RT_MODERATE, energy: { kind: 'pctMaintenance', pct: 100 }, macros: macrosP(1.8) });
  return { profile: HELMS, schedule: atModelTee(HELMS, sched, pct / 100) };
};

export const D09_9_HELMS: Scenario = {
  id: '09-9-helms-surplus',
  dossier: '09',
  target: '#9',
  title: 'Helms 2023: trained lifters, 8 wk at maintenance vs +5 % vs +15 %',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Helms et al. 2023 (dossier 09 ref [46]); dossier 09 §7 #9',
  notes:
    'Trained men: a 25-y man, 178 cm, 80 kg, 15 % BF, 4 y of training, 4 sessions/wk, protein 1.8 g/kg. Study: BM +0.4 / +3.3 / +3.3 kg; no muscle-thickness or squat differences. The dossier model gives FFM +0.81 / 0.83 / 0.86 kg (≤ 6 % difference): ' +
    'the difference in training-attributable muscle (`rtMuscleGain`; the study found no muscle-thickness difference, and lean tissue also carries 11\'s adipose lean of the extra fat stored) between +15 % and maintenance is checked to be ≤ 6 % of the maintenance gain plus 0.15 kg noise (assumed form of "≤ 6 %"); energy is % of the model\'s TDEE with the sessions; body-mass rows are Q (±1.0 kg assumed).',
  arms: { maintenance: helmsArm(100), plus5: helmsArm(105), plus15: helmsArm(115) },
  expectations: [
    { id: 'noSurplusEffect', label: 'training-attributable muscle gain at +15 % minus at maintenance (≈ 0)', unit: 'kg', measure: (c) => c.arm('plus15').delta('rtMuscleGain', 56) - c.arm('maintenance').delta('rtMuscleGain', 56), check: range(-0.15 - 0.06 * 0.85, 0.15 + 0.06 * 0.85), source: 'dossier 09 #9 (≤ 6 % difference)', note: 'Band = 0.15 kg + 6 % of the maintenance gain (assumed form).' },
    { id: 'bm0', label: 'maintenance: body-mass change (+0.4 kg)', unit: 'kg', measure: (c) => c.arm('maintenance').delta('scaleWeight', 56), check: val(0.4, 1.0), gate: 'Q', source: 'dossier 09 #9', note: 'No tolerance given; ±1.0 kg assumed.' },
    { id: 'bm5', label: '+5 %: body-mass change (+3.3 kg)', unit: 'kg', measure: (c) => c.arm('plus5').delta('scaleWeight', 56), check: val(3.3, 1.0), gate: 'Q', source: 'dossier 09 #9', note: 'No tolerance given; ±1.0 kg assumed.' },
    { id: 'bm15', label: '+15 %: body-mass change (+3.3 kg)', unit: 'kg', measure: (c) => c.arm('plus15').delta('scaleWeight', 56), check: val(3.3, 1.0), gate: 'Q', source: 'dossier 09 #9', note: 'No tolerance given; ±1.0 kg assumed.' },
  ],
};

// ---- #12 Ogasawara 2013 / Psilander 2019: breaks and detraining

const detrainArm = (offDays: number): ArmSpec => ({
  profile: person({ ...NOVICE_SPEC, trainingHistory: 'none' }),
  schedule: trainingSchedule({ days: 70 + offDays, sessionsPerWeek: 3, session: RT_MODERATE, energy: AT_BALANCE, macros: macrosP(1.6), trainUntilDay: 70 }),
});
/** R-DETRAIN: a long-term lifter (4 y, 3 RT sessions/wk habitually) who stops on day 0; no sessions for 20 weeks. */
const LIFTER_SPEC: PersonaSpec = { ...NOVICE_SPEC, bodyFatPct: 15, trainingYears: 4, trainingHistory: 'gt3y', sessionsPerWeek: 3, liftingCardioMix: 0 };
const lifterOffArm: ArmSpec = { profile: person(LIFTER_SPEC), schedule: constantSchedule(141, pctProgram('off', 100, macrosP(1.6), {}, 'current')) };
let muscleK: MuscleConstants | null = null;
/** Losable trained gains of the arm's person at t = 0 (MODEL_SPEC §1.9 R-DETRAIN: (1 − detrainFloorFrac) × trained gains), kg. */
const losableKg = (v: ArmView): number => {
  muscleK ??= readMuscleConstants(buildModelParams([muscleModule] as unknown as readonly AnyEngineModule[]), false, { emit: () => undefined });
  return trainedGainsAtStart(muscleK, v.profile).losableKg;
};

export const D09_12_OGASAWARA: Scenario = {
  id: '09-12-ogasawara-breaks-detraining',
  dossier: '09',
  target: '#12',
  title: 'Ogasawara 2013 / Psilander 2019: a 3-week break and 20 weeks of detraining after 10 wk of RT',
  level: 'I',
  gate: 'Q',
  requires: TRAINING,
  citation: 'Ogasawara et al. 2013, Psilander et al. 2019 (dossier 09 refs [65,66,67]); dossier 09 §7 #12',
  notes:
    'Novice man (25 y, 178 cm, 75 kg), 10 weeks of RT (3 sessions/wk) then no training for 3 or 20 weeks. Published: no loss after 3 weeks; muscle thickness back to baseline after 20 weeks. The dossier model gives −1 % (3 wk) and 82 % of the ' +
    'accrued muscle lost (20 wk). The dossier gives no numeric tolerance, so both rows are Q with assumed bands: 3-wk loss ≤ 3 % of the accrued gain; 20-wk remaining fraction 0.18 ± 0.2. ' +
    'Ruling R-DETRAIN (2026-10-01): detraining decays towards a floor that keeps detrainFloorFrac (0.5, grade C) of the long-term trained gains a habitual lifter carries at t = 0; gains accrued in the run (the novice arms) detrain fully, so the novice rows keep their literal target. ' +
    'The lifter arm (25 y, 178 cm, 75 kg, 15 % BF, 4 y, 3 RT sessions/wk, stops on day 0) re-expresses the target against the floor: 82 % ± 10 of the LOSABLE gains lost after 20 weeks, ≤ 3 % in the first 3 weeks (must-pass, tolerance of the ruling).',
  arms: { break3: detrainArm(21), off20: detrainArm(140), lifterOff: lifterOffArm },
  expectations: [
    { id: 'break3', label: 'training-attributable lean lost during 3 weeks off (% of the 10-wk gain, ≤ 3 %)', unit: '%', measure: (c) => (100 * (c.arm('break3').after('rtMuscleGain', 70) - c.arm('break3').after('rtMuscleGain', 91))) / c.arm('break3').after('rtMuscleGain', 70), check: range(-1, 3), source: 'dossier 09 #12 (no loss at 3 wk; model −1 %)' },
    { id: 'off20', label: 'training-attributable lean remaining after 20 weeks off (fraction of the 10-wk gain, 0.18)', unit: 'fraction', measure: (c) => c.arm('off20').after('rtMuscleGain', 210) / c.arm('off20').after('rtMuscleGain', 70), check: val(0.18, 0.2), source: 'dossier 09 #12 (20 wk: 82 % of M_acc lost)' },
    { id: 'lifter3', label: 'long-term lifter: share of the losable trained gains lost in the first 3 weeks off (≤ 3 %)', unit: 'fraction', gate: 'M', measure: (c) => -c.arm('lifterOff').after('rtMuscleGain', 21) / losableKg(c.arm('lifterOff')), check: range(-0.01, 0.03), source: 'dossier 09 #12 / §4.10 (3-wk breaks: no loss); MODEL_SPEC §1.9 R-DETRAIN' },
    { id: 'lifter20', label: 'long-term lifter: share of the losable trained gains lost after 20 weeks off (0.82 ± 0.10)', unit: 'fraction', gate: 'M', measure: (c) => -c.arm('lifterOff').after('rtMuscleGain', 140) / losableKg(c.arm('lifterOff')), check: val(0.82, 0.1), source: 'dossier 09 #12 re-expressed against the R-DETRAIN floor (MODEL_SPEC §1.9)' },
  ],
};

// ---- #13 Bickel 2011: maintenance dose

const BICKEL_FULL = allRegions(9);
const bickelArm = (age: number, dose: 'third' | 'ninth'): ArmSpec => {
  const profile = person({ ...NOVICE_SPEC, ageYears: age, trainingHistory: 'none' });
  const full = rtSession(17, { setsByRegion: BICKEL_FULL });
  // 1/3 dose = one session per week (frequency ÷ 3) of 9 sets per region; 1/9 dose = one session per week of 3 sets (frequency and volume ÷ 3)
  const reduced = rtSession(17, { setsByRegion: allRegions(dose === 'third' ? 9 : 3) });
  return {
    profile,
    schedule: buildSchedule({
      days: 16 * 7 + 32 * 7,
      programs: [pctProgram('full', 100, macrosP(1.6), { exercise: [full] }, 'current'), pctProgram('reduced', 100, macrosP(1.6), { exercise: [reduced] }, 'current'), pctProgram('rest', 100, macrosP(1.6), {}, 'current')],
      // phase 1 (16 wk): 3 sessions/wk (Mon/Wed/Fri); phase 2 (32 wk): one reduced session per week (Monday)
      use: (d) => {
        const wd = d % 7;
        if (d < 112) return [0, 2, 4].includes(wd) ? 0 : 2;
        return wd === 0 ? 1 : 2;
      },
    }),
  };
};

export const D09_13_BICKEL: Scenario = {
  id: '09-13-bickel-maintenance-dose',
  dossier: '09',
  target: '#13',
  title: 'Bickel 2011: 16 wk RT then 32 wk at 1/3 or 1/9 of the dose, young vs old',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Bickel et al. 2011 (dossier 09 ref [4]); dossier 09 §7 #13',
  notes:
    'Novice men aged 25 and 70 (178 cm, 75 kg). Phase 1: 3 sessions/wk × 9 hard sets per region (27 sets/wk) for 16 wk at e = 0. Phase 2 (32 wk): 1/3 dose = one session per week of 9 sets per region (9 sets/wk, frequency ÷ 3); 1/9 dose = one session per week of 3 sets per region ' +
    '(3 sets/wk, frequency and volume ÷ 3). Row: the gain at 48 wk as a fraction of the gain at 16 wk; "maintained" = ≥ 0.9 (assumed threshold; the dossier says "pass by construction": young V ≥ V_maint ⇒ no loss, old need ≥ 9 sets/wk).',
  arms: { young9: bickelArm(25, 'ninth'), old9: bickelArm(70, 'ninth'), old3: bickelArm(70, 'third') },
  expectations: [
    { id: 'young9', label: 'young at 1/9 dose: gain kept (48 wk / 16 wk, ≥ 0.9)', unit: 'fraction', measure: (c) => c.arm('young9').after('rtMuscleGain', 336) / c.arm('young9').after('rtMuscleGain', 112), check: above(0.9), source: 'dossier 09 #13 (hypertrophy maintained, young)' },
    { id: 'old3', label: 'old at 1/3 dose (9 sets/wk): gain kept (≥ 0.9)', unit: 'fraction', measure: (c) => c.arm('old3').after('rtMuscleGain', 336) / c.arm('old3').after('rtMuscleGain', 112), check: above(0.9), source: 'dossier 09 #13 (old need ≥ 9 sets/wk)' },
    { id: 'old9', label: 'old at 1/9 dose: gain lost (< 0.9)', unit: 'fraction', measure: (c) => c.arm('old9').after('rtMuscleGain', 336) / c.arm('old9').after('rtMuscleGain', 112), check: below(0.9), source: 'dossier 09 #13 (not maintained, old)' },
  ],
};

// ---- #14 McDonald / Aragon-Helms heuristics: 4 years of optimal training

const HEUR = person({ sex: 'male', ageYears: 22, heightCm: 178, weightKg: 72, bodyFatPct: 15 });

export const D09_14_HEURISTICS: Scenario = {
  id: '09-14-mcdonald-aragon-helms',
  dossier: '09',
  target: '#14',
  title: 'McDonald / Aragon-Helms heuristics: muscle gained in years 1-4 of optimal training (men)',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'McDonald, Aragon & Helms heuristics (dossier 09 ref [32], grade D); dossier 09 §7 #14',
  notes:
    'Novice man (22 y, 178 cm, 72 kg, 15 % BF), 4 years of dossier 09\'s "optimal" training (09 §4.9 table: V 20 effective sets per region per week, P ≥ 1.6 g/kg, e = +0.10): 4 sessions/wk of 5 hard sets per region at RIR 0, protein 1.8 g/kg, energy at 110 % of the model\'s TDEE with the sessions (fixture fix 2026-09-30: the former "high" preset at +5 % of the habitual-activity maintenance was ≈ 14 effective sets at e ≈ −0.04). Targets (kg of muscle gained per year): 9-11, 4.5-5.5, 2.3-2.7, 0.9-1.4; ' +
    'the recorded quantity is `rtMuscleGain` (training-attributable lean). Grade D targets: years 1-2 gate, years 3-4 are Q (the dossier model gives 1.9 and 0.8 kg, "slightly low"). 1 460-day run.',
  arms: {
    main: {
      profile: HEUR,
      schedule: atModelTee(HEUR, trainingSchedule({ days: 1460, sessionsPerWeek: 4, session: [rtSession(17, { setsByRegion: allRegions(5), rir: 0 })], energy: { kind: 'pctMaintenance', pct: 100 }, macros: macrosP(1.8) }), 1.1),
    },
  },
  expectations: [
    { id: 'y1', label: 'year 1 gain (9-11 kg)', unit: 'kg', measure: (c) => c.main.after('rtMuscleGain', 365), check: range(9, 11), source: 'dossier 09 #14' },
    { id: 'y2', label: 'year 2 gain (4.5-5.5 kg)', unit: 'kg', measure: (c) => c.main.after('rtMuscleGain', 730) - c.main.after('rtMuscleGain', 365), check: range(4.5, 5.5), source: 'dossier 09 #14' },
    { id: 'y3', label: 'year 3 gain (2.3-2.7 kg)', unit: 'kg', measure: (c) => c.main.after('rtMuscleGain', 1095) - c.main.after('rtMuscleGain', 730), check: range(2.3, 2.7), gate: 'Q', source: 'dossier 09 #14 (grade D; model 1.9)' },
    { id: 'y4', label: 'year 4 gain (0.9-1.4 kg)', unit: 'kg', measure: (c) => c.main.after('rtMuscleGain', 1460) - c.main.after('rtMuscleGain', 1095), check: range(0.9, 1.4), gate: 'Q', source: 'dossier 09 #14 (grade D; model 0.8)' },
  ],
};

// ---- strength after R-STR

export const D09_STRENGTH: Scenario = {
  id: '09-R-STR-novice-strength-12wk',
  dossier: '09',
  target: '§1.9 strength',
  title: 'Novice strength gain after 12 weeks of RT (19-27 %, +3 after R-STR)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Dossier 09 §4.14 novice check; MODEL_SPEC §1.9 ruling R-STR; §9.2 row 09',
  notes:
    'Novice man (25 y, 178 cm, 75 kg), 3 moderate sessions/wk for 12 weeks at e = 0, protein 1.6 g/kg. The strength index is 100·(1 + N)·(M/M0)·(1 − fatigue)·M_EA (100 = baseline): +19-27 % published, tolerance +3 on both ends (spec: "19-27 % (+3)"). FULL because the wellbeing module supplies M_EA.',
  arms: { main: mortonArm(1.6, 84) },
  expectations: [{ id: 'strength', label: 'strength index change after 12 wk (19-27 %, ±3)', unit: '%', measure: (c) => c.main.after('strength', 84) - 100, check: range(16, 30), source: 'MODEL_SPEC §9.2 (09): 19-27 % (+3)' }],
};

// =====================================================================================================================
// Dossier 03 §7 (Longland is in longland.ts; Templeman lean adults is 20-V9)
// =====================================================================================================================

// ---- #2 Mettler 2010

const METTLER = person({ sex: 'male', ageYears: 24, heightCm: 180, weightKg: 80, bodyFatPct: 15, trainingYears: 3, trainingHistory: '1to3y' });
const mettlerArm = (gPerKg: number, carbPct: number): ArmSpec => ({
  profile: METTLER,
  schedule: trainingSchedule({ days: 14, sessionsPerWeek: 4, session: RT_MODERATE, energy: { kind: 'pctMaintenance', pct: 60 }, macros: proteinPerKgMacros(gPerKg, carbPct) }),
});

export const D03_2_METTLER: Scenario = {
  id: '03-2-mettler-protein-in-deficit',
  dossier: '03',
  target: '#2',
  title: 'Mettler 2010: RT-trained athletes, 60 % of energy for 2 wk, 1.0 vs 2.3 g/kg protein',
  level: 'I',
  gate: 'M',
  requires: TRAINING,
  citation: 'Mettler et al. 2010 Med Sci Sports Exerc (dossier 03 ref [9]); dossier 03 §7 #2',
  notes:
    '20 RT-trained athletes: an 80-kg, 15 % BF man (dossier 03 model-row body; 24 y, 180 cm), 4 usual RT sessions/wk, 60 % of maintenance for 14 d, protein ≈ 1.0 (15 %E) vs ≈ 2.3 (35 %E) g/kg, carbohydrate 50 vs 30 %E. ' +
    'Study LBM −1.6 vs −0.3 kg, BW −3.0 vs −1.5 kg. Target (tissue + glycogen water): LBM loss ratio HP/CP ≤ 0.5; absolute DXA-like LBM loss within ±0.6 kg (`leanMass`).',
  arms: { cp: mettlerArm(1.0, 50), hp: mettlerArm(2.3, 30) },
  expectations: [
    { id: 'ratio', label: 'LBM loss ratio, high protein / control (≤ 0.5)', unit: 'ratio', measure: (c) => c.arm('hp').delta('leanMass', 14) / c.arm('cp').delta('leanMass', 14), check: below(0.5), source: 'dossier 03 #2 (ratio ≤ 0.5)' },
    { id: 'cp', label: 'control protein: DXA-like LBM change (−1.6 kg)', unit: 'kg', measure: (c) => c.arm('cp').delta('leanMass', 14), check: val(-1.6, 0.6), source: 'dossier 03 #2 (±0.6 kg)' },
    { id: 'hp', label: 'high protein: DXA-like LBM change (−0.3 kg)', unit: 'kg', measure: (c) => c.arm('hp').delta('leanMass', 14), check: val(-0.3, 0.6), source: 'dossier 03 #2 (±0.6 kg)' },
  ],
};

// ---- Pasiakos 2013 (directions, dossier 03 §4.4.1)

const PASIAKOS = person({ sex: 'male', ageYears: 24, heightCm: 178, weightKg: 78, bodyFatPct: 20 });
const pasiakosArm = (gPerKg: number): ArmSpec => ({
  profile: PASIAKOS,
  schedule: buildSchedule({
    days: 31,
    // −40 % = 30 % less than the habitual intake + 10 % more expenditure (R-MAINT: % of the habitual-activity maintenance)
    programs: [pctProgram('maintain', 100, macrosP(gPerKg), {}, undefined, 'habitual'), pctProgram('deficit', 70, macrosP(gPerKg), { exercise: [cardioSession('other', 17, 60, { met: 6 })] }, undefined, 'habitual')],
    use: (d) => (d < 10 ? 0 : 1),
  }),
});

export const D03_PASIAKOS: Scenario = {
  id: '03-pasiakos-2013-protein-in-deficit',
  dossier: '03',
  target: '§4.4.1 Pasiakos',
  title: 'Pasiakos 2013: 10 d maintenance then 21 d at −40 % (30 % diet + 10 % exercise), protein 0.8 / 1.6 / 2.4 g/kg',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.CORE,
  citation: 'Pasiakos et al. 2013 FASEB J (dossier 03 ref [8]); dossier 03 §4.4.1 and §4.4.2 model table (direction rows: "Mettler/Pasiakos directions")',
  notes:
    '39 adults; 78 kg, 20 % BF man (dossier 03 model-row body), 10 d at maintenance then 21 d at 70 % of maintenance plus a 60-min daily moderate cardio session at 6 MET (≈ 10 % of energy; assumed form of "10 % exercise"). Study: BW −3.2 kg in all arms, ' +
    'proportion of loss as FFM lower and fat loss higher with 1.6 and 2.4 than 0.8, and 2.4 ≈ 1.6 (exact values unverified in the dossier → direction rows only).',
  arms: { rda: pasiakosArm(0.8), x2: pasiakosArm(1.6), x3: pasiakosArm(2.4) },
  expectations: [
    { id: 'shareOrder', label: 'lean share of the loss: 0.8 g/kg > 1.6 g/kg (share difference, > 0)', unit: 'fraction', measure: (c) => leanShare(c.arm('rda'), 10, 31) - leanShare(c.arm('x2'), 10, 31), check: above(0), source: 'dossier 03 §4.4.1 Pasiakos (direction)' },
    { id: 'sameLoss', label: 'body-weight loss is similar in all arms (0.8 vs 2.4 g/kg difference within ±1 kg; study −3.2 kg each)', unit: 'kg', measure: (c) => (c.arm('rda').after('scaleWeight', 31) - c.arm('rda').after('scaleWeight', 10)) - (c.arm('x3').after('scaleWeight', 31) - c.arm('x3').after('scaleWeight', 10)), check: range(-1, 1), gate: 'Q', source: 'dossier 03 §4.4.1 Pasiakos', note: 'Band ±1 kg assumed.' },
    { id: 'plateau', label: '2.4 ≈ 1.6 g/kg: lean-share difference within ±0.05', unit: 'fraction', measure: (c) => leanShare(c.arm('x3'), 10, 31) - leanShare(c.arm('x2'), 10, 31), check: range(-0.05, 0.05), gate: 'Q', source: 'dossier 03 §4.4.1 Pasiakos', note: 'Band ±0.05 assumed.' },
  ],
};

// ---- #3 Bray 2012 lean and fat rows with the dossier 03 tolerances (arms of 01-7.7d)

export const D03_3_BRAY: Scenario = {
  id: '03-3-bray-2012-lean',
  dossier: '03',
  target: '#3',
  title: 'Bray 2012 (dossier 03 tolerances): lean and fat change with 5 / 15 / 25 % protein overfeeding',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.CORE,
  citation: 'Bray et al. 2012 JAMA 307:47 (dossier 03 ref [92]); dossier 03 §7 #3',
  notes: 'Arms of 01-7.7d (26-y man, +954 kcal/d for 8 wk, fat 40 %E). Observed LBM −0.70 / +2.87 / +3.18 kg, FM +3.66 / +3.45 / +3.44 kg. Target: each arm within ±0.8 kg lean; fat gain independent of protein (±0.5 kg).',
  arms: BRAY2012.arms,
  expectations: [
    { id: 'leanLow', label: '5 % protein: lean change (−0.70 kg)', unit: 'kg', measure: (c) => c.arm('low').delta('leanMass', 56), check: val(-0.7, 0.8), source: 'dossier 03 #3 (±0.8 kg)' },
    { id: 'leanNormal', label: '15 % protein: lean change (+2.87 kg)', unit: 'kg', measure: (c) => c.arm('normal').delta('leanMass', 56), check: val(2.87, 0.8), source: 'dossier 03 #3 (±0.8 kg)' },
    { id: 'leanHigh', label: '25 % protein: lean change (+3.18 kg)', unit: 'kg', measure: (c) => c.arm('high').delta('leanMass', 56), check: val(3.18, 0.8), source: 'dossier 03 #3 (±0.8 kg)' },
    { id: 'fatIndependent', label: 'fat gain independent of protein: 25 % minus 5 % arm (0 ± 0.5 kg)', unit: 'kg', measure: (c) => c.arm('high').delta('fatMass', 56) - c.arm('low').delta('fatMass', 56), check: val(0, 0.5), source: 'dossier 03 #3 (±0.5 kg)' },
  ],
};

// ---- #7 Hoffer 1984: VLED nitrogen balance

const HOFFER = person({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 100, bodyFatPct: 45 });
const IBW = 57.2; // 21 kg/m² at 165 cm
const hofferArm = (gPerKgIbw: number): ArmSpec => ({
  profile: HOFFER,
  schedule: buildSchedule({ days: 35, programs: [kcalProgram(`vled${gPerKgIbw}`, 500, { protein: { unit: 'g', value: gPerKgIbw * IBW }, carbs: { unit: 'remainder' }, fat: { unit: 'g', value: 0 } })], use: 0 }),
});

export const D03_7_HOFFER: Scenario = {
  id: '03-7-hoffer-vled-nitrogen',
  dossier: '03',
  target: '#7',
  title: 'Hoffer 1984: 500 kcal/d diets in obese women, 1.5 vs 0.8 g protein per kg ideal weight, nitrogen balance',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FASTING,
  citation: 'Hoffer et al. 1984 (dossier 03 ref [84]); dossier 03 §7 #7',
  notes: 'Obese woman (100 kg, 45 % BF, 165 cm, ideal weight 57.2 kg at BMI 21); 500 kcal/d for 5 weeks: protein 1.5 or 0.8 g/kg IBW (86 g / 46 g), carbohydrate the rest, no fat. N balance ≈ 0 by week 3 (HP) vs −2 g N/d (LP), ±1 g N/d; difference ≈ 2.',
  arms: { hp: hofferArm(1.5), lp: hofferArm(0.8) },
  expectations: [
    { id: 'hp', label: 'high protein: N balance in week 3 (≈ 0 g N/d)', unit: 'g N/d', measure: (c) => c.arm('hp').mean('nitrogenBalance', 14, 21), check: val(0, 1), source: 'dossier 03 #7 (±1 g N/d)' },
    { id: 'lp', label: 'low protein: N balance in week 3 (−2 g N/d)', unit: 'g N/d', measure: (c) => c.arm('lp').mean('nitrogenBalance', 14, 21), check: val(-2, 1), source: 'dossier 03 #7 (±1 g N/d)' },
    { id: 'diff', label: 'N-balance difference HP − LP (≈ 2 g N/d)', unit: 'g N/d', measure: (c) => c.arm('hp').mean('nitrogenBalance', 14, 21) - c.arm('lp').mean('nitrogenBalance', 14, 21), check: val(2, 1), source: 'dossier 03 #7' },
  ],
};

// ---- #8 Wycherley 2012 / Krieger 2006 / Kim 2016

const WYCH = person({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 100, bodyFatPct: 45 });
const wychT = tdee0Of(WYCH);
const wychArm = (gPerKg: number): ArmSpec => ({ profile: WYCH, schedule: constantSchedule(84, kcalProgram(`p${gPerKg}`, Math.round(wychT - 750), macrosP(gPerKg))) });

export const D03_8_WYCHERLEY: Scenario = {
  id: '03-8-wycherley-high-vs-standard-protein',
  dossier: '03',
  target: '#8',
  title: 'Wycherley 2012 / Krieger 2006 / Kim 2016: isocaloric restriction, high vs standard protein, 12 wk',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.CORE,
  citation: 'Wycherley et al. 2012, Krieger 2006, Kim 2016 (dossier 03 refs [12-14]); dossier 03 §7 #8',
  notes: 'Obese woman (100 kg, 45 % BF), 12 weeks at baseline maintenance − 750 kcal/d (an 8-10 kg loss), protein 1.6 (high) vs 0.8 (standard) g/kg. Target: simulated HP − SP FFM difference 0.3-0.9 kg (published +0.43 / +0.60 / +0.45-0.83 kg).',
  arms: { hp: wychArm(1.6), sp: wychArm(0.8) },
  expectations: [
    { id: 'ffmDiff', label: 'FFM retained by high protein (HP − SP lean-tissue change, 0.3-0.9 kg)', unit: 'kg', measure: (c) => dLean(c.arm('hp'), 84) - dLean(c.arm('sp'), 84), check: range(0.3, 0.9), source: 'dossier 03 #8' },
    { id: 'loss', label: 'weight lost is 8-10 kg (SP arm)', unit: 'kg', measure: (c) => -c.arm('sp').delta('scaleWeight', 84), check: range(6, 12), gate: 'Q', source: 'dossier 03 #8 ("for an 8-10 kg loss")', note: 'Band widened by ±2 kg for the fixed energy prescription.' },
    { id: 'fatDiff', label: 'fat loss difference HP − SP is small (published −0.87 kg fat with high protein: HP loses ≥ 0 more)', unit: 'kg', measure: (c) => fatLossKg(c.arm('hp'), 84) - fatLossKg(c.arm('sp'), 84), check: above(-0.5), gate: 'Q', source: 'dossier 03 #8 (fat mass −0.87 kg)' },
  ],
};

// =====================================================================================================================
// Dossier 16 §7
// =====================================================================================================================

/** Sleep of `hours` ending at the habitual wake time (07:00), so bed time and duration are consistent. */
const sleepOf = (hours: number, quality: 'poor' | 'fair' | 'good' = 'good') => ({ bedH: (7 - hours + 24) % 24, wakeH: 7, hours, quality });

// ---- V1 Nedeltcheva 2010

const NEDELTCHEVA = personWithTdee({ sex: 'male', ageYears: 41, heightCm: 175, weightKg: 84 }, 2137).profile; // BMI 27.4; baseline TEE 2 137 kcal/d
const nedelArm = (hours: number): ArmSpec => ({
  profile: NEDELTCHEVA,
  schedule: buildSchedule({ days: 14, programs: [kcalProgram(`sleep${hours}`, 1450, neutralMacros('male'), { sleep: sleepOf(hours) })], use: 0 }),
});

export const D16_V1_NEDELTCHEVA: Scenario = {
  id: '16-V1-nedeltcheva-sleep-restriction',
  dossier: '16',
  target: 'V1',
  title: 'Nedeltcheva 2010: 14 d at 90 % of RMR with 7.4 h vs 5.2 h of sleep (fat share of loss falls)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Nedeltcheva et al. 2010 Ann Intern Med 153:435 (dossier 16 ref [1]); dossier 16 §7 V1',
  notes:
    '10 adults (3 F), age 41, BMI 27.4: a 41-y man, 175 cm, 84 kg with the step count solved so the engine TDEE0 = 2 137 kcal/d. 14 d at 1 450 kcal/d (90 % of RMR) with sleep 7.4 h (time in bed 8.5 h) vs 5.2 h (5.5 h). Study: fat lost 1.4 vs 0.6 kg, FFM lost 1.5 vs 2.4 kg, fat share 56 % vs 25 %, hunger +0.8 cm VAS. ' +
    'Engine test (dossier 16): the fat share of the loss must fall with short sleep; central shift −18 points (k_P 0.04) with the upper band edge −28 points and the lower edge no effect, so the accepted shift is −28 to 0 points and strictly negative in direction. ' +
    'Hunger ≈ +9 VAS points (±100 %) is Q. The sleep durations are the actual sleep hours (`SleepSpec.hours`).',
  arms: { normal: nedelArm(7.4), short: nedelArm(5.2) },
  expectations: [
    { id: 'direction', label: 'fat share of loss, short sleep minus normal sleep (< 0)', unit: '% points', measure: (c) => 100 * (fatShare(c.arm('short'), 14) - fatShare(c.arm('normal'), 14)), check: below(0), source: 'dossier 16 V1 (direction must match)' },
    { id: 'shift', label: 'shift in the fat share of loss (−28 … 0 points; central −18)', unit: '% points', measure: (c) => 100 * (fatShare(c.arm('short'), 14) - fatShare(c.arm('normal'), 14)), check: range(-28, 0), source: 'dossier 16 V1 (central −18, upper edge −28, lower edge 0)' },
    { id: 'hunger', label: 'hunger, short − normal sleep (≈ +9 VAS points, ±100 %)', unit: 'index points', measure: (c) => c.arm('short').mean('hunger', 7, 14) - c.arm('normal').mean('hunger', 7, 14), check: range(0, 18), gate: 'Q', source: 'dossier 16 V1', note: 'The VAS scale length is unverified in the dossier.' },
  ],
};

/** Fat share of the tissue lost over the first n days: ΔFM / (ΔFM + ΔLT). */
function fatShare(v: ArmView, n: number): number {
  const df = v.initial('fatMass') - v.after('fatMass', n);
  const dl = v.initial('leanTissue') - v.after('leanTissue', n);
  return df / (df + dl);
}

// ---- V2 Wang 2018

const WANG = person({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 90 }); // BMI 33
const wangArm = (hours: number): ArmSpec => ({ profile: WANG, schedule: buildSchedule({ days: 56, programs: [pctProgram(`sleep${hours}`, 83, neutralMacros('female'), { sleep: sleepOf(hours) })], use: 0 }) });
/**
 * Wang's restriction pattern (16 §V2 table): ≈ 1 h less time in bed on 5 nights a week, ad libitum on 2 — net −169 min/week
 * (−24 min/day): 5 × 6.45 h + 2 × 8.37 h, mean 7.0 h (fixture fix 2026-09-30: a constant 7.0 h carried no sleep debt at the
 * ruled 7.0-h reference, so both arms were identical).
 */
const wangShortArm = (): ArmSpec => ({
  profile: WANG,
  schedule: buildSchedule({
    days: 56,
    programs: [pctProgram('sleepShort', 83, neutralMacros('female'), { sleep: sleepOf(6.45) }), pctProgram('sleepCatchUp', 83, neutralMacros('female'), { sleep: sleepOf(8.37) })],
    use: (d) => (d % 7 < 5 ? 0 : 1),
  }),
});

export const D16_V2_WANG: Scenario = {
  id: '16-V2-wang-small-sleep-loss',
  dossier: '16',
  target: 'V2',
  title: 'Wang 2018: 8 wk of moderate restriction with a small sleep difference (net −24 min/day)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Wang et al. 2018 (dossier 16 ref [2]); dossier 16 §7 V2',
  notes:
    '36 adults, BMI 31-35: a 40-y woman, 165 cm, 90 kg (BMI 33); 83 % of maintenance for 8 wk (a ≈ −430 kcal/d deficit sized from the published −3.3 kg: intake at 95 % of RMR, as the dossier text reads, would give ≈ −10 kg, so \'95 % RMR\' cannot be literal; assumption), sleep 7.4 h vs 5 nights at 6.45 h + 2 at 8.37 h (−24 min/day on average, the study\'s restriction pattern). Study: weight −3.3 vs −3.2 kg, fat −1.9 vs −1.8, lean −0.71 vs −0.72 kg, i.e. no absolute differences. ' +
    'Engine test: the absolute null must lie inside the model band (weight difference within ±0.5 kg, assumed from "contains the null") and the fat-share shift stays within −15 … 0 points (central −8, upper edge −15).',
  arms: { normal: wangArm(7.4), short: wangShortArm() },
  expectations: [
    { id: 'shift', label: 'shift in the fat share of loss, −24 min sleep (−15 … 0 points)', unit: '% points', measure: (c) => 100 * (fatShare(c.arm('short'), 56) - fatShare(c.arm('normal'), 56)), check: range(-15, 0), source: 'dossier 16 V2 (central −8, upper edge −15)' },
    { id: 'weight', label: 'weight change difference, short − normal (0 ± 0.5 kg)', unit: 'kg', measure: (c) => c.arm('short').delta('scaleWeight', 56) - c.arm('normal').delta('scaleWeight', 56), check: val(0, 0.5), gate: 'Q', source: 'dossier 16 V2 (no absolute differences)', note: 'Band ±0.5 kg assumed.' },
  ],
};

// ---- V4 / V5 Buxton, Leproult, Saner: insulin sensitivity, testosterone, MPS with sleep restriction

const sleepRestrict = (hours: number, nights: number): ArmSpec => ({
  profile: person({ ...NOVICE_SPEC, trainingHistory: 'none' }),
  schedule: buildSchedule({ days: nights, programs: [pctProgram('sleepR', 100, neutralMacros('male'), { sleep: sleepOf(hours, 'fair') })], use: 0 }),
});

export const D16_V4_V5_SLEEP: Scenario = {
  id: '16-V4-V5-sleep-restriction-endocrine',
  dossier: '16',
  target: 'V4-V5',
  title: 'Buxton 2010 / Leproult 2011 / Saner 2020: insulin sensitivity, testosterone and MPS under sleep restriction',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Buxton 2010, Leproult 2011, Saner 2020 (dossier 16 refs [9,14,12]); dossier 16 §7 V4-V5',
  notes:
    'Healthy man (25 y, 178 cm, 75 kg) at maintenance with restricted sleep, expressed as ratios to the pre-restriction value: insulin sensitivity after 7 nights at 5 h: multiplier 0.84 (band 0.77-0.93; measured 0.80-0.89); testosterone after 8 nights at 5 h: 0.87-0.88 (study −10 to −13 %); ' +
    'MPS after 5 nights at 4 h in bed: 0.85 (0.815 at steady state; measured 0.81) and the total-deprivation cap −20 to −25 % ± 5 points. The `mps` series is the daily mean of the display MPS index; the ratio to the day-0 value is used.',
  arms: { si5h: sleepRestrict(5, 7), t5h: sleepRestrict(5, 8), mps4h: sleepRestrict(4, 5) },
  expectations: [
    { id: 'si', label: 'insulin-sensitivity multiplier after 7 nights at 5 h (0.84, band 0.77-0.93)', unit: 'ratio', measure: (c) => c.arm('si5h').after('insulinSensitivity', 7) / c.arm('si5h').initial('insulinSensitivity'), check: range(0.77, 0.93), source: 'dossier 16 V4' },
    { id: 'testosterone', label: 'testosterone ratio after 8 nights at 5 h (0.87-0.88, study −10 to −13 %)', unit: 'ratio', measure: (c) => c.arm('t5h').after('testosterone', 8) / c.arm('t5h').initial('testosterone'), check: range(0.85, 0.92), source: 'dossier 16 V5', note: 'Band = the study range −8 to −15 % widened by 2 points.' },
    { id: 'mps', label: 'MPS ratio after 5 nights at 4 h in bed (0.85; measured 0.81; cap −20 to −25 % ± 5 points)', unit: 'ratio', measure: (c) => c.arm('mps4h').mean('mps', 4, 5) / c.arm('mps4h').mean('mps', 0, 1), check: range(0.7, 0.9), source: 'dossier 16 V5', note: 'Band [0.70, 0.90]: measured 0.81, mpsMult 0.85, cap 0.75-0.80 ± 0.05.' },
  ],
};

// ---- V9 sex difference in the FFM share of early loss (Q)

const sexArm = (profile: PersonProfile): ArmSpec => ({ profile, schedule: constantSchedule(56, pctProgram('minus25', 75, neutralMacros(profile.body.sex))) });

export const D16_V9_SEX: Scenario = {
  id: '16-V9-sex-ffm-share',
  dossier: '16',
  target: 'V9',
  title: 'PREVIEW / Millward: sex difference in the FFM share of early weight loss (contested)',
  level: 'I',
  gate: 'Q',
  requires: REQUIRES.CORE,
  citation: 'PREVIEW (dossier 16 ref [53]), Millward (ref [54]); dossier 16 §7 V9 (§9.2: Q)',
  notes:
    'MAN and WOMAN (§9.3) at 75 % of maintenance for 8 weeks. The FFM share of the loss is the lean share of the tissue lost. Engine expectation: the absolute sex difference in that share is ≤ 15 points (the dossier says "do not tune to either report alone"; PREVIEW women ≈ +15 points, Millward men higher).',
  arms: { man: sexArm(person({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, bodyFatPct: 25 })), woman: sexArm(person({ sex: 'female', ageYears: 42, heightCm: 165, weightKg: 72, bodyFatPct: 36 })) },
  expectations: [{ id: 'diff', label: 'FFM share of loss, women minus men (|difference| ≤ 15 points)', unit: '% points', measure: (c) => 100 * (leanShare(c.arm('woman'), 0, 56) - leanShare(c.arm('man'), 0, 56)), check: range(-15, 15), source: 'dossier 16 V9 (≤ 15 points)' }],
};

// ---- V12 luteal phase scale band

const cyclingWoman = person({ sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62, extra: { cycle: { tracking: true, cycleLengthD: 28, lastPeriodStart: '2026-09-07', contraception: 'none' } } });

export const D16_V12_LUTEAL: Scenario = {
  id: '16-V12-luteal-scale-band',
  dossier: '16',
  target: 'V12',
  title: 'Cycle scale studies: luteal weight fluctuation stays inside ±0.3 kg with no deterministic drift',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Tucker 2025, Benton 2020, cycle scale studies (dossier 16 refs [73,74,78-80]); dossier 16 §7 V12',
  notes:
    'A cycling 30-y woman (165 cm, 62 kg, 28-d cycle, last period 2026-09-07 relative to the 2026-10-05 start) at 100 % of maintenance for 56 days. Dossier: "no deterministic weight curve; scale band ±0.3 kg": ' +
    'the largest deviation of the morning scale from its own 56-day mean is ≤ 0.3 kg (ad libitum intake +168 kcal/d in the luteal phase is an appetite output, not a row).',
  arms: { main: { profile: cyclingWoman, schedule: constantSchedule(56, pctProgram('maintenance', 100, neutralMacros('female'))) } },
  expectations: [
    { id: 'band', label: 'largest morning-scale deviation from its 56-d mean (≤ 0.3 kg)', unit: 'kg', measure: (c) => { const a = c.main.daily('scaleWeight'); if (!a) return Number.NaN; let m = 0; for (let i = 0; i < 56; i++) m += a[i]!; m /= 56; let w = 0; for (let i = 0; i < 56; i++) w = Math.max(w, Math.abs(a[i]! - m)); return w; }, check: below(0.3), source: 'dossier 16 V12 (scale band ±0.3 kg)' },
    { id: 'drift', label: 'no cumulative drift over two cycles at maintenance (|Δscale| ≤ 0.3 kg)', unit: 'kg', measure: (c) => Math.abs(c.main.after('scaleWeight', 56) - c.main.after('scaleWeight', 0)), check: below(0.3), source: 'dossier 16 V12; review M3 (luteal RMR term is mean-zero)' },
  ],
};

export const SCENARIOS_PROTEIN: Scenario[] = [
  D09_1_BENITO,
  D09_2_MORTON,
  D09_3_PETERSON,
  D09_4_MURPHY,
  D09_6_GARTHE,
  D09_7_VILLAREAL,
  D09_8_BALLOR,
  D09_9_HELMS,
  D09_12_OGASAWARA,
  D09_13_BICKEL,
  D09_14_HEURISTICS,
  D09_STRENGTH,
  D03_2_METTLER,
  D03_PASIAKOS,
  D03_3_BRAY,
  D03_4_MORTON,
  D03_7_HOFFER,
  D03_8_WYCHERLEY,
  D16_V1_NEDELTCHEVA,
  D16_V2_WANG,
  D16_V4_V5_SLEEP,
  D16_V9_SEX,
  D16_V12_LUTEAL,
];
