/** Two disconnected CommandBus writers may edit one append-only log record. */
import { describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '..';
import { freshState } from './harness';
import { getDocumentStore } from '@/state/runtime';
import { seedPlanDocs } from '@/features/living/__tests__/seedPlanDocs';
import { createDocumentLivingSource } from '@/features/living/data/documents';
import { addDays, effectiveEntries, type LogEntry } from '@/living';
import { currentDay, systemClock } from '@/features/living/clock';

type Projected = LogEntry & { conflict?: { parentId: string; versions: LogEntry[] } };

function output<T>(result: unknown): T {
  expect(result).toMatchObject({ ok: true });
  if (!result || typeof result !== 'object' || !('output' in result)) throw new Error('Command output missing');
  return result.output as T;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('concurrent log edits', () => {
  it('keeps both meal edits in storage, shows one conflicted meal in each read, then resolves and undoes', async () => {
    const date = currentDay(systemClock);
    const { backend: a } = freshState({ cleared: true });
    await seedPlanDocs({ startDate: addDays(date, -1), days: 3 });
    const original = output<{ entryId: string }>(await dispatch('log.meal', {
      date, slot: 'meal2', method: 'label', clockH: 12,
      components: [{ name: 'synthetic lunch', grams: 100, labelPer100g: { energyKcal: 420, proteinG: 21, carbG: 48, fatG: 13, fibreG: 5 } }],
    })).entryId;
    await settleCommits();
    const baseline = (await Promise.all(['plans', 'planVersions', 'activePlan', 'dailyLogs'].map((col) => a.list(col)))).flat();
    const aEdit = output<{ entryId: string }>(await dispatch('log.edit', { entryId: original, patch: { clockH: 13 } })).entryId;
    await settleCommits();
    const aRows = await a.list<Omit<LogEntry, 'id'>>('dailyLogs');

    const { backend: b } = freshState({ cleared: true });
    await getDocumentStore().ready;
    for (const row of baseline) b.remote(row);
    await pause();
    const bEdit = output<{ entryId: string }>(await dispatch('log.edit', { entryId: original, patch: { clockH: 14 } })).entryId;
    await settleCommits();
    for (const row of aRows) b.remote(row);
    await pause();

    const raw = await b.list<Omit<LogEntry, 'id'>>('dailyLogs');
    expect(raw).toHaveLength(3);
    expect(effectiveEntries(raw.map((row) => ({ ...row.value, id: row._id }))).map((row) => row.id).sort()).toEqual([aEdit, bEdit].sort());
    const log = output<Projected[]>(await dispatch('log.get', { from: date, to: date }));
    expect(log).toHaveLength(1);
    expect(log[0]?.conflict?.parentId).toBe(original);
    expect(log[0]?.conflict?.versions.map((version) => version.id).sort()).toEqual([aEdit, bEdit].sort());
    const day = output<{ entries: Projected[] }>(await dispatch('day.get', { date }));
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]?.conflict?.versions).toHaveLength(2);
    const today = output<{ logged: { entries: Array<{ id: string; conflict?: unknown }>; totals: { energyKcal: { value: number } } } }>(await dispatch('today.get', { date }));
    expect(today.logged.entries).toHaveLength(1);
    expect(today.logged.entries[0]?.conflict).toBeTruthy();
    expect(today.logged.totals.energyKcal.value).toBe(420);
    const history = createDocumentLivingSource().history(date, date);
    expect(history[0]?.entries).toHaveLength(1);
    expect(history[0]?.conflicts?.[0]?.versions.map((version) => version.id).sort()).toEqual([aEdit, bEdit].sort());
    const staleChoice = await dispatch('log.retract', { entryId: aEdit, keepEntryId: original });
    expect(staleChoice.ok).toBe(false);
    expect((await b.list('dailyLogs'))).toHaveLength(3);

    const remove = await dispatch('log.retract', { entryId: aEdit, keepEntryId: bEdit });
    const removalId = output<{ entryId: string }>(remove).entryId;
    await settleCommits();
    const resolved = output<Projected[]>(await dispatch('log.get', { from: date, to: date }));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe(bEdit);
    expect(resolved[0]?.conflict).toBeUndefined();
    // the choice names the version kept, so an opposite choice on another device cancels it (L-REV2 R3-02)
    expect(getDocumentStore().peek<{ target?: string; keep?: string }>('dailyLogs', removalId)).toMatchObject({ target: aEdit, keep: bEdit });
    expect(output<{ logged: { totals: { energyKcal: { value: number } } } }>(await dispatch('today.get', { date })).logged.totals.energyKcal.value).toBe(420);
    expect(createDocumentLivingSource().history(date, date)[0]?.conflicts).toHaveLength(0);
    for (const row of await b.list('dailyLogs')) a.remote(row);
    await pause();
    const secondReplica = effectiveEntries((await a.list<Omit<LogEntry, 'id'>>('dailyLogs')).map((row) => ({ ...row.value, id: row._id })));
    expect(secondReplica).toHaveLength(1);
    expect(secondReplica[0]?.id).toBe(bEdit);

    output<{ entryId: string }>(await dispatch('log.retract', { entryId: removalId }));
    await settleCommits();
    const restored = output<Projected[]>(await dispatch('log.get', { from: date, to: date }));
    expect(restored).toHaveLength(1);
    expect(restored[0]?.conflict?.versions).toHaveLength(2);
    expect(restored[0]?.conflict?.versions.some((version) => version.id === bEdit)).toBe(true);
    const restoredCopy = restored[0]?.conflict?.versions.find((version) => version.id !== bEdit);
    expect(restoredCopy?.id).not.toBe(aEdit);
    expect(restoredCopy && 'clockH' in restoredCopy && restoredCopy.clockH).toBe(13);

    const secondRemoval = await dispatch('log.retract', { entryId: restoredCopy!.id, keepEntryId: bEdit });
    output<{ entryId: string }>(secondRemoval);
    await settleCommits();
    const changeSetId = secondRemoval.ok && 'changeSet' in secondRemoval ? secondRemoval.changeSet?.id : null;
    expect(changeSetId).toBeTruthy();
    output<{ undone: boolean }>(await dispatch('history.undo', { changeSetId }));
    await settleCommits();
    expect(output<Projected[]>(await dispatch('log.get', { from: date, to: date }))[0]?.conflict?.versions).toHaveLength(2);
  }, 30000);

  it('groups a date-changing fork once across the requested range', async () => {
    const date = currentDay(systemClock);
    const prior = addDays(date, -1);
    const { backend: a } = freshState({ cleared: true });
    const original = output<{ entryId: string }>(await dispatch('log.note', { date, text: 'synthetic note' })).entryId;
    await settleCommits();
    const baseline = await a.list('dailyLogs');
    const aEdit = output<{ entryId: string }>(await dispatch('log.edit', { entryId: original, patch: { date: prior } })).entryId;
    await settleCommits();
    const aRows = await a.list('dailyLogs');
    const { backend: b } = freshState({ cleared: true });
    await getDocumentStore().ready;
    for (const row of baseline) b.remote(row);
    await pause();
    const bEdit = output<{ entryId: string }>(await dispatch('log.edit', { entryId: original, patch: { text: 'other edit' } })).entryId;
    await settleCommits();
    for (const row of aRows) b.remote(row);
    await pause();
    const projected = output<Projected[]>(await dispatch('log.get', { from: prior, to: date }));
    expect(projected).toHaveLength(1);
    expect(projected[0]?.conflict?.versions.map((version) => version.id).sort()).toEqual([aEdit, bEdit].sort());
  }, 30000);
});
