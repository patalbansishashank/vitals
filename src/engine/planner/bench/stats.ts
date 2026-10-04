/**
 * Statistics of the planner benchmark (statistical protocol and acceptance gate of the planner v2 specification):
 * paired Wilcoxon signed-rank test (exact permutation distribution with tied ranks up to 60 pairs, normal approximation
 * with tie and continuity correction beyond), Holm-Bonferroni adjustment, Vargha-Delaney Â₁₂ with its magnitude labels,
 * seeded percentile bootstrap, expected running time (COCO ERT) and the non-inferiority / superiority gate.
 * Pure and deterministic (all resampling uses the seeded `Rng`).
 */
import { Rng } from '../optim/rng';

// ---------------------------------------------------------------------------------------------------------------
// descriptive
// ---------------------------------------------------------------------------------------------------------------

export function mean(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Quantile of type 7 (linear interpolation; R's default and numpy's `linear`). */
export function quantile(xs: readonly number[], p: number): number {
  const v = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const h = (v.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return v[lo]! + (h - lo) * (v[hi]! - v[lo]!);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// normal distribution
// ---------------------------------------------------------------------------------------------------------------

/** Standard normal CDF (Cody's erfc rational approximations via the complementary error function, |error| < 1e-14). */
export function normCdf(z: number): number {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  return 0.5 * erfc(-z / Math.SQRT2);
}

function erfc(x: number): number {
  // W. J. Cody (1969) rational Chebyshev approximations, as used by many libms.
  const ax = Math.abs(x);
  let r: number;
  if (ax < 0.5) {
    const t = x * x;
    const top = (((0.18577770618460315 * t + 3.1611237438705655) * t + 113.86415415105016) * t + 377.485237685302) * t + 3209.3775891384694;
    const bot = (((t + 23.601290952344122) * t + 244.02463793444417) * t + 1282.6165260773723) * t + 2844.236833439171;
    return 1 - (x * top) / bot;
  }
  if (ax < 4) {
    const top = (((((((2.1531153547440383e-08 * ax + 0.5641884969886701) * ax + 8.883149794388377) * ax + 66.11919063714163) * ax + 298.6351381974001) * ax + 881.952221241769) * ax + 1712.0476126340707) * ax + 2051.0783778260716) * ax + 1230.3393547979972;
    const bot = (((((((ax + 15.744926110709835) * ax + 117.6939508913125) * ax + 537.1811018620099) * ax + 1621.3895745666903) * ax + 3290.7992357334597) * ax + 4362.619090143247) * ax + 3439.3676741437216) * ax + 1230.3393548037495;
    r = (Math.exp(-ax * ax) * top) / bot;
  } else {
    const z = 1 / (ax * ax);
    const top = ((((0.016315387137302097 * z + 0.30532663496123236) * z + 0.36034489994980445) * z + 0.12578172611122926) * z + 0.016083785148742275) * z + 0.0006587491615298378;
    const bot = ((((z + 2.568520192289822) * z + 1.8729528499234673) * z + 0.5279051029514285) * z + 0.06051834131244132) * z + 0.0023352049762686918;
    r = (Math.exp(-ax * ax) / ax) * (0.5641895835477551 - (z * top) / bot);
  }
  return x < 0 ? 2 - r : r;
}

// ---------------------------------------------------------------------------------------------------------------
// ranks
// ---------------------------------------------------------------------------------------------------------------

/** Average ranks (1-based) of the values, ties sharing the mean of their positions. */
export function averageRanks(xs: readonly number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]! || a - b);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]!] === xs[idx[i]!]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]!] = avg;
    i = j + 1;
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Wilcoxon signed-rank test (paired)
// ---------------------------------------------------------------------------------------------------------------

export type Alternative = 'two-sided' | 'greater' | 'less';

export interface WilcoxonResult {
  /** Pairs with a non-zero difference (zero differences are dropped, Wilcoxon's method). */
  n: number;
  /** Sum of the ranks of the positive differences x − y. */
  wPlus: number;
  wMinus: number;
  /** Normal score of W+ (tie- and continuity-corrected); NaN for the exact test. */
  z: number;
  p: number;
  method: 'exact' | 'normal' | 'none';
}

/** Largest number of non-zero pairs for the exact permutation distribution (doubled ranks ≤ 60·61 → tiny DP). */
export const WILCOXON_EXACT_MAX_N = 60;

/**
 * Paired Wilcoxon signed-rank test of x − y (alternative 'greater': x tends to exceed y). Zero differences are dropped;
 * ties get average ranks. Up to `WILCOXON_EXACT_MAX_N` pairs the p-value comes from the exact permutation distribution
 * of W+ given the (tied) ranks, beyond from the normal approximation with tie and continuity correction.
 * `tol`: |difference| ≤ tol counts as zero (floating noise between identical algorithms).
 */
export function wilcoxonSignedRank(
  x: readonly number[],
  y: readonly number[],
  alternative: Alternative = 'two-sided',
  opts: { tol?: number; exactMaxN?: number } = {},
): WilcoxonResult {
  if (x.length !== y.length) throw new RangeError('wilcoxonSignedRank: x and y differ in length');
  const tol = opts.tol ?? 0;
  const d: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const v = x[i]! - y[i]!;
    if (Number.isNaN(v)) continue;
    if (Math.abs(v) > tol) d.push(v);
  }
  const n = d.length;
  if (n === 0) return { n: 0, wPlus: 0, wMinus: 0, z: 0, p: 1, method: 'none' };
  const ranks = averageRanks(d.map(Math.abs));
  let wPlus = 0;
  for (let i = 0; i < n; i++) if (d[i]! > 0) wPlus += ranks[i]!;
  const total = (n * (n + 1)) / 2;
  const wMinus = total - wPlus;
  if (n <= (opts.exactMaxN ?? WILCOXON_EXACT_MAX_N)) {
    // exact null distribution of W+ given the ranks: each rank enters with probability 1/2 (doubled ranks are integers)
    const r2 = ranks.map((r) => Math.round(2 * r));
    const max = r2.reduce((a, b) => a + b, 0);
    let dist = new Float64Array(max + 1);
    dist[0] = 1;
    let reach = 0;
    for (const r of r2) {
      const next = new Float64Array(max + 1);
      for (let s = 0; s <= reach; s++) {
        const p = dist[s]!;
        if (p === 0) continue;
        next[s] = next[s]! + 0.5 * p;
        next[s + r] = next[s + r]! + 0.5 * p;
      }
      reach += r;
      dist = next;
    }
    const w2 = Math.round(2 * wPlus);
    let le = 0;
    let ge = 0;
    for (let s = 0; s <= max; s++) {
      if (s <= w2) le += dist[s]!;
      if (s >= w2) ge += dist[s]!;
    }
    const p = alternative === 'greater' ? ge : alternative === 'less' ? le : Math.min(1, 2 * Math.min(le, ge));
    return { n, wPlus, wMinus, z: NaN, p: Math.min(1, p), method: 'exact' };
  }
  // normal approximation: Var(W+) = n(n+1)(2n+1)/24 − Σ (t³ − t)/48 over tie groups
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  let tieCorr = 0;
  for (const t of counts.values()) if (t > 1) tieCorr += (t * t * t - t) / 48;
  const mu = total / 2;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieCorr);
  if (!(sd > 0)) return { n, wPlus, wMinus, z: 0, p: 1, method: 'normal' };
  const dev = wPlus - mu;
  // continuity correction: P(W+ ≥ w) ≈ P(Z ≥ (w − ½ − μ)/σ), P(W+ ≤ w) ≈ P(Z ≤ (w + ½ − μ)/σ)
  if (alternative === 'greater') {
    const z = (dev - 0.5) / sd;
    return { n, wPlus, wMinus, z, p: 1 - normCdf(z), method: 'normal' };
  }
  if (alternative === 'less') {
    const z = (dev + 0.5) / sd;
    return { n, wPlus, wMinus, z, p: normCdf(z), method: 'normal' };
  }
  const za = Math.max(0, Math.abs(dev) - 0.5) / sd;
  return { n, wPlus, wMinus, z: Math.sign(dev) * za, p: Math.min(1, 2 * (1 - normCdf(za))), method: 'normal' };
}

// ---------------------------------------------------------------------------------------------------------------
// multiple comparisons, effect size
// ---------------------------------------------------------------------------------------------------------------

/** Holm-Bonferroni step-down adjusted p-values (monotone, capped at 1), in input order. NaN entries stay NaN. */
export function holm(p: readonly number[]): number[] {
  const idx = p.map((_, i) => i).filter((i) => !Number.isNaN(p[i]!));
  idx.sort((a, b) => p[a]! - p[b]! || a - b);
  const m = idx.length;
  const out = p.map(() => NaN);
  let run = 0;
  idx.forEach((i, k) => {
    run = Math.max(run, Math.min(1, (m - k) * p[i]!));
    out[i] = run;
  });
  return out;
}

/** Vargha-Delaney Â₁₂ = P(X > Y) + ½ P(X = Y) over all pairs (probability that algorithm X scores higher than Y). */
export function varghaDelaney(x: readonly number[], y: readonly number[], tol = 0): number {
  const xs = x.filter((v) => !Number.isNaN(v));
  const ys = y.filter((v) => !Number.isNaN(v));
  if (!xs.length || !ys.length) return NaN;
  // rank-sum form: A = (R1/m − (m+1)/2)/n, ties averaged; tolerance merges near-equal values first
  const all = [...xs.map((v) => ({ v, g: 0 })), ...ys.map((v) => ({ v, g: 1 }))];
  if (tol > 0) {
    all.sort((a, b) => a.v - b.v);
    for (let i = 1; i < all.length; i++) if (all[i]!.v - all[i - 1]!.v <= tol) all[i]!.v = all[i - 1]!.v;
  }
  const ranks = averageRanks(all.map((a) => a.v));
  let r1 = 0;
  all.forEach((a, i) => {
    if (a.g === 0) r1 += ranks[i]!;
  });
  const m = xs.length;
  const n = ys.length;
  return (r1 / m - (m + 1) / 2) / n;
}

export type EffectMagnitude = 'negligible' | 'small' | 'medium' | 'large';

/** Magnitude of Â₁₂ (Vargha & Delaney 2000 thresholds 0.56 / 0.64 / 0.71, symmetric around 0.5). */
export function a12Magnitude(a: number): EffectMagnitude {
  const e = Math.max(a, 1 - a);
  return e >= 0.71 ? 'large' : e >= 0.64 ? 'medium' : e >= 0.56 ? 'small' : 'negligible';
}

// ---------------------------------------------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------------------------------------------

export interface BootstrapCI {
  estimate: number;
  lo: number;
  hi: number;
  /** Bootstrap replicates of the statistic (sorted), kept for one-sided tests. */
  reps: Float64Array;
}

/**
 * Percentile bootstrap of `stat` over `B` resamples (default 10⁴) of the units (rows resampled with replacement,
 * optionally within strata). Seeded: the same inputs give the same interval.
 */
export function bootstrap<T>(
  units: readonly T[],
  stat: (sample: readonly T[]) => number,
  opts: { B?: number; alpha?: number; seed?: number | string; strata?: (u: T) => string } = {},
): BootstrapCI {
  const B = opts.B ?? 10_000;
  const alpha = opts.alpha ?? 0.05;
  const rng = new Rng(opts.seed ?? 'bench/bootstrap');
  const estimate = stat(units);
  const groups: T[][] = [];
  if (opts.strata) {
    const m = new Map<string, T[]>();
    for (const u of units) {
      const k = opts.strata(u);
      let g = m.get(k);
      if (!g) m.set(k, (g = []));
      g.push(u);
    }
    for (const k of [...m.keys()].sort()) groups.push(m.get(k)!);
  } else groups.push([...units]);
  const reps = new Float64Array(B);
  const sample: T[] = new Array(units.length);
  for (let b = 0; b < B; b++) {
    let k = 0;
    for (const g of groups) for (let i = 0; i < g.length; i++) sample[k++] = g[rng.int(g.length)]!;
    reps[b] = stat(sample);
  }
  reps.sort();
  const q = (p: number) => {
    const finite = reps.filter((v) => Number.isFinite(v));
    if (!finite.length) return NaN;
    const h = (finite.length - 1) * p;
    const lo = Math.floor(h);
    return finite[lo]! + (h - lo) * (finite[Math.ceil(h)]! - finite[lo]!);
  };
  return { estimate, lo: q(alpha / 2), hi: q(1 - alpha / 2), reps };
}

/** One-sided bootstrap bound: the α-quantile ('lower') or (1 − α)-quantile ('upper') of the replicates. */
export function bootstrapBound(ci: BootstrapCI, side: 'lower' | 'upper', alpha = 0.05): number {
  const finite = ci.reps.filter((v) => Number.isFinite(v));
  if (!finite.length) return NaN;
  const p = side === 'lower' ? alpha : 1 - alpha;
  const h = (finite.length - 1) * p;
  const lo = Math.floor(h);
  return finite[lo]! + (h - lo) * (finite[Math.ceil(h)]! - finite[lo]!);
}

// ---------------------------------------------------------------------------------------------------------------
// expected running time (COCO)
// ---------------------------------------------------------------------------------------------------------------

/**
 * ERT = (Σ over runs of the EU spent until the target was first hit, or the whole run when it never was) / #hits
 * (Infinity without hits). `runs[i] = { hit: EU at first hit or null, used: EU of the whole run }`.
 */
export function ert(runs: ReadonlyArray<{ hit: number | null; used: number }>): number {
  let sum = 0;
  let hits = 0;
  for (const r of runs) {
    if (r.hit !== null) {
      sum += r.hit;
      hits++;
    } else sum += r.used;
  }
  return hits ? sum / hits : Infinity;
}

// ---------------------------------------------------------------------------------------------------------------
// acceptance gate
// ---------------------------------------------------------------------------------------------------------------

/** Non-inferiority margins and the superiority effect threshold of the acceptance gate. */
export const GATE = {
  /** Lex-success may not drop by more than 2 points (share of runs). */
  lexSuccessMargin: 0.02,
  /** Goal-1 regret may not grow by more than 1 % of goal 1's achievable range (desirability units). */
  regretMargin: 0.01,
  alpha: 0.05,
  a12Small: 0.56,
  /** "Equal quality at ≥ 20 % less wall time". */
  wallSaving: 0.2,
} as const;

export interface PairedUnit {
  problem: string;
  seed: number;
  /** Lex-success 0/1 of v1 (baseline) and v2 (candidate). */
  ls1: number;
  ls2: number;
  /** Goal-1 regret (desirability units, lower is better). */
  r1a: number;
  r1b: number;
  /** Primary quality score (higher is better): reference-relative attainment of the returned Hard plan. */
  q1: number;
  q2: number;
  wall1: number;
  wall2: number;
}

export interface SuiteGate {
  pairs: number;
  /** Mean lex-success difference (v2 − v1) and its one-sided 95 % lower bound. */
  lexSuccessDelta: number;
  lexSuccessLower: number;
  /** Mean goal-1 regret difference (v2 − v1, lower is better) and its one-sided 95 % upper bound. */
  regretDelta: number;
  regretUpper: number;
  nonInferior: boolean;
  /** Paired Wilcoxon (two-sided) on the quality score, p before Holm (filled in by `gateVerdict`). */
  p: number;
  pHolm: number;
  a12: number;
  /** Median wall-time ratio v2 / v1. */
  wallRatio: number;
  superior: boolean;
  fasterAtEqualQuality: boolean;
}

/** Per-suite gate statistics: bootstrap non-inferiority (stratified by problem) and the paired Wilcoxon on quality. */
export function suiteGate(units: readonly PairedUnit[], seed: string): SuiteGate {
  const strata = (u: PairedUnit) => u.problem;
  const ls = bootstrap(units, (s) => mean(s.map((u) => u.ls2 - u.ls1)), { seed: `${seed}/ls`, strata });
  const rg = bootstrap(units, (s) => mean(s.map((u) => u.r1b - u.r1a)), { seed: `${seed}/r1`, strata });
  const lexSuccessLower = bootstrapBound(ls, 'lower', GATE.alpha);
  const regretUpper = bootstrapBound(rg, 'upper', GATE.alpha);
  const nonInferior = lexSuccessLower >= -GATE.lexSuccessMargin - 1e-12 && regretUpper <= GATE.regretMargin + 1e-12;
  const w = wilcoxonSignedRank(units.map((u) => u.q2), units.map((u) => u.q1), 'two-sided', { tol: 1e-9 });
  const a12 = varghaDelaney(units.map((u) => u.q2), units.map((u) => u.q1), 1e-9);
  const ratios = units.filter((u) => u.wall1 > 0 && u.wall2 > 0).map((u) => u.wall2 / u.wall1);
  const wallRatio = ratios.length ? median(ratios) : NaN;
  return {
    pairs: units.length,
    lexSuccessDelta: ls.estimate,
    lexSuccessLower,
    regretDelta: rg.estimate,
    regretUpper,
    nonInferior,
    p: w.p,
    pHolm: NaN,
    a12,
    wallRatio,
    superior: false,
    fasterAtEqualQuality: false,
  };
}

export interface GateVerdict {
  pass: boolean;
  nonInferiorAll: boolean;
  superiorSuites: string[];
  fasterSuites: string[];
  text: string;
}

/**
 * The gate over suites: (1) non-inferior on every suite; (2) superior on ≥ 1 suite (Holm-adjusted p < 0.05 across
 * suites and Â₁₂ ≥ 0.56 in favour of v2) or equal quality at ≥ 20 % less wall time. Mutates `pHolm`, `superior`,
 * `fasterAtEqualQuality` of the suite entries.
 */
export function gateVerdict(suites: Record<string, SuiteGate>): GateVerdict {
  const names = Object.keys(suites);
  const adj = holm(names.map((k) => suites[k]!.p));
  names.forEach((k, i) => {
    const s = suites[k]!;
    s.pHolm = adj[i]!;
    s.superior = s.nonInferior && s.pHolm < GATE.alpha && s.a12 >= GATE.a12Small;
    s.fasterAtEqualQuality = s.nonInferior && s.wallRatio <= 1 - GATE.wallSaving;
  });
  const nonInferiorAll = names.length > 0 && names.every((k) => suites[k]!.nonInferior);
  const superiorSuites = names.filter((k) => suites[k]!.superior);
  const fasterSuites = names.filter((k) => suites[k]!.fasterAtEqualQuality);
  const pass = nonInferiorAll && (superiorSuites.length > 0 || fasterSuites.length > 0);
  const failing = names.filter((k) => !suites[k]!.nonInferior);
  const text = pass
    ? `passes: non-inferior on every suite; ${superiorSuites.length ? `better on ${superiorSuites.join(', ')}` : `as good and at least 20 % faster on ${fasterSuites.join(', ')}`}`
    : !nonInferiorAll
      ? `fails: not shown to be non-inferior on ${failing.join(', ')}`
      : 'fails: non-inferior everywhere but neither better on any suite nor 20 % faster at equal quality';
  return { pass, nonInferiorAll, superiorSuites, fasterSuites, text };
}
