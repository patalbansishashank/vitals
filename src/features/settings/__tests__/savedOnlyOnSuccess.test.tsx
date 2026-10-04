/** Settings says "saved" only when the change went through; a refusal shows its reason instead. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Toaster } from '@/components/Toast';
import { freshState } from '@/commands/__tests__/harness';
import type { CommandResult } from '@/commands/types';
import { useSettingsStore } from '@/state/settingsStore';
import { UnitsSection } from '../sections';
import type * as Bus from '@/commands/bus';

const refuse = vi.hoisted(() => ({ on: false }));
vi.mock('@/commands/bus', async (orig) => {
  const real = await orig<typeof Bus>();
  return {
    ...real,
    dispatch: (id: string, input: unknown, opts?: unknown) =>
      refuse.on && id === 'settings.update'
        ? Promise.resolve<CommandResult>({ ok: false, error: { code: 'precondition_failed', message: 'Settings are read-only while syncing.' } })
        : (real.dispatch as (i: string, x: unknown, o?: unknown) => Promise<CommandResult>)(id, input, opts),
  };
});

beforeEach(() => {
  freshState();
  refuse.on = false;
});

const renderUnits = () =>
  render(
    <MemoryRouter>
      <UnitsSection />
      <Toaster />
    </MemoryRouter>,
  );

describe('Settings › saved', () => {
  it('says saved after a change that went through', async () => {
    const user = userEvent.setup();
    renderUnits();
    await user.click(screen.getByRole('radio', { name: 'imperial' }));
    await waitFor(() => expect(useSettingsStore.getState().units).toBe('imperial'));
    expect(await screen.findByText('saved')).toBeInTheDocument();
  });

  it('does not say saved when the change is refused, and shows the reason', async () => {
    refuse.on = true;
    const user = userEvent.setup();
    renderUnits();
    await user.click(screen.getByRole('radio', { name: 'imperial' }));
    expect(await screen.findByText('Settings are read-only while syncing.')).toBeInTheDocument();
    expect(screen.queryByText('saved')).toBeNull();
    expect(useSettingsStore.getState().units).not.toBe('imperial');
  });
});
