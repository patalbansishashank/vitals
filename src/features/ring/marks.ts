/**
 * (r069 U2) Which days of the calendar's month hold ring data (a step count or a night), for the date control's dots
 * (`DateControl` `useMarks`). The month's two questions are the ones the Activity and Sleep tabs ask, cached alike.
 */
import { useMemo } from 'react';
import { useActivity, useSleep } from './data';
import { calendarDate } from './model';
import { useNow } from './useGauge';

export function useRingDays(from: string, to: string): ReadonlySet<string> | null {
  const today = calendarDate(useNow());
  const end = to > today ? today : to;
  const past = from <= end;
  // a month wholly ahead asks nothing (the same cached question as this month's, answered empty)
  const act = useActivity(past ? from : end, end);
  const sleep = useSleep(past ? from : end, end);
  return useMemo(() => {
    if (!past) return new Set<string>();
    if (act.status === 'loading' && sleep.status === 'loading') return null;
    const out = new Set<string>();
    if (act.status === 'ready') for (const d of act.data.days) if ((d.fusedHeadline ?? d.steps ?? 0) > 0) out.add(d.date);
    if (sleep.status === 'ready') for (const s of sleep.data.sessions) if (s.wakingDate >= from && s.wakingDate <= end) out.add(s.wakingDate);
    return out;
  }, [act, sleep, from, end, past]);
}
