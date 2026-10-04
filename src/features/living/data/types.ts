/**
 * View models the Living screens read besides E5's `TodayView` (which is used unchanged). Everything numeric here is
 * computed by the engine/E5 side (or the stub source standing in for it) — the UI renders, never derives, scores,
 * credits, bands, drift states, goal dates or nutrient totals (living-mode.md §12).
 */
import type { AdherenceScore, DriftGoal, LocalDate, LogEntrySummary, PlanItemType, VersionReason } from '@/living';
import type { TrendLaneData } from '@/features/charts/living/types';

/** One day key of the date strip (COMPONENTS §13.8). */
export interface DayGlance {
  date: LocalDate;
  /** Inside the plan's span. */
  inPlan: boolean;
  isStart: boolean;
  isEnd: boolean;
  paused: boolean;
  /** Backfilled "as planned" (dashed, never scored). */
  assumed: boolean;
  /** Something was logged or marked. */
  logged: boolean;
  /** The day's score (past days and today "so far"); null for future or unscored days. */
  score: AdherenceScore | null;
}

/** A version row (Progress › Plan, Plan details). */
export interface PlanVersionRow {
  version: number;
  reason: VersionReason;
  /** "started", "small adjustment", "weekly check-in", … (living-mode.md §8.2 reason words). */
  reasonText: string;
  date: LocalDate;
  status: 'proposed' | 'adopted' | 'rejected' | 'superseded';
  /** One line: "Thursday lift moved to Friday". */
  summary: string;
  diff: Array<{ date: LocalDate; field: string; before: string; after: string; why: string }>;
  goalDates: Array<{ label: string; range: [LocalDate, LocalDate] | null }>;
}

/** One past day in the log history (Progress › Log). */
export interface HistoryDay {
  date: LocalDate;
  score: AdherenceScore | null;
  final: boolean;
  assumed: boolean;
  paused: boolean;
  entries: LogEntrySummary[];
  /** Every unresolved fork on this day, including measurements. */
  conflicts?: HistoryConflict[];
}

export interface HistoryConflict {
  parentId: string;
  kind: 'meal' | 'workout' | 'measurement' | 'entry';
  versions: Array<{ id: string; label: string; at?: string; source?: string; energyKcal?: number }>;
}

/** Adherence over a span (Progress › Adherence; check-in). */
export interface AdherenceSummary {
  a7: number | null;
  a28: number | null;
  arrow: 'up' | 'down' | 'steady' | null;
  scored28: number;
  daysLogged7: number;
  /** Per-block means for the week (training · protein · energy · fasting · steps). */
  blocks: Array<{ type: PlanItemType; label: string; mean: number | null; n: number }>;
  /** "Thursday's lift carried 30 % and was skipped twice". */
  costliest: string | null;
  /** "Thursday lifts happen 1 time in 4. The plan can move them — see proposal." */
  learned: string[];
}

/** Weekly check-in report (living-mode.md §4.5). */
export interface CheckInModel {
  due: boolean;
  /** "Thursday". */
  weekday: string;
  weighIns7: number;
  /** Null when there are not enough weigh-ins — the verdict section is replaced, not faked. */
  verdict: {
    state: DriftGoal['state'];
    goalDate: [LocalDate, LocalDate] | null;
    shiftText: string | null;
    cause: string;
  } | null;
  trendText: string;
  missingText: string | null;
  adherence: AdherenceSummary;
  proposalId: string | null;
  nextDate: LocalDate;
  trend: TrendLaneData | null;
}

/** Composition from the latest anchored state (Progress › Body). */
export interface BodyComposition {
  asOf: LocalDate;
  rows: Array<{ label: string; value: number; lo: number; hi: number; unit: string; decimals: number; sinceStart: number | null }>;
  girths: Array<{ label: string; value: number; method: string; date: LocalDate; repeats: number }>;
}

export type DriftCard = Pick<DriftGoal, 'goal' | 'metric' | 'state' | 'goalDate' | 'causes' | 'action' | 'text'> & { label: string };
