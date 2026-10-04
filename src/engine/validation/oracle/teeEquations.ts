/**
 * Independent TEE prediction equations from doubly-labelled water (dossier 02 §4.12), used as oracles for the activity
 * intake (R1 §7 V2, V4). No engine code is shared.
 *
 *  - NASEM 2023 DRI for Energy, adults ≥ 19 y: four PAL-category equations per sex (A years, H cm, W kg → kcal/d);
 *    SE of a predicted individual value: men 342 kcal/d; women ≈ 250 kcal/d (R1; women RMSE 246).
 *  - IAEA DLW equation (Bajunaid 2025, 6 497 measures): ln TEE (MJ/d) with a 95 % prediction interval
 *    lower = 0.7466·pTEE − 1.5405, upper = 1.3395·pTEE + 2.7668 (MJ/d). Worked example (02 §4.12): 90 kg, 180 cm, 35-y
 *    white man → 13.63 MJ = 3 258 kcal/d, PI 2 064-5 025 kcal/d.
 */
import { KCAL_PER_MJ } from '../../core/defaults';

export type NasemCategory = 'inactive' | 'lowActive' | 'active' | 'veryActive';

const NASEM: Record<'male' | 'female', Record<NasemCategory, readonly [number, number, number, number]>> = {
  // [intercept, age, height, weight]
  male: {
    inactive: [753.07, -10.83, 6.5, 14.1],
    lowActive: [581.47, -10.83, 8.3, 14.94],
    active: [1004.82, -10.83, 6.52, 15.91],
    veryActive: [-517.88, -10.83, 15.61, 19.11],
  },
  female: {
    inactive: [584.9, -7.01, 5.72, 11.71],
    lowActive: [575.77, -7.01, 6.6, 12.14],
    active: [710.25, -7.01, 6.54, 12.34],
    veryActive: [511.83, -7.01, 9.07, 12.56],
  },
};

/** NASEM 2023 standard error of a predicted individual TEE, kcal/d (men 342; women ≈ 250 per R1 V2). */
export const NASEM_SE_KCAL = { male: 342, female: 250 } as const;

/** NASEM 2023 adult TEE, kcal/d. */
export function nasemTee(sex: 'male' | 'female', ageY: number, heightCm: number, weightKg: number, cat: NasemCategory): number {
  const [a, b, c, d] = NASEM[sex][cat];
  return a + b * ageY + c * heightCm + d * weightKg;
}

export interface IaeaOptions {
  /** Elevation, m (158.5 when unknown, 02 §4.12). */
  elevationM?: number;
  /** Ethnicity dummy set; default white (the dossier's worked example). */
  ethnicity?: 'white' | 'notAvailable';
}

/** IAEA DLW predicted TEE and its 95 % PI, kcal/d. */
export function iaeaTee(sex: 'male' | 'female', ageY: number, heightCm: number, weightKg: number, o: IaeaOptions = {}): { tee: number; lo: number; hi: number } {
  const A = ageY;
  const H = heightCm;
  const le = Math.log(o.elevationM ?? 158.5);
  const s = sex === 'male' ? -1 : 1;
  const W = (o.ethnicity ?? 'white') === 'white' ? 1 : 0;
  const NA = o.ethnicity === 'notAvailable' ? 1 : 0;
  const ln =
    -0.2172 +
    0.4167 * Math.log(weightKg) +
    0.006565 * H -
    0.02054 * A +
    0.0003308 * A * A -
    0.000001852 * A * A * A +
    0.09126 * le -
    0.04092 * s +
    0.02626 * W +
    0.003589 * NA -
    0.0006759 * H * le +
    0.002018 * A * le -
    0.00002262 * A * A * le -
    0.006947 * s * le;
  const mj = Math.exp(ln);
  return { tee: mj * KCAL_PER_MJ, lo: (0.7466 * mj - 1.5405) * KCAL_PER_MJ, hi: (1.3395 * mj + 2.7668) * KCAL_PER_MJ };
}
