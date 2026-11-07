/**
 * Day-stamped engine snapshots for the living plan (contract request CR-L1, docs/SUITE_SPEC.md §10, docs/LIVING_PLAN.md).
 *
 * The classic snapshot (`RunOptions.captureSnapshot`) is the post-burn-in state and is valid only for runs of the same
 * horizon. A living plan needs the state at the START of an arbitrary plan day `k` (a weekly check-in) and must continue
 * from it with a horizon that changes as the plan goes on, so a day-stamped snapshot:
 *  - keeps absolute day/hour indices: the continuation compiles the WHOLE realised schedule from the plan's day 0 and its
 *    main loop starts at `k` (modules that remember day indices — e.g. composition's `deficitEndDay` — stay valid);
 *  - carries the core's 'blockStart' latch and the safety trace of days [0, k), so trailing windows see the same history;
 *  - is keyed WITHOUT the horizon (CR-L1). The series mask stays in the key: the latent state consumers use (bus signals,
 *    visceral fat — one VAT transition for every mask, D1-02 — and the safety trace) is mask-invariant
 *    (`reviewMaskInvariant.test.ts`, D8-01), but optional display geometry may still be advanced only when recorded, so a
 *    cross-mask restore stays rejected until equivalence is proven for every latent state (C7).
 *  - carries every module's structured state with absolute day indices, so training history, region peaks, dose and decay
 *    clocks continue from the confirmed state rather than restarting at the snapshot (D3-06).
 * Typed arrays whose length depends on the horizon (safety's per-day arrays) are restored as a prefix copy by the loop.
 * W2-core (C7/D4-04): the key includes the safety-trace layout and the loop restores a day-k snapshot only when it carries
 * the history of every trace field (the calendar energy-availability ledger included), so a snapshot captured before a
 * trace field existed is recomputed rather than continued with a NaN gap; the module states (safety's 28-day rings) are
 * structured clones as before.
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
 * Layout of a SafetyTrace: its field names in allocation order (C7/D4-04). Part of the day-stamped key, so a snapshot whose
 * trace prefix was captured under another set of trace fields (e.g. before the calendar energy-availability ledger) is a
 * different key and is never restored.
 */
export function traceLayout(trace: SafetyTrace): string {
  return fnv1a(Object.keys(trace).join(','));
}

/**
 * Validity key of a day-stamped snapshot: engine version, registry hash, parameter vector, profile input, module list, start
 * date, run mode, series mask, burn-in length, safety-trace layout and the day itself — not the horizon.
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
    `trace:${traceLayout(ctx.safetyTrace)}`,
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

/**
 * Capture the state at the start of `day` (allocation: one structured clone of every module state + trace prefix). Every
 * trace field gets its prefix; an alias field (D4-04 `eatingDayEa7` is the `ea7` array) shares its source's prefix copy.
 */
export function captureDaySnapshot(p: DaySnapshotParts): EngineSnapshot {
  const tracePrefix: Partial<Record<SafetyTraceKey, Float32Array>> = {};
  const copies = new Map<Float32Array, Float32Array>();
  for (const k of Object.keys(p.trace) as SafetyTraceKey[]) {
    const arr = p.trace[k];
    if (!arr) continue;
    let pre = copies.get(arr);
    if (!pre) {
      pre = arr.slice(0, p.day);
      copies.set(arr, pre);
    }
    tracePrefix[k] = pre;
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

/**
 * C7/D4-04: the trace fields of `trace` a day-`day` snapshot cannot restore — no prefix, or one that is not a Float32Array
 * of the snapshot's day count (lost in a lossy serialisation, captured by an older core). Empty = compatible. A day-0
 * snapshot needs no history. Allocation allowed (restore time).
 */
export function incompatibleTracePrefix(trace: SafetyTrace, snap: EngineSnapshot, day: number): SafetyTraceKey[] {
  if (day <= 0) return [];
  const pre = snap.tracePrefix;
  const out: SafetyTraceKey[] = [];
  for (const k of Object.keys(trace) as SafetyTraceKey[]) {
    if (!trace[k]) continue;
    const src: unknown = pre?.[k];
    // realm-independent type test (a snapshot may come back from a worker or a structured-clone store)
    if (Object.prototype.toString.call(src) !== '[object Float32Array]' || (src as Float32Array).length !== day) out.push(k);
  }
  return out;
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
