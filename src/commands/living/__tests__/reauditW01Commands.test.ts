/**
 * Re-audit W0/W1 command-level regressions of the living plan (F03-history), through the bus: a supplement correction
 * rebuilds its active exposure (A1-016); a sleep correction moves its occurrence and wake date together (A1-036); a
 * backfilled measurement lands on its own day (A1-018); a new symptom caps today's and tomorrow's step target before any
 * re-plan (A1-005); current marker locks reach every lifecycle check without a Planner goal (A1-002); a mandatory
 * unsupported bound is never startable and an Unchecked label never authorizes (A1-001).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, createDocumentStore, createMemoryBackend, mintWriteToken } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, getPorts, installLivingPorts, installPorts, type CommandContext, type CommandResult } from '@/commands';
import { currentSafetyRequest, lifecycleCheck, readDocs } from '@/commands/living';
import type { PersonProfile, Schedule } from '@/engine';
import type { PlannerRequestV2 } from '@/engine/planner';
import { REQUIRED_SAFETY_MARGIN_IDS } from '@/engine/planner/domain/model';
import { auditSubjectHash, contextForSchedule, evaluatePlanSafety, issueCertificate, plannerCertificateInputs } from '@/engine/planner/domain/safetyAudit';
import { jointScreenOf } from '@/engine/planner/optim/robust';
import type { EvalOutput } from '@/engine/planner/optim/types';
import { DEFAULT_ITEM_WEIGHTS, observedSleep, projectLiving, supplementExposures, toLoggedDay, type LifecycleFinalAudit, type LogEntry, type MeasurementEntry, type PlanDoc, type PlanVersionDoc, type TodayView } from '@/living';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ5';
const START = '2026-10-01';
const TODAY = '2026-10-05';
const BASE_PROFILE: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { typicalSteps: 6000 }, startDate: START };
const DAY = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 9000 };
const SCHEDULE: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [DAY], days: Array.from({ length: 28 }, () => ({ program: 0 })) };

const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};
const entry = (id: string): LogEntry => ({ ...bodyOf<LogEntry>(getDocumentStore().peek('dailyLogs', id)!), id });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
afterAll(() => {
  vi.useRealTimers();
  installLivingPorts();
  installPorts({ planner: undefined });
});

async function seed(profile: PersonProfile = BASE_PROFILE): Promise<void> {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000015' }), validation: 'off' }));
  const store = getDocumentStore();
  await store.ready;
  const plan: PlanDoc = {
    name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-30T10:00:00.000Z' }, status: 'active',
    startDate: START, plannedEndDate: '2026-10-29', request: { profile, goals: [], horizonDays: 28 }, baselineProfile: profile, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-30T10:00:00.000Z',
  };
  const v1: PlanVersionDoc = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHEDULE,
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-30T10:00:00.000Z',
  };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...v1, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
  });
}

beforeEach(async () => {
  installLivingPorts();
  installPorts({ planner: undefined });
  await seed();
});

// ------------------------------------------------------------------------------------------- A1-016
describe('A1-016: a supplement correction rebuilds its active exposure from the corrected record', () => {
  const product = (mg: number | null) => ({ servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'magnesium', amount: mg, unit: 'mg', basis: 'elemental' }] });

  it('1 → 2 capsules at 200 mg/serving is 400 mg with the new revision as origin; 2 → 1 is 200 mg; undo restores the original', async () => {
    const { entryId } = out<{ entryId: string }>(await dispatch('log.supplement', { date: TODAY, supplementId: 'magnesium', dose: 1, unit: 'capsule', clockH: 21, product: product(200) }));
    const edited = out<{ entryId: string }>(await dispatch('log.edit', { entryId, patch: { dose: 2 } }));
    const e2 = entry(edited.entryId) as Extract<LogEntry, { kind: 'supplement' }>;
    expect(supplementExposures(e2)).toEqual([expect.objectContaining({ id: 'magnesium', value: 400, originEventId: edited.entryId })]);
    expect(e2).toMatchObject({ dose: 2, doseValidity: 'valid', safetyCheck: 'unchecked', supersedes: entryId });
    // the superseded record keeps its own raw dose and exposure
    expect(supplementExposures(entry(entryId) as Extract<LogEntry, { kind: 'supplement' }>)[0]).toMatchObject({ value: 200, originEventId: entryId });
    const back = out<{ entryId: string }>(await dispatch('log.edit', { entryId: edited.entryId, patch: { dose: 1 } }));
    expect(supplementExposures(entry(back.entryId) as Extract<LogEntry, { kind: 'supplement' }>)[0]).toMatchObject({ value: 200, originEventId: back.entryId });
    // the day reduction and the replay read the corrected amount
    const docs = await readDocs(TODAY);
    const p = projectLiving({ docs, today: TODAY, tz: 'UTC', now: `${TODAY}T12:00:00.000Z`, skipAssimilation: true });
    expect(p.days.find((d) => d.date === TODAY)!.result.actives.magnesium).toMatchObject({ knownDaily: 200, events: 1 });
    // undoing the correction restores the original effective dose
    out(await dispatch('log.retract', { entryId: back.entryId }));
    const after = projectLiving({ docs: await readDocs(TODAY), today: TODAY, tz: 'UTC', now: `${TODAY}T12:00:00.000Z`, skipAssimilation: true });
    expect(after.days.find((d) => d.date === TODAY)!.result.actives.magnesium).toMatchObject({ knownDaily: 400 });
  });

  it('a product potency change is used; an incompatible serving basis is unknown, never the stale number', async () => {
    const { entryId } = out<{ entryId: string }>(await dispatch('log.supplement', { date: TODAY, supplementId: 'magnesium', dose: 2, unit: 'capsule', product: product(100) }));
    const stronger = out<{ entryId: string }>(await dispatch('log.edit', { entryId, patch: { product: product(200) } }));
    expect(supplementExposures(entry(stronger.entryId) as Extract<LogEntry, { kind: 'supplement' }>)[0]).toMatchObject({ value: 400 });
    const grams = out<{ entryId: string }>(await dispatch('log.edit', { entryId: stronger.entryId, patch: { unit: 'scoop' } }));
    expect(supplementExposures(entry(grams.entryId) as Extract<LogEntry, { kind: 'supplement' }>)[0]).toMatchObject({ value: null });
  });
});

// ------------------------------------------------------------------------------------------- A1-036
describe('A1-036: a sleep correction moves its occurrence interval and wake date together', () => {
  it('a corrected wake time is the canonical occurrence and the observed episode alike; the original stays', async () => {
    const { entryId } = out<{ entryId: string }>(await dispatch('log.sleep', { bedAt: '2026-10-04T23:00:00Z', wakeAt: '2026-10-05T07:00:00Z' }));
    const fixed = out<{ entryId: string }>(await dispatch('log.edit', { entryId, patch: { wakeAt: '2026-10-05T09:00:00Z' } }));
    const e = entry(fixed.entryId) as Extract<LogEntry, { kind: 'sleep' }>;
    expect(e.occurrence?.interval).toEqual({ start: '2026-10-04T23:00:00Z', end: '2026-10-05T09:00:00Z' });
    expect(observedSleep([e])!.hours).toBeCloseTo(10, 9);
    expect((entry(entryId) as Extract<LogEntry, { kind: 'sleep' }>).occurrence?.interval?.end).toBe('2026-10-05T07:00:00Z');
    // the canonical history event of the effective record agrees with the observed bounds
    vi.setSystemTime(new Date('2026-10-06T12:00:00'));
    const docs = await readDocs('2026-10-06');
    const p = projectLiving({ docs, today: '2026-10-06', tz: 'UTC', now: '2026-10-06T12:00:00.000Z', skipAssimilation: true });
    const ev = p.history!.events.find((x) => x.id === fixed.entryId)!;
    expect(ev.occurrence.interval).toEqual({ start: '2026-10-04T23:00:00Z', end: '2026-10-05T09:00:00Z' });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  });

  it('a correction that moves the wake date moves the record; an impossible interval is refused; undo restores the original', async () => {
    const { entryId } = out<{ entryId: string }>(await dispatch('log.sleep', { bedAt: '2026-10-03T23:00:00Z', wakeAt: '2026-10-04T07:00:00Z' }));
    expect(entry(entryId).date).toBe('2026-10-04');
    const moved = out<{ entryId: string }>(await dispatch('log.edit', { entryId, patch: { bedAt: '2026-10-04T23:00:00Z', wakeAt: '2026-10-05T07:00:00Z' } }));
    expect(entry(moved.entryId)).toMatchObject({ date: '2026-10-05', planDay: 4, occurrence: { date: '2026-10-05', dateMeaning: 'wakeDate' } });
    for (const patch of [{ wakeAt: '2026-10-04T22:00:00Z' }, { wakeAt: '2026-10-06T07:00:01Z' }]) {
      const r = await dispatch('log.edit', { entryId: moved.entryId, patch });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.code).toBe('invalid_input');
    }
    out(await dispatch('log.retract', { entryId: moved.entryId }));
    const docs = await readDocs(TODAY);
    const effective = projectLiving({ docs, today: TODAY, tz: 'UTC', now: `${TODAY}T12:00:00.000Z`, skipAssimilation: true }).days.find((d) => d.date === '2026-10-04')!;
    expect(effective.result.sleep?.main?.wakeAt).toBe('2026-10-04T07:00:00Z');
  });
});

// ------------------------------------------------------------------------------------------- A1-018
describe('A1-018: a measurement with a known instant lands on that instant’s day', () => {
  it('a backfilled reading without a date is placed on its own day, the submitted date is kept, a contradicting one refused', async () => {
    const { entryId } = out<{ entryId: string }>(await dispatch('log.measurement', { metric: 'bodyFatPct', value: 20, method: 'dxa', scanMassKg: 80, occurredAt: '2026-10-03T10:00:00Z' }));
    const m = bodyOf<MeasurementEntry>(getDocumentStore().peek('measurements', entryId)!);
    expect(m.date).toBe('2026-10-03');
    expect(m.occurrence).toMatchObject({ precision: 'exact', at: '2026-10-03T10:00:00Z', date: '2026-10-03', dateMeaning: 'appDay' });
    expect(m.recordedAt).not.toBe(m.occurrence!.at);
    const both = out<{ entryId: string }>(await dispatch('log.measurement', { date: '2026-10-03', metric: 'weightKg', value: 89, occurredAt: '2026-10-03T07:00:00Z' }));
    expect(bodyOf<MeasurementEntry>(getDocumentStore().peek('measurements', both.entryId)!).date).toBe('2026-10-03');
    const bad = await dispatch('log.measurement', { date: '2026-10-05', metric: 'weightKg', value: 89, occurredAt: '2026-10-03T07:00:00Z' });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatchObject({ code: 'invalid_input', detail: { path: '/date' } });
  });
});

// ------------------------------------------------------------------------------------------- A1-005
describe('A1-005: a new exertional symptom caps the step target before any re-plan', () => {
  it('9000 steps on a documented 6000 baseline: today and tomorrow read 6000 with a Review status; logged steps stay as logged', async () => {
    const before = out<TodayView>(await dispatch('today.get', {}));
    expect(before.prescription?.steps).toBe(9000);
    out(await dispatch('log.subjective', { symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } }));
    const view = out<TodayView>(await dispatch('today.get', {}));
    expect(view.prescription?.steps).toBe(6000);
    expect(view.exerciseEligibility).toMatchObject({ status: 'suspended', steps: { status: 'capped', target: 6000, prescribed: 9000, ceilingSource: 'documentedBaseline' } });
    expect(view.notices).toContainEqual(expect.objectContaining({ id: 'stepsHold', kind: 'safety' }));
    const tomorrow = out<{ prescription: { steps?: number } | null; exerciseEligibility?: unknown }>(await dispatch('day.get', { date: '2026-10-06' }));
    expect(tomorrow.prescription?.steps).toBe(6000);
    // the person's own count is an observation: recorded exactly as logged
    const { entryId } = out<{ entryId: string }>(await dispatch('log.steps', { steps: 9000 }));
    expect((entry(entryId) as Extract<LogEntry, { kind: 'steps' }>).steps).toBe(9000);
    // a past day keeps what it prescribed
    const past = out<{ prescription: { steps?: number } | null }>(await dispatch('day.get', { date: '2026-10-03' }));
    expect(past.prescription?.steps).toBe(9000);
    // the resolution restores the step target at once
    out(await dispatch('log.subjective', { symptom: { category: 'exertionalChestDiscomfort', status: 'resolved', context: 'exertional' } }));
    expect(out<TodayView>(await dispatch('today.get', {})).prescription?.steps).toBe(9000);
  });

  it('without a documented baseline the held step target has no number', async () => {
    await seed({ ...BASE_PROFILE, habits: {} });
    out(await dispatch('log.subjective', { symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } }));
    const view = out<TodayView>(await dispatch('today.get', {}));
    expect(view.prescription?.steps).toBeUndefined();
    expect(view.exerciseEligibility?.steps).toMatchObject({ status: 'noNumericTarget', target: null, prescribed: 9000 });
    expect(view.notices).toContainEqual(expect.objectContaining({ id: 'stepsHold', text: 'Review: no step target.' }));
  });
});

// ------------------------------------------------------------------------------------------- A1-022
describe('A1-022: an ordinary minutes-only log.session keeps its unknown hard-set count through storage and replay', () => {
  it('the entry carries the provider’s dose status; the replay names the unknown-dose scenario and keeps the energy context', async () => {
    const r = out<{ entryId: string; equivalence: { credit: number | null; completion?: { status: string } } }>(await dispatch('log.session', { date: TODAY, status: 'done', startH: 7, performed: [{ exerciseId: 'surya_namaskar', minutes: 30 }] }));
    const e = entry(r.entryId) as Extract<LogEntry, { kind: 'session' }>;
    expect(e.doseStatus).toBe('unknown');
    expect(e.stimulus.netKcal).toBeGreaterThan(0);
    const docs = await readDocs(TODAY);
    const day = projectLiving({ docs, today: TODAY, tz: 'UTC', now: `${TODAY}T12:00:00.000Z`, skipAssimilation: true }).days.find((d) => d.date === TODAY)!;
    expect(day.result.assumptions).toContainEqual({ kind: 'prescriptionReplay', reasonCode: 'sessionDose:unknown' });
    const rt = day.result.loggedDay.inputs.exercise?.find((x) => x.kind === 'resistance');
    if (rt) expect(rt).toMatchObject({ doseStatus: 'unknown', unknownDoseScenario: 'legacyMinuteConversion' });
    expect(day.result.resolution).toBe('scenario');
  });
});

// ------------------------------------------------------------------------------------------- lifecycle (A1-001, A1-002)
const PROTOCOL = { M: 16, seed: 'joint' };
const PASS = jointScreenOf(Array.from({ length: 16 }, (): EvalOutput => ({ goals: [1], margins: [1], regulariser: 0, descriptors: [] })), [0]);
/** A declared final audit that issues one certificate for exactly the subject it is given (counting its calls). */
function fakeAudit(calls: unknown[]): LifecycleFinalAudit {
  return async (i) => {
    calls.push(i);
    const ctx = contextForSchedule(i.request, i.schedule);
    const e = evaluatePlanSafety(ctx, i.schedule, null);
    return issueCertificate(plannerCertificateInputs(ctx, i.schedule, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL, i.historyHash, i.stateHash), { screen: PASS, subjectHash: auditSubjectHash(i.schedule), protocol: PROTOCOL }, e.status, { episodeId: i.episodeId, createdAt: i.createdAt });
  };
}
const ctxNow = (): CommandContext => ({ now: `${TODAY}T12:00:00.000Z`, today: TODAY, tz: 'UTC', ports: getPorts() }) as unknown as CommandContext;
/** 2500 kcal, protein 150 g, carbohydrate 180 g, fat the remainder (~47 %E): over a 30 %E fat cap. */
const HIGH_FAT: Schedule = { schemaVersion: 1, startDate: '2026-10-08', horizonDays: 28, programs: [{ id: 'H', label: 'high fat', energy: { kind: 'kcal', kcal: 2500 }, macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 180 }, fat: { unit: 'remainder' } } }], days: Array.from({ length: 28 }, () => ({ program: 0 })) };
const ADULT: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-10-08' };
const scenarioRequest = (safety?: PlannerRequestV2['safety']): PlannerRequestV2 => ({ profile: ADULT, goals: [], horizonDays: 28, startDate: '2026-10-08', ...(safety ? { safety } : {}) });
const publish = (safety: PlannerRequestV2['safety']) => installPorts({ planner: { prepare: () => ({ request: scenarioRequest(safety), hash: 'p' }), run: async () => null, cancel: () => undefined } });

describe('A1-002: current marker locks reach the lifecycle check without a Planner goal or a fresh prepared request', () => {
  beforeEach(async () => {
    out(await dispatch('markers.set', { readings: [{ id: 'tg', value: 1000, unit: 'mg/dL', date: '2026-10-01' }] }));
  });

  it('no published request: the screening input is composed headlessly, the TG fat cap joins it and the high-fat plan is refused', async () => {
    const calls: unknown[] = [];
    installPorts({ planner: undefined }); // nothing published
    installLivingPorts({ audit: fakeAudit(calls) });
    const cs = currentSafetyRequest(ctxNow(), scenarioRequest());
    // the stored screening, read without a mounted Planner or a goal (`plannerSafetyInputNow`), plus the current marker locks
    expect(cs.status).toBe('current');
    expect(cs.missing).toEqual([]);
    expect(cs.request.safety?.plannerLocks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fat-cap', value: 30 })]));
    const docs = await readDocs(TODAY);
    const r = await lifecycleCheck(ctxNow(), docs, { boundary: 'scenarioStart', request: scenarioRequest(), schedule: HIGH_FAT, fromDay: 0 });
    expect(r).toMatchObject({ blocked: true, startable: false, coverage: 'current' });
    expect(r.status).not.toBe('verified');
    expect(calls).toHaveLength(0); // nothing is audited into permission
  });

  it('a stale published request without the lock never hides it; the audit port is not asked for a known violation', async () => {
    const calls: unknown[] = [];
    installLivingPorts({ audit: fakeAudit(calls) });
    publish({ plannerLocks: [] });
    const cs = currentSafetyRequest(ctxNow(), scenarioRequest());
    expect(cs.status).toBe('current');
    expect(cs.request.safety?.plannerLocks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fat-cap', value: 30 })]));
    const r = await lifecycleCheck(ctxNow(), await readDocs(TODAY), { boundary: 'scenarioStart', request: scenarioRequest(), schedule: HIGH_FAT, fromDay: 0 });
    expect(r).toMatchObject({ blocked: true, startable: false, status: 'violation' });
    expect(calls).toHaveLength(0);
  });
});

describe('A1-001: activation needs the planner’s authoritative startability', () => {
  const LOW_FAT: Schedule = { ...HIGH_FAT, programs: [{ id: 'L', label: 'balanced', energy: { kind: 'kcal', kcal: 2300 }, macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 290 }, fat: { unit: 'remainder' } } }] };

  it('without a certificate nothing is startable; one declared audit of exactly the subject makes a clean scenario startable', async () => {
    publish({ plannerLocks: [] });
    installLivingPorts({ audit: undefined }); // no declared final audit available
    const plain = await lifecycleCheck(ctxNow(), await readDocs(TODAY), { boundary: 'scenarioStart', request: scenarioRequest(), schedule: LOW_FAT, fromDay: 0 });
    expect(plain).toMatchObject({ blocked: true, startable: false, status: 'unchecked' });
    const calls: unknown[] = [];
    installLivingPorts({ audit: fakeAudit(calls) });
    const audited = await lifecycleCheck(ctxNow(), await readDocs(TODAY), { boundary: 'scenarioStart', request: scenarioRequest(), schedule: LOW_FAT, fromDay: 0 });
    expect(calls).toHaveLength(1);
    expect(audited).toMatchObject({ blocked: false, startable: true, status: 'verified' });
    expect(audited.certificate?.status).toBe('verified');
  });

  it('a mandatory clinician saturated-fat cap without a resolved channel is never startable; an optional one does not lock', async () => {
    const calls: unknown[] = [];
    installLivingPorts({ audit: fakeAudit(calls) });
    publish({ plannerLocks: [{ id: 'satfat-cap', value: 5, unit: '%E', source: 'clinician', mandatory: true }] });
    const locked = await lifecycleCheck(ctxNow(), await readDocs(TODAY), { boundary: 'scenarioStart', request: scenarioRequest(), schedule: LOW_FAT, fromDay: 0 });
    expect(locked).toMatchObject({ blocked: true, startable: false });
    expect(locked.status).not.toBe('verified');
    expect(calls).toHaveLength(0);
    publish({ plannerLocks: [{ id: 'satfat-cap', value: 5, unit: '%E', source: 'clinician', mandatory: false }] });
    const optional = await lifecycleCheck(ctxNow(), await readDocs(TODAY), { boundary: 'scenarioStart', request: scenarioRequest(), schedule: LOW_FAT, fromDay: 0 });
    expect(optional).toMatchObject({ startable: true, status: 'verified' });
  });

  it('an absent or failing revalidation never authorizes', async () => {
    publish({ plannerLocks: [] });
    installLivingPorts({ revalidate: async () => null, audit: fakeAudit([]) });
    const none = await lifecycleCheck(ctxNow(), await readDocs(TODAY), { boundary: 'scenarioStart', request: scenarioRequest(), schedule: LOW_FAT, fromDay: 0 });
    expect(none).toMatchObject({ blocked: true, startable: false });
    installLivingPorts({ revalidate: async () => { throw new Error('worker gone'); } });
    const thrown = await lifecycleCheck(ctxNow(), await readDocs(TODAY), { boundary: 'scenarioStart', request: scenarioRequest(), schedule: LOW_FAT, fromDay: 0 });
    expect(thrown).toMatchObject({ blocked: true, startable: false });
  });

  it('logging stays available while a prescription is withheld', async () => {
    installLivingPorts({ revalidate: async () => null });
    out(await dispatch('log.subjective', { symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } }));
    expect((await dispatch('log.steps', { steps: 4000 })).ok).toBe(true);
    expect(toLoggedDay).toBeDefined();
  });
});
