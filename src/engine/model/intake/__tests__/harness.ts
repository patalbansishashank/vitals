/**
 * Test harness: drives the intake module directly with hand-built bus/input values (WP_BRIEF: never through the full
 * loop, other modules are stubs).
 */
import { intakeModule, type IntakeConst, type IntakeState } from '../index';
import { moderatorsModule } from '../../moderators';
import { buildModelParams, withOverrides } from '../../../core/paramsRegistry';
import { resolveProfile } from '../../../core/resolveProfile';
import { DayHourTable, compileSchedule, expandDayToHours, habitualDay, habitualTemplate, loadHour, newHourInput } from '../../../core/compileSchedule';
import { createSignalBus, type SignalBus } from '../../../types/signals';
import { N_SERIES } from '../../../types/metrics';
import type { DayInput, HourInput } from '../../../types/inputs';
import type { EventSink, ModuleContext, StepClock } from '../../../types/module';
import type { PersonProfile, ResolvedProfile } from '../../../types/profile';
import type { Schedule } from '../../../types/schedule';
import type { SafetyTrace } from '../../../types/result';
import type { AnyEngineModule } from '../../../types/module';

export const MAN_80: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 80 },
  startDate: '2026-10-05',
};
export const WOMAN_65: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 65 },
  startDate: '2026-10-05',
};

// moderators is registered for its parameters only: intake reads the caffeine half-life from `moderators.caffeineTHalfH`
const MODS = [intakeModule, moderatorsModule] as unknown as readonly AnyEngineModule[];

export interface Harness {
  k: IntakeConst;
  s: IntakeState;
  bus: SignalBus;
  hour: HourInput;
  day: DayInput;
  clock: StepClock;
  profile: ResolvedProfile;
  /** Absolute hour index of the next step. */
  t: number;
  /** Advance one hour with the current `hour` fields, then zero the intake fields. Calls startDay/endOfDay at day edges. */
  step(): void;
  /** Advance n empty hours. */
  idle(n: number): void;
  /** Put a meal (or substance) into the next hour. */
  eat(m: Partial<HourInput>): void;
  /** Run one whole compiled day (must start at hour 0 of a day); `onHour` sees the bus after each hour. */
  runDay(d: DayInput, onHour?: (hourOfDay: number) => void): void;
}

function emptyTrace(): SafetyTrace {
  const f = () => new Float32Array(1);
  return {
    ei7: f(), tdee7: f(), deficitPct7: f(), ea7: f(), tissueMassKg: f(), rate14KgPerWk: f(), rate14PctPerWk: f(),
    cumLossPct: f(), bmi: f(), bodyFatPct: f(), fastHMax: f(), fastH7: f(), proteinGPerKgRw: f(), fatPctEnergy: f(), hungerIdx: f(),
  };
}

export function makeCtx(profile: ResolvedProfile, overrides?: Record<string, number>): ModuleContext {
  const base = buildModelParams(MODS);
  let params = base;
  if (overrides) {
    const v = new Float64Array(base.values);
    for (const [id, val] of Object.entries(overrides)) {
      const i = base.index.get(id);
      if (i === undefined) throw new Error(`unknown ${id}`);
      v[i] = val;
    }
    params = withOverrides(base, v);
  }
  const events: EventSink = { emit: () => {} };
  const sched: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 1, programs: [habitualTemplate(profile)], days: [{ program: 0 }] };
  return {
    profile,
    params,
    schedule: compileSchedule(sched, profile),
    nDays: 1,
    mode: 'simulate',
    seriesEnabled: new Uint8Array(N_SERIES).fill(1),
    events,
    checks: true,
    safetyTrace: emptyTrace(),
  };
}

/** A day with no meals (so hand-fed hours are the only intake); energy/fibre fields settable by the test. */
export function blankDay(profile: ResolvedProfile): DayInput {
  const d = habitualDay(profile);
  d.nMeals = 0;
  d.energyKcal = 0;
  d.fibreG = 0;
  d.viscousFibreG = 0;
  d.nutsG = 0;
  d.nutDelta = 0;
  d.caffeineMg = 0;
  d.creatineG = 0;
  d.creatineLoading = false;
  return d;
}

const INTAKE_KEYS = [
  'kcal', 'proteinG', 'carbG', 'glucoseEqG', 'fructoseG', 'galactoseG', 'fatG', 'satFatG', 'mctG', 'fibreG', 'alcoholG',
  'mealStart', 'caffeineMg', 'exoKetoneG', 'exMin', 'exIntensityFrac', 'exModality', 'exMet', 'exCarbG', 'exCarbDuringGPerMin',
] as const;

export function zeroIntake(h: HourInput): void {
  for (const key of INTAKE_KEYS) h[key] = 0;
  h.proteinQMeal = 1;
  h.proteinSpeed = 1;
  h.timeToPeakH = 1;
  h.glycaemicIndex = 55;
}

/**
 * Build a harness; the bus carries neutral values of the signals intake reads (S_hep = S_mus = T_C = 1, liver glycogen
 * well above G_ref, body mass = entered weight). `startHour` sets the clock (default 08:00 of day 0).
 */
export function makeHarness(input: PersonProfile = MAN_80, opts: { overrides?: Record<string, number>; startHourOfDay?: number } = {}): Harness {
  const profile = resolveProfile(input);
  const ctx = makeCtx(profile, opts.overrides);
  const k = intakeModule.prepare(ctx);
  const bus = createSignalBus();
  bus.liverGlycogenG = 100;
  bus.tissueMassKg = profile.weightKg;
  const s = intakeModule.init(k, ctx, bus);
  const hour = newHourInput();
  zeroIntake(hour);
  const day = blankDay(profile);
  const h0 = opts.startHourOfDay ?? 8;
  const clock: StepClock = { day: 0, hourOfDay: h0, hourIndex: h0, weekday: 0 };
  const H: Harness = {
    k,
    s,
    bus,
    hour,
    day,
    clock,
    profile,
    t: h0,
    step() {
      const d = Math.floor(H.t / 24);
      const hod = H.t - 24 * d;
      if (hod === 0 || H.t === h0) intakeModule.startDay(s, k, bus, H.day, clock);
      clock.day = d;
      clock.hourOfDay = hod;
      clock.hourIndex = H.t;
      hour.day = d;
      hour.hourOfDay = hod;
      hour.hourIndex = H.t;
      intakeModule.stepHour(s, k, bus, hour, H.day, clock);
      if (hod === 23) intakeModule.endOfDay(s, k, bus, H.day, clock);
      zeroIntake(hour);
      H.t++;
    },
    idle(n: number) {
      for (let i = 0; i < n; i++) H.step();
    },
    eat(m: Partial<HourInput>) {
      Object.assign(hour, m);
      if (m.kcal === undefined) {
        const p = m.proteinG ?? 0;
        const c = m.carbG ?? 0;
        const f = m.fatG ?? 0;
        const fib = m.fibreG ?? 0;
        const a = m.alcoholG ?? 0;
        hour.kcal = 4 * p + 4 * c + 9 * f + 2 * fib + 7 * a;
      }
      if (m.carbG !== undefined && m.glucoseEqG === undefined) hour.glucoseEqG = m.carbG - (m.fructoseG ?? 0) - (m.galactoseG ?? 0);
      hour.mealStart = 1;
    },
    runDay(d: DayInput, onHour?: (hourOfDay: number) => void) {
      if (H.t % 24 !== 0) throw new Error('runDay must start at hour 0');
      H.day = d;
      expandDayToHours(d, d.sleepBedH, d.sleepHours, null, 0, table);
      for (let h = 0; h < 24; h++) {
        loadHour(table, h, hour);
        H.step();
        onHour?.(h);
      }
    },
  };
  const table = new DayHourTable();
  return H;
}

/** 5-min explicit Euler reference of dE/dt = −V·E/(K + E) (MODEL_SPEC §0.1 accuracy tests). */
export function eulerMM(e0: number, v: number, km: number, hours: number, dtH = 1 / 12): number {
  let e = e0;
  const n = Math.round(hours / dtH);
  for (let i = 0; i < n; i++) e = Math.max(0, e - (v * e) / (km + e) * dtH);
  return e;
}
