/**
 * Parity vectors for `lumen-recovery-v4` (InsightAlgorithms.recoveryScore + the LocalInsightEngine wiring).
 * Synthetic inputs only; expected values from hand-executing the Kotlin (no JVM available locally).
 * L(z) = 100/(1+e^(−1.2·clamp(z,±3))). L(1) = 76.85248, L(−1) = 23.14752.
 */
import type { DailyRecord, ResolvedDay, ScoreInput, ScoreResult, SleepRecord } from '@/biometrics/core/types';
import { androidInputsFromScoreInput, NUTRITION_PRIOR_SCORE_ID } from '../adapter';
import { computeBaselineStats, type BaselineStats } from '../kotlin';
import {
  ANDROID_PARITY_BASELINE_MODE, computeRecoveryV4, makeReadinessDef, READINESS_BASELINE_MODE, readinessDef, readinessDefs, recoveryInputsForWorld,
  type RecoveryArgs,
} from '../readiness';

/** InsightAlgorithmsTest.established(mean, sd). */
const est = (mean: number, sd: number): BaselineStats => ({ mean, median: mean, standardDeviation: sd, p25: mean - sd, p75: mean + sd, sampleCount: 30, spanDays: 14 });
const args = (p: Partial<RecoveryArgs>): RecoveryArgs => ({
  hrv: null, hrvBaseline: null, restingHr: null, restingHrBaseline: null, sleepScore: null, skinTemperature: null, temperatureBaseline: null, ...p,
});
const comp = (r: ReturnType<typeof computeRecoveryV4>, id: string) => r!.contributors.find((c) => c.id === id)!;

describe('recoveryScore parity vectors', () => {
  it('R1 sleep alone is withheld', () => {
    expect(computeRecoveryV4(args({ sleepScore: 82 }))).toBeNull();
  });

  it('R2 HRV + resting HR + sleep', () => {
    // HRV: floor max(0.1·50, 3) = 5; scale max(10/1.349, 5) = 7.4129; z = 10/7.4129 = 1.349 → L(min(z,1)) = 76.85248
    // RHR: z = −5/7.4129 = −0.6745 → L(+0.6745) = 69.19816
    // (76.85248·0.25 + 69.19816·0.15 + 80·0.30) / 0.70 = 53.59285/0.70 = 76.56121 → published 76.6; medium
    const r = computeRecoveryV4(args({ hrv: 60, hrvBaseline: est(50, 5), restingHr: 45, restingHrBaseline: est(50, 5), sleepScore: 80 }))!;
    expect(r.value).toBeCloseTo(76.5612058364676, 10);
    expect(r.published).toBe(76.6);
    expect(r.confidence).toBe('medium');
    expect(r.inputs.hrv_z).toBeCloseTo(1.349, 12);
    expect(r.inputs.resting_hr_z).toBeCloseTo(0.6745, 12);
    const poor = computeRecoveryV4(args({ hrv: 40, hrvBaseline: est(50, 5), restingHr: 60, restingHrBaseline: est(50, 5), sleepScore: 80 }))!;
    expect(poor.value).toBeLessThan(r.value);
  });

  it('R3 temperature + prior-day load; nutrition missing is explicit', () => {
    // temp: scale max(0.6/1.349 = 0.4448, 0.5) = 0.5; z = 0.3/0.5 = 0.6 → 100·e^(−0.18) = 83.52702
    // Σw = 0.25+0.15+0.30+0.10+0.10 = 0.9 (0.8999999999999999 in doubles) → 78.82838 → 78.8
    const r = computeRecoveryV4(args({
      hrv: 60, hrvBaseline: est(50, 5), restingHr: 45, restingHrBaseline: est(50, 5), sleepScore: 80,
      skinTemperature: 35.8, temperatureBaseline: { ...est(50, 5), median: 35.5, p25: 35.2, p75: 35.8 }, priorDayLoadBalanceScore: 90,
    }))!;
    expect(r.value).toBeCloseTo(78.82838466626671, 10);
    expect(r.published).toBe(78.8);
    expect(comp(r, 'temperature').score).toBeCloseTo(83.5270211411272, 10);
    expect(comp(r, 'temperature').value).toBeCloseTo(0.3, 12);
    const n = comp(r, 'prior_day_nutrition');
    expect(n).toMatchObject({ role: 'UNAVAILABLE', weight: 0, value: null });
    expect(r.contributors.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 12);
  });

  it('R4 quantized flat baseline after seven nights stays bounded', () => {
    // count 7, span 6, IQR 0. HRV z = 1/5 = 0.2 → 55.97136; RHR z = 1/3 → L(−1/3) = 40.13123
    // (55.97136·0.25 + 40.13123·0.15 + 24) / 0.7 = 62.87504 → 62.9
    const flat = { ...est(50, 0), sampleCount: 7, spanDays: 6 };
    const r = computeRecoveryV4(args({ hrv: 51, hrvBaseline: flat, restingHr: 51, restingHrBaseline: flat, sleepScore: 80 }))!;
    expect(r.value).toBeCloseTo(62.87503761427578, 10);
    expect(r.published).toBe(62.9);
  });

  it('R5 baselines with 6 nights or 5.9 d span are unusable; sleep + nutrition still emits (Android weakness kept)', () => {
    const six = { ...est(50, 0), sampleCount: 6, spanDays: 6 };
    const short = { ...est(50, 0), sampleCount: 7, spanDays: 5.9 };
    // (80·0.3 + 70·0.1)/0.4 = 77.5; no HRV/RHR → low
    const r = computeRecoveryV4(args({ hrv: 51, hrvBaseline: six, restingHr: 51, restingHrBaseline: short, sleepScore: 80, priorDayNutritionScore: 70 }))!;
    expect(r.value).toBe(77.5);
    expect(r.confidence).toBe('low');
    expect(comp(r, 'hrv').role).toBe('UNAVAILABLE');
    expect(comp(r, 'hrv').value).toBe(51); // raw still shown, as Android
  });

  it('R6 z clipping and the HRV cap at +1', () => {
    // HRV z = 150/7.4129 → clip 3 → cap 1 → 76.85248; RHR z = 50/7.4129 → clip 3 → L(−3) = 2.65970; load 0
    // (76.85248·0.25 + 2.65970·0.15 + 0) / 0.5 = 39.22415 → 39.2; 3 comps incl. physiology → medium
    const r = computeRecoveryV4(args({ hrv: 200, hrvBaseline: est(50, 5), restingHr: 100, restingHrBaseline: est(50, 5), priorDayLoadBalanceScore: 0 }))!;
    expect(r.value).toBeCloseTo(39.22414898225686, 10);
    expect(r.published).toBe(39.2);
    expect(r.confidence).toBe('medium');
    expect(r.inputs.hrv_z).toBe(3);
  });

  it('R7 out-of-range inputs drop their component (HRV 1–300, RHR 30–220, temp 20–45)', () => {
    const b = est(50, 5);
    for (const [hrv, rhr, temp] of [[0.5, 25, 19], [350, 230, 46]] as const) {
      const r = computeRecoveryV4(args({ hrv, hrvBaseline: b, restingHr: rhr, restingHrBaseline: b, skinTemperature: temp, temperatureBaseline: est(34, 0.5), sleepScore: 60, priorDayLoadBalanceScore: 100 }))!;
      // (60·0.3 + 100·0.1)/0.4 = 70
      expect(r.value).toBeCloseTo(70, 12);
      expect(['hrv', 'resting_hr', 'temperature'].map((id) => comp(r, id).role)).toEqual(['UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE']);
    }
  });

  it('R8 published rounding: 78.75 → 787.5 → roundToInt 788 → 78.8 (ties up)', () => {
    const r = computeRecoveryV4(args({ sleepScore: 80, priorDayNutritionScore: 75 }))!;
    expect(r.value).toBe(78.75);
    expect(r.published).toBe(78.8);
  });

  it('R9 sleep and nutrition clamp to 0–100; NaN components are skipped', () => {
    // (100·0.3 + 0·0.1)/0.4 = 75
    expect(computeRecoveryV4(args({ sleepScore: 120, priorDayNutritionScore: -5 }))!.value).toBe(75);
    expect(computeRecoveryV4(args({ sleepScore: NaN, priorDayNutritionScore: 50, priorDayLoadBalanceScore: NaN }))).toBeNull();
  });

  it('R10 weights renormalise over available components and the contributor list is always six long', () => {
    const r = computeRecoveryV4(args({ sleepScore: 50, priorDayLoadBalanceScore: 100 }))!;
    expect(r.contributors.map((c) => c.id)).toEqual(['hrv', 'resting_hr', 'sleep', 'temperature', 'prior_day_load', 'prior_day_nutrition']);
    expect(comp(r, 'sleep').weight).toBeCloseTo(0.75, 12);
    expect(comp(r, 'prior_day_load').weight).toBeCloseTo(0.25, 12);
    expect(r.value).toBeCloseTo(62.5, 12);
  });

  it('BaselineStats re-derivation: interpolated quartiles, population SD, span days', () => {
    const b = computeBaselineStats([1, 2, 3, 4, 0, -1].map((v, i) => ({ t: i * 86_400_000, value: v })))!;
    expect(b).toMatchObject({ median: 2.5, p25: 1.75, p75: 3.25, sampleCount: 4, spanDays: 3, mean: 2.5 });
    expect(b.standardDeviation).toBeCloseTo(Math.sqrt(1.25), 12);
    expect(computeBaselineStats([{ t: 0, value: 5 }])).toBeNull();
  });
});

// ---------------------------------------------------------------- end-to-end through the ScoreInput adapter

const D = '2026-09-16';
const H = 3_600_000;
const M = 60_000;
const at = (date: string, hour: number): number => Date.parse(`${date}T00:00:00Z`) + hour * H;
const iso = (ms: number) => new Date(ms).toISOString();
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const common = {
  version: 1,
  provenance: { channel: 'manual' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-09-16T00:00:00.000Z' },
  quality: { validation: 'vendor_proprietary' as const, confidence: null, flags: [] },
};

/**
 * Nights for waking days D−12..D (23:00 → 07:00, LIGHT 480) plus D−45..D−31 (HRV only, value 100).
 * Samples at +60/+120/+180 min: prior HRV 50 / HR 50 / temp 34.0; current HRV 60 / HR 53 / temp 34.25.
 * Active minutes D−31..D−2 alternate 20/40, D−1 = 60. Nutrition D−1 = 80.
 */
function fixture(): ScoreInput {
  const days: ResolvedDay[] = [];
  const series: ScoreInput['series'] = { hr: [], hrv: [], skin_temp: [] };
  const push = (k: 'hr' | 'hrv' | 'skin_temp', t: number, value: number) => series[k]!.push({ t, value, tier: 'C', sourceKey: 'ring' });
  for (let k = 45; k >= 0; k--) {
    const date = shift(D, -k);
    const day: ResolvedDay = { localDate: date, sleeps: [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [] };
    const hasNight = k <= 12 || (k >= 31 && k <= 45);
    if (hasNight) {
      const start = at(shift(date, -1), 23);
      const s: SleepRecord = {
        ...common, kind: 'sleep', record_id: `n${date}`, is_main: true, asleep_s: 480 * 60,
        time: { start: iso(start), end: iso(start + 480 * M), tz_offset_s: 0, local_date: date },
        stages: [{ start: iso(start), end: iso(start + 480 * M), stage: 'light' }],
      };
      day.sleeps.push(s);
      day.mainSleep = s;
      for (const off of [60, 120, 180]) {
        const t = start + off * M;
        if (k >= 31) push('hrv', t, 100);
        else {
          push('hrv', t, k === 0 ? 60 : 50);
          push('hr', t, k === 0 ? 53 : 50);
          push('skin_temp', t, k === 0 ? 34.25 : 34);
        }
      }
    }
    if (k >= 1 && k <= 31) {
      const active = k === 1 ? 60 : k % 2 ? 20 : 40;
      const daily: DailyRecord = { ...common, kind: 'daily', record_id: `d${date}`, time: { tz_offset_s: 0, local_date: date }, active_min: { light: 0, moderate: active, vigorous: 0 } };
      day.daily = daily;
    }
    days.push(day);
  }
  const nutrition: ScoreResult = {
    scoreId: NUTRITION_PRIOR_SCORE_ID, version: '1', scope: { kind: 'day', localDate: shift(D, -1) }, status: 'ok', value: 80, confidence: 'low',
    contributors: [], inputsHash: 'x', sourceIds: [], computedAt: '2026-09-16T00:00:00.000Z', build: 't',
  };
  return {
    localDate: D, tz: 'UTC', profile: {}, days, series, workouts: [], prior: { [NUTRITION_PRIOR_SCORE_ID]: [nutrition] },
    computedAt: `${D}T12:00:00.000Z`, build: 'test',
  };
}

describe('LocalInsightEngine wiring via androidInputsFromScoreInput', () => {
  it('E1 Android-parity mode (30-day baselines)', () => {
    // HRV: 12 prior nights of median 50 (IQR 0, floor 5): z = 10/5 = 2 → cap 1 → 76.85248
    // RHR: night p10 50 ×12; current p10(53,53,53) = 53: z = 3/3 = 1 → L(−1) = 23.14752
    // temp: 34.25 vs 34 (floor 0.5): z = 0.5 → 100·e^(−0.125) = 88.24969
    // sleep: 480/480, eff 100, same midpoint as 12 priors → 100
    // load: 30 days 15×20 + 15×40 → median 30, p25 20, p75 40 → scale 14.826; z = 30/14.826 = 2.0235 → 100·e^(−2.0473) = 12.90860
    // nutrition 80. Σw = 0.9999999999999999 → 70.80108 → 70.8
    const w = androidInputsFromScoreInput(fixture());
    expect(w.nowMs).toBe(at(D, 12));
    const day = recoveryInputsForWorld(w, ANDROID_PARITY_BASELINE_MODE);
    expect(day.sleepDay).toBe(D);
    expect(day.args.sleepScore).toBe(100);
    expect(day.args.hrvBaseline).toMatchObject({ median: 50, sampleCount: 12, spanDays: 11 });
    expect(day.args.priorDayLoadBalanceScore).toBeCloseTo(12.908603938121496, 10);
    const r = computeRecoveryV4(day.args)!;
    expect(r.value).toBeCloseTo(70.8010772546483, 9);
    expect(r.published).toBe(70.8);
    const def = makeReadinessDef('android');
    const out = def.compute(fixture());
    expect(out).toMatchObject({ status: 'ok', value: 70.8, confidence: 'medium', version: '1.0.0+android-parity' });
  });

  it('E2 vitals60d mode: HRV baseline reaches back 60 days (decision 15)', () => {
    // 12 nights at 50 + 15 nights at 100 (31–45 d ago): n = 27, median = sorted[13] = 100, p25 = 50, p75 = 100
    // scale = max(50/1.349, 10) = 37.064; z = (60 − 100)/37.064 = −1.0792 → L = 21.50010
    // (21.50010·0.25 + 23.14752·0.15 + 30 + 8.82497 + 1.29086 + 8) / Σw = 56.96298 → 57
    expect(READINESS_BASELINE_MODE).toBe('vitals60d');
    const r = readinessDef.compute(fixture());
    expect(r.status).toBe('ok');
    expect(r.value).toBe(57);
    expect(r.detail?.unrounded as number).toBeCloseTo(56.962981673998776, 9);
    expect(r.version).toBe('1.0.0');
    expect(readinessDefs).toEqual([readinessDef]);
  });

  it('E3 a stored sleep.index for the sleep day replaces the inline recompute; withheld with < 2 components', () => {
    const input = fixture();
    const sleep: ScoreResult = { ...input.prior[NUTRITION_PRIOR_SCORE_ID]![0]!, scoreId: 'sleep.index', version: '4.0.0', scope: { kind: 'night', localDate: D }, value: 40 };
    const a = makeReadinessDef('android').compute({ ...input, prior: { ...input.prior, 'sleep.index': [sleep] } });
    expect(a.contributors.find((c) => c.id === 'sleep')).toMatchObject({ raw: 40, component: 40 });
    const empty = readinessDef.compute({ ...input, days: input.days.map(({ mainSleep: _m, ...d }) => ({ ...d, sleeps: [] })), prior: {} });
    // no night → no HRV/RHR/temp, no sleep; only the load component → withheld
    expect(empty).toMatchObject({ status: 'withheld', value: null });
  });

  it('E4 before 04:00 the sleep day is the previous waking day (referenceNightLocal)', () => {
    const w = androidInputsFromScoreInput(fixture(), { nowMs: at(D, 3) });
    expect(recoveryInputsForWorld(w).sleepDay).toBe(shift(D, -1));
  });
});
