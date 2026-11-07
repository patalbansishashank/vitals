// @vitest-environment node
/**
 * Coverage-corpus goal refusals (C6; D8-08, D8-09, D2-02, D7-07): the corpus asks for goals the way a person would, and
 * the production capability gate must refuse the generic endurance index, the rule-based micronutrient score, the legacy
 * autophagy index and the ApoB proxy. No corpus request carries a refused goal.
 */
import { describe, expect, it } from 'vitest';
import { isProductionGoalEligible } from '../../types/metrics';
import { CORPUS_REFUSED_GOALS, coverageCorpus, refusedGoalReport } from './corpus';

describe('coverage corpus: refused goals', () => {
  it('the gate refuses every listed goal with its capability reason, and lists every refused corpus goal', () => {
    const r = refusedGoalReport();
    expect(r.failures).toEqual([]);
    expect(r.checks.map((c) => c.metric).sort()).toEqual(Object.keys(CORPUS_REFUSED_GOALS).sort());
    expect(CORPUS_REFUSED_GOALS.enduranceCapacity).toBe('genericIndexNotTask');
    expect(CORPUS_REFUSED_GOALS.micronutrientScore).toBe('fabricatedPrecision');
  });

  it('no corpus request carries a goal the production gate refuses', () => {
    for (const e of coverageCorpus()) for (const g of e.request.goals) expect(isProductionGoalEligible(g.metric), `${e.id}: ${g.metric}`).toBe(true);
  });
});
