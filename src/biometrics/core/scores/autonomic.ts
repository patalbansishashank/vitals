/**
 * autonomic.deviation (R9 §2.9): resting autonomic deviation from nightly HRV and RHR. Tier P.
 * Port of the owner's Android `InsightAlgorithms.stressScore` / `personalDeviation` (LocalInsightEngine.kt:132–155):
 * ARD = −0.6·z_HRV + 0.4·z_RHR, shown as 100/(1 + e^(−1.2·ARD)) with z and ARD clipped to ±3.
 * Baselines are the prior nights of the same source in the 60-day window (Android used 30 days).
 * Label: "autonomic load". Never called stress; vendor stress stays vendor opinion.
 */
import type { ScoreDef, ScoreInput, ScoreResult } from '../types';
import { addDays, clamp, makeResult, withheld } from './util';
import { BASELINE_DAYS, detailNum, detailStr, minConfidence, priorByDate, RHR_ID, rhrDefs } from './rhr';
import { LN_ID, hrvDefs } from './hrv';

export const ARD_ID = 'autonomic.deviation';
export const ARD_VERSION = '1.0.0';
/** Android stressScore weights (R9 §2.9). */
export const W_HRV = 0.6;
export const W_RHR = 0.4;
/** Logistic slope and z clip (Android `logistic`). */
export const LOGISTIC_K = 1.2;
export const Z_CLIP = 3;
/** Scale floors (R9 §2 notation; Android): HRV 10 % of median or 3 ms; RHR 3 bpm. */
export const HRV_FLOOR_FRAC = 0.1;
export const HRV_FLOOR_MS = 3;
export const RHR_FLOOR_BPM = 3;
/** personalDeviation needs ≥7 nights spanning ≥6 days. */
export const MIN_BASE_NIGHTS = 7;
export const MIN_BASE_SPAN_D = 6;

export function logistic100(z: number): number {
  return 100 / (1 + Math.exp(-LOGISTIC_K * clamp(z, -Z_CLIP, Z_CLIP)));
}

/** Linear-interpolated quantile of a sorted array (Android `quantile`). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface Baseline {
  median: number;
  p25: number;
  p75: number;
  n: number;
  spanDays: number;
}

export function baselineStats(nights: ReadonlyArray<{ date: string; value: number }>): Baseline | null {
  if (!nights.length) return null;
  const xs = nights.map((x) => x.value).sort((a, b) => a - b);
  const dates = nights.map((x) => x.date).sort();
  const spanDays = Math.round((Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000);
  return { median: quantileSorted(xs, 0.5), p25: quantileSorted(xs, 0.25), p75: quantileSorted(xs, 0.75), n: xs.length, spanDays };
}

/** Android personalDeviation: (x − median)/max(IQR/1.349, floor), clipped ±3; null without ≥7 nights over ≥6 days. */
export function personalDeviation(x: number, b: Baseline | null, minScale: number): number | null {
  if (!b || b.n < MIN_BASE_NIGHTS || b.spanDays < MIN_BASE_SPAN_D || !Number.isFinite(x) || minScale <= 0) return null;
  const scale = Math.max((b.p75 - b.p25) / 1.349, minScale);
  return clamp((x - b.median) / scale, -Z_CLIP, Z_CLIP);
}

function tonight(input: ScoreInput, id: string, compute: (i: ScoreInput) => ScoreResult): ScoreResult | null {
  const r = priorByDate(input, id).get(input.localDate) ?? compute(input);
  return r.status === 'ok' || r.status === 'borderline' ? r : null;
}

function history(input: ScoreInput, id: string, src: string | null, value: (r: ScoreResult) => number | null, window?: string | null) {
  const d = input.localDate;
  const from = addDays(d, -BASELINE_DAYS);
  const out: Array<{ date: string; value: number }> = [];
  for (const [date, r] of priorByDate(input, id)) {
    if (date >= d || date < from || detailStr(r, 'sourceKey') !== src) continue;
    if (window !== undefined && detailStr(r, 'window') !== window) continue;
    const v = value(r);
    if (v !== null) out.push({ date, value: v });
  }
  return out;
}

function computeArd(input: ScoreInput): ScoreResult {
  const hrv = tonight(input, LN_ID, hrvDefs[0]!.compute);
  const rhr = tonight(input, RHR_ID, rhrDefs[0]!.compute);
  if (!hrv || !rhr) return withheld(ARD_ID, ARD_VERSION, input, `needs both nightly HRV and RHR (${hrv ? '' : 'HRV missing'}${!hrv && !rhr ? ', ' : ''}${rhr ? '' : 'RHR missing'})`);
  const hrvMs = detailNum(hrv, 'rmssd_ms') ?? Math.exp(hrv.value!);
  const rhrBpm = rhr.value!;
  const hb = baselineStats(history(input, LN_ID, detailStr(hrv, 'sourceKey'), (r) => detailNum(r, 'rmssd_ms') ?? (r.value === null ? null : Math.exp(r.value)), detailStr(hrv, 'window')));
  const rb = baselineStats(history(input, RHR_ID, detailStr(rhr, 'sourceKey'), (r) => r.value));
  const zH = personalDeviation(hrvMs, hb, Math.max((hb?.median ?? 50) * HRV_FLOOR_FRAC, HRV_FLOOR_MS));
  const zR = personalDeviation(rhrBpm, rb, RHR_FLOOR_BPM);
  if (zH === null || zR === null)
    return makeResult(ARD_ID, ARD_VERSION, input, {
      status: 'insufficient_baseline',
      value: null,
      reason: `needs ≥${MIN_BASE_NIGHTS} prior nights over ≥${MIN_BASE_SPAN_D} days for HRV and RHR (have ${hb?.n ?? 0} and ${rb?.n ?? 0})`,
      hashOf: [hb, rb],
    });
  const ard = W_HRV * -zH + W_RHR * zR;
  return makeResult(ARD_ID, ARD_VERSION, input, {
    status: 'ok',
    value: logistic100(ard),
    confidence: minConfidence('low', hrv.confidence, rhr.confidence),
    sourceIds: [...new Set([...hrv.sourceIds, ...rhr.sourceIds])].sort(),
    hashOf: [hrvMs, rhrBpm, hb, rb],
    contributors: [
      { id: 'hrv', raw: hrvMs, unit: 'ms', component: logistic100(-zH), weightConfigured: W_HRV, weightApplied: W_HRV, available: true },
      { id: 'resting_hr', raw: rhrBpm, unit: 'bpm', component: logistic100(-zR), weightConfigured: W_RHR, weightApplied: W_RHR, available: true },
    ],
    detail: { ard, z_hrv: zH, z_rhr: zR, hrv_baseline_ms: hb!.median, rhr_baseline_bpm: rb!.median, label: 'autonomic load (not psychological stress)' },
  });
}

export const autonomicDefs: ScoreDef[] = [
  {
    scoreId: ARD_ID,
    title: 'Resting autonomic load',
    version: ARD_VERSION,
    released: '2026-10-01',
    kind: 'index',
    label: 'convenience_index',
    inputs: [
      { stream: LN_ID, window: '60d', minCount: MIN_BASE_NIGHTS, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: RHR_ID, window: '60d', minCount: MIN_BASE_NIGHTS, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
    ],
    profileInputs: [],
    gates: ['hrv_tonight', 'rhr_tonight', `baseline_nights>=${MIN_BASE_NIGHTS}`, `baseline_span_days>=${MIN_BASE_SPAN_D}`],
    formula: {
      fn: `${ARD_ID}@${ARD_VERSION}`,
      text: 'z = (x − median)/max(IQR/1.349, floor) clipped ±3 (floors: HRV max(10 % median, 3 ms), RHR 3 bpm); ARD = −0.6·z_HRV + 0.4·z_RHR; shown as 100/(1+e^(−1.2·ARD)); 50 = usual. Sleep windows only.',
    },
    params: [
      { name: 'w_hrv', value: W_HRV, unit: '1', sourceRef: 'R9 §2.9; Android LocalInsightEngine.stressScore', kind: 'engineering' },
      { name: 'w_rhr', value: W_RHR, unit: '1', sourceRef: 'R9 §2.9; Android stressScore', kind: 'engineering' },
      { name: 'logistic_k', value: LOGISTIC_K, unit: '1', sourceRef: 'Android logistic', kind: 'engineering' },
      { name: 'z_clip', value: Z_CLIP, unit: 'z', sourceRef: 'Android personalDeviation', kind: 'engineering' },
      { name: 'hrv_floor_frac', value: HRV_FLOOR_FRAC, unit: 'fraction', sourceRef: 'R9 §2 notation', kind: 'engineering' },
      { name: 'hrv_floor_ms', value: HRV_FLOOR_MS, unit: 'ms', sourceRef: 'R9 §2 notation', kind: 'engineering' },
      { name: 'rhr_floor', value: RHR_FLOOR_BPM, unit: 'bpm', sourceRef: 'R9 §2 notation', kind: 'engineering' },
      { name: 'baseline_days', value: BASELINE_DAYS, unit: 'd', sourceRef: 'R9 §2 notation', kind: 'engineering' },
    ],
    output: { unit: 'index', range: [0, 100], goodDirection: 'down', display: 'number' },
    uncertainty: { method: 'none', notes: 'Convenience index; never high confidence.' },
    evidence: {
      mechanism: { status: 'mapped', pathway: 'Lower vagal tone and higher RHR at rest index autonomic load (not psychological stress)', engineNodes: [] },
      certainty: 'C',
      refs: [{ topicSlug: 'sleep-sex-age', refIds: ['R9-2.9'] }],
    },
    tierHandling: 'Tier C HRV and "stress" are within-person trends only (R9 §3); z-scores are within source, so no absolute band is claimed.',
    planEffects: [
      { target: 'display_only', rule: 'Shown as "autonomic load", never "stress".', priority: 5 },
      { target: 'trainer_briefing', rule: 'Briefed with its components.', priority: 5 },
    ],
    optInStreams: ['hr', 'hrv', 'ibi', 'sleep_sessions'],
    dependsOn: [LN_ID, RHR_ID],
    compute: computeArd,
  },
];
