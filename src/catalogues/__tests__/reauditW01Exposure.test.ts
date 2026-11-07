/**
 * Re-audit W0/W1 (F05): food sources, labels and nutrient exposure through the real consumers.
 *  - A1-023: a meal that does not analyse sodium never makes a complete day's sodium complete: command → realised history
 *    → compiler keeps the hydration default and the 100 mg as a lower bound.
 *  - A1-028: one source resolver for planning, candidates, fitting and logging (whole-natural almonds, available-basis and
 *    unknown-basis and polyol records); an unresolved carbohydrate basis never gets a precise compliance pass.
 *  - A1-045: `catalogue.searchFoods` / `catalogue.getFood` read the shared food provider (bundled, custom, overridden,
 *    quarantined) exactly as food logging does.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { readDocs } from '@/commands/living';
import type { PersonProfile } from '@/engine';
import { compileVersion, localToInstant, projectLiving, projectionSchedule, type LogEntry } from '@/living';
import { getDocumentStore } from '@/state/runtime';
import { contentHash } from '@/lib/bodyContracts';
import { mealTotals, planningCarbOf } from '@/catalogues/foods';
import { FOOD_REFERENCE_VERSION } from '@/content/catalogues/foods.reference';
import { checkDay, fitMeal, foodTable, foodTableIssues, per100OfFood, type MealLogResult } from '@/commands/food';
import { seedCustomFoods, seedPlan } from '@/commands/food/__tests__/seed';

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };
const D = '2026-09-29';
const TODAY = '2026-10-01';
type Meal = Extract<LogEntry, { kind: 'meal' }>;

function out<T = Record<string, unknown>>(r: CommandResult): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  if (!('output' in r)) throw new Error('no output');
  return r.output as T;
}
const logged = (r: CommandResult): Extract<MealLogResult, { status: 'logged' }> => {
  const o = out<MealLogResult>(r);
  if (o.status !== 'logged') throw new Error(`not logged: ${JSON.stringify(o)}`);
  return o;
};
let docN = 0;
const customFood = (id: string, per100g: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  _id: `01JFE${String(++docN).padStart(21, '0')}`,
  kind: 'food',
  key: id,
  item: { id, name: id.replace(/-/g, ' '), aliases: [], group: 'other', tags: [], source: 'user', verified: false, state: 'as-eaten', portions: [], sources: ['user'], per100g, ...extra },
});

beforeEach(() => {
  freshState({ cleared: true });
});

describe('A1-023: an unanalysed meal keeps a complete day\'s nutrient partial (command → history → compiler)', () => {
  async function day(order: 'analysedFirst' | 'unanalysedFirst') {
    await seedPlan();
    const a = { name: 'soup', grams: 100, labelPer100g: { energyKcal: 140, sodiumMg: 100, calciumMg: 50, satFatG: 2, sugarsG: 5 } };
    const b = { name: 'bar', grams: 100, labelPer100g: { energyKcal: 140 } };
    const [first, second] = order === 'analysedFirst' ? [a, b] : [b, a];
    logged(await dispatch('log.meal', { date: D, clockH: 9, method: 'label', components: [first] }));
    logged(await dispatch('log.meal', { date: D, clockH: 13, method: 'label', components: [second] }));
    await settleCommits();
    out(await dispatch('log.confirmDay', { date: D, intake: 'complete' }));
    await settleCommits();
    const tz = getDocumentStore().peekAll<LogEntry>('dailyLogs')[0]!.tz;
    const p = projectLiving({ docs: await readDocs(TODAY), today: TODAY, tz, now: localToInstant(TODAY, 10, tz), skipAssimilation: true });
    return { p, d: p.days.find((x) => x.date === D)! };
  }

  for (const order of ['analysedFirst', 'unanalysedFirst'] as const) {
    it(`sodium is a 100 mg lower bound, never a complete 100 mg day (${order})`, async () => {
      const { p, d } = await day(order);
      expect(d.result.observed.energyKcal).toBe(280);
      expect(d.result.nutrients.energy?.coverage).toBe('complete');
      expect(d.result.nutrients.sodium).toEqual({ knownSum: 100, unit: 'mg', coverage: 'partial' });
      expect(d.result.nutrients.calcium).toMatchObject({ knownSum: 50, coverage: 'partial' });
      expect(d.result.nutrients.satFat).toMatchObject({ knownSum: 2, coverage: 'partial' });
      expect(d.result.nutrients.sugars).toMatchObject({ knownSum: 5, coverage: 'partial' });
      // the replay keeps its hydration default: a partial sum never overrides it
      expect(d.result.loggedDay.inputs.hydration?.sodiumG).toBeUndefined();
      const compiled = compileVersion(MAN, projectionSchedule(p, TODAY)!);
      expect(compiled.days[1]!.sodiumMg).not.toBeCloseTo(100, 6);
    });
  }
});

describe('A1-028: one source resolver for planning, candidates, fitting and logging', () => {
  it('bundled whole-natural almonds have the same eligible ME in mealTotals, food.candidates, food.planDay and log.meal', async () => {
    await seedPlan();
    expect(mealTotals([{ foodId: 'almonds_raw', grams: 100 }], foodTable())).toMatchObject({ energyKcal: 442, sourceEnergyKcal: 579 });
    const cand = out<Array<{ id: string; per100g: { energyKcal: number; sourceEnergyKcal?: number } }>>(await dispatch('food.candidates', { date: D })).find((c) => c.id === 'almonds_raw')!;
    expect(cand.per100g).toMatchObject({ energyKcal: 442, sourceEnergyKcal: 579 });
    const plan = out<{ meals: Array<{ totals: { energyKcal: number } }> }>(await dispatch('food.planDay', { date: D, meals: [{ slot: 'meal1', items: [{ foodId: 'almonds_raw', grams: 100, flexible: false }], acceptClosest: true }] }));
    expect(plan.meals[0]!.totals.energyKcal).toBe(442);
    const log = logged(await dispatch('log.meal', { date: D, method: 'typed', components: [{ name: 'almonds', foodId: 'almonds_raw', grams: 100 }] }));
    expect(log.totals.energyKcal.value).toBe(442);
  });

  it('a fitted portion logs with exactly the energy and protein the fit showed', async () => {
    await seedPlan();
    const items = [{ foodId: 'almonds_raw', grams: 40 }, { foodId: 'yogurt_whole', grams: 200 }, { foodId: 'banana_raw', grams: 100 }];
    const plan = out<{ meals: Array<{ items: Array<{ foodId: string; grams: number }>; totals: { energyKcal: number; proteinG: number } }> }>(await dispatch('food.planDay', { date: D, meals: [{ slot: 'meal1', items, acceptClosest: true }] }));
    const fitted = plan.meals[0]!;
    const log = logged(await dispatch('log.meal', { date: D, method: 'typed', components: fitted.items.map((it) => ({ name: it.foodId, foodId: it.foodId, grams: it.grams })) }));
    expect(log.totals.energyKcal.value).toBeCloseTo(fitted.totals.energyKcal, 0);
    expect(log.totals.proteinG.value).toBeCloseTo(fitted.totals.proteinG, 0);
  });

  it('an available 20 g + fibre 15 g food stays 20 g everywhere and is filtered on a low-carbohydrate day', async () => {
    await seedCustomFoods([customFood('user-eu-cracker', { energyKcal: 300, proteinG: 15, fatG: 10, carbG: 20, fibreG: 15 }, { carbBasis: 'available' })]);
    const t = foodTable();
    expect(planningCarbOf(t.get('user-eu-cracker')!)).toMatchObject({ netCarbG: 20, status: 'resolved' });
    expect(mealTotals([{ foodId: 'user-eu-cracker', grams: 100 }], t).netCarbG).toBe(20);
    expect(per100OfFood('user-eu-cracker', t)!.netCarbG).toBe(20);
    await seedPlan({ kcal: 1800, proteinG: 120, carbG: 30, label: 'keto' });
    const c = out<Array<{ id: string }>>(await dispatch('food.candidates', { date: D }));
    expect(c.map((x) => x.id)).not.toContain('user-eu-cracker');
  });

  it('on an ordinary day the same candidate shows 20 g available carbohydrate, resolved', async () => {
    await seedCustomFoods([customFood('user-eu-cracker', { energyKcal: 300, proteinG: 15, fatG: 10, carbG: 20, fibreG: 15 }, { carbBasis: 'available' })]);
    await seedPlan();
    const ordinary = out<Array<{ id: string; per100g: { netCarbG: number; carbStatus?: string } }>>(await dispatch('food.candidates', { date: D })).find((x) => x.id === 'user-eu-cracker')!;
    expect(ordinary.per100g.netCarbG).toBe(20); // never 20 − 15 = 5
    expect(ordinary.per100g.carbStatus).toBeUndefined();
  });

  it('total-by-difference, unknown-basis and polyol records use one normalisation in every consumer (no double fibre subtraction)', async () => {
    await seedCustomFoods([
      customFood('user-us-bar', { energyKcal: 350, proteinG: 10, fatG: 10, carbG: 50, fibreG: 10 }, { carbBasis: 'totalByDifference' }),
      customFood('user-unknown-bar', { energyKcal: 350, proteinG: 10, fatG: 10, carbG: 50, fibreG: 10 }, { carbBasis: 'unknown' }),
      customFood('user-polyol-bar', { energyKcal: 300, proteinG: 10, fatG: 10, carbG: 50, fibreG: 10 }, { carbBasis: 'totalByDifference', polyolsG: { maltitol: 20 } }),
    ]);
    await seedPlan();
    const t = foodTable();
    const cands = out<Array<{ id: string; per100g: { netCarbG: number; carbStatus?: string; netCarbHighG?: number } }>>(await dispatch('food.candidates', { date: D }));
    const cand = (id: string) => cands.find((c) => c.id === id)!.per100g;
    const logCarb = async (id: string) => logged(await dispatch('log.meal', { date: D, method: 'typed', components: [{ name: id, foodId: id, grams: 100 }] })).totals;
    // total by difference: fibre once
    expect(cand('user-us-bar')).toMatchObject({ netCarbG: 40 });
    expect(mealTotals([{ foodId: 'user-us-bar', grams: 100 }], t).netCarbG).toBe(40);
    expect((await logCarb('user-us-bar')).carbG.value).toBe(40);
    // unknown basis: logged as unknown, planned only with its labelled upper bound (the printed total)
    expect(cand('user-unknown-bar')).toMatchObject({ netCarbG: 50, carbStatus: 'bounded', netCarbHighG: 50 });
    expect(mealTotals([{ foodId: 'user-unknown-bar', grams: 100 }], t)).toMatchObject({ carbStatus: 'bounded', netCarbLowG: 0, netCarbHighG: 50 });
    expect((await logCarb('user-unknown-bar')).unknown).toContain('carbG');
    // identified polyol: non-polyol available carbohydrate everywhere, the polyol mass only in the upper bound
    expect(cand('user-polyol-bar')).toMatchObject({ netCarbG: 20, carbStatus: 'bounded', netCarbHighG: 40 });
    expect(mealTotals([{ foodId: 'user-polyol-bar', grams: 100 }], t)).toMatchObject({ netCarbG: 20, polyolG: 20, netCarbHighG: 40 });
    expect((await logCarb('user-polyol-bar')).carbG.value).toBe(20);
  });

  it('through the real checkDay consumer an unknown carbohydrate basis never gets a precise pass; energy and protein stay usable', async () => {
    await seedCustomFoods([customFood('user-unknown-bar', { energyKcal: 350, proteinG: 10, fatG: 10, carbG: 50, fibreG: 10 }, { carbBasis: 'unknown' })]);
    await seedPlan();
    const t = foodTable();
    const target = { slot: 'x', name: 'lunch', clockH: 13, energyKcal: 350, proteinG: 10, carbG: 45, fatG: 10 };
    const fit = fitMeal([{ foodId: 'user-unknown-bar', grams: 100, flexible: false }], target, t);
    const check = checkDay([fit], [target]);
    const carb = check.deviations.find((d) => d.nutrient === 'carbG')!;
    expect(carb.status).toBe('unresolved');
    expect(carb.ok).toBe(false);
    expect(carb.range).toEqual([0, 50]);
    expect(check.ok).toBe(false);
    expect(check.deviations.find((d) => d.nutrient === 'energyKcal')).toMatchObject({ status: 'precise', ok: true, actual: 350 });
    expect(check.deviations.find((d) => d.nutrient === 'proteinG')).toMatchObject({ status: 'precise', ok: true, actual: 10 });
    // a low-carbohydrate cap the whole interval fits under is a proven, bounded pass (still not a precise one)
    const keto = { ...target, carbG: 50, lowCarbDay: true };
    const k = checkDay([fitMeal([{ foodId: 'user-unknown-bar', grams: 100, flexible: false }], keto, t)], [keto]).deviations.find((d) => d.nutrient === 'carbG')!;
    expect(k).toMatchObject({ status: 'bounded', ok: true });
    // the logged portion agrees with the fit's energy and protein
    const log = logged(await dispatch('log.meal', { date: D, method: 'typed', components: [{ name: 'bar', foodId: 'user-unknown-bar', grams: 100 }] }));
    expect(log.totals.energyKcal.value).toBe(fit.fit.totals.energyKcal);
    expect(log.totals.proteinG.value).toBe(fit.fit.totals.proteinG);
  });
});

describe('A1-045: catalogue commands read the shared food provider', () => {
  type View = { id: string; name: string; carbBasis?: string; source: string; own: boolean; provenance?: { datasetVersion: string; sourceId: string }; per100g: Record<string, number> };

  it('a fresh store finds and reads the bundled rice exactly as food logging resolves it', async () => {
    const found = out<View[]>(await dispatch('catalogue.searchFoods', { q: 'rice' }));
    expect(found.map((f) => f.id)).toEqual(expect.arrayContaining(['rice_white_cooked', 'rice_white_raw']));
    const got = out<View>(await dispatch('catalogue.getFood', { id: 'rice_white_cooked' }));
    const rec = foodTable().get('rice_white_cooked')!;
    expect(got).toMatchObject({ id: rec.id, carbBasis: rec.carbBasis, source: 'usda_sr', own: false, provenance: { datasetVersion: FOOD_REFERENCE_VERSION, sourceId: rec.provenance!.sourceId } });
    expect(got.per100g).toEqual(rec.per100g);
    expect(out<View>(await dispatch('catalogue.getFood', { id: 'rice_white_raw' })).per100g.energyKcal).toBe(365); // raw and cooked stay distinct
    const r = await dispatch('catalogue.searchFoods', { q: 'rice' });
    expect(r.ok && 'notices' in r ? r.notices.map((n) => n.text).join(' ') : '').not.toMatch(/not bundled/);
    // filters and limit keep their meaning
    expect(out<View[]>(await dispatch('catalogue.searchFoods', { filters: { group: 'nuts' } })).every((f) => foodTable().get(f.id)!.group === 'nuts')).toBe(true);
    expect(out<View[]>(await dispatch('catalogue.searchFoods', { limit: 3 }))).toHaveLength(3);
  });

  it('custom, explicitly overridden and quarantined records match the logging provider', async () => {
    await seedCustomFoods([
      customFood('user-chilla', { energyKcal: 210, proteinG: 11, fatG: 7, carbG: 25, fibreG: 5 }, { carbBasis: 'totalByDifference' }),
      customFood('rice_white_cooked', { energyKcal: 200, proteinG: 4, fatG: 1, carbG: 44, fibreG: 1 }, { carbBasis: 'available' }),
      customFood('user-broken', { energyKcal: 100, proteinG: Number.NaN, fatG: 1, carbG: 1 }),
    ]);
    const t = foodTable();
    expect(foodTableIssues().length).toBeGreaterThan(0);
    const chilla = out<View>(await dispatch('catalogue.getFood', { id: 'user-chilla' }));
    expect(chilla).toMatchObject({ id: 'user-chilla', own: true, carbBasis: 'totalByDifference' });
    expect(out<View[]>(await dispatch('catalogue.searchFoods', { q: 'chilla' }))[0]!.id).toBe('user-chilla');
    const override = out<View>(await dispatch('catalogue.getFood', { id: 'rice_white_cooked' }));
    expect(override).toMatchObject({ own: true, carbBasis: 'available', per100g: { energyKcal: 200 } });
    expect(override.per100g).toEqual(t.get('rice_white_cooked')!.per100g);
    const log = logged(await dispatch('log.meal', { date: D, method: 'typed', components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 100 }] }));
    expect(log.totals.energyKcal.value).toBe(override.per100g.energyKcal);
    expect(log.totals.carbG.value).toBe(44); // the override's own basis, as the catalogue shows it
    const broken = await dispatch('catalogue.getFood', { id: 'user-broken' });
    expect(!broken.ok && broken.error.code).toBe('not_found');
    expect(t.get('user-broken')).toBeUndefined();
    await settleCommits();
    // the logged snapshot names the overriding record's own version (the same record the catalogue returned)
    const stored = getDocumentStore().peekAll<Meal>('dailyLogs').filter((m) => m.kind === 'meal');
    expect(stored[0]!.components[0]!.snapshot!.version).toBe(`user:${contentHash(t.get('rice_white_cooked'))}`);
  });
});
