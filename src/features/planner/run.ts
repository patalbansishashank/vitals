/**
 * Optimiser run orchestration (planner-goals.md §7 "Find plans", "Stop"; plan-ladder.md §8 states). The run is the
 * `planner.find` command's job, so it continues when the user navigates away: the Plan destination shows a progress dot
 * and a toast offers the results when they arrive. State lives in the planner store (`run`, the v1 view of the result
 * with the ladder on `result.v2`), in memory only; the ladder-only extras of a run (its convergence curve, provisional
 * rungs by kind, the exhaustive tier) live in `useLadderRun` below.
 *
 *   startPlannerRun(request, hash, { tier? , resumeKey? })  → planner.find: status 'running'; result → 'done'
 *   stopPlannerRun()                                          → planner.stop: cooperative stop, keeps what was found
 *   cancelPlannerRun()                                        → job.cancel: hard stop (workers terminated), no result
 *
 * This module installs the Planner port the command runs through: the request the screen built, the worker pool. The
 * command forwards only the request, so the tier travels in it (`request.budget.tier`); tier X (the exhaustive search)
 * starts only from "Find the best possible plan".
 */
import { create } from 'zustand';
import { toast } from '@/components';
import { setNavBadge } from '@/app/shell';
import { currentPlannerJob, dispatch, installPorts, jobs } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { toV1Progress, toV1Result } from '@/engine/planner/domain/compat';
import { keepAfterStop, stoppedResultWorse } from '@/engine/planner/domain/stoppedLadder';
import type {
  BudgetTier,
  ConvergencePoint,
  PlanKind,
  PlannerProgressInfo,
  PlannerProgressV2,
  PlannerRequest,
  PlannerRequestV2,
  PlannerResult,
  PlannerResultV2,
  PlannerTier,
} from '@/engine/planner/domain/types';
import { usePlannerStore } from '@/state/plannerStore';
import { cancelPlanning, planLadder, resumeLadder, type PlanLadderOptions } from './plannerClient';

export interface RunOptions {
  tier?: PlannerTier;
  /** Resume a stored exhaustive search instead of starting over. */
  resumeKey?: string;
}

type Provisional = NonNullable<PlannerProgressV2['provisional'][PlanKind]>;

export interface LadderRunState {
  /** Tier of the current (or last) run; 'X' = exhaustive search. */
  tier: PlannerTier | null;
  /** Convergence points streamed by the current run (best goal score and ladder hypervolume against evaluations). */
  convergence: ConvergencePoint[];
  /** Provisional rungs and Ideal as last seen during the run. */
  provisional: Partial<Record<PlanKind, Provisional>>;
  /** The result shown while an exhaustive search for the same goals replaces it ("results update in place"). */
  previous: PlannerResult | null;
  /** Rounds counted when the user chose "Continue" after a plateau (asked again two rounds later). */
  plateauSeenAt: number;
}

const INITIAL: LadderRunState = { tier: null, convergence: [], provisional: {}, previous: null, plateauSeenAt: 0 };

/** Ladder extras of the current run (feature state, not user data). */
export const useLadderRun = create<LadderRunState>()(() => ({ ...INITIAL }));

/** Record one v2 progress event (exported for tests). */
export function recordLadderProgress(p: PlannerProgressV2): void {
  useLadderRun.setState((s) => {
    const provisional = { ...s.provisional };
    for (const [k, v] of Object.entries(p.provisional ?? {})) if (v) provisional[k as PlanKind] = v;
    const last = s.convergence[s.convergence.length - 1];
    const convergence = p.convergence && (!last || p.convergence.eu > last.eu) ? [...s.convergence, p.convergence] : s.convergence;
    return { provisional, convergence };
  });
}

/**
 * Plateau of an exhaustive search: the convergence points split into rounds at every stage change; two rounds in a row
 * without a better goal score than every round before them.
 */
export function plateauOf(points: readonly ConvergencePoint[]): { rounds: number; plateau: boolean } {
  const best: number[] = [];
  let stage: string | null = null;
  for (const p of points) {
    if (p.stage !== stage) {
      best.push(p.G);
      stage = p.stage;
    } else best[best.length - 1] = Math.max(best[best.length - 1]!, p.G);
  }
  const n = best.length;
  if (n < 3) return { rounds: n, plateau: false };
  const before = Math.max(...best.slice(0, n - 2));
  return { rounds: n, plateau: best[n - 1]! <= before + 1e-6 && best[n - 2]! <= before + 1e-6 };
}

/** "Continue" after a plateau: ask again after two more rounds. */
export function continueSearch(): void {
  useLadderRun.setState({ plateauSeenAt: plateauOf(useLadderRun.getState().convergence).rounds + 2 });
}

let prepared: { request: PlannerRequest; hash: string } | null = null;
let published: { request: PlannerRequest; hash: string } | null = null;
let plannerVisible = false;
let openResults: (() => void) | null = null;
const RUN_OPTS = new WeakMap<object, RunOptions>();

interface PortOptions {
  signal: AbortSignal;
  onProgress: (p: PlannerProgressInfo) => void;
}

async function runPort(request: PlannerRequestV2, options: PortOptions): Promise<PlannerResult> {
  const extra = RUN_OPTS.get(request) ?? {};
  const tier = (request.budget?.tier as PlannerTier | undefined) ?? extra.tier;
  const opts: PlanLadderOptions = {
    signal: options.signal,
    onProgress: (p) => {
      recordLadderProgress(p);
      options.onProgress(toV1Progress(p));
    },
  };
  // dev setting: run the v2 search alone instead of the shipped hybrid (docs/PLANNER_BENCHMARK.md)
  const dev = typeof localStorage !== 'undefined' ? localStorage.getItem('vitals.dev.plannerAlgorithm') : null;
  if (dev === 'v2' || dev === 'hybrid') opts.algorithm = dev;
  // a longer search of the same request re-checks the shown Medium and Easy and keeps them when its own collapse
  const prev = useLadderRun.getState().previous?.v2;
  const previous = prev ? previousLadder(prev) : undefined;
  const req: PlannerRequestV2 = previous ? { ...request, previous } : request;
  const v2 = extra.resumeKey ? await resumeLadder(extra.resumeKey, opts) : await planLadder(req, { ...opts, ...(tier ? { tier } : {}) });
  if (v2.convergence?.length) useLadderRun.setState({ convergence: v2.convergence });
  // "Stopping keeps the plans found so far": a stopped search worse than or less complete than the ladder on screen
  // leaves that ladder in place and says the search was stopped
  const worse = prev ? stoppedResultWorse(v2, prev) : null;
  if (prev && worse) return toV1Result(keepAfterStop(prev, v2, worse));
  return toV1Result(v2);
}

/**
 * The rung genomes of a shown ladder, for the next (longer) search of the same request: Medium and Easy are re-checked
 * and kept when its own collapse; Hard is weighed only when that search is stopped early ("Stop here").
 */
export function previousLadder(v2: PlannerResultV2): PlannerRequestV2['previous'] {
  if (v2.status !== 'ok') return undefined;
  const rungs: NonNullable<PlannerRequestV2['previous']>['rungs'] = {};
  for (const r of ['hard', 'medium', 'easy'] as const) {
    const g = v2.rungs[r]?.genome;
    if (g) rungs[r] = { structureId: g.structureId, x: [...g.x] };
  }
  return rungs.hard || rungs.medium || rungs.easy ? { tier: v2.provenance.tier, rungs } : undefined;
}

installPorts({
  planner: {
    prepare: () => prepared ?? published,
    run: (request, options) => runPort(request as PlannerRequestV2, options as PortOptions),
    cancel: () => cancelPlanning(),
  },
});

/**
 * The current request as the Planner screens build it, kept fresh by `PlannerRequestPublisher` (mounted with the
 * Coach), so `planner.find` from the Coach or an agent has a request to run, not only the Planner's own Find plans.
 */
export function publishPlannerRequest(request: PlannerRequest | null, hash: string | null): void {
  published = request && hash ? { request, hash } : null;
}

/** The Planner page reports whether it is on screen (no completion toast while it is). */
export function setPlannerVisible(visible: boolean): void {
  plannerVisible = visible;
}

/** How the completion toast opens the results (a router navigate captured by the page). */
export function setOpenResults(fn: (() => void) | null): void {
  openResults = fn;
}

export function isPlannerRunning(): boolean {
  const s = usePlannerStore.getState().run.status;
  return s === 'running' || s === 'stopping';
}

export async function startPlannerRun(request: PlannerRequest, hash: string, opts: RunOptions = {}): Promise<void> {
  if (isPlannerRunning()) return;
  const req: PlannerRequest = opts.tier ? { ...request, budget: { ...request.budget, tier: opts.tier as BudgetTier } } : request;
  RUN_OPTS.set(req, opts);
  const before = usePlannerStore.getState().run;
  useLadderRun.setState({
    ...INITIAL,
    tier: opts.tier ?? null,
    previous: before.result && before.requestHash === hash ? before.result : null,
  });
  prepared = { request: req, hash };
  // the recorded tier is the one that runs: with no tier the engine searches at its default, the quick tier S (Q3-J4-03)
  const started = dispatch('planner.find', { tier: opts.tier ?? 'S' });
  prepared = null;
  const res = await started;
  // E20: markers — a pending blood-result re-ask pauses the search: say why
  if (!res.ok && res.error.detail?.precondition === 'markerReask') toast(res.error.message, { id: 'planner-marker-reask', duration: 10000 });
  if (!res.ok || !('job' in res)) return;
  setNavBadge('plan', true);
  try {
    const status = await jobs.wait(res.job.jobId);
    const result = usePlannerStore.getState().run.result;
    if (result) useLadderRun.setState({ previous: null });
    if (status.state === 'done' && result && !plannerVisible) {
      const n = result.options.length;
      toast(n > 0 ? `Plans ready · ${n} plan${n === 1 ? '' : 's'}` : 'The Planner finished · no safe plan found', {
        id: 'planner-ready',
        duration: 8000,
        action: openResults ? { label: 'Open', onClick: () => openResults?.() } : undefined,
      });
    }
  } finally {
    setNavBadge('plan', false);
  }
}

/** Cooperative stop: the optimiser finishes its current step and returns the best plans so far. */
export function stopPlannerRun(): void {
  void sendCommand('planner.stop', {});
}

/** Hard stop before any plan exists: terminates the workers. */
export function cancelPlannerRun(): void {
  const jobId = currentPlannerJob();
  if (jobId) void sendCommand('job.cancel', { jobId });
}
