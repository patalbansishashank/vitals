import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { OFF_STATUS, type SyncStatus } from '@/sync/types';
import { SyncPillView, SyncStatusIcon } from './SyncPill';

// The header icon reads the live status; replace it with a small fake that tests can change.
const fake = vi.hoisted(() => ({ status: null as unknown, listeners: new Set<() => void>() }));
vi.mock('@/state/sync', async () => {
  const react = await import('react');
  return {
    useSyncStatus: () => react.useSyncExternalStore((l: () => void) => (fake.listeners.add(l), () => void fake.listeners.delete(l)), () => fake.status),
  };
});

const show = (s: Partial<SyncStatus>) => {
  fake.status = { ...OFF_STATUS, ...s };
  return render(
    <MemoryRouter>
      <SyncStatusIcon />
    </MemoryRouter>,
  );
};
const icon = () => screen.getByRole('link');

describe('SyncStatusIcon (the header’s sync status, SPEC §9)', () => {
  it('Synced: a quiet icon that opens Settings › Sync, its state in its name', () => {
    show({ state: 'synced', endpoint: 'relay.example.ts.net' });
    expect(icon()).toHaveAccessibleName('Sync: Synced');
    expect(icon()).toHaveAttribute('href', '/settings/sync');
    expect(icon()).toHaveTextContent('');
    expect(icon().querySelector('.lm-status-icon__dot')).toBeNull();
  });

  it('Syncing: the dot breathes', () => {
    show({ state: 'syncing', pendingChanges: 2 });
    expect(icon()).toHaveAccessibleName('Sync: Syncing');
    expect(icon().querySelector('.lm-status-icon__dot')).toHaveAttribute('data-pulse', 'true');
  });

  it('Offline: the number of changes and uploads waiting, with the gold dot while anything waits', () => {
    const { unmount } = show({ state: 'offline', pendingChanges: 3, pendingBlobs: 2 });
    expect(icon()).toHaveAccessibleName('Sync: Offline · 5 waiting');
    expect(icon().querySelector('.lm-status-icon__dot')).not.toBeNull();
    unmount();
    show({ state: 'offline' });
    expect(icon()).toHaveAccessibleName('Sync: Offline');
    expect(icon().querySelector('.lm-status-icon__dot')).toBeNull();
  });

  it('Error: the reason in its sentence, with a rose dot', () => {
    const { unmount } = show({ state: 'error', lastError: { code: 'quota', message: 'The relay is full.' } as SyncStatus['lastError'] });
    expect(icon()).toHaveAccessibleName('Sync stopped: The relay is full.');
    expect(icon()).toHaveAttribute('data-tone', 'danger');
    unmount();
    show({ state: 'error', lastError: { code: 'network', message: 'socket closed' }, pendingChanges: 2 } as Partial<SyncStatus>);
    expect(icon()).toHaveAccessibleName(/^Can't reach your sync server\..*2 changes waiting/);
  });

  it('renders nothing while sync is off', () => {
    show({ state: 'off' });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('follows the status as it changes, and announces it', () => {
    show({ state: 'synced' });
    expect(screen.getByRole('status')).toHaveTextContent('Sync: Synced');
    act(() => {
      fake.status = { ...OFF_STATUS, state: 'offline', pendingChanges: 1 };
      fake.listeners.forEach((l) => l());
    });
    expect(icon()).toHaveAccessibleName(/^Sync: Offline · 1 waiting/);
    expect(screen.getByRole('status')).toHaveTextContent(/^Sync: Offline · 1 waiting/);
  });
});

describe('SyncPillView (the words, where a page already holds the status)', () => {
  const view = (s: Partial<SyncStatus>) =>
    render(
      <MemoryRouter>
        <SyncPillView status={{ ...OFF_STATUS, ...s }} />
      </MemoryRouter>,
    );

  it('says the state in a few words and links to Settings › Sync', () => {
    view({ state: 'offline', pendingChanges: 3 });
    expect(screen.getByText('Offline · 3 waiting')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/sync');
    expect(screen.getByRole('link')).toHaveAttribute('title', expect.stringContaining('3 changes waiting'));
  });

  it('cuts a long reason and renders nothing while sync is off', () => {
    const { unmount } = view({ state: 'error', lastError: { code: 'x', message: 'A very long reason that goes on and on past what a pill can hold' } as SyncStatus['lastError'] });
    expect(screen.getByText(/^Error · A very long reason that goes on and on…$/)).toBeInTheDocument();
    unmount();
    const { container } = view({ state: 'off' });
    expect(container).toBeEmptyDOMElement();
  });
});
