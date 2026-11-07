/** Synthetic weekly-review states for the existing isolated screenshot harness. Never an app data source. */
import { addDays } from '@/living/dates';
import type { WeeklyModelReview } from '@/living/weeklyModel';

export function weeklyModelFixture(today: string, state: string): WeeklyModelReview {
  return {
    from: today,
    to: addDays(today, 6),
    days: 7,
    decision: state === 'review' ? 'review' : state === 'keep' ? 'keep' : 'provisional',
    reason: state === 'review' ? 'muscleBudget' : state === 'keep' ? 'planForecast' : 'needsEvidence',
    targetKcal: 1500,
    targetRangeKcal: [1500, 1500],
    expenditureKcal: 2630,
    deficitKcal: 1130,
    fatChangeKg: -0.65,
    muscleChangeKg: -0.02,
    muscleBudget: {
      maxLossPct: 5,
      baselineKg: 29,
      baselineDate: addDays(today, -14),
      floorKg: 27.55,
      worstLossPct: 1.8,
      lowerScenarioLossPct: state === 'review' ? 5.8 : 3.5,
      status: state === 'review' ? 'overBudget' : 'withinBudget',
      basis: 'modelScenario',
    },
    evidence: {
      weighIns: 3,
      weighInsNeeded: 10,
      foodDays7: 2,
      foodDaysPrevious7: 0,
      foodDaysNeeded: 4,
      enoughInputs: state === 'keep',
    },
    basis: 'adoptedPlanScenario',
  };
}
