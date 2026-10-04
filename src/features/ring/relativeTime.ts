/**
 * "last read" wording for the Ring page (design/screens/ring-pages.md §5.2): "just now" under a minute, "6 min ago",
 * "3 h ago" (same day), "yesterday 22:10", "Tue 1 Oct" (the year added when it is not this year), then the clock time.
 * Local time, 24-hour clock. `useNow` ticks every 30 s so the words stay true while the page is open.
 */
import { useEffect, useState } from 'react';
import { RING_PAGE_COPY } from './copy';

const T = RING_PAGE_COPY.time;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const toMs = (at: number | string) => (typeof at === 'number' ? at : Date.parse(at));

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "13:35" (local). */
export function clockText(at: number | string): string {
  const d = new Date(toMs(at));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Tue 1 Oct" ("Tue 1 Oct 2025" in another year than `now`'s). */
export function dayText(at: number | string, now: number): string {
  const d = new Date(toMs(at));
  const y = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${y}`;
}

/** Which calendar day `at` falls on, seen from `now`: 0 today, 1 yesterday, … (negative in the future). */
function daysBefore(at: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
}

/** "just now" / "6 min ago" / "3 h ago" / "yesterday 22:10" / "Tue 1 Oct". */
export function relativeTime(at: number | string, now: number): string {
  const t = toMs(at);
  const diff = now - t;
  if (diff < 60_000) return T.justNow; // includes a clock a little ahead of ours
  if (diff < 3_600_000) return T.minutesAgo(Math.floor(diff / 60_000));
  const days = daysBefore(t, now);
  if (days <= 0) return T.hoursAgo(Math.floor(diff / 3_600_000));
  if (days === 1) return T.yesterday(clockText(t));
  return dayText(t, now);
}

/** The relative words plus the clock time: "6 min ago · 13:35", "yesterday 22:10", "Tue 1 Oct · 13:35". */
export function lastReadText(at: number | string, now: number, by?: string): string {
  const t = toMs(at);
  const rel = relativeTime(t, now);
  const when = by ? RING_PAGE_COPY.card.lastReadOn(rel, by) : rel;
  // "yesterday 22:10" already carries its clock.
  return daysBefore(t, now) === 1 && now - t >= 3_600_000 ? when : RING_PAGE_COPY.card.withClock(when, clockText(t));
}

/** "09:12" today, "yesterday 22:10", "Tue 1 Oct" earlier: the "since …" of a ring held by another device. */
export function sinceText(at: number | string, now: number): string {
  const t = toMs(at);
  const days = daysBefore(t, now);
  if (days <= 0) return clockText(t);
  if (days === 1) return T.yesterday(clockText(t));
  return dayText(t, now);
}

/** The current time, re-read every `intervalMs` (30 s by default) while the component is mounted. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
