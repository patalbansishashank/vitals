/**
 * Shared pieces of the `kitchen.*` and `pantry.*` commands (SUITE_SPEC §13.3): reading the two documents inside a
 * command (falling back to the v0.2 intake answers until the first write, so the migration is lazy and lossless), the
 * views the screens and the Coach read, and the source of an edit by actor.
 */
import {
  migrateFromIntake,
  resolveFood,
  staleItems,
  toKitchenDoc,
  toPantryDoc,
  type KitchenCatalogue,
  type KitchenDoc,
  type KitchenSource,
  type PantryDoc,
  type SeedEquipment,
  type SeedPantry,
} from '@/catalogues/kitchen';
import { labelOf } from '@/catalogues/kitchen';
import type { FoodTable } from '@/catalogues/types';
import { bodyOf } from '@/store';
import { T } from '../schema';
import type { CommandContext } from '../types';

export const KITCHEN_COL = 'kitchen' as const;
export const PANTRY_COL = 'pantry' as const;
export const ME = 'me';

/** Who edited: the Coach (and any agent) writes `coach`; the person writes `picker` unless they pasted a list. */
export function sourceOf(ctx: CommandContext, asked?: KitchenSource): KitchenSource {
  if (ctx.actor.kind !== 'user' && ctx.actor.kind !== 'system') return 'coach';
  return asked === 'paste' ? 'paste' : asked === 'coach' ? 'coach' : 'picker';
}

/** The stored documents, or the migrated intake answers when they were never written. */
export async function readKitchenDocs(ctx: CommandContext): Promise<{ kitchen: KitchenDoc; pantry: PantryDoc; migrated: { kitchen: boolean; pantry: boolean } }> {
  const [k, p] = await Promise.all([ctx.docs.get(KITCHEN_COL, ME), ctx.docs.get(PANTRY_COL, ME)]);
  let legacy: ReturnType<typeof migrateFromIntake> | null = null;
  if (!k || !p) {
    const intake = await ctx.docs.get('intake', ME);
    legacy = migrateFromIntake(intake ? bodyOf(intake) : null, ctx.now);
  }
  return {
    kitchen: k ? toKitchenDoc(bodyOf(k)) : (legacy?.kitchen ?? toKitchenDoc(null)),
    pantry: p ? toPantryDoc(bodyOf(p)) : (legacy?.pantry ?? toPantryDoc(null)),
    migrated: { kitchen: !k && !!legacy?.kitchen, pantry: !p && !!legacy?.pantry },
  };
}

export async function writeKitchen(ctx: CommandContext, doc: KitchenDoc): Promise<void> {
  await ctx.docs.put(KITCHEN_COL, { ...doc, _id: ME });
}
export async function writePantry(ctx: CommandContext, doc: PantryDoc): Promise<void> {
  await ctx.docs.put(PANTRY_COL, { ...doc, _id: ME });
}

/* ------------------------------------------------------------------------------------------------ views */

const Str = T.String();
const Source = T.Enum(['picker', 'coach', 'paste'] as const);

export const KitchenView = T.Object({
  equipment: T.Array(
    T.Object({
      id: Str,
      label: Str,
      note: T.Optional(Str),
      use: T.Enum(['use', 'ownNotUsed'] as const),
      source: Source,
      addedAt: Str,
      /** The person's own item (no catalogue entry). */
      custom: T.Boolean(),
      /** Catalogue group (cooking, prep, storage, serving; "own" for custom items). */
      group: Str,
    }),
  ),
  cuisines: T.Array(T.Object({ id: Str, label: Str, rank: T.Integer({ minimum: 1 }) })),
  staples: T.Array(T.Object({ id: Str, label: Str, source: Source, custom: T.Boolean() })),
  /** Regions whose defaults the person started from (first = main). */
  regions: T.Array(Str),
  /** Nothing saved yet: the lists come from the earlier intake answers. */
  fromIntake: T.Boolean(),
});

export const PantryView = T.Object({
  items: T.Array(
    T.Object({
      id: Str,
      label: Str,
      qtyApprox: T.Optional(Str),
      source: Source,
      addedAt: Str,
      lastConfirmedAt: T.Optional(Str),
      custom: T.Boolean(),
      perishable: T.Boolean(),
      /** Link to the food reference: `resolved` (food id), `pending` (Indian food table not licensed yet), `notBundled`, `none`. No nutrient values. */
      food: T.Object({ status: T.Enum(['resolved', 'pending', 'notBundled', 'none'] as const), foodId: T.Optional(Str), estimated: T.Optional(T.Boolean()) }),
    }),
  ),
  /** Ids of perishable items not confirmed for 14 days: the Coach may ask "still have it?" (nothing is removed). */
  askStillHave: T.Array(Str),
  fromIntake: T.Boolean(),
});

export function kitchenView(cat: KitchenCatalogue, doc: KitchenDoc, fromIntake: boolean) {
  return {
    equipment: doc.equipment.map((e) => {
      const item = cat.get(e.id) as SeedEquipment | undefined;
      return { id: e.id, label: labelOf(cat, e.id, e.label), ...(e.note ? { note: e.note } : {}), use: e.use, source: e.source, addedAt: e.addedAt, custom: !item, group: item?.group ?? 'own' };
    }),
    cuisines: [...doc.cuisines].sort((a, b) => a.rank - b.rank).map((c) => ({ id: c.id, label: labelOf(cat, c.id, c.label), rank: c.rank })),
    staples: doc.staples.map((s) => ({ id: s.id, label: labelOf(cat, s.id, s.label), source: s.source, custom: !cat.get(s.id) })),
    regions: doc.regions ?? [],
    fromIntake,
  };
}

export function pantryView(cat: KitchenCatalogue, doc: PantryDoc, now: string, table: FoodTable | null, fromIntake: boolean) {
  const perishable = (id: string) => (cat.get(id) as SeedPantry | undefined)?.perishable === true;
  return {
    items: doc.items.map((p) => {
      const r = resolveFood(cat, p.id, table);
      return {
        id: p.id,
        label: labelOf(cat, p.id, p.label),
        ...(p.qtyApprox ? { qtyApprox: p.qtyApprox } : {}),
        source: p.source,
        addedAt: p.addedAt,
        ...(p.lastConfirmedAt ? { lastConfirmedAt: p.lastConfirmedAt } : {}),
        custom: !cat.get(p.id),
        perishable: perishable(p.id),
        food: r.status === 'resolved' ? { status: r.status, foodId: r.foodId, estimated: r.estimated } : { status: r.status },
      };
    }),
    askStillHave: staleItems(doc, now, { only: perishable }).map((p) => p.id),
    fromIntake,
  };
}
