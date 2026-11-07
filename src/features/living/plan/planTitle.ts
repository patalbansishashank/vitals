/**
 * A plan's name in plain words, for the plan card and the header's plan capsule: the name the person gave the plan
 * ("Spring cut"), or — when the stored name is only an internal tag such as "Coach: medium" — the rung's plain name,
 * "Medium plan" (SPEC §6: no internal names or rungs on screen). Pure; its own module so the shell can use it without
 * loading the plan pages.
 */
import type { ActivePlan } from '../activePlan';
import { PLAN_COPY as C } from './copy';

/** A stored name that is only an internal tag: "medium", "Coach: medium", "planner:hard". */
const TAGGED_NAME = /^(?:[\w-]+\s*:\s*)?(hard|medium|easy)$/i;

export function planTitle(plan: Pick<ActivePlan, 'name' | 'rung'>): string {
  const name = plan.name.trim();
  const tag = TAGGED_NAME.exec(name)?.[1]?.toLowerCase() as keyof typeof C.rungNames | undefined;
  if (tag) return C.rungPlan(C.rungNames[tag]);
  if (name) return name;
  return plan.rung === 'custom' ? C.untitled : C.rungPlan(C.rungNames[plan.rung]);
}
