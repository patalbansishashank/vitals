/**
 * Lifecycle revalidation of a subject bound to the confirmed state (adopting a re-plan, resuming a paused plan) resolves the
 * trace-based constraints (the 7-day deficit cap every screened adult carries) on the re-plan's own forward run from that
 * confirmed state (`confirmedStateSimulation`), as the re-plan's certification did. When no current certificate binds the
 * subject (a start certificate, days lived or a check-in since), the one declared final audit is the re-plan's own
 * certification from that state and history (`confirmedStateCertificate`): a pass issues a re-plan-style certificate bound
 * to that state; a failure refuses with the audit's reason.
 *
 * Before, such a subject got no simulation (`lifecycle:revalidation:unchecked`) and no audit (the port declined), so no
 * screened adult could adopt a re-plan or resume a paused plan. Nothing here weakens the gate: a prescription past the cap
 * is a known violation, and steep confirmed weight loss makes the audit fail.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, installLivingPorts } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { ACK_VERSIONS } from '@/features/onboarding/copyEarly';
import { replan } from '@/engine/planner/domain/replan';
import type { LifecycleFinalAudit, LifecycleRevalidate } from '@/living';
import type { PlanDoc, PlanVersionDoc } from '@/living/types';
import { bodyOf, mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';

const START = '2026-11-02';
const LATER = '2026-11-05';
const at = (date: string) => new Date(`${date}T12:00:00`);

async function d<T = Record<string, unknown>>(command: string, input: unknown): Promise<T> {
  const r = await dispatch(command as never, input as never);
  if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
  return (r as { output: T }).output;
}

/** An ordinary healthy adult's screening (it carries the 7-day deficit cap), the disclaimer and a profile. */
async function screenedAdult(): Promise<void> {
  const now = new Date().toISOString();
  await d('safety.commitScreening', {
    answers: { ageBand: '18-64', pregnancy: 'no', eatingDisorder: 'no', scoffRisk: false, diabetes: 'no', conditions: 'no', metabolic: 'no', medications: 'no', symptoms: 'no', supervisedExercise: 'no', musculoskeletal: 'no', alcohol: 'no' },
    at: now,
  });
  await d('safety.acknowledge', { id: 'disclaimer', version: ACK_VERSIONS.disclaimer, at: now });
  await d('profile.patch', { sex: 'male', ageYears: 38, heightCm: 176, weightKg: 84, habits: { typicalSteps: 7000 } });
}

/** A Verified plan from the 12-week deficit starter at 85 % of maintenance, started on START. */
async function startedPlan(): Promise<string> {
  const { scenarioId } = await d<{ scenarioId: string }>('scenario.create', { name: 'Deficit 85', starter: 'deficit12' });
  await d('scenario.edit', { id: scenarioId, ops: [{ op: 'updateProgram', index: 0, patch: { energy: { kind: 'pctMaintenance', pct: 85 } } }] });
  return (await d<{ planId: string }>('plan.start', { source: { scenarioId }, startDate: START, name: 'Moderate', checkInWeekday: 0 })).planId;
}

const versions = () => getDocumentStore().peekAll<PlanVersionDoc>('planVersions').map((x) => bodyOf<PlanVersionDoc>(x)).sort((a, b) => a.version - b.version);
const planDoc = (id: string) => bodyOf<PlanDoc>(getDocumentStore().peek<PlanDoc>('plans', id)!);

/** The person's own re-plan of one day (more food on LATER + 2): adopted at the re-plan boundary when it is startable. */
async function replanned(planId: string): Promise<PlanVersionDoc> {
  const r = await d<{ version: number | null; status: string }>('plan.editDay', { date: '2026-11-07', scope: 'day', patch: { energy: { kind: 'pctMaintenance', pct: 90 } } });
  expect(r.version).toBe(2);
  return versions().find((v) => v.planId === planId && v.version === 2)!;
}

/** `v` with every day from plan day `from` at `pct` % of maintenance (its certificate kept: it no longer binds the schedule). */
function deepened(v: PlanVersionDoc, from: number, pct: number): PlanVersionDoc['schedule'] {
  return { ...v.schedule, days: v.schedule.days.map((x, k) => (k >= from ? { ...x, override: { ...(x.override ?? {}), energy: { kind: 'pctMaintenance' as const, pct } } } : x)) };
}

async function write(planId: string, v: PlanVersionDoc, plan?: Partial<PlanDoc>): Promise<void> {
  await getDocumentStore().transact(mintWriteToken('migration', { label: 'test' }), async (tx) => {
    await tx.append('planVersions', { ...v, _id: `${planId}:v${v.version}` });
    if (plan) await tx.put('plans', { ...planDoc(planId), ...plan, _id: planId });
  });
}

type Seen = { reasonCode: string | null | undefined; confirmed: boolean } | { audit: string | undefined; screen: string | undefined; confirmed: boolean };
/** Records what each revalidation and declared audit of the given boundary decided (the production ports underneath). */
function watch(boundary: string): Seen[] {
  const seen: Seen[] = [];
  const planner = { replan: (req: Parameters<typeof replan>[0], o?: { tier?: 'S' | 'M' | 'L' | 'X' }) => replan(req, { tier: o?.tier ?? 'S' }) };
  const prod = installLivingPorts({ planner });
  const revalidate: LifecycleRevalidate = async (i) => {
    const r = await prod.revalidate!(i);
    if (i.boundary === boundary) seen.push({ reasonCode: r?.reasonCode, confirmed: !!i.confirmed });
    return r;
  };
  const audit: LifecycleFinalAudit = async (i) => {
    const c = await prod.audit!(i);
    if (i.boundary === boundary) seen.push({ audit: c?.status, screen: c?.audit?.status, confirmed: !!i.confirmed });
    return c;
  };
  installLivingPorts({ planner, revalidate, audit });
  return seen;
}

/** The days START.. before `until` with steps logged, and a morning weigh-in on each (weights[k] on day k). */
async function lived(weights: readonly number[], steps = true): Promise<void> {
  for (let k = 0; k < weights.length; k++) {
    const date = `2026-11-${String(2 + k).padStart(2, '0')}`;
    vi.setSystemTime(new Date(`${date}T07:00:00`));
    await d('log.measurement', { metric: 'weightKg', value: weights[k], context: 'morningFasted' });
    if (steps && k < 7) await d('log.steps', { date, steps: 7000 });
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(START));
  freshState({});
  installLivingPorts({ planner: { replan: (req, o) => replan(req, { tier: o?.tier ?? 'S' }) } });
  await getDocumentStore().ready;
  await screenedAdult();
});
afterAll(() => {
  vi.useRealTimers();
  installLivingPorts();
});

describe('adopting a re-plan: revalidated on the simulation from the confirmed state', () => {
  it('a safe re-plan of the person\'s own is adopted at the re-plan boundary, Verified', async () => {
    const planId = await startedPlan();
    vi.setSystemTime(at(LATER));
    const seen = watch('replan');
    const v2 = await replanned(planId);
    expect(seen).toEqual([{ reasonCode: null, confirmed: true }]);
    expect(v2).toMatchObject({ status: 'adopted', safetyStatus: 'verified', effectiveFromDay: 3 });
    expect(v2.certificate?.status).toBe('verified');
    expect(planDoc(planId).headVersion).toBe(2);
  }, 300_000);

  it('a stored safe proposal is adopted with plan.adoptVersion, Verified', async () => {
    const planId = await startedPlan();
    vi.setSystemTime(at(LATER));
    const v2 = await replanned(planId);
    // the same certified re-plan, stored as a proposal (as the Coach's or a load-raising change leaves it)
    await write(planId, { ...v2, version: 3, parent: 1, status: 'proposed', safetyStatus: 'verified' });
    const seen = watch('adopt');
    const r = await d<{ version: number; status: string }>('plan.adoptVersion', { planId, version: 3 });
    expect(seen).toEqual([{ reasonCode: null, confirmed: true }]);
    expect(r.status).toBe('adopted');
    expect(versions().find((v) => v.version === r.version)).toMatchObject({ status: 'adopted', safetyStatus: 'verified' });
  }, 300_000);

  it('a proposal past the deficit cap is a known violation: refused, nothing written', async () => {
    const planId = await startedPlan();
    vi.setSystemTime(at(LATER));
    const v2 = await replanned(planId);
    await write(planId, { ...v2, version: 3, parent: 1, status: 'proposed', schedule: deepened(v2, 3, 50) });
    const before = versions().length;
    const r = await dispatch('plan.adoptVersion', { planId, version: 3 });
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { reason: 'violation', allowedAlternatives: ['plan.rejectVersion', 'plan.replan'] } });
    expect(versions()).toHaveLength(before);
    expect(planDoc(planId).headVersion).toBe(2);
  }, 300_000);
});

describe('resuming a paused plan: revalidated on the simulation from the confirmed state', () => {
  it('a safe paused plan resumes, Verified', async () => {
    const planId = await startedPlan();
    vi.setSystemTime(at(LATER));
    await replanned(planId);
    await d('plan.pause', {});
    const seen = watch('resume');
    await d('plan.resume', {});
    expect(seen).toEqual([{ reasonCode: null, confirmed: true }]);
    expect(planDoc(planId).status).toBe('active');
    expect(versions().find((v) => v.version === planDoc(planId).headVersion)?.safetyStatus).toBe('verified');
  }, 300_000);

  it('a paused prescription past the deficit cap is a known violation: refused, nothing written, still paused', async () => {
    const planId = await startedPlan();
    vi.setSystemTime(at(LATER));
    const v2 = await replanned(planId);
    await write(planId, { ...v2, version: 3, parent: 2, schedule: deepened(v2, 3, 50) }, { headVersion: 3 });
    await d('plan.pause', {});
    const before = versions().length;
    const r = await dispatch('plan.resume', {});
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { reason: 'violation', allowedAlternatives: ['plan.end'] } });
    expect(versions()).toHaveLength(before);
    expect(planDoc(planId).status).toBe('paused');
  }, 300_000);

  it('a paused plan holding only its start certificate, with logged days, resumes Verified once the confirmed-state audit passes', async () => {
    const planId = await startedPlan();
    await lived([84, 83.9, 83.8]);
    vi.setSystemTime(at(LATER));
    await d('plan.pause', {});
    const seen = watch('resume');
    await d('plan.resume', {});
    // the start certificate binds neither this history nor this state: one confirmed-state audit, then Verified
    expect(seen).toEqual([{ reasonCode: 'certificateRequired', confirmed: true }, { audit: 'verified', screen: 'pass', confirmed: true }, { reasonCode: null, confirmed: true }]);
    expect(planDoc(planId).status).toBe('active');
  }, 300_000);

  it('a shifted resume stores the audit\'s re-plan-style certificate, bound to the current state, the start one kept as history', async () => {
    const planId = await startedPlan();
    const start = versions()[0]!.certificate!;
    await lived([84, 83.9, 83.8]);
    vi.setSystemTime(at(LATER));
    await d('plan.pause', {});
    vi.setSystemTime(at('2026-11-07'));
    await d('plan.resume', {});
    const v = versions().at(-1)!;
    expect(v).toMatchObject({ version: 2, reason: 'resume', status: 'adopted', safetyStatus: 'verified' });
    expect(v.certificate).toMatchObject({ status: 'verified', audit: { status: 'pass' } });
    expect(v.certificate!.fingerprint).not.toBe(start.fingerprint);
    expect(v.certificate!.history?.map((h) => h.fingerprint)).toEqual([start.fingerprint]);
    expect(planDoc(planId)).toMatchObject({ status: 'active', headVersion: 2 });
  }, 300_000);

  it('a check-in followed by a resume works when safe: the audit from the new confirmed state passes', async () => {
    const planId = await startedPlan();
    await lived([84, 83.8, 83.7, 83.5, 83.4, 83.3, 83.1, 83.0]);
    const ci = await d<{ verdict: string }>('plan.checkIn', {});
    expect(ci.verdict).toBe('confirmed');
    await d('plan.pause', {});
    vi.setSystemTime(at('2026-11-10'));
    const seen = watch('resume');
    await d('plan.resume', {});
    expect(seen.at(-2)).toEqual({ audit: 'verified', screen: 'pass', confirmed: true });
    expect(seen.at(-1)).toEqual({ reasonCode: null, confirmed: true });
    expect(planDoc(planId).status).toBe('active');
    expect(versions().at(-1)).toMatchObject({ reason: 'resume', safetyStatus: 'verified', certificate: { status: 'verified' } });
  }, 600_000);

  it('the audit really runs: steep weight loss confirmed at a check-in fails it, so the resume is refused with nothing written', async () => {
    const planId = await startedPlan();
    // 9 kg in a week, confirmed by the check-in: the plan's typed constraints still pass, the audit's hard margins do not
    await lived([84, 82, 80.5, 79, 78, 77, 76, 75]);
    expect((await d<{ verdict: string }>('plan.checkIn', {})).verdict).toBe('confirmed');
    await d('plan.pause', {});
    vi.setSystemTime(at('2026-11-10'));
    const before = versions().length;
    const seen = watch('resume');
    const r = await dispatch('plan.resume', {});
    expect(seen).toEqual([{ reasonCode: 'certificateRequired', confirmed: true }, { audit: 'failed', screen: 'fail', confirmed: true }, { reasonCode: 'certificateFailed', confirmed: true }]);
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { rule: 'lifecycle:auditFailed', reason: 'review', allowedAlternatives: ['plan.end'] } });
    expect(versions()).toHaveLength(before);
    expect(planDoc(planId).status).toBe('paused');
  }, 600_000);
});
