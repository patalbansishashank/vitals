// estimateInitialState (dossier 14 sec. M3, M5, M6, M8, M9, M11, M12): user inputs -> initial body state + uncertainty.

import type {
  BodyEstimate,
  BodyFatFusion,
  BodyInputs,
  BodyWarning,
  FmiClass,
  FusionObservation,
  FusionObservationId,
  KnownBodyFatSource,
  Sex,
  TrainingClass,
  TrainingQuality,
  TrainingStatus,
} from './types';
import { FAT_ANCHORS, FFMI_ANCHORS, sliderTo, typicalIndicesAtBodyFat } from './anchors';
import { circumferencesFor } from './circumferences';
import { ETHNICITY_ADJUSTMENTS, cunBae, dxaFrameOffset, navyMetric, rfm, watsonTbw } from './equations';
import { lmsPercentile } from './lms';
import { clamp, interp, solveSpd, sum } from './math';
import { partitionComposition } from './partition';

// ---------------------------------------------------------------- constants (M3 fusion)

/** Sigma of the CUN-BAE observation, %BF: SEE 4.66 (Gomez-Ambrosi 2012 [6]); NHANES IQR-SD 4.2-4.4 (Woolcott 2018 [8]). */
export const SIGMA_EQ = 4.7;
/** Sigma of RFM, %BF: NHANES IQR-SD 3.1-3.6 [8], inflated for external populations (dossier 14 M3). */
export const SIGMA_RFM = 4.0;
/** Sigma of the US-Navy estimator (dossier 14 M3; PROPOSED; Potter 2022 [11]: 3.7-4.8 in Marines). */
export const SIGMA_NAVY = 4.5; // PROPOSED
/** Sigma of the visual adiposity slider, %BF (dossier 14 M2: 3D-scan ceiling ~3 %BF [27] + perception biases [22]). */
export const SIGMA_FAT_SLIDER = 5.5; // PROPOSED
/** Sigma of the muscularity slider in FFMI units (~0.65 SD of FFMI, r ~ .75 with truth; dossier 14 M3). */
export const SIGMA_FFMI_SLIDER = 1.6; // PROPOSED
/** Known-BF sigmas by method: DXA 2.5, BIA 3.5 (Marines BIA-DXA SD 3.1-3.5 [11]), skinfold/Navy 4.0 (dossier 14 M3). */
export const KNOWN_BF_SIGMA: Readonly<Record<KnownBodyFatSource, number>> = { dxa: 2.5, bia: 3.5, skinfold: 4.0, navy: 4.0 };
/** Default method when `knownBodyFatSource` is omitted (own choice: consumer BIA is the most common home method). */
export const KNOWN_BF_DEFAULT_SOURCE: KnownBodyFatSource = 'bia';

/** Inflations of the anthropometric-equation sigmas (dossier 14 M1 bias table / M3). */
export const INFLATE_ATHLETE = 1.4; // PROPOSED (Ode 2007 [16]; Kouri 1995 [35])
export const INFLATE_LEAN = 1.3; // PROPOSED (Vinknes 2017 [7]; Potter 2022 [11])
export const INFLATE_OBESE = 1.2; // PROPOSED ("sigma x1.2 above E1 = 40", M1 bias table)
/** Lean flag: E1 below 15 (M) / 24 (F) %BF (dossier 14 M1/M3). */
export const LEAN_E1: Readonly<Record<Sex, number>> = { male: 15, female: 24 };
/** Obese flag: E1 above 40 %BF, both sexes (dossier 14 M1). */
export const OBESE_E1 = 40; // PROPOSED
/** Athlete flag: effective training years >= 2 or muscle-slider FFMI >= 21.6 (M) / 17.8 (F) (~P75-80) (dossier 14 M3). */
export const ATHLETE_YEARS = 2;
export const ATHLETE_FFMI: Readonly<Record<Sex, number>> = { male: 21.6, female: 17.8 };
/** RFM receives half the training offset (dossier 14 M3: E2 = RFM - 0.5*dF). */
export const RFM_TRAINING_FACTOR = 0.5; // PROPOSED

// Training prior (dossier 14 M3; PROPOSED FIT: first-year novice gain ~+1 FFMI; Kouri limit 25 and bodybuilders 25.1
// imply +5.4 at the extreme [35,36]; athletes' overfat BMI cut +1.4 [16]). Kept only as the BF prior shift: see M9 note.
export const TRAINING_QUALITY_FACTOR: Readonly<Record<TrainingQuality, number>> = { casual: 0.4, regular: 1.0, serious: 1.5 }; // PROPOSED FIT
export const TRAINING_DFFMI_MAX: Readonly<Record<Sex, number>> = { male: 3.6, female: 2.5 }; // PROPOSED FIT
export const TRAINING_TAU_Y = 3; // PROPOSED FIT

/** Error correlations (dossier 14 M3; PROPOSED). navy-rfm .5, navy-eq .3 are the dossier's "if added" values. */
const RHO_EQ_RFM = 0.6; // PROPOSED
const RHO_FAT_MUS = 0.3; // PROPOSED
const RHO_ANTHRO_VISUAL = 0.2; // PROPOSED
const RHO_NAVY_RFM = 0.5; // PROPOSED
const RHO_NAVY_EQ = 0.3; // PROPOSED

/** Posterior BF clamp: [3, 60] (M), [8, 60] (F) (dossier 14 M3/sec. 9). */
export const BF_BOUNDS: Readonly<Record<Sex, readonly [number, number]>> = { male: [3, 60], female: [8, 60] };

// ---------------------------------------------------------------- constants (M5, M9, M11, sec. 9)

/** Bone mineral fraction of FFM (dossier 14 M5; own calc of the dossier from Kelly medians [29]). */
const BMC_FRAC: Readonly<Record<Sex, { base: number; perYear: number; fromAge: number; frameSd: number }>> = {
  male: { base: 0.045, perYear: 0.001, fromAge: 40, frameSd: 0.15 }, // PROPOSED FIT
  female: { base: 0.051, perYear: 0.0025, fromAge: 45, frameSd: 0.13 }, // PROPOSED FIT
};
/** FFM hydration ~0.73 (Wang 1999 [56]). */
export const TBW_PER_FFM = 0.73;
/** ECW/TBW ~0.38 (BIA medians 0.373-0.394, Hioka 2026 [56]; isotope values higher, UNVERIFIED). */
export const ECW_PER_TBW = 0.38;
/** Muscle glycogen 16 g/kg SM (Areta & Hopkins 2018 [55] 462 mmol/kg DM x 0.180 x dry fraction 0.23 (UNVERIFIED) x 0.85; PROPOSED FIT). */
export const MUSCLE_GLYCOGEN_G_PER_KG = 16; // PROPOSED FIT
/** Habitual-CHO multipliers: x0.45 below 0.75 g/kg/d, x1.22 at >= 5.5 g/kg/d (Areta & Hopkins 2018 [55]: -253 / +102 mmol/kg DM). */
const GLY_LOW_CHO = { belowGPerKg: 0.75, factor: 0.45 } as const; // PROPOSED FIT
const GLY_HIGH_CHO = { atLeastGPerKg: 5.5, factor: 1.22 } as const; // PROPOSED FIT
/** Liver glycogen, fed state, g (dossier 14 M5; UNVERIFIED; dossier 04 owns kinetics). */
export const LIVER_GLYCOGEN_G = 90; // UNVERIFIED
/** RMR = 370 + 21.6*FFM (Cunningham 1991 [57]); dossier 02 owns RMR/PAL (this is the default only). */
const RMR_INTERCEPT = 370;
const RMR_PER_KG_FFM = 21.6;
export const DEFAULT_PAL = 1.5;
/** ALMI/FFMI ratio: .46 (M) / .43 (F) at 30 y, .44 / .42 at 60 y (dossier 14 M5 from Kelly [29]); Kim 2002 SM = 1.19*ALM - 1.65 [32]. */
const ALM_RATIO_AGES: readonly number[] = [30, 60];
const ALM_RATIO: Readonly<Record<Sex, readonly number[]>> = { male: [0.46, 0.44], female: [0.43, 0.42] };
/** Kouri normalisation FFMI + 6.3*(1.80 - h) (Kouri 1995 [35]; the paper's constant is 6.3). */
export const KOURI_SLOPE = 6.3;
/** Natural FFMI ceiling: 25.0 (M, Kouri [35]); 20.6 (F, PROPOSED: +2.13 SD above the age-30 NHANES median). */
export const FFMI_LIMIT: Readonly<Record<Sex, number>> = { male: 25.0, female: 20.6 };
/** Guard (own): minimum ceiling-minus-expected span, kg/m2, so fPot stays defined when heavy people's expected FFMI nears the ceiling. */
const FPOT_MIN_SPAN = 1.0;
/** fPot class thresholds (dossier 14 M9). */
const FPOT_CLASS: readonly [number, number, number, number] = [0.15, 0.4, 0.7, 0.9];
/** Consistency flag margin (dossier 14 M9). */
const FPOT_CONSISTENCY_MARGIN = 0.3;
/** Kelly FMI classes (dossier 14 M4, prevalence-matched to WHO BMI cut-offs [29]): upper bounds of each class. */
const FMI_CLASS_BOUNDS: Readonly<Record<Sex, readonly number[]>> = {
  male: [2, 2.3, 3, 6, 9, 12, 15],
  female: [3.5, 4, 5, 9, 13, 17, 21],
};
const FMI_CLASSES: readonly FmiClass[] = [
  'severeDeficit',
  'moderateDeficit',
  'mildDeficit',
  'normal',
  'excess',
  'obeseI',
  'obeseII',
  'obeseIII',
];
/** Uncertainty (dossier 14 M11): VAT +-30-40 % -> 0.35; waist SD 5.5 (M) / 6.5 (F) cm if not measured (UNVERIFIED), 0.5-1 cm if measured. */
const VAT_REL_SD = 0.35; // PROPOSED
const WAIST_SD_UNMEASURED: Readonly<Record<Sex, number>> = { male: 5.5, female: 6.5 }; // UNVERIFIED
const WAIST_SD_MEASURED = 0.75; // PROPOSED (0.5-1 cm)
/** SM equation SEE vs whole-body MRI, kg (Kim 2002 [32]). */
const SM_SEE_KG = 1.63;
const Z_80 = 1.2815515655446004;
/** Input guards (dossier 14 sec. 9). */
const BMI_RANGE: readonly [number, number] = [13, 60];
const WAIST_RANGE: readonly [number, number] = [50, 200];
const EQUATION_AGE_RANGE: readonly [number, number] = [18, 90];
const VISUAL_WEIGHT_WARN_KG = 8;
/**
 * Safety floors for projections (dossier 14 sec. 9; PROPOSED, dossier 17 owns final values): soft warning below BF 8 (M) /
 * 16 (F) %; hard stop below 5 / 12 % or FFMI below 16.0 / 13.0 (~NHANES P5). Contest-lean states were transient with
 * hormonal suppression (Rossow 2013 [38], Hulmi 2016 [37]).
 */
export const BODY_SAFETY_FLOORS = {
  bodyFatSoftPct: { male: 8, female: 16 }, // PROPOSED
  bodyFatHardPct: { male: 5, female: 12 }, // PROPOSED
  ffmiHard: { male: 16.0, female: 13.0 }, // PROPOSED
} as const satisfies Record<string, Readonly<Record<Sex, number>>>;
const BF_SOFT_FLOOR = BODY_SAFETY_FLOORS.bodyFatSoftPct;
const BF_HARD_FLOOR = BODY_SAFETY_FLOORS.bodyFatHardPct;
const FFMI_FLOOR = BODY_SAFETY_FLOORS.ffmiHard;

// ---------------------------------------------------------------- helpers

interface Normalized {
  sex: Sex;
  age: number;
  /** Age used by the regression equations (clamped 18-90). */
  eqAge: number;
  heightCm: number;
  h: number;
  W: number;
  bmi: number;
  /** BMI used by the regression equations (clamped 13-60). */
  eqBmi: number;
  waistCm?: number;
  warnings: BodyWarning[];
}

function normalize(i: BodyInputs): Normalized {
  const warnings: BodyWarning[] = [];
  const h = i.heightCm / 100;
  const bmi = i.weightKg / (h * h);
  if (i.ageYears < 18) warnings.push({ code: 'ageBelow18', message: 'Adult equations only (>= 18 y); age treated as 18.' });
  if (i.ageYears > 80) warnings.push({ code: 'ageAbove80', message: 'Reference data end at 80 y; estimates are less reliable.' });
  if (bmi < BMI_RANGE[0] || bmi > BMI_RANGE[1]) {
    warnings.push({ code: 'bmiOutOfRange', message: `BMI ${bmi.toFixed(1)} outside 13-60; equations evaluated at the bound.` });
  }
  let waistCm = i.waistCm;
  if (waistCm !== undefined && (waistCm < WAIST_RANGE[0] || waistCm > WAIST_RANGE[1])) {
    warnings.push({ code: 'waistOutOfRange', message: `Waist ${waistCm} cm outside 50-200 cm; clamped.` });
    waistCm = clamp(waistCm, WAIST_RANGE[0], WAIST_RANGE[1]);
  }
  return {
    sex: i.sex,
    age: i.ageYears,
    eqAge: clamp(i.ageYears, EQUATION_AGE_RANGE[0], EQUATION_AGE_RANGE[1]),
    heightCm: i.heightCm,
    h,
    W: i.weightKg,
    bmi,
    eqBmi: clamp(bmi, BMI_RANGE[0], BMI_RANGE[1]),
    waistCm,
    warnings,
  };
}

/** Effective training years T_eff = years x {casual 0.4, regular 1.0, serious 1.5} (dossier 14 M3). */
export function effectiveTrainingYears(years: number | undefined, quality: TrainingQuality | undefined): number {
  return Math.max(years ?? 0, 0) * TRAINING_QUALITY_FACTOR[quality ?? 'regular'];
}

/** dFFMI_train = dmax*(1 - exp(-T_eff/3)) kg/m2 (dossier 14 M3; conservative prior shift, see M9 reconciliation). */
export function trainingFfmiOffset(sex: Sex, yearsEffective: number): number {
  return TRAINING_DFFMI_MAX[sex] * (1 - Math.exp(-yearsEffective / TRAINING_TAU_Y));
}

/** Population estimate in the DXA frame: CUN-BAE + DXA-frame offset + ethnic offset (before the training offset). */
export function populationBodyFat(sex: Sex, ageYears: number, bmi: number, ethnicity: BodyInputs['ethnicity']): number {
  const eth = ETHNICITY_ADJUSTMENTS[ethnicity ?? 'white'];
  return cunBae(sex, ageYears, bmi) + dxaFrameOffset(sex, ageYears) + eth.bfOffsetPct[sex];
}

const ANTHRO: ReadonlySet<FusionObservationId> = new Set(['eq', 'rfm', 'navy']);
const VISUAL: ReadonlySet<FusionObservationId> = new Set(['fat', 'mus']);

function rho(a: FusionObservationId, b: FusionObservationId): number {
  if (a === b) return 1;
  const pair = (x: FusionObservationId, y: FusionObservationId) => (a === x && b === y) || (a === y && b === x);
  if (pair('eq', 'rfm')) return RHO_EQ_RFM;
  if (pair('navy', 'rfm')) return RHO_NAVY_RFM;
  if (pair('navy', 'eq')) return RHO_NAVY_EQ;
  if (pair('fat', 'mus')) return RHO_FAT_MUS;
  if ((ANTHRO.has(a) && VISUAL.has(b)) || (ANTHRO.has(b) && VISUAL.has(a))) return RHO_ANTHRO_VISUAL;
  return 0; // known BF is independent
}

// ---------------------------------------------------------------- M3 fusion

/**
 * `estimateBF` (dossier 14 M3): constrained GLS fusion of the population equation(s), visual sliders and an optional
 * measured BF%. Weight is the hard constraint (FM + FFM = W), so BF% is the single latent variable.
 */
export function estimateBodyFat(inputs: BodyInputs): BodyFatFusion {
  const n = normalize(inputs);
  const { sex, h, W } = n;
  const h2 = h * h;
  const s = inputs.sliders ?? {};
  const eth = ETHNICITY_ADJUSTMENTS[inputs.ethnicity ?? 'white'];

  const Teff = effectiveTrainingYears(inputs.trainingYears, inputs.trainingQuality);
  const dFfmi = trainingFfmiOffset(sex, Teff);
  const dF = (100 * dFfmi * h2) / W;

  const visualFfmi = s.muscularity !== undefined ? sliderTo(FFMI_ANCHORS[sex], s.muscularity) : undefined;
  const visualBf = s.adiposity !== undefined ? sliderTo(FAT_ANCHORS[sex], s.adiposity) : undefined;

  const athleteFlag = Teff >= ATHLETE_YEARS || (visualFfmi !== undefined && visualFfmi >= ATHLETE_FFMI[sex]);
  const e1 = populationBodyFat(sex, n.eqAge, n.eqBmi, inputs.ethnicity) - dF;
  const leanFlag = e1 < LEAN_E1[sex];
  const obeseFlag = e1 > OBESE_E1;
  const infl =
    (athleteFlag ? INFLATE_ATHLETE : 1) * (leanFlag ? INFLATE_LEAN : 1) * (obeseFlag ? INFLATE_OBESE : 1) * eth.sigmaMultiplier;

  const obs: { id: FusionObservationId; y: number; sd: number }[] = [{ id: 'eq', y: e1, sd: SIGMA_EQ * infl }];
  if (n.waistCm !== undefined) {
    obs.push({ id: 'rfm', y: rfm(sex, n.heightCm, n.waistCm) - RFM_TRAINING_FACTOR * dF, sd: SIGMA_RFM * infl });
  }
  const { neckCm, hipCm } = inputs;
  if (
    n.waistCm !== undefined &&
    neckCm !== undefined &&
    (sex === 'male' ? n.waistCm - neckCm > 1 : hipCm !== undefined && n.waistCm + hipCm - neckCm > 1)
  ) {
    const navy = navyMetric(sex, n.heightCm, n.waistCm, neckCm, hipCm);
    if (Number.isFinite(navy)) obs.push({ id: 'navy', y: navy, sd: SIGMA_NAVY * infl });
  }
  if (visualBf !== undefined) obs.push({ id: 'fat', y: visualBf, sd: SIGMA_FAT_SLIDER });
  if (visualFfmi !== undefined) {
    const sdMus = (100 * SIGMA_FFMI_SLIDER * h2) / W;
    const sdW = (100 * Math.max(inputs.weightSdKg ?? 0, 0)) / W; // self-report sensitivity term (dossier 14 M3)
    obs.push({ id: 'mus', y: 100 * (1 - (visualFfmi * h2) / W), sd: Math.hypot(sdMus, sdW) });
  }
  if (inputs.knownBodyFatPct !== undefined) {
    const src = inputs.knownBodyFatSource ?? KNOWN_BF_DEFAULT_SOURCE;
    obs.push({ id: 'known', y: inputs.knownBodyFatPct, sd: KNOWN_BF_SIGMA[src] });
  }

  // GLS: BF = (1' S^-1 y)/(1' S^-1 1), var = 1/(1' S^-1 1)
  const S = obs.map((p) => obs.map((q) => rho(p.id, q.id) * p.sd * q.sd));
  const u = solveSpd(
    S,
    obs.map(() => 1),
  );
  const denom = sum(u);
  const mean = sum(obs.map((o, k) => (u[k] ?? 0) * o.y)) / denom;
  const variance = 1 / denom;
  const [lo, hi] = BF_BOUNDS[sex];
  const observations: FusionObservation[] = obs.map((o, k) => ({ id: o.id, valuePct: o.y, sdPct: o.sd, weight: (u[k] ?? 0) / denom }));

  return {
    bodyFatPct: clamp(mean, lo, hi),
    sdPct: Math.sqrt(variance),
    unclampedPct: mean,
    observations,
    equationPct: e1,
    trainingOffsetPct: dF,
    trainingFfmiOffset: dFfmi,
    trainingYearsEffective: Teff,
    athleteFlag,
    leanFlag,
    obeseFlag,
    visualFfmi,
    visualBodyFatPct: visualBf,
  };
}

// ---------------------------------------------------------------- M9 training status

function trainingClassOf(fPot: number): TrainingClass {
  if (fPot < FPOT_CLASS[0]) return 'untrained';
  if (fPot < FPOT_CLASS[1]) return 'noviceTrained';
  if (fPot < FPOT_CLASS[2]) return 'intermediate';
  if (fPot <= FPOT_CLASS[3]) return 'advanced';
  return 'nearCeiling';
}

function trainingStatus(
  sex: Sex,
  h: number,
  ffmKg: number,
  eqAge: number,
  eqBmi: number,
  inputs: BodyInputs,
  Teff: number,
  dFfmiTrain: number,
): TrainingStatus {
  const ffmi = ffmKg / (h * h);
  const ffmiNormalized = ffmi + KOURI_SLOPE * (1.8 - h);
  const ffmiUntrainedRef = eqBmi * (1 - populationBodyFat(sex, eqAge, eqBmi, inputs.ethnicity) / 100);
  const ffmiLimit = FFMI_LIMIT[sex];
  const span = Math.max(ffmiLimit - ffmiUntrainedRef, FPOT_MIN_SPAN);
  const fPot = clamp((ffmiNormalized - ffmiUntrainedRef) / span, 0, 1);
  const fPotExpected = clamp(dFfmiTrain / span, 0, 1);
  return {
    trainingYears: Math.max(inputs.trainingYears ?? 0, 0),
    trainingYearsEffective: Teff,
    ffmi,
    ffmiNormalized,
    ffmiUntrainedRef,
    ffmiLimit,
    fPot,
    fPotExpected,
    trainingClass: trainingClassOf(fPot),
    consistencyFlag: fPot > fPotExpected + FPOT_CONSISTENCY_MARGIN,
    remainingFfmKg: (ffmiLimit - ffmiNormalized) * h * h,
  };
}

function fmiClassOf(sex: Sex, fmi: number): FmiClass {
  const bounds = FMI_CLASS_BOUNDS[sex];
  // lower classes use "<" bounds; from "normal" upwards the upper bound is inclusive (3-6 normal, >6-9 excess, ...)
  for (let k = 0; k < bounds.length; k++) {
    const b = bounds[k] ?? Number.POSITIVE_INFINITY;
    if (k < 3 ? fmi < b : fmi <= b) return FMI_CLASSES[k] ?? 'obeseIII';
  }
  return 'obeseIII';
}

export interface EstimateOptions {
  /**
   * Force the body-fat % (e.g. Monte-Carlo / robust +-1 SD evaluation, dossier 14 M11). The fusion still runs and
   * its SD is reported; everything downstream is recomputed at the forced value.
   */
  bodyFatPctOverride?: number;
}

// ---------------------------------------------------------------- estimateInitialState

/** Full initial state (dossier 14 M12 `estimateInitialState`). Deterministic and pure. */
export function estimateInitialState(inputs: BodyInputs, options: EstimateOptions = {}): BodyEstimate {
  const n = normalize(inputs);
  const { sex, h, W } = n;
  const h2 = h * h;
  const s = inputs.sliders ?? {};
  const warnings = [...n.warnings];

  const fusion = estimateBodyFat(inputs);
  const [bfLo, bfHi] = BF_BOUNDS[sex];
  const bf = options.bodyFatPctOverride !== undefined ? clamp(options.bodyFatPctOverride, bfLo, bfHi) : fusion.bodyFatPct;
  if (options.bodyFatPctOverride === undefined && fusion.unclampedPct !== fusion.bodyFatPct) {
    warnings.push({ code: 'bodyFatClamped', message: `Posterior BF ${fusion.unclampedPct.toFixed(1)} % clamped to ${bf} %.` });
  }

  const p = partitionComposition({
    sex,
    ageYears: n.age,
    heightCm: n.heightCm,
    weightKg: W,
    bodyFatPct: bf,
    waistCm: n.waistCm,
    bellyZ: 2 * clamp(s.bellyVsHips ?? 0, -1, 1),
    chestExtra: s.chest,
    armsExtra: s.arms,
    faceExtra: s.face,
    muscleArms: s.muscleArms,
    muscleLegs: s.muscleLegs,
    muscleTorso: s.muscleTorso,
    ethnicity: inputs.ethnicity,
    menopause: inputs.menopause,
  });
  if (p.trunkAtBound) {
    warnings.push({
      code: 'waistTrunkFatAtBound',
      message: `Waist implies trunk fat ${p.trunkAtBound === 'low' ? 'below 30 %' : 'above 75 %'} of body fat; bounded.`,
    });
  }
  if (p.zAtBound) warnings.push({ code: 'trunkLimbZAtBound', message: 'Fat distribution beyond +-3 SD of the reference; bounded.' });

  const FM = p.fatMassKg;
  const FFM = p.fatFreeMassKg;
  const SM = p.skeletalMuscleKg;
  const frameZ = inputs.frameZ ?? 0;

  // bone mineral (M5)
  const bm = BMC_FRAC[sex];
  const boneMineralKg = bm.base * (1 - bm.perYear * Math.max(0, n.age - bm.fromAge)) * FFM * (1 + frameZ * bm.frameSd);

  // water (M5)
  const totalBodyWaterL = TBW_PER_FFM * FFM;
  const extracellularWaterL = ECW_PER_TBW * totalBodyWaterL;

  // glycogen (M5)
  const carb = inputs.habitualCarbGPerKg;
  const glyFactor =
    carb === undefined ? 1 : carb < GLY_LOW_CHO.belowGPerKg ? GLY_LOW_CHO.factor : carb >= GLY_HIGH_CHO.atLeastGPerKg ? GLY_HIGH_CHO.factor : 1;
  const muscleG = SM * MUSCLE_GLYCOGEN_G_PER_KG * glyFactor;

  // energy (M5; dossier 02 owns RMR/PAL)
  const pal = inputs.pal ?? DEFAULT_PAL;
  const rmrKcal = RMR_INTERCEPT + RMR_PER_KG_FFM * FFM;
  const tdeeKcal = pal * rmrKcal;

  // ALM cross-check (M5)
  const almRatio = interp(ALM_RATIO_AGES, ALM_RATIO[sex], n.age);
  const appendicularLeanKg = almRatio * FFM;

  // training status (M9)
  const training = trainingStatus(sex, h, FFM, n.eqAge, n.eqBmi, inputs, fusion.trainingYearsEffective, fusion.trainingFfmiOffset);
  if (training.consistencyFlag) {
    warnings.push({
      code: 'trainingConsistency',
      message: 'Muscularity is higher than the training history suggests: genetic outlier, prior training or over-estimated muscularity.',
    });
  }

  const measuredCircumferences: BodyEstimate['measuredCircumferences'] = {};
  if (n.waistCm !== undefined) measuredCircumferences.waistCm = n.waistCm;
  if (inputs.hipCm !== undefined) measuredCircumferences.hipCm = inputs.hipCm;
  if (inputs.neckCm !== undefined) measuredCircumferences.neckCm = inputs.neckCm;

  const state = {
    sex,
    ageYears: n.age,
    heightCm: n.heightCm,
    weightKg: W,
    fatMassKg: FM,
    fatFreeMassKg: FFM,
    skeletalMuscleKg: SM,
    fat: p.fat,
    muscle: p.muscle,
    satShares: p.satShares,
    frameZ,
    measuredCircumferences,
  };
  const circumferences = circumferencesFor(state);

  const fmi = FM / h2;
  const ffmi = FFM / h2;
  const sd = fusion.sdPct;
  const ffmSd = (sd / 100) * W;

  // visual-weight mismatch (M2)
  let visualWeightKg: number | undefined;
  if (fusion.visualBodyFatPct !== undefined) {
    const bfVis = fusion.visualBodyFatPct;
    const ffmiVis = fusion.visualFfmi ?? typicalIndicesAtBodyFat(sex, bfVis).ffmi;
    const fmiVis = (ffmiVis * bfVis) / (100 - bfVis);
    visualWeightKg = h2 * (fmiVis + ffmiVis);
    if (Math.abs(W - visualWeightKg) > VISUAL_WEIGHT_WARN_KG) {
      warnings.push({
        code: 'visualWeightMismatch',
        message: `Sliders imply ${visualWeightKg.toFixed(0)} kg vs ${W} kg entered; the estimate weighs both.`,
      });
    }
  }

  // safety floors (sec. 9)
  if (bf < BF_HARD_FLOOR[sex]) warnings.push({ code: 'bodyFatBelowHardFloor', message: 'Body fat below the safe floor.' });
  else if (bf < BF_SOFT_FLOOR[sex]) warnings.push({ code: 'bodyFatBelowSoftFloor', message: 'Contest-lean body fat: not sustainable long term.' });
  if (ffmi < FFMI_FLOOR[sex]) warnings.push({ code: 'ffmiBelowFloor', message: 'Fat-free mass index below ~P5 of adults.' });

  const hasWaist = n.waistCm !== undefined;

  return {
    ...state,
    bmi: n.bmi,
    bodyFatPct: bf,
    bodyFatSdPct: sd,
    fmi,
    ffmi,
    skeletalMuscleIndex: SM / h2,
    skeletalMuscleFromAlmKg: 1.19 * appendicularLeanKg - 1.65,
    appendicularLeanKg,
    boneMineralKg,
    totalBodyWaterL,
    extracellularWaterL,
    intracellularWaterL: totalBodyWaterL - extracellularWaterL,
    totalBodyWaterWatsonL: watsonTbw(sex, n.age, n.heightCm, W),
    glycogen: { muscleG, liverG: LIVER_GLYCOGEN_G, totalG: muscleG + LIVER_GLYCOGEN_G },
    trunkLimbRatio: p.trunkLimbRatio,
    bellyZ: p.bellyZ,
    vatFractionOfTrunk: p.vatFraction,
    vatToSatRatio: p.fat.trunkSatKg > 0 ? p.fat.vatKg / p.fat.trunkSatKg : 0,
    satSplitKg: {
      abdominal: p.satShares.abdominal * p.fat.trunkSatKg,
      chest: p.satShares.chest * p.fat.trunkSatKg,
      backFlank: p.satShares.backFlank * p.fat.trunkSatKg,
    },
    energy: { rmrKcal, tdeeKcal, intake0Kcal: tdeeKcal, pal },
    training,
    circumferences,
    whr: circumferences.waistCm / circumferences.hipCm,
    whtr: circumferences.waistCm / n.heightCm,
    percentiles: {
      bodyFat: lmsPercentile('pctFat', sex, n.age, bf),
      fmi: lmsPercentile('fmi', sex, n.age, fmi),
      ffmi: lmsPercentile('ffmi', sex, n.age, ffmi),
    },
    fmiClass: fmiClassOf(sex, fmi),
    uncertainty: {
      bodyFatSdPct: sd,
      bodyFatBand80: [clamp(bf - Z_80 * sd, bfLo, bfHi), clamp(bf + Z_80 * sd, bfLo, bfHi)],
      fatMassSdKg: ffmSd,
      fatFreeMassSdKg: ffmSd,
      skeletalMuscleSdKg: Math.hypot(0.9 * ffmSd, SM_SEE_KG),
      vatRelativeSd: VAT_REL_SD,
      waistSdCm: hasWaist ? WAIST_SD_MEASURED : WAIST_SD_UNMEASURED[sex],
    },
    fusion,
    visualWeightKg,
    warnings,
  };
}
