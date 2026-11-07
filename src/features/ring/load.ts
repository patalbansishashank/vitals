/**
 * (0.6.3 S21/A18) Training load on the Ring (V2 `train-load/1`) from the APPROVED activities and their supported HR:
 * each approved activity becomes a `LoadBout` (its decided window and pauses, a Borg CR10 rating when logged, the
 * minute-mean HR of S2's timelines over the window — every calendar date it touches), then `trainingLoad` names one method
 * (session-RPE or Banister TRIMP, never summed) and `priorDayTrimpBalance` gives the recovery index its prior-day part
 * when eligible. TRIMP needs a WAKING resting HR the person entered, a maximum and a known sex: without them the load is
 * unavailable, and the screens say which is missing (never estimated).
 */
import { useMemo } from 'react';
import { priorDayTrimpBalance, trainingLoad, type HrSegment, type LoadBout, type LoadProfile, type TrainingLoad } from '@/living/sensors';
import type { GaugeTimeline } from '@/net/gauge';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { datesOverlapping, type RingActivity } from './activities';
import { useActivity } from './data';
import { calendarDate, shiftDate } from './model';
import { useRingActivities } from './useActivities';
import { useGauge, useNow } from './useGauge';
import { activitySegments } from './zones';
import { useCurrentHrProfile } from './zoneSource';

/** Days of history the load and the prior-day balance read (28 + yesterday + today). */
export const LOAD_DAYS = 30;

/**
 * The supported HR over a window from the timelines of every date it touches, through the one source-resolved rule
 * (r063 FX2): the minute means of every source (Gauge and Health Connect minutes alike); load reads no exact readings.
 */
export function segmentsOver(window: { start: number; end: number }, timelines: ReadonlyMap<string, GaugeTimeline | null>, tz: string): HrSegment[] {
  const tls = datesOverlapping(window, tz).flatMap((d) => {
    const t = timelines.get(d);
    return t ? [t] : [];
  });
  return activitySegments(tls, null, window);
}

/** Approved activities as load bouts (an activity without a clock time keeps its minutes and rating; it has no HR). */
export function loadBoutsOf(acts: readonly RingActivity[], timelines: ReadonlyMap<string, GaugeTimeline | null>, tz: string): LoadBout[] {
  return acts
    .filter((a) => a.status === 'approved' && a.durationMin !== null && a.durationMin > 0)
    .map((a) => ({
      id: a.id,
      date: a.date,
      durationMin: a.durationMin!,
      ...(a.rpeCr10 !== null ? { rpe: a.rpeCr10, rpeScale: 'cr10' as const } : {}),
      ...(a.window ? { window: a.window, pauses: a.pauses, segments: segmentsOver(a.window, timelines, tz) } : {}),
    }));
}

/** Days before `date` the ring recorded (a daily summary) with no approved activity: rest days at 0 AU. */
export function restDaysOf(watched: ReadonlySet<string>, date: string, bouts: readonly LoadBout[]): string[] {
  const withBout = new Set(bouts.map((b) => b.date));
  return [...watched].filter((d) => d < date && !withBout.has(d)).sort();
}

export interface RingLoad {
  load: TrainingLoad;
  /** The recovery index's prior-day part (TRIMP only), null when not eligible. */
  balance: ReturnType<typeof priorDayTrimpBalance>;
  /** What TRIMP waits on, when it does. */
  missing: 'noWakingRest' | 'sexUnknown' | 'noHrMax' | null;
}

export function ringLoad(i: { date: string; acts: readonly RingActivity[]; timelines: ReadonlyMap<string, GaugeTimeline | null>; tz: string; profile: LoadProfile; watched: ReadonlySet<string> }): RingLoad {
  const bouts = loadBoutsOf(i.acts, i.timelines, i.tz);
  const historyStart = [...i.watched].sort()[0] ?? null;
  const load = trainingLoad({ date: i.date, bouts, profile: i.profile, historyStart });
  const balance = priorDayTrimpBalance({ date: i.date, bouts, profile: i.profile, restDays: restDaysOf(i.watched, i.date, bouts) });
  const missing = i.profile.hrMax === null ? 'noHrMax' : i.profile.wakingHrRest === null ? 'noWakingRest' : i.profile.sex !== 'male' && i.profile.sex !== 'female' ? 'sexUnknown' : null;
  return { load, balance, missing };
}

/**
 * The timelines of `dates` through the Ring's client (one cached question for the set; each date's own answer is the
 * server's `timeline?date`), re-asked after an import and dropped on a pairing change like every Ring answer. Null while
 * it loads; a date the server cannot answer is null (no coverage, never zeros).
 */
export function useTimelines(dates: readonly string[], today: string): ReadonlyMap<string, GaugeTimeline | null> | null {
  const asked = dates.filter((d) => d <= today);
  const q = useGauge(`timelines:${asked.join(',')}`, (a) =>
    a.timeline ? Promise.all(asked.map((d) => a.timeline!(d).catch(() => null))).then((xs) => xs as Array<GaugeTimeline | null>) : Promise.resolve(null),
  );
  return useMemo(() => {
    if (q.status === 'loading') return null;
    const m = new Map<string, GaugeTimeline | null>();
    asked.forEach((d, k) => m.set(d, q.data?.[k] ?? null));
    return m;
    // `asked` is keyed by the question
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
}

/** The person's load profile: the HR maximum now, the WAKING resting HR they entered, and their sex. */
export function useLoadProfile(date: string): LoadProfile {
  const hp = useCurrentHrProfile(date);
  const rest = useSettingsStore((s) => s.hrProfile?.hrRestOverride ?? null);
  const sex = useProfileStore((s) => (s as { sex?: unknown }).sex);
  return useMemo(() => ({ hrMax: hp.hrMax?.bpm ?? null, wakingHrRest: typeof rest === 'number' && Number.isFinite(rest) ? rest : null, sex: sex === 'male' || sex === 'female' ? sex : null }), [hp.hrMax?.bpm, rest, sex]);
}

/** The day's training load and prior-day balance; null while the timelines load. */
export function useRingLoad(date: string): RingLoad | null {
  const from = shiftDate(date, -(LOAD_DAYS - 1));
  const acts = useRingActivities(from, date);
  const today = calendarDate(useNow());
  // only the dates an approved activity touches are read minute by minute; the days the ring recorded come from one summary
  const dates = useMemo(() => [...new Set(acts.approved.flatMap((a) => (a.window ? datesOverlapping(a.window, acts.tz) : [])))].sort(), [acts]);
  const timelines = useTimelines(dates, today);
  const days = useActivity(from, date);
  const watched = useMemo(() => new Set((days.data?.days ?? []).filter((d) => d.steps !== null || (d.fusedHeadline ?? null) !== null).map((d) => d.date)), [days.data]);
  const profile = useLoadProfile(date);
  return useMemo(() => (timelines && days.status !== 'loading' ? ringLoad({ date, acts: acts.approved, timelines, tz: acts.tz, profile, watched }) : null), [timelines, days.status, date, acts, profile, watched]);
}

/**
 * (r063 FX2, final review sR17/aR15) The recovery index's prior-day part for every date of [from, to], worked out like
 * the headline's (`priorDayTrimpBalance` over the approved activities of the 30 days before each date, the same rest
 * days and the person's load profile now): the score history's load contributor. Null while the inputs load.
 */
export function useRingLoadBalances(from: string, to: string): ReadonlyMap<string, number | null> | null {
  const lo = shiftDate(from, -(LOAD_DAYS - 1));
  const acts = useRingActivities(lo, to);
  const today = calendarDate(useNow());
  const dates = useMemo(() => [...new Set(acts.approved.flatMap((a) => (a.window ? datesOverlapping(a.window, acts.tz) : [])))].sort(), [acts]);
  const timelines = useTimelines(dates, today);
  const days = useActivity(lo, to);
  const watched = useMemo(() => new Set((days.data?.days ?? []).filter((d) => d.steps !== null || (d.fusedHeadline ?? null) !== null).map((d) => d.date)), [days.data]);
  const profile = useLoadProfile(to);
  return useMemo(() => {
    if (!timelines || days.status === 'loading') return null;
    const bouts = loadBoutsOf(acts.approved, timelines, acts.tz);
    const out = new Map<string, number | null>();
    for (let d = from; d <= to; d = shiftDate(d, 1)) out.set(d, priorDayTrimpBalance({ date: d, bouts, profile, restDays: restDaysOf(watched, d, bouts) })?.score ?? null);
    return out;
  }, [timelines, days.status, acts, profile, watched, from, to]);
}
