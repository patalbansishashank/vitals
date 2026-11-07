/**
 * C6 goal capability gate on the Goals screen and its request (D2-02 for the autophagy index), and the order-independent
 * lock intersection with explicit units (C5/D4-01).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CONTRACT_VERSIONS } from '@/lib/bodyContracts';
import { EMPTY_RUN, pickPlannerValues, usePlannerStore } from '@/state/plannerStore';
import { withSystemWrite } from '@/state/scope';
import type { ScreeningOutcome } from '@/features/onboarding';
import { GOAL_METRICS, goalMetric, newGoal } from './catalogue';
import { goalClasses, goalRelations } from './relations';
import { buildPlannerRequest, defaultConstraints, lockComparator, lockUnit, mergeLocks, plannableGoals, toSafetyInput, type SafetySnapshot } from './request';
import { PROFILE, START } from './__tests__/fixtures';
import type { GoalDraft } from '@/state/plannerStore';

const outcome = {
  plannerAccess: 'full',
  mode: 'M0',
  restrictions: [],
  plannerLocks: [
    { id: 'deficit-cap', value: 25, reasons: [{ rule: 'HC-E3', source: 'default' }] },
    { id: 'max-fast', value: 24, reasons: [{ rule: 'HC-F1', source: 'default' }] },
    { id: 'no-deficit', reasons: [{ rule: 'HC-X', source: 'default' }] },
  ],
  fasting: { maxEligibleTier: 'T3', eligibleMaxHours: 24, maxFastHours: 24, effectiveTier: 'T1', optInTiers: ['T2', 'T3'], bindingReasons: [], shortWindowAvailable: true },
  flags: [],
} as unknown as SafetySnapshot['outcome'] & Pick<ScreeningOutcome, 'fasting'>;
const safety: SafetySnapshot = { outcome, plannerAccess: 'full', optedTier: null, shortWindowOn: false };

const draft = (metric: string, mode: GoalDraft['mode'] = 'raise', key = metric): GoalDraft => ({ key, metric: metric as never, mode, amount: mode === 'lose' ? 5 : null, strength: 'should', functional: null });
const request = (goals: GoalDraft[]) => buildPlannerRequest({ goals, horizonDays: 84, startDate: START, constraints: defaultConstraints(PROFILE.habits), strictness: 'balanced', profile: PROFILE, safety });

beforeEach(() => {
  localStorage.clear();
  withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({}), run: EMPTY_RUN }));
});

describe('goal catalogue reads the capability registry (C6)', () => {
  it('the autophagy index is never a goal; its reason points at the fasting preference, not a longer fast', () => {
    const a = goalMetric('autophagyIdx')!;
    expect(a.eligible).toBe(false);
    expect(a.availability).toBe('unavailable');
    expect(a.modes).toEqual([]);
    expect(a.reason).toMatch(/fasting preference/);
    expect(a.reason).not.toMatch(/longer fast/i);
    // still found by a plain search, with its reason
    expect(a.aliases).toContain('autophagy');
  });

  it('every ineligible metric has a reason and mTOR/AMPK stay non-optimizable', () => {
    for (const m of GOAL_METRICS) if (!m.eligible) expect(m.reason).toBeTruthy();
    expect(goalMetric('mtorIdx')!.eligible).toBe(false);
    expect(goalMetric('ampkIdx')!.eligible).toBe(false);
    expect(goalMetric('adherence')!.eligible).toBe(false);
    expect(goalMetric('fatMass')!.eligible).toBe(true);
    expect(goalMetric('hunger')!.availability).toBe('scenario');
  });

  it('a draft for a metric with no modes does not crash (saved goals shown as information)', () => {
    expect(newGoal(goalMetric('autophagyIdx')!).mode).toBe('raise');
  });
});

describe('request gate (D2-02): saved or imported ASI goals never reach the planner', () => {
  it('an ASI-first goal list optimizes only the eligible goals, re-ranked, with the capability version', () => {
    const r = request([draft('autophagyIdx'), draft('fatMass', 'lose'), draft('leanTissue', 'keep')]);
    expect(r.goals.map((g) => g.metric)).toEqual(['fatMass', 'leanTissue']);
    expect(r.goals.every((g) => g.capabilityVersion === CONTRACT_VERSIONS.goalCapability)).toBe(true);
    // rank 0 tolerance ladder applies to fat mass now (it is goal 1)
    expect(r.goals[0]!.metric).toBe('fatMass');
  });

  it('an ASI-only list sends no goal (the planner refuses an empty list; nothing optimizes the index)', () => {
    expect(request([draft('autophagyIdx')]).goals).toEqual([]);
    expect(plannableGoals([draft('autophagyIdx')])).toEqual([]);
    expect(plannableGoals([draft('autophagyIdx'), draft('fatMass', 'lose')]).map((g) => g.metric)).toEqual(['fatMass']);
  });

  it('the store refuses a new ineligible goal at every entry point (goals.edit)', () => {
    const s = usePlannerStore.getState();
    expect(s.addGoal(newGoal(goalMetric('autophagyIdx')!))).toBe('ineligible');
    expect(usePlannerStore.getState().goals).toEqual([]);
    expect(s.addGoal(newGoal(goalMetric('fatMass')!, 'lose'))).toBe('added');
  });

  it('an ineligible saved goal pulls against nothing (no fasting edge from a signalling index)', () => {
    expect(goalClasses({ metric: 'autophagyIdx' as never, mode: 'raise' })).toEqual([]);
    expect(goalRelations([draft('leanTissue', 'gain'), draft('autophagyIdx')])).toEqual([]);
  });
});

describe('locks (C5/D4-01): caps by min, floors by max, in every order, with explicit units', () => {
  const perms = <T,>(xs: readonly T[]): T[][] => (xs.length <= 1 ? [xs.slice()] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

  it('every lab cap and floor intersects to the strictest value independently of order', () => {
    const lists = [
      [{ id: 'fat-cap', value: 30 }, { id: 'carb-floor', value: 100 }, { id: 'caffeine-cap', value: 400 }],
      [{ id: 'fat-cap', value: 15 }, { id: 'carb-floor', value: 130 }, { id: 'creatine-cap', value: 3 }],
      [{ id: 'fat-cap', value: 25 }, { id: 'caffeine-cap', value: 200 }, { id: 'creatine-cap', value: 0 }],
    ];
    for (const order of perms(lists)) {
      const m = new Map(mergeLocks(...order).map((l) => [l.id, l.value]));
      expect(m.get('fat-cap')).toBe(15);
      expect(m.get('carb-floor')).toBe(130);
      expect(m.get('caffeine-cap')).toBe(200);
      expect(m.get('creatine-cap')).toBe(0);
    }
  });

  it('comparators come from the typed definitions, never from the value', () => {
    expect(lockComparator('surplus-cap')).toBe('cap');
    expect(lockComparator('carb-floor')).toBe('floor');
    expect(lockComparator('min-eating-window')).toBe('floor');
    expect(lockComparator('max-fast')).toBe('cap');
    expect(lockComparator('no-deficit')).toBeNull();
    expect(lockUnit('surplus-cap')).toBe('% of maintenance');
    expect(lockUnit('fat-cap')).toBe('%E');
    expect(lockUnit('protein-floor')).toBe('g/kg/d');
    expect(lockUnit('rate-cap')).toBe('% body weight per week');
  });

  it('screening locks reach the planner with their unit, source and mandatory status', () => {
    const locks = toSafetyInput(safety).plannerLocks!;
    const cap = locks.find((l) => l.id === 'deficit-cap')!;
    expect(cap).toMatchObject({ value: 25, unit: '%', source: 'screening', mandatory: true });
    const flag = locks.find((l) => l.id === 'no-deficit')!;
    expect(flag.unit).toBeUndefined();
    expect(flag.mandatory).toBe(true);
  });
});
