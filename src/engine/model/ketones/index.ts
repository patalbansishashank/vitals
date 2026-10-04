/**
 * MODULE ketones — FFA supply, hepatic ketogenesis, ketone-body pool (TKB/BHB), keto-adaptation, ketosis state machine,
 * MCT and exogenous ketones.
 * Spec: docs/MODEL_SPEC.md §1.7 · Dossiers: 05 §4.0-4.17 (owner; §4.17 reference implementation with 04's glycogen
 * and insulin replacing the FALLBACK blocks); 20 §4.3.4 (water-only BHB calibration targets); 15 §4.10 (ethanol).
 * Owned files: src/engine/model/ketones/** only.
 *
 * Numerics (ruling R-KETNUM, review B4): the ketone pool has a clearance half-life of 20-25 min at low TKB, so it is
 * integrated inside the 1-h master step by four 15-min sub-steps, each the exact solution of the ODE linearised at the
 * sub-step start (P, M_ex and A_s held for the hour; hour mean = mean of the four sub-step means). Two refinements,
 * both allocation-free and verified against the converged 05 §4.17 reference (O-10 tests):
 *   (a) midpoint corrector — when a sub-step moves the pool by > 0.1 mM it is re-solved with the linearisation at the
 *       predicted midpoint (Michaelis-Menten curvature over large excursions; costs one extra exp only in such hours);
 *   (b) the hour's exogenous-ketone appearance (intake's `exoKetoneMmolH`, total unchanged) is spread over the four
 *       sub-steps with 05 §4.12's gamma(2) kernel shape by hours since the dose (precomputed table), because a
 *       25-g ester doubles TKB within 30 min (V11).
 * Slow states (FFA τ 1-1.5 h, protein memory 8 h, X_post 3 h, A_f 40/48 h, A_s 120 h) use exact exponential relaxation
 * with factors precomputed in `prepare`. Production is resolved per 15-min quarter: the FFA trajectory within the hour is
 * exact (quarter means of the relaxation) and liver glycogen is interpolated between the previous and the current hour
 * (a carbohydrate meal after a fast collapses production within the hour); P_ew enters as its hour mean.
 *
 * Integration pass (integrator A2, 2026-09-30):
 *  - δ_M (05 §4.3 k_mgF, grade D) reads fuel's EXERCISE-driven muscle-glycogen deficit (`muscleGlycogenExDefFrac`);
 *    20's fasting muscle decline (k_Mf) and 04's resting glycogenolysis no longer feed it (they tripled FFA in fasts and
 *    ran BHB to 18-28 mM by day 21).
 *  - I = intake's `insulinRefRel` = 05 §4.17's own insulin proxy IR·(I_b + 0.12·Ra_C + 0.04·Ra_P)·(1 − 0.3x) on the
 *    engine's absorption rates, basal decline and IR (S_hep^−0.9): the domain 05's lipolysis/ketogenesis functions were
 *    calibrated in; G50 = g50Frac × fuel's published capacity `liverGlycogenMaxG`.
 *  - The exogenous-ketone amount (incl. the fed factor) is intake's; this module only shapes it within the hour.
 *  - Registry values are the coupled-engine calibration (ketones/integration/targets.ts); module tests run with 05 §4.17's
 *    own calibration (testing/harness.ts REF05_CALIBRATION) because they drive the module with 05's reference inputs.
 *
 * Hot path: no allocation; transcendental calls per hour: ≤ 1 pow (lipo, cached on unchanged insulin), 1 exp (protein
 * brake), no pow for φ at nG 2 (4 evaluations while liver glycogen moves), 4 exp (pool sub-steps) + ≤ 4 (corrector) + 4 while an
 * exogenous-ketone sub-pool exists.
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { gamma2Mass } from '../../core/math';
import { ZERO_INTAKE_KCAL } from '../../core/defaults';
import { MI } from '../../types/metrics';
import type { EventSink, ModuleContext } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import { KETONES_PARAMS } from './params';

/** Number and length of the pool sub-steps inside one hour (MODEL_SPEC §1.7 step 5, ruling R-KETNUM). */
export const N_SUB = 4;
export const SUB_DT_MIN = 60 / N_SUB;
/** Hours after an exogenous-ketone dose for which the within-hour appearance shape is tabulated. */
export const EXO_AGE_MAX = 12;

/** Weights of the gamma(2) appearance kernel over the four quarters of each hour after a dose (see KetonesConst.exoW). */
function exoWeights(tpkFasted: number, tpkFed: number): Float64Array {
  const w = new Float64Array(2 * EXO_AGE_MAX * N_SUB);
  for (let fed = 0; fed < 2; fed++) {
    const th = fed === 1 ? tpkFed : tpkFasted;
    for (let a = 0; a < EXO_AGE_MAX; a++) {
      const tot = gamma2Mass(a, a + 1, th);
      for (let q = 0; q < N_SUB; q++) {
        const mq = gamma2Mass(a + q / N_SUB, a + (q + 1) / N_SUB, th);
        w[(fed * EXO_AGE_MAX + a) * N_SUB + q] = tot > 1e-300 ? mq / tot : 1 / N_SUB;
      }
    }
  }
  return w;
}

/**
 * Liver-glycogen capacity G_L,max = C_L,max · V_liv · 0.162 g/mmol (04 §4.1) is owned by `fuel` and published on the bus
 * (`liverGlycogenMaxG`, written in fuel's init/startDay, so parameter draws of the capacity stay consistent). Until the
 * first read this nominal value (04 §4.1: 500 mmol/L × 1.45 L × 0.162 g/mmol) is used.
 */
const GLMAX_04_G = 500 * 1.45 * 0.162;

export interface KetonesState {
  /** Total ketone bodies at the end of the hour, mmol/L (the kinetic pool; BHB derived, 05 §4.5). */
  tkb: number;
  /** Exogenous (D-BHB drink) part of the pool at the end of the hour, mmol/L (so that bhbEndo excludes it, 08 rule). */
  tkbExo: number;
  /** Plasma FFA at the end of the hour, mmol/L (05 §4.3; τ 1.0 h up / 1.5 h down). */
  ffa: number;
  /** Protein memory P_ew, g/d (τ 8 h). */
  pEw: number;
  /** Post-exercise lipolytic drive X_post, 1 (τ 3 h), and hours left of the post-exercise clearance reduction, h. */
  xPost: number;
  postExHoursLeft: number;
  /** Fast keto/fat adaptation A_f (τ 48 h up / 40 h down) and slow ketone-kinetics adaptation A_s (τ 120 h), 0..1. */
  aF: number;
  aS: number;
  /** Liver glycogen at the end of the previous hour, g (for the hour-mid value used by the partition). */
  gLPrevG: number;
  /** Hours since the start of a meal with > 50 g macronutrients (MCT meal factor and exogenous "fed"), h. */
  hoursSinceBigMealH: number;
  /** Hours since the hour of the last exogenous-ketone dose (HourInput.exoKetoneG) and whether it was taken fed (0/1). */
  exoDoseAgeH: number;
  exoDoseFed: number;
  /** Scratch: mean of the last pool sub-step, mmol/L (written by linearisedStep). */
  subMean: number;
  /** Hour means written to the bus this hour: TKB, BHB, endogenous BHB (mmol/L), FFA (mmol/L). */
  tkbMean: number;
  bhb: number;
  bhbEndo: number;
  ffaMean: number;
  /** Diagnostics of this hour: ketone production (mmol/min, hour mean) and urinary ketone loss (mmol/h). */
  prodMmolMin: number;
  renalMmolH: number;
  /** Ketosis category this hour: 0 none, 1 light, 2 nutritional, 3 fasting, 4 warning (05 §6). */
  state: number;
  /** 1 while in ketosis by the event hysteresis (enter ≥ 0.5 mM, exit < 0.4 mM, each persisting ≥ 2 h). */
  inKetosis: number;
  /** Consecutive hours the pending ketosis entry/exit condition has held, h. */
  crossCountH: number;
  /** BHB at the first hour of the pending crossing, mmol/L (event value). */
  crossBhb: number;
  /** Consecutive hours in category 3 / 4, and whether the deepKetosis / ketoneAlert events are armed (0/1). */
  deepCountH: number;
  alertCountH: number;
  deepArmed: number;
  alertArmed: number;
  /** Consecutive hours with BHB below the 3.0-mM threshold (re-arms the two events above after ≥ 2 h). */
  belowHighCountH: number;
  /** Hours today with BHB ≥ 0.5 mmol/L, h. */
  hoursInKetosisToday: number;
  /**
   * Hours since the last hour of fasting ketosis (category 3: BHB ≥ 3 mM with no intake in 24 h). Within 24 h of it,
   * BHB > 3 mM after the first meal is the decaying fasting pool (≤ 1-2 h after 7-21-d fasts), not a "ketones while
   * eating" warning (integrator A2; contract note on W-05-KETO-FED).
   */
  hoursSinceFastKetosis: number;
  /** Absolute hour index of the first hour with BHB ≥ 0.5 mmol/L after t = 0 (−1 until then). */
  firstKetosisHour: number;
  /** Insulin value and lipo(I) of the last evaluation (cache: lipo is recomputed only when insulinRel changes). */
  lastIns: number;
  lastLipo: number;
}

/** Constants copied from the parameters in `prepare` (plus precomputed decay factors). */
export interface KetonesConst {
  vdPerBW: number;
  clFFM: number;
  km: number;
  aM: number;
  renal: number;
  tThr: number;
  exCL: number;
  exCLTkb: number;
  exCLHill: number;
  postCL: number;
  postDurH: number;
  kP: number;
  fHep: number;
  phiMin: number;
  /** Partition half-point as a fraction of the liver-glycogen capacity (R-KET retune knob). */
  g50Frac: number;
  /** Liver-glycogen half-point of the partition, g (= g50Frac · G_L,max; refreshed from the bus at init/startDay). */
  g50G: number;
  /** G_L,max used for g50G, g (bus `liverGlycogenMaxG`). */
  gLMaxG: number;
  /** Test hook: a fixed partition half-point in g that replaces g50Frac·G_L,max (NaN = none). */
  g50OverrideG: number;
  nG: number;
  kIHep: number;
  aH: number;
  aHs: number;
  kProt: number;
  pRef: number;
  etohProdCut: number;
  f0: number;
  lipoA: number;
  lipoExp: number;
  kFB: number;
  eDef: number;
  kMgF: number;
  exF: number;
  c50: number;
  afHill: number;
  asLo: number;
  asSpan: number;
  yC8: number;
  yC10: number;
  mmolFaPerGC8: number;
  mmolFaPerGC10: number;
  mctMealFactor: number;
  mctMealGramThr: number;
  mctMealWindowH: number;
  mctC8Share: number;
  /**
   * Within-hour weights of the exogenous-ketone appearance over the four sub-steps, by hours since the dose
   * (0..EXO_AGE_MAX−1) and fed state: index (fed·EXO_AGE_MAX + age)·N_SUB + q; each row sums to 1 (gamma(2) kernel of
   * 05 §4.12 with peak 0.5 h fasted / 0.75 h fed). Beyond EXO_AGE_MAX hours the appearance is spread evenly.
   */
  exoW: Float64Array;
  rBhb0: number;
  rBhbSlope: number;
  eKetKcalPerMmol: number;
  brainMax: number;
  brainK: number;
  tkb0: number;
  tkbFloor: number;
  thrLight: number;
  thrNutritional: number;
  thrExit: number;
  hystH: number;
  thrHigh: number;
  thrMax: number;
  adaptedThr: number;
  afInitCarbG: number;
  /** Exact hourly relaxation factors exp(−1 h/τ) and hour-mean factors (1 − f)·τ/1 h. */
  fPew: number;
  pewMeanFac: number;
  fFfaUp: number;
  fFfaDn: number;
  ffaMeanUp: number;
  ffaMeanDn: number;
  /** Quarter-hour means of e^{−t/τ_F} (rising, falling): FFA_q = FFA* + (FFA_0 − FFA*)·g_q, q = 0..3 (exact). */
  ffaQUp: Float64Array;
  ffaQDn: Float64Array;
  /** Scratch: per-quarter endogenous production of the current hour, mmol/min (no allocation in the hot path). */
  prodQ: Float64Array;
  fXPost: number;
  xPostMeanFac: number;
  fAfUp: number;
  fAfDn: number;
  fAs: number;
  /** Profile fallbacks for the body scale (used only if the bus holds a non-physical value). */
  bw0: number;
  ffm0: number;
  checks: boolean;
  /** Event sink of the run (allocation-free; ignores negative hour indices and is disabled during burn-in). */
  events: EventSink;
}

const decay1h = (tauH: number): number => (tauH > 0 ? Math.exp(-1 / tauH) : 0);
/** Means of e^{−t/τ} over the N_SUB quarters of an hour (t in h). */
function quarterMeans(tauH: number): Float64Array {
  const g = new Float64Array(N_SUB);
  const dq = 1 / N_SUB;
  for (let q = 0; q < N_SUB; q++) g[q] = tauH > 0 ? (tauH / dq) * (Math.exp((-q * dq) / tauH) - Math.exp((-(q + 1) * dq) / tauH)) : 0;
  return g;
}
const meanFac1h = (tauH: number): number => (tauH > 0 ? (1 - Math.exp(-1 / tauH)) * tauH : 0);

/** Builds the constants object (exported for unit tests that drive the module directly). */
export function prepareKetones(ctx: ModuleContext): KetonesConst {
  const p = (name: string): number => param(ctx.params, `ketones.${name}`);
  const gLMaxG = GLMAX_04_G;
  const tauProt = p('tauProt');
  const tauFUp = p('tauFUp');
  const tauFDown = p('tauFDown');
  const tauPostF = p('tauPostF');
  return {
    vdPerBW: p('vdPerBW'),
    clFFM: p('clFFM'),
    km: p('km'),
    aM: p('aM'),
    renal: p('renal'),
    tThr: p('tThr'),
    exCL: p('exCL'),
    exCLTkb: p('exCLTkb'),
    exCLHill: p('exCLHill'),
    postCL: p('postCL'),
    postDurH: p('postDurH'),
    kP: p('kP'),
    fHep: p('fHep'),
    phiMin: p('phiMin'),
    g50Frac: p('g50Frac'),
    g50G: p('g50Frac') * gLMaxG,
    gLMaxG,
    g50OverrideG: Number.NaN,
    nG: p('nG'),
    kIHep: p('kIHep'),
    aH: p('aH'),
    aHs: p('aHs'),
    kProt: p('kProt'),
    pRef: p('pRef'),
    etohProdCut: p('etohProdCut'),
    f0: p('f0'),
    lipoA: p('lipoA'),
    lipoExp: p('lipoExp'),
    kFB: p('kFB'),
    eDef: p('eDef'),
    kMgF: p('kMgF'),
    exF: p('exF'),
    c50: p('c50'),
    afHill: p('afHill'),
    asLo: p('asLo'),
    asSpan: p('asSpan'),
    yC8: p('yC8'),
    yC10: p('yC10'),
    mmolFaPerGC8: p('mmolFaPerGC8'),
    mmolFaPerGC10: p('mmolFaPerGC10'),
    mctMealFactor: p('mctMealFactor'),
    mctMealGramThr: p('mctMealGramThr'),
    mctMealWindowH: p('mctMealWindowH'),
    mctC8Share: p('mctC8Share'),
    exoW: exoWeights(p('exoTpkFasted'), p('exoTpkFed')),
    rBhb0: p('rBhb0'),
    rBhbSlope: p('rBhbSlope'),
    eKetKcalPerMmol: p('eKetKcalPerMmol'),
    brainMax: p('brainMax'),
    brainK: p('brainK'),
    tkb0: p('tkb0'),
    tkbFloor: p('tkbFloor'),
    thrLight: p('thrLight'),
    thrNutritional: p('thrNutritional'),
    thrExit: p('thrExit'),
    hystH: p('hystH'),
    thrHigh: p('thrHigh'),
    thrMax: p('thrMax'),
    adaptedThr: p('adaptedThr'),
    afInitCarbG: p('afInitCarbG'),
    fPew: decay1h(tauProt),
    pewMeanFac: meanFac1h(tauProt),
    fFfaUp: decay1h(tauFUp),
    fFfaDn: decay1h(tauFDown),
    ffaMeanUp: meanFac1h(tauFUp),
    ffaMeanDn: meanFac1h(tauFDown),
    ffaQUp: quarterMeans(tauFUp),
    ffaQDn: quarterMeans(tauFDown),
    prodQ: new Float64Array(N_SUB),
    fXPost: decay1h(tauPostF),
    xPostMeanFac: meanFac1h(tauPostF),
    fAfUp: decay1h(p('tauAfUp')),
    fAfDn: decay1h(p('tauAfDn')),
    fAs: decay1h(p('tauAs')),
    bw0: ctx.profile.weightKg,
    ffm0: ctx.profile.ffm0Kg,
    checks: ctx.checks,
    events: ctx.events,
  };
}

/** Pool excursion within one sub-step above which the midpoint corrector is applied, mmol/L (numerical constant). */
export const CORRECTOR_MMOL_L = 0.1;

/**
 * Exact solution over SUB_DT_MIN minutes of the ketone-pool ODE dT/dt = (P − U(T) − Ren(T))/Vd linearised at `tLin`
 * (U = Vmax·T/(Km + T), Ren = rB·max(0, T − tThr)), starting from `tStart`. Returns T at the end of the sub-step and
 * writes the sub-step mean to `s.subMean` (no allocation).
 */
export function linearisedStep(
  s: KetonesState,
  tLin: number,
  tStart: number,
  p: number,
  vmaxEff: number,
  km: number,
  rB: number,
  tThr: number,
  vd: number,
): number {
  const kmT = km + tLin;
  const u = (vmaxEff * tLin) / kmT;
  let ren = 0;
  let dRen = 0;
  if (tLin > tThr) {
    ren = rB * (tLin - tThr);
    dRen = rB;
  }
  const f = (p - u - ren) / vd; // mM/min at tLin
  const b = ((vmaxEff * km) / (kmT * kmT) + dRen) / vd; // 1/min (> 0)
  const tStar = tLin + f / b; // equilibrium of the linearised ODE
  const bh = SUB_DT_MIN * b;
  const ex = Math.exp(-bh);
  s.subMean = tStar + ((tStart - tStar) * (1 - ex)) / bh;
  return tStar + (tStart - tStar) * ex;
}

/** Insulin antilipolysis factor lipo(I) = 1/(a + (1 − a)·I^e) (05 §4.3; = 1 at I = 1). */
export function lipoOf(k: KetonesConst, ins: number): number {
  return 1 / (k.lipoA + (1 - k.lipoA) * Math.pow(ins, k.lipoExp));
}

/** Hepatic ketogenic partition φ(G_L, A_f, A_s) (05 §4.2). */
export function phiOf(k: KetonesConst, gL: number, aF: number, aS: number): number {
  const gr = gL > 0 ? gL / k.g50G : 0;
  // (G_L/G50)^nG without Math.pow for the calibrated nG = 2 and 05's 2.5 (same values)
  const grn = gr > 0 ? (k.nG === 2 ? gr * gr : k.nG === 2.5 ? gr * gr * Math.sqrt(gr) : Math.pow(gr, k.nG)) : 0;
  return (k.phiMin + (1 - k.phiMin) / (1 + grn)) * (1 + k.aH * aF) * (1 + k.aHs * aS);
}

/** BHB from TKB (05 §4.5): R = BHB/AcAc = r0 + r1·TKB, BHB = TKB·R/(1 + R). */
export function bhbFromTkb(k: KetonesConst, tkb: number): number {
  const r = k.rBhb0 + k.rBhbSlope * tkb;
  return (tkb * r) / (1 + r);
}

/**
 * Partition half-point from the liver-glycogen capacity published by fuel (G50 = g50Frac·G_L,max, 05 §4.4 coupling note);
 * called in init and startDay (a daily signal). A non-physical bus value keeps the previous capacity.
 */
export function syncCapacity(k: KetonesConst, bus: SignalBus): void {
  const cap = bus.liverGlycogenMaxG;
  if (cap > 1 && cap < 1000) k.gLMaxG = cap;
  k.g50G = k.g50OverrideG === k.g50OverrideG ? k.g50OverrideG : k.g50Frac * k.gLMaxG;
}

/** Builds the initial state (05 §4.17 init; A_f = 1 when habitual carbohydrate < 50 g/d, 05 §2) and writes the bus. */
export function initKetones(k: KetonesConst, ctx: ModuleContext, bus: SignalBus): KetonesState {
  syncCapacity(k, bus);
  const s: KetonesState = {
    tkb: k.tkb0,
    tkbExo: 0,
    ffa: k.f0,
    pEw: ctx.profile.habitualProteinG,
    xPost: 0,
    postExHoursLeft: 0,
    aF: ctx.profile.habitualCarbG < k.afInitCarbG ? 1 : 0,
    aS: 0,
    gLPrevG: bus.liverGlycogenG,
    hoursSinceBigMealH: 24,
    exoDoseAgeH: 1e6,
    exoDoseFed: 0,
    subMean: k.tkb0,
    tkbMean: k.tkb0,
    bhb: bhbFromTkb(k, k.tkb0),
    bhbEndo: bhbFromTkb(k, k.tkb0),
    ffaMean: k.f0,
    prodMmolMin: 0,
    renalMmolH: 0,
    state: 0,
    inKetosis: 0,
    crossCountH: 0,
    crossBhb: 0,
    deepCountH: 0,
    alertCountH: 0,
    deepArmed: 1,
    alertArmed: 1,
    belowHighCountH: 0,
    hoursInKetosisToday: 0,
    hoursSinceFastKetosis: 1e6,
    firstKetosisHour: -1,
    lastIns: -1,
    lastLipo: 1,
  };
  s.state = categoryOf(k, s.bhb, false);
  writeBus(k, s, bus);
  return s;
}

function writeBus(k: KetonesConst, s: KetonesState, bus: SignalBus): void {
  bus.tkbMmolL = s.tkbMean;
  bus.bhbMmolL = s.bhb;
  bus.bhbEndoMmolL = s.bhbEndo;
  bus.ffaMmolL = s.ffaMean;
  bus.ketoAdaptFast = s.aF;
  bus.ketoAdaptSlow = s.aS;
  bus.ketoneLossKcalH = k.eKetKcalPerMmol * s.renalMmolH;
  bus.brainKetoneShare = (k.brainMax * s.tkbMean) / (s.tkbMean + k.brainK);
}

/** Ketosis category (05 §6): 0 none (< 0.2), 1 light, 2 nutritional (0.5-3.0), 3 fasting (3-6, no intake in 24 h),
 * 4 warning (> 3.0 with food in the last 24 h, or > 6.0). */
export function categoryOf(k: KetonesConst, bhb: number, noIntake24: boolean): number {
  if (bhb > k.thrMax) return 4;
  if (bhb >= k.thrHigh && noIntake24) return 3;
  if (bhb > k.thrHigh) return 4;
  if (bhb >= k.thrNutritional) return 2;
  if (bhb >= k.thrLight) return 1;
  return 0;
}

/**
 * One hour of the ketone model (MODEL_SPEC §1.7 steps 1-7). Exported so unit tests can drive it with hand-built bus
 * values; `mealStart`/`mealMacroG` come from the HourInput (meal start in this hour and its protein + carb + fat grams).
 */
export function stepKetones(
  s: KetonesState,
  k: KetonesConst,
  bus: SignalBus,
  mealStart: number,
  mealMacroG: number,
  exoDoseG: number,
  hourIndex: number,
  events: EventSink | null,
): void {
  // ---- body scale (previous-hour composition values; guarded against non-physical values)
  const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : k.bw0;
  const ffm = bus.ffmActKg > 1 ? bus.ffmActKg : k.ffm0;
  const vd = k.vdPerBW * bw; // L
  const t0 = s.tkb;

  // ---- meal tracker (05 §4.17 fedRecent: a meal with > 50 g macronutrients started < 3 h ago)
  if (mealStart > 0 && mealMacroG > k.mctMealGramThr) s.hoursSinceBigMealH = 0;
  else if (s.hoursSinceBigMealH < 1e6) s.hoursSinceBigMealH += 1;
  const fedRecent = s.hoursSinceBigMealH < k.mctMealWindowH;
  if (exoDoseG > 0) {
    s.exoDoseAgeH = 0;
    s.exoDoseFed = fedRecent ? 1 : 0;
  } else if (s.exoDoseAgeH < 1e6) s.exoDoseAgeH += 1;

  // ---- 1. protein memory P_ew (τ 8 h) toward 24·raProtGH; hour mean for the brake
  const raP = bus.raProtGH > 0 ? bus.raProtGH : 0;
  const pTarget = 24 * raP;
  const pEwMean = pTarget + (s.pEw - pTarget) * k.pewMeanFac;
  s.pEw = pTarget + (s.pEw - pTarget) * k.fPew;

  // ---- 2. FFA supply (05 §4.3). I = intake's `insulinRefRel`: insulin relative to the overnight-fasted insulin of an
  // insulin-sensitive reference adult on the same diet, so 05's IR (1.0 lean, 1.2-1.4 obese; 05 §3) is contained through
  // 04's S_hep/S_mus insulin physiology (ruling R-KET), and the fasting floor tends to 05's I_floor 0.45 as S_hep → 1.
  const ins = bus.insulinRefRel > 0 ? bus.insulinRefRel : 0;
  let lipo = s.lastLipo;
  if (ins !== s.lastIns) {
    lipo = lipoOf(k, ins);
    s.lastIns = ins;
    s.lastLipo = lipo;
  }
  const tdee = bus.tdeeEstKcalD;
  const eaten = bus.kcalEaten24 > 0 ? bus.kcalEaten24 : 0;
  const def = tdee > 0 ? Math.max(0, 1 - eaten / tdee) : 0;
  const exMin = bus.exMinutesH > 0 ? (bus.exMinutesH < 60 ? bus.exMinutesH : 60) : 0;
  const x = exMin > 0 && bus.exIntensityFrac > 0 ? bus.exIntensityFrac : 0;
  // R-KETEX (final round 2026-09-30): every exercise effect on ketone turnover wanes with ketonaemia by the same Hill
  // factor h(T) = 1/(1 + (T/3 mM)^4) as 05 §4.1's exercise clearance gain — 05 §4.10: "stimulatory effects wane above
  // 2.5 mM and are abolished/reversed above 3-4 mM" (Féry & Balasse 1986/1988; after 3 d of fasting TKB falls ~20 % during
  // exercise, Balasse 1978). Applied to the post-exercise clearance fall (×0.6 for 2 h), the post-exercise lipolytic
  // drive X_post and the muscle-glycogen-deficit drive k_mgF·δ_M; unattenuated they ran a 72-h fast with one session
  // from 2.7 to 7-9 mM and a 7-day fast to > 10 mM. Low-ketone (overnight-fasted, fed) behaviour is unchanged (h ≈ 1).
  const trA = t0 / k.exCLTkb;
  const exAtt = 1 / (1 + (k.exCLHill === 4 ? trA * trA * (trA * trA) : Math.pow(trA, k.exCLHill)));
  let xPostMean: number;
  if (exMin > 0) {
    s.xPost = k.exF * x;
    xPostMean = s.xPost;
  } else {
    xPostMean = s.xPost * k.xPostMeanFac;
    s.xPost *= k.fXPost;
  }
  // δ_M: exercise-driven muscle-glycogen deficit (fuel). 05 fitted k_mgF (grade D) to exercise depletion (Burke 2021,
  // Deru 2021) with a fallback muscle that does not fall at rest; resting and fasting glycogenolysis (04 k_Mr, 20 k_Mf)
  // are therefore excluded — feeding 20's fasting decline into this term tripled FFA and ran BHB to 18-28 mM by day 21.
  const exDef = bus.muscleGlycogenExDefFrac;
  const deltaM = exDef > 0 ? (exDef < 1 ? exDef : 1) : 0;
  // the glycogen-deficit drive (05 §4.3 k_mgF, grade D) was fitted in fed LCHF training (Burke 2021) and at the start of a
  // fast (Deru 2021, TKB < 1 mM): its high-ketone attenuation is weighted by the energy deficit d of the last 24 h, so it
  // applies in fasting (d → 1; the exercise deficit then persists for days, no meal refills it) and not in fed states
  const mgAtt = 1 - def * (1 - exAtt);
  const ffaStar = (k.f0 * lipo * (1 + k.eDef * def) * (1 + xPostMean * exAtt) * (1 + k.kMgF * deltaM * mgAtt)) / (1 + t0 / k.kFB);
  const ffa0 = s.ffa;
  const rising = ffaStar > ffa0;
  let ffaMean: number;
  if (rising) {
    ffaMean = ffaStar + (ffa0 - ffaStar) * k.ffaMeanUp;
    s.ffa = ffaStar + (ffa0 - ffaStar) * k.fFfaUp;
  } else {
    ffaMean = ffaStar + (ffa0 - ffaStar) * k.ffaMeanDn;
    s.ffa = ffaStar + (ffa0 - ffaStar) * k.fFfaDn;
  }

  // ---- 3. adaptation states (05 §4.11.1-4.11.2)
  const c24 = bus.carbAbs24G > 0 ? bus.carbAbs24G : 0;
  const rc = c24 / k.c50;
  const afStar = 1 / (1 + (k.afHill === 3 ? rc * rc * rc : Math.pow(rc, k.afHill)));
  const afPrev = s.aF;
  s.aF = afStar + (s.aF - afStar) * (afStar > s.aF ? k.fAfUp : k.fAfDn);
  let asStar = (t0 - k.asLo) / k.asSpan;
  asStar = asStar < 0 ? 0 : asStar > 1 ? 1 : asStar;
  s.aS = asStar + (s.aS - asStar) * k.fAs;

  // ---- 4. production, mmol/min (05 §4.2, §4.12), per 15-min quarter: the FFA trajectory within the hour is exact
  // (quarter means of the relaxation) and liver glycogen is interpolated linearly between the previous and the current
  // hour's value (refeeding raises it by 10-20 g in one hour); both matter when production collapses on a carbohydrate
  // meal (coupled O-10). The partition is evaluated once when liver glycogen did not move.
  const gLNow = bus.liverGlycogenG > 0 ? bus.liverGlycogenG : 0;
  const gLPrev = s.gLPrevG;
  s.gLPrevG = gLNow;
  const hI = 1 / (1 + k.kIHep * ins);
  const piP = k.kProt > 0 ? Math.exp((-k.kProt * pEwMean) / k.pRef) : 1;
  const base = k.kP * ffm * hI * piP * (bus.etohPoolG > 0 ? 1 - k.etohProdCut : 1);
  const raMct = bus.raMctGH;
  let pMct = 0;
  if (raMct > 0) {
    const yMol = k.yC8 * k.mmolFaPerGC8 * k.mctC8Share + k.yC10 * k.mmolFaPerGC10 * (1 - k.mctC8Share);
    pMct = ((fedRecent ? k.mctMealFactor : 1) * yMol * raMct) / 60;
  }
  const gq = rising ? k.ffaQUp : k.ffaQDn;
  const dG = gLNow - gLPrev;
  const phiConst = dG < 0.05 && dG > -0.05 ? phiOf(k, 0.5 * (gLPrev + gLNow), s.aF, s.aS) : -1;
  const prodQ = k.prodQ;
  let prod = 0;
  for (let q = 0; q < N_SUB; q++) {
    const phiQ = phiConst >= 0 ? phiConst : phiOf(k, gLPrev + dG * ((q + 0.5) / N_SUB), s.aF, s.aS);
    const pq = base * (ffaStar + (ffa0 - ffaStar) * gq[q]! + k.fHep) * phiQ + pMct;
    prodQ[q] = pq;
    prod += pq;
  }
  prod /= N_SUB;
  // exogenous D-BHB appearance: the amount (incl. 05 §4.12's fed bioavailability 0.75) is intake's `exoKetoneMmolH`; this
  // module only shapes it within the hour (applying the fed factor here as well counted it twice: fed Cmax −58 %)
  const pExo = bus.exoKetoneMmolH > 0 ? bus.exoKetoneMmolH / 60 : 0;
  s.prodMmolMin = prod + pExo;
  // within-hour shape of the exogenous appearance (row of exoW; even spread when the dose is older than the table)
  const exoRow = pExo > 0 && s.exoDoseAgeH < EXO_AGE_MAX ? (s.exoDoseFed * EXO_AGE_MAX + s.exoDoseAgeH) * N_SUB : -1;

  // ---- 5. clearance multiplier (05 §4.1): exercise gain weighted by the exercised share of the hour; ×0.6 for 2 h after
  let mEx = 1;
  if (exMin > 0) {
    mEx = 1 + (exMin / 60) * k.exCL * x * exAtt;
    s.postExHoursLeft = k.postDurH;
  } else if (s.postExHoursLeft > 0) {
    mEx = 1 - (1 - k.postCL) * exAtt;
    s.postExHoursLeft -= 1;
  }
  const vmaxEff = k.clFFM * ffm * k.km * mEx * (1 - k.aM * s.aS); // mmol/min
  const rB = k.renal * bw; // L/min above threshold

  // ---- pool: four 15-min exact linearised sub-steps (ruling R-KETNUM)
  let t = t0;
  let e = s.tkbExo;
  const hasExo = e > 1e-9 || pExo > 0;
  if (!hasExo) e = 0;
  let meanSum = 0;
  let exoMeanSum = 0;
  let renMmol = 0;
  const km = k.km;
  const tThr = k.tThr;
  const floor = k.tkbFloor;
  const vmaxKm = vmaxEff * km;
  for (let i = 0; i < N_SUB; i++) {
    const pExoQ = pExo > 0 ? (exoRow >= 0 ? pExo * N_SUB * k.exoW[exoRow + i]! : pExo) : 0;
    const pq = prodQ[i]! + pExoQ;
    // predictor: exact solution of the ODE linearised at the sub-step start (inlined copy of linearisedStep)
    const kmT = km + t;
    let ren0 = 0;
    let dRen0 = 0;
    if (t > tThr) {
      ren0 = rB * (t - tThr);
      dRen0 = rB;
    }
    const bLin = (vmaxKm / (kmT * kmT) + dRen0) / vd; // 1/min (> 0)
    const tStar = t + (pq - (vmaxEff * t) / kmT - ren0) / vd / bLin;
    const bh = SUB_DT_MIN * bLin;
    const ex = Math.exp(-bh);
    let t1 = tStar + (t - tStar) * ex;
    let mean = tStar + ((t - tStar) * (1 - ex)) / bh;
    // corrector: when the sub-step moves the pool by more than CORRECTOR_MMOL_L, re-linearise at the predicted
    // midpoint (Michaelis-Menten curvature over large excursions, e.g. exogenous-ketone uptake; module header (a))
    if (t1 - t > CORRECTOR_MMOL_L || t - t1 > CORRECTOR_MMOL_L) {
      t1 = linearisedStep(s, 0.5 * (t + t1), t, pq, vmaxEff, km, rB, tThr, vd);
      mean = s.subMean;
    }
    if (mean < floor) mean = floor;
    if (mean > tThr) renMmol += rB * (mean - tThr) * SUB_DT_MIN;
    meanSum += mean;
    if (t1 < floor) t1 = floor;
    if (hasExo) {
      // exogenous sub-pool: input pExo, loses the share e/T of U + Ren (evaluated at the sub-step mean)
      const um = (vmaxEff * mean) / (km + mean);
      const rm = mean > tThr ? rB * (mean - tThr) : 0;
      const kE = (um + rm) / (mean * vd); // 1/min
      const kh = SUB_DT_MIN * kE;
      const eE = Math.exp(-kh);
      const eStar = pExoQ / (vd * kE);
      exoMeanSum += eStar + ((e - eStar) * (1 - eE)) / kh;
      e = eStar + (e - eStar) * eE;
      if (e > t1) e = t1;
    }
    t = t1;
  }
  s.tkb = t;
  s.tkbExo = hasExo && e > 1e-9 ? e : 0;
  const tMean = meanSum / N_SUB;
  const exoMean = hasExo ? exoMeanSum / N_SUB : 0;
  s.renalMmolH = renMmol;

  // ---- 6. outputs
  s.tkbMean = tMean;
  s.bhb = bhbFromTkb(k, tMean);
  const exoShare = exoMean > 0 ? (exoMean < tMean ? exoMean / tMean : 1) : 0;
  s.bhbEndo = s.bhb * (1 - exoShare);
  s.ffaMean = ffaMean;
  bus.tkbMmolL = tMean;
  bus.bhbMmolL = s.bhb;
  bus.bhbEndoMmolL = s.bhbEndo;
  bus.ffaMmolL = ffaMean;
  bus.ketoAdaptFast = s.aF;
  bus.ketoAdaptSlow = s.aS;
  bus.ketoneLossKcalH = k.eKetKcalPerMmol * renMmol;
  bus.brainKetoneShare = (k.brainMax * tMean) / (tMean + k.brainK);

  if (k.checks && !(Number.isFinite(s.tkb) && Number.isFinite(s.bhb) && Number.isFinite(s.ffa) && s.tkb >= k.tkbFloor && s.ffa >= 0)) {
    throw new Error(`ketones: non-physical state at hour ${hourIndex} (tkb ${s.tkb}, ffa ${s.ffa})`);
  }

  // ---- 7. ketosis state machine and events (05 §6, MODEL_SPEC §7.1)
  const bhb = s.bhb;
  const noIntake = eaten <= ZERO_INTAKE_KCAL;
  const cat = categoryOf(k, bhb, noIntake || s.hoursSinceFastKetosis < 24);
  s.state = cat;
  s.hoursSinceFastKetosis = cat === 3 && noIntake ? 0 : s.hoursSinceFastKetosis + 1;
  if (bhb >= k.thrNutritional) {
    s.hoursInKetosisToday += 1;
    if (s.firstKetosisHour < 0 && hourIndex >= 0) s.firstKetosisHour = hourIndex;
  }
  const emit = events !== null && hourIndex >= 0;
  // entry / exit with value hysteresis (0.5 up / 0.4 down) and a 2-h persistence; stamped at the first hour
  if (s.inKetosis === 0 ? bhb >= k.thrNutritional : bhb < k.thrExit) {
    if (s.crossCountH === 0) s.crossBhb = bhb;
    s.crossCountH += 1;
    if (s.crossCountH >= k.hystH) {
      s.inKetosis = 1 - s.inKetosis;
      s.crossCountH = 0;
      if (emit) events.emit(s.inKetosis === 1 ? 'ketosisEntered' : 'ketosisExited', hourIndex - k.hystH + 1, s.crossBhb);
    }
  } else {
    s.crossCountH = 0;
  }
  // deepKetosis (category 3) and ketoneAlert (category 4): once per episode, after ≥ 2 h, re-armed after ≥ 2 h < 3.0 mM
  s.deepCountH = cat === 3 ? s.deepCountH + 1 : 0;
  s.alertCountH = cat === 4 ? s.alertCountH + 1 : 0;
  if (s.deepArmed === 1 && s.deepCountH >= k.hystH) {
    s.deepArmed = 0;
    if (emit) events.emit('deepKetosis', hourIndex - k.hystH + 1, bhb);
  }
  if (s.alertArmed === 1 && s.alertCountH >= k.hystH) {
    s.alertArmed = 0;
    if (emit) events.emit('ketoneAlert', hourIndex - k.hystH + 1, bhb);
  }
  if (bhb < k.thrHigh) {
    s.belowHighCountH += 1;
    if (s.belowHighCountH >= k.hystH) {
      s.deepArmed = 1;
      s.alertArmed = 1;
    }
  } else {
    s.belowHighCountH = 0;
  }
  if (afPrev < k.adaptedThr && s.aF >= k.adaptedThr && emit) events.emit('ketoAdapted', hourIndex, s.aF);
}

export const ketonesModule = defineModule<KetonesState, KetonesConst>({
  id: 'ketones',
  specSection: '§1.7',
  dossiers: '05 §4.0-4.17; 20 §4.3.4; 15 §4.10',
  params: KETONES_PARAMS,
  reads: [
    'liverGlycogenG', 'liverGlycogenMaxG', 'muscleGlycogenExDefFrac', 'insulinRefRel', 'raProtGH', 'raMctGH', 'exoKetoneMmolH',
    'exIntensityFrac', 'exMinutesH', 'kcalEaten24', 'carbAbs24G', 'tdeeEstKcalD', 'ffmActKg', 'tissueMassKg', 'etohPoolG',
  ],
  writes: ['tkbMmolL', 'bhbMmolL', 'bhbEndoMmolL', 'ffaMmolL', 'ketoAdaptFast', 'ketoAdaptSlow', 'ketoneLossKcalH', 'brainKetoneShare'],
  records: ['bhb', 'ketosisState', 'hoursInKetosis', 'ketoAdaptation', 'ketoAdaptFast', 'ketoAdaptSlow'],
  prepare: prepareKetones,
  init: initKetones,
  startDay: (s, k, bus) => {
    s.hoursInKetosisToday = 0;
    syncCapacity(k, bus);
  },
  stepHour: (s, k, bus, hour, _day, clock) => {
    stepKetones(s, k, bus, hour.mealStart, hour.proteinG + hour.carbG + hour.fatG, hour.exoKetoneG, clock.hourIndex, clock.day >= 0 ? k.events : null);
  },
  recordHour: (s, _k, _bus, out) => {
    out[MI.bhb] = s.bhb;
    out[MI.ketosisState] = s.state;
  },
  recordDay: (s, _k, _bus, out) => {
    out[MI.hoursInKetosis] = s.hoursInKetosisToday;
    // displayed keto-adaptation = labelled combined index of the fast (days) and slow (weeks) states, equal weights
    // (release check 2026-10-01; 05 §4.11); both components are detail series
    out[MI.ketoAdaptation] = 50 * (s.aF + s.aS);
    out[MI.ketoAdaptFast] = 100 * s.aF;
    out[MI.ketoAdaptSlow] = 100 * s.aS;
  },
});
