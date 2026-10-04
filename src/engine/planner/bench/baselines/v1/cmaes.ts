/* Frozen copy of the v1 planner optimiser (src/engine/planner/optim as of 2026-10-01, before planner v2; PLANNER_V2_SPEC §5.1 "the v1 planner is frozen behind an adapter"). Do not edit: the benchmark harness measures every v2 change against it. */
/**
 * Compact CMA-ES (dossier 18 §4.10) with an ask/tell interface.
 *
 * - Defaults from Hansen's tutorial [1]: λ = 4 + ⌊3 ln n⌋, μ = ⌊λ/2⌋, log weights, CSA step size,
 *   rank-one + rank-μ covariance update, lazy eigendecomposition (own Jacobi solver, §4.20).
 * - `sep` mode (Ros & Hansen [4]): diagonal covariance, learning rates × (n + 2)/3, O(n) per sample.
 * - Ranking is by *keys* (lexicographic number tuples, smaller is better), so Deb feasibility rules and
 *   the ε-lexicographic stage comparators of §4.7.3 plug in directly; ties keep candidate order.
 * - Box constraints (§4.8): samples are unconstrained; the caller evaluates the clamped phenotype and
 *   adds α‖x − clamp(x)‖² (normalised by box width, α = 1) to the objective, which keeps the mean inside.
 * - Integer-coded genes: CMA-ES with Margin (Hamano et al. [5]), default α = 1/(n λ).
 * - IPOP restarts (Auger & Hansen [3]) in `IpopCmaEs`: on termination restart with 2λ while budget remains.
 * Fully deterministic given the `Rng` stream.
 */
import type { Rng } from '../../../optim/rng';
import { normCdf, normInv } from '../../../optim/stats';

/** Lexicographic ranking key; smaller is better; NaN sorts last. */
export type Key = readonly number[];

export function compareKeys(a: Key, b: Key): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? Infinity;
    const y = b[i] ?? Infinity;
    const xn = Number.isNaN(x);
    const yn = Number.isNaN(y);
    if (xn || yn) {
      if (xn && yn) continue;
      return xn ? 1 : -1;
    }
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Stable argsort of keys (best first; equal keys keep their input order → deterministic). */
export function argsortKeys(keys: readonly Key[]): number[] {
  const idx = keys.map((_, i) => i);
  idx.sort((i, j) => compareKeys(keys[i]!, keys[j]!) || i - j);
  return idx;
}

/** Integer-coded gene: `levels` equally spaced values over [lower, upper], decoded by rounding. */
export interface DiscreteGene {
  readonly index: number;
  readonly levels: number;
}

export type CovarianceMode = 'full' | 'sep';

export interface CmaesOptions {
  x0: ArrayLike<number>;
  sigma0: number;
  lower?: ArrayLike<number>;
  upper?: ArrayLike<number>;
  lambda?: number;
  /** 'auto' → sep when the budget hint is below 10 n² (§4.10 table: "better than full when budget < ~10 n²"). */
  covariance?: CovarianceMode | 'auto';
  budgetHint?: number;
  discrete?: readonly DiscreteGene[];
  /** Margin α for integer genes; default 1/(n λ) [5]. */
  margin?: number;
  /** Stop when the best key of the last 10 + ⌈30 n/λ⌉ generations varies by less than this (last key component). */
  tolFun?: number;
  /** Stop when all coordinate standard deviations (and evolution-path entries) × σ are below this. */
  tolX?: number;
}

export const defaultLambda = (n: number): number => 4 + Math.floor(3 * Math.log(n));
export const chooseCovariance = (n: number, budget: number): CovarianceMode =>
  budget < 10 * n * n ? 'sep' : 'full';

export class CmaEs {
  readonly n: number;
  readonly lambda: number;
  readonly mu: number;
  readonly mode: CovarianceMode;
  readonly mueff: number;
  private readonly w: Float64Array;
  private readonly cs: number;
  private readonly ds: number;
  private readonly cc: number;
  private readonly c1: number;
  private readonly cmu: number;
  private readonly chiN: number;
  private readonly m: Float64Array;
  private sig: number;
  private readonly sigma0: number;
  private readonly C: Float64Array;
  private readonly B: Float64Array;
  private readonly D: Float64Array;
  private readonly pc: Float64Array;
  private readonly ps: Float64Array;
  private readonly A: Float64Array;
  readonly lower: Float64Array;
  readonly upper: Float64Array;
  private readonly width: Float64Array;
  private readonly discrete: readonly DiscreteGene[];
  private readonly alpha: number;
  private readonly Z: Float64Array;
  private readonly Y: Float64Array;
  private readonly tolFun: number;
  private readonly tolX: number;
  private readonly histLen: number;
  private readonly bestHist: Key[] = [];
  private gen = 0;
  private evals = 0;
  private eigenEval = 0;
  private eigenStale = false;
  private eigenUpdates = 0;
  private pending = false;
  private stop_: string | null = null;
  private readonly rng: Rng;

  constructor(opts: CmaesOptions, rng: Rng) {
    const n = opts.x0.length;
    if (n < 1) throw new RangeError('CmaEs: dimension must be ≥ 1');
    this.n = n;
    this.rng = rng;
    this.lambda = Math.max(2, Math.floor(opts.lambda ?? defaultLambda(n)));
    this.mu = Math.floor(this.lambda / 2);
    const cov = opts.covariance ?? 'full';
    this.mode = cov === 'auto' ? chooseCovariance(n, opts.budgetHint ?? Infinity) : cov;
    this.w = new Float64Array(this.mu);
    let sw = 0;
    for (let i = 0; i < this.mu; i++) sw += this.w[i] = Math.log((this.lambda + 1) / 2) - Math.log(i + 1);
    let sw2 = 0;
    for (let i = 0; i < this.mu; i++) sw2 += (this.w[i]! /= sw) ** 2;
    const mueff = (this.mueff = 1 / sw2);
    this.cs = (mueff + 2) / (n + mueff + 5);
    this.ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + this.cs;
    this.cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
    let c1 = 2 / ((n + 1.3) ** 2 + mueff);
    let cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
    if (this.mode === 'sep') {
      c1 *= (n + 2) / 3;
      cmu = Math.min(1 - c1, cmu * ((n + 2) / 3));
    }
    this.c1 = c1;
    this.cmu = cmu;
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
    this.m = Float64Array.from(opts.x0);
    this.sig = this.sigma0 = opts.sigma0;
    this.C = this.mode === 'full' ? identity(n) : new Float64Array(n).fill(1);
    this.B = this.mode === 'full' ? identity(n) : new Float64Array(0);
    this.D = new Float64Array(n).fill(1);
    this.pc = new Float64Array(n);
    this.ps = new Float64Array(n);
    this.A = new Float64Array(n).fill(1);
    this.lower = new Float64Array(n).fill(-Infinity);
    this.upper = new Float64Array(n).fill(Infinity);
    this.width = new Float64Array(n).fill(1);
    for (let j = 0; j < n; j++) {
      if (opts.lower) this.lower[j] = opts.lower[j] ?? -Infinity;
      if (opts.upper) this.upper[j] = opts.upper[j] ?? Infinity;
      const wd = this.upper[j]! - this.lower[j]!;
      if (Number.isFinite(wd) && wd > 0) this.width[j] = wd;
    }
    this.discrete = (opts.discrete ?? []).filter((g) => g.levels >= 2 && g.index >= 0 && g.index < n);
    for (const g of this.discrete) {
      if (!Number.isFinite(this.lower[g.index]!) || !Number.isFinite(this.upper[g.index]!))
        throw new RangeError(`CmaEs: discrete gene ${g.index} needs finite bounds`);
    }
    this.alpha = opts.margin ?? 1 / (n * this.lambda);
    this.Z = new Float64Array(this.lambda * n);
    this.Y = new Float64Array(this.lambda * n);
    this.tolFun = opts.tolFun ?? 1e-12;
    this.tolX = opts.tolX ?? 1e-11;
    this.histLen = 10 + Math.ceil((30 * n) / this.lambda);
  }

  get mean(): Float64Array {
    return Float64Array.from(this.m);
  }
  get sigma(): number {
    return this.sig;
  }
  get generation(): number {
    return this.gen;
  }
  get evaluations(): number {
    return this.evals;
  }
  /** Termination reason, or null while running. */
  get stopReason(): string | null {
    return this.stop_;
  }
  /** Per-coordinate standard deviations σ·A_j·√C_jj. */
  stds(): Float64Array {
    const out = new Float64Array(this.n);
    for (let j = 0; j < this.n; j++) out[j] = this.sig * this.A[j]! * Math.sqrt(this.cjj(j));
    return out;
  }

  /** Clamp to the box (the phenotype that is evaluated). */
  clamp(x: ArrayLike<number>, out = new Float64Array(this.n)): Float64Array {
    for (let j = 0; j < this.n; j++) {
      const v = x[j]!;
      out[j] = v < this.lower[j]! ? this.lower[j]! : v > this.upper[j]! ? this.upper[j]! : v;
    }
    return out;
  }

  /** ‖x − clamp(x)‖² with each coordinate normalised by its box width (§4.8 repair penalty, before α). */
  boxPenalty(x: ArrayLike<number>): number {
    let p = 0;
    for (let j = 0; j < this.n; j++) {
      const v = x[j]!;
      const d = v < this.lower[j]! ? this.lower[j]! - v : v > this.upper[j]! ? v - this.upper[j]! : 0;
      if (d > 0) p += (d / this.width[j]!) ** 2;
    }
    return p;
  }

  /** Sample λ candidates (raw genotypes; may lie outside the box). */
  ask(): Float64Array[] {
    if (this.pending) throw new Error('CmaEs.ask: previous population has not been told');
    if (this.eigenStale) this.updateEigen();
    const { n, lambda, Z, Y, B, D, m, A } = this;
    const out: Float64Array[] = [];
    for (let k = 0; k < lambda; k++) {
      const o = k * n;
      for (let j = 0; j < n; j++) Z[o + j] = this.rng.normal();
      if (this.mode === 'full') {
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let j = 0; j < n; j++) s += B[i * n + j]! * D[j]! * Z[o + j]!;
          Y[o + i] = s;
        }
      } else {
        for (let j = 0; j < n; j++) Y[o + j] = D[j]! * Z[o + j]!;
      }
      const x = new Float64Array(n);
      for (let j = 0; j < n; j++) x[j] = m[j]! + this.sig * A[j]! * Y[o + j]!;
      out.push(x);
    }
    this.pending = true;
    return out;
  }

  /** Update from the keys of the last `ask()` population (same order). */
  tell(keys: readonly Key[]): void {
    if (!this.pending) throw new Error('CmaEs.tell: call ask() first');
    if (keys.length !== this.lambda)
      throw new RangeError(`CmaEs.tell: expected ${this.lambda} keys, got ${keys.length}`);
    this.pending = false;
    const { n, mu, w, Y, Z, m, A, ps, pc, C, cs, cc, c1, cmu, mueff } = this;
    const order = argsortKeys(keys);
    const yw = new Float64Array(n);
    const zw = new Float64Array(n);
    for (let i = 0; i < mu; i++) {
      const o = order[i]! * n;
      const wi = w[i]!;
      for (let j = 0; j < n; j++) {
        yw[j] = yw[j]! + wi * Y[o + j]!;
        zw[j] = zw[j]! + wi * Z[o + j]!;
      }
    }
    for (let j = 0; j < n; j++) m[j] = m[j]! + this.sig * A[j]! * yw[j]!;
    // C^{-1/2} y_w = B z_w (full) or z_w (sep)
    const csn = Math.sqrt(cs * (2 - cs) * mueff);
    let psn2 = 0;
    for (let i = 0; i < n; i++) {
      let v = zw[i]!;
      if (this.mode === 'full') {
        v = 0;
        for (let j = 0; j < n; j++) v += this.B[i * n + j]! * zw[j]!;
      }
      ps[i] = (1 - cs) * ps[i]! + csn * v;
      psn2 += ps[i]! ** 2;
    }
    const psn = Math.sqrt(psn2);
    const hsig =
      psn / Math.sqrt(1 - (1 - cs) ** (2 * (this.gen + 1))) / this.chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    const ccn = hsig * Math.sqrt(cc * (2 - cc) * mueff);
    for (let j = 0; j < n; j++) pc[j] = (1 - cc) * pc[j]! + ccn * yw[j]!;
    const c1a = c1 * (1 - (1 - hsig) * cc * (2 - cc));
    const keep = 1 - c1a - cmu;
    if (this.mode === 'full') {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          let r = 0;
          for (let k = 0; k < mu; k++) {
            const o = order[k]! * n;
            r += w[k]! * Y[o + i]! * Y[o + j]!;
          }
          const v = keep * C[i * n + j]! + c1 * pc[i]! * pc[j]! + cmu * r;
          C[i * n + j] = v;
          C[j * n + i] = v;
        }
      }
    } else {
      for (let j = 0; j < n; j++) {
        let r = 0;
        for (let k = 0; k < mu; k++) r += w[k]! * Y[order[k]! * n + j]! ** 2;
        C[j] = keep * C[j]! + c1 * pc[j]! ** 2 + cmu * r;
        this.D[j] = Math.sqrt(Math.max(C[j]!, 1e-300));
      }
    }
    this.sig *= Math.exp(Math.min(1, (cs / this.ds) * (psn / this.chiN - 1)));
    this.gen++;
    this.evals += this.lambda;
    if (this.mode === 'full' && this.evals - this.eigenEval > this.lambda / (c1 + cmu) / n / 10)
      this.eigenStale = true;
    if (this.discrete.length > 0) this.applyMargin();
    this.bestHist.push(keys[order[0]!]!.slice());
    if (this.bestHist.length > this.histLen) this.bestHist.shift();
    this.checkTermination();
  }

  private cjj(j: number): number {
    return this.mode === 'full' ? this.C[j * this.n + j]! : this.C[j]!;
  }

  private updateEigen(): void {
    const { n, B, C } = this;
    // Periodic cold start bounds the accumulation of round-off in B's orthogonality.
    if (++this.eigenUpdates % 64 === 0) {
      B.fill(0);
      for (let i = 0; i < n; i++) B[i * n + i] = 1;
    }
    // Warm start: M = Bᵀ C B is nearly diagonal because C changes slowly between updates, so the
    // Jacobi sweeps below converge in one or two passes; rotations are accumulated into B itself.
    const tmp = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += C[i * n + k]! * B[k * n + j]!;
        tmp[i * n + j] = s;
      }
    const a = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = i; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += B[k * n + i]! * tmp[k * n + j]!;
        a[i * n + j] = s;
        a[j * n + i] = s;
      }
    const vals = new Float64Array(n);
    jacobiEigen(a, n, B, vals, 60, false);
    let maxv = 0;
    for (let i = 0; i < n; i++) maxv = Math.max(maxv, vals[i]!);
    let minv = Infinity;
    for (let i = 0; i < n; i++) {
      const v = Math.max(vals[i]!, maxv * 1e-20, 1e-300);
      minv = Math.min(minv, v);
      this.D[i] = Math.sqrt(v);
    }
    this.eigenEval = this.evals;
    this.eigenStale = false;
    if (maxv / minv > 1e14 && !this.stop_) this.stop_ = 'conditionCov';
  }

  /** CMA-ES with Margin [5]: keep the probability of leaving the current integer level ≥ α. */
  private applyMargin(): void {
    const a = this.alpha;
    for (const g of this.discrete) {
      const j = g.index;
      const lb = this.lower[j]!;
      const h = (this.upper[j]! - lb) / (g.levels - 1);
      const mj = this.m[j]!;
      const c = Math.min(g.levels - 1, Math.max(0, Math.round((mj - lb) / h)));
      const sqc = Math.sqrt(this.cjj(j));
      const s = this.sig * this.A[j]! * sqc;
      if (!(s > 0)) continue;
      const lowT = c > 0 ? lb + (c - 0.5) * h : NaN;
      const upT = c < g.levels - 1 ? lb + (c + 0.5) * h : NaN;
      if (Number.isNaN(lowT) || Number.isNaN(upT)) {
        // edge level: one neighbour; move the mean so that P(cross) = α
        const t = Number.isNaN(lowT) ? upT : lowT;
        if (Number.isNaN(t)) continue;
        const below = mj <= t;
        const pCross = below ? 1 - normCdf((t - mj) / s) : normCdf((t - mj) / s);
        if (pCross < a) this.m[j] = below ? t - normInv(1 - a) * s : t + normInv(1 - a) * s;
        continue;
      }
      let low = normCdf((lowT - mj) / s);
      let up = 1 - normCdf((upT - mj) / s);
      if (low >= a / 2 && up >= a / 2) continue; // no correction needed (exact identity otherwise)
      const mid = 1 - low - up;
      low = Math.max(low, a / 2);
      up = Math.max(up, a / 2);
      const excess = 1 - low - up - mid;
      const denom = low + mid + up - 1.5 * a;
      const pl = Math.min(0.5 - 1e-10, Math.max(1e-10, low + (excess * (low - a / 2)) / denom));
      const pu = Math.min(0.5 - 1e-10, Math.max(1e-10, up + (excess * (up - a / 2)) / denom));
      const zl = normInv(1 - pl);
      const zu = normInv(1 - pu);
      this.A[j] = (upT - lowT) / ((zl + zu) * this.sig * sqc);
      this.m[j] = (lowT * zu + upT * zl) / (zl + zu);
    }
  }

  private checkTermination(): void {
    if (this.stop_) return;
    const { n } = this;
    if (!Number.isFinite(this.sig) || this.sig > 1e12 * this.sigma0) {
      this.stop_ = 'divergence';
      return;
    }
    for (let j = 0; j < n; j++) {
      if (!Number.isFinite(this.m[j]!)) {
        this.stop_ = 'numeric';
        return;
      }
    }
    if (this.bestHist.length >= this.histLen) {
      const first = this.bestHist[0]!;
      const last = first.length - 1;
      let lo = Infinity;
      let hi = -Infinity;
      let samePrefix = true;
      for (const k of this.bestHist) {
        for (let i = 0; i < last && samePrefix; i++) if (k[i] !== first[i]) samePrefix = false;
        lo = Math.min(lo, k[last]!);
        hi = Math.max(hi, k[last]!);
      }
      if (samePrefix && hi - lo < this.tolFun) {
        this.stop_ = 'tolFun';
        return;
      }
    }
    let maxStd = 0;
    let maxPc = 0;
    let noEffect = false;
    for (let j = 0; j < n; j++) {
      const sd = this.sig * this.A[j]! * Math.sqrt(this.cjj(j));
      maxStd = Math.max(maxStd, sd);
      maxPc = Math.max(maxPc, Math.abs(this.sig * this.A[j]! * this.pc[j]!));
      if (this.m[j]! + 0.2 * sd === this.m[j]!) noEffect = true;
    }
    if (maxStd < this.tolX && maxPc < this.tolX) this.stop_ = 'tolX';
    else if (noEffect) this.stop_ = 'noEffectCoord';
  }
}

function identity(n: number): Float64Array {
  const a = new Float64Array(n * n);
  for (let i = 0; i < n; i++) a[i * n + i] = 1;
  return a;
}

/**
 * Cyclic Jacobi eigendecomposition of a symmetric n×n matrix (row-major; `a` is destroyed).
 * Eigenvalues go to `vals`; the rotations are accumulated into `vecs` (reset to I when `resetVecs`,
 * otherwise vecs ← vecs·V, which diagonalises vecs·a·vecsᵀ — used for warm starts).
 */
export function jacobiEigen(
  a: Float64Array,
  n: number,
  vecs: Float64Array,
  vals: Float64Array,
  maxSweeps = 60,
  resetVecs = true,
): void {
  if (resetVecs) {
    vecs.fill(0);
    for (let i = 0; i < n; i++) vecs[i * n + i] = 1;
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++) {
      const v = 0.5 * (a[i * n + j]! + a[j * n + i]!);
      a[i * n + j] = v;
      a[j * n + i] = v;
    }
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    let diag = 0;
    for (let i = 0; i < n; i++) {
      diag += a[i * n + i]! ** 2;
      for (let j = i + 1; j < n; j++) off += a[i * n + j]! ** 2;
    }
    if (off <= 1e-30 * diag || off === 0) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]!;
        if (apq === 0) continue;
        const app = a[p * n + p]!;
        const aqq = a[q * n + q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]!;
          const akq = a[k * n + q]!;
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]!;
          const aqk = a[q * n + k]!;
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        a[p * n + q] = 0;
        a[q * n + p] = 0;
        for (let k = 0; k < n; k++) {
          const vkp = vecs[k * n + p]!;
          const vkq = vecs[k * n + q]!;
          vecs[k * n + p] = c * vkp - s * vkq;
          vecs[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) vals[i] = a[i * n + i]!;
}

export interface IpopOptions extends CmaesOptions {
  /** Maximum number of restarts (default 9 → λ up to 2⁹ λ₀). */
  maxRestarts?: number;
  lambdaMax?: number;
  /** Restart mean: 'uniform' in the box (Auger & Hansen [3]; default when bounded), 'initial' = x0, or a callback. */
  restartX0?: 'initial' | 'uniform' | ((restart: number, rng: Rng) => ArrayLike<number>);
  restartSigma0?: number;
}

export interface RunSummary {
  restart: number;
  lambda: number;
  generations: number;
  evaluations: number;
  stopReason: string;
}

/** IPOP-CMA-ES [3]: restarts with doubled population when an instance terminates. */
export class IpopCmaEs {
  private es: CmaEs;
  private lastX: Float64Array[] = [];
  private restartCount = 0;
  private evals = 0;
  private exhausted = false;
  readonly runs: RunSummary[] = [];
  best: { x: Float64Array; key: Key } | null = null;

  constructor(
    private readonly opts: IpopOptions,
    private readonly rng: Rng,
  ) {
    this.es = new CmaEs(opts, rng.fork('r0'));
  }

  get current(): CmaEs {
    return this.es;
  }
  get restarts(): number {
    return this.restartCount;
  }
  get evaluations(): number {
    return this.evals;
  }
  get lambda(): number {
    return this.es.lambda;
  }
  /** True when the last instance terminated and no restart is left. */
  get done(): boolean {
    return this.exhausted;
  }

  ask(): Float64Array[] {
    this.lastX = this.es.ask();
    return this.lastX;
  }

  tell(keys: readonly Key[]): void {
    this.es.tell(keys);
    this.evals += keys.length;
    for (let i = 0; i < keys.length; i++) {
      if (!this.best || compareKeys(keys[i]!, this.best.key) < 0)
        this.best = { x: this.es.clamp(this.lastX[i]!), key: keys[i]!.slice() };
    }
    const reason = this.es.stopReason;
    if (reason) this.restart(reason);
  }

  private restart(reason: string): void {
    this.runs.push({
      restart: this.restartCount,
      lambda: this.es.lambda,
      generations: this.es.generation,
      evaluations: this.es.evaluations,
      stopReason: reason,
    });
    if (this.restartCount >= (this.opts.maxRestarts ?? 9)) {
      this.exhausted = true;
      return;
    }
    this.restartCount++;
    const r = this.restartCount;
    const stream = this.rng.fork(`r${r}`);
    const lambda = Math.min(this.opts.lambdaMax ?? Infinity, 2 * this.es.lambda);
    const n = this.opts.x0.length;
    const bounded = !!this.opts.lower && !!this.opts.upper;
    const policy = this.opts.restartX0 ?? (bounded ? 'uniform' : 'initial');
    let x0: ArrayLike<number> = this.opts.x0;
    if (typeof policy === 'function') x0 = policy(r, stream.fork('x0'));
    else if (policy === 'uniform' && bounded) {
      const u = stream.fork('x0');
      const v = new Float64Array(n);
      for (let j = 0; j < n; j++) v[j] = u.uniform(this.opts.lower![j]!, this.opts.upper![j]!);
      x0 = v;
    }
    this.es = new CmaEs(
      { ...this.opts, x0, lambda, sigma0: this.opts.restartSigma0 ?? this.opts.sigma0 },
      stream,
    );
  }
}

export interface MinimizeOptions extends IpopOptions {
  budget: number;
  /** Stop as soon as the best objective value is ≤ target. */
  target?: number;
  /** α of the box penalty (default 1). */
  boxPenaltyWeight?: number;
}

export interface MinimizeResult {
  x: Float64Array;
  f: number;
  evaluations: number;
  /** Evaluations used when `target` was first reached (null if never). */
  evaluationsToTarget: number | null;
  restarts: number;
  runs: RunSummary[];
}

/** Synchronous scalar minimisation with IPOP-CMA-ES (benchmarks and simple uses). */
export function minimize(f: (x: Float64Array) => number, opts: MinimizeOptions, rng: Rng): MinimizeResult {
  const ipop = new IpopCmaEs(opts, rng);
  const alpha = opts.boxPenaltyWeight ?? 1;
  let bestX = ipop.current.clamp(opts.x0);
  let bestF = Infinity;
  let toTarget: number | null = null;
  let evals = 0;
  while (evals < opts.budget && !ipop.done) {
    const es = ipop.current;
    const xs = ipop.ask();
    const keys: Key[] = [];
    for (const x of xs) {
      const p = es.clamp(x);
      const fx = f(p);
      evals++;
      if (fx < bestF) {
        bestF = fx;
        bestX = p;
        if (toTarget === null && opts.target !== undefined && fx <= opts.target) toTarget = evals;
      }
      keys.push([fx + alpha * es.boxPenalty(x)]);
    }
    ipop.tell(keys);
    if (toTarget !== null) break;
  }
  return {
    x: bestX,
    f: bestF,
    evaluations: evals,
    evaluationsToTarget: toTarget,
    restarts: ipop.restarts,
    runs: ipop.runs,
  };
}
