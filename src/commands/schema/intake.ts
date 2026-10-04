/**
 * Section bodies of `intake/me` (SUITE_SPEC §2.3.1; the intake package's types in `src/features/intake/types.ts`).
 * `intake.answer` validates the merged section against these: known fields typed, extra keys allowed (sections carry
 * the chapter's raw `turns` and additive fields), and the diet section discriminated by `rulesComplete` (food rules are
 * never guessed). Tier P.
 */
import { T, type JsonSchema } from './types';

const str = T.String();
const strs = T.Array(T.String());
const open = (props: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties: props, required, additionalProperties: true });

/** A chapter's raw turns: values, status ('skipped' = asked later), commit order (v3) and "skip this part". */
const Turns = open({ values: T.OpenObject(), status: T.Record(T.Enum(['answered', 'skipped'])), order: T.Array(str), skippedAll: T.Boolean() }, ['values', 'status']);

/** Measured maintenance or resting energy (§13.1; intake only, never part of the engine's `ActivityIntake`). */
const Measured = open(
  {
    kind: T.Enum(['rmr', 'tdee']),
    value: T.Number({ minimum: 0 }),
    unit: T.Enum(['kcal', 'kJ']),
    method: T.Enum(['metabolic_cart', 'dxa_based', 'smart_scale', 'calculator', 'tracking']),
    date: T.String({ pattern: '^\\d{4}-\\d{2}$' }),
  },
  ['kind', 'value', 'unit', 'method'],
);
const Weekdays = T.Array(T.Integer({ minimum: 0, maximum: 6 }));

/** `ActivityIntake` (engine type; every field optional, "I don't know" is first-class). */
export const ActivitySectionSchema = open({
  work: T.Enum(['desk', 'mixed', 'onFeet', 'manualModerate', 'manualHeavy', 'notWorking', 'unknown']),
  workDaysPerWeek: T.Number({ minimum: 0, maximum: 7 }),
  workHoursPerDay: T.Number({ minimum: 0, maximum: 24 }),
  commute: open({ mode: T.Enum(['none', 'passive', 'walk', 'cycle', 'mixed']), activeMinPerWorkday: T.Number({ minimum: 0 }) }, ['mode']),
  steps: open(
    {
      source: T.Enum(['wrist', 'phone', 'estimate', 'unknown']),
      workday: T.Number({ minimum: 0 }),
      offDay: T.Number({ minimum: 0 }),
      weeklyMean: T.Number({ minimum: 0 }),
      daysOfHistory: T.Number({ minimum: 0 }),
      phoneCarried: T.Boolean(),
    },
    ['source'],
  ),
  offDay: T.Enum(['mostlyHome', 'mixed', 'outAndAbout']),
  onFeetAtHome: T.Enum(['little', 'some', 'aLot']),
  recreation: T.Array(open({ label: str, intensity: T.Enum(['light', 'moderate', 'vigorous']), minPerWeek: T.Number({ minimum: 0 }) }, ['label', 'intensity', 'minPerWeek'])),
  measured: Measured,
  turns: Turns,
});

/** The blood-markers chapter's turns (the values live in the markers documents). */
export const MarkersSectionSchema = open({ turns: Turns });

/** `TrainingProfile` + `prefs` (the time, logging and free-text answers the profile has no field for). */
export const TrainingSectionSchema = open({
  owned: strs,
  access: T.Array(T.Unknown()),
  refused: T.Array(T.Unknown()),
  liked: strs,
  injuries: strs,
  cleared: strs,
  skill: T.NumberEnum([1, 2, 3, 4, 5]),
  purchaseAllowance: open({ maxPriceTier: T.Integer({ minimum: 0, maximum: 5 }), maxItems: T.Integer({ minimum: 0 }) }),
  enjoy: T.Record(T.Number({ minimum: -2, maximum: 2 })),
  prefs: open({
    daysPerWeek: T.Number({ minimum: 0, maximum: 7 }),
    minPerSession: T.Number({ minimum: 0 }),
    bestTime: T.Enum(['morning', 'midday', 'evening', 'any']),
    logStyle: T.Enum(['coach', 'quick', 'detailed']),
    willingness: T.Record(T.Enum(['no', 'fine', 'like'])),
    homeConstraints: T.Array(T.Enum(['noNoise', 'smallSpace'])),
    customEquipment: strs,
    weightsUnknown: strs,
  }),
  turns: Turns,
});

const AnimalFoods = open({
  meat: T.Enum(['none', 'chicken', 'chicken+mutton', 'all_red_meat']),
  eggs: T.Enum(['none', 'baked_only', 'yes']),
  dairy: T.Enum(['none', 'ghee_only', 'yes']),
  chicken: T.Boolean(),
  mutton: T.Boolean(),
  beef: T.Boolean(),
  pork: T.Boolean(),
  fish: T.Boolean(),
  shellfish: T.Boolean(),
  honey: T.Boolean(),
});

/** `DietProfile` once the rules are answered (`rulesComplete: true`), else only `{ rulesComplete: false }` + turns. */
export const DietSectionSchema: JsonSchema = {
  anyOf: [
    open({ rulesComplete: T.Literal(false), turns: Turns }, ['rulesComplete']),
    open(
      {
        rulesComplete: T.Literal(true),
        animalFoods: AnimalFoods,
        dayRules: T.Array(open({ weekdays: Weekdays, rule: T.Enum(['no_meat', 'no_eggs', 'vrat']) }, ['weekdays', 'rule'])),
        periodRules: T.Array(open({ name: str, rule: T.Enum(['vrat', 'daylight_fast', 'observe']) }, ['name', 'rule'])),
        noOnionGarlic: T.Boolean(),
        halal: T.Boolean(),
        kosher: T.Boolean(),
        allergies: strs,
        allergiesOther: strs,
        allergyStrict: T.Boolean(),
        intolerances: strs,
        medicalDiet: strs,
        dislikes: strs,
        cuisines: strs,
        whoCooks: T.Enum(['self', 'family', 'paid_cook', 'tiffin', 'mixed']),
        familyFoodMode: T.Boolean(),
        alcoholDrinksPerWeek: T.Number({ minimum: 0 }),
        turns: Turns,
      },
      ['rulesComplete', 'animalFoods'],
    ),
  ],
};

export const KitchenSectionSchema = open({
  equipment: strs,
  pantry: T.Array(open({ foodId: str, have: T.Boolean(), confirmedAt: str }, ['foodId', 'have'])),
});

const SupplementsV1 = open({
  stance: T.Enum(['food_first', 'open']),
  taking: T.Array(open({ supplementId: str, dose: T.Number({ minimum: 0 }), unit: str, clockH: T.Number({ minimum: 0, maximum: 24 }) }, ['supplementId', 'dose', 'unit'])),
});
/** v2 (SUITE_SPEC §13.2, `src/catalogues/supplements/types.ts`): taking vs on hand, one dose row per item. */
const SupplementsV2 = open(
  {
    _v: T.Literal(2),
    stance: T.Enum(['taking', 'onHand', 'open', 'food_first']),
    rows: T.Array(
      open(
        {
          supplementId: T.Nullable(str),
          text: str,
          state: T.Enum(['taking', 'onHand', 'notForMe', 'unknown']),
          dose: T.Number({ exclusiveMinimum: 0 }),
          unit: str,
          timesOfDay: T.Array(T.Enum(['morning', 'midday', 'evening', 'night'])),
          since: T.Date(),
        },
        ['supplementId', 'state', 'timesOfDay'],
      ),
    ),
  },
  ['_v', 'stance', 'rows'],
);
export const SupplementsSectionSchema = T.Union([SupplementsV2, SupplementsV1]);

export const DevicesSectionSchema = open({
  has: T.Array(T.Enum(['ring', 'watch', 'band', 'scale', 'chestStrap', 'phoneOnly', 'none'])),
  models: strs,
  platforms: T.Array(T.Enum(['android', 'ios', 'desktop'])),
  streams: T.Array(
    open(
      { stream: str, imported: T.Boolean(), coach: T.Enum(['hidden', 'daily', 'daily+series']), engine: T.Boolean(), scores: T.Boolean() },
      ['stream', 'imported', 'coach', 'engine', 'scores'],
    ),
  ),
  turns: Turns,
});

export const INTAKE_SECTION_SCHEMAS = {
  activity: ActivitySectionSchema,
  training: TrainingSectionSchema,
  diet: DietSectionSchema,
  kitchen: KitchenSectionSchema,
  supplements: SupplementsSectionSchema,
  markers: MarkersSectionSchema,
  devices: DevicesSectionSchema,
} as const satisfies Record<string, JsonSchema>;

export type IntakeSection = keyof typeof INTAKE_SECTION_SCHEMAS;
