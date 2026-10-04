import '../boot';
import './today.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Dialog, Engraved, Faceplate, Key, KeyBank, Notice, Page, toast, useMediaQuery, MQ } from '@/components';
import { ActionBar, TopBar, setNavBadge } from '@/app/shell';
import { addDays, daysBetween, isLocalDate } from '@/living/dates';
import type { LocalDate, TodayView } from '@/living';
import { useActivePlan } from '../mode';
import type { ActivePlan } from '../activePlan';
import { clockHourOf, useLivingClock, useToday } from '../clock';
import { TODAY_COPY } from '../copy';
import { useLivingActions } from '../data/actions';
import { useLiving } from '../data/source';
import { DateStrip } from '../components/DateStrip';
import { LogConflict } from '../components/LogConflict';
import { ChangeCard } from '../components/ChangeCard';
import { CoachComposer } from '../components/CoachComposer';
import { SignalsStrip } from '../components/ScoreTile';
import { useScores } from '../data/scores';
import { useCoachAdapter } from '../coach/adapter';
import { fmtDay, weekOf } from '../format';
import { livingPaths } from '../paths';
import type { ChangeAction } from '../model/changeCard';
import { useFoodProfile } from '../food/profile';
import { intentionsLine, todayRows, todayState } from './model';
import { CheckInSheet } from './components/CheckInSheet';
import { ForecastFace, SoFarFace } from './components/Faces';
import { NoticesZone } from './components/NoticesZone';
import { PrescriptionRows, weighFieldId } from './components/PrescriptionRows';
import { TodayDial, dialCentre } from './components/TodayDial';
import { TodayMenu } from './components/TodayMenu';

/**
 * Today (`/today`, `/today/:date`; design/screens/living-mode.md §4): the day's prescription on a printed 24 h dial and
 * a checklist ticked in ten seconds, what is logged so far against the targets (with ranges and sources), the
 * adherence dial "so far", the weight trend against the forecast band with the goal-date line, body signals, and the
 * Coach log bar. Past dates are editable (backfill); future dates are read-only previews. Reads `TodayView` (E5's
 * contract) through the Living data source; every tap goes through `LivingActions`.
 */
export default function TodayPage() {
  const params = useParams();
  const today = useToday();
  const plan = useActivePlan();
  if (params.date !== undefined && !isLocalDate(params.date)) return <Navigate to={livingPaths.today()} replace />;
  if (!plan) return null; // the route guard redirects
  return <TodayScreen plan={plan} date={params.date ?? today} today={today} />;
}

function TodayScreen({ plan, date, today }: { plan: ActivePlan; date: LocalDate; today: LocalDate }) {
  const navigate = useNavigate();
  const actions = useLivingActions();
  const clock = useLivingClock();
  const lg = useMediaQuery(MQ.lg);
  const xl = useMediaQuery(MQ.xl);
  const view = useLiving((s) => s.today(date), [date]);
  const dayConflicts = useLiving((s) => s.history(date, date)[0]?.conflicts ?? [], [date]);
  const week = useMemo(() => weekOf(date), [date]);
  const days = useLiving((s) => s.days(week), [week]);
  const span = lg ? 13 : 6;
  const trend = useLiving((s) => s.trend(addDays(date > today ? today : date, -span), date > today ? today : date), [date, today, span]);
  // the day's own weigh-in (the row shows it even before the trend filter has a trend) and "N of the last 7 days
  // logged" counting this day too (the adherence trend only covers the finished days before it)
  const weighInKg = useLiving((s) => {
    const w = s.trend(date, date)?.weighIns ?? [];
    return w.length ? w.reduce((a, x) => a + x.value, 0) / w.length : undefined;
  }, [date]);
  const daysLogged7 = useLiving((s) => s.days(Array.from({ length: 7 }, (_, i) => addDays(date, i - 6))).filter((d) => d.logged).length, [date]);
  const changes = useLiving((s) => s.changes('today'), []);
  const recent = useLiving((s) => s.changes('all').filter((c) => c.class === 'log').slice(0, 3), []);
  const [checkIn, setCheckIn] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const state = todayState(view, plan, date, today);
  const quiet = !!view?.quietMode && !showNumbers;
  const readOnly = state === 'future' || state === 'scheduled';
  const pending = changes.some((c) => c.class === 'edit' && c.state === 'pending');
  const coachReason = useCoachStatusReason();
  const ownSupplements = useFoodProfile().supplements?.rows ?? null;

  useEffect(() => {
    setNavBadge('coach', pending);
  }, [pending]);

  // `[` `]` move one day; `W` focuses the weigh-in (living-mode.md §4.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable))) return;
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        navigate(livingPaths.today(addDays(date, e.key === '[' ? -1 : 1)), { replace: true });
      } else if (e.key === 'w' || e.key === 'W') {
        const el = document.getElementById(weighFieldId(date));
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, navigate]);

  const select = (d: LocalDate) => navigate(d === today ? livingPaths.today() : livingPaths.today(d), { replace: true });
  const day = view?.plan?.day ?? daysBetween(plan.startDate, date) + 1;
  const of = view?.plan?.of ?? daysBetween(plan.startDate, plan.plannedEndDate);
  // a day outside the plan has no plan-day number (it read "day 1 of 112" years before the start)
  const context = day >= 1 && day <= of ? `${fmtDay(date)} · day ${day} of ${of}` : fmtDay(date);
  const rung = plan.rung === 'custom' ? 'your plan' : plan.rung;

  const title = date === today ? TODAY_COPY.title : fmtDay(date);
  const top = (
    <TopBar
      title={title}
      documentTitle={TODAY_COPY.title}
      params={
        <Engraved>
          {context} · {plan.name} ({rung})
        </Engraved>
      }
      actions={<TodayMenu plan={plan} today={today} onCheckIn={() => setCheckIn(true)} />}
    />
  );

  if (state === 'complete')
    return (
      <>
        {top}
        <CompleteState plan={plan} />
      </>
    );
  if (state === 'scheduled')
    return (
      <>
        {top}
        <ScheduledState plan={plan} today={today} />
      </>
    );

  const extra = noticesFor(state, plan, view, today, welcomeDismissed, setWelcomeDismissed, actions);
  const rx = view?.prescription ?? null;
  const rows = view ? todayRows(view, { ...(weighInKg !== undefined ? { weighInKg } : {}), supplements: ownSupplements }) : [];
  const nowH = date === today ? clockHourOf(clock) : null;
  const ticked = rows.filter((r) => r.status !== 'empty').length;
  const showHowHard = date < today || (nowH !== null && nowH >= 18) || ticked >= 3;
  const dayMarked = view?.checklist.some((c) => c.id === 'mark:all' && c.done) ?? false;
  const markItem = view?.checklist.find((c) => c.id === 'mark:all');

  const planFace = (
    <Faceplate
      title={TODAY_COPY.planFace}
      aria-label={TODAY_COPY.planFace}
      className="lv-plan"
      caption={state === 'past' ? TODAY_COPY.pastDay : state === 'future' ? TODAY_COPY.futureDay : undefined}
      actions={
        !readOnly && markItem ? (
          <Key
            size="sm"
            pressed={dayMarked}
            onClick={() =>
              void actions.markDay(date, 'asPlanned').then((o) =>
                toast(o.ok ? TODAY_COPY.dayMarked : (o.message ?? 'That didn’t work.'), o.undo ? { action: { label: TODAY_COPY.undo, onClick: () => void o.undo?.() } } : {}),
              )
            }
          >
            {TODAY_COPY.markDay}
          </Key>
        ) : undefined
      }
    >
      {date === today ? <p className="lv-plan__intent">{intentionsLine(plan.intentions.weighInClockH, plan.intentions.missedSessionPlan, TODAY_COPY)}</p> : null}
      {rx ? (
        <div className="lv-plan__body" data-ring={xl ? 'left' : 'top'}>
          <TodayDial rx={rx} nowH={nowH} size={xl ? 240 : 200} centre={dialCentre(rx, nowH, view?.logged.fast)} quiet={quiet} />
          <div className="lv-plan__rows">
            <PrescriptionRows rows={view?.minimalMode ? rows.filter((r) => r.glyph === 'weigh') : rows} date={date} readOnly={readOnly} quiet={quiet} highlight={highlight} />
            {showHowHard && !readOnly ? (
              <div className="lv-plan__hard">
                <KeyBank
                  label={TODAY_COPY.howHard}
                  size="sm"
                  options={(['1', '2', '3', '4', '5'] as const).map((v) => ({ value: v, label: v }))}
                  onChange={(v) => void actions.logDifficulty(date, Number(v) as 1 | 2 | 3 | 4 | 5).then(() => toast('Thanks. It helps the plan learn what works for you.'))}
                />
                <Engraved>{TODAY_COPY.howHardScale}</Engraved>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="lv-plan__empty">Nothing is prescribed for this day.</p>
      )}
    </Faceplate>
  );

  const sendToCoach = (msg: { text: string; photo?: File }) => navigate(livingPaths.coach(), { state: { draft: { ...msg, context: { date, screen: 'today' } } } });
  const composer = <CoachComposer variant="bar" onSend={sendToCoach} disabledReason={coachReason} chips={view?.coachPrompts.slice(0, 3)} placeholder={TODAY_COPY.logBar} label={TODAY_COPY.logBar} />;

  return (
    <>
      {top}
      <Page className="lv-today">
        <p className="lv-today__context">
          <span className="lm-num">{context}</span>
          <Engraved>
            {plan.name} · {rung}
          </Engraved>
        </p>
        <DateStrip days={days} selected={date} today={today} onSelect={select} onWeek={(d) => select(addDays(date, d * 7))} quiet={!!view?.quietMode} />
        {view?.quietMode ? (
          <div className="lv-today__quiet">
            <Key size="sm" variant="quiet" onClick={() => setShowNumbers((s) => !s)}>
              {showNumbers ? TODAY_COPY.hideNumbers : TODAY_COPY.showNumbers}
            </Key>
          </div>
        ) : null}
        <div className="lv-today__grid">
          <div className="lv-today__main">
            {!lg ? <NoticesZone notices={view?.notices ?? []} changes={changes} extra={extra} onCheckIn={() => setCheckIn(true)} /> : null}
            {dayConflicts.map((conflict) => <LogConflict key={conflict.parentId} conflict={conflict} quiet={quiet} />)}
            {planFace}
            {lg ? (
              <Faceplate title="Tell the Coach" aria-label="Tell the Coach" className="lv-tell">
                {composer}
                {recent.length ? (
                  <div className="lv-tell__cards">
                    {recent.map((c) => (
                      <ChangeCard key={c.id} card={c} now={clock.now()} context="conversation" onAction={(a: ChangeAction) => onCardAction(actions, c.id, a)} />
                    ))}
                  </div>
                ) : null}
              </Faceplate>
            ) : null}
          </div>
          <div className="lv-today__side">
            {lg ? <NoticesZone notices={view?.notices ?? []} changes={changes} extra={extra} onCheckIn={() => setCheckIn(true)} /> : null}
            {view ? <SoFarFace view={view} quiet={quiet} size={lg ? 'md' : 'sm'} daysLogged7={daysLogged7} onArc={(id) => setHighlight(id)} /> : null}
            {view ? <ForecastFace view={view} trend={trend} quiet={!!view.quietMode} compact={!lg} /> : null}
            {view?.biometrics ? <TodaySignals /> : null}
          </div>
        </div>
      </Page>
      {!lg && !readOnly ? <ActionBar>{composer}</ActionBar> : null}
      <CheckInSheet open={checkIn} onClose={() => setCheckIn(false)} today={today} quiet={!!view?.quietMode} />
    </>
  );
}

function onCardAction(actions: ReturnType<typeof useLivingActions>, id: string, a: ChangeAction) {
  const done = (o: { ok: boolean; message?: string }, msg: string) => toast(o.ok ? msg : (o.message ?? 'That didn’t work.'));
  if (a === 'undo') void actions.undoChange(id).then((o) => done(o, 'Undone.'));
  else if (a === 'redo') void actions.redoChange(id).then((o) => done(o, 'Redone.'));
  else if (a === 'apply') void actions.applyChange(id).then((o) => done(o, 'Applied.'));
  else if (a === 'discard') void actions.discardChange(id).then((o) => done(o, 'Discarded.'));
}

/** The Coach's disabled reason for the log bar (no provider yet → log by hand). */
function useCoachStatusReason(): string | undefined {
  const coach = useCoachAdapter();
  return coach.status().kind === 'noProvider' ? 'Connect an AI provider in Settings to chat. You can still log everything by hand.' : undefined;
}

function TodaySignals() {
  const tiles = useScores('today');
  if (!tiles.length) return null;
  return <SignalsStrip title={TODAY_COPY.signals} tiles={tiles} columns={1} />;
}

/** Page-level notices: paused, safety pause, welcome back (ranked with the zone's own). */
function noticesFor(
  state: ReturnType<typeof todayState>,
  plan: ActivePlan,
  view: TodayView | null,
  today: LocalDate,
  welcomeDismissed: boolean,
  dismissWelcome: (on: boolean) => void,
  actions: ReturnType<typeof useLivingActions>,
) {
  const out: Array<{ key: string; rank: number; node: ReactNode }> = [];
  const open = plan.pauses.find((p) => p.to === null);
  if (state === 'paused' && open) {
    out.push({
      key: 'paused',
      rank: 2,
      node: (
        <Notice severity="info" layout="ruled" title={TODAY_COPY.paused(fmtDay(open.from))} actions={<ResumeKey today={today} />}>
          {TODAY_COPY.pausedBody}
        </Notice>
      ),
    });
  }
  if (state === 'safetyPause') out.push({ key: 'safety', rank: 1, node: <SafetyPauseNotice today={today} /> });
  const wb = view?.notices.find((n) => n.kind === 'welcomeBack');
  // the catch-up offer belongs to the real today: on another day the "missed" gap runs to that day (future days included)
  if (wb && !welcomeDismissed && (state === 'active' || state === 'paused' || state === 'safetyPause')) {
    const input = wb.command?.input as { days?: Array<{ date: LocalDate }> } | undefined;
    const gap = input?.days?.map((d) => d.date) ?? [];
    out.push({
      key: 'welcome',
      rank: 6,
      node: (
        <Notice
          severity="info"
          layout="ruled"
          title={TODAY_COPY.welcomeBack}
          actions={
            gap.length ? (
              <>
                <Key size="sm" onClick={() => void actions.backfill(gap).then(() => dismissWelcome(true))}>
                  {TODAY_COPY.backfillYes}
                </Key>
                <Key size="sm" variant="quiet" onClick={() => dismissWelcome(true)}>
                  {TODAY_COPY.backfillNo}
                </Key>
              </>
            ) : undefined
          }
        >
          {TODAY_COPY.welcomeBackBody}
          {gap.length ? ` ${TODAY_COPY.backfill(gap.length)}` : ''}
        </Notice>
      ),
    });
  }
  return out;
}

function ResumeKey({ today }: { today: LocalDate }) {
  const actions = useLivingActions();
  return (
    <Key size="sm" onClick={() => void actions.resume(today).then((o) => toast(o.ok ? 'The plan is running again.' : (o.message ?? 'Couldn’t resume.')))}>
      {TODAY_COPY.resume}
    </Key>
  );
}

/** Safety pause (living-mode.md §4.6): danger notice; only the person resumes, through an acknowledgement dialog. */
function SafetyPauseNotice({ today }: { today: LocalDate }) {
  const actions = useLivingActions();
  const navigate = useNavigate();
  const [ack, setAck] = useState(false);
  return (
    <>
      <Notice
        severity="danger"
        layout="ruled"
        title="Your plan is paused for safety."
        actions={
          <>
            <Key size="sm" onClick={() => navigate(livingPaths.planActive)}>
              See what changed
            </Key>
            <Key size="sm" onClick={() => setAck(true)}>
              Resume…
            </Key>
          </>
        }
      >
        Your plan is paused. Only you can resume it.
      </Notice>
      <Dialog
        open={ack}
        onClose={() => setAck(false)}
        title="Resume the plan?"
        role="alertdialog"
        footer={
          <>
            <Key onClick={() => setAck(false)}>{TODAY_COPY.cancel}</Key>
            <Key variant="danger" onClick={() => void actions.resume(today).then(() => setAck(false))}>
              Resume plan
            </Key>
          </>
        }
      >
        <p>The plan was paused because of a safety rule. Resume only if the reason no longer applies; you can pause again at any time.</p>
      </Dialog>
    </>
  );
}

/** Scheduled (start ahead): the countdown, things to do before day 1 and a read-only preview of day 1. */
function ScheduledState({ plan, today }: { plan: ActivePlan; today: LocalDate }) {
  const navigate = useNavigate();
  const actions = useLivingActions();
  const day1 = useLiving((s) => s.today(plan.startDate), [plan.startDate]);
  const when = plan.startDate === addDays(today, 1) ? `tomorrow (${fmtDay(plan.startDate)})` : fmtDay(plan.startDate);
  const weighIn = plan.intentions.weighInClockH;
  return (
    <Page className="lv-today">
      <div className="lv-today__grid">
        <div className="lv-today__main">
          <Faceplate title={TODAY_COPY.scheduled(plan.name, when)} className="lv-scheduled">
            <p className="lv-plan__intent">{TODAY_COPY.beforeDay1}</p>
            <ul className="lv-scheduled__list">
              <li>Nothing to buy for this plan.</li>
              <li>
                Groceries for the first 3 days are on{' '}
                <Link to={livingPaths.food(plan.startDate, 'groceries')}>Food</Link>
                .
              </li>
              <li>{TODAY_COPY.firstWeighIn(weighIn !== undefined ? `${String(Math.floor(weighIn)).padStart(2, '0')}:${String(Math.round((weighIn % 1) * 60)).padStart(2, '0')}` : '07:00')}</li>
            </ul>
            <div className="lv-scheduled__keys">
              <Key disabledReason="To start on another day, discard the plan and start it again from the Planner.">{TODAY_COPY.changeStart}</Key>
              <Key
                variant="quiet"
                onClick={() =>
                  void actions.discard().then((o) => {
                    toast(o.ok ? `${plan.name} was discarded.` : (o.message ?? 'Couldn’t discard.'));
                    if (o.ok) navigate('/plan');
                  })
                }
              >
                {TODAY_COPY.discardPlan}
              </Key>
            </div>
          </Faceplate>
        </div>
        <div className="lv-today__side">
          {day1?.prescription ? (
            <Faceplate title={TODAY_COPY.previewDay} caption={TODAY_COPY.futureDay}>
              <TodayDial rx={day1.prescription} nowH={null} size={200} centre={dialCentre(day1.prescription, null)} />
              <PrescriptionRows rows={todayRows(day1)} date={plan.startDate} readOnly quiet={day1.quietMode} />
            </Faceplate>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

/** Plan complete: keep the result (a maintenance scenario) or plan again. */
function CompleteState({ plan }: { plan: ActivePlan }) {
  const navigate = useNavigate();
  return (
    <Page className="lv-today">
      <Faceplate title={TODAY_COPY.complete(plan.name)} className="lv-complete">
        <p className="lv-plan__intent">Your logs, check-ins and versions stay in Progress.</p>
        <div className="lv-scheduled__keys">
          <Key onClick={() => toast('A maintenance plan from your result is coming in a later version.')}>{TODAY_COPY.keepResult}</Key>
          <Key onClick={() => navigate('/plan/goals')}>{TODAY_COPY.planAgain}</Key>
        </div>
      </Faceplate>
    </Page>
  );
}
