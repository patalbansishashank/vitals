import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { periodWindow } from '../../models';
import { DailyRange, type RangeDatum } from '../DailyRange';
import { DayLine } from '../DayLine';
import { NightRanges, zeroLabelSpot, type NightRangeDatum } from '../NightRanges';
import type { SlotGeometry } from '../DailyRange';
import { ZoneBar } from '../ZoneBar';
import { ZoneLine } from '../ZoneLine';
import { zoneModel } from '../zones';

const MIN = 60_000;
const from = Date.parse('2026-10-03T00:00:00Z');
const to = from + 24 * 60 * MIN;
const at = (h: number, m = 0) => from + (h * 60 + m) * MIN;
const z = zoneModel({ maxHr: 200 })!; // 100, 120, 140, 160, 180
/** 06:00–07:55 every 5 min, rising 60 → 152 bpm. */
const morning = Array.from({ length: 24 }, (_, i) => ({ t: at(6, i * 5), v: 60 + i * 4 }));

const plot = () => document.querySelector('.hr-plot') as HTMLElement;
const tip = () => document.querySelector('.hr-tip')?.textContent ?? null;

describe('ZoneLine (§7.4.2)', () => {
  it('draws the line in zone colours, the resting line and the labelled zone boundaries', () => {
    render(<ZoneLine points={morning} from={from} to={to} offsetS={0} zones={z} restingBpm={58} axis="clock" height={180} title="heart rate through the day" />);
    const zonesDrawn = new Set([...document.querySelectorAll('polyline.hr-line')].map((p) => p.getAttribute('data-zone')));
    expect([...zonesDrawn].sort()).toEqual(['0', '1', '2', '3']);
    expect(screen.getByText('resting 58')).toBeTruthy();
    expect(screen.getByText('zone 1 · 100')).toBeTruthy();
    expect(screen.getByText('zone 3 · 140')).toBeTruthy();
    // header readouts: resting · lowest (time) · highest (time) · readings
    expect(document.querySelector('[data-readouts]')!.textContent).toMatch(/^resting 58\sbpm · lowest 60\sbpm \(06:00\) · highest 152\sbpm \(07:55\) · 24 readings$/);
    // time in zones under the chart
    expect(screen.getByRole('img', { name: /Time in zones: zone 1 · easy/ })).toBeTruthy();
    expect(screen.queryByText(/Add your age/)).toBeNull();
    expect(plot().getAttribute('aria-label')).toMatch(/24 readings, from 06:00 to 07:55/);
  });

  it('no age: one plain cardio line and the age line, no zone bar', () => {
    render(<ZoneLine points={morning} from={from} to={to} offsetS={0} zones={null} axis="clock" height={180} title="hr" />);
    const lines = document.querySelectorAll('polyline.hr-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute('data-zone')).toBe('plain');
    expect(screen.getByText('Add your age in Your body to see effort zones.')).toBeTruthy();
    expect(document.querySelector('[data-zone-edge]')).toBeNull();
    expect(document.querySelector('.hr-zonebar')).toBeNull();
  });

  it('a gap breaks the line; nothing bridges it', () => {
    const later = Array.from({ length: 6 }, (_, i) => ({ t: at(14, i * 5), v: 70 }));
    render(<ZoneLine points={[...morning, ...later]} from={from} to={to} offsetS={0} zones={z} axis="clock" height={180} title="hr" />);
    const runs = new Set([...document.querySelectorAll('polyline.hr-line')].map((p) => p.getAttribute('data-run')));
    expect([...runs]).toEqual(['0', '1']);
  });

  it('empty day: the copy over the kept frame and axes', () => {
    render(<ZoneLine points={[]} from={from} to={to} offsetS={0} zones={z} axis="clock" height={180} title="hr" />);
    expect(screen.getByText('No heart-rate readings for this day.')).toBeTruthy();
    expect(document.querySelector('.hr-plot svg')).toBeTruthy();
    expect(document.querySelector('polyline')).toBeNull();
    expect(document.querySelector('[data-readouts]')!.textContent).toBe('no data');
  });

  it('today: data ends at now and the now-hand marks it; another day has none', () => {
    const { rerender } = render(<ZoneLine points={morning} from={from} to={to} offsetS={0} zones={z} axis="clock" now={at(7, 2)} height={180} title="hr" />);
    expect(document.querySelectorAll('[data-mark="now"]')).toHaveLength(1);
    expect(document.querySelector('[data-readouts]')!.textContent).toMatch(/13 readings/);
    rerender(<ZoneLine points={morning} from={from} to={to} offsetS={0} zones={z} axis="clock" height={180} title="hr" />);
    expect(document.querySelector('[data-mark="now"]')).toBeNull();
  });

  it('spot checks are dots in the table too', () => {
    render(<ZoneLine points={morning} spots={[{ t: at(12), v: 72 }]} from={from} to={to} offsetS={0} zones={z} axis="clock" height={180} title="hr" />);
    expect(document.querySelectorAll('[data-mark="spot"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Show .* data table$/ }));
    expect(screen.getByText('12:00 · spot check')).toBeTruthy();
  });

  it('crosshair readout with the keyboard: 5-minute steps, zone named', () => {
    render(<ZoneLine points={morning} from={from} to={to} offsetS={0} zones={z} restingBpm={58} axis="clock" height={180} title="hr" />);
    expect(plot()).toHaveAttribute('aria-description', expect.stringContaining('Left and Right Arrow'));
    fireEvent.focus(plot());
    expect(tip()).toMatch(/^07:55 · 152\sbpm · zone 3 · moderate$/);
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' });
    expect(tip()).toMatch(/^07:50 · 148\sbpm · zone 3 · moderate$/);
    fireEvent.keyDown(plot(), { key: 'ArrowLeft', shiftKey: true });
    expect(tip()).toMatch(/^07:15 · 120\sbpm · zone 2 · steady$/);
    fireEvent.keyDown(plot(), { key: 'Home' });
    expect(tip()).toMatch(/^00:00 · no readings$/);
  });

  it('workout window: minutes from start, no day readouts by default', () => {
    const start = at(18);
    const pts = Array.from({ length: 40 }, (_, i) => ({ t: start + i * MIN, v: 120 + i }));
    render(<ZoneLine points={pts} from={start} to={start + 40 * MIN} offsetS={0} zones={z} axis="minutes" height={160} title="heart rate during the workout" />);
    expect(screen.getByText('min')).toBeTruthy();
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-readouts]')).toBeNull();
    expect(document.querySelector('.hr-zonebar')).toBeNull();
    fireEvent.focus(plot());
    expect(tip()).toMatch(/^39 min · 159\sbpm · zone 3 · moderate$/);
  });
});

describe('ZoneBar', () => {
  it('labels segments wide enough and lists every zone in the table', () => {
    render(<ZoneBar minutes={[300, 30, 24, 10, 0, 1]} />);
    expect(screen.getByRole('img', { name: /zone 2 · steady 24\smin/ })).toBeTruthy();
    expect(screen.queryByText('zone 5 · 1\u2009min')).toBeNull();
    expect(document.querySelectorAll('.hr-zonebar__seg')).toHaveLength(4);
    expect(document.querySelector('[data-zone-label="2"]')!.textContent).toMatch(/zone 2.*24\smin/);
    expect(document.querySelector('[data-zone-label="5"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'time in zones table' }));
    const t = screen.getByRole('table');
    expect(within(t).getByText('zone 4 · hard')).toBeTruthy();
    expect(within(t).getByText('zone 5 · maximum')).toBeTruthy();
  });

  it('mini: 64 px, no labels, a text summary; nothing in zones → an empty well', () => {
    const { rerender } = render(<ZoneBar mini minutes={[0, 0, 12, 3, 0, 0]} />);
    expect(screen.getByRole('img', { name: /zone 2 · steady 12\smin, zone 3 · moderate 3\smin/ })).toBeTruthy();
    expect(document.querySelector('.hr-zonebar__label')).toBeNull();
    rerender(<ZoneBar mini minutes={[40, 0, 0, 0, 0, 0]} />);
    expect(screen.getByRole('img', { name: 'no time in zones' })).toBeTruthy();
    expect(document.querySelector('.hr-zonebar__well')).toBeTruthy();
  });

  it('full bar with nothing in zones renders nothing', () => {
    const { container } = render(<ZoneBar minutes={[30, 0, 0, 0, 0, 0]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('DailyRange (§7.4.5)', () => {
  const w = periodWindow('week', '2026-09-30', '2026-10-02'); // Mon 28 Sep – Sun 4 Oct, today Fri 2 Oct
  const data: RangeDatum[] = w.slots.map((s, i) => {
    const rec = i === 0 || i === 2 || i === 4;
    return { start: s.start, future: s.future, recorded: rec && !s.future, dot: rec ? 58 + i : null, lo: rec ? 48 : null, hi: rec ? 150 + i : null, readout: `${s.start} · x` };
  });

  it('missing days draw the stub, future days nothing, the line breaks at missing days', () => {
    render(<DailyRange window={w} data={data} unit="bpm" title="heart rate per day" summary="s" height={180} />);
    expect(document.querySelectorAll('[data-missing="true"]')).toHaveLength(2); // 29 Sep, 1 Oct (3, 4 Oct are future)
    expect(document.querySelectorAll('[data-mark="dot"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-mark="range"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-mark="dot-line"]')).toHaveLength(0);
    // week ticks: weekday letter over date
    expect(screen.getAllByText('M').length).toBeGreaterThan(0);
    expect(screen.getByText('28')).toBeTruthy();
  });

  it('Enter drills down into the slot under the crosshair; future slots never drill', () => {
    const onDrill = vi.fn();
    render(<DailyRange window={w} data={data} unit="bpm" title="t" summary="s" height={180} onDrill={onDrill} />);
    fireEvent.focus(plot());
    expect(tip()).toBe('2026-09-30 · x'); // home = the anchor
    fireEvent.keyDown(plot(), { key: 'ArrowRight' });
    fireEvent.keyDown(plot(), { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith(3);
    // End stops at today (Fri 2 Oct, slot 4): Enter drills there, never into 3 or 4 Oct
    fireEvent.keyDown(plot(), { key: 'End' });
    fireEvent.keyDown(plot(), { key: 'Enter' });
    expect(onDrill).toHaveBeenLastCalledWith(4);
    expect(onDrill).not.toHaveBeenCalledWith(5);
    expect(onDrill).not.toHaveBeenCalledWith(6);
  });

  it('the crosshair never enters a slot after today: End stops at today, → stays there', () => {
    render(<DailyRange window={w} data={data} unit="bpm" title="t" summary="s" height={180} />);
    fireEvent.focus(plot());
    fireEvent.keyDown(plot(), { key: 'End' });
    expect(tip()).toBe('2026-10-02 · x'); // Fri 2 Oct is today; 3 and 4 Oct are future
    fireEvent.keyDown(plot(), { key: 'ArrowRight' });
    expect(tip()).toBe('2026-10-02 · x');
    fireEvent.keyDown(plot(), { key: 'ArrowRight', shiftKey: true });
    expect(tip()).toBe('2026-10-02 · x');
    expect(screen.queryByText('2026-10-03 · x')).toBeNull();
  });
});

describe('NightRanges (§7.4.7)', () => {
  const w = periodWindow('week', '2026-09-30', '2026-10-04');
  const base = (i: number) => ({ start: w.slots[i]!.start, future: false, readout: 'r' });

  it('blood oxygen while the normal forms: fixed 85–100 % with ticks 90, 95, 100, range to the average dot, no zero line', () => {
    const data: NightRangeDatum[] = w.slots.map((_, i) => (i === 3 ? { ...base(i), recorded: false } : { ...base(i), recorded: true, avg: 96, lowest: 91 }));
    render(<NightRanges kind="spo2" window={w} data={data} title="blood oxygen per night" summary="s" height={140} />);
    for (const t of ['90', '95', '100']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.queryByText('85')).toBeNull();
    expect(document.querySelectorAll('[data-mark="dot"]')).toHaveLength(6);
    expect(document.querySelector('[data-mark="zero"]')).toBeNull();
    expect(document.querySelectorAll('[data-missing="true"]')).toHaveLength(1);
  });

  it('blood oxygen as change from normal: dots and ranges around "your normal", signed ticks, no absolute axis', () => {
    const data: NightRangeDatum[] = w.slots.map((_, i) => (i === 3 ? { ...base(i), recorded: false } : { ...base(i), recorded: true, avg: i % 2 ? -1 : 0.4, lowest: -5 }));
    render(<NightRanges kind="spo2" relative window={w} data={data} title="blood oxygen per night" summary="s" height={140} />);
    expect(screen.getByText('your normal')).toBeTruthy();
    expect(document.querySelectorAll('[data-mark="zero"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-mark="dot"]')).toHaveLength(6);
    expect(document.querySelectorAll('[data-mark="range"]')).toHaveLength(6);
    const ticks = [...document.querySelectorAll('.sg-tick')].map((e) => e.textContent);
    expect(ticks).toContain('0');
    expect(ticks).toContain('−2');
    for (const t of ['90', '95', '100']) expect(ticks).not.toContain(t);
    // the missing night's stub sits on the zero line
    const zeroY = Number(document.querySelector('[data-mark="zero"]')!.getAttribute('y1'));
    const stub = document.querySelector('[data-missing="true"]')!;
    expect(Math.abs(Number(stub.getAttribute('y')) + 4.5 - 2 - zeroY)).toBeLessThan(2);
  });

  it('"your normal" never sits behind a bar (J6-15): it moves beside the zero line to a clear spot', () => {
    // the last two nights go up, so the label goes under the line at the right
    const up: NightRangeDatum[] = w.slots.map((_, i) => ({ ...base(i), recorded: true, dev: i >= 5 ? 0.4 : -0.3 }));
    const { unmount } = render(<NightRanges kind="temp" unit="°C" window={w} data={up} title="skin temperature per night" summary="s" height={120} />);
    const zeroY = () => Number(document.querySelector('[data-mark="zero"]')!.getAttribute('y1'));
    const label = () => document.querySelector('[data-mark="zero-label"]')!;
    expect(Number(label().getAttribute('y'))).toBeGreaterThan(zeroY());
    expect(label().getAttribute('text-anchor')).toBe('end');
    unmount();
    // the last two go down: above the line, at the right
    const down: NightRangeDatum[] = w.slots.map((_, i) => ({ ...base(i), recorded: true, dev: i >= 5 ? -0.4 : 0.3 }));
    render(<NightRanges kind="temp" unit="°C" window={w} data={down} title="skin temperature per night" summary="s" height={120} />);
    expect(Number(label().getAttribute('y'))).toBeLessThan(zeroY());
    expect(label().getAttribute('text-anchor')).toBe('end');
    // the label is drawn after the columns, so nothing paints over it
    const kids = [...document.querySelector('.sg-svg')!.querySelectorAll('[data-mark="column"], [data-mark="zero-label"]')];
    expect(kids[kids.length - 1]!.getAttribute('data-mark')).toBe('zero-label');
  });

  it('zeroLabelSpot: right above, right below, left above, left below, else the top margin', () => {
    const g: SlotGeometry = { width: 390, height: 120, padL: 26, right: 386, top: 14, bottom: 90, slotW: 51, colW: 24, X: (i) => 26 + (i + 0.5) * 51, Y: (v) => 52 - v * 30 };
    const box = (x0: number, x1: number, top: number, bottom: number) => ({ x0, x1, top, bottom });
    expect(zeroLabelSpot(g, [])).toEqual({ x: 384, y: 48, anchor: 'end' });
    expect(zeroLabelSpot(g, [box(350, 374, 30, 52)])).toEqual({ x: 384, y: 64, anchor: 'end' });
    expect(zeroLabelSpot(g, [box(350, 374, 30, 70)])).toEqual({ x: 28, y: 48, anchor: 'start' });
    expect(zeroLabelSpot(g, [box(350, 374, 30, 70), box(30, 50, 30, 52)])).toEqual({ x: 28, y: 64, anchor: 'start' });
    expect(zeroLabelSpot(g, [box(350, 374, 30, 70), box(30, 50, 30, 70)])).toEqual({ x: 384, y: 11, anchor: 'end' });
  });

  it('skin temperature: columns up and down from the "your normal" line, stub on the zero line', () => {
    const data: NightRangeDatum[] = w.slots.map((_, i) => (i === 1 ? { ...base(i), recorded: false } : { ...base(i), recorded: true, dev: i % 2 ? -0.3 : 0.4 }));
    render(<NightRanges kind="temp" unit="°C" window={w} data={data} title="skin temperature per night" summary="s" height={140} />);
    expect(screen.getByText('your normal')).toBeTruthy();
    expect(document.querySelectorAll('[data-mark="column"][data-sign="up"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-mark="column"][data-sign="down"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-missing="true"]')).toHaveLength(1);
  });
});

describe('DayLine change from normal (§7.4.4)', () => {
  const bed = Date.parse('2026-10-02T23:00:00Z');
  const pts = [0, 10, 20, 30].map((m, i) => ({ t: bed + m * MIN, v: 34.2 + i * 0.1 }));

  it('draws value − normal around "your normal"; the absolute value only in the table', () => {
    render(<DayLine points={pts} from={bed} to={bed + 60 * MIN} offsetS={0} unit="°C" decimals={1} title="skin temperature at night" hue="recovery" empty="none" change={{ normal: 34.3 }} interactive />);
    expect(screen.getByText('your normal')).toBeTruthy();
    expect(document.querySelector('.lv-ring-note')!.textContent).toMatch(/−0\.1 to \+0\.2 °C/);
    expect(document.body.textContent).not.toMatch(/34\.5/);
    fireEvent.click(screen.getByRole('button', { name: /^Show .* data table$/ }));
    const t = screen.getByRole('table');
    expect(within(t).getByText('34.5')).toBeTruthy();
    expect(within(t).getByText('+0.2')).toBeTruthy();
  });

  it('a normal band behind the absolute line; keyboard crosshair over samples', () => {
    const sp = [0, 10, 20].map((m, i) => ({ t: bed + m * MIN, v: 95 + i }));
    render(<DayLine points={sp} from={bed} to={bed + 60 * MIN} offsetS={0} unit="%" title="blood oxygen at night" hue="recovery" empty="none" band={{ lo: 94, hi: 97 }} interactive />);
    expect(document.querySelector('[data-mark="normal"]')).toBeTruthy();
    const p = document.querySelector('.hr-dl-plot') as HTMLElement;
    fireEvent.focus(p);
    expect(tip()).toMatch(/^23:20 · 97\s%$/);
    fireEvent.keyDown(p, { key: 'ArrowLeft' });
    expect(tip()).toMatch(/^23:10 · 96\s%$/);
  });
});
