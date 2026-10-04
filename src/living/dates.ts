/**
 * Calendar arithmetic on `LocalDate` ('YYYY-MM-DD', docs/SUITE_SPEC.md §0.1). Pure: no clock — "today" is always an
 * argument. Weekday 0 = Monday (engine convention). Instants are converted to local clock time with `Intl` for an explicit
 * IANA zone (deterministic for a given zone database).
 */
import type { ClockH, Instant, LocalDate } from './types';

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtcMs(date: LocalDate): number {
  const m = RE.exec(date);
  if (!m) throw new Error(`not a LocalDate: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): LocalDate {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== 'string' || !RE.test(s)) return false;
  return fromUtcMs(toUtcMs(s)) === s;
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + Math.round(n) * DAY_MS);
}

/** b − a in whole days. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: LocalDate): number {
  const js = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

/** The next date on `weekday` strictly after `date`. */
export function nextWeekday(date: LocalDate, weekday: number): LocalDate {
  const w = weekdayOf(date);
  const ahead = ((weekday - w + 7) % 7) || 7;
  return addDays(date, ahead);
}

/** Local calendar date and clock hour of an instant in an IANA zone. */
export function instantToLocal(at: Instant, tz: string): { date: LocalDate; clockH: ClockH } {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error(`not an Instant: ${at}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const clockH = Number(get('hour')) + Number(get('minute')) / 60 + Number(get('second')) / 3600;
  return { date, clockH };
}

/** Hours between two instants. */
export function hoursBetween(a: Instant, b: Instant): number {
  return (Date.parse(b) - Date.parse(a)) / 3_600_000;
}

/** UTC offset (minutes, local − UTC) of a zone at an instant. */
function offsetMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Instant of a local date and clock hour in an IANA zone (DST gaps resolve forward). */
export function localToInstant(date: LocalDate, clockH: ClockH, tz: string): Instant {
  const base = toUtcMs(date) + Math.round(clockH * 3_600_000);
  let ms = base - offsetMinutes(base, tz) * 60_000;
  ms = base - offsetMinutes(ms, tz) * 60_000;
  return new Date(ms).toISOString();
}
