/** E9b food executors through the bus: parse, candidates, targets, planDay (fit / off target / hard filters), recipes, groceries. */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { readFileSync } from 'node:fs';
import { getDocumentStore } from '@/state/runtime';
import type { LogEntry, MealComponent } from '@/living';
import { contentHash } from '@/lib/bodyContracts';
import { FOOD_REFERENCE_VERSION } from '@/content/catalogues/foods.reference';
import { estimateMeal, foodTable, foodTableIssues, readFoodSetup, recipeComposition, relogComponents, relogSnapshotComponents, resolveComponents, supplementLine, toMealComponents, validateRecipe, type MealComponentOut, type MealLogResult, type RecipeServingSnapshot } from '..';
import { isExposureBreakdown, mealExposures, POLYOL_ROUTE_ASSUMPTIONS, readMealIntake, substrateOutputStatus } from '@/lib/nutrientExposure';
import { seedCustomFoods, seedIntake, seedPlan, seedRecipe } from './seed';

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
    expect(ids).not.toContain('ghee'); // PSMF: lean foods only
    expect(ids).not.toContain('almond_butter');
    expect(ids).toContain('spinach_raw');
    const t = out<Array<{ lowCarbDay?: boolean }>>(await dispatch('food.dayTargets', { date: DATE }));
    expect(t.every((x) => x.lowCarbDay)).toBe(true);
  });

  it('puts kitchen foods first on an ordinary day', async () => {
    await seedIntake({ pantry: ['yogurt_whole'] });
    await seedPlan();
    const c = out<Array<{ id: string; inKitchen: boolean }>>(await dispatch('food.candidates', { date: DATE, slot: 'meal1' }));
    expect(c[0]).toMatchObject({ id: 'yogurt_whole', inKitchen: true });
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

/* ------------------------------------------------------------------------------------------- W1 food contracts */

type Meal = Extract<LogEntry, { kind: 'meal' }>;
const meals = () => getDocumentStore().peekAll<Meal>('dailyLogs').filter((d) => d.kind === 'meal') as unknown as Meal[];
const byId = (id: string) => meals().find((m) => (m as unknown as { _id: string })._id === id)!;
const logMeal = async (input: Record<string, unknown>) => {
  const r = out<MealLogResult>(await dispatch('log.meal', { method: 'typed', date: DATE, ...input }));
  if (r.status !== 'logged') throw new Error(`not logged: ${JSON.stringify(r)}`);
  await settleCommits();
  return byId(r.entryId);
};
let docN = 0;
const customFood = (id: string, per100g: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  _id: `01JFD${String(++docN).padStart(21, '0')}`,
  kind: 'food',
  key: id,
  item: { id, name: id.replace(/-/g, ' '), aliases: [], group: 'other', tags: [], source: 'user', verified: false, state: 'as-eaten', portions: [], sources: ['user'], per100g, ...extra },
});

describe('one shared food provider (D6-05)', () => {
  it('production reads the frozen FDC reference, never the test fixture', () => {
    expect(foodTable().version).toBe(FOOD_REFERENCE_VERSION);
    expect(foodTable().get('egg_whole_raw')!.provenance?.sourceId).toBe('fdc:171287');
    expect(readFileSync('src/commands/food/table.ts', 'utf8')).not.toMatch(/foods\.fixture/);
  });

  it('a custom food reaches the command provider; malformed synced records are quarantined, not normalised', async () => {
    await seedCustomFoods([
      customFood('user-chilla', { energyKcal: 210, proteinG: 11, fatG: 7, carbG: 25, fibreG: 5 }, { carbBasis: 'totalByDifference' }),
      customFood('user-broken', { energyKcal: 100, proteinG: Number.NaN, fatG: 1, carbG: 1 }),
      customFood('user-negative', { energyKcal: 100, proteinG: 5, fatG: 1, carbG: 1, sodiumMg: -4 }),
    ]);
    const t = foodTable();
    expect(t.get('user-chilla')).toBeDefined();
    expect(t.get('user-broken')).toBeUndefined();
    expect(t.get('user-negative')).toBeUndefined();
    expect(foodTableIssues().map((i) => i.docId).filter(Boolean)).toHaveLength(2);
    expect(t.version).toBe(`${FOOD_REFERENCE_VERSION}+user:${contentHash([t.get('user-chilla')])}`);
    const e = await logMeal({ components: [{ name: 'chilla', foodId: 'user-chilla', grams: 200 }] });
    expect(e.totals.energyKcal.value).toBeCloseTo(420, 6);
    expect(e.totals.carbG.value).toBeCloseTo(40, 6); // (25 − 5) × 2: fibre subtracted once
  });

  it('a provider update never rewrites an old meal; "same as yesterday" can clone the frozen serving snapshot', async () => {
    const old = await logMeal({ components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 200 }] });
    const before = JSON.stringify(old.components);
    // the person overrides the reference row with their own record (explicit custom id override)
    await seedCustomFoods([customFood('rice_white_cooked', { energyKcal: 200, proteinG: 4, fatG: 1, carbG: 44, fibreG: 1 }, { carbBasis: 'totalByDifference' })]);
    expect(JSON.stringify(byId((old as unknown as { _id: string })._id).components)).toBe(before);
    // the clone path (internal until the agent schema carries `fromSnapshot`): same composition, same source version
    const cloned = estimateMeal(resolveComponents(relogSnapshotComponents(old), 'typed', foodTable()));
    expect(cloned.totals.energyKcal.value).toBeCloseTo(old.totals.energyKcal.value, 9);
    expect(cloned.components[0]!.snapshot).toEqual(old.components[0]!.snapshot);
    const byIdOnly = await logMeal({ components: relogComponents(old) });
    expect(byIdOnly.totals.energyKcal.value).toBeCloseTo(400, 6); // re-resolved through today's table
  });

  it('a snapshot names its own record version: an unrelated custom food leaves the shared source group unchanged', async () => {
    const a = await logMeal({ components: [{ name: 'egg', foodId: 'egg_whole_raw', grams: 50 }] });
    await seedCustomFoods([customFood('user-poha', { energyKcal: 350, proteinG: 7, fatG: 1, carbG: 77, fibreG: 3 }, { carbBasis: 'totalByDifference' })]);
    const b = await logMeal({ components: [{ name: 'egg', foodId: 'egg_whole_raw', grams: 50 }] });
    expect(a.components[0]!.snapshot!.version).toBe(FOOD_REFERENCE_VERSION);
    expect(b.sourceVersion).not.toBe(a.sourceVersion); // the table as a whole changed
    const src = (m: Meal) => m.components[0]!.uncertaintyGroupIds!.find((g) => g.startsWith('sourceComposition'));
    expect(src(b)).toBe(src(a));
  });

  it('preparation words select the matching state; raw and cooked rows stay distinct', async () => {
    const parse = async (text: string) => out<{ components: Array<{ foodId?: string; matchScore: number }> }>(await dispatch('food.parse', { text })).components[0]!;
    expect((await parse('150 g boiled chickpeas')).foodId).toBe('chickpeas_cooked');
    expect((await parse('80 g dry chickpeas')).foodId).toBe('chickpeas_raw');
    expect((await parse('70 g raw rice')).foodId).toBe('rice_white_raw');
    expect((await parse('1 katori rice')).foodId).toBe('rice_white_cooked');
    // a cooked request with only a raw row: a weaker, transparent match (never full confidence)
    expect((await parse('100 g boiled egg')).matchScore).toBeLessThanOrEqual(0.6);
  });

  it('every nutrient the source gives is frozen into the entry; partial nutrients stay partial (D6-03)', async () => {
    const e = await logMeal({ components: [{ name: 'egg', foodId: 'egg_whole_raw', grams: 100 }] });
    expect(e.components[0]!.snapshot!.per100g).toMatchObject({ calciumMg: 56, sodiumMg: 142, carbG: 0.72, vitDUg: 2 });
    const x = (id: string, m: Meal = e) => m.exposures!.find((q) => q.id === id);
    expect(x('calcium')).toMatchObject({ value: 56, unit: 'mg', coverage: 'complete' });
    expect(x('sodium')).toMatchObject({ value: 142, coverage: 'complete' });
    expect(e.totals.sodiumMg?.value).toBeCloseTo(142, 6);
    // add typed numbers without sodium: sodium becomes a partial known sum, never a complete total
    const mixed = await logMeal({ components: [{ name: 'egg', foodId: 'egg_whole_raw', grams: 100 }, { name: 'bar', grams: 50, labelPer100g: { energyKcal: 400, proteinG: 10 } }] });
    expect(x('sodium', mixed)).toMatchObject({ value: null, lowerBound: 142, coverage: 'partial' });
    expect(mixed.totals.sodiumMg).toBeUndefined();
    expect(mixed.nutrientCoverage!.calcium).toBe('partial');
  });

  it('values the source imputed count but stay marked imputed, through recipes and "same as yesterday" (D6-03)', async () => {
    const e = await logMeal({ components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 200 }] });
    const x = (id: string, m: Meal = e) => m.exposures!.find((q) => q.id === id);
    // FDC marks rice B12 and vitamin D as imputed, calcium and protein as analysed
    expect((e.components[0] as MealComponent & { imputedNutrients?: string[] }).imputedNutrients).toEqual(expect.arrayContaining(['b12Ug', 'vitDUg']));
    expect(x('b12')).toMatchObject({ value: 0, provenance: 'imputed' });
    expect(x('calcium')!.provenance).toBe('estimated');
    expect(x('protein')!.provenance).toBe('estimated');
    // one caffeine exposure (FDC assumed zero: imputed), never two
    expect(e.exposures!.filter((q) => q.id === 'caffeine')).toHaveLength(1);
    expect(x('caffeine')).toMatchObject({ value: 0, provenance: 'imputed' });
    // "same as yesterday" clones the snapshot with its marks (internal clone path until the schema carries `fromSnapshot`)
    const cloned = toMealComponents(estimateMeal(resolveComponents(relogSnapshotComponents(e), 'typed', foodTable())));
    expect(cloned[0]!.imputedNutrients).toEqual((e.components[0] as MealComponent & { imputedNutrients?: string[] }).imputedNutrients);
    const xs = mealExposures(cloned.map((c) => ({ nutrients: c.nutrients, source: 'table' as const, grams: c.grams.value, snapshot: c.snapshot ?? null, ...(c.imputedNutrients ? { imputed: c.imputedNutrients } : {}) })));
    expect(xs.find((q) => q.id === 'b12')!.provenance).toBe('imputed');
    expect(xs.find((q) => q.id === 'calcium')!.provenance).toBe('estimated');
    // a recipe batch keeps the mark of its ingredients
    const batch = recipeComposition({ schemaVersion: 2, ingredients: [{ foodId: 'rice_white_cooked', massG: 300, massBasis: 'edible' }, { foodId: 'egg_whole_raw', massG: 50, massBasis: 'edible' }], yieldSource: 'measured', finalEdibleMassG: 350 }, foodTable());
    expect(batch.per100!.imputed).toEqual(expect.arrayContaining(['b12Ug', 'vitDUg']));
    expect(batch.per100!.imputed).not.toContain('calciumMg');
  });

  it('a measured-ME almond form replaces its label energy (never stacked); butter differs from whole almonds (D6-08)', async () => {
    const whole = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', grams: 42 }] });
    const butter = await logMeal({ components: [{ name: 'almond butter', foodId: 'almond_butter', grams: 42 }] });
    expect(whole.totals.energyKcal.value).toBeCloseTo(4.42 * 42, 1);
    expect(butter.totals.energyKcal.value).toBeCloseTo(6.53 * 42, 1);
    expect(whole.energy!.status).not.toBe('conflict'); // a table residual is source reconciliation
    expect(whole.components[0]!.snapshot!.per100g).toMatchObject({ energyKcal: 442, sourceEnergyKcal: 579 });
  });

  it('the amount method sets the band; numeric grams alone are never "weighed"; non-weighed amounts share a reporting-bias group (D6-06)', async () => {
    const typed = await logMeal({ components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 200 }] });
    const weighed = await logMeal({ components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 200, amountMethod: 'weighed' }] });
    expect(typed.components[0]!.amountMethod).toBeUndefined();
    expect(weighed.components[0]!.amountMethod).toBe('weighed');
    expect(weighed.totals.energyKcal.sd).toBeLessThan(typed.totals.energyKcal.sd);
    expect(typed.components[0]!.uncertaintyGroupIds).toContain('reportingBias:person:unknown');
    expect(weighed.components[0]!.uncertaintyGroupIds!.some((g) => g.startsWith('reportingBias'))).toBe(false);
    // the same food record version is one shared source-composition group across meals
    const src = (m: Meal) => m.components[0]!.uncertaintyGroupIds!.find((g) => g.startsWith('sourceComposition'));
    expect(src(typed)).toBe(src(weighed));
  });
});

describe('recipes: final edible mass, refuse and retention once, fractions without yield (D6-04)', () => {
  const comp = (body: Record<string, unknown>) => recipeComposition(body as never, foodTable());
  const v2 = (ingredients: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({ schemaVersion: 2, yieldSource: 'unknown', ingredients, ...extra });

  it('water gain halves concentration when the final mass doubles; batch nutrients are unchanged', () => {
    const ing = [{ foodId: 'rice_white_raw', massG: 200, massBasis: 'edible' }];
    const a = comp(v2(ing, { yieldSource: 'measured', finalEdibleMassG: 300 }));
    const b = comp(v2(ing, { yieldSource: 'measured', finalEdibleMassG: 600, waterAddedG: 300 }));
    expect(b.batch.energyKcal).toBeCloseTo(a.batch.energyKcal!, 9);
    expect(b.per100!.energyKcal).toBeCloseTo(a.per100!.energyKcal / 2, 9);
  });

  it('evaporation raises concentration without creating nutrient mass (mass balance)', () => {
    const ing = [{ foodId: 'lentils_cooked', massG: 500, massBasis: 'edible' }];
    const none = comp(v2(ing, { waterAddedG: 0, evaporationG: 0 }));
    const boiled = comp(v2(ing, { waterAddedG: 0, evaporationG: 100 }));
    expect(boiled.massBasis).toBe('massBalance');
    expect(boiled.batch.proteinG).toBeCloseTo(none.batch.proteinG!, 9);
    expect(boiled.per100!.proteinG).toBeGreaterThan(none.per100!.proteinG);
  });

  it('an as-purchased banana loses its refuse once; an edible mass does not', () => {
    const purchased = comp(v2([{ foodId: 'banana_raw', massG: 100, massBasis: 'asPurchased' }]));
    const edible = comp(v2([{ foodId: 'banana_raw', massG: 100, massBasis: 'edible' }]));
    expect(purchased.batch.energyKcal).toBeCloseTo(89 * 0.64, 9);
    expect(edible.batch.energyKcal).toBeCloseTo(89, 9);
  });

  it('an already-cooked record never gets raw-to-cooked retention; a raw record gets the given factor once', () => {
    const cooked = comp(v2([{ foodId: 'lentils_cooked', massG: 300, massBasis: 'edible', retention: { folateDfeUg: 0.5 } }]));
    expect(cooked.batch.folateDfeUg).toBeCloseTo(181 * 3, 9);
    const raw = comp(v2([{ foodId: 'chickpeas_raw', massG: 100, massBasis: 'edible', retention: { folateDfeUg: 0.5 } }]));
    expect(raw.batch.folateDfeUg).toBeCloseTo(557 * 0.5, 9);
  });

  it('drained liquid or discarded oil leave only the nutrients known to leave; unknown discards make those nutrients unknown', () => {
    const ing = [{ foodId: 'chickpeas_cooked', massG: 400, massBasis: 'edible' }, { foodId: 'ghee', massG: 20, massBasis: 'edible' }];
    const kept = comp(v2(ing));
    const known = comp(v2(ing, { discards: [{ kind: 'oil', massG: 5, nutrients: { fatG: 5, energyKcal: 44 } }] }));
    const unknown = comp(v2(ing, { discards: [{ kind: 'oil', massG: 5 }] }));
    expect(known.batch.fatG).toBeCloseTo(kept.batch.fatG! - 5, 9);
    expect(unknown.batch.fatG).toBeNull();
    expect(unknown.batch.proteinG).toBeCloseTo(kept.batch.proteinG!, 9); // oil carries no protein
    // an unknown removal leaves an upper bound (the pre-discard total), never a positive lower bound (A1-042)
    expect(unknown.batchKnown.fatG).toBe(0);
    expect(unknown.batchUpper.fatG).toBeCloseTo(kept.batch.fatG!, 9);
  });

  it('rejects Infinity, NaN and non-positive masses', () => {
    expect(validateRecipe(v2([{ foodId: 'banana_raw', massG: Number.POSITIVE_INFINITY, massBasis: 'edible' }]) as never)).not.toEqual([]);
    expect(validateRecipe(v2([{ foodId: 'banana_raw', massG: 0, massBasis: 'edible' }]) as never)).not.toEqual([]);
    expect(validateRecipe(v2([{ foodId: 'banana_raw', massG: 100, massBasis: 'edible' }], { yieldSource: 'measured', finalEdibleMassG: Number.NaN }) as never)).not.toEqual([]);
    expect(validateRecipe(v2([{ foodId: 'banana_raw', massG: 100, massBasis: 'edible' }], { yieldSource: 'measured', finalEdibleMassG: -1 }) as never)).not.toEqual([]);
  });

  it('a recipe without a final mass is logged as a share of its batch; cooked grams are refused, not given a density', async () => {
    await seedRecipe('01JRC000000000000000000001', {
      title: 'Dal tadka', servings: 4, schemaVersion: 2, yieldSource: 'unknown',
      ingredients: [{ foodId: 'chickpeas_raw', gramsRaw: 200, massG: 200, massBasis: 'edible' }, { foodId: 'ghee', gramsRaw: 20, massG: 20, massBasis: 'edible' }],
    });
    const quarter = await logMeal({ components: [{ name: 'dal', recipeId: '01JRC000000000000000000001', batchFraction: 0.25 }] });
    const batchKcal = 3.78 * 200 + 8.76 * 20;
    expect(quarter.totals.energyKcal.value).toBeCloseTo(batchKcal / 4, 0);
    const serving = (quarter.components[0] as MealComponent & { recipeServing?: RecipeServingSnapshot }).recipeServing!;
    expect(serving).toMatchObject({ fractionOfBatch: 0.25, finalEdibleMassG: null, massBasis: 'unknown' });
    const one = await logMeal({ components: [{ name: 'dal', recipeId: '01JRC000000000000000000001', portion: { unit: 'serving', count: 1 } }] });
    expect(one.totals.energyKcal.value).toBeCloseTo(quarter.totals.energyKcal.value, 6);
    // "same as yesterday" logs the same share of the batch (never a fabricated cooked-gram density)
    const again = await logMeal({ components: relogComponents(quarter) });
    expect(again.totals.energyKcal.value).toBeCloseTo(quarter.totals.energyKcal.value, 6);
    const katori = await dispatch('log.meal', { method: 'typed', date: DATE, components: [{ name: 'dal', recipeId: '01JRC000000000000000000001', portion: { unit: 'katori', count: 1 } }] });
    expect(err(katori)?.code).toBe('invalid_input');
    const r = await dispatch('log.meal', { method: 'typed', date: DATE, components: [{ name: 'dal', recipeId: '01JRC000000000000000000001', grams: 250 }] });
    expect(err(r)?.code).toBe('invalid_input');
    expect(err(r)?.message).toMatch(/cooked weight/);
  });

  it('a legacy recipe keeps its arithmetic (dish weight = Σ ingredient grams); a v2 save needs the mass basis', async () => {
    await seedRecipe('01JRC000000000000000000002', { title: 'Old dal chawal', servings: 2, ingredients: [{ foodId: 'lentils_cooked', gramsRaw: 300 }, { foodId: 'rice_white_cooked', gramsRaw: 300 }] });
    const e = await logMeal({ components: [{ name: 'dal chawal', recipeId: '01JRC000000000000000000002', grams: 300 }] });
    expect(e.totals.energyKcal.value).toBeCloseTo((116 * 3 + 130 * 3) / 2, 0);
    const bad = await dispatch('food.saveRecipe', { recipe: { title: 'New dal', ingredients: [{ foodId: 'lentils_cooked', grams: 300, state: 'cooked' }] } });
    expect(err(bad)?.message).toMatch(/as purchased|edible/);
    const ok = out<{ id: string }>(await dispatch('food.saveRecipe', { recipe: { title: 'New dal', servings: 2, finalEdibleMassG: 600, yieldSource: 'measured', ingredients: [{ foodId: 'chickpeas_raw', grams: 200, massBasis: 'edible', state: 'raw' }] } }));
    await settleCommits();
    const doc = getDocumentStore().peek<{ schemaVersion: number; composition: { finalEdibleMassG: number; per100g: Record<string, number> }; perServing: { energyKcal: { value: number } } }>('recipes', ok.id)!;
    expect(doc.schemaVersion).toBe(2);
    expect(doc.composition.finalEdibleMassG).toBe(600);
    expect(doc.perServing.energyKcal.value).toBeCloseTo((378 * 2) / 2, 0);
    const cooked = await logMeal({ components: [{ name: 'dal', recipeId: ok.id, grams: 300 }] });
    expect(cooked.totals.energyKcal.value).toBeCloseTo(378, 0); // half the batch by cooked weight
  });
});

/* ------------------------------------------------------------------------------------------- re-audit W0/W1 (F05) */

const energySourceOf = (m: Meal, i = 0) => (m.components[i] as MealComponentOut).energySource;
const servingOf = (m: Meal, i = 0) => (m.components[i] as MealComponentOut).recipeServing!;

describe('a measured ME applies only to the form it was measured on (A1-030)', () => {
  it('confirmed whole natural almonds keep their supported reference alternative', async () => {
    const e = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', grams: 42 }] });
    expect(e.totals.energyKcal.value).toBeCloseTo(4.42 * 42, 1);
    expect(energySourceOf(e)).toMatchObject({ method: 'measuredME', form: 'wholeNatural', status: 'measuredForm', sourceEnergyKcal: 579, sourceRef: 'GEBAUER-2016' });
    const whole = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', portion: { unit: 'cup', count: 1 } }] }); // "1 cup, whole"
    expect(whole.totals.energyKcal.value).toBeCloseTo(4.42 * 143, 1);
  });

  it('ground, slivered or paste portions and grinding preparations keep the source energy as a labelled convention', async () => {
    const ground = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', portion: { unit: 'ground', count: 1 } }] });
    expect(ground.components[0]!.grams.value).toBe(95);
    expect(ground.totals.energyKcal.value).toBeCloseTo(5.79 * 95, 0);
    expect(energySourceOf(ground)).toMatchObject({ method: 'sourceConvention', form: 'ground', status: 'formIncompatible', matrixUncertain: true, sourceEnergyKcal: 579 });
    const slivered = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', portion: { unit: 'slivered', count: 1 } }] });
    expect(slivered.totals.energyKcal.value).toBeCloseTo(5.79 * 108, 0);
    const paste = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', grams: 100, cookingMethod: 'ground to fine paste' }] });
    expect(paste.totals.energyKcal.value).toBeCloseTo(579, 6);
    const roasted = await logMeal({ components: [{ name: 'roasted almonds', foodId: 'almonds_raw', grams: 100 }] });
    expect(roasted.totals.energyKcal.value).toBeCloseTo(579, 6); // the natural-form value never moves to a roasted form
  });

  it('an explicitly matching butter source keeps its own value; unknown processing gets no precise whole-almond value', async () => {
    const butter = await logMeal({ components: [{ name: 'almond butter', foodId: 'almond_butter', grams: 100 }] });
    expect(butter.totals.energyKcal.value).toBeCloseTo(653, 6);
    expect(energySourceOf(butter)).toMatchObject({ method: 'measuredME', form: 'butter' });
    const soaked = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', grams: 100, cookingMethod: 'soaked overnight' }] });
    expect(soaked.totals.energyKcal.value).toBeCloseTo(579, 6);
    expect(energySourceOf(soaked)).toMatchObject({ status: 'processingUnknown', matrixUncertain: true });
    // a whole ingredient ground into a paste in a recipe: no whole-form value, no butter value either (a raw paste is not the tested butter)
    const r = recipeComposition({ schemaVersion: 2, yieldSource: 'measured', finalEdibleMassG: 100, ingredients: [{ foodId: 'almonds_raw', massG: 100, massBasis: 'edible', state: 'raw', preparation: 'finely ground into almond butter' }] }, foodTable());
    expect(r.batch.energyKcal).toBeCloseTo(579, 6);
    expect(r.energySources).toEqual([{ ingredient: 1, foodId: 'almonds_raw', method: 'sourceConvention', form: 'ground', status: 'formIncompatible', matrixUncertain: true }]);
    const plain = recipeComposition({ schemaVersion: 2, yieldSource: 'measured', finalEdibleMassG: 100, ingredients: [{ foodId: 'almonds_raw', massG: 100, massBasis: 'edible', state: 'raw' }] }, foodTable());
    expect(plain.batch.energyKcal).toBeCloseTo(442, 6);
  });

  it('a measured ME without species and form metadata is not evidence enough: the source energy stays', async () => {
    await seedCustomFoods([customFood('user-nut-bar', { energyKcal: 500, proteinG: 10, fatG: 30, carbG: 45, fibreG: 5 }, { carbBasis: 'totalByDifference', measuredME: { kcalPer100g: 300, sourceRef: 'blog', represents: 'sourceME' } })]);
    const e = await logMeal({ components: [{ name: 'nut bar', foodId: 'user-nut-bar', grams: 100 }] });
    expect(e.totals.energyKcal.value).toBeCloseTo(500, 6);
    expect(energySourceOf(e)).toMatchObject({ method: 'sourceConvention', status: 'alternativeUnsupported' });
  });

  it('the chosen method and form survive recipe servings and relogging without a second discount', async () => {
    const ground = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', portion: { unit: 'ground', count: 1 } }] });
    const byId = await logMeal({ components: relogComponents(ground) });
    expect(byId.totals.energyKcal.value).toBeCloseTo(ground.totals.energyKcal.value, 6);
    expect(energySourceOf(byId)).toMatchObject({ status: 'formIncompatible', form: 'ground' });
    const clone = toMealComponents(estimateMeal(resolveComponents(relogSnapshotComponents(ground), 'typed', foodTable())));
    expect(clone[0]!.nutrients.energyKcal.value).toBeCloseTo(ground.totals.energyKcal.value, 6);
    expect(clone[0]!.energySource).toEqual(energySourceOf(ground));
    const whole = await logMeal({ components: [{ name: 'almonds', foodId: 'almonds_raw', grams: 42 }] });
    const wholeClone = toMealComponents(estimateMeal(resolveComponents(relogSnapshotComponents(whole), 'typed', foodTable())));
    expect(wholeClone[0]!.nutrients.energyKcal.value).toBeCloseTo(4.42 * 42, 1); // 442 once, never 442 × 442/579
    await seedRecipe('01JRC000000000000000000A30', {
      title: 'Almond paste', servings: 2, schemaVersion: 2, yieldSource: 'measured', finalEdibleMassG: 100,
      ingredients: [{ foodId: 'almonds_raw', gramsRaw: 100, massG: 100, massBasis: 'edible', state: 'raw', preparation: 'ground to a paste' }],
    });
    const half = await logMeal({ components: [{ name: 'paste', recipeId: '01JRC000000000000000000A30', batchFraction: 0.5 }] });
    expect(half.totals.energyKcal.value).toBeCloseTo(579 / 2, 6);
    expect(servingOf(half).energySources).toEqual([expect.objectContaining({ foodId: 'almonds_raw', status: 'formIncompatible' })]);
    const again = await logMeal({ components: relogComponents(half) });
    expect(again.totals.energyKcal.value).toBeCloseTo(579 / 2, 6);
  });
});

describe('polyol identities and their substrate route (A1-031)', () => {
  const polyolFoods = () =>
    seedCustomFoods([
      customFood('user-maltitol-choc', { energyKcal: 240, proteinG: 0, fatG: 0, carbG: 100, fibreG: 0 }, { carbBasis: 'totalByDifference', polyolsG: { maltitol: 100 } }),
      customFood('user-erythritol', { energyKcal: 20, proteinG: 0, fatG: 0, carbG: 100, fibreG: 0 }, { carbBasis: 'totalByDifference', polyolsG: { erythritol: 100 } }),
    ]);

  it('maltitol, erythritol and an identity-unknown total keep distinct identities and the reported ME through log and history', async () => {
    await polyolFoods();
    const e = await logMeal({ components: [{ name: 'chocolate', foodId: 'user-maltitol-choc', grams: 50 }, { name: 'sweetener', foodId: 'user-erythritol', grams: 10 }, { name: 'bar', grams: 40, labelPer100g: { energyKcal: 240, proteinG: 0, fatG: 0, carbG: 95, fibreG: 0, polyolsG: 60 }, carbBasis: 'totalByDifference' }] });
    expect(e.totals.energyKcal.value).toBeCloseTo(120 + 2 + 96, 6); // reported ME kept, no polyol factor
    expect(e.totals.carbG.value).toBeCloseTo(0 + 0 + 0.4 * 35, 6); // non-polyol available carbohydrate only
    expect(e.components[0]!.snapshot!.per100g).toMatchObject({ polyolsG: 100, 'polyolG:maltitol': 100 });
    expect(e.exposures!.filter(isExposureBreakdown).map((x) => [x.form, x.value])).toEqual([['identity:erythritol', 10], ['identity:maltitol', 50], ['identity:unidentified', 24]]);
    expect(e.energy!.substrateRoute).toEqual({ status: 'unmodelled', unmodelledPolyolsG: { maltitol: 50, erythritol: 10, unidentified: 24 } });
    const intake = readMealIntake(e);
    expect(intake.energyKcal).toBeCloseTo(218, 6);
    expect(intake.polyolsG).toEqual({ maltitol: 50, erythritol: 10, unidentified: 24 });
  });

  it('a polyol-rich source cannot certify a zero glucose-forming route or a keto pass because its non-polyol carbohydrate is 0', async () => {
    await polyolFoods();
    const e = await logMeal({ components: [{ name: 'chocolate', foodId: 'user-maltitol-choc', grams: 50 }] });
    expect(e.totals.carbG.value).toBe(0);
    expect(e.energy!.status).toBe('consistent'); // energy reconciliation is fine…
    expect(substrateOutputStatus(e.energy!)).toBe('unknown'); // …but it is not a certified substrate readout
    // an explicit conditional scenario keeps the original amounts and claims no probability
    expect(substrateOutputStatus(e.energy!, true)).toBe('scenario');
    expect(POLYOL_ROUTE_ASSUMPTIONS).toEqual({ unmodelled: 'polyolRouteUnmodelled', zeroRouteScenario: 'polyolZeroGlucoseRouteScenario' });
    expect(e.components[0]!.snapshot!.per100g.carbG).toBe(100);
    // a low-carbohydrate day never admits it on its non-polyol carbohydrate alone
    await seedPlan({ kcal: 1800, proteinG: 120, carbG: 30, label: 'keto' });
    const c = out<Array<{ id: string }>>(await dispatch('food.candidates', { date: DATE }));
    expect(c.map((x) => x.id)).not.toContain('user-maltitol-choc');
  });

  it('a saved recipe keeps the polyol identities of its ingredients through its serving', async () => {
    await polyolFoods();
    const saved = out<{ id: string }>(await dispatch('food.saveRecipe', { recipe: { title: 'Sugar-free kheer', servings: 2, yieldSource: 'measured', finalEdibleMassG: 300, ingredients: [{ foodId: 'milk_whole', grams: 250, massBasis: 'edible', state: 'raw' }, { foodId: 'user-erythritol', grams: 20, massBasis: 'edible' }] } }));
    await settleCommits();
    const e = await logMeal({ components: [{ name: 'kheer', recipeId: saved.id, grams: 150 }] });
    expect(e.components[0]!.snapshot!.per100g['polyolG:erythritol']).toBeCloseTo((20 / 300) * 100, 6);
    expect(readMealIntake(e).polyolsG).toEqual({ erythritol: expect.closeTo(10, 6) });
  });
});

describe('recipe removals: missingness per nutrient (A1-042)', () => {
  const ing = [{ foodId: 'rice_white_cooked', massG: 100, massBasis: 'edible' }, { foodId: 'ghee', massG: 20, massBasis: 'edible' }];
  const comp = (body: Record<string, unknown>) => recipeComposition(body as never, foodTable());
  const recipe = (discards: unknown[]) => comp({ schemaVersion: 2, yieldSource: 'measured', finalEdibleMassG: 115, ingredients: ing, discards });

  it('a 5 g oil discard with only fatG: 5 does not keep complete unchanged energy or saturated fat', () => {
    const kept = recipe([]);
    expect(kept.batch.energyKcal).toBeCloseTo(305.2, 6);
    const r = recipe([{ kind: 'oil', massG: 5, nutrients: { fatG: 5 } }]);
    expect(r.batch.fatG).toBeCloseTo(kept.batch.fatG! - 5, 9);
    expect(r.batch.energyKcal).toBeNull();
    expect(r.batch.satFatG).toBeNull();
    expect(r.batchUpper).toMatchObject({ energyKcal: expect.closeTo(305.2, 6), satFatG: expect.closeTo(kept.batch.satFatG!, 6) });
    expect(r.batchKnown.energyKcal).toBe(0); // the pre-discard sum is never offered as a lower bound
    expect(r.batch.proteinG).toBeCloseTo(kept.batch.proteinG!, 9); // oil structurally carries no protein
    expect(r.per100!.unknown).toEqual(expect.arrayContaining(['energyKcal', 'satFatG']));
    expect(r.per100!.upper!.energyKcal).toBeCloseTo((100 * 305.2) / 115, 6);
  });

  it('an explicit energy removal resolves energy alone; explicit zeros, structural zeros and a partial liquid discard differ', () => {
    const kept = recipe([]);
    const withEnergy = recipe([{ kind: 'oil', massG: 5, nutrients: { fatG: 5, energyKcal: 44 } }]);
    expect(withEnergy.batch.energyKcal).toBeCloseTo(305.2 - 44, 9);
    expect(withEnergy.batch.satFatG).toBeNull();
    const zero = recipe([{ kind: 'oil', massG: 5, nutrients: { fatG: 5, energyKcal: 44, satFatG: 0 } }]);
    expect(zero.batch.satFatG).toBeCloseTo(kept.batch.satFatG!, 9); // a stated 0 is a known zero removal
    expect(zero.batch.sodiumMg).toBeCloseTo(kept.batch.sodiumMg!, 9); // oil carries no sodium: structural zero
    const liquid = recipe([{ kind: 'liquid', massG: 50, nutrients: { sodiumMg: 1 } }]);
    expect(liquid.batch.sodiumMg).toBeCloseTo(kept.batch.sodiumMg! - 1, 9);
    expect(liquid.batch.proteinG).toBeNull(); // drained liquid can carry anything it does not state
    expect(liquid.batch.alcoholG).toBe(0); // …but never removes what the batch does not hold
  });

  it('save → log one batch → the meal exposure keeps the per-nutrient unknown with its upper bound', async () => {
    const saved = out<{ id: string }>(await dispatch('food.saveRecipe', { recipe: { title: 'Ghee rice', servings: 1, yieldSource: 'measured', finalEdibleMassG: 115, ingredients: [{ foodId: 'rice_white_cooked', grams: 100, massBasis: 'edible', state: 'cooked' }, { foodId: 'ghee', grams: 20, massBasis: 'edible' }], discards: [{ kind: 'oil', massG: 5, nutrients: { fatG: 5 } }] } }));
    await settleCommits();
    const e = await logMeal({ components: [{ name: 'ghee rice', recipeId: saved.id, batchFraction: 1 }] });
    const x = (id: string) => e.exposures!.find((q) => q.id === id)!;
    expect(x('energy')).toMatchObject({ value: null, upperBound: expect.closeTo(305.2, 6), coverage: 'unknown' });
    expect(x('energy')).not.toHaveProperty('lowerBound');
    expect(x('satFat')).toMatchObject({ value: null, upperBound: expect.closeTo(12.46, 1) });
    expect(x('fat').value).toBeCloseTo(20.176 - 5, 1); // meal values are banded to 0.1
    expect(x('protein').value).toBeCloseTo(2.69 + 0.056, 1);
    expect(e.components[0]!.snapshot!.per100g.energyKcal).toBeNull();
    expect(servingOf(e).batchUpper!.energyKcal).toBeCloseTo(305.2, 6);
    // relogging the frozen serving keeps energy unknown (never 0 kcal)
    const clone = estimateMeal(resolveComponents(relogSnapshotComponents(e), 'typed', foodTable()));
    expect(clone.totals.unknown).toContain('energyKcal');
  });
});

describe('ingredient state is the state of the measured grams (A1-043)', () => {
  const comp = (body: Record<string, unknown>) => recipeComposition(body as never, foodTable());

  it('raw-source/cooked-grams mismatch needs review in saveRecipe and in a stored recipe', async () => {
    const r = comp({ schemaVersion: 2, yieldSource: 'measured', finalEdibleMassG: 100, ingredients: [{ foodId: 'rice_white_raw', massG: 100, massBasis: 'edible', state: 'cooked', preparation: 'boiled' }] });
    expect(r.issues.join(' ')).toMatch(/cooked but .* raw record/);
    expect(r.per100).toBeUndefined();
    const bad = await dispatch('food.saveRecipe', { recipe: { title: 'Rice', finalEdibleMassG: 100, yieldSource: 'measured', ingredients: [{ foodId: 'rice_white_raw', grams: 100, massBasis: 'edible', state: 'cooked', preparation: 'boiled' }] } });
    expect(err(bad)?.code).toBe('invalid_input');
    expect(err(bad)?.message).toMatch(/raw record/);
    const raw = comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: [{ foodId: 'lentils_cooked', massG: 100, massBasis: 'edible', state: 'raw' }] });
    expect(raw.issues.join(' ')).toMatch(/raw but .* cooked record/);
    // a stored (imported) recipe with the contradiction is never logged as if it were consistent
    await seedRecipe('01JRC000000000000000000A43', { title: 'Old rice', servings: 1, schemaVersion: 2, yieldSource: 'measured', finalEdibleMassG: 100, ingredients: [{ foodId: 'rice_white_raw', gramsRaw: 100, massG: 100, massBasis: 'edible', state: 'cooked' }] });
    const logged = await dispatch('log.meal', { method: 'typed', date: DATE, components: [{ name: 'rice', recipeId: '01JRC000000000000000000A43', grams: 100 }] });
    expect(err(logged)?.message).toMatch(/needs review/);
  });

  it('an explicit retention factor applies once to a raw source; a contradictory state never restores factor 1', () => {
    const spinach = (state?: string) => comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: [{ foodId: 'spinach_raw', massG: 100, massBasis: 'edible', ...(state ? { state } : {}), preparation: 'boiled', retention: { vitCMg: 0.5 } }] });
    expect(spinach('raw').batch.vitCMg).toBeCloseTo(14.05, 9);
    expect(spinach().batch.vitCMg).toBeCloseTo(14.05, 9);
    expect(spinach().assumptions).toContain('stateUnstated:1');
    const contradictory = spinach('cooked');
    expect(contradictory.batch.vitCMg).toBeNull(); // never 28.1 with no issue
    expect(contradictory.issues.length).toBeGreaterThan(0);
  });

  it('a matching cooked source stays free of double retention; a sourced yield converts cooked grams once', async () => {
    const cooked = comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: [{ foodId: 'lentils_cooked', massG: 300, massBasis: 'edible', state: 'cooked', retention: { folateDfeUg: 0.5 } }] });
    expect(cooked.batch.folateDfeUg).toBeCloseTo(181 * 3, 9);
    expect(cooked.issues).toEqual([]);
    await seedCustomFoods([customFood('user-raw-millet', { energyKcal: 378, proteinG: 11, fatG: 4, carbG: 73, fibreG: 8.5 }, { carbBasis: 'totalByDifference', state: 'raw', yieldRawToCooked: 2.5 })]);
    const millet = recipeComposition({ schemaVersion: 2, yieldSource: 'unknown', ingredients: [{ foodId: 'user-raw-millet', massG: 250, massBasis: 'edible', state: 'cooked', preparation: 'boiled' }] }, foodTable());
    expect(millet.batch.energyKcal).toBeCloseTo(378, 9); // 250 cooked g = 100 raw g by the record's yield
    expect(millet.assumptions).toEqual(expect.arrayContaining(['rawEquivalentFromYield:1', 'retentionIdentity:1']));
  });

  it('ordinary fractions stay loggable when retention is unknown; the identity assumption travels with the serving', async () => {
    await seedRecipe('01JRC000000000000000000A44', { title: 'Palak', servings: 2, schemaVersion: 2, yieldSource: 'unknown', ingredients: [{ foodId: 'spinach_raw', gramsRaw: 300, massG: 300, massBasis: 'edible', state: 'raw', preparation: 'boiled' }] });
    const e = await logMeal({ components: [{ name: 'palak', recipeId: '01JRC000000000000000000A44', batchFraction: 0.5 }] });
    expect(e.totals.energyKcal.value).toBeCloseTo(23 * 1.5, 6);
    expect(servingOf(e).assumptions).toContain('retentionIdentity:1');
  });
});

describe('recipe mass balance counts each material once (A1-044)', () => {
  const comp = (body: Record<string, unknown>) => recipeComposition(body as never, foodTable());
  const rice = [{ foodId: 'rice_white_cooked', massG: 100, massBasis: 'edible', state: 'cooked' }];
  const sugar = (massG?: number) => ({ name: '50 g sugar', nutrients: { carbG: 50, netCarbG: 50, energyKcal: 200, sugarsG: 50 }, ...(massG !== undefined ? { massG } : {}) });

  it('100 g rice + 50 g pure dry sugar, no loss: 150 g at 220 kcal/100 g', () => {
    const r = comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: rice, additions: [sugar(50)], waterAddedG: 0, evaporationG: 0 });
    expect(r.massBasis).toBe('massBalance');
    expect(r.finalEdibleMassG).toBeCloseTo(150, 9);
    expect(r.per100!.energyKcal).toBeCloseTo(220, 9);
  });

  it('without the addition\'s own mass the cooked density stays unknown, while a quarter of the batch is still 82.5 kcal', async () => {
    const r = comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: rice, additions: [sugar()], waterAddedG: 0, evaporationG: 0 });
    expect(r.finalEdibleMassG).toBeNull();
    expect(r.massBasis).toBe('unknown');
    expect(r.batch.energyKcal).toBeCloseTo(330, 9);
    await seedRecipe('01JRC000000000000000000A45', { title: 'Sweet rice', servings: 4, schemaVersion: 2, yieldSource: 'unknown', ingredients: [{ ...rice[0], gramsRaw: 100 }], additions: [sugar()], waterAddedG: 0, evaporationG: 0 });
    const q = await logMeal({ components: [{ name: 'sweet rice', recipeId: '01JRC000000000000000000A45', batchFraction: 0.25 }] });
    expect(q.totals.energyKcal.value).toBeCloseTo(82.5, 6);
    expect(err(await dispatch('log.meal', { method: 'typed', date: DATE, components: [{ name: 'sweet rice', recipeId: '01JRC000000000000000000A45', grams: 100 }] }))?.message).toMatch(/cooked weight/);
  });

  it('a measured final mass still gives a density when intermediate addition and discard masses are unmeasured', () => {
    const r = comp({ schemaVersion: 2, yieldSource: 'measured', finalEdibleMassG: 160, ingredients: rice, additions: [sugar()], discards: [{ kind: 'liquid', nutrients: { sodiumMg: 0 } }] });
    expect(r.massBasis).toBe('measured');
    expect(r.finalEdibleMassG).toBe(160);
  });

  it('water and evaporation change the denominator once and never create or remove nutrient mass', () => {
    const a = comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: rice, additions: [sugar(50)], waterAddedG: 100, evaporationG: 40 });
    expect(a.finalEdibleMassG).toBeCloseTo(100 + 50 + 100 - 40, 9);
    const b = comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: rice, additions: [sugar(50)], waterAddedG: 0, evaporationG: 0 });
    expect(a.batch.energyKcal).toBeCloseTo(b.batch.energyKcal!, 9);
    expect(a.batch.netCarbG).toBeCloseTo(b.batch.netCarbG!, 9);
  });

  it('an addition that is also an ingredient (explicit identity) is refused, not silently adjusted', async () => {
    const r = comp({ schemaVersion: 2, yieldSource: 'unknown', ingredients: rice, additions: [{ name: 'more rice', foodId: 'rice_white_cooked', massG: 20, nutrients: { energyKcal: 26 } }] });
    expect(r.issues.join(' ')).toMatch(/also ingredient 1/);
    const bad = await dispatch('food.saveRecipe', { recipe: { title: 'Rice', ingredients: [{ foodId: 'rice_white_cooked', grams: 100, massBasis: 'edible' }], additions: [{ name: 'more rice', foodId: 'rice_white_cooked', massG: 20, nutrients: { energyKcal: 26 } }] } });
    expect(err(bad)?.code).toBe('invalid_input');
    expect(err(bad)?.message).toMatch(/also ingredient 1/);
  });

  it('a saved recipe with a weighed addition stores the mass-balance density and logs cooked grams from it', async () => {
    const ok = out<{ id: string }>(await dispatch('food.saveRecipe', { recipe: { title: 'Sweet rice', servings: 3, ingredients: [{ foodId: 'rice_white_cooked', grams: 100, massBasis: 'edible', state: 'cooked' }], additions: [sugar(50)], waterAddedG: 0, evaporationG: 0 } }));
    await settleCommits();
    const doc = getDocumentStore().peek<{ composition: { finalEdibleMassG: number; massBasis: string } }>('recipes', ok.id)!;
    expect(doc.composition).toMatchObject({ finalEdibleMassG: 150, massBasis: 'massBalance' });
    const e = await logMeal({ components: [{ name: 'sweet rice', recipeId: ok.id, grams: 50 }] });
    expect(e.totals.energyKcal.value).toBeCloseTo(110, 6);
  });
});
