/**
 * Heart Points, Fit-compatible estimate (`fit-points/1`, energy SPEC §V2.3, RESEARCH III.D, DECISION D16).
 *
 * Reproduces Google Fit's published rule (Fit help 7619539, read 2026-10-27) so the owner's numbers are comparable with
 * Fit; it is NOT a personal intensity measure and does not use the personal zones (Tanaka/HRR) or WHO minutes:
 *  - HRmax_fit = 205.8 − 0.685·age;
 *  - per disjoint eligible interval ONE channel, chosen in order HR → cadence → MET (never added for the same seconds);
 *  - HR: [50, 70) % of HRmax_fit = 1 point/min, ≥ 70 % = 2. Eligible only inside an approved activity, or in a minute with
 *    supported locomotion (cadence ≥ 60/min, P); never during sleep and never for still minutes (resting HR can exceed 50 %
 *    of a predicted maximum, RESEARCH "HR support and time in zones");
 *  - cadence (minute-supported fused steps): ≥ 100 = 1, ≥ 130 = 2 only for a run gait;
 *  - MET (the approved session's MET): [3, 6) = 1, ≥ 6 = 2;
 *  - the count is eligible seconds/60 (only the display is rounded); the weekly goal is 150;
 *  - imported external points are a comparison and never stack with these.
 *
 * Warrants: analytically true A (the arithmetic reproduces a published rule); empirical-formal B for the public-health
 * anchor (WHO 2020: 150-300 moderate-equivalent min/wk, which points only approximate); ecologically valid B for the
 * one-channel rule (no double counting). The HR thresholds are broad population proxies (fails in fit, frail or medicated
 * people): label "Heart Points (Fit-compatible estimate)". Calibrate by replaying a week against exported Fit points.
 */
import { SENSOR_VERSIONS, isFiniteNum, sp, unionMs, type Interval, type Ms } from './types';

export const HEART_POINTS_LABEL = 'Heart Points (Fit-compatible estimate)';

/** Fit's population maximum (not Tanaka). NaN without a positive age. */
export const fitHrMax = (ageY: number): number => (ageY > 0 ? sp('fitHrMaxIntercept') - sp('fitHrMaxSlope') * ageY : Number.NaN);

export type PointsChannel = 'hr' | 'cadence' | 'met';

export interface PointsMinute {
  start: Ms;
  /** Eligible seconds of this minute (a bout's last partial minute, paused time left out); default 60 (Codex #12). */
  seconds?: number;
  /** Known asleep: no points from any channel. */
  asleep: boolean;
  /** Inside an APPROVED activity: its session MET (null when unknown) and gait. Pending candidates never earn points. */
  activity?: { met: number | null; gait?: 'walk' | 'run' | null } | null;
  /** Minute-supported fused cadence (steps in this minute); null when the minute's steps are not minute-supported. */
  cadence: number | null;
  /** Gait of a non-activity minute (e.g. a detector's run window); a run gait is needed for 2 cadence points. */
  gait?: 'walk' | 'run' | null;
  /**
   * Supported HR of the minute (`timeline.hr`: time-weighted mean and supported seconds). `parts` (Codex #11): the exact
   * supported sub-intervals of the minute's raw readings, each rated on its own bpm, so 30 s at 110 and 30 s at 170 are
   * not one minute at 140. Without `parts` the mean stands for every supported second.
   */
  hr?: { bpm: number; supportedS: number; parts?: ReadonlyArray<{ bpm: number; seconds: number }> } | null;
}

export interface PointsMinuteResult {
  start: Ms;
  points: number;
  /** The channel per sub-interval: HR for its supported seconds, the next channel for the rest. */
  channels: Array<{ channel: PointsChannel; seconds: number; rate: 0 | 1 | 2 }>;
}

export interface HeartPointsDay {
  version: typeof SENSOR_VERSIONS.heartPoints;
  label: typeof HEART_POINTS_LABEL;
  hrMaxFit: number | null;
  /** Exact eligible-seconds/60 count; round only for display. */
  points: number;
  moderateMin: number;
  vigorousMin: number;
  byChannel: Record<PointsChannel, number>;
  minutes: PointsMinuteResult[];
  /** Imported external points (Fit/Health Connect) for comparison; never added. */
  external: number | null;
  status: 'inferred';
}

const hrRate = (bpm: number, hrMax: number): 0 | 1 | 2 => {
  const pct = (100 * bpm) / hrMax;
  return pct >= sp('fitHrVigorousPct') ? 2 : pct >= sp('fitHrModeratePct') ? 1 : 0;
};

const metRate = (met: number): 0 | 1 | 2 => (met >= sp('fitMetVigorous') ? 2 : met >= sp('fitMetModerate') ? 1 : 0);

function cadenceRate(cadence: number, run: boolean): 0 | 1 | 2 {
  if (cadence >= sp('fitCadenceVigorous') && run) return 2;
  return cadence >= sp('fitCadenceModerate') ? 1 : 0;
}

/** One minute's points (exported for tests: "60 s vigorous = 2", "a 6.0 MET minute = 2"). */
export function minutePoints(m: PointsMinute, hrMax: number | null): PointsMinuteResult {
  const out: PointsMinuteResult = { start: m.start, points: 0, channels: [] };
  if (m.asleep) return out;
  const budget = isFiniteNum(m.seconds) ? Math.max(0, Math.min(60, m.seconds)) : 60;
  if (budget <= 0) return out;
  let rest = budget;
  const moving = isFiniteNum(m.cadence) && m.cadence >= sp('hrEligibleCadence');
  const hrOk = m.hr && isFiniteNum(m.hr.bpm) && isFiniteNum(m.hr.supportedS) && m.hr.supportedS > 0 && hrMax !== null && Number.isFinite(hrMax) && (m.activity != null || moving);
  if (hrOk) {
    const parts = m.hr!.parts?.filter((p) => isFiniteNum(p.bpm) && isFiniteNum(p.seconds) && p.seconds > 0);
    for (const p of parts?.length ? parts : [{ bpm: m.hr!.bpm, seconds: m.hr!.supportedS }]) {
      const s = Math.min(rest, p.seconds);
      if (!(s > 0)) break;
      const rate = hrRate(p.bpm, hrMax!);
      out.channels.push({ channel: 'hr', seconds: s, rate });
      out.points += (s / 60) * rate;
      rest -= s;
    }
  }
  if (rest <= 0) return out;
  const gait = m.activity?.gait ?? m.gait ?? null;
  if (isFiniteNum(m.cadence) && m.cadence >= sp('fitCadenceModerate')) {
    const rate = cadenceRate(m.cadence, gait === 'run');
    out.channels.push({ channel: 'cadence', seconds: rest, rate });
    out.points += (rest / 60) * rate;
    return out;
  }
  const met = m.activity?.met;
  if (m.activity != null && isFiniteNum(met)) {
    const rate = metRate(met);
    out.channels.push({ channel: 'met', seconds: rest, rate });
    out.points += (rest / 60) * rate;
  }
  return out;
}

/**
 * (Codex #12, r063 S11/A25) Eligible seconds of the minute [t, t + 60 s) inside a bout: its overlap with the bout's window,
 * the bout's pauses left out. The one rule the bout estimate (`activityCandidates`) and the day's points (Progress, Today)
 * share, so a bout earns the same points in both.
 */
export function boutSecondsIn(t: Ms, window: Interval, pauses?: readonly Interval[] | null): number {
  const a = Math.max(t, window.start);
  const b = Math.min(t + 60_000, window.end);
  if (!(b > a)) return 0;
  const paused = pauses && pauses.length > 0 ? unionMs(pauses, { start: a, end: b }) : 0;
  return Math.max(0, b - a - paused) / 1000;
}

/** Heart Points of a day (or any run of minutes). `externalPoints` is carried for comparison only. */
export function heartPoints(i: { ageY: number | null; minutes: readonly PointsMinute[]; externalPoints?: number | null }): HeartPointsDay {
  const hrMax = isFiniteNum(i.ageY) && i.ageY > 0 ? fitHrMax(i.ageY) : null;
  const byChannel: Record<PointsChannel, number> = { hr: 0, cadence: 0, met: 0 };
  let points = 0;
  let modS = 0;
  let vigS = 0;
  const minutes: PointsMinuteResult[] = [];
  for (const m of i.minutes) {
    const r = minutePoints(m, hrMax);
    minutes.push(r);
    points += r.points;
    for (const c of r.channels) {
      byChannel[c.channel] += (c.seconds / 60) * c.rate;
      if (c.rate === 1) modS += c.seconds;
      else if (c.rate === 2) vigS += c.seconds;
    }
  }
  return {
    version: SENSOR_VERSIONS.heartPoints,
    label: HEART_POINTS_LABEL,
    hrMaxFit: hrMax,
    points,
    moderateMin: modS / 60,
    vigorousMin: vigS / 60,
    byChannel,
    minutes,
    external: isFiniteNum(i.externalPoints) ? i.externalPoints : null,
    status: 'inferred',
  };
}

/** Weekly points: the sum of the days' own points (external points never stack). */
export const weekPoints = (days: readonly Pick<HeartPointsDay, 'points'>[]): number => days.reduce((a, d) => a + d.points, 0);

/**
 * The week's pace: points so far scaled to a full week (points·7/daysElapsed, P). `daysElapsed` counts today (1-7). Feeds
 * `activity-index/4` as clip(pace/150, 0, 1).
 */
export function weekPointsPace(pointsSoFar: number, daysElapsed: number): number | null {
  if (!isFiniteNum(pointsSoFar) || !isFiniteNum(daysElapsed) || daysElapsed < 1) return null;
  return (pointsSoFar * 7) / Math.min(7, daysElapsed);
}

export const WEEKLY_POINTS_GOAL = sp('weeklyPointsGoal');
