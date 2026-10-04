/**
 * Test kit for the cardiometabolic module (only imported by *.test.ts, not part of the engine bundle).
 *
 * The upstream modules (composition, ketones, activity, intake, moderators) are written in parallel, so every test drives
 * the module directly with HAND-BUILT signal trajectories taken from the dossiers' own trial descriptions (fat mass and
 * energy balance of the trial, BHB level of the diet, exercise minutes). `Scenario` is a stand-in for those modules,
 * NOT a model of them.
 */
import { newHourInput, habitualDay } from '../../core/compileSchedule';
import { buildModelParams, withOverrides } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayInput, HourInput } from '../../types/inputs';
import type { ModuleContext, StepClock } from '../../types/module';
import type { LabBaselines, PersonProfile } from '../../types/profile';
import { createSignalBus, type SignalBus } from '../../types/signals';
import { cardiometabolicModule, type CardiometabolicK, type CardiometabolicState } from './index';

export const MAN_PROFILE: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 },
  startDate: '2026-10-05',
};
export const WOMAN_PROFILE: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 },
  startDate: '2026-10-05',
};

/**
 * Study-reported (spot / morning) BHB → the 24-h mean BHB the module's s_keto reads (finisher 2026-09-30: s_keto bounds
 * 0.2 → 0.5 mM on the daily mean correspond to 06's 0.5 → 1.5 mM spot values). Linear map of the two bound pairs, so a
 * rig's s_keto is what it was under the spot convention; values below 0.5 mM spot map to ≤ 0.2 (s_keto 0 either way).
 */
export function spotBhb(spot: number): number {
  return spot <= 0.5 ? 0.4 * spot : 0.2 + 0.3 * (spot - 0.5);
}

/** Fat share of weight change assumed by the hand-built rigs when they move tissue mass with fat mass (classic 0.75). */
export const RIG_FAT_SHARE = 0.75;

export interface Rig {
  k: CardiometabolicK;
  s: CardiometabolicState;
  bus: SignalBus;
  clock: StepClock;
  hour: HourInput;
  /** The habitual day (what the loop feeds during burn-in); clone and edit for scenario days. */
  hab: DayInput;
  ctx: ModuleContext;
  /** Fat mass at t = 0, kg. */
  fm0: number;
  /** Tissue mass at t = 0 (FM0 + FFM0), kg. */
  tm0: number;
}

export interface RigOptions {
  profile?: PersonProfile;
  labs?: LabBaselines;
  /** Parameter overrides by id, without the `cardiometabolic.` prefix. */
  params?: Record<string, number>;
  /** Habitual burn-in days run through the module before the scenario (default 1), then `endBurnIn` latches the baselines. */
  burnIn?: number;
  /** Scenario of burn-in day d (< 0), e.g. the habitual week's sessions; default: the plain habitual day. */
  burnScenario?: (d: number) => Scenario;
  /** `ctx.seriesEnabled` (default empty = every series recorded). */
  seriesEnabled?: Uint8Array;
}

export function makeCtx(opts: RigOptions = {}): ModuleContext {
  const base = buildModelParams([cardiometabolicModule as never]);
  let params = base;
  if (opts.params) {
    const v = Float64Array.from(base.values);
    for (const [id, x] of Object.entries(opts.params)) {
      const i = base.index.get(`cardiometabolic.${id}`);
      if (i === undefined) throw new Error(`unknown parameter ${id}`);
      v[i] = x;
    }
    params = withOverrides(base, v);
  }
  const p = opts.profile ?? MAN_PROFILE;
  const profile = resolveProfile(opts.labs ? { ...p, labs: opts.labs } : p);
  return {
    profile,
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

export function makeRig(opts: RigOptions = {}): Rig {
  const ctx = makeCtx(opts);
  const bus = createSignalBus();
  bus.fatMassKg = ctx.profile.fm0Kg;
  bus.tissueMassKg = ctx.profile.fm0Kg + ctx.profile.ffm0Kg;
  bus.vo2maxMlKgMin = 40;
  const k = cardiometabolicModule.prepare(ctx) as CardiometabolicK;
  const s = cardiometabolicModule.init(k, ctx, bus) as CardiometabolicState;
  const rig: Rig = {
    k, s, bus, ctx,
    clock: { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 },
    hour: newHourInput(),
    hab: habitualDay(ctx.profile),
    fm0: ctx.profile.fm0Kg,
    tm0: ctx.profile.fm0Kg + ctx.profile.ffm0Kg,
  };
  const b = opts.burnIn ?? 1;
  for (let d = -b; d < 0; d++) stepDay(rig, d, opts.burnScenario ? opts.burnScenario(d) : {});
  // what the loop does after the last burn-in day (MODEL_SPEC §3.4)
  cardiometabolicModule.endBurnIn!(s, k, bus, ctx);
  return rig;
}

/** One exercise bout inside a scenario day. */
export interface Bout {
  /** Clock hour 0..23. */
  atH: number;
  minutes: number;
  /** Cardio: fraction of VO2max (or `met`); resistance: `rtSets` > 0. */
  intensity?: number;
  met?: number;
  rtSets?: number;
}

export interface Scenario {
  /** Diet / input overrides on top of the habitual day (any DayInput numeric field). */
  day?: Partial<DayInput>;
  /** Bus values for the day (held for all 24 hours). */
  fmKg?: number;
  bhb?: number;
  u?: number;
  eb7?: number;
  carb24?: number;
  vo2?: number;
  sleepMult?: number;
  /** Post-absorptive plasma glucose of the intake curves, mmol/L (default: 04's 5.0·S_hep^(−0.1) of yesterday's S_hep). */
  glucose?: number;
  /** Hours since the absorptive state ended (default: unchanged). */
  tPa?: number;
  bouts?: Bout[];
}

/** Drive startDay → 24 × stepHour → endOfDay with hand-built signals (allocation is fine in tests). */
export function stepDay(rig: Rig, dayIdx: number, sc: Scenario): DayInput {
  const { k, s, bus, clock, hour } = rig;
  const day = { ...rig.hab, ...(sc.day ?? {}) } as DayInput;
  if (sc.day && sc.day.energyKcal === undefined && (sc.day.carbG !== undefined || sc.day.fatG !== undefined || sc.day.proteinG !== undefined)) {
    day.energyKcal = 4 * day.proteinG + 9 * day.fatG + 4 * day.carbG + 2 * day.fibreG + 7 * day.alcoholG;
  }
  if (sc.fmKg !== undefined) {
    // hand-built rigs drive fat mass; tissue mass follows with the classic 75 % fat share of weight change (RIG_FAT_SHARE)
    bus.fatMassKg = sc.fmKg;
    bus.tissueMassKg = rig.tm0 + (sc.fmKg - rig.fm0) / RIG_FAT_SHARE;
  }
  if (sc.bhb !== undefined) bus.bhbMmolL = sc.bhb;
  if (sc.u !== undefined) bus.energyBalanceFrac = sc.u;
  if (sc.eb7 !== undefined) bus.energyBalance7KcalD = sc.eb7;
  bus.carbAbs24G = sc.carb24 ?? day.carbG;
  if (sc.vo2 !== undefined) bus.vo2maxMlKgMin = sc.vo2;
  if (sc.sleepMult !== undefined) bus.siSleepMult = sc.sleepMult;
  // stand-in for the intake curves' fasting values (04 §4.16-4.17): Glc_f = 5.0·S_hep^(−0.1), Ins_f = 7·S_hep^(−0.9), S_hep of yesterday
  bus.glucoseMmolL = sc.glucose ?? 5.0 * Math.pow(bus.sHep, -0.1);
  bus.insulinUuMl = 7 * Math.pow(bus.sHep, -0.9);
  if (sc.tPa !== undefined) bus.hoursPostAbsorptiveH = sc.tPa;
  clock.day = dayIdx;
  clock.weekday = ((dayIdx % 7) + 7) % 7;
  cardiometabolicModule.startDay(s, k, bus, day, clock);
  for (let h = 0; h < 24; h++) {
    clock.hourOfDay = h;
    clock.hourIndex = dayIdx * 24 + h;
    hour.exMin = 0;
    hour.exIntensityFrac = 0;
    hour.exModality = 0;
    hour.exMet = 0;
    hour.rtSetsTotal = 0;
    for (const b of sc.bouts ?? []) {
      if (b.atH !== h) continue;
      hour.exMin = b.minutes;
      if (b.rtSets && b.rtSets > 0) {
        hour.rtSetsTotal = b.rtSets;
        hour.exModality = 0;
        hour.exMet = b.met ?? 4;
      } else {
        hour.exModality = 2;
        hour.exIntensityFrac = b.intensity ?? 0;
        hour.exMet = b.met ?? 0;
      }
    }
    cardiometabolicModule.stepHour(s, k, bus, hour, day, clock);
  }
  cardiometabolicModule.endOfDay(s, k, bus, day, clock);
  return day;
}

/** Run `n` days; `fn(d)` gives the scenario of day d (0-based). Returns a per-day snapshot of the recorded outputs. */
export function run(rig: Rig, n: number, fn: (d: number) => Scenario): DaySnapshot[] {
  const out: DaySnapshot[] = [];
  for (let d = 0; d < n; d++) {
    stepDay(rig, d, fn(d));
    out.push(snapshot(rig));
  }
  return out;
}

export interface DaySnapshot {
  ldl: number; // mg/dL
  hdl: number;
  tg: number;
  apoB: number; // mg/dL
  sbp: number;
  liver: number; // %
  fpg: number; // mg/dL
  a1c: number;
  crpRel: number;
  uaRel: number;
  ua: number; // mg/dL
  si: number;
  sHep: number;
  sMus: number;
  tc: number;
  ogtt: number;
}

export function snapshot(rig: Rig): DaySnapshot {
  const { s, k } = rig;
  return {
    ldl: s.outLdlMmol * 38.67,
    hdl: s.outHdlMmol * 38.67,
    tg: s.outTgMmol * 88.57,
    apoB: s.outApoBgL * 100,
    sbp: s.outSbp,
    liver: s.outLiverPct,
    fpg: s.outFpgMmol * 18.02,
    a1c: s.outA1cPct,
    crpRel: s.outCrpRel,
    uaRel: s.outUaRel,
    ua: s.outUaRel * k.ua0,
    si: s.outSensitivity,
    sHep: s.sHep,
    sMus: s.sMus,
    tc: s.tolerance,
    ogtt: s.ogttExcess2hMmolL,
  };
}

/** A diet day built from energy and macro percentages (fat classes as shares of fat), everything else habitual. */
export function dietDay(rig: Rig, o: {
  kcal?: number;
  proteinPct?: number;
  carbPct?: number;
  carbG?: number;
  /** Fat classes in % of energy (trans/other take the rest of fat). */
  sfaPct?: number;
  mufaPct?: number;
  pufaPct?: number;
  sugarsG?: number;
  fructoseG?: number;
  alcoholG?: number;
  omega3G?: number;
  sodiumG?: number;
  potassiumMg?: number;
  viscousG?: number;
  nutsG?: number;
  steps?: number;
  foodQuality?: number;
  cholesterolMg?: number;
  mctG?: number;
  /** Keep the unspecified fat classes at their habitual grams (overfeeding of one class) instead of scaling them with energy. */
  keepGrams?: boolean;
}): Partial<DayInput> & { cholesterolMg?: number } {
  const hab = rig.hab;
  const E = o.kcal ?? hab.energyKcal;
  const alc = o.alcoholG ?? hab.alcoholG;
  const sc = o.keepGrams ? 1 : E / hab.energyKcal;
  const fibreG = hab.fibreG * sc;
  const protein = o.proteinPct !== undefined ? (o.proteinPct / 100) * E / 4 : hab.proteinG * sc;
  let carbG: number;
  let fatG: number;
  if (o.carbG !== undefined) {
    carbG = o.carbG;
    fatG = (E - 4 * protein - 4 * carbG - 2 * fibreG - 7 * alc) / 9;
  } else if (o.carbPct !== undefined) {
    carbG = (o.carbPct / 100) * E / 4;
    fatG = (E - 4 * protein - 4 * carbG - 2 * fibreG - 7 * alc) / 9;
  } else {
    carbG = hab.carbG * sc;
    fatG = (E - 4 * protein - 4 * carbG - 2 * fibreG - 7 * alc) / 9;
  }
  const pct = (x: number | undefined, base: number): number => (x !== undefined ? ((x / 100) * E) / 9 : base);
  const sat = pct(o.sfaPct, hab.satFatG * sc);
  const mufa = pct(o.mufaPct, hab.mufaG * sc);
  const pufa = pct(o.pufaPct, hab.pufaG * sc);
  const sugars = o.sugarsG ?? Math.min(carbG, hab.sugarsG * sc);
  const out: Partial<DayInput> = {
    energyKcal: E, proteinG: protein, carbG, fatG: Math.max(0, fatG), satFatG: sat, mufaG: mufa, pufaG: pufa, sugarsG: sugars,
    fructoseG: o.fructoseG ?? sugars * 0.5, alcoholG: alc, fibreG,
    viscousFibreG: o.viscousG ?? hab.viscousFibreG, nutsG: o.nutsG ?? hab.nutsG, omega3G: o.omega3G ?? hab.omega3G,
    sodiumMg: (o.sodiumG ?? hab.sodiumMg / 1000) * 1000, potassiumMg: o.potassiumMg ?? hab.potassiumMg, steps: o.steps ?? hab.steps,
    foodQuality: o.foodQuality ?? hab.foodQuality, mctG: o.mctG ?? 0,
  };
  if (o.cholesterolMg !== undefined) out.cholesterolMg = o.cholesterolMg;
  return out;
}

