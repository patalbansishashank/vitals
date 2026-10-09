/**
 * Calendar geometry of the schedule raster (simulator-schedule.md §4): rows are calendar weeks (Monday first,
 * engine weekday 0 = Monday), columns are weekdays. A schedule that does not start on a Monday leaves leading blank
 * slots in its first row, so 26 weeks can take 27 rows.
 */
export const WEEKDAYS_SHORT = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY_TITLE = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** UTC date of an ISO day (no time zone drift). */
export function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDaysISO(iso: string, n: number): string {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDaysISO(a: string, b: string): number {
  return Math.round((isoToDate(b).getTime() - isoToDate(a).getTime()) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday (engine convention, MODEL_SPEC §0.1). */
export function weekdayOf(iso: string): number {
  return (isoToDate(iso).getUTCDay() + 6) % 7;
}

/** Today in the user's local calendar as an ISO date. */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The next Monday on or after `iso` (starters begin on a Monday so rows align with weeks). */
export function nextMondayISO(iso: string): string {
  const wd = weekdayOf(iso);
  return wd === 0 ? iso : addDaysISO(iso, 7 - wd);
}

/** "Wed 11 Nov" */
export function formatDayShort(iso: string): string {
  const d = isoToDate(iso);
  return `${WEEKDAY_TITLE[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** "5 Oct" */
export function formatDateShort(iso: string): string {
  const d = isoToDate(iso);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** Cell date: day number and short month with a non-breaking space, "12 Oct". */
export function formatCellDate(iso: string): string {
  const d = isoToDate(iso);
  return `${d.getUTCDate()}\u00a0${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** "Wednesday 11 November" (screen-reader labels). */
export function formatDayLong(iso: string): string {
  const d = isoToDate(iso);
  return `${WEEKDAY_LONG[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]}`;
}

/** Raster geometry for a start date and horizon. */
export interface CalendarGrid {
  startDate: string;
  nDays: number;
  /** Blank slots before day 0 in the first row (= weekday of the start date). */
  offset: number;
  rows: number;
}

export function calendarGrid(startDate: string, nDays: number): CalendarGrid {
  const offset = weekdayOf(startDate);
  return { startDate, nDays, offset, rows: Math.ceil((offset + nDays) / 7) };
}

/** Day index in slot (row, col), or −1 for a blank slot. */
export function dayAt(g: CalendarGrid, row: number, col: number): number {
  const d = row * 7 + col - g.offset;
  return d >= 0 && d < g.nDays ? d : -1;
}

export function rowOf(g: CalendarGrid, day: number): number {
  return Math.floor((day + g.offset) / 7);
}

export function colOf(g: CalendarGrid, day: number): number {
  return (day + g.offset) % 7;
}

/** Day indices of one calendar row (clipped to the horizon). */
export function rowDays(g: CalendarGrid, row: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < 7; c++) {
    const d = dayAt(g, row, c);
    if (d >= 0) out.push(d);
  }
  return out;
}

/** Linear (row-wrapping) range between two days, inclusive. */
export function linearRange(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let d = lo; d <= hi; d++) out.push(d);
  return out;
}

/** Rectangular range: every slot between the two days' rows and columns (e.g. all Thursdays). */
export function rectRange(g: CalendarGrid, a: number, b: number): number[] {
  const r0 = Math.min(rowOf(g, a), rowOf(g, b));
  const r1 = Math.max(rowOf(g, a), rowOf(g, b));
  const c0 = Math.min(colOf(g, a), colOf(g, b));
  const c1 = Math.max(colOf(g, a), colOf(g, b));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const d = dayAt(g, r, c);
      if (d >= 0) out.push(d);
    }
  return out;
}

/** Horizon presets of the HorizonPicker: months → weeks (3 months = 12 weeks, the spec's 84 days). */
export const HORIZON_MONTHS = [1, 2, 3, 4, 6] as const;
export type HorizonMonths = (typeof HORIZON_MONTHS)[number];
export const WEEKS_FOR_MONTHS: Readonly<Record<HorizonMonths, number>> = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 26 };
export const MAX_HORIZON_DAYS = 27 * 7;
export const MIN_HORIZON_DAYS = 7;

export function monthsForDays(days: number): HorizonMonths | null {
  for (const m of HORIZON_MONTHS) if (WEEKS_FOR_MONTHS[m] * 7 === days) return m;
  return null;
}

/** "12 wk" / "12 wk 3 d" */
export function formatHorizon(days: number): string {
  const w = Math.floor(days / 7);
  const r = days % 7;
  return r === 0 ? `${w} wk` : w === 0 ? `${r} d` : `${w} wk ${r} d`;
}

/** Clock hour → "07:30". */
export function formatClock(h: number): string {
  const total = Math.round((((h % 24) + 24) % 24) * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Spoken clock time: "12:30" → "12 30", used in aria-valuetext. */
export function spokenClock(h: number): string {
  return formatClock(h);
}

/** Calendars of at least this many week rows get the week scrubber (WeekScrubber). */
export const SCRUBBER_MIN_WEEKS = 13;
