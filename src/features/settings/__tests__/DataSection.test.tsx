/** Settings › Your data speaks for its platform: no browser wording inside the Android and desktop apps (J2-05). */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { dispatch } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { setPlatformForTests } from '@/platform';
import { DataSection } from '../DataSection';

const ui = () =>
  render(
    <MemoryRouter>
      <DataSection />
    </MemoryRouter>,
  );

beforeEach(async () => {
  freshState();
  // an old export, so the "last export" warning shows too
  const r = await dispatch('settings.update', { patch: { lastExportAt: new Date(Date.now() - 40 * 86_400_000).toISOString() } });
  expect(r.ok).toBe(true);
});
afterEach(() => setPlatformForTests(undefined));

describe('Settings › Your data', () => {
  it.each(['android', 'electron'] as const)('in the %s app talks about this device, not a browser', (p) => {
    setPlatformForTests(p);
    const { container } = ui();
    expect(screen.getByText(/Clears plans, body profile, logs, preferences and cached readings on this device\. Server copies stay unchanged\./)).toBeInTheDocument();
    if (p === 'android') expect(screen.getByText(/Ring and Health Connect history recorded on this phone stays unchanged\./)).toBeInTheDocument();
    expect(screen.getByText(/Last export was \d+ days ago/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/browser|site data/i);
  });

  it('on the web still says this browser', () => {
    setPlatformForTests('web');
    ui();
    expect(screen.getByText('Clears plans, body profile, logs, preferences and cached readings in this browser. Server copies stay unchanged.')).toBeInTheDocument();
    expect(screen.getByText(/Browsers can clear site data/)).toBeInTheDocument();
  });
});
