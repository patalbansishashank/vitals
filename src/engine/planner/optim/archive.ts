/**
 * Quality-diversity archive and alternative selection (dossier 18 §4.12).
 *
 * - CVT-MAP-Elites grid (Vassiliades et al. [11]): centroids from seeded k-means on quasi-random
 *   (Halton) points over the *active* behaviour descriptors (range ≥ 0.1 across screening samples);
 *   a regular grid (MAP-Elites [10]) is available as an alternative indexer.
 * - Elites are compared with a caller-supplied key function evaluated at comparison time, so the
 *   archive follows the comparator as floors are set (provisional → relaxed final key).
 * - CMA-ME [12] improvement-emitter ranking: new cell first, then improvement of the cell elite.
 * - Plan distance: Gower's coefficient [29] over caller-built features; selection of 2-3 options by
 *   maximal marginal relevance [30] / farthest-first [31] subject to relaxed priority floors.
 */
import type { Key } from './cmaes';
import { compareKeys } from './cmaes';
import type { Rng } from './rng';
import { halton } from './rng';
import { GOAL_SCORE_STEP, compareGoalFirst } from './goals';

// ---------------------------------------------------------------------------------------------
// Cell indexers
// ---------------------------------------------------------------------------------------------

export interface CellIndexer {
  readonly cells: number;
  readonly dims: number;
  cellOf(d: ArrayLike<number>): number;
}

/** Centroidal Voronoi tessellation of [0,1]^D. */
export class CvtGrid implements CellIndexer {
  readonly cells: number;
  readonly dims: number;
  readonly centroids: Float64Array;

  constructor(centroids: Float64Array, dims: number) {
    this.dims = dims;
    this.centroids = centroids;
    this.cells = dims === 0 ? 1 : centroids.length / dims;
  }

  cellOf(d: ArrayLike<number>): number {
    const D = this.dims;
    if (D === 0) return 0;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < this.cells; c++) {
      let s = 0;
      for (let j = 0; j < D; j++) s += (d[j]! - this.centroids[c * D + j]!) ** 2;
      if (s < bestD) {
        bestD = s;
        best = c;
      }
    }
    return best;
  }
}

/**
 * k-means (Lloyd) on `samples` Halton points in [0,1]^D, initialised from a seeded random subset.
 * §4.12: 64 / 100 / 150 centroids on tiers S / M / L, 10⁴ points.
 */
export function cvtCentroids(k: number, D: number, rng: Rng, samples = 10000, iterations = 25): CvtGrid {
  if (D === 0) return new CvtGrid(new Float64Array(0), 0);
  const N = Math.max(samples, k);
  const pts = new Float64Array(N * D);
  const tmp = new Float64Array(D);
  for (let i = 0; i < N; i++) pts.set(halton(i + 1, D, tmp), i * D);
  const perm = rng.permutation(N);
  const cen = new Float64Array(k * D);
  for (let c = 0; c < k; c++) cen.set(pts.subarray(perm[c]! * D, perm[c]! * D + D), c * D);
  const assign = new Int32Array(N).fill(-1);
  const sums = new Float64Array(k * D);
  const counts = new Int32Array(k);
  for (let it = 0; it < iterations; it++) {
    let changed = 0;
    for (let i = 0; i < N; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let s = 0;
        for (let j = 0; j < D; j++) s += (pts[i * D + j]! - cen[c * D + j]!) ** 2;
        if (s < bestD) {
          bestD = s;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed++;
      }
    }
    if (changed === 0) break;
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < N; i++) {
      const c = assign[i]!;
      counts[c] = counts[c]! + 1;
      for (let j = 0; j < D; j++) sums[c * D + j] = sums[c * D + j]! + pts[i * D + j]!;
    }
    for (let c = 0; c < k; c++)
      if (counts[c]! > 0) for (let j = 0; j < D; j++) cen[c * D + j] = sums[c * D + j]! / counts[c]!;
  }
  return new CvtGrid(cen, D);
}

/** Regular MAP-Elites grid with `bins[j]` bins on each descriptor axis of [0,1]. */
export class RegularGrid implements CellIndexer {
  readonly cells: number;
  readonly dims: number;
  constructor(readonly bins: readonly number[]) {
    this.dims = bins.length;
    this.cells = bins.reduce((p, b) => p * b, 1);
  }
  cellOf(d: ArrayLike<number>): number {
    let idx = 0;
    for (let j = 0; j < this.dims; j++) {
      const b = this.bins[j]!;
      const v = Math.min(b - 1, Math.max(0, Math.floor(d[j]! * b)));
      idx = idx * b + v;
    }
    return idx;
  }
}

/**
 * D-first grid (PLANNER_V2_SPEC §1.2): the first projected descriptor (difficulty D ∈ [0,1]) is binned uniformly into
 * `dBins` bins; inside each bin the remaining (style) descriptors are indexed by `style` (a CVT shared by every bin).
 * Cell = bin × style.cells + style cell, so cells of one D bin are contiguous and bins are in increasing D.
 */
export class DFirstGrid implements CellIndexer {
  readonly cells: number;
  readonly dims: number;
  private readonly buf: Float64Array;

  constructor(
    readonly dBins: number,
    readonly style: CellIndexer,
  ) {
    if (!(dBins >= 1)) throw new RangeError('DFirstGrid: at least one D bin');
    this.cells = dBins * style.cells;
    this.dims = 1 + style.dims;
    this.buf = new Float64Array(style.dims);
  }

  binOfD(D: number): number {
    return Math.min(this.dBins - 1, Math.max(0, Math.floor((Number.isNaN(D) ? 0 : D) * this.dBins)));
  }

  /** D bin of a cell. */
  binOf(cell: number): number {
    return Math.floor(cell / this.style.cells);
  }

  cellOf(d: ArrayLike<number>): number {
    for (let j = 0; j < this.style.dims; j++) this.buf[j] = d[j + 1]!;
    return this.binOfD(d[0]!) * this.style.cells + this.style.cellOf(this.buf);
  }
}

/** Descriptor dimensions whose range across `samples` is at least `minRange` (§4.12: 0.1). */
export function selectActiveDescriptors(samples: readonly ArrayLike<number>[], minRange = 0.1): number[] {
  if (samples.length === 0) return [];
  const D = samples[0]!.length;
  const active: number[] = [];
  for (let j = 0; j < D; j++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of samples) {
      lo = Math.min(lo, s[j]!);
      hi = Math.max(hi, s[j]!);
    }
    if (hi - lo >= minRange) active.push(j);
  }
  return active;
}

// ---------------------------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------------------------

export type InsertStatus = 'new' | 'improved' | 'rejected';

export interface InsertResult {
  status: InsertStatus;
  cell: number;
  /** Candidate key minus the previous elite key (component-wise), for 'improved'. */
  improvement: number[] | null;
}

/** MAP-Elites archive over a projected descriptor space; `T` is the caller's evaluated-plan record. */
export class Archive<T> {
  private readonly elites: (T | null)[];
  private filled = 0;

  constructor(
    readonly indexer: CellIndexer,
    /** Indices of the active descriptor dimensions (projection before indexing). */
    readonly dims: readonly number[],
    private readonly descriptorOf: (t: T) => ArrayLike<number>,
    private keyOf: (t: T) => Key,
  ) {
    this.elites = new Array<T | null>(indexer.cells).fill(null);
  }

  /** Replace the comparator (e.g. provisional → relaxed final key once floors exist). */
  setComparator(keyOf: (t: T) => Key): void {
    this.keyOf = keyOf;
  }

  key(t: T): Key {
    return this.keyOf(t);
  }

  cellOf(t: T): number {
    const d = this.descriptorOf(t);
    const p = new Float64Array(this.dims.length);
    for (let j = 0; j < this.dims.length; j++) p[j] = d[this.dims[j]!]!;
    return this.indexer.cellOf(p);
  }

  offer(t: T): InsertResult {
    const cell = this.cellOf(t);
    const cur = this.elites[cell];
    if (cur === null || cur === undefined) {
      this.elites[cell] = t;
      this.filled++;
      return { status: 'new', cell, improvement: null };
    }
    const kn = this.keyOf(t);
    const ko = this.keyOf(cur);
    if (compareKeys(kn, ko) < 0) {
      this.elites[cell] = t;
      return { status: 'improved', cell, improvement: kn.map((v, i) => v - (ko[i] ?? 0)) };
    }
    return { status: 'rejected', cell, improvement: null };
  }

  get size(): number {
    return this.filled;
  }
  get coverage(): number {
    return this.filled / this.indexer.cells;
  }
  elite(cell: number): T | null {
    return this.elites[cell] ?? null;
  }
  /** Elites by cell (null = empty), for checkpoints. */
  snapshot(): (T | null)[] {
    return this.elites.slice();
  }

  /** Replace every elite (checkpoint restore); `elites.length` must equal the cell count. */
  restore(elites: readonly (T | null)[]): void {
    if (elites.length !== this.elites.length)
      throw new RangeError(`Archive.restore: expected ${this.elites.length} cells, got ${elites.length}`);
    this.filled = 0;
    for (let c = 0; c < elites.length; c++) {
      this.elites[c] = elites[c] ?? null;
      if (this.elites[c] !== null) this.filled++;
    }
  }

  /** Elites in cell order (deterministic). */
  all(): T[] {
    const out: T[] = [];
    for (const e of this.elites) if (e !== null) out.push(e);
    return out;
  }
  /** Uniformly random elite (cell order + rng). */
  randomElite(rng: Rng): T | null {
    const all = this.all();
    return all.length ? all[rng.int(all.length)]! : null;
  }
  /** Best elite under the current comparator. */
  best(): T | null {
    let best: T | null = null;
    let bk: Key | null = null;
    for (const e of this.elites) {
      if (e === null) continue;
      const k = this.keyOf(e);
      if (!bk || compareKeys(k, bk) < 0) {
        best = e;
        bk = k;
      }
    }
    return best;
  }
}

/**
 * CMA-ME improvement-emitter ranking key [12]: candidates that opened a new cell first (by their own key),
 * then candidates that improved an elite (by the size of the improvement), then rejected ones.
 */
export function emitterRankKey(res: InsertResult, candidateKey: Key): Key {
  if (res.status === 'new') return [0, ...candidateKey];
  if (res.status === 'improved') return [1, ...(res.improvement ?? candidateKey)];
  return [2, ...candidateKey];
}

// ---------------------------------------------------------------------------------------------
// Plan distance (Gower) and selection of alternatives
// ---------------------------------------------------------------------------------------------

export type FeatureSpec =
  | { kind: 'numeric'; weight?: number }
  | { kind: 'circular'; period: number; weight?: number }
  | { kind: 'categorical'; weight?: number }
  /** Value is a bitmask of set members (≤ 31); distance is 1 − Jaccard. */
  | { kind: 'set'; weight?: number };

/** Per-feature ranges R_k over a candidate set (numeric features; 0 → the feature contributes 0). */
export function featureRanges(vectors: readonly ArrayLike<number>[], dims: number): Float64Array {
  const r = new Float64Array(dims);
  for (let j = 0; j < dims; j++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vectors) {
      lo = Math.min(lo, v[j]!);
      hi = Math.max(hi, v[j]!);
    }
    r[j] = vectors.length ? hi - lo : 0;
  }
  return r;
}

function popcount(x: number): number {
  let v = x >>> 0;
  let c = 0;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

/** Gower distance D(x, y) = Σ w_k δ_k / Σ w_k ∈ [0, 1] (§4.12). */
export function gowerDistance(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  schema: readonly FeatureSpec[],
  ranges: ArrayLike<number>,
): number {
  let num = 0;
  let den = 0;
  for (let k = 0; k < schema.length; k++) {
    const f = schema[k]!;
    const w = f.weight ?? 1;
    const a = x[k]!;
    const b = y[k]!;
    let d: number;
    switch (f.kind) {
      case 'numeric': {
        const R = ranges[k]!;
        d = R > 0 ? Math.min(1, Math.abs(a - b) / R) : 0;
        break;
      }
      case 'circular': {
        const diff = Math.abs(a - b) % f.period;
        d = Math.min(diff, f.period - diff) / (f.period / 2);
        break;
      }
      case 'categorical':
        d = a === b ? 0 : 1;
        break;
      case 'set': {
        const union = popcount((a | b) >>> 0);
        d = union === 0 ? 0 : 1 - popcount((a & b) >>> 0) / union;
        break;
      }
    }
    num += w * d;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

export interface SelectionCandidate {
  /** Final utility U. */
  utility: number;
  /**
   * Weighted goal score G (U without the regulariser). When given, option A is chosen goal-first: ⌊G/step⌋, then the
   * penalty G − U, then G (`compareGoalFirst`, ruling R-FAST-GATE); otherwise by U.
   */
  goalScore?: number;
  /** v_S = 0. */
  safe: boolean;
  /** All floors hold (x ∈ F). */
  strictFeasible: boolean;
  /** All relaxed floors L_j − Δ_j hold (x ∈ Q). */
  relaxedFeasible: boolean;
  /** Strict floor violation v_L (used only when no candidate is relaxed-feasible). */
  floorViolation?: number;
}

export interface SelectionOptions {
  /** Number of options wanted (2-3, default 3). */
  count?: number;
  /** MMR trade-off λ (default 0.5). */
  lambda?: number;
  /** Minimum distance D_min to an already chosen option (default 0.20). */
  dMin?: number;
  /** Goal-score step of the goal-first choice of option A (default `GOAL_SCORE_STEP`). */
  scoreStep?: number;
}

export interface SelectionResult {
  /** Candidate indices, option A first. */
  chosen: number[];
  /** Whether option A came from F (strict floors) or had to fall back to Q. */
  aStrict: boolean;
  /** Why fewer than `count` options were returned. */
  shortfall: null | 'noCandidates' | 'noDistinctAlternative';
  /** Q was empty: candidates were drawn from the safe set, A = argmin (v_L, −U) (Deb's rules). */
  fallback: boolean;
  /** min distance of each chosen option to the previously chosen ones (NaN for A). */
  distances: number[];
}

export const DEFAULT_D_MIN = 0.2;
export const DEFAULT_MMR_LAMBDA = 0.5;

/**
 * §4.12 selection: A = argmax_{F} U (fallback argmax_Q U); then x* = argmax (1−λ)Û + λ·min_{s∈S} D(x, s)
 * over x ∈ Q∖S with min D ≥ D_min, until `count` options or no such x. Ties → lower index.
 */
export function selectAlternatives(
  cands: readonly SelectionCandidate[],
  distance: (i: number, j: number) => number,
  opts: SelectionOptions = {},
): SelectionResult {
  const count = opts.count ?? 3;
  const lambda = opts.lambda ?? DEFAULT_MMR_LAMBDA;
  const dMin = opts.dMin ?? DEFAULT_D_MIN;
  let Q: number[] = [];
  for (let i = 0; i < cands.length; i++) if (cands[i]!.safe && cands[i]!.relaxedFeasible) Q.push(i);
  let fallback = false;
  if (Q.length === 0) {
    // no candidate meets the relaxed floors: fall back to the safe set ordered by (v_L, −U)
    for (let i = 0; i < cands.length; i++) if (cands[i]!.safe) Q.push(i);
    if (Q.length === 0)
      return { chosen: [], aStrict: false, shortfall: 'noCandidates', distances: [], fallback: false };
    fallback = true;
    const v = (i: number) => cands[i]!.floorViolation ?? 0;
    const bestV = Math.min(...Q.map(v));
    Q = Q.filter((i) => v(i) <= bestV + 0.05);
  }
  // option A goal-first: the weighted goal score in fixed steps, then the penalty (ruling R-FAST-GATE)
  const step = opts.scoreStep ?? GOAL_SCORE_STEP;
  const better = (i: number, j: number) => compareGoalFirst(cands[i]!, cands[j]!, step) < 0;
  let a = -1;
  for (const i of Q) if (cands[i]!.strictFeasible && (a < 0 || better(i, a))) a = i;
  const aStrict = a >= 0;
  if (a < 0) {
    const v = (i: number) => (fallback ? (cands[i]!.floorViolation ?? 0) : 0);
    for (const i of Q) if (a < 0 || v(i) < v(a) || (v(i) === v(a) && better(i, a))) a = i;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of Q) {
    lo = Math.min(lo, cands[i]!.utility);
    hi = Math.max(hi, cands[i]!.utility);
  }
  const uhat = (i: number) => (hi > lo ? (cands[i]!.utility - lo) / (hi - lo) : 1);
  const chosen = [a];
  const distances = [NaN];
  const minD = new Float64Array(cands.length).fill(Infinity);
  let shortfall: SelectionResult['shortfall'] = null;
  while (chosen.length < count) {
    const last = chosen[chosen.length - 1]!;
    for (const i of Q) minD[i] = Math.min(minD[i]!, distance(i, last));
    let best = -1;
    let bestScore = -Infinity;
    for (const i of Q) {
      // Candidates closer than D_min to a chosen option are excluded before the argmax (so a
      // near-duplicate of A with high utility cannot end the search while distinct options remain).
      if (chosen.includes(i) || minD[i]! < dMin) continue;
      const score = (1 - lambda) * uhat(i) + lambda * minD[i]!;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) {
      shortfall = 'noDistinctAlternative';
      break;
    }
    chosen.push(best);
    distances.push(minD[best]!);
  }
  return { chosen, aStrict, shortfall, distances, fallback };
}
