/** E9b food executors through the bus: parse, candidates, targets, planDay (fit / off target / hard filters), recipes, groceries. */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore } from '@/state/runtime';
import { readFoodSetup, supplementLine } from '..';
import { seedIntake, seedPlan } from './seed';

const DATE = '2026-10-01';

function out<T = Record<string, unknown>>(r: CommandResult): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  if (!('output' in r)) throw new Error('no output');
  return r.output as T;
}
function err(r: CommandResult) {
  return r.ok ? null : r.error;
}

beforeEach(() => {
  freshState({ cleared: true });
});

describe('food.parse', () => {
  it('reads quantities, household units and local names against the food table', async () => {
    const r = out<{ components: Array<{ foodId?: string; grams: number; gramsLow: number; gramsHigh: number; amount: string; matchScore: number }>; unmatched: string[] }>(
      await dispatch('food.parse', { text: '2 eggs, 150g chawal, 1 katori dal and 2 rotis, xyzzy' }),
    );
    const [eggs, rice, dal, roti, unknown] = r.components;
    expect(eggs).toMatchObject({ foodId: 'egg_whole_raw', grams: 100, amount: 'count' });
    expect(rice).toMatchObject({ foodId: 'rice_white_cooked', grams: 150, amount: 'weighed', matchScore: 1 });
    expect(dal).toMatchObject({ foodId: 'lentils_cooked', grams: 150, amount: 'household' });
    expect(roti).toMatchObject({ foodId: 'wheat_flour_wholegrain', grams: 50 });
    expect(rice!.gramsLow).toBeLessThan(150);
    expect(rice!.gramsHigh).toBeGreaterThan(150);
    expect(unknown!.foodId).toBeUndefined();
    expect(r.unmatched).toEqual(['xyzzy']);
  });
});

describe('food.dayTargets and food.candidates', () => {
  it('splits the prescription into slot targets', async () => {
    await seedPlan();
    const t = out<Array<{ slot: string; energyKcal: number; proteinG: number; lowCarbDay?: boolean }>>(await dispatch('food.dayTargets', { date: DATE }));
    expect(t.length).toBeGreaterThan(0);
    expect(t.reduce((s, x) => s + x.energyKcal, 0)).toBeCloseTo(2000, 0);
    expect(t.reduce((s, x) => s + x.proteinG, 0)).toBeCloseTo(150, 0);
    expect(t[0]!.lowCarbDay).toBeUndefined();
  });

  it('returns no targets without a plan', async () => {
    expect(out(await dispatch('food.dayTargets', { date: DATE }))).toEqual([]);
  });

  it('applies the diet and the day rules (low-carbohydrate / PSMF day)', async () => {
    await seedIntake({ pantry: ['paneer'] });
    await seedPlan({ kcal: 900, proteinG: 120, carbG: 30, label: 'PSMF day' });
    const c = out<Array<{ id: string; inKitchen: boolean }>>(await dispatch('food.candidates', { date: DATE }));
    const ids = c.map((x) => x.id);
    expect(ids).not.toContain('chicken_breast_raw'); // vegetarian
    expect(ids).not.toContain('egg_whole_raw'); // no eggs
    expect(ids).not.toContain('rice_white_cooked'); // low-carbohydrate day
    expect(ids).not.toContain('paneer'); // PSMF: lean foods only
    expect(ids).toContain('spinach_raw');
    const t = out<Array<{ lowCarbDay?: boolean }>>(await dispatch('food.dayTargets', { date: DATE }));
    expect(t.every((x) => x.lowCarbDay)).toBe(true);
  });

  it('puts kitchen foods first on an ordinary day', async () => {
    await seedIntake({ pantry: ['paneer'] });
    await seedPlan();
    const c = out<Array<{ id: string; inKitchen: boolean }>>(await dispatch('food.candidates', { date: DATE, slot: 'meal1' }));
    expect(c[0]).toMatchObject({ id: 'paneer', inKitchen: true });
    expect(c.map((x) => x.id)).toContain('rice_white_cooked');
  });
});

describe('food.planDay', () => {
  const lunch = [
    { foodId: 'chicken_breast_raw', grams: 150 },
    { foodId: 'rice_white_cooked', grams: 150 },
    { foodId: 'lentils_cooked', grams: 100 },
    { foodId: 'ghee', grams: 10 },
    { foodId: 'yogurt_whole', grams: 100 },
  ];

  it('fits portions to the slot target, verifies the totals and saves the meal plan', async () => {
    await seedPlan();
    const r = out<{ status: string; meals: Array<{ slot: string; totals: { energyKcal: number; proteinG: number }; items: Array<{ grams: number; gramsProposed: number }> }>; deviations: Array<{ ok: boolean }> }>(
      await dispatch('food.planDay', { date: DATE, meals: [{ slot: 'meal2', dish: 'Chicken, rice, dal', items: lunch }] }),
    );
    expect(r.status).toBe('fits');
    expect(r.deviations.every((d) => d.ok)).toBe(true);
    expect(Math.abs(r.meals[0]!.totals.energyKcal - 666.7)).toBeLessThanOrEqual(75);
    for (const it of r.meals[0]!.items) {
      expect(it.grams).toBeGreaterThanOrEqual(it.gramsProposed * 0.5 - 5);
      expect(it.grams).toBeLessThanOrEqual(it.gramsProposed * 1.6 + 5);
    }
    await settleCommits();
    const doc = getDocumentStore().peek<{ meals: Array<{ slot: string; fit: { withinTolerance: boolean } }> }>('mealPlans', DATE);
    expect(doc?.meals[0]).toMatchObject({ slot: 'meal2', fit: { withinTolerance: true } });

    const g = out<{ items: Array<{ foodId: string; grams: number; aisle: string }> }>(await dispatch('food.groceryList', { from: DATE, to: '2026-10-03' }));
    expect(g.items.map((i) => i.foodId).sort()).toEqual(lunch.map((i) => i.foodId).sort());
    expect(g.items.find((i) => i.foodId === 'chicken_breast_raw')?.aisle).toBe('protein');
  });

  it('fails with what was off when the meals cannot reach the targets, and saves the closest fit on request', async () => {
    await seedPlan();
    const meals = [{ slot: 'meal1', items: [{ foodId: 'spinach_raw', grams: 100 }, { foodId: 'ghee', grams: 5 }] }];
    const e = err(await dispatch('food.planDay', { date: DATE, meals }));
    expect(e?.code).toBe('invalid_input');
    expect(e?.message).toMatch(/Off target/);
    expect(e?.message).toMatch(/protein is \d+(\.\d+)? % low/);
    expect(e?.detail?.retryable).toBe(true);
    await settleCommits();
    expect(getDocumentStore().peek('mealPlans', DATE)).toBeNull();
    const r = out<{ status: string; repairHints: string[] }>(await dispatch('food.planDay', { date: DATE, meals: meals.map((m) => ({ ...m, acceptClosest: true })) }));
    expect(r.status).toBe('closest');
    expect(r.repairHints.length).toBeGreaterThan(0);
  });

  it('rejects foods the person does not eat', async () => {
    await seedIntake();
    await seedPlan();
    const e = err(await dispatch('food.planDay', { date: DATE, meals: [{ slot: 'meal2', items: lunch }] }));
    expect(e?.code).toBe('invalid_input');
    expect(e?.message).toMatch(/Chicken breast.*not allowed/);
  });

  it('rejects nutrient numbers and unknown slots', async () => {
    await seedPlan();
    expect(err(await dispatch('food.planDay', { date: DATE, meals: [{ slot: 'meal2', items: [{ foodId: 'rice_white_cooked', grams: 100, energyKcal: 130 }] }] }))?.code).toBe('invalid_input');
    expect(err(await dispatch('food.planDay', { date: DATE, meals: [{ slot: 'brunch', items: lunch }] }))?.message).toMatch(/no meal slot/);
  });
});

describe('recipes', () => {
  it('saves with app-computed nutrients, lists, deletes (restorable)', async () => {
    const saved = out<{ id: string }>(
      await dispatch('food.saveRecipe', { recipe: { title: 'Dal chawal', cuisine: 'north Indian', servings: 2, ingredients: [{ foodId: 'lentils_cooked', gramsRaw: 300 }, { foodId: 'rice_white_cooked', gramsRaw: 300 }], perServing: { energyKcal: 9999 } } }),
    );
    await settleCommits();
    const list = out<Array<{ id: string; title: string; perServing: { energyKcal: { value: number } } }>>(await dispatch('food.recipes', { q: 'dal' }));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(saved.id);
    expect(list[0]!.perServing.energyKcal.value).toBeCloseTo((116 * 3 + 130 * 3) / 2, 0);
    expect(out<unknown[]>(await dispatch('food.recipes', { q: 'pizza' }))).toEqual([]);

    expect(err(await dispatch('food.saveRecipe', { recipe: { title: 'x', ingredients: [{ foodId: 'nope', gramsRaw: 10 }] } }))?.code).toBe('invalid_input');

    const del = await dispatch('food.deleteRecipe', { id: saved.id });
    expect(out(del)).toEqual({ id: saved.id });
    await settleCommits();
    expect(out<unknown[]>(await dispatch('food.recipes', {}))).toEqual([]);
    const cs = del.ok && 'changeSet' in del ? del.changeSet : null;
    expect((await dispatch('history.undo', { changeSetId: cs!.id })).ok).toBe(true);
    await settleCommits();
    expect(out<unknown[]>(await dispatch('food.recipes', {}))).toHaveLength(1);
    expect(err(await dispatch('food.deleteRecipe', { id: '01JZZZZZZZZZZZZZZZZZZZZZZZ' }))?.code).toBe('not_found');
  });
});

describe('supplements line', () => {
  it('lists catalogue supplements only when the person opted in', async () => {
    await seedIntake({ stance: 'food_first' });
    expect(supplementLine({ setup: readFoodSetup() })).toEqual({ optedIn: false, items: [], hiddenForSafety: 0 });
    await seedIntake({ stance: 'open' });
    const line = supplementLine({ setup: readFoodSetup() });
    expect(line.optedIn).toBe(true);
    expect(line.items.length).toBeGreaterThan(0);
    expect(line.items.map((i) => i.id)).toContain('vitamin_b12'); // vegetarian risk
  });
});
