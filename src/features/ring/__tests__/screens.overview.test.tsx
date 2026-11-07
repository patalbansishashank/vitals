/** Ring › Overview (the Day score, Signals, the empty states). Owner: Overview and Today package files. (r071: split out of `screens.test.tsx`.) */
import './clock';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { dispatch } from '@/commands/bus';
import { setGaugeApi } from '../api';
import { setRingMonitor } from '../monitor/store';
import { useSettingsStore } from '@/state/settingsStore';
import {
  ringHooks,
  setupScreens,
  renderAt,
  header,
  today,
  card,
  emptyServer,
  expectWordsOnly,
} from './screenKit';

setupScreens();

describe('Ring screens: overview', () => {
  ringHooks();

  it('unpaired: one empty state that leads to Settings › Sync, no cards', async () => {
    setGaugeApi(null);
    renderAt('/ring');
    expect(
      await screen.findByRole('heading', { name: 'Connect to your server' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings/sync');
    expect(screen.queryByRole('heading', { name: 'Signals' })).toBeNull();
  });

  it('a server without Gauge data says so', async () => {
    setGaugeApi(emptyServer());
    renderAt('/ring');
    expect(
      await screen.findByRole('heading', { name: 'No ring data yet' }, { timeout: 8000 }),
    ).toBeInTheDocument();
  });

  it('Overview: tabs, freshness, the Ring status capsule, the Day score disc, and steps against the ring’s goal', async () => {
    renderAt('/ring');
    await screen.findByRole('heading', { level: 1, name: 'Ring' }, { timeout: 8000 });
    const tabs = within(header()).getByRole('navigation', { name: 'Ring section' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Overview', 'Sleep', 'Activity', 'Scores']);
    // (r069 sync) when Gauge last sent, on the clock
    expect(within(header()).getByText(/^Phone sent \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(
      await within(header()).findByRole('button', { name: 'Ring connected, battery 64 %' }),
    ).toBeInTheDocument();
    for (const t of ['Day score', 'Activity', 'Sleep', 'Signals', 'Short videos', 'Ring'])
      expect(
        await screen.findByRole('heading', { level: 2, name: t }, { timeout: 5000 }),
      ).toBeInTheDocument();
    // the Day score (r071): the page's one ring with its three arcs, based on 3 of 3, the target 70 in the foot
    const disc = await within(card('Day score')).findByRole('meter', { name: 'Day score' });
    expect(disc.getAttribute('aria-valuetext')).toMatch(
      /^Day score \d+ of 100: recovery \d+, activity \d+, sleep \d+; target 70; based on 3 of 3/,
    );
    expect(within(card('Day score')).getByText('Target 70')).toBeInTheDocument();
    expect(card('Day score').querySelectorAll('.rgs-part')).toHaveLength(3);
    // steps against the ring's own goal (no plan): the A.1.4 order, never a fixed 10 000
    const steps = await within(card('Activity')).findByRole('meter', { name: 'Steps' });
    expect(steps.getAttribute('aria-valuetext')).toMatch(/^Steps:/);
    expect(within(card('Activity')).getByText(/Ring goal 9,000/)).toBeInTheDocument();
  });

  it('keeps ring energy visibly estimated with no energy goal, no "Worn", no breathing rate', async () => {
    renderAt('/ring');
    const activity = (
      await screen.findByRole('heading', { level: 2, name: 'Activity' }, { timeout: 8000 })
    ).closest('section')!;
    await within(activity).findByRole('meter', { name: 'Steps' });
    expect(within(activity).queryByText(/^Ring ~/)).toBeNull();
    fireEvent.click(within(activity).getByRole('button', { name: 'About Activity' }));
    const info = await screen.findByRole('dialog', { name: 'Steps, distance and energy' });
    expect(within(info).getByText('Ring energy estimate')).toBeInTheDocument();
    expect(within(info).getByText(/^~[\d\s.,]+ (?:kcal|kJ)$/)).toBeInTheDocument();
    fireEvent.click(within(info).getByRole('button', { name: 'Close' }));
    // (r068 O04) the label says it is the ring's estimate; no second "Ring estimate" tag
    expect(within(activity).queryByText('Ring estimate')).toBeNull();
    expect(within(activity).queryByText(/Active energy/)).toBeNull();
    expect(within(activity).queryByText(/of 500/)).toBeNull();
    const ring = card('Ring');
    await within(ring).findByText('Connected');
    expect(within(ring).queryByText('Worn')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Breathing rate|Glucose|Blood pressure|Tosses/);
  });

  it('Sleep: last night as one number with one hypnogram, the goal in the foot, the whole card opens Ring › Sleep, the (i) says what it is', async () => {
    renderAt('/ring');
    const sleep = (
      await screen.findByRole('heading', { level: 2, name: 'Sleep' }, { timeout: 8000 })
    ).closest('section')!;
    // the number (hours and minutes), no ring: the Overview's one ring is the Day score
    expect(
      await within(sleep).findByRole('img', { name: '7 hours 56 minutes asleep' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(sleep).queryByRole('meter', { name: 'Asleep' })).toBeNull();
    expect(within(sleep).getByText(/Fell asleep \d\d:\d\d · Woke \d\d:\d\d/, { selector: '.lm-overflow__item' })).toBeInTheDocument();
    // the overview draws the night once; stage durations remain in its table and full Sleep view.
    expect(
      within(sleep).getByRole('img', { name: /^Sleep stages, \d\d:\d\d to \d\d:\d\d: / }),
    ).toBeInTheDocument();
    expect(within(sleep).queryByRole('img', { name: /^Stages:/ })).toBeNull();
    expect(within(sleep).queryByText(/^Of \d+ h/)).toBeNull();
    for (const w of ['Deep', 'Light', 'REM', 'Awake'])
      expect(within(sleep).getAllByText(w).length).toBeGreaterThan(0);
    // the goal: a word on the left, the goal on the right; the old window-continuity and sleep-index tiles are gone
    expect(within(sleep).getByText(/min short$|^Goal met/)).toBeInTheDocument();
    expect(within(sleep).getByText(/^Goal \d+ h/)).toBeInTheDocument();
    expect(within(sleep).queryByText('Window continuity')).toBeNull();
    expect(within(sleep).queryByText('Sleep index')).toBeNull();
    // no Details key and no Table key: the whole card is the link, the table is in the (i)
    expect(within(sleep).queryByRole('link', { name: 'Details' })).toBeNull();
    expect(within(sleep).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(within(sleep).getByRole('link', { name: 'Sleep' })).toHaveAttribute('href', '/sleep');
    fireEvent.click(within(sleep).getByRole('button', { name: 'About Sleep' }));
    const panel = await screen.findByRole('dialog', { name: "Last night's sleep" });
    expect(within(panel).getByText(/Time asleep from the ring, not time in bed/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/^Your ring\. Stages and times as the ring recorded them/),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Your goal: 8 h (limits 7 to 12 h)')).toBeInTheDocument();
    // the Table twin lives here now: the night's stage runs, raw
    expect(within(panel).getByRole('region', { name: 'Sleep stages table' })).toBeInTheDocument();
  });

  it('Signals: the first reading is the hero with its age, word and range; the rest are rows on their scales; Measure on heart rate only', async () => {
    renderAt('/ring');
    const signals = (await screen.findByRole('heading', { name: 'Signals' }, { timeout: 8000 })).closest(
      'section',
    )!;
    // the hero: heart rate, its number, its age, its word and the range that word stands for, and the day's spark
    const hero = await within(signals).findByRole(
      'img',
      { name: /^Heart rate, \d+ beats per minute$/ },
      { timeout: 5000 },
    );
    expect(hero).toBeInTheDocument();
    expect(within(signals).getByText('Heart rate')).toBeInTheDocument();
    expect(within(signals).getAllByText(/min ago|just now/).length).toBeGreaterThan(0);
    expect(within(signals).getByText('50–89 bpm')).toBeInTheDocument();
    expect(await within(signals).findByRole('img', { name: /^Heart rate today/ })).toBeInTheDocument();
    // the rows, each with its word and where the reading sits (the picture is aria-hidden: the row says it)
    const rows = within(signals).getAllByRole('link');
    expect(rows.map((a) => a.querySelector('.rgo-row__label')!.textContent)).toEqual([
      'Sleeping low HR',
      'HRV overnight',
      'Blood oxygen',
      'Stress',
      'Skin temperature overnight',
    ]);
    expect(within(signals).getByRole('link', { name: /^Stress/ })).toHaveAttribute(
      'href',
      `/ring/signals/stress?date=${today}`,
    );
    expect(within(signals).getByRole('link', { name: /^Stress/ }).textContent).toMatch(/ring index/);
    expect(within(signals).getByRole('link', { name: /^HRV overnight/ }).textContent).toMatch(
      /70.*Near usual|Near usual.*70/,
    );
    expect(within(signals).getByRole('link', { name: /^Sleeping low HR/ }).textContent).toMatch(/53/);
    expect(
      within(signals)
        .getByRole('link', { name: /^Blood oxygen/ })
        .querySelector('[role="meter"]'),
    ).not.toBeNull();
    const measure = await within(signals).findByRole('button', { name: 'Measure now' });
    expect(within(signals).getAllByRole('button', { name: 'Measure now' })).toHaveLength(1);
    fireEvent.click(measure);
    expect(
      await within(signals).findByText('Measured 58 bpm', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('Signals: the (i) says what the words mean, with the bands of the fixed-band signals', async () => {
    renderAt('/ring');
    const signals = (await screen.findByRole('heading', { name: 'Signals' }, { timeout: 8000 })).closest(
      'section',
    )!;
    fireEvent.click(within(signals).getByRole('button', { name: 'About Signals' }));
    const panel = await screen.findByRole('dialog', { name: 'What the words mean' });
    expect(within(panel).getByText(/a reading turns stale after 30 minutes to 6 hours/)).toBeInTheDocument();
    for (const t of ['Heart rate', 'Blood oxygen', 'Stress'])
      expect(within(panel).getByLabelText(t)).toBeInTheDocument();
    expect(within(panel).getByText('50–89 bpm')).toBeInTheDocument();
    expect(within(panel).getByText('95 % and over')).toBeInTheDocument();
    expect(within(panel).getByText('26–50 ring index')).toBeInTheDocument();
  });

  it('Signals: Edit opens the card library; a stored order is shown (the first reading is the hero), an empty one shows the default and "Add signals"', async () => {
    setRingMonitor(['steps', 'hr', 'dayScore']);
    renderAt('/ring');
    const signals = (await screen.findByRole('heading', { name: 'Signals' }, { timeout: 8000 })).closest(
      'section',
    )!;
    await waitFor(() =>
      expect(
        within(signals)
          .getAllByRole('link')
          .map((a) => a.querySelector('.rgo-row__label')!.textContent),
      ).toEqual(['Heart rate', 'Day score']),
    );
    // the first signal in the list with a reading is the hero (steps, a count with no scale)
    expect(within(signals).getByRole('img', { name: /^Steps, / })).toBeInTheDocument();
    fireEvent.click(within(signals).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit signals' })).toBeInTheDocument();
    expect(screen.getByText(/3 of 23/)).toBeInTheDocument();
    // the Add list is grouped by what a signal is about, each group a domain
    for (const g of ['Heart', 'Recovery', 'Sleep', 'Move'])
      expect(screen.getAllByText(g).length).toBeGreaterThan(0);
    setRingMonitor([]);
    // (r068 O06/O11) an empty choice shows the default six readings (the hero and five rows), and the key keeps its one name, "Edit"
    await waitFor(() => expect(within(signals).getAllByRole('link')).toHaveLength(5));
    // (Claude UI P2-12) the sheet starts from the six the card shows, never with 0 selected
    await waitFor(() => expect(screen.getByText(/6 of 23/)).toBeInTheDocument());
  });

  it("Signals: Edit saves the library's order at once, and Reset to default puts the six back", async () => {
    renderAt('/ring');
    const signals = (await screen.findByRole('heading', { name: 'Signals' }, { timeout: 8000 })).closest(
      'section',
    )!;
    fireEvent.click(within(signals).getByRole('button', { name: 'Edit' }));
    const panel = await screen.findByRole('dialog', { name: 'Edit signals' });
    // remove "Stress" (a circle-minus key), and the card follows at once
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove Stress' }));
    await waitFor(() => expect(within(signals).queryByRole('link', { name: /^Stress/ })).toBeNull());
    expect(useSettingsStore.getState().ringMonitor).not.toContain('stress');
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(within(signals).getByRole('link', { name: /^Stress/ })).toBeInTheDocument());
  });

  it('quiet mode: the (i) panels of Sleep and Signals carry no digit, no range table and no figures table', async () => {
    expect((await dispatch('settings.update', { patch: { quietMode: true } })).ok).toBe(true);
    renderAt('/ring');
    const sleep = (
      await screen.findByRole('heading', { level: 2, name: 'Sleep' }, { timeout: 8000 })
    ).closest('section')!;
    fireEvent.click(within(sleep).getByRole('button', { name: 'About Sleep' }));
    const panel = await screen.findByRole('dialog', { name: "Last night's sleep" });
    expectWordsOnly(panel);
    expect(within(panel).queryByRole('region', { name: 'Sleep stages table' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /^Close/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Last night's sleep" })).toBeNull());
    const signals = card('Signals');
    fireEvent.click(within(signals).getByRole('button', { name: 'About Signals' }));
    const info = await screen.findByRole('dialog', { name: 'What the words mean' });
    expectWordsOnly(info);
    expect(within(info).queryByLabelText('Heart rate')).toBeNull();
  });
});
