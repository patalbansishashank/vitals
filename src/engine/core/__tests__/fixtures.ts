import type { PersonProfile, Schedule, DayTemplate } from '../../types';

export const MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 },
  habits: { typicalSteps: 7000, sessionsPerWeek: 3 },
  startDate: '2026-10-05',
};

export const WOMAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 },
  startDate: '2026-10-05',
};

export const PROGRAM_A: DayTemplate = {
  id: 'A',
  label: 'training day',
  energy: { kind: 'pctMaintenance', pct: 85 },
  macros: { protein: { unit: 'gPerKgBw', value: 2 }, carbs: { unit: 'g', value: 180 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 12 } },
  exercise: [{ kind: 'resistance', startH: 17, volume: 'moderate' }],
  steps: 9000,
};

export const PROGRAM_B: DayTemplate = {
  id: 'B',
  label: 'rest day',
  energy: { kind: 'pctMaintenance', pct: 75 },
  macros: { protein: { unit: 'gPerKgBw', value: 2 }, carbs: { unit: 'pctEnergy', value: 30 }, fat: { unit: 'remainder' } },
  meals: { count: 2, window: { startH: 12, lengthH: 8 } },
};

export function repeatSchedule(days: number, pattern: number[], programs: DayTemplate[] = [PROGRAM_A, PROGRAM_B]): Schedule {
  return {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: days,
    programs,
    days: Array.from({ length: days }, (_, d) => ({ program: pattern[d % pattern.length]! })),
  };
}
