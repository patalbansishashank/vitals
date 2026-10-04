/**
 * Where a program's training comes from (QA ruling R-DETRAIN part 2, release check 2026-10-01): an ordinary schedule
 * must not silently stop the user's lifting, so programs default to **training as usual** — the sessions of the
 * user's habitual week (Your body → habits: sessions a week, lifting/cardio mix) — with an explicit choice between
 * "as usual", "custom" (the program's own sessions) and "none" (explicitly no training).
 *
 * Contract (engine `DayTemplate.habitualTraining`, MODEL_SPEC §5.2.5): `habitualTraining: true` on a program (or a day's
 * override) trains the habitual week's session(s) for each day's weekday (`habitualSessionsFor`, the same definition the
 * burn-in and R-MAINT's habitual reference use, so a schedule that trains as usual has a zero activity adjustment),
 * followed by the template's own `exercise` as extra sessions. The UI writes "as usual" with no extra sessions,
 * "custom" as `false` + the program's sessions, "none" as `false` + `[]`. Absent flag + absent `exercise` = never set
 * (data from before this change; the scenario store migrates it).
 */
import type { ExerciseSession, ResolvedProfile, Schedule } from '@/engine';
import { habitualWeekPrograms } from '@/engine/core/compileSchedule'; // the module, not the engine index (which loads every model module and the planner): the command registry reaches this file

export type TrainingMode = 'habitual' | 'custom' | 'none';

/** The template fields this module reads and writes. */
export type TrainingFields = { exercise?: ExerciseSession[]; habitualTraining?: boolean };

export const TRAINING_MODE_LABEL: Readonly<Record<TrainingMode, string>> = {
  habitual: 'as usual',
  custom: 'custom',
  none: 'none',
};

export function trainingMode(t: TrainingFields): TrainingMode {
  if (t.habitualTraining === true) return 'habitual';
  return (t.exercise?.length ?? 0) > 0 ? 'custom' : 'none';
}

/** True for a template whose training was never set (pre-2026-10-01 data): no flag and no `exercise` field. */
export function trainingUntouched(t: TrainingFields): boolean {
  return t.habitualTraining === undefined && t.exercise === undefined;
}

/**
 * Switch a template's training source. "custom" keeps the template's own sessions, or starts from `seed` (default:
 * one moderate lift at 17:30) when it has none.
 */
export function withTrainingMode<T extends TrainingFields>(t: T, mode: TrainingMode, seed?: ExerciseSession[]): T {
  if (mode === 'habitual') return { ...t, habitualTraining: true, exercise: [] };
  if (mode === 'none') return { ...t, habitualTraining: false, exercise: [] };
  const own = t.exercise && t.exercise.length > 0 ? t.exercise : (seed ?? [DEFAULT_CUSTOM_SESSION]);
  return { ...t, habitualTraining: false, exercise: structuredClone(own) };
}

const DEFAULT_CUSTOM_SESSION: ExerciseSession = {
  kind: 'resistance',
  startH: 17.5,
  durationMin: 60,
  volume: 'moderate',
  rir: 2,
};

/** "as usual" for a template nobody has set training on; explicit choices are kept. */
export function defaultToHabitual<T extends TrainingFields>(t: T): T {
  return trainingUntouched(t) ? withTrainingMode(t, 'habitual') : t;
}

// ---------------------------------------------------------------- the habitual week, as the UI shows it

export interface HabitualSession {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  session: ExerciseSession;
}

export interface HabitualTraining {
  sessions: HabitualSession[];
  /** Sessions a week as entered in Your body (rounded 0-7, what the habitual week holds). */
  perWeek: number;
  lifts: number;
  cardio: number;
  /** Habitual exercise energy already inside maintenance, kcal a week (engine EAT0 × 7). */
  kcalPerWeek: number;
  /** Sessions by weekday (index 0 = Monday). */
  byWeekday: ExerciseSession[][];
}

const cache = new WeakMap<ResolvedProfile, HabitualTraining>();

export function habitualTraining(resolved: ResolvedProfile): HabitualTraining {
  const hit = cache.get(resolved);
  if (hit) return hit;
  const programs = habitualWeekPrograms(resolved);
  const byWeekday = programs.map((p) => (p.exercise ?? []).slice());
  const sessions: HabitualSession[] = [];
  byWeekday.forEach((list, weekday) => list.forEach((session) => sessions.push({ weekday, session })));
  const out: HabitualTraining = {
    sessions,
    perWeek: sessions.length,
    lifts: sessions.filter((s) => s.session.kind === 'resistance').length,
    cardio: sessions.filter((s) => s.session.kind === 'cardio').length,
    kcalPerWeek: Math.max(0, resolved.eat0Kcal) * 7,
    byWeekday,
  };
  cache.set(resolved, out);
  return out;
}

/** "3 sessions/week · 2 lifting, 1 cardio" / "no sessions" — the Your body habit in words. */
export function habitualText(h: HabitualTraining): string {
  if (h.perWeek === 0) return 'no sessions a week';
  const mix = [h.lifts ? `${h.lifts} lifting` : '', h.cardio ? `${h.cardio} cardio` : ''].filter(Boolean).join(', ');
  return `${h.perWeek} session${h.perWeek === 1 ? '' : 's'}/week · ${mix}`;
}

/** "as usual (from Your body: 3 sessions/week · 2 lifting, 1 cardio)". */
export function trainingSourceText(mode: TrainingMode, h: HabitualTraining): string {
  if (mode === 'habitual') return `as usual (from Your body: ${habitualText(h)})`;
  return mode === 'custom' ? 'custom sessions' : 'none';
}

/** The effective training source of every painted program in a schedule, for the summary strip and the calendar. */
export interface ScheduleTraining {
  /** Mode of each day's effective template. */
  byDay: TrainingMode[];
  /** All days train as usual / none do / a mix. */
  overall: TrainingMode | 'mixed';
}

export function scheduleTraining(s: Schedule, days?: readonly number[]): ScheduleTraining {
  const list = days ?? s.days.map((_, i) => i);
  const byDay: TrainingMode[] = s.days.map((d) => {
    const p = s.programs[d.program] ?? s.programs[0]!;
    const ov = d.override as TrainingFields | undefined;
    const merged: TrainingFields = {
      habitualTraining: ov && 'habitualTraining' in ov ? ov.habitualTraining : (p as TrainingFields).habitualTraining,
      exercise: ov && 'exercise' in ov ? ov.exercise : p.exercise,
    };
    return trainingMode(merged);
  });
  const modes = new Set(list.map((d) => byDay[d]).filter((m): m is TrainingMode => m !== undefined));
  const overall = modes.size === 1 ? [...modes][0]! : modes.size === 0 ? 'none' : 'mixed';
  return { byDay, overall };
}
