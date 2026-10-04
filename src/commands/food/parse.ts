/**
 * Deterministic meal-text parser (`food.parse`, no AI): splits a typed description into components, reads quantities
 * ("2 eggs", "150 g rice", "1 katori dal", "half cup milk", "2 rotis") and matches names (local names included) against
 * the food table. Grams carry a range whose width says how the amount was known (weighed > household > count > none).
 */
import type { FoodRecord, FoodTable } from '@/catalogues/types';
import { matchScore, normName } from '@/catalogues/text';

/** How an amount was known; drives the gram range here and the nutrient bands in `./estimate.ts`. */
export type AmountKind = 'weighed' | 'household' | 'count' | 'default';

export interface ParsedComponent {
  name: string;
  localName?: string;
  foodId?: string;
  grams: number;
  gramsLow: number;
  gramsHigh: number;
  portion?: { unit: string; count: number };
  /** 0–1 name match against the food table (0 = no match). */
  matchScore: number;
  amount: AmountKind;
  /** The text this component came from. */
  source: string;
}

/** Relative half-width of the gram range per amount kind. */
export const GRAM_SPREAD: Readonly<Record<AmountKind, number>> = { weighed: 0.05, household: 0.25, count: 0.15, default: 0.5 };

/** Default grams of household units when the food has no matching portion (ICMR-NIN katori ≈ 150 mL, R8 §6.4). */
const UNITS: ReadonlyArray<{ words: readonly string[]; unit: string; g: number; match?: string }> = [
  { words: ['katori', 'katoris', 'katori s', 'vati', 'bowl', 'bowls'], unit: 'katori', g: 150, match: 'katori' },
  { words: ['cup', 'cups'], unit: 'cup', g: 240, match: 'cup' },
  { words: ['glass', 'glasses'], unit: 'glass', g: 200, match: 'glass' },
  { words: ['tbsp', 'tablespoon', 'tablespoons'], unit: 'tbsp', g: 15 },
  { words: ['tsp', 'teaspoon', 'teaspoons', 'chammach', 'spoon', 'spoons'], unit: 'tsp', g: 5, match: 'tsp' },
  { words: ['plate', 'plates'], unit: 'plate', g: 250 },
  { words: ['slice', 'slices'], unit: 'slice', g: 30 },
  { words: ['piece', 'pieces', 'pc', 'pcs'], unit: 'piece', g: 0 },
  { words: ['handful', 'handfuls', 'mutthi'], unit: 'handful', g: 30 },
];
const MASS: Readonly<Record<string, number>> = { g: 1, gm: 1, gms: 1, gram: 1, grams: 1, gr: 1, kg: 1000, ml: 1, l: 1000, oz: 28.35 };
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, quarter: 0.25, couple: 2, few: 3, ek: 1, do: 2, teen: 3, char: 4, aadha: 0.5, dozen: 12,
};
/** Countable foods named by their unit ("2 rotis"): the table name to look up and grams per piece when it has no portion. */
const COUNT_FOODS: ReadonlyArray<{ words: readonly string[]; query: readonly string[]; g: number }> = [
  { words: ['roti', 'rotis', 'chapati', 'chapatis', 'chapatti', 'phulka', 'phulkas', 'fulka'], query: ['roti', 'chapati', 'atta'], g: 25 },
  { words: ['paratha', 'parathas'], query: ['paratha', 'atta'], g: 40 },
  { words: ['idli', 'idlis'], query: ['idli'], g: 40 },
  { words: ['dosa', 'dosas'], query: ['dosa'], g: 80 },
];
const FILLER = new Set(['of', 'some', 'little', 'bit', 'small', 'big', 'medium', 'large', 'cooked', 'boiled', 'plain', 'fresh', 'the', 'with', 'my', 'had', 'ate', 'i']);
const SIZE: Readonly<Record<string, number>> = { small: 0.7, medium: 1, large: 1.3, big: 1.3 };

const round = (g: number): number => Math.round(g * 10) / 10;

/** Split a description into component phrases (commas, "and", "+", "with", new lines, semicolons). */
export function splitMeal(text: string): string[] {
  return text
    .split(/[,;\n+&]|\band\b|\bwith\b|\baur\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Best table match of a name: the record, its score and the alias that matched (a local name). */
export function matchFood(name: string, table: FoodTable): { food: FoodRecord; score: number; alias?: string } | null {
  const q = name.trim();
  if (!q) return null;
  let best: { food: FoodRecord; score: number; alias?: string } | null = null;
  for (const f of table.search(q, 10)) {
    const s = matchScore(q, [f.name, ...f.aliases]);
    if (!best || s > best.score) {
      const alias = f.aliases.find((a) => matchScore(q, [a]) >= s);
      best = { food: f, score: s, ...(alias ? { alias } : {}) };
    }
  }
  return best && best.score > 0.2 ? best : null;
}

function portionGrams(food: FoodRecord | undefined, match: string | undefined): number | null {
  if (!food || !match) return null;
  const p = food.portions.find((x) => normName(x.label).includes(match));
  return p ? p.g : null;
}

function readNumber(tok: string): number | null {
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
  const frac = /^(\d+)\/(\d+)$/.exec(tok);
  if (frac) return Number(frac[1]) / Math.max(1, Number(frac[2]));
  return NUMBER_WORDS[tok] ?? null;
}

/** One phrase → a component. */
export function parsePhrase(phrase: string, table: FoodTable): ParsedComponent {
  // "150g" → "150 g", "1.5kg" → "1.5 kg", "2x" → "2"
  const norm = phrase
    .toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\bx\b/g, ' ')
    .replace(/[^a-z0-9./ ]+/g, ' ')
    .trim();
  const toks = norm.split(/\s+/).filter(Boolean);
  let count: number | null = null;
  let mass: number | null = null;
  let unit: (typeof UNITS)[number] | null = null;
  let size = 1;
  const rest: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const n = readNumber(t);
    if (n !== null && count === null && mass === null) {
      const next = toks[i + 1];
      if (next && MASS[next] !== undefined) {
        mass = n * MASS[next]!;
        i++;
        continue;
      }
      count = n;
      continue;
    }
    if (n !== null && count !== null && t !== 'a' && t !== 'an') {
      count += n; // "1 1/2"
      continue;
    }
    const u = UNITS.find((x) => x.words.includes(t));
    if (u && !unit) {
      unit = u;
      continue;
    }
    if (SIZE[t] !== undefined) size = SIZE[t]!;
    if (FILLER.has(t)) continue;
    rest.push(t);
  }
  const name = rest.join(' ').trim() || norm;
  const countFood = COUNT_FOODS.find((c) => rest.some((w) => c.words.includes(w)));
  let m = matchFood(name, table);
  if ((!m || m.score < 0.9) && countFood) {
    for (const q of countFood.query) {
      const alt = matchFood(q, table);
      if (alt && (!m || alt.score * 0.9 > m.score)) m = { ...alt, score: alt.score * 0.9 };
      if (alt) break;
    }
  }
  const food = m?.food;
  const n = count ?? 1;
  let grams: number;
  let amount: AmountKind;
  let portion: ParsedComponent['portion'];
  if (mass !== null) {
    grams = mass;
    amount = 'weighed';
  } else if (unit) {
    const per = portionGrams(food, unit.match) ?? (unit.unit === 'piece' ? (food?.portions[0]?.g ?? 50) : unit.g);
    grams = n * per;
    amount = 'household';
    portion = { unit: unit.unit, count: n };
  } else if (countFood && (!food || !food.portions.some((p) => /roti|chapati|piece|paratha|idli|dosa/.test(normName(p.label))))) {
    grams = n * countFood.g * size;
    amount = 'count';
    portion = { unit: countFood.words[0]!, count: n };
  } else if (count !== null) {
    grams = n * (food?.portions[0]?.g ?? 100) * size;
    amount = 'count';
    portion = { unit: food?.portions[0]?.label ?? 'piece', count: n };
  } else {
    grams = (food?.portions[0]?.g ?? 100) * size;
    amount = 'default';
  }
  const spread = GRAM_SPREAD[amount];
  const local = m?.alias && normName(m.alias) !== normName(food!.name) ? name : undefined;
  return {
    name: food?.name ?? name,
    ...(local ? { localName: local } : {}),
    ...(food ? { foodId: food.id } : {}),
    grams: round(grams),
    gramsLow: round(grams * (1 - spread)),
    gramsHigh: round(grams * (1 + spread)),
    ...(portion ? { portion } : {}),
    matchScore: Math.round((m?.score ?? 0) * 100) / 100,
    amount,
    source: phrase.trim(),
  };
}

/** A whole description → components (catalogue parser; deterministic). */
export function parseMeal(text: string, table: FoodTable): ParsedComponent[] {
  return splitMeal(text).map((p) => parsePhrase(p, table));
}

/** Grams of a `{unit, count}` portion of a food (household units, the food's own portions, countable foods). */
export function gramsOfPortion(portion: { unit: string; count: number }, food: FoodRecord | undefined): { grams: number; amount: AmountKind } {
  const u = normName(portion.unit);
  if (MASS[u] !== undefined) return { grams: portion.count * MASS[u]!, amount: 'weighed' };
  const own = food?.portions.find((p) => normName(p.label).includes(u));
  if (own) return { grams: portion.count * own.g, amount: 'household' };
  const hh = UNITS.find((x) => x.words.includes(u) || x.unit === u);
  if (hh) return { grams: portion.count * (hh.g || food?.portions[0]?.g || 50), amount: 'household' };
  const cf = COUNT_FOODS.find((c) => c.words.includes(u));
  if (cf) return { grams: portion.count * cf.g, amount: 'count' };
  return { grams: portion.count * (food?.portions[0]?.g ?? 100), amount: 'count' };
}
