/**
 * Food's in-memory state: accepted recipes per (plan, date, slot) — the day's meal plan — the latest recipe run per
 * slot, the "don't suggest again" list, the pantry, ticked grocery items and the lazy budget answer.
 *
 * TODO(E4): persist `accepted` as the `mealPlans` collection (SUITE_SPEC §8.3 `MealPlanDoc`), `dontSuggest` as food
 * dislikes, `pantry` as `intake.kitchen.pantry` and `budget` as `intake.diet.budget`.
 */
import { create } from 'zustand';
import type { LocalDate } from '@/living';
import type { RecipeSuggestion } from './recipes';

export type BudgetTier = 'tight' | 'normal' | 'flexible';

/** One slot's recipe run: waiting/working while "Plan my day" runs, then a suggestion or an error. */
export type SlotRun =
  | { state: 'waiting' }
  | { state: 'working' }
  | { state: 'ready'; recipe: RecipeSuggestion }
  | { state: 'error'; message: string };

export interface AcceptedMeal {
  planId: string;
  date: LocalDate;
  slot: string;
  recipe: RecipeSuggestion;
}

interface FoodState {
  accepted: Record<string, AcceptedMeal>;
  runs: Record<string, SlotRun>;
  /** After a swap: the replaced dish, until "Don't suggest" / "It's fine". */
  swapPrompt: Record<string, string>;
  /** Main dish names not to suggest again (lowercase). */
  dontSuggest: string[];
  /** Ingredient names marked "already have" (lowercase). */
  pantry: string[];
  /** Ingredient names un-marked on the grocery list although the pantry document holds them (lowercase). */
  notHave: string[];
  /** Grocery item keys ticked as bought. */
  bought: string[];
  budget: { tier: BudgetTier | null; deferred: boolean };
}

interface FoodActions {
  accept(key: string, meal: AcceptedMeal): void;
  unaccept(key: string): void;
  setRun(key: string, run: SlotRun | null): void;
  setSwapPrompt(key: string, dish: string | null): void;
  addDontSuggest(dish: string): void;
  setPantry(name: string, have: boolean): void;
  setBought(itemKey: string, bought: boolean): void;
  setBudget(tier: BudgetTier | 'later'): void;
  reset(): void;
}

const initial = (): FoodState => ({ accepted: {}, runs: {}, swapPrompt: {}, dontSuggest: [], pantry: [], notHave: [], bought: [], budget: { tier: null, deferred: false } });

const without = <T,>(rec: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...rec };
  delete next[key];
  return next;
};

export const useFoodStore = create<FoodState & FoodActions>()((set) => ({
  ...initial(),
  accept: (key, meal) => set((s) => ({ accepted: { ...s.accepted, [key]: meal } })),
  unaccept: (key) => set((s) => ({ accepted: without(s.accepted, key) })),
  setRun: (key, run) => set((s) => ({ runs: run ? { ...s.runs, [key]: run } : without(s.runs, key) })),
  setSwapPrompt: (key, dish) => set((s) => ({ swapPrompt: dish ? { ...s.swapPrompt, [key]: dish } : without(s.swapPrompt, key) })),
  addDontSuggest: (dish) => set((s) => (s.dontSuggest.includes(dish.toLowerCase()) ? s : { dontSuggest: [...s.dontSuggest, dish.toLowerCase()] })),
  setPantry: (name, have) =>
    set((s) => {
      const n = name.trim().toLowerCase();
      if (!n) return s;
      const has = s.pantry.includes(n);
      const notHave = have ? s.notHave.filter((p) => p !== n) : s.notHave.includes(n) ? s.notHave : [...s.notHave, n];
      if (have === has && notHave.length === s.notHave.length) return s;
      return { pantry: have ? (has ? s.pantry : [...s.pantry, n]) : s.pantry.filter((p) => p !== n), notHave };
    }),
  setBought: (itemKey, bought) => set((s) => ({ bought: bought ? [...new Set([...s.bought, itemKey])] : s.bought.filter((k) => k !== itemKey) })),
  setBudget: (tier) => set(() => ({ budget: tier === 'later' ? { tier: null, deferred: true } : { tier, deferred: false } })),
  reset: () => set(initial()),
}));

/** Key of a slot in the meal plan. */
export function slotKey(planId: string, date: LocalDate, slot: string): string {
  return `${planId}|${date}|${slot}`;
}

/** Tests: start from an empty meal plan, pantry and grocery state. */
export function resetFoodStore(): void {
  useFoodStore.getState().reset();
}
