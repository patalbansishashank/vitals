import type { PairedComparison } from '@/engine/planner/domain/baselineImprovement';

export function pairedExtraFatLossKg(remainingFatDeltaKg: number | null): number | null {
  return remainingFatDeltaKg === null ? null : -remainingFatDeltaKg;
}

export function pairedExtraFatLossLabel(remainingFatDeltaKg: number | null): string {
  const extraLoss = pairedExtraFatLossKg(remainingFatDeltaKg);
  if (extraLoss === null || !Number.isFinite(extraLoss)) return 'Unavailable';
  return `${extraLoss > 0 ? '+' : ''}${extraLoss.toFixed(2)} kg`;
}

export function pairedClassification(paired: PairedComparison | undefined): string {
  if (!paired || !paired.validDraws || paired.meanFatDeltaKg === null || paired.meanMuscleDeltaKg === null) return 'Unavailable';
  if (paired.dominatesComparator) return 'Diagnostic model gain';
  const fat = paired.meanFatDeltaKg;
  const muscle = paired.meanMuscleDeltaKg;
  if (fat > 0 && muscle < 0) return 'Both worse on paired mean';
  if ((fat < 0 && muscle < 0) || (fat > 0 && muscle > 0)) return 'Tradeoff on paired mean';
  if (fat > 0 || muscle < 0) return 'Worse on paired mean';
  if (fat < 0 || muscle > 0) return 'No consistent gain across samples';
  return 'No clear change';
}
