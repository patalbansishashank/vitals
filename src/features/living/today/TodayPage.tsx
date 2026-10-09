import '../boot';
import './today.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Dialog, Engraved, Faceplate, Key, KeyBank, Notice, Page, energyInText, toast, useMediaQuery, MQ } from '@/components';
import { TopBar, setNavBadge } from '@/app/shell';
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
import { SignalsStrip } from '../components/ScoreTile';
import { useScores } from '../data/scores';
import { fmtClock, fmtDay, grams, kcal, weekOf, weekdaysText } from '../format';
import { useEnergyUnit } from '@/state/settingsStore';
import { livingPaths } from '../paths';
import { useFoodProfile } from '../food/profile';
import { intentionsLine, todayRows, todayState, type TodayRow } from './model';
import { CheckInSheet } from './components/CheckInSheet';
import { ForecastFace, SoFarFace } from './components/Faces';
import { NoticesZone } from './components/NoticesZone';
import { PrescriptionRows, weighFieldId } from './components/PrescriptionRows';
import { TodayMenu } from './components/TodayMenu';
import { WeighSheet } from './components/WeighSheet';

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
  const [checkIn, setCheckIn] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const state = todayState(view, plan, date, today);
  const quiet = !!view?.quietMode && !showNumbers;
  const readOnly = state === 'future' || state === 'scheduled';
  const pending = changes.some((c) => c.class === 'edit' && c.state === 'pending');
  const eu = useEnergyUnit();
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
          el.click();
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
  const inPlan = day >= 1 && day <= of;
  // the plan's own state beside the date: it used to sit under the logo in the rail ("starts tomorrow", "paused")
  const planState =
    plan.status === 'paused' ? 'paused' : plan.startDate > today ? (plan.startDate === addDays(today, 1) ? 'starts tomorrow' : `starts ${fmtDay(plan.startDate)}`) : null;
  const context = [fmtDay(date), planState ?? (inPlan ? `day ${day} of ${of}` : null)].filter(Boolean).join(' · ');
  const rung = plan.rung === 'custom' ? 'your plan' : plan.rung;

  const title = date === today ? TODAY_COPY.title : fmtDay(date);
  const top = (
    <TopBar
      title={title}
      documentTitle={TODAY_COPY.title}
      params={
        <Engraved role="status">
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
      className="lv-plan lv-plan--fill"
      caption={state === 'past' ? TODAY_COPY.pastDay : state === 'future' ? TODAY_COPY.futureDay : undefined}
      actions={
        !readOnly && markItem ? (
          <Key
            size="sm"
            variant="quiet"
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
        <div className="lv-plan__rows">
          <PrescriptionRows rows={view?.minimalMode ? rows.filter((r) => r.glyph === 'weigh') : rows} date={date} readOnly={readOnly} quiet={quiet} highlight={highlight} {...(state === 'future' ? { closedReason: `Opens on ${fmtDay(date)}` } : {})} nowH={state === 'active' ? nowH : null} />
        </div>
      ) : (
        <p className="lv-plan__empty">Nothing is prescribed for this day.</p>
      )}
    </Faceplate>
  );

  // the end-of-day question has its own card, right under the plan (it balances the two columns on desktop)
  const hardFace = rx && showHowHard && !readOnly ? <HowHardFace key={date} date={date} /> : null;

  const next = nextUp(rows, nowH);
  const facts: Array<[string, string]> = rx
    ? [
        ...(inPlan ? ([['plan day', `${day} of ${of}`]] as Array<[string, string]>) : []),
        ...(rx.window ? ([['eating window', `${fmtClock(rx.window.startH)}–${fmtClock(rx.window.endH)}`]] as Array<[string, string]>) : []),
        ...(quiet ? [] : ([['eat', energyInText(`${kcal(rx.energyKcal)} kcal`, eu)]] as Array<[string, string]>)),
        ['protein', `${grams(rx.macros.proteinG)} g`],
      ]
    : [];
  // what to do now, and the day's few numbers: replaces the 24 h dial card ("Your day")
  const nowFace = rx ? (
    <Faceplate title={readOnly ? TODAY_COPY.planFace : next ? 'Next up' : 'All done for today'} aria-label="Next up" className="lv-now">
      {next && !readOnly ? (
        <div className="lv-now__next">
          <span className="lv-now__time lm-num">{next.at !== null && !next.untimed ? fmtClock(next.at) : next.glyph === 'weigh' ? 'morning' : 'any time'}</span>
          <span className="lv-now__what">
            <span className="lv-now__label">{next.label}</span>
            {next.target ? <span className="lv-now__target">{quiet && next.quietTarget ? next.quietTarget : energyInText(next.target, eu)}</span> : null}
          </span>
        </div>
      ) : null}
      <dl className="lv-facts lv-now__facts">
        {facts.map(([k, v]) => (
          <div key={k} className="lv-facts__item">
            <dt className="lm-eng">{k}</dt>
            <dd className="lm-num">{v}</dd>
          </div>
        ))}
      </dl>
    </Faceplate>
  ) : null;

  return (
    <>
      {top}
      <Page className="lv-today lv-today--fill">
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
            {!lg ? nowFace : null}
            {dayConflicts.map((conflict) => <LogConflict key={conflict.parentId} conflict={conflict} quiet={quiet} />)}
            {planFace}
            {hardFace}
          </div>
          <div className="lv-today__side">
            {lg ? <NoticesZone notices={view?.notices ?? []} changes={changes} extra={extra} onCheckIn={() => setCheckIn(true)} /> : null}
            {lg ? nowFace : null}
            {view ? <SoFarFace view={view} quiet={quiet} size={lg ? 'md' : 'sm'} daysLogged7={daysLogged7} onArc={(id) => setHighlight(id)} /> : null}
            {view ? <ForecastFace view={view} trend={trend} quiet={!!view.quietMode} compact={!lg} /> : null}
            {view?.biometrics ? <TodaySignals /> : null}
          </div>
        </div>
      </Page>
      <CheckInSheet open={checkIn} onClose={() => setCheckIn(false)} today={today} quiet={!!view?.quietMode} />
    </>
  );
}

/** What to do next: the first open row from now on (the weigh-in counts as the morning's first), else the first open row. */
function nextUp(rows: readonly TodayRow[], nowH: number | null): TodayRow | null {
  const open = rows.filter((r) => r.status === 'empty' && !(r.glyph === 'weigh' && r.logged));
  if (nowH === null) return open[0] ?? null;
  return open.find((r) => !r.untimed && r.at !== null && r.at >= nowH - 0.5) ?? open.find((r) => r.glyph === 'weigh') ?? open[0] ?? null;
}



const HARD_WORD: Record<1 | 2 | 3 | 4 | 5, string> = { 1: 'easy', 2: 'fine', 3: 'OK', 4: 'hard', 5: 'very hard' };

/** "How hard was today?" as its own card: five keys, then a compact saved line with Undo and Change. */
function HowHardFace({ date }: { date: LocalDate }) {
  const actions = useLivingActions();
  const [saved, setSaved] = useState<{ v: 1 | 2 | 3 | 4 | 5; undo?: () => Promise<unknown> } | null>(null);
  const [changing, setChanging] = useState(false);
  const answer = (v: 1 | 2 | 3 | 4 | 5) =>
    void actions.logDifficulty(date, v).then((o) => {
      if (!o.ok) return void toast(o.message ?? 'That didn’t work. Try again.');
      setSaved({ v, ...(o.undo ? { undo: o.undo } : {}) });
      setChanging(false);
      toast('Thanks. It helps the plan learn what works for you.');
    });
  return (
    <Faceplate title={TODAY_COPY.howHardTitle} aria-label={TODAY_COPY.howHardTitle} className="lv-hard">
      {saved && !changing ? (
        <div className="lv-hard__saved">
          <span className="lv-hard__value">
            <span className="lv-hard__felt">Felt </span>
            <strong>{HARD_WORD[saved.v]}</strong>
            <span className="lv-rd__u lm-num"> · {saved.v} of 5</span>
          </span>
          <span className="lv-hard__keys">
            {saved.undo ? (
              <Key size="sm" variant="quiet" aria-label="Undo how hard today was" onClick={() => void saved.undo?.().then(() => setSaved(null))}>
                {TODAY_COPY.undo}
              </Key>
            ) : null}
            <Key size="sm" variant="quiet" onClick={() => setChanging(true)}>
              Change
            </Key>
          </span>
        </div>
      ) : (
        <KeyBank
          label={TODAY_COPY.howHard}
          block
          size="lg"
          className="lv-hard__bank"
          options={([1, 2, 3, 4, 5] as const).map((v) => ({
            value: String(v),
            label: (
              <span className="lv-hard__opt">
                <span className="lm-num">{v}</span>
                <span className="lv-hard__word">{HARD_WORD[v]}</span>
              </span>
            ),
          }))}
          {...(saved ? { defaultValue: String(saved.v) } : {})}
          onChange={(v) => answer(Number(v) as 1 | 2 | 3 | 4 | 5)}
        />
      )}
    </Faceplate>
  );
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

const clockText = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/**
 * Scheduled (start ahead): the plan card (what the plan is, its key numbers and the things to do before day 1, each
 * with its own key) beside a read-only preview of day 1's timeline whose keys open on the start day.
 */
function ScheduledState({ plan, today }: { plan: ActivePlan; today: LocalDate }) {
  const navigate = useNavigate();
  const actions = useLivingActions();
  const eu = useEnergyUnit();
  const [weighing, setWeighing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const day1 = useLiving((s) => s.today(plan.startDate), [plan.startDate]);
  const tomorrow = plan.startDate === addDays(today, 1);
  const when = tomorrow ? `tomorrow (${fmtDay(plan.startDate)})` : fmtDay(plan.startDate);
  const weighIn = clockText(plan.intentions.weighInClockH ?? 7);
  const rx = day1?.prescription ?? null;
  const days = daysBetween(plan.startDate, plan.plannedEndDate);
  const training = plan.intentions.trainingWeekdays?.length ? weekdaysText(plan.intentions.trainingWeekdays) : null;
  const numbers: Array<[string, string]> = [
    ['starts', fmtDay(plan.startDate)],
    ['length', `${days} days · ends ${fmtDay(plan.plannedEndDate)}`],
    ...(rx
      ? ([
          ['eat each day', energyInText(`${kcal(rx.energyKcal)} kcal`, eu)],
          ['protein', `${grams(rx.macros.proteinG)} g`],
          ['maintenance', energyInText(`${kcal(rx.maintenanceKcal)} kcal`, eu)],
          ['deficit', energyInText(`${kcal(Math.max(0, rx.maintenanceKcal - rx.energyKcal))} kcal a day`, eu)],
          ...(rx.window ? ([['eating window', `${fmtClock(rx.window.startH)}–${fmtClock(rx.window.endH)}`]] as Array<[string, string]>) : []),
        ] as Array<[string, string]>)
      : []),
    ...(training ? ([['training days', training]] as Array<[string, string]>) : []),
  ];
  const discard = () =>
    void actions.discard().then((o) => {
      setDiscarding(false);
      toast(o.ok ? `${plan.name} was discarded.` : (o.message ?? 'Couldn’t discard.'));
      if (o.ok) navigate('/plan');
    });
  return (
    <Page className="lv-today lv-today--fill">
      <div className="lv-today__grid lv-today__grid--scheduled">
        <div className="lv-today__main">
          {rx && day1 ? (
            <Faceplate title={TODAY_COPY.previewDay} caption={TODAY_COPY.futureDay} className="lv-plan lv-plan--fill">
              <div className="lv-plan__body">
                <div className="lv-plan__rows">
                  <PrescriptionRows rows={todayRows(day1)} date={plan.startDate} readOnly quiet={day1.quietMode} closedReason={`Opens on ${fmtDay(plan.startDate)}`} />
                </div>
              </div>
            </Faceplate>
          ) : null}
        </div>
        <div className="lv-today__side">
          <Faceplate title={TODAY_COPY.scheduled(plan.name, when)} className="lv-scheduled">
            <dl className="lv-facts">
              {numbers.map(([k, v]) => (
                <div key={k} className="lv-facts__item">
                  <dt className="lm-eng">{k}</dt>
                  <dd className="lm-num">{v}</dd>
                </div>
              ))}
            </dl>
          </Faceplate>
          <Faceplate title={TODAY_COPY.beforeDay1} className="lv-scheduled">
            <ul className="lv-todo">
              <li className="lv-todo__item">
                <span>
                  <strong>Groceries</strong>
                  <span className="lv-todo__note">The list for the first 3 days is ready.</span>
                </span>
                <Key size="sm" onClick={() => navigate(livingPaths.food(plan.startDate, 'groceries'))}>
                  Open list
                </Key>
              </li>
              <li className="lv-todo__item">
                <span>
                  <strong>First weigh-in</strong>
                  <span className="lv-todo__note">{tomorrow ? `Tomorrow at ${weighIn}` : `At ${weighIn} on ${fmtDay(plan.startDate)}`}, after the bathroom, before eating. A weight from today helps too.</span>
                </span>
                <Key size="sm" onClick={() => setWeighing(true)}>
                  Log weight
                </Key>
              </li>
              <li className="lv-todo__item">
                <span>
                  <strong>Start day</strong>
                  <span className="lv-todo__note">To start on another day, discard and start again from the Planner.</span>
                </span>
                <Key size="sm" disabledReason="To start on another day, discard the plan and start it again from the Planner.">
                  {TODAY_COPY.changeStart}
                </Key>
              </li>
              <li className="lv-todo__item">
                <span>
                  <strong>Not ready?</strong>
                  <span className="lv-todo__note">Discard the plan. Your logs stay.</span>
                </span>
                <Key size="sm" variant="quiet" onClick={() => setDiscarding(true)}>
                  {TODAY_COPY.discardPlan}…
                </Key>
              </li>
            </ul>
          </Faceplate>
        </div>
      </div>
      {weighing ? <WeighSheet open={weighing} date={today} onClose={() => setWeighing(false)} /> : null}
      <Dialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={`Discard ${plan.name}?`}
        role="alertdialog"
        footer={
          <>
            <Key onClick={() => setDiscarding(false)}>{TODAY_COPY.cancel}</Key>
            <Key variant="danger" onClick={discard}>
              {TODAY_COPY.discardPlan}
            </Key>
          </>
        }
      >
        <p>The plan stops before it starts. You can make a new one in the Planner.</p>
      </Dialog>
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
