// @vitest-environment node
/**
 * Unit, numerical (O-10), property and performance tests of the ketones module (MODEL_SPEC §1.7, §9.1 O-6/O-7/O-10).
 * The module is driven directly with hand-built bus values (WP_BRIEF); `ketones.validation.test.ts` holds the dossier
 * targets.
 */
import { checkWiring } from '../../core/moduleRegistry';
import { validateParamDefs } from '../../core/paramsRegistry';
import { createSignalBus } from '../../types/signals';
import { MI, N_SERIES } from '../../types/metrics';
import type { AnyEngineModule, EventSink } from '../../types/module';
import {
  ketonesModule, prepareKetones, initKetones, stepKetones, bhbFromTkb, lipoOf, phiOf, linearisedStep, categoryOf,
  N_SUB, type KetonesState,
} from './index';
import { KETONES_PARAMS } from './params';
import { makeContext, hourlyFromReference, referenceHourly, runModule, type HourlyInputs, type RecordedEvent } from './testing/harness';
import { runReference05, type RefMeal, type RefScenario } from './testing/reference05';
import { simulateScenario } from './testing/sim';
import { measureUnderLoad } from '../../testing/benchLoad';
import { BODY, BURN_IN_DAYS, dietScenario, fastScenario, habitual, mealsOfDay, mealsOfDays } from './testing/scenarios';

const MODS = [ketonesModule] as unknown as readonly AnyEngineModule[];
const T0 = 19;

/** A context + constants + state + bus for direct stepping. */
function rig(opts: { bw?: number; ffm?: number; habitualCarbG?: number; habitualProteinG?: number } = {}) {
  const events: RecordedEvent[] = [];
  const sink: EventSink = { emit: (type, hour, value) => void events.push({ type, hour, value }) };
  const bw = opts.bw ?? 75;
  const ffm = opts.ffm ?? 60;
  const ctx = makeContext({ habitualProteinG: opts.habitualProteinG ?? 90, habitualCarbG: opts.habitualCarbG ?? 300 }, bw, ffm, sink);
  const k = prepareKetones(ctx);
  const bus = createSignalBus();
  bus.tissueMassKg = bw;
  bus.ffmActKg = ffm;
  bus.tdeeEstKcalD = 2500;
  bus.kcalEaten24 = 2500;
  bus.carbAbs24G = 300;
  bus.liverGlycogenG = 80;
  bus.insulinRefRel = 1;
  const s = initKetones(k, ctx, bus);
  const step = (n = 1, hour = 0, meal = 0, mealG = 0, exoG = 0): void => {
    for (let i = 0; i < n; i++) stepKetones(s, k, bus, meal, mealG, exoG, hour + i, sink);
  };
  return { ctx, k, bus, s, step, events };
}

// ------------------------------------------------------------------------------------------------ contract
describe('contract', () => {
  it('parameters validate and every constant is registered under the module prefix', () => {
    expect(validateParamDefs(MODS)).toEqual([]);
    expect(KETONES_PARAMS.length).toBeGreaterThan(60);
    for (const p of KETONES_PARAMS) expect(p.id.startsWith('ketones.')).toBe(true);
  });

  it('wiring: writes and reads match the signal table (checkWiring restricted to ketones)', () => {
    const { issues } = checkWiring(MODS);
    expect(issues.filter((i) => i.module === 'ketones')).toEqual([]);
  });

  it('G50 = g50Frac × G_L,max with 04 §4.1 capacity (500 mmol/L × 1.45 L × 0.162 g/mmol) when fuel params are absent', () => {
    const { k } = rig();
    expect(k.gLMaxG).toBeCloseTo(117.45, 2);
    expect(k.g50G).toBeCloseTo(0.55 * 117.45, 2);
  });

  it('init: 05 §4.17 initial state, A_f = 1 below 50 g/d habitual carbohydrate, bus written', () => {
    const a = rig({ habitualCarbG: 300, habitualProteinG: 110 });
    expect(a.s.tkb).toBe(0.25);
    expect(a.s.ffa).toBe(0.5);
    expect(a.s.aF).toBe(0);
    expect(a.s.pEw).toBe(110);
    expect(a.bus.tkbMmolL).toBe(0.25);
    expect(a.bus.bhbMmolL).toBeCloseTo(bhbFromTkb(a.k, 0.25), 12);
    expect(rig({ habitualCarbG: 30 }).s.aF).toBe(1);
  });

  it('records: bhb and ketosisState hourly; hoursInKetosis, the keto-adaptation index 50·(A_f + A_s) and both components daily', () => {
    const r = rig();
    const out = new Float64Array(N_SERIES).fill(Number.NaN);
    r.s.hoursInKetosisToday = 5;
    r.s.aF = 0.4;
    r.s.aS = 0.1;
    ketonesModule.recordHour(r.s, r.k, r.bus, out);
    ketonesModule.recordDay(r.s, r.k, r.bus, out);
    expect(out[MI.bhb]).toBe(r.s.bhb);
    expect(out[MI.ketosisState]).toBe(r.s.state);
    expect(out[MI.hoursInKetosis]).toBe(5);
    expect(out[MI.ketoAdaptation]).toBeCloseTo(25, 12);
    expect(out[MI.ketoAdaptFast]).toBeCloseTo(40, 12);
    expect(out[MI.ketoAdaptSlow]).toBeCloseTo(10, 12);
    ketonesModule.startDay(r.s, r.k, r.bus, {} as never, {} as never);
    expect(r.s.hoursInKetosisToday).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ equations
describe('equations against dossier worked numbers', () => {
  it('lipo(I) = 1 at I = 1, 0.18 at I = 5, 1.8 at I = 0.47 (05 §4.3)', () => {
    const { k } = rig();
    expect(lipoOf(k, 1)).toBeCloseTo(1, 12);
    expect(lipoOf(k, 5)).toBeCloseTo(0.18, 2);
    expect(lipoOf(k, 0.47)).toBeCloseTo(1.8, 1);
  });

  it('BHB:AcAc R = 1.5 + 0.3·TKB reproduces Owen & Reichard 1971 (3 d 2.233 of TKB 3.06; 24 d 5.291 of TKB 6.8) (05 §4.5)', () => {
    const { k } = rig();
    expect(Math.abs(bhbFromTkb(k, 6.8) / 5.291 - 1)).toBeLessThan(0.01);
    expect(Math.abs(bhbFromTkb(k, 3.06) / 2.233 - 1)).toBeLessThan(0.05);
    expect(Math.abs(bhbFromTkb(k, 0.291) / 0.185 - 1)).toBeLessThan(0.05);
  });

  it('clearance half-life at low TKB ≈ 20-25 min for the obese reference subject (2.9 %/min, Owen 1973; 05 §4.1)', () => {
    const { k } = rig();
    const tHalf = (Math.LN2 * k.vdPerBW * 110) / (k.clFFM * 60);
    expect(tHalf).toBeGreaterThan(20);
    expect(tHalf).toBeLessThan(25);
  });

  it('Balasse 1979 plateau: at TKB 7.09 with A_s = 1 uptake + urine ≈ production 1.908 mmol/min; urine 167 µmol/min', () => {
    const { k } = rig();
    const bw = 110;
    const vmax = k.clFFM * 60 * k.km;
    const u = ((vmax * 7.09) / (k.km + 7.09)) * (1 - k.aM);
    const ren = k.renal * bw * (7.09 - k.tThr);
    expect(Math.abs(ren / 0.167 - 1)).toBeLessThan(0.02);
    expect(Math.abs((u + ren) / 1.908 - 1)).toBeLessThan(0.05);
  });

  it('partition φ: φ_min at glycogen repletion, 1 at empty liver, half-way at G50; adaptation gains (05 §4.2)', () => {
    const { k } = rig();
    expect(phiOf(k, 0, 0, 0)).toBeCloseTo(1, 12);
    expect(phiOf(k, k.g50G, 0, 0)).toBeCloseTo(k.phiMin + (1 - k.phiMin) / 2, 12);
    expect(phiOf(k, 1e6, 0, 0)).toBeCloseTo(k.phiMin, 6);
    expect(phiOf(k, 0, 1, 1)).toBeCloseTo(1.35 * 1.5, 12);
    expect(phiOf(k, 40, 0, 0)).toBeGreaterThan(phiOf(k, 60, 0, 0)); // monotone in liver glycogen
  });

  it('A_f time constants: 92 % at 5 d building, 55 % left after 24 h and 5 % after 5 d of carbohydrate (05 §4.11.1)', () => {
    const r = rig();
    r.bus.carbAbs24G = 0;
    r.step(120);
    expect(r.s.aF).toBeCloseTo(1 - Math.exp(-120 / 48), 3);
    const a0 = r.s.aF;
    r.bus.carbAbs24G = 1e4;
    r.step(24);
    expect(r.s.aF / a0).toBeCloseTo(Math.exp(-24 / 40), 3);
    r.step(96);
    expect(r.s.aF / a0).toBeCloseTo(Math.exp(-120 / 40), 3);
  });

  it('A_s* = clamp((TKB − 0.5)/2) relaxes with τ 120 h (05 §4.11.2)', () => {
    const r = rig();
    r.s.tkb = 2.5; // A_s* = 1 at the first hour
    r.bus.carbAbs24G = 0;
    r.step(1);
    expect(r.s.aS).toBeCloseTo(1 - Math.exp(-1 / 120), 6);
  });

  it('protein brake π = exp(−0.15·P_ew/90): 90 g/d cuts endogenous production by 14 % (05 §4.2)', () => {
    const prod = (raProt: number): number => {
      const r = rig();
      r.k.kFB = 1e12; // isolate π from the TKB → FFA feedback
      r.bus.raProtGH = raProt;
      r.step(200); // P_ew → 24·raProt, other states steady
      return r.s.prodMmolMin;
    };
    expect(prod(90 / 24) / prod(0)).toBeCloseTo(Math.exp(-0.15), 3);
  });

  it('MCT: 1 g/h C8 adds 0.5·6.37/60 mmol/min, halved within 3 h of a > 50-g meal (05 §4.12)', () => {
    const base = rig();
    base.step(3);
    const p0 = base.s.prodMmolMin;
    const a = rig();
    a.k.mctC8Share = 1;
    a.step(2);
    a.bus.raMctGH = 1;
    a.step(1, 2);
    expect(a.s.prodMmolMin - p0).toBeCloseTo((0.5 * 6.37) / 60, 6);
    const b = rig();
    b.k.mctC8Share = 1;
    b.step(1, 0, 1, 80); // big meal
    b.step(1, 1);
    b.bus.raMctGH = 1;
    b.step(1, 2);
    expect(b.s.prodMmolMin - p0).toBeCloseTo((0.5 * 0.5 * 6.37) / 60, 6);
  });

  it('ethanol present halves endogenous ketogenesis (15 §4.10 assumption)', () => {
    const a = rig();
    a.step(1);
    const b = rig();
    b.bus.etohPoolG = 10;
    b.step(1);
    expect(b.s.prodMmolMin / a.s.prodMmolMin).toBeCloseTo(0.5, 12);
  });

  it('urinary ketone energy = 0.46 kcal/mmol × renal loss; brain share = 0.70·T/(T + 1.5) (05 §4.11.3, §6)', () => {
    const r = rig();
    r.s.tkb = 4;
    r.bus.carbAbs24G = 0;
    r.bus.kcalEaten24 = 0;
    r.bus.liverGlycogenG = 0;
    r.step(1);
    expect(r.bus.ketoneLossKcalH).toBeCloseTo(0.46 * r.s.renalMmolH, 12);
    expect(r.s.renalMmolH).toBeGreaterThan(0);
    expect(r.bus.brainKetoneShare).toBeCloseTo((0.7 * r.bus.tkbMmolL) / (r.bus.tkbMmolL + 1.5), 12);
  });

  it('ketosis categories (05 §6): none < 0.2 ≤ light < 0.5 ≤ nutritional ≤ 3.0 < warning (fed) / fasting (no intake) ≤ 6 < warning', () => {
    const { k } = rig();
    expect(categoryOf(k, 0.1, false)).toBe(0);
    expect(categoryOf(k, 0.3, false)).toBe(1);
    expect(categoryOf(k, 1.0, false)).toBe(2);
    expect(categoryOf(k, 3.0, false)).toBe(2);
    expect(categoryOf(k, 3.5, false)).toBe(4);
    expect(categoryOf(k, 3.5, true)).toBe(3);
    expect(categoryOf(k, 6.5, true)).toBe(4);
  });

  it('exogenous D-BHB is excluded from bhbEndoMmolL (08 rule) and decays with the pool', () => {
    const r = rig();
    r.step(6);
    const pre = r.bus.bhbEndoMmolL;
    r.bus.exoKetoneMmolH = 140;
    r.step(1, 6, 0, 0, 25);
    expect(r.bus.bhbMmolL).toBeGreaterThan(1);
    expect(Math.abs(r.bus.bhbEndoMmolL - pre)).toBeLessThan(0.1);
    r.bus.exoKetoneMmolH = 0;
    r.step(12, 7);
    expect(r.s.tkbExo).toBeLessThan(0.01);
  });
});

// ------------------------------------------------------------------------------------------------ numerics (O-10)
/** Worst |module − reference| / max(0.05 mM, 5 %) over hour means and end-of-hour points, from absolute hour `from`. */
function o10Worst(sc: RefScenario, from: number, dtH?: number): { mean: number; end: number } {
  const ref = runReference05(sc, dtH);
  const inp = hourlyFromReference(ref, sc);
  const m = runModule(inp, { habitualProteinG: sc.habitualProteinG, habitualCarbG: sc.habitualCarbG, liverCapG: ref.Gmax });
  const rh = referenceHourly(ref, 'BHB');
  let wm = 0;
  let we = 0;
  for (let h = Math.max(0, from - inp.h0); h < inp.n; h++) {
    wm = Math.max(wm, Math.abs(m.bhb[h]! - rh.mean[h]!) / Math.max(0.05, 0.05 * rh.mean[h]!));
    we = Math.max(we, Math.abs(m.bhbEnd[h]! - rh.end[h]!) / Math.max(0.05, 0.05 * rh.end[h]!));
  }
  return { mean: wm, end: we };
}

function v7Scenario(): RefScenario {
  const b = BODY.overweight;
  const hab = habitual(b);
  const meals: RefMeal[] = [
    ...mealsOfDays(-BURN_IN_DAYS, 0, hab), ...mealsOfDay(0, hab).slice(0, 2),
    { t: T0, netCarbG: (630 * 0.5) / 4, proteinG: (630 * 0.15) / 4, fatG: (630 * 0.35) / 9 },
    { t: T0 + 24, netCarbG: 110, proteinG: 31, fatG: 7 },
  ];
  return { body: b, meals, tStart: -24 * BURN_IN_DAYS, tEnd: T0 + 40, habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG };
}
const v11Scenario = (): RefScenario => fastScenario(BODY.leanMan, 20, { drinks: [{ t: 32, gBhbD: 25, fed: false }] }).sc;

describe('O-10: hourly integrator vs the 05 §4.17 reference (≤ 0.05 mM or 5 %)', () => {
  it('V1 (72-h fast incl. 14-day burn-in), V3 (exercise at the start of a fast), V7 (refeeding exit) vs the 5-min Euler reference', () => {
    for (const [sc, from] of [
      [fastScenario(BODY.leanMan, 80).sc, -24 * BURN_IN_DAYS],
      [fastScenario(BODY.woman, 40, { bouts: [{ t0: T0 + 3, t1: T0 + 4, x: 0.65 }] }).sc, 0],
      [v7Scenario(), 0],
    ] as const) {
      const w = o10Worst(sc, from);
      expect(w.mean).toBeLessThanOrEqual(1);
      expect(w.end).toBeLessThanOrEqual(1);
    }
  });

  it('V11 (25-g ester) vs the converged reference (Δt = 5 s)', () => {
    const w = o10Worst(v11Scenario(), 0, 1 / 720);
    expect(w.mean).toBeLessThanOrEqual(1);
    expect(w.end).toBeLessThanOrEqual(1);
  });

  // The literal 5-min Euler reference is itself 2-9 % off its converged solution during ester absorption (left-Riemann
  // kernel sampling + explicit Euler: 3.11 vs 3.04 mM at 1 h), so the module (3.01, within 1 % of the converged value)
  // misses the 5 % band against it at the peak hour. Reported, not a module error.
  it.fails('V11 vs the literal 5-min Euler reference', () => {
    const w = o10Worst(v11Scenario(), 0);
    expect(w.mean).toBeLessThanOrEqual(1);
    expect(w.end).toBeLessThanOrEqual(1);
  });

  it('review B4 cases (90 kg / FFM 67.5): 4 × 15-min sub-steps within 3 % of the exact decay; one 60-min step is not', () => {
    const r = rig({ bw: 90, ffm: 67.5 });
    const { k, s } = r;
    const vd = k.vdPerBW * 90;
    const vmax = k.clFFM * 67.5 * k.km;
    const rB = k.renal * 90;
    const f = (T: number, P: number): number => (P - (vmax * T) / (k.km + T) - rB * Math.max(0, T - k.tThr)) / vd;
    const exact = (T0x: number, P: number): number => {
      let T = T0x;
      const h = 1 / 60; // RK4, 1-s steps over 60 min
      for (let n = 0; n < 3600; n++) {
        const a = f(T, P), b = f(T + (h / 2) * a, P), c = f(T + (h / 2) * b, P), d = f(T + h * c, P);
        T += (h / 6) * (a + 2 * b + 2 * c + d);
      }
      return T;
    };
    const sub = (T0x: number, P: number): number => {
      let T = T0x;
      for (let i = 0; i < N_SUB; i++) {
        let t1 = linearisedStep(s, T, T, P, vmax, k.km, rB, k.tThr, vd);
        if (Math.abs(t1 - T) > 0.1) t1 = linearisedStep(s, 0.5 * (T + t1), T, P, vmax, k.km, rB, k.tThr, vd);
        T = t1;
      }
      return T;
    };
    expect(exact(3, 0)).toBeCloseTo(0.405, 2); // review B4 table
    expect(exact(5, 0.2)).toBeCloseTo(1.127, 2);
    for (const [T0x, P] of [[3, 0], [5, 0.2], [2.5, 1.2], [0.2, 3]] as const) {
      expect(Math.abs(sub(T0x, P) / exact(T0x, P) - 1)).toBeLessThan(0.03);
    }
    // a single 60-min linearisation at T0 (the pre-B4 integrator) overshoots the decay badly
    const one = (T0x: number, P: number): number => {
      const kmT = k.km + T0x;
      const ff = f(T0x, P);
      const b = ((vmax * k.km) / (kmT * kmT) + (T0x > k.tThr ? rB : 0)) / vd;
      return T0x + (ff * (1 - Math.exp(-60 * b))) / b;
    };
    expect(one(3, 0) / exact(3, 0)).toBeLessThan(0.5);
  });
});

// ------------------------------------------------------------------------------------------------ properties
describe('properties', () => {
  it('steady state at maintenance stays steady for 30 simulated days', () => {
    const b = BODY.leanMan;
    const v = simulateScenario(dietScenario(b, habitual(b), 30));
    for (let h = 0; h < 24; h++) {
      expect(Math.abs(v.mean(24 * 29 + h) - v.mean(24 * 2 + h))).toBeLessThan(1e-3);
    }
    expect(v.m.aF[v.inp.n - 1]!).toBeLessThan(0.05);
    expect(v.pt(24 * 29 + 7)).toBeLessThan(0.2); // no ketosis on a mixed diet
  });

  it('zero intake for 21 and 28 days stays finite and bounded (O-6); morning BHB rises monotonically', () => {
    for (const body of [BODY.lean20, BODY.obese20]) {
      const v = simulateScenario(fastScenario(body, 28 * 24).sc);
      const m = v.m;
      for (let h = 0; h < v.inp.n; h++) {
        for (const x of [m.bhb[h]!, m.tkb[h]!, m.ffa[h]!, m.tkbEnd[h]!, m.lossKcalH[h]!, m.brainShare[h]!]) expect(Number.isFinite(x)).toBe(true);
        expect(m.tkbEnd[h]!).toBeGreaterThanOrEqual(0.01);
        expect(m.aF[h]!).toBeGreaterThanOrEqual(0);
        expect(m.aF[h]!).toBeLessThanOrEqual(1);
        expect(m.aS[h]!).toBeGreaterThanOrEqual(0);
        expect(m.aS[h]!).toBeLessThanOrEqual(1);
        expect(m.brainShare[h]!).toBeLessThan(0.7);
        expect(m.bhb[h]!).toBeLessThan(10);
      }
      let prev = 0;
      for (let d = 1; d <= 28; d++) {
        const x = v.pt(T0 + 24 * d);
        expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = x;
      }
    }
  });

  it('never NaN with degenerate upstream values (NaN / negative / zero signals)', () => {
    const r = rig();
    r.bus.insulinRefRel = Number.NaN;
    r.bus.liverGlycogenG = -5;
    r.bus.muscleGlycogenRel = Number.NaN;
    r.bus.tdeeEstKcalD = 0;
    r.bus.carbAbs24G = Number.NaN;
    r.bus.tissueMassKg = 0;
    r.bus.ffmActKg = Number.NaN;
    r.step(48);
    for (const x of [r.bus.bhbMmolL, r.bus.tkbMmolL, r.bus.ffaMmolL, r.bus.ketoAdaptFast, r.bus.brainKetoneShare]) expect(Number.isFinite(x)).toBe(true);
  });

  it('is bit-for-bit deterministic (O-7)', () => {
    const a = simulateScenario(fastScenario(BODY.woman, 60).sc);
    const b = simulateScenario(fastScenario(BODY.woman, 60).sc);
    expect(Array.from(b.m.bhb)).toEqual(Array.from(a.m.bhb));
    expect(b.m.events).toEqual(a.m.events);
  });
});

// ------------------------------------------------------------------------------------------------ events
describe('ketosis state machine and events (MODEL_SPEC §1.7 step 7, §7.1)', () => {
  it('fast then carbohydrate refeed: entered (~0.5 mM, 2-h persistence) → deepKetosis → ketoAdapted → exited', () => {
    const b = BODY.leanMan;
    const hab = habitual(b);
    const meals = [...mealsOfDays(-BURN_IN_DAYS, 1, hab), ...mealsOfDays(7, 9, hab)];
    const v = simulateScenario({ body: b, meals, tStart: -24 * BURN_IN_DAYS, tEnd: 24 * 9, habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG });
    const ev = v.m.events;
    const first = (type: string): RecordedEvent | undefined => ev.find((e) => e.type === type);
    const entered = first('ketosisEntered')!;
    expect(entered).toBeDefined();
    expect(Math.abs(v.m.bhb[entered.hour - v.inp.h0]! - 0.5)).toBeLessThan(0.15);
    expect(entered.hour - T0).toBeGreaterThan(18);
    expect(entered.hour - T0).toBeLessThan(28);
    expect(ev.filter((e) => e.type === 'ketosisEntered')).toHaveLength(1);
    const deep = first('deepKetosis')!;
    expect(deep.hour).toBeGreaterThan(entered.hour);
    expect(v.mean(deep.hour)).toBeGreaterThanOrEqual(3);
    expect(first('ketoAdapted')!.hour).toBeGreaterThan(entered.hour);
    const exited = first('ketosisExited')!;
    expect(exited.hour).toBeGreaterThanOrEqual(24 * 7);
    expect(exited.hour).toBeLessThan(24 * 8);
    expect(first('ketoneAlert')).toBeUndefined(); // refeeding with carbohydrate drops BHB below 3 mM within the hour
    // hours in ketosis: a full day on day 3 of the fast, none before the fast
    expect(v.m.hoursInKetosisByDay[BURN_IN_DAYS + 3]).toBe(24);
    expect(v.m.hoursInKetosisByDay[BURN_IN_DAYS - 2]).toBe(0);
    // categories: 3 (fasting) late in the fast, 2 on day 1 evening
    expect(v.m.state[24 * 6 + 12 - v.inp.h0]).toBe(3);
  });

  it('ketoneAlert: BHB > 3.0 mM for ≥ 2 h with food in the last 24 h (exogenous ester after meals)', () => {
    const r = rig();
    r.step(6);
    r.bus.kcalEaten24 = 1500;
    r.bus.exoKetoneMmolH = 400;
    r.step(3, 6, 0, 0, 40);
    expect(r.events.some((e) => e.type === 'ketoneAlert')).toBe(true);
    expect(r.s.state).toBe(4);
  });

  it('the decaying fasting pool after the first meal stays category 3, not a "ketones while eating" warning (A2)', () => {
    const r = rig();
    // a 3-week fast's steady state: TKB 6.5 mM (BHB ≈ 5), FFA 1.8 mM, full adaptation
    r.s.tkb = 6.5;
    r.s.ffa = 1.8;
    r.s.aF = 1;
    r.s.aS = 1;
    r.bus.kcalEaten24 = 0;
    r.bus.carbAbs24G = 0;
    r.bus.liverGlycogenG = 5;
    r.bus.insulinRefRel = 0.45;
    r.step(3, 100);
    expect(r.s.state).toBe(3);
    r.bus.kcalEaten24 = 800; // first meal: BHB still > 3 mM for an hour or two
    r.step(1, 103);
    expect(r.s.bhb).toBeGreaterThan(3);
    expect(r.s.state).toBe(3);
    r.s.hoursSinceFastKetosis = 30; // … but > 3 mM with food and no fast in the last 24 h is a warning
    r.step(1, 104);
    if (r.s.bhb > 3) expect(r.s.state).toBe(4);
  });

  it('no events during burn-in (negative hour index)', () => {
    const r = rig();
    r.bus.carbAbs24G = 0;
    r.bus.liverGlycogenG = 0;
    r.bus.kcalEaten24 = 0;
    for (let h = -200; h < 0; h++) stepKetones(r.s, r.k, r.bus, 0, 0, 0, h, null);
    expect(r.events).toHaveLength(0);
    expect(r.s.inKetosis).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ performance
describe('performance (micro-benchmark, reported)', () => {
  // Measured ≈ 1.4-1.7 ms per 180-day run on the development machine (Node 26), above the WP default of 0.5 ms: the
  // spec-mandated 4 sub-step exponentials + 2 pow + 1 exp per hour alone cost ≈ 0.3-0.4 ms (MODEL_SPEC §11.2 risk 3).
  // Reported as a budget miss; the assertion below is a regression guard only.
  it('180 days of stepHour: measured and reported (regression guard 2.5 ms; WP budget 0.5 ms not met)', () => {
    // two-week pattern (habitual week + ketogenic week with training and an ester dose), tiled to 180 days
    const b = BODY.leanMan;
    const hab = habitual(b);
    const sc: RefScenario = {
      body: b,
      meals: [...mealsOfDays(-7, 0, hab), ...mealsOfDays(0, 7, { kcal: b.TEE, carbG: 30, proteinG: 120 })],
      bouts: [{ t0: 24 * 2 + 17, t1: 24 * 2 + 18, x: 0.7 }],
      drinks: [{ t: 24 * 4 + 8, gBhbD: 12, fed: false }],
      tStart: -24 * 7, tEnd: 24 * 7, habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG,
    };
    const src = hourlyFromReference(runReference05(sc), sc);
    const N = 180 * 24;
    const tile = (a: Float64Array): Float64Array => {
      const o = new Float64Array(N);
      for (let i = 0; i < N; i++) o[i] = a[i % a.length]!;
      return o;
    };
    const inp: HourlyInputs = {
      ...src, h0: 0, n: N,
      insulinRel: tile(src.insulinRel), raProtGH: tile(src.raProtGH), raMctGH: tile(src.raMctGH), exoKetoneMmolH: tile(src.exoKetoneMmolH),
      liverGlycogenG: tile(src.liverGlycogenG), muscleExDefFrac: tile(src.muscleExDefFrac), kcalEaten24: tile(src.kcalEaten24),
      carbAbs24G: tile(src.carbAbs24G), exMinutesH: tile(src.exMinutesH), exIntensityFrac: tile(src.exIntensityFrac),
      mealStart: tile(src.mealStart), mealMacroG: tile(src.mealMacroG), exoDoseG: tile(src.exoDoseG), etohPoolG: tile(src.etohPoolG),
    };
    const sink: EventSink = { emit: () => {} };
    const ctx = makeContext({ habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG, checks: false }, b.BW, b.FFM, sink);
    const k = prepareKetones(ctx);
    const bus = createSignalBus();
    let s: KetonesState = initKetones(k, ctx, bus);
    const { result: best, factor } = measureUnderLoad(() => {
      let best = Infinity;
      for (let rep = 0; rep < 30; rep++) {
        s = initKetones(k, ctx, bus);
        const t0 = performance.now();
        for (let h = 0; h < N; h++) {
          bus.insulinRefRel = inp.insulinRel[h]!;
          bus.raProtGH = inp.raProtGH[h]!;
          bus.raMctGH = inp.raMctGH[h]!;
          bus.exoKetoneMmolH = inp.exoKetoneMmolH[h]!;
          bus.liverGlycogenG = inp.liverGlycogenG[h]!;
          bus.muscleGlycogenExDefFrac = inp.muscleExDefFrac[h]!;
          bus.kcalEaten24 = inp.kcalEaten24[h]!;
          bus.carbAbs24G = inp.carbAbs24G[h]!;
          bus.exMinutesH = inp.exMinutesH[h]!;
          bus.exIntensityFrac = inp.exIntensityFrac[h]!;
          stepKetones(s, k, bus, inp.mealStart[h]!, inp.mealMacroG[h]!, inp.exoDoseG[h]!, h, sink);
        }
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    });
    console.info(`[bench] ketones: ${best.toFixed(3)} ms per 180-day run (best of 30, stepHour incl. bus writes; load factor ${factor.toFixed(2)})`);
    expect(Number.isFinite(s.tkb)).toBe(true);
    // limit scales with the machine load (benchLoad.ts)
    expect(best).toBeLessThan(2.5 * factor);
  });
});
