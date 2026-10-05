import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SeriesMetric, SignalsSource } from '../../data';
import { SignalsSourceProvider } from '../../data';
import { periodWindow } from '../../models';
import { GoalMeter } from '../GoalMeter';
import { HourBars } from '../HourBars';
import { DayColumns, type ColumnSlot } from '../DayColumns';
import { WorkoutsList } from '../WorkoutsList';
import { WorkoutSheet } from '../WorkoutSheet';
import { stepsByHour, type WorkoutItem } from '../activityModels';
import type { SeriesPoint } from '../ringData';
import { zoneModel } from '../zones';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const offsetAt = (t: number) => -new Date(t).getTimezoneOffset() * 60;
/** Text with the thin and no-break spaces of the Vitals number style read as plain spaces. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u2009\u00a0\u202f]/g, ' ');

function source(series: Partial<Record<SeriesMetric, SeriesPoint[]>> = {}): SignalsSource {
  return {
    subscribe: () => () => {},
    revision: () => 0,
    days: () => [],
    series: async (metric, fromMs, toMs) =>
      (series[metric] ?? []).filter((p) => p.t >= fromMs && p.t <= toMs),
    baselines: async () => [],
    firstDate: () => null,
    datesWithData: () => [],
    person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C' }),
    sourceInfo: () => ({ labels: [], lastReadAt: null }),
  };
}

const wrap = (ui: ReactNode, src: SignalsSource = source()) => (
  <MemoryRouter>
    <SignalsSourceProvider source={src}>{ui}</SignalsSourceProvider>
  </MemoryRouter>
);

describe('GoalMeter', () => {
  it('prints the scale, the goal tick labelled "goal 8 000" and the value with its unit', () => {
    const { container } = render(<GoalMeter label="steps" value={6420} goal={8000} unit="steps" />);
    expect(plain(container.querySelector('.ac-meter__value')?.textContent)).toBe('6 420 steps');
    const nums = [...container.querySelectorAll('.ac-meter__nums span')].map((n) => plain(n.textContent));
    expect(nums).toEqual(['0', '4 000', 'goal 8 000']);
    expect((container.querySelector('.ac-meter__bar') as HTMLElement).style.width).toBe('64.2%');
    expect((container.querySelector('.ac-meter__goal') as HTMLElement).style.left).toBe('80%');
    expect(container.querySelectorAll('.ac-meter__ticks line')).toHaveLength(12); // 13 ticks, the goal tick drawn on its own
    expect(plain(screen.getByRole('img').getAttribute('aria-label'))).toBe('steps: 6 420 steps, goal 8 000');
  });

  it('over the goal the bar runs past the goal tick, nothing else changes', () => {
    const { container } = render(<GoalMeter label="active minutes" value={60} goal={30} unit="min" />);
    const bar = parseFloat((container.querySelector('.ac-meter__bar') as HTMLElement).style.width);
    const goal = parseFloat((container.querySelector('.ac-meter__goal') as HTMLElement).style.left);
    expect(bar).toBeGreaterThan(goal);
    expect(bar).toBeLessThanOrEqual(100);
    expect(container.querySelector('.ac-meter')?.getAttribute('class')).toBe('ac-meter');
  });

  it('no goal: no goal tick, a line pointing to Plan', () => {
    const { container } = render(<GoalMeter label="active energy" value={280} unit="kcal" />);
    expect(container.querySelector('.ac-meter__goal')).toBeNull();
    expect(screen.getByText('No goal set. Set one in Plan.')).toBeTruthy();
    expect(container.querySelector('.ac-meter__bar')).toBeTruthy();
  });

  it('missing: an empty well and "no data yet today", never a zero bar', () => {
    const { container } = render(<GoalMeter label="steps" value={null} goal={8000} unit="steps" />);
    expect(screen.getByText('no data yet today')).toBeTruthy();
    expect(container.querySelector('.ac-meter__bar')).toBeNull();
    expect(container.querySelector('.ac-meter__goal')).toBeTruthy();
  });

  it('a recorded 0 shows 0 and no bar', () => {
    const { container } = render(<GoalMeter label="steps" value={0} goal={8000} unit="steps" />);
    expect(plain(container.querySelector('.ac-meter__value')?.textContent)).toBe('0 steps');
    expect(container.querySelector('.ac-meter__bar')).toBeNull();
  });

  it('mini: no numerals, the goal tick only, a text summary', () => {
    const { container } = render(<GoalMeter mini label="steps" value={6420} goal={8000} unit="steps" />);
    const m = container.querySelector('.ac-meter')!;
    expect(m.getAttribute('data-mini')).toBe('true');
    expect(m.textContent).toBe('');
    expect(container.querySelector('.ac-meter__nums')).toBeNull();
    expect(container.querySelector('.ac-meter__ticks')).toBeNull();
    expect(container.querySelector('.ac-meter__goal')).toBeTruthy();
    expect(plain(screen.getByRole('img').getAttribute('aria-label'))).toBe('steps: 6 420 steps, goal 8 000');
  });
});

describe('HourBars', () => {
  const pts = [
    { t: at(2026, 10, 1, 8, 10), v: 1200 },
    { t: at(2026, 10, 1, 9, 0), v: 0 },
    { t: at(2026, 10, 1, 11, 30), v: 800 },
  ];
  const hours = stepsByHour(pts, '2026-10-01', at(2026, 10, 1, 12, 30));

  it('a 0-step hour draws nothing above the baseline, a missing hour draws a stub, the future draws nothing', () => {
    const { container } = render(
      <HourBars
        hours={hours}
        bands={[{ from: at(2026, 10, 1), to: at(2026, 10, 1, 7) }]}
        summary="s"
        header="h"
      />,
    );
    expect(container.querySelector('path[data-hour="8"]')).toBeTruthy();
    expect(container.querySelector('path[data-hour="11"]')).toBeTruthy();
    expect(container.querySelector('path[data-hour="9"]')).toBeNull();
    const stubs = [...container.querySelectorAll('[data-missing="true"]')].map((s) => plain(s.textContent));
    // 00–07, 10 and 12 have no sample; 13–23 are after now
    expect(stubs).toHaveLength(10);
    expect(stubs).toContain('10:00 – 11:00 · no data');
    expect(stubs).not.toContain('09:00 – 10:00 · no data');
    expect(stubs.some((s) => s.startsWith('13:00'))).toBe(false);
    expect(container.querySelector('[data-band="sleep"]')).toBeTruthy();
    expect(screen.getByRole('group', { name: 's' })).toBeTruthy();
  });

  it('table twin lists every hour up to now, "no data" for missing and 0 for a recorded zero', () => {
    render(<HourBars hours={hours} bands={[]} summary="s" />);
    const tableButton = screen.getByRole('button', { name: /^Show .* data table$/ });
    fireEvent.click(tableButton);
    expect(screen.getByRole('button', { name: /^Hide .* data table$/ })).toHaveAttribute('aria-expanded', 'true');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(13);
    expect(plain(rows[9]!.textContent)).toBe('09:000 steps');
    expect(plain(rows[10]!.textContent)).toBe('10:00no data');
  });
});

describe('DayColumns', () => {
  const week = periodWindow('week', '2026-10-01', '2026-10-01');
  const values = [9000, null, 7000, 8500, null, null, null];
  const slots: ColumnSlot[] = week.slots.map((s, i) => ({
    start: s.start,
    value: values[i]!,
    future: s.future,
  }));
  const base = {
    title: 'steps per day',
    summary: 'sum',
    valueText: (v: number) => `${v} steps`,
    tableHead: ['date', 'steps'],
    emptyMax: 10_000,
  };

  it('week: a missing day stub, the goal line, the current week truncated at today, weekday letter over date', () => {
    const { container } = render(
      <DayColumns {...base} period="week" slots={slots} selected="2026-10-01" goal={8000} height={180} />,
    );
    expect(container.querySelectorAll('path.ac-col')).toHaveLength(3);
    expect(container.querySelectorAll('[data-missing="true"]')).toHaveLength(1);
    expect(plain(container.querySelector('.sg-goal-label')?.textContent)).toBe('goal 8 000');
    const ticks = [...container.querySelectorAll('.ac-xtick')].map((g) =>
      [...g.querySelectorAll('text')].map((t) => t.textContent).join('/'),
    );
    expect(ticks).toEqual(['M/28', 'T/29', 'W/30', 'T/1', 'F/2', 'S/3', 'S/4']);
    // nothing at the right reaches the label: it stays at the right, above the line
    expect(container.querySelector('.sg-goal-label')?.getAttribute('text-anchor')).toBe('end');
  });

  it('the goal label never sits on a column (J6-06): over the goal at the right, it moves to the left', () => {
    const past = periodWindow('week', '2026-09-21', '2026-10-01');
    const full: ColumnSlot[] = past.slots.map((s, i) => ({ start: s.start, value: [5000, 6000, 7000, 5000, 6000, 7000, 9500][i]!, future: s.future }));
    const { container } = render(<DayColumns {...base} period="week" slots={full} selected="2026-09-21" goal={8000} height={180} />);
    const label = container.querySelector('.sg-goal-label')!;
    const lineY = Number(container.querySelector('.sg-goal')!.getAttribute('y1'));
    expect(label.getAttribute('text-anchor')).toBe('start');
    expect(Number(label.getAttribute('x'))).toBeLessThan(60);
    expect(Number(label.getAttribute('y'))).toBeLessThan(lineY);
  });

  it('Enter on a slot drills down to that day; a tap on a future slot does nothing', () => {
    const onDrill = vi.fn();
    const { container } = render(
      <DayColumns
        {...base}
        period="week"
        slots={slots}
        selected="2026-10-01"
        height={180}
        onDrill={onDrill}
      />,
    );
    const plot = container.querySelector('.ac-plotarea') as HTMLElement;
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(plain(container.querySelector('.ac-xline')?.textContent)).toBe('Wed 30 Sep · 7000 steps');
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ start: '2026-09-30' }));
    fireEvent.keyDown(plot, { key: 'End' });
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it('month: date ticks 1, 8, 15, 22, 29 plus the selected date (neighbours step aside)', () => {
    const month = periodWindow('month', '2026-09-17', '2026-10-01');
    const ms = month.slots.map((s) => ({ start: s.start, value: null, future: s.future }));
    const { container } = render(
      <DayColumns {...base} period="month" slots={ms} selected="2026-09-17" height={180} />,
    );
    expect([...container.querySelectorAll('text.ac-xtick')].map((t) => t.textContent)).toEqual([
      '1',
      '8',
      '17',
      '22',
      '29',
    ]);
    expect(container.querySelector('text.ac-xtick[data-selected="true"]')?.textContent).toBe('17');
  });

  it('year: month letters with coverage numerals under each past column', () => {
    const year = periodWindow('year', '2026-10-01', '2026-10-01');
    const ys: ColumnSlot[] = year.slots.map((s, i) => ({
      start: s.start,
      value: i === 8 ? 7000 : null,
      future: s.future,
      coverage: s.future ? undefined : i === 8 ? '2/30' : '0/31',
    }));
    const { container } = render(
      <DayColumns {...base} period="year" slots={ys} selected="2026-10-01" height={180} />,
    );
    expect(container.querySelector('[data-coverage="2/30"]')).toBeTruthy();
    expect(container.querySelectorAll('.ac-cov')).toHaveLength(10);
    expect(container.querySelectorAll('[data-missing="true"]')).toHaveLength(9);
  });
});

const item = (
  id: string,
  date: string,
  start: number,
  minutes: number,
  extra: Partial<WorkoutItem> = {},
): WorkoutItem => ({
  id,
  date,
  start,
  end: start + minutes * 60_000,
  offsetS: offsetAt(start),
  type: 'running',
  durationS: minutes * 60,
  avgHr: 142,
  maxHr: 171,
  distanceM: 6100,
  activeKcal: 410,
  source: 'ring',
  ...extra,
});

describe('WorkoutsList', () => {
  const run = item('c', '2026-09-30', at(2026, 9, 30, 18, 5), 38);
  const walk = item('b', '2026-09-30', at(2026, 9, 30, 7, 0), 20, {
    type: 'walking',
    avgHr: null,
    distanceM: null,
    source: 'hand',
  });
  const gym = item('a', '2026-09-28', at(2026, 9, 28, 7, 0), 45, {
    type: 'strength_training',
    distanceM: null,
  });

  it('groups rows by day under an engraved header; each row carries type, time, duration, heart rate, distance and source', () => {
    const onOpen = vi.fn();
    const { container } = render(
      wrap(<WorkoutsList items={[run, walk, gym]} zones={null} onOpen={onOpen} logHref="/train#session" />),
    );
    const heads = [...container.querySelectorAll('.ac-wday__head')].map((h) => h.textContent);
    expect(heads).toEqual(['Wed 30 Sep', 'Mon 28 Sep']);
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(3);
    expect(plain(rows[0]!.textContent)).toContain('run');
    expect(plain(rows[0]!.textContent)).toContain('18:05');
    expect(plain(rows[0]!.textContent)).toContain('38 min');
    expect(plain(rows[0]!.textContent)).toContain('142 bpm');
    expect(plain(rows[0]!.textContent)).toContain('6.10 km');
    expect(plain(rows[0]!.textContent)).toContain('from your ring');
    expect(plain(rows[1]!.textContent)).toContain('logged by hand');
    expect(plain(rows[1]!.textContent)).not.toContain('km');
    fireEvent.click(rows[0]!);
    expect(onOpen).toHaveBeenCalledWith(run);
  });

  it('empty: one line and Log an activity', () => {
    render(wrap(<WorkoutsList items={[]} zones={null} onOpen={() => {}} logHref="/train#session" />));
    expect(screen.getByText('No workouts in this period.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Log an activity' }).getAttribute('href')).toBe('/train#session');
  });

  it('time in zones per row from one heart-rate read for the day', async () => {
    const z = zoneModel({ ageYears: 40 });
    const hr = Array.from({ length: 39 }, (_, i) => ({ t: run.start + i * 60_000, v: i < 20 ? 130 : 150 }));
    const src = source({ hr });
    const spy = vi.spyOn(src, 'series');
    const { container } = render(
      wrap(<WorkoutsList items={[run, walk]} zones={z} onOpen={() => {}} logHref="/train" />, src),
    );
    await waitFor(() => expect(container.querySelector('.ac-wrow__zones')).toBeTruthy());
    expect(container.querySelector('.ac-wrow__zones')?.getAttribute('data-minutes')).toBe('0,0,0,20,18,0');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('WorkoutSheet', () => {
  const run = item('c', '2026-09-30', at(2026, 9, 30, 18, 5), 38, { maxHr: null });

  it('opens with the title, the readouts and the source line; Correct goes to Settings › Devices', async () => {
    const hr = Array.from({ length: 39 }, (_, i) => ({ t: run.start + i * 60_000, v: i < 20 ? 130 : 160 }));
    render(
      wrap(
        <WorkoutSheet item={run} onClose={() => {}} zones={zoneModel({ ageYears: 40 })} />,
        source({ hr }),
      ),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Run · Wed 30 Sep · 18:05 – 18:43' });
    const text = plain(sheet.textContent);
    for (const label of ['duration', 'distance', 'average heart rate', 'highest heart rate', 'active energy'])
      expect(text).toContain(label);
    expect(text).toContain('38 min');
    expect(text).toContain('6.10');
    expect(text).toContain('From your ring.');
    // highest heart rate filled from the samples when the record has none
    await waitFor(() => expect(plain(sheet.textContent)).toContain('160'));
    await waitFor(() =>
      expect(sheet.querySelector('.ac-sheet__zones')?.getAttribute('data-minutes')).toBe('0,0,0,20,18,0'),
    );
    expect(within(sheet).getByRole('link', { name: 'Correct' }).getAttribute('href')).toBe(
      '/settings#devices',
    );
  });

  it('closed: nothing rendered', () => {
    render(wrap(<WorkoutSheet item={null} onClose={() => {}} zones={null} />));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
