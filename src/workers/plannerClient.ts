/**
 * Main-thread client of the planner (PLANNER_V2_SPEC §9.2: `planLadder`, `resumeLadder`, `replan`; the deprecated v1
 * `planRegimes`; dossier 18 §4.19): creates the evaluator pool (N = clamp(hardwareConcurrency − 1,
 * 1, 8), ≤ 3 on phones), wires one MessageChannel per evaluator to the coordinator in the engine worker, forwards
 * progress (≤ 4 Hz, with anytime options), cooperative cancellation via an AbortSignal (resolves with the best result
 * so far) and pauses while the page is hidden. `cancelPlanning()` is the hard stop (terminates the workers).
 */
import * as Comlink from 'comlink';
import type { PlannerProgressInfo, PlannerProgressV2, PlannerRequest, PlannerRequestV2, PlannerResult, PlannerResultV2, PlannerTier, TargetReach } from '@/engine/planner/domain/types';
import type { ReplanRequest, ReplanResult } from '@/engine/planner/domain/replanTypes';
import { toV1Progress, toV1Result } from '@/engine/planner/domain/compat';
import type { Tier } from '@/engine/planner/optim/pipeline';
import { cancelEngine, getEngine } from './engineClient';
import { plannerPoolSize } from './planner.pool';

export interface PlanRegimesOptions {
  onProgress?: (p: PlannerProgressInfo) => void;
  /** Abort = cooperative stop: the promise resolves with the best result so far (`complete: false`). */
  signal?: AbortSignal;
  /** Budget tier override (default: from device calibration). */
  tier?: Tier;
  /** Evaluator worker count override. */
  workers?: number;
  /** Skip the extended-horizon time-to-target searches. */
  timeToTarget?: boolean;
}

let evaluators: Worker[] = [];
let rejectCurrent: ((e: Error) => void) | null = null;

function isMobile(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobi/i.test(nav.userAgent);
}

function terminateEvaluators(): void {
  for (const w of evaluators) w.terminate();
  evaluators = [];
}

export interface PlanLadderOptions {
  onProgress?: (p: PlannerProgressV2) => void;
  /** Abort = cooperative stop: resolves with the best result so far (`complete: false`; tier X keeps its checkpoint). */
  signal?: AbortSignal;
  tier?: PlannerTier;
  workers?: number;
  /** Ideal plan and limit costs (both default true). */
  ideal?: boolean;
  limitCosts?: boolean;
  /** Main search algorithm (dev setting `localStorage['vitals.dev.plannerAlgorithm']`; default: the hybrid). */
  algorithm?: 'hybrid' | 'v2';
  timeToTarget?: boolean;
}

/** Evaluator pool size for a tier: clamp(cores − 1, 1, 8) on S/M/L (≤ 3 on phones); tier X may use up to 16 (§4.10). */
function poolSizeFor(tier: PlannerTier | undefined, mobile: boolean, workers?: number): number {
  if (workers !== undefined) return Math.max(1, Math.floor(workers));
  const hc = navigator.hardwareConcurrency;
  if (tier === 'X' && !mobile) return Math.max(1, Math.min(16, (Number.isFinite(hc) && hc > 0 ? hc : 4) - 1));
  return plannerPoolSize(hc, mobile);
}

async function withPool<T>(tier: PlannerTier | undefined, workers: number | undefined, signal: AbortSignal | undefined, run: (engine: ReturnType<typeof getEngine>, ports: MessagePort[], mobile: boolean) => Promise<T>): Promise<T> {
  terminateEvaluators();
  const mobile = isMobile();
  const n = poolSizeFor(tier, mobile, workers);
  const ports: MessagePort[] = [];
  if (typeof Worker !== 'undefined' && typeof MessageChannel !== 'undefined') {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./planner.evaluator.worker.ts', import.meta.url), { type: 'module', name: `vitals-planner-eval-${i}` });
      const ch = new MessageChannel();
      w.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
      evaluators.push(w);
      ports.push(ch.port2);
    }
  }
  const engine = getEngine();
  const onAbort = () => void engine.cancelPlan();
  signal?.addEventListener('abort', onAbort, { once: true });
  const onVisibility = () => void engine.pausePlan(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  // tier X holds a Web Lock while it runs (§4.9), so a second tab cannot start another exhaustive search
  const lock = tier === 'X' && typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator as Navigator & { locks: LockManager }).locks : null;
  const go = async () => {
    const hardStop = new Promise<never>((_, reject) => (rejectCurrent = reject));
    return Promise.race([run(engine, ports, mobile), hardStop]);
  };
  try {
    return lock ? await lock.request('vitals-planner-exhaustive', go) : await go();
  } finally {
    rejectCurrent = null;
    signal?.removeEventListener('abort', onAbort);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    terminateEvaluators();
  }
}

/** Planner v2: the ladder (Hard · Medium · Easy), the Ideal and the limit costs (PLANNER_V2_SPEC §9.2). */
export function planLadder(request: PlannerRequestV2, options: PlanLadderOptions = {}): Promise<PlannerResultV2> {
  const tier = options.tier ?? (request.budget?.tier as PlannerTier | undefined);
  return withPool(tier, options.workers, options.signal, (engine, ports, mobile) => {
    const opts = { mobile, ...(tier ? { tier } : {}), ...(options.timeToTarget !== undefined ? { timeToTarget: options.timeToTarget } : {}), ...(options.ideal !== undefined ? { ideal: options.ideal } : {}), ...(options.limitCosts !== undefined ? { limitCosts: options.limitCosts } : {}), ...(options.algorithm ? { algorithm: options.algorithm } : {}) };
    const progress = options.onProgress ? Comlink.proxy(options.onProgress) : undefined;
    return engine.planLadder(request, Comlink.transfer(ports, ports), opts, progress);
  });
}

/** Continue a saved exhaustive (tier X) search (§4.9); rejects when no checkpoint is stored under the key. */
export function resumeLadder(checkpointKey: string, options: Omit<PlanLadderOptions, 'tier'> = {}): Promise<PlannerResultV2> {
  return withPool('X', options.workers, options.signal, (engine, ports, mobile) => {
    const progress = options.onProgress ? Comlink.proxy(options.onProgress) : undefined;
    return engine.resumeLadder(checkpointKey, Comlink.transfer(ports, ports), { mobile, tier: 'X', ...(options.ideal !== undefined ? { ideal: options.ideal } : {}), ...(options.limitCosts !== undefined ? { limitCosts: options.limitCosts } : {}) }, progress);
  });
}

/**
 * The stored exhaustive-search checkpoint for this request, if any: `{ key, euUsed, stage, createdAt }`, or
 * `{ stale: true }` when only a checkpoint for other goals exists ("An earlier long search was for different goals, so it
 * was set aside." — the UI deletes it with `discardCheckpoint`).
 */
export async function hasCheckpoint(request: PlannerRequestV2): Promise<{ key: string; euUsed: number; stage: string; createdAt: string } | { stale: true; key: string } | null> {
  return getEngine().checkpointFor(request);
}
export async function discardCheckpoint(key: string): Promise<void> {
  await getEngine().discardCheckpoint(key);
}

/**
 * Living-plan re-plan (§7; E5 calls it through its PlannerPort). Coordinated in the engine worker beside any planner run,
 * with its own small evaluator pool (≤ 3 workers) that ends with the call; abort = cooperative stop.
 */
export async function replan(req: ReplanRequest, options: { signal?: AbortSignal; onProgress?: (p: PlannerProgressV2) => void; workers?: number; tier?: PlannerTier } = {}): Promise<ReplanResult> {
  const own: Worker[] = [];
  const ports: MessagePort[] = [];
  if (typeof Worker !== 'undefined' && typeof MessageChannel !== 'undefined') {
    const n = Math.max(1, Math.min(options.workers ?? 3, plannerPoolSize(navigator.hardwareConcurrency, isMobile())));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./planner.evaluator.worker.ts', import.meta.url), { type: 'module', name: `vitals-replan-eval-${i}` });
      const ch = new MessageChannel();
      w.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
      own.push(w);
      ports.push(ch.port2);
    }
  }
  const engine = getEngine();
  const onAbort = () => void engine.cancelReplan();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const progress = options.onProgress ? Comlink.proxy(options.onProgress) : undefined;
    return await engine.replan(req, Comlink.transfer(ports, ports), progress, options.tier ? { tier: options.tier } : {});
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    for (const w of own) w.terminate();
  }
}

/**
 * @deprecated (PLANNER_V2_SPEC §9.6; removed in 0.3.0) — the v1 shape over `planLadder` without the Ideal: options are the
 * rungs Hard, Medium, Easy with ids 'A', 'B', 'C'; the v2 result rides along as `v2`. New code calls `planLadder`.
 */
export async function planRegimes(request: PlannerRequest, options: PlanRegimesOptions = {}): Promise<PlannerResult> {
  const v2 = await planLadder(request, {
    ideal: false,
    limitCosts: false,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.tier ? { tier: options.tier } : {}),
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
    ...(options.timeToTarget !== undefined ? { timeToTarget: options.timeToTarget } : {}),
    ...(options.onProgress ? { onProgress: (p: PlannerProgressV2) => options.onProgress!(toV1Progress(p)) } : {}),
  });
  return toV1Result(v2);
}

/** Hard stop: terminates the evaluator pool and the engine worker (the pending promise rejects). */
export function cancelPlanning(): void {
  terminateEvaluators();
  cancelEngine();
  rejectCurrent?.(new DOMException('Planning cancelled', 'AbortError'));
}

// ------------------------------------------------------------------------------------------ pre-run estimate (R-TTT)

let reachWorker: Worker | null = null;
let reachSeq = 0;
const reachPending = new Map<number, { resolve: (r: TargetReach[]) => void; reject: (e: Error) => void }>();

/**
 * The Goals screen's "reachable in this horizon" / time-to-target estimate, computed off the main thread by the same
 * function the planner uses for `feasibility[i].requiredWeeks` (`estimateTargets`, ruling R-TTT), so the two never
 * disagree. One long-lived worker keeps the route cache: the first call for a profile costs ≈ 0.1-0.5 s, later calls
 * that change only target amounts or the horizon are lookups. Without Worker support it runs in the calling thread.
 */
export async function estimateTargetsAsync(request: PlannerRequest): Promise<TargetReach[]> {
  if (typeof Worker === 'undefined') {
    const { estimateTargets } = await import('@/engine/planner/domain/reach');
    return estimateTargets(request);
  }
  if (!reachWorker) {
    reachWorker = new Worker(new URL('./planner.reach.worker.ts', import.meta.url), { type: 'module', name: 'vitals-planner-reach' });
    reachWorker.onmessage = (ev: MessageEvent) => {
      const { id, result, error } = ev.data as { id: number; result?: TargetReach[]; error?: string };
      const p = reachPending.get(id);
      if (!p) return;
      reachPending.delete(id);
      if (error !== undefined) p.reject(new Error(error));
      else p.resolve(result ?? []);
    };
  }
  const id = ++reachSeq;
  return new Promise<TargetReach[]>((resolve, reject) => {
    reachPending.set(id, { resolve, reject });
    reachWorker!.postMessage({ id, request });
  });
}
