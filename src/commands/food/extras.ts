/**
 * Grocery list from saved meal plans, and the supplements line (catalogue items serving the person's goals, only when
 * the person opted in). Mirrors the Food screen's models (`src/features/living/food/groceries.ts`, `supplements.ts`),
 * which headless commands may not import. Suggestion safety (D7-03) comes from the shared policy evaluator, with tri-state
 * results: unknown safety facts make an item `unchecked`, never silently allowed or silently hidden.
 */
import type { FoodTable, SupplementRecord } from '@/catalogues/types';
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements'; // not the index: it builds the whole seed catalogue
import type { SuggestionDecision, SuggestionPolicyState } from '@/lib/bodyContracts';
import type { FoodSetup } from './context';

export type Aisle = 'vegetables' | 'dairy' | 'staples' | 'protein' | 'spices';

const AISLE_OF_GROUP: Readonly<Record<string, Aisle>> = {
  dairy: 'dairy', eggs: 'protein', pulses: 'protein', poultry: 'protein', meat: 'protein', fish: 'protein', seafood: 'protein', soy: 'protein',
  cereals: 'staples', fats: 'staples', oils: 'staples', sugars: 'staples', nuts: 'staples', spices: 'spices', condiments: 'spices',
};

export function aisleOfGroup(group: string): Aisle {
  return AISLE_OF_GROUP[group] ?? 'vegetables';
}

export interface MealPlanItem {
  foodId: string;
  grams: number;
}
export interface MealPlanLike {
  date: string;
  meals: Array<{ slot: string; items?: MealPlanItem[] }>;
}

export interface GroceryItem {
  foodId: string;
  name: string;
  aisle: Aisle;
  /** Total grams over the range (as planned: raw or as-eaten per the food record). */
  grams: number;
  /** Buy unit text ("eggs × 6", "rice 350 g"). */
  buy: string;
  /** Marked "have" in the kitchen pantry. */
  have: boolean;
  dates: string[];
}

function buyUnit(name: string, foodId: string, g: number): string {
  if (/egg/.test(foodId)) return `eggs × ${Math.max(6, Math.ceil(g / 50 / 6) * 6)}`;
  return g >= 1000 ? `${name} ${Math.round(g / 100) / 10} kg` : `${name} ${Math.ceil(g / 50) * 50} g`;
}

/** Aggregate planned items per food, grouped by aisle (aisle order: vegetables, dairy, staples, protein, spices). */
export function groceryList(plans: readonly MealPlanLike[], table: FoodTable, setup: FoodSetup): GroceryItem[] {
  const by = new Map<string, { grams: number; dates: Set<string> }>();
  for (const p of plans)
    for (const m of p.meals)
      for (const it of m.items ?? []) {
        const cur = by.get(it.foodId) ?? { grams: 0, dates: new Set<string>() };
        cur.grams += it.grams;
        cur.dates.add(p.date);
        by.set(it.foodId, cur);
      }
  const have = new Set(setup.pantry.filter((p) => p.have).map((p) => p.foodId));
  const order: Aisle[] = ['vegetables', 'dairy', 'staples', 'protein', 'spices'];
  return [...by.entries()]
    .map(([foodId, v]) => {
      const f = table.get(foodId);
      const name = f ? (f.aliases[0] ?? f.name) : foodId;
      const aisle = aisleOfGroup(f?.group ?? '');
      return { foodId, name, aisle, grams: Math.round(v.grams), buy: buyUnit(name, foodId, v.grams), have: have.has(foodId), dates: [...v.dates].sort() };
    })
    .sort((a, b) => order.indexOf(a.aisle) - order.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

/** Goal tags used when the plan's goals are not mapped yet (the Food screen's `PLAN_GOAL_TAGS`). */
export const DEFAULT_GOAL_TAGS: readonly string[] = ['fat_loss_muscle_retention', 'strength', 'fibre_target', 'deficiency_prevention'];

/**
 * The shared suggestion-policy evaluator (D7-03): one decision per catalogue item from the CURRENT screening plus the
 * marker-derived context (typed predicates, reviewed aliases, marker noSuggest with rule/source/applicability). Food,
 * Coach/commands and planner suggestions use the same evaluator; this line never re-derives safety on its own.
 */
export type SupplementPolicy = (record: SupplementRecord) => SuggestionDecision;

export interface SupplementLineItem {
  id: string;
  name: string;
  dose: string;
  timing: string;
  status: SupplementRecord['status'];
  goals: string[];
  /** (D7-03) policy state of suggesting it: `allow`, or `caution` (suggested with its caution status). */
  policy: SuggestibleState;
  reasons?: SuggestionDecision['reasons'];
}

/** Policy states that allow a new suggestion card (the shared evaluator's `isSuggestible`). */
export type SuggestibleState = Extract<SuggestionPolicyState, 'allow' | 'caution'>;

/**
 * (D7-03) a catalogue item not suggested, named with its status and reasons (the tap-accessible details list, never a bare
 * hidden count): `noSuggest` (Not suggested), `clinicianReview` (Review) or `unchecked` (a safety fact it depends on is
 * not known: the targeted question can be asked; never a negative screen and never a known disease).
 */
export interface WithheldSupplement {
  id: string;
  name: string;
  policy: Exclude<SuggestionPolicyState, SuggestibleState>;
  reasons: SuggestionDecision['reasons'];
}

export interface SupplementLine {
  /** False when the person keeps "food first" (the default): no catalogue suggestions. */
  optedIn: boolean;
  items: SupplementLineItem[];
  /** Items withheld because a safety rule applies (`noSuggest` or `clinicianReview`; legacy count — `withheld` names them). */
  hiddenForSafety: number;
  /** (D7-03) items not suggested, with status and rule/source/applicability. Absent when none. */
  withheld?: WithheldSupplement[];
  /**
   * (D7-03) catalogue items the person already takes whose policy is not `allow`: shown with their status (Review /
   * Unchecked / caution). Taking stays recordable; this never says to stop or start anything. Absent when none.
   */
  taking?: Array<{ id: string; name: string; policy: SuggestionPolicyState; reasons: SuggestionDecision['reasons'] }>;
}

/**
 * Decision for one item without the shared evaluator. `safetyFlags` given (legacy callers, screening answered): an exact
 * contraindication flag match is `noSuggest`, else `allow` (legacy semantics; aliases are the evaluator's job). Nothing
 * given: the safety state is not known here, so an item with any contraindication is `unchecked` (withheld until the fact
 * is known) and an item without one is `allow` — unknown screening is never an empty negative screen.
 */
function fallbackDecision(r: SupplementRecord, flags: ReadonlySet<string> | null): SuggestionDecision {
  if (r.contraindications.length === 0) return { subject: r.id, state: 'allow', reasons: [] };
  if (flags === null) return { subject: r.id, state: 'unchecked', reasons: r.contraindications.map((c) => ({ rule: `contraindication:${c.flag}`, source: 'screening' as const, applicability: 'unresolved' as const })) };
  const hits = r.contraindications.filter((c) => flags.has(c.flag));
  return hits.length > 0 ? { subject: r.id, state: 'noSuggest', reasons: hits.map((c) => ({ rule: `contraindication:${c.flag}`, source: 'screening' as const, applicability: 'applicable' as const })) } : { subject: r.id, state: 'allow', reasons: [] };
}

/**
 * Catalogue supplements serving the person's goals — only when they opted in (`intake.supplements.stance === 'open'`,
 * the Food screen's opt-in). Already-taken, on-hand, refused, prescribed and diet-incompatible items are not suggested.
 * Each candidate carries its policy state (D7-03): `allow` / `caution` items are suggested; `noSuggest`,
 * `clinicianReview` and `unchecked` items move to `withheld`, named with their status and reasons. Taken items whose
 * policy is not `allow` are listed in `taking` with their status (logging them is never refused).
 */
export function supplementLine(o: { setup: FoodSetup; prescribed?: readonly string[]; goals?: readonly string[]; safetyFlags?: readonly string[]; policy?: SupplementPolicy }): SupplementLine {
  if (o.setup.supplementStance !== 'open') return { optedIn: false, items: [], hiddenForSafety: 0 };
  const goals = new Set(o.goals ?? DEFAULT_GOAL_TAGS);
  const taking = new Set(o.setup.takingSupplements);
  const skip = new Set([...(o.prescribed ?? []), ...o.setup.takingSupplements, ...o.setup.onHandSupplements, ...o.setup.refusedSupplements]);
  const flags = o.safetyFlags ? new Set(o.safetyFlags) : null;
  const decide = (r: SupplementRecord): SuggestionDecision => (o.policy ? o.policy(r) : fallbackDecision(r, flags));
  const a = o.setup.diet?.animalFoods;
  const vegan = !!a && a.dairy === 'none' && a.eggs === 'none' && a.meat === 'none' && !a.fish;
  const vegetarian = !!a && a.meat === 'none' && !a.fish && !a.shellfish;
  const items: SupplementLineItem[] = [];
  const withheld: WithheldSupplement[] = [];
  const takingStatus: NonNullable<SupplementLine['taking']> = [];
  for (const r of SEED_SUPPLEMENTS) {
    if (taking.has(r.id)) {
      const d = decide(r);
      if (d.state !== 'allow') takingStatus.push({ id: r.id, name: r.name, policy: d.state, reasons: d.reasons });
    }
    if (skip.has(r.id)) continue;
    const forGoals = r.status === 'offer' && r.goals.some((g) => goals.has(g));
    const forRisk = r.status === 'offer_if_risk' && r.id === 'vitamin_b12' && (vegetarian || !a);
    if (!forGoals && !forRisk) continue;
    if (vegan && r.diet.vegan.ok === false) continue;
    if (vegetarian && r.diet.vegetarian.ok === false) continue;
    const d = decide(r);
    if (d.state !== 'allow' && d.state !== 'caution') {
      withheld.push({ id: r.id, name: r.name, policy: d.state, reasons: d.reasons });
      continue;
    }
    const dose = r.dose.range ? `${r.dose.range[0]}–${r.dose.range[1]} ${r.dose.unit}` : r.dose.amount !== null ? `${r.dose.amount} ${r.dose.unit}` : '';
    items.push({ id: r.id, name: r.name, dose, timing: r.timing, status: r.status, goals: r.goals.filter((g) => goals.has(g)), policy: d.state, ...(d.reasons.length > 0 ? { reasons: d.reasons } : {}) });
  }
  const hidden = withheld.filter((w) => w.policy !== 'unchecked').length;
  return { optedIn: true, items, hiddenForSafety: hidden, ...(withheld.length > 0 ? { withheld } : {}), ...(takingStatus.length > 0 ? { taking: takingStatus } : {}) };
}
