/** What SignalsPage gives each tab. */
import type { LocalDate } from '@/living';
import type { PeriodKind, PeriodWindow } from '../models';

export interface TabProps {
  /** The shown period (calendar-aligned, truncated at today by `slot.future`). */
  window: PeriodWindow;
  today: LocalDate;
  /** Drill down: a slot in week/month opens that day; a slot in year opens that month. */
  onDrill: (period: PeriodKind, date: LocalDate) => void;
}
