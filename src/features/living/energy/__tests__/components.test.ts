import { describe, expect, it } from 'vitest';
import { energyDay, type EnergyHour } from '@/living/sensors/energyDay';
import {
  COMPONENT_ORDER,
  componentRange,
  componentsThrough,
  cumulativeSeries,
  emptyComponents,
} from '../model';

const first = Date.parse('2026-10-01T00:00:00Z');
const hours: EnergyHour[] = Array.from({ length: 24 }, (_, h) => ({
  start: first + h * 3_600_000,
  rmr: 70,
  tef: h === 12 ? 12 : 2,
  neat: h < 7 ? -4 : 12,
  stepsEnergy: h < 7 ? -6 : 8,
  exerciseEnergy: h === 17 ? 130 : h === 18 ? 20 : 0,
  tdee: 70 + (h === 12 ? 12 : 2) + (h < 7 ? -4 : 12) + (h === 17 ? 130 : h === 18 ? 20 : 0) - 3,
}));
const sum = (c: ReturnType<typeof emptyComponents>) => COMPONENT_ORDER.reduce((s, k) => s + c[k], 0);
const day = energyDay({
  hours,
  minutes: [],
  bouts: [
    {
      id: 'x',
      window: { start: first + 17 * 3_600_000, end: first + 18 * 3_600_000 },
      incrementalKcalPerMin: 130 / 60,
    },
  ],
});

describe('r071: exact model components', () => {
  it('all seven signed components sum to the full-day total, with walking separate from NEAT', () => {
    const c = componentsThrough(day);
    expect(c.neatBase).not.toBe(c.stepsEnergy);
    expect(c.other).toBeLessThan(0);
    expect(c.recovery).toBeGreaterThan(0);
    expect(c.exercise).toBeGreaterThan(0);
    expect(sum(c)).toBeCloseTo(day.total, 8);
    for (const k of COMPONENT_ORDER) expect(c[k]).toBeCloseTo(day.components[k], 8);
  });

  it('every partial hour matches the canonical hourly total, including negative movement and recovery', () => {
    for (let min = 0; min <= 1440; min += 7) {
      const at = first + min * 60_000;
      const expected = hours.reduce(
        (s, h) => s + h.tdee * Math.max(0, Math.min(1, (at - h.start) / 3_600_000)),
        0,
      );
      const c = componentsThrough(day, at);
      expect(sum(c)).toBeCloseTo(expected, 8);
      const line = cumulativeSeries(day, at);
      expect(line.series.at(-1)!.v).toBeCloseTo(expected, 8);
    }
  });

  it('a custom period including a partial today sums components to exactly the period total', () => {
    const c = emptyComponents();
    const at = first + 13.37 * 3_600_000;
    for (const cutoff of [Infinity, Infinity, at]) {
      const part = componentsThrough(day, cutoff);
      for (const k of COMPONENT_ORDER) c[k] += part[k];
    }
    const partial = hours.reduce(
      (s, h) => s + h.tdee * Math.max(0, Math.min(1, (at - h.start) / 3_600_000)),
      0,
    );
    const expected = 2 * day.total + partial;
    expect(sum(c)).toBeCloseTo(expected, 8);
    expect(
      Math.abs(COMPONENT_ORDER.reduce((s, k) => s + Math.round(c[k]), 0) - Math.round(expected)),
    ).toBeLessThanOrEqual(COMPONENT_ORDER.length / 2);
  });

  it('signed scenario bounds stay ordered and sum linearly', () => {
    expect(componentRange(-20, 100, { lo: 80, hi: 120 })).toEqual({ lo: -24, hi: -16 });
    expect(componentRange(40, 100, { lo: 80, hi: 120 })).toEqual({ lo: 32, hi: 48 });
    expect(componentRange(40, 100, null)).toBeNull();
  });
});
