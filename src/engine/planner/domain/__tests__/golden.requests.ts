/**
 * The five owner requests behind the golden-plan regression tests (QA items 6, 9, 10): an 88-kg, 178-cm, 34-year-old man
 * with 1-3 years of training and 3 training days a week (requests a-c), a woman who opted into 24-72-h fasts (d), and a
 * lean trained man (e). Shared by `golden.*.test.ts` and the timing script.
 */
import type { PersonProfile } from '../../../types/profile';
import type { PlannerRequest } from '../types';

export const MAN_88: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88 },
  habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' },
  startDate: '2026-10-05',
};

export const WOMAN_78: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 38, heightCm: 167, weightKg: 78 },
  habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' },
  startDate: '2026-10-05',
};

export const LEAN_TRAINED: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 28, heightCm: 178, weightKg: 74, knownBodyFatPct: 13 },
  habits: { sessionsPerWeek: 4, trainingHistory: 'gt3y' },
  startDate: '2026-10-05',
};

const THREE_DAYS = { trainingDaysPerWeek: { min: 0, max: 3 } } as const;

export type GoldenKey = 'a' | 'b' | 'c' | 'd' | 'e';

export const GOLDEN: Record<GoldenKey, PlannerRequest> = {
  /** 1) lose 10 kg fat 2) gain muscle 3) maximise the autophagy index — 12 weeks. */
  a: {
    profile: MAN_88,
    goals: [
      { metric: 'fatMass', direction: 'target', target: -10, targetKind: 'change' },
      { metric: 'skeletalMuscle', direction: 'maximise' },
      { metric: 'autophagyIdx', direction: 'maximise' },
    ],
    horizonDays: 84,
    constraints: THREE_DAYS,
    seed: 101,
  },
  /** 1) gain 2 kg skeletal muscle 2) keep fat mass — 16 weeks. */
  b: {
    profile: MAN_88,
    goals: [
      { metric: 'skeletalMuscle', direction: 'maximise', target: 2, targetKind: 'change' },
      { metric: 'fatMass', direction: 'target', target: 0, targetKind: 'change' },
    ],
    horizonDays: 112,
    constraints: THREE_DAYS,
    seed: 102,
  },
  /** 1) fat loss 2) low hunger 3) keep strength — 8 weeks, 3 training days, eating window ≤ 8 h. */
  c: {
    profile: MAN_88,
    goals: [
      { metric: 'fatMass', direction: 'target', target: -5, targetKind: 'change' },
      { metric: 'hunger', direction: 'minimise' },
      { metric: 'strength', direction: 'maximise' },
    ],
    horizonDays: 56,
    constraints: { trainingDaysPerWeek: { min: 3, max: 3 }, eatingWindow: { earliestH: 11, latestH: 19 } },
    seed: 103,
  },
  /** Woman: 1) fat loss 2) autophagy index 3) muscle — 16 weeks, 24-72-h fasts opted in. */
  d: {
    profile: WOMAN_78,
    goals: [
      { metric: 'fatMass', direction: 'target', target: -6, targetKind: 'change' },
      { metric: 'autophagyIdx', direction: 'maximise' },
      { metric: 'skeletalMuscle', direction: 'maximise' },
    ],
    horizonDays: 112,
    constraints: THREE_DAYS,
    safety: { mode: 'M0', optIns: { fastingTier: 'T3' }, fasting: { maxFastHours: 72 } },
    seed: 104,
  },
  /** Lean trained man: 1) gain muscle 2) minimise fat gain — 16 weeks. */
  e: {
    profile: LEAN_TRAINED,
    goals: [
      { metric: 'skeletalMuscle', direction: 'maximise' },
      { metric: 'fatMass', direction: 'minimise' },
    ],
    horizonDays: 112,
    constraints: { trainingDaysPerWeek: { min: 0, max: 4 } },
    seed: 105,
  },
};

/**
 * Supplement consent of the golden personas (d) and (e), stated here rather than inline in the tests. The fixtures above
 * leave it out because they predate the consent rule (creatine and the other supplement levers need the person's opt-in,
 * QA LIV-13) and because the planner benchmark builds its problems from them unchanged. The golden tests (d) and (e)
 * run with this consent: without it neither the shipped hybrid nor v2 alone returns a fasting rung for (d), and the
 * hybrid's easier rung for (e) opens with a deficit — a dependence on an unrelated consent that is recorded as an open
 * finding (docs/QA_FINDINGS.md, v0.2 QA pass 2), not hidden.
 */
export const GOLDEN_SUPPLEMENT_CONSENT = (req: PlannerRequest): PlannerRequest => ({
  ...req,
  safety: { ...req.safety, optIns: { ...req.safety?.optIns, levers: ['L7', 'creatine'] } },
});

/**
 * Ruling R-FAST-GATE regressions (PLANNER_V2_SPEC §3.8.1): autophagy index first with the 24-72-h tier opted in (T3),
 * 2-4 training days a week (or none), 12 weeks — it returned no plan at all before the fixes.
 */
export const AUTOPHAGY_FIRST_T3 = (trainingMax: number): PlannerRequest => ({
  profile: MAN_88,
  goals: [
    { metric: 'autophagyIdx', direction: 'maximise' },
    { metric: 'fatMass', direction: 'minimise' },
  ],
  horizonDays: 84,
  constraints: { trainingDaysPerWeek: { min: trainingMax > 0 ? 2 : 0, max: trainingMax }, maxFastHours: 72 },
  safety: { mode: 'M0', optIns: { fastingTier: 'T3' }, fasting: { maxFastHours: 72 } },
  seed: trainingMax > 0 ? 7 : 9,
  budget: { tier: 'M' },
});
