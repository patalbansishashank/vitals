import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { setPlatformForTests } from '@/platform';
import { getDocumentStore } from '@/state/runtime';
import { useSettingsStore } from '@/state/settingsStore';
import SettingsPage from '../SettingsPage';

beforeEach(() => {
  freshState();
  setPlatformForTests('android');
});
afterEach(() => setPlatformForTests(undefined));

it('registers Widgets on Android and persists weight opt-in on this device only', async () => {
  render(
    <MemoryRouter initialEntries={['/settings/widgets']}>
      <Routes>
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Widgets' })).toBeInTheDocument();
  const toggle = screen.getByRole('switch', { name: 'Show weight on the home screen' });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(toggle);
  await waitFor(() => expect(useSettingsStore.getState().widgetWeight).toBe(true));
  const stored = await getDocumentStore().get<Record<string, unknown>>('deviceSettings', 'me');
  const synced = await getDocumentStore().get<Record<string, unknown>>('settings', 'me');
  expect(stored?.widgetWeight).toBe(true);
  expect(synced?.widgetWeight).toBeUndefined();
  await act(async () => {
    fireEvent.click(toggle);
  });
  await waitFor(() => expect(useSettingsStore.getState().widgetWeight).toBe(false));
  expect((await getDocumentStore().get<Record<string, unknown>>('deviceSettings', 'me'))?.widgetWeight).toBe(
    false,
  );
});
