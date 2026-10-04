/**
 * Performance job of the planner benchmark: one full planner run as the app makes it, timed on a fixed number of
 * evaluator threads. 'v2' = `runLadderPlanner` (ladder, Ideal and limit costs on, time to target as in the app),
 * wired to the evaluator ports exactly like the app's coordinator; 'v1' = the frozen v1 optimiser on the same problem
 * as the planner builds it (search only: the v1 explanation and time-to-target code no longer exists).
 */
import type { EvalVariant, HostInit } from '../domain/evaluatorHost';
import { runLadderPlanner } from '../domain/ladderPlanner';
import type { PlannerRequestV2, PlannerTier } from '../domain/types';
import { createPooledEvaluator, type WorkerCall } from '../optim/pipeline';
import type { Evaluator } from '../optim/types';
import { TIER_ENSEMBLE_V1, runPlannerV1, type PlannerProblemV1 } from './baselines/v1';
import { buildR2, requestOf, type DomainEnv } from './suites/domain';
import type { ProblemSpec } from './types';

export interface PerfJob {
  kind: 'perf';
  id: number;
  request: string;
  tier: PlannerTier;
  totalEU?: number;
  path: 'v1' | 'v2';
}

export interface PerfResult {
  request: string;
  tier: PlannerTier;
  path: 'v1' | 'v2';
  ok: boolean;
  error?: string;
  wallMs: number;
  euUsed: number;
  budgetEU: number;
  status: string;
  plans: number;
  ideal: boolean;
  limitCosts: number;
  evaluators: number;
}

/** What a perf job needs from the job thread's evaluator ports. */
export interface PerfPorts {
  count: number;
  init(init: HostInit): Promise<void>;
  calls(v: EvalVariant): WorkerCall[];
  bands(option: number, v: EvalVariant, structure: number, x: Float64Array, draws: number, series: readonly string[], drawBase: number): Promise<Float32Array[]>;
  /** The domain environment of the benchmark (for the v1 problem build). */
  env: DomainEnv;
}

export async function runPerf(job: PerfJob, ports: PerfPorts, now: () => number): Promise<PerfResult> {
  const base: PerfResult = { request: job.request, tier: job.tier, path: job.path, ok: false, wallMs: 0, euUsed: 0, budgetEU: 0, status: '', plans: 0, ideal: false, limitCosts: 0, evaluators: ports.count };
  try {
    if (job.path === 'v2') {
      const request = { ...requestOf(job.request) } as PlannerRequestV2;
      let calls: ((v: EvalVariant) => WorkerCall[]) | null = null;
      const t0 = now();
      const res = await runLadderPlanner(request, {
        tier: job.tier,
        ...(job.totalEU !== undefined ? { totalEU: job.totalEU } : {}),
        now,
        ideal: true,
        limitCosts: true,
        // BENCH_NO_MEDIUM_BAND=1 times the run without the Medium band search (PLN-06 before/after)
        ...(process.env['BENCH_NO_MEDIUM_BAND'] ? { pipeline: { mediumBand: false } } : {}),
        bandsFor: (v, structure, x, draws, series, option, drawBase) => ports.bands(option, v, structure, x, draws, series, drawBase ?? 0),
        evaluatorFor: (v: EvalVariant, init: HostInit): Evaluator => {
          if (!calls) {
            const ready = ports.init(init);
            calls = (vv) =>
              ports.calls(vv).map((c) => async (batch) => {
                await ready;
                return c(batch);
              });
          }
          return createPooledEvaluator(calls(v));
        },
      });
      return {
        ...base,
        ok: true,
        wallMs: Math.round(now() - t0),
        euUsed: res.provenance.euUsed,
        budgetEU: res.provenance.budgetEU,
        status: res.status,
        plans: Object.values(res.rungs).filter(Boolean).length,
        ideal: !!res.ideal,
        limitCosts: res.ideal?.limitCosts?.length ?? 0,
      };
    }
    // v1: the problem as the planner builds it (cushion probes, goals, hooks) and the frozen optimiser
    const tier = job.tier === 'X' ? 'L' : job.tier;
    const spec: ProblemSpec = { suite: 'R2', id: `perf/${job.request}`, split: 'train', params: { request: job.request }, real: true };
    const t0 = now();
    const dp = await buildR2(spec, ports.env, 0, { selection: TIER_ENSEMBLE_V1[tier], holdout: 0 });
    if ('blocked' in dp) return { ...base, status: 'blocked' };
    const { ladder: _ladder, ...p } = dp.problem;
    const res = await runPlannerV1(p as unknown as PlannerProblemV1<never>, dp.evaluator, { seed: `perf/${job.request}`, tier, ensembleSize: dp.ensembleSize, ...(job.totalEU !== undefined ? { totalEU: job.totalEU } : {}) });
    return { ...base, ok: true, wallMs: Math.round(now() - t0), euUsed: res.provenance.euUsed, budgetEU: res.provenance.budgetEU, status: res.options.length ? 'ok' : 'noSafePlan', plans: res.options.length };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}
