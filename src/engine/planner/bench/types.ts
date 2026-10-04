/**
 * Shared types of the planner benchmark harness: problem specs (plain data, sent to worker threads), the per-run raw
 * record a job returns, and the reference a run is judged against.
 */
import type { GoalRef, TracePoint } from './metrics';
import type { PerfJob, PerfResult } from './perf';

export type SuiteId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'R1' | 'R2';
export const SUITES: readonly SuiteId[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'R1', 'R2'];
export type Split = 'train' | 'holdout';
/** 'v1' = the frozen v1 optimiser, 'v2' = the live optimiser, 'v1b' = a second copy of v1 (sanity: v1 vs v1). */
export type AlgoId = 'v1' | 'v2' | 'v1b' | 'hybrid';
export type BenchTier = 'S' | 'M' | 'L';

/** Serialisable description of one benchmark problem (built into a runnable problem inside the job worker). */
export interface ProblemSpec {
  suite: SuiteId;
  /** Unique id, e.g. 'T2/train/k3-s8'. */
  id: string;
  split: Split;
  /** Suite-specific parameters (plain data). */
  params: Record<string, unknown>;
  /** Needs the real engine (evaluator pool). */
  real: boolean;
}

/** Reference (ground truth) a run is judged against, when the problem knows it before the runs. */
export interface ReferenceSummary {
  goals: GoalRef[];
  /** d̃ of the reference plan (x*) on the benchmark scale. */
  dStar: number[];
  /** G(x*) (weighted goal score), the 100 % of "attainment". */
  gStar: number;
  /** Reference front of the attainment-difficulty plane (g, D), when known. */
  front?: Array<[number, number]>;
  /** The analytic ladder (Hard, Medium, Easy as (g, D)) for the rung hypervolume ratio, when known. */
  rungs?: Array<[number, number]>;
  /** Exact (analytic / exhaustive) or best found. */
  exact: boolean;
  /** Where x* came from (text for the report). */
  source: string;
  /** Free-form reference details (x*, enumeration size, ...). */
  detail?: Record<string, unknown>;
}

/** One returned plan of a run, in plain numbers. */
export interface PlanRecord {
  /** 'hard' | 'medium' | 'easy' (ladder runs) or 'A' | 'B' | 'C'. */
  role: string;
  structure: number;
  structureId: string;
  x: number[];
  /** Nominal raw goal functionals (metric units). */
  raw: number[];
  vS: number;
  /** Difficulty (first descriptor) when the problem defines it, else NaN. */
  D: number;
  features: number[];
  /** Independent validation (real engine) / nominal feasibility (toys). */
  valid: boolean;
  /** Uses a fast (real engine). */
  fasts?: boolean;
  /** Smallest share of draws in which a margin holds, over all margins (fresh 256-draw ensemble or exact), and whether every margin holds in ≥ 90 % of draws. */
  safety?: { minShare: number; ok90: boolean; draws: number };
  /** Per goal: mean d̃ on the selection ensemble − mean d̃ on an independent ensemble (Hard only; harness-measured). */
  gap?: number[];
  /** Raw goal values per draw of the selection ensemble and of the fresh 256-draw ensemble (real engine, Hard only). */
  drawsSel?: number[][];
  drawsFresh?: number[][];
  /** Noisy suite: exact expectation, CVaR₀.₂ and P(target met) of d̃ per goal, and P(every constraint holds). */
  exact?: { meanRaw: number[]; cvarD: number[]; pFeasible: number };
}

export interface RunRecord {
  suite: SuiteId;
  problem: string;
  split: Split;
  algo: AlgoId;
  seed: number;
  tier: BenchTier;
  ok: boolean;
  error?: string;
  euUsed: number;
  budgetEU: number;
  wallMs: number;
  complete: boolean;
  plans: PlanRecord[];
  /** Anytime trace: feasible nominal evaluations that were non-dominated when they happened. */
  trace: TracePoint[];
  /** Visited-archive QD on the problem's own scale (toys), else null. */
  qd: { score: number; coverage: number } | null;
  /** The algorithm's own archive size. */
  archive: { cells: number; filled: number } | null;
  /** v2 ladder summary when the result carries one. */
  ladder: null | {
    rungs: string[];
    collapsed: Array<{ rung: string; reason: string }>;
    checks: { dHM: number; dME: number; gowerMin: number; ordered: boolean } | null;
    staircase: Array<[number, number]>;
  };
  /** v2's own selection − holdout gap per goal. */
  holdoutGapAlgo: number[] | null;
  /** Best plan the run evaluated with a fast (real engine, fasting-relevant requests). */
  fastEvaluated?: boolean;
  /** Returned plans that break a nominal margin or fail the independent validator (must be 0). */
  safetyViolations: number;
  /** Goal scale known when the run was made (toys and R1: final; R2: provisional, completed after all runs). */
  goals: GoalRef[];
  /** Reference when known before the runs (toys, R1). */
  reference: ReferenceSummary | null;
  /** Extra per-problem facts (R2: fasting served, has targets, ...). */
  info?: Record<string, unknown>;
}

/** A job a worker runs: one (problem, seed) with every algorithm (paired, common random numbers). */
export interface RunJob {
  kind: 'run';
  id: number;
  spec: ProblemSpec;
  seed: number;
  tier: BenchTier;
  algos: AlgoId[];
  /** Reference computed earlier (R1) or loaded from the cache. */
  reference?: ReferenceSummary | null;
  /** Override of the tier's EU budget (smoke test). */
  totalEU?: number;
}

/** Exhaustive reference of an R1 micro space. */
export interface ReferenceJob {
  kind: 'r1ref';
  id: number;
  spec: ProblemSpec;
}

export type Job = RunJob | ReferenceJob | PerfJob;

export type JobResult = { kind: 'run'; id: number; records: RunRecord[] } | { kind: 'r1ref'; id: number; reference: ReferenceSummary } | { kind: 'perf'; id: number; result: PerfResult };
