/** A ChangeSet whose documents cannot be written rolls back (screens, boot cache, history, ledger) and says so. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryBackend } from '@/store';
import { flushAllMirrors, readMirror } from '@/state/bridge';
import { getDocumentStore, settleUnscopedWrites } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { changeSets, dispatch, on, SAVE_FAILED_NOTICE, settleCommits, type Actor, type BusEvent, type CommitFailedEvent } from '..';
import { AI, freshState } from './harness';

const SYSTEM: Actor = { kind: 'system', id: 'test' };
let backend: MemoryBackend;
let events: CommitFailedEvent[];
let off: () => void;

/** The next `n` document writes fail like a full disk. */
function failWrites(n = Infinity): void {
  const real = backend.batch!.bind(backend);
  let left = n;
  backend.batch = async (ops) => {
    if (left-- > 0) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    backend.batch = real;
    return real(ops);
  };
}

beforeEach(async () => {
  ({ backend } = freshState({ cleared: true }));
  events = [];
  off?.();
  off = on((e: BusEvent) => {
    if (e.type === 'commitFailed') events.push(e);
  });
  await dispatch('profile.patch', { weightKg: 80, heightCm: 175 }, { actor: SYSTEM });
  await settleCommits();
  await settleUnscopedWrites();
});

describe('a commit that fails', () => {
  it('puts the screen and the boot cache back, drops the change from history and tells the caller', async () => {
    const before = changeSets().length;
    failWrites(1);
    const r = await dispatch('profile.patch', { weightKg: 77 }, { actor: SYSTEM });
    expect(r).toMatchObject({ ok: false, error: { code: 'quota_exceeded', message: SAVE_FAILED_NOTICE } });
    expect(useProfileStore.getState().weightKg).toBe(80);
    flushAllMirrors();
    expect((readMirror('vitals.body')?.state as { weightKg: number }).weightKg).toBe(80);
    expect(getDocumentStore().peek<{ weightKg: number }>('profile', 'me')?.weightKg).toBe(80);
    expect(changeSets().length).toBe(before);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ commandId: 'profile.patch', rolledBack: true, notice: 'Couldn’t save that change; it was undone.' });

    // the next change saves normally
    expect((await dispatch('profile.patch', { weightKg: 78 }, { actor: SYSTEM })).ok).toBe(true);
    await settleCommits();
    expect(useProfileStore.getState().weightKg).toBe(78);
    expect(getDocumentStore().peek<{ weightKg: number }>('profile', 'me')?.weightKg).toBe(78);
  });

  it('rolls a slider drag back as one gesture', async () => {
    for (const w of [81, 82, 83, 84]) await dispatch('profile.patch', { weightKg: w });
    expect(useProfileStore.getState().weightKg).toBe(84);
    failWrites(1);
    await settleCommits();
    expect(events).toHaveLength(1);
    expect(useProfileStore.getState().weightKg).toBe(80);
    expect(changeSets().some((c) => c.id === events[0]!.changeSetId)).toBe(false);
    await dispatch('profile.patch', { weightKg: 85 });
    await settleCommits();
    expect(getDocumentStore().peek<{ weightKg: number }>('profile', 'me')?.weightKg).toBe(85);
  });

  it('keeps a later change still waiting to commit, on top of the restored values', async () => {
    failWrites(1);
    const first = dispatch('profile.patch', { heightCm: 170 }, { actor: SYSTEM }); // its commit is on the way now
    await dispatch('profile.patch', { weightKg: 81 }); // a drag starts before the failure is known
    expect((await first).ok).toBe(false);
    expect(useProfileStore.getState()).toMatchObject({ heightCm: 175, weightKg: 81 });
    await settleCommits();
    const doc = getDocumentStore().peek<{ weightKg: number; heightCm: number }>('profile', 'me');
    expect(doc).toMatchObject({ weightKg: 81, heightCm: 175 });
    expect(useProfileStore.getState()).toMatchObject({ heightCm: 175, weightKg: 81 });
  });

  it('restores a shared device document and writes nothing for documents no screen holds', async () => {
    const theme = useSettingsStore.getState().theme;
    failWrites(1);
    expect((await dispatch('settings.update', { patch: { theme: theme === 'dark' ? 'light' : 'dark' } })).ok).toBe(false);
    expect(useSettingsStore.getState().theme).toBe(theme);
    failWrites(1);
    expect((await dispatch('log.measurement', { metric: 'weightKg', value: 79.5 })).ok).toBe(false);
    expect(getDocumentStore().peekAll('measurements')).toHaveLength(0);
  });

  it('lets an agent retry with the same idempotency key', async () => {
    failWrites(1);
    const opts = { actor: AI, idempotencyKey: 'conv:call-7' };
    expect((await dispatch('log.measurement', { metric: 'weightKg', value: 79.5 }, opts)).ok).toBe(false);
    const again = await dispatch('log.measurement', { metric: 'weightKg', value: 79.5 }, { ...opts, actor: { ...AI, toolCallId: 'call-8' } });
    expect(again.ok).toBe(true);
    expect(getDocumentStore().peekAll('measurements')).toHaveLength(1);
  });

  it('reports a missing history row without undoing a saved change', async () => {
    const real = backend.batch!.bind(backend);
    let calls = 0;
    backend.batch = async (ops) => {
      // the documents land; the history row after them does not
      if (++calls === 2) throw new Error('disk error');
      return real(ops);
    };
    const r = await dispatch('profile.patch', { weightKg: 79 }, { actor: SYSTEM });
    backend.batch = real;
    expect(r.ok).toBe(true);
    expect(useProfileStore.getState().weightKg).toBe(79);
    expect(getDocumentStore().peek<{ weightKg: number }>('profile', 'me')?.weightKg).toBe(79);
    expect(events[0]).toMatchObject({ rolledBack: false });
  });
});
