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
import { SERIES_INDEX, type SeriesId } from '../../types/metrics';
import { CORR, MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG, N_Z, Z_MARKERS, cholesky, correlatedZ, type ZMarker } from './baselines';
import { Diet, readDiet } from './diet';
import { lnOnePlus, nutsLdl, tgOmega3Fraction, urateDashEffect, viscousFibreLdl } from './equations';

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
  /** Baseline (t = 0) marker levels: lab value when given, else NHANES generator + correlated z (06 §2.3, §4.17). */
  ldl0: number; // mg/dL
  hdl0: number; // mg/dL
  tg0: number; // mg/dL
  tg0Mmol: number;
  sbp0: number; // mmHg
  fpg0: number; // mg/dL
  a1c0: number; // %
  crp0: number; // mg/L
  ua0: number; // mg/dL
  apoB0: number; // mg/dL
  l0: number; // % intrahepatic triglyceride
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
  /** Lab-anchored hepatic-sensitivity calibration (04 §4.18 moderators): 1 without labs. */
  hepCal: number;
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
  const ldl0 = clamp(labs.ldlMmolL !== undefined ? labs.ldlMmolL * MGDL_PER_MMOLL_CHOL : gen('ldl'), 40, 250);
  const hdl0 = clamp(labs.hdlMmolL !== undefined ? labs.hdlMmolL * MGDL_PER_MMOLL_CHOL : gen('hdl'), 20, 120);
  const tg0 = clamp(labs.tgMmolL !== undefined ? labs.tgMmolL * MGDL_PER_MMOLL_TG : Math.exp(gen('lnTg')), 30, 800);
  const sbp0 = clamp(labs.sbpMmHg !== undefined ? labs.sbpMmHg : gen('sbp'), 85, 200);
  const fpg0 = clamp(labs.fastingGlucoseMmolL !== undefined ? labs.fastingGlucoseMmolL * MGDL_PER_MMOLL_GLC : gen('fpg'), 65, 240);
  const a1c0 = clamp(labs.hba1cPct !== undefined ? labs.hba1cPct : gen('a1c'), 4.2, 12);
  const crp0 = clamp(labs.crpMgL !== undefined ? labs.crpMgL : Math.exp(gen('lnCrp')), 0.1, 30);
  const ua0 = clamp(labs.urateMgDl !== undefined ? labs.urateMgDl : gen('ua'), 2, 12);
  const nonHdl0 = ldl0 + tg0 / get('lipid.vldlDivisor');
  const apoB0 = clamp(labs.apoBgL !== undefined ? labs.apoBgL * 100 : get('apob.intercept') + get('apob.perNonHdl') * nonHdl0, 20, 300);
  const l0 = clamp(labs.liverFatPct !== undefined ? labs.liverFatPct : get('liver.l0A') * Math.exp(get('liver.l0B') * (bmi0 - 22)), get('liver.min'), get('liver.max'));

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

  // ---- hepatic-sensitivity anchor from labs (04 §4.18 moderators): S_hep,0 = HOMA_ref / HOMA_user
  let hepCal = 1;
  if (labs.fastingGlucoseMmolL !== undefined && labs.fastingInsulinUuMl !== undefined && labs.fastingGlucoseMmolL > 0 && labs.fastingInsulinUuMl > 0) {
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
  K.liverCr = get('liver.cr');
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

