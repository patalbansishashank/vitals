/** A change the device cannot save is undone on screen, and the person is told in plain words. */
import { render, screen } from '@testing-library/react';
import { Toaster } from '@/components';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { settleUnscopedWrites } from '@/state/runtime';
import { startSaveFailureNotices } from '../saveNotice';

describe('save failure notice', () => {
  it('shows "Couldn’t save that change; it was undone." when a write is rolled back', async () => {
    const { backend } = freshState({ cleared: true });
    await dispatch('profile.patch', { weightKg: 80 }, { actor: { kind: 'system', id: 't' } });
    await settleCommits();
    await settleUnscopedWrites();
    render(<Toaster />);
    const stop = startSaveFailureNotices();
    await new Promise((r) => setTimeout(r, 50)); // the notices load the bus lazily (it is already loaded here)
    const real = backend.batch!.bind(backend);
    backend.batch = async () => {
      backend.batch = real;
      throw new Error('IndexedDB: the write failed');
    };
    const r = await dispatch('profile.patch', { weightKg: 70 }, { actor: { kind: 'system', id: 't' } });
    expect(r.ok).toBe(false);
    expect(useProfileStore.getState().weightKg).toBe(80);
    expect(await screen.findByText('Couldn’t save that change; it was undone.')).toBeInTheDocument();
    stop();
  });

  it('ignores failures that kept the change (only the history row was lost)', () => {
    const toast = vi.fn(() => 'id');
    let emit: (e: never) => void = () => undefined;
    const stop = startSaveFailureNotices(toast, (l) => ((emit = l as never), () => undefined));
    emit({ type: 'commitFailed', commandId: 'profile.patch', error: 'x', changeSetId: 'c', label: 'l', rolledBack: false, skipped: [] } as never);
    expect(toast).not.toHaveBeenCalled();
    emit({ type: 'commitFailed', commandId: 'profile.patch', error: 'x', changeSetId: 'c', label: 'l', rolledBack: true, notice: 'Couldn’t save that change; it was undone.', skipped: [] } as never);
    expect(toast).toHaveBeenCalledWith('Couldn’t save that change; it was undone.', { id: 'save-failed', duration: 8000 });
    stop();
  });
});
