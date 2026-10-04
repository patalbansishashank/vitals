import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord, QualityFlag, ResolvedDay, SleepRecord, SleepStageName } from '@/biometrics/core/types';
import type { LocalDate } from '@/living';
import { SignalsSourceProvider, type SeriesMetric, type SignalBaseline, type SignalsPerson, type SignalsSource } from '../../data';
import type { SeriesPoint } from '../../charts/ringData';
import { periodWindow, type PeriodKind } from '../../models';
import { SleepTab } from '../SleepTab';

/* ---------------------------------------------------------------- fixtures (records at UTC+2) */
const OFF = 7200;
const MIN = 60_000;
const prov = { channel: 'ble:jstyle2301' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-01T00:00:00Z' };
const local = (s: string) => Date.parse(`${s}:00Z`) - OFF * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const ASLEEP = new Set<SleepStageName>(['deep', 'light', 'rem', 'asleep_unspecified']);

function rec(bed: string, durMin: number, stages: Array<[SleepStageName, number, number]>, o: { asleepMin?: number; flags?: QualityFlag[]; isMain?: boolean; id?: string } = {}): SleepRecord {
  const s = local(bed), e = s + durMin * MIN;
  const asleep = o.asleepMin ?? stages.filter(([st]) => ASLEEP.has(st)).reduce((a, [, x, y]) => a + y - x, 0);
  return {
    kind: 'sleep', record_id: o.id ?? `s-${bed}`, version: 1, is_main: o.isMain ?? true, asleep_s: asleep * 60,
    time: { start: iso(s), end: iso(e), tz_offset_s: OFF, local_date: new Date(e + OFF * 1000).toISOString().slice(0, 10) },
    provenance: prov, quality: { validation: 'vendor_proprietary', confidence: null, flags: o.flags ?? [] },
    stages: stages.map(([stage, a, b]) => ({ stage, start: iso(s + a * MIN), end: iso(s + b * MIN) })),
  };
}

/** 23:30 → 07:30 (+ extra): awake 15, deep 60, light 240, REM 90, unknown `x`, awake 45 → asleep 390 + x. */
const night = (bed: string, x = 0, flags: QualityFlag[] = []) =>
  rec(bed, 480 + x, [['awake', 0, 15], ['deep', 15, 75], ['light', 75, 315], ['rem', 315, 405], ['unknown', 405, 405 + x], ['awake', 405 + x, 480 + x]], { flags });

function day(date: string, sleeps: SleepRecord[], daily?: Partial<DailyRecord>): ResolvedDay {
  const mains = sleeps.filter((s) => s.is_main);
  const pool = mains.length ? mains : sleeps;
  return {
    localDate: date, sleeps, workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [],
    ...(pool.length ? { mainSleep: pool.reduce((a, b) => (b.asleep_s > a.asleep_s ? b : a)) } : {}),
    ...(daily ? { daily: { kind: 'daily', record_id: date, version: 1, time: { tz_offset_s: OFF, local_date: date }, provenance: prov, quality: { validation: 'measured', confidence: null, flags: [] }, ...daily } as DailyRecord } : {}),
  };
}

/** The night ending on `date` with a bed time of 23:30 the evening before. */
const nightOn = (date: string, x = 0, flags: QualityFlag[] = []) => {
  const prev = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return day(date, [night(`${prev}T23:30`, x, flags)]);
};

function source(days: ResolvedDay[], o: { series?: Partial<Record<SeriesMetric, SeriesPoint[]>>; baselines?: SignalBaseline[]; person?: Partial<SignalsPerson> } = {}): SignalsSource {
  return {
    subscribe: () => () => undefined,
    revision: () => 0,
    days: (from, to) => days.filter((d) => d.localDate >= from && d.localDate <= to),
    series: async (metric, fromMs, toMs) => (o.series?.[metric] ?? []).filter((p) => p.t >= fromMs && p.t <= toMs),
    baselines: async () => o.baselines ?? [],
    firstDate: () => days[0]?.localDate ?? null,
    datesWithData: () => days.map((d) => d.localDate),
    person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C', ...o.person }),
    sourceInfo: () => ({ labels: ['J-Style 2301'], lastReadAt: null }),
  };
}

function renderTab(kind: PeriodKind, anchor: LocalDate, today: LocalDate, src: SignalsSource) {
  const onDrill = vi.fn();
  const utils = render(
    <SignalsSourceProvider source={src}>
      <SleepTab window={periodWindow(kind, anchor, today)} today={today} onDrill={onDrill} />
    </SignalsSourceProvider>,
  );
  return { ...utils, onDrill };
}

/** Lets the series and baselines reads settle. */
const settle = () => act(async () => {});

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\u2009/g, ' ');

/* ---------------------------------------------------------------- day */

describe('sleep › day', () => {
  // HR every 5 min from 23:00 to 08:00 at 60, lowest 52 at 03:00; temperature every 30 min at 34.3 (normal 34.1)
  const bed = local('2026-10-03T23:30');
  const hr: SeriesPoint[] = [];
  for (let t = bed - 30 * MIN; t <= bed + 540 * MIN; t += 5 * MIN) hr.push({ t, v: t === local('2026-10-04T03:00') ? 52 : 60 });
  const temp: SeriesPoint[] = [];
  for (let t = bed - 30 * MIN; t <= bed + 540 * MIN; t += 30 * MIN) temp.push({ t, v: 34.3 });
  const baselines: SignalBaseline[] = [{ metric: 'skin_temp', unit: '°C', mean: 34.1, lo: 33.9, hi: 34.3, nights: 30, forming: false }];

  it('a night with unknown stages: hatched unknown row, unknown in the strip and table, lanes; an empty lane collapses', async () => {
    const { container } = renderTab('day', '2026-10-04', '2026-10-04', source([nightOn('2026-10-04', 30)], { series: { hr, skin_temp: temp }, baselines }));
    const strip = container.querySelector('.sl-summary')!;
    expect(text(strip.querySelector('[data-item="asleep"]'))).toMatch(/7 h/);
    expect(text(strip.querySelector('[data-item="unknown"]'))).toMatch(/30 min/);
    expect(text(strip.querySelector('[data-item="inbed"]'))).toMatch(/23:30 – 08:00/);
    const unknown = container.querySelector<SVGRectElement>('.sl-channels rect[data-stage="unknown"]')!;
    expect(unknown.style.fill).toMatch(/url\("?#sl-hatch/);
    // stage rows always five, unknown included
    expect(within(container.querySelector('.sl-channels')!).getByText('unknown', { selector: 'text' })).toBeTruthy();
    expect(await screen.findByText('no blood-oxygen readings this night')).toBeTruthy();
    expect(container.querySelector('[data-lane="spo2"][data-collapsed="true"]')).toBeTruthy();
    expect(screen.getByText('lowest 52')).toBeTruthy();
    expect(screen.getByText('your normal')).toBeTruthy();
    const minutes = container.querySelector('.sl-minutes table')!;
    expect(text(minutes.querySelector('tr[data-stage="unknown"]'))).toMatch(/unknown\s*30/);
    expect(text(minutes.querySelector('tr[data-stage="awake"]'))).toMatch(/not asleep/);
  });

  it('a night with only unknown stages says so and still draws the lanes', async () => {
    const r = rec('2026-10-03T23:30', 420, [['unknown', 0, 420]], { asleepMin: 0 });
    const { container } = renderTab('day', '2026-10-04', '2026-10-04', source([day('2026-10-04', [r])], { series: { hr } }));
    expect(screen.getByText('Your ring recorded when you slept but not the stages.')).toBeTruthy();
    expect(container.querySelectorAll('.sl-channels rect.lv-ring-stage')).toHaveLength(1);
    expect(container.querySelector('.sl-channels rect.lv-ring-stage')!.getAttribute('data-stage')).toBe('unknown');
    expect(await screen.findByText('lowest 52')).toBeTruthy();
    // missing is not zero: deep, light, REM and awake were not recorded
    const minutes = container.querySelector('.sl-minutes table')!;
    for (const s of ['deep', 'light', 'rem', 'awake']) expect(text(minutes.querySelector(`tr[data-stage="${s}"] td`))).toBe('no data');
    expect(text(minutes.querySelector('tr[data-stage="unknown"]'))).toMatch(/420\s*100 %/);
    expect(text(container.querySelector('[data-item="awake"]'))).toMatch(/no data/);
    expect(text(container.querySelector('.sl-minutes'))).not.toMatch(/\b0 %/);
  });

  it('a provisional night is dimmed and says it may still change', async () => {
    const { container } = renderTab('day', '2026-10-04', '2026-10-04', source([nightOn('2026-10-04', 0, ['provisional_stages'])]));
    await settle();
    expect(screen.getByText('Stages may still change: the ring hadn’t finished this night.')).toBeTruthy();
    expect(text(container.querySelector('[data-item="asleep"]'))).toMatch(/still changing/);
    expect(container.querySelector('.sl-channels .lv-ring-rows > g[opacity="0.6"]')).toBeTruthy();
  });

  it('a nap is listed under the night and not added to asleep', async () => {
    const nap = rec('2026-10-04T14:10', 30, [['light', 0, 30]], { isMain: false, id: 'nap' });
    const late = rec('2026-10-04T19:00', 200, [['light', 0, 200]], { isMain: false, id: 'late' });
    const { container } = renderTab('day', '2026-10-04', '2026-10-04', source([day('2026-10-04', [night('2026-10-03T23:30'), nap, late])]));
    await settle();
    const rows = [...container.querySelectorAll('.sl-naps li')].map(text);
    expect(rows).toEqual(['nap · 14:10 – 14:40 · 30 min', 'another sleep · 19:00 – 22:20 · 3 h 20 min']);
    expect(text(container.querySelector('[data-item="asleep"]'))).toMatch(/6 h 30 min/);
  });

  it('no night: the frame stays with empty rows and one line; the strip says no data', async () => {
    const { container } = renderTab('day', '2026-10-04', '2026-10-04', source([]));
    await settle();
    expect(screen.getAllByText('No night recorded.').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.sl-channels .lv-ring-rows text')).toHaveLength(5);
    expect(container.querySelectorAll('.sl-channels rect.lv-ring-stage')).toHaveLength(0);
    expect(text(container.querySelector('[data-item="asleep"]'))).toMatch(/no data/);
    expect(container.querySelector('.sl-minutes')).toBeNull();
  });

  it('crosshair: one readout through all lanes; ←/→ 5 min, ⇧ 30 min, Home/End', async () => {
    const { container } = renderTab('day', '2026-10-04', '2026-10-04', source([nightOn('2026-10-04', 30)], { series: { hr, skin_temp: temp }, baselines }));
    await screen.findByText('lowest 52');
    const plot = container.querySelector<HTMLElement>('.sl-channels .sl-plot')!;
    const readout = () => text(container.querySelector('.sl-channels .sl-readout'));
    fireEvent.focus(plot);
    expect(readout()).toBe('23:30 · awake · 60 bpm · +0.2 °C');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(readout()).toBe('23:35 · awake · 60 bpm · +0.2 °C');
    fireEvent.keyDown(plot, { key: 'ArrowRight', shiftKey: true });
    expect(readout()).toBe('00:05 · deep · 60 bpm · +0.2 °C');
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(readout()).toMatch(/^23:00 · 60 bpm/);
    fireEvent.keyDown(plot, { key: 'End' });
    expect(readout()).toMatch(/^08:25 · 60 bpm/);
    expect(container.querySelectorAll('.sl-channels .sl-dot')).toHaveLength(2);
  });

  it('shows the ring maker’s sleep score only when vendor scores are on', async () => {
    const d = day('2026-10-04', [night('2026-10-03T23:30')], { vendor: { sleep: 82 } });
    const off = renderTab('day', '2026-10-04', '2026-10-04', source([d]));
    await settle();
    expect(off.container.querySelector('[data-item="vendor"]')).toBeNull();
    off.unmount();
    const on = renderTab('day', '2026-10-04', '2026-10-04', source([d], { person: { vendorScores: true } }));
    await settle();
    expect(text(on.container.querySelector('[data-item="vendor"]'))).toMatch(/your ring says.*82.*their estimate/);
  });
});

/* ---------------------------------------------------------------- week / month / year */

describe('sleep › week and month', () => {
  const week = ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-03', '2026-10-04'];

  it('missing nights inside a week: stubs, excluded from the average, coverage counted', () => {
    const days = week.map((d, i) => nightOn(d, i === 4 ? 60 : 0));
    const { container } = renderTab('week', '2026-10-04', '2026-10-04', source(days));
    const bars = container.querySelector('.sl-bars')!;
    expect(text(bars)).toMatch(/5 of 7 nights recorded/);
    // (390 × 4 + 450) / 5 = 402 min over the 5 recorded nights only
    expect(text(bars)).toMatch(/average 6 h 42 asleep · average of 5 recorded nights/);
    expect(text(bars)).toMatch(/\(5 nights with stages\)/);
    expect(bars.querySelectorAll('[data-missing="true"]')).toHaveLength(2);
    expect(bars.querySelectorAll('.sl-col')).toHaveLength(5);
    expect(container.querySelector('.sl-window')!.querySelectorAll('[data-missing="true"]')).toHaveLength(2);
    expect(text(container.querySelector('[data-item="avg"]'))).toMatch(/6 h 42 min/);
  });

  it('missing nights inside a month', () => {
    const days: ResolvedDay[] = [];
    for (let d = 1; d <= 30; d++) if (![3, 9, 17, 24].includes(d)) days.push(nightOn(`2026-09-${String(d).padStart(2, '0')}`));
    const { container } = renderTab('month', '2026-09-15', '2026-10-04', source(days));
    const bars = container.querySelector('.sl-bars')!;
    expect(text(bars)).toMatch(/26 of 30 nights recorded/);
    expect(bars.querySelectorAll('[data-missing="true"]')).toHaveLength(4);
    expect(bars.querySelectorAll('.sl-col')).toHaveLength(26);
  });

  it('a period with no data keeps frame and axes, stubs every night and says so once per chart', () => {
    const { container } = renderTab('week', '2026-09-22', '2026-10-04', source([]));
    expect(screen.getAllByText('No sleep recorded this week.')).toHaveLength(2);
    expect(container.querySelector('.sl-bars')!.querySelectorAll('[data-missing="true"]')).toHaveLength(7);
    expect(container.querySelector('.sl-bars')!.querySelectorAll('.sg-tick').length).toBeGreaterThan(5);
    expect(text(container.querySelector('[data-item="avg"]'))).toMatch(/no data/);
  });

  it('the current week is truncated at today: future nights draw nothing and are not counted', () => {
    const { container } = renderTab('week', '2026-10-01', '2026-10-01', source([nightOn('2026-09-29'), nightOn('2026-10-01')]));
    const bars = container.querySelector('.sl-bars')!;
    expect(text(bars)).toMatch(/2 of 4 nights recorded/);
    expect(bars.querySelectorAll('[data-missing="true"]')).toHaveLength(2);
    expect(bars.querySelector('[data-date="2026-10-02"]')).toBeNull();
    // the axis still spans the whole week
    expect(within(bars as HTMLElement).getByText('4', { selector: 'text' })).toBeTruthy();
  });

  it('a provisional night is at 60 % and marked in the table', () => {
    const { container } = renderTab('week', '2026-10-04', '2026-10-04', source([nightOn('2026-10-03'), nightOn('2026-10-04', 0, ['provisional_stages'])]));
    const col = container.querySelector('.sl-bars [data-provisional="true"]')!;
    expect(col.getAttribute('opacity')).toBe('0.6');
    fireEvent.click(within(container.querySelector('.sl-bars') as HTMLElement).getByRole('button', { name: /^Show .* data table$/ }));
    expect(screen.getByText('Sun 4 Oct (still changing)')).toBeTruthy();
    expect(screen.getAllByText('no data').length).toBeGreaterThan(0);
  });

  it('crosshair snaps to nights and Enter drills down to the day', () => {
    const { container, onDrill } = renderTab('week', '2026-10-02', '2026-10-04', source(week.map((d) => nightOn(d))));
    const plot = container.querySelector<HTMLElement>('.sl-bars .sl-plot')!;
    fireEvent.focus(plot);
    expect(text(container.querySelector('.sl-bars .sl-readout'))).toMatch(/^Night to Fri 2 Oct · no data$/);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(text(container.querySelector('.sl-bars .sl-readout'))).toBe(
      'Night to Thu 1 Oct · 6 h 30 asleep · deep 1 h · light 4 h · REM 1 h 30 · unknown 0 min · awake 1 h 30 · in bed 23:30 – 07:30',
    );
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith('day', '2026-10-01');
  });

  it('goal line and a nap in the actogram and the numbers', () => {
    const nap = rec('2026-10-04T14:10', 30, [['light', 0, 30]], { isMain: false, id: 'nap' });
    const days = [nightOn('2026-10-03'), day('2026-10-04', [night('2026-10-03T23:30'), nap])];
    const { container } = renderTab('week', '2026-10-04', '2026-10-04', source(days, { person: { goals: { sleepH: 8 } } }));
    expect(text(container.querySelector('.sl-bars .sl-goal'))).toBe('goal 8 h');
    expect(container.querySelectorAll('.sl-window .sl-win-other[data-kind="nap"]')).toHaveLength(1);
    expect(text(container.querySelector('.sl-window'))).toMatch(/usually 23:30/);
    expect(text(container.querySelector('[data-item="naps"]'))).toMatch(/naps\s*1/);
  });
});

describe('sleep › year', () => {
  it('monthly columns with coverage numerals, stubs for empty months, nothing for future months; Enter opens the month', () => {
    const days = [nightOn('2026-09-29'), nightOn('2026-09-30', 0, ['provisional_stages']), nightOn('2026-10-01')];
    const { container, onDrill } = renderTab('year', '2026-10-02', '2026-10-02', source(days));
    const bars = container.querySelector('.sl-bars')!;
    expect(within(bars as HTMLElement).getByText('2/30')).toBeTruthy();
    expect(within(bars as HTMLElement).getByText('1/2')).toBeTruthy();
    expect(within(bars as HTMLElement).getAllByText('0/31')).toHaveLength(5);
    expect(bars.querySelectorAll('[data-missing="true"]')).toHaveLength(8);
    expect(bars.querySelectorAll('.sl-col')).toHaveLength(2);
    expect(text(bars)).toMatch(/3 of 275 nights recorded/);
    const plot = bars.querySelector<HTMLElement>('.sl-plot')!;
    fireEvent.focus(plot);
    expect(text(bars.querySelector('.sl-readout'))).toMatch(/^October 2026 · average 6 h 30 asleep · 1 of 2 nights recorded · deep 1 h/);
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith('month', '2026-10-01');
    expect(text(container.querySelector('[data-item="nights"]'))).toMatch(/3 of 275/);
  });
});
