/**
 * (r069 U2) Ring and Activity › Movement with the shared date control: the Overview is one day; Sleep, Scores and
 * Movement show a week, a month, a year or a range from `?period=` with the period's daily values and its total or
 * average; the address keeps the period across the tabs; an old `?date=` link still opens its day, and (r087) an old
 * `/ring/activity` link opens Movement on the same selection.
 */
import './clock';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { resetActivePlan } from '@/features/living/activePlan';
import { resetSleepEntries } from '@/features/living/sleep/entry';
import { fmtDateRange } from '@/features/living/format';
import { periodOf } from '@/features/living/period';
import { setGaugeApi } from '../api';
import { RING_COPY } from '../copy';
import { makeGaugeFixture } from '../fixtures';
import { calendarDate, shiftDate } from '../model';
import { resetRingMonitorCache } from '../monitor/store';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

beforeAll(async () => {
  await import('@/commands');
  await import('../RingPage');
  await import('@/features/living/activity/MovementPage');
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

  it('a week on Movement: the steps by day, their total and daily average, and the week’s activities', async () => {
    const week = periodOf('week', shiftDate(today, -7));
    renderAt(`/activity?period=week&date=${week.from}`);
    expect(await control()).toHaveAccessibleName(/^Last week · .*, choose dates$/);
    const steps = (await screen.findByRole('heading', { level: 2, name: 'Steps' })).closest('section')!;
    expect(await within(steps).findByText(/^Total [\d\s,]+ steps$/)).toBeInTheDocument();
    expect(within(steps).getByRole('img', { name: /^Daily average / })).toBeInTheDocument();
    expect(within(steps).getByRole('img', { name: /^Steps by day, / })).toBeInTheDocument();
    // (r087) Energy is the next tab and opens on the same week; no link card stands in for it
    const tabs = screen.getByRole('navigation', { name: 'Activity section' });
    expect(within(tabs).getByRole('link', { name: 'Energy' })).toHaveAttribute('href', `/energy?period=week&date=${week.from}`);
    expect(screen.queryByRole('link', { name: 'View energy' })).toBeNull();
    // Train is one day: a week opens it on today
    expect(within(tabs).getByRole('link', { name: 'Train' })).toHaveAttribute('href', '/train');
    // the week's activities on one page: nothing to page through
    const list = screen.getByRole('heading', { level: 2, name: RING_COPY.workouts }).closest('section')!;
    expect(within(list).queryByRole('button', { name: 'Earlier' })).toBeNull();
  });

  // (r087) a month is one page of the activity list, the 31-day ones too: its 1st is never left behind an Earlier key
  it('a 31-day month on Movement lists the whole month: the foot names all of it and there is nothing to page', async () => {
    const october = periodOf('month', `${Number(today.slice(0, 4)) - 1}-10-15`);
    renderAt(`/activity?period=month&date=${october.from}`);
    const list = (await screen.findByRole('heading', { level: 2, name: RING_COPY.workouts })).closest('section')!;
    expect(await within(list).findByText(fmtDateRange(october.from, october.to))).toBeInTheDocument();
    expect(within(list).getByText(RING_COPY.periodNoActivities)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Earlier' })).toBeNull();
    expect(within(list).queryByRole('button', { name: 'Later' })).toBeNull();
  });

  // (r087) the Ring's Activity tab moved: its address, with any day or period, opens Movement on the same selection
  it.each([
    ['?period=week&date=2026-01-05', '?period=week&date=2026-01-05'],
    ['?date=2026-01-07', '?date=2026-01-07'],
    ['?period=range&from=2026-01-01&to=2026-01-20', '?period=range&from=2026-01-01&to=2026-01-20'],
    ['', ''],
  ])('the old /ring/activity%s opens /activity%s', async (asked, kept) => {
    const router = renderAt(`/ring/activity${asked}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/activity'));
    expect(router.state.location.search).toBe(kept);
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
  });

  it('/activity/:date, the path form Train uses, opens that day; a day ahead or a bad date opens today', async () => {
    const day = shiftDate(today, -3);
    const a = renderAt(`/activity/${day}`);
    await waitFor(() => expect(a.state.location.search).toBe(`?date=${day}`));
    expect(a.state.location.pathname).toBe('/activity');
    const b = renderAt(`/activity/${shiftDate(today, 2)}`);
    await waitFor(() => expect(b.state.location.pathname + b.state.location.search).toBe('/activity'));
    const c = renderAt('/activity/nonsense');
    await waitFor(() => expect(c.state.location.pathname + c.state.location.search).toBe('/activity'));
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
    const gauge = (await screen.findByRole('heading', { level: 2, name: 'Phone scores' })).closest('section')!;
    expect(await within(gauge).findAllByText(/^Average \d+$/)).not.toHaveLength(0);
  });

  it('keeps the period in the address across the tabs, and the Overview shows the day it ends on', async () => {
    const router = renderAt('/ring/sleep?period=week');
    await control();
    const tabs = screen.getByRole('navigation', { name: 'Ring section' });
    fireEvent.click(within(tabs).getByRole('link', { name: 'Scores' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ring/scores'));
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
