/**
 * Food tab hook (SUITE_SPEC §13.5.7): a dish that hits a capped or warned lever (saturated fat, dietary cholesterol,
 * alcohol) carries the "because …" chip on its fit line. The dish's composition comes from its ingredients matched
 * against the food table; an ingredient the table does not know adds nothing (no chip rather than a guess).
 */
import { useMemo } from 'react';
import type { FoodRecord, FoodTable } from '@/catalogues/types';
import { matchFood } from '@/commands/food/parse';
import { foodTable } from '@/commands/food/table';
import type { LeverId, MarkerEvaluation, MarkerNote } from '../types';
import { BecauseChips } from './BecauseChip';
import { markersToday, useMarkerDateStyle, useMarkerEvaluation } from './useMarkers';

/** Saturated-fat share that counts as "hitting" a warned lever without a numeric cap (general guidance, % of energy). */
export const SATFAT_DEFAULT_PCT = 10;
/** Dietary cholesterol per serving that counts as hitting the lever (about one egg yolk). */
export const CHOLESTEROL_MG_PER_SERVING = 150;

export interface DishLike {
  servings: number;
  perServing: { energyKcal: { value: number } };
  ingredients: ReadonlyArray<{ name: string; grams: number }>;
}

export interface DishComposition {
  satFatG: number;
  cholesterolMg: number;
  alcoholG: number;
}

/** Per-serving saturated fat, cholesterol and alcohol from the matched ingredients (pure given the table). */
export function dishComposition(dish: DishLike, table: FoodTable, match: (name: string, t: FoodTable) => { food: FoodRecord } | null = matchFood): DishComposition {
  const out: DishComposition = { satFatG: 0, cholesterolMg: 0, alcoholG: 0 };
  for (const ing of dish.ingredients) {
    const f = match(ing.name, table)?.food;
    if (!f) continue;
    const k = ing.grams / 100;
    out.satFatG += (f.per100g.satFatG ?? 0) * k;
    out.cholesterolMg += (f.per100g.cholesterolMg ?? 0) * k;
    out.alcoholG += (f.per100g.alcoholG ?? 0) * k;
  }
  const n = Math.max(1, dish.servings);
  return { satFatG: out.satFatG / n, cholesterolMg: out.cholesterolMg / n, alcoholG: out.alcoholG / n };
}

const lockOf = (ev: MarkerEvaluation, id: string): number | undefined => ev.safety.plannerLocks.find((l) => l.id === id)?.value;

/** The levers a dish hits, given the person's caps (`satfat-cap` %E, `alcohol-cap` g/d). */
export function dishLevers(c: DishComposition, energyKcal: number, ev: MarkerEvaluation): Set<LeverId> {
  const out = new Set<LeverId>();
  const satCap = lockOf(ev, 'satfat-cap') ?? SATFAT_DEFAULT_PCT;
  if (energyKcal > 0 && ((c.satFatG * 9) / energyKcal) * 100 > satCap) out.add('satfat');
  if (c.cholesterolMg >= CHOLESTEROL_MG_PER_SERVING) out.add('dietcholesterol');
  const alcCap = lockOf(ev, 'alcohol-cap');
  if (c.alcoholG > 0 && (alcCap === undefined || c.alcoholG > alcCap || alcCap === 0)) out.add('alcohol');
  return out;
}

const FOOD_LEVERS: ReadonlySet<LeverId> = new Set(['satfat', 'dietcholesterol', 'alcohol']);

/** Notes on food levers that a dish hits. */
export function dishNotes(notes: readonly MarkerNote[], hits: ReadonlySet<LeverId>): MarkerNote[] {
  return notes.filter((n) => n.levers.some((l) => FOOD_LEVERS.has(l) && hits.has(l)));
}

/** The chips for a recipe card's fit line (renders nothing when no food note applies). */
export function DishBecauseChips({ dish }: { dish: DishLike }) {
  const { evaluation } = useMarkerEvaluation();
  const dateStyle = useMarkerDateStyle();
  const notes = useMemo(() => {
    const food = evaluation.notes.filter((n) => n.levers.some((l) => FOOD_LEVERS.has(l)));
    if (food.length === 0) return [];
    let table: FoodTable;
    try {
      table = foodTable();
    } catch {
      return [];
    }
    return dishNotes(food, dishLevers(dishComposition(dish, table), dish.perServing.energyKcal.value, evaluation));
  }, [dish, evaluation]);
  if (notes.length === 0) return null;
  return (
    <p className="lv-food-recipe__because">
      <BecauseChips notes={notes} dateStyle={dateStyle} today={markersToday()} form="short" />
    </p>
  );
}
