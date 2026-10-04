// Engine AvatarParams -> two-layer cross-sections per landmark (AVATAR_SPEC §10.3).
//
// The engine gives the ENVELOPE: a girth-derived ellipse per landmark (dossier 14 M8/M10). The lean CORE is not in
// `AvatarParams`, so it is reconstructed here from the engine's own M8 lean terms, driven only by fields that ARE in
// the params (sex, height, FFMI, VAT):
//
//   waist  A_core = a_w * leanCoreKg / h  (+ VAT area: visceral fat sits inside the abdominal wall, i.e. in the core)
//   hip    A_core = a_h * leanCoreKg / h
//   arm    A_core = a_a * SM_arm(one) / (0.2 h)
//   chest, thigh, calf, neck: the reference body's lean area + the muscle-area change since the reference
//
// and the subcutaneous shell thickness of a convex section follows from its girth C and core girth C_core
// (circle-equivalent, the engine's convention A = C^2 / 4 pi):  delta = (C - C_core) / (2 pi).
// Everything is clamped so the core always lies inside the envelope and never collapses (extreme bodies).

import type { AvatarLevel, AvatarLevelId, AvatarParams, Sex } from '@/engine/body';
import { FFMI_ANCHORS, frameForSex } from '@/engine/body';
import {
  ARM_A,
  HIP_A,
  WAIST_L_CM,
  areaFromCircumference,
  circumferenceFromArea,
  fatArea,
  leanCoreKg,
  muscleArea,
  waistCoreArea,
} from '@/engine/body/geometry';
import { SM_SHARES, skeletalMuscleFromFfm } from '@/engine/body/partition';
import {
  CALF_LEG_SHARE,
  CHEST_TRUNK_MUSCLE_SHARE,
  REF_GIRTH_FRAC,
  REGION_FAT_L_CM,
  REGION_MUSCLE_L_CM,
  THIGH_LEG_SHARE,
  referenceBody,
} from '@/engine/body/circumferences';

/**
 * The frame to draw (0 = hips-led, 1 = shoulders-led; R2 sec. 4.3; it replaced the old three-way drawing choice): an
 * explicit frame wins, then the params' own `figure.frame`, then the sex default (`frameForSex`). Clamped to 0..1.
 */
export function resolveFrame(params: Pick<AvatarParams, 'sex'> & { figure?: { frame?: number } }, frame?: number): number {
  const f = frame ?? params.figure?.frame ?? frameForSex(params.sex);
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0.5;
}

/** Thinnest shell drawn anywhere (cm): the envelope outline always sits just outside the core. */
export const SKIN_CM = 0.25;

/**
 * Front-view breadth / ellipse half-width. Torso sections are not ellipses: a chest of girth C is ~15 % narrower
 * than the ellipse of the same girth and depth (kidney-shaped section), waist and hip ~5 % (ANSUR II breadth /
 * circumference / depth triples). Side depths are used as given. Drawing-only (see README, deviations).
 */
export function sectionBreadth(w: number): { neck: number; shoulder: number; chest: number; waist: number; hip: number; crotch: number } {
  // female hips are wider-than-elliptical (flatter front-back, lateral gluteofemoral mass): ~1.0; male ~0.94
  return { neck: 1, shoulder: 1, chest: 0.86, waist: mixMF(w, 0.95, 0.93), hip: mixMF(w, 0.94, 1.0), crotch: mixMF(w, 0.94, 0.99) };
}

export interface TorsoSection {
  y: number;
  /** Front view: envelope and core half-widths. */
  e: number;
  c: number;
  /** Side view, from the section's own centre line: envelope/core front (anterior) and back (posterior) extents. */
  eF: number;
  eB: number;
  cF: number;
  cB: number;
  /** Mean shell thickness (cm). */
  shell: number;
}

export interface LimbSection {
  y: number;
  /** Half-width of the limb (front view) and its core. */
  e: number;
  c: number;
  /** Half-depth (side view) and its core. */
  d: number;
  cd: number;
  /** Centre offset from the midline (front view). */
  cx: number;
  shell: number;
}

export interface Sections {
  sex: Sex;
  /** Drawing frame 0..1: 1 = shoulders-led template, 0 = hips-led template (mixes the templates continuously). */
  baseW: number;
  H: number;
  /** Frame scale sqrt(H/175) for template-only lengths. */
  S: number;
  neck: TorsoSection;
  shoulder: TorsoSection;
  chest: TorsoSection;
  waist: TorsoSection;
  hip: TorsoSection;
  crotch: TorsoSection;
  thigh: LimbSection;
  knee: LimbSection;
  calf: LimbSection;
  ankle: LimbSection;
  upperArm: LimbSection;
  elbow: LimbSection;
  forearm: LimbSection;
  wrist: LimbSection;
  /** Arm hang: top of the arm axis (x from midline, y) and the engine's resting angle (deg from vertical). */
  armTop: { x: number; y: number };
  armAngleDeg: number;
  head: { rx: number; ry: number; depth: number; cy: number; fullness: number };
  /** 0 = average untrained, 1 = bodybuilder-class (FFMI anchors) - drives muscle-shape emphasis. */
  muscularity: number;
  /** Shell thicknesses at the girth levels (cm) - exposed for tests and the visceral layer. */
  shell: { neck: number; chest: number; waist: number; hip: number; arm: number; thigh: number; calf: number };
  vatKg: number;
  definition: AvatarParams['definition'];
}

const TWO_PI = 2 * Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Finite-or-fallback: engine outputs are finite, but interpolated or hand-made params may not be. */
export const fin = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Shoulders-led (m) / hips-led (f) template value mixed by the frame w (0..1). */
export const mixMF = (w: number, m: number, f: number): number => f + (m - f) * w;

// ---- reference body cache (the engine recomputes an LMS partition; cache by sex + height) ----------------------
const refCache = new Map<string, ReturnType<typeof referenceBody>>();
function refBody(sex: Sex, H: number): ReturnType<typeof referenceBody> {
  const key = `${sex}|${H.toFixed(1)}`;
  let r = refCache.get(key);
  if (!r) {
    r = referenceBody(sex, H);
    if (refCache.size > 64) refCache.clear();
    refCache.set(key, r);
  }
  return r;
}

function levelOf(params: AvatarParams, id: AvatarLevelId): AvatarLevel | undefined {
  return params.levels.find((l) => l.id === id);
}

/** Shell thickness from girth and lean-core area: (C - C_core) / 2 pi, clamped to [SKIN, maxFrac * minor axis]. */
function shellFrom(girth: number, coreArea: number, minorAxis: number, maxFrac: number): number {
  const cCore = circumferenceFromArea(Math.max(coreArea, 1));
  const raw = (girth - cCore) / TWO_PI;
  return clamp(fin(raw, SKIN_CM), SKIN_CM, Math.max(SKIN_CM, maxFrac * minorAxis));
}

interface Level {
  y: number;
  a: number;
  b: number;
  F: number;
  B: number;
  C: number;
  cx: number;
}

function readLevel(params: AvatarParams, id: AvatarLevelId, yFracFallback: number, H: number, a0: number, rho0: number, phi = 0.5): Level {
  const l = levelOf(params, id);
  const a = Math.max(0.5, fin(l?.halfWidthCm ?? a0, a0));
  const b = Math.max(0.4, fin(l?.halfDepthCm ?? a0 * rho0, a0 * rho0));
  const F = Math.max(0.2, fin(l?.sideFrontCm ?? 2 * b * phi, 2 * b * phi));
  const B = Math.max(0.2, fin(l?.sideBackCm ?? 2 * b * (1 - phi), 2 * b * (1 - phi)));
  const C = Math.max(1, fin(l?.circumferenceCm ?? Math.PI * (a + b), Math.PI * (a + b)));
  const y = fin(l?.yCm ?? yFracFallback * H, yFracFallback * H);
  const cx = Math.max(0, fin(l?.centreOffsetCm ?? 0, 0));
  return { y, a, b, F, B, C, cx };
}

/**
 * Reconstruct the two-layer sections from engine avatar params. Pure and cheap (~20 us); safe on every frame.
 * `frame` (0..1) changes only drawing templates (bust, shoulder slope, curvature), never the
 * engine-derived girths. Default: `params.figure.frame`, else from the params' sex.
 */
export function sectionsFrom(params: AvatarParams, frame?: number): Sections {
  const sex: Sex = params.sex === 'female' ? 'female' : 'male';
  const H = clamp(fin(params.heightCm, 170), 120, 230);
  const h = H / 100;
  const S = Math.sqrt(H / 175);
  const w = resolveFrame(params, frame);
  const SECTION_BREADTH = sectionBreadth(w);
  const ffmi = clamp(fin(params.outputs.ffmi, 17), 8, 40);
  const ffm = ffmi * h * h;
  const vatKg = clamp(fin(params.outputs.vatKg, 0), 0, 40);

  // ---- lean model (engine M5/M8 lean terms) ----
  const sm = skeletalMuscleFromFfm(sex, h, ffm);
  const shares = SM_SHARES[sex];
  const smArmsOne = (sm * shares.armsKg) / 2;
  const smLegsOne = (sm * shares.legsKg) / 2;
  const smTrunk = sm * shares.trunkKg;
  const ref = refBody(sex, H);
  const refFrac = REF_GIRTH_FRAC[sex];

  const neckL = readLevel(params, 'neck', 0.855, H, 0.034 * H, 0.95);
  const shL = readLevel(params, 'shoulder', 0.818, H, 0.13 * H, 0.45, 0.55);
  const chL = readLevel(params, 'chest', 0.72, H, 0.1 * H, 0.7, 0.55);
  const waL = readLevel(params, 'waist', 0.61, H, 0.09 * H, 0.66, 0.58);
  const hiL = readLevel(params, 'hip', 0.52, H, 0.1 * H, 0.7, 0.35);
  const crL = readLevel(params, 'crotch', 0.47, H, 0.1 * H, 0.7, 0.35);
  const thL = readLevel(params, 'thigh', 0.38, H, 0.05 * H, 0.95);
  const knL = readLevel(params, 'knee', 0.285, H, 0.035 * H, 0.95);
  const caL = readLevel(params, 'calf', 0.2, H, 0.034 * H, 0.95);
  const anL = readLevel(params, 'ankle', 0.039, H, 0.021 * H, 0.95);
  const uaL = readLevel(params, 'upperArm', 0.724, H, 0.028 * H, 0.95);
  const elL = readLevel(params, 'elbow', 0.63, H, 0.025 * H, 0.95);
  const faL = readLevel(params, 'forearm', 0.557, H, 0.023 * H, 0.95);
  const wrL = readLevel(params, 'wrist', 0.485, H, 0.018 * H, 0.7);
  const headL = readLevel(params, 'headTop', 1, H, 0.044 * H, 1.2);

  // core areas (cm2, circle-equivalent)
  const aWaistCore = waistCoreArea(sex, h, ffm) + fatArea(vatKg, WAIST_L_CM);
  const aHipCore = (HIP_A[sex] * leanCoreKg(sex, h, ffm)) / h;
  const aArmCore = (ARM_A[sex] * smArmsOne) / (0.2 * h);
  const aNeckCore = areaFromCircumference(refFrac.neck * H) - fatArea(ref.masses.neckFat, REGION_FAT_L_CM.neck);
  const aChestCore =
    areaFromCircumference(refFrac.chest * H) -
    fatArea(ref.masses.chestFat, REGION_FAT_L_CM.chest) +
    muscleArea(CHEST_TRUNK_MUSCLE_SHARE * smTrunk - ref.masses.chestMuscle, REGION_MUSCLE_L_CM.chest);
  const aThighCore =
    areaFromCircumference(refFrac.thigh * H) -
    fatArea(ref.masses.thighFat, REGION_FAT_L_CM.thigh) +
    muscleArea(THIGH_LEG_SHARE * smLegsOne - ref.masses.thighMuscle, REGION_MUSCLE_L_CM.thigh);
  const aCalfCore =
    areaFromCircumference(refFrac.calf * H) -
    fatArea(ref.masses.calfFat, REGION_FAT_L_CM.calf) +
    muscleArea(CALF_LEG_SHARE * smLegsOne - ref.masses.calfMuscle, REGION_MUSCLE_L_CM.calf);

  const shell = {
    neck: shellFrom(neckL.C, aNeckCore, Math.min(neckL.a, neckL.b), 0.45),
    chest: shellFrom(chL.C, aChestCore, Math.min(chL.a * SECTION_BREADTH.chest, chL.b), 0.55),
    waist: shellFrom(waL.C, aWaistCore, Math.min(waL.a * SECTION_BREADTH.waist, waL.b), 0.62),
    hip: shellFrom(hiL.C, aHipCore, Math.min(hiL.a * SECTION_BREADTH.hip, hiL.b), 0.55),
    arm: shellFrom(uaL.C, aArmCore, Math.min(uaL.a, uaL.b), 0.55),
    thigh: shellFrom(thL.C, aThighCore, Math.min(thL.a, thL.b), 0.55),
    calf: shellFrom(caL.C, aCalfCore, Math.min(caL.a, caL.b), 0.5),
  };

  // Directional split of the shell (drawing convention, own): anterior abdominal SAT is thicker than the back's,
  // gluteal fat sits behind, breast tissue in front of the female chest.
  const bust = 1 - w; // 1 female template, 0.5 neutral, 0 male
  const torso = (
    L: Level,
    breadth: number,
    t: number,
    k: { x: number; f: number; b: number },
    minCore = 0.42,
  ): TorsoSection => {
    const e = L.a * breadth;
    const c = clamp(e - t * k.x, e * minCore, e - SKIN_CM);
    const cF = clamp(L.F - t * k.f, L.F * minCore, L.F - SKIN_CM);
    const cB = clamp(L.B - t * k.b, L.B * minCore, L.B - SKIN_CM);
    return { y: L.y, e, c, eF: L.F, eB: L.B, cF, cB, shell: t };
  };

  // neck fat is modest and mostly under the chin (not modelled on the silhouette): half the mean shell at the sides
  const neck = torso(neckL, SECTION_BREADTH.neck, shell.neck, { x: 0.5, f: 0.6, b: 0.5 }, 0.55);
  // Shoulder: a breadth (bideltoid), no girth - deltoid fat follows the arm, trapezius fat the neck/chest.
  const shoulderShell = clamp(0.55 * shell.arm + 0.25 * shell.chest, SKIN_CM, 0.3 * shL.a);
  // side depth at the acromion: the engine's 0.8 x chest depth over-reads the neck-shoulder junction; 0.8 of it.
  const shSide: Level = { ...shL, F: shL.F * 0.8, B: Math.max(shL.B * 0.8, lerp(neckL.B, chL.B, 0.5)) };
  const shoulder = torso(shSide, SECTION_BREADTH.shoulder, shoulderShell, { x: 1, f: 0.8, b: 1 }, 0.5);
  const chest = torso(chL, SECTION_BREADTH.chest, shell.chest, { x: 0.9, f: lerp(1.05, 1.75, bust), b: lerp(0.9, 0.8, bust) });
  const waist = torso(waL, SECTION_BREADTH.waist, shell.waist, { x: 1, f: 1.35, b: 0.75 });
  // lateral hip fat: saddlebags on the female template (drawing convention)
  const hipX = mixMF(w, 1.05, 1.35);
  const hip = torso(hiL, SECTION_BREADTH.hip, shell.hip, { x: hipX, f: 0.7, b: 1.25 });
  const crotch = torso(crL, SECTION_BREADTH.crotch, shell.hip, { x: hipX, f: 0.7, b: 1.2 });

  const limb = (L: Level, t: number, cx: number, minCore = 0.45): LimbSection => {
    const e = L.a;
    const d = L.b;
    return {
      y: L.y,
      e,
      c: clamp(e - t, e * minCore, e - SKIN_CM),
      d,
      cd: clamp(d - t, d * minCore, d - SKIN_CM),
      cx,
      shell: t,
    };
  };
  // leg spacing: the engine couples it to hip width; the skeleton (hip-joint spacing) sets a floor (own)
  const legCx = Math.max(thL.cx > 0 ? thL.cx : 0.45 * hiL.a, mixMF(w, 8.1, 7.7) * S);
  const thigh = limb(thL, shell.thigh, legCx);
  // the knee is a bony, flattened section: its front breadth is ~12 % under the circle of its girth (own)
  const knee = limb({ ...knL, a: knL.a * 0.88 }, clamp(0.4 * shell.thigh, SKIN_CM, 0.32 * knL.a), legCx);
  const calf = limb(caL, shell.calf, legCx);
  const ankle = limb(anL, clamp(0.12 * shell.calf, SKIN_CM, 0.2 * anL.a), legCx);
  const armCx = uaL.cx > 0 ? uaL.cx : shL.a - uaL.a;
  const upperArm = limb(uaL, shell.arm, armCx);
  const elbow = limb(elL, clamp(0.45 * shell.arm, SKIN_CM, 0.4 * elL.a), armCx);
  const forearm = limb(faL, clamp(0.55 * shell.arm, SKIN_CM, 0.45 * faL.a), armCx);
  const wrist = limb(wrL, clamp(0.12 * shell.arm, SKIN_CM, 0.25 * wrL.a), armCx);

  const anchors = FFMI_ANCHORS[sex];
  const fLo = anchors[2] ?? 19.5;
  const fHi = anchors[6] ?? 25;
  const muscularity = clamp((ffmi - fLo) / (fHi - fLo), 0, 1);

  const headA = headL.a;
  return {
    sex,
    baseW: w,
    H,
    S,
    neck,
    shoulder,
    chest,
    waist,
    hip,
    crotch,
    thigh,
    knee,
    calf,
    ankle,
    upperArm,
    elbow,
    forearm,
    wrist,
    armTop: { x: armCx, y: 0.807 * H },
    armAngleDeg: clamp(fin(params.armAngleDeg, 10), 4, 20),
    head: {
      rx: clamp(headA, 0.035 * H, 0.06 * H),
      ry: 0.066 * H,
      depth: clamp(fin(headL.b, 0.055 * H), 0.045 * H, 0.065 * H),
      cy: 0.935 * H,
      fullness: clamp(fin(params.faceFullness, 0), 0, 1),
    },
    muscularity,
    shell,
    vatKg,
    definition: params.definition,
  };
}
