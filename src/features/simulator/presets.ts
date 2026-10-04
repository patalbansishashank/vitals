/**
 * Program presets and scenario starters (simulator-schedule.md §6).
 *
 * Presets are defined by composition — energy as % of maintenance and macros in g, g/kg or % energy — never by diet
 * brand. The familiar term, where one exists, is only a search alias shown in ink-3 (DESIGN_DIRECTION §5).
 *
 * Training (ruling R-DETRAIN part 2): a composition preset says nothing about training, so a program made from it
 * trains **as usual** (the user's habitual sessions, `lib/training.ts`); only presets that are explicitly about training
 * (`aboutTraining`) bring their own sessions. Starters likewise train as usual unless the starter is a training plan.
 */
import type { DayTemplate, Schedule, ScheduleDay } from '@/engine';
import { defaultToHabitual, withTrainingMode } from './lib/training';

export type PresetId =
  | 'hpDeficit'
  | 'veryLowCarb'
  | 'balanced'
  | 'highCarbLowFat'
  | 'proteinSparing'
  | 'trainingMaintenance'
  | 'trainingSurplus'
  | 'waterFast'
  | 'refeed'
  | 'maintenance';

export interface ProgramPreset {
  id: PresetId;
  /** Composition-first name (the label the new program gets). */
  name: string;
  /** Familiar search term (ink-3), never the program's name. */
  alias?: string;
  /** One-line composition summary for the menu. */
  summary: string;
  /** Energy the day is stated to deliver: % of maintenance (0 for water-only). */
  statedPct: number;
  /** The preset is about training: it brings its own sessions instead of the user's usual training. */
  aboutTraining?: boolean;
  template: Omit<DayTemplate, 'id'>;
}

const threeMeals = { count: 3, window: { startH: 8, lengthH: 12 }, split: 'even' } as const;
const twoMeals = { count: 2, window: { startH: 12, lengthH: 8 }, split: 'biggerLast' } as const;
const liftEvening = {
  kind: 'resistance',
  startH: 17.5,
  durationMin: 60,
  volume: 'moderate',
  rir: 2,
} as const;

export const PRESETS: readonly ProgramPreset[] = [
  {
    id: 'hpDeficit',
    name: 'higher protein, moderate carbs, lower fat · 20 % deficit',
    summary: '80 % energy · protein 2.2 g/kg · carbs 35 % · fat rest',
    statedPct: 80,
    template: {
      label: 'higher protein · 20 % deficit',
      energy: { kind: 'pctMaintenance', pct: 80 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 2.2 },
        carbs: { unit: 'pctEnergy', value: 35 },
        fat: { unit: 'remainder' },
      },
      meals: threeMeals,
    },
  },
  {
    id: 'veryLowCarb',
    name: 'very low carbohydrate, high fat · ≤ 30 g net carbs',
    alias: 'keto',
    summary: '85 % energy · protein 1.8 g/kg · net carbs 25 g · fat rest',
    statedPct: 85,
    template: {
      label: 'very low carb, high fat',
      energy: { kind: 'pctMaintenance', pct: 85 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 1.8 },
        carbs: { unit: 'g', value: 25 },
        fat: { unit: 'remainder' },
        fibre: { unit: 'g', value: 15 },
      },
      meals: twoMeals,
      hydration: { sodiumG: 4 },
    },
  },
  {
    id: 'balanced',
    name: 'balanced · 10 % deficit',
    summary: '90 % energy · protein 1.8 g/kg · carbs 45 % · fat rest',
    statedPct: 90,
    template: {
      label: 'balanced',
      energy: { kind: 'pctMaintenance', pct: 90 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 1.8 },
        carbs: { unit: 'pctEnergy', value: 45 },
        fat: { unit: 'remainder' },
      },
      meals: threeMeals,
    },
  },
  {
    id: 'highCarbLowFat',
    name: 'high carbohydrate, low fat · 10 % deficit',
    summary: '90 % energy · protein 1.8 g/kg · fat 20 % · carbs rest',
    statedPct: 90,
    template: {
      label: 'high carb, low fat',
      energy: { kind: 'pctMaintenance', pct: 90 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 1.8 },
        carbs: { unit: 'remainder' },
        fat: { unit: 'pctEnergy', value: 20 },
      },
      meals: threeMeals,
    },
  },
  {
    id: 'proteinSparing',
    name: 'protein-only very-low-energy day · 2.5 g/kg lean mass, 45 % energy',
    alias: 'PSMF',
    summary: '45 % energy · protein 2.5 g/kg lean mass · net carbs 30 g · minimal fat',
    statedPct: 45,
    template: {
      label: 'protein-sparing, very low energy',
      energy: { kind: 'pctMaintenance', pct: 45 },
      macros: {
        protein: { unit: 'gPerKgFfm', value: 2.5 },
        carbs: { unit: 'g', value: 30 },
        fat: { unit: 'remainder' },
        proteinSource: 'meat',
      },
      meals: { count: 3, window: { startH: 9, lengthH: 10 }, split: 'even' },
      hydration: { sodiumG: 4, fluidL: 2.5 },
    },
  },
  {
    id: 'trainingMaintenance',
    name: 'training day at maintenance · higher carbohydrate, fat 25 %',
    summary: '100 % energy · protein 2.0 g/kg · fat 25 % · carbs the rest (≈ 3–4 g/kg) · lift 60 min',
    statedPct: 100,
    aboutTraining: true,
    template: {
      label: 'training day',
      energy: { kind: 'pctMaintenance', pct: 100 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 2 },
        carbs: { unit: 'remainder' },
        fat: { unit: 'pctEnergy', value: 25 },
      },
      meals: { count: 3, window: { startH: 8, lengthH: 12 }, split: 'even' },
      exercise: [liftEvening],
      steps: 8000,
    },
  },
  {
    id: 'trainingSurplus',
    name: 'training day · 10 % surplus, higher carbohydrate, fat 25 %',
    alias: 'lean bulk',
    summary: '110 % energy · protein 2.0 g/kg · fat 25 % · carbs the rest (≈ 4–5 g/kg) · lift 60 min',
    statedPct: 110,
    aboutTraining: true,
    template: {
      label: 'training day, surplus',
      energy: { kind: 'pctMaintenance', pct: 110 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 2 },
        carbs: { unit: 'remainder' },
        fat: { unit: 'pctEnergy', value: 25 },
      },
      meals: { count: 4, window: { startH: 8, lengthH: 13 }, split: 'even' },
      exercise: [liftEvening],
      steps: 8000,
    },
  },
  {
    id: 'waterFast',
    name: 'water-only fast day · no energy, no protein',
    alias: 'extended fast',
    summary: 'no energy · water + electrolytes · paint 2–3 days or insert an hour-exact fast',
    statedPct: 0,
    template: {
      label: 'water-only fast',
      energy: { kind: 'zero' },
      macros: {
        protein: { unit: 'g', value: 0 },
        carbs: { unit: 'g', value: 0 },
        fat: { unit: 'remainder' },
      },
      hydration: { electrolytes: true, sodiumG: 2, fluidL: 2.5 },
      steps: 6000,
    },
  },
  {
    id: 'refeed',
    name: 'high-carbohydrate refeed day · 115 % energy, fat 20 %',
    alias: 'refeed',
    summary: '115 % energy · protein 1.8 g/kg · fat 20 % · carbs rest',
    statedPct: 115,
    template: {
      label: 'higher-energy day',
      energy: { kind: 'pctMaintenance', pct: 115 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 1.8 },
        carbs: { unit: 'remainder' },
        fat: { unit: 'pctEnergy', value: 20 },
      },
      meals: threeMeals,
    },
  },
  {
    id: 'maintenance',
    name: 'maintenance · habitual mix',
    summary: '100 % energy · protein 1.6 g/kg · carbs 45 % · fat rest',
    statedPct: 100,
    template: {
      label: 'maintenance',
      energy: { kind: 'pctMaintenance', pct: 100 },
      macros: {
        protein: { unit: 'gPerKgBw', value: 1.6 },
        carbs: { unit: 'pctEnergy', value: 45 },
        fat: { unit: 'remainder' },
      },
      meals: threeMeals,
    },
  },
];

export const PRESET_BY_ID: Readonly<Record<PresetId, ProgramPreset>> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
) as Record<PresetId, ProgramPreset>;

/**
 * A program from a preset with the given letter key (deep copy, so edits never touch the library). Composition presets
 * train as usual; training presets keep their sessions (as an explicit custom choice).
 */
export function programFromPreset(id: PresetId, letter: string): DayTemplate {
  const p = PRESET_BY_ID[id];
  const t: DayTemplate = { id: letter, ...structuredClone(p.template) };
  return p.aboutTraining ? withTrainingMode(t, 'custom') : withTrainingMode(t, 'habitual');
}

// ---------------------------------------------------------------- scenario starters

export type StarterId = 'deficit12' | 'maintenance8' | 'weeklyFast6' | 'blank';

export interface Starter {
  id: StarterId;
  title: string;
  summary: string;
  weeks: number;
  programs: DayTemplate[];
  /** Weekly pattern by weekday (Monday first), as program indices. */
  week: readonly number[];
  name: string;
}

/**
 * The default scenario's program: a moderate deficit every day, training as usual — the diet changes, the user's own
 * training carries on (R-DETRAIN part 2: an ordinary schedule must not silently stop their lifting).
 */
const A_DEFICIT: DayTemplate = withTrainingMode<DayTemplate>(
  {
    id: 'A',
    label: 'moderate deficit',
    energy: { kind: 'pctMaintenance', pct: 80 },
    macros: {
      protein: { unit: 'gPerKgBw', value: 2 },
      carbs: { unit: 'pctEnergy', value: 35 },
      fat: { unit: 'remainder' },
    },
    meals: { count: 3, window: { startH: 8, lengthH: 12 }, split: 'even' },
  },
  'habitual',
);

export const STARTERS: readonly Starter[] = [
  {
    id: 'deficit12',
    title: '12 weeks · moderate deficit',
    summary: '80 % energy, 2.0 g/kg protein, your training as usual',
    name: 'Moderate deficit',
    weeks: 12,
    programs: [A_DEFICIT],
    week: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    // a training plan: its lifting days bring their own sessions, rest days are rest (explicit choices)
    id: 'maintenance8',
    title: '8 weeks · maintenance + training',
    summary: '100 % energy, higher carbs on lifting days, lifting 3× a week',
    name: 'Maintenance + training',
    weeks: 8,
    programs: [
      withTrainingMode<DayTemplate>(
        { ...structuredClone(PRESET_BY_ID.trainingMaintenance.template), id: 'A', label: 'lifting day' },
        'custom',
      ),
      withTrainingMode<DayTemplate>(
        {
          id: 'B',
          label: 'rest day',
          energy: { kind: 'pctMaintenance', pct: 95 },
          macros: {
            protein: { unit: 'gPerKgBw', value: 1.8 },
            carbs: { unit: 'pctEnergy', value: 40 },
            fat: { unit: 'remainder' },
          },
          meals: { count: 3, window: { startH: 8, lengthH: 12 }, split: 'even' },
        },
        'none',
      ),
    ],
    week: [0, 1, 0, 1, 0, 1, 1],
  },
  {
    id: 'weeklyFast6',
    title: '6 weeks · weekly 36 h fasts',
    summary: 'about 85 % energy over the week, one water-only day, training as usual',
    name: 'Weekly 36 h fast',
    weeks: 6,
    programs: [
      defaultToHabitual<DayTemplate>({
        id: 'A',
        label: 'eating day',
        energy: { kind: 'pctMaintenance', pct: 100 },
        macros: {
          protein: { unit: 'gPerKgBw', value: 1.8 },
          carbs: { unit: 'pctEnergy', value: 40 },
          fat: { unit: 'remainder' },
        },
        meals: { count: 3, window: { startH: 8, lengthH: 12 }, split: 'even' },
      }),
      programFromPreset('waterFast', 'B'),
    ],
    week: [0, 0, 0, 0, 0, 0, 1],
  },
  {
    id: 'blank',
    title: 'Blank',
    summary: 'One maintenance program on every day, training as usual',
    name: 'New scenario',
    weeks: 12,
    programs: [programFromPreset('maintenance', 'A')],
    week: [0, 0, 0, 0, 0, 0, 0],
  },
];

export const STARTER_BY_ID: Readonly<Record<StarterId, Starter>> = Object.fromEntries(
  STARTERS.map((s) => [s.id, s]),
) as Record<StarterId, Starter>;

/** Build the engine Schedule of a starter from a start date (weekday-aligned pattern). */
export function starterSchedule(id: StarterId, startDate: string, startWeekday: number): Schedule {
  const st = STARTER_BY_ID[id];
  const n = st.weeks * 7;
  const days: ScheduleDay[] = Array.from({ length: n }, (_, d) => ({
    program: st.week[(startWeekday + d) % 7]!,
  }));
  return {
    schemaVersion: 1,
    startDate,
    horizonDays: n,
    programs: structuredClone(st.programs),
    days,
    defaults: { energyReference: 'baseline' },
  };
}
