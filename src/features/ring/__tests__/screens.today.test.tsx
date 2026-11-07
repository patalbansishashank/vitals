/**
 * The Ring's cards on Today (r071). Today mounts them by name: `RingSleepToday`, `RingGlance` (heart rate now, HRV, blood
 * oxygen and stress), `RingTodayNote` (why there are none), and `RingTodayFaces` (the glance and the short-video card
 * together, as the page has always drawn them). Each opens the Ring on the same day, has its (i), and shows nothing
 * rather than nag when Gauge data is not there.
 */
import './clock';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { dispatch } from '@/commands/bus';
import { setGaugeApi } from '../api';
import { setRingCommands } from '../commands';
import { makeGaugeFixture } from '../fixtures';
import {
  RING_NOTE_WORDS,
  RING_TODAY_WORDS,
  RingGlance,
  RingSleepToday,
  RingStepsToday,
  RingShortVideos,
  RingTodayFaces,
  RingTodayNote,
} from '../RingToday';
import { shiftDate } from '../model';
import { resetRingMonitorCache } from '../monitor/store';
import { expectWordsOnly, setupScreens, today, commands } from './screenKit';

setupScreens();

describe('Ring on Today', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    resetRingMonitorCache();
    setRingCommands(commands());
  });
  afterEach(() => {
    setGaugeApi(null);
    setRingCommands(null);
  });

  it('the glance: heart rate now as the hero with its spark, HRV, blood oxygen and stress under it, Measure now and when Phone sent, on today', async () => {
    setGaugeApi(makeGaugeFixture());
    render(
      <MemoryRouter>
        <RingTodayFaces date={today} today={today} />
      </MemoryRouter>,
    );
    const glance = (
      await screen.findByRole('heading', { level: 2, name: 'Heart rate' }, { timeout: 5000 })
    ).closest('section')!;
    // the hero: heart rate, its number and its spark
    expect(
      await within(glance).findByRole(
        'img',
        { name: /^Heart rate, \d+ beats per minute$/ },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(await within(glance).findByRole('img', { name: /^Heart rate today/ })).toBeInTheDocument();
    // the three rows, stress included, each opening its signal; what Today's own cards show (sleep times, steps) is not here
    await waitFor(() =>
      expect(
        within(glance)
          .getAllByRole('link')
          .map((a) => a.querySelector('.rgo-row__label')?.textContent)
          .filter(Boolean),
      ).toEqual(['HRV overnight', 'Blood oxygen', 'Stress']),
    );
    expect(within(glance).getByRole('link', { name: /^Stress/ })).toHaveAttribute(
      'href',
      `/ring/signals/stress?date=${today}`,
    );
    expect(within(glance).queryByText('Fell asleep')).toBeNull();
    // the Day score and the "Phone sent" caption left the head: the sync time is a fact in the foot, the Day score its own card
    expect(within(glance).queryByText(/^Day score/)).toBeNull();
    expect(within(glance).getByText(/^Phone sent \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(glance).getByRole('button', { name: 'Measure now' })).toBeInTheDocument();
    // the whole card opens the Ring (through its title); no Open key
    expect(within(glance).getByRole('link', { name: 'Heart rate' })).toHaveAttribute('href', '/ring');
    expect(within(glance).queryByRole('link', { name: 'Open' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Short videos' })).toBeInTheDocument();
  });

  it('the glance on a past day: no sync time and no Measure now, and it opens that day', async () => {
    setGaugeApi(makeGaugeFixture());
    const past = shiftDate(today, -1);
    render(
      <MemoryRouter>
        <RingTodayFaces date={past} today={today} part="glance" />
      </MemoryRouter>,
    );
    const glance = (
      await screen.findByRole('heading', { level: 2, name: 'Heart rate' }, { timeout: 5000 })
    ).closest('section')!;
    await waitFor(() => expect(within(glance).getByText('Blood oxygen')).toBeInTheDocument());
    expect(within(glance).queryByText(/Phone sent|Synced/)).toBeNull();
    expect(within(glance).queryByRole('button', { name: 'Measure now' })).toBeNull();
    expect(within(glance).getByRole('link', { name: 'Heart rate' })).toHaveAttribute(
      'href',
      `/ring?date=${past}`,
    );
  });

  it('the glance’s (i) says what the words mean, and takes a foot for Today ("Remove from Today")', async () => {
    setGaugeApi(makeGaugeFixture());
    render(
      <MemoryRouter>
        <RingGlance
          date={today}
          today={today}
          infoFooter={<button type="button">Remove from Today</button>}
        />
      </MemoryRouter>,
    );
    const glance = (
      await screen.findByRole('heading', { level: 2, name: 'Heart rate' }, { timeout: 5000 })
    ).closest('section')!;
    await userEvent.click(within(glance).getByRole('button', { name: 'About Heart rate' }));
    const panel = await screen.findByRole('dialog', { name: 'What the words mean' });
    expect(within(panel).getByText(/Readings come from the ring/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Remove from Today' })).toBeInTheDocument();
  });

  it('last night on Today: the compact Sleep card, one number, the night and the goal, opening Ring › Sleep', async () => {
    setGaugeApi(makeGaugeFixture());
    render(
      <MemoryRouter>
        <RingSleepToday date={today} today={today} />
      </MemoryRouter>,
    );
    const sleep = (
      await screen.findByRole('heading', { level: 2, name: 'Sleep' }, { timeout: 5000 })
    ).closest('section')!;
    expect(await within(sleep).findByRole('img', { name: '7 hours 56 minutes asleep' })).toBeInTheDocument();
    expect(within(sleep).getByText(/^Fell asleep \d\d:\d\d · Woke \d\d:\d\d$/, { selector: '.lm-overflow__item' })).toBeInTheDocument();
    expect(within(sleep).getByRole('img', { name: /^Sleep stages, / })).toBeInTheDocument();
    // compact: no stage bar and no "Of 8 h" line; the goal is in the foot
    expect(within(sleep).queryByText('Of 8 h')).toBeNull();
    expect(within(sleep).getByText(/^Goal \d+ h/)).toBeInTheDocument();
    expect(within(sleep).getByRole('link', { name: 'Sleep' })).toHaveAttribute('href', '/sleep');
    await userEvent.click(within(sleep).getByRole('button', { name: 'About Sleep' }));
    const detail = await screen.findByRole('dialog', { name: "Last night's sleep" });
    expect(within(detail).getByText('Your goal: 8 h (limits 7 to 12 h)')).toBeInTheDocument();
  });

  it('last night on Today is words only in quiet mode', async () => {
    expect((await dispatch('settings.update', { patch: { quietMode: true } })).ok).toBe(true);
    setGaugeApi(makeGaugeFixture());
    render(
      <MemoryRouter>
        <RingSleepToday date={today} today={today} />
        <RingGlance date={today} today={today} />
      </MemoryRouter>,
    );
    const sleep = (
      await screen.findByRole('heading', { level: 2, name: 'Sleep' }, { timeout: 5000 })
    ).closest('section')!;
    await waitFor(() =>
      expect(within(sleep).getByText(/^Fell asleep (in the|early|late)/)).toBeInTheDocument(),
    );
    const glance = (
      await screen.findByRole('heading', { level: 2, name: 'Heart rate' }, { timeout: 5000 })
    ).closest('section')!;
    await waitFor(() => expect(within(glance).getAllByRole('link').length).toBeGreaterThan(1));
    expectWordsOnly(sleep);
    expectWordsOnly(glance);
  });

  it.each([
    ['Steps', RingStepsToday],
    ['Short videos', RingShortVideos],
  ] as const)('%s passes its Today removal action into its information panel', async (name, Card) => {
    setGaugeApi(makeGaugeFixture());
    render(
      <MemoryRouter>
        <Card date={today} today={today} infoFooter={<button type="button">Remove from Today</button>} />
      </MemoryRouter>,
    );
    const section = (await screen.findByRole('heading', { level: 2, name }, { timeout: 5000 })).closest(
      'section',
    )!;
    await userEvent.click(within(section).getByRole('button', { name: `About ${name}` }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByRole('button', { name: 'Remove from Today' })).toBeInTheDocument();
  });

  it('renders nothing while Gauge data is unavailable (Today never nags)', async () => {
    setGaugeApi(null);
    const { container } = render(
      <MemoryRouter>
        <RingTodayFaces date={today} today={today} />
        <RingGlance date={today} today={today} />
        <RingSleepToday date={today} today={today} />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it('the note: one slim row saying why in a few words, a Connect pill only when the device is not connected, the sentence in its (i)', async () => {
    render(
      <MemoryRouter>
        <RingTodayNote state="unpaired" />
        <RingTodayNote state="unreachable" />
        <RingTodayNote state="empty" />
        <RingTodayNote state="ready" />
        <RingTodayNote state="loading" />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('heading', { level: 2, name: 'Ring' })).toHaveLength(3);
    expect(screen.getByText(RING_NOTE_WORDS.unpaired)).toBeInTheDocument();
    expect(screen.getByText(RING_NOTE_WORDS.unreachable)).toBeInTheDocument();
    expect(screen.getByText(RING_NOTE_WORDS.empty)).toBeInTheDocument();
    // one pill, to Settings › Sync, on the "not connected" row only
    expect(screen.getAllByRole('link', { name: RING_TODAY_WORDS.connect })).toHaveLength(1);
    expect(screen.getByRole('link', { name: RING_TODAY_WORDS.connect })).toHaveAttribute(
      'href',
      '/settings/sync',
    );
    // the sentences are the (i) text
    const row = screen.getByText(RING_NOTE_WORDS.unreachable).closest('section')!;
    await userEvent.click(within(row).getByRole('button', { name: 'About Ring' }));
    const panel = await screen.findByRole('dialog', { name: 'No ring data' });
    expect(within(panel).getByText(RING_TODAY_WORDS.unreachable)).toBeInTheDocument();
    expect(within(panel).getByText(/Ring cards fill in a few minutes after your phone syncs/)).toBeInTheDocument();
  });
});
