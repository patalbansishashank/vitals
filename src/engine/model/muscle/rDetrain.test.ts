// @vitest-environment node
/**
 * Ruling R-DETRAIN (docs/QA_FINDINGS.md, release check 2026-10-01; MODEL_SPEC §1.9) through the real 16-module engine.
 *
 * QA reproduction: a habitual lifter (man, 34 y, 178 cm, 88 kg, 1-3 training years, 3 RT sessions/wk) whose schedule paints
 * no lifts at 100 % lost 3.9 kg lean and gained 0.6 kg fat in 8 weeks (09 §4.10 detraining of ALL of M_acc,0 = TS₀·G_pot =
 * 11.6 kg towards zero). Now detraining decays (no loss for ~3 weeks after the last session, then τ_d = 70 d) towards a
 * retained floor: the set-point (the untrained, FFMI-derived lean) is never detrained, and `detrainFloorFrac` (0.5) of the
 * long-term trained gains is kept. Also: 09 #12 re-expressed against the floor, continuing lifters stay flat, novices gain
 * at the dossier's rate, retraining after detraining gets the memory boost, and the QA's very-low-carbohydrate →
 * high-carbohydrate switch (Task 4 of the blocker round) is the same detraining effect, not a partition problem.
 */
import { compileSchedule, habitualWeekPrograms } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import { trainingFfmiOffset } from '../../body/estimateBody';
import type { DayTemplate, MacroSpec, PersonProfile, ResolvedProfile, Schedule } from '../../types';
import { readMuscleConstants } from './constants';
import { trainedGainsAtStart, trainingStatus0 } from './index';

vi.setConfig({ testTimeout: 120_000 });

const START = '2026-10-05'; // a Monday: the last habitual session (Mon/Wed/Fri) is on day −3
const QA_LIFTER = (years?: number, mix = 0): PersonProfile => ({
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88, ...(years !== undefined ? { trainingYears: years } : {}) },
  habits: { sessionsPerWeek: 3, trainingHistory: '1to3y', lifingCardioMix: mix },
  startDate: START,
});
const MACROS: MacroSpec = { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } };
const pct = (id: string, p: number, macros: MacroSpec = MACROS, extra: Partial<DayTemplate> = {}): DayTemplate => ({
  id,
  label: id,
  energy: { kind: 'pctMaintenance', pct: p },
  macros,
  ...extra,
});
function schedule(days: number, programs: DayTemplate[], use: (d: number) => number): Schedule {
  return { schemaVersion: 1, startDate: START, horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: use(d) })) };
}
const K = readMuscleConstants(buildModelParams(MODULES), false, { emit: () => undefined });
function kMemOverride(v: number): Float64Array {
  const base = buildModelParams(MODULES);
  const out = new Float64Array(base.values);
  out[base.index.get('muscle.kMem')!] = v;
  return out;
}
function run(rp: ResolvedProfile, s: Schedule, paramOverrides?: Float64Array) {
  return runEngine(rp, compileSchedule(s, rp), { record: 'daily', ...(paramOverrides ? { paramOverrides } : {}) }).daily;
}
const at = (a: Float32Array | undefined, d: number): number => a![d]! - a![0]!;
/** Losable trained gains of a habitual lifter = (1 − φ)·min(M_acc,0, h²·max(FFMI − FFMI_untr, ΔFFMI_train(Y_eff))), kg. */
function losable(rp: ResolvedProfile): number {
  const ts = trainingStatus0(K, rp);
  const tr = rp.body.training;
  const gTr = Math.min(ts.ts0 * ts.dFfmiPot * rp.heightM ** 2, rp.heightM ** 2 * Math.max(tr.ffmi - tr.ffmiUntrainedRef, trainingFfmiOffset('male', ts.yearsEff ?? 0)));
  expect(trainedGainsAtStart(K, rp).losableKg).toBeCloseTo((1 - K.detrainFloorFrac) * gTr, 9);
  return (1 - K.detrainFloorFrac) * gTr;
}

describe('QA reproduction: habitual lifter, no lifts painted, 100 % for 8 and 20 weeks', () => {
  // app form (training years entered, the history bucket derived from them), the bucket alone, and the default
  // lifting/cardio mix (2 RT + 1 cardio)
  const variants: [string, PersonProfile][] = [
    ['2 training years entered', QA_LIFTER(2)],
    ["history bucket '1-3 y' only", QA_LIFTER()],
    ['2 years, lifting/cardio mix 0.5', QA_LIFTER(2, 0.5)],
  ];
  for (const [label, p] of variants) {
    it(`${label}: lean loss ≤ 1.2 kg at 8 weeks (was 3.9), ≤ the floor-bounded value at 20 weeks, none in the first ~3 weeks`, () => {
      const rp = resolveProfile(p);
      const d = run(rp, schedule(140, [pct('none', 100)], () => 0));
      const bound = losable(rp);
      expect(bound).toBeGreaterThan(2); // there is something to lose (not a vacuous floor)
      expect(bound).toBeLessThan(3.5);
      // no measurable loss for 2-3 weeks after the last session (day −3)
      expect(at(d.rtMuscleGain, 17)).toBeGreaterThan(-0.005);
      // 8 weeks: lean mass (DXA-equivalent) and lean tissue within 1.2 kg; fat gain only what the lean energy releases
      expect(at(d.leanMass, 55)).toBeGreaterThanOrEqual(-1.25); // incl. glycogen water (≈ −0.17 kg): model −1.17
      expect(at(d.leanTissue, 55)).toBeGreaterThanOrEqual(-1.2); // model −1.00 (QA before: −3.8)
      expect(at(d.fatMass, 55)).toBeLessThan(0.3);
      // 20 weeks: the training-attributable loss never exceeds (1 − φ) of the trained gains; lean tissue follows it
      expect(-at(d.rtMuscleGain, 139)).toBeLessThanOrEqual(bound + 1e-4);
      expect(-at(d.leanTissue, 139)).toBeLessThanOrEqual(bound + 0.15);
      // 09 #12 re-expressed against the floor: 82 % ± 10 of the LOSABLE gains lost after 20 weeks off
      expect(Math.abs(-at(d.rtMuscleGain, 139) / bound - 0.82)).toBeLessThanOrEqual(0.1);
    });
  }
});

describe('continuing, starting and resuming training', () => {
  it('habitual lifter continuing the habitual programme at 100 % stays flat for 12 weeks', () => {
    const rp = resolveProfile(QA_LIFTER(2));
    const programs = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 100 } }));
    const d = run(rp, schedule(84, programs, (i) => i % 7));
    expect(Math.abs(at(d.rtMuscleGain, 83))).toBeLessThan(0.01);
    expect(Math.abs(at(d.leanTissue, 83))).toBeLessThan(0.15);
    expect(Math.abs(at(d.fatMass, 83))).toBeLessThan(0.15);
  });

  it('a novice starting 3 × moderate RT at 100 % gains at the dossier rate (09 #1 Benito untrained +1.54 ± 0.4 kg in 10.4 wk)', () => {
    const rp = resolveProfile({ schemaVersion: 1, body: { sex: 'male', ageYears: 25, heightCm: 178, weightKg: 75 }, habits: { sessionsPerWeek: 0 }, startDate: START });
    const rt = pct('rt', 100, { ...MACROS, protein: { unit: 'gPerKgBw', value: 1.4 } }, { exercise: [{ kind: 'resistance', startH: 17, volume: 'moderate' }] });
    const rest = pct('rest', 100, { ...MACROS, protein: { unit: 'gPerKgBw', value: 1.4 } });
    const d = run(rp, schedule(73, [rt, rest], (i) => ([0, 2, 4].includes(i % 7) ? 0 : 1)));
    expect(Math.abs(at(d.rtMuscleGain, 72) - 1.54)).toBeLessThanOrEqual(0.4);
  });

  it('R-REGAIN: 12 weeks off, then the habitual programme: ≥ 60 % of the loss back within 16 weeks (09 §4.10 pace, κ_mem 1.3)', () => {
    const rp = resolveProfile(QA_LIFTER(2));
    const hab = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 100 } }));
    const programs = [...hab, pct('none', 100)];
    const s = schedule(84 + 182, programs, (i) => (i < 84 ? 7 : i % 7));
    const regain = (kMem?: number): { lost: number; w16: number; w26: number } => {
      const d = run(rp, s, kMem === undefined ? undefined : kMemOverride(kMem));
      const lost = -at(d.rtMuscleGain, 83);
      return { lost, w16: (at(d.rtMuscleGain, 83 + 112) + lost) / lost, w26: (at(d.rtMuscleGain, 83 + 182) + lost) / lost };
    };
    const def = regain();
    const noBoost = regain(1.0);
    expect(def.lost).toBeGreaterThan(1);
    expect(def.w16).toBeGreaterThanOrEqual(0.6);
    expect(def.w16).toBeGreaterThan(noBoost.w16); // faster than the first-time pace
    expect(def.w26).toBeGreaterThan(0.97);
    expect(def.w26).toBeLessThan(1.02); // back to the habitual equilibrium, not beyond
  });
});

describe('Task 4: very-low-carbohydrate (4 wk, 85 %) → high-carbohydrate (4 wk, 90 %), 88-kg man with 3 lifts/wk', () => {
  const VLC = pct('vlc', 85, { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'g', value: 25 }, fat: { unit: 'remainder' }, fibre: { unit: 'g', value: 15 } }, { meals: { count: 2 }, hydration: { sodiumG: 4 } });
  const HC = pct('hc', 90, { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'remainder' }, fat: { unit: 'pctEnergy', value: 20 } }, { meals: { count: 3 } });
  const RT = { kind: 'resistance' as const, startH: 18, durationMin: 60, volume: 'moderate' as const };
  const programs = [VLC, HC, { ...VLC, id: 'vlcRt', exercise: [RT] }, { ...HC, id: 'hcRt', exercise: [RT] }];
  const use = (lifts: boolean) => (d: number) => (d >= 28 ? 1 : 0) + (lifts && [0, 2, 4].includes(d % 7) ? 2 : 0);
  const rp = resolveProfile(QA_LIFTER(2));

  it('lifts painted: the deficit comes off fat; lean tissue is kept in both phases (no partition problem in the VLC phase)', () => {
    const d = run(rp, schedule(56, programs, use(true)));
    expect(Math.abs(at(d.leanTissue, 27))).toBeLessThan(0.2); // VLC phase: lean mass drops by glycogen water only
    expect(Math.abs(at(d.leanTissue, 55))).toBeLessThan(0.3);
    expect(at(d.fatMass, 55)).toBeLessThan(-1.5);
    expect(at(d.leanMass, 27) - at(d.leanTissue, 27)).toBeLessThan(-1); // the VLC lean-mass dip is glycogen + water
  });

  it('no lifts painted (the QA run: fat −0.8, lean −4.3 kg): detraining bounded by the floor, lean loss < fat loss', () => {
    const d = run(rp, schedule(56, programs, use(false)));
    expect(-at(d.rtMuscleGain, 55)).toBeLessThanOrEqual(losable(rp));
    expect(at(d.leanTissue, 55)).toBeGreaterThan(-1.6);
    expect(at(d.leanTissue, 55)).toBeGreaterThan(at(d.fatMass, 55));
  });
});
