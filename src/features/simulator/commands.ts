/**
 * Simulator writes go through the `scenario.*` commands. Each schedule gesture is one `scenario.edit` with the
 * serialisable `ScheduleOp`s (a paint stroke or a slider drag passes a coalesce key and ends with `history.seal`).
 */
import type { DayTemplate } from '@/engine';
import { dispatchSync, outputOf } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import type { ScheduleOpInput } from '@/commands/defs/scenario';
import { diffMergePatch } from '@/store';

/** One undo step (or one coalesced gesture). Returns the command output (`programIndex` for added programs). */
export function editSchedule(sid: string, ops: ScheduleOpInput[], coalesceKey?: string) {
  return outputOf(dispatchSync('scenario.edit', { id: sid, ops }, coalesceKey ? { coalesceKey } : undefined));
}

export function undoSchedule(sid: string): void {
  void sendCommand('scenario.undo', { id: sid });
}

export function redoSchedule(sid: string): void {
  void sendCommand('scenario.redo', { id: sid });
}

/** End of a gesture (pointer-up, blur): the next edit starts a new undo step. */
export function sealSchedule(sid: string): void {
  void sendCommand('history.seal', { scenarioId: sid });
}

/** What a template recipe changes on the template the editor shows, as the merge patch `scenario.edit` takes. */
export function templatePatch(t: DayTemplate, recipe: (t: DayTemplate) => DayTemplate): Record<string, unknown> | null {
  const p = diffMergePatch(t, recipe(t));
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
}
