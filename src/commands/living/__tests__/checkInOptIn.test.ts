/**
 * D5-06 — the person's separately stored opt-in policy: with it on, the automatic refresh confirms a due check-in once
 * (mode 'optIn', the decision point today); a second refresh finds the decision and confirms nothing more. Without it
 * (the default) the refresh never confirms. The settings flag is read as stored; here the settings module is mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from '@/state/internal/settings';

const optIn = { on: true };
vi.mock('@/state/internal/settings', async (importOriginal) => {
  const orig = await importOriginal<typeof SettingsModule>();
  return { ...orig, settingsValues: () => ({ ...orig.settingsValues(), ...(optIn.on ? { checkInAutoConfirm: true } : {}) }) };
});

import { createDocumentStore, createMemoryBackend, mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import '@/commands'; // the command registry (plan.checkIn and its executors)
import { installLivingPorts, runCheckInRefresh } from '@/commands/livingWiring';
import type { PersonProfile, Schedule } from '@/engine';
import { addDays, DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZA';
const START = '2026-09-28';
const TODAY = addDays(START, 13);
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: START };
const MACROS = { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } };
const SCHEDULE: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [{ id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 }, macros: MACROS }], days: Array.from({ length: 28 }, () => ({ program: 0 })) };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  // no planner: the opt-in confirmation records the check-in without a proposal
  installLivingPorts({ planner: undefined as never, revalidate: async () => null });
});
afterAll(() => {
  vi.useRealTimers();
  installLivingPorts();
});
beforeEach(async () => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice00000A' }), validation: 'off' }));
  const store = getDocumentStore();
  await store.ready;
  const plan: PlanDoc = {
    name: 'p', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T08:00:00.000Z` }, status: 'active', startDate: START, plannedEndDate: addDays(START, 28),
    request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 6, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHEDULE, genome: null, sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${START}T08:00:00.000Z`,
  };
  await store.transact(mintWriteToken('migration', { label: 'seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
    for (let d = 1; d < 13; d++) {
      const date = addDays(START, d);
      await tx.append('measurements', { _id: `w${String(d).padStart(2, '0')}`, date, at: `${date}T07:00:00.000Z`, metric: 'weightKg', value: 90 - 0.08 * d, context: 'morningFasted', source: { by: 'user', method: 'typed' } });
    }
  });
});

const anchors = () => getDocumentStore().peekAll<Record<string, unknown>>('anchors').map((d) => bodyOf<Record<string, unknown>>(d));

describe('stored opt-in policy (D5-06)', () => {
  it('confirms a due check-in once under the opt-in, then nothing more', async () => {
    optIn.on = true;
    const r = await runCheckInRefresh();
    expect(r).toMatchObject({ due: true, autoConfirmed: true });
    expect(anchors()).toHaveLength(1);
    expect(anchors()[0]).toMatchObject({ anchorDate: TODAY, decision: { status: 'confirmed', mode: 'optIn', confirmedBy: { kind: 'system' } } });
    const again = await runCheckInRefresh();
    expect(again).toMatchObject({ due: false, autoConfirmed: false });
    expect(anchors()).toHaveLength(1);
  }, 60_000);

  it('without the opt-in the refresh never confirms', async () => {
    optIn.on = false;
    expect(await runCheckInRefresh()).toMatchObject({ due: true, autoConfirmed: false });
    expect(anchors()).toEqual([]);
  }, 60_000);
});
