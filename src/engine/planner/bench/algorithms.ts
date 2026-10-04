/**
 * The algorithms under test behind one interface: 'v1' = the frozen v1 optimiser (`baselines/v1`), 'v2' = the live
 * optimiser (`../optim`), 'v1b' = a second copy of v1 (the v1-vs-v1 sanity run). Same problem, same evaluator, same
 * seed. The live result is read defensively (its v2 fields — ladder, convergence, holdout gap — may or may not exist
 * yet), so the harness runs before, during and after the v2 work.
 */
import { runPlannerV1, type PlannerConfigV1, type PlannerProblemV1 } from './baselines/v1';
import * as live from '../optim/pipeline';
import { runPlannerWith } from '../optim/hybrid';
import * as liveTypes from '../optim/types';
import type { EvalOutput, Evaluator, PlanStructure } from '../optim/types';
import type { AlgoId, BenchTier } from './types';

/** Draw index of holdout member m is HOLDOUT_DRAW_OFFSET + m (optimiser v2 contract). */
export const HOLDOUT_DRAW_OFFSET: number = ((liveTypes as Record<string, unknown>)['HOLDOUT_DRAW_OFFSET'] as number | undefined) ?? 1 << 20;

/** Ladder options of a problem (optimiser v2 contract `PlannerProblem.ladder`; v1 ignores it). */
export interface LadderSpec {
  gMinMetric: number;
  easyShare?: number;
  mediumShare?: number;
  qD?: number;
  minDGap?: number;
  minGower?: number;
}

/** True when the live optimiser exposes the v2 API (holdout ensembles and the ladder result). */
export function liveIsV2(): boolean {
  return 'TIER_HOLDOUT' in live;
}

/** Live selection / holdout ensemble sizes per tier (v2 tables when present, else v1's selection sizes and no holdout). */
export function liveEnsembles(tier: BenchTier): { selection: number; holdout: number } {
  const L = live as unknown as Record<string, Record<string, number> | undefined>;
  const sel = L['TIER_ENSEMBLE']?.[tier] ?? 16;
  const hold = L['TIER_HOLDOUT']?.[tier] ?? 0;
  return { selection: sel, holdout: hold };
}

export interface AlgoPlan {
  role: string;
  structure: number;
  structureId: string;
  x: Float64Array;
  output: EvalOutput;
  D: number | null;
}

export interface AlgoOutcome {
  ok: boolean;
  error?: string;
  complete: boolean;
  plans: AlgoPlan[];
  euUsed: number;
  budgetEU: number;
  archive: { cells: number; filled: number } | null;
  ladder: null | {
    rungs: string[];
    collapsed: Array<{ rung: string; reason: string }>;
    checks: { dHM: number; dME: number; gowerMin: number; ordered: boolean } | null;
    staircase: Array<[number, number]>;
  };
  holdoutGap: number[] | null;
  /** Best plan per `problem.group` family (fasting rival): the 'fast' family was evaluated. */
  groupFast: boolean;
  convergencePoints: number;
}

export interface AlgoConfig {
  seed: string;
  tier: BenchTier;
  totalEU?: number;
  ensembleSize: number;
  holdoutSize?: number;
  strictness?: 'strict' | 'balanced' | 'flexible';
  now?: () => number;
}

type AnyOption = {
  label?: string;
  rung?: string;
  D?: number;
  structureIndex: number;
  structure: PlanStructure;
  x: Float64Array;
  output: EvalOutput;
};

function readResult(res: Record<string, unknown>, ladderSet: boolean): Omit<AlgoOutcome, 'ok' | 'error'> {
  const options = (res['options'] as AnyOption[] | undefined) ?? [];
  const prov = (res['provenance'] as { euUsed?: number; budgetEU?: number } | undefined) ?? {};
  const arch = res['archive'] as { cells?: number; filled?: number } | undefined;
  const lad = res['ladder'] as
    | null
    | undefined
    | {
        rungs?: Record<string, AnyOption | null>;
        collapsed?: Array<{ rung: string; reason: string }>;
        checks?: { dHM: number; dME: number; gowerMin: number; ordered: boolean };
        staircase?: Array<{ D: number; g: number }>;
      };
  const plans: AlgoPlan[] = options.map((o, i) => ({
    role: o.rung ?? o.label ?? String.fromCharCode(65 + i),
    structure: o.structureIndex,
    structureId: o.structure?.id ?? String(o.structureIndex),
    x: Float64Array.from(o.x),
    output: o.output,
    D: typeof o.D === 'number' ? o.D : ladderSet && o.output.descriptors.length ? Number(o.output.descriptors[0]) : null,
  }));
  const gb = res['groupBest'] as Record<string, unknown> | undefined;
  const gap = res['holdoutGap'];
  const conv = res['convergence'];
  return {
    complete: res['complete'] !== false,
    plans,
    euUsed: prov.euUsed ?? 0,
    budgetEU: prov.budgetEU ?? 0,
    archive: arch && typeof arch.cells === 'number' ? { cells: arch.cells, filled: arch.filled ?? 0 } : null,
    ladder: lad
      ? {
          rungs: Object.entries(lad.rungs ?? {})
            .filter(([, v]) => !!v)
            .map(([k]) => k),
          collapsed: (lad.collapsed ?? []).map((c) => ({ rung: c.rung, reason: c.reason })),
          checks: lad.checks ? { dHM: lad.checks.dHM, dME: lad.checks.dME, gowerMin: lad.checks.gowerMin, ordered: lad.checks.ordered } : null,
          staircase: (lad.staircase ?? []).map((p) => [p.D, p.g] as [number, number]),
        }
      : null,
    holdoutGap: Array.isArray(gap) ? gap.map(Number) : null,
    groupFast: !!gb?.['fast'],
    convergencePoints: Array.isArray(conv) ? conv.length : 0,
  };
}

/** Run one algorithm on a problem. Failures are reported in the outcome (never thrown), so a pair always completes. */
export async function runAlgorithm<S extends PlanStructure>(
  algo: AlgoId,
  problem: live.PlannerProblem<S> & { ladder?: LadderSpec },
  evaluator: Evaluator,
  cfg: AlgoConfig,
): Promise<AlgoOutcome> {
  const empty = { complete: false, plans: [], euUsed: 0, budgetEU: cfg.totalEU ?? 0, archive: null, ladder: null, holdoutGap: null, groupFast: false, convergencePoints: 0 };
  try {
    if (algo === 'v1' || algo === 'v1b') {
      const { ladder: _ladder, ...p } = problem;
      const c: PlannerConfigV1 = { seed: cfg.seed, tier: cfg.tier, ensembleSize: cfg.ensembleSize };
      if (cfg.totalEU !== undefined) c.totalEU = cfg.totalEU;
      if (cfg.strictness) c.strictness = cfg.strictness;
      const res = await runPlannerV1(p as unknown as PlannerProblemV1<S>, evaluator, c);
      return { ok: true, ...readResult(res as unknown as Record<string, unknown>, false) };
    }
    const c: Record<string, unknown> = { seed: cfg.seed, tier: cfg.tier, ensembleSize: cfg.ensembleSize };
    if (cfg.totalEU !== undefined) c['totalEU'] = cfg.totalEU;
    if (cfg.strictness) c['strictness'] = cfg.strictness;
    if (cfg.holdoutSize !== undefined) c['holdoutSize'] = cfg.holdoutSize;
    if (cfg.now) c['now'] = cfg.now;
    const res = algo === 'hybrid' ? await runPlannerWith('hybrid', problem, evaluator, c as unknown as live.PlannerConfig) : await live.runPlanner(problem, evaluator, c as unknown as live.PlannerConfig);
    return { ok: true, ...readResult(res as unknown as Record<string, unknown>, !!problem.ladder) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(e), ...empty };
  }
}
