/**
 * Engine module contract (docs/MODEL_SPEC.md §1.0 and §3).
 *
 * A module owns: its parameters (ParamDefs), its state object, the signals it writes and the series it records.
 * It is a set of pure-ish functions over (state, constants, bus, inputs). Hot-path rules (§0.3):
 *  - `stepHour` and the day hooks must not allocate (no object/array literals, closures, spread, string building).
 *  - read parameters only in `prepare` (copy them into the constants object K; precompute exp(−dt/τ) factors).
 *  - read other modules' outputs only from the bus; write only the signals you own.
 */
import type { ResolvedProfile } from './profile';
import type { ModelParams, ParamDef } from './params';
import type { SignalBus, SignalName, ModuleId } from './signals';
import type { DayInput, HourInput, CompiledSchedule } from './inputs';
import type { SeriesId } from './metrics';
import type { SimEventType, SimWarning } from './events';
import type { SafetyTrace, StateBound } from './result';

export type RunMode = 'simulate' | 'planner';

/** Append-only, allocation-free event sink (typed-array ring owned by the core). */
export interface EventSink {
  emit(type: SimEventType, hourIndex: number, value: number): void;
}

/** Everything a module may read at prepare/init time (never mutated during the run). */
export interface ModuleContext {
  readonly profile: ResolvedProfile;
  readonly params: ModelParams;
  readonly schedule: CompiledSchedule;
  readonly nDays: number;
  readonly mode: RunMode;
  /** 1 when the series (by SERIES index) is requested; modules may skip costly metrics whose flag is 0. */
  readonly seriesEnabled: Uint8Array;
  readonly events: EventSink;
  /** Test mode: modules may run extra invariant checks (never in planner mode). */
  readonly checks: boolean;
  /** Daily safety arrays (length nDays) owned by the core, written only by the safety module (17 §2.1). */
  readonly safetyTrace: SafetyTrace;
  /**
   * Burn-in days run before day 0 on the habitual week (MODEL_SPEC §3.4; 0 = none). Always set by the core loop;
   * optional only so hand-built test contexts stay valid (treat undefined as 0).
   */
  readonly burnInDays?: number;
  /**
   * Planner early-abort bounds (RunOptions.abortOn, empty otherwise). The core checks series and SafetyTrace bounds itself
   * after every day; safety may additionally raise `safetyAbort` from its own evaluation. Optional for hand-built contexts.
   */
  readonly abortOn?: readonly StateBound[];
}

/** Collected once after the last day (allocation allowed). */
export interface FinalizeSink {
  warnings: SimWarning[];
}

/** Clock handed to every hook (one mutable instance per run). */
export interface StepClock {
  day: number;
  hourOfDay: number;
  hourIndex: number;
  /** 0 = Monday. */
  weekday: number;
}

/**
 * Metric frame: one Float64Array of length N_SERIES, indexed with `MI.<seriesId>`. Hourly-resolution series are
 * written in `recordHour`; daily series in `recordDay`. The recorder aggregates according to the catalogue.
 */
export type MetricFrame = Float64Array;

export interface EngineModule<S extends object = object, K extends object = object> {
  readonly id: ModuleId;
  /** MODEL_SPEC section implemented (e.g. '§1.5'). */
  readonly specSection: string;
  /** Owning dossier sections (documentation). */
  readonly dossiers: string;
  readonly params: readonly ParamDef[];
  readonly reads: readonly SignalName[];
  readonly writes: readonly SignalName[];
  readonly records: readonly SeriesId[];
  /** Copy parameters into constants; precompute decay factors. Called once per run (allocation allowed). */
  prepare(ctx: ModuleContext): K;
  /** Build the initial state from the profile and write initial values of owned signals. Allocation allowed. */
  init(k: K, ctx: ModuleContext, bus: SignalBus): S;
  /** Start of a simulated day (after the core has resolved the day's inputs). */
  startDay(s: S, k: K, bus: SignalBus, day: DayInput, clock: StepClock): void;
  /** Advance one hour. */
  stepHour(s: S, k: K, bus: SignalBus, hour: HourInput, day: DayInput, clock: StepClock): void;
  /** End of a simulated day (slow daily states). */
  endOfDay(s: S, k: K, bus: SignalBus, day: DayInput, clock: StepClock): void;
  /** Write hourly-resolution series for this hour. */
  recordHour(s: S, k: K, bus: SignalBus, out: MetricFrame): void;
  /** Write daily-resolution series (called after endOfDay). */
  recordDay(s: S, k: K, bus: SignalBus, out: MetricFrame): void;
  /** After the run: contribute warnings (safety) or other summaries. Allocation allowed. */
  finalize(s: S, k: K, sink: FinalizeSink): void;
  /**
   * Optional (MODEL_SPEC §3.4, review B3): called once, in module order, after the last burn-in day's `endOfDay`
   * (day −1) and before the t = 0 values are captured — also when `ctx.burnInDays` is 0. Energy calibrates NEAT0 here
   * over the last min(7, burnInDays) burn-in days; composition resets FM/LT/SM (and energy its FM0/FFM_act0
   * references) to the profile values; water re-anchors its labile-water references. Allocation allowed.
   */
  endBurnIn?(s: S, k: K, bus: SignalBus, ctx: ModuleContext): void;
}

/** Type-erased module for the registry (method bivariance makes any EngineModule<S, K> assignable). */
export type AnyEngineModule = EngineModule<object, object>;
