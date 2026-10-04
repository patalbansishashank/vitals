/**
 * Recipes for the day's meal slots (design/screens/living-mode.md, Food › Meals and recipes; docs/SUITE_SPEC.md §8.3).
 *
 * `RecipeProvider` is the seam the AI package fills: it proposes dishes from allowed foods only and the app fits the
 * portions (the model never states nutrient numbers). E9b's `createAiRecipeProvider` (src/ai/coach/recipes.ts: model
 * proposal → `food.candidates` hard filter → `food.planDay` portion fit and verification → household units) is installed
 * by `CoachRuntimeProvider` once a provider is configured; without one the app runs with `noRecipeProvider` (plain
 * targets per slot, which always work) and tests and the component gallery use the deterministic `mockRecipeProvider`.
 */
import { useContext } from 'react';
import type { Est, LocalDate } from '@/living';
import type { DietProfile } from '@/features/intake/types';
import { FOOD_COPY } from './copy';
import { RecipeProviderContext } from './recipeContext';
import type { DietKind } from './profile';

/** What a meal slot asks for (from the day's prescription). */
export interface MealSlotTarget {
  slot: string;
  /** Display name ("lunch"). */
  name: string;
  clockH: number;
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG?: number;
}

export interface RecipeSuggestion {
  id: string;
  slot: string;
  dish: string;
  cuisine: string;
  activeMin: number;
  passiveMin?: number;
  servings: number;
  equipment: string[];
  /** Household units: "2 rotis + 1 katori dal + 1 katori sabzi + 150 g curd". */
  portionLine: string;
  fit: { kind: 'fits' | 'closest'; text: string };
  perServing: { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG?: Est };
  /** Raw grams for the whole recipe (all servings). */
  ingredients: Array<{ name: string; household?: string; grams: number }>;
  steps: string[];
  /** "Adds 150 g curd to reach your protein." */
  why: string;
  /** Set when a food's values are unverified ("Some values for paneer are estimates; ranges are wider."). */
  estimatedComposition?: string;
}

export type RecipeResult = RecipeSuggestion | { error: string };

export type SlotProgress = 'working' | 'done' | 'error';

export interface PlanDayRequest {
  date: LocalDate;
  slots: MealSlotTarget[];
  /** The person's food rules (hard filters: diet, allergies, day rules). */
  foodRules?: DietProfile;
  signal?: AbortSignal;
  /** Dishes not to propose (main dish names, lowercase). */
  exclude?: string[];
  /** "Use what's in my kitchen": only these ingredients (pantry names). */
  pantry?: string[];
  /** Per-slot progress while the day is being planned. */
  onProgress?: (slot: string, state: SlotProgress) => void;
}

export interface SwapRequest {
  date: LocalDate;
  slot: string;
  target: MealSlotTarget;
  exclude: string[];
  foodRules?: DietProfile;
  signal?: AbortSignal;
}

export interface RecipeProvider {
  available: boolean;
  /** Why recipes are unavailable ("Connect an AI provider to get recipes."). */
  reason?: string;
  planDay(req: PlanDayRequest): Promise<Record<string, RecipeResult>>;
  swap(req: SwapRequest): Promise<RecipeResult>;
}

export function isRecipeError(r: RecipeResult | undefined | null): r is { error: string } {
  return !!r && 'error' in r;
}

/** The app default until an AI provider is connected: every slot keeps its plain targets. */
export const noRecipeProvider: RecipeProvider = {
  available: false,
  reason: FOOD_COPY.provider.none,
  planDay: async ({ slots }) => Object.fromEntries(slots.map((s) => [s.slot, { error: FOOD_COPY.provider.none }])),
  swap: async () => ({ error: FOOD_COPY.provider.none }),
};

export { RecipeProviderContext };

/** The installed provider, or `noRecipeProvider` when none is (the context is null outside an AI-configured app). */
export function useRecipeProvider(): RecipeProvider {
  return useContext(RecipeProviderContext) ?? noRecipeProvider;
}

/** The main dish of a dish line, lowercase ("Paneer bhurji, 2 rotis, raita" → "paneer bhurji"). */
export function mainDish(dish: string): string {
  const first = dish.split(',')[0]!.trim();
  return first ? first[0]!.toLowerCase() + first.slice(1) : first;
}

/** Example foods for plain targets, by the slot's macro balance (small static list; never a recipe). */
export function exampleFoods(t: Pick<MealSlotTarget, 'energyKcal' | 'proteinG' | 'carbG' | 'fatG'>, dietKind: DietKind | null = null): string {
  const byDiet: Partial<Record<keyof typeof FOOD_COPY.examples, string>> = dietKind === 'vegan' || dietKind === 'vegetarian' ? FOOD_COPY.examplesByDiet[dietKind] : {};
  const ex = { ...FOOD_COPY.examples, ...byDiet };
  const e = Math.max(1, t.energyKcal);
  if (t.energyKcal < 450) return ex.snack;
  if ((4 * t.proteinG) / e >= 0.32) return ex.protein;
  if ((9 * t.fatG) / e >= 0.4) return ex.fat;
  if ((4 * t.carbG) / e >= 0.5) return ex.carbs;
  return ex.balanced;
}

/* ----------------------------------------------------------------------------------------------- mock provider */

interface MockDish {
  dish: string;
  cuisine: string;
  kind: 'main' | 'snack';
  activeMin: number;
  passiveMin?: number;
  equipment: string[];
  portionLine: string;
  /** Composition of the dish at `kcal` (synthetic values). */
  base: { kcal: number; proteinG: number; carbG: number; fatG: number; fibreG: number };
  ingredients: Array<{ name: string; household?: string; grams: number }>;
  steps: string[];
  why: string;
  estimated?: string;
  /** Pantry names that carry the protein. */
  protein: string[];
}

/** Synthetic, vegetarian-friendly dishes (all numbers are synthetic examples, not food-table values). */
export const MOCK_DISHES: readonly MockDish[] = [
  {
    dish: 'Paneer bhurji, 2 rotis, cucumber raita',
    cuisine: 'north Indian',
    kind: 'main',
    activeMin: 20,
    equipment: ['tawa', 'kadai'],
    portionLine: '1 katori paneer bhurji + 2 rotis + 1 katori raita',
    base: { kcal: 640, proteinG: 52, carbG: 50, fatG: 26, fibreG: 7 },
    ingredients: [
      { name: 'paneer', household: '½ pack', grams: 120 },
      { name: 'onion', household: '1 small', grams: 60 },
      { name: 'tomato', household: '1 medium', grams: 80 },
      { name: 'atta', household: '2 rotis', grams: 60 },
      { name: 'curd', household: '1 katori', grams: 150 },
      { name: 'cucumber', household: '½', grams: 80 },
      { name: 'oil', household: '1 tsp', grams: 5 },
      { name: 'jeera', household: '½ tsp', grams: 2 },
    ],
    steps: [
      'Knead the atta with a little water and let it rest for 10 minutes.',
      'Warm the oil in the kadai, add the jeera, then the chopped onion and tomato.',
      'Crumble in the paneer and cook for 3 minutes.',
      'Roll two rotis and cook them on the tawa.',
      'Grate the cucumber into the curd with a pinch of salt.',
    ],
    why: 'Paneer and curd carry most of the protein; the rotis bring the carbs.',
    estimated: 'Some values for paneer are estimates; ranges are wider.',
    protein: ['paneer', 'curd'],
  },
  {
    dish: 'Chana masala, rice, salad',
    cuisine: 'north Indian',
    kind: 'main',
    activeMin: 25,
    passiveMin: 30,
    equipment: ['pressure cooker', 'kadai'],
    portionLine: '1 katori chana masala + 1 katori rice + 1 plate salad + 1 katori curd',
    base: { kcal: 710, proteinG: 42, carbG: 95, fatG: 18, fibreG: 14 },
    ingredients: [
      { name: 'chana (dry)', household: '⅓ cup dry', grams: 80 },
      { name: 'onion', household: '1 medium', grams: 80 },
      { name: 'tomato', household: '1 large', grams: 120 },
      { name: 'rice', household: '½ cup raw', grams: 75 },
      { name: 'cucumber', household: '1 small', grams: 100 },
      { name: 'curd', household: '1 katori', grams: 150 },
      { name: 'oil', household: '1½ tsp', grams: 7 },
      { name: 'garam masala', household: '1 tsp', grams: 3 },
    ],
    steps: [
      'Soak the chana overnight, then pressure-cook it for 4 whistles.',
      'Cook the rice.',
      'Fry the onion and tomato in the oil with the garam masala, then add the chana.',
      'Simmer for 10 minutes and slice the salad.',
    ],
    why: 'Chana and curd together carry the protein; rice and chana bring the carbs and fibre.',
    protein: ['chana (dry)', 'curd'],
  },
  {
    dish: 'Moong dal chilla with curd',
    cuisine: 'north Indian',
    kind: 'main',
    activeMin: 20,
    equipment: ['tawa'],
    portionLine: '3 chillas + 1 katori curd + green chutney',
    base: { kcal: 520, proteinG: 34, carbG: 60, fatG: 15, fibreG: 9 },
    ingredients: [
      { name: 'moong dal', household: '½ cup dry', grams: 90 },
      { name: 'curd', household: '1 katori', grams: 150 },
      { name: 'onion', household: '1 small', grams: 50 },
      { name: 'coriander', household: '1 handful', grams: 15 },
      { name: 'oil', household: '1 tsp', grams: 5 },
    ],
    steps: ['Soak the moong dal for 2 hours and grind it to a batter.', 'Stir in the chopped onion and coriander.', 'Spread thin on a hot tawa with a little oil; cook both sides.'],
    why: 'Moong dal and curd give a lot of protein for the energy.',
    protein: ['moong dal', 'curd'],
  },
  {
    dish: 'Rajma, rice and salad',
    cuisine: 'punjabi',
    kind: 'main',
    activeMin: 20,
    passiveMin: 35,
    equipment: ['pressure cooker', 'kadai'],
    portionLine: '1 katori rajma + 1 katori rice + 1 plate salad',
    base: { kcal: 650, proteinG: 28, carbG: 105, fatG: 12, fibreG: 15 },
    ingredients: [
      { name: 'rajma (dry)', household: '⅓ cup dry', grams: 70 },
      { name: 'rice', household: '½ cup raw', grams: 75 },
      { name: 'onion', household: '1 medium', grams: 80 },
      { name: 'tomato', household: '1 large', grams: 120 },
      { name: 'oil', household: '1 tsp', grams: 5 },
    ],
    steps: ['Soak the rajma overnight and pressure-cook it until soft.', 'Cook the rice.', 'Fry the onion and tomato, add the rajma and simmer 10 minutes.'],
    why: 'A filling, high-fibre plate; rajma brings most of the protein.',
    protein: ['rajma (dry)'],
  },
  {
    dish: 'Tofu tikka, 2 rotis, salad',
    cuisine: 'north Indian',
    kind: 'main',
    activeMin: 25,
    equipment: ['tawa'],
    portionLine: '8 pieces tofu tikka + 2 rotis + 1 plate salad',
    base: { kcal: 600, proteinG: 40, carbG: 55, fatG: 22, fibreG: 8 },
    ingredients: [
      { name: 'tofu', household: '1 pack', grams: 200 },
      { name: 'curd', household: '3 tbsp', grams: 45 },
      { name: 'atta', household: '2 rotis', grams: 60 },
      { name: 'capsicum', household: '1', grams: 100 },
      { name: 'oil', household: '1 tsp', grams: 5 },
    ],
    steps: ['Coat the tofu and capsicum in curd and spices.', 'Cook on a hot tawa until browned.', 'Make two rotis.'],
    why: 'Tofu carries the protein with little fat.',
    estimated: 'Some values for tofu are estimates; ranges are wider.',
    protein: ['tofu'],
  },
  {
    dish: 'Roasted chana and curd',
    cuisine: 'snack',
    kind: 'snack',
    activeMin: 2,
    equipment: [],
    portionLine: '1 handful roasted chana + 1 katori curd',
    base: { kcal: 330, proteinG: 26, carbG: 30, fatG: 11, fibreG: 6 },
    ingredients: [
      { name: 'roasted chana', household: '1 handful', grams: 40 },
      { name: 'curd', household: '1 katori', grams: 150 },
    ],
    steps: ['Serve the curd with the roasted chana on the side.'],
    why: 'Quick, and most of it is protein.',
    protein: ['roasted chana', 'curd'],
  },
  {
    dish: 'Sprouts chaat',
    cuisine: 'snack',
    kind: 'snack',
    activeMin: 10,
    equipment: [],
    portionLine: '1 bowl sprouts chaat with onion, tomato and lemon',
    base: { kcal: 280, proteinG: 18, carbG: 40, fatG: 5, fibreG: 9 },
    ingredients: [
      { name: 'moong sprouts', household: '1 bowl', grams: 150 },
      { name: 'onion', household: '½ small', grams: 30 },
      { name: 'tomato', household: '½', grams: 50 },
      { name: 'lemon', household: '½', grams: 20 },
    ],
    steps: ['Steam the sprouts for 5 minutes.', 'Toss with chopped onion, tomato, lemon and chaat masala.'],
    why: 'High in fibre and protein for a small snack.',
    protein: ['moong sprouts'],
  },
  {
    dish: 'Masala oats with curd',
    cuisine: 'snack',
    kind: 'snack',
    activeMin: 10,
    equipment: ['kadai'],
    portionLine: '1 bowl masala oats + ½ katori curd',
    base: { kcal: 340, proteinG: 16, carbG: 45, fatG: 10, fibreG: 7 },
    ingredients: [
      { name: 'oats', household: '½ cup', grams: 45 },
      { name: 'curd', household: '½ katori', grams: 75 },
      { name: 'onion', household: '½ small', grams: 30 },
      { name: 'tomato', household: '½', grams: 50 },
    ],
    steps: ['Cook the oats with water, onion, tomato and spices.', 'Serve with the curd.'],
    why: 'Oats bring fibre; curd adds protein.',
    protein: ['curd'],
  },
];

const PROTEIN_PANTRY = ['paneer', 'curd', 'chana', 'dal', 'moong', 'tofu', 'rajma', 'egg', 'milk', 'sprouts'];

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

const round5 = (g: number) => Math.max(5, Math.round(g / 5) * 5);

/** Fit a mock dish to a slot: fixed portions scaled to the slot's energy (the app fits recipes, not the model). */
export function fitMockDish(d: MockDish, slot: string, target: MealSlotTarget, seq: number): RecipeSuggestion {
  const f = target.energyKcal / d.base.kcal;
  const rel = d.estimated ? 0.2 : 0.12;
  const est = (v: number): Est => ({ value: Math.round(v), sd: Math.round(v * rel * 10) / 10 });
  const protein = d.base.proteinG * f;
  const short = target.proteinG - protein;
  const fit: RecipeSuggestion['fit'] =
    short > Math.max(3, target.proteinG * 0.05) ? { kind: 'closest', text: `closest: protein short by ${Math.round(short)} g` } : { kind: 'fits', text: 'fits targets' };
  return {
    id: `mock-${slot}-${seq}-${d.dish.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    slot,
    dish: d.dish,
    cuisine: d.cuisine,
    activeMin: d.activeMin,
    ...(d.passiveMin !== undefined ? { passiveMin: d.passiveMin } : {}),
    servings: 1,
    equipment: [...d.equipment],
    portionLine: d.portionLine,
    fit,
    perServing: { energyKcal: est(target.energyKcal), proteinG: est(protein), carbG: est(d.base.carbG * f), fatG: est(d.base.fatG * f), fibreG: est(d.base.fibreG * f) },
    ingredients: d.ingredients.map((i) => ({ ...i, grams: round5(i.grams * f) })),
    steps: [...d.steps],
    why: d.why,
    ...(d.estimated ? { estimatedComposition: d.estimated } : {}),
  };
}

export interface MockRecipeOptions {
  /** Delay before each slot resolves (ms). */
  delayMs?: number;
  /** Slots whose generation fails ("Couldn't make a recipe this time."). */
  fail?: readonly string[];
}

/** A deterministic provider for tests and the gallery: fixed dishes scaled to each slot's energy. */
export function createMockRecipeProvider(o: MockRecipeOptions = {}): RecipeProvider {
  const delay = o.delayMs ?? 0;
  const fail = new Set(o.fail ?? []);
  let seq = 0;
  const pick = (target: MealSlotTarget, exclude: ReadonlySet<string>, pantry?: readonly string[]): MockDish | null => {
    const kind = target.energyKcal < 450 ? 'snack' : 'main';
    const pool = MOCK_DISHES.filter((d) => d.kind === kind && !exclude.has(mainDish(d.dish)));
    if (pantry) {
      const have = pantry.map((p) => p.toLowerCase());
      return pool.find((d) => d.protein.some((p) => have.some((h) => p.includes(h) || h.includes(p)))) ?? null;
    }
    return pool[0] ?? null;
  };
  return {
    available: true,
    async planDay({ slots, exclude, pantry, signal, onProgress }) {
      const out: Record<string, RecipeResult> = {};
      const used = new Set((exclude ?? []).map((x) => x.toLowerCase()));
      const pantryHasProtein = pantry ? pantry.some((p) => PROTEIN_PANTRY.some((k) => p.toLowerCase().includes(k))) : true;
      for (const s of slots) {
        onProgress?.(s.slot, 'working');
        await wait(delay, signal);
        if (fail.has(s.slot)) {
          out[s.slot] = { error: FOOD_COPY.provider.failed };
          onProgress?.(s.slot, 'error');
          continue;
        }
        if (!pantryHasProtein) {
          out[s.slot] = { error: FOOD_COPY.kitchen.impossible };
          onProgress?.(s.slot, 'error');
          continue;
        }
        const d = pick(s, used, pantry);
        if (!d) {
          out[s.slot] = { error: pantry ? FOOD_COPY.kitchen.impossible : FOOD_COPY.provider.failed };
          onProgress?.(s.slot, 'error');
          continue;
        }
        used.add(mainDish(d.dish));
        out[s.slot] = fitMockDish(d, s.slot, s, ++seq);
        onProgress?.(s.slot, 'done');
      }
      return out;
    },
    async swap({ slot, target, exclude, signal }) {
      await wait(delay, signal);
      if (fail.has(slot)) return { error: FOOD_COPY.provider.failed };
      const d = pick(target, new Set(exclude.map((x) => x.toLowerCase())));
      return d ? fitMockDish(d, slot, target, ++seq) : { error: FOOD_COPY.provider.failed };
    },
  };
}

/** The shared mock instance (gallery, stories). */
export const mockRecipeProvider: RecipeProvider = createMockRecipeProvider();
