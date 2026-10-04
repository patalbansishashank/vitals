/**
 * `pantry.*` (SUITE_SPEC §13.3): what is in the kitchen now, in `pantry/me`. The picker, the Food tab, paste-a-list and
 * the Coach's "I have these at home" all write this one list through `pantry.add`, so the paths converge (one entry
 * per item; adding it again confirms it). `pantry.parseList` reads free text into items (catalogue matcher; nothing is
 * written). Nothing expires by time: the view only names perishables the Coach may ask "still have it?" about.
 */
import { addPantry, entryId, parseKitchenList, removePantry, resolveFreeText, setPantry, type KitchenKind, type PantryInput } from '@/catalogues/kitchen';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { defineCommand } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from '../defs/_shared';
import { pantryView, PantryView, readKitchenDocs, sourceOf, writePantry } from '../kitchen/shared';
import { foodTable } from './table';

/** Pantry text matches pantry items first, then staples (both are foods). */
export const PANTRY_KINDS: readonly KitchenKind[] = ['pantry', 'staples'];

const ItemId = T.String({ minLength: 1, maxLength: 64, description: 'Pantry or staple id (pa.*, st.*) or custom:<slug>.' });
const Label = T.String({ minLength: 1, maxLength: 80 });
const Qty = T.String({ maxLength: 40 });
const SourceIn = T.Enum(['picker', 'coach', 'paste'] as const);

const tableOrNull = () => {
  try {
    return foodTable();
  } catch {
    return null;
  }
};

export const pantryGet = defineCommand({
  id: 'pantry.get',
  version: 1,
  title: 'Read the pantry',
  description: 'What is in the person’s kitchen now: each item with an approximate quantity when told, and which perishables have not been confirmed for 14 days (ask "still have it?" only when a recipe depends on one). Nothing is removed automatically.',
  input: T.Object({}),
  output: PantryView,
  perm: 'read',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => {
    const [{ cat }, docs] = await Promise.all([loadKitchen(), readKitchenDocs(ctx)]);
    return pantryView(cat, docs.pantry, ctx.now, tableOrNull(), docs.migrated.pantry);
  },
});

export const pantryAdd = defineCommand({
  id: 'pantry.add',
  version: 1,
  title: 'Add to the pantry',
  description: 'Add things the person has at home now, by name ("2 kg onions" → label "onions", qtyApprox "2 kg"); matched to the catalogue (Hindi and regional names too), else kept in their words. An item already there is confirmed again. Set replace: true only for the picker’s whole list.',
  input: T.Object({
    items: T.Array(T.Object({ label: Label, id: T.Optional(ItemId), qtyApprox: T.Optional(Qty) }), { minItems: 0, maxItems: 400 }),
    source: T.Optional(SourceIn),
    replace: T.Optional(T.Boolean({ description: 'Replace the whole pantry with these items (the picker).' })),
  }),
  output: PantryView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'key',
  sideEffects: ['docs'],
  coalesce: (input, actor) => (actor.kind === 'user' && input.replace ? 'pantry.add:replace' : undefined),
  execute: async (ctx, input) => {
    const [{ cat, index }, docs] = await Promise.all([loadKitchen(), readKitchenDocs(ctx)]);
    const source = sourceOf(ctx, input.source);
    const items: PantryInput[] = input.items.map((it) => {
      const k = it.id ? cat.kindOf(it.id) : null;
      const known = it.id && (k === 'pantry' || k === 'staples' || it.id.startsWith('custom:')) ? it.id : null;
      const id = known ?? entryId(it.label, resolveFreeText(index, it.label, PANTRY_KINDS).id);
      return { id, ...(cat.get(id) ? {} : { label: it.label }), ...(it.qtyApprox ? { qtyApprox: it.qtyApprox } : {}), source };
    });
    const next = input.replace ? setPantry(docs.pantry, items, ctx.now) : addPantry(docs.pantry, items, ctx.now);
    await writePantry(ctx, next);
    return pantryView(cat, next, ctx.now, tableOrNull(), false);
  },
});

export const pantryRemove = defineCommand({
  id: 'pantry.remove',
  version: 1,
  title: 'Remove from the pantry',
  description: 'Remove items the person no longer has (ids from pantry.get).',
  input: T.Object({ ids: T.Array(ItemId, { minItems: 1, maxItems: 400 }) }),
  output: PantryView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  excludedReason: { ui: 'the picker replaces the whole list through pantry.add; this is for the Coach and agents' },
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: async (ctx, input) => {
    const [{ cat }, docs] = await Promise.all([loadKitchen(), readKitchenDocs(ctx)]);
    const next = removePantry(docs.pantry, input.ids);
    await writePantry(ctx, next);
    return pantryView(cat, next, ctx.now, tableOrNull(), false);
  },
});

export const pantryParseList = defineCommand({
  id: 'pantry.parseList',
  version: 1,
  title: 'Read a list of food',
  description: 'Turn a pasted or typed list (lines, commas, bullets; quantities are kept apart) into items matched to the catalogue, with a confidence 0–1; unmatched lines come back with id null and are kept as written. Nothing is saved: pass the result to pantry.add.',
  input: T.Object({ text: T.String({ minLength: 1, maxLength: 8000 }) }),
  output: T.Object({ items: T.Array(T.Object({ label: T.String(), id: T.Nullable(T.String()), confidence: T.Number(), qty: T.Optional(T.String()) })) }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the picker runs the same catalogue matcher locally; this is for the Coach and agents' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (_ctx, input) => {
    const { index } = await loadKitchen();
    return { items: parseKitchenList(index, input.text, PANTRY_KINDS) };
  },
});

declare module '../types' {
  interface CommandMap {
    'pantry.get': typeof pantryGet;
    'pantry.add': typeof pantryAdd;
    'pantry.remove': typeof pantryRemove;
    'pantry.parseList': typeof pantryParseList;
  }
}
