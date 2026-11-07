import '@/features/charts/test/setupDom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barPath, highlightIndex, LaneChart, laneDomain, thinLabels, type LaneSeries } from '../components/LaneChart';

afterEach(() => cleanup());

const labels = Array.from({ length: 7 }, (_, i) => `${i + 1} Oct`);
const bars: LaneSeries = { id: 'steps', kind: 'bars', values: [4000, 8000, null, 9000, 12000, 7000, 10000], hue: 'var(--lm-hue-steps)', highlight: 'last', outline: [false, false, false, false, true, false, false] };
const line: LaneSeries = { id: 'out', kind: 'line', values: [2100, 2200, null, 2400, 2300, 2500, 2600], hue: 'var(--lm-cat-energy)', area: true, endDot: 'static' };

const lane = (extra: Partial<React.ComponentProps<typeof LaneChart>> = {}) => (
  <LaneChart summary="Steps, last 7 days" count={7} xLabels={labels} series={[bars, line]} yFormat={(v) => String(v)} {...extra} />
);

describe('<LaneChart> in the chart skin', () => {
  it('bars have 4 px rounded tops and a square base; the highlighted one is the full hue, the rest dim; an outline bar is dashed', () => {
    const { container } = render(lane());
    const paths = container.querySelectorAll('.lv-lane__bar');
    expect(paths).toHaveLength(6); // the null slot draws no bar
    expect([...paths].filter((p) => p.hasAttribute('data-dim'))).toHaveLength(5);
    expect(container.querySelectorAll('.lv-lane__bar[data-on]')).toHaveLength(1);
    expect(container.querySelectorAll('.lv-lane__bar[data-outline]')).toHaveLength(1);
    expect(barPath(10, 20, 8, 60, 4)).toBe('M10.0,60.0V24.0Q10.0,20.0 14.0,20.0H14.0Q18.0,20.0 18.0,24.0V60.0Z');
    expect(barPath(10, 58, 8, 60, 4)).toMatch(/^M10\.0,60\.0V/); // a bar shorter than its corner radius never inverts
    expect(highlightIndex({ values: [1, 2, null], highlight: 'last' })).toBe(1);
    expect(highlightIndex({ values: [1, 2], highlight: 0 })).toBe(0);
    expect(highlightIndex({ values: [1, 2] })).toBeNull();
  });

  it('a line is smooth, breaks at a gap, and ends in a dot with the area gradient under it', () => {
    const { container } = render(lane());
    const d = container.querySelector('.lv-lane__line')!.getAttribute('d')!;
    expect(d.match(/M/g)).toHaveLength(2); // the null day breaks the line
    expect(d).toContain('C');
    expect(container.querySelector('.lv-lane__area')?.getAttribute('fill')).toMatch(/^url\(#.+-out-area\)$/);
    expect(container.querySelector('.lmc-end__dot')).toHaveAttribute('r', '3.5');
    expect(container.querySelector('.lv-lane__line')).toHaveAttribute('data-focal');
    expect(container.querySelector('[data-series="out"]')).toHaveAttribute('data-focal'); // its dot and halo follow the series, not the lane's root hue
    expect(container.querySelector('[data-series="out"]')).toHaveStyle({ '--lmc-hue': 'var(--lm-cat-energy)' });
  });

  it('quiet prints no y numerals and no reference words, but keeps the lines and the date labels', () => {
    const refs = [{ value: 9000, label: 'Goal 9 000', kind: 'goal' as const }];
    const { container, rerender } = render(lane({ refs }));
    expect(container.querySelectorAll('text.lmc-lv-tick').length).toBeGreaterThan(5);
    expect(container.textContent).toContain('Goal 9 000');
    rerender(lane({ refs, quiet: true }));
    expect(container.textContent).not.toContain('Goal 9 000');
    expect(container.querySelector('.lv-lane__ref line')).not.toBeNull();
    const ticks = [...container.querySelectorAll('text.lmc-lv-tick')].map((t) => t.textContent);
    expect(ticks.every((t) => /Oct$/.test(t ?? ''))).toBe(true); // dates only
  });

  it('scrubbing: focus shows the last slot, the arrow keys move, Escape lets go; the card hears every change', async () => {
    const onScrub = vi.fn();
    const { container } = render(lane({ onScrub, scrubText: (i) => `${i + 1} Oct` }));
    const plot = container.querySelector<HTMLElement>('.lv-lane__plot')!;
    expect(plot.tabIndex).toBe(0);
    expect(onScrub).toHaveBeenLastCalledWith(null);
    act(() => plot.focus());
    expect(onScrub).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(onScrub).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(onScrub).toHaveBeenLastCalledWith(0);
    expect(container.querySelector('.lv-lane__scrub')).not.toBeNull();
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(onScrub).toHaveBeenLastCalledWith(null);
    await act(async () => void (await new Promise((r) => setTimeout(r, 450))));
    expect(screen.queryByText('1 Oct', { selector: '.lm-sr' })).toBeNull();
  });

  it('without onScrub the lane is a plain image, as before; the final markup is the same with animate off', () => {
    const a = render(lane()).container.innerHTML.replace(/id="[^"]*"|url\(#[^)]*\)|--lmc-i[^;"]*/g, '');
    cleanup();
    const b = render(lane({ animate: false })).container.innerHTML.replace(/id="[^"]*"|url\(#[^)]*\)|--lmc-i[^;"]*/g, '');
    expect(a).toBe(b);
    cleanup();
    const { container } = render(lane());
    expect(container.querySelector('.lv-lane__plot')).not.toHaveAttribute('tabindex');
    expect(screen.getByRole('img', { name: 'Steps, last 7 days' })).toBeInTheDocument();
  });

  it('the pure helpers: domain, label thinning', () => {
    expect(laneDomain([bars])[0]).toBe(0);
    expect(thinLabels(['1 Oct', '2 Oct', '3 Oct', '4 Oct'], 10).filter(Boolean)).toEqual(['4 Oct']);
  });
});
