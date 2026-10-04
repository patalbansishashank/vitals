/**
 * A weigh-in logged between midnight and the 04:00 rollover counts for the app day (SUITE_SPEC §3.4): Today's trend
 * (`today.get`'s `trendWeight`) shows it exactly as it would before midnight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, outputOf, settleCommits } from '..';
import { freshState } from './harness';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ1';
const START = '2026-10-02';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 88 }, startDate: START };

async function seedPlan() {
  const plan = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-02T22:40:00.000Z' }, status: 'active',
    startDate: START, plannedEndDate: '2026-10-30', request: { profile: MAN, goals: [{ metric: 'scaleWeight', target: 84 }], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-02T22:40:00.000Z',
  } as unknown as PlanDoc;
  const day = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000 };
  const line = Array.from({ length: 28 }, (_, k) => 88 - k * 0.1);
  const version = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [day], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: { scaleWeight: { p10: line.map((x) => x - 1), p50: line, p90: line.map((x) => x + 1) } }, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-10-02T22:40:00.000Z',
  } as unknown as PlanVersionDoc;
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
  });
}

const weighAt = async (wall: Date) => {
  vi.setSystemTime(wall);
  await seedPlan();
  const logged = await dispatch('log.measurement', { metric: 'weightKg', value: 87.6, date: START });
  expect(logged.ok).toBe(true);
  await settleCommits();
  const view = outputOf(await dispatch('today.get', {})) as { date: string; trendWeight: { kg: number } | null };
  return view;
};

describe('a weigh-in between midnight and the rollover', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('shows a trend before midnight', async () => {
    const v = await weighAt(new Date(2026, 9, 2, 23, 50));
    expect(v.date).toBe(START);
    expect(v.trendWeight?.kg).toBeCloseTo(87.6, 0);
  }, 20_000);

  it('shows the same trend at 00:50 (app day still the plan’s day 1)', async () => {
    const v = await weighAt(new Date(2026, 9, 3, 0, 50));
    expect(v.date).toBe(START);
    expect(v.trendWeight?.kg).toBeCloseTo(87.6, 0);
  }, 20_000);
});
