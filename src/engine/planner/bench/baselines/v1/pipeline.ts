/* Frozen copy of the v1 planner optimiser (src/engine/planner/optim as of 2026-10-01, before planner v2; PLANNER_V2_SPEC §5.1 "the v1 planner is frozen behind an adapter"). Do not edit: the benchmark harness measures every v2 change against it. */
/**
 * Planner orchestration skeleton (dossier 18 §4.11, §4.19): generic over the plan structure type.
 *
 *   S0 baseline → S1 enumerate + screen structures → S2 single-goal anchors → S3 ε-lexicographic stages
 *   (CMA-ES/IPOP) → S4 quality-diversity (CMA-ME emitters + structural emitter) → S5 select, round-and-
 *   verify, ensemble, chance-constraint repair, validator, robust re-rank → S6 ablations, conflicts.
 *
 * Determinism: all randomness comes from named `Rng` streams derived from the seed; every batch is
 * evaluated through an `Evaluator` that returns outputs in request order; records are ingested
 * (anchors, history, archive) strictly in candidate order; λ depends on a tier constant, never on the
 * live worker count → bitwise-identical output for any worker count / batch chunking.
 * Budgets are counted in evaluation units (EU = one horizon simulation); cache hits cost nothing.
 */
import type { FeatureSpec, InsertResult, SelectionCandidate } from './archive';
import {
  Archive,
  DEFAULT_D_MIN,
  cvtCentroids,
  emitterRankKey,
  featureRanges,
  gowerDistance,
  selectActiveDescriptors,
  selectAlternatives,
} from './archive';
import type { CovarianceMode, Key } from './cmaes';
import { CmaEs, IpopCmaEs, compareKeys, defaultLambda } from './cmaes';
import type { ConflictMatrix, ConflictOptions, GoalRelationMessage } from './conflicts';
import { conflictMatrix, kneePoint, relationMessages } from './conflicts';
import type { GoalFeasibility, GoalSpec, Scored, Strictness } from './goals';
import { GoalSystem } from './goals';
import type { Seed } from '../../../optim/rng';
import { Rng, hashInts, latinHypercube } from '../../../optim/rng';
import type { FinalistRobustness, RobustMode } from './robust';
import { decisionStability, evaluateEnsemble, robustSummary } from './robust';
import type { EvalOutput, EvalRequest, Evaluator, MaybePromise, PlanModel, PlanStructure } from '../../../optim/types';
import { violation } from '../../../optim/types';

// ---------------------------------------------------------------------------------------------
// Budgets (§4.1, §4.11)
// ---------------------------------------------------------------------------------------------

export type Tier = 'S' | 'M' | 'L';

/** Total budget per device tier in EU (§4.11): mobile ≈ 3k, desktop 12k-40k. */
export const TIER_BUDGET_EU: Readonly<Record<Tier, number>> = { S: 3000, M: 12000, L: 40000 };

/** Per-stage EU from the §4.11 table (anchor and stage amounts are per goal). */
export const STAGE_TABLE: Readonly<
  Record<Tier, { s0: number; s1: number; anchor: number; stage: number; qd: number; s5: number; s6: number }>
> = {
  S: { s0: 2, s1: 300, anchor: 150, stage: 350, qd: 500, s5: 250, s6: 60 },
  M: { s0: 2, s1: 1200, anchor: 500, stage: 1200, qd: 3000, s5: 900, s6: 400 },
  L: { s0: 2, s1: 4000, anchor: 1500, stage: 4000, qd: 12000, s5: 3000, s6: 1200 },
};

/** CVT cells (§4.12), ensemble size M (§4.15), max structures screened (§4.11) per tier. */
export const TIER_ARCHIVE_CELLS: Readonly<Record<Tier, number>> = { S: 64, M: 100, L: 150 };
export const TIER_ENSEMBLE: Readonly<Record<Tier, number>> = { S: 16, M: 32, L: 32 };
export const TIER_MAX_SCREENED: Readonly<Record<Tier, number>> = { S: 60, M: Infinity, L: Infinity };
/** sep-CMA-ES on tier S, full covariance otherwise (§4.10). */
export const TIER_COVARIANCE: Readonly<Record<Tier, CovarianceMode>> = { S: 'sep', M: 'full', L: 'full' };
/**
 * λ quantum per tier: λ = max(4 + ⌊3 ln n⌋, 2q) rounded up to a multiple of q (§4.10 with q = nominal
 * worker count of the tier — *not* the live count, which would break worker-count invariance, §7.3.7).
 */
export const TIER_LAMBDA_QUANTUM: Readonly<Record<Tier, number>> = { S: 3, M: 8, L: 8 };

/** Safety factor on the P50−P10 margin gap used to tighten a bound before the chance-constraint re-polish (PROPOSED). */
export const CHANCE_TIGHTEN_FACTOR = 1.25;

export interface StageBudget {
  total: number;
  s0: number;
  s1: number;
  /** Per anchored goal (goals 2..K). */
  anchor: number;
  /** Per lexicographic stage. */
  stage: number;
  qd: number;
  s5: number;
  s6: number;
}

/**
 * Stage budgets for K goals: the §4.11 table, scaled down to fit `total`; a surplus first lifts the
 * lexicographic stages to the table's "30-35 %" share (matters for small K), the rest goes to S4.
 */
export function planBudget(tier: Tier, K: number, total = TIER_BUDGET_EU[tier]): StageBudget {
  const t = STAGE_TABLE[tier];
  const raw = t.s1 + t.anchor * Math.max(0, K - 1) + t.stage * K + t.qd + t.s5 + t.s6;
  const avail = Math.max(0, total - t.s0);
  const f = raw > avail ? avail / raw : 1;
  const b = {
    total,
    s0: t.s0,
    s1: Math.floor(t.s1 * f),
    anchor: Math.floor(t.anchor * f),
    stage: Math.floor(t.stage * f),
    qd: Math.floor(t.qd * f),
    s5: Math.floor(t.s5 * f),
    s6: Math.floor(t.s6 * f),
  };
  if (f === 1) {
    let surplus = avail - raw;
    const minStage = Math.floor((0.3 * total) / Math.max(1, K));
    if (b.stage < minStage) {
      const add = Math.min(minStage - b.stage, Math.floor(surplus / Math.max(1, K)));
      b.stage += add;
      surplus -= add * K;
    }
    b.qd += surplus;
  }
  return b;
}

/**
 * Tier from device calibration (§4.19): EU/s = workers × 1000 / msPerEU; affordable = EU/s × target
 * seconds (desktop 10 s, mobile 20 s) → L if ≥ 40k, M if ≥ 12k, else S.
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

/** Evaluate one request with a `PlanModel` (used by the local evaluator and, later, inside workers). */
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
 * Pool evaluator: splits a batch into chunks, feeds them to whichever worker is free, and re-assembles
 * the outputs *by request index*, so the result never depends on worker count or completion order.
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
  /** Enumerated structures (skeletons), already pruned and ordered by prior score (§4.11 S1). */
  readonly structures: readonly S[];
  /** Ordered goals (priority order). */
  readonly goals: readonly GoalSpec[];
  /** Status-quo / maintenance plan defining desirability 0 (§4.6). */
  readonly baseline: { structure: number; x: ArrayLike<number> };
  /**
   * Warm-start genomes evaluated first in S1 (before the screening samples; they count against the S1 budget), e.g. a
   * known good plan transferred from a previous run (time-to-target on an extended horizon, §4.14.3).
   */
  readonly seeds?: ReadonlyArray<{ structure: number; x: ArrayLike<number> }>;
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

export interface PlannerConfig {
  seed: Seed;
  tier?: Tier;
  /** Override the tier's total EU. */
  totalEU?: number;
  strictness?: Strictness;
  targetTolerance?: number;
  eta?: number;
  boxWeight?: number;
  covariance?: CovarianceMode | 'auto';
  lambdaQuantum?: number;
  archiveCells?: number;
  cvtSamples?: number;
  minDescriptorRange?: number;
  /** Ensemble size M (0 disables the S5 ensemble). */
  ensembleSize?: number;
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
  onProgress?: (p: PlannerProgress) => void;
  /** Cooperative cancellation (an AbortSignal satisfies this), checked between generations. */
  signal?: { readonly aborted: boolean };
  /** Minimum EU between progress callbacks (default 2 % of the budget). */
  progressEveryEU?: number;
  /** Record S5 finalist diagnostics in `PlannerResult.diagnostics` (tuning / tests). */
  diagnostics?: boolean;
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
  /** Provisional option A (available from the end of S3 stage 1). */
  provisional: OptionSummary | null;
  /** Provisional A/B/C by nominal MMR selection (available from the end of S4; bands follow after S5). */
  alternatives?: OptionSummary[];
}

export interface PlanOptionResult<S> {
  label: string;
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
  /** d̃_A − d̃_option per goal (what the option gives up vs A; 0 for A). */
  costVsA: Float64Array;
  utility: number;
  /** Meets every priority floor, judged on the robust (ensemble) desirability when available — as selected. */
  strictFeasible: boolean;
  rounded: boolean;
  robust: FinalistRobustness | null;
  /** Share of ensemble draws in which A beats this option on goal 1 (null for A / no ensemble). */
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

export interface PlannerResult<S> {
  complete: boolean;
  stoppedAt: string | null;
  options: PlanOptionResult<S>[];
  shortfall: null | 'noCandidates' | 'noDistinctAlternative';
  /**
   * True when no safe finalist met even the relaxed priority floors (e.g. after the P90 chance
   * constraint tightened the plan): option A is then the safe plan with the smallest floor violation.
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
  /** S5 finalists (only with `config.diagnostics`): nominal d̃, chance feasibility and validator outcome. */
  diagnostics?: {
    finalists: Array<{ structureId: string; desirability: number[]; utility: number; safe: boolean; chanceFeasible: boolean | null; p10Violations: number[]; marginBands: number[][]; validated: boolean; relaxedFeasible: boolean }>;
  };
  provenance: {
    seed: string;
    tier: Tier;
    budgetEU: number;
    euUsed: number;
    requests: number;
    cacheHits: number;
    stageEU: Record<string, number>;
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

const ZEROS = (n: number) => new Float64Array(n);
const ONES = (n: number) => new Float64Array(n).fill(1);

class PlannerRun<S extends PlanStructure> {
  readonly goals: GoalSystem;
  readonly rng: Rng;
  readonly B: StageBudget;
  readonly tier: Tier;
  readonly K: number;
  eu = 0;
  requests = 0;
  cacheHits = 0;
  private nextId = 0;
  private readonly cache = new Map<string, EvalOutput>();
  readonly stageEU: Record<string, number> = {};
  private hist = new Float64Array(0);
  private histRows = 0;
  archive: Archive<EvalRecord> | null = null;
  activeDims: number[] = [];
  readonly early: EvalRecord[] = [];
  /**
   * Nominal records ingested before the archive switches to the final comparator (S1-S3). The archive keeps one elite
   * per cell under the provisional key, so at the switch these are re-offered under the final key: otherwise a record
   * that meets the relaxed floors but lost its cell under the provisional key (e.g. a lower-hunger plan found by a later
   * goal's anchor run) is lost to the diversity stage (WP-P diversity fix).
   */
  private readonly preFinal: EvalRecord[] = [];
  readonly anchorRec: (EvalRecord | null)[];
  leastInfeasible: EvalRecord | null = null;
  diagnostics: NonNullable<PlannerResult<unknown>['diagnostics']>['finalists'] | null = null;
  anySafe = false;
  readonly incumbents: EvalRecord[] = [];
  /** Per plan family (`problem.group`) a few candidates for its best plan. */
  private readonly groupPool = new Map<string, (EvalRecord | null)[]>();
  stoppedAt: string | null = null;
  private lastProgressEU = -Infinity;

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
    this.B = planBudget(this.tier, this.K, cfg.totalEU);
    this.anchorRec = new Array<EvalRecord | null>(this.K).fill(null);
  }

  get aborted(): boolean {
    return !!this.cfg.signal?.aborted;
  }
  remaining(): number {
    return this.B.total - this.eu;
  }
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

  // ---- evaluation service ----

  private cacheKey(p: Proposal): string {
    const q = new Int32Array(p.x.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(p.x[i]! * 1e6);
    return `${p.structure}|${p.draw}|${hashInts(q, 0x811c9dc5)}|${hashInts(q, 0x9747b28c)}`;
  }

  /** Evaluate proposals (cache + dedupe), charge EU, and build records in proposal order. */
  async evaluate(props: readonly Proposal[], stage: string): Promise<EvalRecord[]> {
    const keys = props.map((p) => this.cacheKey(p));
    const missIdx: number[] = [];
    const seen = new Set<string>();
    keys.forEach((k, i) => {
      if (!this.cache.has(k) && !seen.has(k)) {
        seen.add(k);
        missIdx.push(i);
      }
    });
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
        cost += o.cost ?? 1;
      });
      this.eu += cost;
      this.stageEU[stage] = (this.stageEU[stage] ?? 0) + cost;
    }
    this.requests += props.length;
    this.cacheHits += props.length - missIdx.length;
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

  /** Anchors, history, least-infeasible tracking and archive insertion (nominal records, candidate order). */
  ingest(r: EvalRecord): InsertResult | null {
    if (r.draw !== -1) return null;
    if (!this.finalComparator && this.archive) this.preFinal.push(r);
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
    return this.archive ? this.archive.offer(r) : null;
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
        violated: Array.from(best.out.margins).flatMap((m, c) => (m < 0 || Number.isNaN(m) ? [c] : [])),
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

  progress(
    stage: string,
    provisional: EvalRecord | null,
    force = false,
    alternatives?: readonly EvalRecord[],
  ): void {
    const cb = this.cfg.onProgress;
    if (!cb) return;
    const every = this.cfg.progressEveryEU ?? Math.max(1, Math.floor(0.02 * this.B.total));
    if (!force && this.eu - this.lastProgressEU < every) return;
    this.lastProgressEU = this.eu;
    cb({
      stage,
      euUsed: this.eu,
      euBudget: this.B.total,
      archiveSize: this.archive?.size ?? 0,
      provisional: provisional ? this.summary(provisional) : null,
      ...(alternatives ? { alternatives: alternatives.map((r) => this.summary(r)) } : {}),
    });
  }

  /**
   * Anytime A/B/C (QA item 8; release check 2026-10-01: alternatives must appear progressively, not only at the end of
   * S4): nominal MMR selection over the current pool, delivered as a forced progress event. Pure read of the pool (no
   * RNG, no evaluations), so the search is identical with or without a progress consumer.
   */
  emitAlternatives(stage: string): void {
    if (!this.cfg.onProgress) return;
    const pool = this.selectionPool();
    if (pool.length < 2) return;
    const sel = selectAlternatives(pool.map(this.asCandidate), this.distanceFn(pool), {
      count: this.cfg.optionCount ?? 3,
      lambda: this.cfg.mmrLambda,
      scoreStep: this.goals.scoreStep,
      dMin: this.cfg.dMin,
    });
    const alts = sel.chosen.map((i) => pool[i]!);
    // a later selection never shows fewer options than an earlier one: earlier picks stay valid candidates
    const count = this.cfg.optionCount ?? 3;
    for (const r of this.anytimeAlts) if (alts.length < count && !alts.some((q) => q.id === r.id)) alts.push(r);
    this.anytimeAlts = alts.slice();
    if (alts.length) this.progress(stage, alts[0]!, true, alts);
  }

  /** Last anytime A/B/C delivered (`emitAlternatives`). */
  private anytimeAlts: EvalRecord[] = [];

  /**
   * Candidate pool for selection: S3 incumbents first, then archive elites, then the best plan of each tracked family
   * (`problem.group`) when it is safe and meets the relaxed floors — the archive keeps one elite per cell and can lose it,
   * yet it is a legitimate distinct alternative (ruling R-FAST-GATE: the best plan with a fast). Deduplicated, in
   * deterministic order.
   */
  selectionPool(): EvalRecord[] {
    const seen = new Set<number>();
    const pool: EvalRecord[] = [];
    const groups = this.groupBestRecords()
      .map(([, r]) => r)
      .filter((r) => r.vS === 0 && this.goals.priorityFeasible(r.f, true));
    for (const r of [...this.incumbents, ...(this.archive?.all() ?? []), ...groups]) {
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

  // ---- CMA-ES driver ----

  async runCma(p: {
    structure: number;
    x0: ArrayLike<number>;
    sigma0: number;
    budget: number;
    stage: string;
    stream: Rng;
    key: (r: EvalRecord) => Key;
    sink?: EvalRecord[];
    ipop?: boolean;
  }): Promise<EvalRecord | null> {
    const s = this.structureOf(p.structure);
    const n = s.dim;
    if (n === 0) {
      // a structure without free genes (e.g. the status-quo plan) has nothing to search: evaluate it once (cache hit)
      const recs = await this.evaluate([{ structure: p.structure, x: new Float64Array(0), box: 0, draw: -1 }], p.stage);
      for (const r of recs) this.ingest(r);
      if (p.sink) for (const r of recs) p.sink.push(r);
      return recs[0] ?? null;
    }
    const lambda = this.lambdaFor(n);
    let bestRec: EvalRecord | null = null;
    let bestKey: Key | null = null;
    const ipop = new IpopCmaEs(
      {
        x0: p.x0,
        sigma0: p.sigma0,
        lower: ZEROS(n),
        upper: ONES(n),
        lambda,
        covariance: this.covariance,
        budgetHint: p.budget,
        discrete: s.discrete,
        tolFun: 1e-3,
        tolX: 1e-7,
        maxRestarts: p.ipop === false ? 0 : 20,
        lambdaMax: 8 * lambda,
        restartX0: () => (bestRec ? bestRec.x : p.x0),
        restartSigma0: this.cfg.sigmaExplore ?? 0.25,
      },
      p.stream,
    );
    let used = 0;
    let reqs = 0;
    while (!this.aborted && !ipop.done) {
      const lam = ipop.lambda;
      if (Math.max(used, reqs / 3) + lam > p.budget || this.remaining() < lam) break;
      const es = ipop.current;
      const xs = ipop.ask();
      const props = xs.map((x) => ({
        structure: p.structure,
        x: es.clamp(x),
        box: es.boxPenalty(x),
        draw: -1,
      }));
      const eu0 = this.eu;
      const recs = await this.evaluate(props, p.stage);
      used += this.eu - eu0;
      reqs += recs.length;
      for (const r of recs) this.ingest(r);
      const keys = recs.map(p.key);
      for (let i = 0; i < recs.length; i++) {
        if (!bestKey || compareKeys(keys[i]!, bestKey) < 0) {
          bestKey = keys[i]!;
          bestRec = recs[i]!;
        }
      }
      if (p.sink) for (const r of recs) p.sink.push(r);
      ipop.tell(keys);
      this.progress(p.stage, this.incumbents[this.incumbents.length - 1] ?? null);
    }
    return bestRec;
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

  /** Archive comparator: provisional (quantised-lexicographic) until the floors exist, then the relaxed final key. */
  private finalComparator = false;
  archiveKey = (r: EvalRecord): Key =>
    this.finalComparator
      ? this.goals.finalKey({ f: r.f, vS: r.vS, reg: r.reg }, true)
      : this.goals.provisionalKey({ f: r.f, vS: r.vS, reg: r.reg });

  // ---- stages ----

  async s0(): Promise<EvalRecord> {
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
    this.early.push(r);
    this.progress('S0', null, true);
    return r;
  }

  async s1(): Promise<number[]> {
    const nS = this.problem.structures.length;
    const cap = Math.min(nS, TIER_MAX_SCREENED[this.tier], Math.max(1, Math.floor(this.B.s1 / 5)));
    const props: Proposal[] = [];
    for (const sd of this.problem.seeds ?? []) {
      if (sd.structure < 0 || sd.structure >= nS) continue;
      const dim = this.structureOf(sd.structure).dim;
      if (sd.x.length !== dim) continue;
      props.push({ structure: sd.structure, x: Float64Array.from(sd.x, (v) => Math.min(1, Math.max(0, v))), box: 0, draw: -1 });
    }
    for (let i = 0; i < cap; i++) {
      const s = this.structureOf(i);
      props.push({ structure: i, x: this.x0Of(i), box: 0, draw: -1 });
      const lhs = latinHypercube(4, s.dim, this.rng.fork(`S1/lhs/${i}`));
      for (let m = 0; m < 4; m++)
        props.push({ structure: i, x: lhs.slice(m * s.dim, (m + 1) * s.dim), box: 0, draw: -1 });
    }
    const recs = this.aborted
      ? []
      : await this.evaluate(props.slice(0, Math.max(0, Math.min(props.length, this.remaining()))), 'S1');
    for (const r of recs) {
      this.ingest(r);
      this.early.push(r);
    }
    // archive over the active descriptors (range ≥ 0.1 across S0/S1 samples)
    const desc = this.early.map((r) => r.out.descriptors);
    this.activeDims = selectActiveDescriptors(desc, this.cfg.minDescriptorRange ?? 0.1);
    const grid = cvtCentroids(
      this.cfg.archiveCells ?? TIER_ARCHIVE_CELLS[this.tier],
      this.activeDims.length,
      this.rng.fork('cvt'),
      this.cfg.cvtSamples ?? 10000,
    );
    this.archive = new Archive<EvalRecord>(grid, this.activeDims, (r) => r.out.descriptors, this.archiveKey);
    for (const r of this.early) this.archive.offer(r);
    this.progress('S1', null, true);
    return this.shortlist(recs);
  }

  /** §4.11 shortlist: 2 structures per goal + 6 overall by the provisional key (≤ 1 per niche). */
  shortlist(recs: readonly EvalRecord[]): number[] {
    const out: number[] = [];
    const add = (s: number) => {
      if (!out.includes(s)) out.push(s);
    };
    const prov = [...recs].sort(
      (a, b) => compareKeys(this.goals.provisionalKey(a), this.goals.provisionalKey(b)) || a.id - b.id,
    );
    const niches = new Set<number>();
    for (const r of prov) {
      if (out.length >= 6) break;
      const cell = this.archive?.cellOf(r) ?? 0;
      if (niches.has(cell) || out.includes(r.structure)) continue;
      niches.add(cell);
      add(r.structure);
    }
    for (let k = 0; k < this.K; k++) {
      const byGoal = [...recs].sort((a, b) => a.vS - b.vS || b.f[k]! - a.f[k]! || a.id - b.id);
      const picked: number[] = [];
      for (const r of byGoal) {
        if (picked.length >= 2) break;
        if (!picked.includes(r.structure)) picked.push(r.structure);
      }
      picked.forEach(add);
    }
    return out;
  }

  async s2(): Promise<void> {
    for (let k = 1; k < this.K; k++) {
      if (this.aborted) return;
      if (this.goals.status(k) === 'metAtBaseline') continue;
      const start = this.bestBy(this.early, (r) => [r.vS, -r.f[k]!, r.id]);
      if (!start) continue;
      const { a, b } = this.goals.scale(k);
      const scale = Math.max(Math.abs(a - b), Math.abs(b) * 0.01, 1e-9);
      const sink: EvalRecord[] = [];
      await this.runCma({
        structure: start.structure,
        x0: start.x,
        sigma0: this.cfg.sigmaExplore ?? 0.25,
        budget: this.B.anchor,
        stage: `S2.${k + 1}`,
        stream: this.rng.fork(`S2/${k}`),
        key: (r) => this.goals.anchorKey(k, r, scale),
        sink,
      });
      for (const r of sink) this.early.push(r);
      this.progress(`S2.${k + 1}`, null, true);
    }
  }

  async s3(shortlist: readonly number[]): Promise<void> {
    let incumbent = this.bestBy(this.early, (r) => this.goals.provisionalKey(r));
    for (let k = 0; k < this.K; k++) {
      if (this.aborted || !incumbent) return;
      if (!this.goals.isActive(k)) continue;
      const stageName = `S3.${k + 1}`;
      const stageKey = (r: EvalRecord) => this.goals.stageKey(k, r);
      const pool = [...this.early, ...this.incumbents];
      const second = this.bestBy(
        pool.filter(
          (r) =>
            r.structure !== incumbent!.structure &&
            (shortlist.includes(r.structure) || this.anchorRec.includes(r)),
        ),
        stageKey,
      );
      const starts = [
        {
          rec: incumbent,
          sigma: k === 0 ? (this.cfg.sigmaExplore ?? 0.25) : (this.cfg.sigmaWarm ?? 0.1),
          share: second ? 0.6 : 1,
        },
      ];
      if (second) starts.push({ rec: second, sigma: this.cfg.sigmaExplore ?? 0.25, share: 0.4 });
      const sink: EvalRecord[] = [incumbent];
      for (let s = 0; s < starts.length; s++) {
        const st = starts[s]!;
        await this.runCma({
          structure: st.rec.structure,
          x0: st.rec.x,
          sigma0: st.sigma,
          budget: Math.floor(this.B.stage * st.share),
          stage: stageName,
          stream: this.rng.fork(`S3/${k}/${s}`),
          key: stageKey,
          sink,
        });
      }
      const winner = this.bestBy(sink, stageKey)!;
      if (winner.vS === 0) this.goals.setFloorFrom(k, winner.f[k]!);
      incumbent = winner;
      this.incumbents.push(winner);
      this.progress(stageName, winner, true);
    }
  }

  relaxedFeasibleElites(): EvalRecord[] {
    const all = this.archive?.all() ?? [];
    const ok = all.filter((r) => r.vS === 0 && this.goals.priorityFeasible(r.f, true));
    return ok.length ? ok : all;
  }

  async s4(budget: number): Promise<void> {
    const archive = this.archive;
    this.finalComparator = true;
    if (!archive || budget <= 0) return;
    archive.setComparator(this.archiveKey);
    for (const r of this.early) archive.offer(r);
    for (const r of this.preFinal) archive.offer(r);
    this.preFinal.length = 0;
    for (const r of this.incumbents) archive.offer(r);
    // the priority stages are done: first anytime A/B/C from the re-ranked archive, then every quarter of the QD budget
    this.emitAlternatives('S4');
    const altEvery = Math.max(1, Math.floor(budget / 4));
    let nextAlt = altEvery;
    const qd = this.rng.fork('S4');
    const sigma = this.cfg.sigmaQd ?? 0.15;
    interface Emitter {
      es: CmaEs;
      structure: number;
      restarts: number;
      stream: Rng;
    }
    const spawn = (e: number, restart: number): Emitter | null => {
      const stream = qd.fork(`e${e}`);
      // emitters need at least one free gene (structures of dimension 0 are evaluated, never searched)
      const pool = this.relaxedFeasibleElites().filter((r) => this.structureOf(r.structure).dim > 0);
      if (!pool.length) return null;
      const elite = pool[stream.fork(`pick${restart}`).int(pool.length)]!;
      const s = this.structureOf(elite.structure);
      const lambda = this.lambdaFor(s.dim);
      const es = new CmaEs(
        {
          x0: elite.x,
          sigma0: sigma,
          lower: ZEROS(s.dim),
          upper: ONES(s.dim),
          lambda,
          covariance: this.covariance,
          discrete: s.discrete,
          tolFun: 1e-3,
          tolX: 1e-7,
        },
        stream.fork(`r${restart}`),
      );
      return { es, structure: elite.structure, restarts: restart, stream };
    };
    const emitters: (Emitter | null)[] = [0, 1, 2].map((e) => spawn(e, 0));
    const structural = this.problem.mutateStructure ? qd.fork('structural') : null;
    const lambdaS = this.cfg.lambdaQuantum ?? TIER_LAMBDA_QUANTUM[this.tier];
    let used = 0;
    let reqs = 0;
    for (let round = 0; !this.aborted; round++) {
      const props: Proposal[] = [];
      const owner: number[] = [];
      emitters.forEach((em, e) => {
        if (!em) return;
        for (const x of em.es.ask()) {
          props.push({ structure: em.structure, x: em.es.clamp(x), box: em.es.boxPenalty(x), draw: -1 });
          owner.push(e);
        }
      });
      if (structural) {
        const rs = structural.fork(`round${round}`);
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
          for (let j = 0; j < dim; j++)
            x[j] = Math.min(1, Math.max(0, (base[j] ?? 0.5) + 0.05 * rs.normal()));
          props.push({ structure: to, x, box: 0, draw: -1 });
          owner.push(-1);
        }
      }
      if (
        !props.length ||
        Math.max(used, reqs / 3) + props.length > budget ||
        this.remaining() < props.length
      ) {
        // population asked but not evaluated: discard emitters' pending state by respawning next time
        break;
      }
      const eu0 = this.eu;
      const recs = await this.evaluate(props, 'S4');
      used += this.eu - eu0;
      reqs += recs.length;
      const status = recs.map((r) => this.ingest(r)!);
      emitters.forEach((em, e) => {
        if (!em) return;
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
      });
      if (used >= nextAlt) {
        nextAlt += altEvery;
        this.emitAlternatives('S4');
      } else this.progress('S4', this.incumbents[this.incumbents.length - 1] ?? null);
    }
  }

  /** Friendly rounding + verification (§4.9); pattern search on the grid (≤ 30 EU) if rounding breaks a floor/bound. */
  async roundAndVerify(r: EvalRecord, strict: boolean): Promise<{ rec: EvalRecord; rounded: boolean }> {
    const round = this.problem.roundGenome;
    if (!round) return { rec: r, rounded: false };
    const ok = (q: EvalRecord) => q.vS === 0 && this.goals.priorityFeasible(q.f, !strict);
    const x = round.call(this.problem, r.structure, r.x);
    let [cur] = await this.evaluate([{ structure: r.structure, x, box: 0, draw: -1 }], 'S5');
    this.ingest(cur!);
    if (ok(cur!)) return { rec: cur!, rounded: true };
    const step = this.problem.gridStep?.(r.structure);
    if (step) {
      const key = (q: EvalRecord) => this.goals.finalKey(q, !strict);
      let spent = 0;
      let improved = true;
      while (improved && spent < 30 && !this.aborted) {
        improved = false;
        for (let j = 0; j < x.length && spent < 30; j++) {
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

  distanceFn(cands: readonly EvalRecord[]): (i: number, j: number) => number {
    const custom = this.problem.distance;
    const view = (r: EvalRecord): CandidateView => ({ structure: r.structure, x: r.x, output: r.out });
    if (custom) return (i, j) => custom.call(this.problem, view(cands[i]!), view(cands[j]!));
    const feats = cands.map((r) => r.out.features ?? r.out.descriptors);
    const dims = feats[0]?.length ?? 0;
    const schema: readonly FeatureSpec[] =
      this.problem.featureSchema ?? Array.from({ length: dims }, () => ({ kind: 'numeric' as const }));
    const ranges = featureRanges(feats, dims);
    return (i, j) => gowerDistance(feats[i]!, feats[j]!, schema, ranges);
  }

  /** S5: choose finalists, round-and-verify, ensemble + chance constraints, validator, robust re-rank. */
  async s5(): Promise<{
    chosen: Array<{ rec: EvalRecord; rounded: boolean; robust: FinalistRobustness | null; dist: number }>;
    shortfall: PlannerResult<S>['shortfall'];
    floorsRelaxedForA: boolean;
  }> {
    const pool = this.selectionPool();
    const asCand = this.asCandidate;
    const M = this.cfg.ensembleSize ?? TIER_ENSEMBLE[this.tier];
    // half of S5 for the ensemble of the finalists, the rest for round-and-verify and chance-constraint repair
    const maxFin = Math.max(
      1,
      Math.min(this.cfg.maxFinalists ?? 10, M > 0 ? Math.floor((0.5 * this.B.s5) / M) : 10),
    );
    // finalists are pre-selected with half of D_min: the ensemble budget is not spent on near-duplicates of A that
    // the final selection would drop anyway, while close variants remain as fallbacks (WP-P diversity fix)
    const cand = pool.map(asCand);
    const dist = this.distanceFn(pool);
    const pre = selectAlternatives(cand, dist, {
      count: maxFin,
      lambda: this.cfg.mmrLambda,
      scoreStep: this.goals.scoreStep,
      dMin: 0.5 * (this.cfg.dMin ?? DEFAULT_D_MIN),
    });
    // remaining finalist slots: the closest variants (fallbacks when a distinct finalist fails validation or P90)
    if (pre.chosen.length < maxFin) {
      const fill = selectAlternatives(cand, dist, { count: maxFin, lambda: this.cfg.mmrLambda, scoreStep: this.goals.scoreStep, dMin: 0 });
      for (const i of fill.chosen) if (pre.chosen.length < maxFin && !pre.chosen.includes(i)) pre.chosen.push(i);
    }
    if (!pre.chosen.length) return { chosen: [], shortfall: 'noCandidates', floorsRelaxedForA: false };
    const finals: Array<{ rec: EvalRecord; rounded: boolean; robust: FinalistRobustness | null }> = [];
    for (let i = 0; i < pre.chosen.length; i++) {
      const r = pool[pre.chosen[i]!]!;
      finals.push(
        this.aborted
          ? { rec: r, rounded: false, robust: null }
          : { ...(await this.roundAndVerify(r, i === 0)), robust: null },
      );
    }
    // ensemble with common random numbers (draws 0..M-1 shared by every finalist)
    if (M > 0 && !this.aborted && this.remaining() >= finals.length * M) {
      const outs = await evaluateEnsemble(finals, M, async (batch) =>
        (
          await this.evaluate(
            batch.map((b) => ({
              structure: b.candidate.rec.structure,
              x: b.candidate.rec.x,
              box: 0,
              draw: b.draw,
            })),
            'S5',
          )
        ).map((q) => q.out),
      );
      finals.forEach(
        (f, i) => (f.robust = robustSummary(outs[i]!, this.goals, { mode: this.cfg.robustMode })),
      );
      // chance-constraint repair (§4.15 policy 2): tighten the internal bound by the observed P50−P10
      // margin gap (× CHANCE_TIGHTEN_FACTOR) and re-polish, ≤ 2 iterations × ≤ 150 EU, finalists in order.
      // Safety outranks explanations, so this may use the S6 share.
      for (const fin of finals) {
        let tighten = fin.robust!.chanceFeasible
          ? null
          : Float64Array.from(fin.robust!.tightening, (g) => CHANCE_TIGHTEN_FACTOR * g);
        for (let it = 0; it < 2 && tighten && !this.aborted; it++) {
          const polishBudget = Math.min(150, this.remaining() - M);
          if (polishBudget < 3 * this.lambdaFor(this.structureOf(fin.rec.structure).dim)) break;
          const t = tighten;
          const key = (q: EvalRecord): Key => [
            violation(q.out.margins, t),
            this.goals.floorViolation(q.f, this.K, true),
            -(this.goals.utility(q.f, q.reg) - this.goals.boxWeight * q.box),
          ];
          const best = await this.runCma({
            structure: fin.rec.structure,
            x0: fin.rec.x,
            sigma0: 0.05,
            budget: polishBudget,
            stage: 'S5',
            stream: this.rng.fork(`S5/polish/${fin.rec.id}/${it}`),
            key,
            ipop: false,
          });
          if (!best) break;
          const [ens] = await evaluateEnsemble([best], M, async (batch) =>
            (
              await this.evaluate(
                batch.map((b) => ({
                  structure: b.candidate.structure,
                  x: b.candidate.x,
                  box: 0,
                  draw: b.draw,
                })),
                'S5',
              )
            ).map((q) => q.out),
          );
          const rob = robustSummary(ens!, this.goals, { mode: this.cfg.robustMode });
          if (rob.chanceFeasible) {
            fin.rec = best;
            fin.robust = rob;
            tighten = null;
          } else tighten = Float64Array.from(t, (v, c) => v + CHANCE_TIGHTEN_FACTOR * rob.tightening[c]!);
        }
      }
    }
    // independent validator: failures are discarded, never repaired (§9)
    const valid = finals.map((f) => !this.problem.validate || this.problem.validate(f.rec.structure, f.rec.x).ok);
    const validated = finals.filter((_, i) => valid[i]);
    if (this.cfg.diagnostics)
      this.diagnostics = finals.map((f, i) => {
        const d = f.robust ? f.robust.robustD : this.goals.desirability(f.rec.f);
        return {
          structureId: this.structureOf(f.rec.structure).id,
          desirability: Array.from(this.goals.desirability(f.rec.f), (v) => +v.toFixed(4)),
          utility: +(f.robust ? f.robust.robustUtility : this.goals.utility(f.rec.f, f.rec.reg)).toFixed(4),
          safe: f.rec.vS === 0,
          chanceFeasible: f.robust ? f.robust.chanceFeasible : null,
          p10Violations: f.robust ? f.robust.margins.flatMap((b, c) => (b.p10 < 0 ? [c] : [])) : [],
          marginBands: f.robust ? f.robust.margins.map((b) => [+b.p10.toFixed(3), +b.p50.toFixed(3)]) : [],
          validated: valid[i]!,
          relaxedFeasible: this.goals.priorityFeasibleD(d, true),
        };
      });
    const cands: SelectionCandidate[] = validated.map((f) => {
      const d = f.robust ? f.robust.robustD : this.goals.desirability(f.rec.f);
      return {
        utility: f.robust ? f.robust.robustUtility : this.goals.utility(f.rec.f, f.rec.reg),
        goalScore: this.goals.utilityD(d, 0),
        safe: f.rec.vS === 0 && (!f.robust || f.robust.chanceFeasible),
        strictFeasible: this.goals.priorityFeasibleD(d, false),
        relaxedFeasible: this.goals.priorityFeasibleD(d, true),
        floorViolation: this.goals.floorViolationD(d, this.K, false),
      };
    });
    const sel = selectAlternatives(cands, this.distanceFn(validated.map((f) => f.rec)), {
      count: this.cfg.optionCount ?? 3,
      lambda: this.cfg.mmrLambda,
      scoreStep: this.goals.scoreStep,
      dMin: this.cfg.dMin,
    });
    return {
      chosen: sel.chosen.map((i, n) => ({ ...validated[i]!, dist: sel.distances[n]! })),
      shortfall: sel.shortfall,
      floorsRelaxedForA: sel.fallback,
    };
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
            structure: start.structure,
            x0: start.x,
            sigma0: 0.1,
            budget: per,
            stage: 'S6',
            stream: this.rng.fork(`S6/sweep/${i}/${j}/${level}`),
            key,
          });
          if (!best) break;
          pts.push({
            level,
            dHigher: this.goals.dRaw(i, best.f[i]!),
            dLower: this.goals.dRaw(j, best.f[j]!),
          });
          start = best;
        }
        out.push({
          higher: i,
          lower: j,
          points: pts,
          knee: kneePoint(pts.map((p) => ({ x: p.dHigher, y: p.dLower }))),
        });
      }
    return out;
  }

  async run(): Promise<PlannerResult<S>> {
    const stagesDone: string[] = [];
    const mark = (s: string) => {
      stagesDone.push(s);
      if (this.aborted && !this.stoppedAt) this.stoppedAt = s;
    };
    await this.s0();
    mark('S0');
    const shortlist = await this.s1();
    mark('S1');
    await this.s2();
    mark('S2');
    await this.s3(shortlist);
    mark('S3');
    this.early.length = 0;
    const qdBudget = Math.max(
      0,
      this.remaining() - this.B.s5 - this.B.s6 - (this.cfg.tradeoffSweep ? 800 : 0),
    );
    await this.s4(qdBudget);
    mark('S4');
    this.emitAlternatives('S4');
    const { chosen, shortfall, floorsRelaxedForA } = await this.s5();
    mark('S5');
    // the validated options are known here: anytime consumers get A/B/C before the S6 explanations run
    if (this.cfg.onProgress && chosen.length) this.progress('S5', chosen[0]!.rec, true, chosen.map((c) => c.rec));
    // S6 explanations
    const { d, u } = this.historyDesirability();
    const conflicts = conflictMatrix(d, this.K, u, this.cfg.conflict);
    const A = chosen[0]?.rec ?? null;
    const perOptionAbl = Math.max(0, Math.floor(this.B.s6 / Math.max(1, chosen.length)));
    const options: PlanOptionResult<S>[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i]!;
      const r = c.rec;
      const dRec = this.goals.desirability(r.f);
      const ablations: PlanOptionResult<S>['ablations'] = [];
      const abl = this.problem.ablations?.(r.structure, r.x) ?? [];
      if (
        abl.length &&
        !this.aborted &&
        perOptionAbl > 0 &&
        this.remaining() >= Math.min(abl.length, perOptionAbl)
      ) {
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
      const robA = chosen[0]?.robust ?? null;
      options.push({
        label: String.fromCharCode(65 + i),
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
        strictFeasible: this.goals.priorityFeasibleD(c.robust ? c.robust.robustD : dRec, false),
        rounded: c.rounded,
        robust: c.robust,
        aBeatsThisShare: i > 0 && robA && c.robust ? decisionStability(robA, c.robust, 0) : null,
        ablations,
        distanceToChosen: c.dist,
      });
    }
    const tradeoffs = await this.tradeoffs(conflicts);
    mark('S6');
    const pA = options[0]?.percentOfPossible;
    const li = this.leastInfeasible;
    return {
      complete: !this.stoppedAt,
      stoppedAt: this.stoppedAt,
      options,
      shortfall,
      floorsRelaxedForA,
      noSafePlan:
        !this.anySafe && li
          ? {
              structure: li.structure,
              x: li.x,
              vS: li.vS,
              violated: Array.from(li.out.margins).flatMap((m, c) => (m < 0 || Number.isNaN(m) ? [c] : [])),
            }
          : null,
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
      ...(this.diagnostics ? { diagnostics: { finalists: this.diagnostics } } : {}),
      provenance: {
        seed: this.rng.key,
        tier: this.tier,
        budgetEU: this.B.total,
        euUsed: this.eu,
        requests: this.requests,
        cacheHits: this.cacheHits,
        stageEU: { ...this.stageEU },
      },
    };
  }
}

function maxAbs(v: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]!));
  return m;
}

/**
 * Run the planner optimisation core. Anytime: progress callbacks carry the provisional option A;
 * if `config.signal.aborted` becomes true, remaining stages are skipped (no further evaluations) and
 * the best result so far is returned with `complete = false`.
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
