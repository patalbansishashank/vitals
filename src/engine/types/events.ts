/**
 * Events and warnings (docs/MODEL_SPEC.md §7).
 *
 * Events are time-stamped state transitions for the chart's event ribbon. Warnings are dossier-17 rule hits merged
 * into day ranges. Both are buffered in preallocated typed arrays during the run (no allocation per step) and turned
 * into objects once, in `finalize`.
 */
import type { SourceRef } from '../../content/evidence/schema';

export type Severity = 'info' | 'caution' | 'danger';

export const EVENT_TYPES = [
  'ketosisEntered', // BHB rises through 0.5 mmol/L (05 §6)
  'ketosisExited', // BHB falls below 0.4 mmol/L after being ≥ 0.5 (hysteresis)
  'deepKetosis', // BHB ≥ 3.0 with no intake (fasting ketosis)
  'ketoneAlert', // BHB > 3.0 while eating or > 6.0 at any time (05 §6 warning band)
  'ketoAdapted', // A_f crosses 0.9 upward
  'glycogenLow', // total glycogen < 30 % of capacity (CHART_SPEC §4.5)
  'glycogenFull', // total glycogen ≥ 95 % of capacity (04 §4.10 DNL gate)
  'liverGlycogenLow', // liver glycogen < 20 g (04 §4.2 "time until liver glycogen < 20 g")
  'metabolicSwitch', // 07 §4.3 switch variable crosses 0.5
  'fastStart', // planned zero-intake span starts
  'fastEnd', // planned zero-intake span ends (refeed)
  'waterRebound', // scale weight +≥ 0.5 kg within 3 d while fat mass falls (13 T4)
  'weightPlateau', // 7-d mean scale weight moves < 0.1 kg over 14 d while EB7 < −200 kcal/d (water masks fat loss, 13 §4.7)
  'detrainingOnset', // 09 §4.10 λ becomes > 0 for the largest region
  'supercompensation', // muscle glycogen > 1.3 × fed reference (04 §4.9)
  'safetyFlag', // first day of a caution/danger warning run (mirrors a Warning)
] as const;
export type SimEventType = (typeof EVENT_TYPES)[number];
export const EVENT_CODE: Readonly<Record<SimEventType, number>> = Object.freeze(
  Object.fromEntries(EVENT_TYPES.map((e, i) => [e, i])) as Record<SimEventType, number>,
);

export interface SimEvent {
  type: SimEventType;
  /** Absolute hour index since t = 0. */
  hour: number;
  day: number;
  /** Event-specific value (e.g. BHB at entry, glycogen g). */
  value: number;
}

/**
 * Warning rule ids: dossier 17 §3 ids (W-E01 … W-U05) plus engine-specific rules from module dossiers' §9
 * (prefix W-X-<dossier>, e.g. 'W-01-LEANLOSS'). The rule table (conditions, severities, ≤ 200-char message
 * templates) lives in `src/engine/model/safety/rules.ts` (safety WP, MODEL_SPEC §7.2).
 */
export type WarningRuleId = `W-${string}`;

export interface SimWarning {
  id: WarningRuleId;
  severity: Severity;
  /** Inclusive day range where the condition held (runs merged; gap ≤ 1 day closes a run). */
  startDay: number;
  endDay: number;
  /** Worst value of the rule's driving quantity inside the run (e.g. lowest EA_7). */
  peakValue: number;
  /** Message with placeholders filled (≤ 200 characters, 17 §7.4). */
  message: string;
  /** Maintainers' pointer into the research notes ("17 §3 [6][7]"). Never rendered: a screen shows `sources`. */
  src: string;
  /** The evidence behind the message (Evidence library topic and source positions); what a screen shows. */
  sources?: readonly SourceRef[];
}

/**
 * Planner margin per Simulator warning (ruling R-PLAN-SAFETY, final round 2026-09-30; `safety.computeWarningMargins`,
 * `SimulationResult.warningMargins`): m = (bound − value)/scale per day, at least as strict as the warning — m ≥ 0 on every
 * day ⇒ that warning (and the danger rule it shadows, see the mapping in `model/safety/constraints.ts`) does not fire.
 * NaN on days where the rule cannot apply.
 */
export interface WarningMargin {
  id: WarningRuleId;
  severity: Severity;
  margin: Float32Array;
  /** One margin unit, human-readable (e.g. "5 % of TDEE"). */
  unit: string;
}

/** Planner hard-constraint ids (17 §2.2 HC-*). */
export type HardConstraintId = `HC-${string}`;

export type ConstraintWindow = 'profile' | 'daily' | '7d' | '14d' | 'block' | 'plan' | 'per-fast';
export type ConstraintAction =
  | 'BLOCK_APP'
  | 'BLOCK_PLANNER'
  | 'RESTRICT'
  | 'CLIP'
  | 'REJECT'
  | 'INSERT_BREAK'
  | 'REQUIRE_OPTIN';

/** Per-day margin of one hard constraint (≥ 0 satisfied; < 0 violated by that amount, in the constraint's unit). */
export interface ConstraintMargin {
  id: HardConstraintId;
  /** Length nDays; NaN where the constraint does not apply. */
  margin: Float32Array;
  action: ConstraintAction;
  window: ConstraintWindow;
}
