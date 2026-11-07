/**
 * The shared nutrient/exposure ledger (C3; D6-03 transport and arithmetic, D6-06 shared-draw scenarios, D7-04 active
 * ingredient exposure). Unknown is never zero; links are explicit; bolus doses keep their peaks.
 */
import { describe, expect, it } from 'vitest';
import type { ExposureQuantity, SupplementProduct } from '@/lib/bodyContracts';
import {
  accumulateNutrient,
  aggregateSnapshots,
  ingredientExposureSummary,
  isExposureBreakdown,
  mealEnergyLedger,
  mealExposures,
  nutrientCoverageOf,
  NUTRIENT_EXPOSURE_VERSION,
  polyolsOf,
  readMealIntake,
  substrateOutputStatus,
  sumExposures,
  reconcileLinkedExposures,
  scenarioTotals,
  scheduledSupplementDoses,
  substanceEventExposures,
  supplementEventExposures,
  uncertaintyGroupsOf,
  upperLimitCheck,
  type ExposureEvent,
} from '@/lib/nutrientExposure';
import type { LogEntry, NutrientEstimate } from '@/living/types';

const est = (v: number) => ({ value: v, sd: 0 });
const N = (e: number, p: number, c: number, f: number, fib = 0): NutrientEstimate => ({ energyKcal: est(e), proteinG: est(p), carbG: est(c), fatG: est(f), fibreG: est(fib) });

describe('accumulator: knownSum, completeness, unknown components (D6-03)', () => {
  it('converts g/mg/µg exactly and keeps unknown distinct from a measured zero', () => {
    const a = accumulateNutrient('calcium', [{ componentId: 'a', amount: 0.2, unit: 'g' }, { componentId: 'b', amount: 150, unit: 'mg' }, { componentId: 'c', amount: 0 }]);
    expect(a).toMatchObject({ unit: 'mg', knownSum: 350, completeness: 'complete', unknownComponents: [] });
    const b = accumulateNutrient('calcium', [{ componentId: 'a', amount: 200 }, { componentId: 'b', amount: null }]);
    expect(b).toMatchObject({ knownSum: 200, completeness: 'partial', unknownComponents: ['b'], derivation: 'partialSum' });
    expect(accumulateNutrient('calcium', [{ componentId: 'a', amount: null }])).toMatchObject({ completeness: 'unknown', knownSum: 0 });
    // an unsupported unit or a non-finite value is unknown, never zero
    expect(accumulateNutrient('energy', [{ componentId: 'a', amount: 100, unit: 'kJ' }]).completeness).toBe('unknown');
    expect(accumulateNutrient('sodium', [{ componentId: 'a', amount: Number.NaN }]).completeness).toBe('unknown');
  });

  it('equal macros with different sodium / saturated fat / calcium give different known exposure', () => {
    const base = { energyKcal: 200, proteinG: 10, netCarbG: 20, fatG: 8, fibreG: 2 };
    const a = aggregateSnapshots([{ componentId: '0', per100: { ...base, sodiumMg: 50, satFatG: 1, calciumMg: 20 }, edibleG: 200 }]);
    const b = aggregateSnapshots([{ componentId: '0', per100: { ...base, sodiumMg: 600, satFatG: 5, calciumMg: 300 }, edibleG: 200 }]);
    expect(a.energy!.knownSum).toBe(b.energy!.knownSum);
    expect(a.sodium!.knownSum).toBe(100);
    expect(b.sodium!.knownSum).toBe(1200);
    expect(a.satFat!.knownSum).not.toBe(b.satFat!.knownSum);
    expect(a.calcium!.knownSum).not.toBe(b.calcium!.knownSum);
  });

  it('a component that does not give a nutrient makes it partial (a small unknown salt/oil can dominate)', () => {
    const agg = aggregateSnapshots([
      { componentId: 'dal', per100: { energyKcal: 116, sodiumMg: 2 }, edibleG: 250 },
      { componentId: 'tadka', per100: { energyKcal: 800 }, edibleG: 10 },
    ]);
    expect(agg.sodium).toMatchObject({ completeness: 'partial', knownSum: 5, unknownComponents: ['tadka'] });
    expect(agg.energy!.completeness).toBe('complete');
  });

  it('keeps micronutrient units and forms (RAE, DFE, elemental mg, µg)', () => {
    const agg = aggregateSnapshots([{ componentId: '0', per100: { vitARaeUg: 160, folateDfeUg: 47, ironMg: 1.75, vitDUg: 2, epaG: 0, dhaG: 0.058 }, edibleG: 100 }]);
    expect(agg.vitARae).toMatchObject({ unit: 'ug', form: 'RAE', knownSum: 160 });
    expect(agg.folateDfe).toMatchObject({ unit: 'ug', form: 'DFE', knownSum: 47 });
    expect(agg.iron).toMatchObject({ unit: 'mg', knownSum: 1.75 });
    expect(agg.vitD).toMatchObject({ unit: 'ug', knownSum: 2 });
    expect(agg.epaDha!.knownSum).toBeCloseTo(0.058, 12);
  });

  it('an imputed source value counts in the sum but keeps the exposure marked imputed', () => {
    const agg = aggregateSnapshots([
      { componentId: 'rice', per100: { b12Ug: 0, calciumMg: 10 }, edibleG: 200, imputed: ['b12Ug'] },
      { componentId: 'egg', per100: { b12Ug: 0.89, calciumMg: 56 }, edibleG: 50 },
    ]);
    expect(agg.b12).toMatchObject({ knownSum: 0.445, completeness: 'complete', imputedComponents: ['rice'] });
    expect(agg.calcium!.imputedComponents).toBeUndefined();
    const comps = [{ nutrients: N(260, 9, 56, 5), source: 'table' as const, grams: 200, snapshot: { per100g: { b12Ug: 0, calciumMg: 10 } }, imputed: ['b12Ug'] }];
    const xs = mealExposures(comps);
    expect(xs.find((x) => x.id === 'b12')!.provenance).toBe('imputed');
    expect(xs.find((x) => x.id === 'calcium')!.provenance).toBe('estimated');
    // an as-planned meal stays as-planned (the whole record is a prescription estimate)
    expect(mealExposures(comps, { method: 'asPlanned' }).find((x) => x.id === 'b12')!.provenance).toBe('asPlanned');
  });

  it('reported carbohydrate stays its own exposure; unknown available carbohydrate is bounded by it', () => {
    const xs = mealExposures([{ nutrients: { ...N(300, 10, 0, 5), unknown: ['carbG'] }, source: 'label', grams: 100, snapshot: { per100g: { energyKcal: 300, proteinG: 10, carbG: 45, fatG: 5, fibreG: null } } }]);
    const avail = xs.find((x) => x.id === 'carbAvailable')!;
    expect(avail).toMatchObject({ value: null, upperBound: 45, coverage: 'unknown' });
    expect(xs.find((x) => x.id === 'carbReported')).toMatchObject({ value: 45, coverage: 'complete' });
    expect(NUTRIENT_EXPOSURE_VERSION).toBe(3);
  });
});

describe('linked events (D6-03, D7-04): counted once only through an explicit link', () => {
  const cup = (id: string, mg: number): ExposureEvent => ({ eventId: id, kind: 'meal', exposures: [{ id: 'caffeine', value: mg, unit: 'mg', provenance: 'estimated', coverage: 'complete', originEventId: id }] });
  const drink = (id: string, mg: number): ExposureEvent => ({ eventId: id, kind: 'substance', exposures: [{ id: 'caffeine', value: mg, unit: 'mg', provenance: 'reported', coverage: 'complete', originEventId: id }] });
  const total = (evs: readonly ExposureEvent[]) => evs.flatMap((e) => e.exposures).reduce((s, x) => s + (x.value ?? 0), 0);

  it('a coffee logged as food and as caffeine is counted once when the person links them', () => {
    const r = reconcileLinkedExposures([cup('m1', 95), drink('s1', 100)], [{ eventIds: ['m1', 's1'], exposureIds: ['caffeine'], keep: 's1', source: 'user' }]);
    expect(total(r.events)).toBe(100);
    expect(r.dropped).toEqual([{ eventId: 'm1', exposureId: 'caffeine', duplicateOf: 's1' }]);
  });

  it('two independent drinks with the same amount at the same time are counted twice', () => {
    const r = reconcileLinkedExposures([drink('s1', 80), drink('s2', 80)], []);
    expect(total(r.events)).toBe(160);
    const bad = reconcileLinkedExposures([drink('s1', 80)], [{ eventIds: ['s1', 'nope'], exposureIds: ['caffeine'], keep: 's1', source: 'user' }]);
    expect(bad.unmatched).toHaveLength(1);
    expect(total(bad.events)).toBe(80);
  });

  it('a substance log normalises to its canonical exposure (ethanol from standard drinks)', () => {
    const e = { id: 'a1', date: '2026-10-18', tz: 'UTC', source: { by: 'user', method: 'typed' }, kind: 'substance', substance: 'alcohol', clockH: 20, amount: 2, unit: 'drinks' } as Extract<LogEntry, { kind: 'substance' }>;
    expect(substanceEventExposures(e)[0]).toMatchObject({ id: 'ethanol', value: 28, unit: 'g', coverage: 'complete' });
  });
});

describe('active ingredients (D7-04): label-based doses, peaks kept, scope explicit', () => {
  const fishOil: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'epaDha', amount: 500, unit: 'mg', basis: 'epaDha' }] };
  const vitDUnknown: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD', amount: null, unit: 'ug', basis: 'asLabelled' }] };
  const vitDWeekly: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD', amount: 1250, unit: 'ug', basis: 'asLabelled' }] };
  const mgCitrate: SupplementProduct = { servingAmount: 1, servingUnit: 'tablet', actives: [{ ingredient: 'magnesium', amount: 200, unit: 'mg', basis: 'elemental' }] };
  const supp = (id: string, product: SupplementProduct, servings: number) =>
    ({ id, date: '2026-10-18', tz: 'UTC', source: { by: 'user', method: 'typed' }, kind: 'supplement', supplementId: 'x', dose: servings, unit: product.servingUnit, servings, product }) as Extract<LogEntry, { kind: 'supplement' }>;
  const evt = (date: string, eventId: string, origin: 'food' | 'supplement', exposures: ExposureQuantity[]) => ({ eventId, date, origin, exposures });

  it('2 capsules × 500 mg EPA+DHA = 1 g with a known label', () => {
    const r = supplementEventExposures(supp('s1', fishOil, 2));
    expect(r.potency).toBe('known');
    expect(r.exposures[0]).toMatchObject({ id: 'epaDha', value: 1, unit: 'g' });
  });

  it('10 vitamin D capsules without potency are unchecked, never "no issues"', () => {
    const r = supplementEventExposures(supp('s1', vitDUnknown, 10));
    expect(r.potency).toBe('unknown');
    const s = ingredientExposureSummary([evt('2026-10-18', 's1', 'supplement', r.exposures)], 'vitD', { from: '2026-10-18', to: '2026-10-18' });
    expect(upperLimitCheck(s, { amount: 100, unit: 'ug', scope: 'total' }, { foodRecordComplete: true })).toMatchObject({ check: 'unchecked', reasonCode: 'potencyUnknown' });
  });

  it('a weekly vitamin D bolus keeps its peak and date; it is not passed by dividing by seven', () => {
    const doses = scheduledSupplementDoses(vitDWeekly, { kind: 'weekly', daysOfWeek: [0], from: '2026-10-12' }, { from: '2026-10-12', to: '2026-10-25' });
    expect(doses.map((d) => d.date)).toEqual(['2026-10-18', '2026-10-25']); // Sundays
    const s = ingredientExposureSummary(doses, 'vitD', { from: '2026-10-12', to: '2026-10-25' });
    expect(s.peakSupplementEvent).toMatchObject({ date: '2026-10-18', value: 1250 });
    expect(s.meanDaily.supplementalOnly.knownSum).toBeLessThan(200); // the mean is informational only
    const bolus = upperLimitCheck(s, { amount: 100, unit: 'ug', scope: 'supplementalOnly' }, { regimen: 'bolus' });
    expect(bolus.check).toBe('unchecked');
    expect(bolus.reasonCode).toBe('bolusRegimenReview');
    expect(upperLimitCheck(s, { amount: 100, unit: 'ug', scope: 'supplementalOnly' }).check).toBe('violation');
  });

  it('alternate-day dosing stays on its own dates', () => {
    const doses = scheduledSupplementDoses(mgCitrate, { kind: 'alternateDay', from: '2026-10-18' }, { from: '2026-10-18', to: '2026-10-23' });
    expect(doses.map((d) => d.date)).toEqual(['2026-10-18', '2026-10-20', '2026-10-22']);
  });

  it('supplemental-only magnesium excludes food; products sharing an ingredient aggregate; elemental kept', () => {
    const food: ExposureQuantity = { id: 'magnesium', value: 300, unit: 'mg', provenance: 'estimated', coverage: 'complete' };
    const a = supplementEventExposures(supp('s1', mgCitrate, 1)).exposures;
    const b = supplementEventExposures(supp('s2', mgCitrate, 1)).exposures;
    expect(a[0]!.form).toBe('elemental');
    const s = ingredientExposureSummary([evt('2026-10-18', 'm1', 'food', [food]), evt('2026-10-18', 's1', 'supplement', a), evt('2026-10-18', 's2', 'supplement', b)], 'magnesium', { from: '2026-10-18', to: '2026-10-18' });
    expect(s.daily[0]!.supplementalOnly.knownSum).toBe(400);
    expect(s.daily[0]!.total.knownSum).toBe(700);
    expect(upperLimitCheck(s, { amount: 350, unit: 'mg', scope: 'supplementalOnly' }).check).toBe('violation');
    expect(upperLimitCheck(ingredientExposureSummary([evt('2026-10-18', 's1', 'supplement', a)], 'magnesium', { from: '2026-10-18', to: '2026-10-18' }), { amount: 350, unit: 'mg', scope: 'supplementalOnly' }).check).toBe('passed');
    // a total-intake scope needs a complete food record to pass
    expect(upperLimitCheck(s, { amount: 5000, unit: 'mg', scope: 'total' }).check).toBe('unchecked');
    expect(upperLimitCheck(s, { amount: 5000, unit: 'mg', scope: 'total' }, { foodRecordComplete: true }).check).toBe('passed');
  });

  it('no dose in scope is not applicable (not a pass)', () => {
    const s = ingredientExposureSummary([], 'iron', { from: '2026-10-18', to: '2026-10-18' });
    expect(upperLimitCheck(s, { amount: 45, unit: 'mg', scope: 'supplementalOnly' }).check).toBe('notApplicable');
  });
});

describe('correlated uncertainty (D6-06): one mass draw moves every nutrient, systematic groups are shared', () => {
  const per100 = { energyKcal: 150, proteinG: 6, netCarbG: 20, fatG: 5, sodiumMg: 300 };

  it('a gram perturbation scales energy and every nutrient coherently; same inputs give the same output', () => {
    const comps = [{ componentId: '0', grams: 200, per100, uncertaintyGroupIds: ['portionMass:e1:0', 'sourceComposition:recipe:r1@v1'] }];
    const nominal = scenarioTotals(comps, {});
    const heavy = scenarioTotals(comps, { 'portionMass:e1:0': 1.25 });
    for (const id of ['energy', 'protein', 'carbAvailable', 'fat', 'sodium'] as const) expect(heavy[id]!.knownSum / nominal[id]!.knownSum).toBeCloseTo(1.25, 12);
    expect(scenarioTotals(comps, { 'portionMass:e1:0': 1.25 })).toEqual(heavy);
  });

  it('a shared recipe/source group moves every meal that used it; independent portions do not', () => {
    const day = [
      { componentId: 'a', grams: 200, per100, uncertaintyGroupIds: ['portionMass:e1:0', 'sourceComposition:recipe:r1@v1'] },
      { componentId: 'b', grams: 200, per100, uncertaintyGroupIds: ['portionMass:e2:0', 'sourceComposition:recipe:r1@v1'] },
    ];
    const nominal = scenarioTotals(day, {}).energy!.knownSum;
    expect(scenarioTotals(day, { 'sourceComposition:recipe:r1@v1': 1.2 }).energy!.knownSum).toBeCloseTo(nominal * 1.2, 9);
    expect(scenarioTotals(day, { 'portionMass:e1:0': 1.2 }).energy!.knownSum).toBeCloseTo(nominal * 1.1, 9);
  });

  it('repeated logs of the same recipe share one systematic group (it never shrinks like independent noise)', () => {
    const entry = (id: string) => ({ id, components: [{ uncertaintyGroupIds: [`portionMass:${id}:0`, 'sourceComposition:recipe:r1@v1', 'batchYield:recipe:r1@v1', 'reportingBias:person:household'] }] });
    const groups = uncertaintyGroupsOf([entry('e1'), entry('e2'), entry('e3')]);
    const shared = groups.find((g) => g.id === 'sourceComposition:recipe:r1@v1')!;
    expect(shared.memberIds).toEqual(['e1:0', 'e2:0', 'e3:0']);
    expect(groups.find((g) => g.id === 'reportingBias:person:household')!.memberIds).toHaveLength(3);
    expect(groups.filter((g) => g.kind === 'portionMass')).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------------------------------- re-audit W0/W1 */

describe('day nutrient sums over the union of meal identities (A1-023)', () => {
  type Comp = Parameters<typeof mealExposures>[0][number];
  const table = (e: number, per100g: Record<string, number | null>, grams = 100): Comp => ({ nutrients: N(e * (grams / 100), 0, 0, 0), source: 'table', grams, snapshot: { per100g: { energyKcal: e, proteinG: 0, netCarbG: 0, fatG: 0, fibreG: 0, ...per100g } } });
  const label = (e: number, extra: Partial<NutrientEstimate> = {}): Comp => ({ nutrients: { energyKcal: est(e), proteinG: est(0), carbG: est(0), fatG: est(0), fibreG: est(0), ...extra }, source: 'label' });
  const analysed = mealExposures([label(140, { sodiumMg: est(100), satFatG: est(2), sugarsG: est(5) })]);
  const unanalysed = mealExposures([label(140)]);

  it('a meal that does not analyse sodium makes the complete day partial (a lower bound), in either meal order', () => {
    for (const day of [[analysed, unanalysed], [unanalysed, analysed]]) {
      const s = sumExposures(day, 'complete');
      expect(s.sodium).toEqual({ knownSum: 100, unit: 'mg', coverage: 'partial' });
      expect(s.satFat).toEqual({ knownSum: 2, unit: 'g', coverage: 'partial' });
      expect(s.sugars).toEqual({ knownSum: 5, unit: 'g', coverage: 'partial' });
      expect(s.energy).toEqual({ knownSum: 280, unit: 'kcal', coverage: 'complete' });
    }
    // calcium from snapshots behaves the same
    const ca = mealExposures([table(116, { calciumMg: 19 }, 200)]);
    const noCa = mealExposures([table(130, {})]);
    expect(sumExposures([ca, noCa], 'complete').calcium).toMatchObject({ knownSum: 38, coverage: 'partial' });
    expect(sumExposures([noCa, ca], 'complete').calcium).toMatchObject({ knownSum: 38, coverage: 'partial' });
  });

  it('two explicit sodium-zero meals on a complete day stay a complete zero; unanalysed meals never become zero', () => {
    const zero = mealExposures([label(140, { sodiumMg: est(0) })]);
    expect(sumExposures([zero, zero], 'complete').sodium).toEqual({ knownSum: 0, unit: 'mg', coverage: 'complete' });
    // nobody analysed sodium: no statement at all (absent), never a zero
    expect(sumExposures([unanalysed, unanalysed], 'complete').sodium).toBeUndefined();
    // analysed as unknown in one meal and not analysed in the other: unknown, not partial and not zero
    const nulled: ExposureQuantity[] = [{ id: 'sodium', value: null, unit: 'mg', provenance: 'label', coverage: 'unknown' }];
    expect(sumExposures([nulled, unanalysed], 'complete').sodium).toEqual({ knownSum: 0, unit: 'mg', coverage: 'unknown' });
    expect(sumExposures([nulled, unanalysed], 'partial').sodium!.coverage).toBe('unknown');
  });

  it('split or merged, the same food events give the same lower bound; compatible units are normalised first', () => {
    const merged = mealExposures([label(140, { sodiumMg: est(100) }), label(140)]);
    expect(sumExposures([merged], 'complete').sodium).toEqual(sumExposures([analysed, unanalysed], 'complete').sodium);
    const grams: ExposureQuantity[] = [{ id: 'sodium', value: 0.2, unit: 'g' as never, provenance: 'label', coverage: 'complete' }];
    expect(sumExposures([analysed, grams], 'complete').sodium).toEqual({ knownSum: 300, unit: 'mg', coverage: 'complete' });
  });

  it('as-planned estimates and a confirmed zero day keep their own coverage', () => {
    const planned = mealExposures([label(500, { sodiumMg: est(400) })], { method: 'asPlanned' });
    expect(sumExposures([planned], 'partial').sodium!.coverage).toBe('asPlannedEstimate');
    expect(sumExposures([planned, unanalysed], 'complete').sodium!.coverage).toBe('partial');
    expect(sumExposures([], 'confirmedZero')).toEqual({});
  });
});

describe('polyol identities and their unmodelled route (A1-031)', () => {
  const comp = (per100g: Record<string, number | null>, grams = 100) => ({ nutrients: N(per100g.energyKcal ?? 0, 0, 0, 0), source: 'table' as const, grams, snapshot: { per100g } });
  const maltitol = comp({ energyKcal: 240, proteinG: 0, netCarbG: 0, fatG: 0, fibreG: 0, polyolsG: 60, 'polyolG:maltitol': 50 }, 50);
  const plain = comp({ energyKcal: 130, proteinG: 2.7, netCarbG: 28, fatG: 0.3, fibreG: 0.4 });

  it('identities and an identity-unknown remainder survive into the exposures without double counting the total', () => {
    const p = polyolsOf([maltitol, plain]);
    expect(p).toMatchObject({ totalG: 30, complete: true });
    expect(p!.byIdentity).toEqual({ maltitol: 25, unidentified: 5 });
    const xs = mealExposures([maltitol, plain]);
    const total = xs.filter((x) => x.id === 'polyols' && !isExposureBreakdown(x));
    expect(total).toHaveLength(1);
    expect(total[0]).toMatchObject({ lowerBound: 30, coverage: 'partial' }); // the rice did not analyse polyols
    // the rice leaves the total open, so each identity is a lower bound too
    expect(xs.filter(isExposureBreakdown).map((x) => [x.form, x.lowerBound, x.coverage])).toEqual([['identity:maltitol', 25, 'partial'], ['identity:unidentified', 5, 'partial']]);
    expect(mealExposures([maltitol]).filter(isExposureBreakdown).map((x) => [x.form, x.value])).toEqual([['identity:maltitol', 25], ['identity:unidentified', 5]]);
    expect(nutrientCoverageOf(xs).polyols).toBe('partial');
    expect(sumExposures([xs], 'complete').polyols).toMatchObject({ knownSum: 30 });
  });

  it('a consistent energy ledger does not certify the polyol route: substrate readouts are unknown or a named scenario', () => {
    const ledger = mealEnergyLedger(N(120, 0, 0, 0), [maltitol]);
    expect(ledger.status).toBe('consistent');
    expect(ledger.substrateRoute).toEqual({ status: 'unmodelled', unmodelledPolyolsG: { maltitol: 25, unidentified: 5 } });
    expect(substrateOutputStatus(ledger)).toBe('unknown');
    expect(substrateOutputStatus(ledger, true)).toBe('scenario');
    // no polyols: a consistent ledger stays estimated, as before
    expect(substrateOutputStatus(mealEnergyLedger(N(130, 2.7, 28, 0.3, 0.4), [plain]))).toBe('estimated');
  });

  it('the stored-entry reader carries the identities and the route for the realised history (energy unchanged)', () => {
    const entry = {
      totals: N(120, 0, 0, 0), source: { by: 'user', method: 'typed' }, energy: undefined,
      components: [{ name: 'chocolate', grams: est(50), nutrients: N(120, 0, 0, 0), nutrientSource: 'table', carbBasis: 'totalByDifference', snapshot: { source: 'food', per100g: maltitol.snapshot.per100g } }],
    } as unknown as Parameters<typeof readMealIntake>[0];
    const r = readMealIntake(entry);
    expect(r.energyKcal).toBe(120);
    expect(r.macros.carbG).toBe(0); // the non-polyol available carbohydrate, unchanged
    expect(r.polyolsG).toEqual({ maltitol: 25, unidentified: 5 });
    expect(r.polyolBasis).toEqual({ inPrintedCarb: true, energyConvention: 'insideReportedME' });
    expect(r.substrateRoute?.status).toBe('unmodelled');
  });
});

describe('unknown recipe removals carry upper bounds, never lower bounds (A1-042)', () => {
  it('a snapshot upper bound becomes the exposure upper bound; the value stays unknown', () => {
    const recipe = { nutrients: { energyKcal: est(0), proteinG: est(5), carbG: est(20), fatG: est(0), fibreG: est(1), unknown: ['energyKcal', 'fatG'] }, source: 'recipe' as const, grams: 100, snapshot: { per100g: { energyKcal: null, proteinG: 5, netCarbG: 20, fatG: null, fibreG: 1, satFatG: null, 'upper:energyKcal': 300, 'upper:fatG': 15, 'upper:satFatG': 9 } } };
    const xs = mealExposures([recipe as never]);
    expect(xs.find((x) => x.id === 'energy')).toMatchObject({ value: null, upperBound: 300, coverage: 'unknown' });
    expect(xs.find((x) => x.id === 'fat')).toMatchObject({ value: null, upperBound: 15 });
    expect(xs.find((x) => x.id === 'fat')).not.toHaveProperty('lowerBound');
    expect(aggregateSnapshots([{ componentId: '0', per100: recipe.snapshot.per100g, edibleG: 100 }]).satFat).toMatchObject({ completeness: 'unknown', upperBound: 9 });
  });
});
