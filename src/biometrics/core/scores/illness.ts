/**
 * illness.nightsignal (R9 §2.8; SUITE_SPEC §4.4). Tier P.
 *
 * Port of NightSignal (Alavi et al. 2022 Nat Med, doi 10.1038/s41591-021-01593-2), from the published code
 * github.com/StanfordBioinformatics/wearable-infection `nightsignal.py` (commit 99b3bd7, Apache-2.0) and its DFA
 * figure `images/NightSignal_DFA.png`, not from prose:
 * - A_i: overnight average RHR (integer, see `nightSignalAverage` in rhr.ts), one per wake date.
 * - Single missing nights are imputed as floor((A_prev + A_next)/2) when the gap has a consecutive neighbour on one
 *   side (the Fitbit branch; the Apple branch imputes only the "gap before a consecutive pair" case).
 * - M_i = int(median(A over every night up to AND INCLUDING night i)), imputed nights included ("MedianOfAvgs").
 * - Symbols: a = A < M+3, b = A = M+3, c = A ≥ M+4 (integers).
 * - Six-state DFA, S0 start; S0–S2 green, S3–S4 yellow, S5 red. A calendar gap (after imputation) restarts at S0
 *   (the code only pairs nights exactly one day apart).
 * The code has no warm-up; the paper reports the baseline settles after 7 nights, so Vitals withholds the state
 * (insufficient_baseline) until 7 measured nights exist. Temperature, HRV, respiratory-rate and sleep corroborators
 * are PROPOSED (R9 §2.8 v2) and only exposed in `detail`; they never change the NightSignal state.
 */
import type { ScoreDef, ScoreInput, ScoreResult } from '../types';
import { addDays, daysBetween, makeResult, mean, median, sd, withheld } from './util';
import { dayOf, detailNum, detailStr, nightScope, priorByDate, RHR_ID } from './rhr';

export const NS_ID = 'illness.nightsignal';
export const NS_VERSION = '1.0.0';
/** nightsignal.py `yellow_threshold = 3`, `red_threshold = 4` (bpm over the streaming median). */
export const NS_YELLOW = 3;
export const NS_RED = 4;
/** Alavi 2022 Methods: baseline established after seven nights. */
export const NS_MIN_NIGHTS = 7;

export type NsSymbol = 'a' | 'b' | 'c';
export type NsState = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export type NsAlert = 'green' | 'yellow' | 'red';

/** DFA transitions (NightSignal_DFA.png): every state goes to S0 on a; on b → S1 from S0, else S3;
 * on c → S2 from S0, S4 from S1/S3, S5 from S2/S4/S5. */
const NEXT: Record<NsState, Record<NsSymbol, NsState>> = {
  S0: { a: 'S0', b: 'S1', c: 'S2' },
  S1: { a: 'S0', b: 'S3', c: 'S4' },
  S2: { a: 'S0', b: 'S3', c: 'S5' },
  S3: { a: 'S0', b: 'S3', c: 'S4' },
  S4: { a: 'S0', b: 'S3', c: 'S5' },
  S5: { a: 'S0', b: 'S3', c: 'S5' },
};

export function nightSignalStep(state: NsState, symbol: NsSymbol): NsState {
  return NEXT[state][symbol];
}

export function nsAlert(state: NsState): NsAlert {
  return state === 'S5' ? 'red' : state === 'S3' || state === 'S4' ? 'yellow' : 'green';
}

export function nsSymbol(a: number, m: number): NsSymbol {
  return a >= m + NS_RED ? 'c' : a >= m + NS_YELLOW ? 'b' : 'a';
}

export interface NsNight {
  date: string;
  /** Overnight average (integer bpm). */
  a: number;
  imputed: boolean;
  /** Streaming median incl. this night (integer bpm). */
  m: number;
  symbol: NsSymbol;
  state: NsState;
  alert: NsAlert;
}

/** Runs NightSignal over nightly averages (any order; duplicates keep the last). Pure. */
export function computeNightSignal(nights: ReadonlyArray<{ date: string; a: number }>): NsNight[] {
  const byDate = new Map<string, number>();
  for (const n of nights) byDate.set(n.date, Math.trunc(n.a));
  const keys = [...byDate.keys()].sort();
  // Imputation (nightsignal.py Fitbit branch): for interior i, a 2-day gap on one side and a 1-day step on the other.
  const imputed = new Map<string, number>();
  for (let i = 1; i < keys.length - 1; i++) {
    const prev = keys[i - 1]!;
    const cur = keys[i]!;
    const next = keys[i + 1]!;
    const dn = daysBetween(cur, next);
    const dp = daysBetween(prev, cur);
    if (dn === 1 && dp === 2) {
      const miss = addDays(cur, -1);
      if (!imputed.has(miss) && !byDate.has(miss)) imputed.set(miss, Math.trunc((byDate.get(cur)! + byDate.get(prev)!) / 2));
    }
    if (dn === 2 && dp === 1) {
      const miss = addDays(cur, 1);
      if (!imputed.has(miss) && !byDate.has(miss)) imputed.set(miss, Math.trunc((byDate.get(cur)! + byDate.get(next)!) / 2));
    }
  }
  const all = [...keys.map((k) => ({ date: k, a: byDate.get(k)!, imputed: false })), ...[...imputed].map(([date, a]) => ({ date, a, imputed: true }))].sort((x, y) =>
    x.date < y.date ? -1 : 1,
  );
  const out: NsNight[] = [];
  const seen: number[] = [];
  let state: NsState = 'S0';
  let prevDate: string | null = null;
  for (const n of all) {
    seen.push(n.a);
    const m = Math.trunc(median(seen));
    if (prevDate !== null && daysBetween(prevDate, n.date) !== 1) state = 'S0';
    const symbol = nsSymbol(n.a, m);
    state = nightSignalStep(state, symbol);
    out.push({ ...n, m, symbol, state, alert: nsAlert(state) });
    prevDate = n.date;
  }
  return out;
}

// ---------------------------------------------------------------- PROPOSED corroborators (R9 §2.8 v2)

/** +0.4 °C skin temperature vs the 60-day median (R9 §2.8; PROPOSED). */
export const CORR_TEMP_UP_C = 0.4;
/** HRV down: L_d < μ_60 − 1·σ_60 (R9 §2.8; PROPOSED). */
export const CORR_HRV_SD = 1;
/** Respiratory rate +1 brpm vs the 60-day median (R9 §2.8; PROPOSED). */
export const CORR_RR_UP = 1;
/** WASO or SPT more than 1.5 SD from baseline (R9 §2.8; PROPOSED). */
export const CORR_SLEEP_SD = 1.5;
const CORR_MIN_BASELINE = 14;

function nightlyRespRate(input: ScoreInput, date: string): number | null {
  const day = dayOf(input, date);
  const v = day?.mainSleep?.night?.resp_rate_brpm ?? day?.daily?.resp_rate_brpm;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function spt(input: ScoreInput, date: string): number | null {
  const ms = dayOf(input, date)?.mainSleep;
  if (!ms?.time.start || !ms.time.end) return null;
  return (Date.parse(ms.time.end) - Date.parse(ms.time.start)) / 60_000;
}

/** Each corroborator is true/false, or null when its data or baseline is missing. */
export function corroborators(input: ScoreInput): Record<'temp_up' | 'hrv_down' | 'rr_up' | 'sleep_disrupted', boolean | null> {
  const d = input.localDate;
  const from = addDays(d, -60);
  const base = (f: (date: string) => number | null) => {
    const xs: number[] = [];
    for (let k = 1; k <= 60; k++) {
      const v = f(addDays(d, -k));
      if (v !== null) xs.push(v);
    }
    return xs;
  };

  const temp = priorByDate(input, 'temp.deviation').get(d);
  const tempUp = temp && temp.value !== null ? temp.value >= CORR_TEMP_UP_C : null;

  const hrv = priorByDate(input, 'hrv.ln_rmssd_night');
  const today = hrv.get(d);
  let hrvDown: boolean | null = null;
  if (today && today.value !== null) {
    const src = detailStr(today, 'sourceKey');
    const win = detailStr(today, 'window');
    const xs: number[] = [];
    for (const [date, r] of hrv)
      if (date < d && date >= from && r.value !== null && detailStr(r, 'sourceKey') === src && detailStr(r, 'window') === win) xs.push(r.value);
    if (xs.length >= CORR_MIN_BASELINE) hrvDown = today.value < mean(xs) - CORR_HRV_SD * sd(xs);
  }

  const rrToday = nightlyRespRate(input, d);
  const rrBase = base((x) => nightlyRespRate(input, x));
  const rrUp = rrToday !== null && rrBase.length >= CORR_MIN_BASELINE ? rrToday >= median(rrBase) + CORR_RR_UP : null;

  const wasoMap = priorByDate(input, 'sleep.waso');
  const wasoToday = wasoMap.get(d)?.value ?? null;
  const wasoBase = base((x) => wasoMap.get(x)?.value ?? null);
  const sptToday = spt(input, d);
  const sptBase = base((x) => spt(input, x));
  const off = (v: number | null, xs: number[]) => (v !== null && xs.length >= CORR_MIN_BASELINE && sd(xs) > 0 ? Math.abs(v - mean(xs)) > CORR_SLEEP_SD * sd(xs) : null);
  const w = off(wasoToday, wasoBase);
  const s = off(sptToday, sptBase);
  const sleepDisrupted = w === null && s === null ? null : w === true || s === true;

  return { temp_up: tempUp, hrv_down: hrvDown, rr_up: rrUp, sleep_disrupted: sleepDisrupted };
}

// ---------------------------------------------------------------- score

function computeNs(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const scope = nightScope(d);
  const rhr = priorByDate(input, RHR_ID);
  const todayR = rhr.get(d);
  const src = detailStr(todayR, 'sourceKey');
  if (!todayR || src === null || detailNum(todayR, 'ns_avg_bpm') === null)
    return withheld(NS_ID, NS_VERSION, input, 'no overnight (00:00–07:00) heart rate for this night', scope);
  const nights: Array<{ date: string; a: number }> = [];
  const ids: string[] = [];
  for (const [date, r] of rhr) {
    const a = detailNum(r, 'ns_avg_bpm');
    if (date > d || a === null || detailStr(r, 'sourceKey') !== src) continue;
    nights.push({ date, a });
    ids.push(...r.sourceIds);
  }
  nights.sort((x, y) => (x.date < y.date ? -1 : 1));
  if (nights.length < NS_MIN_NIGHTS)
    return makeResult(NS_ID, NS_VERSION, input, {
      scope,
      status: 'insufficient_baseline',
      value: null,
      reason: `NightSignal needs ≥${NS_MIN_NIGHTS} nights from one source (have ${nights.length})`,
      hashOf: nights,
    });
  const run = computeNightSignal(nights);
  const last = run[run.length - 1]!;
  const c = corroborators(input);
  const count = Object.values(c).filter((x) => x === true).length;
  // R9 §2.8 v2 levels (PROPOSED; the 2-consecutive-night rule for ≥3 corroborators needs yesterday, not evaluated here).
  const proposed = last.alert === 'red' || (last.alert === 'yellow' && c.temp_up === true) ? 'red' : last.alert === 'yellow' || count >= 2 ? 'amber' : 'green';
  return makeResult(NS_ID, NS_VERSION, input, {
    scope,
    status: 'ok',
    value: last.alert === 'red' ? 2 : last.alert === 'yellow' ? 1 : 0,
    state: last.alert,
    confidence: 'medium',
    sourceIds: [...new Set(ids)].sort(),
    hashOf: nights,
    contributors: [{ id: 'rhr_overnight', raw: last.a, unit: 'bpm', weightConfigured: 1, weightApplied: 1, available: true }],
    detail: {
      sourceKey: src,
      fsm: last.state,
      symbol: last.symbol,
      a_bpm: last.a,
      median_bpm: last.m,
      delta_bpm: last.a - last.m,
      imputed_today: last.imputed,
      nights: nights.length,
      corr_temp_up: c.temp_up,
      corr_hrv_down: c.hrv_down,
      corr_rr_up: c.rr_up,
      corr_sleep_disrupted: c.sleep_disrupted,
      corr_count: count,
      proposed_composite: proposed,
    },
  });
}

export const illnessDefs: ScoreDef[] = [
  {
    scoreId: NS_ID,
    title: 'Body under strain (NightSignal)',
    version: NS_VERSION,
    released: '2026-10-01',
    kind: 'flag',
    label: 'flag',
    inputs: [
      { stream: 'hr.rhr_night', window: 'all', minCount: NS_MIN_NIGHTS, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'temp.deviation', window: 'night', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'hrv.ln_rmssd_night', window: '60d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'resp_rate', window: '60d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: 'sleep.waso', window: '60d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    ],
    profileInputs: [],
    gates: ['ns_avg_bpm_tonight', `nights_same_source>=${NS_MIN_NIGHTS}`],
    formula: {
      fn: `${NS_ID}@${NS_VERSION}`,
      text: 'A = overnight (00–07 h, zero-step) mean HR, integer; M = int median of A over all nights so far; symbol a: A<M+3, b: A=M+3, c: A≥M+4. DFA S0–S5: S0 -b→ S1, -c→ S2; S1 -b→ S3, -c→ S4; S2 -b→ S3, -c→ S5; S3 -b→ S3, -c→ S4; S4 -b→ S3, -c→ S5; S5 -b→ S3, -c→ S5; a → S0 from all. S3/S4 yellow, S5 red.',
    },
    params: [
      { name: 'yellow_threshold', value: NS_YELLOW, unit: 'bpm', sourceRef: 'Alavi 2022 doi 10.1038/s41591-021-01593-2; nightsignal.py', kind: 'published' },
      { name: 'red_threshold', value: NS_RED, unit: 'bpm', sourceRef: 'Alavi 2022; nightsignal.py', kind: 'published' },
      { name: 'window_hours', value: 7, unit: 'h', sourceRef: 'Alavi 2022 Methods (24:00–7:00)', kind: 'published' },
      { name: 'min_nights', value: NS_MIN_NIGHTS, unit: 'nights', sourceRef: 'Alavi 2022 Methods', kind: 'published' },
      { name: 'corr_temp_up', value: CORR_TEMP_UP_C, unit: '°C', sourceRef: 'R9 §2.8 v2', kind: 'proposed' },
      { name: 'corr_hrv_down_sd', value: CORR_HRV_SD, unit: 'SD', sourceRef: 'R9 §2.8 v2', kind: 'proposed' },
      { name: 'corr_rr_up', value: CORR_RR_UP, unit: 'brpm', sourceRef: 'R9 §2.8 v2', kind: 'proposed' },
      { name: 'corr_sleep_sd', value: CORR_SLEEP_SD, unit: 'SD', sourceRef: 'R9 §2.8 v2', kind: 'proposed' },
      { name: 'corr_min_baseline', value: CORR_MIN_BASELINE, unit: 'nights', sourceRef: 'R9 §2.4 (≥14 baseline nights)', kind: 'engineering' },
    ],
    output: { unit: 'level', range: [0, 2], goodDirection: 'down', display: 'state' },
    uncertainty: { method: 'none', notes: 'Published operating point: sensitivity 80 %, nightly specificity 87.7 % (≈1 alert night in 8 in healthy people).' },
    evidence: {
      mechanism: { status: 'mapped', pathway: 'Infection and other stressors raise overnight RHR via sympathetic activation and fever', engineNodes: [] },
      certainty: 'B',
      refs: [{ topicSlug: 'performance-wellbeing-bone', refIds: ['Alavi22'] }],
    },
    tierHandling: 'All tiers (relative, within source, integer bpm). Tier C sparse HR still works because only the nightly average is used; corroborators follow their own tier rules.',
    planEffects: [
      { target: 'trainer_briefing', rule: 'Yellow → briefing "your body is under strain", ask about confounders (alcohol, late meal, travel, hard session, vaccination, luteal phase).', priority: 1 },
      { target: 'training_intensity', rule: 'Red → all training easy or rest.', priority: 1 },
      { target: 'fast_permission', rule: 'Red → pause or abort planned fasts; no new fast > 24 h.', priority: 1 },
      { target: 'replan_trigger', rule: 'Red → replan trigger.', priority: 1 },
    ],
    optInStreams: ['hr', 'sleep_sessions'],
    dependsOn: [RHR_ID, 'temp.deviation', 'hrv.ln_rmssd_night', 'sleep.waso'],
    compute: computeNs,
  },
];
