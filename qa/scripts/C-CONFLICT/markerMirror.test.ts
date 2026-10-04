/** Isolated diagnostic for C-CONFLICT-03. Run only with markerMirror.config.ts. */
import { beforeEach, expect, it } from 'vitest';
import { projectEntries } from '@/living';
import type { MarkersView } from '@/markers/types';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore } from '@/state/runtime';
import { bodyOf, mintWriteToken, revokeWriteToken } from '@/store';

beforeEach(() => freshState({ cleared: true }));

function output<T>(result: CommandResult): T {
  if (!result.ok || !('output' in result)) throw new Error('Command did not return an output');
  return result.output as T;
}

function projectedHistory() {
  return projectEntries(getDocumentStore().peekAll('measurements').map((doc) => {
    const entry = bodyOf(doc) as { at?: string; kind?: string; target?: string; supersedes?: string; metric: string; value: number };
    return { ...entry, id: doc._id };
  })).filter((entry) => entry.metric === 'lab:ldl');
}

it('keeps marker document value after choosing the other measurement-history version', async () => {
  expect((await dispatch('markers.set', { readings: [{ id: 'ldl', value: 4.2, unit: 'mmol/L', date: '2026-09-12' }] })).ok).toBe(true);
  await settleCommits();
  const parentId = getDocumentStore().peekAll('measurements')[0]!._id;

  expect((await dispatch('markers.set', { readings: [{ id: 'ldl', value: 4.0, unit: 'mmol/L', date: '2026-09-12' }] })).ok).toBe(true);
  await settleCommits();
  const documentVersionId = getDocumentStore().peekAll<{ supersedes?: string }>('measurements').find((doc) => doc.supersedes === parentId)!._id;

  const otherVersionId = '01J0000000000000000000000C';
  const token = mintWriteToken('command', { label: 'marker-mirror-diagnostic' });
  try {
    await getDocumentStore().transact(token, (tx) => tx.append('measurements', {
      _id: otherVersionId, date: '2026-09-12', metric: 'lab:ldl', value: 3.9,
      at: '2026-09-12T12:00:00.000Z', source: { by: 'user', method: 'typed' }, supersedes: parentId,
    }));
  } finally {
    revokeWriteToken(token);
  }
  expect(projectedHistory()).toHaveLength(1);
  expect(projectedHistory()[0]!.conflict?.versions).toHaveLength(2);

  expect((await dispatch('log.retract', { entryId: documentVersionId, keepEntryId: otherVersionId })).ok).toBe(true);
  await settleCommits();
  expect(projectedHistory()).toMatchObject([{ value: 3.9 }]);
  expect(projectedHistory()[0]!.conflict).toBeUndefined();

  const marker = output<MarkersView>(await dispatch('markers.get', {})).current.find((state) => state.markerId === 'ldl')!;
  expect(marker.reading.valueCanonical).toBe(4.0);
  expect(marker.reading.valueCanonical).not.toBe(projectedHistory()[0]!.value);
});
