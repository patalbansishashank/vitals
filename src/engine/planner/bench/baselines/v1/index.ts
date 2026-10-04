/**
 * Frozen v1 optimiser (PLANNER_V2_SPEC §5.1): the pipeline, comparators, archive, robust summary, conflicts and CMA-ES
 * exactly as they were before the v2 algorithm work, so the benchmark harness can compare every v2 change with it on
 * the same problems and evaluators. Shares only the stateless helpers (rng, stats, evaluation types) with the live code.
 */
export { runPlanner as runPlannerV1, planBudget as planBudgetV1, TIER_ENSEMBLE as TIER_ENSEMBLE_V1, type PlannerResult as PlannerResultV1, type PlannerProblem as PlannerProblemV1, type PlannerConfig as PlannerConfigV1 } from './pipeline';
