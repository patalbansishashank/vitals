/**
 * Nightly sleep metrics `sleep-metrics/1` (energy SPEC §S2.4 and Addendum A.1.1; RESEARCH IV). Pure: one bout's minute
 * stages and the readings around it in, the metrics out. `./lumenTools.ts` (`gauge_sleep`) attaches them to every
 * session; the primary bout of a waking day is its longest known-asleep one, the others are naps (a night recorded in parts
 * is one bout, below).
 *
 * Unknown is never asleep: `unknown` minutes are the TST bounds' unknown part (K ≤ TST ≤ K + U, energy SPEC §S2.4);
 * gaps (no ring packet, `G`) are reported on their own and never widen the bound, since nothing bounds them. Onset and final wake are the first and last known-asleep minute edges; `session.start` / `end` are the
 * recorded window only. A null always comes with its reason in `reasons`. No index or score is computed here (V2's).
 *
 * (r071) A night the ring recorded in parts (a wake break of an hour or more between two records, joined by
 * `./gaugeDerive.ts` `nightRuns`) arrives as one bout with its `breaks`: minutes no packet covers where the person was up.
 * They count as awake after sleep onset (WASO, wake-ups, named coverage, continuity), never as asleep, and their readings
 * stay out of the night's heart rate, HRV, temperature and SpO2; for the ring's coverage they remain gaps (`G`).
 */
import { dedupeSamples, median, medianGapS, percentile, sampledStats, supportedSeconds, supportSegments, timeWeightedMean, type Sample } from './hrSupport.ts';

export const SLEEP_METRICS_VERSION = 'sleep-metrics/1';

export type Stage = 'light' | 'deep' | 'rem' | 'asleepUnspecified' | 'awake' | 'unknown';
const ASLEEP = new Set<Stage>(['light', 'deep', 'rem', 'asleepUnspecified']);

export interface SleepInput {
  /** The recorded window `[startMs, endMs)` on the minute grid. */
  startMs: number;
  endMs: number;
  /** One entry per minute of the window; null is a gap (no ring packet covers it). */
  stages: ReadonlyArray<Stage | null>;
  nativeEpochS: number | null;
  hr: readonly Sample[];
  hrv: readonly Sample[];
  temp: readonly Sample[];
  spo2: readonly Sample[];
  /** The firmware of the ring that reported the HRV (firmware-qualified). */
  firmware?: readonly string[];
  /**
   * (r071) The wake breaks between the parts of one night, `[startMs, endMs)` on the minute grid inside the window: stretches
   * no packet covers, where the ring recorded no sleep because the person was up. Absent: the night has no break.
   */
  breaks?: ReadonlyArray<{ startMs: number; endMs: number }>;
}

export interface HrTrend {
  word: 'steady' | 'rising' | 'falling';
  magnitude: 'slight' | 'moderate' | 'strong' | null;
  deltaBpm: number;
}

export interface SleepMetrics {
  version: typeof SLEEP_METRICS_VERSION;
  K: number;
  A: number;
  U: number;
  G: number;
  tstLowerMin: number;
  tstUpperMin: number;
  onsetMs: number | null;
  finalWakeMs: number | null;
  midpointMs: number | null;
  leadingWakeMin: number | null;
  stageMinutes: { deep: number; light: number; rem: number; asleepUnspecified: number; awake: number; unknown: number; gap: number };
  restorativeEstimatedMin: number;
  restorativeSharePct: number | null;
  namedCoveragePct: number | null;
  incomplete: boolean;
  windowContinuityPct: number | null;
  wasoMin: number | null;
  awakeningRuns: number | null;
  wakeUps: number | null;
  avgSleepHr: number | null;
  avgSleepHrSupportedS: number;
  sampledMeanSleepHr: { bpm: number; n: number } | null;
  nightlyLowHrP10: { bpm: number; bins: number } | null;
  timeToLowMin: number | null;
  trace5min: Array<{ startMs: number; bpm: number | null; n: number }>;
  hrTrend: HrTrend | null;
  tooFewHrReadings: boolean;
  hrReadings: number;
  hrMedianGapS: number | null;
  hrvNightlyMs: { ms: number; n: number; firmware: string[] } | null;
  hrvWithinNightMs: number | null;
  skinTempNightC: { c: number; n: number } | null;
  spo2Night: { meanPct: number; minPct: number; count: number } | null;
  minutesBelow90: number | null;
  respRate: null;
  tossesTurns: null;
  sleepLatency: null;
  nativeEpochS: number | null;
  coveragePct: number;
  /** Why each null field is null. */
  reasons: Record<string, 'unsupported' | 'cadenceUnknown' | 'noSleep' | 'incomplete' | 'tooFewReadings' | 'noReadings' | 'insufficientSupport'>;
}

// (P) product defaults, A.1.1
export const NAMED_COVERAGE_MIN = 95;
export const WAKE_UP_MIN = 5;
export const BIN_MIN = 5;
export const TREND_MIN_BINS = 9;
export const TOO_FEW_HR = 8;
export const TOO_SPARSE_GAP_S = 20 * 60;
export const HRV_MIN = 5;
export const HRV_WITHIN_MIN = 9;
export const TEMP_MIN = 5;
export const SPO2_MIN = 3;
export const SPO2_CADENCE_MAX_S = 600;
export const LOW_WINDOW_SUPPORT = 0.8;

const MIN = 60_000;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Thirds by count: `[first, middle, last]`, the remainder going to the last. */
function thirds<T>(xs: readonly T[]): [T[], T[], T[]] {
  const s = Math.floor(xs.length / 3);
  return [xs.slice(0, s), xs.slice(s, 2 * s), xs.slice(2 * s)];
}

/** The descriptive trend of the night's 5-min medians (A.1.1 #19): under 2 bpm steady; slight under 5, moderate under 10, else strong. */
export function hrTrendOf(binMedians: readonly number[]): HrTrend | null {
  if (binMedians.length < TREND_MIN_BINS) return null;
  const [, mid, last] = thirds(binMedians);
  const delta = r1(median(last)! - median(mid)!);
  const a = Math.abs(delta);
  if (a < 2) return { word: 'steady', magnitude: null, deltaBpm: delta };
  return { word: delta > 0 ? 'rising' : 'falling', magnitude: a < 5 ? 'slight' : a < 10 ? 'moderate' : 'strong', deltaBpm: delta };
}

const inside = (xs: readonly Sample[], a: number, b: number) => xs.filter((s) => s.tMs >= a && s.tMs < b);
const within = (breaks: ReadonlyArray<{ startMs: number; endMs: number }>, t: number) => breaks.some((x) => t >= x.startMs && t < x.endMs);

export function sleepMetrics(i: SleepInput): SleepMetrics {
  const reasons: SleepMetrics['reasons'] = { respRate: 'unsupported', tossesTurns: 'unsupported', sleepLatency: 'unsupported' };
  const n = i.stages.length;
  const at = (k: number) => i.startMs + k * MIN;
  const breaks = i.breaks ?? [];
  const count = { deep: 0, light: 0, rem: 0, asleepUnspecified: 0, awake: 0, unknown: 0, gap: 0 };
  let first = -1;
  let last = -1;
  i.stages.forEach((s, k) => {
    if (s === null) count.gap++;
    else count[s]++;
    if (s && ASLEEP.has(s)) {
      if (first < 0) first = k;
      last = k;
    }
  });
  const K = count.deep + count.light + count.rem + count.asleepUnspecified;
  const A = count.awake;
  const U = count.unknown;
  const G = count.gap;
  const coveragePct = n ? r1((100 * (n - G)) / n) : 0;

  const empty: Omit<SleepMetrics, 'version' | 'K' | 'A' | 'U' | 'G' | 'tstLowerMin' | 'tstUpperMin' | 'nativeEpochS' | 'coveragePct' | 'reasons'> = {
    onsetMs: null, finalWakeMs: null, midpointMs: null, leadingWakeMin: null, stageMinutes: { deep: 0, light: 0, rem: 0, asleepUnspecified: 0, awake: 0, unknown: 0, gap: 0 }, restorativeEstimatedMin: 0,
    restorativeSharePct: null, namedCoveragePct: null, incomplete: true, windowContinuityPct: null, wasoMin: null, awakeningRuns: null, wakeUps: null, avgSleepHr: null,
    avgSleepHrSupportedS: 0, sampledMeanSleepHr: null, nightlyLowHrP10: null, timeToLowMin: null, trace5min: [], hrTrend: null, tooFewHrReadings: true, hrReadings: 0,
    hrMedianGapS: null, hrvNightlyMs: null, hrvWithinNightMs: null, skinTempNightC: null, spo2Night: null, minutesBelow90: null, respRate: null, tossesTurns: null, sleepLatency: null,
  };
  const base = { version: SLEEP_METRICS_VERSION, K, A, U, G, tstLowerMin: K, tstUpperMin: K + U, nativeEpochS: i.nativeEpochS, coveragePct } as const;
  if (first < 0) {
    for (const k of ['onset', 'finalWake', 'midpoint', 'windowContinuityPct', 'avgSleepHr', 'timeToLowMin', 'nightlyLowHrP10', 'hrvNightlyMs', 'skinTempNightC', 'spo2Night']) reasons[k] = 'noSleep';
    return { ...base, ...empty, reasons };
  }

  // the window [onset, finalWake): stage minutes, named coverage, continuity, wake runs
  const onsetMs = at(first);
  const finalWakeMs = at(last + 1);
  const win = { deep: 0, light: 0, rem: 0, asleepUnspecified: 0, awake: 0, unknown: 0, gap: 0 };
  let runs = 0;
  let wakeUps = 0;
  let run = 0;
  for (let k = first; k <= last; k++) {
    const s = i.stages[k] ?? null;
    // (r071) a wake break between the night's parts is awake after sleep onset: the ring named nothing there because the
    // person was up (a gap anywhere else stays a gap)
    const wake = s === 'awake' || (s === null && within(breaks, at(k)));
    if (s === null && !wake) win.gap++;
    else win[s ?? 'awake']++;
    if (wake) run++;
    if (!wake || k === last) {
      if (run > 0) {
        runs++;
        if (run >= WAKE_UP_MIN) wakeUps++;
      }
      run = 0;
    }
  }
  const named = K + win.awake;
  const windowMin = last + 1 - first;
  const namedCoveragePct = r1((100 * named) / windowMin);
  const incomplete = namedCoveragePct < NAMED_COVERAGE_MIN;
  const windowContinuityPct = incomplete ? null : r1((100 * K) / (K + win.awake));
  if (incomplete) reasons.windowContinuityPct = 'incomplete';
  const restorative = win.deep + win.rem;

  // (r071) a wake break is not sleep: its readings stay out of the night's heart rate, HRV, temperature and SpO2
  const night = (xs: readonly Sample[]) => inside(xs, onsetMs, finalWakeMs).filter((x) => !within(breaks, x.tMs));

  // heart rate: sampled always, time-weighted only over declared-cadence support
  const hrIn = dedupeSamples(night(i.hr));
  const asleepAt = (t: number) => {
    const k = Math.floor((t - i.startMs) / MIN);
    const s = i.stages[k];
    return s !== undefined && s !== null && ASLEEP.has(s);
  };
  const hrAsleep = hrIn.filter((s) => asleepAt(s.tMs));
  const gap = medianGapS(hrIn.map((s) => s.tMs));
  const tooFew = hrIn.length < TOO_FEW_HR || (gap !== null && gap > TOO_SPARSE_GAP_S);
  const segments = supportSegments(i.hr, onsetMs, finalWakeMs);
  const asleepSegments = segments.flatMap((seg) => {
    // clip each support to the asleep minutes it covers
    const out: typeof segments = [];
    for (let t = Math.floor((seg.startMs - i.startMs) / MIN); i.startMs + t * MIN < seg.endMs; t++) {
      if (!asleepAt(i.startMs + t * MIN)) continue;
      const a = Math.max(seg.startMs, i.startMs + t * MIN);
      const b = Math.min(seg.endMs, i.startMs + (t + 1) * MIN);
      if (b > a) out.push({ startMs: a, endMs: b, value: seg.value });
    }
    return out;
  });
  const declared = i.hr.some((s) => s.cadenceS !== null);
  const avg = timeWeightedMean(asleepSegments, onsetMs, finalWakeMs);
  const avgSupportedS = Math.round(supportedSeconds(asleepSegments, onsetMs, finalWakeMs));
  if (avg === null) reasons.avgSleepHr = declared ? 'insufficientSupport' : 'cadenceUnknown';
  const sampled = sampledStats(hrAsleep);

  // 5-min bins from onset: the trace (every reading in the window) and the asleep bins (the nightly low)
  const bins: Array<{ startMs: number; all: number[]; asleep: number[] }> = [];
  for (let t = onsetMs; t < finalWakeMs; t += BIN_MIN * MIN) bins.push({ startMs: t, all: [], asleep: [] });
  for (const s of hrIn) {
    const b = bins[Math.floor((s.tMs - onsetMs) / (BIN_MIN * MIN))];
    if (!b) continue;
    b.all.push(s.value);
    if (asleepAt(s.tMs)) b.asleep.push(s.value);
  }
  const trace5min = bins.map((b) => ({ startMs: b.startMs, bpm: b.all.length ? r1(median(b.all)!) : null, n: b.all.length }));
  const asleepMedians = bins.filter((b) => b.asleep.length).map((b) => median(b.asleep)!);
  const low = percentile(asleepMedians, 10);
  if (low === null) reasons.nightlyLowHrP10 = 'noReadings';
  const nonEmpty = trace5min.filter((b) => b.bpm !== null).map((b) => b.bpm!);
  const hrTrend = tooFew ? null : hrTrendOf(nonEmpty);
  if (!hrTrend) reasons.hrTrend = 'tooFewReadings';

  // time to low: 5-min windows with ≥ 80 % supported coverage, median per window, the earliest minimum
  let timeToLowMin: number | null = null;
  const supported = bins.filter((b) => supportedSeconds(asleepSegments, b.startMs, Math.min(b.startMs + BIN_MIN * MIN, finalWakeMs)) >= LOW_WINDOW_SUPPORT * BIN_MIN * 60 && b.asleep.length);
  if (supported.length) {
    let best = supported[0]!;
    for (const b of supported) if (median(b.asleep)! < median(best.asleep)!) best = b;
    timeToLowMin = Math.round((best.startMs - onsetMs) / MIN);
  } else reasons.timeToLowMin = declared ? 'insufficientSupport' : 'cadenceUnknown';

  // HRV (ring-reported, never recomputed), skin temperature, SpO2
  const hrvIn = dedupeSamples(night(i.hrv)).map((s) => s.value);
  const hrvNightlyMs = hrvIn.length >= HRV_MIN ? { ms: r1(median(hrvIn)!), n: hrvIn.length, firmware: [...new Set(i.firmware ?? [])].sort() } : null;
  if (!hrvNightlyMs) reasons.hrvNightlyMs = hrvIn.length ? 'tooFewReadings' : 'noReadings';
  let hrvWithinNightMs: number | null = null;
  if (hrvIn.length >= HRV_WITHIN_MIN) {
    const [a, , c] = thirds(hrvIn);
    hrvWithinNightMs = r1(median(c)! - median(a)!);
  } else reasons.hrvWithinNightMs = hrvIn.length ? 'tooFewReadings' : 'noReadings';
  const tempIn = dedupeSamples(night(i.temp)).map((s) => s.value);
  const skinTempNightC = tempIn.length >= TEMP_MIN ? { c: Math.round(median(tempIn)! * 100) / 100, n: tempIn.length } : null;
  if (!skinTempNightC) reasons.skinTempNightC = tempIn.length ? 'tooFewReadings' : 'noReadings';
  const spo2In = dedupeSamples(night(i.spo2));
  const spo2Night = spo2In.length >= SPO2_MIN
    ? { meanPct: r1(spo2In.reduce((a, s) => a + s.value, 0) / spo2In.length), minPct: Math.min(...spo2In.map((s) => s.value)), count: spo2In.length }
    : null;
  if (!spo2Night) reasons.spo2Night = spo2In.length ? 'tooFewReadings' : 'noReadings';
  let minutesBelow90: number | null = null;
  if (spo2Night && spo2In.every((s) => s.cadenceS !== null && s.cadenceS <= SPO2_CADENCE_MAX_S)) {
    // each reading stands for its declared cadence, clipped at the midpoints to its neighbours and at the window
    const use = spo2In.map((s, k) => {
      const prev = spo2In[k - 1];
      const next = spo2In[k + 1];
      const h = (s.cadenceS! * 1000) / 2;
      const lo = Math.max(onsetMs, s.tMs - h, prev ? (prev.tMs + s.tMs) / 2 : -Infinity);
      const hi = Math.min(finalWakeMs, s.tMs + h, next ? (s.tMs + next.tMs) / 2 : Infinity);
      return { startMs: lo, endMs: hi, value: s.value };
    });
    minutesBelow90 = Math.round(use.filter((s) => s.value < 90).reduce((a, s) => a + Math.max(0, s.endMs - s.startMs), 0) / MIN);
  } else if (spo2Night) reasons.minutesBelow90 = 'cadenceUnknown';

  return {
    ...base,
    onsetMs, finalWakeMs, midpointMs: onsetMs + (finalWakeMs - onsetMs) / 2, leadingWakeMin: Math.max(0, Math.round((onsetMs - i.startMs) / MIN)),
    stageMinutes: win, restorativeEstimatedMin: restorative, restorativeSharePct: K ? r1((100 * restorative) / K) : null,
    namedCoveragePct, incomplete, windowContinuityPct, wasoMin: win.awake, awakeningRuns: runs, wakeUps,
    avgSleepHr: avg === null ? null : r1(avg), avgSleepHrSupportedS: avgSupportedS,
    sampledMeanSleepHr: sampled.n ? { bpm: r1(sampled.mean!), n: sampled.n } : null,
    nightlyLowHrP10: low === null ? null : { bpm: r1(low), bins: asleepMedians.length },
    timeToLowMin, trace5min, hrTrend, tooFewHrReadings: tooFew, hrReadings: hrIn.length, hrMedianGapS: gap === null ? null : Math.round(gap),
    hrvNightlyMs, hrvWithinNightMs, skinTempNightC, spo2Night, minutesBelow90,
    respRate: null, tossesTurns: null, sleepLatency: null, reasons,
  };
}

/** Status words of the metrics (§1.2), for the response's `statuses`. */
export const SLEEP_METRIC_STATUS = {
  onset: 'inferred', finalWake: 'inferred', midpoint: 'inferred', tstLowerMin: 'inferred', tstUpperMin: 'inferred', stageMinutes: 'inferred',
  restorativeEstimatedMin: 'inferred', leadingWakeMin: 'inferred', wakeUps: 'inferred', windowContinuityPct: 'inferred', namedCoveragePct: 'observed',
  nightlyLowHrP10: 'observed', avgSleepHr: 'observed', sampledMeanSleepHr: 'observed', timeToLowMin: 'observed', hrTrend: 'inferred',
  hrvNightlyMs: 'observed', hrvWithinNightMs: 'observed', spo2Night: 'observed', minutesBelow90: 'observed', skinTempNightC: 'observed',
  respRate: 'unavailable', tossesTurns: 'unavailable', sleepLatency: 'unavailable',
} as const;
