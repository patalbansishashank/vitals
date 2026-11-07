import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { History, UserRound } from 'lucide-react';
import { Key, MQ, Page, toast, useMediaQuery } from '@/components';
import { StatusCapsule, TopBar, type MenuEntry } from '@/app/shell';
import { paths } from '@/app/paths';
import { SafetyGate } from '@/features/onboarding';
import type { PlannerRequestV2 } from '@/engine/planner/domain/types';
import type { ConstraintDraft } from '@/state/plannerStore';
import { editGoals } from './commands';
import { fmtWeeks } from './format';
import { GoalsView } from './GoalsView';
import { RUNG_TITLE, kindFromParams, ladderOf, type PlanKind, type RungId } from './ladder';
import { usePlannerModel } from './model';
import { openRungAsScenario } from './openInSimulator';
import { checkpointFor, discardCheckpoint, type CheckpointState } from './plannerClient';
import { staleReason } from './request';
import { ResultsView, type LadderView } from './ResultsView';
import { ExhaustiveChip, RunView } from './RunView';
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

/** The header capsule while plans on screen were found for other inputs ("Find plans again" is the header's key). */
/** The stale results' status icon: why the plans shown are out of date (its name and tooltip; a press shows it). */
const STALE_CAPSULE = {
  body: 'Plans out of date: your body changed',
  safety: 'Plans out of date: safety settings changed',
  goals: 'Plans out of date: goals or limits changed',
} as const;

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
      : model.runnableGoalCount === 0
        ? model.goals.length
          ? 'Review goals · choose target'
          : 'Add at least one goal'
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

  /** Tier X: started only from the ⋯ "Find the best possible plan"; runs in the background with a header capsule. */
  const findBest = useCallback(
    (resumeKey?: string) => {
      if (blockedReason || !model.request || !model.hash) return;
      void startPlannerRun(model.request, model.hash, { tier: 'X', ...(resumeKey ? { resumeKey } : {}) });
      toast(resumeKey ? 'Long search resumed' : 'Long search started', { id: 'planner-x' });
    },
    [blockedReason, model.request, model.hash],
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

  // a stored exhaustive search for these goals (desktop): offered in the ⋯; one for other goals is set aside
  useEffect(() => {
    if (!desktop || running || !model.request || !model.hash) return;
    let alive = true;
    const hash = model.hash;
    void checkpointFor(model.request as PlannerRequestV2).then((state) => {
      if (!alive) return;
      setCheckpoint({ hash, state });
      // a checkpoint for other goals is set aside, never merged
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

  /* ---- the header: one primary key, one status capsule, the page's items of the one ⋯ ---- */
  const findKey = (
    <Key
      variant="primary"
      size="sm"
      onClick={findPlans}
      disabledReason={blockedReason}
      aria-keyshortcuts="Meta+Enter Control+Enter"
    >
      {model.stale ? 'Find plans again' : 'Find plans'}
    </Key>
  );
  const goalsCaption = `${model.goals.length} goal${model.goals.length === 1 ? '' : 's'} · ${fmtWeeks(model.horizonDays)}`;
  const xChip = <ExhaustiveChip run={run} />;
  const xRunning = running && ladderRun.tier === 'X';
  const resumeItem: MenuEntry[] =
    desktop && cp?.state === 'resume'
      ? [
          {
            id: 'resume',
            label: 'Resume the long search',
            hint: cp.fraction !== null ? `${Math.round(cp.fraction * 100)} %` : undefined,
            onSelect: () => findBest(cp.key),
            disabled: !!blockedReason,
          },
        ]
      : [];

  if (view === 'goals') {
    const status = xRunning ? (
      xChip
    ) : !model.body.complete ? (
      <StatusCapsule icon={UserRound} label="Your body isn’t finished yet" attention to={paths.body} />
    ) : undefined;
    return (
      <>
        <TopBar
          title="Plan"
          documentTitle="Plan · goals"
          status={status}
          primary={findKey}
          menu={[
            ...(result
              ? [{ id: 'last', label: 'Show the last plans', onSelect: () => navigate(paths.planResults) }]
              : []),
            ...resumeItem,
          ]}
        />
        <Page className="lp-page">
          <SafetyGate feature="planner" context={model.bodyContext} summary={false}>
            <GoalsView model={model} onFindPlans={findPlans} />
          </SafetyGate>
        </Page>
      </>
    );
  }

  if (view === 'run') {
    return (
      <>
        <TopBar title="Plan" documentTitle="Finding plans" subtitle={goalsCaption} />
        <Page className="lp-page">
          <SafetyGate feature="planner" context={model.bodyContext} summary={false}>
            <RunView model={model} onRetry={findPlans} />
          </SafetyGate>
        </Page>
      </>
    );
  }

  // results
  const req = run.request ?? model.request;
  const weeks = Math.round((req?.horizonDays ?? model.horizonDays) / 7);
  const nGoals = req?.goals.length ?? model.goals.length;
  const status = xRunning ? (
    xChip
  ) : model.stale ? (
    <StatusCapsule
      icon={History}
      label={STALE_CAPSULE[staleReason(model.run.request, model.request)]}
      attention
    />
  ) : undefined;
  return (
    <>
      <TopBar
        title="Plan"
        documentTitle="Plans"
        subtitle={`${nGoals} goal${nGoals === 1 ? '' : 's'} · ${weeks} weeks`}
        status={status}
        primary={model.stale ? findKey : undefined}
        menu={[
          { id: 'goals', label: 'Adjust goals', onSelect: () => navigate(paths.planGoals) },
          ...(desktop && v2
            ? [
                {
                  id: 'best',
                  label: 'Find the best possible plan',
                  hint: '15–60 min',
                  onSelect: () => findBest(),
                  disabled: !!blockedReason,
                },
              ]
            : []),
          ...resumeItem,
        ]}
      />
      <Page className="lp-page">
        <SafetyGate feature="planner" context={model.bodyContext} summary={false}>
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
