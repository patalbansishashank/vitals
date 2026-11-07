/**
 * Replay (docs/SUITE_SPEC.md §3.5 steps 1, 5, 6): the engine re-run of a living plan from day 0 (or from a cached
 * day-stamped snapshot) over the REALISED schedule — logged days replace the forecast days — with the stored anchors
 * (CR-L2) and the energy-balance bias δ (CR-L3). Deterministic: identical documents give identical replays on every
 * device, which is why only raw inputs and anchor records sync, never results.
 *
 * Every replay records the same series set (`REPLAY_SERIES`) so day-stamped snapshots captured by one replay restore into
 * the next (their key includes the series mask).
 *
 * D5-03: the output carries the realised correction ledger (`offsetsApplied`: requested vs actually applied kcal per day,
 * zero-energy days skipped with their reason) and the jump-free scale path, so estimators fit against the actual
 * application history under the same 'scaleWake' operator the forward replay uses (anchors are exogenous jumps, removed).
 *
 * A1-018: with `hourly` the run also keeps the hourly scale and labile-water paths, so an observation is compared with the
 * model at its own time (`sampleAt`): an exact instant reads the hour that contains it (no within-hour interpolation), an
 * interval reads the mean over its hours with their spread as an explicit range, and a date-only or untimed reading keeps
 * the day's wake sample as the declared daily convention (labelled `dateOnly`, never an exact instant).
 */
import { compileSchedule } from '../core/compileSchedule';
import { runEngine } from '../core/loop';
import { resolveProfile } from '../core/resolveProfile';
import type { SeriesId } from '../types/metrics';
import type { PersonProfile } from '../types/profile';
import type { AnchorApplied, AnchorSpec, EngineSnapshot, IntakeOffset, OffsetApplied, SimulationResult } from '../types/result';
import type { Schedule } from '../types/schedule';
import { CORRECTION_LAW_VERSION, CORRECTION_MECHANISM, intakeOffsetArray, offsetLedger } from './runHooks';

/** Series every replay records (the snapshot key depends on this set; change it only with a snapshot-cache bump). */
export const REPLAY_SERIES: readonly SeriesId[] = [
  'scaleWeight', 'waterWeight', 'glycogenWater', 'fatMass', 'leanTissue', 'bodyFatPct', 'waist', 'tdee', 'maintenance',
  'inEnergy', 'inProtein', 'inCarbs', 'inFat', 'inSteps', 'inSleep', 'inRtSets', 'inCardioMin', 'vo2max', 'strength',
];

export interface ReplayInput {
  /** The person at plan day 0 (`PlanDoc.baselineProfile`); its startDate is replaced by the schedule's. */
  profile: PersonProfile;
  /** Realised schedule, day 0 = plan start (`buildRealisedSchedule`). */
  schedule: Schedule;
  anchors?: readonly AnchorSpec[];
  intakeOffsets?: readonly IntakeOffset[];
  /** Start from this cached day-stamped snapshot (the schedule's days before its day must be the ones it saw). */
  from?: EngineSnapshot;
  captureAt?: readonly number[];
  record?: 'daily' | 'none';
  checks?: boolean;
  /** Ensemble member (forecast bands); snapshots are per parameter vector. */
  paramOverrides?: Float64Array;
  /** (A1-018) Also keep the hourly scale and labile-water paths (`scaleHourKg`, `waterHourKg`) for own-time operators. */
  hourly?: boolean;
}

export interface ReplayOutput {
  result: SimulationResult;
  /** First simulated day (the snapshot's day, else 0). */
  startDay: number;
  /** Per plan day: wake-hour scale, labile water and tissue mass (scale − water), kg; NaN before `startDay`. */
  scaleWakeKg: Float64Array;
  waterWakeKg: Float64Array;
  tissueWakeKg: Float64Array;
  /** Wake tissue with the jumps of this run's anchors removed (the engine's own dynamics only), kg. */
  tissuePathKg: Float64Array;
  /** Wake scale with the jumps of this run's anchors removed (the 'scaleWake' operator on the jump-free path), kg. */
  scalePathKg: Float64Array;
  /** End-of-day fat mass and lean tissue, kg. */
  fatKg: Float64Array;
  leanKg: Float64Array;
  anchorsApplied: AnchorApplied[];
  snapshots: Record<number, EngineSnapshot>;
  /** D5-03: requested vs actually applied correction for every simulated day with a non-zero request (days ≥ startDay). */
  offsetsApplied: OffsetApplied[];
  /** D5-03: the correction application law the run used. */
  correction: { mechanism: typeof CORRECTION_MECHANISM; lawVersion: number };
  /** (A1-018) Hourly scale and labile water, kg, index day·24 + hour (NaN before `startDay`); null unless `hourly`. */
  scaleHourKg: Float64Array | null;
  waterHourKg: Float64Array | null;
}

/** When an observation was taken, relative to its plan day (C1/A1-018; `ObservationSample` without the day). */
export interface ObservationTiming {
  precision: 'instant' | 'interval' | 'dateOnly' | 'unknown';
  /** Local clock hour 0–24 of an exact instant. */
  hour?: number;
  /** Start/end hour relative to the day (may exceed 24) of an interval. */
  hourSpan?: readonly [number, number];
}

/** A model quantity at an observation's own time: the value, the spread over an interval (SD, kg) and how it was read. */
export interface OwnTimeSample {
  kg: number;
  spreadSdKg: number;
  at: 'hour' | 'interval' | 'wakeConvention';
}

/**
 * (A1-018) An hourly model path at an observation's own time. Exact instant → the recorded hour containing it; interval →
 * mean and SD over its hours (an explicit range, no invented point); date-only/unknown/absent timing → the day's wake value
 * (the declared daily convention). Null when the timed value is not available (no hourly record, outside the run): the
 * caller abstains rather than silently using the wake value.
 */
export function sampleAt(hourly: Float64Array | null, wake: Float64Array, day: number, timing: ObservationTiming | undefined): OwnTimeSample | null {
  const fin = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);
  if (timing?.precision === 'instant' && fin(timing.hour)) {
    if (!hourly) return null;
    const v = hourly[day * 24 + Math.min(23, Math.max(0, Math.floor(timing.hour)))];
    return fin(v) ? { kg: v, spreadSdKg: 0, at: 'hour' } : null;
  }
  if (timing?.precision === 'interval' && timing.hourSpan && fin(timing.hourSpan[0]) && fin(timing.hourSpan[1])) {
    if (!hourly) return null;
    const lo = day * 24 + Math.floor(timing.hourSpan[0]);
    const hi = day * 24 + Math.max(Math.floor(timing.hourSpan[0]) + 1, Math.ceil(timing.hourSpan[1]));
    const xs: number[] = [];
    for (let k = Math.max(0, lo); k < Math.min(hourly.length, hi); k++) if (fin(hourly[k])) xs.push(hourly[k]!);
    if (xs.length === 0 || xs.length < hi - lo) return null;
    const m = xs.reduce((a, x) => a + x, 0) / xs.length;
    const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
    return { kg: m, spreadSdKg: Math.sqrt(v), at: 'interval' };
  }
  const w = wake[day];
  return fin(w) ? { kg: w, spreadSdKg: 0, at: 'wakeConvention' } : null;
}

export function runReplay(i: ReplayInput): ReplayOutput {
  const rp = resolveProfile({ ...i.profile, startDate: i.schedule.startDate });
  const compiled = compileSchedule(i.schedule, rp);
  const result = runEngine(rp, compiled, {
    record: i.record === 'none' ? 'none' : i.hourly ? 'full' : 'daily',
    series: REPLAY_SERIES,
    ...(i.anchors && i.anchors.length > 0 ? { anchors: i.anchors } : {}),
    ...(i.intakeOffsets && i.intakeOffsets.length > 0 ? { intakeOffsetKcal: i.intakeOffsets } : {}),
    ...(i.from ? { initialSnapshot: i.from } : {}),
    ...(i.captureAt && i.captureAt.length > 0 ? { captureSnapshotAt: i.captureAt } : {}),
    ...(i.checks ? { checks: true } : {}),
    ...(i.paramOverrides ? { paramOverrides: i.paramOverrides } : {}),
    collectWarnings: true,
  });
  const n = compiled.nDays;
  const start = result.meta.startDay ?? 0;
  const nan = () => new Float64Array(n).fill(Number.NaN);
  const scale = nan();
  const water = nan();
  const tissue = nan();
  const path = nan();
  const scalePath = nan();
  const fat = nan();
  const lean = nan();
  const sw = result.daily.scaleWeight;
  const ww = result.daily.waterWeight;
  const fm = result.daily.fatMass;
  const lt = result.daily.leanTissue;
  const anchors = result.meta.anchors ?? [];
  let jump = 0;
  let ai = 0;
  for (let d = start; d < n; d++) {
    while (ai < anchors.length && anchors[ai]!.day <= d) {
      jump += anchors[ai]!.tissueAfterKg - anchors[ai]!.tissueBeforeKg;
      ai++;
    }
    if (sw && ww) {
      scale[d] = sw[d]!;
      water[d] = ww[d]!;
      tissue[d] = sw[d]! - ww[d]!;
      path[d] = tissue[d]! - jump;
      scalePath[d] = sw[d]! - jump;
    }
    if (fm) fat[d] = fm[d]!;
    if (lt) lean[d] = lt[d]!;
  }
  return {
    result,
    startDay: start,
    scaleWakeKg: scale,
    waterWakeKg: water,
    tissueWakeKg: tissue,
    tissuePathKg: path,
    scalePathKg: scalePath,
    fatKg: fat,
    leanKg: lean,
    anchorsApplied: anchors,
    snapshots: result.snapshots ?? {},
    // the loop reports the ledger; otherwise rebuild it from the run's resolved days with the same law
    offsetsApplied: result.meta.offsetsApplied ?? offsetLedger(compiled.days, i.intakeOffsets && i.intakeOffsets.length > 0 ? intakeOffsetArray(i.intakeOffsets, n) : null, start, n),
    correction: { mechanism: CORRECTION_MECHANISM, lawVersion: CORRECTION_LAW_VERSION },
    scaleHourKg: i.hourly ? hourlyPath(result.hourly?.scaleWeight, n, start) : null,
    waterHourKg: i.hourly ? hourlyPath(result.hourly?.waterWeight, n, start) : null,
  };
}

/** A recorded hourly series as kg per absolute hour (NaN before the first simulated day), or null when not recorded. */
function hourlyPath(h: Float32Array | undefined, nDays: number, startDay: number): Float64Array | null {
  if (!h) return null;
  const out = new Float64Array(nDays * 24).fill(Number.NaN);
  for (let k = startDay * 24; k < Math.min(out.length, h.length); k++) out[k] = h[k]!;
  return out;
}

/** Tissue mass FM + FFM_act held by a snapshot (the state at the start of its day), kg. */
export function snapshotTissueKg(snap: EngineSnapshot): number {
  const i = snap.moduleIds.indexOf('composition');
  const s = (i >= 0 ? snap.states[i] : undefined) as { fmKg?: number; ltKg?: number; lt0Kg?: number; ffm0Kg?: number } | undefined;
  if (!s || s.fmKg === undefined || s.ltKg === undefined || s.lt0Kg === undefined || s.ffm0Kg === undefined) throw new Error('snapshot has no composition state');
  return s.fmKg + s.ffm0Kg + (s.ltKg - s.lt0Kg);
}

/** Fat mass held by a snapshot, kg. */
export function snapshotFatKg(snap: EngineSnapshot): number {
  const i = snap.moduleIds.indexOf('composition');
  const s = (i >= 0 ? snap.states[i] : undefined) as { fmKg?: number } | undefined;
  if (!s || s.fmKg === undefined) throw new Error('snapshot has no composition state');
  return s.fmKg;
}
