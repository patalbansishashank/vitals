/**
 * MODULE hormones — leptin, T3/rT3, cortisol, testosterone/SHBG/free T (men), menstrual-disturbance risk (women), IGF-1.
 * Ghrelin/satiety-peptide and GH display states (12 §4.2, §4.7) are not implemented: no consumer, no metric (review m11,
 * accepted by the orchestrator); hunger is the appetite module's HPI.
 * Spec: docs/MODEL_SPEC.md §1.11 · Dossiers: 12 §4.0-4.8 (owner); 08 §4.12 (IGF-1 ODE — single IGF-1 owner);
 * 16 §4.0.1 (sleep multiplier on testosterone); 19 §4.9 (menstrual risk P_LPD); 20 §4.7 (fasting validation).
 * Owned files: src/engine/model/hormones/** only.
 *
 * Hormones are biomarkers and appetite drivers, never RMR drivers (12 ruling; 02 owns adaptive thermogenesis).
 * Daily states follow 12 §4.0's exact first-order rule x ← x* + (x − x*)·e^{−1/τ} in `endOfDay` (Δt = 1 d); every fasting
 * driver is already an hourly signal integrated into the day. IGF-1 is hourly (08 §4.12) in `stepHour`.
 *
 * Baseline contract (MODEL_SPEC §1.11 "Baseline and habitual week", §3.4): the energy-status driver is
 * u = EI_d/T̄ − 1 with T̄ the 7-day trailing mean of `tdeeEstKcalD` (intake day by day, expenditure as its weekly mean),
 * so a habitual exerciser eating a flat habitual intake sits at u ≈ 0 every day instead of alternating deficit/surplus.
 * `endBurnIn` sets every state to its habitual-week equilibrium at u = 0 and latches it as the reference of the relative
 * outputs, so every relative output is exactly 1 at t = 0 (habitual carbohydrate, fat share, sleep and insulin included).
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { decayFactor, relax as relaxI, relax2 as relax2I } from '../../core/math';
import { ZERO_INTAKE_KCAL } from '../../core/defaults';
import type { ModuleContext } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import { MI } from '../../types/metrics';
import { HORMONES_PARAMS } from './params';
import {
  balanceTeeRing,
  carbShortfall as carbShortfallI,
  cortisolEnergyTerm as cortisolEnergyTermI,
  deficitPhi as deficitPhiI,
  energyStatusU as energyStatusUI,
  igfFastingTarget as igfFastingTargetI,
  igfTp as igfTpI,
  leptinAcuteTarget as leptinAcuteTargetI,
  leptinSufficiency as leptinSufficiencyI,
  pLpd as pLpdI,
  rt3Target as rt3TargetI,
  t3fTarget as t3fTargetI,
  vermeulenFreeT as vermeulenFreeTI,
} from './equations';

/*
 * Module-local aliases of the hot-path helpers (MODEL_SPEC §0.3): Vite's SSR transform, which runs the tests and the
 * micro-benchmark, turns every call of an imported binding into a namespace-object property load that blocks inlining;
 * local constants keep the calls direct. No effect on the production bundle.
 */
const relax = relaxI;
const relax2 = relax2I;
const carbShortfall = carbShortfallI;
const cortisolEnergyTerm = cortisolEnergyTermI;
const deficitPhi = deficitPhiI;
const energyStatusU = energyStatusUI;
const igfFastingTarget = igfFastingTargetI;
const igfTp = igfTpI;
const leptinAcuteTarget = leptinAcuteTargetI;
const leptinSufficiency = leptinSufficiencyI;
const pLpd = pLpdI;
const rt3Target = rt3TargetI;
const t3fTarget = t3fTargetI;
const vermeulenFreeT = vermeulenFreeTI;

export { HORMONES_PARAMS } from './params';

/** Days in the IGF-1 protein-intake window (08 §4.12 "P7 = 7-day mean protein g/kg/d on eating days"). */
const P7_DAYS = 7;
/** Days in the expenditure window of the energy-status driver u (MODEL_SPEC §1.11: 7-day trailing mean TDEE estimate). */
const TEE_DAYS = 7;
/** Age of a habitual low-carbohydrate pattern at t = 0 for the cortisol n_LC counter (long-standing habit), d. */
const HABIT_DAYS = 365;

export interface HormonesState {
  // ---- energy-status driver (12 §4.0; MODEL_SPEC §1.11)
  /** Rings of the last 7 days' TDEE estimate and intake, kcal/d, and the write index. */
  teeRing: Float64Array;
  eiRing: Float64Array;
  teeIdx: number;
  /** Energy-status driver of the last day u = EI/T̄ − 1, clamped to [−1, 1]. */
  u: number;
  // ---- leptin (12 §4.1)
  /** Baseline absolute leptin L0, ng/mL (profile lab value when given, else a·FM0^b). */
  l0: number;
  /** Acute energy-status factor A_lep, 1 (1 at baseline). */
  aLep: number;
  /** Carbohydrate-availability factor C_lep, 1 (C_hab at baseline). */
  cLep: number;
  /** Fat-mass leptin L_FM, ng/mL. */
  lFm: number;
  /** Lagged fat-mass leptin L_FM_lag (τ 21 d), ng/mL. */
  lFmLag: number;
  /** Current leptin L = L_FM·A·C/C_ref, ng/mL (L0 at baseline). */
  leptinNgMl: number;
  /** Leptin relative to baseline L/L0, 1. */
  leptinRel: number;
  /** Leptin sufficiency S_L(L_FM), S_L(L), 0..1. */
  suffFm: number;
  suffL: number;
  // ---- thyroid (12 §4.3)
  /** Fast (energy/carbohydrate) T3 component, 1. */
  t3f: number;
  /** Total T3 relative (T3f/T3f_ref)·(L_FM_lag/L0)^0.30, 1. */
  t3Rel: number;
  /** Reverse T3 state and its value relative to baseline, 1. */
  rt3S: number;
  rt3: number;
  // ---- cortisol (12 §4.4)
  /** 24-h mean cortisol state and its value relative to baseline, 1. */
  cortS: number;
  cort: number;
  /** Consecutive deficit days n_def (u < −0.05), d. */
  nDef: number;
  /** Consecutive low-carbohydrate days n_LC (carb < 130 g), d. */
  nLowCarb: number;
  /** Consecutive days out of deficit / with carbohydrate ≥ 130 g (reset counters after ≥ 3), d. */
  nOutDef: number;
  nOutLowCarb: number;
  // ---- testosterone (12 §4.5, men)
  /** Total testosterone relative Tt = (tCore/tCore_ref)·(tComp/tComp_ref) (1 for women / unspecified sex), 1. */
  tt: number;
  /** Leptin-threshold × fasting × obesity × sleep component (τ 2 d down / 7 d up), 1. */
  tCore: number;
  /** Diet-composition component F_fat·F_prot·F_alc (τ 7 d), 1. */
  tComp: number;
  /** SHBG state and its value relative to baseline (τ 7 d), 1. */
  shbgS: number;
  shbg: number;
  /** Free testosterone (Vermeulen), pmol/L. */
  freeTPmolL: number;
  // ---- menstrual-disturbance risk (19 §4.9)
  /** P_LPD per cycle 0..1 (NaN when not applicable: men, unspecified sex, post/peri-menopause, hormonal contraception). */
  reproRisk: number;
  /** Ring of daily % deficit max(0, −100·u), length 84 (recorded days only; pre-simulation days = 0 %). */
  menRing: Float64Array;
  menIdx: number;
  /** Sum of `menRing`, % · d. */
  menSum: number;
  // ---- IGF-1 (08 §4.12)
  /** IGF-1 state (hourly, 08's scale) and its value relative to the habitual level at t = 0, 1. */
  igfS: number;
  igf1Rel: number;
  /** Protein factor igfProt → min(cap, TP(P7)/TP(P_hab)) while eating, 1. */
  igfProt: number;
  /** Protein ring (g/kg/d) and eating-day flags of the last 7 days; P7 mean over eating days, g/kg/d. */
  protRing: Float64Array;
  protEat: Uint8Array;
  protIdx: number;
  p7GPerKg: number;
  /** Protein-factor target min(cap, TP(P7)/TP(P_hab)), updated once per day with P7, 1. */
  igfRatio: number;
  // ---- habitual-week equilibrium at u = 0 (computed on burn-in days) and the references latched at t = 0
  cHab: number;
  t3fHab: number;
  rt3Hab: number;
  cortHab: number;
  /** 1 when the habitual day is below the cortisol carbohydrate knee (n_LC starts as a long-standing habit). */
  lowCarbHab: number;
  tCoreHab: number;
  tCompHab: number;
  shbgHab: number;
  cRef: number;
  t3fRef: number;
  rt3Ref: number;
  cortRef: number;
  tCoreRef: number;
  tCompRef: number;
  shbgRef: number;
  igfRef: number;
  // ---- hourly accumulators (reset at startDay)
  /** Minimum hourly insulinRel of the day (fasting-insulin proxy for SHBG; tracked only when SHBG is computed), 1. */
  insMin: number;
}

/** Constants (prepare-time copy of every parameter plus precomputed decay factors and profile-derived baselines). */
export interface HormonesK {
  // sex / eligibility
  male: boolean;
  lpdEligible: boolean;
  /** Cortisol metric recorded (the cortisol state has no reader; skipped otherwise, MODEL_SPEC §0.3). */
  recCort: boolean;
  /** Display-only states without a metric (rT3, SHBG, free T): computed outside planner mode. */
  extras: boolean;
  /** SHBG and free T computed (men, outside planner mode). */
  shbgOn: boolean;
  /** Fallback expenditure when the bus carries none (hand-built tests), kcal/d. */
  tee0: number;
  // drivers
  uScaleL: number;
  uScaleE: number;
  kneeL: number;
  kneeCort: number;
  kneeT3: number;
  l50: number;
  suffN: number;
  // leptin
  l0: number;
  fm0: number;
  w0: number;
  beta: number;
  aMax: number;
  kOv: number;
  aCap: number;
  protW: number;
  fatW: number;
  leptinCarbCoef: number;
  fLepUp: number;
  fLepDown: number;
  fLag: number;
  suff0: number;
  // T3 / rT3
  t3E: number;
  t3C: number;
  t3S: number;
  t3SScale: number;
  fT3Up: number;
  fT3Down: number;
  t3LeanExp: number;
  rt3Amp: number;
  rt3Thr: number;
  rt3Width: number;
  rt3C: number;
  fRt3Up: number;
  fRt3Down: number;
  // cortisol
  cErAmp: number;
  cErThr: number;
  cErWidth: number;
  cErLin: number;
  cErLinScale: number;
  cDefThr: number;
  cNDefTau: number;
  cLcBase: number;
  cLcAmp: number;
  cNLcTau: number;
  cSleep: number;
  cLean: number;
  fCort: number;
  resetDays: number;
  // testosterone
  tFloor: number;
  tFastAmp: number;
  tFastThr: number;
  tFastWidth: number;
  tObCoef: number;
  tObThr: number;
  fOb0: number;
  tFatAmp: number;
  tFatRef: number;
  tFatWidth: number;
  tProtAmp: number;
  tProtThr: number;
  tProtWidth: number;
  tAlcPerG: number;
  tAlcCap: number;
  fTUp: number;
  fTDown: number;
  fTComp: number;
  shbgExp: number;
  fShbg: number;
  tt0MolL: number;
  shbg0MolL: number;
  albMolL: number;
  kAlb: number;
  kShbg: number;
  /** Baseline free testosterone (Vermeulen at TT0, SHBG0), pmol/L. */
  freeT0PmolL: number;
  // menstrual risk
  lpdMid: number;
  lpdSlope: number;
  lpdLo: number;
  lpdHi: number;
  lpdWindow: number;
  // IGF-1 (hourly factors)
  igfLag: number;
  igfLw: number;
  igfAInf: number;
  fIgfUp: number;
  fIgfDown: number;
  fIgfP: number;
  igfSlope: number;
  igfPRef: number;
  igfTpLo: number;
  igfTpHi: number;
  igfRatioMax: number;
  igfEatH: number;
  /** T_E(hFast) at integer hours 0 … lag + 40·lw (exact; beyond the table T_E = A∞ to double precision). */
  igfTE: Float64Array;
  /** First hour past the table (T_E = A∞ from here), h. */
  igfTabEndH: number;
  pHabGPerKg: number;
  tpHab: number;
}

function sexFlags(ctx: ModuleContext): { male: boolean; female: boolean; unspecified: boolean } {
  const unspecified = ctx.profile.input.sexUnspecified === true;
  return { male: !unspecified && ctx.profile.sex === 'male', female: !unspecified && ctx.profile.sex === 'female', unspecified };
}

/** Hormonal contraception makes the menstrual index uninformative (12 §4.6, 16 §4.5: combined, progestin-only, hormonal IUD). */
function onHormonalContraception(ctx: ModuleContext): boolean {
  const c = ctx.profile.cycle.contraception;
  return c !== undefined && c !== 'none';
}

/** Exact T_E at integer hours since the last meal (hot-path lookup; hoursSinceMealH is integral in the loop). */
function igfTable(lagH: number, lwH: number, aInf: number): Float64Array {
  const n = Math.ceil(lagH + 40 * lwH) + 1;
  const t = new Float64Array(n);
  for (let h = 0; h < n; h++) t[h] = igfFastingTarget(h, lagH, lwH, aInf);
  return t;
}

function prepareHormones(ctx: ModuleContext): HormonesK {
  const p = (name: string): number => param(ctx.params, `hormones.${name}`);
  const day = (tauD: number): number => decayFactor(1, tauD);
  const hr = (tauH: number): number => decayFactor(1, tauH);
  const prof = ctx.profile;
  const sx = sexFlags(ctx);

  // baseline leptin L0 (12 §4.1(a)); unspecified sex averages the male and female forms (MODEL_SPEC §5.1)
  const fm0 = Math.max(0.5, prof.fm0Kg);
  const l0Men = p('leptinAMen') * Math.pow(fm0, p('leptinBMen'));
  let l0Women = p('leptinAWomen') * Math.pow(fm0, p('leptinBWomen'));
  if (prof.menopause === 'post') l0Women *= p('leptinPostMenoMult');
  const l0Model = sx.unspecified ? 0.5 * (l0Men + l0Women) : sx.male ? l0Men : l0Women;
  const labL0 = prof.labs.leptinNgMl;
  const l0 = labL0 !== undefined && labL0 > 0 ? labL0 : l0Model;
  const aMax = sx.unspecified ? 0.5 * (p('leptinAMaxMen') + p('leptinAMaxWomen')) : sx.male ? p('leptinAMaxMen') : p('leptinAMaxWomen');
  const l50 = sx.unspecified
    ? 0.5 * (p('leptinL50MenNgMl') + p('leptinL50WomenNgMl'))
    : sx.male
      ? p('leptinL50MenNgMl')
      : p('leptinL50WomenNgMl');
  const suffN = p('leptinSuffHill');

  const w0 = Math.max(1, prof.fm0Kg + prof.ffm0Kg);
  const bf0 = (100 * prof.fm0Kg) / w0;
  const tObCoef = p('testoObCoef');
  const tObThr = p('testoObThreshPct');
  const pHab = prof.habitualProteinG / w0;
  const igfSlope = p('igfProtSlope');
  const igfPRef = p('igfProtRefGKg');
  const igfTpLo = p('igfTpMin');
  const igfTpHi = p('igfTpMax');
  const labTt = prof.labs.testosteroneNmolL;
  const tt0MolL = (labTt !== undefined && labTt > 0 ? labTt : p('tt0NmolL')) * 1e-9;
  const shbg0MolL = p('shbg0NmolL') * 1e-9;
  const albMolL = p('albuminMolL');
  const kAlb = p('kAlbLMol');
  const kShbg = p('kShbgLMol');
  const igfTE = igfTable(p('igfLagH'), p('igfLwH'), p('igfAInf'));

  return {
    male: sx.male,
    lpdEligible: sx.female && prof.menopause === 'pre' && !onHormonalContraception(ctx),
    // test rigs may pass an empty `seriesEnabled` (undefined entries) → treated as recorded
    recCort: ctx.seriesEnabled[MI.cortisol] !== 0,
    extras: ctx.mode !== 'planner',
    shbgOn: sx.male && ctx.mode !== 'planner',
    tee0: prof.tdee0Kcal > 1 ? prof.tdee0Kcal : 2000,
    uScaleL: p('uScaleLeptin'),
    uScaleE: p('uScaleEnergy'),
    kneeL: p('carbKneeLeptinG'),
    kneeCort: p('carbKneeCortG'),
    kneeT3: p('t3CarbKneeG'),
    l50,
    suffN,
    l0,
    fm0,
    w0,
    beta: p('leptinBeta'),
    aMax,
    kOv: p('leptinKOv'),
    aCap: p('leptinACap'),
    protW: p('leptinSurplusProtW'),
    fatW: p('leptinSurplusFatW'),
    leptinCarbCoef: p('leptinCarbCoef'),
    fLepUp: day(p('leptinTauUpD')),
    fLepDown: day(p('leptinTauDownD')),
    fLag: day(p('leptinLagTauD')),
    suff0: leptinSufficiency(l0, l50, suffN),
    t3E: p('t3EnergyCoef'),
    t3C: p('t3CarbCoef'),
    t3S: p('t3SurplusCoef'),
    t3SScale: p('t3SurplusScale'),
    fT3Up: day(p('t3TauUpD')),
    fT3Down: day(p('t3TauDownD')),
    t3LeanExp: p('t3LeanExp'),
    rt3Amp: p('rt3SevereAmp'),
    rt3Thr: p('rt3SevereThresh'),
    rt3Width: p('rt3SevereWidth'),
    rt3C: p('rt3CarbCoef'),
    fRt3Up: day(p('rt3TauUpD')),
    fRt3Down: day(p('rt3TauDownD')),
    cErAmp: p('cortErAmp'),
    cErThr: p('cortErThresh'),
    cErWidth: p('cortErWidth'),
    cErLin: p('cortErLin'),
    cErLinScale: p('cortErLinScale'),
    cDefThr: p('cortDeficitThresh'),
    cNDefTau: p('cortNDefTauD'),
    cLcBase: p('cortLcBase'),
    cLcAmp: p('cortLcAmp'),
    cNLcTau: p('cortNLcTauD'),
    cSleep: p('cortSleepPerH'),
    cLean: p('cortLeanCoef'),
    fCort: day(p('cortTauD')),
    resetDays: p('counterResetDays'),
    tFloor: p('testoLeptinFloor'),
    tFastAmp: p('testoFastAmp'),
    tFastThr: p('testoFastThresh'),
    tFastWidth: p('testoFastWidth'),
    tObCoef,
    tObThr,
    fOb0: Math.exp(-tObCoef * Math.max(0, bf0 - tObThr)),
    tFatAmp: p('testoFatAmp'),
    tFatRef: p('testoFatRefPct'),
    tFatWidth: p('testoFatWidthPct'),
    tProtAmp: p('testoProtAmp'),
    tProtThr: p('testoProtThreshGKg'),
    tProtWidth: p('testoProtWidthGKg'),
    tAlcPerG: p('testoAlcPerG'),
    tAlcCap: p('testoAlcCapG'),
    fTUp: day(p('testoTauUpD')),
    fTDown: day(p('testoTauDownD')),
    fTComp: day(p('testoCompTauD')),
    shbgExp: p('shbgInsExp'),
    fShbg: day(p('shbgTauD')),
    tt0MolL,
    shbg0MolL,
    albMolL,
    kAlb,
    kShbg,
    freeT0PmolL: 1e12 * vermeulenFreeT(tt0MolL, shbg0MolL, albMolL, kAlb, kShbg),
    lpdMid: p('lpdMidPct'),
    lpdSlope: p('lpdSlope'),
    lpdLo: p('lpdClipLow'),
    lpdHi: p('lpdClipHigh'),
    lpdWindow: Math.max(1, Math.round(p('lpdWindowD'))),
    igfLag: p('igfLagH'),
    igfLw: p('igfLwH'),
    igfAInf: p('igfAInf'),
    fIgfUp: hr(p('igfTauUpH')),
    fIgfDown: hr(p('igfTauDownH')),
    fIgfP: hr(p('igfTauPH')),
    igfSlope,
    igfPRef,
    igfTpLo,
    igfTpHi,
    igfRatioMax: p('igfProtRatioMax'),
    igfEatH: p('igfEatingHFastH'),
    igfTE,
    igfTabEndH: igfTE.length,
    pHabGPerKg: pHab,
    tpHab: igfTp(pHab, igfSlope, igfPRef, igfTpLo, igfTpHi),
  };
}

function initHormones(k: HormonesK, _ctx: ModuleContext, bus: SignalBus): HormonesState {
  const s: HormonesState = {
    teeRing: new Float64Array(TEE_DAYS).fill(k.tee0),
    eiRing: new Float64Array(TEE_DAYS).fill(k.tee0),
    teeIdx: 0,
    u: 0,
    l0: k.l0,
    aLep: 1,
    cLep: 1,
    lFm: k.l0,
    lFmLag: k.l0,
    leptinNgMl: k.l0,
    leptinRel: 1,
    suffFm: k.suff0,
    suffL: k.suff0,
    t3f: 1,
    t3Rel: 1,
    rt3S: 1,
    rt3: 1,
    cortS: 1,
    cort: 1,
    nDef: 0,
    nLowCarb: 0,
    nOutDef: 0,
    nOutLowCarb: 0,
    tt: 1,
    tCore: 1,
    tComp: 1,
    shbgS: 1,
    shbg: 1,
    freeTPmolL: k.male ? k.freeT0PmolL : Number.NaN,
    reproRisk: Number.NaN,
    menRing: new Float64Array(k.lpdWindow),
    menIdx: 0,
    menSum: 0,
    igfS: 1,
    igf1Rel: 1,
    igfProt: 1,
    protRing: new Float64Array(P7_DAYS).fill(k.pHabGPerKg),
    protEat: new Uint8Array(P7_DAYS).fill(1),
    protIdx: 0,
    p7GPerKg: k.pHabGPerKg,
    igfRatio: 1,
    cHab: 1,
    t3fHab: 1,
    rt3Hab: 1,
    cortHab: 1,
    lowCarbHab: 0,
    tCoreHab: 1,
    tCompHab: 1,
    shbgHab: 1,
    cRef: 1,
    t3fRef: 1,
    rt3Ref: 1,
    cortRef: 1,
    tCoreRef: 1,
    tCompRef: 1,
    shbgRef: 1,
    igfRef: 1,
    insMin: Number.POSITIVE_INFINITY,
  };
  if (k.lpdEligible) s.reproRisk = pLpd(0, k.lpdMid, k.lpdSlope, k.lpdLo, k.lpdHi);
  writeSignals(s, k, bus);
  return s;
}

function writeSignals(s: HormonesState, k: HormonesK, bus: SignalBus): void {
  bus.leptinRel = s.leptinRel;
  bus.leptinSuffFM = s.suffFm;
  bus.leptinSuff0 = k.suff0;
  bus.t3Rel = s.t3Rel;
  bus.testosteroneRel = k.male ? s.tt : 1;
  // not applicable → 0 on the bus (no NaN on the bus); the recorded metric is NaN (MODEL_SPEC §6 sex-gated metrics)
  bus.reproRiskFemale = k.lpdEligible ? s.reproRisk : 0;
  bus.igf1Rel = s.igf1Rel;
}

export const hormonesModule = defineModule<HormonesState, HormonesK>({
  id: 'hormones',
  specSection: '§1.11',
  dossiers: '12 §4.0-4.8; 08 §4.12; 16 §4.0.1; 19 §4.9; 20 §4.7',
  params: HORMONES_PARAMS,
  reads: ['tdeeEstKcalD', 'fatMassKg', 'ffmActKg', 'insulinRel', 'hoursSinceMealH', 'testoSleepMult', 'sleepDebtFastH'],
  writes: ['leptinRel', 'leptinSuffFM', 'leptinSuff0', 't3Rel', 'testosteroneRel', 'reproRiskFemale', 'igf1Rel'],
  records: ['leptin', 't3', 'cortisol', 'testosterone', 'menstrualRisk', 'igf1'],
  prepare: prepareHormones,
  init: initHormones,

  /**
   * End of burn-in (§3.4; MODEL_SPEC §1.11 baseline contract): composition resets FM to the profile value, energy
   * calibrates NEAT0. Every state is set to its habitual-week equilibrium at u = 0 (computed on the burn-in days from the
   * habitual carbohydrate, fat share, protein, alcohol, sleep and insulin) and that equilibrium is latched as the
   * reference of the relative outputs: leptin, T3, rT3, cortisol, testosterone, SHBG and IGF-1 are exactly 1 at t = 0.
   */
  endBurnIn(s, k, bus) {
    balanceTeeRing(s.teeRing, s.eiRing);
    s.u = 0;
    // leptin: A*(0) = 1, C at the habitual carbohydrate; L = L0 exactly
    s.aLep = 1;
    s.cLep = s.cHab;
    s.cRef = s.cHab;
    s.lFm = k.l0;
    s.lFmLag = k.l0;
    s.suffFm = k.suff0;
    s.leptinNgMl = k.l0;
    s.leptinRel = 1;
    s.suffL = k.suff0;
    // thyroid
    s.t3f = s.t3fHab;
    s.t3fRef = s.t3fHab;
    s.t3Rel = 1;
    s.rt3S = s.rt3Hab;
    s.rt3Ref = s.rt3Hab;
    s.rt3 = 1;
    // cortisol: no deficit run; a habitual low-carbohydrate pattern is long-standing (n_LC past its 21-d habituation)
    s.nDef = 0;
    s.nOutDef = k.resetDays;
    s.nLowCarb = s.lowCarbHab === 1 ? HABIT_DAYS : 0;
    s.nOutLowCarb = s.lowCarbHab === 1 ? 0 : k.resetDays;
    s.cortS = s.cortHab;
    s.cortRef = s.cortHab;
    s.cort = 1;
    // testosterone, SHBG, free T
    s.tCore = s.tCoreHab;
    s.tCoreRef = s.tCoreHab;
    s.tComp = s.tCompHab;
    s.tCompRef = s.tCompHab;
    s.tt = 1;
    s.shbgS = s.shbgHab;
    s.shbgRef = s.shbgHab;
    s.shbg = 1;
    if (k.male) s.freeTPmolL = k.freeT0PmolL;
    // IGF-1: protein window at the habitual g/kg (composition reset the body); habitual daily cycle latched as 1
    s.protRing.fill(k.pHabGPerKg);
    s.protEat.fill(1);
    s.p7GPerKg = k.pHabGPerKg;
    s.igfRatio = 1;
    s.igfProt = 1;
    s.igfRef = s.igfS > 0 ? s.igfS : 1;
    s.igf1Rel = 1;
    writeSignals(s, k, bus);
  },

  startDay(s, k, bus, day) {
    s.insMin = Number.POSITIVE_INFINITY;
    // 08 §4.12 P7: 7-day mean protein g/kg/d over eating days (today's planned intake included)
    const w = bus.fatMassKg + bus.ffmActKg;
    const i = s.protIdx;
    const eating = day.energyKcal > ZERO_INTAKE_KCAL;
    s.protRing[i] = eating && w > 0 ? day.proteinG / w : 0;
    s.protEat[i] = eating ? 1 : 0;
    s.protIdx = i + 1 === P7_DAYS ? 0 : i + 1;
    let sum = 0;
    let n = 0;
    for (let j = 0; j < P7_DAYS; j++) {
      if (s.protEat[j] === 1) {
        sum += s.protRing[j]!;
        n++;
      }
    }
    if (n > 0) s.p7GPerKg = sum / n;
    const r = igfTp(s.p7GPerKg, k.igfSlope, k.igfPRef, k.igfTpLo, k.igfTpHi) / k.tpHab;
    s.igfRatio = r < k.igfRatioMax ? r : k.igfRatioMax;
  },

  stepHour(s, k, bus) {
    // hourly accumulator for SHBG (fasting-insulin proxy; display-only state)
    if (k.shbgOn) {
      const ins = bus.insulinRel;
      if (ins < s.insMin) s.insMin = ins;
    }
    // IGF-1 (08 §4.12): fasting target after the GH-resistance lag × protein factor; asymmetric hourly relaxation
    // (hot path: table lookup at integral hours — hoursSinceMealH is integral in the loop — and inlined relaxations)
    const hFast = bus.hoursSinceMealH;
    let tE: number;
    if (hFast >= k.igfTabEndH) tE = k.igfAInf;
    else {
      const hi = hFast | 0;
      tE = hi === hFast && hi >= 0 ? k.igfTE[hi]! : igfFastingTarget(hFast, k.igfLag, k.igfLw, k.igfAInf);
    }
    let prot = s.igfProt;
    if (hFast < k.igfEatH) {
      const r = s.igfRatio;
      prot = r + (prot - r) * k.fIgfP;
      s.igfProt = prot;
    }
    const target = tE * prot;
    const x = s.igfS;
    s.igfS = target + (x - target) * (target > x ? k.fIgfUp : k.fIgfDown);
  },

  endOfDay(s, k, bus, day, clock) {
    // ---- drivers (12 §4.0): u against the 7-day mean expenditure (MODEL_SPEC §1.11)
    const ei = day.energyKcal > 0 ? day.energyKcal : 0;
    const tee = bus.tdeeEstKcalD > 1 ? bus.tdeeEstKcalD : k.tee0;
    const u = energyStatusU(s.teeRing, s.eiRing, s.teeIdx, tee, ei);
    s.teeIdx = s.teeIdx + 1 === TEE_DAYS ? 0 : s.teeIdx + 1;
    s.u = u;
    const burnIn = clock.day < 0;
    const carb = day.carbG;
    const phiL = deficitPhi(u, k.uScaleL);
    const phiE = deficitPhi(u, k.uScaleE);
    const dcL = carbShortfall(carb, k.kneeL);
    const dcT3 = carbShortfall(carb, k.kneeT3);
    const dF = bus.sleepDebtFastH > 0 ? bus.sleepDebtFastH : 0;
    const fm = bus.fatMassKg > 0.01 ? bus.fatMassKg : 0.01;
    const ffm = bus.ffmActKg > 1 ? bus.ffmActKg : 1;
    const w = fm + ffm;
    const eating = ei > ZERO_INTAKE_KCAL;
    const fCarb = eating ? (4 * carb) / ei : 0;
    const fProt = eating ? (4 * day.proteinG) / ei : 0;
    const fFat = eating ? (9 * day.fatG) / ei : 0;

    // ---- leptin (12 §4.1); C relative to the habitual C (baseline leptin L0 is measured on the habitual diet)
    const aStar = leptinAcuteTarget(u, phiL, k.aMax, k.kOv, fCarb, fProt, fFat, k.protW, k.fatW, k.aCap);
    s.aLep = relax2(s.aLep, aStar, k.fLepUp, k.fLepDown);
    const cStar = 1 - k.leptinCarbCoef * dcL;
    s.cLep = relax2(s.cLep, cStar, k.fLepUp, k.fLepDown);
    const fmRatio = fm / k.fm0;
    s.lFm = k.l0 * (fmRatio === 1 ? 1 : Math.pow(fmRatio, k.beta));
    s.lFmLag = relax(s.lFmLag, s.lFm, k.fLag);
    s.leptinNgMl = (s.lFm * s.aLep * s.cLep) / s.cRef;
    s.leptinRel = s.leptinNgMl / k.l0;
    s.suffFm = leptinSufficiency(s.lFm, k.l50, k.suffN);
    s.suffL = leptinSufficiency(s.leptinNgMl, k.l50, k.suffN);

    // ---- thyroid (12 §4.3, R-T3)
    s.t3f = relax2(s.t3f, t3fTarget(u, phiE, dcT3, k.t3E, k.t3C, k.t3S, k.t3SScale), k.fT3Up, k.fT3Down);
    const lagRatio = s.lFmLag / k.l0;
    s.t3Rel = (s.t3f / s.t3fRef) * (lagRatio === 1 ? 1 : Math.pow(lagRatio, k.t3LeanExp));
    if (k.extras) {
      s.rt3S = relax2(s.rt3S, rt3Target(u, dcT3, k.rt3Amp, k.rt3Thr, k.rt3Width, k.rt3C), k.fRt3Up, k.fRt3Down);
      s.rt3 = s.rt3S / s.rt3Ref;
    }

    // ---- cortisol (12 §4.4; display only): n_def / n_LC count the current run of deficit / low-carbohydrate days
    // including today (reset after ≥ 3 consecutive days out of the condition); reproduces 12's fit (6-d fast → +65 %).
    const dcT = carbShortfall(carb, k.kneeCort);
    if (k.recCort) {
      if (u < -k.cDefThr) {
        s.nDef += 1;
        s.nOutDef = 0;
      } else if (++s.nOutDef >= k.resetDays) s.nDef = 0;
      if (carb < k.kneeCort) {
        s.nLowCarb += 1;
        s.nOutLowCarb = 0;
      } else if (++s.nOutLowCarb >= k.resetDays) s.nLowCarb = 0;
      const dEr = cortisolEnergyTerm(u, s.nDef, k.cDefThr, k.cErAmp, k.cErThr, k.cErWidth, k.cErLin, k.cErLinScale, k.cNDefTau);
      const dLc = dcT > 0 ? dcT * (k.cLcBase + k.cLcAmp * Math.exp(-s.nLowCarb / k.cNLcTau)) : 0;
      const dLean = k.cLean * (k.suff0 - s.suffFm);
      s.cortS = relax(s.cortS, 1 + dEr + dLc + k.cSleep * dF + dLean, k.fCort);
      s.cort = s.cortS / s.cortRef;
    }

    // ---- testosterone, SHBG, free T (12 §4.5, men; 16 testoSleepMult replaces F_sleep, R-SLEEP)
    let fComp = 1;
    if (k.male) {
      const lepTerm = (k.tFloor + (1 - k.tFloor) * s.suffL) / (k.tFloor + (1 - k.tFloor) * k.suff0);
      const xf = (-u - k.tFastThr) / k.tFastWidth;
      const fastTerm = 1 - k.tFastAmp * (xf < 0 ? 0 : xf > 1 ? 1 : xf);
      const bf = (100 * fm) / w;
      const fOb = bf > k.tObThr ? Math.exp(-k.tObCoef * (bf - k.tObThr)) / k.fOb0 : 1 / k.fOb0;
      s.tCore = relax2(s.tCore, lepTerm * fastTerm * fOb * bus.testoSleepMult, k.fTUp, k.fTDown);
      if (eating) {
        const xFat = (k.tFatRef - 100 * fFat) / k.tFatWidth;
        const fFatF = 1 - k.tFatAmp * (xFat < 0 ? 0 : xFat > 1 ? 1 : xFat);
        const xP = (day.proteinG / w - k.tProtThr) / k.tProtWidth;
        const fProtF = 1 - k.tProtAmp * (xP < 0 ? 0 : xP > 1 ? 1 : xP);
        const alc = day.alcoholG < k.tAlcCap ? day.alcoholG : k.tAlcCap;
        fComp = fFatF * fProtF * (1 - k.tAlcPerG * (alc > 0 ? alc : 0));
        s.tComp = relax(s.tComp, fComp, k.fTComp);
      }
      s.tt = (s.tCore / s.tCoreRef) * (s.tComp / s.tCompRef);
    }
    const insF = Number.isFinite(s.insMin) ? (s.insMin > 0.05 ? s.insMin : 0.05) : 1;
    const shbgStar = k.shbgOn ? Math.pow(insF, -k.shbgExp) : 1;
    if (k.shbgOn) {
      s.shbgS = relax(s.shbgS, shbgStar, k.fShbg);
      s.shbg = s.shbgS / s.shbgRef;
      s.freeTPmolL = 1e12 * vermeulenFreeT(k.tt0MolL * s.tt, k.shbg0MolL * s.shbg, k.albMolL, k.kAlb, k.kShbg);
    }

    // ---- habitual-week equilibrium at u = 0 (burn-in days; latched as the references in endBurnIn)
    if (burnIn) {
      s.cHab = cStar;
      s.t3fHab = 1 - k.t3C * dcT3;
      s.rt3Hab = 1 + k.rt3C * dcT3;
      s.lowCarbHab = carb < k.kneeCort ? 1 : 0;
      s.cortHab = 1 + dcT * k.cLcBase + k.cSleep * dF;
      s.tCoreHab = bus.testoSleepMult;
      if (eating) s.tCompHab = fComp;
      s.shbgHab = shbgStar;
    }

    // ---- IGF-1 relative to the habitual level (08 §4.12 state on its own scale)
    s.igf1Rel = s.igfS / s.igfRef;

    // ---- menstrual-disturbance risk (19 §4.9, R-MENS): mean % deficit (incl. exercise) over the last 84 days
    if (k.lpdEligible) {
      if (!burnIn) {
        const defPct = u < 0 ? -100 * u : 0;
        const i = s.menIdx;
        s.menSum += defPct - s.menRing[i]!;
        s.menRing[i] = defPct;
        s.menIdx = i + 1 === k.lpdWindow ? 0 : i + 1;
        if (s.menSum < 0) s.menSum = 0;
      }
      s.reproRisk = pLpd(s.menSum / k.lpdWindow, k.lpdMid, k.lpdSlope, k.lpdLo, k.lpdHi);
    }

    writeSignals(s, k, bus);
  },

  recordDay(s, k, _bus, out) {
    out[MI.leptin] = s.leptinRel;
    out[MI.t3] = s.t3Rel;
    out[MI.cortisol] = s.cort;
    out[MI.testosterone] = k.male ? s.tt : Number.NaN;
    out[MI.menstrualRisk] = k.lpdEligible ? 100 * s.reproRisk : Number.NaN;
    out[MI.igf1] = s.igf1Rel;
  },
});
