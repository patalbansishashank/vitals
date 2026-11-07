// @vitest-environment node
/**
 * The meal nutrient/energy provider (`@/lib/nutrientExposure`, C3/D6-02): ledger statuses, MCT/alcohol counted once, the
 * legacy kcal-only read adapter (zeros that cannot reproduce the energy read as unknown; genuine zeros stay), exposure
 * sums with day-level coverage (meal completeness is never day completeness), and per-100 g labels with unknown fields.
 */
import { describe, expect, it } from 'vitest';
import { conventionEnergyKcal, type ExposureQuantity } from '@/lib/bodyContracts';
import { compositionLedger, knownTermsKcal, legacyUnknownFields, macroGramsOf, mealExposures, readMealIntake, substrateOutputStatus, sumExposures } from '@/lib/nutrientExposure';
import type { LogEntry, MealComponent, NutrientEstimate } from '@/living';
import { estimateMeal, per100OfLabel, toNutrientEstimate, type ResolvedComponent } from '../estimate';

type Meal = Extract<LogEntry, { kind: 'meal' }>;
const est = (v: number) => ({ value: v, sd: 0 });
const nutrients = (e: number, p: number, c: number, f: number, fib = 0, extra: Partial<NutrientEstimate> = {}): NutrientEstimate => ({ energyKcal: est(e), proteinG: est(p), carbG: est(c), fatG: est(f), fibreG: est(fib), ...extra });
const component = (n: NutrientEstimate, source: MealComponent['nutrientSource']): MealComponent => ({ name: 'x', grams: est(100), nutrients: n, nutrientSource: source });
const legacyMeal = (n: NutrientEstimate, source: MealComponent['nutrientSource'], method: Meal['source']['method'] = 'typed'): Meal =>
  ({ id: 'e1', date: '2026-10-01', tz: 'UTC', source: { by: 'user', method }, kind: 'meal', clockH: 12, components: [component(n, source)], totals: n }) as Meal;

describe('energy ledger', () => {
  it('MCT is a subset of fat and alcohol is counted once', () => {
    const m = { proteinG: 0, carbAvailableG: 0, fatG: 10, mctG: 4, fibreG: 0, ethanolG: 14 };
    expect(conventionEnergyKcal(m)).toBeCloseTo(9 * 6 + 8.3 * 4 + 7 * 14, 9);
    expect(knownTermsKcal(m)).toBeCloseTo(9 * 6 + 8.3 * 4 + 7 * 14, 9);
    // MCT can never exceed total fat
    expect(conventionEnergyKcal({ ...m, mctG: 12 })).toBeNull();
    const drink = compositionLedger({ reportedKcal: 98, macros: { proteinG: 0, carbAvailableG: 0, fatG: 0, fibreG: 0, ethanolG: 14 }, source: 'label' });
    expect(drink).toMatchObject({ conventionMEKcal: 98, residualKcal: 0, status: 'consistent' });
    // an estimate with alcohol: the ethanol term enters once, from alcoholG
    const n = nutrients(98, 0, 0, 0, 0, { alcoholG: est(14) });
    expect(macroGramsOf(n, 'unknown').ethanolG).toBe(14);
  });

  it('table/recipe residuals are reconciliation; typed numbers beyond the tolerance are a conflict; a known lower bound above energy is a conflict', () => {
    const table = compositionLedger({ reportedKcal: 300, macros: { proteinG: 10, carbAvailableG: 60, fatG: 5, fibreG: 4, ethanolG: 0 }, source: 'table' });
    expect(table.status).toBe('consistent');
    expect(table.residualKcal).toBeCloseTo(300 - (40 + 240 + 45 + 8), 9);
    const typed = compositionLedger({ reportedKcal: 300, macros: { proteinG: 10, carbAvailableG: 60, fatG: 5, fibreG: 4, ethanolG: 0 }, source: 'user' });
    expect(typed.status).toBe('conflict');
    const within = compositionLedger({ reportedKcal: 340, macros: { proteinG: 10, carbAvailableG: 60, fatG: 5, fibreG: 4, ethanolG: 0 }, source: 'label' });
    expect(within.status).toBe('consistent');
    // unknown fibre/ethanol cannot rescue 400 kcal of protein inside a 100 kcal entry
    const partial = compositionLedger({ reportedKcal: 100, macros: { proteinG: 100, carbAvailableG: null, fatG: null, fibreG: null, ethanolG: null }, source: 'user' });
    expect(partial.status).toBe('conflict');
    expect(partial.reconciledMEKcal).toBe(100);
  });

  it('partial typed numbers within label rounding are energy-only, not a conflict (120 kcal with 30.4 g protein)', () => {
    const l = compositionLedger({ reportedKcal: 120, macros: { proteinG: 30.4, carbAvailableG: null, fatG: null, fibreG: null, ethanolG: null }, source: 'label' });
    expect(l).toMatchObject({ status: 'energyOnly', reportedMEKcal: 120, reconciledMEKcal: 120 });
  });

  it("the app's own numbers (table, recipe, the plan's frozen meal) reconcile a residual of either sign, never a conflict", () => {
    // a recipe serving at specific factors, fibre not carried: 4P + 4C + 9F = 325 kcal above the 250 kcal the source gives
    const macros = { proteinG: 10, carbAvailableG: 60, fatG: 5, fibreG: null, ethanolG: null };
    for (const source of ['table', 'recipe', 'asPlanned'] as const) expect(compositionLedger({ reportedKcal: 250, macros, source }).status).toBe('energyOnly');
    expect(compositionLedger({ reportedKcal: 250, macros: { ...macros, fibreG: 4, ethanolG: 0 }, source: 'asPlanned' })).toMatchObject({ status: 'consistent', residualKcal: 250 - 333 });
    // the same numbers typed by the person disagree with themselves
    expect(compositionLedger({ reportedKcal: 250, macros, source: 'user' }).status).toBe('conflict');
    // read back: energy below the known grams is reconciliation, never unallocated substrate
    const n = nutrients(250, 10, 60, 5, 0, { unknown: ['fibreG'] });
    const planned = readMealIntake(legacyMeal(n, 'user', 'asPlanned'));
    expect(planned).toMatchObject({ energyKcal: 250, residualKind: 'reconciliation' });
    expect(planned.unexplainedKcal).toBeCloseTo(-75, 9);
  });
});

describe('substrate readout status (C6)', () => {
  it('unknown macros make substrate readouts Unknown (Scenario only with a declared allocation); a conflict is Review', () => {
    expect(substrateOutputStatus({ status: 'consistent' })).toBe('estimated');
    expect(substrateOutputStatus({ status: 'energyOnly' })).toBe('unknown');
    expect(substrateOutputStatus({ status: 'energyOnly' }, true)).toBe('scenario');
    expect(substrateOutputStatus({ status: 'conflict' })).toBe('review');
    expect(substrateOutputStatus({ status: 'energyUnknown' })).toBe('unknown');
  });
});

describe('legacy kcal-only adapter (migration: read, never rewrite)', () => {
  it('zeros that cannot reproduce the reported energy are unknown; zeros consistent with it stay genuine zeros', () => {
    const old = nutrients(600, 30, 0, 0, 0);
    expect(legacyUnknownFields(component(old, 'user'))).toEqual(['carbG', 'fatG', 'fibreG']);
    const intake = readMealIntake(legacyMeal(old, 'user'));
    expect(intake).toMatchObject({ energyKcal: 600, macros: { proteinG: 30 }, legacy: true, residualKind: 'unallocated' });
    expect(intake.legacyUnknown).toEqual(['carbG', 'fatG', 'fibreG']);
    expect(intake.ledger.status).toBe('energyOnly');

    const genuine = nutrients(120, 30, 0, 0, 0);
    expect(legacyUnknownFields(component(genuine, 'user'))).toEqual([]);
    expect(readMealIntake(legacyMeal(genuine, 'user')).macros).toEqual({ proteinG: 30, carbG: 0, fatG: 0, fibreG: 0 });

    // table entries are never reinterpreted (their zeros are the source's analysis)
    const tableZero = nutrients(350, 0, 0, 0, 0);
    expect(legacyUnknownFields(component(tableZero, 'table'))).toEqual([]);
  });

  it('a legacy complete table entry keeps every gram and its energy', () => {
    const n = nutrients(369, 19.5, 63, 3, 8);
    const intake = readMealIntake(legacyMeal(n, 'table'));
    expect(intake.energyKcal).toBe(369);
    expect(intake.macros).toEqual({ proteinG: 19.5, carbG: 63, fatG: 3, fibreG: 8 });
    expect(intake.ledger.status).toBe('consistent');
  });
});

describe('exposures and day sums', () => {
  const comps = (n: NutrientEstimate, source: 'table' | 'user') => [{ nutrients: n, source }];

  it('an unknown field is null with the known partial sum as a lower bound', () => {
    const a = nutrients(300, 20, 30, 10, 3);
    const b: NutrientEstimate = { ...nutrients(400, 10, 0, 0, 0), unknown: ['carbG', 'fatG', 'fibreG'] };
    const x = Object.fromEntries(mealExposures([...comps(a, 'table'), ...comps(b, 'user')]).map((q) => [q.id, q]));
    expect(x.energy).toMatchObject({ value: 700, coverage: 'complete' });
    expect(x.protein).toMatchObject({ value: 30, coverage: 'complete' });
    expect(x.carbAvailable).toMatchObject({ value: null, lowerBound: 30, coverage: 'partial', form: 'availableCarbohydrate' });
  });

  it('meal completeness is not day completeness: a nutrient is complete only on an attested complete day', () => {
    const m1: ExposureQuantity[] = [{ id: 'protein', value: 30, unit: 'g', provenance: 'reported', coverage: 'complete' }];
    const m2: ExposureQuantity[] = [{ id: 'protein', value: null, lowerBound: 5, unit: 'g', provenance: 'reported', coverage: 'partial' }];
    expect(sumExposures([m1], 'partial').protein).toEqual({ knownSum: 30, unit: 'g', coverage: 'partial' });
    expect(sumExposures([m1], 'complete').protein!.coverage).toBe('complete');
    expect(sumExposures([m1, m2], 'complete').protein).toEqual({ knownSum: 35, unit: 'g', coverage: 'partial' });
    expect(sumExposures([m1], 'unknown').protein!.coverage).toBe('partial');
    expect(sumExposures([], 'confirmedZero')).toEqual({});
  });
});

describe('labels with unknown fields', () => {
  it('energy alone is a label; unknown fields never become measured zeros in a meal total', () => {
    const l = per100OfLabel({ energyKcal: 500, proteinG: 20 })!;
    expect(l.unknown).toEqual(expect.arrayContaining(['netCarbG', 'fatG', 'fibreG', 'satFatG']));
    const known: ResolvedComponent = { name: 'dal', grams: 100, gramsLow: 90, gramsHigh: 110, amount: 'weighed', per100: { energyKcal: 116, proteinG: 9, netCarbG: 12, fatG: 0.4, fibreG: 8, satFatG: 0 }, idConfidence: 1, band: 'userGrams' };
    const partial: ResolvedComponent = { name: 'bar', grams: 50, gramsLow: 50, gramsHigh: 50, amount: 'label', per100: l, idConfidence: 1, band: 'weighed' };
    const e = estimateMeal([known, partial]);
    expect(e.totals.energyKcal.value).toBeCloseTo(116 + 250, 6);
    expect(e.totals.proteinG.value).toBeCloseTo(9 + 10, 6);
    expect(e.totals.unknown).toEqual(expect.arrayContaining(['carbG', 'fatG', 'fibreG']));
    expect(e.totals.carbG.value).toBe(0); // placeholder for legacy readers; the known part is a lower bound
    expect(e.lowerBounds).toMatchObject({ carbG: 12 });
    expect(toNutrientEstimate(e.totals).unknown).toEqual(expect.arrayContaining(['carbG', 'fatG', 'fibreG']));
  });

  it('carbohydrate basis: available is used as is; declared total subtracts fibre once (no fibre → unknown); undeclared is unknown; the legacy arithmetic only through its explicit adapter', () => {
    expect(per100OfLabel({ energyKcal: 200, carbG: 20, fibreG: 10 }, 'available')!.netCarbG).toBe(20);
    expect(per100OfLabel({ energyKcal: 200, carbG: 30, fibreG: 10 }, 'totalByDifference')!.netCarbG).toBe(20);
    expect(per100OfLabel({ energyKcal: 200, carbG: 30 }, 'totalByDifference')!.unknown).toContain('netCarbG');
    // A1-024: a new label without a declared basis keeps the printed 30 g and its energy; available carbohydrate is unknown
    const undeclared = per100OfLabel({ energyKcal: 200, carbG: 30, fibreG: 10 })!;
    expect(undeclared.unknown).toContain('netCarbG');
    expect(undeclared.extra?.carbG).toBe(30);
    expect(undeclared.energyKcal).toBe(200);
    expect(per100OfLabel({ energyKcal: 200, carbG: 30, fibreG: 10 }, 'legacyTotalByDifference')!.netCarbG).toBe(20);
    // no energy: every macro needed with a resolved carbohydrate basis, energy is then the convention energy; an undeclared
    // basis leaves available carbohydrate unknown, so no energy is manufactured (A1-024)
    expect(per100OfLabel({ proteinG: 10, carbG: 20, fatG: 5 }, 'available')!.energyKcal).toBeCloseTo(40 + 80 + 45, 9);
    expect(per100OfLabel({ proteinG: 10, carbG: 20, fatG: 5 })).toBeNull();
    expect(per100OfLabel({ proteinG: 10, carbG: 20 })).toBeNull();
    expect(per100OfLabel({ energyKcal: Number.NaN })).toBeNull();
  });
});
