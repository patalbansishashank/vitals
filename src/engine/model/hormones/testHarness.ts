/**
 * Test support for the hormones and appetite modules (WP-M10): drives the two modules directly with hand-built bus and
 * input values (WP_BRIEF: other modules are stubs until integration). Not used by the engine.
 *
 * `DayDriver` holds one ModuleContext, one bus, one DayInput and one HourInput and runs the day hooks of the selected
 * modules in engine order (hormones before appetite, MODEL_SPEC §3.1). The caller sets the bus signals the modules read
 * (energy balance, masses, BHB, sleep debt …) and the DayInput fields (energy, macros, fibre, meals …) before each day.
 */
import type { AnyEngineModule, EngineModule, ModuleContext, RunMode, StepClock } from '../../types/module';
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import type { CompiledSchedule, DayInput, HourInput } from '../../types/inputs';
import type { SafetyTrace } from '../../types/result';
import { createSignalBus, type SignalBus } from '../../types/signals';
import { N_SERIES } from '../../types/metrics';
import { buildModelParams, withOverrides } from '../../core/paramsRegistry';
import { habitualDay, newHourInput } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { hormonesModule, type HormonesK, type HormonesState } from './index';
import { appetiteModule, type AppetiteK, type AppetiteState } from '../appetite/index';

export const TEST_MODULES: readonly AnyEngineModule[] = [
  hormonesModule as unknown as AnyEngineModule,
  appetiteModule as unknown as AnyEngineModule,
];

/** Resolve a person and override selected baseline quantities (e.g. dossier reference subjects). */
export function makeProfile(person: PersonProfile, overrides: Partial<ResolvedProfile> = {}): ResolvedProfile {
  return { ...resolveProfile(person), ...overrides };
}

function newSafetyTrace(): SafetyTrace {
  const f = () => new Float32Array(1);
  return {
    ei7: f(), tdee7: f(), deficitPct7: f(), ea7: f(), tissueMassKg: f(), rate14KgPerWk: f(), rate14PctPerWk: f(),
    cumLossPct: f(), bmi: f(), bodyFatPct: f(), fastHMax: f(), fastH7: f(), proteinGPerKgRw: f(), fatPctEnergy: f(), hungerIdx: f(),
  };
}

/** Optional context settings of the test rigs (defaults: simulate mode, every series recorded, no adherence levers). */
export interface ContextOpts {
  paramValues?: Float64Array;
  mode?: RunMode;
  seriesEnabled?: Uint8Array;
  adherence?: CompiledSchedule['adherence'];
}

export function makeContext(profile: ResolvedProfile, day: DayInput, opts: ContextOpts = {}): ModuleContext {
  const base = buildModelParams(TEST_MODULES);
  const schedule: CompiledSchedule = {
    nDays: 1,
    startDate: day.dateISO,
    startWeekday: 0,
    days: [day],
    fastSpans: [],
    notes: [],
    ...(opts.adherence ? { adherence: opts.adherence } : {}),
  };
  return {
    profile,
    params: opts.paramValues ? withOverrides(base, opts.paramValues) : base,
    schedule,
    nDays: 1,
    mode: opts.mode ?? 'simulate',
    seriesEnabled: opts.seriesEnabled ?? new Uint8Array(N_SERIES).fill(1),
    events: { emit: () => {} },
    checks: true,
    safetyTrace: newSafetyTrace(),
  };
}

type Mod<S extends object, K extends object> = EngineModule<S, K>;

/** Runs hormones + appetite day by day on hand-set bus values. */
export class DayDriver {
  readonly ctx: ModuleContext;
  readonly bus: SignalBus;
  readonly day: DayInput;
  readonly hour: HourInput;
  readonly clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  readonly hk: HormonesK;
  readonly ak: AppetiteK;
  readonly hs: HormonesState;
  readonly as: AppetiteState;
  /** Optional per-hour hook (e.g. to set hoursSinceMealH or insulin each hour). */
  onHour: ((hourOfDay: number, bus: SignalBus) => void) | null = null;

  constructor(
    readonly profile: ResolvedProfile,
    opts: ContextOpts & { startDay?: number } = {},
  ) {
    this.day = habitualDay(profile);
    this.hour = newHourInput();
    this.ctx = makeContext(profile, this.day, opts);
    this.bus = createSignalBus();
    // baseline body on the bus (composition/water stubs would otherwise hold their generic defaults)
    this.bus.fatMassKg = profile.fm0Kg;
    this.bus.ffmActKg = profile.ffm0Kg;
    this.bus.tissueMassKg = profile.fm0Kg + profile.ffm0Kg;
    this.bus.scaleWeightKg = profile.weightKg;
    this.bus.fibreEffG = profile.habitualFibreG;
    this.bus.tdeeEstKcalD = profile.tdee0Kcal;
    this.bus.hoursSinceMealH = 4;
    this.clock.day = opts.startDay ?? 0;
    const h = hormonesModule as Mod<HormonesState, HormonesK>;
    const a = appetiteModule as Mod<AppetiteState, AppetiteK>;
    this.hk = h.prepare(this.ctx);
    this.ak = a.prepare(this.ctx);
    this.hs = h.init(this.hk, this.ctx, this.bus);
    this.as = a.init(this.ak, this.ctx, this.bus);
  }

  /** Run one day of both modules (startDay, 24 × stepHour, endOfDay) and advance the clock. */
  runDay(): void {
    const h = hormonesModule as Mod<HormonesState, HormonesK>;
    const a = appetiteModule as Mod<AppetiteState, AppetiteK>;
    const { bus, day, hour, clock } = this;
    h.startDay(this.hs, this.hk, bus, day, clock);
    a.startDay(this.as, this.ak, bus, day, clock);
    for (let hh = 0; hh < 24; hh++) {
      clock.hourOfDay = hh;
      clock.hourIndex = clock.day * 24 + hh;
      hour.hourOfDay = hh;
      hour.hourIndex = clock.hourIndex;
      if (this.onHour) this.onHour(hh, bus);
      h.stepHour(this.hs, this.hk, bus, hour, day, clock);
      a.stepHour(this.as, this.ak, bus, hour, day, clock);
    }
    h.endOfDay(this.hs, this.hk, bus, day, clock);
    a.endOfDay(this.as, this.ak, bus, day, clock);
    clock.day++;
  }

  /** End of burn-in hook of both modules (MODEL_SPEC §3.4); resets the clock to day 0. */
  endBurnIn(): void {
    const h = hormonesModule as Mod<HormonesState, HormonesK>;
    const a = appetiteModule as Mod<AppetiteState, AppetiteK>;
    h.endBurnIn?.(this.hs, this.hk, this.bus, this.ctx);
    a.endBurnIn?.(this.as, this.ak, this.bus, this.ctx);
    this.clock.day = 0;
  }

  /** Record one daily frame of both modules. */
  record(): Float64Array {
    const out = new Float64Array(N_SERIES).fill(Number.NaN);
    (hormonesModule as Mod<HormonesState, HormonesK>).recordDay(this.hs, this.hk, this.bus, out);
    (appetiteModule as Mod<AppetiteState, AppetiteK>).recordDay(this.as, this.ak, this.bus, out);
    return out;
  }

  /** Set the day's intake: energy and macros (g), fibre g; energy defaults to the Atwater sum when omitted. */
  setIntake(x: { proteinG: number; carbG: number; fatG: number; fibreG?: number; energyKcal?: number; alcoholG?: number; nMeals?: number }): void {
    const d = this.day;
    d.proteinG = x.proteinG;
    d.carbG = x.carbG;
    d.fatG = x.fatG;
    d.fibreG = x.fibreG ?? d.fibreG;
    d.viscousFibreG = d.fibreG * 0.15;
    d.alcoholG = x.alcoholG ?? 0;
    d.energyKcal = x.energyKcal ?? 4 * x.proteinG + 4 * x.carbG + 9 * x.fatG + 2 * d.fibreG + 7 * d.alcoholG;
    if (x.nMeals !== undefined) d.nMeals = x.nMeals;
  }
}

/** Energy-matched macro split: protein g fixed, carbohydrate as a share of the remaining energy, fat the rest. */
export function macrosFor(energyKcal: number, proteinG: number, carbShareOfRest: number, fibreG = 0): { proteinG: number; carbG: number; fatG: number; fibreG: number; energyKcal: number } {
  const rest = Math.max(0, energyKcal - 4 * proteinG - 2 * fibreG);
  const carbG = (carbShareOfRest * rest) / 4;
  const fatG = ((1 - carbShareOfRest) * rest) / 9;
  return { proteinG, carbG, fatG, fibreG, energyKcal };
}
