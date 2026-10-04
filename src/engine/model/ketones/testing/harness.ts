/**
 * TEST-ONLY driver for the ketones module: builds a minimal ModuleContext, a SignalBus and hourly inputs, and runs
 * `stepKetones` hour by hour with hand-built upstream values (no full engine loop — the upstream modules are written in
 * parallel; WP_BRIEF). Two input sources:
 *   - `hourlyFromReference`: hour aggregates of the 05 §4.17 5-min reference run (insulin, Ra, glycogen, 24-h rings);
 *   - `hourlyFromFunctions`: arbitrary hand-built trajectories (e.g. 04 §4.2 liver kinetics, 20 Table A1 muscle glycogen).
 */
import { buildModelParams, withOverrides } from '../../../core/paramsRegistry';
import { createSignalBus, type SignalBus } from '../../../types/signals';
import type { EventSink, ModuleContext } from '../../../types/module';
import type { ResolvedProfile } from '../../../types/profile';
import type { SimEventType } from '../../../types/events';
import type { AnyEngineModule } from '../../../types/module';
import { ketonesModule, prepareKetones, initKetones, stepKetones, bhbFromTkb, type KetonesConst, type KetonesState } from '../index';
import type { RefRun, RefScenario } from './reference05';

export interface HourlyInputs {
  /** Absolute hour index of row 0. */
  h0: number;
  n: number;
  insulinRel: Float64Array;
  raProtGH: Float64Array;
  raMctGH: Float64Array;
  exoKetoneMmolH: Float64Array;
  liverGlycogenG: Float64Array;
  /**
   * Exercise-driven muscle-glycogen deficit (bus `muscleGlycogenExDefFrac`). From a 05 reference run this is 05's δ_M —
   * its fallback muscle glycogen falls only through exercise, so its whole deficit is exercise-driven.
   */
  muscleExDefFrac: Float64Array;
  kcalEaten24: Float64Array;
  carbAbs24G: Float64Array;
  exMinutesH: Float64Array;
  exIntensityFrac: Float64Array;
  mealStart: Float64Array;
  mealMacroG: Float64Array;
  /** Exogenous-ketone dose ingested in this hour (HourInput.exoKetoneG), g D-BHB. */
  exoDoseG: Float64Array;
  etohPoolG: Float64Array;
  tdeeKcalD: number;
  bwKg: number;
  ffmKg: number;
  /** Liver glycogen before row 0 (initial `gLPrevG`). */
  gL0: number;
}

const zeros = (n: number): Float64Array => new Float64Array(n);

/** Hour aggregates of a 05 reference run (hour means of rates, end-of-hour glycogen, hour means of the 24-h rings). */
export function hourlyFromReference(run: RefRun, sc: RefScenario): HourlyInputs {
  const per = Math.round(1 / run.dtH);
  const n = Math.floor(run.samples.length / per);
  const inp: HourlyInputs = {
    h0: Math.round(sc.tStart),
    n,
    insulinRel: zeros(n), raProtGH: zeros(n), raMctGH: zeros(n), exoKetoneMmolH: zeros(n), liverGlycogenG: zeros(n),
    muscleExDefFrac: zeros(n), kcalEaten24: zeros(n), carbAbs24G: zeros(n), exMinutesH: zeros(n), exIntensityFrac: zeros(n),
    mealStart: zeros(n), mealMacroG: zeros(n), exoDoseG: zeros(n), etohPoolG: zeros(n),
    tdeeKcalD: sc.body.TEE, bwKg: sc.body.BW, ffmKg: sc.body.FFM, gL0: run.initial.GL,
  };
  for (let h = 0; h < n; h++) {
    let ins = 0, rap = 0, ramct = 0, exo = 0, ei = 0, c = 0, exMin = 0, xs = 0;
    for (let j = 0; j < per; j++) {
      const smp = run.samples[h * per + j]!;
      ins += smp.I;
      rap += smp.RaP;
      ramct += smp.RaC8 + smp.RaC10;
      exo += smp.exoMmolMin;
      ei += smp.EI24;
      c += smp.C24;
      if (smp.x > 0) {
        exMin += run.dtH * 60;
        xs = smp.x;
      }
    }
    inp.insulinRel[h] = ins / per;
    inp.raProtGH[h] = rap / per;
    inp.raMctGH[h] = ramct / per;
    inp.exoKetoneMmolH[h] = (exo / per) * 60;
    inp.kcalEaten24[h] = ei / per;
    inp.carbAbs24G[h] = c / per;
    inp.exMinutesH[h] = exMin;
    inp.exIntensityFrac[h] = xs;
    const end = run.samples[h * per + per - 1]!;
    inp.liverGlycogenG[h] = end.GL;
    inp.muscleExDefFrac[h] = Math.max(0, 1 - end.GM / (0.85 * run.MGmax));
  }
  for (const m of sc.meals) {
    const h = Math.floor(m.t) - inp.h0;
    if (h >= 0 && h < n) {
      inp.mealStart[h] = 1;
      inp.mealMacroG[h] = inp.mealMacroG[h]! + m.netCarbG + m.proteinG + m.fatG + (m.mctC8G ?? 0) + (m.mctC10G ?? 0);
    }
  }
  for (const d of sc.drinks ?? []) {
    const h = Math.floor(d.t) - inp.h0;
    if (h >= 0 && h < n) inp.exoDoseG[h] = inp.exoDoseG[h]! + d.gBhbD;
  }
  return inp;
}

/** Hour means (trapezoid over the 5-min points incl. the hour start) and end-of-hour values of a reference series. */
export function referenceHourly(run: RefRun, key: 'BHB' | 'TKB' | 'FFA'): { mean: Float64Array; end: Float64Array } {
  const per = Math.round(1 / run.dtH);
  const n = Math.floor(run.samples.length / per);
  const mean = zeros(n);
  const end = zeros(n);
  let prev = key === 'FFA' ? run.initial.FFA : key === 'TKB' ? run.initial.TKB : bhbRef(run.initial.TKB);
  for (let h = 0; h < n; h++) {
    let acc = 0.5 * prev;
    for (let j = 0; j < per; j++) {
      const v = run.samples[h * per + j]![key];
      acc += j === per - 1 ? 0.5 * v : v;
      if (j === per - 1) prev = v;
    }
    mean[h] = acc / per;
    end[h] = prev;
  }
  return { mean, end };
}
const bhbRef = (tkb: number): number => {
  const R = 1.5 + 0.3 * tkb;
  return (tkb * R) / (1 + R);
};

export interface RecordedEvent {
  type: SimEventType;
  hour: number;
  value: number;
}

export interface ModuleRun {
  k: KetonesConst;
  s: KetonesState;
  bus: SignalBus;
  /** Hour means written to the bus. */
  bhb: Float64Array;
  bhbEndo: Float64Array;
  tkb: Float64Array;
  ffa: Float64Array;
  /** End-of-hour point values (pool state). */
  bhbEnd: Float64Array;
  tkbEnd: Float64Array;
  aF: Float64Array;
  aS: Float64Array;
  state: Float64Array;
  lossKcalH: Float64Array;
  brainShare: Float64Array;
  prodMmolMin: Float64Array;
  hoursInKetosisByDay: number[];
  events: RecordedEvent[];
}

export interface RunOptionsK {
  habitualProteinG: number;
  habitualCarbG: number;
  /** Param overrides by id (e.g. { 'ketones.kP': 0.011 }), applied on top of REF05_CALIBRATION. */
  overrides?: Record<string, number>;
  /** Use the registry (coupled-engine) values instead of 05 §4.17's own calibration. */
  registryDefaults?: boolean;
  /** Direct override of the partition half-point in grams (bypasses g50Frac·G_L,max). */
  g50G?: number;
  /**
   * Liver-glycogen capacity of the liver model that drives the run, g: G50 = g50Frac·liverCapG (ruling R-KET). With the
   * 05 fallback liver (capacity 100·FFM/60 g) this reproduces 05's calibrated G50 = 55·FFM/60 g.
   */
  liverCapG?: number;
  /** Override of the C8 share of MCT. */
  mctC8Share?: number;
  checks?: boolean;
}

const MODS = [ketonesModule] as unknown as readonly AnyEngineModule[];

/**
 * 05 §4.17's own calibration (the values the dossier's reference model — `reference05.ts` — was run with). Module-level
 * tests drive the module with that model's inputs (its FALLBACK liver/insulin), so they run with these values; the
 * registry holds the coupled-engine calibration (integrator A2, 2026-09-30), which the full-engine integration tests in
 * `../integration/` check against the same dossier targets.
 */
export const REF05_CALIBRATION: Readonly<Record<string, number>> = {
  'ketones.kP': 0.01,
  'ketones.g50Frac': 0.55,
  'ketones.nG': 2.5,
  'ketones.aHs': 0.5,
  'ketones.phiMin': 0.12,
  'ketones.aH': 0.35,
  'ketones.kIHep': 0.15,
  'ketones.fHep': 0.15,
  'ketones.kProt': 0.15,
  'ketones.aM': 0.35,
  'ketones.f0': 0.5,
};

export function makeContext(opts: RunOptionsK, bwKg: number, ffmKg: number, events: EventSink): ModuleContext {
  const base = buildModelParams(MODS);
  let params = base;
  const overrides = opts.registryDefaults ? opts.overrides : { ...REF05_CALIBRATION, ...opts.overrides };
  if (overrides) {
    const v = new Float64Array(base.values);
    for (const [id, val] of Object.entries(overrides)) {
      const i = base.index.get(id);
      if (i === undefined) throw new Error(`unknown parameter ${id}`);
      v[i] = val;
    }
    params = withOverrides(base, v);
  }
  const profile = {
    weightKg: bwKg,
    ffm0Kg: ffmKg,
    habitualProteinG: opts.habitualProteinG,
    habitualCarbG: opts.habitualCarbG,
  } as unknown as ResolvedProfile;
  return {
    profile,
    params,
    schedule: { nDays: 0, startDate: '', startWeekday: 0, days: [], fastSpans: [], notes: [] },
    nDays: 0,
    mode: 'simulate',
    seriesEnabled: new Uint8Array(0),
    events,
    checks: opts.checks ?? true,
    safetyTrace: {} as ModuleContext['safetyTrace'],
  };
}

/** Runs the module over hourly inputs. */
export function runModule(inp: HourlyInputs, opts: RunOptionsK): ModuleRun {
  const events: RecordedEvent[] = [];
  const sink: EventSink = { emit: (type, hour, value) => void (hour >= 0 && events.push({ type, hour, value })) };
  const ctx = makeContext(opts, inp.bwKg, inp.ffmKg, sink);
  const k = prepareKetones(ctx);
  if (opts.g50G !== undefined) k.g50OverrideG = opts.g50G;
  if (opts.mctC8Share !== undefined) k.mctC8Share = opts.mctC8Share;
  const bus = createSignalBus();
  if (opts.liverCapG !== undefined) bus.liverGlycogenMaxG = opts.liverCapG;
  bus.liverGlycogenG = inp.gL0;
  bus.tissueMassKg = inp.bwKg;
  bus.ffmActKg = inp.ffmKg;
  bus.tdeeEstKcalD = inp.tdeeKcalD;
  const s = initKetones(k, ctx, bus);
  const n = inp.n;
  const out: ModuleRun = {
    k, s, bus,
    bhb: zeros(n), bhbEndo: zeros(n), tkb: zeros(n), ffa: zeros(n), bhbEnd: zeros(n), tkbEnd: zeros(n), aF: zeros(n),
    aS: zeros(n), state: zeros(n), lossKcalH: zeros(n), brainShare: zeros(n), prodMmolMin: zeros(n), hoursInKetosisByDay: [],
    events,
  };
  for (let h = 0; h < n; h++) {
    const abs = inp.h0 + h;
    if (((abs % 24) + 24) % 24 === 0) {
      if (h > 0) out.hoursInKetosisByDay.push(s.hoursInKetosisToday);
      s.hoursInKetosisToday = 0; // startDay
    }
    bus.insulinRefRel = inp.insulinRel[h]!; // 05 reference I (IR included) = intake's insulinRefRel
    bus.raProtGH = inp.raProtGH[h]!;
    bus.raMctGH = inp.raMctGH[h]!;
    bus.exoKetoneMmolH = inp.exoKetoneMmolH[h]!;
    bus.liverGlycogenG = inp.liverGlycogenG[h]!;
    bus.muscleGlycogenExDefFrac = inp.muscleExDefFrac[h]!;
    bus.kcalEaten24 = inp.kcalEaten24[h]!;
    bus.carbAbs24G = inp.carbAbs24G[h]!;
    bus.exMinutesH = inp.exMinutesH[h]!;
    bus.exIntensityFrac = inp.exIntensityFrac[h]!;
    bus.etohPoolG = inp.etohPoolG[h]!;
    bus.tdeeEstKcalD = inp.tdeeKcalD;
    stepKetones(s, k, bus, inp.mealStart[h]!, inp.mealMacroG[h]!, inp.exoDoseG[h]!, abs, abs >= 0 ? sink : null);
    out.bhb[h] = bus.bhbMmolL;
    out.bhbEndo[h] = bus.bhbEndoMmolL;
    out.tkb[h] = bus.tkbMmolL;
    out.ffa[h] = bus.ffaMmolL;
    out.tkbEnd[h] = s.tkb;
    out.bhbEnd[h] = bhbFromTkb(k, s.tkb);
    out.aF[h] = s.aF;
    out.aS[h] = s.aS;
    out.state[h] = s.state;
    out.lossKcalH[h] = bus.ketoneLossKcalH;
    out.brainShare[h] = bus.brainKetoneShare;
    out.prodMmolMin[h] = s.prodMmolMin;
  }
  return out;
}

/** Row index of absolute hour `absH` in a run that starts at `h0`. */
export const rowOf = (inp: { h0: number }, absH: number): number => absH - inp.h0;

/** Point value at absolute time t (h) from end-of-hour values: the end of hour row(t) − 1 is time t. */
export function pointAt(inp: { h0: number }, endSeries: Float64Array, tH: number): number {
  const r = Math.round(tH) - inp.h0 - 1;
  return endSeries[r]!;
}

/**
 * Coupled-proxy inputs for a water-only fast: the 05-reference inputs up to `tSwitch` (burn-in and the last meal's
 * absorption), then liver glycogen from 04 §4.2 (exponential toward the 5-g floor, τ_L 24 h) and the insulin proxy from
 * 05's basal factor on that liver trajectory (ruling R-INS: intake applies 05's basal decline). Muscle glycogen follows
 * 20 §4B.1 (k_Mf) in fuel, but that fasting decline is not exercise-driven, so the FFA term δ_M keeps the exercise
 * deficit present at the switch (integrator A2 ruling of the ketone runaway). `kMf` is accepted for the old signature and
 * has no effect any more. Used to preview the R-KET retune without the full engine.
 */
export function coupledFastProxy(base: HourlyInputs, tSwitch: number, irFactor: number, opts?: { tauLH?: number; floorG?: number; kMf?: number }): HourlyInputs {
  const tauL = opts?.tauLH ?? 24;
  const floor = opts?.floorG ?? 5;
  const r0 = tSwitch - base.h0;
  const gL0 = base.liverGlycogenG[r0 - 1]!;
  const ex0 = Math.max(0, base.muscleExDefFrac[r0 - 1]!);
  const gRef = base.ffmKg; // 05 §4.4: Gref = 60·FFM/60 g
  const out: HourlyInputs = { ...base, liverGlycogenG: new Float64Array(base.liverGlycogenG), muscleExDefFrac: new Float64Array(base.muscleExDefFrac), insulinRel: new Float64Array(base.insulinRel) };
  for (let r = r0; r < base.n; r++) {
    const dt = r - r0 + 1;
    const gl = floor + (gL0 - floor) * Math.exp(-dt / tauL);
    out.liverGlycogenG[r] = gl;
    out.muscleExDefFrac[r] = ex0;
    out.insulinRel[r] = irFactor * (0.45 + 0.55 * Math.sqrt(Math.min(1, gl / gRef)));
  }
  return out;
}
