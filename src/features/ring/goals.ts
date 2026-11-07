/**
 * The person's goals on the Ring screens (SPEC A.1.4; fixes A.2 #3, the one fixed `GOALS` set for everyone):
 *
 * | Goal | Source order |
 * |---|---|
 * | steps | the plan's `rx.steps`; else the ring's own `ringStepGoal`; else 10 000, drawn as a default |
 * | sleep | the plan's sleep (wake − bed); else 480 min; clamped 420–720 (the sleep index's target) |
 * | active energy | the plan's day active energy; else the user-set `activeEnergyGoalKcal`; else none, no goal tick (D20) |
 * | distance, active time | none: the number alone |
 * | Day score | `dayScoreTarget` (default 70, D17) |
 *
 * `goalsFrom` is pure; `useGoals` reads the plan (the Living source) and the settings. The settings V3 adds
 * (`dayScoreTarget`, `activeEnergyGoalKcal`, A.1.7) are read when present and otherwise take their defaults.
 */
import { useMemo } from 'react';
import '@/features/living/boot';
import { useLiving } from '@/features/living/data/source';
import { useActivePlan } from '@/features/living/mode';
import type { LocalDate } from '@/living';
import { DAY_SCORE_TARGET_DEFAULT, sleepGoalMin, type SleepPlanTargets } from '@/living/sensors';
import { useSettingsStore } from '@/state/settingsStore';
import { usePlanActiveKcal } from './planEnergy';

export const DEFAULT_STEP_GOAL = 10_000;

export type GoalSource = 'plan' | 'ring' | 'setting' | 'default';

export interface RingGoals {
  steps: { value: number; source: GoalSource };
  sleepMin: { value: number; source: GoalSource };
  /** Null: no active-energy goal, so no goal tick (D20). */
  activeKcal: { value: number; source: GoalSource } | null;
  dayScore: number;
  /** The plan's sleep targets for `sleepNight` (`vsGoal`, `vsPlan`). */
  sleepPlan: SleepPlanTargets | null;
}

export interface GoalInputs {
  planSteps?: number | null;
  planSleep?: { bedH: number; wakeH: number } | null;
  planActiveKcal?: number | null;
  ringStepGoal?: number | null;
  activeEnergyGoalKcal?: number | null;
  dayScoreTarget?: number | null;
}

const pos = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
/** (S33/A36) The Day-score target rule, one for the editor and the goal: a whole number 0–100 inclusive. */
export const validDayScoreTarget = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;

/** Minutes of a planned night from its clock hours (23 → 7 is 480). */
export const plannedSleepMin = (bedH: number, wakeH: number): number => ((((wakeH - bedH) % 24) + 24) % 24) * 60;

export function goalsFrom(i: GoalInputs): RingGoals {
  const steps = pos(i.planSteps)
    ? { value: Math.round(i.planSteps), source: 'plan' as const }
    : pos(i.ringStepGoal)
      ? { value: Math.round(i.ringStepGoal), source: 'ring' as const }
      : { value: DEFAULT_STEP_GOAL, source: 'default' as const };
  const planMin = i.planSleep ? plannedSleepMin(i.planSleep.bedH, i.planSleep.wakeH) : null;
  const sleepPlan: SleepPlanTargets | null = i.planSleep ? { sleepMin: planMin, bedH: i.planSleep.bedH, wakeH: i.planSleep.wakeH } : null;
  const sleepMin = { value: sleepGoalMin(sleepPlan), source: pos(planMin) ? ('plan' as const) : ('default' as const) };
  const activeKcal = pos(i.planActiveKcal)
    ? { value: Math.round(i.planActiveKcal), source: 'plan' as const }
    : pos(i.activeEnergyGoalKcal)
      ? { value: Math.round(i.activeEnergyGoalKcal), source: 'setting' as const }
      : null;
  const dayScore = validDayScoreTarget(i.dayScoreTarget) ? Math.round(i.dayScoreTarget) : DAY_SCORE_TARGET_DEFAULT;
  return { steps, sleepMin, activeKcal, dayScore, sleepPlan };
}

/** V3's settings (A.1.7), when this build has them. */
function useV3Setting(key: 'dayScoreTarget' | 'activeEnergyGoalKcal'): number | null {
  return useSettingsStore((s) => {
    const v = (s as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : null;
  });
}

/** The goals for `date`: the plan's prescription when a plan runs, then the ring's step goal, then the defaults. */
export function useGoals(date: string, ringStepGoal?: number | null): RingGoals {
  const plan = useActivePlan();
  const rx = useLiving((s) => (plan ? (s.today(date as LocalDate)?.prescription ?? null) : null), [date, plan?.id ?? null]);
  const dayScoreTarget = useV3Setting('dayScoreTarget');
  const activeEnergyGoalKcal = useV3Setting('activeEnergyGoalKcal');
  // (S23/A18) the plan's day active energy, as Today's engine run worked it out (null until it has: the setting, else none)
  const planActiveKcal = usePlanActiveKcal(date);
  const planSteps = rx?.steps ?? null;
  const bedH = rx?.sleep?.bedH ?? null;
  const wakeH = rx?.sleep?.wakeH ?? null;
  return useMemo(
    () =>
      goalsFrom({
        planSteps,
        planSleep: bedH !== null && wakeH !== null ? { bedH, wakeH } : null,
        planActiveKcal: plan ? planActiveKcal : null,
        ringStepGoal,
        activeEnergyGoalKcal,
        dayScoreTarget,
      }),
    [planSteps, bedH, wakeH, ringStepGoal, activeEnergyGoalKcal, dayScoreTarget, plan, planActiveKcal],
  );
}
