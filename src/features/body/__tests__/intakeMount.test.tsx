/** Your body with the intake: the maintenance card is the one home of "a normal day"; the asked-later capsule sits in the header. */
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
  it('keeps one home for a normal day (the maintenance card), the asked-later reminder in the header, and no copies in Habits', async () => {
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

    // Habits shows only what its own editor sets: no "a normal day" line, no second edit link, no steps or training type
    const habits = document.getElementById('body-habits')!;
    expect(within(habits).queryByText('A normal day')).toBeNull();
    expect(within(habits).queryByRole('link', { name: 'Edit a normal day' })).toBeNull();
    expect(within(habits).queryByText(/typical steps|training type/)).toBeNull();
    expect(within(habits).getByText('Stress')).toBeInTheDocument();

    // one question asked later (the job card) → the reminder, a status icon in the header (its words its name and
    // tooltip, a gold dot), opening the question; not in a card
    const header = document.querySelector<HTMLElement>('.lm-ctx-slot')!;
    const reminder = within(header).getByRole('link', { name: '1 question asked later — answer now' });
    expect(reminder).toHaveClass('lm-status-icon');
    expect(reminder.getAttribute('href')).toMatch(/^\/onboarding\//);
    expect(reminder.querySelector('.lm-status-icon__dot')).not.toBeNull();
    expect(within(habits).queryByRole('link', { name: /asked later/ })).toBeNull();

    // the maintenance card: the one maintenance number on the page (Estimates no longer repeats it)
    const maint = document.getElementById('body-maintenance')!;
    expect(maint.querySelector('.lm-hero')).not.toBeNull();
    expect(within(document.getElementById('body-estimates')!).queryByText('maintenance')).toBeNull();
    // the old "Your setup" card is gone from Your body
    expect(document.getElementById('body-setup')).toBeNull();
  });
});
