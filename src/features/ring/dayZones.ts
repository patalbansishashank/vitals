/**
 * (0.6.3 S25/A14) The day's heart-rate zone minutes on the Ring from the APPROVED activities (V2 `dayZones`): each
 * activity's decided window (an edit moves it), its pauses, clipped to the day, a stretch two activities share counted
 * once, each under its own frozen boundaries (the profile now for a log approved without them). Pending activities are a
 * separate "to review" figure, never in the totals; rejected ones never appear. Supported HR (r063 FX2): the one
 * source-resolved rule, the day's raw Gauge readings (`/hr-intervals`) for the Gauge minutes they cover and the timeline's
 * minute means for the rest (Health Connect minutes, minutes the answer missed, no answer).
 */
import { useMemo } from 'react';
import { addDays, localToInstant } from '@/living/dates';
import { dayZones, freezeZoneBoundaries } from '@/living/sensors';
import { dayZoneBouts } from './activities';
import { useHrIntervals, useTimeline } from './data';
import { shiftDate } from './model';
import { useRingActivities } from './useActivities';
import { activitySegments, exactSegments } from './zones';
import { useCurrentHrProfile } from './zoneSource';

export interface RingDayZones {
  /** Seconds in zones 1-3 and 4-5 from approved activities. */
  z13S: number;
  z45S: number;
  /** How many approved activities fall in the day. */
  count: number;
  coveragePct: number | null;
  /** Pending activities of the day, apart (never in the totals); null when none. */
  toReview: { z13S: number; z45S: number; count: number } | null;
}

export function useActivityDayZones(date: string): RingDayZones | null {
  const acts = useRingActivities(shiftDate(date, -1), shiftDate(date, 1));
  const t = useTimeline(date);
  const raw = useHrIntervals(date, date);
  const profile = useCurrentHrProfile(date);
  return useMemo(() => {
    if (t.status === 'loading' || raw.status === 'loading') return null;
    if (t.status !== 'ready' && raw.status !== 'ready') return null;
    const tz = acts.tz;
    const day = { start: Date.parse(localToInstant(date, 0, tz)), end: Date.parse(localToInstant(addDays(date, 1), 0, tz)) };
    if (!Number.isFinite(day.start) || !Number.isFinite(day.end)) return null;
    const tls = t.status === 'ready' ? [t.data] : [];
    const current = freezeZoneBoundaries(profile);
    const bouts = dayZoneBouts(
      [...acts.approved, ...acts.pending],
      (a) => {
        const w = { start: Math.max(a.window.start, day.start), end: Math.min(a.window.end, day.end) };
        const exact = raw.status === 'ready' && w.end > w.start ? exactSegments(raw.data, w) : null;
        // (r063 FX2 sR06/aR06) per source and minute: Gauge's readings where they cover a Gauge minute, else the means
        return activitySegments(tls, exact, w);
      },
      (a) => a.zones ?? current,
    );
    const dz = dayZones({ day, bouts, provisionalOverlay: true });
    const r = dz.toReview;
    return {
      z13S: dz.z13Min * 60,
      z45S: dz.z45Min * 60,
      count: dz.boutIds.length,
      coveragePct: dz.coveragePct,
      toReview: r && r.boutIds.length > 0 ? { z13S: r.z13Min * 60, z45S: r.z45Min * 60, count: r.boutIds.length } : null,
    };
  }, [acts, t, raw, profile, date]);
}
