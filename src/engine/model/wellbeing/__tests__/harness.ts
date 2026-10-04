/**
 * Test harness: drives the wellbeing module directly with hand-built bus / hour / day values (WP_BRIEF: never through
 * the full loop, the other modules are stubs). One `run()` call simulates whole days: intake at 08:00 / 13:00 / 19:00,
 * an exercise bout at 17:00, then `endOfDay`.
 */
import { wellbeingModule, type WellbeingConstants, type WellbeingState } from '../index';
import { buildModelParams, withOverrides } from '../../../core/paramsRegistry';
import { resolveProfile } from '../../../core/resolveProfile';
import { compileSchedule, habitualDay, newHourInput } from '../../../core/compileSchedule';
import { createSignalBus, type SignalBus } from '../../../types/signals';
import { N_SERIES, MI } from '../../../types/metrics';
import type { DayInput, HourInput } from '../../../types/inputs';
import type { AnyEngineModule, EventSink, ModuleContext, StepClock } from '../../../types/module';
import type { PersonProfile, ResolvedProfile } from '../../../types/profile';
import type { Schedule } from '../../../types/schedule';
import type { SafetyTrace } from '../../../types/result';

export const MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 80 },
  habits: { typicalSteps: 7000, sessionsPerWeek: 3 },
  startDate: '2026-10-05',
};
export const WOMAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 },
  startDate: '2026-10-05',
};

const MODS = [wellbeingModule] as unknown as readonly AnyEngineModule[];

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
      if (i === undefined) throw new Error(`unknown parameter ${id}`);
      v[i] = val;
    }
    params = withOverrides(base, v);
  }
  const events: EventSink = { emit: () => {} };
  const sched: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 1, programs: [{ id: 'x', label: 'x', energy: { kind: 'kcal', kcal: 2000 }, macros: { protein: { unit: 'g', value: 100 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } } }], days: [{ program: 0 }] };
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

/** What one simulated day contains; every field defaults to the habitual weight-stable day. */
export interface Scenario {
  /** Energy ingested, kcal (0 = zero-intake day). */
  ei?: number;
  carb?: number;
  fat?: number;
  fibre?: number;
  /** Net session exercise energy (EEE of ruling R-EA), kcal. */
  eee?: number;
  /** Exercise minutes and resistance sets of the 17:00 bout. */
  exMin?: number;
  rtSets?: number;
  sodiumMg?: number;
  quality?: number;
  /** Fasting overlay active for the whole day. */
  fast?: boolean;
  /** Fat per meal, g (defaults to the fat split evenly over three meals). */
  mealFat?: number;
}

export interface Harness {
  profile: ResolvedProfile;
  ctx: ModuleContext;
  k: WellbeingConstants;
  s: WellbeingState;
  bus: SignalBus;
  hour: HourInput;
  day: DayInput;
  clock: StepClock;
  /** Habitual scenario values. */
  base: Required<Omit<Scenario, 'fast' | 'mealFat'>>;
  /** Index of the next day (negative during burn-in). */
  dayIdx: number;
  /** Simulate `n` days of the scenario (fields merged over the habitual day). */
  run(sc?: Scenario, n?: number): void;
  /** 14 habitual days with clock.day < 0 (like the engine's burn-in); day counter restarts at 0. */
  burnIn(n?: number): void;
  /** Daily record frame after the last day. */
  record(): Float64Array;
}

export function makeHarness(input: PersonProfile = MAN, opts: { overrides?: Record<string, number>; noBurnIn?: boolean; bus?: Partial<SignalBus> } = {}): Harness {
  const profile = resolveProfile(input);
  const ctx = makeCtx(profile, opts.overrides);
  const k = wellbeingModule.prepare(ctx);
  const bus = createSignalBus();
  // neutral upstream state: body composition of the profile, scale = entered weight, glycogen at the fed reference
  bus.fatMassKg = profile.fm0Kg;
  bus.ffmActKg = profile.ffm0Kg;
  bus.labileWaterKg = profile.weightKg - profile.fm0Kg - profile.ffm0Kg;
  bus.tissueMassKg = profile.fm0Kg + profile.ffm0Kg;
  bus.skeletalMuscleKg = 30;
  bus.muscleGlycogenG = 30 * 17.3; // ≈ 107 mmol/kg ww → 1.73 g/100 g ww
  bus.muscleGlycogenRel = 1;
  bus.vo2maxMlKgMin = 42;
  bus.ageYears = profile.ageYears;
  Object.assign(bus, opts.bus ?? {});
  const s = wellbeingModule.init(k, ctx, bus);
  const hour = newHourInput();
  const day = habitualDay(profile);
  const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  const base = {
    ei: profile.tdee0Kcal,
    carb: profile.habitualCarbG,
    fat: profile.habitualFatG,
    fibre: profile.habitualFibreG,
    eee: 0,
    exMin: 0,
    rtSets: 0,
    sodiumMg: 3000,
    quality: 2,
  };
  const mealHours = [8, 13, 19];

  const h: Harness = {
    profile, ctx, k, s, bus, hour, day, clock, base, dayIdx: 0,
    run(sc: Scenario = {}, n = 1) {
      const v = { ...base, ...sc };
      const fast = sc.fast === true;
      for (let d = 0; d < n; d++) {
        day.sodiumMg = v.sodiumMg;
        day.foodQuality = v.quality;
        day.fibreG = v.fibre;
        day.nMeals = 3;
        for (let i = 0; i < 3; i++) day.meals[i]!.fatG = sc.mealFat ?? v.fat / 3;
        clock.day = h.dayIdx;
        for (let hr = 0; hr < 24; hr++) {
          clock.hourOfDay = hr;
          clock.hourIndex = h.dayIdx * 24 + hr;
          hour.kcal = 0; hour.carbG = 0; hour.fatG = 0; hour.fibreG = 0; hour.proteinG = 0; hour.exMin = 0; hour.rtSetsTotal = 0;
          bus.exSessionNetKcalH = 0;
          bus.fastActive = fast ? 1 : 0;
          if (!fast && mealHours.includes(hr)) {
            hour.kcal = v.ei / 3; hour.carbG = v.carb / 3; hour.fatG = v.fat / 3; hour.fibreG = v.fibre / 3;
          }
          if (hr === 17) {
            hour.exMin = v.exMin;
            hour.rtSetsTotal = v.rtSets;
            bus.exSessionNetKcalH = v.eee;
          }
          wellbeingModule.stepHour(h.s, k, bus, hour, day, clock);
        }
        bus.exSessionNetKcalD = v.eee; // activity's daily Σ exSessionNetKcalH (one session at 17:00)
        wellbeingModule.endOfDay(h.s, k, bus, day, clock);
        h.dayIdx++;
      }
    },
    burnIn(n = 14) {
      h.dayIdx = -n;
      h.run({}, n);
      h.dayIdx = 0;
      wellbeingModule.endBurnIn?.(h.s, k, bus, ctx);
    },
    record() {
      const out = new Float64Array(N_SERIES);
      wellbeingModule.recordDay(h.s, k, bus, out);
      return out;
    },
  };
  if (!opts.noBurnIn) h.burnIn();
  return h;
}

export { MI };
