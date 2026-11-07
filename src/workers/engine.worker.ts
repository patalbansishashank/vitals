import * as Comlink from 'comlink';
import { simulate } from '@/engine';
import type { PersonProfile, PlanRequest, RunOptions, Schedule } from '@/engine';
import { drawBuffers, simulateDrawChunk, type DrawChunkSpec, type DrawSeries } from './simulationDraws';
import type { PlannerProgressInfo, PlannerProgressV2, PlannerRequestV2, PlannerTier, ReplanRequest } from '@/engine/planner';
import { PlannerCoordinator, type CoordinatorOptions, type LadderCoordinatorOptions } from './planner.coordinator';

const plannerCoordinator = new PlannerCoordinator();
/** Re-plans run beside a planner run (a light re-plan may arrive while the user searches for plans). */
const replanCoordinator = new PlannerCoordinator();

export type { DrawChunkSpec, DrawSeries } from './simulationDraws';

const api = {
  simulate(profile: PersonProfile, schedule: Schedule, options?: RunOptions) {
    return simulate(profile, schedule, options);
  },
  /**
   * Simulator ensemble chunk (MODEL_SPEC §8.1, D8-02): the member envelopes (band inputs with status, validity and abort,
   * A1-049) of draws [start, start + count) of a seeded LHS set; the daily buffers are transferred, the metadata copied.
   */
  simulateDraws(profile: PersonProfile, schedule: Schedule, spec: DrawChunkSpec): DrawSeries[] {
    const out = simulateDrawChunk(profile, schedule, spec);
    return Comlink.transfer(out, drawBuffers(out));
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
