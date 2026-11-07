/**
 * Shared types of the Vitals sensor algorithms (energy SPEC §V2 and Addendum A.1.2, 2026-10-27). Everything under
 * `src/living/sensors` is pure, versioned and node-tested: inputs in, values out, no clock, no storage, no network.
 *
 * Conventions (SPEC §1):
 *  - time is UTC epoch milliseconds on half-open intervals `[start, end)`; local days are given by the caller as their
 *    UTC bounds, so a 23- or 25-hour DST day keeps its observed length;
 *  - unknown is never zero: a null stays null, and every figure carries a status word (`SensorStatus`);
 *  - ranges carry `uncertaintyKind`; launch envelopes are product scenarios, never confidence intervals (§1.5);
 *  - every derived quantity carries a version string (§1.6, A intro), listed in `SENSOR_VERSIONS`.
 *
 * Warrant labels follow vitals-research/2026-10-18/BRIEF.md and energy/RESEARCH.md "Binding warrant framework": every
 * tunable number used here is in `SENSOR_PARAMS` with its warrant types (W1-W17), a confidence grade within those warrants
 * and its source. Product defaults with no research value are `product: true` ((P) in the SPEC): engineering or product
 * choices, confidence C, tunable.
 */

/** Status words that travel beside every number (SPEC §1.2). */
export type SensorStatus = 'confirmedZero' | 'observed' | 'unknown' | 'unavailable' | 'stale' | 'inferred' | 'attested';

/** What kind of range a band is (SPEC §1.5). */
export type UncertaintyKind = 'scenario' | 'predictionInterval' | 'measurementUncertainty' | 'unknown';

export interface Envelope {
  lo: number;
  hi: number;
}

/** UTC epoch milliseconds. */
export type Ms = number;

/** A half-open UTC interval `[start, end)`. */
export interface Interval {
  start: Ms;
  end: Ms;
}

/**
 * One supported heart-rate value: the output of the server's `hr-support/1` (S2 `hrSupport.ts`). Each sample owns the
 * disjoint interval it supports (already clipped at neighbour midpoints, pauses and the window; gaps never bridged). V2
 * never re-derives support: it reads these intervals, and only their union is time.
 */
export interface HrSegment {
  start: Ms;
  end: Ms;
  bpm: number;
}

/** Physiological coefficient set of a population equation (Keytel, Banister). Null = not known: such equations are unavailable. */
export type CoefficientSex = 'male' | 'female' | null;

/** WHO 2020 class of a bout (engine `HealthIntensityClass`). */
export type IntensityClass = 'light' | 'moderate' | 'vigorous' | 'unknown';

/** Versions of every quantity V2 derives (SPEC §1.6 and the Addendum A version list). They enter the realised-history hash (§V3). */
export const SENSOR_VERSIONS = {
  hrProfile: 'hr-profile/1',
  hrZones: 'hr-zones/1',
  heartPoints: 'fit-points/1',
  activityEnergy: 'act-energy/1',
  keytel: 'keytel-2005/1',
  powerEfficiency: 'power-eff/1',
  detect: 'detect/1',
  energyDay: 'energy-day/1',
  sleepNight: 'sleep-night/1',
  sleepIndex: 'sleep-index/5',
  recoveryIndex: 'recovery-index/6',
  activityIndex: 'activity-index/4',
  dayIndex: 'day-index/1',
  trainingLoad: 'train-load/1',
  projectActivity: 'project-activity/1',
} as const;

export type SensorVersion = (typeof SENSOR_VERSIONS)[keyof typeof SENSOR_VERSIONS];

/** Warrant ids of RESEARCH.md (W1 empirical-formal … W17 time-tested). */
export type WarrantId = `W${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17}`;

/** One labelled parameter of the sensor algorithms. */
export interface SensorParam {
  value: number;
  unit: string;
  warrants: readonly WarrantId[];
  /** A strong within the stated warrant and boundary, B useful with limits, C provisional (RESEARCH confidence scale). */
  confidence: 'A' | 'B' | 'C';
  /** A product default with no research value ((P) in the SPEC). */
  product: boolean;
  source: string;
}

const P = (value: number, unit: string, source: string): SensorParam => ({ value, unit, warrants: ['W8'], confidence: 'C', product: true, source });
const R = (value: number, unit: string, warrants: readonly WarrantId[], confidence: SensorParam['confidence'], source: string): SensorParam => ({ value, unit, warrants, confidence, product: false, source });

/**
 * Every number the sensor algorithms use, with its warrant (BRIEF.md framework; RESEARCH section ids). Product defaults
 * (`product: true`) are functionally motivated engineering choices (W8 at best, unvalidated), confidence C, to be tuned
 * against the owner's labels; they are never presented as physiology.
 */
export const SENSOR_PARAMS = {
  // ---- HR profile (RESEARCH III.C)
  tanakaIntercept: R(208, 'bpm', ['W1'], 'B', 'Tanaka 2001 meta-analysis (351 studies, 18,712 people) + lab validation n=514; RESEARCH III.C'),
  tanakaSlope: R(0.7, 'bpm/y', ['W1'], 'B', 'Tanaka 2001; RESEARCH III.C'),
  tanakaSdBpm: R(10, 'bpm', ['W1'], 'B', 'external validation residual SD ≈ 10 bpm (HERITAGE); RESEARCH III.C'),
  hrrMinReserveBpm: P(40, 'bpm', 'SPEC V2.1 validity guard: HRR basis only when HRmax − HRrest ≥ 40'),
  hrMaxRaiseBouts: P(3, 'bouts', 'SPEC V2.1: ≥ 3 quality bouts in 180 days'),
  hrMaxRaiseWindowDays: P(180, 'd', 'SPEC V2.1'),
  hrMaxSustainS: P(30, 's', 'SPEC V2.1: sustained 30-s supported HR'),
  // ---- zones (RESEARCH III.C: configurable display convention)
  zoneEdgesPct: P(50, '% of basis (Z1 lower edge; 60/70/80/90/100 above)', 'RESEARCH III.C five-zone product convention, not ventilatory/lactate thresholds'),
  peakHoldSamples: P(2, 'consecutive supported samples', 'SPEC V2.2 filtered observed peak'),
  // ---- Heart Points (RESEARCH III.D; Google Fit help 7619539, read 2026-10-27)
  fitHrMaxIntercept: R(205.8, 'bpm', ['W3'], 'A', 'Google Fit help (Heart Points): HRmax = 205.8 − 0.685·age; reproduced for compatibility, not physiology'),
  fitHrMaxSlope: R(0.685, 'bpm/y', ['W3'], 'A', 'Google Fit help'),
  fitHrModeratePct: R(50, '% HRmax_fit', ['W3'], 'A', 'Google Fit help: [50, 70) % = 1 point/min'),
  fitHrVigorousPct: R(70, '% HRmax_fit', ['W3'], 'A', 'Google Fit help: ≥ 70 % = 2 points/min'),
  fitMetModerate: R(3, 'MET', ['W3', 'W1'], 'A', 'Google Fit help; WHO 2020 absolute moderate 3-5.9 MET'),
  fitMetVigorous: R(6, 'MET', ['W3', 'W1'], 'A', 'Google Fit help; WHO 2020 vigorous ≥ 6 MET'),
  fitCadenceModerate: R(100, 'steps/min', ['W3', 'W1'], 'B', 'Google Fit help: brisk walking ≥ 100 steps/min'),
  fitCadenceVigorous: R(130, 'steps/min', ['W3'], 'B', 'Google Fit help: running ≥ 130 steps/min'),
  hrEligibleCadence: P(60, 'steps/min', 'SPEC V2.3: HR earns points outside an approved activity only with supported locomotion'),
  weeklyPointsGoal: R(150, 'points/wk', ['W1', 'W11'], 'B', 'WHO 2020: 150-300 moderate-equivalent min/wk (lower bound); Fit default goal'),
  // ---- activity energy (RESEARCH E4, E5, III.B; SPEC §1.5)
  keytelMinCoverage: P(0.6, 'fraction of moving time', 'SPEC V2.4(5): supported HR ≥ 60 % of moving time (engineering policy only)'),
  keytelMinMedianBpm: P(90, 'bpm', 'SPEC V2.4(5): median supported HR ≥ 90 bpm'),
  keytelAgeLo: R(18, 'y', ['W1'], 'B', 'Keytel 2005 sample ages 18-45'),
  keytelAgeHi: R(45, 'y', ['W1'], 'B', 'Keytel 2005 sample ages 18-45'),
  keytelMassLo: R(47, 'kg', ['W1'], 'B', 'Keytel 2005 sample mass 47-120 kg'),
  keytelMassHi: R(120, 'kg', ['W1'], 'B', 'Keytel 2005 sample mass 47-120 kg'),
  kjPerKcal: R(4.184, 'kJ/kcal', ['W3'], 'A', 'thermochemical calorie (definition)'),
  envKeytel: P(0.4, '± fraction', 'SPEC §1.5 Keytel scenario envelope (RESEARCH E5 "visibly provisional ±40 %")'),
  envWide: P(0.5, '± fraction', 'SPEC §1.5: Keytel out of domain/sample, manual average HR, analog or unspecified MET'),
  envMatchedMet: P(0.3, '± fraction', 'SPEC §1.5 matched MET (RESEARCH E4 provisional ±30 %)'),
  // (r063 S16/A19) measured speed from Health Connect (engineering policy only, confidence C)
  measuredMinCoverage: P(0.6, 'fraction of moving time', 'r063 S16: accepted per-minute speed (or verified power) over ≥ 60 % of moving time, as Keytel asks of HR (engineering policy only)'),
  measuredSpeedMaxMps: P(12, 'm/s', 'r063 S16: a per-minute walking/running speed above 12 m/s (43 km/h) is not a measurement of gait (engineering policy only)'),
  envSpeedOrPower: P(0.25, '± fraction', 'SPEC §1.5 in-domain speed/grade, verified power'),
  envRmr: P(0.15, '± fraction', 'SPEC §1.5 RMR equation (only where no engine draws exist)'),
  // ---- detection (SPEC V2.5: P throughout, confidence C)
  detectMinMin: P(10, 'min', 'SPEC V2.5 cadence and HR detectors: ≥ 10 min'),
  detectCadence: P(60, 'steps/min', 'SPEC V2.5 cadence detector'),
  detectCadenceShare: P(0.8, 'fraction of minutes', 'SPEC V2.5 cadence detector'),
  detectMaxGapMin: P(2, 'min', 'SPEC V2.5 cadence detector gap allowance'),
  detectRunCadence: P(130, 'steps/min', 'SPEC V2.5: median ≥ 130 → run'),
  detectHrShare: P(0.6, 'fraction of minutes', 'SPEC V2.5 HR-only detector'),
  detectHrPctOfBasis: P(60, '% of basis', 'SPEC V2.5 HR-only detector'),
  detectHrMaxCadence: P(30, 'steps/min', 'SPEC V2.5 HR-only detector: fused steps < 30/min'),
  mergeOverlap: P(0.5, 'fraction of the shorter', 'SPEC V2.5 / notes C11: merge suggestion threshold'),
  // ---- energy day (SPEC V2.6)
  activeCadence: P(100, 'steps/min', 'SPEC V2.6 time state "active"'),
  conservationTolPct: P(0.1, '%', 'SPEC V2.6 / notes C04: Σ minutes = engine tdee per hour to ≤ 0.1 %'),
  // ---- sleep night (Addendum A.1.2)
  sleepTargetMin: P(480, 'min', 'Legacy on-device sleep v4 target, clamped 420-720 (adult policy, not a diagnosis; RESEARCH IV.6)'),
  sleepTargetLo: P(420, 'min', 'RESEARCH IV.6 (≥ 7 h adult guidance)'),
  sleepTargetHi: P(720, 'min', 'Legacy on-device sleep v4 clamp'),
  goalOverMin: P(30, 'min', 'Addendum A.1.2 #8: "N min over" from 30'),
  hrvCautionMs: P(3, 'ms', 'Addendum A.1.2: HRV caution below −max(3 ms, 10 % of base)'),
  hrvCautionFrac: P(0.1, 'fraction of base', 'Addendum A.1.2'),
  tempCautionC: P(0.5, '°C', 'Addendum A.1.2: ΔT caution past 0.5 °C (context only, RESEARCH IV.6)'),
  learningNights: P(7, 'nights', 'S2 baselines: ≥ 7 nights over ≥ 6 days'),
  // ---- indices (RESEARCH IV.6: weights are product choices; analytical reproducibility, not physiological validity)
  zClip: P(3, 'z', 'Legacy on-device recovery v5: z clipped to ±3'),
  logisticSlope: P(1.2, '1/z', 'Legacy on-device recovery v5: L(z) = 100/(1 + e^(−1.2z))'),
  loadBalanceMinDays: P(7, 'days', 'recovery-index/6 load part: ≥ 7 days of TRIMP history in the prior 28 (legacy on-device v5 baseline gate)'),
  loadBalanceScaleFloor: P(10, 'AU', 'recovery-index/6 load part: scale floor of the TRIMP z (legacy on-device v5 used 10 active minutes)'),
  // ---- training load (Addendum A.1.2 #33)
  banisterMaleA: R(0.64, '', ['W1', 'W11'], 'B', 'Banister 1991 TRIMP weighting, men: 0.64·e^(1.92·f)'),
  banisterMaleB: R(1.92, '', ['W1', 'W11'], 'B', 'Banister 1991'),
  banisterFemaleA: R(0.86, '', ['W1', 'W11'], 'B', 'Banister 1991 TRIMP weighting, women: 0.86·e^(1.67·f)'),
  banisterFemaleB: R(1.67, '', ['W1', 'W11'], 'B', 'Banister 1991'),
  loadRatioLo: P(0.8, 'ratio', 'Addendum A.1.2: acute:chronic under 0.8 "Below usual" (a convention; no injury claim)'),
  loadRatioHi: P(1.3, 'ratio', 'Addendum A.1.2: over 1.3 "Above usual"'),
  loadLearningDays: P(21, 'days', 'Addendum A.1.2: learning until 21 days of history'),
} as const satisfies Record<string, SensorParam>;

export type SensorParamId = keyof typeof SENSOR_PARAMS;

/** The value of a sensor parameter. */
export const sp = (id: SensorParamId): number => SENSOR_PARAMS[id].value;

// ---------------------------------------------------------------- small numeric helpers (shared, pure)

export const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const clip = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clip01 = (x: number): number => clip(x, 0, 1);

/** Median of finite values; null when empty. */
export function median(xs: readonly number[]): number | null {
  const a = xs.filter(isFiniteNum).slice().sort((p, q) => p - q);
  if (a.length === 0) return null;
  const m = a.length >> 1;
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** Overlap of two half-open intervals, ms. */
export const overlapMs = (a0: Ms, a1: Ms, b0: Ms, b1: Ms): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** A symmetric scenario envelope `x·(1 ± half)` (sorted, so a negative x stays a valid band). */
export function scenario(x: number, half: number): Envelope {
  const a = x * (1 - half);
  const b = x * (1 + half);
  return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
}

/** Linear sum of envelopes (SPEC §1.5: correlated person bias, never root-sum-square). */
export function sumEnvelopes(es: readonly Envelope[]): Envelope {
  let lo = 0;
  let hi = 0;
  for (const e of es) {
    lo += e.lo;
    hi += e.hi;
  }
  return { lo, hi };
}

/**
 * Supported HR segments clipped to a window and to the complement of pauses, made disjoint (the first segment by start
 * owns any overlap, so duplicates never add coverage). Non-finite or empty segments are dropped. Sorted by start.
 */
export function clipSegments(segments: readonly HrSegment[], window: Interval, pauses: readonly Interval[] = []): HrSegment[] {
  const sorted = segments
    .filter((s) => isFiniteNum(s.start) && isFiniteNum(s.end) && isFiniteNum(s.bpm) && s.bpm > 0 && s.end > s.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const ps = pauses.filter((p) => p.end > p.start).slice().sort((a, b) => a.start - b.start);
  const out: HrSegment[] = [];
  let cursor = window.start;
  for (const s of sorted) {
    let a = Math.max(s.start, cursor, window.start);
    const b = Math.min(s.end, window.end);
    if (b <= a) continue;
    cursor = b;
    // subtract pauses
    for (const p of ps) {
      if (p.end <= a || p.start >= b) continue;
      if (p.start > a) out.push({ start: a, end: p.start, bpm: s.bpm });
      a = Math.max(a, p.end);
      if (a >= b) break;
    }
    if (a < b) out.push({ start: a, end: b, bpm: s.bpm });
  }
  return out;
}

/** Union length of intervals clipped to a window, ms. */
export function unionMs(intervals: readonly Interval[], window: Interval): number {
  const a = intervals
    .map((i) => ({ start: Math.max(i.start, window.start), end: Math.min(i.end, window.end) }))
    .filter((i) => i.end > i.start)
    .sort((p, q) => p.start - q.start);
  let total = 0;
  let cs = -Infinity;
  let ce = -Infinity;
  for (const i of a) {
    if (i.start > ce) {
      if (ce > cs) total += ce - cs;
      cs = i.start;
      ce = i.end;
    } else if (i.end > ce) ce = i.end;
  }
  if (ce > cs) total += ce - cs;
  return total;
}
