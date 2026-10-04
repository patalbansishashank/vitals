import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QualityFlag, ResolvedDay, SleepRecord, SleepStageName } from '@/biometrics/core/types';
import { periodWindow } from '../../models';
import { NapList } from '../NapList';
import { NightChannels, type LaneData } from '../NightChannels';
import { NightSummary } from '../NightSummary';
import { SleepWindow } from '../SleepWindow';
import { StageBars } from '../StageBars';
import { StageMinutes } from '../StageMinutes';
import { nightColumns, sleepDay, sleepDayMap, sleepNight, sleepStats, type NightColumn } from '../sleepModels';

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
const night = (bed: string, x = 0) => rec(bed, 480 + x, [['awake', 0, 15], ['deep', 15, 75], ['light', 75, 315], ['rem', 315, 405], ['unknown', 405, 405 + x], ['awake', 405 + x, 480 + x]]);
const day = (date: string, sleeps: SleepRecord[]): ResolvedDay => ({
  localDate: date, sleeps, workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [],
  ...(sleeps.length ? { mainSleep: sleeps.find((s) => s.is_main) ?? sleeps[0]! } : {}),
});
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\u2009/g, ' ');
const ready = (points: LaneData['points'] = []): LaneData => ({ status: 'ready', points });

/* ---------------------------------------------------------------- night channels */

describe('NightChannels', () => {
  const n = sleepNight(night('2026-10-03T23:30', 30));
  const base = { night: n, date: '2026-10-04' as const, tempUnit: 'C' as const, spo2NormalPct: null, tempNormalC: 34.1 };

  it('reading lanes keep their height and say so; failed lanes offer Try again', () => {
    const retry = vi.fn();
    render(<NightChannels {...base} hr={{ status: 'loading', points: [] }} spo2={{ status: 'failed', points: [], retry }} temp={ready()} />);
    expect(screen.getByText('reading…')).toBeTruthy();
    expect(document.querySelector('[data-lane="hr"][data-status="loading"]')).toBeTruthy();
    expect(screen.getByText('these readings couldn’t be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByText('no skin-temperature readings this night')).toBeTruthy();
  });

  it('temperature without a known normal is not shown as an absolute number', () => {
    render(<NightChannels {...base} tempNormalC={null} hr={ready()} spo2={ready()} temp={ready([{ t: n.bed! + 60 * MIN, v: 34.4 }])} />);
    expect(screen.getByText('skin temperature: your normal is not known yet')).toBeTruthy();
    expect(screen.queryByText(/34\.4/)).toBeNull();
  });

  it('°F: change from normal in Fahrenheit, blood oxygen as change from its normal, breaks over gaps', () => {
    const t = (m: number) => n.bed! + m * MIN;
    const spo2 = [0, 5, 10, 120, 125, 130].map((m) => ({ t: t(m), v: 95 }));
    const temp = [0, 30, 60].map((m) => ({ t: t(m), v: 34.6 }));
    const { container } = render(<NightChannels {...base} tempUnit="F" spo2NormalPct={97} hr={ready()} spo2={ready(spo2)} temp={ready(temp)} />);
    expect(screen.getByText('skin temperature · °F')).toBeTruthy();
    expect(container.querySelectorAll('[data-lane="spo2"] polyline')).toHaveLength(2);
    expect(screen.getByText('Breaks in a line are times with no readings.')).toBeTruthy();
    // both tier C lanes have a "your normal" zero line; blood oxygen ticks are signed changes, never 95
    const spo2Lane = container.querySelector('.sl-lane[data-lane="spo2"]')!;
    expect(within(spo2Lane as HTMLElement).getByText('your normal')).toBeTruthy();
    expect(spo2Lane.querySelector('line.sg-axis')).toBeTruthy();
    const ticks = [...spo2Lane.querySelectorAll('.sg-tick')].map((e) => e.textContent);
    expect(ticks).toContain('0');
    expect(ticks.some((x) => /^95$|^9\d$/.test(x ?? ''))).toBe(false);
    expect(screen.getAllByText('your normal')).toHaveLength(2);
    const plot = container.querySelector<HTMLElement>('.sl-plot')!;
    fireEvent.focus(plot);
    // 95 % against a 97 % normal = −2 %; +0.5 °C from normal = +0.9 °F
    expect(text(container.querySelector('.sl-readout'))).toBe('23:30 · awake · −2 % · +0.9 °F');
    expect(plot.getAttribute('aria-label')).toMatch(/blood oxygen −2 to −2\s% from your normal/);
    // the table twin keeps the absolute value
    fireEvent.click(screen.getByRole('button', { name: /^Show .* data table$/ }));
    const buckets = screen.getAllByRole('table')[1]!;
    expect(text(within(buckets).getAllByRole('row')[1]!)).toContain('95');
  });

  it('blood oxygen while its normal forms: the absolute line, no zero line', () => {
    const spo2 = [0, 5, 10].map((m) => ({ t: n.bed! + m * MIN, v: 95 }));
    const { container } = render(<NightChannels {...base} hr={ready()} spo2={ready(spo2)} temp={ready()} />);
    const spo2Lane = container.querySelector('.sl-lane[data-lane="spo2"]') as HTMLElement;
    expect(within(spo2Lane).queryByText('your normal')).toBeNull();
    fireEvent.focus(container.querySelector<HTMLElement>('.sl-plot')!);
    expect(text(container.querySelector('.sl-readout'))).toBe('23:30 · awake · 95 %');
  });

  it('table twin: stages, then one row per 5 minutes of the night', () => {
    render(<NightChannels {...base} hr={ready([{ t: n.bed!, v: 58 }])} spo2={ready()} temp={ready()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Show .* data table$/ }));
    const [stages, buckets] = screen.getAllByRole('table');
    expect(within(stages!).getAllByRole('row')).toHaveLength(1 + 6);
    // 23:30 → 08:00 = 102 five-minute rows
    expect(within(buckets!).getAllByRole('row')).toHaveLength(1 + 102);
    expect(within(buckets!).getAllByRole('row')[1]!.textContent).toBe('23:30awake58no datano data');
  });

  it('no night: empty rows, no focus stop, one line', () => {
    const { container } = render(<NightChannels {...base} night={null} hr={ready()} spo2={ready()} temp={ready()} />);
    expect(screen.getByText('No night recorded.')).toBeTruthy();
    expect(container.querySelector('.sl-plot')!.getAttribute('tabindex')).toBeNull();
    expect(container.querySelectorAll('[data-lane]')).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------- stage bars */

describe('StageBars', () => {
  const w = periodWindow('week', '2026-10-04', '2026-10-04');
  const zero = rec('2026-10-01T23:30', 30, [['awake', 0, 30]], { id: 'zero' }); // a record that says 0 asleep
  const days = [day('2026-09-29', [night('2026-09-28T23:30', 30)]), day('2026-10-02', [zero]), day('2026-10-04', [night('2026-10-03T23:30', 10)])];
  const cols = nightColumns(w, sleepDayMap(days));
  const stats = sleepStats(cols.map((c) => c.night), 7);

  it('stacks deep, light, REM, unknown bottom to top; unknown hatched; zero draws nothing above the baseline', () => {
    const { container } = render(<StageBars kind="week" anchor="2026-10-04" nights={cols} stats={stats} onDrill={() => {}} />);
    const col = container.querySelector('[data-date="2026-09-29"]')!;
    const segs = [...col.querySelectorAll('[data-stage]')];
    expect(segs.map((s) => s.getAttribute('data-stage'))).toEqual(['deep', 'light', 'rem', 'unknown']);
    const top = (el: Element) => Number(el.getAttribute('y') ?? /V([\d.]+)/.exec(el.getAttribute('d') ?? '')?.[1]);
    expect(top(segs[0]!)).toBeGreaterThan(top(segs[1]!));
    expect((segs[3] as SVGElement).style.fill).toMatch(/url\("?#sl-hatch/);
    // the zero night: recorded (no stub), nothing drawn
    expect(container.querySelector('[data-date="2026-10-02"]')!.querySelectorAll('[data-stage]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-missing="true"]')).toHaveLength(4);
  });

  it('hours axis: next whole hour, 2 h ticks, no goal line without a goal', () => {
    const { container } = render(<StageBars kind="week" anchor="2026-10-04" nights={cols} stats={stats} onDrill={() => {}} />);
    const ticks = [...container.querySelectorAll('.sg-tick')].map(text);
    // longest 7 h 00 → ceiling 8 h (7.7 → 8): ticks 0 … 8 h, nothing above
    expect(ticks).toEqual(expect.arrayContaining(['0', '2 h', '4 h', '6 h', '8 h']));
    expect(ticks).not.toContain('10 h');
    expect(container.querySelector('.sl-goal')).toBeNull();
  });

  it('Space or Enter on a night drills down to the day', () => {
    const onDrill = vi.fn();
    const { container } = render(<StageBars kind="week" anchor="2026-10-04" nights={cols} stats={stats} onDrill={onDrill} />);
    const plot = container.querySelector<HTMLElement>('.sl-plot')!;
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(text(container.querySelector('.sl-readout'))).toBe('Night to Mon 28 Sep · no data');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.keyDown(plot, { key: ' ' });
    expect(onDrill).toHaveBeenCalledWith('day', '2026-09-29');
  });
});

/* ---------------------------------------------------------------- when you slept */

describe('SleepWindow', () => {
  it('nights as bars, missing as a stub at the top, naps in ink-3, usual bed and wake lines', () => {
    const w = periodWindow('week', '2026-10-04', '2026-10-04');
    const nap = rec('2026-09-29T14:10', 30, [['light', 0, 30]], { isMain: false, id: 'nap' });
    const days = [day('2026-09-29', [night('2026-09-28T23:30'), nap]), day('2026-09-30', [night('2026-09-29T23:50')]), day('2026-10-01', [night('2026-09-30T23:40')])];
    const cols: NightColumn[] = nightColumns(w, sleepDayMap(days));
    const stats = sleepStats(cols.map((c) => c.night), 7, 1);
    const { container } = render(<SleepWindow kind="week" anchor="2026-10-04" nights={cols} stats={stats} onDrill={() => {}} />);
    expect(container.querySelectorAll('.sl-win-night')).toHaveLength(3);
    expect(container.querySelectorAll('.sl-win-other[data-kind="nap"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-missing="true"]')).toHaveLength(4);
    expect(screen.getByText('usually 23:40')).toBeTruthy();
    expect(screen.getByText('usually 07:40')).toBeTruthy();
    expect(text(container.querySelector('.sl-head'))).toMatch(/usually in bed 23:40 \u2013 07:40/);
    // the stub sits at the top of the plot
    const stub = container.querySelector('[data-missing="true"]')!;
    expect(Number(stub.getAttribute('y'))).toBeLessThan(10);
  });
});

/* ---------------------------------------------------------------- strip, stage minutes, naps */

describe('NightSummary, StageMinutes, NapList', () => {
  it('summary: unknown only when there is some; no night reads no data', () => {
    const { container, rerender } = render(<NightSummary night={sleepNight(night('2026-10-03T23:30'))} vendorSleep={null} showVendor />);
    expect(container.querySelector('[data-item="unknown"]')).toBeNull();
    expect(text(container.querySelector('[data-item="awake"]'))).toMatch(/1 h 30 min/);
    rerender(<NightSummary night={null} vendorSleep={80} showVendor={false} />);
    expect(container.querySelectorAll('[data-item]')).toHaveLength(3);
    expect(text(container)).not.toMatch(/0 min/);
    expect(container.querySelector('[data-item="vendor"]')).toBeNull();
  });

  it('stage minutes: deep, light, REM, then awake and unknown; shares of asleep add to 100', () => {
    const { container } = render(<StageMinutes night={sleepNight(night('2026-10-03T23:30', 30))} />);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-stage'))).toEqual(['deep', 'light', 'rem', 'awake', 'unknown']);
    expect(rows[3]!.className).toBe('sl-sep');
    const pct = rows.filter((r) => r.getAttribute('data-stage') !== 'awake').map((r) => Number(/(\d+)\s%/.exec(text(r.querySelectorAll('td')[1]!))![1]));
    expect(pct.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('naps and another sleep', () => {
    const d = sleepDay(day('2026-10-04', [night('2026-10-03T23:30'), rec('2026-10-04T14:10', 30, [['light', 0, 30]], { isMain: false, id: 'n' }), rec('2026-10-04T03:00', 60, [['light', 0, 60]], { isMain: false, id: 'a' })]));
    const { container } = render(<NapList others={d.others} />);
    expect([...container.querySelectorAll('li')].map(text)).toEqual(['another sleep · 03:00 – 04:00 · 1 h', 'nap · 14:10 – 14:40 · 30 min']);
  });
});
