/**
 * Staple and pantry items → the food reference (R12 §7, D6-05), pure. An item resolves to a `FoodRecord` only when the
 * table has it, matching preparation state before any alias:
 *  1. through `usdaFdcId`: the table record whose provenance is that exact FDC row (`provenance.sourceId` `fdc:<id>`), or
 *     the caller's `fdcToFood` map — an exact source identity, state included;
 *  2. through `fixtureId` (a curated app link, used by test tables): accepted only when its state is compatible with the
 *     state the item's FDC description names; otherwise it is a transparent state proxy (`proxy: 'stateMismatch'`, always
 *     `estimated`), never a silent raw-for-cooked substitution.
 * `ifctPending` items whose only link is a USDA proxy resolve with `estimated: true` (the R4 "estimated composition" mark:
 * never a micronutrient statement); `ifctPending` items with no record are "pending" and their nutrients are not counted.
 * Nothing here states a nutrient value.
 */
import { stateCompatible, stateOfText } from '../foods';
import type { FoodRecord, FoodTable } from '../types';
import type { KitchenCatalogue } from './catalogue';
import type { SeedFoodRef, SeedPantry, SeedStaple } from './types';

export type FoodResolution =
  | {
      status: 'resolved';
      foodId: string;
      record: FoodRecord;
      estimated: boolean;
      /** How the record was found: the exact FDC row, or the curated fixture link. */
      via: 'fdc' | 'fixture';
      /** A link whose record differs from the item in preparation state (a transparent proxy). */
      proxy?: 'stateMismatch';
    }
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

/** FDC id → table record id, from the records' own provenance (`fdc:<id>`). */
export function fdcIndexOf(table: FoodTable | null): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const r of table?.all() ?? []) {
    const sid = r.provenance?.sourceId;
    const mm = sid ? /^fdc:(\d+)$/.exec(sid) : null;
    if (mm && !m.has(Number(mm[1]))) m.set(Number(mm[1]), r.id);
  }
  return m;
}

/** The preparation state a link declares (`state`), else the state its FDC description names. */
function linkState(ref: SeedFoodRef): FoodRecord['state'] | undefined {
  if (ref.state) return ref.state === 'asEaten' ? 'as-eaten' : ref.state;
  return ref.usdaDescription ? stateOfText(ref.usdaDescription) : undefined;
}

export function resolveFood(cat: KitchenCatalogue, id: string, table: FoodTable | null, fdcToFood?: ReadonlyMap<number, string>): FoodResolution {
  const ref = foodRefOf(cat, id);
  if (!ref) return { status: 'none' };
  if (ref.usdaFdcId !== undefined) {
    const fid = fdcToFood?.get(ref.usdaFdcId) ?? fdcIndexOf(table).get(ref.usdaFdcId);
    const rec = fid ? table?.get(fid) : undefined;
    if (rec) return { status: 'resolved', foodId: rec.id, record: rec, estimated: ref.proxy === true || ref.ifctPending === true || !rec.verified, via: 'fdc' };
  }
  const rec = ref.fixtureId ? table?.get(ref.fixtureId) : undefined;
  if (rec) {
    const wanted = linkState(ref);
    const mismatch = !stateCompatible(rec, wanted) || (ref.fortified !== undefined && rec.fortified !== undefined && ref.fortified !== rec.fortified);
    return { status: 'resolved', foodId: rec.id, record: rec, estimated: mismatch || ref.proxy === true || ref.ifctPending === true || !rec.verified, via: 'fixture', ...(mismatch ? { proxy: 'stateMismatch' as const } : {}) };
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
