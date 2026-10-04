/**
 * Pure view helpers for Progress: range windows, reading the trend arrays for the readout and the states, months for
 * the calendars, check-in dates and history windows. Nothing here estimates anything new — it reads what the source
 * returned (the trend, its SD, the weigh-ins) and picks windows.
 */
import { addDays, compareDates, daysBetween, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { ScoreHistoryData, TrendLaneData } from '@/features/charts/living/types';

export type TrendRange = '2wk' | '4wk' | '12wk' | 'all';
export const TREND_RANGES: readonly TrendRange[] = ['2wk', '4wk', '12wk', 'all'];

const RANGE_DAYS: Record<Exclude<TrendRange, 'all'>, number> = { '2wk': 14, '4wk': 28, '12wk': 84 };

const later = (a: LocalDate, b: LocalDate) => (compareDates(a, b) >= 0 ? a : b);
const earlier = (a: LocalDate, b: LocalDate) => (compareDates(a, b) <= 0 ? a : b);

/** The trend lane's window: the last 2/4/12 weeks up to today (clipped at the plan's start), or the whole plan. */
export function trendWindow(range: TrendRange, plan: { startDate: LocalDate; plannedEndDate: LocalDate }, today: LocalDate): { from: LocalDate; to: LocalDate } {
  const last = addDays(plan.plannedEndDate, -1);
  if (range === 'all') return { from: plan.startDate, to: later(last, today) };
  const end = earlier(today, last);
  return { from: later(plan.startDate, addDays(end, -(RANGE_DAYS[range] - 1))), to: end };
}

export interface TrendReading {
  /** Days with a weigh-in. */
  weighDays: number;
  /** Date of the latest weigh-in. */
  lastWeighIn: LocalDate | null;
  /** Days since the latest weigh-in. */
  gapDays: number | null;
  /** The trend now (latest finite value up to today) and its SD. */
  now: number | null;
  sd: number | null;
  /** The trend on its first day. */
  first: number | null;
}

/** Read the trend arrays (as given by the source) for the readout and the states. */
export function readTrend(data: TrendLaneData | null, today: LocalDate): TrendReading {
  if (!data) return { weighDays: 0, lastWeighIn: null, gapDays: null, now: null, sd: null, first: null };
  const days = new Set(data.weighIns.map((w) => w.day));
  const lastDay = days.size ? Math.max(...days) : null;
  const lastWeighIn = lastDay === null ? null : addDays(data.startDate, lastDay);
  const end = Math.min(data.days - 1, data.todayIndex ?? data.days - 1);
  let now: number | null = null;
  let sd: number | null = null;
  for (let i = end; i >= 0; i--) {
    const v = data.trend[i];
    if (v !== undefined && Number.isFinite(v)) {
      now = v;
      const s = data.trendSd?.[i];
      sd = s !== undefined && Number.isFinite(s) ? s : null;
      break;
    }
  }
  const first = data.trend.find((v) => Number.isFinite(v)) ?? null;
  return { weighDays: days.size, lastWeighIn, gapDays: lastWeighIn ? daysBetween(lastWeighIn, today) : null, now, sd, first };
}

/** 80 % interval around a value from an SD, as [nearer to zero, farther] for a signed change. */
export function signedInterval(value: number, sd: number): [number, number] {
  const a = value - 1.2816 * sd;
  const b = value + 1.2816 * sd;
  return value < 0 ? [b, a] : [a, b];
}

/** "YYYY-MM" of a date. */
export function monthOf(date: LocalDate): string {
  return date.slice(0, 7);
}

/** Every date of a "YYYY-MM" month. */
export function monthDates(month: string): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

/** The month `delta` months away. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Leading blank cells of a Monday-first month grid. */
export function monthLead(month: string): number {
  return weekdayOf(`${month}-01`);
}

/** Weekly check-in dates so far, newest first (the first one is a week after the start). */
export function checkInDates(plan: { startDate: LocalDate; policy: { checkInWeekday: number } }, today: LocalDate): LocalDate[] {
  const first = addDays(plan.startDate, 6);
  let d = addDays(today, -((weekdayOf(today) - plan.policy.checkInWeekday + 7) % 7));
  const out: LocalDate[] = [];
  while (compareDates(d, first) >= 0 && out.length < 52) {
    out.push(d);
    d = addDays(d, -7);
  }
  return out;
}

/** The first check-in date (a week or so after the start). */
export function firstCheckIn(plan: { startDate: LocalDate; policy: { checkInWeekday: number } }): LocalDate {
  const first = addDays(plan.startDate, 6);
  return addDays(first, (plan.policy.checkInWeekday - weekdayOf(first) + 7) % 7);
}

/** The last `days` of a score history (null = all), re-indexed. */
export function sliceHistory(h: ScoreHistoryData, days: number | null): ScoreHistoryData {
  if (days === null || days >= h.days) return h;
  const k = h.days - days;
  const cut = (a: number[]) => a.slice(k);
  const shift = (xs: Array<{ day: number; label: string }> | undefined) => xs?.filter((x) => x.day >= k).map((x) => ({ ...x, day: x.day - k }));
  const versions = shift(h.versions);
  const deviceChanges = shift(h.deviceChanges);
  return {
    ...h,
    startDate: addDays(h.startDate, k),
    days,
    nightly: cut(h.nightly),
    mean7: cut(h.mean7),
    ...(h.normal ? { normal: { lo: cut(h.normal.lo), hi: cut(h.normal.hi) } } : {}),
    ...(versions ? { versions } : {}),
    ...(deviceChanges ? { deviceChanges } : {}),
    ...(h.compare ? { compare: { ...h.compare, values: cut(h.compare.values) } } : {}),
  };
}
