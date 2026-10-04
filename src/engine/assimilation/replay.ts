/**
 * Replay (docs/SUITE_SPEC.md §3.5 steps 1, 5, 6): the engine re-run of a living plan from day 0 (or from a cached
 * day-stamped snapshot) over the REALISED schedule — logged days replace the forecast days — with the stored anchors
 * (CR-L2) and the energy-balance bias δ (CR-L3). Deterministic: identical documents give identical replays on every
 * device, which is why only raw inputs and anchor records sync, never results.
 *
 * Every replay records the same series set (`REPLAY_SERIES`) so day-stamped snapshots captured by one replay restore into
 * the next (their key includes the series mask).
 */
import { compileSchedule } from '../core/compileSchedule';
import { runEngine } from '../core/loop';
import { resolveProfile } from '../core/resolveProfile';
import type { SeriesId } from '../types/metrics';
import type { PersonProfile } from '../types/profile';
import type { AnchorApplied, AnchorSpec, EngineSnapshot, IntakeOffset, SimulationResult } from '../types/result';
import type { Schedule } from '../types/schedule';

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
  /** End-of-day fat mass and lean tissue, kg. */
  fatKg: Float64Array;
  leanKg: Float64Array;
  anchorsApplied: AnchorApplied[];
  snapshots: Record<number, EngineSnapshot>;
}

export function runReplay(i: ReplayInput): ReplayOutput {
  const rp = resolveProfile({ ...i.profile, startDate: i.schedule.startDate });
  const compiled = compileSchedule(i.schedule, rp);
  const result = runEngine(rp, compiled, {
    record: i.record === 'none' ? 'none' : 'daily',
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
    fatKg: fat,
    leanKg: lean,
    anchorsApplied: anchors,
    snapshots: result.snapshots ?? {},
  };
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
