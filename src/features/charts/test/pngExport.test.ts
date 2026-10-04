import './setupDom';
import { describe, expect, it } from 'vitest';
import { readChartTheme } from '../core/theme';
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

describe('phase labels carry the true balance when they fit', () => {
  const measure = (s: string) => s.length * 6;
  it('prefers "name · balance", then the name alone', () => {
    const p = { startDay: 0, endDay: 28, label: 'fat-loss base', balance: 'deficit 18 %' };
    expect(fitPhaseLabel(p, 300, measure).text).toBe('fat-loss base · deficit 18 %');
    expect(fitPhaseLabel(p, 100, measure).text).toBe('fat-loss base');
  });
});
