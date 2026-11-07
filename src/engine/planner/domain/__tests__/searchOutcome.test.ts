// @vitest-environment node
/**
 * D4-08: finite search is not proof. Feasibility rows carry `foundUnderModel | notFoundWithinBudget | provenPolicyConflict
 * | outsideSupportedDomain | uncertainResponse | stopped` with the tier, budget, seed and the optimizer's actual stop
 * reason; only an analytic policy floor is a proven conflict (with its exact bound); legacy `unattainable` rows read as
 * not found (reason unknown) unless they carry a stored proof; route and time-to-target sentences are estimates, never a
 * fastest-safe deadline or "impossible".
 */
import { describe, expect, it } from 'vitest';
import { SEARCH_OUTCOME_LABEL, CURRENT_TISSUE_FAT_ENDPOINT } from '@/lib/bodyContracts';
import { compileRequest } from '../context';
import { collapseOutcome, collapseText } from '../ladderPlanner';
import { feasibilityOutcome, searchOutcomeOf, tttText } from '../planner';
import { reachText, rungReachText, safetyLimitProof, targetReach } from '../reach';
import { MAN_95, request } from './personas';

const RES = { complete: true, stoppedAt: null, provenance: { seed: 'abc', tier: 'S' as const, budgetEU: 900, euUsed: 640, requests: 0, cacheHits: 0, stageEU: {}, resumedFrom: null } };

describe('D4-08 search outcomes', () => {
  it('a miss after a small budget is notFoundWithinBudget with the tier, budget, seed and stop reason — never proof', () => {
    const o = searchOutcomeOf('unattainable', RES);
    expect(o).toMatchObject({ outcome: 'notFoundWithinBudget', seed: 'abc', termination: 'budgetComplete', budget: { tier: 'S', euBudget: 900, euUsed: 640 } });
    expect(o.proofIds).toBeUndefined();
    expect(SEARCH_OUTCOME_LABEL[o.outcome]).toBe('Not found');
    expect(searchOutcomeOf('notImprovable', RES).outcome).toBe('notFoundWithinBudget');
  });

  it('a stopped run stays stopped; a missing engine output is outside the supported domain, never unattainable', () => {
    expect(searchOutcomeOf('unattainable', { ...RES, complete: false, stoppedAt: 'S3' })).toMatchObject({ outcome: 'stopped', termination: 'stopped:S3' });
    expect(searchOutcomeOf('unattainable', RES, { unavailable: true }).outcome).toBe('outsideSupportedDomain');
    expect(searchOutcomeOf('attainable', RES).outcome).toBe('foundUnderModel');
    expect(searchOutcomeOf('attainableAloneNotJointly', RES).outcome).toBe('foundUnderModel');
  });

  it('an explicit target beyond a policy floor is provenPolicyConflict with the exact bound and witness id', () => {
    const ctx = compileRequest(request(MAN_95, [{ metric: 'bodyFatPct', direction: 'target', target: 2, endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT }]));
    const proof = safetyLimitProof(ctx, 0, 2)!;
    expect(proof.id).toBe('HC-P5.bfFloor');
    expect(proof.unit).toBe('%');
    expect(proof.bound).toBe(ctx.caps.bfFloorPct);
    expect(proof.text).toMatch(/body-fat safety floor/);
    expect(searchOutcomeOf('unattainable', RES, { proofIds: [proof.id] })).toMatchObject({ outcome: 'provenPolicyConflict', proofIds: ['HC-P5.bfFloor'] });
    expect(safetyLimitProof(ctx, 0, ctx.caps.bfFloorPct + 1)).toBeNull();
  });

  it('legacy rows: unattainable without a stored proof reads as not found (reason unknown); with one, a policy conflict', () => {
    expect(feasibilityOutcome({ status: 'unattainable' })).toMatchObject({ outcome: 'notFoundWithinBudget', legacy: true });
    expect(feasibilityOutcome({ status: 'unattainable', beyondSafetyLimits: true })).toMatchObject({ outcome: 'provenPolicyConflict', legacy: true });
    expect(feasibilityOutcome({ status: 'attainable' }).outcome).toBe('foundUnderModel');
    const fresh = searchOutcomeOf('unattainable', RES);
    expect(feasibilityOutcome({ status: 'unattainable', outcome: fresh })).toBe(fresh);
  });

  it('collapsed rungs: not found within budget or stopped; design collapses carry no search outcome', () => {
    expect(collapseOutcome('infeasible')).toBe('notFoundWithinBudget');
    expect(collapseOutcome('stopped')).toBe('stopped');
    expect(collapseOutcome('tooClose')).toBeUndefined();
    expect(collapseOutcome('belowMinimal')).toBeUndefined();
    expect(collapseText('easy', 'stopped', {}, 'fat mass')).toMatch(/stopped/);
  });
});

describe('D4-08 estimate wording (no fastest-safe deadline, no impossibility claim)', () => {
  const base = { goal: 0, metric: 'fatMass' as const, supported: true, kind: 'loss' as const, start: 30, target: 25, valueAtHorizon: 26, changeAtHorizon: -4, reachableInHorizon: true, beyondTwoYears: false, beyondSafetyLimits: false, ratePerWeek: 0.4 };
  const FORBIDDEN = /fastest safe|scientific ceiling|impossible|not reachable/i;

  it('route sentences are estimates on the reference route', () => {
    for (const r of [{ ...base, weeks: 12 }, { ...base, weeks: 40 }, { ...base, weeks: null, beyondTwoYears: true }, { ...base, weeks: null }]) {
      const t = reachText(r, 'kg', 16);
      expect(t).not.toMatch(FORBIDDEN);
      expect(t).toMatch(/^(Estimated|Not found)/);
    }
    expect(rungReachText({ weeks: 20, beyondTwoYears: false, ratePerWeek: 0.3 }, 'kg')).toMatch(/^Estimated/);
  });

  it('time-to-target sentences say what the search found', () => {
    expect(tttText({ weeks: 23, days: 159, searchedDays: 168, estimatedWeeks: null, ratePerWeek: null, bestValue: 14 }, 'kg')).toBe('Estimated: the best plan found takes about 23 weeks.');
    const nf = tttText({ weeks: null, days: null, searchedDays: 364, estimatedWeeks: null, ratePerWeek: null, bestValue: 35 }, 'kg');
    expect(nf).toMatch(/^Not found within 52 weeks in this search/);
    expect(nf).not.toMatch(FORBIDDEN);
  });

  it('a supported route is a model witness (foundUnderModel); a target past a floor is a proven policy conflict', () => {
    const ok = targetReach(request(MAN_95, [{ metric: 'fatMass', direction: 'target', target: -3, targetKind: 'change' }]), 0)!;
    expect(ok.supported).toBe(true);
    expect(ok.outcome).toBe('foundUnderModel');
    expect(ok.text).not.toMatch(FORBIDDEN);
    const past = targetReach(request(MAN_95, [{ metric: 'bodyFatPct', direction: 'target', target: 2, endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT }]), 0)!;
    expect(past.outcome).toBe('provenPolicyConflict');
    expect(past.beyondSafetyLimits).toBe(true);
    expect(past.text).toMatch(/body-fat safety floor/);
  }, 60_000);
});
