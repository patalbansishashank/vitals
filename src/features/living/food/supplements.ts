/**
 * Supplements on Food (design/screens/living-mode.md, Food › Supplements; docs/SUITE_SPEC.md §8.5): the prescription's
 * supplements with a "taken" tick, and — only when the person chose "open" — catalogue cards for items relevant to the
 * plan's goals. Contraindicated items never show as a card. Catalogue selection only; nothing here is scored.
 */
import { NO_EXPECTED_BENEFIT, SEED_SUPPLEMENTS } from '@/content/catalogues';
import type { NoBenefitRecord, SupplementRecord } from '@/catalogues/types';
import { doseText, supplementShortName, type SupplementRow } from '@/catalogues/supplements';
import type { EvidenceGrade } from '@/components';
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
 * Cards for the "open" stance: items that are offered for the plan's goals (or offered on a risk the diet carries),
 * compatible with the diet, not already prescribed. Items whose contraindication matches a safety flag are returned
 * separately so the screen can say they were left out, never show them.
 */
export function supplementCards(o: { prescribed: readonly string[]; dietKind: DietKind | null; safetyFlags: readonly string[]; goals?: readonly string[] }): {
  cards: SupplementCardModel[];
  hiddenForSafety: number;
} {
  const goals = new Set(o.goals ?? PLAN_GOAL_TAGS);
  const prescribed = new Set(o.prescribed.map((p) => supplementRecord(p)?.id ?? p));
  const flags = new Set(o.safetyFlags);
  const plantBased = o.dietKind === 'vegan' || o.dietKind === 'vegetarian' || o.dietKind === 'eggetarian';
  const out: SupplementCardModel[] = [];
  let hidden = 0;
  for (const r of SEED_SUPPLEMENTS) {
    if (prescribed.has(r.id)) continue;
    const forGoals = r.status === 'offer' && r.goals.some((g) => goals.has(g));
    const forRisk = r.status === 'offer_if_risk' && r.id === 'vitamin_b12' && (plantBased || o.dietKind === null);
    if (!forGoals && !forRisk) continue;
    if (o.dietKind === 'vegan' && r.diet.vegan.ok === false) continue;
    if ((o.dietKind === 'vegetarian' || o.dietKind === 'eggetarian') && r.diet.vegetarian.ok === false) continue;
    if (r.contraindications.some((c) => flags.has(c.flag))) {
      hidden += 1;
      continue;
    }
    out.push(cardOf(r, o.dietKind));
  }
  return { cards: out, hiddenForSafety: hidden };
}

/** "Food first" text: safety-relevant flags and food-first suggestions only (no products). */
export function foodFirstLines(dietKind: DietKind | null): { flags: string[]; suggestions: string[] } {
  const s = FOOD_COPY.supplements;
  return {
    flags: dietKind === 'omnivore' ? [] : [s.b12],
    suggestions: [s.foodFirstLines.protein, s.foodFirstLines.fibre],
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
