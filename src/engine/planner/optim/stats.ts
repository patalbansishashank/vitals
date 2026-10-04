/**
 * Small numeric helpers shared by the optimisation core (no dependencies, no allocation-heavy code).
 * Everything here is deterministic; the only implementation-approximated Math functions used are
 * `exp`, `log` and `sqrt` (see dossier 18 §4.19 on cross-browser bitwise equality).
 */

/** Arithmetic mean (NaN for an empty input). */
export function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return s / values.length;
}

/** Ascending sorted copy. */
export function sortedCopy(values: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(values as ArrayLike<number>);
  out.sort();
  return out;
}

/** Quantile of an ascending-sorted array by linear interpolation (Hyndman-Fan type 7, as numpy/R default). */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Quantile of an unsorted array (type 7). */
export function quantile(values: ArrayLike<number>, p: number): number {
  return quantileSorted(sortedCopy(values), p);
}

/**
 * Lower conditional value-at-risk: mean of the worst (lowest) `alpha` share of the values
 * (at least one value). Used for the "cautious" robust ranking, CVaR_0.2 (dossier 18 §4.15, [35]).
 */
export function cvarLower(values: ArrayLike<number>, alpha: number): number {
  const s = sortedCopy(values);
  if (s.length === 0) return NaN;
  const k = Math.max(1, Math.ceil(alpha * s.length));
  let sum = 0;
  for (let i = 0; i < k; i++) sum += s[i]!;
  return sum / k;
}

/** Fractional ranks (1-based) with ties receiving their average rank. */
export function averageRanks(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => values[a]! - values[b]! || a - b);
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]!]! === values[idx[i]!]!) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!] = r;
    i = j + 1;
  }
  return ranks;
}

/** Pearson correlation (NaN when either input is constant or shorter than 2). */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa <= 0 || sbb <= 0) return NaN;
  return sab / Math.sqrt(saa * sbb);
}

/** Spearman rank correlation (Pearson on average ranks). */
export function spearman(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return pearson(averageRanks(a), averageRanks(b));
}

/** Complementary error function, Chebyshev fit with fractional error < 1.2e-7 everywhere. */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF Φ(x). */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/**
 * Standard normal quantile Φ⁻¹(p) (Acklam's rational approximation, relative error < 1.2e-9).
 * Returns ±Infinity at p = 0 / 1 and NaN outside [0, 1].
 */
export function normInv(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/** Clamp to [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
