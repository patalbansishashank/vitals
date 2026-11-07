/**
 * (r069 U2) The period a page shows: one day, a Monday-to-Sunday week, a calendar month, a calendar year or a custom
 * range of days. Pure calendar arithmetic over `LocalDate` plus the words the shared date control reads ("Today · Thu
 * 29 Oct", "This week · 26 Oct–1 Nov") and the address form a page keeps it in (`?date=` for a day, as before;
 * `?period=week&date=` for a week, month or year; `?period=range&from=&to=` for a range). "Today" is always an argument.
 */
import { addDays, daysBetween, isLocalDate, maxDate, minDate, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { fmtDateRange, fmtDay, fmtMonth } from './format';

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'range';

/** Every period, in the order the control's bank offers them. */
export const PERIOD_KINDS: readonly PeriodKind[] = ['day', 'week', 'month', 'year', 'range'];

/** A page that is one day by nature (Today's plan and log, Food, Train) offers only this. */
export const DAY_ONLY: readonly PeriodKind[] = ['day'];

/** A page of scores or metrics: every period. */
export const ALL_PERIODS: readonly PeriodKind[] = PERIOD_KINDS;

/** The longest custom range, in days (two years: the loaders' day lists stop at 800). */
export const MAX_RANGE_DAYS = 731;

export interface Period {
  readonly kind: PeriodKind;
  /** First day, inclusive. */
  readonly from: LocalDate;
  /** Last day, inclusive (a week, month or year ends on its own last day, even when that is still ahead). */
  readonly to: LocalDate;
}

/** "2026-10" of a date. */
export const monthOf = (date: LocalDate): string => date.slice(0, 7);

/** The first day of a "YYYY-MM" month. */
export const monthStart = (month: string): LocalDate => `${month}-01`;

/** "YYYY-MM" `n` months after `month`. */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`;
}

/** The last day of a "YYYY-MM" month. */
export const monthEnd = (month: string): LocalDate => addDays(monthStart(shiftMonth(month, 1)), -1);

export const dayPeriod = (date: LocalDate): Period => ({ kind: 'day', from: date, to: date });

/** The day, week, month or year holding `date`. */
export function periodOf(kind: Exclude<PeriodKind, 'range'>, date: LocalDate): Period {
  switch (kind) {
    case 'day':
      return dayPeriod(date);
    case 'week': {
      const from = addDays(date, -weekdayOf(date));
      return { kind, from, to: addDays(from, 6) };
    }
    case 'month':
      return { kind, from: monthStart(monthOf(date)), to: monthEnd(monthOf(date)) };
    case 'year':
      return { kind, from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
  }
}

/** A custom range between two days in either order, at most `MAX_RANGE_DAYS` long (the later end is kept). */
export function rangePeriod(a: LocalDate, b: LocalDate): Period {
  const to = maxDate(a, b);
  const from = maxDate(minDate(a, b), addDays(to, -(MAX_RANGE_DAYS - 1)));
  return { kind: 'range', from, to };
}

/** The period of `kind` that holds `date` (a range: that one day, until a second day is picked). */
export function periodAround(kind: PeriodKind, date: LocalDate): Period {
  return kind === 'range' ? rangePeriod(date, date) : periodOf(kind, date);
}

export const samePeriod = (a: Period, b: Period): boolean => a.kind === b.kind && a.from === b.from && a.to === b.to;

/** Days in the period. */
export const periodLength = (p: Period): number => daysBetween(p.from, p.to) + 1;

/** The period's last day that has happened (`to`, or today while the period is still running). */
export const periodEnd = (p: Period, today: LocalDate): LocalDate => minDate(p.to, today);

/** The period's days up to today, oldest first (empty when the whole period is still ahead). */
export function periodDays(p: Period, today: LocalDate): LocalDate[] {
  const end = periodEnd(p, today);
  const out: LocalDate[] = [];
  for (let d = p.from; d <= end && out.length < 800; d = addDays(d, 1)) out.push(d);
  return out;
}

export const inPeriod = (p: Period, date: LocalDate): boolean => date >= p.from && date <= p.to;

/**
 * A period a page cannot show becomes the day it ends on (never after today): a week on a Day-only tab opens that
 * week's last day so far.
 */
export function coercePeriod(p: Period, allowed: readonly PeriodKind[], today: LocalDate): Period {
  if (allowed.includes(p.kind)) return p;
  return dayPeriod(p.from > today ? p.from : periodEnd(p, today));
}

export interface PeriodWords {
  /** "Today", "This week", "Last week"; null when the dates say it all. */
  lead: string | null;
  /** "Thu 29 Oct", "26 Oct–1 Nov", "October 2026", "2026", "12–29 Oct · 18 days". */
  detail: string;
  /** The two on one line: "Today · Thu 29 Oct". */
  text: string;
}

const join = (lead: string | null, detail: string): PeriodWords => ({ lead, detail, text: lead ? `${lead} · ${detail}` : detail });

/** "Thu 29 Oct", with the year when it is not this year ("Wed 30 Dec 2025"). */
function dayWords(date: LocalDate, today: LocalDate): string {
  return date.slice(0, 4) === today.slice(0, 4) ? fmtDay(date) : `${fmtDay(date)} ${date.slice(0, 4)}`;
}

/** What the control shows for a period, relative to today. */
export function periodWords(p: Period, today: LocalDate): PeriodWords {
  switch (p.kind) {
    case 'day': {
      const off = daysBetween(today, p.from);
      const lead = off === 0 ? 'Today' : off === -1 ? 'Yesterday' : off === 1 ? 'Tomorrow' : null;
      return join(lead, dayWords(p.from, today));
    }
    case 'week': {
      const thisWeek = periodOf('week', today).from;
      const lead = p.from === thisWeek ? 'This week' : p.from === addDays(thisWeek, -7) ? 'Last week' : p.from === addDays(thisWeek, 7) ? 'Next week' : 'Week';
      return join(lead, fmtDateRange(p.from, p.to));
    }
    case 'month': {
      const detail = `${fmtMonth(p.from)} ${p.from.slice(0, 4)}`;
      return join(monthOf(p.from) === monthOf(today) ? 'This month' : null, detail);
    }
    case 'year':
      return join(p.from.slice(0, 4) === today.slice(0, 4) ? 'This year' : null, p.from.slice(0, 4));
    case 'range': {
      const n = periodLength(p);
      return join(null, `${fmtDateRange(p.from, p.to)} · ${n} ${n === 1 ? 'day' : 'days'}`);
    }
  }
}

/** The period's noun for a card title or a summary ("Week average"): "Day", "Week", "Month", "Year", "Range". */
export const PERIOD_NOUN: Record<PeriodKind, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year', range: 'Range' };

// ---------------------------------------------------------------------------------------------------------------
// The address

/**
 * The period a page's address names. A day is `?date=` (no parameter = today), as the strip kept it; a week, month or
 * year is `?period=week&date=` (any day inside it); a range `?period=range&from=&to=`. Anything the page does not
 * offer, or a day after `max`, falls back the way `coercePeriod` does, so an old link always opens something.
 */
export function periodFromSearch(search: URLSearchParams, today: LocalDate, allowed: readonly PeriodKind[] = ALL_PERIODS, max: LocalDate | null = today): Period {
  const cap = (d: LocalDate) => (max && d > max ? max : d);
  const kind = search.get('period');
  const date = search.get('date');
  const day = date && isLocalDate(date) ? cap(date) : today;
  let p: Period;
  if (kind === 'range') {
    const from = search.get('from');
    const to = search.get('to');
    p = from && to && isLocalDate(from) && isLocalDate(to) ? rangePeriod(cap(from), cap(to)) : dayPeriod(day);
  } else if (kind === 'week' || kind === 'month' || kind === 'year') {
    p = periodOf(kind, day);
  } else {
    p = dayPeriod(day);
  }
  return coercePeriod(p, allowed, today);
}

/** The query (with its "?", or "" for today) that names a period: the inverse of `periodFromSearch`. */
export function periodSearch(p: Period, today: LocalDate): string {
  if (p.kind === 'day') return p.from === today ? '' : `?date=${p.from}`;
  if (p.kind === 'range') return `?period=range&from=${p.from}&to=${p.to}`;
  return `?period=${p.kind}&date=${p.from}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The calendar's grid

/** A month as Monday-first weeks of 7 (null = padding before the 1st and after the last day). */
export function monthWeeks(month: string): Array<Array<LocalDate | null>> {
  const first = monthStart(month);
  const n = daysBetween(first, monthStart(shiftMonth(month, 1)));
  const cells: Array<LocalDate | null> = Array.from({ length: weekdayOf(first) }, () => null);
  for (let i = 0; i < n; i++) cells.push(addDays(first, i));
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<LocalDate | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** True when some day of [from, to] lies inside [min, max] (a null bound is open). */
export function overlaps(from: LocalDate, to: LocalDate, min: LocalDate | null, max: LocalDate | null): boolean {
  return (max === null || from <= max) && (min === null || to >= min);
}

// ---------------------------------------------------------------------------------------------------------------
// A period's figures

export interface PeriodStats {
  /** Days with a value. */
  n: number;
  /** Their sum (0 when none). */
  sum: number;
  /** Their mean (NaN when none). */
  mean: number;
}

/** The days with a value (NaN or null = no value) summed and averaged: a period's total and its daily average. */
export function periodStats(values: ReadonlyArray<number | null | undefined>): PeriodStats {
  let n = 0;
  let sum = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    n++;
    sum += v;
  }
  return { n, sum, mean: n ? sum / n : NaN };
}
