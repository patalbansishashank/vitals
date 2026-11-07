/**
 * Day values `day-metrics/1` (energy SPEC Addendum A.1.1; `daily?date` → `derived`). Pure. Peak, non-exercise and
 * workout heart rate; the "sampled non-exercise HR" selection of §S2.5 (`sampledIdleHr`) the baselines reuse. None is
 * a resting heart rate.
 */
import { median } from './hrSupport.ts';

export const DAY_METRICS_VERSION = 'day-metrics/1';

export interface Reading {
  tMs: number;
  bpm: number;
  id?: string;
}

export interface WorkoutSpan {
  id: string;
  startMs: number;
  endMs: number;
  avgHr: number | null;
  durationS: number | null;
  /** The workout's dense samples (the ring's 10-s workout HR, sport telemetry). */
  samples: readonly Reading[];
}

// (P) product defaults
export const SPIKE_BPM = 40;
export const HELD_GAP_MS = 15_000;
export const COOLDOWN_MS = 10 * 60_000;
export const IDLE_CADENCE = 60;
export const IDLE_MIN_N = 5;

const r1 = (n: number) => Math.round(n * 10) / 10;
const byTime = (a: Reading, b: Reading) => a.tMs - b.tMs || ((a.id ?? '') < (b.id ?? '') ? -1 : 1);

/**
 * Drops a reading that differs from the median of its ±2 neighbourhood by more than 40 bpm (P). The window holds the
 * reading itself (a Hampel window of 5), so a spike next to the first reading never drags that reading out too; under 3
 * readings nothing is judged.
 */
export function dropSpikes(readings: readonly Reading[]): Reading[] {
  const xs = [...readings].sort(byTime);
  return xs.filter((x, i) => {
    const w = xs.slice(Math.max(0, i - 2), i + 3).map((y) => y.bpm);
    return w.length < 3 || Math.abs(x.bpm - median(w)!) <= SPIKE_BPM;
  });
}

/** Readings closer than this are one physical reading (a workout sample also stored as a metric reading). */
export const SAME_READING_MS = 1000;

/**
 * The highest value held for 2 or more consecutive samples (each pair at most 15 s apart): the §V2.2 workout peak.
 * Readings under 1 s apart are first collapsed into one (its lowest value), so a duplicated spike is one sample and can
 * never hold a peak by itself.
 */
export function heldPeak(samples: readonly Reading[]): Reading | null {
  const xs: Reading[] = [];
  for (const r of [...samples].sort(byTime)) {
    const last = xs.at(-1);
    if (last && r.tMs - last.tMs < SAME_READING_MS) {
      if (r.bpm < last.bpm) xs[xs.length - 1] = { ...last, bpm: r.bpm };
    } else xs.push(r);
  }
  let best: Reading | null = null;
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1]!;
    const b = xs[i]!;
    if (b.tMs - a.tMs > HELD_GAP_MS) continue;
    const held = Math.min(a.bpm, b.bpm);
    if (!best || held > best.bpm) best = { tMs: a.bpm <= b.bpm ? a.tMs : b.tMs, bpm: held };
  }
  return best;
}

export interface PeakHr {
  bpm: number;
  at: number;
  source: string;
  /** True unless the day's heart rate is dense (a declared cadence): the true peak may be higher. */
  lowerBound: boolean;
}

/** `derived.peakHr` (#34): the spike-filtered maximum of the day's readings, against each workout's held peak. */
export function peakHr(readings: readonly Reading[], workouts: readonly WorkoutSpan[], dense = false): PeakHr | null {
  const inWorkout = (t: number, w: WorkoutSpan) => t >= w.startMs && t < w.endMs;
  const candidates: PeakHr[] = [];
  const held = workouts.map((w) => ({ w, peak: heldPeak([...w.samples, ...readings.filter((r) => inWorkout(r.tMs, w))]) }));
  for (const { w, peak } of held) if (peak) candidates.push({ bpm: peak.bpm, at: peak.tMs, source: `workout:${w.id}`, lowerBound: !dense });
  // a workout with a held peak answers for its own readings; the rest compete after the spike filter
  const covered = held.filter((h) => h.peak).map((h) => h.w);
  const free = dropSpikes(readings).filter((r) => !covered.some((w) => inWorkout(r.tMs, w)));
  for (const r of free) candidates.push({ bpm: r.bpm, at: r.tMs, source: 'hr', lowerBound: !dense });
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.bpm > a.bpm || (b.bpm === a.bpm && b.at < a.at) ? b : a));
}

export interface IdleContext {
  /** Recorded workouts; each excludes its span plus a 10-min cooldown (P). */
  workouts: ReadonlyArray<{ startMs: number; endMs: number }>;
  /** Sleep windows (the stretches slept in: the bouts' recorded windows without a night's wake breaks): never "awake". */
  sleep: ReadonlyArray<{ startMs: number; endMs: number }>;
  /** Selected steps per minute start (minute-supported units only). */
  minuteSteps?: ReadonlyMap<number, { steps: number }>;
}

/**
 * The "sampled non-exercise HR" readings (§S2.5 `sampledIdleHr`): awake, outside workouts and their cooldown, not
 * asleep; for `derived.nonExerciseHr` also outside minutes with a minute-supported cadence ≥ 60/min (P).
 */
export function idleReadings(readings: readonly Reading[], c: IdleContext): Reading[] {
  return readings.filter((r) => {
    if (c.workouts.some((w) => r.tMs >= w.startMs && r.tMs < w.endMs + COOLDOWN_MS)) return false;
    if (c.sleep.some((s) => r.tMs >= s.startMs && r.tMs < s.endMs)) return false;
    const m = c.minuteSteps?.get(Math.floor(r.tMs / 60_000) * 60_000);
    return !(m && m.steps >= IDLE_CADENCE);
  });
}

/** `derived.nonExerciseHr` (#25): median and n; the median needs n ≥ 5 (P). Label "Non-exercise HR"; never RHR. */
export function nonExerciseHr(readings: readonly Reading[], c: IdleContext): { median: number | null; n: number; reason?: 'tooFewReadings' } {
  const xs = idleReadings(readings, c);
  return xs.length >= IDLE_MIN_N ? { median: r1(median(xs.map((x) => x.bpm))!), n: xs.length } : { median: null, n: xs.length, reason: 'tooFewReadings' };
}

/** `derived.avgWorkoutHr` (#24): Σ(avgHr·durationS) ÷ ΣdurationS over the workouts that have an average. */
export function avgWorkoutHr(workouts: ReadonlyArray<{ avgHr: number | null; durationS: number | null }>): { bpm: number; workoutS: number } | null {
  const xs = workouts.filter((w) => typeof w.avgHr === 'number' && typeof w.durationS === 'number' && w.durationS > 0);
  const s = xs.reduce((a, w) => a + w.durationS!, 0);
  return s > 0 ? { bpm: r1(xs.reduce((a, w) => a + w.avgHr! * w.durationS!, 0) / s), workoutS: Math.round(s) } : null;
}
