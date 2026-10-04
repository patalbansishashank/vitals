/**
 * Reference people (MODEL_SPEC §9.3), expressed through the real input schema (`PersonProfile`).
 * Shared by validation, band calibration and benchmarks. The core test fixture `core/__tests__/fixtures.ts` has a
 * different `MAN` (35 y, 178 cm, 82 kg); these follow the spec text and are named the same on purpose — import them
 * from here in anything that validates against §9.
 *
 * Body fat is entered as a DXA-equivalent measurement (`knownBodyFatPct`) so fat mass is exactly the stated value.
 */
import { resolveProfile } from '../../core/resolveProfile';
import type { PersonProfile } from '../../types';
import type { BodyInputs } from '../../body/types';

/** Monday. Programs that need a weekday alignment rely on it. */
export const START_DATE = '2026-10-05';

export interface PersonaSpec {
  sex: 'male' | 'female';
  ageYears: number;
  heightCm: number;
  weightKg: number;
  /** DXA-equivalent body fat %, when known. */
  bodyFatPct?: number;
  steps?: number;
  /** Years of resistance training (body module) and training history bucket (habits). */
  trainingYears?: number;
  trainingHistory?: 'none' | 'lt1y' | '1to3y' | 'gt3y';
  sessionsPerWeek?: number;
  /** 0 = only lifting, 1 = only cardio. */
  liftingCardioMix?: number;
  menopause?: 'pre' | 'peri' | 'post';
  habitualProteinGPerKg?: number;
  habitualCarbPctEnergy?: number;
  bmiOnlyBodyFat?: boolean;
  extraBody?: Partial<BodyInputs>;
  extra?: Partial<PersonProfile>;
}

/** Build a PersonProfile from a compact description. */
export function person(s: PersonaSpec): PersonProfile {
  const body: BodyInputs = {
    sex: s.sex,
    ageYears: s.ageYears,
    heightCm: s.heightCm,
    weightKg: s.weightKg,
    ...(s.bodyFatPct !== undefined && !s.bmiOnlyBodyFat ? { knownBodyFatPct: s.bodyFatPct, knownBodyFatSource: 'dxa' as const } : {}),
    ...(s.trainingYears !== undefined ? { trainingYears: s.trainingYears, trainingQuality: 'regular' as const } : {}),
    ...(s.menopause ? { menopause: s.menopause } : {}),
    ...s.extraBody,
  };
  return {
    schemaVersion: 1,
    body,
    habits: {
      typicalSteps: s.steps ?? 7000,
      ...(s.trainingHistory ? { trainingHistory: s.trainingHistory } : {}),
      ...(s.sessionsPerWeek !== undefined ? { sessionsPerWeek: s.sessionsPerWeek } : {}),
      ...(s.liftingCardioMix !== undefined ? { lifingCardioMix: s.liftingCardioMix } : {}),
      ...(s.habitualProteinGPerKg !== undefined ? { habitualProteinGPerKg: s.habitualProteinGPerKg } : {}),
      ...(s.habitualCarbPctEnergy !== undefined ? { habitualCarbPctEnergy: s.habitualCarbPctEnergy } : {}),
    },
    ...(s.menopause ? { menopause: s.menopause } : {}),
    startDate: START_DATE,
    ...s.extra,
  };
}

/** §9.3 MAN: 35 y, 180 cm, 90 kg, 25 % BF, 7 000 steps. */
export const MAN: PersonProfile = person({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, bodyFatPct: 25, steps: 7000 });

/** §9.3 WOMAN: 42 y, 165 cm, 72 kg, 36 % BF. */
export const WOMAN: PersonProfile = person({ sex: 'female', ageYears: 42, heightCm: 165, weightKg: 72, bodyFatPct: 36, steps: 7000 });

/** §9.3 LEAN_MAN: 25 y, 178 cm, 75 kg, 12 % BF, resistance-trained for 3 y (3 sessions/week). */
export const LEAN_MAN: PersonProfile = person({
  sex: 'male',
  ageYears: 25,
  heightCm: 178,
  weightKg: 75,
  bodyFatPct: 12,
  steps: 7000,
  trainingYears: 3,
  trainingHistory: '1to3y',
  sessionsPerWeek: 3,
  liftingCardioMix: 0,
});

export const PERSONAS = { MAN, WOMAN, LEAN_MAN } as const;

// ------------------------------------------------------------------ baseline-energy matching

/**
 * Persona whose engine baseline TDEE0 (02 §4.13 init, computed by `resolveProfile`) equals a study's measured baseline
 * expenditure, by solving the habitual step count (TDEE0 is linear in steps for a fixed macro split). Use it when a
 * study prescribes ABSOLUTE intakes and reports the participants' weight-stable energy need; state the mapping in the
 * scenario notes. Steps are clamped to [1 000, 40 000]; the achieved TDEE0 is returned so callers can assert the match.
 */
export function personWithTdee(spec: PersonaSpec, targetTdeeKcal: number): { profile: PersonProfile; steps: number; tdee0Kcal: number } {
  const at = (steps: number): number => resolveProfile(person({ ...spec, steps })).tdee0Kcal;
  const t1 = at(4000);
  const t2 = at(12000);
  const slope = (t2 - t1) / 8000;
  const steps = Math.min(40000, Math.max(1000, Math.round(4000 + (targetTdeeKcal - t1) / slope)));
  return { profile: person({ ...spec, steps }), steps, tdee0Kcal: at(steps) };
}

/** Baseline maintenance (kcal/d) the engine derives for a profile (TDEE0). */
export function tdee0Of(profile: PersonProfile): number {
  return resolveProfile(profile).tdee0Kcal;
}
