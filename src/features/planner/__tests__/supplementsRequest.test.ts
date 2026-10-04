/** The planner request for each supplement state (SUITE_SPEC §13.2; E18). */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '@/engine/planner/domain/context';
import type { ScreeningOutcome } from '@/features/onboarding';
import { buildPlannerRequest, effectiveConstraints, requestHash, supplementSnapshot, type SafetySnapshot } from '../request';
import { GOALS, PROFILE, START } from './fixtures';

const outcome = {
  plannerAccess: 'full',
  mode: 'M0',
  restrictions: [],
  plannerLocks: [],
  fasting: { maxEligibleTier: 'T3', eligibleMaxHours: 24, maxFastHours: 24, effectiveTier: 'T1', optInTiers: ['T2', 'T3'], bindingReasons: [], shortWindowAvailable: true },
  flags: [],
} as unknown as SafetySnapshot['outcome'] & Pick<ScreeningOutcome, 'fasting'>;

const base: SafetySnapshot = { outcome, plannerAccess: 'full', optedTier: null, shortWindowOn: false };
const req = (supplements: unknown) => {
  const c = effectiveConstraints({ longestFastH: 16 }, PROFILE.habits);
  return buildPlannerRequest({ goals: GOALS, horizonDays: 84, startDate: START, constraints: c, strictness: 'balanced', profile: PROFILE, safety: { ...base, ...supplementSnapshot(supplements) } });
};
const row = (supplementId: string, state: string) => ({ supplementId, state, dose: 5, unit: 'g', timesOfDay: ['morning'] });

describe('planner request per supplement state', () => {
  it('v1 "open" and v2 open-without-rows give the same request as before (creatine consent only)', () => {
    const v1 = req({ stance: 'open', taking: [] });
    const legacy = buildPlannerRequest({ goals: GOALS, horizonDays: 84, startDate: START, constraints: effectiveConstraints({ longestFastH: 16 }, PROFILE.habits), strictness: 'balanced', profile: PROFILE, safety: { ...base, supplementsOpen: true } });
    expect(v1.safety?.optIns?.levers).toEqual(['creatine']);
    expect(requestHash(v1)).toBe(requestHash(legacy));
    expect(requestHash(req({ _v: 2, stance: 'open', rows: [] }))).toBe(requestHash(legacy));
  });

  it('unanswered and food first: no supplement levers', () => {
    expect(req(undefined).safety?.optIns?.levers).toEqual([]);
    expect(req({ _v: 2, stance: 'food_first', rows: [] }).safety?.optIns?.levers).toEqual([]);
  });

  it('taking: the lever is consented (with food first too)', () => {
    const r = req({ _v: 2, stance: 'taking', rows: [row('creatine_monohydrate', 'taking'), row('omega3_epa_dha', 'taking')] });
    expect(r.safety?.optIns?.levers).toEqual(['creatine', 'omega3']);
    expect(r.constraints?.excludedLevers ?? []).not.toContain('L7');
  });

  it('on hand: consented, nothing to buy', () => {
    expect(req({ _v: 2, stance: 'onHand', rows: [row('psyllium', 'onHand')] }).safety?.optIns?.levers).toEqual(['fibre']);
  });

  it('not for me: refused through the excluded levers, even with the open stance', () => {
    const r = req({ _v: 2, stance: 'open', rows: [row('creatine_monohydrate', 'notForMe')] });
    expect(r.safety?.optIns?.levers).toEqual([]);
    expect(r.constraints?.excludedLevers).toContain('L7');
  });

  it('the engine accepts every variant', () => {
    for (const s of [undefined, { stance: 'open', taking: [] }, { _v: 2, stance: 'taking', rows: [row('creatine_monohydrate', 'taking')] }, { _v: 2, stance: 'open', rows: [row('omega3_epa_dha', 'notForMe')] }]) {
      expect(compileRequest(req(s)).problems).toEqual([]);
    }
  });
});
