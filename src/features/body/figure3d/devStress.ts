// Geometry QA only: add fat beyond the estimator's 60% ceiling while preserving its lean mass and regional shares.
// Never used by the Body page or the health estimate. Explicit opt-in on /dev/figure via stress=1.
import { allocateRegional, type BodyState } from '@/engine/body';

export function fatStressState(state: BodyState, bodyFatPct: number): BodyState {
  if (!Number.isFinite(bodyFatPct) || bodyFatPct <= 60 || bodyFatPct > 75) return state;
  const fatMassKg = (state.fatFreeMassKg * bodyFatPct) / (100 - bodyFatPct);
  const regional = allocateRegional(
    { fat: state.fat, muscle: state.muscle },
    { fatMassKg, skeletalMuscleKg: state.skeletalMuscleKg },
  );
  return {
    ...state,
    fatMassKg,
    weightKg: fatMassKg + state.fatFreeMassKg,
    fat: regional.fat,
    muscle: regional.muscle,
    measuredCircumferences: undefined,
  };
}
