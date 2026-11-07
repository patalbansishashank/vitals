// @vitest-environment node
/**
 * D4-09: one versioned production comparison policy. The shipped comparators (stage, final, Hard) resolve goals to one
 * declared quantum and let the regulariser break ties only inside it; the frozen v1 comparator (d − η·R) is kept unchanged
 * as the historical benchmark and prefers a real outcome sacrifice for less burden. The policy is fingerprinted.
 */
import { describe, expect, it } from 'vitest';
import { GoalSystem as FrozenGoalSystem } from '../bench/baselines/v1/goals';
import { compareKeys } from './cmaes';
import { GoalSystem, type GoalSpec } from './goals';
import { PLANNER_COMPARISON_POLICY, PLANNER_POLICY_FINGERPRINT } from './policy';
import { PLANNER_COMPARISON_POLICY as REEXPORTED } from './hybrid';

/** One maximised goal with target 1 and baseline 0, so the desirability equals the objective. */
const SPEC: GoalSpec[] = [{ id: 'g', label: 'goal', sense: 'max', target: 1 }];

function systems() {
  const prod = new GoalSystem(SPEC);
  const frozen = new FrozenGoalSystem(SPEC as never);
  prod.setBaseline([0]);
  frozen.setBaseline([0]);
  return { prod, frozen };
}

const A = { f: [0.9], vS: 0, reg: 1 };
const B = { f: [0.85], vS: 0, reg: 0 };

describe('D4-09 production comparison policy', () => {
  it('A (d = 0.90, R = 1) beats B (d = 0.85, R = 0) in every production comparator: the gap exceeds one declared quantum', () => {
    const { prod } = systems();
    expect(prod.dRaw(0, 0.9)).toBeCloseTo(0.9, 12);
    expect(compareKeys(prod.stageKey(0, A), prod.stageKey(0, B))).toBeLessThan(0);
    expect(compareKeys(prod.finalKey(A), prod.finalKey(B))).toBeLessThan(0);
    expect(compareKeys(prod.hardKey(A, 0.5), prod.hardKey(B, 0.5))).toBeLessThan(0);
  });

  it('the frozen v1 comparator is unchanged and prefers B under d − 0.1·R (the historical benchmark)', () => {
    const { frozen } = systems();
    expect(compareKeys(frozen.stageKey(0, A), frozen.stageKey(0, B))).toBeGreaterThan(0);
  });

  it('inside one declared quantum the regulariser decides (outcome indifference), outside it never', () => {
    const { prod } = systems();
    const a = { f: [0.905], vS: 0, reg: 1 };
    const b = { f: [0.902], vS: 0, reg: 0 };
    expect(prod.level(0, prod.dRaw(0, 0.905))).toBe(prod.level(0, prod.dRaw(0, 0.902)));
    expect(compareKeys(prod.stageKey(0, b), prod.stageKey(0, a))).toBeLessThan(0);
    // one quantum more on the goal always wins, whatever the regulariser
    const c = { f: [0.915], vS: 0, reg: 50 };
    expect(compareKeys(prod.stageKey(0, c), prod.stageKey(0, b))).toBeLessThan(0);
  });

  it('near a quantisation edge a tiny outcome change can move a plan one level: the bin is a design policy, reported, not clinical equivalence', () => {
    const { prod } = systems();
    const below = { f: [0.8999], vS: 0, reg: 0 };
    const above = { f: [0.9001], vS: 0, reg: 1 };
    // 0.0002 of desirability crosses the 0.90 edge: the higher-burden plan now wins on the goal level
    expect(prod.level(0, 0.8999)).toBe(prod.level(0, 0.9001) - 1);
    expect(compareKeys(prod.stageKey(0, above), prod.stageKey(0, below))).toBeLessThan(0);
  });

  it('the policy is versioned and fingerprinted (checkpoint keys and provenance), and the hybrid re-exports it', () => {
    expect(PLANNER_COMPARISON_POLICY.version).toBe(2);
    expect(PLANNER_COMPARISON_POLICY.hybridAdapter).toMatch(/hardKey/);
    expect(PLANNER_POLICY_FINGERPRINT).toMatch(/^pol2-[0-9a-f]{8}$/);
    expect(REEXPORTED).toBe(PLANNER_COMPARISON_POLICY);
  });

  it('a missing goal output has no desirability or attainment, never benefit from its compatibility value', () => {
    const { prod } = systems();
    const f = prod.objective([0.95], undefined, [0]);
    expect(Number.isNaN(f[0]!)).toBe(true);
    expect(prod.dRaw(0, f[0]!)).toBe(0);
    // before a baseline exists no substitute is invented
    const fresh = new GoalSystem(SPEC);
    expect(Number.isNaN(fresh.objective([0.95], undefined, [0])[0]!)).toBe(true);
  });
});
