/**
 * Shared primitives for the Android parity ports (R10 §3 "Shared primitives"). Tier P.
 * Ported from the owner's `service/LocalInsightEngine.kt`, `service/SleepScoreRepository.kt` and
 * `service/InsightSamplePolicy.kt`; `BaselineStats` is upstream (`VitalsZoneModel.kt`) and is re-derived from R10 §3's
 * description (mean, median, p25, p75 interpolated, SD, count, span days), not copied.
 * Float operations keep Kotlin's evaluation order so results are bit-identical where the JVM and V8 agree on
 * `exp`/`sin`/`cos`/`atan2` (both are within 1 ulp of fdlibm; see the parity notes in the tests).
 */

export const DAY_MS = 86_400_000;

/** Kotlin `Double.roundToInt()` = `Math.round`: nearest, ties toward +∞ (−2.5 → −2, 2.5 → 3); NaN throws. JS
 * `Math.round` has the same tie rule and is correctly rounded (0.49999999999999994 → 0 on both). */
export function roundToInt(x: number): number {
  if (Number.isNaN(x)) throw new Error('Cannot round NaN value.');
  return Math.round(x);
}

/** Kotlin `coerceIn`: NaN passes through unchanged. */
export function coerceIn(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Kotlin `maxByOrNull`: the first element with the strictly greatest key. */
export function maxByOrNull<T>(xs: readonly T[], key: (x: T) => number): T | null {
  let best: T | null = null;
  let bestKey = -Infinity;
  for (const x of xs) {
    const k = key(x);
    if (best === null || k > bestKey) {
      best = x;
      bestKey = k;
    }
  }
  return best;
}

/** Kotlin `groupBy(...).values`: groups in first-appearance order. */
export function groupValues<T>(xs: readonly T[], key: (x: T) => string): T[][] {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const g = m.get(k);
    if (g) g.push(x);
    else m.set(k, [x]);
  }
  return [...m.values()];
}

/** Kotlin `sumOf`: left-to-right from 0.0. */
export function sumOf<T>(xs: readonly T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of xs) s += f(x);
  return s;
}

/** Ascending numeric sort on a copy (Kotlin `sorted()` on filtered finite doubles). */
export function sortedNums(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- InsightSamplePolicy.kt

export type MeasurementKind = 'HEART_RATE' | 'HRV' | 'SPO2' | 'TEMPERATURE';

/** `VitalSample(timestampMs, value)`. */
export interface VitalSample {
  t: number;
  value: number;
}

/** Broad signal bounds (`InsightSamplePolicy.accepts`): HR 30–240, HRV (0, 500], SpO2 50–100, temperature 15–45. */
export function accepts(kind: MeasurementKind, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  switch (kind) {
    case 'HEART_RATE': return value >= 30 && value <= 240;
    case 'HRV': return value > 0 && value <= 500;
    case 'SPO2': return value >= 50 && value <= 100;
    case 'TEMPERATURE': return value >= 15 && value <= 45;
  }
}

/** `InsightSamplePolicy.nightlyValues`: distinct timestamps (first wins), ≥ 3 of them spanning ≥ 20 min, else empty. */
export function nightlyValues(samples: readonly VitalSample[]): number[] {
  const seen = new Set<number>();
  const unique: VitalSample[] = [];
  for (const s of samples) {
    if (seen.has(s.t)) continue;
    seen.add(s.t);
    unique.push(s);
  }
  unique.sort((a, b) => a.t - b.t);
  if (unique.length < 3 || unique[unique.length - 1]!.t - unique[0]!.t < 20 * 60_000) return [];
  return unique.map((s) => s.value);
}

// ---------------------------------------------------------------- the three p10 variants (R10 §3)

/** `LocalInsightEngine.percentile`: drops non-finite and ≤ 0, linear interpolation at rank f·(n−1); null when empty. */
export function enginePercentile(values: readonly number[], fraction: number): number | null {
  const sorted = sortedNums(values.filter((v) => Number.isFinite(v) && v > 0));
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0]!;
  const rank = coerceIn(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.trunc(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function engineMedian(values: readonly number[]): number | null {
  return enginePercentile(values, 0.5);
}

/** `SleepScoreRepository` p10: index `roundToInt((n−1)·0.10)` of the sorted values (no interpolation). */
export function indexP10(sortedValues: readonly number[]): number | null {
  if (!sortedValues.length) return null;
  return sortedValues[roundToInt((sortedValues.length - 1) * 0.1)]!;
}

// ---------------------------------------------------------------- BaselineStats (re-derived, R10 §3)

export interface BaselineStats {
  mean: number;
  median: number;
  standardDeviation: number;
  p25: number;
  p75: number;
  sampleCount: number;
  /** (latest − earliest timestamp) / 1 d */
  spanDays: number;
}

function basePercentile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = fraction * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/** Keeps finite values > 0; null with fewer than 2. SD is the population SD (÷ n). */
export function computeBaselineStats(samples: readonly VitalSample[]): BaselineStats | null {
  const valid = samples.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const values = valid.map((s) => s.value);
  if (values.length < 2) return null;
  const sorted = sortedNums(values);
  const count = values.length;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / count;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  let first = Infinity;
  let last = -Infinity;
  for (const s of valid) {
    if (s.t < first) first = s.t;
    if (s.t > last) last = s.t;
  }
  return {
    mean,
    median: basePercentile(sorted, 0.5),
    standardDeviation: Math.sqrt(acc / count),
    p25: basePercentile(sorted, 0.25),
    p75: basePercentile(sorted, 0.75),
    sampleCount: count,
    spanDays: (last - first) / DAY_MS,
  };
}

/** `InsightAlgorithms.personalDeviation`: null unless count ≥ 7 and span ≥ 6 d;
 * z = clamp((v − median) / max((p75 − p25)/1.349, floor), ±3). */
export function personalDeviation(value: number | null | undefined, b: BaselineStats | null, minimumScale: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || b === null ||
    b.sampleCount < 7 || b.spanDays < 6 || !Number.isFinite(b.median) ||
    !Number.isFinite(b.p25) || !Number.isFinite(b.p75) || minimumScale <= 0) return null;
  const iqrScale = (b.p75 - b.p25) / 1.349;
  const scale = iqrScale < minimumScale ? minimumScale : iqrScale;
  return coerceIn((value - b.median) / scale, -3, 3);
}

/** `logistic(z) = 100 / (1 + exp(−1.2·clamp(z, ±3)))`. */
export function logistic(z: number): number {
  return 100 / (1 + Math.exp(-1.2 * coerceIn(z, -3, 3)));
}

// ---------------------------------------------------------------- zone helpers (java.time equivalents)

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

/** `Instant.ofEpochMilli(ms).atZone(zone)` fields. */
export function localParts(ms: number, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const x of dtf(tz).formatToParts(ms)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

function offsetMs(ms: number, tz: string): number {
  const l = localParts(ms, tz);
  const asUtc = Date.parse(`${l.date}T${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}:${String(l.second).padStart(2, '0')}Z`);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/** `localDate.atStartOfDay(zone)` in epoch ms (a midnight inside a DST gap moves to the first valid instant, as Java). */
export function startOfDayMs(localDate: string, tz: string): number {
  const naive = Date.parse(`${localDate}T00:00:00Z`);
  let t = naive - offsetMs(naive, tz);
  t = naive - offsetMs(t, tz);
  if (localParts(t, tz).date !== localDate) t = naive - offsetMs(t + DAY_MS / 24, tz);
  return t;
}

/** `TimeUtil.startOfDayLocal(ms)`. */
export function startOfDayLocal(ms: number, tz: string): number {
  return startOfDayMs(localParts(ms, tz).date, tz);
}

/** LocalDate ± n calendar days. */
export function plusDays(localDate: string, n: number): string {
  return new Date(Date.parse(`${localDate}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
