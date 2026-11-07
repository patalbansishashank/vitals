/**
 * The night joined with the plan, the sleep entry and the baselines (`sleep-night/1`, energy SPEC §V2.7, Addendum A.1.2
 * #8, #9, #12, #14-16, #20, #23, DECISION D11). Nightly metrics and baselines are S2's (`sleep-metrics/1`, `/baselines`);
 * this module only compares them.
 *
 *  - `vsGoal`: goal = the plan's sleep target, else 480 min, clamped 420-720. Δ = tstLowerMin − goal ≥ 0 → "Goal met"
 *    ("N min over" from 30, P); tstUpperMin − goal < 0 → "N min short" (N = goal − tstUpperMin; "at least" when the night
 *    has unknown minutes); a goal between the bounds → "Goal unclear". Bounds, never a point (an incomplete night).
 *  - `vsPlan`: onset and final wake minus the plan's bed and wake times, signed, circular on the clock.
 *  - `latencyMin = onset − lightsOut`, `efficiencyPct = 100·TST/(outOfBed − lightsOut)` only with the D11 diary fields;
 *    otherwise null with "needs lights-out time" (the ring alone cannot know when the person tried to sleep).
 *  - `vsUsual`: signed differences from the S2 baselines (circular for the midpoint). Sleeping low HR "Near usual" within
 *    one s, else below/above; HRV caution only when delta < −max(3 ms, 10 % of base); ΔT caution past 0.5 °C (context
 *    only). Absent while the baseline is learning: "Calibrating · night n of 7".
 *
 * Warrants: analytically true A (definitions and arithmetic); the goal policy is an adult guidance anchor (W1 B for ≥ 7 h,
 * not for 8 h as an optimum; RESEARCH IV.6); the caution thresholds are product defaults (P, C). HRV and temperature are
 * vendor values (observed, unvalidated for this ring): descriptive, never diagnostic.
 */
import { SENSOR_VERSIONS, clip, isFiniteNum, sp } from './types';

/**
 * The fields of S2's `sleep-metrics/1` session metrics this module reads, as `src/net/gauge.ts`'s adapter delivers them
 * (`GaugeSleepMetrics`: S2's `{bpm}`, `{ms}`, `{c}` objects read out as numbers). Pure code may not import the network
 * layer, so the shape is restated here; a test checks it and runs this module on S2's own fixtures through the adapter.
 */
export interface NightMetrics {
  tstLowerMin: number;
  tstUpperMin: number;
  onset: string | null;
  finalWake: string | null;
  midpoint: string | null;
  nightlyLowHrP10: number | null;
  hrvNightlyMs: number | null;
  skinTempNightC: number | null;
  windowContinuityPct?: number | null;
  incomplete?: boolean;
}

/**
 * The fields of S2's `/baselines` this module reads, as `src/net/gauge.ts`'s adapter delivers them (`GaugeBaselines`).
 * `ready: false` is S2's own gate (fewer than 7 nights over 6 days): such a baseline is shown, never compared against.
 */
export interface NightBaselines {
  usualMidpoint: { minutes: number | null; Rbar: number; n: number; suppressed?: boolean } | null;
  sleepLowHr: { median: number; s: number; n: number; spanDays: number; ready?: boolean } | null;
  /** ln(HRV) median and scale; `medianMs` = exp(median). */
  hrvBaseline: { median: number; s: number; medianMs?: number; n: number; spanDays: number; ready?: boolean } | null;
  tempBaseline: { median: number; n: number; spanDays: number; deltaT: number | null; ready?: boolean } | null;
  learning: { nights: number; needed: number; learning: boolean };
}

export interface SleepPlanTargets {
  /** The plan's sleep target, minutes. */
  sleepMin?: number | null;
  /** Planned bed and wake clock hours (local, decimal: 22.5 = 22:30). */
  bedH?: number | null;
  wakeH?: number | null;
}

export interface SleepEntryTimes {
  /** D11 diary fields (ISO). */
  lightsOutAt?: string | null;
  outOfBedAt?: string | null;
}

/** Minutes after local midnight of an ISO date-time, read from its own wall clock (an offset form), else UTC + offset. */
export function localClockMin(iso: string | null | undefined, utcOffsetMin = 0): number | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(Z|[+-]\d{2}:?\d{2})?$/.exec(iso);
  if (!m) return null;
  let min = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
  if (m[4] === 'Z' || m[4] === undefined) min += m[4] === 'Z' ? utcOffsetMin : 0;
  return ((min % 1440) + 1440) % 1440;
}

/** Signed circular difference a − b on a 1440-min clock, in (−720, 720]. */
export function circDiffMin(a: number, b: number): number {
  let d = (((a - b) % 1440) + 1440) % 1440;
  if (d > 720) d -= 1440;
  return d;
}

/** The sleep goal: the plan's target, else 480 min, clamped 420-720. */
export function sleepGoalMin(plan?: SleepPlanTargets | null): number {
  const t = plan && isFiniteNum(plan.sleepMin) && plan.sleepMin > 0 ? plan.sleepMin : sp('sleepTargetMin');
  return clip(t, sp('sleepTargetLo'), sp('sleepTargetHi'));
}

export type GoalWord = 'met' | 'short' | 'unclear';

export interface VsGoal {
  goalMin: number;
  word: GoalWord;
  /** "Goal met" / "N min short" / "Goal unclear". */
  text: string;
  overMin: number | null;
  shortMin: number | null;
  /** The shortfall is a lower bound (the night has unknown minutes). */
  atLeast: boolean;
  status: 'inferred';
}

export function vsGoal(m: Pick<NightMetrics, 'tstLowerMin' | 'tstUpperMin'>, plan?: SleepPlanTargets | null): VsGoal {
  const goal = sleepGoalMin(plan);
  const lo = m.tstLowerMin;
  const hi = Math.max(m.tstUpperMin, lo);
  if (lo - goal >= 0) {
    const over = lo - goal;
    return { goalMin: goal, word: 'met', text: over >= sp('goalOverMin') ? `Goal met, ${Math.round(over)} min over` : 'Goal met', overMin: over, shortMin: null, atLeast: false, status: 'inferred' };
  }
  if (hi - goal < 0) {
    const short = goal - hi;
    const atLeast = hi > lo;
    return { goalMin: goal, word: 'short', text: `${atLeast ? 'At least ' : ''}${Math.round(short)} min short`, overMin: null, shortMin: short, atLeast, status: 'inferred' };
  }
  return { goalMin: goal, word: 'unclear', text: 'Goal unclear', overMin: null, shortMin: null, atLeast: false, status: 'inferred' };
}

export interface VsPlan {
  /** Onset − planned bed time, min (positive = later than planned). */
  onsetMin: number | null;
  /** Final wake − planned wake time, min. */
  wakeMin: number | null;
  text: { onset: string | null; wake: string | null };
}

const laterEarlier = (d: number): string => (Math.round(d) === 0 ? 'as planned' : `${Math.abs(Math.round(d))} min ${d > 0 ? 'later' : 'earlier'} than planned`);

export function vsPlan(m: Pick<NightMetrics, 'onset' | 'finalWake'>, plan?: SleepPlanTargets | null, utcOffsetMin = 0): VsPlan | null {
  if (!plan || (!isFiniteNum(plan.bedH) && !isFiniteNum(plan.wakeH))) return null;
  const on = localClockMin(m.onset, utcOffsetMin);
  const wk = localClockMin(m.finalWake, utcOffsetMin);
  const onsetMin = on !== null && isFiniteNum(plan.bedH) ? circDiffMin(on, plan.bedH * 60) : null;
  const wakeMin = wk !== null && isFiniteNum(plan.wakeH) ? circDiffMin(wk, plan.wakeH * 60) : null;
  return { onsetMin, wakeMin, text: { onset: onsetMin === null ? null : laterEarlier(onsetMin), wake: wakeMin === null ? null : laterEarlier(wakeMin) } };
}

export interface LatencyEfficiency {
  latencyMin: number | null;
  efficiencyPct: number | null;
  /** From `tstUpperMin` when the night has unknown minutes (the efficiency is then a range). */
  efficiencyUpperPct: number | null;
  reason: 'needs lights-out time' | null;
  /** The entries are attested; the onset is inferred. */
  status: 'attested' | 'unavailable';
}

export function latencyEfficiency(m: Pick<NightMetrics, 'onset' | 'tstLowerMin' | 'tstUpperMin'>, e?: SleepEntryTimes | null): LatencyEfficiency {
  const lo = e?.lightsOutAt ? Date.parse(e.lightsOutAt) : Number.NaN;
  const ob = e?.outOfBedAt ? Date.parse(e.outOfBedAt) : Number.NaN;
  const on = m.onset ? Date.parse(m.onset) : Number.NaN;
  if (!Number.isFinite(lo)) return { latencyMin: null, efficiencyPct: null, efficiencyUpperPct: null, reason: 'needs lights-out time', status: 'unavailable' };
  const latencyMin = Number.isFinite(on) ? Math.max(0, (on - lo) / 60_000) : null;
  const inBed = Number.isFinite(ob) && ob > lo ? (ob - lo) / 60_000 : null;
  const efficiencyPct = inBed ? Math.min(100, (100 * m.tstLowerMin) / inBed) : null;
  const efficiencyUpperPct = inBed && m.tstUpperMin > m.tstLowerMin ? Math.min(100, (100 * m.tstUpperMin) / inBed) : null;
  return { latencyMin, efficiencyPct, efficiencyUpperPct, reason: null, status: 'attested' };
}

export type UsualWord = 'Near usual' | 'Below usual' | 'Above usual';

export interface VsUsual {
  learning: boolean;
  /** "Calibrating · night n of 7" while learning. */
  learningText: string | null;
  midpointMin: number | null;
  lowHrBpm: number | null;
  lowHrWord: UsualWord | null;
  hrvMs: number | null;
  hrvPct: number | null;
  hrvCaution: boolean;
  tempC: number | null;
  tempCaution: boolean;
  status: 'inferred';
}

export function vsUsual(m: Pick<NightMetrics, 'midpoint' | 'nightlyLowHrP10' | 'hrvNightlyMs' | 'skinTempNightC'>, b: NightBaselines | null, utcOffsetMin = 0): VsUsual {
  const none: VsUsual = { learning: true, learningText: null, midpointMin: null, lowHrBpm: null, lowHrWord: null, hrvMs: null, hrvPct: null, hrvCaution: false, tempC: null, tempCaution: false, status: 'inferred' };
  if (!b) return { ...none, learningText: `Calibrating · night 0 of ${sp('learningNights')}` };
  if (b.learning.learning) return { ...none, learningText: `Calibrating · night ${b.learning.nights} of ${b.learning.needed}` };
  const mid = localClockMin(m.midpoint, utcOffsetMin);
  const um = b.usualMidpoint;
  const midpointMin = mid !== null && um && um.minutes !== null && !um.suppressed ? circDiffMin(mid, um.minutes) : null;
  let lowHrBpm: number | null = null;
  let lowHrWord: UsualWord | null = null;
  if (isFiniteNum(m.nightlyLowHrP10) && b.sleepLowHr && b.sleepLowHr.ready !== false) {
    lowHrBpm = m.nightlyLowHrP10 - b.sleepLowHr.median;
    lowHrWord = Math.abs(lowHrBpm) <= b.sleepLowHr.s ? 'Near usual' : lowHrBpm < 0 ? 'Below usual' : 'Above usual';
  }
  let hrvMs: number | null = null;
  let hrvPct: number | null = null;
  let hrvCaution = false;
  if (isFiniteNum(m.hrvNightlyMs) && b.hrvBaseline && b.hrvBaseline.ready !== false) {
    const base = b.hrvBaseline.medianMs ?? Math.exp(b.hrvBaseline.median);
    hrvMs = m.hrvNightlyMs - base;
    hrvPct = base > 0 ? (100 * hrvMs) / base : null;
    hrvCaution = hrvMs < -Math.max(sp('hrvCautionMs'), sp('hrvCautionFrac') * base);
  }
  let tempC: number | null = null;
  if (b.tempBaseline && b.tempBaseline.ready !== false) tempC = isFiniteNum(b.tempBaseline.deltaT) ? b.tempBaseline.deltaT : isFiniteNum(m.skinTempNightC) ? m.skinTempNightC - b.tempBaseline.median : null;
  return { learning: false, learningText: null, midpointMin, lowHrBpm, lowHrWord, hrvMs, hrvPct, hrvCaution, tempC, tempCaution: tempC !== null && Math.abs(tempC) > sp('tempCautionC'), status: 'inferred' };
}

export interface SleepNight {
  version: typeof SENSOR_VERSIONS.sleepNight;
  vsGoal: VsGoal;
  vsPlan: VsPlan | null;
  latencyMin: number | null;
  efficiencyPct: number | null;
  latency: LatencyEfficiency;
  vsUsual: VsUsual;
  /** S2's own flag: an incomplete night shows TST as bounds. */
  incomplete: boolean;
}

/** The whole join for one primary night. */
export function sleepNight(i: { metrics: NightMetrics; baselines: NightBaselines | null; plan?: SleepPlanTargets | null; entry?: SleepEntryTimes | null; utcOffsetMin?: number }): SleepNight {
  const lat = latencyEfficiency(i.metrics, i.entry);
  return {
    version: SENSOR_VERSIONS.sleepNight,
    vsGoal: vsGoal(i.metrics, i.plan),
    vsPlan: vsPlan(i.metrics, i.plan, i.utcOffsetMin ?? 0),
    latencyMin: lat.latencyMin,
    efficiencyPct: lat.efficiencyPct,
    latency: lat,
    vsUsual: vsUsual(i.metrics, i.baselines, i.utcOffsetMin ?? 0),
    incomplete: i.metrics.incomplete === true,
  };
}
