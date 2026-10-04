// @vitest-environment node
/**
 * "Training as usual" (ruling R-DETRAIN part 2, release check 2026-10-01; MODEL_SPEC §5.2.5): `DayTemplate.habitualTraining`
 * resolves the day's sessions from the profile's habitual week — the same sessions the burn-in runs — so a schedule of such
 * days at 100 % continues the person's steady state. Real 16-module engine.
 */
import { compileSchedule, habitualSessionsFor, habitualTemplate, habitualWeekPrograms } from '../compileSchedule';
import { runEngine } from '../loop';
import { resolveProfile } from '../resolveProfile';
import type { DayTemplate, MacroSpec, PersonProfile, ResolvedProfile, Schedule } from '../../types';

vi.setConfig({ testTimeout: 120_000 });

const START = '2026-10-05'; // a Monday
const person = (habits: PersonProfile['habits'], body: Partial<PersonProfile['body']> = {}): PersonProfile => ({
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88, ...body },
  habits: { typicalSteps: 7000, ...habits },
  startDate: START,
});
const PROFILES: [string, PersonProfile][] = [
  ['sedentary', person({ sessionsPerWeek: 0, typicalSteps: 5000 })],
  ['lifter (3 RT/wk, 2 y)', person({ sessionsPerWeek: 3, lifingCardioMix: 0, trainingHistory: '1to3y' }, { trainingYears: 2 })],
  ['runner (4 cardio/wk)', person({ sessionsPerWeek: 4, lifingCardioMix: 1, trainingHistory: 'gt3y' }, { sex: 'female', weightKg: 62, heightCm: 168, ageYears: 41 })],
  ['mixed (5/wk, default mix)', person({ sessionsPerWeek: 5, trainingHistory: 'gt3y' }, { trainingYears: 6 })],
];
function sched(days: number, programs: DayTemplate[], use: (d: number) => number = () => 0): Schedule {
  return { schemaVersion: 1, startDate: START, horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: use(d) })) };
}
/** "Eating and training as usual": the habitual diet at 100 % of maintenance with the habitual sessions. */
const asUsual = (rp: ResolvedProfile): DayTemplate => ({ ...habitualTemplate(rp), id: 'usual', label: 'as usual', energy: { kind: 'pctMaintenance', pct: 100 }, habitualTraining: true });
const MACROS_16: MacroSpec = { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } };

describe('compile: habitualTraining resolves the habitual sessions by weekday', () => {
  it('sessions equal the burn-in habitual week on every weekday; extra `exercise` entries follow; default false = none', () => {
    const rp = resolveProfile(PROFILES[3]![1]);
    const tmpl: DayTemplate = { id: 'a', label: 'a', energy: { kind: 'pctMaintenance', pct: 100 }, macros: MACROS_16, habitualTraining: true };
    const extra = { kind: 'cardio' as const, modality: 'walk' as const, startH: 7, durationMin: 30 };
    const cs = compileSchedule(sched(14, [tmpl, { ...tmpl, id: 'b', exercise: [extra] }, { ...tmpl, id: 'c', habitualTraining: undefined }], (d) => (d < 7 ? 0 : d < 13 ? 1 : 2)), rp);
    const hab = compileSchedule(sched(7, habitualWeekPrograms(rp), (d) => d), rp, { activityReference: false }).days;
    for (let d = 0; d < 7; d++) {
      const day = cs.days[d]!;
      expect(day.habitualTraining).toBe(true);
      expect(day.nSessions).toBe(hab[d]!.nSessions);
      expect(day.nSessions).toBe(habitualSessionsFor(rp, d).length);
      for (let i = 0; i < day.nSessions; i++) {
        const a = day.sessions[i]!;
        const b = hab[d]!.sessions[i]!;
        expect([a.kind, a.startH, a.durationMin, a.met, a.rir]).toEqual([b.kind, b.startH, b.durationMin, b.met, b.rir]);
        expect(Array.from(a.setsByRegion)).toEqual(Array.from(b.setsByRegion));
      }
    }
    for (let d = 7; d < 13; d++) {
      const day = cs.days[d]!;
      expect(day.nSessions).toBe(habitualSessionsFor(rp, day.weekday).length + 1);
      expect(day.sessions[day.nSessions - 1]!.kind).toBe('cardio');
      expect(day.sessions[day.nSessions - 1]!.startH).toBe(7);
    }
    expect(cs.days[13]!.nSessions).toBe(0); // flag off → no implicit sessions (backward compatible)
    expect(cs.days[13]!.habitualTraining).toBeUndefined();
  });

  it('per-day override switches it off ("no training" that day); the planned activity keeps the reference at habitual', () => {
    const rp = resolveProfile(PROFILES[1]![1]);
    const s = sched(7, [asUsual(rp)]);
    s.days[0] = { program: 0, override: { habitualTraining: false } };
    const cs = compileSchedule(s, rp);
    expect(cs.days[0]!.nSessions).toBe(0);
    expect(cs.days[2]!.nSessions).toBe(1);
    // R-MAINT: a week of habitual training resolves to (almost) the habitual maintenance; one skipped lift lowers it a little
    const full = compileSchedule(sched(7, [asUsual(rp)]), rp);
    for (const day of full.days) expect(Math.abs(day.activityAdjKcal!)).toBeLessThan(1);
    expect(cs.days[0]!.activityAdjKcal!).toBeLessThan(-5);
  });

  it('no habitual sessions (sedentary): the flag compiles to rest days', () => {
    const rp = resolveProfile(PROFILES[0]![1]);
    const cs = compileSchedule(sched(7, [asUsual(rp)]), rp);
    for (const day of cs.days) expect(day.nSessions).toBe(0);
  });
});

describe('a schedule of "training as usual" days at 100 % is weight- and lean-stable for 12 weeks', () => {
  for (const [label, p] of PROFILES) {
    it(`${label}: habitual diet — |ΔFM|, |ΔLT| ≤ 0.15 kg, |Δscale| ≤ 0.3 kg, training-attributable lean flat`, () => {
      const rp = resolveProfile(p);
      const r = runEngine(rp, compileSchedule(sched(84, [asUsual(rp)]), rp), { record: 'daily' });
      const d = r.daily;
      const delta = (a: Float32Array | undefined): number => a![83]! - a![0]!;
      expect(Math.abs(delta(d.fatMass))).toBeLessThan(0.15);
      expect(Math.abs(delta(d.leanTissue))).toBeLessThan(0.15);
      expect(Math.abs(delta(d.rtMuscleGain))).toBeLessThan(0.02);
      expect(Math.abs(d.scaleWeight![77]! - d.scaleWeight![0]!)).toBeLessThan(0.3);
    });
    it(`${label}: 1.6 g/kg protein, 45 % carbohydrate (a typical program) — no training-attributable drift, |Δscale| ≤ 0.7 kg`, () => {
      const rp = resolveProfile(p);
      const t: DayTemplate = { id: 'p', label: 'p', energy: { kind: 'pctMaintenance', pct: 100 }, macros: MACROS_16, habitualTraining: true };
      const d = runEngine(rp, compileSchedule(sched(84, [t]), rp), { record: 'daily' }).daily;
      // the scale drifts down by up to ≈ 0.6 kg (sedentary 88-kg man: fat −0.46 kg): the higher-protein diet's thermic effect is
      // not in the maintenance reference by design (R-MAINT, §1.5 "diet-composition terms not"), not a training effect
      expect(Math.abs(d.scaleWeight![77]! - d.scaleWeight![0]!)).toBeLessThan(0.7);
      expect(d.leanTissue![83]! - d.leanTissue![0]!).toBeGreaterThan(-0.15);
      expect(d.rtMuscleGain![83]! - d.rtMuscleGain![0]!).toBeGreaterThan(-0.02);
    });
  }
});
