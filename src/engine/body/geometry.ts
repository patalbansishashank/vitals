// Cross-section model: circumferences from lean core + fat shell (dossier 14 sec. M8).
// C_j = sqrt(4*pi*(A_core_j + A_fat_j)) [cm, A in cm2]; A_fat_j = F_j*KV*1000/L_j.

import type { Sex } from './types';

/** Litres of adipose tissue per kg of DXA fat: AT = FM/0.85 at 0.92 kg/L (dossier 14 M8, PROPOSED). */
export const KV_L_PER_KG = 1.28; // PROPOSED

/** Median FFMI used as the lean-core anchor, kg/m2 (Kelly 2009 age-30 medians, dossier 14 M5/M8). */
export const FFMI0: Readonly<Record<Sex, number>> = { male: 19.6, female: 16.0 };

/** Share of FFM above the median that enlarges the waist/hip core (dossier 14 M8, kappa, PROPOSED FIT). */
export const KAPPA = 0.5; // PROPOSED

// Waist: effective length 38 cm; core coefficient a_w (cm2*m/kg) - dossier 14 M8, PROPOSED FIT to NHANES 2015-18 [41].
export const WAIST_L_CM = 38; // PROPOSED FIT
export const WAIST_A: Readonly<Record<Sex, number>> = { male: 9.7, female: 8.65 }; // PROPOSED FIT

// Hip: F = 0.55*legFat over L = 30 cm; a_h - dossier 14 M8 (grade C; anchored on Scafoglieri 2022 WHR [43]).
export const HIP_LEG_FAT_SHARE = 0.55; // UNVERIFIED
export const HIP_L_CM = 30; // PROPOSED
export const HIP_A: Readonly<Record<Sex, number>> = { male: 19.1, female: 22.5 }; // PROPOSED FIT

// Arm (MUAC): F = armFat/2 over L = 48 (M) / 46 (F) cm; A_core = a_a*SM_arm_one/(0.2*h) - dossier 14 M8,
// PROPOSED FIT to NHANES 2015-18 MUAC vs BMI (rmse 0.45 cm) [41]; implied arm-muscle length 29 cm.
export const ARM_FAT_L_CM: Readonly<Record<Sex, number>> = { male: 48, female: 46 }; // PROPOSED FIT
export const ARM_A: Readonly<Record<Sex, number>> = { male: 11.5, female: 11.25 }; // PROPOSED FIT

/** Waist loss hysteresis: waist falls 17 % less than geometry predicts on loss (dossier 14 M8; PROPOSED FIT to CALERIE-2 [49]). */
export const PSI_LOSS = 0.83; // PROPOSED FIT

const FOUR_PI = 4 * Math.PI;

export function circumferenceFromArea(areaCm2: number): number {
  return Math.sqrt(FOUR_PI * Math.max(areaCm2, 0));
}

export function areaFromCircumference(cCm: number): number {
  return (cCm * cCm) / FOUR_PI;
}

/** Fat shell area (cm2) of F kg of DXA fat spread over an effective length L (cm). */
export function fatArea(fatKg: number, lengthCm: number): number {
  return (fatKg * KV_L_PER_KG * 1000) / lengthCm;
}

/** Muscle area (cm2) of M kg of skeletal muscle (1.06 kg/L) spread over L (cm) - dossier 14 M8. */
export function muscleArea(muscleKg: number, lengthCm: number): number {
  return (muscleKg * 1000) / (1.06 * lengthCm);
}

/** Lean term FFMI0*h^2 + kappa*(FFM - FFMI0*h^2), kg (dossier 14 M8). */
export function leanCoreKg(sex: Sex, heightM: number, ffmKg: number): number {
  const ref = FFMI0[sex] * heightM * heightM;
  return ref + KAPPA * (ffmKg - ref);
}

export function waistCoreArea(sex: Sex, heightM: number, ffmKg: number): number {
  return (WAIST_A[sex] * leanCoreKg(sex, heightM, ffmKg)) / heightM;
}

/** Waist (cm) from FFM and trunk fat (SAT + VAT), dossier 14 M8 `waistFrom`. */
export function waistFromComposition(sex: Sex, heightM: number, ffmKg: number, trunkFatKg: number): number {
  return circumferenceFromArea(waistCoreArea(sex, heightM, ffmKg) + fatArea(trunkFatKg, WAIST_L_CM));
}

/** Inverse of `waistFromComposition` (dossier 14 M8 `trunkFromWaist`), unbounded except >= 0. */
export function trunkFatFromWaist(sex: Sex, heightM: number, ffmKg: number, waistCm: number): number {
  const aFat = areaFromCircumference(waistCm) - waistCoreArea(sex, heightM, ffmKg);
  return Math.max((aFat * WAIST_L_CM) / (KV_L_PER_KG * 1000), 0);
}

/** Hip (cm) from FFM and leg fat (both legs), dossier 14 M8 `hipFrom`. */
export function hipFromComposition(sex: Sex, heightM: number, ffmKg: number, legFatKg: number): number {
  const core = (HIP_A[sex] * leanCoreKg(sex, heightM, ffmKg)) / heightM;
  return circumferenceFromArea(core + fatArea(HIP_LEG_FAT_SHARE * legFatKg, HIP_L_CM));
}

/** MUAC (cm) from arm fat and arm skeletal muscle (both arms), dossier 14 M8 `muacFrom`. */
export function muacFromComposition(sex: Sex, heightM: number, armFatKg: number, armMuscleKg: number): number {
  const smArmOne = armMuscleKg / 2;
  const core = (ARM_A[sex] * smArmOne) / (0.2 * heightM);
  return circumferenceFromArea(core + fatArea(armFatKg / 2, ARM_FAT_L_CM[sex]));
}
