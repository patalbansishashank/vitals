// Public API of the body-estimation module (dossier 14). Pure TypeScript, no DOM; safe in a Web Worker and in Node.

export type * from './types';

export {
  estimateInitialState,
  estimateBodyFat,
  populationBodyFat,
  effectiveTrainingYears,
  trainingFfmiOffset,
  BODY_SAFETY_FLOORS,
} from './estimateBody';
export type { EstimateOptions } from './estimateBody';
export { allocateRegional, regionalTotals, K_LOSS, K_GAIN, FAT_DEPOTS, MUSCLE_REGIONS } from './regional';
export {
  stateToAvatarParams,
  lerpAvatarParams,
  ellipseFromCircumference,
  ellipsePerimeter,
  ramanujanK,
  frameForSex,
  visceralSlice,
  visceralBandOf,
  LANDMARKS,
  VAT_SLICE_L_CM,
  VAT_SLICE_L_REL_SD,
  SMI_L3_CM2_PER_M2,
  SPINE_AREA_CM2_AT_175,
  SAT_MIN_THICKNESS_CM,
  ORGANS_MIN_LEAN_FRAC,
  LEAN_MIN_FRAC,
  VAT_AREA_THRESHOLDS_CM2,
} from './avatar';
export type { VisceralInputs } from './avatar';
export { circumferencesFor, geometricCircumferences } from './circumferences';
export {
  defaultSliderPositions,
  liveEstimate,
  slidersFromEstimate,
  visualImpliedWeight,
  adiposityAnchorTable,
  muscularityAnchorTable,
  sliderToBodyFat,
  bodyFatToSlider,
  sliderToFfmi,
  ffmiToSlider,
  bellySliderToZ,
  zToBellySlider,
  FAT_ANCHORS,
  FAT_ANCHOR_DESCRIPTORS,
  FFMI_ANCHORS,
  FFMI_ANCHOR_DESCRIPTORS,
  SLIDER_RANGES,
} from './sliders';
export type { BasicBody, SliderPositions, AdiposityAnchorInfo, MuscularityAnchorInfo } from './sliders';
export { lmsValue, lmsZ, lmsPercentile, KELLY_WHITE_LMS } from './lms';
export type { LmsVariable } from './lms';
export {
  cunBae,
  rfm,
  navyMetric,
  navyInches,
  deurenberg1991,
  gallagher2000,
  kagawa,
  jacksonPollock3,
  watsonTbw,
  dxaFrameOffset,
  ETHNICITY_ADJUSTMENTS,
} from './equations';
