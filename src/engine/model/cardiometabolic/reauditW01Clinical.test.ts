// @vitest-environment node
/**
 * Re-audit of waves 0–1 (2026-10-19), package F09-clinical — the cardiometabolic module's run validity:
 *   A1-048  the ketosis-dependent LDL response is tagged from the day it applies, including a saturated habitual reference
 *   A1-052  an out-of-domain measured baseline makes every modelled daily sample unsupported from index 0
 *   A1-063  glucose-lowering medication context resolved as of the baseline and along the run (no any-ever event)
 *   A1-047  the opt-in hepatic HOMA calibration is never fed by a confounded or non-routine draw
 */
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { closedRunStatuses, guardedGoalValue, objectiveWithheld } from '../../planner/domain/capabilities';
import type { DayTemplate, PersonProfile, Schedule } from '../../types';
import { cardiometabolicObservedAnchors, glucoseLoweringChronology } from './constants';
import { MAN_PROFILE, makeRig } from './testkit';

const PERSON = (habits: Partial<NonNullable<PersonProfile['habits']>> = {}, extra: Partial<PersonProfile> = {}): PersonProfile => ({
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 45, heightCm: 178, weightKg: 82 },
  habits: { typicalSteps: 5000, sessionsPerWeek: 0, lifingCardioMix: 0, trainingHistory: 'none', ...habits },
  startDate: '2026-10-05',
  ...extra,
});

/** The person's habitual week at `pct` % of maintenance (carbohydrate per day overridable), `days` long. */
function week(p: PersonProfile, days: number, pct: number, carbG?: number): Schedule {
  const rp = resolveProfile(p);
  const macros: DayTemplate['macros'] = { protein: { unit: 'g', value: rp.habitualProteinG }, carbs: { unit: 'g', value: carbG ?? rp.habitualCarbG }, fat: { unit: 'remainder' }, fibre: { unit: 'g', value: rp.habitualFibreG } };
  const programs: DayTemplate[] = [0, 1, 2, 3, 4, 5, 6].map((wd) => ({ id: `w${wd}`, label: `w${wd}`, energy: { kind: 'pctMaintenance', pct }, macros, meals: { count: 3, window: { startH: 8, lengthH: 12 } }, exercise: [] }));
  return { schemaVersion: 1, startDate: p.startDate ?? '2026-10-05', horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: d % 7 })) };
}

function overridesOf(o: Record<string, number> | undefined): Float64Array | undefined {
  if (!o) return undefined;
  const mp = buildModelParams(MODULES);
  const v = mp.values.slice();
  for (const [id, x] of Object.entries(o)) v[mp.index.get(id)!] = x;
  return v;
}

function run(p: PersonProfile, s: Schedule, o?: Record<string, number>, extra: Parameters<typeof runEngine>[2] = {}) {
  const rp = resolveProfile(p);
  const paramOverrides = overridesOf(o);
  return runEngine(rp, compileSchedule(s, rp), { record: 'daily', ...(paramOverrides ? { paramOverrides } : {}), ...extra });
}

const LEM_ON = { 'cardiometabolic.lem.enabled': 1 };

/* ------------------------------------------------------------------------------------------- A1-048 */

describe('A1-048 ketogenic LDL response validity with a saturated habitual ketosis reference', () => {
  for (const [label, carbPct, carbG] of [['habitual 0 % carbohydrate', 0, undefined], ['15 g/day carbohydrate', 3, 15]] as const) {
    it(`${label}, 20 % deficit: opt-in LEM is exploratory with its numeric response; default-off is a scenario whose reduction is withheld`, () => {
      const p = PERSON({ habitualCarbPctEnergy: carbPct });
      const s = week(p, 21, 80, carbG);
      const off = run(p, s);
      const on = run(p, s, LEM_ON);
      // the habitual reference is saturated: a rise of s_keto is impossible, yet the response applies from day 0
      expect(on.meta.outputStatus?.ldl).toEqual({ status: 'exploratory', reasonCode: 'lemAdverseResponseScenario', fromDay: 0, uncertaintyKind: 'scenario' });
      expect(off.meta.outputStatus?.ldl).toEqual({ status: 'scenario', reasonCode: 'ketogenicLipidResponseUncertain', fromDay: 0, uncertaintyKind: 'scenario' });
      // the opt-in term changes LDL materially (no new coefficient: the existing scenario), and its rise stays visible
      expect(on.daily.ldl![20]! - off.daily.ldl![20]!).toBeGreaterThan(0.1);
      expect(on.daily.ldl![20]!).toBeGreaterThan(on.initial.ldl!);
      // the measured/initial anchor is the same exact t = 0 value in both runs
      expect(on.initial.ldl).toBe(off.initial.ldl);
      // default-off: the objective guard withholds the modelled LDL reduction and target credit
      const closed = closedRunStatuses(off);
      const start = off.initial.ldl!;
      const end = off.daily.ldl![20]!;
      expect(end).toBeLessThan(start);
      expect(objectiveWithheld('ldl', -1, closed)).toBe(true);
      expect(guardedGoalValue('ldl', -1, end, start, closed)).toBe(start);
      // an adverse modelled rise is never hidden by the guard (it keeps the larger, worse value)
      expect(guardedGoalValue('ldl', -1, start + 0.3, start, closed)).toBe(start + 0.3);
    });
  }

  it('a stationary habitual keto week keeps t = 0, does not drift and carries no lipid-response status', () => {
    const p = PERSON({ habitualCarbPctEnergy: 0 });
    const r = run(p, week(p, 28, 100));
    expect(r.meta.outputStatus?.ldl).toBeUndefined();
    expect(Math.abs(r.daily.ldl![27]! - r.initial.ldl!)).toBeLessThan(1e-3);
  });

  it('an ordinary non-ketogenic deficit is untagged and keeps its credited reduction', () => {
    const p = PERSON();
    const r = run(p, week(p, 21, 80));
    expect(r.meta.outputStatus?.ldl).toBeUndefined();
    expect(objectiveWithheld('ldl', -1, closedRunStatuses(r))).toBe(false);
  });

  it('the new-ketogenic 72 h fast keeps its own day; a resumed snapshot keeps the same validity status', () => {
    const p = PERSON();
    const s = week(p, 35, 100);
    s.events = [{ kind: 'fast', startDay: 7, startH: 20, durationH: 72 }];
    const fast = run(p, s);
    expect(fast.meta.outputStatus?.ldl).toMatchObject({ status: 'scenario', reasonCode: 'ketogenicLipidResponseUncertain' });
    expect(fast.meta.outputStatus!.ldl!.fromDay).toBeGreaterThanOrEqual(7);
    expect(fast.meta.outputStatus!.ldl!.fromDay).toBeLessThanOrEqual(9);
    const keto = PERSON({ habitualCarbPctEnergy: 0 });
    const ks = week(keto, 30, 80);
    const full = run(keto, ks, LEM_ON, { captureSnapshotAt: [10] });
    const cont = run(keto, ks, LEM_ON, { initialSnapshot: full.snapshots![10]! });
    expect(cont.meta.outputStatus?.ldl).toEqual(full.meta.outputStatus?.ldl);
    expect(cont.daily.ldl![29]).toBe(full.daily.ldl![29]);
  });
});

/* ------------------------------------------------------------------------------------------- A1-052 */

describe('A1-052 an out-of-domain measured baseline: every modelled daily sample unsupported from index 0', () => {
  const labs = { ldlMmolL: 8.02, hdlMmolL: 1.3 };
  const profile = (extra: Partial<PersonProfile> = {}): PersonProfile => PERSON({}, { labs, labMeta: { ldlMmolL: { source: 'marker', measuredOn: '2026-09-30', sampleId: 'lab-1' } }, ...extra });
  const kcal = (p: PersonProfile, days: number): Schedule => {
    const s = week(p, days, 100);
    return { ...s, programs: s.programs.map((d) => ({ ...d, energy: { kind: 'kcal' as const, kcal: 2100 } })) };
  };

  it('day 0 is a modelled response: the status covers it while the exact observation stays the t = 0 anchor', () => {
    const r = run(profile(), kcal(profile(), 21));
    expect(r.initial.ldl).toBe(8.02);
    expect(r.meta.observedAnchors?.find((a) => a.series === 'ldl')).toMatchObject({ value: 8.02, outOfDomain: true });
    expect(r.daily.ldl![0]).not.toBe(8.02);
    expect(r.meta.outputStatus?.ldl).toEqual({ status: 'outOfDomain', reasonCode: 'observedBaselineOutsideCalibration', fromDay: 0 });
    expect(r.meta.outputStatus?.apoB).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
    // an in-domain value and unrelated outcomes keep readable forecasts
    expect(r.meta.outputStatus?.hdl).toBeUndefined();
    expect(r.meta.outputStatus?.fatMass).toBeUndefined();
  });

  it('a one-day forecast and a resumed snapshot keep the same distinction; an in-domain control has no status', () => {
    const one = run(profile(), kcal(profile(), 1));
    expect(one.daily.ldl!.length).toBe(1);
    expect(one.meta.outputStatus?.ldl).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
    expect(one.initial.ldl).toBe(8.02);
    const full = run(profile(), kcal(profile(), 30), undefined, { captureSnapshotAt: [10] });
    const cont = run(profile(), kcal(profile(), 30), undefined, { initialSnapshot: full.snapshots![10]! });
    expect(cont.meta.outputStatus?.ldl).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
    expect(cont.meta.observedAnchors?.find((a) => a.series === 'ldl')).toMatchObject({ value: 8.02 });
    const inDomain = run(PERSON({}, { labs: { ldlMmolL: 3.0 }, labMeta: { ldlMmolL: { source: 'marker', measuredOn: '2026-09-30' } } }), kcal(profile(), 21));
    expect(inDomain.meta.outputStatus?.ldl).toBeUndefined();
    expect(inDomain.initial.ldl).toBe(3.0);
    expect(cardiometabolicObservedAnchors({ ldlMmolL: 3.0 }).outputStatus).toEqual({});
  });
});

/* ------------------------------------------------------------------------------------------- A1-063 */

describe('A1-063 glucose-lowering context as of the baseline and along the run', () => {
  const START = '2026-10-01';
  const baseline = { labs: { fastingGlucoseMmolL: 5.6 }, labMeta: { fastingGlucoseMmolL: { source: 'marker' as const, measuredOn: '2026-09-25' } }, startDate: START };
  const prof = (medications: PersonProfile['medications'], diabetesMedication?: NonNullable<NonNullable<PersonProfile['safety']>['flags']>['diabetesMedication']) =>
    PERSON({}, { ...baseline, ...(medications ? { medications } : {}), ...(diabetesMedication ? { safety: { mode: 'M0', flags: { diabetesMedication } } } : {}) });
  const chron = (p: PersonProfile, days: number) => glucoseLoweringChronology(resolveProfile(p), days);

  it('a remote metformin stop (or a stopped course) before a newer baseline is not current exposure', () => {
    const stopOnly = prof([{ id: 'm1', medicationClass: 'metformin', change: 'stop', date: '2024-01-01' }], 'none');
    expect(chron(stopOnly, 21)).toEqual({ fromDay: null, reason: null });
    const course = prof([
      { id: 'm1', medicationClass: 'metformin', change: 'start', date: '2023-01-01' },
      { id: 'm2', medicationClass: 'metformin', change: 'stop', date: '2024-01-01' },
    ]);
    expect(chron(course, 21).fromDay).toBeNull();
    const r = run(stopOnly, week(stopOnly, 21, 100));
    expect(r.meta.outputStatus?.fastingGlucose).toBeUndefined();
  });

  it('a future insulin start leaves the run untouched past the horizon and applies from its own day inside it', () => {
    const future = prof([{ id: 'i1', medicationClass: 'insulin', change: 'start', date: '2027-01-01' }], 'none');
    expect(chron(future, 21).fromDay).toBeNull();
    expect(run(future, week(future, 21, 100)).meta.outputStatus?.fastingGlucose).toBeUndefined();
    // 2027-01-01 is day 92 of a run from 2026-10-01
    expect(chron(future, 120)).toEqual({ fromDay: 92, reason: 'changeSinceBaseline' });
    const during = prof([{ id: 'g1', medicationClass: 'glp1', change: 'start', date: '2026-10-11' }], 'none');
    const r = run(during, week(during, 21, 100));
    expect(r.meta.outputStatus?.fastingGlucose).toEqual({ status: 'scenario', reasonCode: 'glucoseLoweringMedicationContext', fromDay: 10, uncertaintyKind: 'scenario' });
  });

  it('current screening and an open course before the baseline keep the context from day 0; a post-baseline change keeps it uncertain', () => {
    for (const med of ['insulin', 'sulfonylurea', 'sglt2'] as const) {
      const p = prof([{ id: 'm1', medicationClass: 'metformin', change: 'stop', date: '2024-01-01' }], med);
      expect(chron(p, 21)).toEqual({ fromDay: 0, reason: 'currentScreening' });
      expect(run(p, week(p, 21, 100)).meta.outputStatus?.fastingGlucose).toMatchObject({ status: 'scenario', reasonCode: 'glucoseLoweringMedicationContext', fromDay: 0 });
    }
    expect(chron(prof([{ id: 'g1', medicationClass: 'glp1', change: 'start', date: '2026-09-01' }]), 21)).toEqual({ fromDay: 0, reason: 'activeAtBaseline' });
    // a change between the baseline sample and the run start: attribution from the baseline is not causal
    expect(chron(prof([{ id: 'g1', medicationClass: 'glp1', change: 'start', date: '2026-09-28' }], 'none'), 21)).toEqual({ fromDay: 0, reason: 'changeSinceBaseline' });
  });
});

/* ------------------------------------------------------------------------------------------- A1-047 (engine) */

describe('A1-047 the opt-in hepatic HOMA calibration needs a routine-basal same-draw pair', () => {
  const on = { 'si.homaCalibration': 1 };
  const PAIR = { fastingGlucoseMmolL: 7.0, fastingInsulinUuMl: 15 };
  const meta = (ctx: Record<string, unknown> = {}, hours = 12) => ({
    fastingGlucoseMmolL: { source: 'marker' as const, measuredOn: '2026-09-20', sampleId: 'd1', fastingHours: hours, ...ctx },
    fastingInsulinUuMl: { source: 'marker' as const, measuredOn: '2026-09-20', sampleId: 'd1', fastingHours: hours, ...ctx },
  });
  const rig = (labMeta: ReturnType<typeof meta>) => makeRig({ profile: { ...MAN_PROFILE, labMeta } as PersonProfile, labs: PAIR, params: on });

  it('known illness, a prolonged fast or a conflicting draw keeps the latent prior (no calibration); a routine pair calibrates', () => {
    expect(rig(meta()).k.hepCalibrated).toBe(true);
    const conflict = meta();
    const instants = { ...conflict, fastingGlucoseMmolL: { ...conflict.fastingGlucoseMmolL, sampledAt: '2026-09-20T07:00+05:30' }, fastingInsulinUuMl: { ...conflict.fastingInsulinUuMl, sampledAt: '2026-09-20T16:00+05:30' } };
    for (const m of [meta({ sampleContext: { illness: true } }), meta({}, 72), meta({ sampleContext: { prolongedFastProtocol: true } }), instants]) {
      const r = rig(m);
      expect(r.k.hepCalibrated).toBe(false);
      expect(r.k.hepCal).toBe(1);
    }
  });
});
