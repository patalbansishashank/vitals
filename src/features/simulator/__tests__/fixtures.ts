import { compileSchedule, resolveProfile } from '@/engine';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';

export const MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 88 },
  startDate: '2026-10-05',
};
export const WOMAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 29, heightCm: 164, weightKg: 58 },
  startDate: '2026-10-05',
};
export const HEAVY: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 52, heightCm: 176, weightKg: 124 },
  startDate: '2026-10-05',
};

export const RP = resolveProfile(MAN);

export const A: DayTemplate = {
  id: 'A',
  label: 'training day',
  energy: { kind: 'pctMaintenance', pct: 85 },
  macros: {
    protein: { unit: 'gPerKgBw', value: 2 },
    carbs: { unit: 'g', value: 140 },
    fat: { unit: 'remainder' },
  },
  meals: { count: 3, window: { startH: 8, lengthH: 12 } },
  exercise: [{ kind: 'resistance', startH: 17.5, durationMin: 60, volume: 'moderate' }],
};
export const B: DayTemplate = {
  id: 'B',
  label: 'rest day',
  energy: { kind: 'pctMaintenance', pct: 75 },
  macros: {
    protein: { unit: 'gPerKgBw', value: 2 },
    carbs: { unit: 'g', value: 60 },
    fat: { unit: 'remainder' },
  },
  meals: { count: 2, window: { startH: 12, lengthH: 8 } },
};
export const F: DayTemplate = {
  id: 'C',
  label: 'water-only fast',
  energy: { kind: 'zero' },
  macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'remainder' } },
};

/** 2026-10-05 is a Monday. */
export function schedule(
  days: number,
  pattern: number[] = [0],
  programs: DayTemplate[] = [A, B, F],
  startDate = '2026-10-05',
): Schedule {
  return {
    schemaVersion: 1,
    startDate,
    horizonDays: days,
    programs: structuredClone(programs),
    days: Array.from({ length: days }, (_, d) => ({ program: pattern[d % pattern.length]! })),
  };
}

export const compile = (s: Schedule, rp = RP) => compileSchedule(s, rp);
