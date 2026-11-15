/**
 * The clock Living screens read "now" and "today" from (docs/SUITE_SPEC.md §3.4: the UI's current day rolls over at
 * `settings.dayRolloverH`, default 04:00). Injected through context so tests and fixtures are deterministic; nothing in
 * `src/features/living` calls `Date.now()` directly.
 *
 * The day moves on its own: hooks that read the clock re-check it every minute and whenever the page comes back (tab
 * shown, window focused, the Android app resumed), and re-render only when the day itself changes. Without that, a
 * screen left open past the rollover keeps asking for yesterday until it is remounted.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import { appDay, DEFAULT_ROLLOVER_H, rolloverOf } from '@/living/appDay';
import type { LocalDate } from '@/living';
import { useSettingsStore } from '@/state/settingsStore';

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

const TZ_TTL_MS = 60_000;
let cachedTz: { tz: string; at: number } | null = null;

/**
 * The device zone, cached for a minute: resolving it builds a formatter, and every clock reader asks for it two or three
 * times per render. `recheckDay` drops the cache, so a zone change shows up on the next tick or resume.
 */
function systemTz(): string {
  const t = Date.now();
  if (!cachedTz || t - cachedTz.at >= TZ_TTL_MS || t < cachedTz.at) cachedTz = { tz: deviceTz(), at: t };
  return cachedTz.tz;
}

/**
 * The device clock. Zone and rollover are re-read as it runs, so a trip across zones or a change to the person's
 * `dayRolloverH` (read as the command bus and the importer read it) applies without a reload.
 */
export const systemClock: LivingClock = {
  now: () => new Date(),
  get tz() {
    return systemTz();
  },
  get rolloverH() {
    return rolloverOf(useSettingsStore.getState());
  },
};

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

const DAY_TICK_MS = 60_000;
const dayListeners = new Set<() => void>();
let stopDayTicks: (() => void) | null = null;

function recheckDay(): void {
  cachedTz = null;
  for (const l of [...dayListeners]) l();
}

/** One shared ticker for every mounted reader, running only while something listens. */
function startDayTicks(): () => void {
  const timer = setInterval(recheckDay, DAY_TICK_MS);
  // the rollover setting moves the day too
  const offSettings = useSettingsStore.subscribe(recheckDay);
  const doc = typeof document === 'undefined' ? null : document;
  const win = typeof window === 'undefined' ? null : window;
  // timers are throttled or frozen while hidden: check as soon as the page is back. Capacitor fires `resume` on the
  // document when the Android app returns to the foreground.
  doc?.addEventListener('visibilitychange', recheckDay);
  doc?.addEventListener('resume', recheckDay);
  win?.addEventListener('focus', recheckDay);
  return () => {
    clearInterval(timer);
    offSettings();
    doc?.removeEventListener('visibilitychange', recheckDay);
    doc?.removeEventListener('resume', recheckDay);
    win?.removeEventListener('focus', recheckDay);
  };
}

function subscribeDay(onChange: () => void): () => void {
  dayListeners.add(onChange);
  stopDayTicks ??= startDayTicks();
  return () => {
    dayListeners.delete(onChange);
    if (dayListeners.size === 0 && stopDayTicks) {
      stopDayTicks();
      stopDayTicks = null;
    }
  };
}

/** The clock's current day, re-read on each tick; the caller re-renders only when the date changes. */
function useClockDay(clock: LivingClock): LocalDate {
  const read = () => clockToday(clock);
  return useSyncExternalStore(subscribeDay, read, read);
}

export const LivingClockContext = createContext<LivingClock>(systemClock);

/**
 * The clock in effect. Callers re-render when the day changes, so what they derive from it at render time (`currentDay`,
 * a day's hour) catches up after the rollover.
 */
export function useLivingClock(): LivingClock {
  const clock = useContext(LivingClockContext);
  useClockDay(clock);
  return clock;
}

/** Today's plan date (after the rollover rule); moves on by itself when the day rolls over. */
export function useToday(): LocalDate {
  return useClockDay(useContext(LivingClockContext));
}
