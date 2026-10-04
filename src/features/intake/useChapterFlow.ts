/**
 * One chapter's flow state for a screen (the chapter page and the Body page's maintenance panel share it): the stored
 * turns, adopted until the person answers here; the live context stamped into the answers at entry (so what is asked
 * depends on the answers only); and the controls of the question card — Next / one-tap answer, Ask me later, Back,
 * Change, Cancel — each saved through `intake.answer` (./persist.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TURN } from './copy';
import { turnsOf, useIntakeDoc } from './doc';
import {
  activeQuestion,
  back,
  backTarget,
  cancelReopen,
  commit,
  initialFlow,
  isDone,
  progress,
  questionByAnchor,
  receiptOf,
  reopen,
  skip,
  stampContext,
  visibleQuestions,
  type FlowContext,
  type FlowState,
  type Question,
} from './flow';
import type { SectionContext } from './sections';
import type { ChapterAnswers, ChapterId } from './types';

export interface ChapterFlow {
  qs: readonly Question[];
  state: FlowState;
  /** The card shown (change mode or the first open question); null = chapter complete. */
  active: Question | null;
  /** The card is a Change (or Back) of an answered question. */
  changing: boolean;
  /** Back has somewhere to go. */
  canBack: boolean;
  progress: ReturnType<typeof progress>;
  visible: Question[];
  /** Polite live-region text after the last action. */
  announce: string;
  /** The question whose save failed (the card shows the error with Try again). */
  failed: string | null;
  /** The person answered here (stored updates are no longer adopted). */
  dirty: boolean;
  commit: (q: Question, value: unknown) => void;
  later: (q: Question) => void;
  back: () => void;
  change: (id: string) => void;
  cancel: () => void;
  /** Next on a card that already has an answer: keep it and move on. */
  keep: () => void;
  retry: () => void;
  /** Replace the whole state (Skip this part, Undo). */
  replace: (next: FlowState, save?: boolean) => void;
}

/** The context for the flow functions: the stamped answers carry it; `live` only fills what was never stamped. */
export function useChapterFlow(chapter: ChapterId, qs: readonly Question[], sctx: SectionContext, ctx: FlowContext, opts: { anchor?: string; save?: boolean } = {}): ChapterFlow {
  const doc = useIntakeDoc();
  const { anchor = '', save: canSave = true } = opts;
  const anchored = useCallback(
    (s: FlowState): FlowState => {
      const q = anchor ? questionByAnchor(qs, anchor) : undefined;
      return q && isDone(s.answers, q.id) && visibleQuestions(qs, s.answers, ctx).includes(q) ? reopen(s, q.id) : s;
    },
    [anchor, qs, ctx],
  );
  const stored = useMemo(() => turnsOf(doc, chapter), [doc, chapter]);
  const storedKey = `${JSON.stringify(stored)}#${anchor}`;
  const [state, setState] = useState<FlowState>(() => anchored(initialFlow(stored)));
  const [adopted, setAdopted] = useState(storedKey);
  const [dirty, setDirty] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  // `base` is the state this render ends with: the stamp below must build on an adoption made in the same render (the
  // stored document and the context can arrive together, e.g. the devices section sets the step device; stamping the
  // stale state would drop the adopted answers and reopen the chapter at question 1)
  let base = state;
  if (adopted !== storedKey) {
    setAdopted(storedKey);
    if (!dirty) {
      base = anchored(initialFlow(stored));
      setState(base);
    }
  }

  const persist = useCallback(
    (answers: ChapterAnswers, qid: string | null) => {
      setDirty(true);
      if (!canSave) return;
      void import('./persist').then((p) =>
        p.saveChapter(chapter, answers, sctx).then(
          (ok) => setFailed(ok ? null : qid),
          () => setFailed(qid),
        ),
      );
    },
    [chapter, sctx, canSave],
  );

  // chapter entry: locale, gentle mode and step device become answers (stamped during render, like the adoption above)
  const stamped = stampContext(base.answers, ctx);
  if (stamped !== base.answers) setState({ ...base, answers: stamped });
  // … and are saved once the chapter has been started (only when the stored answers carry other values)
  const storedStamp = stampContext(stored, ctx);
  const needsStampSave = storedStamp !== stored && Object.keys(stored.status).length > 0 && !dirty;
  useEffect(() => {
    if (!needsStampSave || !canSave) return;
    const answers = stampContext(stored, ctx);
    void import('./persist').then((p) => p.saveChapter(chapter, answers, sctx));
  }, [needsStampSave, stored, ctx, canSave, chapter, sctx]);

  const visible = visibleQuestions(qs, state.answers, ctx);
  const active = activeQuestion(qs, state, ctx);
  const prog = progress(qs, state, ctx);
  const changing = active !== null && isDone(state.answers, active.id);
  const position = (q: Question | null, s: FlowState) => {
    const vis = visibleQuestions(qs, s.answers, ctx);
    return q ? vis.indexOf(q) + 1 : vis.length;
  };

  const doCommit = (q: Question, value: unknown) => {
    const next = commit(state, q.id, value);
    setState(next);
    persist(next.answers, q.id);
    const n = activeQuestion(qs, next, ctx);
    const total = visibleQuestions(qs, next.answers, ctx).length;
    setAnnounce(`${TURN.saved(q.short, receiptOf(q, value, ctx))}${n ? ` ${TURN.questionOf(position(n, next), total)}.` : ''}`);
  };
  const doLater = (q: Question) => {
    const next = skip(state, q.id);
    setState(next);
    persist(next.answers, q.id);
    setAnnounce(TURN.skippedSaved(q.short));
  };
  const doBack = () => {
    const t = backTarget(qs, state, ctx);
    if (!t) return;
    const next = back(qs, state, ctx);
    setState(next);
    const st = next.answers.status[t.id];
    const ans = st === 'answered' ? receiptOf(t, next.answers.values[t.id], ctx) : st === 'skipped' ? TURN.usingLater(t.skipText) : null;
    setAnnounce(TURN.movedTo(position(t, next), visibleQuestions(qs, next.answers, ctx).length, ans));
  };

  return {
    qs,
    state,
    active,
    changing,
    canBack: backTarget(qs, state, ctx) !== null,
    progress: prog,
    visible,
    announce,
    failed,
    dirty,
    commit: doCommit,
    later: doLater,
    back: doBack,
    change: (id) => setState((s) => (isDone(s.answers, id) ? reopen(s, id) : s)),
    cancel: () => setState(cancelReopen),
    keep: () => setState(cancelReopen),
    retry: () => persist(state.answers, failed),
    replace: (next, save = true) => {
      setState(next);
      if (save) persist(next.answers, null);
      else setDirty(true);
    },
  };
}
