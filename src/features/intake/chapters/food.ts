/**
 * Chapter 3 · Food and kitchen (`diet`, `kitchen`, `supplements`) → `FoodProfile` (R4 `DietProfile` + kitchen +
 * supplement stance). Food rules are never guessed: until what you eat, allergies and rules are answered, `diet` stays
 * null and recipes pause. Allergies and rules are hard filters. Staples, budget, eating out and the pantry are ordinary
 * questions at the end of the chapter, each with "ask me later" (v3 removed the "answer them now?" gate).
 */
import { supplementQuestions, supplementsSectionOf } from './supplements';
import { LEGACY_IDS } from '@/catalogues/kitchen/docs';
import type { Weekday } from '@/catalogues';
import type { DietAnimalLevel, HabitProfile } from '@/engine/types/profile';
import type { ScreeningAnswers } from '@/features/onboarding/safetyRules';
import { F } from '../copy';
import { isTextEntry, textOf, usedValues, type AnswerOption, type FlowContext, type Question } from '../flow';
import type {
  Allergen,
  AnimalFoods,
  ChapterAnswers,
  Cuisine,
  DayRule,
  DietProfile,
  FoodProfile,
  JainRules,
  KitchenEquipment,
  MedicalDiet,
  PantryItem,
  PeriodRule,
  SupplementsAnswer,
  WhoCooks,
} from '../types';

export type FoodKey = 'dairy' | 'eggs' | 'fish' | 'shellfish' | 'chicken' | 'mutton' | 'beef' | 'pork';
export type DietPreset = 'vegetarian' | 'eggetarian' | 'vegan' | 'jain' | 'pescatarian' | 'everything';
export interface EatValue {
  preset?: DietPreset;
  foods: FoodKey[];
}
export type JainKey = 'noRootVeg' | 'noOnionGarlic' | 'noHoney' | 'noAfterSunset' | 'noFermented' | 'noMushroom' | 'greens';
export interface FastingValue {
  weekdays: Weekday[];
  /** 'Ekadashi' | 'Navratri' | 'Shravan', or `text:<name>` for "other". */
  periods: string[];
}
export interface TakingEntry {
  supplementId: string;
  dose: number;
  unit: string;
  time?: 'morning' | 'midday' | 'evening' | 'night';
}
export interface StaplesValue {
  grain: string[];
  fat: string[];
}
export type CooksAnswer = WhoCooks | 'eatOut';
export type MealTime = 'lt10' | '10to20' | '20to40' | 'gt40';

export const FOOD_KEYS: readonly FoodKey[] = ['dairy', 'eggs', 'fish', 'shellfish', 'chicken', 'mutton', 'beef', 'pork'];
const ANIMAL: readonly FoodKey[] = ['eggs', 'fish', 'shellfish', 'chicken', 'mutton', 'beef', 'pork'];
const MEAT: readonly FoodKey[] = ['chicken', 'mutton', 'beef', 'pork'];

/** Presets tick the food chips (design F1: start from one, then adjust). */
export const DIET_PRESETS: Readonly<Record<DietPreset, readonly FoodKey[]>> = {
  vegetarian: ['dairy'],
  eggetarian: ['dairy', 'eggs'],
  vegan: [],
  jain: ['dairy'],
  pescatarian: ['dairy', 'eggs', 'fish'],
  everything: ['dairy', 'eggs', 'fish', 'shellfish', 'chicken', 'mutton', 'beef', 'pork'],
};

export const ALLERGENS: readonly Allergen[] = ['gluten-cereals', 'crustacean', 'mollusc', 'milk', 'egg', 'fish', 'peanut', 'tree-nut', 'soy', 'sesame', 'mustard', 'celery', 'lupin', 'sulphite'];
const INDIAN_CUISINES: readonly Cuisine[] = ['north_indian', 'south_indian', 'gujarati', 'bengali', 'maharashtrian', 'punjabi', 'kerala', 'goan', 'indo_chinese'];
const OTHER_CUISINES: readonly Cuisine[] = ['mediterranean', 'american', 'british', 'mexican', 'east_asian', 'middle_eastern'];
export const cuisineOrder = (india: boolean): Cuisine[] => (india ? [...INDIAN_CUISINES, ...OTHER_CUISINES, 'other'] : [...OTHER_CUISINES, ...INDIAN_CUISINES, 'other']);

const INDIA_KITCHEN: readonly KitchenEquipment[] = ['pressure_cooker', 'tawa', 'kadhai', 'gas_2burner', 'fridge'];
const OTHER_KITCHEN: readonly KitchenEquipment[] = ['oven', 'fridge', 'freezer', 'blender'];
export const kitchenDefaults = (india: boolean): KitchenEquipment[] => [...(india ? INDIA_KITCHEN : OTHER_KITCHEN)];
const KITCHEN_ALL: readonly KitchenEquipment[] = [
  'pressure_cooker',
  'tawa',
  'kadhai',
  'gas_2burner',
  'induction',
  'mixer_grinder',
  'idli_steamer',
  'microwave',
  'otg_oven',
  'oven',
  'air_fryer',
  'rice_cooker',
  'instant_pot',
  'slow_cooker',
  'blender',
  'grill',
  'fridge',
  'freezer',
  'kitchen_scale',
];

/** Weekday time budgets (breakfast/lunch/dinner, active min) per answer; weekend = dinner + 15. */
export const TIME_BUDGETS: Readonly<Record<MealTime, readonly [number, number, number]>> = {
  lt10: [5, 10, 10],
  '10to20': [10, 15, 20],
  '20to40': [10, 20, 30],
  gt40: [15, 30, 45],
};

/** Pantry staples that spoil (R4 §1.3 decay applies to them). */
const PERISHABLE = new Set(['eggs', 'milk', 'curd', 'paneer', 'bread']);

const eats = (v: Readonly<Record<string, unknown>>) => ((v.eat as EatValue | undefined)?.foods ?? []) as FoodKey[];
const familyMode = (c: unknown) => c === 'family' || c === 'paid_cook' || c === 'tiffin';
const picked = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);

/**
 * The kitchen picker answers (`food.cuisines`, `food.equipment`, `food.staples`, `food.pantry`; E17's part replaces the
 * v0.2 `cuisine`, `kitchen`, `staples`, `pantry` questions) read back as v0.2 option ids, so `DietProfile` keeps its
 * cuisines, staples and equipment. The full lists live in the `kitchen` and `pantry` documents.
 */
const pickerIds = (x: unknown): string[] => (Array.isArray(x) ? (x as Array<{ id?: unknown }>).map((e) => (e && typeof e.id === 'string' ? e.id : '')).filter(Boolean) : []);
function legacyOf(map: Record<string, string>, x: unknown): string[] {
  const inv = new Map(Object.entries(map).map(([k, v]) => [v, k]));
  return [...new Set(pickerIds(x).flatMap((id) => (inv.has(id) ? [inv.get(id)!] : [])))];
}
const hasRule = (v: Readonly<Record<string, unknown>>, r: string) => picked(v.rules).includes(r);

export interface SupplementChoice {
  id: string;
  name: string;
  unit: string;
  dose: number;
}

/** `_supplements` is unused: supplement names now come from the catalogue (kept for the page's call). */
export function foodQuestions(_supplements: readonly SupplementChoice[] = []): Question[] {
  return [
    {
      id: 'eat',
      chapter: 'food',
      section: 'diet',
      anchor: 'eat',
      kind: 'custom',
      widget: 'eat',
      prompt: F.eat.prompt,
      short: F.eat.short,
      skipText: F.eat.skip,
      receipt: (v) => {
        const e = v as EatValue;
        const foods = e.foods.map((k) => F.eat.foods[k]);
        const head = e.preset ? F.eat.presets[e.preset] : '';
        return [head, foods.length ? foods.join(', ') : F.eat.receiptNothing].filter(Boolean).join(' · ');
      },
    },
    {
      id: 'dairy',
      parent: 'eat',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.dairy.prompt,
      short: F.dairy.short,
      skipText: F.dairy.skip,
      applies: (v) => v.eat !== undefined && !eats(v).some((k) => ANIMAL.includes(k)),
      options: (['none', 'ghee_only', 'yes'] as const).map((o) => ({ value: o, label: F.dairy.options[o] })),
    },
    {
      id: 'eggs',
      parent: 'eat',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.eggs.prompt,
      short: F.eggs.short,
      skipText: F.eggs.skip,
      defaultValue: 'yes',
      applies: (v) => eats(v).includes('eggs'),
      options: (['yes', 'baked_only'] as const).map((o) => ({ value: o, label: F.eggs.options[o] })),
    },
    {
      id: 'allergies',
      chapter: 'food',
      section: 'diet',
      anchor: 'allergies',
      kind: 'multi',
      required: true,
      prompt: F.allergies.prompt,
      short: F.allergies.short,
      skipText: F.allergies.skip,
      otherLabel: F.allergies.otherLabel,
      options: [...ALLERGENS.map((a) => ({ value: a, label: F.allergies.options[a] })), { value: 'none', label: F.allergies.options.none, exclusive: true }],
    },
    {
      id: 'traces',
      parent: 'allergies',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.traces.prompt,
      short: F.traces.short,
      skipText: F.traces.skip,
      defaultValue: 'strict',
      applies: (v) => picked(v.allergies).some((a) => a !== 'none'),
      options: (['strict', 'normal'] as const).map((o) => ({ value: o, label: F.traces.options[o] })),
    },
    {
      id: 'rules',
      chapter: 'food',
      section: 'diet',
      anchor: 'rules',
      kind: 'multi',
      required: true,
      prompt: F.rules.prompt,
      short: F.rules.short,
      skipText: F.rules.skip,
      initial: (v) => ((v.eat as EatValue | undefined)?.preset === 'jain' ? ['jain'] : []),
      options: [
        ...(['jain', 'noOnionGarlic', 'halal', 'kosher', 'hinduFasting', 'ramadan', 'lent'] as const).map((o) => ({ value: o, label: F.rules.options[o] })),
        { value: 'none', label: F.rules.options.none, exclusive: true },
      ],
    },
    {
      id: 'jain',
      parent: 'rules',
      chapter: 'food',
      section: 'diet',
      kind: 'multi',
      prompt: F.jain.prompt,
      why: F.jain.help,
      short: F.jain.short,
      skipText: F.jain.skip,
      initial: () => ['noOnionGarlic'],
      applies: (v) => hasRule(v, 'jain'),
      options: (['noRootVeg', 'noOnionGarlic', 'noHoney', 'noAfterSunset', 'noFermented', 'noMushroom', 'greens'] as const).map((o) => ({ value: o, label: F.jain.options[o] })),
    },
    {
      id: 'jainGreens',
      parent: 'jain',
      chapter: 'food',
      section: 'diet',
      kind: 'custom',
      widget: 'weekdays',
      prompt: F.jainGreensDays.prompt,
      short: F.jainGreensDays.short,
      skipText: F.jainGreensDays.skip,
      applies: (v) => picked(v.jain).includes('greens'),
    },
    {
      id: 'fasting',
      parent: 'rules',
      chapter: 'food',
      section: 'diet',
      kind: 'custom',
      widget: 'fastingDays',
      prompt: F.fasting.prompt,
      short: F.fasting.short,
      skipText: F.fasting.skip,
      applies: (v) => hasRule(v, 'hinduFasting'),
    },
    {
      id: 'fastingFood',
      parent: 'fasting',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.fastingFood.prompt,
      short: F.fastingFood.short,
      skipText: F.fastingFood.skip,
      defaultValue: 'vrat_foods',
      applies: (v) => hasRule(v, 'hinduFasting'),
      options: (['vrat_foods', 'fruit_milk', 'nothing'] as const).map((o) => ({ value: o, label: F.fastingFood.options[o] })),
    },
    {
      id: 'meatDays',
      parent: 'eat',
      chapter: 'food',
      section: 'diet',
      kind: 'custom',
      widget: 'weekdays',
      prompt: F.meatDays.prompt,
      short: F.meatDays.short,
      skipText: F.meatDays.skip,
      applies: (v) => eats(v).some((k) => MEAT.includes(k) || k === 'eggs'),
    },
    {
      id: 'cuisine',
      chapter: 'food',
      section: 'diet',
      kind: 'multi',
      ranked: true,
      required: true,
      prompt: F.cuisine.prompt,
      why: F.cuisine.help,
      short: F.cuisine.short,
      skipText: F.cuisine.skip,
      options: (ctx: FlowContext) => cuisineOrder(ctx.india).map((c) => ({ value: c, label: F.cuisine.options[c] })),
    },
    {
      id: 'cooks',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.cooks.prompt,
      short: F.cooks.short,
      skipText: F.cooks.skip,
      defaultValue: 'self',
      options: (['self', 'family', 'paid_cook', 'tiffin', 'eatOut', 'mixed'] as const).map((o) => ({ value: o, label: F.cooks.options[o] })),
    },
    {
      id: 'household',
      parent: 'cooks',
      chapter: 'food',
      section: 'diet',
      kind: 'custom',
      widget: 'text',
      prompt: F.household.prompt,
      why: F.household.note,
      short: F.household.short,
      skipText: F.household.skip,
      applies: (v) => familyMode(v.cooks),
    },
    {
      id: 'kitchen',
      chapter: 'food',
      section: 'kitchen',
      anchor: 'kitchen',
      kind: 'multi',
      prompt: F.kitchen.prompt,
      short: F.kitchen.short,
      skipText: F.kitchen.skip,
      applies: (v) => !familyMode(v.cooks),
      initial: (_v, ctx) => kitchenDefaults(ctx.india),
      options: (ctx: FlowContext) => {
        const first = kitchenDefaults(ctx.india);
        return [...first, ...KITCHEN_ALL.filter((k) => !first.includes(k))].map((k) => ({ value: k, label: F.kitchen.options[k as keyof typeof F.kitchen.options] }));
      },
    },
    {
      id: 'mealTime',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.time.prompt,
      short: F.time.short,
      skipText: F.time.skip,
      defaultValue: '10to20',
      applies: (v) => !familyMode(v.cooks),
      options: (['lt10', '10to20', '20to40', 'gt40'] as const).map((o) => ({ value: o, label: F.time.options[o] })),
      receipt: (v) => F.time.receipt[v as MealTime] ?? String(v),
    },
    {
      id: 'alcohol',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.alcohol.prompt,
      why: F.alcohol.why,
      short: F.alcohol.short,
      skipText: F.alcohol.skip,
      applies: (_v, ctx) => !ctx.gentle,
      options: (['no', 'sometimes', 'weekly'] as const).map((o) => ({ value: o, label: F.alcohol.options[o] })),
    },
    {
      id: 'drinks',
      parent: 'alcohol',
      chapter: 'food',
      section: 'diet',
      kind: 'number',
      prompt: F.drinks.prompt,
      short: F.drinks.short,
      skipText: F.drinks.skip,
      name: F.drinks.name,
      min: 0,
      max: 60,
      step: 1,
      presets: [2, 4, 7, 10, 14],
      defaultValue: 4,
      applies: (v) => v.alcohol === 'weekly',
    },
    // supplements: taking vs on hand, one dose row per item (E18, `./supplements.ts`)
    ...supplementQuestions(),
    {
      id: 'staples',
      chapter: 'food',
      section: 'diet',
      kind: 'custom',
      widget: 'staples',
      prompt: F.staples.prompt,
      short: F.staples.short,
      skipText: F.staples.skip,
      receipt: (v) => {
        const s = v as StaplesValue;
        const g = s.grain.map((x) => F.staples.grain[x as keyof typeof F.staples.grain] ?? x);
        const f = s.fat.map((x) => F.staples.fat[x as keyof typeof F.staples.fat] ?? x);
        return [...g, ...f].join(', ');
      },
    },
    {
      id: 'budget',
      chapter: 'food',
      section: 'diet',
      kind: 'single',
      prompt: F.budget.prompt,
      short: F.budget.short,
      skipText: F.budget.skip,
      defaultValue: 'normal',
      options: (['tight', 'normal', 'flexible'] as const).map((o) => ({ value: o, label: F.budget.options[o] })),
    },
    {
      id: 'eatingOut',
      chapter: 'food',
      section: 'diet',
      kind: 'number',
      prompt: F.eatingOut.prompt,
      short: F.eatingOut.short,
      skipText: F.eatingOut.skip,
      name: F.eatingOut.name,
      min: 0,
      max: 21,
      step: 1,
      presets: [0, 2, 4, 7, 10],
      defaultValue: 2,
    },
    {
      id: 'pantry',
      chapter: 'food',
      section: 'kitchen',
      kind: 'multi',
      prompt: F.pantry.prompt,
      why: F.pantry.help,
      short: F.pantry.short,
      skipText: F.pantry.skip,
      options: Object.entries(F.pantry.options).map(([value, label]) => ({ value, label })) as AnswerOption[],
    },
  ];
}

/** The static question list (supplement names resolved at render time by the widget). */
export const FOOD_QUESTIONS: readonly Question[] = foodQuestions();

/* ------------------------------------------------------------------------------------------- reducer */

export interface FoodContext extends FlowContext {
  safety?: ScreeningAnswers | null;
  /** ISO instant for pantry confirmations. */
  now: string;
}

export interface FoodResult extends FoodProfile {
  /** What you eat, allergies and rules all answered: recipes may run. */
  rulesComplete: boolean;
  /** Habit fields the answers set (derived diet level, alcohol). */
  habits: Pick<HabitProfile, 'dietAnimalLevel' | 'habitualAlcoholDrinksPerWeek'>;
}

/** Medical diets implied by the safety answers (read-only here; never asked). */
export function medicalDietOf(s: ScreeningAnswers | null | undefined): MedicalDiet[] {
  if (!s) return [];
  const out: MedicalDiet[] = [];
  if (s.conditionItems?.includes('kidney')) out.push('CKD-protein-limit');
  if (s.conditionItems?.includes('high-blood-pressure') || s.conditionItems?.includes('heart')) out.push('low-sodium');
  if (s.medicationItems?.includes('anticoagulant')) out.push('warfarin-vitK-consistency');
  if (s.diabetes === 'yes') out.push('diabetes');
  return out;
}

/** R4 rule: vegan if no meat, fish, eggs or dairy; vegetarian if no meat or fish; pescatarian if fish without meat. */
export function dietAnimalLevelOf(f: AnimalFoods): DietAnimalLevel {
  const meat = f.chicken || f.mutton || f.beef || f.pork;
  const fish = f.fish || f.shellfish;
  if (meat) return 'omnivore';
  if (fish) return 'pescatarian';
  if (f.eggs === 'none' && f.dairy === 'none') return 'vegan';
  return 'vegetarian';
}

export function reduceFood(a: ChapterAnswers, ctx: FoodContext): FoodResult {
  const v = usedValues(FOOD_QUESTIONS, a, ctx);
  const answered = (id: string) => a.status[id] === 'answered' && v[id] !== undefined;
  // the kitchen part's picker answers are not base questions, so `usedValues` leaves them out: read the answered turns
  const part = (id: string): unknown => (a.status[id] === 'answered' ? a.values[id] : undefined);

  const eat = v.eat as EatValue | undefined;
  const foods = new Set(eat?.foods ?? []);
  const rules = new Set(picked(v.rules).filter((r) => r !== 'none'));
  const jainPicked = new Set(picked(v.jain));
  const jain: JainRules | undefined = rules.has('jain')
    ? {
        noRootVeg: jainPicked.has('noRootVeg'),
        noOnionGarlic: jainPicked.has('noOnionGarlic') || !answered('jain'),
        noHoney: jainPicked.has('noHoney'),
        noAfterSunset: jainPicked.has('noAfterSunset'),
        noFermented: jainPicked.has('noFermented'),
        noMushroom: jainPicked.has('noMushroom'),
        greensRestrictedDays: jainPicked.has('greens') ? [...((v.jainGreens as Weekday[] | undefined) ?? [])] : [],
      }
    : undefined;

  const dairyAnswer = v.dairy as AnimalFoods['dairy'] | undefined;
  const dairy: AnimalFoods['dairy'] = dairyAnswer ?? (foods.has('dairy') ? 'yes' : 'none');
  const eggs: AnimalFoods['eggs'] = foods.has('eggs') ? ((v.eggs as AnimalFoods['eggs'] | undefined) ?? 'yes') : 'none';
  const chicken = foods.has('chicken');
  const mutton = foods.has('mutton');
  const beef = foods.has('beef');
  const pork = foods.has('pork');
  const animalFoods: AnimalFoods = {
    meat: beef || pork ? 'all_red_meat' : mutton ? 'chicken+mutton' : chicken ? 'chicken' : 'none',
    chicken,
    mutton,
    beef,
    pork,
    fish: foods.has('fish'),
    shellfish: foods.has('shellfish'),
    eggs,
    dairy,
    honey: !(jain?.noHoney || dairyAnswer === 'none'),
  };

  const dayRules: DayRule[] = [];
  const meatDays = (v.meatDays as Weekday[] | undefined) ?? [];
  if (meatDays.length) {
    if (chicken || mutton || beef || pork) dayRules.push({ weekdays: [...meatDays], rule: 'no_meat' });
    if (eggs !== 'none') dayRules.push({ weekdays: [...meatDays], rule: 'no_eggs' });
  }
  const periodRules: PeriodRule[] = [];
  if (rules.has('hinduFasting')) {
    const f = (v.fasting as { weekdays: Weekday[]; periods: string[] } | undefined) ?? { weekdays: [], periods: [] };
    const food = (v.fastingFood as PeriodRule['eats'] | undefined) ?? 'vrat_foods';
    if (f.weekdays.length) dayRules.push({ weekdays: [...f.weekdays], rule: 'vrat', note: food });
    for (const p of f.periods) periodRules.push({ name: isTextEntry(p) ? textOf(p) : p, rule: 'vrat', eats: food });
  }
  if (rules.has('ramadan')) periodRules.push({ name: 'Ramadan', rule: 'daylight_fast' });
  if (rules.has('lent')) periodRules.push({ name: 'Lent', rule: 'observe' });

  const allergyList = picked(v.allergies).filter((x) => x !== 'none');
  const cooks = (v.cooks as CooksAnswer | undefined) ?? 'self';
  const whoCooks: WhoCooks = cooks === 'eatOut' ? 'mixed' : cooks;
  const time = TIME_BUDGETS[(v.mealTime as MealTime | undefined) ?? '10to20'];
  const cuisines = (part('food.cuisines') !== undefined ? legacyOf(LEGACY_IDS.cuisine, part('food.cuisines')) : picked(v.cuisine).filter((c) => !isTextEntry(c))) as Cuisine[];
  const eatOutMeals = typeof v.eatingOut === 'number' ? v.eatingOut : undefined;

  const alcohol = v.alcohol as 'no' | 'sometimes' | 'weekly' | undefined;
  const drinks = alcohol === 'no' ? 0 : alcohol === 'sometimes' ? 1 : alcohol === 'weekly' ? (typeof v.drinks === 'number' ? v.drinks : 4) : undefined;

  const rulesComplete = answered('eat') && answered('allergies') && answered('rules');
  const diet: DietProfile | null = rulesComplete
    ? {
        animalFoods,
        dayRules,
        periodRules,
        ...(jain ? { jain } : {}),
        noOnionGarlic: rules.has('noOnionGarlic') || Boolean(jain?.noOnionGarlic),
        halal: rules.has('halal'),
        kosher: rules.has('kosher'),
        allergies: allergyList.filter((x): x is Allergen => (ALLERGENS as readonly string[]).includes(x)),
        allergiesOther: allergyList.filter(isTextEntry).map(textOf),
        allergyStrict: v.traces !== 'normal',
        intolerances: [],
        medicalDiet: medicalDietOf(ctx.safety),
        dislikes: [],
        cuisines: cuisines.length ? cuisines : [ctx.india ? 'north_indian' : 'other'],
        staples: part('food.staples') !== undefined ? { grain: legacyOf(LEGACY_IDS.grain, part('food.staples')), fat: legacyOf(LEGACY_IDS.fat, part('food.staples')) } : ((v.staples as StaplesValue | undefined) ?? { grain: [], fat: [] }),
        whoCooks,
        ...(typeof v.household === 'string' && v.household.trim() ? { householdMeals: v.household.trim() } : {}),
        familyFoodMode: familyMode(cooks),
        timeBudgetMin: { weekdayBreakfast: time[0], weekdayLunch: time[1], weekdayDinner: time[2], weekend: time[2] + 15 },
        ...(typeof v.budget === 'string' ? { budget: { tier: v.budget as 'tight' | 'normal' | 'flexible' } } : {}),
        ...(cooks === 'eatOut' ? { eatingOut: { mealsPerWeek: Math.max(7, eatOutMeals ?? 7) } } : eatOutMeals !== undefined ? { eatingOut: { mealsPerWeek: eatOutMeals } } : {}),
        ...(drinks !== undefined ? { alcoholDrinksPerWeek: drinks } : {}),
      }
    : null;

  const equipIds = Array.isArray(part('food.equipment')) ? legacyOf(LEGACY_IDS.kitchen, part('food.equipment')) : Array.isArray(v.kitchen) ? (v.kitchen as string[]) : null;
  const kitchenEquip = equipIds ? equipIds.filter((k): k is KitchenEquipment => (KITCHEN_ALL as readonly string[]).includes(k)) : kitchenDefaults(ctx.india);
  const pantry: PantryItem[] = (part('food.pantry') !== undefined ? legacyOf(LEGACY_IDS.pantry, part('food.pantry')) : picked(v.pantry)).map((foodId) => ({ foodId, have: true, perishable: PERISHABLE.has(foodId), confirmedAt: ctx.now }));

  const supplements: SupplementsAnswer = supplementsSectionOf(v);

  const habits: FoodResult['habits'] = {};
  if (answered('eat')) habits.dietAnimalLevel = dietAnimalLevelOf(animalFoods);
  if (drinks !== undefined) habits.habitualAlcoholDrinksPerWeek = drinks;

  return { diet, kitchen: { equipment: kitchenEquip, pantry }, supplements, rulesComplete, habits };
}
