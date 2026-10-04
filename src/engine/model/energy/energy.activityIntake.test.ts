// @vitest-environment node
/**
 * NEAT0 calibration with the activity intake (MODEL_SPEC §3.4, §5.5; R1 §3.1): the intake's occupational, home, commute and
 * recreational energy enter TDEE0, energy's `init` puts them in NEAT0 (= TDEE0 − RMR0 − TEF0 − EAT0) and the burn-in
 * calibration keeps them there (model TEE = habitual intake). Full 16-module engine, habitual week at 100 % of maintenance.
 */
import { compileSchedule, habitualWeekPrograms } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { ActivityIntake, PersonProfile, ResolvedProfile, Schedule } from '../../types';

vi.setConfig({ testTimeout: 120_000 });

const START = '2026-10-05';
const body: PersonProfile['body'] = { sex: 'female', ageYears: 40, heightCm: 166, weightKg: 70, knownBodyFatPct: 32, knownBodyFatSource: 'dxa' };
const DESK: ActivityIntake = { work: 'desk', steps: { source: 'wrist', workday: 7000, offDay: 6000 } };
const HEAVY: ActivityIntake = { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 } };

function habitualRun(activity: ActivityIntake, days = 28) {
  const p: PersonProfile = { schemaVersion: 1, body, habits: { activity }, startDate: START };
  const rp = resolveProfile(p);
  const programs = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 100 } }));
  const s: Schedule = { schemaVersion: 1, startDate: START, horizonDays: days + 1, programs, days: Array.from({ length: days + 1 }, (_, d) => ({ program: (rp.startWeekday + d) % 7 })) };
  const r = runEngine(rp, compileSchedule(s, rp), { record: 'daily', checks: true });
  return { rp, r };
}
const mean = (a: Float32Array, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]!;
  return s / (to - from);
};
const activityOf = (rp: ResolvedProfile) => rp.activity!;

describe('energy NEAT0 carries the intake (burn-in calibration)', () => {
  const desk = habitualRun(DESK);
  const heavy = habitualRun(HEAVY);

  it('model NEAT ≈ the intake`s NEAT0 (± 2 % of TDEE0: the calibration absorbs what the closed form misses) and TEE ≈ TDEE0 (± 2 %)', () => {
    for (const { rp, r } of [desk, heavy]) {
      const neat = mean(r.daily.neat!, 7, 28);
      expect(Math.abs(neat - activityOf(rp).neatKcal)).toBeLessThan(0.02 * rp.tdee0Kcal);
      expect(Math.abs(mean(r.daily.tdee!, 7, 28) / rp.tdee0Kcal - 1)).toBeLessThan(0.02);
      expect(Math.abs(r.daily.scaleWeight![28]! - r.daily.scaleWeight![0]!)).toBeLessThan(0.3);
    }
  });

  it('the NEAT difference between the jobs is the intake`s (steps + occupation) difference (± 5 %)', () => {
    const dModel = mean(heavy.r.daily.neat!, 7, 28) - mean(desk.r.daily.neat!, 7, 28);
    const dIntake = activityOf(heavy.rp).neatKcal - activityOf(desk.rp).neatKcal;
    expect(dIntake).toBeGreaterThan(700);
    expect(Math.abs(dModel / dIntake - 1)).toBeLessThan(0.05);
  });

  it('the maintenance metric at t = 0 equals TDEE0 for both (± 1 %)', () => {
    for (const { rp, r } of [desk, heavy]) expect(Math.abs(r.daily.maintenance![0]! / rp.tdee0Kcal - 1)).toBeLessThan(0.01);
  });
});
