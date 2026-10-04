/**
 * Smoke test of the living-plan executors through the command bus on an in-memory store: a weigh-in and a day mark are
 * written, `plan.adherence` and `today.get` read them back through the pure projection. (Starting a plan from a Planner
 * rung or a scenario needs the Planner/Simulator projections; the start logic itself is covered by `src/living` tests.)
 */
import { createDocumentStore, createMemoryBackend, mintWriteToken } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, getCommand } from '@/commands';
import { livingImplemented } from '@/commands/living';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };

beforeEach(() => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000001' }), validation: 'off' }));
});

const outputOf = <T,>(r: Awaited<ReturnType<typeof dispatch>>): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

describe('living executors (E5) on the command bus', () => {
  it('replace the stubs they implement (the adaptation commands included)', () => {
    expect(livingImplemented()).toEqual(expect.arrayContaining(['today.get', 'plan.start', 'log.markDay', 'log.measurement', 'plan.checkIn']));
    expect(getCommand('today.get')!.notImplemented).toBeUndefined();
    expect(getCommand('plan.replan')!.notImplemented).toBeUndefined();
  });

  it('without a plan: Today is in planning mode; measurements are validated and stored', async () => {
    expect(outputOf<{ mode: string }>(await dispatch('today.get', {})).mode).toBe('planning');
    expect((await dispatch('log.measurement', { metric: 'weightKg', value: 89.6, context: 'morningFasted' })).ok).toBe(true);
    expect((await dispatch('log.measurement', { metric: 'shoeSize', value: 44 })).ok).toBe(false);
  });

  it('log.get returns one flagged measurement when two devices edit the same reading', async () => {
    const store = getDocumentStore();
    await store.ready;
    const date = '2026-10-05';
    const source = { by: 'user', method: 'typed' };
    await store.transact(mintWriteToken('migration', { label: 'synthetic fork' }), async (tx) => {
      await tx.append('measurements', { _id: 'reading', date, at: '2026-10-05T10:00:00Z', metric: 'weightKg', value: 70, source });
      await tx.append('measurements', { _id: 'reading-a', date, at: '2026-10-05T11:00:00Z', metric: 'weightKg', value: 71, source, supersedes: 'reading' });
      await tx.append('measurements', { _id: 'reading-b', date, at: '2026-10-05T12:00:00Z', metric: 'weightKg', value: 72, source, supersedes: 'reading' });
    });
    const all = outputOf<Array<{ id: string; kind: string; value: number; conflict?: { versions: Array<{ id: string }> } }>>(
      await dispatch('log.get', { from: date, to: date }),
    );
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'reading-b', kind: 'measurement', value: 72 });
    expect(all[0]?.conflict?.versions.map((v) => v.id)).toEqual(['reading-b', 'reading-a']);
    expect(outputOf<unknown[]>(await dispatch('log.get', { from: date, to: date, kinds: ['meal'] }))).toEqual([]);
  });

  it('with a running plan: a mark scores the day and Today shows the prescription', async () => {
    const store = getDocumentStore();
    await store.ready;
    const plan: PlanDoc = {
      name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
      startDate: '2026-09-28', plannedEndDate: '2026-10-26', request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
      pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
    };
    const day = {
      id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 },
      macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000,
    };
    const version: PlanVersionDoc = {
      planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
      schedule: { schemaVersion: 1, startDate: '2026-09-28', horizonDays: 28, programs: [day], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
      genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
      forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
      provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-27T10:00:00.000Z',
    };
    await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
      await tx.put('plans', { ...plan, _id: PLAN_ID });
      await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
      await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: '2026-09-28' });
    });
    expect((await dispatch('log.markDay', { date: '2026-09-29', marks: { all: 'asPlanned' } })).ok).toBe(true);
    const adh = outputOf<{ days: Array<{ date: string; score: number | null }> }>(await dispatch('plan.adherence', {}));
    expect(adh.days.find((d) => d.date === '2026-09-29')?.score).toBe(100);
    const today = outputOf<{ mode: string; prescription: { energyKcal: number } | null }>(await dispatch('today.get', { date: '2026-10-05' }));
    expect(today.mode).toBe('living');
    expect(today.prescription?.energyKcal).toBeCloseTo(2000, 6);
  });
});
