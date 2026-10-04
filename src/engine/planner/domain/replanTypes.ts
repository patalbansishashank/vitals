/**
 * Living-plan re-plan contracts (docs/PLANNER_V2_SPEC.md §7.1, §7.6, §8.6, §9.3): what the living plan (`src/living`, E5)
 * hands the planner and what it gets back. Types only, plus the plan-item vocabulary. The implementations are in
 * `replan.ts` (receding-horizon re-plan, `toActivePlan`) and `sensitivities.ts` (forward model from the confirmed state,
 * realistic projection, item sensitivities, benefit retained).
 */
import type { StimulusIntent, StimulusVector } from '@/catalogues';
import type { MetricId, SeriesId } from '../../types/metrics';
import type { EngineSnapshot } from '../../types/result';
import type { DayTemplate, Schedule } from '../../types/schedule';
import type { DailyBand, PlannerRequestV2, PlannerResult, PlannerTier, RungId } from './types';

/** §9.3 item vocabulary: the prescribed items of a plan day (adherence weights, credits, revealed adherence). */
export type PlanItemType = 'energy' | 'protein' | 'window' | 'fast' | 'rtSession' | 'cardioSession' | 'steps' | 'sleep' | 'supplement';
export const PLAN_ITEM_TYPES: readonly PlanItemType[] = ['energy', 'protein', 'window', 'fast', 'rtSession', 'cardioSession', 'steps', 'sleep', 'supplement'];

/**
 * Where an active genome decodes (re-plan warm start, §7.3): the genome is decoded with the plan's request compiled at
 * start date = plan start + `offset` days (negative when the plan was anchored to a later weekday), horizon `horizonDays`,
 * body weight `weightKg`; decoded day i is plan day `offset + i`. Absent: offset 0, the request's horizon and weight.
 */
export interface ReplanFrame {
  offset: number;
  horizonDays: number;
  weightKg: number;
}

/**
 * Provenance an active plan carries (v2 `PlannerResultV2['provenance']`, loosened so plans started from a v1 option or a
 * scenario fit too). `replanFrame` is written by `toActivePlan` and `replan` and carried verbatim by the living plan.
 */
export type ActivePlanProvenance = Omit<PlannerResult['provenance'], 'tier'> & {
  tier: PlannerTier;
  plannerVersion?: 2;
  holdoutGap?: number[];
  difficultyWeights?: number[];
  checkpointKey?: string;
  replanFrame?: ReplanFrame;
};

/** §7.1: the plan the user started, as the living plan stores it. */
export interface ActivePlanRecord {
  planId: string;
  version: number;
  /**
   * The rung the user started (never 'ideal'). 'custom' = started from a Simulator scenario: no genome, the re-plan then
   * searches the full structure set (additive widening of §7.1, see `toActivePlanFromScenario`).
   */
  kind: RungId | 'custom';
  /** Goals with targets frozen as ABSOLUTE values at plan start. */
  request: PlannerRequestV2;
  startDate: string;
  endDate: string;
  /** Skeleton id of the genome ('' when there is none). */
  structureId: string;
  /** Genome in [0, 1]ⁿ of `structureId` in `provenance.replanFrame` ([] for scenario-started plans). */
  genome: number[];
  /** Engine schedule, day 0 = `startDate`. */
  schedule: Schedule;
  provenance: ActivePlanProvenance;
}

/** §7.1: produced by the living plan at a check-in (R11 §3.3). */
export interface ConfirmedState {
  anchorDate: string;
  /** Nominal engine state at the START of the anchor day (day-stamped, `RunOptions.initialSnapshot`). */
  snapshot: EngineSnapshot;
  /** Reweighted selection ensemble (R6 §5); uniform when absent. */
  particles?: { weights: number[]; snapshots?: EngineSnapshot[] };
  /** Energy-balance bias δ, applied as an intake offset in every forward run. */
  energyBiasKcal: { mean: number; sd: number };
  trendWeight: { kg: number; sd: number };
}

export interface ItemOutcome {
  itemId: string;
  type: PlanItemType;
  status: 'done' | 'partial' | 'skipped' | 'unknown';
  credit: number | null;
  performed?: StimulusVector;
}

/** One logged day: what the engine simulates for it, the item outcomes and the share of the day's weight logged. */
export interface LoggedDay {
  date: string;
  inputs: DayTemplate;
  items: ItemOutcome[];
  coverage: number;
}

/** Revealed adherence: Beta posterior of the credit of one item type (optionally per weekday, 0 = Monday). */
export interface BlockAdherence {
  type: PlanItemType;
  weekday?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  a: number;
  b: number;
  opportunities: number;
}

export type ReplanKind = 'light' | 'weekly' | 'event' | 'user';
export type ReplanTrigger = 'nudge' | 'checkin' | 'absence' | 'missedBlocks' | 'lowAdherence' | 'outOfBand' | 'requestChange' | 'safetyAhead' | 'user';

/** User edits a re-plan applies. `horizonDays` is the new total plan length from the plan start (≥ 7 days left). */
export type ReplanChanges = Partial<Pick<PlannerRequestV2, 'goals' | 'constraints' | 'safety' | 'horizonDays'>>;

export interface ReplanRequest {
  kind: ReplanKind;
  today: string;
  plan: ActivePlanRecord;
  state: ConfirmedState;
  /** Logged days since the anchor (earlier days are used for fasting spacing when present). */
  logs: LoggedDay[];
  /** Beta posteriors, half-life 21 d, prior Beta(6, 2) (R11 §4.3). */
  adherence: BlockAdherence[];
  trigger: ReplanTrigger;
  changes?: ReplanChanges;
  /**
   * (E5b, additive) Plan days the person fixed (a declared event, a shift, an edited day): `plan.schedule` already carries
   * their prescription and every candidate keeps it, as it keeps the lock window. The search re-plans the other days.
   */
  pinnedDays?: number[];
  /**
   * (E5b, additive) The adopted schedule before the person's edit. When given, the diff, the load check and
   * `goalDates[].before` compare against it (so the result states what the edit and the re-plan around it change together).
   */
  baseline?: Schedule;
}

/**
 * One goal of a forecast (§7.6). `endP50` etc. are in the goal metric's units at the plan end; `date` is when the P50
 * path first reaches the target (null: not within the plan). The optional fields are filled by the planner.
 */
export interface ForecastGoalOutcome {
  goal: number;
  metric: MetricId;
  endP50: number;
  p10?: number;
  p90?: number;
  pTargetMet?: number | null;
  date?: string | null;
  label?: string;
  unit?: string;
  /** Absolute target (metric units) or null. */
  target?: number | null;
  /** Value on the first forecast day. */
  current?: number;
}

export interface ReplanDiffRow {
  date: string;
  field: string;
  before: string;
  after: string;
  why: string;
}

export interface ReplanGoalDate {
  goal: number;
  before: string | null;
  after: string | null;
  range: [string, string] | null;
}

export interface ReplanProposal {
  id: string;
  text: string;
  raisesLoad: boolean;
  /** Request changes that would realise the proposal, when it is one (undefined: adopt the returned plan). */
  apply: ReplanChanges | undefined;
}

/** §7.6 */
export interface ReplanResult {
  status: 'ok' | 'unchanged' | 'proposal' | 'noSafePlan';
  /** New version (or the same plan when unchanged / no safe plan). Days before `today` equal the active plan's. */
  plan: ActivePlanRecord;
  diff: ReplanDiffRow[];
  /**
   * Goal outcomes as prescribed and at revealed adherence; `bands` are the as-prescribed daily bands from `fromDay` (index
   * 0 = the value of plan day `fromDay`), `realisticBands` the same at revealed adherence.
   */
  forecast: {
    asPrescribed: ForecastGoalOutcome[];
    realistic: ForecastGoalOutcome[];
    bands: Partial<Record<SeriesId, DailyBand>>;
    realisticBands?: Partial<Record<SeriesId, DailyBand>>;
    fromDay?: number;
    /** (E5b, additive) Goal outcomes of the plan before this re-plan (the `baseline` when given), as prescribed. */
    before?: ForecastGoalOutcome[];
  };
  goalDates: ReplanGoalDate[];
  proposals: ReplanProposal[];
  explanation: string[];
  euUsed: number;
}

/** §8.6: computed by the planner per plan version (R11 §4.1). */
export interface PlanSensitivities {
  planVersion: string;
  /** w_i: share of the weighted goal score, ≥ 0.02 floor, all nine types, summing to 1. */
  itemWeights: Record<PlanItemType, number>;
  /** α per prescribed session item (`rtSession:<day>:<k>`, `cardioSession:<day>:<k>`). */
  intentByItem: Record<string, StimulusIntent>;
}

/** Item types whose posterior a forward run reads (realistic projection). */
export type ExpectedCredits = Partial<Record<PlanItemType, number>>;
