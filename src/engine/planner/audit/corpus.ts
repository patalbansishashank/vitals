import { CURRENT_TISSUE_FAT_ENDPOINT } from '@/lib/bodyContracts';
/**
 * Coverage corpus of the evidence-coverage audit (PLANNER_V2_SPEC §6.3 check 1a; R6 §7.2 item 1): every goal class ×
 * opt-in combination × typical limit profile, ≈ 200 seeded requests over five personas. Pure data (no engine runs).
 */
import { goalCapability, isProductionGoalEligible, type MetricId } from '../../types/metrics';
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

/**
 * D4-05: a change target for the quantities whose capability requires a target/band (`TARGET_BAND_REQUIRED`), signed by
 * the direction asked for (mmHg for systolic pressure, mmol/L for glucose). Audit stand-ins, not recommended targets.
 */
export const AUDIT_BAND_CHANGE: Readonly<Record<string, number>> = { sbp: 5, glucose: 0.3, fastingGlucose: 0.3, bhb: 0.5, glycogenTotal: 100 };

/** An audit goal on `metric` in direction `dir`: open-ended, or a signed change target where a target is required. */
export function auditGoal(metric: RankedGoal['metric'], dir: 'up' | 'down'): RankedGoal {
  const clinicalBase: Readonly<Record<string, number>> = { sbp: 140, glucose: 6, fastingGlucose: 6 };
  if (clinicalBase[metric] !== undefined) return { metric, direction: 'target', target: clinicalBase[metric]! + (dir === 'up' ? 1 : -1) * AUDIT_BAND_CHANGE[metric]! };
  const direction = dir === 'up' ? 'maximise' : 'minimise';
  const capability = goalCapability(metric);
  const step = AUDIT_BAND_CHANGE[metric as string] ?? 1;
  const endpoint = metric === 'bodyFatPct' ? { endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT } : {};
  // Signed aspirations are synthetic audit inputs in each metric's units, never a target recommendation.
  if (capability.satiation === 'required' || (!capability.objectives.includes(direction) && capability.objectives.includes('target')))
    return { metric, direction: 'target', target: dir === 'up' ? step : -step, targetKind: 'change', ...endpoint };
  return { metric, direction, ...endpoint };
}

const g = (metric: RankedGoal['metric'], direction: RankedGoal['direction'], extra: Partial<RankedGoal> = {}): RankedGoal => ({ metric, direction, ...extra });

/** One goal list per goal class (and two mixed lists), most important first. */
export const CORPUS_GOALS: Readonly<Record<string, readonly RankedGoal[]>> = {
  fatLoss: [g('fatMass', 'target', { target: -6, targetKind: 'change' }), g('leanTissue', 'maximise')],
  muscle: [g('leanTissue', 'maximise'), g('fatMass', 'target', { target: 0, targetKind: 'change' })],
  strength: [g('strength', 'maximise'), g('fatMass', 'minimise')],
  transient: [g('autophagyIdx', 'maximise'), g('fatMass', 'minimise')],
  ketones: [g('bhb', 'target', { target: 1.0 }), g('hoursInKetosis', 'maximise')],
  lipids: [g('ldl', 'minimise'), g('apoB', 'minimise')],
  // D4-05: blood pressure and glycaemia need a target (no open-ended minimise); a modest change target stands in
  tgBp: [g('triglycerides', 'minimise'), g('sbp', 'target', { target: -5, targetKind: 'change' })],
  glycaemia: [g('insulinSensitivity', 'maximise'), g('fastingGlucose', 'target', { target: -0.3, targetKind: 'change' })],
  endurance: [g('vo2max', 'maximise'), g('enduranceCapacity', 'maximise')],
  comfort: [g('hunger', 'minimise'), g('fatMass', 'minimise')],
  expenditure: [g('rmr', 'maximise'), g('metabolicAdaptation', 'maximise')],
  weightGain: [g('scaleWeight', 'target', { target: 4, targetKind: 'change' }), g('skeletalMuscle', 'maximise')],
  other: [g('micronutrientScore', 'maximise'), g('waist', 'minimise')],
};

/**
 * Goals the corpus asks for as a person would, which the production capability gate must refuse (C6; D2-02, D7-07,
 * D8-08, D8-09), with the capability reason expected for each: the legacy autophagy research index, the ApoB proxy
 * response, the generic endurance index (task-scoped research only; no race-time or task conversion) and the rule-based
 * micronutrient score (fabricated precision; known nutrient intake planning stays available through food targets).
 * Every corpus request drops them (`coverageCorpus`) and the static audit checks the gate still refuses each one
 * (`refusedGoalReport`). A goal that becomes optimizable again must be removed from this list by a capability decision,
 * never by the audit.
 */
export const CORPUS_REFUSED_GOALS: Readonly<Partial<Record<MetricId, string>>> = {
  autophagyIdx: 'noHealthObjective',
  apoB: 'proxyResponseUnvalidated',
  enduranceCapacity: 'genericIndexNotTask',
  micronutrientScore: 'fabricatedPrecision',
};

/** One refused corpus goal as the audit sees it: still refused by the gate, and with the expected capability reason. */
export interface RefusedGoalCheck {
  metric: MetricId;
  goalSets: string[];
  refused: boolean;
  reasonCode: string;
  expectedReason: string | null;
}

/**
 * Every goal of `CORPUS_GOALS` that the production gate refuses, plus every listed refusal (pure; no engine runs). A
 * failure is a refused goal the list does not name, a listed goal the gate now accepts, or a changed reason code.
 */
export function refusedGoalReport(): { checks: RefusedGoalCheck[]; failures: string[] } {
  const sets = new Map<MetricId, string[]>();
  for (const [gk, all] of Object.entries(CORPUS_GOALS)) for (const x of all) if (!isProductionGoalEligible(x.metric)) sets.set(x.metric, [...(sets.get(x.metric) ?? []), gk]);
  for (const m of Object.keys(CORPUS_REFUSED_GOALS) as MetricId[]) if (!sets.has(m)) sets.set(m, []);
  const checks: RefusedGoalCheck[] = [...sets.entries()].map(([metric, goalSets]) => ({
    metric,
    goalSets,
    refused: !isProductionGoalEligible(metric),
    reasonCode: goalCapability(metric).reasonCode,
    expectedReason: CORPUS_REFUSED_GOALS[metric] ?? null,
  }));
  const failures: string[] = [];
  for (const c of checks) {
    if (c.expectedReason === null) failures.push(`${c.metric}: refused by the gate (${c.reasonCode}) but not listed in CORPUS_REFUSED_GOALS`);
    else if (!c.refused) failures.push(`${c.metric}: listed as refused but the production gate accepts it`);
    else if (c.reasonCode !== c.expectedReason) failures.push(`${c.metric}: capability reason ${c.reasonCode}, expected ${c.expectedReason}`);
  }
  return { checks, failures };
}

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
  // corpus requests are production requests (C6): a goal the capability gate refuses (`CORPUS_REFUSED_GOALS`) is left
  // out, so every entry compiles; the goal set's key stays as named
  for (const [gk, all] of Object.entries(CORPUS_GOALS)) {
    const goals = all.filter((x) => isProductionGoalEligible(x.metric));
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
  }
  return out;
}
