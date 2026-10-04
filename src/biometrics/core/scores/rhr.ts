/**
 * hr.rhr_night (R9 §2.5) plus the night helpers shared by the physiology scores (sleep, HRV, illness, autonomic,
 * night vitals). Tier P: pure, deterministic; the clock comes from `input.computedAt`.
 */
import type { BioStream, DeviceTier, ResolvedDay, ScoreDef, ScoreInput, ScoreResult, SleepRecord } from '../types';
import { addDays, daysBetween, makeResult, mean, median, withheld } from './util';

// ---------------------------------------------------------------- shared night helpers

export type NightSample = { t: number; value: number; tier: DeviceTier; sourceKey: string };
export type Scope = ScoreResult['scope'];

export const nightScope = (localDate: string): Scope => ({ kind: 'night', localDate });

export function dayOf(input: ScoreInput, localDate: string): ResolvedDay | undefined {
  for (let i = input.days.length - 1; i >= 0; i--) if (input.days[i]!.localDate === localDate) return input.days[i];
  return undefined;
}

/** Main sleep period in epoch ms plus the record's UTC offset (s). */
export interface SleepWindow {
  startMs: number;
  endMs: number;
  offsetS: number;
  record: SleepRecord;
}

export function sleepWindow(rec: SleepRecord | undefined): SleepWindow | null {
  if (!rec?.time.start || !rec.time.end) return null;
  const startMs = Date.parse(rec.time.start);
  const endMs = Date.parse(rec.time.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs, offsetS: rec.time.tz_offset_s, record: rec };
}

/** UTC offset (s) for a day: main sleep, then daily, then any record of that day; null when unknown. */
export function dayOffsetS(day: ResolvedDay | undefined): number | null {
  if (!day) return null;
  const r = day.mainSleep ?? day.daily ?? day.sleeps[0] ?? day.spots[0] ?? day.workouts[0];
  return r ? r.time.tz_offset_s : null;
}

/** Fallback when a day has no record: offset of the nearest day that has one, else 0 (UTC). */
export function offsetNear(input: ScoreInput, localDate: string): number {
  let best: number | null = null;
  let bestGap = Infinity;
  for (const d of input.days) {
    const o = dayOffsetS(d);
    if (o === null) continue;
    const gap = Math.abs(daysBetween(d.localDate, localDate));
    if (gap < bestGap) [best, bestGap] = [o, gap];
  }
  return best ?? 0;
}

/**
 * Samples of one stream in [startMs, endMs) from ONE source (baselines are within-source, R9 §3): the day's resolved
 * source for `metric` when it has samples, else the source with the most samples (ties: lowest sourceKey).
 */
export function windowSamples(
  input: ScoreInput,
  stream: BioStream,
  startMs: number,
  endMs: number,
  preferredSource?: string,
): { samples: NightSample[]; sourceKey: string; tier: DeviceTier } | null {
  const all = input.series[stream];
  if (!all?.length) return null;
  const by = new Map<string, NightSample[]>();
  for (const s of all) {
    if (s.t < startMs || s.t >= endMs || !Number.isFinite(s.value)) continue;
    let a = by.get(s.sourceKey);
    if (!a) by.set(s.sourceKey, (a = []));
    a.push(s);
  }
  if (!by.size) return null;
  let key = preferredSource && by.has(preferredSource) ? preferredSource : undefined;
  if (!key) {
    let n = -1;
    for (const [k, a] of [...by].sort((x, y) => (x[0] < y[0] ? -1 : 1))) if (a.length > n) [key, n] = [k, a.length];
  }
  const samples = by.get(key!)!.sort((a, b) => a.t - b.t);
  // Least-validated tier among the samples (conservative).
  const tier = samples.reduce<DeviceTier>((w, s) => (s.tier > w ? s.tier : w), 'A');
  return { samples, sourceKey: key!, tier };
}

/** Latest usable result per scope date for a dependency (status ok or borderline, numeric value). */
export function priorByDate(input: ScoreInput, scoreId: string): Map<string, ScoreResult> {
  const m = new Map<string, ScoreResult>();
  for (const r of input.prior[scoreId] ?? []) {
    if (r.status !== 'ok' && r.status !== 'borderline') continue;
    m.set(r.scope.localDate, r);
  }
  return m;
}

export function detailNum(r: ScoreResult | undefined, key: string): number | null {
  const v = r?.detail?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function detailStr(r: ScoreResult | undefined, key: string): string | null {
  const v = r?.detail?.[key];
  return typeof v === 'string' ? v : null;
}

/** Inclusive date range filter [from, to]. */
export function inRange(localDate: string, from: string, to: string): boolean {
  return localDate >= from && localDate <= to;
}

/** 'YYYY-MM-DD' of an instant at a fixed UTC offset. */
export function localDateAt(ms: number, offsetS: number): string {
  return new Date(ms + offsetS * 1000).toISOString().slice(0, 10);
}

export function tierConfidence(tier: DeviceTier): 'low' | 'medium' | 'high' {
  return tier === 'A' ? 'high' : tier === 'B' ? 'medium' : 'low';
}

export function minConfidence(...cs: Array<'low' | 'medium' | 'high'>): 'low' | 'medium' | 'high' {
  return cs.includes('low') ? 'low' : cs.includes('medium') ? 'medium' : 'high';
}

/** Tier of the day's resolved metric, else the main-sleep device tier, else C (unvalidated; conservative). */
export function dayTier(day: ResolvedDay | undefined, metric: string): DeviceTier {
  return day?.tierByMetric[metric] ?? day?.mainSleep?.provenance.device?.tier ?? 'C';
}

/** Multi-night baselines span this many days (R9 §2 notation: μ_60, σ_60). */
export const BASELINE_DAYS = 60;

// ---------------------------------------------------------------- hr.rhr_night

export const RHR_ID = 'hr.rhr_night';
export const RHR_VERSION = '1.0.0';
/** R9 §2.5: tier C rings sampling every 5–60 min need ≥12 samples in the sleep period. */
export const RHR_MIN_SAMPLES = 12;
/** R9 §3: tier C nightly RHR band widens to ±10 bpm below 24 samples. */
export const RHR_SPARSE_SAMPLES = 24;
/** R9 §3 95 % bands (bpm): A ±3 (Dial 2025 LoA −2.8…+1.1), B ±4, C ±5 (PROPOSED for B/C). */
export const RHR_BAND: Record<DeviceTier, number> = { A: 3, B: 4, C: 5 };
export const RHR_BAND_SPARSE_C = 10;
/** Plausible HR range (bpm), Android InsightSamplePolicy / stressScore 30..220 (engineering). */
export const HR_PLAUSIBLE: [number, number] = [30, 220];
/** Trend baseline needs this many prior nights (engineering; matches the NightSignal 7-night start, Alavi 2022). */
export const RHR_TREND_MIN_NIGHTS = 7;
/** NightSignal overnight window: local 00:00–06:59 of the wake date (Alavi 2022 code, nightsignal.py). */
export const NS_WINDOW_H = 7;

/** Lowest 5-minute mean (bins aligned to the period start), for display (R9 §2.5). */
export function lowest5MinMean(samples: readonly { t: number; value: number }[], startMs: number): number | null {
  const bins = new Map<number, { s: number; n: number }>();
  for (const x of samples) {
    const k = Math.floor((x.t - startMs) / 300_000);
    const b = bins.get(k) ?? { s: 0, n: 0 };
    b.s += x.value;
    b.n++;
    bins.set(k, b);
  }
  let lo: number | null = null;
  for (const b of bins.values()) lo = lo === null ? b.s / b.n : Math.min(lo, b.s / b.n);
  return lo;
}

/**
 * NightSignal's nightly value A (Alavi 2022, github.com/StanfordBioinformatics/wearable-infection nightsignal.py,
 * Apache-2.0): mean of HR samples between local 00:00 and 07:00 whose minute had zero steps; each sample truncated to
 * an integer, then the mean truncated (`int(AVGHR/numOfHRs)`). Steps samples > 0 exclude HR in the same minute.
 */
export function nightSignalAverage(
  hr: readonly { t: number; value: number }[],
  steps: readonly { t: number; value: number }[],
  midnightMs: number,
): number | null {
  const end = midnightMs + NS_WINDOW_H * 3_600_000;
  const moving = new Set<number>();
  for (const s of steps) if (s.value > 0 && s.t >= midnightMs - 60_000 && s.t < end) moving.add(Math.floor(s.t / 60_000));
  let sum = 0;
  let n = 0;
  for (const x of hr) {
    if (x.t < midnightMs || x.t >= end || moving.has(Math.floor(x.t / 60_000))) continue;
    sum += Math.trunc(x.value);
    n++;
  }
  return n ? Math.trunc(sum / n) : null;
}

function computeRhr(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const scope = nightScope(d);
  const day = dayOf(input, d);
  const w = sleepWindow(day?.mainSleep);
  if (!w) return withheld(RHR_ID, RHR_VERSION, input, 'no main sleep session for this night', scope);
  const got = windowSamples(input, 'hr', w.startMs, w.endMs, day?.sourceByMetric.hr);
  const samples = got?.samples.filter((s) => s.value >= HR_PLAUSIBLE[0] && s.value <= HR_PLAUSIBLE[1]) ?? [];
  if (!got || samples.length < RHR_MIN_SAMPLES)
    return withheld(RHR_ID, RHR_VERSION, input, `needs ≥${RHR_MIN_SAMPLES} HR samples in the main sleep (have ${samples.length})`, scope);
  const value = mean(samples.map((s) => s.value));
  const tier = got.tier;
  const half = tier === 'C' && samples.length < RHR_SPARSE_SAMPLES ? RHR_BAND_SPARSE_C : RHR_BAND[tier];

  // NightSignal overnight average from the same source.
  const midnight = Date.parse(`${d}T00:00:00Z`) - w.offsetS * 1000;
  const nsHr = windowSamples(input, 'hr', midnight, midnight + NS_WINDOW_H * 3_600_000, got.sourceKey);
  const nsSteps = (input.series.steps ?? []).filter((s) => s.sourceKey === got.sourceKey);
  const nsAvg = nsHr && nsHr.sourceKey === got.sourceKey
    ? nightSignalAverage(nsHr.samples.filter((s) => s.value >= HR_PLAUSIBLE[0] && s.value <= HR_PLAUSIBLE[1]), nsSteps, midnight)
    : null;

  // Streaming-median trend over prior nights of the same source in the 60-day window (R9 §2.5).
  const prior = priorByDate(input, RHR_ID);
  const from = addDays(d, -BASELINE_DAYS);
  const base: number[] = [];
  const deltas: number[] = [];
  for (const [date, r] of prior) {
    if (date >= d || detailStr(r, 'sourceKey') !== got.sourceKey) continue;
    if (date >= from && r.value !== null) base.push(r.value);
    const dl = detailNum(r, 'delta_bpm');
    if (dl !== null && date > addDays(d, -7)) deltas.push(dl);
  }
  const delta = base.length >= RHR_TREND_MIN_NIGHTS ? value - median(base) : null;
  if (delta !== null) deltas.push(delta);

  return makeResult(RHR_ID, RHR_VERSION, input, {
    scope,
    status: 'ok',
    value,
    band: { lo: value - half, hi: value + half, level: 0.95 },
    confidence: tierConfidence(tier),
    sourceIds: [got.sourceKey, w.record.record_id],
    hashOf: { s: got.sourceKey, n: samples.length, v: samples.map((x) => [x.t, x.value]), ns: nsAvg, b: base },
    detail: {
      sourceKey: got.sourceKey,
      tier,
      n: samples.length,
      lowest5min_bpm: lowest5MinMean(samples, w.startMs),
      ns_avg_bpm: nsAvg,
      baseline_median_bpm: base.length >= RHR_TREND_MIN_NIGHTS ? median(base) : null,
      baseline_nights: base.length,
      delta_bpm: delta,
      delta7_bpm: delta !== null && deltas.length ? mean(deltas) : null,
    },
  });
}

export const rhrDefs: ScoreDef[] = [
  {
    scoreId: RHR_ID,
    title: 'Overnight resting heart rate',
    version: RHR_VERSION,
    released: '2026-10-01',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [
      { stream: 'hr', window: 'main_sleep', minCount: RHR_MIN_SAMPLES, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'hr', window: 'night', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'steps', window: 'night', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'sleep_sessions', window: 'main_sleep', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    ],
    profileInputs: [],
    gates: ['main_sleep_present', `hr_samples_in_main_sleep>=${RHR_MIN_SAMPLES}`],
    formula: {
      fn: `${RHR_ID}@${RHR_VERSION}`,
      text: 'RHR = mean HR over the main sleep (one source). Trend ΔRHR = RHR − median(prior nights, 60 d, ≥7). Detail: lowest 5-min mean; NightSignal average (00:00–07:00, zero-step minutes, integer-truncated).',
    },
    params: [
      { name: 'min_samples', value: RHR_MIN_SAMPLES, unit: 'samples', sourceRef: 'R9 §2.5', kind: 'engineering' },
      { name: 'baseline_days', value: BASELINE_DAYS, unit: 'd', sourceRef: 'R9 §2 notation / §2.5', kind: 'engineering' },
      { name: 'trend_min_nights', value: RHR_TREND_MIN_NIGHTS, unit: 'nights', sourceRef: 'Alavi 2022 Nat Med doi 10.1038/s41591-021-01593-2 (7-night baseline)', kind: 'engineering' },
      { name: 'band_tier_a', value: RHR_BAND.A, unit: 'bpm', sourceRef: 'R9 §3; Dial 2025 PMC12367097', kind: 'published' },
      { name: 'band_tier_b', value: RHR_BAND.B, unit: 'bpm', sourceRef: 'R9 §3 (interpolated)', kind: 'proposed' },
      { name: 'band_tier_c', value: RHR_BAND.C, unit: 'bpm', sourceRef: 'R9 §3 (tier C assumption)', kind: 'proposed' },
      { name: 'band_tier_c_sparse', value: RHR_BAND_SPARSE_C, unit: 'bpm', sourceRef: 'R9 §3 (<24 samples)', kind: 'proposed' },
    ],
    output: { unit: 'bpm', range: [30, 220], goodDirection: 'down', display: 'number' },
    uncertainty: { method: 'fixed_band', notes: '95 % device band by tier (R9 §3); bias cancels within source so trends are preferred.' },
    evidence: {
      mechanism: { status: 'modelled', pathway: 'Autonomic balance and stroke volume; fitness lowers RHR (dossier 19 RHR_fit); infection, alcohol, heat raise it', engineNodes: ['RHR_fit'] },
      certainty: 'B',
      refs: [{ topicSlug: 'performance-wellbeing-bone', refIds: ['Alavi22', 'Plews13', 'Dial25'] }],
    },
    tierHandling: 'All tiers: absolute value with band A ±3, B ±4, C ±5 bpm (±10 when a tier C night has <24 samples); trends are within source only.',
    planEffects: [{ target: 'engine_observation', rule: 'Nightly RHR is an observation that re-anchors dossier 19 RHR_fit.', priority: 4 }],
    optInStreams: ['hr', 'sleep_sessions'],
    compute: computeRhr,
  },
];
