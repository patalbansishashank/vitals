/**
 * Planner-side contracts the living plan uses unchanged (docs/PLANNER_V2_SPEC.md §7-§9.3; docs/SUITE_SPEC.md §3 preamble).
 *
 * The planner (E6) owns these in `@/engine/planner` (`domain/replanTypes.ts`); this file re-exports them under the names
 * the living plan has always used, so there is one place to change. Stimulus types come from E8's catalogue
 * (`@/catalogues`). Differences to the earlier stand-in declarations, all compatible with the living plan's code:
 *  - `GoalOutcome` here is the planner's `ForecastGoalOutcome` (same fields, plus optional label/unit/target/current); the
 *    ladder's per-goal row is the other `GoalOutcome` in `@/engine/planner`.
 *  - `ActivePlanRecord.kind` also admits 'custom' (a scenario-started plan, no genome); `toActivePlanRecord` may pass
 *    `plan.rung` straight through instead of mapping 'custom' to 'medium'.
 *  - `PlannerProvenanceV2` is the planner's `ActivePlanProvenance` (tier may be 'X'; optional `replanFrame` written by
 *    the planner and carried verbatim).
 */
import type { PlanSensitivities as Sensitivities, ReplanRequest as Request, ReplanResult as Result, ActivePlanRecord as Plan, ConfirmedState as State, PlannerProgressV2, PlannerTier } from '@/engine/planner';
import type { ConcreteSession } from '@/catalogues';

export type { StimulusIntent, StimulusVector, TrainingProfile } from '@/catalogues';
/** PLANNER_V2 §8.3 composed session (E8 `composeSessions`). */
export type ConcreteSessionLike = ConcreteSession;
export type { EquivalenceResult, ShortfallNote, StimulusTermId, PerformedExercise } from '@/catalogues';

export type {
  RungId,
  PlannerRequestV2,
  PlanItemType,
  ActivePlanRecord,
  ConfirmedState,
  ItemOutcome,
  LoggedDay,
  BlockAdherence,
  ReplanKind,
  ReplanTrigger,
  ReplanRequest,
  ReplanResult,
  PlanSensitivities,
  ActivePlanProvenance as PlannerProvenanceV2,
  ForecastGoalOutcome as GoalOutcome,
} from '@/engine/planner';
export { PLAN_ITEM_TYPES } from '@/engine/planner/domain/replanTypes';

/**
 * The planner functions the living plan calls (PLANNER_V2 §9.3). Injected so the living plan stays pure and testable; E4
 * wires the worker client's `replan` (`src/workers/plannerClient.ts`), tests pass fakes.
 */
export interface PlannerPort {
  /** `tier`: search tier of event/user re-plans (default: the plan's). */
  replan(req: Request, options?: { signal?: AbortSignal; onProgress?: (p: PlannerProgressV2) => void; tier?: PlannerTier }): Promise<Result>;
  computePlanSensitivities?(plan: Plan, state: State | null): Sensitivities;
}
