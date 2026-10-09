import '../boot';
import './food.css';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { Engraved, Faceplate, IconKey, Key, KeyLink, Menu, Notice, Page, ProgressRule, toast } from '@/components';
import { ActionBar, TopBar } from '@/app/shell';
import { paths } from '@/app/paths';
import { addDays, compareDates, isLocalDate } from '@/living/dates';
import type { LocalDate, PrescribedDaySnapshot } from '@/living';
import { clockHourOf, useLivingClock, useToday } from '../clock';
import { DateStrip } from '../components/DateStrip';
import { LogConflict } from '../components/LogConflict';
import { useLivingActions, type ActionOutcome, type ManualMealInput } from '../data/actions';
import { useLiving } from '../data/source';
import { fmtDateRange, fmtDay, weekOf } from '../format';
import { livingPaths } from '../paths';
import { GroceriesFace } from './components/GroceriesFace';
import { ManualLogger } from './components/ManualLogger';
import { LoggedRow, MealSlot } from './components/MealSlot';
import { KitchenPanel, NoBenefitPanel, PantryPanel } from './components/panels';
import { PantryFaceplate } from '@/features/food/PantryFaceplate';
import { RecipeSheet } from './components/RecipeSheet';
import { SupplementsFace } from './components/SupplementsFace';
import { TargetsFace } from './components/TargetsFace';
import { FOOD_COPY } from './copy';
import { groceryText, horizonSpan, useGroceryList, useGrocerySource, useGroceryVersion, type GroceryHorizon } from './groceries';
import { trustLedger } from './ledger';
import { slotKey, useFoodStore } from './mealPlanStore';
import { useFoodProfile } from './profile';
import { useRecipeProvider, type MealSlotTarget, type RecipeSuggestion } from './recipes';
import { supplementName } from './supplements';
import { groupEntries, isFastDay, slotTargets, visibleSlots as visibleOf } from './slots';
import { useDayPlanner } from './useDayPlanner';

const M = FOOD_COPY.meals;
const T = FOOD_COPY.toasts;
const G = FOOD_COPY.groceries;

type PanelId = 'pantry' | 'noBenefit' | 'kitchen';
type Supplement = PrescribedDaySnapshot['supplements'][number];

/**
 * Food (`/food`, `/food/:date`; design/screens/living-mode.md, Food): the day's targets, meal slots with plain targets
 * or recipes (planning and eating are different keys), groceries from accepted recipes, supplements, and the weekly
 * trust ledger. The date lives in the URL and is shared with Today and Train; `[` `]` move one day.
 */
/** A bad date in the address goes to the page for today, as Today does (`/food/xx` → `/food`). */
export default function FoodPage() {
  const { date } = useParams();
  if (date !== undefined && !isLocalDate(date)) return <Navigate to={livingPaths.food()} replace />;
  return <FoodScreen />;
}

function FoodScreen() {
  const params = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const clock = useLivingClock();
  const today = useToday();
  const date: LocalDate = params.date && isLocalDate(params.date) ? params.date : today;
  const weekDates = useMemo(() => weekOf(date), [date]);

  const view = useLiving((s) => s.today(date), [date]);
  const dayConflicts = useLiving((s) => s.history(date, date)[0]?.conflicts ?? [], [date]);
  const yesterday = useLiving((s) => s.today(addDays(date, -1)), [date]);
  const days = useLiving((s) => s.days(weekDates), [weekDates]);
  const weekViews = useLiving((s) => weekDates.filter((d) => compareDates(d, today) <= 0).map((d) => s.today(d)), [weekDates, today]);
  const actions = useLivingActions();
  const provider = useRecipeProvider();
  const profile = useFoodProfile();
  const groceries = useGrocerySource();
  useGroceryVersion(groceries);

  const [showNumbers, setShowNumbers] = useState(false);
  const [horizon, setHorizon] = useState<GroceryHorizon>('3days');
  const [logger, setLogger] = useState<{ target: MealSlotTarget | null; clockH: number; n: number } | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(null);
  // the meal row's own Undo after "As planned" here (the toast carries one too, but it goes away)
  const [mealUndo, setMealUndo] = useState<Record<string, () => Promise<unknown>>>({});
  const [printing, setPrinting] = useState(false);
  const [takenUndo, setTakenUndo] = useState<Record<string, () => Promise<ActionOutcome>>>({});

  const accepted = useFoodStore((s) => s.accepted);
  const runs = useFoodStore((s) => s.runs);
  const swapPrompts = useFoodStore((s) => s.swapPrompt);

  const rx = view?.prescription ?? null;
  const planId = view?.plan?.id ?? null;
  const isFuture = compareDates(date, today) > 0;
  const isPast = compareDates(date, today) < 0;
  const canLog = !isFuture && !!rx;
  const quietMode = !!view?.quietMode;
  const quiet = quietMode && !showNumbers;

  const daySlots = useMemo(() => slotTargets(rx), [rx]);
  const slots = useMemo(() => visibleOf(rx, daySlots), [rx, daySlots]);
  const fastDay = isFastDay(rx);
  const meals = useMemo(() => (view?.logged.entries ?? []).filter((e) => e.kind === 'meal'), [view]);
  const grouped = useMemo(() => groupEntries(meals, slots), [meals, slots]);
  const yesterdayGrouped = useMemo(() => groupEntries((yesterday?.logged.entries ?? []).filter((e) => e.kind === 'meal'), slotTargets(yesterday?.prescription ?? null)), [yesterday]);
  const ledger = useMemo(() => trustLedger(weekViews), [weekViews]);

  const keyOf = useCallback((slot: string) => (planId ? slotKey(planId, date, slot) : ''), [planId, date]);
  const doneOf = (slot: string) => !!view?.checklist.find((c) => c.id === `meal:${slot}`)?.done;
  const takenIds = new Set((view?.checklist ?? []).filter((c) => c.kind === 'supplement' && c.done).map((c) => c.id.replace(/^supplement:/, '')));

  const planBlocked: string | null = !provider.available ? (provider.reason ?? M.noProvider) : !profile.dietAnswered ? M.noDietReason : isPast ? M.pastReason : null;
  const canPlan = !planBlocked && !!planId;
  const openSlots = slots.filter((t) => !accepted[keyOf(t.slot)] && !doneOf(t.slot));
  const running = slots.some((t) => {
    const r = runs[keyOf(t.slot)];
    return r?.state === 'waiting' || r?.state === 'working';
  });
  const planner = useDayPlanner({ planId, date, daySlots: slots, provider, profile });

  /* ------------------------------------------------------------------ date navigation */
  const goTo = useCallback((d: LocalDate) => navigate(livingPaths.food(d === today ? undefined : d)), [navigate, today]);
  // The date strip calls onSelect and then onWeek when arrowing past its edge; the selected day wins.
  const selecting = useRef(false);
  const selectDay = (d: LocalDate) => {
    selecting.current = true;
    queueMicrotask(() => {
      selecting.current = false;
    });
    goTo(d);
  };
  const moveWeek = (delta: -1 | 1) => {
    if (!selecting.current) goTo(addDays(date, delta * 7));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.key !== '[' && e.key !== ']')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      goTo(addDays(date, e.key === ']' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, goTo]);

  /* ------------------------------------------------------------------ actions */
  const report = (o: ActionOutcome, message: string): boolean => {
    if (!o.ok) {
      toast(o.message ?? T.notSaved);
      return false;
    }
    const undo = o.undo;
    toast(message, undo ? { action: { label: T.undo, onClick: () => void undo() } } : {});
    return true;
  };

  const ateThis = async (t: MealSlotTarget) => {
    // An accepted recipe is what was eaten: log one serving of it (its table-checked numbers), not the slot's target.
    const recipe = accepted[keyOf(t.slot)]?.recipe;
    const components = recipe
      ? [
          {
            name: recipe.dish,
            energyKcal: recipe.perServing.energyKcal.value,
            proteinG: recipe.perServing.proteinG.value,
            carbG: recipe.perServing.carbG.value,
            fatG: recipe.perServing.fatG.value,
          },
        ]
      : [];
    const o = await actions.logMeal(date, { slot: t.slot, clockH: t.clockH, components, asPlanned: true });
    if (report(o, T.loggedAsPlanned(t.name)) && o.undo) setMealUndo((m) => ({ ...m, [`${date}:${t.slot}`]: o.undo! }));
  };
  const undoMeal = (t: MealSlotTarget) => {
    const k = `${date}:${t.slot}`;
    const undo = mealUndo[k];
    setMealUndo(({ [k]: _drop, ...rest }) => (void _drop, rest));
    if (undo) void undo().then(() => toast(`${t.name.charAt(0).toUpperCase()}${t.name.slice(1)}: undone.`));
  };

  const logManual = async (input: ManualMealInput): Promise<boolean> => {
    const name = input.slot ? (slots.find((s) => s.slot === input.slot)?.name ?? input.slot) : null;
    return report(await actions.logMeal(date, input), name ? T.logged(name) : T.loggedOther);
  };

  const accept = (t: MealSlotTarget, recipe: RecipeSuggestion) => {
    if (!planId) return;
    const k = keyOf(t.slot);
    const st = useFoodStore.getState();
    const prev = st.accepted[k];
    st.accept(k, { planId, date, slot: t.slot, recipe });
    st.setSwapPrompt(k, null);
    toast(T.accepted(t.name), {
      action: {
        label: T.undo,
        onClick: () => (prev ? useFoodStore.getState().accept(k, prev) : useFoodStore.getState().unaccept(k)),
      },
    });
  };

  const unaccept = (t: MealSlotTarget) => {
    const k = keyOf(t.slot);
    const prev = useFoodStore.getState().accepted[k];
    if (!prev) return;
    useFoodStore.getState().unaccept(k);
    toast(T.unplanned(t.name), { action: { label: T.undo, onClick: () => useFoodStore.getState().accept(k, prev) } });
  };

  const taken = async (s: Supplement) => {
    const name = supplementName(s.supplementId);
    const undo = takenUndo[s.supplementId];
    if (takenIds.has(s.supplementId)) {
      if (undo) {
        await undo();
        setTakenUndo((m) => {
          const next = { ...m };
          delete next[s.supplementId];
          return next;
        });
      }
      return;
    }
    const o = await actions.logSupplement(date, s.supplementId, s.dose, s.unit);
    if (report(o, T.taken(name)) && o.undo) setTakenUndo((m) => ({ ...m, [s.supplementId]: o.undo! }));
  };

  const openLogger = (target: MealSlotTarget | null) => {
    const h = compareDates(date, today) === 0 ? clockHourOf(clock) : 12;
    setLogger((l) => ({ target, clockH: target?.clockH ?? h, n: (l?.n ?? 0) + 1 }));
  };

  // what was typed goes into the Coach's composer to finish; the slot and date go with the message
  const toCoach = (text: string, slot?: { slot: string; name: string }) => {
    setLogger(null);
    navigate(livingPaths.coach(), { state: { draft: { text, prefill: true, context: { date, screen: 'food', ...(slot ? { slot: slot.slot, slotName: slot.name } : {}) } } } });
  };

  /* ------------------------------------------------------------------ recipe sheet (?recipe=:slot) */
  const recipeSlot = search.get('recipe');
  const sheetTarget = slots.find((t) => t.slot === recipeSlot) ?? null;
  const sheetRun = sheetTarget ? runs[keyOf(sheetTarget.slot)] : undefined;
  const sheetAccepted = sheetTarget ? accepted[keyOf(sheetTarget.slot)]?.recipe : undefined;
  const sheetRecipe = sheetAccepted ?? (sheetRun?.state === 'ready' ? sheetRun.recipe : undefined);
  const openRecipe = (slot: string) =>
    setSearch((prev) => {
      const n = new URLSearchParams(prev);
      n.set('recipe', slot);
      return n;
    });
  const closeRecipe = () =>
    setSearch(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('recipe');
        return n;
      },
      { replace: true },
    );

  /* ------------------------------------------------------------------ groceries */
  const span = horizonSpan(today, horizon);
  const list = useGroceryList(planId, span.from, span.to);
  const pantry = groceries.pantry();
  const shareList = async () => {
    const text = groceryText(list, { header: G.shareHeader(fmtDateRange(span.from, span.to)), aisleName: (a) => G.aisles[a], haveWord: G.shareHave });
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: G.shareTitle, text });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(T.copied);
    } catch {
      toast(T.copyFailed);
    }
  };
  const printList = () => {
    flushSync(() => setPrinting(true));
    try {
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  /* ------------------------------------------------------------------ render */
  const kitchenBlocked = !provider.available
    ? { reason: provider.reason ?? M.noProvider, link: { to: paths.settings(), label: M.setUpProvider } }
    : !profile.dietAnswered
      ? { reason: M.noDietReason, link: { to: '/onboarding/diet', label: M.noDietLink } }
      : isPast
        ? { reason: FOOD_COPY.kitchen.notToday }
        : openSlots.length === 0
          ? { reason: M.nothingOpen }
          : null;

  const notices = (view?.notices ?? []).filter((n) => n.kind === 'safety' || n.level === 'danger' || (n.kind === 'info' && view?.plan?.status === 'paused')).slice(0, 2);

  const quietKey = quietMode ? (
    <Key variant="quiet" size="sm" pressed={showNumbers} onClick={() => setShowNumbers((v) => !v)}>
      {showNumbers ? FOOD_COPY.hideNumbers : FOOD_COPY.showNumbers}
    </Key>
  ) : undefined;

  // When the reason is already on the page (no provider, diet not answered), the key points at that text instead of
  // carrying a second, hidden copy of it: the sentence is read once on screen and once by a screen reader.
  const shownReasonId = useId();
  const reasonShown = !running && (!provider.available || !profile.dietAnswered);
  const planKey = isPast ? undefined : reasonShown ? (
    <Key aria-disabled aria-describedby={shownReasonId} onClick={() => undefined}>
      {M.planDay}
    </Key>
  ) : (
    <Key onClick={() => void planner.plan(openSlots)} loading={running} disabledReason={running ? undefined : (planBlocked ?? (openSlots.length === 0 ? M.nothingOpen : undefined))}>
      {M.planDay}
    </Key>
  );

  const menu = (
    <Menu
      label={FOOD_COPY.menu}
      trigger={(t) => <IconKey {...t} icon={MoreHorizontal} label={FOOD_COPY.menu} />}
      items={[
        { id: 'kitchen', label: FOOD_COPY.menuItems.kitchen, onSelect: () => setPanel('kitchen') },
        { id: 'pantry', label: FOOD_COPY.menuItems.pantry, onSelect: () => setPanel('pantry') },
        { id: 'noBenefit', label: FOOD_COPY.menuItems.noBenefit, onSelect: () => setPanel('noBenefit') },
      ]}
    />
  );

  const ledgerParts = [
    ledger.asPlanned ? FOOD_COPY.ledger.asPlanned(ledger.asPlanned) : null,
    ledger.typed ? FOOD_COPY.ledger.typed(ledger.typed) : null,
    ledger.coach ? FOOD_COPY.ledger.coach(ledger.coach) : null,
    ledger.other ? FOOD_COPY.ledger.other(ledger.other) : null,
  ].filter((x): x is string => x !== null);

  return (
    <>
      <TopBar
        title={
          <>
            {FOOD_COPY.title}
            <span className="lv-food-ctxdate"> · {fmtDay(date)}</span>
          </>
        }
        documentTitle={`${FOOD_COPY.title} · ${fmtDay(date)}`}
        actions={menu}
      />
      {list.count > 0 ? (
        <ActionBar>
          <Key block trailingIcon={ChevronRight} onClick={() => document.getElementById('groceries')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}>
            {G.actionBar(list.count)}
          </Key>
        </ActionBar>
      ) : null}
      <Page className="lv-food">
        <DateStrip days={days} selected={date} today={today} onSelect={selectDay} onWeek={moveWeek} quiet={quietMode} label={FOOD_COPY.dateStrip} />
        {isFuture ? (
          <p className="lv-food-dayline">
            <Engraved>{FOOD_COPY.preview}</Engraved> <span className="lv-food-note">{FOOD_COPY.previewHelp}</span>
          </p>
        ) : isPast ? (
          <p className="lv-food-dayline">
            <Engraved>{FOOD_COPY.pastDay}</Engraved>
          </p>
        ) : null}
        {notices.map((n) => (
          <Notice key={n.id} severity={n.level} title={n.text} layout="ruled" />
        ))}
        {dayConflicts.filter((conflict) => conflict.kind === 'meal').map((conflict) => <LogConflict key={conflict.parentId} conflict={conflict} quiet={quiet} />)}

        {!rx ? (
          <Faceplate className="lv-food-empty" title={M.title}>
            <p>{FOOD_COPY.noPlanDay}</p>
          </Faceplate>
        ) : (
          <div className="lv-food-grid">
            <div className="lv-food-main">
              <TargetsFace rx={rx} totals={view!.logged.totals} logged={meals.length > 0} quiet={quiet} quietKey={quietKey} />

              <Faceplate id="meals" className="lv-food-meals" title={M.title} actions={planKey}>
                {running ? <ProgressRule label={M.running} /> : null}
                {!provider.available ? (
                  <p className="lv-food-state">
                    <span id={shownReasonId}>{provider.reason ?? M.noProvider}</span>{' '}
                    <KeyLink to={paths.settings()} variant="quiet" size="sm">
                      {M.setUpProvider}
                    </KeyLink>
                  </p>
                ) : !profile.dietAnswered ? (
                  <p className="lv-food-state">
                    <KeyLink id={shownReasonId} to="/onboarding/diet" variant="quiet" size="sm" trailingIcon={ChevronRight}>
                      {M.noDiet}
                    </KeyLink>
                  </p>
                ) : null}
                {profile.familyFoodMode ? <p className="lv-food-note">{M.familyNote}</p> : null}
                {running ? (
                  <ul className="lv-food-progress" aria-label={M.progressLabel}>
                    {slots.map((t) => {
                      const r = runs[keyOf(t.slot)];
                      const word = !r ? null : r.state === 'ready' ? M.progress.done : r.state === 'error' ? M.progress.error : r.state === 'working' ? M.progress.working : M.progress.waiting;
                      return word ? (
                        <li key={t.slot}>
                          <Engraved>
                            {t.name} · {word}
                          </Engraved>
                        </li>
                      ) : null;
                    })}
                  </ul>
                ) : null}
                {fastDay ? <p className="lv-food-fast lm-eng">{M.fastDay}</p> : null}
                {slots.length < daySlots.length ? <p className="lv-food-note">{M.hiddenByFast(daySlots.length - slots.length)}</p> : null}

                <div className="lv-rail-host">
                  <ul className="lv-day lv-food-slots">
                  {slots.map((t) => {
                    const k = keyOf(t.slot);
                    return (
                      <MealSlot
                        key={t.slot}
                        target={t}
                        run={runs[k]}
                        accepted={accepted[k]?.recipe}
                        swapPrompt={swapPrompts[k]}
                        entries={grouped.bySlot.get(t.slot) ?? []}
                        done={doneOf(t.slot)}
                        quiet={quiet}
                        canLog={canLog}
                        canPlan={canPlan}
                        familyFoodMode={profile.familyFoodMode}
                        busy={running}
                        {...(mealUndo[`${date}:${t.slot}`] ? { onUndo: () => undoMeal(t) } : {})}
                        onAteThis={() => void ateThis(t)}
                        onAteElse={() => openLogger(t)}
                        onAccept={(r) => accept(t, r)}
                        onSwap={() => void planner.swap(t)}
                        onRetry={() => void planner.plan([t])}
                        onOpen={() => openRecipe(t.slot)}
                        onDontSuggest={(dish) => {
                          useFoodStore.getState().addDontSuggest(dish);
                          useFoodStore.getState().setSwapPrompt(k, null);
                        }}
                        onKeepSuggesting={() => useFoodStore.getState().setSwapPrompt(k, null)}
                      />
                    );
                  })}
                  </ul>
                </div>

                {grouped.other.length > 0 || canLog ? (
                  <div className="lv-food-other">
                    {grouped.other.length > 0 ? (
                      <>
                        <h3 className="lv-food-other__title">{M.other}</h3>
                        <ul className="lv-food-logged-list">
                          {grouped.other.map((e) => (
                            <LoggedRow key={e.id} entry={e} quiet={quiet} />
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {canLog ? (
                      <Key size="sm" variant="quiet" onClick={() => openLogger(null)}>
                        {M.logOther}
                      </Key>
                    ) : null}
                  </div>
                ) : null}
              </Faceplate>
              <PantryFaceplate className="lv-food-pantryface" />
            </div>

            <div className="lv-food-side">
              <GroceriesFace
                list={list}
                horizon={horizon}
                onHorizon={setHorizon}
                budget={groceries.budget()}
                onBudget={(t) => groceries.setBudget(t)}
                onBought={(k, b) => groceries.setBought(k, b)}
                onHave={(n, h) => groceries.setHave(n, h)}
                onShare={() => void shareList()}
                onPrint={printList}
                recipesAvailable={provider.available}
                printing={printing}
              />
              <SupplementsFace supplements={rx.supplements} taken={takenIds} canLog={canLog} profile={profile} onTaken={(s) => void taken(s)} onNoBenefit={() => setPanel('noBenefit')} />
            </div>
          </div>
        )}

        <footer className="lv-food-ledger">
          <p>{ledger.total === 0 ? FOOD_COPY.ledger.none : FOOD_COPY.ledger.line(ledgerParts)}</p>
          {ledger.mostlyCoach ? <p className="lv-food-note">{FOOD_COPY.ledger.mostlyCoach}</p> : null}
        </footer>
      </Page>

      <RecipeSheet
        open={!!sheetTarget}
        onClose={closeRecipe}
        target={sheetTarget}
        recipe={sheetRecipe}
        accepted={!!sheetAccepted}
        quiet={quiet}
        kitchenScale={profile.kitchenScale}
        canPlan={canPlan}
        onAccept={(r) => {
          if (sheetTarget) accept(sheetTarget, r);
        }}
        onSwap={() => {
          if (sheetTarget) void planner.swap(sheetTarget);
        }}
        onRemove={() => {
          if (sheetTarget) unaccept(sheetTarget);
        }}
      />
      {logger ? (
        <ManualLogger
          key={logger.n}
          open
          onClose={() => setLogger(null)}
          target={logger.target}
          clockH={logger.clockH}
          sameSlotYesterday={logger.target ? (yesterdayGrouped.bySlot.get(logger.target.slot) ?? []) : []}
          recents={logger.target ? [] : [...yesterdayGrouped.bySlot.values()].flat().concat(yesterdayGrouped.other)}
          quiet={quiet}
          onLog={logManual}
          onCoach={(text) => toCoach(text, logger.target ? { slot: logger.target.slot, name: logger.target.name } : undefined)}
        />
      ) : null}
      <PantryPanel open={panel === 'pantry'} onClose={() => setPanel(null)} pantry={pantry} onHave={(n, h) => groceries.setHave(n, h)} />
      <NoBenefitPanel open={panel === 'noBenefit'} onClose={() => setPanel(null)} />
      <KitchenPanel
        open={panel === 'kitchen'}
        onClose={() => setPanel(null)}
        pantry={pantry}
        onHave={(n, h) => groceries.setHave(n, h)}
        blocked={kitchenBlocked}
        onRun={() => {
          setPanel(null);
          void planner.plan(openSlots, { pantry });
        }}
      />
    </>
  );
}
