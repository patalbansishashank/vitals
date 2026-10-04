/**
 * Simulator results for one scenario — mounted by `SimulatePage` at `/simulate/:sid/results`.
 * Contract: default export, props `{ scenarioId }`. View state lives in the query string
 * (`?view=lanes|overlay|focus&m=<metricId>&z=…&xi=…&explain=…`, IA §2).
 *
 * Connects `ResultsScreen` to the stores: the run (`useSimulation`, `useRunScenario`), the inputs behind the shown
 * result (`lastRuns`), the scenario (name, horizon), unit/figure settings and the figure base from Your body.
 */
import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { paths } from '@/app/paths';
import { figureFrameOf, useProfileStore } from '@/state/profileStore';
import { useScheduleStore } from '@/state/scheduleStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useRunScenario, useSimulation, useSimulationStore, type LastRunInputs } from '@/state/simulationStore';
import { ResultsScreen, type ResultsPrefs } from './ResultsScreen';
import { addDaysISO } from './lib/format';

export interface ResultsViewProps {
  scenarioId: string;
}

/**
 * The inputs behind the result on screen. `lastRuns` switches to the new inputs as soon as a run starts, while the
 * previous result stays on screen until the new nominal arrives — so hold the last entry whose hash matches.
 */
function useShownInputs(sid: string, resultHash: string | null): LastRunInputs | null {
  const last = useSimulationStore((s) => s.lastRuns[sid]);
  const [held, setHeld] = useState<LastRunInputs | null>(null);
  if (last && last.hash === resultHash && held !== last) setHeld(last);
  if (resultHash && last?.hash !== resultHash && held?.hash === resultHash) return held;
  return last ?? null;
}

export default function ResultsView({ scenarioId }: ResultsViewProps) {
  const sim = useSimulation(scenarioId);
  const { run } = useRunScenario(scenarioId);
  const scenario = useScheduleStore((s) => s.scenarios.find((x) => x.id === scenarioId));
  const shown = useShownInputs(scenarioId, sim.resultHash);
  const settings = useSettingsStore(
    useShallow((s) => ({ units: s.units, energyUnit: s.energyUnit, glucoseUnit: s.glucoseUnit, showFigure: s.showFigure, chartPatterns: s.chartPatterns })),
  );
  // drawing-only frame of the figure (profile.figure.frame, or match my basics)
  const figureFrame = useProfileStore((s) => figureFrameOf(s));

  const prefs: ResultsPrefs = useMemo(
    () => ({
      units: settings.units,
      energyUnit: settings.energyUnit,
      glucoseUnit: settings.glucoseUnit,
      showFigure: settings.showFigure,
      textures: settings.chartPatterns,
      figureFrame,
    }),
    [settings, figureFrame],
  );
  const inputs = useMemo(() => (shown ? { profile: shown.profile, schedule: shown.schedule } : null), [shown]);

  const startDate = shown?.schedule.startDate ?? scenario?.schedule.startDate;
  const scheduleHref = useCallback(
    (opts?: { startDay?: number; endDay?: number; fix?: string }) => {
      if (opts?.startDay == null) return paths.schedule(scenarioId);
      const q = new URLSearchParams();
      // `day` (ISO date) opens the schedule's day editor on the first affected day (IA §2);
      // `days` + `fix` carry the whole affected range and the rule for the schedule to pre-select.
      const iso = startDate ? addDaysISO(startDate, opts.startDay) : null;
      if (iso) q.set('day', iso);
      q.set('days', `${opts.startDay}-${opts.endDay ?? opts.startDay}`);
      if (opts.fix) q.set('fix', opts.fix);
      return `${paths.schedule(scenarioId)}?${q}`;
    },
    [scenarioId, startDate],
  );

  return (
    <ResultsScreen
      scenarioId={scenarioId}
      scenarioName={scenario?.name ?? 'Scenario'}
      sim={sim}
      inputs={inputs}
      horizonDays={scenario?.schedule.horizonDays ?? shown?.schedule.horizonDays ?? 84}
      onRun={run}
      prefs={prefs}
      scheduleHref={scheduleHref}
    />
  );
}
