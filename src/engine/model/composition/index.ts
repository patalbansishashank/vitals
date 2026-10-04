/**
 * MODULE composition — fat mass and lean tissue (energy partition), protein-deposition plan, regional fat/muscle,
 * VAT and waist (via src/engine/body), post-diet overshoot memory, nitrogen balance.
 * Spec: docs/MODEL_SPEC.md §1.8 (+ docs/MODEL_SPEC_REVIEW.md B2, B3c, M1, M2, M7, M9, M10, M20, m6 and the orchestrator
 * rulings in docs/MODEL_SPEC_DECISIONS.md) · Dossiers: 01 §4.2-4.7 (accounting, Hall convention); 03 §4.4, §4.13, §4.14,
 * §4.19 (non-RT partition in deficit, very-low-intake branch, age drift, SM split); 11 §4.7, §4.12, §4.15 (surplus
 * partition, overshoot); 20 §4.4/§4B.1 (fasting protein loss, via the fasting module); 09 §4.8-4.10 (RT accretion/retention,
 * via the muscle module — R-RT: no RT term lives here); 14 M6-M8 (regional allocation, VAT, circumferences — body
 * library); 16 §4.0.1 (sleep partition shift, via moderators).
 * Owned files: src/engine/model/composition/** only.
 *
 * Energy bookkeeping (§0.2, review B2): stored energy S_h = E_abs − TEE_pre − DNL heat − ketone loss − ρG·ΔG; every
 * change of fat / lean tissue is booked at the effective densities ρ + η for either sign, so each hour
 * `S_h = (ρF + ηF)·ΔFM + (ρL + ηL)·ΔLT` exactly and `depositionCostKcalH = ηF·ΔFM + ηL·ΔLT` is signed.
 *
 * Branch per hour (review M7 ruling): an hour with `fastActive = 1` uses the fasting branch (the fasting module's protein
 * flux is the lean change, fat takes the residual); every other hour uses the day's plan — the fraction branch with the
 * day's p_E (deficit 03 / surplus 11) or the explicit 03 §4.13 very-low-intake lean rate.
 *
 * Decisions on points the spec leaves open (documented in the WP report):
 *  - Deficit size d for 03's pCat is today's planned deficit clamp(−u, 0, 1); the deficit/surplus switch uses EB7 (spec).
 *  - Slow states (FM, LT, SM, regional depots, overshoot memory, counters) are re-anchored to the body estimate at the
 *    end of burn-in (review B3c ruling; 01 §4.11 "slow states F, P fixed from user inputs").
 *  - `leanRateKgD` (written at endOfDay for tomorrow, spec step 7) = today's realised non-fasting lean change.
 *  - When neither `waist` nor `visceralFat` is recorded, `allocateRegional` is skipped and VAT follows the M7 allometry
 *    VAT ∝ FM^K (K = the body module's VAT susceptibility) allocation-free, so `vatKg` stays live for cardiometabolic.
 */
import { defineModule } from '../../core/moduleKit';
import { clamp, wakeRecordHour } from '../../core/math';
import { allocateRegional, circumferencesFor, K_GAIN, K_LOSS } from '../../body';
import type { BodyEstimate, BodyState, RegionalComposition } from '../../body/types';
import { MI } from '../../types/metrics';
import type { ModuleContext } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import type { DayInput } from '../../types/inputs';
import { COMPOSITION_PARAMS } from './params';
import {
  type CompositionConstants,
  ageLeanDriftGD,
  deficitEnergyShare,
  fatFloorWeight,
  jacquetPmSS,
  leannessIndex,
  mFatType,
  overshootLeanRatio,
  pCatDeficit,
  poxDecayFactor,
  poxLeanRateKgD,
  poxRate,
  readConstants,
  surplusEnergyShare,
  surplusLeanRatio,
} from './partition';

/** Day plan regime (MODEL_SPEC §1.8 step 2 b-d); the fasting branch (2a) is chosen per hour. */
export const REGIME_SURPLUS = 0;
export const REGIME_DEFICIT = 1;
export const REGIME_VLI = 2;

/** Numerical guard (not physiology): lean tissue never falls below this fraction of LT0 (only reachable in absurd runs). */
const LT_FLOOR_FRAC = 0.3;
/** Smallest accumulated weight loss (kg) from which Pm_SS is taken from the simulated loss instead of Jacquet's formula. */
const PMSS_MIN_LOSS_KG = 0.25;

export interface CompositionState {
  /** Fat mass FM, kg. */
  fmKg: number;
  /** Lean tissue LT, kg (Hall convention, ρL 1816 kcal/kg incl. h_P = 1.6 g water/g protein). */
  ltKg: number;
  /** LT at t = 0, kg (= FFM0 − (1 + h)·G0/1000, review m6 ruling). */
  lt0Kg: number;
  /** FM at t = 0, kg. */
  fm0Kg: number;
  /** FFM at t = 0, kg (tissue FFM; FFM_act = FFM0 + ΔLT). */
  ffm0Kg: number;
  /** Non-lean, non-labile part of FFM0 (reference glycogen + its water), FFM0 − LT0, kg. */
  otherFfmKg: number;
  /** Fat floor FM_min = 0.02·BW0, kg (review M9). */
  fmMinKg: number;
  /** Skeletal muscle, kg, and its t = 0 value. */
  smKg: number;
  sm0Kg: number;
  /**
   * EB7 = trailing 7-day mean (boxcar, today's plan included) of the planned balance EI − TEE_est, kcal/d (11 §4.15 EB7).
   * A boxcar over exactly one week is constant for any weekly-periodic schedule, so the partition of a weight-stable
   * habitual week (training and rest days) does not oscillate between the deficit and surplus rules (review m20).
   */
  eb7: number;
  /** Ring of the last `eb7WindowD` daily balances, kcal/d, and the next write index. */
  eb7Ring: Float64Array;
  eb7Idx: number;
  /** Today's energy balance fraction u = (EI − TEE_est)/TEE_est, clamped to [−1, 1]. */
  u: number;
  /** Today's plan regime (REGIME_*), used in every non-fasting hour. */
  regime: number;
  /**
   * Today's energy share of S′ going to lean tissue (fraction regimes), 0..0.9: the deficit (03) and surplus (11) shares
   * blended linearly over |EB7| < partBlendKcalD (review m20).
   */
  pE: number;
  /** Deficit (03) and surplus (11) energy shares of today, before the blend (diagnostics). */
  pDef: number;
  pSur: number;
  /** Today's catabolic lean mass fraction (deficit regime, diagnostics) and surplus lean ratio r_L, kg/kg. */
  pCat: number;
  rL: number;
  /** Explicit lean terms for today: RT accretion (09) + age drift (03 §4.14), kg LT/d; the RT part alone, kg LT/d. */
  leanExtraKgD: number;
  rtAccKgD: number;
  /** Very-low-intake branch lean rate (03 §4.13), kg LT/d (≤ 0 usually; 0 outside the branch), non-fasting hours only. */
  vliLeanKgD: number;
  /** Explicit hourly lean change in non-fasting hours ((leanExtra + VLI)/24) and in fasting hours (leanExtra/24), kg/h. */
  explicitKgH: number;
  explicitFastKgH: number;
  /** Days spent in the very-low-intake branch (t_f) and the Pox transient factor exp(−t_f/τ_N,eff). */
  vliDays: number;
  poxDecay: number;
  /** Regional fat depots and skeletal muscle (body library), kg. */
  regional: RegionalComposition;
  /** Visceral adipose tissue, kg; waist, cm. */
  vatKg: number;
  waistCm: number;
  /** Simulated body state handed to `circumferencesFor` (fields refreshed daily; plain data). */
  body: BodyState;
  /** Overshoot memory (11 §4.12): 1 while a deficit phase is running / while the memory is valid. */
  osInDeficit: number;
  osValid: number;
  /** FM, FFM_act, weight and %fat at the start of the last deficit phase. */
  fmPreKg: number;
  ffmPreKg: number;
  wPreKg: number;
  pctFatPre: number;
  /** Mass fraction of the deficit-phase loss that was FFM (accumulated Pm_SS). */
  pmSS: number;
  /** Day index at which the last deficit phase ended (−1 while none has ended). */
  deficitEndDay: number;
  /** Fractional fat depletion D_F = (FM_pre − FM)/FM_pre now (diagnostics) and its maximum reached in the deficit phase. */
  depletionFrac: number;
  depletionMax: number;
  /** Net protein tissue lost inside fasts (hydrated, kg; minus labile repletion), 20 §6. */
  fastProteinLostKg: number;
  /** Nitrogen balance of the last completed day, g N/d. */
  nBalanceG: number;
  /** Hours today in which the smooth fat floor diverted energy to lean tissue (review M9; 0 normally). */
  fatFloorHours: number;
  /** 1 while the fat floor is engaged (cleared after a day without it; diagnostics). */
  fatFloorOn: number;
  /** 1 when the floor engaged in the last stepped hour. */
  fatFloorThisHour: number;
  /** Last value written to `fatFloorActive` (1 − g of review M9; the bus write is skipped while unchanged, usually 0). */
  fatFloorOut: number;
  /** Day accumulators: FM/LT at day start (kg), LT changes inside fasting hours and from repletion (kg). */
  fmDayStart: number;
  ltDayStart: number;
  dayFastLtKg: number;
  dayRepLtKg: number;
  /**
   * Morning anchor (orchestrator ruling 2026-09-30, MODEL_SPEC §3.4): FM and LT change from midnight to the wake hour on the
   * most recent burn-in day of day 0's weekday (else the latest burn-in day), kg (≤ 0: overnight oxidation), 1 once a day of
   * that weekday was latched, and the current day's morning weigh-in hour (`core/math.wakeRecordHour`).
   */
  nightFmKg: number;
  nightLtKg: number;
  nightMatched: number;
  wakeHour: number;
}

/** Prepared constants plus per-run context (never mutated during the run). */
export interface CompositionK extends CompositionConstants {
  female: boolean;
  /** true when `allocateRegional`/`circumferencesFor` run daily (waist or visceralFat recorded). */
  regionalEnabled: boolean;
  /** t = 0 body estimate (baseline for circumferences, M8). */
  baseline: BodyEstimate;
  /** VAT susceptibilities of the M7 rule (body module) for the allocation-free fallback. */
  vatKLoss: number;
  vatKGain: number;
  /** kg lean tissue per g protein, (1 + h_P)/1000. */
  ltPerGProtein: number;
  /** Weekday of day 0 (0 = Monday): the burn-in night whose overnight change anchors the t = 0 masses. */
  startWeekday: number;
}

function prepare(ctx: ModuleContext): CompositionK {
  const c = readConstants(ctx.params);
  const se = ctx.seriesEnabled;
  return {
    ...c,
    female: ctx.profile.sex === 'female',
    regionalEnabled:
      se[MI.waist] === 1 || se[MI.visceralFat] === 1 || se[MI.fatTrunk] === 1 || se[MI.fatArms] === 1 || se[MI.fatLegs] === 1 ||
      se[MI.muscleArms] === 1 || se[MI.muscleLegs] === 1 || se[MI.muscleTrunk] === 1,
    baseline: ctx.profile.body,
    vatKLoss: K_LOSS.vatKg,
    vatKGain: K_GAIN.vatKg,
    ltPerGProtein: (1 + c.hP) / 1000,
    startWeekday: ctx.profile.startWeekday,
  };
}

/** LT0 = FFM0 − (1 + h)·G0/1000 (review m6 ruling; G0 = the body estimate's total glycogen, g), floored at ½ FFM0. */
export function initialLeanTissue(k: CompositionK, ffm0: number): number {
  const g0 = k.baseline.glycogen.totalG;
  const glyKg = Number.isFinite(g0) && g0 > 0 ? (g0 * (1 + k.lt0GlycogenWater)) / 1000 : 0;
  return Math.max(0.5 * ffm0, ffm0 - glyKg);
}

function writeMassSignals(s: CompositionState, bus: SignalBus): void {
  const ffmAct = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  bus.fatMassKg = s.fmKg;
  bus.leanTissueKg = s.ltKg;
  bus.ffmActKg = ffmAct;
  bus.tissueMassKg = s.fmKg + ffmAct;
}

/** Reset every slow state to the t = 0 body (init and end of burn-in; allocation allowed there). */
function anchorSlowStates(s: CompositionState, k: CompositionK, fm0: number, ffm0: number): void {
  const b = k.baseline;
  s.fmKg = fm0;
  s.fm0Kg = fm0;
  s.ffm0Kg = ffm0;
  s.lt0Kg = initialLeanTissue(k, ffm0);
  s.ltKg = s.lt0Kg;
  s.otherFfmKg = ffm0 - s.lt0Kg;
  s.fmMinKg = k.fmFloorFracBw0 * (fm0 + ffm0);
  s.smKg = b.skeletalMuscleKg;
  s.sm0Kg = b.skeletalMuscleKg;
  s.regional = { fat: { ...b.fat }, muscle: { ...b.muscle } };
  s.vatKg = b.fat.vatKg;
  s.waistCm = b.circumferences.waistCm;
  s.osInDeficit = 0;
  s.osValid = 0;
  s.fmPreKg = fm0;
  s.ffmPreKg = ffm0;
  s.wPreKg = fm0 + ffm0;
  s.pctFatPre = (100 * fm0) / (fm0 + ffm0);
  s.pmSS = 0;
  s.deficitEndDay = -1;
  s.depletionFrac = 0;
  s.depletionMax = 0;
  s.fastProteinLostKg = 0;
  s.nBalanceG = 0;
  s.fatFloorHours = 0;
  s.fatFloorOn = 0;
  s.fatFloorThisHour = 0;
  s.fatFloorOut = 0;
  s.fmDayStart = s.fmKg;
  s.ltDayStart = s.ltKg;
  s.dayFastLtKg = 0;
  s.dayRepLtKg = 0;
  s.body.fatMassKg = fm0;
  s.body.fatFreeMassKg = ffm0;
  s.body.weightKg = fm0 + ffm0;
  s.body.skeletalMuscleKg = s.smKg;
  s.body.fat = s.regional.fat;
  s.body.muscle = s.regional.muscle;
}

function init(k: CompositionK, ctx: ModuleContext, bus: SignalBus): CompositionState {
  const p = ctx.profile;
  const b = p.body;
  const body: BodyState = {
    sex: b.sex,
    ageYears: b.ageYears,
    heightCm: b.heightCm,
    weightKg: b.weightKg,
    fatMassKg: b.fatMassKg,
    fatFreeMassKg: b.fatFreeMassKg,
    skeletalMuscleKg: b.skeletalMuscleKg,
    fat: { ...b.fat },
    muscle: { ...b.muscle },
    satShares: { ...b.satShares },
    frameZ: b.frameZ,
  };
  const s: CompositionState = {
    fmKg: 0,
    ltKg: 0,
    lt0Kg: 0,
    fm0Kg: 0,
    ffm0Kg: 0,
    otherFfmKg: 0,
    fmMinKg: 0,
    smKg: 0,
    sm0Kg: 0,
    eb7: 0,
    eb7Ring: new Float64Array(k.eb7WindowD),
    eb7Idx: 0,
    u: 0,
    regime: REGIME_SURPLUS,
    pE: 0,
    pDef: 0,
    pSur: 0,
    pCat: 0,
    rL: 0,
    leanExtraKgD: 0,
    rtAccKgD: 0,
    vliLeanKgD: 0,
    explicitKgH: 0,
    explicitFastKgH: 0,
    vliDays: 0,
    poxDecay: 1,
    regional: { fat: { ...b.fat }, muscle: { ...b.muscle } },
    vatKg: 0,
    waistCm: 0,
    body,
    osInDeficit: 0,
    osValid: 0,
    fmPreKg: 0,
    ffmPreKg: 0,
    wPreKg: 0,
    pctFatPre: 0,
    pmSS: 0,
    deficitEndDay: -1,
    depletionFrac: 0,
    depletionMax: 0,
    fastProteinLostKg: 0,
    nBalanceG: 0,
    fatFloorHours: 0,
    fatFloorOn: 0,
    fatFloorThisHour: 0,
    fatFloorOut: 0,
    fmDayStart: 0,
    ltDayStart: 0,
    dayFastLtKg: 0,
    dayRepLtKg: 0,
    nightFmKg: 0,
    nightLtKg: 0,
    nightMatched: 0,
    wakeHour: wakeRecordHour(p.habits.wakeTimeH),
  };
  anchorSlowStates(s, k, p.fm0Kg, p.ffm0Kg);
  writeMassSignals(s, bus);
  bus.skeletalMuscleKg = s.smKg;
  bus.vatKg = s.vatKg;
  bus.tissueEnergyKcalH = 0;
  bus.depositionCostKcalH = 0;
  bus.leanRateKgD = 0;
  bus.energyBalanceFrac = 0;
  bus.energyBalance7KcalD = 0;
  return s;
}

/**
 * Plan the day (MODEL_SPEC §1.8 steps 1-2): energy-balance signals, regime, energy share p_E and explicit lean terms.
 * Exported for unit tests (drives the module with hand-built bus/day values). Allocation-free.
 */
export function planDay(s: CompositionState, k: CompositionK, bus: SignalBus, day: DayInput): void {
  // 1. energy balance of today's plan
  let tee = bus.tdeeEstKcalD;
  if (!(tee > 1)) tee = bus.maintenanceKcalD > 1 ? bus.maintenanceKcalD : 1;
  const ei = day.energyKcal > 0 ? day.energyKcal : 0;
  const u = clamp((ei - tee) / tee, -1, 1);
  s.u = u;
  bus.energyBalanceFrac = u;
  const ring = s.eb7Ring;
  ring[s.eb7Idx] = ei - tee;
  s.eb7Idx = s.eb7Idx + 1 >= ring.length ? 0 : s.eb7Idx + 1;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) sum += ring[i]!;
  s.eb7 = sum / ring.length;
  bus.energyBalance7KcalD = s.eb7;

  // body descriptors (tissue basis)
  const ffm = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  const bw = s.fmKg + ffm;
  const bf = bw > 0 ? s.fmKg / bw : 0;
  const age = bus.ageYears;
  const repletionG = 24 * (bus.fastRepletionGH > 0 ? bus.fastRepletionGH : 0);
  const protG = day.proteinG > 0 ? day.proteinG : 0;
  const qDaily = day.proteinQDaily > 0 ? day.proteinQDaily : 1;
  const pEff = Math.max(0, protG * qDaily - repletionG);
  const q = ffm > 0 ? pEff / ffm : 0;

  // explicit lean terms (all regimes, all hours): 09 RT accretion + 03 §4.14 age drift, RT = muscle's rtDoseFrac
  // (min(1, V_wb/V_R(age)), 09 §4.8 — one V_R owner, so ensemble draws of V_R reach both uses)
  const rtDose = bus.rtDoseFrac;
  const rt = rtDose > 1 ? 1 : rtDose > 0 ? rtDose : 0;
  s.rtAccKgD = bus.rtAccretionKgD;
  s.leanExtraKgD = s.rtAccKgD + ageLeanDriftGD(k, age, rt) / 1000;
  s.vliLeanKgD = 0;
  s.pCat = 0;
  s.rL = 0;

  // 2. plan regime for non-fasting hours
  if (ei < k.vliEnergyFrac * tee && q < k.vliProteinQ && protG >= k.vliProteinMinG) {
    // 2b. very-low-intake, non-fasting: 03 §4.13 Pox branch (explicit lean rate; fat takes the residual)
    s.regime = REGIME_VLI;
    s.pE = 0;
    if (s.vliDays === 0) s.poxDecay = 1;
    const L = leannessIndex(k, bf, k.female);
    const pox = poxRate(k, s.poxDecay, L, day.carbG > 0 ? day.carbG : 0, s.vliDays);
    s.vliLeanKgD = poxLeanRateKgD(k, pox, ffm, pEff);
  } else {
    // 2c. deficit share: 03 leanFractionOfLoss, RT-stripped; × (1 − R_RT); energy share + 16 sleep shift (review M1).
    //     The deficit size d is the sustained one, −EB7/TEE_est (03's d is the diet's deficit, not one day's plan).
    const d = clamp(-s.eb7 / tee, 0, 1);
    s.pCat = pCatDeficit(k, q, d, bf, s.fmKg, k.female, age, bus.aerobicIdx);
    const pDef = deficitEnergyShare(k, s.pCat, bus.rtRetentionFrac, bus.partitionSleepShift);
    // 2d. surplus share: 11 §4.7 r_L with (1 − s_RT); overshoot blend (11 §4.12)
    const pRaw = Math.max(0, protG - repletionG);
    const pBw = bw > 0 ? pRaw / bw : 0;
    const fatG = day.fatG;
    const pufa = fatG > 0 ? day.pufaG / fatG : Number.NaN;
    const sfa = fatG > 0 ? day.satFatG / fatG : Number.NaN;
    // 11 §4.8 switch from the sedentary surplus lean accretion to RT mode (R-RTSWITCH, final round 2026-09-30): RT takes
    // over the sedentary share only as far as 09's accretion supplies it, s_RT = min(1, L_RT/L_sed), L_sed = the sedentary
    // surplus lean rate at the current surplus (at least the blend half-width W, so the share is continuous through
    // EB7 = 0). Total surplus lean = max(L_sed, L_RT) is then non-decreasing in training volume; 11's literal
    // s_RT = min(1, V_wb/12) removed the sedentary share faster than 09's accretion replaced it in trained lifters
    // (lean gain at +10 % fell from 4 to 12 sets/wk). Without RT (V_wb = 0) s_RT = 0 as before.
    const mFa = mFatType(k, pufa, sfa);
    let sRt = 0;
    if (bus.rtVolumeWb > 0) {
      const pSed = surplusEnergyShare(k, surplusLeanRatio(k, pBw, s.fmKg, 0, mFa));
      const lSed = (pSed * (s.eb7 > k.partBlendKcalD ? s.eb7 : k.partBlendKcalD)) / k.effL;
      const lRt = s.rtAccKgD > 0 ? s.rtAccKgD : 0;
      sRt = lSed > 0 ? (lRt < lSed ? lRt / lSed : 1) : 1;
    }
    let rL = surplusLeanRatio(k, pBw, s.fmKg, sRt, mFa);
    if (s.osValid === 1 && s.ffmPreKg - ffm > k.osFfmDefMin && s.fmPreKg > 0) {
      // D_F latched at the depletion reached in the deficit phase (interpretation: keeps P_RF constant through the regain,
      // as in Jacquet 2020; with the current FM the ramp would hand the regain back to the generic rule as fat returns)
      rL = overshootLeanRatio(k, rL, s.pmSS, s.pctFatPre, s.depletionMax, age);
    }
    s.rL = rL;
    const pSur = surplusEnergyShare(k, rL);
    // 2e. review m20: p_E is continuous in EB7 — linear blend of the two shares over |EB7| < W (fully 03 at EB7 ≤ −W,
    //     fully 11 at EB7 ≥ +W). Together with the weekly boxcar EB7 (step 1) and the EB7-based deficit size d, a weight-
    //     stable habitual week gets the same p_E every day, so hourly/daily storage and mobilisation use the same share and
    //     no lean↔fat ratchet builds up at maintenance (O-12).
    const w = clamp(0.5 - s.eb7 / (2 * k.partBlendKcalD), 0, 1);
    s.pDef = pDef;
    s.pSur = pSur;
    s.pE = w * pDef + (1 - w) * pSur;
    s.regime = s.eb7 < 0 ? REGIME_DEFICIT : REGIME_SURPLUS;
  }
  s.explicitFastKgH = s.leanExtraKgD / 24;
  s.explicitKgH = (s.leanExtraKgD + s.vliLeanKgD) / 24;
}

/**
 * One hour of tissue bookkeeping (MODEL_SPEC §1.8 steps 3-6, per-hour branch of review M7, smooth fat floor of review
 * M9). Allocation-free. Exported for unit tests.
 */
export function stepTissue(s: CompositionState, k: CompositionK, bus: SignalBus): void {
  // each bus field is read once (bus reads are the dominant hot-path cost)
  const sh = bus.eAbsKcalH - bus.teePreKcalH - bus.dnlHeatKcalH - bus.ketoneLossKcalH - bus.glycogenChangeKcalH;
  const repG = bus.fastRepletionGH;
  const rep = repG > 0 ? repG * k.ltPerGProtein : 0;
  const fasting = bus.fastActive === 1;
  const effL = k.effL;
  // 4. lean first: explicit terms at ρL + ηL (signed)
  const dLtX = (fasting ? s.explicitFastKgH : s.explicitKgH) + rep;
  const sPrime = sh - effL * dLtX;
  let dLt = dLtX;
  let dLtFast = 0;
  let eFat: number; // energy (kcal) that fat tissue takes this hour
  if (fasting) {
    // 5. fasting branch: the fasting module's protein flux is the lean change; fat takes the residual
    const pox = bus.fastProtOxGH;
    dLtFast = pox > 0 ? -pox * k.ltPerGProtein : 0;
    dLt += dLtFast;
    eFat = sPrime - effL * dLtFast;
  } else {
    const pE = s.pE;
    dLt += (pE * sPrime) / effL;
    eFat = (1 - pE) * sPrime;
  }
  // review M9: smooth fat floor — below FM_min + ramp, a growing part of a fat *deficit* is met from lean tissue
  let fm = s.fmKg;
  let lt = s.ltKg;
  let floorOut = 0;
  s.fatFloorThisHour = 0;
  if (eFat < 0 && fm < s.fmMinKg + k.fmFloorRampKg) {
    const w = fatFloorWeight(k, fm, s.fmMinKg);
    dLt += ((1 - w) * eFat) / effL;
    eFat *= w;
    floorOut = 1 - w;
    s.fatFloorHours += 1;
    s.fatFloorThisHour = 1;
  }
  if (floorOut !== s.fatFloorOut) {
    s.fatFloorOut = floorOut;
    bus.fatFloorActive = floorOut;
  }
  let dFm = eFat / k.effF;
  // numerical guards only (physically unreachable): lean tissue floor, FM ≥ 0
  const ltFloor = LT_FLOOR_FRAC * s.lt0Kg;
  if (lt + dLt < ltFloor) dLt = ltFloor - lt;
  if (fm + dFm < 0) dFm = -fm;
  fm += dFm;
  lt += dLt;
  s.fmKg = fm;
  s.ltKg = lt;
  // 6. signals
  bus.tissueEnergyKcalH = k.effF * dFm + effL * dLt;
  bus.depositionCostKcalH = k.etaF * dFm + k.etaL * dLt;
  const ffmAct = s.ffm0Kg + (lt - s.lt0Kg);
  bus.fatMassKg = fm;
  bus.leanTissueKg = lt;
  bus.ffmActKg = ffmAct;
  bus.tissueMassKg = fm + ffmAct;
  if (fasting) s.dayFastLtKg += dLtFast;
  if (rep > 0) s.dayRepLtKg += rep;
}

/** Daily closing (MODEL_SPEC §1.8 step 7): SM, N balance, lean rate, regional/VAT/waist, overshoot memory. */
export function closeDay(s: CompositionState, k: CompositionK, bus: SignalBus, dayIndex: number): void {
  const dLtDay = s.ltKg - s.ltDayStart;
  const ffm = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  const bw = s.fmKg + ffm;
  // SM: 0.5 of non-RT lean change + 0.7 of RT accretion (03 §4.19 step 7; 09 §4.9, review M10)
  const rtPart = s.rtAccKgD; // booked as rtAccKgD/24 in each of the day's 24 hours
  s.smKg = Math.max(0, s.smKg + k.smLossShare * (dLtDay - rtPart) + k.smRtShare * rtPart);
  s.nBalanceG = (dLtDay * 1000 * k.fProt) / 6.25;
  s.fastProteinLostKg += -s.dayFastLtKg - s.dayRepLtKg;
  bus.leanRateKgD = dLtDay - s.dayFastLtKg;

  // regional depots, VAT, waist (14 M7-M8)
  if (k.regionalEnabled) {
    s.regional = allocateRegional(s.regional, { fatMassKg: s.fmKg, skeletalMuscleKg: s.smKg });
    s.vatKg = s.regional.fat.vatKg;
    const b = s.body;
    b.ageYears = bus.ageYears;
    b.fatMassKg = s.fmKg;
    b.fatFreeMassKg = ffm;
    b.weightKg = bw;
    b.skeletalMuscleKg = s.smKg;
    b.fat = s.regional.fat;
    b.muscle = s.regional.muscle;
    s.waistCm = circumferencesFor(b, k.baseline).waistCm;
  } else if (s.fmDayStart > 0 && s.fmKg > 0) {
    const kv = s.fmKg < s.fmDayStart ? k.vatKLoss : k.vatKGain;
    s.vatKg *= Math.pow(s.fmKg / s.fmDayStart, kv);
  }
  bus.skeletalMuscleKg = s.smKg;
  bus.vatKg = s.vatKg;

  // very-low-intake branch clock (03 §4.13: t_f resets after ≥ 24 h of normal feeding)
  if (s.regime === REGIME_VLI) {
    s.poxDecay *= poxDecayFactor(k, bus.bhbEndoMmolL);
    s.vliDays += 1;
  } else {
    s.vliDays = 0;
  }

  // overshoot memory (11 §4.12)
  if (s.eb7 < 0) {
    if (s.osInDeficit === 0) {
      s.osInDeficit = 1;
      if (s.osValid === 0) {
        // entering a new deficit phase: remember the pre-diet body (day-start values)
        const ffmStart = s.ffm0Kg + (s.ltDayStart - s.lt0Kg);
        s.fmPreKg = s.fmDayStart;
        s.ffmPreKg = ffmStart;
        s.wPreKg = s.fmDayStart + ffmStart;
        s.pctFatPre = s.wPreKg > 0 ? (100 * s.fmDayStart) / s.wPreKg : 0;
        s.depletionMax = 0;
      }
      s.osValid = 1;
    }
    const df = s.fmPreKg > 0 ? (s.fmPreKg - s.fmKg) / s.fmPreKg : 0;
    if (df > s.depletionMax) s.depletionMax = df;
    const dW = s.wPreKg - bw;
    s.pmSS = dW >= PMSS_MIN_LOSS_KG ? clamp((s.ffmPreKg - ffm) / dW, 0, 0.95) : jacquetPmSS(k, s.pctFatPre);
  } else {
    if (s.osInDeficit === 1) {
      s.osInDeficit = 0;
      s.deficitEndDay = dayIndex;
    }
    if (s.osValid === 1 && (s.ffmPreKg - ffm <= 0 || (s.deficitEndDay >= 0 && dayIndex - s.deficitEndDay > k.osExpiryD))) {
      s.osValid = 0;
    }
  }
  s.depletionFrac = s.fmPreKg > 0 ? (s.fmPreKg - s.fmKg) / s.fmPreKg : 0;

  // next day's accumulators
  s.fmDayStart = s.fmKg;
  s.ltDayStart = s.ltKg;
  s.dayFastLtKg = 0;
  s.dayRepLtKg = 0;
  if (s.fatFloorHours === 0) s.fatFloorOn = 0;
  s.fatFloorHours = 0;
}

export const compositionModule = defineModule<CompositionState, CompositionK>({
  id: 'composition',
  specSection: '§1.8',
  dossiers: '01 §4.2-4.7; 03 §4.4/4.13/4.14/4.19; 11 §4.7/4.12/4.15; 20 §4.4; 09 §4.8-4.10; 14 M6-M8; 16 §4.0.1',
  params: COMPOSITION_PARAMS,
  reads: [
    'partitionSleepShift', 'ageYears', 'aerobicIdx', 'raProtGH', 'eAbsKcalH', 'fastActive', 'fastProtOxGH', 'fastRepletionGH',
    'teePreKcalH', 'maintenanceKcalD', 'tdeeEstKcalD', 'dnlHeatKcalH', 'glycogenChangeKcalH', 'bhbEndoMmolL',
    'ketoneLossKcalH', 'rtAccretionKgD', 'rtRetentionFrac', 'rtDoseFrac', 'rtVolumeWb',
  ],
  writes: [
    'fatMassKg', 'leanTissueKg', 'ffmActKg', 'tissueMassKg', 'skeletalMuscleKg', 'tissueEnergyKcalH', 'depositionCostKcalH',
    'leanRateKgD', 'energyBalanceFrac', 'energyBalance7KcalD', 'vatKg', 'fatFloorActive',
  ],
  records: [
    'fatMass', 'leanTissue', 'skeletalMuscle', 'waist', 'visceralFat', 'nitrogenBalance', 'fastProteinCost',
    'fatTrunk', 'fatArms', 'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk',
  ],
  prepare,
  init,
  startDay: (s, k, bus, day) => {
    s.wakeHour = wakeRecordHour(day.sleepWakeH);
    planDay(s, k, bus, day);
  },
  stepHour: (s, k, bus, _hour, _day, clock) => {
    stepTissue(s, k, bus);
    // review M9 / MODEL_SPEC §7.1: the fat floor is reported through `fatFloorActive` (safety owns W-01-FATFLOOR and every
    // `safetyFlag` event); composition emits no events.
    if (s.fatFloorThisHour === 1) s.fatFloorOn = 1;
    // morning anchor: latch the burn-in night's midnight → wake-hour tissue change (fmDayStart/ltDayStart = midnight)
    if (clock.day < 0 && clock.hourOfDay === s.wakeHour) {
      const same = clock.weekday === k.startWeekday;
      if (same || s.nightMatched === 0) {
        s.nightFmKg = s.fmKg - s.fmDayStart;
        s.nightLtKg = s.ltKg - s.ltDayStart;
        if (same) s.nightMatched = 1;
      }
    }
  },
  endOfDay: (s, k, bus, _day, clock) => {
    closeDay(s, k, bus, clock.day);
  },
  endBurnIn: (s, k, bus, ctx) => {
    // end of burn-in (review B3c, MODEL_SPEC §3.4): slow states back to the entered body; fast states (EB7, VLI clock) keep
    // their settled values. Morning anchor (orchestrator ruling 2026-09-30): the entered body is the wake-hour body, so the
    // t = 0 (midnight) masses are FM0/LT0 minus the habitual overnight change — FM = FM0 and LT = LT0 again at day 0's wake
    // hour (burn-in night of day 0's weekday). References (fm0Kg, lt0Kg, ffm0Kg) stay the entered values. Water adds no
    // tissue offset.
    anchorSlowStates(s, k, s.fm0Kg, s.ffm0Kg);
    if ((ctx.burnInDays ?? 0) > 0) {
      s.fmKg = s.fm0Kg - s.nightFmKg;
      s.ltKg = s.lt0Kg - s.nightLtKg;
      s.fmDayStart = s.fmKg;
      s.ltDayStart = s.ltKg;
    }
    writeMassSignals(s, bus);
    bus.skeletalMuscleKg = s.smKg;
    bus.vatKg = s.vatKg;
    bus.leanRateKgD = 0;
    bus.fatFloorActive = 0;
    bus.tissueEnergyKcalH = 0;
    bus.depositionCostKcalH = 0;
  },
  recordDay: (s, _k, _bus, out) => {
    out[MI.fatMass] = s.fmKg;
    out[MI.leanTissue] = s.ltKg;
    out[MI.skeletalMuscle] = s.smKg;
    out[MI.visceralFat] = s.vatKg;
    out[MI.waist] = s.waistCm;
    out[MI.nitrogenBalance] = s.nBalanceG;
    out[MI.fastProteinCost] = s.fastProteinLostKg;
    const f = s.regional.fat;
    const m = s.regional.muscle;
    out[MI.fatTrunk] = f.trunkSatKg;
    out[MI.fatArms] = f.armsKg;
    out[MI.fatLegs] = f.legsKg;
    out[MI.muscleArms] = m.armsKg;
    out[MI.muscleLegs] = m.legsKg;
    out[MI.muscleTrunk] = m.trunkKg;
  },
});
