/**
 * Recurrence of a supplement row (D7-04). Pure. A schedule keeps its shape (daily, weekly days, alternate days, dates, as
 * needed); a legacy row without one keeps the app's existing reading of a taking row — every day at its times of day —
 * labelled `assumedDaily`, so that assumption stays visible.
 */
import type { IsoDate, SupplementSchedule } from '@/lib/bodyContracts';
import type { SupplementRow } from './types';

export type RecurrenceKind = SupplementSchedule['kind'] | 'assumedDaily';

const DAY_MS = 86_400_000;
const dayNumber = (d: IsoDate): number => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY_MS);

/**
 * Recurrence of a row: its schedule, else (legacy) the app's existing reading of a taking row — every day at its times of
 * day — labelled `assumedDaily`. Occasions per dose day = times of day (at least one).
 */
export function recurrenceOf(row: Pick<SupplementRow, 'schedule' | 'timesOfDay'>): { kind: RecurrenceKind; occasionsPerDoseDay: number; doseDaysPerWeek: number | null } {
  const s = row.schedule;
  const occasions = Math.max(1, s?.timesOfDay?.length ?? row.timesOfDay.length);
  if (!s) return { kind: 'assumedDaily', occasionsPerDoseDay: occasions, doseDaysPerWeek: 7 };
  switch (s.kind) {
    case 'daily':
      return { kind: 'daily', occasionsPerDoseDay: occasions, doseDaysPerWeek: 7 };
    case 'weekly':
      return { kind: 'weekly', occasionsPerDoseDay: occasions, doseDaysPerWeek: Math.max(1, new Set(s.daysOfWeek ?? []).size) };
    case 'alternateDay':
      return { kind: 'alternateDay', occasionsPerDoseDay: occasions, doseDaysPerWeek: 3.5 };
    case 'dates': {
      const ds = [...new Set(s.dates ?? [])].sort();
      if (ds.length === 0) return { kind: 'dates', occasionsPerDoseDay: occasions, doseDaysPerWeek: null };
      const span = dayNumber(ds[ds.length - 1]!) - dayNumber(ds[0]!) + 1;
      return { kind: 'dates', occasionsPerDoseDay: occasions, doseDaysPerWeek: span >= 7 ? (7 * ds.length) / span : null };
    }
    default:
      return { kind: s.kind, occasionsPerDoseDay: occasions, doseDaysPerWeek: null };
  }
}

/** Whether a row is a dose day on `date` (true/false), or unknown (as needed / unknown recurrence / unanchored weekly). */
export function isDoseDay(row: Pick<SupplementRow, 'schedule' | 'timesOfDay' | 'since'>, date: IsoDate): boolean | null {
  const s = row.schedule;
  const from = s?.from ?? row.since;
  if (from && date < from) return false;
  if (s?.to && date > s.to) return false;
  if (!s) return true;
  switch (s.kind) {
    case 'daily':
      return true;
    case 'weekly': {
      if (!s.daysOfWeek?.length) return null;
      const wd = (new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
      return s.daysOfWeek.includes(wd);
    }
    case 'alternateDay':
      return from ? (dayNumber(date) - dayNumber(from)) % 2 === 0 : null;
    case 'dates':
      return (s.dates ?? []).includes(date.slice(0, 10));
    default:
      return null;
  }
}

