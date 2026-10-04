// Kelly, Wilson & Heymsfield 2009 (PLoS ONE 4:e7038, Tables S1-S8) NHANES 1999-2004 whole-body DXA LMS reference
// values for Non-Hispanic White adults, as transcribed in dossier 14 sec. M4. Lean mass INCLUDES BMC.
// Each cell is (median M, sigma, skewness L); sigma is in the variable's own units, so S = sigma/M (dossier 14 M4).
// value(z) = M*(1 + L*S*z)^(1/L) ; z(x) = ((x/M)^L - 1)/(L*S). Linear interpolation of M, sigma, L between the
// tabulated ages; ages are clamped to the tabulated range 20-80 y (the dossier says "clamp 20-85" but the table ends at 80).

import type { Sex } from './types';
import { clamp, interp, normalCdf } from './math';

export type LmsVariable = 'pctFat' | 'fmi' | 'ffmi' | 'almi' | 'trunkLimb' | 'bmcG';

interface LmsColumn {
  M: readonly number[];
  sigma: readonly number[];
  L: readonly number[];
}

/** Tabulated ages (y). */
export const LMS_AGES: readonly number[] = [20, 30, 40, 50, 60, 70, 80];

// Dossier 14 M4 table (White), source Kelly 2009 [29] Tables S1-S8.
export const KELLY_WHITE_LMS: Readonly<Record<LmsVariable, Readonly<Record<Sex, LmsColumn>>>> = {
  pctFat: {
    male: {
      M: [23.4, 25.7, 27.5, 29.0, 30.5, 31.4, 31.6],
      sigma: [6.68, 6.25, 5.68, 5.3, 5.19, 5.11, 4.88],
      L: [0.221, 0.428, 0.631, 0.831, 1.028, 1.223, 1.418],
    },
    female: {
      M: [35.1, 37.0, 38.9, 40.8, 42.5, 43.0, 42.5],
      sigma: [7.22, 7.21, 6.96, 6.46, 5.86, 5.37, 5.14],
      L: [0.361, 0.785, 1.207, 1.626, 2.041, 2.453, 2.866],
    },
  },
  fmi: {
    male: {
      M: [5.95, 6.78, 7.57, 8.21, 8.71, 8.82, 8.46],
      sigma: [2.59, 2.77, 2.89, 2.91, 2.86, 2.66, 2.32],
      L: [-0.144, -0.084, -0.024, 0.037, 0.097, 0.157, 0.217],
    },
    female: {
      M: [8.48, 9.35, 10.27, 11.2, 12.03, 12.02, 11.27],
      sigma: [3.8, 3.98, 4.13, 4.25, 4.28, 3.99, 3.47],
      L: [-0.31, -0.188, -0.064, 0.059, 0.183, 0.308, 0.433],
    },
  },
  ffmi: {
    male: {
      M: [18.98, 19.6, 20.04, 20.15, 19.91, 19.36, 18.58],
      sigma: [2.5, 2.54, 2.56, 2.53, 2.44, 2.26, 2.03],
      L: [-1.115, -0.929, -0.74, -0.546, -0.348, -0.148, 0.053],
    },
    female: {
      M: [15.6, 16.03, 16.3, 16.35, 16.21, 15.92, 15.53],
      sigma: [2.01, 2.18, 2.32, 2.36, 2.3, 2.16, 1.98],
      L: [-1.404, -1.352, -1.299, -1.244, -1.188, -1.132, -1.076],
    },
  },
  almi: {
    male: {
      M: [8.87, 9.02, 9.12, 9.05, 8.81, 8.44, 7.97],
      sigma: [1.34, 1.31, 1.29, 1.25, 1.18, 1.09, 0.97],
      L: [-0.708, -0.524, -0.341, -0.157, 0.027, 0.21, 0.394],
    },
    female: {
      M: [6.81, 6.9, 6.95, 6.9, 6.76, 6.57, 6.33],
      sigma: [1.04, 1.11, 1.17, 1.18, 1.14, 1.06, 0.96],
      L: [-0.818, -0.817, -0.816, -0.813, -0.81, -0.808, -0.808],
    },
  },
  trunkLimb: {
    male: {
      M: [0.926, 1.063, 1.183, 1.281, 1.351, 1.361, 1.306],
      sigma: [0.156, 0.203, 0.241, 0.261, 0.267, 0.267, 0.257],
      L: [0.057, 0.185, 0.312, 0.439, 0.565, 0.692, 0.819],
    },
    female: {
      M: [0.745, 0.841, 0.897, 0.947, 0.998, 1.011, 0.976],
      sigma: [0.192, 0.22, 0.235, 0.245, 0.255, 0.256, 0.247],
      L: [0.183, 0.183, 0.183, 0.183, 0.183, 0.183, 0.183],
    },
  },
  bmcG: {
    male: {
      M: [2705, 2755, 2768, 2739, 2673, 2583, 2459],
      sigma: [431, 427, 411, 402, 411, 415, 412],
      L: [-0.284, -0.132, 0.021, 0.174, 0.327, 0.479, 0.632],
    },
    female: {
      M: [2124, 2177, 2198, 2150, 2034, 1879, 1703],
      sigma: [286, 294, 306, 309, 314, 316, 306],
      L: [0.138, 0.204, 0.271, 0.342, 0.417, 0.495, 0.574],
    },
  },
};

export interface LmsParams {
  M: number;
  S: number;
  L: number;
  sigma: number;
}

/** (M, S, L) at an age by linear interpolation of M, sigma and L (dossier 14 M4), age clamped to 20-80. */
export function lmsParams(variable: LmsVariable, sex: Sex, ageYears: number): LmsParams {
  const col = KELLY_WHITE_LMS[variable][sex];
  const age = clamp(ageYears, 20, 80);
  const M = interp(LMS_AGES, col.M, age);
  const sigma = interp(LMS_AGES, col.sigma, age);
  const L = interp(LMS_AGES, col.L, age);
  return { M, S: sigma / M, L, sigma };
}

const L_EPS = 1e-6;

/** Value at z-score z. */
export function lmsValue(variable: LmsVariable, sex: Sex, ageYears: number, z: number): number {
  const { M, S, L } = lmsParams(variable, sex, ageYears);
  if (Math.abs(L) < L_EPS) return M * Math.exp(S * z);
  const base = 1 + L * S * z;
  // Outside the support of the Box-Cox transform: return the boundary value (0 for L > 0, +inf for L < 0).
  if (base <= 0) return L > 0 ? 0 : Number.POSITIVE_INFINITY;
  return M * Math.pow(base, 1 / L);
}

/** z-score of an observed value x (> 0). */
export function lmsZ(variable: LmsVariable, sex: Sex, ageYears: number, x: number): number {
  const { M, S, L } = lmsParams(variable, sex, ageYears);
  const r = Math.max(x, 1e-9) / M;
  if (Math.abs(L) < L_EPS) return Math.log(r) / S;
  return (Math.pow(r, L) - 1) / (L * S);
}

/** Percentile (0-100) of x vs the NHANES White reference, P = 100*Phi(z). */
export function lmsPercentile(variable: LmsVariable, sex: Sex, ageYears: number, x: number): number {
  return 100 * normalCdf(lmsZ(variable, sex, ageYears, x));
}
