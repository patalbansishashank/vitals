/**
 * W0-history command contracts on the bus (C1, C2, C5; D5-01, D4-02): substance/unit validation with the raw value kept,
 * occurrence separate from the audit time, the explicit day food report, explicit planned-item identity, and a fresh safety
 * check when a proposal made before a symptom report is adopted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, installLivingPorts } from '@/commands';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type DayStatusDoc, type LogEntry, type PlanDoc, type PlanVersionDoc } from '@/living';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ7';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };
const DAY = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } } };
const TRAIN = { ...DAY, id: 'T', label: 'train', exercise: [{ kind: 'resistance' as const, startH: 18, setsByRegion: { quads: 6 } }] };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T12:00:00'));
  // the conservative lifecycle gate alone (no planner revalidation) so the symptom rule is what is tested
  installLivingPorts({ revalidate: async () => null });
});
afterAll(() => {
  vi.useRealTimers();
  installLivingPorts();
});

beforeEach(async () => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000007' }), validation: 'off' }));
  const store = getDocumentStore();
  await store.ready;
  const plan: PlanDoc = {
    name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
    startDate: '2026-09-28', plannedEndDate: '2026-10-26', request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 2,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
  };
  const v1: PlanVersionDoc = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: '2026-09-28', horizonDays: 28, programs: [DAY], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-27T10:00:00.000Z',
  };
  // a proposal with training on every day, made before any symptom was reported
  const v2: PlanVersionDoc = { ...v1, version: 2, parent: 1, status: 'proposed', reason: 'weekly', effectiveFromDay: 7, schedule: { ...v1.schedule, programs: [TRAIN] }, createdAt: '2026-10-04T08:00:00.000Z' };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...v1, _id: `${PLAN_ID}:v1` });
    await tx.append('planVersions', { ...v2, _id: `${PLAN_ID}:v2` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: '2026-09-28' });
  });
});

const entry = (id: string): LogEntry => bodyOf<LogEntry>(getDocumentStore().peek('dailyLogs', id)!);

describe('W0-history command contracts', () => {
  it('log.substance validates the unit pair, keeps the raw value and stores the canonical dose', async () => {
    const bad = await dispatch('log.substance', { date: '2026-10-05', substance: 'alcohol', clockH: 20, amount: 300, unit: 'mg' });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatchObject({ code: 'invalid_input', detail: { path: '/unit' } });
    expect((await dispatch('log.substance', { date: '2026-10-05', substance: 'caffeine', clockH: 8, amount: 2, unit: 'drinks' })).ok).toBe(false);
    const ok = await dispatch('log.substance', { date: '2026-10-05', substance: 'creatine', clockH: 8, amount: 5000, unit: 'mg', occurredAt: '2026-10-05T08:10:00+05:30', itemId: 'supplement:creatine' });
    if (!ok.ok || !('output' in ok)) throw new Error(JSON.stringify(ok));
    const e = entry((ok.output as { entryId: string }).entryId) as Extract<LogEntry, { kind: 'substance' }>;
    expect(e).toMatchObject({ amount: 5000, unit: 'mg', normalized: { value: 5, unit: 'g' }, itemId: 'supplement:creatine', contract: 1 });
    expect(e.link).toMatchObject({ planId: PLAN_ID, itemId: 'supplement:creatine' });
    expect(e.occurrence).toMatchObject({ precision: 'exact', at: '2026-10-05T08:10:00+05:30' });
    expect(e.recordedAt).toBe(e.at);
    const drinks = await dispatch('log.substance', { date: '2026-10-05', substance: 'alcohol', clockH: 20, amount: 2, unit: 'drinks' });
    if (!drinks.ok || !('output' in drinks)) throw new Error(JSON.stringify(drinks));
    expect(entry((drinks.output as { entryId: string }).entryId)).toMatchObject({ amount: 2, unit: 'drinks', normalized: { value: 28, unit: 'g', convention: 'ethanol14gPerDrink' } });
    expect(entry((drinks.output as { entryId: string }).entryId)).not.toHaveProperty('occurrence');
  });

  it('log.confirmDay records the explicit day food report; confirming alone says nothing about completeness', async () => {
    const r = await dispatch('log.confirmDay', { date: '2026-10-03', intake: 'none' });
    if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
    const s = r.output as DayStatusDoc;
    expect(s).toMatchObject({ date: '2026-10-03', intake: 'none' });
    expect(s.intakeAt).toBeDefined();
    const plain = await dispatch('log.confirmDay', { date: '2026-10-02' });
    if (!plain.ok || !('output' in plain)) throw new Error(JSON.stringify(plain));
    expect((plain.output as DayStatusDoc).intake).toBeUndefined();
  });

  it('a proposal with training made before a concerning symptom cannot be adopted unchecked; rejecting it stays possible', async () => {
    const logged = await dispatch('log.subjective', { date: '2026-10-05', symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } });
    expect(logged.ok).toBe(true);
    const adopt = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 });
    expect(adopt.ok).toBe(false);
    expect(!adopt.ok && adopt.error).toMatchObject({ code: 'safety_blocked', detail: { allowedAlternatives: expect.arrayContaining(['plan.rejectVersion']) } });
    expect((await dispatch('plan.rejectVersion', { planId: PLAN_ID, version: 2 })).ok).toBe(true);
  });

  it('without a symptom the same proposal is still not adopted Unchecked: no certificate binds it (A1-001); rejecting stays possible', async () => {
    const adopt = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 });
    expect(adopt.ok).toBe(false);
    expect(!adopt.ok && adopt.error).toMatchObject({ code: 'safety_blocked', detail: { reason: 'unchecked', allowedAlternatives: expect.arrayContaining(['plan.rejectVersion']) } });
    const v = bodyOf<PlanVersionDoc>(getDocumentStore().peek('planVersions', `${PLAN_ID}:v2`)!);
    expect(v.status).toBe('proposed');
    expect((await dispatch('plan.rejectVersion', { planId: PLAN_ID, version: 2 })).ok).toBe(true);
  });
});
