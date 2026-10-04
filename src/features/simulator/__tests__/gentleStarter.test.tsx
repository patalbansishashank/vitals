import '@/features/charts/test/setupDom';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/App';
import { seedClearedSafety, STANDARD_ANSWERS } from '@/features/onboarding/testing';
import { initialScenarios, useScheduleStore } from '@/state/scheduleStore';
import { withSystemWrite } from '@/state/scope';

// jsdom has no scrolling; ScrollRestoration calls it on navigation.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const starter = () => useScheduleStore.getState().scenarios.find((s) => s.id === 'starter')!;

describe('first scenario in gentle mode (QA: an ED-risk user landed on a pre-painted 12-week deficit)', () => {
  beforeEach(() => {
    localStorage.clear();
    withSystemWrite(() => useScheduleStore.setState({ ...initialScenarios(), history: {} }));
  });

  it('swaps the untouched default deficit for the maintenance starter', async () => {
    seedClearedSafety({ ...STANDARD_ANSWERS, eatingDisorder: 'yes' });
    renderAt('/simulate/starter/schedule');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    await waitFor(() => expect(starter().name).toBe('Maintenance + training'));
    // no deficit programs: the maintenance starter's rest days sit at 95 %, lifting days at 100 %
    const pcts = starter().schedule.programs.map((p) => (p.energy.kind === 'pctMaintenance' ? p.energy.pct : 100));
    expect(Math.min(...pcts)).toBeGreaterThanOrEqual(95);
  }, 20_000);

  it('keeps the default in standard mode', async () => {
    seedClearedSafety();
    renderAt('/simulate/starter/schedule');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    expect(starter().name).toBe('Moderate deficit');
  }, 20_000);
});
