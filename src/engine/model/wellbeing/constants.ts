/**
 * Run constants of the wellbeing module: every ParamDef value is copied into one flat object in `prepare()` together
 * with the profile-derived flags and the precomputed decay factors (MODEL_SPEC §0.3: parameters are read only in prepare).
 */
import { SERIES_INDEX } from '../../types/metrics';
import type { ModuleContext } from '../../types/module';
import { param } from '../../core/paramsRegistry';
import { decayFactor } from '../../core/math';
import { MICRO_NUTRIENTS, N_MICRO } from './microTables';

/** Capacity of every daily ring (windows are clamped to it). */
export const RING_CAP = 32;

export interface WellbeingConstants {
  // ------------------------------------------------------------ recording (MODEL_SPEC §0.3: display-only layers are skipped
  // when their series is not recorded, e.g. planner mode); signals other modules read are always computed
  /** 1 when `micronutrientScore` / `enduranceCapacity` / `moodTier` / `hipBmdChange` is recorded. */
  recMicro: number;
  recEndurance: number;
  recMood: number;
  recBone: number;
  // ------------------------------------------------------------ profile-derived
  /** 1 male, 0 female, 0.5 unspecified (thresholds are blended). */
  sexMix: number;
  /** sexF of 19 §4.2(a): 1 female, `boneSexFMale` male, mean for unspecified. */
  boneSexF: number;
  /** 0 pre, 1 peri, 2 post menopause. */
  menopause: number;
  /** 1 when menstruating (female-like and not postmenopausal). */
  menstruating: number;
  /** 0 omnivore, 1 pescatarian, 2 vegetarian, 3 vegan. */
  animalLevel: number;
  multivitamin: number;
  /** Habitual references for state initialisation. */
  eiHabKcal: number;
  carbHabG: number;
  fatHabG: number;
  fibreHabG: number;
  foodQualityHab: number;

  // ------------------------------------------------------------ energy availability
  eaT0: number;
  eaT1: number;
  eaT2: number;
  fEaS: number;
  winShort: number;
  winLong: number;
  eaFloor: number;
  eaCeil: number;

  // ------------------------------------------------------------ bone turnover
  p1npDrop: number;
  p1npWidth: number;
  ctxRise: number;
  ctxRef: number;
  ctxWidth: number;
  eaRampCap: number;
  srcAtFull: number;
  fB: number;
  lowChoCarbGPerKg: number;
  lowChoDays: number;
  lowChoTrainHWk: number;
  lowChoDP1np: number;
  lowChoDCtx: number;
  fLowChoUp: number;
  fLowChoP1npDecay: number;
  fLowChoCtxDecay: number;

  // ------------------------------------------------------------ BMD
  kHip: number;
  kSpine: number;
  mAgeHigh: number;
  ageStepYears: number;
  rhoRt: number;
  rtPerWeekMin: number;
  mSrcEx: number;
  srcShare: number;
  mCaLow: number;
  caThresholdMg: number;
  fBmdLoss: number;
  fBmdRec: number;

  // ------------------------------------------------------------ strength
  strengthA: number;
  strengthWidth: number;
  strengthCap: number;
  fMeaOn: number;
  fMeaOff: number;
  leanFullM: number;
  leanFullF: number;
  leanZeroM: number;
  leanZeroF: number;
  leanMin: number;

  // ------------------------------------------------------------ endurance
  tteIntercept: number;
  tteSlope: number;
  do2Cost: number;
  /** gI at the reference intensity (constant per run). */
  giRef: number;
  fEcon: number;
  massExp: number;

  // ------------------------------------------------------------ keto-induction
  ketoCarbThr: number;
  ketoTau: number;
  ketoNaMitigation: number;
  ketoNaThrMg: number;

  // ------------------------------------------------------------ mood
  weightWin: number;
  moodPtsEaMid: number;
  moodPtsEaLow: number;
  moodRateAmber: number;
  moodRateRed: number;
  moodPtsRateAmber: number;
  moodPtsRateRed: number;
  moodKetoThr: number;
  moodPtsKeto: number;
  moodSleepDebtH: number;
  moodPtsSleep: number;
  moodBfLeanM: number;
  moodBfLeanF: number;
  moodPtsLean: number;
  moodAmberPts: number;
  moodRedPts: number;
  /** Σ (i − ī)² of the 14-point OLS design (computed for `weightWin`). */
  olsSxx: number;

  // ------------------------------------------------------------ micronutrients
  fMicro: number;
  microRedR: number;
  microAmberR: number;
  microYellowR: number;
  microRedPts: number;
  microAmberPts: number;
  fibreTargetPer1000: number;
  fibreYellowG: number;
  lowCarbG: number;
  lowCarbEnergyFrac: number;
  efaAmberG: number;
  efaRedG: number;
  efaRedDays: number;
  lowFatMealG: number;
  ironRiskKcal: number;
  ironRiskTrainHWk: number;
  ironVegMult: number;
  /**
   * Effective density per 1000 kcal for every nutrient and every (food-quality class × carbohydrate pattern) combination:
   * index (qClass·2 + lowCarb)·N_MICRO + n, qClass 0 = quality 1, 1 = quality 2, 2 = quality 3. Already includes the
   * animal-food pattern of the profile (15 §4.9 tables), which is constant for a run.
   */
  microD: Float64Array;
  /** 1/EAR per nutrient (sex-blended, post-menopausal iron, vegetarian iron ×1.8) and the multivitamin contribution to R = intake/EAR. */
  microInvEar: Float64Array;
  microMvmR: Float64Array;
}

const P = 'wellbeing.';

/** Build the constants object (allocation allowed). */
export function buildConstants(ctx: ModuleContext): WellbeingConstants {
  const pm = ctx.params;
  const g = (name: string): number => param(pm, P + name);
  const gOr = (name: string, fallback: number): number => (pm.index.has(P + name) ? param(pm, P + name) : fallback);
  const pr = ctx.profile;

  const unspecified = pr.input.sexUnspecified === true;
  const sexMix = unspecified ? 0.5 : pr.sex === 'male' ? 1 : 0;
  const boneSexFMale = g('boneSexFMale');
  const boneSexF = sexMix * boneSexFMale + (1 - sexMix) * 1;
  const menopause = pr.menopause === 'post' ? 2 : pr.menopause === 'peri' ? 1 : 0;
  const femaleLike = 1 - sexMix > 0;
  const level = pr.habits.dietAnimalLevel;
  const animalLevel = level === 'vegan' ? 3 : level === 'vegetarian' ? 2 : level === 'pescatarian' ? 1 : 0;

  const winShort = Math.min(RING_CAP, Math.max(1, Math.round(g('eaWindowShortD'))));
  const winLong = Math.min(RING_CAP, Math.max(1, Math.round(g('eaWindowLongD'))));
  const weightWin = Math.min(RING_CAP, Math.max(2, Math.round(g('weightWindowD'))));
  const sxx = (weightWin * (weightWin * weightWin - 1)) / 12;

  // ---- keto-induction: τ_p with the heavy tail mapped from the latent quantile (MODEL_SPEC §8.1)
  const heavyFrac = g('ketoHeavyTailFraction');
  const ketoTau = g('ketoHeavyTailQuantile') > 1 - heavyFrac ? g('ketoTauPHeavy') : g('ketoTauP');

  // ---- endurance: intensity gate at the reference intensity
  const iRef = g('econRefIntensity');
  const gLo = g('econGiLo');
  const gHi = g('econGiHi');
  const giRef = gHi > gLo ? Math.min(1, Math.max(0, (iRef - gLo) / (gHi - gLo))) : iRef >= gHi ? 1 : 0;

  // ---- micronutrient tables → run-constant arrays indexed like MICRO_NUTRIENTS (see the field docs)
  const microD = new Float64Array(6 * N_MICRO);
  const microInvEar = new Float64Array(N_MICRO);
  const microMvmR = new Float64Array(N_MICRO);
  const rda = g('microMvmVitaminRdaMult');
  const mineralFrac = g('microMvmMineralFrac');
  const mvm = pr.habits.multivitamin ? 1 : 0;
  for (let i = 0; i < N_MICRO; i++) {
    const n = MICRO_NUTRIENTS[i]!;
    const q1 = gOr(`micro.${n.key}.q1`, 1);
    const q3 = gOr(`micro.${n.key}.q3`, 1);
    const lowCarbMult = gOr(`micro.${n.key}.lowCarb`, 1);
    const dietMult = animalLevel === 3 ? gOr(`micro.${n.key}.vegan`, 1) : animalLevel === 2 ? gOr(`micro.${n.key}.vegetarian`, 1) : 1;
    const dens = g(`micro.${n.key}.density`) * dietMult;
    for (let qc = 0; qc < 3; qc++) {
      const qm = qc === 0 ? q1 : qc === 2 ? q3 : 1;
      microD[(qc * 2) * N_MICRO + i] = dens * qm;
      // the carbohydrate pattern applies at food quality 1-2 only (quality 3 removes it, 15 §4.9)
      microD[(qc * 2 + 1) * N_MICRO + i] = dens * qm * (qc === 2 ? 1 : lowCarbMult);
    }
    const isIron = n.key === 'iron';
    const earM = g(`micro.${n.key}.earM`);
    // post-menopausal women use the men's iron EAR (RDA 8 mg, 15 §4.9)
    const earF = isIron && menopause === 2 ? earM : g(`micro.${n.key}.earF`);
    let ear = sexMix * earM + (1 - sexMix) * earF;
    if (isIron && animalLevel >= 2) ear *= g('microIronVegMult');
    microInvEar[i] = ear > 0 ? 1 / ear : 0;
    // multivitamin: vitamins 100 % of the RDA (1.2 EAR), Mg/Ca 40 % of the RDA, other minerals 0 (15 §4.9)
    const mvmEar = n.mvm === 'vitamin' ? rda : n.mvm === 'mineral' ? mineralFrac * rda : 0;
    microMvmR[i] = mvm === 1 ? mvmEar : 0;
  }

  const rec = (id: 'micronutrientScore' | 'enduranceCapacity' | 'moodTier' | 'hipBmdChange'): number =>
    ctx.seriesEnabled && ctx.seriesEnabled.length > 0 ? (ctx.seriesEnabled[SERIES_INDEX[id]] === 1 ? 1 : 0) : 1;
  return {
    recMicro: rec('micronutrientScore'),
    recEndurance: rec('enduranceCapacity'),
    recMood: rec('moodTier'),
    recBone: rec('hipBmdChange'),
    sexMix,
    boneSexF,
    menopause,
    menstruating: femaleLike && menopause < 2 ? 1 : 0,
    animalLevel,
    multivitamin: pr.habits.multivitamin ? 1 : 0,
    eiHabKcal: pr.tdee0Kcal,
    carbHabG: pr.habitualCarbG,
    fatHabG: pr.habitualFatG,
    fibreHabG: pr.habitualFibreG,
    foodQualityHab: pr.habits.foodQuality,

    eaT0: g('eaTierT0'),
    eaT1: g('eaTierT1'),
    eaT2: g('eaTierT2'),
    fEaS: decayFactor(1, g('eaTauS')),
    winShort,
    winLong,
    eaFloor: g('eaFloor'),
    eaCeil: g('eaCeil'),

    p1npDrop: g('boneP1npDrop'),
    p1npWidth: g('boneP1npEaWidth'),
    ctxRise: g('boneCtxRise'),
    ctxRef: g('boneCtxEaRef'),
    ctxWidth: g('boneCtxEaWidth'),
    eaRampCap: g('boneEaRampCap'),
    srcAtFull: g('boneSrcFactor'),
    fB: decayFactor(1, g('boneTauB')),
    lowChoCarbGPerKg: g('lowChoCarbGPerKg'),
    lowChoDays: g('lowChoDays'),
    lowChoTrainHWk: g('lowChoTrainHWk'),
    lowChoDP1np: g('lowChoDP1np'),
    lowChoDCtx: g('lowChoDCtx'),
    fLowChoUp: decayFactor(1, g('lowChoTau')),
    fLowChoP1npDecay: decayFactor(1, g('lowChoP1npDecayTau')),
    fLowChoCtxDecay: decayFactor(1, g('lowChoCtxDecayTau')),

    kHip: g('bmdKHip'),
    kSpine: g('bmdKSpine'),
    mAgeHigh: g('bmdMAgeHigh'),
    ageStepYears: g('bmdAgeStepYears'),
    rhoRt: g('bmdRhoRt'),
    rtPerWeekMin: g('bmdRtSessionsPerWeek'),
    mSrcEx: g('bmdMSrc'),
    srcShare: g('bmdSrcShare'),
    mCaLow: g('bmdMCaLow'),
    caThresholdMg: g('bmdCaThresholdMg'),
    fBmdLoss: decayFactor(1, g('bmdTauLoss')),
    fBmdRec: decayFactor(1, g('bmdTauRecovery')),

    strengthA: g('strengthA'),
    strengthWidth: g('strengthEaWidth'),
    strengthCap: g('strengthEaRampCap'),
    fMeaOn: decayFactor(1, g('strengthTauOn')),
    fMeaOff: decayFactor(1, g('strengthTauOff')),
    leanFullM: g('leanGateFullBfM'),
    leanFullF: g('leanGateFullBfF'),
    leanZeroM: g('leanGateZeroBfM'),
    leanZeroF: g('leanGateZeroBfF'),
    leanMin: g('leanGateMin'),

    tteIntercept: g('tteIntercept'),
    tteSlope: g('tteSlope'),
    do2Cost: g('econDo2Cost'),
    giRef,
    fEcon: decayFactor(1, g('econTauRecovery')),
    massExp: g('massExponent'),

    ketoCarbThr: g('ketoCarbThresholdG'),
    ketoTau,
    ketoNaMitigation: g('ketoNaMitigation'),
    ketoNaThrMg: 1000 * g('ketoNaThresholdG'),

    weightWin,
    moodPtsEaMid: g('moodPtsEaMid'),
    moodPtsEaLow: g('moodPtsEaLow'),
    moodRateAmber: g('moodRateAmber'),
    moodRateRed: g('moodRateRed'),
    moodPtsRateAmber: g('moodPtsRateAmber'),
    moodPtsRateRed: g('moodPtsRateRed'),
    moodKetoThr: g('moodKetoThreshold'),
    moodPtsKeto: g('moodPtsKeto'),
    moodSleepDebtH: g('moodSleepDebtH'),
    moodPtsSleep: g('moodPtsSleep'),
    moodBfLeanM: g('moodBfLeanM'),
    moodBfLeanF: g('moodBfLeanF'),
    moodPtsLean: g('moodPtsLean'),
    moodAmberPts: g('moodAmberPts'),
    moodRedPts: g('moodRedPts'),
    olsSxx: sxx,

    fMicro: decayFactor(1, g('microEmaTau')),
    microRedR: g('microRedR'),
    microAmberR: g('microAmberR'),
    microYellowR: g('microYellowR'),
    microRedPts: g('microScoreRedPts'),
    microAmberPts: g('microScoreAmberPts'),
    fibreTargetPer1000: g('microFibreTargetPer1000'),
    fibreYellowG: g('microFibreYellowG'),
    lowCarbG: g('microLowCarbG'),
    lowCarbEnergyFrac: g('microLowCarbEnergyFrac'),
    efaAmberG: g('microEfaAmberG'),
    efaRedG: g('microEfaRedG'),
    efaRedDays: g('microEfaRedDays'),
    lowFatMealG: g('microLowFatMealG'),
    ironRiskKcal: g('microIronRiskKcal'),
    ironRiskTrainHWk: g('microIronRiskTrainHWk'),
    ironVegMult: g('microIronVegMult'),
    microD,
    microInvEar,
    microMvmR,
  };
}
