/**
 * Planner coordinator (runs inside the engine worker; dossier 18 §4.19): binds evaluator ports into a pooled
 * evaluator, calibrates the device (ms per evaluation) to choose the budget tier, runs `runDomainPlanner`, throttles
 * pure progress ticks to ≤ 4 Hz (events carrying new or changed options always pass), supports cooperative cancellation (anytime result) and pause/resume (e.g. page hidden).
 */
import { runDomainPlanner, type PlannerOptions } from '@/engine/planner/domain/planner';
import { checkpointKeyOf, runLadderPlanner } from '@/engine/planner/domain/ladderPlanner';
import { replan as replanDomain } from '@/engine/planner/domain/replan';
import type { PlannerCheckpointData } from '@/engine/planner/optim/pipeline';
import type { PlannerProgressV2, PlannerRequestV2, PlannerResultV2, PlannerTier, ReplanRequest, ReplanResult } from '@/engine/planner/domain';
import { deleteCheckpoint, listCheckpoints, loadCheckpoint, saveCheckpoint } from './planner.checkpoints';
import type { EvalVariant } from '@/engine/planner/domain/evaluatorHost';
import type { PlannerProgressInfo, PlannerRequest, PlannerResult } from '@/engine/planner/domain/types';
import { createPooledEvaluator, type Tier } from '@/engine/planner/optim/pipeline';
import { EvaluatorPort, plannerBudget, workerCallsFor, type PortLike } from './planner.pool';

export interface CoordinatorOptions {
  tier?: Tier;
  /** Advanced optimiser overrides (diagnostics). */
  pipeline?: PlannerOptions['pipeline'];
  onOptimResult?: PlannerOptions['onOptimResult'];
  totalEU?: number;
  mobile?: boolean;
  timeToTarget?: boolean;
  /** Wall clock for the progress throttle (default performance.now; tests may freeze it). */
  now?: () => number;
}

export interface LadderCoordinatorOptions {
  tier?: PlannerTier;
  totalEU?: number;
  mobile?: boolean;
  timeToTarget?: boolean;
  ideal?: boolean;
  limitCosts?: boolean;
  /** Main search algorithm (dev setting; default: the hybrid, `DEFAULT_PLANNER_ALGORITHM`). */
  algorithm?: 'hybrid' | 'v2';
  /** Continue the tier X checkpoint stored under this key (discarded when it belongs to another request). */
  resumeKey?: string;
  now?: () => number;
}

export class PlannerCoordinator {
  private cancelled = false;
  private paused = false;
  private waiters: Array<() => void> = [];
  private ports: EvaluatorPort[] = [];

  /** Pause gate awaited before every batch. */
  private readonly gate = (): Promise<void> => (this.paused ? new Promise<void>((r) => this.waiters.push(r)) : Promise.resolve());

  async run(request: PlannerRequest, ports: readonly PortLike[], opts: CoordinatorOptions = {}, onProgress?: (p: PlannerProgressInfo) => void): Promise<PlannerResult> {
    this.cancelled = false;
    this.ports = ports.map((p) => new EvaluatorPort(p, this.gate));
    const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
    let tier: Tier = opts.tier ?? request.budget?.tier ?? 'S';
    let totalEU = opts.totalEU ?? request.budget?.totalEU;
    if (this.ports.length) {
      // calibration (18 §4.19): each evaluator runs the default plan; median ms per evaluation sets the tier
      await Promise.all(this.ports.map((p) => p.init({ request, ensemble: { seed: 0, size: 0 } })));
      if (!opts.tier && !request.budget?.tier) {
        const ms = await Promise.all(this.ports.map((p) => p.calibrate(3)));
        ms.sort((a, b) => a - b);
        const b = plannerBudget(ms[Math.floor(ms.length / 2)]!, this.ports.length, !!opts.mobile);
        tier = b.tier;
        totalEU = totalEU ?? b.totalEU;
      }
    }
    const isCancelled = () => this.cancelled;
    const signal = {
      get aborted() {
        return isCancelled();
      },
    };
    let calls: ((v: EvalVariant) => ReturnType<EvaluatorPort['call']>[]) | null = null;
    return runDomainPlanner(request, {
      tier,
      ...(totalEU !== undefined ? { totalEU } : {}),
      signal,
      now,
      ...(opts.timeToTarget !== undefined ? { timeToTarget: opts.timeToTarget } : {}),
      ...(opts.pipeline ? { pipeline: opts.pipeline } : {}),
      ...(opts.onOptimResult ? { onOptimResult: opts.onOptimResult } : {}),
      ...(onProgress ? { onProgress } : {}),
      ...(this.ports.length
        ? {
            // daily bands of option k on evaluator k (options run in parallel; S5 ensemble runs are reused when cached)
            bandsFor: (v, structure, x, draws, series, option) => this.ports[option % this.ports.length]!.bands(v, structure, x, draws, series),
            evaluatorFor: (v, init) => {
              if (!calls) {
                // (re)initialise every evaluator with the final ensemble chosen for this run
                const ready = Promise.all(this.ports.map((p) => p.init(init)));
                const base = workerCallsFor(this.ports);
                calls = (vv) =>
                  base(vv).map((c) => async (batch) => {
                    await ready;
                    return c(batch);
                  });
              }
              return createPooledEvaluator(calls(v));
            },
          }
        : {}),
    });
  }

  /**
   * Planner v2 (PLANNER_V2_SPEC §9.2): the ladder, the Ideal and the limit costs through the same evaluator pool. Tier X
   * saves checkpoints (IndexedDB, `planner.checkpoints.ts`) and `resumeKey` continues a saved run of the same request; a
   * checkpoint whose key does not match the request is discarded, never merged.
   */
  async runLadder(request: PlannerRequestV2, ports: readonly PortLike[], opts: LadderCoordinatorOptions = {}, onProgress?: (p: PlannerProgressV2) => void): Promise<PlannerResultV2> {
    this.cancelled = false;
    this.ports = ports.map((p) => new EvaluatorPort(p, this.gate));
    const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
    let tier: PlannerTier = opts.tier ?? (request.budget?.tier as PlannerTier | undefined) ?? 'S';
    let totalEU = opts.totalEU ?? request.budget?.totalEU;
    if (this.ports.length && !opts.tier && !request.budget?.tier) {
      await Promise.all(this.ports.map((p) => p.init({ request, ensemble: { seed: 0, size: 0 } })));
      const ms = await Promise.all(this.ports.map((p) => p.calibrate(3)));
      ms.sort((a, b) => a - b);
      const b = plannerBudget(ms[Math.floor(ms.length / 2)]!, this.ports.length, !!opts.mobile);
      tier = b.tier;
      totalEU = totalEU ?? b.totalEU;
    }
    const isCancelled = () => this.cancelled;
    const signal = {
      get aborted() {
        return isCancelled();
      },
    };
    const key = checkpointKeyOf(request);
    let resume: PlannerCheckpointData | undefined;
    if (opts.resumeKey) {
      const stored = await loadCheckpoint(opts.resumeKey);
      if (stored && stored.key === key) resume = stored.data as PlannerCheckpointData;
      else if (stored) await deleteCheckpoint(stored.key);
    }
    let calls: ((v: EvalVariant) => ReturnType<EvaluatorPort['call']>[]) | null = null;
    const res = await runLadderPlanner(request, {
      tier,
      ...(totalEU !== undefined ? { totalEU } : {}),
      signal,
      now,
      ...(opts.timeToTarget !== undefined ? { timeToTarget: opts.timeToTarget } : {}),
      ...(opts.ideal !== undefined ? { ideal: opts.ideal } : {}),
      ...(opts.limitCosts !== undefined ? { limitCosts: opts.limitCosts } : {}),
      ...(opts.algorithm ? { algorithm: opts.algorithm } : {}),
      ...(onProgress ? { onProgress } : {}),
      ...(tier === 'X'
        ? {
            checkpoint: {
              save: (cp) => saveCheckpoint({ key, createdAt: new Date().toISOString(), euUsed: cp.euUsed, stage: cp.label, request, data: cp }),
              ...(resume ? { resume } : {}),
            },
          }
        : {}),
      ...(this.ports.length
        ? {
            bandsFor: (v, structure, x, draws, series, option, base) => this.ports[option % this.ports.length]!.bands(v, structure, x, draws, series, base ?? 0),
            evaluatorFor: (v, init) => {
              if (!calls) {
                const ready = Promise.all(this.ports.map((p) => p.init(init)));
                const base = workerCallsFor(this.ports);
                calls = (vv) =>
                  base(vv).map((c) => async (batch) => {
                    await ready;
                    return c(batch);
                  });
              }
              return createPooledEvaluator(calls(v));
            },
          }
        : {}),
    });
    if (tier === 'X' && res.complete) await deleteCheckpoint(key);
    return res;
  }

  /** Resume a stored tier X search (§4.9) by its checkpoint key: the stored request is re-planned from the checkpoint. */
  async resumeLadder(checkpointKey: string, ports: readonly PortLike[], opts: LadderCoordinatorOptions = {}, onProgress?: (p: PlannerProgressV2) => void): Promise<PlannerResultV2> {
    const stored = await loadCheckpoint(checkpointKey);
    if (!stored) throw new Error('No saved long search to resume.');
    return this.runLadder(stored.request as PlannerRequestV2, ports, { ...opts, tier: 'X', resumeKey: checkpointKey }, onProgress);
  }

  /** The stored tier X checkpoint for this request, or a stale one for other goals (to be discarded), or null. */
  async checkpointFor(request: PlannerRequestV2): Promise<{ key: string; euUsed: number; stage: string; createdAt: string } | { stale: true; key: string } | null> {
    const key = checkpointKeyOf(request);
    const all = await listCheckpoints();
    const mine = all.find((c) => c.key === key);
    if (mine) return { key: mine.key, euUsed: mine.euUsed, stage: mine.stage, createdAt: mine.createdAt };
    return all[0] ? { stale: true, key: all[0].key } : null;
  }

  async discardCheckpoint(key: string): Promise<void> {
    await deleteCheckpoint(key);
  }

  /**
   * Living-plan re-plan (§7) through the evaluator pool (each evaluator builds a `ReplanEvaluatorHost` from the problem the
   * re-plan sends; without ports it evaluates in this thread). Cancellation through `cancel()`.
   */
  async replan(req: ReplanRequest, ports: readonly PortLike[] = [], onProgress?: (p: PlannerProgressV2) => void, extra: { totalEU?: number; tier?: PlannerTier } = {}): Promise<ReplanResult> {
    this.cancelled = false;
    this.ports = ports.map((p) => new EvaluatorPort(p, this.gate));
    const evPorts = this.ports;
    const isCancelled = () => this.cancelled;
    const signal = {
      get aborted() {
        return isCancelled();
      },
    };
    return replanDomain(req, {
      signal,
      ...(extra.totalEU !== undefined ? { totalEU: extra.totalEU } : {}),
      ...(extra.tier ? { tier: extra.tier } : {}),
      ...(onProgress ? { onProgress } : {}),
      ...(evPorts.length
        ? {
            evaluatorFor: (init) => {
              const ready = Promise.all(evPorts.map((p) => p.initReplan(init)));
              return createPooledEvaluator(
                evPorts.map((p) => {
                  const call = p.call(null);
                  return async (batch: Parameters<typeof call>[0]) => {
                    await ready;
                    return call(batch);
                  };
                }),
              );
            },
          }
        : {}),
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.pause(false);
  }

  pause(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      const w = this.waiters;
      this.waiters = [];
      for (const r of w) r();
    }
  }

  /** Hard stop of pending requests (workers are terminated by the client). */
  abortPending(reason = 'planning cancelled'): void {
    for (const p of this.ports) p.fail(reason);
  }
}
