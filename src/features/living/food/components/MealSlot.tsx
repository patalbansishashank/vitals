/**
 * One meal slot (PrescriptionRow look, COMPONENTS §13.10): time · glyph · slot name + target · status · chevron, then
 * the slot body — plain targets, a suggested or accepted recipe, the recipe run state — logged rows with their
 * estimate and source, and the two kinds of action that are never merged: planning (Accept · Swap) and eating
 * (I ate this · I ate something else).
 */
import { useId } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Engraved, Glyphs, Icon, IconKey, Key, Spinner, cx, energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { LogEntrySummary } from '@/living';
import { EstimateReadout, SourceChip, sourceLabel } from '../../components/Estimate';
import { fmtClock, grams, kcal } from '../../format';
import { FOOD_COPY } from '../copy';
import { entryMethod } from '../ledger';
import type { SlotRun } from '../mealPlanStore';
import { useFoodProfile } from '../profile';
import { exampleFoods, mainDish, type MealSlotTarget, type RecipeSuggestion } from '../recipes';
import { RecipeEquipmentLine } from '@/features/food/RecipeEquipmentLine';
import { DishBecauseChips } from '@/markers/ui/food'; // E20: markers

const C = FOOD_COPY.slot;

export interface MealSlotProps {
  target: MealSlotTarget;
  run?: SlotRun;
  accepted?: RecipeSuggestion;
  /** After a swap: the replaced dish ("paneer bhurji"). */
  swapPrompt?: string;
  entries: readonly LogEntrySummary[];
  /** The slot is logged or marked (checklist). */
  done: boolean;
  quiet: boolean;
  /** Logging allowed (today or a past day). */
  canLog: boolean;
  /** Planning allowed (recipes available, food rules answered, today or ahead). */
  canPlan: boolean;
  familyFoodMode?: boolean;
  busy?: boolean;
  onAteThis(): void;
  onAteElse(): void;
  onAccept(recipe: RecipeSuggestion): void;
  onSwap(): void;
  onRetry(): void;
  onOpen(): void;
  onDontSuggest(dish: string): void;
  onKeepSuggesting(): void;
}

/** A logged meal as a row: label + estimate (≈ value, likely range) + source. */
export function LoggedRow({ entry, quiet }: { entry: LogEntrySummary; quiet: boolean }) {
  const e = entry.energyKcal;
  const known = !!e && (e.value > 0 || e.sd > 0);
  const source = { label: sourceLabel(entry.source, entryMethod(entry)) };
  return (
    <li className="lv-food-logged">
      <span className="lv-food-logged__label">{entry.label}</span>
      {quiet ? (
        <SourceChip source={source} />
      ) : known ? (
        <EstimateReadout value={e.value} sd={e.sd} unit="kcal" approx short source={source} />
      ) : (
        <span className="lv-food-logged__none">
          {C.notEstimated} <SourceChip source={source} />
        </span>
      )}
    </li>
  );
}

function RecipeCard({ recipe, accepted, quiet, familyFoodMode }: { recipe: RecipeSuggestion; accepted: boolean; quiet: boolean; familyFoodMode?: boolean }) {
  const meta = [recipe.cuisine, C.minutes(recipe.activeMin), quiet && recipe.fit.kind === 'closest' ? C.closestQuiet : recipe.fit.text].filter(Boolean);
  return (
    <div className="lv-food-recipe">
      <Engraved>{accepted ? C.accepted : C.suggested}</Engraved>
      <p className="lv-food-recipe__dish">{familyFoodMode ? C.familyEat(recipe.portionLine) : recipe.dish}</p>
      <p className="lv-food-recipe__meta">{meta.join(' · ')}</p>
      {recipe.equipment.length ? (
        <p className="lv-food-recipe__meta">
          <RecipeEquipmentLine equipment={recipe.equipment} />
        </p>
      ) : null}
      {/* E20: markers — the dish hits a capped lever (saturated fat, cholesterol, alcohol): "because your LDL was …" */}
      {familyFoodMode ? null : <DishBecauseChips dish={recipe} />}
      {familyFoodMode ? null : <p className="lv-food-recipe__portions">{recipe.portionLine}</p>}
      {recipe.estimatedComposition ? <Engraved className="lv-food-mark">{C.estimated}</Engraved> : null}
      {recipe.fit.kind === 'closest' && /protein/i.test(recipe.fit.text) ? <p className="lv-food-recipe__hint">{C.closestSide}</p> : null}
    </div>
  );
}

export function PlainTargets({ target, quiet }: { target: MealSlotTarget; quiet: boolean }) {
  const { dietKind } = useFoodProfile();
  const ex = exampleFoods(target, dietKind);
  if (quiet) return <p className="lv-food-plain">{C.plainQuiet(ex)}</p>;
  return (
    <p className="lv-food-plain">
      <span className="lm-num">{C.plain(grams(target.proteinG), grams(target.carbG), grams(target.fatG))}</span> — {C.example(ex)}
    </p>
  );
}

export function MealSlot(p: MealSlotProps) {
  const headingId = useId();
  const eu = useEnergyUnit();
  const { target, run, accepted, quiet } = p;
  const suggested = run?.state === 'ready' ? run.recipe : undefined;
  const recipe = accepted ?? suggested;
  const working = run?.state === 'working' || run?.state === 'waiting';
  const name = target.name;
  return (
    <li className={cx('lv-food-slot', p.done && 'is-done')} aria-labelledby={headingId}>
      <div className="lv-food-slot__head">
        <span className="lv-food-slot__time lm-num">{fmtClock(target.clockH)}</span>
        <Icon icon={Glyphs.MealDot} size={20} className="lv-food-slot__glyph" />
        <div className="lv-food-slot__label">
          <h3 id={headingId} className="lv-food-slot__name">
            {name}
          </h3>
          {quiet ? null : <span className="lv-food-slot__target lm-num">{energyInText(C.numbers(kcal(target.energyKcal), grams(target.proteinG)), eu)}</span>}
        </div>
        {p.done ? (
          <span className="lv-food-slot__status">
            <Icon icon={Check} size={16} /> {C.logged}
          </span>
        ) : null}
        <IconKey icon={ChevronRight} label={C.open(name)} size="sm" onClick={p.onOpen} />
      </div>

      <div className="lv-food-slot__body">
        {working ? (
          <p className="lv-food-slot__working" role="status">
            <Spinner size={12} /> {FOOD_COPY.meals.progress.working}
          </p>
        ) : recipe ? (
          <RecipeCard recipe={recipe} accepted={!!accepted} quiet={quiet} familyFoodMode={p.familyFoodMode} />
        ) : (
          <PlainTargets target={target} quiet={quiet} />
        )}

        {!working && !accepted && run?.state === 'error' ? (
          <p className="lv-food-slot__error">
            {run.message}{' '}
            {p.canPlan ? (
              <Key variant="quiet" size="sm" onClick={p.onRetry} aria-label={C.tryAgainName(name)}>
                {C.tryAgain}
              </Key>
            ) : null}
          </p>
        ) : null}

        {p.swapPrompt && suggested && !accepted ? (
          <div className="lv-food-slot__prompt" role="group" aria-label={C.dontSuggest(p.swapPrompt)}>
            <span>{C.dontSuggest(p.swapPrompt)}</span>
            <Key size="sm" onClick={() => p.onDontSuggest(p.swapPrompt!)}>
              {C.dontSuggestKey}
            </Key>
            <Key size="sm" variant="quiet" onClick={p.onKeepSuggesting}>
              {C.itsFine}
            </Key>
          </div>
        ) : null}

        {p.entries.length > 0 ? (
          <ul className="lv-food-logged-list">
            {p.entries.map((e) => (
              <LoggedRow key={e.id} entry={e} quiet={quiet} />
            ))}
          </ul>
        ) : p.done ? (
          <p className="lv-food-slot__marked">
            <Engraved>{C.markedAsPlanned}</Engraved>
          </p>
        ) : null}

        <div className="lv-food-slot__actions">
          {p.canPlan && suggested && !accepted && !working ? (
            <span className="lv-food-slot__group">
              <Key size="sm" onClick={() => p.onAccept(suggested)} aria-label={C.acceptName(mainDish(suggested.dish), name)}>
                {C.accept}
              </Key>
              <Key size="sm" onClick={p.onSwap} aria-label={C.swapName(name)} disabled={p.busy}>
                {C.swap}
              </Key>
            </span>
          ) : null}
          {p.canLog ? (
            <span className="lv-food-slot__group">
              {p.done ? (
                <Key size="sm" variant="quiet" onClick={p.onAteElse} aria-label={C.addMoreName(name)}>
                  {C.addMore}
                </Key>
              ) : (
                <>
                  <Key size="sm" onClick={p.onAteThis} aria-label={C.ateThisName(name)}>
                    {C.ateThis}
                  </Key>
                  <Key size="sm" variant="quiet" onClick={p.onAteElse} aria-label={C.ateElseName(name)}>
                    {C.ateElse}
                  </Key>
                </>
              )}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
