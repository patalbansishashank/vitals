/**
 * The answered list (COMPONENTS §14.2; design onboarding-intake-v3 §3): every question of a chapter in fixed order —
 * answered ones with their answer and Change, asked-later ones with what plans use and Answer, kept answers that no
 * longer apply in ink-3 with the reason — and the open question card in its own position. Children sit indented under
 * their parent with a tree rule. Upcoming questions are not listed ("7 more questions in this chapter").
 */
import type { ReactNode } from 'react';
import { Key } from '@/components';
import { TURN } from '../copy';
import { depthOf, isDone, notUsed, receiptOf, visibleQuestions, type FlowContext, type Question } from '../flow';
import type { ChapterAnswers } from '../types';

export interface AnswerRowProps {
  question: string;
  answer: string;
  depth: number;
  later?: boolean;
  /** Kept but no longer used: the reason ("you said …"). */
  notUsedReason?: string | null;
  notUsed?: boolean;
  /** Change (or Answer, for asked later). */
  onChange?: () => void;
  changeLabel?: string;
}

export function AnswerRow({ question, answer, depth, later, notUsed: nu, notUsedReason, onChange, changeLabel }: AnswerRowProps) {
  const shown = later ? TURN.usingLater(answer) : answer;
  return (
    <li className="lm-ik-row-a" data-depth={Math.min(depth, 2) || undefined} data-later={later || undefined} data-not-used={nu || undefined}>
      <span className="lm-ik-row-a__q">
        {later ? <span className="lm-ik-row-a__dot" aria-hidden="true" /> : null}
        {question}
      </span>
      <p className="lm-ik-row-a__a">
        {nu ? (notUsedReason ? TURN.notUsedBecause(notUsedReason) : TURN.notUsed) : shown}
      </p>
      {onChange ? (
        <Key className="lm-ik-row-a__key" variant="quiet" size="sm" onClick={onChange} aria-label={changeLabel ?? TURN.changeLabel(question, shown)}>
          {later ? TURN.answerNow : TURN.change}
        </Key>
      ) : null}
    </li>
  );
}

export interface AnsweredListProps {
  qs: readonly Question[];
  answers: ChapterAnswers;
  ctx: FlowContext;
  /** The card shown and where it goes (null = none). */
  open: { id: string; node: ReactNode } | null;
  onChange: (id: string) => void;
  /** Content placed right before a question's row or card (the maintenance result before `measuredEver`). */
  before?: (q: Question) => ReactNode;
  /** Only these questions are listed (Body page: chapter A rows). */
  include?: (q: Question) => boolean;
  /** Show "N more questions in this chapter" under the open card. */
  showMore?: boolean;
  /** Ends the list (the chapter receipt). */
  end?: ReactNode;
  label: string;
}

export function AnsweredList({ qs, answers, ctx, open, onChange, before, include, showMore = true, end, label }: AnsweredListProps) {
  const visible = visibleQuestions(qs, answers, ctx);
  const unused = new Set(notUsed(qs, answers, ctx));
  const openIndex = open ? visible.findIndex((q) => q.id === open.id) : -1;
  const more = visible.filter((q, i) => i > openIndex && !isDone(answers, q.id) && q.id !== open?.id).length;
  const items: ReactNode[] = [];
  for (const q of qs) {
    if (include && !include(q)) continue;
    const isVisible = visible.includes(q);
    const pre = before?.(q);
    if (pre && (isVisible || q.id === open?.id)) items.push(<li key={`before-${q.id}`} className="lm-ik-list__slot">{pre}</li>);
    if (open && q.id === open.id) {
      items.push(
        <li key={q.id} className="lm-ik-list__slot" data-depth={Math.min(depthOf(qs, q), 2) || undefined}>
          {open.node}
        </li>,
      );
      continue;
    }
    const depth = depthOf(qs, q);
    if (isVisible && isDone(answers, q.id)) {
      const later = answers.status[q.id] === 'skipped';
      const answer = later ? q.skipText : receiptOf(q, answers.values[q.id], ctx);
      items.push(<AnswerRow key={q.id} question={q.prompt} answer={answer} depth={depth} later={later} onChange={() => onChange(q.id)} />);
    } else if (!isVisible && unused.has(q.id)) {
      const parent = q.parent ? qs.find((x) => x.id === q.parent) : undefined;
      const parentShown = parent && visible.includes(parent) && answers.values[parent.id] !== undefined;
      const reason = parentShown ? receiptOf(parent, answers.values[parent.id], ctx) : null;
      items.push(
        <AnswerRow
          key={q.id}
          question={q.prompt}
          answer={receiptOf(q, answers.values[q.id], ctx)}
          depth={depth}
          notUsed
          notUsedReason={reason}
          onChange={parentShown ? () => onChange(parent.id) : undefined}
          changeLabel={parentShown ? TURN.changeLabel(parent.prompt, reason ?? '') : undefined}
        />,
      );
    }
  }
  return (
    <div className="lm-ik-list">
      <ol className="lm-ik-list__rows" aria-label={label}>
        {items}
      </ol>
      {open && showMore && more > 0 ? <p className="lm-ik-list__more">{TURN.more(more)}</p> : null}
      {end}
    </div>
  );
}
