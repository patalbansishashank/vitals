/**
 * Review V1c-13: two open ChangeSets on one document must reach the store in the order they were made. A gesture
 * still coalescing (older) must not land after a later sealed write of the same document and overwrite it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '..';
import { getDocumentStore } from '@/state/runtime';
import { AI, freshState } from './harness';

beforeEach(() => freshState({ cleared: true }));

describe('commit order on one document (V1c-13)', () => {
  it('a later sealed write of a document is not overwritten by an earlier gesture still coalescing', async () => {
    const a = await dispatch('settings.update', { patch: { theme: 'dark' } }, { coalesceKey: 'drag' });
    expect(a.ok).toBe(true);
    const b = await dispatch('settings.update', { patch: { theme: 'light' } }, { actor: AI });
    expect(b.ok).toBe(true);
    await settleCommits();
    expect((getDocumentStore().peek('deviceSettings', 'me') as { theme?: string } | null)?.theme).toBe('light');
  });
});
