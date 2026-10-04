import { describe, expect, it } from 'vitest';
import { planEffectProposals, toActivityInputs, toDisplayOnly, toSleepInputs, toVo2Observation, toVo2TestObservation } from '../engineAdapter';
import { defaultMatrix, setPolicy, suggestedOnPolicy } from '../policy';
import type { PolicyMatrix } from '../policy';
import { makeResult } from '../scores/util';
import { daily, makeInput, resolved, sleep, workout } from '../scores/__tests__/fixtures';
import type { PolicyStream, ScoreResult } from '../types';

const on = (...streams: PolicyStream[]): PolicyMatrix => streams.reduce((m, s) => setPolicy(m, s, suggestedOnPolicy(s)), defaultMatrix());
const date = '2026-05-10';
const res = (id: string, p: Partial<ScoreResult> & { value?: number | null; state?: string; detail?: ScoreResult['detail'] } = {}): ScoreResult =>
  makeResult(id, '1.0.0', makeInput(date), { status: 'ok', value: p.value ?? 1, ...(p.state ? { state: p.state } : {}), ...(p.detail ? { detail: p.detail } : {}), ...(p.contributors ? { contributors: p.contributors } : {}) });

describe('toSleepInputs', () => {
  const day = resolved(date, { mainSleep: sleep(date, { efficiency_pct: 90 }), sourceByMetric: { sleep: 'ring' } });
  it('policy off → nothing', () => {
    expect(toSleepInputs(day, [], defaultMatrix())).toBeNull();
    expect(toSleepInputs(day, [], setPolicy(defaultMatrix(), 'sleep_sessions', { imported: true, scores: true }))).toBeNull();
  });
  it('maps bed/wake hours, sleep hours, quality from efficiency; marks provenance', () => {
    const r = toSleepInputs(day, [], on('sleep_sessions'))!;
    expect(r.sleepBedH).toBeCloseTo(23, 6);
    expect(r.sleepWakeH).toBeCloseTo(7, 6);
    expect(r.sleepHours).toBe(7);
    expect(r.sleepQuality).toBeCloseTo(0.8, 6);
    expect(r.sleepQualityClass).toBe(2);
    expect(r.assumedVsMeasured).toEqual({ sleepBedH: 'measured', sleepWakeH: 'measured', sleepHours: 'measured', sleepQuality: 'estimated' });
    expect(r.source).toEqual({ recordId: `s-${date}`, version: 1, sourceKey: 'ring' });
  });
  it('sleep.index overrides efficiency; no quality source → assumed', () => {
    const r = toSleepInputs(day, [res('sleep.index', { value: 55 })], on('sleep_sessions'))!;
    expect(r.sleepQuality).toBeCloseTo(0.55, 6);
    expect(r.sleepQualityClass).toBe(0);
    const bare = toSleepInputs(resolved(date, { mainSleep: sleep(date) }), [], on('sleep_sessions'))!;
    expect(bare.assumedVsMeasured.sleepQuality).toBe('assumed');
    expect(bare.sleepQualityClass).toBe(0);
  });
  it('local offset shifts bed/wake hours', () => {
    const s = sleep(date, { time: { start: '2026-05-09T21:00:00.000Z', end: '2026-05-10T05:00:00.000Z', local_date: date, tz_offset_s: 7200 } });
    const r = toSleepInputs(resolved(date, { mainSleep: s }), [], on('sleep_sessions'))!;
    expect(r.sleepBedH).toBeCloseTo(23, 6);
    expect(r.sleepWakeH).toBeCloseTo(7, 6);
  });
  it('no main sleep → null', () => {
    expect(toSleepInputs(resolved(date), [], on('sleep_sessions'))).toBeNull();
  });
});

describe('toActivityInputs', () => {
  const w = workout(date, { exercise_type: 'run', active_duration_s: 2400, load: { value: 99, method: 'vendor' } });
  const day = resolved(date, { daily: daily(date, { steps: 8000 }), workouts: [w] });
  it('policy off → nothing; steps and workouts gated separately', () => {
    expect(toActivityInputs(day, defaultMatrix())).toBeNull();
    const s = toActivityInputs(day, on('steps'))!;
    expect(s.steps).toBe(8000);
    expect(s.workouts).toEqual([]);
    const wk = toActivityInputs(day, on('workouts'))!;
    expect(wk.steps).toBeNull();
    expect(wk.workouts).toHaveLength(1);
  });
  it('workout load: own TRIMP/sRPE first, vendor load never used', () => {
    const trimp = res('load.trimp', { value: 50, contributors: [{ id: w.record_id, raw: 42, unit: 'AU', weightConfigured: 1, weightApplied: 1, available: true }] });
    expect(toActivityInputs(day, on('workouts'), [trimp])!.workouts[0]).toMatchObject({ durationMin: 40, exerciseType: 'run', load: { value: 42, method: 'trimp' } });
    expect(toActivityInputs(day, on('workouts'))!.workouts[0]!.load).toBeNull();
    const own = workout(date, { load: { value: 70, method: 'srpe' } });
    expect(toActivityInputs(resolved(date, { workouts: [own] }), on('workouts'))!.workouts[0]!.load).toEqual({ value: 70, method: 'srpe' });
  });
  it('start hour in the local day', () => {
    expect(toActivityInputs(day, on('workouts'))!.workouts[0]!.startH).toBeCloseTo(7, 6);
  });
});

describe('VO2max observation', () => {
  const post = res('fitness.vo2max', { value: 47.2, detail: { posteriorSd: 2.1 } });
  it('policy off → null; on → posterior with SD', () => {
    expect(toVo2Observation(post, defaultMatrix())).toBeNull();
    expect(toVo2Observation(post, on('daily_summary'))).toEqual({ kind: 'vo2max', valueMlKgMin: 47.2, sdMlKgMin: 2.1, method: 'posterior', localDate: date });
  });
  it('wrong score, withheld or missing SD → null', () => {
    expect(toVo2Observation(res('hr.rhr_night'), on('daily_summary'))).toBeNull();
    expect(toVo2Observation(res('fitness.vo2max', { value: 40 }), on('daily_summary'))).toBeNull();
    expect(toVo2Observation({ ...post, status: 'withheld', value: null }, on('daily_summary'))).toBeNull();
  });
  it('lab/field tests yes, vendor and derived never', () => {
    const d = (m: 'lab' | 'field_test' | 'vendor_estimate' | 'derived') => resolved(date, { daily: daily(date, { vo2max: { ml_kg_min: 50, method: m } }) });
    expect(toVo2TestObservation(d('lab'), on('daily_summary'))).toMatchObject({ method: 'lab', valueMlKgMin: 50 });
    expect(toVo2TestObservation(d('field_test'), on('daily_summary'))!.sdMlKgMin).toBe(5);
    expect(toVo2TestObservation(d('vendor_estimate'), on('daily_summary'))).toBeNull();
    expect(toVo2TestObservation(d('derived'), on('daily_summary'))).toBeNull();
    expect(toVo2TestObservation(d('lab'), defaultMatrix())).toBeNull();
  });
});

describe('display and plan proposals', () => {
  it('toDisplayOnly flags states and routes briefing items', () => {
    const items = toDisplayOnly([res('illness.nightsignal', { state: 'red' }), res('hrv.status', { state: 'below' }), res('spo2.night'), res('readiness.index', { value: 60 })]);
    expect(items.map((i) => [i.scoreId, i.flag, i.target])).toEqual([
      ['illness.nightsignal', 'alert', 'trainer_briefing'], ['hrv.status', 'watch', 'trainer_briefing'], ['spo2.night', 'none', 'display_only'], ['readiness.index', 'none', 'display_only'],
    ]);
  });
  it('conflict rule: illness red > HRV below > sleep debt > load; suppressed effects remain reported', () => {
    const { proposals, activeFlags } = planEffectProposals([
      res('illness.nightsignal', { state: 'red' }), res('hrv.status', { state: 'below' }), res('sleep.debt', { value: 2, detail: { dF: 2 } }), res('load.ewma', { value: 50 }),
    ]);
    expect(activeFlags.map((f) => f.scoreId)).toEqual(['illness.nightsignal', 'hrv.status', 'sleep.debt']);
    const intensity = proposals.filter((p) => p.target === 'training_intensity');
    expect(intensity.find((p) => p.active)!.scoreId).toBe('illness.nightsignal');
    expect(intensity.filter((p) => !p.active).map((p) => p.suppressedBy)).toEqual(['illness.nightsignal', 'illness.nightsignal']);
    expect(proposals.find((p) => p.target === 'fast_permission' && p.active)!.scoreId).toBe('illness.nightsignal');
    expect(proposals.find((p) => p.target === 'training_volume')!.active).toBe(true);
    expect(proposals.every((p) => p.lowersLoad)).toBe(true);
  });
  it('HRV below beats sleep debt when no illness; yellow illness only briefs', () => {
    const a = planEffectProposals([res('hrv.status', { state: 'below' }), res('sleep.debt', { detail: { dF: 2 } })]);
    expect(a.proposals.find((p) => p.target === 'fast_permission' && p.active)!.scoreId).toBe('hrv.status');
    const b = planEffectProposals([res('illness.nightsignal', { state: 'yellow' })]);
    expect(b.proposals).toEqual([]);
    expect(b.activeFlags[0]!.state).toBe('yellow');
  });
  it('small sleep debt and withheld scores do nothing', () => {
    expect(planEffectProposals([res('sleep.debt', { detail: { dF: 1 } }), { ...res('hrv.status', { state: 'below' }), status: 'withheld' }]).proposals).toEqual([]);
  });
});
