/**
 * Your body in Living mode (a plan running, no planning override): the navigation holds Today … Progress, not Simulate
 * and Plan, so the header carries the way on — "Find plans" as its one primary pill and "Simulate a plan" in its ⋯ —
 * and still no bar above the navigation. Only Your body's own read of the navigation is stubbed.
 */
import { act, configure, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { LIVING_DESTINATIONS, type useShellNav } from '@/app/shell';
import type * as Shell from '@/app/shell';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { flushBodyPersistence, useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';

vi.mock('@/app/shell', async (importOriginal) => {
  const actual = await importOriginal<typeof Shell>();
  const living: ReturnType<typeof useShellNav> = { mode: 'living', override: false, plan: null, primary: actual.LIVING_DESTINATIONS, groups: [], more: [] };
  return { ...actual, useShellNav: () => living };
});

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });
window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

beforeEach(() => {
  localStorage.clear();
  act(() => useSettingsStore.getState().set({ units: 'metric', showFigure: true }));
  seedClearedSafety();
  act(() => {
    const s = useProfileStore.getState();
    s.resetBody();
    s.setSex('male');
    s.setAge(36);
    s.setHeight(178);
    s.setWeight(84.9);
    s.setSetup('done');
  });
});

afterEach(() => flushBodyPersistence());

describe('Your body when the navigation lacks the planning tools', () => {
  it('puts Find plans in the header as the one primary pill and Simulate a plan in the ⋯; no action bar', async () => {
    expect(LIVING_DESTINATIONS.some((d) => d.id === 'plan' || d.id === 'simulate')).toBe(false);
    const router = createMemoryRouter(routes, { initialEntries: ['/body'] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const header = document.querySelector<HTMLElement>('.lm-ctx-slot')!;
    const find = within(header).getByRole('link', { name: 'Find plans' });
    expect(find).toHaveAttribute('href', '/plan/goals');
    expect(find).toHaveAttribute('data-variant', 'primary');
    expect(document.querySelector('.lm-actionbar')).toBeNull();

    fireEvent.click(within(header).getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Simulate a plan' }));
    expect(router.state.location.pathname).toBe('/simulate');
  });
});
