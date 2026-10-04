// @vitest-environment node
/**
 * Default-scenario hygiene (integration pass 2026-09-30, Integrator B goal 3): a healthy adult running the default
 * maintenance schedule through the FULL engine gets no caution/danger warning and no safety event; the always-on notes
 * are day-0 header notes. Runs the real 16-module loop (the other modules' physics can move these values; the assertions
 * are on the safety layer's gating only).
 */
import { simulate } from '../../core/loop';
import type { DayTemplate, ExerciseSession, PersonProfile, Schedule } from '../../types';

const START = '2026-10-05';
const person = (body: PersonProfile['body'], habits: PersonProfile['habits'] = {}): PersonProfile => ({ schemaVersion: 1, body, habits, startDate: START });
/** The Simulator's maintenance preset (100 %, 1.6 g/kg, 45 % carbohydrate, 3 meals 08:00-19:00) with engine defaults for everything else. */
const maintenance = (exercise: ExerciseSession[] = []): DayTemplate => ({
  id: 'A',
  label: 'maintenance',
  energy: { kind: 'pctMaintenance', pct: 100 },
  macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 }, split: 'even' },
  exercise,
});
const schedule = (programs: DayTemplate[], days = 90): Schedule => ({
  schemaVersion: 1,
  startDate: START,
  horizonDays: days,
  programs,
  days: Array.from({ length: days }, (_, d) => ({ program: d % programs.length })),
});

const CASES: Array<[string, PersonProfile, Schedule]> = [
  ['man 35 y, 80 kg, sedentary', person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 80 }), schedule([maintenance()])],
  ['woman 30 y, 62 kg, sedentary', person({ sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 }), schedule([maintenance()])],
  [
    'woman 45 y, 70 kg, habitual RT 3×/wk continued',
    person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 70 }, { sessionsPerWeek: 3, lifingCardioMix: 0, trainingHistory: '1to3y' }),
    schedule([maintenance([{ kind: 'resistance', startH: 18, durationMin: 60, volume: 'moderate' }]), maintenance()]),
  ],
  [
    'man 50 y, 90 kg, habitual cardio 4×/wk continued',
    person({ sex: 'male', ageYears: 50, heightCm: 180, weightKg: 90 }, { sessionsPerWeek: 4, lifingCardioMix: 1, trainingHistory: '1to3y' }),
    schedule([maintenance([{ kind: 'cardio', modality: 'other', startH: 18, durationMin: 60, met: 5 }]), maintenance()]),
  ],
];

describe('default maintenance scenario: no caution/danger warnings, no safety events', () => {
  it.each(CASES)('%s', (_name, profile, sched) => {
    const r = simulate(profile, sched, { record: 'daily' });
    const noisy = r.warnings.filter((w) => w.severity !== 'info').map((w) => `${w.id} d${w.startDay}-${w.endDay}`);
    expect(noisy).toEqual([]);
    expect(r.events.filter((e) => e.type === 'safetyFlag')).toEqual([]);
    for (const w of r.warnings.filter((x) => /^W-U0/.test(x.id))) expect([w.startDay, w.endDay]).toEqual([0, 0]);
    // the population-default fibre and sodium are not flagged at maintenance
    expect(r.warnings.some((w) => w.id === 'W-M11' || w.id === 'W-M13')).toBe(false);
  });
});
