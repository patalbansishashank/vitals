/**
 * Baseline generators and individual-variability machinery of the cardiometabolic module (dossier 06 §2.3, §4.17).
 *
 * Data only (NHANES 2017-March 2020 weighted least-squares generators, computed by dossier author 06, ref R60) plus
 * three allocation-allowed helpers used in `prepare()`: the standard-normal quantile function, a Cholesky factor and
 * the correlated z-vector. Nothing here runs inside the step loop.
 *
 * MODEL_SPEC §1.14 step 8 / §8.1: person-level heterogeneity is a parameter draw. The ten latent quantiles
 * `cardiometabolic.u*` (draw 'uniform', nominal 0.5 ⇒ z = 0) are mapped through Φ⁻¹ and the Cholesky factor of the
 * residual correlation matrix `CORR` (06 §4.17); the nominal run therefore reproduces the population-mean person.
 */

/** Marker order of the 06 §4.17 residual correlation matrix and of the ten latent quantiles. */
export const Z_MARKERS = ['ldl', 'hdl', 'lnTg', 'sbp', 'fpg', 'lnIns', 'a1c', 'lnCrp', 'lnAlt', 'ua'] as const;
export type ZMarker = (typeof Z_MARKERS)[number];
export const N_Z = Z_MARKERS.length;

/** Table B3: y = a + b_age·(age − 45)/10 + b_bmi·(BMI − 27) + s·z (ln scale for lnTg, lnIns, lnCrp, lnAlt). */
export interface GeneratorRow {
  readonly a: number;
  readonly bAge: number;
  readonly bBmi: number;
  readonly sd: number;
}
export const GENERATORS: Readonly<Record<ZMarker, { readonly m: GeneratorRow; readonly f: GeneratorRow; readonly unit: string }>> = {
  ldl: { unit: 'mg/dL (Martin-Hopkins)', m: { a: 115.876, bAge: 5.327, bBmi: 1.104, sd: 32.011 }, f: { a: 112.964, bAge: 8.63, bBmi: 0.168, sd: 31.21 } },
  hdl: { unit: 'mg/dL', m: { a: 50.618, bAge: 0.878, bBmi: -0.702, sd: 12.056 }, f: { a: 61.179, bAge: 1.818, bBmi: -0.703, sd: 15.209 } },
  lnTg: { unit: 'ln mg/dL', m: { a: 4.508, bAge: 0.046, bBmi: 0.028, sd: 0.579 }, f: { a: 4.335, bAge: 0.088, bBmi: 0.019, sd: 0.5 } },
  sbp: { unit: 'mmHg', m: { a: 122.491, bAge: 2.409, bBmi: 0.156, sd: 12.878 }, f: { a: 115.729, bAge: 5.333, bBmi: 0.153, sd: 14.327 } },
  fpg: { unit: 'mg/dL', m: { a: 104.08, bAge: 2.293, bBmi: 0.448, sd: 17.356 }, f: { a: 99.426, bAge: 2.196, bBmi: 0.627, sd: 15.839 } },
  lnIns: { unit: 'ln µU/mL', m: { a: 2.08, bAge: 0.019, bBmi: 0.078, sd: 0.574 }, f: { a: 2.093, bAge: -0.02, bBmi: 0.051, sd: 0.535 } },
  a1c: { unit: '%', m: { a: 5.427, bAge: 0.099, bBmi: 0.012, sd: 0.511 }, f: { a: 5.413, bAge: 0.111, bBmi: 0.016, sd: 0.504 } },
  lnCrp: { unit: 'ln mg/L', m: { a: 0.319, bAge: 0.065, bBmi: 0.069, sd: 0.998 }, f: { a: 0.5, bAge: 0.017, bBmi: 0.076, sd: 0.988 } },
  lnAlt: { unit: 'ln U/L', m: { a: 3.098, bAge: -0.036, bBmi: 0.026, sd: 0.5 }, f: { a: 2.748, bAge: 0.031, bBmi: 0.012, sd: 0.47 } },
  ua: { unit: 'mg/dL', m: { a: 5.827, bAge: -0.015, bBmi: 0.059, sd: 1.247 }, f: { a: 4.502, bAge: 0.138, bBmi: 0.061, sd: 1.132 } },
};

/** 06 §4.17 residual correlation matrix (age- and BMI-adjusted, sex-averaged, n = 1888), row-major, order Z_MARKERS. */
export const CORR: readonly number[] = [
  // LDL   HDL    lnTG   SBP    FPG    lnINS  A1c    lnCRP  lnALT  UA
  1.0, -0.1, 0.38, 0.0, 0.04, 0.08, 0.06, 0.11, 0.1, 0.1, // LDL
  -0.1, 1.0, -0.43, 0.06, -0.1, -0.32, -0.13, -0.17, -0.05, 0.01, // HDL
  0.38, -0.43, 1.0, 0.04, 0.11, 0.29, 0.12, 0.14, 0.15, 0.16, // lnTG
  0.0, 0.06, 0.04, 1.0, 0.07, 0.08, 0.05, 0.05, 0.06, 0.05, // SBP
  0.04, -0.1, 0.11, 0.07, 1.0, 0.18, 0.75, 0.05, 0.07, -0.04, // FPG
  0.08, -0.32, 0.29, 0.08, 0.18, 1.0, 0.13, 0.09, 0.21, 0.06, // lnINS
  0.06, -0.13, 0.12, 0.05, 0.75, 0.13, 1.0, 0.12, 0.04, -0.04, // A1c
  0.11, -0.17, 0.14, 0.05, 0.05, 0.09, 0.12, 1.0, 0.02, 0.09, // lnCRP
  0.1, -0.05, 0.15, 0.06, 0.07, 0.21, 0.04, 0.02, 1.0, 0.09, // lnALT
  0.1, 0.01, 0.16, 0.05, -0.04, 0.06, -0.04, 0.09, 0.09, 1.0, // UA
];

/** Lower-triangular Cholesky factor of a symmetric positive-definite n×n matrix (row-major). Throws if not PD. */
export function cholesky(a: readonly number[], n: number): Float64Array {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= l[i * n + k]! * l[j * n + k]!;
      if (i === j) {
        if (sum <= 0) throw new Error('cholesky: matrix is not positive definite');
        l[i * n + j] = Math.sqrt(sum);
      } else l[i * n + j] = sum / l[j * n + j]!;
    }
  }
  return l;
}

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). p is clamped to
 * (1e-9, 1 − 1e-9) so the 0/1 ends of a `uniform` draw stay finite.
 */
export function normInv(p: number): number {
  const q0 = p < 1e-9 ? 1e-9 : p > 1 - 1e-9 ? 1 - 1e-9 : p;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (q0 < pLow) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (q0 > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - q0));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = q0 - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Correlated z-vector zc = L·Φ⁻¹(u) for ten latent quantiles u ∈ [0, 1] (06 §4.17). */
export function correlatedZ(u: ArrayLike<number>, chol: Float64Array): Float64Array {
  const raw = new Float64Array(N_Z);
  for (let i = 0; i < N_Z; i++) raw[i] = normInv(u[i]!);
  const z = new Float64Array(N_Z);
  for (let i = 0; i < N_Z; i++) {
    let s = 0;
    for (let j = 0; j <= i; j++) s += chol[i * N_Z + j]! * raw[j]!;
    z[i] = s;
  }
  return z;
}

/** Unit conversions (06 conventions): mmol/L ↔ mg/dL. */
export const MGDL_PER_MMOLL_CHOL = 38.67;
export const MGDL_PER_MMOLL_TG = 88.57;
export const MGDL_PER_MMOLL_GLC = 18.02;
