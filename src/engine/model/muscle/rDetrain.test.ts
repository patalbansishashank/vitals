// @vitest-environment node
/**
 * Detraining through the real 16-module engine: ruling R-DETRAIN's QA reproduction, re-expressed under D3-06 (2026-10-18).
 *
 * QA reproduction: a habitual lifter (man, 34 y, 178 cm, 88 kg, 1-3 training years, 3 RT sessions/wk) whose schedule paints
 * no lifts at 100 % lost 3.9 kg lean and gained 0.6 kg fat in 8 weeks (09 §4.10 detraining of ALL of M_acc,0 = TS₀·G_pot =
 * 11.6 kg towards zero). The untrained, FFMI-derived set-point is never detrained (only the trained gains the body carries
 * above it are losable), detraining keeps 09's kinetics (no loss for ~3 weeks after the last session, then τ_d = 70 d) as
 * an uncertain legacy scenario, and — D3-06 — there is no guaranteed permanent trained-gain floor: `detrainFloorFrac` is 0
 * centrally (0.5 = the legacy research scenario, history-based), and the ×1.3 retraining memory is a named scenario with
 * the neutral 1 central. One history yields one detraining path: day-stamped snapshots continue it bit-identically across
 * a restart, a replan and a longer horizon, and the start date alone changes nothing.
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
function paramOverride(over: Record<string, number>): Float64Array {
  const base = buildModelParams(MODULES);
  const out = new Float64Array(base.values);
  for (const [id, v] of Object.entries(over)) out[base.index.get(id)!] = v;
  return out;
}
const kMemOverride = (v: number): Float64Array => paramOverride({ 'muscle.kMem': v });
function run(rp: ResolvedProfile, s: Schedule, paramOverrides?: Float64Array) {
  return runEngine(rp, compileSchedule(s, rp), { record: 'daily', ...(paramOverrides ? { paramOverrides } : {}) }).daily;
}
const at = (a: Float32Array | undefined, d: number): number => a![d]! - a![0]!;
/** Losable trained gains of a habitual lifter = (1 − φ)·min(M_acc,0, h²·max(FFMI − FFMI_untr, ΔFFMI_train(Y_eff))), kg (φ = 0 centrally). */
function losable(rp: ResolvedProfile): number {
  const ts = trainingStatus0(K, rp);
  const tr = rp.body.training;
  const gTr = Math.min(ts.ts0 * ts.dFfmiPot * rp.heightM ** 2, rp.heightM ** 2 * Math.max(tr.ffmi - tr.ffmiUntrainedRef, trainingFfmiOffset('male', ts.yearsEff ?? 0)));
  expect(K.detrainFloorFrac).toBe(0); // D3-06: no guaranteed permanent trained-gain floor
  expect(trainedGainsAtStart(K, rp).losableKg).toBeCloseTo((1 - K.detrainFloorFrac) * gTr, 9);
  return (1 - K.detrainFloorFrac) * gTr;
}

describe('QA reproduction: habitual lifter, no lifts painted, 100 % for 8 and 20 weeks (D3-06: no permanent floor)', () => {
  // app form (training years entered, the history bucket derived from them), the bucket alone, and the default
  // lifting/cardio mix (2 RT + 1 cardio)
  const variants: [string, PersonProfile][] = [
    ['2 training years entered', QA_LIFTER(2)],
    ["history bucket '1-3 y' only", QA_LIFTER()],
    ['2 years, lifting/cardio mix 0.5', QA_LIFTER(2, 0.5)],
  ];
  for (const [label, p] of variants) {
    it(`${label}: only trained gains are losable, none in the first ~3 weeks, 09 kinetics after (82 % ± 10 at 20 weeks)`, () => {
      const rp = resolveProfile(p);
      const d = run(rp, schedule(140, [pct('none', 100)], () => 0));
      const bound = losable(rp);
      expect(bound).toBeGreaterThan(2); // there is something to lose (not a vacuous floor)
      expect(bound).toBeLessThan(7); // never all of M_acc,0 (11.6 kg): the set-point is protected
      // no measurable loss for 2-3 weeks after the last session (day −3)
      expect(at(d.rtMuscleGain, 17)).toBeGreaterThan(-0.005);
      // 8 weeks: the legacy kinetics remove 25-45 % of the trained gains (model 36 %); lean tissue follows, fat barely moves
      const f8 = -at(d.rtMuscleGain, 55) / bound;
      expect(f8).toBeGreaterThan(0.25);
      expect(f8).toBeLessThan(0.45);
      expect(-at(d.leanTissue, 55)).toBeLessThanOrEqual(0.45 * bound + 0.15);
      expect(at(d.fatMass, 55)).toBeLessThan(0.3);
      // 20 weeks: never more than the trained gains; 09 #12: 82 % ± 10 of them lost after 20 weeks off
      expect(-at(d.rtMuscleGain, 139)).toBeLessThanOrEqual(bound + 1e-4);
      expect(-at(d.leanTissue, 139)).toBeLessThanOrEqual(bound + 0.15);
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

  it('regain after 12 weeks off: the neutral memory (1, central) and the ×1.3 scenario both return to the habitual equilibrium; the scenario is faster', () => {
    const rp = resolveProfile(QA_LIFTER(2));
    const hab = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 100 } }));
    const programs = [...hab, pct('none', 100)];
    const s = schedule(84 + 364, programs, (i) => (i < 84 ? 7 : i % 7));
    const regain = (kMem?: number): { lost: number; w16: number; w52: number; above: number; d: ReturnType<typeof run> } => {
      const d = run(rp, s, kMem === undefined ? undefined : kMemOverride(kMem));
      const lost = -at(d.rtMuscleGain, 83);
      let above = 0;
      for (let i = 0; i < d.rtMuscleGain!.length; i++) above = Math.max(above, at(d.rtMuscleGain, i));
      return { lost, w16: (at(d.rtMuscleGain, 83 + 112) + lost) / lost, w52: (at(d.rtMuscleGain, 83 + 364) + lost) / lost, above, d };
    };
    const def = regain();
    const neutral = regain(1.0);
    const memory = regain(1.3);
    expect(K.kMem).toBe(1); // D3-06: neutral central memory
    expect(def.lost).toBeGreaterThan(1);
    // the default run IS the neutral scenario
    expect(Array.from(def.d.rtMuscleGain!)).toEqual(Array.from(neutral.d.rtMuscleGain!));
    // memory changes regrowth propensity only: the detraining phase is identical (no retained kg from memory)
    for (let i = 0; i <= 83; i++) expect(at(memory.d.rtMuscleGain, i)).toBeCloseTo(at(def.d.rtMuscleGain, i), 9);
    expect(memory.w16).toBeGreaterThan(def.w16);
    // both regain fully within a year and never exceed the habitual equilibrium (the peak)
    expect(def.w52).toBeGreaterThan(0.97);
    expect(memory.w52).toBeGreaterThan(0.97);
    expect(def.above).toBeLessThan(0.01);
    expect(memory.above).toBeLessThan(0.01);
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

  it('no lifts painted (the QA run: fat −0.8, lean −4.3 kg): only trained gains detrain, at the legacy kinetics (scenario)', () => {
    const d = run(rp, schedule(56, programs, use(false)));
    const bound = losable(rp);
    expect(-at(d.rtMuscleGain, 55)).toBeLessThanOrEqual(0.45 * bound);
    // lean tissue: the detrained gains plus at most a small deficit share (never the QA's 4.3 kg)
    expect(at(d.leanTissue, 55)).toBeGreaterThan(-(0.45 * bound + 0.5));
    expect(at(d.fatMass, 55)).toBeLessThan(-0.5); // the deficit still comes off fat
  });
});

describe('D3-06: one history, one detraining path', () => {
  const rp = resolveProfile(QA_LIFTER(2));
  const OFF = schedule(140, [pct('none', 100)], () => 0);

  it('a day-stamped checkpoint/restart equals the uninterrupted run (peaks, low-volume clocks, rings carried)', () => {
    const compiled = compileSchedule(OFF, rp);
    const full = runEngine(rp, compiled, { record: 'daily', captureSnapshotAt: [20, 60] });
    for (const k of [20, 60]) {
      const cont = runEngine(rp, compiled, { record: 'daily', initialSnapshot: full.snapshots![k]! });
      for (let i = k; i < 140; i++) expect(cont.daily.rtMuscleGain![i]).toBe(full.daily.rtMuscleGain![i]);
    }
  });

  it('an identical pause before vs after a replan (restored into a longer horizon) loses the same tissue', () => {
    const full = runEngine(rp, compileSchedule(OFF, rp), { record: 'daily', captureSnapshotAt: [40] });
    const longer = schedule(200, [pct('none', 100)], () => 0);
    const replan = runEngine(rp, compileSchedule(longer, rp), { record: 'daily', initialSnapshot: full.snapshots![40]! });
    for (let i = 40; i < 140; i++) expect(replan.daily.rtMuscleGain![i]).toBe(full.daily.rtMuscleGain![i]);
  });

  it('the start date alone changes neither the losable fraction nor the detraining path', () => {
    const later = resolveProfile({ ...QA_LIFTER(2), startDate: '2026-11-02' }); // also a Monday
    expect(trainedGainsAtStart(K, later)).toEqual(trainedGainsAtStart(K, rp));
    const a = run(rp, OFF);
    const b = run(later, { ...OFF, startDate: '2026-11-02' });
    for (let i = 0; i < 140; i++) expect(at(b.rtMuscleGain, i)).toBeCloseTo(at(a.rtMuscleGain, i), 9);
  });

  it('gains accrued inside the run and before it detrain by the same rule (no extra 50 % for a new-run label)', () => {
    const hab = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 105 } }));
    const doubled = hab.map((t) => ({ ...t, id: `${t.id}x2`, exercise: [...(t.exercise ?? []), ...(t.exercise ?? [])] }));
    // 16 weeks of double volume, then a year off
    const s = schedule(112 + 365, [...doubled, pct('none', 100)], (i) => (i < 112 ? i % 7 : 7));
    const d = run(rp, s);
    const accrued = at(d.rtMuscleGain, 111);
    const end = -at(d.rtMuscleGain, 112 + 364);
    // after a year off the trained gains (pre-run and accrued) are nearly gone, down to the set-point, never below it
    expect(end).toBeGreaterThan(0.9 * losable(rp));
    expect(end).toBeLessThanOrEqual(losable(rp) + 1e-6);
    expect(accrued).toBeGreaterThanOrEqual(0);
  });

  it('research scenario: a nonzero retained share follows the attained peak (history), not the run origin', () => {
    const phi = 0.5;
    const d = run(rp, schedule(365, [pct('none', 100)], () => 0), paramOverride({ 'muscle.detrainFloorFrac': phi }));
    const lostOff = -at(d.rtMuscleGain, 364);
    // a year off keeps (about) φ of the trained gains: the floor is mBase + φ·(M_peak − mBase) with M_peak = M_acc,0 here
    expect(lostOff).toBeLessThanOrEqual((1 - phi) * trainedGainsAtStart(K, rp).trainedKg + 1e-6);
    expect(lostOff).toBeGreaterThan(0.9 * (1 - phi) * trainedGainsAtStart(K, rp).trainedKg);
  });
});
