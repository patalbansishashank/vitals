import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { OFF_STATUS } from '@/sync/types';
import { MobileTopBar } from '../shell/Chrome';

vi.mock('@/state/sync', () => ({ useSyncStatus: () => ({ ...OFF_STATUS, state: 'offline', pendingChanges: 2 }) }));

describe('the sync chip in the shell (SUITE_SPEC §15.4)', () => {
  it('sits in the phone top bar and links to Settings › Sync', async () => {
    render(
      <MemoryRouter initialEntries={['/today']}>
        <MobileTopBar header={null} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Offline · 2 waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Offline/ })).toHaveAttribute('href', '/settings/sync');
  });
});
