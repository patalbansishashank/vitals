/**
 * TEST-ONLY full-engine kit for the fuel → ketones → fasting coupling (integration tests of intake/fuel/ketones/fasting).
 * Runs the REAL engine (`resolveProfile` → `compileSchedule` → `runEngine` over `core/moduleRegistry.MODULES`) through
 * the public input schema and, in addition to the recorded series, captures a few coupling signals hour by hour with a
 * spy around the ketones module's `stepHour` (the spy reads the bus after ketones ran, i.e. this hour's fuel, intake,
 * fasting and ketone values). The spy is a thin wrapper: identical physics, identical call order.
 */
import { compileSchedule } from '../../../core/compileSchedule';
import { runEngine } from '../../../core/loop';
import { MODULES } from '../../../core/moduleRegistry';
import { buildModelParams } from '../../../core/paramsRegistry';
import { resolveProfile } from '../../../core/resolveProfile';
import { DEFAULTS } from '../../../core/defaults';
import type { AnyEngineModule } from '../../../types/module';
import type { PersonProfile, ResolvedProfile } from '../../../types/profile';
import type { RunOptions, SimulationResult } from '../../../types/result';
import type { DayTemplate, FastEvent, MacroSpec, Schedule, ScheduleDay } from '../../../types/schedule';
import type { SignalBus } from '../../../types/signals';
import type { CompiledSchedule } from '../../../types/inputs';

/** Monday. */
export const KIT_START_DATE = '2026-10-05';

export interface BodySpec {
  sex: 'male' | 'female';
  ageYears: number;
  heightCm: number;
  weightKg: number;
  /** DXA-equivalent body fat %; omitted → the body module's own estimate. */
  bodyFatPct?: number;
  steps?: number;
  habitualCarbPctEnergy?: number;
  habitualProteinGPerKg?: number;
  sessionsPerWeek?: number;
  liftingCardioMix?: number;
}

export function kitPerson(b: BodySpec): PersonProfile {
  return {
    schemaVersion: 1,
    body: {
      sex: b.sex,
      ageYears: b.ageYears,
      heightCm: b.heightCm,
      weightKg: b.weightKg,
      ...(b.bodyFatPct !== undefined ? { knownBodyFatPct: b.bodyFatPct, knownBodyFatSource: 'dxa' as const } : {}),
    },
    habits: {
      typicalSteps: b.steps ?? 7000,
      ...(b.habitualCarbPctEnergy !== undefined ? { habitualCarbPctEnergy: b.habitualCarbPctEnergy } : {}),
      ...(b.habitualProteinGPerKg !== undefined ? { habitualProteinGPerKg: b.habitualProteinGPerKg } : {}),
      ...(b.sessionsPerWeek !== undefined ? { sessionsPerWeek: b.sessionsPerWeek } : {}),
      ...(b.liftingCardioMix !== undefined ? { lifingCardioMix: b.liftingCardioMix } : {}),
    },
    startDate: KIT_START_DATE,
  } as PersonProfile;
}

/** Person whose baseline maintenance TDEE0 equals `tdee` (solves the habitual step count; linear in steps). */
export function kitPersonWithTdee(b: BodySpec, tdee: number): PersonProfile {
  const at = (steps: number): number => resolveProfile(kitPerson({ ...b, steps })).tdee0Kcal;
  const t1 = at(4000);
  const t2 = at(12000);
  const steps = Math.min(40000, Math.max(1000, Math.round(4000 + ((tdee - t1) * 8000) / (t2 - t1))));
  return kitPerson({ ...b, steps });
}

/** Habitual (macronutrient-neutral) split: the defaults `resolveProfile` uses for EI0. */
export function neutral(sex: 'male' | 'female'): MacroSpec {
  return {
    protein: { unit: 'pctEnergy', value: DEFAULTS.habitualProteinPctEnergy },
    carbs: { unit: 'pctEnergy', value: DEFAULTS.habitualCarbPctEnergy[sex] },
    fat: { unit: 'remainder' },
  };
}

export const gramsCP = (proteinG: number, carbG: number): MacroSpec => ({
  protein: { unit: 'g', value: proteinG },
  carbs: { unit: 'g', value: carbG },
  fat: { unit: 'remainder' },
});

export const pctCP = (proteinPct: number, carbPct: number): MacroSpec => ({
  protein: { unit: 'pctEnergy', value: proteinPct },
  carbs: { unit: 'pctEnergy', value: carbPct },
  fat: { unit: 'remainder' },
});

export function program(id: string, pct: number, macros: MacroSpec, extra: Partial<DayTemplate> = {}): DayTemplate {
  return { id, label: id, energy: { kind: 'pctMaintenance', pct }, macros, ...extra };
}

export function waterDay(id = 'water'): DayTemplate {
  return { id, label: id, energy: { kind: 'zero' }, macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 } } };
}

/** Schedule of `days` days; `use(d)` picks the program of day d; optional fast events and per-day overrides. */
export function kitSchedule(days: number, programs: DayTemplate[], use: (d: number) => number, events: FastEvent[] = [], overrides: Record<number, ScheduleDay['override']> = {}): Schedule {
  const dd: ScheduleDay[] = Array.from({ length: days }, (_, d) => {
    const ov = overrides[d];
    return ov ? { program: use(d), override: ov } : { program: use(d) };
  });
  return { schemaVersion: 1, startDate: KIT_START_DATE, horizonDays: days, programs, days: dd, ...(events.length ? { events } : {}) };
}

/** Hourly coupling signals captured by the spy (index = hour since t = 0; burn-in hours are not stored). */
export interface Probe {
  bhb: Float64Array;
  tkb: Float64Array;
  ffa: Float64Array;
  insulinRel: Float64Array;
  insulinUuMl: Float64Array;
  liverG: Float64Array;
  muscleG: Float64Array;
  muscleRel: Float64Array;
  fastActive: Float64Array;
  kcal24: Float64Array;
  carb24: Float64Array;
  aF: Float64Array;
  aS: Float64Array;
  fatOxGH: Float64Array;
  choOxGH: Float64Array;
  protOxGH: Float64Array;
  gngGH: Float64Array;
  dnlGH: Float64Array;
  glcChangeKcalH: Float64Array;
  teeKcalH: Float64Array;
  eAbsKcalH: Float64Array;
  glucose: Float64Array;
  fastProtOxGH: Float64Array;
  ketoneLossKcalH: Float64Array;
  sMus: Float64Array;
  sHep: Float64Array;
  carbTol: Float64Array;
  irIdx: Float64Array;
  exDef: Float64Array;
  fastRmrMult: Float64Array;
  fastRepletionGH: Float64Array;
}

const PROBE_KEYS: readonly (keyof Probe)[] = [
  'bhb', 'tkb', 'ffa', 'insulinRel', 'insulinUuMl', 'liverG', 'muscleG', 'muscleRel', 'fastActive', 'kcal24', 'carb24', 'aF', 'aS',
  'fatOxGH', 'choOxGH', 'protOxGH', 'gngGH', 'dnlGH', 'glcChangeKcalH', 'teeKcalH', 'eAbsKcalH', 'glucose', 'fastProtOxGH', 'ketoneLossKcalH',
  'sMus', 'sHep', 'carbTol', 'irIdx', 'exDef', 'fastRmrMult', 'fastRepletionGH',
];

function capture(p: Probe, h: number, bus: SignalBus): void {
  p.bhb[h] = bus.bhbMmolL;
  p.tkb[h] = bus.tkbMmolL;
  p.ffa[h] = bus.ffaMmolL;
  p.insulinRel[h] = bus.insulinRefRel;
  p.insulinUuMl[h] = bus.insulinUuMl;
  p.liverG[h] = bus.liverGlycogenG;
  p.muscleG[h] = bus.muscleGlycogenG;
  p.muscleRel[h] = bus.muscleGlycogenRel;
  p.fastActive[h] = bus.fastActive;
  p.kcal24[h] = bus.kcalEaten24;
  p.carb24[h] = bus.carbAbs24G;
  p.aF[h] = bus.ketoAdaptFast;
  p.aS[h] = bus.ketoAdaptSlow;
  p.fatOxGH[h] = bus.fatOxGH;
  p.choOxGH[h] = bus.choOxGH;
  p.protOxGH[h] = bus.protOxGH;
  p.gngGH[h] = bus.gngGH;
  p.dnlGH[h] = bus.dnlFatGH;
  p.glcChangeKcalH[h] = bus.glycogenChangeKcalH;
  p.teeKcalH[h] = bus.teePreKcalH;
  p.eAbsKcalH[h] = bus.eAbsKcalH;
  p.glucose[h] = bus.glucoseMmolL;
  p.fastProtOxGH[h] = bus.fastProtOxGH;
  p.ketoneLossKcalH[h] = bus.ketoneLossKcalH;
  p.sMus[h] = bus.sMus;
  p.sHep[h] = bus.sHep;
  p.carbTol[h] = bus.carbTolerance;
  p.irIdx[h] = bus.insulinResistanceIdx;
  p.exDef[h] = bus.muscleGlycogenExDefFrac;
  p.fastRmrMult[h] = bus.fastRmrMult;
  p.fastRepletionGH[h] = bus.fastRepletionGH;
}

export interface KitRun {
  profile: ResolvedProfile;
  compiled: CompiledSchedule;
  result: SimulationResult;
  probe: Probe;
  /** Hourly recorded series value at hour h (record 'full'). */
  hour(id: string, h: number): number;
  /** t = 0 value of a recorded series. */
  initial(id: string): number;
  /** Daily aggregate of day d. */
  day(id: string, d: number): number;
}

export interface KitOptions {
  /** Parameter overrides by id. */
  params?: Record<string, number>;
  burnInDays?: number;
  checks?: boolean;
}

/** Run the full engine with the ketone spy. */
export function runKit(person: PersonProfile, schedule: Schedule, opts: KitOptions = {}): KitRun {
  const profile = resolveProfile(person);
  const compiled = compileSchedule(schedule, profile);
  const n = compiled.nDays * 24;
  const probe = {} as Probe;
  for (const key of PROBE_KEYS) probe[key] = new Float64Array(n).fill(Number.NaN);
  const mods: AnyEngineModule[] = MODULES.map((m) => {
    if (m.id !== 'ketones') return m;
    const inner = m.stepHour.bind(m);
    return {
      ...m,
      stepHour: (s: object, k: object, bus: SignalBus, hour: Parameters<AnyEngineModule['stepHour']>[3], day: Parameters<AnyEngineModule['stepHour']>[4], clock: Parameters<AnyEngineModule['stepHour']>[5]) => {
        inner(s, k, bus, hour, day, clock);
        if (clock.hourIndex >= 0 && clock.hourIndex < n) capture(probe, clock.hourIndex, bus);
      },
    } as AnyEngineModule;
  });
  const options: RunOptions = { mode: 'simulate', record: 'full', burnInDays: opts.burnInDays ?? 14, checks: opts.checks ?? true, collectEvents: true };
  if (opts.params) {
    const base = buildModelParams(mods);
    const v = new Float64Array(base.values);
    for (const [id, val] of Object.entries(opts.params)) {
      const i = base.index.get(id);
      if (i === undefined) throw new Error(`unknown parameter ${id}`);
      v[i] = val;
    }
    options.paramOverrides = v;
  }
  const result = runEngine(profile, compiled, options, mods);
  return {
    profile,
    compiled,
    result,
    probe,
    hour: (id, h) => (result.hourly as Record<string, Float32Array | undefined>)[id]?.[h] ?? Number.NaN,
    initial: (id) => (result.initial as Record<string, number | undefined>)[id] ?? Number.NaN,
    day: (id, d) => (result.daily as Record<string, Float32Array | undefined>)[id]?.[d] ?? Number.NaN,
  };
}

/** Mean of a probe array over hours [a, b). */
export function meanOf(x: Float64Array, a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]!;
  return s / (b - a);
}
