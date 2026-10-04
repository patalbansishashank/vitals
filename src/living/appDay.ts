/**
 * The app's current day (docs/SUITE_SPEC.md §3.4): events keep their calendar date, but the day the person sees — and
 * that "today" defaults, plan starts and the command bus's `ctx.today` mean — rolls over at `settings.dayRolloverH`
 * (default 04:00). Between midnight and the rollover hour it is still yesterday.
 *
 * Dependency-light on purpose (only `./dates`, which is pure): anything may import it without growing the entry graph.
 * The rule reads the local wall clock, not "now minus N hours", so a DST change in the small hours does not move it.
 */
import { addDays } from './dates';
import type { LocalDate } from './types';

export const DEFAULT_ROLLOVER_H = 4;

export interface AppDayOptions {
  /** IANA zone; the runtime's zone when omitted. */
  tz?: string;
  /** Hour (local, may be fractional) the day rolls over; default 4. */
  rolloverH?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallIn(ms: number, tz: string): { date: LocalDate; hour: number } | null {
  try {
    let f = formatters.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      formatters.set(tz, f);
    }
    const parts = f.formatToParts(new Date(ms));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const hour = Number(g('hour')) % 24;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: hour + Number(g('minute')) / 60 };
  } catch {
    return null; // unknown zone: fall back to the runtime's
  }
}

/** Local calendar date and decimal hour of an instant (runtime zone, or `tz`). */
function wall(ms: number, tz?: string): { date: LocalDate; hour: number } {
  const z = tz ? wallIn(ms, tz) : null;
  if (z) return z;
  const d = new Date(ms);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hour: d.getHours() + d.getMinutes() / 60 };
}

/** The app's current day at `now`: the local date, or the day before when the local time is before the rollover hour. */
export function appDay(now?: Date | number, opts: AppDayOptions = {}): LocalDate {
  // eslint-disable-next-line no-restricted-properties -- the default `now` is the shared app-day helper's convenience
  const ms = now === undefined ? Date.now() : typeof now === 'number' ? now : now.getTime();
  const r = opts.rolloverH;
  const rolloverH = typeof r === 'number' && Number.isFinite(r) && r >= 0 && r < 24 ? r : DEFAULT_ROLLOVER_H;
  const { date, hour } = wall(ms, opts.tz);
  return hour < rolloverH ? addDays(date, -1) : date;
}

/** Reads `dayRolloverH` off a settings object when it carries a valid one. */
export function rolloverOf(settings: unknown): number {
  const v = settings && typeof settings === 'object' ? (settings as { dayRolloverH?: unknown }).dayRolloverH : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 24 ? v : DEFAULT_ROLLOVER_H;
}
