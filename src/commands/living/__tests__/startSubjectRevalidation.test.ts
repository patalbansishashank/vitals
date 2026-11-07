/**
 * Lifecycle revalidation of a start subject resolves the trace-based constraints (the 7-day deficit cap every screened
 * adult carries) on the subject's nominal simulation, as the Planner and the declared final audit do. Before, the
 * production `revalidate` port ran without a simulation, so the deficit cap stayed Unchecked and no screened adult could
 * start any plan (scenario or Planner rung): `lifecycle:revalidation:unchecked`, the final audit never reached.
 *
 * Nothing here weakens the gate: a moderate scenario now goes through the one declared final audit and starts Verified;
 * the 20 % starter still fails that audit for this person; a deficit past the cap stays a known violation; a subject
 * bound to the confirmed state but without that state gets no simulation (never one from the plan start in its place) and
 * stays Unchecked (with it: `confirmedSubjectRevalidation.test.ts`).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, installLivingPorts, type LivingPorts } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { ACK_VERSIONS } from '@/features/onboarding/copyEarly';
import type { LifecycleRevalidate } from '@/living';
import type { PlanVersionDoc } from '@/living/types';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';

const TODAY = '2026-11-02';

async function d<T = Record<string, unknown>>(command: string, input: unknown): Promise<T> {
  const r = await dispatch(command as never, input as never);
  if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
  return (r as { output: T }).output;
}

/** What the e2e (and a person in onboarding) does first: an ordinary healthy adult's screening, the disclaimer, a profile. */
async function screenedAdult(): Promise<void> {
  const at = new Date().toISOString();
  await d('safety.commitScreening', {
    answers: { ageBand: '18-64', pregnancy: 'no', eatingDisorder: 'no', scoffRisk: false, diabetes: 'no', conditions: 'no', metabolic: 'no', medications: 'no', symptoms: 'no', supervisedExercise: 'no', musculoskeletal: 'no', alcohol: 'no' },
    at,
  });
  await d('safety.acknowledge', { id: 'disclaimer', version: ACK_VERSIONS.disclaimer, at });
  await d('profile.patch', { sex: 'male', ageYears: 38, heightCm: 176, weightKg: 84, habits: { typicalSteps: 7000 } });
}

/** A Simulator scenario from the 12-week deficit starter at `pct` % of maintenance. */
async function scenarioAt(pct: number): Promise<string> {
  const { scenarioId } = await d<{ scenarioId: string }>('scenario.create', { name: `Deficit ${pct}`, starter: 'deficit12' });
  await d('scenario.edit', { id: scenarioId, ops: [{ op: 'updateProgram', index: 0, patch: { energy: { kind: 'pctMaintenance', pct } } }] });
  return scenarioId;
}

const versions = () => getDocumentStore().peekAll<PlanVersionDoc>('planVersions').map((x) => bodyOf<PlanVersionDoc>(x));

let ports: LivingPorts;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  freshState({});
  ports = installLivingPorts();
  await getDocumentStore().ready;
  await screenedAdult();
});
afterAll(() => {
  vi.useRealTimers();
  installLivingPorts();
});

describe('start subjects are revalidated on their nominal simulation', () => {
  it('a 15 % deficit scenario is certified by the declared final audit and starts Verified', async () => {
    const scenarioId = await scenarioAt(85);
    const seen: Array<{ reasonCode: string | null | undefined; deficitCap: boolean }> = [];
    const revalidate: LifecycleRevalidate = async (i) => {
      const r = await ports.revalidate!(i);
      seen.push({ reasonCode: r?.reasonCode, deficitCap: (i.request.safety?.plannerLocks ?? []).some((l) => l.id === 'deficit-cap') });
      return r;
    };
    installLivingPorts({ revalidate });
    const out = await d<{ planId: string }>('plan.start', { source: { scenarioId }, startDate: TODAY, name: 'Moderate' });
    // the screening's deficit cap is on the subject; the first check asks for a certificate (not Unchecked), the audit issues one
    expect(seen[0]).toEqual({ reasonCode: 'certificateRequired', deficitCap: true });
    expect(seen.at(-1)?.reasonCode).toBeNull();
    const v1 = versions().find((v) => v.planId === out.planId && v.version === 1)!;
    expect(v1.safetyStatus).toBe('verified');
    expect(v1.certificate?.status).toBe('verified');
    expect((await d<{ prescription: unknown }>('today.get', {})).prescription).toBeTruthy();
  }, 120_000);

  it('the 20 % starter fails its final audit for this person and is refused before any write', async () => {
    await d('scenario.ensureActive', {});
    const r = await dispatch('plan.start', { source: { scenarioId: 'starter' }, startDate: TODAY });
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { rule: 'lifecycle:auditFailed', reason: 'review', allowedAlternatives: ['planner.find'] } });
    expect(versions()).toEqual([]);
  }, 120_000);

  it('a deficit past the cap stays a known violation and is refused before any write', async () => {
    const scenarioId = await scenarioAt(55);
    const r = await dispatch('plan.start', { source: { scenarioId }, startDate: TODAY });
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { reason: 'violation', allowedAlternatives: ['planner.find'] } });
    expect(versions()).toEqual([]);
  }, 120_000);

  it('a subject bound to the confirmed state, without that state, gets no simulation: still Unchecked, never startable', async () => {
    const scenarioId = await scenarioAt(85);
    let subject: Parameters<LifecycleRevalidate>[0] | null = null;
    installLivingPorts({
      revalidate: async (i) => {
        subject ??= i;
        return ports.revalidate!(i);
      },
    });
    await d('plan.start', { source: { scenarioId }, startDate: TODAY });
    const start = subject!;
    const bound = await ports.revalidate!({ ...start, stateHash: 'some-confirmed-state' });
    expect(bound).toMatchObject({ startable: false, reasonCode: 'unchecked', status: 'unchecked' });
    expect(await ports.revalidate!(start)).toMatchObject({ startable: false, reasonCode: 'certificateRequired' });
  }, 120_000);
});
