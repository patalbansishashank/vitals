/**
 * Editor plumbing: which template an edit targets (program, "this day" override, "this block"), and how meal times,
 * sessions and sleep are written back into the engine template.
 */
import type { DayTemplate, ExerciseSession, MealPlan, MealSplit } from '@/engine';
import { evenMeals, isEven, windowOf } from './lib/clock';
import type { ScheduleModel } from './useScheduleModel';

export type EditScope = 'day' | 'block' | 'all';

/** Days of the same program inside the day's block (phase). */
export function blockDaysOf(model: ScheduleModel, day: number): number[] {
  const prog = model.schedule.days[day]?.program ?? 0;
  const ph = model.phases.find((p) => day >= p.startDay && day < p.endDay);
  const a = ph?.startDay ?? 0;
  const b = ph?.endDay ?? model.schedule.horizonDays;
  const out: number[] = [];
  for (let d = a; d < b; d++) if (model.schedule.days[d]?.program === prog) out.push(d);
  return out;
}

const splitWeight = (split: MealSplit, i: number, n: number): number =>
  split === 'biggerLast' ? i + 1 : split === 'biggerFirst' ? n - i : 1;

/**
 * Write meal times into a template. Evenly spaced times stay in the engine's window shorthand; anything else
 * becomes an explicit list (shares from the split). `explicit` forces the list form (per-day overrides, so a merge
 * with the program's meals is always exact).
 */
export function writeMealTimes(t: DayTemplate, times: readonly number[], explicit = false): DayTemplate {
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  const split = t.meals?.split ?? 'even';
  const w = windowOf(sorted);
  const base: MealPlan = { count: n, window: { startH: round2(w.start), lengthH: round2(w.length) }, split };
  if (!explicit && isEven(sorted)) return { ...t, meals: base };
  return {
    ...t,
    meals: { ...base, meals: sorted.map((c, i) => ({ clockH: round2(c), share: splitWeight(split, i, n) })) },
  };
}

export function setMealCount(
  t: DayTemplate,
  times: readonly number[],
  count: number,
  explicit = false,
): DayTemplate {
  const w = windowOf(times);
  let start = w.start;
  let len = w.length;
  if (count > 1 && len < 0.5 * (count - 1)) {
    // growing from a single meal: open an 8 h window that ends at that meal
    len = 8;
    start = Math.max(0, w.end - len);
  }
  const next = count === 1 ? [w.end] : evenMeals(count, start, len);
  return writeMealTimes(t, next, explicit);
}

export function setSplit(
  t: DayTemplate,
  times: readonly number[],
  split: MealSplit,
  explicit = false,
): DayTemplate {
  return writeMealTimes({ ...t, meals: { ...t.meals, split } }, times, explicit);
}

const round2 = (h: number): number => Math.round(h * 100) / 100;

export function updateSession(t: DayTemplate, i: number, patch: Partial<ExerciseSession>): DayTemplate {
  const ex = (t.exercise ?? []).slice();
  const cur = ex[i];
  if (!cur) return t;
  ex[i] = { ...cur, ...patch } as ExerciseSession;
  return { ...t, exercise: ex };
}

export function removeSession(t: DayTemplate, i: number): DayTemplate {
  const ex = (t.exercise ?? []).filter((_, k) => k !== i);
  return { ...t, exercise: ex };
}

export type NewSessionKind = 'resistance' | 'walk' | 'run' | 'cycle' | 'swim' | 'row' | 'hiit' | 'other';

export function newSession(kind: NewSessionKind): ExerciseSession {
  if (kind === 'resistance')
    return { kind: 'resistance', startH: 17.5, durationMin: 60, volume: 'moderate', rir: 2 };
  const dur = { walk: 45, run: 30, cycle: 45, swim: 30, row: 30, hiit: 20, other: 30 }[kind];
  const start = kind === 'walk' ? 7.5 : 18;
  return { kind: 'cardio', modality: kind, startH: start, durationMin: dur };
}

export function sessionLabel(s: ExerciseSession): string {
  if (s.kind === 'resistance') return 'lift';
  return s.modality === 'hiit' ? 'HIIT' : s.modality;
}
