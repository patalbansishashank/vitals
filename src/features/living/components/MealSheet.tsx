/**
 * The meal's row sheet, one for Today and Food: a tap on a meal row opens it on both pages (SPEC §4: an object row
 * opens its row sheet; the row's other actions live there). Everything in it is read from the day itself, so the two
 * pages show the same sheet:
 * - one fact line: what was logged against the plan ("Logged 430 kcal · planned 1 332 kcal"), or the meal's targets
 *   as a readout (example foods in quiet mode);
 * - how it went, As planned · Partly · Skipped, as one row of three equal keys (today or a past day). The answer it
 *   already has is read from what was logged (./mealMark), so it always agrees with the fact line: food logged with
 *   "As planned" or within the plan's tolerance is As planned, less is Partly, anything else selects nothing; with no
 *   food, the meal's own answer (its slot's, never another meal's). An answer applies at once and replaces what the meal
 *   held, as one change with one Undo (`useMealAnswer`): "as planned" logs the plan, or one serving of the accepted
 *   recipe, in place of the food logged for it, so 430 kcal typed then "As planned" reads the plan, not both;
 * - "I ate something else" ("Add more" once logged), which opens the manual logger, and "Recipe and targets";
 * - when recipes cannot be made for the day, the one reason and the one key that fixes it.
 * The sheet commits nothing of its own, so its header is title · ✕ and the body holds no full-width key.
 */
import { useCallback, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  DottedTrack,
  Key,
  KeyBank,
  KeyLink,
  MonoMeta,
  ResponsivePanel,
  StackBar,
  formatEnergy,
  toast,
} from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { compareDates } from '@/living/dates';
import type { LocalDate, TodayView } from '@/living';
import { ENERGY_TOL_MIN_KCAL, ENERGY_TOL_REL } from '@/living/adherence';
import { useToday } from '../clock';
import { TODAY_COPY } from '../copy';
import { useLivingActions, type ActionOutcome, type MealServing, type RowMark } from '../data/actions';
import { useLiving } from '../data/source';
import { likely } from '../format';
import { FOOD_COPY, capitalise } from '../food/copy';
import { slotKey, useFoodStore } from '../food/mealPlanStore';
import { useFoodProfile } from '../food/profile';
import { exampleFoods, useRecipeProvider, type MealSlotTarget } from '../food/recipes';
import { useCoachOnServer } from '../coach/availability';
import { labelInSlot, slotEntries, slotTargets } from '../food/slots';
import { todayRows, type AcceptedRecipes, type RowStatus, type TodayRow } from '../today/model';
import { mealMarkOf, withinPlan } from './mealMark';

const C = FOOD_COPY.slot;
const M = FOOD_COPY.meals;
const ANSWERS = ['asPlanned', 'partly', 'skipped'] as const;

/** The answer a row status stands for (Today's other rows); open and filled-in rows have none yet. A meal reads its
 * answer from what was logged instead (`mealMarkOf`). */
export const MARK_OF_STATUS: Partial<Record<RowStatus, RowMark>> = {
  done: 'asPlanned',
  partial: 'partly',
  skipped: 'skipped',
};

/** The day's meal rows by slot, read the way Today reads them (status, what was logged against the plan). */
export function mealRows(
  view: TodayView | null | undefined,
  recipes?: AcceptedRecipes | null,
): Map<string, TodayRow> {
  const rows = new Map<string, TodayRow>();
  if (!view) return rows;
  for (const r of todayRows(view, { recipes })) if (r.glyph === 'meal') rows.set(r.id.slice(5), r);
  return rows;
}

/** The day's accepted recipes by meal slot (one serving of one is the meal as planned), for the meal rows' marks. */
export function useAcceptedRecipes(view: TodayView | null | undefined): AcceptedRecipes {
  const accepted = useFoodStore((s) => s.accepted);
  const planId = view?.plan?.id ?? null;
  const date = view?.date;
  const meals = view?.prescription?.meals;
  return useMemo(() => {
    const out: Record<string, { dish: string; energyKcal: number }> = {};
    if (!planId || !date || !meals) return out;
    for (const m of meals) {
      const r = accepted[slotKey(planId, date, m.slot)]?.recipe;
      if (r) out[m.slot] = { dish: r.dish, energyKcal: r.perServing.energyKcal.value };
    }
    return out;
  }, [accepted, planId, date, meals]);
}

/**
 * How a meal went, as one action for every way in (the sheet's bank, Today's tick, Food's row key): the answer replaces
 * what the meal holds as the person sees it (`slotEntries`), in one change. "As planned" logs one serving of the
 * accepted recipe when there is one (its table-checked numbers, not the slot's target), else the slot as planned;
 * "partly" and "skipped" are the meal's own answer, with no amount made up. Undo restores the meal as it was.
 */
export function useMealAnswer(
  date: LocalDate,
): (target: Pick<MealSlotTarget, 'slot'>, mark: RowMark) => Promise<ActionOutcome> {
  const actions = useLivingActions();
  const view = useLiving((s) => s.today(date), [date]);
  return useCallback(
    (t, mark) => {
      const planId = view?.plan?.id ?? null;
      const recipe =
        mark === 'asPlanned' && planId
          ? useFoodStore.getState().accepted[slotKey(planId, date, t.slot)]?.recipe
          : undefined;
      const serving: MealServing | undefined = recipe
        ? {
            name: recipe.dish,
            energyKcal: recipe.perServing.energyKcal.value,
            proteinG: recipe.perServing.proteinG.value,
            carbG: recipe.perServing.carbG.value,
            fatG: recipe.perServing.fatG.value,
            ...(recipe.perServing.fibreG && Number.isFinite(recipe.perServing.fibreG.value)
              ? { fibreG: recipe.perServing.fibreG.value }
              : {}),
          }
        : undefined;
      const replaces = slotEntries(view, t.slot).map((e) => e.id);
      return actions.answerMeal(date, { slot: t.slot, mark, replaces, ...(serving ? { serving } : {}) });
    },
    [actions, view, date],
  );
}

export interface MealSheetProps {
  date: LocalDate;
  /** The meal slot whose sheet is open ("lunch"); null closes it. */
  slot: string | null;
  quiet: boolean;
  onClose(): void;
  /** Opens the manual logger for this meal ("I ate something else", "Add more"). The sheet closes first. */
  onLogOther(target: MealSlotTarget): void;
  /** Opens the meal's recipe and targets. The sheet closes first. */
  onRecipe(target: MealSlotTarget): void;
  /** An answer was saved: its undo, for the row's own second tap or Undo key. */
  onAnswered?(target: MealSlotTarget, mark: RowMark, undo: (() => Promise<unknown>) | undefined): void;
}

export function MealSheet({ date, slot, quiet, onClose, onLogOther, onRecipe, onAnswered }: MealSheetProps) {
  const eu = useEnergyUnit();
  const today = useToday();
  const { dietKind, dietAnswered } = useFoodProfile();
  const provider = useRecipeProvider();
  // paired: the Coach runs on the server; no "set up a provider" here
  const onServer = useCoachOnServer();
  const answerMeal = useMealAnswer(date);
  const view = useLiving((s) => s.today(date), [date]);
  const planId = view?.plan?.id ?? null;
  const recipe = useFoodStore((s) =>
    planId && slot ? s.accepted[slotKey(planId, date, slot)]?.recipe : undefined,
  );
  const rx = view?.prescription ?? null;
  const targets = slotTargets(rx);
  const target = slot ? (targets.find((t) => t.slot === slot) ?? null) : null;
  if (!view || !target) return <ResponsivePanel open={false} onClose={onClose} title="" />;

  const name = target.name;
  const row = mealRows(view).get(target.slot);
  const entries = slotEntries(view, target.slot);
  // the row's own status; a slot with no row (a meal the checklist does not carry) has none, whatever is logged
  const status: RowStatus = row?.status ?? 'empty';
  const hasFood = entries.length > 0 || !!row?.logged;
  const logged = status !== 'empty' || hasFood;
  const canLog = !!rx && compareDates(date, today) <= 0;
  const isPast = compareDates(date, today) < 0;
  // why recipes can't be made for today or a day ahead: said once, here, never as a line on the page
  const blocked =
    isPast || !view.plan?.id
      ? null
      : !provider.available
        ? onServer
          ? null
          : 'provider'
        : !dietAnswered
          ? 'diet'
          : null;

  // the fact line: logged against the plan, else the meal's targets
  const knownEntries = entries.filter((e) => e.energyKcal !== undefined);
  const rowEnergy = row?.logged?.unit === 'kcal' ? row.logged.value : undefined;
  const loggedKcal = knownEntries.length
    ? knownEntries.reduce((sum, e) => sum + e.energyKcal!.value, 0)
    : (rowEnergy ?? 0);
  const hasEnergy = knownEntries.length > 0 || rowEnergy !== undefined;
  const partialEnergy = entries.length > knownEntries.length;
  const sd = Math.sqrt(knownEntries.reduce((sum, e) => sum + (e.energyKcal!.sd ?? 0) ** 2, 0));
  const range = sd > 0 ? likely(loggedKcal, sd) : null;
  const tolerance = Math.max(ENERGY_TOL_REL * target.energyKcal, ENERGY_TOL_MIN_KCAL);
  const toleranceBand: [number, number] = [
    Math.max(0, target.energyKcal - tolerance),
    target.energyKcal + tolerance,
  ];
  const energy = (v: number) => `${formatEnergy(v, eu, { withUnit: false })} ${eu}`;
  const words = entries.map((e) => labelInSlot(e.label, name)).filter((w): w is string => !!w);
  // the answer it already has, read from what was logged: the bank selects it and the fact line says the same
  const current = mealMarkOf({
    status,
    words,
    hasFood,
    loggedKcal,
    plannedKcal: target.energyKcal,
    recipe: recipe ? { dish: recipe.dish, energyKcal: recipe.perServing.energyKcal.value } : null,
  });
  // the fact in words, when no numbers are shown (quiet mode, or food with no energy)
  const answerWord =
    current === 'asPlanned'
      ? hasFood
        ? TODAY_COPY.rowWord.done
        : C.markedAsPlanned
      : current === 'partly'
        ? TODAY_COPY.rowWord.partial
        : current === 'skipped'
          ? TODAY_COPY.rowWord.skipped
          : status === 'assumed'
            ? TODAY_COPY.rowWord.assumed
            : TODAY_COPY.mealLogged;
  // the dish the sheet leads with: what was eaten, else the planned recipe, else the plan's kind of meal as an example
  const dishWords = words.filter((w) => !/^as planned$/i.test(w.trim()));
  const dish = dishWords.length
    ? capitalise(dishWords.join(', '))
    : recipe
      ? recipe.dish
      : logged
        ? null
        : C.plainQuiet(exampleFoods(target, dietKind));
  const factText =
    quiet || !hasEnergy
      ? capitalise(answerWord)
      : `${partialEnergy ? 'At least ' : sd > 0 ? '≈ ' : ''}${formatEnergy(loggedKcal, eu, { withUnit: false })} / ${energy(target.energyKcal)}`;
  const macros = [
    { id: 'protein', label: 'Protein', grams: target.proteinG, factor: 4 },
    { id: 'carbs', label: 'Carbs', grams: target.carbG, factor: 4 },
    { id: 'fat', label: 'Fat', grams: target.fatG, factor: 9 },
  ];
  const macroEnergy = macros.reduce((sum, m) => sum + m.grams * m.factor, 0);
  const fact = logged ? (
    <div className="lv-mealsheet__progress">
      <MonoMeta className="lv-sheet__fact">{factText}</MonoMeta>
      {hasEnergy ? (
        <div
          role="meter"
          aria-label="Meal against plan"
          aria-valuemin={quiet ? undefined : 0}
          aria-valuemax={quiet ? undefined : Math.max(toleranceBand[1], loggedKcal, 1)}
          aria-valuenow={quiet ? undefined : loggedKcal}
          aria-valuetext={
            quiet
              ? answerWord
              : `${partialEnergy ? 'At least ' : ''}${energy(loggedKcal)} of ${energy(target.energyKcal)}; plan’s range ${energy(toleranceBand[0])} to ${energy(toleranceBand[1])}${range ? `; likely ${energy(range.lo)} to ${energy(range.hi)}${partialEnergy ? ' for known food only' : ''}` : ''}`
          }
        >
          <div aria-hidden="true">
            <DottedTrack
              label="Meal against plan"
              value={loggedKcal}
              goal={target.energyKcal}
              to={Math.max(toleranceBand[1], loggedKcal, 1)}
              band={toleranceBand}
              hue="food"
              valueText={`${partialEnergy ? 'At least ' : ''}${energy(loggedKcal)}`}
              goalText={energy(target.energyKcal)}
              quiet={quiet}
              quietWord={answerWord}
            />
          </div>
        </div>
      ) : null}
      {!quiet && range ? (
        <MonoMeta>
          Likely {energy(range.lo)}–{energy(range.hi)}
          {partialEnergy ? ' · known food only' : ''}
        </MonoMeta>
      ) : null}
      {current === 'asPlanned' && hasEnergy && !partialEnergy && !quiet ? (
        <MonoMeta>
          {withinPlan(loggedKcal, target.energyKcal) ? 'Within the plan’s range' : 'Logged as planned'}
        </MonoMeta>
      ) : null}
    </div>
  ) : !quiet ? (
    <div className="lv-mealsheet__progress">
      <div className="lv-mealsheet__targets">
        <MonoMeta>{energy(target.energyKcal)}</MonoMeta>
        {macros.map((m) => (
          <MonoMeta key={m.id}>
            {Math.round(m.grams)} g {m.label.toLowerCase()}
          </MonoMeta>
        ))}
      </div>
      <StackBar
        label="Planned meal composition"
        size="sm"
        legend="none"
        rows={macros.map((m) => ({
          id: m.id,
          label: m.label,
          valueText: `${Math.round(m.grams)} g`,
          share: macroEnergy > 0 ? (m.grams * m.factor) / macroEnergy : 0,
          hue: `var(--lm-macro-${m.id})`,
        }))}
      />
    </div>
  ) : null;

  const answer = async (mark: RowMark) => {
    // the answer it already has changes nothing (and never logs the meal twice)
    if (mark === current) return onClose();
    const o = await answerMeal(target, mark);
    if (!o.ok) {
      toast(o.message ?? FOOD_COPY.toasts.notSaved);
      return;
    }
    const undo = o.undo;
    toast(
      mark === 'asPlanned'
        ? FOOD_COPY.toasts.loggedAsPlanned(name)
        : FOOD_COPY.toasts.answered(name, TODAY_COPY.rowSheet[mark].toLowerCase()),
      undo ? { action: { label: FOOD_COPY.toasts.undo, onClick: () => void undo() } } : {},
    );
    onAnswered?.(target, mark, undo);
    onClose();
  };
  const then = (go: (t: MealSlotTarget) => void) => () => {
    onClose();
    go(target);
  };

  return (
    <ResponsivePanel open onClose={onClose} title={capitalise(name)}>
      <div className="lv-sheet lv-mealsheet">
        {/* r068 L9: the sheet leads with the dish (what was eaten, else the planned recipe, else the plan's kind of meal) */}
        {dish ? <p className="lv-mealsheet__dish">{dish}</p> : null}
        {fact}
        {canLog ? (
          <KeyBank
            key={`${target.slot}:${current ?? ''}`}
            label={TODAY_COPY.howDidItGo(name)}
            size="lg"
            block
            options={ANSWERS.map((v) => ({ value: v, label: TODAY_COPY.rowSheet[v] }))}
            {...(current ? { defaultValue: current } : {})}
            onChange={(v) => void answer(v)}
          />
        ) : null}
        <div className="lv-mealsheet__keys">
          {canLog ? (
            <Key variant="action" arrow onClick={then(onLogOther)}>
              {logged ? C.addMore : C.ateElse}
            </Key>
          ) : null}
          <Key variant="text" onClick={then(onRecipe)}>
            {C.openItem}
          </Key>
        </div>
        {/* r068 L9/L20: what recipes need is said in the recipe flow (the recipe sheet), not as a footnote here; the
            diet question is a real key */}
        {blocked === 'diet' ? (
          <KeyLink to="/onboarding/diet" variant="outlined" block trailingIcon={ChevronRight}>
            {M.noDiet}
          </KeyLink>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
