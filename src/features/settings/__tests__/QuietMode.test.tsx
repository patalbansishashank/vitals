/** Q4-17: Settings › Appearance has the quiet-mode switch; it writes `settings.quietMode` through `settings.update`. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { seedClearedSafety, STANDARD_ANSWERS } from '@/features/onboarding/testing';
import { getDocumentStore } from '@/state/runtime';
import { useSettingsStore } from '@/state/settingsStore';
import { AppearanceSection } from '../sections';

beforeEach(() => {
  freshState();
});

describe('Settings › quiet mode', () => {
  it('the switch turns quiet mode on and off and the setting is saved', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppearanceSection />
      </MemoryRouter>,
    );
    const sw = screen.getByRole('switch', { name: 'quiet mode' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    await waitFor(() => expect(useSettingsStore.getState().quietMode).toBe(true));
    expect(screen.getByRole('switch', { name: 'quiet mode' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(getDocumentStore().peek<{ quietMode?: boolean }>('settings', 'me')?.quietMode).toBe(true));
    await user.click(screen.getByRole('switch', { name: 'quiet mode' }));
    await waitFor(() => expect(useSettingsStore.getState().quietMode).toBe(false));
  });

  const renderSection = () =>
    render(
      <MemoryRouter>
        <AppearanceSection />
      </MemoryRouter>,
    );
  const WHY = /On because your safety answers put you in gentle mode; you can turn it off\./;

  it('gentle mode (R1), never set: the switch shows on and says why; turning it off is respected', async () => {
    seedClearedSafety({ ...STANDARD_ANSWERS, eatingDisorder: 'yes' });
    const user = userEvent.setup();
    renderSection();
    const sw = screen.getByRole('switch', { name: 'quiet mode' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(WHY)).toBeInTheDocument();
    await user.click(sw);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'quiet mode' })).toHaveAttribute('aria-checked', 'false'));
    expect(useSettingsStore.getState()).toMatchObject({ quietMode: false, quietModeSet: true });
    expect(screen.queryByText(WHY)).toBeNull();
  });

  it('standard mode, never set: off, no reason line', () => {
    seedClearedSafety(STANDARD_ANSWERS);
    renderSection();
    expect(screen.getByRole('switch', { name: 'quiet mode' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(WHY)).toBeNull();
  });
});
