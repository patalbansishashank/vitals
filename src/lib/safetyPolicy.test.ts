// @vitest-environment node
/** Shared safety policy (D7-03 suggestion states, D4-02 exercise symptom gate): pure unit behaviour. */
import { describe, expect, it } from 'vitest';
import type { ClinicianExerciseEnvelope, SymptomReport } from './bodyContracts';
import {
  POLICY_LABEL,
  PREDICATES,
  envelopeValid,
  exerciseSymptomGate,
  productsOfSubject,
  reasonWords,
  resolvePredicate,
  suggestionDecision,
  takenProductStatus,
  worsePolicy,
} from './safetyPolicy';

describe('suggestion policy states', () => {
  it('severity order: not suggested > clinician review > unchecked > caution > allow', () => {
    expect(worsePolicy('allow', 'caution')).toBe('caution');
    expect(worsePolicy('caution', 'unchecked')).toBe('unchecked');
    expect(worsePolicy('noSuggest', 'clinicianReview')).toBe('noSuggest');
    expect(worsePolicy('clinicianReview', 'unchecked')).toBe('clinicianReview');
  });

  it('resolves a predicate from flags, tri-state answers, allergies or as never asked', () => {
    const k = PREDICATES['kidney-disease'];
    expect(resolvePredicate(k, { markerFlags: ['kidney-disease'] })).toEqual({ answer: 'yes', source: 'marker' });
    expect(resolvePredicate(k, { screening: { 'kidney-disease': 'yes' } }).answer).toBe('yes');
    expect(resolvePredicate(k, { flags: ['kidney-disease'] }).answer).toBe('yes');
    expect(resolvePredicate(k, { screening: { 'kidney-disease': 'no' } }).answer).toBe('no');
    expect(resolvePredicate(k, { screening: {} }).answer).toBe('unknown');
    expect(resolvePredicate(k, { screening: { 'kidney-disease': 'preferNot' } }).answer).toBe('preferNot');
    // positive flags never stand in for negatives
    expect(resolvePredicate(k, { flags: ['gout'] }).answer).toBe('unknown');
    // a broader "yes" (heart condition) does not settle heart failure either way
    expect(resolvePredicate(PREDICATES['heart-failure'], { screening: { 'heart-condition': 'yes' } }).answer).toBe('unknown');
    expect(resolvePredicate(PREDICATES['heart-failure'], { screening: { 'heart-condition': 'no' } }).answer).toBe('no');
    expect(resolvePredicate(PREDICATES['milk-allergy'], { allergies: { milk: 'yes' } }).answer).toBe('yes');
    expect(resolvePredicate(PREDICATES['milk-allergy'], {}).answer).toBe('unknown');
    expect(resolvePredicate(PREDICATES.autoimmune, {}).answer).toBe('notAsked');
  });

  it('marker noSuggest subjects map to catalogue products; stale or unresolved decisions are unchecked', () => {
    expect(productsOfSubject('supp:creatine_monohydrate')).toEqual(['creatine_monohydrate']);
    expect(productsOfSubject('creatine')).toEqual(['creatine_monohydrate']);
    expect(productsOfSubject('fibre')).toEqual([]);
    const p = { id: 'iron', contraindications: [] };
    const base = { rule: 'W-L-FERRITIN-8', markerId: 'ferritin', subject: 'supp:iron', sampleDate: '2026-09-01' };
    expect(suggestionDecision(p, { markerNoSuggest: [{ ...base, stale: false, applicability: 'applicable' }] }).state).toBe('noSuggest');
    expect(suggestionDecision(p, { markerNoSuggest: [{ ...base, stale: true, applicability: 'applicable' }] }).state).toBe('unchecked');
    expect(suggestionDecision(p, { markerNoSuggest: [{ ...base, stale: false, applicability: 'unresolved' }] }).state).toBe('unchecked');
    expect(suggestionDecision(p, { markerNoSuggest: [{ ...base, stale: false, applicability: 'notApplicable' }] }).state).toBe('allow');
  });

  it('a clinician note on the contraindication means clinician review; taken products only get a status', () => {
    const d = suggestionDecision({ id: 'omega3_epa_dha', contraindications: [{ flag: 'anticoagulant', note: 'clinician' }] }, { screening: { anticoagulant: 'yes' } });
    expect(d.state).toBe('clinicianReview');
    expect(takenProductStatus(d)).toBe('review');
    expect(takenProductStatus({ state: 'unchecked' })).toBe('unchecked');
    expect(takenProductStatus({ state: 'allow' })).toBe('none');
    expect(POLICY_LABEL.noSuggest).toBe('Not suggested');
    expect(reasonWords(d)).toEqual(['blood thinner']);
  });
});

describe('exercise symptom gate (D4-02)', () => {
  const TODAY = '2026-10-10';
  const chest = (over: Partial<SymptomReport> = {}): SymptomReport => ({ id: 's1', category: 'exertionalChestDiscomfort', status: 'new', occurredOn: '2026-10-01', reportedAt: '2026-10-01T09:00:00Z', context: 'exertional', source: 'user', ...over });
  const env = (over: Partial<ClinicianExerciseEnvelope> = {}): ClinicianExerciseEnvelope => ({ id: 'e1', assessedAt: '2026-10-05', permitted: ['walking', 'cardio'], progressionAllowed: false, coversSymptomIds: ['s1'], stepsCeiling: 6000, source: 'selfEnteredClinician', ...over });

  it('asymptomatic healthy adult: clear, no clinician approval needed', () => {
    expect(exerciseSymptomGate({ screening: 'no', today: TODAY })).toMatchObject({ status: 'clear', allowsNewExercise: true, allowsProgression: true, steps: 'free' });
  });

  it('unresolved concerning exertional symptom: no new exercise, no progression, documented steps only', () => {
    expect(exerciseSymptomGate({ screening: 'no', symptoms: [chest()], today: TODAY })).toMatchObject({ status: 'suspended', reasonCode: 'concerningUnresolved', allowsNewExercise: false, allowsProgression: false, steps: 'documentedOnly', uncovered: ['s1'] });
  });

  it('a valid envelope assessed after the symptom covers it; a newer symptom, revocation or passed review date does not', () => {
    expect(exerciseSymptomGate({ symptoms: [chest()], envelopes: [env()], today: TODAY })).toMatchObject({ status: 'envelope', allowsProgression: false, envelope: { id: 'e1' } });
    expect(exerciseSymptomGate({ symptoms: [chest({ occurredOn: '2026-10-07' })], envelopes: [env()], today: TODAY }).status).toBe('suspended');
    expect(exerciseSymptomGate({ symptoms: [chest()], envelopes: [env({ revokedAt: '2026-10-08' })], today: TODAY })).toMatchObject({ status: 'suspended', reasonCode: 'envelopeNeedsReview' });
    expect(exerciseSymptomGate({ symptoms: [chest()], envelopes: [env({ reviewBy: '2026-10-09' })], today: TODAY }).status).toBe('suspended');
    expect(envelopeValid(env({ reviewBy: '2026-10-10' }), TODAY)).toBe(true);
    expect(envelopeValid(env({ assessedAt: '2026-10-11' }), TODAY)).toBe(false);
  });

  it('a legacy yes / prefer-not without context is review (not a diagnosis); a structured report clarifies it', () => {
    expect(exerciseSymptomGate({ screening: 'yes', today: TODAY })).toMatchObject({ status: 'review', reasonCode: 'legacyAnswerNeedsContext', allowsProgression: false });
    expect(exerciseSymptomGate({ screening: 'prefer-not', today: TODAY }).status).toBe('review');
    expect(exerciseSymptomGate({ screening: 'yes', symptoms: [chest({ status: 'resolved' })], today: TODAY }).status).toBe('clear');
    // a resolved or unknown-status report is not a concerning unresolved one
    expect(exerciseSymptomGate({ screening: 'no', symptoms: [chest({ status: 'unknown' })], today: TODAY }).status).toBe('clear');
  });

  it('musculoskeletal and other non-cardiorespiratory reports do not invoke the cardiovascular gate', () => {
    const knee: SymptomReport = { id: 'k', category: 'musculoskeletal', status: 'new', reportedAt: '2026-10-01T09:00:00Z', source: 'user' };
    expect(exerciseSymptomGate({ screening: 'no', symptoms: [knee], today: TODAY }).status).toBe('clear');
  });
});
