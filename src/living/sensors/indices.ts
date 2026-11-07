/**
 * Experimental wellness indices (energy SPEC §V2.8, Addendum A.1.2 #37-44, DECISIONS D9, D16, D17). Each returns its
 * contributors, raw and applied weights, coverage, confidence and version. Missing inputs renormalise the weights and never
 * mean "poor"; nothing here changes calories, food, plans or advice. Label: "experimental wellness index".
 *
 *  - `sleep-index/5` (Gauge sleep v4 with fixes): D = 100·clip(TST_lower/target, 0, 1) (target: the plan's, else 480,
 *    clamped 420-720); C = 100·clip((continuity − 70)/15, 0, 1) on `windowContinuityPct`; T = 100·clip(1 −
 *    |midpoint − usualMidpoint|_circ/120, 0, 1). Weights (0.50, 0.25, 0.25). "Duration index" when only D exists.
 *  - `recovery-index/6`: z on ln(HRV) and on the sleeping low HR (inverted) against the S2 baselines, clipped ±3;
 *    L(z) = 100/(1 + e^(−1.2z)). HRV L(min(z, 1)) 0.25; low HR L(−z) 0.15; sleep index 0.30; prior-day TRIMP balance 0.10
 *    (only with a waking HRrest and supported HR, else missing — never estimated). Temperature ΔT is context, weight 0
 *    (RESEARCH IV.6). ≥ 2 components required. No ATL/CTL readiness construct.
 *  - `activity-index/4`: 100·(0.40·clip(steps/target) + 0.35·clip(weekPointsPace/150) + 0.25·clip(done/planned)) (P
 *    weights carried from Gauge v3), renormalised over the available parts.
 *  - `day-index/1` (D17): equal thirds of recovery, sleep and activity over the available ones; ≥ 2 of 3, else
 *    `unavailable` ("needs 2 of 3"). Confidence = the lowest of the three. Never called "peak" (D9: `peakScore`
 *    stays unsupported; peak HR is its own metric).
 *
 * Warrants (RESEARCH IV.6): analytically true A (reproducible formulas); causally coherent B for the contributor
 * directions (lower HRV / higher sleeping HR than usual go with less recovery); functionally true unestablished (no
 * usefulness study yet); empirical-formal C for any score validity. Weights are product choices (P). Strongest failure:
 * correlated contributors amplify one noisy channel, and the meaning shifts with missingness (hence the drawer). n-of-1
 * check: pre-register associations with daily restedness, fatigue and performance logs; never fit scores to vendor scores.
 */
import { circDiffMin, sleepGoalMin, type NightBaselines } from './sleepNight';
import { SENSOR_VERSIONS, clip, clip01, isFiniteNum, sp } from './types';

export const INDEX_LABEL = 'experimental wellness index';

export type IndexConfidence = 'low' | 'medium';

export interface IndexContributor {
  id: string;
  label: string;
  /** 0-100 score of the part; null when missing. */
  score: number | null;
  /** The configured weight. */
  weight: number;
  /** The weight after renormalisation over the available parts (0 when missing or context-only). */
  applied: number;
  /** The raw input (a z, minutes, steps, …) for the drawer. */
  raw?: number | null;
  /** Context only (weight 0), e.g. temperature. */
  context?: boolean;
}

export interface IndexResult<V extends string> {
  version: V;
  label: typeof INDEX_LABEL;
  name: string;
  value: number | null;
  status: 'inferred' | 'unavailable';
  reason: string | null;
  contributors: IndexContributor[];
  /** Σ available configured weight ÷ Σ configured weight. */
  coverage: number;
  confidence: IndexConfidence | null;
}

function combine<V extends string>(version: V, name: string, parts: IndexContributor[], minParts: number, reasonIfShort: string): IndexResult<V> {
  const scored = parts.filter((p) => !p.context);
  const avail = scored.filter((p) => p.score !== null && isFiniteNum(p.score));
  const wAll = scored.reduce((a, p) => a + p.weight, 0);
  const wAv = avail.reduce((a, p) => a + p.weight, 0);
  for (const p of parts) p.applied = !p.context && p.score !== null && wAv > 0 ? p.weight / wAv : 0;
  const coverage = wAll > 0 ? wAv / wAll : 0;
  if (avail.length < minParts || wAv <= 0) return { version, label: INDEX_LABEL, name, value: null, status: 'unavailable', reason: reasonIfShort, contributors: parts, coverage, confidence: null };
  const value = avail.reduce((a, p) => a + p.weight * (p.score as number), 0) / wAv;
  return { version, label: INDEX_LABEL, name, value, status: 'inferred', reason: null, contributors: parts, coverage, confidence: coverage >= 0.9 ? 'medium' : 'low' };
}

// ---------------------------------------------------------------- sleep-index/5

export interface SleepIndexInput {
  tstLowerMin: number | null;
  windowContinuityPct: number | null;
  /** Local clock minutes of tonight's midpoint and the usual midpoint (S2 `usualMidpoint`, null when suppressed). */
  midpointMin: number | null;
  usualMidpointMin: number | null;
  /** The plan's sleep target, minutes. */
  targetMin?: number | null;
}

export function sleepIndex(i: SleepIndexInput): IndexResult<typeof SENSOR_VERSIONS.sleepIndex> {
  const target = sleepGoalMin({ sleepMin: i.targetMin ?? null });
  const D = isFiniteNum(i.tstLowerMin) ? 100 * clip01(i.tstLowerMin / target) : null;
  const C = isFiniteNum(i.windowContinuityPct) ? 100 * clip01((i.windowContinuityPct - 70) / 15) : null;
  const T = isFiniteNum(i.midpointMin) && isFiniteNum(i.usualMidpointMin) ? 100 * clip01(1 - Math.abs(circDiffMin(i.midpointMin, i.usualMidpointMin)) / 120) : null;
  const parts: IndexContributor[] = [
    { id: 'duration', label: 'Sleep duration (known asleep)', score: D, weight: 0.5, applied: 0, raw: i.tstLowerMin },
    { id: 'continuity', label: 'Window continuity', score: C, weight: 0.25, applied: 0, raw: i.windowContinuityPct },
    { id: 'timing', label: 'Midpoint vs usual', score: T, weight: 0.25, applied: 0, raw: T === null ? null : circDiffMin(i.midpointMin!, i.usualMidpointMin!) },
  ];
  const r = combine(SENSOR_VERSIONS.sleepIndex, C === null && T === null ? 'duration index' : 'sleep index', parts, 1, 'no sleep recorded');
  // the index needs the duration part: continuity and timing alone do not describe a night
  if (D === null) return { ...r, value: null, status: 'unavailable', reason: 'no sleep duration', confidence: null };
  return r;
}

// ---------------------------------------------------------------- recovery-index/6

/** L(z) = 100/(1 + e^(−1.2z)). */
export const logisticScore = (z: number): number => 100 / (1 + Math.exp(-sp('logisticSlope') * z));

export interface RecoveryIndexInput {
  hrvNightlyMs: number | null;
  nightlyLowHrP10: number | null;
  baselines: Pick<NightBaselines, 'sleepLowHr' | 'hrvBaseline' | 'tempBaseline' | 'learning'> | null;
  sleepIndex: number | null;
  /** The prior-day TRIMP balance score (`priorDayTrimpBalance(...).score`); null when unavailable. */
  loadBalance: number | null;
  /** ΔT from the temperature baseline: context only. */
  tempDeltaC?: number | null;
}

export function recoveryIndex(i: RecoveryIndexInput): IndexResult<typeof SENSOR_VERSIONS.recoveryIndex> {
  const zc = sp('zClip');
  const b = i.baselines;
  let zHrv: number | null = null;
  if (isFiniteNum(i.hrvNightlyMs) && i.hrvNightlyMs > 0 && b?.hrvBaseline && b.hrvBaseline.ready !== false && b.hrvBaseline.s > 0) zHrv = clip((Math.log(i.hrvNightlyMs) - b.hrvBaseline.median) / b.hrvBaseline.s, -zc, zc);
  let zHr: number | null = null;
  if (isFiniteNum(i.nightlyLowHrP10) && b?.sleepLowHr && b.sleepLowHr.ready !== false && b.sleepLowHr.s > 0) zHr = clip((i.nightlyLowHrP10 - b.sleepLowHr.median) / b.sleepLowHr.s, -zc, zc);
  const parts: IndexContributor[] = [
    // an unexpectedly high HRV is not always better: the HRV part saturates at z = 1
    { id: 'hrv', label: 'HRV vs usual (ln)', score: zHrv === null ? null : logisticScore(Math.min(zHrv, 1)), weight: 0.25, applied: 0, raw: zHrv },
    { id: 'lowHr', label: 'Sleeping low HR vs usual', score: zHr === null ? null : logisticScore(-zHr), weight: 0.15, applied: 0, raw: zHr },
    { id: 'sleep', label: 'Sleep index', score: isFiniteNum(i.sleepIndex) ? i.sleepIndex : null, weight: 0.3, applied: 0, raw: i.sleepIndex },
    { id: 'load', label: 'Prior-day load balance', score: isFiniteNum(i.loadBalance) ? i.loadBalance : null, weight: 0.1, applied: 0, raw: i.loadBalance },
    { id: 'temperature', label: 'Skin temperature vs usual (context)', score: null, weight: 0, applied: 0, raw: i.tempDeltaC ?? null, context: true },
  ];
  return combine(SENSOR_VERSIONS.recoveryIndex, 'recovery index', parts, 2, 'needs 2 of: HRV, sleeping low HR, sleep, load');
}

// ---------------------------------------------------------------- activity-index/4

export interface ActivityIndexInput {
  steps: number | null;
  stepTarget: number | null;
  /** `weekPointsPace(...)`. */
  weekPointsPace: number | null;
  plannedSessionsDone: number | null;
  plannedSessions: number | null;
}

export function activityIndex(i: ActivityIndexInput): IndexResult<typeof SENSOR_VERSIONS.activityIndex> {
  const S = isFiniteNum(i.steps) && isFiniteNum(i.stepTarget) && i.stepTarget > 0 ? 100 * clip01(i.steps / i.stepTarget) : null;
  const P = isFiniteNum(i.weekPointsPace) ? 100 * clip01(i.weekPointsPace / sp('weeklyPointsGoal')) : null;
  const W = isFiniteNum(i.plannedSessions) && i.plannedSessions > 0 && isFiniteNum(i.plannedSessionsDone) ? 100 * clip01(i.plannedSessionsDone / i.plannedSessions) : null;
  const parts: IndexContributor[] = [
    { id: 'steps', label: 'Steps vs target', score: S, weight: 0.4, applied: 0, raw: i.steps },
    { id: 'points', label: 'Heart Points pace (Fit-compatible estimate)', score: P, weight: 0.35, applied: 0, raw: i.weekPointsPace },
    { id: 'sessions', label: 'Planned sessions done', score: W, weight: 0.25, applied: 0, raw: i.plannedSessionsDone },
  ];
  return combine(SENSOR_VERSIONS.activityIndex, 'activity index', parts, 1, 'no activity data');
}

// ---------------------------------------------------------------- day-index/1 (D17)

type AnyIndex = Pick<IndexResult<string>, 'value' | 'confidence' | 'contributors'>;

export interface DayIndex extends IndexResult<typeof SENSOR_VERSIONS.dayIndex> {
  /** "based on n of 3". */
  basedOn: number;
  /** The share of the Day score that comes from sleep, directly and through recovery's sleep part (about 46 % with all). */
  effectiveSleepShare: number | null;
  /** Sleep and recovery are fixed after waking; activity moves during the day. */
  moving: 'activity';
}

export function dayIndex(i: { recovery: AnyIndex | null; sleep: AnyIndex | null; activity: AnyIndex | null }): DayIndex {
  const val = (x: AnyIndex | null) => (x && isFiniteNum(x.value) ? x.value : null);
  const parts: IndexContributor[] = [
    { id: 'recovery', label: 'Recovery index', score: val(i.recovery), weight: 1 / 3, applied: 0 },
    { id: 'sleep', label: 'Sleep index', score: val(i.sleep), weight: 1 / 3, applied: 0 },
    { id: 'activity', label: 'Activity index', score: val(i.activity), weight: 1 / 3, applied: 0 },
  ];
  const r = combine(SENSOR_VERSIONS.dayIndex, 'Day score', parts, 2, 'needs 2 of 3');
  const n = parts.filter((p) => p.score !== null).length;
  // confidence: the lowest of the available indices
  const confs = [i.recovery, i.sleep, i.activity].filter((x) => x && isFiniteNum(x.value)).map((x) => x!.confidence);
  const confidence: IndexConfidence | null = r.value === null ? null : confs.includes('low') || confs.includes(null) ? 'low' : 'medium';
  let share: number | null = null;
  if (r.value !== null) {
    const sleepApplied = parts[1]!.applied;
    const recApplied = parts[0]!.applied;
    const recSleep = i.recovery?.contributors.find((c) => c.id === 'sleep')?.applied ?? 0;
    share = sleepApplied + recApplied * recSleep;
  }
  return { ...r, confidence, basedOn: n, effectiveSleepShare: share, moving: 'activity' };
}

// ---------------------------------------------------------------- facts (A.1.2 #44)

export interface DayFacts {
  version: typeof SENSOR_VERSIONS.dayIndex;
  date: string;
  day: { value: number | null; confidence: IndexConfidence | null; basedOn: number; target: number; changeSinceYesterday: number | null; effectiveSleepShare: number | null };
  scores: Record<'recovery' | 'sleep' | 'activity', { value: number | null; confidence: IndexConfidence | null; contributors: IndexContributor[] } | null>;
}

/** The deterministic facts a coach could phrase (the coach text itself is not built here). */
export function dayFacts(i: { date: string; day: DayIndex; recovery: AnyIndex | null; sleep: AnyIndex | null; activity: AnyIndex | null; target?: number | null; yesterday?: number | null }): DayFacts {
  const pack = (x: AnyIndex | null) => (x ? { value: x.value, confidence: x.confidence, contributors: x.contributors } : null);
  return {
    version: SENSOR_VERSIONS.dayIndex,
    date: i.date,
    day: {
      value: i.day.value,
      confidence: i.day.confidence,
      basedOn: i.day.basedOn,
      target: isFiniteNum(i.target) ? i.target : DAY_SCORE_TARGET_DEFAULT,
      changeSinceYesterday: i.day.value !== null && isFiniteNum(i.yesterday) ? i.day.value - i.yesterday : null,
      effectiveSleepShare: i.day.effectiveSleepShare,
    },
    scores: { recovery: pack(i.recovery), sleep: pack(i.sleep), activity: pack(i.activity) },
  };
}

/** `dayScoreTarget` default (A.1.2 #42, D17): 70, user-editable (V3 setting), no adaptive rule. */
export const DAY_SCORE_TARGET_DEFAULT = 70;

/** Peak score (D9): unsupported until the owner defines it; peak HR is its own metric. */
export const PEAK_SCORE = { status: 'unsupported', reason: 'peak score is undefined (D9); see peak HR' } as const;
