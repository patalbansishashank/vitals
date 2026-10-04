import * as Comlink from 'comlink';
import { buildModelParams, compileSchedule, MODULES, resolveProfile, runEngine, sampleParams, simulate } from '@/engine';
import type { PersonProfile, PlanRequest, RunOptions, Schedule, SeriesId } from '@/engine';
import type { PlannerProgressInfo, PlannerProgressV2, PlannerRequestV2, PlannerTier, ReplanRequest } from '@/engine/planner';
import { PlannerCoordinator, type CoordinatorOptions, type LadderCoordinatorOptions } from './planner.coordinator';

const plannerCoordinator = new PlannerCoordinator();
/** Re-plans run beside a planner run (a light re-plan may arrive while the user searches for plans). */
const replanCoordinator = new PlannerCoordinator();

/** Simulator ensemble chunk: draws [start, start + count) of a `total`-draw Latin hypercube from `seed` (MODEL_SPEC §8.1). */
export interface DrawChunkSpec {
  seed: number;
  total: number;
  start: number;
  count: number;
  options?: RunOptions;
}
export type DrawSeries = Partial<Record<SeriesId, Float32Array>>;

const api = {
  simulate(profile: PersonProfile, schedule: Schedule, options?: RunOptions) {
    return simulate(profile, schedule, options);
  },
  /** Simulator ensemble chunk (MODEL_SPEC §8.1): daily series of draws [start, start + count) of a seeded LHS set. */
  simulateDraws(profile: PersonProfile, schedule: Schedule, spec: DrawChunkSpec): DrawSeries[] {
    const rp = resolveProfile(profile);
    const cs = compileSchedule(schedule, rp);
    const vectors = sampleParams(buildModelParams(MODULES).defs, { count: spec.total, seed: spec.seed });
    const out: DrawSeries[] = [];
    for (let k = spec.start; k < Math.min(spec.total, spec.start + spec.count); k++) {
      out.push(runEngine(rp, cs, { ...spec.options, record: 'daily', paramOverrides: vectors[k], collectEvents: false }).daily);
    }
    const buffers = new Set<ArrayBuffer>();
    for (const d of out) for (const a of Object.values(d)) if (a) buffers.add(a.buffer as ArrayBuffer);
    return Comlink.transfer(out, [...buffers]);
  },
  /**
   * Planner coordinator (MODEL_SPEC §10.2): evaluator ports are transferred from the main thread (`plannerClient`);
   * with no ports the planner evaluates in this thread. Progress ≤ 4 Hz with anytime options; `cancelPlan` stops
   * cooperatively and resolves with the best result so far; `pausePlan` holds batches while the page is hidden.
   */
  plan(request: PlanRequest, ports: MessagePort[] = [], options?: CoordinatorOptions, onProgress?: (p: PlannerProgressInfo) => void) {
    return plannerCoordinator.run(request, ports, options, onProgress);
  },
  /** Planner v2 (PLANNER_V2_SPEC §9.2): the ladder, the Ideal and the limit costs through the evaluator ports. */
  planLadder(request: PlannerRequestV2, ports: MessagePort[] = [], options?: LadderCoordinatorOptions, onProgress?: (p: PlannerProgressV2) => void) {
    return plannerCoordinator.runLadder(request, ports, options, onProgress);
  },
  /** Continue a stored exhaustive (tier X) search by its checkpoint key. */
  resumeLadder(checkpointKey: string, ports: MessagePort[] = [], options?: LadderCoordinatorOptions, onProgress?: (p: PlannerProgressV2) => void) {
    return plannerCoordinator.resumeLadder(checkpointKey, ports, options, onProgress);
  },
  checkpointFor(request: PlannerRequestV2) {
    return plannerCoordinator.checkpointFor(request);
  },
  discardCheckpoint(key: string) {
    return plannerCoordinator.discardCheckpoint(key);
  },
  /** Living-plan re-plan (§7). */
  replan(req: ReplanRequest, ports: MessagePort[] = [], onProgress?: (p: PlannerProgressV2) => void, extra: { tier?: PlannerTier } = {}) {
    return replanCoordinator.replan(req, ports, onProgress, extra);
  },
  cancelReplan() {
    replanCoordinator.cancel();
  },
  cancelPlan() {
    plannerCoordinator.cancel();
  },
  pausePlan(paused: boolean) {
    plannerCoordinator.pause(paused);
  },
};

export type EngineWorkerApi = typeof api;

Comlink.expose(api);
