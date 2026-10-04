// @vitest-environment node
/**
 * VO2max prior with an activity intake (R1 §3.4, MODEL_SPEC §5.5): the Jackson PA-R comes from the 10 §4.14 selector row
 * nearest to PAL0 (not to the steps), so a desk worker and a heavy manual labourer with the same step count get different
 * priors, and a profile without an intake keeps the steps row (pre-intake behaviour).
 */
import { buildModelParams } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import type { PersonProfile } from '../../types/profile';
import { activityConstants, activityModule } from './index';

const params = buildModelParams([activityModule]);
const p = (habits: PersonProfile['habits']): PersonProfile => ({ schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90 }, habits, startDate: '2026-10-05' });
const v0 = (habits: PersonProfile['habits']): number => activityConstants(params, resolveProfile(p(habits))).v0;
const g = (id: string): number => params.values[params.index.get(`activity.${id}`)!]!;

describe('activity VO2max prior and the activity intake', () => {
  it('same steps (9 000): desk → lower PA-R row than heavy manual; the gap is the Jackson PA-R slope × the row difference', () => {
    const steps = { source: 'wrist' as const, weeklyMean: 9000 };
    const desk = v0({ activity: { work: 'desk', steps } });
    const heavy = v0({ activity: { work: 'manualHeavy', steps } });
    expect(heavy).toBeGreaterThan(desk);
    // desk PAL ≈ 1.5 → row 1 (1.45) or 2 (1.6); heavy PAL ≈ 2.2 → row 5 (2.2)
    const slope = g('jacksonPar');
    const gap = (heavy - desk) / slope;
    expect(gap).toBeGreaterThan(0);
    expect([g('parVeryActive') - g('parSedentary'), g('parVeryActive') - g('parLight')].some((x) => Math.abs(x - gap) < 1e-9)).toBe(true);
  });

  it('without an intake the prior follows the steps row exactly as before', () => {
    expect(v0({ typicalSteps: 9000 })).toBe(v0({ typicalSteps: 8500 }));
    expect(v0({ typicalSteps: 4000 })).toBeLessThan(v0({ typicalSteps: 15000 }));
    expect(activityConstants(params, resolveProfile(p({ activity: { work: 'desk' } }))).habSteps).toBe(resolveProfile(p({ activity: { work: 'desk' } })).habits.typicalSteps);
  });
});
