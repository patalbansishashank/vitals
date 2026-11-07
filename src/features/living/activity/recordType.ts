/**
 * (0.6.3 S26/A24) What a recording is started as: any activity of the catalogue the activity sheet's type picker offers
 * (`activityTypes()` / `searchTypes()`), kept as `activityTypeId` through Gauge and back to the activity to review, and
 * separately the coarse ring sport mode (`walk | run | cycle | other`) Gauge's older builds and the ring understand.
 * Pure.
 */
import { ACTIVITY_TYPE_ID, type WorkoutType } from '@/net/gaugeCommands';
import { exerciseRecordOf } from '@/living/sensors/activityEnergy';
import { activityName, recordTypeWord, searchTypes } from './model';

/** The types pinned first in the Record sheet before anything is typed (after the recent ones). */
export const COMMON_RECORD_TYPES = ['walk', 'walk_brisk', 'jog_outdoor', 'cycle_outdoor', 'treadmill_run', 'air_bike', 'strength_general', 'hatha_yoga'] as const;

/** Is this a catalogue activity a recording can be started as (Gauge's id shape and a known exercise)? */
export function isRecordableActivity(id: unknown): id is string {
  return typeof id === 'string' && ACTIVITY_TYPE_ID.test(id) && exerciseRecordOf(id) !== undefined;
}

/**
 * The ring sport mode of a catalogue activity: walking and running cardio by its modality, cycling by modality or a
 * cycling pattern (air bike, bike intervals), everything else `other` (Gauge 2.8.1 picks a finer ring mode from the id).
 */
export function coarseRecordType(activityTypeId: string): WorkoutType {
  const ex = exerciseRecordOf(activityTypeId);
  if (!ex) return 'other';
  if (ex.cardioModality === 'walk') return 'walk';
  if (ex.cardioModality === 'run') return 'run';
  if (ex.cardioModality === 'cycle' || ex.pattern === 'cycle') return 'cycle';
  return 'other';
}

/** The word for a recording ("walk", "air bike"): the picked activity's name when known, else the coarse type's. */
export function recordingWord(type: string, activityTypeId?: string | null): string {
  return activityTypeId && isRecordableActivity(activityTypeId) ? activityName(activityTypeId).toLowerCase() : recordTypeWord(type);
}

/** The Record sheet's choices: what was typed, else the recent and common types (each once, at most `limit`). */
export function recordTypeChoices(query: string, recent: readonly string[] = [], limit = 8): Array<{ id: string; name: string }> {
  const pinned = [...new Set([...recent, ...COMMON_RECORD_TYPES])].filter(isRecordableActivity);
  if (query.trim()) return searchTypes(query, pinned).slice(0, limit);
  return pinned.slice(0, limit).map((id) => ({ id, name: activityName(id) }));
}

// the types picked on this device, most recent first (memory only: a reload starts from the common ones)
let picked: string[] = [];

/** The activities recordings were started as on this device, most recent first. */
export const recentRecordTypes = (): readonly string[] => picked;

/** Remember a started recording's activity (pinned first next time). */
export function rememberRecordType(id: string): void {
  picked = [id, ...picked.filter((x) => x !== id)].slice(0, 4);
}

/** Tests: forget the picked types. */
export function resetRecordTypes(): void {
  picked = [];
}

/**
 * (0.6.3 INT) The Record sheet's `recent` from the person's own activities: the types of the decided (approved, edited,
 * hand-logged) rows, newest first, each once, only those a recording can be started as.
 */
export function recentTypesOfRows(rows: ReadonlyArray<{ exerciseId: string; startAt: string }>, limit = 4): string[] {
  const out: string[] = [];
  for (const r of [...rows].sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))) {
    if (out.length >= limit) break;
    if (!out.includes(r.exerciseId) && isRecordableActivity(r.exerciseId)) out.push(r.exerciseId);
  }
  return out;
}
