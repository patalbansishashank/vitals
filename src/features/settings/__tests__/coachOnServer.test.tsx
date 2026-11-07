/**
 * While this device is paired with the server, the Coach runs there: Settings shows one "Coach · On your server" row
 * with its status and retention, and no provider, model or key settings. Unpaired, Settings › Coach is back.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { act } from 'react';
import { freshState } from '@/commands/__tests__/harness';
import { setServerClientForTests } from '@/net/server';
import { coachClientOn, fakeCoachServer } from '@/net/__tests__/fakeCoachServer';
import { privacyText } from '../copy';
import SettingsPage from '../SettingsPage';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  freshState();
});
afterEach(() => setServerClientForTests(null));

function pair(overrides: Parameters<typeof fakeCoachServer>[0] = {}) {
  const server = fakeCoachServer(overrides);
  const { client } = coachClientOn(server);
  setServerClientForTests(client);
  return { server, client };
}

describe('Settings › Coach while paired with the server', () => {
  it('unpaired: the provider settings, unchanged (the section is "Coach" either way)', () => {
    setServerClientForTests(coachClientOn(fakeCoachServer(), { paired: false }).client);
    at('/settings/coach');
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Custom endpoint/ })).toBeInTheDocument();
    expect(screen.queryByText('On your server')).toBeNull();
  });

  it('paired: one row with where it runs, the status and the retention; no provider, model or key', async () => {
    pair();
    at('/settings/coach');
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByText('On your server')).toBeInTheDocument();
    expect(await screen.findByText('Available · chats are deleted after 24 h')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
    expect(screen.queryByText(/model/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /check connection|test connection|save/i })).toBeNull();
  });

  it('paired, the Coach off on the server: its reason instead', async () => {
    pair({ status: { available: false, backend: 'claude', retentionHours: 12, reason: 'The server’s AI is not signed in' } });
    at('/settings/coach');
    expect(await screen.findByText('The server’s AI is not signed in · chats are deleted after 12 h')).toBeInTheDocument();
  });

  it('the index row says Coach · On your server while paired, Coach · Off once forgotten', async () => {
    const { client } = pair();
    at('/settings');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: /^Coach\s*On your server/ })).toHaveAttribute('href', '/settings/coach');
    expect(within(nav).queryByRole('link', { name: /^Coach\s*Off/ })).toBeNull();
    act(() => client.forget());
    expect(within(nav).getByRole('link', { name: /^Coach\s*Off/ })).toBeInTheDocument();
  });

  it('forgetting the server brings the provider settings back on the same page', async () => {
    const { client } = pair();
    at('/settings/coach');
    expect(await screen.findByText(/Available/)).toBeInTheDocument();
    act(() => client.forget());
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Custom endpoint/ })).toBeInTheDocument();
  });

  it('the privacy line names the server, not a chosen AI provider, while paired', () => {
    expect(privacyText(false, true)).toBe('No accounts, no analytics, no cookies. Data is saved on this device. The Coach runs on your server.');
    expect(privacyText(true, true)).toMatch(/readable copy\. The Coach runs on your server\.$/);
    expect(privacyText(false, false)).toMatch(/AI provider you choose/);
  });
});
