/**
 * Provider → consumer wiring of the request (C5/C6/C7; D4-02, D7-02, D7-03): the screen's request builder carries the
 * tri-state screening answers and symptom facts to the planner when the caller has them (and leaves requests without
 * them byte-identical), takes the shared suggestion policy for supplement levers, and never sends a goal whose forecast
 * a measured out-of-domain lab baseline makes Unsupported.
 */
import { describe, expect, it } from 'vitest';
import type { ScreeningOutcome } from '@/features/onboarding/safetyRules';
import { screeningAnswerMap, suggestionSafetyFrom } from '@/features/onboarding/safetyRules';
import type { SymptomReport } from '@/lib/bodyContracts';
import type { GoalDraft } from '@/state/plannerStore';
import { buildPlannerRequest, defaultConstraints, goalDomainIssue, plannableGoals, profileSafetyFrom, requestHash, supplementSnapshot, type SafetySnapshot } from './request';
import { PROFILE, START } from './__tests__/fixtures';

const outcome = {
  plannerAccess: 'full',
  mode: 'M0',
  restrictions: [],
  plannerLocks: [],
  flags: [],
  fasting: { maxFastHours: 24, maxEligibleTier: 'T1', effectiveTier: 'T1', optInTiers: [], shortWindowAvailable: false },
} as unknown as SafetySnapshot['outcome'] & Pick<ScreeningOutcome, 'fasting'>;
const safety: SafetySnapshot = { outcome, plannerAccess: 'full', optedTier: null, shortWindowOn: false };
const GOALS: GoalDraft[] = [
  { key: 'g1', metric: 'fatMass', mode: 'lose', amount: 5, strength: 'should', functional: null },
  { key: 'g2', metric: 'ldl', mode: 'lower', amount: null, strength: 'nice', functional: null },
];
const build = (s: SafetySnapshot, profile = PROFILE) =>
  buildPlannerRequest({ goals: GOALS, horizonDays: 84, startDate: START, constraints: defaultConstraints(profile.habits), strictness: 'balanced', profile, safety: s });

describe('request ← screening contract (C5, D4-02, D7-03)', () => {
  it('carries the tri-state answers and symptom facts when given; a request without them is unchanged', () => {
    const plain = build(safety);
    expect(plain.profile.safety?.flags.answers).toBeUndefined();
    expect(plain.profile.safety?.flags.symptoms).toBeUndefined();
    const answers = screeningAnswerMap({ conditions: 'no', symptoms: 'prefer-not' });
    const symptom: SymptomReport = { id: 's1', category: 'exertionalChestDiscomfort', status: 'new', reportedAt: '2026-10-01T08:00:00.000Z', context: 'exertional', source: 'user' };
    const withFacts = build({ ...safety, answers, symptoms: [symptom] });
    expect(withFacts.profile.safety?.flags.answers).toEqual(answers);
    expect(withFacts.profile.safety?.flags.answers?.['exercise-symptoms']).toBe('preferNot');
    expect(withFacts.profile.safety?.flags.symptoms).toEqual([symptom]);
    // the facts are part of the request's identity (C7), and their absence keeps old hashes
    expect(requestHash(withFacts)).not.toBe(requestHash(plain));
    expect(requestHash(build(safety))).toBe(requestHash(plain));
    expect(requestHash(build({ ...safety, answers: {} }))).toBe(requestHash(plain));
  });

  it('profileSafetyFrom keeps unknown distinct from no', () => {
    const flags = profileSafetyFrom([], 'M0', null, { answers: screeningAnswerMap({}) }).flags;
    expect(flags.answers).toBeUndefined(); // nothing answered: no negative screen is invented
    expect(profileSafetyFrom([], 'M0', null, { answers: { 'kidney-disease': 'no' } }).flags.answers).toEqual({ 'kidney-disease': 'no' });
  });

  it('supplement levers take the shared suggestion policy: kidney disease keeps the open stance from adding creatine', () => {
    const section = { _v: 2 as const, stance: 'open' as const, rows: [] };
    expect(supplementSnapshot(section).supplementLevers).toEqual(['creatine']);
    const kidney = suggestionSafetyFrom({ conditions: 'yes', conditionItems: ['kidney'] });
    expect(supplementSnapshot(section, kidney).supplementLevers).toEqual([]);
    const screenedNo = suggestionSafetyFrom({ conditions: 'no' });
    expect(supplementSnapshot(section, screenedNo).supplementLevers).toEqual(['creatine']);
    // unknown is never a negative screen: an unanswered screening does not open a new lever either
    expect(supplementSnapshot(section, suggestionSafetyFrom(null)).supplementLevers).toEqual([]);
    // a product the person already takes stays theirs whatever the policy says (logs and habits are never removed)
    const taking = { _v: 2 as const, stance: 'taking' as const, rows: [{ supplementId: 'creatine_monohydrate', state: 'taking' as const, dose: 5, unit: 'g', timesOfDay: ['morning' as const] }] };
    expect(supplementSnapshot(taking, kidney).supplementLevers).toEqual(['creatine']);
  });
});

describe('request ← lab domain (D7-02)', () => {
  const outside = { ...PROFILE, labs: { ldlMmolL: 8.0 }, labMeta: { ldlMmolL: { source: 'marker' as const, outOfDomain: true } } };

  it('a goal forecast from an out-of-domain measured baseline is Unsupported and never sent; the other goals plan', () => {
    expect(goalDomainIssue(outside, 'ldl')).toBe('own');
    expect(goalDomainIssue(outside, 'fatMass')).toBeNull();
    expect(goalDomainIssue(null, 'ldl')).toBeNull();
    expect(plannableGoals(GOALS, outside).map((g) => g.metric)).toEqual(['fatMass']);
    const req = build(safety, outside);
    expect(req.goals.map((g) => g.metric)).toEqual(['fatMass']);
    // the measurement itself travels unchanged
    expect(req.profile.labs?.ldlMmolL).toBe(8.0);
  });

  it('an in-domain measured baseline keeps its goal', () => {
    const inside = { ...PROFILE, labs: { ldlMmolL: 3.4 }, labMeta: { ldlMmolL: { source: 'marker' as const } } };
    expect(goalDomainIssue(inside, 'ldl')).toBeNull();
    expect(build(safety, inside).goals.map((g) => g.metric)).toEqual(['fatMass', 'ldl']);
  });
});
