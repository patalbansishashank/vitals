/**
 * R-MAINT (QA ruling 2026-09-30, docs/QA_FINDINGS.md; MODEL_SPEC §5.2 "Maintenance reference"): what "% of maintenance"
 * resolves against.
 *
 *   reference = habitual maintenance − habitual exercise energy + the schedule's planned exercise energy
 *
 * "Exercise energy" is the activity as the activity module books it into TDEE (MODEL_SPEC §1.2 steps 2-3, 6): session
 * energy net of the person's own RMR minus the displaced lifestyle baseline, plus EPOC and the post-RT REE elevation, plus
 * step energy above the habitual steps — estimated per day with the nominal registry at the t = 0 body (mass, RMR0,
 * training status) and at the VO2max the activity module will have that day (its 10 §4.8 two-pool response to the planned
 * aerobic dose, replayed here: a session given as a fraction of VO2max costs more as fitness rises), with the same
 * function the module uses for `exPlannedKcalD` (`activity.sessionsBookedKcal`), and
 * averaged over the day's window (the schedule block/phase that contains the day, else its 7-day week counted from the
 * schedule start) so that daily intake is not jagged. The habitual reference is the same estimate on the burn-in's
 * habitual week (cyclic), so a user who keeps their habitual training gets a zero adjustment exactly.
 *
 * Two forms of the adjustment (kcal/d), both consistent with the engine's own rules so that a person at 100 % on the
 * planned activity is weight-stable after transients:
 *  - `adjBaseline` (static 'baseline' days, fixed at compile time) — the steady state: Δ = planned − habitual booked
 *    activity; metabolic compensation at its equilibrium comp = −min(c_met(BMI0)·max(0, Δ), 5 % RMR0) (10 §4.3, energy
 *    §1.5 step 3, which acts on the same Δ = 7-day mean net exercise energy above EAT0); the extra intake carries its own
 *    TEF (α0) and adaptive thermogenesis AT* = β·ΔEI (02 §4.8; β⁺ for more intake, β for less), so
 *    ΔR = (Δ + comp)/(1 − α0 − β).
 *  - `adjRuntime` ('current' / 'blockStart' days, added to energy's instantaneous maintenance at habitual activity,
 *    which already carries the current compensation and AT states): Δ/(1 − α0). The feedback through the AT and
 *    compensation states converges to the same steady state.
 * `EnergySpec.activity: 'habitual'` opts a day out (adjustment 0: % of the habitual intake, e.g. a study protocol).
 *
 * Activity intake (MODEL_SPEC §5.5, R1 §3.1): the intake's occupational, home, commute and recreational energy is part of
 * TDEE0 and lives inside energy's NEAT0 — it is "life as usual" in every plan, so it is NOT booked here; the habitual steps
 * `habSteps` (= `habits.typicalSteps`) are the intake's weekly-mean S_hab, so a plan's steps count against S_hab and the
 * habitual week (every day at S_hab) books exactly zero. Two people with the same body and S_hab but different jobs get
 * the same Δ for the same plan; their references differ by their TDEE0 (`core/__tests__/activityIntake.rMaint.test.ts`).
 *
 * Allocation allowed: runs once per compile (the per-profile constants are cached).
 */
import type { DayInput } from '../types/inputs';
import type { ModelParams } from '../types/params';
import type { ResolvedProfile } from '../types/profile';
import type { ScheduleBlock } from '../types/schedule';
import { buildModelParams } from './paramsRegistry';
import {
  activityConstants,
  activityModule,
  dayAerobicDose,
  firstRtEndH,
  sessionsBookedKcal,
  updateGainPool,
  vo2GainTarget,
  type ActivityModK,
} from '../model/activity';
import { energyModule, nonAlcoholTef, prepareEnergy, type EnergyK } from '../model/energy';
import { muscleModule, trainingStatus0 } from '../model/muscle';
import { readMuscleConstants } from '../model/muscle/constants';
import { moderatorsModule } from '../model/moderators';
import type { ModuleContext } from '../types/module';
import { ATWATER, DEFAULTS } from './defaults';

/** Modules whose nominal parameters the estimator reads (activity, energy; muscle for TS₀; moderators for a_lut). */
const REF_MODULES = [moderatorsModule, activityModule, energyModule, muscleModule] as const;

/** Per-profile constants of the estimator (nominal registry, t = 0 state). */
export interface ActivityRefConstants {
  act: ActivityModK;
  en: EnergyK;
  /** Whole-body training status at t = 0 (post-RT REE shield, 09 §4.13). */
  ts0: number;
  /** RMR0, kcal/h. */
  rmrH: number;
  /** Entered body mass, kg, and BMI. */
  bw: number;
  bmi: number;
  /** Step energy above baseline, kcal per step (10 §4.14, obesity factor included). */
  stepK: number;
  /** Habitual TEF fraction α0 (02 §4.4 on the habitual macro grams, energy init). */
  alpha0: number;
  /** c_met at the t = 0 BMI and the compensation cap (kcal/d). */
  cMet: number;
  compCapKcal: number;
  /** β (less intake) and β⁺ (more intake) of the AT drive. */
  betaMinus: number;
  betaPlus: number;
  /** Mean booked activity energy of the habitual week (cyclic), kcal/d. */
  habitualKcal: number;
  /** Booked activity of the habitual week's days by weekday (0 = Monday), kcal, cyclic steady state. */
  habitualByWeekday: Float64Array;
  /** Post-RT REE hours left at the start of each habitual weekday (cyclic steady state). */
  habitualPostRtLeft: Float64Array;
  /** Aerobic dose of each habitual weekday: MEM (moderate-equivalent minutes) and minutes at x ≥ hardX. */
  habitualMem: Float64Array;
  habitualHi: Float64Array;
  /** True when the habitual week carries sessions (the activity module then anchors VO2max on the observed dose). */
  habitualReal: boolean;
}

let nominal: ModelParams | null = null;
const cache = new WeakMap<ResolvedProfile, ActivityRefConstants>();

function nominalParams(): ModelParams {
  if (!nominal) nominal = buildModelParams(REF_MODULES);
  return nominal;
}

/** Post-RT REE hours booked on `day` given `left` hours of elevation at its start; writes the carry-out into `out[0]`. */
function postRtHours(day: DayInput, left: number, out: Float64Array, postRtHoursMax: number): number {
  const first = firstRtEndH(day);
  let hrs: number;
  if (first < 24) {
    hrs = left >= first ? 24 : left + (24 - first);
    let last = first;
    for (let i = 0; i < day.nSessions; i++) {
      const se = day.sessions[i]!;
      if (se.kind !== 'resistance' || !(se.durationMin > 0)) continue;
      const end = se.startH + se.durationMin / 60;
      if (end > last) last = end;
    }
    const carry = postRtHoursMax - (24 - Math.min(24, Math.ceil(last)));
    out[0] = Math.max(left - 24, carry, 0);
  } else {
    hrs = left < 24 ? left : 24;
    out[0] = left > 24 ? left - 24 : 0;
  }
  return hrs;
}

/** Booked activity energy of one day (sessions + post-RT REE + steps above habitual), kcal, at the t = 0 state. */
function dayActivityKcal(c: ActivityRefConstants, day: DayInput, postRtHrs: number, vo2max: number): number {
  const a = c.act;
  const sessions = day.nSessions > 0 ? sessionsBookedKcal(a, day, vo2max, c.bw, c.bmi, c.rmrH) : 0;
  const postRt = a.postRtRee * c.rmrH * (1 - a.postRtShield * c.ts0) * postRtHrs;
  const steps = c.stepK * ((day.steps > 0 ? day.steps : 0) - a.habSteps);
  return sessions + postRt + steps;
}

/**
 * Estimator constants for `profile` (cached per profile object). `habitualWeek` = the burn-in week (7 DayInputs by weekday,
 * `core/compileSchedule.habitualWeek`), passed in to keep this module free of the compiler.
 */
export function activityRefConstants(profile: ResolvedProfile, habitualWeek: () => readonly DayInput[]): ActivityRefConstants {
  const hit = cache.get(profile);
  if (hit) return hit;
  const params = nominalParams();
  const act = activityConstants(params, profile);
  const en = prepareEnergy({ params, checks: false } as unknown as ModuleContext);
  const mk = readMuscleConstants(params, false);
  const ts0 = Math.max(0, Math.min(1, trainingStatus0(mk, profile).ts0));
  const bw = profile.weightKg;
  const bmi = bw / (profile.heightM * profile.heightM);
  const stepK = (act.stepsNet * (bmi >= act.obesityBmi ? act.obesityFactor : 1) * bw) / 1000;
  const alcG = (profile.habits.habitualAlcoholDrinksPerWeek * DEFAULTS.gramsPerDrink) / 7;
  const tef0 =
    nonAlcoholTef(en, profile.habitualProteinG, profile.habitualCarbG, profile.habitualFatG, 0, profile.habitualFibreG) +
    en.tefAlc * ATWATER.alcohol * alcG;
  const alpha0 = profile.tdee0Kcal > 0 ? tef0 / profile.tdee0Kcal : 0;
  let cMet = en.cMet + en.cMetPerBmi * Math.min(en.cMetBmiHi, Math.max(en.cMetBmiLo, bmi - en.cMetBmiRef));
  if (cMet < 0) cMet = 0;
  const c: ActivityRefConstants = {
    act,
    en,
    ts0,
    rmrH: profile.rmr0Kcal / 24,
    bw,
    bmi,
    stepK,
    alpha0,
    cMet,
    compCapKcal: en.compCapFrac * profile.rmr0Kcal,
    betaMinus: en.betaAT,
    betaPlus: en.betaATPlus,
    habitualKcal: 0,
    habitualByWeekday: new Float64Array(7),
    habitualPostRtLeft: new Float64Array(7),
    habitualMem: new Float64Array(7),
    habitualHi: new Float64Array(7),
    habitualReal: false,
  };
  // habitual week, cyclic steady state: two passes, the second one books (post-RT carry-over wraps around the week)
  const week = habitualWeek();
  const out = new Float64Array(2);
  for (let wd = 0; wd < 7; wd++) {
    const day = week[wd]!;
    if (day.nSessions > 0) c.habitualReal = true;
    dayAerobicDose(act, day, act.v0, bw, bmi, c.rmrH, out);
    c.habitualMem[wd] = out[0]!;
    c.habitualHi[wd] = out[1]!;
  }
  let left = 0;
  let sum = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let wd = 0; wd < 7; wd++) {
      const day = week[wd]!;
      if (pass === 1) c.habitualPostRtLeft[wd] = left;
      const hrs = postRtHours(day, left, out, act.postRtHours);
      left = out[0]!;
      if (pass === 1) {
        const e = dayActivityKcal(c, day, hrs, act.v0);
        c.habitualByWeekday[wd] = e;
        sum += e;
      }
    }
  }
  c.habitualKcal = sum / 7;
  cache.set(profile, c);
  return c;
}

/** Per-day results of the estimator (length = number of days). */
export interface ActivityReference {
  /** Booked activity energy of each day at the t = 0 state (sessions + post-RT REE + steps above habitual), kcal. */
  dayKcal: Float64Array;
  /** Δ_d = window mean of `dayKcal` − habitual weekly mean, kcal/d (raw, before compensation, TEF and AT). */
  delta: Float64Array;
  /** Steady-state reference shift for static ('baseline') days, kcal/d: (Δ + comp)/(1 − α0 − β). */
  adjBaseline: Float64Array;
  /** Instantaneous shift for runtime ('current', 'blockStart') days, kcal/d: Δ/(1 − α0). */
  adjRuntime: Float64Array;
  /** The estimator's constants (habitual mean, α0, c_met …). */
  constants: ActivityRefConstants;
}

/** Steady-state reference shift for a raw booked-activity difference Δ (kcal/d); see the file header. */
export function baselineShift(c: ActivityRefConstants, delta: number): number {
  const want = c.cMet * (delta > 0 ? delta : 0);
  const comp = -(want < c.compCapKcal ? want : c.compCapKcal);
  const dTee = delta + comp;
  const beta = dTee >= 0 ? c.betaPlus : c.betaMinus;
  return dTee / (1 - c.alpha0 - beta);
}

/**
 * The R-MAINT reference shift for every compiled day. `days` are compiled DayInputs (sessions and steps resolved),
 * `blocks` the schedule's phases, `startWeekday` the weekday of day 0 (the burn-in's last days precede it).
 */
export function activityReference(
  profile: ResolvedProfile,
  days: readonly DayInput[],
  blocks: readonly ScheduleBlock[],
  startWeekday: number,
  habitualWeek: () => readonly DayInput[],
): ActivityReference {
  const c = activityRefConstants(profile, habitualWeek);
  const a = c.act;
  const n = days.length;
  const dayKcal = new Float64Array(n);
  const out = new Float64Array(2);
  // VO2max state at t = 0 (activity init / anchorToHabitualDose): the habitual weekly dose is the equilibrium
  const memHist = new Float64Array(n + 7);
  const hiHist = new Float64Array(n + 7);
  let memWk = 0;
  let hiWk = 0;
  for (let j = 0; j < 7; j++) {
    const wd = (((startWeekday - 7 + j) % 7) + 7) % 7;
    memHist[j] = c.habitualReal ? c.habitualMem[wd]! : a.memHabWk / 7;
    hiHist[j] = c.habitualReal ? c.habitualHi[wd]! : 0;
    memWk += memHist[j]!;
    hiWk += hiHist[j]!;
  }
  const g0 = vo2GainTarget(memWk, a);
  const vSed = a.v0 / (1 + g0);
  const fs = a.fastShare;
  let poolF = fs * g0;
  let poolS = (1 - fs) * g0;
  let gPeak = g0;
  let vo2 = a.v0;
  // post-RT carry-in at t = 0: the burn-in ends with the habitual weekday before day 0 (cyclic steady state)
  let left = c.habitualPostRtLeft[startWeekday % 7]!;
  for (let d = 0; d < n; d++) {
    const day = days[d]!;
    const hrs = postRtHours(day, left, out, a.postRtHours);
    left = out[0]!;
    dayKcal[d] = dayActivityKcal(c, day, hrs, vo2);
    // end of day d (activity endOfDay, 10 §4.8): rolling 7-day dose → two-pool VO2max response with detraining
    dayAerobicDose(a, day, vo2, c.bw, c.bmi, c.rmrH, out);
    memHist[d + 7] = out[0]!;
    hiHist[d + 7] = out[1]!;
    memWk += out[0]! - memHist[d]!;
    hiWk += out[1]! - hiHist[d]!;
    const m0 = hiWk / a.hiRef;
    const m = m0 < 1 ? m0 : 1;
    const fallF = 1 - Math.exp(-((1 - a.detrainShield * m) / a.tauDn));
    const gStar = vo2GainTarget(memWk > 0 ? memWk : 0, a);
    poolF = updateGainPool(poolF, fs * gStar, a.riseF, fallF, a.rho * fs * gPeak);
    poolS = updateGainPool(poolS, (1 - fs) * gStar, a.riseS, fallF, a.rho * (1 - fs) * gPeak);
    const gTot = poolF + poolS;
    if (gTot > gPeak) gPeak = gTot;
    const v = vSed * (1 + gTot);
    vo2 = v < 8 ? 8 : v > 90 ? 90 : v;
  }
  const pre = new Float64Array(n + 1);
  for (let d = 0; d < n; d++) pre[d + 1] = pre[d]! + dayKcal[d]!;
  const delta = new Float64Array(n);
  const adjBaseline = new Float64Array(n);
  const adjRuntime = new Float64Array(n);
  for (let d = 0; d < n; d++) {
    let a = -1;
    let b = -1;
    for (let i = 0; i < blocks.length; i++) {
      const bl = blocks[i]!;
      if (d >= bl.startDay && d < bl.endDay) {
        a = Math.max(0, bl.startDay);
        b = Math.min(n, bl.endDay);
      }
    }
    if (a < 0) {
      a = 7 * Math.floor(d / 7);
      b = Math.min(n, a + 7);
      if (b - a < 7 && n >= 7) {
        a = n - 7;
        b = n;
      } else if (b - a < 7) {
        a = 0;
        b = n;
      }
    }
    const mean = (pre[b]! - pre[a]!) / (b - a);
    const dl = mean - c.habitualKcal;
    delta[d] = dl;
    adjBaseline[d] = baselineShift(c, dl);
    adjRuntime[d] = dl / (1 - c.alpha0);
  }
  return { dayKcal, delta, adjBaseline, adjRuntime, constants: c };
}
