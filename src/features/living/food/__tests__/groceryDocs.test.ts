import { beforeEach, describe, expect, it } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken } from '@/store';
import { setDocumentStore, getDocumentStore } from '@/state/runtime';
import { buildGroceryList, documentGrocerySource, mealsFromDocs } from '../groceries';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { useFoodStore } from '../mealPlanStore';

beforeEach(async () => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  useFoodStore.getState().reset();
  await getDocumentStore().ready;
});

async function put(col: 'mealPlans' | 'recipes' | 'pantry', doc: { _id: string } & Record<string, unknown>) {
  await getDocumentStore().transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put(col, doc);
  });
}

describe('document grocery source', () => {
  it('is empty and honest when nothing is saved or accepted', () => {
    const list = documentGrocerySource.list({ planId: 'p', from: '2026-10-01', to: '2026-10-03' });
    expect(list.count).toBe(0);
  });

  it('aggregates the saved meal plans, falling back to a recipe when a plan has no grocery lines', async () => {
    await put('mealPlans', { _id: '2026-10-01', date: '2026-10-01', meals: [], groceries: [{ foodId: 'food:paneer', grams: 200 }, { foodId: 'food:paneer', grams: 100 }] });
    await put('recipes', { _id: '01JABCDEFGHJKMNPQRSTVWXYZ2', title: 'Dal', servings: 2, ingredients: [{ foodId: 'moong_dal', gramsRaw: 200 }] });
    await put('mealPlans', { _id: '2026-10-02', date: '2026-10-02', meals: [{ slot: 'lunch', recipeId: '01JABCDEFGHJKMNPQRSTVWXYZ2' }], groceries: [] });
    const meals = mealsFromDocs({ planId: 'p', from: '2026-10-01', to: '2026-10-03' });
    expect(meals.map((m) => m.date)).toEqual(['2026-10-01', '2026-10-02']);
    const list = documentGrocerySource.list({ planId: 'p', from: '2026-10-01', to: '2026-10-03' });
    expect(list.count).toBe(2);
    expect(list.groups.flatMap((g) => g.items).find((i) => /paneer/i.test(i.name))?.grams).toBe(300);
  });

  it('counts items in the pantry document as already at home, by food id and by name (Q4-11)', async () => {
    await loadKitchen();
    await put('mealPlans', { _id: '2026-10-01', date: '2026-10-01', meals: [], groceries: [{ foodId: 'paneer', grams: 90 }, { foodId: 'spinach_raw', grams: 100 }, { foodId: 'moong_dal', grams: 60 }] });
    await put('pantry', { _id: 'me', _schema: 1, items: [{ id: 'pa.paneer', source: 'coach', addedAt: '2026-10-01T08:00:00Z' }, { id: 'pa.spinach', source: 'coach', addedAt: '2026-10-01T08:00:00Z' }] });
    const items = () => documentGrocerySource.list({ planId: 'p', from: '2026-10-01', to: '2026-10-01' }).groups.flatMap((g) => g.items);
    const have = (re: RegExp) => items().find((i) => re.test(i.name))?.have;
    expect(have(/paneer/i)).toBe(true);
    expect(have(/spinach/i)).toBe(true);
    expect(have(/moong/i)).toBe(false);
    // un-marking on the list wins over the pantry document
    const paneer = items().find((i) => /paneer/i.test(i.name))!;
    documentGrocerySource.setHave(paneer.name, false);
    expect(have(/paneer/i)).toBe(false);
    documentGrocerySource.setHave(paneer.name, true);
    expect(have(/paneer/i)).toBe(true);
  });
});

describe('buildGroceryList pantry matching', () => {
  const meals = [{ planId: 'p', date: '2026-10-01' as const, recipe: { ingredients: [{ name: 'Paneer (estimated from whole-milk cheese)', grams: 90 }, { name: 'Spinach, raw', grams: 100, foodId: 'food:spinach_raw' }, { name: 'Tomato', grams: 80 }] } }];
  it('matches pantry names case-insensitively without brackets, and food ids', () => {
    const list = buildGroceryList(meals, { planId: 'p', from: '2026-10-01', to: '2026-10-01', pantry: ['PANEER'], pantryFoods: ['spinach_raw'], bought: [] });
    const byName = Object.fromEntries(list.groups.flatMap((g) => g.items).map((i) => [i.name, i.have]));
    expect(byName).toEqual({ 'Paneer (estimated from whole-milk cheese)': true, 'Spinach, raw': true, Tomato: false });
  });
});
