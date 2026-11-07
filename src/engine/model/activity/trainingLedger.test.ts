// @vitest-environment node
/**
 * D3-03 (interval phases, guideline minutes apart from the fitness MEM), D3-07 (one bout ledger, step/session overlap on
 * both sides) and D3-08 (no prolonged RT afterburn in production; one finite recovery budget per bout in research) for the
 * activity module and its shared helpers.
 */
import { describe, expect, it } from 'vitest';
import { buildModelParams, sampleParams } from '../../core/paramsRegistry';
import { boutCost, reconcileBoutMinutes, stepLedgerSteps, stepsAboveHabitual, stepsOverlapStatus, KCAL_PER_KG_H_PER_MET } from '../../core/exerciseCost';
import { activityReference } from '../../core/activityReference';
import { habitualWeek } from '../../core/compileSchedule';
import { createSignalBus, type SignalBus } from '../../types/signals';
import type { AnyEngineModule } from '../../types/module';
import type { DayInput, SessionResolved } from '../../types/inputs';
import { cardio, makeCtx, makeDay, miniRun, person, resistance, withSessions } from '../moderators/testkit';
import {
  ACTIVITY_MODEL_ASSUMPTIONS,
  ACTIVITY_PARAMS,
  activityConstants,
  activityOutputStatus,
  activityModule,
  dayAerobicDose,
  dayHealthMinutes,
  dayLedgerSteps,
  healthClassFromRelativeEffort,
  healthClassFromTalkTest,
  healthEquivalentMinutes,
  recoveryKernel,
  recoveryKernelIntegral,
  sessionGrossKcalPerMin,
  sessionsBookedKcal,
  stepsOverlapAssumption,
  STEPS_OVERLAP_UNKNOWN,
} from './index';

const mods = [activityModule] as unknown as readonly AnyEngineModule[];
type K = ReturnType<typeof activityModule.prepare>;
const P75 = person({ body: { weightKg: 75, heightCm: 175 }, labs: { measuredRmrKcal: 1750, vo2maxMlKgMin: 42 } });
const ctxFor = (ov: Record<string, number> = {}) => makeCtx(mods, P75, ov);
function busFor(w = 75, rmrKcalD = 1750): SignalBus {
  const b = createSignalBus();
  b.scaleWeightKg = w;
  b.tissueMassKg = w;
  b.rmrKcalH = rmrKcalD / 24;
  return b;
}
const sum = (a: number[], from = 0, to = a.length): number => a.slice(from, to).reduce((x, y) => x + y, 0);

/** Run days and log exEE / steps energy per hour. */
function runDays(build: (pr: ReturnType<typeof ctxFor>['profile'], d: number) => DayInput, nDays: number, ov: Record<string, number> = {}) {
  const ctx = ctxFor(ov);
  const exEE: number[] = [];
  const steps: number[] = [];
  const planned: number[] = [];
  const run = miniRun(mods, ctx, Array.from({ length: nDays }, (_, d) => ({ clockDay: d, day: build(ctx.profile, d) })), {
    bus: busFor(),
    afterHour: (_d, _h, bus) => {
      exEE.push(bus.exEEKcalH);
      steps.push(bus.stepsExtraKcalH);
      planned.push(bus.exPlannedKcalD);
    },
  });
  return { exEE, steps, planned, k: run.K[0] as K, ctx };
}

describe('D3-08 resistance recovery energy', () => {
  it('production: no prolonged RT-REE and no residual RT budget, in the nominal run and in every draw', () => {
    const by = (n: string) => ACTIVITY_PARAMS.find((p) => p.id === `activity.${n}`)!;
    expect(by('postRtRee')).toMatchObject({ value: 0, draw: 'fixed' });
    expect(by('epocRt')).toMatchObject({ value: 0, draw: 'fixed' });
    const draws = sampleParams(ACTIVITY_PARAMS, { count: 32, seed: 7 });
    const iPost = ACTIVITY_PARAMS.findIndex((p) => p.id === 'activity.postRtRee');
    const iRt = ACTIVITY_PARAMS.findIndex((p) => p.id === 'activity.epocRt');
    for (const v of draws) {
      expect(v[iPost]).toBe(0);
      expect(v[iRt]).toBe(0);
    }
    expect(ACTIVITY_MODEL_ASSUMPTIONS).toContain('rtRecoveryZeroCentral');
  });

  it('production: after an RT session no recovery energy is booked, today, overnight or on later days (planned estimate included)', () => {
    const { exEE, planned, k } = runDays((pr, d) => (d === 0 ? withSessions(makeDay(pr), [resistance(8, 60, 3.5)]) : makeDay(pr)), 4);
    expect(k.rtRecoveryMode).toBe('none');
    for (let h = 9; h < 96; h++) expect(exEE[h]).toBe(0);
    expect(planned[30]).toBe(0); // day 1: nothing planned, no carried rectangle
  });

  it('the R-MAINT reference shares the mode: a rest day after RT books no post-RT energy', () => {
    const ctx = ctxFor();
    const pr = ctx.profile;
    const rt = withSessions(makeDay(pr), [resistance(8, 60, 3.5)]);
    const rest = makeDay(pr);
    const ref = activityReference(pr, [rt, rest, rest], [], 0, () => habitualWeek(pr));
    expect(ref.constants.act.postRtRee).toBe(0);
    // the rest days' booked activity is the step term only (habitual steps: zero)
    expect(ref.dayKcal[1]).toBeCloseTo(0, 9);
    expect(ref.dayKcal[2]).toBeCloseTo(0, 9);
  });

  it('research budget: one finite budget per bout, released once by the normalised kernel across midnight', () => {
    const phi = 0.05;
    // a session at 23:00 so the release runs over midnight into the next day
    const { exEE, k } = runDays((pr, d) => (d === 0 ? withSessions(makeDay(pr), [resistance(23, 60, 3.5)]) : makeDay(pr)), 3, { 'activity.epocRt': phi });
    expect(k.rtRecoveryMode).toBe('budget');
    const s = resistance(23, 60, 3.5) as SessionResolved;
    const net = (sessionGrossKcalPerMin(k, { ...s, setsByRegion: new Float64Array(9) } as SessionResolved, 42, 75, 1.75, 1750 / 1440, 75 / 1.75 ** 2) - 1750 / 1440) * 60;
    // hour 23 holds the session's incremental cost; the recovery is released from the next hour on
    const released = sum(exEE, 24, 72);
    expect(released).toBeCloseTo(phi * net, 1);
    expect(released).toBeLessThanOrEqual(phi * net + 1e-9);
  });

  it('research: the budget and the Heden rectangle are never booked together (the budget wins)', () => {
    const both = runDays((pr, d) => (d === 0 ? withSessions(makeDay(pr), [resistance(8, 60, 3.5)]) : makeDay(pr)), 4, { 'activity.epocRt': 0.05, 'activity.postRtRee': 0.05 });
    const budget = runDays((pr, d) => (d === 0 ? withSessions(makeDay(pr), [resistance(8, 60, 3.5)]) : makeDay(pr)), 4, { 'activity.epocRt': 0.05 });
    expect(both.k.postRtRee).toBe(0);
    expect(both.exEE).toEqual(budget.exEE);
    const rect = runDays((pr, d) => (d === 0 ? withSessions(makeDay(pr), [resistance(8, 60, 3.5)]) : makeDay(pr)), 4, { 'activity.postRtRee': 0.05 });
    expect(rect.k.rtRecoveryMode).toBe('legacyRectangle');
  });

  it('research budget tends to zero with the dose', () => {
    const rel = (min: number): number => {
      const { exEE } = runDays((pr, d) => (d === 0 ? withSessions(makeDay(pr), [resistance(8, min, 3.5)]) : makeDay(pr)), 3, { 'activity.epocRt': 0.1 });
      return sum(exEE, 10, 72);
    };
    const big = rel(60);
    const tiny = rel(1);
    expect(big).toBeGreaterThan(0);
    expect(tiny).toBeLessThan(big / 30);
  });

  it('the recovery kernel integrates to 1 (share a = 0.6, τ 0.4 h / 4 h): a finite budget, hour shares sum to it', () => {
    expect(recoveryKernelIntegral(0, 1e6, 0.6, 0.4, 4)).toBeCloseTo(1, 12);
    let acc = 0;
    for (let h = 0; h < 200; h++) acc += recoveryKernelIntegral(h, h + 1, 0.6, 0.4, 4);
    expect(acc).toBeCloseTo(1, 12);
    expect(recoveryKernel(-1, 0.6, 0.4, 4)).toBe(0);
    // trapezoid check of the density against the closed form over the first hour
    let tr = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) tr += (0.5 * (recoveryKernel(i / n, 0.6, 0.4, 4) + recoveryKernel((i + 1) / n, 0.6, 0.4, 4))) / n;
    expect(tr).toBeCloseTo(recoveryKernelIntegral(0, 1, 0.6, 0.4, 4), 6);
  });
});

describe('D3-03 interval phases and guideline minutes', () => {
  const k = activityModule.prepare(ctxFor());
  /** 10 × (1 min work at x 0.9 + 1 min recovery at x 0.3): 20 min. */
  const intervals = (): Partial<SessionResolved> => ({
    ...cardio(10, 20, 0.6, 3),
    phases: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? { kind: 'work' as const, durationMin: 1, pctVo2max: 0.9 } : { kind: 'recovery' as const, durationMin: 1, pctVo2max: 0.3 })),
  });

  it('10 × 1 min work / 1 min recovery: 10 hard minutes (not 20), energy = the sum of the phases', () => {
    const pr = ctxFor().profile;
    const day = withSessions(makeDay(pr), [intervals()]);
    const out = new Float64Array(2);
    dayAerobicDose(k, day, 42, 75, 75 / 1.75 ** 2, 1750 / 24, out);
    expect(out[1]).toBeCloseTo(10, 9);
    const meanDay = withSessions(makeDay(pr), [cardio(10, 20, 0.9, 3)]);
    dayAerobicDose(k, meanDay, 42, 75, 75 / 1.75 ** 2, 1750 / 24, out);
    expect(out[1]).toBeCloseTo(20, 9); // work intensity held for the whole session would double them
    // energy: Σ phases of (net − displaced + EPOC), recovery not at work intensity
    const booked = sessionsBookedKcal(k, day, 42, 75, 75 / 1.75 ** 2, 1750 / 24);
    const allWork = sessionsBookedKcal(k, meanDay, 42, 75, 75 / 1.75 ** 2, 1750 / 24);
    expect(booked).toBeLessThan(allWork);
    const rmrMin = 1750 / 1440;
    const work = 0.9 * 42 * 75 * 5 / 1000 - rmrMin;
    const rec = 0.3 * 42 * 75 * 5 / 1000 - rmrMin;
    const netSum = 10 * work + 10 * rec;
    expect(booked).toBeGreaterThanOrEqual(netSum - k.displaced * rmrMin * 20 - 1e-9); // EPOC only adds
  });

  it('the hourly path integrates the same phases (energy and hard minutes agree with the day estimators)', () => {
    const { exEE, k: kk } = runDays((pr, d) => (d === 0 ? withSessions(makeDay(pr), [intervals()]) : makeDay(pr)), 2);
    const pr = ctxFor().profile;
    const booked = sessionsBookedKcal(kk, withSessions(makeDay(pr), [intervals()]), 42, 75, 75 / 1.75 ** 2, 1750 / 24);
    // the session's net − displaced is booked in its hour, EPOC released later: totals agree over two days
    expect(sum(exEE, 10, 48)).toBeCloseTo(booked, 1);
  });

  it('guideline minutes: 75 vigorous = 150 equivalent = 150 moderate; light and unknown are not counted as zero activity', () => {
    const pr = ctxFor().profile;
    const out = new Float64Array(4);
    dayHealthMinutes(k, withSessions(makeDay(pr), [{ ...cardio(10, 75, 0.8, 2), healthIntensityClass: 'vigorous' }]), out);
    expect(healthEquivalentMinutes(out[0]!, out[1]!, k.health)).toBe(150);
    dayHealthMinutes(k, withSessions(makeDay(pr), [{ ...cardio(10, 150, 0.5, 1), healthIntensityClass: 'moderate' }]), out);
    expect(healthEquivalentMinutes(out[0]!, out[1]!, k.health)).toBe(150);
    dayHealthMinutes(k, withSessions(makeDay(pr), [cardio(10, 40, 0.5, 1)]), out);
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 40]); // unknown class: 40 unknown minutes, not zero activity
    // no minimum bout length: 3 × 5 min moderate count 15
    dayHealthMinutes(k, withSessions(makeDay(pr), [0, 1, 2].map((i) => ({ ...cardio(8 + i, 5, 0.5, 1), healthIntensityClass: 'moderate' as const }))), out);
    expect(out[0]).toBe(15);
  });

  it('interval phases rated on the generic relative-effort scale: recovery is not vigorous work', () => {
    const pr = ctxFor().profile;
    const out = new Float64Array(4);
    // A1-062: phase ratings classify only on the declared generic scale (a CR10 or unscaled rating leaves them unknown)
    const s = {
      ...cardio(10, 20, 0.6, 3),
      healthIntensityClass: 'vigorous' as const,
      phases: Array.from({ length: 20 }, (_, i) => ({ kind: (i % 2 === 0 ? 'work' : 'recovery') as 'work' | 'recovery', durationMin: 1, rpe: i % 2 === 0 ? 8 : 3, rpeScale: 'relativeEffort0To10' as const })),
    };
    dayHealthMinutes(k, withSessions(makeDay(pr), [s]), out);
    expect(out[1]).toBe(10);
    expect(out[3]).toBe(10);
  });

  it('changing the VO2max prior alone never changes classified guideline minutes', () => {
    const a = activityModule.prepare(makeCtx(mods, person({ labs: { vo2maxMlKgMin: 30 } })));
    const b = activityModule.prepare(makeCtx(mods, person({ labs: { vo2maxMlKgMin: 55 } })));
    expect(a.v0).not.toBe(b.v0);
    const pr = ctxFor().profile;
    const day = withSessions(makeDay(pr), [{ ...cardio(10, 45, 0.6, 1), healthIntensityClass: 'moderate' }]);
    const oa = new Float64Array(4);
    const ob = new Float64Array(4);
    dayHealthMinutes(a, day, oa);
    dayHealthMinutes(b, day, ob);
    expect(Array.from(oa)).toEqual(Array.from(ob));
  });

  it('the VO2max trajectory is a fitness-response scenario (C6 status), never a measured-like value', () => {
    expect(activityOutputStatus()).toEqual({ vo2max: { status: 'scenario', reasonCode: 'fitnessResponseScenario', uncertaintyKind: 'scenario' } });
  });

  it('talk test and relative exertion use the WHO definitions', () => {
    expect(healthClassFromTalkTest('talkNotSing')).toBe('moderate');
    expect(healthClassFromTalkTest('fewWords')).toBe('vigorous');
    expect(healthClassFromTalkTest('canSing')).toBe('light');
    expect(healthClassFromTalkTest('fullSentences')).toBe('unknown'); // full sentences alone do not prove light
    expect(healthClassFromRelativeEffort(5, k.health)).toBe('moderate');
    expect(healthClassFromRelativeEffort(7, k.health)).toBe('vigorous');
    expect(healthClassFromRelativeEffort(3, k.health)).toBe('light');
  });
});

describe('D3-07 one bout ledger and step/session overlap', () => {
  it('net above own rest = max(0, gross − RMR·min/1440); incremental = net − displaced, signed (never clamped)', () => {
    const c = boutCost({ grossKcal: 300, durationMin: 60, rmrKcalPerDay: 1440, displacedFracOfRmr: 0.2, method: 'compendiumMet', source: 'estimated' });
    expect(c).toMatchObject({ grossKcal: 300, ownRestKcal: 60, netAboveRestKcal: 240, displacedLifestyleKcal: 12, incrementalKcal: 228, restBasis: 'personalRmr' });
    // a bout barely above rest that replaces costlier lifestyle activity: negative incremental energy
    const low = boutCost({ grossKcal: 62, durationMin: 60, rmrKcalPerDay: 1440, displacedFracOfRmr: 0.2, method: 'compendiumMet', source: 'estimated' });
    expect(low.netAboveRestKcal).toBeCloseTo(2, 12);
    expect(low.incrementalKcal).toBeCloseTo(-10, 12);
    // zero duration and below-rest gross: zero net, no NaN
    expect(boutCost({ grossKcal: 0, durationMin: 0, rmrKcalPerDay: 1440, displacedFracOfRmr: 0.2, method: 'unknown', source: 'default' }).netAboveRestKcal).toBe(0);
    // unknown displacement stays unknown (an explicit scenario)
    expect(boutCost({ grossKcal: 300, durationMin: 60, rmrKcalPerDay: 1440, displacedFracOfRmr: null, method: 'compendiumMet', source: 'estimated' }).incrementalKcal).toBeNull();
    // unknown RMR: the standard 1 MET (3.5 mL/kg/min) is own rest, labelled
    const std = boutCost({ grossKcal: 300, durationMin: 60, rmrKcalPerDay: null, bodyMassKg: 80, displacedFracOfRmr: 0.2, method: 'compendiumMet', source: 'estimated' });
    expect(std.restBasis).toBe('standardMet');
    expect(std.ownRestKcal).toBeCloseTo(KCAL_PER_KG_H_PER_MET * 80, 9);
  });

  it('the engine books the same net above rest as the shared resolver across body mass and RMR', () => {
    for (const [bw, rmr, met] of [[60, 1300, 6], [75, 1750, 8], [110, 2300, 4.5], [50, 1100, 10]] as const) {
      const k = activityModule.prepare(makeCtx(mods, person({ body: { weightKg: bw }, labs: { measuredRmrKcal: rmr } })));
      const s = { ...cardio(10, 45, Number.NaN, 7), met } as SessionResolved;
      const gross = sessionGrossKcalPerMin(k, s, 40, bw, 1.75, rmr / 1440, bw / 1.75 ** 2) * 45;
      const shared = boutCost({ grossKcal: met * KCAL_PER_KG_H_PER_MET * bw * 45 / 60, durationMin: 45, rmrKcalPerDay: rmr, displacedFracOfRmr: k.displaced, method: 'compendiumMet', source: 'estimated' });
      expect(gross).toBeCloseTo(shared.grossKcal, 9);
      expect(Math.max(0, gross - (rmr / 1440) * 45)).toBeCloseTo(shared.netAboveRestKcal, 9);
    }
  });

  it('total-day steps + a session with known included steps = excludes-training steps + the same session', () => {
    const run = (patch: Partial<DayInput>) => runDays((pr) => withSessions(makeDay(pr, patch), [{ ...cardio(10, 30, 0.5, 1), stepsIncluded: 3000 }]), 1).steps;
    const total = run({ steps: 11000, stepsScope: 'totalDay' });
    const excl = run({ steps: 8000, stepsScope: 'excludesTraining' });
    expect(sum(total)).toBeCloseTo(sum(excl), 9);
    // an excludes-training count never subtracts the session's steps
    const exclAgain = run({ steps: 8000, stepsScope: 'excludesTraining', sessionIncludedSteps: 3000 });
    expect(sum(exclAgain)).toBeCloseTo(sum(excl), 9);
    // the reported count is not changed: the ledger alone loses the included steps
    const pr = ctxFor().profile;
    const d = withSessions(makeDay(pr, { steps: 11000, stepsScope: 'totalDay' }), [{ ...cardio(10, 30, 0.5, 1), stepsIncluded: 3000 }]);
    expect(d.steps).toBe(11000);
    expect(dayLedgerSteps(d)).toBe(8000);
  });

  it('legacy unknown scope: nothing subtracted (an explicit overlap scenario), identical to the pre-scope engine', () => {
    const legacy = runDays((pr) => makeDay(pr, { steps: 10000 }), 1).steps;
    expect(sum(legacy)).toBeCloseTo(0.44 * 75 * 3, 6);
    expect(stepsOverlapStatus(undefined, undefined, true)).toBe('unknown');
    expect(stepsOverlapStatus('totalDay', 2500, true)).toBe('known');
    expect(stepsOverlapStatus('excludesTraining', undefined, true)).toBe('none');
  });

  it('an unresolved step/session overlap is one named run assumption; resolved or absent overlap adds none', () => {
    const pr = ctxFor().profile;
    const walk = (patch: Partial<DayInput>, s: Partial<SessionResolved> = cardio(10, 30, 0.5, 1)) => withSessions(makeDay(pr, patch), [s]);
    expect(stepsOverlapAssumption([walk({ steps: 10000 })])).toBe(STEPS_OVERLAP_UNKNOWN);
    expect(stepsOverlapAssumption([walk({ steps: 10000, stepsScope: 'totalDay' })])).toBe(STEPS_OVERLAP_UNKNOWN);
    expect(stepsOverlapAssumption([walk({ steps: 10000, stepsScope: 'totalDay', sessionIncludedSteps: 3000 })])).toBeNull();
    expect(stepsOverlapAssumption([walk({ steps: 10000, stepsScope: 'excludesTraining' })])).toBeNull();
    // no locomotor session, or no step count: nothing to overlap
    expect(stepsOverlapAssumption([withSessions(makeDay(pr, { steps: 10000 }), [resistance(17, 60, 3.5)])])).toBeNull();
    expect(stepsOverlapAssumption([walk({ steps: 0 })])).toBeNull();
    expect(ACTIVITY_MODEL_ASSUMPTIONS).not.toContain(STEPS_OVERLAP_UNKNOWN);
  });

  it('habitual and current sides use the same overlap rule: already-habitual walking logged as a session cancels', () => {
    // habitual total-day count with the walk inside it vs the same day logged with the walk as a session (steps known)
    const hab = { steps: 10000, scope: 'totalDay' as const, includedSteps: 3500 };
    const cur = { steps: 10000, scope: 'totalDay' as const, includedSteps: 3500 };
    expect(stepsAboveHabitual(cur, hab)).toBe(0);
    // excludes-training on both sides: no subtraction anywhere, same difference as the raw counts
    expect(stepsAboveHabitual({ steps: 9000, scope: 'excludesTraining', includedSteps: 3000 }, { steps: 7000, scope: 'excludesTraining' })).toBe(2000);
    expect(stepLedgerSteps(2000, 'totalDay', 5000)).toBe(0); // never negative
  });

  it('one physical bout described by a session, a commute and a recreation entry is counted once', () => {
    const r = reconcileBoutMinutes([
      { id: 'walk-1', durationMin: 30, source: 'session', startMin: 480, endMin: 510 },
      { id: 'walk-1', durationMin: 30, source: 'commute' },
      { durationMin: 20, source: 'recreation', startMin: 500, endMin: 520 },
      { durationMin: 0, source: 'log' },
    ]);
    expect(r.physicalMin).toBe(40);
    expect(r.duplicateMin).toBe(40);
    expect(r.unmatchedMin).toBe(0);
  });

  it('reference week: a habitual session repeated in the plan books zero, the ledger terms keep distinct names', () => {
    const ctx = ctxFor();
    const pr = ctx.profile;
    const week = habitualWeek(pr);
    const ref = activityReference(pr, week, [], 0, () => week);
    for (let d = 0; d < 7; d++) expect(ref.delta[d]).toBeCloseTo(0, 9);
    const c = boutCost({ grossKcal: 400, durationMin: 60, rmrKcalPerDay: 1750, displacedFracOfRmr: 0.2, method: 'compendiumMet', source: 'estimated' });
    expect(Object.keys(c)).toEqual(expect.arrayContaining(['grossKcal', 'ownRestKcal', 'netAboveRestKcal', 'displacedLifestyleKcal', 'incrementalKcal']));
  });

  it('activity constants: habitual step ledger by the profile scope (legacy unknown = the raw habit)', () => {
    const k = activityConstants(buildModelParams(mods), ctxFor().profile);
    expect(k.habStepsLedger).toBe(k.habSteps);
  });
});
