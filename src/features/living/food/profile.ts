/**
 * What Food needs to know about the person's food setup: whether the food rules are answered (recipes pause until
 * then — they are never guessed), the rules themselves for the recipe provider, family-food mode, a kitchen scale, the
 * supplement stance and the safety flags that hide supplement cards. Read from the intake document; tests and the
 * gallery override it with `<FoodProfileContext.Provider>`.
 */
import { createContext, useContext, useMemo } from 'react';
import { toSectionV2, type SupplementStance, type SupplementsSectionV2 } from '@/catalogues/supplements';
import { useIntakeDoc } from '@/features/intake/doc';
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
   * Safety flags from the screening answers; a supplement whose contraindication matches is never shown as a card.
   * TODO(E2): read the screening flags (`safety` collection) once they are exposed to features.
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

export const FoodProfileContext = createContext<FoodProfileView | null>(null);

export function useFoodProfile(): FoodProfileView {
  const doc = useIntakeDoc();
  const override = useContext(FoodProfileContext);
  return useMemo(() => override ?? profileFromIntake(doc), [override, doc]);
}
