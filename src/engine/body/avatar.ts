// stateToAvatarParams (dossier 14 sec. M10): body state -> numbers for a parametric front + side SVG silhouette.
// Rendering-agnostic: widths/depths per landmark, landmark heights, definition/fullness drivers. Grade D (design);
// the ellipse maths is exact, the circumference model is M8, ratios/landmarks are UNVERIFIED/PROPOSED as tagged.

import type {
  AvatarDefinition,
  AvatarFigure,
  AvatarLevel,
  AvatarLevelId,
  AvatarParams,
  AvatarRegion,
  AvatarUncertainty,
  AvatarVisceral,
  BodyState,
  BodyUncertainty,
  Circumferences,
  Sex,
  StateToAvatarOptions,
  VisceralBand,
} from './types';
import { REF_GIRTH_FRAC, circumferencesFor, referenceBody } from './circumferences';
import { ARM_A, HIP_A, KV_L_PER_KG, leanCoreKg, waistCoreArea } from './geometry';
import { clamp, clamp01, lerp, smoothstep } from './math';
import { frameForSex } from './frame';
import { lmsZ } from './lms';
import { HEAD_FAT_SHARE, SM_SHARES } from './partition';

/** Landmark heights as a fraction of stature from the floor (Drillis-Contini; dossier 14 M10; UNVERIFIED). */
export const LANDMARKS: Readonly<Record<AvatarLevelId, number>> = {
  headTop: 1.0,
  chin: 0.87,
  neck: 0.855,
  shoulder: 0.818, // acromion
  chest: 0.72, // nipple
  waist: 0.61,
  hip: 0.52, // max gluteal
  crotch: 0.47,
  thigh: 0.38, // mid-thigh (dossier 14 M12 levelsFor)
  knee: 0.285,
  calf: 0.2,
  ankle: 0.039,
  upperArm: 0.724, // midway acromion-elbow (own)
  elbow: 0.63,
  forearm: 0.557, // midway elbow-wrist (own)
  wrist: 0.485,
};

/** Ramanujan perimeter factor: C = pi*a*k(rho) with b = rho*a (error < 0.001 % for rho 0.5-1; dossier 14 M10). */
export function ramanujanK(rho: number): number {
  return 3 * (1 + rho) - Math.sqrt((3 + rho) * (1 + 3 * rho));
}

/** Ellipse semi-axes from circumference and depth/width ratio: a = C/(pi*k(rho)), b = rho*a. */
export function ellipseFromCircumference(cCm: number, rho: number): { a: number; b: number } {
  const a = cCm / (Math.PI * ramanujanK(rho));
  return { a, b: rho * a };
}

/** Ramanujan-I perimeter pi*(3(a+b) - sqrt((3a+b)(a+3b))) - the exact inverse of `ellipseFromCircumference`. */
export function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

// Depth/width ratios and front fractions (dossier 14 M10 table; PROPOSED / UNVERIFIED as noted there).
const RHO_ROUND = 0.95; // neck, thigh, calf, upper arm (UNVERIFIED)
const PHI_CENTRED = 0.5;
const RHO_CHEST: Readonly<Record<Sex, number>> = { male: 0.7, female: 0.72 }; // UNVERIFIED
const PHI_CHEST = 0.55; // UNVERIFIED
const RHO_HIP = 0.7; // UNVERIFIED
const PHI_HIP = 0.35; // UNVERIFIED (glutes behind)
/** Waist rho = clamp(0.66 + 0.005*(C - 82) + 0.35*(vFrac - vRef), 0.60, 0.92); anchored on Li 2024 SAD/TAD at BMI 23 [61]; slope/VAT term UNVERIFIED. */
const WAIST_RHO = { base: 0.66, perCm: 0.005, atCm: 82, vatGain: 0.35, lo: 0.6, hi: 0.92 } as const; // UNVERIFIED
const WAIST_PHI = { base: 0.58, vatGain: 0.1 } as const; // UNVERIFIED
const V_REF: Readonly<Record<Sex, number>> = { male: 0.2, female: 0.1 }; // PROPOSED

// Limb geometry (dossier 14 M10 "Outline construction"): legs centred at +-0.5*a_hip*0.9; arms 8-12 deg;
// upper-arm width ~MUAC/pi (here the rho = 0.95 ellipse of MUAC), forearm 0.80 x upper arm.
const LEG_CENTRE_FACTOR = 0.5 * 0.9; // PROPOSED
const FOREARM_FACTOR = 0.8; // PROPOSED
const ARM_ANGLE_DEG: readonly [number, number] = [8, 12]; // PROPOSED
// Levels the dossier does not size (own PROPOSED defaults, height-proportional, mildly coupled to the adjacent girth):
const KNEE_FRAC = 0.215; // PROPOSED (own)
const ANKLE_FRAC = 0.13; // PROPOSED (own)
const KNEE_THIGH_COUPLING = 0.3; // PROPOSED (own)
const ANKLE_CALF_COUPLING = 0.1; // PROPOSED (own)
const WRIST_FRAC: Readonly<Record<Sex, number>> = { male: 0.098, female: 0.093 }; // PROPOSED (own)
const WRIST_ARM_COUPLING = 0.1; // PROPOSED (own)
const WRIST_RHO = 0.7; // PROPOSED (own): wrist is flattened
const MUAC_REF_FRAC = 0.18; // PROPOSED (own): MUAC ~0.18*H at reference composition
const HEAD_BREADTH_FRAC = 0.0875; // PROPOSED (own)
const HEAD_DEPTH_FRAC = 0.11; // PROPOSED (own)
const HEAD_FULLNESS_GAIN = 0.08; // PROPOSED (own): head/jaw half-width +8 % at full face fullness
const NECK_UNDER_CHIN = 0.85; // PROPOSED (own): chin level width as a fraction of head width
const SHOULDER_DEPTH_OF_CHEST = 0.8; // PROPOSED (own)
const CROTCH_WIDTH_OF_HIP = 0.95; // PROPOSED (own)

// Appearance drivers (dossier 14 M10, D-grade conventions).
const FAT_COVER: Readonly<Record<Sex, readonly [number, number]>> = { male: [10, 17], female: [17, 25] }; // PROPOSED
/** Vascularity fades between these BF% (dossier prints smoothstep(BF, 11, 15); read as 1 - smoothstep: vascularity falls with fat). */
const VASCULARITY: Readonly<Record<Sex, readonly [number, number]>> = { male: [11, 15], female: [17, 22] }; // PROPOSED
const FACE_BF: Readonly<Record<Sex, readonly [number, number]>> = { male: [12, 35], female: [20, 45] }; // PROPOSED
/** Abdomen BFeff = BF + 6*z_belly (dossier 14 M10, PROPOSED). */
const BELLY_BF_PER_Z = 6; // PROPOSED
/** SMI reference: age-30 median SMI0 10.2 (M) / 7.6 (F) kg/m2 (dossier 14 M5). */
const SMI_REF: Readonly<Record<Sex, number>> = { male: 10.2, female: 7.6 }; // PROPOSED FIT

// ---- figure frame, uncertainty and the waist slice (R2 sec. 3.3 / 4.3 / 5.3) -------------------------------------

export { frameForSex };

/** VAT spread length at the waist slice, cm: A_vat = vatKg * KV * 1000 / L (R2 sec. 3.3; reproduces Samouda 2013 within ~7 %). */
export const VAT_SLICE_L_CM: Readonly<Record<Sex, number>> = { male: 22, female: 18 }; // PROPOSED
/** Relative uncertainty of L_vat, folded into the VAT area range in quadrature (R2 sec. 3.3). */
export const VAT_SLICE_L_REL_SD = 0.25; // PROPOSED
/** L3 skeletal-muscle index of the abdominal wall + psoas + erectors at reference trunk muscle, cm2/m2 (R2 sec. 3.3). */
export const SMI_L3_CM2_PER_M2: Readonly<Record<Sex, number>> = { male: 55, female: 42 }; // UNVERIFIED
/** Spine (L4 body + posterior elements) area at 175 cm stature, scaled by (H/175)^2 (R2 sec. 3.3). */
export const SPINE_AREA_CM2_AT_175 = 14; // UNVERIFIED
/** Thinnest skin + SAT layer at the waist, cm: A_sat >= perimeter * 0.3 (R2 sec. 3.3). */
export const SAT_MIN_THICKNESS_CM = 0.3; // PROPOSED
/** Organs never drawn smaller than 15 % of the lean area (R2 sec. 3.3). */
export const ORGANS_MIN_LEAN_FRAC = 0.15; // PROPOSED
/** Extreme-body guard: the lean area may shrink to this fraction of its M8 value to keep the slice consistent (own). */
export const LEAN_MIN_FRAC = 0.5; // PROPOSED (own)
/** VAT area bands, cm2: typical < 100 <= raised < 130 <= high (JASSO VFA 100 [R2 15]; 130 widely used, UNVERIFIED). */
export const VAT_AREA_THRESHOLDS_CM2: readonly [number, number] = [100, 130];

/** Defaults when the state is not a `BodyEstimate` and no override is given. */
const DEFAULT_BF_SD_PCT = 4.5; // PROPOSED (order of the CUN-BAE / fusion posterior SD)
const DEFAULT_WAIST_SD_CM: Readonly<Record<Sex, number>> = { male: 5.5, female: 6.5 }; // UNVERIFIED (= estimateBody, unmeasured)
const DEFAULT_VAT_REL_SD = 0.35; // PROPOSED (= estimateBody)
const BF_BAND_BOUNDS: readonly [number, number] = [2, 70]; // own display bounds
const Z_80 = 1.2815515655446004;

export function visceralBandOf(vatAreaCm2: number): VisceralBand {
  const [lo, hi] = VAT_AREA_THRESHOLDS_CM2;
  return vatAreaCm2 >= hi ? 'high' : vatAreaCm2 >= lo ? 'raised' : 'typical';
}

export interface VisceralInputs {
  sex: Sex;
  heightCm: number;
  fatFreeMassKg: number;
  vatKg: number;
  trunkMuscleKg: number;
  /** Reference body's trunk muscle (same sex and height, BMI 24/22, age 30; `referenceBody`). */
  trunkMuscleRefKg: number;
  waist: { halfWidthCm: number; halfDepthCm: number; phi: number };
  vatRelativeSd: number;
}

/**
 * Waist-slice areas (R2 sec. 3.3). Pure. Areas always satisfy sat + lean + vat = pi*a*b and wall + spine + organs = lean.
 * Clamps (extreme bodies only, never for adult bodies in the usual range):
 *   1. If lean + vat > A_waist - A_sat_min: the lean area shrinks first (to at most LEAN_MIN_FRAC of its M8 value),
 *      then the VAT area is capped; A_sat stays at A_sat_min.
 *   2. If wall + spine + organs(min) > lean: the wall shrinks first, then the spine.
 */
export function visceralSlice(p: VisceralInputs): AvatarVisceral {
  const H = p.heightCm;
  const h = H / 100;
  const a = Math.max(p.waist.halfWidthCm, 0);
  const b = Math.max(p.waist.halfDepthCm, 0);
  const aWaist = Math.PI * a * b;
  const satMin = Math.min(ellipsePerimeter(a, b) * SAT_MIN_THICKNESS_CM, aWaist);
  const avail = Math.max(aWaist - satMin, 0);

  const leanRaw = Math.max(waistCoreArea(p.sex, h, p.fatFreeMassKg), 0);
  let vat = (Math.max(p.vatKg, 0) * KV_L_PER_KG * 1000) / VAT_SLICE_L_CM[p.sex];
  let lean = leanRaw;
  if (lean + vat > avail) {
    lean = Math.min(Math.max(avail - vat, LEAN_MIN_FRAC * leanRaw), avail);
    vat = Math.max(Math.min(vat, avail - lean), 0);
  }
  const sat = Math.max(aWaist - lean - vat, 0);

  const ratio = p.trunkMuscleRefKg > 0 ? Math.max(p.trunkMuscleKg, 0) / p.trunkMuscleRefKg : 1;
  let wall = SMI_L3_CM2_PER_M2[p.sex] * h * h * ratio;
  let spine = SPINE_AREA_CM2_AT_175 * (H / 175) ** 2;
  const organs = Math.max(lean - wall - spine, ORGANS_MIN_LEAN_FRAC * lean);
  if (wall + spine + organs > lean) {
    wall = Math.max(lean - spine - organs, 0);
    spine = Math.max(lean - organs - wall, 0);
  }

  const sdRel = Math.sqrt(p.vatRelativeSd ** 2 + VAT_SLICE_L_REL_SD ** 2);
  return {
    vatKg: p.vatKg,
    vatAreaCm2: vat,
    satAreaCm2: sat,
    leanAreaCm2: lean,
    wallAreaCm2: wall,
    organsAreaCm2: organs,
    spineAreaCm2: spine,
    waist: { halfWidthCm: a, halfDepthCm: b, phi: p.waist.phi },
    band: visceralBandOf(vat),
    thresholdsCm2: [VAT_AREA_THRESHOLDS_CM2[0], VAT_AREA_THRESHOLDS_CM2[1]],
    areaRangeCm2: [Math.max(vat * (1 - sdRel), 0), vat * (1 + sdRel)],
  };
}

function hasUncertainty(s: BodyState): s is BodyState & { uncertainty: BodyUncertainty } {
  const u = (s as { uncertainty?: Partial<BodyUncertainty> }).uncertainty;
  return u !== undefined && typeof u.bodyFatSdPct === 'number';
}

/**
 * Uncertainty for the drawing. From a `BodyEstimate`: its BF SD re-centred on the drawn body's BF (a simulated state
 * spread from the estimate keeps the SD, not the old band), its waist SD and VAT SD. Overrides win field by field.
 */
function avatarUncertainty(state: BodyState, bf: number, o: Partial<AvatarUncertainty> = {}): AvatarUncertainty {
  const est = hasUncertainty(state) ? state.uncertainty : undefined;
  const sd = est?.bodyFatSdPct ?? DEFAULT_BF_SD_PCT;
  const [lo, hi] = BF_BAND_BOUNDS;
  const band: [number, number] = o.bodyFatBand80 ?? [clamp(bf - Z_80 * sd, lo, hi), clamp(bf + Z_80 * sd, lo, hi)];
  return {
    bodyFatBand80: [band[0], band[1]],
    waistSdCm: o.waistSdCm ?? est?.waistSdCm ?? DEFAULT_WAIST_SD_CM[state.sex],
    vatRelativeSd: o.vatRelativeSd ?? est?.vatRelativeSd ?? DEFAULT_VAT_REL_SD,
  };
}

function level(
  id: AvatarLevelId,
  region: AvatarRegion,
  heightCm: number,
  a: number,
  b: number,
  circumferenceCm: number | null,
  rho: number,
  phi: number,
  bilateral = false,
  centreOffsetCm = 0,
): AvatarLevel {
  const yFrac = LANDMARKS[id];
  return {
    id,
    region,
    yFrac,
    yCm: yFrac * heightCm,
    circumferenceCm,
    rho,
    phi,
    halfWidthCm: a,
    halfDepthCm: b,
    frontWidthCm: 2 * a,
    sideDepthCm: 2 * b,
    sideFrontCm: phi * 2 * b,
    sideBackCm: (1 - phi) * 2 * b,
    bilateral,
    centreOffsetCm,
  };
}

function girthLevel(
  id: AvatarLevelId,
  region: AvatarRegion,
  heightCm: number,
  c: number,
  rho: number,
  phi: number,
  bilateral = false,
  centreOffsetCm = 0,
): AvatarLevel {
  const { a, b } = ellipseFromCircumference(c, rho);
  return level(id, region, heightCm, a, b, c, rho, phi, bilateral, centreOffsetCm);
}

function totalFatOf(s: BodyState): number {
  return s.fat.headKg + s.fat.armsKg + s.fat.legsKg + s.fat.trunkSatKg + s.fat.vatKg;
}

/**
 * Body state -> avatar parameters (dossier 14 M10/M12). Call with the initial estimate for the "before" body and with any
 * simulated state (+ `baseline`) for the "after" body; morph with `lerpAvatarParams`.
 */
export function stateToAvatarParams(state: BodyState, options: StateToAvatarOptions = {}): AvatarParams {
  const { sex } = state;
  const H = state.heightCm;
  const h = H / 100;
  const circ: Circumferences = circumferencesFor(state, options.baseline);

  const fm = totalFatOf(state);
  const W = state.weightKg;
  const bf = W > 0 ? (100 * state.fatMassKg) / W : 0;
  const trunkFat = state.fat.trunkSatKg + state.fat.vatKg;
  const v = trunkFat > 1e-6 ? state.fat.vatKg / trunkFat : 0;
  const vRef = V_REF[sex];

  // ---- sections
  const rhoW = clamp(WAIST_RHO.base + WAIST_RHO.perCm * (circ.waistCm - WAIST_RHO.atCm) + WAIST_RHO.vatGain * (v - vRef), WAIST_RHO.lo, WAIST_RHO.hi);
  const phiW = WAIST_PHI.base + WAIST_PHI.vatGain * (v - vRef);
  const chest = girthLevel('chest', 'torso', H, circ.chestCm, RHO_CHEST[sex], PHI_CHEST);
  const waist = girthLevel('waist', 'torso', H, circ.waistCm, rhoW, phiW);
  const hip = girthLevel('hip', 'torso', H, circ.hipCm, RHO_HIP, PHI_HIP);
  const neck = girthLevel('neck', 'torso', H, circ.neckCm, RHO_ROUND, PHI_CENTRED);
  const shoulder = level(
    'shoulder',
    'torso',
    H,
    circ.bideltoidCm / 2,
    chest.halfDepthCm * SHOULDER_DEPTH_OF_CHEST,
    null,
    (chest.halfDepthCm * SHOULDER_DEPTH_OF_CHEST) / (circ.bideltoidCm / 2),
    PHI_CHEST,
  );

  const faceFull = clamp01((bf - FACE_BF[sex][0]) / (FACE_BF[sex][1] - FACE_BF[sex][0]));
  const headFatRatio = fm > 0 ? state.fat.headKg / (HEAD_FAT_SHARE * fm) : 1; // face extra re-allocation
  const faceFullness = clamp01(faceFull * headFatRatio);
  const headA = ((HEAD_BREADTH_FRAC * H) / 2) * (1 + HEAD_FULLNESS_GAIN * faceFullness);
  const headB = (HEAD_DEPTH_FRAC * H) / 2;
  const headTop = level('headTop', 'head', H, headA, headB, null, headB / headA, PHI_CENTRED);
  const chin = level('chin', 'head', H, headA * NECK_UNDER_CHIN, headB * NECK_UNDER_CHIN, null, headB / headA, PHI_CENTRED);

  // legs: one tube per leg centred at +-0.45*a_hip
  const legCentre = LEG_CENTRE_FACTOR * hip.halfWidthCm;
  const thigh = girthLevel('thigh', 'leg', H, circ.thighCm, RHO_ROUND, PHI_CENTRED, true, legCentre);
  const refThigh = REF_GIRTH_FRAC[sex].thigh * H;
  const refCalf = REF_GIRTH_FRAC[sex].calf * H;
  const kneeC = KNEE_FRAC * H * (1 + KNEE_THIGH_COUPLING * (circ.thighCm / refThigh - 1));
  const ankleC = ANKLE_FRAC * H * (1 + ANKLE_CALF_COUPLING * (circ.calfCm / refCalf - 1));
  const knee = girthLevel('knee', 'leg', H, kneeC, RHO_ROUND, PHI_CENTRED, true, legCentre);
  const calf = girthLevel('calf', 'leg', H, circ.calfCm, RHO_ROUND, PHI_CENTRED, true, legCentre);
  const ankle = girthLevel('ankle', 'leg', H, ankleC, RHO_ROUND, PHI_CENTRED, true, legCentre);
  const crotch = level(
    'crotch',
    'torso',
    H,
    Math.max(hip.halfWidthCm * CROTCH_WIDTH_OF_HIP, legCentre + thigh.halfWidthCm),
    hip.halfDepthCm * CROTCH_WIDTH_OF_HIP,
    null,
    (hip.halfDepthCm * CROTCH_WIDTH_OF_HIP) / Math.max(hip.halfWidthCm * CROTCH_WIDTH_OF_HIP, legCentre + thigh.halfWidthCm),
    PHI_HIP,
  );

  // arms (dossier 14 M10): upper arm near-circular (rho 0.95) from MUAC, forearm 0.80 x MUAC, elbow halfway;
  // the arm tube hangs from the shoulder edge (centre = bideltoid/2 - upper-arm half-width).
  const upperArm0 = ellipseFromCircumference(circ.armCm, RHO_ROUND);
  const armCentre = circ.bideltoidCm / 2 - upperArm0.a;
  const foreC = FOREARM_FACTOR * circ.armCm;
  const wristC = WRIST_FRAC[sex] * H * (1 + WRIST_ARM_COUPLING * (circ.armCm / (MUAC_REF_FRAC * H) - 1));
  const upperArm = girthLevel('upperArm', 'arm', H, circ.armCm, RHO_ROUND, PHI_CENTRED, true, armCentre);
  const elbow = girthLevel('elbow', 'arm', H, (circ.armCm + foreC) / 2, RHO_ROUND, PHI_CENTRED, true, armCentre);
  const forearm = girthLevel('forearm', 'arm', H, foreC, RHO_ROUND, PHI_CENTRED, true, armCentre);
  const wrist = girthLevel('wrist', 'arm', H, wristC, WRIST_RHO, PHI_CENTRED, true, armCentre);

  const levels = [headTop, chin, neck, shoulder, upperArm, chest, elbow, forearm, waist, wrist, hip, crotch, thigh, knee, calf, ankle].sort(
    (x, y) => y.yFrac - x.yFrac,
  );

  // ---- appearance drivers
  let zBelly = 0;
  const limbFat = state.fat.armsKg + state.fat.legsKg;
  if (limbFat > 1e-6 && trunkFat > 1e-6) zBelly = clamp(lmsZ('trunkLimb', sex, state.ageYears, trunkFat / limbFat), -3, 3);
  const [lo, hi] = FAT_COVER[sex];
  const fatCover = smoothstep(bf, lo, hi);
  const absCover = smoothstep(bf + BELLY_BF_PER_Z * zBelly, lo, hi);
  const smiRef = SMI_REF[sex];
  const shares = SM_SHARES[sex];
  const regDef = (regionKg: number, share: number) => clamp01((regionKg / share / (h * h) - smiRef) / (smiRef * 0.5));
  const definition: AvatarDefinition = {
    abs: 1 - absCover,
    pecs: regDef(state.muscle.trunkKg, shares.trunkKg) * (1 - fatCover),
    delts: regDef(state.muscle.armsKg, shares.armsKg) * (1 - fatCover),
    quads: regDef(state.muscle.legsKg, shares.legsKg) * (1 - fatCover),
    vascularity: 1 - smoothstep(bf, VASCULARITY[sex][0], VASCULARITY[sex][1]),
    fatCover,
  };

  const armAngleDeg = lerp(ARM_ANGLE_DEG[0], ARM_ANGLE_DEG[1], faceFull);

  // ---- figure / uncertainty / visceral blocks (R2 sec. 5.3)
  const leanKg = leanCoreKg(sex, h, state.fatFreeMassKg);
  const sl = options.sliders ?? {};
  const figure: AvatarFigure = {
    frame: clamp01(options.frame ?? frameForSex(sex)),
    ageYears: state.ageYears,
    fatKg: { head: state.fat.headKg, arms: state.fat.armsKg, legs: state.fat.legsKg, trunkSat: state.fat.trunkSatKg, vat: state.fat.vatKg },
    muscleKg: { arms: state.muscle.armsKg, legs: state.muscle.legsKg, trunk: state.muscle.trunkKg },
    satShares: { abdominal: state.satShares.abdominal, chest: state.satShares.chest, backFlank: state.satShares.backFlank },
    leanCoreAreaCm2: {
      waist: waistCoreArea(sex, h, state.fatFreeMassKg),
      hip: (HIP_A[sex] * leanKg) / h,
      arm: (ARM_A[sex] * (state.muscle.armsKg / 2)) / (0.2 * h),
    },
    sliders: { chest: clamp(sl.chest ?? 0, -1, 1), arms: clamp(sl.arms ?? 0, -1, 1), face: clamp(sl.face ?? 0, -1, 1) },
  };
  const uncertainty = avatarUncertainty(state, bf, options.uncertainty);
  const visceral = visceralSlice({
    sex,
    heightCm: H,
    fatFreeMassKg: state.fatFreeMassKg,
    vatKg: state.fat.vatKg,
    trunkMuscleKg: state.muscle.trunkKg,
    trunkMuscleRefKg: referenceBody(sex, H).trunkMuscleKg,
    waist: { halfWidthCm: waist.halfWidthCm, halfDepthCm: waist.halfDepthCm, phi: waist.phi },
    vatRelativeSd: uncertainty.vatRelativeSd,
  });

  return {
    sex,
    heightCm: H,
    circumferences: circ,
    levels,
    armAngleDeg,
    definition,
    faceFullness,
    outputs: {
      bodyFatPct: bf,
      fmi: state.fatMassKg / (h * h),
      ffmi: state.fatFreeMassKg / (h * h),
      whr: circ.waistCm / circ.hipCm,
      whtr: circ.waistCm / H,
      waistCm: circ.waistCm,
      vatKg: state.fat.vatKg,
    },
    figure,
    uncertainty,
    visceral,
  };
}

/**
 * Linear interpolation of every numeric field (same structure/landmark count), for before -> after morphing (dossier 14 M10).
 * Non-numeric leaves (`sex`, level ids, `visceral.band`) keep `from` until t = 1. Interpolated visceral areas stay
 * consistent (all the slice identities are linear), but `band` is the start band until the end: re-derive it with
 * `visceralBandOf(p.visceral.vatAreaCm2)` when a frame-accurate band is needed.
 */
export function lerpAvatarParams(from: AvatarParams, to: AvatarParams, t: number): AvatarParams {
  return lerpDeep(from, to, clamp01(t));
}

function lerpDeep<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number' && typeof b === 'number') return (t >= 1 ? b : lerp(a, b, t)) as T; // exact endpoint
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((x: unknown, i: number) => lerpDeep(x, b[i] as unknown, t)) as T;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = {};
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    for (const k of Object.keys(ra)) out[k] = lerpDeep(ra[k], rb[k], t);
    return out as T;
  }
  return t < 1 ? a : b;
}
