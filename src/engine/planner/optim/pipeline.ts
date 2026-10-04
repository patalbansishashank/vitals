/**
 * Planner orchestration, algorithm v2 (PLANNER_V2_SPEC §4; R6 §3.1), generic over the plan structure type.
 *
 *   S0 baseline → S1 seeds + structure race (successive halving, interleaved warm CMA-ES) → S2 single-goal anchors →
 *   S3 ε-lexicographic stages on the race survivors (quantised keys) → S4 quality diversity (D-first archive when the
 *   problem has a ladder) → S4.ladder Easy / Medium ε-constraint solves → S5 round-and-verify, selection ensemble with
 *   chance constraints and OCBA-style extra draws, validator, holdout ensemble → S6 ablations, conflicts, reports.
 *   (Spec phases: S0 = P0, S1 = P1 + P2, S2 + S3 = P3, S4 = P4, S4.ladder = P5, S5 + S6 = P7 + P8; P6 Ideal runs outside.)
 *
 * Determinism: all randomness comes from named `Rng` streams derived from the seed; every batch is evaluated through an
 * `Evaluator` that returns outputs in request order; records are ingested strictly in candidate order; λ depends on a
 * tier constant, never on the live worker count → bitwise-identical output for any worker count / batch chunking, and a
 * run resumed from a checkpoint equals the uninterrupted run. Budgets are counted in EU; cache hits cost nothing.
 */
import type { CellIndexer, FeatureSpec, InsertResult, SelectionCandidate } from './archive';
import {
  Archive,
  DEFAULT_D_MIN,
  DFirstGrid,
  cvtCentroids,
  emitterRankKey,
  featureRanges,
  gowerDistance,
  selectActiveDescriptors,
  selectAlternatives,
} from './archive';
import type {
  AnchorsData,
  JobData,
  LadderData,
  PlannerCheckpointData,
  QdData,
  RaceData,
  RunStateData,
  SerializedRecord,
  StagesData,
} from './checkpoint';
import { CHECKPOINT_VERSION, deserializeOutput, serializeOutput } from './checkpoint';
import type { BipopState, CmaesOptions, CovarianceMode, IpopOptions, IpopState, Key } from './cmaes';
import { BipopCmaEs, CmaEs, IpopCmaEs, compareKeys, defaultLambda } from './cmaes';
import type { ConflictMatrix, ConflictOptions, GoalRelationMessage } from './conflicts';
import { conflictMatrix, kneePoint, relationMessages } from './conflicts';
import type { GoalFeasibility, GoalSpec, Scored, Strictness } from './goals';
import { GoalSystem, ladderViolation, quantLevel } from './goals';
import type { LadderChecks, LadderCollapse, LadderSpec, ResolvedLadder, StairPoint } from './ladder';
import { EASY_SEARCH, bisectIntensity, easyProof, easySearchBudget, easyStopRule, lerpGenome, type EasyLine } from './easySearch';
import {
  LADDER_DEFAULTS,
  mediumMargins,
  gMinDesirability,
  kneeOf,
  ladderDistinctness,
  ladderHypervolume,
  resolveLadder,
  rungThresholds,
  staircase,
} from './ladder';
import type { RaceEntry } from './race';
import { RACE_ETA, dTercile, raceRoundBudget, raceSurvivors } from './race';
import type { Seed } from './rng';
import { Rng, hashInts, hashString, latinHypercube } from './rng';
import type { FinalistRobustness, RobustMode } from './robust';
import { decisionStability, robustSummary } from './robust';
import type {
  ConvergencePoint,
  EvalOutput,
  EvalRequest,
  Evaluator,
  MaybePromise,
  PlanModel,
  PlanStructure,
  RungId,
} from './types';
import { HOLDOUT_DRAW_OFFSET, violation } from './types';

export type { LadderSpec } from './ladder';
export type { EasyLine } from './easySearch';
export type { PlannerCheckpointData } from './checkpoint';

// ---------------------------------------------------------------------------------------------
// Budgets and tiers (PLANNER_V2_SPEC §4.8)
// ---------------------------------------------------------------------------------------------

export type Tier = 'S' | 'M' | 'L' | 'X';

/** Total budget per tier in EU (§4.8). X is open-ended; 300k is its default. */
export const TIER_BUDGET_EU: Readonly<Record<Tier, number>> = { S: 3000, M: 12000, L: 40000, X: 300000 };

/** Stage shares of the tier budget (§4.8 table; "robust" = P7-P8). They sum to 1 per tier. */
export interface TierShares {
  race: number;
  stages: number;
  qd: number;
  ladder: number;
  ideal: number;
  robust: number;
}
export const TIER_SHARES: Readonly<Record<Tier, TierShares>> = {
  S: { race: 0.2, stages: 0.3, qd: 0.1, ladder: 0.12, ideal: 0.13, robust: 0.15 },
  M: { race: 0.2, stages: 0.3, qd: 0.15, ladder: 0.1, ideal: 0.12, robust: 0.13 },
  L: { race: 0.25, stages: 0.25, qd: 0.15, ladder: 0.1, ideal: 0.1, robust: 0.15 },
  X: { race: 0.45, stages: 0.15, qd: 0.15, ladder: 0.08, ideal: 0.07, robust: 0.1 },
};

/** Share of the P3 budget spent on the single-goal anchor runs of goals 2..K (desirability scales; README v2). */
export const ANCHOR_SHARE = 0.25;
/** Race rounds per tier (§4.8: S 2, M 3, L 4, X 4 + "continue" rounds). */
export const TIER_RACE_ROUNDS: Readonly<Record<Tier, number>> = { S: 2, M: 3, L: 4, X: 4 };
/** Tier X race budget per survivor and round (§4.8); scaled down by the share when the race budget cannot carry it. */
export const X_ROUND_EU: readonly number[] = [300, 900, 2700, 8100];
/** Tier X "continue" rounds: over the top 5, 3× the last round's budget, until 2 rounds bring no improvement. */
export const X_CONTINUE_TOP = 5;
/** Screening probes per structure in race round 1 (x0 + 4 LHS points, as v1 S1). */
export const RACE_PROBES = 5;
/** σ₀ of the race's warm CMA-ES instances (§4.5). */
export const RACE_SIGMA0 = 0.25;
/** σ₀ of the ladder rung solves (PROPOSED). */
export const RUNG_SIGMA0 = 0.15;

/**
 * Medium band search (PLN-06, `PlannerRun.mediumBand`) constants (PROPOSED; batch 02: edge 0.3 → 0.25 and 2 → 3 starts, so a Medium is found more often): the band keeps `edge` of the Easy-Hard span
 * clear on each side (and at least the rung D gap); the search gets `share` of the ladder budget split over `starts`
 * warm starts (the best start of a structure other than Hard's and Easy's first); its key aims `gowerMargin` above the
 * rung Gower minimum; up to `candidates` plans are rounded and chance-checked. The distinctness thresholds are the
 * ladder's own.
 */
export const MEDIUM_BAND = { edge: 0.25, share: 0.5, starts: 3, sigma0: 0.2, gowerMargin: 0.06, candidates: 6, validateTop: 12 } as const;
/** Convergence points every 2 % of the run budget (plus every stage end). */
export const CONVERGENCE_EVERY = 0.02;
/** Extra pool plans the finalist fill looks at to replace finalists that fail validation (Q3-J5-05). */
export const FINALIST_FILL_EXTRA = 12;

/** CVT cells of the archive without a ladder (§4.12), per tier. */
export const TIER_ARCHIVE_CELLS: Readonly<Record<Tier, number>> = { S: 64, M: 100, L: 150, X: 200 };
/** D-first archive (§1.2): uniform D bins and CVT cells per bin over the active style descriptors. */
export const TIER_D_BINS: Readonly<Record<Tier, number>> = { S: 10, M: 20, L: 20, X: 20 };
export const TIER_STYLE_CELLS: Readonly<Record<Tier, number>> = { S: 6, M: 5, L: 8, X: 16 };
/** Selection ensemble M_s and holdout ensemble M_h (§4.7). */
export const TIER_ENSEMBLE: Readonly<Record<Tier, number>> = { S: 16, M: 32, L: 64, X: 128 };
export const TIER_HOLDOUT: Readonly<Record<Tier, number>> = { S: 32, M: 64, L: 64, X: 128 };
/** Structures entering the race (prior order); only tier S truncates (§4.4). */
export const TIER_MAX_SCREENED: Readonly<Record<Tier, number>> = { S: 60, M: Infinity, L: Infinity, X: Infinity };
/** sep-CMA-ES on tier S, full covariance otherwise (§4.8). */
export const TIER_COVARIANCE: Readonly<Record<Tier, CovarianceMode>> = { S: 'sep', M: 'full', L: 'full', X: 'full' };
/** Restart strategy of the stage CMA-ES (§4.8: IPOP on S/M/L, BIPOP on X). */
export const TIER_RESTARTS: Readonly<Record<Tier, 'ipop' | 'bipop'>> = { S: 'ipop', M: 'ipop', L: 'ipop', X: 'bipop' };
/**
 * λ quantum per tier: λ = max(4 + ⌊3 ln n⌋, 2q) rounded up to a multiple of q (§4.10 with q = nominal worker count of
 * the tier — *not* the live count, which would break worker-count invariance).
 */
export const TIER_LAMBDA_QUANTUM: Readonly<Record<Tier, number>> = { S: 3, M: 8, L: 8, X: 8 };

/** Safety factor on the P50−P10 margin gap used to tighten a bound before the chance-constraint re-polish (PROPOSED). */
export const CHANCE_TIGHTEN_FACTOR = 1.25;

/**
 * The P6 budget (Ideal plan and limit costs), spent by the caller outside `runPlanner`. It comes on top of the run's
 * total (E6 benchmark ruling, 2026-10-01: carving it out of the run cost goal 1 quality on the full requests).
 */
export function idealBudgetEU(tier: Tier, total = TIER_BUDGET_EU[tier]): number {
  return Math.floor(TIER_SHARES[tier].ideal * total);
}

export interface StageBudget {
  /** Tier total (or the `totalEU`); the run spends all of it. */
  total: number;
  /** What this run may spend (= total). */
  run: number;
  race: number;
  /** Single-goal anchors of goals 2..K (part of the P3 share). */
  anchors: number;
  /** ε-lexicographic stages (the rest of the P3 share). */
  stages: number;
  qd: number;
  ladder: number;
  /** P6 on top of the total for ladder problems whose caller runs the Ideal, else 0. */
  ideal: number;
  /** P7-P8: robust selection, holdout, verification and explanations. */
  robust: number;
}

/**
 * Stage budgets (§4.8). The run spends the whole total; the Ideal (P6) is budgeted on top by the caller. Without a ladder
 * there is no P5: its share goes to the lexicographic stages (P3, which decide goal 1) and the P6 share to the QD stage
 * (the archive serves the MMR alternatives). With a ladder the P6 share goes to P3 instead, so goal 1's search gets about
 * the EU it gets without a ladder (P5 and P6 shares differ by ≤ 2 points). Unused EU of a stage rolls forward to the next stage in table order (race → anchors →
 * stages → QD → ladder → robust; the race's rest is split between anchors and stages by `ANCHOR_SHARE`).
 */
export function planBudget(tier: Tier, K: number, total = TIER_BUDGET_EU[tier], ladder = false, reserveIdeal = true): StageBudget {
  const sh = TIER_SHARES[tier];
  const ideal = ladder && reserveIdeal ? idealBudgetEU(tier, total) : 0;
  const run = total;
  const race = Math.floor(sh.race * total);
  const p3 = Math.floor((sh.stages + (ladder ? sh.ideal : sh.ladder)) * total);
  const anchors = K > 1 ? Math.floor(ANCHOR_SHARE * p3) : 0;
  const lad = ladder ? Math.floor(sh.ladder * total) : 0;
  const robust = Math.floor(sh.robust * total);
  const qd = Math.max(0, run - race - p3 - lad - robust);
  return { total, run, race, anchors, stages: p3 - anchors, qd, ladder: lad, ideal, robust };
}

/**
 * Tier from device calibration: EU/s = workers × 1000 / msPerEU; affordable = EU/s × target seconds → L if ≥ 40k, M if
 * ≥ 12k, else S. Tier X is never chosen automatically (explicit user action, §4.9).
 */
export function budgetForDevice(p: { msPerEU: number; workers: number; targetSeconds: number }): {
  tier: Tier;
  totalEU: number;
  affordableEU: number;
} {
  const affordable = Math.floor(((p.workers * 1000) / Math.max(p.msPerEU, 1e-6)) * p.targetSeconds);
  const tier: Tier = affordable >= TIER_BUDGET_EU.L ? 'L' : affordable >= TIER_BUDGET_EU.M ? 'M' : 'S';
  return { tier, totalEU: TIER_BUDGET_EU[tier], affordableEU: affordable };
}

// ---------------------------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------------------------

/** Evaluate one request with a `PlanModel` (used by the local evaluator and inside workers). */
export function evaluatePlan<S extends PlanStructure, Sched, Sim>(
  model: PlanModel<S, Sched, Sim>,
  structures: readonly S[],
  req: EvalRequest,
): EvalOutput {
  const s = structures[req.structure];
  if (!s) throw new RangeError(`evaluatePlan: unknown structure ${req.structure}`);
  const { schedule, log } = model.repair(s, model.decode(s, req.x));
  const sim = model.simulate(schedule, req.draw);
  const out: EvalOutput = {
    goals: Float64Array.from(model.goals(sim, schedule)),
    margins: Float64Array.from(model.constraints(sim, schedule, log)),
    regulariser: model.regulariser ? model.regulariser(schedule, sim, log) : 0,
    descriptors: Float64Array.from(model.descriptors(schedule, sim)),
  };
  if (model.features) out.features = Float64Array.from(model.features(schedule, sim));
  if (model.cost) out.cost = model.cost(schedule, sim);
  return out;
}

/** Synchronous in-thread evaluator (tests, Node, or a single worker). */
export function createLocalEvaluator<S extends PlanStructure, Sched, Sim>(
  model: PlanModel<S, Sched, Sim>,
  structures: readonly S[],
): Evaluator {
  return { evaluate: (batch) => batch.map((r) => evaluatePlan(model, structures, r)) };
}

/** One worker's batch call (e.g. a postMessage round trip bound in src/workers). */
export type WorkerCall = (batch: readonly EvalRequest[]) => MaybePromise<readonly EvalOutput[]>;

/**
 * Pool evaluator: splits a batch into chunks, feeds them to whichever worker is free, and re-assembles the outputs *by
 * request index*, so the result never depends on worker count or completion order.
 */
export function createPooledEvaluator(workers: readonly WorkerCall[], chunkSize?: number): Evaluator {
  if (workers.length === 0) throw new RangeError('createPooledEvaluator: at least one worker');
  return {
    async evaluate(batch) {
      const n = batch.length;
      const size = Math.max(1, chunkSize ?? Math.ceil(n / workers.length));
      const out = new Array<EvalOutput>(n);
      let next = 0;
      const loop = async (w: WorkerCall) => {
        while (next < n) {
          const start = next;
          next = Math.min(n, next + size);
          const res = await w(batch.slice(start, next));
          if (res.length !== next - start && res.length !== Math.min(size, n - start))
            throw new Error(
              `pooled evaluator: worker returned ${res.length} outputs for ${Math.min(size, n - start)} requests`,
            );
          for (let i = 0; i < res.length; i++) out[start + i] = res[i]!;
        }
      };
      await Promise.all(workers.map((w) => loop(w)));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Problem definition and results
// ---------------------------------------------------------------------------------------------

/** Coordinator-side description of the planning problem (the real planner implements this). */
export interface PlannerProblem<S extends PlanStructure> {
  /** Enumerated structures (skeletons), already pruned and ordered by prior score (the race order). */
  readonly structures: readonly S[];
  /** Ordered goals (priority order). */
  readonly goals: readonly GoalSpec[];
  /** Status-quo / maintenance plan defining desirability 0 (§4.6). */
  readonly baseline: { structure: number; x: ArrayLike<number> };
  /**
   * Warm-start genomes evaluated first (before the race's screening probes; they count against the race budget and
   * become their structure's starting point in the race), e.g. the canonical fastest-safe routes.
   */
  readonly seeds?: ReadonlyArray<{ structure: number; x: ArrayLike<number> }>;
  /**
   * Plan ladder (PLANNER_V2_SPEC §1.2-1.3). When set, `EvalOutput.descriptors[0]` is the difficulty D ∈ [0,1], the
   * archive bins D first, and the result carries Hard / Medium / Easy rungs as `options` (in that order) and in
   * `ladder`. Absent: the v1 behaviour of `options` (MMR A/B/C).
   */
  readonly ladder?: LadderSpec;
  /** Goal classes a structure serves, for the race's diversity guard (≥ 2 per class); default: per goal. */
  structureTags?(structure: number): readonly string[];
  /** Structural mutation for the S4 structural emitter (block swap, overlay/event add/remove, ...). */
  mutateStructure?(structure: number, rng: Rng): number | null;
  /** Map a genome between structures (continuous parameters inherited by path name). */
  transferGenome?(from: number, to: number, x: Float64Array): Float64Array;
  /** Friendly rounding (§4.9 round-and-verify). */
  roundGenome?(structure: number, x: Float64Array): Float64Array;
  /** Grid step per gene (genome units) for the round-and-verify pattern search. */
  gridStep?(structure: number): ArrayLike<number>;
  /** Independent post-validator (§4.4.6 layer 3); failures are discarded, never repaired. */
  validate?(structure: number, x: Float64Array): { ok: boolean; reasons: readonly string[] };
  /** Lever ablations for explanations (§4.17): neutralised variants of a plan. */
  ablations?(
    structure: number,
    x: Float64Array,
  ): ReadonlyArray<{ label: string; structure: number; x: Float64Array }>;
  /** Feature schema for the default Gower plan distance over `EvalOutput.features ?? descriptors`. */
  readonly featureSchema?: readonly FeatureSpec[];
  /** Custom plan distance D ∈ [0,1] (overrides the Gower default). */
  distance?(a: CandidateView, b: CandidateView): number;
  /**
   * Plan family of an evaluated plan for explanations (e.g. 'fast' for plans that actually contain a fast), or null. The
   * run keeps the best nominal plan of each family (`PlannerResult.groupBest`) so the caller can say why a family lost.
   * Called once per nominal record; it must be cheap and pure.
   */
  group?(structure: number, output: EvalOutput): string | null;
  /**
   * Start lines of the dedicated Easy search (§12.2) for Hard's plan: from the habit (α = 0) to Hard's genome or to the
   * habit with one of Hard's levers (α = 1), same structure. Absent → the search starts from the staircase only.
   */
  easyStarts?(structure: number, xHard: Float64Array): ReadonlyArray<EasyLine>;
}

/** The best nominal plan of one `PlannerProblem.group` family seen during the run (final comparator, relaxed floors). */
export interface GroupBest {
  structure: number;
  structureId: string;
  x: Float64Array;
  /** Goal functionals in metric units, objectives (maximised units) and search desirability d̃. */
  metricValues: Float64Array;
  objectives: Float64Array;
  desirability: Float64Array;
  /** Safety violation v_S (0 = safe) and the margin indices below zero. */
  vS: number;
  violated: number[];
  regulariser: number;
  utility: number;
  /** Weighted goal score G (U without the regulariser). */
  goalScore: number;
  strictFeasible: boolean;
  relaxedFeasible: boolean;
}

export interface CandidateView {
  structure: number;
  x: Float64Array;
  output: EvalOutput;
}

export interface PlannerCheckpointConfig {
  /** Called at every race round, every stage end and every `everyEU` inside CMA-driven loops (awaited). */
  save(cp: PlannerCheckpointData): void | Promise<void>;
  /** Continue from this checkpoint (refused, i.e. a fresh run, when its fingerprint differs). */
  resume?: PlannerCheckpointData;
  /** Mid-stage checkpoint interval in EU (default: stage boundaries only). */
  everyEU?: number;
}

export interface PlannerConfig {
  seed: Seed;
  tier?: Tier;
  /** Override the tier's total EU (the run spends all of it; a ladder caller spends `idealBudgetEU` on top). */
  totalEU?: number;
  strictness?: Strictness;
  targetTolerance?: number;
  /** v1 stage-key regulariser weight; unused by the v2 keys (kept for API compatibility). */
  eta?: number;
  boxWeight?: number;
  covariance?: CovarianceMode | 'auto';
  lambdaQuantum?: number;
  /** Archive cells without a ladder (default `TIER_ARCHIVE_CELLS`). */
  archiveCells?: number;
  cvtSamples?: number;
  minDescriptorRange?: number;
  /** Selection ensemble size M_s (0 disables every ensemble). */
  ensembleSize?: number;
  /**
   * Holdout ensemble size M_h (default `TIER_HOLDOUT` on ladder problems, 0 otherwise; always 0 when M_s = 0). Reported
   * numbers come from it.
   */
  holdoutSize?: number;
  /** OCBA-style allocation of the selection draws (default true; needs M_s ≥ 4). */
  ocba?: boolean;
  maxFinalists?: number;
  optionCount?: number;
  dMin?: number;
  mmrLambda?: number;
  robustMode?: RobustMode;
  conflict?: ConflictOptions;
  /** ε-constraint verification sweep for conflicting top-3 pairs (§4.13); off by default. */
  tradeoffSweep?: { levels?: readonly number[]; euPerLevel?: number; maxPairs?: number };
  /** σ₀ for exploration from screening elites / warm starts / QD emitters. */
  sigmaExplore?: number;
  sigmaWarm?: number;
  sigmaQd?: number;
  /** Restart strategy of the stage CMA-ES (default `TIER_RESTARTS`). */
  restarts?: 'ipop' | 'bipop';
  /** Race overrides: η, per-survivor round budgets (EU; default by share, tier X `X_ROUND_EU`), rounds, continue top-n. */
  race?: { eta?: number; roundEU?: number[]; rounds?: number; continueTop?: number };
  onProgress?: (p: PlannerProgress) => void;
  /** Convergence curve stream (also returned in `PlannerResult.convergence`). */
  onConvergence?: (p: ConvergencePoint) => void;
  /** Wall clock (ms) for `ConvergencePoint.wallMs`; absent → 0 (the engine itself has no clock). */
  now?: () => number;
  checkpoint?: PlannerCheckpointConfig;
  /** Cooperative cancellation (an AbortSignal satisfies this), checked between generations. */
  signal?: { readonly aborted: boolean };
  /** Minimum EU between progress callbacks (default 2 % of the budget). */
  progressEveryEU?: number;
  /** Record S5 finalist diagnostics in `PlannerResult.diagnostics` (tuning / tests). */
  diagnostics?: boolean;
  /**
   * Ladder problems: when the final distinctness check drops Medium while Hard and Easy stand, run the Medium band
   * search (`MediumBandReport`; its EU comes on top of the total) (default true).
   */
  mediumBand?: boolean;
  /** Ladder problems: the dedicated Easy search after Hard is final (§12.2; its EU comes on top of the total) (default true). */
  easySearch?: boolean;
  /**
   * The last ladder of the same request (§12.1): Medium and Easy genomes re-checked against this run's Hard and kept when
   * this run's own rungs collapse (or are worse); Hard is weighed against this run's Hard only when the run is stopped.
   * Structure indices are this problem's.
   */
  previous?: { tier: string; rungs: Partial<Record<'hard' | 'medium' | 'easy', { structure: number; x: ArrayLike<number> }>> };
}

export interface EvalRecord extends Scored {
  readonly id: number;
  readonly structure: number;
  readonly x: Float64Array;
  readonly box: number;
  readonly draw: number;
  readonly out: EvalOutput;
  readonly f: Float64Array;
  readonly vS: number;
  readonly reg: number;
  readonly stage: string;
}

export interface OptionSummary {
  structure: number;
  structureId: string;
  x: Float64Array;
  desirability: Float64Array;
  percentOfPossible: Float64Array;
  utility: number;
}

export interface PlannerProgress {
  stage: string;
  euUsed: number;
  euBudget: number;
  archiveSize: number;
  /** Provisional option A / Hard (available from the end of S3 stage 1). */
  provisional: OptionSummary | null;
  /** Provisional A/B/C by nominal MMR selection (problems without a ladder; from the end of S4). */
  alternatives?: OptionSummary[];
  /** Provisional rungs (ladder problems) as soon as their goal constraints are met; changes are never throttled. */
  rungs?: Partial<Record<RungId, OptionSummary & { D: number }>>;
  /** Latest convergence point. */
  convergence?: ConvergencePoint;
}

export interface PlanOptionResult<S> {
  label: string;
  /** Ladder rung (ladder problems only). */
  rung?: RungId;
  /** Where the rung came from (§12.1-12.2): this run's ladder solve, the previous search, or the dedicated Easy search. */
  provenance?: RungProvenance;
  /** Difficulty D of the plan (ladder problems only). */
  D?: number;
  structureIndex: number;
  structure: S;
  x: Float64Array;
  output: EvalOutput;
  objectives: Float64Array;
  metricValues: Float64Array;
  desirability: Float64Array;
  reported: Float64Array;
  percentOfPossible: Float64Array;
  percentOfTarget: Float64Array;
  /** d̃_A − d̃_option per goal (A = Hard on a ladder; 0 for A). */
  costVsA: Float64Array;
  utility: number;
  /** Meets every priority floor, judged on the selection-ensemble desirability when available — as selected. */
  strictFeasible: boolean;
  rounded: boolean;
  /** Robust summary on the HOLDOUT ensemble (every reported number); the selection ensemble's when M_h = 0. */
  robust: FinalistRobustness | null;
  /** Robust summary on the selection ensemble (what the choice was based on). */
  robustSelection: FinalistRobustness | null;
  /** Share of holdout draws in which A (Hard) beats this option on goal 1 (null for A / no ensemble). */
  aBeatsThisShare: number | null;
  /** Top ablations: Δd̃ = option − neutralised variant per goal; `safe` = the variant itself met every margin. */
  ablations: Array<{ label: string; deltaD: Float64Array; safe?: boolean }>;
  distanceToChosen: number;
}

export interface TradeoffCurve {
  higher: number;
  lower: number;
  points: Array<{ level: number; dHigher: number; dLower: number }>;
  knee: number;
}

export interface LadderResult<S> {
  rungs: { hard: PlanOptionResult<S> | null; medium: PlanOptionResult<S> | null; easy: PlanOptionResult<S> | null };
  collapsed: LadderCollapse[];
  checks: LadderChecks;
  /** Attainment-difficulty frontier F(D̄) from the archive, increasing D (g = G, d1 = d̃₁). */
  staircase: Array<{ D: number; g: number; d1: number; structure: number; x: Float64Array }>;
  /** Pairwise Gower distances of the solved rungs before any collapse (NaN where a rung is missing). */
  gower: { hm: number; me: number; he: number };
  /** The Medium band search (`PlannerConfig.mediumBand`), when it ran (null otherwise). */
  mediumBand: MediumBandReport | null;
  /** Hard's goal-1 desirability d̃₁ and g_min (desirability units), NaN without a safe Hard. */
  gHard: number;
  gMin: number;
  /** The dedicated Easy search (§12.2), when it ran; `proof` is set when it found no Easy. */
  easySearch: EasySearchReport | null;
  /**
   * Carried rungs of `PlannerConfig.previous`: kept, or why not (§12.1): 'replaced' (it passed, this run's own was
   * better), 'structure' (no such structure here), or the failing check ('unsafe', 'validation', 'chance', 'goals',
   * 'distinct').
   */
  carried: Partial<Record<'medium' | 'easy', { kept: boolean; fromTier: string; reason: string | null }>>;
}

export type RungProvenance = 'own' | 'carried' | 'easySearch';

/** The dedicated Easy search's report (§12.2). */
export interface EasySearchReport {
  eu: number;
  grantEU: number;
  starts: number;
  /** Why it stopped: 'bound' (D at its lower bound), 'stall', 'budget', or 'aborted'. */
  stop: string;
  /** Plans that met Easy's goal constraints (nominal) and went through the checks. */
  tried: number;
  /** The search's best Easy was chosen (it beat the ladder's own and the carried Easy, or they failed). */
  chosen: boolean;
  proof: { starts: number; bestG1: number; needed: number; D: number; evaluated: number; rejected: Array<{ why: 'validation' | 'chance' | 'distinct'; g1: number; D: number }> } | null;
}

/**
 * Medium band search (PLN-06): after the ladder's own Medium was dropped, a short search restricted to the difficulty
 * band where a Medium can be distinct from both Hard and Easy. The thresholds are the ladder's own (never loosened).
 */
export interface MediumBandReport {
  /** The D band searched: [max(D_E + gap, D_E + 25 % of the span), min(D_H − gap, D_H − 25 % of the span)]. */
  lo: number;
  hi: number;
  /** EU spent (search, rounding, ensembles; on top of the run's total). */
  eu: number;
  /** EU granted on top of the run's total (`provenance.budgetEU` includes it): `eu`, plus an option's S5 share when accepted. */
  grantEU: number;
  /** Goal-1 desirability d̃₁ of Hard and Easy (a Medium lies between them). */
  d1Hard: number;
  d1Easy: number;
  /** Plans that passed every pre-check (band, rung constraints, Gower to Hard and Easy, validation). */
  passing: number;
  /** Candidates that went through rounding and the chance check. */
  tried: number;
  /** A distinct Medium was found and returned. */
  accepted: boolean;
  /** Why the ladder's own Medium was dropped (the reason that stands when nothing is accepted). */
  dropped: LadderCollapse | null;
  /**
   * Best plan of the search on the band key, or null when nothing safe was seen: its D, d̃₁, Gower to Hard / Easy and
   * its Medium rung-constraint violation (`ladderViolation`; 0 = met).
   */
  best: { D: number; d1: number; gowerHard: number; gowerEasy: number; rungViolation: number } | null;
}

export interface PlannerResult<S> {
  complete: boolean;
  stoppedAt: string | null;
  /** Ladder problems: the present rungs in order hard, medium, easy. Otherwise MMR options A/B/C. */
  options: PlanOptionResult<S>[];
  shortfall: null | 'noCandidates' | 'noDistinctAlternative';
  /**
   * True when no safe finalist met even the relaxed priority floors (e.g. after the P90 chance constraint tightened the
   * plan): option A (Hard) is then the safe plan with the smallest floor violation.
   */
  floorsRelaxedForA: boolean;
  noSafePlan: null | { structure: number; x: Float64Array; vS: number; violated: number[] };
  goals: ReturnType<GoalSystem['snapshot']>;
  feasibility: GoalFeasibility[];
  conflicts: ConflictMatrix;
  relations: GoalRelationMessage[];
  tradeoffs: TradeoffCurve[];
  archive: { cells: number; filled: number; activeDescriptors: number[] };
  /** Per goal: the safe nominal plan with the best value of that goal seen during the run (anchor, §4.14.1), or null. */
  anchors: Array<{ structure: number; x: Float64Array; f: number } | null>;
  /** Best nominal plan per `problem.group` family (absent when the problem defines no groups). */
  groupBest?: Record<string, GroupBest>;
  /** Plan ladder (null without `problem.ladder`). */
  ladder: LadderResult<S> | null;
  /** Convergence curve: stage ends and every ~2 % of the budget. */
  convergence: ConvergencePoint[];
  /** Per goal: selection-ensemble mean d̃ − holdout mean d̃ of Hard (option A); empty without a holdout. */
  holdoutGap: number[];
  /** Key quanta at the end of the run (§4.3). */
  quanta: { q: number[]; qG: number };
  /** Structure race rounds: per-structure budget and survivors (ids). */
  race: { rounds: Array<{ budgetPerStructure: number; survivors: string[] }> };
  /** S5 finalists (only with `config.diagnostics`): nominal d̃, chance feasibility and validator outcome. */
  diagnostics?: {
    finalists: Array<{ structureId: string; role: string; desirability: number[]; utility: number; safe: boolean; chanceFeasible: boolean | null; p10Violations: number[]; marginBands: number[][]; validated: boolean; relaxedFeasible: boolean; draws: number }>;
  };
  provenance: {
    seed: string;
    tier: Tier;
    budgetEU: number;
    euUsed: number;
    requests: number;
    cacheHits: number;
    stageEU: Record<string, number>;
    /** Where a resumed run continued from (checkpoint label), 'refused' when the checkpoint did not match, else null. */
    resumedFrom: string | null;
  };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

interface Proposal {
  structure: number;
  x: Float64Array;
  box: number;
  draw: number;
}

interface StructTrack {
  best: EvalRecord | null;
  goal: (EvalRecord | null)[];
  terc: (EvalRecord | null)[];
}

type FinRole = 'option' | 'hard' | 'medium' | 'easy';

interface Fin {
  role: FinRole;
  rec: EvalRecord;
  rounded: boolean;
  /** Selection-ensemble outputs, draws 0..outs.length−1. */
  outs: EvalOutput[];
  sel: FinalistRobustness | null;
  hold: FinalistRobustness | null;
  /** Rung goal constraints (rungs only). */
  thr: Float64Array | null;
  /** Where a rung finalist came from (§12.1-12.2; absent = 'own'). */
  prov?: RungProvenance;
}

interface RungWork {
  thr: Float64Array;
  warm: EvalRecord | null;
  cands: EvalRecord[];
}

interface LadderState {
  step: LadderData['step'];
  budget: number;
  hard: EvalRecord | null;
  gH: number;
  DH: number;
  gMin: number;
  easy: RungWork | null;
  medium: RungWork | null;
  collapsed: LadderCollapse[];
}

type Restarter = IpopCmaEs | BipopCmaEs;

const ZEROS = (n: number) => new Float64Array(n);
const ONES = (n: number) => new Float64Array(n).fill(1);
const PHASES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S4.ladder'] as const;

class PlannerRun<S extends PlanStructure> {
  readonly goals: GoalSystem;
  readonly rng: Rng;
  readonly B: StageBudget;
  readonly tier: Tier;
  readonly K: number;
  readonly lad: ResolvedLadder | null;
  /** Cache key of the pinned Hard genome (`LadderSpec.pinHard`) and its nominal record once evaluated. */
  private readonly pinKey: string | null;
  private pinnedHard: EvalRecord | null = null;
  readonly Ms: number;
  readonly Mh: number;
  /** Cumulative EU limits per stage in table order (roll-forward). */
  readonly cum: { race: number; anchors: number; stages: number; qd: number; ladder: number };
  readonly fingerprint: string;
  eu = 0;
  requests = 0;
  cacheHits = 0;
  private nextId = 0;
  /** Evaluation cache; `null` = evaluated before a resume (output unknown: re-evaluated at 0 EU). */
  private readonly cache = new Map<string, EvalOutput | null>();
  /** Charged EU per proposal of the last `evaluate` call. */
  private lastCost = new Float64Array(0);
  readonly stageEU: Record<string, number> = {};
  private hist = new Float64Array(0);
  private histRows = 0;
  archive: Archive<EvalRecord> | null = null;
  activeDims: number[] = [];
  /** Per archive cell and goal: the safe record with the best objective (re-offered when floors change). */
  private reserve: (EvalRecord | null)[] = [];
  /** Nominal records seen before the archive exists (baseline, seeds, screening probes). */
  early: EvalRecord[] = [];
  readonly anchorRec: (EvalRecord | null)[];
  leastInfeasible: EvalRecord | null = null;
  diagnostics: NonNullable<PlannerResult<unknown>['diagnostics']>['finalists'] | null = null;
  anySafe = false;
  incumbents: EvalRecord[] = [];
  /** Per plan family (`problem.group`) a few candidates for its best plan. */
  private groupPool = new Map<string, (EvalRecord | null)[]>();
  stoppedAt: string | null = null;
  private lastProgressEU = -Infinity;
  private lastCurveEU = -Infinity;
  private lastCheckpointEU = 0;
  private lastRungSig = '';
  readonly curve: ConvergencePoint[] = [];
  // race
  private raceTrack: Map<number, StructTrack> | null = null;
  raceRounds: Array<{ budgetPerStructure: number; survivors: string[] }> = [];
  survivors: number[] = [];
  survivorBest: EvalRecord[] = [];
  // ladder
  ladderState: LadderState | null = null;
  // phases and checkpoints
  phase = 0;
  private resumeData: RunStateData['phaseData'] = null;
  private resumeJob: JobData | null = null;
  private snapPhase: (() => RunStateData['phaseData']) | null = null;
  private snapJob: (() => JobData) | null = null;
  /** Records referenced by phase data (ids) — kept for checkpoints. */
  private readonly pinned = new Map<number, EvalRecord>();
  private wall0 = 0;
  private wallOffset = 0;
  private stage = 'S0';
  resumedFrom: string | null = null;
  private anytimeAlts: EvalRecord[] = [];

  constructor(
    readonly problem: PlannerProblem<S>,
    readonly evaluator: Evaluator,
    readonly cfg: PlannerConfig,
  ) {
    this.tier = cfg.tier ?? 'S';
    this.K = problem.goals.length;
    this.goals = new GoalSystem(problem.goals, {
      strictness: cfg.strictness,
      targetTolerance: cfg.targetTolerance,
      eta: cfg.eta,
      boxWeight: cfg.boxWeight,
    });
    this.rng = new Rng(cfg.seed);
    this.lad = problem.ladder ? resolveLadder(problem.ladder) : null;
    const pin = this.lad?.pinHard;
    this.pinKey = pin ? this.cacheKey({ structure: pin.structure, x: Float64Array.from(pin.x, (v) => Math.min(1, Math.max(0, v))), draw: -1 }) : null;
    this.B = planBudget(this.tier, this.K, cfg.totalEU ?? TIER_BUDGET_EU[this.tier], !!this.lad, this.lad?.reserveIdeal ?? true);
    const b = this.B;
    this.cum = {
      race: b.race,
      anchors: b.race + b.anchors,
      stages: b.race + b.anchors + b.stages,
      qd: b.race + b.anchors + b.stages + b.qd,
      ladder: b.race + b.anchors + b.stages + b.qd + b.ladder,
    };
    this.Ms = Math.max(0, Math.floor(cfg.ensembleSize ?? TIER_ENSEMBLE[this.tier]));
    // holdout by default on ladder problems only: v1-mode callers (time-to-target, re-plan, toys) may run evaluators
    // that define no holdout draws; they opt in with `holdoutSize` (README v2)
    this.Mh = this.Ms > 0 ? Math.max(0, Math.floor(cfg.holdoutSize ?? (this.lad ? TIER_HOLDOUT[this.tier] : 0))) : 0;
    this.anchorRec = new Array<EvalRecord | null>(this.K).fill(null);
    this.fingerprint = this.computeFingerprint();
    this.wall0 = cfg.now ? cfg.now() : 0;
    const resume = cfg.checkpoint?.resume;
    if (resume) {
      if (resume.version === CHECKPOINT_VERSION && resume.fingerprint === this.fingerprint) {
        this.restore(resume);
        this.resumedFrom = resume.label;
      } else this.resumedFrom = 'refused';
    }
  }

  get aborted(): boolean {
    return !!this.cfg.signal?.aborted;
  }
  remaining(): number {
    return this.B.run + this.extraEU - this.eu;
  }
  /** EU granted on top of the run's total (the Medium band search and the Medium it adds). */
  private extraEU = 0;
  lambdaFor(n: number): number {
    const q = this.cfg.lambdaQuantum ?? TIER_LAMBDA_QUANTUM[this.tier];
    return Math.ceil(Math.max(defaultLambda(n), 2 * q) / q) * q;
  }
  get covariance(): CovarianceMode | 'auto' {
    return this.cfg.covariance ?? TIER_COVARIANCE[this.tier];
  }
  structureOf(i: number): S {
    const s = this.problem.structures[i];
    if (!s) throw new RangeError(`unknown structure ${i}`);
    return s;
  }
  x0Of(i: number): Float64Array {
    const s = this.structureOf(i);
    return s.x0 ? Float64Array.from(s.x0) : new Float64Array(s.dim).fill(0.5);
  }
  /** Difficulty D of a record (descriptor 0 on ladder problems; NaN read as the hardest). */
  D(r: EvalRecord): number {
    if (!this.lad) return 0;
    const d = r.out.descriptors[0];
    return d === undefined || Number.isNaN(d) ? 1 : d;
  }
  get qD(): number {
    return this.lad?.qD ?? LADDER_DEFAULTS.qD;
  }
  /** Hard key (ladder) or final key (no ladder). */
  hardKeyOf(r: Scored & { out?: EvalOutput }, relaxed = false, D?: number): Key {
    return this.lad
      ? this.goals.hardKey(r, D ?? this.D(r as EvalRecord), this.qD, relaxed)
      : this.goals.finalKey(r, relaxed);
  }
  archiveKey = (r: EvalRecord): Key => this.goals.finalKey(r, true);

  private computeFingerprint(): string {
    const p = this.problem;
    const s = JSON.stringify({
      seed: this.rng.key,
      tier: this.tier,
      total: this.B.total,
      structures: p.structures.map((st) => [st.id, st.dim]),
      goals: p.goals.map((g) => [g.id, g.sense, g.target ?? null, g.keep ?? null, g.tolerance ?? null, g.minTolerance ?? null, g.band ?? null]),
      baseline: [p.baseline.structure, Array.from(p.baseline.x)],
      ladder: this.lad,
      Ms: this.Ms,
      Mh: this.Mh,
      race: this.cfg.race ?? null,
      lq: this.cfg.lambdaQuantum ?? null,
      cov: this.cfg.covariance ?? null,
      strict: this.cfg.strictness ?? null,
    });
    return `${hashString(s, 0x811c9dc5).toString(16)}-${hashString(s, 0x9747b28c).toString(16)}`;
  }

  // ---- evaluation service ----

  /** Same structure and genome as `LadderSpec.pinHard` (within the 1e-6 grid of the cache key). */
  private isPinned(r: { structure: number; x: Float64Array }): boolean {
    const pin = this.lad?.pinHard;
    if (!pin || r.structure !== pin.structure || r.x.length !== pin.x.length) return false;
    for (let i = 0; i < r.x.length; i++) if (Math.abs(r.x[i]! - Math.min(1, Math.max(0, pin.x[i]!))) > 1e-6) return false;
    return true;
  }

  private cacheKey(p: { structure: number; x: Float64Array; draw: number }): string {
    const q = new Int32Array(p.x.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(p.x[i]! * 1e6);
    return `${p.structure}|${p.draw}|${hashInts(q, 0x811c9dc5)}|${hashInts(q, 0x9747b28c)}`;
  }

  /** Evaluate proposals (cache + dedupe), charge EU, and build records in proposal order. */
  async evaluate(props: readonly Proposal[], stage: string): Promise<EvalRecord[]> {
    const keys = props.map((p) => this.cacheKey(p));
    const missIdx: number[] = [];
    const charge: boolean[] = [];
    const seen = new Set<string>();
    this.lastCost = new Float64Array(props.length);
    keys.forEach((k, i) => {
      const c = this.cache.get(k);
      if (c || seen.has(k)) return;
      seen.add(k);
      missIdx.push(i);
      charge.push(c === undefined);
    });
    let charged = 0;
    if (missIdx.length) {
      const reqs = missIdx.map((i) => ({
        structure: props[i]!.structure,
        x: props[i]!.x,
        draw: props[i]!.draw,
      }));
      const outs = await this.evaluator.evaluate(reqs);
      if (outs.length !== reqs.length)
        throw new Error(`Evaluator returned ${outs.length} outputs for ${reqs.length} requests`);
      let cost = 0;
      missIdx.forEach((i, j) => {
        const o = outs[j]!;
        if (o.goals.length !== this.K)
          throw new Error(`EvalOutput.goals has ${o.goals.length} values, expected ${this.K}`);
        this.cache.set(keys[i]!, o);
        if (!charge[j]) return;
        const c = o.cost ?? 1;
        cost += c;
        this.lastCost[i] = c;
        charged++;
      });
      if (charged) {
        this.eu += cost;
        this.stageEU[stage] = (this.stageEU[stage] ?? 0) + cost;
      }
    }
    this.requests += props.length;
    this.cacheHits += props.length - charged;
    return props.map((p, i) => this.record(p, this.cache.get(keys[i]!)!, stage));
  }

  record(p: Proposal, out: EvalOutput, stage: string): EvalRecord {
    const f = this.goals.objective(out.goals);
    return {
      id: this.nextId++,
      structure: p.structure,
      x: p.x,
      box: p.box,
      draw: p.draw,
      out,
      f,
      vS: violation(out.margins),
      reg: out.regulariser,
      stage,
    };
  }

  /** Anchors, history, least-infeasible tracking, race trackers and archive insertion (nominal records, candidate order). */
  ingest(r: EvalRecord): InsertResult | null {
    if (r.draw !== -1) return null;
    if (this.pinKey && !this.pinnedHard && this.isPinned(r)) this.pinnedHard = r;
    const safe = r.vS === 0;
    this.goals.observe(r.f, safe);
    if (safe) {
      this.anySafe = true;
      this.appendHistory(r);
      for (let k = 0; k < this.K; k++) {
        const cur = this.anchorRec[k];
        if (!cur || r.f[k]! > cur.f[k]!) this.anchorRec[k] = r;
      }
    } else if (!this.leastInfeasible || r.vS < this.leastInfeasible.vS) this.leastInfeasible = r;
    if (this.problem.group) this.trackGroup(r);
    if (this.raceTrack) this.trackRace(r);
    if (!this.archive) {
      this.early.push(r);
      return null;
    }
    const res = this.archive.offer(r);
    if (safe) this.trackReserve(res.cell, r);
    return res;
  }

  private trackReserve(cell: number, r: EvalRecord): void {
    const K = this.K;
    for (let k = 0; k < K; k++) {
      const cur = this.reserve[cell * K + k];
      if (!cur || r.f[k]! > cur.f[k]!) this.reserve[cell * K + k] = r;
    }
  }

  /** Floors changed: records that lost their cell under the old comparator get another chance (deterministic order). */
  private reofferReserve(): void {
    if (!this.archive) return;
    for (const r of this.reserve) if (r) this.archive.offer(r);
  }

  private trackRace(r: EvalRecord): void {
    const t = this.raceTrack!;
    let tr = t.get(r.structure);
    if (!tr) t.set(r.structure, (tr = { best: null, goal: new Array<EvalRecord | null>(this.K).fill(null), terc: [null, null, null] }));
    const key = this.goals.stageKey(0, r);
    if (!tr.best || compareKeys(key, this.goals.stageKey(0, tr.best)) < 0) tr.best = r;
    for (let k = 0; k < this.K; k++) {
      const g = tr.goal[k];
      if (!g || r.vS < g.vS || (r.vS === g.vS && r.f[k]! > g.f[k]!)) tr.goal[k] = r;
    }
    if (this.lad) {
      const t3 = dTercile(this.D(r));
      const cur = tr.terc[t3];
      if (!cur || compareKeys(key, this.goals.stageKey(0, cur)) < 0) tr.terc[t3] = r;
    }
  }

  /**
   * Candidates for the best plan of the record's family: per goal the safe record with the best objective, the safe
   * record best under the final comparator at the time it was seen, and the least-violating unsafe record (K + 2 slots;
   * the final pick re-ranks them under the final floors, `groupBestOut`).
   */
  private trackGroup(r: EvalRecord): void {
    const g = this.problem.group!(r.structure, r.out);
    if (g === null) return;
    const K = this.K;
    let pool = this.groupPool.get(g);
    if (!pool) this.groupPool.set(g, (pool = new Array<EvalRecord | null>(K + 2).fill(null)));
    if (r.vS === 0) {
      for (let k = 0; k < K; k++) if (!pool[k] || r.f[k]! > pool[k]!.f[k]!) pool[k] = r;
      const cur = pool[K];
      if (!cur || compareKeys(this.goals.finalKey(r, true), this.goals.finalKey(cur, true)) < 0) pool[K] = r;
    } else if (!pool[K + 1] || r.vS < pool[K + 1]!.vS) pool[K + 1] = r;
  }

  /** Best record per family under the final comparator with relaxed floors (safe plans first), in family order. */
  groupBestRecords(): Array<[string, EvalRecord]> {
    const out: Array<[string, EvalRecord]> = [];
    for (const [g, pool] of this.groupPool) {
      let best: EvalRecord | null = null;
      for (const r of pool)
        if (r && (!best || compareKeys(this.goals.finalKey(r, true), this.goals.finalKey(best, true)) < 0)) best = r;
      if (best) out.push([g, best]);
    }
    return out;
  }

  /** Best plan per family under the final comparator with relaxed floors (safe plans first). */
  groupBestOut(): Record<string, GroupBest> {
    const out: Record<string, GroupBest> = {};
    for (const [g, best] of this.groupBestRecords()) {
      out[g] = {
        structure: best.structure,
        structureId: this.structureOf(best.structure).id,
        x: best.x,
        metricValues: Float64Array.from(best.f, (v, k) => this.goals.toMetric(k, v)),
        objectives: best.f,
        desirability: this.goals.desirability(best.f),
        vS: best.vS,
        violated: violatedOf(best.out.margins),
        regulariser: best.reg,
        utility: this.goals.utility(best.f, best.reg),
        goalScore: this.goals.goalScore(best.f),
        strictFeasible: this.goals.priorityFeasible(best.f, false),
        relaxedFeasible: this.goals.priorityFeasible(best.f, true),
      };
    }
    return out;
  }

  private appendHistory(r: EvalRecord): void {
    const w = this.K + 1;
    if ((this.histRows + 1) * w > this.hist.length) {
      const grown = new Float64Array(Math.max(1024 * w, this.hist.length * 2));
      grown.set(this.hist);
      this.hist = grown;
    }
    this.hist.set(r.f, this.histRows * w);
    this.hist[this.histRows * w + this.K] = r.reg;
    this.histRows++;
  }

  historyDesirability(): { d: Float64Array; u: Float64Array } {
    const w = this.K + 1;
    const d = new Float64Array(this.histRows * this.K);
    const u = new Float64Array(this.histRows);
    for (let h = 0; h < this.histRows; h++) {
      const f = this.hist.subarray(h * w, h * w + this.K);
      d.set(this.goals.desirability(f), h * this.K);
      u[h] = this.goals.utility(f, this.hist[h * w + this.K]!);
    }
    return { d, u };
  }

  // ---- archive ----

  private buildArchive(): void {
    const desc = this.early.map((r) => r.out.descriptors);
    const minRange = this.cfg.minDescriptorRange ?? 0.1;
    let indexer: CellIndexer;
    if (this.lad) {
      // D is always active; the style descriptors (1..) use the range rule
      const style = selectActiveDescriptors(
        desc.map((d) => Array.from(d).slice(1)),
        minRange,
      ).map((j) => j + 1);
      this.activeDims = [0, ...style];
      indexer = new DFirstGrid(
        TIER_D_BINS[this.tier],
        cvtCentroids(TIER_STYLE_CELLS[this.tier], style.length, this.rng.fork('cvt'), this.cfg.cvtSamples ?? 10000),
      );
    } else {
      this.activeDims = selectActiveDescriptors(desc, minRange);
      indexer = cvtCentroids(
        this.cfg.archiveCells ?? TIER_ARCHIVE_CELLS[this.tier],
        this.activeDims.length,
        this.rng.fork('cvt'),
        this.cfg.cvtSamples ?? 10000,
      );
    }
    this.archive = new Archive<EvalRecord>(indexer, this.activeDims, (r) => r.out.descriptors, this.archiveKey);
    this.reserve = new Array<EvalRecord | null>(indexer.cells * this.K).fill(null);
  }

  private openArchive(): void {
    this.buildArchive();
    const early = this.early;
    this.early = [];
    for (const r of early) {
      const res = this.archive!.offer(r);
      if (r.vS === 0) this.trackReserve(res.cell, r);
    }
  }

  // ---- progress, convergence and checkpoints ----

  private wall(): number {
    return this.cfg.now ? this.cfg.now() - this.wall0 + this.wallOffset : 0;
  }

  /** Best record under the Hard key (strict floors) among the incumbents and the archive (or the early records). */
  hardIncumbent(): EvalRecord | null {
    const pool = [...this.incumbents, ...(this.archive ? this.archive.all() : this.early)];
    return this.bestBy(pool, (r) => this.hardKeyOf(r));
  }

  staircasePoints(): StairPoint<EvalRecord>[] {
    if (!this.lad || !this.archive) return [];
    const pts: StairPoint<EvalRecord>[] = [];
    for (const r of this.archive.all())
      if (r.vS === 0) pts.push({ D: this.D(r), d1: this.goals.dRaw(0, r.f[0]!), g: this.goals.goalScore(r.f), item: r });
    return staircase(pts);
  }

  /** Convergence point every `CONVERGENCE_EVERY` of the budget (deterministic in EU) and at every stage end. */
  tick(stage: string, force = false): ConvergencePoint | null {
    const every = Math.max(1, Math.floor(CONVERGENCE_EVERY * this.B.run));
    if (!force && this.eu - this.lastCurveEU < every) return null;
    this.lastCurveEU = this.eu;
    const h = this.hardIncumbent();
    const p: ConvergencePoint = {
      eu: this.eu,
      wallMs: this.wall(),
      stage,
      keyHard: h ? Array.from(this.hardKeyOf(h).slice(0, 3)) : [],
      G: h ? this.goals.goalScore(h.f) : 0,
      hvLadder: this.lad ? ladderHypervolume(this.staircasePoints()) : 0,
    };
    this.curve.push(p);
    this.cfg.onConvergence?.(p);
    return p;
  }

  progress(stage: string, provisional: EvalRecord | null, force = false, alternatives?: readonly EvalRecord[]): void {
    const cb = this.cfg.onProgress;
    if (!cb) return;
    let rungs: PlannerProgress['rungs'] | undefined;
    if (this.lad) {
      const pr = this.provisionalRungs(provisional);
      const sig = (['hard', 'medium', 'easy'] as const).map((k) => pr[k]?.id ?? -1).join(',');
      if (sig !== this.lastRungSig) {
        this.lastRungSig = sig;
        force = true;
      }
      rungs = {};
      for (const k of ['hard', 'medium', 'easy'] as const) {
        const r = pr[k];
        if (r) rungs[k] = { ...this.summary(r), D: this.D(r) };
      }
    }
    const every = this.cfg.progressEveryEU ?? Math.max(1, Math.floor(0.02 * this.B.run));
    if (!force && this.eu - this.lastProgressEU < every) return;
    this.lastProgressEU = this.eu;
    const last = this.curve[this.curve.length - 1];
    cb({
      stage,
      euUsed: this.eu,
      euBudget: this.B.run,
      archiveSize: this.archive?.size ?? 0,
      provisional: provisional ? this.summary(provisional) : null,
      ...(alternatives ? { alternatives: alternatives.map((r) => this.summary(r)) } : {}),
      ...(rungs ? { rungs } : {}),
      ...(last ? { convergence: last } : {}),
    });
  }

  /** Provisional rungs: Hard = the incumbent; Easy / Medium = lowest-D safe archive elites meeting their constraints. */
  private provisionalRungs(provisional: EvalRecord | null): Partial<Record<RungId, EvalRecord>> {
    const out: Partial<Record<RungId, EvalRecord>> = {};
    const ls = this.ladderState;
    const hard = ls?.hard ?? provisional;
    if (!hard || !this.lad) return out;
    out.hard = hard;
    if (!this.incumbents.length || !this.archive) return out;
    const dH = this.goals.desirability(hard.f);
    const gH = dH[0]!;
    const gMin = gMinDesirability(this.goals, this.lad.gMinMetric);
    if (!(gH >= gMin)) return out;
    const pick = (thr: Float64Array, solved: RungWork | null | undefined): EvalRecord | null => {
      if (solved?.cands.length) return solved.cands[0]!;
      let best: EvalRecord | null = null;
      for (const r of this.archive!.all()) {
        if (r.vS !== 0 || ladderViolation(this.goals.desirability(r.f), thr) > 1e-9) continue;
        if (!best || this.D(r) < this.D(best) || (this.D(r) === this.D(best) && r.id < best.id)) best = r;
      }
      return best;
    };
    const e = pick(rungThresholds(this.goals, dH, Math.max(this.lad.easyShare * gH, gMin), LADDER_DEFAULTS.rhoEasy), ls?.easy);
    const m = pick(rungThresholds(this.goals, dH, Math.max(this.lad.mediumShare * gH, gMin), LADDER_DEFAULTS.rhoMedium), ls?.medium);
    if (e && e.id !== hard.id) out.easy = e;
    if (m && m.id !== hard.id && m.id !== e?.id) out.medium = m;
    return out;
  }

  /**
   * Anytime A/B/C (problems without a ladder; QA item 8): nominal MMR selection over the current pool, delivered as a
   * forced progress event. Pure read of the pool (no RNG, no evaluations).
   */
  emitAlternatives(stage: string): void {
    if (!this.cfg.onProgress || this.lad) return;
    const pool = this.selectionPool();
    if (pool.length < 2) return;
    const sel = selectAlternatives(pool.map(this.asCandidate), this.distanceFn(pool), {
      count: this.cfg.optionCount ?? 3,
      lambda: this.cfg.mmrLambda,
      scoreStep: this.goals.goalQuantum(),
      dMin: this.cfg.dMin,
    });
    const alts = sel.chosen.map((i) => pool[i]!);
    // a later selection never shows fewer options than an earlier one: earlier picks stay valid candidates
    const count = this.cfg.optionCount ?? 3;
    for (const r of this.anytimeAlts) if (alts.length < count && !alts.some((q) => q.id === r.id)) alts.push(r);
    this.anytimeAlts = alts.slice();
    if (alts.length) this.progress(stage, alts[0]!, true, alts);
  }

  private pin(r: EvalRecord): number {
    this.pinned.set(r.id, r);
    return r.id;
  }

  private recById(id: number): EvalRecord {
    const r = this.pinned.get(id);
    if (!r) throw new Error(`planner checkpoint: record ${id} missing`);
    return r;
  }

  /** Save a checkpoint (forced at stage / round ends; otherwise every `everyEU`). */
  private async checkpoint(label: string, force: boolean): Promise<void> {
    const cp = this.cfg.checkpoint;
    if (!cp || this.aborted) return;
    if (!force && !(cp.everyEU !== undefined && this.eu - this.lastCheckpointEU >= cp.everyEU)) return;
    this.lastCheckpointEU = this.eu;
    await cp.save(this.serialize(label));
  }

  private serialize(label: string): PlannerCheckpointData {
    const phaseData = this.snapPhase ? this.snapPhase() : null;
    const recs = new Map<number, EvalRecord>(this.pinned);
    const add = (r: EvalRecord | null | undefined) => {
      if (r) recs.set(r.id, r);
    };
    const id = (r: EvalRecord | null | undefined) => (r ? (add(r), r.id) : null);
    this.early.forEach(add);
    const anchorIds = this.anchorRec.map(id);
    const leastInfeasibleId = id(this.leastInfeasible);
    const incumbentIds = this.incumbents.map((r) => id(r)!);
    const groupPool: RunStateData['groupPool'] = [...this.groupPool].map(([g, pool]) => [g, pool.map(id)]);
    const archive = this.archive
      ? {
          activeDims: this.activeDims.slice(),
          elites: this.archive.snapshot().map(id),
          reserve: this.reserve.map(id),
        }
      : null;
    const survivorBestIds = this.survivorBest.map((r) => id(r)!);
    const ls = this.ladderState;
    const ladder: LadderData | null = ls ? this.ladderData(ls, id) : null;
    const records: SerializedRecord[] = [...recs.values()]
      .sort((a, b) => a.id - b.id)
      .map((r) => ({
        id: r.id,
        structure: r.structure,
        x: Array.from(r.x),
        box: r.box,
        draw: r.draw,
        stage: r.stage,
        out: serializeOutput(r.out),
      }));
    const state: RunStateData = {
      eu: this.eu,
      requests: this.requests,
      cacheHits: this.cacheHits,
      nextId: this.nextId,
      stageEU: { ...this.stageEU },
      goals: this.goals.getState(),
      records,
      cacheKeys: [...this.cache.keys()],
      hist: Array.from(this.hist.subarray(0, this.histRows * (this.K + 1))),
      histRows: this.histRows,
      earlyIds: this.early.map((r) => r.id),
      anchorIds,
      leastInfeasibleId,
      anySafe: this.anySafe,
      incumbentIds,
      groupPool,
      archive,
      survivors: this.survivors.slice(),
      survivorBestIds,
      raceRounds: this.raceRounds.map((r) => ({ budgetPerStructure: r.budgetPerStructure, survivors: r.survivors.slice() })),
      ladder,
      curve: this.curve.map((p) => ({ ...p, keyHard: p.keyHard.slice() })),
      lastProgressEU: this.lastProgressEU,
      lastCurveEU: this.lastCurveEU,
      lastCheckpointEU: this.lastCheckpointEU,
      wallMs: this.wall(),
      phaseData,
    };
    return { version: CHECKPOINT_VERSION, fingerprint: this.fingerprint, label, phase: this.phase, euUsed: this.eu, state };
  }

  private ladderData(ls: LadderState, id: (r: EvalRecord | null | undefined) => number | null): LadderData {
    const work = (w: RungWork | null) =>
      w ? { thr: Array.from(w.thr), warmId: id(w.warm), candIds: w.cands.map((r) => id(r)!) } : null;
    return {
      step: ls.step,
      budget: ls.budget,
      hardId: id(ls.hard),
      gH: ls.gH,
      DH: ls.DH,
      gMin: ls.gMin,
      easy: work(ls.easy),
      medium: work(ls.medium),
      collapsed: ls.collapsed.map((c) => ({ ...c, detail: { ...c.detail } })),
      job: null,
    };
  }

  private restore(cp: PlannerCheckpointData): void {
    const st = cp.state;
    this.goals.setState(st.goals);
    this.eu = st.eu;
    this.requests = st.requests;
    this.cacheHits = st.cacheHits;
    this.nextId = st.nextId;
    Object.assign(this.stageEU, st.stageEU);
    const recs = new Map<number, EvalRecord>();
    for (const s of st.records) {
      const out = deserializeOutput(s.out);
      const r: EvalRecord = {
        id: s.id,
        structure: s.structure,
        x: Float64Array.from(s.x),
        box: s.box,
        draw: s.draw,
        out,
        f: this.goals.objective(out.goals),
        vS: violation(out.margins),
        reg: out.regulariser,
        stage: s.stage,
      };
      recs.set(r.id, r);
      this.pinned.set(r.id, r);
    }
    for (const k of st.cacheKeys) this.cache.set(k, null);
    for (const r of recs.values()) this.cache.set(this.cacheKey(r), r.out);
    const get = (id: number | null): EvalRecord | null => (id === null ? null : (recs.get(id) ?? null));
    this.hist = Float64Array.from(st.hist);
    this.histRows = st.histRows;
    this.early = st.earlyIds.map((i) => get(i)!);
    st.anchorIds.forEach((i, k) => (this.anchorRec[k] = get(i)));
    this.leastInfeasible = get(st.leastInfeasibleId);
    this.anySafe = st.anySafe;
    this.incumbents = st.incumbentIds.map((i) => get(i)!);
    this.groupPool = new Map(st.groupPool.map(([g, ids]) => [g, ids.map(get)]));
    if (st.archive) {
      // the grid is a pure function of the active descriptors and the seed
      this.activeDims = st.archive.activeDims.slice();
      this.rebuildArchive(st.archive.activeDims);
      this.archive!.restore(st.archive.elites.map(get));
      this.reserve = st.archive.reserve.map(get);
    }
    this.survivors = st.survivors.slice();
    this.survivorBest = st.survivorBestIds.map((i) => get(i)!);
    this.raceRounds = st.raceRounds.map((r) => ({ budgetPerStructure: r.budgetPerStructure, survivors: r.survivors.slice() }));
    if (st.ladder) {
      const L = st.ladder;
      const work = (w: LadderData['easy']): RungWork | null =>
        w ? { thr: Float64Array.from(w.thr), warm: get(w.warmId), cands: w.candIds.map((i) => get(i)!) } : null;
      this.ladderState = {
        step: L.step,
        budget: L.budget,
        hard: get(L.hardId),
        gH: L.gH,
        DH: L.DH,
        gMin: L.gMin,
        easy: work(L.easy),
        medium: work(L.medium),
        collapsed: L.collapsed.map((c) => ({ ...c, detail: { ...c.detail } })),
      };
    }
    this.curve.push(...st.curve.map((p) => ({ ...p, keyHard: p.keyHard.slice() })));
    this.lastProgressEU = st.lastProgressEU;
    this.lastCurveEU = st.lastCurveEU;
    this.lastCheckpointEU = st.lastCheckpointEU;
    this.wallOffset = st.wallMs;
    this.phase = cp.phase;
    this.resumeData = st.phaseData;
  }

  private rebuildArchive(activeDims: readonly number[]): void {
    let indexer: CellIndexer;
    if (this.lad) {
      const style = activeDims.slice(1);
      indexer = new DFirstGrid(
        TIER_D_BINS[this.tier],
        cvtCentroids(TIER_STYLE_CELLS[this.tier], style.length, this.rng.fork('cvt'), this.cfg.cvtSamples ?? 10000),
      );
    } else
      indexer = cvtCentroids(
        this.cfg.archiveCells ?? TIER_ARCHIVE_CELLS[this.tier],
        activeDims.length,
        this.rng.fork('cvt'),
        this.cfg.cvtSamples ?? 10000,
      );
    this.archive = new Archive<EvalRecord>(indexer, activeDims, (r) => r.out.descriptors, this.archiveKey);
    this.reserve = new Array<EvalRecord | null>(indexer.cells * this.K).fill(null);
  }

  private takeResume<T extends NonNullable<RunStateData['phaseData']>>(): T | null {
    const d = this.resumeData as T | null;
    this.resumeData = null;
    return d;
  }

  // ---- selection helpers ----

  /**
   * Candidate pool for selection: S3 incumbents first, then archive elites, then the best plan of each tracked family
   * (`problem.group`) when it is safe and meets the relaxed floors. Deduplicated, in deterministic order.
   */
  selectionPool(): EvalRecord[] {
    const seen = new Set<number>();
    const pool: EvalRecord[] = [];
    const groups = this.groupBestRecords()
      .map(([, r]) => r)
      .filter((r) => r.vS === 0 && this.goals.priorityFeasible(r.f, true));
    for (const r of [...this.incumbents, ...(this.archive?.all() ?? this.early), ...groups]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      pool.push(r);
    }
    return pool;
  }

  asCandidate = (r: EvalRecord): SelectionCandidate => ({
    utility: this.goals.utility(r.f, r.reg),
    goalScore: this.goals.goalScore(r.f),
    safe: r.vS === 0,
    strictFeasible: this.goals.priorityFeasible(r.f, false),
    relaxedFeasible: this.goals.priorityFeasible(r.f, true),
    floorViolation: this.goals.floorViolation(r.f, this.K, false),
  });

  summary(r: EvalRecord): OptionSummary {
    return {
      structure: r.structure,
      structureId: this.structureOf(r.structure).id,
      x: r.x,
      desirability: this.goals.desirability(r.f),
      percentOfPossible: Float64Array.from(r.f, (v, k) => this.goals.percentOfPossible(k, v)),
      utility: this.goals.utility(r.f, r.reg),
    };
  }

  bestBy(recs: readonly EvalRecord[], key: (r: EvalRecord) => Key): EvalRecord | null {
    let best: EvalRecord | null = null;
    let bk: Key | null = null;
    for (const r of recs) {
      const k = key(r);
      if (!bk || compareKeys(k, bk) < 0) {
        best = r;
        bk = k;
      }
    }
    return best;
  }

  distanceFn(cands: readonly EvalRecord[], rangeFrom?: readonly EvalRecord[]): (i: number, j: number) => number {
    const custom = this.problem.distance;
    const view = (r: EvalRecord): CandidateView => ({ structure: r.structure, x: r.x, output: r.out });
    if (custom) return (i, j) => custom.call(this.problem, view(cands[i]!), view(cands[j]!));
    const feats = cands.map((r) => r.out.features ?? r.out.descriptors);
    const dims = feats[0]?.length ?? 0;
    const schema: readonly FeatureSpec[] =
      this.problem.featureSchema ?? Array.from({ length: dims }, () => ({ kind: 'numeric' as const }));
    const ranges = featureRanges(rangeFrom ? [...feats, ...rangeFrom.map((r) => r.out.features ?? r.out.descriptors)] : feats, dims);
    return (i, j) => gowerDistance(feats[i]!, feats[j]!, schema, ranges);
  }

  // ---- CMA-ES job driver ----

  private restarterOpts(structure: number, x0: ArrayLike<number>, sigma0: number, budget: number, ipop: boolean, best: () => EvalRecord | null): IpopOptions {
    const s = this.structureOf(structure);
    const n = s.dim;
    const lambda = this.lambdaFor(n);
    return {
      x0,
      sigma0,
      lower: ZEROS(n),
      upper: ONES(n),
      lambda,
      covariance: this.covariance,
      budgetHint: budget,
      discrete: s.discrete,
      tolFun: 1e-3,
      tolX: 1e-7,
      maxRestarts: ipop ? 20 : 0,
      lambdaMax: 8 * lambda,
      restartX0: () => best()?.x ?? x0,
      restartSigma0: this.cfg.sigmaExplore ?? 0.25,
    };
  }

  /**
   * One CMA-ES job with restarts (IPOP; BIPOP on tier X), resumable from a checkpoint by its unique `label`. Returns the
   * best record under `key` (compared at the time each record arrives).
   */
  async runCma(p: {
    label: string;
    structure: number;
    x0: ArrayLike<number>;
    sigma0: number;
    budget: number;
    stage: string;
    key: (r: EvalRecord) => Key;
    ipop?: boolean;
    /** Mid-job checkpoints (every `everyEU`); off inside S5. */
    checkpoint?: boolean;
    /** Called after every generation with its records; true stops the job (the Easy search's stopping rule). */
    stop?: (recs: readonly EvalRecord[]) => boolean;
  }): Promise<EvalRecord | null> {
    const s = this.structureOf(p.structure);
    const n = s.dim;
    if (n === 0) {
      // a structure without free genes (e.g. the status-quo plan) has nothing to search: evaluate it once (cache hit)
      if (this.remaining() < 1) return null;
      const recs = await this.evaluate([{ structure: p.structure, x: new Float64Array(0), box: 0, draw: -1 }], p.stage);
      for (const r of recs) this.ingest(r);
      return recs[0] ?? null;
    }
    const resume = this.resumeJob && this.resumeJob.label === p.label ? this.resumeJob : null;
    this.resumeJob = null;
    let bestRec: EvalRecord | null = resume && resume.bestId !== null ? this.recById(resume.bestId) : null;
    const opts = this.restarterOpts(p.structure, p.x0, p.sigma0, p.budget, p.ipop !== false, () => bestRec);
    const stream = this.rng.fork(p.label);
    const kind: 'ipop' | 'bipop' = p.ipop === false ? 'ipop' : (this.cfg.restarts ?? TIER_RESTARTS[this.tier]);
    let job: Restarter;
    if (resume)
      job =
        resume.kind === 'bipop'
          ? BipopCmaEs.fromState(opts, stream, resume.state as BipopState)
          : IpopCmaEs.fromState(opts, stream, resume.state as IpopState);
    else job = kind === 'bipop' ? new BipopCmaEs(opts, stream) : new IpopCmaEs(opts, stream);
    let used = resume?.used ?? 0;
    let reqs = resume?.reqs ?? 0;
    const prevSnap = this.snapJob;
    this.snapJob = () => ({
      label: p.label,
      kind: job instanceof BipopCmaEs ? 'bipop' : 'ipop',
      state: job.getState(),
      used,
      reqs,
      bestId: bestRec ? this.pin(bestRec) : null,
    });
    try {
      while (!this.aborted && !job.done) {
        const lam = job.lambda;
        if (Math.max(used, reqs / 3) + lam > p.budget || this.remaining() < lam) break;
        const es = job.current;
        const xs = job.ask();
        const props = xs.map((x) => ({ structure: p.structure, x: es.clamp(x), box: es.boxPenalty(x), draw: -1 }));
        const eu0 = this.eu;
        const recs = await this.evaluate(props, p.stage);
        used += this.eu - eu0;
        reqs += recs.length;
        for (const r of recs) this.ingest(r);
        const keys = recs.map(p.key);
        for (let i = 0; i < recs.length; i++)
          if (!bestRec || compareKeys(keys[i]!, p.key(bestRec)) < 0) bestRec = recs[i]!;
        job.tell(keys);
        this.tick(this.stage);
        this.progress(this.stage, this.incumbents[this.incumbents.length - 1] ?? null);
        if (p.checkpoint !== false) await this.checkpoint(`${p.stage}/${p.label}`, false);
        if (p.stop?.(recs)) break;
      }
    } finally {
      this.snapJob = prevSnap;
    }
    return bestRec;
  }

  // ---- stages ----

  async p0(): Promise<void> {
    this.stage = 'S0';
    const b = this.problem.baseline;
    const x = Float64Array.from(b.x);
    const outs = await this.evaluator.evaluate([{ structure: b.structure, x, draw: -1 }]);
    const out = outs[0];
    if (!out) throw new Error('Evaluator returned no output for the baseline');
    if (out.goals.length !== this.K)
      throw new Error(`EvalOutput.goals has ${out.goals.length} values, expected ${this.K}`);
    this.goals.setBaseline(out.goals);
    const p = { structure: b.structure, x, box: 0, draw: -1 };
    this.cache.set(this.cacheKey(p), out);
    this.eu += out.cost ?? 1;
    this.requests++;
    this.stageEU.S0 = out.cost ?? 1;
    const r = this.record(p, out, 'S0');
    this.ingest(r);
    this.progress('S0', null, true);
  }

  private raceEta(): number {
    return this.cfg.race?.eta ?? RACE_ETA;
  }

  private raceRoundsPlanned(): number {
    return this.cfg.race?.rounds ?? (this.cfg.race?.roundEU?.length || TIER_RACE_ROUNDS[this.tier]);
  }

  /** Per-structure budget of race round r (1-based). */
  private raceBudgetFor(round: number, n: number, continueRound: number, lastBudget: number): number {
    const rem = Math.max(0, this.cum.race - this.eu);
    if (n <= 0) return 0;
    const cap = Math.floor(rem / n);
    if (continueRound > 0) return Math.min(cap, 3 * lastBudget);
    const table = this.cfg.race?.roundEU ?? (this.tier === 'X' ? X_ROUND_EU : null);
    if (table) return Math.min(cap, table[round - 1] ?? 3 * lastBudget);
    return Math.min(cap, raceRoundBudget(rem, n, this.raceRoundsPlanned() - round + 1, this.raceEta()));
  }

  private raceEntries(alive: readonly number[]): RaceEntry[] {
    const tags = this.problem.structureTags;
    return alive.map((s) => {
      const tr = this.raceTrack?.get(s);
      const e: RaceEntry = { structure: s, key: tr?.best ? this.goals.stageKey(0, tr.best) : null };
      if (tags) e.tags = tags.call(this.problem, s);
      else
        e.goalKeys = Array.from({ length: this.K }, (_, k) =>
          this.goals.isActive(k) && tr?.goal[k] ? [tr.goal[k]!.vS, -tr.goal[k]!.f[k]!] : null,
        );
      if (this.lad) e.tercileKeys = [0, 1, 2].map((t) => (tr?.terc[t] ? this.goals.stageKey(0, tr.terc[t]!) : null));
      return e;
    });
  }

  private raceInstanceOpts(structure: number): CmaesOptions {
    const s = this.structureOf(structure);
    return {
      x0: ZEROS(s.dim),
      sigma0: RACE_SIGMA0,
      lower: ZEROS(s.dim),
      upper: ONES(s.dim),
      lambda: this.lambdaFor(s.dim),
      covariance: this.covariance,
      discrete: s.discrete,
      tolFun: 1e-3,
      tolX: 1e-7,
    };
  }

  /** S1: seeds, screening probes, then successive-halving rounds of interleaved warm CMA-ES (§4.5). */
  async pRace(): Promise<void> {
    this.stage = 'S1';
    const nS = this.problem.structures.length;
    let ph = this.takeResume<RaceData>();
    const inst: (CmaEs | null)[] = [];
    if (ph) {
      this.raceTrack = new Map();
      for (const [s, best, goal, terc] of ph.track)
        this.raceTrack.set(s, {
          best: best === null ? null : this.recById(best),
          goal: goal.map((i) => (i === null ? null : this.recById(i))),
          terc: terc.map((i) => (i === null ? null : this.recById(i))),
        });
      ph.inst.forEach((st, i) => inst.push(st ? CmaEs.fromState(this.raceInstanceOpts(ph!.alive[i]!), st) : null));
    } else {
      this.raceTrack = new Map();
      ph = { step: 'start', round: 1, continueRound: 0, stale: 0, bestId: null, alive: [], budgetPer: 0, used: [], reqs: [], inst: [], roundStarted: false, track: [] };
    }
    const P = ph;
    this.snapPhase = () => ({
      ...P,
      alive: P.alive.slice(),
      used: P.used.slice(),
      reqs: P.reqs.slice(),
      inst: inst.map((es) => (es ? es.getState() : null)),
      track: [...this.raceTrack!].map(([s, tr]) => [
        s,
        tr.best ? this.pin(tr.best) : null,
        tr.goal.map((r) => (r ? this.pin(r) : null)),
        tr.terc.map((r) => (r ? this.pin(r) : null)),
      ]),
    });
    if (P.step === 'start') {
      // P1 seeds first (their structures always race), then the screening probes
      const seedProps: Proposal[] = [];
      const seeded = new Set<number>();
      const pinSeed = this.lad?.pinHard ? [this.lad.pinHard] : [];
      let pinFirst = false;
      for (const sd of [...pinSeed, ...(this.problem.seeds ?? [])]) {
        if (sd.structure < 0 || sd.structure >= nS) continue;
        if (sd.x.length !== this.structureOf(sd.structure).dim) continue;
        if (!seedProps.length && pinSeed.length && sd === pinSeed[0]) pinFirst = true;
        seeded.add(sd.structure);
        seedProps.push({ structure: sd.structure, x: Float64Array.from(sd.x, (v) => Math.min(1, Math.max(0, v))), box: 0, draw: -1 });
      }
      if (seedProps.length && !this.aborted) {
        const recs = await this.evaluate(seedProps.slice(0, Math.max(0, Math.min(seedProps.length, this.remaining()))), 'S1');
        for (const r of recs) this.ingest(r);
        // the pinned Hard is the first seed (its record's genome may be a decoded copy, so take it by position)
        if (pinFirst && !this.pinnedHard && recs[0]) this.pinnedHard = recs[0];
      }
      let cap = Math.min(nS, TIER_MAX_SCREENED[this.tier]);
      const n0 = new Set([...Array.from({ length: cap }, (_, i) => i), ...seeded]).size;
      const b1 = this.raceBudgetFor(1, n0, 0, 0);
      // fewer EU than structures: screen the first ones in prior order (x0 only)
      if (b1 < 1) cap = Math.min(cap, Math.max(1, Math.floor(Math.max(0, this.cum.race - this.eu))));
      const alive = [...new Set([...Array.from({ length: cap }, (_, i) => i), ...seeded])].sort((a, b) => a - b);
      const probes = Math.max(1, Math.min(RACE_PROBES, b1));
      const props: Proposal[] = [];
      const owner: number[] = [];
      alive.forEach((s, i) => {
        const st = this.structureOf(s);
        props.push({ structure: s, x: this.x0Of(s), box: 0, draw: -1 });
        owner.push(i);
        if (probes > 1 && st.dim > 0) {
          // same stream as v1's S1 screening (`S1/lhs/<index>`), so v1-mode problems start from the same probes
          const lhs = latinHypercube(probes - 1, st.dim, this.rng.fork(`S1/lhs/${s}`));
          for (let m = 0; m < probes - 1; m++) {
            props.push({ structure: s, x: lhs.slice(m * st.dim, (m + 1) * st.dim), box: 0, draw: -1 });
            owner.push(i);
          }
        }
      });
      P.alive = alive;
      P.used = alive.map(() => 0);
      P.reqs = alive.map(() => 0);
      inst.length = 0;
      alive.forEach(() => inst.push(null));
      P.budgetPer = b1;
      const n = Math.max(0, Math.min(props.length, this.remaining()));
      const recs = this.aborted ? [] : await this.evaluate(props.slice(0, n), 'S1');
      recs.forEach((r, j) => {
        this.ingest(r);
        P.used[owner[j]!] = P.used[owner[j]!]! + this.lastCost[j]!;
        P.reqs[owner[j]!] = P.reqs[owner[j]!]! + 1;
      });
      this.openArchive();
      // a single structure has nothing to race: the race is its screening and the rest rolls forward to P3
      P.step = P.alive.length > 1 ? 'round' : 'done';
      P.roundStarted = false;
      this.tick('S1', true);
      this.progress('S1', null, true);
      await this.checkpoint('S1/screen', true);
    }
    while (P.step === 'round' && !this.aborted) {
      await this.raceRound(P, inst);
      if (this.aborted) break;
      // round end: survivors
      const entries = this.raceEntries(P.alive);
      let surv: number[];
      const ranked = [...entries].sort((a, b) =>
        a.key && b.key ? compareKeys(a.key, b.key) || a.structure - b.structure : a.key ? -1 : b.key ? 1 : a.structure - b.structure,
      );
      if (P.continueRound > 0) surv = ranked.slice(0, Math.min(ranked.length, this.cfg.race?.continueTop ?? X_CONTINUE_TOP)).map((e) => e.structure).sort((a, b) => a - b);
      else surv = raceSurvivors(entries, { eta: this.raceEta(), perClass: 2, terciles: !!this.lad });
      this.raceRounds.push({ budgetPerStructure: P.budgetPer, survivors: surv.map((s) => this.structureOf(s).id) });
      // improvement of the best record (tier X "continue" stopping rule), compared under the current key
      const bestNow = ranked[0] ? (this.raceTrack?.get(ranked[0].structure)?.best ?? null) : null;
      const bestOld = P.bestId === null ? null : this.recById(P.bestId);
      if (bestNow && (!bestOld || compareKeys(this.goals.stageKey(0, bestNow), this.goals.stageKey(0, bestOld)) < 0)) {
        P.bestId = this.pin(bestNow);
        P.stale = 0;
      } else P.stale++;
      // next round: carry live instances of survivors
      const nextInst: (CmaEs | null)[] = surv.map((s) => {
        const i = P.alive.indexOf(s);
        const es = i >= 0 ? inst[i]! : null;
        return es && !es.stopReason ? es : null;
      });
      const planned = this.raceRoundsPlanned();
      const continueTop = this.cfg.race?.continueTop ?? (this.tier === 'X' ? X_CONTINUE_TOP : 0);
      let next = false;
      // halving needs more than η structures: with η or fewer (or one survivor) the race ends here and its unused EU
      // rolls forward to P3 (README v2)
      if (surv.length <= 1 || (P.alive.length <= this.raceEta() && P.continueRound === 0 && this.tier !== 'X')) next = false;
      else if (P.round < planned && P.continueRound === 0) {
        P.round++;
        next = true;
      } else if (continueTop > 0 && P.stale < 2) {
        P.continueRound++;
        P.round++;
        next = true;
      }
      const lastBudget = P.budgetPer;
      P.alive = surv;
      inst.length = 0;
      inst.push(...nextInst);
      if (next) {
        if (P.continueRound > 0) {
          const keep = ranked.slice(0, Math.min(ranked.length, continueTop)).map((e) => e.structure);
          const top = keep.sort((a, b) => a - b);
          const topInst = top.map((s) => {
            const i = surv.indexOf(s);
            return i >= 0 ? inst[i]! : null;
          });
          P.alive = top;
          inst.length = 0;
          inst.push(...topInst);
        }
        P.budgetPer = this.raceBudgetFor(P.round, P.alive.length, P.continueRound, lastBudget);
        P.used = P.alive.map(() => 0);
        P.reqs = P.alive.map(() => 0);
        P.roundStarted = false;
        const minLam = Math.min(...P.alive.map((s) => this.lambdaFor(Math.max(1, this.structureOf(s).dim))));
        if (P.budgetPer < 1 || (P.continueRound > 0 && P.budgetPer < minLam)) {
          P.step = 'done';
        }
      } else P.step = 'done';
      this.tick('S1', true);
      this.progress('S1', null, true);
      if (P.step === 'round') await this.checkpoint(`S1/round${P.round}`, true);
    }
    // survivors and their best records (stage-1 key order)
    this.survivors = P.alive.slice().sort((a, b) => a - b);
    const bests = this.survivors.flatMap((s) => {
      const b = this.raceTrack?.get(s)?.best;
      return b ? [b] : [];
    });
    this.survivorBest = bests.sort((a, b) => compareKeys(this.goals.stageKey(0, a), this.goals.stageKey(0, b)) || a.id - b.id);
    this.raceTrack = null;
    this.snapPhase = null;
  }

  /** One race round: probes for structures below one generation, interleaved CMA-ES generations for the rest. */
  private async raceRound(P: RaceData, inst: (CmaEs | null)[]): Promise<void> {
    const stage = 'S1';
    const K1 = (r: EvalRecord) => this.goals.stageKey(0, r);
    if (!P.roundStarted) {
      P.roundStarted = true;
      // structures whose round budget is below one generation get probes (round 1: done by the screening)
      if (P.round > 1) {
        const props: Proposal[] = [];
        const owner: number[] = [];
        P.alive.forEach((s, i) => {
          const st = this.structureOf(s);
          if (st.dim === 0 || inst[i]) return;
          const left = Math.floor(P.budgetPer - P.used[i]!);
          if (left >= this.lambdaFor(st.dim) || left < 1) return;
          const best = this.raceTrack?.get(s)?.best;
          const center = best ? best.x : this.x0Of(s);
          const rs = this.rng.fork(`race/${st.id}/${P.round}`).fork('probe');
          for (let m = 0; m < left; m++) {
            const x = new Float64Array(st.dim);
            for (let j = 0; j < st.dim; j++) x[j] = Math.min(1, Math.max(0, center[j]! + RACE_SIGMA0 * rs.normal()));
            props.push({ structure: s, x, box: 0, draw: -1 });
            owner.push(i);
          }
        });
        const n = Math.max(0, Math.min(props.length, this.remaining()));
        if (n && !this.aborted) {
          const recs = await this.evaluate(props.slice(0, n), stage);
          recs.forEach((r, j) => {
            this.ingest(r);
            P.used[owner[j]!] = P.used[owner[j]!]! + this.lastCost[j]!;
            P.reqs[owner[j]!] = P.reqs[owner[j]!]! + 1;
          });
        }
      }
      // new warm instances (σ₀ 0.25 from the structure's best) where a generation fits
      P.alive.forEach((s, i) => {
        const st = this.structureOf(s);
        if (st.dim === 0 || inst[i]) return;
        const lam = this.lambdaFor(st.dim);
        if (P.budgetPer - Math.max(P.used[i]!, P.reqs[i]! / 3) < lam) return;
        const best = this.raceTrack?.get(s)?.best;
        inst[i] = new CmaEs(
          { ...this.raceInstanceOpts(s), x0: best ? best.x : this.x0Of(s) },
          this.rng.fork(`race/${st.id}/${P.round}`),
        );
      });
    }
    for (;;) {
      if (this.aborted) return;
      const props: Proposal[] = [];
      const owner: number[] = [];
      const asked: number[] = [];
      let room = Math.max(0, this.cum.race - this.eu);
      P.alive.forEach((_s, i) => {
        const es = inst[i];
        if (!es || es.stopReason) return;
        const lam = es.lambda;
        if (Math.max(P.used[i]!, P.reqs[i]! / 3) + lam > P.budgetPer || room < lam || this.remaining() < lam) return;
        room -= lam;
        const xs = es.ask();
        asked.push(i);
        for (const x of xs) {
          props.push({ structure: P.alive[i]!, x: es.clamp(x), box: es.boxPenalty(x), draw: -1 });
          owner.push(i);
        }
      });
      if (!props.length) return;
      const recs = await this.evaluate(props, stage);
      const keys = new Map<number, Key[]>();
      recs.forEach((r, j) => {
        this.ingest(r);
        const i = owner[j]!;
        P.used[i] = P.used[i]! + this.lastCost[j]!;
        P.reqs[i] = P.reqs[i]! + 1;
        let ks = keys.get(i);
        if (!ks) keys.set(i, (ks = []));
        ks.push(K1(r));
      });
      for (const i of asked) inst[i]!.tell(keys.get(i)!);
      this.tick(stage);
      this.progress(stage, null);
      await this.checkpoint(`S1/round${P.round}`, false);
    }
  }

  /** S2: single-goal anchors for goals 2..K (desirability scales and the feasibility report). */
  async pAnchors(): Promise<void> {
    const ph: AnchorsData & { cur?: { id: number; budget: number; scale: number } } =
      this.takeResume<AnchorsData>() ?? {
        k: 1,
        // the race's unused EU rolls forward to P3 as a whole: the anchors take their ANCHOR_SHARE of it
        end: this.eu + this.B.anchors + Math.floor(ANCHOR_SHARE * Math.max(0, this.cum.race - this.eu)),
        job: null,
      };
    this.snapPhase = () => ({ ...ph, job: this.snapJob ? this.snapJob() : null });
    try {
      while (ph.k < this.K) {
        if (this.aborted) return;
        const k = ph.k;
        this.stage = `S2.${k + 1}`;
        if (this.goals.status(k) === 'metAtBaseline') {
          ph.k++;
          continue;
        }
        if (!ph.cur) {
          const start =
            this.anchorRec[k] ??
            this.bestBy([...this.survivorBest, ...(this.leastInfeasible ? [this.leastInfeasible] : [])], (r) => [r.vS, -r.f[k]!, r.id]);
          if (!start) {
            ph.k++;
            continue;
          }
          let left = 0;
          for (let j = k; j < this.K; j++) if (this.goals.status(j) !== 'metAtBaseline') left++;
          const { a, b } = this.goals.scale(k);
          ph.cur = {
            id: this.pin(start),
            budget: Math.max(0, Math.floor((ph.end - this.eu) / Math.max(1, left))),
            scale: Math.max(Math.abs(a - b), Math.abs(b) * 0.01, 1e-9),
          };
        }
        const cur = ph.cur;
        this.resumeJob = ph.job;
        ph.job = null;
        const start = this.recById(cur.id);
        await this.runCma({
          label: `S2/${k}`,
          structure: start.structure,
          x0: start.x,
          sigma0: this.cfg.sigmaExplore ?? 0.25,
          budget: cur.budget,
          stage: this.stage,
          key: (r) => this.goals.anchorKey(k, r, cur.scale),
        });
        if (this.aborted) return;
        ph.cur = undefined;
        ph.k++;
        this.tick(this.stage, true);
        this.progress(this.stage, null, true);
        if (ph.k < this.K) await this.checkpoint(`S2.${k + 1}`, true);
      }
    } finally {
      this.snapPhase = null;
    }
  }

  /** S3: ε-lexicographic stages on the race survivors with the quantised stage keys (§4.3). */
  async pStages(): Promise<void> {
    let ph = this.takeResume<StagesData>();
    if (!ph) {
      const pool = [...this.survivorBest, ...this.anchorRec.filter((r): r is EvalRecord => !!r), ...this.early];
      const inc = this.bestBy(pool.length ? pool : (this.archive?.all() ?? []), (r) => this.goals.stageKey(0, r));
      ph = { k: 0, incumbentId: inc ? this.pin(inc) : null, starts: null, s: 0, budget: 0, bestIds: [], job: null };
    }
    const P = ph;
    this.snapPhase = () => ({ ...P, starts: P.starts ? P.starts.map((s) => ({ ...s })) : null, bestIds: P.bestIds.slice(), job: this.snapJob ? this.snapJob() : null });
    try {
      while (P.k < this.K) {
        const k = P.k;
        if (this.aborted || P.incumbentId === null) return;
        if (!this.goals.isActive(k)) {
          P.k++;
          continue;
        }
        this.stage = `S3.${k + 1}`;
        const stageKey = (r: EvalRecord) => this.goals.stageKey(k, r);
        const incumbent = this.recById(P.incumbentId);
        if (!P.starts) {
          const pool = [...this.survivorBest, ...this.anchorRec.filter((r): r is EvalRecord => !!r), ...this.incumbents];
          const second = this.bestBy(
            pool.filter((r) => r.structure !== incumbent.structure),
            stageKey,
          );
          P.starts = [
            { id: incumbent.id, sigma: k === 0 ? (this.cfg.sigmaExplore ?? 0.25) : (this.cfg.sigmaWarm ?? 0.1), share: second ? 0.6 : 1 },
          ];
          if (second) P.starts.push({ id: this.pin(second), sigma: this.cfg.sigmaExplore ?? 0.25, share: 0.4 });
          let left = 0;
          for (let j = k; j < this.K; j++) if (this.goals.isActive(j)) left++;
          P.budget = Math.max(0, Math.floor((this.cum.stages - this.eu) / Math.max(1, left)));
          P.s = 0;
          P.bestIds = [incumbent.id];
        }
        while (P.s < P.starts.length) {
          const st = P.starts[P.s]!;
          const rec = this.recById(st.id);
          this.resumeJob = P.job;
          P.job = null;
          const best = await this.runCma({
            label: `S3/${k}/${P.s}`,
            structure: rec.structure,
            x0: rec.x,
            sigma0: st.sigma,
            budget: Math.floor(P.budget * st.share),
            stage: this.stage,
            key: stageKey,
          });
          if (this.aborted) return;
          if (best) P.bestIds.push(this.pin(best));
          P.s++;
        }
        const winner = this.bestBy(P.bestIds.map((i) => this.recById(i)), stageKey)!;
        if (winner.vS === 0) {
          this.goals.setFloorFrom(k, winner.f[k]!);
          this.reofferReserve();
        }
        this.incumbents.push(winner);
        P.incumbentId = this.pin(winner);
        P.starts = null;
        P.k++;
        this.tick(this.stage, true);
        this.progress(this.stage, winner, true);
        if (P.k < this.K) await this.checkpoint(this.stage, true);
      }
    } finally {
      this.snapPhase = null;
    }
  }

  relaxedFeasibleElites(): EvalRecord[] {
    const all = this.archive?.all() ?? [];
    const ok = all.filter((r) => r.vS === 0 && this.goals.priorityFeasible(r.f, true));
    return ok.length ? ok : all;
  }

  /** S4: CMA-ME — 3 improvement emitters (restarted from random relaxed-feasible elites) + 1 structural emitter. */
  async pQd(): Promise<void> {
    this.stage = 'S4';
    const archive = this.archive;
    if (!archive) return;
    let ph = this.takeResume<QdData>();
    const qd = this.rng.fork('S4');
    const sigma = this.cfg.sigmaQd ?? 0.15;
    interface Emitter {
      es: CmaEs;
      structure: number;
      restarts: number;
    }
    const emitterOpts = (structure: number, x0: ArrayLike<number>): CmaesOptions => {
      const s = this.structureOf(structure);
      return {
        x0,
        sigma0: sigma,
        lower: ZEROS(s.dim),
        upper: ONES(s.dim),
        lambda: this.lambdaFor(s.dim),
        covariance: this.covariance,
        discrete: s.discrete,
        tolFun: 1e-3,
        tolX: 1e-7,
      };
    };
    const spawn = (e: number, restart: number): Emitter | null => {
      const stream = qd.fork(`e${e}`);
      // emitters need at least one free gene (structures of dimension 0 are evaluated, never searched). On ladder
      // problems emitters 1 and 2 restart from any safe elite: low-D bins hold plans below goal 1's floor by design, and
      // their elites (best attainment at that effort) are the staircase the rungs are solved from (§1.2)
      const safe = this.lad && e > 0 ? (this.archive?.all() ?? []).filter((r) => r.vS === 0) : [];
      const pool = (safe.length ? safe : this.relaxedFeasibleElites()).filter((r) => this.structureOf(r.structure).dim > 0);
      if (!pool.length) return null;
      const elite = pool[stream.fork(`pick${restart}`).int(pool.length)]!;
      const es = new CmaEs(emitterOpts(elite.structure, elite.x), stream.fork(`r${restart}`));
      return { es, structure: elite.structure, restarts: restart };
    };
    let emitters: (Emitter | null)[];
    if (ph) {
      emitters = ph.emitters.map((e) =>
        e ? { es: CmaEs.fromState(emitterOpts(e.structure, ZEROS(this.structureOf(e.structure).dim)), e.es), structure: e.structure, restarts: e.restarts } : null,
      );
    } else {
      // the priority stages are done: first anytime A/B/C from the archive, then every quarter of the QD budget
      this.emitAlternatives('S4');
      const budget = Math.max(0, this.cum.qd - this.eu - (this.cfg.tradeoffSweep && !this.lad ? 800 : 0));
      const altEvery = Math.max(1, Math.floor(budget / 4));
      ph = { budget, round: 0, used: 0, reqs: 0, nextAlt: altEvery, altEvery, emitters: [] };
      emitters = budget > 0 ? [0, 1, 2].map((e) => spawn(e, 0)) : [];
    }
    const P = ph;
    this.snapPhase = () => ({
      ...P,
      emitters: emitters.map((em) => (em ? { structure: em.structure, restarts: em.restarts, es: em.es.getState() } : null)),
    });
    try {
      if (P.budget <= 0) return;
      const structural = this.problem.mutateStructure ? qd.fork('structural') : null;
      const lambdaS = this.cfg.lambdaQuantum ?? TIER_LAMBDA_QUANTUM[this.tier];
      while (!this.aborted) {
        const props: Proposal[] = [];
        const owner: number[] = [];
        const asked: number[] = [];
        let room = Math.min(P.budget - Math.max(P.used, P.reqs / 3), this.remaining());
        emitters.forEach((em, e) => {
          if (!em || em.es.lambda > room) return;
          room -= em.es.lambda;
          asked.push(e);
          for (const x of em.es.ask()) {
            props.push({ structure: em.structure, x: em.es.clamp(x), box: em.es.boxPenalty(x), draw: -1 });
            owner.push(e);
          }
        });
        if (structural && room >= lambdaS) {
          const rs = structural.fork(`round${P.round}`);
          for (let i = 0; i < lambdaS; i++) {
            const pool = this.relaxedFeasibleElites();
            if (!pool.length) break;
            const elite = pool[rs.int(pool.length)]!;
            const to = this.problem.mutateStructure!(elite.structure, rs);
            if (to === null || to < 0 || to >= this.problem.structures.length) continue;
            const dim = this.structureOf(to).dim;
            const base = this.problem.transferGenome
              ? this.problem.transferGenome(elite.structure, to, elite.x)
              : dim === elite.x.length
                ? elite.x
                : this.x0Of(to);
            const x = new Float64Array(dim);
            for (let j = 0; j < dim; j++) x[j] = Math.min(1, Math.max(0, (base[j] ?? 0.5) + 0.05 * rs.normal()));
            props.push({ structure: to, x, box: 0, draw: -1 });
            owner.push(-1);
          }
        }
        if (!asked.length && !props.length) break;
        if (!asked.length && emitters.some((em) => em)) {
          // no emitter fits the remaining budget: discard the structural proposals too (stage done)
          break;
        }
        const eu0 = this.eu;
        const recs = await this.evaluate(props, 'S4');
        P.used += this.eu - eu0;
        P.reqs += recs.length;
        const status = recs.map((r) => this.ingest(r)!);
        for (const e of asked) {
          const em = emitters[e]!;
          const keys: Key[] = [];
          let improved = false;
          recs.forEach((r, i) => {
            if (owner[i] !== e) return;
            const st = status[i]!;
            if (st.status !== 'rejected') improved = true;
            const k = [...emitterRankKey(st, archive.key(r))];
            k[k.length - 1] = k[k.length - 1]! + this.goals.boxWeight * r.box;
            keys.push(k);
          });
          em.es.tell(keys);
          if (!improved || em.es.stopReason) emitters[e] = spawn(e, em.restarts + 1);
        }
        this.tick('S4');
        if (P.used >= P.nextAlt) {
          P.nextAlt += P.altEvery;
          this.emitAlternatives('S4');
          if (this.lad) this.progress('S4', this.hardIncumbent(), true);
        } else this.progress('S4', this.lad ? this.hardIncumbent() : (this.incumbents[this.incumbents.length - 1] ?? null));
        if (!props.length) break;
        P.round++;
        await this.checkpoint('S4', false);
      }
    } finally {
      this.snapPhase = null;
    }
  }

  // ---- S4.ladder (P5) ----

  /** Hard candidates: the pool ordered by the Hard key with strict floors (deduplicated genomes). */
  private hardCandidates(n: number): EvalRecord[] {
    const pool = this.selectionPool();
    const keyed = pool.map((r) => ({ r, k: this.hardKeyOf(r) }));
    keyed.sort((a, b) => compareKeys(a.k, b.k) || a.r.id - b.r.id);
    const out: EvalRecord[] = [];
    const seen = new Set<string>();
    // a pinned Hard (hybrid) is always the first candidate when it is safe
    if (this.pinnedHard && this.pinnedHard.vS === 0 && n > 0) {
      out.push(this.pinnedHard);
      seen.add(this.cacheKey(this.pinnedHard));
    }
    for (const { r } of keyed) {
      if (out.length >= n) break;
      const key = this.cacheKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  /** Lowest-D staircase point meeting thr₁, else the closest one (warm start of a rung solve). */
  private stairWarm(stair: readonly StairPoint<EvalRecord>[], thr1: number, fallback: EvalRecord): EvalRecord {
    for (const p of stair) if (p.d1 >= thr1) return p.item;
    return stair.length ? stair[stair.length - 1]!.item : fallback;
  }

  /** Best candidates of a rung under its ladder key: the solve's best, the warm start and the archive elites. */
  private rungCandidates(thr: Float64Array, extra: readonly (EvalRecord | null)[]): EvalRecord[] {
    const key = (r: EvalRecord) => this.goals.ladderKey(r, thr, this.D(r), this.qD);
    const pool: EvalRecord[] = [];
    const seen = new Set<number>();
    for (const r of [...extra, ...(this.archive?.all() ?? [])]) {
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      if (r.vS !== 0 || ladderViolation(this.goals.desirability(r.f), thr) > 1e-9) continue;
      pool.push(r);
    }
    pool.sort((a, b) => compareKeys(key(a), key(b)) || a.id - b.id);
    // up to 3 candidates of distinct genomes (fallbacks when the first fails validation or the chance constraint)
    const out: EvalRecord[] = [];
    const keys = new Set<string>();
    for (const r of pool) {
      if (out.length >= 3) break;
      const ck = this.cacheKey(r);
      if (keys.has(ck)) continue;
      keys.add(ck);
      out.push(r);
    }
    return out;
  }

  /** S4.ladder: Easy and Medium ε-constraint solves on the ladder key (§1.3), warm-started from the staircase. */
  async pLadder(): Promise<void> {
    const L = this.lad;
    if (!L) return;
    this.stage = 'S4';
    const resumed = this.takeResume<LadderData>();
    if (resumed) this.resumeJob = resumed.job;
    if (!this.ladderState) {
      const hard = this.hardCandidates(1)[0] ?? null;
      const dH = hard ? this.goals.desirability(hard.f) : null;
      this.ladderState = {
        step: 'start',
        budget: Math.max(0, this.cum.ladder - this.eu),
        hard,
        gH: dH ? dH[0]! : NaN,
        DH: hard ? this.D(hard) : NaN,
        gMin: gMinDesirability(this.goals, L.gMinMetric),
        easy: null,
        medium: null,
        collapsed: [],
      };
    }
    const ls = this.ladderState;
    this.snapPhase = () => ({ ...this.ladderData(ls, (r) => (r ? this.pin(r) : null)), job: this.snapJob ? this.snapJob() : null });
    try {
      const hard = ls.hard;
      if (ls.step === 'start') {
        // stopped before the ladder solve: nothing about the rungs is proven by this run's provisional Hard (the final
        // Hard is picked later); finish() re-checks the carried rungs and marks the rest 'stopped'
        if (this.aborted) ls.step = 'done';
        else if (!hard || hard.vS !== 0) {
          ls.collapsed.push({ rung: 'medium', reason: 'infeasible', detail: { hardSafe: 0 } }, { rung: 'easy', reason: 'infeasible', detail: { hardSafe: 0 } });
          ls.step = 'done';
        } else if (!(ls.gH >= ls.gMin) || !(ls.gH > 0)) {
          // Hard itself is below the minimal meaningful change: Easy = Hard (§1.3 collapse)
          const detail = { gHard: ls.gH, gMin: ls.gMin };
          ls.collapsed.push({ rung: 'medium', reason: 'belowMinimal', detail }, { rung: 'easy', reason: 'belowMinimal', detail: { ...detail } });
          ls.step = 'done';
        } else ls.step = 'easy';
      }
      const dH = hard ? this.goals.desirability(hard.f) : new Float64Array(this.K);
      if (ls.step === 'easy' && hard) {
        if (!ls.easy) {
          const thr = rungThresholds(this.goals, dH, Math.max(L.easyShare * ls.gH, ls.gMin), LADDER_DEFAULTS.rhoEasy);
          const warm = this.stairWarm(this.staircasePoints(), thr[0]!, hard);
          ls.easy = { thr, warm: warm, cands: [] };
        }
        const w = ls.easy;
        const budget = Math.floor(ls.budget / 2);
        const best = await this.runCma({
          label: 'S4L/easy',
          structure: w.warm!.structure,
          x0: w.warm!.x,
          sigma0: RUNG_SIGMA0,
          budget,
          stage: 'S4.ladder',
          key: (r) => this.goals.ladderKey(r, w.thr, this.D(r), this.qD),
        });
        if (this.aborted) return;
        w.cands = this.rungCandidates(w.thr, [best, w.warm]);
        if (!w.cands.length) ls.collapsed.push({ rung: 'easy', reason: 'infeasible', detail: { thr1: w.thr[0]! } });
        ls.step = 'medium';
        this.tick('S4.ladder', true);
        this.progress('S4', hard, true);
        await this.checkpoint('S4.ladder/easy', true);
      }
      if (ls.step === 'medium' && hard) {
        const E = ls.easy?.cands[0] ?? null;
        if (!E) {
          if (!ls.collapsed.some((c) => c.rung === 'medium'))
            ls.collapsed.push({ rung: 'medium', reason: 'infeasible', detail: { easyFound: 0 } });
          ls.step = 'done';
        } else if (!ls.medium) {
          const DE = this.D(E);
          const gE = this.goals.dRaw(0, E.f[0]!);
          const roomD = Math.max(L.minDGap, 2 * L.mediumMinDGap);
          if (ls.DH - DE < roomD) {
            // no room for a distinct middle rung (§12.8: Medium's own gap on both sides; the Hard-Easy check reports the details)
            ls.collapsed.push({ rung: 'medium', reason: 'tooClose', detail: { dGap: ls.DH - DE, minDGap: roomD, dHard: ls.DH, dEasy: DE, gShare: ls.gH > 1e-12 ? gE / ls.gH : NaN } });
            ls.step = 'done';
          } else {
            const stair = this.staircasePoints();
            const knee = kneeOf(stair, { D: DE, d1: gE }, { D: ls.DH, d1: ls.gH });
            let thr1: number;
            let warm: EvalRecord;
            if (knee && knee.distance >= LADDER_DEFAULTS.kneeMin) {
              const kp = stair[knee.index]!;
              thr1 = Math.max(kp.d1, ls.gMin);
              warm = kp.item;
            } else {
              thr1 = Math.max(L.mediumShare * ls.gH, ls.gMin);
              warm = this.stairWarm(stair, thr1, hard);
            }
            ls.medium = { thr: rungThresholds(this.goals, dH, thr1, LADDER_DEFAULTS.rhoMedium), warm, cands: [] };
          }
        }
        if (ls.step === 'medium' && ls.medium) {
          const w = ls.medium;
          const best = await this.runCma({
            label: 'S4L/medium',
            structure: w.warm!.structure,
            x0: w.warm!.x,
            sigma0: RUNG_SIGMA0,
            budget: Math.max(0, this.cum.ladder - this.eu),
            stage: 'S4.ladder',
            key: (r) => this.goals.ladderKey(r, w.thr, this.D(r), this.qD),
          });
          if (this.aborted) return;
          w.cands = this.rungCandidates(w.thr, [best, w.warm]);
          if (!w.cands.length) ls.collapsed.push({ rung: 'medium', reason: 'infeasible', detail: { thr1: w.thr[0]! } });
          ls.step = 'done';
          this.tick('S4.ladder', true);
          this.progress('S4', hard, true);
        }
      }
    } finally {
      this.snapPhase = null;
    }
  }

  // ---- S5: finalists, ensembles, validator, holdout ----

  /** Friendly rounding + verification (§4.9); pattern search on the grid (≤ 30 EU) if rounding breaks a constraint. */
  async roundAndVerify(r: EvalRecord, ok: (q: EvalRecord) => boolean, key: (q: EvalRecord) => Key): Promise<{ rec: EvalRecord; rounded: boolean }> {
    const round = this.problem.roundGenome;
    if (!round || this.remaining() < 1) return { rec: r, rounded: false };
    const x = round.call(this.problem, r.structure, r.x);
    let [cur] = await this.evaluate([{ structure: r.structure, x, box: 0, draw: -1 }], 'S5');
    this.ingest(cur!);
    if (ok(cur!)) return { rec: cur!, rounded: true };
    const step = this.problem.gridStep?.(r.structure);
    if (step) {
      let spent = 0;
      let improved = true;
      while (improved && spent < 30 && !this.aborted && this.remaining() >= 1) {
        improved = false;
        for (let j = 0; j < x.length && spent < 30 && this.remaining() >= 1; j++) {
          for (const dir of [1, -1]) {
            const y = Float64Array.from(cur!.x);
            y[j] = Math.min(1, Math.max(0, y[j]! + dir * (step[j] ?? 0)));
            if (y[j] === cur!.x[j]) continue;
            const [cand] = await this.evaluate([{ structure: r.structure, x: y, box: 0, draw: -1 }], 'S5');
            spent++;
            this.ingest(cand!);
            if (compareKeys(key(cand!), key(cur!)) < 0) {
              cur = cand;
              improved = true;
              break;
            }
          }
        }
        if (ok(cur!)) return { rec: cur!, rounded: true };
      }
    }
    return { rec: r, rounded: false };
  }

  /** Constraint a finalist of this role must keep (safe and its floors / rung constraints). */
  private roleOk(f: Fin, strict: boolean): (q: EvalRecord) => boolean {
    if (f.thr) {
      const thr = f.thr;
      return (q) => q.vS === 0 && ladderViolation(this.goals.desirability(q.f), thr) <= 1e-9;
    }
    return (q) => q.vS === 0 && this.goals.priorityFeasible(q.f, !strict);
  }

  /** Nominal key of a finalist's role, optionally with tightened margins (chance-constraint re-polish). */
  private roleKey(f: Fin, strict: boolean, tighten?: Float64Array): (q: EvalRecord) => Key {
    const vS = (q: EvalRecord) => (tighten ? violation(q.out.margins, tighten) : q.vS);
    if (f.thr) {
      const thr = f.thr;
      return (q) => {
        const k = [...this.goals.ladderKey(q, thr, this.D(q), this.qD)];
        k[0] = vS(q);
        return k;
      };
    }
    return (q) => {
      const k = [...this.hardKeyOf(q, !strict)];
      k[0] = vS(q);
      return k;
    };
  }

  /** Evaluate selection draws f.outs.length..to−1 for every finalist (one batch) and refresh their summaries. */
  private async selectionDraws(fins: readonly Fin[], to: number): Promise<void> {
    const props: Proposal[] = [];
    const owner: number[] = [];
    fins.forEach((f, i) => {
      for (let m = f.outs.length; m < to; m++) {
        props.push({ structure: f.rec.structure, x: f.rec.x, box: 0, draw: m });
        owner.push(i);
      }
    });
    if (!props.length) return;
    const recs = await this.evaluate(props, 'S5');
    recs.forEach((q, j) => fins[owner[j]!]!.outs.push(q.out));
    for (const f of fins) f.sel = robustSummary(f.outs, this.goals, { mode: this.cfg.robustMode });
  }

  /**
   * Chance-constraint repair (§4.15 policy 2): tighten the internal bound by the observed P50−P10 margin gap
   * (× CHANCE_TIGHTEN_FACTOR) and re-polish, ≤ 2 iterations × ≤ 150 EU; the polished plan replaces the finalist only
   * when it is chance-feasible on the same `draws`. Safety outranks explanations, so this may use the S6 share.
   */
  private async chanceRepair(f: Fin, draws: number, strict: boolean): Promise<void> {
    if (!f.sel || f.sel.chanceFeasible) return;
    let tighten: Float64Array | null = Float64Array.from(f.sel.tightening, (g) => CHANCE_TIGHTEN_FACTOR * g);
    for (let it = 0; it < 2 && tighten && !this.aborted; it++) {
      const polishBudget = Math.min(150, this.remaining() - draws - this.holdReserve - this.compReserve);
      if (polishBudget < 3 * this.lambdaFor(this.structureOf(f.rec.structure).dim)) break;
      const t: Float64Array = tighten;
      const best = await this.runCma({
        label: `S5/polish/${f.rec.id}/${it}`,
        structure: f.rec.structure,
        x0: f.rec.x,
        sigma0: 0.05,
        budget: polishBudget,
        stage: 'S5',
        key: this.roleKey(f, strict, t),
        ipop: false,
        checkpoint: false,
      });
      if (!best) break;
      const cand: Fin = { ...f, rec: best, outs: [], sel: null, hold: null };
      await this.selectionDraws([cand], draws);
      const rob = cand.sel!;
      if (rob.chanceFeasible && best.vS === 0) {
        f.rec = best;
        f.outs = cand.outs;
        f.sel = rob;
        tighten = null;
      } else tighten = Float64Array.from(t, (v, c) => v + CHANCE_TIGHTEN_FACTOR * rob.tightening[c]!);
    }
  }

  /** EU kept for the holdout ensemble of the chosen options while S5 polishes and completes draws. */
  private holdReserve = 0;
  /** EU kept for completing the chosen options to M_s draws while the first-pass repairs run (OCBA). */
  private compReserve = 0;
  private validCache = new Map<number, boolean>();
  private valid(f: Fin): boolean {
    return this.validRec(f.rec);
  }
  private validRec(r: EvalRecord): boolean {
    let v = this.validCache.get(r.id);
    if (v === undefined) {
      v = !this.problem.validate || this.problem.validate(r.structure, r.x).ok;
      this.validCache.set(r.id, v);
    }
    return v;
  }

  /** Robust (selection) desirability of a finalist, nominal without an ensemble. */
  private dOf(f: Fin): Float64Array {
    return f.sel ? f.sel.robustD : this.goals.desirability(f.rec.f);
  }
  private chanceOk(f: Fin): boolean {
    return f.rec.vS === 0 && (!f.sel || f.sel.chanceFeasible);
  }
  private robustG(f: Fin): number {
    return this.goals.utilityD(this.dOf(f), 0);
  }
  /** Robust Hard key: (chance violation, v_L on the robust d̃, −⌊G/q_G⌋, ⌊D/q_D⌋, R, −G). */
  private robustHardKey(f: Fin, relaxed: boolean): Key {
    const d = this.dOf(f);
    const g = this.goals.utilityD(d, 0);
    const k: number[] = [f.sel ? f.sel.chanceViolation : 0, this.goals.floorViolationD(d, this.K, relaxed), -quantLevel(g, this.goals.goalQuantum())];
    if (this.lad) k.push(quantLevel(this.D(f.rec), this.qD));
    k.push(f.rec.reg + this.goals.boxWeight * f.rec.box, -g);
    return k;
  }

  /** Ladder pick: Hard = best validated chance-feasible Hard finalist (robust Hard key); rungs = first passing candidate. */
  private pickLadder(fins: readonly Fin[]): { hard: Fin | null; medium: Fin | null; easy: Fin | null; relaxed: boolean } {
    const ok = (f: Fin) => this.chanceOk(f) && this.valid(f);
    const hards = fins.filter((f) => f.role === 'hard' && ok(f));
    let hard: Fin | null = null;
    for (const f of hards) if (!hard || compareKeys(this.robustHardKey(f, false), this.robustHardKey(hard, false)) < 0) hard = f;
    // hybrid: the pinned Hard wins when it is safe here; a caller that already validated and chance-checked it (v1 on
    // its own ensemble and validator) is trusted — this run's short robust stage cannot overrule it (measured: it then
    // returned void plans in 7 of 240 held-out full requests)
    const pinOk = (f: Fin) => f.rec.vS === 0 && (this.lad?.pinHard?.chanceChecked === true || (this.valid(f) && this.chanceOk(f)));
    const pinned = this.pinnedHard ? fins.find((f) => f.role === 'hard' && (f.rec === this.pinnedHard || f.rec.structure === this.pinnedHard!.structure && this.cacheKey({ ...f.rec, draw: -1 }) === this.cacheKey({ ...this.pinnedHard!, draw: -1 })) && pinOk(f)) : undefined;
    // a stopped run: the previous search's Hard (weighed in `finish`) keeps its place when it outranks the pinned one — v1
    // was stopped too, so its option A may be a barely searched plan ("Stop here" keeps the plans found so far, §12.1)
    const carriedWins = this.aborted && !!hard && hard.prov === 'carried' && !!pinned && compareKeys(this.robustHardKey(hard, false), this.robustHardKey(pinned, false)) < 0;
    if (pinned && !carriedWins) hard = pinned;
    const rung = (role: FinRole) =>
      fins.find((f) => f.role === role && ok(f) && ladderViolation(this.goals.desirability(f.rec.f), f.thr!) <= 1e-9) ?? null;
    const relaxed = !!hard && !this.goals.priorityFeasibleD(this.dOf(hard), true);
    return { hard, medium: hard ? rung('medium') : null, easy: hard ? rung('easy') : null, relaxed };
  }

  /** MMR pick (no ladder): §4.12 selection on the robust (selection) desirability. */
  private pickMmr(fins: readonly Fin[]): { chosen: Array<{ fin: Fin; dist: number }>; shortfall: PlannerResult<S>['shortfall']; relaxed: boolean } {
    const validated = fins.filter((f) => this.valid(f));
    const cands: SelectionCandidate[] = validated.map((f) => {
      const d = this.dOf(f);
      return {
        utility: f.sel ? f.sel.robustUtility : this.goals.utility(f.rec.f, f.rec.reg),
        goalScore: this.goals.utilityD(d, 0),
        safe: this.chanceOk(f),
        strictFeasible: this.goals.priorityFeasibleD(d, false),
        relaxedFeasible: this.goals.priorityFeasibleD(d, true),
        floorViolation: this.goals.floorViolationD(d, this.K, false),
      };
    });
    const sel = selectAlternatives(cands, this.distanceFn(validated.map((f) => f.rec)), {
      count: this.cfg.optionCount ?? 3,
      lambda: this.cfg.mmrLambda,
      scoreStep: this.goals.goalQuantum(),
      dMin: this.cfg.dMin,
    });
    return { chosen: sel.chosen.map((i, n) => ({ fin: validated[i]!, dist: sel.distances[n]! })), shortfall: sel.shortfall, relaxed: sel.fallback };
  }

  /** Finalists practically tied with a chosen Hard / option A: within one goal-score quantum of it (OCBA contenders). */
  private tiedWith(lead: Fin, fins: readonly Fin[]): Fin[] {
    const q = this.goals.goalQuantum();
    const gl = quantLevel(this.robustG(lead), q);
    return fins.filter(
      (f) => f !== lead && (f.role === 'hard' || f.role === 'option') && this.chanceOk(f) && Math.abs(quantLevel(this.robustG(f), q) - gl) <= 1,
    );
  }

  /**
   * Holdout summary (reported numbers) of the chosen finalists: members 0..M−1 with M = M_h, or what the remaining budget
   * pays for when an earlier stage overran (never below min(M_h, 4) draws; then the selection summary is reported).
   */
  private async holdout(fins: readonly Fin[]): Promise<void> {
    if (this.Mh <= 0 || this.aborted) return;
    const todo = fins.filter((f) => !f.hold);
    if (!todo.length) return;
    const M = Math.min(this.Mh, Math.floor(Math.max(0, this.remaining()) / todo.length));
    if (M < Math.min(this.Mh, 4)) return;
    const props: Proposal[] = [];
    for (const f of todo) for (let m = 0; m < M; m++) props.push({ structure: f.rec.structure, x: f.rec.x, box: 0, draw: HOLDOUT_DRAW_OFFSET + m });
    const recs = await this.evaluate(props, 'S5');
    todo.forEach((f, i) => {
      f.hold = robustSummary(recs.slice(i * M, (i + 1) * M).map((q) => q.out), this.goals, { mode: this.cfg.robustMode });
    });
  }

  /**
   * Medium band search (PLN-06). Runs in S5 when the final distinctness check dropped Medium while Hard and Easy stand:
   * a short CMA-ES search restricted to the band [max(D_E + gapM, D_E + edge·span), min(D_H − gapM, D_H − edge·span)] (§12.8),
   * started from the best archive plans of other structures than Hard's and Easy's, on a key that asks for the band,
   * the Medium rung constraints and Gower ≥ Medium's threshold (`mediumMargins`) to Hard and to Easy (then goal 1, capped at Hard's). Up to
   * `MEDIUM_BAND.candidates` passing plans are rounded, given the selection ensemble and the chance repair, and the
   * first one that is valid, chance-feasible and passes `distinct` (the ladder's own check) is returned. Its EU comes on
   * top of the run's total; when nothing is accepted, the EU it spent is granted back so the rest of S5 is unchanged.
   */
  private async mediumBand(H: Fin, E: Fin, distinct: (m: Fin) => boolean): Promise<{ fin: Fin | null; report: MediumBandReport }> {
    const L = this.lad!;
    const DH = this.D(H.rec);
    const DE = this.D(E.rec);
    const span = DH - DE;
    // §12.8: Medium's own effort gap to each neighbour (the band stays inside the middle half of the span)
    const lo = Math.max(DE + L.mediumMinDGap, DE + MEDIUM_BAND.edge * span);
    const hi = Math.min(DH - L.mediumMinDGap, DH - MEDIUM_BAND.edge * span);
    const d1H = this.goals.dRaw(0, H.rec.f[0]!);
    const d1E = this.goals.dRaw(0, E.rec.f[0]!);
    const report: MediumBandReport = { lo, hi, eu: 0, grantEU: 0, d1Hard: d1H, d1Easy: d1E, passing: 0, tried: 0, accepted: false, dropped: null, best: null };
    if (!(hi >= lo) || !this.archive) return { fin: null, report };
    const eu0 = this.eu;
    const extra0 = this.extraEU;
    const R0 = Math.max(0, this.remaining());
    // batch 02: never below the Easy search's budget (the hybrid's ladder share left it ≈ 70 EU at tier S)
    const searchEU = Math.max(0, Math.floor(MEDIUM_BAND.share * this.B.ladder), easySearchBudget(this.tier, this.B.total));
    // the pot: search, rounding (≤ 30 EU each), ensembles and two repair polishes per candidate
    this.extraEU += searchEU + MEDIUM_BAND.candidates * (30 + this.Ms + 300);
    // goal constraints: at least Easy's goal 1 (order) and the Medium share of Hard on the other goals
    const dHard = this.goals.desirability(H.rec.f);
    const gMin = this.ladderState?.gMin ?? gMinDesirability(this.goals, L.gMinMetric);
    const thr = rungThresholds(this.goals, dHard, Math.max(d1E, gMin), LADDER_DEFAULTS.rhoMedium);
    // Gower to Hard / Easy over the archive's ranges (the final check's ranges)
    const arch = this.archive.all();
    const custom = this.problem.distance;
    let gw: (a: EvalRecord, b: EvalRecord) => number;
    if (custom) {
      const view = (r: EvalRecord): CandidateView => ({ structure: r.structure, x: r.x, output: r.out });
      gw = (a, b) => custom.call(this.problem, view(a), view(b));
    } else {
      const fe = (r: EvalRecord) => r.out.features ?? r.out.descriptors;
      const dims = fe(H.rec).length;
      const schema: readonly FeatureSpec[] = this.problem.featureSchema ?? Array.from({ length: dims }, () => ({ kind: 'numeric' as const }));
      const ranges = featureRanges([H.rec, E.rec, ...arch].map(fe), dims);
      gw = (a, b) => gowerDistance(fe(a), fe(b), schema, ranges);
    }
    // margin inside the band so friendly rounding does not push a plan out of it (batch 02: qD/2 → qD)
    const m = Math.min(this.qD, (hi - lo) / 4);
    // §12.8: Medium's plan-distance threshold scales with Hard-Easy's distance
    const minGowerM = mediumMargins(gw(H.rec, E.rec), L).minGower;
    const gTarget = minGowerM + MEDIUM_BAND.gowerMargin;
    const info = new Map<number, { D: number; d1: number; gh: number; ge: number; key: Key }>();
    const infoOf = (r: EvalRecord) => {
      let v = info.get(r.id);
      if (v) return v;
      const D = this.D(r);
      const d = this.goals.desirability(r.f);
      const gh = gw(r, H.rec);
      const ge = gw(r, E.rec);
      const viol = Math.max(0, lo + m - D, D - (hi - m)) + ladderViolation(d, thr) + Math.max(0, gTarget - Math.min(gh, ge));
      const key: number[] = [r.vS, viol, -this.goals.level(0, Math.min(d[0]!, dHard[0]!)), -Math.min(gh, ge)];
      for (let k = 1; k < this.K; k++) key.push(-this.goals.level(k, d[k]!));
      key.push(r.reg + this.goals.boxWeight * r.box);
      v = { D, d1: this.goals.dRaw(0, r.f[0]!), gh, ge, key };
      info.set(r.id, v);
      return v;
    };
    const seen: EvalRecord[] = [];
    const key = (r: EvalRecord): Key => {
      if (!info.has(r.id)) seen.push(r);
      return infoOf(r).key;
    };
    const byKey = (a: EvalRecord, b: EvalRecord) => compareKeys(infoOf(a).key, infoOf(b).key) || a.id - b.id;
    // warm starts: the best safe plan per structure; first a structure that is neither Hard's nor Easy's
    const ls = this.ladderState;
    const startPool = [...arch, ...(ls?.medium?.cands ?? []), ...(ls?.easy?.cands ?? [])].filter((r) => r.vS === 0 && r.draw === -1);
    for (const r of startPool) key(r);
    const bestOf = new Map<number, EvalRecord>();
    for (const r of [...startPool].sort(byKey)) if (!bestOf.has(r.structure)) bestOf.set(r.structure, r);
    const ranked = [...bestOf.values()].filter((r) => this.structureOf(r.structure).dim > 0);
    const starts: EvalRecord[] = [];
    const other = ranked.find((r) => r.structure !== H.rec.structure && r.structure !== E.rec.structure);
    if (other) starts.push(other);
    for (const r of ranked) if (starts.length < MEDIUM_BAND.starts && !starts.includes(r)) starts.push(r);
    for (let i = 0; i < starts.length && !this.aborted; i++) {
      const st = starts[i]!;
      await this.runCma({
        label: `S5/mediumBand/${i}`,
        structure: st.structure,
        x0: st.x,
        sigma0: MEDIUM_BAND.sigma0,
        budget: Math.floor(searchEU / starts.length),
        stage: 'S5.band',
        key,
        checkpoint: false,
      });
    }
    // candidates: every plan seen that passes the pre-checks, best first, distinct genomes, validated
    const pool: EvalRecord[] = [];
    const keys = new Set<string>();
    for (const r of [...startPool, ...seen].sort(byKey)) {
      const v = infoOf(r);
      if (r.vS !== 0 || r.draw !== -1 || v.D < lo || v.D > hi || Math.min(v.gh, v.ge) < minGowerM || v.d1 > d1H + 1e-9) continue;
      if (ladderViolation(this.goals.desirability(r.f), thr) > 1e-9) continue;
      const ck = this.cacheKey(r);
      if (keys.has(ck)) continue;
      keys.add(ck);
      pool.push(r);
    }
    const best = [...startPool, ...seen].filter((r) => r.vS === 0).sort(byKey)[0];
    if (best) {
      const v = infoOf(best);
      report.best = { D: v.D, d1: v.d1, gowerHard: v.gh, gowerEasy: v.ge, rungViolation: ladderViolation(this.goals.desirability(best.f), thr) };
    }
    const cands: EvalRecord[] = [];
    for (const r of pool.slice(0, MEDIUM_BAND.validateTop)) {
      if (cands.length >= MEDIUM_BAND.candidates) break;
      if (!this.problem.validate || this.problem.validate(r.structure, r.x).ok) cands.push(r);
    }
    report.passing = pool.length;
    let fin: Fin | null = null;
    const draws = Math.min(this.Ms, H.outs.length);
    for (const r of cands) {
      if (this.aborted) break;
      report.tried++;
      const f: Fin = { role: 'medium', rec: r, rounded: false, outs: [], sel: null, hold: null, thr };
      const rv = await this.roundAndVerify(r, this.roleOk(f, false), this.roleKey(f, false));
      f.rec = rv.rec;
      f.rounded = rv.rounded;
      if (draws > 0) {
        await this.selectionDraws([f], draws);
        await this.chanceRepair(f, draws, false);
      }
      if (this.chanceOk(f) && this.valid(f) && ladderViolation(this.goals.desirability(f.rec.f), thr) <= 1e-9 && distinct(f)) {
        fin = f;
        break;
      }
    }
    report.eu = this.eu - eu0;
    report.accepted = !!fin;
    // the band's own EU is granted back; an accepted Medium also gets an option's share of what S5 had left (holdout,
    // ablations), so Hard's and Easy's S5 budgets are what they were without the band
    report.grantEU = report.eu + (fin ? this.Mh + Math.max(0, Math.ceil((R0 - 2 * this.Mh) / 2)) : 0);
    this.extraEU = extra0 + report.grantEU;
    return { fin, report };
  }

  /** Plan distance to `ref` over the archive's feature ranges (fixed when called; the final check's ranges). */
  private gowerTo(ref: EvalRecord): (r: EvalRecord) => number {
    const custom = this.problem.distance;
    const view = (r: EvalRecord): CandidateView => ({ structure: r.structure, x: r.x, output: r.out });
    if (custom) return (r) => custom.call(this.problem, view(r), view(ref));
    const fe = (r: EvalRecord) => r.out.features ?? r.out.descriptors;
    const dims = fe(ref).length;
    const schema: readonly FeatureSpec[] = this.problem.featureSchema ?? Array.from({ length: dims }, () => ({ kind: 'numeric' as const }));
    const ranges = featureRanges([ref, ...(this.archive?.all() ?? [])].map(fe), dims);
    return (r) => gowerDistance(fe(r), fe(ref), schema, ranges);
  }

  /**
   * Re-evaluate a rung of the previous search (§12.1) under this run: same genome, nominal run, then the selection
   * ensemble on the draws Hard has. No polish: it stays the plan the person saw. Null when its structure does not exist
   * here (another request shape).
   */
  private async carriedFin(rung: 'medium' | 'easy', g: { structure: number; x: ArrayLike<number> }, thr: Float64Array, draws: number): Promise<Fin | null> {
    const st = this.problem.structures[g.structure];
    if (!st || st.dim !== g.x.length) return null;
    const x = Float64Array.from(g.x, (v) => Math.min(1, Math.max(0, v)));
    const [rec] = await this.evaluate([{ structure: g.structure, x, box: 0, draw: -1 }], 'S5.carry');
    this.ingest(rec!);
    const f: Fin = { role: rung, rec: rec!, rounded: false, outs: [], sel: null, hold: null, thr, prov: 'carried' };
    if (draws > 0 && rec!.vS === 0) await this.selectionDraws([f], draws);
    return f;
  }

  /**
   * The dedicated Easy search (§12.2): bisection on the intensity of Hard's levers from the habit, then CMA-ES on the
   * ladder key (D first) from the best starts, with the stopping rule of `easyStopRule`. Returns the checked candidates
   * (rounded, selection ensemble, chance repair) best first and the proof points (every nominal plan it saw).
   */
  private async easySearch(H: Fin, thr: Float64Array, extraStarts: readonly (EvalRecord | null)[], draws: number): Promise<{ fins: Fin[]; report: EasySearchReport; points: EvalRecord[] }> {
    const L = this.lad!;
    const eu0 = this.eu;
    const budget = easySearchBudget(this.tier, this.B.total);
    const report: EasySearchReport = { eu: 0, grantEU: 0, starts: 0, stop: 'budget', tried: 0, chosen: false, proof: null };
    // the ladder key with Easy's distinctness from Hard folded into the constraint term (as the Medium band search
    // does): at least the rung effort gap below Hard and a plan distance to it above the minimum with a small margin
    const dMax = this.D(H.rec) - L.minDGap;
    const gTarget = L.minGower + MEDIUM_BAND.gowerMargin;
    const gwH = this.gowerTo(H.rec);
    const keyCache = new Map<number, Key>();
    const key = (r: EvalRecord): Key => {
      let k = keyCache.get(r.id);
      if (!k) {
        const D = this.D(r);
        const lk = [...this.goals.ladderKey(r, thr, D, this.qD)];
        lk[1] = lk[1]! + Math.max(0, D - dMax) + Math.max(0, gTarget - gwH(r));
        k = lk;
        keyCache.set(r.id, k);
      }
      return k;
    };
    const feasible = (r: EvalRecord) => r.vS === 0 && ladderViolation(this.goals.desirability(r.f), thr) <= 1e-9;
    const seen: EvalRecord[] = [];
    const spent = () => this.eu - eu0;
    const evalX = async (structure: number, x: Float64Array): Promise<EvalRecord> => {
      const [r] = await this.evaluate([{ structure, x, box: 0, draw: -1 }], 'S5.easy');
      this.ingest(r!);
      seen.push(r!);
      return r!;
    };
    const starts: EvalRecord[] = [];
    let lowerBound = Infinity;
    // 1. lines from the habit to Hard's levers: the least intensity that meets Easy's constraint
    for (const ln of this.problem.easyStarts?.(H.rec.structure, H.rec.x) ?? []) {
      if (this.aborted || spent() >= budget) break;
      if (this.structureOf(ln.structure).dim !== ln.from.length || ln.to.length !== ln.from.length) continue;
      report.starts++;
      const habit = await evalX(ln.structure, lerpGenome(ln.from, ln.to, 0));
      if (habit.vS === 0) lowerBound = Math.min(lowerBound, this.D(habit));
      const b = await bisectIntensity((a) => evalX(ln.structure, lerpGenome(ln.from, ln.to, a)), feasible);
      if (b) starts.push(b.rec);
    }
    // 2. the best plan of each of the three lowest occupied effort bins of the archive; 3. the carried and own Easy
    const bins = TIER_D_BINS[this.tier];
    const byBin = new Map<number, EvalRecord>();
    for (const r of this.archive?.all() ?? []) {
      if (r.vS !== 0 || r.draw !== -1) continue;
      const b = Math.min(bins - 1, Math.floor(this.D(r) * bins));
      const cur = byBin.get(b);
      if (!cur || compareKeys(key(r), key(cur)) < 0) byBin.set(b, r);
    }
    const low = [...byBin.keys()].sort((p, q) => p - q).slice(0, 3);
    for (const b of low) starts.push(byBin.get(b)!);
    for (const r of extraStarts) if (r && r.draw === -1) starts.push(r);
    report.starts += low.length + extraStarts.filter((r) => r && r.draw === -1).length;
    // CMA-ES from the best starts of distinct structures
    const ranked = [...new Set(starts)].sort((p, q) => compareKeys(key(p), key(q)) || p.id - q.id);
    const cmaFrom: EvalRecord[] = [];
    for (const r of ranked) {
      if (cmaFrom.length >= EASY_SEARCH.cmaStarts) break;
      if (this.structureOf(r.structure).dim > 0 && !cmaFrom.some((q) => q.structure === r.structure)) cmaFrom.push(r);
    }
    // feasible for the stopping rule: Easy's goals and its distinctness from Hard (the key's constraint terms)
    const fullOk = (r: EvalRecord) => {
      const k = key(r);
      return k[0] === 0 && k[1]! <= 1e-9;
    };
    let bestD = Infinity;
    for (const r of [...starts, ...seen]) if (fullOk(r)) bestD = Math.min(bestD, this.D(r));
    for (let i = 0; i < cmaFrom.length && !this.aborted; i++) {
      const left = budget - spent();
      if (left < 2 * this.lambdaFor(this.structureOf(cmaFrom[i]!.structure).dim)) break;
      const rule = easyStopRule(lowerBound);
      let stopped = false;
      await this.runCma({
        label: `S5/easy/${i}`,
        structure: cmaFrom[i]!.structure,
        x0: cmaFrom[i]!.x,
        sigma0: EASY_SEARCH.sigma0,
        budget: Math.floor(left / (cmaFrom.length - i)),
        stage: 'S5.easy',
        key,
        checkpoint: false,
        stop: (recs) => {
          let improved = false;
          for (const r of recs) {
            seen.push(r);
            if (fullOk(r) && this.D(r) < bestD - 1e-12) {
              bestD = this.D(r);
              improved = true;
            }
          }
          stopped = rule.observe(bestD, improved);
          return stopped;
        },
      });
      if (stopped) report.stop = rule.reason ?? 'stall';
      if (rule.reason === 'bound') break;
    }
    if (this.aborted) report.stop = 'aborted';
    // candidates: feasible plans best first, distinct genomes, validated, then rounded and checked on the ensemble
    const pool: EvalRecord[] = [];
    const keys = new Set<string>();
    for (const r of [...new Set([...starts, ...seen])].sort((p, q) => compareKeys(key(p), key(q)) || p.id - q.id)) {
      if (r.draw !== -1 || !feasible(r)) continue;
      const ck = this.cacheKey(r);
      if (keys.has(ck)) continue;
      keys.add(ck);
      pool.push(r);
    }
    const fins: Fin[] = [];
    let validated = 0;
    for (const r of pool) {
      if (fins.length >= EASY_SEARCH.candidates || validated >= EASY_SEARCH.validateTop || this.aborted) break;
      validated++;
      const f: Fin = { role: 'easy', rec: r, rounded: false, outs: [], sel: null, hold: null, thr, prov: 'easySearch' };
      if (!this.valid(f)) {
        fins.push(f);
        continue;
      }
      const rv = await this.roundAndVerify(r, this.roleOk(f, false), this.roleKey(f, false));
      f.rec = rv.rec;
      f.rounded = rv.rounded;
      if (draws > 0) {
        await this.selectionDraws([f], draws);
        await this.chanceRepair(f, draws, false);
      }
      fins.push(f);
    }
    report.tried = fins.length;
    report.eu = this.eu - eu0;
    return { fins, report, points: [...starts, ...seen, ...(this.archive?.all() ?? [])] };
  }

  /**
   * §12.1-12.2 after Hard is final: re-derive Easy and Medium against it. Easy = the least-effort plan among the run's own
   * Easy, the carried Easy and the dedicated search's candidates that is safe, validated, chance-feasible, meets Easy's
   * goal constraints against this Hard and is distinct from it. Medium = the run's own or the carried one (the better knee
   * when both pass). A rung that stays missing gets the reason of the check that failed (a carried rung's own failure
   * first, `carried` in the detail), with its numbers; Easy's search adds its proof of absence.
   */
  private async extendRungs(
    H: Fin,
    E0: Fin | null,
    M0: Fin | null,
    collapsed: LadderCollapse[],
    judge: (m: Fin | null) => { res: ReturnType<typeof ladderDistinctness> },
    carriedOut: LadderResult<S>['carried'],
  ): Promise<{ E: Fin | null; M: Fin | null; easyReport: EasySearchReport | null; gHard: number; gMin: number }> {
    const L = this.lad!;
    const ls = this.ladderState;
    const dH = this.goals.desirability(H.rec.f);
    const gH = dH[0]!;
    const gMin = ls?.gMin ?? gMinDesirability(this.goals, L.gMinMetric);
    const out = { E: E0, M: M0, easyReport: null as EasySearchReport | null, gHard: gH, gMin };
    if (H.rec.vS !== 0 || !(gH >= gMin) || !(gH > 0)) return out;
    const prev = this.cfg.previous;
    // a stopped run skips the dedicated Easy search but still re-checks the carried rungs (nominal: a few EU), so
    // "Stop here" keeps the plans found so far (§12.1, cards(X) ⊇ cards(S))
    const runEasy = this.cfg.easySearch !== false && !this.aborted;
    if (!runEasy && !prev) return out;
    const eu0 = this.eu;
    const extra0 = this.extraEU;
    const R0 = Math.max(0, this.remaining());
    // the pot: carried re-evaluations and the search (granted back as spent below)
    this.extraEU += (runEasy ? easySearchBudget(this.tier, this.B.total) + EASY_SEARCH.candidates * (30 + this.Ms + 300) : 0) + 2 * (1 + this.Ms);
    const draws = this.aborted ? 0 : Math.min(this.Ms, H.outs.length);
    const pt = (f: Fin) => ({ D: this.D(f.rec), d1: this.goals.dRaw(0, f.rec.f[0]!) });
    const share = (f: Fin) => (gH > 1e-12 ? this.goals.desirability(f.rec.f)[0]! / gH : NaN);
    const thrE = rungThresholds(this.goals, dH, Math.max(L.easyShare * gH, gMin), LADDER_DEFAULTS.rhoEasy);
    const needE = gH > 1e-12 ? thrE[0]! / gH : NaN;
    const arch0 = this.archive ? this.archive.all() : undefined;
    const gwPair = (a: Fin, b: Fin) => this.distanceFn([a.rec, b.rec], arch0)(0, 1);
    type Check = { ok: true } | { ok: false; why: 'validation' | 'chance' | 'goals' | 'distinct' | 'unsafe'; collapse: LadderCollapse };
    const checkEasy = (f: Fin, carried: boolean): Check => {
      const tag: Record<string, number> = carried ? { carried: 1 } : {};
      if (f.rec.vS !== 0) return { ok: false, why: 'unsafe', collapse: { rung: 'easy', reason: 'infeasible', detail: { carriedSafe: 0, ...tag } } };
      if (!this.valid(f)) return { ok: false, why: 'validation', collapse: { rung: 'easy', reason: 'infeasible', detail: { carriedValid: 0, ...tag } } };
      if (!this.chanceOk(f)) return { ok: false, why: 'chance', collapse: { rung: 'easy', reason: 'infeasible', detail: { carriedChance: 0, ...tag } } };
      if (ladderViolation(this.goals.desirability(f.rec.f), thrE) > 1e-9)
        return { ok: false, why: 'goals', collapse: { rung: 'easy', reason: 'infeasible', detail: { gShareCarried: share(f), needed: needE, ...tag } } };
      const res = ladderDistinctness(pt(H), null, pt(f), () => gwPair(H, f), L);
      if (!res.easy) {
        const c = res.collapsed.find((q) => q.rung === 'easy')!;
        return { ok: false, why: 'distinct', collapse: { ...c, detail: { ...c.detail, ...tag } } };
      }
      return { ok: true };
    };
    const easyKey = (f: Fin) => this.goals.ladderKey(f.rec, thrE, this.D(f.rec), this.qD);
    // carried rungs
    const fromTier = prev?.tier ?? '';
    const carriedE = prev?.rungs.easy ? await this.carriedFin('easy', prev.rungs.easy, thrE, draws) : null;
    if (prev?.rungs.easy) carriedOut.easy = { kept: false, fromTier, reason: carriedE ? null : 'structure' };
    // the dedicated Easy search
    let search: { fins: Fin[]; report: EasySearchReport; points: EvalRecord[] } | null = null;
    if (runEasy && !this.aborted) search = await this.easySearch(H, thrE, [carriedE?.rec ?? null, E0?.rec ?? null, ...(ls?.easy?.cands ?? [])], draws);
    // choose Easy
    const easyCands: Array<{ f: Fin; c: Check }> = [];
    for (const f of [E0, carriedE, ...(search?.fins ?? [])]) if (f) easyCands.push({ f, c: checkEasy(f, f === carriedE) });
    let E: Fin | null = null;
    for (const { f, c } of easyCands) if (c.ok && (!E || compareKeys(easyKey(f), easyKey(E)) < 0)) E = f;
    if (carriedE && carriedOut.easy) {
      const c = easyCands.find((q) => q.f === carriedE)!.c;
      carriedOut.easy.reason = c.ok ? (E === carriedE ? null : 'replaced') : c.why;
    }
    // Medium: thresholds between this Easy and Hard (the band search's), else Medium's fallback share of Hard
    const thrM = rungThresholds(this.goals, dH, Math.max(E ? this.goals.dRaw(0, E.rec.f[0]!) : L.mediumShare * gH, gMin), LADDER_DEFAULTS.rhoMedium);
    const carriedM = prev?.rungs.medium ? await this.carriedFin('medium', prev.rungs.medium, thrM, draws) : null;
    if (prev?.rungs.medium) carriedOut.medium = { kept: false, fromTier, reason: carriedM ? null : 'structure' };
    const checkMedium = (f: Fin, carried: boolean): Check => {
      const tag: Record<string, number> = carried ? { carried: 1 } : {};
      if (f.rec.vS !== 0) return { ok: false, why: 'unsafe', collapse: { rung: 'medium', reason: 'infeasible', detail: { carriedSafe: 0, ...tag } } };
      if (!this.valid(f)) return { ok: false, why: 'validation', collapse: { rung: 'medium', reason: 'infeasible', detail: { carriedValid: 0, ...tag } } };
      if (!this.chanceOk(f)) return { ok: false, why: 'chance', collapse: { rung: 'medium', reason: 'infeasible', detail: { carriedChance: 0, ...tag } } };
      if (carried && ladderViolation(this.goals.desirability(f.rec.f), thrM) > 1e-9)
        return { ok: false, why: 'goals', collapse: { rung: 'medium', reason: 'infeasible', detail: { gShareCarried: share(f), needed: gH > 1e-12 ? thrM[0]! / gH : NaN, ...tag } } };
      const res = judge(f).res;
      if (!res.medium || (E && !res.easy)) {
        const c = res.collapsed.find((q) => q.rung === 'medium') ?? { rung: 'medium' as const, reason: 'notDistinct' as const, detail: {} };
        return { ok: false, why: 'distinct', collapse: { ...c, detail: { ...c.detail, ...tag } } };
      }
      return { ok: true };
    };
    // the judge reads E through the caller's closure: hand it the chosen Easy for the Medium checks
    this.judgeEasy = E;
    const medCands: Array<{ f: Fin; c: Check }> = [];
    for (const f of [M0, carriedM]) if (f) medCands.push({ f, c: checkMedium(f, f === carriedM) });
    this.judgeEasy = undefined;
    const knee = (f: Fin) => {
      if (!E) return 0;
      const p = pt(f);
      const e = pt(E);
      const h = pt(H);
      const dx = h.D - e.D;
      const dy = h.d1 - e.d1;
      return dx > 1e-12 && dy > 1e-12 ? ((p.d1 - e.d1) / dy - (p.D - e.D) / dx) / Math.SQRT2 : 0;
    };
    let M: Fin | null = null;
    for (const { f, c } of medCands) if (c.ok && (!M || knee(f) > knee(M) + 1e-9)) M = f;
    if (carriedM && carriedOut.medium) {
      const c = medCands.find((q) => q.f === carriedM)!.c;
      carriedOut.medium.reason = c.ok ? (M === carriedM ? null : 'replaced') : c.why;
    }
    // reasons: replace the stale ones of this run's own ladder solve
    const setReason = (rung: 'medium' | 'easy', c: LadderCollapse) => {
      for (let i = collapsed.length - 1; i >= 0; i--) if (collapsed[i]!.rung === rung) collapsed.splice(i, 1);
      collapsed.push(c);
    };
    if (E) for (let i = collapsed.length - 1; i >= 0; i--) if (collapsed[i]!.rung === 'easy') collapsed.splice(i, 1);
    if (M) for (let i = collapsed.length - 1; i >= 0; i--) if (collapsed[i]!.rung === 'medium') collapsed.splice(i, 1);
    if (!E) {
      const cc = carriedE ? easyCands.find((q) => q.f === carriedE)!.c : null;
      // the least-effort candidate that met the goals but was too close to Hard or a repeat of it
      const distinctFail = easyCands
        .filter((q) => !q.c.ok && q.c.why === 'distinct' && q.f !== carriedE)
        .sort((p, q) => this.D(p.f.rec) - this.D(q.f.rec))[0];
      if (cc && !cc.ok) setReason('easy', cc.collapse);
      else if (distinctFail && !distinctFail.c.ok) setReason('easy', distinctFail.c.collapse);
      else if (search) setReason('easy', { rung: 'easy', reason: 'infeasible', detail: { needed: needE } });
    }
    if (!M) {
      const cc = carriedM ? medCands.find((q) => q.f === carriedM)!.c : null;
      if (cc && !cc.ok) setReason('medium', cc.collapse);
      else if (!E) {
        const ce = collapsed.find((q) => q.rung === 'easy');
        if (ce) {
          const { carried: _c, ...detail } = ce.detail;
          setReason('medium', { rung: 'medium', reason: ce.reason, detail: carriedM ? { ...detail, carried: 1 } : detail });
        }
      } else if (!collapsed.some((q) => q.rung === 'medium')) {
        const own = M0 ? medCands.find((q) => q.f === M0)?.c : null;
        if (own && !own.ok) setReason('medium', own.collapse);
      }
    }
    // the search's proof of absence (§12.2): no safe plan with less effort than Hard keeps the goals
    if (search) {
      if (!E) {
        const thrOthers = Float64Array.from(thrE);
        thrOthers[0] = -Infinity;
        const dMax = this.D(H.rec) - L.minDGap;
        const pts = search.points
          .filter((r) => r.draw === -1)
          .map((r) => {
            const d = this.goals.desirability(r.f);
            return { D: this.D(r), d1: d[0]!, safe: r.vS === 0, othersOk: ladderViolation(d, thrOthers) <= 1e-9 };
          });
        const pr = easyProof(pts, gH, thrE[0]!, dMax, search.report.starts);
        const rejected = easyCands
          .filter((q) => !q.c.ok && q.c.why !== 'goals' && q.c.why !== 'unsafe' && this.D(q.f.rec) <= dMax + 1e-12)
          .map((q) => ({ why: (q.c.ok ? 'distinct' : q.c.why) as 'validation' | 'chance' | 'distinct', g1: share(q.f), D: this.D(q.f.rec) }));
        search.report.proof = { ...pr, rejected };
        const ce = collapsed.find((q) => q.rung === 'easy');
        if (ce && ce.reason === 'infeasible') Object.assign(ce.detail, { bestG1: pr.bestG1, needed: pr.needed, closestD: pr.D });
      }
      out.easyReport = search.report;
    }
    // EU: what this spent is granted on top of the total; a rung this added also gets an option's share of S5's rest
    const added = (E && !E0 ? 1 : 0) + (M && !M0 ? 1 : 0);
    const used = this.eu - eu0;
    const grant = used + added * (this.Mh + Math.max(0, Math.ceil((R0 - 2 * this.Mh) / 2)));
    if (out.easyReport) out.easyReport.grantEU = grant;
    this.extraEU = extra0 + grant;
    out.E = E;
    out.M = M;
    return out;
  }

  /** Easy the final judge sees while `extendRungs` checks Medium candidates (undefined = the caller's own Easy). */
  judgeEasy: Fin | null | undefined = undefined;

  async finish(): Promise<PlannerResult<S>> {
    this.stage = 'S5';
    const L = this.lad;
    const ls = this.ladderState;
    const Ms = this.Ms;
    const options = L ? 3 : (this.cfg.optionCount ?? 3);
    // budget: holdout of the chosen options and the ablations are reserved; half of the rest goes to the ensembles
    const avail0 = Math.max(0, this.remaining());
    const reserve = options * this.Mh + Math.floor(0.15 * avail0);
    const maxFin = Math.max(1, Math.min(this.cfg.maxFinalists ?? 10, Ms > 0 ? Math.floor((0.5 * Math.max(0, avail0 - reserve)) / Ms) : 10));
    const fins: Fin[] = [];
    const mk = (role: FinRole, rec: EvalRecord, thr: Float64Array | null = null): Fin => ({ role, rec, rounded: false, outs: [], sel: null, hold: null, thr });
    if (L) {
      // up to 4 Hard candidates and 3 per rung, within the finalist budget
      const nHard = Math.max(1, Math.min(4, maxFin - 2));
      const perRung = Math.max(1, Math.min(3, Math.floor((maxFin - nHard) / 2)));
      for (const r of this.hardCandidates(nHard)) fins.push(mk('hard', r));
      // a stopped run also weighs the previous search's Hard (nominal, as every finalist of a stopped run): "Stop here"
      // keeps the plans found so far, so a search stopped early never returns a weaker Hard than the one shown (§12.1)
      const pH = this.cfg.previous?.rungs.hard;
      const pSt = pH ? this.problem.structures[pH.structure] : undefined;
      if (this.aborted && pH && pSt && pSt.dim === pH.x.length) {
        const x = Float64Array.from(pH.x, (v) => Math.min(1, Math.max(0, v)));
        const [rec] = await this.evaluate([{ structure: pH.structure, x, box: 0, draw: -1 }], 'S5.carry');
        this.ingest(rec!);
        if (!fins.some((f) => f.role === 'hard' && this.cacheKey(f.rec) === this.cacheKey(rec!))) fins.push({ ...mk('hard', rec!), prov: 'carried' });
      }
      for (const r of (ls?.medium?.cands ?? []).slice(0, perRung)) fins.push(mk('medium', r, ls!.medium!.thr));
      for (const r of (ls?.easy?.cands ?? []).slice(0, perRung)) fins.push(mk('easy', r, ls!.easy!.thr));
    } else {
      const pool = this.selectionPool();
      const cand = pool.map(this.asCandidate);
      const dist = this.distanceFn(pool);
      // finalists are pre-selected with half of D_min (near-duplicates of A are not worth an ensemble), then filled with
      // the closest variants (fallbacks when a distinct finalist fails validation or P90)
      // A finalist that fails validation can never be picked (pickMmr): it is replaced by the next valid plan, so a small
      // finalist budget (one finalist at tier S's Ideal) cannot end with no plan while valid plans were found (Q3-J5-05)
      const pre = selectAlternatives(cand, dist, { count: maxFin, lambda: this.cfg.mmrLambda, scoreStep: this.goals.goalQuantum(), dMin: 0.5 * (this.cfg.dMin ?? DEFAULT_D_MIN) });
      const chosen = pre.chosen.filter((i) => this.validRec(pool[i]!));
      if (chosen.length < maxFin) {
        const fill = selectAlternatives(cand, dist, { count: Math.min(pool.length, maxFin + FINALIST_FILL_EXTRA), lambda: this.cfg.mmrLambda, scoreStep: this.goals.goalQuantum(), dMin: 0 });
        for (const i of fill.chosen) if (chosen.length < maxFin && !chosen.includes(i) && this.validRec(pool[i]!)) chosen.push(i);
      }
      for (const i of chosen) fins.push(mk('option', pool[i]!));
    }
    // round-and-verify (Hard and option A keep the strict floors)
    const strictOf = (f: Fin, i: number) => f.role === 'hard' || (f.role === 'option' && i === 0);
    if (!this.aborted)
      for (let i = 0; i < fins.length; i++) {
        const f = fins[i]!;
        const strict = strictOf(f, i);
        const rv = await this.roundAndVerify(f.rec, this.roleOk(f, strict), this.roleKey(f, strict));
        f.rec = rv.rec;
        f.rounded = rv.rounded;
      }
    // selection ensemble (common random numbers), OCBA-style: every finalist first gets ⌈M_s/2⌉ draws; contenders
    // (chosen options and finalists practically tied with Hard / A) are completed to M_s before the final pick
    this.holdReserve = options * this.Mh;
    const ensembles = Ms > 0 && !this.aborted && this.remaining() - this.holdReserve >= fins.length * Math.ceil(Ms / 2);
    if (ensembles) {
      const M0 = this.cfg.ocba !== false && Ms >= 4 ? Math.ceil(Ms / 2) : Ms;
      await this.selectionDraws(fins, M0);
      this.compReserve = options * (Ms - M0);
      for (let i = 0; i < fins.length; i++) await this.chanceRepair(fins[i]!, M0, strictOf(fins[i]!, i));
      this.compReserve = 0;
      for (let iter = 0; iter < 4 && !this.aborted; iter++) {
        const chosen = L ? this.ladderChosen(fins) : this.pickMmr(fins).chosen.map((c) => c.fin);
        const lead = chosen[0];
        const contenders = new Set<Fin>(chosen);
        if (lead) for (const f of this.tiedWith(lead, fins)) contenders.add(f);
        const need = [...contenders].filter((f) => f.outs.length < Ms);
        if (!need.length || this.remaining() - this.holdReserve < need.length * (Ms - Math.min(...need.map((f) => f.outs.length)))) break;
        await this.selectionDraws(need, Ms);
        for (const f of need) await this.chanceRepair(f, Ms, strictOf(f, fins.indexOf(f)));
      }
    }
    if (this.cfg.diagnostics)
      this.diagnostics = fins.map((f) => {
        const d = this.dOf(f);
        return {
          structureId: this.structureOf(f.rec.structure).id,
          role: f.role,
          desirability: Array.from(this.goals.desirability(f.rec.f), (v) => +v.toFixed(4)),
          utility: +(f.sel ? f.sel.robustUtility : this.goals.utility(f.rec.f, f.rec.reg)).toFixed(4),
          safe: f.rec.vS === 0,
          chanceFeasible: f.sel ? f.sel.chanceFeasible : null,
          p10Violations: f.sel ? f.sel.margins.flatMap((b, c) => (b.p10 < 0 ? [c] : [])) : [],
          marginBands: f.sel ? f.sel.margins.map((b) => [+b.p10.toFixed(3), +b.p50.toFixed(3)]) : [],
          validated: this.valid(f),
          relaxedFeasible: this.goals.priorityFeasibleD(d, true),
          draws: f.outs.length,
        };
      });
    // final pick
    let chosen: Array<{ fin: Fin; dist: number; rung?: RungId }> = [];
    let shortfall: PlannerResult<S>['shortfall'] = null;
    let floorsRelaxedForA: boolean;
    let ladderOut: LadderResult<S> | null = null;
    const collapsed: LadderCollapse[] = ls ? ls.collapsed.map((c) => ({ ...c, detail: { ...c.detail } })) : [];
    let checks: LadderChecks = { dHM: NaN, dME: NaN, gowerMin: NaN, ordered: true };
    let gowerPairs = { hm: NaN, me: NaN, he: NaN };
    let bandReport: MediumBandReport | null = null;
    let easyReport: EasySearchReport | null = null;
    const carriedOut: LadderResult<S>['carried'] = {};
    let gHardOut = NaN;
    let gMinOut = NaN;
    if (L) {
      const pk = this.pickLadder(fins);
      floorsRelaxedForA = pk.relaxed;
      if (!pk.hard) shortfall = 'noCandidates';
      else {
        const H = pk.hard;
        let E = pk.easy;
        let M = pk.medium;
        if (!M && ls?.medium && !collapsed.some((c) => c.rung === 'medium')) collapsed.push({ rung: 'medium', reason: 'infeasible', detail: { candidates: ls.medium.cands.length } });
        if (!E && ls?.easy && !collapsed.some((c) => c.rung === 'easy')) collapsed.push({ rung: 'easy', reason: 'infeasible', detail: { candidates: ls.easy.cands.length } });
        // Gower ranges over the archive as it stands now (a Medium band search adds records; Hard-Easy must not move)
        const arch0 = this.archive ? this.archive.all() : undefined;
        const pt = (f: Fin) => ({ D: this.D(f.rec), d1: this.goals.dRaw(0, f.rec.f[0]!) });
        const judge = (m: Fin | null) => {
          // while `extendRungs` checks Medium candidates it hands the Easy it chose through `judgeEasy`
          const e = this.judgeEasy !== undefined ? this.judgeEasy : E;
          const present: Array<[RungId, Fin]> = [['hard', H]];
          if (m) present.push(['medium', m]);
          if (e) present.push(['easy', e]);
          const dist = this.distanceFn(present.map(([, f]) => f.rec), arch0);
          const idx = (id: RungId) => present.findIndex(([k]) => k === id);
          const gw = (a: RungId, b: RungId) => dist(idx(a), idx(b));
          return { present, dist, idx, gw, res: ladderDistinctness(pt(H), m ? pt(m) : null, e ? pt(e) : null, gw, L) };
        };
        // §12.1-12.2: the previous search's rungs and the dedicated Easy search, judged against this run's final Hard
        const ext = await this.extendRungs(H, E, M, collapsed, judge, carriedOut);
        E = ext.E;
        M = ext.M;
        easyReport = ext.easyReport;
        gHardOut = ext.gHard;
        gMinOut = ext.gMin;
        let J = judge(M);
        // PLN-06: Hard and Easy stand but Medium was dropped → the short Medium band search (thresholds unchanged)
        if (!J.res.medium && E && J.res.easy && this.cfg.mediumBand !== false && !this.aborted) {
          const dropped = collapsed.find((c) => c.rung === 'medium') ?? J.res.collapsed.find((c) => c.rung === 'medium') ?? null;
          const band = await this.mediumBand(H, E, (m) => judge(m).res.medium);
          bandReport = { ...band.report, dropped: dropped ? { ...dropped, detail: { ...dropped.detail } } : null };
          if (band.fin) {
            M = band.fin;
            J = judge(M);
            for (let c = collapsed.length - 1; c >= 0; c--) if (collapsed[c]!.rung === 'medium') collapsed.splice(c, 1);
          }
        }
        const { present, dist, idx, gw, res } = J;
        gowerPairs = { hm: M ? gw('hard', 'medium') : NaN, me: M && E ? gw('medium', 'easy') : NaN, he: E ? gw('hard', 'easy') : NaN };
        for (const c of res.collapsed) if (!collapsed.some((q) => q.rung === c.rung)) collapsed.push(c);
        // a rung a stopped run never got to check is 'stopped', not an unproven 'infeasible'
        if (this.aborted)
          for (const [id, f] of [['medium', M], ['easy', E]] as const)
            if (!f && !collapsed.some((q) => q.rung === id)) collapsed.push({ rung: id, reason: 'stopped', detail: {} });
        // a rung dropped by the final check after the extension took it: Medium repeats Easy's reason when Easy failed
        if (E && !res.easy && M && !collapsed.some((q) => q.rung === 'medium')) {
          const ce = collapsed.find((q) => q.rung === 'easy');
          if (ce) collapsed.push({ rung: 'medium', reason: ce.reason, detail: { ...ce.detail, viaEasy: 1 } });
        }
        chosen.push({ fin: H, dist: NaN, rung: 'hard' });
        const keepIds: RungId[] = ['hard'];
        if (M && res.medium) keepIds.push('medium');
        if (E && res.easy) keepIds.push('easy');
        // checks describe what is returned (recomputed after any collapse)
        const kept = (id: RungId) => keepIds.includes(id);
        checks = ladderDistinctness(pt(H), kept('medium') ? pt(M!) : null, kept('easy') ? pt(E!) : null, gw, L).checks;
        for (const id of keepIds.slice(1)) {
          const f = present[idx(id)]![1];
          const d = Math.min(...keepIds.filter((k) => k !== id && keepIds.indexOf(k) < keepIds.indexOf(id)).map((k) => dist(idx(k), idx(id))));
          chosen.push({ fin: f, dist: d, rung: id });
        }
        for (const id of ['medium', 'easy'] as const) {
          const cr = carriedOut[id];
          if (cr) cr.kept = keepIds.includes(id) && present[idx(id)]?.[1].prov === 'carried';
        }
        if (easyReport) easyReport.chosen = keepIds.includes('easy') && present[idx('easy')]?.[1].prov === 'easySearch';
      }
    } else {
      const pk = this.pickMmr(fins);
      chosen = pk.chosen;
      shortfall = pk.shortfall;
      floorsRelaxedForA = pk.relaxed;
    }
    await this.holdout(chosen.map((c) => c.fin));
    if (this.cfg.onProgress && chosen.length) {
      if (L) this.progress('S5', chosen[0]!.fin.rec, true);
      else this.progress('S5', chosen[0]!.fin.rec, true, chosen.map((c) => c.fin.rec));
    }
    // S6 explanations
    this.stage = 'S6';
    const { d, u } = this.historyDesirability();
    const conflicts = conflictMatrix(d, this.K, u, this.cfg.conflict);
    const A = chosen[0]?.fin.rec ?? null;
    const perOptionAbl = Math.max(0, Math.floor(this.remaining() / Math.max(1, chosen.length)));
    const out: PlanOptionResult<S>[] = [];
    const holdA = chosen[0]?.fin.hold ?? chosen[0]?.fin.sel ?? null;
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i]!;
      const f = c.fin;
      const r = f.rec;
      const dRec = this.goals.desirability(r.f);
      const ablations: PlanOptionResult<S>['ablations'] = [];
      const abl = this.problem.ablations?.(r.structure, r.x) ?? [];
      if (abl.length && !this.aborted && perOptionAbl > 0 && this.remaining() >= Math.min(abl.length, perOptionAbl)) {
        const recs = await this.evaluate(
          abl.slice(0, perOptionAbl).map((a) => ({ structure: a.structure, x: a.x, box: 0, draw: -1 })),
          'S6',
        );
        recs.forEach((q, j) => {
          this.ingest(q);
          const dq = this.goals.desirability(q.f);
          ablations.push({ label: abl[j]!.label, deltaD: Float64Array.from(dRec, (v, k) => v - dq[k]!), safe: q.vS === 0 });
        });
        ablations.sort((a, b) => maxAbs(b.deltaD) - maxAbs(a.deltaD));
        ablations.length = Math.min(3, ablations.length);
      }
      const dA = A ? this.goals.desirability(A.f) : dRec;
      const rep = f.hold ?? f.sel;
      out.push({
        label: String.fromCharCode(65 + i),
        ...(c.rung ? { rung: c.rung, D: this.D(r), provenance: f.prov ?? 'own' } : {}),
        structureIndex: r.structure,
        structure: this.structureOf(r.structure),
        x: r.x,
        output: r.out,
        objectives: r.f,
        metricValues: Float64Array.from(r.f, (v, k) => this.goals.toMetric(k, v)),
        desirability: dRec,
        reported: Float64Array.from(r.f, (v, k) => this.goals.dReported(k, v)),
        percentOfPossible: Float64Array.from(r.f, (v, k) => this.goals.percentOfPossible(k, v)),
        percentOfTarget: Float64Array.from(r.f, (v, k) => this.goals.percentOfTarget(k, v)),
        costVsA: Float64Array.from(dRec, (v, k) => dA[k]! - v),
        utility: this.goals.utility(r.f, r.reg),
        strictFeasible: this.goals.priorityFeasibleD(this.dOf(f), false),
        rounded: f.rounded,
        robust: rep,
        robustSelection: f.sel,
        aBeatsThisShare: i > 0 && holdA && rep ? decisionStability(holdA, rep, 0) : null,
        ablations,
        distanceToChosen: c.dist,
      });
    }
    if (L) {
      const byRung = (id: RungId) => out.find((o) => o.rung === id) ?? null;
      ladderOut = {
        rungs: { hard: byRung('hard'), medium: byRung('medium'), easy: byRung('easy') },
        collapsed,
        checks,
        staircase: this.staircasePoints().map((p) => ({ D: p.D, g: p.g, d1: p.d1, structure: p.item.structure, x: p.item.x })),
        gower: gowerPairs,
        mediumBand: bandReport,
        gHard: gHardOut,
        gMin: gMinOut,
        easySearch: easyReport,
        carried: carriedOut,
      };
    }
    const tradeoffs = await this.tradeoffs(conflicts);
    const pA = out[0]?.percentOfPossible;
    const li = this.leastInfeasible;
    const lead = chosen[0]?.fin;
    const holdoutGap =
      lead && lead.sel && lead.hold ? lead.sel.goals.map((g, k) => g.dMean - lead.hold!.goals[k]!.dMean) : [];
    this.tick('S6', true);
    return {
      complete: !this.stoppedAt,
      stoppedAt: this.stoppedAt,
      options: out,
      shortfall,
      floorsRelaxedForA,
      noSafePlan:
        !this.anySafe && li ? { structure: li.structure, x: li.x, vS: li.vS, violated: violatedOf(li.out.margins) } : null,
      goals: this.goals.snapshot(),
      feasibility: this.goals.feasibilityReport(A?.f),
      conflicts,
      relations: relationMessages(conflicts, pA),
      tradeoffs,
      archive: {
        cells: this.archive?.indexer.cells ?? 0,
        filled: this.archive?.size ?? 0,
        activeDescriptors: this.activeDims,
      },
      anchors: this.anchorRec.map((r, k) => (r ? { structure: r.structure, x: r.x, f: r.f[k]! } : null)),
      ...(this.problem.group ? { groupBest: this.groupBestOut() } : {}),
      ladder: ladderOut,
      convergence: this.curve.slice(),
      holdoutGap,
      quanta: { q: Array.from(this.goals.keyQuanta()), qG: this.goals.goalQuantum() },
      race: { rounds: this.raceRounds.map((r) => ({ budgetPerStructure: r.budgetPerStructure, survivors: r.survivors.slice() })) },
      ...(this.diagnostics ? { diagnostics: { finalists: this.diagnostics } } : {}),
      provenance: {
        seed: this.rng.key,
        tier: this.tier,
        budgetEU: this.B.run + this.extraEU,
        euUsed: this.eu,
        requests: this.requests,
        cacheHits: this.cacheHits,
        stageEU: { ...this.stageEU },
        resumedFrom: this.resumedFrom,
      },
    };
  }

  /** Ladder finalists that would be chosen now (Hard and the rungs), for the OCBA completion. */
  private ladderChosen(fins: readonly Fin[]): Fin[] {
    const pk = this.pickLadder(fins);
    return [pk.hard, pk.medium, pk.easy].filter((f): f is Fin => !!f);
  }

  async tradeoffs(m: ConflictMatrix): Promise<TradeoffCurve[]> {
    const sw = this.cfg.tradeoffSweep;
    if (!sw) return [];
    const levels = sw.levels ?? [1, 0.9, 0.8, 0.7];
    const per = sw.euPerLevel ?? 200;
    const out: TradeoffCurve[] = [];
    const top = Math.min(3, this.K);
    for (let i = 0; i < top && out.length < (sw.maxPairs ?? 3); i++)
      for (let j = i + 1; j < top && out.length < (sw.maxPairs ?? 3); j++) {
        const c = m.cls[i * m.K + j];
        if (c !== 'conflict' && c !== 'tradeOff') continue;
        let start = this.anchorRec[i];
        if (!start) continue;
        const Ai = m.best[i]!;
        const pts: TradeoffCurve['points'] = [];
        for (const level of levels) {
          if (this.aborted || this.remaining() < per) break;
          const key = (r: EvalRecord): Key => [
            r.vS,
            Math.max(0, level * Ai - this.goals.dRaw(i, r.f[i]!)),
            -(this.goals.dRaw(j, r.f[j]!) - this.goals.boxWeight * r.box),
          ];
          const best = await this.runCma({
            label: `S6/sweep/${i}/${j}/${level}`,
            structure: start.structure,
            x0: start.x,
            sigma0: 0.1,
            budget: per,
            stage: 'S6',
            key,
            checkpoint: false,
          });
          if (!best) break;
          pts.push({ level, dHigher: this.goals.dRaw(i, best.f[i]!), dLower: this.goals.dRaw(j, best.f[j]!) });
          start = best;
        }
        out.push({ higher: i, lower: j, points: pts, knee: kneePoint(pts.map((p) => ({ x: p.dHigher, y: p.dLower }))) });
      }
    return out;
  }

  async run(): Promise<PlannerResult<S>> {
    const phases: Array<() => Promise<void>> = [
      () => this.p0(),
      () => this.pRace(),
      () => this.pAnchors(),
      () => this.pStages(),
      () => this.pQd(),
      () => this.pLadder(),
    ];
    while (this.phase < phases.length) {
      const name = PHASES[this.phase]!;
      await phases[this.phase]!();
      if (this.aborted && !this.stoppedAt) this.stoppedAt = name === 'S4.ladder' ? 'S4' : name;
      this.phase++;
      this.resumeData = null;
      this.tick(name, true);
      await this.checkpoint(name, true);
    }
    if (!this.archive) this.openArchive();
    const res = await this.finish();
    if (this.aborted && !this.stoppedAt) this.stoppedAt = 'S5';
    return { ...res, complete: !this.stoppedAt, stoppedAt: this.stoppedAt };
  }
}

function violatedOf(margins: ArrayLike<number>): number[] {
  return Array.from(margins).flatMap((m, c) => (m < 0 || Number.isNaN(m) ? [c] : []));
}

function maxAbs(v: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]!));
  return m;
}

/**
 * Run the planner optimisation core. Anytime: progress callbacks carry the provisional option A / rungs; if
 * `config.signal.aborted` becomes true, remaining stages are skipped (no further evaluations) and the best result so far
 * is returned with `complete = false`. With `config.checkpoint.resume` the run continues from a checkpoint.
 */
export async function runPlanner<S extends PlanStructure>(
  problem: PlannerProblem<S>,
  evaluator: Evaluator,
  config: PlannerConfig,
): Promise<PlannerResult<S>> {
  if (problem.structures.length === 0) throw new RangeError('runPlanner: no structures');
  if (problem.goals.length === 0) throw new RangeError('runPlanner: no goals');
  return new PlannerRun(problem, evaluator, config).run();
}
