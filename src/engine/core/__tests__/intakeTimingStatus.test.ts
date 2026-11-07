// @vitest-environment node
/**
 * D6-07 (C6): a GLP-1 medication context puts the hourly appearance kernels out of domain — an `outOfDomain` status on
 * the hourly appearance-driven series (glucose, insulin), never a multiplier: the numbers and daily energy are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { compileSchedule } from '../compileSchedule';
import { runEngine } from '../loop';
import { resolveProfile } from '../resolveProfile';
import type { PersonProfile, Schedule } from '../../types';

const base: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 178, weightKg: 85 }, habits: { sessionsPerWeek: 0 }, startDate: '2026-10-05' } as PersonProfile;
const schedule: Schedule = {
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: 3,
  programs: [{ id: 'p', label: 'p', energy: { kind: 'pctMaintenance', pct: 100 }, macros: { protein: { unit: 'pctEnergy', value: 20 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } }, meals: { count: 3, window: { startH: 8, lengthH: 11 } } }],
  days: [{ program: 0 }, { program: 0 }, { program: 0 }],
};
const run = (p: PersonProfile) => {
  const rp = resolveProfile(p);
  return runEngine(rp, compileSchedule(schedule, rp), { record: 'daily', series: ['glucose', 'insulin', 'energyBalance'] });
};

describe('D6-07 intake timing domain', () => {
  it('GLP-1 medication: glucose and insulin out of domain with the reason; values and daily energy unchanged', () => {
    const plain = run(base);
    const glp1 = run({ ...base, safety: { mode: 'M0', flags: { diabetesMedication: 'glp1' } } } as PersonProfile);
    expect(glp1.meta.outputStatus?.glucose).toMatchObject({ status: 'outOfDomain', reasonCode: 'intakeTiming:glp1Medication' });
    expect(glp1.meta.outputStatus?.insulin).toMatchObject({ status: 'outOfDomain', reasonCode: 'intakeTiming:glp1Medication' });
    expect(plain.meta.outputStatus?.glucose?.status).not.toBe('outOfDomain');
    expect(Array.from(glp1.daily.glucose!)).toEqual(Array.from(plain.daily.glucose!));
    expect(Array.from(glp1.daily.energyBalance!)).toEqual(Array.from(plain.daily.energyBalance!));
  });
  it('a stopped GLP-1 medication before the start is back in domain', () => {
    const r = run({ ...base, medications: [{ id: 'm1', medicationClass: 'glp1', change: 'start', date: '2025-01-01' }, { id: 'm2', medicationClass: 'glp1', change: 'stop', date: '2026-01-01' }] } as PersonProfile);
    expect(r.meta.outputStatus?.glucose?.status).not.toBe('outOfDomain');
  });
});
