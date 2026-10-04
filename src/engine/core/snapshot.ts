/**
 * Day-stamped engine snapshots for the living plan (contract request CR-L1, docs/SUITE_SPEC.md §10, docs/LIVING_PLAN.md).
 *
 * The classic snapshot (`RunOptions.captureSnapshot`) is the post-burn-in state and is valid only for runs of the same
 * horizon. A living plan needs the state at the START of an arbitrary plan day `k` (a weekly check-in) and must continue
 * from it with a horizon that changes as the plan goes on, so a day-stamped snapshot:
 *  - keeps absolute day/hour indices: the continuation compiles the WHOLE realised schedule from the plan's day 0 and its
 *    main loop starts at `k` (modules that remember day indices — e.g. composition's `deficitEndDay` — stay valid);
 *  - carries the core's 'blockStart' latch and the safety trace of days [0, k), so trailing windows see the same history;
 *  - is keyed WITHOUT the horizon (CR-L1). The series mask stays in the key: composition's regional state is only
 *    advanced when a regional series is recorded, so a state captured with another mask is not the same state.
 * Typed arrays whose length depends on the horizon (safety's per-day arrays) are restored as a prefix copy by the loop.
 * The caller guarantees that days [0, k) of the continuation's schedule are the ones the snapshot was captured with
 * (the living plan hashes its logged inputs for that, `ConfirmedStateRecord.inputsHash`).
 */
import type { AnyEngineModule, ModuleContext } from '../types/module';
import type { ResolvedProfile } from '../types/profile';
import type { EngineSnapshot, SafetyTrace, SafetyTraceKey } from '../types/result';
import { SIGNAL_DEFS, type SignalBus } from '../types/signals';
import { ENGINE_VERSION } from './defaults';
import { fnv1a } from './math';

/** The core's 'blockStart' energy-reference latch (loop state outside the modules). */
export interface DayLatch {
  block: number;
  maintenanceKcal: number;
  bodyMassKg: number;
  ffmKg: number;
}

/**
 * Validity key of a day-stamped snapshot: engine version, registry hash, parameter vector, profile input, module list, start
 * date, run mode, series mask, burn-in length and the day itself — not the horizon.
 */
export function daySnapshotKey(
  profile: ResolvedProfile,
  startDate: string,
  modules: readonly AnyEngineModule[],
  values: Float64Array,
  ctx: ModuleContext,
  day: number,
): string {
  let v = '';
  for (let i = 0; i < values.length; i++) v += `${values[i]},`;
  let mask = '';
  for (let i = 0; i < ctx.seriesEnabled.length; i++) mask += ctx.seriesEnabled[i]!;
  return [
    'day',
    ENGINE_VERSION,
    ctx.params.registryHash,
    fnv1a(v),
    fnv1a(JSON.stringify(profile.input)),
    modules.map((m) => m.id).join(','),
    startDate,
    ctx.mode,
    fnv1a(mask),
    ctx.burnInDays ?? 0,
    `@${day}`,
  ].join('|');
}

/** Bus values in SIGNAL_DEFS order. */
export function busToArray(bus: SignalBus): Float64Array {
  const out = new Float64Array(SIGNAL_DEFS.length);
  const b = bus as unknown as Record<string, number>;
  for (let j = 0; j < SIGNAL_DEFS.length; j++) out[j] = b[SIGNAL_DEFS[j]!.name]!;
  return out;
}

/** Day mask (1 = capture at the start of that day) or null when nothing is requested; out-of-range days are ignored. */
export function captureDayMask(days: readonly number[] | undefined, nDays: number): Uint8Array | null {
  if (!days || days.length === 0) return null;
  const mask = new Uint8Array(nDays);
  let any = false;
  for (const d of days) {
    if (Number.isInteger(d) && d >= 0 && d < nDays) {
      mask[d] = 1;
      any = true;
    }
  }
  return any ? mask : null;
}

export interface DaySnapshotParts {
  key: string;
  day: number;
  modules: readonly AnyEngineModule[];
  states: readonly object[];
  bus: SignalBus;
  prevBedH: number;
  prevSleepH: number;
  t0WeightErrKg: number;
  latch: DayLatch;
  trace: SafetyTrace;
}

/** Capture the state at the start of `day` (allocation: one structured clone of every module state + trace prefix). */
export function captureDaySnapshot(p: DaySnapshotParts): EngineSnapshot {
  const tracePrefix: Partial<Record<SafetyTraceKey, Float32Array>> = {};
  for (const k of Object.keys(p.trace) as SafetyTraceKey[]) {
    const arr = p.trace[k];
    if (arr) tracePrefix[k] = arr.slice(0, p.day);
  }
  return {
    key: p.key,
    day: p.day,
    moduleIds: p.modules.map((m) => m.id),
    states: p.states.map((s) => structuredClone(s)),
    bus: busToArray(p.bus),
    prevBedH: p.prevBedH,
    prevSleepH: p.prevSleepH,
    t0WeightErrKg: p.t0WeightErrKg,
    latch: { block: p.latch.block, maintenanceKcal: p.latch.maintenanceKcal, bodyMassKg: p.latch.bodyMassKg, ffmKg: p.latch.ffmKg },
    tracePrefix,
  };
}

/** Copy a day-stamped snapshot's trace prefix into the run's (NaN-filled) safety trace. */
export function restoreTracePrefix(trace: SafetyTrace, snap: EngineSnapshot): void {
  const pre = snap.tracePrefix;
  if (!pre) return;
  for (const k of Object.keys(pre) as SafetyTraceKey[]) {
    const src = pre[k];
    const dst = trace[k];
    if (!src || !dst) continue;
    dst.set(src.length <= dst.length ? src : src.subarray(0, dst.length));
  }
}
