/**
 * Test rig for the energy module (unit tests only; not imported by the engine).
 * Drives `energyModule` directly with a hand-built SignalBus, DayInput and HourInput (WP_BRIEF: other modules' signals
 * are stubs, so validation of this module's equations sets their inputs explicitly). Intake is modelled as instant
 * absorption at three meal hours (08, 13, 19) so `eAbsKcalH` integrates to the day's energy exactly.
 */
import { newHourInput } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { ATWATER } from '../../core/defaults';
import type { DayInput, HourInput, CompiledSchedule } from '../../types/inputs';
import type { ModuleContext, StepClock } from '../../types/module';
import type { ModelParams, ParamDef } from '../../types/params';
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import type { SafetyTrace } from '../../types/result';
import { createSignalBus, type SignalBus } from '../../types/signals';
import { N_SERIES } from '../../types/metrics';
import { energyModule, HX, type EnergyK, type EnergyState } from './index';
import { ENERGY_PARAMS } from './params';

export const MEAL_HOURS = [8, 13, 19] as const;

/** moderators.lutealAmp as declared by MODEL_SPEC §1.1 (02 §4.3 PROPOSED FIT 0.05 [0.02, 0.09]). */
export const LUTEAL_AMP_DEF: ParamDef = {
  id: 'moderators.lutealAmp',
  value: 0.05,
  unit: 'frac RMR',
  low: 0.02,
  high: 0.09,
  grade: 'B',
  source: 'test copy of moderators.lutealAmp (02 §4.3)',
  dossier: '02 §4.3',
  status: 'proposed-fit',
};

export function makeParams(overrides: Record<string, number> = {}, extra: ParamDef[] = [LUTEAL_AMP_DEF]): ModelParams {
  const defs = [...ENERGY_PARAMS, ...extra];
  const values = new Float64Array(defs.length);
  const index = new Map<string, number>();
  defs.forEach((d, i) => {
    values[i] = overrides[d.id] ?? d.value;
    index.set(d.id, i);
  });
  return { defs, values, index, registryHash: 'energy-test' };
}

export function makeCtx(profile: ResolvedProfile, params: ModelParams = makeParams(), nDays = 400): ModuleContext {
  return {
    profile,
    params,
    schedule: { nDays, startDate: '2026-01-05', startWeekday: 0, days: [], fastSpans: [], notes: [] } as CompiledSchedule,
    nDays,
    mode: 'simulate',
    seriesEnabled: new Uint8Array(N_SERIES).fill(1),
    events: { emit: () => {} },
    checks: true,
    safetyTrace: {} as SafetyTrace,
  };
}

/** The dossier-02 reference man: 35 y, 180 cm, 90 kg, 25 % fat (02 §4.1 worked check, §4.13 worked example). */
export const MAN02_INPUT: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90 },
  habits: { typicalSteps: 7000, sessionsPerWeek: 0 },
  startDate: '2026-01-05',
};

/**
 * Resolved profile with explicit baselines (spread over a real resolveProfile result so every other field is valid).
 * Macros are the habitual split at EI0 (P/C/F %E, fibre and alcohol 0 unless given).
 */
export function profileWith(
  input: PersonProfile,
  o: { rmr0: number; tdee0: number; pPct: number; cPct: number; fPct: number; ffm0: number; fm0: number; fibreG?: number; caffeineMg?: number },
): ResolvedProfile {
  const rp = resolveProfile(input);
  return {
    ...rp,
    rmr0Kcal: o.rmr0,
    tdee0Kcal: o.tdee0,
    habitualProteinG: (o.pPct * o.tdee0) / ATWATER.protein,
    habitualCarbG: (o.cPct * o.tdee0) / ATWATER.carb,
    habitualFatG: (o.fPct * o.tdee0) / ATWATER.fat,
    habitualFibreG: o.fibreG ?? 0,
    ffm0Kg: o.ffm0,
    fm0Kg: o.fm0,
    habits: { ...rp.habits, habitualAlcoholDrinksPerWeek: 0, habitualCaffeineMg: o.caffeineMg ?? rp.habits.habitualCaffeineMg },
  };
}

/** Day plan in grams; energy defaults to the engine-convention sum of the macros. */
export interface DayPlan {
  proteinG: number;
  carbG: number;
  fatG: number;
  mctG?: number;
  fibreG?: number;
  alcoholG?: number;
  caffeineMg?: number;
  sleepHours?: number;
  energyKcal?: number;
  /** Whole day inside a planned zero-intake span (DayInput.zeroIntake). */
  zeroIntake?: boolean;
}

export function planFromPct(kcal: number, pPct: number, cPct: number, fPct: number, extra: Partial<DayPlan> = {}): DayPlan {
  return { proteinG: (pPct * kcal) / 4, carbG: (cPct * kcal) / 4, fatG: (fPct * kcal) / 9, ...extra };
}

export function planEnergy(p: DayPlan): number {
  const mct = p.mctG ?? 0;
  return (
    p.energyKcal ??
    ATWATER.protein * p.proteinG +
      ATWATER.carb * p.carbG +
      ATWATER.fat * (p.fatG - mct) +
      ATWATER.mct * mct +
      ATWATER.fibre * (p.fibreG ?? 0) +
      ATWATER.alcohol * (p.alcoholG ?? 0)
  );
}

function makeDayInput(p: DayPlan, day: number, cafHab: number): DayInput {
  return {
    day,
    energyKcal: planEnergy(p),
    proteinG: p.proteinG,
    carbG: p.carbG,
    fatG: p.fatG,
    mctG: p.mctG ?? 0,
    fibreG: p.fibreG ?? 0,
    alcoholG: p.alcoholG ?? 0,
    caffeineMg: p.caffeineMg ?? cafHab,
    sleepHours: p.sleepHours ?? 8,
    sleepBedH: 23,
    sleepWakeH: 7,
    zeroIntake: p.zeroIntake ?? false,
  } as unknown as DayInput;
}

/** Per-hour hook: set the bus signals other modules would write (masses, exercise, GNG …) before stepHour. */
export type HourDrive = (bus: SignalBus, day: number, hour: number) => void;

export interface DaySummary {
  day: number;
  /** Σ hourly TEE incl. deposition cost and DNL heat (the `tdee` metric), kcal/d. */
  tdee: number;
  rmr: number;
  tef: number;
  neat: number;
  ei: number;
  atR: number;
  atN: number;
  comp: number;
  maintenance: number;
  tdeeEst: number;
}

export class EnergyRig {
  readonly bus: SignalBus;
  readonly k: EnergyK;
  readonly s: EnergyState;
  readonly hour: HourInput;
  readonly clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  readonly ctx: ModuleContext;
  day = 0;

  constructor(
    readonly profile: ResolvedProfile,
    params: ModelParams = makeParams(),
  ) {
    const ctx = makeCtx(profile, params);
    this.ctx = ctx;
    this.bus = createSignalBus();
    this.bus.ffmActKg = profile.ffm0Kg;
    this.bus.fatMassKg = profile.fm0Kg;
    this.bus.leanTissueKg = profile.ffm0Kg;
    this.bus.tissueMassKg = profile.fm0Kg + profile.ffm0Kg;
    this.k = energyModule.prepare(ctx);
    this.s = energyModule.init(this.k, ctx, this.bus);
    this.hour = newHourInput();
  }

  /** Habitual plan at EI0 (profile macros, fibre, caffeine). */
  habitualPlan(): DayPlan {
    const p = this.profile;
    return { proteinG: p.habitualProteinG, carbG: p.habitualCarbG, fatG: p.habitualFatG, fibreG: p.habitualFibreG };
  }

  /** Run one day. `clockDay` overrides the clock (negative = burn-in). */
  runDay(plan: DayPlan, drive?: HourDrive, clockDay?: number): DaySummary {
    const d = this.day;
    const dayIn = makeDayInput(plan, d, this.profile.habits.habitualCaffeineMg);
    const bus = this.bus;
    this.clock.day = clockDay ?? d;
    energyModule.startDay(this.s, this.k, bus, dayIn, this.clock);
    const nonAlc = dayIn.energyKcal - ATWATER.alcohol * dayIn.alcoholG;
    const perMeal = nonAlc / MEAL_HOURS.length;
    const sleepH = dayIn.sleepHours;
    let tdee = 0;
    let rmr = 0;
    let tef = 0;
    let neat = 0;
    let ei = 0;
    for (let h = 0; h < 24; h++) {
      this.clock.hourOfDay = h;
      this.clock.hourIndex = this.clock.day * 24 + h;
      const hr = this.hour;
      hr.hourOfDay = h;
      hr.day = d;
      hr.hourIndex = this.clock.hourIndex;
      // asleep: wake at 07:00; tonight's bedtime = 7 + (24 − sleep) (h ≥ bed)
      const bed = 7 + (24 - sleepH);
      hr.asleep = h < 7 ? 1 : h >= bed ? Math.min(1, h + 1 - bed) : 0;
      bus.eAbsKcalH = h === 8 || h === 13 || h === 19 ? perMeal : 0;
      bus.alcOxGH = 0;
      drive?.(bus, d, h);
      energyModule.stepHour(this.s, this.k, bus, hr, dayIn, this.clock);
      const tH = bus.teePreKcalH + bus.depositionCostKcalH + bus.dnlHeatKcalH;
      tdee += tH;
      rmr += bus.rmrKcalH;
      tef += this.s.hx[HX.tefH]!;
      neat += this.s.hx[HX.neatH]!;
      ei += bus.eAbsKcalH;
    }
    energyModule.endOfDay(this.s, this.k, bus, dayIn, this.clock);
    this.day++;
    return {
      day: d,
      tdee,
      rmr,
      tef,
      neat,
      ei,
      atR: this.s.atR,
      atN: this.s.atN,
      comp: this.s.compKcalD,
      maintenance: bus.maintenanceKcalD,
      tdeeEst: bus.tdeeEstKcalD,
    };
  }

  /**
   * Burn-in of `n` habitual days with clock.day < 0 (latches the GNG profile on day −1), then the module's `endBurnIn`
   * hook exactly as the core loop calls it (NEAT0 calibration, reference reset; MODEL_SPEC §3.4).
   */
  burnIn(n = 14, drive?: HourDrive): DaySummary {
    let last!: DaySummary;
    const start = this.day;
    for (let b = 0; b < n; b++) last = this.runDay(this.habitualPlan(), drive, b - n);
    this.day = start;
    energyModule.endBurnIn!(this.s, this.k, this.bus, { ...this.ctx, burnInDays: n });
    return last;
  }

  runDays(n: number, plan: DayPlan | ((day: number) => DayPlan), drive?: HourDrive): DaySummary[] {
    const out: DaySummary[] = [];
    for (let i = 0; i < n; i++) out.push(this.runDay(typeof plan === 'function' ? plan(this.day) : plan, drive));
    return out;
  }
}

export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
