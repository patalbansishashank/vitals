/**
 * Planner (MODEL_SPEC §10; dossier 18). The optimisation core lives in ./optim, the Vitals integration in ./domain
 * (README there documents the public API). Browser code calls `planRegimes` from `@/workers/plannerClient`.
 */
import { runDomainPlanner, type PlannerOptions } from './domain/planner';
import type { PlannerRequest, PlannerResult } from './domain/types';

export * from './domain';

/** Request alias kept for `src/engine/index.ts` (the former placeholder API). */
export type PlanRequest = PlannerRequest;

/** Run the planner in the current thread (Node, tests, or inside the coordinator worker). */
export function plan(request: PlannerRequest, options?: PlannerOptions): Promise<PlannerResult> {
  return runDomainPlanner(request, options);
}
