/**
 * D2-02 migration fixture, read from the evidence side: a goal on the autophagy index saved before the index became a
 * research display survives reload, import and sync as the person wrote it (history is not rewritten or remapped to
 * another numeric health target), it never becomes plannable, and nothing about it lengthens a fast, narrows an eating
 * window or lowers protein. The articles say exactly this ("not a goal", "no plan lengthens a fast…"); this keeps the
 * stored-data path in step with them.
 */
import { describe, expect, it } from 'vitest';
import { GOAL_CAPABILITY, isProductionGoalEligible, type MetricId } from '@/engine/types/metrics';
import { capabilityAllowsOptimization } from '@/lib/bodyContracts';
import { isPlannerState, mergePlannerStates, pickPlannerValues } from '@/state/plannerStore';

/** A planner document as an earlier release stored it: the index ranked first, with a numeric amount. */
const SAVED = {
  goals: [
    { key: 'g-asi', metric: 'autophagyIdx', mode: 'raise', amount: 10, strength: 'must', functional: 'mean' },
    { key: 'g-fat', metric: 'fatMass', mode: 'lose', amount: 4, strength: 'should', functional: null },
  ],
  horizonDays: 84,
  startDate: '2026-09-01',
  constraints: { longestFastH: 16, prefersFasting: false, proteinFloor: 1.6, earliestH: 8, latestH: 20 },
  strictness: 'balanced',
  lastRequestHash: 'abc123',
  lastRunAt: '2026-09-01T08:00:00.000Z',
  // a field a newer release may add: never a reason to reject the document
  futureField: { x: 1 },
};

const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('a saved autophagy goal across reload, import and sync', () => {
  it('reloads as written: same metric, key, mode and amount; never remapped to another goal', () => {
    expect(isPlannerState(roundTrip(SAVED))).toBe(true); // import validation accepts it
    const v = pickPlannerValues(roundTrip(SAVED));
    const asi = v.goals.find((g) => g.key === 'g-asi');
    expect(asi).toEqual({
      key: 'g-asi',
      metric: 'autophagyIdx',
      mode: 'raise',
      amount: 10,
      strength: 'must',
      functional: 'mean',
    });
    expect(v.goals.map((g) => g.metric)).toEqual(['autophagyIdx', 'fatMass']);
  });

  it('leaves the fasting, eating-window and protein limits exactly as the person set them', () => {
    const v = pickPlannerValues(roundTrip(SAVED));
    expect(v.constraints).toEqual(SAVED.constraints);
  });

  it('is idempotent across repeated reloads, exports and merges (import and sync)', () => {
    const once = pickPlannerValues(roundTrip(SAVED));
    const twice = pickPlannerValues(roundTrip(once));
    expect(twice).toEqual(once);
    // merge-mode import or sync with the same document, in either order, changes nothing
    expect(mergePlannerStates(once, roundTrip(SAVED))).toEqual(once);
    expect(mergePlannerStates(roundTrip(SAVED), once)).toEqual(once);
    // a device with no goals takes the incoming document as it is
    expect(mergePlannerStates({ goals: [] }, roundTrip(SAVED))).toEqual(once);
    expect(mergePlannerStates(mergePlannerStates({ goals: [] }, SAVED), SAVED)).toEqual(once);
  });

  it('never becomes plannable: the capability registry gives the index no objective', () => {
    const v = pickPlannerValues(roundTrip(SAVED));
    const plannable = v.goals.filter((g) => isProductionGoalEligible(g.metric));
    expect(plannable.map((g) => g.metric)).toEqual(['fatMass']);
    expect(capabilityAllowsOptimization(GOAL_CAPABILITY.autophagyIdx)).toBe(false);
    expect(GOAL_CAPABILITY.autophagyIdx.objectives).toEqual([]);
  });

  it('is not turned into a fasting-depth goal (BHB, ketosis hours) on reload', () => {
    const fastingProxies: MetricId[] = ['bhb', 'hoursInKetosis', 'ketoAdaptation', 'mtorIdx', 'ampkIdx'];
    const v = pickPlannerValues(roundTrip(SAVED));
    expect(v.goals.some((g) => fastingProxies.includes(g.metric))).toBe(false);
  });
});
