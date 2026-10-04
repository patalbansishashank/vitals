// Visual slider anchors (dossier 14 sec. M2, tables T2 and T3) and the piecewise-linear slider maps.
// Visual descriptors are expert convention (grade D): no peer-reviewed validation of photo charts exists (M2).

import type { Sex } from './types';
import { at, clamp, clamp01, lerp } from './math';

/** Number of anchor stops per slider (8, equally spaced on 0..1). */
export const ANCHOR_STOPS = 8;

// T2 adiposity anchors, BF% (DXA frame), dossier 14 M2 (grade D conventions).
export const FAT_ANCHORS: Readonly<Record<Sex, readonly number[]>> = {
  male: [6, 10, 15, 20, 25, 30, 35, 42],
  female: [14, 18, 22, 27, 32, 38, 45, 52],
};

export const FAT_ANCHOR_DESCRIPTORS: Readonly<Record<Sex, readonly string[]>> = {
  male: [
    'Contest-lean: striations, vascularity in legs and abdomen',
    'Abs sharp, vascular arms and shoulders',
    'Abs outlined, obvious waist taper',
    'No ab lines, soft waist',
    'Rounded abdomen, no taper',
    'Belly protrudes, fold when seated',
    'Large belly, chest and face fullness',
    'Overhanging abdomen',
  ],
  female: [
    'Contest-lean: visible abs, glute striations',
    'Athletic: abs visible, leg separation',
    'Flat stomach, outline when tensed',
    'Smooth, soft waist',
    'Clear pear curve, soft belly',
    'Belly roll, arm fullness',
    'Large hips and belly, fold',
    'Very large',
  ],
};

// T3 muscularity anchors, FFMI = DXA lean incl. BMC / h^2 (kg/m2), dossier 14 M2. Top stops: Kouri 1995 natural
// limit 25.0 [35]; Graybeal 2020 bodybuilders 25.1 (M) / 18.3 (F) [36]; Hulmi 2016 competitors 18.4 [37].
export const FFMI_ANCHORS: Readonly<Record<Sex, readonly number[]>> = {
  male: [16.5, 18.0, 19.5, 21.0, 22.5, 24.0, 25.0, 27.0],
  female: [13.5, 14.5, 16.0, 17.3, 18.5, 19.5, 20.5, 22.0],
};

export const FFMI_ANCHOR_DESCRIPTORS: readonly string[] = [
  'Slight',
  'Below average',
  'Average untrained',
  'Athletic',
  'Muscular',
  'Very muscular',
  'Bodybuilder-class',
  'Enhanced range',
];

/** Slider ranges exported for the UI. */
export const SLIDER_RANGES = {
  adiposity: { min: 0, max: 1, default: null as number | null },
  muscularity: { min: 0, max: 1, default: null as number | null },
  bellyVsHips: { min: -1, max: 1, default: 0 },
  chest: { min: -1, max: 1, default: 0 },
  arms: { min: -1, max: 1, default: 0 },
  face: { min: -1, max: 1, default: 0 },
  muscleArms: { min: -1, max: 1, default: 0 },
  muscleLegs: { min: -1, max: 1, default: 0 },
  muscleTorso: { min: -1, max: 1, default: 0 },
} as const;

/** Slider position (0..1) -> anchored value, piecewise-linear over the 8 stops at x = s*7 (dossier 14 M3 `sliderTo`). */
export function sliderTo(anchors: readonly number[], s: number): number {
  const x = clamp01(s) * (anchors.length - 1);
  const i = Math.min(Math.floor(x), anchors.length - 2);
  return lerp(at(anchors, i), at(anchors, i + 1), x - i);
}

/** Inverse of `sliderTo` (dossier 14 sec. 7 `toSlider`); values outside the anchor range clamp to 0 or 1. */
export function toSlider(anchors: readonly number[], value: number): number {
  const n = anchors.length;
  const v = clamp(value, at(anchors, 0), at(anchors, n - 1));
  for (let i = 0; i < n - 1; i++) {
    const a = at(anchors, i);
    const b = at(anchors, i + 1);
    if (v <= b) return (i + (b - a > 0 ? (v - a) / (b - a) : 0)) / (n - 1);
  }
  return 1;
}

// Typical FFMI at a given fatness (dossier 14 M2, T2 "FFMI typ"): FFMI = FFMI_med + slope*(FMI - FMI_med), anchored at
// the Kelly age-30 medians (M 19.6 / 6.78, F 16.03 / 9.35) with slopes .40 (M) / .21 (F) kg/m2 per FMI unit
// (PROPOSED FIT from r(FM,SM) = .45 / .38, Maalin 2021 [24], and Kelly SDs [29]). "Athletic" = +1.5 SD_res,
// SD_res = 2.2 (M) / 2.0 (F) (PROPOSED). Reproduces T2's FMI / FFMI columns to the printed decimals.
const TYP_FFMI_MED: Readonly<Record<Sex, number>> = { male: 19.6, female: 16.03 };
const TYP_FMI_MED: Readonly<Record<Sex, number>> = { male: 6.78, female: 9.35 };
const TYP_SLOPE: Readonly<Record<Sex, number>> = { male: 0.4, female: 0.21 }; // PROPOSED
const TYP_SD_RES: Readonly<Record<Sex, number>> = { male: 2.2, female: 2.0 }; // PROPOSED

/** (FMI, FFMI) of a population-typical (or athletic, +1.5 SD) body at a given BF%. */
export function typicalIndicesAtBodyFat(sex: Sex, bodyFatPct: number, athletic = false): { fmi: number; ffmi: number } {
  // upper clamp 60 = BF_BOUNDS (estimateBody): above ~71 % (men) the solve's denominator 1 - k*b crosses zero
  const bf = clamp(bodyFatPct, 1, 60);
  const b = bf / (100 - bf); // FMI = b * FFMI
  const k = TYP_SLOPE[sex];
  const intercept = TYP_FFMI_MED[sex] + (athletic ? 1.5 * TYP_SD_RES[sex] : 0) - k * TYP_FMI_MED[sex];
  // FMI = b*(intercept + k*FMI)  =>  FMI = b*intercept / (1 - k*b)
  const fmi = (b * intercept) / (1 - k * b);
  return { fmi, ffmi: intercept + k * fmi };
}
