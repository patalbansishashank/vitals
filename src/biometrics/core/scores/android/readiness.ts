/**
 * `readiness.index` v1 = port of the Android `lumen-recovery-v4` (R10 §3.8; R9 §2.10; SUITE_SPEC §11 decision 15:
 * "Readiness v1 = lumen-recovery-v4 parity incl. nutrition; HRV baseline 60 d with an Android-parity mode").
 * Owner's code: `InsightAlgorithms.recoveryScore` and the recovery part of `LocalInsightEngine.compute`
 * (service/LocalInsightEngine.kt), `InsightSamplePolicy`. Display only. Tier P.
 * Parity target: ±0.1 (the app publishes `roundToInt(value·10)/10`, R10 §6).
 */
import type { ScoreDef, ScoreInput, ScoreResult } from '../../types';
import { makeResult, withheld } from '../util';
import { androidInputsFromScoreInput, NUTRITION_PRIOR_SCORE_ID, type AndroidSleepSession, type AndroidWorld } from './adapter';
import {
  accepts, coerceIn, computeBaselineStats, DAY_MS, enginePercentile, engineMedian, groupValues, localParts, logistic, maxByOrNull,
  nightlyValues, personalDeviation, plusDays, roundToInt, startOfDayLocal, sumOf,
  type BaselineStats, type MeasurementKind, type VitalSample,
} from './kotlin';
import { SLEEP_INDEX_ID, SLEEP_INDEX_VERSION, sleepIndexForWakingDay, toVitalsContributors, type AndroidContributor } from './sleepIndex';

export const READINESS_ID = 'readiness.index';
export const READINESS_VERSION = '1.0.0';
export const ANDROID_RECOVERY_VERSION = 'lumen-recovery-v4';

/** HRV nightly-baseline window: Android's 30 d, or Vitals' 60 d (decision 15). Everything else is identical. */
export type BaselineMode = 'android' | 'vitals60d';
/** The Android-parity mode (decision 15). */
export const ANDROID_PARITY_BASELINE_MODE: BaselineMode = 'android';
/** Default for `readiness.index` v1 (decision 15: HRV baseline 60 d). */
export const READINESS_BASELINE_MODE: BaselineMode = 'vitals60d';
export const BASELINE_DAYS_BY_MODE: Record<BaselineMode, { hrv: number; rhr: number; temp: number; load: number }> = {
  android: { hrv: 30, rhr: 30, temp: 30, load: 30 },
  vitals60d: { hrv: 60, rhr: 30, temp: 30, load: 30 },
};

/** Configured weights of `recoveryScore` (Lumen heuristics, R10 §3.8). */
export const RECOVERY_WEIGHTS = {
  hrv: 0.25, resting_hr: 0.15, sleep: 0.3, temperature: 0.1, prior_day_load: 0.1, prior_day_nutrition: 0.1,
} as const;
type ComponentId = keyof typeof RECOVERY_WEIGHTS;
const LABELS: Record<ComponentId, string> = {
  hrv: 'Heart rate variability', resting_hr: 'Resting heart rate', sleep: 'Sleep', temperature: 'Temperature deviation',
  prior_day_load: 'Prior-day load', prior_day_nutrition: 'Prior-day nutrition',
};

/** Arguments of `InsightAlgorithms.recoveryScore`. */
export interface RecoveryArgs {
  hrv: number | null;
  hrvBaseline: BaselineStats | null;
  restingHr: number | null;
  restingHrBaseline: BaselineStats | null;
  sleepScore: number | null;
  skinTemperature: number | null;
  temperatureBaseline: BaselineStats | null;
  priorDayLoadBalanceScore?: number | null;
  priorDayNutritionScore?: number | null;
}

/** `InsightResult` of the recovery score. `value` is unrounded (the app's published value is `published`). */
export interface RecoveryResult {
  value: number;
  /** `roundToInt(value·10)/10` as emitted in the DerivedInsight event. */
  published: number;
  confidence: 'medium' | 'low';
  inputs: Record<string, number>;
  contributors: AndroidContributor[];
}

/** `InsightAlgorithms.recoveryScore`. Null when fewer than two components are available. */
export function computeRecoveryV4(a: RecoveryArgs): RecoveryResult | null {
  const components: Array<{ name: ComponentId; score: number; weight: number }> = [];
  const inputs: Record<string, number> = {};

  const hrvIn = a.hrv !== null && a.hrv >= 1 && a.hrv <= 300 ? a.hrv : null;
  const hrvFloorRaw = (a.hrvBaseline?.median ?? 50) * 0.1;
  const hrvZ = personalDeviation(hrvIn, a.hrvBaseline, hrvFloorRaw < 3 ? 3 : hrvFloorRaw);
  if (hrvZ !== null && a.hrv !== null && a.hrvBaseline !== null) {
    components.push({ name: 'hrv', score: logistic(hrvZ > 1 ? 1 : hrvZ), weight: RECOVERY_WEIGHTS.hrv });
    inputs.hrv = a.hrv;
    inputs.hrv_baseline = a.hrvBaseline.median;
    inputs.hrv_z = hrvZ;
  }
  const hrIn = a.restingHr !== null && a.restingHr >= 30 && a.restingHr <= 220 ? a.restingHr : null;
  const hrZ = personalDeviation(hrIn, a.restingHrBaseline, 3);
  if (hrZ !== null && a.restingHr !== null && a.restingHrBaseline !== null) {
    const z = -hrZ;
    components.push({ name: 'resting_hr', score: logistic(z), weight: RECOVERY_WEIGHTS.resting_hr });
    inputs.resting_hr = a.restingHr;
    inputs.resting_hr_baseline = a.restingHrBaseline.median;
    inputs.resting_hr_z = z;
  }
  if (a.sleepScore !== null && Number.isFinite(a.sleepScore)) {
    components.push({ name: 'sleep', score: coerceIn(a.sleepScore, 0, 100), weight: RECOVERY_WEIGHTS.sleep });
    inputs.sleep_score = a.sleepScore;
  }
  const tIn = a.skinTemperature !== null && a.skinTemperature >= 20 && a.skinTemperature <= 45 ? a.skinTemperature : null;
  const tempZ = personalDeviation(tIn, a.temperatureBaseline, 0.5);
  if (tempZ !== null && a.skinTemperature !== null && a.temperatureBaseline !== null) {
    // Kotlin: 100.0 * exp(-0.5 * tempZ * tempZ)
    components.push({ name: 'temperature', score: 100 * Math.exp(-0.5 * tempZ * tempZ), weight: RECOVERY_WEIGHTS.temperature });
    inputs.skin_temperature_c = a.skinTemperature;
    inputs.temperature_baseline_c = a.temperatureBaseline.median;
    inputs.temperature_delta_c = a.skinTemperature - a.temperatureBaseline.median;
  }
  const load = a.priorDayLoadBalanceScore;
  if (load !== null && load !== undefined && Number.isFinite(load)) {
    components.push({ name: 'prior_day_load', score: coerceIn(load, 0, 100), weight: RECOVERY_WEIGHTS.prior_day_load });
    inputs.prior_day_load_balance_score = coerceIn(load, 0, 100);
  }
  const nut = a.priorDayNutritionScore;
  if (nut !== null && nut !== undefined && Number.isFinite(nut)) {
    components.push({ name: 'prior_day_nutrition', score: coerceIn(nut, 0, 100), weight: RECOVERY_WEIGHTS.prior_day_nutrition });
    inputs.prior_day_nutrition_score = coerceIn(nut, 0, 100);
  }
  if (components.length < 2) return null;
  const weight = sumOf(components, (c) => c.weight);
  const score = sumOf(components, (c) => c.score * c.weight) / weight;
  const physiology = components.filter((c) => c.name === 'hrv' || c.name === 'resting_hr').length;
  const confidence = components.length >= 3 && physiology >= 1 ? 'medium' : 'low';
  const raw: Record<ComponentId, [number | null | undefined, string]> = {
    hrv: [a.hrv, 'ms'],
    resting_hr: [a.restingHr, 'bpm'],
    sleep: [a.sleepScore, 'score'],
    temperature: [inputs.temperature_delta_c, 'delta_degC'],
    prior_day_load: [a.priorDayLoadBalanceScore, 'score'],
    prior_day_nutrition: [a.priorDayNutritionScore, 'score'],
  };
  const contributors: AndroidContributor[] = (Object.keys(RECOVERY_WEIGHTS) as ComponentId[]).map((id) => {
    const c = components.find((x) => x.name === id);
    return {
      id, label: LABELS[id], value: raw[id][0] ?? null, unit: raw[id][1], score: c ? c.score : null,
      weight: c ? c.weight / weight : 0, configuredWeight: RECOVERY_WEIGHTS[id], role: c ? 'SCORED' : 'UNAVAILABLE',
    };
  });
  const value = coerceIn(score, 0, 100);
  return { value, published: roundToInt(value * 10) / 10, confidence, inputs, contributors };
}

/** What `LocalInsightEngine.compute` passes to `recoveryScore`, plus the day keys it used. */
export interface RecoveryDayInputs {
  args: RecoveryArgs;
  sleepDay: string;
  dayStart: number;
  primarySessionId: string | null;
}

/** The recovery part of `LocalInsightEngine.compute(db, nowMs)`, on an AndroidWorld. */
export function recoveryInputsForWorld(w: AndroidWorld, mode: BaselineMode = ANDROID_PARITY_BASELINE_MODE): RecoveryDayInputs {
  const { nowMs, tz } = w;
  const days = BASELINE_DAYS_BY_MODE[mode];
  const now = localParts(nowMs, tz);
  const dayStart = startOfDayLocal(nowMs, tz);
  const sleepDay = now.hour < 4 ? plusDays(now.date, -1) : now.date; // TimeUtil.referenceNightLocal
  const sleepSessions = w.sessions.filter((s) => s.date === sleepDay && s.totalMinutes > 0);
  const primarySleep = maxByOrNull(sleepSessions, (s) => s.totalMinutes);
  const daily = sleepIndexForWakingDay(w, sleepDay);

  const currentWindowStart = primarySleep?.startAt ?? dayStart;
  const baselineEnd = Math.min(currentWindowStart, nowMs);
  const currentWindowEnd = primarySleep?.endAt ?? nowMs;
  const samples = (kind: MeasurementKind, start: number, end: number): VitalSample[] =>
    w.measurements[kind].filter((m) => m.t >= start && m.t <= end && accepts(kind, m.value) && m.t <= nowMs);
  const currentValues = (kind: MeasurementKind): number[] =>
    primarySleep ? nightlyValues(samples(kind, currentWindowStart, currentWindowEnd)) : [];
  const hrvCurrent = engineMedian(currentValues('HRV'));
  const hrCurrent = enginePercentile(currentValues('HEART_RATE'), 0.1);
  const tempCurrent = engineMedian(currentValues('TEMPERATURE'));

  const priorSleeps = (baselineStart: number): AndroidSleepSession[] =>
    groupValues(
      w.sessions.filter((s) => s.startAt >= baselineStart && s.startAt <= baselineEnd && s.totalMinutes > 0 &&
        s.date !== sleepDay && s.endAt <= baselineEnd),
      (s) => s.date,
    ).map((rows) => maxByOrNull(rows, (r) => r.totalMinutes)!);
  const nightlyBaseline = (kind: MeasurementKind, windowDays: number, aggregate: (v: number[]) => number | null): BaselineStats | null => {
    const baselineStart = nowMs - windowDays * DAY_MS;
    const all = samples(kind, baselineStart, baselineEnd);
    const nights: VitalSample[] = [];
    for (const night of priorSleeps(baselineStart)) {
      const v = aggregate(nightlyValues(all.filter((s) => s.t >= night.startAt && s.t <= night.endAt)));
      if (v !== null) nights.push({ t: night.startAt, value: v });
    }
    return computeBaselineStats(nights);
  };
  const hrvBaseline = nightlyBaseline('HRV', days.hrv, engineMedian);
  const hrBaseline = nightlyBaseline('HEART_RATE', days.rhr, (v) => enginePercentile(v, 0.1));
  const tempBaseline = nightlyBaseline('TEMPERATURE', days.temp, engineMedian);

  // Prior-day load: yesterday's active minutes vs the 30 days before it (activityDailyDao().recentReal(35)).
  const priorDayStart = startOfDayLocal(dayStart - 1, tz);
  const priorActivity = w.activity.find((a) => a.dateMs === priorDayStart) ?? null;
  const recent = [...w.activity].sort((a, b) => b.dateMs - a.dateMs).slice(0, 35);
  const activityBaseline = computeBaselineStats(
    recent.filter((a) => a.dateMs < priorDayStart && a.dateMs >= priorDayStart - days.load * DAY_MS).map((a) => ({ t: a.dateMs, value: a.activeMinutes })),
  );
  const loadZ = personalDeviation(priorActivity ? priorActivity.activeMinutes : null, activityBaseline, 10);
  // Kotlin: 100.0 * exp(-0.5 * maxOf(0.0, z) * maxOf(0.0, z)); only unusually high load lowers it.
  const priorDayLoadBalance = loadZ === null ? null : 100 * Math.exp(-0.5 * Math.max(0, loadZ) * Math.max(0, loadZ));

  return {
    args: {
      hrv: hrvCurrent, hrvBaseline, restingHr: hrCurrent, restingHrBaseline: hrBaseline,
      sleepScore: daily ? daily.score : null, skinTemperature: tempCurrent, temperatureBaseline: tempBaseline,
      priorDayLoadBalanceScore: priorDayLoadBalance, priorDayNutritionScore: w.priorDayNutritionScore,
    },
    sleepDay,
    dayStart,
    primarySessionId: primarySleep?.id ?? null,
  };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

export function makeReadinessDef(mode: BaselineMode): ScoreDef {
  const version = mode === 'vitals60d' ? READINESS_VERSION : `${READINESS_VERSION}+android-parity`;
  const SRC = 'R10 §3.8 / LocalInsightEngine.kt recoveryScore';
  const ENG = 'R10 §3.4–3.7 / LocalInsightEngine.kt compute';
  const days = BASELINE_DAYS_BY_MODE[mode];
  const tiers: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
  // ScoreWindow has no '30d'; '60d' is the smallest window that covers both baseline lengths (fetch window).
  const win = (_d: number): '60d' => '60d';
  return {
    scoreId: READINESS_ID,
    title: 'Readiness',
    version,
    released: '2026-10-01',
    kind: 'index',
    label: 'convenience_index',
    inputs: [
      { stream: 'sleep.index', window: 'main_sleep', tiersAllowed: tiers, sameSourceRequired: false },
      { stream: 'hrv', window: 'main_sleep', minCount: 3, tiersAllowed: tiers, sameSourceRequired: false },
      { stream: 'hrv', window: win(days.hrv), minCount: 7, tiersAllowed: tiers, sameSourceRequired: false },
      { stream: 'hr', window: 'main_sleep', minCount: 3, tiersAllowed: tiers, sameSourceRequired: false },
      { stream: 'hr', window: win(days.rhr), minCount: 7, tiersAllowed: tiers, sameSourceRequired: false },
      { stream: 'skin_temp', window: 'main_sleep', minCount: 3, tiersAllowed: tiers, sameSourceRequired: false },
      { stream: 'skin_temp', window: win(days.temp), minCount: 7, tiersAllowed: tiers, sameSourceRequired: false },
      { stream: 'daily_summary.active_min', window: '60d', minCount: 7, tiersAllowed: tiers, sameSourceRequired: false },
      { stream: NUTRITION_PRIOR_SCORE_ID, window: 'all', tiersAllowed: tiers, sameSourceRequired: false },
    ],
    profileInputs: ['sleepNeedH'],
    gates: [
      'components_available >= 2',
      'night value: >= 3 distinct sample timestamps spanning >= 20 min inside the primary sleep',
      'baseline: >= 7 nightly values (days for load) spanning >= 6 d',
    ],
    formula: {
      fn: `${READINESS_ID}@${version}`,
      text:
        'round1( clamp( Σ_k w_k·c_k / Σ_k w_k , 0, 100) ) over available k, ≥ 2 required. ' +
        'z = clamp((x − median_B)/max(IQR_B/1.349, floor), ±3) against prior primary nights (B: ≥ 7 values over ≥ 6 d); L(z) = 100/(1+e^(−1.2·clamp(z,±3))). ' +
        `HRV (night median, baseline ${days.hrv} d, floor max(0.1·median, 3 ms)): c = L(min(z, 1)), w 0.25. ` +
        `Resting HR (night p10, baseline ${days.rhr} d, floor 3 bpm): c = L(−z), w 0.15. ` +
        'Sleep: c = sleep.index (lumen-sleep-v4), w 0.30. ' +
        `Temperature (night median skin temp, baseline ${days.temp} d, floor 0.5 °C): c = 100·e^(−z²/2), w 0.10. ` +
        'Prior-day load (active minutes vs 30 prior days, floor 10 min): c = 100·e^(−max(0,z)²/2), w 0.10. ' +
        'Prior-day nutrition (planner score 0–100): c = score, w 0.10.',
    },
    params: [
      ...(Object.keys(RECOVERY_WEIGHTS) as ComponentId[]).map((k) => ({ name: `w_${k}`, value: RECOVERY_WEIGHTS[k], unit: '1', sourceRef: SRC, kind: 'engineering' as const })),
      { name: 'logistic_slope', value: 1.2, unit: '1/z', sourceRef: SRC, kind: 'engineering' },
      { name: 'z_clip', value: 3, unit: 'z', sourceRef: SRC, kind: 'engineering' },
      { name: 'hrv_z_cap', value: 1, unit: 'z', sourceRef: SRC, kind: 'engineering' },
      { name: 'iqr_to_sd', value: 1.349, unit: '1', sourceRef: SRC, kind: 'published' },
      { name: 'hrv_scale_floor_frac', value: 0.1, unit: '1', sourceRef: SRC, kind: 'engineering' },
      { name: 'hrv_scale_floor_min', value: 3, unit: 'ms', sourceRef: SRC, kind: 'engineering' },
      { name: 'rhr_scale_floor', value: 3, unit: 'bpm', sourceRef: SRC, kind: 'engineering' },
      { name: 'temp_scale_floor', value: 0.5, unit: '°C', sourceRef: SRC, kind: 'engineering' },
      { name: 'load_scale_floor', value: 10, unit: 'min', sourceRef: ENG, kind: 'engineering' },
      { name: 'baseline_min_count', value: 7, unit: 'nights', sourceRef: SRC, kind: 'engineering' },
      { name: 'baseline_min_span', value: 6, unit: 'd', sourceRef: SRC, kind: 'engineering' },
      { name: 'hrv_baseline_days', value: days.hrv, unit: 'd', sourceRef: mode === 'vitals60d' ? 'SUITE_SPEC §11 decision 15' : ENG, kind: 'engineering' },
      { name: 'rhr_temp_baseline_days', value: days.rhr, unit: 'd', sourceRef: ENG, kind: 'engineering' },
      { name: 'night_min_samples', value: 3, unit: 'samples', sourceRef: 'R10 §3 / InsightSamplePolicy.kt', kind: 'engineering' },
      { name: 'night_min_span', value: 20, unit: 'min', sourceRef: 'R10 §3 / InsightSamplePolicy.kt', kind: 'engineering' },
    ],
    output: { unit: 'index', range: [0, 100], goodDirection: 'up', display: 'number' },
    uncertainty: { method: 'none', notes: 'Heuristic composite, never "high" confidence (medium with ≥ 3 components incl. HRV or resting HR, else low). A normal day lands near 60–70 (R10 §3.8).' },
    evidence: {
      mechanism: { status: 'infoOnly', pathway: 'convenience composite of autonomic deviation, sleep, temperature, prior-day load and nutrition', engineNodes: [] },
      certainty: 'D',
      refs: [],
    },
    tierHandling: 'Any tier, within-person only (each z uses the same stream\'s own nightly baseline). Known Android weakness kept for parity: a value can be produced without HRV or resting HR (e.g. sleep + nutrition); confidence is then low (R10 §3.8).',
    planEffects: [{ target: 'display_only', rule: 'display only; never drives plan logic (its components do)', priority: 0 }],
    optInStreams: ['sleep_sessions', 'hr', 'hrv', 'skin_temp', 'daily_summary'],
    dependsOn: [SLEEP_INDEX_ID],
    compute(input: ScoreInput): ScoreResult {
      const w = androidInputsFromScoreInput(input);
      const day = recoveryInputsForWorld(w, mode);
      // Prefer the stored sleep.index of the sleep day (same function, same inputs); else the inline recompute.
      const stored = (input.prior[SLEEP_INDEX_ID] ?? []).find(
        (r) => r.scope.localDate === day.sleepDay && r.version === SLEEP_INDEX_VERSION && r.status === 'ok' && r.value !== null,
      );
      if (stored) day.args.sleepScore = stored.value;
      const r = computeRecoveryV4(day.args);
      const scope = { kind: 'day' as const, localDate: input.localDate };
      if (!r) return withheld(READINESS_ID, version, input, 'fewer than 2 of HRV, resting HR, sleep, temperature, prior-day load, prior-day nutrition available', scope);
      const inputs: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.inputs)) inputs[k] = round4(v);
      return makeResult(READINESS_ID, version, input, {
        scope,
        status: 'ok',
        value: r.published,
        confidence: r.confidence,
        contributors: toVitalsContributors(r.contributors),
        sourceIds: day.primarySessionId ? [day.primarySessionId] : [],
        hashOf: { mode, nowMs: w.nowMs, inputs: r.inputs, c: r.contributors.map((c) => [c.id, c.score]) },
        detail: { algorithm: ANDROID_RECOVERY_VERSION, baselineMode: mode, sleepDay: day.sleepDay, unrounded: r.value, ...inputs },
      });
    },
  };
}

export const readinessDef: ScoreDef = makeReadinessDef(READINESS_BASELINE_MODE);
/** Catalogue entries. The Android-parity variant is `makeReadinessDef(ANDROID_PARITY_BASELINE_MODE)`. */
export const readinessDefs: ScoreDef[] = [readinessDef];
