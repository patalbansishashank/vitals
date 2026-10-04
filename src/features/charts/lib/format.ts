/* ==========================================================================
   Number, unit and date formatting (DESIGN_DIRECTION §3.1, §7).
   - true minus sign (U+2212), thin-space thousands (U+2009) in metric locales
   - units follow a thin space; "index" is never printed after a value
   - ranges use an en dash, or " to " when a bound is negative
   ========================================================================== */
import type { TimeBase } from '../types';

export const MINUS = '−';
export const THIN = ' ';
export const EN_DASH = '–';

export interface FormatOptions {
  /** Thousands separator: thin space (default) or "," for en-US. */
  thousands?: string;
}

let defaultThousands = THIN;
/** App-wide separator (settings: metric → thin space, en-US → comma). */
export function setThousandsSeparator(sep: string): void {
  defaultThousands = sep;
}

function group(intPart: string, sep: string): string {
  if (intPart.length <= 3) return intPart;
  let out = '';
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) out += sep;
    out += intPart[i];
  }
  return out;
}

/** "19.8", "−0.40", "2 540". NaN → "—". */
export function formatNumber(v: number, decimals: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(v)) return '—';
  const sep = opts.thousands ?? defaultThousands;
  const fixed = Math.abs(v).toFixed(Math.max(0, decimals));
  const negative = v < 0 && Number(fixed) !== 0;
  const [i = '0', f] = fixed.split('.');
  const body = group(i, sep) + (f !== undefined ? '.' + f : '');
  return (negative ? MINUS : '') + body;
}

/** "+1.2", "−4.4", "±0.0". */
export function formatSigned(v: number, decimals: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(v)) return '—';
  const body = formatNumber(Math.abs(v), decimals, opts);
  if (Number(Math.abs(v).toFixed(decimals)) === 0) return '±' + body;
  return (v > 0 ? '+' : MINUS) + body;
}

/** Unit as printed after a value; indices print nothing. */
export function unitSuffix(unit: string): string {
  return unit === 'index' ? '' : unit;
}

/** "19.8 kg", "62" (index), "1.40 mmol/L". */
export function formatValue(v: number, decimals: number, unit: string, opts: FormatOptions = {}): string {
  const u = unitSuffix(unit);
  return formatNumber(v, decimals, opts) + (u && Number.isFinite(v) ? THIN + u : '');
}

/** "18.6–21.0" or "−340 to −60". */
export function formatRange(lo: number, hi: number, decimals: number, opts: FormatOptions = {}): string {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '—';
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const sa = formatNumber(a, decimals, opts);
  const sb = formatNumber(b, decimals, opts);
  return a < 0 || b < 0 ? `${sa} to ${sb}` : `${sa}${EN_DASH}${sb}`;
}

/** Percent change from a start value, e.g. −17.8. Returns NaN when the start is ~0. */
export function percentChange(start: number, v: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(v) || Math.abs(start) < 1e-9) return NaN;
  return ((v - start) / Math.abs(start)) * 100;
}

/** Decimals for tick labels given the tick step. */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  if (step >= 1) return 0;
  return Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
}

/* ------------------------------------------------------------------ dates */

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function parseISODate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** UTC date parts for a day index, or null when the time base has no start date. */
export function dayParts(time: Pick<TimeBase, 'startDate'>, day: number) {
  if (!time.startDate) return null;
  const t0 = parseISODate(time.startDate);
  if (t0 == null) return null;
  const d = new Date(t0 + Math.floor(day) * DAY_MS);
  return { weekday: WEEKDAY[d.getUTCDay()]!, date: d.getUTCDate(), month: MONTH[d.getUTCMonth()]! };
}

/** "18:00" for an hour of day (fractional → minutes). */
export function formatClock(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "Thu 19 Nov" (long) · "19 Nov" (short) · "day 46" without a start date. */
export function formatDay(time: Pick<TimeBase, 'startDate'>, day: number, style: 'long' | 'short' = 'long'): string {
  const p = dayParts(time, day);
  if (!p) return `day ${Math.floor(day) + 1}`;
  return style === 'long' ? `${p.weekday} ${p.date} ${p.month}` : `${p.date} ${p.month}`;
}

/** Week number (1-based) of a day index. */
export const weekOf = (day: number): number => Math.floor(day / 7) + 1;
