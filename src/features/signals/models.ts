/**
 * Body signals period model (design/screens/ring-pages.md §7.1). Pure: "today" is always an argument.
 * Windows are half-open local-calendar ranges [start, end): day = one date, week = ISO week (Monday first), month =
 * calendar month, year = calendar year. A window is made of dates, never of hours, so a 23 h or 25 h day (a clock
 * change) is still one slot. The URL holds tab, period and an anchor date; switching period keeps the anchor, stepping
 * moves to the canonical start of the neighbouring period, the future is blocked (a later date is clamped to today).
 */
import { addDays, daysBetween, isLocalDate, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { EN_DASH } from '@/components/lib/format';

export type SignalsTab = 'sleep' | 'heart' | 'activity';
export type PeriodKind = 'day' | 'week' | 'month' | 'year';
/** The person's date style (Settings › Units "dates"): "5 Oct" or "Oct 5". */
export type DateStyle = 'day-month' | 'month-day';

export const SIGNALS_TABS: readonly SignalsTab[] = ['sleep', 'heart', 'activity'];
export const PERIOD_KINDS: readonly PeriodKind[] = ['day', 'week', 'month', 'year'];

/** One slot of a period: a date (day, week, month) or a calendar month (year). `end` is exclusive. */
export interface Slot {
  /** The slot's first date; for a year slot the month's first date ("2026-10-01"). */
  start: LocalDate;
  /** Exclusive end. */
  end: LocalDate;
  /** Every date of the slot is after today: draw nothing, not missing. */
  future: boolean;
  /** The slot contains today. */
  current: boolean;
}

export interface PeriodWindow {
  kind: PeriodKind;
  /** The date the person chose; kept across period switches. */
  anchor: LocalDate;
  start: LocalDate;
  /** Exclusive end. */
  end: LocalDate;
  /** Last date of the window (end − 1). */
  last: LocalDate;
  /** day: 1 slot (the date); week: 7; month: 28–31; year: 12 (months). */
  slots: Slot[];
  /** The window contains today. */
  current: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): LocalDate => `${y}-${pad2(m)}-${pad2(d)}`;
const yearOf = (d: LocalDate) => Number(d.slice(0, 4));
const monthOf = (d: LocalDate) => Number(d.slice(5, 7));
const dayOf = (d: LocalDate) => Number(d.slice(8, 10));

const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export function monthStart(d: LocalDate): LocalDate {
  return ymd(yearOf(d), monthOf(d), 1);
}

export function nextMonthStart(d: LocalDate): LocalDate {
  const y = yearOf(d), m = monthOf(d);
  return m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1);
}

export function prevMonthStart(d: LocalDate): LocalDate {
  const y = yearOf(d), m = monthOf(d);
  return m === 1 ? ymd(y - 1, 12, 1) : ymd(y, m - 1, 1);
}

/** Monday of the ISO week containing `d`. */
export function weekStart(d: LocalDate): LocalDate {
  return addDays(d, -weekdayOf(d));
}

/** [start, end) of the period of `kind` containing `anchor`. */
export function periodBounds(kind: PeriodKind, anchor: LocalDate): { start: LocalDate; end: LocalDate } {
  switch (kind) {
    case 'day':
      return { start: anchor, end: addDays(anchor, 1) };
    case 'week': {
      const s = weekStart(anchor);
      return { start: s, end: addDays(s, 7) };
    }
    case 'month':
      return { start: monthStart(anchor), end: nextMonthStart(anchor) };
    case 'year':
      return { start: ymd(yearOf(anchor), 1, 1), end: ymd(yearOf(anchor) + 1, 1, 1) };
  }
}

/** The calendar period of `kind` containing `anchor`, its slots flagged against today (future slots draw nothing). */
export function periodWindow(kind: PeriodKind, anchor: LocalDate, today: LocalDate): PeriodWindow {
  const { start, end } = periodBounds(kind, anchor);
  const slots: Slot[] = [];
  if (kind === 'year') {
    for (let s = start; s < end; s = nextMonthStart(s)) {
      const e = nextMonthStart(s);
      slots.push({ start: s, end: e, future: s > today, current: s <= today && today < e });
    }
  } else {
    for (let d = start; d < end; d = addDays(d, 1)) slots.push({ start: d, end: addDays(d, 1), future: d > today, current: d === today });
  }
  return { kind, anchor, start, end, last: addDays(end, -1), slots, current: start <= today && today < end };
}

/** The window contains `d`. */
export function containsDate(w: Pick<PeriodWindow, 'start' | 'end'>, d: LocalDate): boolean {
  return w.start <= d && d < w.end;
}

/** The neighbouring period's canonical start (its first date); `dir` −1 = earlier, +1 = later. */
export function shiftPeriod(kind: PeriodKind, anchor: LocalDate, dir: -1 | 1): LocalDate {
  const { start, end } = periodBounds(kind, anchor);
  switch (kind) {
    case 'day':
      return addDays(anchor, dir);
    case 'week':
      return addDays(start, 7 * dir);
    case 'month':
      return dir > 0 ? end : prevMonthStart(start);
    case 'year':
      return ymd(yearOf(anchor) + dir, 1, 1);
  }
}

/** › is disabled once the period contains today (or is after it). */
export function canGoLater(w: PeriodWindow, today: LocalDate): boolean {
  return w.end <= today;
}

/** ‹ is disabled on the period containing the first record of any ring or import source (and with no record at all). */
export function canGoEarlier(w: PeriodWindow, firstDate: LocalDate | null): boolean {
  return firstDate !== null && w.start > firstDate;
}

/** Drill down from a slot: a date of a week or month opens that day; a month of a year opens that month. */
export function drillTarget(kind: PeriodKind, slotStart: LocalDate): { period: PeriodKind; date: LocalDate } {
  return kind === 'year' ? { period: 'month', date: monthStart(slotStart) } : { period: 'day', date: slotStart };
}

/** Slots up to today (the current period is truncated at today). */
export function pastSlots(w: PeriodWindow): Slot[] {
  return w.slots.filter((s) => !s.future);
}

/* ------------------------------------------------------------------------------------------------ labels */

/** "Sun 4 Oct" / "Sun Oct 4"; the year is added when it is not the current year ("Sat 4 Oct 2025"). */
export function dayText(d: LocalDate, style: DateStyle = 'day-month', withYear = false): string {
  const wd = WD_SHORT[weekdayOf(d)];
  const mon = MON_SHORT[monthOf(d) - 1];
  const body = style === 'month-day' ? `${mon} ${dayOf(d)}${withYear ? `, ${yearOf(d)}` : ''}` : `${dayOf(d)} ${mon}${withYear ? ` ${yearOf(d)}` : ''}`;
  return `${wd} ${body}`;
}

/** "October 2026". */
export function monthText(d: LocalDate): string {
  return `${MON_LONG[monthOf(d) - 1]} ${yearOf(d)}`;
}

/** "28 Sep – 4 Oct", "21–27 Sep"; another year: "29 Dec 2025 – 4 Jan 2026", "6–12 Oct 2025". Month-day style mirrors it. */
export function rangeText(a: LocalDate, b: LocalDate, today: LocalDate, style: DateStyle = 'day-month'): string {
  const ya = yearOf(a), yb = yearOf(b), yt = yearOf(today);
  const ma = MON_SHORT[monthOf(a) - 1], mb = MON_SHORT[monthOf(b) - 1];
  const da = dayOf(a), db = dayOf(b);
  const sameMonth = ya === yb && monthOf(a) === monthOf(b);
  const thisYear = ya === yt && yb === yt;
  if (style === 'month-day') {
    if (ya !== yb) return `${ma} ${da}, ${ya} ${EN_DASH} ${mb} ${db}, ${yb}`;
    const y = thisYear ? '' : `, ${yb}`;
    return sameMonth ? `${ma} ${da}${EN_DASH}${db}${y}` : `${ma} ${da} ${EN_DASH} ${mb} ${db}${y}`;
  }
  if (ya !== yb) return `${da} ${ma} ${ya} ${EN_DASH} ${db} ${mb} ${yb}`;
  const y = thisYear ? '' : ` ${yb}`;
  return sameMonth ? `${da}${EN_DASH}${db} ${mb}${y}` : `${da} ${ma} ${EN_DASH} ${db} ${mb}${y}`;
}

/**
 * Period label (§7.1). day: "Today", "Yesterday", "Sun 4 Oct" (sleep: "Last night", "Night to Sun 4 Oct"); week:
 * "28 Sep – 4 Oct" (another year: "29 Dec 2025 – 4 Jan 2026"); month: "October 2026"; year: "2026".
 * A night belongs to the date it ends, so "Last night" is the night that ended this morning.
 */
export function periodLabel(tab: SignalsTab, w: PeriodWindow, today: LocalDate, style: DateStyle = 'day-month'): string {
  switch (w.kind) {
    case 'day': {
      const d = w.anchor;
      const day = dayText(d, style, yearOf(d) !== yearOf(today));
      if (tab === 'sleep') return d === today ? 'Last night' : `Night to ${day}`;
      if (d === today) return 'Today';
      if (d === addDays(today, -1)) return 'Yesterday';
      return day;
    }
    case 'week':
      return rangeText(w.start, w.last, today, style);
    case 'month':
      return monthText(w.start);
    case 'year':
      return String(yearOf(w.start));
  }
}

/* ------------------------------------------------------------------------------------------------ reference day */

/**
 * The tab's reference day (the default date): today for activity and heart; for sleep the wake date of the newest main
 * night that is ≤ today, so at 02:00 (no night has ended today yet) it shows the night before, not an empty "tonight".
 */
export function referenceDay(tab: SignalsTab, today: LocalDate, nightDates: readonly LocalDate[]): LocalDate {
  if (tab !== 'sleep') return today;
  let best: LocalDate | null = null;
  for (const d of nightDates) if (d <= today && (best === null || d > best)) best = d;
  return best ?? today;
}

/* ------------------------------------------------------------------------------------------------ coverage */

/** "5 of 7 nights recorded" / "26 of 31 days recorded" (only slots up to today count). */
export function coverageText(recorded: number, slots: number, unit: 'nights' | 'days' | 'months'): string {
  return `${recorded} of ${slots} ${unit} recorded`;
}

/** Whole days in a window up to today (for averages and coverage); 0 for a window after today. */
export function daysUpTo(w: PeriodWindow, today: LocalDate): number {
  if (w.start > today) return 0;
  const last = w.last < today ? w.last : today;
  return daysBetween(w.start, last) + 1;
}

/* ------------------------------------------------------------------------------------------------ URL state */

export interface SignalsQuery {
  tab: SignalsTab;
  period: PeriodKind;
  /** null: the tab's reference day. */
  date: LocalDate | null;
}

const isTab = (s: string | null): s is SignalsTab => s !== null && (SIGNALS_TABS as readonly string[]).includes(s);
const isPeriod = (s: string | null): s is PeriodKind => s !== null && (PERIOD_KINDS as readonly string[]).includes(s);

/** `?tab=sleep|heart|activity&period=day|week|month|year&date=YYYY-MM-DD`; anything else falls back to the defaults. */
export function parseSignalsQuery(params: URLSearchParams, today: LocalDate): SignalsQuery {
  const tab = params.get('tab'), period = params.get('period'), date = params.get('date');
  return {
    tab: isTab(tab) ? tab : 'sleep',
    period: isPeriod(period) ? period : 'day',
    // a future date is clamped to today (the future is blocked); a date that does not exist is ignored
    date: isLocalDate(date) ? (date > today ? today : date) : null,
  };
}

/** The query string of a Body signals state (defaults omitted), without the "?". */
export function signalsSearch(q: Partial<SignalsQuery> = {}): string {
  const p = new URLSearchParams();
  if (q.tab && q.tab !== 'sleep') p.set('tab', q.tab);
  if (q.period && q.period !== 'day') p.set('period', q.period);
  if (q.date) p.set('date', q.date);
  return p.toString();
}

/** The Body signals link for a tab, period and date (omits defaults). */
export function signalsHref(q: Partial<SignalsQuery> = {}): string {
  const s = signalsSearch(q);
  return `/signals${s ? `?${s}` : ''}`;
}

/* ------------------------------------------------------------------------------------------------ calendar + clock */

/** The weeks (Monday first, 7 dates each) that cover the month of `d`, including the neighbouring months' days. */
export function calendarWeeks(d: LocalDate): LocalDate[][] {
  const first = monthStart(d);
  const end = nextMonthStart(d);
  const weeks: LocalDate[][] = [];
  for (let s = weekStart(first); s < end; s = addDays(s, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(s, i)));
  return weeks;
}

/** Local midnight to the next local midnight (ms) in the runtime's zone: 23 or 25 hours on a clock-change day. */
export function localDayMs(d: LocalDate): { start: number; end: number } {
  const n = addDays(d, 1);
  return { start: new Date(yearOf(d), monthOf(d) - 1, dayOf(d)).getTime(), end: new Date(yearOf(n), monthOf(n) - 1, dayOf(n)).getTime() };
}

/** The local calendar date of an instant (ms) in the runtime's zone. */
export function localDateOfMs(t: number): LocalDate {
  const x = new Date(t);
  return ymd(x.getFullYear(), x.getMonth() + 1, x.getDate());
}
