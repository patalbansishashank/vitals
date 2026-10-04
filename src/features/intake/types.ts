/**
 * Intake documents (v2 shapes; v3 adds commit order, `meta.*` answers, measured maintenance and the markers section) (design/screens/onboarding-intake-v2.md; docs/SUITE_SPEC.md §2.3.1, §4.5).
 *
 * SUITE_SPEC names the collection: one `intake` document (`IntakeDoc`, key `me`) with a field per section, written
 * section by section through `intake.answer` (a JSON merge patch per section). The three profile documents this
 * package produces live there under the spec's names:
 *   - training and equipment → `training`: the catalogue's `TrainingProfile` (exported here as `EquipmentProfile`)
 *     plus `prefs: TrainingPreferences` (time, logging, custom items: what the profile has no field for);
 *   - food and kitchen       → `diet` (`DietProfile`) + `kitchen` + `supplements` (together `FoodProfile`);
 *   - devices and streams    → `devices` + `devices.streams: StreamPolicy[]` (together `StreamOptIns`; the policies
 *     move to `bioSources` through `bio.setPolicy` once the biometrics package lands).
 * Each chapter's raw turns (value + answered/skipped) ride along in its first section as `turns`, so receipts, "change"
 * and "not used" survive a reload and another device.
 */
import type { SupplementsSectionV1, SupplementsSectionV2 } from '@/catalogues/supplements';
import type { ActivityIntake } from '@/engine/types/profile';
import type { TrainingProfile, Weekday } from '@/catalogues';

export type { ActivityIntake, TrainingProfile, Weekday };

/** URL sections (SUITE_SPEC §6.2 `/onboarding/:section`). */
export type IntakeSectionId = 'activity' | 'training' | 'diet' | 'kitchen' | 'supplements' | 'markers' | 'devices';
/** The chapters the sections are presented as (v3: five; blood markers is optional and present once its module lands). */
export type ChapterId = 'activity' | 'training' | 'food' | 'markers' | 'devices';

/**
 * Every chapter in its fixed order (SUITE_SPEC §13.1, §13.5.5). The chapters actually shown are `CHAPTERS` in
 * `./chapters` (a chapter with no registered questions — markers before its module lands — is left out).
 */
export const ALL_CHAPTERS: readonly ChapterId[] = ['activity', 'training', 'food', 'markers', 'devices'];
export const SECTION_CHAPTER: Readonly<Record<IntakeSectionId, ChapterId>> = {
  activity: 'activity',
  training: 'training',
  diet: 'food',
  kitchen: 'food',
  supplements: 'food',
  markers: 'markers',
  devices: 'devices',
};
export const CHAPTER_SECTIONS: Readonly<Record<ChapterId, readonly IntakeSectionId[]>> = {
  activity: ['activity'],
  training: ['training'],
  food: ['diet', 'kitchen', 'supplements'],
  markers: ['markers'],
  devices: ['devices'],
};
/** The route section a chapter opens at. */
export const CHAPTER_ROUTE: Readonly<Record<ChapterId, IntakeSectionId>> = { activity: 'activity', training: 'training', food: 'diet', markers: 'markers', devices: 'devices' };

/* ------------------------------------------------------------------------------------------- raw answers */

/** 'skipped' is stored for "ask me later" (v3 reads it as `later`; the stored word is kept for old documents). */
export type TurnStatus = 'answered' | 'skipped';

/** One chapter's turns: values by question id, and whether each was answered or asked later. */
export interface ChapterAnswers {
  values: Record<string, unknown>;
  status: Record<string, TurnStatus>;
  /** Question ids in the order they were committed (audit only; never decides what is asked). */
  order?: string[];
  /** The whole chapter was skipped ("Skip this part"). */
  skippedAll?: boolean;
}

export const emptyChapter = (): ChapterAnswers => ({ values: {}, status: {} });

/* ------------------------------------------------------------------------------------------- training */

/** The catalogue's training profile under the name the intake brief uses (owned kit, access, refusals, injuries…). */
export type EquipmentProfile = TrainingProfile;

export type TrainingFamily =
  | 'lifting'
  | 'bodyweight'
  | 'indian'
  | 'yoga'
  | 'walking'
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'sports'
  | 'dance'
  | 'martial'
  | 'intervals';

export type Willingness = 'no' | 'fine' | 'like';
export type TimeOfDay = 'morning' | 'midday' | 'evening' | 'any';
export type LogStyle = 'coach' | 'quick' | 'detailed';
export type HomeConstraint = 'noNoise' | 'smallSpace';

/** What `TrainingProfile` does not carry: time, logging, experience answer, free-text items (R3 intake C, F). */
export interface TrainingPreferences {
  /** Sessions a week the person can give, 0–7. */
  daysPerWeek: number;
  /** Minutes per session. */
  minPerSession: number;
  bestTime: TimeOfDay;
  logStyle: LogStyle;
  /** Willingness per family as answered (the profile carries the derived enjoy/refused tokens). */
  willingness: Partial<Record<TrainingFamily, Willingness>>;
  homeConstraints: HomeConstraint[];
  /** "Something else" equipment, kept exactly as typed; resolved later (Coach or closest catalogue item). */
  customEquipment: string[];
  /** "Anything you won't do" free text, kept as typed. */
  refusedText?: string;
  /** Loadable items whose weights the person was not sure of (plans use reps to near failure). */
  weightsUnknown: string[];
}

/* ------------------------------------------------------------------------------------------- food (R4 §1.1) */

export type MeatLevel = 'none' | 'chicken' | 'chicken+mutton' | 'all_red_meat';
export type EggLevel = 'none' | 'baked_only' | 'yes';
export type DairyLevel = 'none' | 'ghee_only' | 'yes';

export interface AnimalFoods {
  meat: MeatLevel;
  /** Explicit choices behind `meat` (additive): a mutton-only eater must never get chicken. */
  chicken: boolean;
  mutton: boolean;
  beef: boolean;
  pork: boolean;
  fish: boolean;
  shellfish: boolean;
  eggs: EggLevel;
  dairy: DairyLevel;
  honey: boolean;
}

export type DayRuleKind = 'no_meat' | 'no_eggs' | 'vrat';
export interface DayRule {
  weekdays: Weekday[];
  rule: DayRuleKind;
  note?: string;
}
export interface PeriodRule {
  name: 'Navratri' | 'Shravan' | 'Ramadan' | 'Lent' | 'Ekadashi' | string;
  /** 'vrat' = fasting foods; 'daylight_fast' = no food or drink between dawn and sunset (Ramadan). */
  rule: 'vrat' | 'daylight_fast' | 'observe';
  /** What the person eats then (Hindu fasting): vrat foods, fruit and milk, or nothing. */
  eats?: 'vrat_foods' | 'fruit_milk' | 'nothing';
}

export interface JainRules {
  noRootVeg: boolean;
  noOnionGarlic: boolean;
  noHoney: boolean;
  noAfterSunset: boolean;
  noFermented: boolean;
  noMushroom: boolean;
  /** Weekdays on which green leafy vegetables are avoided (empty = not observed). */
  greensRestrictedDays: Weekday[];
}

export type Allergen =
  | 'gluten-cereals'
  | 'crustacean'
  | 'mollusc'
  | 'milk'
  | 'egg'
  | 'fish'
  | 'peanut'
  | 'tree-nut'
  | 'soy'
  | 'sesame'
  | 'mustard'
  | 'celery'
  | 'lupin'
  | 'sulphite';

export type Cuisine =
  | 'north_indian'
  | 'south_indian'
  | 'gujarati'
  | 'bengali'
  | 'maharashtrian'
  | 'punjabi'
  | 'kerala'
  | 'goan'
  | 'indo_chinese'
  | 'mediterranean'
  | 'american'
  | 'british'
  | 'mexican'
  | 'east_asian'
  | 'middle_eastern'
  | 'other';

export type WhoCooks = 'self' | 'family' | 'paid_cook' | 'tiffin' | 'mixed';
export type KitchenEquipment =
  | 'pressure_cooker'
  | 'tawa'
  | 'kadhai'
  | 'gas_2burner'
  | 'induction'
  | 'mixer_grinder'
  | 'idli_steamer'
  | 'microwave'
  | 'otg_oven'
  | 'air_fryer'
  | 'rice_cooker'
  | 'instant_pot'
  | 'blender'
  | 'oven'
  | 'sheet_pan'
  | 'slow_cooker'
  | 'grill'
  | 'fridge'
  | 'freezer'
  | 'kitchen_scale';

export type MedicalDiet = 'coeliac' | 'CKD-protein-limit' | 'warfarin-vitK-consistency' | 'MAOI-tyramine' | 'low-sodium' | 'diabetes';

/** R4 §1.1 `DietProfile`, stored locally. Allergies and rules are hard filters; intolerances and dislikes are soft. */
export interface DietProfile {
  animalFoods: AnimalFoods;
  dayRules: DayRule[];
  periodRules: PeriodRule[];
  /** Present only when the person keeps Jain rules. */
  jain?: JainRules;
  noOnionGarlic: boolean;
  halal: boolean;
  kosher: boolean;
  allergies: Allergen[];
  /** Other allergies typed by the person (hard filter, matched by name). */
  allergiesOther: string[];
  /** Traces count too ("Even traces?" → strict). */
  allergyStrict: boolean;
  intolerances: string[];
  /** Read-only, derived from the safety answers (never asked here). */
  medicalDiet: MedicalDiet[];
  dislikes: string[];
  /** Ranked: first = eaten most often. */
  cuisines: Cuisine[];
  staples: { grain: string[]; fat: string[] };
  whoCooks: WhoCooks;
  /** Family / cook / tiffin: what a normal lunch and dinner look like (free text, parsed later). */
  householdMeals?: string;
  /** Plans adjust portions and add-ons, not dishes. */
  familyFoodMode: boolean;
  /** Weekday active minutes per meal; weekend = dinner + 15. */
  timeBudgetMin: { weekdayBreakfast: number; weekdayLunch: number; weekdayDinner: number; weekend: number };
  budget?: { tier: 'tight' | 'normal' | 'flexible' };
  eatingOut?: { mealsPerWeek: number };
  /** Drinks a week ("Plans count it like any other energy"); undefined = not asked. */
  alcoholDrinksPerWeek?: number;
}

export interface PantryItem {
  foodId: string;
  have: boolean;
  qtyApprox?: string;
  perishable?: boolean;
  confirmedAt: string;
}
export interface KitchenProfile {
  equipment: KitchenEquipment[];
  pantry: PantryItem[];
}
/** The supplements section (v2, SUITE_SPEC §13.2: taking vs on hand, one dose row per item). */
export type SupplementsAnswer = SupplementsSectionV2;
/** The section as stored before v2; read it through `toSectionV2` (`@/catalogues/supplements`). */
export type SupplementsAnswerV1 = SupplementsSectionV1;

/** The food chapter's three sections together. `diet` is null until the food rules are answered (never guessed). */
export interface FoodProfile {
  diet: DietProfile | null;
  kitchen: KitchenProfile;
  supplements: SupplementsAnswer;
}

/* ------------------------------------------------------------------------------------------- devices (SUITE_SPEC §4.5) */

export type DeviceKind = 'ring' | 'watch' | 'band' | 'scale' | 'chestStrap' | 'phoneOnly' | 'none';
export type Platform = 'android' | 'ios' | 'desktop';

export interface DevicesAnswer {
  has: DeviceKind[];
  /** Brand/model per device, as chosen ("Oura", "Colmi", "not sure"), aligned with `has`. */
  models: string[];
  platforms: Platform[];
}

export type StreamId = 'sleep_sessions' | 'heart_rate' | 'hrv' | 'spo2' | 'steps' | 'workouts' | 'weight' | 'body_fat' | 'skin_temp' | 'vendor_scores';
export type CoachVisibility = 'hidden' | 'daily' | 'daily+series';

/** SUITE_SPEC §4.5 `StreamPolicy` (stream ids are the intake's subset of `BioStream`). */
export interface StreamPolicy {
  stream: StreamId;
  /** Data from this stream is stored at all ("bring in"). */
  imported: boolean;
  coach: CoachVisibility;
  /** May replace assumed inputs / feed observations ("my plan"). */
  engine: boolean;
  /** May feed Vitals' own scores ("my scores"). */
  scores: boolean;
}

export interface StreamOptIns {
  devices: DevicesAnswer;
  policies: StreamPolicy[];
}

/* ------------------------------------------------------------------------------------------- the document */

/** The chapter's raw turns ride along in its first section (additive `turns` key; consumers ignore it). */
export interface WithTurns {
  turns?: ChapterAnswers;
}

/** `intake.activity`: the engine's `ActivityIntake` (SUITE_SPEC §2.3.1). */
export type ActivitySection = ActivityIntake & WithTurns & { measured?: MeasuredEnergy };
/** `intake.training`: `TrainingProfile` + the preferences it has no field for. */
export type TrainingSection = TrainingProfile & { prefs: TrainingPreferences } & WithTurns;
/**
 * `intake.diet`: `DietProfile` once what you eat, allergies and rules are answered (`rulesComplete: true`); until then
 * only `{ rulesComplete: false }` — food rules are never guessed, and recipes pause.
 */
export type DietSection = (DietProfile & { rulesComplete: true } & WithTurns) | ({ rulesComplete: false } & WithTurns);
/** `intake.devices`: devices + the per-stream choices (move to `bioSources` via `bio.setPolicy` when that lands). */
export type DevicesSection = DevicesAnswer & { streams: StreamPolicy[] } & WithTurns;
/** `intake.markers`: the blood-markers chapter's turns (the values themselves live in the markers documents). */
export type MarkersSection = WithTurns;

/** Measured maintenance or resting energy (`activity.measured`, §13.1). Only a metabolic-cart resting value is used as RMR. */
export type MeasuredMethod = 'metabolic_cart' | 'dxa_based' | 'smart_scale' | 'calculator' | 'tracking';
export interface MeasuredEnergy {
  kind: 'rmr' | 'tdee';
  value: number;
  unit: 'kcal' | 'kJ';
  method: MeasuredMethod;
  /** Month measured, `YYYY-MM`. */
  date?: string;
}

/** `intake/me` as this package reads and writes it (SUITE_SPEC §2.3.1 plus the additive fields above). */
export interface IntakeDoc {
  activity?: ActivitySection;
  training?: TrainingSection;
  diet?: DietSection;
  kitchen?: KitchenProfile;
  supplements?: SupplementsAnswer | SupplementsAnswerV1;
  markers?: MarkersSection;
  devices?: DevicesSection;
  answeredAt: Partial<Record<IntakeSectionId, string>>;
  questionSetVersion: Partial<Record<IntakeSectionId, number>>;
  /** Sections skipped as a whole ("Skip this part"), with when. */
  skipped?: Partial<Record<IntakeSectionId, string>>;
}

/** v3 (batch 02): activity 2 (measured-energy questions, children), diet 2 (the "answer them now?" gate removed). */
export const QUESTION_SET_VERSION: Readonly<Record<IntakeSectionId, number>> = {
  activity: 2,
  training: 1,
  diet: 2,
  kitchen: 1,
  supplements: 1,
  markers: 1,
  devices: 1,
};

export const EMPTY_INTAKE: IntakeDoc = { answeredAt: {}, questionSetVersion: {} };

/** Which section body carries a chapter's turns. */
export const TURNS_SECTION: Readonly<Record<ChapterId, IntakeSectionId>> = { activity: 'activity', training: 'training', food: 'diet', markers: 'markers', devices: 'devices' };
