/**
 * The dedicated Easy search (PLANNER_V2_SPEC §12.2, stage `S5.easy`, after Hard is final): the least change that keeps
 * at least half of Hard's goal-1 progress. Pure parts live here (budget, the intensity bisection, the stopping rule, the
 * proof of absence); the pipeline (`pipeline.ts`, `easySearch`) evaluates and owns the records.
 *
 * Objective: minimise D (quantised), then goals 2..K ε-lexicographically, then the regulariser — the ladder key
 * (`GoalSystem.ladderKey`) with Easy's thresholds. Gower distance to the habitual plan is not a separate key entry: the
 * starts are the habit and "habit + one of Hard's levers" lines, so the search begins at minimum change.
 */
import type { Tier } from './pipeline';

export const EASY_SEARCH = {
  /** Share of the tier total spent on the search (on top of the run), tier X: `shareX`; never below `minEU`. */
  share: 0.06,
  shareX: 0.04,
  minEU: 400,
  /** Bisection steps per start line. */
  bisectSteps: 8,
  sigma0: 0.15,
  /** Stop after this many generations with ΔD < `stallD` and no new feasible plan. */
  stallGens: 3,
  stallD: 0.005,
  /** Stop when the best feasible D is within this of the D lower bound (all genes at habit). */
  boundTol: 0.01,
  /** CMA-ES starts (best distinct structures among the start points). */
  cmaStarts: 2,
  /** Plans rounded, given the selection ensemble and checked, best first. */
  candidates: 3,
  validateTop: 12,
} as const;

/** EU of the Easy search: max(6 % of the tier total, 400), tier X 4 %. */
export function easySearchBudget(tier: Tier, total: number): number {
  return Math.max(EASY_SEARCH.minEU, Math.floor((tier === 'X' ? EASY_SEARCH.shareX : EASY_SEARCH.share) * total));
}

/** A start line: genomes at intensity α = 0 (habit) and α = 1 (Hard's lever, or Hard itself). */
export interface EasyLine {
  label: string;
  structure: number;
  from: ArrayLike<number>;
  to: ArrayLike<number>;
}

export function lerpGenome(from: ArrayLike<number>, to: ArrayLike<number>, alpha: number): Float64Array {
  const x = new Float64Array(from.length);
  for (let k = 0; k < x.length; k++) x[k] = Math.min(1, Math.max(0, from[k]! + alpha * (to[k]! - from[k]!)));
  return x;
}

/**
 * Smallest intensity α ∈ [0, 1] on a line whose plan meets Easy's constraint (≤ `steps` evaluations after the two
 * ends): α = 1 infeasible → null (the line cannot reach it); α = 0 feasible → 0; else bisection keeping the feasible
 * upper end. Assumes feasibility is monotone in α (goal-1 progress rises with the lever); when it is not, the result is
 * still a feasible point, only maybe not the smallest.
 */
export async function bisectIntensity<R>(
  at: (alpha: number) => Promise<R>,
  feasible: (r: R) => boolean,
  steps: number = EASY_SEARCH.bisectSteps,
): Promise<{ alpha: number; rec: R; evaluated: R[] } | null> {
  const evaluated: R[] = [];
  const hiRec = await at(1);
  evaluated.push(hiRec);
  if (!feasible(hiRec)) return null;
  const loRec = await at(0);
  evaluated.push(loRec);
  if (feasible(loRec)) return { alpha: 0, rec: loRec, evaluated };
  let lo = 0;
  let hi = 1;
  let best = hiRec;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const r = await at(mid);
    evaluated.push(r);
    if (feasible(r)) {
      hi = mid;
      best = r;
    } else lo = mid;
  }
  return { alpha: hi, rec: best, evaluated };
}

/**
 * Stopping rule (§12.2): after each generation, `observe(bestFeasibleD, newFeasible)`; stop after `stallGens`
 * generations in a row with ΔD < `stallD` and no new feasible plan, or once the best feasible D is within `boundTol` of
 * the lower bound. (The budget is the third stop; the caller enforces it.)
 */
export function easyStopRule(lowerBound: number): { observe(bestD: number, newFeasible: boolean): boolean; readonly reason: string | null } {
  let last = Infinity;
  let stall = 0;
  let reason: string | null = null;
  return {
    observe(bestD: number, newFeasible: boolean): boolean {
      if (Number.isFinite(bestD) && Number.isFinite(lowerBound) && bestD <= lowerBound + EASY_SEARCH.boundTol) {
        reason = 'bound';
        return true;
      }
      const dD = Number.isFinite(last) && Number.isFinite(bestD) ? last - bestD : Infinity;
      if (!newFeasible && dD < EASY_SEARCH.stallD) stall++;
      else stall = 0;
      if (Number.isFinite(bestD)) last = Math.min(last, bestD);
      if (stall >= EASY_SEARCH.stallGens) {
        reason = 'stall';
        return true;
      }
      return false;
    },
    get reason() {
      return reason;
    },
  };
}

/** One evaluated plan as the proof sees it. */
export interface ProofPoint {
  D: number;
  /** Goal-1 desirability. */
  d1: number;
  safe: boolean;
  /** Goals 2..K meet Easy's thresholds. */
  othersOk: boolean;
}

/**
 * Proof of absence (§12.2): among safe plans with D ≤ dMax that keep the other goals, the best goal-1 share of Hard and
 * its effort; `needed` = Easy's goal-1 threshold as a share of Hard. When no plan meets the constraint with less effort,
 * bestG1 < needed.
 */
export function easyProof(points: readonly ProofPoint[], gHard: number, thr1: number, dMax: number, starts: number): { starts: number; bestG1: number; needed: number; D: number; evaluated: number } {
  let best: ProofPoint | null = null;
  for (const p of points) {
    if (!p.safe || !p.othersOk || !(p.D <= dMax + 1e-12)) continue;
    if (!best || p.d1 > best.d1 || (p.d1 === best.d1 && p.D < best.D)) best = p;
  }
  const share = (v: number) => (gHard > 1e-12 ? v / gHard : 0);
  return {
    starts,
    bestG1: best ? Math.max(0, share(best.d1)) : 0,
    needed: share(thr1),
    D: best ? best.D : Number.NaN,
    evaluated: points.length,
  };
}
