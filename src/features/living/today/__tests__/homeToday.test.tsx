/**
 * Today as home in every mode (0.6.3): the real routes (Planning mode) or the Living harness, and an in-memory Gauge client. Without a
 * plan: No plan running (Find a plan · Simulate a plan), last night's sleep, the day's steps, the ring glance with heart
 * rate, Heart Points and the energy note; with one: the plan, Adherence, Weight, sleep and the glance. When the server
 * can't be reached (or the device isn't connected to one) the ring's cards give way to one quiet line. Quiet mode: the
 * page's own words carry no digits.
 */
// the Ring fixture's night ends at its wake time or now: read the day from noon, at any hour the suite runs
import '@/features/ring/__tests__/clock';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { resetActivePlan } from '@/features/living/activePlan';
import { renderLiving } from '@/features/living/testing';
import { FIXTURE_TODAY } from '@/features/living/data/fixtures';
import { resetSleepEntries } from '@/features/living/sleep/entry';
import { setGaugeApi } from '@/features/ring/api';
import { makeGaugeFixture } from '@/features/ring/fixtures';
import { resetRingMonitorCache } from '@/features/ring/monitor/store';
import { RING_NOTE_WORDS, RING_TODAY_WORDS } from '@/features/ring/RingToday';
import type { RingApi } from '@/features/ring/types';
import { dispatch } from '@/commands';
import { simulate } from '@/engine';
import { setSimulationClient } from '@/workers/simulationClient';
import { useProfileStore } from '@/state/profileStore';
import { withSystemWrite } from '@/state/scope';
import TodayPage from '../TodayPage';
import { PLANLESS_COPY } from '../PlanlessToday';
import { FACE_WORDS } from '../components/ActivityFace';

// The mode comes from the in-memory plan store (empty: Planning mode; `renderLiving` sets the fixture plan: Living).

window.scrollTo = (() => undefined) as typeof window.scrollTo;

beforeAll(async () => {
  await import('@/commands');
  await import('@/features/living/boot');
  await import('../TodayPage');
}, 120_000);

vi.setConfig({ testTimeout: 30_000 });

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

/** Cards supplied by either the package or the unchanged Ring components. */
const card = (name: string | RegExp) => {
  const heading = screen.getAllByRole('heading', { name }).find((h) => h.closest('section,article'))!;
  return heading.closest<HTMLElement>('section,article')!;
};
const findCard = async (name: string | RegExp) => {
  await screen.findAllByRole('heading', { name }, { timeout: 8000 });
  return card(name);
};
async function addCards(...names: string[]) {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit cards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add a card' }));
  const library = await screen.findByRole('dialog', { name: "Today's cards" });
  for (const name of names)
    fireEvent.click(await within(library).findByRole('button', { name: `Add ${name}` }));
  fireEvent.click(within(library).getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Done editing cards' }));
}

/** A server that can't be reached: every answer is null and the client says it is offline. */
function offlineServer(): RingApi {
  const base = makeGaugeFixture();
  const none = async () => null;
  return {
    ...base,
    status: () => ({ lastOkAt: null, problem: 'offline' }),
    availability: none,
    daily: none,
    sleep: none,
    activity: none,
    scores: none,
    device: none,
    shortVideo: none,
    workouts: none,
    series: none,
    steps: none,
    timeline: none,
    baselines: none,
  } as unknown as RingApi;
}

beforeEach(() => {
  freshState({ cleared: true });
  resetActivePlan();
  resetSleepEntries();
  resetRingMonitorCache();
});
afterEach(() => {
  setGaugeApi(null);
  resetActivePlan();
});

describe('Today without a plan (Planning mode)', () => {
  it('server reachable: No plan running with its two ways to a plan, sleep, steps, the ring glance and Heart Points; each ring card opens the Ring section', async () => {
    setGaugeApi(makeGaugeFixture({ uploadedMinutesAgo: 4 }));
    const router = renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    expect(router.state.location.pathname).toBe('/today');

    const plan = card(PLANLESS_COPY.noPlan);
    expect(within(plan).getByRole('link', { name: PLANLESS_COPY.findPlan })).toHaveAttribute('href', '/plan');
    expect(within(plan).getByRole('link', { name: PLANLESS_COPY.simulate })).toHaveAttribute(
      'href',
      '/simulate',
    );

    const sleep = await findCard('Sleep');
    expect(within(sleep).getByRole('link', { name: 'Sleep' })).toHaveAttribute('href', '/sleep');
    await waitFor(() =>
      expect(within(sleep).getByText(/^Fell asleep \d\d:\d\d · Woke \d\d:\d\d$/, { selector: '.lm-overflow__item' })).toBeInTheDocument(),
    );

    const steps = await findCard(RING_TODAY_WORDS.steps);
    expect(within(steps).getByRole('button', { name: 'Steps by source' })).toBeInTheDocument();
    expect(steps).toHaveAttribute('data-size', 'card');
    await waitFor(() => expect(within(steps).getByRole('img', { name: /^Steps through the day/ })).toBeInTheDocument());

    await addCards('Ring signals', 'Heart Points', "Today's activities");
    const glance = await findCard('Heart rate');
    expect(within(glance).getByRole('link', { name: 'Heart rate' })).toHaveAttribute('href', '/ring');
    // r071: heart rate is the hero; Day score has its own library card.
    await waitFor(() => expect(within(glance).getByRole('heading', { name: 'Heart rate' })).toBeInTheDocument());
    expect(within(glance).queryByText(/^Day score \d+/)).toBeNull();

    const activity = await findCard('Today’s activities');
    expect(await findCard('Heart Points')).toBeInTheDocument();
    // (r068 V14) "Log an activity" opens Train's log sheet over Today (no trip to Train)
    expect(within(activity).getByRole('button', { name: FACE_WORDS.logActivity })).toBeInTheDocument();
    // no body basics in this store: energy by kind says what it needs, with the way to Your body (r068 T3: its own card)
    await within(await findCard('Energy')).findByText(
      FACE_WORDS.noProfile,
      {},
      { timeout: 5000 },
    );
    expect(within(card('Energy')).getByRole('link', { name: FACE_WORDS.yourBody })).toHaveAttribute(
      'href',
      '/body',
    );

    expect(screen.queryByText(RING_TODAY_WORDS.unreachable)).toBeNull();
    // no plan-day facts on a day without a plan
    expect(screen.queryByText(/day \d+ of/)).toBeNull();
  });

  it('server unreachable: one quiet line instead of the ring cards, and the plan card stays', async () => {
    setGaugeApi(offlineServer());
    renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    expect(await screen.findByText(RING_NOTE_WORDS.unreachable, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(card(PLANLESS_COPY.noPlan)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Sleep' })).toBeNull();
    expect(await findCard('Steps')).toHaveTextContent('No step data yet');
    // (r068 V25) one small Ring card holding the line, not an error wall: no alert, no banner, no signals
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2, name: 'Ring' })).toHaveLength(1);
    expect(within(card('Ring')).queryByText('Heart rate')).toBeNull();
  });

  it('not connected to a server: the line says so and leads to Settings › Sync', async () => {
    setGaugeApi(null);
    renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    // (r068 V25) the line in a small Ring card, Connect an outlined key in its head
    const line = (await screen.findByText(RING_NOTE_WORDS.unpaired, {}, { timeout: 5000 })).closest(
      'section',
    )!;
    expect(within(line).getByRole('link', { name: RING_TODAY_WORDS.connect })).toHaveAttribute(
      'href',
      '/settings/sync',
    );
  });

  it('quiet mode: the page’s own words and names carry no digits, and the energy note goes', async () => {
    expect((await dispatch('settings.update', { patch: { quietMode: true } })).ok).toBe(true);
    setGaugeApi(offlineServer());
    renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    const plan = card(PLANLESS_COPY.noPlan);
    expect(plan.textContent).not.toMatch(/\d/);
    expect(
      [...plan.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' '),
    ).not.toMatch(/\d/);
    const line = await screen.findByText(RING_NOTE_WORDS.unreachable, {}, { timeout: 5000 });
    expect(line.textContent).not.toMatch(/\d/);
    expect(screen.queryByText(FACE_WORDS.noProfile)).toBeNull();
    expect(screen.queryByText(FACE_WORDS.noPlanCaption)).toBeNull();
  });

  it('quiet mode with the server reachable: defaults and optional ring/activity cards are words only, aria too', async () => {
    expect((await dispatch('settings.update', { patch: { quietMode: true } })).ok).toBe(true);
    setGaugeApi(makeGaugeFixture({ uploadedMinutesAgo: 4 }));
    renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    // Optional signals and activity cards remain available through the library in quiet mode.
    await addCards('Ring signals', 'Short videos', 'Heart Points', "Today's activities");
    const names = [
      'Sleep',
      RING_TODAY_WORDS.steps,
      'Heart rate',
      'Short videos',
      'Heart Points',
      'Today’s activities',
    ];
    for (const n of names) await findCard(n);
    await waitFor(() => expect(card('Heart Points')).toHaveTextContent(/Heart Points|No readings/));
    await waitFor(() =>
      expect(within(card('Sleep')).getByText(/^Fell asleep (?:in the|early|late).* · Woke (?:in the|early|late).*$/, { selector: '.lm-overflow__item' })).toBeInTheDocument(),
    );
    await waitFor(() => expect(within(card('Heart rate')).getByRole('heading', { name: 'Heart rate' })).toBeInTheDocument());
    for (const n of names) {
      const el = card(n);
      expect(el.textContent, n).not.toMatch(/\d/);
      for (const node of [el, ...el.querySelectorAll('*')])
        for (const attr of ['aria-label', 'aria-valuetext', 'aria-valuenow', 'title', 'alt']) {
          const v = node.getAttribute(attr);
          if (v) expect(v, `${n} [${attr}]`).not.toMatch(/\d/);
        }
    }
  });

  it('with Your body filled in: energy so far and likely by bedtime from the habitual day, with ranges, and no plan figure', async () => {
    withSystemWrite(() =>
      useProfileStore.setState({ sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92, setup: 'done' }),
    );
    // the engine itself (the harness's stand-in client returns no hours)
    setSimulationClient({
      runNominal: async (
        profile: Parameters<typeof simulate>[0],
        schedule: Parameters<typeof simulate>[1],
        opts: unknown,
      ) => simulate(profile, schedule, opts as Parameters<typeof simulate>[2]),
      runDraws: async () => [],
      preview: async () => ({ fatMass: new Float32Array(1), ketosis: new Float32Array(1) }),
      cancel: () => undefined,
    } as never);
    setGaugeApi(makeGaugeFixture({ uploadedMinutesAgo: 4 }));
    renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    expect(screen.queryByRole('heading', { name: "Today's activities" })).toBeNull();
    // Energy is a default card; activities stay in the library.
    const energy = await screen.findByRole('region', { name: 'Energy' }, { timeout: 10_000 });
    await waitFor(
      () => expect(within(energy).getByRole('img', { name: /^Burned so far .*likely/ })).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(within(energy).getByText(/^By bedtime /)).toBeInTheDocument();
    expect(within(energy).getByRole('link', { name: 'Energy' })).toHaveAttribute('href', '/energy');
    expect(within(energy).queryByText(/^Plan /)).toBeNull();
    fireEvent.click(within(energy).getByRole('button', { name: 'About Energy' }));
    expect(await screen.findByRole('dialog', { name: 'Energy' })).toHaveTextContent(FACE_WORDS.noPlanNote);
    expect(screen.queryByText(FACE_WORDS.noProfile)).toBeNull();
  });
});

// Living mode on the in-memory stand-in (the fixture plan "Spring cut", day 15 of 84, on the fixture's day), as the
// other Today tests mount it; the ring answers for the same day.
describe('Today with a live plan (Living mode)', () => {
  const NOW = `${FIXTURE_TODAY}T13:00:00`;
  const living = () => renderLiving(<TodayPage />, { path: '/today', route: 'today', now: NOW });

  it('server reachable: the day hero and defaults, plus optional ring signals, Heart Points and activities', async () => {
    setGaugeApi(makeGaugeFixture({ now: Date.parse(NOW), uploadedMinutesAgo: 4 }));
    living();
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(await findCard('Eaten so far')).toBeInTheDocument();
    expect(await findCard('Weight')).toBeInTheDocument();
    const sleep = await findCard('Sleep');
    expect(within(sleep).getByRole('link', { name: 'Sleep' }).getAttribute('href')).toMatch(/^\/sleep/);
    await addCards('Ring signals', 'Heart Points', "Today's activities");
    const glance = await findCard('Heart rate');
    expect(within(glance).getByRole('link', { name: 'Heart rate' })).toHaveAttribute('href', '/ring');
    expect(await findCard('Heart Points')).toBeInTheDocument();
    expect(await findCard('Today’s activities')).toBeInTheDocument();
    // no planless pieces on a planned day
    expect(screen.queryByRole('heading', { name: PLANLESS_COPY.noPlan })).toBeNull();
    expect(screen.queryByText(FACE_WORDS.noProfile)).toBeNull();
    expect(screen.queryByText(RING_TODAY_WORDS.unreachable)).toBeNull();
  });

  it('server unreachable: the plan’s cards stay and the ring gives way to the one quiet line', async () => {
    setGaugeApi(offlineServer());
    living();
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(await findCard('Eaten so far')).toBeInTheDocument();
    expect(await screen.findByText(RING_NOTE_WORDS.unreachable, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Sleep' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2, name: 'Ring' })).toHaveLength(1);
  });
});
