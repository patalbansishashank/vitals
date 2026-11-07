/**
 * Supplements on Food (design/screens/living-mode.md, Food › Supplements; docs/SUITE_SPEC.md §8.5): the prescription's
 * supplements with a "taken" tick, and — only when the person chose "open" — catalogue cards for items relevant to the
 * plan's goals. Contraindicated items never show as a card. Catalogue selection only; nothing here is scored.
 *
 * D7-03: suggestions take the shared policy decision (`src/lib/safetyPolicy.ts`) from the same current safety state the
 * Planner, the Coach and the commands use (tri-state screening answers, blood-marker flags and noSuggest decisions, food
 * allergies, clinician stops): allow · caution keep a card; not suggested · review · unchecked are named in a details list
 * with their status and reasons (unknown is never a negative screen). A product the person already takes stays loggable
 * with its status; suggestion policy never deletes it.
 *
 * A1-033: a confirmed food allergy also filters the card copy — food-first examples naming the allergen are dropped — and
 * the generic plant protein (soy isolate or pea:rice, no formulation selected) is not suggested with a confirmed soy
 * allergy; the separately identified soy-free pea:rice formulation (`SOY_FREE_PLANT_PROTEIN_ID`) may be, with its own
 * name, copy and examples, when the other screens pass. Unknown allergy answers keep today's Unchecked state.
 */
import { NO_EXPECTED_BENEFIT, SEED_SUPPLEMENTS } from '@/content/catalogues';
import type { NoBenefitRecord, SupplementRecord } from '@/catalogues/types';
import { doseText, supplementShortName, type SupplementRow } from '@/catalogues/supplements';
import type { EvidenceGrade } from '@/components';
import { PREDICATES, POLICY_LABEL, canonicalPredicate, isSuggestible, reasonWords, resolvePredicate, suggestionDecision, takenProductStatus, type SuggestionSafetyInput } from '@/lib/safetyPolicy';
import type { SuggestionDecision, SuggestionPolicyState } from '@/lib/bodyContracts';
import type { DietKind } from './profile';
import { FOOD_COPY } from './copy';

/**
 * Goal tags of the running plan. TODO(E5): derive from the plan's ranked goals (`PlanDoc.request.goals`) once the
 * Living source exposes them; the fixture and starter plans are fat-loss plans that keep muscle.
 */
export const PLAN_GOAL_TAGS: readonly string[] = ['fat_loss_muscle_retention', 'strength', 'fibre_target', 'deficiency_prevention'];

/** The catalogue record of a prescribed supplement id ("creatine" → creatine monohydrate). */
export function supplementRecord(id: string): SupplementRecord | undefined {
  const k = id.toLowerCase();
  return SEED_SUPPLEMENTS.find((s) => s.id === k) ?? SEED_SUPPLEMENTS.find((s) => s.aliases.some((a) => a.toLowerCase() === k));
}

/** Short display name ("creatine"). */
export function supplementName(id: string): string {
  const r = supplementRecord(id);
  if (r && FOOD_COPY.supplementCards[r.id]) return FOOD_COPY.supplementCards[r.id]!.name;
  return r?.aliases[0] ?? id.replace(/_/g, ' ');
}

/** Catalogue id of a plan or row id ("creatine" and "creatine_monohydrate" → creatine_monohydrate); else the id lower-cased. */
export function canonicalSupplementId(id: string): string {
  return supplementRecord(id)?.id ?? id.toLowerCase();
}

/** Whether one of the person's rows is the same supplement as a plan id (by catalogue id, aliases included). */
export function sameSupplement(planId: string, row: Pick<SupplementRow, 'supplementId'>): boolean {
  return !!row.supplementId && canonicalSupplementId(row.supplementId) === canonicalSupplementId(planId);
}

/** The person's own "taking" row for a plan supplement, when they already take it (Q6-11: one line per supplement). */
export function ownTakingRow(planId: string, rows: readonly SupplementRow[] | null | undefined): SupplementRow | undefined {
  return (rows ?? []).find((r) => r.state === 'taking' && sameSupplement(planId, r));
}

/**
 * One line for a plan supplement the person already takes: their name and dose with the plan's dose beside it
 * ("Creatine monohydrate" · "you take 5 g · morning · plan suggests 3 g"); the plan's dose is left out when it matches.
 */
export function mergedSupplementLine(plan: { dose: number; unit: string }, own: SupplementRow): { name: string; line: string } {
  const S = FOOD_COPY.supplements;
  const same = own.dose === plan.dose && (own.unit ?? plan.unit) === plan.unit;
  const mine = doseText(own);
  return { name: supplementShortName(own), line: [mine ? S.youTake(mine) : null, same ? null : S.planSuggests(`${plan.dose} ${plan.unit}`)].filter(Boolean).join(' · ') };
}

/**
 * Food reads the shared suggestion-policy input (D7-03, `src/lib/safetyPolicy.ts`): the same tri-state screening answers,
 * blood-marker flags and noSuggest decisions (with rule, sample date and applicability), food allergies and clinician
 * stops the Planner, the Coach and the `supplements.*` commands pass to `suggestionDecision`. Built by `foodSafetyInput`
 * (./profile). Unknown stays unknown: an unanswered question is never a negative screen.
 */
export type FoodSafetyContext = SuggestionSafetyInput;

/** Nothing answered and no marker decisions: every screened predicate is unknown (Unchecked), never a negative screen. */
export const UNANSWERED_SAFETY: FoodSafetyContext = { screening: {} };

/** The shared decision for one catalogue product, with its short reason words for the details list. */
export interface FoodSuggestion {
  state: SuggestionPolicyState;
  /** Short reason words ("kidney disease", "soy allergy (not answered)", "blood result"); empty when allowed. */
  reasons: string[];
  decision: SuggestionDecision;
}

/**
 * The shared policy for one catalogue product (D7-03): `suggestionDecision` (allow · caution · unchecked · clinician
 * review · not suggested) with its reason words. Food adds nothing of its own: one vocabulary on every surface.
 */
export function suggestionPolicy(r: Pick<SupplementRecord, 'id' | 'contraindications'>, safety: FoodSafetyContext): FoodSuggestion {
  const decision = suggestionDecision(r, safety);
  return { state: decision.state, reasons: reasonWords(decision), decision };
}

/** Inline status words (C6 vocabulary, the shared `POLICY_LABEL`): '' when allowed. */
export const SUGGESTION_WORD: Readonly<Record<SuggestionPolicyState, string>> = POLICY_LABEL;

/** A suggestion state that keeps a card (the shared `isSuggestible`: allow, or caution shown with its word). */
export type CardState = Extract<SuggestionPolicyState, 'allow' | 'caution'>;
/** A state that withholds the card: named in the details list with its status and reasons, never only counted. */
export type HeldState = Exclude<SuggestionPolicyState, CardState>;

export interface SupplementCardModel {
  record: SupplementRecord;
  name: string;
  dose: string;
  when: string;
  why: string;
  caution: string | null;
  foodFirst: string | null;
  /** Best evidence grade among the outcomes that showed an effect. */
  grade: EvidenceGrade | null;
  /** D7-03 policy state of the card (allow, or caution with its reasons in the details). */
  status?: CardState;
  /** Reason words behind a caution (details only). */
  reasons?: string[];
}

/** A product held back from suggestion, named with its status and reasons (D7-03: never only a count). */
export interface HeldSupplement {
  record: SupplementRecord;
  name: string;
  state: HeldState;
  /** The reason words joined ("kidney disease, blood result"). */
  reason: string;
}

function cardOf(r: SupplementRecord, dietKind: DietKind | null = null): SupplementCardModel {
  const c = FOOD_COPY.supplementCards[r.id] as ((typeof FOOD_COPY.supplementCards)[keyof typeof FOOD_COPY.supplementCards] & { foodFirstNoEggs?: string }) | undefined;
  const noEggs = dietKind === 'vegetarian' || dietKind === 'vegan';
  const shown = r.outcomes.filter((o) => o.direction === 'effect').map((o) => o.certainty).sort();
  const dose = r.dose.range ? `${r.dose.range[0]}–${r.dose.range[1]} ${r.dose.unit}${r.dose.per ? ` a ${r.dose.per}` : ''}` : r.dose.amount !== null ? `${r.dose.amount} ${r.dose.unit}` : '';
  return {
    record: r,
    name: c?.name ?? r.name,
    dose: c?.dose ?? dose,
    when: c?.when ?? r.timing,
    why: c?.why ?? '',
    caution: c?.caution ?? null,
    foodFirst: (noEggs ? c?.foodFirstNoEggs : undefined) ?? c?.foodFirst ?? null,
    grade: (shown[0] as EvidenceGrade | undefined) ?? null,
  };
}

/**
 * Positive facts given as bare flags (the profile's `safetyFlags`, tests and the gallery) added to a policy input: an
 * allergen flag sets that food allergy, any other flag (screening vocabulary or a reviewed catalogue alias) establishes
 * its predicate. Never a negative: everything not named keeps its own answer (unknown when unanswered).
 */
export function withPersonFlags(base: FoodSafetyContext, flags: readonly string[] | undefined): FoodSafetyContext {
  if (!flags?.length) return base;
  const allergies = { ...(base.allergies ?? {}) };
  const out = new Set(base.flags ?? []);
  for (const f of flags) {
    const id = canonicalPredicate(f) ?? canonicalPredicate(f.trim().toLowerCase().replace(/_/g, '-'));
    if (id === 'milk-allergy') allergies.milk = 'yes';
    else if (id === 'soy-allergy') allergies.soy = 'yes';
    else {
      out.add(f);
      for (const y of id ? PREDICATES[id].yesFlags : []) out.add(y);
    }
  }
  return { ...base, flags: [...out], ...(Object.keys(allergies).length ? { allergies } : {}) };
}

/** Food allergies the person confirmed (yes only: an unknown answer filters nothing and keeps its Unchecked state). */
export function confirmedAllergens(safety: FoodSafetyContext): { milk: boolean; soy: boolean } {
  return { milk: resolvePredicate(PREDICATES['milk-allergy'], safety).answer === 'yes', soy: resolvePredicate(PREDICATES['soy-allergy'], safety).answer === 'yes' };
}

/** Words that name a food carrying the allergen in the card copy (soy foods; dairy foods). */
const ALLERGEN_FOODS: Readonly<Record<'milk' | 'soy', RegExp>> = {
  soy: /\b(soy|soya|tofu|tempeh|edamame)\b/i,
  milk: /\b(milk|curd|dahi|paneer|yogh?urt|cheese|whey|casein)\b/i,
};

/**
 * Food-first text without the examples that name a confirmed allergen (A1-033): "Curd, paneer, eggs, or dal with soy
 * chunks." with a soy allergy → "Curd, paneer, or eggs."; null when nothing is left. Unchanged when nothing is removed.
 */
export function allergenSafeFoodFirst(text: string | null, allergens: { milk: boolean; soy: boolean }): string | null {
  if (!text) return text;
  const terms = (['milk', 'soy'] as const).filter((a) => allergens[a]).map((a) => ALLERGEN_FOODS[a]);
  if (!terms.length) return text;
  const body = text.trim().replace(/\.$/, '');
  const items = body.split(/,\s*(?:or\s+)?|\s+or\s+/).map((x) => x.trim()).filter(Boolean);
  const kept = items.filter((x) => !terms.some((t) => t.test(x)));
  if (kept.length === items.length) return text;
  if (!kept.length) return null;
  const list = kept.length === 1 ? kept[0]! : / or /.test(body) ? `${kept.slice(0, -1).join(', ')}${kept.length > 2 ? ',' : ''} or ${kept[kept.length - 1]}` : kept.join(', ');
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

/** Catalogue id of the soy-free pea:rice formulation of plant protein (A1-033): its own product identity, never the generic. */
export const SOY_FREE_PLANT_PROTEIN_ID = 'plant_protein_pea_rice';

/**
 * The catalogue's plant protein restricted to its 60:40 pea:rice formulation (A1-033): soy-free by identity, so the soy
 * allergen and soy contraindication are removed from its own metadata; every other screen still applies to it.
 */
export function soyFreePlantProtein(base: SupplementRecord): SupplementRecord {
  return {
    ...base,
    id: SOY_FREE_PLANT_PROTEIN_ID,
    name: 'Pea and rice protein powder (soy-free)',
    aliases: ['pea protein', 'pea and rice protein'],
    form: '60:40 pea:rice blend labelled soy-free.',
    foodFirstAlternative: allergenSafeFoodFirst(base.foodFirstAlternative, { milk: false, soy: true }),
    contraindications: base.contraindications.filter((c) => canonicalPredicate(c.flag) !== 'soy-allergy'),
    diet: { ...base.diet, allergens: base.diet.allergens.filter((a) => !ALLERGEN_FOODS.soy.test(a)) },
  };
}

/** The soy-free formulation's card: its own name and label check; examples from the permitted formulation only. */
function soyFreeCardOf(base: SupplementRecord, dietKind: DietKind | null, allergens: { milk: boolean; soy: boolean }): SupplementCardModel {
  const generic = cardOf(base, dietKind);
  return {
    ...generic,
    record: soyFreePlantProtein(base),
    name: 'pea and rice protein powder',
    caution: `${generic.caution ? `${generic.caution}; ` : ''}pick one labelled soy-free`,
    foodFirst: allergenSafeFoodFirst(generic.foodFirst, { ...allergens, soy: true }),
  };
}

/**
 * Cards for the "open" stance: items that are offered for the plan's goals (or offered on a risk the diet carries),
 * compatible with the diet, not already prescribed. Each candidate takes the shared policy decision (D7-03): allow and
 * caution keep their card (caution with its word and reasons in the details); not suggested, review and unchecked items
 * are returned in `held`, named with their status and reasons, never shown as a card and never only counted.
 * `safetyFlags` (legacy positive flags) join `safety`; without `safety` nothing else is known (unanswered).
 */
export function supplementCards(o: { prescribed: readonly string[]; dietKind: DietKind | null; safetyFlags?: readonly string[]; safety?: FoodSafetyContext; goals?: readonly string[] }): {
  cards: SupplementCardModel[];
  held: HeldSupplement[];
  /** Legacy count: items withheld because a safety rule applies (not suggested or review; Unchecked is not counted). */
  hiddenForSafety: number;
} {
  const goals = new Set(o.goals ?? PLAN_GOAL_TAGS);
  const prescribed = new Set(o.prescribed.map((p) => supplementRecord(p)?.id ?? p));
  const safety = withPersonFlags(o.safety ?? UNANSWERED_SAFETY, o.safetyFlags);
  const allergens = confirmedAllergens(safety);
  const plantBased = o.dietKind === 'vegan' || o.dietKind === 'vegetarian' || o.dietKind === 'eggetarian';
  const out: SupplementCardModel[] = [];
  const held: HeldSupplement[] = [];
  for (const r of SEED_SUPPLEMENTS) {
    if (prescribed.has(r.id)) continue;
    const forGoals = r.status === 'offer' && r.goals.some((g) => goals.has(g));
    const forRisk = r.status === 'offer_if_risk' && r.id === 'vitamin_b12' && (plantBased || o.dietKind === null);
    if (!forGoals && !forRisk) continue;
    if (o.dietKind === 'vegan' && r.diet.vegan.ok === false) continue;
    if ((o.dietKind === 'vegetarian' || o.dietKind === 'eggetarian') && r.diet.vegetarian.ok === false) continue;
    const p = suggestionPolicy(r, safety);
    if (!isSuggestible(p.decision)) {
      held.push({ record: r, name: cardOf(r, o.dietKind).name, state: p.state as HeldState, reason: p.reasons.join(', ') });
      // A1-033: with a confirmed soy allergy, only the separately identified soy-free formulation may take its place
      if (r.id === 'plant_protein' && allergens.soy && !prescribed.has(SOY_FREE_PLANT_PROTEIN_ID)) {
        const v = suggestionPolicy(soyFreePlantProtein(r), safety);
        if (isSuggestible(v.decision)) out.push({ ...soyFreeCardOf(r, o.dietKind, allergens), status: v.state as CardState, ...(v.state === 'caution' && v.reasons.length ? { reasons: v.reasons } : {}) });
      }
      continue;
    }
    const card = cardOf(r, o.dietKind);
    out.push({ ...card, foodFirst: allergenSafeFoodFirst(card.foodFirst, allergens), status: p.state as CardState, ...(p.state === 'caution' && p.reasons.length ? { reasons: p.reasons } : {}) });
  }
  return { cards: out, held, hiddenForSafety: held.filter((h) => h.state !== 'unchecked').length };
}

/** Status words of a product the person already takes (the shared `takenProductStatus`). */
const TAKEN_WORD = { caution: 'Caution', review: 'Review', unchecked: 'Unchecked' } as const;

/**
 * The status of a product the person already takes (D7-03): the log stays accurate and recordable; the shared decision
 * shows as a short word with its first reason ("Review · kidney disease", "Unchecked · kidney disease (not answered)"),
 * never a stop or start instruction. Their own refusal list does not apply to their own row; a clinician stop does.
 */
export function takingCaution(supplementId: string | null | undefined, safety: FoodSafetyContext): string | null {
  if (!supplementId) return null;
  const r = supplementRecord(supplementId);
  if (!r) return null;
  const d = suggestionDecision(r, { ...safety, refused: [] });
  const status = takenProductStatus(d);
  if (status === 'none') return null;
  const why = reasonWords(d)[0];
  return why ? `${TAKEN_WORD[status]} · ${why}` : TAKEN_WORD[status];
}

/**
 * "Food first" text: safety-relevant flags and food-first suggestions only (no products). With the person's confirmed
 * allergies (`confirmedAllergens`, A1-033) a suggestion naming the allergen food is dropped (milk allergy: no curd/paneer).
 */
export function foodFirstLines(dietKind: DietKind | null, allergens: { milk: boolean; soy: boolean } = { milk: false, soy: false }): { flags: string[]; suggestions: string[] } {
  const s = FOOD_COPY.supplements;
  return {
    flags: dietKind === 'omnivore' ? [] : [s.b12],
    suggestions: [s.foodFirstLines.protein, s.foodFirstLines.fibre].filter((t) => allergenSafeFoodFirst(t, allergens) === t),
  };
}

export interface NoBenefitModel {
  record: NoBenefitRecord;
  name: string;
  reason: string;
  grade: EvidenceGrade;
}

/** "Things that won't help your goals": the no-benefit list with plain reasons. */
export function noBenefitItems(): NoBenefitModel[] {
  return NO_EXPECTED_BENEFIT.map((r) => ({ record: r, name: r.name, reason: FOOD_COPY.noBenefitReasons[r.id] ?? r.reason, grade: r.certainty }));
}
