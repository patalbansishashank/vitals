/** Each chapter's reducer: answers → the documents the engine, planner and recipes read (design §10.1 mapping). */
import { describe, expect, it } from 'vitest';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { STANDARD_ANSWERS } from '@/features/onboarding/testing';
import { measuredRmrKcal, reduceActivity } from '../chapters/activity';
import { coachDaily, offPolicy, recommendedPolicy, reduceDevices, routeOf, setCell, streamsFor, STREAM_RULES } from '../chapters/devices';
import { dietAnimalLevelOf, kitchenDefaults, medicalDietOf, reduceFood } from '../chapters/food';
import { EQUIPMENT_GROUPS, KITS, LOADABLE, PLACE_EQUIPMENT, familyTokens, reduceTraining, safetyContraTags } from '../chapters/training';
import { DEFAULT_CONTEXT, type FlowContext } from '../flow';
import type { ChapterAnswers, TurnStatus } from '../types';

const ctx: FlowContext = DEFAULT_CONTEXT;
const india: FlowContext = { ...DEFAULT_CONTEXT, india: true };

/** Answers as given (status 'answered'), plus optional skips. */
function turns(values: Record<string, unknown>, skipped: string[] = []): ChapterAnswers {
  const status: Record<string, TurnStatus> = {};
  for (const k of Object.keys(values)) status[k] = 'answered';
  for (const k of skipped) status[k] = 'skipped';
  return { values, status };
}

describe('a normal day → ActivityIntake', () => {
  it('nothing answered = no intake (the engine keeps its pre-intake behaviour)', () => {
    expect(reduceActivity({ values: {}, status: {} }, ctx).activity).toBeUndefined();
  });

  it('maps the wording to the schema: ride = passive, watch or ring = wrist, hard = vigorous', () => {
    const r = reduceActivity(
      turns({
        work: 'yes',
        job: 'onFeet',
        workTime: { days: 6, hours: 10 },
        commute: 'ride',
        stepsKnown: 'wrist',
        stepsNumber: { mean: 8200 },
        offDay: 'outAndAbout',
        home: 'aLot',
        sport: [{ label: 'badminton', intensity: 'vigorous', minPerWeek: 90 }],
        trainNow: '3-4',
        trainMix: 'lifting',
        sleep: { bed: 23, wake: 7 },
        sleepQuality: 'good',
      }),
      ctx,
    );
    expect(r.activity).toEqual({
      work: 'onFeet',
      workDaysPerWeek: 6,
      workHoursPerDay: 10,
      commute: { mode: 'passive' },
      steps: { source: 'wrist', weeklyMean: 8200 },
      offDay: 'outAndAbout',
      onFeetAtHome: 'aLot',
      recreation: [{ label: 'badminton', intensity: 'vigorous', minPerWeek: 90 }],
    });
    expect(r.habits).toEqual({ sessionsPerWeek: 4, lifingCardioMix: 0.2, bedTimeH: 23, wakeTimeH: 7, sleepQuality: 'good' });
    expect(r.defaulted).toEqual([]);
    // typicalSteps is written only for "roughly"
    expect(r.habits.typicalSteps).toBeUndefined();
  });

  it('"it varies" keeps fractional days (to 0.5); walking minutes default to 20 when skipped', () => {
    const r = reduceActivity(turns({ work: 'varies', workTime: { days: 3.4, hours: 6 }, commute: 'walk' }, ['commuteMin']), ctx);
    expect(r.activity?.workDaysPerWeek).toBe(3.5);
    expect(r.activity?.commute).toEqual({ mode: 'walk', activeMinPerWorkday: 20 });
    expect(r.defaulted).toContain('commute');
  });

  it('"not working" and "work from home"', () => {
    expect(reduceActivity(turns({ work: 'no' }), ctx).activity).toEqual({ work: 'notWorking' });
    expect(reduceActivity(turns({ work: 'yes', commute: 'home' }), ctx).activity?.commute).toEqual({ mode: 'none' });
  });

  it('steps: roughly writes the rough number (and typicalSteps); "no" clears a stale tick; phone keeps "carried"', () => {
    const rough = reduceActivity(turns({ stepsKnown: 'roughly', stepsRough: 9000 }), ctx);
    expect(rough.activity?.steps).toEqual({ source: 'estimate', weeklyMean: 9000 });
    expect(rough.habits.typicalSteps).toBe(9000);
    const no = reduceActivity(turns({ stepsKnown: 'no' }), ctx);
    expect(no.activity?.steps).toEqual({ source: 'unknown' });
    expect(no.clearTypicalSteps).toBe(true);
    const phone = reduceActivity(turns({ work: 'yes', stepsKnown: 'phone', stepsNumber: { workday: 9000, offDay: 4000 }, phoneCarried: 'notReally' }), ctx);
    expect(phone.activity?.steps).toEqual({ source: 'phone', workday: 9000, offDay: 4000, phoneCarried: false });
    const later = reduceActivity(turns({ stepsKnown: 'wrist', stepsNumber: { importLater: true } }), ctx);
    expect(later.activity?.steps).toEqual({ source: 'wrist' });
  });

  it('skipped answers are left out (engine defaults) and their drivers are marked assumed', () => {
    const r = reduceActivity(turns({ work: 'yes' }, ['job', 'stepsKnown', 'home', 'sport', 'trainNow']), ctx);
    expect(r.activity).toEqual({});
    expect(r.defaulted.sort()).toEqual(['home', 'recreation', 'steps', 'training', 'work']);
    expect(r.habits).toEqual({});
  });

  it('measured energy: kept as answered, and only a metabolic-cart resting value is a resting metabolism', () => {
    const cart = reduceActivity(turns({ measuredEver: 'rmr', measured: { value: 1720, unit: 'kcal', method: 'metabolic_cart', date: '2026-03' } }), ctx);
    expect(cart.measured).toEqual({ kind: 'rmr', value: 1720, unit: 'kcal', method: 'metabolic_cart', date: '2026-03' });
    expect(measuredRmrKcal(cart.measured)).toBe(1720);
    // kJ converts to kcal (rounded)
    expect(measuredRmrKcal({ kind: 'rmr', value: 7200, unit: 'kJ', method: 'metabolic_cart' })).toBe(1721);
    // estimates and whole-day figures are never a resting metabolism
    for (const method of ['dxa_based', 'smart_scale', 'calculator'] as const) expect(measuredRmrKcal({ kind: 'rmr', value: 1720, unit: 'kcal', method })).toBeNull();
    expect(measuredRmrKcal({ kind: 'tdee', value: 2600, unit: 'kcal', method: 'tracking' })).toBeNull();
    // out of the accepted day range
    expect(measuredRmrKcal({ kind: 'rmr', value: 9000, unit: 'kcal', method: 'metabolic_cart' })).toBeNull();
    // "no" after a figure: the figure is kept in the turns but not used
    expect(reduceActivity(turns({ measuredEver: 'no', measured: { value: 1720, unit: 'kcal', method: 'metabolic_cart' } }), ctx).measured).toBeUndefined();
  });
});

describe('training and equipment → TrainingProfile + TrainingPreferences', () => {
  const tctx = { ...ctx, catalogue: SEED_CATALOGUE };

  it('every kit, checklist and place id is a catalogue equipment id (Indian and Western items)', () => {
    const all = new Set([...Object.values(KITS).flat(), ...EQUIPMENT_GROUPS.flatMap((g) => g.items), ...Object.values(PLACE_EQUIPMENT).flat(), ...LOADABLE]);
    for (const id of all) expect(SEED_CATALOGUE.equipmentItem(id), id).toBeDefined();
    expect(EQUIPMENT_GROUPS.find((g) => g.id === 'indian')?.items).toEqual(expect.arrayContaining(['mudgar_heavy', 'mudgar_pair', 'gada', 'indian_clubs']));
  });

  it('defaults on skip: beginner skill, home, nothing owned, 3 × 30 min, no purchases, quick logging', () => {
    const r = reduceTraining({ values: {}, status: {} }, tctx);
    expect(r.profile).toMatchObject({ owned: [], refused: [], liked: [], injuries: [], skill: 2, purchaseAllowance: { maxPriceTier: 0, maxItems: 0 } });
    expect(r.profile.access).toEqual([{ place: 'home', equipment: [], weekdays: [0, 1, 2, 3, 4, 5, 6] }]);
    expect(r.prefs).toMatchObject({ daysPerWeek: 3, minPerSession: 30, bestTime: 'any', logStyle: 'quick' });
  });

  it('maps experience, willingness, kit, weights, access, injuries, conditions, refusals and purchases', () => {
    const r = reduceTraining(
      turns({
        experience: '1to3',
        willing: { running: 'no', indian: 'like', yoga: 'fine' },
        where: ['home', 'park', 'akhara'],
        whereDays: { park: [6, 0] },
        kit: { owned: ['dumbbell', 'barbell', 'mudgar_heavy', 'chair'], custom: ['a wooden wheel'] },
        weights: { dumbbell: [10, 5], mudgar_heavy: 'unsure' },
        time: { days: 4, minutes: 45, best: 'morning' },
        injuries: { parts: ['shoulder', 'knee'], cleared: ['knee'] },
        conditions: ['hypertension'],
        wontDo: ['noNoise', 'overhead', 'smallSpace', 'text:no burpees'],
        buy: 't2',
        log: 'detailed',
      }),
      { ...tctx, safety: { ...STANDARD_ANSWERS, pregnancy: 'pregnant-or-breastfeeding' } },
    );
    expect(r.profile.skill).toBe(3);
    // "no" is a hard filter (enjoy −2 and refused); "like" is +1
    const run = familyTokens('running', SEED_CATALOGUE);
    expect(run.length).toBeGreaterThan(0);
    for (const t of run) {
      expect(r.profile.refused).toContain(t);
      expect(r.profile.enjoy?.[t]).toBe(-2);
    }
    expect(r.profile.enjoy?.indian).toBe(1);
    expect(r.profile.liked).toContain('indian');
    expect(r.profile.refused).toEqual(expect.arrayContaining(['noisy', 'jumping', 'overhead']));
    expect(r.profile.owned).toEqual(['dumbbell', 'barbell', 'mudgar_heavy', 'chair', 'plates']);
    expect(r.profile.loadsKg).toEqual({ dumbbell: [5, 10] });
    expect(r.prefs.weightsUnknown).toEqual(['barbell', 'mudgar_heavy'].filter((id) => LOADABLE.includes(id)));
    expect(r.profile.access).toEqual([
      { place: 'home', equipment: ['dumbbell', 'barbell', 'mudgar_heavy', 'chair', 'plates'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      { place: 'park', equipment: ['outdoor_bars'], weekdays: [6, 0] },
      { place: 'other', equipment: [...PLACE_EQUIPMENT.akhara], weekdays: [0, 1, 2, 3, 4, 5, 6] },
    ]);
    // injuries + conditions + pregnancy from the safety answers; a cleared part stays on record without a filter
    expect(r.profile.injuries).toEqual(['shoulder', 'knee', 'hypertension', 'pregnancy']);
    expect(r.profile.cleared).toEqual(['knee']);
    expect(r.profile.purchaseAllowance).toEqual({ maxPriceTier: 2, maxItems: 2 });
    expect(r.prefs).toMatchObject({ daysPerWeek: 4, minPerSession: 45, bestTime: 'morning', logStyle: 'detailed', customEquipment: ['a wooden wheel'], refusedText: 'no burpees' });
    expect(r.prefs.homeConstraints).toEqual(['noNoise', 'smallSpace']);
  });

  it('heart answers from the safety questions apply without being asked again', () => {
    expect(safetyContraTags({ ...STANDARD_ANSWERS, conditions: 'yes', conditionItems: ['heart'] })).toEqual(['cardiac_unscreened']);
    expect(safetyContraTags(STANDARD_ANSWERS)).toEqual([]);
  });
});

describe('food and kitchen → FoodProfile', () => {
  const fctx = { ...ctx, now: '2026-10-01T09:00:00.000Z' };
  const base = { eat: { preset: 'vegetarian', foods: ['dairy'] }, allergies: ['none'], rules: ['none'] };

  it('food rules are never guessed: no diet until what you eat, allergies and rules are answered', () => {
    expect(reduceFood({ values: {}, status: {} }, fctx).diet).toBeNull();
    expect(reduceFood(turns({ eat: base.eat }, ['allergies', 'rules']), fctx).diet).toBeNull();
    const ok = reduceFood(turns(base), fctx);
    expect(ok.rulesComplete).toBe(true);
    expect(ok.diet?.animalFoods).toMatchObject({ meat: 'none', eggs: 'none', dairy: 'yes', fish: false });
    expect(ok.habits.dietAnimalLevel).toBe('vegetarian');
  });

  it('Indian vegetarian variants: eggetarian with eggs only in baked food; vegan with ghee only', () => {
    const egg = reduceFood(turns({ ...base, eat: { preset: 'eggetarian', foods: ['dairy', 'eggs'] }, eggs: 'baked_only' }), fctx);
    expect(egg.diet?.animalFoods.eggs).toBe('baked_only');
    const ghee = reduceFood(turns({ ...base, eat: { preset: 'vegan', foods: [] }, dairy: 'ghee_only' }), fctx);
    expect(ghee.diet?.animalFoods).toMatchObject({ dairy: 'ghee_only', eggs: 'none', honey: true });
    expect(ghee.habits.dietAnimalLevel).toBe('vegetarian');
    const vegan = reduceFood(turns({ ...base, eat: { foods: [] }, dairy: 'none' }), fctx);
    expect(vegan.diet?.animalFoods.honey).toBe(false);
    expect(vegan.habits.dietAnimalLevel).toBe('vegan');
  });

  it('a mutton-only eater is never given chicken; beef and pork are explicit', () => {
    const r = reduceFood(turns({ ...base, eat: { foods: ['dairy', 'mutton'] } }), fctx);
    expect(r.diet?.animalFoods).toMatchObject({ chicken: false, mutton: true, beef: false, pork: false });
    expect(dietAnimalLevelOf(r.diet!.animalFoods)).toBe('omnivore');
  });

  it('Jain sub-rules, Hindu fasting days and periods, Ramadan and Lent become hard rules', () => {
    const r = reduceFood(
      turns({
        ...base,
        rules: ['jain', 'hinduFasting', 'ramadan', 'lent'],
        jain: ['noRootVeg', 'noOnionGarlic', 'noHoney', 'greens'],
        jainGreens: [3],
        fasting: { weekdays: [1], periods: ['Ekadashi', 'text:Karva Chauth'] },
        fastingFood: 'fruit_milk',
        meatDays: [2],
      }),
      fctx,
    );
    expect(r.diet?.jain).toMatchObject({ noRootVeg: true, noOnionGarlic: true, noHoney: true, greensRestrictedDays: [3] });
    expect(r.diet?.noOnionGarlic).toBe(true);
    expect(r.diet?.animalFoods.honey).toBe(false);
    expect(r.diet?.dayRules).toEqual([{ weekdays: [1], rule: 'vrat', note: 'fruit_milk' }]);
    expect(r.diet?.periodRules).toEqual([
      { name: 'Ekadashi', rule: 'vrat', eats: 'fruit_milk' },
      { name: 'Karva Chauth', rule: 'vrat', eats: 'fruit_milk' },
      { name: 'Ramadan', rule: 'daylight_fast' },
      { name: 'Lent', rule: 'observe' },
    ]);
  });

  it('allergies are hard filters (traces strict unless "normal"); typed allergies are kept', () => {
    const r = reduceFood(turns({ ...base, allergies: ['peanut', 'sesame', 'text:jackfruit'] }), fctx);
    expect(r.diet).toMatchObject({ allergies: ['peanut', 'sesame'], allergiesOther: ['jackfruit'], allergyStrict: true });
    expect(reduceFood(turns({ ...base, allergies: ['milk'], traces: 'normal' }), fctx).diet?.allergyStrict).toBe(false);
  });

  it('kitchen, time, cuisines, who cooks, alcohol, supplements and the optional later block', () => {
    const r = reduceFood(
      turns({
        ...base,
        cuisine: ['gujarati', 'north_indian'],
        cooks: 'self',
        kitchen: ['pressure_cooker', 'tawa', 'induction'],
        mealTime: '20to40',
        alcohol: 'weekly',
        drinks: 6,
        supplements: 'taking',
        taking: [{ supplementId: 'vitamin_d3', dose: 1000, unit: 'IU', time: 'morning' }],
        later: 'yes',
        staples: { grain: ['wheat_roti'], fat: ['ghee'] },
        budget: 'tight',
        eatingOut: 3,
        pantry: ['atta', 'paneer'],
      }),
      fctx,
    );
    expect(r.diet).toMatchObject({
      cuisines: ['gujarati', 'north_indian'],
      whoCooks: 'self',
      familyFoodMode: false,
      timeBudgetMin: { weekdayBreakfast: 10, weekdayLunch: 20, weekdayDinner: 30, weekend: 45 },
      alcoholDrinksPerWeek: 6,
      staples: { grain: ['wheat_roti'], fat: ['ghee'] },
      budget: { tier: 'tight' },
      eatingOut: { mealsPerWeek: 3 },
    });
    expect(r.kitchen.equipment).toEqual(['pressure_cooker', 'tawa', 'induction']);
    expect(r.kitchen.pantry).toEqual([
      { foodId: 'atta', have: true, perishable: false, confirmedAt: fctx.now },
      { foodId: 'paneer', have: true, perishable: true, confirmedAt: fctx.now },
    ]);
    // the old "I already take some" answer (one time per entry) reads as a taking row (E18, v2 section)
    expect(r.supplements).toEqual({ _v: 2, stance: 'taking', rows: [{ supplementId: 'vitamin_d3', state: 'taking', dose: 1000, unit: 'IU', timesOfDay: ['morning'] }] });
    expect(r.habits.habitualAlcoholDrinksPerWeek).toBe(6);
  });

  it('family-food mode skips the kitchen questions; eating out sets at least 7 meals out', () => {
    const fam = reduceFood(turns({ ...base, cooks: 'tiffin', household: '3 rotis, dal, sabzi', kitchen: ['oven'] }), { ...fctx, india: true });
    expect(fam.diet).toMatchObject({ whoCooks: 'tiffin', familyFoodMode: true, householdMeals: '3 rotis, dal, sabzi' });
    // the kitchen answer no longer applies: locale defaults stand
    expect(fam.kitchen.equipment).toEqual(kitchenDefaults(true));
    const out = reduceFood(turns({ ...base, cooks: 'eatOut' }), fctx);
    expect(out.diet).toMatchObject({ whoCooks: 'mixed', eatingOut: { mealsPerWeek: 7 } });
  });

  it('defaults by region and safety: Indian kitchen, food first, medical diets read from the safety answers', () => {
    const r = reduceFood(turns(base), { ...fctx, india: true, safety: { ...STANDARD_ANSWERS, conditions: 'yes', conditionItems: ['kidney', 'high-blood-pressure'] } });
    expect(r.kitchen.equipment).toEqual(['pressure_cooker', 'tawa', 'kadhai', 'gas_2burner', 'fridge']);
    expect(r.supplements).toEqual({ _v: 2, stance: 'food_first', rows: [] });
    expect(r.diet?.cuisines).toEqual(['north_indian']);
    expect(r.diet?.medicalDiet).toEqual(['CKD-protein-limit', 'low-sodium']);
    expect(medicalDietOf({ ...STANDARD_ANSWERS, medications: 'yes', medicationItems: ['anticoagulant'] })).toEqual(['warfarin-vitK-consistency']);
  });

  it('gentle mode does not ask about alcohol', () => {
    const r = reduceFood(turns({ ...base, alcohol: 'weekly', drinks: 10 }), { ...fctx, gentle: true });
    expect(r.diet?.alcoholDrinksPerWeek).toBeUndefined();
    expect(india.india).toBe(true);
  });
});

describe('devices and data → StreamOptIns', () => {
  it('offers the streams the devices have; skipping leaves every stream off', () => {
    expect(streamsFor(['scale'])).toEqual(['weight', 'body_fat']);
    expect(streamsFor(['ring', 'phoneOnly'])).toEqual(['sleep_sessions', 'heart_rate', 'hrv', 'spo2', 'skin_temp', 'steps', 'vendor_scores']);
    const r = reduceDevices(turns({ has: ['ring'], models: { ring: 'Colmi' }, platform: 'android' }, ['streams']), ctx);
    expect(r.devices).toEqual({ has: ['ring'], models: ['Colmi'], platforms: ['android'] });
    expect(r.policies.every((p) => !p.imported && !p.scores && !p.engine && p.coach === 'hidden')).toBe(true);
    expect(reduceDevices(turns({ has: ['none'] }), ctx).policies).toEqual([]);
  });

  it('recommended = bring in + scores + plan where allowed; the Coach stays hidden until chosen', () => {
    expect(recommendedPolicy('sleep_sessions')).toEqual({ stream: 'sleep_sessions', imported: true, scores: true, engine: true, coach: 'hidden' });
    expect(recommendedPolicy('hrv')).toMatchObject({ imported: true, scores: true, engine: false });
    expect(recommendedPolicy('vendor_scores')).toMatchObject({ imported: false });
    expect(coachDaily([recommendedPolicy('steps'), offPolicy('hrv')]).map((p) => p.coach)).toEqual(['daily', 'hidden']);
  });

  it('cells keep the rules: "never" cannot be switched on, and turning "bring in" off clears the row', () => {
    const spo2 = setCell(setCell(offPolicy('spo2'), 'imported', true), 'engine', true);
    expect(STREAM_RULES.spo2.engine).toBe('never');
    expect(spo2.engine).toBe(false);
    expect(setCell(offPolicy('hrv'), 'scores', true).scores).toBe(false);
    const on = setCell(setCell(setCell(offPolicy('hrv'), 'imported', true), 'scores', true), 'coach', 'daily+series');
    expect(on).toMatchObject({ imported: true, scores: true, coach: 'daily+series' });
    expect(setCell(on, 'imported', false)).toEqual(offPolicy('hrv'));
    // stored values are re-checked on the way out
    const r = reduceDevices(turns({ has: ['ring'], streams: [{ stream: 'vendor_scores', imported: true, scores: true, engine: true, coach: 'daily' }] }), ctx);
    expect(r.policies.find((p) => p.stream === 'vendor_scores')).toEqual({ stream: 'vendor_scores', imported: true, scores: false, engine: false, coach: 'daily' });
  });

  it('routes: iPhone exports, Colmi connects directly only with Web Bluetooth, Android goes through Health Connect', () => {
    expect(routeOf('ring', 'Oura', 'ios', true)).toBe('iphone');
    expect(routeOf('ring', 'Colmi', 'android', true)).toBe('direct');
    expect(routeOf('ring', 'Colmi', 'android', false)).toBe('directUnavailable');
    expect(routeOf('ring', 'Oura', 'android', false)).toBe('healthConnect');
    expect(routeOf('scale', 'Withings', 'android', true)).toBe('scale');
    expect(routeOf('watch', 'Garmin', 'desktop', false)).toBe('file');
  });
});

describe('parent-answer chips (Q3-J1)', () => {
  it('never repeat the "because you said:" prefix the question card already prints', async () => {
    const { CHAPTER_QUESTIONS } = await import('../chapters');
    const samples: Record<string, unknown>[] = [{ supplements: 'taking' }, { supplements: 'onHand' }, { has: 'manual' }, { has: 'report' }];
    let seen = 0;
    for (const qs of Object.values(CHAPTER_QUESTIONS)) {
      for (const q of qs) {
        if (!q.contextLine) continue;
        for (const v of samples) {
          const line = q.contextLine(v, ctx);
          if (line === null || line === undefined) continue;
          seen++;
          expect(line).not.toMatch(/because you said/i);
        }
      }
    }
    expect(seen).toBeGreaterThan(2);
  });
});
