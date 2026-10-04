/* Frozen copy of the v1 planner optimiser (src/engine/planner/optim as of 2026-10-01, before planner v2; PLANNER_V2_SPEC §5.1 "the v1 planner is frozen behind an adapter"). Do not edit: the benchmark harness measures every v2 change against it. */
/**
 * Ranked-goal machinery (dossier 18 §4.5-4.7, §4.9, §4.14). Pure arithmetic over metric vectors —
 * no physiology. The caller supplies, per evaluated plan, the raw goal functionals (metric units),
 * the state-space constraint violation v_S and the weighted regulariser R = λ_H·H + λ_C·C + λ_T·R_term.
 *
 * Conventions: f_g = s_g·Φ_g is *maximised* (s = +1 for 'max', −1 for 'min'); band goals use
 * f = −(normalised distance outside the band) with target 0. Desirability d̃ = min(1, (f − b)/(u − b))
 * (§4.6) with baseline b, anchor a (best feasible f seen), u = target if set else a.
 */
import type { Key } from './cmaes';

// ---------------------------------------------------------------------------------------------
// §4.5 Metric functionals over a daily series y(0..T) (index 0 = initial state)
// ---------------------------------------------------------------------------------------------

function lastIndex(y: ArrayLike<number>): number {
  return y.length - 1;
}

/** END_k: mean of the last k daily values (k = 7 default); stocks judged at the end. */
export function endMean(y: ArrayLike<number>, k = 7, at?: number): number {
  const T = at ?? lastIndex(y);
  const from = Math.max(T - k + 1, T >= 1 ? 1 : 0);
  let s = 0;
  for (let t = from; t <= T; t++) s += y[t]!;
  return s / (T - from + 1);
}

/** DELTA: END_7 − y(0) ("lose 10 kg fat"). */
export function delta(y: ArrayLike<number>, k = 7, at?: number): number {
  return endMean(y, k, at) - y[0]!;
}

/** MEAN_W over days [from, to] (default the whole horizon 1..T); time-integrated signals. */
export function windowMean(y: ArrayLike<number>, from = 1, to = lastIndex(y)): number {
  const a = Math.max(0, Math.min(from, lastIndex(y)));
  const b = Math.max(a, Math.min(to, lastIndex(y)));
  let s = 0;
  for (let t = a; t <= b; t++) s += y[t]!;
  return s / (b - a + 1);
}

const logistic = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** TIR_[a,b]: smooth share of days in range, s = 2 % of (b − a) by default (avoids plateaus). */
export function timeInRange(y: ArrayLike<number>, lo: number, hi: number, s = 0.02 * (hi - lo)): number {
  const T = lastIndex(y);
  if (T < 1) return NaN;
  let acc = 0;
  for (let t = 1; t <= T; t++) acc += logistic((y[t]! - lo) / s) * logistic((hi - y[t]!) / s);
  return acc / T;
}

/** SOFTMIN: −(1/β) ln Σ exp(−β y); default β keeps it within 1 % of |min| (+ tiny) of the true minimum. */
export function softMin(y: ArrayLike<number>, beta?: number): number {
  let mn = Infinity;
  for (let t = 0; t < y.length; t++) mn = Math.min(mn, y[t]!);
  const b = beta ?? Math.log(Math.max(2, y.length)) / (0.01 * Math.max(Math.abs(mn), 1e-9));
  let s = 0;
  for (let t = 0; t < y.length; t++) s += Math.exp(-b * (y[t]! - mn));
  return mn - Math.log(s) / b;
}

/** AUC_θ: mean exposure above θ over days 1..T. */
export function aucAbove(y: ArrayLike<number>, theta: number): number {
  const T = lastIndex(y);
  if (T < 1) return 0;
  let acc = 0;
  for (let t = 1; t <= T; t++) acc += Math.max(0, y[t]! - theta);
  return acc / T;
}

/**
 * TTT_θ with the §4.14.3 shaping, as a *maximised* objective J: −t_hit (interpolated) if the series
 * crosses θ (direction +1: y ≥ θ, −1: y ≤ θ), else −T − (θ − y(T))/r with r = (θ − y(0))/T (signed).
 */
export function timeToTarget(
  y: ArrayLike<number>,
  theta: number,
  direction: 1 | -1 = 1,
): { tHit: number | null; objective: number } {
  const T = lastIndex(y);
  const g = (v: number) => direction * (v - theta); // ≥ 0 when reached
  if (g(y[0]!) >= 0) return { tHit: 0, objective: 0 };
  for (let t = 1; t <= T; t++) {
    const cur = g(y[t]!);
    if (cur >= 0) {
      const prev = g(y[t - 1]!);
      const tHit = t - 1 + prev / (prev - cur);
      return { tHit, objective: -tHit };
    }
  }
  const r = (direction * (theta - y[0]!)) / Math.max(T, 1);
  const gap = direction * (theta - y[T]!);
  return { tHit: null, objective: -T - gap / Math.max(r, 1e-12) };
}

// ---------------------------------------------------------------------------------------------
// §4.9 regulariser helpers (generic arithmetic; the planner computes the inputs)
// ---------------------------------------------------------------------------------------------

/** H(x) = (1/T) Σ softplus_κ(h − h_tol) + ω · longest run(h > h_tol)/7, κ = 20, ω = 0.5 (§4.9). */
export function hungerPenalty(h: ArrayLike<number>, hTol: number, kappa = 20, omega = 0.5): number {
  if (h.length === 0) return 0;
  let acc = 0;
  let run = 0;
  let maxRun = 0;
  for (let t = 0; t < h.length; t++) {
    const z = kappa * (h[t]! - hTol);
    acc += (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z))) / kappa;
    run = h[t]! > hTol ? run + 1 : 0;
    maxRun = Math.max(maxRun, run);
  }
  return acc / h.length + (omega * maxRun) / 7;
}

/** Hard adherence cap margin (≥ 0 satisfied): (h_tol + 0.15) − max over 7-day windows of mean h (§4.9). */
export function hungerCapMargin(h: ArrayLike<number>, hTol: number, windowDays = 7, excess = 0.15): number {
  if (h.length === 0) return Infinity;
  const w = Math.min(windowDays, h.length);
  let s = 0;
  for (let t = 0; t < w; t++) s += h[t]!;
  let worst = s / w;
  for (let t = w; t < h.length; t++) {
    s += h[t]! - h[t - w]!;
    worst = Math.max(worst, s / w);
  }
  return hTol + excess - worst;
}

export interface ComplexityCounts {
  dayTypesPerPhase: readonly number[];
  distinctPhases: number;
  phaseTransitions: number;
  horizonDays: number;
  eventComplexityCosts: readonly number[];
  /** (1/T) Σ_t |Δ window start|_circ in hours. */
  meanWindowStartShiftH: number;
  distinctTrainingClockTimes: number;
  /** Share of days identical to the same weekday one week earlier. */
  weekRepeatShare: number;
}

/** Complexity penalty C(x) with the §4.9 coefficients (UNVERIFIED placeholders, each ≈ 1-2 % of goal-1 range). */
export function complexityPenalty(c: ComplexityCounts): number {
  let dt = 0;
  for (const k of c.dayTypesPerPhase) dt += Math.max(0, k - 1);
  let ev = 0;
  for (const e of c.eventComplexityCosts) ev += e;
  return (
    0.015 * dt +
    0.02 * Math.max(0, c.distinctPhases - 1) +
    (0.01 * c.phaseTransitions * 28) / Math.max(1, c.horizonDays) +
    0.01 * ev +
    0.02 * c.meanWindowStartShiftH +
    0.01 * Math.max(0, c.distinctTrainingClockTimes - 1) +
    0.05 * (1 - c.weekRepeatShare)
  );
}

/**
 * §4.14.2 binding constraints from a decoder repair log: a rule is binding when it acted on at least
 * `minShare` (20 %) of the horizon's days. (Margin-based "within 2 % of the bound" needs per-day margins
 * from the engine and is left to the integrating planner.) Returns rules with their activity share.
 */
export function bindingConstraints(
  log: ReadonlyArray<{ rule: string; day?: number }>,
  horizonDays: number,
  minShare = 0.2,
): Array<{ rule: string; share: number }> {
  const days = new Map<string, Set<number>>();
  for (const e of log) {
    if (e.day === undefined) continue;
    let s = days.get(e.rule);
    if (!s) days.set(e.rule, (s = new Set()));
    s.add(e.day);
  }
  const out: Array<{ rule: string; share: number }> = [];
  for (const [rule, s] of days) {
    const share = s.size / Math.max(1, horizonDays);
    if (share >= minShare) out.push({ rule, share });
  }
  return out.sort((a, b) => b.share - a.share || (a.rule < b.rule ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// §4.6-4.7 Goals, desirability, floors, comparators
// ---------------------------------------------------------------------------------------------

export type GoalSense = 'max' | 'min' | 'band';

export interface GoalSpec {
  id: string;
  label?: string;
  sense: GoalSense;
  /** Aspiration θ (metric units) for max/min goals: satiation — improvement beyond θ is worth nothing. */
  target?: number;
  /** Band goal [lo, hi] with optional linear decay widths (default: distance from baseline to the band). */
  band?: { lo: number; hi: number; widthLo?: number; widthHi?: number };
  /** Reported-desirability exponent γ (default 1, keeps "% of possible" exact). */
  gamma?: number;
  /** Explicit degradation tolerance δ (overrides the ladder × strictness). */
  tolerance?: number;
  /**
   * "Keep" goal (needs `target`): stay at or beyond the target. Desirability is 1 when met and falls by 1 per `keep`
   * metric units of shortfall; unlike a plain target it stays active when the baseline already meets it, so a goal such
   * as "keep fat mass" constrains lower-ranked and higher-ranked trade-offs instead of being skipped as met.
   */
  keep?: number;
  /**
   * Smallest tolerance, metric units: floors never demand more precision than this (e.g. the model's own ensemble spread
   * of the goal — differences below it are not meaningful). Applied on top of δ when a stage sets the goal's floor.
   */
  minTolerance?: number;
}

export type Strictness = 'strict' | 'balanced' | 'flexible';

/** §4.7.3 default tolerances: 5 % for goal 1, 10 % for goal 2, 15 % for goals ≥ 3. */
export const TOLERANCE_LADDER: readonly number[] = [0.05, 0.1, 0.15];
export const STRICTNESS_FACTOR: Readonly<Record<Strictness, number>> = {
  strict: 0.5,
  balanced: 1,
  flexible: 2,
};
/** η: weight of the regulariser inside lexicographic stages (tie-breaking only), §4.7.3. */
export const DEFAULT_ETA = 0.1;
/** α: box-repair penalty weight, §4.8. */
export const DEFAULT_BOX_WEIGHT = 1;
/** Quantisation step of the provisional comparator, §4.7.3. */
export const PROVISIONAL_QUANTUM = 0.1;
/**
 * Step of the weighted goal score G = Σ w_j·min(1, d̃_j) in the final comparator (ruling R-FAST-GATE, 2026-10-01;
 * PROPOSED planner tuning): plans are compared on ⌊G / step⌋ first and only then on the regulariser R (complexity,
 * hunger, time burden), so R breaks ties between plans that serve the ranked goals equally and can no longer outweigh a
 * better plan (golden request d: a 72-h-fast plan with G 0.728 lost to one with 0.715 on R). 0.01 = 1 % of the full
 * goal range.
 */
export const GOAL_SCORE_STEP = 0.01;

/**
 * Goal-first order of two plans (negative = `a` is better): the goal-score step ⌊G/step⌋ (higher first), then the
 * penalty G − U (lower first), then G. Plans without a goal score fall back to the utility U.
 */
export function compareGoalFirst(
  a: { utility: number; goalScore?: number },
  b: { utility: number; goalScore?: number },
  step = GOAL_SCORE_STEP,
): number {
  if (a.goalScore === undefined || b.goalScore === undefined || !(step > 0)) return b.utility - a.utility;
  const qa = Math.floor(a.goalScore / step + 1e-9);
  const qb = Math.floor(b.goalScore / step + 1e-9);
  if (qa !== qb) return qb - qa;
  const pa = a.goalScore - a.utility;
  const pb = b.goalScore - b.utility;
  if (pa !== pb) return pa - pb;
  return b.goalScore - a.goalScore;
}

export function ladderTolerance(rank: number, strictness: Strictness = 'balanced'): number {
  const base = TOLERANCE_LADDER[Math.min(rank, TOLERANCE_LADDER.length - 1)]!;
  return base * STRICTNESS_FACTOR[strictness];
}

/** Rank-order-centroid weights w_i = (1/K) Σ_{k=i}^{K} 1/k (Barron & Barrett [17]). */
export function rocWeights(K: number): Float64Array {
  const w = new Float64Array(K);
  for (let i = 0; i < K; i++) {
    let s = 0;
    for (let k = i + 1; k <= K; k++) s += 1 / k;
    w[i] = s / K;
  }
  return w;
}

export type GoalStatus = 'active' | 'metAtBaseline' | 'notImprovable';

export interface GoalScale {
  /** Baseline b (maximised units). */
  b: number;
  /** Anchor a: best feasible f seen. */
  a: number;
  /** Upper reference u = θ if a target is set, else a. */
  u: number;
  /** Sign-adjusted target, or null. */
  theta: number | null;
}

/** What the comparators need about one evaluated plan. */
export interface Scored {
  /** Goal objectives f (maximised units), length K. */
  f: ArrayLike<number>;
  /** Normalised state-space safety violation v_S (0 = feasible). */
  vS: number;
  /** Weighted regulariser R ≥ 0. */
  reg: number;
  /** ‖x − clamp(x)‖² (normalised), 0 for in-box genomes. */
  box?: number;
}

export interface GoalSystemOptions {
  strictness?: Strictness;
  /** δ applied to a target goal whose target was reached (default 0: "a target you set is kept"). */
  targetTolerance?: number;
  eta?: number;
  boxWeight?: number;
  quantum?: number;
  /** Step of the weighted goal score in the final comparator (default `GOAL_SCORE_STEP`). */
  scoreStep?: number;
}

export interface GoalFeasibility {
  goal: number;
  id: string;
  status: GoalStatus | 'attainable' | 'unattainable' | 'attainableAloneNotJointly' | 'directional';
  /** Metric units (for band goals: f units, i.e. minus the normalised distance outside the band). */
  baseline: number;
  best: number;
  target: number | null;
  /** When the target is unattainable: the best value found (§4.14.1). */
  nearestAttainableTarget: number | null;
  /** Anchor as % of target range (Q at the anchor), NaN without target. */
  bestPercentOfTarget: number;
  achieved: number;
  percentOfPossible: number;
  percentOfTarget: number;
}

const TINY = 1e-12;

/**
 * State of the ranked-goal procedure for one planner run: baseline, monotone anchors, floors stored in
 * physical units (§4.6 — they do not move when anchors improve later), comparators and reports.
 */
export class GoalSystem {
  readonly goals: readonly GoalSpec[];
  readonly K: number;
  readonly weights: Float64Array;
  /** Ladder tolerance δ_k per goal (after strictness). */
  readonly delta: Float64Array;
  readonly eta: number;
  readonly boxWeight: number;
  readonly quantum: number;
  readonly scoreStep: number;
  readonly targetTolerance: number;
  private readonly sign: Float64Array;
  private readonly theta: Float64Array;
  private readonly bandW: Float64Array;
  private readonly b: Float64Array;
  private readonly a: Float64Array;
  private readonly floorF: Float64Array;
  private readonly floorD: Float64Array;
  /** Keep-goal scale in objective units (NaN for other goals). */
  private readonly keepS: Float64Array;
  private baselineSet = false;

  constructor(goals: readonly GoalSpec[], opts: GoalSystemOptions = {}) {
    if (goals.length === 0) throw new RangeError('GoalSystem: at least one goal');
    this.goals = goals;
    const K = (this.K = goals.length);
    this.weights = rocWeights(K);
    this.eta = opts.eta ?? DEFAULT_ETA;
    this.boxWeight = opts.boxWeight ?? DEFAULT_BOX_WEIGHT;
    this.quantum = opts.quantum ?? PROVISIONAL_QUANTUM;
    this.scoreStep = opts.scoreStep ?? GOAL_SCORE_STEP;
    this.targetTolerance = opts.targetTolerance ?? 0;
    this.delta = new Float64Array(K);
    this.sign = new Float64Array(K);
    this.theta = new Float64Array(K).fill(NaN);
    this.bandW = new Float64Array(2 * K).fill(NaN);
    this.b = new Float64Array(K);
    this.a = new Float64Array(K).fill(-Infinity);
    this.floorF = new Float64Array(K).fill(NaN);
    this.floorD = new Float64Array(K).fill(NaN);
    this.keepS = new Float64Array(K).fill(NaN);
    goals.forEach((g, k) => {
      if (g.keep !== undefined && g.target !== undefined && g.sense !== 'band' && g.keep > 0) this.keepS[k] = g.keep;
      this.delta[k] = g.tolerance ?? ladderTolerance(k, opts.strictness);
      this.sign[k] = g.sense === 'min' ? -1 : 1;
      if (g.sense === 'band') {
        if (!g.band || !(g.band.hi >= g.band.lo))
          throw new RangeError(`GoalSystem: band goal ${g.id} needs lo ≤ hi`);
        this.theta[k] = 0;
      } else if (g.target !== undefined) this.theta[k] = this.sign[k]! * g.target;
    });
  }

  // ---- objectives and scales ----

  /** Goal objectives f (maximised units) from raw goal functionals (metric units). */
  objective(raw: ArrayLike<number>, out = new Float64Array(this.K)): Float64Array {
    if (raw.length !== this.K)
      throw new RangeError(`GoalSystem.objective: expected ${this.K} values, got ${raw.length}`);
    for (let k = 0; k < this.K; k++) {
      const g = this.goals[k]!;
      const v = raw[k]!;
      if (g.sense === 'band') {
        const { lo, hi } = g.band!;
        out[k] = -(Math.max(0, lo - v) / this.bandW[2 * k]! + Math.max(0, v - hi) / this.bandW[2 * k + 1]!);
      } else out[k] = this.sign[k]! * v;
    }
    return out;
  }

  /** Set the baseline plan's raw functionals (desirability zero). Resets anchors to the baseline. */
  setBaseline(raw: ArrayLike<number>): Float64Array {
    for (let k = 0; k < this.K; k++) {
      const g = this.goals[k]!;
      if (g.sense !== 'band') continue;
      const { lo, hi, widthLo, widthHi } = g.band!;
      const v = raw[k]!;
      const dist = v < lo ? lo - v : v > hi ? v - hi : 0;
      const def = Math.max(dist, hi - lo, Math.abs(lo) * 1e-6, TINY);
      this.bandW[2 * k] = widthLo ?? def;
      this.bandW[2 * k + 1] = widthHi ?? def;
    }
    const f = this.objective(raw);
    this.b.set(f);
    this.a.set(f);
    this.baselineSet = true;
    return f;
  }

  get hasBaseline(): boolean {
    return this.baselineSet;
  }

  /** Offer an evaluated plan; anchors improve monotonically from safety-feasible plans. */
  observe(f: ArrayLike<number>, feasible: boolean): boolean {
    if (!feasible) return false;
    let changed = false;
    for (let k = 0; k < this.K; k++) {
      if (f[k]! > this.a[k]!) {
        this.a[k] = f[k]!;
        changed = true;
      }
    }
    return changed;
  }

  scale(k: number): GoalScale {
    const th = this.theta[k]!;
    const hasT = !Number.isNaN(th);
    // keep goals: desirability zero `keep` units short of the target, whatever the baseline did
    const ks = this.keepS[k]!;
    const b = Number.isNaN(ks) ? this.b[k]! : th - ks;
    return { b, a: this.a[k]!, u: hasT ? th : this.a[k]!, theta: hasT ? th : null };
  }

  /** True for "keep" goals (`GoalSpec.keep`). */
  isKeep(k: number): boolean {
    return !Number.isNaN(this.keepS[k]!);
  }

  hasTarget(k: number): boolean {
    return !Number.isNaN(this.theta[k]!);
  }

  status(k: number): GoalStatus {
    const { b, u, theta } = this.scale(k);
    if (theta !== null && b >= theta) return 'metAtBaseline';
    if (!(u - b > Math.max(TINY, Math.abs(b) * 1e-12))) return 'notImprovable';
    return 'active';
  }

  isActive(k: number): boolean {
    return this.status(k) === 'active';
  }

  /** Search desirability d̃ = min(1, (f − b)/(u − b)) — no lower clip (§4.6). Inactive goals: 1 (met) or 0. */
  dRaw(k: number, fk: number): number {
    const st = this.status(k);
    if (st === 'metAtBaseline') return 1;
    if (st === 'notImprovable') return 0;
    const { b, u } = this.scale(k);
    return Math.min(1, (fk - b) / (u - b));
  }

  desirability(f: ArrayLike<number>, out = new Float64Array(this.K)): Float64Array {
    for (let k = 0; k < this.K; k++) out[k] = this.dRaw(k, f[k]!);
    return out;
  }

  /** Reported desirability d = clip(d̃, 0, 1)^γ. */
  dReported(k: number, fk: number): number {
    const d = Math.min(1, Math.max(0, this.dRaw(k, fk)));
    return d ** (this.goals[k]!.gamma ?? 1);
  }

  /** P_g = (f − b)/(a − b): share of the achievable range obtained ("% of what was possible"). */
  percentOfPossible(k: number, fk: number): number {
    const { a, b } = this.scale(k);
    return a - b > TINY ? (fk - b) / (a - b) : NaN;
  }

  /** Q_g = (f − b)/(θ − b), NaN without target. */
  percentOfTarget(k: number, fk: number): number {
    const { b, theta } = this.scale(k);
    return theta !== null && Math.abs(theta - b) > TINY ? (fk - b) / (theta - b) : NaN;
  }

  /** Metric-unit value of an objective (inverse of the sign convention; band goals stay in f units). */
  toMetric(k: number, fk: number): number {
    return this.goals[k]!.sense === 'band' ? fk : this.sign[k]! * fk;
  }

  /** Final utility U = Σ_j w_j · min(1, d̃_j) − R over active goals (ROC weights; tie-breaker only). */
  utility(f: ArrayLike<number>, reg: number): number {
    return this.utilityD(this.desirability(f), reg);
  }

  /** Weighted goal score G = Σ_j w_j · min(1, d̃_j) over active goals (U without the regulariser). */
  goalScore(f: ArrayLike<number>): number {
    return this.utilityD(this.desirability(f), 0);
  }

  /** ⌊G / step⌋: the goal-score step the final comparator ranks first (ruling R-FAST-GATE). */
  scoreLevel(g: number): number {
    return this.scoreStep > 0 ? Math.floor(g / this.scoreStep + 1e-9) : 0;
  }

  /** U from a desirability vector (e.g. ensemble-mean d̃, §4.15). */
  utilityD(d: ArrayLike<number>, reg: number): number {
    let u = 0;
    for (let k = 0; k < this.K; k++) if (this.isActive(k)) u += this.weights[k]! * Math.min(1, d[k]!);
    return u - reg;
  }

  // ---- floors (ε-lexicographic) ----

  /** Floor L_k in the current desirability scale (NaN if unset). */
  floor(k: number): number {
    const F = this.floorF[k]!;
    if (Number.isNaN(F)) return NaN;
    const { b, u } = this.scale(k);
    return u - b > TINY ? (F - b) / (u - b) : 1;
  }

  floorPhysical(k: number): number {
    return this.floorF[k]!;
  }

  /** Relaxation Δ_k used for alternatives (= δ actually applied when the floor was set). */
  floorRelaxation(k: number): number {
    return this.floorD[k]!;
  }

  /**
   * Set L_k from the stage-k winner's objective f_k (§4.7.3): a reached target is kept (L = 1 − δ_target),
   * otherwise L_k = d̃_k(x_k*) − δ_k. Stored in physical units F_k = b + L(u − b). Returns L_k.
   */
  setFloorFrom(k: number, fk: number): number {
    if (!this.isActive(k)) return NaN;
    const d = this.dRaw(k, fk);
    const reached = this.hasTarget(k) && d >= 1;
    const { b, u, a } = this.scale(k);
    // a kept goal may give up its ladder tolerance (δ_k × keep units) to higher-ranked goals; other reached targets
    // are kept at δ_target. An UNREACHED target's tolerance is δ_k of the achievable range (§4.7.3 "goal k may lose δ_k
    // of its achievable range"): d̃ is scaled to the target, so δ_k of d̃ would be δ_k of the distance to a target that
    // may lie far beyond reach (e.g. 5 % of a 2-kg muscle target is 0.1 kg when only 0.3 kg is achievable)
    let dl = reached && !this.isKeep(k) ? this.targetTolerance : this.delta[k]!;
    if (!reached && this.hasTarget(k) && !this.isKeep(k) && u - b > TINY) dl *= Math.min(1, Math.max(0, (a - b) / (u - b)));
    // floors never ask for more precision than the ensemble resolves (minTolerance), reached targets included: the
    // robust check reads the draw-mean of min(1, d̃), which stays below 1 for any plan whose draws straddle the target
    // (release check 2026-10-01: a fat-loss target that became reachable left every finalist short of L = 1)
    const mt = this.goals[k]!.minTolerance;
    if (mt !== undefined && mt > 0 && u - b > TINY) dl = Math.max(dl, mt / (u - b));
    const L = (reached ? 1 : d) - dl;
    this.floorF[k] = b + L * (u - b);
    // alternatives (relaxed floors) may fall short of a reached target by the goal's ladder tolerance δ_k of the
    // distance to it (once the target became reachable through one plan family only, "reached targets are kept" with
    // Δ = 0 left no room for any alternative); option A still keeps the target
    this.floorD[k] = reached && !this.isKeep(k) ? Math.max(dl, this.delta[k]!) : dl;
    return L;
  }

  clearFloors(): void {
    this.floorF.fill(NaN);
    this.floorD.fill(NaN);
  }

  /** v_L = Σ_{j<k} 2^{k−j} · max(0, L_j − Δ_j·relaxed − d̃_j) (priority-weighted floor violation). */
  floorViolation(f: ArrayLike<number>, k: number, relaxed = false): number {
    return this.floorViolationD(this.desirability(f), k, relaxed);
  }

  /** v_L from a desirability vector. */
  floorViolationD(d: ArrayLike<number>, k: number, relaxed = false): number {
    let v = 0;
    for (let j = 0; j < Math.min(k, this.K); j++) {
      const L = this.floor(j);
      if (Number.isNaN(L)) continue;
      const lj = relaxed ? L - this.floorD[j]! : L;
      v += 2 ** (k - j) * Math.max(0, lj - d[j]!);
    }
    return v;
  }

  /** True when all set floors hold (optionally relaxed by Δ_j) within `tol` desirability units. */
  priorityFeasible(f: ArrayLike<number>, relaxed = false, tol = 1e-9): boolean {
    return this.priorityFeasibleD(this.desirability(f), relaxed, tol);
  }

  priorityFeasibleD(d: ArrayLike<number>, relaxed = false, tol = 1e-9): boolean {
    for (let j = 0; j < this.K; j++) {
      const L = this.floor(j);
      if (Number.isNaN(L)) continue;
      if (d[j]! < (relaxed ? L - this.floorD[j]! : L) - tol) return false;
    }
    return true;
  }

  // ---- comparators (keys: lexicographic, smaller is better) ----

  /** Stage-k key (§4.7.3): (v_S, v_L over j < k, −(d̃_k − η·R − α·box)). */
  stageKey(k: number, s: Scored): Key {
    return [
      s.vS,
      this.floorViolation(s.f, k),
      -(this.dRaw(k, s.f[k]!) - this.eta * s.reg - this.boxWeight * (s.box ?? 0)),
    ];
  }

  /** Single-goal anchor key (S2): (v_S, −(f_g − b)/scale + α·box), `scale` fixed for the run. */
  anchorKey(k: number, s: Scored, scale: number): Key {
    return [s.vS, -(s.f[k]! - this.b[k]!) / Math.max(scale, TINY) + this.boxWeight * (s.box ?? 0)];
  }

  /** Provisional key before any floor exists (§4.7.3): (v_S, −q_1 … −q_K, −U), q = ⌊d̃/0.1⌋. */
  provisionalKey(s: Scored): Key {
    const key = [s.vS];
    for (let k = 0; k < this.K; k++) key.push(-Math.floor(this.dRaw(k, s.f[k]!) / this.quantum + 1e-9));
    key.push(-(this.utility(s.f, s.reg) - this.boxWeight * (s.box ?? 0)));
    return key;
  }

  /**
   * Final comparator (§4.7.3/§4.12): (v_S, v_L over all goals (relaxed floors optional), −⌊G/step⌋, R + α·box, −G).
   * Ruling R-FAST-GATE: the weighted goal score is compared in fixed steps first and the regulariser only breaks ties
   * (it used to be subtracted from U, so a complexity/hunger/time penalty could outweigh a better plan).
   */
  finalKey(s: Scored, relaxed = false): Key {
    const g = this.goalScore(s.f);
    return [
      s.vS,
      this.floorViolation(s.f, this.K, relaxed),
      -this.scoreLevel(g),
      s.reg + this.boxWeight * (s.box ?? 0),
      -g,
    ];
  }

  // ---- reporting ----

  /** §4.14: per-goal attainability given the anchors and (optionally) option A's objectives. */
  feasibilityReport(fA?: ArrayLike<number>): GoalFeasibility[] {
    return this.goals.map((g, k) => {
      const { a, theta } = this.scale(k);
      const st = this.status(k);
      let status: GoalFeasibility['status'] = st;
      if (st === 'active') {
        if (theta === null) status = 'directional';
        else if (a < theta) status = 'unattainable';
        else if (fA && this.dRaw(k, fA[k]!) < 1 - 1e-9) status = 'attainableAloneNotJointly';
        else status = 'attainable';
      }
      const fa = fA ? fA[k]! : NaN;
      return {
        goal: k,
        id: g.id,
        status,
        baseline: this.toMetric(k, this.b[k]!),
        best: this.toMetric(k, a),
        target: theta === null ? null : this.toMetric(k, theta),
        nearestAttainableTarget: status === 'unattainable' ? this.toMetric(k, a) : null,
        bestPercentOfTarget: this.percentOfTarget(k, a),
        achieved: fA ? this.toMetric(k, fa) : NaN,
        percentOfPossible: fA ? this.percentOfPossible(k, fa) : NaN,
        percentOfTarget: fA ? this.percentOfTarget(k, fa) : NaN,
      };
    });
  }

  /** Serializable snapshot of scales and floors (for results/provenance). */
  snapshot(): {
    scales: GoalScale[];
    floors: number[];
    floorsPhysical: number[];
    relaxation: number[];
    status: GoalStatus[];
  } {
    return {
      scales: this.goals.map((_, k) => this.scale(k)),
      floors: this.goals.map((_, k) => this.floor(k)),
      floorsPhysical: Array.from(this.floorF),
      relaxation: Array.from(this.floorD),
      status: this.goals.map((_, k) => this.status(k)),
    };
  }
}
