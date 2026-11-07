/**
 * Simulation model (pure): run state, bands, the persisted last-run inputs (`derived/sim:<scenarioId>` documents) and
 * the percentile reducer. Results live in memory only; what is persisted is the inputs of each scenario's last run, so
 * a reload recomputes the same projection.
 */
import type { PersonProfile, Schedule, SeriesId, SimulationResult } from '@/engine';
import { ensembleBands } from '@/engine/core/bands';
import { BAND_DAY_METHOD, BAND_EXCLUSION_REASONS, type BandAvailability, type BandMeta, type OutputStatus } from '@/lib/bodyContracts';
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

/**
 * A1-049: one channel's per-day member accounting in the shape the Simulator screen reads (`BandsLike['days']`): which days
 * have a usable range, the attempted/valid/excluded members, why members were excluded (from the first day each applies),
 * whether a day with excluded members shows the valid members' range (named so), and the members' conditional status.
 */
export interface SimBandDays {
  /** 1 = the day's P10–P90 is a usable range; 0 = none that day (whatever finite numbers its quantile slots hold). */
  available: Uint8Array;
  attempted: Uint16Array;
  valid: Uint16Array;
  excluded: Uint16Array;
  reasons: ReadonlyArray<{ code: string; fromDay: number; members: number }>;
  /** The producer offers, on days with excluded members (non-finite, forbidding status, abort), the valid members' range. */
  validOnly: boolean;
  /** The contributing members' conditional status (labelled scenario/limited paths retained) and its first day. */
  qualifier?: { status: OutputStatus; fromDay: number };
}

/** The screen's per-day accounting of one channel from the reducer's `BandAvailability` (A1-049). Pure. */
export function simBandDays(av: BandAvailability): SimBandDays {
  const n = av.method.length;
  const available = new Uint8Array(n);
  let validOnly = false;
  for (let d = 0; d < n; d++) {
    available[d] = av.method[d] !== BAND_DAY_METHOD.none ? 1 : 0;
    if (av.method[d] === BAND_DAY_METHOD.conditionalValid) validOnly = true;
  }
  const reasons: Array<{ code: string; fromDay: number; members: number }> = [];
  for (const code of BAND_EXCLUSION_REASONS) {
    const a = av.excludedBy[code];
    if (!a) continue;
    let from = -1;
    let members = 0;
    for (let d = 0; d < a.length; d++) {
      if (a[d]! > 0 && from < 0) from = d;
      if (a[d]! > members) members = a[d]!;
    }
    if (from >= 0) reasons.push({ code, fromDay: from, members });
  }
  return {
    available,
    attempted: new Uint16Array(n).fill(av.attempted),
    valid: av.valid,
    excluded: av.excluded,
    reasons,
    validOnly,
    ...(av.status !== 'estimated' ? { qualifier: { status: av.status, fromDay: av.fromDay ?? 0 } } : {}),
  };
}

export interface SimBands {
  /**
   * Compatibility quantiles of the series with at least one usable day; the others have no band (`bandMeta[id].method ===
   * 'none'`). Finite storage: a day's range is usable only where `days[id].available` (A1-049) says so.
   */
  p10: Partial<Record<SeriesId, Float32Array>>;
  p50: Partial<Record<SeriesId, Float32Array>>;
  p90: Partial<Record<SeriesId, Float32Array>>;
  /** Stochastic draws folded in so far. The nominal run is never a member of the quantiles (D8-02). */
  drawsDone: number;
  drawsTotal: number;
  complete: boolean;
  method: 'draws';
  /**
   * D8-02/C6: what each band is — a parameter-sensitivity range with unvalidated predictive coverage, the members that
   * contributed and the endpoint convention (change series re-based on the nominal t = 0 value). Never an 80 % prediction
   * interval. Optional only for bands built before 2026-10-18 (legacy meaning: `LEGACY_BAND_META`).
   */
  bandMeta?: Partial<Record<SeriesId, BandMeta>>;
  /**
   * A1-051: the producer's per-series method ('draws' | 'none'): an explicit 'none' suppresses that series' band whatever
   * arrays travel with it (never replaced by a display fallback). Optional only for bands built before 2026-10-19.
   */
  methodBySeries?: Partial<Record<SeriesId, 'draws' | 'none'>>;
  /** A1-049: per-series, per-day availability, counts, reasons and member status (the reducer's contract form). */
  bandDays?: Partial<Record<SeriesId, BandAvailability>>;
  /** A1-049: the same accounting in the screen's form (`BandsLike['days']`). */
  days?: Partial<Record<SeriesId, SimBandDays>>;
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

/**
 * P10/P50/P90 per day over the stochastic draws only (D8-02): the same reducer as `simulateEnsemble` (`core/bands.ts`,
 * linear interpolation between order statistics), so both give identical bands and metadata for the same members. The
 * nominal run supplies the series list and, for change-from-baseline series, the t = 0 value the members' changes are
 * re-based on (`nominalInitial`; without it those series get no band). The nominal values never enter the quantiles; a
 * series no draw contributes to has no band (`methodBySeries` 'none', A1-051). A1-049: the draws arrive as member envelopes
 * (status, validity, abort), and the per-day accounting travels as `bandDays` and, for the screen, `days`.
 */
export function computeBands(
  nominal: SimulationResult['daily'],
  draws: readonly DrawSeries[],
  drawsTotal: number,
  nominalInitial?: SimulationResult['initial'],
): SimBands {
  const b = ensembleBands(nominal, nominalInitial, draws);
  const days: Partial<Record<SeriesId, SimBandDays>> = {};
  for (const id of Object.keys(b.bandDays) as SeriesId[]) days[id] = simBandDays(b.bandDays[id]!);
  return {
    p10: b.p10,
    p50: b.p50,
    p90: b.p90,
    drawsDone: draws.length,
    drawsTotal,
    complete: draws.length >= drawsTotal,
    method: 'draws',
    bandMeta: b.bandMeta,
    methodBySeries: b.method,
    bandDays: b.bandDays,
    days,
  };
}

