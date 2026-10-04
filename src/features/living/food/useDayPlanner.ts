/**
 * "Plan my day", per-slot retries and swaps against the recipe provider. Results land in Food's meal-plan store keyed
 * by (plan, date, slot), so moving between days keeps them. Runs are aborted when the screen unmounts.
 */
import { useEffect, useRef } from 'react';
import type { LocalDate } from '@/living';
import { FOOD_COPY } from './copy';
import { slotKey, useFoodStore, type SlotRun } from './mealPlanStore';
import { isRecipeError, mainDish, type MealSlotTarget, type RecipeProvider } from './recipes';
import type { FoodProfileView } from './profile';

export interface DayPlanner {
  /** Plan recipes for these slots (the open ones). `pantry` = "Use what's in my kitchen". */
  plan(targets: readonly MealSlotTarget[], opts?: { pantry?: readonly string[] }): Promise<void>;
  /** A different dish for one slot (the other slots stay as they are). */
  swap(target: MealSlotTarget): Promise<void>;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function useDayPlanner(o: { planId: string | null; date: LocalDate; daySlots: readonly MealSlotTarget[]; provider: RecipeProvider; profile: FoodProfileView }): DayPlanner {
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const { planId, date, daySlots, provider, profile } = o;

  /** Main dishes already on this day (other slots), so a new suggestion doesn't repeat them. */
  const dayDishes = (skip: (slot: string) => boolean): string[] => {
    if (!planId) return [];
    const s = useFoodStore.getState();
    const out: string[] = [];
    for (const t of daySlots) {
      if (skip(t.slot)) continue;
      const k = slotKey(planId, date, t.slot);
      const acc = s.accepted[k]?.recipe;
      const run = s.runs[k];
      if (acc) out.push(mainDish(acc.dish));
      else if (run?.state === 'ready') out.push(mainDish(run.recipe.dish));
    }
    return out;
  };

  const plan: DayPlanner['plan'] = async (targets, opts) => {
    if (!provider.available || !planId || targets.length === 0) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const st = useFoodStore.getState();
    const keyOf = (slot: string) => slotKey(planId, date, slot);
    const open = new Set(targets.map((t) => t.slot));
    for (const t of targets) st.setRun(keyOf(t.slot), { state: 'waiting' });
    const exclude = [...st.dontSuggest, ...dayDishes((slot) => open.has(slot))];
    try {
      const res = await provider.planDay({
        date,
        slots: [...targets],
        ...(profile.foodRules ? { foodRules: profile.foodRules } : {}),
        signal: c.signal,
        exclude: [...new Set(exclude)],
        ...(opts?.pantry ? { pantry: [...opts.pantry] } : {}),
        onProgress: (slot, state) => {
          if (state === 'working' && open.has(slot)) useFoodStore.getState().setRun(keyOf(slot), { state: 'working' });
        },
      });
      for (const t of targets) {
        const r = res[t.slot];
        const run: SlotRun = !r ? { state: 'error', message: FOOD_COPY.slot.failed } : isRecipeError(r) ? { state: 'error', message: r.error } : { state: 'ready', recipe: r };
        useFoodStore.getState().setRun(keyOf(t.slot), run);
      }
    } catch (e) {
      const s = useFoodStore.getState();
      for (const t of targets) {
        const cur = s.runs[keyOf(t.slot)];
        if (cur?.state === 'waiting' || cur?.state === 'working') s.setRun(keyOf(t.slot), isAbort(e) ? null : { state: 'error', message: FOOD_COPY.slot.failed });
      }
    } finally {
      if (ctrl.current === c) ctrl.current = null;
    }
  };

  const swap: DayPlanner['swap'] = async (target) => {
    if (!provider.available || !planId) return;
    const key = slotKey(planId, date, target.slot);
    const s = useFoodStore.getState();
    const prev = s.runs[key];
    const prevDish = prev?.state === 'ready' ? mainDish(prev.recipe.dish) : null;
    const exclude = [...new Set([...s.dontSuggest, ...(prevDish ? [prevDish] : []), ...dayDishes((slot) => slot === target.slot)])];
    s.setSwapPrompt(key, null);
    s.setRun(key, { state: 'working' });
    try {
      const r = await provider.swap({ date, slot: target.slot, target, exclude, ...(profile.foodRules ? { foodRules: profile.foodRules } : {}) });
      if (isRecipeError(r)) {
        useFoodStore.getState().setRun(key, { state: 'error', message: r.error });
        return;
      }
      useFoodStore.getState().setRun(key, { state: 'ready', recipe: r });
      if (prevDish) useFoodStore.getState().setSwapPrompt(key, prevDish);
    } catch {
      useFoodStore.getState().setRun(key, prev ?? { state: 'error', message: FOOD_COPY.slot.failed });
    }
  };

  return { plan, swap };
}
