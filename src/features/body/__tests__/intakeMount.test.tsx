/** Your body with the intake: "a normal day" in Habits, the asked-later chip, the maintenance panel and Your setup. */
import { act, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/App';
import { resetBusState, resetHistory } from '@/commands';
import { DEFAULT_CONTEXT } from '@/features/intake/flow';
import { saveChapter, settleIntakeSaves } from '@/features/intake/persist';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { useProfileStore } from '@/state/profileStore';
import { setDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

beforeEach(() => {
  localStorage.clear();
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  resetHistory();
  resetBusState();
  seedClearedSafety();
  withSystemWrite(() => useProfileStore.getState().resetBody());
  act(() => {
    const s = useProfileStore.getState();
    s.setSex('male');
    s.setAge(36);
    s.setHeight(178);
    s.setWeight(84.9);
    s.setSetup('done');
  });
});

describe('Your body with the intake', () => {
  it('shows a normal day, the asked-later reminder, the maintenance drivers and Your setup', async () => {
    await saveChapter(
      'activity',
      {
        values: { work: 'yes', workTime: { days: 5, hours: 8 }, commute: 'ride', stepsKnown: 'roughly', stepsRough: 6000, offDay: 'mixed', home: 'some', sport: [], trainNow: 'none', sleep: { bed: 23, wake: 7 }, sleepQuality: 'fair' },
        status: { work: 'answered', job: 'skipped', workTime: 'answered', commute: 'answered', stepsKnown: 'answered', stepsRough: 'answered', offDay: 'answered', home: 'answered', sport: 'answered', trainNow: 'answered', sleep: 'answered', sleepQuality: 'answered' },
      },
      { ...DEFAULT_CONTEXT, safety: null, now: '2026-10-01T09:00:00.000Z' },
    );
    await settleIntakeSaves();
    const router = createMemoryRouter(routes, { initialEntries: ['/body'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your body' })).toBeInTheDocument();

    const habits = document.getElementById('body-habits')!;
    expect(within(habits).getByText('a normal day')).toBeInTheDocument();
    expect(within(habits).getByText(/5 days × 8 h/)).toBeInTheDocument();
    expect(within(habits).getByRole('link', { name: 'Edit a normal day' })).toHaveAttribute('href', '/onboarding/activity?from=body');
    // one question asked later (the job card) → the reminder chip
    expect(within(habits).getByRole('button', { name: /1 question asked later/ })).toBeInTheDocument();

    const maint = document.getElementById('body-maintenance')!;
    expect(within(maint).getByRole('heading', { name: 'Maintenance' })).toBeInTheDocument();
    const table = within(maint).getAllByRole('table')[0]!;
    expect(within(table).getByRole('rowheader', { name: 'steps' })).toBeInTheDocument();
    // the work part rests on the skipped job card: marked assumed
    expect(within(table).getByText('assumed — you skipped this')).toBeInTheDocument();

    const setup = document.getElementById('body-setup')!;
    expect(within(setup).getByRole('heading', { name: 'Your setup' })).toBeInTheDocument();
    expect(within(setup).getByRole('link', { name: 'Change Training and equipment' })).toHaveAttribute('href', '/onboarding/training?from=body');
  });
});
