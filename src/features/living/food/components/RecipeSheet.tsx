/**
 * The recipe sheet (› on a slot, or `?recipe=:slot`): title, cuisine, servings, active and waiting minutes,
 * equipment, ingredients (household unit + raw grams; kitchen-scale users see grams only), steps, per serving with
 * likely ranges, the "estimated composition" mark and why it fits. Without a recipe it shows the slot's targets.
 * Sheet below 1024 px, side panel above (ResponsivePanel).
 */
import type { ReactNode } from 'react';
import {
  Engraved,
  HeroNumber,
  InlineWarning,
  Key,
  KeyLink,
  KeyValueList,
  MonoMeta,
  ResponsivePanel,
  Section,
  energyInText,
  formatNumber,
  toEnergyUnit,
} from '@/components';
import { paths } from '@/app/paths';
import { useCoachOnServer } from '../../coach/availability';
import { useEnergyUnit } from '@/state/settingsStore';
import type { Est } from '@/living';
import { EstimateReadout } from '../../components/Estimate';
import { fmtLikely, grams, kcal } from '../../format';
import { FOOD_COPY, capitalise } from '../copy';
import { useFoodProfile } from '../profile';
import { exampleFoods, useRecipeProvider, type MealSlotTarget, type RecipeSuggestion } from '../recipes';
import { RecipeEquipmentLine } from '@/features/food/RecipeEquipmentLine';
import { MacroSplit } from './MacroSplit';
import './foodSheets.css';

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

export function RecipeSheet({
  open,
  onClose,
  target,
  recipe,
  accepted,
  quiet,
  kitchenScale,
  canPlan,
  onAccept,
  onSwap,
  onRemove,
}: RecipeSheetProps) {
  const { dietKind } = useFoodProfile();
  const eu = useEnergyUnit();
  const provider = useRecipeProvider();
  // paired: the Coach on the server plans recipes; no "set up a provider" then
  const onServer = useCoachOnServer();
  const needsProvider = !provider.available && !onServer;
  if (!target) return null;
  let footer: ReactNode = null;
  if (recipe && accepted) {
    footer = (
      <Key variant="text" onClick={onRemove}>
        {R.remove}
      </Key>
    );
  } else if (recipe && canPlan) {
    footer = (
      <>
        <Key variant="primary" onClick={() => onAccept(recipe)}>
          {FOOD_COPY.slot.accept}
        </Key>
        <Key variant="text" onClick={onSwap}>
          {FOOD_COPY.slot.swap}
        </Key>
      </>
    );
  }
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={recipe ? recipe.dish : R.slotTitle(target.name)}
      footer={footer ?? undefined}
      defaultDetent="full"
    >
      {recipe ? (
        <div className="lv-food-sheet">
          <div className="lv-food-sheet__summary">
            {quiet ? (
              <>
                <HeroNumber
                  size="num"
                  quietWord={recipe.fit.kind === 'fits' ? 'Fits' : FOOD_COPY.slot.closestQuiet}
                  label={recipe.fit.kind === 'fits' ? 'Fits' : FOOD_COPY.slot.closestQuiet}
                />
                <p className="lv-food-note">{R.numbersHidden}</p>
              </>
            ) : (
              <>
                <HeroNumber
                  value={toEnergyUnit(recipe.perServing.energyKcal.value, eu)}
                  format={(value) =>
                    `${recipe.perServing.energyKcal.sd > 0 ? '≈ ' : ''}${formatNumber(value, 0)}`
                  }
                  unit={eu}
                  size="num-l"
                  hue="food"
                  range={
                    recipe.perServing.energyKcal.sd > 0
                      ? `Likely ${fmtLikely(toEnergyUnit(recipe.perServing.energyKcal.value, eu), toEnergyUnit(recipe.perServing.energyKcal.sd, eu))}`
                      : undefined
                  }
                  label={`Per serving: ${recipe.perServing.energyKcal.sd > 0 ? 'about ' : ''}${formatNumber(toEnergyUnit(recipe.perServing.energyKcal.value, eu), 0)} ${eu}${recipe.perServing.energyKcal.sd > 0 ? `, range ${fmtLikely(toEnergyUnit(recipe.perServing.energyKcal.value, eu), toEnergyUnit(recipe.perServing.energyKcal.sd, eu))}` : ''}`}
                />
                <MacroSplit
                  proteinG={recipe.perServing.proteinG.value}
                  carbG={recipe.perServing.carbG.value}
                  fatG={recipe.perServing.fatG.value}
                />
              </>
            )}
            <MonoMeta
              tone="ink"
              items={[
                R.active(recipe.activeMin),
                recipe.passiveMin ? R.passive(recipe.passiveMin) : null,
                R.servings(recipe.servings),
              ]}
            />
          </div>
          <KeyValueList
            items={[
              { key: R.cuisine, value: recipe.cuisine },
              ...(recipe.equipment.length
                ? [{ key: R.equipment, value: <RecipeEquipmentLine equipment={recipe.equipment} bare /> }]
                : []),
            ]}
          />
          <Section label={R.ingredients}>
            <ul className="lv-food-sheet__ingredients">
              {recipe.ingredients.map((i) => (
                <li key={i.name}>
                  <span>{i.name}</span>
                  <span className="lm-num lv-food-sheet__amount">
                    {kitchenScale || !i.household
                      ? `${grams(i.grams)} g`
                      : `${i.household} · ${grams(i.grams)} g`}
                  </span>
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
                  { key: R.protein, value: <EstRow est={recipe.perServing.proteinG} unit="g" /> },
                  { key: R.carbs, value: <EstRow est={recipe.perServing.carbG} unit="g" /> },
                  { key: R.fat, value: <EstRow est={recipe.perServing.fatG} unit="g" /> },
                  ...(recipe.perServing.fibreG
                    ? [{ key: R.fibre, value: <EstRow est={recipe.perServing.fibreG} unit="g" /> }]
                    : []),
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
                {
                  key: R.targetRows.energy,
                  value: (
                    <span className="lm-num">{energyInText(`${kcal(target.energyKcal)} kcal`, eu)}</span>
                  ),
                },
                {
                  key: R.targetRows.protein,
                  value: <span className="lm-num">{grams(target.proteinG)} g</span>,
                },
                { key: R.targetRows.carbs, value: <span className="lm-num">{grams(target.carbG)} g</span> },
                { key: R.targetRows.fat, value: <span className="lm-num">{grams(target.fatG)} g</span> },
              ]}
            />
          )}
          <p>{FOOD_COPY.slot.plainQuiet(exampleFoods(target, dietKind))}</p>
          <p className="lv-food-note">{R.noRecipe}</p>
          {/* r068 L9: what recipes need is said here, in the recipe flow, with a real key (not on the meal sheet) */}
          {needsProvider ? (
            <div className="lv-food-sheet__provider">
              <p className="lv-food-note">{FOOD_COPY.meals.noProvider}</p>
              <KeyLink to={paths.settings()} variant="outlined" size="sm">
                {FOOD_COPY.meals.setUpProvider}
              </KeyLink>
            </div>
          ) : null}
        </div>
      )}
    </ResponsivePanel>
  );
}
