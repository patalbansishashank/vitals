/**
 * Run orchestration for the Simulator (task §6; MODEL_SPEC §8), as a projection: run state and results in memory,
 * the inputs of each scenario's last run persisted as `derived/sim:<scenarioId>` documents (boot cache and export key
 * `vitals.simulations`), so a reload recomputes the same projection; staleness compares the hash of those inputs with
 * the current ones.
 *
 * Runs start through the `sim.run` command (a read command whose job writes derived results); see
 * `./internal/simulation.ts` for the nominal-then-ensemble pipeline.
 *
 * Results engineer API:
 *   const sim = useSimulation(scenarioId);   // { status, phase, progress, result, bands, warnings, events, runId, stale, … }
 *   const { run, cancel, blockedReason } = useRunScenario(scenarioId);
 */
import { useCallback, useEffect, useMemo } from 'react';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/sim';
import '@/commands/defs/jobs'; // registers the commands the actions below dispatch
import { useSimulatorProfile } from '@/features/simulator/profile';
import { registerStore } from './persistence';
import { createProjection } from './projection';
import { createScope, runInScope } from './scope';
import { useScheduleStore } from './scheduleStore';
import * as sim from './internal/simulation';
import { SIMULATIONS_KEY, SIMULATIONS_VERSION, runHash, type LastRunInputs, type SimBands, type SimPhase, type SimStatus, type SimulationState } from './internal/simulationModel';
import type { SimEvent, SimWarning, SimulationResult } from '@/engine';

export {
  DRAW_CHUNK,
  ENSEMBLE_SEED,
  SIMULATIONS_KEY,
  SIMULATIONS_VERSION,
  computeBands,
  runHash,
  runProfile,
  type LastRunInputs,
  type RunOptions,
  type ScenarioRun,
  type SimBands,
  type SimPhase,
  type SimStatus,
  type SimulationState,
} from './internal/simulationModel';

/** Run writes are derived results (derive scope), not user edits. */
const derive = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => runInScope(createScope('derive', { label: 'simulation' }), () => fn(...a));

type Persisted = { lastRuns: Record<string, LastRunInputs> };
const PREFIX = 'sim:';

export const useSimulationStore = createProjection<SimulationState, Persisted>({
  name: 'simulations',
  key: SIMULATIONS_KEY,
  version: SIMULATIONS_VERSION,
  persistedFields: ['lastRuns'],
  creator: () => ({
    runs: {},
    lastRuns: {},
    run: derive(sim.run),
    cancel: derive((sid: string) => void sim.cancel(sid)),
    restore: derive(sim.restore),
    forget: derive(sim.forget),
  }),
  partialize: (s) => ({ lastRuns: s.lastRuns }),
  migrate: (persisted) => persisted as Persisted,
  merge: (persisted, current) => ({ ...current, ...(persisted ?? {}) }),
  binding: {
    owns: [],
    ownsPrefix: { derived: PREFIX },
    toDocs: (p) =>
      Object.entries(p.lastRuns).map(([sid, last]) => ({ col: 'derived' as const, id: `${PREFIX}${sid}`, body: { kind: 'sim', scenarioId: sid, ...last } as Record<string, unknown>, src: last })),
    fromDocs: (read) => {
      const docs = read.list('derived').filter((d) => d.id.startsWith(PREFIX));
      if (docs.length === 0) return null;
      const lastRuns: Record<string, LastRunInputs> = {};
      for (const { id, body } of docs) {
        const { kind: _k, scenarioId: _s, ...last } = body;
        lastRuns[id.slice(PREFIX.length)] = last as unknown as LastRunInputs;
      }
      return { lastRuns };
    },
  },
});

registerStore(SIMULATIONS_KEY, SIMULATIONS_VERSION, {
  label: 'last runs',
  describe: (s) => {
    const n = Object.keys((s as { lastRuns?: object })?.lastRuns ?? {}).length;
    return n ? `inputs of ${n} last run${n === 1 ? '' : 's'} (results are recomputed)` : null;
  },
  validate: (s) => !!s && typeof s === 'object' && typeof (s as { lastRuns?: unknown }).lastRuns === 'object',
  rehydrate: () => useSimulationStore.persist.rehydrate(),
});

/** Test helper. */
export function resetSimulationStore(): void {
  runInScope(createScope('system', { label: 'resetSimulationStore' }), sim.reset);
}

// ---------------------------------------------------------------- hooks

export interface SimulationView {
  status: SimStatus;
  phase: SimPhase | null;
  progress: number;
  /** Nominal run (the previous one while a new nominal is computing). */
  result: SimulationResult | null;
  bands: SimBands | null;
  warnings: readonly SimWarning[];
  events: readonly SimEvent[];
  runId: number;
  /** The shown result does not match the current profile + schedule (or a run is pending for newer inputs). */
  stale: boolean;
  /** True when a result exists for this scenario (possibly stale). */
  hasResult: boolean;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Hash of the inputs behind `result`; use as the AcknowledgeGate `scheduleHash`. */
  resultHash: string | null;
}

const EMPTY: readonly never[] = [];

/** Current input hash of a scenario (profile + schedule), memoised by object identity. */
export function useCurrentInputsHash(sid: string | undefined): string | null {
  const schedule = useScheduleStore((s) => (sid ? s.scenarios.find((x) => x.id === sid)?.schedule : undefined));
  const profile = useSimulatorProfile();
  return useMemo(() => (schedule ? runHash(profile, schedule) : null), [profile, schedule]);
}

export function useSimulation(scenarioId: string | undefined): SimulationView {
  const run = useSimulationStore((s) => (scenarioId ? s.runs[scenarioId] : undefined));
  const last = useSimulationStore((s) => (scenarioId ? s.lastRuns[scenarioId] : undefined));
  const restore = useSimulationStore((s) => s.restore);
  const hash = useCurrentInputsHash(scenarioId);

  useEffect(() => {
    if (scenarioId && !run && last) restore(scenarioId);
  }, [scenarioId, run, last, restore]);

  const shownHash = run?.resultHash ?? last?.hash ?? null;
  const stale = hash !== null && shownHash !== null && shownHash !== hash;
  return {
    status: run?.status ?? (last ? 'running' : 'idle'),
    phase: run?.phase ?? null,
    progress: run?.progress ?? 0,
    result: run?.result ?? null,
    bands: run?.bands ?? null,
    warnings: run?.result?.warnings ?? EMPTY,
    events: run?.result?.events ?? EMPTY,
    runId: run?.runId ?? 0,
    stale,
    hasResult: Boolean(run?.result),
    error: run?.error ?? null,
    startedAt: run?.startedAt ?? null,
    finishedAt: run?.finishedAt ?? null,
    resultHash: run?.resultHash ?? null,
  };
}

/** Run / cancel the current inputs of a scenario (profile from Your body, schedule from the scenario store). */
export function useRunScenario(scenarioId: string | undefined): { run: () => void; cancel: () => void } {
  const run = useCallback(() => {
    if (scenarioId) void sendCommand('sim.run', { scenarioId });
  }, [scenarioId]);
  const cancel = useCallback(() => {
    if (!scenarioId) return;
    const jobId = useSimulationStore.getState().runs[scenarioId]?.jobId;
    if (jobId) void sendCommand('job.cancel', { jobId });
    else useSimulationStore.getState().cancel(scenarioId);
  }, [scenarioId]);
  return { run, cancel };
}
