/**
 * The clock Living screens read "now" and "today" from (docs/SUITE_SPEC.md §3.4: the UI's current day rolls over at
 * `settings.dayRolloverH`, default 04:00). Injected through context so tests and fixtures are deterministic; nothing in
 * `src/features/living` calls `Date.now()` directly.
 */
import { createContext, useContext } from 'react';
import { appDay, DEFAULT_ROLLOVER_H } from '@/living/appDay';
import type { LocalDate } from '@/living';

export interface LivingClock {
  /** Current instant. */
  now(): Date;
  /** IANA zone of the device. */
  tz: string;
  /** Hour the day rolls over (default 4). */
  rolloverH: number;
}

function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const systemClock: LivingClock = { now: () => new Date(), tz: deviceTz(), rolloverH: DEFAULT_ROLLOVER_H };

/** A clock frozen at a local wall time ("2026-10-01T09:00"), for tests and fixtures. Wall time is read as local. */
export function fixedClock(localWall: string, opts: { tz?: string; rolloverH?: number } = {}): LivingClock {
  const at = new Date(localWall);
  return { now: () => new Date(at.getTime()), tz: opts.tz ?? deviceTz(), rolloverH: opts.rolloverH ?? DEFAULT_ROLLOVER_H };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date of a Date in the runtime's zone. */
export function localDateOf(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The app's current day on a clock (`appDay`): before the rollover hour it is still yesterday. */
export function clockToday(clock: LivingClock): LocalDate {
  return appDay(clock.now(), { tz: clock.tz, rolloverH: clock.rolloverH });
}

/** Same as `clockToday` (older name). */
export const currentDay = clockToday;

/** Decimal clock hour of now (13.5 = 13:30). */
export function clockHourOf(clock: LivingClock): number {
  const n = clock.now();
  return n.getHours() + n.getMinutes() / 60;
}

export const LivingClockContext = createContext<LivingClock>(systemClock);

export function useLivingClock(): LivingClock {
  return useContext(LivingClockContext);
}

/** Today's plan date (after the rollover rule), read at render time. */
export function useToday(): LocalDate {
  return clockToday(useLivingClock());
}
