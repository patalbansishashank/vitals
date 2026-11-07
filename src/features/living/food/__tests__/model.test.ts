import type { LogEntrySummary } from '@/living';
import { aisleOf, buildGroceryList, buyUnit, groceryText, horizonSpan } from '../groceries';
import type { AcceptedMeal } from '../mealPlanStore';
import { createMockRecipeProvider, exampleFoods, mainDish, noRecipeProvider, type MealSlotTarget } from '../recipes';
import { groupEntries, inWindow, visibleSlots } from '../slots';
import { UNANSWERED_SAFETY, foodFirstLines, noBenefitItems, suggestionPolicy, supplementCards, supplementName, supplementRecord, takingCaution, withPersonFlags, type FoodSafetyContext } from '../supplements';
import { foodSafetyInput, markerSafety } from '../profile';
import { CONTRAINDICATION_PREDICATES, canonicalPredicate } from '@/lib/safetyPolicy';
import { SEED_SUPPLEMENTS } from '@/content/catalogues';
import type { ScreeningAnswers } from '@/features/onboarding/safetyRules';
import { dayFoodStatus } from '../components/TargetsFace';

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
    // a screened person with no milk allergy and no kidney disease (whey is a card for them)
    const safety = foodSafetyInput({ answers: { conditions: 'no' }, profile: { safetyFlags: [], foodRules: { allergies: [] } as never } });
    const whey = supplementCards({ prescribed: [], dietKind: 'vegetarian', safety }).cards.find((c) => c.record.id === 'whey_protein');
    expect(whey?.foodFirst).not.toMatch(/egg/);
    expect(supplementCards({ prescribed: [], dietKind: 'eggetarian', safety }).cards.find((c) => c.record.id === 'whey_protein')?.foodFirst).toMatch(/eggs/);
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

describe('slots', () => {
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

  it('attaches an entry that names its slot to that slot, never to other food', () => {
    const BREAKFAST: MealSlotTarget = { slot: 'breakfast', name: 'breakfast', clockH: 9, energyKcal: 430, proteinG: 30, carbG: 40, fatG: 15 };
    const g = groupEntries([entry('a', 8.25, 'Breakfast'), entry('b', 13, 'lunch as planned'), entry('c', 15, 'chai and biscuits')], [BREAKFAST, LUNCH]);
    expect(g.bySlot.get('breakfast')!.map((e) => e.id)).toEqual(['a']);
    expect(g.bySlot.get('lunch')!.map((e) => e.id)).toEqual(['b']);
    expect(g.other.map((e) => e.id)).toEqual(['c']);
  });
});

describe('supplements', () => {
  it('names prescribed supplements plainly', () => {
    expect(supplementName('creatine')).toBe('creatine');
    expect(supplementName('unknown_thing')).toBe('unknown thing');
  });

  it('offers cards for the goals, never what is prescribed; the shared policy decides each card (D7-03)', () => {
    // A confirmed soy allergy withholds soy-containing protein; the identified soy-free formulation remains available.
    const r = supplementCards({ prescribed: ['creatine'], dietKind: 'vegan', safetyFlags: ['soy_allergy'], safety: foodSafetyInput({ answers: { conditions: 'no' }, profile: { safetyFlags: [] } }) });
    const ids = r.cards.map((c) => c.record.id);
    expect(ids).toContain('psyllium');
    expect(ids).toContain('vitamin_b12');
    expect(ids).not.toContain('creatine_monohydrate');
    expect(ids).not.toContain('whey_protein');
    expect(ids).not.toContain('plant_protein');
    expect(r.held.find((c) => c.record.id === 'plant_protein')).toMatchObject({ state: 'noSuggest', reason: 'soy allergy' });
    expect(r.cards.find((c) => c.record.id === 'plant_protein_pea_rice')?.status).toBe('allow');
    expect(r.cards.find((c) => c.record.id === 'psyllium')!.grade).toBe('A');
    expect(r.cards.find((c) => c.record.id === 'vitamin_b12')!.status).toBe('allow');
  });

  it('food first: flags and food suggestions only; the no-benefit list has plain reasons', () => {
    expect(foodFirstLines('omnivore').flags).toEqual([]);
    expect(foodFirstLines(null).flags[0]).toMatch(/vitamin B12/);
    const nb = noBenefitItems();
    expect(nb).toHaveLength(12);
    expect(nb.every((i) => !/UNVERIFIED|MPS|FFM/.test(i.reason))).toBe(true);
  });
});

describe('supplement suggestions read the real safety state (D7-03)', () => {
  /** A screening answered with these conditions (and "no" to the rest of the conditions question). */
  const screened = (conditionItems: NonNullable<ScreeningAnswers['conditionItems']>): FoodSafetyContext =>
    foodSafetyInput({ answers: { conditions: conditionItems.length ? 'yes' : 'no', conditionItems, pregnancy: 'no', medications: 'no', metabolic: 'no' }, profile: { safetyFlags: [] } });

  it('one vocabulary: every catalogue contraindication resolves to a typed predicate (no dangling alias)', () => {
    for (const r of SEED_SUPPLEMENTS) for (const c of r.contraindications) expect(canonicalPredicate(c.flag), `${r.id}: ${c.flag}`).not.toBeNull();
    // the legacy spellings a stored profile or test may still carry reach the same predicate
    expect(canonicalPredicate('ckd')).toBe('kidney-disease');
    expect(canonicalPredicate('kidney_disease')).toBe('kidney-disease');
    expect(canonicalPredicate('liver_disease')).toBe('liver-disease');
    expect(CONTRAINDICATION_PREDICATES).toContain('kidney-disease');
  });

  it('kidney disease from the screening holds the creatine and whey cards back, named with status and reason', () => {
    const r = supplementCards({ prescribed: [], dietKind: 'omnivore', safety: screened(['kidney']), goals: ['fat_loss_muscle_retention', 'strength'] });
    const ids = r.cards.map((c) => c.record.id);
    expect(ids).not.toContain('creatine_monohydrate');
    expect(ids).not.toContain('whey_protein');
    const creatine = r.held.find((h) => h.record.id === 'creatine_monohydrate')!;
    expect(creatine).toMatchObject({ state: 'noSuggest', reason: 'kidney disease' });
    // whey: a clinician-review question for kidney disease (protein exposure), and its milk allergy is not answered here
    expect(r.held.find((h) => h.record.id === 'whey_protein')!.state).toBe('clinicianReview');
    // every alias of the condition reaches the same decision
    for (const flag of ['ckd', 'kidney_disease', 'kidney-disease']) {
      const viaFlag = supplementCards({ prescribed: [], dietKind: 'omnivore', safety: withPersonFlags(screened([]), [flag]), goals: ['strength'] });
      expect(viaFlag.held.find((h) => h.record.id === 'creatine_monohydrate')?.state, flag).toBe('noSuggest');
    }
  });

  it('an unanswered screening is unchecked (withheld, named), never a negative screen; a screened no allows', () => {
    const creatine = supplementRecord('creatine')!;
    expect(suggestionPolicy(creatine, UNANSWERED_SAFETY)).toMatchObject({ state: 'unchecked', reasons: ['kidney disease (not answered)'] });
    expect(suggestionPolicy(creatine, screened([])).state).toBe('allow');
    const r = supplementCards({ prescribed: [], dietKind: 'omnivore', safety: UNANSWERED_SAFETY, goals: ['strength'] });
    expect(r.cards.find((c) => c.record.id === 'creatine_monohydrate')).toBeUndefined();
    expect(r.held.find((h) => h.record.id === 'creatine_monohydrate')).toMatchObject({ state: 'unchecked', reason: 'kidney disease (not answered)' });
    // Unchecked is not "hidden because of your safety answers"
    expect(r.hiddenForSafety).toBe(r.held.filter((h) => h.state !== 'unchecked').length);
    // answers waiting for import review count as not answered
    const pending = foodSafetyInput({ answers: { conditions: 'no' }, pendingReview: true, profile: { safetyFlags: [] } });
    expect(suggestionPolicy(creatine, pending).state).toBe('unchecked');
  });

  it('a low-eGFR marker patch and every marker noSuggest decision reach Food with their provenance', () => {
    const egfr = markerSafety({ safety: { plannerLocks: [{ id: 'creatine-cap', value: 0, reasons: [{ rule: 'W-L-EGFR-2' }] }], flags: ['kidney-disease'] }, noSuggest: [{ rule: 'W-L-EGFR-2', markerId: 'egfr', subject: 'supp:creatine_monohydrate', sampleDate: '2026-09-01', stale: false, applicability: 'applicable' }] });
    expect(egfr.noSuggest[0]).toMatchObject({ rule: 'W-L-EGFR-2', subject: 'supp:creatine_monohydrate', sampleDate: '2026-09-01', applicability: 'applicable' });
    const safety = foodSafetyInput({ answers: { conditions: 'no', pregnancy: 'no' }, evaluation: { safety: { plannerLocks: [], flags: ['kidney-disease'] }, noSuggest: egfr.noSuggest as never }, profile: { safetyFlags: [] } });
    expect(suggestionPolicy(supplementRecord('creatine')!, safety)).toMatchObject({ state: 'noSuggest' });
    // the four shipped noSuggest rules survive the evaluator; an unresolved one stays visible as Unchecked
    for (const [rule, subject] of [['W-L-EGFR-2', 'supp:potassium_salt_substitute'], ['W-L-K-2', 'supp:electrolytes_fasting'], ['W-L-FERRITIN-8', 'supp:iron'], ['W-L-VITD-3', 'supp:vitamin_d3']] as const) {
      const ev = { safety: { plannerLocks: [], flags: [] }, noSuggest: [{ rule, markerId: 'x', subject, sampleDate: '2026-09-01', stale: false, applicability: 'applicable' as const }] };
      const s = foodSafetyInput({ answers: { conditions: 'no', medications: 'no', metabolic: 'no', pregnancy: 'no' }, evaluation: ev as never, profile: { safetyFlags: [] } });
      const p = suggestionPolicy(supplementRecord(subject.slice(5))!, s);
      expect(p.state, rule).toBe('noSuggest');
      expect(p.reasons, rule).toContain('blood result');
      const unresolved = foodSafetyInput({ answers: { conditions: 'no', medications: 'no', metabolic: 'no', pregnancy: 'no' }, evaluation: { ...ev, noSuggest: [{ ...ev.noSuggest[0]!, applicability: 'unresolved' as const }] } as never, profile: { safetyFlags: [] } });
      expect(suggestionPolicy(supplementRecord(subject.slice(5))!, unresolved).state, rule).not.toBe('allow');
    }
  });

  it('a product the person already takes keeps its row with its status (never deleted, never a stop order)', () => {
    expect(takingCaution('creatine', screened(['kidney']))).toBe('Review · kidney disease');
    expect(takingCaution('creatine', screened([]))).toBeNull();
    expect(takingCaution('creatine', UNANSWERED_SAFETY)).toBe('Unchecked · kidney disease (not answered)');
    expect(takingCaution(null, screened(['kidney']))).toBeNull();
    // a clinician stop on their own row is a review, and a refusal list never applies to their own row
    const stopped = foodSafetyInput({ answers: { conditions: 'no' }, profile: { safetyFlags: [], supplements: { _v: 2, stance: 'taking', rows: [{ supplementId: 'creatine', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'], clinicianStop: { on: '2026-09-01' } }] } } });
    expect(stopped.clinicianStops).toEqual(['creatine_monohydrate']);
    expect(takingCaution('creatine', stopped)).toBe('Review · clinician advice');
    expect(takingCaution('creatine', { ...screened([]), refused: ['creatine_monohydrate'] })).toBeNull();
  });

  it('food allergies come from the answered food rules; unanswered rules leave them unknown', () => {
    const whey = supplementRecord('whey_protein')!;
    const answered = foodSafetyInput({ answers: { conditions: 'no' }, profile: { safetyFlags: [], foodRules: { allergies: ['milk'] } as never } });
    expect(suggestionPolicy(whey, answered)).toMatchObject({ state: 'noSuggest', reasons: ['milk allergy'] });
    const none = foodSafetyInput({ answers: { conditions: 'no' }, profile: { safetyFlags: [], foodRules: { allergies: [] } as never } });
    expect(suggestionPolicy(whey, none).state).toBe('allow');
    const unknown = foodSafetyInput({ answers: { conditions: 'no' }, profile: { safetyFlags: [] } });
    expect(suggestionPolicy(whey, unknown)).toMatchObject({ state: 'unchecked', reasons: ['milk allergy (not answered)'] });
  });
});

describe('day food status (C1/D5-01)', () => {
  it('only the person\'s day report makes a day complete or a confirmed zero; logged meals alone are Partial', () => {
    expect(dayFoodStatus(false)).toBe('Not logged');
    expect(dayFoodStatus(true)).toBe('Partial');
    expect(dayFoodStatus(true, 'complete')).toBe('Complete');
    expect(dayFoodStatus(false, 'complete')).toBe('Not logged');
    expect(dayFoodStatus(false, 'none')).toBe('No intake');
    // a report of no intake beside logged food is not a zero
    expect(dayFoodStatus(true, 'none')).toBe('Partial');
  });
});
