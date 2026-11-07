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
 *  - Energy-only intake (D6-02, C3/C7): `DayInput.unallocatedKcal` is reported ME not explained by known grams. It stays in
 *    the day's energy (TEF follows the energy that appears, once; ME is the intake boundary, so nothing is deducted
 *    again) and gets the TEF fraction of the person's habitual P/C/F mix as a named design prior
 *    (`ENERGY_INTAKE_ASSUMPTIONS`), the non-protein part when the day's protein is fully known. Unknown protein is
 *    never a measured 0: when the day's protein is only a known lower bound (`proteinIsLowerBound`: an observed day's
 *    realised protein coverage first, then the exposure summary and the energy ledger), P_eff moves toward it only from below.
 *    TH_C counts known carbohydrate only (no carbohydrate is invented from unallocated energy).
 *  - Causal resolution (C2/D2-01): P_eff, the TEF mix, TH_C, the caffeine term, NEAT spread and tdeeEst read whole-day
 *    inputs at startDay, so every output is daily-native (`ENERGY_CAUSAL_RESOLUTION`).
 *  - Daily TEE endpoint correction (D1-01): energy runs before fuel (DNL heat) and composition (signed deposition cost) in
 *    the hour, so its stepHour sums the previous hour's c = DNL heat + deposition: the day's lagged sum is
 *    c(day before, 23:00) + Σ c(0..22). endOfDay adds c(23:00) − c(incoming), captured at startDay, so the internal daily
 *    TEE (tdeeEst tomorrow, the low-TDEE flag, the burn-in calibration) equals the recorded current-hour ledger exactly;
 *    the no-deposition sum is corrected by the DNL endpoint only. No module is reordered and no parameter is added.
 *  - Exercise compensation (D1-07): no BMI slope. The RMR response is a structural scenario (`cMet`, never drawn): the
 *    nominal zero-RMR-response reference or the named legacy scenario (`ENERGY_STRUCTURAL_SCENARIOS`).
 *  - Luteal centring (D8-07): the cycle mean s̄ starts at the tracked-cycle prior only when the calendar phase can be
 *    estimated (same criteria as moderators plus a regular cycle); otherwise it starts at the first value moderators emit,
 *    so an unknown/irregular phase (a constant phase-average or 0) gives a zero RMR deviation, never a follicular offset.
 */
import { defineModule } from '../../core/moduleKit';
import { ATWATER, DEFAULTS } from '../../core/defaults';
import type { CausalResolution, HistoryAssumptionKind, UncertaintyKind } from '@/lib/bodyContracts';
import { MI, type SeriesId } from '../../types/metrics';
import type { ModuleContext } from '../../types/module';
import { NUTRIENT_UNKNOWN_BIT, type DayInput } from '../../types/inputs';
import type { ModuleId, SignalBus, SignalName } from '../../types/signals';
import type { ResolvedProfile } from '../../types/profile';
import type { ModelParams } from '../../types/params';
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
  /** Height squared, m² (kept in the state shape; the c_met BMI slope it served was removed, D1-07). */
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
  /**
   * D8-07: 1 once s̄ has its starting value. A tracked (estimable) cycle starts at the prior (init); otherwise the ring is
   * seeded at the first startDay with the value moderators emit, so a constant phase-average has zero deviation.
   */
  lutealSeeded: number;
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
  /** D6-02: today's energy-only intake not allocated to macros (`DayInput.unallocatedKcal`), kcal. */
  unallocKcal: number;
  /** D6-02: TEF fraction applied to `unallocKcal` today (habitual-mix design prior; 0 without unallocated energy). */
  alphaUnalloc: number;
  /** D6-02: 1 when today's protein is only a known lower bound (unknown remainder), else 0. */
  proteinLowerBound: number;
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
  /** Yesterday's TDEE (incl. deposition cost and DNL heat, endpoint-corrected, D1-01) and exercise EE, kcal/d. */
  prevDayTeeKcal: number;
  prevDayEatKcal: number;
  /**
   * D1-01: DNL heat and signed deposition cost on the bus at startDay, kcal/h — the previous day's 23:00 values (or the
   * end-of-burn-in values on day 0) that the first stepHour of the day sums in place of today's 23:00 values.
   */
  incomingDnlKcalH: number;
  incomingDepKcalH: number;
  /** D1-01: endpoint correction applied to the last closed day's TEE, kcal/d (diagnostics). */
  dayEndpointCorrKcal: number;

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
  /**
   * D6-02 design prior for unallocated (energy-only) intake: the TEF fraction of the person's habitual P/C/F mix (profile
   * macros at the general factors) and of its carbohydrate/fat part, used when the day's protein is fully known.
   */
  tefHabMix: number;
  tefHabMixNoProtein: number;
  tefIrSlope: number;
  kP: number;
  fP: number;
  pMinPerKg: number;
  pMaxPerKg: number;
  kCaff: number;
  fCafTol: number;
  cafTolMg: number;
  cafTolEffect: number;
  /** c_met of the run's structural scenario (D1-07; 0 = zero-RMR-response reference). No BMI slope. */
  cMet: number;
  /**
   * @deprecated D1-07: the causal BMI slope is removed; always 0 (whatever the registry vector says) so every reader of
   * these constants (core/activityReference) applies the same zero slope. The three BMI clamp constants are kept for those
   * readers' compatibility only.
   */
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
  /**
   * D8-07: 1 when the calendar phase can be estimated (`lutealCycleEstimable`): s̄ starts at the tracked-cycle prior;
   * 0 = unknown/irregular/untracked: s̄ starts at the first value moderators emit.
   */
  lutealTracked: number;
  /** Test mode: finite-value assertions. */
  checks: boolean;
}

function pv(ctx: ModuleContext, id: string): number {
  const i = ctx.params.index.get(id);
  if (i === undefined) throw new Error(`energy: unknown parameter "${id}"`);
  return ctx.params.values[i] as number;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * TEF fraction of an energy mix of protein/carbohydrate/fat at the general factors (02 §4.4 weights), or `fallback` when
 * the mix has no energy. Fibre, MCT and alcohol are excluded: they are known grams with their own terms (D6-02).
 */
function pcfTefFraction(tefP: number, tefC: number, tefF: number, pG: number, cG: number, fG: number, fallback: number): number {
  const eP = E_P * (pG > 0 ? pG : 0);
  const eC = E_C * (cG > 0 ? cG : 0);
  const eF = E_F * (fG > 0 ? fG : 0);
  const e = eP + eC + eF;
  return e > 0 ? (tefP * eP + tefC * eC + tefF * eF) / e : fallback;
}

export function prepareEnergy(ctx: ModuleContext): EnergyK {
  const e = (n: string): number => pv(ctx, `energy.${n}`);
  const lutIdx = ctx.params.index.get('moderators.lutealAmp');
  // D6-02 habitual-mix design prior. A resolved profile always has habitual macros; the carbohydrate-factor fallback
  // (inside the conditional envelope of `unallocatedTefFraction`) only serves profile-less estimator contexts
  // (core/activityReference), which never see unallocated energy.
  const p = ctx.profile as ResolvedProfile | undefined;
  const tefP = e('tefP');
  const tefC = e('tefC');
  const tefF = e('tefF');
  const tefHabMix = pcfTefFraction(tefP, tefC, tefF, p?.habitualProteinG ?? 0, p?.habitualCarbG ?? 0, p?.habitualFatG ?? 0, tefC);
  const tefHabMixNoProtein = pcfTefFraction(tefP, tefC, tefF, 0, p?.habitualCarbG ?? 0, p?.habitualFatG ?? 0, tefC);
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
    tefP,
    tefC,
    tefF,
    tefMct: tefF + e('tefMctExtra'),
    tefAlc: e('tefAlc'),
    tefFibre: e('tefFibre'),
    tefHabMix,
    tefHabMixNoProtein,
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
    cMetPerBmi: 0,
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
    lutealTracked: p !== undefined && lutealCycleEstimable(p, ctx.schedule?.startDate) ? 1 : 0,
    checks: ctx.checks,
  };
}

/**
 * D8-07: whether the calendar luteal phase can be estimated for this profile — the moderators module's tracking criteria
 * (female, tracking on, no hormonal contraception, not post-menopausal, a parseable last period start and start date)
 * plus a cycle not told as irregular/unknown. Anything else is an unknown phase: phase-average, mean-zero effects.
 */
export function lutealCycleEstimable(p: Pick<ResolvedProfile, 'sex' | 'cycle' | 'menopause'> & { input?: { sexUnspecified?: boolean } }, startDate: string | undefined): boolean {
  if (p.sex !== 'female' || p.input?.sexUnspecified === true) return false;
  const c = p.cycle;
  if (!c || !c.tracking || p.menopause === 'post') return false;
  if (c.contraception !== undefined && c.contraception !== 'none') return false;
  if (c.regularity === 'irregular' || c.regularity === 'unknown') return false;
  return isoDateOk(c.lastPeriodStart) && isoDateOk(startDate);
}

function isoDateOk(d: string | undefined): boolean {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));
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
 * D6-02/C1/C3: whether a day's protein total is only a known lower bound.
 *  1. An observed day's realised protein coverage (`DayInput.coverage`, the realised history's channel coverage) of
 *     `complete`, `confirmedZero` or `asPlannedEstimate` makes the day's protein its value (observed, zero, or the frozen
 *     prescription's estimate), even on an `energyOnly` day, whose unknown part is then carbohydrate/fat only.
 *  2. Otherwise the energy ledger decides: an `energyOnly` day has a meal whose macros, possibly protein, are unknown, so
 *     its known protein is a lower bound (a prescribed day's construction-scope `complete` exposure does not see that). On
 *     a `consistent` day the grams are known sums plus, on a partly logged day, the realised history's imputed remainder
 *     (a named scenario estimate, not a bound); a `conflict` day simulates its known grams.
 *  3. Without a ledger status, `partial` or `unknown` coverage is a lower bound, other coverage is exact, and otherwise
 *     unallocated energy counts as unknown macros.
 * Legacy days (none of these fields) are exact. A1-013: on an `energyOnly` day without a realised protein channel the
 * compiler's per-nutrient mask (`DayInput.nutrientUnknownMask`, which describes the analysis of the INCLUDED meals, not
 * missing meals) says whether the unknown part includes protein: a clear protein bit keeps a known protein total known
 * (the unknown part is carbohydrate/fat only); a realised partial/unknown protein channel still makes it a lower bound.
 */
export function proteinIsLowerBound(day: Pick<DayInput, 'coverage' | 'exposure' | 'energyStatus' | 'unallocatedKcal' | 'nutrientUnknownMask'>): boolean {
  const realised = day.coverage?.protein;
  if (realised === 'complete' || realised === 'confirmedZero' || realised === 'asPlannedEstimate') return false;
  if (day.energyStatus !== undefined) {
    if (day.energyStatus !== 'energyOnly') return false;
    const mask = day.nutrientUnknownMask;
    return !(realised === undefined && mask !== undefined && (mask & NUTRIENT_UNKNOWN_BIT.protein) === 0);
  }
  const cov = realised ?? day.exposure?.['protein']?.coverage;
  if (cov !== undefined) return cov === 'partial' || cov === 'unknown';
  const u = day.unallocatedKcal;
  return u !== undefined && u > 0;
}

/**
 * D6-02: TEF fraction applied to unallocated energy — the habitual-mix design prior — with its conditional algebraic
 * envelope: the all-carbohydrate/all-fat endpoints when protein is fully known (the restricted C/F family), the extreme
 * P/C/F factors otherwise. Endpoints are conditional scenarios over the general macronutrients, not probability bounds.
 */
export function unallocatedTefFraction(k: EnergyK, proteinKnown: boolean): { fraction: number; low: number; high: number } {
  const lo = k.tefC < k.tefF ? k.tefC : k.tefF;
  const hi = k.tefC > k.tefF ? k.tefC : k.tefF;
  const fraction = unallocatedTefMix(k, proteinKnown);
  if (proteinKnown) return { fraction, low: lo, high: hi };
  return { fraction, low: k.tefP < lo ? k.tefP : lo, high: k.tefP > hi ? k.tefP : hi };
}

/** The nominal of `unallocatedTefFraction` without allocating (hot path). */
function unallocatedTefMix(k: EnergyK, proteinKnown: boolean): number {
  return proteinKnown ? k.tefHabMixNoProtein : k.tefHabMix;
}

const KNOWN_CHANNEL = (c: string | undefined): boolean => c === 'complete' || c === 'confirmedZero';
const UNKNOWN_CHANNEL = (c: string | undefined): boolean => c === 'partial' || c === 'unknown';
const CARB_FAT_BITS = NUTRIENT_UNKNOWN_BIT.carbohydrate | NUTRIENT_UNKNOWN_BIT.fat;

/**
 * A1-013 (D6-02): some of the day's carbohydrate/fat allocation is unknown or a named scenario fill, so every output whose
 * equations read carbohydrate/fat grams, their appearance streams or the states they set is a conditional joint scenario
 * (the reported energy itself stays known and conserved). Order: an observed day's realised carbohydrate AND fat channels
 * complete/confirmed zero → known; an explicitly partial/unknown realised channel → unknown; else the compiler's
 * per-nutrient mask (analysis of the included meals; 'imputed' = scenario fill); else the energy ledger (`energyOnly`);
 * else unallocated energy (legacy). A complete-macro source-factor reconciliation (`consistent`, mask clear) is not unknown.
 */
export function carbFatAllocationUnknown(day: Pick<DayInput, 'coverage' | 'energyStatus' | 'unallocatedKcal' | 'nutrientUnknownMask'>): boolean {
  const c = day.coverage?.carbohydrate;
  const f = day.coverage?.fat;
  if (KNOWN_CHANNEL(c) && KNOWN_CHANNEL(f)) return false;
  if (UNKNOWN_CHANNEL(c) || UNKNOWN_CHANNEL(f)) return true;
  const mask = day.nutrientUnknownMask;
  if (mask !== undefined) return (mask & CARB_FAT_BITS) !== 0;
  if (day.energyStatus !== undefined) return day.energyStatus === 'energyOnly';
  const u = day.unallocatedKcal;
  return u !== undefined && u > 0;
}

/**
 * A1-013 (D6-02): some of the day's protein is unknown (a lower bound, `proteinIsLowerBound`) or the scenario value of an
 * imputed remainder (mask bit set): protein turnover, the lean/fat partition and amino-acid-driven outputs are
 * conditional. Missing protein is never zero or deficient protein.
 */
export function proteinIntakeUnknown(day: Pick<DayInput, 'coverage' | 'exposure' | 'energyStatus' | 'unallocatedKcal' | 'nutrientUnknownMask'>): boolean {
  const realised = day.coverage?.protein;
  if (realised === 'complete' || realised === 'confirmedZero' || realised === 'asPlannedEstimate') return false;
  if (UNKNOWN_CHANNEL(realised) || proteinIsLowerBound(day)) return true;
  const mask = day.nutrientUnknownMask;
  return mask !== undefined && (mask & NUTRIENT_UNKNOWN_BIT.protein) !== 0;
}

/**
 * Outputs whose equations read carbohydrate/fat grams, their appearance streams or the insulin/glycogen/DNL states they set
 * (A1-013 seeds; the shared dependency closure carries the rest): intake glucose/insulin; fuel glycogen, oxidation mix and
 * DNL; ketogenesis (insulin proxy, liver glycogen, 24-h carbohydrate); glycogen water and carbohydrate-sodium water; the
 * tissue energy residual (net of the glycogen energy change), carbohydrate in protein oxidation and fat type in the
 * visceral share, with the regional and nitrogen details of those masses; carbohydrate availability of leptin/T3/cortisol
 * and the diet composition of testosterone; cardiometabolic diet composition; insulin/glycogen/ketone cellular signals;
 * wellbeing carbohydrate/fat days and glycogen-dependent capacity; ketone-dependent hunger.
 */
export const CARB_FAT_DEPENDENT_SERIES = [
  'glucose', 'insulin',
  'glycogenTotal', 'liverGlycogen', 'muscleGlycogen', 'choOxidation', 'fatOxidation', 'dnl',
  'bhb', 'bhbEndpoint', 'totalKetones', 'ketosisState', 'hoursInKetosis', 'ketoAdaptation', 'ketoAdaptFast', 'ketoAdaptSlow',
  'glycogenWater', 'ecfShift', 'waterWeight', 'scaleWeight', 'leanMass', 'bodyFatPct',
  'fatMass', 'leanTissue', 'skeletalMuscle', 'visceralFat', 'waist', 'fatTrunk', 'fatArms', 'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk',
  'nitrogenBalance', 'fastProteinCost',
  'leptin', 't3', 'cortisol', 'testosterone',
  'triglycerides', 'ldl', 'apoB', 'hdl', 'liverFat', 'insulinSensitivity', 'fastingGlucose',
  'autophagyIdx', 'mtorIdx', 'ampkIdx',
  'ketoInduction', 'micronutrientScore', 'enduranceCapacity', 'hunger',
] as const satisfies readonly SeriesId[];

/**
 * Outputs whose equations read protein grams or amino-acid appearance (A1-013 seeds for unknown protein): turnover (P_eff →
 * RMR/TDEE/energy balance), the lean/fat partition with its scale, regional and nitrogen details, MPS and resistance
 * accretion, the insulin proxy and the ketogenesis protein brake, mTOR/autophagy, and the IGF-1/testosterone protein factors.
 */
export const PROTEIN_DEPENDENT_SERIES = [
  'rmr', 'tdee', 'energyBalance',
  'fatMass', 'leanTissue', 'skeletalMuscle', 'visceralFat', 'waist', 'fatTrunk', 'fatArms', 'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk',
  'nitrogenBalance', 'fastProteinCost', 'scaleWeight', 'leanMass', 'bodyFatPct',
  'mps', 'rtMuscleGain', 'strength',
  'insulin', 'bhb', 'bhbEndpoint', 'totalKetones', 'ketosisState', 'hoursInKetosis',
  'mtorIdx', 'autophagyIdx', 'igf1', 'testosterone',
] as const satisfies readonly SeriesId[];

/**
 * Named intake assumptions of this module (C6/D6-02), keyed by the id a run lists in `assumptions` on a day where it
 * applies (`unallocatedKcal > 0`, resp. `proteinIsLowerBound`). `series` = the energy outputs it enters directly that day;
 * substrate, partition and marker outputs are seeded by `INTAKE_KNOWLEDGE_ASSUMPTIONS` (A1-013) and close over the shared
 * dependency graph.
 */
export const ENERGY_INTAKE_ASSUMPTIONS = {
  /** TEF of unallocated energy at the habitual-mix fraction (envelope: `unallocatedTefFraction`). */
  unallocatedEnergyHabitualTefMix: { reasonCode: 'energyOnlyIntakeTefPrior', uncertaintyKind: 'scenario', series: ['tef', 'tdee', 'energyBalance'] },
  /** P_eff follows a partial protein total only upward, else holds (unknown protein is not zero intake). */
  proteinLowerBoundTurnover: { reasonCode: 'proteinLowerBoundOnly', uncertaintyKind: 'scenario', series: ['rmr', 'tdee', 'energyBalance'] },
} as const satisfies Record<string, { reasonCode: string; uncertaintyKind: UncertaintyKind; series: readonly SeriesId[] }>;

/**
 * A1-013 (D6-02, C6): intake-knowledge assumptions whose seeds reach outputs of other modules — the substrate- and
 * partition-dependent outputs of unknown carbohydrate/fat resp. unknown/imputed protein are a conditional joint scenario
 * from the first affected day (`intakeKnowledgeAssumptionFromDays`, independent of the energy-balance sign). Their finite
 * numbers stay as the compatibility trajectory (unallocated energy appears as energy only, never as a named glucose,
 * amino-acid or fat stream); the known intake totals stay usable; no coefficient is added. `series` = seeds (the outputs
 * whose equations read the nutrient); further dependants close over them through the shared dependency graph.
 */
export const INTAKE_KNOWLEDGE_ASSUMPTIONS = {
  /** Unknown carbohydrate/fat allocation (energy-only or partly analysed intake). */
  carbFatAllocationUnknown: { reasonCode: 'carbFatAllocationUnknown', uncertaintyKind: 'scenario', series: CARB_FAT_DEPENDENT_SERIES },
  /** Unknown or imputed protein (lower bound or scenario fill; never zero or deficient). */
  proteinIntakeUnknown: { reasonCode: 'proteinIntakeUnknown', uncertaintyKind: 'scenario', series: PROTEIN_DEPENDENT_SERIES },
} as const satisfies Record<string, { reasonCode: string; uncertaintyKind: UncertaintyKind; series: readonly SeriesId[] }>;

export type EnergyIntakeAssumptionId = keyof typeof ENERGY_INTAKE_ASSUMPTIONS;
export type IntakeKnowledgeAssumptionId = keyof typeof INTAKE_KNOWLEDGE_ASSUMPTIONS;

/** Whether a named intake assumption applies on a compiled day (the predicate a run uses to find its first day). */
export function energyIntakeAssumptionApplies(id: EnergyIntakeAssumptionId | IntakeKnowledgeAssumptionId, day: DayInput): boolean {
  switch (id) {
    case 'unallocatedEnergyHabitualTefMix':
      return (day.unallocatedKcal ?? 0) > 0;
    case 'proteinLowerBoundTurnover':
      return proteinIsLowerBound(day);
    case 'carbFatAllocationUnknown':
      return carbFatAllocationUnknown(day);
    case 'proteinIntakeUnknown':
      return proteinIntakeUnknown(day);
  }
}

/**
 * First day each A1-013 intake-knowledge assumption applies over the whole horizon (absent = never), so a resumed run
 * reports the same first day and reason. Allocation allowed (finalize).
 */
export function intakeKnowledgeAssumptionFromDays(days: readonly DayInput[]): Partial<Record<IntakeKnowledgeAssumptionId, number>> {
  const out: Partial<Record<IntakeKnowledgeAssumptionId, number>> = {};
  for (const id of Object.keys(INTAKE_KNOWLEDGE_ASSUMPTIONS) as IntakeKnowledgeAssumptionId[]) {
    for (let d = 0; d < days.length; d++) {
      if (energyIntakeAssumptionApplies(id, days[d]!)) {
        out[id] = d;
        break;
      }
    }
  }
  return out;
}

/**
 * Causal-resolution declaration (C2/D2-01): whole-day inputs read at startDay and the outputs inheriting that daily-native
 * resolution. `planMetadataReads` lists plan-derived fast fields the module still reads (`zeroIntake` freezes P_eff, M6):
 * on an observed day the compiler derives it from realised intake only (an observed or censored fast ends at the first
 * verified intake; a confirmed-zero day), so a planned length or label never reaches it there. Declarative only; nothing
 * here changes physiology.
 */
export const ENERGY_CAUSAL_RESOLUTION = {
  module: 'energy',
  nativeResolution: 'daily',
  dailyInputs: [
    'proteinG', 'carbG', 'fatG', 'mctG', 'fibreG', 'unallocatedKcal', 'energyStatus', 'coverage', 'exposure', 'energyKcal', 'maintenanceKcal',
    'caffeineMg', 'sleepHours', 'activityDeltaKcal',
  ],
  dayStartSignals: ['exPlannedKcalD', 'lutealWeight', 'insulinResistanceIdx', 'tissueMassKg', 'fastActive'],
  planMetadataReads: ['zeroIntake'],
  series: ['tdee', 'rmr', 'neat', 'tef', 'energyBalance', 'maintenance', 'metabolicAdaptation', 'atResting', 'atNonResting'],
  signals: ['teePreKcalH', 'rmrKcalH', 'atKcalD', 'maintenanceKcalD', 'tdeeEstKcalD'],
  assumption: 'dailyNativeModel',
  reasonCode: 'dailyNativeEnergyTerms',
} as const satisfies {
  module: ModuleId;
  nativeResolution: CausalResolution;
  dailyInputs: readonly (keyof DayInput)[];
  dayStartSignals: readonly SignalName[];
  planMetadataReads: readonly (keyof DayInput)[];
  series: readonly SeriesId[];
  signals: readonly SignalName[];
  assumption: HistoryAssumptionKind;
  reasonCode: string;
};

/**
 * Named structural scenarios of this module (D1-07, C6/C7). A scenario fixes structural parameters (all `draw: 'fixed'`
 * in the registry, so a parameter draw never moves them): apply it to the nominal vector and to every drawn member with
 * `applyEnergyStructuralScenario`, so the scenario survives the draws. Scenarios are alternatives, never a weighted
 * mixture: a range spanning both is a structural (scenario) range with no probability or coverage claim.
 */
export const ENERGY_STRUCTURAL_SCENARIOS = {
  exerciseCompensation: {
    /** Nominal reference: no RMR response to added activity (intake, NEAT and AT remain separate pathways). */
    zeroRmrResponse: {
      values: { 'energy.cMet': 0 },
      reasonCode: 'exerciseCompensationZeroRmrReference',
      uncertaintyKind: 'scenario',
    },
    /** Legacy heuristic: target −min(0.15·max(mean7 added activity, 0), 0.05·RMR), τ 14 d. Not full plausible coverage. */
    legacyRmrResponse: {
      values: { 'energy.cMet': 0.15, 'energy.tauComp': 14, 'energy.compCapFrac': 0.05 },
      reasonCode: 'exerciseCompensationLegacyRmrScenario',
      uncertaintyKind: 'scenario',
    },
  },
} as const satisfies Record<string, Record<string, { values: Readonly<Record<string, number>>; reasonCode: string; uncertaintyKind: UncertaintyKind }>>;

export type EnergyCompensationScenario = keyof typeof ENERGY_STRUCTURAL_SCENARIOS.exerciseCompensation;

/** Nominal structural scenario of the exercise-compensation choice (the registry nominal). */
export const ENERGY_NOMINAL_COMPENSATION_SCENARIO: EnergyCompensationScenario = 'zeroRmrResponse';

/**
 * Copy of `values` (a full registry vector of `params`) with the exercise-compensation scenario applied (D1-07). Use on
 * the nominal vector and on each ensemble member; only the scenario's fixed structural entries change. Allocation is fine
 * (never inside the step loop).
 */
export function applyEnergyStructuralScenario(params: Pick<ModelParams, 'index'>, values: Float64Array, scenario: EnergyCompensationScenario): Float64Array {
  const out = Float64Array.from(values);
  for (const [id, v] of Object.entries(ENERGY_STRUCTURAL_SCENARIOS.exerciseCompensation[scenario].values)) {
    const i = params.index.get(id);
    if (i === undefined) throw new Error(`energy scenario: unknown parameter "${id}"`);
    out[i] = v;
  }
  return out;
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

    // luteal ring: one cycle; prior s̄ = 0.5 for an estimable (tracked, regular) cycle (observations replace the prior).
    // D8-07: otherwise the ring is seeded at the first startDay with the value moderators emit (phase-average/constant).
    const cycLen = clamp(Math.round(p.cycle.cycleLengthD ?? 28), 1, LUTEAL_RING_MAX);
    const tracked = k.lutealTracked === 1;
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
      lutealSeeded: tracked ? 1 : 0,
      gng0H,
      gngDayH: new Float64Array(24).fill(bus.gngGH),
      lutealTerm: 0,
      protTermKcalD: 0,
      alphaNa: alphaNa0,
      unallocKcal: 0,
      alphaUnalloc: 0,
      proteinLowerBound: 0,
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
      incomingDnlKcalH: bus.dnlHeatKcalH,
      incomingDepKcalH: bus.depositionCostKcalH,
      dayEndpointCorrKcal: 0,
      flagLowTdeeD: 0,
      hx,
    };
  },

  startDay: (s, k, bus, day) => {
    const hx = s.hx;
    // 0. D1-01: the DNL heat / deposition cost this day's first stepHour will sum (written by fuel/composition last hour)
    s.incomingDnlKcalH = bus.dnlHeatKcalH;
    s.incomingDepKcalH = bus.depositionCostKcalH;

    // 1. luteal centring: s̄ = running mean of s(d) over one cycle (review M3). D8-07: an unknown/irregular phase seeds
    //    the ring with the first emitted value, so a constant phase-average (or 0) never yields a follicular/luteal offset.
    const sd = bus.lutealWeight;
    if (s.lutealSeeded === 0) {
      for (let i = 0; i < s.lutealLen; i++) s.lutealRing[i] = sd;
      s.lutealSum = sd * s.lutealLen;
      s.lutealSeeded = 1;
    }
    s.lutealSum += sd - s.lutealRing[s.lutealIdx]!;
    s.lutealRing[s.lutealIdx] = sd;
    s.lutealIdx = s.lutealIdx + 1 >= s.lutealLen ? 0 : s.lutealIdx + 1;
    const sBar = s.lutealSum / s.lutealLen;
    s.lutealTerm = s.aLut * (sd - sBar);

    // 2. protein turnover: P_eff relaxes (exact, τ_P) toward today's protein; clamp 0.4-3.5 g/kg (02 §4.5).
    //    Frozen while the fasting overlay is active (ruling on review M6: 20's fastRmrMult already contains the drop).
    //    D6-02: when today's protein is only a known lower bound, the true target is ≥ that bound, so P_eff follows it
    //    upward only and otherwise holds (an unknown remainder is not zero protein).
    const protLb = proteinIsLowerBound(day);
    s.proteinLowerBound = protLb ? 1 : 0;
    const pDay = day.proteinG;
    if (bus.fastActive !== 1 && day.zeroIntake !== true && (!protLb || pDay > s.pEffG)) s.pEffG = pDay + (s.pEffG - pDay) * k.fP;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : s.bw0;
    const pEffC = clamp(s.pEffG, k.pMinPerKg * bw, k.pMaxPerKg * bw);
    const p0C = clamp(s.protein0G, k.pMinPerKg * s.bw0, k.pMaxPerKg * s.bw0);
    s.protTermKcalD = k.kP * (pEffC - p0C);

    // 3. TEF fraction of today's non-alcohol intake mix and TH_C (11 §4.5, only when EI > EI0). D6-02: the mix covers the
    //    known grams plus unallocated energy at the habitual-mix prior, so TEF_h = α·E_abs,h charges every kcal once.
    const ua = day.unallocatedKcal;
    const unalloc = ua !== undefined && ua > 0 ? ua : 0;
    const aU = unalloc > 0 ? unallocatedTefMix(k, !protLb) : 0;
    s.unallocKcal = unalloc;
    s.alphaUnalloc = aU;
    const eNa = nonAlcoholEnergy(day.proteinG, day.carbG, day.fatG, day.mctG, day.fibreG) + unalloc;
    if (eNa > 1) {
      s.alphaNa = (nonAlcoholTef(k, day.proteinG, day.carbG, day.fatG, day.mctG, day.fibreG) + aU * unalloc) / eNa;
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
    // ---- D1-01 endpoint correction, before every end-of-day consumer: the lagged hourly sum holds c(incoming) in place of
    //      c(23:00), c = DNL heat + signed deposition cost (kcal/h summed to kcal/d). Exact telescoping identity.
    const corrNoDep = bus.dnlHeatKcalH - s.incomingDnlKcalH;
    const corr = corrNoDep + bus.depositionCostKcalH - s.incomingDepKcalH;
    hx[X_DAYTEEKCAL] = hx[X_DAYTEEKCAL]! + corr;
    hx[X_DAYTEENODEPKCAL] = hx[X_DAYTEENODEPKCAL]! + corrNoDep;
    s.dayEndpointCorrKcal = corr;

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

    // ---- metabolic exercise compensation (10 §4.3; R-COMP). D1-07: structural c_met, no BMI slope (cross-sectional
    //      adiposity associations do not identify a within-person BMI-caused RMR response). c_met 0 = reference.
    const enetDay = hx[X_DAYEATKCAL]! + hx[X_DAYSTEPSEXTRAKCAL]! - s.eat0;
    s.enetSum += enetDay - s.enetRing[s.enetIdx]!;
    s.enetRing[s.enetIdx] = enetDay;
    s.enetIdx = s.enetIdx + 1 >= s.enetRing.length ? 0 : s.enetIdx + 1;
    const enetMean = s.enetSum / s.enetRing.length;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : s.bw0;
    const cMet = k.cMet > 0 ? k.cMet : 0;
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
