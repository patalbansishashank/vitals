// Population body-fat estimators and frame/ethnicity offsets (dossier 14 sec. M1).
// Convention here: functions take `Sex`; the published equations' 0/1 sex codes are applied internally.

import type { Ethnicity, Sex } from './types';
import { interp } from './math';

const isF = (sex: Sex): number => (sex === 'female' ? 1 : 0);
const isM = (sex: Sex): number => (sex === 'male' ? 1 : 0);

/**
 * CUN-BAE (Gomez-Ambrosi 2012, Diabetes Care 35:383; n = 6,510, ADP, SEE 4.66) - dossier 14 M1.
 * Coefficients agree between Vinknes 2017 full text and Woolcott 2018 footnote.
 */
export function cunBae(sex: Sex, ageYears: number, bmi: number): number {
  const f = isF(sex);
  const a = ageYears;
  const b = bmi;
  return (
    -44.988 +
    0.503 * a +
    10.689 * f +
    3.172 * b -
    0.026 * b * b +
    0.181 * b * f -
    0.02 * b * a -
    0.005 * b * b * f +
    0.00021 * b * b * a
  );
}

/** Relative fat mass (Woolcott & Bergman 2018, Sci Rep 8:10980; NHANES vs DXA R2 .69-.75) - dossier 14 M1. */
export function rfm(sex: Sex, heightCm: number, waistCm: number): number {
  return 64 - (20 * heightCm) / waistCm + 12 * isF(sex);
}

/** Deurenberg 1991 adult equation (Br J Nutr 65:105; n = 1,229, SEE 4.1) - dossier 14 M1. Validation only. */
export function deurenberg1991(sex: Sex, ageYears: number, bmi: number): number {
  return 1.2 * bmi + 0.23 * ageYears - 10.8 * isM(sex) - 5.4;
}

/** "Deurenberg" 1.294 form as printed in Woolcott 2018 Table 2 footnote (probably the 1998 meta-analysis; not confirmed). */
export function deurenberg1998(sex: Sex, ageYears: number, bmi: number): number {
  return 1.294 * bmi + 0.2 * ageYears - 11.4 * isM(sex) - 8;
}

/** Gallagher 2000 (AJCN 72:694) as quoted by Woolcott 2018 [8]; ethnic terms not reproduced there. Validation only. */
export function gallagher2000(sex: Sex, ageYears: number, bmi: number): number {
  const m = isM(sex);
  return 64.5 - 848 / bmi + 0.079 * ageYears - 16.4 * m + 0.05 * m * ageYears + (39.0 * m) / bmi;
}

/** Kagawa equation as quoted by Woolcott 2018 [8]. Validation only. */
export function kagawa(sex: Sex, ageYears: number, heightCm: number, waistCm: number): number {
  return -8.339 + 92.701 * (waistCm / heightCm) - 0.078 * ageYears - 11.062 * isM(sex);
}

/**
 * US-Navy circumference equation, inch form (Hodgdon & Beckett 1984; DoDI 1308.3), dossier 14 M1.
 * Men: waist at the navel; women: waist at the narrowest point + hip at the maximum. Inputs in cm.
 */
export function navyInches(sex: Sex, heightCm: number, waistCm: number, neckCm: number, hipCm?: number): number {
  const inch = (cm: number) => cm / 2.54;
  if (sex === 'male') {
    return 86.01 * Math.log10(inch(waistCm) - inch(neckCm)) - 70.041 * Math.log10(inch(heightCm)) + 36.76;
  }
  const hip = hipCm ?? Number.NaN;
  return 163.205 * Math.log10(inch(waistCm) + inch(hip) - inch(neckCm)) - 97.684 * Math.log10(inch(heightCm)) - 78.387;
}

/** US-Navy equation, metric (density) form, dossier 14 M1 (Potter 2022 / DoDI secondary pages agree). */
export function navyMetric(sex: Sex, heightCm: number, waistCm: number, neckCm: number, hipCm?: number): number {
  if (sex === 'male') {
    return 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  }
  const hip = hipCm ?? Number.NaN;
  return 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hip - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
}

/** Siri 1961 two-compartment conversion of body density (g/mL) to %fat. */
export function siri(bodyDensity: number): number {
  return 495 / bodyDensity - 450;
}

/**
 * Jackson-Pollock 3-site skinfolds (JP 1978 / JPW 1980; SEE ~0.0055-0.0060 g/mL), dossier 14 M1.
 * `sumMm`: men chest+abdomen+thigh; women triceps+suprailiac+thigh. Validation only (needs calipers).
 */
export function jacksonPollock3(sex: Sex, ageYears: number, sumMm: number): number {
  const S = sumMm;
  const bd =
    sex === 'male'
      ? 1.10938 - 0.0008267 * S + 0.0000016 * S * S - 0.0002574 * ageYears
      : 1.0994921 - 0.0009929 * S + 0.0000023 * S * S - 0.0001392 * ageYears;
  return siri(bd);
}

/** Watson 1980 total body water (L), cross-check only (secondary sources; RMSE 3.3-5.0 L) - dossier 14 M5. */
export function watsonTbw(sex: Sex, ageYears: number, heightCm: number, weightKg: number): number {
  return sex === 'male'
    ? 2.447 - 0.09516 * ageYears + 0.1074 * heightCm + 0.3362 * weightKg
    : -2.097 + 0.1069 * heightCm + 0.2466 * weightKg;
}

// DXA-frame offset added to CUN-BAE (dossier 14 M1 "Frame-of-reference problem"; PROPOSED FIT, own calculation of the
// dossier author from Kelly 2009 LMS medians [29] vs CUN-BAE [6]). Linear interpolation, clamped outside 20-60 y.
const DXA_OFFSET_AGES: readonly number[] = [20, 30, 40, 50, 60];
const DXA_OFFSET_MALE: readonly number[] = [2.8, 1.5, 0.3, 0, 0]; // PROPOSED
const DXA_OFFSET_FEMALE: readonly number[] = [3.8, 2.2, 1.2, 0.7, 0.4]; // PROPOSED

export function dxaFrameOffset(sex: Sex, ageYears: number): number {
  return interp(DXA_OFFSET_AGES, sex === 'male' ? DXA_OFFSET_MALE : DXA_OFFSET_FEMALE, ageYears);
}

export interface EthnicityAdjustment {
  /** Additive %BF offset on the population estimator (DXA frame). */
  bfOffsetPct: Readonly<Record<Sex, number>>;
  /** Multiplier on the anthropometric-equation sigmas. */
  sigmaMultiplier: number;
  /** Multiplier on vFrac (VAT share of trunk fat). */
  vatMultiplier: number;
  grade: 'B' | 'C' | 'D';
  note: string;
}

// Dossier 14 M1 "Biases by population" (BF offsets) and M6 "Ethnic differences" (VAT multipliers, UNVERIFIED).
export const ETHNICITY_ADJUSTMENTS: Readonly<Record<Ethnicity, EthnicityAdjustment>> = {
  white: { bfOffsetPct: { male: 0, female: 0 }, sigmaMultiplier: 1, vatMultiplier: 1, grade: 'B', note: 'reference population' },
  // +3.5 %BF: Deurenberg 2002 / Deurenberg-Yap 2000 / Deurenberg 1998 [2-4]; VAT x1.25 UNVERIFIED (direction supported [46]).
  eastAsian: {
    bfOffsetPct: { male: 3.5, female: 3.5 },
    sigmaMultiplier: 1,
    vatMultiplier: 1.25, // UNVERIFIED
    grade: 'B',
    note: 'same BMI -> 3-5 %BF higher (Deurenberg 1998-2002)',
  },
  // +4.0 %BF [2-4]; VAT multiplier: the dossier lists "East/South Asian x1.25" - applied to SE Asian as well (interpretation).
  southeastAsian: {
    bfOffsetPct: { male: 4.0, female: 4.0 },
    sigmaMultiplier: 1,
    vatMultiplier: 1.25, // UNVERIFIED
    grade: 'B',
    note: 'same BMI -> 3-5 %BF higher (Deurenberg 1998-2002)',
  },
  // +5.0 %BF [3,4]; VAT x1.25 UNVERIFIED.
  southAsian: {
    bfOffsetPct: { male: 5.0, female: 5.0 },
    sigmaMultiplier: 1,
    vatMultiplier: 1.25, // UNVERIFIED
    grade: 'B',
    note: 'same BMI -> 3-5 %BF higher (Deurenberg 2002)',
  },
  // DXA frame: CUN-BAE over-estimates Black adults by ~2.0 in NHANES 2005-06 (Woolcott 2018 [8]); the 4C/D2O
  // meta-analysis has the opposite sign [2] -> low confidence, sigma x1.2. VAT x0.85 UNVERIFIED.
  black: {
    bfOffsetPct: { male: -2.0, female: -2.0 },
    sigmaMultiplier: 1.2,
    vatMultiplier: 0.85, // UNVERIFIED
    grade: 'C',
    note: 'method-dependent sign (DXA vs 4C); low confidence',
  },
  // Mexican-American: CUN-BAE bias -0.9 (M) / -0.4 (W) vs White -0.24 / -0.4 (Woolcott 2018 [8]) -> +0.7 (M), 0 (W).
  // The dossier adds "ignore for simplicity"; implemented because it is a stated rule and is small.
  hispanic: { bfOffsetPct: { male: 0.7, female: 0 }, sigmaMultiplier: 1, vatMultiplier: 1, grade: 'C', note: 'Mexican-American NHANES data' },
  other: { bfOffsetPct: { male: 0, female: 0 }, sigmaMultiplier: 1, vatMultiplier: 1, grade: 'D', note: 'no adjustment' },
};
