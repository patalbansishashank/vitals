// Forward/inverse slider helpers for the UI (dossier 14 M2/M3). All pure; the UI should pass `undefined` for sliders the
// user has not touched - default positions are display positions only (feeding them back as observations would count the
// population equation twice).

import type { BodyEstimate, BodyInputs, BodySliders, Ethnicity, Sex } from './types';
import {
  FAT_ANCHORS,
  FAT_ANCHOR_DESCRIPTORS,
  FFMI_ANCHORS,
  FFMI_ANCHOR_DESCRIPTORS,
  SLIDER_RANGES,
  sliderTo,
  toSlider,
  typicalIndicesAtBodyFat,
} from './anchors';
import { estimateInitialState, populationBodyFat } from './estimateBody';
import { lmsPercentile } from './lms';
import { clamp } from './math';

export { FAT_ANCHORS, FAT_ANCHOR_DESCRIPTORS, FFMI_ANCHORS, FFMI_ANCHOR_DESCRIPTORS, SLIDER_RANGES, sliderTo, toSlider };

export const sliderToBodyFat = (sex: Sex, s: number): number => sliderTo(FAT_ANCHORS[sex], s);
export const bodyFatToSlider = (sex: Sex, bodyFatPct: number): number => toSlider(FAT_ANCHORS[sex], bodyFatPct);
export const sliderToFfmi = (sex: Sex, s: number): number => sliderTo(FFMI_ANCHORS[sex], s);
export const ffmiToSlider = (sex: Sex, ffmi: number): number => toSlider(FFMI_ANCHORS[sex], ffmi);
/** Belly-vs-hips slider <-> trunk:limb z-score (z = 2*s, dossier 14 M3). */
export const bellySliderToZ = (s: number): number => 2 * clamp(s, -1, 1);
export const zToBellySlider = (z: number): number => clamp(z / 2, -1, 1);

export interface BasicBody {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  ethnicity?: Ethnicity;
}

/** Full slider set with every field defined. */
export type SliderPositions = Required<BodySliders>;

/**
 * Population-median slider positions implied by sex/age/height/weight alone: adiposity at the CUN-BAE + DXA-offset
 * estimate, muscularity at the untrained FFMI expected for that BMI (M9 `FFMI_exp`), fat pattern and extras at 0 (median).
 */
export function defaultSliderPositions(body: BasicBody): SliderPositions {
  const h = body.heightCm / 100;
  const bmi = clamp(body.weightKg / (h * h), 13, 60);
  const age = clamp(body.ageYears, 18, 90);
  const bf = populationBodyFat(body.sex, age, bmi, body.ethnicity);
  const ffmi = bmi * (1 - bf / 100);
  return {
    adiposity: bodyFatToSlider(body.sex, bf),
    muscularity: ffmiToSlider(body.sex, ffmi),
    bellyVsHips: 0,
    chest: 0,
    arms: 0,
    face: 0,
    muscleArms: 0,
    muscleLegs: 0,
    muscleTorso: 0,
  };
}

/** Live forward estimate for the slider UI (same algorithm as the engine's initial state). */
export function liveEstimate(inputs: BodyInputs): BodyEstimate {
  return estimateInitialState(inputs);
}

/**
 * Inverse: slider positions that display a finished estimate (adiposity at the posterior BF%, muscularity at the
 * posterior FFMI, belly at z/2 of the solved fat pattern; extras echo the inputs).
 */
export function slidersFromEstimate(estimate: BodyEstimate, inputs?: BodyInputs): SliderPositions {
  const s = inputs?.sliders ?? {};
  return {
    adiposity: bodyFatToSlider(estimate.sex, estimate.bodyFatPct),
    muscularity: ffmiToSlider(estimate.sex, estimate.ffmi),
    bellyVsHips: zToBellySlider(estimate.bellyZ),
    chest: s.chest ?? 0,
    arms: s.arms ?? 0,
    face: s.face ?? 0,
    muscleArms: s.muscleArms ?? 0,
    muscleLegs: s.muscleLegs ?? 0,
    muscleTorso: s.muscleTorso ?? 0,
  };
}

/** Weight implied by the two visual sliders, W_vis = h^2*(FMI_vis + FFMI_vis) (dossier 14 M2); muscularity defaults to typical-at-fatness. */
export function visualImpliedWeight(sex: Sex, heightCm: number, adiposity: number, muscularity?: number): number {
  const h = heightCm / 100;
  const bf = sliderToBodyFat(sex, adiposity);
  const ffmi = muscularity !== undefined ? sliderToFfmi(sex, muscularity) : typicalIndicesAtBodyFat(sex, bf).ffmi;
  return h * h * ((ffmi * bf) / (100 - bf) + ffmi);
}

export interface AdiposityAnchorInfo {
  stop: number;
  sliderPosition: number;
  bodyFatPct: number;
  descriptor: string;
  /** FMI / FFMI of a population-typical and of an athletic (+1.5 SD) body at this fatness (T2). */
  fmiTypical: number;
  ffmiTypical: number;
  ffmiAthletic: number;
  /** Percentile of this BF% among NHANES White adults of the given age (Kelly LMS). */
  percentile: number;
}

/** T2 anchor table for the UI, with typical indices and age-specific population percentiles. */
export function adiposityAnchorTable(sex: Sex, ageYears = 30): AdiposityAnchorInfo[] {
  const values = FAT_ANCHORS[sex];
  return values.map((bf, stop) => {
    const typ = typicalIndicesAtBodyFat(sex, bf);
    return {
      stop,
      sliderPosition: stop / (values.length - 1),
      bodyFatPct: bf,
      descriptor: FAT_ANCHOR_DESCRIPTORS[sex][stop] ?? '',
      fmiTypical: typ.fmi,
      ffmiTypical: typ.ffmi,
      ffmiAthletic: typicalIndicesAtBodyFat(sex, bf, true).ffmi,
      percentile: lmsPercentile('pctFat', sex, ageYears, bf),
    };
  });
}

export interface MuscularityAnchorInfo {
  stop: number;
  sliderPosition: number;
  ffmi: number;
  descriptor: string;
  percentile: number;
}

/** T3 anchor table for the UI with age-specific NHANES percentiles. */
export function muscularityAnchorTable(sex: Sex, ageYears = 30): MuscularityAnchorInfo[] {
  const values = FFMI_ANCHORS[sex];
  return values.map((ffmi, stop) => ({
    stop,
    sliderPosition: stop / (values.length - 1),
    ffmi,
    descriptor: FFMI_ANCHOR_DESCRIPTORS[stop] ?? '',
    percentile: lmsPercentile('ffmi', sex, ageYears, ffmi),
  }));
}
