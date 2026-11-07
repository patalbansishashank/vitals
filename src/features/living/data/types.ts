/**
 * View models the Living screens read besides E5's `TodayView` (which is used unchanged). Everything numeric here is
 * computed by the engine/E5 side (or the stub source standing in for it) — the UI renders, never derives, scores,
 * credits, bands, drift states, goal dates or nutrient totals (living-mode.md §12).
 */
import type { AdherenceScore, DriftGoal, LocalDate, LogEntrySummary, PlanItemType, VersionReason } from '@/living';
import type { TrendLaneData } from '@/features/charts/living/types';
import type { CalendarEa } from '@/living/energyAvailability';
import type { MonitoredGoal, BpEpisode } from '@/living/monitoring';
import type { StatusValue } from '@/lib/bodyContracts';
import type { WeeklyModelReview } from '@/living/weeklyModel';

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
  /** Per-block means for the week; sentence-case labels, as the bars show them ("Training", "Protein", "Fasting"). */
  blocks: Array<{ type: PlanItemType; label: string; mean: number | null; n: number }>;
  /** "Thursday's lift carried 30 % and was skipped twice". */
  costliest: string | null;
  /** "Thursday lifts happen 1 time in 4. The plan can move them — see proposal." */
  learned: string[];
}

/** Weekly check-in report (living-mode.md §4.5). */
export interface CheckInModel {
  /** One consistent next-week target from the adopted model, with the user's whole-plan retention budget. */
  weeklyModel?: WeeklyModelReview | null;
  /** Exact identity of the estimate reviewed in this report. */
  previewId: string;
  decisionPointDate: LocalDate;
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
    /** (D5-02) 'unclear' overrides the state word (insufficient data is never "on track"). */
    certainty?: DriftGoal['certainty'];
    residual?: DriftGoal['residual'];
    loggedIntakeDiff?: DriftGoal['loggedIntakeDiff'];
  } | null;
  trendText: string;
  missingText: string | null;
  adherence: AdherenceSummary;
  proposalId: string | null;
  nextDate: LocalDate;
  trend: TrendLaneData | null;
  /**
   * (D5-06, additive) The current prescription needs review (a changed screening or a blocked status from the lifecycle
   * gate) or an entered concern was flagged: the state word reads "Review"; the reasons live in the info sheet.
   */
  review?: boolean;
  reviewReasons?: string[];
  reviewDetails?: Array<{ label: string; value: string }>;
  /** (D5-06, additive) A plan version took effect since the last confirmed check-in: "Plan changed". */
  planChanged?: boolean;
  /**
   * (D4-04/D8-04, additive) Calendar 7-day energy availability (kcal/kg FFM/day): a value or range when every day is
   * known, a lower bound with partial-intake days, else Incomplete. Never a healthy/unsafe verdict.
   */
  energyAvailability?: ({ status: StatusValue['status']; value?: number; range?: readonly [number, number]; lowerBound?: number; covered: number; days: number; reasonCode?: string } & Partial<Pick<CalendarEa, 'version' | 'intakeCoveredDays' | 'exerciseCoveredDays' | 'exerciseScopes' | 'assumptions'>>) | null;
  /** (D2-06/D8-09, additive) Entered wellbeing: the latest observed hunger and mood ratings 0–10 and the concern status. */
  wellbeing?: { status: 'review' | 'noFlag' | 'unknown'; hunger: number | null; mood?: number | null } | null;
}

/** Composition from the latest anchored state (Progress › Body). */
export interface BodyComposition {
  asOf: LocalDate;
  rows: Array<{ label: string; value: number; lo: number; hi: number; unit: string; decimals: number; sinceStart: number | null }>;
  girths: Array<{ label: string; value: number; method: string; date: LocalDate; repeats: number }>;
}

/** (D5-02) `certainty`, the labelled `residual` and the observed `loggedIntakeDiff` travel with the card; causes stay empty. */
export type DriftCard = Pick<DriftGoal, 'goal' | 'metric' | 'state' | 'goalDate' | 'causes' | 'action' | 'text'> &
  Partial<Pick<DriftGoal, 'certainty' | 'residual' | 'loggedIntakeDiff'>> & { label: string };

/** Observations retain protocol details behind the goal row’s read-only sheet. */
export type MonitoredGoalRow = MonitoredGoal & { label: string; bpEpisodes?: BpEpisode[] };

export const MONITORED_LABEL: Readonly<Record<string, string>> = { sbp: 'Blood pressure', waist: 'Waist', bodyFatPct: 'Body fat', ldl: 'LDL', hdl: 'HDL', triglycerides: 'Triglycerides', apoB: 'ApoB', fastingGlucose: 'Fasting glucose', glucose: 'Glucose', crp: 'CRP', bhb: 'Ketones' };
