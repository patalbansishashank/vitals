/**
 * One hook per Gauge question the Ring screens ask (each shares its cached answer across the screens). S2's routes
 * (`baselines`, `timeline`, `steps`) answer `unavailable` on a client without them, never a wrong figure: personal
 * readings then say "Calibrating" (A.2 #5).
 */
import type { GaugeHrIntervals } from '@/net/gauge';
import type { GaugeBucket } from './types';
import { useGauge } from './useGauge';

export const useAvailability = () => useGauge('availability', (a) => a.availability());
export const useDaily = (date: string) => useGauge(`daily:${date}`, (a) => a.daily(date));
export const useSleep = (from: string, to: string) => useGauge(`sleep:${from}:${to}`, (a) => a.sleep(from, to));
export const useActivity = (from: string, to: string) => useGauge(`activity:${from}:${to}`, (a) => a.activity(from, to));
export const useScores = (from: string, to: string, key?: string) => useGauge(`scores:${from}:${to}:${key ?? ''}`, (a) => a.scores(from, to, key));
export const useDevice = () => useGauge('device', (a) => a.device());
export const useShortVideo = (from: string, to: string) => useGauge(`short-video:${from}:${to}`, (a) => a.shortVideo(from, to));
export const useWorkouts = (from: string, to: string) => useGauge(`workouts:${from}:${to}`, (a) => a.workouts(from, to));
export const useSeries = (kind: string, from: string, to: string, bucket: GaugeBucket) =>
  useGauge(`series:${kind}:${from}:${to}:${bucket}`, (a) => a.series({ kind, from, to, bucket }));

/** S2 `/baselines?date` (excluding that night): usual clock times, sleeping low HR, HRV and temperature, learning. */
export const useBaselines = (date: string) => useGauge(`baselines:${date}`, (a) => (a.baselines ? a.baselines(date) : Promise.resolve(null)));
/** S2 `/timeline?date`: one value per local minute (steps, supported HR, sleep stage, sessions). */
export const useTimeline = (date: string) => useGauge(`timeline:${date}`, (a) => (a.timeline ? a.timeline(date) : Promise.resolve(null)));
/** S2 `/steps` (`steps-fuse/1`). */
export const useSteps = (from: string, to: string) => useGauge(`steps:${from}:${to}`, (a) => (a.steps ? a.steps(from, to) : Promise.resolve(null)));
/**
 * (Codex #11) S2 `/hr-intervals`: the raw HR readings of a window (a workout, or a day) with each one's supported interval,
 * every page followed. Unavailable on a server without the route: zone time then falls back to the timeline's minute means.
 */
export const useHrIntervals = (from: string, to: string) =>
  useGauge(`hr-intervals:${from}:${to}`, (a): Promise<GaugeHrIntervals | null> => (a.hrIntervals ? a.hrIntervals(from, to) : Promise.resolve(null)));
