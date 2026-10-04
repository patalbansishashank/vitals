/**
 * Deterministic portion-fit solver and day tolerance check (R4 §3.4, SUITE_SPEC §8.3). The model proposes foods with
 * raw grams; this scales each flexible item within 0.5–1.6× of its proposed grams (oil and ghee ≤ 15 g per meal) by
 * weighted least squares toward the slot's targets with a proximity term, rounds to 5 g, and checks the day:
 * energy ±5 % (at least ±75 kcal), protein −5 %/+20 %, carbohydrate ±10 % (or ≤ target + 5 g on low-carbohydrate
 * days), fat ±15 %, fibre ≥ −10 %.
 */
import { mealTotals } from '@/catalogues';
import type { FoodTable, MealTotals } from '@/catalogues/types';
import type { MealSlotTarget } from './rules';

export interface PlanItem {
  foodId: string;
  grams: number;
  /** false = keep the proposed grams (e.g. one egg). Default true. */
  flexible?: boolean;
  role?: string;
  name?: string;
}

export interface MealFit {
  slot: string;
  items: Array<PlanItem & { gramsProposed: number }>;
  totals: MealTotals;
  /** SUITE_SPEC §8.3 `PortionFitResult`. */
  fit: { grams: Record<string, number>; totals: Record<'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG', number>; withinTolerance: boolean; deltas: Record<string, number>; binding: string[] };
}

export interface Deviation {
  nutrient: 'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG';
  target: number;
  actual: number;
  /** (actual − target) / target, rounded to 0.1 %. */
  deltaPct: number;
  ok: boolean;
  /** Allowed range. */
  allowed: [number, number];
}

const LO = 0.5;
const HI = 1.6;
const OIL_MAX_G = 15;
const LAMBDA = 0.05;
const r1 = (x: number): number => Math.round(x * 10) / 10;

type Vec = [number, number, number, number];
const vecOf = (t: MealTotals): Vec => [t.energyKcal, t.proteinG, t.netCarbG, t.fatG];

/** Fit one meal's items to its slot target. */
export function fitMeal(items: readonly PlanItem[], target: MealSlotTarget, table: FoodTable): MealFit {
  const T: Vec = [Math.max(target.energyKcal, 50), Math.max(target.proteinG, 5), Math.max(target.carbG, 5), Math.max(target.fatG, 5)];
  const W: Vec = [4, 3, target.lowCarbDay ? 4 : 1, 1];
  const a: Vec[] = items.map((it) => vecOf(mealTotals([{ foodId: it.foodId, grams: it.grams }], table)));
  const isOil = items.map((it) => table.get(it.foodId)?.group === 'fats');
  const oilG = items.reduce((s, it, i) => s + (isOil[i] ? it.grams : 0), 0);
  const bounds = items.map((it, i): [number, number] => {
    if (it.flexible === false) return [1, 1];
    const hi = isOil[i] && oilG > 0 ? Math.min(HI, OIL_MAX_G / oilG) : HI;
    return [Math.min(LO, hi), hi];
  });
  const s = items.map((_, i) => Math.min(Math.max(1, bounds[i]![0]), bounds[i]![1]));
  for (let sweep = 0; sweep < 200; sweep++) {
    let moved = 0;
    for (let i = 0; i < items.length; i++) {
      let num = LAMBDA;
      let den = LAMBDA;
      for (let k = 0; k < 4; k++) {
        let R = -T[k]!;
        for (let j = 0; j < items.length; j++) if (j !== i) R += s[j]! * a[j]![k]!;
        const wk = W[k]! / (T[k]! * T[k]!);
        num -= wk * a[i]![k]! * R;
        den += wk * a[i]![k]! * a[i]![k]!;
      }
      const next = Math.min(bounds[i]![1], Math.max(bounds[i]![0], num / den));
      moved = Math.max(moved, Math.abs(next - s[i]!));
      s[i] = next;
    }
    if (moved < 1e-6) break;
  }
  const fitted = items.map((it, i) => ({ ...it, gramsProposed: it.grams, grams: it.flexible === false ? it.grams : Math.max(5, Math.round((it.grams * s[i]!) / 5) * 5) }));
  const totals = mealTotals(fitted, table);
  const binding = fitted.flatMap((it, i) => (it.flexible !== false && (s[i]! <= bounds[i]![0] + 1e-6 || s[i]! >= bounds[i]![1] - 1e-6) ? [it.foodId] : []));
  const fit: MealFit['fit'] = {
    grams: Object.fromEntries(fitted.map((it) => [it.foodId, it.grams])),
    totals: { energyKcal: r1(totals.energyKcal), proteinG: r1(totals.proteinG), carbG: r1(totals.netCarbG), fatG: r1(totals.fatG), fibreG: r1(totals.fibreG) },
    withinTolerance: false,
    deltas: {
      energyKcal: r1(totals.energyKcal - target.energyKcal),
      proteinG: r1(totals.proteinG - target.proteinG),
      carbG: r1(totals.netCarbG - target.carbG),
      fatG: r1(totals.fatG - target.fatG),
    },
    binding,
  };
  return { slot: target.slot, items: fitted, totals, fit };
}

/** Day tolerances over the planned slots (sum of their targets vs the fitted totals). */
export function checkDay(fits: readonly MealFit[], targets: readonly MealSlotTarget[]): { ok: boolean; deviations: Deviation[] } {
  const sum = (f: (t: MealSlotTarget) => number) => targets.reduce((s, t) => s + f(t), 0);
  const got = (f: (t: MealTotals) => number) => fits.reduce((s, m) => s + f(m.totals), 0);
  const low = targets.some((t) => t.lowCarbDay);
  const dev = (nutrient: Deviation['nutrient'], target: number, actual: number, allowed: [number, number]): Deviation => ({
    nutrient,
    target: r1(target),
    actual: r1(actual),
    deltaPct: target > 0 ? Math.round(((actual - target) / target) * 1000) / 10 : 0,
    ok: actual >= allowed[0] - 1e-9 && actual <= allowed[1] + 1e-9,
    allowed: [r1(allowed[0]), r1(allowed[1])],
  });
  const E = sum((t) => t.energyKcal);
  const P = sum((t) => t.proteinG);
  const C = sum((t) => t.carbG);
  const F = sum((t) => t.fatG);
  const eTol = Math.max(0.05 * E, 75);
  const out: Deviation[] = [
    dev('energyKcal', E, got((t) => t.energyKcal), [E - eTol, E + eTol]),
    dev('proteinG', P, got((t) => t.proteinG), [0.95 * P, 1.2 * P]),
    dev('carbG', C, got((t) => t.netCarbG), low ? [0, C + 5] : [C - Math.max(0.1 * C, 5), C + Math.max(0.1 * C, 5)]),
    dev('fatG', F, got((t) => t.fatG), [F - Math.max(0.15 * F, 3), F + Math.max(0.15 * F, 3)]),
  ];
  const fib = targets.every((t) => t.fibreG !== undefined) ? sum((t) => t.fibreG ?? 0) : 0;
  if (fib > 0) out.push(dev('fibreG', fib, got((t) => t.fibreG), [0.9 * fib, Number.POSITIVE_INFINITY]));
  return { ok: out.every((d) => d.ok), deviations: out };
}

const WORDS: Readonly<Record<Deviation['nutrient'], string>> = { energyKcal: 'energy', proteinG: 'protein', carbG: 'carbohydrate', fatG: 'fat', fibreG: 'fibre' };
const UNIT: Readonly<Record<Deviation['nutrient'], string>> = { energyKcal: 'kcal', proteinG: 'g', carbG: 'g', fatG: 'g', fibreG: 'g' };

/** Plain repair hints for a model round ("protein is 18 % low (92 of 112 g): add a protein food or more of …"). */
export function repairHints(deviations: readonly Deviation[]): string[] {
  return deviations
    .filter((d) => !d.ok)
    .map((d) => {
      const lowSide = d.actual < d.allowed[0];
      const what = `${WORDS[d.nutrient]} is ${Math.abs(d.deltaPct)} % ${lowSide ? 'low' : 'high'} (${Math.round(d.actual)} of ${Math.round(d.target)} ${UNIT[d.nutrient]})`;
      const fix =
        d.nutrient === 'proteinG' ? (lowSide ? 'add a lean protein food (paneer, curd, eggs, chicken, dal)' : 'swap some protein food for vegetables')
        : d.nutrient === 'fatG' ? (lowSide ? 'add a little fat (nuts, ghee, oil)' : 'use less oil, ghee or full-fat foods')
        : d.nutrient === 'carbG' ? (lowSide ? 'add a starch (rice, roti, fruit)' : 'use less rice, roti or sugar')
        : d.nutrient === 'fibreG' ? 'add vegetables, dal or whole grains'
        : lowSide ? 'use larger portions or add a dish' : 'use smaller portions or drop a dish';
      return `${what}: ${fix}.`;
    });
}
