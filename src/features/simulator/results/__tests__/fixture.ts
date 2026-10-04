/**
 * A short real engine run shared by the results tests (the engine runs end to end; physiology modules are still
 * being completed, so tests assert structure, not physiological values).
 */
import { compileSchedule, resolveProfile, simulate, type PersonProfile, type Schedule, type SimulationResult } from '@/engine';

export const PROFILE: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 34, heightCm: 180, weightKg: 86 },
  startDate: '2026-10-05',
};

export const DAYS = 21;

export const SCHEDULE: Schedule = {
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: DAYS,
  programs: [
    {
      id: 'A',
      label: 'training day',
      energy: { kind: 'pctMaintenance', pct: 80 },
      macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } },
      meals: { window: { startH: 12, lengthH: 8 }, count: 2 },
      exercise: [{ kind: 'resistance', startH: 17, volume: 'moderate' }],
      steps: 8000,
    },
    {
      id: 'B',
      label: 'water-only fast',
      energy: { kind: 'zero' },
      macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 } },
    },
  ],
  days: Array.from({ length: DAYS }, (_, i) => ({ program: i % 7 === 3 ? 1 : 0 })),
  blocks: [
    { name: 'fat-loss base', startDay: 0, endDay: 14 },
    { name: 'fasting block', startDay: 14, endDay: DAYS },
  ],
};

let cached: SimulationResult | null = null;

/** The nominal run, recorded in full (hourly arrays for fast metrics). */
export function engineResult(): SimulationResult {
  cached ??= simulate(PROFILE, SCHEDULE, { record: 'full' });
  return cached;
}

export function resolved() {
  const rp = resolveProfile(PROFILE);
  return { rp, compiled: compileSchedule(SCHEDULE, rp) };
}
