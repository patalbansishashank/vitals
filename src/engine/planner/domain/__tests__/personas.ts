/** Shared test personas and requests for the planner domain tests (18 §7.7 face-validity personas). */
import type { PersonProfile } from '../../../types/profile';
import type { PlannerRequest, RankedGoal } from '../types';

export const MAN_95: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95, knownBodyFatPct: 28 },
  habits: { typicalSteps: 6000, sessionsPerWeek: 2, trainingHistory: 'lt1y' },
  startDate: '2026-10-05',
};

export const WOMAN_62: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 },
  habits: { typicalSteps: 8000, sessionsPerWeek: 3, trainingHistory: '1to3y' },
  startDate: '2026-10-05',
};

export const LEAN_MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 28, heightCm: 178, weightKg: 72, knownBodyFatPct: 13 },
  habits: { typicalSteps: 9000, sessionsPerWeek: 4, trainingHistory: 'gt3y' },
  startDate: '2026-10-05',
};

export const OLDER_WOMAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 68, heightCm: 160, weightKg: 78 },
  habits: { typicalSteps: 5000, sessionsPerWeek: 0, trainingHistory: 'none' },
  startDate: '2026-10-06',
};

export const OBESE_MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 45, heightCm: 175, weightKg: 118 },
  habits: { typicalSteps: 4000, sessionsPerWeek: 0, trainingHistory: 'none' },
  startDate: '2026-10-07',
};

export const PERSONAS: Record<string, PersonProfile> = { MAN_95, WOMAN_62, LEAN_MAN, OLDER_WOMAN, OBESE_MAN };

export const FAT_LOSS_KEEP_LEAN: RankedGoal[] = [
  { metric: 'fatMass', direction: 'target', target: -8, targetKind: 'change' },
  { metric: 'leanTissue', direction: 'maximise' },
];

export const AUTOPHAGY_FIRST: RankedGoal[] = [
  { metric: 'autophagyIdx', direction: 'maximise' },
  { metric: 'fatMass', direction: 'minimise' },
];

export function request(profile: PersonProfile, goals: RankedGoal[], extra: Partial<PlannerRequest> = {}): PlannerRequest {
  return { profile, goals, horizonDays: 112, ...extra };
}
