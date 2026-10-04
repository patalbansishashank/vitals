/**
 * Groceries (design/screens/living-mode.md, Food › Groceries): the ingredients of the accepted recipes over a horizon
 * (today · 3 days · week), grouped by aisle, in buy units, with "already have" marks from the pantry.
 *
 * `GrocerySource` is the seam; `inMemoryGrocerySource` derives the list from Food's meal-plan store.
 * TODO(E4/E8): implement `GrocerySource` over `food.groceryList` (aggregation from `mealPlans`, the food table's
 * aisles and pack sizes, the pantry in `intake.kitchen`) and install it with `<GrocerySourceContext.Provider>`.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { addDays, compareDates } from '@/living/dates';
import { loadCatalogueModules, prescribedDays, type CatalogueModules } from '@/commands/catalogue/setup';
import { getDocumentStore } from '@/state/runtime';
import type { LocalDate } from '@/living';
import { formatNumber } from '@/components';
import { foodRefOf, labelOf, toPantryDoc } from '@/catalogues/kitchen';
import { kitchenNow, loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { useFoodStore, type BudgetTier } from './mealPlanStore';

export type Aisle = 'vegetables' | 'dairy' | 'staples' | 'protein' | 'spices';
export const AISLES: readonly Aisle[] = ['vegetables', 'dairy', 'staples', 'protein', 'spices'];

export type GroceryHorizon = 'today' | '3days' | 'week';
export const HORIZON_DAYS: Readonly<Record<GroceryHorizon, number>> = { today: 1, '3days': 3, week: 7 };

/** The date span of a horizon starting on `from`. */
export function horizonSpan(from: LocalDate, h: GroceryHorizon): { from: LocalDate; to: LocalDate } {
  return { from, to: addDays(from, HORIZON_DAYS[h] - 1) };
}

/** Small static aisle map (keyword → aisle); anything else is a vegetable or fruit. */
const AISLE_WORDS: ReadonlyArray<readonly [Aisle, readonly string[]]> = [
  ['dairy', ['paneer', 'curd', 'dahi', 'milk', 'ghee', 'butter', 'cheese', 'yoghurt', 'yogurt']],
  ['protein', ['chana', 'rajma', 'dal', 'moong', 'tofu', 'soy', 'egg', 'chicken', 'fish', 'sprouts', 'lentil']],
  ['staples', ['atta', 'rice', 'oats', 'poha', 'besan', 'flour', 'bread', 'oil', 'sugar', 'jaggery']],
  ['spices', ['jeera', 'haldi', 'turmeric', 'masala', 'chilli powder', 'salt', 'mustard seed', 'hing', 'cumin']],
];

export function aisleOf(name: string): Aisle {
  const n = name.toLowerCase();
  for (const [aisle, words] of AISLE_WORDS) if (words.some((w) => n.includes(w))) return aisle;
  return 'vegetables';
}

/** Pack sizes for common items (grams per pack, label). */
const PACKS: ReadonlyArray<readonly [string, number, string]> = [
  ['paneer', 200, '200 g pack'],
  ['curd', 400, '400 g tub'],
  ['milk', 500, '500 mL pouch'],
  ['tofu', 200, '200 g pack'],
  ['atta', 1000, '1 kg'],
  ['rice', 1000, '1 kg'],
  ['oats', 500, '500 g'],
  ['moong dal', 500, '500 g'],
  ['chana (dry)', 500, '500 g'],
  ['rajma (dry)', 500, '500 g'],
  ['roasted chana', 200, '200 g pack'],
  ['oil', 1000, '1 L bottle'],
  ['ghee', 200, '200 g jar'],
];
const SPICE_PACK = '100 g pack';

function grams(g: number): string {
  return g >= 1000 ? `${formatNumber(g / 1000, 1)} kg` : `${formatNumber(Math.ceil(g / 50) * 50, 0)} g`;
}

/** Buy units: "paneer 200 g pack × 2", "eggs × 12", "atta 1 kg", "tomato 300 g". */
export function buyUnit(name: string, g: number): string {
  const n = name.toLowerCase();
  if (n === 'egg' || n === 'eggs') return `eggs × ${Math.max(6, Math.ceil(g / 50 / 6) * 6)}`;
  const pack = PACKS.find(([k]) => n === k || n.startsWith(`${k} `));
  if (pack) {
    const count = Math.max(1, Math.ceil(g / pack[1]));
    return `${name} ${pack[2]}${count > 1 ? ` × ${count}` : ''}`;
  }
  if (aisleOf(n) === 'spices') return `${name} ${SPICE_PACK}`;
  return `${name} ${grams(g)}`;
}

export interface GroceryItem {
  /** Stable key (lowercase name). */
  key: string;
  name: string;
  aisle: Aisle;
  /** Total raw grams needed over the horizon. */
  grams: number;
  buy: string;
  dates: LocalDate[];
  /** Marked "already have" (pantry). */
  have: boolean;
  /** Ticked as bought. */
  bought: boolean;
}

export interface GroceryList {
  from: LocalDate;
  to: LocalDate;
  groups: Array<{ aisle: Aisle; items: GroceryItem[] }>;
  /** Items on the list (all aisles). */
  count: number;
}

/** A name for matching: lowercase, without brackets, before any comma ("Spinach, raw" and "Spinach (palak)" → "spinach"). */
function baseName(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, ' ').split(',')[0]!.replace(/\s+/g, ' ').trim();
}
const bareFoodId = (id: string): string => id.replace(/^food[:_]/, '');

/** Aggregate accepted meals' ingredients into a grocery list (pure). */
export function buildGroceryList(
  meals: ReadonlyArray<{ planId: string; date: LocalDate; recipe: { ingredients: ReadonlyArray<{ name: string; grams: number; foodId?: string }> } }>,
  o: {
    planId: string;
    from: LocalDate;
    to: LocalDate;
    /** Names marked "already have" (Food's marks and the pantry document's items). */
    pantry: readonly string[];
    /** Food ids of the pantry document's items. */
    pantryFoods?: readonly string[];
    /** Item keys un-marked on the list although the pantry holds them. */
    notHave?: readonly string[];
    bought: readonly string[];
  },
): GroceryList {
  const byKey = new Map<string, { name: string; grams: number; dates: Set<LocalDate>; foodIds: Set<string> }>();
  for (const m of meals) {
    if (m.planId !== o.planId || compareDates(m.date, o.from) < 0 || compareDates(m.date, o.to) > 0) continue;
    for (const ing of m.recipe.ingredients) {
      const key = ing.name.trim().toLowerCase();
      const cur = byKey.get(key) ?? { name: ing.name.trim(), grams: 0, dates: new Set<LocalDate>(), foodIds: new Set<string>() };
      cur.grams += Math.max(0, ing.grams);
      cur.dates.add(m.date);
      if (ing.foodId) cur.foodIds.add(bareFoodId(ing.foodId));
      byKey.set(key, cur);
    }
  }
  const pantry = new Set(o.pantry.map((p) => p.trim().toLowerCase()));
  const pantryBase = new Set(o.pantry.map(baseName).filter(Boolean));
  const pantryFoods = new Set((o.pantryFoods ?? []).map(bareFoodId));
  const notHave = new Set(o.notHave ?? []);
  const atHome = (key: string, v: { name: string; foodIds: Set<string> }): boolean =>
    !notHave.has(key) && (pantry.has(key) || pantryBase.has(baseName(v.name)) || [...v.foodIds].some((id) => pantryFoods.has(id)));
  const bought = new Set(o.bought);
  const items: GroceryItem[] = [...byKey.entries()]
    .map(([key, v]) => ({ key, name: v.name, aisle: aisleOf(v.name), grams: v.grams, buy: buyUnit(v.name, v.grams), dates: [...v.dates].sort(), have: atHome(key, v), bought: bought.has(key) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = AISLES.map((aisle) => ({ aisle, items: items.filter((i) => i.aisle === aisle) })).filter((g) => g.items.length > 0);
  return { from: o.from, to: o.to, groups, count: items.length };
}

/** Plain-text list for Share and the clipboard. */
export function groceryText(list: GroceryList, o: { header: string; aisleName: (a: Aisle) => string; haveWord: string }): string {
  const lines = [o.header];
  for (const g of list.groups) {
    lines.push('', o.aisleName(g.aisle));
    for (const i of g.items) lines.push(`- ${i.buy}${i.have ? ` (${o.haveWord})` : ''}`);
  }
  return lines.join('\n');
}

export interface BudgetAnswer {
  tier: BudgetTier | null;
  /** "Ask me later" was chosen. */
  deferred: boolean;
}

export interface GrocerySource {
  /** The list for the plan's accepted meals between `from` and `to` (inclusive). */
  list(q: { planId: string; from: LocalDate; to: LocalDate }): GroceryList;
  setBought(itemKey: string, bought: boolean): void;
  /** Pantry: mark an ingredient as already at home. */
  setHave(name: string, have: boolean): void;
  pantry(): readonly string[];
  budget(): BudgetAnswer;
  setBudget(tier: BudgetTier | 'later'): void;
  subscribe(listener: () => void): () => void;
  /** Changes identity whenever anything above changes. */
  version(): unknown;
}

/** The in-memory stand-in over Food's meal-plan store. */
export const inMemoryGrocerySource: GrocerySource = {
  list: (q) => {
    const s = useFoodStore.getState();
    return buildGroceryList(Object.values(s.accepted), { ...q, pantry: s.pantry, notHave: s.notHave, bought: s.bought });
  },
  setBought: (k, b) => useFoodStore.getState().setBought(k, b),
  setHave: (n, h) => useFoodStore.getState().setPantry(n, h),
  pantry: () => useFoodStore.getState().pantry,
  budget: () => useFoodStore.getState().budget,
  setBudget: (t) => useFoodStore.getState().setBudget(t),
  subscribe: (l) => useFoodStore.subscribe(l),
  version: () => useFoodStore.getState(),
};

/* ------------------------------------------------------------------ the document-backed source */

interface MealPlanBody {
  meals?: Array<{ slot?: string; recipeId?: string }>;
  groceries?: Array<{ foodId?: string; grams?: number }>;
}
interface RecipeBody {
  title?: string;
  servings?: number;
  ingredients?: Array<{ foodId?: string; gramsRaw?: number }>;
}

let modules: CatalogueModules | null = null;
const foodNames = new Map<string, string>();
const loadedListeners = new Set<() => void>();
let loading = false;

let kitchenLoading = false;

function ensureFoodNames(): void {
  if (!kitchenNow() && !kitchenLoading) {
    kitchenLoading = true;
    void loadKitchen().then(
      () => {
        for (const l of [...loadedListeners]) l();
      },
      () => {
        kitchenLoading = false;
      },
    );
  }
  if (modules || loading) return;
  loading = true;
  void loadCatalogueModules().then(
    (m) => {
      modules = m;
      for (const f of m.content.FOOD_FIXTURE) foodNames.set(f.id, f.name);
      for (const l of [...loadedListeners]) l();
    },
    () => undefined,
  );
}

/** A food id → its name: the reference foods and the person's own, else the id made readable. */
function foodName(id: string): string {
  const own = foodNames.get(id);
  if (own) return own;
  return id.replace(/^(food|user)[:_]/, '').replace(/[_-]+/g, ' ').trim() || id;
}

function userFoods(): void {
  if (!modules) return;
  try {
    const docs = getDocumentStore().peekAll<Record<string, unknown>>('catalogueCustom') as Array<Record<string, unknown>>;
    for (const f of modules.cat.parseUserItems(docs, modules.content.SEED_CATALOGUE).catalogue.foods) foodNames.set(f.id, f.name);
  } catch {
    /* names fall back to ids */
  }
}

/**
 * What the pantry document (`pantry/me`, written by `pantry.add` from the picker, Food and the Coach) holds: the
 * items' names and the food ids they link to. Before the kitchen catalogue loads only the person's own labels and
 * the ids made readable are known.
 */
export function pantryFromDocs(): { names: string[]; foodIds: string[] } {
  const out = { names: [] as string[], foodIds: [] as string[] };
  let raw: unknown;
  try {
    raw = getDocumentStore().peek<Record<string, unknown>>('pantry', 'me');
  } catch {
    return out;
  }
  if (!raw) return out;
  const cat = kitchenNow()?.cat ?? null;
  for (const p of toPantryDoc(raw).items) {
    out.names.push(labelOf(cat, p.id, p.label));
    if (!cat) out.names.push(p.id.replace(/^(pa|st|custom)[.:]/, '').replace(/[_-]+/g, ' '));
    const fixtureId = cat ? foodRefOf(cat, p.id)?.fixtureId : undefined;
    if (fixtureId) out.foodIds.push(fixtureId);
  }
  return out;
}

/**
 * The meals the person's saved meal plans hold over a span: per day the plan's own grocery lines, else its recipes'
 * ingredients. Days outside the running plan are left out. Nothing saved → an empty list (the caller falls back).
 */
export function mealsFromDocs(q: { planId: string; from: LocalDate; to: LocalDate }): Array<{ planId: string; date: LocalDate; recipe: { ingredients: Array<{ name: string; grams: number; foodId?: string }> } }> {
  const out: Array<{ planId: string; date: LocalDate; recipe: { ingredients: Array<{ name: string; grams: number; foodId?: string }> } }> = [];
  let store;
  try {
    store = getDocumentStore();
  } catch {
    return out;
  }
  userFoods();
  const dates: LocalDate[] = [];
  for (let d = q.from; compareDates(d, q.to) <= 0 && dates.length < 31; d = addDays(d, 1)) dates.push(d);
  const inPlan = prescribedDays(dates, Intl.DateTimeFormat().resolvedOptions().timeZone);
  for (const date of dates) {
    if (inPlan.plan && inPlan.days.get(date) === null) continue;
    const doc = store.peek<MealPlanBody>('mealPlans', date);
    if (!doc) continue;
    let lines: Array<{ name: string; grams: number; foodId: string }> = (doc.groceries ?? []).filter((g) => g.foodId && Number(g.grams) > 0).map((g) => ({ name: foodName(g.foodId!), grams: Number(g.grams), foodId: g.foodId! }));
    if (lines.length === 0) {
      for (const m of doc.meals ?? []) {
        const r = m.recipeId ? store.peek<RecipeBody>('recipes', m.recipeId) : null;
        const servings = r?.servings && r.servings > 0 ? r.servings : 1;
        for (const ing of r?.ingredients ?? []) if (ing.foodId && Number(ing.gramsRaw) > 0) lines.push({ name: foodName(ing.foodId), grams: Number(ing.gramsRaw) / servings, foodId: ing.foodId });
      }
      lines = lines.filter((l) => l.grams > 0);
    }
    if (lines.length > 0) out.push({ planId: q.planId, date, recipe: { ingredients: lines } });
  }
  return out;
}

/**
 * The app's source: the saved meal plans (`mealPlans`/`recipes`) over the running plan's days, with the meals accepted
 * on Food in this session standing in for any day that has none saved. Pantry, bought marks and the budget stay in
 * Food's store; items in the pantry document count as already at home. No saved plans and nothing accepted → an empty list.
 */
export const documentGrocerySource: GrocerySource = {
  list: (q) => {
    ensureFoodNames();
    const s = useFoodStore.getState();
    const docs = mealsFromDocs(q);
    const have = new Set(docs.map((m) => m.date));
    const session = Object.values(s.accepted).filter((m) => !have.has(m.date));
    const kept = pantryFromDocs();
    return buildGroceryList([...docs, ...session], { ...q, pantry: [...s.pantry, ...kept.names], pantryFoods: kept.foodIds, notHave: s.notHave, bought: s.bought });
  },
  setBought: (k, b) => useFoodStore.getState().setBought(k, b),
  setHave: (n, h) => useFoodStore.getState().setPantry(n, h),
  pantry: () => useFoodStore.getState().pantry,
  budget: () => useFoodStore.getState().budget,
  setBudget: (t) => useFoodStore.getState().setBudget(t),
  subscribe: (l) => {
    ensureFoodNames();
    loadedListeners.add(l);
    const offFood = useFoodStore.subscribe(l);
    let offDocs: () => void = () => undefined;
    try {
      offDocs = getDocumentStore().subscribe((c) => {
        if (c.col === 'mealPlans' || c.col === 'recipes' || c.col === 'catalogueCustom' || c.col === 'pantry') {
          docsVersion++;
          l();
        }
      });
    } catch {
      /* no store yet */
    }
    return () => {
      loadedListeners.delete(l);
      offFood();
      offDocs();
    };
  },
  version: () => {
    const food = useFoodStore.getState();
    const loaded = modules !== null && kitchenNow() !== null;
    if (!lastVersion || lastVersion.food !== food || lastVersion.docs !== docsVersion || lastVersion.loaded !== loaded) lastVersion = { food, docs: docsVersion, loaded };
    return lastVersion;
  },
};
let docsVersion = 0;
let lastVersion: { food: unknown; docs: number; loaded: boolean } | null = null;

export const GrocerySourceContext = createContext<GrocerySource>(documentGrocerySource);

export function useGrocerySource(): GrocerySource {
  return useContext(GrocerySourceContext);
}

/** The source's version (re-renders on change). */
export function useGroceryVersion(src: GrocerySource): unknown {
  return useSyncExternalStore(
    (l) => src.subscribe(l),
    () => src.version(),
    () => src.version(),
  );
}

/** The grocery list for a span, live. */
export function useGroceryList(planId: string | null, from: LocalDate, to: LocalDate): GroceryList {
  const src = useGrocerySource();
  const v = useGroceryVersion(src);
  return useMemo(() => {
    void v;
    return planId ? src.list({ planId, from, to }) : { from, to, groups: [], count: 0 };
  }, [src, v, planId, from, to]);
}
