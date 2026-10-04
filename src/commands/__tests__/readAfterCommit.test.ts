/**
 * Q3-J5-10: a read dispatched on a write's `committed` event sees that write. `committed` fires when the write ran,
 * before its documents land (an IndexedDB transaction, or the 300 ms idle window of a coalescing gesture); reads look
 * at the stored documents, so the bus makes a read wait for the writes still on their way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, on, outputOf, settleCommits, type BusEvent, type CommandResult } from '..';
import { changeSets } from '../history';
import { freshState } from './harness';

type PantryOut = { items: Array<{ id: string }> };

/** Dispatch `write`; on its `committed` event dispatch `read` at once (as a screen or a script does). */
async function readOnCommitted(write: () => Promise<CommandResult>, writeId: string, read: () => Promise<CommandResult>) {
  let readP: Promise<CommandResult> | null = null;
  const off = on((e: BusEvent) => {
    if (!readP && e.type === 'committed' && e.commandId === writeId && e.changeSet) readP = read();
  });
  try {
    const w = await write();
    expect(w.ok).toBe(true);
    expect(readP).not.toBeNull();
    return { write: w, read: await readP! };
  } finally {
    off();
  }
}

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ1';
const START = '2026-10-02';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 88 }, startDate: START };

async function seedPlan() {
  const plan = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-02T08:00:00.000Z' }, status: 'active',
    startDate: START, plannedEndDate: '2026-10-30', request: { profile: MAN, goals: [{ metric: 'scaleWeight', target: 84 }], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-02T08:00:00.000Z',
  } as unknown as PlanDoc;
  const day = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000 };
  const line = Array.from({ length: 28 }, (_, k) => 88 - k * 0.1);
  const version = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [day], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: { scaleWeight: { p10: line.map((x) => x - 1), p50: line, p90: line.map((x) => x + 1) } }, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-10-02T08:00:00.000Z',
  } as unknown as PlanVersionDoc;
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
  });
}

describe('a read on a write’s committed event sees the write (Q3-J5-10)', () => {
  beforeEach(() => freshState({ cleared: true }));
  afterEach(() => vi.useRealTimers());

  it('today.get right after a weigh-in shows its trend', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 20, 0) });
    await seedPlan();
    const { read } = await readOnCommitted(
      () => dispatch('log.measurement', { metric: 'weightKg', value: 87.6, date: START }),
      'log.measurement',
      () => dispatch('today.get', {}),
    );
    const view = outputOf(read) as { date: string; trendWeight: { kg: number } | null };
    expect(view.date).toBe(START);
    expect(view.trendWeight?.kg).toBeCloseTo(87.6, 0);
  }, 20_000);

  it('a sealed write: pantry.get sees the added item', async () => {
    const { read } = await readOnCommitted(
      () => dispatch('pantry.add', { items: [{ label: 'okra' }] }),
      'pantry.add',
      () => dispatch('pantry.get', {}),
    );
    expect((outputOf(read) as PantryOut).items.map((i) => i.id)).toEqual(['pa.okra']);
  });

  it('a coalescing gesture: the read waits for its idle commit without ending the gesture', async () => {
    let readP: Promise<CommandResult> | null = null;
    const off = on((e) => {
      if (!readP && e.type === 'committed' && e.commandId === 'pantry.add') readP = dispatch('pantry.get', {});
    });
    const a = await dispatch('pantry.add', { items: [{ id: 'pa.okra', label: 'Okra' }], replace: true });
    // the picker's next edit, inside the coalescing window, joins the same ChangeSet: the read did not seal it
    const b = await dispatch('pantry.add', { items: [{ id: 'pa.okra', label: 'Okra' }, { id: 'pa.paneer', label: 'Paneer' }], replace: true });
    off();
    const id = (r: CommandResult) => (r.ok && 'changeSet' in r ? r.changeSet?.id : undefined);
    expect(id(a)).toBeDefined();
    expect(id(b)).toBe(id(a));
    expect(readP).not.toBeNull();
    // the read resolves once the gesture's idle commit has written both edits
    expect((outputOf(await readP!) as PantryOut).items.map((i) => i.id)).toEqual(['pa.okra', 'pa.paneer']);
    expect(changeSets().filter((c) => c.commandId === 'pantry.add')).toHaveLength(1);
    expect(changeSets()[0]!.committed).toBe(true);
  });

  it('a read with nothing pending does not wait', async () => {
    await settleCommits();
    vi.useFakeTimers();
    const r = await dispatch('pantry.get', {});
    expect(r.ok).toBe(true);
  });
});
