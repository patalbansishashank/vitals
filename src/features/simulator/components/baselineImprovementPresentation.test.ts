import { describe, expect, it } from 'vitest';
import type { PairedComparison } from '@/engine/planner/domain/baselineImprovement';
import { pairedClassification, pairedExtraFatLossKg, pairedExtraFatLossLabel } from './baselineImprovementPresentation';

const paired = (fat: number, muscle: number, dominatesComparator = false): PairedComparison => ({
  draws: 32,
  validDraws: 32,
  meanFatDeltaKg: fat,
  meanMuscleDeltaKg: muscle,
  fatDeltaRangeKg: [fat, fat],
  muscleDeltaRangeKg: [muscle, muscle],
  dominatesComparator,
  allMembersNonWorse: dominatesComparator,
  membersWithinMuscleBudget: 32,
});

describe('paired routine comparison presentation', () => {
  it('shows a negative remaining-fat delta as positive extra fat loss', () => {
    expect(pairedExtraFatLossKg(-0.42)).toBeCloseTo(0.42);
    expect(pairedExtraFatLossLabel(-0.42)).toBe('+0.42 kg');
    expect(pairedExtraFatLossKg(0.18)).toBeCloseTo(-0.18);
    expect(pairedExtraFatLossKg(null)).toBeNull();
  });

  it('distinguishes gains, mixed means, both-worse means, and inconsistent samples', () => {
    expect(pairedClassification(paired(-0.3, 0.2, true))).toBe('Diagnostic model gain');
    expect(pairedClassification(paired(-0.3, -0.2))).toBe('Tradeoff on paired mean');
    expect(pairedClassification(paired(0.3, 0.2))).toBe('Tradeoff on paired mean');
    expect(pairedClassification(paired(0.3, -0.2))).toBe('Both worse on paired mean');
    expect(pairedClassification(paired(-0.3, 0.2))).toBe('No consistent gain across samples');
  });
});
