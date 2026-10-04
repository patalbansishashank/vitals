/* ==========================================================================
   Chart data contract — engine-agnostic.
   The chart module never imports the engine. `adapt.ts` shows how an engine
   `SimulationResult` maps onto these shapes (usually a few lines per metric).
   Time unit everywhere inside the chart module: DAYS since the start of the
   horizon, as a float (day 3, 18:00 = 3.75).
   ========================================================================== */

/** The 8 metric families of the design palette (`--lm-cat-*`). Fixed order. */
export type MetricCategory =
  | 'body'
  | 'fuel'
  | 'energy'
  | 'cellular'
  | 'performance'
  | 'recovery'
  | 'cardio'
  | 'hormones';

/** Which way is "better" for the reader. Used by summaries and goal copy, never for colour. */
export type DirectionOfGood = 'higher' | 'lower' | 'neutral' | 'in-range';

/** Evidence grade A (strong) … D (speculative). */
export type EvidenceGrade = 'A' | 'B' | 'C' | 'D';

/**
 * Lane type (CHART_SPEC §4.2). `line` is the default; a `line` with `thresholds`
 * is the spec's `line+threshold`. `index` = fixed 0–100 scale. `range-only` =
 * band only with a centre hairline ("direction only"). `stacked-area` = TDEE.
 */
export type LaneKind = 'line' | 'index' | 'range-only' | 'stacked-area';

/** Overlay transform (CHART_SPEC §2.1). `none` excludes the metric from the overlay. */
export type OverlayTransform = 'pct' | 'pts' | 'none';

/** Sample resolution. Daily arrays are always present; 6-hourly is derived from hourly. */
export type Resolution = 'daily' | '6h' | 'hourly';

export interface NumberFormat {
  /** Fraction digits for values and ranges. */
  decimals: number;
}

/** 80 % likely range (10th–90th percentile of the inter-individual distribution). */
export interface Band {
  lo: Float32Array;
  hi: Float32Array;
}

/** One resolution of one metric. NaN marks a missing sample (drawn as a gap). */
export interface Track {
  values: Float32Array;
  band?: Band;
}

export interface Threshold {
  value: number;
  /** Engraved label, lowercase: "nutritional ketosis". */
  label: string;
}

/** A reference ("healthy") range drawn as a faint achromatic band with a label. */
export interface ReferenceRange {
  lo: number;
  hi: number;
  label?: string;
}

export interface StackComponent {
  id: string;
  label: string;
  daily: Float32Array;
}

export interface ChartSeries {
  id: string;
  /** Sentence case, plain first: "Fat mass", "Blood ketones (BHB)". */
  label: string;
  /** Lowercase short name for rails and overlay labels on mobile: "fat". */
  shortLabel?: string;
  /** Display unit, already converted to the user's unit system: "kg", "mmol/L", "index". */
  unit: string;
  category: MetricCategory;
  direction: DirectionOfGood;
  grade: EvidenceGrade;
  format: NumberFormat;
  kind?: LaneKind;
  /** Defaults: index/percent units → `pts`, everything else → `pct`. */
  overlay?: OverlayTransform;
  /** Why the metric is not in the overlay, shown by pickers: "Ketones vary ten-fold; view in Lanes." */
  overlayNote?: string;
  /** Length = time.days. Always present. */
  daily: Track;
  /** Length = time.days × 24. Only for fast metrics. */
  hourly?: Track;
  /** Value before day 1 (the start of the horizon). Defaults to daily.values[0]. */
  baseline?: number;
  thresholds?: Threshold[];
  reference?: ReferenceRange;
  /** Y-domain policy. Default `hug` (data + 10 %); `zero` anchors at 0; explicit bounds win. */
  domain?: 'hug' | 'zero' | { min: number; max: number };
  /** One-line mechanism summary shown under the focused lane. */
  mechanism?: string;
  /** For `stacked-area` lanes (TDEE): components bottom → top and the counterfactual line. */
  stack?: {
    components: StackComponent[];
    counterfactual?: { label: string; daily: Float32Array };
  };
}

export interface TimeBase {
  /** ISO date of day 0 ("2026-10-05"). Without it, labels read "day 12" / "wk 2". */
  startDate?: string;
  days: number;
}

/** Colour key of a schedule block: energy vs maintenance steps (tokens §8). */
export type PhaseTone =
  | 'deficit-1'
  | 'deficit-2'
  | 'deficit-3'
  | 'deficit-4'
  | 'neutral'
  | 'surplus-1'
  | 'surplus-2'
  | 'surplus-3'
  | 'surplus-4'
  | 'fast';

export interface Phase {
  /** Inclusive start day. */
  startDay: number;
  /** Exclusive end day. */
  endDay: number;
  /** Full block name: "diet break". Never clipped; see `shortLabel`. */
  label: string;
  /** An honest short form used when the full name does not fit ("brk" is not honest; "break" may be). */
  shortLabel?: string;
  /** Program/phase letter used when nothing else fits. */
  letter?: string;
  tone?: PhaseTone;
  /**
   * The block's true planned balance in words ("deficit 18 %", "maintenance", "surplus 6 %"), shown after the name
   * when it fits and always in the tooltip / table.
   */
  balance?: string;
}

export type EventType =
  | 'ketosis-entered'
  | 'ketosis-exited'
  | 'glycogen-low'
  | 'refeed'
  | 'fast-start'
  | 'fast-end'
  | 'diet-break'
  | 'deload'
  | 'safety'
  | 'training'
  | 'note';

export type Severity = 'info' | 'caution' | 'danger';

export interface ChartEvent {
  day: number;
  /** Hour of day (0–24, fractional allowed). Omitted = whole-day event (drawn at the day centre). */
  hour?: number;
  type: EventType;
  label: string;
  /** Safety events draw a severity line through every lane. */
  severity?: Severity;
}

export interface MacroGrams {
  protein: number;
  netCarbs: number;
  fibre: number;
  fat: number;
  alcohol: number;
}

export type MacroKey = keyof MacroGrams;

/** One Float32Array per macro, length = days. */
export type MacroSeries = Record<MacroKey, Float32Array>;

export type ExerciseType = 'resistance' | 'cardio' | 'walk';

export interface ExerciseSession {
  day: number;
  startHour: number;
  durationMin: number;
  type: ExerciseType;
  label?: string;
}

export interface Meal {
  day: number;
  startHour: number;
  durationMin: number;
  grams: MacroGrams;
}

/** A clock window on a day; `endHour` may exceed 24 (sleep 23 → 31). */
export interface DayWindow {
  day: number;
  startHour: number;
  endHour: number;
}

export interface IntakeContext {
  grams: MacroSeries;
  /** kcal per macro per day. Derived with Atwater factors (4/4/2/9/7) when omitted. */
  kcal?: MacroSeries;
  /** Projected maintenance (TDEE) per day; moves with metabolic adaptation. */
  maintenance: Float32Array;
  steps?: Float32Array;
  exercise?: ExerciseSession[];
  meals?: Meal[];
  eatingWindows?: DayWindow[];
  sleep?: DayWindow[];
}

/** Ordinal state per sample (e.g. ketosis: none · forming · nutritional · deep). */
export interface StateTrack {
  id: string;
  label: string;
  /** Level names, index = value. Level 0 is drawn transparent. */
  levels: string[];
  daily: Uint8Array;
  hourly?: Uint8Array;
}

/** kg per day, for the weight-change decomposition (CHART_SPEC §7.5). */
export interface CompositionTracks {
  fat: Float32Array;
  lean: Float32Array;
  glycogen: Float32Array;
  water: Float32Array;
}

export interface ChartData {
  time: TimeBase;
  series: ChartSeries[];
  phases?: Phase[];
  events?: ChartEvent[];
  intake?: IntakeContext;
  states?: StateTrack[];
  composition?: CompositionTracks;
}

export type PlanId = 'A' | 'B' | 'C';

export interface PlanSeriesSet {
  id: PlanId;
  name: string;
  series: ChartSeries[];
  phases?: Phase[];
}

export interface Goal {
  /** 1-based priority. */
  rank: number;
  metricId: string;
  /** "lose 10 kg" */
  text: string;
  /** Absolute target in the metric's unit, with its engraved label ("target −10 kg"). */
  target?: { value: number; label: string };
}

export interface ComparisonData {
  time: TimeBase;
  plans: PlanSeriesSet[];
  goals: Goal[];
  /** Extra context multiples after the goals (e.g. hunger, scale weight). */
  contextMetricIds?: string[];
}

export interface ConvergenceTrace {
  plan: PlanId;
  /** Best score per iteration, 0–1. */
  scores: Float32Array;
}
