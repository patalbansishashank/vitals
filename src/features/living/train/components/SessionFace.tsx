/**
 * The session faceplate (living-mode.md Train, "Sessions and logging"): header "Lift · 33 min · home" with energy and
 * its likely range, "with your 8 kg backpack", the log style and the optional timer, the exercise rows, and the footer —
 * Session done (all remaining as planned; partial shows a summary first), I did something else, Skipped — or, once
 * logged, the verdict with "also trained".
 */
import { useEffect, useId, useState } from 'react';
import { Timer } from 'lucide-react';
import type { EquivalenceResult, PerformedExercise } from '@/catalogues';
import type { LocalDate, TodayView } from '@/living';
import { ActionBar } from '@/app/shell';
import { Faceplate, FaceplateHeader, InlineWarning, Key, KeyBank, VisuallyHidden } from '@/components';
import { EquivalenceMeter, pctOf } from '../../components/EquivalenceMeter';
import { EstimateReadout } from '../../components/Estimate';
import { useLivingClock } from '../../clock';
import { fmtWeekday, quietWord } from '../../format';
import { TRAIN_COPY } from '../copy';
import {
  displayNames,
  effectiveItem,
  equipmentPhrase,
  equipmentUsed,
  fmtElapsed,
  itemState,
  loggedStatus,
  needsReview,
  placeOf,
  savedLines,
  sessionEnergy,
  sessionLogPlan,
  targetOf,
  shortName,
  type ItemLog,
  type LogStyle,
  type SavedResult,
  type SessionDraft,
  type SessionLogPlan,
  type SessionModel,
  type TrainSetup,
} from '../session';
import { ExerciseRow } from './ExerciseRow';

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
  onSwap: (index: number) => void;
  onElse: () => void;
  /** The swap at this index was undone (the day's record goes back to the prescribed exercise). */
  onSwapUndone?: (index: number) => void;
  /** "Use this swap on every <weekday>" for the swapped item at this index. */
  onPropose: (index: number) => void;
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
  const titleId = useId();
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
  const names = displayNames(items);
  const kit = equipmentUsed(items);
  const phrase = equipmentPhrase(kit, setup.profile, setup.catalogue);
  const place = placeOf(setup.profile, p.date, kit);
  const energy = sessionEnergy(items, setup.catalogue, setup.ctx);
  const target = targetOf(p.date, p.today, model.noun);
  const review: SessionLogPlan | null = interactive && draft.review ? sessionLogPlan(model, draft, setup) : null;

  const timing = (): { durationMin: number; startH: number } => {
    if (startedAt === null) return { durationMin: model.minutes, startH: model.startH };
    const now = clock.now().getTime();
    const s = new Date(startedAt);
    return { durationMin: Math.max(1, Math.round((now - startedAt) / 60000)), startH: s.getHours() + s.getMinutes() / 60 };
  };

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
  const skip = (i: number) =>
    onDraft((d) => (d.skips[i] ? { ...d, skips: omit(d.skips, i) } : { ...d, skips: { ...d.skips, [i]: true }, ticks: omit(d.ticks, i), logs: omit(d.logs, i) }));
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

  const counted = (credit: number) => (p.numbers ? `${pctOf(credit)} %` : quietWord(pctOf(credit)));
  const lines = p.saved && isLogged ? savedLines(p.saved, target) : null;
  const loggedText =
    logged.status === 'done' ? TRAIN_COPY.logged.done : logged.status === 'skipped' ? TRAIN_COPY.logged.skipped : TRAIN_COPY.logged.partial(counted(logged.credit ?? 0));

  return (
    <Faceplate className="lv-train-session" aria-labelledby={titleId} id={p.id} data-state={isLogged ? logged.status : 'open'}>
      <FaceplateHeader
        title={TRAIN_COPY.sessionTitle(model.noun, model.minutes, place)}
        titleId={titleId}
        actions={
          p.energy && energy.value > 0 ? (
            <span className="lv-train-energy">
              <VisuallyHidden>{TRAIN_COPY.energyName} </VisuallyHidden>
              <EstimateReadout value={energy.value} range={{ lo: energy.lo, hi: energy.hi }} unit="kcal" approx short />
            </span>
          ) : undefined
        }
      />
      <div className="lv-train-session__meta">
        <p className="lv-train-session__kit">{phrase ? TRAIN_COPY.withEquipment(phrase) : TRAIN_COPY.noEquipment}</p>
        {interactive ? (
          <div className="lv-train-session__controls">
            <KeyBank size="sm" label={TRAIN_COPY.logStyle} options={STYLE_OPTIONS} value={draft.style} onChange={(v) => onDraft((d) => ({ ...d, style: v }))} />
            {running ? (
              <>
                <span className="lv-train-session__elapsed lm-num" aria-live="off">
                  {TRAIN_COPY.elapsedShort(elapsed ?? '0:00')}
                </span>
                <Key size="sm" variant="quiet" onClick={() => onDraft((d) => ({ ...d, startedAt: null }))}>
                  {TRAIN_COPY.stop}
                </Key>
              </>
            ) : (
              <Key size="sm" variant="quiet" icon={Timer} onClick={start}>
                {TRAIN_COPY.start}
              </Key>
            )}
          </div>
        ) : null}
      </div>

      <ol className="lv-train-rows" aria-label={TRAIN_COPY.exercises}>
        {items.map((item, i) => {
          const loadKg = item.equipment.map((q) => setup.profile.loadsKg?.[q]?.[0]).find((v): v is number => v !== undefined);
          return (
            <ExerciseRow
              key={`${i}:${item.exerciseId}`}
              item={item}
              original={draft.swaps[i] ? model.session.items[i]! : null}
              equivalence={draft.swaps[i] ? { result: draft.swaps[i].equivalence, target: targetOf(p.date, p.today, shortName(model.session.items[i]!.name)) } : undefined}
              name={names[i]!}
              ex={setup.catalogue.exercise(item.exerciseId)}
              state={itemState(draft, i, item)}
              log={draft.logs[i]}
              style={draft.style}
              interactive={interactive}
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

      {error ? (
        <InlineWarning severity="caution" alert>
          {error}
        </InlineWarning>
      ) : null}

      {p.readOnly ? null : !editing ? (
        <div className="lv-train-foot" data-logged="true">
          <div className="lv-train-verdict">
            <p className="lv-train-verdict__line">{lines ? lines.line : loggedText}</p>
            {lines?.also ? <p className="lm-eng">{lines.also}</p> : null}
          </div>
          <Key size="sm" variant="quiet" onClick={() => onDraft((d) => ({ ...d, editing: true, review: false }))}>
            {TRAIN_COPY.change}
          </Key>
        </div>
      ) : review ? (
        <div className="lv-train-foot lv-train-review">
          <p className="lv-train-review__sum">{TRAIN_COPY.review(review.done, review.total, counted(review.result.credit))}</p>
          {items.some((it, i) => itemState(draft, i, it) === 'open') ? <p className="lv-train-note">{TRAIN_COPY.reviewNote}</p> : null}
          <EquivalenceMeter result={review.result} target={target} detail />
          <div className="lv-train-foot__keys">
            <Key variant={p.primary ? 'solid' : 'default'} loading={busy} onClick={() => void save({ status: review.status, performed: review.performed, result: review.result, ...timing() })}>
              {TRAIN_COPY.save}
            </Key>
            <Key variant="quiet" onClick={() => onDraft((d) => ({ ...d, review: false }))}>
              {TRAIN_COPY.back}
            </Key>
          </div>
        </div>
      ) : (
        <div className="lv-train-foot">
          <div className="lv-train-foot__keys">
            <Key variant={p.primary ? 'solid' : 'default'} loading={busy} onClick={sessionDone}>
              {TRAIN_COPY.sessionDone}
            </Key>
            <Key onClick={p.onElse}>{TRAIN_COPY.somethingElse}</Key>
            <Key variant="quiet" aria-label={TRAIN_COPY.skippedName(model.noun)} onClick={() => void save({ status: 'skipped', performed: [], result: null, ...timing() })}>
              {TRAIN_COPY.skipped}
            </Key>
          </div>
        </div>
      )}

      {running ? (
        <ActionBar>
          <span className="lv-train-bar lm-num">{TRAIN_COPY.elapsed(model.noun, elapsed ?? '0:00')}</span>
          <Key onClick={sessionDone}>{TRAIN_COPY.sessionDone}</Key>
        </ActionBar>
      ) : null}
    </Faceplate>
  );
}
