/** Shared setup for command tests: fresh document store, empty history, reset projections, an instant engine. */
import type { PersonProfile, Schedule, SimulationResult } from '@/engine';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { createDocumentStore, createMemoryBackend, type MemoryBackend } from '@/store';
import { DEFAULT_PLANNER, EMPTY_RUN, usePlannerStore } from '@/state/plannerStore';
import { useProfileStore } from '@/state/profileStore';
import { setDocumentStore } from '@/state/runtime';
import { useSafetyStore } from '@/state/safetyStore';
import { resetScheduleStore } from '@/state/scheduleStore';
import { withSystemWrite } from '@/state/scope';
import { DEFAULT_SETTINGS, useSettingsStore } from '@/state/settingsStore';
import { resetSimulationStore } from '@/state/simulationStore';
import { setSimulationClient, type SimulationClient } from '@/workers/simulationClient';
import { resetBusState, resetHistory, type Actor } from '..';

export const AI: Actor = { kind: 'ai', id: 'test-preset', conversationId: '01J00000000000000000000CNV', toolCallId: 'call-1' };
export const MCP: Actor = { kind: 'mcp', id: 'claude-desktop' };

export function fakeResult(nDays: number, startWeight = 80): SimulationResult {
  const weight = new Float32Array(nDays).map((_, d) => startWeight - d * 0.05);
  return {
    meta: { engineVersion: 't', registryHash: 'h', nDays, startDate: '2026-10-05', startWeekday: 0, record: 'full', series: ['scaleWeight'], runtimeMs: 1, compileNotes: [] },
    initial: { scaleWeight: startWeight },
    daily: { scaleWeight: weight },
    hourly: {},
    final: { scaleWeight: weight[nDays - 1] },
    safety: {},
    events: [],
    warnings: [],
  } as unknown as SimulationResult;
}

/** Resolves every run at once (nominal only; draws are empty). */
export function instantClient(): SimulationClient & { runs: Array<{ profile: PersonProfile; schedule: Schedule }> } {
  const runs: Array<{ profile: PersonProfile; schedule: Schedule }> = [];
  return {
    runs,
    runNominal: async (profile, schedule) => {
      runs.push({ profile, schedule });
      return fakeResult(schedule.horizonDays);
    },
    runDraws: async () => [],
    preview: async () => ({ fatMass: new Float32Array(1), ketosis: new Float32Array(1) }),
    cancel: () => undefined,
  };
}

export function freshState(options: { cleared?: boolean } = {}): { backend: MemoryBackend } {
  localStorage.clear();
  const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
  setDocumentStore(createDocumentStore({ backend, device: 'TESTDEVICE000001' }));
  resetHistory();
  resetBusState();
  withSystemWrite(() => {
    useProfileStore.getState().resetBody();
    useSafetyStore.getState().resetSafety();
    usePlannerStore.setState({ ...DEFAULT_PLANNER, run: EMPTY_RUN });
    useSettingsStore.setState({ ...DEFAULT_SETTINGS });
  });
  resetScheduleStore('2026-10-01');
  resetSimulationStore();
  setSimulationClient(instantClient());
  if (options.cleared) seedClearedSafety();
  return { backend };
}
