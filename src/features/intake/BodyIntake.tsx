/**
 * What Your body shows of the intake: the "a normal day" lines with an edit link and the asked-later reminder chip
 * (Habits section), the maintenance panel (engine band and drivers, the measured-energy questions inline and chapter
 * A's answers with Change), and "Your setup" (the chapters, any order). Saving loads the intake writer on demand.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Chip, Faceplate, KeyLink, KeyValueList } from '@/components';
import { useSafetyStore } from '@/state/safetyStore';
import { useSettingsStore } from '@/state/settingsStore';
import { CHAPTER_QUESTIONS, CHAPTERS } from './chapters';
import { hasStepDevice } from './chapters/devices';
import { AnsweredList } from './components/AnsweredList';
import { MaintenanceResult } from './components/Maintenance';
import { QuestionCard } from './components/QuestionCard';
import { WIDGETS } from './components/widgets';
import { detectIndia } from './context';
import { BODY, CHAPTER_NAME, CHAPTER_SHORT, SUMMARY } from './copy';
import { frozenContext, isDone, type FlowContext } from './flow';
import type { SectionContext } from './sections';
import { intakePath } from './paths';
import { allChapterStates, askedLaterCount, chapterLine, nextOpen } from './summary';
import { useChapterFlow } from './useChapterFlow';
import { useLiveMaintenance } from './useMaintenance';
import { CHAPTER_ROUTE, type ChapterId, type IntakeDoc } from './types';
import './intake.css';

const sectionOf = (c: ChapterId) => CHAPTER_ROUTE[c];

/**
 * The flow context for Your body without re-running the safety evaluation (Your body already has `gentle`); cheap, so
 * shape drags stay one estimate per frame.
 */
export function useBodyFlowContext(doc: IntakeDoc, gentle: boolean): FlowContext {
  const [india] = useState(detectIndia);
  const stepDevice = hasStepDevice(doc.devices);
  return useMemo(() => ({ india, gentle, stepDevice }), [india, gentle, stepDevice]);
}

const sectionContext = (ctx: FlowContext): SectionContext => ({ ...ctx, safety: useSafetyStore.getState().answers, now: new Date().toISOString() });

/** Where "answer now" goes: the first unanswered chapter, else the first question asked later. */
function laterTarget(doc: IntakeDoc, ctx: FlowContext): string {
  const open = nextOpen(doc, ctx);
  if (!open) return intakePath('activity', { from: 'body' });
  return intakePath(sectionOf(open.chapter), { from: 'body', ...(open.question ? { anchor: open.question.anchor ?? open.question.id } : {}) });
}

/** "N questions asked later" — opens the first one. Renders nothing when none are waiting. */
export function IntakeReminderChip({ doc, ctx }: { doc: IntakeDoc; ctx: FlowContext }) {
  const navigate = useNavigate();
  const n = askedLaterCount(doc, ctx);
  if (n === 0) return null;
  const target = laterTarget(doc, ctx);
  return (
    <Chip kind="status" severity="info" onClick={() => navigate(target)}>
      <span aria-hidden="true">{BODY.reminder(n)}</span>
      <span className="lm-sr">{BODY.reminderLabel(n)}</span>
    </Chip>
  );
}

/** Habits › "a normal day": one line from the answers, or the invitation; with the edit link. */
export function NormalDaySummary({ doc, ctx }: { doc: IntakeDoc; ctx: FlowContext }) {
  const line = chapterLine('activity', doc, ctx);
  return (
    <div className="lm-ik-normalday">
      <KeyValueList items={[{ key: BODY.normalDay, value: line ?? BODY.notAnswered, id: 'normal-day' }]} />
      <div className="lm-ik-actions">
        <KeyLink to={intakePath('activity', { from: 'body' })} variant="quiet" size="sm">
          {line ? BODY.edit : BODY.start}
        </KeyLink>
      </div>
    </div>
  );
}

/** Your setup: the chapters with their state; each opens in Your body's shell (`?from=body`). */
export function SetupFace({ doc, ctx, id }: { doc: IntakeDoc; ctx: FlowContext; id?: string }) {
  const states = allChapterStates(doc, ctx);
  const later = askedLaterCount(doc, ctx);
  return (
    <Faceplate id={id} className="lm-ik-setup" title={BODY.setupTitle}>
      <p className="lm-ik-note">{BODY.setupLead}</p>
      <dl className="lm-ik-summary__rows">
        {CHAPTERS.map((c) => {
          const s = states[c];
          const status = s.complete ? BODY.chapterStatus.done : s.started ? BODY.chapterStatus.partial(s.done, s.total) : BODY.chapterStatus.todo;
          return (
            <div key={c} className="lm-ik-summary__row">
              <dt>{CHAPTER_SHORT[c]}</dt>
              <dd>{chapterLine(c, doc, ctx) ?? status}</dd>
              <KeyLink className="lm-ik-summary__change" to={intakePath(sectionOf(c), { from: 'body' })} variant="quiet" size="sm" aria-label={SUMMARY.changeLabel(CHAPTER_NAME[c])}>
                {s.started ? SUMMARY.change : BODY.startChapter}
              </KeyLink>
            </div>
          );
        })}
        {later ? (
          <div className="lm-ik-summary__row">
            <dt>{SUMMARY.askedLater}</dt>
            <dd>{SUMMARY.askedLaterValue(later)}</dd>
            <KeyLink className="lm-ik-summary__change" to={laterTarget(doc, ctx)} variant="quiet" size="sm" aria-label={BODY.reminderLabel(later)}>
              {BODY.answerNow}
            </KeyLink>
          </div>
        ) : null}
      </dl>
    </Faceplate>
  );
}

/**
 * The maintenance panel (design v3 §4.4): the engine's band and drivers, the biggest unknown, the measured-energy
 * questions inline (a card when unanswered, a row with Change once answered) and chapter A's answered list with Change
 * — the same graph, the same component and the same document as the chapter screen; no sheet. A driver's "change"
 * opens that question on the chapter screen (`from=body`).
 */
export function MaintenanceFace({ ctx, quiet, id }: { doc?: IntakeDoc; ctx: FlowContext; quiet: boolean; id?: string }) {
  const navigate = useNavigate();
  const unit = useSettingsStore((s) => s.energyUnit);
  const sctx = useMemo(() => sectionContext(ctx), [ctx]);
  const qs = CHAPTER_QUESTIONS.activity;
  const flow = useChapterFlow('activity', qs, sctx, ctx);
  const { state, changing } = flow;
  const fctx = useMemo(() => frozenContext(state.answers, ctx), [state.answers, ctx]);
  const live = useLiveMaintenance(state.answers, fctx, unit, false);
  const visible = flow.visible;
  // Your body asks only the measured-energy questions; any other question opens here only through Change
  const pending = visible.find((q) => MEASURED_IDS.includes(q.id) && !isDone(state.answers, q.id)) ?? null;
  const open = changing ? flow.active : pending;
  const card = open ? (
    <QuestionCard
      key={`${open.id}-${changing ? 'c' : 'a'}`}
      q={open}
      value={state.answers.status[open.id] === 'answered' ? state.answers.values[open.id] : undefined}
      values={state.answers.values}
      ctx={fctx}
      widgets={WIDGETS}
      position={visible.indexOf(open) + 1}
      total={visible.length}
      context={open.contextLine?.(state.answers.values, fctx) ?? null}
      changing={changing}
      onCommit={(v) => flow.commit(open, v)}
      onLater={!changing && open.askLater !== false ? () => flow.later(open) : undefined}
      onKeep={flow.keep}
      onCancel={changing ? flow.cancel : undefined}
      failed={flow.failed === open.id}
      onRetry={flow.retry}
    />
  ) : null;
  const started = Object.keys(state.answers.status).length > 0;
  const [foldOpen, setFoldOpen] = useState(false);
  return (
    <Faceplate id={id} className="lm-ik-maint" title={BODY.maintTitle}>
      <MaintenanceResult
        inset={false}
        title={BODY.maintTitle}
        m={live.summary.maintenance}
        view={live.view}
        unit={unit}
        quiet={quiet}
        typicalBody={!live.summary.complete}
        measured={live.result.measured}
        onChangeAnswer={(q) => {
          if (!MEASURED_IDS.includes(q)) navigate(intakePath('activity', { from: 'body', anchor: q }));
          else if (isDone(state.answers, q)) flow.change(q);
          // unanswered: it is the card right below; bring it into view
          else document.getElementById(`ik-${q}`)?.scrollIntoView?.({ block: 'center' });
        }}
      />
      <h3 className="lm-ik-result__title">{BODY.measuredTitle}</h3>
      <AnsweredList
        qs={qs}
        answers={state.answers}
        ctx={fctx}
        open={open && card && MEASURED_IDS.includes(open.id) ? { id: open.id, node: card } : null}
        onChange={flow.change}
        include={(q) => MEASURED_IDS.includes(q.id)}
        showMore={false}
        label={BODY.measuredTitle}
      />
      {started ? (
        <details className="lm-ik-fold" open={foldOpen || (open !== null && !MEASURED_IDS.includes(open.id))} onToggle={(e) => setFoldOpen(e.currentTarget.open)}>
          <summary>{BODY.answersTitle}</summary>
          <AnsweredList
            qs={qs}
            answers={state.answers}
            ctx={fctx}
            open={open && card && !MEASURED_IDS.includes(open.id) ? { id: open.id, node: card } : null}
            onChange={flow.change}
            include={(q) => !MEASURED_IDS.includes(q.id)}
            showMore={false}
            label={BODY.answersTitle}
          />
        </details>
      ) : null}
      {!started || flow.progress.done < flow.progress.total - (pending ? 1 : 0) ? (
        <div className="lm-ik-actions">
          <KeyLink to={intakePath('activity', { from: 'body' })} variant="quiet" size="sm">
            {started ? BODY.edit : BODY.start}
          </KeyLink>
        </div>
      ) : null}
      <p className="lm-sr" aria-live="polite" aria-atomic="true">
        {flow.announce}
      </p>
    </Faceplate>
  );
}

const MEASURED_IDS: readonly string[] = ['measuredEver', 'measured'];
