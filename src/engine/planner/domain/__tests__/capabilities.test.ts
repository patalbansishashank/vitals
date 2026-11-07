// @vitest-environment node
/**
 * C6 planner-side goal capability (W1): saved/imported goals on metrics without an optimizable capability resolve to
 * Review with alternatives (D2-06 adherence, D2-07 endocrine, D2-08 keto adaptation, D8-05 BMD, D8-08 micronutrient score,
 * D8-09 generic endurance), never a silent remap; run statuses close over output dependencies (D1-05 lean partition,
 * D7-07 ketogenic lipid response, D1-08 domain validity); the objective guard credits no unwarranted benefit; limit costs
 * carry the worse status; the evidence graph gives non-objective metrics no fasting credit and no task/adequacy mapping.
 */
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSIONS, CURRENT_TISSUE_FAT_ENDPOINT } from '@/lib/bodyContracts';
import { SERIES, isProductionGoalEligible, type MetricId } from '../../../types/metrics';
import type { SimulationResult } from '../../../types/result';
import {
  closedRunStatuses,
  goalDisplayStatus,
  goalResolutionText,
  goalSense,
  guardedGoalValue,
  ketogenicLipidUncertain,
  leanPartitionUnsupported,
  resolveGoalCapability,
  runGoalStatus,
  statusAllowsObjective,
  type PlannerCondition,
} from '../capabilities';
import { compileRequest } from '../context';
import { CATALOGUE_OUTCOME_METRICS, EVIDENCE_EDGES, edgeRole, objectiveEdgesTo, servesFasting } from '../evidenceGraph';
import { idealRequest, limitCostStated, limitCostStatus, relaxGroup } from '../limits';
import { MAN_95, request } from './personas';

const CURRENT = CONTRACT_VERSIONS.goalCapability;
type Meta = Pick<SimulationResult, 'meta'>;
const run = (meta: Partial<SimulationResult['meta']> = {}): Meta => ({ meta: meta as SimulationResult['meta'] });

describe('goal capability resolution (C6)', () => {
  it('optimizable goals plan; scenario capabilities stay labelled scenario objectives', () => {
    expect(resolveGoalCapability({ metric: 'fatMass', capabilityVersion: CURRENT })).toMatchObject({ resolution: 'plan', status: 'estimated', legacy: false });
    expect(resolveGoalCapability({ metric: 'hunger', capabilityVersion: CURRENT })).toMatchObject({ resolution: 'scenario', status: 'scenario' });
  });

  it('a saved adherence goal is Review with Hunger offered, never remapped to a hunger goal (D2-06)', () => {
    const r = resolveGoalCapability({ metric: 'adherence' });
    expect(r).toMatchObject({ resolution: 'pendingReview', status: 'review', reasonCode: 'notAProbability', tracking: 'logged', legacy: true });
    expect(r.alternatives).toEqual(['hunger']);
    const ctx = compileRequest(request(MAN_95, [{ metric: 'adherence', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }]));
    expect(ctx.goals.map((g) => g.metric)).toEqual(['fatMass']);
    expect(ctx.goalReviews?.map((x) => [x.metric, x.resolution])).toEqual([['adherence', 'pendingReview']]);
    const text = ctx.problems.join(' ');
    expect(text).toMatch(/cannot be used as a goal any more \(Review\)/);
    expect(text).toMatch(/Rank Hunger pressure instead/);
    // a new request (current capability version) is refused outright, with the same alternatives
    const fresh = compileRequest(request(MAN_95, [{ metric: 'adherence', direction: 'maximise', capabilityVersion: CURRENT }, { metric: 'fatMass', direction: 'minimise', capabilityVersion: CURRENT }]));
    expect(fresh.goalReviews?.[0]?.resolution).toBe('unavailable');
    expect(fresh.problems.join(' ')).toMatch(/cannot be used as a goal: the model has no validated objective/);
  });

  it('saved keto-adaptation, IGF-1, BMD, micronutrient and generic endurance goals resolve to Review with their alternatives (D2-07, D2-08, D8-05, D8-08, D8-09)', () => {
    const cases: Array<[MetricId, readonly MetricId[], string]> = [
      ['ketoAdaptation', ['bhb'], 'mechanism'],
      ['igf1', [], 'measured'],
      ['hipBmdChange', ['strength', 'leanTissue'], 'measured'],
      ['micronutrientScore', [], 'logged'],
      ['enduranceCapacity', ['vo2max', 'strength'], 'logged'],
      ['menstrualRisk', [], 'logged'],
      ['moodTier', [], 'logged'],
    ];
    for (const [metric, alternatives, tracking] of cases) {
      const r = resolveGoalCapability({ metric });
      expect(r.resolution, metric).toBe('pendingReview');
      expect(r.alternatives, metric).toEqual(alternatives);
      expect(r.tracking, metric).toBe(tracking);
      // alternatives are optimizable goals; no alternative silently replaces the saved goal
      for (const a of r.alternatives) expect(isProductionGoalEligible(a), `${metric} → ${a}`).toBe(true);
    }
    // the generic endurance index never becomes a VO2max goal by itself
    const ctx = compileRequest(request(MAN_95, [{ metric: 'enduranceCapacity', direction: 'maximise' }]));
    expect(ctx.goals).toEqual([]);
    expect(ctx.problems.join(' ')).toMatch(/Rank VO₂max or Strength index instead/);
  });

  it('every goal-shaped metric without an optimizable capability is refused, and every eligible one plans', () => {
    for (const d of SERIES) {
      if (d.kind !== 'metric') continue;
      const r = resolveGoalCapability({ metric: d.id as MetricId, capabilityVersion: CURRENT, ...(d.id === 'bodyFatPct' ? { endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT } : {}) });
      if (isProductionGoalEligible(d.id)) expect(['plan', 'scenario'], d.id).toContain(r.resolution);
      else expect(r.resolution, d.id).toBe('unavailable');
    }
    expect(resolveGoalCapability({ metric: 'madeUp' as MetricId })).toMatchObject({ resolution: 'unavailable', reasonCode: 'notAnOutcome', availability: null });
  });

  it('the problem text is one short line with the status word, alternatives and what stays tracked', () => {
    const t = goalResolutionText('Hip bone density change', resolveGoalCapability({ metric: 'hipBmdChange' }));
    expect(t).toMatch(/^"Hip bone density change" cannot be used as a goal any more \(Review\)/);
    expect(t).toMatch(/Measured values stay tracked\.$/);
    expect(t.length).toBeLessThan(220);
  });
});

describe('run statuses and their closure (C6; D1-05, D7-07, D1-08)', () => {
  const lean: PlannerCondition = { series: 'leanTissue', status: 'limited', reasonCode: 'lowProteinSurplusPartition', fromDay: 3 };
  const keto: PlannerCondition = { series: 'ldl', status: 'limited', reasonCode: 'uncertainKetogenicResponse', fromDay: 0 };

  it('an unsupported lean partition makes fat, scale weight and body fat conditional scenarios', () => {
    const st = closedRunStatuses(run(), [lean]);
    expect(st.leanTissue).toEqual({ status: 'limited', reasonCode: 'lowProteinSurplusPartition' });
    for (const id of ['fatMass', 'scaleWeight', 'bodyFatPct', 'skeletalMuscle', 'rtMuscleGain']) expect(st[id], id).toEqual({ status: 'scenario', reasonCode: 'dependsOn:leanTissue' });
    // downstream marker claims inherit through fat mass
    expect(st.triglycerides?.status).toBe('scenario');
    expect(leanPartitionUnsupported(st)).toBe(true);
    expect(runGoalStatus(run(), 'leanTissue', [lean]).status).toBe('limited');
    expect(runGoalStatus(run(), 'fatMass', [lean]).status).toBe('scenario');
  });

  it('the engine provider’s own lean status counts when its reason is a protein/partition domain code', () => {
    const engine = run({ outputStatus: { leanTissue: { status: 'scenario', reasonCode: 'unknownProteinSurplus' } } });
    expect(leanPartitionUnsupported(closedRunStatuses(engine))).toBe(true);
    // a scenario lean status for another reason (e.g. an uncalibrated growth state) keeps its objective
    const other = run({ outputStatus: { leanTissue: { status: 'scenario', reasonCode: 'growthStateUncalibrated' } } });
    expect(leanPartitionUnsupported(closedRunStatuses(other))).toBe(false);
  });

  it('an uncertain ketogenic response limits LDL and ApoB follows it', () => {
    const st = closedRunStatuses(run(), [keto]);
    expect(st.ldl?.status).toBe('limited');
    expect(st.apoB).toEqual({ status: 'scenario', reasonCode: 'dependsOn:ldl' });
    expect(ketogenicLipidUncertain(st)).toBe(true);
  });

  it('a model-limit termination or an out-of-domain run is no forecast for any goal (D1-08)', () => {
    const limit = run({ validity: { status: 'modelLimit', reasonCode: 'tissueFloor', validThroughHour: 900, version: 1 } });
    for (const m of ['fatMass', 'leanTissue', 'ldl']) expect(runGoalStatus(limit, m).status).toBe('modelLimit');
    const out = run({ validity: { status: 'outsideDomain', reasonCode: 'severeRestrictionProtocol', version: 1 } });
    expect(runGoalStatus(out, 'fatMass')).toEqual({ status: 'outOfDomain', reasonCode: 'severeRestrictionProtocol' });
    expect(statusAllowsObjective('modelLimit')).toBe(false);
    expect(statusAllowsObjective('scenario')).toBe(true);
  });

  it('without statuses a goal keeps its capability status', () => {
    expect(runGoalStatus(run(), 'fatMass')).toEqual({ status: 'estimated', reasonCode: 'ok' });
    expect(runGoalStatus(run(), 'ldl')).toEqual({ status: 'scenario', reasonCode: 'ok' });
    expect(runGoalStatus(run(), 'adherence').status).toBe('unavailable');
  });
});

describe('objective guard: no unwarranted benefit (C6)', () => {
  const leanSt = closedRunStatuses(run(), [{ series: 'leanTissue', status: 'limited', reasonCode: 'lowProteinSurplusPartition', fromDay: 0 }]);
  const ketoSt = closedRunStatuses(run(), [{ series: 'ldl', status: 'limited', reasonCode: 'uncertainKetogenicResponse', fromDay: 0 }]);
  const none = closedRunStatuses(run());

  it('D1-05: a positive lean change in a protein-deficient surplus earns nothing; a loss stays a loss; fat goals keep their number', () => {
    expect(guardedGoalValue('leanTissue', 1, 61.4, 60, leanSt)).toBe(60);
    expect(guardedGoalValue('skeletalMuscle', 1, 31, 30, leanSt)).toBe(30);
    expect(guardedGoalValue('leanTissue', 1, 59.2, 60, leanSt)).toBe(59.2);
    expect(guardedGoalValue('fatMass', -1, 20.5, 21, leanSt)).toBe(20.5);
    expect(guardedGoalValue('leanTissue', 1, 61.4, 60, none)).toBe(61.4);
  });

  it('D7-07: no LDL reduction is credited under an uncertain ketogenic response; a modelled rise stays', () => {
    expect(guardedGoalValue('ldl', -1, 2.9, 3.4, ketoSt)).toBe(3.4);
    expect(guardedGoalValue('ldl', -1, 3.7, 3.4, ketoSt)).toBe(3.7);
    expect(guardedGoalValue('ldl', -1, 2.9, 3.4, none)).toBe(2.9);
  });

  it('D1-08: an out-of-domain run credits no change; non-finite values pass through untouched', () => {
    expect(guardedGoalValue('fatMass', -1, 15, 21, none, { status: 'outsideDomain', reasonCode: 'x', version: 1 })).toBe(21);
    expect(guardedGoalValue('leanTissue', 1, Number.NaN, 60, leanSt)).toBeNaN();
  });
});

describe('displayed goal status: range and target withheld only where the number has no warrant (C6)', () => {
  it('a guarded lean or LDL objective reads Limited with its root reason; dependent goals keep a labelled range', () => {
    const lean = closedRunStatuses(run(), [{ series: 'leanTissue', status: 'scenario', reasonCode: 'lowProteinSurplusPartition', fromDay: 0 }]);
    expect(goalDisplayStatus(lean, 'leanTissue', 1)).toEqual({ status: 'limited', reasonCode: 'lowProteinSurplusPartition', withheld: true });
    expect(goalDisplayStatus(lean, 'fatMass', -1)).toEqual({ status: 'scenario', reasonCode: 'dependsOn:leanTissue', withheld: false });
    // a lean "keep"/loss direction is not a claimed gain: nothing to withhold
    expect(goalDisplayStatus(lean, 'leanTissue', -1).withheld).toBe(false);
    const keto = closedRunStatuses(run(), [{ series: 'ldl', status: 'limited', reasonCode: 'uncertainKetogenicResponse', fromDay: 0 }]);
    expect(goalDisplayStatus(keto, 'ldl', -1)).toEqual({ status: 'limited', reasonCode: 'uncertainKetogenicResponse', withheld: true });
  });

  it('a limited status for another reason keeps its range (interpretable); model limit and out of domain withhold it', () => {
    const vli = closedRunStatuses(run({ outputStatus: { fatMass: { status: 'limited', reasonCode: 'veryLowIntakeOutsideSupport' } } }));
    expect(goalDisplayStatus(vli, 'fatMass', -1)).toEqual({ status: 'limited', reasonCode: 'veryLowIntakeOutsideSupport', withheld: false });
    const none = closedRunStatuses(run());
    expect(goalDisplayStatus(none, 'fatMass', -1, { status: 'modelLimit', reasonCode: 'tissueFloor', version: 1 }).withheld).toBe(true);
    expect(goalDisplayStatus(none, 'fatMass', -1, { status: 'outsideDomain', reasonCode: 'x', version: 1 }).withheld).toBe(true);
    expect(goalDisplayStatus(none, 'fatMass', -1)).toEqual({ status: 'estimated', reasonCode: 'ok', withheld: false });
  });

  it('goal sense: maximise / minimise, and a target above or below its start', () => {
    const ctx = compileRequest(request(MAN_95, [
      { metric: 'leanTissue', direction: 'maximise' },
      { metric: 'fatMass', direction: 'target', target: -5, targetKind: 'change' },
      { metric: 'ldl', direction: 'minimise' },
      { metric: 'scaleWeight', direction: 'target', target: 99 },
    ]));
    expect(ctx.goals.map((g) => goalSense(g, Number.NaN))).toEqual([1, -1, -1, 1]);
    expect(goalSense(ctx.goals[3]!, 100)).toBe(-1);
  });
});

describe('limit costs carry the worse status (D1-05, D1-08)', () => {
  it('a model-limit or limited side means no stated gain', () => {
    const ok = { status: 'estimated' as const, reasonCode: 'ok' };
    const lim = { status: 'modelLimit' as const, reasonCode: 'tissueFloor' };
    const part = { status: 'limited' as const, reasonCode: 'lowProteinSurplusPartition' };
    expect(limitCostStatus(ok, lim)).toBe(lim);
    expect(limitCostStatus(part, ok)).toBe(part);
    expect(limitCostStated(ok, ok)).toBe(true);
    expect(limitCostStated(ok, lim)).toBe(false);
    expect(limitCostStated(part, ok)).toBe(false);
  });

  it('the Ideal never relaxes a clinician, marker or screening protein floor, whatever its reasons say (D1-05)', () => {
    const req = request(MAN_95, [{ metric: 'leanTissue', direction: 'maximise' }], {
      safety: { plannerLocks: [{ id: 'protein-floor', value: 1.2, reasons: [{ rule: 'user' }], source: 'clinician' }, { id: 'max-fast', value: 16, reasons: [{ rule: 'user' }] }] },
    });
    const ideal = idealRequest(req).request;
    expect(ideal.safety?.plannerLocks?.map((l) => l.id)).toEqual(['protein-floor']);
    expect(relaxGroup(req, 'foodFloors').safety?.plannerLocks?.map((l) => l.id)).toEqual(['protein-floor', 'max-fast']);
  });
});

describe('evidence graph: mechanism edges of non-objective metrics (D2-06, D2-07, D2-08, D8-08, D8-09)', () => {
  const NON_OBJECTIVE: MetricId[] = ['adherence', 'ketoAdaptation', 'igf1', 'enduranceCapacity', 'micronutrientScore'];

  it('no fasting credit (they never compile as goals), no objective edges; the mechanism stays in the graph', () => {
    for (const m of NON_OBJECTIVE) {
      const ctx = compileRequest(request(MAN_95, [{ metric: m, direction: 'maximise' }], { safety: { optIns: { fastingTier: 'T3' } } }));
      expect(ctx.goals, m).toEqual([]);
      expect(ctx.fastingServedGoal, m).toBeNull();
      expect(objectiveEdgesTo(m), m).toEqual([]);
      const edges = EVIDENCE_EDGES.filter((e) => e.metric === m && e.status !== 'infoOnly');
      for (const e of edges) expect(edgeRole(e), e.id).toBe('mechanism');
    }
    expect(objectiveEdgesTo('fatMass').length).toBeGreaterThan(0);
    expect(servesFasting('fatMass', 'down')).toBe(true);
  });

  it('task-specific performance and adequacy claims do not map to the generic endurance index or the micronutrient score', () => {
    for (const [outcome, targets] of Object.entries(CATALOGUE_OUTCOME_METRICS)) {
      for (const [metric] of targets) expect(['enduranceCapacity', 'micronutrientScore'], outcome).not.toContain(metric);
    }
    expect(EVIDENCE_EDGES.filter((e) => e.from.kind === 'catalogue' && (e.metric === 'enduranceCapacity' || e.metric === 'micronutrientScore'))).toEqual([]);
  });
});
