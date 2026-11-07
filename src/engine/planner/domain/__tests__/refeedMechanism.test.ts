// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { simulate } from '../../../simulate';
import type { PersonProfile, Schedule } from '../../../types';
import { MuscleSim, compileWeek, person, program } from '../../../model/muscle/__tests__/harness';

const DAYS = 21;
const profile: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 30, heightCm: 178, weightKg: 80 },
  habits: { sessionsPerWeek: 0 },
  startDate: '2026-10-05',
};

function schedule(carbPct: number): Schedule {
  return {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: DAYS,
    programs: [{
      id: 'macro-shift', label: 'Macro shift',
      energy: { kind: 'pctMaintenance', pct: 100 },
      macros: {
        protein: { unit: 'g', value: 128 },
        carbs: { unit: 'pctEnergy', value: carbPct },
        fat: { unit: 'remainder' },
        fibre: { unit: 'g', value: 24 },
      },
      steps: 7000,
    }],
    days: Array.from({ length: DAYS }, () => ({ program: 0 })),
  };
}

const end = (series: Float32Array | undefined): number => series![DAYS - 1]!;

describe('carbohydrate redistribution: glycogen and tissue are distinct endpoints', () => {
  it('moves glycogen, water and inferred non-fat scale mass at equal energy/protein without booking that water as RT gain', () => {
    const higherCarb = simulate(profile, schedule(55), { record: 'daily' });
    const lowerCarb = simulate(profile, schedule(15), { record: 'daily' });
    const high = higherCarb.daily;
    const low = lowerCarb.daily;

    expect(end(high.glycogenTotal)).toBeGreaterThan(end(low.glycogenTotal));
    expect(end(high.glycogenWater)).toBeGreaterThan(end(low.glycogenWater));
    expect(end(high.waterWeight)).toBeGreaterThan(end(low.waterWeight));
    expect(end(high.leanMass)).toBeGreaterThan(end(low.leanMass));

    // These are separate endpoints: leanMass is a wake-hour inferred scale
    // measure, while leanTissue and skeletalMuscle are day-end tissue measures.
    // They need not be numerically identical across those aggregation times.
    // There are no RT sessions in either arm: carbohydrate-driven glycogen refill must
    // not be entered into the training-attributable tissue ledger.
    expect(end(high.rtMuscleGain)).toBeCloseTo(end(low.rtMuscleGain), 5);
    const apparentLeanGap = end(high.leanMass) - end(low.leanMass);
    const skeletalGap = end(high.skeletalMuscle) - end(low.skeletalMuscle);
    const waterGap = end(high.waterWeight) - end(low.waterWeight);
    expect(apparentLeanGap).toBeGreaterThan(0);
    expect(waterGap).toBeGreaterThan(apparentLeanGap * 0.75);
    expect(Math.abs(skeletalGap)).toBeLessThan(apparentLeanGap);
  });

  it('only discounts glycogen-depleted RT sets after the 10th set in a region and bout', () => {
    const effectiveSets = (sets: number, glycogenRel: number): number => {
      const sim = new MuscleSim(person());
      const day = compileWeek(sim.profile, [program('rt', { sessions: [{ startH: 17, sets }] })], [0])[0]!;
      sim.runDay(day, (_hour, _input, bus) => { bus.muscleGlycogenRel = glycogenRel; });
      return sim.s.vR[0]!;
    };
    for (const sets of [3, 10]) {
      expect(effectiveSets(sets, 0.3)).toBeCloseTo(effectiveSets(sets, 1), 9);
    }
    expect(effectiveSets(14, 0.3)).toBeLessThan(effectiveSets(14, 1));
    expect(effectiveSets(14, 0.3)).toBeCloseTo(10 + 4 * 0.95, 9);
  });
});
