import { describe, expect, it } from 'vitest';
import { biometricPolicies, policyCalls } from '../devicePolicies';
import type { StreamPolicy } from '../types';

const on = (stream: StreamPolicy['stream'], o: Partial<StreamPolicy> = {}): StreamPolicy => ({ stream, imported: true, coach: 'hidden', engine: true, scores: true, ...o });

describe('devices matrix → bio.setPolicy', () => {
  it('maps hrv to hrv + ibi, heart_rate to hr, and weight/body fat to one body policy', () => {
    const m = biometricPolicies([on('hrv'), on('heart_rate'), on('weight', { scores: false }), on('body_fat', { engine: false, scores: false, coach: 'daily' })]);
    expect([...m.keys()].sort()).toEqual(['body', 'daily_summary', 'hr', 'hrv', 'ibi']);
    expect(m.get('body')).toMatchObject({ imported: true, engine: true, coach: 'daily' });
  });

  it('normalises with the policy rules (vendor scores never feed scores or the plan)', () => {
    expect(biometricPolicies([on('vendor_scores')]).get('vendor_scores')).toMatchObject({ imported: true, engine: false, scores: false });
  });

  it('daily_summary is the OR of what is brought in', () => {
    expect(biometricPolicies([on('steps', { engine: false, scores: false })]).get('daily_summary')).toMatchObject({ imported: true, engine: false, scores: false });
    expect(biometricPolicies([on('steps', { engine: false, scores: false }), on('heart_rate', { coach: 'daily' })]).get('daily_summary')).toMatchObject({ engine: true, scores: true, coach: 'daily' });
  });

  it('emits calls only for changed targets', () => {
    expect(policyCalls(undefined, [])).toEqual([]);
    const prev = [on('steps'), on('heart_rate')];
    expect(policyCalls(prev, prev)).toEqual([]);
    const calls = policyCalls(prev, [on('steps'), on('heart_rate', { imported: false })]);
    expect(calls.map((c) => c.stream)).toEqual(['hr']);
    expect(policyCalls([on('steps')], [on('steps'), on('hrv', { coach: 'daily' })]).map((c) => c.stream).sort()).toEqual(['daily_summary', 'hrv', 'ibi']);
    expect(calls.find((c) => c.stream === 'hr')?.policy).toEqual({ imported: false, coach: 'hidden', engine: false, scores: false });
  });
});
