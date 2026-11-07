/**
 * The open question (COMPONENTS §14.3; design onboarding-intake-v3 §3), the hero of a chapter step: the parent answer
 * it depends on ("Because you said: …"), the self-contained prompt, "Why we ask", the answer controls for its kind, and
 * one step row — Back (text) · Skip (text, asked later) · Next (the gold pill, always). A single-choice key still
 * commits on press (the pressed state shows for 240 ms); Next on a card that already has an answer keeps it; a
 * composite answer hands its commit to Next (`CommitKey`); with nothing to keep yet, Next moves focus to the answers
 * and names the fix under them. Change mode (Change on a row, or Back): Cancel instead of Skip, Save instead
 * of Next. On the chapter screen (`dock`) the step row is the screen's ActionBar, docked at the bottom on phones.
 * Keys: Enter = Next · Alt+← = Back · L = Skip · Esc = Cancel.
 */
import { Suspense, forwardRef, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Icon, InlineWarning, Key } from '@/components';
import { ActionBar } from '@/app/shell';
import { TURN } from '../copy';
import { optionsOf, type CustomQuestion, type FlowContext, type MultiQuestion, type Question } from '../flow';
import { AnswerKeys, MultiChips, NumberAnswer, OtherEntries } from './AnswerKeys';
import { CommitKey } from './CommitKey';
import { CardCommit, CardFootSlot, type CardCommitApi, type WidgetProps } from './widgetTypes';

/** The first answer control Next sends focus to when there is nothing to keep yet. */
const ANSWER_FOCUS = ['[role="radio"][tabindex="0"]', 'button:not([aria-disabled="true"]):not([disabled])', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])'].join(', ');

export interface QuestionCardProps {
  q: Question;
  /** Current answer (change mode), else undefined. */
  value: unknown;
  values: Readonly<Record<string, unknown>>;
  ctx: FlowContext;
  /** Composite answers by widget id. */
  widgets: Readonly<Record<string, ComponentType<WidgetProps<never>>>>;
  onCommit: (value: unknown) => void;
  /** The parent answer this question depends on, if any. */
  context?: string | null;
  /** Answered before: the card is a Change (Cancel · Save). */
  changing?: boolean;
  /** Back to the previous question (hidden when there is none). */
  onBack?: () => void;
  /** Skip = ask later (absent: not allowed here, e.g. change mode or a gating question). */
  onLater?: () => void;
  /** Keep the current answer and move on (enabled only when there is one). */
  onKeep?: () => void;
  onCancel?: () => void;
  /** The last save of this question failed. */
  failed?: boolean;
  onRetry?: () => void;
  /** Extra content under the answers (inline notes). */
  footnote?: ReactNode;
  /** The step row goes into the screen's ActionBar (the chapter screen); default: inside the card (Your body). */
  dock?: boolean;
}

function MultiTurn({ q, value, values, ctx, onCommit, labelledBy }: { q: MultiQuestion; value: unknown; values: Readonly<Record<string, unknown>>; ctx: FlowContext; onCommit: (v: string[]) => void; labelledBy: string }) {
  const [picked, setPicked] = useState<string[]>(() => (Array.isArray(value) ? [...(value as string[])] : (q.initial?.(values, ctx) ?? [])));
  const count = picked.length;
  const blocked = q.required && count === 0;
  return (
    <>
      <MultiChips options={optionsOf(q, ctx)} value={picked} onChange={setPicked} ranked={q.ranked} labelledBy={labelledBy} />
      {q.otherLabel ? <OtherEntries value={picked} onChange={setPicked} label={q.otherLabel} /> : null}
      <CommitKey onClick={() => onCommit(picked)} disabledReason={blocked ? TURN.nextNeedsAnswer : undefined}>
        {count ? TURN.doneCount(count) : TURN.done}
      </CommitKey>
    </>
  );
}

export const QuestionCard = forwardRef<HTMLLegendElement, QuestionCardProps>(function QuestionCard(
  { q, value, values, ctx, widgets, onCommit, context, changing, onBack, onLater, onKeep, onCancel, failed, onRetry, footnote, dock = false },
  legendRef,
) {
  const id = useId();
  const legendId = `${id}-legend`;
  const whyId = `${id}-why`;
  const chipId = `${id}-chip`;
  const [whyOpen, setWhyOpen] = useState(false);
  const [footSlot, setFootSlot] = useState<HTMLElement | null>(null);
  // a composite answer's commit, registered by its CommitKey: Next runs it
  const commitRun = useRef<(() => void) | null>(null);
  const [commitReason, setCommitReason] = useState<string | null | undefined>(undefined);
  const commitApi = useMemo<CardCommitApi>(
    () => ({
      setRun: (run) => {
        commitRun.current = run;
      },
      setReason: setCommitReason,
    }),
    [],
  );
  const registered = commitReason !== undefined;
  const hasAnswer = value !== undefined;
  const ownFooter = q.kind === 'custom' && q.ownFooter === true;
  // a card with nothing to answer: Next records `advance` (see `CustomQuestion.advance`)
  const advance = q.kind === 'custom' ? q.advance : undefined;
  const canNext = registered ? commitReason === null : (hasAnswer && onKeep !== undefined) || advance !== undefined;
  // Next is always the step's gold primary. Pressed before there is anything to keep, it moves focus to the answers and
  // names the fix under them (the reason stays up until the card can go on); a failed save is the one disabled state.
  const [nudged, setNudged] = useState(false);
  const answersRef = useRef<HTMLDivElement>(null);
  const next = () => {
    if (registered && commitReason === null) commitRun.current?.();
    else if (!registered && hasAnswer && onKeep) onKeep();
    else if (!registered && advance !== undefined) onCommit(advance);
    else {
      setNudged(true);
      answersRef.current?.querySelector<HTMLElement>(ANSWER_FOCUS)?.focus();
    }
  };
  const nudge = nudged && !canNext ? (commitReason ?? TURN.nextNeedsAnswer) : null;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'ArrowLeft' && e.altKey && onBack) {
      e.preventDefault();
      onBack();
    } else if ((e.key === 'l' || e.key === 'L') && onLater && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      onLater();
    } else if (e.key === 'Enter' && !typing && (target === e.currentTarget || target.tagName === 'LEGEND' || target.getAttribute('role') === 'checkbox') && canNext && !failed) {
      e.preventDefault();
      next();
    }
  };

  let body: ReactNode;
  if (q.kind === 'single') {
    body = <AnswerKeys options={optionsOf(q, ctx)} value={typeof value === 'string' ? value : undefined} cards={q.cards} labelledBy={legendId} onCommit={onCommit} />;
  } else if (q.kind === 'multi') {
    body = <MultiTurn key={q.id} q={q} value={value} values={values} ctx={ctx} onCommit={onCommit} labelledBy={legendId} />;
  } else if (q.kind === 'number') {
    body = (
      <NumberAnswer
        value={typeof value === 'number' ? value : undefined}
        min={q.min}
        max={q.max}
        step={q.step}
        unit={q.unit}
        name={q.name}
        presets={q.presets}
        presetLabel={q.presetLabel}
        onCommit={onCommit}
        labelledBy={legendId}
      />
    );
  } else {
    const W = widgets[(q as CustomQuestion).widget] as ComponentType<WidgetProps<unknown>> | undefined;
    body = W ? (
      <Suspense fallback={<p className="lm-ik-note">{TURN.loading}</p>}>
        <CardFootSlot.Provider value={ownFooter ? footSlot : null}>
          <W q={q as CustomQuestion} value={value} values={values} ctx={ctx} onCommit={onCommit} labelledBy={legendId} />
        </CardFootSlot.Provider>
      </Suspense>
    ) : null;
  }

  const describedBy = [context ? chipId : null, whyOpen ? whyId : null].filter(Boolean).join(' ') || undefined;
  const shortcuts = [canNext ? 'Enter' : null, onBack ? 'Alt+ArrowLeft' : null, onLater ? 'L' : null, onCancel ? 'Escape' : null].filter(Boolean).join(' ');

  const steps = (
    <div className="lm-ik-nav" data-docked={dock || undefined} onKeyDown={dock ? onKeyDown : undefined}>
      {onBack ? (
        <Key variant="outlined" onClick={onBack} aria-keyshortcuts="Alt+ArrowLeft" className="lm-ik-nav__back">
          {TURN.back}
        </Key>
      ) : null}
      <span className="lm-ik-nav__end">
        {onCancel ? (
          <Key variant="outlined" onClick={onCancel} aria-keyshortcuts="Escape">
            {TURN.cancel}
          </Key>
        ) : null}
        {onLater ? (
          <Key variant="outlined" onClick={onLater} aria-keyshortcuts="L">
            {TURN.later}
          </Key>
        ) : null}
        {ownFooter ? (
          <span className="lm-ik-nav__slot" ref={setFootSlot} />
        ) : (
          <Key variant="primary" onClick={next} disabledReason={failed ? TURN.saveFailed : undefined}>
            {changing ? TURN.save : TURN.next}
          </Key>
        )}
      </span>
    </div>
  );

  return (
    <CardCommit.Provider value={commitApi}>
      <fieldset className="lm-ik-card lm-material" id={`ik-${q.id}`} data-enter="" data-kind={q.kind} data-why={q.why ? '' : undefined} data-changing={changing || undefined} onKeyDown={onKeyDown} aria-describedby={describedBy} aria-keyshortcuts={shortcuts || undefined}>
        <legend ref={legendRef} id={legendId} className="lm-ik-card__prompt" tabIndex={-1}>
          {q.prompt}
        </legend>
        {changing ? <span className="lm-ik-card__state">{TURN.changing}</span> : null}
        {/* why this question shows: a quiet caption under the prompt, not a line above it (r068 ON-8) */}
        {context ? (
          <span className="lm-ik-card__context" id={chipId}>
            {TURN.because} {context}
          </span>
        ) : null}
        {q.why ? (
          <div className="lm-ik-turn__why">
            <button type="button" className="lm-info lm-ik-why" aria-label={TURN.why} aria-expanded={whyOpen} aria-controls={whyId} onClick={() => setWhyOpen((o) => !o)}>
              <Icon icon={Info} size={15} />
            </button>
            <p id={whyId} className="lm-ik-why__text" hidden={!whyOpen}>
              {q.why}
            </p>
          </div>
        ) : null}
        <div className="lm-ik-turn__answers" ref={answersRef}>
          {body}
        </div>
        {/* the fix, after Next was pressed with nothing to keep: always in the tree, so the live region speaks */}
        <p className="lm-ik-nudge" aria-live="polite">
          {nudge}
        </p>
        {footnote}
        {failed ? (
          <InlineWarning
            severity="danger"
            alert
            action={
              onRetry ? (
                <Key size="sm" variant="text" onClick={onRetry}>
                  {TURN.tryAgain}
                </Key>
              ) : undefined
            }
          >
            {TURN.saveFailed}
          </InlineWarning>
        ) : null}
        {dock ? null : steps}
      </fieldset>
      {dock ? <ActionBar>{steps}</ActionBar> : null}
    </CardCommit.Provider>
  );
});
