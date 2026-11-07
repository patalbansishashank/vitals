// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { compileRequest } from '../context';
import { goalTrajectory, goalValueStatus } from '../goalSpecs';
import { ReplanEvaluatorHost, replan, scenarioStartValues, toActivePlanFromScenario } from '../replan';
import { ForwardModel, absoluteGoals, bandsOf, bindingsOf, dateAt, forecastRuns, goalBandsOf, goalOutcomes, projectRealistic, realisticSchedule } from '../sensitivities';
import { baseRequest, confirmedState, makePlan, replanRequest } from './replan.fixtures';
import type { PlannerRequestV2 } from '../types';

const tissue = { version: 1 as const, operator: 'tissueFatFraction' as const, timeBasis: 'endOfDay' as const };
const bfRequest = () => baseRequest({ goals: [
  { metric: 'bodyFatPct', direction: 'target', target: 24, targetKind: 'absolute', endpointSemantics: tissue },
  { metric: 'fatMass', direction: 'target', target: 22, targetKind: 'absolute' },
] });

function bodyRun() {
  const fixture = makePlan({ request: bfRequest() });
  const fwd = new ForwardModel(fixture.plan, null, ['bodyFatPct', 'fatMass', 'leanTissue']);
  return { ...fixture, fwd, sim: fwd.run(fixture.plan.schedule) };
}

describe('W2/W3 forward/replan endpoint contracts', () => {
  it('snapshot day14 and day21 read absolute today21, with the actual same-day tissue denominator', () => {
    const { plan, ctx, sim } = bodyRun();
    const binding = bindingsOf(ctx)[0]!;
    const full = goalTrajectory(sim, binding, ctx);
    for (const anchor of [14, 21]) {
      const state = confirmedState(plan, anchor, { deltaMean: 0, deltaSd: 0 });
      const resumed = new ForwardModel(plan, state, ['fatMass', 'leanTissue']).run(plan.schedule);
      const trajectory = goalTrajectory(resumed, binding, ctx);
      expect(trajectory.startDay).toBe(anchor);
      // Recorded traces are Float32; the snapshot initial state retains double precision.
      expect(Math.fround(trajectory.sample(21)!)).toBe(Math.fround(full.sample(21)!));
      if (anchor < 21) expect(trajectory.sample(21)).toBe(100 * resumed.daily.fatMass![20]! / resumed.safety.tissueMassKg[20]!);
      expect(trajectory.sample(35)).toBeNull();
      const rows = goalOutcomes(ctx, { nominal: resumed, low: null, high: null }, 21, plan.startDate, 0);
      expect(rows[0]!.current).toBe(trajectory.sample(21));
      expect(rows[0]!.endP50).toBe(goalValueStatus(resumed, binding, ctx).value);
    }
  });

  it('changing only wake BF leaves tissue current, endpoint, target direction, dates and goal bands unchanged', () => {
    const { plan, ctx, sim } = bodyRun();
    const changed = { ...sim, daily: { ...sim.daily, bodyFatPct: Float32Array.from(sim.daily.bodyFatPct!, (v) => v + 5) } };
    const runs = { nominal: sim, low: null, high: null };
    const mutated = { ...runs, nominal: changed };
    expect(goalOutcomes(ctx, mutated, 14, plan.startDate, 0)).toEqual(goalOutcomes(ctx, runs, 14, plan.startDate, 0));
    expect(goalBandsOf(ctx, mutated, 14, 28)).toEqual(goalBandsOf(ctx, runs, 14, 28));
    expect(bandsOf(mutated, 14, 28, ['bodyFatPct'], 0).bodyFatPct!.p50[0]).not.toBe(bandsOf(runs, 14, 28, ['bodyFatPct'], 0).bodyFatPct!.p50[0]);
  });

  it('current context trend weight cannot rebind unchanged snapshot tissue values', () => {
    const { plan, ctx } = bodyRun();
    const state = confirmedState(plan, 14, { deltaSd: 0 });
    const sim = new ForwardModel(plan, state, ['fatMass', 'leanTissue']).run(plan.schedule);
    const binding = bindingsOf(ctx)[0]!;
    for (const shift of [-1.5, 0.5, 2]) {
      const current = compileRequest({ ...plan.request, profile: { ...plan.request.profile, body: { ...plan.request.profile.body, weightKg: plan.request.profile.body.weightKg + shift } } });
      const tr = goalTrajectory(sim, binding, current);
      expect(tr.sample(21)).toBe(goalTrajectory(sim, binding, ctx).sample(21));
      expect(tr.sample(21)).toBeCloseTo(100 * sim.daily.fatMass![20]! / sim.safety.tissueMassKg[20]!, 10);
    }
  });

  it('mixed complete/incomplete paths withhold endpoint range/date without dropping a member or unrelated endpoints', () => {
    const { plan, ctx, sim } = bodyRun();
    const missing = { ...sim, daily: { ...sim.daily, leanTissue: undefined } };
    const runs = { nominal: sim, low: missing, high: sim };
    const rows = goalOutcomes(ctx, runs, 14, plan.startDate, 0);
    expect(rows[0]!.availability).toMatchObject({ status: 'partial', attempted: 3, available: 2, excluded: 1, policy: 'allRequiredMembers', memberAvailable: [true, false, true] });
    expect(rows[0]!.p10).toBeUndefined();
    expect(rows[0]!.p90).toBeUndefined();
    expect(rows[0]!.pTargetMet).toBeNull();
    expect(rows[0]!.date).toBeNull();
    expect(rows[1]!.availability.status).toBe('complete');
    expect(rows[1]!.p10).toBeTypeOf('number');
    expect(goalBandsOf(ctx, runs, 14, 28)[rows[0]!.bandKey]).toBeUndefined();
    const absent = goalOutcomes(ctx, { nominal: missing, low: null, high: null }, 14, plan.startDate, 0)[0]!;
    expect(absent.availability.status).toBe('unavailable');
    expect(absent.p10).toBeUndefined();
  });

  it('goal dates use the same END7 functional independently on each coherent path', () => {
    const { plan, ctx, fwd } = bodyRun();
    const runs = forecastRuns(fwd, plan.schedule);
    const row = goalOutcomes(ctx, runs, 0, plan.startDate, 0)[0]!;
    const path = goalTrajectory(runs.nominal, bindingsOf(ctx)[0]!, ctx);
    const crossing = path.crossing(row.target!, -1, 0);
    expect(row.date).toBe(crossing === null ? null : dateAt(plan.startDate, crossing));
    if (crossing !== null) expect(path.functionalAt(crossing)).toBeLessThanOrEqual(row.target!);
    expect(row.operator).toBe('tissueFatFraction');
    expect(row.bandKey).not.toBe('bodyFatPct');
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it('plausible/as-prescribed physical futures ignore utility posteriors and preserve full dose without evidence', () => {
    const { plan, fwd } = bodyRun();
    const low = [{ type: 'rtSession' as const, a: 1, b: 999, opportunities: 100 }];
    const high = [{ type: 'rtSession' as const, a: 999, b: 1, opportunities: 100 }];
    expect(realisticSchedule(plan.schedule, 14, [], fwd.rp)).toBe(plan.schedule);
    expect(realisticSchedule(plan.schedule, 14, low, fwd.rp)).toEqual(realisticSchedule(plan.schedule, 14, high, fwd.rp));
    const a = projectRealistic(plan, null, low, { today: dateAt(plan.startDate, 14) });
    const b = projectRealistic(plan, null, high, { today: dateAt(plan.startDate, 14) });
    expect(a.realistic).toEqual(b.realistic);
    expect(a.asPrescribed).toEqual(a.realistic);
    expect(a.behavior.assumption).toBe('prescribedDose');
    expect(a.goalBands.asPrescribed).toEqual(a.goalBands.realistic);
    const missing = projectRealistic(plan, null, [], { today: dateAt(plan.startDate, 14), scenario: 'missingData' });
    expect(missing.behavior.assumption).toBe('habitualContinuation');
    expect(missing.schedule.days.slice(0, 14)).toEqual(plan.schedule.days.slice(0, 14));
  });

  it('fresh scenario SBP lower-by5 freezes absolute135 and zero-change keep once from the actual start', () => {
    const fixture = makePlan();
    for (const delta of [-5, 0]) {
      const request: PlannerRequestV2 = baseRequest({ profile: { ...fixture.plan.request.profile, labs: { sbpMmHg: 140 } }, goals: [{ metric: 'sbp', direction: 'target', target: delta, targetKind: 'change' }] });
      const values = scenarioStartValues(fixture.plan.schedule, request);
      expect(values.get(0)).toBe(140);
      const started = toActivePlanFromScenario(fixture.plan.schedule, request, { planId: 'clinical' });
      expect(started.request.goals[0]).toMatchObject({ target: 140 + delta, targetKind: 'absolute', targetOrigin: { delta, baseline: 140 } });
      expect(JSON.parse(JSON.stringify(started)).request.goals[0].target).toBe(140 + delta);
    }
  });

  it('relative FPG freezes from the initial fasting operator; explicit absolutes and goal-free scenarios stay unchanged', () => {
    const { plan } = makePlan();
    const request = baseRequest({ profile: { ...plan.request.profile, labs: { fastingGlucoseMmolL: 6 } }, goals: [{ metric: 'fastingGlucose', direction: 'target', target: -0.3, targetKind: 'change' }] });
    const started = toActivePlanFromScenario(plan.schedule, request, { planId: 'fpg' });
    expect(started.request.goals[0]!.target).toBeCloseTo(5.7, 10);
    const absolute = { ...request, goals: [{ ...request.goals[0]!, target: 5.5, targetKind: 'absolute' as const }] };
    expect(toActivePlanFromScenario(plan.schedule, absolute, { planId: 'absolute' }).request.goals).toEqual(absolute.goals);
    expect(toActivePlanFromScenario(plan.schedule, { ...request, goals: [] }, { planId: 'none' }).request.goals).toEqual([]);
    expect(absoluteGoals(request.goals, () => NaN)).toEqual(request.goals);
  });

  it('ordinary clinical-only replan preserves frozen start target and direct edit uses realised edit-time baseline', async () => {
    const { plan } = makePlan({ x: (st) => { const x = Float64Array.from(st.x0); x[st.geneIndex['seg0.energy']!] = 0.7; return x; } });
    const request = baseRequest({ profile: { ...plan.request.profile, labs: { sbpMmHg: 140 } }, goals: [{ metric: 'sbp', direction: 'target', target: -5, targetKind: 'change' }] });
    const schedule = { ...plan.schedule, days: plan.schedule.days.map((day) => ({ ...day, override: { ...day.override, energy: { kind: 'pctMaintenance' as const, pct: 100 }, exercise: [] } })) };
    const started = toActivePlanFromScenario(schedule, request, { planId: 'clinical' });
    const state = confirmedState(started, 7, { deltaSd: 0 });
    const keep = await replan(replanRequest(started, state, 10, 'light'), { totalEU: 0 });
    expect(keep.plan.request.goals[0]!.target).toBe(135);
    const fwd = new ForwardModel(started, state, ['sbp']);
    const ctx = compileRequest(started.request);
    const baseline = goalTrajectory(fwd.run(started.schedule), bindingsOf(ctx)[0]!, ctx).sample(10)!;
    const edited = await replan(replanRequest(started, state, 10, 'user', { changes: { goals: [{ metric: 'sbp', direction: 'target', target: -5, targetKind: 'change' }] } }), { totalEU: 0 });
    expect(edited.plan.request.goals[0]!.target, JSON.stringify(edited.explanation)).toBeCloseTo(baseline - 5, 10);
    expect(edited.plan.request.goals[0]!.targetKind).toBe('absolute');
    const later = await replan(replanRequest(edited.plan, confirmedState(edited.plan, 14, { deltaSd: 0 }), 17, 'light'), { totalEU: 0 });
    expect(later.plan.request.goals[0]!.target).toBe(edited.plan.request.goals[0]!.target);
  }, 60_000);

  it('local/worker replan evaluation preserves per-goal missing masks through reconstruction', () => {
    const { plan, ctx, sim, structure, x } = bodyRun();
    const state = confirmedState(plan, 7, { deltaSd: 0 });
    const missing = { ...sim, daily: { ...sim.daily, leanTissue: undefined } };
    const spy = vi.spyOn(ForwardModel.prototype, 'run').mockReturnValue(missing);
    try {
      const host = new ReplanEvaluatorHost({ request: replanRequest(plan, state, 10, 'user'), spec: {
        lockEnd: 10, touchEnd: 28, judgeFrom: 10, frame: { offset: 0, horizonDays: 28, weightKg: ctx.rp.weightKg },
        structureIds: [structure.id], realistic: false, churnLimits: false, mode: 'fresh',
      } });
      const output = host.evaluate([{ structure: 0, x, draw: -1 }])[0]!;
      expect(Array.from(output.missingGoals ?? [])).toEqual([0]);
      expect(Number.isFinite(output.goals[1]!)).toBe(true);
      expect(structuredClone(output).missingGoals).toEqual(output.missingGoals);
    } finally { spy.mockRestore(); }
  });

  it('missing/incompatible clinical baselines retain relative intent pending Review, without a NaN target', () => {
    const { plan } = makePlan();
    for (const profile of [plan.request.profile, { ...plan.request.profile, labs: { fastingGlucoseMmolL: 6 }, labMeta: { fastingGlucoseMmolL: { source: 'manual' as const, fastingStatus: 'nonFasting' as const } } }]) {
      const request = baseRequest({ profile, goals: [{ metric: 'fastingGlucose', direction: 'target', target: -0.3, targetKind: 'change' }, { metric: 'fatMass', direction: 'target', target: 22 }] });
      const started = toActivePlanFromScenario(plan.schedule, request, { planId: 'missing' });
      expect(started.request.goals[0]).toEqual(request.goals[0]);
      expect(compileRequest(started.request).goals.map((g) => g.metric)).toEqual(['fatMass']);
      expect(JSON.stringify(started.request.goals)).not.toContain('null');
    }
  });

  it('unstamped BF stays review-only in direct replan context while supported goals remain available', () => {
    const request = bfRequest();
    const legacy = { ...request, goals: request.goals.map((g) => ({ ...g, endpointSemantics: undefined })) };
    expect(compileRequest(legacy).goals.map((g) => g.metric)).toEqual(['fatMass']);
    expect(legacy.goals[0]!.target).toBe(24);
    const oldRelative = { ...legacy.goals[0]!, target: -5, targetKind: 'change' as const };
    expect(absoluteGoals([oldRelative], () => 28)).toEqual([oldRelative]);
    expect(compileRequest({ ...legacy, goals: [legacy.goals[0]!] }).goals).toEqual([]);
    expect(compileRequest(request).goals.map((g) => g.metric)).toEqual(['bodyFatPct', 'fatMass']);
  });
});
