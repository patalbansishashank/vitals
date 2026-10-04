/**
 * Run options and results (docs/MODEL_SPEC.md §5.5, §8, §10).
 */
import type { SeriesId } from './metrics';
import type { RunMode } from './module';
import type { ConstraintMargin, SimEvent, SimWarning, WarningMargin } from './events';
import type { CompileNoteCode } from './inputs';

/**
 * 'full'  = daily series + hourly arrays for hourly-resolution series (Simulator).
 * 'daily' = daily series only (Planner search; hourly values still feed daily mean/min/max aggregation).
 * 'none'  = no series; only `final`, `safety` and events/warnings (benchmarks, feasibility probes).
 */
export type RecordMode = 'full' | 'daily' | 'none';

/** Keys of the daily SafetyTrace arrays (17 §2.1), usable as early-abort quantities. */
export type SafetyTraceKey = keyof SafetyTrace;

/**
 * Early-abort bound for planner mode (dossier 18 §4.1): abort when the daily sample crosses `value`. `series` names either a
 * recorded series (daily value per the catalogue aggregation; the core enables it) or a SafetyTrace quantity (e.g.
 * 'deficitPct7', 'rate14PctPerWk'; read after the day's `endOfDay`). The bounds are also handed to the modules as
 * `ModuleContext.abortOn`, so safety may raise `safetyAbort` from its own evaluation.
 */
export interface StateBound {
  series: SeriesId | SafetyTraceKey;
  op: '<' | '>';
  value: number;
  /** Label returned in `aborted.bound`. */
  id: string;
}

/**
 * Engine state right after burn-in and `endBurnIn` (MODEL_SPEC §3.4): every module's state, the signal bus and the loop's
 * carried sleep timing. Restoring it with `RunOptions.initialSnapshot` skips init + burn-in and gives bit-identical results
 * (tested). Valid only for the same profile, parameter vector, module list, start date, horizon (nDays), run mode, series
 * mask and burn-in length it was captured with — `key` encodes these and a mismatch throws. Treat as opaque and immutable
 * (it is structured-cloned on every restore); it can be posted to a worker.
 */
export interface EngineSnapshot {
  readonly key: string;
  readonly moduleIds: readonly string[];
  /** Module states in module order (structured-cloneable). */
  readonly states: readonly object[];
  /** Signal values in SIGNAL_DEFS order. */
  readonly bus: Float64Array;
  readonly prevBedH: number;
  readonly prevSleepH: number;
  /** Scale weight at t = 0 (midnight, after endBurnIn) minus the entered weight, kg (the O-5 check itself is taken at day 0's wake hour). */
  readonly t0WeightErrKg: number;
  /**
   * CR-L1 (living plan, docs/LIVING_PLAN.md): plan-day index whose START this state is (before that day's runtime energy
   * references and `startDay` hooks). Set only on snapshots from `RunOptions.captureSnapshotAt`; absent = the classic
   * post-burn-in snapshot. A day-stamped snapshot restores into a run of ANY horizon from the same start date (its key
   * excludes the horizon, not the series mask) and the run then starts its main loop at this day; the days before it are
   * not simulated again (their series are left at the recorder's fill value).
   */
  readonly day?: number;
  /** CR-L1: the core's 'blockStart' energy-reference latch at capture (block index, maintenance, body mass, FFM). */
  readonly latch?: { readonly block: number; readonly maintenanceKcal: number; readonly bodyMassKg: number; readonly ffmKg: number };
  /** CR-L1: the safety trace of days [0, day), restored so the continuation's trailing windows see the same history. */
  readonly tracePrefix?: Readonly<Partial<Record<SafetyTraceKey, Float32Array>>>;
}

/**
 * CR-L2 (living plan): re-anchor the tissue mass FM + FFM_act at the START of `day` (before capture, runtime references and
 * `startDay`). The residual `tissueMassKg − current` is allocated to fat and lean tissue by the composition module's own
 * partition (`split: 'engine'`, default: today's deficit energy share when the residual is a loss, the surplus share when
 * it is a gain) or so that the whole-body fat fraction FM/TM equals `fatFrac` (a DXA or clinical reading). Glycogen and
 * labile water are not touched (the trend filter's observation already has the engine's water terms removed). The jump is
 * exogenous: it is booked in `meta.anchors`, never as an energy flux, so the O-4/O-5 identities hold on both sides of it.
 */
export interface AnchorSpec {
  day: number;
  tissueMassKg: number;
  split?: 'engine' | { fatFrac: number };
}

/** One applied anchor (`SimulationMeta.anchors`): the mass moved and its energy content at the Hall densities ρF, ρL. */
export interface AnchorApplied {
  day: number;
  tissueBeforeKg: number;
  tissueAfterKg: number;
  dFatKg: number;
  dLeanKg: number;
  /** Lean-mass share of the residual actually used (0..1). */
  leanShare: number;
  /** ρF·ΔFM + ρL·ΔLT, kcal: energy the anchor added to (+) or removed from (−) the stores, outside the flux identities. */
  storedEnergyKcal: number;
}

/**
 * CR-L3 (living plan): absorbed-energy offset δ (kcal/d) from `fromDay` until the next entry, applied at the day's own macro
 * mix by scaling every meal of an eating day (zero-energy days are left alone). Excluded from the intake echo series
 * (`inEnergy`, `inProtein`, …), which keep the logged/prescribed values; the modules (appetite included) see the offset
 * intake — documented deviation from the CR-L3 wording, see docs/LIVING_PLAN.md.
 */
export interface IntakeOffset {
  fromDay: number;
  kcal: number;
}

export interface RunOptions {
  mode?: RunMode;
  record?: RecordMode;
  /** Restrict recording to these series (planner: goal metrics only). Default: all. */
  series?: readonly SeriesId[];
  /** Ensemble member: full parameter vector in registry order (MODEL_SPEC §8). */
  paramOverrides?: Float64Array;
  abortOn?: readonly StateBound[];
  /** Days of burn-in on the habitual diet before day 0 (01 §4.11, 05 §4.17). Default 14; 0 disables. */
  burnInDays?: number;
  /** Enable conservation assertions (tests). */
  checks?: boolean;
  collectEvents?: boolean;
  collectWarnings?: boolean;
  /**
   * Start from this post-burn-in state instead of running init + burn-in (planner: capture once per person/draw with
   * `captureSnapshot`, then reuse for every candidate schedule of the same horizon). See `EngineSnapshot` for validity.
   */
  initialSnapshot?: EngineSnapshot;
  /** Return the post-burn-in state as `result.snapshot` (allocation: one structured clone of every module state). */
  captureSnapshot?: boolean;
  /**
   * Compute the planner's state-space hard-constraint margins (MODEL_SPEC §7.3, §10.1) into `result.constraints` with
   * safety's `computeConstraintMargins(result.safety, person)`; same call the planner domain layer can make itself.
   */
  constraints?: boolean;
  /** CR-L1: capture the state at the START of each listed day into `result.snapshots[day]` (see `EngineSnapshot.day`). */
  captureSnapshotAt?: readonly number[];
  /** CR-L1: optional check — when given with a day-stamped `initialSnapshot` it must equal `initialSnapshot.day`. */
  startDay?: number;
  /** CR-L2: tissue-mass re-anchors (see `AnchorSpec`); at most one per day, applied in day order. */
  anchors?: readonly AnchorSpec[];
  /** CR-L3: energy-balance bias δ as an absorbed intake offset (see `IntakeOffset`). */
  intakeOffsetKcal?: readonly IntakeOffset[];
}

/**
 * Daily derived safety quantities (17 §2.1), always computed by `safety` (MODEL_SPEC §1.16, §7.2); the planner's constraint
 * hooks read these. **Fast-event days** (orchestrator ruling 2026-09-30 18:10, PROPOSED grade D): a calendar day with
 * ≥ `safety.fastDayMinHours` (12 h) inside a planned zero-intake span longer than T0 (meal to meal), and each graded-refeed
 * day of such a fast. Fasts at an opted-in tier are governed by the fasting-tier rules, so the 7-day floor/deficit
 * quantities below are taken over the NON-fast days of their window and are NaN on fast-event days.
 */
export interface SafetyTrace {
  /**
   * Intake the HC-E1 kcal floor applies to, kcal/d: the trailing 7-day mean over non-fast days; with a fast-event day in the
   * trailing `safety.fastRuleWindowD` (28) days the lower of that and the 28-day mean (`ei28`); on a fast-event day the
   * 28-day mean. Without planned fasts: the plain trailing 7-day mean intake.
   */
  ei7: Float32Array;
  /** Trailing 7-day mean TDEE over non-fast days, kcal/d (NaN on fast-event days). */
  tdee7: Float32Array;
  /** 100·(1 − EI_7/TDEE_7) over non-fast days, % (NaN on fast-event days). */
  deficitPct7: Float32Array;
  /**
   * Energy availability, kcal/kg FFM/d: the trailing 7-day mean of (EI − net exercise EE)/FFM (wellbeing's EA_7). With a
   * fast-event day in the trailing 7 days it is the mean of the last seven non-fast days searched back through the 28-day
   * window (daily samples clipped to safety.eaSampleMin/Max), and NaN on fast-event days (R-FAST-GATE).
   */
  ea7: Float32Array;
  /** Tissue mass TM = FM + FFM_act at the end of the day (no glycogen/water transients), kg. */
  tissueMassKg: Float32Array;
  /**
   * Rate of loss, kg/wk (positive = losing): −7 × OLS slope of tissue mass over the trailing 14 d, or over 28 d when a
   * fast-event day lies in the trailing 28 d (ruling 18:10: the loss-rate cap is evaluated on the tissue-mass trend).
   */
  rate14KgPerWk: Float32Array;
  /** `rate14KgPerWk` as % of the mean tissue mass of the same window per week. */
  rate14PctPerWk: Float32Array;
  /** (BW_0 − BW_t)/BW_0, % (BW = the day's wake-hour scale weight, BW_0 the entered weight). */
  cumLossPct: Float32Array;
  /** Projected BMI from tissue mass (17 "projected BMI": no glycogen/water swings), kg/m². */
  bmi: Float32Array;
  /** Body fat from tissue mass, 100·FM/TM, %. */
  bodyFatPct: Float32Array;
  /** Longest zero-intake run (≤ 50 kcal) ending on this day, h, and fasted hours in trailing 7 d. */
  fastHMax: Float32Array;
  fastH7: Float32Array;
  /** Protein per kg reference weight RW = min(BW, 27.5·H²), 7-day mean over non-fast days (NaN on fast-event days). */
  proteinGPerKgRw: Float32Array;
  /** Fat share of energy, 7-day mean over non-fast days, % (NaN on fast-event days). */
  fatPctEnergy: Float32Array;
  /** Hunger Pressure Index (appetite's HPI) at the end of the day, 0..100. */
  hungerIdx: Float32Array;
  /**
   * Trailing 7-day sum of session exercise energy expenditure EEE (net of RMR), kcal — the "exercise in the trailing 7 d"
   * gate of the energy-availability rules (HC-E4). Filled by the core's trace (optional in the type for hand-built traces).
   */
  eee7?: Float32Array;
  /** 1 on fast-event days (definition above), else 0 — why the 7-day quantities are NaN or use the 28-day window. */
  fastDay?: Float32Array;
  /** Trailing 28-day mean intake (all days), kcal/d — the second HC-E1 leg when a fast-event day lies in the window. */
  ei28?: Float32Array;
  /**
   * Fasted hours in the trailing 7 d that count toward the 108-h cumulative fasting cap (ruling R-T4CAP, final round
   * 2026-09-30): hours of fasts of tiers T1-T3 only — a single expert-tier fast (T4, 72-168 h) is governed by its own tier
   * rule (alone in its 28-day window, refeed days) — W-F13 and the HC-F2 margin use it. Optional in the type.
   */
  fastH7Cap?: Float32Array;
  /**
   * 100·(1 − EI_28/TDEE_28) over all days of the trailing 28 d, % (surplus < 0): with a fast-event day in that window the
   * surplus rules (W-S02, W-S03, HC-E8) also need a 28-day surplus (final round: eating at maintenance after a fast is
   * not a planned gain). Optional in the type.
   */
  deficitPct28?: Float32Array;
}

export interface SimulationMeta {
  engineVersion: string;
  registryHash: string;
  nDays: number;
  startDate: string;
  startWeekday: number;
  record: RecordMode;
  /** Series actually recorded (order of `daily`/`hourly` keys). */
  series: readonly SeriesId[];
  runtimeMs: number;
  aborted?: { day: number; bound: string; magnitude: number };
  compileNotes: ReadonlyArray<{ day: number; code: CompileNoteCode; message: string }>;
  /** CR-L1: first simulated day (> 0 only when restored from a day-stamped snapshot). */
  startDay?: number;
  /** CR-L2: anchors applied during the run, in day order. */
  anchors?: AnchorApplied[];
  /**
   * Present when RunOptions.checks (MODEL_SPEC §9.1 O-4/O-5), evaluated from module STATES, not from the fluxes alone:
   * hourly S_h = (ρF + ηF)·ΔFM + (ρL + ηL)·ΔLT with ΔFM/ΔLT from the published masses, signed deposition cost
   * ηF·ΔFM + ηL·ΔLT, glycogen flux ρG·Δ(G_L + G_M); daily EI − TEE (incl. signed deposition cost and DNL heat) − ρG·ΔG −
   * ketone loss = ρF·ΔFM + ρL·ΔLT; mass identity scale = FM + FFM_act + labile water.
   */
  checks?: {
    /** Worst hourly residual of the S_h, deposition-cost and glycogen-flux identities, kcal. */
    energyMaxAbsKcal: number;
    energyDayMaxAbsKcal: number;
    massMaxAbsKg: number;
    /**
     * O-5 (morning anchor, orchestrator ruling 2026-09-30): scale weight at the wake hour of day 0 minus the entered weight,
     * kg (tolerance 0.05). The entered weight is a morning (wake-hour, post-void, fasted) weight; the t = 0 state is anchored
     * so that a day 0 continuing the habitual pattern until the wake hour reads exactly it.
     */
    t0WeightErrKg?: number;
    /**
     * Scale weight at t = 0 itself (midnight after burn-in, kg): the entered morning weight plus the habitual overnight fall
     * to the wake hour. Baseline for hour-exact changes counted from t = 0 (e.g. a fast that starts at t = 0).
     */
    t0ScaleKg?: number;
    /** Components of `energyMaxAbsKcal`: S_h identity, signed deposition cost, glycogen flux vs state, kcal. */
    storageMaxAbsKcal?: number;
    depositionMaxAbsKcal?: number;
    glycogenMaxAbsKcal?: number;
    /** Whole-run totals, kcal: absorbed energy, TEE (incl. deposition cost and DNL heat), ΔE tissue + glycogen. */
    eiTotalKcal?: number;
    teeTotalKcal?: number;
    storedTotalKcal?: number;
  };
}

export interface SimulationResult {
  meta: SimulationMeta;
  /**
   * Value at t = 0 for every recorded series: the state after burn-in (midnight before day 0), except series aggregated at the
   * wake hour (`agg: 'wake'`: scale weight, DXA-lean, body fat, water detail), whose baseline is day 0's wake-hour value — the
   * entered morning weight (morning anchor, MODEL_SPEC §3.4).
   */
  initial: Partial<Record<SeriesId, number>>;
  /** Length nDays, per the catalogue's daily aggregation. */
  daily: Partial<Record<SeriesId, Float32Array>>;
  /** Length nDays·24; only for hourly-resolution series with record 'full'. */
  hourly: Partial<Record<SeriesId, Float32Array>>;
  /** Last value of every recorded series (planner terminal penalties). */
  final: Partial<Record<SeriesId, number>>;
  safety: SafetyTrace;
  events: SimEvent[];
  warnings: SimWarning[];
  /** Planner hard-constraint margins (RunOptions.constraints). */
  constraints?: ConstraintMargin[];
  /**
   * Planner margins per Simulator warning, at least as strict as the caution/danger rules (R-PLAN-SAFETY; computed with
   * `constraints`; mapping in `model/safety/constraints.ts computeWarningMargins`). Added final round (additive).
   */
  warningMargins?: WarningMargin[];
  /** Post-burn-in engine state (RunOptions.captureSnapshot). */
  snapshot?: EngineSnapshot;
  /** CR-L1: day-stamped states requested with `RunOptions.captureSnapshotAt` (key = plan day). */
  snapshots?: Record<number, EngineSnapshot>;
}

/** Ensemble summary produced by `simulateEnsemble` (MODEL_SPEC §8). */
export interface BandedResult {
  nominal: SimulationResult;
  draws: number;
  p10: Partial<Record<SeriesId, Float32Array>>;
  p50: Partial<Record<SeriesId, Float32Array>>;
  p90: Partial<Record<SeriesId, Float32Array>>;
  /**
   * 'draws' when computed from the ensemble, 'fallback' when the catalogue's fixed bands were used. For series presented
   * as change from baseline (catalogue `presentation: 'deltaFromBaseline'`) the percentiles are those of each member's
   * CHANGE from its own t = 0 value, re-based on the nominal t = 0 value — the band shows the spread of the change, not of
   * the (parameter-dependent) baseline.
   */
  method: Partial<Record<SeriesId, 'draws' | 'fallback' | 'none'>>;
}
