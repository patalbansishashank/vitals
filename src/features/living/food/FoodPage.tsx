import '../boot';
import './food.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { CirclePause, Plus, Utensils } from 'lucide-react';
import { CardFoot, CardHead, Columns, Engraved, Faceplate, GradientCard, Key, Page, ProgressRule, Rail, toast } from '@/components';
import { GlobalNotice, StatusCapsule, TopBar, type MenuEntry } from '@/app/shell';
import { addDays, compareDates, isLocalDate } from '@/living/dates';
import type { LocalDate, PrescribedDaySnapshot } from '@/living';
import { useToday } from '../clock';
import { DateControl } from '../components/DateControl';
import { useLoggedDays } from '../components/dateMarks';
import { dayPeriod } from '../period';
import { ConflictNotice } from '../components/LogConflict';
import { MealSheet, mealRows, useAcceptedRecipes, useMealAnswer } from '../components/MealSheet';
import { useLivingActions, type ActionOutcome } from '../data/actions';
import { useLiving } from '../data/source';
import { dayOfMonth, fmtDateRange, fmtDay, fmtMonth, fmtWeekday } from '../format';
import { livingPaths } from '../paths';
import { GroceriesFace } from './components/GroceriesFace';
import { LoggedRow, MealSlot, OtherMealRow } from './components/MealSlot';
import { KitchenPanel, NoBenefitPanel } from './components/panels';
import { PantryFaceplate } from '@/features/food/PantryFaceplate';
import { RecipeSheet } from './components/RecipeSheet';
import { SupplementsFace } from './components/SupplementsFace';
import { TargetsFace } from './components/TargetsFace';
import { FOOD_COPY, INFO } from './copy';
import { infoSpec } from '../components/info';
import { groceryProgress, groceryText, horizonSpan, useGroceryList, useGrocerySource, useGroceryVersion, type GroceryHorizon } from './groceries';
import { slotKey, useFoodStore } from './mealPlanStore';
import { useFoodProfile } from './profile';
import { useRecipeProvider, type MealSlotTarget, type RecipeSuggestion } from './recipes';
import { supplementName } from './supplements';
import { groupEntries, inWindow, isFastDay, slotTargets, visibleSlots as visibleOf } from './slots';
import { useDayPlanner } from './useDayPlanner';
import { useMealLogger } from './useMealLogger';

const M = FOOD_COPY.meals;
const T = FOOD_COPY.toasts;
const G = FOOD_COPY.groceries;

type PanelId = 'noBenefit' | 'kitchen';
type Supplement = PrescribedDaySnapshot['supplements'][number];

/**
 * Food (`/food`, `/food/:date`; design/screens/living-mode.md, Food): the day's targets, meal slots with plain targets
 * or recipes (planning and eating are different keys), groceries from accepted recipes and supplements. The header
 * carries the title, the date and the page's items of the one ⋯ (kitchen, pantry, things that won't help); it is the
 * only ⋯ on the page: a meal row opens its row sheet instead, the same sheet as Today's (../components/MealSheet). Nothing sits between the header and the content, and no
 * notice sits inside it (why recipes can't run is in the meal's sheet). The date lives in the URL and is shared with
 * Today and Train; `[` `]` move one day. Desktop: what to eat on the left (targets, meals), what to buy, take and have
 * on the right (groceries, supplements, pantry).
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
  const today = useToday();
  const date: LocalDate = params.date && isLocalDate(params.date) ? params.date : today;

  const view = useLiving((s) => s.today(date), [date]);
  const dayConflicts = useLiving((s) => s.history(date, date)[0]?.conflicts ?? [], [date]);
  const mealConflicts = useMemo(() => dayConflicts.filter((conflict) => conflict.kind === 'meal'), [dayConflicts]);
  const actions = useLivingActions();
  const provider = useRecipeProvider();
  const profile = useFoodProfile();
  const groceries = useGrocerySource();
  useGroceryVersion(groceries);

  const [showNumbers, setShowNumbers] = useState(false);
  const [horizon, setHorizon] = useState<GroceryHorizon>('3days');
  const [panel, setPanel] = useState<PanelId | null>(null);
  // the meal row whose sheet is open (its slot)
  const [mealSheet, setMealSheet] = useState<string | null>(null);
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
  // r068 L8: food logged outside the planned meals is a stop on the same rail at its own time; only food with no time
  // stays in a list of its own under the rail
  const railStops = useMemo(() => {
    const stops: Array<{ kind: 'slot'; target: (typeof slots)[number]; h: number } | { kind: 'other'; entry: (typeof meals)[number]; h: number }> = [
      ...slots.map((t) => ({ kind: 'slot' as const, target: t, h: t.clockH })),
      ...grouped.other.filter((e) => e.clockH !== undefined).map((e) => ({ kind: 'other' as const, entry: e, h: e.clockH! })),
    ];
    return stops.sort((a, b) => a.h - b.h);
  }, [slots, grouped]);
  const untimed = grouped.other.filter((e) => e.clockH === undefined);
  const slotNames = useMemo(() => new Set(slots.map((t) => t.name.toLowerCase())), [slots]);
  // each meal's answer, read as Today reads it (a marked meal with nothing logged may be skipped)
  const recipes = useAcceptedRecipes(view);
  const rows = useMemo(() => mealRows(view, recipes), [view, recipes]);
  const answerMeal = useMealAnswer(date);
  const logger = useMealLogger({ date, quiet, screen: 'food' });

  const keyOf = useCallback((slot: string) => (planId ? slotKey(planId, date, slot) : ''), [planId, date]);
  const doneOf = (slot: string) => !!view?.checklist.find((c) => c.id === `meal:${slot}`)?.done;
  const takenIds = new Set((view?.checklist ?? []).filter((c) => c.kind === 'supplement' && c.done).map((c) => c.id.replace(/^supplement:/, '')));

  // recipes need a provider and the food rules, and are for today and the days ahead
  const canPlan = provider.available && profile.dietAnswered && !isPast && !!planId;
  const openSlots = slots.filter((t) => !accepted[keyOf(t.slot)] && !doneOf(t.slot) && !grouped.bySlot.get(t.slot)?.length);
  const running = slots.some((t) => {
    const r = runs[keyOf(t.slot)];
    return r?.state === 'waiting' || r?.state === 'working';
  });
  const planner = useDayPlanner({ planId, date, daySlots: slots, provider, profile });

  /* ------------------------------------------------------------------ date navigation */
  const goTo = useCallback((d: LocalDate) => navigate(livingPaths.food(d === today ? undefined : d)), [navigate, today]);
  // the strip's day keys select a day; its chevrons move a week (arrowing past its edge only selects the next day)
  const selectDay = goTo;
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

  // the row's one key: as planned (an accepted recipe logs one serving of it, not the slot's target)
  const ateThis = async (t: MealSlotTarget) => {
    const o = await answerMeal(t, 'asPlanned');
    if (report(o, T.loggedAsPlanned(t.name))) keepMealUndo(t.slot, o.undo);
  };
  const keepMealUndo = (slot: string, undo: (() => Promise<unknown>) | undefined) =>
    setMealUndo(({ [`${date}:${slot}`]: _drop, ...rest }) => (void _drop, undo ? { ...rest, [`${date}:${slot}`]: undo } : rest));
  const undoMeal = (t: MealSlotTarget) => {
    const k = `${date}:${t.slot}`;
    const undo = mealUndo[k];
    setMealUndo(({ [k]: _drop, ...rest }) => (void _drop, rest));
    if (undo) void undo().then(() => toast(`${t.name.charAt(0).toUpperCase()}${t.name.slice(1)}: undone.`));
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
  // the widest horizon decides whether the card shows at all: an empty week has no card, a quiet day keeps its switch
  const weekSpan = horizonSpan(today, 'week');
  const weekList = useGroceryList(planId, weekSpan.from, weekSpan.to);
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
  const kitchenBlocked = !profile.dietAnswered
    ? { reason: M.noDietReason, link: { to: '/onboarding/diet', label: M.noDietLink } }
    : isPast
      ? { reason: FOOD_COPY.kitchen.notToday }
      : openSlots.length === 0
        ? { reason: M.nothingOpen }
        : null;

  // safety and danger states go to the shell's one banner slot (never between sections); a paused plan is the header's
  // status capsule
  const banners = (view?.notices ?? []).filter((n) => n.kind === 'safety' || n.level === 'danger');
  const paused = view?.plan?.status === 'paused';

  const quietKey = quietMode ? (
    <Key variant="text" size="sm" pressed={showNumbers} onClick={() => setShowNumbers((v) => !v)}>
      {showNumbers ? FOOD_COPY.hideNumbers : FOOD_COPY.showNumbers}
    </Key>
  ) : undefined;

  // "Plan my day" only where it can run: with a provider, the food rules, a day not past, and an open meal
  const menu: MenuEntry[] = [
    ...(provider.available ? [{ id: 'kitchen', label: FOOD_COPY.menuItems.kitchen, onSelect: () => setPanel('kitchen') }] : []),
    ...(canPlan && !running && openSlots.length > 0 ? [{ id: 'planDay', label: M.planDay, onSelect: () => void planner.plan(openSlots) }] : []),
    { id: 'noBenefit', label: FOOD_COPY.menuItems.noBenefit, onSelect: () => setPanel('noBenefit') },
  ];

  return (
    <>
      <TopBar
        title={FOOD_COPY.title}
        subtitle={`${fmtWeekday(date)}, ${dayOfMonth(date)} ${fmtMonth(date)}`}
        documentTitle={`${FOOD_COPY.title} · ${fmtDay(date)}`}
        status={paused ? <StatusCapsule icon={CirclePause} label={FOOD_COPY.paused} to={livingPaths.planActive} /> : undefined}
        menu={menu}
      />
      {banners.map((n) => (
        <GlobalNotice key={n.id} id={`living:${n.id}`} severity={n.level} title={n.text} />
      ))}
      <ConflictNotice id={`food-conflict-${date}`} conflicts={mealConflicts} quiet={quiet} />
      <Page className="lv-food">
        <DateControl value={dayPeriod(date)} today={today} onChange={(p) => selectDay(p.from)} useMarks={useLoggedDays} />

        {!rx ? (
          <Faceplate className="lv-food-empty" title={M.title}>
            <p className="lv-food-note">{FOOD_COPY.noPlanDay}</p>
          </Faceplate>
        ) : (
          // Reading order stays Targets, Meals, Groceries, Supplements, Pantry; cards fit their content on desktop.
          <Columns align="start" className="lv-food-grid">
              <TargetsFace rx={rx} totals={view!.logged.totals} logged={meals.length > 0} quiet={quiet} quietKey={quietKey} intake={view!.intake} date={date} coverage={view!.coverage} />

              <GradientCard id="meals" className="lv-food-meals" domain="food" glow="tl" head={<CardHead icon={Utensils} title={M.title} info={infoSpec(INFO.meals)} />} foot={<CardFoot state={{ word: quiet ? (slots.every((t) => doneOf(t.slot)) ? 'Logged' : 'Meals today') : `${slots.filter((t) => doneOf(t.slot) || grouped.bySlot.get(t.slot)?.length).length} of ${slots.length} logged` }}>{canLog ? <Key variant="text" icon={Plus} onClick={() => logger.open(null)}>{M.addFood}</Key> : null}</CardFoot>}>
                {running ? <ProgressRule label={M.running} /> : null}
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
                {fastDay ? <p className="lv-food-note">{M.fastDay}</p> : null}

                <div className="lv-rail-host">
                  <Rail className="lv-food-slots" label="Meals today">
                    {railStops.map((stop) => {
                      if (stop.kind === 'other') {
                        const e = stop.entry;
                        const outside = fastDay && !!rx.window && e.clockH !== undefined && !inWindow(e.clockH, rx.window);
                        return <OtherMealRow key={e.id} entry={e} quiet={quiet} taken={slotNames} outside={outside} />;
                      }
                      const t = stop.target;
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
                          {...(rows.get(t.slot) ? { status: rows.get(t.slot)!.status } : {})}
                          quiet={quiet}
                          canLog={canLog}
                          canPlan={canPlan}
                          familyFoodMode={profile.familyFoodMode}
                          busy={running}
                          {...(mealUndo[`${date}:${t.slot}`] ? { onUndo: () => undoMeal(t) } : {})}
                          onAteThis={() => void ateThis(t)}
                          onAccept={(r) => accept(t, r)}
                          onSwap={() => void planner.swap(t)}
                          onRetry={() => void planner.plan([t])}
                          onOpen={() => setMealSheet(t.slot)}
                          onRecipe={() => openRecipe(t.slot)}
                          onDontSuggest={(dish) => {
                            useFoodStore.getState().addDontSuggest(dish);
                            useFoodStore.getState().setSwapPrompt(k, null);
                          }}
                          onKeepSuggesting={() => useFoodStore.getState().setSwapPrompt(k, null)}
                        />
                      );
                    })}
                  </Rail>
                </div>
                {/* r068 L24: one status line on a fast day (above); a meal outside the window says so on its own row */}
                {untimed.length > 0 ? (
                  <div className="lv-food-other">
                    <h3 className="lv-food-other__title">{M.other}</h3>
                    <ul className="lv-food-logged-list">
                      {untimed.map((e) => (
                        <LoggedRow key={e.id} entry={e} quiet={quiet} />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </GradientCard>
              {weekList.count > 0 ? (
                <GroceriesFace
                  list={list}
                  quiet={quiet}
                  horizon={horizon}
                  onHorizon={setHorizon}
                  budget={groceries.budget()}
                  onBudget={(t) => groceries.setBudget(t)}
                  onBought={(k, b) => groceries.setBought(k, b)}
                  onHave={(n, h) => groceries.setHave(n, h)}
                  onShare={() => void shareList()}
                  onPrint={printList}
                  printing={printing}
                />
              ) : null}
              <SupplementsFace supplements={rx.supplements} taken={takenIds} canLog={canLog} quiet={quiet} profile={profile} onTaken={(s) => void taken(s)} onNoBenefit={() => setPanel('noBenefit')} />
              <PantryFaceplate className="lv-food-pantryface" coverage={{ have: groceryProgress(weekList).atHome, total: groceryProgress(weekList).total }} />
          </Columns>
        )}
      </Page>

      <MealSheet
        date={date}
        slot={rx && slots.some((t) => t.slot === mealSheet) ? mealSheet : null}
        quiet={quiet}
        onClose={() => setMealSheet(null)}
        onLogOther={logger.open}
        onRecipe={(t) => openRecipe(t.slot)}
        onAnswered={(t, _mark, undo) => keepMealUndo(t.slot, undo)}
      />
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
      {logger.element}
      <NoBenefitPanel open={panel === 'noBenefit'} onClose={() => setPanel(null)} />
      <KitchenPanel
        open={panel === 'kitchen'}
        onClose={() => setPanel(null)}
        blocked={kitchenBlocked}
        onRun={(pantry) => {
          setPanel(null);
          void planner.plan(openSlots, { pantry });
        }}
      />
    </>
  );
}
