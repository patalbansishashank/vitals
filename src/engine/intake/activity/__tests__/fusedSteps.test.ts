/**
 * SPEC V1.4: `StepsSource` gains 'fused' (ring/phone steps-fuse/1). Its cv is 0.10 — a product default equal to a wrist
 * device until counted-step trials validate it (RESEARCH II.5); never a 95 % claim.
 */
import { describe, expect, it } from 'vitest';
import type { ActivityBase } from '../../../types/profile';
import { ACTIVITY_INTAKE_K, ACTIVITY_INTAKE_PARAMS, resolveActivity } from '../index';

const BASE: ActivityBase = { weightKg: 80, rmr0Kcal: 1750, eat0Kcal: 0, tefFraction: 0.1, rmrRoute: 'equation' };

describe("StepsSource 'fused'", () => {
  it('has its own registry entry, cv 0.10, graded C and marked unverified', () => {
    const p = ACTIVITY_INTAKE_PARAMS.find((d) => d.id.endsWith('cvStepsFused'))!;
    expect(p).toMatchObject({ value: 0.1, grade: 'C', status: 'unverified' });
    expect(ACTIVITY_INTAKE_K.cvStepsFused).toBe(0.1);
  });

  it('resolves like a measured count with cv 0.10 and keeps its source label', () => {
    const f = resolveActivity({ steps: { source: 'fused', weeklyMean: 9000 } }, BASE);
    const w = resolveActivity({ steps: { source: 'wrist', weeklyMean: 9000 } }, BASE);
    expect(f.stepsSource).toBe('fused');
    expect(f.stepsCv).toBe(0.1);
    expect(f.steps).toBe(w.steps);
    expect(f.stepsKcal).toBeCloseTo(w.stepsKcal, 9);
  });
});
