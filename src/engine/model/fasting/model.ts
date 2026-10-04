/**
 * Fasting-module model: prepared constants, pure equations and the hourly step (docs/MODEL_SPEC.md §1.4; dossier 20
 * §4.2, §4.3.4, §4.4.2, §4.5.2, §4B.1). Everything the hot path calls lives in this one file so calls stay local
 * (no cross-module bindings per step). All functions are allocation-free; the unit tests and other modules'
 * calibration tests (ketones: `bhbRefMmolL`) share this implementation.
 */
import { G_PROTEIN_PER_G_N, HOURS_PER_DAY, RHO, ZERO_INTAKE_KCAL } from '../../core/defaults';
import { param } from '../../core/paramsRegistry';
import type { DayInput, HourInput } from '../../types/inputs';
import type { EventSink, StepClock } from '../../types/module';
import type { ModelParams } from '../../types/params';

/** Prepared constants (read from ModelParams once per run; decay factors precomputed, §0.3). */
export interface FastingConstants {
  // criteria (20 §4.1, §2)
  fastKcalFrac: number;
  fastProteinMaxG: number;
  fastCarbMaxG: number;
  modKcalFrac: number;
  /** 1 for every absolute hour inside a planned zero-intake span of ≥ plannedMinSpanH (review M7); length nDays·24. */
  longPlanMask: Uint8Array;
  /** Intake event (20 §2): > 50 kcal (17 §2.5 ZERO_INTAKE_KCAL) or > protein/carb grams in an hour. */
  eventKcal: number;
  eventProteinG: number;
  eventCarbG: number;
  /** g protein per g N (6.25, definitional). */
  gProtPerGN: number;
  // resting EE (20 §4.2)
  aSNS: number;
  /** d */
  tP: number;
  /** d */
  tLag: number;
  phiATIntercept: number;
  phiATSlope: number;
  phiATMin: number;
  phiATMax: number;
  phiATShift: number;
  /** exp(−1 h/τ_AT) and the hour-mean factor τ_AT,h·(1 − f) (on / off). */
  fATon: number;
  gATon: number;
  fAToff: number;
  gAToff: number;
  // protein / N (20 §4.4.2, §4.4.4)
  nPkLean: number;
  nPkObDrop: number;
  nPkFmRefKg: number;
  nPkFmSpanKg: number;
  prLateBase: number;
  prLateAmp: number;
  prLateBfScale: number;
  prLateMult: number;
  sparingBhbOnset: number;
  sparingBhbSpan: number;
  fN: number;
  gN: number;
  fNoff: number;
  gNoff: number;
  fNoffLC: number;
  gNoffLC: number;
  lowCarbOffG: number;
  riseStart: number;
  riseDays: number;
  cCarb: number;
  carbRefG: number;
  kKet: number;
  ketExoRefMmolL: number;
  kEx: number;
  /** g N per kcal of oxidised protein: 1/(4.7 kcal/g × 6.25 g/g N) = 1/29.4 (20 §4.4.2). */
  nPerKcal: number;
  // labile pool (20 §4.9)
  /** L_max·FFM0, g protein. */
  lMaxG: number;
  /** exp(−1 h/τ_rep). */
  fRep: number;
  repEnergyFrac: number;
  repProteinGPerKg: number;
  // oedema (20 §4.5.2): E_oed = A·(1 − e^(−t/τr))·e^(−t/τd) as a pending pool P (rate 1/τr + 1/τd) feeding E (rate 1/τd)
  aOed: number;
  aOedCapL: number;
  oedMinFastD: number;
  /** exp(−1 h/τd) and exp(−1 h·(1/τr + 1/τd)). */
  fOd: number;
  fOc: number;
  oedLowMult: number;
  oedLowCarbG: number;
  oedLowNaMg: number;
  // BHB reference (calibration only)
  bhbRefB1: number;
  bhbRefB2: number;
  bhbRefTau2H: number;
  // run context
  events: EventSink | null;
  checks: boolean;
}

/** Hour-mean factor of a first-order relaxation over Δt = 1 h: mean = x* + (x0 − x*)·g, g = τ_h·(1 − e^(−1/τ_h)). */
const hourMeanFactor = (tauH: number): number => tauH * (1 - Math.exp(-1 / tauH));

/**
 * Planned zero-intake spans as compiled (absolute hours from t = 0, end exclusive). `mealToMealH` is the fast's duration
 * by the ruling of 2026-09-30 18:10 (last intake to first intake): a 24-h dinner-to-dinner fast compiles to a 23-h
 * zero-intake span and must still activate the overlay.
 */
export type PlannedSpans = ReadonlyArray<{ readonly startHour: number; readonly endHour: number; readonly mealToMealH?: number }>;

export interface FastingRunContext {
  ffm0Kg: number;
  nHours: number;
  fastSpans: PlannedSpans;
  events?: EventSink | null;
  checks?: boolean;
}

export function fastingConstants(p: ModelParams, run: FastingRunContext): FastingConstants {
  const v = (id: string): number => param(p, `fasting.${id}`);
  const minSpan = v('plannedMinSpanH');
  const longPlanMask = new Uint8Array(Math.max(0, run.nHours));
  for (const sp of run.fastSpans) {
    // duration = meal to meal (ruling 2026-09-30 18:10); the zero-intake span itself is one hour shorter
    const dur = sp.mealToMealH !== undefined && sp.mealToMealH > 0 ? sp.mealToMealH : sp.endHour - sp.startHour;
    if (dur < minSpan) continue;
    const a = Math.max(0, sp.startHour);
    const b = Math.min(longPlanMask.length, sp.endHour);
    for (let h = a; h < b; h++) longPlanMask[h] = 1;
  }
  const ffm0Kg = run.ffm0Kg;
  const tauATh = v('tauAT') * HOURS_PER_DAY;
  const tauAToffh = v('tauATOff') * HOURS_PER_DAY;
  const tauNh = v('tauN') * HOURS_PER_DAY;
  const tauNoffh = v('tauNOff') * HOURS_PER_DAY;
  const tauNoffLCh = v('tauNOffLowCarb') * HOURS_PER_DAY;
  const tauRiseD = v('oedRiseTauD');
  const tauDecayD = v('oedDecayTauD');
  return {
    fastKcalFrac: v('fastKcalFrac'),
    fastProteinMaxG: v('fastProteinMaxG'),
    fastCarbMaxG: v('fastCarbMaxG'),
    modKcalFrac: v('modKcalFrac'),
    longPlanMask,
    eventKcal: ZERO_INTAKE_KCAL,
    eventProteinG: v('eventProteinG'),
    gProtPerGN: G_PROTEIN_PER_G_N,
    eventCarbG: v('eventCarbG'),
    aSNS: v('aSNS'),
    tP: v('tP'),
    tLag: v('tLag'),
    phiATIntercept: v('phiATIntercept'),
    phiATSlope: v('phiATSlope'),
    phiATMin: v('phiATMin'),
    phiATMax: v('phiATMax'),
    phiATShift: v('phiATShift'),
    fATon: Math.exp(-1 / tauATh),
    gATon: hourMeanFactor(tauATh),
    fAToff: Math.exp(-1 / tauAToffh),
    gAToff: hourMeanFactor(tauAToffh),
    nPkLean: v('nPkLean'),
    nPkObDrop: v('nPkObDrop'),
    nPkFmRefKg: v('nPkFmRefKg'),
    nPkFmSpanKg: v('nPkFmSpanKg'),
    prLateBase: v('prLateBase'),
    prLateAmp: v('prLateAmp'),
    prLateBfScale: v('prLateBfScale'),
    prLateMult: v('prLateMult'),
    sparingBhbOnset: v('sparingBhbOnset'),
    sparingBhbSpan: v('sparingBhbSpan'),
    fN: Math.exp(-1 / tauNh),
    gN: hourMeanFactor(tauNh),
    fNoff: Math.exp(-1 / tauNoffh),
    gNoff: hourMeanFactor(tauNoffh),
    fNoffLC: Math.exp(-1 / tauNoffLCh),
    gNoffLC: hourMeanFactor(tauNoffLCh),
    lowCarbOffG: v('lowCarbOffG'),
    riseStart: v('riseStart'),
    riseDays: v('riseDays'),
    cCarb: v('cCarb'),
    carbRefG: v('carbRefG'),
    kKet: v('kKet'),
    ketExoRefMmolL: v('ketExoRefMmolL'),
    kEx: v('kEx'),
    nPerKcal: 1 / (RHO.proteinPerG * G_PROTEIN_PER_G_N),
    lMaxG: v('lMax') * ffm0Kg,
    fRep: Math.exp(-1 / (v('tauRep') * HOURS_PER_DAY)),
    repEnergyFrac: v('repEnergyFrac'),
    repProteinGPerKg: v('repProteinGPerKg'),
    aOed: v('aOed'),
    aOedCapL: v('aOedCapL'),
    oedMinFastD: v('oedMinFastD'),
    fOd: Math.exp(-1 / (tauDecayD * HOURS_PER_DAY)),
    fOc: Math.exp(-(1 / tauRiseD + 1 / tauDecayD) / HOURS_PER_DAY),
    oedLowMult: v('oedLowMult'),
    oedLowCarbG: v('oedLowCarbG'),
    oedLowNaMg: v('oedLowNaMg'),
    bhbRefB1: v('bhbRefB1'),
    bhbRefB2: v('bhbRefB2'),
    bhbRefTau2H: v('bhbRefTau2H'),
    events: run.events ?? null,
    checks: run.checks ?? false,
  };
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Early sympathetic RMR rise A_SNS(t) = a_SNS·(t/t_p)·e^(1 − t/t_p), t in days of zero intake (20 §4.2). */
export function aSnsFrac(k: FastingConstants, tD: number): number {
  if (tD <= 0) return 0;
  const x = tD / k.tP;
  return k.aSNS * x * Math.exp(1 - x);
}

/** φ_AT = clamp(0.25 − 0.004·BF%, 0.05, 0.22) + shift (±0.07), kept in [0, 1] (20 §4.2). */
export function phiAT(k: FastingConstants, bfPct: number): number {
  return clamp(clamp(k.phiATIntercept - k.phiATSlope * bfPct, k.phiATMin, k.phiATMax) + k.phiATShift, 0, 1);
}

/** Fasting RMR multiplier (1 + A_SNS)·(1 − φ_AT·s_AT) (MODEL_SPEC §1.4 step 2). */
export function rmrMultiplier(
  k: FastingConstants,
  tD: number,
  active: boolean,
  sAT: number,
  bfPct: number,
): number {
  return (1 + (active ? aSnsFrac(k, tD) : 0)) * (1 - phiAT(k, bfPct) * sAT);
}

/** Early-peak urinary N n_pk = 0.25 − 0.06·clamp((FM − 10)/40, 0, 1), g N per kg FFM per day (20 §4.4.2). */
export function nPeakPerKgFfm(k: FastingConstants, fmKg: number): number {
  return k.nPkLean - k.nPkObDrop * clamp((fmKg - k.nPkFmRefKg) / k.nPkFmSpanKg, 0, 1);
}

/** Late protein share of TEE pr_late = (0.04 + 0.22·e^(−BF%/15))·mult (20 §4.4.2). */
export function prLateFrac(k: FastingConstants, bfPct: number): number {
  return k.prLateMult * (k.prLateBase + k.prLateAmp * Math.exp(-bfPct / k.prLateBfScale));
}

/** Sparing drive S* = clamp((BHB − 0.5)/3.5, 0, 1) (20 §4.4.2); NaN-safe (→ 0). */
export function sparingTarget(k: FastingConstants, bhbMmolL: number): number {
  const x = (bhbMmolL - k.sparingBhbOnset) / k.sparingBhbSpan;
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

/** Early N rise 0.8 + 0.2·min(1, t/2.5) (20 §4.4.2). */
export function riseFactor(k: FastingConstants, tD: number): number {
  const x = tD / k.riseDays;
  return k.riseStart + (1 - k.riseStart) * (x < 1 ? (x > 0 ? x : 0) : 1);
}

/** C_carb = 1 − 0.45·clamp(CHO_24h/100, 0, 1) (20 §4.4.4). */
export function carbFactor(k: FastingConstants, carb24G: number): number {
  return 1 - k.cCarb * clamp(carb24G / k.carbRefG, 0, 1);
}

/** K_ket = 1 − 0.3·clamp(BHB_exo/1.5, 0, 1) (20 §4.4.4). */
export function ketFactor(k: FastingConstants, bhbExoMmolL: number): number {
  return 1 - k.kKet * clamp(bhbExoMmolL / k.ketExoRefMmolL, 0, 1);
}

/**
 * Urinary N while the overlay is active, g N/d (MODEL_SPEC §1.4 step 3; 20 §4.4.2):
 * N = (FFM·n_pk·(1 − S_N) + (pr_late·TEE/29.4)·S_N)·rise·C_carb·K_ket·K_ex.
 */
export function urinaryNGd(
  k: FastingConstants,
  ffmKg: number,
  fmKg: number,
  bfPct: number,
  teeKcalD: number,
  sN: number,
  tD: number,
  carb24G: number,
  bhbExoMmolL: number,
): number {
  const early = ffmKg * nPeakPerKgFfm(k, fmKg);
  const late = prLateFrac(k, bfPct) * teeKcalD * k.nPerKcal;
  const n =
    (early * (1 - sN) + late * sN) *
    riseFactor(k, tD) *
    carbFactor(k, carb24G) *
    ketFactor(k, bhbExoMmolL) *
    k.kEx;
  return n > 0 ? n : 0;
}

/** Refeeding-oedema amplitude after a completed fast of `fastDays`: min(cap, 0.08·(days − 3)) L, 0 for ≤ 3 d (20 §4.5.2). */
export function oedemaAmplitudeL(k: FastingConstants, fastDays: number): number {
  if (fastDays <= k.oedMinFastD) return 0;
  const a = k.aOed * (fastDays - k.oedMinFastD);
  return a < k.aOedCapL ? a : k.aOedCapL;
}

/** Closed form of the refeeding oedema at t_r days after the refeed start: A·(1 − e^(−t/τr))·e^(−t/τd) (20 §4.5.2). */
export function oedemaClosedFormL(
  amplitudeL: number,
  tRefeedD: number,
  tauRiseD: number,
  tauDecayD: number,
): number {
  if (tRefeedD <= 0) return 0;
  return amplitudeL * (1 - Math.exp(-tRefeedD / tauRiseD)) * Math.exp(-tRefeedD / tauDecayD);
}

/**
 * Fixed shape of 20 §4.3.4's water-only BHB reference curve (a calibration fixture for the ketones module, not engine
 * physics; amplitudes B1, B2 and τ2 are the registered parameters `fasting.bhbRef*`).
 */
export const BHB_REF_SHAPE = {
  baseMmolL: 0.08,
  t50H: 44,
  slopeH: 9,
  slowStartH: 48,
  obB1Drop: 0.4,
  obTau2Gain: 0.5,
  obBfStart: 25,
  obBfSpan: 20,
  choDrop: 0.4,
  choRefGPerD: 60,
} as const;

/**
 * BHB_ref(t) = 0.08 + B1/(1 + e^(−(t − 44)/9)) + B2·(1 − e^(−max(0, t − 48)/τ2)) with B1 = 2.2·(1 − 0.4·ob),
 * τ2 = 170·(1 + 0.5·ob), ob = clamp((BF% − 25)/20, 0, 1), × (1 − 0.4·clamp(CHO/60, 0, 1)) for modified fasts
 * (20 §4.3.4). t = hours since the start of zero intake.
 */
export function bhbRefMmolL(
  k: Pick<FastingConstants, 'bhbRefB1' | 'bhbRefB2' | 'bhbRefTau2H'>,
  tH: number,
  bfPct: number,
  choGPerD = 0,
): number {
  const s = BHB_REF_SHAPE;
  const ob = clamp((bfPct - s.obBfStart) / s.obBfSpan, 0, 1);
  const b1 = k.bhbRefB1 * (1 - s.obB1Drop * ob);
  const tau2 = k.bhbRefTau2H * (1 + s.obTau2Gain * ob);
  const slow = tH > s.slowStartH ? 1 - Math.exp(-(tH - s.slowStartH) / tau2) : 0;
  const v = s.baseMmolL + b1 / (1 + Math.exp(-(tH - s.t50H) / s.slopeH)) + k.bhbRefB2 * slow;
  return v * (1 - s.choDrop * clamp(choGPerD / s.choRefGPerD, 0, 1));
}

// ================================================================== state and hourly step

/** Ring layout: 24 hourly slots × [kcal, protein g, carbohydrate g, carbohydrate g eaten while the overlay was active]. */
const RING_SLOTS = 24;
const RING_W = 4;
/** Numerical floor below which decaying pools are set to exactly 0 (avoids denormals; not physiology). */
const TINY = 1e-12;
/** Rolling-sum residue (kcal or g) treated as exactly 0 — floating-point drift of the running sums, not physiology. */
const SUM_EPS = 1e-9;

export interface FastingState {
  /** Overlay active this hour, 0/1 (20 §4B.1 criteria or planned zero-intake span). */
  active: number;
  /** tFast, h: hours of zero intake at the end of this hour (0 when inactive; 20 §2 definition at activation). */
  tFastH: number;
  /** Resting-adaptation state s_AT, 0..1 (τ 9 d on after t_lag 2 d; τ 4 d off). */
  sAT: number;
  /** Protein-sparing state S_N, 0..1 (BHB-driven; τ_N 8 d; off τ 3 d, 7 d when low-carb refeed). */
  sN: number;
  /** Labile protein pool deficit D_lab, g protein (≤ 0.75 g/kg FFM0), repleted with τ_rep 2 d on adequate refeeding. */
  dLabG: number;
  /** Refeeding oedema E_oed, L. */
  eOedL: number;
  /** Oedema still to appear (pending pool feeding E_oed; 20 §4.5.2 closed form as two exponentials), L. */
  oedPendingL: number;
  /** Length of the last completed fast, d. */
  lastFastDays: number;
  /** Rolling 24-h intake sums maintained from HourInput: energy kcal, protein g, net carbohydrate g. */
  kcal24: number;
  protein24: number;
  carb24: number;
  /**
   * Carbohydrate eaten inside the current fast over the last 24 h, g: drives C_carb (20 §4.4.4: carbohydrate of a
   * modified fast). Pre-fast meals still in the 24-h window are excluded (pre-fast loading acts only via 04/05 states).
   */
  carbFast24: number;
  /** 24 slots × [kcal, protein g, carb g, in-fast carb g]. */
  ring: Float64Array;
  ringIdx: number;
  /** Hours since the last intake event (> 50 kcal or > 5 g protein or > 5 g carbohydrate in an hour; 20 §2), h. */
  hoursSinceIntakeH: number;
  /** Last finite, positive maintenance estimate, kcal/d (guards energy's zero-intake α_mix NaN, review M12). */
  maintRefKcalD: number;
  /** Planned-span bookkeeping for fastStart/fastEnd events: previous hour's flag (0/1) and span length, h. */
  plannedPrev: number;
  plannedSpanH: number;
  /** Diagnostics: urinary N this hour, g N/d; cumulative fasting protein oxidised, g; repleted, g; fasts started. */
  uNGd: number;
  protOxCumG: number;
  repletedCumG: number;
  fastCount: number;
}

/** The bus fields this module reads and writes (structural subset of SignalBus, so unit tests can pass a plain object). */
export interface FastingBus {
  bhbMmolL: number;
  bhbEndoMmolL: number;
  maintenanceKcalD: number;
  tdeeEstKcalD: number;
  fatMassKg: number;
  ffmActKg: number;
  fastActive: number;
  fastHoursH: number;
  fastRmrMult: number;
  fastProtOxGH: number;
  fastRepletionGH: number;
  fastOedemaL: number;
}

/** Initial state: the 24-h ring holds the habitual day spread evenly, so no spurious "fast" at t = 0 or in burn-in. */
export function fastingInitialState(p: {
  tdee0Kcal: number;
  habitualProteinG: number;
  habitualCarbG: number;
}): FastingState {
  const ring = new Float64Array(RING_SLOTS * RING_W);
  const kc = p.tdee0Kcal / RING_SLOTS;
  const pr = p.habitualProteinG / RING_SLOTS;
  const cb = p.habitualCarbG / RING_SLOTS;
  for (let i = 0; i < RING_SLOTS; i++) {
    ring[i * RING_W] = kc;
    ring[i * RING_W + 1] = pr;
    ring[i * RING_W + 2] = cb;
  }
  return {
    active: 0,
    tFastH: 0,
    sAT: 0,
    sN: 0,
    dLabG: 0,
    eOedL: 0,
    oedPendingL: 0,
    lastFastDays: 0,
    kcal24: p.tdee0Kcal,
    protein24: p.habitualProteinG,
    carb24: p.habitualCarbG,
    carbFast24: 0,
    ring,
    ringIdx: 0,
    hoursSinceIntakeH: 0,
    maintRefKcalD: p.tdee0Kcal,
    plannedPrev: 0,
    plannedSpanH: 0,
    uNGd: 0,
    protOxCumG: 0,
    repletedCumG: 0,
    fastCount: 0,
  };
}

/** `EngineModule.stepHour` of the fasting module (MODEL_SPEC §1.4); planned spans < 24 h do not activate the overlay (M7). */
export function fastingHook(
  s: FastingState,
  k: FastingConstants,
  bus: FastingBus,
  hour: HourInput,
  day: DayInput,
  clock: StepClock,
): void {
  const hi = clock.hourIndex;
  const longPlan =
    hour.plannedFast > 0 && hi >= 0 && hi < k.longPlanMask.length && k.longPlanMask[hi] === 1 ? 1 : 0;
  fastingStepHour(
    s,
    k,
    bus,
    hour.kcal,
    hour.proteinG,
    hour.carbG,
    hour.plannedFast,
    longPlan,
    day.sodiumMg,
    day.carbG,
    clock.day,
    hi,
  );
}

/**
 * One hour of the overlay (the loop calls it through `stepHour`; exported for unit tests).
 * Inputs: this hour's ingested kcal, protein g and net carbohydrate g; `plannedFast` = the hour lies in any planned
 * span (events); `plannedLong` = it lies in a planned span ≥ 24 h (activates the overlay, review M7); the day's planned
 * sodium (mg) and net carbohydrate (g) characterise a refeed for the oedema factor (20 §4.5.2).
 */
export function fastingStepHour(
  s: FastingState,
  k: FastingConstants,
  bus: FastingBus,
  kcalH: number,
  proteinGH: number,
  carbGH: number,
  plannedFast: number,
  plannedLong: number,
  daySodiumMg: number,
  dayCarbG: number,
  day: number,
  hourIndex: number,
): void {
  // ---- 1. rolling 24-h intake (MODEL_SPEC §1.4 state) and the intake-event clock (20 §2)
  const kc = kcalH > 0 ? kcalH : 0;
  const pr = proteinGH > 0 ? proteinGH : 0;
  const cb = carbGH > 0 ? carbGH : 0;
  const ring = s.ring;
  const j = s.ringIdx * RING_W;
  s.kcal24 += kc - (ring[j] as number);
  s.protein24 += pr - (ring[j + 1] as number);
  s.carb24 += cb - (ring[j + 2] as number);
  s.carbFast24 -= ring[j + 3] as number;
  ring[j] = kc;
  ring[j + 1] = pr;
  ring[j + 2] = cb;
  ring[j + 3] = 0; // set below once this hour's overlay state is known
  // running sums: rounding drift is ≤ 1e-12 relative per hour; snap sub-1e-9 residues to exactly 0 (post-fast window)
  if (s.kcal24 < SUM_EPS) s.kcal24 = 0;
  if (s.protein24 < SUM_EPS) s.protein24 = 0;
  if (s.carb24 < SUM_EPS) s.carb24 = 0;
  s.hoursSinceIntakeH =
    kc > k.eventKcal || pr > k.eventProteinG || cb > k.eventCarbG ? 0 : s.hoursSinceIntakeH + 1;

  // ---- maintenance (daily signal); a non-finite or non-positive value keeps the last good one
  const mBus = bus.maintenanceKcalD;
  if (mBus > 0 && mBus < Infinity) s.maintRefKcalD = mBus;
  const maint = s.maintRefKcalD;

  // ---- 1. criteria (20 §4.1, §4B.1): water-only ∨ modified ∨ planned span ≥ 24 h (review M7)
  const fasting =
    s.kcal24 < k.fastKcalFrac * maint && s.protein24 < k.fastProteinMaxG && s.carb24 < k.fastCarbMaxG;
  const modified = !fasting && s.kcal24 < k.modKcalFrac * maint && s.protein24 < k.fastProteinMaxG;
  const planned = plannedFast > 0;
  const active = fasting || modified || plannedLong > 0;

  if (active) {
    // start: tFast = hours since the last intake event (20 §2), ≥ 1 (end of the first zero-intake hour)
    if (s.active === 0) {
      s.tFastH = s.hoursSinceIntakeH > 1 ? s.hoursSinceIntakeH : 1;
      s.fastCount += 1;
    } else s.tFastH += 1;
  } else if (s.active === 1) {
    // fast completed: remember its length and queue the refeeding oedema (20 §4.5.2)
    const days = s.tFastH / 24;
    s.lastFastDays = days;
    const pend = s.oedPendingL + oedemaAmplitudeL(k, days);
    s.oedPendingL = pend < k.aOedCapL ? pend : k.aOedCapL;
    s.tFastH = 0;
  }
  s.active = active ? 1 : 0;
  if (active) {
    ring[j + 3] = cb;
    s.carbFast24 += cb;
  }
  if (s.carbFast24 < SUM_EPS) s.carbFast24 = 0;
  s.ringIdx = s.ringIdx === RING_SLOTS - 1 ? 0 : s.ringIdx + 1;

  // ---- events: planned span start/end (MODEL_SPEC §7.1); never during burn-in
  if (planned) {
    if (s.plannedPrev === 0) {
      s.plannedSpanH = 0;
      if (day >= 0 && k.events) k.events.emit('fastStart', hourIndex, s.tFastH);
    }
    s.plannedSpanH += 1;
    s.plannedPrev = 1;
  } else if (s.plannedPrev === 1) {
    if (day >= 0 && k.events) k.events.emit('fastEnd', hourIndex, s.plannedSpanH);
    s.plannedPrev = 0;
  }

  // ---- fast path: fed, no fasting memory left and no ketosis → every output is neutral (most hours of most runs)
  const sStar = sparingTarget(k, bus.bhbMmolL);
  if (
    !active &&
    s.sAT === 0 &&
    s.sN === 0 &&
    sStar === 0 &&
    s.dLabG === 0 &&
    s.eOedL === 0 &&
    s.oedPendingL === 0
  ) {
    s.uNGd = 0;
    bus.fastActive = 0;
    bus.fastHoursH = 0;
    bus.fastRmrMult = 1;
    bus.fastProtOxGH = 0;
    bus.fastRepletionGH = 0;
    bus.fastOedemaL = 0;
    return;
  }

  // ---- 2. resting EE multiplier (20 §4.2): A_SNS at mid-hour; s_AT exact relaxation, hour-mean used
  const tMidD = active ? (s.tFastH - 0.5) / 24 : 0;
  const aSns = active ? aSnsFrac(k, tMidD) : 0;
  let sATmean: number;
  if (active && tMidD > k.tLag) {
    sATmean = 1 + (s.sAT - 1) * k.gATon;
    s.sAT = 1 + (s.sAT - 1) * k.fATon;
  } else {
    sATmean = s.sAT * k.gAToff;
    s.sAT *= k.fAToff;
    if (s.sAT < TINY) s.sAT = 0;
  }
  let fm = bus.fatMassKg;
  let ffm = bus.ffmActKg;
  if (!(fm > 0)) fm = 0;
  if (!(ffm > 0)) ffm = 0;
  const bw = fm + ffm;
  const bfPct = bw > 0 ? (100 * fm) / bw : 0;
  const rmrMult = sATmean > 0 ? (1 + aSns) * (1 - phiAT(k, bfPct) * sATmean) : 1 + aSns;

  // ---- 3. protein-sparing state (BHB of the previous hour) and the fasting N model
  let f: number;
  let g: number;
  if (sStar >= s.sN) {
    f = k.fN;
    g = k.gN;
  } else if (s.carb24 >= k.lowCarbOffG) {
    f = k.fNoff;
    g = k.gNoff;
  } else {
    f = k.fNoffLC;
    g = k.gNoffLC;
  }
  const sNmean = sStar + (s.sN - sStar) * g;
  s.sN = sStar + (s.sN - sStar) * f;

  let protOx = 0;
  if (active) {
    // TEE of pr_late·TEE/29.4: energy's daily TDEE estimate (review B5); last good maintenance if it is not usable
    const tdee = bus.tdeeEstKcalD;
    const teeKcalD = tdee > 0 && tdee < Infinity ? tdee : maint;
    // exogenous BHB for K_ket = meter BHB − endogenous BHB (review B5)
    const exo = bus.bhbMmolL - bus.bhbEndoMmolL;
    const n = urinaryNGd(k, ffm, fm, bfPct, teeKcalD, sNmean, tMidD, s.carbFast24, exo > 0 ? exo : 0);
    s.uNGd = n;
    protOx = (n * k.gProtPerGN) / 24;
    s.protOxCumG += protOx;
    const d = s.dLabG + protOx;
    s.dLabG = d < k.lMaxG ? d : k.lMaxG;
  } else s.uNGd = 0;

  // ---- 4. labile-pool repletion on adequate refeeding (energy ≥ 90 % maintenance, protein ≥ 1.0 g/kg BW)
  let rep = 0;
  if (
    !active &&
    s.dLabG > 0 &&
    s.kcal24 >= k.repEnergyFrac * maint &&
    s.protein24 >= k.repProteinGPerKg * bw
  ) {
    rep = s.dLabG * (1 - k.fRep);
    s.dLabG -= rep;
    if (s.dLabG < TINY) s.dLabG = 0;
    s.repletedCumG += rep;
  }

  // ---- 5. refeeding oedema: pending pool P (rate 1/τr + 1/τd) feeds E (rate 1/τd); inflow × 0.3 when the day's refeed
  //         is salt-free (< 1.5 g Na) or < 50 g carbohydrate (20 §4.5.2)
  if (s.oedPendingL > 0 || s.eOedL > 0) {
    const m = dayCarbG < k.oedLowCarbG || daySodiumMg < k.oedLowNaMg ? k.oedLowMult : 1;
    const p0 = s.oedPendingL;
    s.eOedL = s.eOedL * k.fOd + m * p0 * (k.fOd - k.fOc);
    s.oedPendingL = p0 * k.fOc;
    if (s.oedPendingL < TINY) s.oedPendingL = 0;
    if (s.eOedL < TINY) s.eOedL = 0;
  }

  // ---- outputs
  bus.fastActive = s.active;
  bus.fastHoursH = s.tFastH;
  bus.fastRmrMult = rmrMult;
  bus.fastProtOxGH = protOx;
  bus.fastRepletionGH = rep;
  bus.fastOedemaL = s.eOedL;

  if (
    k.checks &&
    !(
      rmrMult > 0 &&
      rmrMult < 2 &&
      protOx >= 0 &&
      protOx < 1e3 &&
      s.dLabG >= 0 &&
      s.eOedL >= 0 &&
      s.sN >= 0 &&
      s.sN <= 1
    )
  ) {
    throw new Error(`fasting: invalid state at hour ${hourIndex}`);
  }
}
