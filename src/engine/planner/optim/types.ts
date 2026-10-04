/**
 * Generic contracts between the optimisation core (coordinator side) and the evaluation side
 * (decoder + engine, running in evaluator workers). Dossier 18 §4.4.3-4.4.4, §4.19, §5.
 *
 * Everything the real planner must provide is expressed here with type parameters; the concrete
 * skeleton / plan / simulation types come from the plan decoder and the engine later.
 */
import type { DiscreteGene } from './cmaes';

export type MaybePromise<T> = T | Promise<T>;

/**
 * Ensemble draw numbering (PLANNER_V2_SPEC §4.7): −1 = nominal parameters; 0..M_s−1 = the selection ensemble (stream
 * `ensemble/selection`); `HOLDOUT_DRAW_OFFSET + m` = member m of the holdout ensemble (stream `ensemble/holdout`), which
 * only ever reports numbers and is never searched or selected on.
 * Convention: when `PlannerProblem.ladder` is set, `EvalOutput.descriptors[0]` is the difficulty D ∈ [0,1] and
 * descriptors 1.. are the style descriptors.
 */
export const HOLDOUT_DRAW_OFFSET = 1 << 20;

/** True for a draw of the holdout ensemble. */
export function isHoldoutDraw(draw: number): boolean {
  return draw >= HOLDOUT_DRAW_OFFSET;
}

/** One rung of the plan ladder (same union as the domain's `RungId`). */
export type RungId = 'hard' | 'medium' | 'easy';

/** Anytime convergence point (same shape as the domain's `ConvergencePoint`, PLANNER_V2_SPEC §4.9). */
export interface ConvergencePoint {
  eu: number;
  /** Wall time since the run started (ms; 0 without `PlannerConfig.now`). */
  wallMs: number;
  stage: string;
  /** First three entries of the incumbent Hard's key (v_S, v_L, −⌊G/q_G⌋). */
  keyHard: number[];
  /** Weighted goal score G of the incumbent Hard. */
  G: number;
  /** Ladder hypervolume of {(d̃_1, 1 − D)} over the archive staircase, reference (0, 0); 0 without a ladder. */
  hvLadder: number;
}

/**
 * Summary of one evaluation (≈ the `EvalResult.summaries` row of §4.19): R ≈ K goal functionals
 * + safety margins + descriptors + regulariser. Plain numbers so it can cross a worker boundary.
 */
export interface EvalOutput {
  /** Raw goal functionals Φ_g in metric units, in the request's goal order (length K). */
  goals: ArrayLike<number>;
  /**
   * State-space constraint margins, normalised so that ≥ 0 means satisfied and −1 is "one unit of
   * normalised violation" (§4.8). The adherence cap belongs here too (optionally down-weighted).
   * v_S = Σ max(0, −margin). Early-aborted simulations report the violated bound here.
   */
  margins: ArrayLike<number>;
  /** Weighted regulariser R = λ_H·H + λ_C·C + λ_T·R_term (≥ 0; §4.9). */
  regulariser: number;
  /** Behaviour descriptors in [0,1] (§4.12). */
  descriptors: ArrayLike<number>;
  /** Optional plan-distance features φ(x) (§4.12, Gower); defaults to the descriptors. */
  features?: ArrayLike<number>;
  /** Evaluation units consumed (default 1 = one horizon simulation). */
  cost?: number;
  /** Early abort on a state-space bound (engine planner mode, §4.1). */
  aborted?: { day: number; constraint: number; magnitude: number };
}

/** One candidate to evaluate: structure index, genome in [0,1]ⁿ (already clamped), ensemble draw (−1 = nominal). */
export interface EvalRequest {
  structure: number;
  x: Float64Array;
  draw: number;
}

/**
 * Evaluation backend. Implementations MUST return outputs in request order (a worker pool may
 * finish chunks in any order but re-assembles by index), so results are identical for any worker count.
 */
export interface Evaluator {
  evaluate(batch: readonly EvalRequest[]): MaybePromise<readonly EvalOutput[]>;
}

/**
 * A discrete plan structure (skeleton, §4.4.3): enumerated from the block grammar; its continuous
 * parameters form the genome x ∈ [0,1]^dim that CMA-ES sees.
 */
export interface PlanStructure {
  readonly id: string;
  /** Genome dimension n (≈ 15-35 for real skeletons). */
  readonly dim: number;
  /** Block-default genome (warm start / S1 default probe); default 0.5·1. */
  readonly x0?: ArrayLike<number>;
  /** Integer-coded genes (rounded by the decoder) → CMA-ES margin (§4.10). */
  readonly discrete?: readonly DiscreteGene[];
}

/** One decoder repair action (§4.4.4); feeds penalties, complexity and "binding constraint" explanations. */
export interface RepairEntry {
  readonly rule: string;
  readonly path?: string;
  readonly day?: number;
  readonly amount?: number;
}

export interface Repaired<Sched> {
  readonly schedule: Sched;
  readonly log: readonly RepairEntry[];
}

/**
 * Evaluation-side model the real planner implements (runs inside evaluator workers):
 * genome → schedule (decode) → safe schedule (repair: user hard constraints + input-space safety bounds,
 * never violated afterwards) → simulation → goal functionals / constraint margins / descriptors.
 */
export interface PlanModel<S extends PlanStructure, Sched, Sim> {
  decode(structure: S, x: Float64Array): Sched;
  repair(structure: S, schedule: Sched): Repaired<Sched>;
  /** Forward simulation; `draw` = ensemble member index, −1 = nominal parameters. */
  simulate(schedule: Sched, draw: number): Sim;
  /** Raw goal functionals Φ_g (metric units), one per ranked goal. */
  goals(sim: Sim, schedule: Sched): ArrayLike<number>;
  /** State-space constraint margins (≥ 0 satisfied, normalised). */
  constraints(sim: Sim, schedule: Sched, repairLog: readonly RepairEntry[]): ArrayLike<number>;
  /** Behaviour descriptors in [0,1]. */
  descriptors(schedule: Sched, sim: Sim): ArrayLike<number>;
  regulariser?(schedule: Sched, sim: Sim, repairLog: readonly RepairEntry[]): number;
  features?(schedule: Sched, sim: Sim): ArrayLike<number>;
  cost?(schedule: Sched, sim: Sim): number;
}

/** Total state-space violation v_S = Σ_s max(0, tighten_s − margin_s) (tighten = chance-constraint margin, §4.15). */
export function violation(margins: ArrayLike<number>, tighten?: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i < margins.length; i++) {
    const m = margins[i]!;
    const t = tighten ? (tighten[i] ?? 0) : 0;
    v += Number.isNaN(m) ? 1 : Math.max(0, t - m);
  }
  return v;
}
