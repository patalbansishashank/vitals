/**
 * A1-027 (D6-05/C3) — "same as yesterday" / recents through the real Living action → `log.meal`: the repeat clones the
 * frozen serving snapshot (per-100 g composition, source id and version), so a custom food or recipe edited or removed since
 * never changes the old serving; the repeat is a new event; the original stays exactly as it was.
 */
import { freshState } from '@/commands/__tests__/harness';
import { dispatch, settleCommits } from '@/commands';
import { seedCustomFoods } from '@/commands/food/__tests__/seed';
import { getDocumentStore } from '@/state/runtime';
import { bodyOf } from '@/store';
import { addDays, type LogEntry } from '@/living';
import { currentDay, systemClock } from '../../clock';
import { createCommandLivingActions } from '../commands';
import { createDocumentLivingSource } from '../documents';

type Meal = Extract<LogEntry, { kind: 'meal' }>;
const meals = (): Meal[] => getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id })).filter((e): e is Meal => e.kind === 'meal');
const food = (docId: string, per100g: Record<string, number>) => ({
  _id: docId,
  kind: 'food',
  key: 'user-rice',
  item: { id: 'user-rice', name: 'house rice', aliases: [], group: 'other', tags: [], source: 'user', verified: false, state: 'as-eaten', portions: [], sources: ['user'], per100g, carbBasis: 'totalByDifference' },
});

describe('A1-027: repeating a stored meal clones its frozen serving', () => {
  it('a custom food changed or removed since leaves the repeated serving equal to the original', async () => {
    freshState({ cleared: true });
    const today = currentDay(systemClock);
    const yesterday = addDays(today, -1);
    await seedCustomFoods([food('01JFD0000000000000000000RC', { energyKcal: 130, proteinG: 2.7, fatG: 0.3, carbG: 28.6, fibreG: 0.4 })]);
    const r = await dispatch('log.meal', { method: 'typed', date: yesterday, clockH: 13, components: [{ name: 'house rice', foodId: 'user-rice', grams: 200 }] });
    if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
    await settleCommits();
    const original = meals()[0]!;
    const before = JSON.stringify(original);
    expect(original.totals.energyKcal.value).toBeCloseTo(260, 6);
    // the person edits the same food: now 200 g would be ghee-like energy
    await seedCustomFoods([food('01JFD0000000000000000000RC', { energyKcal: 876, proteinG: 0, fatG: 99, carbG: 0, fibreG: 0 })]);
    const actions = createCommandLivingActions(createDocumentLivingSource());
    expect((await actions.logMeal(today, { clockH: 13, components: [], relog: { date: yesterday, entryIds: [original.id] } })).ok).toBe(true);
    await settleCommits();
    const repeat = meals().find((m) => m.date === today)!;
    expect(repeat.id).not.toBe(original.id);
    expect(repeat.totals.energyKcal.value).toBeCloseTo(260, 6);
    expect(repeat.totals.carbG.value).toBeCloseTo(original.totals.carbG.value, 9);
    expect(repeat.components[0]!.snapshot).toEqual(original.components[0]!.snapshot);
    // the original entry is byte-for-byte unchanged
    expect(JSON.stringify(meals().find((m) => m.id === original.id))).toBe(before);
    // with the food removed altogether, the repeat still reproduces the frozen serving
    await getDocumentStore().ready;
    const { mintWriteToken } = await import('@/store');
    await getDocumentStore().transact(mintWriteToken('migration', { label: 'remove food' }), async (tx) => {
      await tx.remove('catalogueCustom', '01JFD0000000000000000000RC');
    });
    expect((await actions.logMeal(today, { clockH: 20, components: [], relog: { date: yesterday, entryIds: [original.id] } })).ok).toBe(true);
    await settleCommits();
    const again = meals().filter((m) => m.date === today).find((m) => m.id !== repeat.id)!;
    expect(again.totals.energyKcal.value).toBeCloseTo(260, 6);
  });
});
