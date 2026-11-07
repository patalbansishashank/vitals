/**
 * Today's energy and steps model for the screens (energy SPEC §V3.4, §V2.6 "Today", §V4.1; the V4 hook reads it). Pure.
 *
 *  - Steps: the fused count so far, the plan-share prior for the rest of the awake day (named, never an observation), the
 *    likely day total, the lineages and headline policy, and the goal by A.1.4 (plan, else the ring's own goal, else 10 000
 *    drawn as a default).
 *  - Energy: one authority, the engine's realised today run (actual through now + plan remainder + named priors):
 *    `soFar` (hours before now, the current hour pro-rated), `byBedtime` (the run's day total) and `plan` (the head
 *    schedule's today TEE), each labelled "estimated". No parallel ledger: without a run there are no energy numbers.
 *  - Pending candidates are listed as provisional bouts only when `provisionalOverlay` is on (D8); they never enter the run.
 *  - Quiet mode hides kcal (energy null, words only); steps and the review count stay.
 */
import { energyDay, energyToday, type EnergyBout, type EnergyHour, type EnergyToday } from './sensors/energyDay';
import type { Interval } from './sensors/types';
import type { TodayActual, TodayStepsModel } from './todayReplay';

/** A.1.4 steps goal without a plan or a ring goal (drawn as a default: a dashed goal tick). */
export const DEFAULT_STEPS_GOAL = 10_000;

export interface TodayEnergyStepsModel {
  date: string;
  quiet: boolean;
  steps: TodayStepsModel & { goal: { value: number; source: 'plan' | 'ring' | 'default' } };
  /** Null in quiet mode or until the realised today run exists. */
  energy: (EnergyToday & { label: 'estimated' }) | null;
  /**
   * (0.6.3) Today without a plan: the run is the habitual day from Your body (no plan figure; `energy.plan` is null).
   * `energyMissing: 'profile'` when the body basics (height, weight, age, sex) are missing, so there is no run.
   */
  planless?: boolean;
  energyMissing?: 'profile' | null;
  /** Pending candidates of today (hatched "to review"), only with `provisionalOverlay`. */
  provisional: Array<{ id: string; window: Interval; kcal: number | null }>;
  /** Named assumptions of today's replay (e.g. `habitualBaseline:stepsRemainderPlanShare`). */
  assumptions: string[];
  sessions: TodayActual['sessions'];
  /**
   * (r063 A16) The realised run's bouts as allocation windows: every effective session entry of today (approved or logged)
   * and the plan's sessions still ahead. The day display allocates the run's exercise energy to them (never as recovery).
   */
  bouts?: EnergyBout[];
  /** (r063 S23) The head plan's own bouts of today (the Plan figure's day display). */
  planBouts?: EnergyBout[];
}

export interface TodayModelInput {
  actual: TodayActual;
  /** The realised today run's hours (the projection schedule through today), when computed. */
  run?: readonly EnergyHour[] | null;
  /** The head schedule's today hours (the plan figure and its active energy). */
  planRun?: readonly EnergyHour[] | null;
  nowMs: number;
  quiet: boolean;
  provisional?: TodayEnergyStepsModel['provisional'];
  /** The ring's own step goal (`activity.ringStepGoal`), when known. */
  ringStepGoal?: number | null;
  /** (0.6.3) No plan: the steps "plan share" is the habitual steps, so the goal is never the plan's. */
  planless?: boolean;
  energyMissing?: 'profile' | null;
  /** (r063 A16) The realised run's bouts (`energyBoutsOf(actual.bouts)`); default none. */
  bouts?: readonly EnergyBout[];
  /** (r063 S23) The head run's planned bouts of today (`energyBoutsOf(prescribedBouts(rx))`): the plan's active energy. */
  planBouts?: readonly EnergyBout[];
}

export function todayEnergyStepsModel(i: TodayModelInput): TodayEnergyStepsModel {
  const rx = i.planless ? null : i.actual.steps.rxSteps;
  const goal = rx !== null && rx > 0 ? { value: rx, source: 'plan' as const } : i.ringStepGoal && i.ringStepGoal > 0 ? { value: i.ringStepGoal, source: 'ring' as const } : { value: DEFAULT_STEPS_GOAL, source: 'default' as const };
  let energy: TodayEnergyStepsModel['energy'] = null;
  if (!i.quiet && i.run && i.run.length > 0) {
    // (r063 S23) the plan's day over its own planned bouts: without them its exercise energy read as recovery, not active
    const plan = i.planRun && i.planRun.length > 0 ? energyDay({ hours: i.planRun, minutes: [], bouts: i.planBouts ?? [] }) : null;
    energy = { ...energyToday({ run: i.run, now: i.nowMs, planDay: plan ? { total: plan.total, active: plan.active } : null }), label: 'estimated' };
  }
  return {
    date: i.actual.date,
    quiet: i.quiet,
    steps: { ...i.actual.steps, goal },
    energy,
    provisional: i.provisional ?? [],
    assumptions: [...i.actual.assumptions],
    sessions: i.actual.sessions,
    bouts: [...(i.bouts ?? [])],
    ...(i.planBouts && i.planBouts.length > 0 ? { planBouts: [...i.planBouts] } : {}),
    ...(i.planless ? { planless: true, energyMissing: i.energyMissing ?? null } : {}),
  };
}
