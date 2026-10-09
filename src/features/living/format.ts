/**
 * Display formatting for Living screens: dates ("Wed 15 Oct"), clock times ("12:30"), date ranges ("21–30 Dec"),
 * weeks for the date strip, and the quiet-mode vocabulary (COMPONENTS §13.9). Pure.
 */
import { addDays, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { EN_DASH, formatNumber } from '@/components/lib/format';

const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WD_LOWER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function parts(date: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

/** "Wed 15 Oct". */
export function fmtDay(date: LocalDate): string {
  const { m, d } = parts(date);
  return `${WD_SHORT[weekdayOf(date)]} ${d} ${MONTHS[m - 1]}`;
}

/** "15 Oct". */
export function fmtDayMonth(date: LocalDate): string {
  const { m, d } = parts(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Wednesday". */
export function fmtWeekday(date: LocalDate): string {
  return WD_LONG[weekdayOf(date)]!;
}

/** "wed" (date strip keys, engraved). */
export function weekdayKey(date: LocalDate): string {
  return WD_LOWER[weekdayOf(date)]!;
}

/** Day of month as a number. */
export function dayOfMonth(date: LocalDate): number {
  return parts(date).d;
}

/** "October" for a "YYYY-MM" or date. */
export function fmtMonth(dateOrMonth: string): string {
  const m = Number(dateOrMonth.slice(5, 7));
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] ?? '';
}

/** "21–30 Dec", "28 Dec–3 Jan", "30 Dec 2026–4 Jan 2027" across years. */
export function fmtDateRange(from: LocalDate, to: LocalDate): string {
  const a = parts(from);
  const b = parts(to);
  if (from === to) return fmtDayMonth(from);
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}${EN_DASH}${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.m === b.m) return `${a.d}${EN_DASH}${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d} ${MONTHS[a.m - 1]}${EN_DASH}${b.d} ${MONTHS[b.m - 1]}`;
}

/** "12:30" from a decimal clock hour; wraps past midnight. */
export function fmtClock(h: number): string {
  const total = Math.round((((h % 24) + 24) % 24) * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** "7 h 10" / "45 min" / "2 h". */
export function fmtHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** The Monday-to-Sunday week containing `date`. */
export function weekOf(date: LocalDate): LocalDate[] {
  const monday = addDays(date, -weekdayOf(date));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Rounded kcal with thin-space grouping: "2 050". */
export function kcal(v: number): string {
  return formatNumber(Math.round(v), 0);
}

/** Grams, rounded: "40". */
export function grams(v: number): string {
  return formatNumber(Math.round(v), 0);
}

/** Quiet vocabulary for a 0–100 score (COMPONENTS §13.9). */
export function quietWord(score: number | null): string {
  if (score === null) return 'not enough logged';
  if (score >= 85) return 'as planned';
  if (score >= 60) return 'mostly';
  if (score >= 30) return 'partly';
  return 'a little';
}

/** Quiet phrase for a fraction eaten of the day's food ("about half of today's food"). */
export function quietEaten(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0.05) return 'nothing logged yet';
  if (fraction < 0.2) return 'a little of today’s food';
  if (fraction < 0.4) return 'about a third of today’s food';
  if (fraction < 0.6) return 'about half of today’s food';
  if (fraction < 0.85) return 'most of today’s food';
  if (fraction <= 1.1) return 'about all of today’s food';
  return 'a bit more than today’s food';
}

/** Likely range from an estimate: P50 ± 1.28 SD (80 %), floored at 0. */
export function likely(value: number, sd: number): { lo: number; hi: number } {
  return { lo: Math.max(0, value - 1.2816 * sd), hi: value + 1.2816 * sd };
}

/** "1 090–1 390". */
export function fmtLikely(value: number, sd: number, decimals = 0): string {
  const { lo, hi } = likely(value, sd);
  return `${formatNumber(lo, decimals)}${EN_DASH}${formatNumber(hi, decimals)}`;
}

/** Slot name for a meal: named slots as they are ("lunch"); generic `mealN` slots by clock time. */
export function mealName(slot: string, clockH: number): string {
  if (!/^meal\d+$/.test(slot)) return slot;
  if (clockH < 10.5) return 'breakfast';
  if (clockH < 15) return 'lunch';
  if (clockH < 18) return 'snack';
  return 'dinner';
}

/** Short weekday names in the order stored plan weekdays use: 0 = Monday … 6 = Sunday (`Weekday` in living/types). */
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Stored plan weekdays (0 = Monday) as "Mon · Thu", in week order. */
export function weekdaysText(days: readonly number[], lower = false): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_SHORT[d] ?? '')
    .filter(Boolean)
    .map((w) => (lower ? w.toLowerCase() : w))
    .join(' · ');
}
