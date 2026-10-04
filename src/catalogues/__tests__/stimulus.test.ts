/** Stimulus mapping: engine consistency, R3 worked numbers, energy equations, hybrid compile, properties. */
import { describe, expect, it } from 'vitest';
import { buildModelParams } from '@/engine/core/paramsRegistry';
import { MODULES } from '@/engine/core/moduleRegistry';
import { readMuscleConstants } from '@/engine/model/muscle/constants';
import * as M from '@/engine/model/muscle/equations';
import { MUSCLE_PARAMS } from '@/engine/model/muscle/params';
import {
  aggregateStimulus,
  ENGINE_CONSTANTS,
  fLoad,
  fLoadStrength,
  fRest,
  fRir,
  loadPctFromRepsToFailure,
  repsToFailureAt,
  resolveDose,
  resolveSession,
  stimulusTermsOf,
  toEngineDose,
  vectorOf,
  weeklyDose,
  type ExerciseRecord,
} from '@/catalogues';
import { SEED_CATALOGUE as C, SEED_EXERCISES } from '@/content/catalogues';
import { CTX, lcg } from './helpers';

const ex = (id: string): ExerciseRecord => {
  const e = C.exercise(id);
  if (!e) throw new Error(id);
  return e;
};

describe('engine consistency', () => {
  it('reads its constants from the muscle registry', () => {
    const v = (id: string): number => MUSCLE_PARAMS.find((p) => p.id === id)!.value;
    expect(ENGINE_CONSTANTS.kRir).toBe(v('muscle.kRir'));
    expect(ENGINE_CONSTANTS.fLoad20).toBe(v('muscle.fLoad20'));
    expect(ENGINE_CONSTANTS.wIndirect).toBe(0.5);
  });

  it('f_RIR, f_load, f_rest and f_loadS equal the muscle module equations on a grid', () => {
    const K = readMuscleConstants(buildModelParams(MODULES), true);
    for (let L = 5; L <= 100; L += 2.5) {
      for (let rir = 0; rir <= 8; rir++) expect(fRir(rir, L)).toBeCloseTo(M.fRir(K, rir, L), 12);
      expect(fLoad(L)).toBeCloseTo(M.fLoad(K, L), 12);
      expect(fLoadStrength(L)).toBeCloseTo(M.fLoadStrength(K, L), 12);
    }
    for (const rest of [0, 30, 60, 61, 89, 90, 120, 300]) expect(fRest(rest)).toBeCloseTo(M.fRest(K, rest), 12);
  });

  it('the engine input (setsByRegion) reproduces the stimulus when the engine applies its own factors', () => {
    const K = readMuscleConstants(buildModelParams(MODULES), true);
    for (const id of ['db_bench_press', 'baithak', 'mudgar_two_hand', 'pull_up', 'goblet_squat', 'plank', 'wall_sit', 'surya_namaskar']) {
      const d = resolveDose(ex(id), { exerciseId: id }, CTX);
      const eng = toEngineDose([d], 18).resistance!;
      for (const [r, sets] of Object.entries(eng.setsByRegion!)) {
        const fromEngine = sets * M.fRir(K, eng.rir!, eng.loadPct1RM!) * M.fLoad(K, eng.loadPct1RM!) * M.fRest(K, eng.restSec!);
        expect(fromEngine, `${id}.${r}`).toBeCloseTo((d.effectiveSetsByRegion as Record<string, number>)[r]!, 9);
      }
    }
  });
});

describe('load from reps (R3 §3.2)', () => {
  it('L_eq = 100/(1 + R_f/30): 10 → 75 %, 20 → 60 %, 30 → 50 %, 56 → 35 %', () => {
    expect(loadPctFromRepsToFailure(10)).toBeCloseTo(75, 9);
    expect(loadPctFromRepsToFailure(20)).toBeCloseTo(60, 9);
    expect(loadPctFromRepsToFailure(30)).toBeCloseTo(50, 9);
    expect(loadPctFromRepsToFailure(56)).toBeCloseTo(34.9, 1);
    for (const r of [3, 8, 12, 25]) expect(repsToFailureAt(loadPctFromRepsToFailure(r))).toBeCloseTo(r, 9);
  });
});

describe('R3 §5.4 worked effective sets (80 kg)', () => {
  it('3 × 10 DB bench at RIR 2 → chest 2.65', () => {
    const d = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3, reps: 10, rir: 2 }, CTX);
    expect(d.meanLoadPct).toBeCloseTo(71.4, 1);
    expect(d.effectiveSetsByRegion.chest).toBeCloseTo(2.646, 3);
  });
  it('3 × 25 dand at RIR 2 → chest 2.55 with 2.55 shoulders as spill', () => {
    const d = resolveDose(ex('dand'), { exerciseId: 'dand', setCount: 3, reps: 25, rir: 2 }, CTX);
    expect(d.meanLoadPct).toBeCloseTo(52.6, 1);
    expect(d.effectiveSetsByRegion.chest).toBeCloseTo(2.55, 2);
    expect(d.effectiveSetsByRegion.shoulders).toBeCloseTo(2.55, 2);
  });
  it('3 × 50 baithak at RIR 5 → quads 1.88; 3 × 8 back squat at 75 % → quads 2.65', () => {
    const b = resolveDose(ex('baithak'), { exerciseId: 'baithak', setCount: 3, reps: 50, rir: 5 }, CTX);
    expect(b.meanLoadPct).toBeCloseTo(35.3, 1);
    expect(b.effectiveSetsByRegion.quads).toBeCloseTo(1.875, 3);
    const s = resolveDose(ex('bb_back_squat'), { exerciseId: 'bb_back_squat', setCount: 3, reps: 8, pct1RM: 75 }, CTX);
    expect(s.effectiveSetsByRegion.quads).toBeCloseTo(2.646, 3);
    expect(s.effectiveSetsByRegion.hamstrings).toBeUndefined();
  });
  it('20 min treadmill run at 9.3 MET: net 232 kcal, x 0.81, MEM 30; 20 min mudgar: 182 kcal, MEM 10', () => {
    const run = resolveDose(ex('treadmill_run'), { exerciseId: 'treadmill_run', minutes: 20 }, CTX);
    expect(run.energy.netKcal).toBeCloseTo(232.4, 1);
    expect(run.cardio!.x).toBeCloseTo(0.81, 2);
    expect(run.cardio!.mem).toBeCloseTo(30, 6);
    const mud = resolveDose(ex('mudgar_two_hand'), { exerciseId: 'mudgar_two_hand', minutes: 20 }, CTX);
    expect(mud.energy.netKcal).toBeCloseTo(182, 6);
    expect(mud.cardio!.minutes).toBeCloseTo(10, 9);
    expect(mud.cardio!.mem).toBeCloseTo(10, 6);
  });
});

describe('hybrid and ballistic compile (R3 §3.3)', () => {
  it('mudgar 20 min books MET × total minutes once, split 10 cardio / 10 resistance', () => {
    const d = resolveDose(ex('mudgar_two_hand'), { exerciseId: 'mudgar_two_hand', minutes: 20 }, CTX);
    const eng = toEngineDose([d], 7);
    expect(eng.cardio).toHaveLength(1);
    expect(eng.cardio[0]).toMatchObject({ kind: 'cardio', modality: 'other', durationMin: 10, met: 7.5 });
    expect(eng.resistance!.durationMin).toBeCloseTo(10, 9);
    expect(eng.resistanceMet).toBe(7.5);
    // the engine books the resistance part at the item's own MET (ResistanceSession.met), not the style's 6.0
    expect(eng.resistance!.met).toBe(7.5);
    expect(eng.energy.grossKcal).toBeCloseTo(7.5 * 1.4 * 20, 9);
    expect(eng.cardio[0]!.startH).toBeCloseTo(7 + 10 / 60, 9);
  });
  it('stretching and mobility flows add energy only (light "other" activity at their own MET), no RT dose', () => {
    const d = resolveDose(ex('hatha_yoga'), { exerciseId: 'hatha_yoga' }, CTX);
    const eng = toEngineDose([d], 6);
    expect(eng.resistance).toBeNull();
    expect(eng.cardio).toEqual([{ kind: 'cardio', modality: 'other', startH: 6, durationMin: 45, met: 2.3 }]);
  });
  it('ballistic bouts count 0.5 per set; bouts below RPE 7 or under 20 s do not count', () => {
    const k = ex('kb_swing');
    expect(resolveDose(k, { exerciseId: 'kb_swing' }, CTX).creditedSets).toBeCloseTo(5, 9);
    expect(resolveDose(k, { exerciseId: 'kb_swing', rpe: 5 }, CTX).sets).toBe(0);
    expect(resolveDose(k, { exerciseId: 'kb_swing', workSec: 15 }, CTX).sets).toBe(0);
  });
  it('isometric holds count half a set unless held near failure', () => {
    const p = ex('plank');
    const half = resolveDose(p, { exerciseId: 'plank', sets: [{ holdSec: 45 }] }, CTX);
    const full = resolveDose(p, { exerciseId: 'plank', sets: [{ holdSec: 60, nearFailure: true }] }, CTX);
    expect(full.effectiveSetsByRegion.core! / half.effectiveSetsByRegion.core!).toBeCloseTo(2, 9);
  });
  it('round-based flows count hard sets by resistance time (12 Surya Namaskar rounds ≈ 1 set per region)', () => {
    const d = resolveDose(ex('surya_namaskar'), { exerciseId: 'surya_namaskar' }, CTX);
    expect(d.minutes).toBeCloseTo(6, 9);
    expect(d.sets).toBeCloseTo((0.4 * 6) / 2.5, 9);
    expect(d.mobilityMinutes.hamstring).toBeCloseTo(6 / 4, 9);
  });
  it('minute-only resistance items (mallakhamb) count one set per 2.5 resistance minutes', () => {
    const d = resolveDose(ex('mallakhamb_pole'), { exerciseId: 'mallakhamb_pole', minutes: 25 }, CTX);
    expect(d.sets).toBeCloseTo((0.7 * 25) / 2.5, 9);
    expect(d.effectiveSetsByRegion.upperBack).toBeGreaterThan(4);
  });
  it('a log of minutes scales the default set count', () => {
    const d = resolveDose(ex('mudgar_two_hand'), { exerciseId: 'mudgar_two_hand', minutes: 22 }, CTX);
    expect(d.sets).toBeCloseTo(12, 9);
  });
});

describe('energy equations (R3 §4)', () => {
  it('ACSM run at 10 km/h: VO2 = 3.5 + 0.9·0.2·S → 9.57 MET, band from the B-grade floor', () => {
    const d = resolveDose(ex('treadmill_run'), { exerciseId: 'treadmill_run', minutes: 30, speedKmh: 10 }, CTX);
    expect(d.energy.method).toBe('acsmRun');
    expect(d.energy.met).toBeCloseTo((3.5 + 0.9 * 0.2 * (10000 / 60)) / 3.5, 9);
    const rel = (d.energy.netHigh - d.energy.netKcal) / d.energy.netKcal;
    expect(rel).toBeCloseTo(1.2816 * 0.1, 9);
  });
  it('Ludlow walk with height, ACSM grade term, stepping, cycling by watts and Pandolf load carriage', () => {
    const walk = resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, speedKmh: 5 }, CTX);
    const v = 5 / 3.6;
    expect(walk.energy.met).toBeCloseTo((3.5 + 3.85 + (5.97 * v * v) / 1.75) / 3.5, 9);
    const incline = resolveDose(ex('treadmill_incline_walk'), { exerciseId: 'treadmill_incline_walk', minutes: 30, speedKmh: 5, gradePct: 8 }, CTX);
    expect(incline.energy.met - walk.energy.met).toBeCloseTo((1.8 * (5000 / 60) * 0.08) / 3.5, 9);
    const stairs = resolveDose(ex('stair_climb'), { exerciseId: 'stair_climb', minutes: 10, stepRatePerMin: 30 }, CTX);
    expect(stairs.energy.met).toBeCloseTo((0.2 * 30 + 1.33 * 1.8 * 0.17 * 30 + 3.5) / 3.5, 9);
    const bike = resolveDose(ex('stationary_bike'), { exerciseId: 'stationary_bike', minutes: 30, powerW: 150 }, CTX);
    expect(bike.energy.grossKcal / 30).toBeCloseTo(2.4 * 1.4 + (150 * 60) / (0.26 * 4184), 9);
    const ruck = resolveDose(ex('rucking'), { exerciseId: 'rucking', minutes: 60, speedKmh: 5.04, loadCarriedKg: 15 }, CTX);
    const watts = 1.5 * 80 + 2 * 95 * (15 / 80) ** 2 + 95 * (1.5 * 1.4 * 1.4);
    expect(ruck.energy.grossKcal / 60).toBeCloseTo((watts * 60) / 4184, 9);
  });
  it('falls back to the catalogue MET when an equation lacks its inputs', () => {
    const d = resolveDose(ex('treadmill_run'), { exerciseId: 'treadmill_run', minutes: 10 }, CTX);
    expect(d.energy.method).toBe('met');
    expect(d.energy.met).toBe(9.3);
  });
});

describe('properties', () => {
  const rand = lcg(42);
  const rt = SEED_EXERCISES.filter((e) => (e.defaultDose.sets ?? 0) > 0 && e.defaultDose.reps !== undefined && e.loadType !== 'mobility');

  it('more sets never lower, and fewer reps in reserve never lower, the stimulus', () => {
    for (let i = 0; i < 60; i++) {
      const e = rt[Math.floor(rand() * rt.length)]!;
      const n = 1 + Math.floor(rand() * 4);
      const rir = Math.floor(rand() * 5);
      const base = resolveDose(e, { exerciseId: e.id, setCount: n, rir }, CTX);
      const more = resolveDose(e, { exerciseId: e.id, setCount: n + 1, rir }, CTX);
      const harder = resolveDose(e, { exerciseId: e.id, setCount: n, rir: Math.max(0, rir - 1) }, CTX);
      for (const r of Object.keys(e.regions)) {
        const b = (base.effectiveSetsByRegion as Record<string, number>)[r] ?? 0;
        expect((more.effectiveSetsByRegion as Record<string, number>)[r] ?? 0, `${e.id} sets`).toBeGreaterThanOrEqual(b - 1e-12);
        // harder sets: same reps at lower RIR means a heavier load; the stimulus never drops below 35 %1RM's plateau
        expect((harder.effectiveSetsByRegion as Record<string, number>)[r] ?? 0, `${e.id} rir`).toBeGreaterThanOrEqual(b - 1e-9);
      }
      expect(more.minutes).toBeGreaterThan(base.minutes);
    }
  });

  it('aggregation is additive in regions, energy and MEM', () => {
    const ids = ['db_bench_press', 'brisk_walk', 'mudgar_two_hand', 'hamstring_stretch'];
    const s = resolveSession(ids.map((exerciseId) => ({ exerciseId })), C, CTX);
    const v = aggregateStimulus(s.doses);
    expect(v.netKcal).toBeCloseTo(s.doses.reduce((a, d) => a + d.energy.netKcal, 0), 9);
    expect(v.mem).toBeCloseTo(s.doses.reduce((a, d) => a + (d.cardio?.mem ?? 0), 0), 9);
    expect(v.effectiveSetsByRegion.shoulders).toBeCloseTo(s.doses.reduce((a, d) => a + (d.effectiveSetsByRegion.shoulders ?? 0), 0), 9);
    expect(v.mobilityMinutes.hamstring).toBeGreaterThan(0);
    expect(s.unresolved).toEqual([]);
    expect(resolveSession([{ exerciseId: 'not_in_catalogue' }], C, CTX).unresolved).toHaveLength(1);
  });

  it('static stimulus terms exist for every exercise', () => {
    for (const e of SEED_EXERCISES) {
      const t = stimulusTermsOf(e);
      expect(t.pattern).toBe(e.pattern);
      expect(t.defaultMinutes, e.id).toBeGreaterThan(0);
      if (e.hybridCardioShare > 0) expect(t.cardio?.share).toBe(e.hybridCardioShare);
    }
  });
});

describe('weekly dose vs presets and minimum effective doses (R3 §3.4)', () => {
  it('three full-body sessions reach the moderate preset; walking 5 × 30 min brisk meets 150 MEM only at x ≥ 0.55', () => {
    const session = vectorOf(
      [
        { exerciseId: 'goblet_squat', setCount: 5, rir: 1 },
        { exerciseId: 'db_bench_press', setCount: 5, rir: 1 },
        { exerciseId: 'db_row', setCount: 5, rir: 1 },
      ],
      C,
      CTX,
    );
    const w = weeklyDose([session, session, session]);
    expect(w.setsByRegion.quads!).toBeGreaterThanOrEqual(11);
    expect(w.preset).toBe('moderate');
    const walk = vectorOf([{ exerciseId: 'brisk_walk', minutes: 30 }], C, CTX);
    const ww = weeklyDose([walk, walk, walk, walk, walk]);
    expect(ww.memMet).toBe(walk.mem * 5 >= 150);
    expect(ww.vo2MaintenanceMet).toBe(false);
    expect(weeklyDose([vectorOf([{ exerciseId: 'push_up', setCount: 1 }], C, CTX)]).belowMinimum).toContain('chest');
  });
});
