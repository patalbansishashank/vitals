/**
 * Simulator (IA §2): /simulate → the active scenario's schedule (creating one if none; `?view=…&m=…` deep links go to
 * results with the query kept); /simulate/:sid/schedule and /simulate/:sid/results. Context bar: scenario switcher,
 * schedule | results, horizon (desktop) and the yellow Run key with ring progress and the stale dot.
 * The results view (src/features/simulator/results) gates danger-level projections behind the acknowledgement.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Navigate, useLocation, useMatch, useNavigate, useParams } from 'react-router';
import { Square } from 'lucide-react';
import { ActionBar, TopBar, setNavBadge } from '@/app/shell';
import { paths } from '@/app/paths';
import { IconKey, Key, LinkBank, Notice, Page, RunKey, type RunKeyState } from '@/components';
import { SafetyGate, useSafetyAccess } from '@/features/onboarding';
import { useScenario } from '@/state/scheduleStore';
import { useBodyContext, useBodyValues } from '@/state/profileStore';
import { runProfile, useRunScenario, useSimulation, useSimulationStore } from '@/state/simulationStore';
import { HorizonPicker } from './components/HorizonPicker';
import { ScenarioSwitcher } from './components/ScenarioSwitcher';
import { ScenarioStartEntry } from '@/features/living/start/ScenarioStartEntry';
import { formatDateShort } from './lib/calendar';
import { stableStringify } from './lib/hash';
import { useSimulatorProfile } from './profile';
import ResultsView from './results/ResultsView';
import { ScheduleView } from './ScheduleView';
import { useResolvedProfile, useScheduleModel } from './useScheduleModel';
import { dispatchSync, outputOf } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import './simulator.css';

export default function SimulatePage() {
  const { sid } = useParams();
  if (!sid) return <SimulateRedirect />;
  return <ScenarioPage key={sid} sid={sid} />;
}

/** /simulate and unknown ids → the active scenario (created when there is none). */
function SimulateRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const id = outputOf(dispatchSync('scenario.ensureActive', {}))?.scenarioId ?? '';
    const q = new URLSearchParams(location.search);
    const toResults = q.has('view') || q.has('m') || q.has('explain');
    navigate(`${toResults ? paths.results(id) : paths.schedule(id)}${location.search}`, { replace: true });
  }, [navigate, location.search]);
  return null;
}

function useElapsed(running: boolean, startedAt: number | null): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);
  return running && startedAt ? Math.max(0, (now - startedAt) / 1000) : undefined;
}

function ScenarioPage({ sid }: { sid: string }) {
  const scenario = useScenario(sid);
  const results = Boolean(useMatch('/simulate/:sid/results'));
  const navigate = useNavigate();
  const profile = useSimulatorProfile();
  const resolved = useResolvedProfile(profile);
  const model = useScheduleModel(scenario?.schedule, resolved);
  const sim = useSimulation(scenario ? sid : undefined);
  const { run, cancel } = useRunScenario(sid);
  const last = useSimulationStore((s) => s.lastRuns[sid]);
  const bodyValues = useBodyValues();
  const bodyUpdatedAt = bodyValues.updatedAt;
  // reachable from the rail before setup is finished: say that the projection uses typical values, not yours
  const bodyMissing = [bodyValues.sex, bodyValues.ageYears, bodyValues.heightCm, bodyValues.weightKg].some((x) => x === null);
  // "Your body changed" (IA §5): the last run used a different body/habits/safety profile than Your body now has
  const bodyChanged = Boolean(
    last && scenario && stableStringify(last.profile) !== stableStringify(runProfile(profile, last.schedule)),
  );
  // the run profile also carries the screening outcome and opt-ins: say which one changed
  const onlySafetyChanged =
    bodyChanged &&
    last !== undefined &&
    stableStringify({ ...last.profile, safety: null }) === stableStringify({ ...runProfile(profile, last.schedule), safety: null });

  useEffect(() => {
    if (scenario) void sendCommand('scenario.setActive', { id: sid });
  }, [scenario, sid]);

  // Gentle mode (ED-risk answers, onboarding-safety.md §6.2): the app's untouched default scenario is a 12-week
  // deficit, which gentle mode must not lead with. Swap it, once, for the maintenance starter (undoable).
  const access = useSafetyAccess(useBodyContext());
  const gentle = access.ready && access.outcome.restrictions.includes('R1');
  const untouchedDefault = Boolean(
    scenario && scenario.id === 'starter' && scenario.name === 'Moderate deficit' && scenario.createdAt === scenario.updatedAt && !last,
  );
  useEffect(() => {
    if (!gentle || !untouchedDefault) return;
    void sendCommand('scenario.applyStarter', { id: sid, starter: 'maintenance8' });
    void sendCommand('scenario.rename', { id: sid, name: 'Maintenance + training' });
  }, [gentle, untouchedDefault, sid]);
  useEffect(() => {
    setNavBadge('simulate', sim.stale);
  }, [sim.stale]);
  useEffect(() => () => setNavBadge('simulate', false), []);

  const running = sim.status === 'running';
  const elapsed = useElapsed(running, sim.startedAt);
  const errors = model?.check.errorDays.length ?? 0;
  const disabledReason = !scenario?.started
    ? 'Paint at least one week first'
    : errors > 0
      ? `${errors} day${errors === 1 ? ' has' : 's have'} more macros than energy`
      : undefined;
  const runState: RunKeyState = running
    ? 'running'
    : sim.stale || (!sim.hasResult && sim.status !== 'idle')
      ? 'stale'
      : sim.hasResult
        ? 'idle'
        : 'idle';

  if (!scenario) return <Navigate to={paths.simulate} replace />;

  const onRun = () => {
    run();
    if (!results) navigate(paths.results(sid));
  };
  const progressStyle =
    running && sim.phase === 'ensemble' ? ({ '--sim-run-p': sim.progress } as CSSProperties) : undefined;
  const runKey = (size: 'md' | 'lg', caption?: string) => (
    <span className="sim-run">
      <RunKey
        onRun={onRun}
        state={runState}
        elapsed={elapsed}
        size={size}
        caption={caption}
        disabledReason={disabledReason}
        shortcut={size === 'md'}
        className="sim-runkey"
        data-progress={progressStyle ? 'true' : undefined}
        style={progressStyle}
      />
      {running ? (
        <IconKey
          size="sm"
          variant="quiet"
          icon={Square}
          label="Stop the run"
          onClick={cancel}
          className="sim-run__stop"
        />
      ) : null}
    </span>
  );

  // "Start this plan" (IA §4.7): the scenario becomes the active plan (rung 'custom') through the start sheet
  const startKey = (size: 'sm' | 'md') => (
    <ScenarioStartEntry
      size={size}
      scenario={{ id: scenario.id, name: scenario.name, schedule: scenario.schedule }}
      disabledReason={disabledReason}
    />
  );

  const tabs = (
    <LinkBank
      label="Simulator section"
      className="sim-tabs"
      items={[
        { to: paths.schedule(sid), label: 'schedule' },
        { to: paths.results(sid), label: 'results', badge: sim.stale, badgeLabel: 'out of date' },
      ]}
    />
  );

  return (
    <>
      <TopBar
        title={<ScenarioSwitcher current={scenario} />}
        documentTitle={`${scenario.name} · ${results ? 'results' : 'schedule'}`}
        tabs={tabs}
        params={
          <>
            {scenario.provenance ? <span className="sim-chip">{scenario.provenance}</span> : null}
            <HorizonPicker sid={sid} schedule={scenario.schedule} />
          </>
        }
        actions={
          // no caption: the horizon picker right beside it already reads "12 wk · 5 Oct → 27 Dec"
          <span className="sim-topactions max-lg:hidden">
            {startKey('md')}
            {runKey('md')}
          </span>
        }
      />
      <Page className="sim-page" data-view={results ? 'results' : 'schedule'}>
        <SafetyGate feature="simulator">
          <div className="sim-horizon-row lg:hidden">
            <HorizonPicker sid={sid} schedule={scenario.schedule} compact />
            {scenario.provenance ? <span className="sim-chip">{scenario.provenance}</span> : null}
          </div>
          {bodyMissing ? (
            <Notice
              severity="info"
              layout="ruled"
              className="sim-bodynotice"
              title="Your body isn't set up yet."
              actions={
                <Key size="sm" onClick={() => navigate(`${paths.body}?setup=basics`)}>
                  Set up Your body
                </Key>
              }
            >
              Projections use typical values for an adult until you enter your sex, age, height and weight.
            </Notice>
          ) : null}
          {bodyChanged && !results && !running ? (
            <Notice
              severity="info"
              layout="ruled"
              className="sim-bodynotice"
              title={
                onlySafetyChanged
                  ? 'Your safety answers or settings changed since the last run.'
                  : `Your body changed${bodyUpdatedAt ? ` on ${formatDateShort(bodyUpdatedAt.slice(0, 10))}` : ''} since the last run.`
              }
              actions={
                <Key size="sm" onClick={onRun} disabledReason={disabledReason}>
                  Run again
                </Key>
              }
            >
              {onlySafetyChanged
                ? 'The results and warnings still use the old answers. Run again to project from your current inputs.'
                : 'The results still show the old body. Run again to project from your current inputs.'}
            </Notice>
          ) : null}
          {results ? (
            <div className="sim-results">
              {/* ResultsView owns the danger acknowledgement, the "Simulation — not a recommendation" strip and the disclaimer */}
              <ResultsView scenarioId={sid} />
              <ActionBar>
                <div className="sim-ab__text">
                  <span className="lm-eng">
                    {running ? 'running' : sim.stale ? 'schedule changed since this run' : 'results'}
                  </span>
                  <b>{scenario.name}</b>
                </div>
                {startKey('sm')}
                {runKey('lg')}
              </ActionBar>
            </div>
          ) : (
            <ScheduleView scenario={scenario} profile={profile} runKey={runKey('lg')} />
          )}
        </SafetyGate>
      </Page>
    </>
  );
}
