/**
 * Coverage corpus of the evidence-coverage audit (PLANNER_V2_SPEC §6.3 check 1a; R6 §7.2 item 1): every goal class ×
 * opt-in combination × typical limit profile, ≈ 200 seeded requests over five personas. Pure data (no engine runs).
 */
import type { PersonProfile } from '../../types/profile';
import type { PlannerRequest, PlannerSafetyInput, PracticalConstraints, RankedGoal } from '../domain/types';

export const CORPUS_PERSONAS: Readonly<Record<string, PersonProfile>> = {
  man88: {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 38, heightCm: 180, weightKg: 88, knownBodyFatPct: 25 },
    habits: { typicalSteps: 6500, sessionsPerWeek: 2, trainingHistory: 'lt1y', bedTimeH: 23.5, wakeTimeH: 6 },
    startDate: '2026-10-05',
  },
  woman78: {
    schemaVersion: 1,
    body: { sex: 'female', ageYears: 42, heightCm: 165, weightKg: 78, knownBodyFatPct: 38 },
    habits: { typicalSteps: 6000, sessionsPerWeek: 1, trainingHistory: 'none', bedTimeH: 23, wakeTimeH: 6.5 },
    startDate: '2026-10-05',
  },
  leanTrained: {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 28, heightCm: 178, weightKg: 72, knownBodyFatPct: 13 },
    habits: { typicalSteps: 9000, sessionsPerWeek: 4, trainingHistory: 'gt3y', bedTimeH: 23, wakeTimeH: 6.5 },
    startDate: '2026-10-05',
  },
  olderWoman: {
    schemaVersion: 1,
    body: { sex: 'female', ageYears: 68, heightCm: 160, weightKg: 78 },
    habits: { typicalSteps: 5000, sessionsPerWeek: 0, trainingHistory: 'none' },
    startDate: '2026-10-05',
  },
  obeseMan: {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 45, heightCm: 175, weightKg: 118 },
    habits: { typicalSteps: 4000, sessionsPerWeek: 0, trainingHistory: 'none' },
    startDate: '2026-10-05',
  },
};

const g = (metric: RankedGoal['metric'], direction: RankedGoal['direction'], extra: Partial<RankedGoal> = {}): RankedGoal => ({ metric, direction, ...extra });

/** One goal list per goal class (and two mixed lists), most important first. */
export const CORPUS_GOALS: Readonly<Record<string, readonly RankedGoal[]>> = {
  fatLoss: [g('fatMass', 'target', { target: -6, targetKind: 'change' }), g('leanTissue', 'maximise')],
  muscle: [g('leanTissue', 'maximise'), g('fatMass', 'target', { target: 0, targetKind: 'change' })],
  strength: [g('strength', 'maximise'), g('fatMass', 'minimise')],
  transient: [g('autophagyIdx', 'maximise'), g('fatMass', 'minimise')],
  ketones: [g('bhb', 'target', { target: 1.0 }), g('hoursInKetosis', 'maximise')],
  lipids: [g('ldl', 'minimise'), g('apoB', 'minimise')],
  tgBp: [g('triglycerides', 'minimise'), g('sbp', 'minimise')],
  glycaemia: [g('insulinSensitivity', 'maximise'), g('fastingGlucose', 'minimise')],
  endurance: [g('vo2max', 'maximise'), g('enduranceCapacity', 'maximise')],
  comfort: [g('hunger', 'minimise'), g('fatMass', 'minimise')],
  expenditure: [g('rmr', 'maximise'), g('metabolicAdaptation', 'maximise')],
  weightGain: [g('scaleWeight', 'target', { target: 4, targetKind: 'change' }), g('skeletalMuscle', 'maximise')],
  other: [g('micronutrientScore', 'maximise'), g('waist', 'minimise')],
};

/** Consent combinations (the user's opt-ins; screening limits come with the persona). */
export const CORPUS_OPTINS: Readonly<Record<string, { safety?: PlannerSafetyInput; constraints?: PracticalConstraints }>> = {
  none: {},
  T2: { safety: { optIns: { fastingTier: 'T2' } } },
  T3: { safety: { optIns: { fastingTier: 'T3', levers: ['L8', 'omega3', 'L7', 'creatine'] } } },
  T4expert: { safety: { optIns: { fastingTier: 'T4' }, expertMode: true } },
  shortWindow: { safety: { optIns: { shortEatingWindow: true, levers: ['L8', 'omega3', 'L7', 'creatine'] } } },
  prefersFasting: { safety: { optIns: { fastingTier: 'T2' } }, constraints: { prefersFasting: true } },
};

/** Typical limit profiles. */
export const CORPUS_LIMITS: Readonly<Record<string, PracticalConstraints>> = {
  default: {},
  tight: {
    trainingDaysPerWeek: { min: 1, max: 2 },
    cardioDaysPerWeek: { min: 0, max: 1 },
    maxSessionMin: 45,
    eatingWindow: { earliestH: 10, latestH: 18 },
    steps: { min: 6000, max: 8000 },
    maxFastHours: 16,
  },
  loose: {
    trainingDaysPerWeek: { min: 0, max: 6 },
    cardioDaysPerWeek: { min: 0, max: 6 },
    mealsPerDay: { min: 2, max: 5 },
    steps: { min: 4000, max: 12000 },
    sleepFixed: false,
    hungerTolerance: 'high',
  },
};

export interface CorpusEntry {
  id: string;
  persona: string;
  goals: string;
  optIn: string;
  limits: string;
  request: PlannerRequest;
}

const PERSONA_ORDER = Object.keys(CORPUS_PERSONAS);

/** The corpus: goal lists × opt-ins × limit profiles (13 × 6 × 3 = 234), persona rotated by index (deterministic). */
export function coverageCorpus(horizonDays = 112): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  let i = 0;
  for (const [gk, goals] of Object.entries(CORPUS_GOALS))
    for (const [ok, opt] of Object.entries(CORPUS_OPTINS))
      for (const [lk, lim] of Object.entries(CORPUS_LIMITS)) {
        // the expert tier needs BMI ≥ 25 and no medication: give it the persona that can hold it
        const persona = ok === 'T4expert' ? 'obeseMan' : PERSONA_ORDER[i % PERSONA_ORDER.length]!;
        i++;
        const constraints: PracticalConstraints = { ...lim, ...(opt.constraints ?? {}) };
        out.push({
          id: `${gk}|${ok}|${lk}|${persona}`,
          persona,
          goals: gk,
          optIn: ok,
          limits: lk,
          request: {
            profile: CORPUS_PERSONAS[persona]!,
            goals,
            horizonDays,
            ...(Object.keys(constraints).length ? { constraints } : {}),
            ...(opt.safety ? { safety: opt.safety } : {}),
          },
        });
      }
  return out;
}
