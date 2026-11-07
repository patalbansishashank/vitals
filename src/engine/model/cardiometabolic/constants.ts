/**
 * Constants object `K` of the cardiometabolic module: every ParamDef copied once in `prepare()`, daily decay factors
 * precomputed, and the person-level baselines (NHANES generators, lab overrides, correlated z-draw) resolved.
 * Nothing in the step loop reads `ctx.params`.
 */
import { clamp, clamp01 } from '../../core/math';
import { habitualDay } from '../../core/compileSchedule';
import { RT_PRESETS } from '../../core/defaults';
import type { DayInput } from '../../types/inputs';
import type { ModuleContext } from '../../types/module';
import type { ModelParams } from '../../types/params';
import type { LabBaselineMeta, LabBaselines } from '../../types/profile';
import type { ObservedAnchor, SeriesStatusMeta } from '../../types/result';
import { SERIES_INDEX, type SeriesId } from '../../types/metrics';
import { CORR, MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG, N_Z, Z_MARKERS, cholesky, correlatedZ, type ZMarker } from './baselines';
import { Diet, readDiet } from './diet';
import { lnOnePlus, nutsLdl, tgOmega3Fraction, urateDashEffect, viscousFibreLdl } from './equations';
import {
  homaEligibility,
  medicationChronology,
  medicationStateAt,
  type DatedMedicationChange,
  type HomaEligibility,
  type LabSample,
  type LabSampleContext,
  type MedicationScreen,
} from '@/lib/measurementOperators';

export interface CardiometabolicK {
  // ------------------------------------------------------------------------------------------ person baselines
  /** 0 male, 1 female, 0.5 = unspecified (equation sets averaged). */
  sexCode: number;
  bw0: number;
  heightM: number;
  bmi0: number;
  fm0Kg: number;
  ffm0Kg: number;
  tdee0Kcal: number;
  /**
   * Solver-domain baseline marker levels (06 §2.3, §4.17): the lab value when given and inside the calibration domain,
   * else the domain-truncated value; the NHANES generator + correlated z when no lab. Response equations read these.
   * The recorded t = 0 value is the anchor below (D7-02), never this truncation.
   */
  ldl0: number; // mg/dL
  hdl0: number; // mg/dL
  tg0: number; // mg/dL
  tg0Mmol: number;
  sbp0: number; // mmHg
  fpg0: number; // mg/dL
  a1c0: number; // %
  /** hs-CRP and urate are recorded relative to their baseline: the measured value itself (exact) is the reference. */
  crp0: number; // mg/L
  ua0: number; // mg/dL
  apoB0: number; // mg/dL
  l0: number; // % intrahepatic triglyceride
  /**
   * D7-02: t = 0 anchors in the same units. An accepted measured value is used exactly (never clamped into a plausible
   * replacement); without a lab, or for a value inside the domain, the anchor equals the solver value above.
   */
  ldlAnchor: number;
  hdlAnchor: number;
  tgAnchor: number;
  sbpAnchor: number;
  fpgAnchor: number;
  a1cAnchor: number;
  apoBAnchor: number;
  lAnchor: number;
  /** D7-02: measured baselines outside the calibration domain (their projection is unavailable; the anchor stays exact). */
  outOfDomain: readonly CardiometabolicLab[];
  /** Habitual references. */
  hab: Diet;
  chol0Mg: number;
  cholZ0: number;
  alc0G: number;
  /** Profile priors of the habitual weekly doses (aerobic min, MET·h, sets); the latched references live in the state. */
  aer0MinWk: number;
  met0HWk: number;
  rt0SetsWk: number;
  /** Habitual-intake terms precomputed once (ln TG omega-3 base, viscous-fibre and nut LDL effects, DASH urate effect). */
  tgN3LnBase: number;
  vfLdlHab: number;
  nutLdlHab: number;
  uaDashHab: number;
  /** Prior of the acute-exercise pulse E_is for the habitual routine (init only; the burn-in week then runs the real sessions), 0..1. */
  eIs0: number;
  /** F_adip reference body fat, % FM (sex-resolved). */
  fmRefPct: number;
  /**
   * Hepatic-sensitivity calibration factor (04 §4.18 moderators): 1 = the latent S_hep prior (D7-06 default). Only the
   * opt-in legacy scenario (`si.homaCalibration` = 1) with an eligible same-draw fasting glucose/insulin pair off insulin
   * sets HOMA_ref/HOMA_user — an unvalidated sensitivity scenario, never a measured hepatic sensitivity.
   */
  hepCal: number;
  /** D7-06: the legacy HOMA calibration actually applied this run (scenario on and an eligible pair). */
  hepCalibrated: boolean;
  /** D7-08: the legacy sustained ketosis liver-fat term is on (labelled scenario; standard 0). */
  liverKetoScenario: number;
  /** D7-09: the FPG-linked HbA1c sensitivity scenario is on (standard 0: HbA1c stays its anchor). */
  a1cFpgScenario: number;
  /** D7-08: liver fat has a measured (non-generated) anchor; otherwise its trajectory starts from a latent BMI prior. */
  liverMeasured: boolean;
  /** D7-07: non-HDL descriptor anchor, mg/dL: a measured non-HDL when given, else the LDL + TG/divisor model proxy. */
  nonHdlAnchor: number;
  nonHdlMeasured: boolean;
  /** D7-09: glucose-lowering medication context (screening or dated changes): glycaemic responses are not attributable. */
  glucoseLoweringContext: boolean;
  /**
   * A1-063: first run day (0-based, the daily-sample index) from which the glycaemic response is in that context: 0 when a
   * current screen names a glucose-lowering drug or the class is active/unknown at the baseline sample; the day of the
   * first dated change inside the run otherwise; −1 when unaffected (a stop before a newer baseline, a start past the
   * horizon). `glucoseLoweringContext` is `glucoseLoweringFromDay >= 0`.
   */
  glucoseLoweringFromDay: number;
  // ------------------------------------------------------------------------------------------ 04 §4.18 S factors
  tauHepF: number; fHep: number; fMus: number; fSteps: number; fSfa: number; fSugar: number;
  expHep: number; lfA: number; lfRef: number; ebDefA: number; ebSurA: number; ebScale: number;
  adipK: number; adipFloor: number; stepsA: number; stepsRef: number; stepsSpan: number;
  fitSlope: number; fitRef: number; fitMin: number; fitMax: number;
  exA: number; exKcal: number; exSets: number; exHoldH: number; fExDecayH: number;
  sfaA: number; sfaRef: number; sfaFatMax: number; sugarA: number;
  // ------------------------------------------------------------------------------------------ T_C
  ciLow: number; ciSpan: number; wFast: number; fTcFast: number; fTcSlow: number; ogttAf: number; ogttAs: number; readyThreshold: number;
  // ------------------------------------------------------------------------------------------ fDNL diagnostic
  fdnlBase: number; fdnlSlope: number; fdnlEbScale: number; fdnlEbGain: number; fdnlSugarA: number; fdnlSugarB: number; fdnlIrGain: number; fdnlCap: number;
  // ------------------------------------------------------------------------------------------ lipids
  ldlSfa: number; ldlMufa: number; ldlPufa: number; ldlProt: number; ldlWtPerKg: number; alcValidityG: number;
  hdlSfa: number; hdlMufa: number; hdlPufa: number; hdlProt: number;
  tgSfa: number; tgMufa: number; tgPufa: number; tgProt: number; tgExchangeFatMax: number;
  mgdlPerMmolChol: number;
  /** Baseline dependence of the LDL SFA/PUFA coefficients, already evaluated at this person's LDL0. */
  ldlScale: number;
  cholKeys: number; cholLdlPerTc: number; cholHdlPerTc: number; cholCapMg: number; cholResp: number;
  fLdlComp: number; fHdlComp: number; fTgComp: number; fPortfolio: number; fLem: number; fLdlWeight: number;
  lemEnabled: number; lemA: number; lemB: number; lemBmiRef: number; lemKetoLo: number; lemKetoHi: number; lemEmodSlope: number; lemEmodMax: number; lemResp: number;
  vfEmaxMg: number; vfD50: number; vfLdlRef: number; nutPerServing: number; nutPerServingHigh: number; nutServingG: number; nutCap: number;
  hdlAlcPerG: number; hdlAerobic: number; hdlAerobicRefMin: number; hdlN3PerG: number; hdlWtStable: number; hdlWtActive: number; hdlActiveRate: number;
  fHdlEx: number; fHdlWeight: number;
  tgSugarHyper: number; tgSugarExcessRef: number; tgSugarBalanced: number; tgSugarFreeRef: number; tgAlcPerG: number; tgAlcCap: number;
  tgN3PerG: number; tgN3Threshold: number; tgN3Cap: number; tgN3Scale: number; tgKetoK: number; tgWtLow: number; tgWtHigh: number;
  tgAcute: number; defThreshold: number; tgExercise: number; tgExRefMetH: number;
  fTgAcute: number; fTgN3: number; fTgEx: number; fTgWeight: number;
  surplusRamp: number; vldlDivisor: number; apobIntercept: number; apobPerNonHdl: number;
  // ------------------------------------------------------------------------------------------ blood pressure
  /** β_Na,SBP resolved at this person's SBP0, mmHg per g Na. */
  betaNa: number;
  naFloorActive: number; naFloorG: number; mNa: number;
  dashSbp: number; dashNaShrink: number;
  kPerMmol: number; kCap: number; kZero: number; kHyper: number; kLowNaFactor: number; kNaThresholdG: number;
  exEndurance: number; exRt: number; exRefMin: number; exRtRefSets: number;
  bpWeight: number; bpAlcohol: number; bpAlcoholThr: number; bpProtein: number; bpMufa: number; bpOmega3: number; bpSauna: number; bpSaunaRef: number; bpLeverCap: number;
  fBpFast: number; fBpSlow: number; fBpAlcohol: number; fBpExercise: number; fBpSauna: number;
  // ------------------------------------------------------------------------------------------ liver fat
  liverWl: number; liverCr: number; liverEx: number; liverExRef: number; liverExStack: number; liverExStackPct: number; liverAcute: number;
  fLiverDown: number; fLiverUp: number; fLiverD: number;
  liverSurplusMinKcal: number; kMixed: number; kSfa: number; kUnsat: number; kN6: number; kSugar: number; liverMin: number; liverMax: number;
  // ------------------------------------------------------------------------------------------ glycaemia, CRP, urate
  /** b = 0.7 + 2.3·(FPG0 − 100)/53 clipped, mg/dL per kg lost, at this person's FPG0. */
  fpgWt: number;
  fpgAcute: number; fFpgAcute: number; fFpgWeight: number;
  fA1c: number; eagSlope: number; eagIntercept: number; meanGlucoseFactor: number;
  fpgAcuteRefD: number; glcFasting: number; glcHepExp: number; glcFastClamp: number;
  crpPerBmi: number; crpThresholdPct: number; crpBelowSlope: number; crpExercise: number; crpExRefMin: number; crpOmega3: number; crpOmega3Crp0: number; crpOmega3Dose: number;
  fCrpWeight: number; fCrpEx: number;
  uaPerBhb: number; uaCap: number; uaAlcohol: number; uaBevMult: number; uaFructose: number; uaFructoseRef: number; uaWeight: number; uaDash: number; uaDashBase: number; uaDashSpan: number;
  fUaUp: number; fUaDown: number; fUaWeight: number; fUaDiet: number;
  // ------------------------------------------------------------------------------------------ interface
  zeroIntakeKcal: number; aerobicMinFrac: number; restMet: number; o2KcalPerL: number; dashQ3: number; paThresholdH: number;
  /** Test mode: assert finiteness of every output each day. */
  checks: boolean;
  /**
   * Display-only marker blocks computed this run (false when none of their series is recorded, e.g. planner mode):
   * lipids (ldl, apoB, hdl, triglycerides), BP (sbp), glycaemia (fastingGlucose), hs-CRP (crp), urate (uricAcid).
   */
  doLipids: boolean;
  doBp: boolean;
  doGlyc: boolean;
  doCrp: boolean;
  doUa: boolean;
}

/**
 * Concrete class of the constants object: every field is declared here so that V8 keeps the instance in fast-property
 * mode (an object literal with more than ~127 properties falls into dictionary mode, ~3× slower reads in the step loop).
 */
class CardiometabolicKImpl implements CardiometabolicK {
  tgN3LnBase = 0;
  vfLdlHab = 0;
  nutLdlHab = 0;
  uaDashHab = 0;
  sexCode = 0;
  bw0 = 0;
  heightM = 0;
  bmi0 = 0;
  fm0Kg = 0;
  ffm0Kg = 0;
  tdee0Kcal = 0;
  ldl0 = 0;
  hdl0 = 0;
  tg0 = 0;
  tg0Mmol = 0;
  sbp0 = 0;
  fpg0 = 0;
  a1c0 = 0;
  crp0 = 0;
  ua0 = 0;
  apoB0 = 0;
  l0 = 0;
  ldlAnchor = 0;
  hdlAnchor = 0;
  tgAnchor = 0;
  sbpAnchor = 0;
  fpgAnchor = 0;
  a1cAnchor = 0;
  apoBAnchor = 0;
  lAnchor = 0;
  outOfDomain: readonly CardiometabolicLab[] = [];
  hab = new Diet();
  chol0Mg = 0;
  cholZ0 = 0;
  alc0G = 0;
  aer0MinWk = 0;
  met0HWk = 0;
  rt0SetsWk = 0;
  eIs0 = 0;
  fmRefPct = 0;
  hepCal = 0;
  hepCalibrated = false;
  liverKetoScenario = 0;
  a1cFpgScenario = 0;
  liverMeasured = false;
  nonHdlAnchor = 0;
  nonHdlMeasured = false;
  glucoseLoweringContext = false;
  glucoseLoweringFromDay = -1;
  tauHepF = 0;
  fHep = 0;
  fMus = 0;
  fSteps = 0;
  fSfa = 0;
  fSugar = 0;
  expHep = 0;
  lfA = 0;
  lfRef = 0;
  ebDefA = 0;
  ebSurA = 0;
  ebScale = 0;
  adipK = 0;
  adipFloor = 0;
  stepsA = 0;
  stepsRef = 0;
  stepsSpan = 0;
  fitSlope = 0;
  fitRef = 0;
  fitMin = 0;
  fitMax = 0;
  exA = 0;
  exKcal = 0;
  exSets = 0;
  exHoldH = 0;
  fExDecayH = 0;
  sfaA = 0;
  sfaRef = 0;
  sfaFatMax = 0;
  sugarA = 0;
  ciLow = 0;
  ciSpan = 0;
  wFast = 0;
  fTcFast = 0;
  fTcSlow = 0;
  ogttAf = 0;
  ogttAs = 0;
  readyThreshold = 0;
  fdnlBase = 0;
  fdnlSlope = 0;
  fdnlEbScale = 0;
  fdnlEbGain = 0;
  fdnlSugarA = 0;
  fdnlSugarB = 0;
  fdnlIrGain = 0;
  fdnlCap = 0;
  ldlSfa = 0;
  ldlMufa = 0;
  ldlPufa = 0;
  ldlProt = 0;
  ldlWtPerKg = 0;
  alcValidityG = 0;
  hdlSfa = 0;
  hdlMufa = 0;
  hdlPufa = 0;
  hdlProt = 0;
  tgSfa = 0;
  tgMufa = 0;
  tgPufa = 0;
  tgProt = 0;
  tgExchangeFatMax = 0;
  mgdlPerMmolChol = 0;
  ldlScale = 0;
  cholKeys = 0;
  cholLdlPerTc = 0;
  cholHdlPerTc = 0;
  cholCapMg = 0;
  cholResp = 0;
  fLdlComp = 0;
  fHdlComp = 0;
  fTgComp = 0;
  fPortfolio = 0;
  fLem = 0;
  fLdlWeight = 0;
  lemEnabled = 0;
  lemA = 0;
  lemB = 0;
  lemBmiRef = 0;
  lemKetoLo = 0;
  lemKetoHi = 0;
  lemEmodSlope = 0;
  lemEmodMax = 0;
  lemResp = 0;
  vfEmaxMg = 0;
  vfD50 = 0;
  vfLdlRef = 0;
  nutPerServing = 0;
  nutPerServingHigh = 0;
  nutServingG = 0;
  nutCap = 0;
  hdlAlcPerG = 0;
  hdlAerobic = 0;
  hdlAerobicRefMin = 0;
  hdlN3PerG = 0;
  hdlWtStable = 0;
  hdlWtActive = 0;
  hdlActiveRate = 0;
  fHdlEx = 0;
  fHdlWeight = 0;
  tgSugarHyper = 0;
  tgSugarExcessRef = 0;
  tgSugarBalanced = 0;
  tgSugarFreeRef = 0;
  tgAlcPerG = 0;
  tgAlcCap = 0;
  tgN3PerG = 0;
  tgN3Threshold = 0;
  tgN3Cap = 0;
  tgN3Scale = 0;
  tgKetoK = 0;
  tgWtLow = 0;
  tgWtHigh = 0;
  tgAcute = 0;
  defThreshold = 0;
  tgExercise = 0;
  tgExRefMetH = 0;
  fTgAcute = 0;
  fTgN3 = 0;
  fTgEx = 0;
  fTgWeight = 0;
  surplusRamp = 0;
  vldlDivisor = 0;
  apobIntercept = 0;
  apobPerNonHdl = 0;
  betaNa = 0;
  naFloorActive = 0;
  naFloorG = 0;
  mNa = 0;
  dashSbp = 0;
  dashNaShrink = 0;
  kPerMmol = 0;
  kCap = 0;
  kZero = 0;
  kHyper = 0;
  kLowNaFactor = 0;
  kNaThresholdG = 0;
  exEndurance = 0;
  exRt = 0;
  exRefMin = 0;
  exRtRefSets = 0;
  bpWeight = 0;
  bpAlcohol = 0;
  bpAlcoholThr = 0;
  bpProtein = 0;
  bpMufa = 0;
  bpOmega3 = 0;
  bpSauna = 0;
  bpSaunaRef = 0;
  bpLeverCap = 0;
  fBpFast = 0;
  fBpSlow = 0;
  fBpAlcohol = 0;
  fBpExercise = 0;
  fBpSauna = 0;
  liverWl = 0;
  liverCr = 0;
  liverEx = 0;
  liverExRef = 0;
  liverExStack = 0;
  liverExStackPct = 0;
  liverAcute = 0;
  fLiverDown = 0;
  fLiverUp = 0;
  fLiverD = 0;
  liverSurplusMinKcal = 0;
  kMixed = 0;
  kSfa = 0;
  kUnsat = 0;
  kN6 = 0;
  kSugar = 0;
  liverMin = 0;
  liverMax = 0;
  fpgWt = 0;
  fpgAcute = 0;
  fFpgAcute = 0;
  fFpgWeight = 0;
  fA1c = 0;
  eagSlope = 0;
  eagIntercept = 0;
  meanGlucoseFactor = 0;
  fpgAcuteRefD = 0;
  glcFasting = 0;
  glcHepExp = 0;
  glcFastClamp = 0;
  crpPerBmi = 0;
  crpThresholdPct = 0;
  crpBelowSlope = 0;
  crpExercise = 0;
  crpExRefMin = 0;
  crpOmega3 = 0;
  crpOmega3Crp0 = 0;
  crpOmega3Dose = 0;
  fCrpWeight = 0;
  fCrpEx = 0;
  uaPerBhb = 0;
  uaCap = 0;
  uaAlcohol = 0;
  uaBevMult = 0;
  uaFructose = 0;
  uaFructoseRef = 0;
  uaWeight = 0;
  uaDash = 0;
  uaDashBase = 0;
  uaDashSpan = 0;
  fUaUp = 0;
  fUaDown = 0;
  fUaWeight = 0;
  fUaDiet = 0;
  zeroIntakeKcal = 0;
  aerobicMinFrac = 0;
  restMet = 0;
  o2KcalPerL = 0;
  dashQ3 = 0;
  paThresholdH = 0;
  checks = false;
  doLipids = true;
  doBp = true;
  doGlyc = true;
  doCrp = true;
  doUa = true;
}

/** Habitual burn-in day per resolved profile and the Cholesky factor of the 06 §4.17 matrix: constant across ensemble draws. */
const HABITUAL_DAYS = new WeakMap<object, DayInput>();
let CHOL_FACTOR: Float64Array | null = null;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
/** Is this series recorded? (test rigs pass an empty `seriesEnabled`: undefined ⇒ recorded) */
const on = (ctx: ModuleContext, id: SeriesId): boolean => ctx.seriesEnabled[SERIES_INDEX[id]] !== 0;
/** Daily decay factor exp(−1/τ) for τ in days. */
const df = (tauD: number): number => (tauD > 0 ? Math.exp(-1 / tauD) : 0);

/**
 * Short parameter id (without the `cardiometabolic.` prefix) → registry index, cached per registry index map: the map is
 * shared by every run (and every ensemble draw) of one module list, so `prepare` does no string building after the first
 * run (MODEL_SPEC §0.3; the per-run prepare cost fell from ≈ 125 to ≈ 8 µs).
 */
const INDEX_CACHE = new WeakMap<ReadonlyMap<string, number>, Map<string, number>>();
function paramGetter(p: ModelParams): (id: string) => number {
  let cache = INDEX_CACHE.get(p.index);
  if (cache === undefined) {
    cache = new Map<string, number>();
    INDEX_CACHE.set(p.index, cache);
  }
  const c = cache;
  const values = p.values;
  return (id: string): number => {
    let i = c.get(id);
    if (i === undefined) {
      i = p.index.get(`cardiometabolic.${id}`);
      if (i === undefined) throw new Error(`unknown parameter "cardiometabolic.${id}"`);
      c.set(id, i);
    }
    return values[i]!;
  };
}

/* ------------------------------------------------------------------------------------------- observed baselines (D7-02) */

/** Measured cardiometabolic baselines the module anchors on. */
export type CardiometabolicLab = 'ldl' | 'hdl' | 'tg' | 'sbp' | 'fpg' | 'a1c' | 'crp' | 'ua' | 'apoB' | 'liverFat';

interface Domain {
  lo: number;
  hi: number;
}

/**
 * Calibration domain per baseline, in the module's units (mg/dL, mmHg, %, mg/L): the engineering truncation bounds of
 * the population generator (06 §2.3), inside which the response equations were set up. They are not clinical cutoffs
 * and never relabel a measurement: a generated prior is truncated to them; a measured value outside them stays exact at
 * t = 0 and its projection is reported as out of domain (D7-02). Liver fat uses the store bounds `liver.min/max`.
 */
export const CARDIOMETABOLIC_DOMAIN: Readonly<Record<Exclude<CardiometabolicLab, 'liverFat'>, Domain>> & { liverFat: Domain } = {
  ldl: { lo: 40, hi: 250 },
  hdl: { lo: 20, hi: 120 },
  tg: { lo: 30, hi: 800 },
  sbp: { lo: 85, hi: 200 },
  fpg: { lo: 65, hi: 240 },
  a1c: { lo: 4.2, hi: 12 },
  crp: { lo: 0.1, hi: 30 },
  ua: { lo: 2, hi: 12 },
  apoB: { lo: 20, hi: 300 },
  // default of the fixed parameters liver.min / liver.max (buildK reads the run's values)
  liverFat: { lo: 0.5, hi: 50 },
};

/** Lab field, factor to the module unit, and the recorded series (absent: no absolute series) of each baseline. */
const LAB_SOURCE: Readonly<Record<CardiometabolicLab, { field: keyof LabBaselines; toModel: number; series?: SeriesId; seriesUnit?: string; seriesRelative?: true }>> = {
  ldl: { field: 'ldlMmolL', toModel: MGDL_PER_MMOLL_CHOL, series: 'ldl', seriesUnit: 'mmol/L' },
  hdl: { field: 'hdlMmolL', toModel: MGDL_PER_MMOLL_CHOL, series: 'hdl', seriesUnit: 'mmol/L' },
  tg: { field: 'tgMmolL', toModel: MGDL_PER_MMOLL_TG, series: 'triglycerides', seriesUnit: 'mmol/L' },
  sbp: { field: 'sbpMmHg', toModel: 1, series: 'sbp', seriesUnit: 'mmHg' },
  fpg: { field: 'fastingGlucoseMmolL', toModel: MGDL_PER_MMOLL_GLC, series: 'fastingGlucose', seriesUnit: 'mmol/L' },
  a1c: { field: 'hba1cPct', toModel: 1 },
  crp: { field: 'crpMgL', toModel: 1, series: 'crp', seriesRelative: true },
  ua: { field: 'urateMgDl', toModel: 1, series: 'uricAcid', seriesRelative: true },
  apoB: { field: 'apoBgL', toModel: 100, series: 'apoB', seriesUnit: 'g/L' },
  liverFat: { field: 'liverFatPct', toModel: 1, series: 'liverFat', seriesUnit: '%' },
};

/**
 * An accepted measured baseline in the module's unit, or undefined when absent or invalid. Non-finite and non-positive
 * values are rejected at this boundary (C6: never NaN onto the bus); the generator then supplies a bounded prior.
 */
function observedModelValue(labs: LabBaselines | undefined, id: CardiometabolicLab): number | undefined {
  const raw = labs?.[LAB_SOURCE[id].field];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return raw * LAB_SOURCE[id].toModel;
}

/**
 * D7-02: the measured baselines a run uses exactly as t = 0 anchors and the per-series status of those outside the
 * calibration domain. `fromDay` is the zero-based daily-sample index (A1-052): daily[0] is the end of day 0 — one day of
 * modelled response, not the observation — so an out-of-domain baseline makes every modelled sample unsupported from
 * index 0, while the exact observation stays in `SimulationResult.initial` / `meta.observedAnchors`.
 * Pure; the core puts the result into `SimulationMeta.observedAnchors` / `outputStatus`.
 */
export function cardiometabolicObservedAnchors(
  labs: LabBaselines | undefined,
  liverDomain: Domain = CARDIOMETABOLIC_DOMAIN.liverFat,
): { anchors: ObservedAnchor[]; outputStatus: Partial<Record<SeriesId, SeriesStatusMeta>>; outOfDomain: CardiometabolicLab[] } {
  const anchors: ObservedAnchor[] = [];
  const outputStatus: Partial<Record<SeriesId, SeriesStatusMeta>> = {};
  const outOfDomain: CardiometabolicLab[] = [];
  for (const id of Object.keys(LAB_SOURCE) as CardiometabolicLab[]) {
    const v = observedModelValue(labs, id);
    if (v === undefined) continue;
    const d = id === 'liverFat' ? liverDomain : CARDIOMETABOLIC_DOMAIN[id];
    const out = v < d.lo || v > d.hi;
    if (out) outOfDomain.push(id);
    const src = LAB_SOURCE[id];
    if (src.series && !src.seriesRelative) anchors.push({ series: src.series, value: v / src.toModel, unit: src.seriesUnit!, outOfDomain: out });
    if (src.series && out) outputStatus[src.series] = { status: 'outOfDomain', reasonCode: 'observedBaselineOutsideCalibration', fromDay: 0 };
  }
  // validity follows the dependencies: ApoB moves with the LDL/TG proxy response; S_I with the glycaemic domain
  for (const [series, deps] of DERIVED_DEPENDENCIES)
    if (!outputStatus[series] && deps.some((d) => outOfDomain.includes(d))) outputStatus[series] = { status: 'outOfDomain', reasonCode: 'dependsOnOutOfDomainBaseline', fromDay: 0 };
  return { anchors, outputStatus, outOfDomain };
}

/**
 * Recorded series whose projection depends on another baseline (apoB moves with the LDL/TG non-HDL proxy; S_I is modelled
 * for the glycaemic range of its calibration — a fasting-glucose baseline outside it puts the insulin-sensitivity
 * projection outside it too, and under the opt-in legacy HOMA scenario S_I also reads that anchor, D7-06).
 */
const DERIVED_DEPENDENCIES: ReadonlyArray<readonly [SeriesId, readonly CardiometabolicLab[]]> = [
  ['apoB', ['ldl', 'tg']],
  ['insulinSensitivity', ['fpg']],
];

/** Generator parameter ids per marker and sex (built once: no template strings per run). */
const GEN_IDS = new Map<string, readonly [string, string, string, string]>();
for (const m of Z_MARKERS) for (const sex of ['m', 'f']) GEN_IDS.set(`${m}.${sex}`, [`base.${m}.${sex}.a`, `base.${m}.${sex}.bAge`, `base.${m}.${sex}.bBmi`, `base.${m}.${sex}.sd`]);
const U_IDS = Z_MARKERS.map((m) => `u.${m}`);

/** Baseline generator (06 §2.3 Table B3) for one marker at z, sex-resolved (average of both sets when unspecified). */
export function generatorValue(get: (id: string) => number, marker: ZMarker, sexCode: number, ageY: number, bmi: number, z: number): number {
  const one = (sex: 'm' | 'f'): number => {
    const ids = GEN_IDS.get(`${marker}.${sex}`)!;
    const a = get(ids[0]);
    const bAge = get(ids[1]);
    const bBmi = get(ids[2]);
    const sd = get(ids[3]);
    return a + (bAge * (ageY - 45)) / 10 + bBmi * (bmi - 27) + sd * z;
  };
  if (sexCode === 0) return one('m');
  if (sexCode === 1) return one('f');
  return 0.5 * (one('m') + one('f'));
}

/** Glucose-lowering classes whose start/stop/dose change segments glycaemic calibration (D7-09). */
export const GLUCOSE_LOWERING_CLASSES: readonly string[] = ['insulin', 'sulfonylurea', 'sglt2', 'glp1', 'metformin'];

/** Whether the current screening names a glucose-lowering drug or type 1 diabetes (an independent current fact). */
function screenedGlucoseLowering(f: NonNullable<ModuleContext['profile']['safety']>['flags'] | undefined): boolean {
  const med = f?.diabetesMedication;
  return f?.type1Diabetes === true || (med !== undefined && med !== 'none' && med !== 'dietOnly');
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A1-063: as-of glucose-lowering medication context of a run (D7-09), from the shared chronology resolver
 * (`medicationChronology`): the class state at the fasting-glucose baseline sample (the run start without a measured one)
 * and the dated changes from that baseline through the horizon. A current screen naming a glucose-lowering drug (or type 1
 * diabetes) is an independent fact: the context holds from day 0 whatever the history says. A future change cannot alter
 * the earlier prefix (it applies from its own day), a change past the horizon cannot affect the run, and a stop before a
 * newer baseline is not current exposure; an ambiguous history stays in context. A run without a start date cannot place
 * dated changes, so any recorded change keeps the conservative whole-run context. No washout duration is assumed.
 */
export function glucoseLoweringChronology(prof: Pick<ModuleContext['profile'], 'safety' | 'input'>, runDays?: number): { fromDay: number | null; reason: 'currentScreening' | 'activeAtBaseline' | 'unknownAtBaseline' | 'changeSinceBaseline' | 'undatedRun' | null } {
  const f = prof.safety?.flags;
  if (screenedGlucoseLowering(f)) return { fromDay: 0, reason: 'currentScreening' };
  const changes: DatedMedicationChange[] = (prof.input.medications ?? []).filter((m) => GLUCOSE_LOWERING_CLASSES.includes(m.medicationClass));
  if (!changes.length) return { fromDay: null, reason: null };
  const runStart = prof.input.startDate;
  if (!runStart || !ISO_DAY.test(runStart)) return { fromDay: 0, reason: 'undatedRun' };
  const meta = prof.input.labMeta?.fastingGlucoseMmolL;
  const measured = prof.input.labs?.fastingGlucoseMmolL !== undefined && meta?.source !== 'generated' && meta?.measuredOn !== undefined && ISO_DAY.test(meta.measuredOn) ? meta.measuredOn : undefined;
  const med = f?.diabetesMedication;
  const screen: MedicationScreen | undefined = med === 'none' || med === 'dietOnly' ? { status: 'none', asOf: runStart } : undefined;
  const c = medicationChronology({ changes, classes: GLUCOSE_LOWERING_CLASSES, runStart, ...(runDays !== undefined ? { runDays } : {}), ...(measured ? { baselineDate: measured } : {}), ...(screen ? { screen } : {}) });
  return { fromDay: c.affectedFromDay, reason: c.reason };
}

/**
 * D7-09: glucose-lowering medication context — a current glucose-lowering drug or type 1 diabetes on the screening, or a
 * dated glucose-lowering class that is active or ambiguous at the baseline or changes during the run (A1-063 chronology,
 * `glucoseLoweringChronology`). Fasting-glucose and HbA1c changes in this context are observations, not attributable
 * responses (no causal credit, no target achievement); no medication coefficient is encoded.
 */
export function glucoseLoweringContext(prof: Pick<ModuleContext['profile'], 'safety' | 'input'>, runDays?: number): boolean {
  return glucoseLoweringChronology(prof, runDays).fromDay !== null;
}

/**
 * Exogenous insulin at a sample date (D7-06, A1-063), one rule for the marker HOMA and the opt-in engine calibration: the
 * as-of chronology of the dated insulin changes (`medicationStateAt`) with the current screen — a future start never applies
 * to an earlier sample, a stop before it ends the course, an ambiguous same-class history or a withheld answer stays
 * unknown. A current affirmative insulin screen with no recorded insulin history is insulin (the screen is the only fact,
 * never cleared by a missing history). No washout duration is assumed.
 */
export function insulinExposureAt(changes: readonly DatedMedicationChange[], date: string, screen?: MedicationScreen): 'yes' | 'no' | 'unknown' {
  const insulin = changes.filter((c) => c.medicationClass === 'insulin');
  if (screen?.status === 'active' && insulin.length === 0) return 'yes';
  const s = medicationStateAt(insulin, ['insulin'], date, screen);
  return s.exposure === 'active' ? 'yes' : s.exposure === 'notActive' ? 'no' : 'unknown';
}

const finiteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * A draw's recorded context as the shared HOMA operator reads it (A1-047), one sanitiser for the marker rules and the
 * engine: only the facts actually recorded, with their declared types (a known illness; hard training; hours since a fast
 * ended; an explicit prolonged-fast protocol; hours into a logged fast). Absent = unknown — never a forced screening — and
 * the stored context is never rewritten.
 */
export function homaSampleContext(raw: unknown): LabSampleContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const out: { -readonly [K in keyof LabSampleContext]?: LabSampleContext[K] } = {};
  if (typeof c.illness === 'boolean') out.illness = c.illness;
  if (typeof c.hardTraining48h === 'boolean') out.hardTraining48h = c.hardTraining48h;
  if (finiteNum(c.afterFastHours) && c.afterFastHours >= 0) out.afterFastHours = c.afterFastHours;
  if (typeof c.prolongedFastProtocol === 'boolean') out.prolongedFastProtocol = c.prolongedFastProtocol;
  if (finiteNum(c.loggedFastHoursAtSample) && c.loggedFastHoursAtSample >= 0) out.loggedFastHoursAtSample = c.loggedFastHoursAtSample;
  return Object.keys(out).length ? out : undefined;
}

/** One lab baseline's provenance as the shared sample contract reads it (absent facts stay unknown). */
export function labSampleOfMeta(m: LabBaselineMeta, exogenousInsulin: boolean): LabSample {
  const context = homaSampleContext(m.sampleContext);
  return {
    date: m.measuredOn ?? '',
    ...(m.sampleId ? { sampleId: m.sampleId } : {}),
    ...(m.sampledAt ? { sampledAt: m.sampledAt } : {}),
    ...(m.fastingHours !== undefined ? { fastingHours: m.fastingHours } : {}),
    ...(m.fastingStatus ? { fastingStatus: m.fastingStatus } : {}),
    ...(m.confirmedPairWith ? { confirmedPairWith: m.confirmedPairWith } : {}),
    ...(context ? { sampleContext: context } : {}),
    ...(exogenousInsulin ? { exogenousInsulin: true } : {}),
  };
}

/** HOMA eligibility of the run's glucose/insulin baselines with the insulin-treatment state of the draw (null: no measured pair). */
export interface EngineHomaEligibility extends HomaEligibility {
  insulin: 'yes' | 'no' | 'unknown';
}

/**
 * D7-06 (A1-034, A1-047, A1-063): HOMA eligibility of the run's glucose and insulin baselines through the same shared
 * operator the marker rules use (`homaEligibility`): the same draw (shared sample id or confirmed pairing, with no
 * conflicting recorded date or instant), both fasting ≥ 8 h, a routine basal context (no known illness or prolonged fast),
 * measured (not generated) and no exogenous insulin at the draw (as-of chronology, `insulinExposureAt`). Null when a
 * baseline is missing or generated.
 */
export function homaPairEligibility(prof: Pick<ModuleContext['profile'], 'safety' | 'input'>): EngineHomaEligibility | null {
  const meta = prof.input.labMeta;
  const g = meta?.fastingGlucoseMmolL;
  const i = meta?.fastingInsulinUuMl;
  if (!g || !i || g.source === 'generated' || i.source === 'generated') return null;
  const f = prof.safety?.flags;
  const asOf = prof.input.startDate && ISO_DAY.test(prof.input.startDate) ? prof.input.startDate : (i.measuredOn ?? '');
  const med = f?.diabetesMedication;
  // the same screen the marker rules read: insulin / type 1 → active; a withheld diabetes or medicines answer → undisclosed
  const withheld = f?.answers?.['insulin'] === 'preferNot' || f?.answers?.['other-medication'] === 'preferNot';
  const screen: MedicationScreen | undefined =
    med === 'insulin' || f?.type1Diabetes === true ? { status: 'active', asOf } : withheld ? { status: 'undisclosed', asOf } : med !== undefined ? { status: 'none', asOf } : undefined;
  const insulin = insulinExposureAt(prof.input.medications ?? [], i.measuredOn ?? asOf, screen);
  const h = homaEligibility(labSampleOfMeta(g, insulin === 'yes'), labSampleOfMeta(i, insulin === 'yes'));
  return { ...h, insulin };
}

/**
 * D7-06: whether the run's glucose and insulin baselines are one eligible routine-basal pair (`homaPairEligibility`):
 * same date alone, unknown fasting, unknown pairing, conflicting occurrence, a known confounder or unknown insulin
 * treatment is not eligible.
 */
export function homaPairEligible(prof: Pick<ModuleContext['profile'], 'safety' | 'input'>): boolean {
  const h = homaPairEligibility(prof);
  return !!h && h.eligible && h.insulin === 'no';
}

export function buildK(ctx: ModuleContext): CardiometabolicK {
  const get = paramGetter(ctx.params);
  const prof = ctx.profile;
  const unspecified = prof.input.sexUnspecified === true;
  const sexCode = unspecified ? 0.5 : prof.sex === 'female' ? 1 : 0;
  const heightM = prof.heightM;
  const bw0 = prof.weightKg;
  const bmi0 = bw0 / (heightM * heightM);

  // ---- person-level correlated draw (06 §4.17); nominal u = 0.5 ⇒ z = 0
  const u = new Float64Array(N_Z);
  for (let i = 0; i < N_Z; i++) u[i] = get(U_IDS[i]!);
  if (CHOL_FACTOR === null) CHOL_FACTOR = cholesky(CORR, N_Z);
  const z = correlatedZ(u, CHOL_FACTOR);
  const zOf = (m: ZMarker): number => z[Z_MARKERS.indexOf(m)]!;
  const gen = (m: ZMarker): number => generatorValue(get, m, sexCode, prof.ageYears, bmi0, zOf(m));

  const labs = prof.labs;
  // D7-02: generated priors are truncated to the calibration domain; an accepted measured value anchors t = 0 exactly
  // (solver-domain copy for the response equations; outside the domain its projection is unavailable, never clamped)
  const liverDomain: Domain = { lo: get('liver.min'), hi: get('liver.max') };
  const outOfDomain: CardiometabolicLab[] = [];
  const base = (id: CardiometabolicLab, prior: () => number, domain: Domain = CARDIOMETABOLIC_DOMAIN[id]): { solver: number; anchor: number } => {
    const obs = observedModelValue(labs, id);
    if (obs === undefined) {
      const v = clamp(prior(), domain.lo, domain.hi);
      return { solver: v, anchor: v };
    }
    // a value marked generated is a prior, not an observation: truncated to the domain like any generated value
    if (prof.input.labMeta?.[LAB_SOURCE[id].field]?.source === 'generated') {
      const v = clamp(obs, domain.lo, domain.hi);
      return { solver: v, anchor: v };
    }
    if (obs < domain.lo || obs > domain.hi) outOfDomain.push(id);
    return { solver: clamp(obs, domain.lo, domain.hi), anchor: obs };
  };
  const ldl = base('ldl', () => gen('ldl'));
  const hdl = base('hdl', () => gen('hdl'));
  const tg = base('tg', () => Math.exp(gen('lnTg')));
  const sbp = base('sbp', () => gen('sbp'));
  const fpg = base('fpg', () => gen('fpg'));
  const a1c = base('a1c', () => gen('a1c'));
  const crp = base('crp', () => Math.exp(gen('lnCrp')));
  const ua = base('ua', () => gen('ua'));
  const ldl0 = ldl.solver;
  const hdl0 = hdl.solver;
  const tg0 = tg.solver;
  const sbp0 = sbp.solver;
  const fpg0 = fpg.solver;
  const a1c0 = a1c.solver;
  // hs-CRP and urate are recorded relative to their baseline: the measured value itself is the reference (kept exact)
  const crp0 = crp.anchor;
  const ua0 = ua.anchor;
  const nonHdl0 = ldl0 + tg0 / get('lipid.vldlDivisor');
  // D7-07: a measured non-HDL (matched panel or the lab's own) is kept exactly; LDL + TG/5 is only a model proxy
  const nonHdlObs = labs?.nonHdlMmolL;
  const nonHdlMeasured = typeof nonHdlObs === 'number' && Number.isFinite(nonHdlObs) && nonHdlObs > 0 && prof.input.labMeta?.nonHdlMmolL?.source !== 'generated';
  const nonHdlAnchor = nonHdlMeasured ? nonHdlObs * MGDL_PER_MMOLL_CHOL : ldl.anchor + tg.anchor / get('lipid.vldlDivisor');
  // ApoB without a lab is a cross-sectional regression prior from non-HDL (the measured one when given), truncated like a
  // generated value; it is a labelled prior, not a posterior conditional on the panel
  const apoB = base('apoB', () => get('apob.intercept') + get('apob.perNonHdl') * (nonHdlMeasured ? clamp(nonHdlAnchor, 20, 500) : nonHdl0));
  const apoB0 = apoB.solver;
  const liver = base('liverFat', () => get('liver.l0A') * Math.exp(get('liver.l0B') * (bmi0 - 22)), liverDomain);
  const l0 = liver.solver;

  // ---- habitual references from the burn-in day (identical to what the loop feeds during burn-in)
  const hab = new Diet();
  let habDay = HABITUAL_DAYS.get(prof);
  if (habDay === undefined) {
    habDay = habitualDay(prof);
    HABITUAL_DAYS.set(prof, habDay);
  }
  readDiet(hab, habDay, get('nuts.servingG'), get('dash.q3Fraction'));
  const chol0Mg = unspecified ? 0.5 * (get('chol.habitualM') + get('chol.habitualF')) : prof.sex === 'female' ? get('chol.habitualF') : get('chol.habitualM');
  const cholZ0 = hab.energyKcal > 0 ? (chol0Mg * 1000) / hab.energyKcal : 0;
  const alc0G = (prof.habits.habitualAlcoholDrinksPerWeek * 14) / 7;
  const sess = prof.habits.sessionsPerWeek;
  const mix = prof.habits.lifingCardioMix;
  const rtMet = get('habit.rtMet');
  const cardioMet = get('habit.cardioMet');
  const sessH = get('habit.sessionMin') / 60;
  const aer0MinWk = sess * mix * get('habit.sessionMin');
  const met0HWk = sess * sessH * (rtMet * (1 - mix) + cardioMet * mix);
  const rtPreset = RT_PRESETS.moderate;
  const rt0SetsWk = sess * (1 - mix) * (rtPreset.setsPerRegionWeek / rtPreset.sessionsPerWeek) * 9;

  // baseline of the acute-exercise factor: habitual sessions each give a pulse E_is (cardio: net kcal/400, resistance: capped 1)
  // that stays for exHoldH + exTauH hours; overlap saturates at 1
  const eCardio = Math.min(1, ((cardioMet - get('exercise.restMet')) * bw0 * sessH) / get('si.exKcal'));
  const ePerSession = mix * eCardio + (1 - mix) * 1;
  const eIs0 = Math.min(1, (sess * ePerSession * (get('si.exHoldH') + get('si.exTauH'))) / 168);

  const fmRefPct = sexCode === 0 ? get('si.fmRefM') : sexCode === 1 ? get('si.fmRefF') : 0.5 * (get('si.fmRefM') + get('si.fmRefF'));

  // ---- hepatic sensitivity (D7-06): the latent prior (hepCal = 1) unless the opt-in legacy scenario applies to an eligible
  // same-draw fasting pair off insulin (S_hep,0 = HOMA_ref / HOMA_user; an unvalidated mapping, never a measurement)
  let hepCal = 1;
  const homaScenario = get('si.homaCalibration') === 1;
  const pairOk = homaScenario && homaPairEligible(prof);
  if (pairOk && labs.fastingGlucoseMmolL !== undefined && labs.fastingInsulinUuMl !== undefined && labs.fastingGlucoseMmolL > 0 && labs.fastingInsulinUuMl > 0) {
    const homaUser = (labs.fastingGlucoseMmolL * labs.fastingInsulinUuMl) / 22.5;
    const target = get('si.homaRef') / homaUser;
    const lf = 1 / (1 + get('si.lfA') * Math.max(0, l0 - get('si.lfRef')));
    const sfa = hab.fatPct < get('si.sfaFatMaxPct') ? 1 - get('si.sfaA') * Math.max(0, hab.sfaTotPct - get('si.sfaRef')) : 1;
    const sug = 1 - get('si.sugarA') * hab.sugarPct;
    hepCal = clamp(target / (lf * sfa * sug), 0.2, 3);
  }

  // ---- BP sigmoids resolved at SBP0
  const sig = sigmoid((sbp0 - get('bp.sigCenter')) / get('bp.sigWidth'));
  const kHyper = get('bp.kHyperMin') + (1 - get('bp.kHyperMin')) * clamp01((sbp0 - get('bp.kHyperSbpLo')) / (get('bp.kHyperSbpHi') - get('bp.kHyperSbpLo')));

  // direct stores into the declared fields (a 250-property literal + Object.assign costs ≈ 3× more per run)
  const K = new CardiometabolicKImpl();
  K.sexCode = sexCode;
  K.bw0 = bw0;
  K.heightM = heightM;
  K.bmi0 = bmi0;
  K.fm0Kg = prof.fm0Kg;
  K.ffm0Kg = prof.ffm0Kg;
  K.tdee0Kcal = prof.tdee0Kcal;
  K.ldl0 = ldl0;
  K.hdl0 = hdl0;
  K.tg0 = tg0;
  K.tg0Mmol = tg0 / MGDL_PER_MMOLL_TG;
  K.sbp0 = sbp0;
  K.fpg0 = fpg0;
  K.a1c0 = a1c0;
  K.crp0 = crp0;
  K.ua0 = ua0;
  K.apoB0 = apoB0;
  K.l0 = l0;
  K.ldlAnchor = ldl.anchor;
  K.hdlAnchor = hdl.anchor;
  K.tgAnchor = tg.anchor;
  K.sbpAnchor = sbp.anchor;
  K.fpgAnchor = fpg.anchor;
  K.a1cAnchor = a1c.anchor;
  K.apoBAnchor = apoB.anchor;
  K.lAnchor = liver.anchor;
  K.outOfDomain = outOfDomain;
  K.hab = hab;
  K.chol0Mg = chol0Mg;
  K.cholZ0 = cholZ0;
  K.alc0G = alc0G;
  K.aer0MinWk = aer0MinWk;
  K.met0HWk = met0HWk;
  K.rt0SetsWk = rt0SetsWk;
  K.eIs0 = eIs0;
  K.fmRefPct = fmRefPct;
  K.hepCal = hepCal;
  K.hepCalibrated = pairOk && (labs.fastingGlucoseMmolL ?? 0) > 0 && (labs.fastingInsulinUuMl ?? 0) > 0;
  K.liverKetoScenario = get('liver.ketoScenario') === 1 ? 1 : 0;
  K.a1cFpgScenario = get('a1c.fpgScenario') === 1 ? 1 : 0;
  K.liverMeasured = observedModelValue(labs, 'liverFat') !== undefined && prof.input.labMeta?.liverFatPct?.source !== 'generated';
  K.nonHdlAnchor = nonHdlAnchor;
  K.nonHdlMeasured = nonHdlMeasured;
  const glc = glucoseLoweringChronology(prof, ctx.nDays);
  K.glucoseLoweringFromDay = glc.fromDay ?? -1;
  K.glucoseLoweringContext = glc.fromDay !== null;
  K.tauHepF = get('si.tauHep');
  K.fHep = df(get('si.tauHep'));
  K.fMus = df(get('si.tauMus'));
  K.fSteps = df(get('si.tauSteps'));
  K.fSfa = df(get('si.tauSfa'));
  K.fSugar = df(get('si.tauSugar'));
  K.expHep = get('si.expHep');
  K.lfA = get('si.lfA');
  K.lfRef = get('si.lfRef');
  K.ebDefA = get('si.ebDefA');
  K.ebSurA = get('si.ebSurA');
  K.ebScale = get('si.ebScale');
  K.adipK = get('si.adipK');
  K.adipFloor = get('si.adipFloor');
  K.stepsA = get('si.stepsA');
  K.stepsRef = get('si.stepsRef');
  K.stepsSpan = get('si.stepsSpan');
  K.fitSlope = get('si.fitSlope');
  K.fitRef = get('si.fitRef');
  K.fitMin = get('si.fitMin');
  K.fitMax = get('si.fitMax');
  K.exA = get('si.exA');
  K.exKcal = get('si.exKcal');
  K.exSets = get('si.exSets');
  K.exHoldH = get('si.exHoldH');
  K.fExDecayH = Math.exp(-1 / get('si.exTauH'));
  K.sfaA = get('si.sfaA');
  K.sfaRef = get('si.sfaRef');
  K.sfaFatMax = get('si.sfaFatMaxPct');
  K.sugarA = get('si.sugarA');
  K.ciLow = get('tc.ciLow');
  K.ciSpan = get('tc.ciSpan');
  K.wFast = get('tc.wFast');
  K.fTcFast = df(get('tc.tauFast'));
  K.fTcSlow = df(get('tc.tauSlow'));
  K.ogttAf = get('tc.ogttAf');
  K.ogttAs = get('tc.ogttAs');
  K.readyThreshold = get('tc.readyThreshold');
  K.fdnlBase = get('fdnl.base');
  K.fdnlSlope = get('fdnl.slope');
  K.fdnlEbScale = get('fdnl.ebScale');
  K.fdnlEbGain = get('fdnl.ebGain');
  K.fdnlSugarA = get('fdnl.sugarA');
  K.fdnlSugarB = get('fdnl.sugarB');
  K.fdnlIrGain = get('fdnl.irGain');
  K.fdnlCap = get('fdnl.cap');
  K.ldlSfa = get('ldl.sfa');
  K.ldlMufa = get('ldl.mufa');
  K.ldlPufa = get('ldl.pufa');
  K.ldlProt = get('ldl.prot');
  K.ldlWtPerKg = get('ldl.wtPerKg');
  K.alcValidityG = get('alc.validityG');
  K.hdlSfa = get('hdl.sfa');
  K.hdlMufa = get('hdl.mufa');
  K.hdlPufa = get('hdl.pufa');
  K.hdlProt = get('hdl.prot');
  K.tgSfa = get('tg.sfa');
  K.tgMufa = get('tg.mufa');
  K.tgPufa = get('tg.pufa');
  K.tgProt = get('tg.prot');
  K.tgExchangeFatMax = get('tg.exchangeFatMaxPct');
  K.mgdlPerMmolChol = get('lipid.mgdlPerMmolChol');
  K.ldlScale = clamp(1 + (get('ldl.baseScale') * (ldl0 - get('ldl.baseRef'))) / get('ldl.baseSpan'), get('ldl.baseMin'), get('ldl.baseMax'));
  K.cholKeys = get('chol.keys');
  K.cholLdlPerTc = get('chol.ldlPerTc');
  K.cholHdlPerTc = get('chol.hdlPerTc');
  K.cholCapMg = get('chol.capMgD');
  K.cholResp = get('chol.mResp');
  K.fLdlComp = df(get('tau.ldlComp'));
  K.fHdlComp = df(get('tau.hdlComp'));
  K.fTgComp = df(get('tau.tgComp'));
  K.fPortfolio = df(get('tau.portfolio'));
  K.fLem = df(get('tau.lem'));
  K.fLdlWeight = df(get('tau.ldlWeight'));
  K.lemEnabled = get('lem.enabled');
  K.lemA = get('lem.a');
  K.lemB = get('lem.b');
  K.lemBmiRef = get('lem.bmiRef');
  K.lemKetoLo = get('lem.ketoLo');
  K.lemKetoHi = get('lem.ketoHi');
  K.lemEmodSlope = get('lem.emodSlope');
  K.lemEmodMax = get('lem.emodMax');
  K.lemResp = get('lem.mResp');
  K.vfEmaxMg = get('vf.emax') * MGDL_PER_MMOLL_CHOL;
  K.vfD50 = get('vf.d50');
  K.vfLdlRef = get('vf.ldlRef');
  K.nutPerServing = get('nuts.perServing');
  K.nutPerServingHigh = get('nuts.perServingHigh');
  K.nutServingG = get('nuts.servingG');
  K.nutCap = get('nuts.capServings');
  K.hdlAlcPerG = get('hdl.alcPer30g') / 30;
  K.hdlAerobic = get('hdl.aerobic');
  K.hdlAerobicRefMin = get('hdl.aerobicRefMin');
  K.hdlN3PerG = get('hdl.n3PerG');
  K.hdlWtStable = get('hdl.wtStable');
  K.hdlWtActive = get('hdl.wtActive');
  K.hdlActiveRate = get('hdl.activeRate');
  K.fHdlEx = df(get('tau.hdlExercise'));
  K.fHdlWeight = df(get('tau.hdlWeight'));
  K.tgSugarHyper = get('tg.sugarHyper');
  K.tgSugarExcessRef = get('tg.sugarExcessRef');
  K.tgSugarBalanced = get('tg.sugarBalanced');
  K.tgSugarFreeRef = get('tg.sugarFreeRef');
  K.tgAlcPerG = get('tg.alcPerG');
  K.tgAlcCap = get('tg.alcCapG');
  K.tgN3PerG = get('tg.n3PerG');
  K.tgN3Threshold = get('tg.n3Threshold');
  K.tgN3Cap = get('tg.n3Cap');
  K.tgN3Scale = Math.pow(tg0 / get('tg.n3Tg0Ref'), get('tg.n3Exp'));
  K.tgKetoK = get('tg.ketoK');
  K.tgWtLow = get('tg.wtBmi25');
  K.tgWtHigh = get('tg.wtBmi30');
  K.tgAcute = get('tg.acute');
  K.defThreshold = get('deficit.threshold');
  K.tgExercise = get('tg.exercise');
  K.tgExRefMetH = get('tg.exerciseRefMetH');
  K.fTgAcute = df(get('tau.tgAcute'));
  K.fTgN3 = df(get('tau.tgOmega3'));
  K.fTgEx = df(get('tau.tgExercise'));
  K.fTgWeight = df(get('tau.tgWeight'));
  K.surplusRamp = get('surplus.rampKcalD');
  K.vldlDivisor = get('lipid.vldlDivisor');
  K.apobIntercept = get('apob.intercept');
  K.apobPerNonHdl = get('apob.perNonHdl');
  K.betaNa = get('bp.naBase') + get('bp.naHyper') * sig;
  K.naFloorActive = sbp0 < get('bp.naFloorSbp') ? 1 : 0;
  K.naFloorG = get('bp.naFloor');
  K.mNa = get('bp.mNa');
  K.dashSbp = get('bp.dashSbpA') + get('bp.dashSbpB') * sig;
  K.dashNaShrink = get('bp.dashNaShrink');
  K.kPerMmol = get('bp.kPerMmol');
  K.kCap = get('bp.kCapMmol');
  K.kZero = get('bp.kZeroMmol');
  K.kHyper = kHyper;
  K.kLowNaFactor = get('bp.kLowNaFactor');
  K.kNaThresholdG = get('bp.kNaThresholdG');
  K.exEndurance = get('bp.exEnduranceA') + get('bp.exEnduranceB') * sig;
  K.exRt = get('bp.exRtA') + get('bp.exRtB') * sig;
  K.exRefMin = get('bp.exRefMin');
  K.exRtRefSets = get('bp.exRtRefSets');
  K.bpWeight = get('bp.weight');
  K.bpAlcohol = get('bp.alcohol');
  K.bpAlcoholThr = get('bp.alcoholThresholdG');
  K.bpProtein = get('bp.protein');
  K.bpMufa = get('bp.mufa');
  K.bpOmega3 = get('bp.omega3');
  K.bpSauna = get('bp.sauna');
  K.bpSaunaRef = get('bp.saunaRefSessions');
  K.bpLeverCap = get('bp.leverCap');
  K.fBpFast = df(get('tau.bpFast'));
  K.fBpSlow = df(get('tau.bpSodium'));
  K.fBpAlcohol = df(get('tau.bpAlcohol'));
  K.fBpExercise = df(get('tau.bpExercise'));
  K.fBpSauna = df(get('tau.bpSauna'));
  K.liverWl = get('liver.wl');
  // D7-08: the sustained independent ketosis term is 0 in the standard projection (model containment, not zero biology)
  K.liverCr = get('liver.ketoScenario') === 1 ? get('liver.cr') : 0;
  K.liverEx = get('liver.ex');
  K.liverExRef = get('liver.exRefMetH');
  K.liverExStack = get('liver.exStack');
  K.liverExStackPct = get('liver.exStackPct');
  K.liverAcute = get('liver.acute');
  K.fLiverDown = df(get('liver.tauDown'));
  K.fLiverUp = df(get('liver.tauUp'));
  K.fLiverD = df(get('liver.tauD'));
  K.liverSurplusMinKcal = get('liver.surplusMinKcal');
  K.kMixed = get('liver.kMixed');
  K.kSfa = get('liver.kSfa');
  K.kUnsat = get('liver.kUnsat');
  K.kN6 = get('liver.kN6');
  K.kSugar = get('liver.kSugar');
  K.liverMin = get('liver.min');
  K.liverMax = get('liver.max');
  K.fpgWt = clamp(get('fpg.wtBase') + (get('fpg.wtSlope') * (fpg0 - 100)) / 53, get('fpg.wtMin'), get('fpg.wtMax'));
  K.fpgAcute = get('fpg.acute');
  K.fFpgAcute = df(get('tau.fpgAcute'));
  K.fFpgWeight = df(get('tau.fpgWeight'));
  K.fA1c = df(get('a1c.tau'));
  K.eagSlope = get('a1c.eagSlope');
  K.eagIntercept = get('a1c.eagIntercept');
  K.meanGlucoseFactor = get('a1c.meanGlucoseFactor');
  K.fpgAcuteRefD = get('fpg.acuteRefD');
  K.glcFasting = get('glc.fasting');
  K.glcHepExp = get('glc.hepExp');
  K.glcFastClamp = get('glc.fastClampMmolL');
  K.crpPerBmi = get('crp.perBmi');
  K.crpThresholdPct = get('crp.thresholdPct');
  K.crpBelowSlope = get('crp.belowSlope');
  K.crpExercise = get('crp.exercise');
  K.crpExRefMin = get('crp.exerciseRefMin');
  K.crpOmega3 = get('crp.omega3');
  K.crpOmega3Crp0 = get('crp.omega3Crp0');
  K.crpOmega3Dose = get('crp.omega3Dose');
  K.fCrpWeight = df(get('tau.crpWeight'));
  K.fCrpEx = df(get('tau.crpExercise'));
  K.uaPerBhb = get('ua.perBhb');
  K.uaCap = get('ua.cap');
  K.uaAlcohol = get('ua.alcohol');
  K.uaBevMult = get('ua.beverageMult');
  K.uaFructose = get('ua.fructose');
  K.uaFructoseRef = get('ua.fructoseRefPct');
  K.uaWeight = get('ua.weight');
  K.uaDash = get('ua.dash');
  K.uaDashBase = get('ua.dashBase');
  K.uaDashSpan = get('ua.dashSpan');
  K.fUaUp = df(get('tau.uaUp'));
  K.fUaDown = df(get('tau.uaDown'));
  K.fUaWeight = df(get('tau.uaWeight'));
  K.fUaDiet = df(get('tau.uaDiet'));
  K.zeroIntakeKcal = get('zeroIntakeKcal');
  K.aerobicMinFrac = get('exercise.aerobicMinFrac');
  K.restMet = get('exercise.restMet');
  K.o2KcalPerL = get('exercise.o2KcalPerL');
  K.dashQ3 = get('dash.q3Fraction');
  K.paThresholdH = get('paThresholdH');
  K.checks = ctx.checks;
  K.doLipids = on(ctx, 'ldl') || on(ctx, 'apoB') || on(ctx, 'hdl') || on(ctx, 'triglycerides');
  K.doBp = on(ctx, 'sbp');
  K.doGlyc = on(ctx, 'fastingGlucose');
  K.doCrp = on(ctx, 'crp');
  K.doUa = on(ctx, 'uricAcid');
  // habitual-intake terms (constant per run)
  K.tgN3LnBase = lnOnePlus(tgOmega3Fraction(hab.omega3G, K));
  K.vfLdlHab = viscousFibreLdl(hab.viscousG, K);
  K.nutLdlHab = nutsLdl(hab.nutServings, K);
  K.uaDashHab = urateDashEffect(hab.dash, K);
  return K;
}

