/**
 * Training load (R9 §2.7). Tier P.
 * load.trimp: minute-integrated Banister TRIMP. load.srpe: Foster session RPE. load.ewma: 7-d / 28-d EWMA per series.
 * sRPE and TRIMP are separate series and never summed. ACWR is context only: no plan effect.
 */
import type { LocalDate, ScoreDef, ScoreInput, ScoreParam, ScoreProfile, ScoreResult, WorkoutRecord } from '../types';
import { addDays, clamp, daysBetween, makeResult, median, withheld } from './util';
import { tanakaHrMax } from './vo2max';

export const TRIMP_ID = 'load.trimp';
export const SRPE_ID = 'load.srpe';
export const EWMA_ID = 'load.ewma';
export const LOAD_VERSION = '1.0.0';

/** Banister TRIMP coefficients k·e^{b f}: men 0.64 e^{1.92 f}, women 0.86 e^{1.67 f} (R9 §2.7; Android LocalInsightEngine.kt:283). */
export const TRIMP_COEF = { male: { k: 0.64, b: 1.92 }, female: { k: 0.86, b: 1.67 } } as const;
/** EWMA windows (Williams 2017): λ = 2/(N+1) with N 7 acute and 28 chronic. */
export const ACUTE_N = 7;
export const CHRONIC_N = 28;
/** Minimum history (days) before EWMA is shown (R9 §4.3 gate ≥ 28 d). */
export const EWMA_MIN_DAYS = 28;
/** Fraction of workout minutes needing an HR sample for the minute-integrated path. PROPOSED. */
const MIN_MINUTE_COVERAGE = 0.6;

export function lambdaOf(n: number): number {
  return 2 / (n + 1);
}

/** Banister increment for one minute at HR-reserve fraction f. */
export function trimpMinute(f: number, sex: 'male' | 'female'): number {
  const { k, b } = TRIMP_COEF[sex];
  const x = clamp(f, 0, 1);
  return x === 0 ? 0 : k * Math.exp(b * x) * x;
}

/** Minute-by-minute TRIMP from an HR series (epoch-ms samples): per-minute mean HR, f = (HR − rest)/(max − rest). */
export function trimpFromSeries(samples: Array<{ t: number; value: number }>, t0: number, t1: number, o: { hrRest: number; hrMax: number; sex: 'male' | 'female' }): { trimp: number; minutes: number; coverage: number } {
  const nMin = Math.max(1, Math.round((t1 - t0) / 60_000));
  const buckets = new Map<number, number[]>();
  for (const s of samples) {
    if (s.t < t0 || s.t >= t1 || !(s.value > 0)) continue;
    const m = Math.floor((s.t - t0) / 60_000);
    const arr = buckets.get(m);
    if (arr) arr.push(s.value);
    else buckets.set(m, [s.value]);
  }
  let trimp = 0;
  for (const arr of buckets.values()) {
    const hr = arr.reduce((a, b) => a + b, 0) / arr.length;
    trimp += trimpMinute((hr - o.hrRest) / (o.hrMax - o.hrRest), o.sex);
  }
  return { trimp, minutes: buckets.size, coverage: buckets.size / nMin };
}

function winOf(w: WorkoutRecord): { t0: number; t1: number } | null {
  if (!w.time.start) return null;
  const t0 = Date.parse(w.time.start);
  const t1 = w.time.end ? Date.parse(w.time.end) : t0 + w.active_duration_s * 1000;
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? { t0, t1 } : null;
}

function dayWorkouts(input: ScoreInput): WorkoutRecord[] {
  const m = new Map<string, WorkoutRecord>();
  for (const d of input.days) if (d.localDate === input.localDate) for (const w of d.workouts) m.set(w.record_id, w);
  for (const w of input.workouts) if (w.time.local_date === input.localDate) m.set(w.record_id, w);
  return [...m.values()].sort((a, b) => (a.time.start ?? '').localeCompare(b.time.start ?? ''));
}

function hrRestOf(input: ScoreInput): number | undefined {
  const xs: number[] = [];
  for (const d of input.days) if (d.localDate <= input.localDate && d.localDate >= addDays(input.localDate, -14) && d.daily?.resting_hr_bpm !== undefined) xs.push(d.daily.resting_hr_bpm);
  return xs.length ? median(xs) : input.profile.restingHrBpm;
}

function hrMaxOf(p: ScoreProfile): number | undefined {
  const pred = p.ageY !== undefined ? tanakaHrMax(p.ageY) : undefined;
  if (p.hrMaxObs !== undefined) return pred === undefined ? p.hrMaxObs : Math.max(p.hrMaxObs, pred);
  return pred;
}

// ---------------------------------------------------------------- load.trimp

function computeTrimp(input: ScoreInput): ScoreResult {
  const ws = dayWorkouts(input);
  const sex = input.profile.sex;
  const hrRest = hrRestOf(input);
  const hrMax = hrMaxOf(input.profile);
  if (!sex || hrRest === undefined || hrMax === undefined || hrMax <= hrRest) return withheld(TRIMP_ID, LOAD_VERSION, input, 'profile: sex, resting HR and HRmax (observed or age-predicted) required');
  if (!ws.length) return makeResult(TRIMP_ID, LOAD_VERSION, input, { status: 'ok', value: 0, confidence: 'high', hashOf: 'rest', detail: { nWorkouts: 0, nAvgHrFallback: 0 } });
  const hr = (input.series.hr ?? []).filter((s) => s.tier !== 'C');
  let total = 0;
  let nFallback = 0;
  let nUsed = 0;
  const contributors: ScoreResult['contributors'] = [];
  for (const w of ws) {
    const win = winOf(w);
    let v: number | null = null;
    let fb = false;
    if (win) {
      const r = trimpFromSeries(hr, win.t0, win.t1, { hrRest, hrMax, sex });
      if (r.coverage >= MIN_MINUTE_COVERAGE) v = r.trimp / r.coverage; // scale up the uncovered minutes
    }
    if (v === null && w.hr_avg_bpm !== undefined && (w.provenance.device?.tier ?? 'C') !== 'C') {
      // Average-HR fallback has a known nonlinearity bias for intervals (R9 §2.7): used, flagged, confidence lowered.
      v = (w.active_duration_s / 60) * trimpMinute((w.hr_avg_bpm - hrRest) / (hrMax - hrRest), sex);
      fb = true;
    }
    contributors.push({ id: w.record_id, raw: v ?? undefined, unit: 'AU', weightConfigured: 1, weightApplied: v === null ? 0 : 1, available: v !== null } as ScoreResult['contributors'][number]);
    if (v === null) continue;
    total += v;
    nUsed++;
    if (fb) nFallback++;
  }
  if (!nUsed) return withheld(TRIMP_ID, LOAD_VERSION, input, 'no_hr: workouts without tier A/B heart rate');
  return makeResult(TRIMP_ID, LOAD_VERSION, input, {
    status: 'ok',
    value: total,
    confidence: nFallback ? 'medium' : 'high',
    contributors,
    sourceIds: ws.map((w) => `${w.record_id}@${w.version}`),
    hashOf: { ws: ws.map((w) => [w.record_id, w.version]), hr: hr.filter((s) => ws.some((w) => { const x = winOf(w); return x && s.t >= x.t0 && s.t < x.t1; })).length, hrRest, hrMax, sex },
    detail: { nWorkouts: ws.length, nUsed, nAvgHrFallback: nFallback, hrRest, hrMax },
  });
}

// ---------------------------------------------------------------- load.srpe

/** Foster: CR10 RPE × minutes. */
export function srpeOf(w: WorkoutRecord): number | null {
  return w.rpe_0_10 === undefined ? null : w.rpe_0_10 * (w.active_duration_s / 60);
}

function computeSrpe(input: ScoreInput): ScoreResult {
  const ws = dayWorkouts(input);
  if (!ws.length) return makeResult(SRPE_ID, LOAD_VERSION, input, { status: 'ok', value: 0, confidence: 'high', hashOf: 'rest', detail: { nWorkouts: 0 } });
  const rated = ws.filter((w) => w.rpe_0_10 !== undefined);
  if (!rated.length) return withheld(SRPE_ID, LOAD_VERSION, input, 'no_rpe: no session RPE entered');
  const total = rated.reduce((s, w) => s + (srpeOf(w) ?? 0), 0);
  return makeResult(SRPE_ID, LOAD_VERSION, input, {
    status: 'ok',
    value: total,
    confidence: rated.length === ws.length ? 'high' : 'medium',
    contributors: rated.map((w) => ({ id: w.record_id, raw: srpeOf(w) ?? 0, unit: 'AU', weightConfigured: 1, weightApplied: 1, available: true })),
    sourceIds: rated.map((w) => `${w.record_id}@${w.version}`),
    hashOf: rated.map((w) => [w.record_id, w.version, w.rpe_0_10, w.active_duration_s]),
    detail: { nWorkouts: ws.length, nRated: rated.length },
  });
}

// ---------------------------------------------------------------- load.ewma

/** EWMA A_t = λ L_t + (1 − λ) A_{t−1} over calendar days (missing days are 0 load), seeded with the first value. */
export function ewmaSeries(loads: Array<{ date: LocalDate; value: number }>, endDate: LocalDate, n: number): { a: number; days: number } | null {
  if (!loads.length) return null;
  const byDate = new Map(loads.map((l) => [l.date, l.value]));
  const start = loads[0]!.date;
  const lam = lambdaOf(n);
  const days = daysBetween(start, endDate) + 1;
  if (days < 1) return null;
  let a = byDate.get(start) ?? 0;
  for (let i = 1; i < days; i++) a = lam * (byDate.get(addDays(start, i)) ?? 0) + (1 - lam) * a;
  return { a, days };
}

function seriesFrom(results: ScoreResult[] | undefined, endDate: LocalDate): Array<{ date: LocalDate; value: number }> {
  return (results ?? []).filter((r) => r.status === 'ok' && r.value !== null && r.scope.localDate <= endDate).map((r) => ({ date: r.scope.localDate, value: r.value! }));
}

function computeEwma(input: ScoreInput): ScoreResult {
  const trimp = seriesFrom(input.prior[TRIMP_ID], input.localDate);
  const srpe = seriesFrom(input.prior[SRPE_ID], input.localDate);
  const first = [...trimp, ...srpe].map((x) => x.date).sort()[0];
  if (!first) return withheld(EWMA_ID, LOAD_VERSION, input, 'no_load: no TRIMP or sRPE history');
  const span = daysBetween(first, input.localDate) + 1;
  if (span < EWMA_MIN_DAYS) {
    return makeResult(EWMA_ID, LOAD_VERSION, input, { status: 'insufficient_baseline', value: null, reason: `need ≥${EWMA_MIN_DAYS} days of load history, have ${span}`, hashOf: { span } });
  }
  const trimpDays = new Set(trimp.filter((x) => x.value > 0).map((x) => x.date)).size;
  const srpeDays = new Set(srpe.filter((x) => x.value > 0).map((x) => x.date)).size;
  const useTrimp = trimpDays >= srpeDays;
  const t7 = ewmaSeries(trimp, input.localDate, ACUTE_N);
  const t28 = ewmaSeries(trimp, input.localDate, CHRONIC_N);
  const s7 = ewmaSeries(srpe, input.localDate, ACUTE_N);
  const s28 = ewmaSeries(srpe, input.localDate, CHRONIC_N);
  const main7 = useTrimp ? t7 : s7;
  const main28 = useTrimp ? t28 : s28;
  if (!main7 || !main28) return withheld(EWMA_ID, LOAD_VERSION, input, 'no_load: series empty');
  const detail: NonNullable<ScoreResult['detail']> = {
    series: useTrimp ? 'trimp' : 'srpe',
    acute7: main7.a,
    chronic28: main28.a,
    // CONTEXT ONLY: Impellizzeri 2020 criticises ACWR (coupled, no predictive validity); never a plan input.
    acwrContextOnly: main28.a > 0 ? main7.a / main28.a : null,
    historyDays: span,
    trimpAcute7: t7?.a ?? null,
    trimpChronic28: t28?.a ?? null,
    srpeAcute7: s7?.a ?? null,
    srpeChronic28: s28?.a ?? null,
  };
  return makeResult(EWMA_ID, LOAD_VERSION, input, {
    status: 'ok',
    value: main7.a,
    confidence: span >= 42 ? 'high' : 'medium',
    contributors: [
      { id: 'acute7', raw: main7.a, unit: 'AU', weightConfigured: 1, weightApplied: 1, available: true },
      { id: 'chronic28', raw: main28.a, unit: 'AU', weightConfigured: 1, weightApplied: 1, available: true },
    ],
    sourceIds: [...(input.prior[TRIMP_ID] ?? []), ...(input.prior[SRPE_ID] ?? [])].filter((r) => r.scope.localDate <= input.localDate).map((r) => r.inputsHash).slice(-8),
    hashOf: { t: trimp, s: srpe },
    detail,
  });
}

// ---------------------------------------------------------------- defs

const trimpParams: ScoreParam[] = [
  { name: 'kMale', value: TRIMP_COEF.male.k, unit: '1', sourceRef: 'Banister; R9 §2.7; LocalInsightEngine.kt:283', kind: 'published' },
  { name: 'bMale', value: TRIMP_COEF.male.b, unit: '1', sourceRef: 'Banister; R9 §2.7', kind: 'published' },
  { name: 'kFemale', value: TRIMP_COEF.female.k, unit: '1', sourceRef: 'Banister; R9 §2.7', kind: 'published' },
  { name: 'bFemale', value: TRIMP_COEF.female.b, unit: '1', sourceRef: 'Banister; R9 §2.7', kind: 'published' },
  { name: 'minMinuteCoverage', value: MIN_MINUTE_COVERAGE, unit: 'fraction', sourceRef: 'PROPOSED', kind: 'proposed' },
];

const loadEvidence = (pathway: string, nodes: string[]): ScoreDef['evidence'] => ({
  mechanism: { status: 'mapped', pathway, engineNodes: nodes },
  certainty: 'B',
  indirectness: { population: 1, intervention: 0, outcome: 1 },
  refs: [{ topicSlug: 'cardio-activity-expenditure', refIds: ['Banister', 'Foster01', 'Williams17'] }],
});

export const loadDefs: ScoreDef[] = [
  {
    scoreId: TRIMP_ID,
    title: 'Training load (TRIMP)',
    version: LOAD_VERSION,
    released: '2026-10-01',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [
      { stream: 'hr', window: 'workout', minCoverage: MIN_MINUTE_COVERAGE, tiersAllowed: ['A', 'B'], sameSourceRequired: false },
      { stream: 'workouts', window: 'workout', tiersAllowed: ['A', 'B'], sameSourceRequired: false },
    ],
    profileInputs: ['sex', 'age', 'hrMaxObs'],
    gates: ['sex, resting HR, HRmax known', 'workout HR tier A/B (≥60 % of minutes; else flagged average-HR fallback)'],
    formula: { fn: `${TRIMP_ID}@${LOAD_VERSION}`, text: 'TRIMP = Σ_min f · k · e^{b f}, f = (HR − HRrest)/(HRmax − HRrest); men k 0.64 b 1.92, women k 0.86 b 1.67' },
    params: trimpParams,
    output: { unit: 'AU', range: [0, 2000], display: 'number' },
    uncertainty: { method: 'none', notes: 'Not banded; depends on HRmax and HRrest; average-HR fallback flagged.' },
    evidence: loadEvidence('HR as an index of metabolic rate; training dose', ['exSessionNetKcalD']),
    tierHandling: 'Tier A/B HR only; tier C (5-min) HR falls back to nothing.',
    planEffects: [{ target: 'engine_observation', rule: 'Training-dose observation for matched sessions.', priority: 5 }, { target: 'display_only', rule: 'Shown with A7/A28.', priority: 9 }],
    optInStreams: ['workouts', 'hr'],
    compute: computeTrimp,
  },
  {
    scoreId: SRPE_ID,
    title: 'Training load (session RPE)',
    version: LOAD_VERSION,
    released: '2026-10-01',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [{ stream: 'workouts', window: 'workout', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false }],
    profileInputs: [],
    gates: ['at least one workout with RPE'],
    formula: { fn: `${SRPE_ID}@${LOAD_VERSION}`, text: 'sRPE = CR10 RPE × session minutes (Foster 2001, PMID 11708692)' },
    params: [{ name: 'rpeScale', value: 10, unit: 'CR10', sourceRef: 'Foster 2001; PMID 11708692', kind: 'published' }],
    output: { unit: 'AU', range: [0, 2000], display: 'number' },
    uncertainty: { method: 'none', notes: 'Self-reported.' },
    evidence: loadEvidence('Perceived exertion × duration', ['exSessionNetKcalD']),
    tierHandling: 'Source-independent (self-reported).',
    planEffects: [{ target: 'engine_observation', rule: 'Training-dose observation for resistance and intervals.', priority: 5 }, { target: 'display_only', rule: 'Shown with A7/A28.', priority: 9 }],
    optInStreams: ['workouts'],
    compute: computeSrpe,
  },
  {
    scoreId: EWMA_ID,
    title: 'Load trend (7-day vs 28-day EWMA)',
    version: LOAD_VERSION,
    released: '2026-10-01',
    kind: 'derived_measurement',
    label: 'measurement',
    inputs: [{ stream: 'load', window: '90d', minCount: EWMA_MIN_DAYS, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false }],
    profileInputs: [],
    gates: [`≥${EWMA_MIN_DAYS} days of load history`],
    formula: { fn: `${EWMA_ID}@${LOAD_VERSION}`, text: 'A_t = λ·L_t + (1 − λ)·A_{t−1}, λ = 2/(N+1), N = 7 (acute) and 28 (chronic); ACWR is context only' },
    params: [
      { name: 'acuteN', value: ACUTE_N, unit: 'd', sourceRef: 'Williams 2017; R9 §2.7', kind: 'published' },
      { name: 'chronicN', value: CHRONIC_N, unit: 'd', sourceRef: 'Williams 2017; R9 §2.7', kind: 'published' },
      { name: 'weeklyVolumeCap', value: 0.1, unit: 'fraction/wk', sourceRef: 'PROPOSED engineering: volume progression ≤ chronic + 10 %/wk', kind: 'engineering' },
    ],
    output: { unit: 'AU', display: 'number' },
    uncertainty: { method: 'none', notes: 'Value is the acute EWMA of the main series; chronic and ACWR in detail.' },
    evidence: loadEvidence('Cumulative load smoothing', ['exSessionNetKcalD']),
    tierHandling: 'Inherits from load.trimp / load.srpe; the two series are kept separate.',
    planEffects: [
      { target: 'training_volume', rule: 'PROPOSED engineering: weekly volume progression capped at chronic EWMA + 10 %/wk. ACWR itself has no plan effect.', priority: 8 },
      { target: 'trainer_briefing', rule: 'A7 and A28 in the briefing.', priority: 9 },
    ],
    optInStreams: ['workouts', 'hr'],
    dependsOn: [TRIMP_ID, SRPE_ID],
    compute: computeEwma,
  },
];
