/**
 * MODULE intake — digestion/absorption kinetics, glucose & insulin curves, fed/fasted clocks, alcohol, caffeine,
 * creatine and fibre exposure.
 * Spec: docs/MODEL_SPEC.md §1.3 · Dossiers: 04 §4.10 step 1, §4.16-4.17 (carbohydrate appearance, curves); 03 §4.7A
 * (protein digestion); 07 §4.1-4.2, §4.4.3, §4.7.1 (gut emptying, fed state, fasting clocks, fasting glucose, mClock);
 * 15 §4.2, §4.10-4.12 (ME corrections, alcohol, caffeine, creatine); 05 §4.12, §4.17 (exogenous ketones, basal-insulin
 * decline with liver glycogen); 08 §4.10 (hFast reset rule); 21 C2 (post-meal walk).
 * Owned files: src/engine/model/intake/** only.
 *
 * Conventions (all hourly, Δt = 1 h, closed forms, §0.1):
 *  - A meal (all macros ingested in one hour, merged by the compiler) starts at the beginning of its hour, t_m = hour index.
 *  - Carbohydrate appears by the 04 gamma(2) kernel (θ = t_p, no lag), integrated exactly per hour; protein by the
 *    03 §4.7A Michaelis–Menten digestion (exact log-space Newton solution); the gut energy pool empties by 07 §4.1
 *    (0.5-h lag, exact MM) and fat appears at the meal's fat share of the emptied energy (ruling R-ABS).
 *  - Glucose and insulin excursions are x·e^{1−x} evaluated at the hour midpoint (updated multiplicatively: no exp per
 *    hour per meal). Caffeine load and alcohol pool are end-of-hour values.
 * Integration pass (integrator A2, 2026-09-30):
 *  - Basal insulin = Ins_f × the LOWER of 05's liver-glycogen factor (R-INS) and 07 §4.4.3's fasting time course
 *    0.45 + 0.55·e^(−p(τ − 12)/10) (Klein 1993: 70 % of the 12 → 72 h fall by 24 h), τ = hours post-absorptive + 4.5 h.
 *  - `insulinRel` = insulin / the habitual overnight trough (last burn-in day, dinner tail included), for hormones.
 *  - `insulinRefRel` (read by ketones) = 05 §4.17's insulin proxy IR·(I_b + 0.12·Ra_C + 0.04·Ra_P)·(1 − 0.3x) on this
 *    module's absorption rates, with the basal decline above and IR = S_hep^−0.9: the calibration domain of 05's
 *    lipolysis/ketogenesis functions (04's absolute meal insulin, ≈ 2× higher and 4 h longer after low-carbohydrate
 *    meals, drove very-low-carbohydrate BHB to ≈ 0.2 mM for most of the day).
 *  - Caffeine half-life: single owner `moderators.caffeineTHalfH` × `moderators.caffeineOcMult` (combined OC).
 * Energy basis (C3/C7, D6-02, 2026-10-18):
 *  - `eAbsKcalH` is MODELED APPEARING METABOLIZABLE ENERGY on the reported-ME boundary (`./energyBasis.ts`
 *    `INTAKE_ENERGY_BASIS`): food ME already excludes fecal/urinary losses, so no excretion is charged again downstream;
 *    TEF stays expenditure. The 15 §4.2 fibre/nut ME corrections are applied on top as a ratio (`dmeRatio`).
 *  - Energy-only intake (`HourInput.unallocatedKcal`, part of `kcal`): the energy of a meal not explained by its KNOWN grams
 *    (unknown macros, or a source-reconciliation residual). It enters the meal's gut-energy pool, empties with it (absorptive
 *    state, 07 §4.1) and appears as energy only: it never feeds a named glucose, fructose, amino-acid or fat stream, the
 *    glucose/insulin excursions or the ketone insulin proxy. A negative value (known grams above the reported energy) is a
 *    reconciliation correction that follows the same emptying and never makes an hour's appearing energy negative (any
 *    unapplied part is carried, `reconDebtKcal`). Substrate-dependent outputs of such days carry the day's energy status.
 *  - Ingestion-to-appearance audit (`./energyBasis.ts` `intakeEnergyAudit`): registered intake = appeared + retained gut
 *    stores/tails + declared pre-appearance losses, from the first hour of the run, independent of the eAbs identities.
 * Scope and ME corrections (D6-07/D6-08, 2026-10-18; `INTAKE_KINETICS_SCOPE`, `INTAKE_ME_CORRECTION_POLICY`):
 *  - The appearance streams are phenomenological GUT-APPEARANCE approximations for schedule comparison. Intestinal uptake,
 *    systemic appearance after first-pass (splanchnic) use and oxidation are different observables; the 60/90 g/h caps are
 *    design limits, not verified universal maxima. Fibre energy (2 kcal/g) appears with the carbohydrate kernel as energy
 *    only (never as small-intestinal glucose); its hourly timing is unsupported, its daily ME is kept. Carbohydrate of
 *    unknown mixture is routed as glucose-equivalent — a declared scenario assumption. A new stomach→lumen→splanchnic
 *    ledger and colonic timing are P3 research, not implemented here.
 *  - The generic 15 §4.2 fibre slope and nut delta are OFF by default (scenario switches `fibreMeScenario`,
 *    `nutMeScenario`); when on, the fibre scenario only lowers ME (no positive low-fibre uplift). A correction is bound to
 *    its ORIGINATING meal: the ratio of the meal's own day is frozen in its ring slot and applied to that meal's gut-energy
 *    emptying, so a late meal keeps its correction across midnight whatever the next day holds; ethanol, exogenous ketones
 *    and carbohydrate eaten during exercise are never corrected. Food/form-specific measured ME arrives as the food's
 *    own energy upstream (an alternative route, never stacked).
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { ATWATER, ZERO_INTAKE_KCAL } from '../../core/defaults';
import { CARDIO_MODALITY_CODE, type DayInput, type HourInput } from '../../types/inputs';
import type { ModuleContext, StepClock } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import { MI } from '../../types/metrics';
import { INTAKE_PARAMS } from './params';
import { creatineStep, fastingGlucoseRef, fibreMeCorrection, glucoseAmplitude, insulinAmplitude, mClock, mmStep, mmTailStep } from './kinetics';

/** Recent-meal ring: slots × fields (Float64Array, allocation-free). */
export const MEAL_SLOTS = 16;
export const MEAL_FIELDS = 28;

/** Field offsets inside one meal slot. */
export const MF = {
  /** Start hour index t_m (absolute hours since t = 0). */
  T0: 0,
  /** Glucose-equivalent carbohydrate of the meal, g. */
  C0: 1,
  /** Fructose + galactose of the meal, g. */
  FG0: 2,
  /** Fibre of the meal, g (its 2 kcal/g appears with the carbohydrate kernel). */
  FIB0: 3,
  /** exp(−τ_b/θ) for the end of the coming hour (carbohydrate kernel recurrence). */
  EK: 4,
  /** exp(−1/θ). */
  DK: 5,
  /** θ = t_p, h. */
  TP: 6,
  /** Undigested protein, g. */
  PROT: 7,
  /** Index of the protein-digestion trajectory in the per-run cache (−1 when the meal has no protein). */
  PCI: 8,
  /** Q_meal (03 §4.10). */
  QM: 9,
  /** Vmax·s, g/h. */
  VM: 10,
  /** Gut energy not yet emptied, kcal. */
  GUT: 11,
  /** Index of the gastric-emptying trajectory in the per-run cache (−1 when the meal has no gut energy). */
  GCI: 12,
  /** Fat (incl. MCT) per kcal of gut energy, g/kcal. */
  FATK: 13,
  /** MCT per kcal of gut energy, g/kcal. */
  MCTK: 14,
  /** Glucose excursion amplitude A_m × mClock (× walk factor), mmol/L. */
  GAMP: 15,
  /** exp(1 − x) at the coming hour midpoint. */
  GEXP: 16,
  /** exp(−1/t_p). */
  GDEC: 17,
  /** Insulin excursion amplitude B_m, µU/mL. */
  IAMP: 18,
  /** exp(1 − y) at the coming hour midpoint. */
  IEXP: 19,
  /** exp(−1/(t_p + 0.25)). */
  IDEC: 20,
  /** Carbohydrate kernel CDF at the start of the coming hour (1 = delivered). */
  CDF: 21,
  /** 1 once a post-meal walk has been applied. */
  WALK: 22,
  /** 1 when this is the last meal of its day (walk factor 0.78). */
  LAST: 23,
  /** Gastric lag of this meal, h (0 for the liquid t_p class ≤ 0.5 h and for carbohydrate taken during exercise). */
  LAG: 24,
  /** 1/t_p and 1/(t_p + 0.25), 1/h. */
  ITP: 25,
  ITPI: 26,
  /** C0 + FG0 + FIB0, g. */
  CTOT: 27,
} as const;

// numeric field offsets for the hot loop (plain constants)
const F_T0 = 0;
const F_C0 = 1;
const F_FG0 = 2;
const F_FIB0 = 3;
const F_EK = 4;
const F_DK = 5;
const F_PROT = 7;
const F_PCI = 8;
const F_QM = 9;
const F_GUT = 11;
const F_GCI = 12;
const F_FATK = 13;
const F_MCTK = 14;
const F_GAMP = 15;
const F_GEXP = 16;
const F_GDEC = 17;
const F_IAMP = 18;
const F_IEXP = 19;
const F_IDEC = 20;
const F_CDF = 21;
const F_WALK = 22;
const F_LAST = 23;
const F_ITP = 25;
const F_ITPI = 26;
const F_CTOT = 27;
/** Below this fraction of K the MM pools use the transcendental-free first-order tail step (error < 2e-5). */
const TAIL_FRAC = 0.05;
/**
 * Per-run trajectory caches (§11.2 risk 3 mitigation "precomputed kernel tables"): a meal's protein-digestion and
 * gastric-emptying trajectories depend only on (protein g, Vmax·s) and (gut kcal, lag); they are computed once, hour by
 * hour with the exact closed forms, and reused by every identical meal (schedules repeat days). One entry per ring slot
 * guarantees a free entry; entries are reference-counted by the slots using them. Results are bit-identical to solving
 * each slot incrementally (same operations in the same order).
 */
const TRAJ_N = MEAL_SLOTS;
const PROT_LEN = 72;
const GUT_LEN = 48;

/** Exogenous-ketone dose ring. */
export const KETONE_SLOTS = 4;
const KF_T0 = 0;
const KF_MMOL = 1;
const KF_THETA = 2;
const KF_CDF = 3;
const KF_EK = 4;
const KF_DK = 5;
export const KETONE_FIELDS = 6;
/** Field offsets inside one exogenous-ketone slot. */
export const KF = { T0: KF_T0, MMOL: KF_MMOL, THETA: KF_THETA, CDF: KF_CDF, EK: KF_EK, DK: KF_DK } as const;

/**
 * Numerical housekeeping of the ring (MODEL_SPEC §1.3 step 1, review m15): a pool (carbohydrate kernel, protein, gut
 * energy) holding < 0.1 g (kcal) is flushed into the current hour (mass-conserving) and stops costing work; a slot is
 * retired once it is older than 16 h and every pool is empty.
 */
const RETIRE_AGE_H = 16;
const RETIRE_LEFT = 0.1;
/** Excursion shape below which a slot's glucose/insulin term is dropped (x·e^{1−x} < 1e-12 for x > ~33). */
const SHAPE_DONE_X = 34;
/** Length of the precomputed fasting-glucose factor table (by hours post-absorptive). */
const FAST_TABLE_N = 1024;
const WALK_CODE = CARDIO_MODALITY_CODE.walk;

export interface IntakeState {
  /** Per-slot fields, see `MF`. */
  meals: Float64Array;
  /** 1 when the slot is in use. */
  mealActive: Uint8Array;
  nextSlot: number;
  nActive: number;
  /**
   * Per-run trajectory caches (see TRAJ_N): keys, lengths (h), reference counts, per-hour tables. Run state, so they live
   * here and not in the constants (bit-exact snapshot/restore, `RunOptions.initialSnapshot`; integrator A2).
   */
  pKeyG: Float64Array;
  pKeyV: Float64Array;
  pLen: Int32Array;
  pRef: Int32Array;
  pDig: Float64Array;
  pSlope: Float64Array;
  pRem: Float64Array;
  gKeyE: Float64Array;
  gKeyLag: Float64Array;
  gLen: Int32Array;
  gRef: Int32Array;
  gEm: Float64Array;
  gRem: Float64Array;
  /** Round-robin replacement cursors [protein, gut]. */
  trajNext: Int32Array;
  /** Exogenous-ketone doses: [t0, mmol, θ, cdf, e^{−τb/θ}, e^{−1/θ}] per slot. */
  ketones: Float64Array;
  ketoneActive: Uint8Array;
  /** Glucose(-eq) and fructose+galactose queued by the intestinal caps (04 §4.10), g. */
  glcQueueG: number;
  fruQueueG: number;
  /** Lagged quality-weighted AA appearance A_lag, g/h (03 §4.7A, τ_lag 0.5 h). */
  aLagGH: number;
  /** Ethanol not yet oxidised, g. */
  etohG: number;
  /** Caffeine body load at the end of the last hour, mg. */
  caffeineMg: number;
  /** Caffeine tolerance Tol 0..1 (15 §4.11, τ 14 d at ≥ 200 mg/d). Not exported (energy keeps its own, spec §1.5). */
  caffeineTol: number;
  /** Creatine saturation x (15 §4.12), fraction of muscle creatine above baseline. */
  creatineX: number;
  /** Fibre EMA F_eff, g/d (15 §4.2, τ_F 3 d). */
  fibreEffG: number;
  /** hFast (08 §4.10), h. */
  hoursSinceMeal: number;
  /** fast_h (17 §2.1), h. */
  hoursSinceIntake: number;
  /** tPA (07 §4.2), h. */
  hoursPostAbsorptive: number;
  /** Absorptive state of the last hour, 0/1. */
  fed: number;
  /** 24-h rings of ingested kcal and net carbohydrate (sums maintained incrementally). */
  kcalRing: Float64Array;
  carbRing: Float64Array;
  ringIdx: number;
  kcal24: number;
  carb24: number;
  /**
   * Overnight-fasted insulin on the habitual diet, µU/mL: the denominator of `insulinRel` (05's I = 1.0 "overnight-fasted
   * insulin on a mixed diet", 05 §4.17). Latched in endBurnIn as the lowest non-exercise hourly insulin of the last burn-in
   * day (the pre-breakfast trough, which still carries the tail of the previous dinner's 04 §4.17 excursion); without a
   * burn-in, the basal term Ins_f at the first hour of day 0.
   */
  insulinBasal0: number;
  basalLatched: number;
  /** Lowest non-exercise hourly insulin of the current day (for the latch above), µU/mL. */
  insTroughToday: number;

  /** Daily caches from d−1 signals (startDay): S_hep, S_mus, T_C powers and multipliers. */
  glcFastToday: number;
  insFastToday: number;
  sMusPowGlc: number;
  sMusPowIns: number;
  mTol: number;
  mIns: number;
  /**
   * Today's ME-correction ratio (dME_fibre + dME_nut)/E (15 §4.2 scenarios; 0 by default). Frozen into each meal slot
   * registered today (`mealDme`) and applied to that meal's gut-energy emptying (origin-bound, D6-08).
   */
  dmeRatio: number;
  /** Today's correction, kcal/d (diagnostic). */
  dmeKcalD: number;
  /** Energy appeared today (incl. dME), kcal (diagnostic, reset at startDay). */
  dayAbsKcal: number;
  /** 1 when a flush wrote into the constants' accumulator array this hour. */
  accDirty: number;
  /** 1/insulinBasal0. */
  invInsulinBasal0: number;
  /** Signal-write bookkeeping: 0 until the first full write; last written MCT / alcohol / ketone values non-zero. */
  busSync: number;
  mctNz: number;
  alcNz: number;
  ketNz: number;
  /**
   * (D6-02) Energy-only kcal per kcal of gut energy of each ring slot (`HourInput.unallocatedKcal`; signed: a negative value
   * is a source-reconciliation correction). Appears as energy only, at the slot's gastric emptying.
   */
  mealUK: Float64Array;
  /** (D6-02) Negative energy-only correction not yet applied (an hour's appearing energy never goes below 0), kcal ≤ 0. */
  reconDebtKcal: number;
  /** (D6-08) ME-correction ratio of each ring slot's originating day (kcal per kcal of the slot's gut energy). */
  mealDme: Float64Array;
  /** (D6-08) Negative ME correction not yet applied (appearing ME never goes below 0), kcal ≤ 0. Outside the audit. */
  dmeDebtKcal: number;
  /**
   * (D6-02/C7) Ingestion-to-appearance audit, cumulative kcal since init: energy registered into the gut/pools (engine
   * convention, MCT 8.3 kcal/g, energy-only included), raw appearance (before the 15 §4.2 ratio), declared pre-appearance
   * losses (fed exogenous-ketone bioavailability, a dropped ketone dose), the ME-correction ratio's kcal, and the
   * compiler-submitted hourly kcal (+ exercise carbohydrate) for comparison.
   */
  auditInKcal: number;
  auditOutKcal: number;
  auditLossKcal: number;
  auditMeKcal: number;
  auditSubmittedKcal: number;
}

/** Constants (MODEL_SPEC §0.3: parameters are read only in prepare()). */
export interface IntakeConst {
  /** Run-local scratch: exact meal-shape coefficients for the most recently used time-to-peak. */
  mealShape: { tp: number; offset: number; dk: number; gexp: number; idec: number; iexp: number };
  raGlcMax: number;
  raTotMax: number;
  glcFast: number;
  glcShepExp: number;
  glcA50: number;
  glcKL: number;
  glcProtCoef: number;
  glcProtCap: number;
  glcFatCoef: number;
  glcFatCap: number;
  glcFibCoef: number;
  glcFibCap: number;
  glcSmusExp: number;
  glcAmpCap: number;
  glcTolCoef: number;
  mClockSlope: number;
  mClockRef: number;
  mClockSpan: number;
  /** Fasting-glucose factor by hours post-absorptive (index 0 = fed, τ = 0). */
  fastGlcTable: Float64Array;
  /** 07 §4.4.3 fasting insulin factor 0.45 + 0.55·e^(−p(τ − 12)/10) by hours post-absorptive (τ = tPA + τ_abs). */
  fastInsTable: Float64Array;
  insFast: number;
  insShepExp: number;
  insBmax: number;
  insKI: number;
  insBP: number;
  insSmusExp: number;
  insTpOffset: number;
  insGiWeight: number;
  insTolCoef: number;
  insFloor: number;
  insFloorExp: number;
  /** Liver-glycogen reference G_ref for this person, g. */
  insGRef: number;
  insExCoef: number;
  /** 05 §4.17 insulin proxy for ketones: I per g/h of carbohydrate (a_c) and of protein (a_p) appearance. */
  ketIaC: number;
  ketIaP: number;
  protVmax: number;
  protKm: number;
  protFsys: number;
  /** τ_lag, h, and exp(−1 h/τ_lag). */
  protTauLag: number;
  protLagDecay: number;
  gutKge: number;
  gutKGE: number;
  gutLag: number;
  /** −kGE/KGE and exp(−kGE/KGE) for the 1-h first-order tail step. */
  gutLnF: number;
  gutF: number;
  fedThr: number;
  hFastProt: number;
  hFastCarb: number;
  /** Sex-resolved ethanol oxidation rate, g/kg/h. */
  alcKox: number;
  /** 2^(−1 h/t_half). */
  cafDecay: number;
  /** exp(−1 d/τ_tol). */
  cafTolDecay: number;
  cafTolThr: number;
  crXMax: number;
  crXMaxEff: number;
  crDoseSat: number;
  crTauUpNum: number;
  crTauUpMin: number;
  crTauUpMax: number;
  crTauDown: number;
  crLoadGPerKg: number;
  /** (D6-08) scenario switches: the generic fibre and nut ME corrections (off by default). */
  fibreScenario: boolean;
  nutScenario: boolean;
  /** k_net = k_F − GE_fib + c_f, kcal per g fibre. */
  fibreKNet: number;
  fibreRef: number;
  fibreCapNeg: number;
  fibreCapPos: number;
  /** exp(−1 d/τ_F). */
  fibreDecay: number;
  nutKcalPerG: number;
  nutFibre: number;
  ketoneMw: number;
  ketoneTpFasted: number;
  ketoneTpFed: number;
  ketoneFedFactor: number;
  ketoneKcalPerG: number;
  /** t_p of carbohydrate taken during exercise (absorbed as glucose, review M8), h. */
  exCarbTp: number;
  /**
   * (D6-02) Energy-only intake that resets hFast, kcal: min(4·hFastProtein, 4·hFastCarb) — the smallest energy that could
   * meet an 08 §4.10 reset threshold under some feasible composition. Engineering assumption for unknown composition, so an
   * observed caloric meal never extends fasted-state outputs; derived from the two thresholds (no new coefficient).
   */
  hFastUnallocKcal: number;
  walkFactor: number;
  walkFactorLast: number;
  walkMinMin: number;
  /** Initial values. */
  fibre0: number;
  bw0: number;
  /** Scratch for mmStep (preallocated). */
  scratch: Float64Array;
  /**
   * Hour accumulators (preallocated): 0 glc kernel g, 1 fru+gal kernel g, 2 fibre g, 3 protein digested g,
   * 4 Σ Q·F_sys·digested g, 5 gut energy emptied kcal, 6 fat g, 7 MCT g, 8 Σ change of the instantaneous
   * quality-weighted systemic AA rate over the hour, g/h, 9 energy-only kcal (D6-02), 10 origin-bound ME-correction
   * kcal of flushed gut energy (D6-08).
   */
  acc: Float64Array;
}

const MI_GLUCOSE = MI.glucose;
const MI_INSULIN = MI.insulin;
const MI_HOURS_FASTED = MI.hoursFasted;

const ATW_P = ATWATER.protein;
const ATW_C = ATWATER.carb;
const ATW_F = ATWATER.fat;
const ATW_FIB = ATWATER.fibre;
const ATW_ALC = ATWATER.alcohol;
const ATW_MCT = ATWATER.mct;

function prepare(ctx: ModuleContext): IntakeConst {
  const P = ctx.params;
  const v = (name: string): number => param(P, `intake.${name}`);
  const prof = ctx.profile;
  const sexUnspecified = prof.input.sexUnspecified === true;
  const koxM = v('alcKoxMaleGPerKgH');
  const koxF = v('alcKoxFemaleGPerKgH');
  const alcKox = sexUnspecified ? 0.5 * (koxM + koxF) : prof.sex === 'female' ? koxF : koxM;
  const combinedOc = prof.sex === 'female' && prof.cycle.contraception === 'combinedOral';
  // one owner for the caffeine half-life (the moderators registry entry, 16 §4.2.1 / 15 §4.11) × the combined-OC and
  // smoker multipliers (16 §4.2.1: 1.47 and 0.56), as moderators applies them for its bedtime residual
  const smoker = prof.habits.smoker === true;
  const tHalf =
    param(P, 'moderators.caffeineTHalfH') *
    (combinedOc ? param(P, 'moderators.caffeineOcMult') : 1) *
    (smoker ? param(P, 'moderators.caffeineSmokerMult') : 1);

  const floor = v('glcFastFloorMmolL');
  const amp = v('glcFastAmpMmolL');
  const t50 = v('glcFastT50H');
  const sc = v('glcFastScaleH');
  const ref = fastingGlucoseRef(v('fastRefTauH'), floor, amp, t50, sc);
  const tauAbs = v('tauRefAbsH');
  const fastGlcTable = new Float64Array(FAST_TABLE_N);
  fastGlcTable[0] = fastingGlucoseRef(0, floor, amp, t50, sc) / ref;
  for (let i = 1; i < FAST_TABLE_N; i++) fastGlcTable[i] = fastingGlucoseRef(i + tauAbs, floor, amp, t50, sc) / ref;
  const insFl = v('insFloor');
  const insOn = v('insFastOnsetH');
  const insTau = v('insFastTauH');
  const fastInsTable = new Float64Array(FAST_TABLE_N);
  fastInsTable[0] = 1;
  for (let i = 1; i < FAST_TABLE_N; i++) {
    const over = i + tauAbs - insOn;
    fastInsTable[i] = insFl + (1 - insFl) * Math.exp(-(over > 0 ? over : 0) / insTau);
  }

  const ffm0 = prof.ffm0Kg > 0 ? prof.ffm0Kg : 60;
  const wake = Number.isFinite(prof.habits.wakeTimeH) ? prof.habits.wakeTimeH : 7;
  const xMax = v('crXMax');

  return {
    mealShape: { tp: Number.NaN, offset: Number.NaN, dk: 0, gexp: 0, idec: 0, iexp: 0 },
    raGlcMax: v('raGlcMaxGH'),
    raTotMax: v('raGlcFruMaxGH'),
    glcFast: v('glcFastMmolL'),
    glcShepExp: v('glcShepExp'),
    glcA50: v('glcA50'),
    glcKL: v('glcKL'),
    glcProtCoef: v('glcProtCoef'),
    glcProtCap: v('glcProtCapG'),
    glcFatCoef: v('glcFatCoef'),
    glcFatCap: v('glcFatCapG'),
    glcFibCoef: v('glcFibCoef'),
    glcFibCap: v('glcFibCapG'),
    glcSmusExp: v('glcSmusExp'),
    glcAmpCap: v('glcAmpCapMmolL'),
    glcTolCoef: v('glcTolCoef'),
    mClockSlope: v('mClockSlopePerH'),
    mClockRef: wake + v('mClockWakeOffsetH'),
    mClockSpan: v('mClockSpanH'),
    fastGlcTable,
    fastInsTable,
    insFast: v('insFastUuMl'),
    insShepExp: v('insShepExp'),
    insBmax: v('insBmaxUuMl'),
    insKI: v('insKIG'),
    insBP: v('insBPUuMlPerG'),
    insSmusExp: v('insSmusExp'),
    insTpOffset: v('insTpOffsetH'),
    insGiWeight: v('insGiWeight'),
    insTolCoef: v('insTolCoef'),
    insFloor: v('insFloor'),
    insFloorExp: v('insFloorExp'),
    insGRef: (v('insGRefPer60KgFfm') * ffm0) / 60,
    insExCoef: v('insExCoef'),
    ketIaC: v('ketIPerGCarbH'),
    ketIaP: v('ketIPerGProtH'),
    protVmax: v('protVmaxGH'),
    protKm: v('protKmG'),
    protFsys: v('protFsys'),
    protTauLag: v('protTauLagH'),
    protLagDecay: Math.exp(-1 / v('protTauLagH')),
    gutKge: v('gutKgeKcalH'),
    gutKGE: v('gutKGEKcal'),
    gutLag: v('gutLagH'),
    gutLnF: -v('gutKgeKcalH') / v('gutKGEKcal'),
    gutF: Math.exp(-v('gutKgeKcalH') / v('gutKGEKcal')),
    fedThr: v('fedThresholdKcalH'),
    hFastProt: v('hFastProteinG'),
    hFastCarb: v('hFastCarbG'),
    alcKox,
    cafDecay: Math.pow(2, -1 / tHalf),
    cafTolDecay: Math.exp(-1 / v('cafTolTauD')),
    cafTolThr: v('cafTolThresholdMg'),
    crXMax: xMax,
    crXMaxEff: xMax * v('crResponder'),
    crDoseSat: v('crDoseSatG'),
    crTauUpNum: v('crTauUpNumGD'),
    crTauUpMin: v('crTauUpMinD'),
    crTauUpMax: v('crTauUpMaxD'),
    crTauDown: v('crTauDownD'),
    crLoadGPerKg: v('crLoadGPerKg'),
    fibreScenario: v('fibreMeScenario') >= 0.5,
    nutScenario: v('nutMeScenario') >= 0.5,
    fibreKNet: v('fibreKFKcalPerG') - v('fibreGEKcalPerG') + ATW_FIB,
    fibreRef: v('fibreRefGPer1000Kcal'),
    fibreCapNeg: v('fibreCapNegFrac'),
    fibreCapPos: v('fibreCapPosFrac'),
    fibreDecay: Math.exp(-1 / v('fibreTauD')),
    nutKcalPerG: v('nutKcalPerG'),
    nutFibre: v('nutFibreGPerG'),
    ketoneMw: v('ketoneMwGPerMol'),
    ketoneTpFasted: v('ketoneTpFastedH'),
    ketoneTpFed: v('ketoneTpFedH'),
    ketoneFedFactor: v('ketoneFedFactor'),
    ketoneKcalPerG: v('ketoneKcalPerG'),
    exCarbTp: v('exCarbTpH'),
    hFastUnallocKcal: Math.min(ATW_P * v('hFastProteinG'), ATW_C * v('hFastCarbG')),
    walkFactor: v('walkGlcFactor'),
    walkFactorLast: v('walkGlcFactorLastMeal'),
    walkMinMin: v('walkMinMinutes'),
    fibre0: prof.habitualFibreG > 0 ? prof.habitualFibreG : 16,
    bw0: prof.weightKg > 0 ? prof.weightKg : 70,
    scratch: new Float64Array(2),
    acc: new Float64Array(11),
  };
}

/** Safe positive value of a daily signal (stubs or bad inputs must never produce NaN/Infinity here). */
function pos(x: number, fallback: number): number {
  if (!Number.isFinite(x)) return fallback;
  return x < 0.05 ? 0.05 : x > 20 ? 20 : x;
}

/**
 * Fasting (basal) insulin Ins_f × basal-decline factor, µU/mL: the lower of 05's liver-glycogen factor (ruling R-INS)
 * and 07 §4.4.3's time course since the meal (index = hours post-absorptive; integrator A2, see params).
 */
function basalInsulin(s: IntakeState, k: IntakeConst, liverG: number, tpa: number): number {
  let r = liverG > 0 ? liverG / k.insGRef : 0;
  if (r > 1) r = 1;
  let f = k.insFloor + (1 - k.insFloor) * (k.insFloorExp === 0.5 ? Math.sqrt(r) : Math.pow(r, k.insFloorExp));
  const ft = k.fastInsTable[tpa < FAST_TABLE_N ? tpa : FAST_TABLE_N - 1]!;
  if (ft < f) f = ft;
  return s.insFastToday * f;
}

/** Is `hourOfDay` the hour of the last meal of `day`? (walk factor 0.78 after the evening meal, 21 C2). */
function isLastMealHour(day: DayInput, hourOfDay: number): boolean {
  for (let i = 0; i < day.nMeals; i++) {
    const m = day.meals[i];
    if (m !== undefined && Math.floor(m.clockH) > hourOfDay) return false;
  }
  return true;
}

function startDay(s: IntakeState, k: IntakeConst, bus: SignalBus, day: DayInput): void {
  const sHep = pos(bus.sHep, 1);
  const sMus = pos(bus.sMus, 1);
  let tc = bus.carbTolerance;
  tc = tc >= 0 && tc <= 1 ? tc : tc > 1 ? 1 : 0;
  s.glcFastToday = k.glcFast * Math.pow(sHep, k.glcShepExp);
  s.insFastToday = k.insFast * Math.pow(sHep, k.insShepExp);
  s.sMusPowGlc = Math.pow(sMus, k.glcSmusExp);
  s.sMusPowIns = Math.pow(sMus, k.insSmusExp);
  s.mTol = 1 + k.glcTolCoef * (1 - tc);
  s.mIns = 1 - k.insTolCoef * (1 - tc);
  // 15 §4.2 fibre and nut ME corrections: labelled sensitivity scenarios, off by default (D6-08). When on, the fibre
  // scenario only lowers ME above the reference density (upper cap 0: no positive low-fibre uplift) and the ratio is
  // frozen into the meals registered today (origin-bound), never applied to ethanol, ketones or exercise carbohydrate.
  if (s.mealDme === undefined) s.mealDme = new Float64Array(MEAL_SLOTS); // a snapshot from before the field existed
  if (s.dmeDebtKcal === undefined) s.dmeDebtKcal = 0;
  const e = day.energyKcal > 0 ? day.energyKcal : 0;
  const dFib = k.fibreScenario ? fibreMeCorrection(s.fibreEffG, e, k.fibreKNet, k.fibreRef, k.fibreCapNeg, 0) : 0;
  const nuts = day.nutsG > 0 ? day.nutsG : 0;
  const dNut = k.nutScenario ? -(day.nutDelta > 0 ? day.nutDelta : 0) * nuts * k.nutKcalPerG : 0;
  s.dmeKcalD = e > 0 ? dFib + dNut : 0;
  s.dmeRatio = e > 0 ? s.dmeKcalD / e : 0;
  if (s.dmeRatio < -0.5) s.dmeRatio = -0.5;
  s.dayAbsKcal = 0;
  s.insTroughToday = Infinity;
}

/** Protein-digestion trajectory (03 §4.7A exact MM) for `p0` g at Vmax·s = `vm`; returns the cache entry index. */
function protTrajectory(s: IntakeState, k: IntakeConst, p0: number, vm: number): number {
  for (let i = 0; i < TRAJ_N; i++) if (s.pLen[i]! > 0 && s.pKeyG[i] === p0 && s.pKeyV[i] === vm) return i;
  let e = s.trajNext[0]!;
  for (let n = 0; n < TRAJ_N && s.pRef[e]! > 0; n++) e = (e + 1) % TRAJ_N;
  s.trajNext[0] = (e + 1) % TRAJ_N;
  const km = k.protKm;
  const sc = k.scratch;
  const base = e * PROT_LEN;
  const lnF = -vm / km;
  const f = Math.exp(lnF);
  let g = p0;
  let u = Math.log(p0);
  let len = PROT_LEN;
  for (let h = 0; h < PROT_LEN; h++) {
    if (g < TAIL_FRAC * km) mmTailStep(g, u, lnF, f, km, sc);
    else mmStep(g, u, vm, km, 1, sc);
    let g1 = sc[0]!;
    if (g1 < RETIRE_LEFT || h === PROT_LEN - 1) g1 = 0; // < 0.1 g left (or 72 h): flushed in this hour
    s.pDig[base + h] = g - g1;
    s.pSlope[base + h] = vm * (g1 / (km + g1) - g / (km + g));
    s.pRem[base + h] = g1;
    g = g1;
    u = sc[1]!;
    if (g1 === 0) {
      len = h + 1;
      break;
    }
  }
  s.pKeyG[e] = p0;
  s.pKeyV[e] = vm;
  s.pLen[e] = len;
  return e;
}

/** Gastric-emptying trajectory (07 §4.1 exact MM after the lag) for `e0` kcal; returns the cache entry index. */
function gutTrajectory(s: IntakeState, k: IntakeConst, e0: number, lag: number): number {
  for (let i = 0; i < TRAJ_N; i++) if (s.gLen[i]! > 0 && s.gKeyE[i] === e0 && s.gKeyLag[i] === lag) return i;
  let e = s.trajNext[1]!;
  for (let n = 0; n < TRAJ_N && s.gRef[e]! > 0; n++) e = (e + 1) % TRAJ_N;
  s.trajNext[1] = (e + 1) % TRAJ_N;
  const V = k.gutKge;
  const K = k.gutKGE;
  const sc = k.scratch;
  const base = e * GUT_LEN;
  let g = e0;
  let u = Math.log(e0);
  let len = GUT_LEN;
  for (let h = 0; h < GUT_LEN; h++) {
    if (h > 0 && g < TAIL_FRAC * K) mmTailStep(g, u, k.gutLnF, k.gutF, K, sc);
    else mmStep(g, u, V, K, h === 0 ? 1 - lag : 1, sc);
    let g1 = sc[0]!;
    if (g1 < RETIRE_LEFT || h === GUT_LEN - 1) g1 = 0;
    s.gEm[base + h] = g - g1;
    s.gRem[base + h] = g1;
    g = g1;
    u = sc[1]!;
    if (g1 === 0) {
      len = h + 1;
      break;
    }
  }
  s.gKeyE[e] = e0;
  s.gKeyLag[e] = lag;
  s.gLen[e] = len;
  return e;
}

/** Release a slot's trajectory references (slot retired or flushed). */
function releaseSlot(s: IntakeState, m: Float64Array, base: number): void {
  const pci = m[base + F_PCI]!;
  if (pci >= 0) s.pRef[pci] = s.pRef[pci]! - 1;
  const gci = m[base + F_GCI]!;
  if (gci >= 0) s.gRef[gci] = s.gRef[gci]! - 1;
  m[base + F_PCI] = -1;
  m[base + F_GCI] = -1;
}

/** Deactivate a slot, flushing everything it still holds into the current hour (mass/energy conserving). */
function flushSlot(s: IntakeState, base: number, acc: Float64Array, k: IntakeConst): void {
  const m = s.meals;
  const rem = 1 - m[base + MF.CDF]!;
  if (rem > 0) {
    acc[0] = acc[0]! + rem * m[base + MF.C0]!;
    acc[1] = acc[1]! + rem * m[base + MF.FG0]!;
    acc[2] = acc[2]! + rem * m[base + MF.FIB0]!;
  }
  const pr = m[base + MF.PROT]!;
  if (pr > 0) {
    acc[3] = acc[3]! + pr;
    acc[4] = acc[4]! + pr * m[base + MF.QM]! * k.protFsys;
  }
  const g = m[base + MF.GUT]!;
  if (g > 0) {
    acc[5] = acc[5]! + g;
    acc[6] = acc[6]! + g * m[base + MF.FATK]!;
    acc[7] = acc[7]! + g * m[base + MF.MCTK]!;
    acc[9] = acc[9]! + g * s.mealUK[base / MEAL_FIELDS]!;
    acc[10] = acc[10]! + g * s.mealDme[base / MEAL_FIELDS]!;
  }
  m[base + MF.CDF] = 1;
  m[base + MF.PROT] = 0;
  m[base + MF.GUT] = 0;
  releaseSlot(s, m, base);
  s.accDirty = 1;
}

/**
 * Register one meal (all macros ingested in this hour) into the ring. Grams are already validated (≥ 0).
 * `glc` + `fg` = net carbohydrate; `mct` ⊂ `fat`; `unalloc` = energy-only kcal (D6-02; signed, bounded below by minus the
 * meal's own substrate energy).
 */
function registerMeal(
  s: IntakeState,
  k: IntakeConst,
  day: DayInput,
  hourOfDay: number,
  hourIndex: number,
  acc: Float64Array,
  glc: number,
  fg: number,
  fib: number,
  prot: number,
  fat: number,
  mct: number,
  tp: number,
  gi: number,
  qMeal: number,
  speed: number,
  lag: number,
  walkEligible: boolean,
  unalloc: number,
  dme: number,
): void {
  const m = s.meals;
  // free slot, else the oldest active slot is flushed into this hour and reused
  let slot = -1;
  for (let i = 0; i < MEAL_SLOTS; i++) {
    const j = (s.nextSlot + i) % MEAL_SLOTS;
    if (s.mealActive[j] === 0) {
      slot = j;
      break;
    }
  }
  if (slot < 0) {
    let oldest = 0;
    for (let i = 1; i < MEAL_SLOTS; i++) if (m[i * MEAL_FIELDS + MF.T0]! < m[oldest * MEAL_FIELDS + MF.T0]!) oldest = i;
    flushSlot(s, oldest * MEAL_FIELDS, acc, k);
    s.mealActive[oldest] = 0;
    s.nActive--;
    slot = oldest;
  }
  s.nextSlot = (slot + 1) % MEAL_SLOTS;
  const b = slot * MEAL_FIELDS;
  const carb = glc + fg;
  const subE = ATW_P * prot + ATW_C * carb + ATW_F * fat + ATW_FIB * fib;
  // energy-only part (D6-02): positive joins the gut pool; negative (reconciliation) cannot exceed the meal's own energy
  const appE = subE - (ATW_F - ATW_MCT) * mct;
  const u = unalloc < -appE ? -appE : unalloc;
  const gutE = u > 0 ? subE + u : subE;
  s.mealUK[slot] = gutE > 0 ? u / gutE : 0;
  // (D6-08) the ME-correction ratio of the meal's own day, applied to this meal's gut energy as it empties
  s.mealDme[slot] = gutE > 0 ? dme : 0;
  s.auditInKcal += appE + (gutE > 0 ? u : 0);

  m[b + MF.T0] = hourIndex;
  m[b + MF.C0] = glc;
  m[b + MF.FG0] = fg;
  m[b + MF.FIB0] = fib;
  // These coefficients depend only on the exact input time-to-peak and this run's insulin offset.
  // Keep their original expressions (division before exp); cache neither meal amplitudes nor mutable physiology.
  const shape = k.mealShape;
  if (shape.tp !== tp || shape.offset !== k.insTpOffset) {
    const tpi = tp + k.insTpOffset;
    shape.tp = tp;
    shape.offset = k.insTpOffset;
    shape.dk = Math.exp(-1 / tp);
    shape.gexp = Math.exp(1 - 0.5 / tp);
    shape.idec = Math.exp(-1 / tpi);
    shape.iexp = Math.exp(1 - 0.5 / tpi);
  }
  m[b + MF.DK] = shape.dk;
  m[b + MF.EK] = m[b + MF.DK]!;
  m[b + MF.TP] = tp;
  m[b + MF.CDF] = carb + fib > 0 ? 0 : 1;
  m[b + MF.PROT] = prot;
  m[b + MF.QM] = qMeal;
  m[b + MF.VM] = k.protVmax * speed;
  let pci = -1;
  if (prot > 1e-12) {
    pci = protTrajectory(s, k, prot, k.protVmax * speed);
    s.pRef[pci] = s.pRef[pci]! + 1;
  }
  m[b + MF.PCI] = pci;
  m[b + MF.GUT] = gutE;
  let gci = -1;
  if (gutE > 1e-12) {
    gci = gutTrajectory(s, k, gutE, lag);
    s.gRef[gci] = s.gRef[gci]! + 1;
  }
  m[b + MF.GCI] = gci;
  m[b + MF.FATK] = gutE > 0 ? fat / gutE : 0;
  m[b + MF.MCTK] = gutE > 0 ? mct / gutE : 0;
  m[b + MF.LAG] = lag;
  m[b + MF.ITP] = 1 / tp;
  m[b + MF.ITPI] = 1 / (tp + k.insTpOffset);
  m[b + MF.CTOT] = carb + fib;
  // 04 §4.16 glucose excursion; L_eff = GI/100 · net carbohydrate; viscous fibre = the day's viscous share of the meal's fibre
  const viscous = day.fibreG > 0 ? (fib * (day.viscousFibreG > 0 ? day.viscousFibreG : 0)) / day.fibreG : 0;
  const aM = glucoseAmplitude(
    (gi / 100) * carb, prot, fat, viscous, s.sMusPowGlc, k.glcA50, k.glcKL, k.glcProtCoef, k.glcProtCap, k.glcFatCoef,
    k.glcFatCap, k.glcFibCoef, k.glcFibCap, k.glcAmpCap,
  );
  m[b + MF.GAMP] = aM * mClock(hourOfDay, k.mClockRef, k.mClockSlope, k.mClockSpan);
  m[b + MF.GDEC] = m[b + MF.DK]!;
  m[b + MF.GEXP] = shape.gexp;
  // 04 §4.17 insulin excursion; L_I = (0.5 + 0.5·GI/100)·C
  const lI = (k.insGiWeight + (1 - k.insGiWeight) * (gi / 100)) * carb;
  m[b + MF.IAMP] = insulinAmplitude(lI, prot, s.sMusPowIns, k.insBmax, k.insKI, k.insBP);
  m[b + MF.IDEC] = shape.idec;
  m[b + MF.IEXP] = shape.iexp;
  m[b + MF.WALK] = walkEligible ? 0 : 1;
  m[b + MF.LAST] = walkEligible && isLastMealHour(day, hourOfDay) ? 1 : 0;
  s.mealActive[slot] = 1;
  s.nActive++;
}

function registerKetone(s: IntakeState, k: IntakeConst, g: number, fed: boolean, hourIndex: number): void {
  let slot = -1;
  for (let i = 0; i < KETONE_SLOTS; i++) {
    if (s.ketoneActive[i] === 0) {
      slot = i;
      break;
    }
  }
  const kt = s.ketones;
  if (slot < 0) {
    // > 4 concurrent doses: overwrite the first (its undelivered rest is dropped, a declared loss; never occurs in practice)
    slot = 0;
    s.auditLossKcal += (1 - kt[KF_CDF]!) * ((kt[KF_MMOL]! * k.ketoneMw) / 1000) * k.ketoneKcalPerG;
  }
  const b = slot * KETONE_FIELDS;
  // audit: the dose's energy is registered; the fed-state bioavailability factor is a declared pre-appearance loss
  s.auditInKcal += k.ketoneKcalPerG * g;
  if (fed) s.auditLossKcal += k.ketoneKcalPerG * g * (1 - k.ketoneFedFactor);
  const theta = fed ? k.ketoneTpFed : k.ketoneTpFasted;
  kt[b + KF_T0] = hourIndex;
  kt[b + KF_MMOL] = ((g / k.ketoneMw) * 1000) * (fed ? k.ketoneFedFactor : 1);
  kt[b + KF_THETA] = theta;
  kt[b + KF_CDF] = 0;
  kt[b + KF_DK] = Math.exp(-1 / theta);
  kt[b + KF_EK] = kt[b + KF_DK]!;
  s.ketoneActive[slot] = 1;
}

function stepHour(s: IntakeState, k: IntakeConst, bus: SignalBus, hour: HourInput, day: DayInput, clock: StepClock): void {
  const hIdx = clock.hourIndex;
  const acc = k.acc;

  // ---- 0. insulin baseline latch (Ins_f at t = 0 when no burn-in ran; see IntakeState.insulinBasal0)
  if (s.basalLatched === 0 && clock.day >= 0) {
    s.insulinBasal0 = basalInsulin(s, k, bus.liverGlycogenG, s.hoursPostAbsorptive);
    s.invInsulinBasal0 = 1 / s.insulinBasal0;
    s.basalLatched = 1;
  }

  // ---- 1. register intake starting this hour
  const prot = hour.proteinG > 0 ? hour.proteinG : 0;
  const carb = hour.carbG > 0 ? hour.carbG : 0;
  const fatIn = hour.fatG > 0 ? hour.fatG : 0;
  const fib = hour.fibreG > 0 ? hour.fibreG : 0;
  const macros = prot + carb + fatIn + fib;
  // energy-only intake (D6-02): part of hour.kcal, not explained by the known grams; absent field = none
  const un = hour.unallocatedKcal;
  const unalloc = un !== undefined && un === un && un > -1e12 && un < 1e12 ? (macros > 1e-9 || un > 0 ? un : 0) : 0;
  if (macros > 1e-9 || unalloc > 1e-9) {
    const fg = (hour.fructoseG > 0 ? hour.fructoseG : 0) + (hour.galactoseG > 0 ? hour.galactoseG : 0);
    const fgc = fg < carb ? fg : carb;
    const tp = hour.timeToPeakH > 0.05 ? hour.timeToPeakH : 1;
    registerMeal(
      s, k, day, hour.hourOfDay, hIdx, acc, carb - fgc, fgc, fib, prot, fatIn,
      hour.mctG > 0 ? (hour.mctG < fatIn ? hour.mctG : fatIn) : 0, tp, hour.glycaemicIndex > 0 ? hour.glycaemicIndex : 55,
      hour.proteinQMeal > 0 ? hour.proteinQMeal : 1, hour.proteinSpeed > 0 ? hour.proteinSpeed : 1,
      tp <= 0.5 ? 0 : k.gutLag, true, unalloc, s.dmeRatio,
    );
  }
  // carbohydrate eaten during exercise (ruling R-EXCARB, review M8): its own glucose slot, t_p 0.5 h, GI 100, no lag;
  // not part of the hour's meal fields (HourInput.exCarbG)
  const exCarb = hour.exCarbG > 0 ? hour.exCarbG : 0;
  if (exCarb > 0) registerMeal(s, k, day, hour.hourOfDay, hIdx, acc, exCarb, 0, 0, 0, 0, 0, k.exCarbTp, 100, 1, 1, 0, false, 0, 0);
  if (hour.exoKetoneG > 0) registerKetone(s, k, hour.exoKetoneG, s.fed === 1 || macros > 1e-9 || unalloc > 1e-9, hIdx);
  if (hour.alcoholG > 0) {
    s.etohG += hour.alcoholG;
    s.auditInKcal += ATW_ALC * hour.alcoholG;
  }

  // post-meal walk (21 C2 via R-LEVERS): a walk of ≥ walkMin min in the meal hour or the next lowers that meal's glucose excursion
  const walked = hour.exModality === WALK_CODE && hour.exMin >= k.walkMinMin;

  // ---- 2. per-slot kinetics (hour accumulators in locals)
  let aGlc = 0; // glucose-eq kernel g
  let aFg = 0; // fructose + galactose kernel g
  let aFib = 0; // fibre g
  let aProt = 0; // protein digested g
  let aAa = 0; // Σ Q·F_sys·digested g
  let aAaSlope = 0; // Σ change of the instantaneous systemic AA rate over the hour, g/h
  let aGut = 0; // gut energy emptied kcal
  let aFat = 0; // fat g
  let aMct = 0; // MCT g
  let aUn = 0; // energy-only kcal (D6-02)
  let aDme = 0; // origin-bound ME correction kcal (D6-08)
  let glcExc = 0;
  let insExc = 0;
  if (s.nActive > 0) {
    const m = s.meals;
    const act = s.mealActive;
    const qfs = k.protFsys;
    const pDig = s.pDig;
    const pSlope = s.pSlope;
    const pRem = s.pRem;
    const gEm = s.gEm;
    const gRem = s.gRem;
    const uk = s.mealUK;
    const dk = s.mealDme;
    // Slots are visited in their original order; stop once every live meal has been processed.
    // Capture the count before retiring slots below, which changes s.nActive during this pass.
    let remaining = s.nActive;
    for (let i = 0; i < MEAL_SLOTS && remaining > 0; i++) {
      if (act[i] === 0) continue;
      remaining--;
      const b = i * MEAL_FIELDS;
      const age = hIdx - m[b + F_T0]!; // whole hours since the meal started (0 in the meal hour)
      let busy = 0;
      // carbohydrate kernel (exact hour integral of the gamma(2) density); tail < 0.1 g flushed
      const cdf0 = m[b + F_CDF]!;
      if (cdf0 < 1) {
        const ek = m[b + F_EK]!;
        let cdf1 = 1 - (1 + (age + 1) * m[b + F_ITP]!) * ek;
        if ((1 - cdf1) * m[b + F_CTOT]! < RETIRE_LEFT) cdf1 = 1;
        else busy = 1;
        const fr = cdf1 - cdf0;
        aGlc += fr * m[b + F_C0]!;
        aFg += fr * m[b + F_FG0]!;
        aFib += fr * m[b + F_FIB0]!;
        m[b + F_CDF] = cdf1;
        m[b + F_EK] = ek * m[b + F_DK]!;
      }
      // protein (03 §4.7A MM digestion, exact trajectory from the cache); remainder < 0.1 g flushed
      const pci = m[b + F_PCI]!;
      if (pci >= 0 && m[b + F_PROT]! > 0) {
        const j = pci * PROT_LEN + age;
        const dig = pDig[j]!;
        const qf = m[b + F_QM]! * qfs;
        aProt += dig;
        aAa += dig * qf;
        // change of the instantaneous systemic rate over the hour (first-order hold for A_lag)
        aAaSlope += qf * pSlope[j]!;
        const rem = pRem[j]!;
        m[b + F_PROT] = rem;
        if (rem > 0) busy = 1;
      }
      // gut energy (07 §4.1 MM emptying after the lag, cached trajectory), fat at the meal's fat share
      const gci = m[b + F_GCI]!;
      if (gci >= 0 && m[b + F_GUT]! > 0) {
        const j = gci * GUT_LEN + age;
        const em = gEm[j]!;
        aGut += em;
        aFat += em * m[b + F_FATK]!;
        aMct += em * m[b + F_MCTK]!;
        aUn += em * uk[i]!;
        aDme += em * dk[i]!;
        const rem = gRem[j]!;
        m[b + F_GUT] = rem;
        if (rem > 0) busy = 1;
      }
      // glucose and insulin excursions at the hour midpoint (multiplicative update of e^{1−x})
      let ga = m[b + F_GAMP]!;
      if (ga > 0) {
        if (walked && age <= 1 && m[b + F_WALK] === 0) {
          ga *= m[b + F_LAST] === 1 ? k.walkFactorLast : k.walkFactor;
          m[b + F_GAMP] = ga;
          m[b + F_WALK] = 1;
        }
        const x = (age + 0.5) * m[b + F_ITP]!;
        if (x > SHAPE_DONE_X) m[b + F_GAMP] = 0;
        else {
          const ge = m[b + F_GEXP]!;
          glcExc += ga * x * ge;
          m[b + F_GEXP] = ge * m[b + F_GDEC]!;
        }
      }
      const ia = m[b + F_IAMP]!;
      if (ia > 0) {
        const y = (age + 0.5) * m[b + F_ITPI]!;
        if (y > SHAPE_DONE_X) m[b + F_IAMP] = 0;
        else {
          const ie = m[b + F_IEXP]!;
          insExc += ia * y * ie;
          m[b + F_IEXP] = ie * m[b + F_IDEC]!;
        }
      }
      // retire (MODEL_SPEC §1.3 step 1): older than 16 h with every pool flushed
      if (busy === 0 && age + 1 >= RETIRE_AGE_H) {
        releaseSlot(s, m, b);
        act[i] = 0;
        s.nActive--;
      }
    }
  }
  if (s.accDirty === 1) {
    // flushes from ring overflow (registration) — rare
    aGlc += acc[0]!;
    aFg += acc[1]!;
    aFib += acc[2]!;
    aProt += acc[3]!;
    aAa += acc[4]!;
    aGut += acc[5]!;
    aFat += acc[6]!;
    aMct += acc[7]!;
    aUn += acc[9]!;
    aDme += acc[10]!;
    acc.fill(0);
    s.accDirty = 0;
  }

  // ---- 3. intestinal caps (04 §4.10): Ra_glc ≤ 60 g/h, Ra_glc + Ra_fru ≤ 90 g/h, excess queued
  let glcIn = aGlc + s.glcQueueG;
  let fgIn = aFg + s.fruQueueG;
  const glcOut = glcIn < k.raGlcMax ? glcIn : k.raGlcMax;
  const room = k.raTotMax - glcOut;
  const fgOut = fgIn < room ? fgIn : room > 0 ? room : 0;
  glcIn -= glcOut;
  fgIn -= fgOut;
  s.glcQueueG = glcIn > 1e-12 ? glcIn : 0;
  s.fruQueueG = fgIn > 1e-12 ? fgIn : 0;

  // ---- 4. alcohol (15 §4.10): zero-order oxidation k_ox·BW
  let alcOx = 0;
  if (s.etohG > 0) {
    const bw = bus.tissueMassKg > 20 && bus.tissueMassKg < 400 ? bus.tissueMassKg : k.bw0;
    const cap = k.alcKox * bw;
    alcOx = s.etohG < cap ? s.etohG : cap;
    s.etohG -= alcOx;
    if (s.etohG < 1e-12) s.etohG = 0;
  }

  // ---- 5. exogenous ketones (05 §4.12): gamma(2) kernel, exact hour integral
  let ketMmol = 0;
  for (let i = 0; i < KETONE_SLOTS; i++) {
    if (s.ketoneActive[i] === 0) continue;
    const kt = s.ketones;
    const b = i * KETONE_FIELDS;
    const age = hIdx - kt[b + KF_T0]!;
    const th = kt[b + KF_THETA]!;
    const ek = kt[b + KF_EK]!;
    let c1 = 1 - (1 + (age + 1) / th) * ek;
    if ((1 - c1) * kt[b + KF_MMOL]! < 1e-6) c1 = 1;
    ketMmol += (c1 - kt[b + KF_CDF]!) * kt[b + KF_MMOL]!;
    kt[b + KF_CDF] = c1;
    kt[b + KF_EK] = ek * kt[b + KF_DK]!;
    if (c1 >= 1) s.ketoneActive[i] = 0;
  }

  // ---- 6. protein signal (03 §4.7A): A_lag relaxed toward Σ Q·F_sys·V with τ_lag 0.5 h — exact exponential solution
  // for an input varying linearly within the hour (mean = the exact hour mean, slope = change of the instantaneous
  // rates); keeps the hourly state within 2 % of a 5-min Euler reference (MODEL_SPEC §0.1), a piecewise-constant hold
  // does not (3.6 % of peak for 40 g whey)
  const aaMean = aAa;
  const aaSlope = aAaSlope;
  const r0 = aaMean - 0.5 * aaSlope;
  const r1 = aaMean + 0.5 * aaSlope;
  const tl = k.protTauLag;
  let aLag = r1 - tl * aaSlope + (s.aLagGH - r0 + tl * aaSlope) * k.protLagDecay;
  if (!(aLag > 0)) aLag = 0;
  s.aLagGH = aLag;

  // ---- 7. energy appearing this hour (engine convention; MCT at 8.3 kcal/g) + 15 §4.2 ME corrections
  const fat = aFat;
  const mct = aMct;
  let eRaw =
    ATW_C * (glcOut + fgOut) + ATW_P * aProt + ATW_F * (fat - mct) + ATW_MCT * mct + ATW_FIB * aFib + ATW_ALC * alcOx +
    k.ketoneKcalPerG * ((ketMmol * k.ketoneMw) / 1000);
  // energy-only appearance (D6-02); a negative reconciliation never makes the hour negative (carried as debt)
  if (aUn !== 0 || s.reconDebtKcal !== 0) {
    eRaw += aUn + s.reconDebtKcal;
    s.reconDebtKcal = 0;
    if (eRaw < 0) {
      s.reconDebtKcal = eRaw;
      eRaw = 0;
    }
  }
  // (D6-08) origin-bound ME correction of the meals emptying now (0 unless a scenario is on); never below 0 (carried)
  let eAbs = eRaw;
  if (aDme !== 0 || s.dmeDebtKcal !== 0) {
    eAbs = eRaw + aDme + s.dmeDebtKcal;
    s.dmeDebtKcal = 0;
    if (eAbs < 0) {
      s.dmeDebtKcal = eAbs;
      eAbs = 0;
    }
  }
  s.dayAbsKcal += eAbs;
  s.auditOutKcal += eRaw;
  s.auditMeKcal += eAbs - eRaw;

  // ---- 8. fed state and clocks (07 §4.1-4.2, 08 §4.10, 17 §2.1)
  const absFlux = aGut;
  const fed = absFlux >= k.fedThr ? 1 : 0;
  s.fed = fed;
  s.hoursPostAbsorptive = fed === 1 ? 0 : s.hoursPostAbsorptive + 1;
  const kcalIn = (hour.kcal > 0 ? hour.kcal : 0) + ATW_C * exCarb;
  s.auditSubmittedKcal += kcalIn;
  s.hoursSinceMeal = prot >= k.hFastProt || carb + exCarb >= k.hFastCarb || unalloc >= k.hFastUnallocKcal ? 0 : s.hoursSinceMeal + 1;
  s.hoursSinceIntake = kcalIn > ZERO_INTAKE_KCAL ? 0 : s.hoursSinceIntake + 1;

  // ---- 9. insulin (04 §4.17 × 05 basal factor, R-INS) and glucose (04 §4.16; 07 §4.4.3 in fasting)
  const ex = bus.exIntensityFrac > 0 ? (bus.exIntensityFrac < 1.5 ? bus.exIntensityFrac : 1.5) : 0;
  const insBasal = basalInsulin(s, k, bus.liverGlycogenG, s.hoursPostAbsorptive);
  const insRest = insBasal + s.mIns * insExc;
  let ins = insRest * (1 - k.insExCoef * ex);
  if (!(ins > 0.1)) ins = 0.1;
  if (ex === 0 && insRest < s.insTroughToday) s.insTroughToday = insRest;
  // 05 §4.17's insulin proxy for ketogenesis (ketones' I): IR·(I_b + a_c·Ra_C + a_p·Ra_P)·(1 − 0.3·x) on this hour's
  // absorption rates, with the engine's basal decline (I_b = the factor above) and IR = Ins_f(S_hep)/Ins_f(1) = S_hep^−0.9
  // (04 §4.17 HOMA link). 05 calibrated its lipolysis and ketogenesis functions on this proxy; 04's absolute meal insulin
  // (y·e^{1−y}, peak at t_p + 0.25 h) is ≈ 2× higher after a low-carbohydrate meal and stays above basal ≈ 4 h longer.
  const irK = s.insFastToday / k.insFast;
  const iKet = irK * (insBasal / s.insFastToday + k.ketIaC * (glcOut + fgOut) + k.ketIaP * aProt) * (1 - k.insExCoef * ex);
  const tpa = s.hoursPostAbsorptive < FAST_TABLE_N ? s.hoursPostAbsorptive : FAST_TABLE_N - 1;
  let glc = s.glcFastToday * k.fastGlcTable[tpa]! + s.mTol * glcExc;
  if (!(glc > 1)) glc = 1;

  // ---- 10. caffeine (15 §4.11): dose at the start of the hour, end-of-hour load
  s.caffeineMg = (s.caffeineMg + (hour.caffeineMg > 0 ? hour.caffeineMg : 0)) * k.cafDecay;
  if (s.caffeineMg < 1e-9) s.caffeineMg = 0;

  // ---- 11. 24-h intake rings (exact re-sum once per wrap to remove drift)
  const ri = s.ringIdx;
  const kc = kcalIn;
  const cg = carb + exCarb;
  const oldK = s.kcalRing[ri]!;
  const oldC = s.carbRing[ri]!;
  let ringChanged = kc !== oldK || cg !== oldC;
  if (ringChanged) {
    s.kcal24 += kc - oldK;
    s.carb24 += cg - oldC;
    s.kcalRing[ri] = kc;
    s.carbRing[ri] = cg;
  }
  s.ringIdx = ri === 23 ? 0 : ri + 1;
  if (s.ringIdx === 0) {
    let a = 0;
    let c = 0;
    for (let j = 0; j < 24; j++) {
      a += s.kcalRing[j]!;
      c += s.carbRing[j]!;
    }
    s.kcal24 = a;
    s.carb24 = c;
    ringChanged = true;
  }

  // ---- 12. signals (rarely non-zero ones are written only when they or their last written value are non-zero)
  const full = s.busSync === 0;
  bus.raGlcGH = glcOut;
  bus.raFruGalGH = fgOut;
  bus.raProtGH = aProt;
  bus.raAaQGH = s.aLagGH;
  bus.raFatGH = fat;
  const mctNz = mct > 0 ? 1 : 0;
  if (mctNz === 1 || s.mctNz === 1 || full) bus.raMctGH = mct;
  s.mctNz = mctNz;
  const alcNz = alcOx > 0 || s.etohG > 0 ? 1 : 0;
  if (alcNz === 1 || s.alcNz === 1 || full) {
    bus.alcOxGH = alcOx;
    bus.etohPoolG = s.etohG;
  }
  s.alcNz = alcNz;
  const ketNz = ketMmol > 0 ? 1 : 0;
  if (ketNz === 1 || s.ketNz === 1 || full) bus.exoKetoneMmolH = ketMmol;
  s.ketNz = ketNz;
  bus.eAbsKcalH = eAbs;
  bus.absFluxKcalH = absFlux;
  bus.insulinUuMl = ins;
  bus.insulinBasalUuMl = insBasal;
  bus.insulinRel = ins * s.invInsulinBasal0;
  bus.insulinRefRel = iKet;
  bus.glucoseMmolL = glc;
  bus.fedState = fed;
  bus.hoursPostAbsorptiveH = s.hoursPostAbsorptive;
  bus.hoursSinceMealH = s.hoursSinceMeal;
  bus.hoursSinceIntakeH = s.hoursSinceIntake;
  if (ringChanged || full) {
    bus.carbAbs24G = s.carb24 > 0 ? s.carb24 : 0;
    bus.kcalEaten24 = s.kcal24 > 0 ? s.kcal24 : 0;
  }
  bus.caffeineLoadMg = s.caffeineMg;
  s.busSync = 1;
}

function endOfDay(s: IntakeState, k: IntakeConst, bus: SignalBus, day: DayInput): void {
  // fibre exposure (15 §4.2): nut fibre excluded (its ME is corrected separately)
  const nutsG = day.nutsG > 0 ? day.nutsG : 0;
  let fDay = (day.fibreG > 0 ? day.fibreG : 0) - k.nutFibre * nutsG;
  if (fDay < 0) fDay = 0;
  s.fibreEffG = fDay + (s.fibreEffG - fDay) * k.fibreDecay;
  // creatine (15 §4.12); the loading flag means ISSN 0.3 g/kg/d
  let dose = day.creatineG > 0 ? day.creatineG : 0;
  if (day.creatineLoading) {
    const bw = bus.tissueMassKg > 20 && bus.tissueMassKg < 400 ? bus.tissueMassKg : k.bw0;
    const load = k.crLoadGPerKg * bw;
    if (load > dose) dose = load;
  }
  s.creatineX = creatineStep(s.creatineX, dose, k.crXMaxEff, k.crDoseSat, k.crTauUpNum, k.crTauUpMin, k.crTauUpMax, k.crTauDown, 1);
  if (s.creatineX < 0) s.creatineX = 0;
  // caffeine tolerance (15 §4.11): toward 1 while the daily dose is ≥ 200 mg, τ 14 d
  const tolTarget = day.caffeineMg >= k.cafTolThr ? 1 : 0;
  s.caffeineTol = tolTarget + (s.caffeineTol - tolTarget) * k.cafTolDecay;
  bus.creatineSatFrac = s.creatineX / k.crXMax;
  bus.fibreEffG = s.fibreEffG;
}

/**
 * What the intake module's streams mean (D6-07, C6): the observable each one approximates, its status and scope. Declarative
 * (shown in the Explain sheet; consumers map `status` to inline `Approximate` / `Unsupported`); nothing here changes the
 * numbers. `version` versions these labels only; numeric changes go through the parameters, whose registry hash already
 * keys derived artifacts (C7).
 */
export const INTAKE_KINETICS_SCOPE = {
  version: 2,
  observables: {
    raGlcGH: { observable: 'gutGlucoseAppearance', status: 'approximate', notThe: ['intestinalUptake', 'systemicAppearanceAfterFirstPass', 'oxidation'] },
    raFruGalGH: { observable: 'gutFructoseGalactoseAppearance', status: 'approximate', notThe: ['intestinalUptake', 'systemicAppearanceAfterFirstPass', 'oxidation'] },
    raProtGH: { observable: 'proteinDigestion', status: 'approximate', notThe: ['systemicAminoAcidAppearance'] },
    raAaQGH: { observable: 'systemicAminoAcidAppearance', status: 'approximate', notThe: ['muscleProteinSynthesis'] },
    raFatGH: { observable: 'gutFatAppearance', status: 'approximate', notThe: ['oxidation'] },
    eAbsKcalH: { observable: 'appearingMetabolizableEnergy', status: 'approximate', notThe: ['grossAbsorption'] },
    fibreEnergy: { observable: 'colonicFermentationEnergy', status: 'unsupported', hourly: 'unsupported', daily: 'kept' },
    glucoseMmolL: { observable: 'plasmaGlucoseExcursion', status: 'approximate', notThe: ['personalCalibratedGlucose'] },
  },
  caps: { glucoseGH: 'designLimit', glucoseFructoseGH: 'designLimit' },
  /** Contexts in which the timing kernels are out of domain (a status, never a generic multiplier). */
  outOfDomain: ['gastroparesis', 'bariatricSurgery', 'glp1Medication', 'inflammatoryBowelDisease'],
  research: 'stomach→lumen→splanchnic ledger and colonic fibre timing are P3 research (not implemented)',
} as const;

/** A context that puts the timing kernels out of domain (`INTAKE_KINETICS_SCOPE.outOfDomain`). */
export type IntakeTimingContext = (typeof INTAKE_KINETICS_SCOPE.outOfDomain)[number];

/**
 * Domain of the hourly appearance curves for one person (D6-07, C6). Known disease/medication context marks the timing
 * kernels out of domain — a STATUS for the hourly curves (inline `Unsupported`), never a generic multiplier on the numbers;
 * daily energy stays usable. Read from the screening's diabetes medication, the dated medication classes (the latest
 * GLP-1 change on or before `asOf` decides; no date given = any change counts as current) and explicitly stated contexts
 * (gastroparesis, bariatric surgery, inflammatory bowel disease). Pure.
 */
export function intakeTimingDomain(
  ctx: {
    diabetesMedication?: string;
    medications?: ReadonlyArray<{ medicationClass: string; change: 'start' | 'stop' | 'doseChange'; date: string }>;
    contexts?: readonly IntakeTimingContext[];
  },
  asOf?: string,
): { status: 'approximate' | 'outOfDomain'; reasons: IntakeTimingContext[] } {
  const reasons = new Set<IntakeTimingContext>();
  for (const c of ctx.contexts ?? []) if ((INTAKE_KINETICS_SCOPE.outOfDomain as readonly string[]).includes(c)) reasons.add(c);
  if (ctx.diabetesMedication === 'glp1') reasons.add('glp1Medication');
  const glp1 = (ctx.medications ?? []).filter((m) => m.medicationClass === 'glp1' && (asOf === undefined || m.date <= asOf));
  if (glp1.length > 0) {
    const latest = glp1.reduce((a, b) => (b.date >= a.date ? b : a));
    if (latest.change !== 'stop') reasons.add('glp1Medication');
  }
  const list = INTAKE_KINETICS_SCOPE.outOfDomain.filter((c) => reasons.has(c));
  return { status: list.length > 0 ? 'outOfDomain' : 'approximate', reasons: list };
}

/**
 * Named intake assumptions (C6, D6-07/D6-08), keyed by the id a run lists when it applies; `series` = outputs it enters
 * directly. The loop decides applicability (e.g. carbohydrate with an unknown mixture on a day; a scenario switch on).
 */
export const INTAKE_ASSUMPTIONS = {
  /** Carbohydrate of unknown glucose/fructose/galactose mixture is routed as glucose-equivalent. */
  unknownCarbMixtureAsGlucose: { reasonCode: 'carbMixtureUnknown', uncertaintyKind: 'scenario', series: ['glucose', 'liverGlycogen', 'muscleGlycogen', 'glycogenTotal'] },
  /** Fibre energy appears with the carbohydrate kernel: hourly timing unsupported, daily ME kept. */
  fibreEnergyHourlyTiming: { reasonCode: 'fibreHourlyTimingUnsupported', uncertaintyKind: 'heuristic', series: [] },
  /** The generic fibre ME slope scenario is on (uncalibrated; off in the standard projection). */
  fibreMeScenario: { reasonCode: 'genericFibreMeScenario', uncertaintyKind: 'scenario', series: ['energyBalance'] },
  /** The generic nut ME delta scenario is on (no species/form identity; off in the standard projection). */
  nutMeScenario: { reasonCode: 'genericNutMeScenario', uncertaintyKind: 'scenario', series: ['energyBalance'] },
} as const satisfies Record<string, { reasonCode: string; uncertaintyKind: 'scenario' | 'heuristic'; series: readonly string[] }>;

/**
 * Food-matrix ME correction policy (D6-08). Each correction states what it represents; none stacks on another; every
 * correction follows its originating meal; ethanol, exogenous ketones and exercise carbohydrate are excluded. Zero is the
 * conservative design default (abstention), not a claim of no food-matrix effect. DAMM remains a P3 development
 * comparator (it reuses the Corbin 17-person crossover and needs transit/methanogen inputs).
 */
export const INTAKE_ME_CORRECTION_POLICY = {
  version: 2,
  genericFibre: { default: 'off', represents: 'unavailableSubstrate', direction: 'lowerOnly', param: 'intake.fibreMeScenario' },
  genericNut: { default: 'off', represents: 'sourceMEDelta', param: 'intake.nutMeScenario', note: 'no almond coefficient without species/form identity' },
  measuredFoodME: { represents: 'sourceME', route: 'food energy upstream (alternative, never stacked)' },
  binding: 'originatingMeal',
  excludes: ['ethanol', 'exogenousKetones', 'exerciseCarbohydrate'],
  substrateStreams: 'unchanged (energy-only correction)',
} as const;

export const intakeModule = defineModule<IntakeState, IntakeConst>({
  id: 'intake',
  specSection: '§1.3',
  dossiers: '04 §4.10/4.16-4.17/4.19; 03 §4.7A; 07 §4.1-4.2, §4.4.3, §4.7.1; 15 §4.2, §4.10-4.12; 05 §4.12, §4.17; 08 §4.10; 21 C2',
  params: INTAKE_PARAMS,
  reads: ['sHep', 'sMus', 'carbTolerance', 'liverGlycogenG', 'exIntensityFrac', 'tissueMassKg'],
  writes: [
    'raGlcGH', 'raFruGalGH', 'raProtGH', 'raAaQGH', 'raFatGH', 'raMctGH', 'alcOxGH', 'etohPoolG', 'exoKetoneMmolH',
    'eAbsKcalH', 'absFluxKcalH', 'insulinUuMl', 'insulinBasalUuMl', 'insulinRel', 'insulinRefRel', 'glucoseMmolL', 'fedState', 'hoursPostAbsorptiveH',
    'hoursSinceMealH', 'hoursSinceIntakeH', 'carbAbs24G', 'kcalEaten24', 'caffeineLoadMg', 'creatineSatFrac', 'fibreEffG',
  ],
  records: ['glucose', 'insulin', 'hoursFasted'],
  prepare,
  init: (k, _ctx, bus) => {
    const insFast = k.insFast; // S_hep = 1 at init
    const s: IntakeState = {
      meals: new Float64Array(MEAL_SLOTS * MEAL_FIELDS),
      mealActive: new Uint8Array(MEAL_SLOTS),
      nextSlot: 0,
      nActive: 0,
      pKeyG: new Float64Array(TRAJ_N),
      pKeyV: new Float64Array(TRAJ_N),
      pLen: new Int32Array(TRAJ_N),
      pRef: new Int32Array(TRAJ_N),
      pDig: new Float64Array(TRAJ_N * PROT_LEN),
      pSlope: new Float64Array(TRAJ_N * PROT_LEN),
      pRem: new Float64Array(TRAJ_N * PROT_LEN),
      gKeyE: new Float64Array(TRAJ_N),
      gKeyLag: new Float64Array(TRAJ_N),
      gLen: new Int32Array(TRAJ_N),
      gRef: new Int32Array(TRAJ_N),
      gEm: new Float64Array(TRAJ_N * GUT_LEN),
      gRem: new Float64Array(TRAJ_N * GUT_LEN),
      trajNext: new Int32Array(2),
      ketones: new Float64Array(KETONE_SLOTS * KETONE_FIELDS),
      ketoneActive: new Uint8Array(KETONE_SLOTS),
      glcQueueG: 0,
      fruQueueG: 0,
      aLagGH: 0,
      etohG: 0,
      caffeineMg: 0,
      caffeineTol: 0,
      creatineX: 0,
      fibreEffG: k.fibre0,
      hoursSinceMeal: 12,
      hoursSinceIntake: 12,
      hoursPostAbsorptive: 8,
      fed: 0,
      kcalRing: new Float64Array(24),
      carbRing: new Float64Array(24),
      ringIdx: 0,
      kcal24: 0,
      carb24: 0,
      insulinBasal0: insFast,
      basalLatched: 0,
      insTroughToday: Infinity,
      glcFastToday: k.glcFast,
      insFastToday: insFast,
      sMusPowGlc: 1,
      sMusPowIns: 1,
      mTol: 1,
      mIns: 1,
      dmeRatio: 0,
      dmeKcalD: 0,
      dayAbsKcal: 0,
      accDirty: 0,
      invInsulinBasal0: 1 / insFast,
      busSync: 0,
      mctNz: 0,
      alcNz: 0,
      ketNz: 0,
      mealUK: new Float64Array(MEAL_SLOTS),
      reconDebtKcal: 0,
      mealDme: new Float64Array(MEAL_SLOTS),
      dmeDebtKcal: 0,
      auditInKcal: 0,
      auditOutKcal: 0,
      auditLossKcal: 0,
      auditMeKcal: 0,
      auditSubmittedKcal: 0,
    };
    bus.fibreEffG = s.fibreEffG;
    bus.creatineSatFrac = 0;
    bus.insulinUuMl = insFast;
    bus.insulinBasalUuMl = insFast;
    bus.insulinRel = 1;
    bus.insulinRefRel = 1;
    bus.glucoseMmolL = k.glcFast;
    bus.hoursPostAbsorptiveH = s.hoursPostAbsorptive;
    bus.hoursSinceMealH = s.hoursSinceMeal;
    bus.hoursSinceIntakeH = s.hoursSinceIntake;
    return s;
  },
  startDay: (s, k, bus, day) => startDay(s, k, bus, day),
  stepHour,
  endBurnIn: (s, _k, _bus, ctx) => {
    // insulinRel is relative to the overnight-fasted insulin on the habitual diet (the last burn-in day's trough)
    if ((ctx.burnInDays ?? 0) > 0 && s.insTroughToday > 0.1 && s.insTroughToday < Infinity) {
      s.insulinBasal0 = s.insTroughToday;
      s.invInsulinBasal0 = 1 / s.insulinBasal0;
      s.basalLatched = 1;
    }
  },
  endOfDay: (s, k, bus, day) => endOfDay(s, k, bus, day),
  recordHour: (_s, _k, bus, out) => {
    out[MI_GLUCOSE] = bus.glucoseMmolL;
    out[MI_INSULIN] = bus.insulinRel;
    out[MI_HOURS_FASTED] = bus.hoursSinceIntakeH;
  },
});
