import { describe, expect, it } from 'vitest';
import { coachView, defaultMatrix, engineEligible, engineOn, policyOf, policyViolations, scoreAllowed, setPolicy, suggestedOnPolicy, usedByEngine, visibleToTrainer } from '../policy';

describe('policy matrix', () => {
  it('defaults: everything off', () => {
    const m = defaultMatrix();
    for (const p of Object.values(m)) expect(p).toMatchObject({ imported: false, coach: 'hidden', engine: false, scores: false });
    expect(policyOf(m, 'vendor:oura.readiness').imported).toBe(false);
    expect(policyViolations(m)).toEqual([]);
  });
  it('engine eligibility table (SUITE_SPEC §4.5)', () => {
    for (const s of ['sleep_sessions', 'steps', 'workouts', 'body', 'hr', 'hrv', 'skin_temp'] as const) expect(engineEligible(s)).toBe(true);
    for (const s of ['spo2', 'vendor_scores', 'resp_rate', 'motion'] as const) expect(engineEligible(s)).toBe(false);
  });
  it('invariants: engine/scores/coach need imported', () => {
    const m = setPolicy(defaultMatrix(), 'steps', { engine: true, scores: true, coach: 'daily' });
    expect(policyOf(m, 'steps')).toMatchObject({ imported: false, engine: false, scores: false, coach: 'hidden' });
    const m2 = setPolicy(m, 'steps', { imported: true, engine: true, scores: true, coach: 'daily' });
    expect(policyOf(m2, 'steps')).toMatchObject({ imported: true, engine: true, scores: true, coach: 'daily' });
    // turning import off clears the dependents
    expect(policyOf(setPolicy(m2, 'steps', { imported: false }), 'steps')).toMatchObject({ engine: false, scores: false, coach: 'hidden' });
  });
  it('ineligible streams never reach the engine; vendor never engine or scores', () => {
    const m = setPolicy(setPolicy(defaultMatrix(), 'spo2', { imported: true, engine: true, scores: true }), 'vendor_scores', { imported: true, engine: true, scores: true, coach: 'daily' });
    expect(policyOf(m, 'spo2')).toMatchObject({ engine: false, scores: true });
    expect(policyOf(m, 'vendor_scores')).toMatchObject({ engine: false, scores: false, coach: 'daily' });
    const v = setPolicy(defaultMatrix(), 'vendor:whoop.strain', { imported: true, engine: true, scores: true });
    expect(policyOf(v, 'vendor:whoop.strain')).toMatchObject({ engine: false, scores: false });
  });
  it('visibleToTrainer / usedByEngine', () => {
    const on = suggestedOnPolicy('sleep_sessions');
    expect(on).toMatchObject({ imported: true, engine: true, scores: true, coach: 'hidden' });
    expect(visibleToTrainer(on)).toBe(false);
    expect(visibleToTrainer({ ...on, coach: 'daily' })).toBe(true);
    expect(usedByEngine(on)).toBe(true);
    expect(usedByEngine({ ...on, engine: false })).toBe(false);
    expect(engineOn(setPolicy(defaultMatrix(), 'sleep_sessions', on), 'sleep_sessions')).toBe(true);
    expect(suggestedOnPolicy('vendor_scores')).toMatchObject({ engine: false, scores: false });
  });
  it('detects hand-edited violations', () => {
    const bad = { spo2: { stream: 'spo2' as const, imported: true, coach: 'hidden' as const, engine: true, scores: false }, steps: { stream: 'steps' as const, imported: false, coach: 'daily' as const, engine: false, scores: false } };
    expect(policyViolations(bad)).toHaveLength(2);
  });
  it('scoreAllowed needs every opt-in stream imported with scores on', () => {
    let m = defaultMatrix();
    const def = { optInStreams: ['workouts', 'hr'] as const };
    expect(scoreAllowed({ optInStreams: [...def.optInStreams] }, m)).toBe(false);
    m = setPolicy(m, 'workouts', { imported: true, scores: true });
    expect(scoreAllowed({ optInStreams: [...def.optInStreams] }, m)).toBe(false);
    m = setPolicy(m, 'hr', { imported: true, scores: true });
    expect(scoreAllowed({ optInStreams: [...def.optInStreams] }, m)).toBe(true);
    expect(scoreAllowed({ optInStreams: [] }, defaultMatrix())).toBe(true);
  });
  it('coachView: hidden dropped, daily keeps daily only, daily+series keeps both', () => {
    let m = defaultMatrix();
    m = setPolicy(m, 'hrv', { imported: true, coach: 'daily' });
    m = setPolicy(m, 'hr', { imported: true, coach: 'daily+series' });
    m = setPolicy(m, 'spo2', { imported: true });
    const items = [
      { stream: 'hrv' as const, shape: 'daily' as const }, { stream: 'hrv' as const, shape: 'series' as const },
      { stream: 'hr' as const, shape: 'series' as const }, { stream: 'spo2' as const, shape: 'daily' as const }, { stream: 'steps' as const, shape: 'daily' as const },
    ];
    expect(coachView(items, m)).toEqual([items[0], items[2]]);
  });
});
