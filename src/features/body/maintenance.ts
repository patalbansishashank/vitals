/**
 * Maintenance energy for Your body and the intake — the SAME baseline the Simulator uses.
 *
 * The value is the engine's `resolveProfile(profile).tdee0Kcal` (docs/MODEL_SPEC.md §5.1.3, §5.5). The schedule's
 * "% of maintenance" resolves against this exact number (`energy.reference = 'baseline'`), so the screens can never
 * disagree. The likely range and what drives the number come from the engine too: `ResolvedProfile.activity` carries
 * the drivers (in display order, summing to TDEE0), σ with its p10/p90 band, the PAL, its NASEM category, the cap flag
 * and the largest unknown. Live what-ifs re-run `resolveActivity(changedIntake, resolved.activity.base)` (closed form).
 *
 * Only hand-built profiles without `activity` fall back to the size-of-equation band (cv0 0.12 / 0.10 / 0.08).
 */
import { resolveProfile } from '@/engine/core/resolveProfile';
import { resolveActivity } from '@/engine/intake/activity';
import type { ActivityDriver, ActivityDriverId, ActivityIntake, NeatLevel, PersonProfile, ResolvedActivity, ResolvedProfile } from '@/engine/types/profile';

/** z for the 10th–90th percentile band ("likely range = 80 % of people like you"). */
export const Z80 = 1.2815515655446004;

export type RmrMethod = 'measured' | 'lean-mass' | 'size-and-age';

export interface MaintenanceEstimate {
  /** Weight-stable intake at baseline, kcal/day (= resolveProfile().tdee0Kcal). */
  kcal: number;
  /** 80 % likely range, kcal/day (engine p10/p90). */
  band80: [number, number];
  /** Relative SD of the band (σ/TDEE0). */
  cv: number;
  /** 1-SD uncertainty, kcal/day. */
  sigmaKcal: number;
  /** Resting metabolic rate at baseline, kcal/day. */
  rmrKcal: number;
  /** Which RMR route the engine took (02 §4.1 selection rule). */
  rmrMethod: RmrMethod;
  /** Activity the estimate assumes (resolved habits, defaults applied). */
  steps: number;
  sessionsPerWeek: number;
  /** What the number is made of (engine order; Σ = kcal). Empty for hand-built profiles. */
  drivers: readonly ActivityDriver[];
  /** The engine's resolved activity (undefined only for hand-built profiles). */
  activity: ResolvedActivity | undefined;
  /** The resolved profile, for callers that need more of it. */
  resolved: ResolvedProfile;
}

function rmrMethodOf(p: PersonProfile, act: ResolvedActivity | undefined): RmrMethod {
  if (act) return act.base.rmrRoute === 'measured' ? 'measured' : act.base.rmrRoute === 'ffm' ? 'lean-mass' : 'size-and-age';
  if (p.labs?.measuredRmrKcal && p.labs.measuredRmrKcal > 0) return 'measured';
  const src = p.body.knownBodyFatSource;
  if (p.body.knownBodyFatPct !== undefined && (src === 'dxa' || src === 'bia')) return 'lean-mass';
  return 'size-and-age';
}

/** Maintenance energy with its likely range and drivers, from the engine's resolved profile. */
export function estimateMaintenance(profile: PersonProfile, resolved: ResolvedProfile = resolveProfile(profile)): MaintenanceEstimate {
  const act = resolved.activity;
  const method = rmrMethodOf(profile, act);
  const kcal = resolved.tdee0Kcal;
  let band80: [number, number];
  let sigma: number;
  if (act) {
    band80 = [act.uncertainty.p10, act.uncertainty.p90];
    sigma = act.uncertainty.sigmaKcal;
  } else {
    const cv0 = method === 'measured' ? 0.08 : method === 'lean-mass' ? 0.1 : 0.12;
    sigma = cv0 * kcal;
    band80 = [kcal - Z80 * sigma, kcal + Z80 * sigma];
  }
  return {
    kcal,
    band80,
    cv: kcal > 0 ? sigma / kcal : Number.NaN,
    sigmaKcal: sigma,
    rmrKcal: resolved.rmr0Kcal,
    rmrMethod: method,
    steps: resolved.habits.typicalSteps,
    sessionsPerWeek: resolved.habits.sessionsPerWeek,
    drivers: act?.drivers ?? [],
    activity: act,
    resolved,
  };
}

/* ------------------------------------------------------------------------------------------- explanation */

/** What drove the estimate (the shape `profile.explainMaintenance` returns, SUITE_SPEC §1.9; design §10). */
export interface MaintenanceExplanation {
  tdee0Kcal: number;
  sigmaKcal: number;
  band80: [number, number];
  drivers: readonly ActivityDriver[];
  /** Drivers whose answer was skipped (drawn dashed). */
  defaulted: readonly ActivityDriverId[];
  /** Shown only when fixing it would narrow the shown range by ≥ 20 kcal. */
  biggestUnknown?: { driver: ActivityDriverId; narrowsByKcal: number };
  palBandLabel: NeatLevel | null;
  palFlag: ResolvedActivity['palFlag'];
  pal0: number | null;
}

/** Minimum narrowing of the shown range (kcal, each side) worth offering a fix for. */
export const BIGGEST_UNKNOWN_MIN_KCAL = 20;

/**
 * How much the shown range (each side, kcal) would narrow if this driver were known: steps from a 2–4-week device
 * average, the work card picked, or the resting metabolism measured. Other drivers keep their uncertainty when
 * answered, so they report 0. `intake` = the activity answers in force (undefined = none yet).
 */
export function narrowingWith(driver: ActivityDriverId, act: ResolvedActivity, intake: ActivityIntake | undefined): number {
  let next: ResolvedActivity | null = null;
  const base = act.base;
  if (driver === 'steps' && act.stepsSource !== 'wrist') next = resolveActivity({ ...(intake ?? {}), steps: { source: 'wrist', weeklyMean: act.steps } }, base);
  else if (driver === 'work' && act.work === 'unknown') next = resolveActivity({ ...(intake ?? {}), work: 'mixed' }, base);
  else if (driver === 'rmr' && base.rmrRoute !== 'measured') next = resolveActivity(intake, { ...base, rmrRoute: 'measured' });
  if (!next) return 0;
  return Math.max(0, Z80 * (act.uncertainty.sigmaKcal - next.uncertainty.sigmaKcal));
}

/** The maintenance explanation from an estimate (pure; `intake` = the activity answers in force). */
export function explainMaintenance(m: MaintenanceEstimate, intake: ActivityIntake | undefined, defaulted: readonly ActivityDriverId[] = []): MaintenanceExplanation {
  const act = m.activity;
  let biggestUnknown: MaintenanceExplanation['biggestUnknown'];
  if (act) {
    const order = Array.from(new Set<ActivityDriverId>([act.uncertainty.largest, 'steps', 'work', 'rmr']));
    let best: { driver: ActivityDriverId; narrowsByKcal: number } | undefined;
    for (const d of order) {
      const n = narrowingWith(d, act, intake);
      if (n >= BIGGEST_UNKNOWN_MIN_KCAL && (!best || n > best.narrowsByKcal + 1e-9)) best = { driver: d, narrowsByKcal: n };
      // the engine's largest unknown wins when it is fixable
      if (best && d === act.uncertainty.largest) break;
    }
    biggestUnknown = best;
  }
  return {
    tdee0Kcal: m.kcal,
    sigmaKcal: m.sigmaKcal,
    band80: m.band80,
    drivers: m.drivers,
    defaulted,
    ...(biggestUnknown ? { biggestUnknown } : {}),
    palBandLabel: act?.neatLevel ?? null,
    palFlag: act?.palFlag ?? 'ok',
    pal0: act ? act.pal0 : null,
  };
}

/** Round to 10 kcal for display (design: headline and band rounded to 10). */
export const round10 = (x: number): number => Math.round(x / 10) * 10;
