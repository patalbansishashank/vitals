/**
 * MODULE energy — RMR, TEF, NEAT, adaptive thermogenesis, exercise compensation (metabolic part), TH_C, GNG cost,
 * maintenance estimate, TDEE.
 * Spec: docs/MODEL_SPEC.md §1.5 · Dossiers: 02 §4.1-4.13 (owner); 10 §4.3 (metabolic compensation c_met);
 * 11 §4.5-4.6 (TH_C, β_AT⁺); 15 §4.10/§4.11 (alcohol TEF, caffeine EE); 20 §4.2 (fasting RMR via fastRmrMult).
 * Owned files: src/engine/model/energy/** only.
 *
 * Hourly ledger (stepHour):
 *   RMR_h  = [(RMR_mass + AT_R·[not held] + k_P·(P_eff − P0) + C_comp)·fastRmrMult·(1 + a_lut·(s − s̄))]/24 + caffeine_h
 *   TEF_h  = m_IR·(α_day·E_abs,non-alcohol,h + α_alc·7·alcOx_h)          (R-TEFTIME: TEF follows absorbed energy)
 *   NEAT_h = (NEAT0·BW/BW0 + AT_N)·w_awake,h + stepsExtra_h
 *   TEE_pre,h = RMR_h + TEF_h + NEAT_h + EAT_h + TH_C,h + GNGcost_h
 * Daily (endOfDay): AT ODE on ΔEI = Σ eAbs − EI0 (exact exponentials), metabolic compensation on the 7-day mean net
 * exercise energy, caffeine tolerance, maintenance EI_inst (02 §4.13) and the 'current' reference.
 *
 * Design notes (see the WP report):
 *  - TEF timing: the per-macro appearance signals (raGlcGH …) are not readable by energy in the v1 bus, so TEF_h uses
 *    the day's non-alcohol TEF fraction α_day (from DayInput macros) × the non-alcohol energy appearing this hour, and
 *    the alcohol TEF on `alcOxGH` (alcohol energy enters `eAbsKcalH` as it is oxidised, §1.3). Daily integral = 02's TEF.
 *  - NEAT and the caffeine term are distributed within the day by weights whose running sum is capped at 1 and
 *    settled at hour 23, so each day's integral is exact whatever the sleep/caffeine pattern.
 *  - gng0 is an hour-of-day profile latched on the last burn-in day, so the habitual day has exactly zero GNG cost
 *    (gngCost default 0 per the ruling on review M5; 0.2 is the registry high).
 *  - Burn-in calibration (ruling on review B3(b)): at the end of day −1, EI0, EAT0, α_mix0 and NEAT0 are re-anchored on
 *    the last ≤ 7 burn-in days so that model TEE = realised habitual intake (every term the analytic TDEE0 misses is
 *    absorbed once) and AT/compensation restart from 0.
 *  - While the fasting overlay is active P_eff is frozen and the compensation state is held (ruling on review M6),
 *    in addition to AT_R (R-FAST-AT).
 */
import { defineModule } from '../../core/moduleKit';
import { ATWATER, DEFAULTS } from '../../core/defaults';
import { MI } from '../../types/metrics';
import type { ModuleContext } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import type { ResolvedProfile } from '../../types/profile';
import { ENERGY_PARAMS } from './params';

export { ENERGY_PARAMS } from './params';

const MI_TDEE = MI.tdee;
const MI_EB = MI.energyBalance;
const MI_RMR = MI.rmr;
const MI_NEAT = MI.neat;
const MI_TEF = MI.tef;
const MI_MAINT = MI.maintenance;
const MI_AT = MI.metabolicAdaptation;
const MI_ATR = MI.atResting;
const MI_ATN = MI.atNonResting;

/** Indices into `EnergyState.hx` (units: kcal/h for *H, kcal for day sums, fractions/flags otherwise). */
export const HX = {
  rmrH: 0,
  tefH: 1,
  neatH: 2,
  thcH: 3,
  gngCostH: 4,
  rmrMassKcalD: 5,
  dayEiKcal: 6,
  dayTeeKcal: 7,
  dayTeeNoDepKcal: 8,
  dayEatKcal: 9,
  dayStepsExtraKcal: 10,
  dayTefKcal: 11,
  dayRmrKcal: 12,
  dayNeatKcal: 13,
  dayGngCostKcal: 14,
  dayCafLoad: 15,
  cafPaid: 16,
  neatPaid: 17,
  atRHeldToday: 18,
  fastActiveToday: 19,
  flagLowRmrH: 20,
  dayMassDevKcal: 21,
  maintSchedKcal: 22,
  maintDenom: 23,
  maintDayDone: 24,
  maintBodyKcal: 25,
} as const;
const N_HX = 26;
const X_RMRH = 0;
const X_TEFH = 1;
const X_NEATH = 2;
const X_THCH = 3;
const X_GNGCOSTH = 4;
const X_RMRMASSKCALD = 5;
const X_DAYEIKCAL = 6;
const X_DAYTEEKCAL = 7;
const X_DAYTEENODEPKCAL = 8;
const X_DAYEATKCAL = 9;
const X_DAYSTEPSEXTRAKCAL = 10;
const X_DAYTEFKCAL = 11;
const X_DAYRMRKCAL = 12;
const X_DAYNEATKCAL = 13;
const X_DAYGNGCOSTKCAL = 14;
const X_DAYCAFLOAD = 15;
const X_CAFPAID = 16;
const X_NEATPAID = 17;
const X_ATRHELDTODAY = 18;
const X_FASTACTIVETODAY = 19;
const X_FLAGLOWRMRH = 20;
const X_DAYMASSDEVKCAL = 21;
const X_MAINTSCHEDKCAL = 22;
const X_MAINTDENOM = 23;
const X_MAINTDAYDONE = 24;
const X_MAINTBODYKCAL = 25;

/**
 * Engine energy convention (§0.2, core/defaults ATWATER) copied into module constants: the hot path must not read
 * imported objects (dev/test transforms turn imports into getter calls).
 */
const E_P = ATWATER.protein;
const E_C = ATWATER.carb;
const E_F = ATWATER.fat;
const E_MCT = ATWATER.mct;
const E_FIB = ATWATER.fibre;
const E_ALC = ATWATER.alcohol;

/** Longest cycle the luteal-mean ring can hold, d (cycles are clamped to it). */
const LUTEAL_RING_MAX = 60;

export interface EnergyState {
  // ---- baselines (t = 0)
  /** Baseline RMR, kcal/d (02 §4.1 selection rule, resolveProfile). */
  rmr0: number;
  /** Baseline TDEE = EI0, kcal/d. */
  tdee0: number;
  /** Weight-stable intake EI0 as absorbed (Σ eAbsKcalH), kcal/d (= TDEE0, re-anchored at the end of burn-in). */
  ei0: number;
  /** EI_ref for TH_C in label energy (DayInput.energyKcal convention), kcal/d (= TDEE0). */
  eiRefLabel: number;
  /** Baseline NEAT incl. habitual steps, kcal/d (02 §4.6: TDEE0 − RMR0 − TEF0 − EAT0, floor 0.10·RMR0). */
  neat0: number;
  /** Habitual exercise energy, kcal/d. */
  eat0: number;
  /** Habitual TEF, kcal/d. */
  tef0: number;
  /** Habitual TEF fraction α_mix0 = TEF0/EI0. */
  alpha0: number;
  /** Habitual protein P0, g/d. */
  protein0G: number;
  /** Habitual available carbohydrate CHO_ref for TH_C, g/d. */
  carb0G: number;
  /** Habitual caffeine mg_hab, mg/d. */
  cafHabMg: number;
  /** Habitual steps, steps/d. */
  steps0: number;
  /** FFM_act0, FM0, BW0 = FM0 + FFM0, kg. */
  ffmAct0: number;
  fm0: number;
  bw0: number;
  /** Height squared, m² (BMI for c_met). */
  height2: number;
  /** a_lut (moderators.lutealAmp), frac RMR; 0 when that parameter is not registered. */
  aLut: number;

  // ---- slow states
  /** Adaptive thermogenesis, resting and non-resting parts, kcal/d (02 §4.8). */
  atR: number;
  atN: number;
  /** Lagged protein intake P_eff, g/d (02 §4.5, τ_P 2 d). */
  pEffG: number;
  /** Metabolic exercise compensation, kcal/d (≤ 0; 10 §4.3 c_met, τ 14 d, cap −5 % RMR). */
  compKcalD: number;
  /** Caffeine thermogenic tolerance 0..1 (15 §4.11, energy's own 14-d EMA of mg_d ≥ 200). */
  cafTol: number;
  /** Ring of daily net exercise + step energy above baseline, kcal/d (length enetWindowD), running sum, index. */
  enetRing: Float64Array;
  enetSum: number;
  enetIdx: number;
  /** Ring of daily luteal weights s(d) over one cycle, running sum, index, length; s̄ = sum/len. */
  lutealRing: Float64Array;
  lutealSum: number;
  lutealIdx: number;
  lutealLen: number;
  /** Baseline GNG by hour of day, g/h (latched on the last burn-in day; R-GNG reference). */
  gng0H: Float64Array;
  /** Today's GNG readings by hour, g/h (latch source). */
  gngDayH: Float64Array;

  // ---- today's day-level terms (set in startDay)
  /** a_lut·(s(d) − s̄). */
  lutealTerm: number;
  /** k_P·(P_eff − P0), kcal/d (clamped P_eff/BW 0.4-3.5 g/kg). */
  protTermKcalD: number;
  /** Non-alcohol TEF fraction of today's intake mix (kept from the last day with intake). */
  alphaNa: number;
  /** TH_C per kcal of non-alcohol energy appearing today (0 unless EI > EI0). */
  thcFrac: number;
  /** m_IR = 1 − slope·IR (insulinResistanceIdx, d−1). */
  mIR: number;
  /** Caffeine term of today, kcal/d; weight reference (mg·h of load expected), paid fraction. */
  cafDayKcal: number;
  cafLoadRef: number;
  /** Load integral and dose of the previous day (for today's weight reference). */
  cafPrevLoad: number;
  cafPrevMg: number;
  /** Today's caffeine dose (DayInput.caffeineMg), mg. */
  cafDayMg: number;
  /** NEAT of today excluding steps: NEAT0·BW/BW0 + AT_N, kcal/d; awake-hours reference; paid fraction. */
  neatDayKcal: number;
  awakeRefH: number;
  /** Mass-dependent part of today's NEAT, NEAT0·(BW/BW0 − 1), kcal/d (burn-in calibration, review B3(b)). */
  neatMassDevKcalD: number;

  // ---- burn-in calibration accumulators (review B3(b)): days, Σ EI, Σ (TEE_pre + DNL heat − EAT), Σ EAT, Σ TEF
  calN: number;
  calEi: number;
  calTeeNoEat: number;
  calEat: number;
  calTef: number;
  /**
   * Σ of the mass-dependent TEE (RMR γ-terms and NEAT·(BW/BW0 − 1)) over the calibration days, kcal: the part of the
   * burn-in TEE that exists only because FM/LT drifted during burn-in and vanishes when composition re-anchors them.
   */
  calMass: number;
  /** NEAT0 change applied by the last calibration, kcal/d (diagnostics). */
  calDeltaNeat: number;


  // ---- day-to-day memory
  /** Yesterday's TDEE (incl. deposition cost and DNL heat) and exercise EE, kcal/d. */
  prevDayTeeKcal: number;
  prevDayEatKcal: number;

  // ---- validity flags (02 §9 guards), counts; hourly flag count is hx[HX.flagLowRmrH]
  /** Days with TDEE < 1.1·RMR. */
  flagLowTdeeD: number;

  /**
   * Hot per-hour scalars (this hour's components, day accumulators, paid fractions, hold flags) — indexed by `HX`.
   * Kept in a Float64Array because V8 stores double object fields boxed (every write would allocate a HeapNumber).
   */
  hx: Float64Array;
}

/** Constants (prepare): parameter values and precomputed daily decay factors. */
export interface EnergyK {
  gammaL: number;
  gammaF: number;
  gammaSM: number;
  betaAT: number;
  betaATPlus: number;
  sigmaAT: number;
  fROn: number;
  fNOn: number;
  fOff: number;
  atGuardFrac: number;
  guardRmrFrac: number;
  guardTdeeRmr: number;
  tefP: number;
  tefC: number;
  tefF: number;
  /** Total MCT TEF = tefF + tefMctExtra. */
  tefMct: number;
  tefAlc: number;
  tefFibre: number;
  tefIrSlope: number;
  kP: number;
  fP: number;
  pMinPerKg: number;
  pMaxPerKg: number;
  kCaff: number;
  fCafTol: number;
  cafTolMg: number;
  cafTolEffect: number;
  cMet: number;
  cMetPerBmi: number;
  cMetBmiRef: number;
  cMetBmiLo: number;
  cMetBmiHi: number;
  fComp: number;
  compCapFrac: number;
  enetWindow: number;
  phiC: number;
  gngCost: number;
  neat0FloorFrac: number;
  habitRtMet: number;
  habitCardioMet: number;
  lutealMeanPrior: number;
  alphaMixMinEiFrac: number;
  fastHoldEps: number;
  /** Burn-in days used for the B3(b) calibration. */
  calibDays: number;
  /**
   * R-MAINT: day 0's planned − habitual activity (DayInput.activityDeltaKcal), kcal/d — the t = 0 value of the `maintenance`
   * metric. Held in the constants (schedule-specific, like the run's compiled schedule) and not in the state, so a
   * post-burn-in snapshot captured for one schedule restores bit-identically for another.
   */
  day0ActivityDelta: number;
  aLut: number;
  /** Test mode: finite-value assertions. */
  checks: boolean;
}

function pv(ctx: ModuleContext, id: string): number {
  const i = ctx.params.index.get(id);
  if (i === undefined) throw new Error(`energy: unknown parameter "${id}"`);
  return ctx.params.values[i] as number;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export function prepareEnergy(ctx: ModuleContext): EnergyK {
  const e = (n: string): number => pv(ctx, `energy.${n}`);
  const lutIdx = ctx.params.index.get('moderators.lutealAmp');
  return {
    gammaL: e('gammaL'),
    gammaF: e('gammaF'),
    gammaSM: e('gammaSM'),
    betaAT: e('betaAT'),
    betaATPlus: e('betaATPlus'),
    sigmaAT: e('sigmaAT'),
    fROn: Math.exp(-1 / e('tauROn')),
    fNOn: Math.exp(-1 / e('tauNOn')),
    fOff: Math.exp(-1 / e('tauOff')),
    atGuardFrac: e('atGuardFrac'),
    guardRmrFrac: e('guardRmrFrac'),
    guardTdeeRmr: e('guardTdeeRmr'),
    tefP: e('tefP'),
    tefC: e('tefC'),
    tefF: e('tefF'),
    tefMct: e('tefF') + e('tefMctExtra'),
    tefAlc: e('tefAlc'),
    tefFibre: e('tefFibre'),
    tefIrSlope: e('tefIrSlope'),
    kP: e('kP'),
    fP: Math.exp(-1 / e('tauP')),
    pMinPerKg: e('pEffMinGPerKg'),
    pMaxPerKg: e('pEffMaxGPerKg'),
    kCaff: e('kCaff'),
    fCafTol: Math.exp(-1 / e('cafTolTauD')),
    cafTolMg: e('cafTolMg'),
    cafTolEffect: e('cafTolEffect'),
    cMet: e('cMet'),
    cMetPerBmi: e('cMetPerBmi'),
    cMetBmiRef: e('cMetBmiRef'),
    cMetBmiLo: e('cMetBmiLo'),
    cMetBmiHi: e('cMetBmiHi'),
    fComp: Math.exp(-1 / e('tauComp')),
    compCapFrac: e('compCapFrac'),
    enetWindow: Math.max(1, Math.round(e('enetWindowD'))),
    phiC: e('phiC'),
    gngCost: e('gngCost'),
    neat0FloorFrac: e('neat0FloorFrac'),
    habitRtMet: e('habitRtMet'),
    habitCardioMet: e('habitCardioMet'),
    lutealMeanPrior: e('lutealMeanPrior'),
    alphaMixMinEiFrac: e('alphaMixMinEiFrac'),
    fastHoldEps: e('fastHoldEps'),
    calibDays: Math.max(1, Math.round(e('burnInCalibDays'))),
    day0ActivityDelta: ctx.schedule?.days?.[0]?.activityDeltaKcal ?? 0,
    // a_lut belongs to moderators (MODEL_SPEC §1.1 `lutealAmp`); energy applies it to RMR (§1.5 step 2).
    aLut: lutIdx === undefined ? 0 : (ctx.params.values[lutIdx] as number),
    checks: ctx.checks,
  };
}

/** Non-alcohol label energy (engine convention, §0.2) of a macro set, kcal. MCT is part of fat and counted at 8.3. */
export function nonAlcoholEnergy(pG: number, cG: number, fG: number, mctG: number, fibG: number): number {
  const mct = mctG < 0 ? 0 : mctG > fG ? fG : mctG;
  return E_P * pG + E_C * cG + E_F * (fG - mct) + E_MCT * mct + E_FIB * fibG;
}

/** TEF-weighted non-alcohol energy (02 §4.4 without m_IR), kcal. */
export function nonAlcoholTef(k: EnergyK, pG: number, cG: number, fG: number, mctG: number, fibG: number): number {
  const mct = mctG < 0 ? 0 : mctG > fG ? fG : mctG;
  return (
    k.tefP * E_P * pG +
    k.tefC * E_C * cG +
    k.tefF * E_F * (fG - mct) +
    k.tefMct * E_MCT * mct +
    k.tefFibre * E_FIB * fibG
  );
}

/**
 * Habitual exercise EAT0, kcal/d. Uses `ResolvedProfile.eat0Kcal` when the core exposes it (contract request), else the
 * same habits formula as core/resolveProfile: sessions/wk × 1 h × (MET_mix − 1) × BW / 7 (10 §4.1, 09 §4.13).
 */
export function habitualEat0(p: ResolvedProfile, k: EnergyK): number {
  const exposed = (p as ResolvedProfile & { eat0Kcal?: number }).eat0Kcal;
  if (exposed !== undefined && Number.isFinite(exposed)) return Math.max(0, exposed);
  const h = p.habits;
  const mix = clamp(h.lifingCardioMix, 0, 1);
  const met = k.habitRtMet * (1 - mix) + k.habitCardioMet * mix;
  return Math.max(0, (h.sessionsPerWeek * (met - 1) * p.weightKg) / 7);
}

/**
 * End-of-burn-in re-anchoring (ruling on review B3(b), MODEL_SPEC §1.5 / §3.4). Means over the calibration days
 * (the last min(7, burnInDays) burn-in days = one habitual week):
 * EI0 := mean EI (Σ eAbsKcalH); EAT0 := mean realised EAT when > 0 (habitual sessions present in burn-in), else the
 * analytic EAT0; NEAT0 += EI0 − [mean(TEE_pre + DNL heat − EAT) − mean mass-dependent TEE] − EAT0, so that the model TEE
 * at the *reference* masses equals EI0 (every term the analytic TDEE0 misses — post-RT REE, EPOC, session cost net of own
 * RMR, TEF of fibre/alcohol, GNG baseline — is absorbed once). The mass-dependent TEE (RMR γ-terms, NEAT·BW/BW0) is
 * removed because composition re-anchors FM/LT to the profile at the same boundary: without it, burn-in drift of a
 * mis-calibrated person would be frozen into NEAT0 and re-appear as a drift after t = 0. α_mix0 := mean TEF / mean EI.
 * AT, compensation and the E_net ring restart from 0. Returns the NEAT0 change, kcal/d (0 when nothing was calibrated).
 * Runs once (allocation-free anyway).
 */
export function calibrateBurnIn(s: EnergyState, k: EnergyK): number {
  s.atR = 0;
  s.atN = 0;
  s.compKcalD = 0;
  s.enetRing.fill(0);
  s.enetSum = 0;
  s.calDeltaNeat = 0;
  if (s.calN <= 0) return 0;
  const ei = s.calEi / s.calN;
  if (!(ei > 0)) return 0;
  const eat = s.calEat / s.calN;
  const teeNoEat = (s.calTeeNoEat - s.calMass) / s.calN;
  if (eat > 0) s.eat0 = eat;
  const neat = s.neat0 + ei - teeNoEat - s.eat0;
  const floor = k.neat0FloorFrac * s.rmr0;
  const neatNew = neat > floor ? neat : floor;
  const delta = neatNew - s.neat0;
  s.neat0 = neatNew;
  s.ei0 = ei;
  s.tef0 = s.calTef / s.calN;
  s.alpha0 = s.tef0 / ei;
  s.calDeltaNeat = delta;
  return delta;
}

/**
 * Instantaneous maintenance EI_inst (02 §4.13) from the current day-level terms.
 *  - `maintenanceKcalD` (bus): at the HABITUAL activity with the day's diet (TEF share α_mix, protein term
 *    k_P·(P_eff − P0)) — the base to which the loop adds the day's R-MAINT activity adjustment for 'current'/'blockStart'
 *    days, so "100 % of current maintenance" is weight-stable for the eaten diet too.
 *  - `maintenance` metric (hx[maintSchedKcal], final-round definition): the energy that holds the CURRENT body
 *    weight-stable at the SCHEDULED activity = [RMR_mass + AT_R + comp)·(1 + luteal) + NEAT0·BW/BW0 + AT_N + EAT0 + GNG
 *    cost + Δ]/(1 − α0), Δ = `DayInput.activityDeltaKcal` (planned − habitual booked activity, averaged over the day's
 *    phase/week). It carries adaptive thermogenesis and the compensation state, so it falls as weight is lost and
 *    adaptation develops, but not the diet-composition terms (habitual TEF share α0, no protein term): at t = 0 it equals
 *    the static R-MAINT reference TDEE0 + Δ/(1 − α0) and it does not jump or ramp when a high-protein plan starts (QA:
 *    "+22/+38 kcal/d at the start of a deficit" was P_eff relaxing toward 2 g/kg with τ 2 d).
 */
function writeMaintenance(s: EnergyState, k: EnergyK, bus: SignalBus, alphaMix: number, bw: number, gngCostDay: number, activityDelta: number): void {
  const lut = 1 + s.lutealTerm;
  const rmrBody = s.hx[X_RMRMASSKCALD]! + s.atR + s.compKcalD;
  const neatHab = (s.neat0 * bw) / s.bw0 + s.atN;
  const denom = 1 - (alphaMix < 0.5 ? alphaMix : 0.5);
  bus.maintenanceKcalD = ((rmrBody + s.protTermKcalD) * lut + neatHab + s.eat0 + gngCostDay) / denom;
  const denom0 = 1 - (s.alpha0 < 0.5 ? s.alpha0 : 0.5);
  const body = (rmrBody * lut + neatHab + s.eat0 + gngCostDay) / denom0;
  s.hx[X_MAINTSCHEDKCAL] = body + (activityDelta === activityDelta ? activityDelta : 0) / denom0;
  s.hx[X_MAINTDENOM] = denom0;
  s.hx[X_MAINTBODYKCAL] = body;
  s.hx[X_MAINTDAYDONE] = 1;
  void k;
}

/**
 * `endBurnIn` hook (MODEL_SPEC §3.4, R-BURNIN): NEAT0 calibration, references FM0/FFM_act0/BW0 = profile values
 * (composition re-anchors the masses next, in module order), AT = comp = 0, P_eff = P0, and the day-0 inputs of the
 * other modules (maintenance at the reference masses, yesterday's TEE for `tdeeEstKcalD`) recomputed with the calibrated
 * NEAT0. Also called with burnInDays = 0 (no calibration then: n = 0).
 */
export function endBurnInEnergy(s: EnergyState, k: EnergyK, bus: SignalBus, ctx: ModuleContext): void {
  const lastMassDev = s.hx[X_DAYMASSDEVKCAL]! + s.neatMassDevKcalD;
  const dNeat = calibrateBurnIn(s, k);
  const p = ctx.profile;
  s.fm0 = p.fm0Kg;
  s.ffmAct0 = p.ffm0Kg;
  s.bw0 = p.fm0Kg + p.ffm0Kg;
  s.pEffG = s.protein0G;
  s.protTermKcalD = 0;
  s.hx[X_RMRMASSKCALD] = s.rmr0;
  if ((ctx.burnInDays ?? 0) > 0) s.prevDayTeeKcal += dNeat - lastMassDev;
  writeMaintenance(s, k, bus, s.alpha0, s.bw0, 0, 0);
  // the t = 0 value of the `maintenance` metric adds day 0's planned activity in recordDay (k.day0ActivityDelta, R-MAINT)
  s.hx[X_MAINTDAYDONE] = 0;
  bus.atKcalD = 0;
  s.calN = 0;
  s.calEi = 0;
  s.calTeeNoEat = 0;
  s.calEat = 0;
  s.calTef = 0;
  s.calMass = 0;
}

export const energyModule = defineModule<EnergyState, EnergyK>({
  id: 'energy',
  specSection: '§1.5',
  dossiers: '02 §4.1-4.13; 10 §4.3; 11 §4.5-4.6; 15 §4.10-4.11; 20 §4.2',
  params: ENERGY_PARAMS,
  reads: [
    'exEEKcalH', 'stepsExtraKcalH', 'exPlannedKcalD', 'eAbsKcalH', 'alcOxGH', 'caffeineLoadMg', 'fastRmrMult', 'fastActive',
    'ffmActKg', 'fatMassKg', 'leanTissueKg', 'tissueMassKg', 'smRtKg', 'gngGH', 'dnlHeatKcalH', 'depositionCostKcalH',
    'insulinResistanceIdx', 'lutealWeight', 'ageYears',
  ],
  writes: ['teePreKcalH', 'rmrKcalH', 'atKcalD', 'maintenanceKcalD', 'tdeeEstKcalD'],
  records: ['tdee', 'rmr', 'neat', 'metabolicAdaptation', 'energyBalance', 'maintenance', 'tef', 'atResting', 'atNonResting'],

  prepare: prepareEnergy,

  init: (k, ctx, bus) => {
    const p = ctx.profile;
    const rmr0 = p.rmr0Kcal;
    const tdee0 = p.tdee0Kcal;
    const bw0 = p.fm0Kg + p.ffm0Kg;
    const alcG = (p.habits.habitualAlcoholDrinksPerWeek * DEFAULTS.gramsPerDrink) / 7;
    const eNa0 = nonAlcoholEnergy(p.habitualProteinG, p.habitualCarbG, p.habitualFatG, 0, p.habitualFibreG);
    const tNa0 = nonAlcoholTef(k, p.habitualProteinG, p.habitualCarbG, p.habitualFatG, 0, p.habitualFibreG);
    const tef0 = tNa0 + k.tefAlc * E_ALC * alcG;
    const alpha0 = tdee0 > 0 ? tef0 / tdee0 : 0;
    const alphaNa0 = eNa0 > 0 ? tNa0 / eNa0 : 0;
    const eat0 = habitualEat0(p, k);
    const neat0 = Math.max(k.neat0FloorFrac * rmr0, tdee0 - rmr0 - tef0 - eat0);

    // luteal ring: one cycle; prior s̄ = 0.5 for a tracked female cycle, else 0 (observations replace the prior)
    const cycLen = clamp(Math.round(p.cycle.cycleLengthD ?? 28), 1, LUTEAL_RING_MAX);
    const tracked = p.sex === 'female' && p.cycle.tracking && p.menopause !== 'post';
    const prior = tracked ? k.lutealMeanPrior : 0;
    const lutealRing = new Float64Array(LUTEAL_RING_MAX);
    for (let i = 0; i < cycLen; i++) lutealRing[i] = prior;

    const gng0H = new Float64Array(24).fill(bus.gngGH);
    const hx = new Float64Array(N_HX);
    hx[X_RMRH] = rmr0 / 24;
    hx[X_RMRMASSKCALD] = rmr0;

    bus.teePreKcalH = (tdee0 - eat0) / 24;
    bus.rmrKcalH = rmr0 / 24;
    bus.maintenanceKcalD = tdee0;
    bus.tdeeEstKcalD = tdee0;
    bus.atKcalD = 0;

    return {
      rmr0,
      tdee0,
      ei0: tdee0,
      eiRefLabel: tdee0,
      neat0,
      eat0,
      tef0,
      alpha0,
      protein0G: p.habitualProteinG,
      carb0G: p.habitualCarbG,
      cafHabMg: p.habits.habitualCaffeineMg,
      steps0: p.habits.typicalSteps,
      ffmAct0: p.ffm0Kg,
      fm0: p.fm0Kg,
      bw0,
      height2: p.heightM * p.heightM,
      aLut: k.aLut,
      atR: 0,
      atN: 0,
      pEffG: p.habitualProteinG,
      compKcalD: 0,
      cafTol: 0,
      enetRing: new Float64Array(k.enetWindow),
      enetSum: 0,
      enetIdx: 0,
      lutealRing,
      lutealSum: prior * cycLen,
      lutealIdx: 0,
      lutealLen: cycLen,
      gng0H,
      gngDayH: new Float64Array(24).fill(bus.gngGH),
      lutealTerm: 0,
      protTermKcalD: 0,
      alphaNa: alphaNa0,
      thcFrac: 0,
      mIR: 1,
      cafDayKcal: 0,
      cafLoadRef: 0,
      cafPrevLoad: 0,
      cafPrevMg: 0,
      cafDayMg: 0,
      neatDayKcal: neat0,
      awakeRefH: 16,
      neatMassDevKcalD: 0,
      calN: 0,
      calEi: 0,
      calTeeNoEat: 0,
      calEat: 0,
      calTef: 0,
      calMass: 0,
      calDeltaNeat: 0,
      prevDayTeeKcal: tdee0,
      prevDayEatKcal: eat0,
      flagLowTdeeD: 0,
      hx,
    };
  },

  startDay: (s, k, bus, day) => {
    const hx = s.hx;
    // 1. luteal centring: s̄ = running mean of s(d) over one cycle (review M3)
    const sd = bus.lutealWeight;
    s.lutealSum += sd - s.lutealRing[s.lutealIdx]!;
    s.lutealRing[s.lutealIdx] = sd;
    s.lutealIdx = s.lutealIdx + 1 >= s.lutealLen ? 0 : s.lutealIdx + 1;
    const sBar = s.lutealSum / s.lutealLen;
    s.lutealTerm = s.aLut * (sd - sBar);

    // 2. protein turnover: P_eff relaxes (exact, τ_P) toward today's protein; clamp 0.4-3.5 g/kg (02 §4.5).
    //    Frozen while the fasting overlay is active (ruling on review M6: 20's fastRmrMult already contains the drop).
    if (bus.fastActive !== 1 && day.zeroIntake !== true) s.pEffG = day.proteinG + (s.pEffG - day.proteinG) * k.fP;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : s.bw0;
    const pEffC = clamp(s.pEffG, k.pMinPerKg * bw, k.pMaxPerKg * bw);
    const p0C = clamp(s.protein0G, k.pMinPerKg * s.bw0, k.pMaxPerKg * s.bw0);
    s.protTermKcalD = k.kP * (pEffC - p0C);

    // 3. TEF fraction of today's non-alcohol intake mix and TH_C (11 §4.5, only when EI > EI0)
    const eNa = nonAlcoholEnergy(day.proteinG, day.carbG, day.fatG, day.mctG, day.fibreG);
    if (eNa > 1) {
      s.alphaNa = nonAlcoholTef(k, day.proteinG, day.carbG, day.fatG, day.mctG, day.fibreG) / eNa;
      const extraCho = E_C * (day.carbG - s.carb0G);
      // 11 §4.5 EI_ref = maintenance intake; since R-MAINT that is the day's reference at the planned activity
      // (DayInput.maintenanceKcal; 1 kcal tolerance so that "100 %" never switches TH_C on by rounding)
      const mRef = day.maintenanceKcal;
      const eiRef = mRef === mRef && mRef > 0 ? mRef : s.eiRefLabel;
      s.thcFrac = day.energyKcal > eiRef + 1 && extraCho > 0 ? (k.phiC * extraCho) / eNa : 0;
    } else {
      s.thcFrac = 0; // keep α of the last day with intake for tails absorbed after midnight
    }
    const ir = bus.insulinResistanceIdx;
    s.mIR = 1 - k.tefIrSlope * (ir < 0 ? 0 : ir > 1 ? 1 : ir);

    // 4. caffeine term (R-CAFF): kCaff·(mg_d − mg_hab)·(1 − 0.5·Tol), shaped by the caffeine load
    const mg = day.caffeineMg > 0 ? day.caffeineMg : 0;
    s.cafDayMg = mg;
    s.cafDayKcal = k.kCaff * (mg - s.cafHabMg) * (1 - k.cafTolEffect * s.cafTol);
    s.cafLoadRef = mg > 0 && s.cafPrevMg > 0 && s.cafPrevLoad > 0 ? (s.cafPrevLoad * mg) / s.cafPrevMg : 0;
    hx[X_CAFPAID] = 0;

    // 5. NEAT of today (02 §4.6): NEAT0·BW/BW0 + AT_N over the waking hours; steps above baseline come from activity
    s.neatDayKcal = (s.neat0 * bw) / s.bw0 + s.atN;
    s.neatMassDevKcalD = s.neat0 * (bw / s.bw0 - 1);
    const awake = 24 - day.sleepHours;
    s.awakeRefH = awake < 1 ? 1 : awake > 24 ? 24 : awake;
    hx[X_NEATPAID] = 0;

    // 6. today's TDEE estimate (yesterday's TDEE with today's planned exercise)
    bus.tdeeEstKcalD = s.prevDayTeeKcal - s.prevDayEatKcal + bus.exPlannedKcalD;

    hx[X_ATRHELDTODAY] = 0;
    hx[X_FASTACTIVETODAY] = 0;
    hx[X_DAYEIKCAL] = 0;
    hx[X_DAYTEEKCAL] = 0;
    hx[X_DAYTEENODEPKCAL] = 0;
    hx[X_DAYEATKCAL] = 0;
    hx[X_DAYSTEPSEXTRAKCAL] = 0;
    hx[X_DAYTEFKCAL] = 0;
    hx[X_DAYRMRKCAL] = 0;
    hx[X_DAYNEATKCAL] = 0;
    hx[X_DAYGNGCOSTKCAL] = 0;
    hx[X_DAYCAFLOAD] = 0;
    hx[X_DAYMASSDEVKCAL] = 0;
  },

  stepHour: (s, k, bus, hour) => {
    const hx = s.hx;
    const h = hour.hourOfDay;
    const last = h === 23;

    // ---- RMR (02 §4.2, §4.3, §4.5, §4.8; 10 §4.3; 20 §4.2)
    const smRt = bus.smRtKg;
    const rmrMass =
      s.rmr0 + k.gammaL * (bus.ffmActKg - smRt - s.ffmAct0) + k.gammaSM * smRt + k.gammaF * (bus.fatMassKg - s.fm0);
    hx[X_RMRMASSKCALD] = rmrMass;
    const mult = bus.fastRmrMult;
    const fastOn = bus.fastActive === 1;
    const held = fastOn || mult - 1 > k.fastHoldEps || 1 - mult > k.fastHoldEps;
    if (held) hx[X_ATRHELDTODAY] = 1;
    if (fastOn) hx[X_FASTACTIVETODAY] = 1;
    const modMult = mult * (1 + s.lutealTerm);
    let rmrD = (rmrMass + (held ? 0 : s.atR) + s.protTermKcalD + s.compKcalD) * modMult;
    hx[X_DAYMASSDEVKCAL] = hx[X_DAYMASSDEVKCAL]! + ((rmrMass - s.rmr0) * modMult) / 24;
    if (rmrD < 0) rmrD = 0;
    if (rmrD < k.guardRmrFrac * s.rmr0) hx[X_FLAGLOWRMRH] = hx[X_FLAGLOWRMRH]! + 1;

    // caffeine: weight ∝ load (reference = yesterday's load per mg × today's dose), else flat; settle at hour 23
    const cafLoad = bus.caffeineLoadMg;
    const load = cafLoad > 0 ? cafLoad : 0;
    hx[X_DAYCAFLOAD] = hx[X_DAYCAFLOAD]! + load;
    let wc = s.cafLoadRef > 0 ? load / s.cafLoadRef : 1 / 24;
    if (hx[X_CAFPAID]! + wc > 1 || last) wc = 1 - hx[X_CAFPAID]!;
    hx[X_CAFPAID] = hx[X_CAFPAID]! + wc;
    const rmrH = rmrD / 24 + s.cafDayKcal * wc;

    // ---- TEF (02 §4.4; R-TEFTIME) and TH_C (11 §4.5) on energy appearing this hour
    const alcOx = bus.alcOxGH;
    const eAlc = alcOx > 0 ? E_ALC * alcOx : 0;
    const eAbs = bus.eAbsKcalH;
    let eNa = eAbs - eAlc;
    if (eNa < 0) eNa = 0;
    const tefH = s.mIR * (s.alphaNa * eNa + k.tefAlc * eAlc);
    const thcH = s.thcFrac * eNa;

    // ---- NEAT (02 §4.6): day amount over waking hours (capped running weight, settled at 23) + steps above baseline
    let wn = (1 - hour.asleep) / s.awakeRefH;
    if (hx[X_NEATPAID]! + wn > 1 || last) wn = 1 - hx[X_NEATPAID]!;
    hx[X_NEATPAID] = hx[X_NEATPAID]! + wn;
    const stepsX = bus.stepsExtraKcalH;
    let neatH = s.neatDayKcal * wn + stepsX;
    if (neatH < 0) neatH = 0;

    // ---- exercise (activity, net) and GNG cost (R-GNG; fuel's previous-hour flux vs the habitual hour profile)
    const eat = bus.exEEKcalH;
    const gng = bus.gngGH;
    s.gngDayH[h] = gng;
    const dG = gng - s.gng0H[h]!;
    const gngCostH = dG > 0 ? k.gngCost * dG * E_C : 0;

    let tee = rmrH + tefH + neatH + eat + thcH + gngCostH;
    if (tee < 0) tee = 0;
    bus.rmrKcalH = rmrH;
    bus.teePreKcalH = tee;

    hx[X_RMRH] = rmrH;
    hx[X_TEFH] = tefH;
    hx[X_NEATH] = neatH;
    hx[X_THCH] = thcH;
    hx[X_GNGCOSTH] = gngCostH;
    hx[X_DAYEIKCAL] = hx[X_DAYEIKCAL]! + eAbs;
    const dnlHeat = bus.dnlHeatKcalH;
    hx[X_DAYTEEKCAL] = hx[X_DAYTEEKCAL]! + tee + bus.depositionCostKcalH + dnlHeat;
    hx[X_DAYTEENODEPKCAL] = hx[X_DAYTEENODEPKCAL]! + tee + dnlHeat;
    hx[X_DAYEATKCAL] = hx[X_DAYEATKCAL]! + eat;
    hx[X_DAYSTEPSEXTRAKCAL] = hx[X_DAYSTEPSEXTRAKCAL]! + stepsX;
    hx[X_DAYTEFKCAL] = hx[X_DAYTEFKCAL]! + tefH;
    hx[X_DAYRMRKCAL] = hx[X_DAYRMRKCAL]! + rmrH;
    hx[X_DAYNEATKCAL] = hx[X_DAYNEATKCAL]! + neatH;
    hx[X_DAYGNGCOSTKCAL] = hx[X_DAYGNGCOSTKCAL]! + gngCostH;
  },

  endOfDay: (s, k, bus, day, clock) => {
    const hx = s.hx;
    // ---- adaptive thermogenesis (02 §4.8-4.9; R-AT, R-FAST-AT), exact daily exponentials.
    //      Burn-in (clock.day < 0) is the habitual reference state: AT and compensation stay 0 by definition, so the
    //      B3(b) calibration below sees a TEE free of both.
    const burnIn = clock.day < 0;
    const dEI = burnIn ? 0 : hx[X_DAYEIKCAL]! - s.ei0;
    const atStar = (dEI < 0 ? k.betaAT : k.betaATPlus) * dEI;
    const atRStar = (1 - k.sigmaAT) * atStar;
    const atNStar = k.sigmaAT * atStar;
    if (hx[X_ATRHELDTODAY]! === 0) {
      const fR = Math.abs(atRStar) > Math.abs(s.atR) ? k.fROn : k.fOff;
      s.atR = atRStar + (s.atR - atRStar) * fR;
    }
    const fN = Math.abs(atNStar) > Math.abs(s.atN) ? k.fNOn : k.fOff;
    s.atN = atNStar + (s.atN - atNStar) * fN;
    const atTot = s.atR + s.atN;
    const atLim = k.atGuardFrac * s.tdee0;
    if (atTot > atLim || atTot < -atLim) {
      const sc = atLim / Math.abs(atTot);
      s.atR *= sc;
      s.atN *= sc;
    }

    // ---- metabolic exercise compensation (10 §4.3; R-COMP)
    const enetDay = hx[X_DAYEATKCAL]! + hx[X_DAYSTEPSEXTRAKCAL]! - s.eat0;
    s.enetSum += enetDay - s.enetRing[s.enetIdx]!;
    s.enetRing[s.enetIdx] = enetDay;
    s.enetIdx = s.enetIdx + 1 >= s.enetRing.length ? 0 : s.enetIdx + 1;
    const enetMean = s.enetSum / s.enetRing.length;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : s.bw0;
    const bmi = bw / s.height2;
    let cMet = k.cMet + k.cMetPerBmi * clamp(bmi - k.cMetBmiRef, k.cMetBmiLo, k.cMetBmiHi);
    if (cMet < 0) cMet = 0;
    const want = cMet * (enetMean > 0 ? enetMean : 0);
    const cap = k.compCapFrac * (hx[X_RMRMASSKCALD]! > 0 ? hx[X_RMRMASSKCALD]! : 0);
    const compTarget = -(want < cap ? want : cap);
    if (hx[X_FASTACTIVETODAY]! === 0 && !burnIn) s.compKcalD = compTarget + (s.compKcalD - compTarget) * k.fComp;

    // ---- caffeine tolerance (15 §4.11) and load reference for tomorrow
    const tolTarget = s.cafDayMg >= k.cafTolMg ? 1 : 0;
    s.cafTol = tolTarget + (s.cafTol - tolTarget) * k.fCafTol;
    s.cafPrevLoad = hx[X_DAYCAFLOAD]!;
    s.cafPrevMg = s.cafDayMg;

    // ---- GNG baseline profile: latch the last burn-in (habitual) day
    if (clock.day === -1) for (let h = 0; h < 24; h++) s.gng0H[h] = s.gngDayH[h]!;

    // ---- burn-in calibration (review B3(b)): last ≤ 7 habitual days → EI0, EAT0, α_mix0, NEAT0; restart AT/comp at 0
    if (clock.day < 0 && clock.day >= -k.calibDays) {
      s.calN++;
      s.calEi += hx[X_DAYEIKCAL]!;
      s.calTeeNoEat += hx[X_DAYTEENODEPKCAL]! - hx[X_DAYEATKCAL]!;
      s.calEat += hx[X_DAYEATKCAL]!;
      s.calTef += hx[X_DAYTEFKCAL]!;
      s.calMass += hx[X_DAYMASSDEVKCAL]! + s.neatMassDevKcalD;
    }

    // ---- validity flag TDEE < 1.1·RMR (02 §9)
    if (hx[X_DAYTEEKCAL]! < k.guardTdeeRmr * hx[X_DAYRMRKCAL]!) s.flagLowTdeeD++;

    // ---- instantaneous maintenance EI_inst (02 §4.13) at habitual activity, AT frozen, excl. fastRmrMult/caffeine
    const alphaMix = hx[X_DAYEIKCAL]! > k.alphaMixMinEiFrac * s.ei0 ? hx[X_DAYTEFKCAL]! / hx[X_DAYEIKCAL]! : s.alpha0;
    writeMaintenance(s, k, bus, alphaMix, bw, hx[X_DAYGNGCOSTKCAL]!, clock.day < 0 ? 0 : (day.activityDeltaKcal ?? 0));
    bus.atKcalD = s.atR + s.atN;

    s.prevDayTeeKcal = hx[X_DAYTEEKCAL]!;
    s.prevDayEatKcal = hx[X_DAYEATKCAL]!;

    if (k.checks) {
      if (!Number.isFinite(bus.maintenanceKcalD) || !Number.isFinite(s.atR) || !Number.isFinite(s.atN) || !Number.isFinite(s.compKcalD)) {
        throw new Error(`energy: non-finite state on day ${clock.day}`);
      }
    }
  },

  endBurnIn: endBurnInEnergy,

  recordHour: (s, _k, bus, out) => {
    const hx = s.hx;
    const tdeeH = bus.teePreKcalH + bus.depositionCostKcalH + bus.dnlHeatKcalH;
    out[MI_TDEE] = tdeeH;
    out[MI_EB] = bus.eAbsKcalH - tdeeH;
    out[MI_RMR] = bus.rmrKcalH;
    out[MI_NEAT] = hx[X_NEATH]!;
    out[MI_TEF] = hx[X_TEFH]!;
  },

  recordDay: (s, k, _bus, out) => {
    const hx = s.hx;
    out[MI_MAINT] = hx[X_MAINTDAYDONE] === 1 ? hx[X_MAINTSCHEDKCAL]! : hx[X_MAINTBODYKCAL]! + k.day0ActivityDelta / hx[X_MAINTDENOM]!;
    out[MI_AT] = s.atR + s.atN;
    out[MI_ATR] = s.atR;
    out[MI_ATN] = s.atN;
  },
});
