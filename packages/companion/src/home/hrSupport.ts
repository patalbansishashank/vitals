/**
 * Heart-rate support `hr-support/1` (energy SPEC §S2.3; RESEARCH cross-topic "HR support"). Pure.
 *
 * A reading only stands for time when its sampling cadence is **declared** (10 s for the ring's workout 0x54 stream,
 * else the cadence the uploader states). For sample k with cadence c, its support is `[t_k − h, t_k + h)` with
 * h = min(c, 60 s)/2 (P), clipped at the midpoints to the neighbouring samples, at session or pause boundaries and at
 * the window. A gap over min(2c, 60 s) is therefore never bridged. An unknown cadence gives no supported time: only
 * sampled statistics (n, first, last, median). Two readings at one instant are one (duplicates never add coverage).
 * The same rule serves any sampled stream (SpO2's minutes below 90 %).
 */

export const HR_SUPPORT_VERSION = 'hr-support/1';

export interface Sample {
  tMs: number;
  value: number;
  /** The declared cadence in seconds; null when undeclared (no support). */
  cadenceS: number | null;
  id?: string;
}

export interface Segment {
  startMs: number;
  endMs: number;
  value: number;
}

const MAX_HALF_MS = 30_000;

/** One sample per instant (the lowest id, so the result does not depend on input order), sorted by time. */
export function dedupeSamples<T extends Sample>(samples: readonly T[]): T[] {
  const sorted = [...samples].filter((s) => Number.isFinite(s.tMs) && Number.isFinite(s.value))
    .sort((a, b) => a.tMs - b.tMs || ((a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0));
  return sorted.filter((s, i) => i === 0 || s.tMs !== sorted[i - 1]!.tMs);
}

/** One deduplicated sample with the next sample's time and its own supported interval (null: no support). */
export interface SampleSupport<T extends Sample = Sample> {
  sample: T;
  /** The next deduplicated sample's time (null for the last one). */
  nextMs: number | null;
  support: Segment | null;
}

/**
 * Every deduplicated sample (sorted by time) with its supported interval inside `[fromMs, toMs)`: `[t − h, t + h)`, h =
 * min(c, 60 s)/2, clipped at the midpoints to its neighbours, at `boundaries` (instants a support never crosses: a
 * session's start and end, its pauses' edges) and at the window. An undeclared cadence, or a support clipped away, is null.
 */
export function sampleSupports<T extends Sample>(samples: readonly T[], fromMs: number, toMs: number, boundaries: readonly number[] = []): Array<SampleSupport<T>> {
  const xs = dedupeSamples(samples);
  const cuts = [...boundaries].sort((a, b) => a - b);
  return xs.map((s, k) => {
    const prev = xs[k - 1];
    const next = xs[k + 1];
    const nextMs = next ? next.tMs : null;
    if (s.cadenceS === null || !(s.cadenceS > 0)) return { sample: s, nextMs, support: null };
    const h = Math.min(s.cadenceS * 1000, 2 * MAX_HALF_MS) / 2;
    let lo = s.tMs - h;
    let hi = s.tMs + h;
    if (prev) lo = Math.max(lo, (prev.tMs + s.tMs) / 2);
    if (next) hi = Math.min(hi, (s.tMs + next.tMs) / 2);
    for (const b of cuts) {
      if (b > lo && b <= s.tMs) lo = b;
      if (b > s.tMs && b < hi) hi = b;
    }
    lo = Math.max(lo, fromMs);
    hi = Math.min(hi, toMs);
    return { sample: s, nextMs, support: hi > lo ? { startMs: lo, endMs: hi, value: s.value } : null };
  });
}

/**
 * The supported time of each sample inside `[fromMs, toMs)`. `boundaries` are instants a support never crosses (a
 * session's start and end, its pauses' edges).
 */
export function supportSegments(samples: readonly Sample[], fromMs: number, toMs: number, boundaries: readonly number[] = []): Segment[] {
  return sampleSupports(samples, fromMs, toMs, boundaries).flatMap((x) => (x.support ? [x.support] : []));
}

/** Supported seconds of `segments` inside `[a, b)`. */
export function supportedSeconds(segments: readonly Segment[], a: number, b: number): number {
  let ms = 0;
  for (const s of segments) ms += Math.max(0, Math.min(b, s.endMs) - Math.max(a, s.startMs));
  return ms / 1000;
}

/** The time-weighted mean over the supported time inside `[a, b)`, or null when nothing there is supported. */
export function timeWeightedMean(segments: readonly Segment[], a: number, b: number): number | null {
  let w = 0;
  let sum = 0;
  for (const s of segments) {
    const d = Math.max(0, Math.min(b, s.endMs) - Math.max(a, s.startMs));
    w += d;
    sum += d * s.value;
  }
  return w > 0 ? sum / w : null;
}

/** Per minute of `[startMs, startMs + n·60 s)`: the time-weighted mean (null when unsupported) and the supported seconds. */
export function minuteMeans(segments: readonly Segment[], startMs: number, n: number): { bpm: Array<number | null>; supportedS: number[] } {
  const bpm: Array<number | null> = Array.from({ length: n }, () => null);
  const supportedS = Array.from({ length: n }, () => 0);
  const w = Array.from({ length: n }, () => 0);
  const sum = Array.from({ length: n }, () => 0);
  for (const s of segments) {
    const first = Math.max(0, Math.floor((s.startMs - startMs) / 60_000));
    const last = Math.min(n - 1, Math.floor((s.endMs - 1 - startMs) / 60_000));
    for (let i = first; i <= last; i++) {
      const a = startMs + i * 60_000;
      const d = Math.max(0, Math.min(a + 60_000, s.endMs) - Math.max(a, s.startMs));
      w[i]! += d;
      sum[i]! += d * s.value;
    }
  }
  for (let i = 0; i < n; i++) {
    supportedS[i] = Math.round(w[i]! / 1000);
    bpm[i] = w[i]! > 0 ? Math.round((sum[i]! / w[i]!) * 10) / 10 : null;
  }
  return { bpm, supportedS };
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Linear-interpolated percentile (p in 0–100) of a non-empty list. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (p / 100) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Sampled statistics: what an unknown cadence still allows. */
export function sampledStats(samples: readonly Sample[]): { n: number; first: number | null; last: number | null; median: number | null; mean: number | null } {
  const xs = dedupeSamples(samples);
  return {
    n: xs.length, first: xs[0]?.value ?? null, last: xs.at(-1)?.value ?? null, median: median(xs.map((s) => s.value)),
    mean: xs.length ? xs.reduce((a, s) => a + s.value, 0) / xs.length : null,
  };
}

/** Median gap between consecutive readings, in seconds; null under 3 readings. */
export function medianGapS(times: readonly number[]): number | null {
  const t = [...new Set(times)].sort((a, b) => a - b);
  if (t.length < 3) return null;
  return median(t.slice(1).map((x, i) => (x - t[i]!) / 1000));
}

/** The cadence a reading declares: `cadence_s` from the uploader, or 10 s for the ring's workout stream. */
export function declaredCadenceS(provenance: string | null | undefined, cadence: unknown): number | null {
  if (typeof cadence === 'number' && Number.isFinite(cadence) && cadence > 0 && cadence <= 3600) return cadence;
  if (provenance === 'device_workout' || provenance === 'workout_history') return 10;
  return null;
}
