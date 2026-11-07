import './setupDom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChartTheme, withAlpha } from '../core/theme';
import { makeChartData } from '../fixtures';
import { fitPhaseLabel } from '../lib/labels';
import { renderChartPng } from '../lib/pngExport';

describe('PNG export', () => {
  it('draws every chosen lane (not only the ones on screen) at the requested scale', () => {
    const data = makeChartData({ days: 84 });
    const series = data.series.slice(0, 6);
    const one = renderChartPng({ time: data.time, series: series.slice(0, 1), phases: data.phases, title: 't', disclaimer: 'Not medical advice.', theme: readChartTheme(), width: 1000, scale: 2 });
    const six = renderChartPng({ time: data.time, series, phases: data.phases, title: 't', subtitle: 's', disclaimer: 'Not medical advice.', theme: readChartTheme(), width: 1000, scale: 2 });
    expect(one.width).toBe(2000);
    // each extra lane adds a fixed-height row
    expect(six.height).toBeGreaterThan(one.height + 5 * 2 * 90);
  });
});

describe('PNG export wears the same skin as the canvas (parity)', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Every canvas the export makes draws into one recorder. */
  function record() {
    const calls: Array<[string, ...unknown[]]> = [];
    const state: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (prop === 'createLinearGradient')
          return (...a: unknown[]) => {
            calls.push(['createLinearGradient', ...a]);
            const g = { stops: [] as Array<[number, string]>, addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
            calls.push(['gradient', g]);
            return g;
          };
        return (...a: unknown[]) => {
          calls.push([String(prop), ...a]);
        };
      },
      set(target, prop, value) {
        target[prop] = value;
        calls.push([`set:${String(prop)}`, value]);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
    return calls;
  }

  const figure = () => {
    const data = makeChartData({ days: 84 });
    const open = data.series.find((s) => s.id === 'scale_weight')!;
    const banded = data.series.find((s) => s.id === 'fat_mass')!;
    const series = [{ ...open, daily: { ...open.daily, band: undefined } }, banded];
    const theme = readChartTheme();
    const calls = record();
    renderChartPng({ time: data.time, series, phases: data.phases, title: 't', disclaimer: 'Not medical advice.', theme, width: 1000, scale: 2 });
    return { calls, theme };
  };

  it('draws the gridlines dotted, 1 px on and 3 px off, in the theme grid colour', () => {
    const { calls, theme } = figure();
    expect(calls.filter((c) => c[0] === 'setLineDash' && JSON.stringify(c[1]) === '[1,3]').length).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c[0] === 'set:strokeStyle' && c[1] === theme.gridDot)).toBe(true);
  });

  it('gives a lane with no likely range its area gradient and leaves the banded lane flat', () => {
    const { calls, theme } = figure();
    const grads = calls.filter((c) => c[0] === 'gradient').map((c) => (c[1] as { stops: Array<[number, string]> }).stops);
    expect(grads).toHaveLength(1);
    expect(grads[0]![0]![1]).toBe(withAlpha(theme.cat.body, theme.areaTop));
  });

  it('ends each line in a dot with a surface ring, and round line caps', () => {
    const { calls, theme } = figure();
    const rings = calls.filter((c) => c[0] === 'arc' && c[3] === 5.5);
    const dots = calls.filter((c) => c[0] === 'arc' && c[3] === 3.5);
    expect(rings).toHaveLength(2);
    expect(dots).toHaveLength(2);
    expect(calls.filter((c) => c[0] === 'set:fillStyle' && c[1] === theme.ring).length).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c[0] === 'set:lineCap' && c[1] === 'round')).toBe(true);
  });

  it('widens the glow by the export scale (a shadow blur ignores the context transform)', () => {
    const { calls, theme } = figure();
    const blurs = calls.filter((c) => c[0] === 'set:shadowBlur' && (c[1] as number) > 0).map((c) => c[1] as number);
    expect(blurs.length).toBeGreaterThanOrEqual(2);
    for (const b of blurs) expect(b).toBeCloseTo(theme.dot.glowBlur * 0.6 * 2, 6);
  });
});

describe('phase labels carry the true balance when they fit', () => {
  const measure = (s: string) => s.length * 6;
  it('prefers "name · balance", then the name alone', () => {
    const p = { startDay: 0, endDay: 28, label: 'fat-loss base', balance: 'deficit 18 %' };
    expect(fitPhaseLabel(p, 300, measure).text).toBe('fat-loss base · deficit 18 %');
    expect(fitPhaseLabel(p, 100, measure).text).toBe('fat-loss base');
  });
});
