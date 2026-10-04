// Small pure numeric helpers for the body module. No dependencies, deterministic.

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Safe indexed read for `noUncheckedIndexedAccess` (tables are static, so a miss is a programming error). */
export function at(arr: readonly number[], i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range (length ${arr.length})`);
  return v;
}

/** Piecewise-linear interpolation of ys over ascending xs, clamped to the end values outside the range. */
export function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0 || n !== ys.length) throw new RangeError('interp: bad table');
  if (x <= at(xs, 0)) return at(ys, 0);
  if (x >= at(xs, n - 1)) return at(ys, n - 1);
  for (let i = 1; i < n; i++) {
    const x1 = at(xs, i);
    if (x <= x1) {
      const x0 = at(xs, i - 1);
      return lerp(at(ys, i - 1), at(ys, i), (x - x0) / (x1 - x0));
    }
  }
  return at(ys, n - 1);
}

/** Hermite smoothstep: 0 at lo, 1 at hi, clamped. */
export function smoothstep(x: number, lo: number, hi: number): number {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

/** Standard-normal CDF. erfc via the Numerical-Recipes Chebyshev fit (|rel err| < 1.2e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const y =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  // y = erfc(x); Phi(z) = 1 - erfc(z/sqrt2)/2 for z >= 0
  return z >= 0 ? 1 - 0.5 * y : 0.5 * y;
}

/** Inverse standard-normal CDF (Acklam 2003 rational approximation, |rel err| < 1.2e-9). */
export function normalQuantile(p: number): number {
  const pp = clamp(p, 1e-12, 1 - 1e-12);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const A = (i: number) => at(a, i);
  const B = (i: number) => at(b, i);
  const C = (i: number) => at(c, i);
  const D = (i: number) => at(d, i);
  if (pp < pLow) {
    const q = Math.sqrt(-2 * Math.log(pp));
    return (((((C(0) * q + C(1)) * q + C(2)) * q + C(3)) * q + C(4)) * q + C(5)) / ((((D(0) * q + D(1)) * q + D(2)) * q + D(3)) * q + 1);
  }
  if (pp > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - pp));
    return -(((((C(0) * q + C(1)) * q + C(2)) * q + C(3)) * q + C(4)) * q + C(5)) / ((((D(0) * q + D(1)) * q + D(2)) * q + D(3)) * q + 1);
  }
  const q = pp - 0.5;
  const r = q * q;
  return (
    ((((((A(0) * r + A(1)) * r + A(2)) * r + A(3)) * r + A(4)) * r + A(5)) * q) /
    (((((B(0) * r + B(1)) * r + B(2)) * r + B(3)) * r + B(4)) * r + 1)
  );
}

/**
 * Solve S x = b for a symmetric positive-definite S (Cholesky). Used by the GLS fusion (at most ~6x6).
 * Throws if S is not positive definite.
 */
export function solveSpd(S: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const get = (m: readonly (readonly number[])[], i: number, j: number): number => {
    const row = m[i];
    const v = row?.[j];
    if (v === undefined) throw new RangeError('solveSpd: matrix index out of range');
    return v;
  };
  const Lrow = (i: number): number[] => {
    const row = L[i];
    if (!row) throw new RangeError('solveSpd: row out of range');
    return row;
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = get(S, i, j);
      for (let k = 0; k < j; k++) sum -= get(L, i, k) * get(L, j, k);
      if (i === j) {
        if (sum <= 0) throw new RangeError('solveSpd: matrix not positive definite');
        Lrow(i)[j] = Math.sqrt(sum);
      } else {
        Lrow(i)[j] = sum / get(L, j, j);
      }
    }
  }
  // forward: L y = b
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = at(b, i);
    for (let k = 0; k < i; k++) sum -= get(L, i, k) * at(y, k);
    y[i] = sum / get(L, i, i);
  }
  // backward: L' x = y
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = at(y, i);
    for (let k = i + 1; k < n; k++) sum -= get(L, k, i) * at(x, k);
    x[i] = sum / get(L, i, i);
  }
  return x;
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
