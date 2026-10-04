/**
 * The recipe sheet (› on a slot, or `?recipe=:slot`): title, cuisine, servings, active and waiting minutes,
 * equipment, ingredients (household unit + raw grams; kitchen-scale users see grams only), steps, per serving with
 * likely ranges, the "estimated composition" mark and why it fits. Without a recipe it shows the slot's targets.
 * Sheet below 1024 px, side panel above (ResponsivePanel).
 */
import type { ReactNode } from 'react';
import { Engraved, InlineWarning, Key, KeyValueList, ResponsivePanel, Section, energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { Est } from '@/living';
import { EstimateReadout } from '../../components/Estimate';
import { grams, kcal } from '../../format';
import { FOOD_COPY, capitalise } from '../copy';
import { useFoodProfile } from '../profile';
import { exampleFoods, type MealSlotTarget, type RecipeSuggestion } from '../recipes';
import { RecipeEquipmentLine } from '@/features/food/RecipeEquipmentLine';

const R = FOOD_COPY.recipe;

export interface RecipeSheetProps {
  open: boolean;
  onClose(): void;
  target: MealSlotTarget | null;
  recipe?: RecipeSuggestion;
  accepted: boolean;
  quiet: boolean;
  kitchenScale: boolean;
  canPlan: boolean;
  onAccept(recipe: RecipeSuggestion): void;
  onSwap(): void;
  onRemove(): void;
}

function EstRow({ est, unit }: { est: Est | undefined; unit: string }) {
  if (!est) return null;
  return <EstimateReadout value={est.value} sd={est.sd} unit={unit} approx />;
}

export function RecipeSheet({ open, onClose, target, recipe, accepted, quiet, kitchenScale, canPlan, onAccept, onSwap, onRemove }: RecipeSheetProps) {
  const { dietKind } = useFoodProfile();
  const eu = useEnergyUnit();
  if (!target) return null;
  let footer: ReactNode = null;
  if (recipe && accepted) {
    footer = (
      <Key variant="quiet" onClick={onRemove}>
        {R.remove}
      </Key>
    );
  } else if (recipe && canPlan) {
    footer = (
      <>
        <Key onClick={() => onAccept(recipe)}>{FOOD_COPY.slot.accept}</Key>
        <Key onClick={onSwap}>{FOOD_COPY.slot.swap}</Key>
      </>
    );
  }
  return (
    <ResponsivePanel open={open} onClose={onClose} title={recipe ? recipe.dish : R.slotTitle(target.name)} footer={footer ?? undefined} defaultDetent="full">
      {recipe ? (
        <div className="lv-food-sheet">
          <KeyValueList
            items={[
              { key: R.cuisine, value: recipe.cuisine },
              { key: R.servingsLabel, value: R.servings(recipe.servings) },
              { key: R.time, value: [R.active(recipe.activeMin), recipe.passiveMin ? R.passive(recipe.passiveMin) : null].filter(Boolean).join(' · ') },
              ...(recipe.equipment.length ? [{ key: R.equipment, value: <RecipeEquipmentLine equipment={recipe.equipment} bare /> }] : []),
            ]}
          />
          <Section label={R.ingredients}>
            <ul className="lv-food-sheet__ingredients">
              {recipe.ingredients.map((i) => (
                <li key={i.name}>
                  <span>{i.name}</span>
                  <span className="lm-num lv-food-sheet__amount">{kitchenScale || !i.household ? `${grams(i.grams)} g` : `${i.household} · ${grams(i.grams)} g`}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section label={R.steps}>
            <ol className="lv-food-sheet__steps">
              {recipe.steps.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ol>
          </Section>
          <Section label={R.perServing}>
            {quiet ? (
              <p className="lv-food-note">{R.numbersHidden}</p>
            ) : (
              <KeyValueList
                items={[
                  { key: R.energy, value: <EstRow est={recipe.perServing.energyKcal} unit="kcal" /> },
                  { key: R.protein, value: <EstRow est={recipe.perServing.proteinG} unit="g" /> },
                  { key: R.carbs, value: <EstRow est={recipe.perServing.carbG} unit="g" /> },
                  { key: R.fat, value: <EstRow est={recipe.perServing.fatG} unit="g" /> },
                  ...(recipe.perServing.fibreG ? [{ key: R.fibre, value: <EstRow est={recipe.perServing.fibreG} unit="g" /> }] : []),
                ]}
              />
            )}
            {recipe.estimatedComposition ? (
              <InlineWarning severity="info">
                <Engraved>{FOOD_COPY.slot.estimated}</Engraved> {recipe.estimatedComposition}
              </InlineWarning>
            ) : null}
          </Section>
          <Section label={R.why}>
            <p>{capitalise(recipe.why)}</p>
            {quiet ? null : <p className="lv-food-note">{recipe.fit.text}</p>}
          </Section>
        </div>
      ) : (
        <div className="lv-food-sheet">
          {quiet ? null : (
            <KeyValueList
              items={[
                { key: R.targetRows.energy, value: <span className="lm-num">{energyInText(`${kcal(target.energyKcal)} kcal`, eu)}</span> },
                { key: R.targetRows.protein, value: <span className="lm-num">{grams(target.proteinG)} g</span> },
                { key: R.targetRows.carbs, value: <span className="lm-num">{grams(target.carbG)} g</span> },
                { key: R.targetRows.fat, value: <span className="lm-num">{grams(target.fatG)} g</span> },
              ]}
            />
          )}
          <p>{FOOD_COPY.slot.plainQuiet(exampleFoods(target, dietKind))}</p>
          <p className="lv-food-note">{R.noRecipe}</p>
        </div>
      )}
    </ResponsivePanel>
  );
}
