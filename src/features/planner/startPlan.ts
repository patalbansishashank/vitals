/**
 * "Start this plan" wiring next to "Open in Simulator" (pure; no UI, no store): turns a planner option the results view
 * shows into the living plan's start documents through `@/living`. The `plan.start` command (E4) persists the result and
 * the start dialog (E13) shows `anchorNotes` and the start-date choices.
 */
import type { PlanOption, PlannerRequest } from '@/engine/planner/domain/types';
import { RUNG_OF_OPTION, startDateChoices, startFromRung, type PlanIntentions, type PlannerProvenanceV2, type StartContext, type StartOutcome, type Weekday } from '@/living';

export { RUNG_OF_OPTION };

export interface StartPlanChoice {
  startDate?: string;
  name?: string;
  intentions?: PlanIntentions;
  checkInWeekday?: Weekday;
}

/** Start documents for a planner option; the start date defaults to tomorrow (§3.2). */
export function startPlanFromOption(ctx: StartContext, option: PlanOption, request: PlannerRequest, provenance: PlannerProvenanceV2 | null, choice: StartPlanChoice = {}): StartOutcome {
  const startDate = choice.startDate ?? startDateChoices(ctx.today).default;
  return startFromRung(ctx, option, request, RUNG_OF_OPTION[option.id], provenance, {
    startDate,
    ...(choice.name ? { name: choice.name } : {}),
    ...(choice.intentions ? { intentions: choice.intentions } : {}),
    ...(choice.checkInWeekday !== undefined ? { checkInWeekday: choice.checkInWeekday } : {}),
  });
}
