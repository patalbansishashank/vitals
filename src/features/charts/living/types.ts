/* ==========================================================================
   Living-mode chart data (CHART_SPEC §7.8–7.10): the trend lane, the
   adherence dial / calendar / per-block bars and the score history.
   Engine-agnostic: plain arrays indexed by day from `startDate` (day 0);
   NaN marks a gap. Units are already the user's display units.
   ========================================================================== */

/** The weight trend against the plan's forecast (CHART_SPEC §7.8). */
export interface TrendLaneData {
  /** ISO date of index 0. */
  startDate: string;
  /** Length of every per-day array. */
  days: number;
  /** Index of today (the yellow now-hand), or null when today is outside the window. */
  todayIndex: number | null;
  /** Display unit ("kg", "lb"). */
  unit: string;
  decimals: number;
  /** Raw weigh-ins as faint dots; flagged outliers are hollow, never removed. */
  weighIns: Array<{ day: number; value: number; flagged?: boolean }>;
  /** Filtered trend line (2 px, body hue); NaN where there is no trend yet. */
  trend: number[];
  /** Trend SD per day (readout "±0.3"), optional. */
  trendSd?: number[];
  /** Realistic forecast (at the person's actual adherence): filled band + optional median. */
  realistic?: { p10: number[]; p50?: number[]; p90: number[] };
  /** As-prescribed forecast (full adherence): 1 px dashed outline band. */
  asPrescribed?: { p10: number[]; p90: number[] };
  /** Goal as a 1 px ink line with label. */
  goal?: { value: number; label: string };
  /** Goal-date range as a bracket on the x-axis ("likely 21–30 Dec"); dates may fall outside the window. */
  goalDateRange?: { from: string; to: string; label: string };
  /** Engraved markers: estimate resets, plan versions (v2, v3…) and pauses (hatched span to `endDay`). */
  events?: Array<{ day: number; kind: 'reset' | 'version' | 'pause'; label: string; endDay?: number }>;
}

/** One arc of the adherence dial (COMPONENTS §13.9): an item of the day's prescription. */
export interface DialItem {
  id: string;
  /** "Lunch", "Lift · 45 min". */
  label: string;
  /** Share of the day (weights are renormalised over all items, unknown ones included: the circle is the whole day). */
  weight: number;
  /** 0–1 credit; null = unknown (not logged) — drawn dashed, not counted. */
  credit: number | null;
  /** Explicit outcome when known; `skipped` with credit 0 draws the hollow "missed" arc. */
  status?: 'done' | 'partial' | 'skipped' | 'unknown';
  /** Tooltip text: "Lunch · protein 31 of 40 g · counted 80 % · carried 15 % of today". */
  detail?: string;
}

export type DialArcState = 'done' | 'partial' | 'missed' | 'unknown';

/** One day cell of the adherence calendar (CHART_SPEC §7.9). */
export interface CalendarDay {
  date: string;
  inPlan: boolean;
  /** 0–100 or null (unscored → hollow dot). */
  score: number | null;
  items?: DialItem[];
  assumed?: boolean;
  paused?: boolean;
  final?: boolean;
}

/** One per-block bar (training · protein · energy · fasting · steps), 0–100. */
export interface BlockBar {
  id: string;
  label: string;
  mean: number | null;
  n: number;
}

/** Score history (CHART_SPEC §7.10). */
export interface ScoreHistoryData {
  startDate: string;
  days: number;
  unit: string;
  decimals: number;
  /** Nightly values as faint dots (NaN = no night). */
  nightly: number[];
  /** 7-day mean, 2 px line in the category hue. */
  mean7: number[];
  /** Personal normal range as a band (per day; NaN while forming). */
  normal?: { lo: number[]; hi: number[] };
  /** Engraved vertical lines: "v1.3 from 20 Oct". */
  versions?: Array<{ day: number; label: string }>;
  /** A new device: the history joins old and new with a dashed segment. */
  deviceChanges?: Array<{ day: number; label: string }>;
  /** Optional second line "compare with v1.2" (dashed). */
  compare?: { label: string; values: number[] };
  category: 'recovery' | 'performance' | 'cardio';
}
