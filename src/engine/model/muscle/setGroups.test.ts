// @vitest-environment node
/**
 * D3-01 set groups in the muscle module (and the D2-01 fast-metadata invariant of its inputs).
 *
 * e_r = Σ_g n_g·w_rg·f_type,g·f_RIR,g·f_load,g·f_rest,g with the run's drawn constants, each factor once per group, summed
 * only afterwards; raw physical sets stay separate from region-weighted and effective sets. The expected values below are
 * computed independently from the scalar factor equations (never from `groupSetFactor`), under nominal and non-nominal
 * parameter draws, so averaging, overwriting or double type factors would show.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SET_GROUPS_PER_DAY, N_REGIONS, TRAINING_REGIONS, type DayInput, type ResistanceGroupResolved } from '../../types/inputs';
import type { ContractionType, ResistanceSetGroup, TrainingRegion } from '../../types/schedule';
import { buildModelParams, withOverrides } from '../../core/paramsRegistry';
import { DEFAULTS } from '../../core/defaults';
import { MODULES } from '../../core/moduleRegistry';
import { resolveDose, sessionSetGroups, toEngineDose, loadPctFromRepsToFailure } from '@/catalogues/stimulus';
import { catalogueParam } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import type { ExerciseRecord } from '@/catalogues';
import { readMuscleConstants, type MuscleConstants } from './constants';
import * as M from './equations';
import { MUSCLE_CAUSAL_RESOLUTION, MUSCLE_DAILY_NATIVE_READS, MUSCLE_OUTPUT_RESOLUTION, muscleModule } from './index';
import { MuscleSim, compileWeek, person, program, type ProgramOpts } from './__tests__/harness';

const YOUNG = { age: 30, sex: 'male' as const, heightCm: 178, weightKg: 80 };
/** Non-nominal draw (inside the registry ranges where the parameter has one). */
const DRAW: Record<string, number> = { 'muscle.kRir': 0.085, 'muscle.fRest60': 0.82, 'muscle.fLoad20': 0.55, 'muscle.fCwi': 0.6 };
const RI = (r: TrainingRegion): number => TRAINING_REGIONS.indexOf(r);

function weights(w: Partial<Record<TrainingRegion, number>>): Float64Array {
  const a = new Float64Array(N_REGIONS);
  for (const [r, v] of Object.entries(w) as Array<[TrainingRegion, number]>) a[RI(r)] = v;
  return a;
}

interface G {
  session?: number;
  sets?: number;
  w: Partial<Record<TrainingRegion, number>>;
  contraction?: ContractionType;
  included?: boolean;
  load?: number;
  rir?: number;
  rest?: number;
}
function grp(o: G): ResistanceGroupResolved {
  return {
    session: o.session ?? -1,
    sets: o.sets ?? 3,
    regionWeights: weights(o.w),
    contraction: o.contraction ?? 'dynamic',
    typeFactorIncluded: o.included ?? false,
    loadPct1RM: o.load ?? 75,
    rir: o.rir ?? 2,
    restSec: o.rest ?? 120,
    startH: 17,
    durationMin: 10,
    assumed: 0,
  };
}

/** Independent per-set factor from the scalar equations (f_type from the contraction defaults unless included). */
function expectedFactor(K: MuscleConstants, g: ResistanceGroupResolved): number {
  const fType = g.typeFactorIncluded ? 1 : g.contraction === 'dynamic' ? 1 : 0.5;
  const effort = g.contraction === 'isometric' ? 1 : M.fRir(K, g.rir, g.loadPct1RM) * M.fLoad(K, g.loadPct1RM);
  return fType * effort * M.fRest(K, g.restSec);
}
function expectedDose(K: MuscleConstants, groups: readonly ResistanceGroupResolved[], sets?: readonly number[]): Float64Array {
  const out = new Float64Array(N_REGIONS);
  groups.forEach((g, i) => {
    const n = sets ? sets[i]! : g.sets;
    const f = expectedFactor(K, g);
    for (let r = 0; r < N_REGIONS; r++) out[r] = out[r]! + n * g.regionWeights[r]! * f;
  });
  return out;
}

/** A fresh compiled day (optionally with legacy sessions, used for session-level CWI/failure flags). */
function day(sim: MuscleSim, sessions: ProgramOpts['sessions'] = []): DayInput {
  return compileWeek(sim.profile, [program('A', { sessions })], [0])[0]!;
}

/** Run one day whose dose is `groups`, with the sets started per hour given as hour → sets per group index. */
function runGrouped(sim: MuscleSim, d: DayInput, groups: ResistanceGroupResolved[], perHour: Record<number, readonly number[]>, glycogen = 1): void {
  d.rtGroups = groups;
  d.nRtGroups = groups.length;
  sim.runDay(d, (h, hour, bus) => {
    // overwrite the hour's group row in place (whatever the compiler spread there): the test sets the timing itself
    const row = (hour.rtGroupSets ??= new Float64Array(MAX_SET_GROUPS_PER_DAY));
    row.fill(0);
    perHour[h]?.forEach((v, g) => (row[g] = v));
    bus.muscleGlycogenRel = glycogen;
  });
}

const all = (groups: readonly unknown[], h = 17): Record<number, number[]> => ({ [h]: groups.map((g) => (g as ResistanceGroupResolved).sets) });
const expectArrayClose = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 12, msg = ''): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]!, `${msg}[${i}]`).toBeCloseTo(b[i]!, digits);
};
const cwiRing = (sim: MuscleSim, r: number): number => {
  let x = 0;
  for (let j = 0; j < 7; j++) x += sim.s.cwiLossHist[r * 7 + j]!;
  return x;
};
const lastSlot = (sim: MuscleSim): number => (sim.s.histIdx + 6) % 7;

describe('D3-01 group path: per-group drawn factors, summed afterwards', () => {
  it('one homogeneous group reproduces the legacy single-session path (nominal and drawn constants)', () => {
    for (const overrides of [undefined, DRAW]) {
      const legacy = new MuscleSim(person(YOUNG), { overrides });
      legacy.runDay(day(legacy, [{ startH: 17, sets: { chest: 3 }, rir: 2, loadPct1RM: 75, restSec: 60 }]));
      const grouped = new MuscleSim(person(YOUNG), { overrides });
      const g = [grp({ session: 0, sets: 3, w: { chest: 1 }, rir: 2, load: 75, rest: 60 })];
      runGrouped(grouped, day(grouped, [{ startH: 17, sets: { chest: 3 }, rir: 2, loadPct1RM: 75, restSec: 60 }]), g, all(g));
      expectArrayClose(grouped.s.vR, legacy.s.vR, 12, 'vR');
      expectArrayClose(grouped.stimHours, legacy.stimHours, 12, 'mpsStimWb');
      expect(grouped.s.setsTotHist[lastSlot(grouped)]).toBeCloseTo(legacy.s.setsTotHist[lastSlot(legacy)]!, 12);
      expectArrayClose(grouped.s.vR, expectedDose(grouped.k, g), 12, 'expected');
    }
  });

  it('mixed chest/quads groups keep their own load, RIR and rest under a non-nominal draw (no averaged factors)', () => {
    const sim = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const g = [grp({ sets: 3, w: { chest: 1, arms: 0.5 }, load: 82, rir: 1, rest: 60 }), grp({ sets: 4, w: { quads: 1, glutes: 0.5 }, load: 40, rir: 5, rest: 180 })];
    runGrouped(sim, day(sim), g, all(g));
    const want = expectedDose(sim.k, g);
    expectArrayClose(sim.s.vR, want, 12);
    // the averaged single-session dose (the pre-D3-01 merge: mean RIR/load/rest) is a different number
    const K = sim.k;
    const avgRir = (3 * 1 + 4 * 5) / 7;
    const avgLoad = (3 * 82 + 4 * 40) / 7;
    const avgRest = (3 * 60 + 4 * 180) / 7;
    const merged = 3 * M.fRir(K, avgRir, avgLoad) * M.fLoad(K, avgLoad) * M.fRest(K, avgRest);
    expect(Math.abs(merged - want[RI('chest')]!)).toBeGreaterThan(0.05);
  });

  it('group permutation and splitting identical groups leave per-region dose, kernel, frequency and raw sets unchanged', () => {
    const A = grp({ sets: 6, w: { chest: 1, shoulders: 0.5, arms: 0.5 }, load: 72, rir: 2, rest: 75 });
    const B = grp({ sets: 3, w: { core: 1 }, contraction: 'isometric', load: 35, rir: 0, rest: 60 });
    const C = grp({ sets: 8, w: { chest: 1, hamstrings: 1 }, contraction: 'ballistic', load: 55, rir: 3, rest: 45 });
    const A1 = { ...A, sets: 2, regionWeights: A.regionWeights.slice() };
    const A2 = { ...A, sets: 4, regionWeights: A.regionWeights.slice() };
    const variants = [[A, B, C], [C, A, B], [B, C, A1, A2], [A2, C, B, A1]];
    // glycogen-depleted: f_fastHV discounts chest sets beyond the 10th, whatever the order inside the hour
    for (const glycogen of [1, 0.3]) {
      const sims = variants.map((v) => {
        const sim = new MuscleSim(person(YOUNG), { overrides: DRAW });
        runGrouped(sim, day(sim), v, all(v), glycogen);
        return sim;
      });
      for (const sim of sims.slice(1)) {
        expectArrayClose(sim.s.vR, sims[0]!.s.vR, 12, `vR g${glycogen}`);
        expectArrayClose(sim.s.fR, sims[0]!.s.fR, 12, 'fR');
        expectArrayClose(sim.stimHours, sims[0]!.stimHours, 12, 'mpsStimWb');
        expect(sim.s.setsTotHist[lastSlot(sim)]).toBeCloseTo(sims[0]!.s.setsTotHist[lastSlot(sims[0]!)]!, 12);
        expect(sim.s.loadSHist[lastSlot(sim)]).toBeCloseTo(sims[0]!.s.loadSHist[lastSlot(sims[0]!)]!, 12);
      }
      if (glycogen === 1) expectArrayClose(sims[0]!.s.vR, expectedDose(sims[0]!.k, [A, B, C]), 12, 'expected');
      else expect(sims[0]!.s.vR[RI('chest')]!).toBeLessThan(expectedDose(sims[0]!.k, [A, B, C])[RI('chest')]!);
    }
  });

  it('two distinct sequential bouts within one hour retain their own rest, effort, failure and CWI (no first-session or last-RIR overwrite)', () => {
    const sim = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const d = day(sim, [
      { startH: 17, sets: { chest: 3 }, rir: 0, loadPct1RM: 85, restSec: 180, toFailure: true },
      { startH: 17.5, sets: { quads: 3 }, rir: 4, loadPct1RM: 60, restSec: 45, coldWaterImmersion: true },
    ]);
    const g = [grp({ session: 0, sets: 3, w: { chest: 1 }, load: 85, rir: 0, rest: 180 }), grp({ session: 1, sets: 3, w: { quads: 1, chest: 0.5 }, load: 60, rir: 4, rest: 45 })];
    runGrouped(sim, d, g, all(g));
    const K = sim.k;
    const f0 = M.fRir(K, 0, 85) * M.fLoad(K, 85) * M.fRest(K, 180);
    const f1 = M.fRir(K, 4, 60) * M.fLoad(K, 60) * M.fRest(K, 45);
    expect(sim.s.vR[RI('chest')]).toBeCloseTo(3 * f0 + 1.5 * f1, 12);
    expect(sim.s.vR[RI('quads')]).toBeCloseTo(3 * f1, 12);
    // CWI only on the second bout's effective sets
    expect(cwiRing(sim, RI('quads'))).toBeCloseTo(3 * f1 * (1 - K.fCwi), 12);
    expect(cwiRing(sim, RI('chest'))).toBeCloseTo(1.5 * f1 * (1 - K.fCwi), 12);
    // failure only where the failure bout trained
    expect(sim.s.lastFail[RI('chest')]).toBe(1);
    expect(sim.s.lastFail[RI('quads')]).toBe(0);
  });

  it('more than four heterogeneous groups retain every group’s dose (no slot overflow, no averaging)', () => {
    const sim = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const g: ResistanceGroupResolved[] = [];
    const regions: TrainingRegion[] = ['chest', 'upperBack', 'shoulders', 'arms', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];
    for (let i = 0; i < 12; i++) {
      const c: ContractionType = i % 4 === 3 ? 'isometric' : i % 5 === 4 ? 'ballistic' : 'dynamic';
      const w: Partial<Record<TrainingRegion, number>> = {};
      w[regions[i % 9]!] = 1;
      w[regions[(i + 4) % 9]!] = 0.5;
      g.push(grp({ sets: 1 + (i % 3), w, contraction: c, load: 25 + 6 * i, rir: i % 6, rest: 30 + 20 * i }));
    }
    runGrouped(sim, day(sim), g, { 16: g.map((x, i) => (i < 6 ? x.sets : 0)), 17: g.map((x, i) => (i < 6 ? 0 : x.sets)) });
    expectArrayClose(sim.s.vR, expectedDose(sim.k, g), 12);
    expect(sim.s.setsTotHist[lastSlot(sim)]).toBeCloseTo(g.reduce((a, x) => a + x.sets, 0), 12);
  });

  it('contraction factor exactly once: tagged pre-weighted weights equal raw weights; holds bypass f_RIR/f_load; ballistic keeps them', () => {
    const raw = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const iso = [grp({ sets: 4, w: { core: 1, glutes: 0.5 }, contraction: 'isometric', load: 10, rir: 6, rest: 60 })];
    runGrouped(raw, day(raw), iso, all(iso));
    const tagged = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const isoTagged = [grp({ sets: 4, w: { core: 0.5, glutes: 0.25 }, contraction: 'isometric', included: true, load: 10, rir: 6, rest: 60 })];
    runGrouped(tagged, day(tagged), isoTagged, all(isoTagged));
    expectArrayClose(tagged.s.vR, raw.s.vR, 12);
    // hold: 0.5 × f_rest only (load 10 % and RIR 6 would otherwise cut it)
    expect(raw.s.vR[RI('core')]).toBeCloseTo(4 * 0.5 * M.fRest(raw.k, 60), 12);
    const bal = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const b = [grp({ sets: 4, w: { hamstrings: 1 }, contraction: 'ballistic', load: 50, rir: 3, rest: 60 })];
    runGrouped(bal, day(bal), b, all(b));
    expect(bal.s.vR[RI('hamstrings')]).toBeCloseTo(4 * 0.5 * M.fRir(bal.k, 3, 50) * M.fLoad(bal.k, 50) * M.fRest(bal.k, 60), 12);
    expect(M.typeFactor('ballistic', true)).toBe(1);
    expect(M.CONTRACTION_TYPE_FACTOR.isometric).toBe(catalogueParam('isometricNonFailureFactor'));
    expect(M.CONTRACTION_TYPE_FACTOR.ballistic).toBe(catalogueParam('ballisticSetFactor'));
  });

  it('a bout crossing an hour and midnight keeps its whole dose, CWI and failure; a copy without bout flags gets none', () => {
    const base = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const g = [grp({ session: 0, sets: 4, w: { chest: 1 }, load: 70, rir: 1, rest: 60 })];
    runGrouped(base, day(base, [{ startH: 22, sets: { chest: 4 }, coldWaterImmersion: true }]), g, { 22: [4] });
    runGrouped(base, day(base), [], {});
    const f = M.fRir(base.k, 1, 70) * M.fLoad(base.k, 70) * M.fRest(base.k, 60);
    expect(base.s.vR[RI('chest')]).toBeCloseTo(4 * f, 12);
    expect(cwiRing(base, RI('chest'))).toBeCloseTo(4 * f * (1 - base.k.fCwi), 12);
    // day 2: the carried part of the same bout (session −1: its session lives on the previous day). The compiler copy
    // carries the bout's origin and flags (`originDay`, `sessionId`, `coldWaterImmersion`, `toFailure`), so CWI covers all
    // four sets; a hand-built copy without them has no session to read flags from and gets none.
    for (const flags of [true, false]) {
      const split = new MuscleSim(person(YOUNG), { overrides: DRAW });
      runGrouped(split, day(split, [{ startH: 22, sets: { chest: 4 }, coldWaterImmersion: true }]), g, { 22: [1], 23: [1] });
      const carried: ResistanceGroupResolved = {
        ...g[0]!,
        session: -1,
        regionWeights: g[0]!.regionWeights.slice(),
        ...(flags ? { originDay: 0, sessionId: 'bout-1', coldWaterImmersion: true, toFailure: false } : {}),
      };
      runGrouped(split, day(split), [carried], { 0: [2] });
      expect(split.s.vR[RI('chest')]).toBeCloseTo(4 * f, 12);
      expect(cwiRing(split, RI('chest'))).toBeCloseTo((flags ? 4 : 2) * f * (1 - split.k.fCwi), 12);
    }
    // a carried copy of a failure bout: failure on the regions it trained, its sets at RIR 0
    const fail = new MuscleSim(person(YOUNG), { overrides: DRAW });
    runGrouped(fail, day(fail), [{ ...g[0]!, session: -1, regionWeights: g[0]!.regionWeights.slice(), toFailure: true }], { 0: [2] });
    expect(fail.s.vR[RI('chest')]).toBeCloseTo(2 * M.fRir(fail.k, 0, 70) * M.fLoad(fail.k, 70) * M.fRest(fail.k, 60), 12);
    expect(fail.s.lastFail[RI('chest')]).toBe(1);
    expect(fail.s.lastFail[RI('quads')]).toBe(0);
  });

  it('raw physical sets (neural practice) are physical sets, not the sum of region weights', () => {
    const sim = new MuscleSim(person(YOUNG));
    const g = [grp({ sets: 3, w: { chest: 1, shoulders: 0.5, arms: 0.5 }, load: 85 }), grp({ sets: 2, w: { quads: 1, glutes: 1, hamstrings: 0.5 }, load: 50 })];
    runGrouped(sim, day(sim), g, all(g));
    const slot = lastSlot(sim);
    expect(sim.s.setsTotHist[slot]).toBeCloseTo(5, 12);
    expect(sim.s.loadSHist[slot]).toBeCloseTo(3 * M.fLoadStrength(sim.k, 85) + 2 * M.fLoadStrength(sim.k, 50), 12);
  });

  it('unknown (NaN) load, RIR and rest take the engine defaults', () => {
    const sim = new MuscleSim(person(YOUNG), { overrides: DRAW });
    const g = [{ ...grp({ sets: 3, w: { chest: 1 } }), loadPct1RM: Number.NaN, rir: Number.NaN, restSec: Number.NaN }];
    runGrouped(sim, day(sim), g, all(g));
    const K = sim.k;
    expect(sim.s.vR[RI('chest')]).toBeCloseTo(3 * M.fRir(K, DEFAULTS.rtRir, DEFAULTS.rtLoadPct1RM) * M.fLoad(K, DEFAULTS.rtLoadPct1RM) * M.fRest(K, DEFAULTS.rtRestSec), 12);
  });
});

describe('D3-01 catalogue → engine parity', () => {
  const ex = (id: string): ExerciseRecord => {
    const e = SEED_CATALOGUE.exercise(id);
    if (!e) throw new Error(id);
    return e;
  };
  const CTX = { bodyMassKg: 80, vo2max: 40, heightM: 1.75 };
  const session = (): Array<{ id: string; perf: Parameters<typeof resolveDose>[1] }> => [
    { id: 'db_bench_press', perf: { exerciseId: 'db_bench_press', setCount: 3, pct1RM: 75, rir: 2, restSec: 90 } },
    { id: 'baithak', perf: { exerciseId: 'baithak', setCount: 3, pct1RM: 40, rir: 5, restSec: 45 } },
    { id: 'plank', perf: { exerciseId: 'plank', sets: [{ holdSec: 45 }, { holdSec: 60, nearFailure: true }, { holdSec: 45 }], restSec: 60 } },
    // D3-09: an RPE is proximity to failure only on the resistance RIR-RPE scale (RPE 8 → RIR 2)
    { id: 'kb_swing', perf: { exerciseId: 'kb_swing', setCount: 4, reps: 15, rpe: 8, rpeScale: 'rirRpe', restSec: 60 } },
    { id: 'pull_up', perf: { exerciseId: 'pull_up', sets: [{ reps: 8, rir: 1 }, { reps: 6, rir: 0 }, { reps: 8, rir: 1 }], restSec: 150 } },
    { id: 'goblet_squat', perf: { exerciseId: 'goblet_squat', setCount: 3, pct1RM: 30, rir: 3, restSec: 30 } },
  ];

  /** Engine dose of catalogue groups with constants K (NaN-free here: every group carries load/rest; holds have no RIR). */
  function engineDose(K: MuscleConstants, groups: readonly ResistanceSetGroup[]): Float64Array {
    const doses: M.SetGroupDose[] = groups.map((g) => ({
      sets: g.sets,
      regionWeights: (() => {
        const a = new Float64Array(N_REGIONS);
        for (const [r, v] of Object.entries(g.regionWeights) as Array<[TrainingRegion, number]>) a[RI(r)] = v;
        return a;
      })(),
      contraction: g.contraction,
      typeFactorIncluded: g.typeFactorIncluded === true,
      loadPct1RM: g.loadPct1RM ?? DEFAULTS.rtLoadPct1RM,
      rir: g.rir ?? 0,
      restSec: g.restSec ?? DEFAULTS.rtRestSec,
    }));
    return M.addGroupEffectiveSets(K, doses, new Float64Array(N_REGIONS));
  }

  /** Independent per-set expectation from the logs themselves (set-type factors from the catalogue parameters). */
  function expectedFromLogs(K: MuscleConstants): Float64Array {
    const out = new Float64Array(N_REGIONS);
    const addSet = (e: ExerciseRecord, factor: number, hold: boolean, rir: number, load: number, rest: number): void => {
      const f = factor * (hold ? 1 : M.fRir(K, rir, load) * M.fLoad(K, load)) * M.fRest(K, rest);
      for (const [r, w] of Object.entries(e.regions) as Array<[TrainingRegion, number]>) out[RI(r)] = out[RI(r)]! + w * f;
    };
    for (let i = 0; i < 3; i++) addSet(ex('db_bench_press'), 1, false, 2, 75, 90);
    for (let i = 0; i < 3; i++) addSet(ex('baithak'), 1, false, 5, 40, 45);
    const iso = catalogueParam('isometricNonFailureFactor');
    addSet(ex('plank'), iso, true, 0, 35, 60);
    addSet(ex('plank'), 1, true, 0, 35, 60);
    addSet(ex('plank'), iso, true, 0, 35, 60);
    const kb = ex('kb_swing');
    for (let i = 0; i < 4; i++) addSet(kb, kb.loadFactor?.mode ?? catalogueParam('ballisticSetFactor'), false, 2, loadPctFromRepsToFailure(15 + 2), 60);
    for (const [reps, rir] of [[8, 1], [6, 0], [8, 1]] as const) addSet(ex('pull_up'), 1, false, rir, loadPctFromRepsToFailure(reps + rir), 150);
    for (let i = 0; i < 3; i++) addSet(ex('goblet_squat'), 1, false, 3, 30, 30);
    return out;
  }

  it('nominal constants: engine groups reproduce the catalogue effective sets exactly (more than four mixed groups)', () => {
    const K = readMuscleConstants(buildModelParams(MODULES), true);
    const doses = session().map(({ id, perf }) => resolveDose(ex(id), perf, CTX));
    const dose = toEngineDose(doses, 17, { sessionId: 'log-1' });
    const eng = dose.resistance!;
    expect(eng.groups!.length).toBeGreaterThan(4);
    // the bout identity on every part (resistance first; kettlebell swings add a cardio part)
    expect([eng, ...dose.cardio].map((s) => s.sessionId)).toEqual(['log-1#0', ...dose.cardio.map((_, k) => `log-1#${k + 1}`)]);
    expect(dose.cardio.length).toBeGreaterThan(0);
    expect(eng.setsByRegionIncludesTypeFactor).toBe(true);
    const fromEngine = engineDose(K, eng.groups!);
    const cat = new Float64Array(N_REGIONS);
    for (const d of doses) for (const [r, v] of Object.entries(d.effectiveSetsByRegion) as Array<[TrainingRegion, number]>) cat[RI(r)] = cat[RI(r)]! + v;
    expectArrayClose(fromEngine, cat, 9, 'catalogue parity');
    expectArrayClose(fromEngine, expectedFromLogs(K), 9, 'independent');
  });

  it('non-nominal draws re-evaluate every group (contraction factor once); the merged legacy session does not', () => {
    const base = buildModelParams(MODULES);
    const v = new Float64Array(base.values);
    for (const [id, x] of Object.entries(DRAW)) v[base.index.get(id)!] = x;
    const K = readMuscleConstants(withOverrides(base, v), true);
    const doses = session().map(({ id, perf }) => resolveDose(ex(id), perf, CTX));
    const eng = toEngineDose(doses, 17).resistance!;
    const fromEngine = engineDose(K, eng.groups!);
    const want = expectedFromLogs(K);
    expectArrayClose(fromEngine, want, 9, 'drawn');
    // legacy merged input (setsByRegion with the session's mean RIR/load/rest) misses the per-group factors
    const legacy = new Float64Array(N_REGIONS);
    const f = M.fRir(K, eng.rir!, eng.loadPct1RM!) * M.fLoad(K, eng.loadPct1RM!) * M.fRest(K, eng.restSec!);
    for (const [r, s] of Object.entries(eng.setsByRegion!) as Array<[TrainingRegion, number]>) legacy[RI(r)] = s * f;
    let diff = 0;
    for (let r = 0; r < N_REGIONS; r++) diff += Math.abs(legacy[r]! - want[r]!);
    expect(diff).toBeGreaterThan(0.1);
  });

  it('energy is booked once per bout; groups tile the resistance minutes; splitting identical sets changes nothing', () => {
    const doses = session().map(({ id, perf }) => resolveDose(ex(id), perf, CTX));
    const eng = toEngineDose(doses, 17);
    const r = eng.resistance!;
    expect(eng.energy.grossKcal).toBeCloseTo(doses.reduce((a, d) => a + d.energy.grossKcal, 0), 9);
    expect(r.durationMin).toBeCloseTo(doses.reduce((a, d) => a + (d.sets > 0 ? d.resistanceMinutes : 0), 0), 9);
    let end = 0;
    for (const g of r.groups!) {
      expect(g.startOffsetMin!).toBeGreaterThanOrEqual(end - 1e-9);
      end = g.startOffsetMin! + g.durationMin!;
    }
    expect(end).toBeLessThanOrEqual(r.durationMin! + 1e-9);
    const one = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3, pct1RM: 75, rir: 2 }, CTX);
    const split = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', sets: [{ pct1RM: 75, rir: 2 }, { pct1RM: 75, rir: 2 }, { pct1RM: 75, rir: 2 }] }, CTX);
    expect(sessionSetGroups([one]).map((g) => g.sets)).toEqual([3]);
    expect(sessionSetGroups([split]).map((g) => g.sets)).toEqual([3]);
    expect(toEngineDose([split], 7).energy).toEqual(toEngineDose([one], 7).energy);
  });
});

describe('D2-01 muscle inputs: no planned fast metadata', () => {
  it('declares daily-native reads and output resolutions', () => {
    expect(MUSCLE_DAILY_NATIVE_READS).toContain('DayInput.proteinG');
    expect(MUSCLE_OUTPUT_RESOLUTION.mpsStimWb).toBe('eventPrefix');
    expect(MUSCLE_OUTPUT_RESOLUTION.mps).toBe('daily');
    expect(MUSCLE_OUTPUT_RESOLUTION.rtMuscleGain).toBe('daily');
  });

  it('the shared causal-resolution declaration matches the module’s own reads, writes and records', () => {
    const d = MUSCLE_CAUSAL_RESOLUTION;
    expect(d.module).toBe(muscleModule.id);
    expect(d.planMetadataReads).toEqual([]);
    expect([...d.dailyInputs]).not.toContain('fastPolicy');
    for (const sig of d.dayStartSignals) expect(muscleModule.reads).toContain(sig);
    for (const sig of [...d.signals, ...d.eventPrefixSignals]) expect(muscleModule.writes).toContain(sig);
    // every output is declared exactly once: written signals and recorded series
    expect(new Set([...d.signals, ...d.eventPrefixSignals])).toEqual(new Set(muscleModule.writes));
    expect(new Set(d.series)).toEqual(new Set(muscleModule.records));
    expect(MUSCLE_DAILY_NATIVE_READS).toEqual(d.dailyInputs.map((k) => `DayInput.${k}`));
    for (const id of [...d.series, ...d.signals]) expect(MUSCLE_OUTPUT_RESOLUTION[id]).toBe('daily');
  });

  it('identical realised day inputs with planned fast labels none/23/24/48 h give a bit-identical muscle state', () => {
    const digest = (sim: MuscleSim): string =>
      JSON.stringify(Object.entries(sim.s as unknown as Record<string, unknown>).map(([k, v]) => [k, v instanceof Float64Array ? Array.from(v) : v])) +
      JSON.stringify(Array.from(sim.out)) +
      JSON.stringify(Array.from(sim.stimHours));
    const out: string[] = [];
    for (const label of [null, 23, 24, 48]) {
      const sim = new MuscleSim(person({ ...YOUNG, trainingHistory: '1to3y' }));
      const week = compileWeek(sim.profile, [program('A', { sessions: [{ startH: 17, sets: 4 }] }), program('B')], [0, 1, 0]);
      for (const d of week) {
        if (label !== null) d.fastPolicy = { plannedDurationH: label, startDay: 0, source: 'planned' };
        sim.runDay(d, (_h, hour) => {
          hour.plannedFast = label === null ? 0 : 1;
        });
      }
      out.push(digest(sim));
    }
    for (const o of out.slice(1)) expect(o).toBe(out[0]);
  });
});
