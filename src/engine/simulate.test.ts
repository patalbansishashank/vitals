import { simulate } from './simulate';
import type { PersonProfile, Schedule } from './types';

const profile: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 30, heightCm: 180, weightKg: 85 } };
const schedule = (days: number, pct: number): Schedule => ({
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: days,
  programs: [
    {
      id: 'A',
      label: 'A',
      energy: { kind: 'pctMaintenance', pct },
      macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
    },
  ],
  days: Array.from({ length: days }, () => ({ program: 0 })),
});

describe('simulate (v1 contracts, stub modules)', () => {
  it('is deterministic and loses weight in a deficit', () => {
    const a = simulate(profile, schedule(30, 80));
    const b = simulate(profile, schedule(30, 80));
    expect(a.meta.nDays).toBe(30);
    expect(Array.from(a.daily.scaleWeight!)).toEqual(Array.from(b.daily.scaleWeight!));
    expect(a.daily.scaleWeight![29]!).toBeLessThan(85);
  });
});
