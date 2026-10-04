/**
 * Test rig for the fuel module (test-only; not imported by the engine). Drives `stepFuelHour` directly with hand-built
 * bus and hour values, as WP_BRIEF requires: carbohydrate appearance from 04 §4.10's gamma(2) kernel (optionally capped
 * at 60 g/h glucose like the intake module), insulin from 04 §4.17's curve evaluated at the hour midpoint, protein
 * appearance from a gamma(2) kernel, TEE_pre as a flat hourly rate plus exercise.
 */
import { resolveProfile } from '../../core/resolveProfile';
import { buildModelParams } from '../../core/paramsRegistry';
import { gamma2Mass } from '../../core/math';
import { createSignalBus, type SignalBus } from '../../types/signals';
import type { EventSink, ModuleContext } from '../../types/module';
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import type { SimEventType } from '../../types/events';
import { N_REGIONS } from '../../types/inputs';
import {
  fuelModule,
  initFuel,
  muscleGlycogenG,
  prepareFuel,
  startFuelDay,
  stepFuelHour,
  type FuelConst,
  type FuelHourView,
  type FuelState,
} from './index';

export const TEST_MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 30, heightCm: 178, weightKg: 75 },
  habits: { typicalSteps: 7000 },
  startDate: '2026-10-05',
};

export interface CapturedEvent {
  type: SimEventType;
  hour: number;
  value: number;
}

export interface Rig {
  profile: ResolvedProfile;
  k: FuelConst;
  s: FuelState;
  bus: SignalBus;
  hour: FuelHourView;
  events: CapturedEvent[];
  /** Absolute hour index of the next hour. */
  t: number;
  /** Step length, h (1 = engine; 1/12 = the 5-min Euler reference of O-10). */
  dt: number;
}

export interface RigOptions {
  profile?: PersonProfile;
  vo2max?: number;
  overrides?: Record<string, number>;
  /** Replace the whole-body skeletal muscle (kg) used for the group split. */
  smmKg?: number;
  /** Step length in hours and explicit-Euler decays (O-10 reference). */
  stepH?: number;
  euler?: boolean;
}

export function makeRig(opts: RigOptions = {}): Rig {
  const profile = resolveProfile(opts.profile ?? TEST_MAN);
  const base = buildModelParams([fuelModule as never]);
  const values = Float64Array.from(base.values);
  for (const [id, v] of Object.entries(opts.overrides ?? {})) {
    const i = base.index.get(id);
    if (i === undefined) throw new Error(`unknown parameter ${id}`);
    values[i] = v;
  }
  const events: CapturedEvent[] = [];
  const sink: EventSink = { emit: (type, hour, value) => void events.push({ type, hour, value }) };
  const ctx = {
    profile,
    params: { ...base, values },
    schedule: undefined,
    nDays: 1,
    mode: 'simulate',
    seriesEnabled: new Uint8Array(0),
    events: sink,
    checks: false,
    safetyTrace: undefined,
  } as unknown as ModuleContext;
  const k = prepareFuel(ctx, opts.stepH ?? 1, opts.euler ?? false);
  const bus = createSignalBus();
  const s = initFuel(k, ctx, opts.vo2max ?? 45);
  if (opts.smmKg !== undefined) startFuelDay(s, k, opts.smmKg, 1, 1);
  const hour: FuelHourView = { exModality: 0, rtSetsByRegion: new Float64Array(N_REGIONS), rtSetsTotal: 0 };
  bus.liverGlycogenG = s.liverG;
  bus.muscleGlycogenG = muscleGlycogenG(s);
  return { profile, k, s, bus, hour, events, t: 0, dt: opts.stepH ?? 1 };
}

export interface Meal {
  /** Absolute hour (fractional) of the meal start. */
  at: number;
  glcG: number;
  fruG?: number;
  protG?: number;
  /** Time to peak of the carbohydrate kernel, h (04 §4.16 classes 0.5/0.75/1.0/1.25-1.5). */
  tpH?: number;
  gi?: number;
}

export interface ExerciseBout {
  at: number;
  min: number;
  intensity: number;
  activeKg: number;
  modality?: number;
  carbPerMin?: number;
  /** Extra expenditure in the exercise hour, kcal (added to TEE_pre). */
  kcal: number;
}

export interface RtBout {
  at: number;
  /** Sets per training region (types/inputs TRAINING_REGIONS order). */
  sets: number[];
  kcal?: number;
}

export interface Scenario {
  meals: Meal[];
  /** Flat TEE_pre, kcal/d (exercise kcal added on top in its hour). */
  teeKcalD: number | ((day: number) => number);
  exercise?: ExerciseBout[];
  rt?: RtBout[];
  /** Cap the glucose appearance at 60 g/h, queueing the excess (intake module rule, 04 §4.10 step 1). */
  capGlc?: boolean;
  /** Basal insulin, µU/mL (04 §4.17 Ins_f = 7 at S_hep = 1). */
  insBasal?: number;
  ketoAdapt?: number | ((t: number) => number);
  brainKetoneShare?: number | ((t: number) => number);
  fast?: (t: number) => boolean;
  fastProtOxGH?: number | ((t: number) => number);
  leanRateKgD?: number;
  alcOxGH?: (t: number) => number;
  sMus?: number;
  carbTolerance?: number;
}

/** 04 §4.17 insulin constants used by the rig (owned by the intake module in the engine). */
const B_MAX = 250;
const K_I = 300;
const B_P = 0.6;

export interface HourTrace {
  t: number;
  liverG: number;
  muscleG: number;
  choOx: number;
  fatOx: number;
  protOx: number;
  dnlFat: number;
  gng: number;
  rq: number;
  ins: number;
  raGlc: number;
  carry: number;
}

export interface DayTotals {
  choOxG: number;
  fatOxG: number;
  protOxG: number;
  dnlFatG: number;
  gngG: number;
  /** Glycogen change over the day, g. */
  dGlycogenG: number;
  /** Carbohydrate absorbed (glucose + fructose/galactose), g. */
  choInG: number;
  fatInG: number;
  protInG: number;
  teeKcal: number;
  liverEndG: number;
  muscleEndG: number;
  glycerolGlcKcal: number;
}

/**
 * Run whole days. Meals/bouts are given in absolute hours (day d, clock h → 24·d + h). Returns daily totals and,
 * when `trace` is passed, pushes one HourTrace per hour.
 */
export function runDays(rig: Rig, days: number, sc: Scenario, trace?: HourTrace[]): DayTotals[] {
  const out: DayTotals[] = [];
  const { s, k, bus, hour } = rig;
  const insBasal = sc.insBasal ?? 7;
  const glcQueue = { g: 0 };
  const sink = { emit: (ty: SimEventType, hi: number, v: number) => void rig.events.push({ type: ty, hour: hi, value: v }) };
  for (let d = 0; d < days; d++) {
    const dayIdx = Math.floor(rig.t / 24);
    startFuelDay(s, k, 0, sc.sMus ?? 1, sc.carbTolerance ?? 1);
    const tot: DayTotals = {
      choOxG: 0, fatOxG: 0, protOxG: 0, dnlFatG: 0, gngG: 0, dGlycogenG: 0, choInG: 0, fatInG: 0, protInG: 0, teeKcal: 0,
      liverEndG: 0, muscleEndG: 0, glycerolGlcKcal: 0,
    };
    const g0 = s.liverG + muscleGlycogenG(s);
    const teeD = typeof sc.teeKcalD === 'function' ? sc.teeKcalD(dayIdx) : sc.teeKcalD;
    const n = Math.round(1 / rig.dt);
    const dt = 1 / n;
    for (let h = 0; h < 24; h++) {
      const t = rig.t;
      const hourTot = { choOx: 0, fatOx: 0, protOx: 0, dnlFat: 0, gng: 0, raGlc: 0, ins: 0 };
      for (let i = 0; i < n; i++) {
        const ts = t + i * dt; // step start, absolute hours
        let glc = 0;
        let fru = 0;
        let prot = 0;
        let ins = insBasal;
        for (const m of sc.meals) {
          if (m.at > ts + dt || ts - m.at > 24) continue;
          const tp = m.tpH ?? 1.0;
          const a = ts - m.at;
          const f = gamma2Mass(a, a + dt, tp);
          glc += m.glcG * f;
          fru += (m.fruG ?? 0) * f;
          prot += (m.protG ?? 0) * gamma2Mass(a, a + dt, 1.5);
          const gi = m.gi ?? 55;
          const load = (0.5 + (0.5 * gi) / 100) * (m.glcG + (m.fruG ?? 0));
          const b = (B_MAX * load) / (load + K_I) + B_P * (m.protG ?? 0);
          const y = (a + dt / 2) / (tp + 0.25);
          if (y > 0) ins += b * y * Math.exp(1 - y);
        }
        if (sc.capGlc) {
          glcQueue.g += glc;
          const cap = 60 * dt;
          glc = Math.min(cap, glcQueue.g);
          glcQueue.g -= glc;
        }
        let tee = (teeD / 24) * dt;
        bus.exMinutesH = 0;
        bus.exIntensityFrac = 0;
        bus.exActiveMuscleKg = 0;
        hour.exModality = 0;
        for (const e of sc.exercise ?? []) {
          const start = Math.max(ts, e.at);
          const end = Math.min(ts + dt, e.at + e.min / 60);
          if (end > start) {
            const minutes = (end - start) * 60;
            bus.exMinutesH = minutes;
            bus.exIntensityFrac = e.intensity;
            bus.exActiveMuscleKg = e.activeKg;
            hour.exModality = e.modality ?? 3;
            tee += (e.kcal * minutes) / e.min;
            // carbohydrate eaten during exercise arrives as glucose (review M8)
            if ((e.carbPerMin ?? 0) > 0) glc += (e.carbPerMin ?? 0) * minutes;
          }
        }
        hour.rtSetsByRegion.fill(0);
        hour.rtSetsTotal = 0;
        for (const r of sc.rt ?? []) {
          // the session's sets are spread evenly over its hour (one row per step)
          if (Math.floor(r.at) === t) {
            for (let j = 0; j < r.sets.length; j++) hour.rtSetsByRegion[j] = r.sets[j]! * dt;
            hour.rtSetsTotal = r.sets.reduce((a, b) => a + b, 0) * dt;
            tee += (r.kcal ?? 0) * dt;
          }
        }
        bus.raGlcGH = glc;
        bus.raFruGalGH = fru;
        bus.raProtGH = prot;
        bus.insulinUuMl = ins;
        bus.teePreKcalH = tee;
        bus.alcOxGH = sc.alcOxGH ? sc.alcOxGH(ts) * dt : 0;
        bus.ketoAdaptFast = typeof sc.ketoAdapt === 'function' ? sc.ketoAdapt(ts) : (sc.ketoAdapt ?? 0);
        bus.brainKetoneShare = typeof sc.brainKetoneShare === 'function' ? sc.brainKetoneShare(ts) : (sc.brainKetoneShare ?? 0);
        const fast = sc.fast ? sc.fast(ts) : false;
        bus.fastActive = fast ? 1 : 0;
        bus.fastProtOxGH = fast ? (typeof sc.fastProtOxGH === 'function' ? sc.fastProtOxGH(ts) : (sc.fastProtOxGH ?? 0)) * dt : 0;
        bus.leanRateKgD = sc.leanRateKgD ?? 0;
        stepFuelHour(s, k, bus, hour, t * n + i, sink);
        hourTot.choOx += bus.choOxGH;
        hourTot.fatOx += bus.fatOxGH;
        hourTot.protOx += bus.protOxGH;
        hourTot.dnlFat += bus.dnlFatGH;
        hourTot.gng += bus.gngGH;
        hourTot.raGlc += glc;
        hourTot.ins += ins * dt;
        tot.choInG += glc + fru;
        tot.protInG += prot;
        tot.teeKcal += tee;
        tot.glycerolGlcKcal += s.gngGlyKcalH;
      }
      tot.choOxG += hourTot.choOx;
      tot.fatOxG += hourTot.fatOx;
      tot.protOxG += hourTot.protOx;
      tot.dnlFatG += hourTot.dnlFat;
      tot.gngG += hourTot.gng;
      if (trace) {
        trace.push({
          t, liverG: s.liverG, muscleG: muscleGlycogenG(s), choOx: hourTot.choOx, fatOx: hourTot.fatOx, protOx: hourTot.protOx,
          dnlFat: hourTot.dnlFat, gng: hourTot.gng, rq: bus.rqHour, ins: hourTot.ins, raGlc: hourTot.raGlc, carry: s.carryGlcG,
        });
      }
      rig.t++;
    }
    tot.liverEndG = s.liverG;
    tot.muscleEndG = muscleGlycogenG(s);
    tot.dGlycogenG = tot.liverEndG + tot.muscleEndG - g0;
    out.push(tot);
  }
  return out;
}

/** Three meals a day (08:00, 13:00, 19:00 by default) repeated for `days`, splitting daily grams evenly. */
export function threeMeals(days: number, perDay: { glcG: number; fruG?: number; protG?: number }, opts: { startDay?: number; hours?: number[]; tpH?: number } = {}): Meal[] {
  const hours = opts.hours ?? [8, 13, 19];
  const meals: Meal[] = [];
  const d0 = opts.startDay ?? 0;
  for (let d = d0; d < d0 + days; d++) {
    for (const h of hours) {
      meals.push({
        at: 24 * d + h,
        glcG: perDay.glcG / hours.length,
        fruG: (perDay.fruG ?? 0) / hours.length,
        protG: (perDay.protG ?? 0) / hours.length,
        tpH: opts.tpH ?? 1.0,
      });
    }
  }
  return meals;
}

/**
 * 04 §4.11 daily reduced form (Hall-type quadratic law), integrated with a fine explicit step (1/96 d) as the oracle:
 * dG/dt = CI + GNG_gly − C_ox − DNL; C_ox = min(k_G·G²·(1 − 0.75·A_keto), (TEE − EE_ex)/4.1) [net CHO, g/d];
 * k_G = CI_hab/G_ref²; GNG_gly = 0.10·fatOx; fatOx = (TEE − 4.1·C_ox − 4·P_ox)/9.44 (engine conventions, spec §1.6).
 * CI in g/d at 4 kcal/g is converted to oxidised grams by energy (×4/4.1) and to glycogen grams (×4/4.207) as in §0.2.
 */
export function dailyReducedForm(opts: {
  days: number;
  gRef: number;
  ciHabG: number;
  ciG: (day: number) => number;
  teeKcalD: number;
  protOxGD: number;
  aKeto?: number;
  gCap: number;
}): { choOxG: number[]; fatOxG: number[]; dG: number[]; g: number[] } {
  const nSub = 96;
  const dt = 1 / nSub;
  let g = opts.gRef;
  // k_G in the engine's energy currency: C_ox,kcal = k_G·G²; habitual oxidation 4·CI_hab kcal/d at G = G_ref
  const kG = (4 * opts.ciHabG) / (opts.gRef * opts.gRef);
  const choOx: number[] = [];
  const fatOx: number[] = [];
  const dGs: number[] = [];
  const gs: number[] = [];
  const eeNp = opts.teeKcalD - 4 * opts.protOxGD;
  for (let d = 0; d < opts.days; d++) {
    const ci = opts.ciG(d) * 4; // kcal/d
    let cSum = 0;
    let fSum = 0;
    const g0 = g;
    for (let i = 0; i < nSub; i++) {
      let cOx = kG * g * g * (1 - 0.75 * (opts.aKeto ?? 0));
      if (cOx > eeNp) cOx = eeNp;
      // glycerol GNG solved with the same algebra as the engine: gly = 0.4·fatOx (kcal), fatOx = (eeNp − cOx − gly... )
      const fat = Math.max(0, (eeNp - cOx) / 9.44);
      const gly = 0.4 * fat;
      let dgKcal = ci + gly - cOx;
      if (dgKcal > 0 && g * 4.207 + dgKcal * dt > opts.gCap * 4.207) {
        dgKcal -= dgKcal - Math.max(0, (opts.gCap - g) * 4.207) / dt; // surplus above capacity → DNL
      }
      g += (dgKcal * dt) / 4.207;
      cSum += (cOx * dt) / 4.1;
      fSum += fat * dt;
    }
    choOx.push(cSum);
    fatOx.push(fSum);
    dGs.push(g - g0);
    gs.push(g);
  }
  return { choOxG: choOx, fatOxG: fatOx, dG: dGs, g: gs };
}
