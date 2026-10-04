import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  Engraved,
  GradeBadge,
  Key,
  KeyBank,
  KeyLink,
  MQ,
  Notice,
  Page,
  Popover,
  formatNumber,
  toast,
  useMediaQuery,
  usePopover,
} from '@/components';
import { ActionBar, TopBar } from '@/app/shell';
import { paths } from '@/app/paths';
import { SafetyGate } from '@/features/onboarding';
import type { PlannerRequestV2 } from '@/engine/planner/domain/types';
import type { ConstraintDraft } from '@/state/plannerStore';
import { goalMetric } from './catalogue';
import { editGoals } from './commands';
import { fmtDate, fmtWeeks } from './format';
import { GoalsView } from './GoalsView';
import { RUNG_TITLE, isRung, kindFromParams, ladderOf, planOf, type PlanKind, type RungId } from './ladder';
import { usePlannerModel } from './model';
import { openRungAsScenario } from './openInSimulator';
import { checkpointFor, discardCheckpoint, type CheckpointState } from './plannerClient';
import { addDaysISO } from './request';
import { ResultsView, RungStart, lowestGrade, type LadderView } from './ResultsView';
import { ExhaustiveChip, RunView } from './RunView';
import { PlannerSafetyPanel } from './components/SafetyPanel';
import { setOpenResults, setPlannerVisible, startPlannerRun, useLadderRun } from './run';
import './planner.css';
import './ladder.css';

type View = 'redirect' | 'goals' | 'run' | 'results';

function viewOf(pathname: string): View {
  if (pathname.endsWith('/plan/goals')) return 'goals';
  if (pathname.endsWith('/plan/run')) return 'run';
  if (pathname.endsWith('/plan/results')) return 'results';
  return 'redirect';
}

const TIER_WORD = { S: 'quick', M: 'standard', L: 'thorough', X: 'exhaustive' } as const;
export const EXHAUSTIVE_HELP =
  'Searches for 15–60 minutes using all your processor cores. You can keep using Vitals.';

/**
 * The Planner (Feature 2): /plan (redirect) · /plan/goals · /plan/run · /plan/results?rung=hard|medium|easy|ideal&tab=….
 * Specs: design/screens/planner-goals.md, plan-ladder.md; safety: `SafetyGate feature="planner"`.
 */
export default function PlannerPage() {
  const model = usePlannerModel();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = viewOf(location.pathname);
  const desktop = useMediaQuery(MQ.lg);
  const { run } = model;
  const running = run.status === 'running' || run.status === 'stopping';
  const ladderRun = useLadderRun();
  // an exhaustive search for the same goals keeps the last plans on screen until it finishes ("update in place")
  const result =
    run.result ??
    (ladderRun.previous && (running || run.status === 'cancelled' || run.status === 'failed')
      ? ladderRun.previous
      : null);
  const replacing = !run.result && !!result;
  const v2 = ladderOf(result);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [checkpoint, setCheckpoint] = useState<{ hash: string; state: CheckpointState } | null>(null);
  const [discardSeen, setDiscardSeen] = useState(false);
  const best = usePopover();
  const evidence = usePopover();

  useEffect(() => {
    setPlannerVisible(true);
    setOpenResults(() => navigate(paths.planResults));
    return () => setPlannerVisible(false);
  }, [navigate]);

  // the run finished while its screen is open → show the plans
  useEffect(() => {
    if (view === 'run' && run.status === 'done') navigate(paths.planResults, { replace: true });
  }, [view, run.status, navigate]);

  const blockedReason =
    model.access.plannerAccess === 'blocked'
      ? 'The Planner is off for your safety answers.'
      : model.goals.length === 0
        ? 'Add at least one goal'
        : !model.body.complete
          ? 'Finish Your body first'
          : running
            ? 'Plans are being found'
            : undefined;

  const findPlans = useCallback(() => {
    if (blockedReason || !model.request || !model.hash) return;
    void startPlannerRun(model.request, model.hash);
    navigate(paths.planRun);
  }, [blockedReason, model.request, model.hash, navigate]);

  /** Tier X: started only from "Find the best possible plan"; runs in the background with a chip in the context bar. */
  const findBest = useCallback(
    (resumeKey?: string) => {
      if (blockedReason || !model.request || !model.hash) return;
      best.setOpen(false);
      void startPlannerRun(model.request, model.hash, { tier: 'X', ...(resumeKey ? { resumeKey } : {}) });
      toast(
        resumeKey
          ? 'Resuming the exhaustive search'
          : 'Exhaustive search started · you can keep using Vitals',
        { id: 'planner-x' },
      );
    },
    [blockedReason, model.request, model.hash, best],
  );

  // "Adopt some of these limits": the goal screen's limits change (one undoable edit), then a re-run finds a new ladder
  // with the request those limits build (the next render's request, hence the flag)
  const rerun = useRef(false);
  const adopt = (patch: Partial<ConstraintDraft>) => {
    if (!Object.keys(patch).length) return findPlans();
    editGoals([{ op: 'setLimits', patch }]);
    rerun.current = true;
  };

  useEffect(() => {
    if (!rerun.current) return;
    rerun.current = false;
    findPlans();
  }, [model.hash, findPlans]);

  // a stored exhaustive search for these goals (desktop): offer to resume it, or say an older one was set aside
  useEffect(() => {
    if (!desktop || running || !model.request || !model.hash) return;
    let alive = true;
    const hash = model.hash;
    void checkpointFor(model.request as PlannerRequestV2).then((state) => {
      if (!alive) return;
      setCheckpoint({ hash, state });
      // a checkpoint for other goals is set aside, never merged: delete it once the person has been told
      if (state.state === 'discarded') void discardCheckpoint(state.key).catch(() => undefined);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hash identifies the request
  }, [desktop, running, model.hash]);
  const cp = checkpoint && checkpoint.hash === model.hash && !running ? checkpoint.state : null;

  // ⌘/Ctrl + Enter on the goals screen (IA §7)
  useEffect(() => {
    if (view !== 'goals') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        findPlans();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, findPlans]);

  const selected: PlanKind = v2 ? kindFromParams(params, v2) : 'hard';
  const ladderView: LadderView = params.get('view') === 'table' ? 'table' : 'cards';
  const setView = (v: LadderView) => {
    const next = new URLSearchParams(params);
    if (v === 'table') next.set('view', 'table');
    else next.delete('view');
    setParams(next, { replace: true });
  };

  const openInSimulator = (kind: RungId) => {
    const p = v2?.rungs[kind];
    if (!p) return;
    const opened = openRungAsScenario(kind, p.summary.subtitle);
    if (!opened.sid) {
      toast('The plan could not be copied while a new search runs.', { id: 'planner-opened' });
      return;
    }
    toast(`${RUNG_TITLE[kind]} plan opened as a new scenario`, {
      id: 'planner-opened',
      action: {
        label: 'Undo',
        onClick: () => {
          // Leave the new scenario's screen first: deleting the scenario it shows makes the Simulator redirect to
          // another scenario, which would override the way back to the plans.
          void Promise.resolve(navigate(`${paths.planResults}?rung=${kind}`)).then(() =>
            window.setTimeout(() => opened.undo(), 50),
          );
        },
      },
    });
    navigate(paths.schedule(opened.sid));
  };

  if (view === 'redirect')
    return (
      <Navigate
        to={running && !result ? paths.planRun : result ? paths.planResults : paths.planGoals}
        replace
      />
    );
  if (view === 'run' && run.status === 'idle') return <Navigate to={paths.planGoals} replace />;
  if (view === 'results' && !result)
    return <Navigate to={running ? paths.planRun : paths.planGoals} replace />;

  const findKey = (size: 'md' | 'lg') => (
    <Key
      variant="signal"
      shape="pill"
      size={size}
      onClick={findPlans}
      disabledReason={blockedReason}
      shortcut={size === 'md' ? '⌘↵' : undefined}
      indicator={model.stale ? false : undefined}
    >
      {model.stale ? 'Find plans again' : 'Find plans'}
    </Key>
  );
  const endIso = addDaysISO(model.startDate, model.horizonDays - 1);
  const goalsCaption = `${model.goals.length} goal${model.goals.length === 1 ? '' : 's'} · ${fmtWeeks(model.horizonDays)}`;
  const chip = <ExhaustiveChip run={run} />;
  const resumeNotice =
    desktop && cp?.state === 'resume' ? (
      <Notice
        severity="info"
        layout="ruled"
        className="lp-notice"
        title={`Resume the exhaustive search${cp.fraction !== null ? ` · ${Math.round(cp.fraction * 100)} % done` : ''}`}
        actions={
          <Key size="sm" onClick={() => findBest(cp.key)} disabledReason={blockedReason}>
            Resume
          </Key>
        }
      >
        A long search for these goals was paused. It continues where it stopped.
      </Notice>
    ) : desktop && cp?.state === 'discarded' && !discardSeen ? (
      <Notice
        severity="info"
        layout="ruled"
        className="lp-notice"
        title="An earlier long search was for different goals, so it was set aside."
        onDismiss={() => setDiscardSeen(true)}
      />
    ) : null;

  if (view === 'goals') {
    return (
      <>
        <TopBar
          title="Plan"
          documentTitle="Plan · goals"
          params={
            <Engraved>{`${fmtWeeks(model.horizonDays)} · ${fmtDate(model.startDate)} → ${fmtDate(endIso)}`}</Engraved>
          }
          actions={
            <span className="lp-bar-actions">
              {chip}
              {result ? (
                <KeyLink to={paths.planResults} variant="quiet" size="sm" className="max-lg:hidden">
                  Last plans
                </KeyLink>
              ) : null}
              <span className="max-lg:hidden">{findKey('md')}</span>
            </span>
          }
        />
        <ActionBar>
          <div className="lp-actionbar-text">
            <Engraved>{goalsCaption}</Engraved>
          </div>
          {findKey('lg')}
        </ActionBar>
        <Page className="lp-page">
          <SafetyGate feature="planner" context={model.bodyContext} summary={false}>
            <PlannerSafetyPanel access={model.access} context={model.bodyContext} />
            {resumeNotice}
            <GoalsView model={model} onFindPlans={findPlans} />
          </SafetyGate>
        </Page>
      </>
    );
  }

  if (view === 'run') {
    return (
      <>
        <TopBar title="Plan" documentTitle="Finding plans" params={<Engraved>{goalsCaption}</Engraved>} />
        <Page className="lp-page">
          <SafetyGate feature="planner" context={model.bodyContext} summary={false}>
            <RunView model={model} onRetry={findPlans} />
          </SafetyGate>
        </Page>
      </>
    );
  }

  // results
  const lowest = lowestGrade(v2);
  const req = run.request ?? model.request;
  const weeks = Math.round((req?.horizonDays ?? model.horizonDays) / 7);
  const nGoals = req?.goals.length ?? model.goals.length;
  const searched = v2 ? v2.provenance.euUsed : (result?.provenance.euUsed ?? 0);
  const selPlan = v2 ? planOf(v2, selected) : null;
  const outcomes =
    (v2?.rungs.hard ?? v2?.rungs.medium ?? v2?.rungs.easy ?? v2?.ideal)?.summary.outcomes ?? [];
  return (
    <>
      <TopBar
        title="Plans for your goals"
        documentTitle="Plans"
        params={
          <span className="lp-bar-params">
            <Engraved>{`${nGoals} goal${nGoals === 1 ? '' : 's'} · ${weeks} weeks${searched ? ` · searched ${formatNumber(searched, 0)} plans` : ''}`}</Engraved>
            {lowest ? (
              <>
                <button
                  type="button"
                  className="lp-evidence-key"
                  {...evidence.triggerProps}
                  aria-label="Evidence behind these plans"
                >
                  <GradeBadge grade={lowest} size="sm" />
                  <span>evidence A–D ⓘ</span>
                </button>
                <Popover
                  open={evidence.open}
                  onOpenChange={evidence.setOpen}
                  anchorRef={evidence.anchorRef}
                  label="Evidence behind these plans"
                >
                  <div className="lp-evidence-pop">
                    <p className="lm-eng">how sure the model is, per goal</p>
                    <ul className="lp-plain-list">
                      {outcomes.map((o) => (
                        <li key={o.goal}>
                          {`${(goalMetric(o.metric)?.label ?? o.label).toLowerCase()} · grade ${o.grade}`}
                          {o.grade === 'D' ? ' — wide ranges, read the shape' : ''}
                        </li>
                      ))}
                    </ul>
                    <p className="lp-plain">
                      Grades describe the evidence; they never rank or weight the plans.
                    </p>
                    {v2 ? <p className="lm-eng">{`search: ${TIER_WORD[v2.provenance.tier]}`}</p> : null}
                  </div>
                </Popover>
              </>
            ) : null}
          </span>
        }
        actions={
          <span className="lp-bar-actions">
            {chip}
            {v2 && (v2.status === 'ok' || v2.status === 'noSafePlan') ? (
              <span className="max-lg:hidden">
                <KeyBank<LadderView>
                  size="sm"
                  label="Show the plans as"
                  value={ladderView}
                  onChange={setView}
                  options={[
                    { value: 'cards', label: 'cards' },
                    { value: 'table', label: 'table' },
                  ]}
                />
              </span>
            ) : null}
            <KeyLink to={paths.planGoals} variant="quiet" size="sm">
              Adjust goals
            </KeyLink>
            {desktop && v2 ? (
              <>
                <Key size="sm" variant="quiet" {...best.triggerProps} disabledReason={blockedReason}>
                  Find the best possible plan
                </Key>
                <Popover
                  open={best.open}
                  onOpenChange={best.setOpen}
                  anchorRef={best.anchorRef}
                  label="Find the best possible plan"
                  placement="bottom-end"
                >
                  <div className="lp-best-pop">
                    <p className="lp-plain">{EXHAUSTIVE_HELP}</p>
                    <Key
                      variant="signal"
                      shape="pill"
                      size="sm"
                      onClick={() => findBest()}
                      disabledReason={blockedReason}
                    >
                      Start the long search
                    </Key>
                  </div>
                </Popover>
              </>
            ) : null}
          </span>
        }
      />
      {v2 && selPlan && v2.status === 'ok' ? (
        <ActionBar>
          <div className="lp-actionbar-text">
            <Engraved>{`${RUNG_TITLE[selected]} selected`}</Engraved>
          </div>
          {isRung(selected) ? (
            <RungStart model={model} result={result!} v2={v2} kind={selected} replacing={replacing} />
          ) : v2.ideal ? (
            <Key onClick={() => setAdoptOpen(true)}>Adopt some of these limits</Key>
          ) : null}
        </ActionBar>
      ) : null}
      <Page className="lp-page">
        <SafetyGate feature="planner" context={model.bodyContext} summary={false}>
          {resumeNotice}
          <ResultsView
            model={model}
            result={result!}
            selected={selected}
            view={ladderView}
            onView={setView}
            onFindPlans={findPlans}
            onOpenInSimulator={openInSimulator}
            onAdopt={adopt}
            replacing={replacing}
            adoptOpen={adoptOpen}
            onAdoptOpen={setAdoptOpen}
          />
        </SafetyGate>
      </Page>
    </>
  );
}
