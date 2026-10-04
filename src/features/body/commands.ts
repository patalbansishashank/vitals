/**
 * Your-body writes go through the `profile.*` commands. `patchProfile` turns the screen's partial updates into the
 * command's merge patch: inside a group (shape, waist, habits, labs …) `undefined` means "clear / un-touch", which the
 * patch spells `null`.
 */
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/profile'; // registers the commands dispatched here
import type { BodyProfileValues } from '@/state/profileStore';

type Group<T> = { [K in keyof T]?: T[K] | undefined | null };
export type ProfileUpdate = {
  [K in keyof Omit<BodyProfileValues, 'setup' | 'shapeSkipped' | 'habitsSkipped' | 'updatedAt' | 'revision'>]?: BodyProfileValues[K] extends object | null
    ? Group<NonNullable<BodyProfileValues[K]>> | null
    : BodyProfileValues[K];
};

const GROUPS = new Set(['figure', 'shape', 'waist', 'knownBodyFat', 'training', 'habits', 'cycle', 'labs']);

export function patchProfile(update: ProfileUpdate): void {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(update)) {
    if (v === undefined) continue;
    if (GROUPS.has(k) && v !== null && typeof v === 'object') {
      const group: Record<string, unknown> = {};
      for (const [gk, gv] of Object.entries(v)) group[gk] = gv === undefined ? null : gv;
      patch[k] = group;
    } else patch[k] = v;
  }
  void sendCommand('profile.patch', patch as never);
}
