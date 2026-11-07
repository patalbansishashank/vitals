/**
 * C5/D4-03: one current-safety encoding. The Simulator/lifecycle profile (`engineSafety`, read by `simulatorProfileNow`)
 * and the planner request (`profileSafetyFrom`) must encode the same screening identically, or a planner certificate made
 * under the current screening can never verify at a lifecycle boundary.
 */
import { describe, expect, it } from 'vitest';
import type { SafetyAccess } from '@/features/onboarding';
import type { OptInTier, SafetyFlag } from '@/features/onboarding/safetyRules';
import { engineSafety } from '@/features/simulator/profile';
import { profileSafetyFrom } from './request';

const ALL: SafetyFlag[] = [
  'under-18', 'age-65-74', 'age-75-plus', 'sarcopenia-risk', 'pregnant', 'planning-pregnancy', 'pregnancy-undisclosed', 'ed-history', 'ed-undisclosed',
  'scoff-risk', 'type-1-diabetes', 'insulin', 'sulfonylurea', 'sglt2-inhibitor', 'metformin', 'glp1', 'other-glucose-lowering', 'diabetes-diet-only',
  'diabetes-undisclosed', 'heart-condition', 'high-blood-pressure', 'kidney-disease', 'liver-disease', 'stroke', 'conditions-undisclosed', 'gout',
  'kidney-stones', 'gallstones', 'pancreatitis', 'rare-metabolic', 'metabolic-undisclosed', 'diuretic', 'raas-blocker', 'other-antihypertensive',
  'lithium', 'topiramate-zonisamide', 'corticosteroid', 'qt-prolonging', 'chemotherapy', 'antacid', 'anticoagulant', 'thyroid-hormone',
  'other-medication', 'medications-undisclosed', 'exercise-symptoms', 'supervised-exercise-only', 'musculoskeletal', 'heavy-alcohol',
];

const access = (flags: SafetyFlag[], optedTier: OptInTier | null) =>
  ({ outcome: { flags, mode: 'M0' }, fasting: { optedTier } }) as unknown as Pick<SafetyAccess, 'outcome' | 'fasting'>;

describe('current-safety encoder parity (C5)', () => {
  it('every single screening flag encodes identically for the Simulator profile and the planner request', () => {
    for (const f of ALL) for (const tier of [null, 'T2'] as const) expect(engineSafety(access([f], tier)), f).toEqual(profileSafetyFrom([f], 'M0', tier));
  });

  it('combined flags (diabetes medication priority, medication interactions, exercise restriction) agree', () => {
    const flags: SafetyFlag[] = ['metformin', 'insulin', 'antacid', 'musculoskeletal', 'exercise-symptoms', 'kidney-disease'];
    expect(engineSafety(access(flags, 'T3'))).toEqual(profileSafetyFrom(flags, 'M0', 'T3'));
    expect(engineSafety(access([], null)).flags.fastingOptIn).toBe('none');
  });
});
