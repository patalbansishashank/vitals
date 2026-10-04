/**
 * Plan calendar (docs/SUITE_SPEC.md §3.2): plan days, the version in force, schedule anchoring to a start date, start-date
 * choices, pause and resume shifts, the habitual prescription of paused days. Pure.
 */
// the modules, not the engine index (which loads every model module and the planner): the command registry reaches this file
import { habitualWeekPrograms } from '@/engine/core/compileSchedule';
import { resolveProfile } from '@/engine/core/resolveProfile';
import type { DayTemplate, FastEvent, PersonProfile, Schedule } from '@/engine';
import { addDays, daysBetween, nextWeekday, weekdayOf } from './dates';
import type { LocalDate, PlanDoc, PlanVersionDoc } from './types';

/** Plan-day index of a date (negative before the start). */
export function planDay(plan: Pick<PlanDoc, 'startDate'>, date: LocalDate): number {
  return daysBetween(plan.startDate, date);
}

/** Total plan days from start to planned end (inclusive of the start, exclusive of the end date). */
export function planLength(plan: Pick<PlanDoc, 'startDate' | 'plannedEndDate'>): number {
  return Math.max(0, daysBetween(plan.startDate, plan.plannedEndDate));
}

/** The adopted version with the largest `effectiveFromDay ≤ day` (ties: the higher version number). */
export function versionInForce<V extends Pick<PlanVersionDoc, 'status' | 'effectiveFromDay' | 'version'>>(versions: readonly V[], day: number): V | null {
  let best: V | null = null;
  for (const v of versions) {
    if (v.status !== 'adopted' && v.status !== 'superseded') continue;
    if (v.effectiveFromDay > day) continue;
    if (!best || v.effectiveFromDay > best.effectiveFromDay || (v.effectiveFromDay === best.effectiveFromDay && v.version > best.version)) best = v;
  }
  // a superseded version only counts when no adopted one covers the day (history views of old days)
  return best;
}

/** Head version: the adopted version with the highest number. */
export function headAdopted<V extends Pick<PlanVersionDoc, 'status' | 'version'>>(versions: readonly V[]): V | null {
  let best: V | null = null;
  for (const v of versions) if (v.status === 'adopted' && (!best || v.version > best.version)) best = v;
  return best;
}

/**
 * Proposed versions still waiting for the person: adopting or rejecting one appends a decision version whose `parent`
 * is the proposal (planVersions are immutable), so a proposal with a decision is no longer open.
 */
export function openProposals<V extends Pick<PlanVersionDoc, 'status' | 'version' | 'parent'>>(versions: readonly V[]): V[] {
  const decided = new Set(versions.filter((v) => v.status !== 'proposed' && v.parent !== null).map((v) => v.parent));
  return versions.filter((v) => v.status === 'proposed' && !decided.has(v.version));
}

export interface AnchoredSchedule {
  schedule: Schedule;
  /** Days of week 1 that were skipped (0 when the weekdays already match). */
  skippedDays: number;
  /** Fasts that started in the skipped days (dropped, with a notice). */
  droppedFasts: FastEvent[];
  notices: string[];
}

/**
 * `anchorSchedule(schedule, startDate)` (§3.2): same weekday → only the date changes. Otherwise with
 * j = (weekday(start) − weekday(schedule.start)) mod 7 the days become old[j..H−1] followed by the old last week's days on
 * the missing weekdays (old[H−7 .. H−7+j−1]), restoring the horizon H; blocks shift by −j (clipped at 0; the last block
 * keeps the horizon end); fasts starting before j are dropped with a notice, later ones shift by −j. Genome-based plans
 * then re-run `toActivePlan` on the anchored schedule (E6).
 */
export function anchorSchedule(schedule: Schedule, startDate: LocalDate): AnchoredSchedule {
  const H = schedule.horizonDays;
  const j = (((weekdayOf(startDate) - weekdayOf(schedule.startDate)) % 7) + 7) % 7;
  if (j === 0) return { schedule: { ...schedule, startDate }, skippedDays: 0, droppedFasts: [], notices: [] };
  const tailStart = Math.max(0, H - 7);
  const days = [...schedule.days.slice(j, H), ...schedule.days.slice(tailStart, tailStart + j)].map((d) => ({ ...d }));
  while (days.length < H) days.push({ ...schedule.days[schedule.days.length - 1]! });
  const blocks = schedule.blocks
    ?.map((b) => ({ ...b, startDay: Math.max(0, b.startDay - j), endDay: b.endDay >= H ? H : Math.max(0, b.endDay - j) }))
    .filter((b) => b.endDay > b.startDay);
  const droppedFasts: FastEvent[] = [];
  const events: FastEvent[] = [];
  for (const e of schedule.events ?? []) {
    if (e.startDay < j) droppedFasts.push(e);
    else events.push({ ...e, startDay: e.startDay - j });
  }
  const notices = [`Starting on this weekday skips the first ${j} day${j === 1 ? '' : 's'} of week 1.`];
  if (droppedFasts.length > 0) notices.push(`${droppedFasts.length === 1 ? 'A fast' : `${droppedFasts.length} fasts`} planned in those days ${droppedFasts.length === 1 ? 'was' : 'were'} left out.`);
  return {
    schedule: { ...schedule, startDate, days, ...(blocks ? { blocks } : {}), events },
    skippedDays: j,
    droppedFasts,
    notices,
  };
}

/** Start-date choices (§3.2): today, tomorrow (default), next Monday, and the latest allowed date (≤ 28 days ahead). */
export function startDateChoices(today: LocalDate): { today: LocalDate; tomorrow: LocalDate; nextMonday: LocalDate; latest: LocalDate; default: LocalDate } {
  const tomorrow = addDays(today, 1);
  return { today, tomorrow, nextMonday: nextWeekday(today, 0), latest: addDays(today, 28), default: tomorrow };
}

export function isAllowedStartDate(today: LocalDate, date: LocalDate): boolean {
  const d = daysBetween(today, date);
  return d >= 0 && d <= 28;
}

/** Habitual day template for `weekday` (paused days, "keep the result" days): 100 % of maintenance, habitual training. */
export function habitualTemplateFor(profile: PersonProfile, weekday: number): DayTemplate {
  const progs = habitualWeekPrograms(resolveProfile(profile));
  const t = progs[((weekday % 7) + 7) % 7]!;
  return { ...t, label: 'habitual day', habitualTraining: true, exercise: undefined };
}

/** Plan days inside a pause `[from, to)` (open pauses run through `upTo`, exclusive). */
export function pausedDaySet(plan: Pick<PlanDoc, 'startDate' | 'pauses'>, upTo: LocalDate): Set<number> {
  const out = new Set<number>();
  for (const p of plan.pauses) {
    const a = planDay(plan, p.from);
    const b = planDay(plan, p.to ?? upTo);
    for (let d = a; d < b; d++) out.add(d);
  }
  return out;
}

/**
 * Resume shift (§3.2): a pause [P, R) is absorbed by a new version effective from R whose days from R are the parent's days
 * from P (blocks and fasts shifted alike), and the planned end moves by R − P. Days before R are the parent's.
 */
export function resumeSchedule(parent: Schedule, P: number, R: number): { schedule: Schedule; shiftDays: number } {
  const shift = Math.max(0, R - P);
  if (shift === 0) return { schedule: parent, shiftDays: 0 };
  const H = parent.horizonDays + shift;
  const days = Array.from({ length: H }, (_, d) => {
    if (d < R) return { ...parent.days[Math.min(d, parent.days.length - 1)]! };
    return { ...parent.days[Math.min(d - shift, parent.days.length - 1)]! };
  });
  const blocks = parent.blocks?.map((b) => ({
    ...b,
    startDay: b.startDay >= P ? b.startDay + shift : b.startDay,
    endDay: b.endDay > P ? b.endDay + shift : b.endDay,
  }));
  const events = (parent.events ?? []).map((e) => (e.startDay >= P ? { ...e, startDay: e.startDay + shift } : e));
  return { schedule: { ...parent, horizonDays: H, days, ...(blocks ? { blocks } : {}), events }, shiftDays: shift };
}
