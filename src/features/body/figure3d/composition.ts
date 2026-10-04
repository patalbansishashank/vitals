/**
 * Drawing inputs for the anatomical layers. Masses are engine outputs, while the
 * transverse scales are visual conventions: a fixed-length volume changes with
 * the square of its radius. They are not measurements of this person's anatomy.
 */
import type { AvatarParams, Sex } from '@/engine/body';

export interface TissueRegion {
  massKg: number;
  /** Radius in x/z relative to a neutral anatomy mesh at the same stature. */
  transverseScale: number;
}

export interface BodyComposition {
  skeleton: {
    heightCm: number;
    sex: Sex;
    /** 0 hips-led .. 1 shoulders-led. It changes the frame, never tissue mass. */
    frame: number;
    shoulderScale: number;
    hipScale: number;
  };
  muscle: {
    arms: TissueRegion;
    legs: TissueRegion;
    trunk: TissueRegion;
    totalKg: number;
  };
  subcutaneous: {
    head: TissueRegion;
    arms: TissueRegion;
    legs: TissueRegion;
    trunk: TissueRegion;
    trunkShares: { abdominal: number; chest: number; backFlank: number };
    totalKg: number;
  };
  visceral: {
    /** No scan is provided by AvatarParams; even a supplied waist gives an estimate. */
    estimated: true;
    massKg: number;
    areaCm2: number;
    areaRangeCm2: [number, number];
    /** Conservative inner limits from the estimated waist ellipse, in cm. */
    cavityHalfWidthCm: number;
    cavityHalfDepthCm: number;
    /** Radius of the schematic abdominal fill relative to 100 cm². */
    transverseScale: number;
  };
  /** The engine's hard constraint, reconstructed from its fat and lean indices. */
  weightKg: number;
  fatFreeMassKg: number;
  fatMassKg: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// Neutral drawing baselines per m² of stature, not population reference values.
// Muscle totals match the engine avatar's proposed SMI references; regional shares
// follow its unverified typical distribution. Fat values merely calibrate the mesh.
const REF = {
  male: {
    muscle: { arms: 10.2 * 0.115, legs: 10.2 * 0.56, trunk: 10.2 * 0.325 },
    sat: { head: 0.25, arms: 0.55, legs: 2.2, trunk: 2.4 },
  },
  female: {
    muscle: { arms: 7.6 * 0.105, legs: 7.6 * 0.58, trunk: 7.6 * 0.315 },
    sat: { head: 0.3, arms: 0.8, legs: 3.6, trunk: 3.1 },
  },
} as const;

function region(massKg: number, refKgPerM2: number, heightM2: number): TissueRegion {
  // At fixed height, volume ~ mass and transverse area ~ volume / height.
  // Limits prevent self-intersection and implausible spikes outside trained range.
  return {
    massKg,
    transverseScale: clamp(Math.sqrt(Math.max(0, massKg) / (refKgPerM2 * heightM2)), 0.5, 1.9),
  };
}

export function compositionFromParams(p: AvatarParams, frameOverride = p.figure.frame): BodyComposition {
  const h2 = (p.heightCm / 100) ** 2;
  const ref = REF[p.sex];
  const m = p.figure.muscleKg;
  const f = p.figure.fatKg;
  const frame = clamp(frameOverride, 0, 1);
  const fatMassKg = f.head + f.arms + f.legs + f.trunkSat + f.vat;
  const fatFreeMassKg = p.outputs.ffmi * h2;
  return {
    skeleton: {
      heightCm: p.heightCm,
      sex: p.sex,
      frame,
      shoulderScale: 0.94 + 0.12 * frame,
      hipScale: 1.06 - 0.12 * frame,
    },
    muscle: {
      arms: region(m.arms, ref.muscle.arms, h2),
      legs: region(m.legs, ref.muscle.legs, h2),
      trunk: region(m.trunk, ref.muscle.trunk, h2),
      totalKg: m.arms + m.legs + m.trunk,
    },
    subcutaneous: {
      head: region(f.head, ref.sat.head, h2),
      arms: region(f.arms, ref.sat.arms, h2),
      legs: region(f.legs, ref.sat.legs, h2),
      trunk: region(f.trunkSat, ref.sat.trunk, h2),
      trunkShares: { ...p.figure.satShares },
      totalKg: f.head + f.arms + f.legs + f.trunkSat,
    },
    visceral: {
      estimated: true,
      massKg: f.vat,
      areaCm2: p.visceral.vatAreaCm2,
      areaRangeCm2: [...p.visceral.areaRangeCm2],
      cavityHalfWidthCm: p.visceral.waist.halfWidthCm * 0.62,
      cavityHalfDepthCm: p.visceral.waist.halfDepthCm * 0.62,
      transverseScale: clamp(Math.sqrt(Math.max(0, p.visceral.vatAreaCm2) / 100), 0.25, 2),
    },
    weightKg: fatFreeMassKg + fatMassKg,
    fatFreeMassKg,
    fatMassKg,
  };
}
