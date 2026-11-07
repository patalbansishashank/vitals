/** Pure intake-to-Food projection, shared by screens and headless marker context reads. */
import { toSectionV2, type SupplementStance, type SupplementsSectionV2 } from '@/catalogues/supplements';
import type { DietProfile, IntakeDoc } from '@/features/intake/types';

export type DietKind = 'vegan' | 'vegetarian' | 'eggetarian' | 'omnivore';

export interface FoodProfileView {
  /** What you eat, allergies and rules are answered. */
  dietAnswered: boolean;
  /** Hard filters handed to the recipe provider. */
  foodRules?: DietProfile;
  /** Null until the food rules are answered. */
  dietKind: DietKind | null;
  /** Someone else cooks: slots show portions and add-ons instead of dishes. */
  familyFoodMode: boolean;
  /** Kitchen-scale users see grams only. */
  kitchenScale: boolean;
  supplementStance: SupplementStance;
  /** The person's supplement rows (taking, at home, not for me); null until the question is answered. */
  supplements?: SupplementsSectionV2 | null;
  /**
   * Extra safety flags (tests and the gallery set them; the app reads the real state through `useFoodSafety`); a
   * supplement whose contraindication matches is never shown as a card.
   */
  safetyFlags: readonly string[];
}

function dietKindOf(d: DietProfile): DietKind {
  const a = d.animalFoods;
  if (a.meat !== 'none' || a.fish || a.shellfish) return 'omnivore';
  if (a.eggs === 'yes') return 'eggetarian';
  if (a.dairy === 'none') return 'vegan';
  return 'vegetarian';
}

/** The view of `intake/me` Food reads. */
export function profileFromIntake(doc: IntakeDoc): FoodProfileView {
  const supplements = toSectionV2(doc.supplements);
  const diet = doc.diet && doc.diet.rulesComplete ? (doc.diet as DietProfile & { rulesComplete: true }) : null;
  return {
    dietAnswered: !!diet,
    ...(diet ? { foodRules: diet } : {}),
    dietKind: diet ? dietKindOf(diet) : null,
    familyFoodMode: !!diet?.familyFoodMode,
    kitchenScale: !!doc.kitchen?.equipment.includes('kitchen_scale'),
    supplementStance: supplements?.stance ?? 'food_first',
    supplements,
    safetyFlags: [],
  };
}

