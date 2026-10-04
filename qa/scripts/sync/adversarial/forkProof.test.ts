/** Independent diagnostic for SUITE_SPEC §2.5: retain offline edit forks until a person resolves them. */
import { describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore } from '@/state/runtime';
import { seedPlanDocs } from '@/features/living/__tests__/seedPlanDocs';
import { createDocumentLivingSource } from '@/features/living/data/documents';
import { effectiveEntries, addDays, type LogEntry } from '@/living';
import { currentDay, systemClock } from '@/features/living/clock';

function output<T>(result: unknown): T {
  expect(result).toMatchObject({ ok: true });
  if (!result || typeof result !== 'object' || !('output' in result))
    throw new Error('Command output missing');
  return result.output as T;
}

describe('Independent append-only fork contract verification', () => {
  it('retains both CommandBus successors, projects one conflict, and retract resolves', async () => {
    const date = currentDay(systemClock);
    const { backend: a } = freshState({ cleared: true });
    await seedPlanDocs({ startDate: addDays(date, -1), days: 3 });
    const original = output<{ entryId: string }>(
      await dispatch('log.note', { date, text: 'C-SYNCX original' }),
    ).entryId;
    await settleCommits();
    const cols = ['plans', 'planVersions', 'activePlan', 'dailyLogs'];
    const baseline = (await Promise.all(cols.map((col) => a.list(col)))).flat();
    const aEdit = output<{ entryId: string }>(
      await dispatch('log.edit', { entryId: original, patch: { text: 'C-SYNCX A edit' } }),
    ).entryId;
    await settleCommits();
    const aRows = await a.list<Omit<LogEntry, 'id'>>('dailyLogs');

    // B has the baseline only when it edits: neither real command can see the other's successor.
    const { backend: b } = freshState({ cleared: true });
    await getDocumentStore().ready;
    for (const row of baseline) b.remote(row);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bEdit = output<{ entryId: string }>(
      await dispatch('log.edit', { entryId: original, patch: { text: 'C-SYNCX B edit' } }),
    ).entryId;
    await settleCommits();
    for (const row of aRows) b.remote(row);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = await b.list<Omit<LogEntry, 'id'>>('dailyLogs');
    expect(raw).toHaveLength(3);
    const effective = effectiveEntries(raw.map((row) => ({ ...row.value, id: row._id })));
    expect(effective.map((entry) => entry.id).sort()).toEqual([aEdit, bEdit].sort());
    const visible = output<Array<LogEntry & { conflict?: { parentId: string; versions: LogEntry[] } }>>(await dispatch('log.get', { from: date, to: date }));
    expect(visible).toHaveLength(1);
    expect(visible[0]?.conflict?.parentId).toBe(original);
    expect(visible[0]?.conflict?.versions.map((entry) => entry.id).sort()).toEqual([aEdit, bEdit].sort());

    const source = createDocumentLivingSource();
    const history = source.history(date, date);
    expect(history).toHaveLength(1);
    expect(history[0]!.entries).toHaveLength(1);
    expect(history[0]!.conflicts?.[0]?.versions.map((entry) => entry.id).sort()).toEqual([aEdit, bEdit].sort());

    output<{ entryId: string }>(await dispatch('log.retract', { entryId: aEdit }));
    await settleCommits();
    const resolved = output<LogEntry[]>(await dispatch('log.get', { from: date, to: date }));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe(bEdit);
    expect(source.history(date, date)[0]?.conflicts).toHaveLength(0);
  }, 30000);
});
