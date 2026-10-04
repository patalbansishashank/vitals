/** Planner writes go through `goals.edit` (the goal set) and the `planner.*` commands (runs, open in Simulator). */
import { dispatchSync, outputOf, type InputOf } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';

type GoalOps = InputOf<'goals.edit'>['ops'];

/** Apply goal ops (one change); returns one outcome per op ('added', 'duplicate', 'full', 'applied', …). */
export function editGoals(ops: GoalOps): string[] {
  return outputOf(dispatchSync('goals.edit', { ops }))?.outcomes ?? [];
}

/** Fire-and-forget form for change handlers. */
export function editGoalsLater(ops: GoalOps): void {
  void sendCommand('goals.edit', { ops });
}
