/**
 * MODULE appetite — Hunger Pressure Index (HPI), unmet-appetite effort, plan-survival (adherence) probability,
 * diet fatigue. Outputs only: never changes intake (orchestrator ruling R-INTAKE; ad-libitum drift = future work).
 * Spec: docs/MODEL_SPEC.md §1.12 · Dossiers: 12 §4.9-4.12 (owner); 15 §4.5-4.6 (satiety terms), 16 §4.1 (sleep debt dF
 * feeds D_sleep), 16 §4.5 (luteal drive, mean-zero over the cycle), 10 §4.3 (appetite part of exercise compensation = D_ex), 13 §4.10
 * (keto-induction hook), 21 §4 (behavioural levers → adherence).
 * Owned files: src/engine/model/appetite/** only.
 *
 * Daily states update in `endOfDay` with Δt = 1 d exact exponentials (12 §4.0); `stepHour` only accumulates the day's
 * exercise energy, BHB and tissue mass. Hunger is in kcal-equivalents of unmet appetite (12 §4.9 "effort" construct);
 * hormones are the mechanism, not added on top (the only hormone input is leptin sufficiency in Λ_lean).
 *
 * Baseline contract (MODEL_SPEC §1.12 "Baseline and habitual week", §3.4): every drive term is 0 on the habitual week —
 * satiety references are the habitual diet, D_sleep is relative to the habitual sleep debt, D_ex to the habitual
 * exercise, D_WL to the tissue mass latched at t = 0, and diet fatigue sees u = EI/T̄ − 1 against the 7-day mean
 * expenditure (a habitual exerciser eating a flat intake is not "in deficit" on training days). `endBurnIn` latches these
 * references and clears the burn-in effort, so the HPI is exactly its baseline HPI(0) at t = 0 and adherence is 100 %.
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { decayFactor, relax as relaxI, relax2 as relax2I } from '../../core/math';
import { DEFAULTS } from '../../core/defaults';
import type { ModuleContext } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import { MI } from '../../types/metrics';
import { APPETITE_PARAMS } from './params';
import {
  balanceTeeRing,
  dropoutHazard as dropoutHazardI,
  energyDensitySatiety as energyDensitySatietyI,
  energyStatusU as energyStatusUI,
  exerciseAppetite as exerciseAppetiteI,
  fibreSatiety as fibreSatietyI,
  hungerPressureIndex as hungerPressureIndexI,
  leannessAmplifier as leannessAmplifierI,
  leverHazardMultiplier,
  proteinSatiety as proteinSatietyI,
  satDef as satDefI,
  weightLossDrive as weightLossDriveI,
} from './equations';

/*
 * Module-local aliases of the hot-path helpers (MODEL_SPEC §0.3): Vite's SSR transform, which runs the tests and the
 * micro-benchmark, turns every call of an imported binding into a namespace-object property load that blocks inlining;
 * local constants keep the calls direct. No effect on the production bundle.
 */
const relax = relaxI;
const relax2 = relax2I;
const dropoutHazard = dropoutHazardI;
const energyDensitySatiety = energyDensitySatietyI;
const energyStatusU = energyStatusUI;
const exerciseAppetite = exerciseAppetiteI;
const fibreSatiety = fibreSatietyI;
const hungerPressureIndex = hungerPressureIndexI;
const leannessAmplifier = leannessAmplifierI;
const proteinSatiety = proteinSatietyI;
const satDef = satDefI;
const weightLossDrive = weightLossDriveI;

export { APPETITE_PARAMS } from './params';

/** Days of habitual exercise averaged into ExEE0 at the end of burn-in (the habitual week). */
const EX_BURN_DAYS = 7;
/** Days in the expenditure window of the energy-status driver u (MODEL_SPEC §1.12: 7-day trailing mean TDEE estimate). */
const TEE_DAYS = 7;

export interface AppetiteState {
  /** Defended reference weight W_ref (tissue mass, latched at t = 0), kg (τ_ref 3650 d). */
  wRefKg: number;
  /** Diet fatigue F 0..1 (build τ 45 d in deficit, recover τ 7 d). */
  fatigue: number;
  /** Smoothed unmet appetite ("effort") E_s, kcal-eq/d (τ 1 d). */
  effortS: number;
  /** Ketosis appetite adaptation K_ad 0..1 (τ 10 d up / 3 d down). */
  kAd: number;
  /** 28-day filtered net exercise EE S_ex, kcal/d. */
  sEx: number;
  /** Baseline exercise EE ExEE0 = mean net exercise EE of the last ≤ 7 burn-in days (habitual week), kcal/d. */
  exEE0: number;
  /** Burn-in ring of daily net exercise EE (last 7 habitual days), kcal/d, and the number of filled days. */
  exBurn: Float64Array;
  exBurnN: number;
  /** Rings of the last 7 days' TDEE estimate and intake, kcal/d, write index, and the energy-status driver u. */
  teeRing: Float64Array;
  eiRing: Float64Array;
  teeIdx: number;
  u: number;
  /** Habitual fast sleep debt dF (clamped 0..4 h) latched at t = 0, h. */
  dSleepRefH: number;
  /** Cumulative dropout hazard Σh (recorded days only) and P_surv = exp(−Σh). */
  cumHazard: number;
  pSurv: number;
  /** Meals/day pattern memory for D_meal: days since the meal count changed, previous count. */
  daysSincePatternChange: number;
  prevMealsPerDay: number;
  /** Hunger Pressure Index 0..100. */
  hpi: number;
  /** Unmet appetite after ketosis attenuation and keto-induction symptoms E_k, kcal-eq/d. */
  effortK: number;
  /** Unfiltered unmet appetite E_raw, kcal-eq/d. */
  effortRaw: number;
  /** Drive components of the last day, kcal-eq/d (display / decomposition). */
  dWl: number;
  lambdaLean: number;
  dEx: number;
  dSleep: number;
  dFat: number;
  dMeal: number;
  dLuteal: number;
  /** Satiety-effective intake S, kcal-eq/d. */
  satietyS: number;
  /** Daily mean tissue mass W (weight of D_WL), kg, and the tissue mass at the end of the day, kg. */
  wKg: number;
  wEndKg: number;
  /** Ring of the last L days of lutealWeight s(d) (L = cycle length) and its mean s̄ (the luteal drive is mean-zero). */
  lutRing: Float64Array;
  lutIdx: number;
  lutMean: number;
  /** Hourly accumulators (reset at startDay): exercise EE kcal, BHB mmol/L·h, tissue mass kg·h, hours. */
  exDayKcal: number;
  bhbSum: number;
  tissueSum: number;
  nHours: number;
  /** Σ over the day's hours of the fasting-hunger factor ψ(τ) (07 §4.10 time course), and the day mean ψ̄ (1 when fed). */
  fastPsiSum: number;
  fastPsi: number;
}

export interface AppetiteK {
  eiHab: number;
  w0: number;
  wc: number;
  /** Fallback expenditure when the bus carries none (hand-built tests), kcal/d. */
  tee0: number;
  pRef: number;
  fibreRef: number;
  viscRef: number;
  upfRef: number;
  /** Habitual non-beverage energy density ED_ref (profile value, else 15 §4.6 ED_auto(f_UPF,ref)), kcal/g. */
  edRef: number;
  /** 15 §4.6 ED_auto slope: a day without an energy density is ED_ref + slope·(f_UPF − f_UPF,ref), kcal/g. */
  edSlope: number;
  /** Habitual liquid energy EI_liquid,ref (profile value, else 0 — the habitual day carries no liquid kcal), kcal/d. */
  liquidRef: number;
  dWlSlope: number;
  gainSlope: number;
  gainCap: number;
  fWRef: number;
  lambdaC: number;
  exAMax: number;
  exK: number;
  fSEx: number;
  dSleepPerH: number;
  dSleepCap: number;
  dFatAmp: number;
  fatScale: number;
  fatThresh: number;
  fFatBuild: number;
  fFatRecover: number;
  dMealPer: number;
  mealsRef: number;
  mealTau: number;
  dLuteal: number;
  /** Cycle length L for s̄, d, and the initial s̄ (luteal share of the cycle; 0 when no cycle effects apply). */
  lutWindow: number;
  lutMean0: number;
  liquidDiscount: number;
  hProtCoef: number;
  hProtCap: number;
  hProtFloor: number;
  hFibCoef: number;
  hFibPer: number;
  hFibCap: number;
  vViscous: number;
  hEdEps: number;
  hUpf: number;
  hUpfScale: number;
  satMax: number;
  satScale: number;
  fEffort: number;
  ketoHalf: number;
  ketoAtten: number;
  fKadUp: number;
  fKadDown: number;
  ketoInduction: number;
  hpiMid: number;
  hpiScale: number;
  /** HPI at zero unmet appetite (the baseline index, ≈ 6.5). */
  hpi0: number;
  hazCoef: number;
  hazThr: number;
  hazScale: number;
  /** 21 §4G lever multiplier on the hazard, from `ctx.schedule.adherence` (1 without levers). */
  leverMult: number;
  /** 07 §4.10 Hfast: onset τ0 and width τw, h; the factor is 1 up to the peak τ0 + τw and x·e^(1−x) beyond it. */
  fastOnsetH: number;
  fastWidthH: number;
}

/**
 * Fasting-hunger factor ψ(τ) of the acute-deficit drive (07 §4.10 Hfast time course, normalised to its peak): 1 until the
 * Hfast peak at τ0 + τw hours without intake, then x·e^(1−x) with x = (τ − τ0)/τw (≈ 0.33 at 72 h, ≈ 0.03 at 5 d).
 * τ = hours since the last intake > 50 kcal. Pure; exported for the unit tests.
 */
export function fastHungerFactor(tauH: number, onsetH: number, widthH: number): number {
  const x = (tauH - onsetH) / widthH;
  return x <= 1 ? 1 : x * Math.exp(1 - x);
}

const finiteNonNeg = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x) && x >= 0;

function prepareAppetite(ctx: ModuleContext): AppetiteK {
  const p = (name: string): number => param(ctx.params, `appetite.${name}`);
  const day = (tauD: number): number => decayFactor(1, tauD);
  const prof = ctx.profile;
  const w0 = prof.weightKg;
  const upfRef = prof.habits.upfShare;
  const c = prof.cycle;
  const lutWindow = Math.max(1, Math.round(c.cycleLengthD ?? p('lutealMeanWindowD')));
  const cycling =
    prof.sex === 'female' &&
    prof.input.sexUnspecified !== true &&
    c.tracking &&
    (c.contraception === undefined || c.contraception === 'none') &&
    prof.menopause !== 'post';
  const edSlope = p('edAutoSlope');
  const habEd = prof.habits.habitualEnergyDensityKcalPerG;
  const habLiq = prof.habits.habitualLiquidKcal;
  const lv = ctx.schedule.adherence;
  const hpiMid = p('hpiMidKcal');
  const hpiScale = p('hpiScaleKcal');
  return {
    eiHab: prof.tdee0Kcal,
    w0,
    wc: p('wcFrac') * w0,
    tee0: prof.tdee0Kcal > 1 ? prof.tdee0Kcal : 2000,
    pRef: prof.habitualProteinG,
    fibreRef: prof.habitualFibreG,
    viscRef: DEFAULTS.viscousFibreShare,
    upfRef,
    // 12 §4.9.2 "_ref = the user's baseline diet (if unknown, use the population preset from module 15)"
    edRef: finiteNonNeg(habEd) && habEd > 0 ? habEd : p('edAutoIntercept') + edSlope * upfRef,
    edSlope,
    liquidRef: finiteNonNeg(habLiq) ? habLiq : 0,
    dWlSlope: p('dWlSlope'),
    gainSlope: p('dWlGainSlope'),
    gainCap: p('dWlGainCapKcal'),
    fWRef: day(p('wRefTauD')),
    lambdaC: p('lambdaLeanCoef'),
    exAMax: p('exAppMaxKcal'),
    exK: p('exAppKKcal'),
    fSEx: day(p('sExTauD')),
    dSleepPerH: p('dSleepPerHKcal'),
    dSleepCap: p('dSleepCapH'),
    dFatAmp: p('dFatAmpKcal'),
    fatScale: p('fatigueDeficitScale'),
    fatThresh: p('fatigueDeficitThresh'),
    fFatBuild: day(p('fatigueTauBuildD')),
    fFatRecover: day(p('fatigueTauRecoverD')),
    dMealPer: p('dMealPerMealKcal'),
    mealsRef: p('mealsRef'),
    mealTau: p('mealTauD'),
    dLuteal: p('dLutealKcal'),
    lutWindow,
    // 16 §4.5: luteal days ceil(L/2)+1 … L ⇒ s̄ ≈ floor(L/2)/L; replaced by the observed cycle mean after one cycle
    lutMean0: cycling ? Math.floor(lutWindow / 2) / lutWindow : 0,
    liquidDiscount: p('liquidDiscount'),
    hProtCoef: p('hProtCoef'),
    hProtCap: p('hProtCapRatio'),
    hProtFloor: p('hProtFloorRatio'),
    hFibCoef: p('hFibCoef'),
    hFibPer: p('hFibPerG'),
    hFibCap: p('hFibCap'),
    vViscous: p('vViscous'),
    hEdEps: p('hEdEps'),
    hUpf: p('hUpfKcal'),
    hUpfScale: p('hUpfScale'),
    satMax: p('satDefMaxKcal'),
    satScale: p('satDefScaleKcal'),
    fEffort: day(p('effortTauD')),
    ketoHalf: p('ketoHalfMmolL'),
    ketoAtten: p('ketoAtten'),
    fKadUp: day(p('kAdTauUpD')),
    fKadDown: day(p('kAdTauDownD')),
    ketoInduction: p('ketoInductionKcal'),
    hpiMid,
    hpiScale,
    hpi0: hungerPressureIndex(0, hpiMid, hpiScale),
    hazCoef: p('hazardCoef'),
    hazThr: p('hazardHpiThresh'),
    hazScale: p('hazardHpiScale'),
    fastOnsetH: p('fastHungerOnsetH'),
    fastWidthH: p('fastHungerWidthH'),
    // 21 §4G G10 levers chosen for the whole schedule (undefined = none)
    leverMult: leverHazardMultiplier(
      lv?.selfMonitoring === true ? 1 : 0,
      lv?.mealReplacement === true ? 1 : 0,
      lv?.preMealWater === true ? 1 : 0,
      lv?.flexibleRestraint === true ? 1 : 0,
      p('leverSelfMonitor'), p('leverMealReplacement'), p('leverPreMealWater'), p('leverFlexibleRestraint'), p('leverCap'),
    ),
  };
}

function initAppetite(k: AppetiteK, ctx: ModuleContext, bus: SignalBus): AppetiteState {
  const s: AppetiteState = {
    wRefKg: ctx.profile.weightKg,
    fatigue: 0,
    effortS: 0,
    kAd: 0,
    sEx: 0,
    exEE0: 0,
    exBurn: new Float64Array(EX_BURN_DAYS),
    exBurnN: 0,
    teeRing: new Float64Array(TEE_DAYS).fill(k.tee0),
    eiRing: new Float64Array(TEE_DAYS).fill(k.tee0),
    teeIdx: 0,
    u: 0,
    dSleepRefH: 0,
    cumHazard: 0,
    pSurv: 1,
    daysSincePatternChange: 365,
    prevMealsPerDay: ctx.profile.habits.habitualMealsPerDay,
    hpi: k.hpi0,
    effortK: 0,
    effortRaw: 0,
    dWl: 0,
    lambdaLean: 1,
    dEx: 0,
    dSleep: 0,
    dFat: 0,
    dMeal: 0,
    dLuteal: 0,
    satietyS: k.eiHab,
    wKg: ctx.profile.weightKg,
    wEndKg: ctx.profile.weightKg,
    lutRing: new Float64Array(k.lutWindow).fill(k.lutMean0),
    lutIdx: 0,
    lutMean: k.lutMean0,
    exDayKcal: 0,
    bhbSum: 0,
    tissueSum: 0,
    nHours: 0,
    fastPsiSum: 0,
    fastPsi: 1,
  };
  bus.hungerIdx = s.hpi;
  bus.dietFatigue = 0;
  return s;
}

function latchExerciseBaseline(s: AppetiteState): void {
  const n = s.exBurnN < EX_BURN_DAYS ? s.exBurnN : EX_BURN_DAYS;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s.exBurn[i]!;
  s.exEE0 = n > 0 ? sum / n : 0;
  s.sEx = s.exEE0;
}

/** Clamped fast sleep debt used by D_sleep (12 §4.9.1 clamp(·, 0, 4) on 16's dF, R-SLEEP), h. */
function sleepDebtH(dF: number, cap: number): number {
  return dF > 0 ? (dF < cap ? dF : cap) : 0;
}

export const appetiteModule = defineModule<AppetiteState, AppetiteK>({
  id: 'appetite',
  specSection: '§1.12',
  dossiers: '12 §4.9-4.12; 15 §4.5-4.6; 16 §4.1; 10 §4.3; 21 §4',
  params: APPETITE_PARAMS,
  reads: [
    'tdeeEstKcalD', 'tissueMassKg', 'leptinSuffFM', 'leptinSuff0', 'exEEKcalH', 'sleepDebtFastH', 'bhbMmolL', 'fibreEffG',
    'lutealWeight', 'ketoInduction', 'hoursSinceIntakeH',
  ],
  writes: ['hungerIdx', 'dietFatigue'],
  records: ['hunger', 'adherence'],
  prepare: prepareAppetite,
  init: initAppetite,

  /**
   * End of burn-in (§3.4; MODEL_SPEC §1.12 baseline contract): composition resets the body, energy calibrates NEAT0.
   * Latches ExEE0 (habitual week), the defended weight (tissue mass at t = 0 plus the habitual day's mean-minus-midnight
   * offset, so the day-0 daily mean is not read as a change), the habitual sleep debt and the expenditure window;
   * clears the burn-in effort and fatigue (the habitual diet is the zero of unmet appetite); adherence starts at 1.
   */
  endBurnIn(s, k, bus) {
    latchExerciseBaseline(s);
    balanceTeeRing(s.teeRing, s.eiRing);
    s.u = 0;
    s.wRefKg = bus.tissueMassKg + (s.wKg - s.wEndKg);
    s.wKg = s.wRefKg;
    s.dSleepRefH = sleepDebtH(bus.sleepDebtFastH, k.dSleepCap);
    s.fatigue = 0;
    s.effortS = 0;
    s.effortRaw = 0;
    s.effortK = 0;
    s.dWl = 0;
    s.dEx = 0;
    s.dSleep = 0;
    s.dFat = 0;
    s.lambdaLean = 1;
    s.hpi = k.hpi0;
    s.cumHazard = 0;
    s.pSurv = 1;
    bus.hungerIdx = s.hpi;
    bus.dietFatigue = 0;
  },

  startDay(s) {
    s.exDayKcal = 0;
    s.bhbSum = 0;
    s.tissueSum = 0;
    s.nHours = 0;
    s.fastPsiSum = 0;
  },

  stepHour(s, k, bus) {
    const ex = bus.exEEKcalH;
    s.exDayKcal += ex > 0 ? ex : 0;
    const bhb = bus.bhbMmolL;
    s.bhbSum += bhb > 0 ? bhb : 0;
    s.tissueSum += bus.tissueMassKg;
    s.fastPsiSum += fastHungerFactor(bus.hoursSinceIntakeH, k.fastOnsetH, k.fastWidthH);
    s.nHours++;
  },

  endOfDay(s, k, bus, day, clock) {
    const nh = s.nHours;
    const ei = day.energyKcal > 0 ? day.energyKcal : 0;
    const tee = bus.tdeeEstKcalD > 1 ? bus.tdeeEstKcalD : k.tee0;
    const u = energyStatusU(s.teeRing, s.eiRing, s.teeIdx, tee, ei);
    s.teeIdx = s.teeIdx + 1 === TEE_DAYS ? 0 : s.teeIdx + 1;
    s.u = u;
    const bhbMean = nh > 0 ? s.bhbSum / nh : bus.bhbMmolL;

    // ---- slow states (12 Appendix B step 9: S_ex, F, K_ad, W_ref first)
    if (clock.day < 0) {
      // burn-in on the habitual week (§3.4, review B3): S_ex = ExEE0 = mean habitual exercise EE of the last ≤ 7 days
      s.exBurn[s.exBurnN % EX_BURN_DAYS] = s.exDayKcal;
      s.exBurnN++;
      latchExerciseBaseline(s);
    } else s.sEx = relax(s.sEx, s.exDayKcal, k.fSEx);
    if (u < -k.fatThresh) {
      const fStar = -u / k.fatScale;
      s.fatigue = relax(s.fatigue, fStar < 1 ? fStar : 1, k.fFatBuild);
    } else s.fatigue = relax(s.fatigue, 0, k.fFatRecover);
    s.kAd = relax2(s.kAd, bhbMean >= k.ketoHalf ? 1 : 0, k.fKadUp, k.fKadDown);
    // body weight of the feedback = daily mean tissue mass (fat + active FFM): glycogen, water and gut contents are not
    // weight lost or gained for appetite (MODEL_SPEC §1.12 decision)
    const w = nh > 0 ? s.tissueSum / nh : bus.tissueMassKg;
    s.wKg = w;
    s.wEndKg = bus.tissueMassKg;
    s.wRefKg = relax(s.wRefKg, w, k.fWRef);

    // ---- appetite drive D − EI_hab (12 §4.9.1 with rulings R-COMP, R-SLEEP)
    s.dWl = weightLossDrive(s.wRefKg - w, k.wc, k.dWlSlope, k.gainSlope, k.gainCap);
    s.lambdaLean = leannessAmplifier(bus.leptinSuffFM, bus.leptinSuff0, k.lambdaC);
    s.dEx = exerciseAppetite(s.sEx, k.exAMax, k.exK) - exerciseAppetite(s.exEE0, k.exAMax, k.exK);
    s.dSleep = k.dSleepPerH * (sleepDebtH(bus.sleepDebtFastH, k.dSleepCap) - s.dSleepRefH);
    s.dFat = k.dFatAmp * s.fatigue;
    const meals = day.nMeals;
    if (meals !== s.prevMealsPerDay) {
      s.daysSincePatternChange = 0;
      s.prevMealsPerDay = meals;
    } else s.daysSincePatternChange += 1;
    const missing = k.mealsRef - meals;
    s.dMeal = missing > 0 ? k.dMealPer * missing * Math.exp(-s.daysSincePatternChange / k.mealTau) : 0;
    // luteal drive, mean-zero over the cycle (EI_hab is cycle-averaged; same centring as energy's luteal RMR, review M3)
    const lw = bus.lutealWeight > 0 ? bus.lutealWeight : 0;
    const li = s.lutIdx;
    s.lutMean += (lw - s.lutRing[li]!) / k.lutWindow;
    s.lutRing[li] = lw;
    s.lutIdx = li + 1 === k.lutWindow ? 0 : li + 1;
    s.dLuteal = k.dLuteal * (lw - s.lutMean);

    // ---- satiety-effective intake S (12 §4.9.2; 15 §4.5-4.6); a day without an energy density takes 15 §4.6's ED_auto
    // shift from its UPF share relative to the habitual reference
    const liqEx = day.liquidKcal - k.liquidRef;
    const viscShare = day.fibreG > 0 ? day.viscousFibreG / day.fibreG : k.viscRef;
    const edDay = day.energyDensityKcalPerG > 0 ? day.energyDensityKcalPerG : k.edRef + k.edSlope * (day.upfShare - k.upfRef);
    const sat =
      ei -
      k.liquidDiscount * (liqEx > 0 ? liqEx : 0) +
      proteinSatiety(day.proteinG, k.pRef, k.eiHab, k.hProtCoef, k.hProtCap, k.hProtFloor) +
      fibreSatiety(bus.fibreEffG, k.fibreRef, viscShare, k.viscRef, k.eiHab, k.hFibCoef, k.hFibPer, k.hFibCap, k.vViscous) +
      energyDensitySatiety(edDay, k.edRef, k.eiHab, k.hEdEps) -
      (k.hUpf * (day.upfShare - k.upfRef)) / k.hUpfScale;
    s.satietyS = sat;

    // ---- unmet appetite, ketosis attenuation, HPI (12 §4.9.3). The acute-deficit drive of a zero-intake span follows 07's
    // fasting-hunger time course beyond its peak (ψ̄ = the day's mean factor, 1 on any day with food every < 30 h).
    const psi = nh > 0 ? s.fastPsiSum / nh : 1;
    s.fastPsi = psi;
    s.effortRaw =
      satDef(k.eiHab - sat, k.satMax, k.satScale) * psi + s.dWl * s.lambdaLean + s.dEx + s.dSleep + s.dFat + s.dMeal + s.dLuteal;
    s.effortS = relax(s.effortS, s.effortRaw, k.fEffort);
    const b2 = bhbMean > 0 ? bhbMean * bhbMean : 0;
    const kk = b2 / (b2 + k.ketoHalf * k.ketoHalf);
    const eS = s.effortS;
    const ki = bus.ketoInduction;
    s.effortK = (eS > 0 ? eS * (1 - k.ketoAtten * kk * s.kAd) : eS) + k.ketoInduction * (ki > 0 ? ki : 0);
    s.hpi = hungerPressureIndex(s.effortK, k.hpiMid, k.hpiScale);

    // ---- adherence (12 §4.10a; 21 §4G levers as a multiplicative hazard shift); recorded days only
    if (clock.day >= 0) {
      s.cumHazard += k.leverMult * dropoutHazard(s.hpi, k.hazCoef, k.hazThr, k.hazScale);
      s.pSurv = Math.exp(-s.cumHazard);
    }

    bus.hungerIdx = s.hpi;
    bus.dietFatigue = s.fatigue;
  },

  recordDay(s, _k, _bus, out) {
    out[MI.hunger] = s.hpi;
    out[MI.adherence] = 100 * s.pSurv;
  },
});
