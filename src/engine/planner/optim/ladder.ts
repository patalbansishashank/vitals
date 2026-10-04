/**
 * Plan ladder helpers (PLANNER_V2_SPEC §1.2-1.3): pure functions over already evaluated plans — the archive staircase
 * F(D̄), its hypervolume, the knee, the rung goal constraints and the distinctness / collapse rules. The pipeline
 * (`pipeline.ts`, stage S4.ladder and the final selection) calls them; they never evaluate anything.
 */
import type { GoalSystem } from './goals';
import type { RungId } from './types';

/** `PlannerProblem.ladder`: switches on the D-first archive and the Easy / Medium rungs (absent → v1 MMR options). */
export interface LadderSpec {
  /**
   * Goal 1's minimal meaningful change in metric units (§1.3 table: fat mass 1 kg, …). NaN (no table entry) → 10 % of
   * goal 1's achievable range (a₁ − b₁).
   */
  gMinMetric: number;
  /** Easy keeps at least this share of Hard's goal-1 desirability (default 0.5). */
  easyShare?: number;
  /** Medium fallback share when the frontier has no knee (default 0.8). */
  mediumShare?: number;
  /** Difficulty quantum q_D (default 0.02). */
  qD?: number;
  /** Minimum D gap between adjacent rungs (default 0.15). */
  minDGap?: number;
  /** Minimum pairwise Gower distance between rungs (default 0.20). */
  minGower?: number;
  /** §12.8: Medium's minimum D gap to each neighbour when Easy stands (default `MEDIUM_MARGIN.minDGap`, 0.08). */
  mediumMinDGap?: number;
  /** §12.8: Medium's minimum Gower to each neighbour when Easy stands: max(this, Gower(H, E) · heShare) (default 0.10). */
  mediumMinGower?: number;
  /**
   * The caller runs the Ideal (P6, `idealBudgetEU`, on top of the run's total) (default true). Reported in the stage
   * budget only; the run spends its whole total either way.
   */
  reserveIdeal?: boolean;
  /**
   * Hard fixed in advance (the hybrid algorithm: the frozen v1 search's option A, `runPlannerHybrid`). The genome is
   * evaluated first and becomes Hard whenever it is safe, validated and chance-feasible; Medium and Easy are built
   * around it. Absent → Hard is the best plan under the robust Hard key.
   */
  pinHard?: { structure: number; x: ArrayLike<number>; /** The caller already validated and chance-checked it on its own ensemble (trusted). */ chanceChecked?: boolean } | null;
}

/** Rung constants (§1.3; PROPOSED unless the spec fixes them). */
export const LADDER_DEFAULTS = {
  easyShare: 0.5,
  mediumShare: 0.8,
  qD: 0.02,
  minDGap: 0.15,
  minGower: 0.2,
  /** Below this normalised knee distance the frontier has no knee (Medium falls back to `mediumShare`). */
  kneeMin: 0.05,
  /** ρ of goals 2..K inside Easy / Medium. */
  rhoEasy: 0.5,
  rhoMedium: 0.8,
  /** "Keep" goals stay kept within this many tolerances inside a rung. */
  keepFactor: 2,
  /** g_min share of goal 1's achievable range when the metric has no minimal-change entry. */
  gMinRangeShare: 0.1,
} as const;

/**
 * Medium's own distinctness margins (§12.8, E21b): a Medium sits between two rungs that are themselves distinct, so it
 * needs less room than the Hard-Easy pair. With Easy present: effort ≥ `minDGap` from each neighbour and plan distance
 * ≥ max(`minGower`, distance(Hard, Easy) · `heShare`) from each; plan distance below `duplicate` is a repeat in any case.
 * Without Easy, Medium keeps the pairwise rule (`LADDER_DEFAULTS.minDGap`, `minGower`).
 */
export const MEDIUM_MARGIN = { minDGap: 0.08, minGower: 0.1, heShare: 1 / 3, duplicate: 0.05 } as const;

/** Medium's effort gap and plan distance thresholds given Hard-Easy's plan distance (NaN or null: no Easy). */
export function mediumMargins(
  gowerHE: number | null | undefined,
  spec: Pick<ResolvedLadder, 'minDGap' | 'minGower'> & Partial<Pick<ResolvedLadder, 'mediumMinDGap' | 'mediumMinGower'>>,
): { minDGap: number; minGower: number } {
  if (gowerHE === null || gowerHE === undefined || !Number.isFinite(gowerHE)) return { minDGap: spec.minDGap, minGower: spec.minGower };
  return { minDGap: spec.mediumMinDGap ?? MEDIUM_MARGIN.minDGap, minGower: Math.max(spec.mediumMinGower ?? MEDIUM_MARGIN.minGower, gowerHE * MEDIUM_MARGIN.heShare) };
}

export type ResolvedLadder = Required<Omit<LadderSpec, 'pinHard'>> & { pinHard: LadderSpec['pinHard'] };

export function resolveLadder(spec: LadderSpec): ResolvedLadder {
  return {
    gMinMetric: spec.gMinMetric,
    easyShare: spec.easyShare ?? LADDER_DEFAULTS.easyShare,
    mediumShare: spec.mediumShare ?? LADDER_DEFAULTS.mediumShare,
    qD: spec.qD ?? LADDER_DEFAULTS.qD,
    minDGap: spec.minDGap ?? LADDER_DEFAULTS.minDGap,
    minGower: spec.minGower ?? LADDER_DEFAULTS.minGower,
    mediumMinDGap: spec.mediumMinDGap ?? MEDIUM_MARGIN.minDGap,
    mediumMinGower: spec.mediumMinGower ?? MEDIUM_MARGIN.minGower,
    reserveIdeal: spec.reserveIdeal ?? true,
    pinHard: spec.pinHard ?? null,
  };
}

/** 'stopped': the search was stopped ("Stop here") before the rung was found or checked; nothing was proven. */
export type CollapseReason = 'tooClose' | 'notDistinct' | 'belowMinimal' | 'infeasible' | 'stopped';

export interface LadderCollapse {
  rung: 'medium' | 'easy';
  reason: CollapseReason;
  detail: Record<string, number>;
}

export interface LadderChecks {
  /** D_Hard − D_Medium of the solved rungs (NaN when Medium was not solved). */
  dHM: number;
  /** D_Medium − D_Easy (NaN when either was not solved). */
  dME: number;
  /** Smallest pairwise Gower distance among the solved rungs (NaN with fewer than two). */
  gowerMin: number;
  /** d̃₁ and D ordered Hard ≥ Medium ≥ Easy among the solved rungs. */
  ordered: boolean;
}

/** One point of the attainment-difficulty frontier. */
export interface StairPoint<T> {
  D: number;
  /** Goal-1 desirability d̃₁. */
  d1: number;
  /** Weighted goal score G. */
  g: number;
  item: T;
}

/**
 * Staircase F(D̄) = best_{D ≤ D̄} d̃₁ (§1.2): candidates sorted by increasing D (ties: higher d̃₁, then higher G, then
 * input order); a point is kept only when it strictly raises d̃₁. The result increases in both D and d̃₁.
 */
export function staircase<T>(cands: readonly StairPoint<T>[]): StairPoint<T>[] {
  const idx = cands.map((_, i) => i).filter((i) => Number.isFinite(cands[i]!.D) && Number.isFinite(cands[i]!.d1));
  idx.sort((i, j) => {
    const a = cands[i]!;
    const b = cands[j]!;
    return a.D - b.D || b.d1 - a.d1 || b.g - a.g || i - j;
  });
  const out: StairPoint<T>[] = [];
  let best = -Infinity;
  for (const i of idx) {
    const c = cands[i]!;
    if (c.d1 > best + 1e-12) {
      out.push(c);
      best = c.d1;
    }
  }
  return out;
}

/**
 * Ladder hypervolume of {(d̃₁, 1 − D)} with reference (0, 0) (both clipped to [0, 1]): the area under the staircase,
 * Σ_i (d̃₁ᵢ − d̃₁ᵢ₋₁)·(1 − Dᵢ) over a staircase that increases in D and d̃₁.
 */
export function ladderHypervolume(points: ReadonlyArray<{ D: number; d1: number }>): number {
  let hv = 0;
  let prev = 0;
  for (const p of points) {
    const y = Math.min(1, Math.max(0, p.d1));
    if (y <= prev) continue;
    hv += (y - prev) * (1 - Math.min(1, Math.max(0, p.D)));
    prev = y;
  }
  return hv;
}

/**
 * Knee of the frontier between Easy E and Hard H (§1.3): over points with D_E < D < D_H, x = (D − D_E)/(D_H − D_E),
 * y = (d̃₁ − d̃₁_E)/(d̃₁_H − d̃₁_E); knee = argmax (y − x)/√2. Null when no point lies strictly between or the frontier is
 * degenerate (no D or d̃₁ span).
 */
export function kneeOf(
  points: ReadonlyArray<{ D: number; d1: number }>,
  E: { D: number; d1: number },
  H: { D: number; d1: number },
): { index: number; distance: number } | null {
  const dx = H.D - E.D;
  const dy = H.d1 - E.d1;
  if (!(dx > 1e-12) || !(dy > 1e-12)) return null;
  let best: { index: number; distance: number } | null = null;
  points.forEach((p, i) => {
    if (!(p.D > E.D && p.D < H.D)) return;
    const x = (p.D - E.D) / dx;
    const y = (p.d1 - E.d1) / dy;
    const dist = (y - x) / Math.SQRT2;
    if (!best || dist > best.distance) best = { index: i, distance: dist };
  });
  return best;
}

/**
 * g_min in goal-1 desirability units: the metric minimal change over goal 1's scale (u − b); NaN metric (no table
 * entry) or a band goal → `gMinRangeShare` of the achievable range (a − b) in the same units.
 */
export function gMinDesirability(goals: GoalSystem, gMinMetric: number): number {
  const { a, b, u } = goals.scale(0);
  const range = u - b;
  if (!(range > 1e-12)) return 0;
  if (!Number.isFinite(gMinMetric) || goals.goals[0]!.sense === 'band')
    return (LADDER_DEFAULTS.gMinRangeShare * Math.max(0, a - b)) / range;
  return Math.abs(gMinMetric) / range;
}

/**
 * Goal constraints of a rung (§1.3) given Hard's desirabilities: thr₁ for goal 1; for every other active goal
 * d̃_j ≥ min(ρ·d̃_j(H), d̃_j(H)) − δ_j ("keep" goals: d̃_j(H) − keepFactor·δ_j), never below baseline (0) unless Hard is.
 * Inactive goals are unconstrained (NaN). δ_j is the goal's effective floor tolerance (`GoalSystem.effectiveTolerance`).
 */
export function rungThresholds(goals: GoalSystem, dHard: ArrayLike<number>, thr1: number, rho: number): Float64Array {
  const thr = new Float64Array(goals.K).fill(NaN);
  thr[0] = thr1;
  for (let k = 1; k < goals.K; k++) {
    if (!goals.isActive(k)) continue;
    const dh = dHard[k]!;
    const tol = goals.effectiveTolerance(k, dh);
    let t = goals.isKeep(k) ? Math.min(1, dh) - LADDER_DEFAULTS.keepFactor * tol : Math.min(rho * dh, dh) - tol;
    if (dh >= 0) t = Math.max(t, 0);
    thr[k] = t;
  }
  return thr;
}

/** A solved rung for the distinctness checks. */
export interface RungPoint {
  D: number;
  d1: number;
}

export interface DistinctnessResult {
  medium: boolean;
  easy: boolean;
  collapsed: LadderCollapse[];
  checks: LadderChecks;
}

/**
 * Distinctness (§1.3, §12.8), checked every run: D_H − D_E ≥ gap and Gower(H, E) ≥ minGower; Medium against each
 * neighbour by `mediumMargins` (smaller margins when Easy stands); d̃₁ and D ordered H ≥ M ≥ E. Failure handling in order:
 * if Hard-Easy fails (D gap, Gower, order) only Hard is kept (Medium repeats Easy's reason with `viaEasy`); otherwise a
 * failing Medium is dropped. Never pads with near-duplicates. `gower(a, b)` over rung ids.
 */
export function ladderDistinctness(
  H: RungPoint,
  M: RungPoint | null,
  E: RungPoint | null,
  gower: (a: RungId, b: RungId) => number,
  spec: Pick<ResolvedLadder, 'minDGap' | 'minGower'> & Partial<Pick<ResolvedLadder, 'mediumMinDGap' | 'mediumMinGower'>>,
): DistinctnessResult {
  const eps = 1e-9;
  const gHM = M ? gower('hard', 'medium') : NaN;
  const gME = M && E ? gower('medium', 'easy') : NaN;
  const gHE = E ? gower('hard', 'easy') : NaN;
  const gs = [gHM, gME, gHE].filter((v) => !Number.isNaN(v));
  const orderedPair = (a: RungPoint, b: RungPoint) => a.d1 >= b.d1 - eps && a.D >= b.D - eps;
  const ordered = (!M || orderedPair(H, M)) && (!E || orderedPair(H, E)) && (!M || !E || orderedPair(M, E));
  const checks: LadderChecks = {
    dHM: M ? H.D - M.D : NaN,
    dME: M && E ? M.D - E.D : NaN,
    gowerMin: gs.length ? Math.min(...gs) : NaN,
    ordered,
  };
  const collapsed: LadderCollapse[] = [];
  let easy = !!E;
  let medium = !!M;
  // goal-1 shares of Hard (for the collapse sentences: "Easy already reaches 95 % of Hard's …")
  const share = (p: RungPoint) => (H.d1 > 1e-12 ? p.d1 / H.d1 : NaN);
  const shares: Record<string, number> = { ...(E ? { gShare: share(E) } : {}), ...(M ? { gShareMedium: share(M) } : {}) };
  if (E) {
    const dHE = H.D - E.D;
    let fail: LadderCollapse | null = null;
    if (dHE < spec.minDGap - eps) fail = { rung: 'easy', reason: 'tooClose', detail: { dGap: dHE, minDGap: spec.minDGap, dHard: H.D, dEasy: E.D, ...shares } };
    else if (gHE < spec.minGower - eps) fail = { rung: 'easy', reason: 'notDistinct', detail: { gower: gHE, minGower: spec.minGower, ...shares } };
    else if (!orderedPair(H, E)) fail = { rung: 'easy', reason: 'notDistinct', detail: { d1Hard: H.d1, d1Easy: E.d1, dHard: H.D, dEasy: E.D, ...shares } };
    if (fail) {
      easy = false;
      collapsed.push(fail);
      if (M) {
        medium = false;
        collapsed.push({ rung: 'medium', reason: fail.reason, detail: { ...fail.detail, viaEasy: 1 } });
      }
      return { medium, easy, collapsed, checks };
    }
  }
  if (M) {
    let fail: LadderCollapse | null = null;
    const dHM = H.D - M.D;
    const dME = E ? M.D - E.D : Infinity;
    const mg = mediumMargins(E ? gHE : NaN, spec);
    if (dHM < mg.minDGap - eps) fail = { rung: 'medium', reason: 'tooClose', detail: { dGap: dHM, minDGap: mg.minDGap, dHard: H.D, dMedium: M.D, ...shares } };
    else if (dME < mg.minDGap - eps) fail = { rung: 'medium', reason: 'tooClose', detail: { dGap: dME, minDGap: mg.minDGap, dMedium: M.D, dEasy: E!.D, ...shares } };
    else if (gHM < mg.minGower - eps) fail = { rung: 'medium', reason: 'notDistinct', detail: { gower: gHM, minGower: mg.minGower, ...(E ? { gowerHE: gHE } : {}), ...shares } };
    else if (E && gME < mg.minGower - eps) fail = { rung: 'medium', reason: 'notDistinct', detail: { gower: gME, minGower: mg.minGower, gowerHE: gHE, ...shares } };
    else if (!orderedPair(H, M) || (E && !orderedPair(M, E)))
      fail = { rung: 'medium', reason: 'notDistinct', detail: { d1Hard: H.d1, d1Medium: M.d1, ...(E ? { d1Easy: E.d1 } : {}), dHard: H.D, dMedium: M.D, ...shares } };
    if (fail) {
      medium = false;
      collapsed.push(fail);
    }
  }
  return { medium, easy, collapsed, checks };
}
