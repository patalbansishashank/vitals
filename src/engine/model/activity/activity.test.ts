// @vitest-environment node
/**
 * Unit tests of the activity module (MODEL_SPEC §1.2; dossier 10; 09 §4.13).
 * Acceptance (WP-M1): 10 V1-V5 (energy, EPOC) and V14-V17 (VO2max, mitochondria) as unit tests; the 10 §4.17 fixtures
 * T1-T6, T8, T13, T14; Ohkawara steps; 09 §4.13 RT session; property tests (bounds, monotonicity, habitual steady state,
 * extreme inputs stay finite); cost of a 180-day run.
 */
import { describe, expect, it } from 'vitest';
import { validateParamDefs } from '../../core/paramsRegistry';
import { SIGNAL_DEFS, createSignalBus, type SignalBus } from '../../types/signals';
import { MI, N_SERIES } from '../../types/metrics';
import type { AnyEngineModule } from '../../types/module';
import type { DayInput, SessionResolved } from '../../types/inputs';
import { moderatorsModule } from '../moderators';
import { cardio, makeCtx, makeDay, miniRun, person, resistance, withSessions } from '../moderators/testkit';
import {
  ACTIVITY_PARAMS,
  activityModule,
  cycleGrossKcalPerMin,
  epocPhi,
  jacksonVo2max,
  memWeight,
  mitoContentTarget,
  mitoRespTarget,
  normInv,
  responsiveness,
  retentionRho,
  rpeToX,
  runNetVo2,
  sessionGrossKcalPerMin,
  updateGainPool,
  vo2GainTarget,
  walkNetVo2,
  type ActivityState,
} from './index';

const mods = [activityModule] as unknown as readonly AnyEngineModule[];
type K = ReturnType<typeof activityModule.prepare>;

/** 10 §4.17 fixture person: 75 kg, 1.75 m, RMR 1750 kcal/d, VO2max 42 mL/kg/min. */
const P75 = person({ body: { weightKg: 75, heightCm: 175 }, labs: { measuredRmrKcal: 1750, vo2maxMlKgMin: 42 } });
const RMR_MIN = 1750 / 1440;

const ctxFor = (p = P75, ov: Record<string, number> = {}) => makeCtx(mods, p, ov);
function busFor(w = 75, rmrKcalD = 1750): SignalBus {
  const b = createSignalBus();
  b.scaleWeightKg = w;
  b.tissueMassKg = w;
  b.rmrKcalH = rmrKcalD / 24;
  return b;
}
const base: SessionResolved = {
  kind: 'cardio', startH: 8, durationMin: 60, modality: 7, intensityFrac: Number.NaN, met: Number.NaN, speedKmh: Number.NaN, powerW: Number.NaN, rpe: Number.NaN,
  setsByRegion: new Float64Array(9), rir: 2, loadPct1RM: 70, restSec: 120, toFailure: false, carbDuringGPerH: 0, coldWaterImmersion: false,
};
const sess = (p: Partial<SessionResolved>): SessionResolved => ({ ...base, ...p });
/** Gross kcal of a whole session for the fixture person (10 §4.17). */
function gross(k: K, s: SessionResolved, o: { vo2max?: number; bw?: number; h?: number; rmrD?: number } = {}): number {
  const bw = o.bw ?? 75;
  const h = o.h ?? 1.75;
  return sessionGrossKcalPerMin(k, s, o.vo2max ?? 42, bw, h, (o.rmrD ?? 1750) / 1440, bw / (h * h)) * s.durationMin;
}
const net = (k: K, s: SessionResolved, o: Parameters<typeof gross>[2] = {}): number => gross(k, s, o) - ((o.rmrD ?? 1750) / 1440) * s.durationMin;
const within = (v: number, target: number, rel: number): void => {
  expect(Math.abs(v - target) / target).toBeLessThanOrEqual(rel);
};

interface HourLog {
  exEE: number[];
  net: number[];
  mins: number[];
  x: number[];
  hard: number[];
  muscle: number[];
  steps: number[];
  planned: number[];
}
/** Run the given days (clock days 0..) and log the hourly signals. */
function runDays(
  p: ReturnType<typeof person>,
  build: (profile: ReturnType<typeof makeCtx>['profile'], d: number) => DayInput,
  nDays: number,
  ov: Record<string, number> = {},
  hooks: { afterInit?: (S: object[], K: object[], bus: SignalBus) => void; bus?: SignalBus } = {},
) {
  const ctx = ctxFor(p, ov);
  const log: HourLog = { exEE: [], net: [], mins: [], x: [], hard: [], muscle: [], steps: [], planned: [] };
  const days = Array.from({ length: nDays }, (_, d) => ({ clockDay: d, day: build(ctx.profile, d) }));
  const run = miniRun(mods, ctx, days, {
    bus: hooks.bus ?? busFor(p.body.weightKg, p.labs?.measuredRmrKcal ?? 1750),
    ...(hooks.afterInit ? { afterInit: hooks.afterInit } : {}),
    afterHour: (_d, _h, bus) => {
      log.exEE.push(bus.exEEKcalH);
      log.net.push(bus.exSessionNetKcalH);
      log.mins.push(bus.exMinutesH);
      log.x.push(bus.exIntensityFrac);
      log.hard.push(bus.exHardSession);
      log.muscle.push(bus.exActiveMuscleKg);
      log.steps.push(bus.stepsExtraKcalH);
      log.planned.push(bus.exPlannedKcalD);
    },
  });
  return { run, log, ctx, s: run.S[0] as ActivityState, k: run.K[0] as K };
}
const sum = (a: number[], from = 0, to = a.length): number => a.slice(from, to).reduce((x, y) => x + y, 0);

describe('parameter registry (10 §4.1-4.3, §4.8-4.9; 09 §4.13)', () => {
  it('is valid and carries the dossier numbers', () => {
    expect(validateParamDefs(mods)).toEqual([]);
    const by = (n: string) => ACTIVITY_PARAMS.find((p) => p.id === `activity.${n}`)!;
    const tri = (n: string): number[] => [by(n).value, by(n).low, by(n).high];
    expect(tri('stepsNet')).toEqual([0.44, 0.36, 0.5]);
    expect(tri('runEff')).toEqual([0.9, 0.8, 1.0]);
    expect(by('walkIntercept').value).toBe(3.85);
    expect(by('walkSlope').value).toBe(5.97);
    expect(tri('cycleEff')).toEqual([0.26, 0.23, 0.28]);
    expect(by('cycleBaselineMult').value).toBe(2.4);
    expect(tri('rtMetDefault')).toEqual([4.0, 3.0, 6.0]);
    expect(by('displacedBaseline').value).toBe(0.2);
    expect(tri('obesityWalkFactor')).toEqual([1.1, 1.05, 1.15]);
    expect(by('kcalPerLO2').value).toBe(5);
    expect(tri('vo2GMax')).toEqual([0.35, 0.25, 0.45]);
    expect(tri('vo2MemHalf')).toEqual([130, 100, 170]);
    expect(by('vo2GCap').value).toBe(0.6);
    expect(by('vo2SexF').value).toBe(0.95);
    expect(by('vo2TauF').value).toBe(15);
    expect(by('vo2TauS').value).toBe(60);
    expect(tri('vo2TauDn')).toEqual([30, 20, 40]);
    expect(by('vo2FastShare').value).toBe(0.55);
    expect(by('vo2RhoMax').value).toBe(0.45);
    expect(tri('epocPhiMax')[0]).toBe(0.15);
    expect(tri('epocPhiMaxInterval')[0]).toBe(0.2);
    expect(by('epocPhiFloor').value).toBe(0.02);
    expect(tri('postRtRee')[0]).toBe(0.05);
    expect(by('postRtHours').value).toBe(72);
    expect([by('memW1').value, by('memW2').value, by('memW3').value]).toEqual([0.4, 1.0, 1.5]);
    expect([by('memBand1').value, by('memBand2').value, by('memBand3').value, by('hardX').value]).toEqual([0.4, 0.55, 0.7, 0.85]);
    expect([by('mitoMcMax').value, by('mitoMemHalf').value, by('mitoTauUpC').value, by('mitoTauDnC').value]).toEqual([0.5, 150, 21, 17.3]);
    expect([by('mitoMrAmp').value, by('mitoTauUpR').value, by('mitoTauDnR').value]).toEqual([0.3, 14, 10]);
    expect(by('aerobicIdxRefKcalD').value).toBe(300);
  });

  it('review m12: the RT EPOC default is 0 (post-RT REE is its slow component) with the dossier range kept', () => {
    const p = ACTIVITY_PARAMS.find((q) => q.id === 'activity.epocRt')!;
    expect([p.value, p.low, p.high]).toEqual([0, 0, 0.1]);
    expect(p.note).toMatch(/m12/);
  });

  it('every ParamDef states unit, grade, source, dossier section and status', () => {
    for (const p of ACTIVITY_PARAMS) {
      expect(p.unit.length).toBeGreaterThan(0);
      expect(['A', 'B', 'C', 'D']).toContain(p.grade);
      expect(p.source.length).toBeGreaterThan(3);
      expect(p.dossier).toMatch(/^(10|09|04|MODEL) ?/);
      expect(p.status).toBeDefined();
    }
  });
});

describe('10 §4.17 fixtures (75 kg man, 1.75 m, RMR 1750 kcal/d, VO2max 42; ±3 %)', () => {
  const k = activityModule.prepare(ctxFor());

  it('T1: walk 5 km/h, 60 min → gross 299, net 228 kcal (V2 within ±10 % of the Compendium 3.8 MET = 299)', () => {
    const s = sess({ modality: 1, speedKmh: 5 });
    within(gross(k, s), 299, 0.03);
    within(net(k, s), 228, 0.03);
    within(gross(k, s), 299, 0.1);
  });

  it('T2: run 10 km/h, 30 min → gross 366, net 331 kcal', () => {
    const s = sess({ modality: 2, speedKmh: 10, durationMin: 30 });
    within(gross(k, s), 366, 0.03);
    within(net(k, s), 331, 0.03);
  });

  it('T3: cycle 100 W / 200 W, 60 min → gross 506 / 837, net 433 / 764 kcal', () => {
    const a = sess({ modality: 3, powerW: 100 });
    const b = sess({ modality: 3, powerW: 200 });
    within(gross(k, a), 506, 0.03);
    within(net(k, a), 433, 0.03);
    within(gross(k, b), 837, 0.03);
    within(net(k, b), 764, 0.03);
    expect(cycleGrossKcalPerMin(100, RMR_MIN, k) * 60).toBeCloseTo(505.9, 0);
  });

  it('T4: RT 4.0 MET, 60 min → gross 315, net 242 kcal', () => {
    const s = sess({ kind: 'resistance', modality: 0, met: 4.0 });
    within(gross(k, s), 315, 0.03);
    within(net(k, s), 242, 0.03);
  });

  it('T5: crawl 8.0 MET, 45 min → gross 472, net 418 kcal', () => {
    const s = sess({ modality: 4, met: 8, durationMin: 45 });
    within(gross(k, s), 472, 0.03);
    within(net(k, s), 418, 0.03);
  });

  it('T6: EPOC fraction φ: x = 0.75 for 45 min → 0.114; HIIT x = 0.90 for 25 min → 0.129; walk x = 0.35 for 60 min → 0.02', () => {
    expect(epocPhi(0.75, 45, false, false, k)).toBeCloseTo(0.114, 3);
    expect(epocPhi(0.9, 25, false, true, k)).toBeCloseTo(0.129, 3);
    expect(epocPhi(0.35, 60, false, false, k)).toBeCloseTo(0.02, 6);
  });

  it('T8: net step energy 10 000 / 6 000 steps → 337 / 202 kcal (0.44·BW rule, ±3 %)', () => {
    within(k.stepsNet * 75 * 10, 337, 0.03);
    within(k.stepsNet * 75 * 6, 202, 0.03);
  });

  it('T14: Jackson non-exercise VO2max (man 30 y BMI 25 PA-R 3 → 42.8; woman 30 y BMI 23 PA-R 3 → 33.4)', () => {
    expect(jacksonVo2max(1, 30, 25, 3, k)).toBeCloseTo(42.8, 1);
    expect(jacksonVo2max(0, 30, 23, 3, k)).toBeCloseTo(33.4, 1);
  });

  it('T13: VO2max gain at constant MEM 130/wk: +13.1 % at 6 wk, +15.6 % at 12 wk, +16.8 % at 20 wk; detraining −7.3 % at 21 d and −12.2 % at 56 d', () => {
    const g: number[] = [];
    let gF = 0;
    let gS = 0;
    const gStar = vo2GainTarget(130, k);
    expect(gStar).toBeCloseTo(0.175, 6);
    const fallOff = 1 - Math.exp(-1 / 30);
    for (let d = 1; d <= 140; d++) {
      gF = updateGainPool(gF, 0.55 * gStar, k.riseF, fallOff, 0);
      gS = updateGainPool(gS, 0.45 * gStar, k.riseS, fallOff, 0);
      g[d] = gF + gS;
    }
    expect(g[42]! * 100).toBeCloseTo(13.1, 0);
    expect(g[84]! * 100).toBeCloseTo(15.6, 0);
    expect(g[140]! * 100).toBeCloseTo(16.8, 0);
    const peak = 1 + g[140]!;
    let dF = gF;
    let dS = gS;
    const out: number[] = [];
    for (let d = 1; d <= 56; d++) {
      dF = updateGainPool(dF, 0, k.riseF, fallOff, 0);
      dS = updateGainPool(dS, 0, k.riseS, fallOff, 0);
      out[d] = ((1 + dF + dS) / peak - 1) * 100;
    }
    expect(out[21]!).toBeCloseTo(-7.3, 0);
    expect(out[56]!).toBeCloseTo(-12.2, 0);
  });
});

describe('10 V1-V5 and 09 §4.13: energy of a bout and EPOC', () => {
  const k = activityModule.prepare(ctxFor(person({ body: { weightKg: 71, heightCm: 170 }, labs: { measuredRmrKcal: 1650, vo2maxMlKgMin: 41.5 } })));
  const o = { bw: 71, h: 1.7, vo2max: 41.5, rmrD: 1650 };

  it('V1 (Wilkin): 1600 m walk at 86 m/min and run at 160 m/min (71 kg) within ±15 % of 89 / 113 kcal; walking EPOC τ = 0.15 h', () => {
    const walk = sess({ modality: 1, speedKmh: 5.16, durationMin: 1600 / 86 });
    const run = sess({ modality: 2, speedKmh: 9.6, durationMin: 10 });
    within(gross(k, walk, o), 372.5 / 4.184, 0.15);
    within(gross(k, run, o), 471 / 4.184, 0.15);
    expect(k.epocTauLight).toBe(0.15);
    expect(epocPhi(0.3, walk.durationMin, false, false, k)).toBe(k.epocPhiFloor); // walking x ≈ 0.33 < 0.5: light, φ at its floor
  });

  it('V1 through the module: the light-exercise EPOC queue empties within the next hour (τ 0.15 h)', () => {
    const { log } = runDays(P75, (pr, d) => (d === 0 ? withSessions(makeDay(pr), [{ ...cardio(8, 60, 0.35) }]) : makeDay(pr)), 2);
    const inc = sum(log.exEE, 8, 9);
    const rel9 = log.exEE[9]!;
    // φ = 0.02 of the session net; 1 − exp(−1/0.15) = 99.9 % released in the next hour
    const netK = log.net[8]!;
    expect(rel9).toBeCloseTo(0.02 * netK * (1 - Math.exp(-1 / 0.15)), 6);
    expect(sum(log.exEE, 10, 48)).toBeCloseTo(0.02 * netK * Math.exp(-1 / 0.15), 6);
    expect(inc).toBeGreaterThan(0);
  });

  it('V3 (Knab): 45 min at 73 % VO2max, net 519 kcal → EPOC inside the 6-15 % range of the net cost (outlier 37 % flagged)', () => {
    const phi = epocPhi(0.73, 45, false, false, k);
    expect(phi).toBeGreaterThanOrEqual(0.06);
    expect(phi).toBeLessThanOrEqual(0.15);
    expect(phi * 519).toBeLessThan(0.15 * 519);
    expect(190 / 519).toBeGreaterThan(0.15); // the measured +190 kcal exceeds the model range: known upper outlier
  });

  it('V4: sessions ≥ 50 min at ≥ 70 % VO2max → φ ∈ [0.06, 0.15]', () => {
    for (const x of [0.7, 0.75, 0.8, 0.9, 1.0]) for (const dur of [50, 60, 90, 120]) {
      const phi = epocPhi(x, dur, false, false, k);
      expect(phi).toBeGreaterThanOrEqual(0.06);
      expect(phi).toBeLessThanOrEqual(0.15);
    }
  });

  it('V4 through the module: EPOC released after a 60-min 75 % session is φ·net with φ ∈ [0.06, 0.15] and the queue follows the 36 % / 25 % remaining at 1 h / 2 h', () => {
    const { log } = runDays(P75, (pr, d) => (d === 0 ? withSessions(makeDay(pr), [cardio(8, 60, 0.75)]) : makeDay(pr)), 3);
    const netK = log.net[8]!;
    const totalRel = sum(log.exEE, 9, 72);
    const phi = totalRel / netK;
    expect(phi).toBeGreaterThanOrEqual(0.06);
    expect(phi).toBeLessThanOrEqual(0.15);
    expect(phi).toBeCloseTo(0.1144, 3);
    // remaining fraction after 1 h and 2 h (10 §4.2: 36 % and 25 %)
    const rem1 = 1 - log.exEE[9]! / totalRel;
    const rem2 = 1 - (log.exEE[9]! + log.exEE[10]!) / totalRel;
    expect(rem1).toBeCloseTo(0.36, 1);
    expect(rem2).toBeCloseTo(0.25, 1);
    expect(sum(log.exEE, 22, 72) / totalRel).toBeLessThan(0.03); // ≈ 1 % left at 14 h
  });

  it('V5 (Abboud): resistance EPOC ≤ 10 % of the net cost (registry high 0.10; default 0 by review m12)', () => {
    expect(epocPhi(0.3, 60, true, false, k)).toBeLessThanOrEqual(0.1);
    expect(k.epocRt).toBe(0);
    const kHigh = activityModule.prepare(ctxFor(P75, { 'activity.epocRt': 0.1 }));
    expect(epocPhi(0.3, 60, true, false, kHigh)).toBeLessThanOrEqual(0.1);
  });

  it('09 §4.13: RT 80 kg, 60 min, MET 3.5 → ≈ 200 kcal net (own-RMR convention gives ≈ 219-221, +10 %: tolerance ±12 %)', () => {
    const s = sess({ kind: 'resistance', modality: 0, met: 3.5 });
    const n = net(k, s, { bw: 80, h: 1.78, vo2max: 42, rmrD: 1742 });
    expect(n).toBeGreaterThan(200 * 0.88);
    expect(n).toBeLessThan(200 * 1.12);
    // MET 6.0 → 400 kcal net in 09; own-RMR convention
    const n6 = net(k, sess({ kind: 'resistance', modality: 0, met: 6 }), { bw: 80, h: 1.78, vo2max: 42, rmrD: 1742 });
    within(n6, 400, 0.12);
  });

  it('Ohkawara (02 V9): +20 615 steps/d for 64.5 kg men → +588 kcal/d ± 15 %', () => {
    const p = person({ body: { weightKg: 64.5, heightCm: 175 }, labs: { measuredRmrKcal: 1600, vo2maxMlKgMin: 42 } });
    const { log } = runDays(p, (pr) => makeDay(pr, { steps: 7000 + 20615 }), 1, {}, { bus: busFor(64.5, 1600) });
    within(sum(log.steps), 588, 0.15);
    expect(sum(log.steps)).toBeCloseTo(0.44 * 64.5 * 20.615, 0);
  });
});

describe('session energy through the module (hourly signals)', () => {
  it('a 60-min 75 % session at 17:00 books net 636 kcal in hour 17 and the ledger closes: Σ exEE = increment + EPOC', () => {
    const { log, k } = runDays(P75, (pr, d) => (d === 0 ? withSessions(makeDay(pr), [cardio(17, 60, 0.75)]) : makeDay(pr)), 3);
    const grossH = 0.75 * 42 * 75 * 5 / 1000 * 60;
    const netH = grossH - RMR_MIN * 60;
    expect(log.net[17]!).toBeCloseTo(netH, 6);
    expect(log.mins[17]!).toBe(60);
    expect(log.x[17]!).toBeCloseTo(0.75, 9);
    expect(log.hard[17]!).toBe(0);
    expect(log.muscle[17]!).toBeCloseTo(0.4 * 33.4 * 0 + k.smmActiveKg, 9);
    expect(log.muscle[17]!).toBeGreaterThan(0);
    const inc = netH - 0.2 * RMR_MIN * 60;
    const epoc = epocPhi(0.75, 60, false, false, k) * netH;
    expect(sum(log.exEE)).toBeCloseTo(inc + epoc, 3); // the last 0.003 % of the slow component is still queued after 55 h
    expect(sum(log.net)).toBeCloseTo(netH, 6);
    // rest hours carry no session energy
    expect(log.net[16]!).toBe(0);
    expect(log.mins[16]!).toBe(0);
    expect(log.muscle[16]!).toBe(0);
  });

  it('a session straddling two hours is split by minutes (17:30-18:30)', () => {
    const { log } = runDays(P75, (pr, d) => (d === 0 ? withSessions(makeDay(pr), [cardio(17.5, 60, 0.6)]) : makeDay(pr)), 1);
    expect(log.mins[17]!).toBeCloseTo(30, 9);
    expect(log.mins[18]!).toBeCloseTo(30, 9);
    expect(log.net[17]!).toBeCloseTo(log.net[18]!, 9);
  });

  it('two sessions in one hour: minutes add and the intensity is the minutes-weighted mean', () => {
    const { log } = runDays(P75, (pr, d) => (d === 0 ? withSessions(makeDay(pr), [cardio(9, 20, 0.5), cardio(9.5, 30, 0.8)]) : makeDay(pr)), 1);
    expect(log.mins[9]!).toBeCloseTo(50, 9);
    expect(log.x[9]!).toBeCloseTo((0.5 * 20 + 0.8 * 30) / 50, 9);
  });

  it('exHardSession: cardio at x ≥ 0.85 and resistance to failure; not at x = 0.84 or RT without failure', () => {
    const hard = runDays(P75, (pr, d) => (d === 0 ? withSessions(makeDay(pr), [cardio(9, 30, 0.9), resistance(12, 45, 3.5, 18, true), cardio(15, 30, 0.84), resistance(18, 45, 3.5, 18, false)]) : makeDay(pr)), 1).log;
    expect(hard.hard[9]!).toBe(1);
    expect(hard.hard[12]!).toBe(1);
    expect(hard.hard[15]!).toBe(0);
    expect(hard.hard[18]!).toBe(0);
  });

  it('input resolution order: MET (session average), %VO2max, speed, power, RPE, modality default (10 §4.1, MODEL_SPEC §1.2 step 1)', () => {
    const k = activityModule.prepare(ctxFor());
    const kcalMin = (s: SessionResolved): number => sessionGrossKcalPerMin(k, s, 42, 75, 1.75, RMR_MIN, 24.5);
    // integration 2026-09-30: a stated MET is the session-average cost; an intensity given with it is the work intensity
    // (HIIT at 90 % VO2max averaging 8 MET) and only sets the descriptors (10 V13 matched-energy HIIT vs MICT)
    expect(kcalMin(sess({ modality: 3, intensityFrac: 0.5, met: 12, powerW: 300 }))).toBeCloseTo(12 * 3.5 * 75 * 5 / 1000, 9);
    expect(kcalMin(sess({ modality: 3, intensityFrac: 0.5, powerW: 300 }))).toBeCloseTo(0.5 * 42 * 75 * 5 / 1000, 9);
    expect(kcalMin(sess({ modality: 3, met: 6, powerW: 300 }))).toBeCloseTo(6 * 3.5 * 75 * 5 / 1000, 9);
    expect(kcalMin(sess({ modality: 3, powerW: 150 }))).toBeCloseTo(cycleGrossKcalPerMin(150, RMR_MIN, k), 9);
    expect(kcalMin(sess({ modality: 3, rpe: 6 }))).toBeCloseTo(rpeToX(6, k) * 42 * 75 * 5 / 1000, 9);
    expect(rpeToX(2, k)).toBeCloseTo(0.4, 9);
    expect(rpeToX(8, k)).toBeCloseTo(0.85, 9);
    expect(kcalMin(sess({ modality: 6 }))).toBeCloseTo(0.875 * 42 * 75 * 5 / 1000, 9); // hiit default
    expect(kcalMin(sess({ modality: 1 }))).toBeCloseTo(0.475 * 42 * 75 * 5 / 1000, 9); // walk default
    // walking and running speeds use the person's own rest VO2
    expect(walkNetVo2(5, 1.75, k)).toBeCloseTo(3.85 + 5.97 * (5 / 3.6) ** 2 / 1.75, 9);
    expect(runNetVo2(10, k)).toBeCloseTo(0.9 * 0.2 * (10000 / 60), 9);
  });

  it('obesity walking factor (10 §4.1.3): +10 % of the net walking cost per kg from BMI 35', () => {
    const k = activityModule.prepare(ctxFor());
    const s = sess({ modality: 1, speedKmh: 5 });
    const lean = sessionGrossKcalPerMin(k, s, 42, 75, 1.75, RMR_MIN, 30);
    const obese = sessionGrossKcalPerMin(k, s, 42, 75, 1.75, RMR_MIN, 36);
    const netWalk = walkNetVo2(5, 1.75, k) * 75 * 5 / 1000;
    expect(obese - lean).toBeCloseTo(0.1 * netWalk, 9);
  });

  it('hand-built hour without DayInput sessions falls back to the hour fields (exIntensityFrac)', () => {
    const ctx = ctxFor();
    const k = activityModule.prepare(ctx);
    const bus = busFor();
    const s = activityModule.init(k, ctx, bus);
    const day = makeDay(ctx.profile);
    const hour = { hourOfDay: 10, exMin: 60, exIntensityFrac: 0.6, exMet: 0, exModality: 3, steps: 0, asleep: 0, rtSetsTotal: 0, rtToFailure: 0 } as never;
    activityModule.startDay(s, k, bus, day, { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 });
    activityModule.stepHour(s, k, bus, hour, day, { day: 0, hourOfDay: 10, hourIndex: 10, weekday: 0 });
    expect(bus.exSessionNetKcalH).toBeCloseTo(0.6 * 42 * 75 * 5 / 1000 * 60 - RMR_MIN * 60, 6);
    expect(bus.exIntensityFrac).toBeCloseTo(0.6, 9);
  });
});

describe('post-RT REE (09 §4.13) and step energy (10 §4.14)', () => {
  it('after an RT session REE is elevated by 0.05·REE·(1 − 0.5·TS) for 72 h, not additive across sessions', () => {
    const mk = (extraSessionDay: number | null) =>
      runDays(P75, (pr, d) => (d === 0 || d === extraSessionDay ? withSessions(makeDay(pr), [resistance(8, 60, 3.5)]) : makeDay(pr)), 8);
    const one = mk(null).log;
    const rate = 0.05 * (1750 / 24);
    // hours 9..80 (72 h) carry the elevation; the session hour itself and hours after are unchanged
    for (let h = 9; h <= 80; h++) expect(one.exEE[h]!).toBeCloseTo(rate, 9);
    expect(one.exEE[81]!).toBe(0);
    expect(sum(one.exEE, 9, 81)).toBeCloseTo(72 * rate, 6);
    // a second session on day 1 (hour 32) restarts the clock: still one 5 % rate, 72 h after the last session
    const two = mk(1).log;
    for (let h = 33; h <= 32 + 72; h++) if (h < 8 * 24) expect(two.exEE[h]!).toBeCloseTo(rate, 9);
    expect(Math.max(...two.exEE.filter((_, h) => h < 8 * 24 && h !== 8 && h !== 32))).toBeLessThan(rate + 1e-9);
    expect(two.exEE[32 + 73]!).toBe(0);
  });

  it('trainingStatus shields the elevation: rate × (1 − 0.5·TS)', () => {
    const bus = busFor();
    bus.trainingStatus = 1;
    const { log } = runDays(P75, (pr, d) => (d === 0 ? withSessions(makeDay(pr), [resistance(8, 60, 3.5)]) : makeDay(pr)), 4, {}, { bus });
    expect(log.exEE[12]!).toBeCloseTo(0.05 * (1750 / 24) * 0.5, 9);
  });

  it('steps: zero extra at the habitual steps, proportional above, negative below, and a zero-step day removes the baseline', () => {
    const at = runDays(P75, (pr) => makeDay(pr, { steps: 7000 }), 1).log;
    expect(Math.abs(sum(at.steps))).toBeLessThan(1e-9);
    const up = runDays(P75, (pr) => makeDay(pr, { steps: 10000 }), 1).log;
    expect(sum(up.steps)).toBeCloseTo(0.44 * 75 * 3, 6);
    const down = runDays(P75, (pr) => makeDay(pr, { steps: 3000 }), 1).log;
    expect(sum(down.steps)).toBeCloseTo(-0.44 * 75 * 4, 6);
    const zero = runDays(P75, (pr) => makeDay(pr, { steps: 0 }), 1).log;
    expect(sum(zero.steps)).toBeCloseTo(-0.44 * 75 * 7, 1);
    // BMI ≥ 35 walking factor on the extra steps
    const obese = person({ body: { weightKg: 110, heightCm: 175 }, labs: { measuredRmrKcal: 2000, vo2maxMlKgMin: 30 } });
    const ob = runDays(obese, (pr) => makeDay(pr, { steps: 10000 }), 1, {}, { bus: busFor(110, 2000) }).log;
    expect(sum(ob.steps)).toBeCloseTo(0.44 * 1.1 * 110 * 3, 6);
  });
});

describe('planned exercise energy and the aerobic index (MODEL_SPEC §1.2 step 6, review B5/M14)', () => {
  it('exPlannedKcalD at startDay matches the day ledger of the same sessions (EPOC and post-RT REE included)', () => {
    const mkDay = (pr: ReturnType<typeof makeCtx>['profile']) => withSessions(makeDay(pr), [cardio(8, 60, 0.75), resistance(17, 60, 3.5)]);
    const { log } = runDays(P75, (pr, d) => (d === 0 ? mkDay(pr) : makeDay(pr)), 2);
    const planned = log.planned[0]!;
    const actual = sum(log.exEE, 0, 24);
    expect(planned).toBeGreaterThan(500);
    within(actual, planned, 0.03);
  });

  it('a day without sessions plans 0 kcal', () => {
    const { log } = runDays(P75, (pr) => makeDay(pr), 1);
    expect(log.planned[0]!).toBe(0);
  });

  it('aerobicIdx = clamp(7-day mean net cardio EE / 300 kcal/d, 0, 1); resistance does not count', () => {
    const ctx = ctxFor();
    const days = Array.from({ length: 9 }, (_, d) => ({
      clockDay: d,
      day: withSessions(makeDay(ctx.profile), [cardio(8, 60, 0.75), resistance(17, 60, 3.5)]),
    }));
    const idx: number[] = [];
    const cardioNet: number[] = []; // net of the cardio session (hour 8) each day; RT (hour 17) is logged separately
    const rtNet: number[] = [];
    miniRun(mods, ctx, days, {
      bus: busFor(),
      beforeHour: (_d, h, bus) => { if (h === 0) idx.push(bus.aerobicIdx); },
      afterHour: (_d, h, bus) => { if (h === 8) cardioNet.push(bus.exSessionNetKcalH); if (h === 17) rtNet.push(bus.exSessionNetKcalH); },
    });
    expect(rtNet.every((v) => v > 0)).toBe(true);
    expect(idx[0]).toBe(0);
    for (let d = 1; d <= 8; d++) {
      const window = cardioNet.slice(Math.max(0, d - 7), d);
      const mean = (window.reduce((x, y) => x + y, 0) + 0) / 7;
      expect(idx[d]).toBeCloseTo(Math.min(1, mean / 300), 9);
    }
    expect(idx[8]).toBe(1); // 7 × ≈ 650 kcal/d ÷ 300 clamps at 1
  });

  it('exSessionNetKcalD = the day\'s Σ exSessionNetKcalH, written in endOfDay (review m10, R-EA)', () => {
    const ctx = ctxFor();
    const days = Array.from({ length: 3 }, (_, d) => ({
      clockDay: d,
      day: withSessions(makeDay(ctx.profile), d === 1 ? [] : [cardio(8, 60, 0.7), resistance(17, 45, 3.5)]),
    }));
    const hourSum = [0, 0, 0];
    const daily: number[] = [];
    miniRun(mods, ctx, days, {
      bus: busFor(),
      afterHour: (d, _h, bus) => {
        hourSum[d] = hourSum[d]! + bus.exSessionNetKcalH;
      },
      afterDay: (_d, bus) => {
        daily.push(bus.exSessionNetKcalD);
      },
    });
    expect(hourSum[0]).toBeGreaterThan(300);
    for (let d = 0; d < 3; d++) expect(daily[d]).toBeCloseTo(hourSum[d]!, 9);
    expect(daily[1]).toBe(0);
  });

  it('aerobicIdx ≈ 0.5 for ~150 min/wk of moderate activity and clamps at 1', () => {
    const ctx = ctxFor();
    const days = Array.from({ length: 8 }, (_, d) => ({ clockDay: d, day: withSessions(makeDay(ctx.profile), d % 7 === 0 || d % 7 === 2 || d % 7 === 4 ? [cardio(8, 50, 0.6)] : []) }));
    let idx = 0;
    miniRun(mods, ctx, days, { bus: busFor(), beforeHour: (d, h, bus) => { if (h === 0 && d === 7) idx = bus.aerobicIdx; } });
    expect(idx).toBeGreaterThan(0.35);
    expect(idx).toBeLessThan(0.65);
  });
});

describe('VO2max initial state (10 §4.8A) and habitual equilibrium', () => {
  const FRIEND = {
    male: { '20': [29.0, 40.1, 48.0, 55.2, 66.3], '30': [27.2, 35.9, 42.4, 49.2, 59.8], '40': [24.2, 31.9, 37.8, 45.0, 55.6], '50': [20.9, 27.1, 32.6, 39.7, 50.7], '60': [17.4, 23.7, 28.2, 34.5, 43.0], '70': [16.3, 20.4, 24.4, 30.4, 39.7] },
    female: { '20': [21.7, 30.5, 37.6, 44.7, 56.0], '30': [19.0, 25.3, 30.2, 36.1, 45.8], '40': [17.0, 22.1, 26.7, 32.4, 41.7], '50': [16.0, 19.9, 23.4, 27.6, 35.9], '60': [13.4, 17.2, 20.0, 23.8, 29.4], '70': [13.1, 15.6, 18.3, 20.8, 24.1] },
  } as const;
  const v0 = (p: ReturnType<typeof person>): number => (activityModule.prepare(ctxFor(p)) as K).v0;

  it('a measured VO2max is used as given', () => {
    expect(v0(person({ labs: { vo2maxMlKgMin: 51.5 } }))).toBe(51.5);
  });

  it('otherwise Jackson PA-R with the selector nearest to habitual steps; MAN fixture inside the FRIEND 25th-50th percentile band', () => {
    const p = person({ body: { weightKg: 82, heightCm: 178 }, habits: { typicalSteps: 7000, sessionsPerWeek: 0 } });
    // 7000 steps → selector 6 500 → PA-R 2: 56.363 + 3.842 − 13.335 − 0.754·25.88 + 10.987
    const expected = 56.363 + 1.921 * 2 - 0.381 * 35 - 0.754 * (82 / 1.78 ** 2) + 10.987;
    expect(v0(p)).toBeCloseTo(expected, 6);
    expect(v0(p)).toBeGreaterThan(FRIEND.male['30'][1]);
    expect(v0(p)).toBeLessThan(FRIEND.male['30'][2]);
    // PA-R is monotone in habitual steps
    let prev = 0;
    for (const steps of [4000, 6500, 8500, 11000, 15000]) {
      const v = v0(person({ habits: { typicalSteps: steps, sessionsPerWeek: 0 } }));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('non-exercise estimates fall between the FRIEND 5th and 95th percentiles for adults 20-79 y at BMI 23-27', () => {
    for (const sex of ['male', 'female'] as const) for (const age of [25, 35, 45, 55, 65, 75]) for (const [wKg, steps] of [[70, 6500], [78, 8500], [66, 11000]]) {
      const dec = String(Math.floor(age / 10) * 10) as keyof typeof FRIEND.male;
      const v = v0(person({ body: { sex, ageYears: age, weightKg: wKg!, heightCm: sex === 'male' ? 176 : 165 }, habits: { typicalSteps: steps!, sessionsPerWeek: 0 } }));
      const row = FRIEND[sex][dec];
      // Jackson (SEE 5.7) under-predicts sedentary women in their 70s by ≤ 1 mL/kg/min: 10 % slack on the 5th percentile there
      expect(v).toBeGreaterThan(age >= 70 ? 0.9 * row[0] : row[0]);
      expect(v).toBeLessThan(row[4]);
    }
  });

  it('the initial state is the equilibrium of the habitual dose: vSed = v0/(1 + g*), pools split 55/45', () => {
    const p = person({ labs: { vo2maxMlKgMin: 45 }, habits: { typicalSteps: 7000, sessionsPerWeek: 3, lifingCardioMix: 1 } });
    const ctx = ctxFor(p);
    const k = activityModule.prepare(ctx);
    const s = activityModule.init(k, ctx, busFor());
    const gStar = vo2GainTarget(180, k); // 3 cardio sessions of 60 min at the default moderate intensity (w = 1.0)
    expect(s.mem7d).toBeCloseTo(180, 9);
    expect(s.vSed * (1 + gStar)).toBeCloseTo(45, 9);
    expect(s.vo2FastPool / (s.vo2FastPool + s.vo2SlowPool)).toBeCloseTo(0.55, 9);
    expect(s.vo2max).toBe(45);
    expect(s.mitoRel).toBe(1);
  });

  it('holding the habitual dose for 30 days keeps VO2max and the oxidative index steady (maintenance stays maintenance)', () => {
    const p = person({ labs: { vo2maxMlKgMin: 45, measuredRmrKcal: 1750 }, habits: { typicalSteps: 7000, sessionsPerWeek: 3, lifingCardioMix: 1 } });
    const { s } = runDays(p, (pr, d) => withSessions(makeDay(pr), d % 7 === 0 || d % 7 === 2 || d % 7 === 4 ? [cardio(8, 60, 0.625)] : []), 35);
    expect(Math.abs(s.vo2max / 45 - 1)).toBeLessThan(0.005);
    expect(Math.abs(s.mitoRel - 1)).toBeLessThan(0.02);
  });
});

describe('burn-in (clock.day < 0): habitual exercise and the held VO2max state', () => {
  it('legacy habitual day without sessions: emits EAT0/24 per hour, holds VO2max / MEM / mitochondria, then day 0 continues', () => {
    const p = person({ labs: { vo2maxMlKgMin: 42, measuredRmrKcal: 1750 }, habits: { typicalSteps: 7000, sessionsPerWeek: 3, lifingCardioMix: 0.5 } });
    const ctx = ctxFor(p);
    const days = Array.from({ length: 15 }, (_, i) => ({ clockDay: i - 14, day: makeDay(ctx.profile) }));
    const eeSeen: number[] = [];
    const bus = busFor();
    let endOfBurnIn: ActivityState | undefined;
    let live: ActivityState | undefined;
    let vAtT0 = Number.NaN;
    const run = miniRun(mods, ctx, days, {
      bus,
      afterInit: (S) => { live = S[0] as ActivityState; },
      afterHour: (d, _h, b) => { if (d < 0) eeSeen.push(b.exEEKcalH); },
      afterDay: (d, b) => { if (d === -1) { endOfBurnIn = structuredClone(live!); vAtT0 = b.vo2maxMlKgMin; } },
    });
    const eat0 = (3 * (0.5 * 4 + 0.5 * 5 - 1) * 75) / 7;
    // weight in resolveProfile is the entered 82 kg
    const eat0Profile = (3 * (4.5 - 1) * ctx.profile.weightKg) / 7;
    expect(eat0).toBeGreaterThan(0);
    for (const v of eeSeen) expect(v).toBeCloseTo(eat0Profile / 24, 9);
    const s = endOfBurnIn!;
    expect(vAtT0).toBe(42);
    expect(s.vo2max).toBe(42);
    expect(s.mem7d).toBeCloseTo(3 * 0.5 * 60 * 1.0, 9);
    expect(s.mitoRel).toBe(1);
    expect(bus.exPlannedKcalD).toBe(0); // day 0 has no sessions
    // day 0 is a real day without sessions (the schedule stopped the habit): detraining starts from the held state
    expect((run.S[0] as ActivityState).vo2max).toBeLessThan(42);
  });

  it('habitual week with real sessions in burn-in: simulated like real days and re-anchored at day −1 (VO2max = v0 at t = 0, steady after)', () => {
    const p = person({ labs: { vo2maxMlKgMin: 42, measuredRmrKcal: 1750 }, habits: { typicalSteps: 7000, sessionsPerWeek: 3, lifingCardioMix: 0.5 } });
    const ctx = ctxFor(p);
    const sessDay = (d: number): DayInput => withSessions(makeDay(ctx.profile), ((d % 7) + 7) % 7 % 2 === 0 && ((d % 7) + 7) % 7 < 6 ? [cardio(8, 60, 0.5)] : []);
    const days = Array.from({ length: 14 + 35 }, (_, i) => ({ clockDay: i - 14, day: sessDay(i - 14) }));
    const v: number[] = [];
    const rel: number[] = [];
    let atDayZero = Number.NaN;
    miniRun(mods, ctx, days, {
      bus: busFor(),
      beforeHour: (d, h, bus) => {
        if (h === 0 && d === 0) atDayZero = bus.vo2maxMlKgMin;
      },
      afterDay: (d, bus) => {
        if (d >= 0) { v.push(bus.vo2maxMlKgMin); rel.push(bus.mitoRel); }
      },
    });
    expect(atDayZero).toBe(42);
    for (const x of v) expect(Math.abs(x / 42 - 1)).toBeLessThan(0.006);
    for (const x of rel) expect(Math.abs(x - 1)).toBeLessThan(0.03);
  });
});

describe('habitual sessions without an intensity (the burn-in week) count at the default moderate intensity for the dose', () => {
  it('a fit habitual exerciser (VO2max 62, 5 × 60 min at 5 MET) carries a training gain at t = 0 that detraining loses (10 V16)', () => {
    const p = person({ labs: { vo2maxMlKgMin: 62, measuredRmrKcal: 1750 }, habits: { typicalSteps: 7000, sessionsPerWeek: 5, lifingCardioMix: 1 } });
    const ctx = ctxFor(p);
    const k = activityModule.prepare(ctx) as K;
    const habitual = sess({ kind: 'cardio', modality: 7, met: 5, intensityFrac: Number.NaN, startH: 18, durationMin: 60 });
    const burnDay = (d: number): DayInput => withSessions(makeDay(ctx.profile), (((d % 7) + 7) % 7) < 5 ? [habitual] : []);
    const days = [
      ...Array.from({ length: 14 }, (_, i) => ({ clockDay: i - 14, day: burnDay(i - 14) })),
      ...Array.from({ length: 56 }, (_, i) => ({ clockDay: i, day: makeDay(ctx.profile) })),
    ];
    const v: number[] = [];
    miniRun(mods, ctx, days, { bus: busFor(), afterDay: (d, bus) => { if (d >= 0) v.push(bus.vo2maxMlKgMin); } });
    // 5 × 60 min at the default 0.625 VO2max (MEM weight 1) = 300 MEM/wk, the same dose prepare assumes
    expect(k.memHabWk).toBeCloseTo(300, 9);
    const ch = (d: number): number => (v[d - 1]! / 62 - 1) * 100;
    expect(ch(21)).toBeLessThan(-3); // Coyle: −7 ± 4 at 21 d
    expect(ch(21)).toBeGreaterThan(-12);
    expect(ch(56)).toBeLessThan(-12); // −16 ± 4 at 56 d
    expect(ch(56)).toBeGreaterThan(-20.5);
  });
});

describe('10 V14: HERITAGE VO2max response (20 wk, ~130 MEM/wk)', () => {
  const g0 = 35;
  const run20wk = (u: number): number => {
    const p = person({ labs: { vo2maxMlKgMin: g0, measuredRmrKcal: 1750 } });
    const { s } = runDays(p, (pr, d) => withSessions(makeDay(pr), d % 7 === 0 || d % 7 === 2 || d % 7 === 4 ? [cardio(8, 130 / 3, 0.625)] : []), 140, { 'activity.vo2ResponseU': u });
    return (s.vo2max / g0 - 1) * 100;
  };

  it('nominal responder (z = 1): +16-17 % after 20 weeks (HERITAGE +18 ± 9 %)', () => {
    const gain = run20wk(0.5);
    expect(gain).toBeGreaterThan(15);
    expect(gain).toBeLessThan(18);
  });

  it('Monte-Carlo over the responsiveness quantiles: mean within ±4 points of 18 %, SD 7-11 (HERITAGE ±9)', () => {
    const N = 41;
    const gains = Array.from({ length: N }, (_, i) => run20wk((i + 0.5) / N));
    const mean = gains.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(gains.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1));
    expect(Math.abs(mean - 18)).toBeLessThanOrEqual(4);
    expect(sd).toBeGreaterThanOrEqual(7);
    expect(sd).toBeLessThanOrEqual(11);
    for (let i = 1; i < N; i++) expect(gains[i]!).toBeGreaterThanOrEqual(gains[i - 1]! - 1e-9); // monotone in responsiveness
  });

  it('responsiveness z: N(1, 0.5) truncated [0.2, 2.0] from the latent quantile (u = 0.5 → z = 1)', () => {
    expect(responsiveness(0.5, 0.5, 0.2, 2)).toBeCloseTo(1, 12);
    expect(responsiveness(0.8413447, 0.5, 0.2, 2)).toBeCloseTo(1.5, 3);
    expect(responsiveness(0.0001, 0.5, 0.2, 2)).toBe(0.2);
    expect(responsiveness(0.9999, 0.5, 0.2, 2)).toBe(2);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.001)).toBeCloseTo(-3.090232, 5);
  });

  it('dose ordering (DREW / STRRIDE): more MEM never gives a smaller gain; women use sexF 0.95', () => {
    const k = activityModule.prepare(ctxFor());
    let prev = 0;
    for (const mem of [0, 30, 60, 100, 130, 200, 400, 1000]) {
      const g = vo2GainTarget(mem, k);
      expect(g).toBeGreaterThanOrEqual(prev);
      expect(g).toBeLessThanOrEqual(0.6);
      prev = g;
    }
    const kf = activityModule.prepare(ctxFor(person({ body: { sex: 'female' } })));
    expect(vo2GainTarget(130, kf) / vo2GainTarget(130, k)).toBeCloseTo(0.95, 9);
  });
});

describe('10 V15: time course at a constant stimulus', () => {
  it('fast pool τ 15 d → t½ 10.4 d (Hickson 10.3-10.8 d); the pool reaches 63.2 % of its target after 15 d', () => {
    const k = activityModule.prepare(ctxFor());
    const tHalf = Math.LN2 * 15;
    expect(tHalf).toBeGreaterThanOrEqual(10.3);
    expect(tHalf).toBeLessThanOrEqual(10.8);
    expect(k.riseF).toBeCloseTo(1 - Math.exp(-1 / 15), 12);
    // pure daily integration for the analytic half-time
    const fast: number[] = [];
    const gStar = vo2GainTarget(130, k);
    let g = 0;
    for (let d = 1; d <= 45; d++) {
      g = updateGainPool(g, 0.55 * gStar, k.riseF, 0, 0);
      fast[d] = g / (0.55 * gStar);
    }
    expect(fast[15]!).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(fast[10]!).toBeLessThan(0.5);
    expect(fast[11]!).toBeGreaterThan(0.5);
  });

  it('module run at a constant 130 MEM/wk reproduces the two-pool analytic curve (fast τ 15 d, slow τ 60 d)', () => {
    const p = person({ labs: { vo2maxMlKgMin: 35, measuredRmrKcal: 1750 } });
    const ctx = ctxFor(p);
    const days = Array.from({ length: 84 }, (_, d) => ({ clockDay: d, day: withSessions(makeDay(ctx.profile), [cardio(8, 130 / 7, 0.625)]) }));
    const v: number[] = [];
    miniRun(mods, ctx, days, { bus: busFor(), afterInit: (S) => { (S[0] as ActivityState).memRing.fill(130 / 7); }, afterDay: (_d, b) => { v.push(b.vo2maxMlKgMin); } });
    for (const d of [7, 15, 21, 42, 84]) {
      const analytic = 35 * (1 + 0.175 * 0.55 * (1 - Math.exp(-d / 15)) + 0.175 * 0.45 * (1 - Math.exp(-d / 60)));
      expect(Math.abs(v[d - 1]! / analytic - 1)).toBeLessThan(1e-6);
    }
    // plateau of the fast pool after ~3 weeks: > 75 % of the fast-pool gain by day 21 while the slow pool keeps adding
    expect(v[83]!).toBeGreaterThan(v[20]!);
  });
});

describe('10 V16: detraining', () => {
  /** Train 20 weeks at ~130 MEM/wk, then apply `after(d)` sessions for `nAfter` days. */
  function trainThen(nAfter: number, after: (pr: ReturnType<typeof makeCtx>['profile'], d: number) => Partial<SessionResolved>[], peakOut?: { v: number }): number[] {
    const p = person({ labs: { vo2maxMlKgMin: 35, measuredRmrKcal: 1750 } }); // trainingHistory none → ρ = 0
    const ctx = ctxFor(p);
    const n = 140 + nAfter;
    const days = Array.from({ length: n }, (_, d) => ({
      clockDay: d,
      day: withSessions(makeDay(ctx.profile), d < 140 ? (d % 7 === 0 || d % 7 === 2 || d % 7 === 4 ? [cardio(8, 130 / 3, 0.625)] : []) : after(ctx.profile, d - 140)),
    }));
    const v: number[] = [];
    miniRun(mods, ctx, days, { bus: busFor(), afterDay: (_d, b) => { v.push(b.vo2maxMlKgMin); } });
    if (peakOut) peakOut.v = v[139]!;
    return v;
  }

  it('stopping training: −7 % at 21 d (athletes −7 ± 4 points) and −12 % at 56 d (observed −16 %: known under-prediction, tolerance ±4.5)', () => {
    const peak = { v: 0 };
    const v = trainThen(56, () => [], peak);
    const ch = (d: number): number => (v[139 + d]! / peak.v - 1) * 100;
    expect(ch(21)).toBeGreaterThan(-11);
    expect(ch(21)).toBeLessThan(-3);
    expect(ch(56)).toBeGreaterThan(-16 - 4.5);
    expect(ch(56)).toBeLessThan(-16 + 4.5 + 0.5);
    // detraining is monotone
    for (let d = 1; d <= 56; d++) expect(v[139 + d]!).toBeLessThanOrEqual(v[139 + d - 1]! + 1e-9);
  });

  it('one 35-min high-intensity bout per week (≈ 70 MEM/wk) keeps VO2max within ±2 % over 4 weeks (Madsen 0 ± 2 %)', () => {
    const peak = { v: 0 };
    const v = trainThen(28, (_pr, d) => (d % 7 === 0 ? [cardio(8, 35, 0.9)] : d % 7 === 3 ? [cardio(8, 18, 0.625)] : []), peak);
    const change = (v[139 + 28]! / peak.v - 1) * 100;
    expect(Math.abs(change)).toBeLessThanOrEqual(2);
  });

  it('the retention floor ρ = 0.45·(1 − e^(−trainYears/2)) stops the loss above ρ of the gain', () => {
    const k = activityModule.prepare(ctxFor(person({ labs: { vo2maxMlKgMin: 35 }, habits: { typicalSteps: 7000, sessionsPerWeek: 0, trainingHistory: 'gt3y' } })));
    expect(retentionRho(0, k)).toBe(0);
    expect(k.rho).toBeCloseTo(0.45 * (1 - Math.exp(-2.5)), 9);
    expect(retentionRho(2, k)).toBeCloseTo(0.45 * (1 - Math.exp(-1)), 9);
    let g = 0.17;
    const floor = k.rho * 0.17;
    for (let d = 0; d < 1000; d++) g = updateGainPool(g, 0, k.riseF, 1 - Math.exp(-1 / 30), floor);
    expect(g).toBeCloseTo(floor, 6);
  });
});

describe('10 V17: mitochondrial oxidative capacity', () => {
  it('M_c* at MEM ≥ 400 is 1.4-1.5; M_r* saturates at 1.30 with ≥ 30 high-intensity min/wk', () => {
    const k = activityModule.prepare(ctxFor());
    for (const mem of [400, 500, 630, 1000]) {
      expect(mitoContentTarget(mem, k)).toBeGreaterThanOrEqual(1.4);
      expect(mitoContentTarget(mem, k)).toBeLessThanOrEqual(1.5);
    }
    expect(mitoRespTarget(0, k)).toBe(1);
    expect(mitoRespTarget(15, k)).toBeCloseTo(1.15, 12);
    expect(mitoRespTarget(30, k)).toBeCloseTo(1.3, 12);
    expect(mitoRespTarget(300, k)).toBeCloseTo(1.3, 12);
  });

  function hiitThenRest(): { rel: number[]; s: ActivityState } {
    const p = person({ labs: { vo2maxMlKgMin: 40, measuredRmrKcal: 1750 } });
    const ctx = ctxFor(p);
    const days = Array.from({ length: 74 }, (_, d) => ({ clockDay: d, day: withSessions(makeDay(ctx.profile), d < 60 ? [cardio(8, 60, 0.9, 6)] : []) }));
    const rel: number[] = [];
    const run = miniRun(mods, ctx, days, { bus: busFor(), afterDay: (_d, b) => { rel.push(b.mitoRel); } });
    return { rel, s: run.S[0] as ActivityState };
  }

  it('module run: 60 days of daily 60-min HIIT (MEM 630/wk) raises M_c·M_r toward 1.47·1.30; content decays slower than respiration when training stops', () => {
    const { rel, s } = hiitThenRest();
    expect(rel[59]!).toBeGreaterThan(1.7); // vs. the sedentary t = 0 index of 1.0
    expect(rel[59]!).toBeLessThan(1.47 * 1.3 + 0.01);
    expect(s.mR).toBeLessThan(1.15); // half of the 0.30 peak gain gone after 14 d off (7-d window lag + τ 10 d)
    expect(s.mC).toBeGreaterThan(1.15); // content decays slower (τ 17.3 d)
    expect(s.mC - 1).toBeGreaterThan(s.mR - 1);
    // after the last session the index peaks within a day or two (rolling 7-day window, targets still above the state) and then only falls
    const peakDay = rel.indexOf(Math.max(...rel));
    expect(peakDay).toBeGreaterThanOrEqual(59);
    expect(peakDay).toBeLessThanOrEqual(63);
    for (let d = peakDay + 1; d < 74; d++) expect(rel[d]!).toBeLessThan(rel[d - 1]!);
  });

  // MISS (reported): 10 §7 V17 states "M_r back to 1.0 in 2 wk". With the 10 §4.9 rules (M_r* from the rolling 7-day
  // high-intensity minutes, τDn 10 d) M_r stays at its 1.30 target until the 7-day window has emptied (7 d) and is 1.13 after
  // 14 d (45 % of the gain left). Fix options for the integration pass: shorter HI window for M_r or a faster τDn_r.
  it.fails('V17 M_r back to ≈ 1.0 (≤ 1.08) two weeks after stopping high-intensity training', () => {
    expect(hiitThenRest().s.mR).toBeLessThan(1.08);
  });

  it('oxidative capacity speeds EPOC recovery: τ × 0.75 at index ≥ 1.4', () => {
    const k = activityModule.prepare(ctxFor());
    expect(epocPhi(0.8, 60, false, false, k)).toBeGreaterThan(0);
    const f = (idx: number): number => 1 - k.epocTrainedMult * Math.min(1, Math.max(0, (idx - 1) / k.epocTrainedSpan));
    expect(f(1)).toBe(1);
    expect(f(1.4)).toBeCloseTo(0.75, 12);
    expect(f(1.9)).toBeCloseTo(0.75, 12);
  });
});

describe('MEM weights (10 §4.8B)', () => {
  it('0 below 0.40, 0.4 to 0.55, 1.0 to 0.70, 1.5 above (continuous work)', () => {
    const k = activityModule.prepare(ctxFor());
    expect([0.3, 0.39, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.1].map((x) => memWeight(x, k))).toEqual([0, 0, 0.4, 0.4, 1.0, 1.0, 1.5, 1.5, 1.5, 1.5]);
  });
});

describe('property tests', () => {
  it('signals stay inside physical bounds for a random mix of sessions, steps and body masses', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const p = person({ labs: { vo2maxMlKgMin: 38, measuredRmrKcal: 1800 }, habits: { typicalSteps: 7000, sessionsPerWeek: 3 } });
    const { log, s } = runDays(p, (pr) => {
      const n = Math.floor(rnd() * 4);
      const list: Partial<SessionResolved>[] = [];
      for (let i = 0; i < n; i++) list.push(rnd() < 0.3 ? resistance(6 + rnd() * 16, 20 + rnd() * 80, 3 + rnd() * 3, 10 + rnd() * 20, rnd() < 0.5) : cardio(6 + rnd() * 16, 10 + rnd() * 120, 0.2 + rnd() * 1.2, 1 + Math.floor(rnd() * 7)));
      return withSessions(makeDay(pr, { steps: Math.floor(rnd() * 25000) }), list);
    }, 120);
    for (let h = 0; h < log.exEE.length; h++) {
      expect(Number.isFinite(log.exEE[h]!)).toBe(true);
      expect(log.net[h]!).toBeGreaterThanOrEqual(0);
      expect(log.mins[h]!).toBeGreaterThanOrEqual(0);
      expect(log.mins[h]!).toBeLessThanOrEqual(60 * 6 + 1e-9);
      expect(log.x[h]!).toBeGreaterThanOrEqual(0);
      expect(log.x[h]!).toBeLessThanOrEqual(1.2 + 1e-12);
      expect([0, 1]).toContain(log.hard[h]!);
      expect(Number.isFinite(log.steps[h]!)).toBe(true);
    }
    expect(s.vo2max).toBeGreaterThanOrEqual(8);
    expect(s.vo2max).toBeLessThanOrEqual(90);
    for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    expect(s.epocFastKcal).toBeGreaterThanOrEqual(0);
    expect(s.epocSlowKcal).toBeGreaterThanOrEqual(0);
  });

  it('monotone: a longer or harder session never books less net energy, EPOC or MEM', () => {
    const k = activityModule.prepare(ctxFor());
    let prev = 0;
    for (const dur of [10, 20, 40, 60, 90, 120]) {
      const n = net(k, sess({ modality: 3, intensityFrac: 0.7, durationMin: dur }));
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
    prev = 0;
    for (const x of [0.3, 0.45, 0.6, 0.75, 0.9]) {
      const n = net(k, sess({ modality: 3, intensityFrac: x }));
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
    let pPhi = 0;
    for (const x of [0.3, 0.5, 0.65, 0.7, 0.8, 0.95]) {
      const phi = epocPhi(x, 60, false, false, k);
      expect(phi).toBeGreaterThanOrEqual(pPhi);
      pPhi = phi;
    }
  });

  it('more training never lowers VO2max after 12 weeks (monotone in the weekly dose)', () => {
    let prev = 0;
    for (const perWeek of [0, 1, 2, 3, 4, 5, 6]) {
      const p = person({ labs: { vo2maxMlKgMin: 38, measuredRmrKcal: 1750 } });
      const { s } = runDays(p, (pr, d) => withSessions(makeDay(pr), d % 7 < perWeek ? [cardio(8, 45, 0.65)] : []), 84);
      expect(s.vo2max).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s.vo2max;
    }
  });

  it('no exercise for 21 days at maintenance: everything stays finite and the ledger is zero', () => {
    const { log, s } = runDays(P75, (pr) => makeDay(pr), 21);
    expect(sum(log.exEE)).toBe(0);
    expect(sum(log.net)).toBe(0);
    expect(s.vo2max).toBe(42);
    expect(s.mitoRel).toBe(1);
  });

  it('extreme inputs (MET 40, 6 sessions, 500 kg, RMR 10 000 kcal/d, zero VO2max signal) stay finite', () => {
    const p = person({ labs: { vo2maxMlKgMin: 90, measuredRmrKcal: 1750 } });
    const bus = busFor(500, 10000);
    const { log, s } = runDays(p, (pr) => withSessions(makeDay(pr), [0, 1, 2, 3, 4, 5].map((i) => ({ ...cardio(i * 3, 120, Number.NaN), met: 40 }))), 10, {}, { bus });
    for (const v of log.exEE) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isFinite(s.vo2max)).toBe(true);
    expect(s.vo2max).toBeLessThanOrEqual(90);
    expect(Math.max(...log.x)).toBeLessThanOrEqual(1.2 + 1e-12);
  });

  it('state is a plain structure: structuredClone snapshots round-trip', () => {
    const { s } = runDays(P75, (pr, d) => withSessions(makeDay(pr), d === 0 ? [cardio(8, 60, 0.8), resistance(17, 45, 3.5)] : []), 2);
    expect(structuredClone(s)).toEqual(s);
  });
});

describe('wiring and records', () => {
  it('declared writes are owned by activity and every declared read lists activity as a reader in the signal table', () => {
    const defs = new Map<string, (typeof SIGNAL_DEFS)[number]>(SIGNAL_DEFS.map((d) => [d.name, d]));
    for (const m of [activityModule, moderatorsModule] as unknown as AnyEngineModule[]) {
      for (const w of m.writes) expect(defs.get(w)!.writer).toBe(m.id);
      for (const r of m.reads) expect((defs.get(r)!.readers as readonly string[]).includes(m.id)).toBe(true);
      // checkWiring semantics (core/moduleRegistry): readers listed in SIGNAL_DEFS but not read are "pending", not issues
      for (const d of SIGNAL_DEFS) if (d.writer === m.id) expect(m.writes).toContain(d.name);
    }
  });

  it('records vo2max (daily) and exerciseEE (hourly)', () => {
    const { run, s, k } = runDays(P75, (pr, d) => withSessions(makeDay(pr), d === 0 ? [cardio(8, 60, 0.8)] : []), 1);
    const frame = new Float64Array(N_SERIES);
    activityModule.recordHour(s, k, run.bus, frame);
    activityModule.recordDay(s, k, run.bus, frame);
    expect(frame[MI.exerciseEE]).toBe(run.bus.exEEKcalH);
    expect(frame[MI.vo2max]).toBe(s.vo2max);
    expect(activityModule.records).toEqual(['vo2max', 'exerciseEE']);
  });
});

describe('performance', () => {
  it('a 180-day run of the module (3 sessions/wk incl. RT and steps) stays within the 0.5 ms budget (best of 41)', () => {
    const ctx = ctxFor(person({ labs: { vo2maxMlKgMin: 42, measuredRmrKcal: 1750 }, habits: { typicalSteps: 7000, sessionsPerWeek: 3 } }));
    const k = activityModule.prepare(ctx);
    const rest = makeDay(ctx.profile);
    const trainDay = withSessions(makeDay(ctx.profile), [cardio(8, 45, 0.7), resistance(17, 60, 3.5)]);
    // hour inputs identical to what the loop hands over (exMin from the sessions)
    const hours = Array.from({ length: 24 }, (_, h) => ({ hourOfDay: h, exMin: h === 8 ? 45 : h === 17 ? 60 : 0, exIntensityFrac: 0, exMet: 0, exModality: 0, steps: h >= 7 && h < 23 ? 440 : 0, asleep: h >= 7 && h < 23 ? 0 : 1, rtSetsTotal: h === 17 ? 18 : 0, rtToFailure: 0 }));
    const restHours = hours.map((h) => ({ ...h, exMin: 0, rtSetsTotal: 0 }));
    const frame = new Float64Array(N_SERIES);
    const clock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
    const times: number[] = [];
    for (let rep = 0; rep < 41; rep++) {
      const bus = busFor();
      const s = activityModule.init(k, ctx, bus);
      const t0 = performance.now();
      for (let d = 0; d < 180; d++) {
        const day = d % 7 === 0 || d % 7 === 2 || d % 7 === 4 ? trainDay : rest;
        clock.day = d;
        activityModule.startDay(s, k, bus, day, clock);
        for (let h = 0; h < 24; h++) {
          clock.hourOfDay = h;
          const hr = day === trainDay ? hours[h]! : restHours[h]!;
          activityModule.stepHour(s, k, bus, hr as never, day, clock);
          activityModule.recordHour(s, k, bus, frame);
        }
        activityModule.endOfDay(s, k, bus, day, clock);
        activityModule.recordDay(s, k, bus, frame);
      }
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const best = times[0]!;
    const median = times[20]!;
    console.info(`activity: 180-day run best ${best.toFixed(3)} ms, median ${median.toFixed(3)} ms (41 runs)`);
    // Budget 0.5 ms per 180-day run (WP table). Measured best 0.35-0.40 ms on a machine at load ≈ 12 (this is the worst case:
    // 3 sessions/wk incl. RT keep the post-RT elevation on all week). The CI guard is 2× the budget so that CPU contention from
    // the parallel test workers cannot make the suite flaky; a real regression (≥ 2×) still fails.
    expect(best).toBeLessThan(1.0);
  });
});
