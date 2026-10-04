// Public data contracts of the body-estimation module (dossier research/14-anthropometrics-fat-distribution.md).
// Units: kg, cm, L, g, kcal/d, % (0-100). Body fat is always "DXA-equivalent" (NHANES/Hologic frame, dossier 14 M1).

/** Same literal union as the engine's placeholder `Sex` (src/engine/types) so the two are structurally compatible. */
export type Sex = 'male' | 'female';

/**
 * Optional ethnicity used ONLY for the BF%-from-BMI offset, its sigma, and the VAT multiplier (dossier 14 M1/M6;
 * dossier 16 sec. 4.11 confirms no energy-parameter effect). LMS percentiles always use the White tables.
 */
export type Ethnicity = 'white' | 'black' | 'eastAsian' | 'southeastAsian' | 'southAsian' | 'hispanic' | 'other';

export type TrainingQuality = 'casual' | 'regular' | 'serious';

/** Method of a user-supplied body-fat measurement (sets its sigma in the fusion, dossier 14 M3). */
export type KnownBodyFatSource = 'dxa' | 'bia' | 'skinfold' | 'navy';

export type MenopauseStatus = 'pre' | 'peri' | 'post' | 'unknown';

/** Graphical slider positions. Every field is optional: `undefined` means "the user has not touched it". */
export interface BodySliders {
  /** Visual adiposity, 0..1 over the 8 anchors of T2 (FAT_ANCHORS). */
  adiposity?: number;
  /** Visual muscularity, 0..1 over the 8 FFMI anchors of T3 (FFMI_ANCHORS). */
  muscularity?: number;
  /** Belly/waist (+1) vs hips/thighs (-1): z-score of the trunk:limb fat ratio, z = 2*s (M6). Ignored when waist is known. */
  bellyVsHips?: number;
  /** Avatar extras, -1..1: re-allocate trunk SAT to the chest, limb fat to the arms, fat to the face (M10). */
  chest?: number;
  arms?: number;
  face?: number;
  /** Regional muscularity, -1..1: multiplies the regional skeletal-muscle share by 1 + 0.2*s, then renormalises (M5). */
  muscleArms?: number;
  muscleLegs?: number;
  muscleTorso?: number;
}

export interface BodyInputs {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  /** Hard constraint: fat mass + fat-free mass = weight. */
  weightKg: number;
  /** Waist at the iliac crest (NHANES protocol). Enables RFM and solves trunk fat (M8). */
  waistCm?: number;
  /** Optional, for the US-Navy estimator (neck always; hip for women). */
  neckCm?: number;
  hipCm?: number;
  /** Measured body fat % and its method; kept as an observation with the method's sigma (not a hard override). */
  knownBodyFatPct?: number;
  knownBodyFatSource?: KnownBodyFatSource;
  sliders?: BodySliders;
  /** Years of resistance training and their quality (M3/M9). */
  trainingYears?: number;
  trainingQuality?: TrainingQuality;
  ethnicity?: Ethnicity;
  /** Physical activity level for TDEE0 (default 1.5; dossier 02 owns PAL). */
  pal?: number;
  /** Habitual carbohydrate intake, g per kg body weight per day (initial muscle glycogen, M5). */
  habitualCarbGPerKg?: number;
  menopause?: MenopauseStatus;
  /** Skeletal-frame z-score (default 0; M5). */
  frameZ?: number;
  /** SD of the (self-reported) weight in kg; added in quadrature to the muscle-slider sigma (M3). Default 0. */
  weightSdKg?: number;
}

/** Fat depots, kg of DXA fat (the five compartments that the regional allocation rule M7 moves). */
export interface RegionalFat {
  /** Head + neck fat. */
  headKg: number;
  /** Both arms. */
  armsKg: number;
  /** Gluteofemoral + leg fat (both legs). */
  legsKg: number;
  /** Trunk subcutaneous fat (abdominal + chest + back + flank). */
  trunkSatKg: number;
  /** Visceral adipose tissue (fat-mass basis). */
  vatKg: number;
}

export type FatDepot = keyof RegionalFat;

/** Skeletal muscle by region, kg (both arms / both legs / trunk). */
export interface RegionalMuscle {
  armsKg: number;
  legsKg: number;
  trunkKg: number;
}

export type MuscleRegion = keyof RegionalMuscle;

/** Avatar-only sub-partition of trunk SAT (M10 extras), as fractions summing to 1. */
export interface SatShares {
  abdominal: number;
  chest: number;
  backFlank: number;
}

export interface Circumferences {
  neckCm: number;
  /** Bideltoid (shoulder) breadth, cm - a breadth, not a girth. */
  bideltoidCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  /** One thigh (proximal/mid). */
  thighCm: number;
  /** One calf. */
  calfCm: number;
  /** Mid-upper-arm circumference (MUAC), one arm. */
  armCm: number;
}

/**
 * The minimal body state that the simulation evolves and that the avatar/circumference model reads.
 * `BodyEstimate` extends it, so an estimate can be passed anywhere a state is expected.
 */
export interface BodyState {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  /** Tissue body mass = fatMassKg + fatFreeMassKg. */
  weightKg: number;
  fatMassKg: number;
  /** Fat-free mass incl. bone mineral (DXA "lean + BMC"). Pass tissue FFM (without acute water/glycogen swings) to the avatar. */
  fatFreeMassKg: number;
  skeletalMuscleKg: number;
  fat: RegionalFat;
  muscle: RegionalMuscle;
  /** Avatar-only SAT split (chest extra). */
  satShares: SatShares;
  frameZ: number;
  /** Circumferences measured by the user at this state (anchors for the avatar; M10 `userCirc`). */
  measuredCircumferences?: Partial<Circumferences>;
}

export type FusionObservationId = 'eq' | 'rfm' | 'navy' | 'fat' | 'mus' | 'known';

export interface FusionObservation {
  id: FusionObservationId;
  /** Observed BF% (DXA frame). */
  valuePct: number;
  /** Sigma of the observation, %BF, after inflation. */
  sdPct: number;
  /** GLS weight in the posterior mean (weights sum to 1; can be negative with correlated errors). */
  weight: number;
}

export interface BodyFatFusion {
  bodyFatPct: number;
  /** Posterior SD of BF% (M3). */
  sdPct: number;
  /** Posterior mean before the [3|8, 60] clamp. */
  unclampedPct: number;
  observations: FusionObservation[];
  /** CUN-BAE + DXA-frame offset + ethnic offset - training offset (the "eq" observation). */
  equationPct: number;
  /** %BF equivalent of the training-induced FFMI offset, dF (M3). */
  trainingOffsetPct: number;
  /** Training-induced FFMI offset used as the prior shift, kg/m2 (M3; dossier 14's conservative curve, see M9 note). */
  trainingFfmiOffset: number;
  trainingYearsEffective: number;
  athleteFlag: boolean;
  leanFlag: boolean;
  obeseFlag: boolean;
  /** Muscularity-slider FFMI, if the slider was given. */
  visualFfmi?: number;
  /** Adiposity-slider BF%, if given. */
  visualBodyFatPct?: number;
}

export type TrainingClass = 'untrained' | 'noviceTrained' | 'intermediate' | 'advanced' | 'nearCeiling';

/** Training status and muscle-gain potential inputs (M9). Dossier 09 owns the dynamic TS state; these are its inputs. */
export interface TrainingStatus {
  trainingYears: number;
  trainingYearsEffective: number;
  ffmi: number;
  /** Kouri-normalised FFMI: FFMI + 6.3*(1.80 - h). */
  ffmiNormalized: number;
  /** Untrained expectation for this BMI/age/sex (= dossier 09 `FFMI_untrained_ref`). */
  ffmiUntrainedRef: number;
  /** Natural ceiling: 25.0 (M) / 20.6 (F). */
  ffmiLimit: number;
  /** Fraction of the natural muscularity range used, 0..1. */
  fPot: number;
  /** fPot expected from the training history alone. */
  fPotExpected: number;
  trainingClass: TrainingClass;
  /** fPot_obs > fPot_expected + 0.30: "possible genetic outlier, prior training or over-estimated muscularity". */
  consistencyFlag: boolean;
  /** Remaining fat-free-mass potential, kg: (FFMI_lim - FFMI_norm)*h^2 (can be negative above the ceiling). */
  remainingFfmKg: number;
}

export type FmiClass =
  | 'severeDeficit'
  | 'moderateDeficit'
  | 'mildDeficit'
  | 'normal'
  | 'excess'
  | 'obeseI'
  | 'obeseII'
  | 'obeseIII';

export interface BodyUncertainty {
  bodyFatSdPct: number;
  /** 10-90 % band of BF% (posterior mean +- 1.2816 SD, clamped). */
  bodyFatBand80: [number, number];
  fatMassSdKg: number;
  fatFreeMassSdKg: number;
  skeletalMuscleSdKg: number;
  /** Relative SD of VAT (0.35 = +-35 %). */
  vatRelativeSd: number;
  waistSdCm: number;
}

export type BodyWarningCode =
  | 'ageBelow18'
  | 'ageAbove80'
  | 'bmiOutOfRange'
  | 'waistOutOfRange'
  | 'visualWeightMismatch'
  | 'bodyFatBelowSoftFloor'
  | 'bodyFatBelowHardFloor'
  | 'ffmiBelowFloor'
  | 'waistTrunkFatAtBound'
  | 'trunkLimbZAtBound'
  | 'trainingConsistency'
  | 'bodyFatClamped';

export interface BodyWarning {
  code: BodyWarningCode;
  message: string;
}

export interface BodyEstimate extends BodyState {
  bmi: number;
  bodyFatPct: number;
  bodyFatSdPct: number;
  fmi: number;
  ffmi: number;
  skeletalMuscleIndex: number;
  /** Alternative route: SM = 1.19*ALM - 1.65 (Kim 2002) with ALM = (ALMI/FFMI)*FFM - cross-check only. */
  skeletalMuscleFromAlmKg: number;
  appendicularLeanKg: number;
  boneMineralKg: number;
  totalBodyWaterL: number;
  extracellularWaterL: number;
  intracellularWaterL: number;
  /** Watson 1980 TBW cross-check. */
  totalBodyWaterWatsonL: number;
  glycogen: { muscleG: number; liverG: number; totalG: number };
  /** Trunk:limb fat-mass ratio R and its LMS z-score. */
  trunkLimbRatio: number;
  bellyZ: number;
  /** VAT as a fraction of trunk fat (vFrac, M6). */
  vatFractionOfTrunk: number;
  vatToSatRatio: number;
  satSplitKg: { abdominal: number; chest: number; backFlank: number };
  energy: { rmrKcal: number; tdeeKcal: number; intake0Kcal: number; pal: number };
  training: TrainingStatus;
  /** Predicted circumferences at t = 0 (measured values where supplied). */
  circumferences: Circumferences;
  whr: number;
  whtr: number;
  /** Percentiles (0-100) vs NHANES 1999-2004 White adults of the same sex/age (Kelly 2009 LMS). */
  percentiles: { bodyFat: number; fmi: number; ffmi: number };
  fmiClass: FmiClass;
  uncertainty: BodyUncertainty;
  fusion: BodyFatFusion;
  /** Weight implied by the two visual sliders, h^2*(FMI_vis + FFMI_vis) (M2), if at least the fat slider is set. */
  visualWeightKg?: number;
  warnings: BodyWarning[];
}

// ---------------------------------------------------------------- avatar

export type AvatarLevelId =
  | 'headTop'
  | 'chin'
  | 'neck'
  | 'shoulder'
  | 'chest'
  | 'waist'
  | 'hip'
  | 'crotch'
  | 'thigh'
  | 'knee'
  | 'calf'
  | 'ankle'
  | 'upperArm'
  | 'elbow'
  | 'forearm'
  | 'wrist';

export type AvatarRegion = 'head' | 'torso' | 'leg' | 'arm';

/**
 * One horizontal section of the parametric silhouette. Front view: x = centre +- halfWidthCm.
 * Side view: front edge at +sideFrontCm, back edge at -sideBackCm from the plumb line.
 * For bilateral levels (legs, arms) the numbers describe ONE limb, centred at +-centreOffsetCm.
 */
export interface AvatarLevel {
  id: AvatarLevelId;
  region: AvatarRegion;
  /** Height above the floor as a fraction of stature, and in cm. */
  yFrac: number;
  yCm: number;
  /** Girth at this level if modelled (cm); null for breadth-only levels. */
  circumferenceCm: number | null;
  /** Depth/width ratio and front fraction used for the ellipse. */
  rho: number;
  phi: number;
  halfWidthCm: number;
  halfDepthCm: number;
  frontWidthCm: number;
  sideDepthCm: number;
  sideFrontCm: number;
  sideBackCm: number;
  bilateral: boolean;
  centreOffsetCm: number;
}

export interface AvatarDefinition {
  /** 0..1 visibility of abdominal definition. */
  abs: number;
  pecs: number;
  delts: number;
  quads: number;
  vascularity: number;
  /** 0..1 how much trunk SAT covers muscle outlines. */
  fatCover: number;
}

export interface AvatarParams {
  sex: Sex;
  heightCm: number;
  circumferences: Circumferences;
  /** Top-to-bottom sections for the front + side silhouettes. */
  levels: AvatarLevel[];
  armAngleDeg: number;
  definition: AvatarDefinition;
  faceFullness: number;
  outputs: {
    bodyFatPct: number;
    fmi: number;
    ffmi: number;
    whr: number;
    whtr: number;
    waistCm: number;
    vatKg: number;
  };
  /** Drawing inputs beyond the girths (R2 sec. 5.3): frame, regional composition, M8 lean-core areas, drawing-only extras. */
  figure: AvatarFigure;
  /** Uncertainty carried to the drawing (halo, ranges). */
  uncertainty: AvatarUncertainty;
  /** Waist-slice areas for the visceral view (R2 sec. 3.3). */
  visceral: AvatarVisceral;
}

/** Drawing-only extras, -1..1 (default 0). */
export interface AvatarSliders {
  chest: number;
  arms: number;
  face: number;
}

export interface AvatarFigure {
  /** 0..1 drawing-only skeletal frame: 0 = hips-led, 1 = shoulders-led (replaces the legacy female/neutral/male base). */
  frame: number;
  ageYears: number;
  fatKg: { head: number; arms: number; legs: number; trunkSat: number; vat: number };
  muscleKg: { arms: number; legs: number; trunk: number };
  satShares: { abdominal: number; chest: number; backFlank: number };
  /** M8 lean terms, cm2: waist core (`waistCoreArea`), hip core, arm core (one arm). */
  leanCoreAreaCm2: { waist: number; hip: number; arm: number };
  sliders: AvatarSliders;
}

export interface AvatarUncertainty {
  /** 10-90 % band of body fat %, centred on the drawn body. */
  bodyFatBand80: [number, number];
  waistSdCm: number;
  /** Relative SD of VAT mass (0.35 = +-35 %). */
  vatRelativeSd: number;
}

export type VisceralBand = 'typical' | 'raised' | 'high';

/**
 * Waist-slice (umbilical / L4-L5 level) areas, cm2 (R2 sec. 3.3). Outer area = pi*a*b of the waist ellipse
 * = satAreaCm2 + leanAreaCm2 + vatAreaCm2; leanAreaCm2 = wallAreaCm2 + spine + organsAreaCm2.
 */
export interface AvatarVisceral {
  vatKg: number;
  vatAreaCm2: number;
  satAreaCm2: number;
  leanAreaCm2: number;
  wallAreaCm2: number;
  organsAreaCm2: number;
  /** Spine (vertebral body + posterior elements) area, cm2 (the remainder of the lean area). */
  spineAreaCm2: number;
  /** Same ellipse as levels['waist']. */
  waist: { halfWidthCm: number; halfDepthCm: number; phi: number };
  band: VisceralBand;
  thresholdsCm2: [number, number];
  /** VAT area 80 %-ish range: vatAreaCm2 * (1 -/+ sd_rel), sd_rel = sqrt(vatRelativeSd^2 + 0.25^2). */
  areaRangeCm2: [number, number];
}

export interface StateToAvatarOptions {
  /**
   * Baseline (t = 0) state. When given, the waist change since baseline is multiplied by psi = 0.83 on loss
   * (skin/abdominal-wall laxity, M8) and circumferences are anchored on the baseline's measured values.
   */
  baseline?: BodyState;
  /** Drawing-only skeletal frame 0..1 (0 = hips-led, 1 = shoulders-led). Default `frameForSex(state.sex)`. */
  frame?: number;
  /**
   * Uncertainty overrides. Defaults: from the state when it is a `BodyEstimate` (its BF SD re-centred on the drawn
   * body fat, its waist SD and VAT SD), else BF SD 4.5 %, waist SD 5.5 (M) / 6.5 (F) cm, VAT relative SD 0.35.
   */
  uncertainty?: Partial<AvatarUncertainty>;
  /** Drawing-only extras (-1..1), carried through to `figure.sliders`. */
  sliders?: Partial<AvatarSliders>;
}

// ---------------------------------------------------------------- regional allocation

export interface RegionalComposition {
  fat: RegionalFat;
  muscle: RegionalMuscle;
}

export interface RegionalTarget {
  /** New total fat mass, kg. */
  fatMassKg: number;
  /** New total skeletal muscle, kg. */
  skeletalMuscleKg: number;
  /** Optional externally-computed VAT (kg); if given, VAT is set to it and the rest of dFM is allocated to the other depots. */
  vatKg?: number;
}

export interface RegionalAllocationOptions {
  /** Exploratory local-training ("spot") bias, default 0, max 0.10 (M7; grade C-D). */
  lambda?: number;
  /** Share (0..1) of each depot's adjacent muscle that is being trained, for the lambda bias. */
  trainedShare?: Partial<Record<FatDepot, number>>;
  /** Relative weights for allocating a muscle change among regions (default 1 = proportional to current mass). */
  muscleWeights?: Partial<Record<MuscleRegion, number>>;
  /** Maximum fat change per internal sub-step, kg (default 0.05), making results step-size invariant. */
  maxStepKg?: number;
}
