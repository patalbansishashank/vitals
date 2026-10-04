import { describe, expect, it } from 'vitest';
import { niceTicksInside, timeTicks } from '../lib/ticks';

describe('niceTicksInside', () => {
  it('returns 2–3 nice ticks strictly inside a hugging domain', () => {
    const { ticks, step } = niceTicksInside(19.4, 24.6);
    expect(ticks).toEqual([20, 22, 24]);
    expect(step).toBe(2);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(19.4);
      expect(t).toBeLessThanOrEqual(24.6);
    }
  });
  it('never rounds the domain outward', () => {
    const { ticks } = niceTicksInside(57.1, 60.2);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(57.1);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(60.2);
  });
  it('uses 1/2/2.5/5 × 10ⁿ steps', () => {
    for (const [lo, hi] of [
      [0, 3.6],
      [0.02, 0.13],
      [-120, 15],
      [1850, 2950],
    ] as const) {
      const { step } = niceTicksInside(lo, hi);
      const m = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 2.5, 5]).toContain(Number(m.toFixed(6)));
    }
  });
  it('honours larger tick counts for focus / overlay axes', () => {
    const { ticks } = niceTicksInside(-42, 28, { min: 4, max: 8 });
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks).toContain(0);
  });
});

describe('timeTicks', () => {
  const time = { startDate: '2026-10-05', days: 84 };
  it('uses weeks with dates over the whole horizon', () => {
    const t = timeTicks(time, 0, 84, 1200);
    expect(t[0]).toMatchObject({ t: 0, label: 'wk 1 · 5 Oct', anchor: 'start' });
    expect(t.every((x) => x.t % 7 === 0)).toBe(true);
  });
  it('thins weeks and compacts labels on narrow plots', () => {
    const t = timeTicks(time, 0, 84, 300, { compact: true });
    expect(t.length).toBeLessThan(12);
    expect(t[0]!.label).toBe('wk 1');
  });
  it('uses days at 1 week and hours at 1 day', () => {
    const d = timeTicks(time, 7, 14, 1000);
    expect(d[0]).toMatchObject({ t: 7, label: 'Mon 12 Oct' });
    const h = timeTicks(time, 10, 11, 1000);
    expect(h.some((x) => x.label === '06:00')).toBe(true);
    expect(h[0]).toMatchObject({ t: 10, major: true });
  });
});
