/**
 * MODULE cardiometabolic — insulin-sensitivity states (hepatic, muscle), carbohydrate tolerance T_C, lipids (LDL, ApoB,
 * HDL, TG), blood pressure, liver fat, fasting glucose / HbA1c, hs-CRP, uric acid, hepatic fDNL biomarker.
 * Spec: docs/MODEL_SPEC.md §1.14 · Dossiers: 06 §4.1-4.16 (owner of biomarkers); 04 §4.13b, §4.18-4.19 (S_hep, S_mus,
 * T_C — single owner here); 13 §4.8 (OGTT readiness on T_C); 11 §4.9/4.13 (liver fat and BP in surplus);
 * 10 §4.7/4.10 (exercise effects); 16 (sleep via siSleepMult); 21 (viscous fibre, omega-3, sauna levers);
 * 20 §4.7 (fasting validation target).
 * Owned files: src/engine/model/cardiometabolic/** only.
 *
 * Files: params.ts (ParamDefs), baselines.ts (NHANES generators, Φ⁻¹, Cholesky), constants.ts (K + prepare), diet.ts
 * (daily dietary feature vector), equations.ts (pure equations), this file (state, hooks), testkit.ts + *.test.ts.
 *
 * Design (06 §4.1, §4.18): every marker is the sum of mechanism states, each with its own first-order time constant
 * (exact daily update x ← x* + (x − x*)·e^(−1/τ)), driven by DELTAS between today's inputs and the user's habitual state,
 * so at t = 0 every delta is 0 and the recorded value equals the baseline (labs when given, else the NHANES generator,
 * MODEL_SPEC R-PRES: the UI shows the change from that baseline). All slow work happens in `endOfDay`; `stepHour` only
 * accumulates the day's exercise, ketone and post-absorptive samples. Daily outputs act on the next day (§3.3).
 *
 * Baseline handling (MODEL_SPEC §3.4): the burn-in runs the habitual WEEK (with the habitual sessions), so the absolute
 * states (S_hep, S_mus with the real session history E_is, T_C, lagged factors) reach the habitual steady state, and the
 * exercise-dose rings hold the habitual week's doses as this module counts them. `endBurnIn` latches the baselines —
 * habitual weekly doses (aerobic min, MET·h, sets), fat mass after composition's reset, the habitual week's mean BHB /
 * ketosis state and normalised post-absorptive glucose — and zeroes every mechanism delta, so at t = 0 every marker equals
 * its baseline exactly and a person repeating the habitual week shows no drift. Insulin sensitivity is absolute
 * (reference healthy adult = 1), so `insulinResistanceIdx = 1 − S_I` is the person's absolute IR (review m13).
 *
 * Optional inputs: `DayInput.cholesterolMg` (undefined/NaN = habitual, no effect), `dashFraction` (undefined/NaN = from
 * foodQuality), `saunaSessionsPerWeek` (undefined = 0). Dossier 06 has no smoking term for any modelled marker, so
 * `habits.smoker` is not read. Exercise doses (aerobic min/wk at ≥ 40 % VO2max, MET·h/wk, resistance sets/wk) are
 * accumulated from `HourInput` because 06's equations are written in those units (`aerobicIdx` is energy-based).
 * Display-only markers (lipids, BP, glycaemia, CRP, urate) are skipped when their series are not recorded (planner);
 * S_hep, S_mus, T_C, the IR index and liver fat are always computed (other modules read them).
 */
import { clamp, clamp01, relax, relax2 } from '../../core/math';
import { DEFAULTS } from '../../core/defaults';
import { defineModule } from '../../core/moduleKit';
import { MI } from '../../types/metrics';
import type { MetricFrame, ModuleContext, StepClock } from '../../types/module';
import type { DayInput, HourInput } from '../../types/inputs';
import type { SignalBus } from '../../types/signals';
import { MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG } from './baselines';
import { buildK, type CardiometabolicK } from './constants';
import { Diet, readDiet } from './diet';
import {
  bpAlcoholTarget, bpExerciseTarget, bpOmega3Target, bpPotassiumTarget, bpSaunaTarget, bpSodiumTarget, carbToleranceTarget, cholesterolDeltaTc,
  fAdiposity, fEnergyBalance3d, fExerciseAcute, fFitness, fLiverFat, fSfaTarget, fStepsTarget, fSugarTarget, fractionalDnlPct, hdlCompositionTarget,
  ketosisState, ldlCompositionTarget, lemAmplitude, lemEnergyModifier, lnOnePlus, portfolioLdlTarget, tgAlcoholMgDl, tgExchangeLn,
  tgOmega3Fraction, tgSugarMmol, urateDashEffect, urateKetoneTarget, wholeBodySensitivity,
} from './equations';
import { CARDIOMETABOLIC_PARAMS } from './params';

export type { CardiometabolicK } from './constants';

export interface CardiometabolicState {
  // ---------------------------------------------------------------------------------------- 04 §4.18 insulin sensitivity
  /** Hepatic insulin sensitivity S_hep, rel (reference healthy adult = 1). */
  sHep: number;
  /** Peripheral (muscle) insulin sensitivity S_mus, rel. */
  sMus: number;
  /** Lagged factors of 04 §4.18 (steps 7 d, SFA 21 d, sugar 7 d) and the acute-exercise factor, rel. */
  fStepsLag: number;
  fSfaLag: number;
  fSugarLag: number;
  fExAcute: number;
  /** E_is: acute exercise insulin-action pulse, 0..1 (flat for 24 h after the last session, then decays τ 30 h). */
  eIs: number;
  /** Hours since the last exercise hour. */
  hoursSinceEx: number;
  // ---------------------------------------------------------------------------------------- carbohydrate tolerance
  /** T_fast and T_slow components (04 §4.19 structure; τ 2.5 d / 28 d, ruling R-TC), 0..1. */
  tcFast: number;
  tcSlow: number;
  /** T_C = 0.6·T_fast + 0.4·T_slow, 0..1 (bus `carbTolerance`). */
  tolerance: number;
  /** Excess 2-h OGTT glucose vs the carbohydrate-adapted state, mmol/L (13 §4.8 a_f(1−T_fast) + a_s(1−T_slow)). */
  ogttExcess2hMmolL: number;
  /** 1 while an OGTT / post-meal reading would overstate intolerance (1 − T_C > 0.1). */
  ogttNotRepresentative: number;
  // ---------------------------------------------------------------------------------------- rings and day accumulators
  /** 3-day ring of net carbohydrate eaten, g (CI_3d of T_C). */
  carbRing: Float64Array;
  /** 3-day ring of energy balance, kcal/d (F_EBh). */
  ebRing: Float64Array;
  /** Shared write pointer of the two 3-day rings. */
  ptr3: number;
  /**
   * 14-day ring of tissue mass FM + FFM_act, kg (weight without glycogen/water swings: the rate of loss for the
   * active-vs-stable HDL rule and the overfeeding gain rate). Tissue mass replaced ΔFM/0.75 on 2026-09-30 (contract request
   * "cardiometabolic may read tissueMassKg"): 06's weight coefficients are per kg / % of body weight, and the engine's fat
   * share of tissue change ranges 0.66 (VLCD) to 0.87 (slow loss).
   */
  tmRing: Float64Array;
  ptr14: number;
  /** 7-day rings: aerobic minutes (min/d), gross MET·h (per d), resistance sets (per d, all regions). */
  aerRing: Float64Array;
  metRing: Float64Array;
  rtRing: Float64Array;
  ptr7: number;
  /** Sum of the day's hourly BHB readings, mmol/L·h. */
  bhbSum: number;
  /** Hours accumulated so far today. */
  nHours: number;
  /** Sums of post-absorptive (tPA ≥ 8 h) hourly glucose (mmol/L) and insulin (µU/mL) and their hour count. */
  paGlcSum: number;
  paInsSum: number;
  paN: number;
  /** Today's aerobic minutes at ≥ 40 % VO2max, gross MET·h of all sessions, and resistance sets (all regions). */
  dayAerMin: number;
  dayMetH: number;
  dayRtSets: number;
  // ---------------------------------------------------------------------------------------- references (t = 0)
  /** Tissue mass at t = 0 (kg, after composition's reset; the weight-change reference). */
  tmRef: number;
  /** Habitual-week mean of the daily mean BHB (mmol/L) and of the ketosis state s_keto (0..1). */
  bhbRef: number;
  sKetoRef: number;
  /** Habitual weekly exercise doses as this module counts them: aerobic min/wk (≥ 40 % VO2max), MET·h/wk, sets/wk (all regions). */
  aerRefMinWk: number;
  metRefHWk: number;
  rtRefSetsWk: number;
  /**
   * VO2max (mL/kg/min) against which session minutes are classified as aerobic (≥ 40 % VO2max): the current value during
   * burn-in, latched at t = 0 — a later VO2max change must not flip the habitual sessions in or out of the aerobic dose.
   */
  vo2ClassMlKgMin: number;
  /** Habitual post-absorptive glucose per unit of intake's S_hep factor (mmol/L; 04 §4.16 Glc_f when never sampled). */
  paGlcNorm0: number;
  /** Burn-in accumulators of the last habitual week: days, Σ daily mean BHB, Σ s_keto, Σ normalised PA glucose and its count. */
  wkDays: number;
  wkBhbSum: number;
  wkKetoSum: number;
  wkGlcSum: number;
  wkGlcN: number;
  /** Burn-in days seen (the dose rings are a full habitual week once ≥ 7). */
  burnDays: number;
  /** 1 once the baselines were latched (`endBurnIn`, or the first real day when a harness never calls it). */
  refsTracked: number;
  /** Scratch reading of today's diet (shares of energy, g/d, mmol/d). */
  today: Diet;
  /** Held snapshot of the last fed day: composition-driven inputs hold on zero-intake days. */
  diet: Diet;
  // ---------------------------------------------------------------------------------------- mechanism states (deltas from baseline)
  /** LDL-C delta from dietary composition and cholesterol (Mensink exchange terms; τ 7 d), mg/dL. */
  ldlComp: number;
  /** LDL-C delta from the portfolio components viscous fibre and nuts (sub-additive; τ 10 d), mg/dL. */
  ldlPort: number;
  /** LDL-C delta from the lean-mass hyper-responder (LEM) term (τ 10 d), mg/dL. */
  ldlKeto: number;
  /** LDL-C delta from weight change (−0.6 mg/dL per kg lost; τ 30-45 d), mg/dL. */
  ldlWeight: number;
  /** HDL-C delta from diet incl. alcohol, cholesterol and EPA+DHA (τ 10 d), mg/dL. */
  hdlComp: number;
  /** HDL-C delta from aerobic training (τ 30 d), mg/dL. */
  hdlEx: number;
  /** HDL-C delta from weight change, active (−0.27/kg) vs stable (+0.35/kg) branch (τ 30 d), mg/dL. */
  hdlWeight: number;
  /** ln TG delta from composition, sugar, alcohol and ketosis (τ 4 d), ln units. */
  tgComp: number;
  /** ln TG delta from the acute energy deficit (τ 5 d), ln units. */
  tgAcute: number;
  /** ln TG delta from EPA+DHA (τ 14 d), ln units. */
  tgN3: number;
  /** ln TG delta from exercise (τ 21 d), ln units. */
  tgEx: number;
  /** ln TG delta from weight change (τ 30-45 d), ln units. */
  tgWeight: number;
  /** SBP delta from DASH, protein and MUFA (τ 4 d), mmHg. */
  sbpFast: number;
  /** SBP delta from sodium, potassium and weight (τ 21 d), mmHg. */
  sbpSlow: number;
  /** SBP delta from alcohol above 24 g/d (τ 10 d), mmHg. */
  sbpAlcohol: number;
  /** SBP delta from aerobic and resistance training (τ 30 d), mmHg. */
  sbpEx: number;
  /** SBP delta from the omega-3 lever (τ 21 d), mmHg. */
  sbpN3: number;
  /** SBP delta from the sauna lever (τ 14 d), mmHg. */
  sbpSauna: number;
  /** ln liver fat delta: weight loss, ketosis, exercise, acute deficit (τ 12 d down / 21 d up), ln units. */
  lnLslow: number;
  /** ln liver fat delta from overfeeding by macronutrient type (D state, τ 120 d), ln units. */
  liverD: number;
  /** Fasting glucose delta from weight change (τ 30 d), mg/dL. */
  fpgWeight: number;
  /** Fasting glucose delta from the acute energy deficit, T2D-range baselines only (τ 5 d), mg/dL. */
  fpgAcute: number;
  /** Fasting glucose delta carried by the intake curves' post-absorptive glucose (fasting-state fall), mg/dL. */
  fpgFast: number;
  /** HbA1c delta (τ 50 d, eAG = 28.7·A1c − 46.7), percentage points. */
  a1cDelta: number;
  /** ln hs-CRP delta from adiposity (threshold rule) and omega-3 (τ 30-60 d), ln units. */
  crpWeight: number;
  /** ln hs-CRP delta from exercise (τ 60 d), ln units. */
  crpEx: number;
  /** Urate delta from ketones, BHB × 0.6 (τ 5 d up / 7 d down), mg/dL. */
  uaKeto: number;
  /** Urate delta from alcohol and hypercaloric fructose (τ 7 d), mg/dL. */
  uaDiet: number;
  /** Urate delta from weight change and DASH (τ 30 d), mg/dL. */
  uaWeight: number;
  // ---------------------------------------------------------------------------------------- derived outputs (units of the metrics)
  /** S_I = S_hep^0.4·S_mus^0.6, rel. */
  outSensitivity: number;
  /** LDL-C, mmol/L. */
  outLdlMmol: number;
  /** ApoB, g/L. */
  outApoBgL: number;
  /** HDL-C, mmol/L. */
  outHdlMmol: number;
  /** Triglycerides, mmol/L. */
  outTgMmol: number;
  /** Systolic blood pressure, mmHg. */
  outSbp: number;
  /** Intrahepatic triglyceride, %. */
  outLiverPct: number;
  /** Fasting glucose, mmol/L. */
  outFpgMmol: number;
  /** hs-CRP relative to the baseline value (1 = baseline). */
  outCrpRel: number;
  /** Uric acid relative to the baseline value (1 = baseline). */
  outUaRel: number;
  /** HbA1c, % (detail, not a recorded series). */
  outA1cPct: number;
  /** Non-HDL cholesterol, mg/dL, and the TG/HDL ratio (06 §6 descriptors). */
  outNonHdlMg: number;
  outTgHdl: number;
  // ---------------------------------------------------------------------------------------- diagnostics
  /** 04 §4.13b hepatic fractional DNL, %. */
  fdnlPct: number;
  /** Daily mean post-absorptive glucose (mmol/L) / insulin (µU/mL) from the intake curves and the implied HOMA-IR. */
  paGlucoseMmolL: number;
  paInsulinUuMl: number;
  /** HOMA-IR implied by the post-absorptive samples (glucose·insulin/22.5). */
  homaObs: number;
  /** Ketosis state s_keto of the last day, 0..1. */
  sKeto: number;
  /** Rate of fat-mass-derived weight loss over 14 d, % of body weight per week (positive = losing). */
  rate14PctWk: number;
  /** Weight lost vs t = 0, kg (positive = lost; ΔFM / fat share of weight change). */
  kgLost: number;
}

/**
 * Outputs in the metrics' units; display-only blocks only when recorded or `all` (init and end of burn-in, so the state
 * always holds the baseline values). S_I and liver fat are always computed (other modules read them).
 */
function computeOutputs(s: CardiometabolicState, k: CardiometabolicK, all = false): void {
  s.outSensitivity = wholeBodySensitivity(s.sHep, s.sMus, k);
  s.outLiverPct = clamp(k.l0 * Math.exp(s.lnLslow + s.liverD), k.liverMin, k.liverMax);
  if (all || k.doLipids) {
    const ldlMg = clamp(k.ldl0 + s.ldlComp + s.ldlPort + s.ldlKeto + s.ldlWeight, 20, 600);
    const hdlMg = clamp(k.hdl0 + s.hdlComp + s.hdlEx + s.hdlWeight, 12, 160);
    const tgMg = clamp(k.tg0 * Math.exp(s.tgComp + s.tgAcute + s.tgN3 + s.tgEx + s.tgWeight), 15, 3000);
    const nonHdl = ldlMg + tgMg / k.vldlDivisor;
    const nonHdl0 = k.ldl0 + k.tg0 / k.vldlDivisor;
    const apoBmg = clamp(k.apoB0 + k.apobPerNonHdl * (nonHdl - nonHdl0), 10, 500);
    s.outLdlMmol = ldlMg / MGDL_PER_MMOLL_CHOL;
    s.outApoBgL = apoBmg / 100;
    s.outHdlMmol = hdlMg / MGDL_PER_MMOLL_CHOL;
    s.outTgMmol = tgMg / MGDL_PER_MMOLL_TG;
    s.outNonHdlMg = nonHdl;
    s.outTgHdl = tgMg / hdlMg;
  }
  if (all || k.doBp) {
    let lev = s.sbpN3 + s.sbpSauna;
    if (lev < -k.bpLeverCap) lev = -k.bpLeverCap;
    s.outSbp = clamp(k.sbp0 + s.sbpFast + s.sbpSlow + s.sbpAlcohol + s.sbpEx + lev, 60, 260);
  }
  if (all || k.doGlyc) {
    s.outFpgMmol = clamp(k.fpg0 + s.fpgWeight + s.fpgAcute + s.fpgFast, 40, 500) / MGDL_PER_MMOLL_GLC;
    s.outA1cPct = clamp(k.a1c0 + s.a1cDelta, 3.5, 15);
  }
  if (all || k.doCrp) s.outCrpRel = Math.exp(clamp(s.crpWeight + s.crpEx, -3, 3));
  if (all || k.doUa) s.outUaRel = Math.max(1, k.ua0 + s.uaKeto + s.uaDiet + s.uaWeight) / k.ua0;
}

function writeBus(s: CardiometabolicState, bus: SignalBus): void {
  bus.sHep = s.sHep;
  bus.sMus = s.sMus;
  bus.carbTolerance = s.tolerance;
  bus.insulinResistanceIdx = clamp01(1 - s.outSensitivity);
  bus.liverFatPct = s.outLiverPct;
}

/** Zero every mechanism delta (end of burn-in: the habitual state IS the baseline, 06 §4.1). */
function resetDeltas(s: CardiometabolicState): void {
  s.ldlComp = 0; s.ldlPort = 0; s.ldlKeto = 0; s.ldlWeight = 0;
  s.hdlComp = 0; s.hdlEx = 0; s.hdlWeight = 0;
  s.tgComp = 0; s.tgAcute = 0; s.tgN3 = 0; s.tgEx = 0; s.tgWeight = 0;
  s.sbpFast = 0; s.sbpSlow = 0; s.sbpAlcohol = 0; s.sbpEx = 0; s.sbpN3 = 0; s.sbpSauna = 0;
  s.lnLslow = 0; s.liverD = 0;
  s.fpgWeight = 0; s.fpgAcute = 0; s.fpgFast = 0; s.a1cDelta = 0;
  s.crpWeight = 0; s.crpEx = 0;
  s.uaKeto = 0; s.uaDiet = 0; s.uaWeight = 0;
}

/**
 * Latch the baselines (MODEL_SPEC §3.4): habitual weekly doses from the rings (a full habitual week after ≥ 7 burn-in days,
 * else the profile priors), fat mass after composition's reset, the habitual week's BHB / ketosis / normalised
 * post-absorptive glucose, and zero every delta so each marker equals its baseline at t = 0.
 */
function latchBaselines(s: CardiometabolicState, k: CardiometabolicK, bus: SignalBus): void {
  if (s.burnDays >= 7) {
    let a = 0;
    let m = 0;
    let r = 0;
    for (let i = 0; i < 7; i++) {
      a += s.aerRing[i]!;
      m += s.metRing[i]!;
      r += s.rtRing[i]!;
    }
    s.aerRefMinWk = a;
    s.metRefHWk = m;
    s.rtRefSetsWk = r;
  } else {
    s.aerRefMinWk = k.aer0MinWk;
    s.metRefHWk = k.met0HWk;
    s.rtRefSetsWk = k.rt0SetsWk;
    s.aerRing.fill(k.aer0MinWk / 7);
    s.metRing.fill(k.met0HWk / 7);
    s.rtRing.fill(k.rt0SetsWk / 7);
  }
  s.vo2ClassMlKgMin = bus.vo2maxMlKgMin;
  const tm = bus.tissueMassKg;
  s.tmRef = tm;
  s.tmRing.fill(tm);
  if (s.wkDays > 0) {
    s.bhbRef = s.wkBhbSum / s.wkDays;
    s.sKetoRef = s.wkKetoSum / s.wkDays;
  } else {
    s.bhbRef = bus.bhbMmolL;
    s.sKetoRef = ketosisState(bus.bhbMmolL, k);
  }
  s.paGlcNorm0 = s.wkGlcN > 0 ? s.wkGlcSum / s.wkGlcN : k.glcFasting;
  resetDeltas(s);
  s.kgLost = 0;
  s.rate14PctWk = 0;
  computeOutputs(s, k, true);
  writeBus(s, bus);
  s.refsTracked = 1;
}

/** Per-hour exercise bookkeeping (allocation-free): acute insulin-action pulse and the weekly dose accumulators. */
function exerciseHour(s: CardiometabolicState, k: CardiometabolicK, bus: SignalBus, hour: HourInput): void {
  const mins = hour.exMin;
  const vo2Met = bus.vo2maxMlKgMin / 3.5;
  const vo2MetClass = s.refsTracked === 0 ? vo2Met : s.vo2ClassMlKgMin / 3.5;
  let met: number;
  let eNew: number;
  if (hour.rtSetsTotal > 0 || hour.exModality === 0) {
    // resistance hour: the acute pulse follows sets/12 (04 §4.18), MET from the session style
    met = hour.exMet > 0 ? hour.exMet : 3.5;
    s.dayRtSets += hour.rtSetsTotal;
    eNew = hour.rtSetsTotal / k.exSets;
  } else {
    met = hour.exMet > 0 ? hour.exMet : (hour.exIntensityFrac > 0 ? hour.exIntensityFrac : DEFAULTS.cardioPctVo2max.other) * vo2Met;
    eNew = ((met - k.restMet) * k.bw0 * (mins / 60)) / k.exKcal;
    if (met >= k.aerobicMinFrac * vo2MetClass) s.dayAerMin += mins;
  }
  s.dayMetH += (met * mins) / 60;
  const e = s.eIs + (eNew > 0 ? eNew : 0);
  s.eIs = e > 1 ? 1 : e;
  s.hoursSinceEx = 0;
}

export const cardiometabolicModule = defineModule<CardiometabolicState, CardiometabolicK>({
  id: 'cardiometabolic',
  specSection: '§1.14',
  dossiers: '06 §4.1-4.16; 04 §4.13b/4.18-4.19; 13 §4.8/4.12; 11 §4.9-4.10; 10 §4.7/4.10; 16; 20 §4.7',
  params: CARDIOMETABOLIC_PARAMS,
  reads: [
    'glucoseMmolL', 'insulinUuMl', 'carbAbs24G', 'hoursPostAbsorptiveH', 'fatMassKg', 'tissueMassKg', 'energyBalanceFrac',
    'energyBalance7KcalD', 'siSleepMult', 'vo2maxMlKgMin', 'bhbMmolL',
  ],
  writes: ['sHep', 'sMus', 'carbTolerance', 'insulinResistanceIdx', 'liverFatPct'],
  records: ['insulinSensitivity', 'ldl', 'apoB', 'hdl', 'triglycerides', 'sbp', 'liverFat', 'fastingGlucose', 'crp', 'uricAcid'],

  prepare: (ctx: ModuleContext): CardiometabolicK => buildK(ctx),

  init: (k, ctx, bus) => {
    const prof = ctx.profile;
    const habCarb = prof.habitualCarbG;
    const tStar = carbToleranceTarget(habCarb, k);
    const fm0 = prof.fm0Kg;
    const tm0 = bus.tissueMassKg;
    const s: CardiometabolicState = {
      sHep: 1, sMus: 1,
      fStepsLag: fStepsTarget(prof.habits.typicalSteps, k),
      fSfaLag: fSfaTarget(k.hab.sfaTotPct, k.hab.fatPct, k),
      fSugarLag: fSugarTarget(k.hab.sugarPct, k),
      fExAcute: fExerciseAcute(k.eIs0, k), eIs: k.eIs0, hoursSinceEx: 1000,
      tcFast: tStar, tcSlow: tStar, tolerance: tStar, ogttExcess2hMmolL: 0, ogttNotRepresentative: 0,
      carbRing: new Float64Array(3).fill(habCarb), ebRing: new Float64Array(3), ptr3: 0,
      tmRing: new Float64Array(14).fill(tm0), ptr14: 0,
      aerRing: new Float64Array(7).fill(k.aer0MinWk / 7), metRing: new Float64Array(7).fill(k.met0HWk / 7), rtRing: new Float64Array(7).fill(k.rt0SetsWk / 7), ptr7: 0,
      bhbSum: 0, nHours: 0, paGlcSum: 0, paInsSum: 0, paN: 0, dayAerMin: 0, dayMetH: 0, dayRtSets: 0,
      tmRef: tm0, bhbRef: bus.bhbMmolL, sKetoRef: ketosisState(bus.bhbMmolL, k),
      aerRefMinWk: k.aer0MinWk, metRefHWk: k.met0HWk, rtRefSetsWk: k.rt0SetsWk, vo2ClassMlKgMin: bus.vo2maxMlKgMin, paGlcNorm0: k.glcFasting,
      wkDays: 0, wkBhbSum: 0, wkKetoSum: 0, wkGlcSum: 0, wkGlcN: 0, burnDays: 0, refsTracked: 0,
      today: new Diet(), diet: new Diet(),
      ldlComp: 0, ldlPort: 0, ldlKeto: 0, ldlWeight: 0, hdlComp: 0, hdlEx: 0, hdlWeight: 0,
      tgComp: 0, tgAcute: 0, tgN3: 0, tgEx: 0, tgWeight: 0,
      sbpFast: 0, sbpSlow: 0, sbpAlcohol: 0, sbpEx: 0, sbpN3: 0, sbpSauna: 0,
      lnLslow: 0, liverD: 0, fpgWeight: 0, fpgAcute: 0, fpgFast: 0, a1cDelta: 0, crpWeight: 0, crpEx: 0, uaKeto: 0, uaDiet: 0, uaWeight: 0,
      outSensitivity: 1, outLdlMmol: 0, outApoBgL: 0, outHdlMmol: 0, outTgMmol: 0, outSbp: 0, outLiverPct: k.l0, outFpgMmol: 0,
      outCrpRel: 1, outUaRel: 1, outA1cPct: k.a1c0, outNonHdlMg: 0, outTgHdl: 0,
      fdnlPct: 0, paGlucoseMmolL: bus.glucoseMmolL, paInsulinUuMl: bus.insulinUuMl, homaObs: 0, sKeto: 0, rate14PctWk: 0, kgLost: 0,
    };
    s.diet.copyFrom(k.hab);
    s.today.copyFrom(k.hab);
    // steady-state insulin sensitivity of the habitual state (burn-in only has to absorb small bus mismatches); the acute
    // exercise factor starts at the habitual routine's mean pulse E_is0 and then follows the burn-in week's real sessions
    const fmPct = (100 * fm0) / (fm0 + k.ffm0Kg);
    const sleep = bus.siSleepMult;
    s.sHep = clamp(k.hepCal * fLiverFat(k.l0, k) * sleep * s.fSfaLag * s.fSugarLag, 0.05, 3);
    s.sMus = clamp(fAdiposity(fmPct, k) * s.fStepsLag * fFitness(bus.vo2maxMlKgMin, k) * s.fExAcute * sleep * s.fSfaLag, 0.05, 3);
    computeOutputs(s, k, true);
    writeBus(s, bus);
    return s;
  },

  endBurnIn: (s, k, bus) => latchBaselines(s, k, bus),

  startDay: (s, k, bus, _day: DayInput, clock: StepClock) => {
    // a harness that never calls endBurnIn latches on the first real day
    if (clock.day >= 0 && s.refsTracked === 0) latchBaselines(s, k, bus);
  },

  stepHour: (s, k, bus, hour) => {
    s.bhbSum += bus.bhbMmolL;
    s.nHours += 1;
    // post-absorptive samples feed only the fasting-glucose marker (display-only)
    if (k.doGlyc && bus.hoursPostAbsorptiveH >= k.paThresholdH) {
      s.paGlcSum += bus.glucoseMmolL;
      s.paInsSum += bus.insulinUuMl;
      s.paN += 1;
    }
    if (hour.exMin > 0) exerciseHour(s, k, bus, hour);
    else {
      s.hoursSinceEx += 1;
      if (s.hoursSinceEx > k.exHoldH) s.eIs *= k.fExDecayH;
    }
  },

  endOfDay: (s, k, bus, day, clock) => {
    const burn = clock.day < 0;
    const fm = bus.fatMassKg;
    const tm = bus.tissueMassKg;
    const E = day.energyKcal;

    // ------------------------------------------------------------------------------------ diet snapshot (held on zero-intake days)
    const t = s.today;
    readDiet(t, day, k.nutServingG, k.dashQ3);
    const fed = E > k.zeroIntakeKcal;
    if (fed) {
      // today's reading becomes the held snapshot (pointer swap, no copy); the old snapshot is overwritten tomorrow
      s.today = s.diet;
      s.diet = t;
    }
    const d = s.diet;
    const alcNow = burn ? k.alc0G : day.alcoholG;
    const saunaIn = day.saunaSessionsPerWeek;
    const sauna = burn || saunaIn === undefined || !(saunaIn > 0) ? 0 : saunaIn;
    // intake computed today's post-absorptive glucose with the S_hep written at the end of yesterday (= s.sHep now)
    const sHepUsed = s.sHep;

    // ------------------------------------------------------------------------------------ ketosis and reference tracking
    const bhbMean = s.nHours > 0 ? s.bhbSum / s.nHours : bus.bhbMmolL;
    const sKeto = ketosisState(bhbMean, k);
    if (burn) {
      // burn-in: deltas stay ≈ 0 (references follow the day); the last habitual week is accumulated for endBurnIn
      s.tmRef = tm;
      s.bhbRef = bhbMean;
      s.sKetoRef = sKeto;
      s.burnDays += 1;
      if (clock.day >= -7) {
        s.wkDays += 1;
        s.wkBhbSum += bhbMean;
        s.wkKetoSum += sKeto;
      }
    }

    // ------------------------------------------------------------------------------------ body weight and energy balance
    const kgLost = s.tmRef - tm;
    const bwNow = k.bw0 - kgLost;
    const bmiNow = bwNow / (k.heightM * k.heightM);
    const tmOld = s.tmRing[s.ptr14]!;
    // 11 §4.9 max(0, dBW%/dt) on the fat-mass trend over the last n = 7 days (d(7-day mean)/dt): day-to-day swings of a
    // weekly training pattern (session vs rest days) would otherwise ratchet the overfeeding state up at maintenance. In
    // the first week after t = 0 the window reaches back only to the t = 0 value (n = day + 1), so a gain starting at
    // t = 0 counts in full from day 0.
    const nWin = clock.day < 0 ? 1 : clock.day < 6 ? clock.day + 1 : 7;
    const iBack = s.ptr14 - nWin;
    const tmBack = s.tmRing[iBack < 0 ? iBack + 14 : iBack]!;
    s.tmRing[s.ptr14] = tm;
    s.ptr14 = s.ptr14 === 13 ? 0 : s.ptr14 + 1;
    const rate14 = (100 * (tmOld - tm)) / bwNow / 2;
    const gainPctDay = burn ? 0 : (100 * Math.max(0, (tm - tmBack) / nWin)) / bwNow;

    const u = burn ? 0 : clamp(bus.energyBalanceFrac, -1, 1);
    const dFrac = clamp01(-u);
    let ebKcal = 0;
    if (!burn) {
      const tee = fed && u > -0.99 ? E / (1 + u) : Number.isFinite(day.maintenanceKcal) ? day.maintenanceKcal : k.tdee0Kcal;
      ebKcal = E - tee;
    }
    s.ebRing[s.ptr3] = ebKcal;
    s.carbRing[s.ptr3] = bus.carbAbs24G;
    s.ptr3 = s.ptr3 === 2 ? 0 : s.ptr3 + 1;
    const eb3 = (s.ebRing[0]! + s.ebRing[1]! + s.ebRing[2]!) / 3;
    const ci3 = (s.carbRing[0]! + s.carbRing[1]! + s.carbRing[2]!) / 3;
    const wS = clamp01(bus.energyBalance7KcalD / k.surplusRamp);

    // ------------------------------------------------------------------------------------ exercise doses (weekly)
    s.aerRing[s.ptr7] = s.dayAerMin;
    s.metRing[s.ptr7] = s.dayMetH;
    s.rtRing[s.ptr7] = s.dayRtSets;
    s.ptr7 = s.ptr7 === 6 ? 0 : s.ptr7 + 1;
    let aerWk = 0;
    let metWk = 0;
    let rtWk = 0;
    for (let i = 0; i < 7; i++) {
      aerWk += s.aerRing[i]!;
      metWk += s.metRing[i]!;
      rtWk += s.rtRing[i]!;
    }

    // ------------------------------------------------------------------------------------ 04 §4.18 insulin sensitivity
    const fmPct = (100 * fm) / (fm + k.ffm0Kg);
    s.fStepsLag = relax(s.fStepsLag, fStepsTarget(day.steps, k), k.fSteps);
    if (fed) {
      s.fSfaLag = relax(s.fSfaLag, fSfaTarget(t.sfaTotPct, t.fatPct, k), k.fSfa);
      s.fSugarLag = relax(s.fSugarLag, fSugarTarget(t.sugarPct, k), k.fSugar);
    }
    s.fExAcute = fExerciseAcute(s.eIs, k);
    const sleep = bus.siSleepMult;
    // F_EBh is 04's hypocaloric-diet effect (48-h CR); on a zero-intake day it is neutral — a fast does not improve and
    // transiently lowers insulin sensitivity (20 §4.7 [69, 23]; its tolerance fall is T_C's) — while the ring keeps the
    // day's balance so alternate-day fasting and daily CR at the same mean deficit get the same credit on eating days
    const sHepT = k.hepCal * fLiverFat(s.outLiverPct, k) * (fed ? fEnergyBalance3d(eb3, k) : 1) * sleep * s.fSfaLag * s.fSugarLag;
    const sMusT = fAdiposity(fmPct, k) * s.fStepsLag * fFitness(bus.vo2maxMlKgMin, k) * s.fExAcute * sleep * s.fSfaLag;
    s.sHep = clamp(relax(s.sHep, sHepT, k.fHep), 0.05, 3);
    s.sMus = clamp(relax(s.sMus, sMusT, k.fMus), 0.05, 3);

    // ------------------------------------------------------------------------------------ 04 §4.19 carbohydrate tolerance
    const tStar = carbToleranceTarget(ci3, k);
    s.tcFast = relax(s.tcFast, tStar, k.fTcFast);
    s.tcSlow = relax(s.tcSlow, tStar, k.fTcSlow);
    s.tolerance = k.wFast * s.tcFast + (1 - k.wFast) * s.tcSlow;
    s.ogttExcess2hMmolL = k.ogttAf * (1 - s.tcFast) + k.ogttAs * (1 - s.tcSlow);
    s.ogttNotRepresentative = 1 - s.tolerance > k.readyThreshold ? 1 : 0;

    const h = k.hab;
    // ------------------------------------------------------------------------------------ lipids (06 §4.2-4.7)
    if (k.doLipids) {
      let dTc = 0;
      if (!burn && Number.isFinite(d.cholesterolMg)) dTc = cholesterolDeltaTc(d.cholesterolMg, d.energyKcal, k);
      s.ldlComp = relax(s.ldlComp, ldlCompositionTarget(d, k, dTc), k.fLdlComp);
      s.ldlPort = relax(s.ldlPort, portfolioLdlTarget(d, k), k.fPortfolio);
      const lemNow = k.lemEnabled * k.lemResp * lemAmplitude(bmiNow, k) * lemEnergyModifier(u, k) * sKeto;
      const lemRef = k.lemEnabled * k.lemResp * lemAmplitude(k.bmi0, k) * s.sKetoRef;
      s.ldlKeto = relax(s.ldlKeto, lemNow - lemRef, k.fLem);
      const wResp = k.lemA > 0 ? clamp01(lemAmplitude(bmiNow, k) / k.lemA) : 0;
      s.ldlWeight = relax(s.ldlWeight, -k.ldlWtPerKg * kgLost * (1 - k.lemEnabled * sKeto * wResp), k.fLdlWeight);

      const alcHdl = Math.min(alcNow, k.alcValidityG) - Math.min(k.alc0G, k.alcValidityG);
      s.hdlComp = relax(s.hdlComp, hdlCompositionTarget(d, k, dTc) + k.hdlAlcPerG * alcHdl, k.fHdlComp);
      const aerDose = Math.min(1, aerWk / k.hdlAerobicRefMin) - Math.min(1, s.aerRefMinWk / k.hdlAerobicRefMin);
      s.hdlEx = relax(s.hdlEx, k.hdlAerobic * aerDose, k.fHdlEx);
      s.hdlWeight = relax(s.hdlWeight, kgLost * (rate14 > k.hdlActiveRate ? k.hdlWtActive : k.hdlWtStable), k.fHdlWeight);

      const sugarMmol = tgSugarMmol(d, k, wS);
      const alcMg = tgAlcoholMgDl(alcNow, k);
      const sugarLn = sugarMmol === 0 ? 0 : lnOnePlus(sugarMmol / k.tg0Mmol);
      const alcLn = alcMg === 0 ? 0 : lnOnePlus(alcMg / k.tg0);
      s.tgComp = relax(s.tgComp, tgExchangeLn(d, k) + sugarLn + alcLn - k.tgKetoK * (sKeto - s.sKetoRef), k.fTgComp);
      s.tgAcute = relax(s.tgAcute, -k.tgAcute * Math.max(0, dFrac - k.defThreshold), k.fTgAcute);
      s.tgN3 = relax(s.tgN3, lnOnePlus(tgOmega3Fraction(d.omega3G, k)) - k.tgN3LnBase, k.fTgN3);
      s.tgEx = relax(s.tgEx, -k.tgExercise * (Math.min(1, metWk / k.tgExRefMetH) - Math.min(1, s.metRefHWk / k.tgExRefMetH)), k.fTgEx);
      s.tgWeight = relax(s.tgWeight, -(k.bmi0 < 30 ? k.tgWtLow : k.tgWtHigh) * kgLost, k.fTgWeight);
    }

    // ------------------------------------------------------------------------------------ blood pressure (06 §4.8; 21 levers)
    if (k.doBp) {
      s.sbpFast = relax(s.sbpFast, -k.dashSbp * (d.dash - h.dash) + k.bpProtein * (d.protPct - h.protPct) + k.bpMufa * (d.mufaPct - h.mufaPct), k.fBpFast);
      s.sbpSlow = relax(s.sbpSlow, bpSodiumTarget(d, k) + bpPotassiumTarget(d, k) - k.bpWeight * kgLost, k.fBpSlow);
      s.sbpAlcohol = relax(s.sbpAlcohol, bpAlcoholTarget(alcNow, k), k.fBpAlcohol);
      s.sbpEx = relax(s.sbpEx, bpExerciseTarget(aerWk, rtWk / 9, s.aerRefMinWk, s.rtRefSetsWk / 9, k), k.fBpExercise);
      s.sbpN3 = relax(s.sbpN3, bpOmega3Target(d.omega3G, k), k.fBpSlow);
      s.sbpSauna = relax(s.sbpSauna, bpSaunaTarget(sauna, k), k.fBpSauna);
    }

    // ------------------------------------------------------------------------------------ liver fat (06 §4.9; 11 §4.9; 10 §4.7)
    const pctWL = (100 * kgLost) / k.bw0;
    let exRed = k.liverEx * (Math.min(1, metWk / k.liverExRef) - Math.min(1, s.metRefHWk / k.liverExRef));
    if (exRed > 0) exRed = Math.max(0, exRed - k.liverExStack * k.liverWl * Math.max(0, pctWL - k.liverExStackPct));
    const lnTarget = -k.liverWl * Math.max(0, pctWL) - k.liverCr * (sKeto - s.sKetoRef) - exRed - k.liverAcute * Math.max(0, dFrac - k.defThreshold);
    s.lnLslow = relax2(s.lnLslow, lnTarget, k.fLiverUp, k.fLiverDown);
    // k_liver(mix): weights are the class shares of the SURPLUS energy over the habitual intake (11 §4.9), mixed default otherwise
    let kMix = k.kMixed;
    const surplus = E - h.energyKcal;
    if (fed && surplus > k.liverSurplusMinKcal) {
      const dSfa = Math.max(0, (d.sfaTotPct * E) / 100 - (h.sfaTotPct * h.energyKcal) / 100);
      const dMufa = Math.max(0, (d.mufaPct * E) / 100 - (h.mufaPct * h.energyKcal) / 100);
      const dPufa = Math.max(0, (d.pufaPct * E) / 100 - (h.pufaPct * h.energyKcal) / 100);
      const dSug = Math.max(0, (d.sugarPct * E) / 100 - (h.sugarPct * h.energyKcal) / 100);
      const classes = dSfa + dMufa + dPufa + dSug;
      const denom = Math.max(surplus, classes);
      kMix = (dSfa * k.kSfa + dMufa * k.kUnsat + dPufa * k.kN6 + dSug * k.kSugar + Math.max(0, surplus - classes) * k.kMixed) / denom;
    }
    // 11 §4.9 applies on surplus days: wS (the smooth surplus indicator of the 7-day energy balance) gates the gain
    const incr = kgLost < 0 ? wS * (kMix / 100) * gainPctDay : 0;
    s.liverD = s.liverD * k.fLiverD + incr;

    // ------------------------------------------------------------------------------------ glycaemia (06 §4.11)
    if (k.doGlyc) {
      s.fpgWeight = relax(s.fpgWeight, -k.fpgWt * kgLost, k.fFpgWeight);
      const fpgAcuteT = k.fpg0 > 100 ? (-k.fpgAcute * (k.fpg0 - 100) * Math.max(0, dFrac - k.defThreshold)) / k.fpgAcuteRefD : 0;
      s.fpgAcute = relax(s.fpgAcute, fpgAcuteT, k.fFpgAcute);
      // post-absorptive glucose of the intake curves (04 §4.16; carries the fasting-state fall of 20 §4.7). Intake scales
      // it by S_hep^(−0.1) (Glc_f = 5·S_hep^(−0.1)); that part is divided out because 06's weight/deficit terms own it, and
      // the rest is compared with the habitual week's value. Days without post-absorptive hours (tPA ≥ 8 h) carry no
      // fasting-state information: the term is 0.
      let fpgFastT = 0;
      if (s.paN > 0) {
        const hepPowUsed = Math.pow(sHepUsed, k.glcHepExp);
        s.paGlucoseMmolL = s.paGlcSum / s.paN;
        s.paInsulinUuMl = s.paInsSum / s.paN;
        if (burn) {
          if (clock.day >= -7) {
            s.wkGlcSum += s.paGlucoseMmolL / hepPowUsed;
            s.wkGlcN += 1;
          }
        } else fpgFastT = MGDL_PER_MMOLL_GLC * clamp(s.paGlucoseMmolL - s.paGlcNorm0 * hepPowUsed, -k.glcFastClamp, k.glcFastClamp);
      }
      s.fpgFast = fpgFastT;
      s.a1cDelta = relax(s.a1cDelta, (k.meanGlucoseFactor * (s.fpgWeight + s.fpgAcute + s.fpgFast)) / k.eagSlope, k.fA1c);
    }

    // ------------------------------------------------------------------------------------ hs-CRP (06 §4.12)
    if (k.doCrp) {
      const thrKg = (k.crpThresholdPct / 100) * k.bw0;
      const below = Math.min(kgLost, thrKg);
      const above = Math.max(0, kgLost - thrKg);
      const perKgBmi = 1 / (k.heightM * k.heightM);
      const n3Now = k.crp0 > k.crpOmega3Crp0 && d.omega3G >= k.crpOmega3Dose ? 1 : 0;
      const n3Base = k.crp0 > k.crpOmega3Crp0 && h.omega3G >= k.crpOmega3Dose ? 1 : 0;
      s.crpWeight = relax(s.crpWeight, -k.crpPerBmi * (k.crpBelowSlope * below + above) * perKgBmi - k.crpOmega3 * (n3Now - n3Base), k.fCrpWeight);
      s.crpEx = relax(s.crpEx, -k.crpExercise * (Math.min(1, aerWk / k.crpExRefMin) - Math.min(1, s.aerRefMinWk / k.crpExRefMin)), k.fCrpEx);
    }

    // ------------------------------------------------------------------------------------ uric acid (06 §4.13; 20 §4.7 is a target)
    if (k.doUa) {
      s.uaKeto = relax2(s.uaKeto, urateKetoneTarget(bhbMean, k) - urateKetoneTarget(s.bhbRef, k), k.fUaUp, k.fUaDown);
      const fructoseExcess = Math.max(0, d.fructosePct - h.fructosePct);
      const uaDietT = k.uaAlcohol * k.uaBevMult * (alcNow - k.alc0G) + wS * k.uaFructose * Math.min(1, fructoseExcess / k.uaFructoseRef);
      s.uaDiet = relax(s.uaDiet, uaDietT, k.fUaDiet);
      s.uaWeight = relax(s.uaWeight, -k.uaWeight * kgLost - (urateDashEffect(d.dash, k) - k.uaDashHab), k.fUaWeight);
    }

    // ------------------------------------------------------------------------------------ diagnostics (state only)
    if (k.doGlyc) {
      s.fdnlPct = fed ? fractionalDnlPct((400 * day.carbG) / E, 100 * u, t.sugarShareOfCarb, s.sHep, k) : 0;
      s.homaObs = (s.paGlucoseMmolL * s.paInsulinUuMl) / 22.5;
    }
    s.sKeto = sKeto;
    s.rate14PctWk = rate14;
    s.kgLost = kgLost;

    // ------------------------------------------------------------------------------------ outputs, bus, reset accumulators
    computeOutputs(s, k);
    writeBus(s, bus);
    if (k.checks) {
      const o = s.outSensitivity + s.outLdlMmol + s.outApoBgL + s.outHdlMmol + s.outTgMmol + s.outSbp + s.outLiverPct + s.outFpgMmol + s.outCrpRel + s.outUaRel + s.tolerance + s.ogttExcess2hMmolL;
      if (!Number.isFinite(o)) throw new Error(`cardiometabolic: non-finite output on day ${clock.day}`);
    }
    s.bhbSum = 0;
    s.nHours = 0;
    s.paGlcSum = 0;
    s.paInsSum = 0;
    s.paN = 0;
    s.dayAerMin = 0;
    s.dayMetH = 0;
    s.dayRtSets = 0;
  },

  recordDay: (s, _k, _bus, out: MetricFrame) => {
    out[MI.insulinSensitivity] = s.outSensitivity;
    out[MI.ldl] = s.outLdlMmol;
    out[MI.apoB] = s.outApoBgL;
    out[MI.hdl] = s.outHdlMmol;
    out[MI.triglycerides] = s.outTgMmol;
    out[MI.sbp] = s.outSbp;
    out[MI.liverFat] = s.outLiverPct;
    out[MI.fastingGlucose] = s.outFpgMmol;
    out[MI.crp] = s.outCrpRel;
    out[MI.uricAcid] = s.outUaRel;
  },
});
