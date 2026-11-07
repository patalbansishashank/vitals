import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClipboardCheck, Inbox } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { OFF_STATUS } from '@/sync/types';
import { StatusCapsule } from '@/components/StatusCapsule';
import { TopBar } from '../shell/TopBar';

vi.mock('@/state/sync', () => ({ useSyncStatus: () => ({ ...OFF_STATUS, state: 'offline', pendingChanges: 2 }) }));

describe('the sync status icon in the shell (SUITE_SPEC §15.4, SPEC §9)', () => {
  it('sits among the header’s status icons on every screen, its state in its name, and links to Settings › Sync', async () => {
    render(
      <MemoryRouter initialEntries={['/today']}>
        <TopBar title="Today" />
      </MemoryRouter>,
    );
    // the icon is a lazy chunk: under a loaded machine its first import can take seconds
    const icon = await screen.findByRole('link', { name: /^Sync: Offline · 2 waiting/ }, { timeout: 10_000 });
    expect(icon).toHaveAttribute('href', '/settings/sync');
    expect(icon).toHaveClass('lm-status-icon');
    expect(icon).toHaveTextContent('');
    // changes wait on the person: the gold dot
    expect(icon.querySelector('.lm-status-icon__dot')).not.toBeNull();
    expect(icon.closest('.lm-ctx__caps')).not.toBeNull();
  }, 20_000);

  it('counts toward the bar’s two status icons: after the page’s own, it moves into the ⋯ first', async () => {
    render(
      <MemoryRouter initialEntries={['/today']}>
        <TopBar
          title="Today"
          status={
            <>
              <StatusCapsule icon={ClipboardCheck} label="Weekly check-in ready" attention onClick={() => {}} />
              <StatusCapsule icon={Inbox} label="2 changes waiting" attention onClick={() => {}} />
            </>
          }
        />
      </MemoryRouter>,
    );
    // the sync state is announced either way
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Sync: Offline · 2 waiting/));
    await waitFor(() => expect(document.querySelector('.lm-status-icon[href="/settings/sync"]')).toHaveAttribute('hidden'));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent(/^Sync: Offline · 2 waiting/);
  });
});
