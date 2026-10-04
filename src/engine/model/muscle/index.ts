/**
 * MODULE muscle — resistance-training stimulus, hypertrophy accretion, lean retention in deficit, detraining & muscle
 * memory, strength, fatigue; hourly MPS display layer and the post-exercise MPS kernel.
 * Spec: docs/MODEL_SPEC.md §1.9 · Dossiers: 09 §4.1-4.17 (owner of every RT effect, incl. f_P per kg body mass — R-RT
 * revised); 03 §4.2 (7-day effective intake), §4.10 (quality), §4.5, §4.7 (hourly layer, display only), §4.8 (E_dist on A_r), §4.10 (quality), §4.14 (anabolic resistance display);
 * 15 §4.10/§4.12 (alcohol MPS multiplier, creatine multiplier); 16 §4.0.1 (sleep multiplier); 19 §4.3 (M_EA on strength);
 * 21 §4D-4 (post-RT cold-water immersion multiplier, `SessionResolved.coldWaterImmersion`).
 * Owned files: src/engine/model/muscle/** only.
 *
 * Structure (MODEL_SPEC §1.9):
 *  - stepHour: effective sets (09 §4.1) per region → 09 kernel S_mps,r (→ `mpsStimWb`) and 03 X_RT; 03 §4.7B MPS index
 *    (display only, never integrated into mass); post-session alcohol/protein window (15 §4.10).
 *  - endOfDay: 7-day set ring → V_r, F_r; habituation H_r, swelling W_r; accretion A_r (09 §4.9 with 09 f_P on 7-day
 *    quality-weighted protein per kg body mass, f_EP on the 7-day mean e, 03 E_dist); detraining D_r (09 §4.10); fatigue (09 §4.11); neural strength N (09 §4.14, R-STR); daily signals.
 *  - Burn-in (clock.day < 0, the habitual week with its sessions, R-BURNIN): every state runs (set ring, habituation,
 *    fatigue, neural strength, protein ring, MPS layer) except the training-attributable mass (M_acc, M_peak frozen at
 *    their 09 §4.6 initial values) and events. `endBurnIn` latches the t = 0 references: M_acc,0, SM₀, the neural
 *    component at its habitual equilibrium, and the habitual-week means of acute fatigue and M_EA, so that at t = 0
 *    rtMuscleGain = smRtKg = 0 and strength = 100, and the strength index averages 100 over the habitual week.
 *
 * Habitual-training equilibrium (MODEL_SPEC §1.9, R-BURNIN/O-12): the habitual week is the person's steady state. With
 * RT in it, `endBurnIn` latches the reference rate B_ref,r = the gross 09 §4.9 accretion rate the habitual week produces
 * at maintenance and habitual protein; accretion is the excess max(0, B_r − B_ref,r), so the habitual week keeps lean
 * mass constant, more volume/protein/energy accretes towards a higher equilibrium TS, and losses come only from 09
 * detraining (V_r < V_maint) and composition's partition. Without RT in the habitual week B_ref = 0 (novice gains when
 * training starts) and all of M_acc,0 is the person's set-point (`mBase`, never detrained).
 *
 * Detraining towards a floor (ruling R-DETRAIN, release check 2026-10-01): 09 §4.10's exponential loss (no loss for ~2-3
 * weeks, then τ_d) acts on M_acc − floor, not on M_acc − set-point. For a habitual lifter the set-point is the untrained,
 * FFMI-derived lean (`mBase` = M_acc,0 minus the trained gains the body carries above FFMI_untr, `equations.trainedGains0`)
 * and the floor keeps `detrainFloorFrac` (0.5, grade C) of those long-term gains (myonuclear memory); gains accrued inside
 * the run detrain fully (Psilander 2019). M_peak (κ_mem) is unchanged, so retraining regains with the memory boost.
 *
 * Regain (ruling R-REGAIN, 2026-10-01): below M_peak (only reachable through detraining) accretion is 09's full rate B_r
 * (gap term, habituation, κ_mem 1.3) capped at M_peak; the excess form over B_ref applies at/above it — so a habitual
 * lifter regains lost muscle at 09's retraining pace and still sits at the habitual equilibrium once back at M_acc,0.
 */
import { defineModule } from '../../core/moduleKit';
import { DEFAULTS as DEFAULTS_ } from '../../core/defaults';
import { MAX_MEALS as MAX_MEALS_, N_REGIONS as N_REGIONS_ } from '../../types/inputs';
import type { DayInput } from '../../types/inputs';
import type { ResolvedProfile } from '../../types/profile';
import { MI as MI_ } from '../../types/metrics';
import { trainingFfmiOffset } from '../../body/estimateBody';
import { MUSCLE_PARAMS } from './params';
import { readMuscleConstants, type MuscleConstants } from './constants';
import * as eq from './equations';
import type { Ts0Result } from './equations';

// Imported bindings copied once into module-local constants. Under a dev-server/Vitest SSR transform every imported
// binding becomes a namespace getter call, which doubled this module's cost; in a bundled build this is free.
const N_REGIONS = N_REGIONS_;
const MAX_MEALS = MAX_MEALS_;
const MI_MPS = MI_.mps;
const MI_STRENGTH = MI_.strength;
const MI_TS = MI_.trainingStatus;
const MI_RTGAIN = MI_.rtMuscleGain;
const RT_REST_DEFAULT = DEFAULTS_.rtRestSec;
const RT_LOAD_DEFAULT = DEFAULTS_.rtLoadPct1RM;
const boutStimulus = eq.boutStimulus;
const clamp = eq.clamp;
const detrainFloor = eq.detrainFloor;
const detrainLambda = eq.detrainLambda;
const distributionEfficiency = eq.distributionEfficiency;
const fAge = eq.fAge;
const fAlcohol = eq.fAlcohol;
const fCreatine = eq.fCreatine;
const fEnergyMps = eq.fEnergyMps;
const fEnergyProtein = eq.fEnergyProtein;
const feedingStimulus = eq.feedingStimulus;
const fFreq = eq.fFreq;
const fFreqStrength = eq.fFreqStrength;
const fLoad = eq.fLoad;
const fLoadStrength = eq.fLoadStrength;
const fProtein = eq.fProtein;
const fRest = eq.fRest;
const fRir = eq.fRir;
const fVolume = eq.fVolume;
const hStrength = eq.hStrength;
const initialTrainingStatus = eq.initialTrainingStatus;
const kAgeMps = eq.kAgeMps;
const kernelAmp = eq.kernelAmp;
const kernelTau = eq.kernelTau;
const leanness = eq.leanness;
const nMax = eq.nMax;
const obesityRamp = eq.obesityRamp;
const proteinAdequacy = eq.proteinAdequacy;
const refractoryStep = eq.refractoryStep;
const trainedGains0 = eq.trainedGains0;
const vMaintenance = eq.vMaintenance;
const vRetention = eq.vRetention;

const RING = 7;

/** Constants of one run (parameters, precomputed factors, the event sink — kept out of the cloneable state). */
export type MuscleK = MuscleConstants;

export interface MuscleState {
  // ---------------------------------------------------------------- person (set at init)
  /** Height, m; 1 when the profile is female (03 leanness index), else 0. */
  heightM: number;
  female: number;
  /** 1 when the habitual week contains resistance sessions (09 §2 initial-value rules: H₀ = 1, N₀ > 0, T_low,0 = 0). */
  currentlyTraining: number;

  // ---------------------------------------------------------------- 09 §4.1 sets and 7-day window
  /** Effective sets per region per day, ring of 7 days (index r·7 + slot), sets. */
  setsHist: Float64Array;
  /** Next ring slot (0..6). */
  histIdx: number;
  /** Effective sets accumulated today per region, sets. */
  todaySets: Float64Array;
  /** V_r: 7-day effective sets, sets/wk; F_r: training days per region in the last 7 days, d/wk. */
  vR: Float64Array;
  fR: Float64Array;
  /** Effective and raw (entered) sets of the current session per region, sets (reset after a set-free hour). */
  sessEff: Float64Array;
  sessRaw: Float64Array;
  /** 1 while the previous hour contained resistance sets. */
  inSession: number;
  /** 1 on regions that had a set to failure today; 1 when the region's last session had failure sets. */
  failToday: Float64Array;
  lastFail: Float64Array;
  /** Days since the region last had an effective set (burn-in included; 1e6 = never), d. */
  daysSinceTrained: Float64Array;
  /** 21 §4D-4: effective sets of CWI-followed sessions × (1 − f_CWI) per region, ring of 7 days (r·7 + slot), today's
   *  accumulator per region, and the ring's daily totals (to skip the per-region sums when no CWI is in the window). */
  cwiLossHist: Float64Array;
  cwiLossToday: Float64Array;
  cwiDayTot: Float64Array;

  // ---------------------------------------------------------------- 09 §4.5-4.10 slow states per region
  /** Habituation H_r, 0..1. */
  hR: Float64Array;
  /** Oedema/swelling W_r, fraction of regional muscle volume. */
  wR: Float64Array;
  /** Training-attributable lean M_acc,r (FFM-equivalent), kg; its t = 0 value; its peak (memory), kg. */
  mAcc: Float64Array;
  mAcc0: Float64Array;
  mPeak: Float64Array;
  /** Non-detrainable set-point share of M_acc,r (all of M_acc,0 without habitual RT; with it, M_acc,0 minus the trained
   *  gains the body carries above its untrained FFMI-derived set-point — R-DETRAIN), kg. */
  mBase: Float64Array;
  /** R-DETRAIN retained floor of M_acc,r (set-point + detrainFloorFrac × the long-term trained gains at t = 0), kg:
   *  detraining decays towards it. */
  mFloor: Float64Array;
  /** Habitual reference gross accretion rate B_ref,r (the habitual week at maintenance, latched in endBurnIn; 0 without
   *  habitual RT), kg/d; this day's CWI factor f_CWI,r of the 7-day window. */
  bRef: Float64Array;
  cwiF: Float64Array;
  /** Genetic trainable potential G_pot,r, kg. */
  gPot: Float64Array;
  /** T_low,r: consecutive days with V_r < V_maint, d. */
  tLow: Float64Array;
  /** Neuromuscular fatigue Fat_r (09 §4.11), fraction. */
  fatR: Float64Array;

  // ---------------------------------------------------------------- 09 §4.14 strength
  /** Neural component N and its t = 0 value (strength index denominator is 1 + N0). */
  nNeural: number;
  strength0: number;
  /** Habitual-week means of (1 − Fat_acute) and of M_EA (strength index references, latched in endBurnIn), their
   *  burn-in rings (7 days) and fill count; 1 while the next recordDay is the t = 0 capture (index = 100 by definition). */
  fatRef: number;
  eaRef: number;
  fatRing: Float64Array;
  eaRing: Float64Array;
  baseCount: number;
  t0Rec: number;
  /** Skeletal muscle at t = 0 (latched at the end of burn-in), kg. */
  m0: number;
  /** Ring of daily raw RT sets and of sets·f_loadS (set-weighted strength load factor). */
  setsTotHist: Float64Array;
  loadSHist: Float64Array;
  todaySetsTot: number;
  todayLoadSW: number;

  // ---------------------------------------------------------------- 09 §4.4 kernel (per region) and 03 X_RT
  /** Current bout amplitude A(H)·a(s) and its age in whole hours since start (−1 = no bout in the ramp phase). */
  kAmp: Float64Array;
  kAge: Float64Array;
  /** Sum of earlier bouts in their exponential phase (value at the current hour midpoint). */
  kResid: Float64Array;
  /** Kernel amplitude of the current session already handed to the residual (long sessions), per region. */
  kCommit: Float64Array;
  /** exp(−1/τ(H_r)) per hour, refreshed daily; the H_r it was computed for. */
  kDecay: Float64Array;
  kDecayH: Float64Array;
  /** Cache of f_V(V_r): the V_r it was computed for (−1 = empty) and the value (V_r is constant under a weekly pattern). */
  fvV: Float64Array;
  fvF: Float64Array;
  /** S_mps,r this hour, fraction above basal. */
  sMps: Float64Array;
  kernelActive: number;
  /** 03 X_RT double-exponential sums (slow τ_X, fast τ_on) of bout stimuli I_b, and X_RT itself. */
  xSlow: number;
  xFast: number;
  xRT: number;
  xActive: number;
  /** exp(−1/τ_X) and exp(−0.5/τ_X), τ_X by whole-body habituation (36 h → 12 h). */
  xDecay: number;
  xHalf: number;

  // ---------------------------------------------------------------- 03 §4.7 hourly MPS display layer
  /** Muscle-full refractoriness R, 0..1. */
  refractoryR: number;
  /** MPS index = 100·MPS/s0 this hour, % of basal. */
  mpsIdx: number;
  /** AI_day: today's integral of feeding-stimulated MPS, %·d⁻¹ (diagnostic). */
  aiDay: number;
  /** K_age for today, g/kg FFM/h. */
  kAgeMpsVal: number;
  /** Today's FFM (kg) and sleep multiplier (bus values cached at startDay: bus reads are the costly ones). */
  ffmDay: number;
  sleepMult: number;
  /** f_E,MPS (relaxed, τ 2 d); AR_fed step component (relaxed); AR_fed total; b_X obesity multiplier. */
  fEMps: number;
  arSteps: number;
  arFed: number;
  bxMult: number;

  // ---------------------------------------------------------------- protein, energy and distribution
  /** 7-day ring of daily quality-weighted protein per kg body mass, g/kg/d (effective P of f_P, R-RT revised; 03 §4.2
   *  7-day integration, 03 §4.10 quality). */
  qRing: Float64Array;
  qIdx: number;
  /** Today's quality-weighted protein per kg body mass, g/kg/d (7-day mean → f_P and 09 ρ(P)). */
  qToday: number;
  /** Distribution efficiency E_dist of today (03 §4.8). */
  eDist: number;
  /** Scratch arrays for today's meals (clock h, Q_meal-weighted protein g, protein g). */
  mealT: Float64Array;
  mealQ: Float64Array;
  mealP: Float64Array;

  // ---------------------------------------------------------------- 15 §4.10 alcohol after training
  /** Ethanol pool at the end of the last training hour, g; alcohol dose counted today, g. */
  poolAtRt: number;
  alcDoseG: number;
  /** Protein eaten in the first 2 h after the session, g. */
  protWinG: number;
  /** Hours left in the 8-h alcohol window and the 2-h protein window. */
  winLeft: number;
  protLeft: number;
  /** 1 when the session-end pool still has to be added to the dose. */
  alcPending: number;
  /** 1 when a post-session window was open today; 1 when resistance sets occurred today. */
  winTouched: number;
  trainedToday: number;
  /** 7-day ring of energyBalanceFrac: 09 f_EP uses its mean e₇ (study-average balance; daily u swings ±0.1 between
   *  training and rest days because TEE_est includes the day's session). */
  eRing: Float64Array;
  /** 7-day ring of the day-specific accretion factors mpsSleepMult·f_alc·f_Cr·E_dist (their mean enters B_r; the day's
   *  value scales the day's share of the excess). */
  dRing: Float64Array;

  // ---------------------------------------------------------------- whole-body outputs
  /** Whole-body TS, mass-weighted V_wb (sets/wk), F_wb (d/wk), H_wb, CWI factor of V_wb, acute fatigue, strength index
   *  (% of baseline). */
  ts: number;
  vWb: number;
  fWb: number;
  hWb: number;
  cwiWb: number;
  fatAcute: number;
  strength: number;
  /** Σ M_acc,r at t = 0, kg. */
  mAcc0Sum: number;
  /** Today's Σ A_r and Σ D_r, kg/d. */
  accToday: number;
  detToday: number;
  /** 1 while the detrainingOnset event has fired and λ of the reference region stays > 0. */
  detrainFlag: number;
}

/** Index of the resistance session covering this clock hour, −1 when none matches. */
function rtSessionAt(day: DayInput, hourOfDay: number): number {
  for (let i = 0; i < day.nSessions; i++) {
    const se = day.sessions[i]!;
    if (se.kind !== 'resistance') continue;
    const end = se.startH + se.durationMin / 60;
    if (hourOfDay + 1 > se.startH && hourOfDay < end) return i;
  }
  return -1;
}

/** RT sessions of the habitual week (the rule of core/compileSchedule.habitualWeek: N = round(sessions/wk) in 0..7, a
 *  `lifingCardioMix` share of them cardio). */
export function habitualRtSessions(sessionsPerWeek: number, mix: number): number {
  const n = Math.max(0, Math.min(7, Math.round(Number.isFinite(sessionsPerWeek) ? sessionsPerWeek : 0)));
  const m = Math.max(0, Math.min(1, Number.isFinite(mix) ? mix : 0));
  let nRt = 0;
  for (let i = 0; i < n; i++) if (!(Math.floor((i + 1) * m + 1e-9) > Math.floor(i * m + 1e-9))) nRt++;
  return nRt;
}

/** 09 §4.14 neural target N_max(TS)·h_S(V_wb)·f_loadS·f_FS(F_wb)·f_CWI,wb from the 7-day rings. */
function neuralTarget(s: MuscleState, k: MuscleK): number {
  let sN = 0;
  let sW = 0;
  for (let j = 0; j < RING; j++) {
    sN += s.setsTotHist[j]!;
    sW += s.loadSHist[j]!;
  }
  return nMax(k, s.ts) * hStrength(k, s.vWb) * (sN > 0 ? sW / sN : 1) * fFreqStrength(k, s.fWb) * s.cwiWb;
}

const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);

/**
 * 09 §4.9 gross accretion rate of region r on 7-day inputs, kg/d: `common` = kG·f_P(P₇)·f_age·u·(7-day mean day factors),
 * × G_pot,r·(1 − TS_r)·f_V(V_r)·f_F(F_r)·f_EP(e, P₇, TS_r)·H_r·κ_mem·ρ_reg·f_CWI,r. Caches f_V.
 */
function grossRate(s: MuscleState, k: MuscleK, r: number, common: number, e: number, q7: number): number {
  const v = s.vR[r]!;
  if (!(v > 0)) return 0;
  const g = s.gPot[r]!;
  const m = s.mAcc[r]!;
  const ts = clamp(m / g, 0, k.tsCap);
  const kMem = m < k.memThreshold * s.mPeak[r]! ? k.kMem : 1;
  const rho = 1 + (k.rhoReg[r]! - 1) * (1 - ts);
  let fv = s.fvF[r]!;
  if (v !== s.fvV[r]) {
    fv = fVolume(k, v);
    s.fvV[r] = v;
    s.fvF[r] = fv;
  }
  return common * g * (1 - ts) * fv * fFreq(k, s.fR[r]!) * fEnergyProtein(k, e, q7, ts) * s.hR[r]! * kMem * rho * s.cwiF[r]!;
}

/**
 * 09 §4.6 initial whole-body training status of `prof` (TS₀ and the potential it implies): Y_eff = training years known to
 * the body module (entered, or derived by resolveProfile), else the habits history bucket. Exported for the R-MAINT
 * planned-activity estimator (post-RT REE shield, `core/activityReference.ts`).
 */
export function trainingStatus0(k: MuscleK, prof: ResolvedProfile): Ts0Result {
  const female = prof.sex === 'female';
  const unspecified = prof.input.sexUnspecified === true;
  const dPotSex = unspecified ? 0.5 * (k.dFfmiPotM + k.dFfmiPotF) : female ? k.dFfmiPotF : k.dFfmiPotM;
  const tr = prof.body.training;
  const hist = prof.input.habits?.trainingHistory;
  const yBody = finiteOr(tr.trainingYearsEffective, 0);
  let yEff = yBody;
  if (prof.input.body.trainingYears === undefined && !(yBody > 0) && hist !== undefined) {
    yEff = hist === 'lt1y' ? k.histYearsLt1 : hist === '1to3y' ? k.histYears1to3 : hist === 'gt3y' ? k.histYearsGt3 : 0;
  }
  return initialTrainingStatus(k, dPotSex, yEff, tr.ffmi, tr.ffmiUntrainedRef);
}

/**
 * R-DETRAIN (MODEL_SPEC §1.9): the trained gains a person carries at t = 0 above the untrained, FFMI-derived set-point
 * (`equations.trainedGains0`; 0 without RT in the habitual week — then all of M_acc,0 is set-point) and the part of them
 * detraining can remove, `(1 − detrainFloorFrac)·trained`, kg whole body. Gains accrued during a run add to the losable part.
 */
export function trainedGainsAtStart(k: MuscleK, prof: ResolvedProfile): { trainedKg: number; losableKg: number } {
  const hab = prof.habits;
  if (habitualRtSessions(hab.sessionsPerWeek, hab.lifingCardioMix) === 0) return { trainedKg: 0, losableKg: 0 };
  const ts0 = trainingStatus0(k, prof);
  const h = prof.heightM;
  const yEff = ts0.yearsEff ?? 0;
  const dTrain =
    prof.input.sexUnspecified === true
      ? 0.5 * (trainingFfmiOffset('male', yEff) + trainingFfmiOffset('female', yEff))
      : trainingFfmiOffset(prof.sex, yEff);
  const tr = prof.body.training;
  const g = trainedGains0(ts0.ts0 * ts0.dFfmiPot * h * h, h, tr.ffmi - tr.ffmiUntrainedRef, dTrain);
  return { trainedKg: g, losableKg: (1 - clamp(k.detrainFloorFrac, 0, 1)) * g };
}

export const muscleModule = defineModule<MuscleState, MuscleK>({
  id: 'muscle',
  specSection: '§1.9',
  dossiers: '09 §4.1-4.17; 03 §4.2/4.5/4.7/4.8/4.10/4.14; 15 §4.10/4.12; 16 §4.0.1; 19 §4.3; 21 §4D-3',
  params: MUSCLE_PARAMS,
  reads: [
    'raAaQGH', 'energyBalanceFrac', 'ffmActKg', 'skeletalMuscleKg', 'mpsSleepMult', 'creatineSatFrac', 'etohPoolG',
    'strengthEaMult', 'ageYears', 'tissueMassKg', 'muscleGlycogenRel',
  ],
  writes: ['rtAccretionKgD', 'rtRetentionFrac', 'rtDoseFrac', 'smRtKg', 'rtVolumeWb', 'mpsStimWb', 'trainingStatus'],
  records: ['mps', 'strength', 'trainingStatus', 'rtMuscleGain'],

  prepare: (ctx) => {
    return readMuscleConstants(ctx.params, ctx.seriesEnabled[MI_MPS] === 1, ctx.events);
  },

  init: (k, ctx, bus) => {
    const n = N_REGIONS;
    const prof = ctx.profile;
    const female = prof.sex === 'female';
    const hab = prof.habits;
    // "currently training" = the habitual week (burn-in) contains resistance sessions (R-BURNIN)
    const currentlyTraining = habitualRtSessions(hab.sessionsPerWeek, hab.lifingCardioMix) > 0;
    const ts0 = trainingStatus0(k, prof);
    const h = prof.heightM;
    const gPotWb = ts0.dFfmiPot * h * h;
    // R-DETRAIN: the trained gains a habitual lifter carries above the untrained, FFMI-derived set-point (0 without habitual
    // RT: then all of M_acc,0 is the set-point, the habitual body being the steady state); the floor keeps a share of them
    const gTrWb = trainedGainsAtStart(k, prof).trainedKg;

    const gPot = new Float64Array(n);
    const mAcc = new Float64Array(n);
    const mBase = new Float64Array(n);
    const mFloor = new Float64Array(n);
    const hR = new Float64Array(n);
    const tLow = new Float64Array(n);
    const daysSince = new Float64Array(n);
    const kDecay = new Float64Array(n);
    const tLow0 = currentlyTraining ? 0 : k.detrainOnsetD + k.detrainRampD;
    let mSum = 0;
    for (let r = 0; r < n; r++) {
      gPot[r] = k.w[r]! * gPotWb;
      mAcc[r] = ts0.ts0 * gPot[r]!;
      const base = mAcc[r]! - k.w[r]! * gTrWb;
      mBase[r] = base > 0 ? base : 0;
      mFloor[r] = detrainFloor(mAcc[r]!, mBase[r]!, k.detrainFloorFrac);
      hR[r] = currentlyTraining ? 1 : 0;
      tLow[r] = tLow0;
      daysSince[r] = 1e6;
      kDecay[r] = Math.exp(-1 / kernelTau(k, hR[r]!));
      mSum += mAcc[r]!;
    }
    const hWb = currentlyTraining ? 1 : 0;
    const tauX = k.p03.tauXUntrained + (k.p03.tauXTrained - k.p03.tauXUntrained) * hWb;
    const n0 = currentlyTraining ? k.n0Frac * nMax(k, ts0.ts0) : 0;
    const q0 = prof.habitualProteinG / Math.max(1, prof.weightKg);
    const qRing = new Float64Array(RING).fill(q0);
    const smBus = bus.skeletalMuscleKg;
    const m0 = Number.isFinite(smBus) && smBus > 0 ? smBus : prof.body.skeletalMuscleKg;

    bus.rtAccretionKgD = 0;
    bus.rtRetentionFrac = 0;
    bus.rtDoseFrac = 0;
    bus.smRtKg = 0;
    bus.rtVolumeWb = 0;
    bus.mpsStimWb = 0;
    bus.trainingStatus = ts0.ts0;

    return {
      heightM: h,
      female: female ? 1 : 0,
      currentlyTraining: currentlyTraining ? 1 : 0,
      setsHist: new Float64Array(n * RING),
      histIdx: 0,
      todaySets: new Float64Array(n),
      vR: new Float64Array(n),
      fR: new Float64Array(n),
      sessEff: new Float64Array(n),
      sessRaw: new Float64Array(n),
      inSession: 0,
      failToday: new Float64Array(n),
      lastFail: new Float64Array(n),
      daysSinceTrained: daysSince,
      cwiLossHist: new Float64Array(n * RING),
      cwiLossToday: new Float64Array(n),
      cwiDayTot: new Float64Array(RING),
      hR,
      wR: new Float64Array(n),
      mAcc,
      mAcc0: Float64Array.from(mAcc),
      mPeak: Float64Array.from(mAcc),
      mBase,
      mFloor,
      bRef: new Float64Array(n),
      cwiF: new Float64Array(n).fill(1),
      gPot,
      tLow,
      fatR: new Float64Array(n),
      nNeural: n0,
      strength0: 1 + n0,
      fatRef: 1,
      eaRef: 1,
      fatRing: new Float64Array(RING),
      eaRing: new Float64Array(RING),
      baseCount: 0,
      t0Rec: 0,
      m0,
      setsTotHist: new Float64Array(RING),
      loadSHist: new Float64Array(RING),
      todaySetsTot: 0,
      todayLoadSW: 0,
      kAmp: new Float64Array(n),
      kAge: new Float64Array(n).fill(-1),
      kResid: new Float64Array(n),
      kCommit: new Float64Array(n),
      kDecay,
      kDecayH: Float64Array.from(hR),
      fvV: new Float64Array(n).fill(-1),
      fvF: new Float64Array(n),
      sMps: new Float64Array(n),
      kernelActive: 0,
      xSlow: 0,
      xFast: 0,
      xRT: 0,
      xActive: 0,
      xDecay: Math.exp(-1 / tauX),
      xHalf: Math.exp(-0.5 / tauX),
      refractoryR: 0,
      mpsIdx: 100,
      aiDay: 0,
      kAgeMpsVal: kAgeMps(k.p03, prof.ageYears),
      ffmDay: prof.ffm0Kg,
      sleepMult: 1,
      fEMps: 1,
      arSteps: 1,
      arFed: 1,
      bxMult: 1,
      qRing,
      qIdx: 0,
      qToday: q0,
      eDist: 1,
      mealT: new Float64Array(MAX_MEALS),
      mealQ: new Float64Array(MAX_MEALS),
      mealP: new Float64Array(MAX_MEALS),
      poolAtRt: 0,
      alcDoseG: 0,
      protWinG: 0,
      winLeft: 0,
      protLeft: 0,
      alcPending: 0,
      winTouched: 0,
      trainedToday: 0,
      eRing: new Float64Array(RING),
      dRing: new Float64Array(RING).fill(1),
      ts: ts0.ts0,
      vWb: 0,
      fWb: 0,
      hWb,
      cwiWb: 1,
      fatAcute: 0,
      strength: 100,
      mAcc0Sum: mSum,
      accToday: 0,
      detToday: 0,
      detrainFlag: 0,
    };
  },

  startDay: (s, k, bus, day) => {
    s.t0Rec = 0;
    const age = bus.ageYears;
    const ffm = bus.ffmActKg > 1 ? bus.ffmActKg : 1;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : 1;
    s.kAgeMpsVal = kAgeMps(k.p03, age);
    s.ffmDay = ffm;
    s.sleepMult = bus.mpsSleepMult;
    // f_P input (R-RT revised): quality-weighted protein P·Q_daily (03 §4.10) per kg body mass; 09 ρ(P) uses plain g/kg.
    s.qToday = (day.proteinG * (day.proteinQDaily > 0 ? day.proteinQDaily : 1)) / bw;
    // 03 §4.8 distribution efficiency (meals are in clock order)
    const nm = day.nMeals < MAX_MEALS ? day.nMeals : MAX_MEALS;
    for (let i = 0; i < nm; i++) {
      const m = day.meals[i]!;
      s.mealT[i] = m.clockH;
      s.mealP[i] = m.proteinG;
      s.mealQ[i] = m.proteinG * m.proteinQMeal;
    }
    s.eDist = distributionEfficiency(k.p03, nm, s.mealT, s.mealQ, s.mealP, ffm, age);

    if (k.mpsEnabled) {
      // 03 §4.5 f_E,MPS with x_P (03 §4.4.2), first-order onset/offset τ 2 d
      const deficit = -bus.energyBalanceFrac;
      const bf = clamp((bw - ffm) / bw, 0, 0.9);
      const xP = proteinAdequacy(k.p03, (s.qToday * bw) / ffm, deficit, leanness(k.p03, bf, s.female === 1));
      const target = fEnergyMps(k.p03, deficit, xP);
      s.fEMps = target + (s.fEMps - target) * k.p03.eMpsF;
      // 03 §4.14 anabolic resistance of fed MPS: step reduction (older users, τ 5 d on / 7 d off) and obesity
      const arT = day.steps < k.p03.arStepsThreshold && age >= k.p03.arStepsAgeMin ? k.p03.arStepsFed : 1;
      s.arSteps = arT + (s.arSteps - arT) * (arT < s.arSteps ? k.p03.arOnF : k.p03.arOffF);
      const ob = obesityRamp(k.p03, bw / (s.heightM * s.heightM));
      s.arFed = s.arSteps * (1 - (1 - k.p03.arObese) * ob);
      s.bxMult = 1 - (1 - k.p03.bxObese) * ob;
    }
  },

  stepHour: (s, k, bus, hour, day) => {
    const n = N_REGIONS;
    // ---- 09 §4.1 effective sets of this hour
    let dI = 0;
    const setsTot = hour.rtSetsTotal;
    if (setsTot > 0) {
      const load = hour.rtLoadPct1RM > 0 ? hour.rtLoadPct1RM : RT_LOAD_DEFAULT;
      const rir = hour.rtToFailure > 0 ? 0 : hour.rtRir;
      const si = rtSessionAt(day, hour.hourOfDay);
      const sess = si >= 0 ? day.sessions[si]! : null;
      const mult = fRir(k, rir, load) * fLoad(k, load) * fRest(k, sess ? sess.restSec : RT_REST_DEFAULT) * k.fConc;
      // 21 §4D-4: sets of a session followed by cold-water immersion keep only f_CWI of their stimulus
      const cwiLoss = sess && sess.coldWaterImmersion === true ? 1 - k.fCwi : 0;
      const glyLow = bus.muscleGlycogenRel < k.fastHVGlycogenRel;
      const fail = hour.rtToFailure > 0 ? 1 : 0;
      const mps = k.mpsEnabled;
      for (let r = 0; r < n; r++) {
        const raw = hour.rtSetsByRegion[r]!;
        if (!(raw > 0)) continue;
        let eff = raw * mult;
        const before = s.sessRaw[r]!;
        if (glyLow) {
          // f_fastHV: sets beyond the 10th of this region in one session count ×0.95 when glycogen-depleted
          const over = Math.max(0, before + raw - k.fastHVSets) - Math.max(0, before - k.fastHVSets);
          eff -= over * mult * (1 - k.fFastHV);
        }
        s.sessRaw[r] = before + raw;
        const prevEff = s.sessEff[r]!;
        const newEff = prevEff + eff;
        s.sessEff[r] = newEff;
        s.todaySets[r] = s.todaySets[r]! + eff;
        if (cwiLoss > 0) s.cwiLossToday[r] = s.cwiLossToday[r]! + eff * cwiLoss;
        if (fail) s.failToday[r] = 1;
        // 09 §4.4 kernel: one bout per region and session; a(s) saturates on the session's effective sets
        const hr = s.hR[r]!;
        const ampNew = kernelAmp(k, hr, newEff);
        if (prevEff === 0) {
          // first sets of this region in this session; a still-ramping bout of an earlier session is frozen into the
          // residual at its current value (two sessions of one region < 3 h apart: approximation)
          if (s.kAge[r]! >= 0) {
            const ph = (s.kAge[r]! + 0.5) / k.kernelRampH;
            s.kResid[r] = s.kResid[r]! + s.kAmp[r]! * (ph < 1 ? ph : 1);
          }
          s.kAge[r] = 0;
          s.kCommit[r] = 0;
          s.kAmp[r] = ampNew;
        } else if (s.kAge[r]! >= 0) {
          s.kAmp[r] = ampNew - s.kCommit[r]!; // session continues inside the ramp phase of its bout
        } else {
          // session continues after its first bout entered the exponential phase: new bout with the increment
          s.kCommit[r] = kernelAmp(k, hr, prevEff);
          s.kAge[r] = 0;
          s.kAmp[r] = ampNew - s.kCommit[r]!;
        }
        // 03 §4.7 bout stimulus I_b (muscle-mass weighted, whole body; display layer only)
        if (mps) dI += k.w[r]! * (boutStimulus(k, newEff) - boutStimulus(k, prevEff));
      }
      s.inSession = 1;
      s.kernelActive = 1;
      s.todaySetsTot += setsTot;
      s.todayLoadSW += setsTot * fLoadStrength(k, load);
      s.trainedToday = 1;
      // 15 §4.10 window opens at the end of the session
      s.poolAtRt = bus.etohPoolG;
      s.alcPending = 1;
      s.winLeft = k.alcWindowH;
      s.protLeft = k.alcProtWindowH;
      s.protWinG = 0;
    } else {
      if (s.inSession) {
        for (let r = 0; r < n; r++) {
          s.sessEff[r] = 0;
          s.sessRaw[r] = 0;
        }
        s.inSession = 0;
      }
      if (s.winLeft > 0) {
        if (s.alcPending) {
          s.alcDoseG += s.poolAtRt;
          s.alcPending = 0;
        }
        s.alcDoseG += hour.alcoholG;
        s.winTouched = 1;
        if (s.protLeft > 0) {
          s.protWinG += hour.proteinG;
          s.protLeft -= 1;
        }
        s.winLeft -= 1;
      }
    }

    // ---- 09 §4.4 kernel value at the hour midpoint, then advance one hour
    let wb = 0;
    if (s.kernelActive) {
      let any = 0;
      const ramp = k.kernelRampH;
      const w = k.w;
      const kAge = s.kAge;
      const kAmp = s.kAmp;
      const kResid = s.kResid;
      const kDecay = s.kDecay;
      const sMps = s.sMps;
      for (let r = 0; r < n; r++) {
        const age = kAge[r]!;
        let v = kResid[r]!;
        if (age >= 0) {
          const dt = age + 0.5;
          if (dt < ramp) {
            v += (kAmp[r]! * dt) / ramp;
            kAge[r] = age + 1;
            any = 1;
          } else {
            v += kAmp[r]! * Math.exp(-(dt - ramp) / kernelTau(k, s.hR[r]!));
            kResid[r] = v;
            kAge[r] = -1;
            kAmp[r] = 0;
          }
        }
        sMps[r] = v;
        wb += w[r]! * v;
        const res = kResid[r]! * kDecay[r]!;
        if (res > 1e-9) {
          kResid[r] = res;
          any = 1;
        } else {
          kResid[r] = 0;
        }
      }
      s.kernelActive = any;
      if (!any) sMps.fill(0);
    }
    bus.mpsStimWb = wb;

    // ---- 03 §4.7 MPS display layer (never integrated into mass; skipped when the `mps` series is not requested)
    if (k.mpsEnabled) {
      // X_RT = Σ I_b·[e^{−Δ/τ_X} − e^{−Δ/τ_on}]/0.95 (midpoint value), τ_X by habituation
      if (dI > 0) {
        s.xSlow += dI * s.xHalf;
        s.xFast += dI * k.p03.xOnHalfF;
        s.xActive = 1;
      }
      let x = 0;
      if (s.xActive) {
        x = (s.xSlow - s.xFast) / k.p03.xNorm;
        if (x < 0) x = 0;
        s.xSlow *= s.xDecay;
        s.xFast *= k.p03.xOnF;
        if (s.xSlow < 1e-9) {
          s.xSlow = 0;
          s.xFast = 0;
          s.xActive = 0;
        }
      }
      s.xRT = x;
      // 03 §4.7B MPS index
      const xAa = bus.raAaQGH / s.ffmDay;
      const sFeed = feedingStimulus(xAa, s.kAgeMpsVal);
      const r0 = s.refractoryR;
      const r1 = refractoryStep(k.p03, r0, sFeed);
      s.refractoryR = r1;
      const rBar = 0.5 * (r0 + r1);
      const sleep = s.sleepMult;
      const basal = s.fEMps * (1 + k.p03.aX * x);
      const fed = s.fEMps * s.arFed * k.p03.aFed * sFeed * (1 - rBar) * (1 + k.p03.bX * s.bxMult * x);
      s.mpsIdx = 100 * (basal + fed) * sleep;
      s.aiDay += k.p03.s0 * fed * sleep;
    }
  },

  endOfDay: (s, k, bus, _day, clock) => {
    const n = N_REGIONS;
    // Burn-in (R-BURNIN): the habitual week runs every state except the training-attributable mass and events.
    const burn = clock.day < 0;
    const age = bus.ageYears;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : 1;
    const slot = s.histIdx;

    // 15 §4.10 alcohol after training; 15 §4.12 creatine; 16 sleep; 03 E_dist: the day-specific accretion factors
    let fAlc = 1;
    if ((s.winTouched || s.trainedToday) && s.alcDoseG > 0) {
      fAlc = fAlcohol(k, s.alcDoseG / bw, s.protWinG >= k.alcProtGkg * bw);
    }
    const dDay = bus.mpsSleepMult * fAlc * fCreatine(k, bus.creatineSatFrac) * s.eDist;

    // effective protein, energy balance and day factors = 7-day means (03 §4.2 integration window; 09's e is a
    // study-average balance)
    const qi = s.qIdx;
    s.qRing[qi] = s.qToday;
    s.eRing[qi] = bus.energyBalanceFrac;
    s.dRing[qi] = dDay;
    s.qIdx = (qi + 1) % RING;
    let q7 = 0;
    let e7 = 0;
    let d7 = 0;
    for (let j = 0; j < RING; j++) {
      q7 += s.qRing[j]!;
      e7 += s.eRing[j]!;
      d7 += s.dRing[j]!;
    }
    q7 /= RING;
    e7 /= RING;
    d7 /= RING;
    const common = k.kG * fProtein(k, q7) * fAge(k, age) * k.uIndividual * d7;
    const dShare = d7 > 0 ? dDay / d7 : 1;
    const vm = vMaintenance(k, age);

    // 21 §4D-4 CWI ring: today's total, and whether any CWI-followed session lies in the 7-day window
    let cwiTot = 0;
    for (let r = 0; r < n; r++) cwiTot += s.cwiLossToday[r]!;
    s.cwiDayTot[slot] = cwiTot;
    let cwiAny = 0;
    for (let j = 0; j < RING; j++) cwiAny += s.cwiDayTot[j]!;

    let accSum = 0;
    let detSum = 0;
    let vWb = 0;
    let fWb = 0;
    let hWb = 0;
    let lossWb = 0;
    let mSum = 0;
    let gSum = 0;
    let fatWb = 0;
    for (let r = 0; r < n; r++) {
      const sets = s.todaySets[r]!;
      const base = r * RING;
      s.setsHist[base + slot] = sets;
      s.cwiLossHist[base + slot] = s.cwiLossToday[r]!;
      let v = 0;
      let f = 0;
      for (let j = 0; j < RING; j++) {
        const x = s.setsHist[base + j]!;
        v += x;
        if (x > 0) f++;
      }
      s.vR[r] = v;
      s.fR[r] = f;
      let cwiF = 1;
      if (cwiAny > 0 && v > 0) {
        let loss = 0;
        for (let j = 0; j < RING; j++) loss += s.cwiLossHist[base + j]!;
        cwiF = 1 - loss / v;
        lossWb += k.w[r]! * loss;
      }
      s.cwiF[r] = cwiF;

      // 09 §4.5 habituation (exact daily exponentials) and swelling
      const h = f > 0 ? 1 - (1 - s.hR[r]!) * k.habUpF : s.hR[r]! * k.habDownF;
      s.hR[r] = h;
      const wT = k.swellA * (1 - h) * (v < k.swellVRef ? v / k.swellVRef : 1);
      s.wR[r] = wT + (s.wR[r]! - wT) * k.swellF;

      // 09 §4.10 low-volume day count (runs in burn-in as well)
      const tl = v < vm ? s.tLow[r]! + 1 : 0;
      s.tLow[r] = tl;

      const g = s.gPot[r]!;
      const m = s.mAcc[r]!;
      let mNew = m;
      if (!burn) {
        // 09 §4.9 accretion: excess of the gross rate over the habitual reference (0 without habitual RT); the day's
        // share follows its day factors. Below the previous peak (only reachable through detraining) the lost muscle is
        // regained at 09's full retraining rate — gap term, habituation and κ_mem, no reference subtracted — up to M_peak
        // (ruling R-REGAIN, 2026-10-01); beyond it the excess form holds, so the habitual week stays at its equilibrium.
        const gross = grossRate(s, k, r, common, e7, q7);
        const peak = s.mPeak[r]!;
        let a: number;
        if (m < peak) {
          a = gross * dShare;
          if (m + a > peak) a = peak - m;
        } else {
          const ex = gross - s.bRef[r]!;
          a = ex > 0 ? ex * dShare : 0;
        }
        // 09 §4.10 detraining, towards the retained floor (R-DETRAIN)
        const lam = detrainLambda(k, tl);
        const dyn = m - s.mFloor[r]!;
        const d = lam > 0 && dyn > 0 ? (lam * (1 - (v < vm ? v / vm : 1)) * dyn) / k.tauD : 0;
        mNew = m + a - d;
        if (mNew < s.mBase[r]!) mNew = s.mBase[r]!;
        if (mNew > g) mNew = g;
        s.mAcc[r] = mNew;
        if (mNew > s.mPeak[r]!) s.mPeak[r] = mNew;
        accSum += a;
        detSum += d;
      }

      // 09 §4.11 fatigue (performance only)
      const fail = s.failToday[r]!;
      if (sets > 0) s.lastFail[r] = fail;
      s.fatR[r] = s.fatR[r]! * (s.lastFail[r]! > 0 ? k.fatFailF : k.fatF) + k.cFat * sets * (1 + k.fatFailBoost * fail);
      s.daysSinceTrained[r] = sets > 0 ? 0 : s.daysSinceTrained[r]! + 1;

      const w = k.w[r]!;
      vWb += w * v;
      fWb += w * f;
      hWb += w * h;
      mSum += mNew;
      gSum += g;
      fatWb += w * (s.fatR[r]! < k.fatCap ? s.fatR[r]! : k.fatCap);
      if (Math.abs(h - s.kDecayH[r]!) > 1e-7) {
        s.kDecay[r] = Math.exp(-1 / kernelTau(k, h));
        s.kDecayH[r] = h;
      }
      s.todaySets[r] = 0;
      s.failToday[r] = 0;
      s.cwiLossToday[r] = 0;
    }
    s.histIdx = (slot + 1) % RING;
    const tsWb = gSum > 0 ? mSum / gSum : 0;
    s.ts = tsWb;
    s.vWb = vWb;
    s.fWb = fWb;
    s.hWb = hWb;
    s.cwiWb = vWb > 0 ? 1 - lossWb / vWb : 1;
    s.fatAcute = fatWb;
    s.accToday = accSum;
    s.detToday = detSum;

    // 03 X_RT decay constants for tomorrow (τ_X 36 h untrained → 12 h habituated; display layer only)
    if (k.mpsEnabled) {
      const tauX = k.p03.tauXUntrained + (k.p03.tauXTrained - k.p03.tauXUntrained) * hWb;
      s.xDecay = Math.exp(-1 / tauX);
      s.xHalf = Math.exp(-0.5 / tauX);
    }

    // 09 §4.14 neural strength component (R-STR slope)
    s.setsTotHist[slot] = s.todaySetsTot;
    s.loadSHist[slot] = s.todayLoadSW;
    if (vWb > 0) {
      const target = neuralTarget(s, k);
      s.nNeural = target + (s.nNeural - target) * k.nUpF;
    } else {
      s.nNeural *= k.nOffF;
    }

    if (burn) {
      // habitual-week references of the strength index (latched in endBurnIn)
      const ea = bus.strengthEaMult;
      s.fatRing[slot] = 1 - fatWb;
      s.eaRing[slot] = Number.isFinite(ea) && ea > 0 ? ea : 1;
      if (s.baseCount < RING) s.baseCount++;
    } else {
      // §7.1 detrainingOnset: λ > 0 in a region that had effective sets in the last 8 weeks (burn-in included); the
      // reference region is the one with the largest detrainable M_acc (above the R-DETRAIN floor)
      let best = -1;
      let bestM = -1;
      for (let r = 0; r < n; r++) {
        if (s.daysSinceTrained[r]! > k.detrainEventWindowD) continue;
        const dyn = s.mAcc[r]! - s.mFloor[r]! + 1e-9 * k.w[r]!;
        if (dyn > bestM) {
          bestM = dyn;
          best = r;
        }
      }
      const lamBest = best >= 0 ? detrainLambda(k, s.tLow[best]!) : 0;
      if (lamBest > 0) {
        if (!s.detrainFlag) {
          k.events.emit('detrainingOnset', clock.hourIndex, s.tLow[best]!);
          s.detrainFlag = 1;
        }
      } else {
        s.detrainFlag = 0;
      }
    }

    // daily signals (read by composition / energy / activity / wellbeing next day)
    const dose = clamp(vWb / vRetention(k, age), 0, 1);
    bus.rtAccretionKgD = accSum - detSum;
    bus.rtRetentionFrac = k.rMax * dose;
    bus.rtDoseFrac = dose;
    bus.smRtKg = burn ? 0 : k.smFrac * (mSum - s.mAcc0Sum);
    bus.rtVolumeWb = vWb;
    bus.trainingStatus = tsWb;

    // reset day accumulators (the alcohol/protein windows themselves carry over midnight)
    s.todaySetsTot = 0;
    s.todayLoadSW = 0;
    s.alcDoseG = 0;
    s.winTouched = 0;
    s.trainedToday = 0;
    s.aiDay = 0;
  },

  endBurnIn: (s, k, bus) => {
    // t = 0 references (R-BURNIN): training-attributable lean, skeletal muscle (composition has just reset SM₀)
    let m = 0;
    for (let r = 0; r < N_REGIONS; r++) {
      s.mAcc0[r] = s.mAcc[r]!;
      m += s.mAcc[r]!;
    }
    s.mAcc0Sum = m;
    const sm = bus.skeletalMuscleKg;
    if (Number.isFinite(sm) && sm > 0) s.m0 = sm;
    // habitual-training equilibrium: reference gross rate of the habitual week at maintenance (e = 0) and habitual
    // protein; energy re-anchors at maintenance, so the energy-balance ring restarts at 0
    s.eRing.fill(0);
    let q7 = 0;
    let d7 = 0;
    for (let j = 0; j < RING; j++) {
      q7 += s.qRing[j]!;
      d7 += s.dRing[j]!;
    }
    q7 /= RING;
    d7 /= RING;
    const common = k.kG * fProtein(k, q7) * fAge(k, bus.ageYears) * k.uIndividual * d7;
    for (let r = 0; r < N_REGIONS; r++) s.bRef[r] = s.currentlyTraining ? grossRate(s, k, r, common, 0, q7) : 0;
    // habitual trainee: the neural component sits at its equilibrium for the habitual week (09 §4.14 target), so the
    // strength index does not drift at habitual maintenance
    if (s.vWb > 0) s.nNeural = neuralTarget(s, k);
    s.strength0 = 1 + s.nNeural;
    // habitual-week means of (1 − Fat_acute) and M_EA: the index averages 100 over the habitual week
    const nb = s.baseCount;
    if (nb > 0) {
      let fa = 0;
      let ea = 0;
      for (let j = 0; j < RING; j++) {
        fa += s.fatRing[j]!;
        ea += s.eaRing[j]!;
      }
      s.fatRef = fa / nb;
      s.eaRef = ea / nb;
    } else {
      s.fatRef = 1 - s.fatAcute;
      const ea = bus.strengthEaMult;
      s.eaRef = Number.isFinite(ea) && ea > 0 ? ea : 1;
    }
    if (!(s.fatRef > 0)) s.fatRef = 1;
    s.t0Rec = 1;
    s.detrainFlag = 0;
    bus.rtAccretionKgD = 0;
    bus.smRtKg = 0;
    bus.trainingStatus = s.ts;
  },

  recordHour: (s, _k, _bus, out) => {
    out[MI_MPS] = s.mpsIdx;
  },

  recordDay: (s, k, bus, out) => {
    const sm = bus.skeletalMuscleKg;
    let ratio = s.m0 > 0 && Number.isFinite(sm) && sm > 0 ? sm / s.m0 : 1;
    if (k.strAlpha !== 1) ratio = Math.pow(ratio, k.strAlpha);
    // fatigue and M_EA relative to their habitual-week means; the t = 0 capture is the habitual mean itself (100)
    const fatTerm = s.t0Rec ? 1 : (1 - s.fatAcute) / s.fatRef;
    const ea = bus.strengthEaMult;
    const eaTerm = s.t0Rec ? 1 : (Number.isFinite(ea) && ea > 0 ? ea : 1) / s.eaRef;
    s.strength = (100 * (1 + s.nNeural) * ratio * fatTerm * eaTerm) / s.strength0;
    out[MI_STRENGTH] = s.strength;
    out[MI_TS] = 100 * s.ts;
    let m = 0;
    for (let r = 0; r < N_REGIONS; r++) m += s.mAcc[r]!;
    out[MI_RTGAIN] = m - s.mAcc0Sum;
  },
});
