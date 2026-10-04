/**
 * Simulation model (pure): run state, bands, the persisted last-run inputs (`derived/sim:<scenarioId>` documents) and
 * the percentile reducer. Results live in memory only; what is persisted is the inputs of each scenario's last run, so
 * a reload recomputes the same projection.
 */
import type { PersonProfile, Schedule, SeriesId, SimulationResult } from '@/engine';
import { inputsHash } from '@/features/simulator/lib/hash';
import type { DrawSeries } from '@/workers/simulationClient';

export const SIMULATIONS_KEY = 'vitals.simulations';
export const SIMULATIONS_VERSION = 1;
/** Fixed ensemble seed (MODEL_SPEC §8.1: seed 1, same inputs → same bands). */
export const ENSEMBLE_SEED = 1;
/** Draws per worker round-trip: small enough to stream, large enough to amortise the call. */
export const DRAW_CHUNK = 4;

export type SimStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';
export type SimPhase = 'nominal' | 'ensemble';

export interface SimBands {
  p10: Partial<Record<SeriesId, Float32Array>>;
  p50: Partial<Record<SeriesId, Float32Array>>;
  p90: Partial<Record<SeriesId, Float32Array>>;
  /** Draws folded in so far (the nominal run is always included as one more member). */
  drawsDone: number;
  drawsTotal: number;
  complete: boolean;
  method: 'draws';
}

export interface ScenarioRun {
  runId: number;
  /** Hash of the inputs of the run in flight (or last finished). */
  hash: string;
  /** Hash of the inputs that produced `result` (a previous run's while a new nominal is computing). */
  resultHash: string | null;
  status: SimStatus;
  phase: SimPhase | null;
  /** 0..1 over nominal + draws. */
  progress: number;
  result: SimulationResult | null;
  bands: SimBands | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  /** The `sim.run` job driving this run (for `job.cancel`); absent for direct runs. */
  jobId?: string;
}

export interface LastRunInputs {
  hash: string;
  at: string;
  profile: PersonProfile;
  schedule: Schedule;
}

export interface RunOptions {
  draws?: number;
  seed?: number;
}

export interface SimulationState {
  runs: Record<string, ScenarioRun>;
  /** Persisted: inputs of each scenario's last run. */
  lastRuns: Record<string, LastRunInputs>;
  run: (sid: string, profile: PersonProfile, schedule: Schedule, opts?: RunOptions) => Promise<void>;
  cancel: (sid: string) => void;
  /** Recompute the last run's inputs when no result is in memory (after a reload). */
  restore: (sid: string) => void;
  forget: (sid: string) => void;
}

/** The profile a run uses: day 0 of the profile is the schedule's start (weekday alignment of the burn-in). */
export function runProfile(profile: PersonProfile, schedule: Schedule): PersonProfile {
  return profile.startDate === schedule.startDate ? profile : { ...profile, startDate: schedule.startDate };
}

export function runHash(profile: PersonProfile, schedule: Schedule): string {
  return inputsHash(runProfile(profile, schedule), schedule);
}

// ---------------------------------------------------------------- percentiles

function quantileSorted(s: Float64Array, n: number, p: number): number {
  if (n === 0) return Number.NaN;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

/**
 * P10/P50/P90 per day over the nominal run plus the draws (linear interpolation between order statistics, as
 * `simulateEnsemble`). Non-finite samples are ignored.
 */
export function computeBands(
  nominal: SimulationResult['daily'],
  draws: readonly DrawSeries[],
  drawsTotal: number,
): SimBands {
  const p10: SimBands['p10'] = {};
  const p50: SimBands['p50'] = {};
  const p90: SimBands['p90'] = {};
  const buf = new Float64Array(draws.length + 1);
  for (const id of Object.keys(nominal) as SeriesId[]) {
    const nd = nominal[id];
    if (!nd) continue;
    const a10 = new Float32Array(nd.length);
    const a50 = new Float32Array(nd.length);
    const a90 = new Float32Array(nd.length);
    for (let d = 0; d < nd.length; d++) {
      let n = 0;
      const v0 = nd[d]!;
      if (Number.isFinite(v0)) buf[n++] = v0;
      for (const r of draws) {
        const v = r[id]?.[d];
        if (v !== undefined && Number.isFinite(v)) buf[n++] = v;
      }
      const s = buf.subarray(0, n).sort();
      a10[d] = quantileSorted(s, n, 0.1);
      a50[d] = quantileSorted(s, n, 0.5);
      a90[d] = quantileSorted(s, n, 0.9);
    }
    p10[id] = a10;
    p50[id] = a50;
    p90[id] = a90;
  }
  return {
    p10,
    p50,
    p90,
    drawsDone: draws.length,
    drawsTotal,
    complete: draws.length >= drawsTotal,
    method: 'draws',
  };
}

