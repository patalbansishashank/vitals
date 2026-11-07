/**
 * (r069 U2) Ring with the shared date control: the Overview is one day; Sleep, Activity and Scores show a week, a month,
 * a year or a range from `?period=` with the period's daily values and its total or average; the address keeps the
 * period across the tabs; an old `?date=` link still opens its day.
 */
import './clock';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { resetActivePlan } from '@/features/living/activePlan';
import { resetSleepEntries } from '@/features/living/sleep/entry';
import { periodOf } from '@/features/living/period';
import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import { calendarDate, shiftDate } from '../model';
import { resetRingMonitorCache } from '../monitor/store';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

beforeAll(async () => {
  await import('@/commands');
  await import('../RingPage');
}, 120_000);

vi.setConfig({ testTimeout: 30_000 });

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const today = calendarDate(Date.now());
const control = () => screen.findByRole('button', { name: /, choose (a day|dates)$/ });

describe('Ring periods', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    resetActivePlan();
    resetSleepEntries();
    resetRingMonitorCache();
    setGaugeApi(makeGaugeFixture({ uploadedMinutesAgo: 4 }));
  });
  afterEach(() => setGaugeApi(null));

  it('the Overview is one day: its calendar has no period bank', async () => {
    renderAt('/ring');
    fireEvent.click(await control());
    const sheet = await screen.findByRole('dialog', { name: 'Choose a day' });
    expect(within(sheet).queryByRole('radiogroup', { name: 'Period' })).toBeNull();
  });

  it('a week on Activity: the steps by day, their total and daily average, and the week’s activities', async () => {
    const week = periodOf('week', shiftDate(today, -7));
    renderAt(`/ring/activity?period=week&date=${week.from}`);
    expect(await control()).toHaveAccessibleName(/^Last week · .*, choose dates$/);
    const steps = (await screen.findByRole('heading', { level: 2, name: 'Steps' })).closest('section')!;
    expect(await within(steps).findByText(/^Total [\d\s,]+ steps$/)).toBeInTheDocument();
    expect(within(steps).getByRole('img', { name: /^Daily average / })).toBeInTheDocument();
    expect(within(steps).getByRole('img', { name: /^Steps by day, / })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View energy' })).toHaveAttribute('href', `/energy?period=week&date=${week.from}`);
    expect(screen.getByRole('heading', { level: 2, name: 'Workouts' })).toBeInTheDocument();
  });

  it('a month on Sleep: time asleep by night with the average night as the number', async () => {
    renderAt('/ring/sleep?period=month');
    expect(await control()).toHaveAccessibleName(/^This month · .*, choose dates$/);
    const card = (await screen.findByRole('heading', { level: 2, name: 'Time asleep' })).closest('section')!;
    expect(await within(card).findByRole('img', { name: /^Time asleep, average \d+ h( \d\d)?$/ })).toBeInTheDocument();
    expect(within(card).getByText(/^Avg · (\d+ nights|\d+ of \d+ nights)$/)).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /^Time asleep, \d+ days?/ })).toBeInTheDocument();
    expect(within(card).getByText(/^Goal met \d+ of \d+ nights$/)).toBeInTheDocument();
  });

  it('a year on Scores: each score over the year with its average', async () => {
    renderAt('/ring/scores?period=year');
    expect(await control()).toHaveAccessibleName(/^This year · \d{4}, choose dates$/);
    const gauge = (await screen.findByRole('heading', { level: 2, name: 'On-device scores' })).closest('section')!;
    expect(await within(gauge).findAllByText(/^Average \d+$/)).not.toHaveLength(0);
  });

  it('keeps the period in the address across the tabs, and the Overview shows the day it ends on', async () => {
    const router = renderAt('/ring/sleep?period=week');
    await control();
    const tabs = screen.getByRole('navigation', { name: 'Ring section' });
    fireEvent.click(within(tabs).getByRole('link', { name: 'Activity' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ring/activity'));
    expect(router.state.location.search).toBe(`?period=week&date=${periodOf('week', today).from}`);
    fireEvent.click(within(tabs).getByRole('link', { name: 'Overview' }));
    expect(await screen.findByRole('button', { name: /^Today · .*, choose a day$/ })).toBeInTheDocument();
  });

  it('opens an old day link on its day, and picks a week from the calendar', async () => {
    const day = shiftDate(today, -3);
    const router = renderAt(`/ring/scores?date=${day}`);
    fireEvent.click(await control());
    const sheet = await screen.findByRole('dialog', { name: 'Choose dates' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Week' }));
    await waitFor(() => expect(router.state.location.search).toBe(`?period=week&date=${periodOf('week', day).from}`));
  });
});
