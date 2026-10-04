import '@/features/charts/test/setupDom';
import { describe, expect, it } from 'vitest';
import { buildResultsData } from '../lib/adapt';
import { EXPLAIN_DRIVERS, explainDrivers, explainReading } from '../lib/explainContext';
import { METRIC_UNITS } from '../lib/metrics';
import { SCHEDULE, engineResult, resolved } from './fixture';

const result = engineResult();
const { compiled } = resolved();
const { data } = buildResultsData({ result, schedule: SCHEDULE, compiled });
const src = { data, result, compiled, prefs: METRIC_UNITS };

describe('explain context (value at the crosshair + what drives it)', () => {
  it('reads the end of the projection without a crosshair', () => {
    const r = explainReading(data, 'fatMass', { t: null, pinned: false, res: 'daily' })!;
    expect(r.when).toMatch(/day 21/);
    expect(r.unit).toBe('kg');
    expect(Number(r.value)).toBeCloseTo(result.daily.fatMass![20]!, 1);
    expect(r.note).toMatch(/End of the projection/);
  });

  it('reads an hourly sample with its range when the chart shows hours', () => {
    // day 3 is the water-only fast day of the fixture; 18:00 is late in it
    const r = explainReading(data, 'bhb', { t: 3 + 18.5 / 24, pinned: true, res: 'hourly' })!;
    expect(r.when).toMatch(/18:00/);
    expect(r.unit).toBe('mmol/L');
    expect(r.note).toMatch(/Pinned/);
  });

  it('explains ketones on a fast day with carbohydrate, time since eating, liver glycogen and the fast', () => {
    const d = explainDrivers(src, 'bhb', { t: 3 + 18.5 / 24, pinned: true, res: 'hourly' });
    const byLabel = new Map(d.map((x) => [x.label, x]));
    expect(byLabel.get('net carbohydrate, last 24 h')).toBeDefined();
    expect(Number(byLabel.get('hours since the last intake')!.value)).toBeGreaterThan(12);
    expect(byLabel.get('liver glycogen')?.unit).toBe('g');
    expect(byLabel.get('fast')?.value).toBe('yes');
  });

  it('decomposes scale weight into its parts since the start', () => {
    const d = explainDrivers(src, 'scaleWeight', { t: 10.5, pinned: false, res: 'daily' });
    expect(d.map((x) => x.label)).toEqual(['fat', 'lean tissue', 'glycogen and its water', 'fluid shift (salt, carbohydrate)', 'gut contents']);
    expect(d.every((x) => x.unit === 'kg')).toBe(true);
  });

  it('explains hunger with the deficit, protein share and sleep', () => {
    // day 9 is an eating day (day 10 is the weekly fast, where protein share has no meaning and is left out)
    const d = explainDrivers(src, 'hunger', { t: 9.5, pinned: false, res: 'daily' });
    const labels = d.map((x) => x.label);
    expect(labels[0]).toMatch(/energy vs maintenance, 7-day average/);
    expect(labels).toContain('protein share of energy');
    expect(labels).toContain('sleep');
  });

  it('lists drivers for the core channels', () => {
    for (const id of ['fatMass', 'leanTissue', 'scaleWeight', 'glycogenTotal', 'bhb', 'hunger', 'metabolicAdaptation', 'tdee']) {
      expect(EXPLAIN_DRIVERS[id]?.length, id).toBeGreaterThan(0);
      expect(explainDrivers(src, id, { t: 5.5, pinned: false, res: 'daily' }).length, id).toBeGreaterThan(0);
    }
  });
});
