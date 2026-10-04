// @vitest-environment node
/**
 * Module-level tests of `muscle`: contract (wiring, registry), initialisation, burn-in, property tests (bounds,
 * monotonicity, steady state, zero intake, determinism), multipliers on A_r, events, and the MPS display layer.
 */
import { describe, expect, it } from 'vitest';
import { checkWiring } from '../../core/moduleRegistry';
import { validateParamDefs } from '../../core/paramsRegistry';
import { mulberry32 } from '../../core/math';
import type { AnyEngineModule } from '../../types/module';
import type { HourInput } from '../../types/inputs';
import type { SignalBus } from '../../types/signals';
import { trainingFfmiOffset } from '../../body/estimateBody';
import { muscleModule } from './index';
import { MuscleSim, compileWeek, person, program, rtWeek, type PersonOpts } from './__tests__/harness';

const YOUNG: PersonOpts = { age: 25, sex: 'male', heightCm: 178, weightKg: 75 };
const MODS = [muscleModule] as unknown as readonly AnyEngineModule[];

function allFinite(sim: MuscleSim): boolean {
  const s = sim.s as unknown as Record<string, unknown>;
  for (const v of Object.values(s)) {
    if (typeof v === 'number' && !Number.isFinite(v)) return false;
    if (v instanceof Float64Array) for (const x of v) if (!Number.isFinite(x)) return false;
  }
  const b = sim.bus;
  return [b.rtAccretionKgD, b.rtRetentionFrac, b.smRtKg, b.rtVolumeWb, b.mpsStimWb, b.trainingStatus].every(Number.isFinite);
}

function checkBounds(sim: MuscleSim): void {
  const s = sim.s;
  for (let r = 0; r < 9; r++) {
    expect(s.mAcc[r]!).toBeGreaterThanOrEqual(s.mBase[r]! - 1e-12);
    expect(s.mAcc[r]!).toBeLessThanOrEqual(s.gPot[r]! + 1e-12);
    expect(s.mPeak[r]!).toBeGreaterThanOrEqual(s.mAcc[r]! - 1e-12);
    expect(s.hR[r]!).toBeGreaterThanOrEqual(0);
    expect(s.hR[r]!).toBeLessThanOrEqual(1);
    expect(s.wR[r]!).toBeGreaterThanOrEqual(0);
    expect(s.wR[r]!).toBeLessThanOrEqual(0.05);
    expect(s.fatR[r]!).toBeGreaterThanOrEqual(0);
    expect(s.tLow[r]!).toBeGreaterThanOrEqual(0);
    expect(s.sMps[r]!).toBeGreaterThanOrEqual(0);
  }
  expect(s.nNeural).toBeGreaterThanOrEqual(0);
  expect(s.nNeural).toBeLessThanOrEqual(0.35);
  expect(s.refractoryR).toBeGreaterThanOrEqual(0);
  expect(s.refractoryR).toBeLessThanOrEqual(1);
  expect(s.mpsIdx).toBeGreaterThan(0);
  expect(sim.bus.trainingStatus).toBeGreaterThanOrEqual(0);
  expect(sim.bus.trainingStatus).toBeLessThanOrEqual(0.98);
  expect(sim.bus.rtRetentionFrac).toBeGreaterThanOrEqual(0);
  expect(sim.bus.rtRetentionFrac).toBeLessThanOrEqual(sim.k.rMax);
  expect(sim.bus.rtVolumeWb).toBeGreaterThanOrEqual(0);
  expect(allFinite(sim)).toBe(true);
}

describe('contract', () => {
  it('wiring (checkWiring semantics): writes owned by muscle, every read lists muscle as a reader; all writes adopted', () => {
    const w = checkWiring();
    expect(w.issues.filter((i) => i.module === 'muscle')).toEqual([]);
    // listed-but-unread signals are allowed (pending); every signal muscle owns must be written
    const pendingWrites = w.pending.filter((i) => i.module === 'muscle' && muscleModule.writes.includes(i.signal as never));
    expect(pendingWrites).toEqual([]);
    expect(muscleModule.writes).toContain('rtDoseFrac');
  });
  it('registry: all ParamDefs valid, prefixed, sourced; spec-ruled values', () => {
    expect(validateParamDefs(MODS)).toEqual([]);
    const byId = new Map(muscleModule.params.map((p) => [p.id, p]));
    for (const p of muscleModule.params) {
      expect(p.status).toBeDefined();
      expect(p.source).toMatch(/\d{4}|MODEL_SPEC/);
    }
    expect(byId.get('muscle.kG')!.value).toBe(0.001507);
    expect(byId.get('muscle.nMaxSlope')).toMatchObject({ value: 0.125, low: 0.1, high: 0.2 }); // R-STR
    expect(byId.get('muscle.kMem')).toMatchObject({ value: 1.3, low: 1.0, high: 1.3 }); // R-REGAIN (was R-MEM 1.0)
    expect(byId.get('muscle.crAccretion')).toMatchObject({ value: 0.05, low: 0, high: 0.1 }); // R-CREATINE
    expect(byId.get('muscle.uIndividual')).toMatchObject({ value: 1, low: 0.33, high: 3.0, draw: 'logTri' });
    let w = 0;
    for (const k of ['Chest', 'UpperBack', 'Shoulders', 'Arms', 'Core', 'Glutes', 'Quads', 'Hamstrings', 'Calves']) w += byId.get(`muscle.w${k}`)!.value;
    expect(w).toBeCloseTo(1, 12);
  });
});

describe('initialisation (09 §2, §4.6)', () => {
  it('untrained: TS₀ 0, no training lean, strength 100, neutral signals', () => {
    const sim = new MuscleSim(person(YOUNG));
    expect(sim.s.ts).toBeCloseTo(0, 6);
    expect(sim.s.currentlyTraining).toBe(0);
    expect(sim.bus.rtAccretionKgD).toBe(0);
    expect(sim.bus.rtRetentionFrac).toBe(0);
    expect(sim.bus.smRtKg).toBe(0);
    expect(sim.s.nNeural).toBe(0);
    expect(sim.s.hR[0]).toBe(0);
    sim.runDay(compileWeek(sim.profile, [program('B')], [0])[0]!);
    expect(sim.strength()).toBeCloseTo(100, 6);
    expect(sim.gain()).toBe(0);
  });
  it('trained 3 y: TS₀ = 1 − e^(−0.47·3), H = 1, N₀ = 0.8·N_max(TS₀), strength index still 100 at t = 0', () => {
    const sim = new MuscleSim(person({ ...YOUNG, trainingYears: 3, trainingHistory: '1to3y' }));
    expect(sim.s.ts).toBeCloseTo(1 - Math.exp(-0.47 * 3), 6);
    expect(sim.bus.trainingStatus).toBeCloseTo(sim.s.ts, 12);
    expect(sim.s.hR[3]).toBe(1);
    expect(sim.s.nNeural).toBeCloseTo(0.8 * (0.05 + 0.125 * (1 - sim.s.ts)), 12);
    expect(sim.s.strength0).toBeCloseTo(1 + sim.s.nNeural, 12);
    expect(sim.bus.smRtKg).toBe(0); // review M10: SM_RT counted from t = 0
  });
  it('unspecified sex averages ΔFFMI_pot', () => {
    const m = new MuscleSim(person({ ...YOUNG, sexUnspecified: true }));
    const g = m.s.gPot.reduce((a, b) => a + b, 0);
    expect(g).toBeCloseTo(((6.0 + 4.3) / 2) * 1.78 * 1.78, 6);
  });
  it('sedentary user with a lean measured body fat: FFMI-route TS₀ is a set-point (no detraining over 180 d)', () => {
    const sim = new MuscleSim(person({ ...YOUNG, bodyFatPct: 10 }));
    expect(sim.s.ts).toBeGreaterThan(0.1);
    expect(sim.s.mBase[6]).toBeCloseTo(sim.s.mAcc[6]!, 12);
    sim.run(180, compileWeek(sim.profile, [program('B')], [0]));
    expect(sim.gain()).toBeCloseTo(0, 12);
    expect(sim.bus.rtAccretionKgD).toBe(0);
  });
  it('past trainer without RT in the habitual week: M_acc₀ is the set-point (no detraining at habitual maintenance)', () => {
    const sim = new MuscleSim(person({ ...YOUNG, trainingYears: 3, trainingHistory: 'none', sessionsPerWeek: 0 }));
    expect(sim.s.currentlyTraining).toBe(0);
    expect(sim.s.ts).toBeCloseTo(1 - Math.exp(-0.47 * 3), 6); // rate status for a restart
    expect(sim.s.mBase[6]).toBeCloseTo(sim.s.mAcc[6]!, 12);
    sim.run(70, compileWeek(sim.profile, [program('B')], [0]));
    expect(sim.gain()).toBe(0);
    expect(sim.events).toEqual([]);
  });
  it('TS₀ years route: entered training years, else the habits history bucket, else 0 (FFMI route only)', () => {
    const bucket = new MuscleSim(person({ ...YOUNG, trainingHistory: 'gt3y' }));
    expect(bucket.s.ts).toBeCloseTo(1 - Math.exp(-0.47 * 5), 6);
    // habitual RT (R-DETRAIN): the set-point is M_acc₀ minus the trained gains the body carries above its untrained FFMI
    // reference — here dossier 14's offset for the bucket's 5 y (the body estimate did not use the bucket)
    const g5 = Math.min(bucket.s.mAcc0Sum, 1.78 * 1.78 * trainingFfmiOffset('male', 5));
    expect(bucket.s.mAcc0[0]! - bucket.s.mBase[0]!).toBeCloseTo(bucket.k.w[0]! * g5, 9);
    const noHistory = new MuscleSim({ ...person(YOUNG), habits: { sessionsPerWeek: 3, lifingCardioMix: 0 } });
    expect(noHistory.s.currentlyTraining).toBe(1);
    expect(noHistory.s.ts).toBeCloseTo(0, 6);
  });
  it('habitual RT sessions decide "currently training"; a cardio-only habit does not', () => {
    const cardio = new MuscleSim({ ...person({ ...YOUNG, trainingHistory: '1to3y' }), habits: { trainingHistory: '1to3y', sessionsPerWeek: 4, lifingCardioMix: 1 } });
    expect(cardio.s.currentlyTraining).toBe(0);
    expect(cardio.s.nNeural).toBe(0);
    expect(cardio.s.hR[0]).toBe(0);
  });
});

describe('burn-in on the habitual week and endBurnIn (R-BURNIN)', () => {
  const trained = (): MuscleSim => new MuscleSim(person({ ...YOUNG, trainingYears: 3, trainingHistory: '1to3y' }));
  it('mass frozen, set ring filled, t = 0 references latched: gain 0, smRtKg 0, strength 100, TS = TS₀', () => {
    const sim = trained();
    const week = rtWeek(sim, 11 / 3, 3, 1.4);
    const before = structuredClone(sim.s);
    sim.bus.skeletalMuscleKg = 31.5;
    sim.burnIn(14, week);
    expect(Array.from(sim.s.mAcc)).toEqual(Array.from(before.mAcc));
    expect(sim.s.vR[0]).toBeCloseTo(11, 9);
    expect(sim.s.m0).toBe(31.5);
    expect(sim.events).toEqual([]);
    expect(sim.gain()).toBe(0);
    expect(sim.bus.smRtKg).toBe(0);
    expect(sim.bus.rtAccretionKgD).toBe(0);
    expect(sim.bus.rtVolumeWb).toBeCloseTo(11, 9);
    expect(sim.bus.rtDoseFrac).toBe(1);
    expect(sim.strength()).toBe(100);
    expect(100 * sim.s.ts).toBeCloseTo(100 * (1 - Math.exp(-0.47 * 3)), 9);
  });
  it('habitual trainee at habitual maintenance: strength averages 100 over the week, neural component at equilibrium', () => {
    const sim = trained();
    const week = rtWeek(sim, 11 / 3, 3, 1.4);
    sim.burnIn(14, week);
    const n0 = sim.s.nNeural;
    const days: number[] = [];
    // SM does not move here (no composition), so the index shows N, fatigue and M_EA only
    sim.run(28, week, undefined, () => void days.push(sim.strength()));
    const wk = (a: number): number => days.slice(a, a + 7).reduce((x, y) => x + y, 0) / 7;
    expect(Math.abs(wk(0) - 100)).toBeLessThan(0.3);
    expect(Math.abs(wk(21) - 100)).toBeLessThan(0.5);
    expect(Math.abs(sim.s.nNeural - n0)).toBeLessThan(0.01);
  });
  it('habitual-training equilibrium: the habitual RT week at maintenance keeps M_acc constant (novice and trained)', () => {
    for (const p of [person({ ...YOUNG, trainingHistory: 'none', sessionsPerWeek: 3 }), person({ ...YOUNG, trainingYears: 2, trainingHistory: '1to3y' })]) {
      const sim = new MuscleSim(p);
      const week = rtWeek(sim, 11 / 3, 3, 1.4);
      sim.burnIn(14, week);
      expect(sim.s.bRef[6]).toBeGreaterThan(0);
      sim.run(90, week);
      expect(Math.abs(sim.gain())).toBeLessThan(1e-9);
    }
  });
  it('above the habitual stimulus the trainee gains towards a higher equilibrium; stopping detrains; a novice who starts gains', () => {
    const trained = (): MuscleSim => new MuscleSim(person({ ...YOUNG, trainingYears: 2, trainingHistory: '1to3y' }));
    const more = trained();
    more.burnIn(14, rtWeek(more, 11 / 3, 3, 1.4));
    more.run(84, rtWeek(more, 20 / 3, 3, 1.8)); // V 20 and 1.8 g/kg
    expect(more.gain()).toBeGreaterThan(0.3);
    const g84 = more.gain();
    more.run(84, rtWeek(more, 20 / 3, 3, 1.8));
    expect(more.gain() - g84).toBeLessThan(g84); // slows towards the new equilibrium
    const less = trained();
    less.burnIn(14, rtWeek(less, 11 / 3, 3, 1.4));
    less.run(84, rtWeek(less, 2, 3, 1.4)); // V 6 ≥ V_maint 3: maintained (Bickel)
    expect(Math.abs(less.gain())).toBeLessThan(1e-9);
    const stop = trained();
    stop.burnIn(14, rtWeek(stop, 11 / 3, 3, 1.4));
    stop.run(84, compileWeek(stop.profile, [program('B', { proteinGkg: 1.4 })], [0]));
    expect(stop.gain()).toBeLessThan(-0.5);
    const novice = new MuscleSim(person(YOUNG)); // no RT in the habitual week → no reference
    novice.burnIn(14, compileWeek(novice.profile, [program('B', { proteinGkg: 1.4 })], [0]));
    expect(novice.s.bRef[6]).toBe(0);
    novice.run(73, rtWeek(novice, 4, 3, 1.4));
    expect(novice.gain()).toBeGreaterThan(1.1);
  });
  it('habitual cardio-only persona with a training history: no detrainingOnset, no drift', () => {
    const sim = new MuscleSim({ ...person(YOUNG), habits: { trainingHistory: '1to3y', sessionsPerWeek: 4, lifingCardioMix: 1 } });
    const week = compileWeek(sim.profile, [program('B')], [0]);
    sim.burnIn(14, week);
    sim.run(90, week);
    expect(sim.events).toEqual([]);
    expect(sim.gain()).toBe(0);
    expect(sim.strength()).toBeCloseTo(100, 9);
  });
});

describe('R-DETRAIN: detraining towards a retained floor (09 §4.10; release check 2026-10-01)', () => {
  const LIFTER: PersonOpts = { ...YOUNG, trainingYears: 2, trainingHistory: '1to3y' };
  const sum = (a: Float64Array): number => a.reduce((x, y) => x + y, 0);
  const rest = (sim: MuscleSim) => compileWeek(sim.profile, [program('B', { proteinGkg: 1.4 })], [0]);
  /** Habitual lifter (3 × 11/3 sets per region) after burn-in; the last habitual session is on day −3 (Friday). */
  const lifter = (o: PersonOpts = LIFTER, overrides?: Record<string, number>): MuscleSim => {
    const sim = new MuscleSim(person(o), overrides ? { overrides } : {});
    sim.burnIn(14, rtWeek(sim, 11 / 3, 3, 1.4));
    return sim;
  };
  it('habitual lifter: set-point = M_acc₀ − trained gains above the untrained FFMI reference; floor keeps 50 % of them', () => {
    const sim = lifter();
    const s = sim.s;
    const tr = sim.profile.body.training;
    const gTr = sum(s.mAcc0) - sum(s.mBase);
    const expected = Math.min(sum(s.mAcc0), 1.78 * 1.78 * Math.max(tr.ffmi - tr.ffmiUntrainedRef, trainingFfmiOffset('male', 2)));
    expect(gTr).toBeCloseTo(expected, 9);
    // dossier 14's +1.75 FFMI at 2 y (5.5 kg) is below 09's TS₀·G_pot (0.61 × 19 kg = 11.6 kg): the rest is set-point
    expect(gTr).toBeGreaterThan(4);
    expect(gTr).toBeLessThan(0.6 * sum(s.mAcc0));
    for (let r = 0; r < 9; r++) {
      expect(s.mBase[r]!).toBeGreaterThanOrEqual(0);
      expect(s.mFloor[r]!).toBeCloseTo(s.mBase[r]! + 0.5 * (s.mAcc0[r]! - s.mBase[r]!), 12);
    }
  });
  it('without habitual RT the floor is the set-point, i.e. all of M_acc₀ (unchanged)', () => {
    for (const o of [{ ...YOUNG, bodyFatPct: 10 }, { ...YOUNG, trainingYears: 3, trainingHistory: 'none' as const, sessionsPerWeek: 0 }]) {
      const sim = new MuscleSim(person(o));
      for (let r = 0; r < 9; r++) {
        expect(sim.s.mBase[r]).toBeCloseTo(sim.s.mAcc[r]!, 12);
        expect(sim.s.mFloor[r]).toBeCloseTo(sim.s.mAcc[r]!, 12);
      }
    }
  });
  it('stopping: no loss for 3 weeks after the last session, then τ_d decay towards the floor (82 % ± 10 of the losable gains at 20 weeks)', () => {
    const sim = lifter();
    const losable = sum(sim.s.mAcc0) - sum(sim.s.mFloor);
    const lost: number[] = [];
    sim.run(140, rest(sim), undefined, () => void lost.push(-sim.gain()));
    // last session day −3: λ > 0 from T_low 15, i.e. day 18 = 21 days after it
    expect(Math.abs(lost[17]!)).toBeLessThan(1e-12);
    expect(lost[20]! / losable).toBeLessThan(0.01);
    expect(Math.abs(lost[139]! / losable - 0.82)).toBeLessThanOrEqual(0.1);
    for (let d = 1; d < 140; d++) expect(lost[d]!).toBeGreaterThanOrEqual(lost[d - 1]! - 1e-12);
    // a year off: bounded by the floor; the set-point and half of the trained gains remain
    sim.run(225, rest(sim));
    expect(-sim.gain()).toBeLessThanOrEqual(losable + 1e-9);
    expect(-sim.gain()).toBeGreaterThan(0.95 * losable);
    for (let r = 0; r < 9; r++) expect(sim.s.mAcc[r]!).toBeGreaterThanOrEqual(sim.s.mFloor[r]! - 1e-12);
    checkBounds(sim);
  });
  it('the retained share follows detrainFloorFrac (registry 0.3-0.7)', () => {
    const lo = lifter(LIFTER, { 'muscle.detrainFloorFrac': 0.3 });
    const hi = lifter(LIFTER, { 'muscle.detrainFloorFrac': 0.7 });
    lo.run(365, rest(lo));
    hi.run(365, rest(hi));
    const g = sum(lo.s.mAcc0) - sum(lo.s.mBase);
    expect(-lo.gain() / g).toBeCloseTo(0.7, 1);
    expect(-hi.gain() / g).toBeCloseTo(0.3, 1);
  });
  it('gains accrued inside the run detrain fully (Psilander 2019): the floor covers only the long-term gains held at t = 0', () => {
    const sim = lifter();
    sim.run(84, rtWeek(sim, 20 / 3, 3, 1.8)); // V 20, 1.8 g/kg: above the habitual stimulus
    const added = sim.gain();
    expect(added).toBeGreaterThan(0.3);
    sim.run(365, rest(sim));
    const losable = sum(sim.s.mAcc0) - sum(sim.s.mFloor);
    expect(-sim.gain()).toBeGreaterThan(0.95 * losable);
    expect(-sim.gain()).toBeLessThanOrEqual(losable + 1e-9);
  });
  it('R-REGAIN: 12 weeks off, then the habitual programme — ≥ 60 % of the loss back in 16 weeks, all by 26, never above the peak', () => {
    // basis: 09 §4.10 — regain at 09's own rate (gap term (1 − TS), habituation, κ_mem 1.3 while M_acc < 0.95·M_peak); for
    // this lifter 09's rate without any habitual reference regains 86 % in 16 weeks (the retraining pace the ruling asks for)
    const regain = (kMem?: number): { lost: number; at: Record<number, number>; peakOk: boolean; boosted: boolean } => {
      const sim = lifter(LIFTER, kMem === undefined ? undefined : { 'muscle.kMem': kMem });
      sim.run(84, rest(sim));
      const lost = -sim.gain();
      let boosted = true;
      for (let r = 0; r < 9; r++) boosted &&= sim.s.mAcc[r]! < 0.95 * sim.s.mPeak[r]!;
      const at: Record<number, number> = {};
      let peakOk = true;
      const hab = rtWeek(sim, 11 / 3, 3, 1.4);
      for (let w = 1; w <= 52; w++) {
        sim.run(7, hab);
        at[w] = (lost + sim.gain()) / lost;
        for (let r = 0; r < 9; r++) peakOk &&= sim.s.mAcc[r]! <= sim.s.mPeak[r]! + 1e-12 && sim.s.mPeak[r]! <= sim.s.mAcc0[r]! + 1e-12;
      }
      return { lost, at, peakOk, boosted };
    };
    const def = regain(); // default κ_mem 1.3 (R-REGAIN)
    const first = regain(1.0); // no memory boost = the first-time pace at the same training status
    expect(def.lost).toBeGreaterThan(1);
    expect(def.boosted).toBe(true); // M_peak is kept: the memory reserve M_peak − M_acc exists after detraining
    expect(def.at[16]!).toBeGreaterThanOrEqual(0.6); // model 0.85
    expect(def.at[26]!).toBeGreaterThan(0.99);
    expect(def.at[52]!).toBeCloseTo(1, 9); // back at M_acc,0 and flat: the habitual equilibrium again
    expect(def.peakOk).toBe(true);
    // faster than the first time: at 8 and 16 weeks the boosted regain leads the unboosted one (model 43/85 % vs 34/72 %)
    expect(def.at[8]!).toBeGreaterThan(1.15 * first.at[8]!);
    expect(def.at[16]!).toBeGreaterThan(first.at[16]!);
    expect(first.at[16]!).toBeGreaterThanOrEqual(0.6); // even without the boost (R-MEM's old 1.0): 72 %
  });
});

describe('property tests', () => {
  it('maintenance without RT stays steady for 30 days (untrained)', () => {
    const sim = new MuscleSim(person(YOUNG));
    sim.run(30, compileWeek(sim.profile, [program('B')], [0]));
    expect(sim.gain()).toBe(0);
    expect(sim.bus.rtAccretionKgD).toBe(0);
    expect(sim.bus.trainingStatus).toBeCloseTo(0, 6);
    expect(sim.strength()).toBeCloseTo(100, 6);
    checkBounds(sim);
  });
  it('trained user at maintenance with a steady programme: slow monotone progress, bounded', () => {
    const sim = new MuscleSim(person({ ...YOUNG, trainingYears: 3, trainingHistory: '1to3y' }));
    const week = rtWeek(sim, 4, 3, 1.6);
    let prev = sim.gain();
    for (let d = 0; d < 30; d++) {
      sim.run(1, week);
      expect(sim.gain()).toBeGreaterThanOrEqual(prev);
      prev = sim.gain();
    }
    expect(sim.gain()).toBeLessThan(0.5);
    checkBounds(sim);
  });
  it('zero intake for 21 days with continued RT stays finite; accretion collapses with protein', () => {
    const sim = new MuscleSim(person(YOUNG));
    const A = program('A', { proteinGkg: 0, meals: 1, sessions: [{ startH: 17, sets: 4 }] });
    const B = program('B', { proteinGkg: 0, meals: 1 });
    const week = compileWeek(sim.profile, [A, B], [0, 1, 0, 1, 0, 1, 1]);
    sim.run(21, week, (_d, bus) => {
      bus.energyBalanceFrac = -1;
      bus.raAaQGH = 0;
    });
    checkBounds(sim);
    expect(sim.bus.rtAccretionKgD).toBeCloseTo(0, 9);
  });
  it('random schedules (seeded): all stores stay within their physical bounds', () => {
    const rnd = mulberry32(42);
    for (let trial = 0; trial < 6; trial++) {
      const sim = new MuscleSim(person({ age: 20 + 60 * rnd(), sex: rnd() < 0.5 ? 'male' : 'female', heightCm: 155 + 35 * rnd(), weightKg: 50 + 70 * rnd() }));
      const progs = [0, 1, 2].map((i) =>
        program(`P${i}`, {
          proteinGkg: 3 * rnd(),
          meals: 1 + Math.floor(5 * rnd()),
          sessions: rnd() < 0.6 ? [{ startH: 6 + 14 * rnd(), sets: 12 * rnd(), rir: 5 * rnd(), loadPct1RM: 10 + 85 * rnd(), restSec: 30 + 200 * rnd(), toFailure: rnd() < 0.3 }] : [],
          alcohol: rnd() < 0.3 ? [{ clockH: 21, drinks: 6 * rnd() }] : undefined,
        }),
      );
      const week = compileWeek(sim.profile, progs, [0, 1, 2, 0, 1, 2, 1]);
      sim.run(60, week, (_d, bus) => {
        bus.energyBalanceFrac = 2 * rnd() - 1;
        bus.mpsSleepMult = 0.8 + 0.2 * rnd();
        bus.creatineSatFrac = rnd();
        bus.muscleGlycogenRel = rnd();
        bus.strengthEaMult = 0.7 + 0.3 * rnd();
      });
      checkBounds(sim);
    }
  });
  it('monotonicity of 12-week accretion: volume ↑, protein ↑, deficit ↓, age ↓, RIR ↓, very light load ↓', () => {
    const g = (o: { v?: number; p?: number; e?: number; age?: number; rir?: number; load?: number }): number => {
      const sim = new MuscleSim(person({ ...YOUNG, age: o.age ?? 25 }));
      const A = program('A', { proteinGkg: o.p ?? 1.6, sessions: [{ startH: 17, sets: (o.v ?? 12) / 3, rir: o.rir ?? 0, loadPct1RM: o.load ?? 75 }] });
      const week = compileWeek(sim.profile, [A, program('B', { proteinGkg: o.p ?? 1.6 })], [0, 1, 0, 1, 0, 1, 1]);
      sim.run(84, week, (_d, bus) => void (bus.energyBalanceFrac = o.e ?? 0));
      return sim.gain();
    };
    const vs = [4, 8, 12, 20, 30].map((v) => g({ v }));
    for (let i = 1; i < vs.length; i++) expect(vs[i]!).toBeGreaterThan(vs[i - 1]!);
    const ps = [0.8, 1.2, 1.6, 2.2].map((p) => g({ p, e: -0.2 }));
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeGreaterThan(ps[i - 1]!);
    const es = [0, -0.1, -0.2, -0.3].map((e) => g({ e, p: 1.2 }));
    for (let i = 1; i < es.length; i++) expect(es[i]!).toBeLessThan(es[i - 1]!);
    expect(g({ age: 60 })).toBeLessThan(g({ age: 30 }));
    expect(g({ rir: 4 })).toBeLessThan(g({ rir: 0 }));
    expect(g({ load: 15 })).toBeLessThan(g({ load: 60 }));
  });
  it('determinism: identical inputs give bit-identical state', () => {
    const run = (): MuscleSim => {
      const sim = new MuscleSim(person(YOUNG));
      sim.run(40, rtWeek(sim, 4, 3, 1.6));
      return sim;
    };
    const a = run();
    const b = run();
    expect(structuredClone(a.s)).toEqual(structuredClone(b.s));
  });
});

describe('multipliers on A_r (training-day accretion)', () => {
  /** rtAccretionKgD of the 15th day (a training day) with hooks applied on that day only. */
  const accretionOnDay = (
    hook?: (h: number, hour: HourInput, bus: SignalBus) => void,
    dayBus?: (bus: SignalBus) => void,
    dayIdx = 0,
  ): number => {
    const sim = new MuscleSim(person(YOUNG));
    const week = rtWeek(sim, 4, 3, 1.6);
    sim.run(14, week);
    if (dayBus) dayBus(sim.bus);
    sim.runDay(week[dayIdx]!, hook);
    return sim.bus.rtAccretionKgD;
  };
  it('alcohol after the session (Parr 2014): 1.5 g/kg → −24 % with ≥ 0.3 g/kg protein within 2 h, −37 % without', () => {
    const base = accretionOnDay();
    const bw = new MuscleSim(person(YOUNG)).bus.tissueMassKg;
    const withAlc = (protein: boolean): number =>
      accretionOnDay((h, hour) => {
        hour.proteinG = 0;
        // session 17:00-18:30 (36 sets × 2.5 min): the window opens at 19 h
        if (h === 19) hour.alcoholG = 1.5 * bw;
        if (protein && h === 19) hour.proteinG = 0.35 * bw;
      });
    expect(withAlc(true) / base).toBeCloseTo(0.76, 6);
    expect(withAlc(false) / base).toBeCloseTo(0.63, 6);
  });
  it('alcohol on a day without a session in the preceding 8 h has no effect', () => {
    const bw = new MuscleSim(person(YOUNG)).bus.tissueMassKg;
    const base = accretionOnDay(undefined, undefined, 1);
    const drunk = accretionOnDay((h, hour) => void (h === 20 && (hour.alcoholG = 1.5 * bw)), undefined, 1);
    expect(drunk).toBeCloseTo(base, 12);
    expect(base).toBeGreaterThan(0);
  });
  it('creatine saturation 1 → ×1.05; sleep multiplier 0.82 → ×0.82', () => {
    const base = accretionOnDay();
    expect(accretionOnDay(undefined, (b) => void (b.creatineSatFrac = 1)) / base).toBeCloseTo(1.05, 9);
    expect(accretionOnDay(undefined, (b) => void (b.mpsSleepMult = 0.82)) / base).toBeCloseTo(0.82, 9);
  });
  it('f_fastHV: glycogen-depleted sessions count sets beyond the 10th per region ×0.95', () => {
    const run = (gly: number): number => {
      const sim = new MuscleSim(person(YOUNG));
      const A = program('A', { sessions: [{ startH: 17, sets: 14 }] });
      const d = compileWeek(sim.profile, [A], [0])[0]!;
      sim.runDay(d, (_h, _hour, bus) => void (bus.muscleGlycogenRel = gly));
      return sim.s.vR[0]!;
    };
    expect(run(1)).toBeCloseTo(14, 9);
    expect(run(0.3)).toBeCloseTo(10 + 4 * 0.95, 9);
  });
  it('meal distribution: OMAD lowers accretion to E_dist 0.83', () => {
    const run = (meals: number): number => {
      const sim = new MuscleSim(person(YOUNG));
      const A = program('A', { meals, windowLengthH: meals === 1 ? 1 : 12, sessions: [{ startH: 17, sets: 4 }] });
      const week = compileWeek(sim.profile, [A], [0]);
      sim.run(10, week);
      return sim.s.eDist;
    };
    expect(run(3)).toBe(1);
    expect(run(1)).toBeCloseTo(0.83, 12);
  });
});

describe('21 §4D-4 post-RT cold-water immersion (SessionResolved.coldWaterImmersion)', () => {
  /** Daily accretion and neural target after 21 days of 3 sessions/wk, `cwi` = which of the 3 weekly sessions get CWI. */
  const run = (cwi: boolean[]): { acc: number; nTarget: number } => {
    const sim = new MuscleSim(person(YOUNG));
    const progs = cwi.map((c, i) => program(`S${i}`, { proteinGkg: 1.6, sessions: [{ startH: 17, sets: 4, coldWaterImmersion: c }] }));
    progs.push(program('R', { proteinGkg: 1.6 }));
    const week = compileWeek(sim.profile, progs, [0, 3, 1, 3, 2, 3, 3]);
    sim.run(21, week); // day 20 is a rest day; its 7-day window holds the three sessions of days 14, 16, 18
    return { acc: sim.bus.rtAccretionKgD, nTarget: sim.s.cwiWb };
  };
  it('every session followed by CWI: accretion and the neural target × f_CWI 0.8 (21: 0.8, grade B)', () => {
    const base = run([false, false, false]);
    const all = run([true, true, true]);
    expect(all.acc / base.acc).toBeCloseTo(0.8, 2); // H and TS differ by < 1 % after 3 weeks
    expect(all.nTarget).toBeCloseTo(0.8, 12);
    expect(base.nTarget).toBe(1);
  });
  it('one of three weekly sessions with CWI blunts only that session: factor 1 − 0.2/3', () => {
    const one = run([true, false, false]);
    expect(one.nTarget).toBeCloseTo(1 - 0.2 / 3, 12);
    const base = run([false, false, false]);
    expect(one.acc / base.acc).toBeCloseTo(1 - 0.2 / 3, 2);
  });
  it('hand-built session without the field counts as no CWI', () => {
    const sim = new MuscleSim(person(YOUNG));
    const d = compileWeek(sim.profile, [program('A', { sessions: [{ startH: 17, sets: 4 }] })], [0])[0]!;
    delete (d.sessions[0] as { coldWaterImmersion?: boolean }).coldWaterImmersion;
    sim.runDay(d);
    expect(sim.s.cwiWb).toBe(1);
  });
});

describe('signals and events', () => {
  it('rtVolumeWb = mass-weighted V_r; retention and smRtKg follow', () => {
    const sim = new MuscleSim(person(YOUNG));
    const A = program('A', { sessions: [{ startH: 10, sets: { quads: 6, arms: 3 } }] });
    sim.run(7, compileWeek(sim.profile, [A, program('B')], [0, 1, 1, 0, 1, 1, 1]));
    expect(sim.bus.rtVolumeWb).toBeCloseTo(0.2 * 12 + 0.1 * 6, 9);
    expect(sim.bus.rtRetentionFrac).toBeCloseTo(0.75 * Math.min(1, 3 / 6), 9);
    expect(sim.bus.smRtKg).toBeCloseTo(0.7 * sim.gain(), 12);
  });
  it('rtDoseFrac = min(1, V_wb/V_R(age)) and rtRetentionFrac = R_max·rtDoseFrac', () => {
    const sim = new MuscleSim(person({ ...YOUNG, age: 60 }));
    const A = program('A', { sessions: [{ startH: 10, sets: 2 }] });
    sim.run(7, compileWeek(sim.profile, [A, program('B')], [0, 1, 1, 0, 1, 1, 1]));
    const vR = 6 + (10 - 6) * 0.5; // 8 sets/wk at 60 y
    expect(sim.bus.rtDoseFrac).toBeCloseTo(4 / vR, 9);
    expect(sim.bus.rtRetentionFrac).toBeCloseTo(0.75 * sim.bus.rtDoseFrac, 12);
  });
  it('detrainingOnset fires once, ~3 weeks after the last session, for a trained user who stops', () => {
    const sim = new MuscleSim(person({ ...YOUNG, trainingYears: 3, trainingHistory: '1to3y' }));
    sim.run(14, rtWeek(sim, 4, 3, 1.6));
    sim.run(60, compileWeek(sim.profile, [program('B')], [0]));
    const ev = sim.events.filter((e) => e.type === 'detrainingOnset');
    expect(ev.length).toBe(1);
    const day = Math.floor(ev[0]!.hour / 24);
    expect(day).toBeGreaterThan(14 + 14);
    expect(day).toBeLessThan(14 + 28);
  });
  it('no detrainingOnset for a never-trained user', () => {
    const sim = new MuscleSim(person(YOUNG));
    sim.run(60, compileWeek(sim.profile, [program('B')], [0]));
    expect(sim.events.length).toBe(0);
  });
});

describe('MPS kernel and display layer', () => {
  it('mpsStimWb is the muscle-mass-weighted kernel (arms only → w_arms·S_arms); rises then decays', () => {
    const sim = new MuscleSim(person(YOUNG));
    const A = program('A', { sessions: [{ startH: 8, sets: { arms: 8 } }] });
    sim.runDay(compileWeek(sim.profile, [A], [0])[0]!);
    const peak = Math.max(...sim.stimHours);
    expect(peak).toBeCloseTo(0.1 * (1 - Math.exp(-2)), 2); // untrained A(0) = 1, a(8) = 0.865
    expect(sim.stimHours[23]!).toBeLessThan(peak);
    expect(sim.stimHours[23]!).toBeGreaterThan(0.5 * peak);
  });
  it('protein meals raise the MPS index above basal; deficit lowers basal after a few days', () => {
    const sim = new MuscleSim(person(YOUNG));
    const d = compileWeek(sim.profile, [program('B')], [0])[0]!;
    sim.runDay(d, (h, _hour, bus) => void (bus.raAaQGH = h >= 8 && h < 11 ? 8 : 0));
    expect(Math.max(...sim.mpsHours)).toBeGreaterThan(150);
    expect(sim.mpsHours[3]!).toBeCloseTo(100, 6);
    for (let i = 0; i < 6; i++) sim.runDay(d, (_h, _hour, bus) => {
      bus.raAaQGH = 0;
      bus.energyBalanceFrac = -0.4;
    });
    expect(sim.mpsHours[3]!).toBeLessThan(90);
    expect(sim.mpsHours[3]!).toBeGreaterThanOrEqual(50);
  });
  it('mps series not requested → the display layer is skipped (index stays at basal)', () => {
    const sim = new MuscleSim(person(YOUNG), { mpsEnabled: false });
    const d = compileWeek(sim.profile, [program('B')], [0])[0]!;
    sim.runDay(d, (h, _hour, bus) => void (bus.raAaQGH = h === 9 ? 10 : 0));
    expect(Math.max(...sim.mpsHours)).toBe(100);
  });
});
