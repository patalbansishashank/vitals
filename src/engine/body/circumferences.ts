// State -> circumferences (dossier 14 sec. M8), including the reference-proportion regions and the waist loss hysteresis.

import type { BodyState, Circumferences, Sex } from './types';
import { cunBae, dxaFrameOffset } from './equations';
import {
  PSI_LOSS,
  areaFromCircumference,
  circumferenceFromArea,
  fatArea,
  hipFromComposition,
  muacFromComposition,
  muscleArea,
  waistFromComposition,
} from './geometry';
import { partitionComposition } from './partition';

// ---- reference-proportion regions (dossier 14 M8 "Other regions": no verified population regression; all UNVERIFIED) ----
/** Reference composition for the height-proportional defaults: BMI 24 (M) / 22 (F) (dossier 14 M8). */
export const REF_BMI: Readonly<Record<Sex, number>> = { male: 24, female: 22 }; // UNVERIFIED
/** Age of the reference body (own choice; the dossier does not state one). */
export const REF_AGE_Y = 30; // PROPOSED
/** Default girths as a fraction of stature H (dossier 14 M8; UNVERIFIED). */
export const REF_GIRTH_FRAC: Readonly<Record<Sex, { neck: number; chest: number; thigh: number; calf: number }>> = {
  male: { neck: 0.222, chest: 0.555, thigh: 0.31, calf: 0.207 }, // UNVERIFIED
  female: { neck: 0.192, chest: 0.525, thigh: 0.34, calf: 0.21 }, // UNVERIFIED
};
/**
 * Bideltoid breadth 0.259*H (Drillis-Contini as tabulated in Winter; dossier 14 M8/M10, UNVERIFIED). The dossier gives one
 * value for both sexes; women get x0.95 (own PROPOSED deviation, so female shoulders are not as wide as male at equal
 * height and BMI - replace with ANSUR II ratios when fitted offline, dossier 14 M8 recommendation).
 */
export const BIDELTOID_FRAC: Readonly<Record<Sex, number>> = { male: 0.259, female: 0.259 * 0.95 }; // UNVERIFIED / PROPOSED (female)
/** Bideltoid grows 0.29 cm per cm of MUAC above reference (dossier 14 M10, PROPOSED). */
export const BIDELTOID_MUAC_SLOPE = 0.29; // PROPOSED
/** Skeletal widths scale by 1 + 0.03*z_frame (dossier 14 M5, PROPOSED). */
export const FRAME_WIDTH_PER_Z = 0.03; // PROPOSED
/** Effective fat lengths, cm: chest 25, thigh 38, calf 28, neck 10 (dossier 14 M8; UNVERIFIED). */
export const REGION_FAT_L_CM = { chest: 25, thigh: 38, calf: 28, neck: 10 } as const; // UNVERIFIED
/** Effective muscle lengths, cm: thigh 38, calf 28 (dossier 14 M8; UNVERIFIED); chest 25 (own, PROPOSED). */
export const REGION_MUSCLE_L_CM = { chest: 25, thigh: 38, calf: 28 } as const; // UNVERIFIED / PROPOSED (chest)
/** Thigh = 0.6 x leg fat, calf = 0.15 x leg fat (dossier 14 M8; UNVERIFIED). Applied per leg (leg depot / 2): interpretation. */
export const THIGH_LEG_SHARE = 0.6; // UNVERIFIED
export const CALF_LEG_SHARE = 0.15; // UNVERIFIED
/** Share of the head/neck fat depot that sits at the neck level (own; dossier silent). */
export const NECK_HEAD_FAT_SHARE = 0.3; // PROPOSED
/** Share of trunk skeletal muscle in the chest band (pecs, lats, upper back) (own; dossier silent). */
export const CHEST_TRUNK_MUSCLE_SHARE = 0.5; // PROPOSED

/** Region masses the reference-proportion girths respond to. */
interface RegionMasses {
  neckFat: number;
  chestFat: number;
  chestMuscle: number;
  thighFat: number;
  thighMuscle: number;
  calfFat: number;
  calfMuscle: number;
}

function regionMasses(s: Pick<BodyState, 'fat' | 'muscle' | 'satShares'>): RegionMasses {
  return {
    neckFat: NECK_HEAD_FAT_SHARE * s.fat.headKg,
    chestFat: s.satShares.chest * s.fat.trunkSatKg,
    chestMuscle: CHEST_TRUNK_MUSCLE_SHARE * s.muscle.trunkKg,
    thighFat: (THIGH_LEG_SHARE * s.fat.legsKg) / 2,
    thighMuscle: (THIGH_LEG_SHARE * s.muscle.legsKg) / 2,
    calfFat: (CALF_LEG_SHARE * s.fat.legsKg) / 2,
    calfMuscle: (CALF_LEG_SHARE * s.muscle.legsKg) / 2,
  };
}

interface ReferenceBody {
  masses: RegionMasses;
  muacCm: number;
  /** Trunk skeletal muscle of the reference body, kg (scales the drawn abdominal wall, R2 sec. 3.3). */
  trunkMuscleKg: number;
}

/** The reference body: same sex and height, BMI 24/22, age 30, CUN-BAE + DXA-offset composition, median fat pattern. */
export function referenceBody(sex: Sex, heightCm: number): ReferenceBody {
  const h = heightCm / 100;
  const bmi = REF_BMI[sex];
  const W = bmi * h * h;
  const bf = cunBae(sex, REF_AGE_Y, bmi) + dxaFrameOffset(sex, REF_AGE_Y);
  const p = partitionComposition({ sex, ageYears: REF_AGE_Y, heightCm, weightKg: W, bodyFatPct: bf, bellyZ: 0 });
  const state = { fat: p.fat, muscle: p.muscle, satShares: p.satShares };
  return {
    masses: regionMasses(state),
    muacCm: muacFromComposition(sex, h, p.fat.armsKg, p.muscle.armsKg),
    trunkMuscleKg: p.muscle.trunkKg,
  };
}

/** C = sqrt(C_ref^2 + 4*pi*(dA_fat + dA_muscle)) - exact area form of dC = 2*pi*dA/C (dossier 14 M8). Floor at 50 % of the reference area. */
function adjustGirth(cRef: number, dAreaCm2: number): number {
  const aRef = areaFromCircumference(cRef);
  return circumferenceFromArea(Math.max(aRef + dAreaCm2, 0.5 * aRef));
}

/** Geometric (model) circumferences of a state, without anchors or hysteresis. */
export function geometricCircumferences(s: BodyState): Circumferences {
  const { sex } = s;
  const H = s.heightCm;
  const h = H / 100;
  const trunkFat = s.fat.trunkSatKg + s.fat.vatKg;
  const waistCm = waistFromComposition(sex, h, s.fatFreeMassKg, trunkFat);
  const hipCm = hipFromComposition(sex, h, s.fatFreeMassKg, s.fat.legsKg);
  const armCm = muacFromComposition(sex, h, s.fat.armsKg, s.muscle.armsKg);

  const ref = referenceBody(sex, H);
  const m = regionMasses(s);
  const frac = REF_GIRTH_FRAC[sex];
  const neckCm = adjustGirth(frac.neck * H, fatArea(m.neckFat - ref.masses.neckFat, REGION_FAT_L_CM.neck));
  const chestCm = adjustGirth(
    frac.chest * H,
    fatArea(m.chestFat - ref.masses.chestFat, REGION_FAT_L_CM.chest) +
      muscleArea(m.chestMuscle - ref.masses.chestMuscle, REGION_MUSCLE_L_CM.chest),
  );
  const thighCm = adjustGirth(
    frac.thigh * H,
    fatArea(m.thighFat - ref.masses.thighFat, REGION_FAT_L_CM.thigh) +
      muscleArea(m.thighMuscle - ref.masses.thighMuscle, REGION_MUSCLE_L_CM.thigh),
  );
  const calfCm = adjustGirth(
    frac.calf * H,
    fatArea(m.calfFat - ref.masses.calfFat, REGION_FAT_L_CM.calf) +
      muscleArea(m.calfMuscle - ref.masses.calfMuscle, REGION_MUSCLE_L_CM.calf),
  );
  const bideltoidCm = BIDELTOID_FRAC[sex] * H * (1 + FRAME_WIDTH_PER_Z * s.frameZ) + BIDELTOID_MUAC_SLOPE * (armCm - ref.muacCm);
  return { neckCm, bideltoidCm, chestCm, waistCm, hipCm, thighCm, calfCm, armCm };
}

const CIRC_KEYS: readonly (keyof Circumferences)[] = [
  'neckCm',
  'bideltoidCm',
  'chestCm',
  'waistCm',
  'hipCm',
  'thighCm',
  'calfCm',
  'armCm',
];

/**
 * Displayed circumferences (dossier 14 M12 `circumferences`): anchor (user-measured value at baseline, else the
 * baseline's geometric value) + change of the geometric value since baseline, with psi = 0.83 on waist loss.
 * Without a baseline the state is its own baseline (so measured values are returned as-is).
 */
export function circumferencesFor(s: BodyState, baseline?: BodyState): Circumferences {
  const base = baseline ?? s;
  const geo = geometricCircumferences(s);
  const geo0 = baseline ? geometricCircumferences(base) : geo;
  const anchors = base.measuredCircumferences ?? {};
  const out = { ...geo };
  for (const k of CIRC_KEYS) {
    const d = geo[k] - geo0[k];
    const factor = k === 'waistCm' && d < 0 ? PSI_LOSS : 1;
    out[k] = (anchors[k] ?? geo0[k]) + factor * d;
  }
  return out;
}
