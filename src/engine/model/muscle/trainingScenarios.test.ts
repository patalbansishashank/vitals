// @vitest-environment node
/**
 * D3-04 (meal distribution neutral, MPS exploratory) and D3-05 (explicit training growth state) of the muscle module.
 * Module-level checks drive `muscleModule` through the test harness; the series-mask invariance runs the real engine.
 */
import { compileSchedule, habitualWeekPrograms } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import type { PersonProfile, Schedule, TrainingGrowthState } from '../../types';
import { MUSCLE_PARAMS } from './params';
import { growthAssumptionOf, growthScenarioFor, muscleModule, muscleOutputStatus, MUSCLE_MODEL_ASSUMPTIONS, readMuscleScenario, type MuscleK } from './index';
import { readMuscleConstants } from './constants';
import { MuscleSim, compileWeek, person, program, rtWeek, type PersonOpts } from './__tests__/harness';

vi.setConfig({ testTimeout: 120_000 });

const YOUNG: PersonOpts = { sex: 'male', age: 25, heightCm: 178, weightKg: 75, bodyFatPct: 15 };
const LIFTER: PersonOpts = { ...YOUNG, trainingYears: 2, trainingHistory: '1to3y' };

/** A harness profile with a stated growth state. */
const withGrowth = (o: PersonOpts, state?: TrainingGrowthState, source?: 'user' | 'observedTrend'): PersonProfile => {
  const p = person(o);
  return { ...p, habits: { ...p.habits, ...(state ? { trainingGrowthState: state } : {}), ...(source ? { trainingGrowthStateSource: source } : {}) } };
};

describe('D3-04 meal distribution: neutral in production, legacy curve as research sensitivity', () => {
  it('registry: eDistMode is 0 in every draw (fixed); the legacy curve stays selectable', () => {
    const p = MUSCLE_PARAMS.find((q) => q.id === 'muscle.eDistMode')!;
    expect(p).toMatchObject({ value: 0, low: 0, high: 1, draw: 'fixed' });
    expect(readMuscleScenario(buildModelParams(MODULES)).eDistMode).toBe(0);
  });

  it('identical protein, energy and training with 1, 2 or 3 meals give identical accretion (no guaranteed timing loss)', () => {
    const run = (meals: number): { eDist: number; gain: number; acc: number } => {
      const sim = new MuscleSim(person(YOUNG));
      const A = program('A', { meals, windowLengthH: meals === 1 ? 1 : 12, proteinGkg: 1.6, sessions: [{ startH: 17, sets: 4 }] });
      const B = program('B', { meals, windowLengthH: meals === 1 ? 1 : 12, proteinGkg: 1.6 });
      const week = compileWeek(sim.profile, [A, B], [0, 1, 0, 1, 0, 1, 1]);
      sim.run(28, week);
      return { eDist: sim.s.eDist, gain: sim.gain(), acc: sim.bus.rtAccretionKgD };
    };
    const one = run(1);
    const two = run(2);
    const three = run(3);
    expect(one.eDist).toBe(1);
    expect(two.eDist).toBe(1);
    expect(one.gain).toBeGreaterThan(0);
    expect(one.gain).toBe(three.gain);
    expect(two.gain).toBe(three.gain);
    expect(one.acc).toBe(three.acc);
  });

  it('research mode (eDistMode 1) keeps the legacy curve: OMAD → 0.83, three meals → 1', () => {
    const run = (meals: number): number => {
      const sim = new MuscleSim(person(YOUNG), { overrides: { 'muscle.eDistMode': 1 } });
      const A = program('A', { meals, windowLengthH: meals === 1 ? 1 : 12, sessions: [{ startH: 17, sets: 4 }] });
      sim.run(10, compileWeek(sim.profile, [A], [0]));
      return sim.s.eDist;
    };
    expect(run(3)).toBe(1);
    expect(run(1)).toBeCloseTo(0.83, 12);
  });

  it('burn-in and the future use the same mode: a habitual lifter on OMAD at habitual training stays flat', () => {
    const sim = new MuscleSim(person(LIFTER));
    const week = rtWeek(sim, 11 / 3, 3, 1.6, 75, { meals: 1, windowLengthH: 1 });
    sim.burnIn(14, week);
    sim.run(56, week);
    expect(Math.abs(sim.gain())).toBeLessThan(1e-9);
  });

  it('the MPS index is a display layer: requesting or omitting the mps series never changes the body trajectory', () => {
    const rp = resolveProfile({ schemaVersion: 1, body: { sex: 'male', ageYears: 30, heightCm: 180, weightKg: 82 }, habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' }, startDate: '2026-10-05' });
    const progs = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 90 } }));
    const s: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 28, programs: progs, days: Array.from({ length: 28 }, (_, d) => ({ program: d % 7 })) };
    const compiled = compileSchedule(s, rp);
    const all = runEngine(rp, compiled, { record: 'daily' });
    const noMps = runEngine(rp, compiled, { record: 'daily', series: ['leanTissue', 'fatMass', 'rtMuscleGain'] });
    for (let i = 0; i < 28; i++) {
      expect(noMps.daily.leanTissue![i]).toBe(all.daily.leanTissue![i]);
      expect(noMps.daily.fatMass![i]).toBe(all.daily.fatMass![i]);
      expect(noMps.daily.rtMuscleGain![i]).toBe(all.daily.rtMuscleGain![i]);
    }
  });

  it('declares its named assumptions (neutral distribution, exploratory MPS, legacy detraining kinetics)', () => {
    expect(MUSCLE_MODEL_ASSUMPTIONS).toEqual(['mealDistributionNeutral', 'mpsExploratoryIndex', 'detrainingKineticsScenario']);
  });
});

describe('D3-05 training growth state: explicit scenario, not a habitual Boolean', () => {
  const K: MuscleK = { ...readMuscleConstants(buildModelParams(MODULES), false), scenario: readMuscleScenario(buildModelParams(MODULES)) };
  const habitualRun = (p: PersonProfile, overrides?: Record<string, number>, weeks = 12): MuscleSim => {
    const sim = new MuscleSim(p, overrides ? { overrides } : {});
    const week = rtWeek(sim, 11 / 3, 3, 1.4);
    sim.burnIn(14, week);
    sim.run(7 * weeks, week);
    return sim;
  };

  it('legacy "currently training" without a stated state is unknown, never plateaued; it keeps the numerical burn-in anchor', () => {
    const info = growthScenarioFor(K, resolveProfile(person(LIFTER)));
    expect(info).toMatchObject({ state: 'unknown', source: 'unknown', scenario: 'stable', habitualRt: true, assumption: 'growthBurnInAnchor' });
    const sim = habitualRun(person(LIFTER));
    expect(sim.s.growthState).toBe(0);
    expect(sim.s.growthScenario).toBe(0);
    expect(Math.abs(sim.gain())).toBeLessThan(1e-9); // anchor: habitual training holds the habitual equilibrium
  });

  it('a stated plateau uses the reference (labelled as such); progressing and resuming use the progress scenario', () => {
    expect(growthScenarioFor(K, resolveProfile(withGrowth(LIFTER, 'plateaued', 'user')))).toMatchObject({ scenario: 'stable', assumption: 'growthPlateauReference', source: 'user' });
    expect(growthScenarioFor(K, resolveProfile(withGrowth(LIFTER, 'progressing', 'observedTrend')))).toMatchObject({ scenario: 'progress', assumption: 'growthProgressScenario', source: 'observedTrend' });
    expect(growthScenarioFor(K, resolveProfile(withGrowth(LIFTER, 'resuming')))).toMatchObject({ scenario: 'progress', source: 'unknown' });
    const plateau = habitualRun(withGrowth(LIFTER, 'plateaued', 'user'));
    const progressing = habitualRun(withGrowth(LIFTER, 'progressing', 'user'));
    expect(Math.abs(plateau.gain())).toBeLessThan(1e-9);
    expect(progressing.s.bRef.every((x) => x === 0)).toBe(true);
    expect(progressing.gain()).toBeGreaterThan(0.05); // the gross rate with the existing caps, no reference subtracted
    for (let r = 0; r < 9; r++) expect(progressing.s.mAcc[r]!).toBeLessThanOrEqual(progressing.s.gPot[r]! + 1e-12);
  });

  it('unknown state: the competing progress scenario is available by declaration, never by default', () => {
    expect(MUSCLE_PARAMS.find((q) => q.id === 'muscle.growthScenarioUnknown')).toMatchObject({ value: 0, draw: 'fixed' });
    const def = habitualRun(person(LIFTER));
    const prog = habitualRun(person(LIFTER), { 'muscle.growthScenarioUnknown': 1 });
    expect(prog.s.growthScenario).toBe(1);
    expect(prog.gain()).toBeGreaterThan(def.gain() + 0.05);
    // the same history under the same selected scenario gives the same path whether stated or chosen for unknown
    const stated = habitualRun(withGrowth(LIFTER, 'progressing', 'user'));
    expect(stated.gain()).toBe(prog.gain());
  });

  it('without RT in the habitual week both scenarios coincide (B_ref = 0): a novice is not frozen either way', () => {
    const novice = (o?: Record<string, number>): number => {
      const sim = new MuscleSim(person(YOUNG), o ? { overrides: o } : {});
      sim.burnIn(14, compileWeek(sim.profile, [program('B')], [0]));
      sim.run(42, rtWeek(sim, 4, 3, 1.6));
      return sim.gain();
    };
    expect(novice()).toBe(novice({ 'muscle.growthScenarioUnknown': 1 }));
    expect(novice()).toBeGreaterThan(0);
  });

  it('the growth state and scenario live in the module state (snapshots and replans carry them)', () => {
    const rp = resolveProfile({ ...withGrowth(LIFTER, 'progressing', 'user') });
    const progs = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 100 } }));
    const s: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 56, programs: progs, days: Array.from({ length: 56 }, (_, d) => ({ program: d % 7 })) };
    const compiled = compileSchedule(s, rp);
    const full = runEngine(rp, compiled, { record: 'daily', captureSnapshotAt: [21] });
    const snap = full.snapshots![21]!;
    const muscleState = snap.states[snap.moduleIds.indexOf(muscleModule.id)] as { growthState: number; growthScenario: number };
    expect(muscleState).toMatchObject({ growthState: 1, growthScenario: 1 });
    const cont = runEngine(rp, compiled, { record: 'daily', initialSnapshot: snap });
    for (let i = 21; i < 56; i++) expect(cont.daily.rtMuscleGain![i]).toBe(full.daily.rtMuscleGain![i]);
    // a replan re-resolves the same stated state from the profile
    expect(growthScenarioFor(K, resolveProfile(withGrowth(LIFTER, 'progressing', 'user'))).scenario).toBe('progress');
  });

  it('output statuses (C6): MPS exploratory; lean and strength are scenarios, lean labelled by the growth scenario in the state', () => {
    const unknown = habitualRun(person(LIFTER), undefined, 1).s;
    const plateau = habitualRun(withGrowth(LIFTER, 'plateaued', 'user'), undefined, 1).s;
    const prog = habitualRun(person(LIFTER), { 'muscle.growthScenarioUnknown': 1 }, 1).s;
    expect(muscleOutputStatus(unknown)).toEqual({
      mps: { status: 'exploratory', reasonCode: 'simulatedResponseIndex', uncertaintyKind: 'heuristic' },
      rtMuscleGain: { status: 'scenario', reasonCode: 'growthBurnInAnchor', uncertaintyKind: 'scenario' },
      strength: { status: 'scenario', reasonCode: 'taskSpecificIndex', uncertaintyKind: 'scenario' },
    });
    expect(growthAssumptionOf(plateau)).toBe('growthPlateauReference');
    expect(growthAssumptionOf(prog)).toBe('growthProgressScenario');
    // the state's label agrees with the profile resolution
    expect(growthAssumptionOf(unknown)).toBe(growthScenarioFor(K, resolveProfile(person(LIFTER))).assumption);
  });
});




describe('D3-06 reduced-dose maintenance is contextual (age), and strength and muscle retention differ', () => {
  const reduced = (age: number): { gain: number; strength: number } => {
    const sim = new MuscleSim(person({ ...LIFTER, age }));
    sim.burnIn(14, rtWeek(sim, 11 / 3, 3, 1.4));
    // a third of the habitual volume (Bickel-style reduced dose), effort kept
    sim.run(16 * 7, rtWeek(sim, 11 / 9, 3, 1.4));
    return { gain: sim.gain(), strength: sim.strength() };
  };
  it('a young lifter keeps muscle on a third of the dose; an older lifter on the same dose detrains (scenario priors)', () => {
    const young = reduced(25);
    const older = reduced(70);
    expect(Math.abs(young.gain)).toBeLessThan(1e-9);
    expect(older.gain).toBeLessThan(-0.05);
    // strength is not muscle: the strength index moves (less acute fatigue, a lower neural target) while the mass holds
    expect(Math.abs(young.strength - 100)).toBeGreaterThan(0.5);
  });
});
