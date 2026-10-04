/**
 * Food reference interface and meal arithmetic (R4 §2.4, §4.3). The curated IFCT/USDA bundle is a later data task
 * (docs/CATALOGUES.md); this module defines the contract every table implements, plus the deterministic arithmetic the
 * app uses so the model never states nutrient totals (R4 decision 1).
 */
import { matchScore } from './text';
import type { FoodRecord, FoodTable, MealTotals, Nutrients } from './types';

/** An in-memory `FoodTable` over records (ids must be unique). */
export function createFoodTable(records: readonly FoodRecord[], version: string): FoodTable {
  const byId = new Map<string, FoodRecord>();
  for (const r of records) {
    if (byId.has(r.id)) throw new Error(`duplicate food id ${r.id}`);
    byId.set(r.id, r);
  }
  const all = [...records];
  return {
    version,
    get: (id) => byId.get(id),
    all: () => all,
    search(query, limit = 10) {
      return all
        .map((r) => ({ r, s: matchScore(query, [r.name, ...r.aliases]) }))
        .filter((x) => x.s > 0.2)
        .sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id))
        .slice(0, limit)
        .map((x) => x.r);
    },
  };
}

/** Net (available) carbohydrate per 100 g: carbohydrate by difference minus fibre (engine convention). */
export function netCarbPer100g(n: Readonly<Nutrients>): number {
  return Math.max(0, n.carbG - (n.fibreG ?? 0));
}

const ZERO: MealTotals = { energyKcal: 0, proteinG: 0, netCarbG: 0, fatG: 0, fibreG: 0, satFatG: 0 };

/** Totals of a list of components (grams of edible portion). Unknown food ids throw: the caller resolves names first. */
export function mealTotals(components: ReadonlyArray<{ foodId: string; grams: number }>, table: FoodTable): MealTotals {
  const t = { ...ZERO };
  for (const c of components) {
    const f = table.get(c.foodId);
    if (!f) throw new Error(`unknown food ${c.foodId}`);
    const k = Math.max(0, c.grams) / 100;
    const n = f.per100g;
    t.energyKcal += n.energyKcal * k;
    t.proteinG += n.proteinG * k;
    t.netCarbG += netCarbPer100g(n) * k;
    t.fatG += n.fatG * k;
    t.fibreG += (n.fibreG ?? 0) * k;
    t.satFatG += (n.satFatG ?? 0) * k;
  }
  return t;
}

/** R4 §4.3 log-input kinds and their σ_log for energy (PROPOSED parameters, basis in R4 §4.1). */
export const LOG_SIGMA = {
  weighed: { sigma: 0.08, fatMult: 1.0 },
  household: { sigma: 0.2, fatMult: 1.0 },
  textNoAmounts: { sigma: 0.35, fatMult: 1.05 },
  photoOnly: { sigma: 0.3, fatMult: 1.1 },
  photoText: { sigma: 0.22, fatMult: 1.05 },
} as const;
export type LogInputKind = keyof typeof LOG_SIGMA;

/**
 * R4 §4.3 band of a logged amount: lognormal around the point estimate, p10/p90 = E·exp(∓1.2816σ); restaurant food
 * adds 0.10 to σ. Protein σ = 0.8·σ, fat σ = 1.3·σ, carbohydrate σ = σ.
 */
export function logBand(
  value: number,
  kind: LogInputKind,
  nutrient: 'energy' | 'protein' | 'carb' | 'fat' = 'energy',
  restaurant = false,
): { p10: number; p50: number; p90: number; sigmaLog: number; confidence: 'high' | 'medium' | 'low' } {
  const base = LOG_SIGMA[kind].sigma + (restaurant ? 0.1 : 0);
  const sigma = nutrient === 'protein' ? 0.8 * base : nutrient === 'fat' ? 1.3 * base : base;
  const z = 1.2816;
  return {
    p10: value * Math.exp(-z * sigma),
    p50: value,
    p90: value * Math.exp(z * sigma),
    sigmaLog: sigma,
    confidence: base <= 0.12 ? 'high' : base <= 0.25 ? 'medium' : 'low',
  };
}
