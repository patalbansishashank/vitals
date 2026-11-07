/**
 * The Ring screens' pure logic: metric names and units, the status words Gauge used for each reading (ported from
 * Gauge's `VitalsThresholdEngine` defaults), personal readings against S2's baselines, reading age and the stale rule,
 * the stress day strip, sleep and score bands, the short-video brain stage, GPS routes, durations, distances and
 * freshness. No React.
 */
import { EN_DASH, MINUS, formatNumber } from '@/components/lib/format';
import type { Severity } from '@/components/Notice';
import type { ScoreHistoryData } from '@/features/charts/living/types';
import type { UnitSystem } from '@/state/settingsStore';
import type { GaugeAvailability, GaugeBaselines, GaugeBucketPoint, GaugeShortVideoDay, GaugeSleepSession, GaugeWorkout } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Dates

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of an instant on this device's calendar. */
export function calendarDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `date` moved by `n` days (calendar arithmetic, no time zone). */
export function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 800; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/** "06:05" from a server instant (its own wall clock, which is the person's zone). */
export function clockOf(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : '';
}

/** "23:05" from minutes after local midnight (wraps). */
export function clockOfMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** The circular spread (SD) of clock times in minutes from the mean resultant length R̄ (null when R̄ is 0 or 1). */
export function circularSpreadMin(Rbar: number): number | null {
  if (!(Rbar > 0) || Rbar >= 1) return Rbar >= 1 ? 0 : null;
  return (Math.sqrt(-2 * Math.log(Rbar)) * 1440) / (2 * Math.PI);
}

/** Decimal hour of a server instant on its own wall clock (23.5 for 23:30). */
export function hourOf(iso: string): number {
  const m = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  return m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3] ?? 0) / 3600 : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers

/** "7 h 12" · "45 min" · "2 h" from minutes (Vitals' duration voice). */
export function minutesText(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${pad(m)}`;
}

export const KM_PER_MI = 1.609344;

/** Distance in the person's units: { value: "6.1", unit: "km" }. */
export function distanceParts(m: number, units: UnitSystem): { value: string; unit: string } {
  if (units === 'imperial') return { value: formatNumber(m / 1000 / KM_PER_MI, 1), unit: 'mi' };
  return m < 1000 ? { value: formatNumber(m, 0), unit: 'm' } : { value: formatNumber(m / 1000, m < 10_000 ? 2 : 1), unit: 'km' };
}

/** Pace per km (or mile): "5:42". */
export function paceText(durationS: number, distanceM: number, units: UnitSystem): { value: string; unit: string } | null {
  if (!distanceM || distanceM < 50) return null;
  const per = units === 'imperial' ? distanceM / 1000 / KM_PER_MI : distanceM / 1000;
  const s = Math.round(durationS / per);
  return { value: `${Math.floor(s / 60)}:${pad(s % 60)}`, unit: units === 'imperial' ? '/mi' : '/km' };
}

// ---------------------------------------------------------------------------------------------------------------
// Metrics

/**
 * The ring signals Vitals shows (SPEC A.1.3, A.2 #6). Breathing rate, glucose and blood pressure are absent: the ring
 * sends no respiration or glucose stream and only vendor blood-pressure estimates, so no row, page or monitor entry
 * offers them (A.1.6, "the row is absent").
 */
export type RingMetric = 'hr' | 'hrv' | 'spo2' | 'stress' | 'temp';

export interface MetricMeta {
  kind: RingMetric;
  /** Sentence case, as a row label. */
  label: string;
  /** Lower case, inside a sentence. */
  spoken: string;
  decimals: number;
  category: ScoreHistoryData['category'];
}

export const METRICS: Record<RingMetric, MetricMeta> = {
  hr: { kind: 'hr', label: 'Heart rate', spoken: 'heart rate', decimals: 0, category: 'cardio' },
  hrv: { kind: 'hrv', label: 'HRV', spoken: 'heart-rate variability', decimals: 0, category: 'recovery' },
  spo2: { kind: 'spo2', label: 'Blood oxygen', spoken: 'blood oxygen', decimals: 0, category: 'cardio' },
  stress: { kind: 'stress', label: 'Stress', spoken: 'stress', decimals: 0, category: 'recovery' },
  temp: { kind: 'temp', label: 'Skin temperature', spoken: 'skin temperature', decimals: 1, category: 'recovery' },
};

/** Gauge's Vitals tab order. */
export const METRIC_ORDER: RingMetric[] = ['hr', 'hrv', 'spo2', 'stress', 'temp'];

export const isRingMetric = (k: string | undefined): k is RingMetric => !!k && k in METRICS;

export interface UnitPrefs {
  units: UnitSystem;
}

/** The display unit of a metric. Stress is the ring's own unvalidated index (A.2 #8), never "/ 100". */
export function unitOf(kind: RingMetric, prefs: UnitPrefs): string {
  switch (kind) {
    case 'hr':
      return 'bpm';
    case 'hrv':
      return 'ms';
    case 'spo2':
      return '%';
    case 'stress':
      return 'ring index';
    case 'temp':
      return prefs.units === 'imperial' ? '°F' : '°C';
  }
}

/** Server value (bpm, ms, %, °C…) in the display unit. */
export function toDisplay(kind: RingMetric, v: number, prefs: UnitPrefs): number {
  if (kind === 'temp' && prefs.units === 'imperial') return v * 1.8 + 32;
  return v;
}

/** A temperature difference in the display unit (no offset). */
export const deltaToDisplay = (kind: RingMetric, d: number, prefs: UnitPrefs): number => (kind === 'temp' && prefs.units === 'imperial' ? d * 1.8 : d);

/** Decimals in the display unit. */
export function decimalsOf(kind: RingMetric): number {
  return METRICS[kind].decimals;
}

/** "62" / "34.2": a reading in the display unit, without the unit. */
export function valueText(kind: RingMetric, v: number, prefs: UnitPrefs): string {
  return formatNumber(toDisplay(kind, v, prefs), decimalsOf(kind));
}

/** A day's range "58–112" in the display unit. */
export function rangeText(kind: RingMetric, lo: number, hi: number, prefs: UnitPrefs): string {
  return `${valueText(kind, lo, prefs)}${EN_DASH}${valueText(kind, hi, prefs)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Status words (Gauge's VitalsThresholdEngine defaults; lower bound inclusive)

export interface Band {
  /** Inclusive lower bound in the server unit (−∞ for the first). */
  from: number;
  word: string;
  severity: Severity;
}

const B = (from: number, word: string, severity: Severity): Band => ({ from, word, severity });

/** The fixed bands. HRV and skin temperature are personal (read against S2's `/baselines`). */
export const BANDS: Partial<Record<RingMetric, Band[]>> = {
  hr: [B(-Infinity, 'Low', 'caution'), B(50, 'Normal', 'ok'), B(90, 'Elevated', 'caution'), B(120, 'High', 'danger')],
  spo2: [B(-Infinity, 'Very low', 'danger'), B(89, 'Low', 'caution'), B(93, 'Slightly low', 'caution'), B(95, 'Normal', 'ok')],
  // SPEC A.1.3 #26: Calm under 26, Normal 26–50, Elevated 51–75, High 76 and over
  stress: [B(-Infinity, 'Calm', 'ok'), B(26, 'Normal', 'ok'), B(51, 'Elevated', 'caution'), B(76, 'High', 'caution')],
};

export const bandIndex = (bands: readonly Band[], v: number): number => {
  for (let i = bands.length - 1; i >= 0; i--) if (v >= bands[i]!.from) return i;
  return 0;
};

const bandOf = (bands: Band[], v: number): Band => bands[bandIndex(bands, v)]!;

export interface Status {
  word: string;
  severity: Severity;
}

/** The personal baselines a reading is compared with (S2 `/baselines`, never all-day means: A.2 #5). */
export type PersonalBaselines = Pick<GaugeBaselines, 'hrvBaseline' | 'tempBaseline' | 'learning'> | null;

/** S2's own readiness gate of one personal baseline (n ≥ 7 over ≥ 6 days): an absent flag reads ready (older servers). */
export function baselineReady(kind: 'hrv' | 'temp', b: PersonalBaselines): boolean {
  if (!b || b.learning.learning) return false;
  const x = kind === 'hrv' ? b.hrvBaseline : b.tempBaseline;
  return !!x && x.ready !== false;
}

/**
 * "Calibrating · night 3 of 7" while S2's baseline forms (or before S2 serves one). With `kind`, a metric whose own
 * baseline is not ready yet counts its own nights (ten sleep nights can hold three valid temperature nights).
 */
export function calibratingText(b: PersonalBaselines, kind?: 'hrv' | 'temp'): string {
  const l = b?.learning;
  const needed = l?.needed ?? 7;
  if (kind && b && !l?.learning) {
    const x = kind === 'hrv' ? b.hrvBaseline : b.tempBaseline;
    // (Claude UI P3-6) sleep learning done but no usual value for this metric: never "night 7 of 7" for ever
    if (!x) return 'No usual value yet';
    return `Calibrating · night ${Math.min(x.n, needed)} of ${needed}`;
  }
  return `Calibrating · night ${Math.min(l?.nights ?? 0, needed)} of ${needed}`;
}

/** HRV as a z-score on the nightly ln-HRV baseline: for positioning only (the level bar), null until that baseline is ready. */
export function hrvZ(v: number, b: PersonalBaselines): number | null {
  const h = b?.hrvBaseline;
  if (!h || !baselineReady('hrv', b) || !(h.s > 0) || !(v > 0)) return null;
  return (Math.log(v) - h.median) / h.s;
}

/** The usual nightly HRV in ms (S2's `medianMs`, else e^median of ln-HRV). */
export function hrvUsualMs(b: PersonalBaselines): number | null {
  const h = b?.hrvBaseline;
  if (!h) return null;
  const ms = h.medianMs ?? Math.exp(h.median);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** SPEC A.1.2 (V2 `vsUsual.hrvCaution`): caution only when tonight is more than max(3 ms, 10 % of usual) below usual. */
export const HRV_CAUTION_MS = 3;
export const HRV_CAUTION_FRAC = 0.1;
export const hrvThresholdMs = (usualMs: number): number => Math.max(HRV_CAUTION_MS, HRV_CAUTION_FRAC * usualMs);

/** Skin temperature minus the usual nightly median (°C), null until that baseline is ready. */
export function tempDelta(v: number, b: PersonalBaselines): number | null {
  const t = b?.tempBaseline;
  if (!t || !baselineReady('temp', b)) return null;
  return v - t.median;
}

/** The skin-temperature caution threshold (SPEC A.1.2 #23: past 0.5 °C). */
export const TEMP_CAUTION_C = 0.5;

/** The status word of one reading. Personal metrics say "Calibrating" until their own S2 baseline is ready. */
export function statusOf(kind: RingMetric, v: number, base: PersonalBaselines = null): Status {
  if (kind === 'hrv') {
    const usual = hrvUsualMs(base);
    if (!baselineReady('hrv', base) || usual === null || !(v > 0)) return { word: calibratingText(base, 'hrv'), severity: 'info' };
    // the 10 % / 3 ms rule of A.1.2, never the z-score (that only places the level bar)
    const d = v - usual;
    const t = hrvThresholdMs(usual);
    if (d < -t) return { word: 'Below usual', severity: 'caution' };
    if (d > t) return { word: 'Above usual', severity: 'ok' };
    return { word: 'Near usual', severity: 'ok' };
  }
  if (kind === 'temp') {
    const d = tempDelta(v, base);
    if (d === null) return { word: calibratingText(base, 'temp'), severity: 'info' };
    if (d > TEMP_CAUTION_C) return { word: 'Above usual', severity: 'caution' };
    if (d < -TEMP_CAUTION_C) return { word: 'Below usual', severity: 'caution' };
    return { word: 'Near usual', severity: 'ok' };
  }
  const b = bandOf(BANDS[kind]!, v);
  return { word: b.word, severity: b.severity };
}

/**
 * The night's HRV or skin-temperature word straight from V2's `vsUsual` (the Sleep page's source), so Signals and Sleep
 * never disagree (Claude UI P2-10); null when V2 has no comparison (learning, or the metric's baseline not ready).
 */
export function usualStatus(kind: 'hrv' | 'temp', u: { hrvMs: number | null; hrvCaution: boolean; tempC: number | null; tempCaution: boolean } | null | undefined, usualHrvMs: number | null = null): Status | null {
  if (!u) return null;
  if (kind === 'hrv') {
    if (u.hrvMs === null) return null;
    if (u.hrvCaution) return { word: 'Below usual', severity: 'caution' };
    if (usualHrvMs !== null && u.hrvMs > hrvThresholdMs(usualHrvMs)) return { word: 'Above usual', severity: 'ok' };
    return { word: 'Near usual', severity: 'ok' };
  }
  if (u.tempC === null) return null;
  if (u.tempCaution) return { word: u.tempC > 0 ? 'Above usual' : 'Below usual', severity: 'caution' };
  return { word: 'Near usual', severity: 'ok' };
}

/** The reference rows of a fixed-band metric's page: word · range in the display unit. */
export function referenceRows(kind: RingMetric, prefs: UnitPrefs): Array<{ word: string; range: string; severity: Severity }> {
  const bands = BANDS[kind];
  if (!bands) return [];
  const u = unitOf(kind, prefs);
  const conv = (v: number) => valueText(kind, v, prefs);
  return bands.map((b, i) => {
    const next = bands[i + 1];
    const range = !Number.isFinite(b.from) ? `under ${conv(next!.from)} ${u}` : next ? `${conv(b.from)}${EN_DASH}${conv(next.from - (kind === 'stress' ? 1 : 0))} ${u}` : `${conv(b.from)} ${u} and over`;
    return { word: b.word, range, severity: b.severity };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Reading age (SPEC A.1.3 #1-5)

export interface ReadingAgeView {
  /** "3 min ago", "yesterday". */
  text: string;
  stale: boolean;
  ageMin: number;
}

const MIN_MS = 60_000;

/**
 * The age of the latest reading and the stale rule: stale when age > min(6 h, max(30 min, 3 × medianGapS)), or past
 * 6 h when the day has no median gap. Pure.
 */
export function readingAge(latestAt: string | null | undefined, medianGapS: number | null | undefined, now: number): ReadingAgeView | null {
  if (!latestAt) return null;
  const at = Date.parse(latestAt);
  if (!Number.isFinite(at)) return null;
  const ageMin = Math.max(0, (now - at) / MIN_MS);
  const limitMin = typeof medianGapS === 'number' && Number.isFinite(medianGapS) && medianGapS > 0 ? Math.min(360, Math.max(30, (3 * medianGapS) / 60)) : 360;
  return { text: ageText(at, now), stale: ageMin > limitMin, ageMin };
}

/** "just now" · "3 min ago" · "2 h ago" · "yesterday" · "3 days ago". */
export function ageText(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / MIN_MS));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const days = Math.round((Date.parse(`${calendarDate(now)}T12:00:00Z`) - Date.parse(`${calendarDate(at)}T12:00:00Z`)) / 86_400_000);
  if (days <= 0) return `${Math.round(min / 60)} h ago`;
  if (days === 1) return min < 12 * 60 ? `${Math.round(min / 60)} h ago` : 'yesterday';
  return `${days} days ago`;
}

// ---------------------------------------------------------------------------------------------------------------
// Stress day strip (SPEC A.1.3 #27)

export interface StressSegment {
  from: number;
  to: number;
  /** Index into `BANDS.stress`. */
  state: number;
}

/** Median gap of sorted instants (ms), 0 with fewer than two. */
export function medianGapMs(ts: readonly number[]): number {
  const gaps = ts
    .slice(1)
    .map((t, i) => t - ts[i]!)
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
}

/**
 * Each reading owns [t_i, min(t_{i+1}, t_i + 1.5·c)), c the day's median gap; its state is its band; equal neighbours
 * that touch merge. Uncovered time is left out (the strip draws it as "no reading", never bridged). Pure.
 */
export function stressSegments(points: ReadonlyArray<{ t: number; v: number }>, from: number, to: number): StressSegment[] {
  const pts = points.filter((p) => p.t >= from && p.t < to && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const c = medianGapMs(pts.map((p) => p.t)) || 30 * MIN_MS;
  const out: StressSegment[] = [];
  pts.forEach((p, i) => {
    const next = pts[i + 1]?.t ?? Infinity;
    const end = Math.min(next, p.t + 1.5 * c, to);
    const state = bandIndex(BANDS.stress!, p.v);
    const last = out.at(-1);
    if (last && last.state === state && last.to === p.t) last.to = end;
    else out.push({ from: p.t, to: end, state });
  });
  return out;
}

/** Minutes in Elevated and High (the strip's fact). */
export const elevatedMinutes = (segs: readonly StressSegment[]): number => segs.filter((s) => s.state >= 2).reduce((a, s) => a + (s.to - s.from) / MIN_MS, 0);

// ---------------------------------------------------------------------------------------------------------------
// Series → the existing ScoreHistory chart

/** Daily values of a bucketed series, indexed from `from` (NaN where there is no day). BP takes the systolic mean. */
export function dailyValues(points: readonly GaugeBucketPoint[], from: string, to: string, pick: (p: GaugeBucketPoint) => number | undefined = (p) => p.mean): number[] {
  const byDate = new Map(points.map((p) => [p.date ?? p.start.slice(0, 10), p]));
  return daysFrom(from, to).map((d) => {
    const p = byDate.get(d);
    const v = p ? pick(p) : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  });
}

/** Trailing mean over `n` days of the finite values (NaN while none). */
export function trailingMean(values: readonly number[], n = 7): number[] {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - n + 1), i + 1).filter((v) => Number.isFinite(v));
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : NaN;
  });
}

/** Mean and SD of the finite values (at least 7), for the history chart's band of the chart's own daily means. */
function meanSd(values: readonly number[]): { mean: number; sd: number } | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 7) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { mean, sd: Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) };
}

/** The personal normal range per day: mean ± 1 SD of the 28 days before it (at least 7 with data). */
export function normalBand(values: readonly number[], window = 28): { lo: number[]; hi: number[] } {
  const lo: number[] = [];
  const hi: number[] = [];
  values.forEach((_, i) => {
    const b = meanSd(values.slice(Math.max(0, i - window), i));
    lo.push(b ? b.mean - b.sd : NaN);
    hi.push(b ? b.mean + b.sd : NaN);
  });
  return { lo, hi };
}

/** ScoreHistory data from daily values (already in the display unit). */
export function historyData(opts: {
  startDate: string;
  values: number[];
  unit: string;
  decimals: number;
  category: ScoreHistoryData['category'];
  /** Leading days that only feed the normal range (dropped from the plot). */
  lead?: number;
  normal?: boolean;
  point?: ScoreHistoryData['point'];
}): ScoreHistoryData {
  const lead = opts.lead ?? 0;
  // (r068 A06) the 7-day mean starts once a full seven-day window exists: a partial first window made the line dive
  const mean = trailingMean(opts.values)
    .map((m, i) => (i < 6 ? NaN : m))
    .slice(lead);
  const band = opts.normal ? normalBand(opts.values) : null;
  const values = opts.values.slice(lead);
  return {
    startDate: shiftDate(opts.startDate, lead),
    days: values.length,
    unit: opts.unit,
    decimals: opts.decimals,
    nightly: values,
    mean7: mean,
    ...(band && band.lo.slice(lead).some((v) => Number.isFinite(v)) ? { normal: { lo: band.lo.slice(lead), hi: band.hi.slice(lead) } } : {}),
    category: opts.category,
    ...(opts.point ? { point: opts.point } : {}),
  };
}

export const PER_DAY = { one: 'day', many: 'days' } as const;

/**
 * (r068) Whole percentages of parts that add up to `total` (largest remainder over one denominator), so shown shares
 * never read 101 % or 103 %. `of` is the whole the parts are shares of (default their sum). Pure.
 */
export function wholePercents(parts: readonly number[], of?: number): number[] {
  const sum = parts.reduce((a, x) => a + Math.max(0, x), 0);
  const base = of !== undefined && of > 0 ? Math.max(of, sum) : sum;
  if (base <= 0) return parts.map(() => 0);
  const exact = parts.map((x) => (Math.max(0, x) / base) * 100);
  const total = Math.round((sum / base) * 100);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, x) => a + x, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k]!.i]! += 1;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Sleep

/** The night that ends on a waking day: the longest session of that day (naps are "additional sleep"). */
export function mainSession(sessions: readonly GaugeSleepSession[], date: string): GaugeSleepSession | null {
  const xs = sessions.filter((s) => s.wakingDate === date);
  return xs.reduce<GaugeSleepSession | null>((a, s) => (!a || s.asleepMinutes > a.asleepMinutes ? s : a), null);
}

/** The band word of a 0–100 wellness index (Gauge's sleep-index bands, used for every index). */
export function sleepBand(score: number): string {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Fair';
  return 'Needs work';
}

/** The stages in the hypnogram's row order (awake on top). */
export const STAGES = [
  { id: 'awake', label: 'Awake' },
  { id: 'rem', label: 'REM' },
  { id: 'light', label: 'Light' },
  { id: 'deep', label: 'Deep' },
] as const;

/**
 * Stage hues: the stage roles (`tokens.css`, the hypnogram's ordinal warm ramp by depth; `ring.css` `.rg-stage`). (r069
 * U1) "Asleep" without a stage sits between deep and light on that ramp; it borrowed a heart-rate zone's hue before.
 */
export const STAGE_HUE: Record<string, string> = {
  deep: 'var(--lm-stage-deep)',
  light: 'var(--lm-stage-light)',
  rem: 'var(--lm-stage-rem)',
  asleepUnspecified: 'var(--lm-stage-unspecified)',
  awake: 'var(--lm-stage-awake)',
  unknown: 'var(--lm-ink-3)',
};

// ---------------------------------------------------------------------------------------------------------------
// Scores (Gauge's legacy `insights/*`; Vitals' own indices are V2's, see `./indices`)

/** Every insight key Gauge emits (`LocalInsightEngine.kt`). A test fails if a listed key falls outside it (A.2 #1). */
export const GAUGE_EMITTED_KEYS = [
  'sleep_score',
  'recovery_score',
  'activity_score',
  'hrv_balance',
  'resting_load',
  'hrv_lnrmssd',
  'skin_temperature_deviation',
  'workout_score',
  'workout_load',
  'vo2max_estimate',
  'active_energy',
] as const;

export const SCORE_KEYS = [
  { key: 'recovery_score', label: 'Recovery', category: 'recovery' },
  { key: 'sleep_score', label: 'Sleep', category: 'recovery' },
  { key: 'activity_score', label: 'Activity', category: 'performance' },
  { key: 'workout_score', label: 'Workout', category: 'performance' },
] as const satisfies ReadonlyArray<{ key: (typeof GAUGE_EMITTED_KEYS)[number]; label: string; category: ScoreHistoryData['category'] }>;

/**
 * "Your indices": keys Gauge emits. `cardio_load` is gone (A.2 #1): it is a contributor id inside `workout_score`, never
 * an insight key, so its row could never show. The day-level load is V2's `trainingLoad`.
 */
export const INDEX_KEYS = [
  { key: 'hrv_balance', label: 'HRV balance', note: '50 is your usual' },
  { key: 'resting_load', label: 'Resting load', note: '50 is your usual' },
  { key: 'workout_load', label: 'Last workout load', note: null },
  { key: 'vo2max_estimate', label: 'VO₂ max', note: 'estimate' },
] as const satisfies ReadonlyArray<{ key: (typeof GAUGE_EMITTED_KEYS)[number]; label: string; note: string | null }>;

/** "82 / 100", "≈44.1 mL/kg/min", "312 AU". */
export function scoreValueParts(value: number, unit: string | null): { value: string; unit: string } {
  if (!unit || unit === 'score') return { value: formatNumber(value, 0), unit: '/ 100' };
  if (unit === 'mL/kg/min') return { value: `≈${formatNumber(value, 1)}`, unit };
  return { value: formatNumber(value, unit === 'AU' ? 0 : 1), unit };
}

// ---------------------------------------------------------------------------------------------------------------
// Activity

export const WORKOUT_TYPE: Record<string, string> = {
  run: 'Run',
  trail_run: 'Trail run',
  walk: 'Walk',
  hike: 'Hike',
  ride: 'Ride',
  cycle: 'Ride',
  swim: 'Swim',
  strength: 'Strength',
  yoga: 'Yoga',
  workout: 'Workout',
};

export function workoutName(type: string): string {
  return WORKOUT_TYPE[type] ?? (type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ') : 'Workout');
}

/**
 * Gauge's own zone seconds (220 − age, 5-min hold: `zonesVersion` `gauge-220-age-5min`). Never shown as Vitals zone time
 * (A.2 #9): only as one labelled legacy line under V2's zones.
 */
export function legacyZoneText(w: GaugeWorkout): string | null {
  if (!w.zones) return null;
  const order = ['rest', 'fat_burn', 'cardio', 'peak', 'max'];
  const total = order.reduce((a, k) => a + (w.zones![k] ?? 0), 0);
  if (!total) return null;
  const hard = (w.zones.peak ?? 0) + (w.zones.max ?? 0);
  return `On-device (legacy, 220 − age): ${minutesText(total / 60)} in zones, ${minutesText(hard / 60)} at 80 % and over`;
}

// ---------------------------------------------------------------------------------------------------------------
// GPS route

/** Decode a Google encoded polyline (precision 5) to [lat, lng] pairs. */
export function decodePolyline(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      if (i >= s.length) return null;
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    const a = next();
    const b = next();
    if (a === null || b === null) break;
    lat += a;
    lng += b;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** Project a route into a `w × h` box (north up, equal scale on both axes) as an SVG path. */
export function routePath(points: ReadonlyArray<readonly [number, number]>, w: number, h: number, padding = 12): { d: string; start: [number, number]; end: [number, number] } | null {
  if (points.length < 2) return null;
  const lat0 = (points.reduce((a, p) => a + p[0], 0) / points.length) * (Math.PI / 180);
  const xy = points.map(([la, ln]) => [ln * Math.cos(lat0), -la] as const);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((w - 2 * padding) / (x1 - x0 || 1e-9), (h - 2 * padding) / (y1 - y0 || 1e-9));
  const ox = (w - (x1 - x0) * k) / 2;
  const oy = (h - (y1 - y0) * k) / 2;
  const at = (p: readonly [number, number]): [number, number] => [ox + (p[0] - x0) * k, oy + (p[1] - y0) * k];
  const pts = xy.map(at);
  return {
    d: pts.map((p, n) => `${n ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(''),
    start: pts[0]!,
    end: pts.at(-1)!,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Short videos (Gauge's BrainStage)

export const DEFAULT_SHORT_VIDEO_LIMIT = 30;

export const BRAIN_STAGES = [
  { stage: 0, name: 'Healthy', caption: 'Pink, plump and pleased with you.' },
  { stage: 1, name: 'Greying', caption: 'A little dusty around the folds.' },
  { stage: 2, name: 'Wilted', caption: 'Drooping. Maybe look at a tree?' },
  { stage: 3, name: 'Cracked', caption: 'Green-tinged and starting to crack.' },
  { stage: 4, name: 'Rotting', caption: 'The flies have found it.' },
  { stage: 5, name: 'Fully rotten', caption: 'Past 150 % of your limit.' },
] as const;

export type BrainStage = (typeof BRAIN_STAGES)[number];

/** Gauge's stage rule: the share of the daily limit watched. */
export function brainStage(count: number, limit: number | null): BrainStage {
  const lim = limit && limit > 0 ? limit : DEFAULT_SHORT_VIDEO_LIMIT;
  if (count <= 0) return BRAIN_STAGES[0];
  const r = count / lim;
  const i = r > 1.5 ? 5 : r >= 1 ? 4 : r >= 0.75 ? 3 : r >= 0.5 ? 2 : r >= 0.25 ? 1 : 0;
  return BRAIN_STAGES[i];
}

export const APP_NAMES: Record<string, string> = { instagram: 'Instagram Reels', youtube: 'YouTube Shorts' };

export function appName(id: string): string {
  return APP_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** The apps in a run of days, Instagram first. */
export function appsOf(days: readonly GaugeShortVideoDay[]): string[] {
  const set = new Set(days.flatMap((d) => Object.keys(d.counts)));
  return [...set].sort((a, b) => (a === 'instagram' ? -1 : b === 'instagram' ? 1 : a.localeCompare(b)));
}

// ---------------------------------------------------------------------------------------------------------------
// Freshness

/** "Synced just now" · "Synced 4 min ago" · "Synced 3 h ago" · "Synced 2 days ago" · "Not synced yet". */
export function syncedText(lastUploadAt: string | null | undefined, now: number): string {
  if (!lastUploadAt) return 'Not synced yet';
  const ms = Date.parse(lastUploadAt);
  if (!Number.isFinite(ms)) return 'Not synced yet';
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return 'Synced just now';
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `Synced ${h} h ago`;
  const d = Math.round(h / 24);
  return `Synced ${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * (r069 sync) When Gauge last sent, on the device's clock: "Gauge sent 17:16" · "Gauge sent yesterday 23:10" ·
 * "Gauge sent 3 days ago" · "Gauge has not sent yet"; with readings still queued on the phone, " · 12 waiting on the
 * phone". `lastSentAt` is the newest of the server's, the pulse's and Gauge's own record (`localFill.lastSentOf`).
 */
export function sentText(lastSentAt: string | null | undefined, now: number, waiting = 0): string {
  const ms = lastSentAt ? Date.parse(lastSentAt) : Number.NaN;
  let s: string;
  if (!Number.isFinite(ms)) s = 'The phone has not sent yet';
  else {
    const d = new Date(ms);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const midnight = (t: number) => {
      const x = new Date(t);
      return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    };
    const days = Math.round((midnight(now) - midnight(ms)) / 86_400_000);
    s = days <= 0 ? `Phone sent ${hm}` : days === 1 ? `Phone sent yesterday ${hm}` : `Phone sent ${days} days ago`;
  }
  return waiting > 0 ? `${s} · ${formatNumber(waiting, 0)} waiting on the phone` : s;
}

/** Older than this, the data is flagged as stale (a ring normally syncs every few minutes). */
export const STALE_AFTER_MIN = 6 * 60;

export function isStale(lastUploadAt: string | null | undefined, now: number): boolean {
  if (!lastUploadAt) return true;
  return now - Date.parse(lastUploadAt) > STALE_AFTER_MIN * 60_000;
}

/** "−3 bpm" with a true minus. */
export function signed(v: number, decimals = 0): string {
  const s = formatNumber(Math.abs(v), decimals);
  if (Number(s.replace(/\s/g, '')) === 0) return s;
  return v < 0 ? `${MINUS}${s}` : `+${s}`;
}

/** The server answered but Gauge has never uploaded anything (the tools answer empty, not null). */
export function hasGaugeData(a: GaugeAvailability): boolean {
  return a.categories.length > 0 || a.shortVideoDays > 0 || (a.workoutSessions ?? 0) > 0;
}
