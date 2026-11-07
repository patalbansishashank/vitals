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

async function seedRunningPlan(): Promise<void> {
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
}

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
    await seedRunningPlan();
    expect((await dispatch('log.markDay', { date: '2026-09-29', marks: { all: 'asPlanned' } })).ok).toBe(true);
    const adh = outputOf<{ days: Array<{ date: string; score: number | null }> }>(await dispatch('plan.adherence', {}));
    expect(adh.days.find((d) => d.date === '2026-09-29')?.score).toBe(100);
    const today = outputOf<{ mode: string; prescription: { energyKcal: number } | null }>(await dispatch('today.get', { date: '2026-10-05' }));
    expect(today.mode).toBe('living');
    expect(today.prescription?.energyKcal).toBeCloseTo(2000, 6);
  });
  it('a meal’s answer (log.markDay meal) is that meal’s alone: no food invented, the other meals open, old marks kept', async () => {
    await seedRunningPlan();
    const date = '2026-10-05';
    await dispatch('log.markDay', { date, marks: { train: 'asPlanned' } });
    const slots = outputOf<{ prescription: { meals: Array<{ slot: string }> } }>(await dispatch('today.get', { date })).prescription.meals.map((m) => m.slot);
    const r = outputOf<{ marks: Record<string, unknown>; meal: { slot: string; mark: string; replaced: string[]; entryId?: string } }>(
      await dispatch('log.markDay', { date, meal: { slot: slots[0]!, mark: 'partly' } }),
    );
    expect(r.meal).toEqual({ slot: slots[0], mark: 'partly', replaced: [] });
    expect(r.marks).toEqual({ train: 'asPlanned', meals: { [slots[0]!]: 'partly' } });
    const today = outputOf<{ marks?: unknown; checklist: Array<{ id: string; done: boolean }> }>(await dispatch('today.get', { date }));
    expect(today.marks).toEqual({ train: 'asPlanned', meals: { [slots[0]!]: 'partly' } });
    expect(today.checklist.filter((c) => c.id.startsWith('meal:')).map((c) => [c.id, c.done])).toEqual(slots.map((s, i) => [`meal:${s}`, i === 0]));
    expect(outputOf<unknown[]>(await dispatch('log.get', { from: date, to: date, kinds: ['meal'] }))).toEqual([]);
    // as planned: the meal's own answer goes, its planned meal is logged in its place
    const planned = outputOf<{ marks: Record<string, unknown>; meal: { entryId?: string } }>(await dispatch('log.markDay', { date, meal: { slot: slots[0]!, mark: 'asPlanned' } }));
    expect(planned.marks).toEqual({ train: 'asPlanned' });
    expect(outputOf<Array<{ id: string; slot?: string }>>(await dispatch('log.get', { from: date, to: date, kinds: ['meal'] })).map((e) => [e.id, e.slot])).toEqual([[planned.meal.entryId, slots[0]]]);
  });

  it('a meal’s answer names the food it replaces: unnamed or stale food is refused, nothing written', async () => {
    await seedRunningPlan();
    const date = '2026-10-05';
    const slot = outputOf<{ prescription: { meals: Array<{ slot: string }> } }>(await dispatch('today.get', { date })).prescription.meals[0]!.slot;
    const logged = outputOf<{ entryId: string }>(await dispatch('log.meal', { date, slot, components: [{ name: 'poha', grams: 100, labelPer100g: { energyKcal: 430, proteinG: 8, carbG: 60, fatG: 12 } }], method: 'typed' }));
    const refused = await dispatch('log.markDay', { date, meal: { slot, mark: 'not' } });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatchObject({ code: 'conflict', message: expect.stringContaining(logged.entryId) });
    expect((await dispatch('log.markDay', { date, meal: { slot, mark: 'not', replaces: ['01JNOTANENTRY0000000000000'] } })).ok).toBe(false);
    expect((await dispatch('log.markDay', { date, meal: { slot, mark: 'partly', components: [] } })).ok).toBe(false);
    expect((await dispatch('log.markDay', { date })).ok).toBe(false);
    expect(outputOf<Array<{ id: string }>>(await dispatch('log.get', { from: date, to: date, kinds: ['meal'] })).map((e) => e.id)).toEqual([logged.entryId]);
    expect(outputOf<{ marks?: unknown }>(await dispatch('today.get', { date })).marks).toBeUndefined();
    // named: the food goes and the answer stays, in one change
    const r = outputOf<{ meal: { replaced: string[] } }>(await dispatch('log.markDay', { date, meal: { slot, mark: 'not', replaces: [logged.entryId] } }));
    expect(r.meal.replaced).toEqual([logged.entryId]);
    expect(outputOf<unknown[]>(await dispatch('log.get', { from: date, to: date, kinds: ['meal'] }))).toEqual([]);
  });
});
