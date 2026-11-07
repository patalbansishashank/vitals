/** A user's whole-plan muscle-loss budget, evaluated on model scenarios, never a measured safety guarantee. */
import { resolveProfile } from '../../core/resolveProfile';
import type { SimulationResult } from '../../types/result';
import type { PlannerRequest, PracticalConstraints } from './types';

export const MUSCLE_RETENTION_MARGIN = 'userMuscleRetention';
export const MUSCLE_RETENTION_BASIS = 'modelSkeletalMuscle' as const;

export type MuscleRetentionBudget = NonNullable<PracticalConstraints['muscleRetention']>;
export interface MuscleRetentionReview {
  status: 'withinBudget' | 'overBudget' | 'unavailable';
  basis: typeof MUSCLE_RETENTION_BASIS;
  baselineKg: number;
  baselineDate: string;
  floorKg: number;
  maxLossPct: number;
  worstKg: number | null;
  worstLossPct: number | null;
  /** Normalised optimisation margin; NaN means unevaluated, never satisfied. */
  margin: number;
  reason: 'modelScenario' | 'missingTrajectory' | 'unsupportedTrajectory';
}

/** Freeze once from the original plan profile. An existing baseline survives weight changes and re-plans verbatim. */
export function freezeMuscleRetention<T extends PlannerRequest>(request: T, initialKg?: number): T {
  const budget = request.constraints?.muscleRetention;
  if (!budget || budget.baseline) return request;
  const kg = initialKg ?? resolveProfile(request.profile).body.skeletalMuscleKg;
  return {
    ...request,
    constraints: {
      ...request.constraints,
      muscleRetention: {
        ...budget,
        baseline: {
          kg,
          date: request.startDate ?? request.profile.startDate ?? '2026-01-05',
          basis: MUSCLE_RETENTION_BASIS,
        },
      },
    },
  };
}

export function muscleRetentionProblems(budget: MuscleRetentionBudget | null | undefined): string[] {
  if (!budget) return [];
  const errors: string[] = [];
  if (!Number.isFinite(budget.maxLossPct) || budget.maxLossPct < 0 || budget.maxLossPct >= 100)
    errors.push('The modeled muscle-loss budget must be at least 0% and less than 100%.');
  if (
    budget.baseline &&
    (!(budget.baseline.kg > 0) ||
      !Number.isFinite(budget.baseline.kg) ||
      budget.baseline.basis !== MUSCLE_RETENTION_BASIS ||
      !/^\d{4}-\d{2}-\d{2}$/.test(budget.baseline.date))
  )
    errors.push('The modeled muscle-loss budget needs its original model baseline and date.');
  return errors;
}

/** Check EVERY remaining day, including temporary breaches followed by regain. The budget never renews at check-in. */
export function reviewMuscleRetention(
  budget: MuscleRetentionBudget,
  sim: Pick<SimulationResult, 'daily' | 'meta'>,
): MuscleRetentionReview {
  const baselineKg = budget.baseline?.kg ?? NaN;
  const floorKg = baselineKg * (1 - budget.maxLossPct / 100);
  const base = {
    basis: MUSCLE_RETENTION_BASIS,
    baselineKg,
    baselineDate: budget.baseline?.date ?? '',
    floorKg,
    maxLossPct: budget.maxLossPct,
  };
  const unavailable = (reason: 'missingTrajectory' | 'unsupportedTrajectory'): MuscleRetentionReview => ({
    ...base,
    status: 'unavailable',
    worstKg: null,
    worstLossPct: null,
    margin: NaN,
    reason,
  });
  if (muscleRetentionProblems(budget).length || !Number.isFinite(floorKg))
    return unavailable('missingTrajectory');
  const status = sim.meta.outputStatus?.skeletalMuscle;
  const values = sim.daily.skeletalMuscle;
  if (!values?.length) return unavailable('missingTrajectory');
  if (
    status &&
    (status.fromDay ?? 0) < values.length &&
    !['estimated', 'predicted', 'scenario', 'conditional'].includes(status.status)
  )
    return unavailable('unsupportedTrajectory');
  let worstKg = baselineKg;
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) return unavailable('missingTrajectory');
    worstKg = Math.min(worstKg, value);
  }
  const worstLossPct = Math.max(0, (100 * (baselineKg - worstKg)) / baselineKg);
  const margin = (budget.maxLossPct - worstLossPct) / 5;
  return {
    ...base,
    status: margin >= -1e-9 ? 'withinBudget' : 'overBudget',
    worstKg,
    worstLossPct,
    margin: Math.abs(margin) < 1e-9 ? 0 : margin,
    reason: 'modelScenario',
  };
}
