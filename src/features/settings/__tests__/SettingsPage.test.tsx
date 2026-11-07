/** Settings is an index of groups; each section is its own pushed page, and the older deep links still land on it. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { Toaster } from '@/components';
import { useSettingsStore } from '@/state/settingsStore';
import SettingsPage from '../SettingsPage';

beforeEach(() => {
  freshState();
});

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );

describe('Settings index', () => {
  it('lists the sections in labelled groups, each a link to its own page', () => {
    at('/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    // r068 S17: grouped by what a section is about
    for (const group of ['General', 'Body and activity', 'Food', 'Data', 'Coach and agents', 'App'])
      expect(within(nav).getByRole('heading', { name: group })).toBeInTheDocument();
    const href = (name: RegExp) => within(nav).getByRole('link', { name }).getAttribute('href');
    expect(href(/^Units/)).toBe('/settings/units');
    expect(href(/^Kitchen/)).toBe('/settings/kitchen');
    expect(href(/^Your data/)).toBe('/settings/data');
    expect(href(/^Sync/)).toBe('/settings/sync');
    expect(href(/^Coach/)).toBe('/settings/coach');
    // r068 S20: the step rules are a section of their own, beside Heart rate
    expect(href(/^Steps/)).toBe('/settings/steps');
    expect(href(/^About/)).toBe('/settings/about');
    // one Sync row: the server's pairing is part of it
    expect(within(nav).queryByRole('link', { name: /^Server/ })).toBeNull();
  });

  it('shows each section’s current value on its row', () => {
    at('/settings');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: /^Units\s*Metric · kcal/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /^Sync\s*Not paired/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /^Coach\s*Off/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /^Your data\s*Not exported/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /^Steps\s*Ring first/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /^Heart rate\s*From your age/ })).toBeInTheDocument();
  });
});

describe('Settings section pages', () => {
  it('a section is a pushed page: its name in the header, Back to Settings, and only that section', () => {
    at('/settings/data');
    expect(screen.getByRole('heading', { level: 1, name: 'Your data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Settings' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your data' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Units' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
  });

  it.each([
    ['/settings#data', 'Your data'],
    ['/settings/server', 'Sync'],
    ['/settings?section=server', 'Sync'],
    ['/settings/ai', 'Coach'],
  ])('the older link %s opens %s', (path, title) => {
    at(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
  });

  it('an unknown section shows the index', () => {
    at('/settings/devices');
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
  });

  it('Sync holds the server pairing and the other ways to join, once; storage explains privacy in Your data', async () => {
    at('/settings/sync');
    const page = screen.getByRole('region', { name: 'Sync' });
    expect(within(page).getByRole('button', { name: 'Enter code' })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: 'Scan QR' })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: 'Other ways to join' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // r068 S23: where the data lives is said once, under Your data
    expect(within(page).queryByText(/No accounts, no analytics, no cookies/)).toBeNull();
    cleanup();
    at('/settings/data');
    await userEvent.click(screen.getByRole('button', { name: 'About Storage' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Where your data lives' })).getAllByText(
        /No accounts, no analytics, no cookies/,
      ),
    ).toHaveLength(1);
  });

  it('Appearance has no theme switch (dark only); reduce motion stays', () => {
    at('/settings/appearance');
    expect(screen.queryByText(/theme/i)).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Reduce motion' })).toBeInTheDocument();
  });

  it('says Saved in the header after a change that went through', async () => {
    const user = userEvent.setup();
    at('/settings/units');
    await user.click(screen.getByRole('radio', { name: 'Imperial' }));
    await waitFor(() => expect(useSettingsStore.getState().units).toBe('imperial'));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('About: version and the licences; Safety & limits once, under Safety; no internal rows', async () => {
    const user = userEvent.setup();
    at('/settings/about');
    expect(screen.getByRole('img', { name: /^Vitals \d/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Model evidence report/ })).toHaveAttribute(
      'href',
      '/evidence/validation',
    );
    expect(screen.queryByRole('link', { name: /Safety & limits/ })).toBeNull();
    expect(screen.queryByText(/evidence topics|Evidence library|Disclaimer/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Licences' }));
    expect(screen.getByText('Geist')).toBeInTheDocument();
    expect(screen.getByText('Geist Mono')).toBeInTheDocument();
    expect(screen.queryByText('Archivo')).toBeNull();
    expect(screen.queryByText('Inter')).toBeNull();
    expect(screen.queryByText('Figtree')).toBeNull();
  });
});

// r068 S16: from 1024 px Settings is master/detail: the index beside the open section, no Back
describe('Settings on desktop', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) =>
      ({
        matches: /min-width:\s*(48|64)rem/.test(query),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it('/settings opens the first section beside the index, which marks it; no Back', () => {
    at('/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: /^Units/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'Units' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Units' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back/ })).toBeNull();
  });

  it('a section link keeps the index and swaps the detail', () => {
    at('/settings/data');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: /^Your data/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /^Units/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('region', { name: 'Your data' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Units' })).toBeNull();
  });
});
