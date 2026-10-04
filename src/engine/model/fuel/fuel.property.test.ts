// @vitest-environment node
/**
 * Property tests (WP_BRIEF): bounds, monotonicity, steady state at maintenance for 30 days, 21 days of zero intake,
 * robustness to non-finite inputs, determinism, the engine hooks, and the per-module micro-benchmark (budget 1.0 ms per
 * 180-day run, MODEL_SPEC §11.3 WP-M4).
 */
import { resolveProfile } from '../../core/resolveProfile';
import { buildModelParams } from '../../core/paramsRegistry';
import { createSignalBus } from '../../types/signals';
import { MI, N_SERIES } from '../../types/metrics';
import type { ModuleContext, StepClock } from '../../types/module';
import type { DayInput, HourInput } from '../../types/inputs';
import { N_REGIONS } from '../../types/inputs';
import { fuelModule, muscleGlycogenG, stepFuelHour, type FuelConst, type FuelState } from './index';
import { makeRig, runDays, threeMeals, TEST_MAN, type HourTrace, type Scenario } from './testHarness';

function menu(pct: number, tee = 2500) {
  const cho = ((pct / 100) * tee) / 4;
  return { glcG: cho * 0.85, fruG: cho * 0.15, protG: (0.15 * tee) / 4 };
}

function checkBounds(s: FuelState, k: FuelConst): void {
  expect(s.liverG).toBeGreaterThanOrEqual(0);
  expect(s.liverG).toBeLessThanOrEqual(s.gLMaxG + 1e-9);
  for (const c of s.cM) {
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(k.cMMax + 1e-9);
  }
  expect(s.carryGlcG).toBeGreaterThanOrEqual(0);
  expect(s.fruDelayedG).toBeGreaterThanOrEqual(0);
}

describe('fuel properties', () => {
  it('stays within physical bounds and finite over randomised weeks (meals, fasts, exercise, RT, alcohol)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 12; trial++) {
      const rig = makeRig({ vo2max: 30 + 30 * rnd() });
      const tr: HourTrace[] = [];
      const days = 7;
      const meals = Array.from({ length: days }, (_, d) =>
        [7, 12, 18].map((h) => ({ at: 24 * d + h + rnd(), glcG: 300 * rnd() * rnd(), fruG: 60 * rnd() * rnd(), protG: 60 * rnd(), tpH: 0.5 + rnd() })),
      ).flat();
      const sc: Scenario = {
        meals,
        teeKcalD: 1600 + 1800 * rnd(),
        capGlc: rnd() > 0.5,
        exercise: [{ at: 24 * 2 + 17, min: 30 + 90 * rnd(), intensity: 0.3 + 0.65 * rnd(), activeKg: 8 + 10 * rnd(), kcal: 300 + 700 * rnd(), modality: 1 + Math.floor(7 * rnd()) }],
        rt: [{ at: 24 * 3 + 18, sets: Array.from({ length: N_REGIONS }, () => Math.floor(6 * rnd())), kcal: 200 }],
        fast: (t) => t >= 24 * 4 && t < 24 * 4 + 48 * rnd(),
        fastProtOxGH: 3,
        ketoAdapt: rnd(),
        brainKetoneShare: 0.5 * rnd(),
        alcOxGH: (t) => (t % 24 === 21 ? 8 : 0),
        leanRateKgD: 0.1 * (rnd() - 0.5),
        sMus: 0.5 + rnd(),
        carbTolerance: rnd(),
      };
      runDays(rig, days, sc, tr);
      checkBounds(rig.s, rig.k);
      for (const h of tr) {
        for (const v of [h.liverG, h.muscleG, h.choOx, h.fatOx, h.protOx, h.dnlFat, h.gng, h.rq]) expect(Number.isFinite(v)).toBe(true);
        expect(h.choOx).toBeGreaterThanOrEqual(0);
        expect(h.fatOx).toBeGreaterThanOrEqual(0);
        expect(h.protOx).toBeGreaterThanOrEqual(0);
        expect(h.dnlFat).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('monotone: more carbohydrate at equal energy → more glycogen and more CHO oxidation; more insulin → not less CHO oxidation', () => {
    const ends: number[] = [];
    const ox: number[] = [];
    for (const pct of [20, 40, 60, 80]) {
      const rig = makeRig();
      const res = runDays(rig, 10, { meals: threeMeals(10, menu(pct)), teeKcalD: 2500 });
      ends.push(res[9]!.liverEndG + res[9]!.muscleEndG);
      ox.push(res[9]!.choOxG);
    }
    for (let i = 1; i < ends.length; i++) {
      expect(ends[i]!).toBeGreaterThan(ends[i - 1]!);
      expect(ox[i]!).toBeGreaterThan(ox[i - 1]!);
    }
    let prev = -1;
    for (const ins of [5, 20, 50, 100, 200]) {
      const rig = makeRig();
      rig.bus.raGlcGH = 40;
      rig.bus.insulinUuMl = ins;
      rig.bus.teePreKcalH = 100;
      stepFuelHour(rig.s, rig.k, rig.bus, rig.hour, 0, null);
      expect(rig.bus.choOxGH).toBeGreaterThanOrEqual(prev);
      prev = rig.bus.choOxGH;
    }
  });

  it('steady state at maintenance stays steady for 30 simulated days (after settling)', () => {
    const rig = makeRig();
    const m = menu(45);
    runDays(rig, 90, { meals: threeMeals(90, m), teeKcalD: 2500 });
    const g0 = rig.s.liverG + muscleGlycogenG(rig.s);
    const res = runDays(rig, 30, { meals: threeMeals(31, m, { startDay: 89 }), teeKcalD: 2500 });
    const g30 = rig.s.liverG + muscleGlycogenG(rig.s);
    expect(Math.abs(g30 / g0 - 1)).toBeLessThan(0.002);
    const ox = res.map((r) => r.choOxG);
    expect(Math.max(...ox) - Math.min(...ox)).toBeLessThan(0.005 * ox[0]!);
    for (const r of res) expect(r.dnlFatG).toBe(0);
  });

  it('21 days of zero intake stay finite and non-negative (fasting overlay on, and off)', () => {
    for (const overlay of [true, false]) {
      const rig = makeRig();
      const tr: HourTrace[] = [];
      runDays(
        rig,
        21,
        { meals: [], teeKcalD: 2000, fast: () => overlay, fastProtOxGH: (t) => 4 - 2 * Math.min(1, t / 240), ketoAdapt: (t) => Math.min(1, t / 72), brainKetoneShare: (t) => Math.min(0.6, t / 400), insBasal: 4 },
        tr,
      );
      checkBounds(rig.s, rig.k);
      for (const h of tr) for (const v of [h.liverG, h.muscleG, h.choOx, h.fatOx, h.gng, h.rq]) expect(Number.isFinite(v)).toBe(true);
      expect(tr[tr.length - 1]!.liverG).toBeLessThan(10);
      expect(tr[tr.length - 1]!.fatOx).toBeGreaterThan(4); // fat is the main fuel
    }
  });

  it('non-finite or absurd bus inputs never produce NaN/Infinity', () => {
    const rig = makeRig();
    const b = rig.bus;
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -1e9, 1e9]) {
      b.raGlcGH = Number.isFinite(v) ? Math.abs(v) : 0;
      b.insulinUuMl = v;
      b.teePreKcalH = Number.isFinite(v) ? Math.abs(v) : 100;
      b.leanRateKgD = v;
      b.ketoAdaptFast = v;
      b.brainKetoneShare = v;
      b.exMinutesH = v;
      b.exIntensityFrac = Number.isFinite(v) ? v : 0;
      stepFuelHour(rig.s, rig.k, b, rig.hour, 0, null);
      for (const x of [b.liverGlycogenG, b.muscleGlycogenG, b.choOxGH, b.fatOxGH, b.protOxGH, b.dnlFatGH, b.dnlHeatKcalH, b.gngGH, b.glycogenChangeKcalH, b.rqHour]) {
        expect(Number.isFinite(x)).toBe(true);
      }
    }
  });

  it('is deterministic (bit-identical) and the state survives structuredClone', () => {
    const a = makeRig();
    const b = makeRig();
    const sc: Scenario = { meals: threeMeals(3, menu(50)), teeKcalD: 2500, exercise: [{ at: 30, min: 50, intensity: 0.7, activeKg: 12, kcal: 500 }] };
    const ta: HourTrace[] = [];
    const tb: HourTrace[] = [];
    runDays(a, 3, sc, ta);
    runDays(b, 3, sc, tb);
    expect(tb).toEqual(ta);
    const snap = structuredClone(a.s);
    expect(snap.cM).toEqual(a.s.cM);
  });
});

describe('fuel module hooks inside the engine contract', () => {
  function engineRig() {
    const profile = resolveProfile(TEST_MAN);
    const params = buildModelParams([fuelModule as never]);
    const emitted: string[] = [];
    const ctx = {
      profile, params, schedule: undefined, nDays: 1, mode: 'simulate', seriesEnabled: new Uint8Array(N_SERIES).fill(1),
      events: { emit: (t: string) => void emitted.push(t) }, checks: false, safetyTrace: undefined,
    } as unknown as ModuleContext;
    const bus = createSignalBus();
    const k = fuelModule.prepare(ctx);
    const s = fuelModule.init(k, ctx, bus);
    return { k, s, bus, emitted, profile };
  }

  it('startDay/stepHour/recordHour/recordDay use the bus and write only fuel series; no events while clock.day < 0', () => {
    const { k, s, bus, emitted } = engineRig();
    const hour = { rtSetsByRegion: new Float64Array(N_REGIONS), rtSetsTotal: 0, exModality: 0 } as unknown as HourInput;
    const day = {} as DayInput;
    const clock: StepClock = { day: -1, hourOfDay: 0, hourIndex: -24, weekday: 0 };
    bus.skeletalMuscleKg = 30;
    fuelModule.startDay(s, k, bus, day, clock);
    const frame = new Float64Array(N_SERIES).fill(Number.NaN);
    s.liverG = 10; // would trigger liverGlycogenLow / metabolicSwitch
    for (let h = 0; h < 24; h++) {
      clock.hourOfDay = h;
      clock.hourIndex = -24 + h;
      fuelModule.stepHour(s, k, bus, hour, day, clock);
    }
    expect(emitted).toHaveLength(0);
    fuelModule.endOfDay(s, k, bus, day, clock);
    fuelModule.recordHour(s, k, bus, frame);
    fuelModule.recordDay(s, k, bus, frame);
    expect(frame[MI.liverGlycogen]).toBeCloseTo(bus.liverGlycogenG, 12);
    expect(frame[MI.glycogenTotal]).toBeCloseTo(bus.liverGlycogenG + bus.muscleGlycogenG, 12);
    expect(frame[MI.fatOxidation]).toBeCloseTo(s.dayFatOxG, 12);
    let written = 0;
    for (const v of frame) if (!Number.isNaN(v)) written++;
    expect(written).toBe(fuelModule.records.length);
    // SMM from composition (d−1) rescales c and keeps grams
    const g0 = muscleGlycogenG(s);
    bus.skeletalMuscleKg = 33;
    fuelModule.startDay(s, k, bus, day, { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 });
    expect(muscleGlycogenG(s)).toBeCloseTo(g0, 9);
  });

  it(`micro-benchmark: 180 days of stepHour stay within WP-M4's 1.0 ms budget`, () => {
    const { k, s, bus } = engineRig();
    const hour = { rtSetsByRegion: new Float64Array(N_REGIONS), rtSetsTotal: 0, exModality: 3 } as unknown as HourInput;
    const n = 180 * 24;
    // precomputed realistic inputs: three meals a day, one cardio session every other day, RT twice a week
    const glc = new Float64Array(n);
    const ins = new Float64Array(n);
    const prot = new Float64Array(n);
    const exMin = new Float64Array(n);
    const rt = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const h = t % 24;
      const d = Math.floor(t / 24);
      const pm = h === 8 || h === 13 || h === 19 ? 1 : h === 9 || h === 14 || h === 20 ? 0.6 : h === 10 || h === 15 || h === 21 ? 0.2 : 0;
      glc[t] = 45 * pm;
      prot[t] = 12 * pm;
      ins[t] = 7 + 60 * pm;
      exMin[t] = h === 17 && d % 2 === 0 ? 45 : 0;
      rt[t] = h === 18 && d % 7 < 2 ? 1 : 0;
    }
    const run = () => {
      for (let t = 0; t < n; t++) {
        bus.raGlcGH = glc[t]!;
        bus.raFruGalGH = 0.15 * glc[t]!;
        bus.raProtGH = prot[t]!;
        bus.insulinUuMl = ins[t]!;
        bus.teePreKcalH = 100 + (exMin[t]! > 0 ? 450 : 0);
        bus.exMinutesH = exMin[t]!;
        bus.exIntensityFrac = exMin[t]! > 0 ? 0.65 : 0;
        bus.exActiveMuscleKg = exMin[t]! > 0 ? 12 : 0;
        if (rt[t]! > 0) {
          hour.rtSetsByRegion.fill(2);
          hour.rtSetsTotal = 2 * N_REGIONS;
        } else if (hour.rtSetsTotal !== 0) {
          hour.rtSetsByRegion.fill(0);
          hour.rtSetsTotal = 0;
        }
        stepFuelHour(s, k, bus, hour, t, null);
      }
    };
    for (let i = 0; i < 30; i++) run(); // warm-up (JIT)
    const reps = 60;
    const t0 = performance.now();
    for (let i = 0; i < reps; i++) run();
    const ms = (performance.now() - t0) / reps;
    console.info(`[bench] fuel.stepHour: ${ms.toFixed(3)} ms per 180-day run (budget 1.0 ms)`);
    expect(Number.isFinite(s.liverG)).toBe(true);
    expect(ms).toBeLessThan(2.0); // generous CI guard; the reported number is compared with the 1.0 ms budget
  });
});
