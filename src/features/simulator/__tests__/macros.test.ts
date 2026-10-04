import { describe, expect, it } from 'vitest';
import type { DayTemplate, MacroSpec } from '@/engine';
import {
  availableKcal,
  changeUnit,
  gramsFromShares,
  gramsToUnit,
  kcalOf,
  redistribute,
  remainderKey,
  unitToGrams,
  writeMacros,
  type MacroGrams,
  type MacroRefs,
} from '../lib/macros';
import { resolveTemplate } from '../lib/resolve';
import { A, RP } from './fixtures';

const refs: MacroRefs = { energyKcal: 2200, bodyMassKg: 88, ffmKg: 66, fibreG: 18, alcoholG: 0 };
const grams: MacroGrams = { protein: 176, carbs: 140, fat: (availableKcal(refs) - 4 * 176 - 4 * 140) / 9 };
const none = new Set<'protein' | 'carbs' | 'fat'>();

describe('macro redistribution holds energy constant', () => {
  it.each([
    ['protein', 220],
    ['protein', 90],
    ['carbs', 30],
    ['carbs', 260],
    ['fat', 40],
    ['fat', 120],
  ] as const)('moving %s to %d g keeps kcal', (key, g) => {
    const r = redistribute(grams, key, g, none, refs);
    expect(kcalOf(r.grams)).toBeCloseTo(availableKcal(refs), 6);
    expect(r.grams[key]).toBeCloseTo(g, 6);
    for (const k of ['protein', 'carbs', 'fat'] as const) expect(r.grams[k]).toBeGreaterThanOrEqual(0);
  });

  it('spreads the difference over the unlocked others by energy share', () => {
    const r = redistribute(grams, 'protein', 196, none, refs); // +80 kcal
    const cK = 4 * grams.carbs;
    const fK = 9 * grams.fat;
    expect(4 * grams.carbs - 4 * r.grams.carbs).toBeCloseTo((80 * cK) / (cK + fK), 6);
    expect(9 * grams.fat - 9 * r.grams.fat).toBeCloseTo((80 * fK) / (cK + fK), 6);
  });

  it('respects locks and caps at what the unlocked macros can give', () => {
    const locked = new Set<'protein' | 'carbs' | 'fat'>(['carbs']);
    const r = redistribute(grams, 'protein', 1000, locked, refs);
    expect(r.capped).toBe(true);
    expect(r.grams.carbs).toBe(grams.carbs);
    expect(r.grams.fat).toBeCloseTo(0, 6);
    expect(kcalOf(r.grams)).toBeCloseTo(availableKcal(refs), 6);
    const all = new Set<'protein' | 'carbs' | 'fat'>(['carbs', 'fat']);
    const r2 = redistribute(grams, 'protein', 300, all, refs);
    expect(r2.grams).toEqual(grams);
  });
});

describe('unit conversions', () => {
  it.each(['g', 'gPerKgBw', 'gPerKgFfm', 'pctEnergy'] as const)('grams ↔ %s round-trips', (u) => {
    for (const key of ['protein', 'carbs', 'fat'] as const) {
      const v = gramsToUnit(key, 123.4, u, refs);
      expect(unitToGrams(key, v, u, refs)).toBeCloseTo(123.4, 9);
    }
  });

  it('g/kg and % energy match the engine convention', () => {
    expect(gramsToUnit('protein', 176, 'gPerKgBw', refs)).toBeCloseTo(2, 9);
    expect(gramsToUnit('fat', 100, 'pctEnergy', refs)).toBeCloseTo((900 / 2200) * 100, 9);
    expect(unitToGrams('carbs', 50, 'pctEnergy', refs)).toBeCloseTo(275, 9);
  });

  it('changing a unit never changes the grams the engine resolves', () => {
    const t: DayTemplate = structuredClone(A);
    const r0 = resolveTemplate(t, RP);
    const g: MacroGrams = { protein: r0.proteinG, carbs: r0.carbG, fat: r0.fatG };
    const R: MacroRefs = {
      energyKcal: r0.energyKcal,
      bodyMassKg: RP.weightKg,
      ffmKg: RP.ffm0Kg,
      fibreG: r0.fibreG,
      alcoholG: r0.alcoholG,
    };
    for (const [key, unit] of [
      ['protein', 'g'],
      ['protein', 'pctEnergy'],
      ['protein', 'gPerKgFfm'],
      ['carbs', 'pctEnergy'],
      ['carbs', 'gPerKgBw'],
      ['fat', 'g'],
      ['carbs', 'remainder'],
    ] as const) {
      const m = changeUnit(t.macros, key, unit, g, R);
      const r1 = resolveTemplate({ ...t, macros: m }, RP);
      expect(r1.proteinG).toBeCloseTo(g.protein, 0);
      expect(r1.carbG).toBeCloseTo(g.carbs, 0);
      expect(r1.fatG).toBeCloseTo(g.fat, 0);
      expect(r1.energyKcal).toBeCloseTo(r0.energyKcal, 6);
      expect([m.protein, m.carbs, m.fat].filter((a) => a.unit === 'remainder')).toHaveLength(1);
    }
  });

  it('written macros resolve through compileSchedule to the same energy (the remainder absorbs rounding)', () => {
    const t: DayTemplate = structuredClone(A);
    const r0 = resolveTemplate(t, RP);
    const g: MacroGrams = { protein: r0.proteinG, carbs: r0.carbG, fat: r0.fatG };
    const R: MacroRefs = {
      energyKcal: r0.energyKcal,
      bodyMassKg: RP.weightKg,
      ffmKg: RP.ffm0Kg,
      fibreG: r0.fibreG,
      alcoholG: r0.alcoholG,
    };
    const moved = redistribute(g, 'protein', 230, new Set(), R);
    const m: MacroSpec = writeMacros(t.macros, moved.grams, R);
    expect(remainderKey(m)).toBe('fat');
    const r1 = resolveTemplate({ ...t, macros: m }, RP);
    expect(r1.energyKcal).toBeCloseTo(r0.energyKcal, 6);
    expect(r1.proteinG).toBeCloseTo(230, 0);
    expect(r1.notes).toHaveLength(0);
  });

  it('triangle shares → grams fill the available energy', () => {
    const g = gramsFromShares({ protein: 0.3, carbs: 0.4, fat: 0.3 }, refs);
    expect(kcalOf(g)).toBeCloseTo(availableKcal(refs), 6);
    expect((4 * g.protein) / availableKcal(refs)).toBeCloseTo(0.3, 9);
  });
});
