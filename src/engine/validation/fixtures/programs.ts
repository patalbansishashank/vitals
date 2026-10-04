/**
 * Program and schedule builders for validation scenarios. Everything returns plain `DayTemplate` / `Schedule` data in
 * the engine's input schema (`types/schedule.ts`), i.e. exactly what the Simulator UI and the planner decoder emit.
 *
 * Conventions
 *  - `buildSchedule` appends `extraDays` (default 1) repeating the last day so that morning ('wake') series exist for
 *    the day after the study ends: "weight after 24 weeks" is the morning of day 168 (see `harness/view.ts`).
 *  - "Macronutrient-neutral" means the habitual split (06 §2.4 NHANES, the same defaults `resolveProfile` uses for
 *    EI0): protein 15.6 %E, carbohydrate 45.4 (M) / 46.3 (F) %E, fat = remainder, fibre 8 g/1000 kcal.
 */
import { DEFAULTS } from '../../core/defaults';
import { compileSchedule, habitualWeekPrograms } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type {
  DayTemplate,
  EnergySpec,
  ExerciseSession,
  FastEvent,
  MacroSpec,
  MealPlan,
  PersonProfile,
  Schedule,
  ScheduleBlock,
  ScheduleDay,
} from '../../types';
import { START_DATE } from './personas';

// ------------------------------------------------------------------ macros

/** Habitual (macronutrient-neutral) split as %E; fat takes the remainder. */
export function neutralMacros(sex: 'male' | 'female' = 'male'): MacroSpec {
  return {
    protein: { unit: 'pctEnergy', value: DEFAULTS.habitualProteinPctEnergy },
    carbs: { unit: 'pctEnergy', value: DEFAULTS.habitualCarbPctEnergy[sex] },
    fat: { unit: 'remainder' },
  };
}

/** Protein and carbohydrate as % of energy; fat = remainder. */
export function pctMacros(proteinPct: number, carbPct: number, extra: Partial<MacroSpec> = {}): MacroSpec {
  return { protein: { unit: 'pctEnergy', value: proteinPct }, carbs: { unit: 'pctEnergy', value: carbPct }, fat: { unit: 'remainder' }, ...extra };
}

/** Protein g/kg body weight (reference follows the energy reference), carbohydrate %E, fat = remainder. */
export function proteinPerKgMacros(gPerKg: number, carbPct: number, extra: Partial<MacroSpec> = {}): MacroSpec {
  return { protein: { unit: 'gPerKgBw', value: gPerKg }, carbs: { unit: 'pctEnergy', value: carbPct }, fat: { unit: 'remainder' }, ...extra };
}

/** Absolute grams of protein and carbohydrate, fat = remainder. */
export function gramMacros(proteinG: number, carbG: number, extra: Partial<MacroSpec> = {}): MacroSpec {
  return { protein: { unit: 'g', value: proteinG }, carbs: { unit: 'g', value: carbG }, fat: { unit: 'remainder' }, ...extra };
}

/** Protein, carbohydrate and fat all as %E (must sum to ≈ 100 − fibre share; the compiler reports an overflow note). */
export function pctMacros3(proteinPct: number, carbPct: number, fatPct: number, extra: Partial<MacroSpec> = {}): MacroSpec {
  return { protein: { unit: 'pctEnergy', value: proteinPct }, carbs: { unit: 'pctEnergy', value: carbPct }, fat: { unit: 'pctEnergy', value: fatPct }, ...extra };
}

/** Zero macros (water-only day). */
export const ZERO_MACROS: MacroSpec = { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 } };

// ------------------------------------------------------------------ programs

export interface ProgramExtras {
  meals?: MealPlan;
  exercise?: ExerciseSession[];
  steps?: number;
  food?: DayTemplate['food'];
  sleep?: DayTemplate['sleep'];
  substances?: DayTemplate['substances'];
  hydration?: DayTemplate['hydration'];
  modifiers?: DayTemplate['modifiers'];
}

/**
 * Program at `pct` % of maintenance (default reference 'baseline'; pass reference for 'current' / 'blockStart'). Since
 * R-MAINT the maintenance is the one at the schedule's PLANNED activity; `activity: 'habitual'` keeps it at the person's
 * habitual activity — "% of the habitual intake", for protocols that set intake relative to baseline intake while adding
 * or removing exercise (e.g. CALERIE CR + EX, MET-2's unchanged intake).
 */
export function pctProgram(
  id: string,
  pct: number,
  macros: MacroSpec,
  extras: ProgramExtras = {},
  reference?: 'baseline' | 'current' | 'blockStart',
  activity?: 'planned' | 'habitual',
): DayTemplate {
  const energy: EnergySpec = { kind: 'pctMaintenance', pct, ...(reference ? { reference } : {}), ...(activity ? { activity } : {}) };
  return { id, label: id, energy, macros, ...extras };
}

/** Program at an absolute energy intake, kcal/d. */
export function kcalProgram(id: string, kcal: number, macros: MacroSpec, extras: ProgramExtras = {}): DayTemplate {
  return { id, label: id, energy: { kind: 'kcal', kcal }, macros, ...extras };
}

/** Water-only day (zero energy, zero protein). */
export function waterOnlyProgram(id = 'water', extras: ProgramExtras = {}): DayTemplate {
  return { id, label: id, energy: { kind: 'zero' }, macros: ZERO_MACROS, ...extras };
}

/** Maintenance (100 % of baseline maintenance) at the habitual macro split. */
export function maintenanceProgram(sex: 'male' | 'female' = 'male', extras: ProgramExtras = {}): DayTemplate {
  return pctProgram('maintenance', 100, neutralMacros(sex), extras);
}

// ------------------------------------------------------------------ exercise

/** A resistance session at `startH` with a descriptor volume (09 §4.1 presets) or explicit sets per region. */
export function rtSession(startH: number, opts: Partial<Omit<Extract<ExerciseSession, { kind: 'resistance' }>, 'kind' | 'startH'>> = {}): ExerciseSession {
  return { kind: 'resistance', startH, volume: 'moderate', ...opts };
}

/** A cardio session. */
export function cardioSession(modality: Extract<ExerciseSession, { kind: 'cardio' }>['modality'], startH: number, durationMin: number, opts: Partial<Omit<Extract<ExerciseSession, { kind: 'cardio' }>, 'kind' | 'modality' | 'startH' | 'durationMin'>> = {}): ExerciseSession {
  return { kind: 'cardio', modality, startH, durationMin, ...opts };
}

// ------------------------------------------------------------------ schedules

export interface BuildScheduleOpts {
  /** Study length, days. */
  days: number;
  programs: DayTemplate[];
  /**
   * Which program each day uses: a single index (all days), a repeating pattern (index by day mod length; Monday first),
   * or a function of the day index.
   */
  use?: number | readonly number[] | ((day: number) => number);
  /** Extra trailing days repeating the last day (default 1, see file header). */
  extraDays?: number;
  startDate?: string;
  events?: FastEvent[];
  blocks?: ScheduleBlock[];
  /** Per-day overrides by day index. */
  overrides?: Record<number, NonNullable<ScheduleDay['override']>>;
  energyReference?: 'baseline' | 'current' | 'blockStart';
}

export function buildSchedule(o: BuildScheduleOpts): Schedule {
  const extra = o.extraDays ?? 1;
  const horizon = o.days + extra;
  const sel = o.use ?? 0;
  const pick = (d: number): number => {
    const dd = Math.min(d, o.days - 1);
    if (typeof sel === 'number') return sel;
    if (typeof sel === 'function') return sel(dd);
    return sel[dd % sel.length] as number;
  };
  const days: ScheduleDay[] = Array.from({ length: horizon }, (_, d) => {
    const ov = o.overrides?.[d];
    return ov ? { program: pick(d), override: ov } : { program: pick(d) };
  });
  return {
    schemaVersion: 1,
    startDate: o.startDate ?? START_DATE,
    horizonDays: horizon,
    programs: o.programs,
    days,
    ...(o.events ? { events: o.events } : {}),
    ...(o.blocks ? { blocks: o.blocks } : {}),
    ...(o.energyReference ? { defaults: { energyReference: o.energyReference } } : {}),
  };
}

/** One program for the whole study. */
export function constantSchedule(days: number, program: DayTemplate, extra: Omit<BuildScheduleOpts, 'days' | 'programs' | 'use'> = {}): Schedule {
  return buildSchedule({ days, programs: [program], use: 0, ...extra });
}

/** Consecutive segments: [{days, program}] where `program` indexes `programs`. */
export function segmentSchedule(programs: DayTemplate[], segments: readonly { days: number; program: number }[], extra: Omit<BuildScheduleOpts, 'days' | 'programs' | 'use'> = {}): Schedule {
  const total = segments.reduce((a, s) => a + s.days, 0);
  const map: number[] = [];
  for (const s of segments) for (let i = 0; i < s.days; i++) map.push(s.program);
  return buildSchedule({ days: total, programs, use: (d) => map[d] as number, ...extra });
}

/** A fast event (water-only span) at a given start day / clock hour. */
export function fastEvent(startDay: number, durationH: number, startH = 20, extra: Partial<FastEvent> = {}): FastEvent {
  return { kind: 'fast', startDay, startH, durationH, ...extra };
}

// ------------------------------------------------------------------ habitual week (O-12)

/**
 * The person's habitual week at 100 % of baseline maintenance, day for day the week the core burns in on: the programs
 * ARE `core/compileSchedule.habitualWeekPrograms` (single definition, MODEL_SPEC §3.4 — TDEE0 kcal, habitual macro grams and
 * fibre, meals, window, steps, sleep, habitual alcohol, `habits.sessionsPerWeek` 60-min sessions at 18:00 on weekdays ⌊7i/N⌋,
 * a `lifingCardioMix` share cardio at the default intensity and the rest resistance with the 09 'moderate' volume). Day d of
 * the schedule is weekday (startWeekday + d) mod 7, exactly as in burn-in. This is the schedule of a weight-stable person,
 * including a habitual exerciser (invariant O-12); `core/__tests__/compileSchedule.test.ts` checks the compiled days equal
 * `habitualWeek`.
 */
export function habitualWeekSchedule(profile: PersonProfile, days: number): Schedule {
  const rp = resolveProfile(profile);
  const programs = habitualWeekPrograms(rp);
  return buildSchedule({ days, programs, use: (d) => (rp.startWeekday + d) % 7, startDate: profile.startDate ?? START_DATE });
}

// ------------------------------------------------------------------ resistance-training weeks

/** Weekdays (Monday = 0) of the n training sessions of a training week, spread as evenly as possible. */
const TRAINING_DAYS: Record<number, readonly number[]> = {
  0: [],
  1: [2],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

export interface TrainingScheduleOpts {
  days: number;
  /**
   * Sessions per week: one number, or a list cycled week by week (e.g. [3, 4] = 3.5 sessions/week on average).
   * Weekdays follow the same spread as `habitualWeekSchedule` (Monday = day 0 of week).
   */
  sessionsPerWeek: number | readonly number[];
  /** What a training day contains. */
  session: ExerciseSession[];
  energy: EnergySpec;
  macros: MacroSpec;
  extras?: ProgramExtras;
  /** Sessions stop after this day index (detraining); default: never. */
  trainUntilDay?: number;
  /** Overrides applied to every day (e.g. sleep). */
  overrides?: BuildScheduleOpts['overrides'];
  blocks?: ScheduleBlock[];
  events?: FastEvent[];
  energyReference?: BuildScheduleOpts['energyReference'];
}

/** Training/rest programs sharing one energy and macro specification, arranged in weeks of `sessionsPerWeek` sessions. */
export function trainingSchedule(o: TrainingScheduleOpts): Schedule {
  const train: DayTemplate = { id: 'train', label: 'train', energy: o.energy, macros: o.macros, ...o.extras, exercise: o.session };
  const rest: DayTemplate = { id: 'rest', label: 'rest', energy: o.energy, macros: o.macros, ...o.extras };
  const per = typeof o.sessionsPerWeek === 'number' ? [o.sessionsPerWeek] : o.sessionsPerWeek;
  return buildSchedule({
    days: o.days,
    programs: [train, rest],
    use: (d) => {
      if (o.trainUntilDay !== undefined && d >= o.trainUntilDay) return 1;
      const week = Math.floor(d / 7);
      const n = Math.max(0, Math.min(7, Math.round(per[week % per.length] as number)));
      return (TRAINING_DAYS[n] ?? []).includes(d % 7) ? 0 : 1;
    },
    ...(o.overrides ? { overrides: o.overrides } : {}),
    ...(o.blocks ? { blocks: o.blocks } : {}),
    ...(o.events ? { events: o.events } : {}),
    ...(o.energyReference ? { energyReference: o.energyReference } : {}),
  });
}

// ------------------------------------------------------------------ energy at the model's own expenditure (review m21)

/**
 * Mean daily TDEE (kcal/d) the engine gives `profile` on `schedule` (record 'daily'; the fixture's own run, not a target).
 * Allocation and one full run per call: fixture construction only.
 */
export function meanModelTeeKcal(profile: PersonProfile, schedule: Schedule): number {
  const rp = resolveProfile(profile);
  const r = runEngine(rp, compileSchedule(schedule, rp), { record: 'daily', series: ['tdee'], collectEvents: false });
  const t = r.daily.tdee!;
  let m = 0;
  for (let i = 0; i < t.length; i++) m += t[i]!;
  return m / t.length;
}

/** The schedule with every program's energy set to `kcal` (absolute, kcal/d). */
export function withConstantKcal(schedule: Schedule, kcal: number): Schedule {
  return { ...schedule, programs: schedule.programs.map((p) => ({ ...p, energy: { kind: 'kcal' as const, kcal: Math.round(kcal) } })) };
}

/**
 * Feed the study's schedule at `factor` × the model's own mean TDEE on it (review m21 "validation fixture must set energy to
 * model TEE"; fixture fix 2026-09-30). `pctMaintenance 100 'current'` is the maintenance at HABITUAL activity, so a study that
 * adds training sessions ran ≈ the sessions' energy (≈ 12 %) below balance. Two fixed-point passes (the second at the first
 * pass's mean TDEE) put the realised balance within ≈ 1 % of `factor`. `teeOf` lets several arms share one arm's expenditure
 * (e.g. both Longland arms at 60 % of the control arm's TEE).
 */
export function atModelTee(profile: PersonProfile, schedule: Schedule, factor = 1, teeOf: Schedule = schedule): Schedule {
  const t1 = meanModelTeeKcal(profile, teeOf);
  const t2 = meanModelTeeKcal(profile, withConstantKcal(teeOf, t1));
  return withConstantKcal(schedule, factor * t2);
}
