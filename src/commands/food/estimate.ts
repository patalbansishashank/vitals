/**
 * Meal estimates: components with grams → nutrients from the food table (or a transcribed label / the person's numbers)
 * with uncertainty bands. The model never states nutrient numbers; this is the only place meal nutrients are computed
 * (R4 decision 1, SUITE_SPEC §5 photo pipeline, R8 §6.3).
 *
 * Bands: per component σ² = (per-gram nutrient · σ_g)² + (value · 10 % table error)², σ_g = (gramsHigh − gramsLow)/3.3;
 * the meal's σ is the root sum of squares, floored by the source's display band (R8 §6.3, ± ≈ 1 SD shown as a range):
 * photo only ±35/40/50/55 % (energy/carbohydrate/protein/fat), photo + text ±20/25/30/30, user grams ±15/15/20/25,
 * household units ±20/20/25/30, weighed or label ±8/8/10/10, free text without amounts ±30/30/35/45; gravies, curries,
 * fried and restaurant food ×1.3 on energy and fat, ×1.15 on the rest.
 */
import { mealTotals } from '@/catalogues';
import type { FoodTable, MealTotals } from '@/catalogues/types';
import type { Est, MealComponent, NutrientEstimate } from '@/living';
import type { AmountKind } from './parse';

export type BandKind = 'photoOnly' | 'photoText' | 'userGrams' | 'household' | 'weighed' | 'text';
type Macro = 'energy' | 'carb' | 'protein' | 'fat';

export const BAND_FLOORS: Readonly<Record<BandKind, Readonly<Record<Macro, number>>>> = {
  photoOnly: { energy: 0.35, carb: 0.4, protein: 0.5, fat: 0.55 },
  photoText: { energy: 0.2, carb: 0.25, protein: 0.3, fat: 0.3 },
  userGrams: { energy: 0.15, carb: 0.15, protein: 0.2, fat: 0.25 },
  household: { energy: 0.2, carb: 0.2, protein: 0.25, fat: 0.3 },
  weighed: { energy: 0.08, carb: 0.08, protein: 0.1, fat: 0.1 },
  text: { energy: 0.3, carb: 0.3, protein: 0.35, fat: 0.45 },
};
const TABLE_ERROR = 0.1;
const FATTY = /fried|fry|curry|gravy|restaurant|takeaway|tadka|deep/i;

/** Per-100 g values the arithmetic uses (net carbohydrate, engine convention). */
export type Per100 = MealTotals;

/** A component ready to compute: grams plus where its per-100 g values come from. */
export interface ResolvedComponent {
  name: string;
  localName?: string;
  foodId?: string;
  recipeId?: string;
  grams: number;
  gramsLow: number;
  gramsHigh: number;
  portion?: { unit: string; count: number };
  amount: AmountKind | 'label';
  cookingMethod?: string;
  visibleFatCue?: 'none' | 'some' | 'glossy' | 'pooled';
  /** Per-100 g values when known (table food, recipe, label); absent = unresolved. */
  per100?: Per100;
  nutrientSource?: MealComponent['nutrientSource'];
  /** Identification confidence 0–1 (name match × model confidence). */
  idConfidence: number;
  band: BandKind;
}

/** A value with its band (± ≈ 1 SD). */
export interface Banded {
  value: number;
  sd: number;
  low: number;
  high: number;
}
export interface BandedTotals {
  energyKcal: Banded;
  proteinG: Banded;
  /** Net (available) carbohydrate, g. */
  carbG: Banded;
  fatG: Banded;
  fibreG: Banded;
}

export interface MealEstimate {
  components: Array<ResolvedComponent & { nutrients?: BandedTotals; confidence: number }>;
  totals: BandedTotals;
  /** Energy-weighted identification × amount confidence, 0–1. */
  confidence: number;
  /** Indices of components below 0.7 confidence. */
  lowConfidence: number[];
  /** Indices of components without nutrient values (no food match, no label). */
  unresolved: number[];
}

const AMOUNT_CONF: Readonly<Record<ResolvedComponent['amount'], number>> = { weighed: 1, label: 1, household: 0.9, count: 0.9, default: 0.7 };

/** Per-100 g values of a table food. */
export function per100OfFood(foodId: string, table: FoodTable): Per100 | undefined {
  return table.get(foodId) ? mealTotals([{ foodId, grams: 100 }], table) : undefined;
}

const LABEL_KEYS = ['energyKcal', 'proteinG', 'fatG', 'carbG'] as const;

/** Per-100 g values of a transcribed label (needs energy, protein, fat and carbohydrate); null when incomplete. */
export function per100OfLabel(label: Record<string, unknown>): Per100 | null {
  for (const k of LABEL_KEYS) if (typeof label[k] !== 'number' || !Number.isFinite(label[k] as number) || (label[k] as number) < 0) return null;
  const n = (k: string): number => (typeof label[k] === 'number' ? (label[k] as number) : 0);
  return { energyKcal: n('energyKcal'), proteinG: n('proteinG'), netCarbG: Math.max(0, n('carbG') - n('fibreG')), fatG: n('fatG'), fibreG: n('fibreG'), satFatG: n('satFatG') };
}

/** Per-100 g values of a recipe (raw ingredient grams; the dish's weight is taken as the sum of its ingredients). */
export function per100OfRecipe(ingredients: ReadonlyArray<{ foodId: string; gramsRaw: number }>, table: FoodTable): Per100 | undefined {
  const known = ingredients.filter((i) => table.get(i.foodId));
  const total = known.reduce((s, i) => s + i.gramsRaw, 0);
  if (known.length !== ingredients.length || total <= 0) return undefined;
  const t = mealTotals(known.map((i) => ({ foodId: i.foodId, grams: i.gramsRaw })), table);
  const k = 100 / total;
  return { energyKcal: t.energyKcal * k, proteinG: t.proteinG * k, netCarbG: t.netCarbG * k, fatG: t.fatG * k, fibreG: t.fibreG * k, satFatG: t.satFatG * k };
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const banded = (value: number, sd: number): Banded => ({ value: r1(value), sd: r1(sd), low: r1(Math.max(0, value - sd)), high: r1(value + sd) });

const KEYS: ReadonlyArray<readonly [keyof BandedTotals, keyof Per100, Macro]> = [
  ['energyKcal', 'energyKcal', 'energy'],
  ['proteinG', 'proteinG', 'protein'],
  ['carbG', 'netCarbG', 'carb'],
  ['fatG', 'fatG', 'fat'],
  ['fibreG', 'fibreG', 'carb'],
];

function floorOf(c: ResolvedComponent, m: Macro): number {
  const base = BAND_FLOORS[c.band][m];
  const fatty = (c.cookingMethod && FATTY.test(c.cookingMethod)) || c.visibleFatCue === 'glossy' || c.visibleFatCue === 'pooled';
  return fatty ? base * (m === 'energy' || m === 'fat' ? 1.3 : 1.15) : base;
}

/** Compute a meal: nutrients = grams × per-100 g values, with bands and confidence. Unresolved components add nothing. */
export function estimateMeal(components: readonly ResolvedComponent[]): MealEstimate {
  const acc = Object.fromEntries(KEYS.map(([k]) => [k, { v: 0, var: 0, floor: 0 }])) as Record<keyof BandedTotals, { v: number; var: number; floor: number }>;
  const out: MealEstimate['components'] = [];
  const unresolved: number[] = [];
  components.forEach((c, i) => {
    const conf = Math.max(0, Math.min(1, c.idConfidence * AMOUNT_CONF[c.amount]));
    if (!c.per100) {
      unresolved.push(i);
      out.push({ ...c, confidence: 0 });
      return;
    }
    const sigmaG = Math.max(0, c.gramsHigh - c.gramsLow) / 3.3;
    const n = {} as BandedTotals;
    for (const [k, pk, m] of KEYS) {
      const perG = c.per100[pk] / 100;
      const v = perG * c.grams;
      const sd = Math.sqrt((perG * sigmaG) ** 2 + (v * TABLE_ERROR) ** 2);
      const floor = floorOf(c, m) * v;
      n[k] = banded(v, Math.max(sd, floor));
      acc[k].v += v;
      acc[k].var += sd * sd;
      acc[k].floor += floor;
    }
    out.push({ ...c, nutrients: n, confidence: conf });
  });
  const totals = Object.fromEntries(KEYS.map(([k]) => [k, banded(acc[k].v, Math.max(Math.sqrt(acc[k].var), acc[k].floor))])) as unknown as BandedTotals;
  const weights = out.map((c) => Math.max(0, c.nutrients?.energyKcal.value ?? 0));
  const wsum = weights.reduce((s, w) => s + w, 0);
  let confidence = out.length === 0 ? 0 : wsum > 0 ? out.reduce((s, c, i) => s + c.confidence * weights[i]!, 0) / wsum : out.reduce((s, c) => s + c.confidence, 0) / out.length;
  if (unresolved.length > 0) confidence = Math.min(confidence, 0.39);
  return {
    components: out,
    totals,
    confidence: Math.round(confidence * 100) / 100,
    lowConfidence: out.flatMap((c, i) => (c.confidence < 0.7 ? [i] : [])),
    unresolved,
  };
}

const est = (b: Banded): Est => ({ value: b.value, sd: b.sd });

/** The log entry's `NutrientEstimate` of banded totals (carbohydrate = net, engine convention). */
export function toNutrientEstimate(t: BandedTotals): NutrientEstimate {
  return { energyKcal: est(t.energyKcal), proteinG: est(t.proteinG), carbG: est(t.carbG), fatG: est(t.fatG), fibreG: est(t.fibreG) };
}

/** The log entry's components (resolved ones only). */
export function toMealComponents(e: MealEstimate): MealComponent[] {
  return e.components
    .filter((c) => c.nutrients)
    .map((c) => ({
      name: c.name,
      ...(c.localName ? { localName: c.localName } : {}),
      ...(c.foodId ? { foodId: c.foodId } : {}),
      ...(c.recipeId ? { recipeId: c.recipeId } : {}),
      grams: { value: c.grams, sd: r1(Math.max(0, c.gramsHigh - c.gramsLow) / 3.3) },
      ...(c.cookingMethod ? { cookingMethod: c.cookingMethod } : {}),
      ...(c.visibleFatCue ? { visibleFatCue: c.visibleFatCue } : {}),
      nutrients: toNutrientEstimate(c.nutrients!),
      nutrientSource: c.nutrientSource ?? 'table',
    }));
}
