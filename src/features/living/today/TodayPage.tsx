import '../boot';
import './today.css';
import { useEffect, useId, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { CalendarDays, CirclePause, ClipboardCheck, Inbox } from 'lucide-react';
import {
  CardHead,
  DottedTrack,
  GradientCard,
  HeroNumber,
  MonoMeta,
  Dialog,
  Key,
  KeyBank,
  Page,
  StatusCapsule,
  energyInText,
  toast,
  useMediaQuery,
  MQ,
} from '@/components';
import { GlobalNotice, PageFallback, TopBar, setNavBadge } from '@/app/shell';
import { addDays, daysBetween, isLocalDate } from '@/living/dates';
import type { LocalDate } from '@/living';
import { useActivePlan, useLivePlanReady } from '../mode';
import type { ActivePlan } from '../activePlan';
import { clockHourOf, useLivingClock, useToday } from '../clock';
import { TODAY_COPY } from '../copy';
import { useLivingActions } from '../data/actions';
import { useLiving } from '../data/source';
import { DateControl } from '../components/DateControl';
import { useLoggedDays } from '../components/dateMarks';
import { dayPeriod } from '../period';
import { fmtClock, fmtDay, fmtLongDay, grams, kcal, weekOf } from '../format';
import { useEnergyUnit } from '@/state/settingsStore';
import { livingPaths } from '../paths';
import { useFoodProfile } from '../food/profile';
import { lastTimedAt, todayRows, todayState } from './model';
import { CheckInSheet } from './components/CheckInSheet';
import { PrescriptionRows, weighFieldId } from './components/PrescriptionRows';
import { useTodayMenu } from './components/TodayMenu';
import {
  ChangesSheet,
  PausedSheet,
  SafetyResumeDialog,
  WelcomeBackSheet,
  waitingChanges,
} from './components/TodaySheets';
import { ConflictSheet } from '../components/LogConflict';
import { useAcceptedRecipes } from '../components/MealSheet';
import { WeighSheet } from './components/WeighSheet';
import { answerLapse, isLapseAnswered, lapseKey } from './welcomeBack';
import { MoveFromGauge, RingTodayNote, useRingTodayState } from '@/features/ring';
import '../progress/progress.css';
import { PlanlessToday } from './PlanlessToday';
import type { ReviewRow } from '@/living/activityCandidates';
import { useActivityData } from '../activity/data';
import { ActivitySheet, type PlannedSlot } from '../activity/ActivitySheet';
import { dayStripSegments } from '../activity/model';
import { todayCardRegistry } from './cards/registry';
import { useTodayCards } from './cards/useTodayCards';
import { TodayCards } from './cards/TodayCards';
import type { TodayCardCtx } from './cards/types';
import { HeroCard } from './components/HeroCard';
import { useRecordActivity } from './useRecordActivity';
import { LogActivitySheet } from './components/LogActivitySheet';

const C = TODAY_COPY;

/** Today is home with or without a plan. The day hero is fixed; supporting cards follow the device's registry choice.
 * Dates remain editable for backfill, previews stay read-only, and page actions work with every card removed. */
export default function TodayPage() {
  const params = useParams();
  const today = useToday();
  const plan = useActivePlan();
  const ready = useLivePlanReady();
  if (params.date !== undefined && !isLocalDate(params.date))
    return <Navigate to={livingPaths.today()} replace />;
  // the plan documents are still loading: "no plan" is not known yet
  if (!ready) return <PageFallback />;
  if (!plan) return <PlanlessToday today={today} date={params.date ?? today} />;
  return <TodayScreen plan={plan} date={params.date ?? today} today={today} />;
}

type SheetId = 'checkIn' | 'changes' | 'paused' | 'conflict' | 'safety';

function TodayScreen({ plan, date, today }: { plan: ActivePlan; date: LocalDate; today: LocalDate }) {
  const navigate = useNavigate();
  const actions = useLivingActions();
  const clock = useLivingClock();
  const lg = useMediaQuery(MQ.lg);
  const view = useLiving((s) => s.today(date), [date]);
  const dayConflicts = useLiving((s) => s.history(date, date)[0]?.conflicts ?? [], [date]);
  const week = useMemo(() => weekOf(date), [date]);
  const span = 13;
  const trend = useLiving(
    (s) => s.trend(addDays(date > today ? today : date, -span), date > today ? today : date),
    [date, today, span],
  );
  // the day's own weigh-in (the row shows it even before the trend filter has a trend)
  const weighInKg = useLiving(
    (s) => {
      const w = s.trend(date, date)?.weighIns ?? [];
      return w.length ? w.reduce((a, x) => a + x.value, 0) / w.length : undefined;
    },
    [date],
  );
  const changes = useLiving((s) => s.changes('today'), []);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [showNumbers, setShowNumbers] = useState(false);
  const ring = useRingTodayState();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [, setAnswered] = useState(0);
  const state = todayState(view, plan, date, today);
  const quiet = !!view?.quietMode && !showNumbers;
  const readOnly = state === 'future' || state === 'scheduled';
  const isToday = date === today;
  const pending = changes.some((c) => c.class === 'edit' && c.state === 'pending');
  const waiting = waitingChanges(changes, clock.now());
  const eu = useEnergyUnit();
  const ownSupplements = useFoodProfile().supplements?.rows ?? null;
  // accepted recipes: one serving of one is that meal as planned (the meal rows read their mark as the meal sheet does)
  const recipes = useAcceptedRecipes(view);
  const cardsControl = useTodayCards(todayCardRegistry, state !== 'future');
  const [logging, setLogging] = useState(false);
  const [scheduledDiscard, setScheduledDiscard] = useState(false);
  const recorder = useRecordActivity({ isToday });
  const menu = useTodayMenu({
    plan,
    today,
    quietMode: !!view?.quietMode,
    showNumbers,
    onToggleNumbers: () => setShowNumbers((s) => !s),
  });
  const pageMenu = [
    ...(state !== 'future' ? [{ id: 'edit-cards', label: cardsControl.editing ? 'Done editing cards' : 'Edit cards', onSelect: cardsControl.toggleEditing }] : []),
    { id: 'record-activity', label: 'Record an activity', onSelect: recorder.open, disabled: !recorder.can },
    { id: 'log-activity', label: 'Log an activity', onSelect: () => setLogging(true), disabled: readOnly },
    ...(state === 'scheduled'
      ? [{ id: 'discard-plan', label: C.scheduled.discard, onSelect: () => setScheduledDiscard(true) }]
      : []),
    ...menu.menu,
  ];
  // the activity model over the week so far (Heart Points count Monday on; (r070) activities are counted automatically, nothing to review)
  const activity = useActivityData();
  const activityView = activity.useToday(date, isToday);
  const reviewFrom = week[0]! < addDays(date, -6) ? week[0]! : addDays(date, -6);
  const review = activity.useReview(reviewFrom, date);
  const [editing, setEditing] = useState<ReviewRow | null>(null);

  useEffect(() => {
    setNavBadge('coach', pending);
  }, [pending]);

  // `[` `]` move one day; `W` opens the weigh-in (living-mode.md §4.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable))
      )
        return;
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        navigate(livingPaths.today(addDays(date, e.key === '[' ? -1 : 1)), { replace: true });
      } else if (e.key === 'w' || e.key === 'W') {
        const el = document.getElementById(weighFieldId(date));
        if (el) {
          e.preventDefault();
          el.click();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, navigate]);

  const select = (d: LocalDate) =>
    navigate(d === today ? livingPaths.today() : livingPaths.today(d), { replace: true });
  const day = view?.plan?.day ?? daysBetween(plan.startDate, date) + 1;
  const of = view?.plan?.of ?? daysBetween(plan.startDate, plan.plannedEndDate);
  // a day outside the plan has no plan-day number (it read "day 1 of 112" years before the start)
  const inPlan = day >= 1 && day <= of;
  // (r068 T8) another day is titled by its weekday ("Monday"), its date and plan day under it, with "Today" to go back
  const [weekday, dayMonth] = fmtLongDay(date).split(', ') as [string, string];
  const subtitle = [
    isToday ? fmtLongDay(date) : dayMonth,
    inPlan && state !== 'complete' ? C.dayOf(day, of) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // the header's status icons, most important first: a check-in due today, a (non-safety) pause, proposals waiting (the
  // bar shows two and lists the rest in its ⋯)
  const openPause = plan.pauses.find((p) => p.to === null) ?? null;
  const safety = plan.status === 'paused' && openPause?.reason === 'safety';
  const checkInDue = isToday && !!view?.notices.some((n) => n.kind === 'checkIn');
  const live = state !== 'complete' && state !== 'scheduled';
  const status = live ? (
    <>
      {checkInDue ? (
        <StatusCapsule
          icon={ClipboardCheck}
          label={C.status.checkIn}
          attention
          aria-haspopup="dialog"
          onClick={() => setSheet('checkIn')}
        />
      ) : null}
      {plan.status === 'paused' && !safety ? (
        <StatusCapsule
          icon={CirclePause}
          label={C.status.paused}
          aria-haspopup="dialog"
          onClick={() => setSheet('paused')}
        />
      ) : null}
      {waiting > 0 ? (
        <StatusCapsule
          icon={Inbox}
          label={C.status.changes(waiting)}
          attention
          aria-haspopup="dialog"
          onClick={() => setSheet('changes')}
        />
      ) : null}
    </>
  ) : null;

  const backToToday = isToday ? undefined : (
    <Key size="sm" variant="outlined" onClick={() => navigate(livingPaths.today(), { replace: true })}>
      {C.title}
    </Key>
  );
  const top = (
    <TopBar
      title={isToday ? C.title : weekday}
      documentTitle={isToday ? C.title : `${weekday}, ${dayMonth}`}
      subtitle={subtitle}
      status={status}
      menu={pageMenu}
      {...(backToToday ? { primary: backToToday } : {})}
    />
  );

  // the one banner under the header (app-level states): a safety pause, entries changed on two devices
  const safetyKey = useMemo(
    () => (
      <Key size="sm" variant="text" onClick={() => setSheet('safety')}>
        {C.safety.resume}
      </Key>
    ),
    [],
  );
  const conflictKey = useMemo(
    () => (
      <Key size="sm" variant="text" onClick={() => setSheet('conflict')}>
        {C.conflict.review}
      </Key>
    ),
    [],
  );
  const banners = (
    <>
      {safety ? (
        <GlobalNotice id="today-safety-pause" severity="danger" title={C.safety.title} actions={safetyKey} />
      ) : null}
      {dayConflicts.length ? (
        <GlobalNotice
          id={`today-conflict-${date}`}
          severity="caution"
          title={C.conflict.title(dayConflicts.length)}
          actions={conflictKey}
        />
      ) : null}
    </>
  );

  // welcome back: once per lapse, on the real today only (on another day the "missed" gap runs to that day)
  const wb =
    isToday && (state === 'active' || state === 'paused' || state === 'safetyPause')
      ? view?.notices.find((n) => n.kind === 'welcomeBack')
      : undefined;
  const gap =
    (wb?.command?.input as { days?: Array<{ date: LocalDate }> } | undefined)?.days?.map((d) => d.date) ?? [];
  const lapse = wb ? lapseKey(plan.id, gap) : null;
  const answer = () => {
    if (lapse) answerLapse(lapse);
    setAnswered((n) => n + 1);
  };

  // the day's planned sessions: what "This was my planned …" offers in the activity sheet
  const plannedSlots: PlannedSlot[] = (view?.prescription?.sessions ?? []).map((x) => ({
    itemId: `${x.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${x.slotKey}`,
    name:
      x.kind === 'resistance'
        ? 'lift'
        : x.engine[0]?.kind === 'cardio' && x.engine[0].modality !== 'other'
          ? x.engine[0].modality
          : 'cardio',
    startH: x.startH,
  }));
  const plannedSlotsOn = (d: LocalDate) => (d === date ? plannedSlots : []);

  const sheets = (
    <>
      {menu.sheets}
      {recorder.sheet}
      {logging ? (
        <LogActivitySheet date={date} today={today} quiet={quiet} onClose={() => setLogging(false)} />
      ) : null}
      <CheckInSheet
        open={sheet === 'checkIn'}
        onClose={() => setSheet(null)}
        today={today}
        quiet={!!view?.quietMode}
      />
      <ChangesSheet open={sheet === 'changes'} onClose={() => setSheet(null)} changes={changes} />
      <PausedSheet
        open={sheet === 'paused'}
        onClose={() => setSheet(null)}
        since={openPause?.from ?? null}
        today={today}
      />
      <ConflictSheet
        open={sheet === 'conflict'}
        onClose={() => setSheet(null)}
        conflicts={dayConflicts}
        quiet={quiet}
      />
      <SafetyResumeDialog open={sheet === 'safety'} onClose={() => setSheet(null)} today={today} />
      {lapse && sheet === null && !isLapseAnswered(lapse) ? (
        <WelcomeBackSheet gap={gap} onAnswer={answer} />
      ) : null}
      <ActivitySheet
        row={editing}
        onClose={() => setEditing(null)}
        quiet={quiet}
        recent={[...new Set(review.decided.map((r) => r.exerciseId))]}
        planned={editing ? plannedSlotsOn(editing.date) : []}
      />
    </>
  );

  const rx = view?.prescription ?? null;
  const rows = view
    ? todayRows(view, {
        ...(weighInKg !== undefined ? { weighInKg } : {}),
        supplements: ownSupplements,
        recipes,
      })
    : [];
  const nowH = isToday ? clockHourOf(clock) : null;
  const ticked = rows.filter((r) => r.status !== 'empty').length;
  const showHowHard = date < today || (nowH !== null && nowH >= 18) || ticked >= 3;
  const markItem = view?.checklist.find((c) => c.id === 'mark:all');
  const dayMarked = !!markItem?.done;
  const lastAt = lastTimedAt(rows);
  // the whole day at once only once it is over (a past date, or after the last timed item): never ticks what is ahead
  const canMarkDay =
    !readOnly &&
    !!markItem &&
    !dayMarked &&
    (state === 'past' || (nowH !== null && lastAt !== null && nowH > lastAt));
  const lastKg = trend?.weighIns.at(-1)?.value ?? weighInKg;

  const markKey = canMarkDay ? (
    <Key
      size="sm"
      variant="text"
      onClick={() =>
        void actions
          .markDay(date, 'asPlanned')
          .then((o) =>
            toast(
              o.ok ? C.dayMarked : (o.message ?? C.failed),
              o.undo ? { action: { label: C.undo, onClick: () => void o.undo?.() } } : {},
            ),
          )
      }
    >
      {C.markDay}
    </Key>
  ) : undefined;

  // the plan day as a 24 h strip above the rail (D18): sleep, the eating window, the fast, training
  const midnight = new Date(`${date}T00:00:00`).getTime();
  const dayStrip = rx
    ? {
        from: midnight,
        to: midnight + 86_400_000,
        now: isToday ? clock.now().getTime() : null,
        segments: dayStripSegments({
          dayStart: midnight,
          sleep: rx.sleep ?? null,
          window: rx.window ?? null,
          sessions: rx.sessions,
        }),
      }
    : null;

  const ctx: TodayCardCtx = {
    date,
    today,
    isToday,
    plan,
    planless: false,
    state,
    view,
    trend,
    review,
    rows,
    nowH,
    nowMs: clock.now().getTime(),
    quiet: quiet || safety,
    lg,
    eu,
    ring,
    activityView,
    openActivity: setEditing,
    focusPlan: setHighlight,
    record: { can: recorder.can, open: recorder.open },
    log: { can: !readOnly, open: () => setLogging(true) },
  };
  const rail = {
    highlight,
    nowH: state === 'active' ? nowH : null,
    lastKg,
    bedH: rx?.sleep?.bedH ?? null,
    sleepTargetH: rx?.sleep ? (rx.sleep.wakeH - rx.sleep.bedH + 24) % 24 : null,
    fastTargetH: rx?.fast?.hours ?? null,
    fastElapsedH: view?.logged.fast?.state === 'running' ? (view.logged.fast.sinceH ?? null) : null,
    stepsTarget: rx?.steps ?? null,
  };
  const activeHero = (
    <HeroCard
      ctx={ctx}
      strip={dayStrip}
      rail={rail}
      markKey={markKey}
      howHard={rx && showHowHard && !readOnly ? <HowHard key={date} date={date} /> : null}
      onResume={() => setSheet(safety ? 'safety' : 'paused')}
    />
  );
  return (
    <>
      {top}
      {banners}
      <Page className="lv-today">
        <MoveFromGauge />
        <DateControl
          value={dayPeriod(date)}
          today={today}
          onChange={(p) => select(p.from)}
          useMarks={useLoggedDays}
        />
        <TodayCards
          ctx={ctx}
          cards={cardsControl}
          hero={
            state === 'scheduled' ? (
              <ScheduledState
                plan={plan}
                today={today}
                quiet={quiet}
                discarding={scheduledDiscard}
                onCloseDiscard={() => setScheduledDiscard(false)}
              />
            ) : state === 'complete' ? (
              <CompleteState plan={plan} today={today} quiet={quiet} />
            ) : (
              activeHero
            )
          }
          planContent={
            <PrescriptionRows rows={rows} date={date} readOnly={readOnly} quiet={quiet || safety} {...rail} />
          }
        />
        {isToday ? <RingTodayNote state={ring} /> : null}
      </Page>
      {sheets}
    </>
  );
}

const HARD_WORD: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'easy',
  2: 'fine',
  3: 'OK',
  4: 'hard',
  5: 'very hard',
};

/**
 * "How hard was today?" as the plan card's last section (the day's end-of-day question sits with the day it asks about):
 * five keys, then one saved line ("Felt hard · 4 of 5") with Undo and Change.
 */
function HowHard({ date }: { date: LocalDate }) {
  const headingId = useId();
  const actions = useLivingActions();
  const [saved, setSaved] = useState<{ v: 1 | 2 | 3 | 4 | 5; undo?: () => Promise<unknown> } | null>(null);
  const [changing, setChanging] = useState(false);
  const answer = (v: 1 | 2 | 3 | 4 | 5) =>
    void actions.logDifficulty(date, v).then((o) => {
      if (!o.ok) return void toast(o.message ?? C.failed);
      setSaved({ v, ...(o.undo ? { undo: o.undo } : {}) });
      setChanging(false);
    });
  return (
    <div className="lv-hard">
      <h3 className="lm-section-label lv-hard__title" id={headingId}>
        {C.howHardTitle}
      </h3>
      {saved && !changing ? (
        <div className="lv-hard__saved">
          <span className="lv-hard__value">
            <span className="lv-hard__felt">Felt </span>
            {HARD_WORD[saved.v]}
          </span>
          <span className="lv-hard__keys">
            {saved.undo ? (
              <Key
                size="sm"
                variant="outlined"
                aria-label="Undo how hard it was"
                onClick={() => void saved.undo?.().then(() => setSaved(null))}
              >
                {C.undo}
              </Key>
            ) : null}
            <Key size="sm" variant="outlined" onClick={() => setChanging(true)}>
              Change
            </Key>
          </span>
        </div>
      ) : (
        <KeyBank
          labelledBy={headingId}
          block
          size="lg"
          className="lv-hard__bank"
          options={([1, 2, 3, 4, 5] as const).map((v) => ({
            value: String(v),
            label: (
              <span className="lv-hard__opt">
                <span className="lv-hard__tick" aria-hidden="true" />
                <span className="lv-hard__word">{HARD_WORD[v]}</span>
              </span>
            ),
          }))}
          {...(saved ? { defaultValue: String(saved.v) } : {})}
          onChange={(v) => answer(Number(v) as 1 | 2 | 3 | 4 | 5)}
        />
      )}
    </div>
  );
}

/**
 * Scheduled (start ahead): the plan's numbers under "Starts tomorrow", what to do before day 1 (each with its own key),
 * and a read-only preview of day 1's rail.
 */
function ScheduledState({
  plan,
  today,
  quiet,
  discarding,
  onCloseDiscard,
}: {
  plan: ActivePlan;
  today: LocalDate;
  quiet: boolean;
  discarding: boolean;
  onCloseDiscard(): void;
}) {
  const navigate = useNavigate();
  const actions = useLivingActions();
  const eu = useEnergyUnit();
  const [weighing, setWeighing] = useState(false);
  const day1 = useLiving((s) => s.today(plan.startDate), [plan.startDate]);
  const toGo = daysBetween(today, plan.startDate);
  const rx = day1?.prescription;
  return (
    <>
      <GradientCard
        as="section"
        domain="plan"
        size="hero"
        className="lv-scheduled"
        head={
          <CardHead
            icon={CalendarDays}
            title={toGo === 1 ? 'Starts tomorrow' : `Starts ${fmtDay(plan.startDate)}`}
            info={{
              body: 'Your plan starts on this date. Before day one, check your groceries and log your first weight. The preview is read-only. You can discard a scheduled plan from the page menu.',
            }}
          />
        }
      >
        <HeroNumber
          value={toGo}
          unit={toGo === 1 ? 'day to go' : 'days to go'}
          size="num-l"
          label={`${toGo} days until your plan starts`}
        />
        <MonoMeta>Day 1 · {fmtDay(plan.startDate)}</MonoMeta>
        <dl className="lv-facts">
          {[
            ['Length', `${daysBetween(plan.startDate, plan.plannedEndDate)} days`],
            ...(!quiet && rx
              ? [
                  ['Eat each day', energyInText(`${kcal(rx.energyKcal)} kcal`, eu)],
                  ['Protein', `${grams(rx.macros.proteinG)} g`],
                ]
              : []),
            ...(rx?.window
              ? [['Eating window', `${fmtClock(rx.window.startH)}–${fmtClock(rx.window.endH)}`]]
              : []),
          ].map(([k, v]) => (
            <div className="lv-facts__item" key={k}>
              <dt>{k}</dt>
              <dd className="lm-meta">{v}</dd>
            </div>
          ))}
        </dl>
        <h3>Before day 1</h3>
        <ul className="lv-todo">
          <li className="lv-todo__item">
            <span>{C.scheduled.groceries}</span>
            <Key variant="text" onClick={() => navigate(livingPaths.food(plan.startDate, 'groceries'))}>
              Open list
            </Key>
          </li>
          <li className="lv-todo__item">
            <span>{C.scheduled.firstWeighIn}</span>
            <Key variant="text" onClick={() => setWeighing(true)}>
              Log weight
            </Key>
          </li>
        </ul>
        <details className="lv-day1">
          <summary>Day 1</summary>
          {day1 ? (
            <PrescriptionRows rows={todayRows(day1)} date={plan.startDate} readOnly quiet={quiet} />
          ) : null}
        </details>
      </GradientCard>
      {weighing ? <WeighSheet open date={today} onClose={() => setWeighing(false)} /> : null}
      <Dialog
        open={discarding}
        onClose={onCloseDiscard}
        title={C.scheduled.discardTitle(plan.name)}
        role="alertdialog"
        footer={
          <>
            <Key variant="text" onClick={onCloseDiscard}>
              {C.cancel}
            </Key>
            <Key
              variant="danger"
              onClick={() =>
                void actions.discard().then((o) => {
                  if (o.ok) {
                    onCloseDiscard();
                    navigate('/plan');
                  }
                  toast(o.ok ? C.scheduled.discarded(plan.name) : (o.message ?? C.failed));
                })
              }
            >
              {C.scheduled.discardKey}
            </Key>
          </>
        }
      >
        <p>{C.scheduled.discardBody}</p>
      </Dialog>
    </>
  );
}

function CompleteState({ plan, today, quiet }: { plan: ActivePlan; today: LocalDate; quiet: boolean }) {
  const navigate = useNavigate();
  const trend = useLiving(
    (s) => s.trend(plan.startDate, plan.plannedEndDate),
    [plan.startDate, plan.plannedEndDate],
  );
  const adherence = useLiving((s) => s.adherence(today), [today]);
  const weeks = useLiving(
    (s) => {
      const out: Array<{ date: LocalDate; score: number }> = [];
      for (let end = addDays(plan.startDate, 6); end <= plan.plannedEndDate; end = addDays(end, 7)) {
        const score = s.adherence(end).a7;
        if (score !== null) out.push({ date: end, score });
      }
      return out;
    },
    [plan.startDate, plan.plannedEndDate],
  );
  const sorted = [...weeks].sort((a, b) => a.score - b.score);
  const best = sorted.at(-1);
  const worst = sorted[0];
  const first = trend?.trend.find(Number.isFinite);
  const last = trend?.trend.filter(Number.isFinite).at(-1);
  return (
    <GradientCard
      as="section"
      domain="plan"
      size="hero"
      className="lv-complete"
      head={
        <CardHead
          icon={CalendarDays}
          title={C.complete(plan.name)}
          info={{
            body: 'Your completed plan, using the weight trend and the days you logged. The trend smooths ordinary daily weight changes. A missing result means there were not enough readings; no result is filled in for you.',
            source: { kind: 'logged' },
          }}
        />
      }
    >
      <HeroNumber
        value={
          quiet
            ? 'Plan complete'
            : first !== undefined && last !== undefined
              ? `${first.toFixed(1)} → ${last.toFixed(1)}`
              : 'Plan complete'
        }
        unit={!quiet && first !== undefined && last !== undefined ? trend?.unit : undefined}
        size="num"
        label={
          quiet
            ? 'Plan complete'
            : first !== undefined && last !== undefined
              ? `Weight trend from ${first.toFixed(1)} to ${last.toFixed(1)} ${trend?.unit}`
              : 'Plan complete'
        }
      />
      {!quiet && trend?.trendSd?.at(-1) != null && last !== undefined ? (
        <MonoMeta>
          Likely {(last - 1.645 * trend.trendSd.at(-1)!).toFixed(1)}–
          {(last + 1.645 * trend.trendSd.at(-1)!).toFixed(1)} {trend.unit}
        </MonoMeta>
      ) : null}
      {adherence ? (
        <DottedTrack
          label="Plan followed"
          value={adherence.a28}
          valueText={
            adherence.a28 === null
              ? 'Not enough logged days'
              : `${Math.round(adherence.a28)}% over the last four weeks`
          }
          goal={100}
          quiet={quiet}
          quietWord="As logged"
          hue="plan"
        />
      ) : null}
      {best && worst ? (
        <dl className="lv-facts">
          <div className="lv-facts__item">
            <dt>Best week</dt>
            <dd className="lm-meta">
              {quiet ? 'As logged' : `Ending ${fmtDay(best.date)} · ${Math.round(best.score)}%`}
            </dd>
          </div>
          <div className="lv-facts__item">
            <dt>Hardest week</dt>
            <dd className="lm-meta">
              {quiet ? 'As logged' : `Ending ${fmtDay(worst.date)} · ${Math.round(worst.score)}%`}
            </dd>
          </div>
        </dl>
      ) : null}
      <Key variant="primary" arrow onClick={() => navigate('/plan/goals')}>
        {C.planAgain}
      </Key>
    </GradientCard>
  );
}
