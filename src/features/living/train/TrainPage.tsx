import '../boot';
import './train.css';
/**
 * Train (`/train`, `/train/:date`; design/screens/living-mode.md, Train): the day's sessions as concrete exercises on the
 * person's equipment, ten-second logging (tick = as planned, Session done = the rest as planned), swaps and "something
 * else" credited by the catalogue's equivalence (never refused). The date control (one day; its calendar picks another,
 * r069 U2) shares the selected date with Today and Food through the URL; `[` and `]` move one day. The week list sits beside the
 * day on desktop and opens from the header ⋯ on phones ("This week"); equipment and things to buy open from the ⋯ too
 * ("Equipment"), so the page is the day's training only. Header: "Train", the date, a pause icon on paused days (it opens Plan details).
 *
 * One ⋯ per screen: the header's. Its page items start with the open sessions' own actions (Swap for a one-exercise
 * session · I did something else · Skipped the <session>; grouped under each session's name when the day has more than
 * one), then This week · Equipment. An exercise of several opens its swap sheet from its name; skip is in that sheet.
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { CirclePause } from 'lucide-react';
import type { Catalogue, ExerciseRecord, StimulusContext, TrainingProfile } from '@/catalogues';
import type { LocalDate } from '@/living';
import { appClockH } from '@/living/todayReplay';
import { addDays, compareDates, daysBetween, isLocalDate } from '@/living/dates';
import { StatusCapsule, TopBar, type MenuEntry } from '@/app/shell';
import { EmptyStage, Faceplate, MQ, Page, ResponsivePanel, formatNumber, toast, useMediaQuery } from '@/components';
import { DateControl } from '../components/DateControl';
import { useLoggedDays } from '../components/dateMarks';
import { dayPeriod } from '../period';
import { EquivalenceQuietProvider } from '../components/EquivalenceMeter';
import { ConflictNotice } from '../components/LogConflict';
import { useLivingClock, useToday } from '../clock';
import { useLivingActions } from '../data/actions';
import { useLiving } from '../data/source';
import { dayOfMonth, fmtDayMonth, fmtMonth, fmtWeekday, weekOf } from '../format';
import { livingPaths } from '../paths';
import { TRAIN_COPY } from './copy';
import { useTrainingSetup } from './setup';
import { useQuietMode } from '@/state/settingsStore';
import { ActivityHub } from './components/ActivityHub';
import {
  EMPTY_DRAFT,
  capFirst,
  catalogueWith,
  concreteOf,
  effectiveItem,
  itemState,
  loggedStatus,
  parseSwapParam,
  sessionModels,
  sessionOpen,
  sessionTiming,
  swapParam,
  toggleSkip,
  weekPrescriptions,
  weekRows,
  type SavedResult,
  type SessionDraft,
  type SessionModel,
  type SwapPick,
  type TrainSetup,
} from './session';
import { ElsePanel, type ElseSaveInput } from './components/ElsePanel';
import { EquipmentPanel } from './components/EquipmentPanel';
import { RestFace, SessionFace, type SessionSaveInput } from './components/SessionFace';
import { SwapPanel } from './components/SwapPanel';
import { WeekList, WeekView } from './components/WeekView';
import { storeSwaps, storedSwaps } from './swapStore';
import { useLogManualActivity } from './v3Adapter';

/** "Wednesday, 30 September": the header's one fact line. */
function longDay(date: LocalDate): string {
  return `${fmtWeekday(date)}, ${dayOfMonth(date)} ${fmtMonth(date)}`;
}

/** The app clock hour of now: 24 h and more between midnight and the rollover, as the app's own clock helpers read it. */
const nowHour = (clock: { now(): Date; tz: string; rolloverH: number }): number => appClockH(clock.now().getTime(), clock.tz, clock.rolloverH).clockH;

/** A bad date in the address goes to the page for today, as Today does (`/train/xx` → `/train`). */
export default function TrainPage() {
  const { date } = useParams();
  if (date !== undefined && !isLocalDate(date)) return <Navigate to={livingPaths.train()} replace />;
  return <TrainScreen />;
}

/**
 * (0.6.3 A33) Train composes and estimates only over the person's own setup: while it loads, or when it cannot be read,
 * the page says so (never the fixture body).
 */
function TrainScreen() {
  const setupView = useTrainingSetup();
  const today = useToday();
  const { date: param } = useParams();
  const date: LocalDate = param && isLocalDate(param) ? param : today;
  if (setupView.status !== 'ready')
    return (
      <>
        <TopBar title={TRAIN_COPY.title} subtitle={longDay(date)} />
        <Page className="lv-train">
          <EmptyStage title={setupView.status === 'error' ? TRAIN_COPY.setupError : TRAIN_COPY.setupLoading} />
        </Page>
      </>
    );
  return <TrainDay profile={setupView.profile} ctx={setupView.ctx} personal={setupView.catalogue} typicalBody={setupView.typicalBody} />;
}

function TrainDay({ profile, ctx, personal, typicalBody }: { profile: TrainingProfile; ctx: StimulusContext; personal: Catalogue; typicalBody: boolean }) {
  const { date: param } = useParams();
  const today = useToday();
  const date: LocalDate = param && isLocalDate(param) ? param : today;
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const actions = useLivingActions();
  const logManual = useLogManualActivity();
  const clock = useLivingClock();
  const lg = useMediaQuery(MQ.lg);

  const [sheet, setSheet] = useState<'week' | 'equipment' | null>(null);
  const [showNumbers, setShowNumbers] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<string, SessionDraft>>>({});
  const [saved, setSaved] = useState<Readonly<Record<string, SavedResult>>>({});
  /** Undo for a session logged or skipped on this visit, shown in the card's status row (r068 L7). */
  const [undos, setUndos] = useState<Readonly<Record<string, () => void>>>({});
  const [records, setRecords] = useState<readonly ExerciseRecord[]>([]);
  // slotKey null: "Log an activity" (an activity outside the plan, §V4.4)
  // (0.6.3 INT) `?log=1` (Today without a plan: "Log an activity") opens the log sheet on arrival (a day that has started)
  const [elseFor, setElseFor] = useState<{ date: LocalDate; slotKey: string | null; index: number | null } | null>(() =>
    search.get('log') === '1' && compareDates(date, today) <= 0 ? { date, slotKey: null, index: null } : null,
  );

  // Composition and the shopping list use the person's catalogue (their own equipment and exercises included); things
  // typed in this session only count for logging.
  // (0.6.3 INT, S2) a typical placeholder body may compose, never price: `typicalBody` hides every energy figure from it
  const baseSetup: TrainSetup = useMemo(() => ({ profile, ctx, catalogue: personal, typicalBody }), [profile, ctx, personal, typicalBody]);
  const catalogue = useMemo(() => catalogueWith(records, personal), [records, personal]);
  const setup: TrainSetup = useMemo(() => ({ profile, ctx, catalogue, typicalBody }), [profile, ctx, catalogue, typicalBody]);

  const view = useLiving((s) => s.today(date), [date]);
  const dayConflicts = useLiving((s) => s.history(date, date)[0]?.conflicts ?? [], [date]);
  const workoutConflicts = useMemo(() => dayConflicts.filter((conflict) => conflict.kind === 'workout'), [dayConflicts]);
  const week = useMemo(() => weekOf(date), [date]);
  const monday = week[0]!;
  const weekViews = useLiving((s) => week.map((d) => s.today(d)), [week]);
  const rx = view?.prescription ?? null;
  const models = useMemo(() => sessionModels(rx, date, baseSetup), [rx, date, baseSetup]);
  const rows = useMemo(() => weekRows(week, weekViews, today, baseSetup), [week, weekViews, today, baseSetup]);
  const prescriptions = useMemo(() => weekPrescriptions(week, weekViews), [week, weekViews]);
  const weekTitle = week.includes(today) ? TRAIN_COPY.week.title : TRAIN_COPY.week.titleOf(fmtDayMonth(monday));

  const go = (d: LocalDate) => navigate(livingPaths.train(d));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.key !== '[' && e.key !== ']')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      navigate(livingPaths.train(addDays(date, e.key === '[' ? -1 : 1)));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [date, navigate]);

  const keyOf = (m: Pick<SessionModel, 'slotKey'>) => `${date}|${m.slotKey}`;
  // A swap holds for the day: drafts start from the swaps kept on this device, so a reload still shows them (LIV-11).
  const planId = view?.plan?.id;
  const baseDraft = (k: string): SessionDraft => {
    const swaps = storedSwaps(k, planId);
    return swaps ? { ...EMPTY_DRAFT, swaps } : EMPTY_DRAFT;
  };
  const draftOf = (m: SessionModel) => drafts[keyOf(m)] ?? baseDraft(keyOf(m));
  const updateDraft = (m: SessionModel, update: (d: SessionDraft) => SessionDraft) => {
    const k = keyOf(m);
    setDrafts((all) => {
      const prev = all[k] ?? baseDraft(k);
      const next = update(prev);
      if (next.swaps !== prev.swaps) storeSwaps(k, planId, date, next.swaps, today);
      return { ...all, [k]: next };
    });
  };
  const addRecord = (r: ExerciseRecord) => setRecords((rs) => [...rs.filter((x) => x.id !== r.id), r]);

  const future = compareDates(date, today) > 0;
  // (0.6.3 INT) quiet mode holds without a plan too (the hub has no day model to carry it): the setting in effect, or the model's
  const quietSetting = useQuietMode().on;
  const quietOn = !!view?.quietMode || quietSetting;
  const quiet = quietOn && !showNumbers;

  const swapAt = parseSwapParam(search.get('swap'));
  const swapModel = swapAt ? models.find((m) => m.slotKey === swapAt.slotKey) : undefined;
  const openSwap = (m: SessionModel, index: number) =>
    setSearch((prev) => {
      const n = new URLSearchParams(prev);
      n.set('swap', swapParam(m.slotKey, index));
      return n;
    });
  const closeSwap = () =>
    setSearch((prev) => {
      const n = new URLSearchParams(prev);
      n.delete('swap');
      return n;
    });
  // an exercise of several is skipped from its swap sheet while the session is open and the exercise is not skipped yet
  const swapDraft = swapModel ? draftOf(swapModel) : null;
  const swapSkip =
    swapAt && swapModel && swapDraft && swapModel.session.items.length > 1 && swapModel.session.items[swapAt.index] && sessionOpen(view, swapModel, swapDraft) && itemState(swapDraft, swapAt.index, effectiveItem(swapModel, swapDraft, swapAt.index, setup)) !== 'skipped'
      ? () => {
          updateDraft(swapModel, (d) => toggleSkip(d, swapAt.index));
          closeSwap();
        }
      : undefined;
  const elseModel = elseFor && elseFor.date === date && elseFor.slotKey !== null ? models.find((m) => m.slotKey === elseFor.slotKey) : undefined;
  const logOpen = !!elseFor && elseFor.date === date && elseFor.slotKey === null && !future;
  const openLog = () => setElseFor({ date, slotKey: null, index: null });
  // the `?log=1` that opened the log sheet leaves the address (a reload or Back never reopens it)
  const logParam = search.get('log') === '1';
  // (0.6.6) also when Train is already open (the home-screen widget's Log key): a `?log=1` that arrives later opens it too
  const [seenLog, setSeenLog] = useState(logParam);
  if (logParam !== seenLog) {
    setSeenLog(logParam);
    if (logParam && compareDates(date, today) <= 0) setElseFor({ date, slotKey: null, index: null });
  }
  useEffect(() => {
    if (!logParam) return;
    setSearch(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('log');
        return n;
      },
      { replace: true },
    );
  }, [logParam, setSearch]);

  /** Log a session; the verdict shows under it with Undo beside it. */
  const saveSession = async (m: SessionModel, input: SessionSaveInput): Promise<string | null> => {
    const k = keyOf(m);
    const out = await actions.logSession(date, {
      slotKey: m.slotKey,
      status: input.status,
      performed: input.performed,
      credit: input.status === 'skipped' || !input.result ? 0 : input.result.credit,
      ...(input.startH !== undefined ? { startH: input.startH } : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
    });
    if (!out.ok) return out.message ?? TRAIN_COPY.cantSave;
    const result: SavedResult = { status: input.status, result: input.status === 'skipped' ? null : input.result };
    setSaved((s) => ({ ...s, [k]: result }));
    // the swaps stay: the logged session lists what was done (the swapped exercise), not the plan's
    setDrafts((all) => {
      const d = all[k] ?? baseDraft(k);
      return { ...all, [k]: { ...EMPTY_DRAFT, style: d.style, swaps: d.swaps } };
    });
    // the card states the verdict and carries Undo in its status row (r068 L7): no toast repeating the card over it
    const undo = out.undo;
    if (undo) {
      setUndos((u) => ({
        ...u,
        [k]: () => {
          void undo().then(() => {
            setSaved((s) => {
              const n = { ...s };
              delete n[k];
              return n;
            });
            setUndos((all) => {
              const n = { ...all };
              delete n[k];
              return n;
            });
          });
        },
      }));
    }
    return null;
  };

  /** "Skipped the <session>" from the header ⋯: no credit; on failure the reason shows as a toast. */
  const skipSession = async (m: SessionModel) => {
    const msg = await saveSession(m, { status: 'skipped', performed: [], result: null, ...sessionTiming(m, draftOf(m).startedAt, clock.now().getTime()) });
    if (msg) toast(msg);
  };

  /** A day's swap is kept on the day's record too (synced; logging credits it); the local store shows it at once. */
  const recordSwap = (m: SessionModel, index: number, to: SwapPick['perf'] | null) => {
    const item = m.session.items[index];
    if (!item || compareDates(date, today) < 0) return;
    // undone: the prescribed exercise again
    void actions.swapExercise(date, { slotKey: m.slotKey, from: item.exerciseId, to: to ?? item.perf });
  };

  const pickSwap = (m: SessionModel, index: number, pick: SwapPick) => {
    recordSwap(m, index, pick.perf);
    updateDraft(m, (d) => {
      const drop = <T,>(o: Readonly<Record<number, T>>) => {
        const n = { ...o };
        delete n[index];
        return n;
      };
      return { ...d, swaps: { ...d.swaps, [index]: pick }, logs: drop(d.logs), ticks: drop(d.ticks), skips: drop(d.skips) };
    });
  };

  /**
   * "Log an activity": one `activity.logManual` change (an overlap with a recording is resolved in the sheet first, 0.6.3
   * A5); a toast offers Undo of the whole change (S30).
   */
  const saveLog = async (input: ElseSaveInput): Promise<string | null> => {
    if (!input.manual) return TRAIN_COPY.cantSave;
    const out = await logManual(input.manual);
    // (A5) a recording overlapping it arrived meanwhile: the sheet shows the choice (its check runs again)
    if (!out.ok) return out.message ?? TRAIN_COPY.cantSave;
    setElseFor(null);
    const undo = out.undo;
    // (r063 FX3 aR16) the saved facts (a link keeps the recording's own minutes, not the typed ones); quiet: no minutes
    const minutes = out.saved?.durationMin ?? input.manual.durationMin;
    toast(quiet ? TRAIN_COPY.else.loggedQuiet(input.record.name) : TRAIN_COPY.else.logged(input.record.name, formatNumber(minutes, 0)), undo ? { action: { label: TRAIN_COPY.toast.undo, onClick: () => void undo() } } : {});
    return null;
  };

  const saveElse = async (m: SessionModel, index: number | null, input: ElseSaveInput): Promise<string | null> => {
    // TODO(E8/E4): persist new records through `catalogue.addExercise`; until then they live for this session.
    if (input.isNew) addRecord(input.record);
    if (!input.result) return TRAIN_COPY.cantSave;
    if (index !== null) {
      pickSwap(m, index, { exerciseId: input.record.id, name: input.record.name, equipment: [], perf: input.perf, equivalence: input.result });
      setElseFor(null);
      return null;
    }
    const minutes = Math.max(1, Math.round(concreteOf(input.record, input.perf, [], setup.ctx).minutes));
    const msg = await saveSession(m, { status: input.result.parity ? 'done' : 'partial', performed: [input.perf], result: input.result, durationMin: minutes, startH: m.startH });
    if (!msg) setElseFor(null);
    return msg;
  };

  /** "Use this swap on every <weekday>": a proposal card on Today; nothing changes until the person applies it. */
  const propose = async (m: SessionModel, index: number) => {
    const pick = draftOf(m).swaps[index];
    const from = m.session.items[index]?.exerciseId;
    if (!pick || !from) return;
    // from a past day, the proposal starts on the next same weekday
    const lag = Math.max(0, daysBetween(date, today));
    const on = lag > 0 ? addDays(date, 7 * Math.ceil(lag / 7)) : date;
    const out = await actions.swapExercise(on, { slotKey: m.slotKey, from, to: pick.perf, everyWeek: true });
    if (!out.ok) {
      toast(out.message ?? TRAIN_COPY.cantSave);
      return;
    }
    toast(TRAIN_COPY.toast.proposal(Math.round((out.credit ?? pick.equivalence.credit) * 100)));
  };

  const primarySlot = future ? null : (models.find((m) => loggedStatus(view, m.itemId).status === 'unknown' || draftOf(m).editing)?.slotKey ?? null);

  // the open sessions' own actions lead the header's one ⋯ (a day with more than one groups them under each name)
  const sessionItems: MenuEntry[] = future
    ? []
    : models
        .filter((m) => sessionOpen(view, m, draftOf(m)))
        .flatMap((m): MenuEntry[] => [
          ...(models.length > 1 ? [{ kind: 'section' as const, id: `${m.slotKey}:session`, label: capFirst(m.what) }] : []),
          ...(m.session.items.length === 1 ? [{ id: `${m.slotKey}:swap`, label: TRAIN_COPY.swapItem, onSelect: () => openSwap(m, 0) }] : []),
          { id: `${m.slotKey}:else`, label: TRAIN_COPY.somethingElse, onSelect: () => setElseFor({ date, slotKey: m.slotKey, index: null }) },
          { id: `${m.slotKey}:skipped`, label: TRAIN_COPY.skippedItem(m.what), onSelect: () => void skipSession(m) },
        ]);
  // "Log an activity" on any day that has started (an activity outside the plan, §V4.4)
  // (0.6.3 S24/A7) with or without a plan
  const logItems: MenuEntry[] = future ? [] : [...(models.length > 1 ? [{ kind: 'divider' as const, id: 'train-log' }] : []), { id: 'log-activity', label: TRAIN_COPY.logActivity, onSelect: openLog }];
  // the page's own items in the header's one ⋯ (the global items follow after a divider)
  const menu: MenuEntry[] = [
    ...sessionItems,
    ...logItems,
    ...(sessionItems.length + logItems.length > 0 ? [{ kind: 'divider' as const, id: 'train-sessions' }] : []),
    ...(quietOn ? [{ id: 'numbers', label: showNumbers ? TRAIN_COPY.hideNumbers : TRAIN_COPY.showNumbers, onSelect: () => setShowNumbers((v) => !v) }] : []),
    ...(lg ? [] : [{ id: 'week', label: TRAIN_COPY.week.open, onSelect: () => setSheet('week') }]),
    { id: 'equipment', label: TRAIN_COPY.equipment.title, onSelect: () => setSheet('equipment') },
  ];

  // the week card beside the day: desktop, with a plan (without one every row would say "outside the plan")
  const weekCard = !!view;

  const main = !view ? (
    // (0.6.3 S24/A7) no plan: the activity hub (log, record, review); a plan stays optional
    <ActivityHub id="session" date={date} today={today} quiet={quiet} {...(future ? {} : { onLog: openLog })} />
  ) : !rx ? (
    <Faceplate title={TRAIN_COPY.outsidePlan} id="session" />
  ) : models.length === 0 ? (
    <RestFace id="session" steps={rx.steps} stepsSoFar={view.logged.steps} future={future} quiet={quiet} isToday={date === today} onLog={future ? undefined : openLog} />
  ) : (
    models.map((m, k) => (
      <SessionFace
        key={keyOf(m)}
        id={k === 0 ? 'session' : undefined}
        model={m}
        date={date}
        today={today}
        view={view}
        setup={setup}
        draft={draftOf(m)}
        onDraft={(u) => updateDraft(m, u)}
        saved={saved[keyOf(m)] ?? null}
        onUndo={undos[keyOf(m)]}
        readOnly={future}
        energy={!quiet && !typicalBody}
        numbers={!quiet}
        primary={primarySlot === m.slotKey}
        onSave={(input) => saveSession(m, input)}
        onSwap={(i) => openSwap(m, i)}
        onSwapUndone={(i) => recordSwap(m, i, null)}
        onPropose={(i) => void propose(m, i)}
      />
    ))
  );

  return (
    <EquivalenceQuietProvider quiet={quiet}>
      <TopBar
        title={view ? TRAIN_COPY.title : TRAIN_COPY.hub.title}
        subtitle={longDay(date)}
        status={rx?.paused ? <StatusCapsule icon={CirclePause} label={TRAIN_COPY.paused} to={livingPaths.planActive} /> : undefined}
        menu={menu}
      />
      <ConflictNotice id={`train-conflict-${date}`} conflicts={workoutConflicts} quiet={quiet} />
      <Page className="lv-train">
        {/* (r069 U2) the date control on every width; on desktop the week card beside the day lists what each day of
            the selected day's week holds (a row opens that day). Without a plan the days hold nothing to pick between:
            the hub lists the recent activities instead (r068 L17) */}
        {view ? <DateControl value={dayPeriod(date)} today={today} onChange={(p) => go(p.from)} useMarks={useLoggedDays} /> : null}
        <div className="lv-train-cq">
          <div className="lv-train-grid">
            <div className="lv-train-main">{main}</div>
            {weekCard ? (
              <div className="lv-train-aside">
                <WeekView title={weekTitle} rows={rows} selected={date} today={today} onPick={go} slim={!lg} quiet={quiet} onOpen={() => setSheet('week')} />
              </div>
            ) : null}
          </div>
        </div>
      </Page>
      {sheet === 'week' && !lg ? (
        <ResponsivePanel open onClose={() => setSheet(null)} title={weekTitle}>
          <div className="lv-train-panel">
            <WeekList
              title={weekTitle}
              rows={rows}
              selected={date}
              today={today}
              onPick={(d) => {
                setSheet(null);
                go(d);
              }}
            />
          </div>
        </ResponsivePanel>
      ) : null}
      {sheet === 'equipment' ? <EquipmentPanel setup={baseSetup} prescriptions={prescriptions} onClose={() => setSheet(null)} /> : null}
      {swapAt && swapModel && !future ? (
        <SwapPanel
          key={search.get('swap')}
          model={swapModel}
          index={swapAt.index}
          date={date}
          today={today}
          setup={setup}
          onClose={closeSwap}
          onPick={(pick) => {
            pickSwap(swapModel, swapAt.index, pick);
            closeSwap();
          }}
          onSomethingElse={() => {
            setElseFor({ date, slotKey: swapModel.slotKey, index: swapAt.index });
            closeSwap();
          }}
          onSkip={swapSkip}
        />
      ) : null}
      {elseFor && elseModel ? (
        <ElsePanel
          key={`${elseFor.slotKey}:${elseFor.index ?? 'all'}`}
          model={elseModel}
          index={elseFor.index}
          date={date}
          today={today}
          setup={setup}
          onClose={() => setElseFor(null)}
          quiet={quiet}
          onSave={(input) => saveElse(elseModel, elseFor.index, input)}
        />
      ) : null}
      {logOpen ? (
        <ElsePanel key="log" model={null} index={null} date={date} today={today} setup={setup} quiet={quiet} nowH={nowHour(clock)} rolloverH={clock.rolloverH} onClose={() => setElseFor(null)} onSave={saveLog} />
      ) : null}
    </EquivalenceQuietProvider>
  );
}
