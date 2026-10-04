/** `profile.*` (SUITE_SPEC §1.9). */
import {
  ETHNICITIES,
  HABIT_NUMBERS,
  LAB_KEYS,
  QUALITIES,
  SEXES,
  SOURCES,
  STEPS,
} from '@/state/internal/profileModel';
import { applyProfilePatch, patchFields, profileEstimate, profileView, resetShape, setSetupStep } from '@/state/internal/profile';
import { defineCommand } from '../registry';
import { T, type TSchema } from '../schema';
import { ActivitySectionSchema } from '../schema/intake';
import { ALL, SCREEN, UI_ONLY, UNDO } from './_shared';

const NullNum = T.Optional(T.Nullable(T.Number()));
const fromKeys = (keys: readonly string[], s: TSchema) => Object.fromEntries(keys.map((k) => [k, T.Optional(T.Nullable(s))])) as Record<string, ReturnType<typeof T.Optional>>;

const Habits = T.Object({
  ...fromKeys(HABIT_NUMBERS, T.Number()),
  sleepQuality: T.Optional(T.Nullable(T.Enum(['poor', 'fair', 'good']))),
  stress: T.Optional(T.Nullable(T.Enum(['low', 'moderate', 'high']))),
  dietAnimalLevel: T.Optional(T.Nullable(T.Enum(['omnivore', 'pescatarian', 'vegetarian', 'vegan']))),
  foodQuality: T.Optional(T.Nullable(T.NumberEnum([1, 2, 3]))),
  multivitamin: T.Optional(T.Nullable(T.Boolean())),
  smoker: T.Optional(T.Nullable(T.Boolean())),
  activity: T.Optional(T.Nullable(T.As<Record<string, unknown>>(ActivitySectionSchema))),
});

/** `ProfilePatch` = JSON merge patch of the profile document (null clears) + `asStartingPoint`. */
export const ProfilePatch = T.Object(
  {
    sex: T.Optional(T.Nullable(T.Enum(SEXES))),
    figure: T.Optional(
      T.Nullable(T.Object({ frame: T.Optional(T.Nullable(T.Number({ minimum: 0, maximum: 1 }))) }), {
        description: "Drawing only: the figure's frame, 0 = hips-led … 1 = shoulders-led; null = match my basics. Never changes an estimate.",
      }),
    ),
    ageYears: NullNum,
    heightCm: NullNum,
    weightKg: NullNum,
    ethnicity: T.Optional(T.Nullable(T.Enum(ETHNICITIES))),
    shape: T.Optional(
      T.Nullable(
        T.Object({ bodyFatPct: NullNum, belly: NullNum, hips: NullNum, chest: NullNum, arms: NullNum, muscleUpper: NullNum, muscleLower: NullNum }),
      ),
    ),
    waist: T.Optional(T.Nullable(T.Object({ use: T.Optional(T.Boolean()), cm: NullNum, neckCm: NullNum, hipCm: NullNum }))),
    knownBodyFat: T.Optional(T.Nullable(T.Object({ use: T.Optional(T.Boolean()), pct: NullNum, source: T.Optional(T.Enum(SOURCES)) }))),
    training: T.Optional(T.Nullable(T.Object({ years: NullNum, quality: T.Optional(T.Nullable(T.Enum(QUALITIES))) }))),
    habits: T.Optional(T.Nullable(Habits)),
    cycle: T.Optional(
      T.Nullable(
        T.Object({
          tracking: T.Optional(T.Nullable(T.Boolean())),
          cycleLengthD: NullNum,
          lastPeriodStart: T.Optional(T.Nullable(T.Date())),
          contraception: T.Optional(T.Nullable(T.Enum(['none', 'combinedOral', 'progestinOnly', 'iud', 'other']))),
        }),
      ),
    ),
    menopause: T.Optional(T.Nullable(T.Enum(['pre', 'peri', 'post']))),
    labs: T.Optional(T.Nullable(T.Object(fromKeys(LAB_KEYS, T.Number({ minimum: 0 }))))),
    asStartingPoint: T.Optional(T.Boolean({ description: 'Weight edits while a plan runs: this weight is a new starting point.' })),
  },
  { minProperties: 1 },
);

export const ProfileView = T.Object({
  profile: T.OpenObject({ description: 'Stored body inputs, SI units (kg, cm, kcal); null = not entered.' }),
  setup: T.Enum(STEPS),
  complete: T.Boolean(),
});

const Estimate = T.Object({
  bodyFatPct: T.Number(),
  bodyFatSdPct: T.Number(),
  bmi: T.Number(),
  fatMassKg: T.Number(),
  leanMassKg: T.Number(),
  maintenanceKcal: T.Number(),
  maintenanceBand80: T.Tuple([T.Number(), T.Number()]),
  missing: T.Array(T.String()),
  basedOnAverages: T.Boolean(),
});

export const profileGet = defineCommand({
  id: 'profile.get',
  version: 1,
  title: 'Read your body profile',
  description:
    'The body profile as stored (sex, age, height cm, weight kg, shape, measurements, habits, labs; null = not entered) with the live estimate: body fat % (with SD), BMI, fat and lean mass kg and maintenance energy kcal/day with its 80 % likely range.',
  input: T.Object({}),
  output: T.Object({
    profile: T.OpenObject({ description: 'Stored body inputs, SI units (kg, cm, kcal); null = not entered.' }),
    setup: T.Enum(STEPS),
    complete: T.Boolean(),
    estimate: Estimate,
  }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the projection hooks directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: () => ({ ...profileView(), estimate: profileEstimate() }),
});

export const profileExplainMaintenance = defineCommand({
  id: 'profile.explainMaintenance',
  version: 1,
  title: 'Explain the maintenance estimate',
  description:
    'Why maintenance energy is what it is: kcal/day with its 80 % range and 1-SD, what it is made of (resting rate, daily living, steps, work, home, commute, recreation, training, digestion; kcal/day each), which parts are assumed because the answer was skipped, the unknown that would narrow the range most, and the activity level (PAL).',
  input: T.Object({}),
  output: T.Object({
    tdee0Kcal: T.Number(),
    sigmaKcal: T.Number(),
    band80: T.Tuple([T.Number(), T.Number()]),
    drivers: T.Array(T.Object({ id: T.String(), kcal: T.Number(), sigmaKcal: T.Number() })),
    defaulted: T.Array(T.String()),
    biggestUnknown: T.Optional(T.Object({ driver: T.String(), narrowsByKcal: T.Number() })),
    palBandLabel: T.Nullable(T.String()),
    palFlag: T.Enum(['ok', 'high', 'capped']),
    pal0: T.Nullable(T.Number()),
    rmrKcal: T.Number(),
    rmrMethod: T.String(),
    steps: T.Number(),
    sessionsPerWeek: T.Number(),
  }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'Your body shows the same estimate from the projection' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => {
    // loaded on demand: the intake reducers and the catalogue seed stay out of the profile store's graph
    const { maintenanceExplanationNow } = await import('@/state/internal/intake');
    const ex = maintenanceExplanationNow(ctx.now);
    const r = (x: number) => Math.round(x);
    return {
      tdee0Kcal: r(ex.tdee0Kcal),
      sigmaKcal: r(ex.sigmaKcal),
      band80: [r(ex.band80[0]), r(ex.band80[1])] as [number, number],
      drivers: ex.drivers.map((d) => ({ id: d.id, kcal: r(d.kcal), sigmaKcal: r(d.sigmaKcal) })),
      defaulted: [...ex.defaulted],
      ...(ex.biggestUnknown ? { biggestUnknown: { driver: ex.biggestUnknown.driver, narrowsByKcal: r(ex.biggestUnknown.narrowsByKcal) } } : {}),
      palBandLabel: ex.palBandLabel,
      palFlag: ex.palFlag,
      pal0: ex.pal0 === null ? null : Math.round(ex.pal0 * 100) / 100,
      rmrKcal: r(ex.rmrKcal),
      rmrMethod: ex.rmrMethod,
      steps: r(ex.steps),
      sessionsPerWeek: ex.sessionsPerWeek,
    };
  },
});

export const profilePatch = defineCommand({
  id: 'profile.patch',
  version: 1,
  title: 'Update your body profile',
  description:
    'Change body inputs (SI units: age years, height cm, weight kg, waist/neck/hip cm, body fat %, habits, labs). Merge patch: only the fields given change; null clears a field or un-touches a shape slider. Values are clamped to their ranges. While a plan runs, a new weight needs asStartingPoint: true (otherwise log it as a measurement). figure.frame (0 to 1, null = match my basics) only changes the drawing.',
  input: ProfilePatch,
  output: ProfileView,
  perm: 'write',
  impact: 'consequential',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  preconditions: ['noWeightEditDuringPlan'],
  coalesce: (input, actor) => (actor.kind === 'user' ? `profile.patch:${patchFields(input as never).join(',')}` : undefined),
  execute: (_ctx, input) => {
    applyProfilePatch(input as never);
    return profileView();
  },
});

export const profileResetShape = defineCommand({
  id: 'profile.resetShape',
  version: 1,
  title: 'Reset shape to the estimate',
  description: 'Body fat, fat distribution and muscle sliders go back to untouched: the figure and the engine use the estimate from size, age and sex again.',
  input: T.Object({}),
  output: ProfileView,
  perm: 'write',
  impact: 'consequential',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: () => {
    resetShape();
    return profileView();
  },
});

export const profileSetSetupStep = defineCommand({
  id: 'profile.setSetupStep',
  version: 1,
  title: 'Move through the body setup',
  description: 'First-run progress of Your body: basics → shape → habits → done, with skipped flags for shape and habits.',
  input: T.Object({ step: T.Enum(STEPS), shapeSkipped: T.Optional(T.Boolean()), habitsSkipped: T.Optional(T.Boolean()) }),
  output: ProfileView,
  perm: 'write',
  impact: 'low',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(SCREEN),
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    setSetupStep(input.step, {
      ...(input.shapeSkipped !== undefined ? { shape: input.shapeSkipped } : {}),
      ...(input.habitsSkipped !== undefined ? { habits: input.habitsSkipped } : {}),
    });
    return profileView();
  },
});

declare module '../types' {
  interface CommandMap {
    'profile.get': typeof profileGet;
    'profile.explainMaintenance': typeof profileExplainMaintenance;
    'profile.patch': typeof profilePatch;
    'profile.resetShape': typeof profileResetShape;
    'profile.setSetupStep': typeof profileSetSetupStep;
  }
}
