/**
 * One meal on Food's day rail (the same rail as Today's plan, living.css): time · status node · the meal's name (it
 * opens the recipe sheet) · its targets as a compact readout, ONE key for eating it as planned and a quiet ⋯ for the
 * rest (something else, add more, the recipe sheet). A logged meal collapses to what was logged plus Undo. Below the
 * two lines: the suggested or accepted recipe with its planning keys (Accept · Swap), never merged with eating.
 */
import { useId, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';
import { Chip, Engraved, IconKey, Key, Menu, Spinner, cx, energyInText, type MenuItem } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { LogEntrySummary } from '@/living';
import { EstimateReadout, SourceChip, sourceLabel } from '../../components/Estimate';
import { fmtClock, grams, kcal } from '../../format';
import { TargetReadout } from '../../components/TargetReadout';
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
  /** Undo of an "As planned" made here, while it is held. */
  onUndo?: () => void;
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
      {entry.conflict ? <Chip>{entry.conflict.versions.length} versions</Chip> : null}
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
  const subId = useId();
  const eu = useEnergyUnit();
  const { dietKind } = useFoodProfile();
  const { target, run, accepted, quiet } = p;
  const suggested = run?.state === 'ready' ? run.recipe : undefined;
  const recipe = accepted ?? suggested;
  const working = run?.state === 'working' || run?.state === 'waiting';
  const name = target.name;

  const primary: ReactNode = p.done ? (
    p.onUndo ? (
      <Key size="sm" variant="quiet" aria-label={`Undo ${name}`} onClick={p.onUndo}>
        {FOOD_COPY.toasts.undo}
      </Key>
    ) : null
  ) : p.canLog ? (
    <Key size="sm" onClick={p.onAteThis} aria-label={C.ateThisName(name)}>
      {C.ateThis}
    </Key>
  ) : null;
  const more: MenuItem[] = [
    ...(p.canLog ? [p.done ? { id: 'more', label: C.addMore, onSelect: p.onAteElse } : { id: 'else', label: C.ateElse, onSelect: p.onAteElse }] : []),
    { id: 'open', label: C.openItem, onSelect: p.onOpen },
  ];

  return (
    <li className={cx('lv-item lv-meal', 'is-open', p.done && 'is-done')} data-state={p.done ? 'done' : 'empty'} aria-labelledby={headingId}>
      <span className="lv-item__time lm-num">{fmtClock(target.clockH)}</span>
      <span className="lv-item__node" aria-hidden="true" />
      <h3 id={headingId} className="lv-meal__name">
        <button type="button" className="lv-item__label" aria-describedby={subId} onClick={p.onOpen}>
          {name}
        </button>
      </h3>
      <div className="lv-item__sub" id={subId}>
        {p.done ? (
          p.entries.length > 0 ? (
            <ul className="lv-food-logged-list">
              {p.entries.map((e) => (
                <LoggedRow key={e.id} entry={e} quiet={quiet} />
              ))}
            </ul>
          ) : (
            <span className="lv-item__word">{C.markedAsPlanned}</span>
          )
        ) : quiet ? (
          <span>{C.plainQuiet(exampleFoods(target, dietKind))}</span>
        ) : (
          <>
            <TargetReadout text={energyInText(C.numbers(kcal(target.energyKcal), grams(target.proteinG)), eu)} />
            <TargetReadout text={C.carbsFat(grams(target.carbG), grams(target.fatG))} className="lv-rd--extra" />
          </>
        )}
      </div>
      <span className="lv-item__keys">
        {primary}
        <Menu label={C.moreName(name)} items={more} trigger={(t) => <IconKey {...t} size="sm" icon={Ellipsis} label={C.moreName(name)} />} />
      </span>

      <div className="lv-item__body">
        {working ? (
          <p className="lv-food-slot__working" role="status">
            <Spinner size={12} /> {FOOD_COPY.meals.progress.working}
          </p>
        ) : recipe && (!p.done || accepted) ? (
          <div className="lv-food-recipe-wrap">
            <RecipeCard recipe={recipe} accepted={!!accepted} quiet={quiet} familyFoodMode={p.familyFoodMode} />
            {p.canPlan && suggested && !accepted ? (
              <span className="lv-food-slot__group">
                <Key size="sm" onClick={() => p.onAccept(suggested)} aria-label={C.acceptName(mainDish(suggested.dish), name)}>
                  {C.accept}
                </Key>
                <Key size="sm" variant="quiet" onClick={p.onSwap} aria-label={C.swapName(name)} disabled={p.busy}>
                  {C.swap}
                </Key>
              </span>
            ) : null}
          </div>
        ) : null}

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
      </div>
    </li>
  );
}
