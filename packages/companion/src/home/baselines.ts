/**
 * Personal baselines (energy SPEC §S2.5 and Addendum A.1.1; `/v1/gauge/baselines?date`, `gauge_baselines`). Pure: the
 * primary nights' summaries in, the baselines of a waking date out, **excluding that night**. Each baseline returns its
 * n and the span of days it rests on, so "night 3 of 7" is exact, and a `ready` flag for its gate. No score here.
 */
import { median, percentile } from './hrSupport.ts';

export interface NightSummary {
  /** The waking date (`YYYY-MM-DD`). */
  wakingDate: string;
  /** Local clock minutes since midnight (0–1439). */
  onsetMin: number | null;
  wakeMin: number | null;
  midpointMin: number | null;
  tstLowerMin: number;
  nightlyLowHr: number | null;
  hrvMs: number | null;
  skinTempC: number | null;
}

// (P) product defaults and RESEARCH IV.6 floors
export const CLOCK_DAYS = 28;
export const LOW_HR_DAYS = 14;
export const NIGHTS_NEEDED = 7;
export const SPAN_NEEDED = 6;
export const MIN_R = 0.3;
export const LEARNING_TST_MIN = 180;
export const LOW_HR_S_FLOOR = 3;
export const HRV_S_FLOOR_MS = 3;
export const HRV_S_FLOOR_SHARE = 0.1;

const dayNum = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;

const iqr = (xs: readonly number[]) => percentile(xs, 75)! - percentile(xs, 25)!;
const spanDays = (dates: readonly string[]) => (dates.length ? Math.round(Math.max(...dates.map(dayNum)) - Math.min(...dates.map(dayNum))) : 0);

export interface ClockBaseline {
  /** Local clock minutes (0–1439), null while learning or when the times are too dispersed. */
  minutes: number | null;
  clock: string | null;
  /** Mean resultant length R̄ (0–1). */
  R: number | null;
  n: number;
  ready: boolean;
  reason?: 'learning' | 'dispersed';
}

/** Circular mean of local clock times (θ = 2π·min/1440): ≥ 7 nights, suppressed when R̄ < 0.3 (P). */
export function circularClock(mins: readonly number[]): ClockBaseline {
  const n = mins.length;
  if (!n) return { minutes: null, clock: null, R: null, n, ready: false, reason: 'learning' };
  let c = 0;
  let s = 0;
  for (const m of mins) {
    const th = (2 * Math.PI * m) / 1440;
    c += Math.cos(th);
    s += Math.sin(th);
  }
  c /= n;
  s /= n;
  const R = Math.sqrt(c * c + s * s);
  const mean = ((Math.atan2(s, c) * 1440) / (2 * Math.PI) + 1440) % 1440;
  if (n < NIGHTS_NEEDED) return { minutes: null, clock: null, R: r3(R), n, ready: false, reason: 'learning' };
  if (R < MIN_R) return { minutes: null, clock: null, R: r3(R), n, ready: false, reason: 'dispersed' };
  const minutes = Math.round(mean) % 1440;
  return { minutes, clock: clock(minutes), R: r3(R), n, ready: true };
}

export interface Baselines {
  date: string;
  usualOnset: ClockBaseline;
  usualWake: ClockBaseline;
  usualMidpoint: ClockBaseline;
  /** "Sleeping low HR": the 14-night median of `nightlyLowHrP10`, s = max(IQR/1.349, 3 bpm). */
  sleepLowHr: { medianBpm: number | null; s: number | null; n: number; spanDays: number; ready: boolean };
  /** On ln(HRV): median and s = max(IQR/1.349, ln(1 + 3 ms/median), ln 1.10) over the prior 28 nights. */
  hrvBaseline: { medianMs: number | null; lnMedian: number | null; lnS: number | null; n: number; spanDays: number; ready: boolean };
  tempBaseline: { medianC: number | null; deltaC: number | null; n: number; spanDays: number; ready: boolean };
  learning: { nights: number; needed: number; learning: boolean };
}

/** The baselines of `date` from the primary nights (`tonight`, when given, only supplies ΔT). */
export function computeBaselines(date: string, nights: readonly NightSummary[], tonight?: NightSummary | null): Baselines {
  const d = dayNum(date);
  const prior = (days: number) => nights.filter((x) => dayNum(x.wakingDate) < d && dayNum(x.wakingDate) >= d - days);
  const p28 = prior(CLOCK_DAYS);
  const vals = <K extends keyof NightSummary>(xs: readonly NightSummary[], k: K) => xs.filter((x) => typeof x[k] === 'number') as Array<NightSummary & Record<K, number>>;

  const low = vals(prior(LOW_HR_DAYS), 'nightlyLowHr');
  const lowVals = low.map((x) => x.nightlyLowHr);
  const lowSpan = spanDays(low.map((x) => x.wakingDate));
  const lowMed = median(lowVals);

  const hrv = vals(p28, 'hrvMs').filter((x) => x.hrvMs > 0);
  const ln = hrv.map((x) => Math.log(x.hrvMs));
  const lnMed = median(ln);
  const hrvSpan = spanDays(hrv.map((x) => x.wakingDate));
  const lnS = lnMed === null ? null : Math.max(iqr(ln) / 1.349, Math.log(1 + HRV_S_FLOOR_MS / Math.exp(lnMed)), Math.log(1 + HRV_S_FLOOR_SHARE));

  const temp = vals(p28, 'skinTempC');
  const tempMed = median(temp.map((x) => x.skinTempC));
  const tempSpan = spanDays(temp.map((x) => x.wakingDate));
  const tempReady = temp.length >= NIGHTS_NEEDED && tempSpan >= SPAN_NEEDED;

  const learningNights = new Set(p28.filter((x) => x.tstLowerMin >= LEARNING_TST_MIN).map((x) => x.wakingDate)).size;
  return {
    date,
    usualOnset: circularClock(vals(p28, 'onsetMin').map((x) => x.onsetMin)),
    usualWake: circularClock(vals(p28, 'wakeMin').map((x) => x.wakeMin)),
    usualMidpoint: circularClock(vals(p28, 'midpointMin').map((x) => x.midpointMin)),
    sleepLowHr: {
      medianBpm: lowMed === null ? null : r1(lowMed), s: lowVals.length ? r1(Math.max(iqr(lowVals) / 1.349, LOW_HR_S_FLOOR)) : null,
      n: lowVals.length, spanDays: lowSpan, ready: lowVals.length >= NIGHTS_NEEDED && lowSpan >= SPAN_NEEDED,
    },
    hrvBaseline: {
      medianMs: lnMed === null ? null : r1(Math.exp(lnMed)), lnMedian: lnMed === null ? null : r3(lnMed), lnS: lnS === null ? null : r3(lnS),
      n: hrv.length, spanDays: hrvSpan, ready: hrv.length >= NIGHTS_NEEDED && hrvSpan >= SPAN_NEEDED,
    },
    tempBaseline: {
      medianC: tempMed === null ? null : Math.round(tempMed * 100) / 100,
      deltaC: tempReady && tempMed !== null && typeof tonight?.skinTempC === 'number' ? Math.round((tonight.skinTempC - tempMed) * 100) / 100 : null,
      n: temp.length, spanDays: tempSpan, ready: tempReady,
    },
    learning: { nights: learningNights, needed: NIGHTS_NEEDED, learning: learningNights < NIGHTS_NEEDED },
  };
}
