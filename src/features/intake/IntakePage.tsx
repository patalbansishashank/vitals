/**
 * Intake v3 (`/onboarding/:section`; design/screens/onboarding-intake-v3.md, SUITE_SPEC §13.1): chapters — a normal
 * day, training and equipment, food and kitchen, blood markers (when its module is present) — as a focused flow with
 * no tab bar. The header is the setup flow's one intake header, as on /welcome: Back, the centred chapter name and
 * the chapter segments (finished chapters filled, this one gold, no count), and its one ⋯ holding the chapter's own
 * actions: "Skip this part" and, with a Coach, "Answer by chatting instead". Each step: the open question as the hero
 * card and the step row (Back · Skip · Next, the one Skip being this question's) docked at the bottom on phones in its
 * own pill. The answers live in the chapter's receipt and in "What we'll use", where each row opens its question.
 * Chapter A shows the maintenance result before the two measured-energy questions. Returning opens the first
 * unanswered question in the fixed order. `?from=setup` is the first run (chapters in order, summary at the end);
 * `?from=body` returns to Your body. Every commit dispatches `intake.answer` (./persist.ts); nothing here computes
 * physiology (./useMaintenance.ts). */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Icon, KeyLink, Key, MonoMeta, MQ, Page, toast, useMediaQuery, useReducedMotion } from '@/components';
import { ActionBar, TopBar, useChromeless, type MenuEntry } from '@/app/shell';
import { coachDraftState, useCoachAvailable } from '@/features/living/coach/availability';
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
import { BAR, CHAPTER_NAME, CHAPTER_SHORT, F, SUMMARY, TURN, sentence } from './copy';
import { turnsOf, useIntakeDoc } from './doc';
import {
  askedLater,
  frozenContext,
  initialFlow,
  isDone,
  skipChapter,
  visibleQuestions,
  type FlowContext,
} from './flow';
import { intakePath, isIntakeSection, type IntakeFrom } from './paths';
import { skipChapterSave } from './persist';
import { allChapterStates, askedLaterCount, chapterLine, chapterRows } from './summary';
import { useChapterFlow } from './useChapterFlow';
import { useLiveMaintenance } from './useMaintenance';
import {
  CHAPTER_ROUTE,
  SECTION_CHAPTER,
  type ChapterId,
  type IntakeDoc,
  type IntakeSectionId,
  type MeasuredEnergy,
} from './types';
import './intake.css';

const fromOf = (v: string | null): IntakeFrom | undefined => (v === 'setup' || v === 'body' ? v : undefined);

const MarkersChapterReceipt = lazy(() =>
  import('./chapters/markersChapter').then((m) => ({ default: m.MarkersChapterReceipt })),
);

/** The two measured-energy questions: the maintenance result sits right above them. */
const MEASURED_IDS: readonly string[] = [MAINTENANCE_RESULT_BEFORE, 'measured'];

export default function IntakePage() {
  const { section } = useParams();
  const [params] = useSearchParams();
  const from = fromOf(params.get('from'));
  // a focused flow on every route: no tab bar, and the step row docks at the bottom on phones (SPEC §4)
  useChromeless(true);
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

function ChapterView({
  chapter,
  section,
  from,
}: {
  chapter: ChapterId;
  section: IntakeSectionId;
  from: IntakeFrom | undefined;
}) {
  const doc = useIntakeDoc();
  const sctx = useFlowContext();
  const live = useMemo(() => flowContextOf(sctx), [sctx]);
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  // desktop: Back · Skip · Next sit at the foot of the question card, in the same place on every step (r068 ON-1);
  // below 1024 px they dock at the bottom of the screen
  const desktop = useMediaQuery(MQ.lg);
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

  // ---- focus: the open card's prompt after every move (not on arrival: the shell focuses the title); the step (the
  // maintenance result when it leads, then the card) scrolls to the top under the header
  const legendRef = useRef<HTMLLegendElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
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
    (stepRef.current ?? el.closest('fieldset'))?.scrollIntoView?.({
      block: 'start',
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [activeId, changing, reduced]);

  // ---- live maintenance (chapter A answers in force; the draft while on chapter A)
  const activityAnswers = useMemo(
    () => (chapter === 'activity' ? state.answers : turnsOf(doc, 'activity')),
    [chapter, state.answers, doc],
  );
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
    toast(BAR.skippedToast(CHAPTER_SHORT[chapter]), {
      action: { label: BAR.undo, onClick: () => flow.replace(initialFlow(before.answers)) },
    });
  };

  // the chapter's own actions live in the header's one ⋯ (the step row keeps the one Skip, for this question): skip the
  // rest of the part, or answer in Coach
  const menu: MenuEntry[] = complete
    ? []
    : [
        { id: 'skip-part', label: BAR.skipPart, onSelect: onSkipPart },
        ...(chat
          ? [
              {
                id: 'chat-instead',
                label: BAR.chatInstead,
                onSelect: () =>
                  navigate('/coach', {
                    state: coachDraftState(BAR.chatDraft(CHAPTER_NAME[chapter]), {
                      screen: 'intake',
                      section,
                    }),
                  }),
              },
            ]
          : []),
      ];

  // "change" from the maintenance result: that question as the card in change mode
  const openQuestion = (id: string) => {
    const vis = visibleQuestions(qs, state.answers, ctx);
    const target = vis.find((q) => q.id === id) ?? (id === 'job' ? vis.find((q) => q.id === 'work') : undefined);
    if (target && isDone(state.answers, target.id)) flow.change(target.id);
    else if (target) document.getElementById(`ik-${target.id}`)?.scrollIntoView?.({ block: 'start' });
  };

  const visible = flow.visible;
  const card = active ? (
    <QuestionCard
      key={`${active.id}-${changing ? 'c' : 'a'}`}
      ref={legendRef}
      dock={!desktop}
      q={active}
      value={state.answers.status[active.id] === 'answered' ? state.answers.values[active.id] : undefined}
      values={state.answers.values}
      ctx={ctx}
      widgets={WIDGETS}
      context={active.contextLine?.(state.answers.values, ctx) ?? null}
      changing={changing}
      onCommit={(v) => flow.commit(active, v)}
      // the chapter's first card: Back leaves for where the header's Back goes (the previous chapter, or the start)
      onBack={flow.canBack ? flow.back : () => navigate(leave.to)}
      onLater={!changing && active.askLater !== false ? () => flow.later(active) : undefined}
      onKeep={flow.keep}
      onCancel={changing ? flow.cancel : undefined}
      failed={flow.failed === active.id}
      onRetry={flow.retry}
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
      headingLevel="h2"
      openQuestion={activeId}
      foldDrivers
    />
  ) : null;
  // it leads the step while one of the measured-energy questions is open; otherwise it follows the card or the receipt
  const resultFirst = result !== null && active !== null && !changing && MEASURED_IDS.includes(active.id);

  const later = askedLater(qs, state.answers, ctx);
  const next = nextChapter(chapter);
  const receiptTitle = BAR.receiptTitle(CHAPTER_NAME[chapter]);
  const receipt =
    complete && !changing ? (
      <section className="lm-ik-receipt-end lm-material" aria-labelledby="ik-receipt-title">
        <h2 className="lm-ik-result__title" id="ik-receipt-title">
          {receiptTitle}
        </h2>
        <p className="lm-ik-note">{BAR.receiptLead}</p>
        {/* the receipt is what was saved: the chapter's answers, open, each with Change */}
        <AnsweredList qs={qs} answers={state.answers} ctx={ctx} open={null} onChange={flow.change} label={CHAPTER_NAME[chapter]} />
        {chapter === 'markers' ? (
          <Suspense fallback={null}>
            <MarkersChapterReceipt onChange={() => flow.change('has')} />
          </Suspense>
        ) : null}
      </section>
    ) : null;
  // the chapter's last keys, in the step row's place: the next part (or Done back to Your body), and the skipped ones
  const endKeys = receipt ? (
    <ActionBar>
      <div className="lm-ik-nav" data-docked="true">
        <span className="lm-ik-nav__end">
          {later.length ? (
            <Key variant="outlined" onClick={() => flow.change(later[0]!.id)}>
              {BAR.reviewLater}
            </Key>
          ) : null}
          {from === 'body' ? (
            <KeyLink to="/body#habits" variant="primary">
              {BAR.done}
            </KeyLink>
          ) : (
            <KeyLink to={nextPath(chapter, from)} variant="primary">
              {next ? BAR.nextChapter(CHAPTER_SHORT[next]) : BAR.toSummary}
            </KeyLink>
          )}
        </span>
      </div>
    </ActionBar>
  ) : null;

  const pictureStates = allChapterStates(doc, live);
  const pictureLines: Array<{ key: string; value: string; state?: 'answered' | 'later' | 'empty' }> = CHAPTERS.filter((c) => c !== 'activity').map((c) => ({
    key: CHAPTER_SHORT[c], value: chapterLine(c, doc, live) ?? SUMMARY.notAnswered,
    state: !pictureStates[c].started ? 'empty' : pictureStates[c].later.length ? 'later' : 'answered',
  }));
  if (laterCount) pictureLines.push({ key: SUMMARY.askedLater, value: SUMMARY.askedLaterValue(laterCount) });

  return (
    <>
      <TopBar
        title={CHAPTER_NAME[chapter]}
        back={leave}
        menu={menu}
        progress={<ChapterProgress chapters={CHAPTERS} current={chapter} fill={curShares.fill} later={curShares.later} position={prog.position} total={prog.total} />}
      />
      {endKeys}
      <Page>
        <div className="lm-ik" data-chapter={chapter}>
          <div className="lm-ik__col">
            {chapter === 'activity' && !resultReady ? (
              <MaintenanceRail view={liveM.view} unit={energyUnit} quiet={ctx.gentle} />
            ) : null}
            {card ? (
              <div className="lm-ik-step" ref={stepRef}>
                {resultFirst ? result : null}
                {card}
              </div>
            ) : null}
            {receipt}
            {result && !resultFirst ? result : null}
            {chapter === 'food' && sctx.safety ? <MedicalLine doc={doc} /> : null}
            <p className="lm-sr" aria-live="polite" aria-atomic="true">
              {flow.announce || arrival}
            </p>
          </div>
          <aside className="lm-ik__aside" aria-label={SUMMARY.picture}>
            <PictureFace m={liveM.summary.maintenance} view={liveM.view} unit={energyUnit} quiet={ctx.gentle} lines={pictureLines} title={SUMMARY.picture} maintenance={result === null} />
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
  const sctx = useFlowContext();
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
  const setup = from === 'setup';
  const finish = () => {
    setSetup('done');
    navigate('/body?setup=start');
  };
  const last = CHAPTERS[CHAPTERS.length - 1]!;
  const backTo = setup ? { to: intakePath(CHAPTER_ROUTE[last], { from }), label: CHAPTER_NAME[last] } : { to: '/body#habits', label: BAR.backToBody };
  return (
    <>
      <TopBar
        title={SUMMARY.title}
        back={backTo}
        progress={<ChapterProgress chapters={CHAPTERS} current={null} fill={shares.fill} later={shares.later} position={0} total={0} />}
      />
      {/* first run only: Back and the one primary key, docked on phones; elsewhere the header's Back is the way out */}
      {setup ? (
        <ActionBar>
          <div className="lm-ik-nav">
            <KeyLink to={backTo.to} variant="outlined">
              {BAR.back}
            </KeyLink>
            <span className="lm-ik-nav__end">
              <Key variant="primary" onClick={finish}>
                {SUMMARY.continue}
              </Key>
            </span>
          </div>
        </ActionBar>
      ) : null}
      <Page>
        <div
          className={`lm-ik-summary${parts.every((part) => !part.rows) ? ' lm-material' : ''}`}
          data-empty={parts.every((part) => !part.rows) || undefined}
        >
          {parts.map(({ c, rows }) => (
            <section
              key={c}
              className={`lm-ik-part${parts.every((part) => !part.rows) ? '' : ' lm-material'}`}
              aria-labelledby={`ik-part-${c}`}
              data-unanswered={rows ? undefined : 'true'}
            >
              <div className="lm-ik-part__head">
                <h2 id={`ik-part-${c}`} className="lm-ik-part__name">
                  {CHAPTER_NAME[c]}
                </h2>
                <MonoMeta>{states[c].later.length ? 'Asked later' : rows ? 'Answered' : 'Not yet'}</MonoMeta>
              </div>
              {rows ? (
                <dl className="lm-ik-part__rows">
                  {rows.map((r, i) => (
                    <div key={`${r.label}-${i}`} className="lm-ik-part__row" data-later={r.later || undefined}>
                      <dt>{sentence(r.label)}</dt>
                      <dd>
                        {r.anchor ? (
                          // the whole row opens its question to change the answer (the link's target covers the row)
                          <Link className="lm-ik-part__link" to={intakePath(CHAPTER_ROUTE[c], { from, anchor: r.anchor })} aria-label={TURN.changeLabel(sentence(r.label), r.value)}>
                            <span>{r.value}</span>
                            <Icon icon={ChevronRight} size={16} />
                          </Link>
                        ) : (
                          r.value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="lm-ik-part__none">{SUMMARY.notAnswered}</p>
              )}
              <footer className="lm-ik-part__foot">
                <KeyLink
                  className="lm-ik-part__change"
                  to={intakePath(CHAPTER_ROUTE[c], { from })}
                  variant="text"
                  size="sm"
                  aria-label={SUMMARY.changeLabel(CHAPTER_SHORT[c])}
                >
                  {rows ? SUMMARY.change : SUMMARY.answer}
                </KeyLink>
              </footer>
            </section>
          ))}
          {later > 0 && firstLater ? (
            <section className="lm-ik-part lm-material" aria-labelledby="ik-part-later">
              <div className="lm-ik-part__head">
                <h2 id="ik-part-later" className="lm-ik-part__name">
                  {SUMMARY.askedLater}
                </h2>

              </div>
              <p className="lm-ik-part__none">{SUMMARY.askedLaterValue(later)}</p>
              <footer className="lm-ik-part__foot">
                <KeyLink
                  className="lm-ik-part__change"
                  to={intakePath(CHAPTER_ROUTE[firstLater.c], {
                    from,
                    anchor: firstLater.q.anchor ?? firstLater.q.id,
                  })}
                  variant="text"
                  size="sm"
                >
                  {SUMMARY.answerNow}
                </KeyLink>
              </footer>
            </section>
          ) : null}
        </div>
      </Page>
    </>
  );
}
