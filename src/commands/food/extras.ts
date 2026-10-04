/**
 * Grocery list from saved meal plans, and the supplements line (catalogue items serving the person's goals, only when
 * the person opted in). Mirrors the Food screen's models (`src/features/living/food/groceries.ts`, `supplements.ts`),
 * which headless commands may not import.
 */
import type { FoodTable, SupplementRecord } from '@/catalogues/types';
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements'; // not the index: it builds the whole seed catalogue
import type { FoodSetup } from './context';

export type Aisle = 'vegetables' | 'dairy' | 'staples' | 'protein' | 'spices';

const AISLE_OF_GROUP: Readonly<Record<string, Aisle>> = {
  dairy: 'dairy', eggs: 'protein', pulses: 'protein', poultry: 'protein', meat: 'protein', fish: 'protein', seafood: 'protein', soy: 'protein',
  cereals: 'staples', fats: 'staples', oils: 'staples', sugars: 'staples', nuts: 'staples', spices: 'spices', condiments: 'spices',
};

export function aisleOfGroup(group: string): Aisle {
  return AISLE_OF_GROUP[group] ?? 'vegetables';
}

export interface MealPlanItem {
  foodId: string;
  grams: number;
}
export interface MealPlanLike {
  date: string;
  meals: Array<{ slot: string; items?: MealPlanItem[] }>;
}

export interface GroceryItem {
  foodId: string;
  name: string;
  aisle: Aisle;
  /** Total grams over the range (as planned: raw or as-eaten per the food record). */
  grams: number;
  /** Buy unit text ("eggs × 6", "rice 350 g"). */
  buy: string;
  /** Marked "have" in the kitchen pantry. */
  have: boolean;
  dates: string[];
}

function buyUnit(name: string, foodId: string, g: number): string {
  if (/egg/.test(foodId)) return `eggs × ${Math.max(6, Math.ceil(g / 50 / 6) * 6)}`;
  return g >= 1000 ? `${name} ${Math.round(g / 100) / 10} kg` : `${name} ${Math.ceil(g / 50) * 50} g`;
}

/** Aggregate planned items per food, grouped by aisle (aisle order: vegetables, dairy, staples, protein, spices). */
export function groceryList(plans: readonly MealPlanLike[], table: FoodTable, setup: FoodSetup): GroceryItem[] {
  const by = new Map<string, { grams: number; dates: Set<string> }>();
  for (const p of plans)
    for (const m of p.meals)
      for (const it of m.items ?? []) {
        const cur = by.get(it.foodId) ?? { grams: 0, dates: new Set<string>() };
        cur.grams += it.grams;
        cur.dates.add(p.date);
        by.set(it.foodId, cur);
      }
  const have = new Set(setup.pantry.filter((p) => p.have).map((p) => p.foodId));
  const order: Aisle[] = ['vegetables', 'dairy', 'staples', 'protein', 'spices'];
  return [...by.entries()]
    .map(([foodId, v]) => {
      const f = table.get(foodId);
      const name = f ? (f.aliases[0] ?? f.name) : foodId;
      const aisle = aisleOfGroup(f?.group ?? '');
      return { foodId, name, aisle, grams: Math.round(v.grams), buy: buyUnit(name, foodId, v.grams), have: have.has(foodId), dates: [...v.dates].sort() };
    })
    .sort((a, b) => order.indexOf(a.aisle) - order.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

/** Goal tags used when the plan's goals are not mapped yet (the Food screen's `PLAN_GOAL_TAGS`). */
export const DEFAULT_GOAL_TAGS: readonly string[] = ['fat_loss_muscle_retention', 'strength', 'fibre_target', 'deficiency_prevention'];

export interface SupplementLineItem {
  id: string;
  name: string;
  dose: string;
  timing: string;
  status: SupplementRecord['status'];
  goals: string[];
}

export interface SupplementLine {
  /** False when the person keeps "food first" (the default): no catalogue suggestions. */
  optedIn: boolean;
  items: SupplementLineItem[];
  /** Items left out because a contraindication matches a safety flag (never shown). */
  hiddenForSafety: number;
}

/**
 * Catalogue supplements serving the person's goals — only when they opted in (`intake.supplements.stance === 'open'`,
 * the Food screen's opt-in). Already-taken or prescribed items, diet-incompatible and contraindicated items are left out.
 */
export function supplementLine(o: { setup: FoodSetup; prescribed?: readonly string[]; goals?: readonly string[]; safetyFlags?: readonly string[] }): SupplementLine {
  if (o.setup.supplementStance !== 'open') return { optedIn: false, items: [], hiddenForSafety: 0 };
  const goals = new Set(o.goals ?? DEFAULT_GOAL_TAGS);
  const skip = new Set([...(o.prescribed ?? []), ...o.setup.takingSupplements, ...o.setup.onHandSupplements, ...o.setup.refusedSupplements]);
  const flags = new Set(o.safetyFlags ?? []);
  const a = o.setup.diet?.animalFoods;
  const vegan = !!a && a.dairy === 'none' && a.eggs === 'none' && a.meat === 'none' && !a.fish;
  const vegetarian = !!a && a.meat === 'none' && !a.fish && !a.shellfish;
  let hidden = 0;
  const items: SupplementLineItem[] = [];
  for (const r of SEED_SUPPLEMENTS) {
    if (skip.has(r.id)) continue;
    const forGoals = r.status === 'offer' && r.goals.some((g) => goals.has(g));
    const forRisk = r.status === 'offer_if_risk' && r.id === 'vitamin_b12' && (vegetarian || !a);
    if (!forGoals && !forRisk) continue;
    if (vegan && r.diet.vegan.ok === false) continue;
    if (vegetarian && r.diet.vegetarian.ok === false) continue;
    if (r.contraindications.some((c) => flags.has(c.flag))) {
      hidden++;
      continue;
    }
    const dose = r.dose.range ? `${r.dose.range[0]}–${r.dose.range[1]} ${r.dose.unit}` : r.dose.amount !== null ? `${r.dose.amount} ${r.dose.unit}` : '';
    items.push({ id: r.id, name: r.name, dose, timing: r.timing, status: r.status, goals: r.goals.filter((g) => goals.has(g)) });
  }
  return { optedIn: true, items, hiddenForSafety: hidden };
}
