/**
 * Constants of the muscle module, read once from ModelParams in `prepare()` (MODEL_SPEC §0.3/§0.4).
 * Decay factors that depend only on parameters are precomputed here; factors that depend on slow states (H_r) are
 * refreshed once per day in `endOfDay`.
 */
import { param } from '../../core/paramsRegistry';
import type { ModelParams } from '../../types/params';
import { N_REGIONS } from '../../types/inputs';
import type { EventSink } from '../../types/module';
import { REGION_KEYS } from './params';

const NO_EVENTS: EventSink = { emit: () => {} };

export interface MuscleConstants {
  // 09 §4.1 effective sets
  kRir: number;
  kRirHeavy: number;
  kRirLight: number;
  loadHeavyPct: number;
  loadModeratePct: number;
  loadFullPct: number;
  loadVeryLightPct: number;
  fLoad20: number;
  fLoadVeryLight: number;
  fRest60: number;
  fRest90: number;
  restShortSec: number;
  restFullSec: number;
  fFastHV: number;
  fastHVSets: number;
  fastHVGlycogenRel: number;
  fConc: number;
  // 09 §4.2-4.3
  beta: number;
  vCap: number;
  vRef: number;
  /** G(vRef), denominator of f_V. */
  gRef: number;
  fF1: number;
  fF2: number;
  fF3: number;
  kFS: number;
  /** exp(kFS·2/3) − 1, denominator of f_FS. */
  fsRef: number;
  // 09 §4.4 kernel
  kernelA0: number;
  kernelAH: number;
  kernelTau0: number;
  kernelTauH: number;
  kernelRampH: number;
  kernelSets: number;
  // 09 §4.5
  /** exp(−1/τ_H,up), exp(−1/τ_H,down), exp(−1/τ_sw) (daily). */
  habUpF: number;
  habDownF: number;
  swellA: number;
  swellF: number;
  swellVRef: number;
  // 09 §4.6
  kG: number;
  dFfmiPotM: number;
  dFfmiPotF: number;
  ts0YearRate: number;
  ts0Cap: number;
  tsCap: number;
  /** Y_eff of the habits history buckets (< 1 y, 1-3 y, > 3 y) when no training years are known, y. */
  histYearsLt1: number;
  histYears1to3: number;
  histYearsGt3: number;
  // 09 §4.7
  ageHypStart: number;
  ageHypSlope: number;
  ageHypFloor: number;
  // 09 §4.8
  d0: number;
  rhoMax: number;
  rhoPLow: number;
  rhoPHigh: number;
  bS: number;
  eSat: number;
  rMax: number;
  vRYoung: number;
  vROld: number;
  vRAgeLo: number;
  vRAgeHi: number;
  smFrac: number;
  // 09 §4.10
  vMaintYoung: number;
  vMaint70: number;
  vMaintOld: number;
  vMaintAgeLo: number;
  vMaintAgeMid: number;
  vMaintAgeHi: number;
  detrainOnsetD: number;
  detrainRampD: number;
  tauD: number;
  kMem: number;
  memThreshold: number;
  /** R-DETRAIN: retained share of the long-term trained gains (the floor detraining decays towards), 0..1. */
  detrainFloorFrac: number;
  detrainEventWindowD: number;
  // 09 §4.11
  cFat: number;
  fatFailBoost: number;
  /** exp(−1/τ_fat) with and without failure sets (daily). */
  fatFailF: number;
  fatF: number;
  fatCap: number;
  // 09 §4.14
  strAlpha: number;
  nMaxBase: number;
  nMaxSlope: number;
  hSCoef: number;
  /** exp(hSCoef·vRef/(vRef + 1)) − 1, denominator of h_S. */
  hSRef: number;
  fLoadSMod: number;
  fLoadSLight: number;
  /** exp(−1/τ_N,up), exp(−1/τ_N,off) (daily). */
  nUpF: number;
  nOffF: number;
  n0Frac: number;
  // 09 §4.15-4.16
  /** Region shares w_r (sum 1) and novice responsiveness ρ_reg,r, order TRAINING_REGIONS. */
  w: Float64Array;
  rhoReg: Float64Array;
  uIndividual: number;
  /** 09 §4.8 f_P (per kg body mass, R-RT revised): value at ≤ pLow, lower and plateau anchors (g/kg/d). */
  fP0: number;
  pLow: number;
  pPlateau: number;
  /** 03-derived constants (E_dist, MPS display layer, x_P, anabolic resistance) — a sub-object keeps each object
   *  under V8's 128-property fast-literal limit (dictionary-mode constants cost ~10× per read). */
  p03: Mps03Constants;
  // 15 / 21
  alcProtSlope: number;
  alcProtCap: number;
  alcNoProtSlope: number;
  alcNoProtCap: number;
  alcProtGkg: number;
  alcProtWindowH: number;
  alcWindowH: number;
  crAccretion: number;
  fCwi: number;
  /** 1 when the `mps` series is requested (the MPS display layer is skipped otherwise, MODEL_SPEC §0.3). */
  mpsEnabled: number;
  /** The run's event sink (set in prepare; part of the literal so the object keeps one fast map). */
  events: EventSink;
}

/** 03 §4.4.2/§4.5/§4.7/§4.8/§4.14 constants used by the distribution efficiency and the MPS display layer. */
export interface Mps03Constants {
  // 03 §4.8
  eDistMealPenalty: number;
  eDistWindowPenalty: number;
  eDistMealThresh: number;
  eDistAgeSlope: number;
  eDistMinMealG: number;
  eDistSpacingH: number;
  eDistMealsRef: number;
  eDistWindowRefH: number;
  eDistWindowSpanH: number;
  eDistFloor: number;
  arAgeLo: number;
  arAgeSpan: number;
  // 03 §4.7 MPS layer
  s0: number;
  kMps: number;
  nMps: number;
  kAgeMps: number;
  aFed: number;
  kR: number;
  mR: number;
  /** 1/τ_R (1/h) and exp(−1/τ_R). */
  invTauR: number;
  rDecayF: number;
  aX: number;
  bX: number;
  tauXUntrained: number;
  tauXTrained: number;
  /** exp(−1/τ_on) and exp(−0.5/τ_on) (hourly). */
  xOnF: number;
  xOnHalfF: number;
  xNorm: number;
  fEMpsSlope: number;
  fEMpsProt: number;
  fEMpsFloor: number;
  /** exp(−1/τ_E,MPS) (daily). */
  eMpsF: number;
  xpKnee: number;
  xpSatBase: number;
  xpSatDeficit: number;
  xpSatLean: number;
  xpDeficitCap: number;
  xpMinSpan: number;
  leanBfHigh: number;
  leanBfSpan: number;
  leanFemaleOffset: number;
  arStepsFed: number;
  arStepsThreshold: number;
  arStepsAgeMin: number;
  /** exp(−1/τ_AR,on), exp(−1/τ_AR,off) (daily). */
  arOnF: number;
  arOffF: number;
  arObese: number;
  bxObese: number;
  bmiArLo: number;
  bmiArHi: number;
}

export function readMuscleConstants(p: ModelParams, mpsEnabled: boolean, events: EventSink = NO_EVENTS): MuscleConstants {
  const v = (name: string): number => param(p, `muscle.${name}`);
  const beta = v('beta');
  const vRef = v('vRef');
  const hSCoef = v('hSCoef');
  const kFS = v('kFS');
  const w = new Float64Array(N_REGIONS);
  const rhoReg = new Float64Array(N_REGIONS);
  let wSum = 0;
  for (let r = 0; r < N_REGIONS; r++) {
    w[r] = v(`w${REGION_KEYS[r]}`);
    rhoReg[r] = v(`rhoReg${REGION_KEYS[r]}`);
    wSum += w[r]!;
  }
  for (let r = 0; r < N_REGIONS; r++) w[r] = w[r]! / wSum; // guard: shares always sum to exactly 1
  const tauR = v('tauR');
  const tauXOn = v('tauXOn');
  const p03: Mps03Constants = {
    eDistMealPenalty: v('eDistMealPenalty'),
    eDistWindowPenalty: v('eDistWindowPenalty'),
    eDistMealThresh: v('eDistMealThresh'),
    eDistAgeSlope: v('eDistAgeSlope'),
    eDistMinMealG: v('eDistMinMealG'),
    eDistSpacingH: v('eDistSpacingH'),
    eDistMealsRef: v('eDistMealsRef'),
    eDistWindowRefH: v('eDistWindowRefH'),
    eDistWindowSpanH: v('eDistWindowSpanH'),
    eDistFloor: v('eDistFloor'),
    arAgeLo: v('arAgeLo'),
    arAgeSpan: v('arAgeSpan'),
    s0: v('s0'),
    kMps: v('kMps'),
    nMps: v('nMps'),
    kAgeMps: v('kAgeMps'),
    aFed: v('aFed'),
    kR: v('kR'),
    mR: v('mR'),
    invTauR: 1 / tauR,
    rDecayF: Math.exp(-1 / tauR),
    aX: v('aX'),
    bX: v('bX'),
    tauXUntrained: v('tauXUntrained'),
    tauXTrained: v('tauXTrained'),
    xOnF: Math.exp(-1 / tauXOn),
    xOnHalfF: Math.exp(-0.5 / tauXOn),
    xNorm: v('xNorm'),
    fEMpsSlope: v('fEMpsSlope'),
    fEMpsProt: v('fEMpsProt'),
    fEMpsFloor: v('fEMpsFloor'),
    eMpsF: Math.exp(-1 / v('tauEMps')),
    xpKnee: v('xpKnee'),
    xpSatBase: v('xpSatBase'),
    xpSatDeficit: v('xpSatDeficit'),
    xpSatLean: v('xpSatLean'),
    xpDeficitCap: v('xpDeficitCap'),
    xpMinSpan: v('xpMinSpan'),
    leanBfHigh: v('leanBfHigh'),
    leanBfSpan: v('leanBfSpan'),
    leanFemaleOffset: v('leanFemaleOffset'),
    arStepsFed: v('arStepsFed'),
    arStepsThreshold: v('arStepsThreshold'),
    arStepsAgeMin: v('arStepsAgeMin'),
    arOnF: Math.exp(-1 / v('tauArOn')),
    arOffF: Math.exp(-1 / v('tauArOff')),
    arObese: v('arObese'),
    bxObese: v('bxObese'),
    bmiArLo: v('bmiArLo'),
    bmiArHi: v('bmiArHi'),
  };
  return {
    kRir: v('kRir'),
    kRirHeavy: v('kRirHeavy'),
    kRirLight: v('kRirLight'),
    loadHeavyPct: v('loadHeavyPct'),
    loadModeratePct: v('loadModeratePct'),
    loadFullPct: v('loadFullPct'),
    loadVeryLightPct: v('loadVeryLightPct'),
    fLoad20: v('fLoad20'),
    fLoadVeryLight: v('fLoadVeryLight'),
    fRest60: v('fRest60'),
    fRest90: v('fRest90'),
    restShortSec: v('restShortSec'),
    restFullSec: v('restFullSec'),
    fFastHV: v('fFastHV'),
    fastHVSets: v('fastHVSets'),
    fastHVGlycogenRel: v('fastHVGlycogenRel'),
    fConc: v('fConc'),
    beta,
    vCap: v('vCap'),
    vRef,
    gRef: Math.exp(beta * (Math.sqrt(vRef + 1) - 1)) - 1,
    fF1: v('fF1'),
    fF2: v('fF2'),
    fF3: v('fF3'),
    kFS,
    fsRef: Math.exp((kFS * 2) / 3) - 1,
    kernelA0: v('kernelA0'),
    kernelAH: v('kernelAH'),
    kernelTau0: v('kernelTau0'),
    kernelTauH: v('kernelTauH'),
    kernelRampH: v('kernelRampH'),
    kernelSets: v('kernelSets'),
    habUpF: Math.exp(-1 / v('tauHabUp')),
    habDownF: Math.exp(-1 / v('tauHabDown')),
    swellA: v('swellA'),
    swellF: Math.exp(-1 / v('tauSwell')),
    swellVRef: v('swellVRef'),
    kG: v('kG'),
    dFfmiPotM: v('dFfmiPotM'),
    dFfmiPotF: v('dFfmiPotF'),
    ts0YearRate: v('ts0YearRate'),
    ts0Cap: v('ts0Cap'),
    tsCap: v('tsCap'),
    histYearsLt1: v('histYearsLt1'),
    histYears1to3: v('histYears1to3'),
    histYearsGt3: v('histYearsGt3'),
    ageHypStart: v('ageHypStart'),
    ageHypSlope: v('ageHypSlope'),
    ageHypFloor: v('ageHypFloor'),
    d0: v('d0'),
    rhoMax: v('rhoMax'),
    rhoPLow: v('rhoPLow'),
    rhoPHigh: v('rhoPHigh'),
    bS: v('bS'),
    eSat: v('eSat'),
    rMax: v('rMax'),
    vRYoung: v('vRYoung'),
    vROld: v('vROld'),
    vRAgeLo: v('vRAgeLo'),
    vRAgeHi: v('vRAgeHi'),
    smFrac: v('smFrac'),
    vMaintYoung: v('vMaintYoung'),
    vMaint70: v('vMaint70'),
    vMaintOld: v('vMaintOld'),
    vMaintAgeLo: v('vMaintAgeLo'),
    vMaintAgeMid: v('vMaintAgeMid'),
    vMaintAgeHi: v('vMaintAgeHi'),
    detrainOnsetD: v('detrainOnsetD'),
    detrainRampD: v('detrainRampD'),
    tauD: v('tauD'),
    kMem: v('kMem'),
    memThreshold: v('memThreshold'),
    detrainFloorFrac: v('detrainFloorFrac'),
    detrainEventWindowD: v('detrainEventWindowD'),
    cFat: v('cFat'),
    fatFailBoost: v('fatFailBoost'),
    fatFailF: Math.exp(-1 / v('tauFatFail')),
    fatF: Math.exp(-1 / v('tauFat')),
    fatCap: v('fatCap'),
    strAlpha: v('strAlpha'),
    nMaxBase: v('nMaxBase'),
    nMaxSlope: v('nMaxSlope'),
    hSCoef,
    hSRef: Math.exp((hSCoef * vRef) / (vRef + 1)) - 1,
    fLoadSMod: v('fLoadSMod'),
    fLoadSLight: v('fLoadSLight'),
    nUpF: Math.exp(-1 / v('tauNUp')),
    nOffF: Math.exp(-1 / v('tauNOff')),
    n0Frac: v('n0Frac'),
    w,
    rhoReg,
    uIndividual: v('uIndividual'),
    fP0: v('fP0'),
    pLow: v('pLow'),
    pPlateau: v('pPlateau'),
    p03,
    alcProtSlope: v('alcProtSlope'),
    alcProtCap: v('alcProtCap'),
    alcNoProtSlope: v('alcNoProtSlope'),
    alcNoProtCap: v('alcNoProtCap'),
    alcProtGkg: v('alcProtGkg'),
    alcProtWindowH: v('alcProtWindowH'),
    alcWindowH: v('alcWindowH'),
    crAccretion: v('crAccretion'),
    fCwi: v('fCwi'),
    mpsEnabled: mpsEnabled ? 1 : 0,
    events,
  };
}
