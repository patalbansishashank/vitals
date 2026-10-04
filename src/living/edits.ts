/**
 * The person's own changes to a running plan (docs/SUITE_SPEC.md §3.6, §1.9 `plan.declareEvent` / `plan.shift` /
 * `plan.editDay`; docs/LIVING_PLAN.md §9): each turns the adopted schedule into an edited one and names the plan days it
 * fixed. The command layer then asks the planner to re-plan the other days around them (`ReplanRequest.pinnedDays`,
 * `baseline` = the schedule before the edit), so the proposal states what the edit and the re-plan do together. Pure.
 *
 * Edits only ever touch days from `fromDay` on (today or later): past days are logs and never change.
 */
import type { DayTemplate, FastEvent, PersonProfile, Schedule } from '@/engine';
import { habitualTemplateFor } from './calendar';
import { addDays, weekdayOf } from './dates';
import { templateOfDay } from './prescription';
import type { LocalDate } from './types';

export type DeclaredEventKind = 'noTraining' | 'illness' | 'travel' | 'socialMeal' | 'busy';
export type ShiftMode = 'noTraining' | 'habitual' | 'pushBack' | 'swap';

export interface ScheduleEdit {
  schedule: Schedule;
  /** Plan days the person fixed (sorted, ≥ the first editable day). */
  pinned: number[];
  /** New total plan length, days, when the edit moves the end date (`pushBack`). */
  horizonDays?: number;
  /** Plain-language lines for the proposal. */
  notes: string[];
}

/** A known occasion: extra energy (kcal) and/or carbohydrate (g) on one day. */
export interface Occasion {
  day: number;
  extraKcal?: number;
  extraCarbG?: number;
  note?: string;
}

/** Default extra carbohydrate of a declared social meal / high-carbohydrate occasion when the person gives no amount. */
export const DEFAULT_OCCASION_CARB_G = 150;

/** Replace day templates (each day gets its own program; identical templates share one). Fast events are kept. */
export function withTemplates(s: Schedule, repl: ReadonlyMap<number, DayTemplate>): Schedule {
  if (repl.size === 0) return s;
  const programs = [...s.programs];
  const days = s.days.map((d) => ({ ...d }));
  const byKey = new Map<string, number>();
  for (const [d, t] of [...repl.entries()].sort((a, b) => a[0] - b[0])) {
    if (d < 0 || d >= days.length) continue;
    const key = JSON.stringify(t);
    let i = byKey.get(key);
    if (i === undefined) {
      i = programs.length;
      programs.push(t);
      byKey.set(key, i);
    }
    days[d] = { program: i };
  }
  return { ...s, programs, days };
}

/** Last plan day a fast event touches. */
const fastEnd = (e: FastEvent): number => e.startDay + Math.floor((e.startH + e.durationH) / 24 - 1e-9);

/** Drop the fasts that overlap any of `days`. */
function withoutFastsOn(s: Schedule, days: ReadonlySet<number>): { schedule: Schedule; removed: number } {
  const keep = (s.events ?? []).filter((e) => {
    for (let d = e.startDay; d <= fastEnd(e); d++) if (days.has(d)) return false;
    return true;
  });
  const removed = (s.events ?? []).length - keep.length;
  return { schedule: removed ? { ...s, events: keep } : s, removed };
}

const range = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

/** A day without training: no sessions, no habitual sessions; energy and food as prescribed. */
export function noTrainingDay(t: DayTemplate): DayTemplate {
  const { exercise: _e, ...rest } = t;
  void _e;
  return { ...rest, habitualTraining: false };
}

/** A habitual day (maintenance energy, habitual food); `train` keeps the habitual sessions. */
export function habitualDay(profile: PersonProfile, date: LocalDate, train: boolean): DayTemplate {
  const t = habitualTemplateFor(profile, weekdayOf(date));
  return train ? t : noTrainingDay(t);
}

/** Days [from, to) made training-free or habitual. Habitual days carry no fast. */
function makeDays(s: Schedule, startDate: LocalDate, profile: PersonProfile, days: readonly number[], mode: 'noTraining' | 'noTrainingNoFast' | 'habitual' | 'habitualNoTraining'): ScheduleEdit {
  const repl = new Map<number, DayTemplate>();
  for (const d of days) {
    if (d >= s.horizonDays) continue;
    repl.set(d, mode === 'noTraining' || mode === 'noTrainingNoFast' ? noTrainingDay(templateOfDay(s, d)) : habitualDay(profile, addDays(startDate, d), mode === 'habitual'));
  }
  let schedule = withTemplates(s, repl);
  const notes: string[] = [];
  if (mode !== 'noTraining') {
    const f = withoutFastsOn(schedule, new Set(repl.keys()));
    schedule = f.schedule;
    if (f.removed) notes.push(f.removed === 1 ? 'The fast planned on those days is left out.' : `The ${f.removed} fasts planned on those days are left out.`);
  }
  return { schedule, pinned: [...repl.keys()].sort((a, b) => a - b), notes };
}

/** Add a known occasion to a day: energy as kcal (the day's current kcal + the extra), extra carbohydrate in grams. */
export function absorbOccasion(s: Schedule, o: Occasion, current: { energyKcal: number; carbG: number }): ScheduleEdit {
  if (o.day < 0 || o.day >= s.horizonDays) return { schedule: s, pinned: [], notes: [] };
  const carb = Math.max(0, o.extraCarbG ?? 0);
  const extra = Math.max(0, o.extraKcal ?? carb * 4);
  const t = templateOfDay(s, o.day);
  const next: DayTemplate = {
    ...t,
    energy: { kind: 'kcal', kcal: Math.round(current.energyKcal + extra) },
    ...(carb > 0 && t.macros.protein.unit !== 'remainder'
      ? { macros: { ...t.macros, carbShareNonProtein: undefined, carbs: { unit: 'g' as const, value: Math.round(current.carbG + carb) }, fat: { unit: 'remainder' as const } } }
      : {}),
  };
  if (next.macros.carbShareNonProtein === undefined) delete (next.macros as { carbShareNonProtein?: number }).carbShareNonProtein;
  const schedule = withTemplates(s, new Map([[o.day, next]]));
  const what = carb > 0 ? `about ${Math.round(extra)} kcal more, ${Math.round(carb)} g of it carbohydrate` : `about ${Math.round(extra)} kcal more`;
  return { schedule, pinned: [o.day], notes: [`${o.note ? `${o.note}: ` : 'The occasion: '}${what} that day.`] };
}

/** Merge two edits made on the same schedule in sequence (`b` was made on `a.schedule`). */
export function chainEdits(a: ScheduleEdit, b: ScheduleEdit): ScheduleEdit {
  return {
    schedule: b.schedule,
    pinned: [...new Set([...a.pinned, ...b.pinned])].sort((x, y) => x - y),
    ...(b.horizonDays !== undefined || a.horizonDays !== undefined ? { horizonDays: b.horizonDays ?? a.horizonDays! } : {}),
    notes: [...a.notes, ...b.notes],
  };
}

/**
 * A declared event (§1.9 `plan.declareEvent`, mapped to `plan.shift` modes as §3.6 says): no training and busy → sessions
 * off on those days, food as planned; travel → the same without fasts; illness → habitual days (maintenance food) without
 * training or fasts; a social meal → a high-carbohydrate occasion on each of its days. (Busy and travel keep the plan's
 * food rather than the habitual day: the habitual day drops the plan's protein and supplements, and its energy pushes the
 * weeks' training-day energy availability out of the safety band before the first check-in.)
 */
export function eventEdit(
  s: Schedule,
  startDate: LocalDate,
  profile: PersonProfile,
  e: { kind: DeclaredEventKind; fromDay: number; toDay: number; extraKcal?: number; extraCarbG?: number; note?: string },
  current: (d: number) => { energyKcal: number; carbG: number },
): ScheduleEdit {
  const days = range(Math.max(0, e.fromDay), Math.min(s.horizonDays, e.toDay + 1));
  if (e.kind === 'noTraining' || e.kind === 'busy') return makeDays(s, startDate, profile, days, 'noTraining');
  if (e.kind === 'travel') return makeDays(s, startDate, profile, days, 'noTrainingNoFast');
  if (e.kind === 'socialMeal') {
    let out: ScheduleEdit = { schedule: s, pinned: [], notes: [] };
    const carb = e.extraKcal === undefined && e.extraCarbG === undefined ? DEFAULT_OCCASION_CARB_G : e.extraCarbG;
    for (const d of days) out = chainEdits(out, absorbOccasion(out.schedule, { day: d, ...(e.extraKcal !== undefined ? { extraKcal: e.extraKcal } : {}), ...(carb !== undefined ? { extraCarbG: carb } : {}), ...(e.note ? { note: e.note } : {}) }, current(d)));
    return out;
  }
  return makeDays(s, startDate, profile, days, 'habitualNoTraining');
}

/**
 * `plan.shift` (§3.6): `noTraining` and `habitual` change the days in place; `pushBack` inserts `days` habitual days at
 * `fromDay` and moves every later prescription (and fast) back, so the end date moves by `days`; `swap` exchanges the
 * `days` days from `fromDay` with those from `withDay`.
 */
export function shiftEdit(s: Schedule, startDate: LocalDate, profile: PersonProfile, i: { fromDay: number; days: number; mode: ShiftMode; withDay?: number }): ScheduleEdit {
  const days = range(i.fromDay, i.fromDay + i.days);
  if (i.mode === 'noTraining') return makeDays(s, startDate, profile, days, 'noTraining');
  if (i.mode === 'habitual') return makeDays(s, startDate, profile, days, 'habitual');
  if (i.mode === 'swap') {
    const w = i.withDay ?? -1;
    if (w < 0 || w + i.days > s.horizonDays || i.fromDay + i.days > s.horizonDays) return { schedule: s, pinned: [], notes: ['There is nothing to swap with on that date.'] };
    const repl = new Map<number, DayTemplate>();
    for (let k = 0; k < i.days; k++) {
      repl.set(i.fromDay + k, templateOfDay(s, w + k));
      repl.set(w + k, templateOfDay(s, i.fromDay + k));
    }
    const a = new Set(days);
    const b = new Set(range(w, w + i.days));
    // a fast moves with its stretch only when it lies wholly inside it; one that crosses a stretch's edge (a 24-h fast
    // from Monday evening to Tuesday evening, when Monday is swapped) would land on days it was not planned around, over
    // their sessions (Q4-09), so it is left out and the re-plan may place a fast again
    const inside = (e: FastEvent, set: ReadonlySet<number>): boolean => range(e.startDay, fastEnd(e) + 1).every((d) => set.has(d));
    const touches = (e: FastEvent): boolean => range(e.startDay, fastEnd(e) + 1).some((d) => a.has(d) || b.has(d));
    const dropped = (s.events ?? []).filter((e) => touches(e) && !inside(e, a) && !inside(e, b));
    const events = (s.events ?? [])
      .filter((e) => !dropped.includes(e))
      .map((e) => (inside(e, a) ? { ...e, startDay: e.startDay - i.fromDay + w } : inside(e, b) ? { ...e, startDay: e.startDay - w + i.fromDay } : e))
      .sort((x, y) => x.startDay - y.startDay || x.startH - y.startH);
    if (dropped.length) {
      // the days a left-out fast touched were shaped around it (one meal, a fraction of the energy): they become an
      // ordinary day of the same kind, keeping their own sessions
      const fastDays = new Set((s.events ?? []).flatMap((e) => range(e.startDay, fastEnd(e) + 1)));
      const swapped = (d: number): number => (a.has(d) ? d - i.fromDay + w : b.has(d) ? d - w + i.fromDay : d);
      for (const e of dropped)
        for (let d = Math.max(0, e.startDay); d <= Math.min(s.horizonDays - 1, fastEnd(e)); d++) {
          const own = templateOfDay(s, d);
          const program = s.days[d]?.program;
          let near = -1;
          for (let k = 1; k < s.horizonDays && near < 0; k++)
            for (const j of [d - k, d + k]) if (near < 0 && j >= 0 && j < s.horizonDays && !fastDays.has(j) && s.days[j]?.program === program) near = j;
          if (near < 0) continue;
          const { exercise: _x, habitualTraining: _h, ...food } = templateOfDay(s, near);
          void _x;
          void _h;
          const t: DayTemplate = { ...food, ...(own.exercise ? { exercise: own.exercise } : {}), ...(own.habitualTraining !== undefined ? { habitualTraining: own.habitualTraining } : {}) };
          repl.set(swapped(d), t);
        }
    }
    const notes = dropped.length === 0 ? [] : [dropped.length === 1 ? 'The fast planned across those days is left out; the re-plan may place it on other days.' : `The ${dropped.length} fasts planned across those days are left out; the re-plan may place them on other days.`];
    return { schedule: { ...withTemplates(s, repl), events }, pinned: [...repl.keys()].sort((x, y) => x - y), notes };
  }
  // pushBack
  const n = i.days;
  const P = i.fromDay;
  const H = s.horizonDays + n;
  const at = (d: number): number => (d < P ? d : d < P + n ? -1 : d - n);
  const base: Schedule = {
    ...s,
    horizonDays: H,
    days: Array.from({ length: H }, (_, d) => {
      const src = at(d);
      return src < 0 ? { ...s.days[Math.min(P, s.days.length - 1)]! } : { ...s.days[Math.min(src, s.days.length - 1)]! };
    }),
    events: (s.events ?? []).map((e) => (e.startDay >= P ? { ...e, startDay: e.startDay + n } : e)),
    ...(s.blocks ? { blocks: s.blocks.map((b) => ({ ...b, startDay: b.startDay >= P ? b.startDay + n : b.startDay, endDay: b.endDay > P ? b.endDay + n : b.endDay })) } : {}),
  };
  const made = makeDays(base, startDate, profile, days, 'habitual');
  return { ...made, horizonDays: H, notes: [...made.notes, `Every later day moves back by ${n} day${n === 1 ? '' : 's'}, and so does the end date.`] };
}

/** RFC 7396 JSON merge patch. */
export function mergePatch<T>(target: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  const out: Record<string, unknown> = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out as T;
}

/** Fields a day edit may not touch (identity, and the label the day types are told apart by). */
const LOCKED_FIELDS = ['id', 'label'] as const;

/**
 * `plan.editDay` (§1.9): a merge patch over the day template of `day` only, of every later same weekday, or of every day
 * from `day` to the end. Safety is the planner's: the edited plan is checked like any candidate.
 */
export function editDaysEdit(s: Schedule, i: { day: number; patch: Record<string, unknown>; scope: 'day' | 'weekday' | 'rest' }): ScheduleEdit {
  const patch = Object.fromEntries(Object.entries(i.patch).filter(([k]) => !(LOCKED_FIELDS as readonly string[]).includes(k)));
  const days = i.scope === 'day' ? [i.day] : range(i.day, s.horizonDays).filter((d) => i.scope === 'rest' || (d - i.day) % 7 === 0);
  const repl = new Map<number, DayTemplate>();
  for (const d of days) if (d < s.horizonDays) repl.set(d, mergePatch(templateOfDay(s, d), patch));
  return { schedule: withTemplates(s, repl), pinned: [...repl.keys()], notes: [] };
}
