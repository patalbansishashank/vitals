/**
 * Sleep summary scores (R9 §2.3; SUITE_SPEC §4.4). Tier P.
 * The source's sleep period is used for every tier (R9 §2.1). Vendor stages are used only to classify minutes as
 * asleep / awake / unknown; they never earn points. Unknown minutes are never counted as asleep or awake.
 */
import type { ScoreDef, ScoreInput, ScoreResult, SleepRecord, SleepStageName } from '../types';
import { addDays, clamp, makeResult, mean, withheld } from './util';
import { dayOf, dayOffsetS, dayTier, nightScope, offsetNear, sleepWindow, tierConfidence } from './rhr';

export const SLEEP_VERSION = '1.0.0';
export const TST_ID = 'sleep.tst';
export const SE_ID = 'sleep.se_spt';
export const WASO_ID = 'sleep.waso';
export const MID_ID = 'sleep.midpoint';
export const SJL_ID = 'sleep.sjl';
export const MSF_ID = 'sleep.msf_sc';
export const SRI_ID = 'sleep.sri';
export const DEBT_ID = 'sleep.debt';

const ASLEEP: ReadonlySet<SleepStageName> = new Set(['light', 'deep', 'rem', 'asleep_unspecified']);
const AWAKE: ReadonlySet<SleepStageName> = new Set(['awake', 'awake_in_bed', 'out_of_bed']);

/** R9 §4.3: SE and WASO need ≥95 % of the sleep period named (asleep or awake). */
export const MIN_NAMED_COVERAGE = 0.95;
/** R9 §3 TST bands (95 %, min): A ±30, B ±40, C ±60 (B/C PROPOSED). */
export const TST_BAND_MIN = { A: 30, B: 40, C: 60 } as const;

// ---------------------------------------------------------------- per-night metrics

export interface NightSleep {
  startMs: number;
  endMs: number;
  offsetS: number;
  /** Sleep onset (first asleep minute), ms. */
  onsetMs: number;
  tstMin: number;
  sptMin: number;
  /** Wake inside the SPT after onset; null when the source gives no wake information. */
  wasoMin: number | null;
  unknownMin: number;
  /** Fraction of the SPT named asleep or awake. */
  namedCoverage: number;
  fromStages: boolean;
}

export function nightSleep(rec: SleepRecord | undefined): NightSleep | null {
  const w = sleepWindow(rec);
  if (!w || !rec) return null;
  const spt = (w.endMs - w.startMs) / 60_000;
  const stages = (rec.stages ?? [])
    .map((s) => ({ a: Math.max(w.startMs, Date.parse(s.start)), b: Math.min(w.endMs, Date.parse(s.end)), stage: s.stage }))
    .filter((s) => Number.isFinite(s.a) && Number.isFinite(s.b) && s.b > s.a)
    .sort((x, y) => x.a - y.a);
  if (stages.length) {
    const sleepS = stages.filter((s) => ASLEEP.has(s.stage));
    let asleep = 0;
    let awake = 0;
    let waso = 0;
    const first = sleepS[0]?.a ?? w.startMs;
    const last = sleepS.length ? Math.max(...sleepS.map((s) => s.b)) : w.startMs;
    for (const s of stages) {
      const m = (s.b - s.a) / 60_000;
      if (ASLEEP.has(s.stage)) asleep += m;
      else if (AWAKE.has(s.stage)) {
        awake += m;
        waso += Math.max(0, Math.min(s.b, last) - Math.max(s.a, first)) / 60_000;
      }
    }
    const named = Math.min(spt, asleep + awake);
    return { startMs: w.startMs, endMs: w.endMs, offsetS: w.offsetS, onsetMs: first, tstMin: asleep, sptMin: spt, wasoMin: waso, unknownMin: spt - named, namedCoverage: named / spt, fromStages: true };
  }
  const tst = rec.asleep_s / 60;
  const wake = rec.waso_s ?? rec.awake_s;
  const named = Math.min(spt, tst + (wake ?? 0) / 60);
  const onsetMs = w.startMs + (rec.latency_s ?? 0) * 1000;
  return {
    startMs: w.startMs,
    endMs: w.endMs,
    offsetS: w.offsetS,
    onsetMs,
    tstMin: tst,
    sptMin: spt,
    wasoMin: wake === undefined ? null : wake / 60,
    unknownMin: spt - named,
    namedCoverage: named / spt,
    fromStages: false,
  };
}

/** Local clock hour in [0, 24) of an instant at a fixed offset. */
export function localHour(ms: number, offsetS: number): number {
  const h = (((ms + offsetS * 1000) % 86_400_000) + 86_400_000) % 86_400_000;
  return h / 3_600_000;
}

/** Sleep midpoint = onset + TST/2 in local clock hours (R9 §2.3). */
export function midpointH(n: NightSleep): number {
  return localHour(n.onsetMs + (n.tstMin * 60_000) / 2, n.offsetS);
}

/** Circular mean of clock hours, in [0, 24). */
export function circularMeanH(hs: readonly number[]): number {
  let s = 0;
  let c = 0;
  for (const h of hs) {
    s += Math.sin((h / 24) * 2 * Math.PI);
    c += Math.cos((h / 24) * 2 * Math.PI);
  }
  const a = (Math.atan2(s, c) / (2 * Math.PI)) * 24;
  return (a + 24) % 24;
}

/** Signed circular difference a − b in (−12, 12]. */
export function circDiffH(a: number, b: number): number {
  let x = (((a - b) % 24) + 24) % 24;
  if (x > 12) x -= 24;
  return x;
}

function nightResult(id: string, input: ScoreInput, f: (n: NightSleep, rec: SleepRecord) => ScoreResult | { value: number; detail?: ScoreResult['detail']; gate?: string }): ScoreResult {
  const d = input.localDate;
  const scope = nightScope(d);
  const day = dayOf(input, d);
  const rec = day?.mainSleep;
  const n = nightSleep(rec);
  if (!n || !rec) return withheld(id, SLEEP_VERSION, input, 'no main sleep session for this night', scope);
  const r = f(n, rec);
  if ('scoreId' in r) return r;
  if (r.gate) return withheld(id, SLEEP_VERSION, input, r.gate, scope);
  const tier = dayTier(day, 'sleep');
  return makeResult(id, SLEEP_VERSION, input, {
    scope,
    status: 'ok',
    value: r.value,
    confidence: tierConfidence(tier),
    sourceIds: [rec.record_id],
    hashOf: { id: rec.record_id, v: rec.version, value: r.value },
    detail: { tier, from_stages: n.fromStages, named_coverage: n.namedCoverage, ...(r.detail ?? {}) },
  });
}

// ---------------------------------------------------------------- sleep.tst, se_spt, waso, midpoint

function computeTst(input: ScoreInput): ScoreResult {
  const r = nightResult(TST_ID, input, (n, rec) => {
    const naps = (dayOf(input, input.localDate)?.sleeps ?? []).filter((s) => s.record_id !== rec.record_id && !s.is_main).reduce((a, s) => a + s.asleep_s / 60, 0);
    return { value: n.tstMin, detail: { spt_min: n.sptMin, unknown_min: n.unknownMin, naps_min: naps } };
  });
  if (r.status !== 'ok' || r.value === null) return r;
  const tier = dayTier(dayOf(input, input.localDate), 'sleep');
  return { ...r, band: { lo: Math.max(0, r.value - TST_BAND_MIN[tier]), hi: r.value + TST_BAND_MIN[tier], level: 0.95 } };
}

function computeSe(input: ScoreInput): ScoreResult {
  return nightResult(SE_ID, input, (n) =>
    n.namedCoverage < MIN_NAMED_COVERAGE
      ? { value: 0, gate: `needs ≥${MIN_NAMED_COVERAGE * 100} % of the sleep period named asleep/awake (have ${(n.namedCoverage * 100).toFixed(1)} %)` }
      : { value: n.tstMin / n.sptMin, detail: { pct: (100 * n.tstMin) / n.sptMin, tst_min: n.tstMin, spt_min: n.sptMin } },
  );
}

function computeWaso(input: ScoreInput): ScoreResult {
  return nightResult(WASO_ID, input, (n) =>
    n.namedCoverage < MIN_NAMED_COVERAGE
      ? { value: 0, gate: `needs ≥${MIN_NAMED_COVERAGE * 100} % of the sleep period named asleep/awake (have ${(n.namedCoverage * 100).toFixed(1)} %)` }
      : n.wasoMin === null
        ? { value: 0, gate: 'source gives no wake minutes' }
        : { value: n.wasoMin },
  );
}

/** Nights (wake date → metrics) in [from, to]. */
function nightsIn(input: ScoreInput, from: string, to: string): Array<{ date: string; n: NightSleep; id: string }> {
  const out: Array<{ date: string; n: NightSleep; id: string }> = [];
  for (const day of input.days) {
    if (day.localDate < from || day.localDate > to) continue;
    const n = nightSleep(day.mainSleep);
    if (n && day.mainSleep) out.push({ date: day.localDate, n, id: day.mainSleep.record_id });
  }
  return out;
}

function computeMid(input: ScoreInput): ScoreResult {
  return nightResult(MID_ID, input, (n) => {
    const recent = nightsIn(input, addDays(input.localDate, -13), input.localDate).map((x) => midpointH(x.n));
    return { value: midpointH(n), detail: { mean14_h: recent.length >= 3 ? circularMeanH(recent) : null, nights14: recent.length } };
  });
}

// ---------------------------------------------------------------- social jet lag, chronotype

/** R9 §4.3: ≥3 free and ≥5 work nights in 14 days. */
export const MIN_FREE = 3;
export const MIN_WORK = 5;

/** Free night = the night before a free day; default free days are Saturday and Sunday (wake date). R9 open question 4. */
export function isFreeWakeDate(localDate: string): boolean {
  const wd = new Date(Date.parse(`${localDate}T00:00:00Z`)).getUTCDay();
  return wd === 0 || wd === 6;
}

export interface Chronotype {
  msf: number;
  msw: number;
  sdF: number;
  sdW: number;
  sjl: number;
  msfSc: number;
}

/**
 * Roenneberg MCTQ (R9 §2.3; standard formula, primary not re-fetched): SJL = |MSF − MSW|;
 * MSF_sc = MSF − 0.5·(SD_f − SD_week) when SD_f > SD_w, else MSF; SD_week = (5·SD_w + 2·SD_f)/7.
 * Midpoints are onset + TST/2 (R9) and SD is TST in hours.
 */
export function chronotype(free: ReadonlyArray<{ mid: number; tstH: number }>, work: ReadonlyArray<{ mid: number; tstH: number }>): Chronotype {
  const msf = circularMeanH(free.map((x) => x.mid));
  const msw = circularMeanH(work.map((x) => x.mid));
  const sdF = mean(free.map((x) => x.tstH));
  const sdW = mean(work.map((x) => x.tstH));
  const sdWeek = (5 * sdW + 2 * sdF) / 7;
  const msfSc = sdF > sdW ? (((msf - 0.5 * (sdF - sdWeek)) % 24) + 24) % 24 : msf;
  return { msf, msw, sdF, sdW, sjl: Math.abs(circDiffH(msf, msw)), msfSc };
}

function computeChrono(id: string, input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const nights = nightsIn(input, addDays(d, -13), d);
  const free = nights.filter((x) => isFreeWakeDate(x.date)).map((x) => ({ mid: midpointH(x.n), tstH: x.n.tstMin / 60 }));
  const work = nights.filter((x) => !isFreeWakeDate(x.date)).map((x) => ({ mid: midpointH(x.n), tstH: x.n.tstMin / 60 }));
  if (free.length < MIN_FREE || work.length < MIN_WORK)
    return withheld(id, SLEEP_VERSION, input, `needs ≥${MIN_FREE} free and ≥${MIN_WORK} work nights in 14 days (have ${free.length} and ${work.length})`);
  const c = chronotype(free, work);
  return makeResult(id, SLEEP_VERSION, input, {
    status: 'ok',
    value: id === SJL_ID ? c.sjl : c.msfSc,
    confidence: 'medium',
    sourceIds: nights.map((x) => x.id),
    hashOf: [free, work],
    detail: { msf_h: c.msf, msw_h: c.msw, sd_free_h: c.sdF, sd_work_h: c.sdW, free_nights: free.length, work_nights: work.length, free_days: 'sat_sun_default' },
  });
}

// ---------------------------------------------------------------- Sleep Regularity Index (Phillips 2017)

/** 1-min epochs (R9 §2.3). */
export const EPOCH_MS = 60_000;
export const EPOCHS_PER_DAY = 1440;
/** ≥5 valid day-pairs in a 7–14 day window (R9 §4.3). */
export const SRI_MIN_PAIRS = 5;
export const SRI_WINDOW_D = 14;
/** A day-pair is valid when ≥75 % of its epoch pairs have both states known (engineering). */
export const SRI_PAIR_COVERAGE = 0.75;
/** Windred 2024 (Sleep 47:zsad253, PMC10782501) UK Biobank: median 81.0, P25 73.8, P75 86.3; P5 41 (search snippet). */
export const WINDRED_P25 = 73.8;
export const WINDRED_MEDIAN = 81.0;
export const WINDRED_P75 = 86.3;

export type Epoch = 0 | 1 | null;

/**
 * SRI = −100 + 200 · (matching epoch pairs / compared epoch pairs) over consecutive days (Phillips 2017 Sci Rep 7:3216,
 * PMC5468315). With complete data this equals the published −100 + 200/(M(N−1)) Σ δ. Missing epochs (null) are skipped;
 * day-pairs with < SRI_PAIR_COVERAGE known pairs are dropped.
 */
export function computeSri(epochs: ReadonlyArray<ReadonlyArray<Epoch>>): { sri: number | null; validPairs: number; comparedEpochs: number } {
  let same = 0;
  let total = 0;
  let validPairs = 0;
  for (let i = 0; i + 1 < epochs.length; i++) {
    const a = epochs[i]!;
    const b = epochs[i + 1]!;
    const m = Math.min(a.length, b.length);
    let s = 0;
    let t = 0;
    for (let j = 0; j < m; j++) {
      const x = a[j];
      const y = b[j];
      if (x === null || y === null || x === undefined || y === undefined) continue;
      t++;
      if (x === y) s++;
    }
    if (m === 0 || t < SRI_PAIR_COVERAGE * Math.max(a.length, b.length)) continue;
    validPairs++;
    same += s;
    total += t;
  }
  return { sri: total ? -100 + (200 * same) / total : null, validPairs, comparedEpochs: total };
}

/**
 * Sleep/wake epochs for local calendar day `date` from sleep records (stages when present, else the whole period
 * counts as sleep) or from a `sleep_state` series (value > 0 = asleep, one sample per minute, gaps ≤ 5 min filled).
 * A day without any sleep record or sleep_state sample is unobserved (all null); otherwise minutes outside sleep are
 * wake (assumption: worn). Epochs after `nowMs` are null.
 */
export function dayEpochs(input: ScoreInput, date: string, nowMs: number): Epoch[] {
  const off = dayOffsetS(dayOf(input, date)) ?? offsetNear(input, date);
  const t0 = Date.parse(`${date}T00:00:00Z`) - off * 1000;
  const t1 = t0 + EPOCHS_PER_DAY * EPOCH_MS;
  const ep: Epoch[] = new Array<Epoch>(EPOCHS_PER_DAY).fill(null);
  const idx = (t: number) => Math.floor((t - t0) / EPOCH_MS);

  const states = (input.series.sleep_state ?? []).filter((s) => s.t >= t0 && s.t < t1);
  if (states.length) {
    for (let k = 0; k < states.length; k++) {
      const s = states[k]!;
      const next = states[k + 1];
      const until = next && next.t - s.t <= 5 * EPOCH_MS ? next.t : s.t + EPOCH_MS;
      for (let j = idx(s.t); j < Math.min(EPOCHS_PER_DAY, idx(until - 1) + 1); j++) if (j >= 0) ep[j] = s.value > 0 ? 1 : 0;
    }
  } else {
    const recs = new Map<string, SleepRecord>();
    for (const day of input.days) {
      if (day.localDate < addDays(date, -1) || day.localDate > addDays(date, 1)) continue;
      for (const r of [...day.sleeps, ...(day.mainSleep ? [day.mainSleep] : [])]) recs.set(r.record_id, r);
    }
    const overlapping = [...recs.values()].filter((r) => r.time.start && r.time.end && Date.parse(r.time.end) > t0 && Date.parse(r.time.start) < t1);
    if (!overlapping.length) return ep;
    ep.fill(0);
    for (const r of overlapping.sort((a, b) => (a.time.start! < b.time.start! ? -1 : 1))) {
      const segs = r.stages?.length
        ? r.stages.map((s) => ({ a: Date.parse(s.start), b: Date.parse(s.end), v: ASLEEP.has(s.stage) ? 1 : AWAKE.has(s.stage) ? 0 : null }))
        : [{ a: Date.parse(r.time.start!), b: Date.parse(r.time.end!), v: 1 }];
      for (const g of segs) {
        // Epoch j belongs to the segment containing its midpoint.
        const j0 = Math.max(0, Math.ceil((g.a - t0) / EPOCH_MS - 0.5));
        const j1 = Math.min(EPOCHS_PER_DAY, Math.ceil((g.b - t0) / EPOCH_MS - 0.5));
        for (let j = j0; j < j1; j++) ep[j] = g.v as Epoch;
      }
    }
  }
  for (let j = Math.max(0, idx(nowMs)); j < EPOCHS_PER_DAY; j++) if (t0 + (j + 1) * EPOCH_MS > nowMs) ep[j] = null;
  return ep;
}

function computeSriScore(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const nowMs = Date.parse(input.computedAt);
  // The 14 complete local days before the scored wake date (day d itself is still in progress).
  const dates = Array.from({ length: SRI_WINDOW_D }, (_, k) => addDays(d, k - SRI_WINDOW_D));
  const epochs = dates.map((x) => dayEpochs(input, x, nowMs));
  const r = computeSri(epochs);
  if (r.sri === null || r.validPairs < SRI_MIN_PAIRS)
    return withheld(SRI_ID, SLEEP_VERSION, input, `needs ≥${SRI_MIN_PAIRS} valid day-pairs in ${SRI_WINDOW_D} days (have ${r.validPairs})`);
  const ids = input.days.filter((x) => x.localDate >= dates[0]! && x.localDate <= d && x.mainSleep).map((x) => x.mainSleep!.record_id);
  return makeResult(SRI_ID, SLEEP_VERSION, input, {
    status: 'ok',
    value: r.sri,
    state: r.sri < WINDRED_P25 ? 'below_p25' : r.sri < WINDRED_MEDIAN ? 'p25_p50' : r.sri < WINDRED_P75 ? 'p50_p75' : 'above_p75',
    confidence: 'medium',
    sourceIds: ids,
    hashOf: epochs.map((e) => e.map((x) => (x === null ? 2 : x)).join('')),
    detail: { valid_pairs: r.validPairs, compared_epochs: r.comparedEpochs, windred_p25: WINDRED_P25, windred_median: WINDRED_MEDIAN, windred_p75: WINDRED_P75 },
  });
}

// ---------------------------------------------------------------- sleep debt (dossier 16 §4.1.1)

/** Dossier 16 §4.1.1: h_ref 7.5 h actual sleep (Nedeltcheva 2010); τ_F 1 d on / 2 d off; τ_S 3 d on / 5 d off; caps 4 h. */
export const H_REF = 7.5;
export const TAU_F_ON = 1;
export const TAU_F_OFF = 2;
export const TAU_S_ON = 3;
export const TAU_S_OFF = 5;
export const DEBT_CAP = 4;
/** R9 §4.3: dF > 1.5 h → no fast > 24 h starts, intensity −1 level. */
export const DEBT_FAST_BLOCK_H = 1.5;
/** History used to spin up the filters (5·τ_S_off ≫ e-folding; engineering). */
export const DEBT_HISTORY_D = 60;

const a = (tau: number) => 1 - Math.exp(-1 / tau);

/** One night of the dossier 16 deficit filters; d = max(0, need − sleep) (qualityEq not modelled here). */
export function sleepDebtStep(prev: { dF: number; dS: number }, sleepH: number, needH = H_REF): { dF: number; dS: number; d: number } {
  const d = Math.max(0, needH - sleepH);
  const dF = clamp(prev.dF + a(d > prev.dF ? TAU_F_ON : TAU_F_OFF) * (d - prev.dF), 0, DEBT_CAP);
  const dS = clamp(prev.dS + a(d > prev.dS ? TAU_S_ON : TAU_S_OFF) * (d - prev.dS), 0, DEBT_CAP);
  return { dF, dS, d };
}

function computeDebt(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const need = input.profile.sleepNeedH ?? H_REF;
  const nights = nightsIn(input, addDays(d, -DEBT_HISTORY_D + 1), d);
  if (!nights.length) return withheld(DEBT_ID, SLEEP_VERSION, input, 'needs ≥1 night of measured sleep');
  let s = { dF: 0, dS: 0 };
  let lastD = 0;
  for (const x of nights) {
    const r = sleepDebtStep(s, x.n.tstMin / 60, need);
    s = { dF: r.dF, dS: r.dS };
    lastD = r.d;
  }
  const lastDate = nights[nights.length - 1]!.date;
  const span = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${nights[0]!.date}T00:00:00Z`)) / 86_400_000) + 1;
  return makeResult(DEBT_ID, SLEEP_VERSION, input, {
    status: 'ok',
    value: s.dF,
    state: s.dF > DEBT_FAST_BLOCK_H ? 'elevated' : 'ok',
    confidence: nights.length >= 7 && lastDate === d ? 'medium' : 'low',
    sourceIds: nights.map((x) => x.id),
    hashOf: { need, n: nights.map((x) => [x.date, x.n.tstMin]) },
    detail: { dF_h: s.dF, dS_h: s.dS, deficit_last_h: lastD, need_h: need, nights: nights.length, missing_nights: span - nights.length, last_night: lastDate },
  });
}

// ---------------------------------------------------------------- catalogue

const SLEEP_EVIDENCE = {
  mechanism: { status: 'modelled' as const, pathway: 'Measured sleep replaces assumed sleep in the dossier 16 deficit state (dF, dS)', engineNodes: ['sleepDefFast', 'sleepDefSlow'] },
  certainty: 'B' as const,
  refs: [{ topicSlug: 'sleep-sex-age', refIds: ['Nedeltcheva10', 'Phillips17', 'Windred24'] }],
};
const DISPLAY_EVIDENCE = { ...SLEEP_EVIDENCE, mechanism: { ...SLEEP_EVIDENCE.mechanism, status: 'mapped' as const, engineNodes: [] } };
const TIER_SLEEP = 'All tiers use the source sleep period. TST band A ±30, B ±40, C ±60 min (95 %); wake is underestimated by every device so WASO is biased low. Stages are vendor opinion and only classify minutes.';
const SESSION_INPUT = { stream: 'sleep_sessions', window: 'main_sleep' as const, tiersAllowed: ['A', 'B', 'C'] as Array<'A' | 'B' | 'C'>, sameSourceRequired: false };
const base = { version: SLEEP_VERSION, released: '2026-10-01', profileInputs: [] as ScoreDef['profileInputs'], optInStreams: ['sleep_sessions'] as ScoreDef['optInStreams'] };
const fn = (id: string) => `${id}@${SLEEP_VERSION}`;
const coverageParam = { name: 'min_named_coverage', value: MIN_NAMED_COVERAGE, unit: 'fraction', sourceRef: 'R9 §4.3', kind: 'engineering' as const };
const chronoParams = [
  { name: 'min_free_nights', value: MIN_FREE, unit: 'nights', sourceRef: 'R9 §4.3', kind: 'engineering' as const },
  { name: 'min_work_nights', value: MIN_WORK, unit: 'nights', sourceRef: 'R9 §4.3', kind: 'engineering' as const },
  { name: 'window', value: 14, unit: 'd', sourceRef: 'R9 §4.3', kind: 'engineering' as const },
];

export const sleepDefs: ScoreDef[] = [
  {
    ...base,
    scoreId: TST_ID,
    title: 'Total sleep time',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [SESSION_INPUT],
    gates: ['main_sleep_present'],
    formula: { fn: fn(TST_ID), text: 'TST = Σ asleep minutes in the main sleep (unknown minutes excluded; naps in detail).' },
    params: [
      { name: 'band_tier_a', value: TST_BAND_MIN.A, unit: 'min', sourceRef: 'R9 §3', kind: 'published' },
      { name: 'band_tier_b', value: TST_BAND_MIN.B, unit: 'min', sourceRef: 'R9 §3', kind: 'proposed' },
      { name: 'band_tier_c', value: TST_BAND_MIN.C, unit: 'min', sourceRef: 'R9 §3', kind: 'proposed' },
    ],
    output: { unit: 'min', range: [0, 1440], goodDirection: 'up', display: 'number' },
    uncertainty: { method: 'fixed_band', notes: 'Device band by tier (R9 §3).' },
    evidence: SLEEP_EVIDENCE,
    tierHandling: TIER_SLEEP,
    planEffects: [{ target: 'engine_observation', rule: 'Replaces assumed sleep hours in dossier 16 d_t.', priority: 4 }],
    compute: computeTst,
  },
  {
    ...base,
    scoreId: SE_ID,
    title: 'Sleep efficiency (of sleep period)',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [SESSION_INPUT],
    gates: ['main_sleep_present', `named_coverage>=${MIN_NAMED_COVERAGE}`],
    formula: { fn: fn(SE_ID), text: 'SE_spt = TST / SPT (not classic TST/TIB; rings do not know time in bed).' },
    params: [coverageParam],
    output: { unit: 'ratio', range: [0, 1], goodDirection: 'up', display: 'number' },
    uncertainty: { method: 'none', notes: 'Wake underestimated by wearables, so SE is biased high.' },
    evidence: DISPLAY_EVIDENCE,
    tierHandling: TIER_SLEEP,
    planEffects: [
      { target: 'display_only', rule: 'Shown.', priority: 5 },
      { target: 'trainer_briefing', rule: 'Poor efficiency on ≥3 of 7 nights → dossier 16 qualityEq suggestion (PROPOSED).', priority: 5 },
    ],
    compute: computeSe,
  },
  {
    ...base,
    scoreId: WASO_ID,
    title: 'Wake after sleep onset',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [SESSION_INPUT],
    gates: ['main_sleep_present', `named_coverage>=${MIN_NAMED_COVERAGE}`, 'wake_minutes_reported'],
    formula: { fn: fn(WASO_ID), text: 'WASO = awake minutes between first and last asleep stage (else the source WASO / awake minutes).' },
    params: [coverageParam],
    output: { unit: 'min', range: [0, 1440], goodDirection: 'down', display: 'number' },
    uncertainty: { method: 'none', notes: 'Biased low on wearables (R9 §2.1).' },
    evidence: DISPLAY_EVIDENCE,
    tierHandling: TIER_SLEEP,
    planEffects: [{ target: 'display_only', rule: 'Shown; illness corroborator (PROPOSED).', priority: 5 }],
    compute: computeWaso,
  },
  {
    ...base,
    scoreId: MID_ID,
    title: 'Sleep midpoint',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [SESSION_INPUT],
    gates: ['main_sleep_present'],
    formula: { fn: fn(MID_ID), text: 'Midpoint = local clock time of onset + TST/2; 14-day circular mean in detail.' },
    params: [],
    output: { unit: 'h_local', range: [0, 24], display: 'number' },
    uncertainty: { method: 'none', notes: 'Clock-time from the source period.' },
    evidence: DISPLAY_EVIDENCE,
    tierHandling: TIER_SLEEP,
    planEffects: [{ target: 'trainer_briefing', rule: 'Timing advice (dossier 07/16).', priority: 5 }],
    compute: computeMid,
  },
  {
    ...base,
    scoreId: SJL_ID,
    title: 'Social jet lag',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [{ ...SESSION_INPUT, window: '14d', minCount: MIN_FREE + MIN_WORK }],
    gates: [`free_nights_14d>=${MIN_FREE}`, `work_nights_14d>=${MIN_WORK}`],
    formula: { fn: fn(SJL_ID), text: 'SJL = |MSF − MSW| (circular), free nights = nights before Saturday/Sunday by default.' },
    params: chronoParams,
    output: { unit: 'h', range: [0, 12], goodDirection: 'down', display: 'number' },
    uncertainty: { method: 'none', notes: 'Free days default to weekends; alarm use unknown (R9 §2.3).' },
    evidence: DISPLAY_EVIDENCE,
    tierHandling: TIER_SLEEP,
    planEffects: [{ target: 'trainer_briefing', rule: 'Timing advice (dossier 07/16).', priority: 5 }],
    compute: (i) => computeChrono(SJL_ID, i),
  },
  {
    ...base,
    scoreId: MSF_ID,
    title: 'Chronotype (MSF_sc)',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [{ ...SESSION_INPUT, window: '14d', minCount: MIN_FREE + MIN_WORK }],
    gates: [`free_nights_14d>=${MIN_FREE}`, `work_nights_14d>=${MIN_WORK}`],
    formula: { fn: fn(MSF_ID), text: 'MSF_sc = MSF − 0.5·(SD_f − SD_week) if SD_f > SD_w else MSF; SD_week = (5·SD_w + 2·SD_f)/7 (Roenneberg); SD = TST.' },
    params: chronoParams,
    output: { unit: 'h_local', range: [0, 24], display: 'number' },
    uncertainty: { method: 'none', notes: 'Free days default to weekends (R9 open question 4).' },
    evidence: DISPLAY_EVIDENCE,
    tierHandling: TIER_SLEEP,
    planEffects: [{ target: 'trainer_briefing', rule: 'Timing advice (dossier 07/16).', priority: 5 }],
    compute: (i) => computeChrono(MSF_ID, i),
  },
  {
    ...base,
    scoreId: SRI_ID,
    title: 'Sleep Regularity Index',
    kind: 'index',
    label: 'measurement',
    inputs: [
      { ...SESSION_INPUT, window: '14d' },
      { stream: 'sleep_state', window: '14d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
    ],
    gates: [`valid_day_pairs_14d>=${SRI_MIN_PAIRS}`],
    formula: { fn: fn(SRI_ID), text: 'Over the 14 complete days before the wake date: SRI = −100 + 200 · (matching sleep/wake states at the same clock minute on consecutive days / compared minute pairs) (Phillips 2017). 100 = identical timing, 0 = random.' },
    params: [
      { name: 'min_valid_pairs', value: SRI_MIN_PAIRS, unit: 'day-pairs', sourceRef: 'R9 §2.3', kind: 'engineering' },
      { name: 'window', value: SRI_WINDOW_D, unit: 'd', sourceRef: 'R9 §4.3', kind: 'engineering' },
      { name: 'pair_coverage', value: SRI_PAIR_COVERAGE, unit: 'fraction', sourceRef: 'engineering', kind: 'engineering' },
      { name: 'windred_p25', value: WINDRED_P25, unit: 'SRI', sourceRef: 'Windred 2024 Sleep 47:zsad253 PMC10782501', kind: 'published' },
      { name: 'windred_median', value: WINDRED_MEDIAN, unit: 'SRI', sourceRef: 'Windred 2024', kind: 'published' },
      { name: 'windred_p75', value: WINDRED_P75, unit: 'SRI', sourceRef: 'Windred 2024', kind: 'published' },
    ],
    output: { unit: 'SRI', range: [-100, 100], goodDirection: 'up', display: 'number' },
    uncertainty: { method: 'none', notes: 'Shown against Windred percentiles; record-based epochs assume the device was worn outside sleep.' },
    evidence: { ...DISPLAY_EVIDENCE, mechanism: { status: 'mapped', pathway: 'Circadian misalignment and light exposure (Phillips 2017 DLMO shift)', engineNodes: [] } },
    tierHandling: TIER_SLEEP,
    planEffects: [
      { target: 'trainer_briefing', rule: 'Regularity becomes a sleep-plan target (dossier 07/16).', priority: 5 },
      { target: 'replan_trigger', rule: `SRI < Windred P25 (${WINDRED_P25}) for 2 weeks → replan trigger (sleep-timing advice).`, priority: 5 },
    ],
    compute: computeSriScore,
  },
  {
    ...base,
    scoreId: DEBT_ID,
    title: 'Sleep debt (dF, dS)',
    kind: 'derived_measurement',
    label: 'estimate',
    inputs: [{ ...SESSION_INPUT, window: '60d', minCount: 1 }],
    profileInputs: ['sleepNeedH'],
    gates: ['nights>=1'],
    formula: {
      fn: fn(DEBT_ID),
      text: 'd_t = max(0, need − TST_t); dF_t = dF + (1−e^(−1/τ_F))·(d_t − dF), τ_F 1 d rising / 2 d falling; dS likewise with τ_S 3/5 d; caps 4 h; missing nights hold the state. Value = dF.',
    },
    params: [
      { name: 'h_ref', value: H_REF, unit: 'h', sourceRef: 'dossier 16 §4.1.1 (Nedeltcheva 2010)', kind: 'published' },
      { name: 'tau_f_on', value: TAU_F_ON, unit: 'd', sourceRef: 'dossier 16 §4.1.1', kind: 'proposed' },
      { name: 'tau_f_off', value: TAU_F_OFF, unit: 'd', sourceRef: 'dossier 16 §4.1.1', kind: 'proposed' },
      { name: 'tau_s_on', value: TAU_S_ON, unit: 'd', sourceRef: 'dossier 16 §4.1.1', kind: 'proposed' },
      { name: 'tau_s_off', value: TAU_S_OFF, unit: 'd', sourceRef: 'dossier 16 §4.1.1', kind: 'proposed' },
      { name: 'cap', value: DEBT_CAP, unit: 'h', sourceRef: 'dossier 16 §4.1.1', kind: 'proposed' },
      { name: 'fast_block_dF', value: DEBT_FAST_BLOCK_H, unit: 'h', sourceRef: 'R9 §4.3', kind: 'proposed' },
      { name: 'history', value: DEBT_HISTORY_D, unit: 'd', sourceRef: 'engineering', kind: 'engineering' },
    ],
    output: { unit: 'h', range: [0, DEBT_CAP], goodDirection: 'down', display: 'number' },
    uncertainty: { method: 'none', notes: 'Grade B mechanism, C for τ; inherits the TST band.' },
    evidence: { ...SLEEP_EVIDENCE, certainty: 'C' },
    tierHandling: TIER_SLEEP,
    planEffects: [
      { target: 'fast_permission', rule: `dF > ${DEBT_FAST_BLOCK_H} h → no fast > 24 h starts.`, priority: 3 },
      { target: 'training_intensity', rule: `dF > ${DEBT_FAST_BLOCK_H} h → intensity −1 level.`, priority: 3 },
      { target: 'trainer_briefing', rule: 'dF and dS are briefed.', priority: 3 },
    ],
    compute: computeDebt,
  },
];
