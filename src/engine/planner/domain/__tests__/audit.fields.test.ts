// @vitest-environment node
/**
 * Evidence-coverage audit check 4 (PLANNER_V2_SPEC §6.3; R6 §7.2 item 4): the dead-field test. Every field of the limits
 * form, the consents, the request's limits, the screening input and the training profile is classed in `LIMIT_CLASS` and
 * reaches the plan space: relaxing a limit enlarges and tightening it shrinks the set of reachable structures and gene
 * ranges for at least one request, a value change changes the decoded plans. Decode level, no engine runs.
 *
 * The test reads the app's own mapping (limits draft → request constraints, consents → safety input): that is the "UI
 * state → request" leg of the trace, so it imports the two app modules below on purpose.
 */
import { describe, expect, it } from 'vitest';
import type { TrainingProfile } from '@/catalogues';
// eslint-disable-next-line no-restricted-imports -- the dead-field audit traces the Goals screen's limits form into the request (§6.3 check 4)
import { defaultConstraints, defaultLongestFast, profileSafetyFrom, toPracticalConstraints, toSafetyInput } from '@/features/planner/request';
// eslint-disable-next-line no-restricted-imports -- the consents' type, for the classification check
import type { SafetyOptIns } from '@/features/onboarding/safetyRules';
// eslint-disable-next-line no-restricted-imports -- the limits form's type, for the classification check
import type { ConstraintDraft } from '@/state/plannerStore';
import { LIMIT_CLASS } from '../limits';
import type { PlannerSafetyInput, PracticalConstraints } from '../types';
import { defaultFastMasking, traceFields, type AppMapping, type FieldVerdict } from '../../audit/fields';

const MAPPING = { defaultConstraints, toPracticalConstraints, toSafetyInput, profileSafetyFrom, defaultLongestFast } as unknown as AppMapping;

// every key of each audited type (the object literals must name exactly the type's keys: the compiler checks it)
const PRACTICAL: Record<keyof Required<PracticalConstraints>, true> = {
  trainingDaysPerWeek: true, allowedTrainingWeekdays: true, trainingTimeH: true, maxSessionMin: true, cardioDaysPerWeek: true,
  cardioModality: true, eatingWindow: true, mealsPerDay: true, steps: true, excludedLevers: true, fasting: true, prefersFasting: true,
  sleepFixed: true, hungerTolerance: true, maxFastHours: true, proteinFloorGPerKg: true, carbFloorGPerDay: true,
};
const DRAFT: Record<keyof ConstraintDraft, true> = {
  trainingDays: true, trainingWeekdays: true, trainingTimeH: true, maxSessionMin: true, cardioDays: true, cardioModality: true,
  earliestH: true, latestH: true, mealsPerDay: true, steps: true, longestFastH: true, prefersFasting: true, excluded: true,
  proteinFloor: true, carbFloorG: true, sleepFixed: true, hungerTolerance: true,
};
const SAFETY: Record<keyof Required<PlannerSafetyInput>, true> = {
  plannerAccess: true, mode: true, restrictions: true, plannerLocks: true, fasting: true, flags: true, optIns: true, expertMode: true,
};
const SAFETY_FASTING: Record<keyof Required<NonNullable<PlannerSafetyInput['fasting']>>, true> = {
  maxFastHours: true, maxEligibleTier: true, effectiveTier: true, optInTiers: true, shortWindowAvailable: true,
};
const SAFETY_OPTINS: Record<keyof Required<NonNullable<PlannerSafetyInput['optIns']>>, true> = { fastingTier: true, shortEatingWindow: true, levers: true };
const OPTINS: Record<keyof Required<SafetyOptIns>, true> = { fastingTier: true, shortEatingWindow: true, recentIllness: true };
const TRAINING: Record<keyof Required<TrainingProfile>, true> = {
  owned: true, access: true, refused: true, liked: true, injuries: true, cleared: true, skill: true, purchaseAllowance: true, loadsKg: true,
  capacities: true, enjoy: true,
};

/**
 * Fields that change nothing the planner reads at decode level (reported):
 *  - the screening's tier fields: the screening folds eligibility and opt-ins into `fasting.maxFastHours`, which the
 *    engine reads; the tier names themselves are never read;
 *  - training-profile loads, likes and measured capacities: read when sessions are composed from the catalogue (after the
 *    search), not by the equipment envelope that bounds the training genes.
 */
const KNOWN_DEAD = [
  'PlannerSafetyInput.fasting.effectiveTier',
  'PlannerSafetyInput.fasting.maxEligibleTier',
  'PlannerSafetyInput.fasting.optInTiers',
  'TrainingProfile.capacities',
  'TrainingProfile.liked',
  'TrainingProfile.loadsKg',
];

/**
 * Fields that are alive but not strictly metamorphic at decode level (reported, with the reason):
 *  changes      – shorter sessions raise the minimum number of sessions; keeping sleep fixed also widens the eating
 *                 window (no earlier bedtime); a protein floor is applied by repair and also raises the protein gene's
 *                 top in a deficit; screening flags (kidney disease) cap protein below the training floor; equipment,
 *                 refusals and injuries change the composed sessions, not the gene bounds;
 *  contextOnly  – hunger tolerance acts in the model (hunger cap, regulariser); access, purchases, enjoyment and skill
 *                 change the equipment envelope without changing a gene bound for these requests.
 */
const KNOWN_NOT_STRICT: Readonly<Record<string, FieldVerdict>> = {
  'PracticalConstraints.maxSessionMin': 'changes',
  'PracticalConstraints.sleepFixed': 'changes',
  'PracticalConstraints.hungerTolerance': 'contextOnly',
  'PracticalConstraints.proteinFloorGPerKg': 'changes',
  'ConstraintDraft.maxSessionMin': 'changes',
  'ConstraintDraft.proteinFloor': 'changes',
  'ConstraintDraft.sleepFixed': 'changes',
  'ConstraintDraft.hungerTolerance': 'contextOnly',
  'PlannerSafetyInput.flags': 'changes',
  'TrainingProfile.owned': 'changes',
  'TrainingProfile.access': 'contextOnly',
  'TrainingProfile.purchaseAllowance': 'contextOnly',
  'TrainingProfile.enjoy': 'contextOnly',
  'TrainingProfile.refused': 'changes',
  'TrainingProfile.injuries': 'changes',
  'TrainingProfile.cleared': 'changes',
  'TrainingProfile.skill': 'contextOnly',
};

describe('check 4: classification (LIMIT_CLASS covers every field)', () => {
  const classed = new Set(LIMIT_CLASS.map((d) => `${d.from}.${d.field}`));
  it('every field of the five audited types and of the nested screening objects is classed', () => {
    const missing = [
      ...Object.keys(PRACTICAL).map((k) => `PracticalConstraints.${k}`),
      ...Object.keys(DRAFT).map((k) => `ConstraintDraft.${k}`),
      ...Object.keys(SAFETY).map((k) => `PlannerSafetyInput.${k}`),
      ...Object.keys(SAFETY_FASTING).map((k) => `PlannerSafetyInput.fasting.${k}`),
      ...Object.keys(SAFETY_OPTINS).map((k) => `PlannerSafetyInput.optIns.${k}`),
      ...Object.keys(OPTINS).map((k) => `SafetyOptIns.${k}`),
      ...Object.keys(TRAINING).map((k) => `TrainingProfile.${k}`),
    ].filter((k) => !classed.has(k));
    expect(missing).toEqual([]);
  });
  it('practical and preference fields carry a limit group; safety, consent, value and request fields none', () => {
    for (const d of LIMIT_CLASS) {
      if (d.class === 'practical' || d.class === 'preference') expect(d.group, `${d.from}.${d.field}`).not.toBeNull();
      else expect(d.group, `${d.from}.${d.field}`).toBeNull();
    }
  });
});

describe('check 4: every field reaches the plan space (decode level)', () => {
  const traces = traceFields(MAPPING);
  it('every classed field has a perturbation and changes the request through the app mapping', () => {
    expect(traces.filter((t) => t.verdict === 'noPerturbation').map((t) => t.key)).toEqual([]);
    expect(traces.filter((t) => !t.requestChanged).map((t) => t.key)).toEqual([]);
  });
  it('no field is dead except the reported ones', () => {
    expect(traces.filter((t) => t.verdict === 'dead').map((t) => t.key).sort()).toEqual(KNOWN_DEAD);
  });
  it('limits are metamorphic (relaxing enlarges, tightening shrinks) for at least one request, except the reported ones', () => {
    const notStrict = Object.fromEntries(traces.filter((t) => t.verdict === 'changes' || t.verdict === 'contextOnly').map((t) => [t.key, t.verdict]));
    expect(notStrict).toEqual(KNOWN_NOT_STRICT);
    expect(traces.filter((t) => t.verdict === 'live').length).toBeGreaterThanOrEqual(35);
  });
  it('relaxing never shrinks and tightening never enlarges the reachable set', () => {
    expect(traces.flatMap((t) => t.nonMonotone.map((x) => `${t.key}: ${x}`))).toEqual([]);
  });
  it('the limits form no longer hides the T2/T3 opt-ins (its default longest fast follows the tier); its largest option (72 h) masks expert mode (reported)', () => {
    expect(defaultFastMasking(MAPPING)).toEqual([
      { key: 'SafetyOptIns.fastingTier', formLimitH: 72, masked: false },
      { key: 'PlannerSafetyInput.optIns.fastingTier', formLimitH: 72, masked: false },
      { key: 'PlannerSafetyInput.expertMode', formLimitH: 72, masked: true },
    ]);
    // the old fixed default (24 h) hid them
    const fixed = { ...MAPPING, defaultLongestFast: undefined } as AppMapping;
    expect(defaultFastMasking(fixed).map((x) => x.masked)).toEqual([true, true, true]);
  }, 60_000);
});
