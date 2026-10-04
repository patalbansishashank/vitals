/**
 * Glue between the engine's inputs/outputs and the standalone BWP oracle (`oracle/bwp.ts`).
 * Type-only imports from the engine: the oracle itself stays independent. This file is the only place where engine data
 * shapes meet the oracle.
 *
 * Matching rule for O-1: the oracle starts from the SAME person as the engine: identical weight, height, age, sex, the
 * engine's initial fat mass (`fm0Kg`, from the body module) and the engine's baseline maintenance (`tdee0Kcal`) as EI0.
 * The comparison therefore tests the dynamics (partition, expenditure response, fast compartments), not the baseline
 * estimates. It is fed the intake the engine actually ate (the `inEnergy` series, else the compiled static days).
 */
import type { CompiledSchedule, ResolvedProfile } from '../../types';
import type { ArmView } from '../harness/view';
import { BWP, simulateBwpKcal, type BwpInput, type BwpTrajectory } from './bwp';

/** The BWP input equivalent to a resolved engine profile (same body, engine baseline EI0 and fat mass). */
export function bwpInputFromProfile(p: ResolvedProfile, opts: { matchEngineBaseline?: boolean } = {}): BwpInput {
  const match = opts.matchEngineBaseline ?? true;
  return {
    sex: p.sex,
    weightKg: p.weightKg,
    heightM: p.heightM,
    ageYears: p.ageYears,
    ...(match ? { baselineEiMj: p.tdee0Kcal / BWP.kcalPerMj, bodyFatKg: p.fm0Kg } : {}),
  };
}

/** Daily intake (kcal/d) the engine was fed: the realised `inEnergy` series when present, else the compiled days. */
export function intakeKcalFromArm(v: ArmView): Float64Array {
  const inE = v.daily('inEnergy');
  const n = v.nDays;
  const out = new Float64Array(n);
  for (let d = 0; d < n; d++) out[d] = inE ? (inE[d] as number) : (v.compiled.days[d]?.energyKcal ?? 0);
  return out;
}

/** Same, from a compiled schedule alone (static days; runtime days carry their baseline resolution). */
export function intakeKcalFromCompiled(c: CompiledSchedule): Float64Array {
  const out = new Float64Array(c.nDays);
  for (let d = 0; d < c.nDays; d++) out[d] = c.days[d]?.energyKcal ?? 0;
  return out;
}

const memo = new WeakMap<ArmView, BwpTrajectory>();

/** BWP trajectory for an engine arm (memoised per view). Index i = start of day i, like `daily` index i for 'end' series shifted by one. */
export function bwpForArm(v: ArmView): BwpTrajectory {
  let t = memo.get(v);
  if (!t) {
    t = simulateBwpKcal(bwpInputFromProfile(v.profile), intakeKcalFromArm(v));
    memo.set(v, t);
  }
  return t;
}

/** Engine minus oracle body weight after n days, kg. */
export function bwDiffVsBwp(v: ArmView, n: number): number {
  return v.after('scaleWeight', n) - bwpForArm(v).bwKg[n]!;
}

/** Engine minus oracle fat mass after n days, kg. */
export function fatDiffVsBwp(v: ArmView, n: number): number {
  return v.after('fatMass', n) - bwpForArm(v).fatKg[n]!;
}
