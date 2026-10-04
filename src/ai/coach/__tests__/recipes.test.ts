// @vitest-environment node
import { createAiRecipeProvider, householdUnit, parseCandidates, portionText, type DispatchFn, type MealSlotTarget, type RecipeResult } from '../recipes';
// eslint-disable-next-line no-restricted-imports -- compile-time check that the structural copy matches the app contract
import type { RecipeProvider as AppRecipeProvider } from '@/features/living/food/recipes';
import { modelWith, textReply } from './helpers';

const isRecipeError = (r: RecipeResult | undefined): r is { error: string } => !!r && 'error' in r;
const compat = (p: ReturnType<typeof createAiRecipeProvider>): AppRecipeProvider => p;

const slots: MealSlotTarget[] = [{ slot: 'lunch', name: 'Lunch', clockH: 13, energyKcal: 600, proteinG: 40, carbG: 70, fatG: 18 }];
const CANDS = [
  { id: 'paneer', name: 'Paneer', tags: [], per100: { energyKcal: 265, proteinG: 18, carbG: 3, fatG: 20 }, portions: [] },
  { id: 'roti', name: 'Roti', tags: [], per100: { energyKcal: 300, proteinG: 10, carbG: 55, fatG: 4 }, portions: [{ label: 'roti (38 g)', g: 38 }] },
];
const meal = (ings: Array<{ foodId: string; grams: number }>) => ({ meals: [{ slot: 'lunch', dish: 'Paneer, rotis', cuisine: 'north Indian', ingredients: ings, steps: ['Cook.'], activeMin: 15, equipment: ['tawa'] }] });

function mockDispatch(planResults: unknown[]) {
  const calls: Array<{ id: string; input: unknown }> = [];
  const fn: DispatchFn = async (id, input) => {
    calls.push({ id, input });
    if (id === 'food.candidates') return { ok: true, output: CANDS };
    if (id === 'food.planDay') {
      const r = planResults.shift();
      if (r === undefined) throw new Error('unexpected planDay');
      return r as never;
    }
    return { ok: false, error: { message: 'nope' } };
  };
  return { fn, calls };
}

// food.planDay's real shapes (src/commands/food): off target → invalid_input with repair hints; fits / closest → the fit
const fitOk = { ok: true, output: { status: 'fits', date: '2026-10-02', meals: [{ slot: 'lunch', items: [{ foodId: 'paneer', grams: 120 }, { foodId: 'roti', grams: 114 }] }], deviations: [{ nutrient: 'energyKcal', target: 600, actual: 603, ok: true }], repairHints: [], saved: true } };
const fitOff = { ok: false, error: { code: 'invalid_input', message: 'Off target after fitting portions (lunch: Paneer 150 g, Roti 100 g). protein short by 12 g: add paneer.' } };
const closest = { ok: true, output: { status: 'closest', date: '2026-10-02', meals: [{ slot: 'lunch', items: [{ foodId: 'paneer', grams: 150 }, { foodId: 'roti', grams: 100 }] }], deviations: [{ nutrient: 'proteinG', target: 40, actual: 28, ok: false }, { nutrient: 'energyKcal', target: 600, actual: 510, ok: false }], repairHints: ['add paneer'], saved: true } };

describe('createAiRecipeProvider', () => {
  it('retries with the deviation fed back, then returns a fitting recipe with household units', async () => {
    const { model, ff } = modelWith([textReply(meal([{ foodId: 'paneer', grams: 60 }, { foodId: 'roti', grams: 76 }])), textReply(meal([{ foodId: 'paneer', grams: 120 }, { foodId: 'roti', grams: 114 }]))]);
    const d = mockDispatch([fitOff, fitOk]);
    const res = await createAiRecipeProvider({ model, dispatch: d.fn }).planDay({ date: '2026-10-02', slots });
    const r = res.lunch!;
    expect(isRecipeError(r)).toBe(false);
    if (isRecipeError(r)) return;
    expect(r.fit.kind).toBe('fits');
    expect(r.portionLine).toBe('120 g paneer + 3 rotis (38 g each)');
    expect(r.ingredients).toEqual([{ name: 'Paneer', grams: 120 }, { name: 'Roti', household: '3 rotis (38 g each)', grams: 114 }]);
    expect(d.calls.filter((c) => c.id === 'food.planDay')).toHaveLength(2);
    expect(JSON.stringify(ff.requests[1]!.body)).toContain('protein short by 12 g');
    expect(r.perServing.proteinG.value).toBeCloseTo(0.18 * 120 + 0.1 * 114, 0);
  });

  it('rejects ids outside the candidates and asks again', async () => {
    const { model, ff } = modelWith([textReply(meal([{ foodId: 'pork', grams: 100 }])), textReply(meal([{ foodId: 'paneer', grams: 120 }, { foodId: 'beef', grams: 50 }, { foodId: 'roti', grams: 114 }]))]);
    const d = mockDispatch([fitOk]);
    const r = (await createAiRecipeProvider({ model, dispatch: d.fn }).planDay({ date: '2026-10-02', slots })).lunch!;
    if (isRecipeError(r)) throw new Error(r.error);
    expect(r.ingredients.map((i) => i.name)).toEqual(['Paneer', 'Roti']);
    expect(JSON.stringify(ff.requests[1]!.body)).toContain('pork');
    const sent = d.calls.find((c) => c.id === 'food.planDay')!.input as { meals: Array<{ items: Array<{ foodId: string; grams: number }> }> };
    expect(sent.meals[0]!.items.map((i) => i.foodId)).toEqual(['paneer', 'roti']);
    expect(Object.keys(sent.meals[0]!.items[0]!)).not.toContain('energyKcal');
  });

  it('returns the closest after three rounds, labelled closest', async () => {
    const p = meal([{ foodId: 'paneer', grams: 150 }, { foodId: 'roti', grams: 100 }]);
    const { model } = modelWith([textReply(p), textReply(p), textReply(p)]);
    const d = mockDispatch([fitOff, fitOff, closest]);
    const r = (await createAiRecipeProvider({ model, dispatch: d.fn }).planDay({ date: '2026-10-02', slots })).lunch!;
    if (isRecipeError(r)) throw new Error(r.error);
    expect(r.fit.kind).toBe('closest');
    expect(r.fit.text).toContain('protein 12 g under');
    const plans = d.calls.filter((c) => c.id === 'food.planDay').map((c) => c.input as { meals: Array<{ acceptClosest?: boolean }> });
    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.meals[0]!.acceptClosest === true)).toEqual([false, false, true]);
  });

  it('reports a provider failure per slot instead of throwing', async () => {
    const { model } = modelWith([{ status: 401, json: { error: { message: 'bad key' } } }]);
    const res = await createAiRecipeProvider({ model, dispatch: mockDispatch([]).fn }).planDay({ date: '2026-10-02', slots });
    expect(isRecipeError(res.lunch)).toBe(true);
  });
});

it('is assignable to the app RecipeProvider', () => {
  const { model } = modelWith([]);
  expect(compat(createAiRecipeProvider({ model })).available).toBe(true);
});

describe('householdUnit', () => {
  it('uses portions when they divide well, else null (grams are shown)', () => {
    expect(householdUnit(76, [{ label: 'roti (38 g)', g: 38 }])).toBe('2 rotis (38 g each)');
    expect(householdUnit(300, [{ label: 'katori', g: 200 }])).toBe('1½ katoris');
    expect(householdUnit(7, [{ label: 'katori', g: 200 }])).toBeNull();
    expect(householdUnit(50, [{ label: '100 g', g: 100 }])).toBeNull();
  });

  it('combines the count and the unit once (Q4-12)', () => {
    expect(householdUnit(90, [{ label: '1 cube 25 g', g: 25 }])).toBe('3½ cubes (25 g each)');
    expect(householdUnit(25, [{ label: '1 cube 25 g', g: 25 }])).toBe('1 cube (25 g)');
    expect(householdUnit(150, [{ label: '1 katori (155 mL)', g: 150 }])).toBe('1 katori');
    expect(householdUnit(100, [{ label: '1 large egg', g: 50 }])).toBe('2 large eggs');
    expect(householdUnit(236, [{ label: '1 medium', g: 118 }])).toBe('2 medium');
    expect(householdUnit(10, [{ label: '1 tsp', g: 5 }])).toBe('2 tsp');
    expect(householdUnit(412, [{ label: '1 glass (200 mL)', g: 206 }])).toBe('2 glasses');
    expect(householdUnit(50, [{ label: '1 roti worth of flour', g: 25 }])).toBe('2 rotis worth of flour');
  });

  it('portionText names the food once', () => {
    expect(portionText('Paneer (estimated from whole-milk cheese)', 90, '3½ cubes (25 g each)')).toBe('3½ cubes (25 g each) paneer');
    expect(portionText('Lentils, boiled', 150, '1 katori')).toBe('1 katori lentils, boiled');
    expect(portionText('Roti', 76, '2 rotis')).toBe('2 rotis');
    expect(portionText('Oil', 7.4, null)).toBe('7 g oil');
  });
});

describe('parseCandidates', () => {
  it('reads net carbohydrate from food.candidates (per100g.netCarbG)', () => {
    const [c] = parseCandidates([{ id: 'rice_white_cooked', name: 'Rice, white, cooked', per100g: { energyKcal: 130, proteinG: 2.7, netCarbG: 27.8, fatG: 0.3, fibreG: 0.4 } }]);
    expect(c!.per100).toEqual({ energyKcal: 130, proteinG: 2.7, carbG: 27.8, fatG: 0.3, fibreG: 0.4 });
  });
});
