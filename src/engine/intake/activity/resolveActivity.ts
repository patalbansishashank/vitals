/**
 * Activity intake → habitual activity and baseline maintenance (plan/01-after-launch/research/R1-activity-intake.md §3;
 * MODEL_SPEC §5.5). Pure, deterministic, allocation only for the returned objects; runs once per `resolveProfile`.
 *
 *   S_hab  = (d_w·S_w + (7 − d_w)·S_o)/7                      weekly-mean habitual steps (engine `typicalSteps`, `habSteps`)
 *            S_w = S_class(work) + c_walk·m_walk (no device),  S_o = S_off(offDay)
 *   E_occ  = BW·h_work·e_occ(class)·d_w/7                      occupation above seated rest, steps excluded
 *   E_home = BW·h_feet_home·e_home
 *   E_cyc  = BW·(MET_cyc − 1)·m_cyc/60·d_w/7
 *   E_rec  = BW·Σ(MET_k − 1)·min_k/60/7                        sport/hobbies that are NOT planned training
 *   TDEE0  = (RMR0·(1 + f_ns) + kStep·BW·S_hab + E_occ + E_home + E_cyc + E_rec + EAT0)/(1 − α0)
 *   PAL0   = TDEE0/RMR0: 'high' above 2.4 (warn); the non-step answers are scaled down so they never push PAL0 above 2.5
 *   σ²     = (cv_RMR·1.15·RMR0)² + (kStep·BW·S_hab)²(cv_steps² + cv_cost²) + (BW·h_work·d_w/7·sd_occ)²
 *            + (0.6·E_home)² + (0.5·E_rec)² + (0.3·E_cyc)² + (0.2·EAT0)²
 *   σ_TDEE0 = max(√σ²/(1 − α0), floor·TDEE0);  p10/p90 = TDEE0 ∓ 1.2816·σ
 *
 * The non-step terms live inside NEAT0 (energy `init`: NEAT0 = TDEE0 − RMR0 − TEF0 − EAT0; the burn-in calibration re-anchors
 * it on the realised habitual intake), so R-MAINT's habitual-vs-planned Δ (sessions and steps above S_hab) is untouched: a
 * plan that does not schedule work, chores, commute or hobbies assumes the person keeps living their life.
 *
 * Without an intake (`habits.activity` absent) the result reproduces the pre-intake engine exactly: steps = `typicalSteps`
 * ?? 7 000, no non-step terms, band floor by the RMR route (02 §4.12 cv0 0.12 / 0.10 / 0.08).
 */
import { DEFAULTS } from '../../core/defaults';
import type {
  ActivityBase,
  ActivityDriver,
  ActivityDriverId,
  ActivityIntake,
  NeatLevel,
  ResolvedActivity,
  StepsSource,
  WorkClass,
} from '../../types/profile';
import { ACTIVITY_INTAKE_K, type ActivityIntakeK } from './params';

/** Standard-normal 90th percentile (definitional): p10/p90 = TDEE0 ∓ Z80·σ. */
export const Z80 = 1.2815515655446004;

type JobClass = Exclude<WorkClass, 'notWorking' | 'unknown'>;
const JOB_CLASSES: readonly JobClass[] = ['desk', 'mixed', 'onFeet', 'manualModerate', 'manualHeavy'];
type VarId = 'rmr' | 'steps' | 'work' | 'home' | 'commute' | 'recreation' | 'training';

/** The α0-independent part of the mapping: answers resolved to steps and kcal/d terms, variances on the numerator scale. */
export interface ActivityTerms {
  readonly source: 'default' | 'intake';
  readonly answered: boolean;
  readonly work: WorkClass;
  readonly workDaysPerWeek: number;
  readonly workHoursPerDay: number;
  readonly steps: number;
  readonly stepsWorkday: number;
  readonly stepsOffDay: number;
  readonly stepsSource: StepsSource | 'default';
  readonly stepsCv: number;
  /** kStep·BW·S_hab, kcal/d (includes a derived walking commute). */
  readonly stepsKcal: number;
  /** Part of `stepsKcal` that is the walking commute (only when steps were derived from the answers), kcal/d. */
  readonly walkCommuteKcal: number;
  readonly occupationalKcal: number;
  readonly homeKcal: number;
  readonly cycleKcal: number;
  readonly recreationKcal: number;
  /** E_occ + E_home + E_cyc + E_rec, kcal/d (before the PAL cap). */
  readonly nonStepKcal: number;
  /** Numerator variances, kcal²/d². */
  readonly variance: Readonly<Record<VarId, number>>;
  /** Relative floor of σ_TDEE0. */
  readonly floor: number;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const finiteNonNeg = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Mean and SD of e_occ over the population prior shares (R1 §3.2 "unknown": mean 0.28, SD 0.40 with occMixed 0.25; 0.32 / 0.41 with the integrated occMixed 0.40, see params.ts). */
export function occupationPrior(k: ActivityIntakeK = ACTIVITY_INTAKE_K): { e: number; sd: number; stepsWork: number } {
  let sw = 0;
  let m = 0;
  let m2 = 0;
  let st = 0;
  for (const c of JOB_CLASSES) {
    const o = k.occ[c];
    sw += o.share;
    m += o.share * o.e;
    m2 += o.share * (o.e * o.e + o.sd * o.sd);
    st += o.share * o.stepsWork;
  }
  const e = m / sw;
  return { e, sd: Math.sqrt(Math.max(0, m2 / sw - e * e)), stepsWork: st / sw };
}

/** R1 §3.1-3.4 terms. `intake` undefined = pre-intake behaviour (see the file header). */
export function activityTerms(intake: ActivityIntake | undefined, base: ActivityBase, k: ActivityIntakeK = ACTIVITY_INTAKE_K): ActivityTerms {
  const w = base.weightKg;
  const A = DEFAULTS.activity;
  const routeFloor = base.rmrRoute === 'measured' ? k.floorMeasuredRmr : base.rmrRoute === 'ffm' ? k.floorBodyFat : k.floorSkipped;
  const cvRmr = base.rmrRoute === 'measured' ? k.cvRmrMeasured : k.cvRmrEquation;
  const vRmr = (cvRmr * (1 + k.neatNonStepFrac) * base.rmr0Kcal) ** 2;
  const vTraining = (k.cvTraining * base.eat0Kcal) ** 2;

  if (!intake) {
    // pre-intake engine, bit for bit: steps = the tick or 7 000, nothing else
    const steps = base.typicalSteps ?? DEFAULTS.steps;
    const stepsKcal = k.stepK * w * steps;
    return {
      source: 'default',
      answered: false,
      work: 'unknown',
      workDaysPerWeek: A.workDaysPerWeek,
      workHoursPerDay: A.workHoursPerDay,
      steps,
      stepsWorkday: steps,
      stepsOffDay: steps,
      stepsSource: base.typicalSteps !== undefined ? 'estimate' : 'default',
      stepsCv: k.cvStepsRough,
      stepsKcal,
      walkCommuteKcal: 0,
      occupationalKcal: 0,
      homeKcal: 0,
      cycleKcal: 0,
      recreationKcal: 0,
      nonStepKcal: 0,
      variance: { rmr: vRmr, steps: stepsKcal * stepsKcal * (k.cvStepsRough ** 2 + k.cvStepCost ** 2), work: 0, home: 0, commute: 0, recreation: 0, training: vTraining },
      floor: routeFloor,
    };
  }

  // ---- answers with defaults
  const work: WorkClass = intake.work ?? A.work;
  const notWorking = work === 'notWorking';
  const dW = notWorking ? 0 : clamp(finiteNonNeg(intake.workDaysPerWeek) ? intake.workDaysPerWeek : A.workDaysPerWeek, A.workDaysPerWeekRange[0], A.workDaysPerWeekRange[1]);
  const hWork = clamp(finiteNonNeg(intake.workHoursPerDay) ? intake.workHoursPerDay : A.workHoursPerDay, A.workHoursPerDayRange[0], A.workHoursPerDayRange[1]);
  const mode = notWorking ? 'none' : (intake.commute?.mode ?? A.commuteMode);
  const commuteMin = clamp(finiteNonNeg(intake.commute?.activeMinPerWorkday) ? intake.commute.activeMinPerWorkday : A.commuteActiveMinPerWorkday, A.commuteActiveMinRange[0], A.commuteActiveMinRange[1]);
  const walkMin = mode === 'walk' || mode === 'mixed' ? commuteMin : 0;
  const cycMin = mode === 'cycle' ? commuteMin : 0;
  const offDay = intake.offDay ?? A.offDay;
  const atHome = intake.onFeetAtHome ?? A.onFeetAtHome;

  // ---- occupation (R1 §3.2; unknown = population prior; class half-range as the 95 % interval)
  let eOcc = 0;
  let sdOcc = 0;
  let stepsClass: number = DEFAULTS.steps;
  if (work === 'unknown') {
    const pr = occupationPrior(k);
    eOcc = pr.e;
    sdOcc = pr.sd;
  } else if (!notWorking) {
    const o = k.occ[work];
    eOcc = o.e;
    sdOcc = o.sd;
    stepsClass = o.stepsWork;
  }
  const workScale = (w * hWork * dW) / 7;
  const occupationalKcal = workScale * eOcc;

  // ---- steps (R1 §3.1, Q5): device or rough number > the old tick > derived from the day description
  const sa = intake.steps;
  const src: StepsSource = sa?.source ?? A.stepsSource;
  const [sLo, sHi] = A.stepsRange;
  const mean = src !== 'unknown' && finiteNonNeg(sa?.weeklyMean) ? clamp(sa.weeklyMean, sLo, sHi) : Number.NaN;
  const wd = src !== 'unknown' && finiteNonNeg(sa?.workday) ? clamp(sa.workday, sLo, sHi) : Number.NaN;
  const od = src !== 'unknown' && finiteNonNeg(sa?.offDay) ? clamp(sa.offDay, sLo, sHi) : Number.NaN;
  // derived day values (no device): the work-day class value (7 000 when the class is unknown) plus a walking commute
  const derivedWork = stepsClass + k.walkCadence * walkMin;
  const derivedOff = k.stepsOff[offDay];
  let sW: number;
  let sO: number;
  let steps: number;
  let stepsSource: StepsSource | 'default';
  let cv: number;
  let walkSteps = 0;
  if (src !== 'unknown' && (Number.isFinite(mean) || Number.isFinite(wd) || Number.isFinite(od))) {
    stepsSource = src;
    cv = src === 'wrist' ? k.cvStepsWrist : src === 'phone' ? (sa?.phoneCarried === false ? k.cvStepsPhoneNotCarried : k.cvStepsPhone) : k.cvStepsRough;
    if (Number.isFinite(mean)) {
      sW = mean;
      sO = mean;
      steps = mean;
    } else {
      sW = Number.isFinite(wd) ? wd : derivedWork;
      sO = Number.isFinite(od) ? od : derivedOff;
      if (notWorking) sW = sO;
      steps = (dW * sW + (7 - dW) * sO) / 7;
    }
  } else if (finiteNonNeg(base.typicalSteps)) {
    // the pre-intake steps tick = a rough steps answer (R1 §5 "Q5 reuses the current steps tick when 'roughly' is chosen")
    stepsSource = 'estimate';
    cv = k.cvStepsRough;
    steps = clamp(base.typicalSteps, sLo, sHi);
    sW = steps;
    sO = steps;
  } else {
    stepsSource = 'unknown';
    cv = k.cvStepsRough;
    sW = notWorking ? derivedOff : derivedWork;
    sO = derivedOff;
    steps = (dW * sW + (7 - dW) * sO) / 7;
    walkSteps = (k.walkCadence * walkMin * dW) / 7;
  }
  steps = Math.round(steps);
  const stepsKcal = k.stepK * w * steps;
  const walkCommuteKcal = k.stepK * w * walkSteps;

  // ---- home, cycling commute, recreation
  const homeKcal = w * k.homeHours[atHome] * k.homeKcalPerKgH;
  const cycleKcal = (w * (k.metCycle - 1) * (cycMin / 60) * dW) / 7;
  let recMetMinWk = 0;
  const [rLo, rHi] = A.recreationMinPerWeekRange;
  for (const r of intake.recreation ?? []) {
    if (!finiteNonNeg(r.minPerWeek)) continue;
    recMetMinWk += (k.metSport[r.intensity] - 1) * clamp(r.minPerWeek, rLo, rHi);
  }
  const recreationKcal = (w * recMetMinWk) / 60 / 7;

  const answered = work !== 'unknown' || stepsSource !== 'unknown';
  const floor = Math.min(routeFloor, answered ? k.floorAnswered : k.floorSkipped);
  return {
    source: 'intake',
    answered,
    work,
    workDaysPerWeek: dW,
    workHoursPerDay: hWork,
    steps,
    stepsWorkday: Math.round(sW),
    stepsOffDay: Math.round(sO),
    stepsSource,
    stepsCv: cv,
    stepsKcal,
    walkCommuteKcal,
    occupationalKcal,
    homeKcal,
    cycleKcal,
    recreationKcal,
    nonStepKcal: occupationalKcal + homeKcal + cycleKcal + recreationKcal,
    variance: {
      rmr: vRmr,
      steps: stepsKcal * stepsKcal * (cv * cv + k.cvStepCost * k.cvStepCost),
      work: (workScale * sdOcc) ** 2,
      home: (k.cvHome * homeKcal) ** 2,
      commute: (k.cvCycleCommute * cycleKcal) ** 2,
      recreation: (k.cvRecreation * recreationKcal) ** 2,
      training: vTraining,
    },
    floor,
  };
}

/** TDEE0 numerator (everything but TEF), kcal/d — the same sum, in the same order, as `resolveProfile`. */
export function activityNumerator(t: ActivityTerms, base: ActivityBase, k: ActivityIntakeK = ACTIVITY_INTAKE_K): number {
  return base.rmr0Kcal + k.neatNonStepFrac * base.rmr0Kcal + t.stepsKcal + base.eat0Kcal + t.nonStepKcal;
}

/**
 * Numerator after the PAL cap (R1 §3.1) for TEF fraction `tef`: with an intake, the non-step answers may not push PAL0
 * above 2.5 (they are scaled down, never below 0); sessions and steps are never capped (the pre-intake form has no cap).
 */
export function cappedNumerator(t: ActivityTerms, base: ActivityBase, tef: number, k: ActivityIntakeK = ACTIVITY_INTAKE_K): number {
  const numer = activityNumerator(t, base, k);
  if (t.source !== 'intake') return numer;
  const capNumer = k.palCap * base.rmr0Kcal * (1 - tef);
  if (numer <= capNumer) return numer;
  const floor = numer - t.nonStepKcal;
  return capNumer > floor ? capNumer : floor;
}

/** NASEM 2023 category of a PAL. */
export function neatLevelOf(pal: number, k: ActivityIntakeK = ACTIVITY_INTAKE_K): NeatLevel {
  return pal < k.nasemInactiveMax ? 'inactive' : pal < k.nasemLowActiveMax ? 'lowActive' : pal < k.nasemActiveMax ? 'active' : 'veryActive';
}

/**
 * Assemble the resolved activity for a TDEE0 that the caller computed (resolveProfile's TEF fixed point on
 * `cappedNumerator`) with TEF fraction `base.tefFraction`. When `tdee0` is below the uncapped numerator/(1 − α0) the
 * difference is taken off the non-step terms (PAL cap), proportionally.
 */
export function assembleActivity(t: ActivityTerms, base: ActivityBase, tdee0: number, k: ActivityIntakeK = ACTIVITY_INTAKE_K): ResolvedActivity {
  const alpha = base.tefFraction;
  const rmr0 = base.rmr0Kcal;
  const numer = activityNumerator(t, base, k);
  const numerEff = tdee0 * (1 - alpha);
  const palUncapped = rmr0 > 0 ? numer / (1 - alpha) / rmr0 : Number.NaN;
  // PAL cap: shrink the non-step terms by the excess (relative 1e-9 guards against the fixed point's rounding)
  let f = 1;
  if (t.source === 'intake' && numer - numerEff > 1e-9 * numer && t.nonStepKcal > 0) f = Math.min(1, Math.max(0, 1 - (numer - numerEff) / t.nonStepKcal));
  const occ = t.occupationalKcal * f;
  const home = t.homeKcal * f;
  const cyc = t.cycleKcal * f;
  const rec = t.recreationKcal * f;
  const nonStep = occ + home + cyc + rec;
  const dailyLiving = k.neatNonStepFrac * rmr0;
  const stepsOnly = t.stepsKcal - t.walkCommuteKcal;
  const commute = cyc + t.walkCommuteKcal;
  const training = base.eat0Kcal;
  const digestion = tdee0 - (rmr0 + dailyLiving + stepsOnly + occ + home + commute + rec + training);
  const v = {
    ...t.variance,
    work: t.variance.work * f * f,
    home: t.variance.home * f * f,
    commute: t.variance.commute * f * f,
    recreation: t.variance.recreation * f * f,
  };
  const d = 1 - alpha;
  const sd = (x: number): number => Math.sqrt(x) / d;
  const drivers: ActivityDriver[] = [
    { id: 'rmr', kcal: rmr0, sigmaKcal: sd(v.rmr) },
    { id: 'dailyLiving', kcal: dailyLiving, sigmaKcal: 0 },
    { id: 'steps', kcal: stepsOnly, sigmaKcal: sd(v.steps) },
    { id: 'work', kcal: occ, sigmaKcal: sd(v.work) },
    { id: 'home', kcal: home, sigmaKcal: sd(v.home) },
    { id: 'commute', kcal: commute, sigmaKcal: sd(v.commute) },
    { id: 'recreation', kcal: rec, sigmaKcal: sd(v.recreation) },
    { id: 'training', kcal: training, sigmaKcal: sd(v.training) },
    { id: 'digestion', kcal: digestion, sigmaKcal: 0 },
  ];
  let total = 0;
  let largest: ActivityDriverId = 'rmr';
  let largestV = -1;
  for (const id of ['rmr', 'steps', 'work', 'home', 'commute', 'recreation', 'training'] as const) {
    total += v[id];
    if (v[id] > largestV) {
      largestV = v[id];
      largest = id;
    }
  }
  const sigComp = Math.sqrt(total) / d;
  const sigFloor = t.floor * tdee0;
  const sigma = sigComp > sigFloor ? sigComp : sigFloor;
  const pal0 = rmr0 > 0 ? tdee0 / rmr0 : Number.NaN;
  const w = base.weightKg;
  return {
    source: t.source,
    answered: t.answered,
    steps: t.steps,
    stepsWorkday: t.stepsWorkday,
    stepsOffDay: t.stepsOffDay,
    stepsSource: t.stepsSource,
    stepsCv: t.stepsCv,
    work: t.work,
    workDaysPerWeek: t.workDaysPerWeek,
    workHoursPerDay: t.workHoursPerDay,
    stepsKcal: t.stepsKcal,
    occupationalKcal: occ,
    homeKcal: home,
    commuteKcal: commute,
    recreationKcal: rec,
    nonStepKcal: nonStep,
    metHoursPerDay: w > 0 ? (t.stepsKcal + nonStep) / w : 0,
    neatKcal: dailyLiving + t.stepsKcal + nonStep,
    pal0,
    neatLevel: neatLevelOf(pal0, k),
    palFlag: f < 1 ? 'capped' : palUncapped > k.palWarn ? 'high' : 'ok',
    tdee0Kcal: tdee0,
    uncertainty: {
      sigmaKcal: sigma,
      relSigma: tdee0 > 0 ? sigma / tdee0 : Number.NaN,
      p10: tdee0 - Z80 * sigma,
      p90: tdee0 + Z80 * sigma,
      floor: t.floor,
      floorApplied: sigComp <= sigFloor,
      largest,
    },
    drivers,
    base,
  };
}

/**
 * The intake's baseline maintenance for a profile baseline (closed form, R1 §3.1-3.4): TDEE0 = numerator/(1 − α0), capped at
 * PAL 2.5 when an intake is given. With `base` = `ResolvedProfile.activity.base` this is the live what-if of R1 §6 (α0 held at
 * the profile's value; `resolveProfile` re-solves α0 with the macro split and may differ by < 0.1 %).
 */
export function resolveActivity(intake: ActivityIntake | undefined, base: ActivityBase, k: ActivityIntakeK = ACTIVITY_INTAKE_K): ResolvedActivity {
  const t = activityTerms(intake, base, k);
  return assembleActivity(t, base, cappedNumerator(t, base, base.tefFraction, k) / (1 - base.tefFraction), k);
}
