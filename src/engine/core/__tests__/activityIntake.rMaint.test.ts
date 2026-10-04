// @vitest-environment node
/**
 * Activity intake × R-MAINT (MODEL_SPEC §5.5, R1 §3.1 / V11): occupation, home, commute and recreation live inside NEAT0,
 * so the maintenance reference's activity adjustment sees only sessions and steps above the intake's weekly-mean S_hab.
 *  - replaying the habitual week as the plan gives a zero adjustment and no drift (O-12 tolerances), for any answers;
 *  - two people with the same body and the same S_hab but different jobs get the same adjustment for the same plan;
 *  - the reference itself differs by exactly their TDEE0 difference.
 */
import { compileSchedule, habitualWeekPrograms } from '../compileSchedule';
import { runEngine } from '../loop';
import { resolveProfile } from '../resolveProfile';
import type { ActivityIntake, DayTemplate, MacroSpec, PersonProfile, Schedule } from '../../types';

vi.setConfig({ testTimeout: 120_000 });

const START = '2026-10-05'; // a Monday
const person = (activity: ActivityIntake | undefined, habits: PersonProfile['habits'] = {}): PersonProfile => ({
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, knownBodyFatPct: 25, knownBodyFatSource: 'dxa' },
  habits: { ...(activity ? { activity } : {}), ...habits },
  startDate: START,
});
const MACROS: MacroSpec = { protein: { unit: 'pctEnergy', value: 15.6 }, carbs: { unit: 'pctEnergy', value: 45.4 }, fat: { unit: 'remainder' } };
const schedule = (programs: DayTemplate[], days: number, startWeekday: number): Schedule => ({
  schemaVersion: 1,
  startDate: START,
  horizonDays: days,
  programs,
  days: Array.from({ length: days }, (_, d) => ({ program: (startWeekday + d) % programs.length })),
});

const HEAVY: ActivityIntake = { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 }, recreation: [{ label: 'football', intensity: 'vigorous', minPerWeek: 90 }] };
const SKIP: ActivityIntake = {};

describe('habitual week replayed as the plan (R1 V11)', () => {
  for (const [label, intake, sessions] of [
    ['heavy manual labourer + football, 3 RT sessions/wk', HEAVY, 3],
    ['everything skipped (population mixture)', SKIP, 0],
  ] as const) {
    it(`${label}: zero R-MAINT adjustment, |ΔFM| < 0.15 kg, |Δscale| < 0.3 kg over 30 d`, () => {
      const p = person(intake, sessions ? { sessionsPerWeek: sessions, lifingCardioMix: 0, trainingHistory: '1to3y' } : {});
      const rp = resolveProfile(p);
      const programs = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 100 } }));
      const cs = compileSchedule(schedule(programs, 31, rp.startWeekday), rp);
      for (const day of cs.days) {
        expect(Math.abs(day.activityAdjKcal!)).toBeLessThan(1e-6);
        expect(day.steps).toBe(rp.habits.typicalSteps);
      }
      const r = runEngine(rp, cs, { record: 'daily', checks: true });
      const fm = r.daily.fatMass!;
      const scale = r.daily.scaleWeight!;
      expect(Math.abs(fm[29]! - r.initial.fatMass!)).toBeLessThan(0.15);
      expect(Math.abs(scale[30]! - scale[0]!)).toBeLessThan(0.3);
    });
  }
});

describe('non-step activity is invisible to the activity adjustment', () => {
  it('same body, same S_hab, desk vs heavy manual job: identical adjustment for a 12 000-step plan; references differ by ΔTDEE0', () => {
    const steps: ActivityIntake['steps'] = { source: 'wrist', weeklyMean: 8000 };
    const desk = resolveProfile(person({ work: 'desk', steps }));
    const heavy = resolveProfile(person({ work: 'manualHeavy', steps }));
    expect(desk.habits.typicalSteps).toBe(8000);
    expect(heavy.habits.typicalSteps).toBe(8000);
    expect(heavy.tdee0Kcal - desk.tdee0Kcal).toBeGreaterThan(900);
    const plan: DayTemplate = { id: 'walk', label: 'walk', energy: { kind: 'pctMaintenance', pct: 100 }, macros: MACROS, steps: 12000 };
    const a = compileSchedule(schedule([plan], 14, 0), desk);
    const b = compileSchedule(schedule([plan], 14, 0), heavy);
    for (let d = 0; d < 14; d++) {
      expect(a.days[d]!.activityDeltaKcal!).toBeGreaterThan(100);
      expect(b.days[d]!.activityDeltaKcal!).toBeCloseTo(a.days[d]!.activityDeltaKcal!, 6);
      expect(b.days[d]!.maintenanceKcal - a.days[d]!.maintenanceKcal).toBeCloseTo(heavy.tdee0Kcal - desk.tdee0Kcal + b.days[d]!.activityAdjKcal! - a.days[d]!.activityAdjKcal!, 6);
    }
  });
});
