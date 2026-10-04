import { describe, expect, it } from 'vitest';
import { FIXTURE_METRICS, makeChartData, makeComparison, makeConvergence } from '../fixtures';

describe('fixtures', () => {
  it('are deterministic for a seed', () => {
    const a = makeChartData({ days: 84, seed: 7 });
    const b = makeChartData({ days: 84, seed: 7 });
    for (let k = 0; k < a.series.length; k++) {
      expect(Array.from(a.series[k]!.daily.values)).toEqual(Array.from(b.series[k]!.daily.values));
      if (a.series[k]!.hourly) expect(Array.from(a.series[k]!.hourly!.values)).toEqual(Array.from(b.series[k]!.hourly!.values));
    }
    expect(a.events).toEqual(b.events);
    const c = makeChartData({ days: 84, seed: 8 });
    expect(Array.from(c.series.find((s) => s.id === 'hunger')!.daily.values)).not.toEqual(Array.from(a.series.find((s) => s.id === 'hunger')!.daily.values));
  });
  it('cover ~40 metrics over 84–183 days with hourly data for fast metrics', () => {
    for (const days of [84, 183]) {
      const d = makeChartData({ days });
      expect(d.series.length).toBe(FIXTURE_METRICS.length);
      expect(d.series.length).toBeGreaterThanOrEqual(40);
      for (const s of d.series) {
        expect(s.daily.values).toHaveLength(days);
        if (s.hourly) expect(s.hourly.values).toHaveLength(days * 24);
        expect(Array.from(s.daily.values).every(Number.isFinite)).toBe(true);
        if (s.daily.band) for (let i = 0; i < days; i++) expect(s.daily.band.lo[i]!).toBeLessThanOrEqual(s.daily.band.hi[i]! + 1e-6);
      }
      expect(d.series.filter((s) => s.hourly).length).toBeGreaterThanOrEqual(10);
      expect(d.phases!.at(-1)!.endDay).toBe(days);
      expect(d.intake!.maintenance).toHaveLength(days);
      expect(d.states![0]!.hourly).toHaveLength(days * 24);
    }
  });
  it('produce plausible shapes: fat falls, fasts raise ketones, bands widen', () => {
    const d = makeChartData({ days: 84 });
    const fat = d.series.find((s) => s.id === 'fat_mass')!;
    expect(fat.daily.values[83]!).toBeLessThan(fat.daily.values[0]!);
    const ket = d.series.find((s) => s.id === 'ketones')!.hourly!.values;
    expect(Math.max(...ket)).toBeGreaterThan(1);
    const b = fat.daily.band!;
    expect(b.hi[83]! - b.lo[83]!).toBeGreaterThan(b.hi[0]! - b.lo[0]!);
    expect(d.events!.some((e) => e.type === 'safety' && e.severity === 'caution')).toBe(true);
  });
  it('make three plans and convergence traces', () => {
    const c = makeComparison();
    expect(c.plans.map((p) => p.id)).toEqual(['A', 'B', 'C']);
    expect(c.goals[0]!.target!.value).toBeCloseTo(c.plans[0]!.series[0]!.baseline! - 10, 6);
    const t = makeConvergence();
    for (const tr of t) for (let i = 1; i < tr.scores.length; i++) expect(tr.scores[i]!).toBeGreaterThanOrEqual(tr.scores[i - 1]!);
  });
});
