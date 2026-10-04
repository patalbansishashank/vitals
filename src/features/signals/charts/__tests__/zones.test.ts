import { describe, expect, it } from 'vitest';
import { timeInZones, zoneColor, zoneLabel, zoneModel, zoneOf } from '../zones';

describe('effort zones (§7.4.1)', () => {
  it('max heart rate: Tanaka from age, the person’s own max wins, no age → no zones', () => {
    expect(zoneModel({ ageYears: 40 })!.maxHr).toBe(180); // 208 − 0.7 × 40
    expect(zoneModel({ ageYears: 40 })!.lower).toEqual([90, 108, 126, 144, 162]);
    expect(zoneModel({ ageYears: 40, maxHr: 190 })!.maxHr).toBe(190);
    expect(zoneModel({ maxHr: 200 })!.lower).toEqual([100, 120, 140, 160, 180]);
    expect(zoneModel({})).toBeNull();
    expect(zoneModel({ ageYears: 0 })).toBeNull();
  });

  it('zoneOf: a boundary value belongs to the upper zone; below 50 % is the resting range', () => {
    const z = zoneModel({ maxHr: 200 })!;
    expect(zoneOf(99, z)).toBe(0);
    expect(zoneOf(100, z)).toBe(1);
    expect(zoneOf(119.9, z)).toBe(1);
    expect(zoneOf(120, z)).toBe(2);
    expect(zoneOf(159, z)).toBe(3);
    expect(zoneOf(160, z)).toBe(4);
    expect(zoneOf(180, z)).toBe(5);
    expect(zoneOf(230, z)).toBe(5);
  });

  it('labels and colours', () => {
    expect(zoneLabel(3)).toBe('zone 3 · moderate');
    expect(zoneLabel(0)).toBe('resting range');
    expect(zoneColor(5)).toBe('var(--lm-hr-zone-5)');
    expect(zoneColor(0)).toBe('var(--lm-ink-3)');
  });

  it('timeInZones counts each sample until the next one and skips gaps', () => {
    const z = zoneModel({ maxHr: 200 })!;
    const m = 60_000;
    // 10 min in zone 2 (120), then a 2 h gap (not counted), then 5 min in zone 4 (165), last sample counts nothing
    const pts = [
      { t: 0, v: 120 },
      { t: 10 * m, v: 125 },
      { t: 130 * m, v: 165 },
      { t: 135 * m, v: 150 },
    ];
    expect(timeInZones(pts, z, 20 * m)).toEqual([0, 0, 10, 0, 5, 0]);
  });
});
