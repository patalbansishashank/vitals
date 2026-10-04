import '../boot';
import './train.css';
/**
 * Train (`/train`, `/train/:date`; design/screens/living-mode.md, Train): the day's sessions as concrete exercises on the
 * person's equipment, ten-second logging (tick = as planned, Session done = the rest as planned), swaps and "something
 * else" credited by the catalogue's equivalence (never refused), equipment and things to buy, and the week. The date
 * strip shares the selected date with Today and Food through the URL; `[` and `]` move one day.
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ExerciseRecord } from '@/catalogues';
import type { LocalDate } from '@/living';
import { addDays, compareDates, daysBetween, isLocalDate } from '@/living/dates';
import { TopBar } from '@/app/shell';
import { EmptyStage, Faceplate, Key, KeyBank, MQ, Page, formatNumber, toast, useMediaQuery } from '@/components';
import { DateStrip } from '../components/DateStrip';
import { useToday } from '../clock';
import { useLivingActions } from '../data/actions';
import { useLiving } from '../data/source';
import { fmtDay, fmtDayMonth, weekOf } from '../format';
import { livingPaths } from '../paths';
import { TRAIN_COPY } from './copy';
import { useTrainingSetup } from './setup';
import {
  EMPTY_DRAFT,
  capFirst,
  catalogueWith,
  dayWord,
  concreteOf,
  injuryNote,
  loggedStatus,
  parseSwapParam,
  savedLines,
  sessionModels,
  swapParam,
  targetOf,
  weekPrescriptions,
  weekRows,
  type SavedResult,
  type SessionDraft,
  type SessionModel,
  type SwapPick,
  type TrainSetup,
} from './session';
import { ElsePanel, type ElseSaveInput } from './components/ElsePanel';
import { EquipmentFace } from './components/EquipmentFace';
import { SessionFace, type SessionSaveInput } from './components/SessionFace';
import { SwapPanel } from './components/SwapPanel';
import { WeekView } from './components/WeekView';
import { storeSwaps, storedSwaps } from './swapStore';

type ViewMode = 'today' | 'week';

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: 'today', label: TRAIN_COPY.views.today },
  { value: 'week', label: TRAIN_COPY.views.week },
];

/** A bad date in the address goes to the page for today, as Today does (`/train/xx` → `/train`). */
export default function TrainPage() {
  const { date } = useParams();
  if (date !== undefined && !isLocalDate(date)) return <Navigate to={livingPaths.train()} replace />;
  return <TrainScreen />;
}

function TrainScreen() {
  const { date: param } = useParams();
  const today = useToday();
  const date: LocalDate = param && isLocalDate(param) ? param : today;
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const actions = useLivingActions();
  const lg = useMediaQuery(MQ.lg);
  const { profile, ctx, catalogue: personal } = useTrainingSetup();

  const [mode, setMode] = useState<ViewMode>('today');
  const [showNumbers, setShowNumbers] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<string, SessionDraft>>>({});
  const [saved, setSaved] = useState<Readonly<Record<string, SavedResult>>>({});
  const [records, setRecords] = useState<readonly ExerciseRecord[]>([]);
  const [elseFor, setElseFor] = useState<{ date: LocalDate; slotKey: string; index: number | null } | null>(null);
  // The week the strip shows: the selected date's, unless ‹ › moved it (reset whenever the date changes).
  const [strip, setStrip] = useState<{ date: LocalDate; monday: LocalDate } | null>(null);

  // Composition and the shopping list use the person's catalogue (their own equipment and exercises included); things
  // typed in this session only count for logging.
  const baseSetup: TrainSetup = useMemo(() => ({ profile, ctx, catalogue: personal }), [profile, ctx, personal]);
  const catalogue = useMemo(() => catalogueWith(records, personal), [records, personal]);
  const setup: TrainSetup = useMemo(() => ({ profile, ctx, catalogue }), [profile, ctx, catalogue]);

  const view = useLiving((s) => s.today(date), [date]);
  const week = useMemo(() => weekOf(date), [date]);
  const monday = strip && strip.date === date ? strip.monday : week[0]!;
  const shown = useMemo(() => weekOf(monday), [monday]);
  const glances = useLiving((s) => s.days(shown), [shown]);
  const shownViews = useLiving((s) => shown.map((d) => s.today(d)), [shown]);
  const weekViews = useLiving((s) => week.map((d) => s.today(d)), [week]);
  const rx = view?.prescription ?? null;
  const models = useMemo(() => sessionModels(rx, date, baseSetup), [rx, date, baseSetup]);
  const rows = useMemo(() => weekRows(shown, shownViews, today, baseSetup), [shown, shownViews, today, baseSetup]);
  const prescriptions = useMemo(() => weekPrescriptions(week, weekViews), [week, weekViews]);
  const weekTitle = shown.includes(today) ? TRAIN_COPY.week.title : TRAIN_COPY.week.titleOf(fmtDayMonth(monday));

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
  const quiet = !!view?.quietMode && !showNumbers;

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
  const elseModel = elseFor && elseFor.date === date ? models.find((m) => m.slotKey === elseFor.slotKey) : undefined;

  /** Log a session; the verdict shows under it and a toast offers Undo. */
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
    const target = targetOf(date, today, m.noun);
    const message = input.status === 'skipped' ? TRAIN_COPY.toast.skipped(m.noun) : savedLines(result, target).line;
    const undo = out.undo;
    toast(
      message,
      undo
        ? {
            action: {
              label: TRAIN_COPY.toast.undo,
              onClick: () => {
                void undo().then(() =>
                  setSaved((s) => {
                    const n = { ...s };
                    delete n[k];
                    return n;
                  }),
                );
              },
            },
          }
        : {},
    );
    return null;
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

  const saveElse = async (m: SessionModel, index: number | null, input: ElseSaveInput): Promise<string | null> => {
    // TODO(E8/E4): persist new records through `catalogue.addExercise`; until then they live for this session.
    if (input.isNew) addRecord(input.record);
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
  const injury = injuryNote(profile);

  const main = !view ? (
    <EmptyStage title={TRAIN_COPY.noPlan} />
  ) : !rx ? (
    <Faceplate title={TRAIN_COPY.outsidePlan} id="session" />
  ) : models.length === 0 ? (
    <Faceplate title={TRAIN_COPY.restTitle(capFirst(dayWord(date, today)))} id="session">
      <p className="lv-train-rest">{TRAIN_COPY.restDay(rx.steps !== undefined ? formatNumber(rx.steps, 0) : null)}</p>
    </Faceplate>
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
        readOnly={future}
        energy={!quiet}
        numbers={!quiet}
        primary={primarySlot === m.slotKey}
        onSave={(input) => saveSession(m, input)}
        onSwap={(i) => openSwap(m, i)}
        onElse={() => setElseFor({ date, slotKey: m.slotKey, index: null })}
        onSwapUndone={(i) => recordSwap(m, i, null)}
        onPropose={(i) => void propose(m, i)}
      />
    ))
  );

  return (
    <>
      <TopBar
        title={TRAIN_COPY.titleWithDate(fmtDay(date))}
        documentTitle={TRAIN_COPY.title}
        tabs={<KeyBank size="sm" label={TRAIN_COPY.viewLabel} options={VIEW_OPTIONS} value={mode} onChange={setMode} />}
      />
      <Page className="lv-train">
        <div className="lv-train-strip">
          <DateStrip
            days={glances}
            selected={date}
            today={today}
            onSelect={go}
            onWeek={(d) => setStrip({ date, monday: addDays(monday, 7 * d) })}
            quiet={!!view?.quietMode}
            label={TRAIN_COPY.dateStrip}
          />
        </div>
        {future || compareDates(date, today) < 0 || rx?.paused || view?.quietMode ? (
          <div className="lv-train-notes">
            {future ? <p className="lv-train-note">{TRAIN_COPY.preview}</p> : null}
            {!future && compareDates(date, today) < 0 && rx ? <p className="lv-train-note">{TRAIN_COPY.past(fmtDay(date))}</p> : null}
            {rx?.paused ? <p className="lv-train-note">{TRAIN_COPY.paused}</p> : null}
            {view?.quietMode ? (
              <Key size="sm" variant="quiet" pressed={showNumbers} onClick={() => setShowNumbers((v) => !v)}>
                {showNumbers ? TRAIN_COPY.hideNumbers : TRAIN_COPY.showNumbers}
              </Key>
            ) : null}
          </div>
        ) : null}
        {mode === 'week' ? (
          <WeekView
            title={weekTitle}
            rows={rows}
            selected={date}
            today={today}
            onPick={(d) => {
              setMode('today');
              go(d);
            }}
          />
        ) : (
          <div className="lv-train-grid">
            <div className="lv-train-main">
              {main}
              {injury && rx ? <p className="lv-train-footnote">{injury}</p> : null}
            </div>
            <div className="lv-train-aside">
              <EquipmentFace setup={baseSetup} prescriptions={prescriptions} />
              {lg ? <WeekView title={weekTitle} rows={rows} selected={date} today={today} onPick={go} /> : null}
            </div>
          </div>
        )}
      </Page>
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
          onSave={(input) => saveElse(elseModel, elseFor.index, input)}
        />
      ) : null}
    </>
  );
}
