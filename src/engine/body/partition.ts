// Composition partition at a given body-fat %: fat depots (M6), android/gynoid ratio, VAT (M6), skeletal muscle and its
// regional split (M5). Pure; used by `estimateInitialState` and by the reference body of the circumference model.

import type { Ethnicity, MenopauseStatus, RegionalFat, RegionalMuscle, SatShares, Sex } from './types';
import { ETHNICITY_ADJUSTMENTS } from './equations';
import { FFMI0, trunkFatFromWaist } from './geometry';
import { lmsValue, lmsZ } from './lms';
import { clamp } from './math';

/** Head/neck share of FM (dossier 14 M6; UNVERIFIED share). */
export const HEAD_FAT_SHARE = 0.045; // UNVERIFIED

/** Arm share of limb fat (dossier 14 M6; UNVERIFIED). */
export const ARM_FAT_SHARE: Readonly<Record<Sex, number>> = { male: 0.22, female: 0.19 }; // UNVERIFIED

/** Scale of the avatar "extras" sliders on a share: share*(1 + 0.4*s), then renormalise (dossier 14 M10, PROPOSED). */
export const EXTRA_SLIDER_GAIN = 0.4; // PROPOSED

/** Trunk SAT sub-partition for the avatar extras (dossier 14 M10, D-grade convention): abdominal .55, chest .15 (M) / .25 (F incl. breast), back-flank .30. */
export const SAT_SHARES_RAW: Readonly<Record<Sex, SatShares>> = {
  male: { abdominal: 0.55, chest: 0.15, backFlank: 0.3 }, // UNVERIFIED
  female: { abdominal: 0.55, chest: 0.25, backFlank: 0.3 }, // UNVERIFIED (sums to 1.10; renormalised)
};

/** Waist-derived trunk fat is bounded to [0.30, 0.75] x non-head FM (dossier 14 M8 `trunkFromWaist`). */
export const TRUNK_SHARE_BOUNDS: readonly [number, number] = [0.3, 0.75];

/** |z| bound for the trunk:limb z-score solved from waist (dossier 14 M12). */
export const TRUNK_LIMB_Z_BOUND = 3;

// VAT fraction of trunk fat (dossier 14 M6, PROPOSED FIT to Shen 2004 [42], Scafoglieri 2022 [43], UK Biobank [44],
// Framingham [45], Lemieux 1993 / Kotani 1994 / Ambikairajah 2019 [47]); exponent 0.3 makes VAT ~ FM^1.3
// (Hallgreen & Hall 2008 [48]).
export const VAT_V0: Readonly<Record<Sex, number>> = { male: 0.24, female: 0.13 }; // PROPOSED FIT
export const VAT_FM_REF: Readonly<Record<Sex, number>> = { male: 20.5, female: 28.0 }; // PROPOSED FIT (Shen 2004 means via CUN-BAE)
export const VAT_FM_EXPONENT = 0.3; // Hallgreen & Hall 2008 allometry k = 1.3 [48]
export const VAT_R_EXPONENT = 0.5; // PROPOSED
export const VAT_FRAC_BOUNDS: readonly [number, number] = [0.04, 0.6]; // PROPOSED
const VAT_AGE_SLOPE_MALE = 0.018; // PROPOSED FIT, pivot 42 y
const VAT_AGE_PIVOT_MALE = 42;
const VAT_AGE_SLOPE_FEMALE_PRE = 0.01; // PROPOSED FIT
const VAT_AGE_SLOPE_FEMALE_POST = 0.03; // PROPOSED FIT (Ambikairajah 2019 / Lovejoy 2008 [47])
const VAT_AGE_PIVOT_FEMALE = 48;

/**
 * Age term of vFrac (dossier 14 M6). Women: slope 0.010/y up to the pivot and 0.030/y after it; the pivot is 48 y.
 * Interpretation of "menopause status modulates the VAT age term" (dossier 14 sec. 5): a woman who reports
 * 'pre' after 48 keeps the shallow slope (pivot = age); 'post' before 48 moves the pivot to her age. PROPOSED.
 */
export function vatAgeTerm(sex: Sex, ageYears: number, menopause?: MenopauseStatus): number {
  if (sex === 'male') return Math.exp(VAT_AGE_SLOPE_MALE * (ageYears - VAT_AGE_PIVOT_MALE));
  let pivot = VAT_AGE_PIVOT_FEMALE;
  if (menopause === 'pre') pivot = Math.max(VAT_AGE_PIVOT_FEMALE, ageYears);
  else if (menopause === 'post') pivot = Math.min(VAT_AGE_PIVOT_FEMALE, ageYears);
  return Math.exp(
    VAT_AGE_SLOPE_FEMALE_PRE * (Math.min(ageYears, pivot) - VAT_AGE_PIVOT_FEMALE) +
      VAT_AGE_SLOPE_FEMALE_POST * Math.max(0, ageYears - pivot),
  );
}

/** vFrac = clamp(v0*(FM/FMref)^0.3*ageTerm*(R/Rref)^0.5*ethnic, 0.04, 0.60) (dossier 14 M6). */
export function vatFraction(
  sex: Sex,
  ageYears: number,
  fatMassKg: number,
  trunkLimbRatio: number,
  opts: { ethnicity?: Ethnicity; menopause?: MenopauseStatus } = {},
): number {
  const rRef = lmsValue('trunkLimb', sex, ageYears, 0);
  const eth = ETHNICITY_ADJUSTMENTS[opts.ethnicity ?? 'white'].vatMultiplier;
  const v =
    VAT_V0[sex] *
    Math.pow(Math.max(fatMassKg, 0) / VAT_FM_REF[sex], VAT_FM_EXPONENT) *
    vatAgeTerm(sex, ageYears, opts.menopause) *
    Math.pow(Math.max(trunkLimbRatio, 1e-6) / rRef, VAT_R_EXPONENT) *
    eth;
  return clamp(v, VAT_FRAC_BOUNDS[0], VAT_FRAC_BOUNDS[1]);
}

// Skeletal muscle (dossier 14 M5): SM = FFM - Rn*h^2 - 0.1*(FFM - FFMI0*h^2). PROPOSED FIT: at the age-30 median,
// SMI0 = 1.19*ALMI - 1.65/h^2 from Kelly ALMI medians [29] and Kim 2002 (SM = 1.19*ALM - 1.65, R2 .96, SEE 1.63 kg) [32];
// 0.1 = 90 % of FFM above the median is muscle.
export const SM_RN: Readonly<Record<Sex, number>> = { male: 9.4, female: 8.4 }; // PROPOSED FIT
export const SM_EXCESS_NON_MUSCLE = 0.1; // PROPOSED FIT
const SM_MIN_FRACTION_OF_FFM = 0.25; // guard for pathological inputs (own; never reached in adult ranges)

export function skeletalMuscleFromFfm(sex: Sex, heightM: number, ffmKg: number): number {
  const h2 = heightM * heightM;
  const sm = ffmKg - SM_RN[sex] * h2 - SM_EXCESS_NON_MUSCLE * (ffmKg - FFMI0[sex] * h2);
  return Math.max(sm, SM_MIN_FRACTION_OF_FFM * ffmKg);
}

/** Regional skeletal-muscle shares arms/legs/trunk (dossier 14 M5; UNVERIFIED typical DXA/MRI proportions). */
export const SM_SHARES: Readonly<Record<Sex, RegionalMuscle>> = {
  male: { armsKg: 0.115, legsKg: 0.56, trunkKg: 0.325 }, // UNVERIFIED
  female: { armsKg: 0.105, legsKg: 0.58, trunkKg: 0.315 }, // UNVERIFIED
};

/** Regional muscularity sliders multiply a share by 1 + 0.2*s and renormalise (dossier 14 M5, PROPOSED). */
export const REGIONAL_MUSCLE_SLIDER_GAIN = 0.2; // PROPOSED

export function regionalMuscle(
  sex: Sex,
  smKg: number,
  sliders: { muscleArms?: number; muscleLegs?: number; muscleTorso?: number } = {},
): RegionalMuscle {
  const base = SM_SHARES[sex];
  const g = REGIONAL_MUSCLE_SLIDER_GAIN;
  const a = base.armsKg * (1 + g * clamp(sliders.muscleArms ?? 0, -1, 1));
  const l = base.legsKg * (1 + g * clamp(sliders.muscleLegs ?? 0, -1, 1));
  const t = base.trunkKg * (1 + g * clamp(sliders.muscleTorso ?? 0, -1, 1));
  const s = a + l + t;
  return { armsKg: (smKg * a) / s, legsKg: (smKg * l) / s, trunkKg: (smKg * t) / s };
}

export function satShares(sex: Sex, chestExtra = 0): SatShares {
  const raw = SAT_SHARES_RAW[sex];
  const chest = raw.chest * (1 + EXTRA_SLIDER_GAIN * clamp(chestExtra, -1, 1));
  const total = raw.abdominal + chest + raw.backFlank;
  return { abdominal: raw.abdominal / total, chest: chest / total, backFlank: raw.backFlank / total };
}

export interface PartitionParams {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  bodyFatPct: number;
  /** Measured waist: trunk fat is solved from it (M8) and the belly slider is ignored. */
  waistCm?: number;
  /** Trunk:limb z-score used when no waist is given (z = 2*s_b). */
  bellyZ?: number;
  chestExtra?: number;
  armsExtra?: number;
  faceExtra?: number;
  muscleArms?: number;
  muscleLegs?: number;
  muscleTorso?: number;
  ethnicity?: Ethnicity;
  menopause?: MenopauseStatus;
}

export interface PartitionResult {
  fatMassKg: number;
  fatFreeMassKg: number;
  fat: RegionalFat;
  skeletalMuscleKg: number;
  muscle: RegionalMuscle;
  trunkLimbRatio: number;
  bellyZ: number;
  vatFraction: number;
  satShares: SatShares;
  /** Waist-derived trunk fat hit the [0.30, 0.75] bound. */
  trunkAtBound: 'low' | 'high' | null;
  /** z solved from the waist hit +-3. */
  zAtBound: boolean;
}

/** Fat-depot and lean partition at a given BF% (dossier 14 M5/M6, `estimateInitialState` body). */
export function partitionComposition(p: PartitionParams): PartitionResult {
  const { sex, ageYears: age } = p;
  const h = p.heightCm / 100;
  const W = p.weightKg;
  const FM = (W * p.bodyFatPct) / 100;
  const FFM = W - FM;

  // head share with the face extra (avatar re-allocation of head fat, M10)
  const headShare = HEAD_FAT_SHARE * (1 + EXTRA_SLIDER_GAIN * clamp(p.faceExtra ?? 0, -1, 1));
  const nonHead = (1 - headShare) * FM; // the dossier's 0.955*FM

  let trunk: number;
  let R: number;
  let z: number;
  let trunkAtBound: 'low' | 'high' | null = null;
  let zAtBound = false;
  if (p.waistCm !== undefined) {
    const raw = trunkFatFromWaist(sex, h, FFM, p.waistCm);
    const lo = TRUNK_SHARE_BOUNDS[0] * nonHead;
    const hi = TRUNK_SHARE_BOUNDS[1] * nonHead;
    if (raw < lo) trunkAtBound = 'low';
    else if (raw > hi) trunkAtBound = 'high';
    trunk = clamp(raw, lo, hi);
    R = nonHead - trunk > 0 ? trunk / (nonHead - trunk) : 1;
    const zRaw = lmsZ('trunkLimb', sex, age, R);
    zAtBound = Math.abs(zRaw) > TRUNK_LIMB_Z_BOUND;
    z = clamp(zRaw, -TRUNK_LIMB_Z_BOUND, TRUNK_LIMB_Z_BOUND);
  } else {
    z = clamp(p.bellyZ ?? 0, -TRUNK_LIMB_Z_BOUND, TRUNK_LIMB_Z_BOUND);
    R = lmsValue('trunkLimb', sex, age, z);
    trunk = (nonHead * R) / (1 + R);
  }
  const head = headShare * FM;
  const limbs = FM - head - trunk;
  const armBase = ARM_FAT_SHARE[sex];
  const armScaled = armBase * (1 + EXTRA_SLIDER_GAIN * clamp(p.armsExtra ?? 0, -1, 1));
  const armShare = armScaled / (armScaled + (1 - armBase));
  const arms = limbs * armShare;
  const legs = limbs - arms;

  const vFrac = vatFraction(sex, age, FM, R, { ethnicity: p.ethnicity, menopause: p.menopause });
  const vat = trunk * vFrac;
  const sat = trunk - vat;

  const SM = skeletalMuscleFromFfm(sex, h, FFM);
  const muscle = regionalMuscle(sex, SM, p);

  return {
    fatMassKg: FM,
    fatFreeMassKg: FFM,
    fat: { headKg: head, armsKg: arms, legsKg: legs, trunkSatKg: sat, vatKg: vat },
    skeletalMuscleKg: SM,
    muscle,
    trunkLimbRatio: R,
    bellyZ: z,
    vatFraction: vFrac,
    satShares: satShares(sex, p.chestExtra ?? 0),
    trunkAtBound,
    zAtBound,
  };
}
