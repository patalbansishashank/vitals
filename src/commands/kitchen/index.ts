/**
 * `kitchen.*` (SUITE_SPEC §13.3): the person's equipment (with notes and "own it, don't use it"), ranked cuisines,
 * staples and the region they started from, in `kitchen/me`. `kitchen.set` replaces whole lists (the picker,
 * Settings › Kitchen); `kitchen.add` adds equipment by name (the Coach's "I also have a soda maker"), matched against
 * the catalogue or kept as the person's own item. Both are low-impact writes applied with Undo.
 */
import { addEquipment, entryId, resolveFreeText, setKitchenLists, type EquipmentInput } from '@/catalogues/kitchen';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { defineCommand } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from '../defs/_shared';
import type { CommandContext } from '../types';
import { kitchenView, KitchenView, readKitchenDocs, sourceOf, writeKitchen } from './shared';

const ItemId = T.String({ minLength: 1, maxLength: 64, description: 'Catalogue id (eq.*, cu.*, st.*) or custom:<slug>.' });
const Label = T.String({ minLength: 1, maxLength: 80 });
const Note = T.String({ maxLength: 80 });
const Use = T.Enum(['use', 'ownNotUsed'] as const);
const SourceIn = T.Enum(['picker', 'coach', 'paste'] as const);

export const kitchenGet = defineCommand({
  id: 'kitchen.get',
  version: 1,
  title: 'Read the kitchen',
  description: 'The person’s kitchen: equipment (with notes such as "small OTG, 28 L" and items they own but do not use), cuisines most often first, staples they cook with most, and the region they started from. Use it when suggesting recipes.',
  input: T.Object({}),
  output: KitchenView,
  perm: 'read',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => {
    const [{ cat }, docs] = await Promise.all([loadKitchen(), readKitchenDocs(ctx)]);
    return kitchenView(cat, docs.kitchen, docs.migrated.kitchen);
  },
});

const EquipmentIn = T.Object({ id: ItemId, label: T.Optional(Label), note: T.Optional(Note), use: T.Optional(Use), source: T.Optional(SourceIn) });

export const kitchenSet = defineCommand({
  id: 'kitchen.set',
  version: 1,
  title: 'Update the kitchen',
  description: 'Replace whole lists of the kitchen: equipment, cuisines (in order, most often first), staples, regions. Lists not given stay as they are. Items already there keep when they were added.',
  input: T.Object({
    equipment: T.Optional(T.Array(EquipmentIn, { maxItems: 400 })),
    cuisines: T.Optional(T.Array(T.Object({ id: ItemId, rank: T.Optional(T.Integer({ minimum: 1 })), label: T.Optional(Label) }), { maxItems: 200 })),
    staples: T.Optional(T.Array(T.Object({ id: ItemId, label: T.Optional(Label), source: T.Optional(SourceIn) }), { maxItems: 400 })),
    regions: T.Optional(T.Array(T.String({ maxLength: 40 }), { maxItems: 4 })),
  }),
  output: KitchenView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  coalesce: (input, actor) => (actor.kind === 'user' ? `kitchen.set:${Object.keys(input).sort().join(',')}` : undefined),
  execute: async (ctx, input) => {
    const [{ cat }, docs] = await Promise.all([loadKitchen(), readKitchenDocs(ctx)]);
    const src = (s?: 'picker' | 'coach' | 'paste') => sourceOf(ctx, s);
    const next = setKitchenLists(
      docs.kitchen,
      {
        ...(input.equipment ? { equipment: input.equipment.map((e) => ({ ...e, source: src(e.source) }) as EquipmentInput) } : {}),
        ...(input.cuisines ? { cuisines: input.cuisines } : {}),
        ...(input.staples ? { staples: input.staples.map((s) => ({ ...s, source: src(s.source) })) } : {}),
        ...(input.regions ? { regions: input.regions.filter((r) => cat.region(r)) } : {}),
      },
      ctx.now,
    );
    await writeKitchen(ctx, next);
    return kitchenView(cat, next, false);
  },
});

export const kitchenAdd = defineCommand({
  id: 'kitchen.add',
  version: 1,
  title: 'Add kitchen equipment',
  description: 'Add equipment the person says they have, by name (e.g. "soda maker", "egg boiler", "small OTG"): matched to the catalogue, else kept in their words. A note (size, model) and use "ownNotUsed" (they own it but do not use it) are optional. Items already there get the new note.',
  input: T.Object({ items: T.Array(T.Object({ label: Label, id: T.Optional(ItemId), note: T.Optional(Note), use: T.Optional(Use) }), { minItems: 1, maxItems: 50 }) }),
  output: KitchenView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  excludedReason: { ui: 'the picker writes whole lists through kitchen.set; this is for the Coach and agents' },
  undo: UNDO.IP,
  idempotency: 'key',
  sideEffects: ['docs'],
  execute: async (ctx: CommandContext, input) => {
    const [{ cat, index }, docs] = await Promise.all([loadKitchen(), readKitchenDocs(ctx)]);
    const source = sourceOf(ctx);
    const items: EquipmentInput[] = input.items.map((it) => {
      const known = it.id && cat.kindOf(it.id) === 'equipment' ? it.id : null;
      const id = known ?? entryId(it.label, resolveFreeText(index, it.label, ['equipment']).id);
      return { id, ...(cat.get(id) ? {} : { label: it.label }), ...(it.note !== undefined ? { note: it.note } : {}), ...(it.use ? { use: it.use } : {}), source };
    });
    const next = addEquipment(docs.kitchen, items, ctx.now);
    await writeKitchen(ctx, next);
    return kitchenView(cat, next, false);
  },
});

declare module '../types' {
  interface CommandMap {
    'kitchen.get': typeof kitchenGet;
    'kitchen.set': typeof kitchenSet;
    'kitchen.add': typeof kitchenAdd;
  }
}
