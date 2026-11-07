import '../../test/setupDom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TrendLane } from '../TrendLane';
import { trendFixture } from './fixtures';

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

afterEach(() => cleanup());

describe('<TrendLane>', () => {
  it('draws every weigh-in as a dot; flagged ones are hollow, never removed', async () => {
    const data = trendFixture();
    data.weighIns[7]!.flagged = true;
    const { container } = render(<TrendLane data={data} size="progress" />);
    await flush();
    const dots = container.querySelectorAll('[data-mark="weigh-in"]');
    expect(dots).toHaveLength(9);
    const flagged = container.querySelectorAll('[data-mark="weigh-in"][data-flagged="true"]');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.getAttribute('class')).toContain('lmc-tl__dot--flagged');
    expect(screen.getByText('Unusual, kept')).toBeInTheDocument(); // legend
    expect(screen.getByText('Forecast')).toBeInTheDocument();
  });

  it('is one tab stop with the generated summary', async () => {
    render(<TrendLane data={trendFixture()} size="today" />);
    await flush();
    const plot = screen.getByRole('img', { name: /^Weight trend 83\.1 kilograms, expected today 82\.8 to 83\.6; 9 weigh-ins/ });
    expect(plot).toHaveAttribute('tabindex', '0');
  });

  it('draws the now-hand only when today is in the window', async () => {
    const { container, rerender } = render(<TrendLane data={trendFixture()} size="today" />);
    await flush();
    expect(container.querySelectorAll('[data-mark="now"]')).toHaveLength(1);
    rerender(<TrendLane data={trendFixture({ todayIndex: null })} size="today" />);
    await flush();
    expect(container.querySelector('[data-mark="now"]')).toBeNull();
  });

  it('prints y numerals and the unit, and hides both in quiet mode (shape only)', async () => {
    const { container, rerender } = render(<TrendLane data={trendFixture()} size="checkin" />);
    await flush();
    expect(container.querySelectorAll('[data-mark="y-tick"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-mark="y-unit"]')?.textContent).toBe('kg');
    rerender(<TrendLane data={trendFixture()} size="checkin" quiet />);
    await flush();
    expect(container.querySelectorAll('[data-mark="y-tick"]')).toHaveLength(0);
    expect(container.querySelector('[data-mark="y-unit"]')).toBeNull();
    expect(screen.getByText('Going down')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    expect(screen.getByRole('img', { name: /numbers hidden/ })).toBeInTheDocument();
  });

  it('a goal beyond the hugged scale becomes an edge label on every size; a goal inside it is a line (the scale never stretches)', async () => {
    const { container, rerender } = render(<TrendLane data={trendFixture()} size="today" />);
    await flush();
    expect(container.querySelector('[data-mark="goal-edge"]')?.textContent).toBe('goal 79.5 kg ↓');
    expect(container.querySelector('[data-mark="goal"]')).toBeNull();
    rerender(<TrendLane data={trendFixture()} size="progress" />);
    await flush();
    expect(container.querySelector('[data-mark="goal-edge"]')?.textContent).toBe('goal 79.5 kg ↓');
    expect(container.querySelector('[data-mark="goal"]')).toBeNull();
    rerender(<TrendLane data={trendFixture({ goal: { value: 83.5, label: 'goal 83.5 kg' } })} size="progress" />);
    await flush();
    expect(container.querySelector('[data-mark="goal"]')).not.toBeNull();
    expect(container.querySelector('[data-mark="goal-edge"]')).toBeNull();
  });

  it('shows the goal-date bracket label and engraved event markers', async () => {
    const data = trendFixture({
      events: [
        { day: 4, kind: 'version', label: 'v2' },
        { day: 6, kind: 'pause', label: 'paused', endDay: 7 },
      ],
    });
    const { container } = render(<TrendLane data={data} size="progress" />);
    await flush();
    expect(container.querySelector('[data-mark="goal-date"]')?.textContent).toBe('21–30 Dec');
    expect(container.querySelector('[data-mark="version"]')?.textContent).toBe('v2');
    expect(container.querySelector('[data-mark="pause"]')?.textContent).toBe('paused');
  });

  it('the small charts carry no table key (T still opens the twin)', async () => {
    const { rerender } = render(<TrendLane data={trendFixture()} size="today" />);
    await flush();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    rerender(<TrendLane data={trendFixture()} size="checkin" />);
    await flush();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('the table key toggles the table twin: date · weigh-in · trend · forecast · event', async () => {
    render(<TrendLane data={trendFixture({ events: [{ day: 4, kind: 'version', label: 'v2' }] })} size="progress" />);
    await flush();
    expect(screen.queryByRole('table')).toBeNull();
    // r068 PR6: the same TwinKey as every other card (aria-expanded, "Hide table" while open)
    const key = screen.getByRole('button', { name: 'Table' });
    expect(key).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(key);
    const table = screen.getByRole('table');
    expect(key).toHaveAttribute('aria-expanded', 'true');
    // r068 L15: a short "Scale" head; dates "Fri 2" with the month on the first row and the 1st
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Scalekg', 'Trendkg', 'Forecastkg', 'Event']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(15);
    const today = within(table).getByRole('rowheader', { name: /Thu 1 Oct/ }).closest('tr')!;
    expect(within(today).getAllByRole('cell').map((c) => c.textContent)).toEqual(['83.3', '83.1', '82.8–83.6', '—']);
    expect(within(table).getByText('v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
    fireEvent.click(key);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('r068 L15: the Event column only when a day has an event', async () => {
    render(<TrendLane data={trendFixture()} size="progress" />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Scalekg', 'Trendkg', 'Forecastkg']);
  });

  it('keyboard: focus shows the crosshair at today, arrows move it a day, Esc clears', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="checkin" />);
    await flush();
    const plot = screen.getByRole('img', { name: /^Weight trend/ });
    act(() => plot.focus());
    expect(container.querySelector('[data-mark="crosshair"]')).not.toBeNull();
    expect(container.querySelector('.lmc-lv-tip b')?.textContent).toBe('Thu 1 Oct');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(container.querySelector('.lmc-lv-tip b')?.textContent).toBe('Wed 30 Sep');
    expect(container.querySelector('.lmc-lv-tip')?.textContent).toContain('expected 82.9–83.7');
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(container.querySelector('.lmc-lv-tip b')?.textContent).toBe('Fri 18 Sep');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(container.querySelector('[data-mark="crosshair"]')).toBeNull();
    fireEvent.keyDown(plot, { key: 't' });
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('draws the forecast range as the wash between two dashed p10 / p90 edges, with the median through it (PCH-01)', async () => {
    const data = trendFixture();
    const { container } = render(<TrendLane data={data} size="progress" />);
    await flush();
    expect(container.querySelector('[data-mark="realistic"]')?.getAttribute('class')).toBe('lmc-tl__band');
    const edges = container.querySelectorAll('[data-mark="realistic-bounds"] path');
    expect([...edges].map((p) => [p.getAttribute('data-bound'), p.getAttribute('class')])).toEqual([
      ['p90', 'lmc-tl__bound'],
      ['p10', 'lmc-tl__bound'],
    ]);
    // each edge is an open polyline through every day of its percentile, not the closed band outline
    for (const p of edges) {
      const d = p.getAttribute('d')!;
      expect(d).not.toContain('Z');
      // one M and a cubic C for each following day: a smooth line through every day of its percentile
      expect(d.match(/[MC]/g)).toHaveLength(data.days);
    }
    expect(container.querySelector('[data-mark="realistic-p50"]')?.getAttribute('class')).toBe('lmc-tl__p50');
    // the legend swatch draws the same encoding: wash, both dashed edges, the median
    const swatch = screen.getByText('Forecast').querySelector('svg')!;
    expect(swatch.querySelectorAll('.lmc-tl__band')).toHaveLength(1);
    expect(swatch.querySelectorAll('.lmc-tl__bound')).toHaveLength(2);
    expect(swatch.querySelectorAll('.lmc-tl__p50')).toHaveLength(1);
  });

  it('forecast edges without a median: no median line in the plot or the legend', async () => {
    const data = trendFixture();
    delete data.realistic!.p50;
    const { container } = render(<TrendLane data={data} size="checkin" />);
    await flush();
    expect(container.querySelectorAll('[data-mark="realistic-bounds"] path')).toHaveLength(2);
    expect(container.querySelector('.lmc-tl__p50')).toBeNull();
  });

  it('the forecast edges are long-dashed in the hue drawn down onto the card, holding 3:1 on the band wash and on the card (PCH-01)', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '../../../../..', p), 'utf8');
    const css = read('src/features/charts/living/living-charts.css');
    const tokens = read('src/styles/tokens.css');
    const rule = (sel: string) => {
      const m = css.match(new RegExp(`\\n\\s*${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`));
      if (!m) throw new Error(`${sel} not found`);
      return m[1]!;
    };
    const token = (name: string): string => {
      const v = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))![1]!.trim();
      const alias = v.match(/^var\(--([\w-]+)\)$/);
      return alias ? token(alias[1]!) : v;
    };
    const bound = rule('.lmc-tl__bound');
    expect(bound).toMatch(/stroke: var\(--lmc-tl-forecast\);/);
    expect(bound).not.toMatch(/stroke-opacity/);
    const dash = (r: string) => r.match(/stroke-dasharray: ([\d.]+) ([\d.]+);/)!.slice(1).map(Number) as [number, number];
    const [on, off] = dash(bound);
    expect(on).toBeGreaterThan(off); // long dashes…
    expect(on).toBeGreaterThan(dash(rule('.lmc-tl__presc'))[0]); // …unlike the short-dashed as-prescribed outline
    expect(Number(bound.match(/stroke-width: ([\d.]+);/)![1])).toBeLessThan(Number(rule('.lmc-tl__trend').match(/stroke-width: ([\d.]+);/)![1]));
    const p50 = rule('.lmc-tl__p50');
    expect(p50).toMatch(/stroke: var\(--lmc-tl-forecast\);/);
    expect(p50).not.toMatch(/stroke-opacity|dasharray/);
    // the plot's band is a hue gradient (its stops are the skin's, below); the legend swatch is the flat wash
    expect(rule('.lmc-lv-legend .lmc-tl__band')).toMatch(/fill-opacity: var\(--lm-chart-band-alpha\);/);

    // --lmc-tl-forecast = the hue mixed down onto the card (srgb), measured against the card and the band's top (the
    // brightest, so the worst) alpha over it
    const pct = Number(css.match(/--lmc-tl-forecast: color-mix\(in srgb, var\(--lmc-hue\) (\d+)%, var\(--lm-face\)\);/)![1]) / 100;
    const bandTop = Number(css.match(/\.lmc-skin \.lmc-grad--band-top \{\s*stop-opacity: var\(--lmc-band-top, ([\d.]+)\);/)![1]);
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const mix = (a: number[], b: number[], t: number) => a.map((v, i) => t * v + (1 - t) * b[i]!);
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    const hue = rgb(token('lm-cat-body'));
    const card = rgb(token('lm-face'));
    const wash = mix(hue, card, bandTop);
    const edge = mix(hue, card, pct);
    expect(contrast(edge, wash)).toBeGreaterThanOrEqual(3);
    expect(contrast(edge, card)).toBeGreaterThanOrEqual(3);
    expect(contrast(hue, card)).toBeGreaterThan(contrast(edge, card)); // the trend stays the brightest trace
  });

  it('never uses a status colour or the plan gold: the trend wears the metric hue (a token), the rest stone and ink', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="progress" />);
    await flush();
    const html = container.innerHTML;
    expect(html).not.toMatch(/--lm-(danger|caution|ok|status|signal)\b/);
  });
});
