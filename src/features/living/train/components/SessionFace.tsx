/**
 * The session card (living-mode.md Train, "Sessions and logging"). Header: "Lift · 33 min · home" (a one-exercise
 * session is named by its exercise), the energy as its one fact, and the optional timer. Then the log-by switch (only
 * when it changes the controls), the exercises, and at the foot the session's one done key — Session done (the rest as
 * planned; partial shows a summary first) — or, once logged, the verdict.
 *
 * One ⋯ per screen: the card has none. The session's own actions (I did something else · Skipped; Swap too when there
 * is one exercise) are the page's items in the header ⋯ (TrainPage); an exercise's swap and skip open from its name.
 * A one-exercise session has no per-row Done (the session's own key logs it).
 * D4-02: with an unresolved concerning exertional symptom (the living plan's 'symptomHold' notice for a logged one) or a
 * screening whose exercise gate holds (`no-exercise-prescription`, a Q13 answer still without context), the card says
 * "Exercise · Review" (progression waits for review; logging what was done stays available). The route to urgent care
 * lives in the symptom flow.
 * A1-005: when Today carries the authoritative current exercise eligibility (`TodayView.exerciseEligibility`, current
 * screening, symptom reports/resolutions, clinician envelopes with their dates, documented baseline), the card reads the
 * hold for its own scope from it — a covering current envelope restores exactly the scopes it permits, a revoked or
 * expired one holds them again — and the legacy screening/notice reading applies only when the field is absent.
 */
import { useEffect, useId, useState } from 'react';
import { Dumbbell, Moon, Timer, TimerOff } from 'lucide-react';
import type { EquivalenceResult, PerformedExercise } from '@/catalogues';
import { CURRENT_EXERCISE_ELIGIBILITY_VERSION, type ExerciseScope, type LocalDate, type TodayView } from '@/living';
import { CardHead, CardFoot, GradientCard, HeroNumber, MonoMeta, RadialTicks, IconKey, InlineWarning, Key, KeyBank, formatEnergy, formatEnergyRange, formatNumber } from '@/components';
import { useSafetyAccess } from '@/features/onboarding';
import { exerciseInReview } from '@/features/onboarding/SafetySummary';
import { useBodyContext } from '@/state/profileStore';
import { useEnergyUnit } from '@/state/settingsStore';
import { EquivalenceMeter, pctOf } from '../../components/EquivalenceMeter';
import { useLivingClock } from '../../clock';
import { fmtWeekday, quietWord } from '../../format';
import { TRAIN_COPY, INFO } from '../copy';
import { infoSpec } from '../../components/info';
import {
  displayNames,
  effectiveItem,
  equipmentUsed,
  fmtElapsed,
  itemState,
  loggedStatus,
  needsReview,
  placeOf,
  savedLines,
  sessionEnergy,
  sessionProgress,
  sessionLogPlan,
  sessionTiming,
  sharedTank,
  tankShared,
  targetOf,
  shortName,
  toggleSkip,
  type ItemLog,
  type LogStyle,
  type SavedResult,
  type SessionDraft,
  type SessionLogPlan,
  type SessionModel,
  type TrainSetup,
} from '../session';
import { ExerciseRow } from './ExerciseRow';
import { logStyleMatters } from './LogControls';

export interface RestFaceProps {
  /** The day's step target; absent = the plan sets none. */
  steps: number | undefined;
  /** Steps counted so far (logged, or imported from the ring or phone); absent = none yet, never zero. */
  stepsSoFar: number | undefined;
  /** A future day: the target in words, nothing counted yet. */
  future: boolean;
  id?: string;
  /** "Log an activity" (§V4.4); absent on a future day. */
  onLog?: () => void;
  /** The day shown is today (its steps may still come). */
  isToday?: boolean;
  quiet?: boolean;
}

/**
 * A rest day (A.3.3): the step target as a dotted fill of the steps so far (DATAVIZ P3), the excess said past it. A future
 * day keeps the target as its fact line. Steps stay in quiet mode (§V4.8). The day's own key logs an activity.
 */
export function RestFace({ steps, stepsSoFar, future, id, onLog, quiet = false }: RestFaceProps) {
  const counted = typeof stepsSoFar === 'number' && Number.isFinite(stepsSoFar) ? stepsSoFar : null;
  const word = future ? 'Planned' : counted === null ? TRAIN_COPY.noSteps : counted >= (steps ?? Infinity) ? 'Goal met' : 'On the way';
  return (
    <GradientCard className="lv-train-rest" domain="steps" id={id} role="region" aria-label={TRAIN_COPY.restTitle}
      head={<CardHead icon={Moon} title={TRAIN_COPY.restTitle} as="h2" info={infoSpec(INFO.rest)} />}
      foot={<CardFoot state={{ word }} link={onLog ? { label: TRAIN_COPY.logActivity, onClick: onLog } : undefined} />}>
      {steps !== undefined ? <div className="lv-train-session__hero">
        <RadialTicks label={TRAIN_COPY.steps} value={future ? null : counted} goal={steps} hue="steps" size={144}
          quiet={quiet} quietFill="ratio" quietWord={word}
          centre={<HeroNumber value={future ? null : counted} size={counted !== null && formatNumber(counted, 0).length > 5 ? 'stat' : 'time'} label={quiet ? word : `${counted ?? 'No'} steps`} quietWord={quiet ? word : undefined} />} />
        {!quiet ? <MonoMeta>{future ? TRAIN_COPY.restSteps(formatNumber(steps, 0)) : TRAIN_COPY.stepsOf(formatNumber(steps, 0))}</MonoMeta> : null}
      </div> : null}
    </GradientCard>
  );
}

export interface SessionSaveInput {
  status: 'done' | 'partial' | 'skipped';
  performed: PerformedExercise[];
  result: EquivalenceResult | null;
  durationMin?: number;
  startH?: number;
}

export interface SessionFaceProps {
  model: SessionModel;
  date: LocalDate;
  today: LocalDate;
  view: TodayView;
  setup: TrainSetup;
  draft: SessionDraft;
  onDraft: (update: (d: SessionDraft) => SessionDraft) => void;
  /** The verdict of the last save from this screen. */
  saved: SavedResult | null;
  /** Takes back the save made on this visit: an Undo key in the verdict's row (r068 L7, in place of a toast). */
  onUndo?: (() => void) | undefined;
  /** Future day: a preview. */
  readOnly: boolean;
  /** Energy numbers shown (quiet mode hides them). */
  energy: boolean;
  /** Credit numbers shown (quiet mode turns them into words). */
  numbers: boolean;
  /** Carries the view's one solid key. */
  primary: boolean;
  id?: string;
  /** Log the session; resolves to an error message, or null when saved. */
  onSave: (input: SessionSaveInput) => Promise<string | null>;
  /** Open the swap sheet for the exercise at this index (it also skips it). */
  onSwap: (index: number) => void;
  /** The swap at this index was undone (the day's record goes back to the prescribed exercise). */
  onSwapUndone?: (index: number) => void;
  /** "Use this swap on every <weekday>" for the swapped item at this index. */
  onPropose: (index: number) => void;
}

/** The envelope scope a session belongs to: a lift is resistance, a walk walking, other cardio cardio. */
export function sessionScope(model: Pick<SessionModel, 'kind' | 'session'>): ExerciseScope {
  if (model.kind === 'resistance') return 'resistance';
  const rx = model.session.prescription;
  return rx.kind === 'cardio' && rx.modality === 'walk' ? 'walking' : 'cardio';
}

/**
 * D4-02/A1-005: exercise in review for this day and session scope. The authoritative current eligibility decides when Today
 * carries one this reader knows (the scope is held, or not permitted while no new exercise is allowed); otherwise the
 * legacy reading: a logged unresolved symptom (living notice) or the screening's exercise gate.
 */
export function sessionExerciseReview(view: Pick<TodayView, 'notices' | 'exerciseEligibility'>, outcome: Parameters<typeof exerciseInReview>[0], scope?: ExerciseScope): boolean {
  const el = view.exerciseEligibility;
  if (el && el.version === CURRENT_EXERCISE_ELIGIBILITY_VERSION) {
    if (!scope) return el.held.length > 0 || !el.allowsNewExercise;
    return el.held.includes(scope) || (!el.permitted.includes(scope) && !el.allowsNewExercise);
  }
  return (view.notices ?? []).some((n) => n.id === 'symptomHold') || exerciseInReview(outcome);
}

function omit<T>(o: Readonly<Record<number, T>>, i: number): Record<number, T> {
  const n = { ...o };
  delete n[i];
  return n;
}

const STYLE_OPTIONS: Array<{ value: LogStyle; label: string }> = [
  { value: 'quick', label: TRAIN_COPY.logStyles.quick },
  { value: 'detailed', label: TRAIN_COPY.logStyles.detailed },
  { value: 'duration', label: TRAIN_COPY.logStyles.duration },
];

export function SessionFace(p: SessionFaceProps) {
  const { model, draft, setup, onDraft } = p;
  const clock = useLivingClock();
  const unit = useEnergyUnit();
  const styleId = useId();
  const [nowMs, setNowMs] = useState(() => draft.startedAt ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startedAt = draft.startedAt;
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNowMs(clock.now().getTime()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt, clock]);

  const logged = loggedStatus(p.view, model.itemId);
  const isLogged = logged.status !== 'unknown';
  const editing = !isLogged || draft.editing;
  const interactive = !p.readOnly && editing;
  const running = interactive && startedAt !== null;
  const elapsed = running ? fmtElapsed(nowMs - startedAt) : null;

  const items = model.session.items.map((_, i) => effectiveItem(model, draft, i, setup));
  const solo = items.length === 1;
  const names = displayNames(items);
  const kit = equipmentUsed(items);
  const place = placeOf(setup.profile, p.date, kit);
  const energy = sessionEnergy(items, setup.catalogue, setup.ctx);
  const target = targetOf(p.date, p.today, model.what);
  const review: SessionLogPlan | null = interactive && draft.review ? sessionLogPlan(model, draft, setup) : null;
  // a one-exercise session is named by the exercise as it will be done (the swap when there is one)
  const title = TRAIN_COPY.sessionTitle(solo ? shortName(items[0]!.name) : model.noun, model.minutes, place);

  const timing = () => sessionTiming(model, startedAt, clock.now().getTime());

  const save = async (input: SessionSaveInput) => {
    setBusy(true);
    setError(null);
    const msg = await p.onSave(input);
    setBusy(false);
    if (msg) setError(msg);
  };

  const sessionDone = () => {
    const plan = sessionLogPlan(model, draft, setup);
    if (needsReview(plan)) onDraft((d) => ({ ...d, review: true }));
    else void save({ status: plan.status, performed: plan.performed, result: plan.result, ...timing() });
  };

  const tick = (i: number) =>
    onDraft((d) => {
      const st = itemState(d, i, effectiveItem(model, d, i, setup));
      return st === 'done' ? { ...d, ticks: omit(d.ticks, i), logs: omit(d.logs, i) } : { ...d, ticks: { ...d.ticks, [i]: true }, logs: omit(d.logs, i), skips: omit(d.skips, i) };
    });
  const skip = (i: number) => onDraft((d) => toggleSkip(d, i));
  const setLog = (i: number, log: ItemLog | null) =>
    onDraft((d) => (log ? { ...d, logs: { ...d.logs, [i]: log }, ticks: omit(d.ticks, i) } : { ...d, logs: omit(d.logs, i), ticks: omit(d.ticks, i) }));
  const undoSwap = (i: number) => {
    onDraft((d) => ({ ...d, swaps: omit(d.swaps, i), logs: omit(d.logs, i), ticks: omit(d.ticks, i) }));
    p.onSwapUndone?.(i);
  };
  const start = () => {
    const t = clock.now().getTime();
    setNowMs(t);
    onDraft((d) => ({ ...d, startedAt: t }));
  };

  const access = useSafetyAccess(useBodyContext());
  const exerciseReview = sessionExerciseReview(p.view, access.outcome, sessionScope(model));
  const counted = (credit: number) => (p.numbers ? `${pctOf(credit)} %` : quietWord(pctOf(credit)));
  const lines = p.saved && isLogged ? savedLines(p.saved, target) : null;
  // D3-01: a derived dose that can't be computed is Unknown, never "0 %" (a missing credit is not zero work)
  const loggedText =
    logged.status === 'done'
      ? TRAIN_COPY.logged.done
      : logged.status === 'skipped'
        ? TRAIN_COPY.logged.skipped
        : TRAIN_COPY.logged.partial(typeof logged.credit === 'number' && Number.isFinite(logged.credit) ? counted(logged.credit) : TRAIN_COPY.doseUnknown);

  // The session facts: duration, estimated net energy and its scenario range, and the shared effort cue.
  // Equipment and the gross/net/incremental terms stay in the session details.
  // (0.6.3 INT, S2) composed on a typical placeholder body (no weight entered): no energy, and the card says so
  const tank = solo ? null : sharedTank(items);
  const energyLine = p.energy && energy.value > 0 ? <MonoMeta>≈ {formatEnergy(energy.value, unit)}</MonoMeta> : setup.typicalBody ? <a href="/body" className="lv-train-session__body-link">Add your weight for energy</a> : null;
  const progress = sessionProgress(items, draft);
  const cardio = solo && model.kind !== 'resistance';
  const total = cardio ? Math.max(1, Math.ceil(model.minutes / 5)) : progress.setsTotal;
  const done = !editing ? (logged.status === 'done' ? total : logged.status === 'skipped' ? 0 : typeof logged.credit === 'number' ? logged.credit * total : null) : cardio && running ? Math.min(total, Math.max(0, (nowMs - startedAt!) / 60000 / model.minutes * total)) : cardio ? progress.setsDone * total : progress.setsDone;
  const progressWord = done === null ? 'Not known' : done >= total ? 'Done' : done === 0 ? 'Ready' : done / total >= 0.75 ? 'Nearly done' : 'In progress';

  return (
    <GradientCard domain="steps" glow="tr" className="lv-train-session" role="region" aria-label={title} id={p.id} data-state={isLogged ? logged.status : 'open'} head={<CardHead icon={Dumbbell} title={solo ? shortName(items[0]!.name).replace(/^./, (c) => c.toUpperCase()) : model.noun.replace(/^./, (c) => c.toUpperCase())} as="h2" info={infoSpec(INFO.session, { range: p.energy && energy.value > 0 ? `Likely ${formatEnergyRange(energy.lo, energy.hi, unit)}` : undefined })} />}>
      {exerciseReview ? <InlineWarning severity="caution">{TRAIN_COPY.exerciseReview}</InlineWarning> : null}
      <div className="lv-train-session__hero">
        <RadialTicks label="Session progress" value={done} max={total} count={Math.max(1, total)} majorEvery={0} lap2={false} size={144} hue="steps" quiet={!p.numbers} quietFill="ratio" quietWord={progressWord}
          centre={<><HeroNumber value={done === null ? null : Math.floor(done)} size="num" label={p.numbers ? `${done === null ? 'Unknown' : Math.floor(done)} of ${total} ${cardio ? 'intervals' : 'sets'}` : progressWord} quietWord={!p.numbers ? progressWord : undefined} />{p.numbers ? <span className="lv-train-session__progress-label">of {total} {cardio ? 'intervals' : 'sets'}</span> : null}</>} />
        <div className="lv-train-session__summary">
          <MonoMeta>{model.minutes} min{place ? ` · ${place}` : ''}</MonoMeta>
          {energyLine}
          {tank ? <span className="lv-train-session__effort">{TRAIN_COPY.rx.tank(tank)}</span> : null}
          {interactive && !review && !running ? <IconKey size="sm" icon={Timer} label={TRAIN_COPY.start} onClick={start} /> : null}
        </div>
      </div>
      {interactive && !review && running ? (
        <div className="lv-train-session__timer">
          <span className="lv-train-session__elapsed lm-num lm-display" aria-live="off">
            {TRAIN_COPY.elapsedShort(elapsed ?? '0:00')}
          </span>
          <Key size="sm" variant="outlined" icon={TimerOff} aria-label={TRAIN_COPY.stop} onClick={() => onDraft((d) => ({ ...d, startedAt: null }))}>
            {TRAIN_COPY.stopShort}
          </Key>
        </div>
      ) : null}


      <div className="lv-rail-host">
        <ol className={solo ? 'lv-train-rows lv-train-rows--solo' : 'lv-day lv-train-rows'} aria-label={TRAIN_COPY.exercises}>
          {items.map((item, i) => {
            const loadKg = item.equipment.map((q) => setup.profile.loadsKg?.[q]?.[0]).find((v): v is number => v !== undefined);
            return (
              <ExerciseRow
                key={`${i}:${item.exerciseId}`}
                item={item}
                original={draft.swaps[i] ? model.session.items[i]! : null}
                equivalence={draft.swaps[i] ? { result: draft.swaps[i].equivalence, target: targetOf(p.date, p.today, shortName(model.session.items[i]!.name)) } : undefined}
                name={names[i]!}
                index={i}
                solo={solo}
                ex={setup.catalogue.exercise(item.exerciseId)}
                state={itemState(draft, i, item)}
                log={draft.logs[i]}
                style={draft.style}
                interactive={interactive}
                tankInHead={tankShared(item, tank)}
                tankShort={tank !== null}
                sessionDone={!editing && logged.status === 'done'}
                energy={p.energy}
                {...(loadKg !== undefined ? { loadKg } : {})}
                weekday={fmtWeekday(p.date)}
                onTick={() => tick(i)}
                onSkip={() => skip(i)}
                onSwap={() => p.onSwap(i)}
                onUndoSwap={() => undoSwap(i)}
                onPropose={() => p.onPropose(i)}
                onLog={(log) => setLog(i, log)}
              />
            );
          })}
        </ol>
      </div>

      {interactive && !review && logStyleMatters(items) ? (
        <div className="lv-train-session__style">
          <span className="lv-train-session__label" id={styleId}>
            {TRAIN_COPY.logStyle}
          </span>
          <KeyBank size="sm" labelledBy={styleId} options={STYLE_OPTIONS} value={draft.style} onChange={(v) => onDraft((d) => ({ ...d, style: v }))} />
        </div>
      ) : null}

      {error ? (
        <InlineWarning severity="caution" alert>
          {error}
        </InlineWarning>
      ) : null}

      {p.readOnly ? null : !editing ? (
        <div className="lv-train-foot" data-logged="true">
          <div className="lv-train-verdict" data-status={logged.status} data-undo={p.onUndo ? 'true' : undefined}>
            <p className="lv-train-verdict__line" role="status">
              {lines ? lines.line : loggedText}
            </p>
            {lines?.also ? <p className="lm-eng">{lines.also}</p> : null}
            {p.onUndo ? (
              <Key size="sm" variant="text" className="lv-train-verdict__undo" onClick={p.onUndo}>
                {TRAIN_COPY.toast.undo}
              </Key>
            ) : null}
          </div>
          <Key variant="outlined" onClick={() => onDraft((d) => ({ ...d, editing: true, review: false }))}>
            {TRAIN_COPY.change}
          </Key>
        </div>
      ) : review ? (
        <div className="lv-train-foot lv-train-review">
          <p className="lv-train-review__sum">{TRAIN_COPY.review(review.done, review.total, counted(review.result.credit))}</p>
          {items.some((it, i) => itemState(draft, i, it) === 'open') ? <p className="lm-eng">{TRAIN_COPY.reviewNote}</p> : null}
          <EquivalenceMeter result={review.result} target={target} detail />
          <div className="lv-train-foot__keys">
            <Key variant={p.primary ? 'primary' : 'outlined'} loading={busy} onClick={() => void save({ status: review.status, performed: review.performed, result: review.result, ...timing() })}>
              {TRAIN_COPY.save}
            </Key>
            <Key variant="text" onClick={() => onDraft((d) => ({ ...d, review: false }))}>
              {TRAIN_COPY.back}
            </Key>
          </div>
        </div>
      ) : (
        <div className="lv-train-foot">
          <div className="lv-train-foot__keys">
            <Key variant={p.primary ? 'primary' : 'outlined'} loading={busy} onClick={sessionDone}>
              {TRAIN_COPY.sessionDone}
            </Key>
          </div>
        </div>
      )}
    </GradientCard>
  );
}
