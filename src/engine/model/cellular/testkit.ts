/**
 * Test kit for the cellular module (not part of the engine bundle: only imported by *.test.ts).
 *
 * The upstream modules (intake, fuel, ketones, muscle) are written in parallel, so the cellular tests drive the
 * module directly with HAND-BUILT signal trajectories built from the dossiers' own numbers:
 *  - meals → insulin excursions: 04 §4.17 (B_m·y·e^{1−y}, basal falling with liver glycogen, 05 §4.17 I_floor form);
 *  - meal protein → lagged AA appearance: 03 §4.7A (Michaelis-Menten emptying, F_sys 0.66, τ_lag 0.5 h);
 *  - liver glycogen: refills while absorptive, then decays with τ 24 h (04 §4.2, tauL) to the 5 g floor;
 *  - endogenous BHB: 20 §4.3.4 BHB_ref(hFast) (lean), the water-only reference trajectory.
 * `RefBody` is a stand-in for those modules, NOT a model of them; it exists only to feed realistic signal shapes.
 */
import { mmRemaining } from '../../core/math';
import { buildModelParams, withOverrides } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import { newHourInput } from '../../core/compileSchedule';
import type { DayInput, HourInput } from '../../types/inputs';
import type { ModuleContext, StepClock } from '../../types/module';
import type { PersonProfile } from '../../types/profile';
import { createSignalBus, type SignalBus } from '../../types/signals';
import { cellularModule, type CellularK, type CellularState } from './index';

// ---------------------------------------------------------------------------------------------------------------
// module rig
// ---------------------------------------------------------------------------------------------------------------

export const TEST_PROFILE: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 },
  startDate: '2026-10-05',
};

export interface Rig {
  k: CellularK;
  s: CellularState;
  bus: SignalBus;
  clock: StepClock;
  hour: HourInput;
  day: DayInput;
  ctx: ModuleContext;
}

export interface RigOptions {
  profile?: PersonProfile;
  /** Parameter overrides by id (`cellular.h50` …), applied on top of the nominal registry. */
  params?: Record<string, number>;
  /** A full parameter vector in registry order (an ensemble draw); applied before `params`. */
  paramVector?: Float64Array;
  /** `ctx.seriesEnabled` (default empty = every series recorded). */
  seriesEnabled?: Uint8Array;
}

/** The nominal registry of this module alone (draw vectors for the tests are sampled over its defs). */
export const CELLULAR_REGISTRY = buildModelParams([cellularModule as never]);

export function makeCtx(opts: RigOptions = {}): ModuleContext {
  const base = opts.paramVector ? withOverrides(CELLULAR_REGISTRY, opts.paramVector) : CELLULAR_REGISTRY;
  let params = base;
  if (opts.params) {
    const v = Float64Array.from(base.values);
    for (const [id, x] of Object.entries(opts.params)) {
      const i = base.index.get(id);
      if (i === undefined) throw new Error(`unknown parameter ${id}`);
      v[i] = x;
    }
    params = withOverrides(base, v);
  }
  return {
    profile: resolveProfile(opts.profile ?? TEST_PROFILE),
    params,
    schedule: {} as never,
    nDays: 0,
    mode: 'simulate',
    seriesEnabled: opts.seriesEnabled ?? new Uint8Array(0),
    events: { emit: () => {} },
    checks: true,
    safetyTrace: {} as never,
  };
}

/** prepare + init with the bus at its safe initial values (what the stubs of the other modules leave there). */
export function makeRig(opts: RigOptions = {}): Rig {
  const ctx = makeCtx(opts);
  const bus = createSignalBus();
  const k = cellularModule.prepare(ctx) as CellularK;
  const s = cellularModule.init(k, ctx, bus) as CellularState;
  return {
    k,
    s,
    bus,
    clock: { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 },
    hour: newHourInput(),
    day: {} as DayInput,
    ctx,
  };
}

/** Advance the clock by one hour (absolute index `hourIndex`; day = floor(hourIndex/24), so negative = burn-in). */
export function setClock(rig: Rig, hourIndex: number): void {
  const day = Math.floor(hourIndex / 24);
  rig.clock.day = day;
  rig.clock.hourIndex = hourIndex;
  rig.clock.hourOfDay = hourIndex - 24 * day;
  rig.clock.weekday = ((day % 7) + 7) % 7;
  rig.hour.day = day;
  rig.hour.hourIndex = hourIndex;
  rig.hour.hourOfDay = rig.clock.hourOfDay;
}

export function stepOnce(rig: Rig, hourIndex: number): void {
  setClock(rig, hourIndex);
  if (rig.clock.hourOfDay === 0) cellularModule.startDay(rig.s, rig.k, rig.bus, rig.day, rig.clock);
  cellularModule.stepHour(rig.s, rig.k, rig.bus, rig.hour, rig.day, rig.clock);
  if (rig.clock.hourOfDay === 23) cellularModule.endOfDay(rig.s, rig.k, rig.bus, rig.day, rig.clock);
}

// ---------------------------------------------------------------------------------------------------------------
// hand-built upstream signals
// ---------------------------------------------------------------------------------------------------------------

/** 20 §4.3.4 water-only BHB reference, lean (ob = 0); t in hours since the last meal. */
export function bhbRefLean(t: number): number {
  return 0.08 + 2.2 / (1 + Math.exp(-(t - 44) / 9)) + 3.7 * (1 - Math.exp(-Math.max(0, t - 48) / 170));
}

export interface RefMeal {
  /** Absolute hour index (from the scenario start) in which the meal starts. */
  hour: number;
  proteinG: number;
  carbG: number;
}

interface ActiveMeal {
  t0: number;
  proteinG: number;
  carbG: number;
  /** Time to peak of the insulin excursion, h (04 §4.16 class 0.75 h for a mixed meal). */
  tp: number;
}

const G_FED = 100;
const G_FLOOR = 5;
const TAU_L_DOWN = 24;
const TAU_L_UP = 3;

/** Stand-in for intake + fuel + ketones + muscle signals (see file header). */
export class RefBody {
  hFast = 12;
  gLiver = 70;
  aLag = 0;
  ffm = 60;
  /** µU/mL overnight-fasted insulin at full liver glycogen (04 §4.17 Ins_f = 7 at S_hep = 1). */
  insF = 7;
  private meals: ActiveMeal[] = [];
  private lastCarb = 0;
  private hSinceCarb = 99;

  /** Liver-glycogen reference for the 05 §4.17 basal-insulin factor: 60 g per 60 kg FFM. */
  private gRef(): number {
    return (60 * this.ffm) / 60;
  }

  /** Advance one hour: meals starting this hour first, then write the bus signals for this hour. */
  step(hourIndex: number, meals: readonly RefMeal[], bus: SignalBus): void {
    for (const m of meals) {
      this.meals.push({ t0: m.hour, proteinG: m.proteinG, carbG: m.carbG, tp: 0.75 });
      if (m.proteinG >= 10 || m.carbG >= 15) this.hFast = 0;
      if (m.carbG >= 15) {
        this.lastCarb = m.carbG;
        this.hSinceCarb = 0;
      }
    }
    // liver glycogen: refills for 5 h after a meal with carbohydrate, otherwise decays to the floor
    const absorptive = this.hSinceCarb < 5 && this.lastCarb >= 15;
    const target = absorptive ? G_FED : G_FLOOR;
    const tau = absorptive ? TAU_L_UP : TAU_L_DOWN;
    this.gLiver = target + (this.gLiver - target) * Math.exp(-1 / tau);

    // amino-acid appearance: 03 §4.7A (Vmax 11 g/h, Km 20 g, F_sys 0.66, τ_lag 0.5 h)
    let ra = 0;
    for (const m of this.meals) {
      const t = hourIndex - m.t0;
      if (t < 0) continue;
      ra += 0.66 * (mmRemaining(m.proteinG, 11, 20, t) - mmRemaining(m.proteinG, 11, 20, t + 1));
    }
    this.aLag = ra + (this.aLag - ra) * Math.exp(-1 / 0.5);

    // insulin: 04 §4.17 excursions at the hour midpoint on the falling basal (05 §4.17 I_floor 0.45, exponent 0.5)
    const basal = this.insF * (0.45 + 0.55 * Math.sqrt(Math.min(1, this.gLiver / this.gRef())));
    let ins = basal;
    for (const m of this.meals) {
      const load = 0.8 * m.carbG; // L_I = (0.5 + 0.5·GI/100)·C with GI 60
      const b = (250 * load) / (load + 300) + 0.6 * m.proteinG;
      const y = (hourIndex + 0.5 - m.t0) / (m.tp + 0.25);
      if (y > 0) ins += b * y * Math.exp(1 - y);
    }
    // retire spent meals (> 16 h)
    if (this.meals.length > 0 && hourIndex - this.meals[0]!.t0 > 16) this.meals = this.meals.filter((m) => hourIndex - m.t0 <= 16);

    bus.hoursSinceMealH = this.hFast;
    bus.raAaQGH = this.aLag;
    bus.insulinUuMl = ins;
    bus.insulinBasalUuMl = basal;
    bus.liverGlycogenG = this.gLiver;
    bus.bhbEndoMmolL = bhbRefLean(this.hFast);
    bus.bhbMmolL = bus.bhbEndoMmolL;
    bus.muscleGlycogenRel = 1;
    bus.ffmActKg = this.ffm;

    this.hFast += 1;
    this.hSinceCarb += 1;
  }
}

/** Meals of a repeating day: clock hours (may be fractional → rounded to the hour) with per-meal grams. */
export interface DayPattern {
  name: string;
  /** Clock hour of each meal start. */
  hours: readonly number[];
  proteinG: number;
  carbG: number;
}

/** Reference habitual day for the calibration: 3 mixed meals, 32 g protein (1.2 g/kg at 80 kg), last meal 19:00. */
export const REFERENCE_DAY: DayPattern = { name: 'reference 3 meals', hours: [8, 13, 19], proteinG: 32, carbG: 90 };

export function mealsForHour(pattern: DayPattern, hourIndex: number): RefMeal[] {
  const h = ((hourIndex % 24) + 24) % 24;
  const out: RefMeal[] = [];
  for (const mh of pattern.hours) if (Math.floor(mh) === h) out.push({ hour: hourIndex, proteinG: pattern.proteinG, carbG: pattern.carbG });
  return out;
}

export interface Trace {
  asi: Float64Array;
  asiMuscle: Float64Array;
  mtor: Float64Array;
  ampk: Float64Array;
  hFast: Float64Array;
  xEx: Float64Array;
  asiCr: Float64Array;
}

/**
 * Run `nDays` days from absolute hour `startHour` with a per-hour meal plan, on an existing rig + body.
 * `meals(hourIndex)` returns the meals starting that hour. Returns hourly traces (length 24·nDays).
 */
export function runDays(
  rig: Rig,
  body: RefBody,
  startHour: number,
  nDays: number,
  meals: (hourIndex: number) => readonly RefMeal[],
  before?: (hourIndex: number, rig: Rig) => void,
): Trace {
  const n = nDays * 24;
  const tr: Trace = {
    asi: new Float64Array(n),
    asiMuscle: new Float64Array(n),
    mtor: new Float64Array(n),
    ampk: new Float64Array(n),
    hFast: new Float64Array(n),
    xEx: new Float64Array(n),
    asiCr: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const t = startHour + i;
    body.step(t, meals(t), rig.bus);
    if (before) before(t, rig);
    tr.hFast[i] = rig.bus.hoursSinceMealH;
    stepOnce(rig, t);
    tr.asi[i] = rig.s.asi;
    tr.asiMuscle[i] = rig.s.asiMuscle;
    tr.mtor[i] = rig.s.mtor;
    tr.ampk[i] = rig.s.ampk;
    tr.xEx[i] = rig.s.xEx;
    tr.asiCr[i] = rig.s.asiCr;
  }
  return tr;
}

/** What the loop does after the last burn-in day (MODEL_SPEC §3.4): the module latches its references and B0. */
export function endBurnIn(rig: Rig): void {
  cellularModule.endBurnIn!(rig.s, rig.k, rig.bus, rig.ctx);
}

/**
 * The reference scenario of 08 §4.10: `burnDays` days of 3 mixed meals at maintenance (last meal 19:00) with the
 * clock negative (burn-in: the module samples its 12-h references), `endBurnIn` (references and B0 latched), then
 * day 0 begins 5 h after the last meal. Returns the rig, the body and the absolute hour index of the last meal (−5,
 * i.e. 19:00 of day −1).
 */
export function referenceRig(burnDays = 7, opts: RigOptions = {}): { rig: Rig; body: RefBody; nextHour: number; lastMealHour: number } {
  const rig = makeRig(opts);
  const body = new RefBody();
  const start = -24 * burnDays;
  runDays(rig, body, start, burnDays, (t) => mealsForHour(REFERENCE_DAY, t));
  endBurnIn(rig);
  return { rig, body, nextHour: 0, lastMealHour: -5 };
}

export const mean = (a: ArrayLike<number>, from = 0, to = a.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]!;
  return s / (to - from);
};
