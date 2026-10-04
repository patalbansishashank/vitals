/**
 * Review V2 (V1c-10): `log.edit` takes an open patch. It must not mark an entry as assumed (which drops the day from
 * scoring) and must not change a field's type (a number turned into a string, a non-finite number).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '..';
import { getDocumentStore } from '@/state/runtime';
import { freshState } from './harness';

beforeEach(() => {
  freshState();
});

async function note(): Promise<string> {
  const r = await dispatch('log.note', { date: '2026-10-01', text: 'tired' });
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  await settleCommits();
  return (r.output as { entryId: string }).entryId;
}

describe('log.edit patch checks', () => {
  it('keeps a plain text edit working', async () => {
    const id = await note();
    const r = await dispatch('log.edit', { entryId: id, patch: { text: 'rested' } });
    expect(r.ok).toBe(true);
  });

  it('refuses to mark an entry as assumed', async () => {
    const id = await note();
    const r = await dispatch('log.edit', { entryId: id, patch: { assumed: true } });
    await settleCommits();
    const assumed = getDocumentStore().peekAll<{ assumed?: boolean }>('dailyLogs').filter((d) => d.assumed);
    expect(assumed).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it('refuses a patch that changes a field type', async () => {
    const id = await note();
    expect((await dispatch('log.edit', { entryId: id, patch: { text: 42 } })).ok).toBe(false);
    expect((await dispatch('log.edit', { entryId: id, patch: { date: null } })).ok).toBe(false);
  });
});

describe('log.sleep times (V1a-L9)', () => {
  it('refuses a wake at or before the bed time and a sleep longer than a day', async () => {
    expect((await dispatch('log.sleep', { bedAt: '2026-10-01T22:00:00Z', wakeAt: '2026-10-01T22:00:00Z' })).ok).toBe(false);
    expect((await dispatch('log.sleep', { bedAt: '2026-10-01T22:00:00Z', wakeAt: '2026-10-01T21:00:00Z' })).ok).toBe(false);
    expect((await dispatch('log.sleep', { bedAt: '2026-09-29T22:00:00Z', wakeAt: '2026-10-01T06:00:00Z' })).ok).toBe(false);
    expect((await dispatch('log.sleep', { bedAt: '2026-09-30T22:00:00Z', wakeAt: '2026-10-01T06:00:00Z' })).ok).toBe(true);
  });
});
