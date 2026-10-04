/**
 * Night vitals (R9 §2.11): spo2.night and temp.deviation. Tier P.
 * SpO2: shown, trended and flagged with a clinician prompt; never a diagnosis and no engine effect.
 * Temperature: deviation from the 60-day median of nightly means; illness corroborator and cycle-phase input.
 */
import type { DeviceTier, ScoreDef, ScoreInput, ScoreResult } from '../types';
import { addDays, makeResult, mean, median, withheld } from './util';
import { BASELINE_DAYS, dayOf, detailNum, detailStr, nightScope, priorByDate, sleepWindow, tierConfidence, windowSamples } from './rhr';

export const SPO2_ID = 'spo2.night';
export const TEMP_ID = 'temp.deviation';
export const NIGHT_VITALS_VERSION = '1.0.0';

// ---------------------------------------------------------------- spo2.night

/** R9 §4.3: ≥30 min of samples (span first→last, ≥3 samples: engineering reading). */
export const SPO2_MIN_SPAN_MIN = 30;
export const SPO2_MIN_SAMPLES = 3;
/** Plausible SpO2 (%), engineering. */
export const SPO2_PLAUSIBLE: [number, number] = [50, 100];
/** R9 §2.11 flag (PROPOSED): nightly minimum < 88 % on ≥3 of 7 nights, or mean ≥2 points below the 60-day median. */
export const SPO2_LOW_MIN = 88;
export const SPO2_LOW_NIGHTS = 3;
export const SPO2_MEAN_DROP = 2;
export const SPO2_MIN_BASELINE = 14;
/** R9 §3 95 % bands (points): A ±3, B ±3, C ±5 (C positively biased in darker skin; Sjoding 2020). */
export const SPO2_BAND: Record<DeviceTier, number> = { A: 3, B: 3, C: 5 };
export const CLINICIAN_PROMPT = 'Low overnight oxygen readings — worth discussing with a clinician. This is not a diagnosis.';

function computeSpo2(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const scope = nightScope(d);
  const day = dayOf(input, d);
  const w = sleepWindow(day?.mainSleep);
  if (!w) return withheld(SPO2_ID, NIGHT_VITALS_VERSION, input, 'no main sleep session for this night', scope);
  const got = windowSamples(input, 'spo2', w.startMs, w.endMs, day?.sourceByMetric.spo2);
  const xs = got?.samples.filter((s) => s.value >= SPO2_PLAUSIBLE[0] && s.value <= SPO2_PLAUSIBLE[1]) ?? [];
  const spanMin = xs.length ? (xs[xs.length - 1]!.t - xs[0]!.t) / 60_000 : 0;
  if (!got || xs.length < SPO2_MIN_SAMPLES || spanMin < SPO2_MIN_SPAN_MIN)
    return withheld(SPO2_ID, NIGHT_VITALS_VERSION, input, `needs ≥${SPO2_MIN_SPAN_MIN} min of SpO2 samples in the main sleep (have ${spanMin.toFixed(0)} min, ${xs.length} samples)`, scope);
  const avg = mean(xs.map((s) => s.value));
  const min = Math.min(...xs.map((s) => s.value));
  const prior = priorByDate(input, SPO2_ID);
  let lowNights = min < SPO2_LOW_MIN ? 1 : 0;
  const base: number[] = [];
  for (const [date, r] of prior) {
    if (date >= d || detailStr(r, 'sourceKey') !== got.sourceKey) continue;
    if (date > addDays(d, -7) && (detailNum(r, 'min_pct') ?? 100) < SPO2_LOW_MIN) lowNights++;
    if (date >= addDays(d, -BASELINE_DAYS) && r.value !== null) base.push(r.value);
  }
  const baseMed = base.length >= SPO2_MIN_BASELINE ? median(base) : null;
  const meanDrop = baseMed !== null && avg <= baseMed - SPO2_MEAN_DROP;
  const flag = lowNights >= SPO2_LOW_NIGHTS || meanDrop;
  const half = SPO2_BAND[got.tier];
  return makeResult(SPO2_ID, NIGHT_VITALS_VERSION, input, {
    scope,
    status: 'ok',
    value: avg,
    state: flag ? 'flag' : 'normal',
    band: { lo: avg - half, hi: Math.min(100, avg + half), level: 0.95 },
    confidence: tierConfidence(got.tier),
    sourceIds: [got.sourceKey, w.record.record_id],
    hashOf: xs.map((s) => [s.t, s.value]),
    detail: {
      sourceKey: got.sourceKey,
      tier: got.tier,
      min_pct: min,
      n: xs.length,
      span_min: spanMin,
      low_nights_7d: lowNights,
      baseline_median_pct: baseMed,
      mean_drop: meanDrop,
      prompt: flag ? CLINICIAN_PROMPT : null,
      within_person_only: got.tier === 'C',
    },
  });
}

// ---------------------------------------------------------------- temp.deviation

/** R9 §4.3: ≥14 nights baseline; 60-day median of nightly means (R9 §2.11). */
export const TEMP_MIN_BASELINE = 14;
/** Plausible skin temperature (°C), Android InsightSamplePolicy 20..45 (engineering). */
export const TEMP_PLAUSIBLE: [number, number] = [20, 45];
/** R9 §2.8: +0.4 °C elevated (PROPOSED). R9 §3 noise floors: A 0.3, B 0.4, C 0.5 °C. */
export const TEMP_ELEVATED_C = 0.4;
export const TEMP_NOISE: Record<DeviceTier, number> = { A: 0.3, B: 0.4, C: 0.5 };
const TEMP_MIN_SAMPLES = 3;

function nightTemp(input: ScoreInput, date: string): { c: number; sourceKey: string; tier: DeviceTier; ids: string[]; window: string } | null {
  const day = dayOf(input, date);
  const w = sleepWindow(day?.mainSleep);
  if (!w) return null;
  const got = windowSamples(input, 'skin_temp', w.startMs, w.endMs, day?.sourceByMetric.skin_temp);
  const xs = got?.samples.map((s) => s.value).filter((v) => v >= TEMP_PLAUSIBLE[0] && v <= TEMP_PLAUSIBLE[1]) ?? [];
  if (got && xs.length >= TEMP_MIN_SAMPLES) return { c: mean(xs), sourceKey: got.sourceKey, tier: got.tier, ids: [got.sourceKey, w.record.record_id], window: 'series_mean' };
  const c = day?.daily?.skin_temp_c;
  if (typeof c === 'number' && c >= TEMP_PLAUSIBLE[0] && c <= TEMP_PLAUSIBLE[1] && day?.daily)
    return { c, sourceKey: day.sourceByMetric.skin_temp ?? day.daily.provenance.channel, tier: day.tierByMetric.skin_temp ?? day.daily.provenance.device?.tier ?? 'C', ids: [day.daily.record_id], window: 'daily_absolute' };
  return null;
}

function computeTemp(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const scope = nightScope(d);
  const t = nightTemp(input, d);
  if (!t) return withheld(TEMP_ID, NIGHT_VITALS_VERSION, input, 'no skin temperature for this night', scope);
  const base: number[] = [];
  // Nights from insufficient_baseline results count too: their night mean is real.
  for (const r of input.prior[TEMP_ID] ?? []) {
    const date = r.scope.localDate;
    const c = detailNum(r, 'night_mean_c');
    if (date < d && date >= addDays(d, -BASELINE_DAYS) && c !== null && detailStr(r, 'sourceKey') === t.sourceKey && detailStr(r, 'window') === t.window) base.push(c);
  }
  // Also accept history computed in place when prior results are absent (e.g. first run over a backfill).
  if (!base.length)
    for (let k = 1; k <= BASELINE_DAYS; k++) {
      const p = nightTemp(input, addDays(d, -k));
      if (p && p.sourceKey === t.sourceKey && p.window === t.window) base.push(p.c);
    }
  if (base.length < TEMP_MIN_BASELINE)
    return makeResult(TEMP_ID, NIGHT_VITALS_VERSION, input, {
      scope,
      status: 'insufficient_baseline',
      value: null,
      reason: `needs ≥${TEMP_MIN_BASELINE} baseline nights from the same source (have ${base.length})`,
      hashOf: [t.c, base],
      detail: { night_mean_c: t.c, sourceKey: t.sourceKey, window: t.window },
    });
  const med = median(base);
  const dev = t.c - med;
  const noise = TEMP_NOISE[t.tier];
  const state = Math.abs(dev) < noise ? 'within' : dev >= TEMP_ELEVATED_C ? 'elevated' : dev <= -TEMP_ELEVATED_C ? 'lowered' : 'within';
  return makeResult(TEMP_ID, NIGHT_VITALS_VERSION, input, {
    scope,
    status: 'ok',
    value: dev,
    state,
    band: { lo: dev - noise, hi: dev + noise, level: 0.95 },
    confidence: tierConfidence(t.tier),
    sourceIds: t.ids,
    hashOf: [t.c, base],
    detail: { night_mean_c: t.c, baseline_median_c: med, baseline_nights: base.length, noise_floor_c: noise, sourceKey: t.sourceKey, tier: t.tier, window: t.window },
  });
}

// ---------------------------------------------------------------- catalogue

export const nightVitalsDefs: ScoreDef[] = [
  {
    scoreId: SPO2_ID,
    title: 'Overnight SpO2',
    version: NIGHT_VITALS_VERSION,
    released: '2026-10-01',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [
      { stream: 'spo2', window: 'main_sleep', minCount: SPO2_MIN_SAMPLES, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'sleep_sessions', window: 'main_sleep', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    ],
    profileInputs: [],
    gates: ['main_sleep_present', `spo2_span_min>=${SPO2_MIN_SPAN_MIN}`],
    formula: {
      fn: `${SPO2_ID}@${NIGHT_VITALS_VERSION}`,
      text: 'Nightly mean and minimum SpO2 in the main sleep. Flag (PROPOSED): minimum < 88 % on ≥3 of 7 nights, or mean ≥2 points below the 60-day median.',
    },
    params: [
      { name: 'min_span', value: SPO2_MIN_SPAN_MIN, unit: 'min', sourceRef: 'R9 §4.3', kind: 'engineering' },
      { name: 'low_min', value: SPO2_LOW_MIN, unit: '%', sourceRef: 'R9 §2.11', kind: 'proposed' },
      { name: 'low_nights', value: SPO2_LOW_NIGHTS, unit: 'nights', sourceRef: 'R9 §2.11', kind: 'proposed' },
      { name: 'mean_drop', value: SPO2_MEAN_DROP, unit: '%', sourceRef: 'R9 §2.11', kind: 'proposed' },
      { name: 'band_tier_a', value: SPO2_BAND.A, unit: '%', sourceRef: 'R9 §3', kind: 'proposed' },
      { name: 'band_tier_c', value: SPO2_BAND.C, unit: '%', sourceRef: 'R9 §3', kind: 'proposed' },
    ],
    output: { unit: '%', range: [50, 100], goodDirection: 'up', display: 'number' },
    uncertainty: { method: 'fixed_band', notes: 'Device band by tier (R9 §3); red/IR SpO2 overestimates in darker skin (Sjoding 2020).' },
    evidence: {
      mechanism: { status: 'infoOnly', pathway: 'Nocturnal desaturation; no engine mechanism (PLAN 16)', engineNodes: [] },
      certainty: 'C',
      refs: [{ topicSlug: 'sleep-sex-age', refIds: ['Sjoding20'] }],
    },
    tierHandling: 'Tier C SpO2 is a within-person trend and flag only (±5 points, positive bias in darker skin); tier A/B ±3.',
    planEffects: [
      { target: 'display_only', rule: 'Shown and trended.', priority: 5 },
      { target: 'trainer_briefing', rule: 'Flag → clinician prompt; never a diagnosis; no model effect.', priority: 5 },
    ],
    optInStreams: ['spo2', 'sleep_sessions'],
    compute: computeSpo2,
  },
  {
    scoreId: TEMP_ID,
    title: 'Skin temperature deviation',
    version: NIGHT_VITALS_VERSION,
    released: '2026-10-01',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [
      { stream: 'skin_temp', window: 'main_sleep', minCount: TEMP_MIN_SAMPLES, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'skin_temp', window: '60d', minCount: TEMP_MIN_BASELINE, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
    ],
    profileInputs: [],
    gates: ['night_temp_present', `baseline_nights>=${TEMP_MIN_BASELINE}`],
    formula: {
      fn: `${TEMP_ID}@${NIGHT_VITALS_VERSION}`,
      text: 'Δ = nightly mean skin temperature − median of prior nightly means (60 d, same source). Elevated ≥ +0.4 °C and beyond the tier noise floor.',
    },
    params: [
      { name: 'min_baseline', value: TEMP_MIN_BASELINE, unit: 'nights', sourceRef: 'R9 §4.3', kind: 'engineering' },
      { name: 'baseline_days', value: BASELINE_DAYS, unit: 'd', sourceRef: 'R9 §2.11', kind: 'engineering' },
      { name: 'elevated', value: TEMP_ELEVATED_C, unit: '°C', sourceRef: 'R9 §2.8', kind: 'proposed' },
      { name: 'noise_tier_a', value: TEMP_NOISE.A, unit: '°C', sourceRef: 'R9 §3 (Oura vendor blog)', kind: 'proposed' },
      { name: 'noise_tier_b', value: TEMP_NOISE.B, unit: '°C', sourceRef: 'R9 §3', kind: 'proposed' },
      { name: 'noise_tier_c', value: TEMP_NOISE.C, unit: '°C', sourceRef: 'R9 §3', kind: 'proposed' },
    ],
    output: { unit: '°C', range: [-5, 5], display: 'number' },
    uncertainty: { method: 'fixed_band', notes: 'Tier noise floor (R9 §3); relative only.' },
    evidence: {
      mechanism: { status: 'mapped', pathway: 'Fever and luteal-phase thermogenesis raise distal temperature (Maijala 2019)', engineNodes: [] },
      certainty: 'B',
      refs: [{ topicSlug: 'sleep-sex-age', refIds: ['Maijala19'] }],
    },
    tierHandling: 'Relative only; deviations below the tier noise floor (A 0.3, B 0.4, C 0.5 °C) are treated as noise.',
    planEffects: [
      { target: 'trainer_briefing', rule: 'Illness corroborator (PROPOSED) and cycle-phase module input.', priority: 4 },
      { target: 'display_only', rule: 'Shown.', priority: 5 },
    ],
    optInStreams: ['skin_temp', 'sleep_sessions'],
    compute: computeTemp,
  },
];
