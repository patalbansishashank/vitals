import { describe, expect, it } from 'vitest';
import { circumferencesFor } from '@/engine/body';
import type { SimulationResult } from '@/engine';
import { bodyTimeline } from '../lib/bodyState';
import { DAYS, engineResult, resolved } from './fixture';

const result = engineResult();
const { rp } = resolved();

describe('body state per day (figure over time)', () => {
  const tl = bodyTimeline(result, rp.body);

  it('rebuilds a full BodyState for every day from the recorded series', () => {
    expect(tl.days).toBe(DAYS);
    expect(tl.missing).toEqual([]);
    expect(tl.endpointsOnly).toBe(false);
    for (const d of [0, 6, DAYS - 1]) {
      const s = tl.stateAt(d);
      expect(s.fatMassKg).toBeCloseTo(result.daily.fatMass![d]!, 5);
      expect(s.skeletalMuscleKg).toBeCloseTo(result.daily.skeletalMuscle![d]!, 5);
      expect(s.weightKg).toBeCloseTo(s.fatMassKg + s.fatFreeMassKg, 6);
      // FFM moves with lean tissue (no glycogen/water swings)
      expect(s.fatFreeMassKg - rp.body.fatFreeMassKg).toBeCloseTo(result.daily.leanTissue![d]! - result.initial.leanTissue!, 4);
      // regional depots conserve the day's fat mass
      const fat = s.fat.headKg + s.fat.armsKg + s.fat.legsKg + s.fat.trunkSatKg + s.fat.vatKg;
      expect(fat).toBeCloseTo(s.fatMassKg, 3);
      expect(s.measuredCircumferences).toBeUndefined();
    }
  });

  it('matches the engine’s own waist (same allocation, same baseline)', () => {
    for (const d of [3, 10, DAYS - 1]) {
      const w = circumferencesFor(tl.stateAt(d), rp.body).waistCm;
      expect(Math.abs(w - result.daily.waist![d]!)).toBeLessThan(0.3);
    }
  });

  it('produces avatar params for the start (ghost) and any day, clamped to the horizon', () => {
    const p0 = tl.paramsAt(-1);
    const pEnd = tl.paramsAt(DAYS + 10);
    expect(p0.levels.length).toBeGreaterThan(3);
    expect(pEnd).toBe(tl.paramsAt(DAYS - 1));
    expect(Number.isFinite(pEnd.circumferences.waistCm)).toBe(true);
  });

  it('degrades to the start and last day when fat mass is not recorded per day', () => {
    const daily = { ...result.daily };
    delete daily.fatMass;
    const partial: SimulationResult = { ...result, daily, final: { ...result.final, fatMass: result.daily.fatMass![DAYS - 1] } };
    const t2 = bodyTimeline(partial, rp.body);
    expect(t2.missing).toContain('fatMass');
    expect(t2.endpointsOnly).toBe(true);
    expect(t2.stateAt(5).fatMassKg).toBe(rp.body.fatMassKg);
    expect(t2.stateAt(DAYS - 1).fatMassKg).toBeCloseTo(result.daily.fatMass![DAYS - 1]!, 5);
  });

  it('scales muscle with lean tissue when skeletal muscle is missing', () => {
    const daily = { ...result.daily };
    delete daily.skeletalMuscle;
    const t3 = bodyTimeline({ ...result, daily }, rp.body);
    expect(t3.missing).toEqual(['skeletalMuscle']);
    const s = t3.stateAt(DAYS - 1);
    expect(s.skeletalMuscleKg).toBeCloseTo(rp.body.skeletalMuscleKg * (s.fatFreeMassKg / rp.body.fatFreeMassKg), 6);
  });
});
