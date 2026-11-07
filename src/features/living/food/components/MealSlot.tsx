/**
 * One meal on Food's day rail (the same rail as Today's plan, living.css): time · status node · the meal's name · its
 * targets as a compact readout, and ONE key for eating it as planned (or Undo right after). A tap on the meal's name
 * opens the meal's row sheet — the same sheet Today opens (../../components/MealSheet: as planned · partly · skipped,
 * something else or add more, the recipe and targets); there is no per-row ⋯. A logged meal collapses to what was
 * logged, or to its answer ("skipped"). Below the two lines: the suggested or accepted recipe, its dish opening the
 * recipe sheet, with its planning keys (Accept · Swap), never merged with eating.
 */
import { ChevronRight, Utensils } from 'lucide-react';
import { Chip, Engraved, Icon, Key, MonoMeta, RailNode, RailRow, Spinner, cx, energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { LogEntrySummary } from '@/living';
import { EstimateReadout, SourceChip, type SourceInfo } from '../../components/Estimate';
import { fmtClock, grams, kcal, mealName } from '../../format';
import { TargetReadout } from '../../components/TargetReadout';
import { TODAY_COPY } from '../../copy';
import type { RowStatus } from '../../today/model';
import { FOOD_COPY, capitalise } from '../copy';
import type { SlotRun } from '../mealPlanStore';
import { useFoodProfile } from '../profile';
import { exampleFoods, mainDish, type MealSlotTarget, type RecipeSuggestion } from '../recipes';
import { labelInSlot } from '../slots';
import { MacroSplit } from './MacroSplit';
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
  /** The row's answer, read as Today reads it (a marked slot with no entry may be "skipped" or "partly"). */
  status?: RowStatus;
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
  onAccept(recipe: RecipeSuggestion): void;
  onSwap(): void;
  onRetry(): void;
  /** The row's tap: opens the meal's row sheet. */
  onOpen(): void;
  /** The recipe's dish: opens the recipe sheet. */
  onRecipe(): void;
  onDontSuggest(dish: string): void;
  onKeepSuggesting(): void;
}

/**
 * A logged meal as a row: what was logged and about how much ("≈ 590 kcal"). Who typed it is not shown: only a Coach
 * estimate carries a chip, because it is the one that may need a look.
 */
export function LoggedRow({ entry, quiet, slotName, hideLabel }: { entry: LogEntrySummary; quiet: boolean; slotName?: string; hideLabel?: boolean }) {
  const e = entry.energyKcal;
  const known = !!e && (e.value > 0 || e.sd > 0);
  const source: SourceInfo | undefined = entry.aiEstimated || entry.source === 'ai' ? { label: C.coachEstimate } : undefined;
  const label = labelInSlot(entry.label, slotName);
  return (
    <li className="lv-food-logged">
      {label && !hideLabel ? <span className="lv-food-logged__label">{label}</span> : null}
      {entry.conflict ? <Chip>{entry.conflict.versions.length} versions</Chip> : null}
      {quiet ? (
        source ? <SourceChip source={source} /> : null
      ) : known ? (
        <EstimateReadout value={e.value} sd={e.sd} unit="kcal" approx {...(source ? { source } : {})} />
      ) : (
        <span className="lv-food-logged__none">
          {C.notEstimated}
          {source ? <SourceChip source={source} /> : null}
        </span>
      )}
    </li>
  );
}

/**
 * Food logged outside the plan's meals, as a stop on the same rail at the time it was eaten (r068 L8): named by its time
 * of day ("Lunch") unless a planned meal already has that name, what was logged under it. On a fast day a meal outside the
 * eating window says so on its own row (r068 L24).
 */
export function OtherMealRow({ entry, quiet, taken, outside }: { entry: LogEntrySummary; quiet: boolean; taken: ReadonlySet<string>; outside?: boolean }) {
  const h = entry.clockH;
  const byTime = h !== undefined ? mealName('meal1', h) : '';
  const name = byTime && !taken.has(byTime.toLowerCase()) ? capitalise(byTime) : FOOD_COPY.meals.other;
  return <RailRow className="lv-meal lv-meal--other" time={h !== undefined ? fmtClock(h) : undefined} node={<RailNode status="done" hue="food" glyph={Utensils} label={`${name}: logged`} />} title={<span className="lv-meal__dish">{entry.label || name}</span>} meta={<><MonoMeta>{name}</MonoMeta><ul className="lv-food-logged-list"><LoggedRow entry={entry} quiet={quiet} hideLabel /></ul>{outside ? <span className="lv-meal__outside">{FOOD_COPY.meals.outsideWindow}</span> : null}</>} />;
}

function RecipeCard({ recipe, target, accepted, quiet, familyFoodMode }: { recipe: RecipeSuggestion; target: MealSlotTarget; accepted: boolean; quiet: boolean; familyFoodMode?: boolean }) {
  const eu = useEnergyUnit();
  return <div className="lv-food-recipe">
    <MonoMeta items={[recipe.cuisine, C.minutes(recipe.activeMin), recipe.equipment.length ? `Needs ${recipe.equipment.join(', ')}` : null]} />
    <div className="lv-food-recipe__fit"><MacroSplit proteinG={recipe.perServing.proteinG.value} carbG={recipe.perServing.carbG.value} fatG={recipe.perServing.fatG.value} quiet={quiet} legend="none" /><MonoMeta>{recipe.fit.kind === 'closest' ? 'Closest fit' : 'Fits'}</MonoMeta></div>
    {!quiet ? <div className="lv-food-recipe__amount"><EstimateReadout value={recipe.perServing.energyKcal.value} sd={recipe.perServing.energyKcal.sd} unit="kcal" variant="mono" /><TargetReadout text={energyInText(`${kcal(target.energyKcal)} target`, eu)} /></div> : null}
    <MonoMeta><span className="lv-food-recipe__state">{accepted ? C.accepted : C.suggested}</span></MonoMeta>
    {familyFoodMode ? null : <DishBecauseChips dish={recipe} />}
    {recipe.estimatedComposition ? <Engraved className="lv-food-mark">{C.estimated}</Engraved> : null}
  </div>;
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
  const eu = useEnergyUnit();
  const { dietKind } = useFoodProfile();
  const { target, run, accepted, quiet } = p;
  const suggested = run?.state === 'ready' ? run.recipe : undefined;
  const recipe = accepted ?? suggested;
  const working = run?.state === 'working' || run?.state === 'waiting';
  const name = target.name;
  // something logged for the slot (its checklist mark, or an entry that names it) reads as logged
  const logged = p.done || p.entries.length > 0;
  const state: RowStatus = !logged ? 'empty' : p.status && p.status !== 'empty' ? p.status : 'done';

  const visibleRecipe = !logged || accepted ? recipe : undefined;
  const dish = logged && p.entries.length && !visibleRecipe ? p.entries.map((e) => labelInSlot(e.label, name)).filter(Boolean).join(', ') || name : visibleRecipe ? p.familyFoodMode ? C.familyEat(visibleRecipe.portionLine) : visibleRecipe.dish : working ? name : capitalise(exampleFoods(target, dietKind));
  return (
    <RailRow className={cx('lv-meal', logged && 'is-done')} time={fmtClock(target.clockH)}
      node={<RailNode status={state} glyph={Utensils} hue="food" label={logged ? p.onUndo ? `Undo ${name}` : `${name}: ${state}` : C.ateThisName(name)} onPress={logged ? p.onUndo : p.canLog ? p.onAteThis : undefined} />}
      title={<span role="heading" aria-level={3} aria-label={name} className="lv-meal__name"><button type="button" aria-label={visibleRecipe ? dish : name} className="lv-meal__open" aria-haspopup="dialog" onClick={visibleRecipe ? p.onRecipe : p.onOpen}><span className="lv-meal__dish">{dish}</span><Icon icon={ChevronRight} size={16} className="lv-meal__chev" /></button></span>}
      meta={<><MonoMeta>{visibleRecipe ? <button type="button" className="lv-meal__targetlink" aria-label={name} onClick={p.onOpen}>{name}</button> : name}{quiet ? logged ? ` · ${state === 'skipped' || state === 'partial' ? TODAY_COPY.rowWord[state] : C.markedAsPlanned}` : '' : null}</MonoMeta>
        {logged ? p.entries.length ? <ul className="lv-food-logged-list">{p.entries.map((e) => <LoggedRow key={e.id} entry={e} quiet={quiet} slotName={name} hideLabel />)}</ul> : <span className="lv-item__word">{state === 'skipped' || state === 'partial' ? TODAY_COPY.rowWord[state] : C.markedAsPlanned}</span> : !quiet ? <><TargetReadout text={energyInText(C.numbers(kcal(target.energyKcal), grams(target.proteinG)), eu)} /><TargetReadout text={C.carbsFat(grams(target.carbG), grams(target.fatG))} className="lv-rd--extra" /></> : null}
      <div className="lv-food-slot__body">
        {working ? (
          <p className="lv-food-slot__working" role="status">
            <Spinner size={12} /> {FOOD_COPY.meals.progress.working}
          </p>
        ) : recipe && (!logged || accepted) ? (
          <div className="lv-food-recipe-wrap">
            <RecipeCard recipe={recipe} target={target} accepted={!!accepted} quiet={quiet} familyFoodMode={p.familyFoodMode} />
            {p.canPlan && suggested && !accepted ? (
              <span className="lv-food-slot__group">
                <Key size="sm" variant="action" onClick={() => p.onAccept(suggested)} aria-label={C.acceptName(mainDish(suggested.dish), name)}>
                  {C.accept}
                </Key>
                <Key size="sm" variant="text" onClick={p.onSwap} aria-label={C.swapName(name)} disabled={p.busy}>
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
              <Key variant="text" size="sm" onClick={p.onRetry} aria-label={C.tryAgainName(name)}>
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
            <Key size="sm" variant="text" onClick={p.onKeepSuggesting}>
              {C.itsFine}
            </Key>
          </div>
        ) : null}
      </div>
      </>}
    />
  );
}
