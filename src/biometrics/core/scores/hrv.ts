/**
 * HRV scores (R9 §2.4): hrv.ln_rmssd_night, hrv.status, hrv.strain_accumulating. Tier P.
 * One window type per source; values from different sources or windows never share a baseline (R9 §2.4, §3).
 * SDNN (Apple) is never converted to RMSSD. Tier C / vendor-defined HRV is a within-person trend only.
 */
import type { DeviceTier, HrvValue, ScoreDef, ScoreInput, ScoreResult } from '../types';
import { addDays, makeResult, mean, median, sd, withheld } from './util';
import { BASELINE_DAYS, dayOf, dayTier, detailStr, minConfidence, nightScope, priorByDate, sleepWindow, tierConfidence, windowSamples } from './rhr';

export const LN_ID = 'hrv.ln_rmssd_night';
export const STATUS_ID = 'hrv.status';
export const STRAIN_ID = 'hrv.strain_accumulating';
export const HRV_VERSION = '1.0.0';

// ---------------------------------------------------------------- IBI → RMSSD (R9 §2.4 (a); rejection rule PROPOSED)

/** Plausible RR interval (ms), R9 §2.4 (Malik-style, PROPOSED). */
export const RR_RANGE: [number, number] = [300, 2000];
/** Reject RR more than 20 % from the local median (R9 §2.4, PROPOSED). */
export const RR_LOCAL_DEV = 0.2;
/** Local median over ±5 beats (11-beat window): engineering choice. */
export const RR_LOCAL_HALF = 5;
/** 5-min RMSSD windows; reject a window with >20 % of beats rejected (R9 §2.4, PROPOSED). */
export const RMSSD_WINDOW_MS = 300_000;
export const WINDOW_MAX_REJECT = 0.2;
/** A window needs ≥30 successive differences; a night ≥3 valid windows (engineering). */
export const WINDOW_MIN_DIFFS = 30;
export const NIGHT_MIN_WINDOWS = 3;
/** Plausible nightly RMSSD (ms), Android stressScore 1..300 (engineering). */
export const RMSSD_PLAUSIBLE: [number, number] = [1, 300];

/** Artefact flags for an RR series (true = rejected). */
export function rejectArtefacts(rr: readonly number[]): boolean[] {
  return rr.map((x, i) => {
    if (!(x >= RR_RANGE[0] && x <= RR_RANGE[1])) return true;
    const loc = rr.slice(Math.max(0, i - RR_LOCAL_HALF), i + RR_LOCAL_HALF + 1).filter((v) => v >= RR_RANGE[0] && v <= RR_RANGE[1]);
    const m = median(loc);
    return Math.abs(x - m) > RR_LOCAL_DEV * m;
  });
}

/** RMSSD of one window: successive differences only between adjacent accepted beats. null when too few. */
export function windowRmssd(rr: readonly number[], rejected: readonly boolean[]): number | null {
  let s = 0;
  let n = 0;
  for (let i = 1; i < rr.length; i++) {
    if (rejected[i] || rejected[i - 1]) continue;
    s += (rr[i]! - rr[i - 1]!) ** 2;
    n++;
  }
  return n >= WINDOW_MIN_DIFFS ? Math.sqrt(s / n) : null;
}

/** Night RMSSD from IBI samples (t = beat time ms, value = RR ms): mean of valid 5-min window RMSSDs. */
export function rmssdFromIbi(ibi: readonly { t: number; value: number }[], startMs: number): { rmssd: number; windows: number; rejectedFrac: number } | null {
  const rr = ibi.map((x) => x.value);
  const rej = rejectArtefacts(rr);
  const wins = new Map<number, number[]>();
  ibi.forEach((x, i) => {
    const k = Math.floor((x.t - startMs) / RMSSD_WINDOW_MS);
    let a = wins.get(k);
    if (!a) wins.set(k, (a = []));
    a.push(i);
  });
  const vals: number[] = [];
  for (const idx of [...wins.keys()].sort((a, b) => a - b).map((k) => wins.get(k)!)) {
    const r = idx.filter((i) => rej[i]).length;
    if (r / idx.length > WINDOW_MAX_REJECT) continue;
    const v = windowRmssd(
      idx.map((i) => rr[i]!),
      idx.map((i) => rej[i]!),
    );
    if (v !== null) vals.push(v);
  }
  if (vals.length < NIGHT_MIN_WINDOWS) return null;
  return { rmssd: mean(vals), windows: vals.length, rejectedFrac: rej.filter(Boolean).length / rr.length };
}

// ---------------------------------------------------------------- hrv.ln_rmssd_night

type HrvWindow = 'ibi_5min_mean' | `summary_${string}` | 'series_median';

interface NightHrv {
  rmssd: number;
  window: HrvWindow;
  sourceKey: string;
  tier: DeviceTier;
  vendorDefined: boolean;
  ids: string[];
  n: number;
}

/** Returns the night value, or a reason string when none is usable. */
export function nightHrv(input: ScoreInput, date: string): NightHrv | string {
  const day = dayOf(input, date);
  const w = sleepWindow(day?.mainSleep);
  if (!w) return 'no main sleep session for this night';
  const ids = [w.record.record_id];
  const ibi = windowSamples(input, 'ibi', w.startMs, w.endMs, day?.sourceByMetric.ibi);
  if (ibi) {
    const r = rmssdFromIbi(ibi.samples, w.startMs);
    if (r) return { rmssd: r.rmssd, window: 'ibi_5min_mean', sourceKey: ibi.sourceKey, tier: ibi.tier, vendorDefined: false, ids: [ibi.sourceKey, ...ids], n: r.windows };
  }
  const tier = dayTier(day, 'hrv');
  const src = day?.sourceByMetric.hrv ?? w.record.provenance.native_id ?? w.record.provenance.channel;
  const summaries: Array<[HrvValue | undefined, string, string]> = [
    [w.record.night?.hrv, 'summary_sleep', w.record.record_id],
    [day?.daily?.hrv && ['night', 'deep_sleep', 'first_4h'].includes(day.daily.hrv.window) ? day.daily.hrv : undefined, `summary_daily_${day?.daily?.hrv?.window ?? ''}`, day?.daily?.record_id ?? ''],
  ];
  let sdnnOnly = false;
  for (const [h, win, id] of summaries) {
    if (!h) continue;
    if (h.metric === 'sdnn') {
      sdnnOnly = true;
      continue;
    }
    if (h.value_ms >= RMSSD_PLAUSIBLE[0] && h.value_ms <= RMSSD_PLAUSIBLE[1])
      return { rmssd: h.value_ms, window: win as HrvWindow, sourceKey: src, tier, vendorDefined: h.metric === 'vendor' || tier === 'C', ids: [id], n: 1 };
  }
  const ser = windowSamples(input, 'hrv', w.startMs, w.endMs, day?.sourceByMetric.hrv);
  if (ser) {
    const v = ser.samples.map((s) => s.value).filter((x) => x >= RMSSD_PLAUSIBLE[0] && x <= RMSSD_PLAUSIBLE[1]);
    if (v.length >= 3) return { rmssd: median(v), window: 'series_median', sourceKey: ser.sourceKey, tier: ser.tier, vendorDefined: true, ids: [ser.sourceKey, ...ids], n: v.length };
  }
  return sdnnOnly ? 'source reports SDNN only; SDNN is never converted to RMSSD' : 'no IBI, RMSSD summary or HRV samples in the main sleep';
}

/** R9 §3 RMSSD bands: tier A ±12 ms (Dial 2025), tier B MAPE up to 16 %; tier C trend only (no absolute band). */
export const RMSSD_BAND_A_MS = 12;
export const RMSSD_BAND_B_REL = 0.16;

function computeLn(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const scope = nightScope(d);
  const h = nightHrv(input, d);
  if (typeof h === 'string') return withheld(LN_ID, HRV_VERSION, input, h, scope);
  const value = Math.log(h.rmssd);
  const band =
    h.tier === 'A' && !h.vendorDefined
      ? { lo: Math.log(Math.max(1, h.rmssd - RMSSD_BAND_A_MS)), hi: Math.log(h.rmssd + RMSSD_BAND_A_MS), level: 0.95 as const }
      : h.tier === 'B' && !h.vendorDefined
        ? { lo: Math.log(h.rmssd * (1 - RMSSD_BAND_B_REL)), hi: Math.log(h.rmssd * (1 + RMSSD_BAND_B_REL)), level: 0.95 as const }
        : undefined;
  return makeResult(LN_ID, HRV_VERSION, input, {
    scope,
    status: 'ok',
    value,
    ...(band ? { band } : {}),
    confidence: h.vendorDefined ? 'low' : tierConfidence(h.tier),
    sourceIds: h.ids,
    hashOf: h,
    detail: { rmssd_ms: h.rmssd, window: h.window, sourceKey: h.sourceKey, tier: h.tier, within_person_only: h.vendorDefined || h.tier === 'C', n: h.n },
  });
}

// ---------------------------------------------------------------- history of nightly lnRMSSD (one source + window)

/** Nightly L by date for the same source and window as tonight (prior results plus tonight computed in place). */
export function lnHistory(input: ScoreInput): { today: ScoreResult | null; byDate: Map<string, number>; ids: string[] } {
  const d = input.localDate;
  const prior = priorByDate(input, LN_ID);
  const today = prior.get(d) ?? (() => {
    const r = computeLn(input);
    return r.status === 'ok' ? r : null;
  })();
  const byDate = new Map<string, number>();
  const ids: string[] = [];
  const src = detailStr(today ?? undefined, 'sourceKey');
  const win = detailStr(today ?? undefined, 'window');
  if (today && today.value !== null) {
    for (const [date, r] of prior) {
      if (date >= d || r.value === null || detailStr(r, 'sourceKey') !== src || detailStr(r, 'window') !== win) continue;
      byDate.set(date, r.value);
      ids.push(...r.sourceIds);
    }
    byDate.set(d, today.value);
    ids.push(...today.sourceIds);
  }
  return { today, byDate, ids: [...new Set(ids)].sort() };
}

function valuesIn(byDate: Map<string, number>, from: string, to: string): number[] {
  const xs: [string, number][] = [];
  for (const [k, v] of byDate) if (k >= from && k <= to) xs.push([k, v]);
  return xs.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]);
}

// ---------------------------------------------------------------- hrv.status

/** R9 §2.4: ≥3 nights in the 7-day window; ≥14 baseline nights; range μ ± 0.5 σ (Javaloyes 2019, PMID 29809080). */
export const STATUS_MIN_7 = 3;
export const STATUS_MIN_BASE = 14;
export const STATUS_SD_MULT = 0.5;
const Z80 = 1.2816;

export type HrvState = 'below' | 'within' | 'above';

/** Pure status rule: 7-day mean vs μ ± 0.5 σ, and 'borderline' when the 80 % interval of the mean straddles a bound. */
export function hrvStatus(week: readonly number[], baseline: readonly number[]): { mean7: number; lo: number; hi: number; mu: number; sigma: number; state: HrvState; borderline: boolean; se: number } {
  const mean7 = mean(week);
  const mu = mean(baseline);
  const sigma = sd(baseline);
  const lo = mu - STATUS_SD_MULT * sigma;
  const hi = mu + STATUS_SD_MULT * sigma;
  const state: HrvState = mean7 < lo ? 'below' : mean7 > hi ? 'above' : 'within';
  // SE of the 7-day mean from the within-person nightly SD (baseline σ), R9 §2.4.
  const se = sigma / Math.sqrt(week.length);
  const a = mean7 - Z80 * se;
  const b = mean7 + Z80 * se;
  const borderline = (a < lo && b > lo) || (a < hi && b > hi);
  return { mean7, lo, hi, mu, sigma, state, borderline, se };
}

function computeStatus(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const { today, byDate, ids } = lnHistory(input);
  if (!today) return withheld(STATUS_ID, HRV_VERSION, input, 'no lnRMSSD for this night');
  const week = valuesIn(byDate, addDays(d, -6), d);
  if (week.length < STATUS_MIN_7) return withheld(STATUS_ID, HRV_VERSION, input, `needs ≥${STATUS_MIN_7} nights in the last 7 days (have ${week.length})`);
  const base = valuesIn(byDate, addDays(d, -6 - BASELINE_DAYS), addDays(d, -7));
  if (base.length < STATUS_MIN_BASE)
    return makeResult(STATUS_ID, HRV_VERSION, input, {
      status: 'insufficient_baseline',
      value: null,
      reason: `needs ≥${STATUS_MIN_BASE} baseline nights from the same source and window (have ${base.length})`,
      hashOf: [week, base],
    });
  const s = hrvStatus(week, base);
  const tier = (detailStr(today, 'tier') ?? 'C') as DeviceTier;
  const full = byDate.size && [...byDate.keys()].sort()[0]! <= addDays(d, -6 - BASELINE_DAYS);
  const confidence = minConfidence(today.confidence, full ? 'high' : 'low', tierConfidence(tier));
  return makeResult(STATUS_ID, HRV_VERSION, input, {
    status: s.borderline ? 'borderline' : 'ok',
    value: s.mean7,
    state: s.borderline ? 'borderline' : s.state,
    band: { lo: s.mean7 - Z80 * s.se, hi: s.mean7 + Z80 * s.se, level: 0.8 },
    confidence,
    sourceIds: ids,
    hashOf: [week, base],
    contributors: [
      { id: 'ln_rmssd_7d', raw: s.mean7, unit: 'ln(ms)', weightConfigured: 1, weightApplied: 1, available: true },
      { id: 'baseline_60d', raw: s.mu, unit: 'ln(ms)', weightConfigured: 0, weightApplied: 0, available: true },
    ],
    detail: {
      point_state: s.state,
      nights_7d: week.length,
      baseline_nights: base.length,
      baseline_mean: s.mu,
      baseline_sd: s.sigma,
      range_lo: s.lo,
      range_hi: s.hi,
      within_person_only: today.detail?.within_person_only ?? true,
      sourceKey: detailStr(today, 'sourceKey'),
      window: detailStr(today, 'window'),
    },
  });
}

// ---------------------------------------------------------------- hrv.strain_accumulating

/** R9 §2.4 / §4.3: ≥28 days of nightly data; CV_7 rise > 1 SD of its own 60-day history while L̄_7 falls (Plews 2013). */
export const STRAIN_MIN_DAYS = 28;
export const STRAIN_SD_MULT = 1;
/** CV_7 history needs ≥14 points (engineering). */
export const STRAIN_MIN_CV_HISTORY = 14;

/** CV_7 = SD/mean of L over the 7 days ending `date` (≥3 nights), else null. */
export function cv7(byDate: Map<string, number>, date: string): number | null {
  const xs = valuesIn(byDate, addDays(date, -6), date);
  return xs.length >= STATUS_MIN_7 ? sd(xs) / mean(xs) : null;
}

function mean7(byDate: Map<string, number>, date: string): number | null {
  const xs = valuesIn(byDate, addDays(date, -6), date);
  return xs.length >= STATUS_MIN_7 ? mean(xs) : null;
}

function computeStrain(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const { today, byDate, ids } = lnHistory(input);
  if (!today) return withheld(STRAIN_ID, HRV_VERSION, input, 'no lnRMSSD for this night');
  const first = [...byDate.keys()].sort()[0]!;
  const span = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
  if (span < STRAIN_MIN_DAYS)
    return makeResult(STRAIN_ID, HRV_VERSION, input, { status: 'insufficient_baseline', value: null, reason: `needs ≥${STRAIN_MIN_DAYS} days of nightly HRV (have ${span})`, hashOf: [...byDate] });
  const cvNow = cv7(byDate, d);
  const mNow = mean7(byDate, d);
  const mPrev = mean7(byDate, addDays(d, -7));
  if (cvNow === null || mNow === null) return withheld(STRAIN_ID, HRV_VERSION, input, `needs ≥${STATUS_MIN_7} nights in the last 7 days`);
  const hist: number[] = [];
  for (let k = 1; k <= BASELINE_DAYS; k++) {
    const c = cv7(byDate, addDays(d, -k));
    if (c !== null) hist.push(c);
  }
  if (hist.length < STRAIN_MIN_CV_HISTORY || mPrev === null)
    return makeResult(STRAIN_ID, HRV_VERSION, input, {
      status: 'insufficient_baseline',
      value: null,
      reason: `needs ≥${STRAIN_MIN_CV_HISTORY} days of CV_7 history and a prior 7-day mean`,
      hashOf: [...byDate],
    });
  const thr = mean(hist) + STRAIN_SD_MULT * sd(hist);
  const rising = cvNow > thr;
  const falling = mNow < mPrev;
  const flag = rising && falling;
  return makeResult(STRAIN_ID, HRV_VERSION, input, {
    status: 'ok',
    value: flag ? 1 : 0,
    state: flag ? 'strain_accumulating' : 'none',
    confidence: minConfidence(today.confidence, 'medium'),
    sourceIds: ids,
    hashOf: [...byDate],
    detail: { cv7: cvNow, cv7_threshold: thr, cv7_history: hist.length, mean7: mNow, mean7_prev: mPrev, cv_rising: rising, mean_falling: falling },
  });
}

// ---------------------------------------------------------------- catalogue

const HRV_EVIDENCE = {
  mechanism: { status: 'modelled' as const, pathway: 'Vagal withdrawal under accumulated sympathetic load; nocturnal RMSSD indexes parasympathetic tone (dossier 19 HRV_off)', engineNodes: ['HRV_off'] },
  certainty: 'B' as const,
  refs: [{ topicSlug: 'performance-wellbeing-bone', refIds: ['Plews13', 'Plews14', 'Javaloyes19', 'Dial25'] }],
};
const TIER_TEXT = 'Tier A/B: absolute lnRMSSD with band (A ±12 ms, B ±16 %). Tier C and vendor-defined HRV (e.g. J-Style floor(raw/2+5)): within-person trends only, no absolute band, confidence low. Baselines never mix sources or window types; SDNN is never converted.';

export const hrvDefs: ScoreDef[] = [
  {
    scoreId: LN_ID,
    title: 'Nightly HRV (lnRMSSD)',
    version: HRV_VERSION,
    released: '2026-10-01',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [
      { stream: 'ibi', window: 'main_sleep', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'hrv', window: 'main_sleep', minCount: 3, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'sleep_sessions', window: 'main_sleep', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    ],
    profileInputs: [],
    gates: ['main_sleep_present', 'rmssd_source_present', 'not_sdnn', 'window_fixed_per_source'],
    formula: {
      fn: `${LN_ID}@${HRV_VERSION}`,
      text: 'L = ln(RMSSD). RMSSD = mean of 5-min window RMSSDs from IBI after rejecting RR outside 300–2000 ms or >20 % from the 11-beat local median and windows with >20 % rejected; else the source nightly RMSSD; else the median of HRV samples in the main sleep.',
    },
    params: [
      { name: 'rr_min', value: RR_RANGE[0], unit: 'ms', sourceRef: 'R9 §2.4', kind: 'proposed' },
      { name: 'rr_max', value: RR_RANGE[1], unit: 'ms', sourceRef: 'R9 §2.4', kind: 'proposed' },
      { name: 'rr_local_dev', value: RR_LOCAL_DEV, unit: 'fraction', sourceRef: 'R9 §2.4 (Malik-style)', kind: 'proposed' },
      { name: 'rr_local_half_window', value: RR_LOCAL_HALF, unit: 'beats', sourceRef: 'engineering', kind: 'engineering' },
      { name: 'window', value: 5, unit: 'min', sourceRef: 'R9 §2.4', kind: 'proposed' },
      { name: 'window_max_reject', value: WINDOW_MAX_REJECT, unit: 'fraction', sourceRef: 'R9 §2.4', kind: 'proposed' },
      { name: 'window_min_diffs', value: WINDOW_MIN_DIFFS, unit: 'beats', sourceRef: 'engineering', kind: 'engineering' },
      { name: 'night_min_windows', value: NIGHT_MIN_WINDOWS, unit: 'windows', sourceRef: 'engineering', kind: 'engineering' },
      { name: 'band_tier_a', value: RMSSD_BAND_A_MS, unit: 'ms', sourceRef: 'R9 §3; Dial 2025 PMC12367097', kind: 'published' },
      { name: 'band_tier_b', value: RMSSD_BAND_B_REL, unit: 'fraction', sourceRef: 'R9 §3 (MAPE 10–16 %)', kind: 'proposed' },
    ],
    output: { unit: 'ln(ms)', range: [0, 6], goodDirection: 'up', display: 'number' },
    uncertainty: { method: 'fixed_band', notes: 'Tier A ±12 ms, tier B ±16 % (95 %); tier C none (trend only).' },
    evidence: HRV_EVIDENCE,
    tierHandling: TIER_TEXT,
    planEffects: [{ target: 'engine_observation', rule: 'Nightly lnRMSSD is an observation of dossier 19 HRV_off — tier A/B only.', priority: 4 }],
    optInStreams: ['ibi', 'hrv', 'sleep_sessions'],
    compute: computeLn,
  },
  {
    scoreId: STATUS_ID,
    title: 'HRV status (7-day vs baseline)',
    version: HRV_VERSION,
    released: '2026-10-01',
    kind: 'flag',
    label: 'flag',
    inputs: [{ stream: LN_ID, window: '60d', minCount: STATUS_MIN_BASE, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true }],
    profileInputs: [],
    gates: [`nights_in_7d>=${STATUS_MIN_7}`, `baseline_nights>=${STATUS_MIN_BASE}`, 'same_source_and_window'],
    formula: {
      fn: `${STATUS_ID}@${HRV_VERSION}`,
      text: 'L̄_7 = mean lnRMSSD over d−6..d (≥3). Range = μ_60 ± 0.5·σ_60 over the 60 days before the 7-day window (≥14). below / within / above; borderline when L̄_7 ± 1.28·σ_60/√n straddles a bound.',
    },
    params: [
      { name: 'min_nights_7d', value: STATUS_MIN_7, unit: 'nights', sourceRef: 'R9 §2.4; Plews 2014', kind: 'published' },
      { name: 'baseline_days', value: BASELINE_DAYS, unit: 'd', sourceRef: 'R9 §2.4 (HRV4Training practice, UNVERIFIED)', kind: 'engineering' },
      { name: 'min_baseline_nights', value: STATUS_MIN_BASE, unit: 'nights', sourceRef: 'R9 §2.4', kind: 'engineering' },
      { name: 'sd_mult', value: STATUS_SD_MULT, unit: 'SD', sourceRef: 'Javaloyes 2019 IJSPP PMID 29809080', kind: 'published' },
      { name: 'borderline_z', value: Z80, unit: 'z', sourceRef: 'R9 §2.4 (80 % interval)', kind: 'engineering' },
    ],
    output: { unit: 'ln(ms)', goodDirection: 'up', display: 'state' },
    uncertainty: { method: 'propagated', notes: '80 % interval of L̄_7 from σ_60/√n; device bias cancels within source.' },
    evidence: HRV_EVIDENCE,
    tierHandling: TIER_TEXT,
    planEffects: [
      { target: 'training_intensity', rule: "state 'below' → next session low intensity or rest.", priority: 2 },
      { target: 'fast_permission', rule: "state 'below' → do not start a fast > 24 h.", priority: 2 },
      { target: 'trainer_briefing', rule: "'below' and 'above' with rising RHR / falling performance (possible overreaching, Plews 2013) are briefed; 'borderline' is briefed as uncertain.", priority: 2 },
    ],
    optInStreams: ['ibi', 'hrv', 'sleep_sessions'],
    dependsOn: [LN_ID],
    compute: computeStatus,
  },
  {
    scoreId: STRAIN_ID,
    title: 'HRV strain accumulating',
    version: HRV_VERSION,
    released: '2026-10-01',
    kind: 'flag',
    label: 'flag',
    inputs: [{ stream: LN_ID, window: '90d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true }],
    profileInputs: [],
    gates: [`nightly_hrv_span_days>=${STRAIN_MIN_DAYS}`, `cv7_history>=${STRAIN_MIN_CV_HISTORY}`],
    formula: {
      fn: `${STRAIN_ID}@${HRV_VERSION}`,
      text: 'CV_7 = SD/mean of lnRMSSD over 7 days. Flag when CV_7 > mean + 1·SD of its own 60-day history AND L̄_7 is below the L̄_7 of a week earlier.',
    },
    params: [
      { name: 'min_days', value: STRAIN_MIN_DAYS, unit: 'd', sourceRef: 'R9 §4.3', kind: 'engineering' },
      { name: 'sd_mult', value: STRAIN_SD_MULT, unit: 'SD', sourceRef: 'R9 §2.4; Plews 2013 Sports Med PMID 23852425', kind: 'proposed' },
      { name: 'cv_history_min', value: STRAIN_MIN_CV_HISTORY, unit: 'd', sourceRef: 'engineering', kind: 'engineering' },
      { name: 'falling_lag', value: 7, unit: 'd', sourceRef: 'engineering (week-on-week L̄_7)', kind: 'engineering' },
    ],
    output: { unit: 'flag', range: [0, 1], goodDirection: 'down', display: 'state' },
    uncertainty: { method: 'none', notes: 'Rule-based; grade C.' },
    evidence: { ...HRV_EVIDENCE, certainty: 'C' },
    tierHandling: TIER_TEXT,
    planEffects: [{ target: 'trainer_briefing', rule: 'Briefed; feeds overreaching.flag.', priority: 3 }],
    optInStreams: ['ibi', 'hrv', 'sleep_sessions'],
    dependsOn: [LN_ID],
    compute: computeStrain,
  },
];
