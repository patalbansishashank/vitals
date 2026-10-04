/**
 * fitness.vo2max (R9 §2.6; SUITE_SPEC §4.4). Tier P.
 * Latent VO2max state with a 1-D Kalman filter: non-exercise prior (Jackson 1990), then measurements from HR-reserve
 * speed segments, Cooper field tests, the Uth HR ratio and entered lab/field tests. Vendor estimates are display-only.
 * The filter runs in absolute L/min (mass tracked, R9 "track L/min internally"); display is ml/kg/min at the day's mass.
 */
import type { DailyRecord, LocalDate, ProfileInputName, ResolvedDay, ScoreDef, ScoreInput, ScoreParam, ScoreProfile, ScoreResult, WorkoutRecord } from '../types';
import { addDays, clamp, daysBetween, makeResult, median, withheld } from './util';

export const VO2_ID = 'fitness.vo2max';
export const VO2_VERSION = '1.0.0';

// ---------------------------------------------------------------- constants

/** Jackson 1990 non-exercise SEE (R9 §2.6; dossier 10 §4.8A; PMID 2287267). */
export const PRIOR_SD = 5.7;
/** Uth 2004 (PMID 14624296): factor 15.3 (±0.7); SEE 2.7 with measured HRmax, 4.7 with age-predicted. */
export const UTH_FACTOR = 15.3;
export const UTH_SD_MEASURED_HRMAX = 2.7;
export const UTH_SD_PREDICTED_HRMAX = 4.7;
/** HRmax uncertainty (bpm): Tanaka SD ≈ 10 (R9 §2.6 step 5); observed-max SD 5 is PROPOSED. */
export const HRMAX_SD_PREDICTED = 10;
export const HRMAX_SD_OBSERVED = 5;
/** Vendor HR-speed MAPE ≈ 5 % (R9 §2.6 table). */
export const SEGMENT_REL_SD = 0.05;
/** Lab value ~3–5 % (R9 table; 3 % taken, floor 1 ml/kg/min PROPOSED). Field-test SEE ≈ 5 (UNVERIFIED, R9). */
export const LAB_REL_SD = 0.03;
export const LAB_SD_FLOOR = 1;
export const FIELD_TEST_SD = 5;
/** Process noise: slow-pool τ 60 d (dossier 10 §4.8C) with a typical 60-d change SD of 2 ml/kg/min (≈ Milanovic 2015
 * +4.9 over 12 wk, halved) gives q = σ²/τ per day. PROPOSED. */
export const SLOW_TAU_D = 60;
export const TYPICAL_CHANGE_SD = 2;
export const PROCESS_VAR_PER_DAY = (TYPICAL_CHANGE_SD * TYPICAL_CHANGE_SD) / SLOW_TAU_D;
/** Innovation gate (z) for non-test measurements, so one hot or hilly run cannot jump the state. PROPOSED. */
export const INNOVATION_GATE_Z = 3;
/** Segment rules (R9 §2.6 steps 1): ≥3 min after a 2-min warm-up, HR slope < 2 bpm/min, f in [0.50, 0.90]. */
export const SEG_MIN_S = 180;
export const SEG_WARMUP_S = 120;
export const SEG_MAX_HR_SLOPE = 2;
export const SEG_F_RANGE: [number, number] = [0.5, 0.9];
/** Uth needs ≥14 nights of RHR (R9) and is applied at most once per 28 days (correlated errors; PROPOSED). */
export const UTH_MIN_RHR_NIGHTS = 14;
export const UTH_PERIOD_D = 28;
const UTH_EPOCH = '2020-01-06';
const REF_MASS_KG = 70;
const Z80 = 1.2816;
const Z95 = 1.96;

export type Vo2Method = 'prior' | 'hr_reserve' | 'cooper' | 'uth_ratio' | 'lab' | 'field_test';

// ---------------------------------------------------------------- pure estimators

/** Jackson 1990 (PMID 2287267): 56.363 + 1.921 PA-R − 0.381 age − 0.754 BMI + 10.987 sex(M=1). ml/kg/min. */
export function jacksonPrior(p: { ageY: number; sex: 'male' | 'female'; massKg: number; heightCm: number; paRating: number }): number {
  const bmi = p.massKg / (p.heightCm / 100) ** 2;
  return 56.363 + 1.921 * clamp(p.paRating, 0, 7) - 0.381 * p.ageY - 0.754 * bmi + 10.987 * (p.sex === 'male' ? 1 : 0);
}

/** Tanaka 2001 HRmax = 208 − 0.7·age (R9 §2.6 step 5). */
export function tanakaHrMax(ageY: number): number {
  return 208 - 0.7 * ageY;
}

/** Uth 2004: 15.3 · HRmax / HRrest (ml/kg/min). */
export function uthVo2(hrMax: number, hrRest: number): number {
  return (UTH_FACTOR * hrMax) / hrRest;
}

/** Cooper 12-min run, d in metres (R9 §2.6): (d − 504.9)/44.73. */
export function cooperVo2(distanceM: number): number {
  return (distanceM - 504.9) / 44.73;
}

/** ACSM steady-state cost, ml/kg/min. S in m/min, G fraction (R9 §2.6 step 2). */
export function acsmVo2(mode: 'run' | 'walk', speedMPerMin: number, grade = 0): number {
  return mode === 'run' ? 0.2 * speedMPerMin + 0.9 * speedMPerMin * grade + 3.5 : 0.1 * speedMPerMin + 1.8 * speedMPerMin * grade + 3.5;
}

/** Speed ranges where each ACSM equation is valid (ACSM Guidelines; ENGINEERING bounds). */
const SPEED_RANGE: Record<'run' | 'walk', [number, number]> = { run: [120, 400], walk: [40, 110] };

export interface SegmentEstimate {
  /** ml/kg/min. */
  vo2max: number;
  sd: number;
  f: number;
  weight: number;
}

/** One steady segment → VO2max via %HRR ≈ %VO2R (Swain & Leutholtz 1997, via R9 §2.6 step 3). Null when ineligible. */
export function hrReserveSegment(a: {
  mode: 'run' | 'walk';
  speedMPerMin: number;
  grade?: number;
  hr: number;
  hrRest: number;
  hrMax: number;
  hrMaxSd: number;
  /** seconds of steady data */
  durationS: number;
  speedCv?: number;
  wearQuality?: number;
}): SegmentEstimate | null {
  const [lo, hi] = SPEED_RANGE[a.mode];
  if (a.speedMPerMin < lo || a.speedMPerMin > hi) return null;
  if (a.durationS < SEG_MIN_S || a.hrMax <= a.hrRest) return null;
  const f = (a.hr - a.hrRest) / (a.hrMax - a.hrRest);
  if (f < SEG_F_RANGE[0] || f > SEG_F_RANGE[1]) return null;
  const vo2 = acsmVo2(a.mode, a.speedMPerMin, a.grade ?? 0);
  const vo2max = 3.5 + (vo2 - 3.5) / f;
  // Propagate σ_HRmax through f: dV/dHRmax = (V − 3.5)/(HRmax − HRrest); add the vendor-grade 5 % base error.
  const hrmaxTerm = ((vo2max - 3.5) * a.hrMaxSd) / (a.hrMax - a.hrRest);
  const base = SEGMENT_REL_SD * vo2max;
  return { vo2max, sd: Math.hypot(hrmaxTerm, base), f, weight: a.durationS * (1 - clamp(a.speedCv ?? 0, 0, 1)) * (a.wearQuality ?? 1) };
}

/** Reliability-weighted median of segment estimates (R9 §2.6 step 4). */
export function weightedMedian(xs: Array<{ v: number; w: number }>): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q) => p.v - q.v);
  const total = a.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of a) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return a[a.length - 1]!.v;
}

// ---------------------------------------------------------------- Kalman filter

export interface Vo2Measurement {
  localDate: LocalDate;
  method: Exclude<Vo2Method, 'prior'>;
  /** ml/kg/min at `massKg`. */
  valueMlKgMin: number;
  sdMlKgMin: number;
  /** Body mass when measured (kg); default 70 (cancels when no mass is known anywhere). */
  massKg?: number;
  /** Tests dominate: exempt from the innovation gate. */
  isTest?: boolean;
}

export interface Vo2Posterior {
  /** ml/kg/min at massAsOfKg. */
  mean: number;
  sd: number;
  /** Absolute L/min mean and SD. */
  meanLMin: number;
  sdLMin: number;
  nUpdates: number;
  nRejected: number;
  methodsUsed: Vo2Method[];
  lastUpdate: LocalDate | null;
}

/** Pure sequential Gaussian update with random-walk process noise between days. Measurements may arrive unsorted. */
export function vo2Posterior(a: {
  prior: { meanMlKgMin: number; sdMlKgMin: number; localDate: LocalDate; massKg?: number } | null;
  measurements: Vo2Measurement[];
  asOf: LocalDate;
  massAsOfKg?: number;
  processVarPerDay?: number;
}): Vo2Posterior | null {
  const q = a.processVarPerDay ?? PROCESS_VAR_PER_DAY;
  const ms = a.measurements.filter((m) => m.localDate <= a.asOf).sort((x, y) => (x.localDate < y.localDate ? -1 : x.localDate > y.localDate ? 1 : 0));
  let x: number;
  let P: number;
  let t: LocalDate;
  const methods = new Set<Vo2Method>();
  let start = 0;
  if (a.prior) {
    const m = a.prior.massKg ?? REF_MASS_KG;
    x = (a.prior.meanMlKgMin * m) / 1000;
    P = ((a.prior.sdMlKgMin * m) / 1000) ** 2;
    t = a.prior.localDate;
    methods.add('prior');
  } else {
    const first = ms[0];
    if (!first) return null;
    const m = first.massKg ?? REF_MASS_KG;
    x = (first.valueMlKgMin * m) / 1000;
    P = ((first.sdMlKgMin * m) / 1000) ** 2;
    t = first.localDate;
    methods.add(first.method);
    start = 1;
  }
  const priorSdL = a.prior ? Math.sqrt(P) : Infinity;
  let n = a.prior ? 0 : 1;
  let rejected = 0;
  let last: LocalDate | null = a.prior ? null : t;
  for (let i = start; i < ms.length; i++) {
    const m = ms[i]!;
    const mass = m.massKg ?? REF_MASS_KG;
    const dt = Math.max(0, daysBetween(t, m.localDate));
    // Process noise scales with mass² (the filter state is absolute L/min).
    P = Math.min(P + q * dt * (mass / 1000) ** 2, priorSdL ** 2);
    t = m.localDate > t ? m.localDate : t;
    const z = (m.valueMlKgMin * mass) / 1000;
    const R = ((m.sdMlKgMin * mass) / 1000) ** 2;
    const S = P + R;
    if (!m.isTest && Math.abs(z - x) > INNOVATION_GATE_Z * Math.sqrt(S)) {
      rejected++;
      continue;
    }
    const K = P / S;
    x += K * (z - x);
    P = (1 - K) * P;
    n++;
    last = m.localDate;
    methods.add(m.method);
  }
  const dt = Math.max(0, daysBetween(t, a.asOf));
  const mAsOf = a.massAsOfKg ?? ms.at(-1)?.massKg ?? a.prior?.massKg ?? REF_MASS_KG;
  P = Math.min(P + q * dt * (mAsOf / 1000) ** 2, priorSdL ** 2);
  return {
    mean: (x * 1000) / mAsOf,
    sd: (Math.sqrt(P) * 1000) / mAsOf,
    meanLMin: x,
    sdLMin: Math.sqrt(P),
    nUpdates: n,
    nRejected: rejected,
    methodsUsed: [...methods],
    lastUpdate: last,
  };
}

// ---------------------------------------------------------------- measurement extraction (from ScoreInput)

function hrMaxFor(profile: ScoreProfile): { hrMax: number; sd: number; observed: boolean } | null {
  const pred = profile.ageY !== undefined ? tanakaHrMax(profile.ageY) : undefined;
  if (profile.hrMaxObs !== undefined && (pred === undefined || profile.hrMaxObs > pred)) return { hrMax: profile.hrMaxObs, sd: HRMAX_SD_OBSERVED, observed: true };
  return pred === undefined ? null : { hrMax: pred, sd: HRMAX_SD_PREDICTED, observed: false };
}

/** Median resting HR over up to `n` nights ending at `date` (inclusive), with count. */
function rhrMedian(days: ResolvedDay[], date: LocalDate, n = 14): { value: number; nights: number } | null {
  const xs: number[] = [];
  for (let i = days.length - 1; i >= 0 && xs.length < n; i--) {
    const d = days[i]!;
    if (d.localDate > date) continue;
    if (d.localDate < addDays(date, -(n + 7))) break;
    const v = d.daily?.resting_hr_bpm;
    if (v !== undefined) xs.push(v);
  }
  return xs.length ? { value: median(xs), nights: xs.length } : null;
}

function massOn(days: ResolvedDay[], date: LocalDate, profile: ScoreProfile): number | undefined {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (d.localDate > date) continue;
    const s = d.spots.filter((x) => x.metric === 'weight_kg').at(-1);
    if (s) return s.value;
    if (date.localeCompare(addDays(d.localDate, 30)) > 0) break;
  }
  return profile.massKg;
}

function workoutMode(type: string): 'run' | 'walk' | null {
  const t = type.toLowerCase();
  if (t.includes('run') || t.includes('jog')) return 'run';
  if (t.includes('walk') || t.includes('hik')) return 'walk';
  return null;
}

function workoutWindow(w: WorkoutRecord): { t0: number; t1: number } | null {
  if (!w.time.start) return null;
  const t0 = Date.parse(w.time.start);
  const t1 = w.time.end ? Date.parse(w.time.end) : t0 + w.active_duration_s * 1000;
  return Number.isFinite(t0) && Number.isFinite(t1) ? { t0, t1 } : null;
}

/** Least-squares slope (bpm/min) of HR samples. */
function slopePerMin(s: Array<{ t: number; value: number }>): number {
  const n = s.length;
  if (n < 3) return 0;
  const t0 = s[0]!.t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of s) {
    const x = (p.t - t0) / 60_000;
    sx += x; sy += p.value; sxx += x * x; sxy += x * p.value;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

type HrSample = { t: number; value: number; tier: string };

/** One workout → measurement or null. Series HR (tier A/B, dense) preferred; session average HR falls back at 1.5× SD. */
export function workoutMeasurement(w: WorkoutRecord, hr: HrSample[], ctx: { hrRest: number; hrMax: number; hrMaxSd: number; massKg?: number }): Vo2Measurement | null {
  const mode = workoutMode(w.exercise_type);
  const win = workoutWindow(w);
  if (!mode || !win || !w.distance_m || w.active_duration_s < SEG_WARMUP_S + SEG_MIN_S) return null;
  const speed = w.distance_m / (w.active_duration_s / 60);
  const wear = clamp((w.percent_recorded ?? 100) / 100, 0, 1);
  const inWin = hr.filter((s) => s.t >= win.t0 + SEG_WARMUP_S * 1000 && s.t <= win.t1 && s.value > 0 && s.tier !== 'C');
  const dense = inWin.length >= 6 && median(inWin.slice(1).map((s, i) => (s.t - inWin[i]!.t) / 1000)) <= 30;
  let avgHr: number;
  let inflate = 1;
  let durS = w.active_duration_s - SEG_WARMUP_S;
  if (dense) {
    if (Math.abs(slopePerMin(inWin)) >= SEG_MAX_HR_SLOPE) return null;
    avgHr = inWin.reduce((s, p) => s + p.value, 0) / inWin.length;
    durS = Math.min(durS, (inWin.at(-1)!.t - inWin[0]!.t) / 1000);
  } else if (w.hr_avg_bpm !== undefined && (w.provenance.device?.tier ?? 'C') !== 'C') {
    avgHr = w.hr_avg_bpm;
    inflate = 1.5;
  } else return null;
  const seg = hrReserveSegment({ mode, speedMPerMin: speed, hr: avgHr, hrRest: ctx.hrRest, hrMax: ctx.hrMax, hrMaxSd: ctx.hrMaxSd, durationS: durS, wearQuality: wear });
  if (!seg) return null;
  return { localDate: w.time.local_date, method: 'hr_reserve', valueMlKgMin: seg.vo2max, sdMlKgMin: seg.sd * inflate, ...(ctx.massKg !== undefined ? { massKg: ctx.massKg } : {}) };
}

function testMeasurement(d: DailyRecord, massKg?: number): Vo2Measurement | null {
  const v = d.vo2max;
  if (!v || (v.method !== 'lab' && v.method !== 'field_test')) return null; // vendor_estimate / derived: display only
  const sd = v.method === 'lab' ? Math.max(LAB_SD_FLOOR, LAB_REL_SD * v.ml_kg_min) : FIELD_TEST_SD;
  return { localDate: d.time.local_date, method: v.method, valueMlKgMin: v.ml_kg_min, sdMlKgMin: sd, isTest: true, ...(massKg !== undefined ? { massKg } : {}) };
}

function allWorkouts(input: ScoreInput): WorkoutRecord[] {
  const seen = new Map<string, WorkoutRecord>();
  for (const d of input.days) for (const w of d.workouts) seen.set(w.record_id, w);
  for (const w of input.workouts) seen.set(w.record_id, w);
  return [...seen.values()].filter((w) => w.time.local_date <= input.localDate);
}

export function collectMeasurements(input: ScoreInput): { measurements: Vo2Measurement[]; vendorEstimate: number | null } {
  const { days, profile } = input;
  const out: Vo2Measurement[] = [];
  const hrMax = hrMaxFor(profile);
  let vendorEstimate: number | null = null;
  for (const d of days) {
    if (d.daily?.vo2max?.method === 'vendor_estimate') vendorEstimate = d.daily.vo2max.ml_kg_min;
    if (d.daily) {
      const t = testMeasurement(d.daily, massOn(days, d.localDate, profile));
      if (t) out.push(t);
    }
  }
  const hr = input.series.hr ?? [];
  // HR-reserve segments: at most one session per day (the best-weighted), errors are correlated through HRmax.
  const byDay = new Map<string, Vo2Measurement>();
  if (hrMax) {
    for (const w of allWorkouts(input)) {
      if (w.exercise_type.toLowerCase() === 'cooper_test' && w.distance_m && Math.abs(w.active_duration_s - 720) <= 30) {
        out.push({ localDate: w.time.local_date, method: 'cooper', valueMlKgMin: cooperVo2(w.distance_m), sdMlKgMin: FIELD_TEST_SD, isTest: true, ...optMass(massOn(days, w.time.local_date, profile)) });
        continue;
      }
      const rest = rhrMedian(days, w.time.local_date) ?? (profile.restingHrBpm !== undefined ? { value: profile.restingHrBpm, nights: 0 } : null);
      if (!rest) continue;
      const m = workoutMeasurement(w, hr, { hrRest: rest.value, hrMax: hrMax.hrMax, hrMaxSd: hrMax.sd, ...optMass(massOn(days, w.time.local_date, profile)) });
      if (!m) continue;
      const cur = byDay.get(m.localDate);
      if (!cur || m.sdMlKgMin < cur.sdMlKgMin) byDay.set(m.localDate, m);
    }
    out.push(...byDay.values());
    // Uth ratio, once per 28-day window anchored to a fixed epoch so replays are deterministic.
    for (const d of days) {
      if (daysBetween(UTH_EPOCH, d.localDate) % UTH_PERIOD_D !== 0) continue;
      const rest = rhrMedian(days, d.localDate);
      if (!rest || rest.nights < UTH_MIN_RHR_NIGHTS) continue;
      out.push({
        localDate: d.localDate,
        method: 'uth_ratio',
        valueMlKgMin: uthVo2(hrMax.hrMax, rest.value),
        sdMlKgMin: hrMax.observed ? UTH_SD_MEASURED_HRMAX : UTH_SD_PREDICTED_HRMAX,
        ...optMass(massOn(days, d.localDate, profile)),
      });
    }
  }
  return { measurements: out, vendorEstimate };
}
function optMass(m: number | undefined): { massKg?: number } {
  return m === undefined ? {} : { massKg: m };
}

// ---------------------------------------------------------------- the def

const params: ScoreParam[] = [
  { name: 'priorSd', value: PRIOR_SD, unit: 'ml/kg/min', sourceRef: 'Jackson 1990 SEE; R9 §2.6; PMID 2287267', kind: 'published' },
  { name: 'uthFactor', value: UTH_FACTOR, unit: 'ml/kg/min', sourceRef: 'Uth 2004; PMID 14624296', kind: 'published' },
  { name: 'uthSdMeasuredHrmax', value: UTH_SD_MEASURED_HRMAX, unit: 'ml/kg/min', sourceRef: 'Uth 2004 SEE (46 trained men)', kind: 'published' },
  { name: 'uthSdPredictedHrmax', value: UTH_SD_PREDICTED_HRMAX, unit: 'ml/kg/min', sourceRef: 'Uth 2004 SEE with age-predicted HRmax', kind: 'published' },
  { name: 'hrmaxSdPredicted', value: HRMAX_SD_PREDICTED, unit: 'bpm', sourceRef: 'Tanaka 2001 SD ≈ 10; R9 §2.6', kind: 'published' },
  { name: 'hrmaxSdObserved', value: HRMAX_SD_OBSERVED, unit: 'bpm', sourceRef: 'PROPOSED', kind: 'proposed' },
  { name: 'segmentRelSd', value: SEGMENT_REL_SD, unit: 'fraction', sourceRef: 'Firstbeat-style MAPE ≈ 5 %; R9 §2.6', kind: 'published' },
  { name: 'labRelSd', value: LAB_REL_SD, unit: 'fraction', sourceRef: 'R9 §2.6 (3–5 %)', kind: 'published' },
  { name: 'fieldTestSd', value: FIELD_TEST_SD, unit: 'ml/kg/min', sourceRef: 'R9 §2.6 (UNVERIFIED)', kind: 'proposed' },
  { name: 'processVarPerDay', value: PROCESS_VAR_PER_DAY, unit: '(ml/kg/min)²/d', sourceRef: 'σ²/τ with τ_slow 60 d (dossier 10 §4.8C) and σ 2; PROPOSED', kind: 'proposed' },
  { name: 'innovationGateZ', value: INNOVATION_GATE_Z, unit: 'σ', sourceRef: 'PROPOSED: a hot or hilly run cannot jump the state', kind: 'proposed' },
  { name: 'segmentMinDuration', value: SEG_MIN_S, unit: 's', sourceRef: 'R9 §2.6 step 1', kind: 'published' },
  { name: 'segmentFMin', value: SEG_F_RANGE[0], unit: 'HRR fraction', sourceRef: 'R9 §2.6 step 1', kind: 'published' },
  { name: 'segmentFMax', value: SEG_F_RANGE[1], unit: 'HRR fraction', sourceRef: 'R9 §2.6 step 1', kind: 'published' },
  { name: 'uthPeriod', value: UTH_PERIOD_D, unit: 'd', sourceRef: 'PROPOSED: correlated errors, apply at most monthly', kind: 'proposed' },
];

function compute(input: ScoreInput): ScoreResult {
  const { profile } = input;
  const { measurements, vendorEstimate } = collectMeasurements(input);
  const first = input.days[0]?.localDate ?? input.localDate;
  const mass = massOn(input.days, input.localDate, profile);
  let prior: { meanMlKgMin: number; sdMlKgMin: number; localDate: LocalDate; massKg?: number } | null = null;
  if (profile.ageY !== undefined && profile.sex && profile.massKg !== undefined && profile.heightCm !== undefined && profile.paRating !== undefined) {
    prior = {
      meanMlKgMin: jacksonPrior({ ageY: profile.ageY, sex: profile.sex, massKg: profile.massKg, heightCm: profile.heightCm, paRating: profile.paRating }),
      sdMlKgMin: PRIOR_SD,
      localDate: first,
      massKg: profile.massKg,
    };
  }
  const post = vo2Posterior({ prior, measurements, asOf: input.localDate, ...(mass !== undefined ? { massAsOfKg: mass } : {}) });
  if (!post) return withheld(VO2_ID, VO2_VERSION, input, 'no_method: need age, sex, height, mass and PA-R for the prior, or a test/segment/RHR measurement');
  const bandOf = (z: number) => ({ lo: post.mean - z * post.sd, hi: post.mean + z * post.sd });
  const b80 = bandOf(Z80);
  const b95 = bandOf(Z95);
  const onlyPrior = post.nUpdates === 0;
  const confidence = onlyPrior || post.sd > 4 ? 'low' : post.sd > 2.5 ? 'medium' : 'high';
  return makeResult(VO2_ID, VO2_VERSION, input, {
    status: 'ok',
    value: post.mean,
    band: { ...b80, level: 0.8 },
    confidence,
    contributors: post.methodsUsed.map((m) => ({ id: m, weightConfigured: 1, weightApplied: 1, available: true })),
    hashOf: { prior, ms: measurements, mass: mass ?? null },
    detail: {
      posteriorSd: post.sd,
      nUpdates: post.nUpdates,
      nRejected: post.nRejected,
      methodsUsed: post.methodsUsed.join(','),
      band95Lo: b95.lo,
      band95Hi: b95.hi,
      meanLMin: post.meanLMin,
      lastUpdate: post.lastUpdate,
      massTracked: mass !== undefined,
      // Display only, never an input (SUITE_SPEC §4.4 vendor opinion).
      vendorEstimateMlKgMin: vendorEstimate,
    },
  });
}

const profileInputs: ProfileInputName[] = ['age', 'sex', 'massKg', 'hrMaxObs'];

export const vo2maxDefs: ScoreDef[] = [
  {
    scoreId: VO2_ID,
    title: 'VO2max (Bayesian estimate)',
    version: VO2_VERSION,
    released: '2026-10-01',
    kind: 'estimate',
    label: 'estimate',
    inputs: [
      { stream: 'hr', window: 'workout', minCoverage: 0.6, tiersAllowed: ['A', 'B'], sameSourceRequired: false },
      { stream: 'workouts', window: '90d', tiersAllowed: ['A', 'B'], sameSourceRequired: false },
      { stream: 'resting_hr_bpm', window: '14d', minCount: UTH_MIN_RHR_NIGHTS, tiersAllowed: ['A', 'B'], sameSourceRequired: false },
      { stream: 'vo2max_tests', window: 'all', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    ],
    profileInputs,
    gates: ['at_least_one_method: prior (age, sex, height, mass, PA-R) or a test / HR-speed segment / Uth ratio', 'vendor_estimate never an input'],
    formula: {
      fn: `${VO2_ID}@${VO2_VERSION}`,
      text: 'Kalman filter on VO2max (L/min): prior Jackson 1990 (SD 5.7); updates from HR-reserve segments VO2max = 3.5 + (ACSM VO2 − 3.5)/f, Cooper (d − 504.9)/44.73, Uth 15.3·HRmax/HRrest, entered lab/field tests; random-walk process noise between days.',
    },
    params,
    output: { unit: 'ml/kg/min', range: [10, 90], goodDirection: 'up', display: 'band' },
    uncertainty: { method: 'propagated', notes: 'Posterior SD from the Kalman filter; HRmax error propagated through the HRR fraction; band 80 % (95 % in detail).' },
    evidence: {
      mechanism: { status: 'modelled', pathway: 'VO2max state observation (dossier 10 §4.8); HR as an index of metabolic rate (Fick)', engineNodes: ['vo2maxMlKgMin'] },
      certainty: 'C',
      indirectness: { population: 1, intervention: 0, outcome: 1 },
      refs: [{ topicSlug: 'cardio-activity-expenditure', refIds: ['Jackson90', 'Peterman20', 'Uth04'] }],
    },
    tierHandling: 'HR segments need tier A/B HR at ≤30 s sampling (never ring-only 5-min HR); Uth needs ≥14 nights RHR; tests any tier.',
    planEffects: [
      { target: 'engine_observation', rule: 'Posterior mean with SD as an observation of the VO2max state; vendor estimates excluded.', priority: 3 },
      { target: 'training_intensity', rule: 'Cardio intensity prescriptions use the posterior (via the engine VO2max state).', priority: 4 },
    ],
    optInStreams: ['workouts', 'hr', 'daily_summary'],
    compute,
  },
];
