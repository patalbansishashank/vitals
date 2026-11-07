/**
 * GlowLine (r071): the pure geometry, the spoken sentence and the table twin; the roles, quiet mode, the states, the
 * keyboard; and the final markup being the same with `animate` on and off.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlowLine, lineModel, linePoints, lineTicks, lineTwin, lineXTicks, spokenLine, type GlowLineProps } from '../GlowLine';
import { fakeMotion } from './motionHelpers';

const T = (hhmm: string, day = '2026-10-30') => Date.parse(`${day}T${hhmm}:00Z`);
const TZ = 'UTC';
const text = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.lmz-sr').forEach((n) => n.remove());
  return c.textContent ?? '';
};
/** innerHTML with the generated ids made equal, so two mounts can be compared. */
const normal = (container: HTMLElement) => {
  let html = container.innerHTML;
  for (const id of new Set([...container.querySelectorAll('[id]')].map((n) => n.id))) html = html.split(id).join('ID');
  return html;
};

// a day's burn: cumulative kcal every two hours up to 14:00, the end at 14:58
const SERIES = [
  { t: T('00:00'), v: 0 },
  { t: T('02:00'), v: 120 },
  { t: T('04:00'), v: 250 },
  { t: T('06:00'), v: 380 },
  { t: T('08:00'), v: 560 },
  { t: T('10:00'), v: 760 },
  { t: T('12:00'), v: 940 },
  { t: T('14:58'), v: 1096 },
];
const FUTURE = [{ t: T('20:00'), v: 1900 }, { t: T('23:59'), v: 2595 }];
const BASE: GlowLineProps = { label: 'Energy burned', unit: 'kcal', series: SERIES, from: T('00:00'), to: T('00:00', '2026-10-31'), now: T('14:58'), future: FUTURE, tz: TZ, yTicks: 0 };

afterEach(() => document.documentElement.removeAttribute('data-motion'));

describe('lineTicks and linePoints', () => {
  it('lineTicks picks evenly spaced nice values that cover the data and sets the domain to them', () => {
    expect(lineTicks(0, 100, 3)).toEqual({ ticks: [0, 50, 100], domain: [0, 100] });
    expect(lineTicks(43, 97, 3).ticks).toEqual([0, 50, 100]);
    expect(lineTicks(1096, 2595, 3).domain[0]).toBeLessThanOrEqual(1096);
    expect(lineTicks(1096, 2595, 3).domain[1]).toBeGreaterThanOrEqual(2595);
  });

  it('a bare number series is indexed and null breaks it', () => {
    const r = linePoints([86.4, null, 85.9]);
    expect(r.indexed).toBe(true);
    expect(r.points).toEqual([{ t: 0, v: 86.4 }, { t: 1, v: null }, { t: 2, v: 85.9 }]);
    expect(linePoints(SERIES).indexed).toBe(false);
  });
});

describe('lineXTicks', () => {
  it('clock: 00 · 12 · 24 over a whole day, round hours otherwise', () => {
    expect(lineXTicks('clock', T('00:00'), T('00:00', '2026-10-31'), 300, TZ).map((t) => t.text)).toEqual(['00', '12', '24']);
    expect(lineXTicks('clock', T('08:00'), T('20:30'), 300, TZ).map((t) => t.text)).toEqual(['08', '14:15', '20:30']);
  });
  it('hours: clock-aligned and thinned to fit; none and a bare series have none', () => {
    const night = lineXTicks('hours', T('23:12', '2026-10-29'), T('07:08'), 300, TZ).map((t) => t.text);
    expect(night.every((t) => /^\d\d:00$/.test(t))).toBe(true);
    expect(night.length).toBeGreaterThanOrEqual(3);
    expect(lineXTicks('none', 0, 10, 300)).toEqual([]);
    expect(lineXTicks('clock', 0, 13, 300, TZ, true)).toEqual([]);
  });
});

describe('lineModel', () => {
  it('maps the window to the plot and ends the line at the last reading', () => {
    const m = lineModel({ ...BASE, height: 120 }, 300);
    expect(m.x(BASE.from!)).toBeCloseTo(0);
    expect(m.x(BASE.to!)).toBeCloseTo(300);
    expect(m.end?.v).toBe(1096);
    expect(m.end?.x).toBeCloseTo(m.x(T('14:58')));
    expect(m.linePaths).toHaveLength(1);
    expect(m.linePaths[0]).toMatch(/^M[\d.]+,[\d.]+C/);
    // the projection continues from the end of the line
    expect(m.futurePath.startsWith(`M${m.end!.x.toFixed(1)},${m.end!.y.toFixed(1)}`)).toBe(true);
    // a higher value is higher on the screen
    expect(m.y(2595)).toBeLessThan(m.y(1096));
  });

  it('a null reading breaks the line and a gap is never bridged', () => {
    const series = [{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: null }, { t: 3, v: 3 }, { t: 4, v: 4 }];
    const m = lineModel({ series, height: 100, smoothing: 'spark' }, 200);
    expect(m.runs).toHaveLength(2);
    expect(m.linePaths).toHaveLength(2);
  });

  it('a lone reading is a dot, not a path', () => {
    const m = lineModel({ series: [{ t: 0, v: 5 }, { t: 1, v: null }, { t: 2, v: 6 }, { t: 3, v: 7 }], height: 100, smoothing: 'spark' }, 200);
    expect(m.dots).toHaveLength(1);
    expect(m.linePaths).toHaveLength(1);
  });

  it('y labels widen the left gutter to the longest one', () => {
    const wide = lineModel({ ...BASE, yTicks: 3, height: 120, decimals: 0 }, 300);
    const none = lineModel({ ...BASE, yTicks: 0, height: 120 }, 300);
    expect(none.box.padL).toBe(0);
    expect(wide.box.padL).toBeGreaterThan(24);
    expect(wide.ticks).toHaveLength(3);
    expect(wide.x(BASE.from!)).toBeCloseTo(wide.box.padL);
  });

  it('the band is a closed path (arrays aligned with series then projection) and iqr comes from the data', () => {
    const n = SERIES.length + FUTURE.length;
    const m = lineModel({ ...BASE, band: { lo: Array.from({ length: n }, (_, i) => i * 100), hi: Array.from({ length: n }, (_, i) => i * 100 + 200) }, height: 120 }, 300);
    expect(m.bandPaths).toHaveLength(1);
    expect(m.bandPaths[0]).toMatch(/Z$/);
    const iqr = lineModel({ ...BASE, future: undefined, band: 'iqr', smoothing: 'night', height: 120 }, 300);
    expect(iqr.bandPaths.length).toBeGreaterThanOrEqual(0);
  });

  it('spans and marks keep to the window; the pointer snaps to the raw readings', () => {
    const m = lineModel(
      { ...BASE, spans: [{ from: T('01:00'), to: T('03:00'), kind: 'awake' }, { from: T('23:00', '2026-10-31'), to: T('23:30', '2026-10-31'), kind: 'workout' }], marks: [{ t: T('06:00'), v: 380, label: 'x' }, { t: T('06:00', '2026-11-05'), v: 1, label: 'y' }], height: 120 },
      300,
    );
    expect(m.spans).toHaveLength(1);
    expect(m.marks).toHaveLength(1);
    expect(m.hover.filter((h) => !h.future)).toHaveLength(SERIES.length);
    expect(m.hover.filter((h) => h.future)).toHaveLength(FUTURE.length);
  });

  it('the words of a low point hang below it and a high point\'s above; a caller can say', () => {
    const marks = [{ t: T('02:00'), v: 120, label: 'low' }, { t: T('12:00'), v: 940, label: 'high' }, { t: T('06:00'), v: 380, label: 'x', placement: 'above' as const }];
    const m = lineModel({ ...BASE, marks, height: 120 }, 300);
    expect(m.marks.map((k) => k.placement)).toEqual(['below', 'above', 'above']);
  });

  it('no reading is empty', () => {
    const m = lineModel({ series: [null, null], height: 100 }, 200);
    expect(m.empty).toBe(true);
    expect(m.end).toBeNull();
  });
});

describe('words', () => {
  it('spokenLine says the window, the start, the end with its time, the extremes, the projection and the count', () => {
    expect(spokenLine(BASE)).toBe('Energy burned, 00:00 to 00:00: starts at 0, ends at 1,096 kcal at 14:58, lowest 0, highest 1,096, expected to reach 2,595 kcal, 8 readings');
  });
  it('quiet speaks the direction in words and never a digit', () => {
    const s = spokenLine({ ...BASE, quiet: true });
    expect(s).toBe('Energy burned: rising; heading higher');
    expect(s).not.toMatch(/\d/);
    expect(spokenLine({ label: 'Weight', series: [86, 86.01, 86.02], quiet: true })).toBe('Weight: steady');
  });
  it('none, loading, stale and a single reading', () => {
    expect(spokenLine({ ...BASE, state: 'none' })).toBe('Energy burned: no readings');
    expect(spokenLine({ ...BASE, series: [], state: 'normal' })).toBe('Energy burned: no readings');
    expect(spokenLine({ ...BASE, state: 'loading' })).toBe('Energy burned: loading');
    expect(spokenLine({ ...BASE, state: 'stale' })).toMatch(/; stale$/);
    expect(spokenLine({ label: 'Weight', series: [85.2], decimals: 1 })).toMatch(/1 reading$/);
  });
  it('lineTwin lists every raw reading; a projection adds the Kind column', () => {
    const t = lineTwin(BASE);
    expect(t.head).toEqual(['Time', 'Energy burned (kcal)', 'Kind']);
    expect(t.rows).toHaveLength(SERIES.length + FUTURE.length);
    expect(t.rows[0]).toEqual(['00:00', '0', 'Measured']);
    expect(t.rows.at(-1)?.[2]).toBe('Projected');
    expect(lineTwin({ label: 'Weight', series: [86.4, 85.9], decimals: 1 }).head).toEqual(['Reading', 'Weight']);
  });
});

describe('GlowLine render', () => {
  it('is one img with the sentence, one tab stop, and an end dot with its now label', () => {
    const { container } = render(<GlowLine {...BASE} />);
    const img = screen.getByRole('img', { name: spokenLine(BASE) });
    expect(img).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('.lmz-line__main')).not.toBeNull();
    expect(container.querySelector('.lmz-line__proj')).not.toBeNull();
    expect(container.querySelector('.lmz-line__now')).toHaveTextContent('14:58');
    expect(container.querySelector('.lmz-line__halo--a')).not.toBeNull();
    expect(container.querySelector('.lmz-line__end')).toHaveAttribute('data-end', 'pulse');
  });

  it('a finished series has a static dot and no halos; none has no dot', () => {
    const { container, rerender } = render(<GlowLine {...BASE} now={null} future={undefined} />);
    expect(container.querySelector('.lmz-line__end')).toHaveAttribute('data-end', 'static');
    expect(container.querySelector('.lmz-line__halo')).toBeNull();
    rerender(<GlowLine {...BASE} endDot="none" />);
    expect(container.querySelector('.lmz-line__end')).toBeNull();
  });

  it('quiet draws the line and prints no digit, in the DOM or the name', () => {
    const { container } = render(<GlowLine {...BASE} quiet yTicks={3} xTicks="clock" />);
    expect(container.querySelector('.lmz-line__main')).not.toBeNull();
    expect(text(container)).not.toMatch(/\d/);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/\d/);
    expect(container.querySelector('.lmz-line__now')).toBeNull();
  });

  it('x and y labels are real mono text; the variant spark has none', () => {
    const { container, rerender } = render(<GlowLine {...BASE} yTicks={3} />);
    expect([...container.querySelectorAll('.lmz-line__x')].map((n) => n.textContent)).toEqual(['00', '12', '24']);
    expect(container.querySelectorAll('.lmz-line__y')).toHaveLength(3);
    rerender(<GlowLine label="Weight" series={[86.4, 86.1, 85.7, 85.2]} variant="spark" decimals={1} />);
    expect(container.querySelector('.lmz-line__x')).toBeNull();
    expect(container.querySelector('.lmz-line__y')).toBeNull();
    expect(container.querySelector('.lmz-line__now')).toBeNull();
    expect(screen.getByRole('img')).not.toHaveAttribute('tabindex');
  });

  it('a first x label that is not at the plot edge is centred on its tick, not flush', () => {
    const { container } = render(<GlowLine {...BASE} from={T('23:12', '2026-10-29')} to={T('07:08')} series={SERIES.map((p) => ({ t: p.t - 24 * 3_600_000 + 0, v: p.v }))} future={undefined} xTicks="hours" />);
    const labels = [...container.querySelectorAll('.lmz-line__x')];
    expect(labels.length).toBeGreaterThan(2);
    expect(labels[0]).not.toHaveAttribute('data-edge');
  });

  it('none and loading draw no line, only the dotted rest; loading is busy and stays out of the tab order', () => {
    const { container, rerender } = render(<GlowLine {...BASE} state="none" />);
    expect(container.querySelector('.lmz-line__main')).toBeNull();
    expect(container.querySelector('.lmz-line__rest')).not.toBeNull();
    rerender(<GlowLine {...BASE} state="loading" />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('img')).not.toHaveAttribute('tabindex');
  });

  it('stale keeps the line, draws a hollow dot and does not pulse', () => {
    const { container } = render(<GlowLine {...BASE} state="stale" />);
    expect(container.querySelector('.lmz-line__end')).toHaveAttribute('data-hollow', 'true');
    expect(container.querySelector('.lmz-line__halo')).toBeNull();
  });

  it('arrows walk the readings, say each one politely, and Escape lets go', () => {
    const { container } = render(<GlowLine {...BASE} future={undefined} />);
    const plot = screen.getByRole('img');
    plot.focus();
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('00:00, 0 kcal');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('02:00, 120 kcal');
    expect(container.querySelector('.lmz-tip')).toHaveTextContent('120 kcal');
    fireEvent.keyDown(plot, { key: 'End' });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('14:58, 1,096 kcal');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(container.querySelector('.lmz-tip')).toBeNull();
  });

  it('the Table twin draws under the picture when asked', () => {
    render(<GlowLine {...BASE} twin />);
    expect(screen.getByRole('button', { name: /table/i })).toBeInTheDocument();
  });

  it('the final markup is the same with animate on and off', async () => {
    const off = normal(render(<GlowLine {...BASE} animate={false} />).container);
    const restore = await fakeMotion();
    try {
      const { container } = render(<GlowLine {...BASE} />);
      expect(container.firstElementChild).toHaveAttribute('data-reveal', 'pending');
      await act(async () => {});
      expect(container.firstElementChild).not.toHaveAttribute('data-reveal');
      expect(normal(container)).toBe(off);
    } finally {
      restore();
    }
  });
});
