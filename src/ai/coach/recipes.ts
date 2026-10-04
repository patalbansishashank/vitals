/**
 * `RecipeProvider` over a chat model (R4 §3, docs/SUITE_SPEC.md §8.3). The model proposes dishes as food ids and raw
 * grams from the allowed foods only; the app fits and verifies them with `food.planDay` against the food table. When the
 * fit is off the deviation is fed back (at most two repair rounds), then the closest result is returned and labelled
 * "closest". Nutrient numbers from the model are never read: totals come from the food table and the solver.
 */
import type { FoodTable } from '@/catalogues';
import { recipeConstraintsFromViews, type KitchenBlockInput, type PantryBlockInput, type RecipeConstraints } from '@/catalogues/kitchen';
import type { ChatModel, JsonSchema } from '../providers/types';
import { askJson, isRecord, num, str } from './modelJson';

/*
 * Structural copies of the provider contract in `@/features/living/food/recipes` (src/ai must not import UI layers).
 * The Coach assigns the result to `RecipeProvider`; the test file checks the two stay compatible.
 */
export interface MealSlotTarget {
  slot: string;
  name: string;
  clockH: number;
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG?: number;
}
interface Est {
  value: number;
  sd: number;
}
export interface RecipeSuggestion {
  id: string;
  slot: string;
  dish: string;
  cuisine: string;
  activeMin: number;
  passiveMin?: number;
  servings: number;
  equipment: string[];
  portionLine: string;
  fit: { kind: 'fits' | 'closest'; text: string };
  perServing: { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG?: Est };
  ingredients: Array<{ name: string; household?: string; grams: number }>;
  steps: string[];
  why: string;
  estimatedComposition?: string;
}
export type RecipeResult = RecipeSuggestion | { error: string };
type SlotProgress = 'working' | 'done' | 'error';
export interface PlanDayRequest {
  date: string;
  slots: MealSlotTarget[];
  foodRules?: unknown;
  signal?: AbortSignal;
  exclude?: string[];
  pantry?: string[];
  onProgress?: (slot: string, state: SlotProgress) => void;
}
export interface SwapRequest {
  date: string;
  slot: string;
  target: MealSlotTarget;
  exclude: string[];
  foodRules?: unknown;
  signal?: AbortSignal;
}
export interface RecipeProvider {
  available: boolean;
  reason?: string;
  planDay(req: PlanDayRequest): Promise<Record<string, RecipeResult>>;
  swap(req: SwapRequest): Promise<RecipeResult>;
}

/** The slice of `dispatch` this provider uses. */
export type DispatchFn = (id: string, input: unknown) => Promise<{ ok: true; output?: unknown } | { ok: false; error: { message?: string } } | { ok: true }>;

export interface AiRecipeDeps {
  model: ChatModel;
  /** Defaults to the app's command bus. */
  dispatch?: DispatchFn;
  /** Optional food table for household units and per-serving numbers when the candidate list lacks them. */
  foods?: FoodTable;
  /**
   * Kitchen facts for the prompt that override what `kitchen.get` / `pantry.get` return (time budget per meal in minutes,
   * cooking skill 1-5, or a fixed equipment list in tests).
   */
  kitchen?: Partial<RecipeConstraints>;
  /** Read the kitchen and pantry before each request (default true; through `kitchen.get` and `pantry.get`). */
  readKitchen?: boolean;
  /** Repair rounds after the first proposal (default 2). */
  repairRounds?: number;
}

interface Candidate {
  id: string;
  name: string;
  tags: string[];
  per100?: { energyKcal?: number; proteinG?: number; carbG?: number; fatG?: number; fibreG?: number };
  portions: Array<{ label: string; g: number }>;
}

interface ProposedIngredient {
  foodId: string;
  grams: number;
  flexible: boolean;
}
interface ProposedMeal {
  slot: string;
  dish: string;
  cuisine: string;
  ingredients: ProposedIngredient[];
  steps: string[];
  activeMin: number;
  passiveMin?: number;
  equipment: string[];
}

export const RECIPE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['meals'],
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'dish', 'ingredients', 'steps'],
        properties: {
          slot: { type: 'string' },
          dish: { type: 'string', description: 'Main dish first, then sides: "Paneer bhurji, 2 rotis, raita".' },
          cuisine: { type: 'string' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['foodId', 'grams'],
              properties: { foodId: { type: 'string' }, grams: { type: 'number', description: 'Raw grams for one serving.' }, flexible: { type: 'boolean' } },
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
          activeMin: { type: 'number' },
          passiveMin: { type: 'number' },
          equipment: { type: 'array', items: { type: 'string' }, description: 'Every piece of equipment the meal needs, named as in KITCHEN.equipment.' },
        },
      },
    },
  },
};

export const SYSTEM = `You plan meals for one day. Return JSON only.
Use ONLY foodId values from ALLOWED, exactly as written. Pick sensible dishes and approximate raw grams for ONE serving; the app computes nutrients and fine-tunes portions to the targets.
Never state calories, macros or health claims. Never include an excluded dish. Steps are short and plain.
KITCHEN is what the person has. Use only equipment in KITCHEN.equipment (notes give sizes; "owned, not used now" may be suggested, saying so). No oven, OTG, air fryer or convection microwave: no baked dishes. Prefer dishes that use their appliances (an egg boiler, soda maker, sprouter, air fryer, rice cooker or pressure cooker changes what is easy). A small pressure cooker limits batch size. List every piece of equipment a meal needs in "equipment", using the names from KITCHEN.equipment.
When KITCHEN.preferPantry is true, build meals mostly from KITCHEN.pantry; otherwise start from KITCHEN.staples. Favour KITCHEN.cuisines in order. Keep within KITCHEN.timeBudgetMin when given.`;

/* ------------------------------------------------------------------------------------------ parsing helpers */

const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : isRecord(v) ? (Object.values(v).find(Array.isArray) as unknown[] | undefined) ?? [] : []);

export function parseCandidates(output: unknown): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of arrayOf(output)) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id ?? raw.foodId, 80);
    const name = str(raw.name, 80);
    if (!id || !name) continue;
    const p = isRecord(raw.per100) ? raw.per100 : isRecord(raw.per100g) ? raw.per100g : undefined;
    const per100 = p
      ? {
          ...(num(p.energyKcal ?? p.kcal) !== undefined ? { energyKcal: num(p.energyKcal ?? p.kcal)! } : {}),
          ...(num(p.proteinG ?? p.p) !== undefined ? { proteinG: num(p.proteinG ?? p.p)! } : {}),
          // food.candidates gives net carbohydrate (`netCarbG`); without it the recipe card showed "carbs ≈ 0" (Q4)
          ...(num(p.carbG ?? p.netCarbG ?? p.c) !== undefined ? { carbG: num(p.carbG ?? p.netCarbG ?? p.c)! } : {}),
          ...(num(p.fatG ?? p.f) !== undefined ? { fatG: num(p.fatG ?? p.f)! } : {}),
          ...(num(p.fibreG ?? p.fib) !== undefined ? { fibreG: num(p.fibreG ?? p.fib)! } : {}),
        }
      : undefined;
    const portions = arrayOf(raw.portions).flatMap((x) => (isRecord(x) && str(x.label) && (num(x.g) ?? 0) > 0 ? [{ label: str(x.label)!, g: num(x.g)! }] : []));
    out.push({ id, name, tags: arrayOf(raw.tags).filter((t): t is string => typeof t === 'string'), ...(per100 ? { per100 } : {}), portions });
  }
  return out.slice(0, 150);
}

/** Drops ids outside the allowed set and clamps grams; meals left without ingredients are dropped. */
export function parseProposal(json: Record<string, unknown>, allowed: ReadonlySet<string>, slots: ReadonlySet<string>): { meals: ProposedMeal[]; rejected: string[] } {
  const rejected: string[] = [];
  const meals: ProposedMeal[] = [];
  for (const m of arrayOf(json.meals)) {
    if (!isRecord(m)) continue;
    const slot = str(m.slot, 40);
    const dish = str(m.dish ?? m.dish_name, 160);
    if (!slot || !dish || !slots.has(slot)) continue;
    const ingredients: ProposedIngredient[] = [];
    for (const i of arrayOf(m.ingredients)) {
      if (!isRecord(i)) continue;
      const foodId = str(i.foodId ?? i.food_id, 80);
      const raw = num(i.grams ?? i.grams_raw);
      const g = raw === undefined ? undefined : Math.round(raw * 10) / 10; // rounded first: 0.04 g is 0 g and is dropped
      if (!foodId || g === undefined || g <= 0) continue;
      if (!allowed.has(foodId)) {
        rejected.push(foodId);
        continue;
      }
      ingredients.push({ foodId, grams: Math.min(1500, g), flexible: i.flexible !== false });
    }
    if (!ingredients.length) continue;
    const passive = num(m.passiveMin ?? m.passive_min);
    meals.push({
      slot,
      dish,
      cuisine: str(m.cuisine, 40) ?? '',
      ingredients,
      steps: arrayOf(m.steps).flatMap((s) => (str(s, 300) ? [str(s, 300)!] : [])).slice(0, 12),
      activeMin: Math.max(0, Math.round(num(m.activeMin ?? m.active_min) ?? 20)),
      ...(passive ? { passiveMin: Math.round(passive) } : {}),
      equipment: arrayOf(m.equipment).flatMap((s) => (str(s, 40) ? [str(s, 40)!] : [])).slice(0, 8),
    });
  }
  return { meals, rejected };
}

const FRACTIONS = ['', '¼', '½', '¾'];
/** Quarter-step count: 1, 1½, ¾. */
function fraction(quarters: number): string {
  const whole = Math.floor(quarters / 4);
  const f = FRACTIONS[quarters % 4]!;
  return `${whole || f ? (whole ? String(whole) : '') : '0'}${f}`;
}

/** Units and size words that do not take a plural "s". */
const NO_PLURAL = /^(g|kg|mg|ml|l|tsp|tbsp|oz|lb|small|medium|large|whole|pinch|handful)$/i;

function plural(word: string): string {
  if (NO_PLURAL.test(word)) return word;
  if (/(ch|sh|ss|x|z)$/i.test(word)) return `${word}es`;
  if (/s$/i.test(word)) return word;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** "cube" → "cubes", "large egg" → "large eggs", "roti worth of flour" → "rotis worth of flour". */
function pluralUnit(unit: string): string {
  const m = /^(.*?)(\s+(?:worth|of)\b.*)?$/.exec(unit)!;
  const head = m[1]!.split(' ');
  head[head.length - 1] = plural(head[head.length - 1]!);
  return `${head.join(' ')}${m[2] ?? ''}`;
}

const LEAD: Readonly<Record<string, number>> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };

/** A portion label read as count · unit · grams per unit: "1 cube 25 g" → 1, "cube", 25; "1 katori (155 mL)" → 1, "katori". */
function readPortion(label: string): { n: number; unit: string; each?: number } | null {
  let s = label.trim().toLowerCase();
  let n = 1;
  const lead = /^(\d+(?:\.\d+)?|[½¼¾])\s+/.exec(s);
  if (lead) {
    n = LEAD[lead[1]!] ?? Number(lead[1]);
    s = s.slice(lead[0].length);
  }
  let each: number | undefined;
  const grams = /\(?\s*(\d+(?:\.\d+)?)\s*g\s*\)?\s*$/.exec(s);
  if (grams && grams.index > 0) {
    each = Number(grams[1]);
    s = s.slice(0, grams.index);
  }
  s = s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || !(n > 0) || /^(g|gram|grams|100 g)$/.test(s)) return null;
  return { n, unit: s, ...(each && n === 1 ? { each } : {}) };
}

/**
 * The amount in the food's household portions, once: "3½ cubes (25 g each)", "1 katori", "2 rotis". Null when no
 * portion divides the grams well (the grams are shown instead).
 */
export function householdUnit(grams: number, portions: ReadonlyArray<{ label: string; g: number }>): string | null {
  let best: { p: NonNullable<ReturnType<typeof readPortion>>; q: number; err: number } | null = null;
  for (const portion of portions) {
    const p = readPortion(portion.label);
    if (!p) continue;
    const n = grams / portion.g;
    if (n < 0.5 || n > 8) continue;
    const q = Math.round(n * 4);
    const err = Math.abs(n - q / 4) / n;
    if (err < 0.12 && (!best || err < best.err)) best = { p, q, err };
  }
  if (!best) return null;
  const quarters = Math.round(best.q * best.p.n);
  const many = quarters > 4;
  const each = best.p.each ? ` (${best.p.each} g${many ? ' each' : ''})` : '';
  return `${fraction(quarters)} ${many ? pluralUnit(best.p.unit) : best.p.unit}${each}`;
}

/** One ingredient in a portion line: "3½ cubes (25 g each) paneer", "3 rotis", "90 g paneer". */
export function portionText(name: string, grams: number, household: string | null): string {
  const short = name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const food = short ? `${short[0]!.toLowerCase()}${short.slice(1)}` : name;
  if (!household) return `${Math.round(grams)} g ${food}`;
  const head = food.split(',')[0]!.trim().toLowerCase();
  return head && household.toLowerCase().includes(head) ? household : `${household} ${food}`;
}

/* ------------------------------------------------------------------------------------------------ fit reading */

interface FitView {
  within: boolean;
  grams: Record<string, number>;
  deltas: Record<string, number>;
  binding: string[];
  hints: string[];
  score: number;
}

const numRecord = (v: unknown): Record<string, number> => (isRecord(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number')) : {});
const strList = (v: unknown): string[] => arrayOf(v).flatMap((x) => (typeof x === 'string' ? [x] : []));

/**
 * The fit `food.planDay` reports: `{status: 'fits'|'closest', meals: [{slot, items: [{foodId, grams}]}], deviations:
 * [{nutrient, target, actual, ok}], repairHints}` (`src/commands/food`). Fitted grams are keyed `slot:foodId`; deltas
 * are actual − target for the nutrients outside tolerance.
 */
export function readFit(output: unknown): FitView | null {
  if (!isRecord(output)) return null;
  if (output.status === 'fits' || output.status === 'closest') {
    const grams: Record<string, number> = {};
    for (const m of arrayOf(output.meals)) {
      if (!isRecord(m) || typeof m.slot !== 'string') continue;
      for (const it of arrayOf(m.items)) {
        if (isRecord(it) && typeof it.foodId === 'string' && typeof it.grams === 'number') grams[`${m.slot}:${it.foodId}`] = (grams[`${m.slot}:${it.foodId}`] ?? 0) + it.grams;
      }
    }
    const deltas: Record<string, number> = {};
    for (const d of arrayOf(output.deviations)) {
      if (isRecord(d) && typeof d.nutrient === 'string' && d.ok === false && typeof d.actual === 'number' && typeof d.target === 'number') deltas[d.nutrient] = d.actual - d.target;
    }
    const within = output.status === 'fits';
    const score = Object.values(deltas).reduce((a, d) => a + Math.abs(d), 0);
    return { within, grams, deltas, binding: [], hints: strList(output.repairHints), score: within ? 0 : score || Number.POSITIVE_INFINITY };
  }
  const fit = isRecord(output.fit) ? output.fit : output;
  const deltas = { ...numRecord(fit.deltas), ...numRecord(output.deltas) };
  const score = Object.values(deltas).reduce((a, d) => a + Math.abs(d), 0);
  return {
    within: fit.withinTolerance === true,
    grams: numRecord(fit.grams),
    deltas,
    binding: strList(fit.binding),
    hints: strList(output.repairHints),
    score: fit.withinTolerance === true ? 0 : score || Number.POSITIVE_INFINITY,
  };
}

const LABEL: Record<string, [string, string]> = {
  energyKcal: ['energy', 'kcal'],
  proteinG: ['protein', 'g'],
  carbG: ['carbohydrate', 'g'],
  fatG: ['fat', 'g'],
  fibreG: ['fibre', 'g'],
};
function deviationText(f: FitView): string {
  const parts = Object.entries(f.deltas)
    .filter(([k, v]) => LABEL[k] && Math.abs(v) >= 1)
    .map(([k, v]) => `${LABEL[k]![0]} ${Math.abs(Math.round(v))} ${LABEL[k]![1]} ${v < 0 ? 'under' : 'over'}`);
  return parts.length ? `Closest achievable with your allowed foods: ${parts.join(', ')}.` : f.binding.length ? `Closest achievable: ${f.binding.join('; ')}.` : 'Closest achievable with your allowed foods.';
}

function gramsOf(fit: FitView, slot: string, foodId: string, unique: boolean, fallback: number): number {
  const keys = [`${slot}:${foodId}`, `${slot}/${foodId}`, `${slot}.${foodId}`, ...(unique ? [foodId] : [])];
  for (const k of keys) if (fit.grams[k] !== undefined) return fit.grams[k]!;
  return fallback;
}

/* --------------------------------------------------------------------------------------------------- provider */

export function createAiRecipeProvider(deps: AiRecipeDeps): RecipeProvider {
  const rounds = deps.repairRounds ?? 2;
  const call: DispatchFn = deps.dispatch ?? (async (id, input) => (await import('@/commands')).dispatch(id, input) as ReturnType<DispatchFn>);

  const dispatchOutput = async (id: string, input: unknown): Promise<{ output: unknown } | { error: string }> => {
    const r = await call(id, input);
    if (!r.ok) return { error: ('error' in r && r.error?.message) || `${id} failed` };
    return { output: 'output' in r ? r.output : undefined };
  };

  /** The kitchen constraints now: `kitchen.get` + `pantry.get` (failures read as "not told"), then `deps.kitchen` on top. */
  async function constraints(pantryOverride?: string[]): Promise<RecipeConstraints> {
    let k: KitchenBlockInput | null = null;
    let p: PantryBlockInput | null = null;
    if (deps.readKitchen !== false) {
      const [kr, pr] = await Promise.all([dispatchOutput('kitchen.get', {}).catch(() => ({ error: 'kitchen' })), dispatchOutput('pantry.get', {}).catch(() => ({ error: 'pantry' }))]);
      const kv = 'output' in kr ? kr.output : null;
      const pv = 'output' in pr ? pr.output : null;
      k = isRecord(kv) && Array.isArray(kv.equipment) ? (kv as unknown as KitchenBlockInput) : null;
      p = isRecord(pv) && Array.isArray(pv.items) ? (pv as unknown as PantryBlockInput) : null;
    }
    const base = recipeConstraintsFromViews(k, p);
    const merged: RecipeConstraints = { ...base, ...deps.kitchen, equipmentNotes: { ...base.equipmentNotes, ...deps.kitchen?.equipmentNotes } };
    if (pantryOverride?.length) {
      merged.pantry = [...new Set([...pantryOverride, ...merged.pantry])];
      merged.preferPantry = true;
    }
    return merged;
  }

  async function plan(args: { date: string; slots: MealSlotTarget[]; exclude?: string[]; pantry?: string[]; signal?: AbortSignal }, onProgress?: PlanDayRequest['onProgress']): Promise<Record<string, RecipeResult>> {
    const fail = (error: string) => Object.fromEntries(args.slots.map((s) => [s.slot, { error }])) as Record<string, RecipeResult>;
    for (const s of args.slots) onProgress?.(s.slot, 'working');
    const finish = (res: Record<string, RecipeResult>) => {
      for (const s of args.slots) onProgress?.(s.slot, 'error' in (res[s.slot] ?? { error: 1 }) ? 'error' : 'done');
      return res;
    };
    try {
      const [cand, kitchen] = await Promise.all([dispatchOutput('food.candidates', { date: args.date }), constraints(args.pantry)]);
      if ('error' in cand) return finish(fail(cand.error));
      const candidates = parseCandidates(cand.output);
      if (!candidates.length) return finish(fail('No foods are allowed for this day, so no recipe can be built.'));
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const allowed = new Set(byId.keys());
      const slotSet = new Set(args.slots.map((s) => s.slot));
      const base = {
        date: args.date,
        targets: Object.fromEntries(args.slots.map((s) => [s.slot, { kcal: Math.round(s.energyKcal), protein_g: Math.round(s.proteinG), carb_g: Math.round(s.carbG), fat_g: Math.round(s.fatG), ...(s.fibreG ? { fibre_g: Math.round(s.fibreG) } : {}) }])),
        ALLOWED: candidates.map((c) => ({ id: c.id, name: c.name, ...(c.per100 ? { per100: c.per100 } : {}) })),
        excludedDishes: args.exclude,
        KITCHEN: kitchen,
      };
      let feedback: string[] = [];
      let best: { meals: ProposedMeal[]; fit: FitView } | null = null;
      let lastProposal: ProposedMeal[] = [];
      let lastError = '';
      for (let round = 0; round <= rounds; round++) {
        const json = await askJson(deps.model, {
          system: SYSTEM,
          user: [{ type: 'text', text: JSON.stringify({ ...base, ...(feedback.length ? { repair: feedback } : {}) }) }],
          schemaName: 'propose_day_meals',
          schema: RECIPE_SCHEMA,
          maxOutputTokens: 3000,
          ...(args.signal ? { signal: args.signal } : {}),
        });
        const { meals, rejected } = parseProposal(json, allowed, slotSet);
        feedback = [];
        if (rejected.length) feedback.push(`These ids are not allowed and were removed: ${[...new Set(rejected)].join(', ')}. Use only ids from ALLOWED.`);
        const missing = args.slots.filter((s) => !meals.some((m) => m.slot === s.slot)).map((s) => s.slot);
        if (missing.length) feedback.push(`No usable meal for: ${missing.join(', ')}.`);
        if (!meals.length) {
          lastError = 'The model proposed no usable meals.';
          continue;
        }
        lastProposal = meals;
        // the last round saves the closest fit rather than nothing (food.planDay refuses off-target plans otherwise)
        const last = round === rounds;
        const planned = await dispatchOutput('food.planDay', {
          date: args.date,
          meals: meals.map((m) => ({ slot: m.slot, dish: m.dish, items: m.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams, ...(i.flexible === false ? { flexible: false } : {}) })), ...(last ? { acceptClosest: true } : {}) })),
        });
        if ('error' in planned) {
          lastError = planned.error;
          feedback.push(`The plan was rejected: ${planned.error}`);
          continue;
        }
        const fit = readFit(planned.output);
        if (!fit) {
          lastError = 'The meal plan could not be checked.';
          continue;
        }
        if (!best || fit.score <= best.fit.score) best = { meals, fit };
        if (fit.within && !missing.length) {
          best = { meals, fit };
          break;
        }
        feedback.push(JSON.stringify({ deltas: fit.deltas, binding: fit.binding, hints: fit.hints, instruction: 'swap or add ingredients; keep dishes if possible' }));
      }
      if (!best) return finish(fail(lastError || (lastProposal.length ? 'The meals could not be fitted to your targets.' : 'No recipe could be built.')));
      return finish(buildResults(best.meals, best.fit, args.slots, byId, deps.foods));
    } catch (e) {
      return finish(fail(e instanceof Error ? e.message : 'Recipe generation failed.'));
    }
  }

  return {
    available: true,
    async planDay(req) {
      return plan({ date: req.date, slots: req.slots, ...(req.exclude ? { exclude: req.exclude } : {}), ...(req.pantry ? { pantry: req.pantry } : {}), ...(req.signal ? { signal: req.signal } : {}) }, req.onProgress);
    },
    async swap(req: SwapRequest) {
      const res = await plan({ date: req.date, slots: [req.target], exclude: req.exclude, ...(req.signal ? { signal: req.signal } : {}) });
      return res[req.slot] ?? res[req.target.slot] ?? { error: 'No recipe could be built.' };
    },
  };
}

function buildResults(meals: ProposedMeal[], fit: FitView, slots: MealSlotTarget[], byId: Map<string, Candidate>, table?: FoodTable): Record<string, RecipeResult> {
  const out: Record<string, RecipeResult> = {};
  const counts = new Map<string, number>();
  for (const m of meals) for (const i of m.ingredients) counts.set(i.foodId, (counts.get(i.foodId) ?? 0) + 1);
  for (const s of slots) {
    const m = meals.find((x) => x.slot === s.slot);
    if (!m) {
      out[s.slot] = { error: 'No recipe for this meal; keep the plain targets.' };
      continue;
    }
    const lines = m.ingredients.map((i) => {
      const c = byId.get(i.foodId);
      const rec = table?.get(i.foodId);
      const grams = Math.round(gramsOf(fit, m.slot, i.foodId, counts.get(i.foodId) === 1, i.grams) * 10) / 10;
      const name = c?.name ?? rec?.name ?? i.foodId;
      const portions = c?.portions.length ? c.portions : (rec?.portions ?? []);
      const per = rec?.per100g ?? c?.per100;
      return { i, name, grams, household: householdUnit(grams, portions), per, verified: rec ? rec.verified : true };
    });
    const sum = (k: 'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG') => lines.reduce((a, l) => a + ((l.per?.[k] ?? 0) * l.grams) / 100, 0);
    const est = (v: number) => ({ value: Math.round(v * 10) / 10, sd: Math.round(v * (lines.every((l) => l.verified) ? 0.08 : 0.15) * 10) / 10 });
    const top = [...lines].sort((a, b) => ((b.per?.proteinG ?? 0) * b.grams) - ((a.per?.proteinG ?? 0) * a.grams))[0];
    const unverified = lines.filter((l) => !l.verified).map((l) => l.name);
    out[s.slot] = {
      id: `ai-${s.slot}-${m.dish.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
      slot: s.slot,
      dish: m.dish,
      cuisine: m.cuisine,
      activeMin: m.activeMin,
      ...(m.passiveMin ? { passiveMin: m.passiveMin } : {}),
      servings: 1,
      equipment: m.equipment,
      portionLine: lines.map((l) => portionText(l.name, l.grams, l.household)).join(' + '),
      fit: fit.within ? { kind: 'fits', text: 'Fits your targets.' } : { kind: 'closest', text: deviationText(fit) },
      perServing: { energyKcal: est(sum('energyKcal')), proteinG: est(sum('proteinG')), carbG: est(sum('carbG')), fatG: est(sum('fatG')), fibreG: est(sum('fibreG')) },
      ingredients: lines.map((l) => ({ name: l.name, ...(l.household ? { household: l.household } : {}), grams: l.grams })),
      steps: m.steps,
      why: top ? `${top.name[0]!.toUpperCase()}${top.name.slice(1)} carries most of the protein; portions are fitted to your targets.` : 'Portions are fitted to your targets.',
      ...(unverified.length ? { estimatedComposition: `Some values for ${unverified.slice(0, 3).join(', ')} are estimates; ranges are wider.` } : {}),
    } satisfies RecipeSuggestion;
  }
  return out;
}
