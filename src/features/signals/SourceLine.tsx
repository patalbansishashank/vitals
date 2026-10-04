/**
 * The source line at the foot of each Body signals tab (design/screens/ring-pages.md §6.2, §6.3): which sources fed the
 * shown period ("From J-Style 2301 and an Apple Health import"), when the ring was last read ("read 6 min ago", or
 * "reading your ring · 34 %" while a read runs) and, on Heart and recovery, the tier note. The relative time ticks
 * every 30 s.
 */
import { useEffect, useState } from 'react';
import { useLivingClock } from '@/features/living/clock';
import { SIGNALS_PAGE_COPY as C } from './copyPage';
import { dayText, localDateOfMs, type DateStyle, type SignalsTab } from './models';
import { addDays } from '@/living/dates';

const MIN = 60_000;
const HOUR = 60 * MIN;

const clockOf = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "just now" (< 1 min), "6 min ago", "3 h ago" (same day or under 6 h), "yesterday 22:10", "Tue 1 Oct". */
export function readAgo(at: number, now: number, style: DateStyle = 'day-month'): string {
  const dt = Math.max(0, now - at);
  if (dt < MIN) return C.justNow;
  if (dt < HOUR) return C.minAgo(Math.floor(dt / MIN));
  const day = localDateOfMs(at), today = localDateOfMs(now);
  if (day === today || dt < 6 * HOUR) return C.hAgo(Math.floor(dt / HOUR));
  if (day === addDays(today, -1)) return C.yesterdayAt(clockOf(at));
  return dayText(day, style, day.slice(0, 4) !== today.slice(0, 4));
}

export interface SourceLineProps {
  tab: SignalsTab;
  /** Labels of the sources that fed the shown period. */
  labels: readonly string[];
  /** Newest read of any ring (ms), if known. */
  lastReadAt: number | null;
  /** A read is running: its progress in whole percent (null when the ring does not say), else false. */
  reading: number | null | false;
  dateStyle?: DateStyle;
}

function useNowEvery(ms: number): number {
  const clock = useLivingClock();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return clock.now().getTime();
}

export function SourceLine({ tab, labels, lastReadAt, reading, dateStyle = 'day-month' }: SourceLineProps) {
  const now = useNowEvery(30_000);
  const parts: string[] = [];
  if (labels.length) parts.push(C.from(labels));
  if (reading !== false) parts.push(C.reading(reading));
  else if (lastReadAt !== null) parts.push(C.read(readAgo(lastReadAt, now, dateStyle)));
  const tier = tab === 'heart';
  if (!parts.length && !tier) return null;
  return (
    <p className="sp-source">
      {parts.join(' · ')}
      {tier ? (
        <>
          {parts.length ? ' · ' : null}
          <span className="sp-source__tier">{C.tierNote}</span>
        </>
      ) : null}
    </p>
  );
}
