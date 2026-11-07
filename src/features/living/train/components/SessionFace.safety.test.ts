/**
 * D4-02 consumer check: the session card reads exercise review from the real providers — the living plan's
 * 'symptomHold' notice (a logged unresolved concerning symptom on a day with a session) and the current screening's
 * exercise gate — never from a profile field the store does not carry.
 */
import { describe, expect, it } from 'vitest';
import type { Notice } from '@/living';
import { evaluateScreening } from '@/features/onboarding/safetyRules';
import { sessionExerciseReview } from './SessionFace';

const hold: Notice = { id: 'symptomHold', kind: 'safety', level: 'caution', text: 'Exercise on hold: a symptom is unresolved.', command: { id: 'plan.replan', input: { reason: 'symptom' } } } as Notice;

describe('session exercise review (D4-02)', () => {
  it('a logged unresolved symptom (the living notice) holds the session in review', () => {
    expect(sessionExerciseReview({ notices: [hold] }, evaluateScreening({ symptoms: 'no' }, {}))).toBe(true);
  });

  it('a Q13 yes still without context, or prefer not, holds it in review; a no does not', () => {
    expect(sessionExerciseReview({ notices: [] }, evaluateScreening({ symptoms: 'yes' }, {}))).toBe(true);
    expect(sessionExerciseReview({ notices: [] }, evaluateScreening({ symptoms: 'prefer-not' }, {}))).toBe(true);
    expect(sessionExerciseReview({ notices: [] }, evaluateScreening({ symptoms: 'no' }, {}))).toBe(false);
  });

  it('a resolved structured report clarifies the legacy answer (no review); a concerning unresolved one keeps it', () => {
    const resolved = evaluateScreening({ symptoms: 'no' }, { symptoms: [{ id: 's1', category: 'exertionalChestDiscomfort', status: 'resolved', reportedAt: '2026-09-01T08:00:00.000Z', source: 'user' }], today: '2026-10-02' });
    expect(sessionExerciseReview({ notices: [] }, resolved)).toBe(false);
    const open = evaluateScreening({ symptoms: 'no' }, { symptoms: [{ id: 's2', category: 'exertionalChestDiscomfort', status: 'new', reportedAt: '2026-10-01T08:00:00.000Z', context: 'exertional', source: 'user' }], today: '2026-10-02' });
    expect(sessionExerciseReview({ notices: [] }, open)).toBe(true);
  });
});
