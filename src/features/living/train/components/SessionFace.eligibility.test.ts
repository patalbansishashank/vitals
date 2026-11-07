/**
 * A1-005 (D4-02) consumer check: the session card reads the authoritative CURRENT exercise eligibility Today carries
 * (`TodayView.exerciseEligibility`) for its own scope. A covering current clinician envelope restores exactly the scopes it
 * permits despite an older positive screening answer; a revoked or expired envelope (or a new unresolved symptom) holds them
 * again at once; the legacy screening/notice reading applies only when the field is absent or of an unknown version.
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_EXERCISE_ELIGIBILITY_VERSION, type CurrentExerciseEligibility, type Notice } from '@/living';
import { evaluateScreening } from '@/features/onboarding/safetyRules';
import { sessionExerciseReview, sessionScope } from './SessionFace';
import type { SessionModel } from '../session';

const yes = evaluateScreening({ symptoms: 'yes' }, {});
const no = evaluateScreening({ symptoms: 'no' }, {});
const hold: Notice = { id: 'symptomHold', kind: 'safety', level: 'caution', text: 'Exercise on hold: a symptom is unresolved.', command: { id: 'plan.replan', input: { reason: 'symptom' } } } as Notice;

function eligibility(over: Partial<CurrentExerciseEligibility>): CurrentExerciseEligibility {
  return {
    version: CURRENT_EXERCISE_ELIGIBILITY_VERSION,
    asOf: '2026-10-05',
    status: 'clear',
    reasonCode: 'noConcern',
    allowsNewExercise: true,
    allowsProgression: true,
    permitted: ['resistance', 'cardio', 'walking', 'steps', 'other'],
    held: [],
    steps: { status: 'unchanged', target: 9000, prescribed: 9000, ceiling: null, ceilingSource: 'none' },
    symptomIds: [],
    fingerprint: 'f0',
    ...over,
  };
}

const lift = { kind: 'resistance', session: { prescription: { kind: 'resistance' } } } as unknown as SessionModel;
const walk = { kind: 'cardio', session: { prescription: { kind: 'cardio', modality: 'walk' } } } as unknown as SessionModel;
const ride = { kind: 'cardio', session: { prescription: { kind: 'cardio', modality: 'cycle' } } } as unknown as SessionModel;

describe('session scope', () => {
  it('maps a lift to resistance, a walk to walking and other cardio to cardio', () => {
    expect(sessionScope(lift)).toBe('resistance');
    expect(sessionScope(walk)).toBe('walking');
    expect(sessionScope(ride)).toBe('cardio');
  });
});

describe('authoritative current exercise eligibility (A1-005)', () => {
  it('an unresolved concerning symptom without a covering envelope holds every autonomous scope (Review)', () => {
    const el = eligibility({ status: 'suspended', reasonCode: 'concerningUnresolved', allowsNewExercise: false, allowsProgression: false, permitted: [], held: ['resistance', 'cardio', 'walking', 'steps', 'other'], symptomIds: ['s1'] });
    for (const m of [lift, walk, ride]) expect(sessionExerciseReview({ notices: [], exerciseEligibility: el }, no, sessionScope(m))).toBe(true);
  });

  it('a covering current envelope restores exactly its permitted scope despite an older positive screening answer', () => {
    const el = eligibility({ status: 'envelope', reasonCode: 'envelopeCovers', allowsNewExercise: false, allowsProgression: false, permitted: ['walking', 'steps'], held: ['resistance', 'cardio', 'other'], envelopeId: 'env-1', symptomIds: [] });
    // the legacy reading (a Q13 yes, a symptom notice) would hold the walk too: the authoritative field wins
    expect(sessionExerciseReview({ notices: [hold], exerciseEligibility: el }, yes, sessionScope(walk))).toBe(false);
    expect(sessionExerciseReview({ notices: [hold], exerciseEligibility: el }, yes, sessionScope(lift))).toBe(true);
    expect(sessionExerciseReview({ notices: [hold], exerciseEligibility: el }, yes, sessionScope(ride))).toBe(true);
  });

  it('revocation or expiry of the envelope holds the scope again at once (the next evaluation)', () => {
    const revoked = eligibility({ status: 'suspended', reasonCode: 'concerningUnresolved', allowsNewExercise: false, allowsProgression: false, permitted: [], held: ['walking', 'steps', 'resistance', 'cardio', 'other'], symptomIds: ['s1'], fingerprint: 'f1' });
    expect(sessionExerciseReview({ notices: [], exerciseEligibility: revoked }, no, sessionScope(walk))).toBe(true);
  });

  it('a resolved symptom (clear) lifts the hold even while the legacy screening answer still reads yes', () => {
    expect(sessionExerciseReview({ notices: [], exerciseEligibility: eligibility({}) }, yes, sessionScope(lift))).toBe(false);
  });

  it('a scope neither permitted nor held follows whether new exercise is allowed', () => {
    const el = eligibility({ status: 'envelope', reasonCode: 'envelopeCovers', allowsNewExercise: false, permitted: ['steps'], held: [] });
    expect(sessionExerciseReview({ notices: [], exerciseEligibility: el }, no, 'cardio')).toBe(true);
    expect(sessionExerciseReview({ notices: [], exerciseEligibility: { ...el, allowsNewExercise: true } }, no, 'cardio')).toBe(false);
  });

  it('absent or of an unknown version: the legacy screening/notice reading', () => {
    expect(sessionExerciseReview({ notices: [hold] }, no, 'resistance')).toBe(true);
    expect(sessionExerciseReview({ notices: [] }, yes, 'resistance')).toBe(true);
    expect(sessionExerciseReview({ notices: [] }, no, 'resistance')).toBe(false);
    const future = eligibility({ version: CURRENT_EXERCISE_ELIGIBILITY_VERSION + 1 });
    expect(sessionExerciseReview({ notices: [hold], exerciseEligibility: future }, no, 'resistance')).toBe(true);
  });
});
