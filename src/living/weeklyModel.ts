/**
 * The next week's recommendation, read from the SAME adopted optimiser forecast that weekly check-ins update.
 * No second calorie estimator and no automatic calorie cuts. Unknown food/weight evidence keeps the target provisional.
 * Stored digest arrays contain end-of-day values: index 0 is `fromDay`, without the engine's t=0 sample.
 * Ranges are scenario sensitivity, never personal confidence.
 */
import { ASSIMILATION_DEFAULTS } from '@/engine/assimilation/params';
import { freezeMuscleRetention } from '@/engine/planner/domain/muscleRetention';
import type { PlannerRequestV2 } from '@/engine/planner/domain/types';
import { addDays, daysBetween } from './dates';
import type { LocalDate, ProjectionDigest } from './types';

export type WeeklyModelDecision = 'keep' | 'provisional' | 'changeReady' | 'review';
export interface WeeklyModelReview {
  from: LocalDate;
  to: LocalDate;
  days: number;
  decision: WeeklyModelDecision;
  reason:
    'planForecast' | 'needsEvidence' | 'missingForecast' | 'muscleBudget' | 'currentReview' | 'pendingChange';
  /** Mean prescribed intake over the next week; distinct from modeled expenditure. */
  targetKcal: number | null;
  targetRangeKcal: readonly [number, number] | null;
  expenditureKcal: number | null;
  deficitKcal: number | null;
  fatChangeKg: number | null;
  muscleChangeKg: number | null;
  muscleBudget: {
    maxLossPct: number;
    baselineKg: number;
    baselineDate: string;
    floorKg: number;
    worstLossPct: number | null;
    lowerScenarioLossPct: number | null;
    status: 'withinBudget' | 'overBudget' | 'unavailable';
    basis: 'modelScenario';
  } | null;
  evidence: {
    weighIns: number;
    weighInsNeeded: number;
    foodDays7: number;
    foodDaysPrevious7: number;
    foodDaysNeeded: number;
    enoughInputs: boolean;
  };
  basis: 'adoptedPlanScenario';
}

export function weeklyModelReview(i: {
  request: PlannerRequestV2;
  forecast: ProjectionDigest;
  startDate: LocalDate;
  endDate: LocalDate;
  asOf: LocalDate;
  weighIns: number;
  foodDays7: number;
  foodDaysPrevious7: number;
  reviewRequired?: boolean;
  proposalPending?: boolean;
  /** Exact canonical prescription for these dates. Never replace a missing prescribed target with a scenario median. */
  prescribedKcal?: readonly (number | null)[];
}): WeeklyModelReview | null {
  const day = daysBetween(i.startDate, i.asOf);
  // PlanDoc.plannedEndDate is an exclusive boundary (start + horizonDays).
  const remaining = daysBetween(i.asOf, i.endDate);
  if (day < 0 || remaining <= 0) return null;
  const days = Math.min(7, remaining);
  const k = day - i.forecast.fromDay;
  const p = i.forecast.asPrescribed;
  const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
  const window = (values: readonly number[] | undefined): number[] | null => {
    if (!values || k < 0 || k + days > values.length) return null;
    const a = values.slice(k, k + days);
    return a.length === days && a.every(finite) ? a : null;
  };
  const mean = (a: number[] | null): number | null => (a ? a.reduce((s, v) => s + v, 0) / a.length : null);
  // A digest does not store the state before its first day. Do not invent a baseline for a new re-plan.
  const delta = (values: readonly number[] | undefined): number | null =>
    k > 0 && values && finite(values[k - 1]) && finite(values[k + days - 1])
      ? values[k + days - 1]! - values[k - 1]!
      : null;
  const explicitIntake = i.prescribedKcal?.slice(0, days);
  const intake = explicitIntake
    ? explicitIntake.length === days &&
      explicitIntake.every((v): v is number => v !== null && Number.isFinite(v))
      ? explicitIntake
      : null
    : window(p.inEnergy?.p50);
  const targetKcal = mean(intake);
  const expenditureKcal = mean(window(p.tdee?.p50));
  const needed = ASSIMILATION_DEFAULTS;
  const enoughInputs =
    i.weighIns >= needed.biasMinWeighIns &&
    i.foodDays7 >= needed.biasMinIntakeDays &&
    i.foodDaysPrevious7 >= needed.biasMinIntakeDays;
  const evidence = {
    weighIns: i.weighIns,
    weighInsNeeded: needed.biasMinWeighIns,
    foodDays7: i.foodDays7,
    foodDaysPrevious7: i.foodDaysPrevious7,
    foodDaysNeeded: needed.biasMinIntakeDays,
    enoughInputs,
  };
  const budget = freezeMuscleRetention(i.request).constraints?.muscleRetention;
  let muscleBudget: WeeklyModelReview['muscleBudget'] = null;
  if (budget?.baseline) {
    const baseline = budget.baseline;
    const loss = (values: readonly number[] | undefined): number | null => {
      if (!values || k < 0 || k + remaining > values.length) return null;
      const remainingValues = values.slice(k, k + remaining);
      if (!remainingValues.length || !remainingValues.every((v) => Number.isFinite(v) && v > 0)) return null;
      return Math.max(0, (100 * (baseline.kg - Math.min(baseline.kg, ...remainingValues))) / baseline.kg);
    };
    const worstLossPct = loss(p.skeletalMuscle?.p50);
    const lowerScenarioLossPct = loss(p.skeletalMuscle?.p10);
    const status =
      worstLossPct === null || lowerScenarioLossPct === null
        ? 'unavailable'
        : Math.max(worstLossPct, lowerScenarioLossPct) > budget.maxLossPct + 1e-6
          ? 'overBudget'
          : 'withinBudget';
    muscleBudget = {
      maxLossPct: budget.maxLossPct,
      baselineKg: baseline.kg,
      baselineDate: baseline.date,
      floorKg: baseline.kg * (1 - budget.maxLossPct / 100),
      worstLossPct,
      lowerScenarioLossPct,
      status,
      basis: 'modelScenario',
    };
  }
  let decision: WeeklyModelDecision = 'keep';
  let reason: WeeklyModelReview['reason'] = 'planForecast';
  if (!enoughInputs) {
    decision = 'provisional';
    reason = 'needsEvidence';
  }
  if (targetKcal === null || expenditureKcal === null || muscleBudget?.status === 'unavailable') {
    decision = 'provisional';
    reason = 'missingForecast';
  }
  if (i.proposalPending) {
    decision = 'changeReady';
    reason = 'pendingChange';
  }
  if (i.reviewRequired || muscleBudget?.status === 'overBudget') {
    decision = 'review';
    reason = i.reviewRequired ? 'currentReview' : 'muscleBudget';
  }
  return {
    from: i.asOf,
    to: addDays(i.asOf, days - 1),
    days,
    decision,
    reason,
    targetKcal,
    targetRangeKcal: intake ? [Math.min(...intake), Math.max(...intake)] : null,
    expenditureKcal,
    deficitKcal: targetKcal !== null && expenditureKcal !== null ? expenditureKcal - targetKcal : null,
    fatChangeKg: delta(p.fatMass?.p50),
    muscleChangeKg: delta(p.skeletalMuscle?.p50),
    muscleBudget,
    evidence,
    basis: 'adoptedPlanScenario',
  };
}
