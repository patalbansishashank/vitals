import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSurfaces } from '@/agents/AgentSurfaces';
import { dispatch, getPorts, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { publishPlannerRequest } from '../run';
import { createStoreTrainingSetup, TrainingSetupProvider } from '@/features/living/train/setup';

vi.mock('../plannerClient', () => ({ cancelPlanning: vi.fn(), planLadder: vi.fn(), resumeLadder: vi.fn(), estimateTargetsAsync: vi.fn(async () => []) }));
beforeEach(() => { freshState({ cleared: true }); publishPlannerRequest(null, null); });

describe('agent planner publication without a Coach provider', () => {
  it('publishes saved goals and follows changed limits in the standalone agent surface', async () => {
    expect((await dispatch('profile.patch', { sex: 'male', ageYears: 28, heightCm: 166, weightKg: 74.8 })).ok).toBe(true);
    await dispatch('profile.setSetupStep', { step: 'done' });
    expect(await dispatch('goals.edit', { ops: [{ op: 'add', goal: { key: 'fat', metric: 'fatMass', mode: 'lower', amount: null, strength: 'must', functional: 'end' } }] })).toMatchObject({ ok: true, output: { outcomes: ['added'] } });
    await settleCommits();
    await import('../RequestPublisher');
    await dispatch('intake.answer', { section: 'training', answers: { owned: ['dumbbell', 'bench'], access: [{ place: 'home', equipment: ['dumbbell', 'bench'], weekdays: [0, 1, 2, 3, 4, 5, 6] }], refused: [], liked: [], injuries: [], skill: 2, purchaseAllowance: { maxPriceTier: 0, maxItems: 0 } } });
    render(<TrainingSetupProvider value={createStoreTrainingSetup()}><AgentSurfaces /></TrainingSetupProvider>);
    await waitFor(() => expect(getPorts().planner?.prepare()?.request).toMatchObject({ profile: { body: { weightKg: 74.8 } }, goals: [{ metric: 'fatMass', direction: 'minimise' }] }));
    expect(getPorts().planner?.prepare()?.request).toMatchObject({ training: { owned: ['dumbbell', 'bench'] } });
    await act(async () => { await dispatch('goals.edit', { ops: [{ op: 'setLimits', patch: { maxMuscleLossPct: 2 } }] }); });
    await waitFor(() => expect(getPorts().planner?.prepare()?.request).toMatchObject({ constraints: { muscleRetention: { maxLossPct: 2 } } }));
    const { estimateTargetsAsync } = await import('../plannerClient');
    expect(estimateTargetsAsync).not.toHaveBeenCalled();
  });
});
