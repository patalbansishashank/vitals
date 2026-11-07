/**
 * Today's activity review and recording (energy SPEC §V4.1–§V4.3, A.3.5) on the real Today page over the screenshot
 * harness's day: (r070) no review strip or sheet, the activity sheet trimming a late stop, quiet mode without kcal, the hatched
 * "not counted yet" overlay and recording through Gauge.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/state/settingsStore';
import TodayPage from '../../today/TodayPage';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { ActivityDataProvider, type ActivityData } from '../data';
import { EnergyDayChart } from '../EnergyDayChart';
import { rangeOf } from '../energyFigures';
import { energyText } from '../model';
import { RecordBanner, resetLocalRecording } from '../RecordBanner';
import { NoticesRegion } from '@/app/shell/notices';
import { expectWordsOnly } from '@/features/living/__tests__/wordsOnly';
import { commandsFixture, dayFixture, fixtureActivityData } from '../../today/__screens__/fixtures';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const NOW = Date.parse(`${FIXTURE_TODAY}T13:00:00`);

function setup(o: { quiet?: boolean; scene?: 'pending' | 'recording' } = {}) {
  act(() =>
    useSettingsStore.getState().set({ todayCards: ['energy', 'steps', 'heart-points', 'activities'] }),
  );
  const f = dayFixture(FIXTURE_TODAY, NOW, o.scene ?? 'pending');
  const commands = commandsFixture(f);
  const data = fixtureActivityData(f, { quiet: !!o.quiet, commands });
  const spy = { edit: vi.spyOn(data, 'edit') };
  const h = renderLiving(
    <ActivityDataProvider value={data}>
      <TodayPage />
    </ActivityDataProvider>,
    { path: '/today', route: 'today' },
  );
  return { ...h, data, spy };
}

afterEach(() => {
  resetLocalRecording();
  act(() => useSettingsStore.getState().set({ todayCards: null }));
});

describe('Today shows activities, never a review (r070)', () => {
  it('has no strip, no "to review" and no Approve all; activities with nothing to count them yet read quietly in the list', async () => {
    setup();
    const face = await screen.findByRole('region', { name: 'Today’s activities' });
    expect(screen.queryByRole('region', { name: 'To review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/to review|Approve all/i);
    const rows = within(within(face).getByRole('list', { name: '' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2); // today's two (the third waits on yesterday)
    expect(
      within(face).getByRole('button', { name: /^Brisk walk, 07:05–07:50, not counted yet$/ }),
    ).toBeInTheDocument();
  });

  it('trims a late stop in the activity sheet and saves it as an edit', async () => {
    const { spy } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /^Brisk walk, 07:05–07:50/ }));
    const edit = await screen.findByRole('dialog', { name: 'Brisk walk' });
    expect(within(edit).getByText(/^Movement stopped at 07:44$/)).toBeInTheDocument();
    fireEvent.click(within(edit).getByRole('button', { name: 'End there' }));
    expect(within(edit).getByText(/07:05–07:44 · 39 min/)).toBeInTheDocument();
    expect(within(edit).getByText(/^\d+ Heart Points$/)).toBeInTheDocument();
    await act(async () => fireEvent.click(within(edit).getByRole('button', { name: 'Save' })));
    const input = spy.edit.mock.calls[0]![0];
    expect(input).toMatchObject({ id: 'WALKAM00000000000000000001' });
    expect(input.endAt).toBe(new Date(`${FIXTURE_TODAY}T07:44:00`).toISOString());
    expect(input.startAt).toBeUndefined();
  });

  it('quiet mode: full-width Steps keeps its chart and Heart Points its meter, with words-only text and aria', async () => {
    const { stub } = setup({ quiet: true });
    // the page's own quiet (the living view) as well as the activity data's
    await act(async () => void (await stub.actions.setQuietMode(true)));
    const noDigits = (el: Element, what: string) => {
      expect(el.textContent, what).not.toMatch(/\d/);
      for (const node of [el, ...el.querySelectorAll('*')])
        for (const attr of ['aria-label', 'aria-valuetext', 'aria-valuenow', 'aria-valuemax', 'title'])
          if (node.getAttribute(attr)) expect(node.getAttribute(attr), `${what} [${attr}]`).not.toMatch(/\d/);
    };
    const face = await screen.findByRole('region', { name: 'Today’s activities' });
    expect(within(face).queryByRole('region', { name: 'Energy' })).toBeNull();
    expect(face.textContent).not.toMatch(/kcal/);
    const steps = screen.getByRole('region', { name: 'Steps' });
    expect(steps).toHaveAttribute('data-size', 'card');
    expect(steps.closest('.lm-cardgrid__cell')).toHaveAttribute('data-span', '2');
    const chart = within(steps).getByRole('img', { name: 'Steps through the day, many days' });
    const barHeights = [...chart.querySelectorAll<HTMLElement>('.lmz-bars__bar')]
      .map((bar) => Number.parseFloat(bar.style.getPropertyValue('--h')));
    expect(barHeights.length).toBeGreaterThan(0);
    expect(barHeights.some((height) => height > 0)).toBe(true);
    expect(
      screen.getByRole('meter', { name: 'Heart Points (Fit-compatible estimate)' }),
    ).toBeInTheDocument();
    const hp = screen.getByRole('region', { name: 'Heart Points' });
    await waitFor(() => expect(hp).toHaveTextContent(/(on track|building|goal met) this week/));
    noDigits(hp, 'Heart Points');
    noDigits(steps, 'Steps');
  });

  // (0.6.3 INT) the rest of the quiet leaks: the activity rows' clock times, the activity sheet (its time, the trim line and
  // the zone chart) and Steps by source are words only too, aria included
  it('quiet mode: the whole Activity card, the activity sheet with its zones and Steps by source carry no digits', async () => {
    const { stub } = setup({ quiet: true });
    await act(async () => void (await stub.actions.setQuietMode(true)));
    const face = await screen.findByRole('region', { name: 'Today’s activities' });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Heart Points' })).toHaveTextContent(
        /(on track|building|goal met) this week/,
      ),
    );
    expectWordsOnly(face, 'Activity card');
    fireEvent.click(within(face).getByRole('button', { name: /^Brisk walk, early in the morning/ }));
    const edit = await screen.findByRole('dialog', { name: 'Brisk walk' });
    expect(within(edit).getByText('Movement stopped before the end')).toBeInTheDocument();
    const zones = within(edit).getByRole('list', { name: 'Heart rate' });
    expect(
      within(zones)
        .getAllByRole('listitem')
        .some((li) => /zone/i.test(li.textContent ?? '')),
    ).toBe(true);
    expectWordsOnly(edit, 'activity sheet');
  });

  it('quiet mode: Steps by source and its correction form are words only', async () => {
    const { stub } = setup({ quiet: true });
    await act(async () => void (await stub.actions.setQuietMode(true)));
    await screen.findByRole('region', { name: 'Today’s activities' });
    const chip = await screen.findByRole('button', { name: 'Steps by source' });
    fireEvent.click(chip);
    const panel = await screen.findByRole('dialog', { name: 'Steps by source' });
    expect(within(panel).queryByRole('button', { name: /table/i })).toBeNull();
    expectWordsOnly(panel, 'Steps by source');
  });

  it('keeps the complete approximate bedtime figure, primary range and plan figures in info', async () => {
    const { data } = setup();
    let view: ReturnType<ActivityData['useToday']> = null;
    function Probe() {
      view = data.useToday(FIXTURE_TODAY, true);
      return null;
    }
    render(<Probe />);
    const v = view!;
    const figures = v.model.energy!;
    const bedtime = energyText(figures.byBedtime);
    expect(bedtime).toBe('2,595');
    const energy = await screen.findByRole('region', { name: 'Energy' });
    const primaryRange = rangeOf(figures.soFar, v.day!.envelope, v.day!.total)!;
    expect(energy).toHaveTextContent(`Likely ${primaryRange.text}`);
    expect(energy.querySelector('.lm-cardfoot__right')!.textContent).toBe(`By bedtime ~${bedtime} kcal`);
    expect(screen.getByRole('link', { name: 'Energy' })).toHaveAttribute('href', '/energy');
    fireEvent.click(within(energy).getByRole('button', { name: 'About Energy' }));
    const info = await screen.findByRole('dialog', { name: 'Energy' });
    expect(info).toHaveTextContent('Estimated, with likely ranges.');
    const table = within(info).getByRole('table');
    for (const [label, value, day] of [
      ['Burned so far', figures.soFar, v.day!],
      ['Likely by bedtime', figures.byBedtime, v.day!],
      ['Planned burn', figures.plan!, v.plan!],
    ] as const) {
      const row = within(table).getByRole('row', { name: new RegExp(`^${label} `) });
      const range = rangeOf(value, day.envelope, day.total)!;
      expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
        energyText(value),
        range.text,
      ]);
    }
  });
});

describe('the energy chart', () => {
  it('hatches pending activities as "not counted yet" and says the chart in words', () => {
    const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
    const data: ActivityData = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
    let view: ReturnType<ActivityData['useToday']> = null;
    function Probe() {
      view = data.useToday(FIXTURE_TODAY, true);
      return null;
    }
    render(<Probe />);
    const v = view!;
    const { container } = render(
      <EnergyDayChart
        day={v.day!}
        nowMs={NOW}
        soFar={v.model.energy!.soFar}
        provisional={v.model.provisional}
      />,
    );
    expect(container.querySelectorAll('.lv-echart__pending')).toHaveLength(2);
    expect(container.querySelector('.lv-echart__legend')).toHaveTextContent(/Not counted yet$/);
    expect(
      screen.getByRole('img', {
        name: /^Energy through the day, estimated: .* so far, about .* by bedtime; .*food digestion \d+ \(modelled\)\.$/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ahead, as planned')).toBeInTheDocument();
  });
});

describe('recording through Gauge', () => {
  it('puts a recording in the one banner slot with Pause and Stop, and Stop ends it', async () => {
    const f = dayFixture(FIXTURE_TODAY, NOW, 'recording');
    const data = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
    render(
      <ActivityDataProvider value={data}>
        <NoticesRegion />
        <RecordBanner />
      </ActivityDataProvider>,
    );
    const banner = await screen.findByRole('region', { name: 'Notices' });
    await waitFor(() => expect(banner).toHaveTextContent(/Recording walk · \d+:\d\d:\d\d/));
    expect(within(banner).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await act(async () => fireEvent.click(within(banner).getByRole('button', { name: 'Stop' })));
    await waitFor(() => expect(screen.queryByText(/Recording walk/)).toBeNull(), { timeout: 4000 });
  });
});
