/**
 * Staple and pantry items → the food reference (R12 §7), pure. An item resolves to a `FoodRecord` only when the table
 * has it: through `fixtureId` (test tables), or through `usdaFdcId` with the bundle's `fdcId → FoodRecord.id` map
 * (the bundle is a later data task). `ifctPending` items whose only link is a USDA proxy resolve with `estimated: true`
 * (the R4 "estimated composition" mark: never a micronutrient statement); `ifctPending` items with no record are
 * "pending" and their nutrients are not counted. Nothing here states a nutrient value.
 */
import type { FoodRecord, FoodTable } from '../types';
import type { KitchenCatalogue } from './catalogue';
import type { SeedFoodRef, SeedPantry, SeedStaple } from './types';

export type FoodResolution =
  | { status: 'resolved'; foodId: string; record: FoodRecord; estimated: boolean }
  /** Best source is IFCT 2017 (not licensed yet): usable for recipes, nutrients not counted. */
  | { status: 'pending'; reason: 'ifct' }
  /** A link exists but the record is not in this table (the bundle is not built yet). */
  | { status: 'notBundled'; usdaFdcId?: number }
  /** The item has no food link (custom items, niche foods), or the id is not a staple/pantry item. */
  | { status: 'none' };

export function foodRefOf(cat: KitchenCatalogue, id: string): SeedFoodRef | undefined {
  const k = cat.kindOf(id);
  if (k !== 'staples' && k !== 'pantry') return undefined;
  return (cat.get(id) as SeedStaple | SeedPantry).foodRef;
}

export function resolveFood(cat: KitchenCatalogue, id: string, table: FoodTable | null, fdcToFood?: ReadonlyMap<number, string>): FoodResolution {
  const ref = foodRefOf(cat, id);
  if (!ref) return { status: 'none' };
  const viaFdc = ref.usdaFdcId !== undefined ? fdcToFood?.get(ref.usdaFdcId) : undefined;
  for (const fid of [viaFdc, ref.fixtureId]) {
    const rec = fid ? table?.get(fid) : undefined;
    if (rec) return { status: 'resolved', foodId: rec.id, record: rec, estimated: ref.ifctPending === true || !rec.verified };
  }
  if (ref.ifctPending) return { status: 'pending', reason: 'ifct' };
  if (ref.usdaFdcId !== undefined || ref.fixtureId) return { status: 'notBundled', ...(ref.usdaFdcId !== undefined ? { usdaFdcId: ref.usdaFdcId } : {}) };
  return { status: 'none' };
}

/**
 * The food-link key of an item, for de-duplicating staples and pantry in the Coach's "available ingredients" list
 * (R12 §4.1: `st.paneer` and `pa.paneer` share a link). Items without a link key on their own id.
 */
export function foodKey(cat: KitchenCatalogue, id: string): string {
  const ref = foodRefOf(cat, id);
  if (ref?.usdaFdcId !== undefined) return `fdc:${ref.usdaFdcId}`;
  if (ref?.fixtureId) return `fx:${ref.fixtureId}`;
  return id;
}
