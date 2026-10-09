/**
 * The open question (COMPONENTS §14.3; design onboarding-intake-v3 §3): an inset region in the answered list with
 * "question n of N", the parent-answer chip ("because you said: …"), the self-contained prompt, "why we ask", the
 * answer controls for its kind, the default line, and the footer Back · Ask me later · Next. A single-choice key still
 * commits on press (the pressed state shows for 240 ms); Next on a card that already has an answer keeps it. Change
 * mode (Change on a row, or Back): Cancel instead of Ask me later, Save instead of Next.
 * Keys: Enter = Next · Alt+← = Back · L = Ask me later · Esc = Cancel.
 */
import { Suspense, forwardRef, useId, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CornerDownRight } from 'lucide-react';
import { InlineWarning, Key, cx } from '@/components';
import { TURN } from '../copy';
import { optionsOf, type CustomQuestion, type FlowContext, type MultiQuestion, type Question } from '../flow';
import { AnswerKeys, MultiChips, NumberAnswer, OtherEntries } from './AnswerKeys';
import { CardFootSlot, type WidgetProps } from './widgetTypes';

export interface QuestionCardProps {
  q: Question;
  /** Current answer (change mode), else undefined. */
  value: unknown;
  values: Readonly<Record<string, unknown>>;
  ctx: FlowContext;
  /** Composite answers by widget id. */
  widgets: Readonly<Record<string, ComponentType<WidgetProps<never>>>>;
  onCommit: (value: unknown) => void;
  /** Position among the chapter's visible questions. */
  position: number;
  total: number;
  /** The parent answer this question depends on (the chip), if any. */
  context?: string | null;
  /** Answered before: the card is a Change (Cancel · Save). */
  changing?: boolean;
  /** Back to the previous question (hidden when there is none). */
  onBack?: () => void;
  /** Ask me later (absent: not allowed here, e.g. change mode or a gating question). */
  onLater?: () => void;
  /** Keep the current answer and move on (enabled only when there is one). */
  onKeep?: () => void;
  onCancel?: () => void;
  /** The last save of this question failed. */
  failed?: boolean;
  onRetry?: () => void;
  /** Text above the prompt (chapter intro on the first card). */
  intro?: string;
  /** Extra content under the answers (inline notes). */
  footnote?: ReactNode;
}

function MultiTurn({ q, value, values, ctx, onCommit, labelledBy }: { q: MultiQuestion; value: unknown; values: Readonly<Record<string, unknown>>; ctx: FlowContext; onCommit: (v: string[]) => void; labelledBy: string }) {
  const [picked, setPicked] = useState<string[]>(() => (Array.isArray(value) ? [...(value as string[])] : (q.initial?.(values, ctx) ?? [])));
  const count = picked.length;
  const blocked = q.required && count === 0;
  return (
    <>
      <MultiChips options={optionsOf(q, ctx)} value={picked} onChange={setPicked} ranked={q.ranked} labelledBy={labelledBy} />
      {q.otherLabel ? <OtherEntries value={picked} onChange={setPicked} label={q.otherLabel} /> : null}
      <div className="lm-ik-done">
        <Key variant="default" onClick={() => onCommit(picked)} disabledReason={blocked ? TURN.ifSkip(q.skipText) : undefined} data-ik-done="true">
          {count ? TURN.doneCount(count) : TURN.done}
        </Key>
      </div>
    </>
  );
}

export const QuestionCard = forwardRef<HTMLLegendElement, QuestionCardProps>(function QuestionCard(
  { q, value, values, ctx, widgets, onCommit, position, total, context, changing, onBack, onLater, onKeep, onCancel, failed, onRetry, intro, footnote },
  legendRef,
) {
  const id = useId();
  const legendId = `${id}-legend`;
  const whyId = `${id}-why`;
  const chipId = `${id}-chip`;
  const [whyOpen, setWhyOpen] = useState(false);
  const [footSlot, setFootSlot] = useState<HTMLElement | null>(null);
  const hasAnswer = value !== undefined;
  const ownFooter = q.kind === 'custom' && q.ownFooter === true;
  // a card with nothing to answer: Next records `advance` (see `CustomQuestion.advance`)
  const advance = q.kind === 'custom' ? q.advance : undefined;
  const canNext = (hasAnswer && onKeep !== undefined) || advance !== undefined;
  const next = () => (hasAnswer && onKeep ? onKeep() : advance !== undefined ? onCommit(advance) : undefined);

  const onKeyDown = (e: KeyboardEvent<HTMLFieldSetElement>) => {
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
    } else if (e.key === 'Enter' && !typing && target.getAttribute('role') === 'checkbox') {
      e.preventDefault();
      e.currentTarget.querySelector<HTMLButtonElement>('[data-ik-done="true"]')?.click();
    } else if (e.key === 'Enter' && !typing && (target === e.currentTarget || target.tagName === 'LEGEND') && canNext) {
      e.preventDefault();
      next();
    }
  };

  let body: ReactNode;
  if (q.kind === 'single') {
    body = <AnswerKeys options={optionsOf(q, ctx)} value={typeof value === 'string' ? value : undefined} defaultValue={q.defaultValue} cards={q.cards} labelledBy={legendId} onCommit={onCommit} />;
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
        defaultValue={q.defaultValue}
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

  return (
    <fieldset className="lm-ik-card" id={`ik-${q.id}`} data-kind={q.kind} data-changing={changing || undefined} onKeyDown={onKeyDown} aria-describedby={describedBy} aria-keyshortcuts={shortcuts || undefined}>
      {intro ? <p className="lm-ik-card__intro">{intro}</p> : null}
      <span className="lm-ik-card__count lm-eng">
        {changing ? TURN.changing : TURN.questionOf(position, total)}
      </span>
      {context ? (
        <span className="lm-ik-chip-parent" id={chipId}>
          <CornerDownRight size={12} aria-hidden="true" />
          <span>
            {TURN.because} {context}
          </span>
        </span>
      ) : null}
      <legend ref={legendRef} id={legendId} className="lm-ik-card__prompt" tabIndex={-1}>
        {q.prompt}
      </legend>
      {q.why ? (
        <div className="lm-ik-turn__why">
          <button type="button" className="lm-ik-why" aria-expanded={whyOpen} aria-controls={whyId} onClick={() => setWhyOpen((o) => !o)}>
            {TURN.why}
            <span aria-hidden="true" className={cx('lm-ik-why__chev', whyOpen && 'is-open')}>
              ▾
            </span>
          </button>
          <p id={whyId} className="lm-ik-why__text" hidden={!whyOpen}>
            {q.why}
          </p>
        </div>
      ) : null}
      <div className="lm-ik-turn__answers">{body}</div>
      {footnote}
      <p className="lm-ik-card__default">{TURN.ifSkip(q.skipText)}</p>
      {failed ? (
        <InlineWarning
          severity="danger"
          alert
          action={
            onRetry ? (
              <Key size="sm" onClick={onRetry}>
                {TURN.tryAgain}
              </Key>
            ) : undefined
          }
        >
          {TURN.saveFailed}
        </InlineWarning>
      ) : null}
      <div className="lm-ik-card__foot">
        {onBack ? (
          <Key size="md" icon={ChevronLeft} onClick={onBack} aria-keyshortcuts="Alt+ArrowLeft">
            {TURN.back}
          </Key>
        ) : (
          <span />
        )}
        <span className="lm-ik-card__foot-right">
          {onCancel ? (
            <Key variant="quiet" size="md" onClick={onCancel} aria-keyshortcuts="Escape">
              {TURN.cancel}
            </Key>
          ) : null}
          {onLater ? (
            <Key variant="quiet" size="md" onClick={onLater} aria-keyshortcuts="L">
              {TURN.later}
            </Key>
          ) : null}
          {ownFooter ? (
            <span className="lm-ik-card__foot-slot" ref={setFootSlot} />
          ) : (
            <Key
              variant="solid"
              size="md"
              trailingIcon={ChevronRight}
              onClick={next}
              disabledReason={failed ? TURN.saveFailed : canNext ? undefined : TURN.nextNeedsAnswer}
            >
              {changing ? TURN.save : TURN.next}
            </Key>
          )}
        </span>
      </div>
    </fieldset>
  );
});
