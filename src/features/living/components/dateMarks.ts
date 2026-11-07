/**
 * (r069 U2) Which days of the calendar's month hold something the person logged or marked, for the date control's dots
 * (`DateControl` `useMarks`). Read from the Living source the page already uses, so it costs no extra question.
 */
import { useMemo } from 'react';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import { useLiving } from '../data/source';

export function useLoggedDays(from: LocalDate, to: LocalDate): ReadonlySet<string> | null {
  const dates = useMemo(() => {
    const out: LocalDate[] = [];
    for (let d = from; d <= to && out.length < 42; d = addDays(d, 1)) out.push(d);
    return out;
  }, [from, to]);
  return useLiving((s) => new Set(s.days(dates).filter((d) => d.logged).map((d) => d.date)), [dates]);
}
