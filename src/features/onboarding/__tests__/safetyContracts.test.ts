/**
 * Safety-gate contracts of 2026-10-18 (C5): tri-state screening answers (D7-03) and the exercise symptom gate (D4-02).
 * Unknown stays unknown; a Q13 yes / prefer-not is review (no new exercise prescription or progression; held by the
 * planner gate from the flag), not a diagnosis; structured concerning symptoms suspend autonomous exercise until a valid envelope covers them; asymptomatic
 * blood pressure and musculoskeletal limitations keep their own envelopes; healthy adults need no clinician approval.
 */
import type { ClinicianExerciseEnvelope, SymptomReport } from '@/lib/bodyContracts';
import { evaluateScreening, legacySymptomReports, screeningAnswerMap, screeningExerciseGate, suggestionSafetyFrom, type PlannerLockId, type SafetyContext, type ScreeningAnswers, type ScreeningOutcome } from '../safetyRules';
import { STANDARD_ANSWERS as STD } from '../testing';

const ev = (patch: Partial<ScreeningAnswers> = {}, ctx: SafetyContext = {}) => evaluateScreening({ ...STD, ...patch }, ctx);
const lock = (o: ScreeningOutcome, id: PlannerLockId) => o.plannerLocks.find((l) => l.id === id);

const TODAY = '2026-10-10';
const chest: SymptomReport = { id: 's1', category: 'exertionalChestDiscomfort', status: 'unexplained', occurredOn: '2026-10-01', reportedAt: '2026-10-01T09:00:00Z', context: 'exertional', source: 'user' };
const envelope: ClinicianExerciseEnvelope = { id: 'e1', assessedAt: '2026-10-04', permitted: ['walking'], progressionAllowed: false, coversSymptomIds: ['s1'], stepsCeiling: 5000, source: 'selfEnteredClinician' };

describe('tri-state screening answers (D7-03)', () => {
  it('yes / no per item, prefer-not kept, unanswered absent (never a negative screen)', () => {
    const m = screeningAnswerMap({ conditions: 'yes', conditionItems: ['kidney'], medications: 'prefer-not', pregnancy: 'no' });
    expect(m['kidney-disease']).toBe('yes');
    expect(m['liver-disease']).toBe('no');
    expect(m.anticoagulant).toBe('preferNot');
    expect(m.pregnant).toBe('no');
    expect(m['planning-pregnancy']).toBe('no');
    expect(m.gout).toBeUndefined(); // metabolic unanswered
    expect(screeningAnswerMap({})).toEqual({});
    // "yes" with no item picked settles no item
    expect(screeningAnswerMap({ conditions: 'yes' })['kidney-disease']).toBeUndefined();
    expect(screeningAnswerMap({ pregnancy: 'planning' })).toMatchObject({ pregnant: 'no', 'planning-pregnancy': 'yes' });
    expect(screeningAnswerMap({ symptoms: 'prefer-not' })['exercise-symptoms']).toBe('preferNot');
  });
});

describe('shared suggestion-policy input (D7-03)', () => {
  it('no answers, or answers waiting for import review, are unknown; answered food rules settle milk and soy', () => {
    expect(suggestionSafetyFrom(null)).toEqual({ screening: {} });
    expect(suggestionSafetyFrom(STD, { pendingReview: true }).screening).toEqual({});
    const s = suggestionSafetyFrom(STD, { diet: { rulesComplete: true, allergies: ['milk'] }, markers: { flags: ['kidney-disease'], noSuggest: [] }, refused: ['psyllium'] });
    expect(s.screening!['kidney-disease']).toBe('no');
    expect(s.allergies).toEqual({ milk: 'yes', soy: 'no' });
    expect(s.markerFlags).toEqual(['kidney-disease']);
    expect(s.refused).toEqual(['psyllium']);
    expect(suggestionSafetyFrom(STD, { diet: { rulesComplete: false, allergies: [] } }).allergies).toBeUndefined();
  });
});

describe('exercise symptom gate in the screening (D4-02)', () => {
  it('asymptomatic healthy adult: no exercise lock and no clinician acknowledgement', () => {
    const o = ev({ symptoms: 'no' });
    expect(lock(o, 'no-exercise-prescription')).toBeUndefined();
    expect(o.requiredAcknowledgements.map((r) => r.id)).toEqual(['disclaimer']);
  });

  it('legacy Q13 yes or prefer-not: review (no new exercise prescription), not a diagnosed symptom', () => {
    for (const a of ['yes', 'prefer-not'] as const) {
      const o = ev({ symptoms: a });
      // the review is held by the planner gate from the flag (lifted by a later report), not by a stored lock (0C)
      expect(lock(o, 'no-exercise-prescription')).toBeUndefined();
      expect(o.flags).toContain('exercise-symptoms');
      expect(lock(o, 'exercise-light-moderate')).toBeDefined(); // the existing gate is intact
      expect(screeningExerciseGate({ symptoms: a })).toMatchObject({ status: 'review', reasonCode: 'legacyAnswerNeedsContext' });
    }
    expect(legacySymptomReports({ symptoms: 'yes' }, '2026-01-01T00:00:00Z')).toEqual([{ id: 'legacy-q13', category: 'other', status: 'reviewNeeded', reportedAt: '2026-01-01T00:00:00Z', context: 'unknown', source: 'legacyScreening' }]);
    expect(legacySymptomReports({ symptoms: 'no' }, null)).toEqual([]);
  });

  it('a structured concerning unresolved symptom suspends exercise prescription even after a "no" answer', () => {
    const o = ev({ symptoms: 'no' }, { symptoms: [chest], today: TODAY });
    expect(lock(o, 'no-exercise-prescription')?.reasons).toEqual([{ rule: 'HC-X4', source: 'symptoms' }]);
  });

  it('a valid reviewed envelope lifts the suspension; without a known date it cannot authorize', () => {
    expect(lock(ev({ symptoms: 'yes' }, { symptoms: [chest], exerciseEnvelopes: [envelope], today: TODAY }), 'no-exercise-prescription')).toBeUndefined();
    expect(lock(ev({ symptoms: 'yes' }, { symptoms: [chest], exerciseEnvelopes: [envelope] }), 'no-exercise-prescription')).toBeDefined();
    expect(lock(ev({ symptoms: 'yes' }, { symptoms: [chest], exerciseEnvelopes: [{ ...envelope, revokedAt: '2026-10-09' }], today: TODAY }), 'no-exercise-prescription')).toBeDefined();
    // a resolved report clarifies the legacy answer
    expect(lock(ev({ symptoms: 'yes' }, { symptoms: [{ ...chest, status: 'resolved' }], today: TODAY }), 'no-exercise-prescription')).toBeUndefined();
  });

  it('asymptomatic high blood pressure and a joint problem keep their own envelopes, not the symptom block', () => {
    const bp = ev({ conditions: 'yes', conditionItems: ['high-blood-pressure'] });
    expect(lock(bp, 'exercise-light-moderate')).toBeDefined();
    expect(lock(bp, 'no-exercise-prescription')).toBeUndefined();
    const joint = ev({ musculoskeletal: 'yes' });
    expect(lock(joint, 'exercise-low-impact')).toBeDefined();
    expect(lock(joint, 'no-exercise-prescription')).toBeUndefined();
  });
});
