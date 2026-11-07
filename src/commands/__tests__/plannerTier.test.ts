import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, getPorts, installPorts, jobs } from '..';
import { fixtureResult } from '@/features/planner/__tests__/fixtures';
import { freshState } from './harness';

const original = getPorts().planner;
beforeEach(() => freshState({ cleared: true }));
afterEach(() => installPorts({ planner: original }));

describe('planner.find input contract', () => {
  it('publishes search progress and evaluation counts through the background-job API', async () => {
    let finish!: (value: ReturnType<typeof fixtureResult>) => void;
    installPorts({ planner: { prepare: () => ({ request: { budget: { tier: 'M' } }, hash: 'inputs' }), run: async (_request, options) => {
      options.onProgress({ stage: 'S1', fraction: 0.4, euUsed: 120, euBudget: 300, provisional: [] });
      return new Promise(resolve => { finish = resolve; });
    }, cancel: () => undefined } });
    const result = await dispatch('planner.find', { tier: 'M' });
    if (!result.ok || !('job' in result)) throw new Error('No job');
    expect(jobs.status(result.job.jobId)).toMatchObject({ progress: 0.4, stage: 'S1', partial: { equivalentEvaluations: 120, budgetEU: 300 } });
    finish(fixtureResult());
    await jobs.wait(result.job.jobId);
  });

  it('exposes the exact inputs without requesting a run tier or executing the planner', async () => {
    const request = { goals: [{ metric: 'fatMass' }], constraints: { muscleRetention: { maxLossPct: 2 } } };
    const prepare = vi.fn(() => ({ request, hash: 'latest-inputs' }));
    const run = vi.fn(async () => fixtureResult());
    installPorts({ planner: { prepare, run, cancel: () => undefined } });
    expect(await dispatch('planner.inputs', {})).toMatchObject({ ok: true, output: { available: true, hash: 'latest-inputs', request } });
    expect(prepare).toHaveBeenCalledWith();
    expect(run).not.toHaveBeenCalled();
  });

  it('passes the requested search tier through preparation to the actual engine request', async () => {
    const prepare = vi.fn(({ tier }: { tier?: 'S' | 'M' | 'L' | 'X' } = {}) => ({ request: { budget: { tier } }, hash: 'same-goals' }));
    const run = vi.fn(async () => fixtureResult());
    installPorts({ planner: { prepare, run, cancel: () => undefined } });
    const result = await dispatch('planner.find', { tier: 'L' });
    expect(result.ok).toBe(true);
    if (!result.ok || !('job' in result)) throw new Error('Planner job did not start');
    await jobs.wait(result.job.jobId);
    expect(prepare).toHaveBeenCalledWith({ tier: 'L' });
    expect(run).toHaveBeenCalledWith({ budget: { tier: 'L' } }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('rejects unsupported overrides instead of silently running different inputs', async () => {
    const prepare = vi.fn();
    installPorts({ planner: { prepare, run: async () => fixtureResult(), cancel: () => undefined } });
    const result = await dispatch('planner.find', { tier: 'X', overrides: { constraints: { muscleRetention: { maxLossPct: 2 } } } });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(prepare).not.toHaveBeenCalled();
  });
});
