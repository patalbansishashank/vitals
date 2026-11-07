/**
 * (r069 U2) The periods the Ring's Sleep, Activity and Scores tabs can show (a week, a month, a year or a custom range,
 * chosen in the date control's calendar): the span of days a period covers and the helpers its views share. Each tab's
 * period view lives with its card (`ActivityPeriodView`, `ScoresPeriodView`, `living/sleep/SleepPeriod`). Six days before
 * the period feed the 7-day mean, so its line starts with the period.
 */
import { fmtDateRange } from '@/features/living/format';
import { periodEnd, type Period } from '@/features/living/period';
import type { LocalDate } from '@/living';
import { daysFrom, shiftDate } from '../model';

/** Days before the period that only feed the 7-day mean. */
export const LEAD = 6;

/** Up to this many days a period reads as bars (a week, a month); longer, as dots with the 7-day mean. */
export const BARS_MAX_DAYS = 62;

export interface Span {
  /** First day of the period. */
  from: string;
  /** Its last day so far. */
  end: string;
  /** The first day asked for (six before `from`). */
  loadFrom: string;
  /** The period's days so far. */
  days: string[];
  /** "12–29 Oct" — what the cards cover. */
  range: string;
}

export function spanOf(period: Period, today: string): Span {
  const end = periodEnd(period, today as LocalDate);
  return { from: period.from, end, loadFrom: shiftDate(period.from, -LEAD), days: daysFrom(period.from, end), range: fmtDateRange(period.from as LocalDate, end as LocalDate) };
}
