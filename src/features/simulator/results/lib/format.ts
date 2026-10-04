/**
 * Date labels for results chrome ("Sun 27 Dec · day 84", "5 Oct → 27 Dec"). Day indices are 0-based; labels are 1-based.
 */
import type { TimeBase } from '@/features/charts';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateOf(startDate: string | undefined, day: number): Date | null {
  if (!startDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Math.floor(day) * 86_400_000);
}

/** "27 Dec" (or "Sun 27 Dec" with the weekday), null without a start date. */
export function shortDate(startDate: string | undefined, day: number, weekday = false): string | null {
  const d = dateOf(startDate, day);
  if (!d) return null;
  return `${weekday ? `${WEEKDAY[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** "Sun 27 Dec · day 84" — the chart crosshair's order (date first, then the day number), so every readout agrees. */
export function dayLabel(time: Pick<TimeBase, 'startDate'>, day: number): string {
  const date = shortDate(time.startDate, day, true);
  return `${date ? `${date} · ` : ''}day ${Math.floor(day) + 1}`;
}

/** "5 Oct → 27 Dec" (inclusive last day), or "84 days". */
export function dateRange(time: TimeBase): string {
  const a = shortDate(time.startDate, 0);
  const b = shortDate(time.startDate, time.days - 1);
  return a && b ? `${a} → ${b}` : `${time.days} days`;
}

/** "2026-10-05" + 9 → "2026-10-14" (UTC calendar arithmetic); null for a malformed date. */
export function addDaysISO(iso: string, days: number): string | null {
  const d = dateOf(iso, days);
  return d ? d.toISOString().slice(0, 10) : null;
}
