/**
 * Metrics of the planner benchmark: lexicographic regret and lex-success against a fixed reference scale, goal-1
 * regret in metric units, time to quality (EU and wall time to 50/80/90/95/99 % of the reference attainment) with the
 * ECDF over (run, target) pairs and its area, the ladder metrics (2-D hypervolume of {(g, 1 − D)} for the returned
 * rungs and the staircase, IGD⁺ against a reference front, distinctness and monotonicity) and the visited-archive
 * quality-diversity score. Pure functions over plain numbers; nothing here knows which algorithm produced a run.
 */
import { rocWeights } from '../optim/goals';

// ---------------------------------------------------------------------------------------------------------------
// fixed reference scales
// ---------------------------------------------------------------------------------------------------------------

/** One goal on the benchmark's own scale (independent of either algorithm's running anchors). */
export interface GoalRef {
  id: string;
  /** Metric direction of the raw functional: 'min' goals are negated into maximised units. */
  sense: 'max' | 'min';
  /** Baseline in maximised units (desirability 0). */
  b: number;
  /** Upper reference in maximised units (desirability 1): the target, else the best feasible value known. */
  u: number;
  /** Ladder tolerance δ_k of the goal (desirability units). */
  delta: number;
  unit: string;
  /** Inactive goals (met at baseline or not improvable) carry no regret. */
  active: boolean;
}

export const TARGET_LEVELS: readonly number[] = [0.5, 0.8, 0.9, 0.95, 0.99];

/** Maximised objective of a raw functional. */
export function objectiveOf(g: GoalRef, raw: number): number {
  return g.sense === 'min' ? -raw : raw;
}

/** Benchmark desirability d̃ = min(1, (f − b)/(u − b)) (no lower clip, as the optimiser's search desirability). */
export function desirability(goals: readonly GoalRef[], raw: ArrayLike<number>): number[] {
  return goals.map((g, k) => {
    if (!g.active) return 1;
    const span = g.u - g.b;
    if (!(Math.abs(span) > 1e-12)) return 0;
    const v = raw[k]!;
    if (!Number.isFinite(v)) return -Infinity;
    return Math.min(1, (objectiveOf(g, v) - g.b) / span);
  });
}

/** Weighted goal score G = Σ_k w_k·min(1, d̃_k) (ROC weights, active goals; the final comparator's goal term). */
export function goalScore(goals: readonly GoalRef[], d: readonly number[]): number {
  const w = rocWeights(goals.length);
  let s = 0;
  for (let k = 0; k < goals.length; k++) if (goals[k]!.active) s += w[k]! * Math.min(1, d[k]!);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// lexicographic regret
// ---------------------------------------------------------------------------------------------------------------

export interface LexOutcome {
  /** r_k = d̃_k(x*) − d̃_k(x̂) per goal (positive = worse than the reference). */
  regret: number[];
  /** All active goals within half their tolerance: r_k ≤ δ_k / 2. */
  success: boolean;
  /** 1-based index of the first goal with r_k > δ_k / 2, 0 when none fails. */
  firstFail: number;
  /** Goal-1 regret in metric units (|u − b| × r_1). */
  r1Metric: number;
}

/** Lexicographic regret of a returned plan's d̃ against the reference plan's d̃ (null plan → baseline, d̃ = 0). */
export function lexOutcome(goals: readonly GoalRef[], dRef: readonly number[], dHat: readonly number[] | null): LexOutcome {
  const regret = goals.map((g, k) => (g.active ? dRef[k]! - (dHat ? Math.max(-1, dHat[k]!) : 0) : 0));
  let firstFail = 0;
  for (let k = 0; k < goals.length; k++) {
    if (goals[k]!.active && regret[k]! > goals[k]!.delta / 2 + 1e-12) {
      firstFail = k + 1;
      break;
    }
  }
  const g0 = goals[0]!;
  return { regret, success: firstFail === 0, firstFail, r1Metric: regret[0]! * Math.abs(g0.u - g0.b) };
}

/**
 * ε-lexicographic reference among candidate plans (each: d̃ vector, feasible flag): stage optima S_k with floors
 * S_j − δ_j for j < k, then the plan with the largest goal score G among those meeting every floor. Returns the
 * index of the reference plan (−1 without a feasible candidate) and the stage optima.
 */
export function lexReference(goals: readonly GoalRef[], cands: ReadonlyArray<{ d: readonly number[]; feasible: boolean }>): { index: number; stage: number[] } {
  const K = goals.length;
  const floors = new Array<number>(K).fill(-Infinity);
  const stage = new Array<number>(K).fill(NaN);
  const meets = (d: readonly number[], upTo: number) => {
    for (let j = 0; j < upTo; j++) if (goals[j]!.active && d[j]! < floors[j]! - 1e-12) return false;
    return true;
  };
  for (let k = 0; k < K; k++) {
    if (!goals[k]!.active) continue;
    let best = -Infinity;
    for (const c of cands) if (c.feasible && meets(c.d, k) && c.d[k]! > best) best = c.d[k]!;
    if (best === -Infinity) return { index: -1, stage };
    stage[k] = best;
    floors[k] = best - goals[k]!.delta;
  }
  let index = -1;
  let bestG = -Infinity;
  cands.forEach((c, i) => {
    if (!c.feasible || !meets(c.d, K)) return;
    const G = goalScore(goals, c.d as number[]);
    if (G > bestG + 1e-12) {
      bestG = G;
      index = i;
    }
  });
  return { index, stage };
}

// ---------------------------------------------------------------------------------------------------------------
// time to quality
// ---------------------------------------------------------------------------------------------------------------

/** A nominal, feasible evaluation of a run in evaluation order (the anytime trace). */
export interface TracePoint {
  /** Cumulative EU when the evaluation returned. */
  eu: number;
  /** Wall time since the run started, ms. */
  ms: number;
  /** Raw goal functionals (metric units). */
  raw: number[];
  /** Difficulty / first descriptor (NaN when unknown). */
  D: number;
  /** Second descriptor (style axis for the visited-archive grid; NaN when absent). */
  b1: number;
}

export interface Hit {
  eu: number;
  ms: number;
}

/** First EU / wall time at which the best-so-far attainment G/G* reaches each target level (null = never). */
export function timeToTargets(goals: readonly GoalRef[], trace: readonly TracePoint[], gRef: number, levels: readonly number[] = TARGET_LEVELS): Array<Hit | null> {
  const out: Array<Hit | null> = levels.map(() => null);
  if (!(gRef > 0)) return out;
  let best = -Infinity;
  for (const t of trace) {
    const a = goalScore(goals, desirability(goals, t.raw)) / gRef;
    if (a <= best) continue;
    best = a;
    levels.forEach((L, i) => {
      if (out[i] === null && best >= L - 1e-12) out[i] = { eu: t.eu, ms: t.ms };
    });
  }
  return out;
}

/** Best-so-far attainment curve on a log-spaced EU grid (for convergence plots). */
export function attainmentCurve(goals: readonly GoalRef[], trace: readonly TracePoint[], gRef: number, grid: readonly number[]): number[] {
  const out: number[] = [];
  let best = 0;
  let i = 0;
  for (const e of grid) {
    while (i < trace.length && trace[i]!.eu <= e) {
      const a = gRef > 0 ? goalScore(goals, desirability(goals, trace[i]!.raw)) / gRef : 0;
      if (a > best) best = a;
      i++;
    }
    out.push(Math.max(0, Math.min(1.5, best)));
  }
  return out;
}

/** Log-spaced EU grid from 10 to `max` (inclusive), `perDecade` points per decade. */
export function euGrid(max: number, perDecade = 10): number[] {
  const out: number[] = [];
  const lo = 1;
  const hi = Math.log10(Math.max(10, max));
  for (let k = lo * perDecade; k <= Math.ceil(hi * perDecade); k++) out.push(Math.min(max, Math.round(10 ** (k / perDecade))));
  return [...new Set(out)];
}

/**
 * ECDF of runtimes over (run, target) pairs on an EU grid: share of pairs solved by each grid budget. `hits[r][t]` is
 * the EU of run r at target t (null = never).
 */
export function runtimeEcdf(hits: ReadonlyArray<ReadonlyArray<number | null>>, grid: readonly number[]): number[] {
  const all = hits.flat();
  if (!all.length) return grid.map(() => 0);
  return grid.map((e) => all.filter((h) => h !== null && h <= e).length / all.length);
}

/** Area under the ECDF over log10(EU) normalised to [0, 1] (the anytime score). */
export function ecdfArea(ecdf: readonly number[], grid: readonly number[]): number {
  if (grid.length < 2) return ecdf[0] ?? 0;
  const lx = grid.map((g) => Math.log10(g));
  let area = 0;
  for (let i = 1; i < grid.length; i++) area += ((ecdf[i]! + ecdf[i - 1]!) / 2) * (lx[i]! - lx[i - 1]!);
  return area / (lx[lx.length - 1]! - lx[0]!);
}

// ---------------------------------------------------------------------------------------------------------------
// ladder: hypervolume, IGD⁺, distinctness, monotonicity
// ---------------------------------------------------------------------------------------------------------------

/** A point of the attainment-difficulty plane: g = goal-1 attainment (maximise), D = difficulty (minimise). */
export interface LadderPoint {
  g: number;
  D: number;
}

/** Non-dominated subset (max g, min D), sorted by increasing D. */
export function nondominated(points: readonly LadderPoint[]): LadderPoint[] {
  const ps = points.filter((p) => Number.isFinite(p.g) && Number.isFinite(p.D)).slice().sort((a, b) => a.D - b.D || b.g - a.g);
  const out: LadderPoint[] = [];
  let bestG = -Infinity;
  for (const p of ps) {
    if (p.g > bestG + 1e-12) {
      out.push(p);
      bestG = p.g;
    }
  }
  return out;
}

/**
 * 2-D hypervolume of {(g, 1 − D)} with reference point (0, 0) (both maximised; g and D clipped to [0, 1]): the area
 * dominated by the points. 1 is the unreachable ideal (full attainment at zero difficulty).
 */
export function hypervolume(points: readonly LadderPoint[]): number {
  const nd = nondominated(points.map((p) => ({ g: Math.min(1, Math.max(0, p.g)), D: Math.min(1, Math.max(0, p.D)) })));
  // sorted by increasing D (= decreasing h = 1 − D) with increasing g: Σ (g_i − g_{i−1}) · h_i
  let hv = 0;
  let prevG = 0;
  for (const p of nd) {
    if (p.g > prevG) {
      hv += (p.g - prevG) * (1 - p.D);
      prevG = p.g;
    }
  }
  return hv;
}

/**
 * IGD⁺ (Ishibuchi et al. 2015) of an approximation against a reference front, in the (g max, D min) plane:
 * mean over reference points z of min over approximation points a of ‖(max(0, z_g − a_g), max(0, a_D − z_D))‖.
 * Infinity for an empty approximation.
 */
export function igdPlus(approx: readonly LadderPoint[], front: readonly LadderPoint[]): number {
  if (!front.length) return NaN;
  if (!approx.length) return Infinity;
  let s = 0;
  for (const z of front) {
    let best = Infinity;
    for (const a of approx) {
      const dg = Math.max(0, z.g - a.g);
      const dd = Math.max(0, a.D - z.D);
      const v = Math.sqrt(dg * dg + dd * dd);
      if (v < best) best = v;
    }
    s += best;
  }
  return s / front.length;
}

/** Ladder checks of the plan-ladder rules: D gaps ≥ 0.15 between consecutive rungs, pairwise Gower ≥ 0.20, order. */
export const LADDER_RULES = { minDGap: 0.15, minGower: 0.2, gTol: 1e-6 } as const;

export interface LadderCheck {
  /** Number of plans judged (≥ 2 needed for a ladder). */
  plans: number;
  pass: boolean;
  /** Pairs ordered the wrong way: a harder plan (higher D) that attains less than an easier one. */
  monotonicityViolations: number;
  minDGap: number;
  minGower: number;
}

/**
 * Distinctness and monotonicity of the returned plans as a ladder (sorted by D): pass when there are ≥ 2 plans,
 * consecutive D gaps ≥ 0.15, every pairwise Gower distance ≥ 0.20 and attainment never falls as D rises.
 */
export function ladderCheck(plans: ReadonlyArray<LadderPoint & { features?: readonly number[] }>, gower: (a: readonly number[], b: readonly number[]) => number): LadderCheck {
  const ps = plans.filter((p) => Number.isFinite(p.D) && Number.isFinite(p.g)).slice().sort((a, b) => a.D - b.D);
  let viol = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (ps[j]!.D > ps[i]!.D + 1e-9 && ps[j]!.g < ps[i]!.g - LADDER_RULES.gTol) viol++;
  let minDGap = Infinity;
  for (let i = 1; i < ps.length; i++) minDGap = Math.min(minDGap, ps[i]!.D - ps[i - 1]!.D);
  let minGower = Infinity;
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!.features;
      const b = ps[j]!.features;
      if (a && b) minGower = Math.min(minGower, gower(a, b));
    }
  const pass = ps.length >= 2 && minDGap >= LADDER_RULES.minDGap - 1e-9 && (minGower === Infinity || minGower >= LADDER_RULES.minGower - 1e-9) && viol === 0;
  return { plans: ps.length, pass, monotonicityViolations: viol, minDGap: ps.length >= 2 ? minDGap : NaN, minGower: minGower === Infinity ? NaN : minGower };
}

/** Plain Gower distance over features already scaled to [0, 1] (mean absolute difference). */
export function unitGower(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.min(1, Math.abs(a[i]! - b[i]!));
  return s / n;
}

// ---------------------------------------------------------------------------------------------------------------
// visited-archive quality diversity
// ---------------------------------------------------------------------------------------------------------------

/**
 * QD-score and coverage of the plans a run visited on a fixed grid over (D, b₁) ∈ [0, 1]² (`bins` × `bins` cells):
 * QD-score = Σ over cells of the best attainment G/G* (clipped to [0, 1]) / cells; coverage = filled / cells.
 * Measures what the search explored, independent of how either algorithm's archive is shaped.
 */
export function visitedQd(goals: readonly GoalRef[], trace: readonly TracePoint[], gRef: number, bins = 10): { score: number; coverage: number } {
  const best = new Float64Array(bins * bins).fill(-1);
  for (const t of trace) {
    if (!Number.isFinite(t.D)) continue;
    const i = Math.min(bins - 1, Math.max(0, Math.floor(t.D * bins)));
    const j = Number.isFinite(t.b1) ? Math.min(bins - 1, Math.max(0, Math.floor(t.b1 * bins))) : 0;
    const a = gRef > 0 ? Math.min(1, Math.max(0, goalScore(goals, desirability(goals, t.raw)) / gRef)) : 0;
    const c = i * bins + j;
    if (a > best[c]!) best[c] = a;
  }
  let filled = 0;
  let score = 0;
  for (const v of best)
    if (v >= 0) {
      filled++;
      score += v;
    }
  return { score: score / best.length, coverage: filled / best.length };
}
