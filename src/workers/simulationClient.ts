/**
 * Simulator ↔ engine worker bridge. The Simulator owns its own worker instances (a run worker and a preview worker)
 * so cancelling a run — which terminates the run worker — never touches the Planner's engine worker
 * (`engineClient.getEngine()`), and the coarse preview never queues behind an ensemble.
 *
 * `simulationStore` talks to the `SimulationClient` interface only; tests swap in a mock with
 * `setSimulationClient()`.
 */
import * as Comlink from 'comlink';
import type { PersonProfile, RunOptions, Schedule, SimulationResult } from '@/engine';
import type { DrawChunkSpec, DrawSeries, EngineWorkerApi } from './engine.worker';

export type { DrawChunkSpec, DrawSeries };

export interface PreviewSeries {
  /** Daily fat mass, kg. */
  fatMass: Float32Array;
  /** Daily ketosis state 0–4 (max of the day). */
  ketosis: Float32Array;
}

export interface SimulationClient {
  /** Nominal run (parameter draw −1), recorded in full for the Simulator. */
  runNominal(profile: PersonProfile, schedule: Schedule, options?: RunOptions): Promise<SimulationResult>;
  /** One chunk of ensemble draws (daily series only). */
  runDraws(profile: PersonProfile, schedule: Schedule, spec: DrawChunkSpec): Promise<DrawSeries[]>;
  /** Coarse nominal preview for the painter (fat mass + ketosis, daily). */
  preview(profile: PersonProfile, schedule: Schedule): Promise<PreviewSeries>;
  /** Stop in-flight run work now (terminates the run worker; the next call starts a fresh one). */
  cancel(): void;
}

interface WorkerHandle {
  worker: Worker;
  api: Comlink.Remote<EngineWorkerApi>;
}

function spawn(name: string): WorkerHandle {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name });
  return { worker, api: Comlink.wrap<EngineWorkerApi>(worker) };
}

function release(h: WorkerHandle | null): void {
  if (!h) return;
  h.api[Comlink.releaseProxy]();
  h.worker.terminate();
}

/** Default client backed by two module workers. */
export function createWorkerClient(): SimulationClient {
  let run: WorkerHandle | null = null;
  let prev: WorkerHandle | null = null;
  const runApi = () => (run ??= spawn('vitals-simulator')).api;
  const previewApi = () => (prev ??= spawn('vitals-simulator-preview')).api;
  return {
    runNominal: (profile, schedule, options) =>
      runApi().simulate(profile, schedule, options) as Promise<SimulationResult>,
    runDraws: (profile, schedule, spec) =>
      runApi().simulateDraws(profile, schedule, spec) as Promise<DrawSeries[]>,
    preview: async (profile, schedule) => {
      const r = (await previewApi().simulate(profile, schedule, {
        record: 'daily',
        series: ['fatMass', 'ketosisState'],
        collectEvents: false,
      })) as SimulationResult;
      const n = r.meta.nDays;
      return {
        fatMass: r.daily.fatMass ?? new Float32Array(n),
        ketosis: r.daily.ketosisState ?? new Float32Array(n),
      };
    },
    cancel: () => {
      release(run);
      run = null;
    },
  };
}

let client: SimulationClient | null = null;

export function getSimulationClient(): SimulationClient {
  return (client ??= createWorkerClient());
}

/** Replace the client (tests) or reset to the default (null). */
export function setSimulationClient(c: SimulationClient | null): void {
  client = c;
}

/** Ensemble size (MODEL_SPEC §8.1): 32 draws on desktop, 16 on phones. */
export function defaultDrawCount(): number {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse) and (max-width: 63.99rem)').matches
    )
      return 16;
  } catch {
    /* no matchMedia */
  }
  return 32;
}
