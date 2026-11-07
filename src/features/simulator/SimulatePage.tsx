/**
 * Simulator (IA §2): /simulate → the active scenario's schedule (creating one if none; `?view=…&m=…` deep links go to
 * results with the query kept); /simulate/:sid/schedule and /simulate/:sid/results.
 *
 * Header (SPEC §4): the scenario switcher is the title, Schedule | Results are the header tabs, and the one ⋯ carries
 * the schedule tools' week and selection actions; Your body not set up and a non-standard safety mode are its status
 * icons (at most two with the running plan's; the rest in the ⋯). Nothing else sits in the title row, so the scenario's
 * name reads whole on a phone. The one Run key (ring progress, stale dot, Stop beside it
 * while running) is the schedule header's primary (r068 SC1, as Find plans is the Planner's), and heads the results
 * stage — beside a filled "Start this plan" once the projection is current, where it reads "Run again" (SR2) — or,
 * before the first run, is the empty results card's action (low on a phone, in the thumb zone). The results view (src/features/simulator/results) gates danger-level projections behind the acknowledgement.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Navigate, useLocation, useMatch, useNavigate, useParams } from 'react-router';
import { Square, UserRound } from 'lucide-react';
import { StatusCapsule, TopBar, setNavBadge, type MenuEntry } from '@/app/shell';
import { paths } from '@/app/paths';
import { IconKey, LinkBank, Page, RunKey, type RunKeyState } from '@/components';
import { SafetyGate, SafetyModeChip, useSafetyAccess } from '@/features/onboarding';
import { useScenario } from '@/state/scheduleStore';
import { useBodyContext, useBodyValues } from '@/state/profileStore';
import { useRunScenario, useSimulation, useSimulationStore } from '@/state/simulationStore';
import { HorizonPicker } from './components/HorizonPicker';
import { BaselineImprovementPanel } from './components/BaselineImprovementPanel';
import { ScenarioSwitcher } from './components/ScenarioSwitcher';
import { ScenarioStartEntry } from '@/features/living/start/ScenarioStartEntry';
import { useSimulatorProfile } from './profile';
import ResultsView from './results/ResultsView';
import { resultsState } from './results/lib/status';
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
  // reachable from the rail before setup is finished: the projection uses typical values, not yours. A changed body
  // needs no message of its own: it makes the run stale, which the Run key's dot and the Results tab already say.
  const bodyMissing = [bodyValues.sex, bodyValues.ageYears, bodyValues.heightCm, bodyValues.weightKg].some((x) => x === null);
  // the schedule tools' week and selection actions, for the header's one ⋯ (schedule tab only)
  const [toolMenu, setToolMenu] = useState<MenuEntry[]>([]);
  const onToolMenu = useCallback((entries: MenuEntry[]) => setToolMenu(entries), []);

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
  const runState: RunKeyState = running ? 'running' : sim.stale || (!sim.hasResult && sim.status !== 'idle') ? 'stale' : 'idle';

  if (!scenario) return <Navigate to={paths.simulate} replace />;

  const onRun = () => {
    run();
    if (!results) navigate(paths.results(sid));
  };
  const progressStyle =
    running && sim.phase === 'ensemble' ? ({ '--sim-run-p': sim.progress } as CSSProperties) : undefined;
  // the screen's one Run key (⌘/Ctrl + Enter), with Stop beside it while a run is going: on the schedule it is the
  // header's primary, where the Planner keeps Find plans (r068 SC1); on results it heads the results stage
  const runKey = (
    <span className="sim-run">
      {running ? (
        <IconKey size="sm" variant="quiet" icon={Square} label="Stop the run" onClick={cancel} className="sim-run__stop" />
      ) : null}
      <RunKey
        onRun={onRun}
        state={runState}
        elapsed={elapsed}
        disabledReason={disabledReason}
        shortcut
        className="sim-runkey"
        data-progress={progressStyle ? 'true' : undefined}
        style={progressStyle}
      />
    </span>
  );

  // Results before the first run: the Run key is the empty card's action (48 px); after that it heads the results
  // stage. Either way one Run key per screen state — ResultsScreen places the one it is given by its phase.
  const runInCard = results && resultsState(sim).phase === 'never-run';
  // "Start this plan" (IA §4.7): the scenario becomes the active plan (rung 'custom') through the start sheet — offered
  // once there is a current projection to start from. On a current projection it is the results' primary, and Run
  // steps back to an outlined "Run again" beside it (r068 SR2); stale results keep Run as the one thing to do.
  const fresh = sim.hasResult && !sim.stale;
  const startKey = fresh ? (
    <ScenarioStartEntry
      variant="primary"
      scenario={{ id: scenario.id, name: scenario.name, schedule: scenario.schedule }}
      disabledReason={disabledReason}
    />
  ) : null;
  // r068 W2-15: Run lives in the page header on both tabs ("Run again", quiet, once the projection is current); the
  // results' own head keeps only "Start this plan". Before the first run the empty card carries the one Run key.
  const resultsRunKey = runInCard ? <RunKey onRun={onRun} state={runState} disabledReason={disabledReason} shortcut size="lg" className="sim-runkey" /> : startKey;
  const headerRunKey = runInCard ? undefined : fresh && !running ? (
    <RunKey onRun={onRun} state={runState} label="Run again" disabledReason={disabledReason} shortcut className="sim-runkey" data-quiet="true" />
  ) : (
    runKey
  );

  const tabs = (
    <LinkBank
      label="Simulator section"
      className="sim-tabs"
      items={[
        { to: paths.schedule(sid), label: 'Schedule' },
        { to: paths.results(sid), label: 'Results', badge: sim.stale, badgeLabel: 'out of date' },
      ]}
    />
  );

  return (
    <>
      <TopBar
        title={<ScenarioSwitcher current={scenario} />}
        documentTitle={`${scenario.name} · ${results ? 'results' : 'schedule'}`}
        tabs={tabs}
        status={
          // a non-standard safety mode is a header status icon (its popover links to the details), never a page notice
          <>
            {bodyMissing ? <StatusCapsule icon={UserRound} label="Your body isn’t set up yet" attention to={`${paths.body}?setup=basics`} /> : null}
            <SafetyModeChip />
          </>
        }
        primary={results ? headerRunKey : runKey}
        menu={results ? undefined : toolMenu}
      />
      <Page className="sim-page" data-view={results ? 'results' : 'schedule'}>
        <SafetyGate feature="simulator" notice={false}>
          {results ? (
            <div className="sim-results">
              {/* ResultsView owns the danger acknowledgement, the "Simulation — not a recommendation" strip and the disclaimer */}
              <ResultsView scenarioId={sid} runAction={resultsRunKey} />
            </div>
          ) : (
            <>
              {/* Keep the horizon choices and date together before the full-width schedule. */}
              <div className="sim-horizon-row">
                <HorizonPicker sid={sid} schedule={scenario.schedule} />
              </div>
              <ScheduleView scenario={scenario} profile={profile} onMenu={onToolMenu} />
              <BaselineImprovementPanel key={scenario.updatedAt} scenario={scenario} />
            </>
          )}
        </SafetyGate>
      </Page>
    </>
  );
}
