import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type {
  BioProvenance,
  DailyRecord,
  ResolvedDay,
  SleepRecord,
  WorkoutRecord,
} from '@/biometrics/core/types';
import { LivingClockContext, fixedClock } from '@/features/living/clock';
import { SignalsSourceProvider, type SeriesMetric, type SignalsPerson, type SignalsSource } from '../../data';
import { periodWindow, type PeriodKind } from '../../models';
import type { SeriesPoint } from '../../charts/ringData';
import { ActivityTab } from '../ActivityTab';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const offsetAt = (t: number) => -new Date(t).getTimezoneOffset() * 60;
const iso = (t: number) => new Date(t).toISOString();
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u2009\u00a0\u202f]/g, ' ');

const prov = (over: Partial<BioProvenance> = {}): BioProvenance => ({
  channel: 'ble:jstyle2301',
  recording_method: 'automatic',
  modality: 'sensed',
  ingested_at: '2026-10-01T00:00:00Z',
  device: { type: 'ring', tier: 'C' },
  ...over,
});
const quality = { validation: 'measured' as const, confidence: null, flags: [] };

function day(
  date: string,
  daily?: Partial<DailyRecord>,
  extra: Partial<Pick<ResolvedDay, 'workouts' | 'sleeps'>> = {},
): ResolvedDay {
  return {
    localDate: date,
    sleeps: extra.sleeps ?? [],
    workouts: extra.workouts ?? [],
    spots: [],
    sourceByMetric: {},
    tierByMetric: {},
    basisByMetric: {},
    corrections: [],
    ...(daily
      ? {
          daily: {
            kind: 'daily',
            record_id: `d-${date}`,
            version: 1,
            time: { tz_offset_s: 0, local_date: date },
            provenance: prov(),
            quality,
            ...daily,
          } as DailyRecord,
        }
      : {}),
  };
}

function workout(
  id: string,
  date: string,
  start: number,
  minutes: number,
  extra: Partial<WorkoutRecord> = {},
): WorkoutRecord {
  return {
    kind: 'workout',
    record_id: id,
    version: 1,
    exercise_type: 'running',
    active_duration_s: minutes * 60,
    time: {
      start: iso(start),
      end: iso(start + minutes * 60_000),
      tz_offset_s: offsetAt(start),
      local_date: date,
    },
    provenance: prov(),
    quality,
    ...extra,
  };
}

function night(date: string, from: number, to: number): SleepRecord {
  return {
    kind: 'sleep',
    record_id: `s-${date}`,
    version: 1,
    is_main: true,
    asleep_s: (to - from) / 1000,
    time: { start: iso(from), end: iso(to), tz_offset_s: offsetAt(from), local_date: date },
    provenance: prov(),
    quality,
  };
}

function source(
  days: ResolvedDay[],
  series: Partial<Record<SeriesMetric, SeriesPoint[]>> = {},
  person: Partial<SignalsPerson> = {},
): SignalsSource {
  return {
    subscribe: () => () => {},
    revision: () => 0,
    days: (from, to) => days.filter((d) => d.localDate >= from && d.localDate <= to),
    series: async (metric, fromMs, toMs) =>
      (series[metric] ?? []).filter((p) => p.t >= fromMs && p.t <= toMs),
    baselines: async () => [],
    firstDate: () => days[0]?.localDate ?? null,
    datesWithData: () => days.map((d) => d.localDate),
    person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C', ...person }),
    sourceInfo: () => ({ labels: ['J-Style 2301'], lastReadAt: null }),
  };
}

const TODAY = '2026-10-01'; // a Thursday: the current week runs on to Sun 4 Oct

function renderTab(kind: PeriodKind, anchor: string, src: SignalsSource, onDrill = vi.fn()) {
  const utils = render(
    <MemoryRouter>
      <LivingClockContext.Provider value={fixedClock('2026-10-01T14:30')}>
        <SignalsSourceProvider source={src}>
          <ActivityTab window={periodWindow(kind, anchor, TODAY)} today={TODAY} onDrill={onDrill} />
        </SignalsSourceProvider>
      </LivingClockContext.Provider>
    </MemoryRouter>,
  );
  return { ...utils, onDrill };
}

const face = (c: HTMLElement, name: string) => c.querySelector(`[data-face="${name}"]`) as HTMLElement;

describe('Activity tab › day', () => {
  const steps = [
    { t: at(2026, 10, 1, 8, 10), v: 700 },
    { t: at(2026, 10, 1, 8, 40), v: 500 },
    { t: at(2026, 10, 1, 9, 5), v: 0 },
    { t: at(2026, 10, 1, 11, 30), v: 800 },
    { t: at(2026, 10, 1, 13, 20), v: 500 },
    { t: at(2026, 10, 1, 14, 10), v: 300 },
  ];
  const run = workout('run-1', TODAY, at(2026, 10, 1, 7, 0), 30, { hr_avg_bpm: 140, distance_m: 5000 });
  const today = day(
    TODAY,
    { steps: 6420, distance_m: 4100, active_kcal: 280, active_min: { light: 20, moderate: 10, vigorous: 4 } },
    { workouts: [run], sleeps: [night(TODAY, at(2026, 9, 30, 23, 30), at(2026, 10, 1, 6, 30))] },
  );

  it('goal meters: steps and active minutes against their goals; active energy without a goal says so', () => {
    const { container } = renderTab(
      'day',
      TODAY,
      source([today], { steps }, { goals: { steps: 8000, activeMin: 30 } }),
    );
    const meters = [...face(container, 'goals').querySelectorAll('.ac-meter')];
    expect(meters).toHaveLength(3);
    expect(plain(meters[0]!.querySelector('.ac-meter__value')?.textContent)).toBe('6 420 steps');
    expect(plain(meters[0]!.textContent)).toContain('goal 8 000');
    expect(plain(meters[1]!.querySelector('.ac-meter__value')?.textContent)).toBe('34 min');
    expect(plain(meters[2]!.querySelector('.ac-meter__value')?.textContent)).toBe('280 kcal');
    expect(within(meters[2] as HTMLElement).getByText('No goal set. Set one in Plan.')).toBeTruthy();
  });

  it('steps by hour: a 0-step hour draws nothing, a missing hour a stub, sleep shaded, the readout line', async () => {
    const { container } = renderTab('day', TODAY, source([today], { steps }, { goals: { steps: 8000 } }));
    const hours = face(container, 'hours');
    await waitFor(() => expect(hours.querySelector('path[data-hour="8"]')).toBeTruthy());
    expect(hours.querySelector('path[data-hour="9"]')).toBeNull();
    const stubs = [...hours.querySelectorAll('[data-missing="true"]')].map((s) => plain(s.textContent));
    expect(stubs).toContain('10:00 – 11:00 · no data');
    expect(stubs).not.toContain('09:00 – 10:00 · no data');
    expect(stubs.some((s) => s.startsWith('15:00'))).toBe(false); // after now
    expect(hours.querySelector('[data-band="sleep"]')).toBeTruthy();
    expect(plain(hours.textContent)).toContain('6 420 steps · 4.1 km · 280 kcal active');
  });

  it('workouts that day and the numbers strip', async () => {
    const { container } = renderTab('day', TODAY, source([today], { steps }));
    const list = face(container, 'workouts');
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    const numbers = plain(face(container, 'numbers').textContent);
    expect(numbers).toContain('distance');
    expect(numbers).toContain('4.1');
    await waitFor(() => expect(face(container, 'hours').querySelector('path.ac-col')).toBeTruthy());
  });

  it('a day with nothing recorded: no data in the meters, stubs in every past hour, one line, no workouts + Log an activity', async () => {
    const { container } = renderTab('day', '2026-09-29', source([today]));
    const meters = face(container, 'goals');
    expect(within(meters).getAllByText('no data for this day')).toHaveLength(3);
    const hours = face(container, 'hours');
    await waitFor(() => expect(screen.getByText('No steps recorded on this day.')).toBeTruthy());
    expect(hours.querySelectorAll('[data-missing="true"]')).toHaveLength(24);
    expect(hours.querySelector('path.ac-col')).toBeNull();
    expect(within(face(container, 'workouts')).getByText('No workouts in this period.')).toBeTruthy();
    expect(
      within(face(container, 'workouts')).getByRole('link', { name: 'Log an activity' }).getAttribute('href'),
    ).toBe('/train#session');
  });
});

describe('Activity tab › week and month', () => {
  const ws = [
    day(
      '2026-09-28',
      { steps: 9000, active_min: { light: 30, moderate: 10, vigorous: 0 } },
      {
        workouts: [
          workout('gym', '2026-09-28', at(2026, 9, 28, 7), 45, { exercise_type: 'strength_training' }),
        ],
      },
    ),
    day(
      '2026-09-30',
      { steps: 7000, active_min: { light: 10, moderate: 5, vigorous: 0 } },
      {
        workouts: [
          workout('walk', '2026-09-30', at(2026, 9, 30, 7), 20, { exercise_type: 'walking' }),
          workout('run', '2026-09-30', at(2026, 9, 30, 18, 5), 38, {
            hr_avg_bpm: 142,
            distance_m: 6100,
            active_kcal: 410,
          }),
        ],
      },
    ),
    day('2026-10-01', { steps: 8500 }),
  ];

  it('week: a missing day stub, the goal line, the current week truncated at today, coverage and the goal count', () => {
    const { container } = renderTab('week', TODAY, source(ws, {}, { goals: { steps: 8000, activeMin: 30 } }));
    const steps = face(container, 'steps');
    expect(steps.querySelectorAll('path.ac-col')).toHaveLength(3);
    expect(steps.querySelectorAll('[data-missing="true"]')).toHaveLength(1); // Tue 29; Fri–Sun are future: nothing
    expect(plain(steps.querySelector('.sg-goal-label')?.textContent)).toBe('goal 8 000');
    const head = plain(steps.querySelector('.ac-head')?.textContent);
    expect(head).toContain('average 8 167 steps on 3 recorded days');
    expect(head).toContain('at goal on 2 of 3 recorded days');
    expect(head).toContain('3 of 4 days recorded');
    const active = face(container, 'active');
    expect(plain(active.querySelector('.sg-goal-label')?.textContent)).toBe('goal 30');
    expect(active.querySelectorAll('[data-missing="true"]')).toHaveLength(2);
  });

  it('a slot drills down to its day', () => {
    const { container, onDrill } = renderTab('week', TODAY, source(ws));
    const plot = face(container, 'steps').querySelector('.ac-plotarea') as HTMLElement;
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'Home' });
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith('day', '2026-09-28');
  });

  it('workouts list grouped by day; a row opens the sheet', async () => {
    const { container } = renderTab('week', TODAY, source(ws));
    const list = face(container, 'workouts');
    expect([...list.querySelectorAll('.ac-wday__head')].map((h) => h.textContent)).toEqual([
      'Wed 30 Sep',
      'Mon 28 Sep',
    ]);
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(3);
    fireEvent.click(rows[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'Run · Wed 30 Sep · 18:05 – 18:43' });
    expect(plain(sheet.textContent)).toContain('average heart rate');
    expect(plain(sheet.textContent)).toContain('142');
  });

  it('empty week keeps the frame with one line', () => {
    const { container } = renderTab('week', '2026-09-14', source(ws));
    const steps = face(container, 'steps');
    expect(within(steps).getByText('No steps recorded this week.')).toBeTruthy();
    expect(steps.querySelectorAll('[data-missing="true"]')).toHaveLength(7);
    expect(within(face(container, 'workouts')).getByText('No workouts in this period.')).toBeTruthy();
  });

  it('month: date ticks 1, 8, 15, 22, 29 with the selected date', () => {
    const { container } = renderTab('month', '2026-09-30', source(ws));
    const ticks = [...face(container, 'steps').querySelectorAll('text.ac-xtick')].map((t) => t.textContent);
    expect(ticks).toEqual(['1', '8', '15', '22', '30']);
    expect(plain(face(container, 'steps').querySelector('.ac-head')?.textContent)).toContain(
      '2 of 30 days recorded',
    );
  });
});

describe('Activity tab › year', () => {
  const ys = [
    day('2026-09-01', { steps: 6000 }),
    day('2026-09-02', { steps: 8000 }, { workouts: [workout('w', '2026-09-02', at(2026, 9, 2, 7), 30)] }),
    day('2026-10-01', { steps: 5000 }),
  ];

  it('monthly averages per recorded day with coverage numerals; a month drills down to the month', () => {
    const { container, onDrill } = renderTab('year', TODAY, source(ys));
    const steps = face(container, 'steps');
    expect(steps.querySelector('[data-coverage="2/30"]')).toBeTruthy();
    expect(steps.querySelector('[data-coverage="1/1"]')).toBeTruthy();
    expect(steps.querySelector('[data-coverage="0/31"]')).toBeTruthy();
    expect(steps.querySelectorAll('.ac-cov')).toHaveLength(10); // Nov and Dec are future
    expect(steps.querySelectorAll('path.ac-col')).toHaveLength(2);
    const plot = steps.querySelector('.ac-plotarea') as HTMLElement;
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(plain(steps.querySelector('.ac-xline')?.textContent)).toBe(
      'September 2026 · average 7 000 steps on 2 of 30 days',
    );
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith('month', '2026-09-01');
  });

  it('workouts per month as columns', () => {
    const { container } = renderTab('year', TODAY, source(ys));
    const w = face(container, 'workouts');
    expect(w.querySelectorAll('path.ac-col')).toHaveLength(1);
    expect(plain(w.textContent)).toContain('1 workout');
  });
});
