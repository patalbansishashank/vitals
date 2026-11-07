import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, installLivingPorts } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import type { PlanDoc, PlanVersionDoc } from '@/living/types';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import type { Schedule } from '@/engine';

const TODAY = '2026-11-02';
const schedule: Schedule = { schemaVersion: 1, startDate: TODAY, horizonDays: 28, programs: [{ id: 'steady', label: 'Steady', energy: { kind: 'kcal', kcal: 1500 }, macros: { protein: { unit: 'g', value: 125 }, fat: { unit: 'g', value: 40 }, carbs: { unit: 'remainder' } }, steps: 10000 }], days: Array.from({ length: 28 }, () => ({ program: 0 })) };
async function d<T = Record<string, unknown>>(id: string, input: unknown): Promise<T> {
  const r = await dispatch(id as never, input as never);
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.error)}`);
  return (r as { output: T }).output;
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  freshState({ cleared: true });
  installLivingPorts();
  await getDocumentStore().ready;
  await d('profile.patch', { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95, habits: { typicalSteps: 10000 } });
});
afterEach(() => { vi.useRealTimers(); installLivingPorts(); });

describe('experimental plan activation uses the actual lifecycle providers', () => {
  it('a chosen high-deficit scenario starts only after explicit opt-in, with warnings and no certificate', async () => {
    const { scenarioId } = await d<{ scenarioId: string }>('scenario.create', { name: 'Chosen routine', schedule });
    const first = await dispatch('plan.start', { source: { scenarioId }, startDate: TODAY });
    expect(!first.ok && first.error.code).toBe('safety_blocked');
    expect(getDocumentStore().peekAll('plans')).toHaveLength(0);
    const out = await d<{ planId: string }>('plan.start', { source: { scenarioId }, startDate: TODAY, experimentalTracking: true });
    const v = getDocumentStore().peekAll<PlanVersionDoc>('planVersions').map((x) => bodyOf<PlanVersionDoc>(x)).find((x) => x.planId === out.planId)!;
    const p = bodyOf<PlanDoc>(getDocumentStore().peekAll<PlanDoc>('plans')[0]!);
    expect(p.status).toBe('active');
    expect(p.request.constraints).toMatchObject({ experimentalTracking: true, enforceDefaultDeficitCap: false });
    expect(p.policy.autoApplyLoadLowering).toBe(false);
    expect(v.safetyStatus).toBe('unchecked');
    expect(v.certificate).toBeUndefined();
    expect(v.experimentalWarnings?.join(' ')).toMatch(/clinically validated/);
    expect((await d<{ prescription: unknown }>('today.get', {})).prescription).toBeTruthy();
  }, 120000);

  it('experimental mode never accepts a planner rung as a user-selected scenario', async () => {
    const r = await dispatch('plan.start', { source: { rung: 'easy' }, startDate: TODAY, experimentalTracking: true });
    expect(!r.ok && r.error.code).toBe('invalid_input');
    expect(getDocumentStore().peekAll('plans')).toHaveLength(0);
  });
});
