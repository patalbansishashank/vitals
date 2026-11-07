/** Ring › Sleep and `/sleep`. (r071: split out of `screens.test.tsx`.) */
import './clock';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { OvernightCard } from '@/features/living/sleep/OvernightCard';
import { nightView } from '@/features/living/sleep/model';
import { resetActivePlan } from '@/features/living/activePlan';
import { dispatch } from '@/commands/bus';
import { defineCommand, fail, getCommand } from '@/commands/registry';
import { setGaugeApi } from '../api';
import { setRingCommands } from '../commands';
import { makeGaugeFixture } from '../fixtures';
import { minutesText, shiftDate, signed } from '../model';
import { ringHooks, setupScreens, renderAt, today, card, commands, expectWordsOnly } from './screenKit';

setupScreens();

async function seededNight() {
  const fixture = makeGaugeFixture({ uploadedMinutesAgo: 4 });
  if (!fixture.baselines) throw new Error('The seeded baseline API is missing');
  setGaugeApi(fixture);
  const [sleep, baselines] = await Promise.all([fixture.sleep(today, today), fixture.baselines(today)]);
  if (!sleep || !baselines?.tempBaseline) throw new Error('The seeded night or temperature baseline is missing');
  const session = sleep.sessions.find((session) => session.wakingDate === today);
  const metrics = session?.metrics;
  if (!metrics) throw new Error('The seeded night is missing');
  expect(session?.wakingDate).toBe(today);
  expect(baselines.date).toBe(today);
  return { metrics, baselines };
}

describe('Ring screens: sleep', () => {
  ringHooks();

  it.each(['2026-10-31', '2026-11-01'])('Overnight HRV uses the selected night and its preceding baseline on %s', async (date) => {
    const fixture = makeGaugeFixture({ now: new Date(`${date}T12:00:00`).getTime() });
    const [sleep, baseline] = await Promise.all([fixture.sleep(date, date), fixture.baselines!(date)]);
    const session = sleep!.sessions.find((s) => s.wakingDate === date)!;
    const metrics = session.metrics!;
    expect(session.wakingDate).toBe(date);
    expect(baseline!.date).toBe(date);
    expect(baseline!.hrvBaseline!.n).toBe(28);
    const hrvBaseline = baseline!.hrvBaseline!;
    const usualHrv = hrvBaseline.medianMs ?? Math.exp(hrvBaseline.median);
    const difference = metrics.hrvNightlyMs! - usualHrv;
    const v = nightView({ session, baselines: baseline, plan: null });
    render(<MemoryRouter><OvernightCard v={v} baselines={baseline} date={date} quiet={false} /></MemoryRouter>);
    const row = screen.getByRole('link', { name: /^HRV/ });
    expect(row).toHaveAttribute('href', `/ring/signals/hrv?date=${date}`);
    expect(row).toHaveTextContent(`HRV${metrics.hrvNightlyMs}ms`);
    expect(row).toHaveTextContent(`${signed(difference)} ms vs usual`);
    expect(screen.getByText(`Usual HRV ${Math.round(usualHrv)} ms`)).toBeInTheDocument();
  });

  it('Last night: the night as one number in the ring, the whole hypnogram, the stage shares, the goal in the foot and the Sleep index one link away', async () => {
    const { metrics } = await seededNight();
    renderAt('/ring/sleep');
    const night = (await screen.findByRole('heading', { level: 2, name: 'Last night' }, { timeout: 8000 })).closest('section')!;
    // the number is in the page's one ring, with the goal; when the night began and ended are two facts beside it
    expect(within(night).getByRole('meter', { name: 'Asleep' }).getAttribute('aria-valuetext')).toMatch(/^Asleep: 7 h 56, goal 8 h/);
    expect(within(night).getByText(/^Fell asleep \d\d:\d\d$/, { selector: '.sl-hero__facts .lm-overflow__item' })).toBeInTheDocument();
    expect(within(night).getByText(/^Woke \d\d:\d\d$/, { selector: '.sl-hero__facts .lm-overflow__item' })).toBeInTheDocument();
    // the hypnogram draws the four levels, and the shares of the stages are ONE bar named by its parts
    expect(night.querySelectorAll('[data-row]')).toHaveLength(4);
    // The fixture seeds each date differently; verify every displayed duration against that date's source metrics.
    const stages = metrics.stageMinutes!;
    expect(within(night).getByRole('img', { name: `Stages: deep ${minutesText(stages.deep)}, light ${minutesText(stages.light)}, rem ${minutesText(stages.rem)}, awake ${minutesText(stages.awake)}` })).toBeInTheDocument();
    expect(within(night).getByText(new RegExp(`Deep \\+ REM ~${minutesText(metrics.restorativeEstimatedMin!)} · \\d+\\s?% · Estimate`), { selector: '.lm-overflow__item' })).toBeInTheDocument();
    // the goal is the foot (a word and the goal); the old head keys and tiles are gone
    expect(within(night).getByText('4 min short')).toBeInTheDocument();
    expect(within(night).getByText('Goal 8 h')).toBeInTheDocument();
    expect(within(night).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(within(night).queryByText('Stages')).toBeNull();
    // the Sleep index lives on Scores: one link, with its word
    expect(within(night).getByRole('link', { name: /^Sleep index \d+ · (Excellent|Good|Fair|Needs work)$/ })).toHaveAttribute('href', '/ring/scores');
    // A.0: never "Efficiency" or "In bed" from the ring alone
    expect(screen.queryByText('Efficiency')).toBeNull();
    expect(screen.queryByText('In bed')).toBeNull();
    // the (i): what the old subtext said, where it comes from, and the tables behind the pictures
    fireEvent.click(within(night).getByRole('button', { name: 'About Last night' }));
    const panel = await screen.findByRole('dialog', { name: "Last night's sleep" });
    expect(within(panel).getByText(/The sleep index weighs duration 50 %, window continuity 25 % and midpoint against your usual 25 %/)).toBeInTheDocument();
    expect(within(panel).getByText(/^Your ring\. Stages and times as the ring recorded them/)).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Sleep stages table' })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Stages table' })).toBeInTheDocument();
    expect(within(panel).getByText('Awake break')).toBeInTheDocument();
  });

  it('Timing: the midpoint as the number, the window against the usual one, the facts in one line, how far from usual in the foot', async () => {
    renderAt('/ring/sleep');
    const timing = (await screen.findByRole('heading', { level: 2, name: 'Timing' }, { timeout: 8000 })).closest('section')!;
    expect(within(timing).getByRole('img', { name: /^Sleep midpoint \d\d:\d\d$/ })).toBeInTheDocument();
    expect(within(timing).getByText('Sleep midpoint')).toBeInTheDocument();
    // the picture says when: the night's window, the usual one and the two ends, as one sentence
    expect(within(timing).getByRole('img', { name: /^Sleep timing: \d\d:\d\d to \d\d:\d\d, usual \d\d:\d\d to \d\d:\d\d$/ })).toBeInTheDocument();
    expect(within(timing).queryByText(/^Settle \d+ min/)).toBeNull();
    expect(within(timing).getByText(/min (later|earlier) than usual$|^Near usual$/, { selector: '.lm-stateword .lm-overflow__item' })).toBeInTheDocument();
    expect(within(timing).getByText(/^Usual \d\d:\d\d–\d\d:\d\d$/)).toBeInTheDocument();
    // no tiles, no (i) on a value: the words of the old popovers are terms of the card's (i)
    expect(within(timing).queryByRole('button', { name: /^About (Settle time|Window continuity)$/ })).toBeNull();
    fireEvent.click(within(timing).getByRole('button', { name: 'About Timing' }));
    const panel = await screen.findByRole('dialog', { name: 'Sleep timing' });
    expect(within(panel).getByText(/Fell asleep \d+ min (later|earlier) than usual.*Settle \d+ min.*Continuity.*Wake-ups/)).toBeInTheDocument();
    for (const t of ['Settle time', 'Window continuity', 'Sleep midpoint']) expect(within(panel).getAllByText(t).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/^Your usual window: \d\d:\d\d–\d\d:\d\d over \d+ nights$/)).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Sleep timing table' })).toBeInTheDocument();
  });

  it('Overnight: three rows, each a link to its signal with its word and its own scale', async () => {
    const { metrics, baselines } = await seededNight();
    renderAt('/ring/sleep');
    const overnight = (await screen.findByRole('heading', { level: 2, name: 'Overnight' }, { timeout: 8000 })).closest('section')!;
    const rows = within(overnight).getAllByRole('link');
    expect(rows.map((a) => a.getAttribute('href'))).toEqual([`/ring/signals/hrv?date=${today}`, `/ring/signals/temp?date=${today}`, `/ring/signals/spo2?date=${today}`]);
    // The previous 28 date-seeded nights change at midnight; tonight's HRV alone does not determine its delta.
    const hrvBaseline = baselines.hrvBaseline!;
    const usualHrv = hrvBaseline.medianMs ?? Math.exp(hrvBaseline.median);
    const hrvDifference = metrics.hrvNightlyMs! - usualHrv;
    expect(rows[0]!.textContent).toContain(`HRV${metrics.hrvNightlyMs}ms`);
    expect(rows[0]!.textContent).toContain(`${signed(hrvDifference)} ms vs usual`);
    expect(rows[0]!.textContent).toContain('Near usual');
    const tempDifference = Math.round((metrics.skinTempNightC! - baselines.tempBaseline!.median) * 10) / 10;
    expect(rows[1]!.textContent).toContain(`Skin temp vs usual${signed(tempDifference, 1)}°C`);
    expect(rows[1]!.textContent).toContain('Near usual');
    expect(rows[2]!.textContent).toContain(`Blood oxygen${metrics.spo2Night!.meanPct}%`);
    expect(rows[2]!.textContent).toContain(`Lowest ${metrics.spo2Night!.minPct} %`);
    expect(rows[2]!.textContent).toContain('Normal');
    // every row has its own scale
    for (const r of rows) expect(r.querySelector('[role="meter"]')).not.toBeNull();
    expect(within(overnight).getByText(/^HRV near usual$/)).toBeInTheDocument();
    expect(within(overnight).getByText(`Usual HRV ${Math.round(usualHrv)} ms`)).toBeInTheDocument();
  });

  it('Sleep heart rate: the sleeping low as the number, the night as one line with the lowest marked, the facts in one line', async () => {
    renderAt('/ring/sleep');
    const hr = (await screen.findByRole('heading', { level: 2, name: 'Sleep heart rate' }, { timeout: 8000 })).closest('section')!;
    expect(within(hr).getByRole('img', { name: /^Sleeping low HR \d+ beats per minute$/ })).toBeInTheDocument();
    expect(within(hr).getByText(/^Sleeping low HR · Near usual$/, { selector: '.lm-overflow__item' })).toBeInTheDocument();
    expect(within(hr).getByRole('img', { name: /^Heart rate overnight, \d\d:\d\d to \d\d:\d\d: starts at \d+, ends at \d+ bpm, lowest \d+, highest \d+, \d+ readings$/ })).toBeInTheDocument();
    // (Claude UI P3-11) one "low" per meaning: the percentile is the number, the mark is the lowest five minutes with its
    // clock, and the time to it is a fact of its own
    expect(hr.querySelector('.lmz-line__markword')!.textContent).toMatch(/^Lowest \d+ · \d\d:\d\d$/);
    expect(within(hr).getByText(/Time to lowest \d+ h \d\d$/, { selector: '.lm-overflow__item' })).toBeInTheDocument();
    expect(within(hr).queryByText('Time to low')).toBeNull();
    // (Codex UI #28) the average shows its reading count
    expect(within(hr).getByText(/^Avg \d+ bpm · \d+ readings · Time to lowest \d+ h \d\d$/, { selector: '.lm-overflow__item' })).toBeInTheDocument();
    // the trend is the foot's word, the usual range its right; the readings are in the (i)
    expect(within(hr).getByText(/^(Steady through the night|Rising|Falling)/)).toBeInTheDocument();
    expect(within(hr).getByText(/^Usual \d+–\d+ bpm$/)).toBeInTheDocument();
    expect(within(hr).queryByRole('button', { name: 'Table' })).toBeNull();
    fireEvent.click(within(hr).getByRole('button', { name: 'About Sleep heart rate' }));
    const panel = await screen.findByRole('dialog', { name: 'Heart rate while you slept' });
    expect(within(panel).getByRole('region', { name: 'Heart rate overnight table' })).toBeInTheDocument();
    expect(within(panel).getByText('Sleeping low HR')).toBeInTheDocument();
  });

  it('the four weeks: the average night as the number, a bar a night, the goal in the foot, no Indices card', async () => {
    renderAt('/ring/sleep');
    const history = (await screen.findByRole('heading', { level: 2, name: 'Sleep · last four weeks' }, { timeout: 8000 })).closest('section')!;
    // (Claude UI P3-11) durations in the person's voice ("7 h 30"), never decimal hours
    expect(within(history).getByRole('img', { name: /^Time asleep, average \d+ h( \d\d)?$/ })).toBeInTheDocument();
    expect(within(history).getByText(/^Avg · (28 nights|\d+ of 28 nights)$/)).toBeInTheDocument();
    expect(within(history).getByRole('img', { name: /^Time asleep, 28 days: latest \d+ h( \d\d)? on .*; average \d+ h( \d\d)?; highest .*; goal 8 h$/ })).toBeInTheDocument();
    expect(history.querySelectorAll('.lmz-bars__col').length).toBe(28);
    expect(within(history).getByText(/^Goal met \d+ of \d+ nights$/)).toBeInTheDocument();
    expect(within(history).getByText('Goal 8 h')).toBeInTheDocument();
    // the Indices card is gone (the Sleep index is one link under the night, the Recovery index is on Scores)
    expect(screen.queryByRole('heading', { name: 'Indices' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'What went into it' })).toBeNull();
    fireEvent.click(within(history).getByRole('button', { name: 'About Sleep · last four weeks' }));
    const panel = await screen.findByRole('dialog', { name: 'Sleep, last four weeks' });
    expect(within(panel).getByRole('region', { name: 'Time asleep table' })).toBeInTheDocument();
  });

  it('quiet mode: every Sleep card speaks words, no digit anywhere (text, names, values), the (i) panels too', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/ring/sleep');
    await screen.findByRole('heading', { level: 2, name: 'Last night' }, { timeout: 8000 });
    await waitFor(() => expect(within(card('Sleep heart rate')).getByText(/^Lowest in the /)).toBeInTheDocument());
    for (const n of ['Last night', 'Timing', 'Overnight', 'Sleep heart rate', 'Sleep · last four weeks']) expectWordsOnly(card(n));
    const history = card('Sleep · last four weeks');
    expect(within(history).queryByRole('img')).toBeNull();
    expect(history.textContent).toMatch(/nights? recorded/);
    expect(history.textContent).toMatch(/sleep goal\.|Nothing to show yet\./);
    // the times as parts of the day; the line is drawn without labels
    expect(within(card('Last night')).getByText(/^Fell asleep (in the|early|late)/)).toBeInTheDocument();
    expect(card('Sleep heart rate').querySelector('.lmz-line__markword')).toBeNull();
    // the (i) of every card carries no digit either, and the tables of numbers are left out
    for (const [n, title] of [['Last night', "Last night's sleep"], ['Timing', 'Sleep timing'], ['Overnight', 'Overnight signals'], ['Sleep heart rate', 'Heart rate while you slept'], ['Sleep · last four weeks', 'Sleep, last four weeks']] as const) {
      fireEvent.click(within(card(n)).getByRole('button', { name: `About ${n}` }));
      const panel = await screen.findByRole('dialog', { name: title });
      expect(panel.textContent, title).not.toMatch(/\d/);
      expect(within(panel).queryByRole('region', { name: /table$/ })).toBeNull();
      fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
    }
  });

  it('Sleep: "Add lights-out time" saves the D11 times and the time to fall asleep and efficiency appear', async () => {
    renderAt('/ring/sleep');
    const timing = (await screen.findByRole('heading', { name: 'Timing' }, { timeout: 8000 })).closest(
      'section',
    )!;
    fireEvent.click(within(timing).getByRole('button', { name: 'Add lights-out time' }));
    const lightsOut = await screen.findByLabelText('Lights out');
    fireEvent.change(lightsOut, { target: { value: '22:40' } });
    fireEvent.change(screen.getByLabelText('Out of bed'), { target: { value: '07:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await within(timing).findByText(/^Time to fall asleep \d+ min · Sleep efficiency \d+\s?% · From your times$/, { selector: '.lm-overflow__item' })).toBeInTheDocument();
    expect(within(timing).getByRole('button', { name: 'Change times' })).toBeInTheDocument();
  });


  it('Sleep: a lights-out save the command refuses keeps the editor open with the reason (Codex UI #18)', async () => {
    const def = getCommand('log.sleepTimes')!;
    defineCommand({
      ...def,
      execute: () => fail('invalid_input', 'That time is not on the night ending on that date.'),
    } as typeof def);
    try {
      renderAt('/ring/sleep');
      const timing = (await screen.findByRole('heading', { name: 'Timing' }, { timeout: 8000 })).closest(
        'section',
      )!;
      fireEvent.click(within(timing).getByRole('button', { name: 'Add lights-out time' }));
      fireEvent.change(await screen.findByLabelText('Lights out'), { target: { value: '22:40' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'That time is not on the night ending on that date.',
      );
      expect(screen.getByLabelText('Lights out')).toBeInTheDocument();
      expect(within(timing).queryByText(/^Time to fall asleep/)).toBeNull();
    } finally {
      defineCommand(def);
    }
  });


  it('Sleep while S2 learns the baseline: the learning line, Calibrating chips, no "vs usual"', async () => {
    setGaugeApi(makeGaugeFixture({ historyDays: 4 }));
    renderAt('/ring/sleep');
    const night = (await screen.findByRole('heading', { name: 'Last night' }, { timeout: 8000 })).closest(
      'section',
    )!;
    expect(await within(night).findByText(/^Learning your baseline · night \d of 7$/)).toBeInTheDocument();
    for (const n of ['Timing', 'Overnight', 'Sleep heart rate']) expect(within(card(n)).getByText(/^Calibrating · night \d of 7$/)).toBeInTheDocument();
    expect(screen.queryByText(/vs usual/)).toBeNull();
    // the usual forms: no usual window is drawn or promised (the sentence says "no usual" and the foot has no usual range)
    expect(within(card('Timing')).queryByText(/^Usual \d/)).toBeNull();
  });


  it('an older server without S2: the night from the legacy fields, the Sleep index labelled On-device (legacy), no timing, overnight or heart-rate cards', async () => {
    setGaugeApi(makeGaugeFixture({ v2: false }));
    renderAt('/ring/sleep');
    const night = (await screen.findByRole('heading', { level: 2, name: 'Last night' }, { timeout: 8000 })).closest('section')!;
    expect(await within(night).findByRole('meter', { name: 'Asleep' })).toBeInTheDocument();
    expect(await within(night).findByRole('link', { name: /On-device \(legacy\)$/ })).toHaveAttribute('href', '/ring/scores');
    expect(screen.queryByRole('heading', { level: 2, name: 'Timing' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Overnight' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Sleep heart rate' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Sleep · last four weeks' })).toBeInTheDocument();
  });

});

describe('/sleep', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    resetActivePlan();
    setGaugeApi(makeGaugeFixture());
    setRingCommands(commands());
  });
  afterEach(() => {
    setGaugeApi(null);
    setRingCommands(null);
  });

  // (r068 S07) one sleep page: /sleep opens Ring › Sleep (with its day strip) on the same night
  it('opens Ring › Sleep, the same sections, with or without a plan', async () => {
    renderAt('/sleep');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ring' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    for (const t of ['Last night', 'Timing', 'Overnight', 'Sleep heart rate', 'Sleep · last four weeks'])
      expect(await screen.findByRole('heading', { level: 2, name: t })).toBeInTheDocument();
  });

  it('takes a date to the same night on Ring › Sleep, and sends a future date to last night', async () => {
    const y = shiftDate(today, -1);
    const r1 = createMemoryRouter(routes, { initialEntries: [`/sleep/${y}`] });
    render(<RouterProvider router={r1} />);
    await waitFor(() => expect(`${r1.state.location.pathname}${r1.state.location.search}`).toBe(`/ring/sleep?date=${y}`));
    expect(
      await screen.findByRole('heading', { name: /^Night of / }, { timeout: 8000 }),
    ).toBeInTheDocument();
    const r = createMemoryRouter(routes, { initialEntries: [`/sleep/${shiftDate(today, 3)}`] });
    render(<RouterProvider router={r} />);
    await waitFor(() => expect(r.state.location.pathname).toBe('/ring/sleep'));
    expect(r.state.location.search).toBe('');
  });
});
