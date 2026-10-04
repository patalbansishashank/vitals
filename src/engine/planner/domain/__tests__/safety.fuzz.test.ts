// @vitest-environment node
/**
 * 18 §7.4.1 safety fuzzing: random persons × goal lists × practical constraints × screening outcomes → every decoded
 * and repaired plan the planner could return passes the independent validator (separate code path); infeasible or
 * blocked requests are reported as such. (The optimiser only ever returns decoded + repaired + validated plans, so
 * covering the decode/repair space covers the returned plans; full planner runs are in planner.e2e.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../optim/rng';
import type { PersonProfile } from '../../../types/profile';
import { compileRequest } from '../context';
import { decodePlan } from '../decode';
import { repairSchedule } from '../repair';
import { enumerateStructures } from '../skeleton';
import { validatePlan } from '../validate';
import type { PlannerRequest, RankedGoal } from '../types';

const GOALS: RankedGoal[] = [
  { metric: 'fatMass', direction: 'minimise' },
  { metric: 'leanTissue', direction: 'maximise' },
  { metric: 'autophagyIdx', direction: 'maximise' },
  { metric: 'ldl', direction: 'minimise' },
  { metric: 'hoursInKetosis', direction: 'maximise' },
  { metric: 'vo2max', direction: 'maximise' },
  { metric: 'igf1', direction: 'target', target: -10, targetKind: 'change' },
  { metric: 'hunger', direction: 'minimise' },
  { metric: 'triglycerides', direction: 'minimise' },
  { metric: 'strength', direction: 'maximise' },
];
const LOCKS = ['deficit-cap', 'rate-cap', 'max-fast', 'min-eating-window', 'no-ketogenic', 'carb-floor', 'protein-cap', 'protein-floor', 'no-creatine', 'fat-floor', 'exercise-light-moderate', 'exercise-low-impact', 'no-exercise-prescription', 'no-deficit'];
const LOCK_VAL: Record<string, [number, number]> = { 'deficit-cap': [5, 25], 'rate-cap': [0.25, 1], 'max-fast': [12, 72], 'min-eating-window': [6, 12], 'carb-floor': [50, 130], 'protein-cap': [1.3, 2.2], 'protein-floor': [0.8, 1.2], 'fat-floor': [30, 50] };

function randomRequest(rng: Rng): PlannerRequest {
  const sex = rng.float() < 0.5 ? 'male' : 'female';
  const heightCm = sex === 'male' ? 160 + rng.float() * 35 : 150 + rng.float() * 30;
  const bmi = 18.5 + rng.float() * 22;
  const profile: PersonProfile = {
    schemaVersion: 1,
    body: { sex, ageYears: 18 + Math.floor(rng.float() * 62), heightCm, weightKg: +(bmi * (heightCm / 100) ** 2).toFixed(1) },
    habits: {
      sessionsPerWeek: Math.floor(rng.float() * 6),
      trainingHistory: (['none', 'lt1y', '1to3y', 'gt3y'] as const)[rng.int(4)]!,
      typicalSteps: 2000 + Math.floor(rng.float() * 14000),
      bedTimeH: 21 + rng.float() * 3.5,
      wakeTimeH: 5 + rng.float() * 3,
    },
    startDate: `2026-10-0${1 + rng.int(7)}`,
  };
  if (rng.float() < 0.2) profile.safety = { mode: 'M0', flags: { kidneyDisease: rng.float() < 0.5, gout: rng.float() < 0.5, hotClimate: rng.float() < 0.5 } };
  const k = 1 + rng.int(4);
  const perm = rng.permutation(GOALS.length).slice(0, k);
  const goals = perm.map((i) => GOALS[i]!);
  const locks = LOCKS.filter(() => rng.float() < 0.12).map((id) => {
    const r = LOCK_VAL[id];
    return r ? { id, value: +(r[0] + rng.float() * (r[1] - r[0])).toFixed(1) } : { id };
  });
  const earliest = 5 + rng.float() * 5;
  const allowed = [0, 1, 2, 3, 4, 5, 6].filter(() => rng.float() < 0.75) as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  return {
    profile,
    goals,
    horizonDays: 28 + rng.int(156),
    constraints: {
      trainingDaysPerWeek: { min: rng.int(2), max: 1 + rng.int(6) },
      allowedTrainingWeekdays: allowed,
      trainingTimeH: 6 + rng.float() * 14,
      maxSessionMin: 30 + rng.int(90),
      cardioDaysPerWeek: { min: 0, max: rng.int(5) },
      cardioModality: (['walk', 'run', 'cycle', 'swim', 'hiit'] as const)[rng.int(5)]!,
      eatingWindow: { earliestH: earliest, latestH: earliest + 6 + rng.float() * 10 },
      mealsPerDay: { min: 2, max: 2 + rng.int(4) },
      excludedLevers: ['waterFast', 'fastDay24', 'refeedDay', 'L7', 'B2', 'zeroDay'].filter(() => rng.float() < 0.15),
      prefersFasting: rng.float() < 0.3,
      fasting: rng.float() < 0.1 ? 'none' : 'allowed',
      hungerTolerance: (['low', 'medium', 'high'] as const)[rng.int(3)]!,
      ...(rng.float() < 0.2 ? { maxFastHours: [12, 20, 24, 36, 48, 72][rng.int(6)]! } : {}),
      ...(rng.float() < 0.15 ? { proteinFloorGPerKg: +(0.8 + rng.float() * 1.4).toFixed(2) } : {}),
      ...(rng.float() < 0.15 ? { carbFloorGPerDay: Math.round(20 + rng.float() * 130) } : {}),
    },
    safety: {
      mode: rng.float() < 0.1 ? 'R1' : rng.float() < 0.15 ? 'R2' : 'M0',
      plannerLocks: locks,
      optIns: { fastingTier: rng.float() < 0.4 ? (['T2', 'T3', 'T4'] as const)[rng.int(3)]! : null, shortEatingWindow: rng.float() < 0.2 },
      expertMode: rng.float() < 0.2,
    },
  };
}

describe('7.4.1 safety fuzzing (independent validator)', () => {
  it('every decoded + repaired plan for random persons/goals/constraints passes the validator', () => {
    const rng = new Rng(Number(process.env.FUZZ_SEED ?? 17));
    let plans = 0;
    let blocked = 0;
    const N = Number(process.env.FUZZ_N ?? 1500);
    for (let i = 0; i < N; i++) {
      const req = randomRequest(rng);
      const ctx = compileRequest(req);
      if (ctx.caps.blocked || ctx.problems.length) {
        blocked++;
        continue;
      }
      const sts = enumerateStructures(ctx);
      for (let j = 0; j < 2; j++) {
        const st = sts[j === 0 ? 0 : 1 + rng.int(Math.max(1, sts.length - 1))] ?? sts[0]!;
        const x = Float64Array.from({ length: st.dim }, () => rng.float());
        const plan = decodePlan(ctx, st, x);
        const { schedule } = repairSchedule(ctx, plan.schedule, plan);
        const v = validatePlan(ctx, schedule);
        if (!v.ok) throw new Error(`request #${i} ${st.id}: ${v.reasons.join('; ')}\n${JSON.stringify(req)}`);
        plans++;
      }
    }
    expect(plans).toBeGreaterThan(N);
    expect(blocked).toBeLessThan(N / 2);
  }, 300_000);
});
