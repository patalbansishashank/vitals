import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { seedClearedSafety } from '@/features/onboarding/testing';

// jsdom has no scrolling; ScrollRestoration calls it on navigation.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

// The lazy screens load the command bus and large chunks; load them once up front so cold module loading (seconds under
// a parallel run) does not eat the per-test timeouts.
beforeAll(async () => {
  await import('@/commands');
  await Promise.all([import('@/features/body/BodyPage'), import('@/features/settings/SettingsPage')]);
}, 120_000);

describe('app shell', () => {
  // First-run visitors are sent to /welcome; these tests exercise the shell for a cleared user.
  beforeEach(() => seedClearedSafety());

  it('renders the rail and tab bar navigation, the skip link and a lazy screen', async () => {
    renderAt('/body');
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs).toHaveLength(2); // desktop rail + mobile tab bar (CSS shows one)
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 20_000 })).toBeInTheDocument();
    for (const name of ['body', 'simulate', 'plan', 'evidence']) {
      expect(screen.getAllByRole('link', { name })[0]).toBeInTheDocument();
    }
    expect(screen.getAllByRole('link', { name: 'body' })[0]).toHaveAttribute('aria-current', 'page');
  }, 25_000);

  it('redirects / to a destination', async () => {
    localStorage.clear();
    const router = renderAt('/');
    await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    expect(router.state.location.pathname).toBe('/body');
  });

  it('renders the settings screen with its sections', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' }, { timeout: 5000 })).toBeInTheDocument();
    for (const name of ['Units', 'Appearance', 'Your data', 'Safety', 'About']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Export data' })).toBeInTheDocument();
  });

  it('moves focus to the new screen title after client-side navigation (lazy screens included)', async () => {
    const router = renderAt('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' }, { timeout: 10_000 });
    await router.navigate('/body');
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Your body' }, { timeout: 10_000 });
    await waitFor(() => expect(document.activeElement).toBe(h1), { timeout: 3000 });
  }, 30_000); // two lazy screens load in turn; slow when the whole suite runs on a busy machine

  it('catches a screen that throws and keeps the navigation working', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt('/dev/error');
    expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('This screen stopped working.')).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(2);
    spy.mockRestore();
  });

  it('opens the Ring and Body signals pages', async () => {
    renderAt('/ring');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ring' }, { timeout: 5000 })).toBeInTheDocument();
    renderAt('/signals');
    expect(await screen.findByRole('heading', { level: 1, name: 'Body signals' }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows the not-found screen for unknown paths', async () => {
    renderAt('/nowhere');
    expect(await screen.findByRole('heading', { name: 'Not found' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("This page doesn't exist.")).toBeInTheDocument();
  });
});
