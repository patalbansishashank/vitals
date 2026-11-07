/**
 * 0.6.3 S31 / A28: the kJ preference through Today's activity screens (display and entry; stored kcal), the gross /
 * above-rest labels, and quiet mode's words-only Heart Points (no digit in text or aria).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/state/settingsStore';
import type { ReviewRow } from '@/living/activityCandidates';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { ActivityDataProvider, type ActivityData } from '../data';
import { ActivitySheet, machineShown, machineStored } from '../ActivitySheet';
import { EnergyDayChart } from '../EnergyDayChart';
import { HeartPointsFill } from '../HeartPointsFill';
import {
  energySplit,
  heartPointsQuietText,
  spokenActive,
  spokenEnergy,
  energyColumns,
} from '../model';
import { commandsFixture, dayFixture, fixtureActivityData } from '../../today/__screens__/fixtures';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const NOW = Date.parse(`${FIXTURE_TODAY}T13:00:00`);
const WALK = 'WALKAM00000000000000000001';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
});
afterAll(() => vi.useRealTimers());
afterEach(() => act(() => useSettingsStore.getState().set({ energyUnit: 'kcal', quietMode: false })));

function fixture() {
  const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
  return fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
}

/** Every digit in an element's text and in its accessible attributes. */
function expectNoDigits(el: Element, what: string) {
  expect(el.textContent, what).not.toMatch(/\d/);
  for (const node of [el, ...el.querySelectorAll('*')])
    for (const attr of [
      'aria-label',
      'aria-valuetext',
      'aria-valuenow',
      'aria-valuemin',
      'aria-valuemax',
      'title',
      'alt',
    ]) {
      const v = node.getAttribute(attr);
      if (v) expect(v, `${what} [${attr}]`).not.toMatch(/\d/);
    }
}

describe('Heart Points in quiet mode', () => {
  it('says the week in words against the days so far', () => {
    expect(heartPointsQuietText(null)).toBe('No readings');
    expect(heartPointsQuietText(150, 2)).toBe('goal met this week');
    expect(heartPointsQuietText(80, 3)).toBe('on track this week');
    expect(heartPointsQuietText(40, 3)).toBe('building this week');
    expect(heartPointsQuietText(0, 1)).toBe('building this week');
  });
  it.each([
    [80, 12, 3, 'Heart Points: on track this week'],
    [40, 0, 5, 'Heart Points: building this week'],
    [210, 30, 6, 'Heart Points: goal met this week'],
    [null, null, 2, 'No readings'],
  ] as const)('week %s: "%s" and no digit in text or aria', (week, today, daysIn, words) => {
    const { container } = render(
      <HeartPointsFill
        week={week}
        today={today}
        pendingToday={week === null ? 0 : 12}
        daysIn={daysIn}
        quiet
      />,
    );
    expect(container).toHaveTextContent(words);
    // (r068 V22) nothing known: one line, no meter
    const meter = screen.queryByRole('meter', { name: 'Heart Points (Fit-compatible estimate)' });
    if (week === null) expect(meter).toBeNull();
    else expect(meter).not.toHaveAttribute('aria-valuenow');
    expectNoDigits(container, `Heart Points ${String(week)}`);
  });
  it('keeps its numbers outside quiet mode', () => {
    render(<HeartPointsFill week={80} today={12} quiet={false} />);
    expect(screen.getByText('12 today')).toBeInTheDocument();
  });
});

describe('the energy chart in kJ', () => {
  it('says its scale, legend, line and sentence in kJ, never kcal', () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    const data: ActivityData = fixture();
    let view: ReturnType<ActivityData['useToday']> = null;
    function Probe() {
      view = data.useToday(FIXTURE_TODAY, true);
      return null;
    }
    render(<Probe />);
    const v = view!;
    const { container } = render(<EnergyDayChart day={v.day!} nowMs={NOW} soFar={v.model.energy!.soFar} />);
    expect(container.querySelector('.lv-echart__scale')).toHaveTextContent(/kJ per 15 min$/);
    expect(container.querySelector('.lv-echart__legend')).toHaveTextContent(
      /Food digestion \d[\d,]* kJ/,
    );
    expect(
      screen.getByRole('img', { name: /^Energy through the day, estimated: \d[\d,]* kJ so far/ }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/kcal/);
    fireEvent.click(screen.getByRole('radio', { name: 'Active' }));
    expect(container.textContent).toMatch(/Active: \d[\d,]* kJ, above your resting burn/);
    expect(
      screen.getByRole('img', { name: /movement above your own rest, estimated: \d[\d,]* kJ so far/ }),
    ).toBeInTheDocument();
  });
  it('the spoken sentences convert (4.184 kJ per kcal)', () => {
    const cols = energyColumns(
      {
        bins15: [
          {
            start: 0,
            kcal: 100,
            stateBodyKcal: { resting: 90 },
            stateMin: { resting: 15 },
            components: { tef: 10, stepsEnergy: 50, neatBase: 0, exercise: 0 },
          },
        ],
      } as never,
      NOW,
    );
    expect(spokenEnergy(energySplit(cols), 100, 10, 'kJ')).toMatch(
      /420 kJ so far, about 420 by bedtime; resting 380.*food digestion 40 /,
    );
    expect(spokenActive(cols, 'kJ')).toMatch(/210 kJ so far/);
  });
});

describe('the activity sheet in kJ', () => {
  it('converts the machine’s number for entry both ways', () => {
    expect(machineShown(300, 'kJ')).toBe(1255);
    expect(machineStored(1000, 'kJ')).toBe(239);
    expect(machineShown(machineStored(1000, 'kJ'), 'kJ')).toBe(1000);
    expect(machineShown(300, 'kcal')).toBe(300);
    expect(machineStored(300, 'kcal')).toBe(300);
  });

  it('shows the booked gross figure in kJ, takes the machine’s kJ and saves kcal', async () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    const data = fixture();
    const edit = vi.spyOn(data, 'edit');
    function Host() {
      const m = data.useReview(FIXTURE_TODAY, FIXTURE_TODAY);
      const row = [...m.rows, ...m.decided].find((r) => r.id === WALK) ?? null;
      return <ActivitySheet row={row as ReviewRow | null} onClose={() => undefined} quiet={false} />;
    }
    renderLiving(
      <ActivityDataProvider value={data}>
        <Host />
      </ActivityDataProvider>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Brisk walk' });
    // the booked figure is labelled as the gross energy, in kJ
    expect(within(sheet).getByText('Burned')).toBeInTheDocument();
    expect(sheet.querySelector('.lv-asheet__big')).toHaveTextContent(/\d[\d\s]*\s?kJ/);
    expect(sheet.querySelector('.lv-asheet__estimate')).toHaveTextContent(/\d[\d\s]*–\d[\d\s]*/);
    expect(sheet.textContent).not.toMatch(/kcal/);
    const field = within(sheet).getByRole('spinbutton', { name: /kJ the machine showed|machine/i });
    fireEvent.change(field, { target: { value: '1000' } });
    fireEvent.blur(field);
    expect(field).toHaveValue('1000');
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: /^Save/ })));
    const input = edit.mock.calls[0]![0];
    // stored and sent in kcal: 1 000 kJ / 4.184
    expect(input.kcalOverride).toBe(239);
  });

  it('quiet: no minutes and no points’ number in the sheet', async () => {
    const data = fixture();
    function Host() {
      const m = data.useReview(FIXTURE_TODAY, FIXTURE_TODAY);
      const row = [...m.rows, ...m.decided].find((r) => r.id === WALK) ?? null;
      return <ActivitySheet row={row as ReviewRow | null} onClose={() => undefined} quiet />;
    }
    renderLiving(
      <ActivityDataProvider value={data}>
        <Host />
      </ActivityDataProvider>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Brisk walk' });
    expect(sheet.querySelector('.lv-asheet__when')!.textContent).not.toMatch(/min/);
    expect(within(sheet).queryByText(/^\d+ Heart Points/)).toBeNull();
    expect(
      within(sheet).getByText(/^(Earns|No) Heart Points$/),
    ).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/kcal|kJ/);
  });
});
