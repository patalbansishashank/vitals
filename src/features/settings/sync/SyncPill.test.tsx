import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { OFF_STATUS, type SyncStatus } from '@/sync/types';
import { SyncPill } from './SyncPill';

// The pill reads the live status; replace it with a small fake that tests can change.
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
      <SyncPill />
    </MemoryRouter>,
  );
};

describe('SyncPill', () => {
  it('says Synced', () => {
    show({ state: 'synced', endpoint: 'relay.example.ts.net' });
    expect(screen.getByRole('status')).toHaveTextContent('Synced');
    expect(screen.getByRole('link', { name: /Synced/ })).toHaveAttribute('href', '/settings/sync');
  });

  it('says Syncing', () => {
    show({ state: 'syncing', pendingChanges: 2 });
    expect(screen.getByText('Syncing')).toBeInTheDocument();
  });

  it('says Offline with the number of changes and uploads waiting', () => {
    show({ state: 'offline', pendingChanges: 3 });
    expect(screen.getByText('Offline · 3 waiting')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('title', expect.stringContaining('3 changes waiting'));
  });

  it('counts uploads with changes, and says plain Offline with nothing waiting', () => {
    const { unmount } = show({ state: 'offline', pendingChanges: 3, pendingBlobs: 2 });
    expect(screen.getByText('Offline · 5 waiting')).toBeInTheDocument();
    unmount();
    show({ state: 'offline' });
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('says Error with a short reason', () => {
    const { unmount } = show({ state: 'error', lastError: { code: 'quota', message: 'The relay is full.' } as SyncStatus['lastError'] });
    expect(screen.getByText('Error · The relay is full')).toBeInTheDocument();
    unmount();
    show({ state: 'error', lastError: { code: 'x', message: 'A very long reason that goes on and on past what a pill can hold' } as SyncStatus['lastError'] });
    expect(screen.getByText(/^Error · A very long reason that goes on and on…$/)).toBeInTheDocument();
  });

  it('says the server cannot be reached when the error is a network one', () => {
    show({ state: 'error', lastError: { code: 'network', message: 'socket closed' } as SyncStatus['lastError'] });
    expect(screen.getByText("Error · can't reach the server")).toBeInTheDocument();
  });

  it('renders nothing when sync is off', () => {
    const { container } = show({ state: 'off' });
    expect(container).toBeEmptyDOMElement();
  });

  it('follows the status as it changes', () => {
    show({ state: 'synced' });
    expect(screen.getByText('Synced')).toBeInTheDocument();
    act(() => {
      fake.status = { ...OFF_STATUS, state: 'offline', pendingChanges: 1 };
      fake.listeners.forEach((l) => l());
    });
    expect(screen.getByText('Offline · 1 waiting')).toBeInTheDocument();
  });
});
