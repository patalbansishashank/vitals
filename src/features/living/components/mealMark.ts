/**
 * The answer a meal already has, read from what was logged: the one rule the meal sheet selects its answer by, so the
 * fact line above the bank and the selected answer never disagree. Pure.
 * - Food logged with "As planned" (the slot's own numbers, or one serving of the accepted recipe) → As planned.
 * - Other food: within the energy tolerance of the plan (±5 %, at least ±75 kcal, the adherence rule) → As planned;
 *   less than that → Partly; more → nothing, since it was neither. Food with no energy known → nothing.
 * - Nothing logged: the answer the row reads (../today/model `todayRows`): the meal's own (its slot's Partly or Skipped,
 *   kept with no amount), else the day's food or whole-day mark. Skipped, Partly, or marked as planned → As planned. A
 *   day filled in for the person (assumed) or an open row → nothing.
 */
import { ENERGY_TOL_MIN_KCAL, ENERGY_TOL_REL } from '@/living/adherence';
import type { RowMark } from '../data/actions';
import type { RowStatus } from '../today/model';

/** The words an "As planned" log carries inside its slot ("as planned"; "lunch as planned" reads as that under Lunch). */
const AS_PLANNED_WORDS = 'as planned';

export interface MealLogRead {
  /** The meal row's status as Today reads it (with no food: the meal's own answer); 'empty' when the day has no row for the slot. */
  status: RowStatus;
  /** The slot's entries as logged, by their words inside the slot ("dal, rice"; "as planned"). */
  words: readonly string[];
  /** Whether any food is logged against the slot (entries, or a value on the row). */
  hasFood: boolean;
  /** Energy logged against the slot, kcal; 0 when none or unknown. */
  loggedKcal: number;
  /** The slot's planned energy, kcal. */
  plannedKcal: number;
  /** The accepted recipe for the slot: one serving of it is "as planned" too. */
  recipe?: { dish: string; energyKcal: number } | null;
}

/** Within the adherence energy tolerance of a planned amount. */
export function withinPlan(loggedKcal: number, plannedKcal: number): boolean {
  if (!(plannedKcal > 0)) return false;
  return Math.abs(loggedKcal - plannedKcal) <= Math.max(ENERGY_TOL_REL * plannedKcal, ENERGY_TOL_MIN_KCAL);
}

export function mealMarkOf(r: MealLogRead): RowMark | null {
  if (!r.hasFood) {
    if (r.status === 'skipped') return 'skipped';
    if (r.status === 'partial') return 'partly';
    // the day (or the food) marked as planned with nothing typed
    if (r.status === 'done') return 'asPlanned';
    return null;
  }
  const said = r.words.map((w) => w.trim().toLowerCase());
  const dish = r.recipe?.dish.trim().toLowerCase();
  if (said.includes(AS_PLANNED_WORDS) || (dish && said.includes(dish))) return 'asPlanned';
  if (!(r.loggedKcal > 0) || !(r.plannedKcal > 0)) return null;
  if (withinPlan(r.loggedKcal, r.plannedKcal) || (r.recipe && withinPlan(r.loggedKcal, r.recipe.energyKcal))) return 'asPlanned';
  const tolerance = Math.max(ENERGY_TOL_REL * r.plannedKcal, ENERGY_TOL_MIN_KCAL);
  return r.loggedKcal < r.plannedKcal - tolerance ? 'partly' : null;
}
