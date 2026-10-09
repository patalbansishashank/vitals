/**
 * Intake v3 (`/onboarding/:section`; design/screens/onboarding-intake-v3.md, SUITE_SPEC §13.1): chapters — a normal
 * day, training and equipment, food and kitchen, blood markers (when its module is present), devices and data — each
 * an answered list in fixed order with the open question as a card in its place (Back · Ask me later · Next), the
 * parent answer as a chip on every follow-up, and a receipt at the end. Chapter A shows the maintenance result before
 * the two measured-energy questions. Returning opens the first unanswered question in the fixed order.
 * `?from=setup` is the first run (no tab bar, chapters in order, summary at the end); `?from=body` returns to Your body.
 * Every commit dispatches `intake.answer` (./persist.ts); nothing here computes physiology (./useMaintenance.ts).
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Engraved, Faceplate, Key, KeyLink, Notice, Page, toast, useReducedMotion } from '@/components';
import { ActionBar, TopBar, useChromeless } from '@/app/shell';
import { coachDraftState, useCoachAvailable } from '@/features/living/coach/availability';
import { isStorageAvailable } from '@/state/persistence';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { CHAPTER_QUESTIONS, CHAPTERS } from './chapters';
import { MAINTENANCE_RESULT_BEFORE } from './chapters/activity';
import { AnsweredList } from './components/AnsweredList';
import { ChapterProgress } from './components/ChapterProgress';
import { MaintenanceRail, MaintenanceResult, PictureFace } from './components/Maintenance';
import { QuestionCard } from './components/QuestionCard';
import { WIDGETS } from './components/widgets';
import { flowContextOf, useFlowContext } from './context';
import { A, BAR, CHAPTER_INTRO, CHAPTER_NAME, CHAPTER_SHORT, F, SUMMARY, TURN } from './copy';
import { turnsOf, useIntakeDoc } from './doc';
import { askedLater, frozenContext, initialFlow, isDone, skipChapter, visibleQuestions, type FlowContext, type Question } from './flow';
import { intakePath, isIntakeSection, type IntakeFrom } from './paths';
import { skipChapterSave } from './persist';
import { allChapterStates, askedLaterCount, chapterLine, chapterRows } from './summary';
import { useChapterFlow } from './useChapterFlow';
import { useLiveMaintenance } from './useMaintenance';
import { CHAPTER_ROUTE, SECTION_CHAPTER, type ChapterId, type IntakeDoc, type IntakeSectionId, type MeasuredEnergy } from './types';
import './intake.css';

const fromOf = (v: string | null): IntakeFrom | undefined => (v === 'setup' || v === 'body' ? v : undefined);

const MarkersChapterReceipt = lazy(() => import('./chapters/markersChapter').then((m) => ({ default: m.MarkersChapterReceipt })));

export default function IntakePage() {
  const { section } = useParams();
  const [params] = useSearchParams();
  const from = fromOf(params.get('from'));
  useChromeless(from === 'setup'); // first run: no tab bar (design §3)
  if (!isIntakeSection(section)) return <Navigate to={intakePath('activity', { from })} replace />;
  if (section === 'summary') return <SummaryView from={from} />;
  const chapter = SECTION_CHAPTER[section];
  if (!CHAPTERS.includes(chapter)) return <Navigate to={intakePath('activity', { from })} replace />;
  return <ChapterView key={chapter} chapter={chapter} section={section} from={from} />;
}

/* ------------------------------------------------------------------------------------------- shared bits */

type Shares = { fill: Partial<Record<ChapterId, number>>; later: Partial<Record<ChapterId, number>> };

function useChapterShares(doc: IntakeDoc, ctx: FlowContext): Shares {
  return useMemo(() => {
    const s = allChapterStates(doc, ctx);
    const fill: Partial<Record<ChapterId, number>> = {};
    const later: Partial<Record<ChapterId, number>> = {};
    for (const c of CHAPTERS) {
      const t = s[c].total;
      fill[c] = t ? (s[c].done - s[c].later.length) / t : 0;
      later[c] = t ? s[c].later.length / t : 0;
    }
    return { fill, later };
  }, [doc, ctx]);
}

function nextChapter(chapter: ChapterId): ChapterId | null {
  return CHAPTERS[CHAPTERS.indexOf(chapter) + 1] ?? null;
}

function nextPath(chapter: ChapterId, from: IntakeFrom | undefined): string {
  const next = nextChapter(chapter);
  return next ? intakePath(CHAPTER_ROUTE[next], { from }) : intakePath('summary', { from });
}

function backTarget(chapter: ChapterId, from: IntakeFrom | undefined): { to: string; label: string } {
  if (from === 'setup') {
    const i = CHAPTERS.indexOf(chapter);
    if (i === 0) return { to: '/body?setup=shape', label: BAR.backToBody };
    const prev = CHAPTERS[i - 1]!;
    return { to: intakePath(CHAPTER_ROUTE[prev], { from }), label: CHAPTER_NAME[prev] };
  }
  return { to: '/body#habits', label: BAR.backToBody };
}

/* ------------------------------------------------------------------------------------------- a chapter */

function ChapterView({ chapter, section, from }: { chapter: ChapterId; section: IntakeSectionId; from: IntakeFrom | undefined }) {
  const doc = useIntakeDoc();
  const sctx = useFlowContext(doc);
  const live = useMemo(() => flowContextOf(sctx), [sctx]);
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const energyUnit = useSettingsStore((s) => s.energyUnit);
  const qs = CHAPTER_QUESTIONS[chapter];
  const leave = backTarget(chapter, from);

  // a deep link (#steps, or /onboarding/kitchen) opens that question in change mode when it was already answered
  const hash = location.hash.slice(1);
  const anchor = hash || (section === 'kitchen' || section === 'supplements' ? section : '');
  const flow = useChapterFlow(chapter, qs, sctx, live, { anchor });
  const { state, active, changing, progress: prog } = flow;
  const ctx = useMemo(() => frozenContext(state.answers, live), [state.answers, live]);

  // ---- arrival: "Continuing at question 4 of 11" when the chapter was started before
  const [arrival] = useState(() => {
    const t = turnsOf(doc, chapter);
    if (!Object.keys(t.status).length || !active) return '';
    return TURN.continuing(prog.position, prog.total);
  });

  // ---- focus: the open card's prompt after every move (not on arrival: the shell focuses the title)
  const legendRef = useRef<HTMLLegendElement>(null);
  const first = useRef(true);
  const activeId = active?.id ?? null;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = legendRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.closest('fieldset')?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [activeId, changing, reduced]);

  // ---- live maintenance (chapter A answers in force; the draft while on chapter A)
  const activityAnswers = useMemo(() => (chapter === 'activity' ? state.answers : turnsOf(doc, 'activity')), [chapter, state.answers, doc]);
  const liveM = useLiveMaintenance(activityAnswers, ctx, energyUnit, chapter === 'activity');
  const shares = useChapterShares(doc, live);
  const curShares: Shares = {
    fill: { ...shares.fill, [chapter]: prog.total ? (prog.done - prog.skipped) / prog.total : 0 },
    later: { ...shares.later, [chapter]: prog.total ? prog.skipped / prog.total : 0 },
  };
  const laterCount = askedLaterCount(doc, live);
  const complete = active === null;
  const chat = useCoachAvailable();

  const onSkipPart = () => {
    const before = state;
    const next = skipChapter(qs, state, ctx);
    flow.replace(next, false);
    void skipChapterSave(chapter, next.answers, sctx);
    toast(BAR.skippedToast(CHAPTER_SHORT[chapter]), { action: { label: BAR.undo, onClick: () => flow.replace(initialFlow(before.answers)) } });
  };

  // "change" from the maintenance result: that question as a card in change mode, in this list
  const openQuestion = (id: string) => {
    const vis = visibleQuestions(qs, state.answers, ctx);
    const target = vis.find((q) => q.id === id) ?? (id === 'job' ? vis.find((q) => q.id === 'work') : undefined);
    if (target && isDone(state.answers, target.id)) flow.change(target.id);
    else if (target) document.getElementById(`ik-${target.id}`)?.scrollIntoView?.({ block: 'center' });
  };

  const visible = flow.visible;
  const card = active ? (
    <QuestionCard
      key={`${active.id}-${changing ? 'c' : 'a'}`}
      ref={legendRef}
      q={active}
      value={state.answers.status[active.id] === 'answered' ? state.answers.values[active.id] : undefined}
      values={state.answers.values}
      ctx={ctx}
      widgets={WIDGETS}
      position={visible.indexOf(active) + 1}
      total={visible.length}
      context={active.contextLine?.(state.answers.values, ctx) ?? null}
      changing={changing}
      intro={!changing && active === visible[0] ? CHAPTER_INTRO[chapter] : undefined}
      onCommit={(v) => flow.commit(active, v)}
      // the chapter's first card: Back leaves for where the title bar's back goes (the previous chapter, or the start)
      onBack={flow.canBack ? flow.back : () => navigate(leave.to)}
      onLater={!changing && active.askLater !== false ? () => flow.later(active) : undefined}
      onKeep={flow.keep}
      onCancel={changing ? flow.cancel : undefined}
      failed={flow.failed === active.id}
      onRetry={flow.retry}
      footnote={active.id === 'commuteMin' && ctx.stepDevice && state.answers.values.commute === 'walk' ? <p className="lm-ik-note">{A.commuteMin.deviceNote}</p> : undefined}
    />
  ) : null;

  // chapter A: the maintenance result sits before the measured-energy questions once everything before them is done
  const measuredAt = visible.findIndex((q) => q.id === MAINTENANCE_RESULT_BEFORE);
  const resultReady = chapter === 'activity' && measuredAt >= 0 && visible.slice(0, measuredAt).every((q) => isDone(state.answers, q.id));
  const result = resultReady ? (
    <MaintenanceResult
      m={liveM.summary.maintenance}
      view={liveM.view}
      unit={energyUnit}
      quiet={ctx.gentle}
      typicalBody={!liveM.summary.complete}
      measured={liveM.result.measured as MeasuredEnergy | undefined}
      onChangeAnswer={openQuestion}
    />
  ) : null;

  const later = askedLater(qs, state.answers, ctx);
  const answered = prog.done - prog.skipped;
  const next = nextChapter(chapter);
  const receipt =
    complete && !changing ? (
      <section className="lm-ik-receipt-end" aria-label={BAR.receiptTitle(CHAPTER_NAME[chapter])}>
        <div className="lm-ik-receipt-end__head">
          <h3 className="lm-ik-result__title">{BAR.receiptTitle(CHAPTER_NAME[chapter])}</h3>
          <span className="lm-ik-receipt-end__counts">{BAR.receiptCounts(answered, later.length)}</span>
        </div>
        <p className="lm-ik-note">{BAR.receiptLead}</p>
        {chapter === 'markers' ? (
          <Suspense fallback={null}>
            <MarkersChapterReceipt onChange={() => flow.change('has')} />
          </Suspense>
        ) : null}
        <div className="lm-ik-receipt-end__keys">
          {from === 'body' ? (
            <KeyLink to="/body#habits" variant="solid">
              {BAR.backToBody}
            </KeyLink>
          ) : (
            <KeyLink to={nextPath(chapter, from)} variant="solid">
              {next ? BAR.nextChapter(CHAPTER_SHORT[next]) : BAR.toSummary}
            </KeyLink>
          )}
          {later.length ? (
            <Key variant="quiet" onClick={() => flow.change(later[0]!.id)}>
              {BAR.reviewLater(later.length)}
            </Key>
          ) : null}
        </div>
      </section>
    ) : null;

  const pictureLines: Array<{ key: string; value: string }> = CHAPTERS.filter((c) => c !== 'activity').map((c) => ({ key: CHAPTER_SHORT[c], value: chapterLine(c, doc, live) ?? SUMMARY.notAnswered }));
  if (laterCount) pictureLines.push({ key: SUMMARY.askedLater, value: SUMMARY.askedLaterValue(laterCount) });

  return (
    <>
      <TopBar
        title={CHAPTER_NAME[chapter]}
        back={leave}
        progress={<ChapterProgress chapters={CHAPTERS} current={chapter} fill={curShares.fill} later={curShares.later} position={prog.position} total={prog.total} />}
        actions={
          !complete ? (
            <span className="max-lg:hidden">
              <Key variant="quiet" size="sm" onClick={onSkipPart}>
                {BAR.skipPart}
              </Key>
            </span>
          ) : undefined
        }
      />
      <ActionBar>
        <div className="lm-ik-actions" style={{ flex: 1, justifyContent: 'space-between' }}>
          {!complete ? (
            <Key variant="quiet" size="md" onClick={onSkipPart}>
              {BAR.skipPart}
            </Key>
          ) : (
            <span />
          )}
          <span className="lm-ik-row__label">{complete ? TURN.answeredOf(prog.done, prog.total) : TURN.questionOf(prog.position, prog.total)}</span>
        </div>
      </ActionBar>
      <Page>
        <div className="lm-ik" data-chapter={chapter}>
          <div className="lm-ik__col">
            {chapter === 'activity' ? <MaintenanceRail view={liveM.view} unit={energyUnit} quiet={ctx.gentle} /> : null}
            {chat && !complete ? (
              <p className="lm-ik-note">
                <KeyLink to="/coach" state={coachDraftState(BAR.chatDraft(CHAPTER_NAME[chapter]), { screen: 'intake', section })} size="sm" variant="quiet">
                  {BAR.chatInstead}
                </KeyLink>
              </p>
            ) : null}
            {!isStorageAvailable() ? <Notice severity="caution" title={BAR.storage} layout="ruled" /> : null}
            {chapter === 'food' && sctx.safety ? <MedicalLine doc={doc} /> : null}
            <Faceplate className="lm-ik-answers" title={TURN.answersTitle} titleAs="h2" caption={TURN.answersCount(prog.done, prog.total)}>
              <AnsweredList
                qs={qs}
                answers={state.answers}
                ctx={ctx}
                open={active && card ? { id: active.id, node: card } : null}
                onChange={flow.change}
                before={(q: Question) => (q.id === MAINTENANCE_RESULT_BEFORE ? result : null)}
                end={receipt}
                label={CHAPTER_NAME[chapter]}
              />
            </Faceplate>
            <p className="lm-sr" aria-live="polite" aria-atomic="true">
              {flow.announce || arrival}
            </p>
          </div>
          <aside className="lm-ik__aside" aria-label={SUMMARY.picture}>
            <PictureFace m={liveM.summary.maintenance} view={liveM.view} unit={energyUnit} quiet={ctx.gentle} lines={pictureLines} title={SUMMARY.picture} />
          </aside>
        </div>
      </Page>
    </>
  );
}

/** "From your safety answers: low sodium." — medical diets are read, never asked. */
function MedicalLine({ doc }: { doc: IntakeDoc }) {
  const diet = doc.diet;
  const items = diet && diet.rulesComplete ? diet.medicalDiet : [];
  if (!items.length) return null;
  return <p className="lm-ik-note">{F.medical(items.map((m) => F.medicalWords[m]).join(', '))}</p>;
}

/* ------------------------------------------------------------------------------------------- summary */

function SummaryView({ from }: { from: IntakeFrom | undefined }) {
  const doc = useIntakeDoc();
  const sctx = useFlowContext(doc);
  const ctx = useMemo(() => flowContextOf(sctx), [sctx]);
  const navigate = useNavigate();
  const energyUnit = useSettingsStore((s) => s.energyUnit);
  const setSetup = useProfileStore((s) => s.setSetup);
  const activity = useMemo(() => turnsOf(doc, 'activity'), [doc]);
  const live = useLiveMaintenance(activity, ctx, energyUnit, false);
  const shares = useChapterShares(doc, ctx);
  const states = allChapterStates(doc, ctx);
  const later = askedLaterCount(doc, ctx);
  const firstLater = CHAPTERS.flatMap((c) => states[c].later.map((q) => ({ c, q })))[0];
  const dateStyle = useSettingsStore((s) => s.dateStyle);
  const energy = ctx.gentle ? null : live.view.headline;
  const parts = CHAPTERS.map((c) => ({ c, rows: chapterRows(c, doc, ctx, { energy, dateStyle }) }));
  const finish = () => {
    if (from === 'setup') {
      setSetup('done');
      navigate('/body?setup=start');
    } else navigate('/body#habits');
  };
  const last = CHAPTERS[CHAPTERS.length - 1]!;
  const backTo = from === 'setup' ? { to: intakePath(CHAPTER_ROUTE[last], { from }), label: CHAPTER_NAME[last] } : { to: '/body#habits', label: BAR.backToBody };
  const answeredParts = CHAPTERS.filter((c) => states[c].complete).length;
  // the page's keys live in the shared action bar, once: Back (secondary) then the one primary key last. The screen has no
  // TopBar actions, so the bar is the foot bar above the tab bar on a phone and runs along the bottom of the content
  // column on desktop, where the status line sits on its left.
  const keys = (
    <>
      {from === 'setup' ? (
        <KeyLink to={backTo.to} variant="quiet">
          {BAR.back}
        </KeyLink>
      ) : null}
      <Key variant="solid" onClick={finish}>
        {from === 'setup' ? SUMMARY.continue : SUMMARY.backToBody}
      </Key>
    </>
  );
  return (
    <>
      <TopBar
        title={SUMMARY.title}
        back={backTo}
        progress={<ChapterProgress chapters={CHAPTERS} current={null} fill={shares.fill} later={shares.later} position={0} total={0} />}
      />
      <ActionBar>
        <div className="lm-ik-summary-actions">
          <Engraved className="max-lg:hidden">{SUMMARY.status(answeredParts, CHAPTERS.length, later)}</Engraved>
          <div className="lm-ik-summary-keys">{keys}</div>
        </div>
      </ActionBar>
      <Page>
        <div className="lm-ik-summary">
          <Faceplate className="lm-ik-summary__face" title={SUMMARY.title}>
            <p className="lm-ik__intro">{SUMMARY.lead}</p>
            <div className="lm-ik-parts">
              {parts.map(({ c, rows }) => (
                <section key={c} className="lm-ik-part" aria-labelledby={`ik-part-${c}`} data-unanswered={rows ? undefined : 'true'}>
                  <div className="lm-ik-part__head">
                    <h3 id={`ik-part-${c}`} className="lm-ik-part__name">
                      {CHAPTER_NAME[c]}
                    </h3>
                    <KeyLink className="lm-ik-part__change" to={intakePath(CHAPTER_ROUTE[c], { from })} variant="quiet" size="sm" aria-label={SUMMARY.changeLabel(CHAPTER_SHORT[c])}>
                      {rows ? SUMMARY.change : SUMMARY.answer}
                    </KeyLink>
                  </div>
                  {rows ? (
                    <dl className="lm-ik-part__rows">
                      {rows.map((r, i) => (
                        <div key={`${r.label}-${i}`} className="lm-ik-part__row" data-later={r.later || undefined}>
                          <dt>{r.label}</dt>
                          <dd>{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="lm-ik-part__none">{SUMMARY.notAnswered}</p>
                  )}
                </section>
              ))}
              {later > 0 && firstLater ? (
                <section className="lm-ik-part" aria-labelledby="ik-part-later">
                  <div className="lm-ik-part__head">
                    <h3 id="ik-part-later" className="lm-ik-part__name">
                      {SUMMARY.askedLater}
                    </h3>
                    <KeyLink className="lm-ik-part__change" to={intakePath(CHAPTER_ROUTE[firstLater.c], { from, anchor: firstLater.q.anchor ?? firstLater.q.id })} variant="quiet" size="sm">
                      {SUMMARY.answerNow}
                    </KeyLink>
                  </div>
                  <p className="lm-ik-part__none">{SUMMARY.askedLaterValue(later)}</p>
                </section>
              ) : null}
            </div>
          </Faceplate>
        </div>
      </Page>
    </>
  );
}
