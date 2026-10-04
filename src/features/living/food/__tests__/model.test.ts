import type { LogEntrySummary, TodayView } from '@/living';
import { aisleOf, buildGroceryList, buyUnit, groceryText, horizonSpan } from '../groceries';
import { trustLedger } from '../ledger';
import type { AcceptedMeal } from '../mealPlanStore';
import { createMockRecipeProvider, exampleFoods, mainDish, noRecipeProvider, type MealSlotTarget } from '../recipes';
import { groupEntries, inWindow, visibleSlots } from '../slots';
import { foodFirstLines, noBenefitItems, supplementCards, supplementName } from '../supplements';

const LUNCH: MealSlotTarget = { slot: 'lunch', name: 'lunch', clockH: 12.5, energyKcal: 685, proteinG: 56, carbG: 52, fatG: 26 };
const SNACK: MealSlotTarget = { slot: 'snack', name: 'snack', clockH: 16.5, energyKcal: 352, proteinG: 29, carbG: 27, fatG: 13 };
const DINNER: MealSlotTarget = { slot: 'dinner', name: 'dinner', clockH: 19.5, energyKcal: 814, proteinG: 66, carbG: 62, fatG: 31 };

describe('recipes', () => {
  it('the mock fits fixed portions to each slot and states the closest fit plainly', async () => {
    const p = createMockRecipeProvider();
    const progress: string[] = [];
    const r = await p.planDay({ date: '2026-10-01', slots: [LUNCH, SNACK, DINNER], onProgress: (s, st) => progress.push(`${s}:${st}`) });
    const lunch = r.lunch!;
    const dinner = r.dinner!;
    expect('error' in lunch).toBe(false);
    if ('error' in lunch || 'error' in dinner) return;
    expect(lunch.perServing.energyKcal.value).toBe(685);
    expect(lunch.fit).toEqual({ kind: 'fits', text: 'fits targets' });
    expect(dinner.fit).toEqual({ kind: 'closest', text: 'closest: protein short by 18 g' });
    expect(mainDish(lunch.dish)).not.toBe(mainDish(dinner.dish));
    expect(progress).toEqual(['lunch:working', 'lunch:done', 'snack:working', 'snack:done', 'dinner:working', 'dinner:done']);
  });

  it('a swap never repeats an excluded dish; a pantry without protein cannot be planned', async () => {
    const p = createMockRecipeProvider();
    const s = await p.swap({ date: '2026-10-01', slot: 'lunch', target: LUNCH, exclude: ['paneer bhurji', 'chana masala'] });
    expect('error' in s ? null : mainDish(s.dish)).toBe('moong dal chilla with curd');
    const k = await p.planDay({ date: '2026-10-01', slots: [LUNCH], pantry: ['rice', 'onion'] });
    expect(k.lunch).toEqual({ error: 'Your kitchen doesn’t cover today’s protein. Add 2 items from the shop?' });
  });

  it('without a provider every slot keeps its plain targets', async () => {
    expect(noRecipeProvider.available).toBe(false);
    expect(await noRecipeProvider.planDay({ date: '2026-10-01', slots: [LUNCH] })).toEqual({ lunch: { error: 'Connect an AI provider to get recipes.' } });
  });

  it('picks example foods by macro balance', () => {
    expect(exampleFoods(SNACK)).toBe('roasted chana and a katori of curd');
    expect(exampleFoods(LUNCH)).toBe('paneer bhurji, a roti and salad');
    expect(exampleFoods({ energyKcal: 700, proteinG: 25, carbG: 100, fatG: 20 })).toBe('dal, rice and curd');
  });

  it('never names a food the diet rules out (no eggs for a vegetarian; no dairy or eggs for a vegan)', () => {
    const FATTY = { energyKcal: 784, proteinG: 59, carbG: 37, fatG: 43 };
    expect(exampleFoods(FATTY)).toBe('eggs or paneer with vegetables');
    expect(exampleFoods(FATTY, 'eggetarian')).toMatch(/eggs/);
    expect(exampleFoods(FATTY, 'vegetarian')).not.toMatch(/egg/);
    for (const t of [FATTY, SNACK, LUNCH, { energyKcal: 700, proteinG: 25, carbG: 100, fatG: 20 }]) expect(exampleFoods(t, 'vegan')).not.toMatch(/egg|paneer|curd|milk|ghee/);
    const whey = supplementCards({ prescribed: [], dietKind: 'vegetarian', safetyFlags: [] }).cards.find((c) => c.record.id === 'whey_protein');
    expect(whey?.foodFirst).not.toMatch(/egg/);
    expect(supplementCards({ prescribed: [], dietKind: 'eggetarian', safetyFlags: [] }).cards.find((c) => c.record.id === 'whey_protein')?.foodFirst).toMatch(/eggs/);
  });
});

describe('groceries', () => {
  const meal = (date: string, slot: string, ingredients: AcceptedMeal['recipe']['ingredients']): AcceptedMeal => ({
    planId: 'p',
    date,
    slot,
    recipe: { id: `${date}-${slot}`, slot, dish: 'x', cuisine: 'x', activeMin: 10, servings: 1, equipment: [], portionLine: '', fit: { kind: 'fits', text: '' }, perServing: { energyKcal: { value: 0, sd: 0 }, proteinG: { value: 0, sd: 0 }, carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 } }, ingredients, steps: [], why: '' },
  });

  it('aggregates accepted recipes over the horizon by aisle, in buy units, with pantry marks', () => {
    const meals = [
      meal('2026-10-01', 'lunch', [{ name: 'paneer', grams: 130 }, { name: 'tomato', grams: 80 }, { name: 'jeera', grams: 2 }]),
      meal('2026-10-02', 'lunch', [{ name: 'paneer', grams: 130 }, { name: 'atta', grams: 60 }]),
      meal('2026-10-09', 'lunch', [{ name: 'tofu', grams: 200 }]),
      { ...meal('2026-10-01', 'dinner', [{ name: 'rice', grams: 75 }]), planId: 'other' },
    ];
    const span = horizonSpan('2026-10-01', '3days');
    expect(span).toEqual({ from: '2026-10-01', to: '2026-10-03' });
    const list = buildGroceryList(meals, { planId: 'p', ...span, pantry: ['atta'], bought: ['tomato'] });
    expect(list.count).toBe(4);
    expect(list.groups.map((g) => g.aisle)).toEqual(['vegetables', 'dairy', 'staples', 'spices']);
    const paneer = list.groups.find((g) => g.aisle === 'dairy')!.items[0]!;
    expect(paneer).toMatchObject({ name: 'paneer', grams: 260, buy: 'paneer 200 g pack × 2', dates: ['2026-10-01', '2026-10-02'] });
    expect(list.groups.find((g) => g.aisle === 'staples')!.items[0]).toMatchObject({ buy: 'atta 1 kg', have: true });
    expect(list.groups.find((g) => g.aisle === 'vegetables')!.items[0]).toMatchObject({ buy: 'tomato 100 g', bought: true });
    const text = groceryText(list, { header: 'Groceries', aisleName: (a) => a, haveWord: 'already have' });
    expect(text).toContain('- paneer 200 g pack × 2');
    expect(text).toContain('- atta 1 kg (already have)');
  });

  it('has a small static aisle map and buy units', () => {
    expect(aisleOf('curd')).toBe('dairy');
    expect(aisleOf('moong dal')).toBe('protein');
    expect(aisleOf('garam masala')).toBe('spices');
    expect(aisleOf('cucumber')).toBe('vegetables');
    expect(buyUnit('eggs', 300)).toBe('eggs × 6');
    expect(buyUnit('eggs', 650)).toBe('eggs × 18');
    expect(buyUnit('curd', 450)).toBe('curd 400 g tub × 2');
    expect(buyUnit('rice', 1500)).toBe('rice 1 kg × 2');
  });
});

describe('slots and ledger', () => {
  const entry = (id: string, clockH: number, label: string, o: Partial<LogEntrySummary> = {}): LogEntrySummary => ({ id, kind: 'meal', clockH, label, source: 'user', aiEstimated: false, energyKcal: { value: 500, sd: 50 }, ...o });

  it('groups meal entries by slot and keeps the rest as other food', () => {
    const g = groupEntries([entry('a', 12.5, 'lunch as planned'), entry('b', 13, 'tea'), { ...entry('c', 0, 'steps'), kind: 'steps' }], [LUNCH, SNACK]);
    expect(g.bySlot.get('lunch')!.map((e) => e.id)).toEqual(['a']);
    expect(g.other.map((e) => e.id)).toEqual(['b']);
  });

  it('hides slots outside the window on a fast day', () => {
    expect(inWindow(23, { startH: 20, endH: 2 })).toBe(true);
    expect(inWindow(12, { startH: 20, endH: 2 })).toBe(false);
    const rx = { fast: { lastIntakeAt: '', firstIntakeAt: '', hours: 20 }, window: { startH: 15, endH: 20 } } as unknown as Parameters<typeof visibleSlots>[0];
    expect(visibleSlots(rx, [LUNCH, SNACK, DINNER]).map((s) => s.slot)).toEqual(['snack', 'dinner']);
  });

  it('counts the week’s meals by how they were logged', () => {
    const view = (entries: LogEntrySummary[]) => ({ logged: { entries } }) as unknown as TodayView;
    const l = trustLedger([
      view([entry('a', 12.5, 'lunch as planned'), entry('b', 16.5, 'dal · 1 × katori')]),
      view([entry('c', 12.5, 'photo', { source: 'ai', aiEstimated: true }), entry('d', 19.5, 'photo', { source: 'ai', aiEstimated: true }), entry('e', 20, 'photo', { source: 'ai', aiEstimated: true })]),
      null,
    ]);
    expect(l).toMatchObject({ asPlanned: 1, typed: 1, coach: 3, total: 5, mostlyCoach: true });
  });
});

describe('supplements', () => {
  it('names prescribed supplements plainly', () => {
    expect(supplementName('creatine')).toBe('creatine');
    expect(supplementName('unknown_thing')).toBe('unknown thing');
  });

  it('offers cards for the goals, never contraindicated ones, never what is prescribed', () => {
    const r = supplementCards({ prescribed: ['creatine'], dietKind: 'vegan', safetyFlags: ['soy_allergy'] });
    const ids = r.cards.map((c) => c.record.id);
    expect(ids).toContain('psyllium');
    expect(ids).toContain('vitamin_b12');
    expect(ids).not.toContain('creatine_monohydrate');
    expect(ids).not.toContain('whey_protein');
    expect(ids).not.toContain('plant_protein');
    expect(r.hiddenForSafety).toBe(1);
    expect(r.cards.find((c) => c.record.id === 'psyllium')!.grade).toBe('A');
  });

  it('food first: flags and food suggestions only; the no-benefit list has plain reasons', () => {
    expect(foodFirstLines('omnivore').flags).toEqual([]);
    expect(foodFirstLines(null).flags[0]).toMatch(/vitamin B12/);
    const nb = noBenefitItems();
    expect(nb).toHaveLength(12);
    expect(nb.every((i) => !/UNVERIFIED|MPS|FFM/.test(i.reason))).toBe(true);
  });
});
