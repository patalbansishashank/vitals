/**
 * Run options and results (docs/MODEL_SPEC.md §5.5, §8, §10).
 */
import type { BandAvailability, BandMeta, CausalResolution, OutputStatus, UncertaintyKind } from '@/lib/bodyContracts';
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

/** Independent daily exposure-knowledge codes; zero/legacy absence is unknown, never confirmed zero. */
export const EA_EXPOSURE_COVERAGE = { unknown: 0, partial: 1, complete: 2, confirmedZero: 3, scenario: 4 } as const;
/** Session coverage alone is a named conditional scope, separate from exhaustive actual-day exercise. */
export const EA_EXERCISE_SCOPE = { unknown: 0, actualDay: 1, coveredSessions: 2, prescribedScenario: 3 } as const;

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
  /** C7: `CONTRACT_FINGERPRINT` (plus any semantics key) at capture; a mismatch must never be restored. */
  readonly contracts?: string;
  /** D7-02: measured t = 0 lab anchors of the run (day-stamped snapshots), so a resumed run reports the same anchors. */
  readonly observedAnchors?: readonly ObservedAnchor[];
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
  /**
   * D5-03: how the correction is applied. 'absorbedMacroImputation' (the only implemented law, = absent) scales the day's
   * meals; it is an imputed-intake scenario, never an expenditure offset, and legacy offsets keep this meaning.
   */
  mechanism?: 'absorbedMacroImputation';
  /** D5-03: the requested residual before controller bounds, kcal/d, and the decision that set it. */
  requestedKcal?: number;
  decisionId?: string;
}

/** D5-03: what an offset actually did on one day (zero-energy days are left alone, so A is flat there). */
export interface OffsetApplied {
  day: number;
  requestedKcal: number;
  appliedKcal: number;
  skippedReason?: 'zeroEnergyDay';
}

/**
 * D1-08: domain validity of a run, separate from clinical danger and numeric abort. A numerical floor crossing terminates
 * the run with `modelLimit` and the last fully conserved hour (`validThroughHour`); later days are not scored.
 */
export interface DomainValidity {
  status: 'valid' | 'modelLimit' | 'outsideDomain';
  validThroughHour?: number;
  reasonCode: string;
  /** Fixture/challenge bookkeeping kept apart: protocol fidelity, parameter-fit checks, external prediction. */
  protocolFidelity?: 'matched' | 'mismatched' | 'unknown';
  version: number;
}

/**
 * Status of one recorded series in a run (C6): numbers and statuses travel separately; a forbidding status makes the
 * series' finite compatibility values invisible to objectives and UI (D1-05, D7-02, D7-07/08/09, D8-05, D8-08).
 */
export interface SeriesStatusMeta {
  status: OutputStatus;
  reasonCode: string;
  /** First plan day the status applies from (absent = whole run). */
  fromDay?: number;
  uncertaintyKind?: UncertaintyKind;
  resolution?: CausalResolution;
  /** (A1-013) An induced status: the root output whose status it inherits (its reason is then `dependsOn:<root>`). */
  inducedBy?: string;
  /** (A1-013) The root output's own reason code, kept beside an induced status. */
  rootReason?: string;
}

/** D7-02: an accepted measured value used exactly as the t = 0 anchor (never clamped into a plausible replacement). */
export interface ObservedAnchor {
  series: SeriesId;
  value: number;
  unit: string;
  observationId?: string;
  /** Outside the model's calibration domain: the value stays visible, its projection is unavailable or scenario-only. */
  outOfDomain: boolean;
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
  /**
   * D3-04/D3-05/D3-08/D8-02 (A1-065): explicitly selected structural modes, by parameter id → value, for parameters whose
   * draw kind is fixed (e.g. `muscle.growthScenarioUnknown` 1 = progress, `muscle.eDistMode` 1 = legacy,
   * `activity.epocRt` 0.05). Applied to the nominal run AND to every ensemble member vector (direct and chunked), so a band
   * is conditional on the same structure as its nominal path; stochastic parameters keep their declared sampling law.
   * Absent = production modes. Part of request/cache/snapshot keys and echoed in `SimulationMeta`/`BandedResult`.
   */
  structuralModes?: Readonly<Record<string, number>>;
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

  // ---- contract additions 2026-10-18 (D4-04, D8-04, D4-05; optional, allocated only by a core that computes them)
  /** D4-04: explicit alias of the legacy eating-day statistic `ea7` (non-fast-day mean of clipped samples). */
  eatingDayEa7?: Float32Array;
  /** D4-04: calendar EA_n = Σ(EI − EEE_net)/Σ FFM_act over the available days of the trailing 7 / 28, kcal/kg FFM/d (unclipped). */
  calendarEa7?: Float32Array;
  calendarEa28?: Float32Array;
  /** D4-04: days with known intake inside each calendar window (no zero-padding of unknown history). */
  eaCoverage7?: Float32Array;
  eaCoverage28?: Float32Array;
  /** D4-04/D8-04: the daily ledger: EI (ME) kcal, net session EEE kcal, FFM_act kg at the documented sample, raw daily EA. */
  eiKcal?: Float32Array;
  eeeNetKcal?: Float32Array;
  ffmActKg?: Float32Array;
  eaRawDaily?: Float32Array;
  /** A2-022: independent intake and exercise knowledge; values use EA_EXPOSURE_COVERAGE. Absent means legacy/unknown. */
  eaIntakeCoverage?: Float32Array;
  eaExerciseCoverage?: Float32Array;
  /** A2-022: scope of the exercise channel, encoded with EA_EXERCISE_SCOPE. */
  eaExerciseScope?: Float32Array;
  /** D4-05: fat mass at the end of the day (with `ffmActKg` gives tissue fat fraction 100·FM/(FM + FFM_act)). */
  fatMassKg?: Float32Array;
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
  /** C7: contract fingerprint the run was computed under. */
  contracts?: string;
  /** C2/D2-01: weakest causal resolution of the run's realised inputs ('daily' when daily-native models read observed days). */
  resolution?: CausalResolution;
  /** D1-08: domain validity / model-limit termination. */
  validity?: DomainValidity;
  /** C6: per-series status (absent series = estimated under the run's assumptions). */
  outputStatus?: Partial<Record<SeriesId, SeriesStatusMeta>>;
  /** D5-03: actual applied correction per day. */
  offsetsApplied?: OffsetApplied[];
  /** D7-02: measured values used exactly as t = 0 anchors. */
  observedAnchors?: ObservedAnchor[];
  /** Named assumptions active in the run ('growthBurnInAnchor', 'legacyRollingIntakeRouting', …; D3-05, D2-01). */
  assumptions?: readonly string[];
  /**
   * (A1-013/A1-022/A1-031/A1-040) Structured detail of named assumptions: id, first affected plan day, the outputs it
   * conditions and the reason (e.g. 'unknownMacroAllocation', 'unknownHardSetCount', 'polyolRouteUnmodelled',
   * 'habitualStepsOverlapUnknown'). `assumptions` keeps the bare ids for older readers.
   */
  assumptionDetails?: ReadonlyArray<{ id: string; fromDay?: number; affects?: readonly SeriesId[]; reasonCode: string; scenario?: string }>;
  /** (A1-065) Structural modes the run was computed under (absent = production modes). */
  structuralModes?: Readonly<Record<string, number>>;
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
  /**
   * D8-02/C6: what each band is (parameter-sensitivity range with unvalidated coverage, quantiles from stochastic members
   * only, endpoint convention). Absent = legacy semantics (`LEGACY_BAND_META`).
   */
  bandMeta?: Partial<Record<SeriesId, BandMeta>>;
  /**
   * D8-02/A1-049: per-series, per-day band availability (attempted/valid/excluded counts, exclusion reasons, per-day method,
   * member status and onset). A whole-series `method` cannot encode a valid prefix and an unavailable suffix: a day whose
   * `BandAvailability.method[d]` is `BAND_DAY_METHOD.none` has NO usable range, whatever finite compatibility values the
   * p10/p50/p90 arrays hold there (never a nominal fallback, never the previous day's range). Absent = legacy result.
   */
  bandDays?: Partial<Record<SeriesId, BandAvailability>>;
  /** (A1-065) Structural modes the nominal run and every member were computed under (absent = production modes). */
  structuralModes?: Readonly<Record<string, number>>;
}

/**
 * One ensemble member as it crosses the reducer/worker boundary (D8-02/A1-049): its band inputs (`daily`, change series
 * relative to the member's own t = 0) together with its per-series status/onset and run validity/abort, so a reducer can
 * count valid, scenario and excluded members per day. Numeric arrays stay finite-or-NaN compatibility storage; validity
 * travels here, never as an interpreted zero.
 */
export interface EnsembleMemberEnvelope {
  daily: Partial<Record<SeriesId, Float32Array>>;
  nDays: number;
  /** The member's `SimulationMeta.outputStatus` (absent series = estimated). */
  status?: Partial<Record<SeriesId, SeriesStatusMeta>>;
  /** D1-08 validity of the member run: days after `validThroughHour` are not valid contributions. */
  validity?: DomainValidity;
  /** Early abort of the member: the engine records the abort day itself, so only days after `aborted.day` are invalid contributions. */
  aborted?: { day: number; bound: string; magnitude: number };
}
