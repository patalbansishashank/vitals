import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, getPorts, installPorts, jobs, outputOf, settleCommits } from '..';
import type { PlannerRequest } from '@/engine/planner/domain/types';
import type { BaselineImprovementResult } from '@/engine/planner/domain/baselineImprovement';
import type { ImprovementRunView } from '../defs/improvement';
import type { Schedule } from '@/engine/types';
import { MAN_95, request } from '@/engine/planner/domain/__tests__/personas';
import { freshState } from './harness';

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/engine/planner/domain/baselineImprovement', () => ({ searchBaselineImprovement: search }));
const original = getPorts().planner;
let current: PlannerRequest;
let sourceId: string;

function fixtureResult(schedule: Schedule): BaselineImprovementResult {
  // The numerical solver has its own engine tests. This stub verifies snapshot, command, cache and copy contracts.
  return {
    status: 'complete', candidates: [{ id: 'baseline', family: 'baseline', comparatorId: 'baseline', schedule,
      nominal: { fatMassKg: 12, skeletalMuscleKg: 30, scaleWeightKg: 75, status: 'available' },
      policy: { status: 'blocked', failedMargins: ['HC-E3'], missingMargins: [], muscleRetention: 'withinBudget', inputPolicyStatus: 'blocked', inputPolicyFailures: ['HC-E3'] },
      auditedDraws: 32,
    }], evaluatedNominal: 1, evaluatedDraws: 32, auditSeed: 'baseline-improvement/v1', auditMembers: 32,
    family: 'test', evidenceAssumptions: ['scenario only'], verdict: 'noPairedImprovementFound',
  } as unknown as BaselineImprovementResult;
}
beforeEach(async () => {
  freshState({ cleared: true });
  current = request(MAN_95, [{ metric: 'fatMass', direction: 'minimise' }], { horizonDays: 14, constraints: { muscleRetention: { maxLossPct: 2, baseline: { kg: 33, date: '2026-11-06', basis: 'modelSkeletalMuscle' } } } });
  installPorts({ planner: { prepare: () => ({ request: current, hash: 'current-inputs' }), run: async () => null, cancel: () => undefined } });
  const created = outputOf(await dispatch('scenario.create', { name: 'Provided routine', starter: 'blank' }))!;
  sourceId = created.scenarioId;
  search.mockReset();
  search.mockImplementation(async (input: { baseline: Schedule }) => fixtureResult(input.baseline));
});
afterEach(() => installPorts({ planner: original }));

async function completed(maxMuscleLossPct: 2 | 5 = 2): Promise<ImprovementRunView> {
  const started = await dispatch('planner.improveCurrent', { scenarioId: sourceId, maxMuscleLossPct, draws: 32 });
  if (!started.ok || !('job' in started)) throw new Error(JSON.stringify(started));
  await jobs.wait(started.job.jobId);
  const view = jobs.result(started.job.jobId) as ImprovementRunView;
  expect(view.runId).toBeTruthy();
  return view;
}

describe('baseline improvement command contract', () => {
  it('freezes the supplied source and changes the run budget without mutating the live request', async () => {
    const source = outputOf(await dispatch('scenario.get', { id: sourceId, includeSchedule: true }))!;
    const view = await completed(5);
    const input = search.mock.calls[0]![0];
    expect(input.baseline).toEqual(source.schedule);
    expect(input.request.profile).toEqual(current.profile);
    expect(input.request.horizonDays).toBe(source.horizonDays);
    expect(input.request.constraints.muscleRetention.maxLossPct).toBe(5);
    expect(input.request.constraints.muscleRetention.baseline).toEqual(current.constraints?.muscleRetention?.baseline);
    expect(current.constraints?.muscleRetention?.maxLossPct).toBe(2);
    expect(view.report.candidates[0]).not.toHaveProperty('schedule');
    expect(outputOf(await dispatch('planner.improvementResult', { runId: view.runId }))).toEqual(view);
  });

  it('keeps the common parameter seed fixed across 2% and 5% requests', async () => {
    await completed(2);
    await completed(5);
    expect(search.mock.calls.map(c => c[0].seed)).toEqual(['baseline-improvement/v1', 'baseline-improvement/v1']);
  });

  it('copies the frozen diagnostic without changing its source or starting a living plan', async () => {
    const before = outputOf(await dispatch('scenario.get', { id: sourceId, includeSchedule: true }))!;
    const view = await completed();
    const saved = outputOf(await dispatch('planner.openImprovement', { runId: view.runId, candidateId: 'baseline', name: 'Diagnostic comparison', activate: false }))!;
    await settleCommits();
    expect(saved.diagnostic).toBe(true);
    const copy = outputOf(await dispatch('scenario.get', { id: saved.scenarioId, includeSchedule: true }))!;
    expect(copy.schedule).toEqual(before.schedule);
    expect(copy.provenance).toContain('Diagnostic');
    expect(copy.started).toBe(false);
    expect(outputOf(await dispatch('scenario.get', { id: sourceId, includeSchedule: true }))).toEqual(before);
  });

  it('rejects stale body inputs or a changed source instead of copying old results into the new context', async () => {
    const view = await completed();
    current = { ...current, profile: { ...current.profile, body: { ...current.profile.body, weightKg: 100 } } };
    const stale = await dispatch('planner.openImprovement', { runId: view.runId, candidateId: 'baseline' });
    expect(stale).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('also rejects a changed practical limit or horizon despite an unchanged body', async () => {
    const view = await completed();
    current = { ...current, constraints: { ...current.constraints, maxSessionMin: 30 } };
    expect(await dispatch('planner.openImprovement', { runId: view.runId, candidateId: 'baseline' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    current = { ...current, constraints: { ...current.constraints, maxSessionMin: undefined }, horizonDays: 21 };
    expect(await dispatch('planner.openImprovement', { runId: view.runId, candidateId: 'baseline' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('refuses a missing source and a missing comparison with an actionable error', async () => {
    expect(await dispatch('planner.improveCurrent', { scenarioId: 'not-a-scenario' })).toMatchObject({ ok: false });
    expect(await dispatch('planner.improvementResult', { runId: 'expired' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
