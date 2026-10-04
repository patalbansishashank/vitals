/**
 * MODULE fuel — liver & muscle glycogen, carbohydrate disposal and oxidation, DNL, gluconeogenesis, fat oxidation
 * (residual), protein-oxidation bookkeeping, RQ.
 * Spec: docs/MODEL_SPEC.md §1.6 · Dossiers: 04 §4.1-4.13, §4.22 (owner); 01 §4.1 accounting; 20 §4.3.1/§4B.1 (fasting
 * muscle-glycogen rate k_Mf); 11 §4.2-4.4 (validation only). Review item M21 (HGO surplus) honoured as recommended.
 * Owned files: src/engine/model/fuel/** only.
 *
 * Carbohydrate currency. Inside `stepHour` every carbohydrate flow is booked in kcal so the ledger closes exactly across
 * the three conventions of MODEL_SPEC §0.2: absorbed carbohydrate 4.0 kcal/g, glycogen ρG 4.207 kcal/g, oxidised
 * carbohydrate 4.1 kcal/g (§1.6 step 4). Per hour:
 *   4·(Ra_glc + Ra_fru) + GNG_glycerol = 4.1·CHOox + 4.207·ΔG + 4·DNL_glc + 4·Δ(carry + fructose queue)   [kcal]
 * `choOxGH` is NET carbohydrate oxidation (calorimetric convention, 04 §4.11): glucose made from amino acids is booked
 * under protein oxidation and never counted again as carbohydrate; glycerol-derived glucose counts as carbohydrate (04
 * §4.11 `GNG_gly` in the glycogen balance). Fat oxidation is the residual of non-protein, non-alcohol energy (R-FUEL).
 *
 * Endogenous supply (04 §4.10 step 6; review M21 as ruled in docs/MODEL_SPEC_DECISIONS.md): liver glycogenolysis
 * J_L,out and resting-muscle lactate follow 04 as written. If they exceed the remaining demand, CHO oxidation rises to
 * consume them (bounded by EE_np; any rest stays in the liver, then returns as glucose next hour). If they fall short,
 * gluconeogenesis fills the gap, GNG = HGO − J_L,out − lactate, from its carbon sources in order: glycerol (capacity
 * 0.10·fatOx), then — outside fasts — lactate from demand-driven muscle glycogenolysis of glycogen above the fed
 * reference (counted as lactate), then amino-acid GNG up to 0.57·protOx, which enters `gngGH` but is booked as protein
 * (net convention) — so `gngGH` = min(HGO − J_L,out − lactate, 0.57·protOx + 0.10·fatOx) as ruled (R-HGO). When no
 * carbohydrate carbon is left (fasts: 20's k_Mf rule is the sole muscle route; or muscle at/below its reference) CHO
 * oxidation is reduced and fat covers the rest (spec §1.6 step 6). The muscle route is what lets f_C,pa ∝ (G_tot/G_ref)²
 * (the hourly form of 04 §4.11's Hall-type law) dispose of 45-70 %E carbohydrate without DNL (invariant O-3).
 * Symmetrically, muscle below the fed reference is refilled before exogenous glucose is oxidised (step 5), so depleted
 * muscle recovers after training on moderate carbohydrate intakes.
 * Integration pass (integrator A2, 2026-09-30): fuel tracks the EXERCISE-driven part of the muscle deficit (glycogen
 * removed by cardio/RT and not yet resynthesised) and publishes it as `muscleGlycogenExDefFrac` for 05's FFA term δ_M;
 * it publishes the liver capacity `liverGlycogenMaxG` for 05's partition half-point; the fasting muscle rule
 * −k_Mf·(G_M − 0.35·G_M0) is solved exactly over the hour with k_Mf read from the fasting module's registry entry.
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { ATWATER, RHO } from '../../core/defaults';
import { MI } from '../../types/metrics';
import type { EventSink, ModuleContext } from '../../types/module';
import { createSignalBus, type SignalBus } from '../../types/signals';
import { N_REGIONS } from '../../types/inputs';
import { FUEL_PARAMS, KMF_FALLBACK_PER_H } from './params';

/**
 * Burn-in re-equilibration (integrator A2): the last habitual burn-in week's hourly fuel inputs are recorded and, at
 * `endBurnIn`, replayed with TEE_pre rescaled to the week's mean absorbed energy (energy calibrates NEAT0 so that TEE =
 * EI_hab at the end of burn-in; glycogen would otherwise drift for a week after t = 0). Record layout per hour.
 */
const REC_H = 168;
const RF_GLC = 0;
const RF_FRU = 1;
const RF_PROT = 2;
const RF_ALC = 3;
const RF_INS = 4;
const RF_TEE = 5;
const RF_KETO = 6;
const RF_BRAIN = 7;
const RF_FAST = 8;
const RF_FASTPROT = 9;
const RF_LEAN = 10;
const RF_EXMIN = 11;
const RF_EXINT = 12;
const RF_EXKG = 13;
const RF_EXMOD = 14;
const RF_RTTOT = 15;
const RF_EABS = 16;
const RF_RT0 = 17;
const REC_W = RF_RT0 + N_REGIONS;
/** Daily record: skeletal muscle, S_mus, T_C. */
const REC_DW = 3;
/** Number of replayed weeks at endBurnIn (converges to < 0.1 g in the reference cases). */
const REPLAY_WEEKS = 6;

/** Muscle-glycogen groups (match body RegionalMuscle): 0 legs, 1 arms, 2 trunk. */
export const N_MUSCLE_GROUPS = 3;
export const G_LEGS = 0;
export const G_ARMS = 1;
export const G_TRUNK = 2;

/** g anhydro-glucosyl glycogen per mmol glucosyl unit (04 header; unit conversion). */
export const G_PER_MMOL = 0.162;
/** Engine energy conventions (MODEL_SPEC §0.2, core/defaults). */
const KCAL_CHO_IN = ATWATER.carb; // 4.0 kcal/g absorbed carbohydrate
const KCAL_PROT = ATWATER.protein; // 4.0 kcal/g protein oxidised (spec §1.6 step 4)
const KCAL_ALC = ATWATER.alcohol; // 7.0 kcal/g ethanol
const RHO_G = RHO.glycogenPerG; // 4.207 kcal/g glycogen
const RHO_F_G = RHO.fat / 1000; // 9.441 kcal/g fat tissue (DNL fat)

/**
 * Training region (types/inputs TRAINING_REGIONS order) → muscle group. Shoulders count with the arms (DXA arm region),
 * chest/upper back/core with the trunk, glutes/quads/hamstrings/calves with the legs. Structural mapping, no coefficient.
 */
const REGION_GROUP: readonly number[] = [G_TRUNK, G_TRUNK, G_ARMS, G_ARMS, G_TRUNK, G_LEGS, G_LEGS, G_LEGS, G_LEGS];
/** Cardio modality codes (types/inputs CARDIO_MODALITY_CODE) whose active muscle is spread over all groups (swim, row). */
const MOD_SWIM = 4;
const MOD_ROW = 5;

export interface FuelState {
  /** Liver glycogen G_L, g (anhydro-glucosyl). */
  liverG: number;
  /** Muscle glycogen concentration per group, mmol glucosyl/kg wet weight (04 §4.1). */
  cM: Float64Array;
  /** Skeletal muscle mass per group, kg (body regional split × composition's skeletalMuscleKg). */
  smmKg: Float64Array;
  /** Fixed share of skeletal muscle per group (body.muscle at t = 0), 1. */
  smmShare: Float64Array;
  /** Hour index of the last glycogen-depleting bout per group (drives E_ex and RT-session detection, 04 §4.5/§4.7). */
  lastDepletionHour: Float64Array;
  /** Initial concentration per group (exercise floor = 10 % of it, 04 §4.4), mmol/kg ww. */
  cM0: Float64Array;
  /** Concentration per group when the current fast started (20 §4.3.1 G_M0), mmol/kg ww. */
  cFast0: Float64Array;
  /**
   * Exercise-driven deficit per group, mmol/kg ww: glycogen removed by exercise and RT bouts (04 §4.4-4.5) that has not
   * been resynthesised yet (any muscle synthesis refills it first), never more than the deficit below the fed reference.
   * Resting (k_Mr) and fasting (k_Mf) glycogenolysis do not add to it. Published as `muscleGlycogenExDefFrac` for 05's
   * FFA term δ_M (integrator A2: 05 calibrated k_mgF on exercise depletion only; its fallback muscle does not fall at rest).
   */
  cExDef: Float64Array;
  /** Post-exercise synthesis enhancement E_ex = rapid + slow part at the start of the hour (04 §4.7), 1. */
  eRapid: Float64Array;
  eSlow: Float64Array;
  /** RT session bookkeeping per group: cumulative sets of the running session and the pre-session concentration. */
  rtSessionSets: Float64Array;
  rtPreC: Float64Array;
  /** Glucose carried to the next hour (04 §4.10 step 5, A3; incl. unused lactate glucose), g glucose (4 kcal/g). */
  carryGlcG: number;
  /** Fructose/galactose-derived glucose released next hour (04 §4.8 split), g glucose. */
  fruDelayedG: number;
  /**
   * 1-h delay line behind `fruDelayedG` (one slot per step: a single slot in the engine, 12 in the 5-min O-10
   * reference), g glucose, and the slot released this step.
   */
  fruRing: Float64Array;
  ringIdx: number;
  /** Deposited protein not yet covered by absorbed protein (keeps the daily protein ledger exact), g. */
  protDebtG: number;
  /** Liver capacity G_L,max = c_L,max·V_liv·0.162, g. */
  gLMaxG: number;
  /** Reference totals: liver at t = 0 (g) and normal-diet muscle concentration (Areta, mmol/kg ww). */
  gLRef0G: number;
  cMRef: number;
  /** Reference totals for f_C,pa (G_ref, initial G_tot at current SMM) and the fed muscle reference, g. */
  gRefG: number;
  gMuscleRefG: number;
  /** Capacity G_cap (04 §4.1), g. */
  gCapG: number;
  /** sqrt(S_mus) and sqrt(T_C) of yesterday (04 §4.7 factors), 1. */
  sqrtSMus: number;
  sqrtTC: number;
  /** 1 while the fasting overlay was active in the previous hour. */
  fastPrev: number;
  /** Glycerol-derived glucose booked as carbohydrate this hour, kcal (ledger term; tests). */
  gngGlyKcalH: number;
  /** Day accumulators, g (reset at startDay, so recordDay sees the finished day). */
  dayChoOxG: number;
  dayFatOxG: number;
  dayProtOxG: number;
  dayDnlFatG: number;
  dayGngG: number;
  /** Hourly fuel inputs of the last habitual burn-in week (REC_H × REC_W) and its days (7 × REC_DW); rows recorded. */
  rec: Float64Array;
  recDay: Float64Array;
  recN: number;
  /**
   * Habitual baselines latched at endBurnIn (lowest total and highest muscle glycogen of the replayed habitual week), g;
   * the glycogenLow / supercompensation events are relative to them, so none fires at steady state (integrator A2).
   */
  habMinTotG: number;
  habMaxMuscleG: number;
  /** Event latches (0/1): glycogenLow, glycogenFull, liverGlycogenLow, metabolic switch (G_L < 30 g), supercompensation. */
  evLow: number;
  evFull: number;
  evLiverLow: number;
  evSwitch: number;
  evSuper: number;
}

/** Constants (prepare): parameters and precomputed factors. */
export interface FuelConst {
  cLMax: number;
  vLiv: number;
  cMMax: number;
  hWater: number;
  fL: number; // exp(−1/τ_L)
  gLFloor: number;
  rHalf: number;
  liverExSlope: number;
  liverExThr: number;
  liverExSpare: number;
  gLRef: number;
  uEx75: number;
  uExOnset: number;
  uExSpan: number;
  uExExp: number;
  uExAvailExp: number;
  cMAvailRef: number;
  ketoEx: number;
  exFloorFrac: number;
  dMax: number;
  s0: number;
  rtAvailExp: number;
  kMr: number;
  cMFloor: number;
  ketoRest: number;
  kMf: number;
  fastAsym: number;
  sMax: number;
  kR: number;
  synCapExp: number;
  eRapid: number;
  eSlow: number;
  f1: number; // exp(−1/τ_E1)
  f2: number; // exp(−1/τ_E2)
  m1: number; // hour-mean factor τ_E1·(1 − f1)
  m2: number;
  protCredit: number;
  protCreditCap: number;
  protCreditChoMax: number;
  alphaGlc: number;
  alphaPost: number;
  alphaExThr: number;
  alphaFru: number;
  fruOx: number;
  vLSyn: number;
  fCpaRef: number;
  fCpaMin: number;
  fCpaMax: number;
  ketoOx: number;
  fCMax: number;
  ec50Sq: number;
  choKcal: number;
  fatKcal: number;
  brainGlc: number;
  brainSlope: number;
  otherGlc: number;
  dnlYield: number;
  dnlGate: number;
  gngProt: number;
  gly4: number; // kcal of glycerol glucose per g fat oxidised (0.10 × 4)
  cM0Dw: number;
  cM0Vo2Slope: number;
  cM0Vo2Ref: number;
  cM0HighCho: number;
  cM0HighChoGPerKg: number;
  dwPerWw: number;
  fProt: number;
  liverLowG: number;
  switchG: number;
  glycogenLowFrac: number;
  glycogenLowHabFrac: number;
  superCompFrac: number;
  vo2C: number;
  vo2F: number;
  vo2P: number;
  vco2C: number;
  vco2F: number;
  vco2P: number;
  bodyMassKg: number;
  /** Step geometry: the engine uses 1-h steps (1, 24, 60); the O-10 test builds a 5-min Euler reference with the same code. */
  stepsPerHour: number;
  stepsPerDay: number;
  minPerStep: number;
  /** Rate at which the carried-glucose pool counts as appearance flux (σ_fed, α_glc·A, Φ(R)): 1/h × Δt (1 in the engine). */
  carryFlux: number;
  /** Event sink of the run (emits only when clock.day ≥ 0). */
  events: EventSink;
  /** Scratch buffers (allocated once; never part of the snapshot state). */
  act: Float64Array;
  capK: Float64Array;
  capP: Float64Array;
  depleted: Float64Array;
  rtSets: Float64Array;
}

const pos = (x: number): number => (x > 0 ? x : 0);
/** Clamp to [0, 1]; NaN → 0. */
const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

function optParam(ctx: ModuleContext, id: string, fallback: number): number {
  return ctx.params.index.has(id) ? param(ctx.params, id) : fallback;
}

/**
 * Constants for one run. `stepH` = 1 in the engine (exact exponential factors, MODEL_SPEC §0.1). Tests may pass a
 * sub-hour step with `euler = true` to build the 5-min explicit-Euler reference of the same rule set (O-10); every
 * per-hour rate is then scaled to the step and decays use 1 − Δt/τ.
 */
export function prepareFuel(ctx: ModuleContext, stepH = 1, euler = false): FuelConst {
  const p = (id: string): number => param(ctx.params, `fuel.${id}`);
  const dt = stepH;
  const decay = (tau: number): number => (euler ? 1 - dt / tau : Math.exp(-dt / tau));
  const tauL = p('tauL');
  const tauE1 = p('tauE1');
  const tauE2 = p('tauE2');
  const f1 = decay(tauE1);
  const f2 = decay(tauE2);
  const ec50 = p('ec50Ox');
  return {
    cLMax: p('cLMax'),
    vLiv: p('vLiv'),
    cMMax: p('cMMax'),
    hWater: p('hWater'),
    fL: decay(tauL),
    gLFloor: p('gLFloor'),
    rHalf: p('rHalf') * dt,
    liverExSlope: p('liverExSlope'),
    liverExThr: p('liverExThreshold'),
    liverExSpare: p('liverExSpareCho'),
    gLRef: p('gLRef'),
    uEx75: p('uEx75'),
    uExOnset: p('uExOnset'),
    uExSpan: p('uExSpan'),
    uExExp: p('uExExp'),
    uExAvailExp: p('uExAvailExp'),
    cMAvailRef: p('cMAvailRef'),
    ketoEx: p('ketoExReduction'),
    exFloorFrac: p('exFloorFrac'),
    dMax: p('dMax'),
    s0: p('s0'),
    rtAvailExp: p('rtAvailExp'),
    kMr: p('kMr') * dt,
    cMFloor: p('cMFloor'),
    ketoRest: p('ketoRestReduction'),
    // k_Mf is owned by the fasting module (MODEL_SPEC §1.4 / §1.6) and read from its registry entry (the fallback serves
    // unit tests that register fuel alone). 20 §4.3.1's ODE dG_M/dt = −k_Mf·(G_M − 0.35·G_M0) is solved exactly over the
    // step: the step's fractional approach is 1 − e^{−k_Mf·Δt} (explicit Euler k_Mf·Δt in the O-10 reference).
    kMf: euler
      ? optParam(ctx, 'fasting.kMf', KMF_FALLBACK_PER_H) * dt
      : 1 - Math.exp(-optParam(ctx, 'fasting.kMf', KMF_FALLBACK_PER_H) * dt),
    fastAsym: p('fastMuscleAsymptote'),
    sMax: p('sMax') * dt,
    kR: p('kR'),
    synCapExp: p('synCapExp'),
    eRapid: p('eRapid'),
    eSlow: p('eSlow'),
    f1,
    f2,
    // hour-mean of the exponential enhancement over a step (closed form); the Euler reference uses the start value
    m1: euler ? 1 : ((tauE1 / dt) * (1 - f1)),
    m2: euler ? 1 : ((tauE2 / dt) * (1 - f2)),
    protCredit: p('protCredit'),
    protCreditCap: p('protCreditCap'),
    protCreditChoMax: p('protCreditChoMax'),
    alphaGlc: p('alphaGlc'),
    alphaPost: p('alphaGlcPostEx'),
    alphaExThr: p('alphaGlcExThreshold'),
    alphaFru: p('alphaFru'),
    fruOx: p('fruOx'),
    vLSyn: p('vLSyn') * dt,
    fCpaRef: p('fCpaRef'),
    fCpaMin: p('fCpaMin'),
    fCpaMax: p('fCpaMax'),
    ketoOx: p('ketoOxReduction'),
    fCMax: p('fCMax'),
    ec50Sq: ec50 * ec50,
    choKcal: p('choOxKcalPerG'),
    fatKcal: p('fatOxKcalPerG'),
    brainGlc: p('brainGlcGD'),
    brainSlope: p('brainKetoneSlope'),
    otherGlc: p('otherGlcGD'),
    dnlYield: p('dnlYield'),
    dnlGate: p('dnlGateFrac'),
    gngProt: p('gngProtYield'),
    gly4: p('gngGlycerolFrac') * KCAL_CHO_IN,
    cM0Dw: p('cM0Dw'),
    cM0Vo2Slope: p('cM0Vo2Slope'),
    cM0Vo2Ref: p('cM0Vo2Ref'),
    cM0HighCho: p('cM0HighCho'),
    cM0HighChoGPerKg: p('cM0HighChoGPerKg'),
    dwPerWw: p('dwPerWw'),
    fProt: p('fProt'),
    liverLowG: p('liverLowG'),
    switchG: p('switchG'),
    glycogenLowFrac: p('glycogenLowFrac'),
    glycogenLowHabFrac: p('glycogenLowHabFrac'),
    superCompFrac: p('superCompFrac'),
    vo2C: p('vo2PerGCho'),
    vo2F: p('vo2PerGFat'),
    vo2P: p('vo2PerGProt'),
    vco2C: p('vco2PerGCho'),
    vco2F: p('vco2PerGFat'),
    vco2P: p('vco2PerGProt'),
    bodyMassKg: ctx.profile.weightKg,
    stepsPerHour: 1 / dt,
    stepsPerDay: 24 / dt,
    minPerStep: 60 * dt,
    carryFlux: dt < 1 ? dt : 1,
    events: ctx.events,
    act: new Float64Array(N_MUSCLE_GROUPS),
    capK: new Float64Array(N_MUSCLE_GROUPS),
    capP: new Float64Array(N_MUSCLE_GROUPS),
    depleted: new Float64Array(N_MUSCLE_GROUPS),
    rtSets: new Float64Array(N_MUSCLE_GROUPS),
  };
}

/** Whole-body muscle glycogen, g. */
export function muscleGlycogenG(s: FuelState): number {
  let g = 0;
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) g += G_PER_MMOL * s.cM[j]! * s.smmKg[j]!;
  return g;
}

/** Recompute SMM-dependent references and capacity (init and startDay). */
function refreshReferences(s: FuelState, k: FuelConst): void {
  let smm = 0;
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) smm += s.smmKg[j]!;
  s.gMuscleRefG = G_PER_MMOL * s.cMRef * smm;
  s.gRefG = s.gLRef0G + s.gMuscleRefG;
  s.gCapG = s.gLMaxG + G_PER_MMOL * k.cMMax * smm;
}

export function initFuel(k: FuelConst, ctx: ModuleContext, vo2max: number): FuelState {
  const prof = ctx.profile;
  const body = prof.body;
  const gLMax = k.cLMax * k.vLiv * G_PER_MMOL;
  const liver0 = Math.min(gLMax, Math.max(0, body.glycogen.liverG));
  // 04 §2: c_M0 = (462 + 6.7·(VO2max − 53) + ΔCHO)/4.3; ΔCHO = +102 when habitual CHO ≥ 6 g/kg/d (the fed reference
  // itself uses ΔCHO = 0, i.e. the mixed-diet level that 05's δ_M coupling expects).
  const vo2 = Number.isFinite(vo2max) && vo2max > 0 ? vo2max : k.cM0Vo2Ref;
  const cRefRaw = (k.cM0Dw + k.cM0Vo2Slope * (vo2 - k.cM0Vo2Ref)) / k.dwPerWw;
  const cRef = Math.min(k.cMMax, Math.max(k.cMFloor, cRefRaw));
  const choPerKg = prof.weightKg > 0 ? prof.habitualCarbG / prof.weightKg : 0;
  const c0Raw = cRefRaw + (choPerKg >= k.cM0HighChoGPerKg ? k.cM0HighCho / k.dwPerWw : 0);
  const c0 = Math.min(k.cMMax, Math.max(k.cMFloor, c0Raw));
  const m = body.muscle;
  const regionSum = m.legsKg + m.armsKg + m.trunkKg;
  const smmShare = new Float64Array(N_MUSCLE_GROUPS);
  if (regionSum > 0) {
    smmShare[G_LEGS] = m.legsKg / regionSum;
    smmShare[G_ARMS] = m.armsKg / regionSum;
    smmShare[G_TRUNK] = m.trunkKg / regionSum;
  } else {
    // no regional split available: 04 §4.1's whole-body treatment (one pool) in the legs slot
    smmShare[G_LEGS] = 1;
  }
  const smmTotal = body.skeletalMuscleKg > 0 ? body.skeletalMuscleKg : regionSum;
  const smmKg = new Float64Array(N_MUSCLE_GROUPS);
  const cM = new Float64Array(N_MUSCLE_GROUPS);
  const cM0 = new Float64Array(N_MUSCLE_GROUPS);
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
    smmKg[j] = smmShare[j]! * smmTotal;
    cM[j] = smmKg[j]! > 0 ? c0 : 0;
    cM0[j] = cM[j]!;
  }
  const s: FuelState = {
    liverG: liver0,
    cM,
    smmKg,
    smmShare,
    lastDepletionHour: new Float64Array(N_MUSCLE_GROUPS).fill(-1e9),
    cM0,
    cFast0: Float64Array.from(cM),
    cExDef: new Float64Array(N_MUSCLE_GROUPS),
    eRapid: new Float64Array(N_MUSCLE_GROUPS),
    eSlow: new Float64Array(N_MUSCLE_GROUPS),
    rtSessionSets: new Float64Array(N_MUSCLE_GROUPS),
    rtPreC: Float64Array.from(cM),
    carryGlcG: 0,
    fruDelayedG: 0,
    fruRing: new Float64Array(Math.max(1, Math.round(k.stepsPerHour))),
    ringIdx: 0,
    protDebtG: 0,
    gLMaxG: gLMax,
    gLRef0G: liver0,
    cMRef: cRef,
    gRefG: 0,
    gMuscleRefG: 0,
    gCapG: 0,
    sqrtSMus: 1,
    sqrtTC: 1,
    fastPrev: 0,
    gngGlyKcalH: 0,
    dayChoOxG: 0,
    dayFatOxG: 0,
    dayProtOxG: 0,
    dayDnlFatG: 0,
    dayGngG: 0,
    rec: new Float64Array(REC_H * REC_W),
    recDay: new Float64Array(7 * REC_DW),
    recN: 0,
    habMinTotG: 0,
    habMaxMuscleG: 0,
    evLow: 0,
    evFull: 0,
    evLiverLow: 0,
    evSwitch: 0,
    evSuper: 0,
  };
  refreshReferences(s, k);
  s.habMinTotG = liver0 + muscleGlycogenG(s);
  s.habMaxMuscleG = muscleGlycogenG(s);
  return s;
}

/** x^e for x ≥ 0 with cheap paths for the exponents the dossier uses (0.5, 1, 1.5, 2). */
function powPos(x: number, e: number): number {
  if (x <= 0) return 0;
  if (e === 0.5) return Math.sqrt(x);
  if (e === 1.5) return x * Math.sqrt(x);
  if (e === 1) return x;
  if (e === 2) return x * x;
  return Math.pow(x, e);
}

/** Minimal views of the inputs the fuel step needs (the engine passes the real HourInput / StepClock). */
export interface FuelHourView {
  exModality: number;
  rtSetsByRegion: Float64Array;
  rtSetsTotal: number;
}

/**
 * One hour of 04 §4.10 (MODEL_SPEC §1.6 steps 1-8). Allocation-free. `emit` is false during burn-in and in tests that
 * do not care about events.
 */
export function stepFuelHour(
  s: FuelState,
  k: FuelConst,
  bus: SignalBus,
  hour: FuelHourView,
  hourIndex: number,
  events: EventSink | null,
): void {
  const glc = pos(bus.raGlcGH);
  const fru = pos(bus.raFruGalGH);
  const prot = pos(bus.raProtGH);
  const alc = pos(bus.alcOxGH);
  const ins = pos(bus.insulinUuMl);
  const tee = pos(bus.teePreKcalH);
  const aKeto = clamp01(bus.ketoAdaptFast);
  const kShare = clamp01(bus.brainKetoneShare);
  const fast = bus.fastActive > 0.5;
  const cM = s.cM;
  const smm = s.smmKg;

  // fast start: remember G_M0 per group (20 §4.3.1)
  if (fast && s.fastPrev === 0) for (let j = 0; j < N_MUSCLE_GROUPS; j++) s.cFast0[j] = cM[j]!;
  s.fastPrev = fast ? 1 : 0;

  const gL0 = s.liverG;
  const gM0 = muscleGlycogenG(s);
  const gTot0 = gL0 + gM0;

  // ---- step 7 first (EE_np needs it): protein oxidation = absorbed − deposited (fasts: the fasting module's rate)
  let protOx: number;
  if (fast) {
    protOx = prot + pos(bus.fastProtOxGH);
    s.protDebtG = 0;
  } else {
    const depH = (bus.leanRateKgD * 1000 * k.fProt) / k.stepsPerDay;
    const want = prot - depH - s.protDebtG;
    if (want >= 0) {
      protOx = want;
      s.protDebtG = 0;
    } else {
      protOx = 0;
      const cap = depH > 0 ? k.stepsPerDay * depH : 0;
      s.protDebtG = -want < cap ? -want : cap;
    }
  }
  let eeNp = tee - KCAL_PROT * protOx - KCAL_ALC * alc;
  if (eeNp < 0) eeNp = 0;

  // ---- step 1: exogenous supply and fructose/galactose first pass (04 §4.8)
  let fruGly = (k.alphaFru * fru * KCAL_CHO_IN) / RHO_G; // g glycogen
  const oxFru = k.fruOx * fru * KCAL_CHO_IN; // kcal, obligatory hepatic oxidation
  let fruNext = (1 - k.alphaFru - k.fruOx) * fru; // g glucose released next hour
  // fructose-derived glucose appears after a 1-h delay (04 §4.8); carried glucose (§4.10 step 5) is a pool that is
  // fully available as supply and counts as appearance flux at its hourly rate (identical at Δt = 1 h)
  const slot = s.ringIdx;
  const fruIn = s.fruRing[slot]!;
  const carryIn = s.carryGlcG;
  const aG = glc + fruIn + carryIn; // g glucose-equivalent available this step
  const aFlux = glc + fruIn + carryIn * k.carryFlux; // g glucose-equivalent appearance this step
  const sigma = k.rHalf > 0 ? (aFlux >= k.rHalf ? 1 : aFlux / k.rHalf) : 1;

  // ---- step 2: liver glycogenolysis (exact 1-h form of 04 §4.2) + exercise term (04 §4.3)
  const availL = gL0 > k.gLFloor ? gL0 - k.gLFloor : 0;
  let jL = availL * (1 - k.fL) * (1 - sigma);
  const exMin = bus.exMinutesH > k.minPerStep ? k.minPerStep : bus.exMinutesH > 0 ? bus.exMinutesH : 0;
  const inten = bus.exIntensityFrac > 0 ? bus.exIntensityFrac : 0;
  let jLex = 0;
  if (exMin > 0 && inten > k.liverExThr) {
    // CHO eaten during exercise arrives through intake as glucose (review M8): its appearance rate is the ingestion rate
    const choEx = (glc + fru) / k.minPerStep; // g/min
    const spare = 1 - (choEx >= k.liverExSpare ? 1 : choEx / k.liverExSpare);
    jLex = k.liverExSlope * (inten - k.liverExThr) * Math.sqrt(gL0 > 0 ? gL0 / k.gLRef : 0) * spare * (exMin / 60);
  }
  jL += jLex;
  if (jL > availL) jL = availL;
  // liver synthesis S_L = min(V_L,syn, α_glc·A·(1 − G_L/G_L,max)^0.5 + α_fru·Ra_fru), capped by capacity
  // α_glc = 0.10 while any E_ex,j > 0.3, else 0.20 (04 §4.8). Closed form of the switch over the step: the fraction of
  // the step spent above the threshold, from E at the start and end of the step (linear in between).
  let eMax0 = 0;
  let eMax1 = 0;
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
    const e0 = s.eRapid[j]! + s.eSlow[j]!;
    const e1 = s.eRapid[j]! * k.f1 + s.eSlow[j]! * k.f2;
    if (e0 > eMax0) eMax0 = e0;
    if (e1 > eMax1) eMax1 = e1;
  }
  let fracPost = 0;
  if (eMax1 > k.alphaExThr) fracPost = 1;
  else if (eMax0 > k.alphaExThr) fracPost = (eMax0 - k.alphaExThr) / (eMax0 - eMax1);
  const alpha = k.alphaGlc + (k.alphaPost - k.alphaGlc) * fracPost;
  const gLMax = s.gLMaxG;
  const head = gL0 < gLMax ? Math.sqrt(1 - gL0 / gLMax) : 0;
  let room = gLMax - gL0 + jL;
  if (room < 0) room = 0;
  const maxSyn = k.vLSyn < room ? k.vLSyn : room;
  if (fruGly > maxSyn) {
    fruNext += ((fruGly - maxSyn) * RHO_G) / KCAL_CHO_IN;
    fruGly = maxSyn;
  }
  let lUpG = (alpha * aFlux * head * KCAL_CHO_IN) / RHO_G;
  if (lUpG > maxSyn - fruGly) lUpG = maxSyn - fruGly;
  if (lUpG < 0) lUpG = 0;
  const a1 = KCAL_CHO_IN * aG - lUpG * RHO_G; // kcal

  // ---- step 3: muscle — exercise use (04 §4.4), RT depletion (04 §4.5), resting glycogenolysis → lactate (04 §4.6 / 20)
  const act = k.act;
  const depleted = k.depleted;
  let xG = 0; // glycogen released in exercise, g
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
    act[j] = 0;
    depleted[j] = 0;
  }
  const activeKg = bus.exActiveMuscleKg > 0 ? bus.exActiveMuscleKg : 0;
  if (exMin > 0 && inten > k.uExOnset && activeKg > 0) {
    // active muscle per group: swim/row over all groups by SMM; other modalities legs first, then trunk, then arms
    if (hour.exModality === MOD_SWIM || hour.exModality === MOD_ROW) {
      let tot = 0;
      for (let j = 0; j < N_MUSCLE_GROUPS; j++) tot += smm[j]!;
      const f = tot > 0 ? (activeKg < tot ? activeKg / tot : 1) : 0;
      for (let j = 0; j < N_MUSCLE_GROUPS; j++) act[j] = smm[j]! * f;
    } else {
      let left = activeKg;
      const a0 = left < smm[G_LEGS]! ? left : smm[G_LEGS]!;
      act[G_LEGS] = a0;
      left -= a0;
      const a2t = left < smm[G_TRUNK]! ? left : smm[G_TRUNK]!;
      act[G_TRUNK] = a2t;
      left -= a2t;
      act[G_ARMS] = left < smm[G_ARMS]! ? left : smm[G_ARMS]!;
    }
    const u = k.uEx75 * powPos((inten - k.uExOnset) / k.uExSpan, k.uExExp); // mmol/kg ww/min
    const ketoF = 1 - k.ketoEx * aKeto;
    for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
      const aj = act[j]!;
      const mj = smm[j]!;
      if (aj <= 0 || mj <= 0) continue;
      const c = cM[j]!;
      const U = u * powPos(c / k.cMAvailRef, k.uExAvailExp) * ketoF;
      let dc = (U * exMin * aj) / mj;
      const floorJ = k.exFloorFrac * s.cM0[j]!;
      const maxDc = c > floorJ ? c - floorJ : 0;
      if (dc > maxDc) dc = maxDc;
      if (dc > 0) {
        cM[j] = c - dc;
        s.cExDef[j] = s.cExDef[j]! + dc;
        xG += dc * G_PER_MMOL * mj;
        depleted[j] = 1;
      }
    }
  }
  if (hour.rtSetsTotal > 0) {
    const rs = k.rtSets;
    rs[0] = 0;
    rs[1] = 0;
    rs[2] = 0;
    const sets = hour.rtSetsByRegion;
    const n = sets.length < REGION_GROUP.length ? sets.length : REGION_GROUP.length;
    for (let r = 0; r < n; r++) {
      const v = sets[r]!;
      if (v > 0) {
        const g = REGION_GROUP[r]!;
        rs[g] = rs[g]! + v;
      }
    }
    for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
      const nSets = rs[j]!;
      const mj = smm[j]!;
      if (nSets <= 0 || mj <= 0) continue;
      if (hourIndex - s.lastDepletionHour[j]! > 1 || s.rtSessionSets[j]! <= 0) {
        s.rtSessionSets[j] = 0;
        s.rtPreC[j] = cM[j]!;
      }
      s.rtSessionSets[j] = s.rtSessionSets[j]! + nSets;
      const pre = s.rtPreC[j]!;
      const d = k.dMax * (1 - Math.exp(-s.rtSessionSets[j]! / k.s0));
      const target = pre * (1 - d * powPos(pre / k.cMAvailRef, k.rtAvailExp));
      const floorJ = k.exFloorFrac * s.cM0[j]!;
      const c = cM[j]!;
      const dc = c - (target > floorJ ? target : floorJ);
      if (dc > 0) {
        cM[j] = c - dc;
        s.cExDef[j] = s.cExDef[j]! + dc;
        xG += dc * G_PER_MMOL * mj;
      }
      depleted[j] = 1;
    }
  } else {
    for (let j = 0; j < N_MUSCLE_GROUPS; j++) if (hourIndex - s.lastDepletionHour[j]! > 1) s.rtSessionSets[j] = 0;
  }
  let lacG = 0; // resting glycogenolysis released as lactate to the liver (not oxidised), g
  const restF = (1 - sigma) * (1 - k.ketoRest * aKeto);
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
    const mj = smm[j]!;
    if (mj <= 0) continue;
    const c = cM[j]!;
    const r = fast ? k.kMf * (c - k.fastAsym * s.cFast0[j]!) : k.kMr * (c - k.cMFloor) * restF;
    if (r > 0) {
      cM[j] = c - r;
      lacG += r * G_PER_MMOL * mj;
    }
  }

  // ---- step 4: oxidation demand (net carbohydrate, kcal)
  const gRatio = s.gRefG > 0 ? gTot0 / s.gRefG : 1;
  let fCpa = k.fCpaRef * gRatio * gRatio * (1 - k.ketoOx * aKeto);
  if (fCpa < k.fCpaMin) fCpa = k.fCpaMin;
  else if (fCpa > k.fCpaMax) fCpa = k.fCpaMax;
  // Ins²/(Ins² + EC50²) written as 1/(1 + EC50²/Ins²) so that infinite insulin gives 1, not NaN
  const insTerm = ins > 0 ? 1 / (1 + k.ec50Sq / (ins * ins)) : 0;
  const fC = fCpa + (k.fCMax - fCpa) * insTerm;
  let demand = fC * eeNp;
  // brain/obligatory glucose floor (04 §4.22 formula, ketone share from 05); protein-derived glucose covers part of it
  let brain = k.brainGlc * (1 - k.brainSlope * kShare);
  if (brain < 0) brain = 0;
  const needG = (brain + k.otherGlc) / k.stepsPerDay - k.gngProt * protOx;
  const floorK = needG > 0 ? needG * k.choKcal : 0;
  if (floorK > demand) demand = floorK;
  const xK = xG * RHO_G;
  const exNeed = xK + jLex * RHO_G; // glycogen broken down for work is oxidised first (04 §4.3-4.5)
  if (exNeed > demand) demand = exNeed;
  if (demand > eeNp) demand = eeNp;

  // ---- step 5: allocation (fructose, exercise glycogen, [refill of depleted muscle], exogenous glucose, muscle, DNL/carry)
  let rem = demand - oxFru;
  if (rem < 0) rem = 0;
  const xOx = xK < rem ? xK : rem;
  rem -= xOx;
  const xLac = xK - xOx;
  // muscle synthesis capacity S_M,j (04 §4.7), kcal per step; the part that refills glycogen below the fed reference
  // is served before exogenous oxidation (low glycogen activates glycogen synthase, 04 §4.7; insulin-stimulated glucose
  // uptake is mostly muscle glycogen synthesis, 04 §4.10) — above the reference 04 §4.10 step 5's order holds
  const bw = k.bodyMassKg > 0 ? k.bodyMassKg : 70;
  const rCho = (aFlux * k.stepsPerHour) / bw; // g/kg/h
  const rProt = (prot * k.stepsPerHour) / bw;
  const rEff = rCho + (rCho < k.protCreditChoMax ? k.protCredit * (rProt < k.protCreditCap ? rProt : k.protCreditCap) : 0);
  const phi = rEff > 0 ? rEff / (rEff + k.kR) : 0;
  const capK = k.capK;
  const capP = k.capP;
  let capTot = 0;
  let capPri = 0;
  if (phi > 0 && a1 > 0) {
    const base = k.sMax * phi * s.sqrtSMus * s.sqrtTC;
    for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
      const mj = smm[j]!;
      const c = cM[j]!;
      let cap = 0;
      let pri = 0;
      if (mj > 0 && c < k.cMMax) {
        const q = c / k.cMMax;
        const q2 = q * q;
        const sat = k.synCapExp === 4 ? 1 - q2 * q2 : 1 - Math.pow(q, k.synCapExp);
        const e = s.eRapid[j]! * k.m1 + s.eSlow[j]! * k.m2;
        let sm = base * sat * (1 + e); // mmol/kg ww per step
        const headC = k.cMMax - c;
        if (sm > headC) sm = headC;
        if (sm > 0) {
          cap = sm * G_PER_MMOL * mj * RHO_G;
          const below = s.cMRef - c;
          if (below > 0) pri = (below < sm ? below : sm) * G_PER_MMOL * mj * RHO_G;
        }
      }
      capK[j] = cap;
      capP[j] = pri;
      capTot += cap;
      capPri += pri;
    }
  }
  const mPri = a1 < capPri ? a1 : capPri;
  const oxAvail = a1 - mPri;
  const oxEx = oxAvail < rem ? oxAvail : rem;
  rem -= oxEx;
  const a2 = oxAvail - oxEx;
  const capRest = capTot - capPri;
  const mRest = a2 < capRest ? a2 : capRest;
  if (mPri > 0 || mRest > 0) {
    for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
      const pri = capP[j]!;
      const restJ = capK[j]! - pri;
      const add = (pri > 0 ? (mPri * pri) / capPri : 0) + (restJ > 0 && capRest > 0 ? (mRest * restJ) / capRest : 0);
      if (add > 0) {
        const dcAdd = add / (RHO_G * G_PER_MMOL * smm[j]!);
        cM[j] = cM[j]! + dcAdd;
        const ed = s.cExDef[j]! - dcAdd; // resynthesis refills the exercise-driven deficit first
        s.cExDef[j] = ed > 0 ? ed : 0;
      }
    }
  }
  let a3 = a2 - mRest; // kcal

  // ---- step 6: endogenous supply (liver + lactate), glycerol GNG, amino-acid GNG (display), review M21
  const jLK = jL * RHO_G;
  const kSup = jLK + lacG * RHO_G + xLac;
  let endoOx: number;
  let gGlyK = 0;
  let gngP = 0; // amino-acid GNG used, g glucose
  let retK = 0;
  if (kSup >= rem) {
    let headE = eeNp - (oxFru + xOx + oxEx);
    if (headE < rem) headE = rem;
    endoOx = kSup < headE ? kSup : headE;
    retK = kSup - endoOx;
  } else {
    // supply short of demand: GNG fills the gap (M21) from glycerol (capacity 0.10·fatOx), then — outside fasts — from
    // lactate of demand-driven muscle glycogenolysis; during fasts 20's k_Mf rule is the only muscle route, so any rest
    // reduces CHO oxidation (fat covers it, step 6).
    const gap = rem - kSup;
    const choFixed = oxFru + xOx + oxEx + kSup;
    let availM = 0;
    if (!fast) {
      // only glycogen above the fed (normal-diet) reference is mobilised on demand: a depleted muscle conserves its
      // glycogen (synthase active, 04 §4.7), so below the reference only the k_Mr lactate route (04 §4.6) remains
      for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
        const ex = cM[j]! - s.cMRef;
        const w = ex > 0 ? ex * G_PER_MMOL * smm[j]! * RHO_G : 0;
        capK[j] = w;
        availM += w;
      }
    }
    const glyAtD = (k.gly4 * (eeNp - (choFixed + gap))) / k.fatKcal; // glycerol if CHOox reaches the demand
    let mOx: number;
    if (availM + (glyAtD > 0 ? glyAtD : 0) >= gap) {
      gGlyK = glyAtD > 0 ? (glyAtD < gap ? glyAtD : gap) : 0;
      mOx = gap - gGlyK;
    } else {
      mOx = availM;
      const free = eeNp - choFixed - availM;
      const glyCap = free > 0 ? (k.gly4 * free) / (k.fatKcal + k.gly4) : 0;
      gGlyK = gap - availM < glyCap ? gap - availM : glyCap;
    }
    if (mOx > 0 && availM > 0) {
      const f = mOx / availM;
      for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
        const w = capK[j]!;
        if (w > 0) cM[j] = cM[j]! - (w * f) / (RHO_G * G_PER_MMOL * smm[j]!);
      }
    } else mOx = 0;
    endoOx = kSup + gGlyK + mOx;
    // amino-acid GNG covers what is still missing, up to its capacity 0.57·protOx (R-HGO); its glucose is booked under
    // protein oxidation (net convention, 04 §4.11), so it reduces net CHO oxidation and never enters choOxGH
    const pGap = (gap - gGlyK - mOx) / k.choKcal;
    const pCap = k.gngProt * protOx;
    gngP = pGap <= 0 ? 0 : pGap < pCap ? pGap : pCap;
  }
  if (retK > 0) {
    // unused endogenous glucose: glycogenolysis that was not needed stays in the liver, lactate returns as glucose
    const back = retK < jLK ? retK : jLK;
    jL -= back / RHO_G;
    retK -= back;
    a3 += retK;
  }
  const choOxK = oxFru + xOx + oxEx + endoOx;

  // ---- state update: liver (clamped to capacity, overflow returns as glucose), DNL gate, queues
  let gL1 = gL0 + fruGly + lUpG - jL;
  if (gL1 > gLMax) {
    a3 += (gL1 - gLMax) * RHO_G;
    gL1 = gLMax;
  }
  if (gL1 < 0) gL1 = 0;
  s.liverG = gL1;
  const gM1 = muscleGlycogenG(s);
  const gTot1 = gL1 + gM1;
  let dnlK = 0;
  let carryAdd = 0;
  if (a3 > 0) {
    if (gTot1 >= k.dnlGate * s.gCapG) dnlK = a3;
    else carryAdd = a3 / KCAL_CHO_IN;
  }
  s.carryGlcG = carryAdd;
  s.fruRing[slot] = fruNext;
  s.ringIdx = slot + 1 < s.fruRing.length ? slot + 1 : 0;
  s.fruDelayedG = s.fruDelayedG - fruIn + fruNext;
  if (s.fruDelayedG < 0) s.fruDelayedG = 0;
  s.gngGlyKcalH = gGlyK;

  // E_ex decay over the hour, reset after depleting bouts (04 §4.7)
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
    if (depleted[j]! > 0) {
      s.eRapid[j] = k.eRapid;
      s.eSlow[j] = k.eSlow;
      s.lastDepletionHour[j] = hourIndex;
    } else {
      s.eRapid[j] = s.eRapid[j]! * k.f1;
      s.eSlow[j] = s.eSlow[j]! * k.f2;
    }
  }

  // exercise-driven deficit never exceeds the deficit below the fed reference (a muscle above it has none)
  let exDefG = 0;
  for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
    const below = s.cMRef - cM[j]!;
    let ed = s.cExDef[j]!;
    if (ed > below) ed = below > 0 ? below : 0;
    s.cExDef[j] = ed;
    exDefG += ed * G_PER_MMOL * smm[j]!;
  }

  // ---- step 8: outputs
  const choOxG = choOxK / k.choKcal;
  let fatOxG = (eeNp - choOxK) / k.fatKcal;
  if (fatOxG < 0) fatOxG = 0;
  const dnlGlcG = dnlK / KCAL_CHO_IN;
  const dnlFatG = dnlGlcG * k.dnlYield;
  // GNG = HGO − J_L,out − lactate (demand-driven muscle lactate included), capped by 0.57·protOx + 0.10·fatOx (R-HGO)
  const gngG = gGlyK / KCAL_CHO_IN + gngP;
  bus.liverGlycogenG = gL1;
  bus.muscleGlycogenG = gM1;
  bus.muscleGlycogenRel = s.gMuscleRefG > 0 ? gM1 / s.gMuscleRefG : 1;
  bus.muscleGlycogenExDefFrac = s.gMuscleRefG > 0 ? exDefG / s.gMuscleRefG : 0;
  bus.choOxGH = choOxG;
  bus.fatOxGH = fatOxG;
  bus.protOxGH = protOx;
  bus.dnlFatGH = dnlFatG;
  bus.dnlHeatKcalH = dnlK - RHO_F_G * dnlFatG;
  bus.gngGH = gngG;
  bus.glycogenChangeKcalH = RHO_G * (gTot1 - gTot0);
  // RQ (04 §4.12): net lipogenesis appears as extra CHO use and negative fat oxidation (Frayn); alcohol excluded
  const cUse = choOxG + dnlGlcG;
  const fNet = fatOxG - dnlFatG;
  const vo2 = k.vo2C * cUse + k.vo2F * fNet + k.vo2P * protOx;
  const vco2 = k.vco2C * cUse + k.vco2F * fNet + k.vco2P * protOx;
  if (vo2 > 1e-9) bus.rqHour = vco2 / vo2;

  s.dayChoOxG += choOxG;
  s.dayFatOxG += fatOxG;
  s.dayProtOxG += protOx;
  s.dayDnlFatG += dnlFatG;
  s.dayGngG += gngG;

  if (events !== null && hourIndex >= 0) {
    const low = isLow(s, k, gTot1);
    if (low === 1 && s.evLow === 0) events.emit('glycogenLow', hourIndex, gTot1);
    s.evLow = low;
    const full = gTot1 >= k.dnlGate * s.gCapG ? 1 : 0;
    if (full === 1 && s.evFull === 0) events.emit('glycogenFull', hourIndex, gTot1);
    s.evFull = full;
    const liverLow = gL1 < k.liverLowG ? 1 : 0;
    if (liverLow === 1 && s.evLiverLow === 0) events.emit('liverGlycogenLow', hourIndex, gL1);
    s.evLiverLow = liverLow;
    const sw = gL1 < k.switchG ? 1 : 0; // Sw = 1/(1 + (G_L/30)^4) > 0.5 ⇔ G_L < 30 g
    if (sw !== s.evSwitch) events.emit('metabolicSwitch', hourIndex, gL1);
    s.evSwitch = sw;
    const sup = gM1 > k.superCompFrac * superBase(s) ? 1 : 0;
    if (sup === 1 && s.evSuper === 0) events.emit('supercompensation', hourIndex, gM1);
    s.evSuper = sup;
  } else {
    // keep latches consistent without emitting (burn-in)
    s.evLow = isLow(s, k, gTot1);
    s.evFull = gTot1 >= k.dnlGate * s.gCapG ? 1 : 0;
    s.evLiverLow = gL1 < k.liverLowG ? 1 : 0;
    s.evSwitch = gL1 < k.switchG ? 1 : 0;
    s.evSuper = gM1 > k.superCompFrac * superBase(s) ? 1 : 0;
  }
}

/** glycogenLow: below 30 % of capacity AND below the person's habitual daily low by glycogenLowHabFrac (edge-triggered). */
function isLow(s: FuelState, k: FuelConst, gTot: number): number {
  const thr = k.glycogenLowFrac * s.gCapG;
  const hab = k.glycogenLowHabFrac * s.habMinTotG;
  return gTot < (hab > 0 && hab < thr ? hab : thr) ? 1 : 0;
}
/** supercompensation baseline: the habitual daily muscle-glycogen high (never below the fed reference). */
function superBase(s: FuelState): number {
  return s.habMaxMuscleG > s.gMuscleRefG ? s.habMaxMuscleG : s.gMuscleRefG;
}

/** Record this hour's fuel inputs during the last habitual burn-in week (days −7 … −1). */
function recordBurnInHour(s: FuelState, bus: SignalBus, hour: FuelHourView, day: number, hourOfDay: number): void {
  if (day < -7 || day >= 0) return;
  const row = (day + 7) * 24 + hourOfDay;
  const r = s.rec;
  const b = row * REC_W;
  r[b + RF_GLC] = bus.raGlcGH;
  r[b + RF_FRU] = bus.raFruGalGH;
  r[b + RF_PROT] = bus.raProtGH;
  r[b + RF_ALC] = bus.alcOxGH;
  r[b + RF_INS] = bus.insulinUuMl;
  r[b + RF_TEE] = bus.teePreKcalH;
  r[b + RF_KETO] = bus.ketoAdaptFast;
  r[b + RF_BRAIN] = bus.brainKetoneShare;
  r[b + RF_FAST] = bus.fastActive;
  r[b + RF_FASTPROT] = bus.fastProtOxGH;
  r[b + RF_LEAN] = bus.leanRateKgD;
  r[b + RF_EXMIN] = bus.exMinutesH;
  r[b + RF_EXINT] = bus.exIntensityFrac;
  r[b + RF_EXKG] = bus.exActiveMuscleKg;
  r[b + RF_EXMOD] = hour.exModality;
  r[b + RF_RTTOT] = hour.rtSetsTotal;
  r[b + RF_EABS] = bus.eAbsKcalH;
  const n = hour.rtSetsByRegion.length < N_REGIONS ? hour.rtSetsByRegion.length : N_REGIONS;
  for (let i = 0; i < N_REGIONS; i++) r[b + RF_RT0 + i] = i < n ? hour.rtSetsByRegion[i]! : 0;
  if (row + 1 > s.recN) s.recN = row + 1;
}

/**
 * endBurnIn (MODEL_SPEC §3.4; integrator A2): replay the recorded habitual week REPLAY_WEEKS times with TEE_pre scaled
 * to the week's mean absorbed energy (the calibrated NEAT0 makes TEE = EI_hab), so glycogen starts t = 0 at its
 * post-calibration equilibrium instead of drifting ≈ 2-3 % over the first week; the last pass sets the habitual baselines
 * of the glycogen events. The bus keeps its values except fuel's own outputs, which are rewritten from the final state.
 * Allocation is allowed here (not the hot path).
 */
export function endBurnInFuel(s: FuelState, k: FuelConst, bus: SignalBus): void {
  if (s.recN < REC_H) return; // no complete habitual week recorded (burn-in < 7 d)
  const r = s.rec;
  let tee = 0;
  let ei = 0;
  for (let h = 0; h < REC_H; h++) {
    tee += r[h * REC_W + RF_TEE]!;
    ei += r[h * REC_W + RF_EABS]!;
  }
  const scale = tee > 0 && ei > 0 ? ei / tee : 1;
  const sb = createSignalBus();
  const view: FuelHourView = { exModality: 0, rtSetsByRegion: new Float64Array(N_REGIONS), rtSetsTotal: 0 };
  let minTot = Infinity;
  let maxM = 0;
  for (let w = 0; w < REPLAY_WEEKS; w++) {
    // keep the depletion clock continuous: every pass is the same calendar week (hours −168 … −1)
    for (let j = 0; j < N_MUSCLE_GROUPS; j++) s.lastDepletionHour[j] = s.lastDepletionHour[j]! - REC_H;
    const last = w === REPLAY_WEEKS - 1;
    for (let d = 0; d < 7; d++) {
      const db = d * REC_DW;
      startFuelDay(s, k, s.recDay[db]!, s.recDay[db + 1]!, s.recDay[db + 2]!);
      for (let hh = 0; hh < 24; hh++) {
        const b = (d * 24 + hh) * REC_W;
        sb.raGlcGH = r[b + RF_GLC]!;
        sb.raFruGalGH = r[b + RF_FRU]!;
        sb.raProtGH = r[b + RF_PROT]!;
        sb.alcOxGH = r[b + RF_ALC]!;
        sb.insulinUuMl = r[b + RF_INS]!;
        sb.teePreKcalH = r[b + RF_TEE]! * scale;
        sb.ketoAdaptFast = r[b + RF_KETO]!;
        sb.brainKetoneShare = r[b + RF_BRAIN]!;
        sb.fastActive = r[b + RF_FAST]!;
        sb.fastProtOxGH = r[b + RF_FASTPROT]!;
        sb.leanRateKgD = r[b + RF_LEAN]!;
        sb.exMinutesH = r[b + RF_EXMIN]!;
        sb.exIntensityFrac = r[b + RF_EXINT]!;
        sb.exActiveMuscleKg = r[b + RF_EXKG]!;
        view.exModality = r[b + RF_EXMOD]!;
        view.rtSetsTotal = r[b + RF_RTTOT]!;
        for (let i = 0; i < N_REGIONS; i++) view.rtSetsByRegion[i] = r[b + RF_RT0 + i]!;
        stepFuelHour(s, k, sb, view, d * 24 + hh - REC_H, null);
        if (last) {
          const gm = muscleGlycogenG(s);
          const gt = s.liverG + gm;
          if (gt < minTot) minTot = gt;
          if (gm > maxM) maxM = gm;
        }
      }
    }
  }
  s.habMinTotG = minTot;
  s.habMaxMuscleG = maxM;
  // fuel's outputs as at the end of the (replayed) last burn-in hour
  bus.liverGlycogenG = s.liverG;
  const gM = muscleGlycogenG(s);
  bus.muscleGlycogenG = gM;
  bus.muscleGlycogenRel = s.gMuscleRefG > 0 ? gM / s.gMuscleRefG : 1;
  bus.muscleGlycogenExDefFrac = sb.muscleGlycogenExDefFrac;
  bus.choOxGH = sb.choOxGH;
  bus.fatOxGH = sb.fatOxGH;
  bus.protOxGH = sb.protOxGH;
  bus.dnlFatGH = sb.dnlFatGH;
  bus.dnlHeatKcalH = sb.dnlHeatKcalH;
  bus.gngGH = sb.gngGH;
  bus.glycogenChangeKcalH = sb.glycogenChangeKcalH;
  bus.rqHour = sb.rqHour;
  s.evLow = isLow(s, k, s.liverG + gM);
  s.evFull = s.liverG + gM >= k.dnlGate * s.gCapG ? 1 : 0;
  s.evLiverLow = s.liverG < k.liverLowG ? 1 : 0;
  s.evSwitch = s.liverG < k.switchG ? 1 : 0;
  s.evSuper = gM > k.superCompFrac * superBase(s) ? 1 : 0;
}

/** Day start: SMM from composition (d−1, grams conserved), S_mus/T_C factors, capacity/references, accumulators. */
export function startFuelDay(s: FuelState, k: FuelConst, smmTotalKg: number, sMus: number, carbTolerance: number): void {
  if (smmTotalKg > 0 && Number.isFinite(smmTotalKg)) {
    for (let j = 0; j < N_MUSCLE_GROUPS; j++) {
      const old = s.smmKg[j]!;
      const nu = s.smmShare[j]! * smmTotalKg;
      if (old > 0 && nu > 0 && old !== nu) {
        const f = old / nu; // keep grams: c·SMM constant
        s.cM[j] = s.cM[j]! * f;
        s.rtPreC[j] = s.rtPreC[j]! * f;
        s.cExDef[j] = s.cExDef[j]! * f;
      }
      s.smmKg[j] = nu;
    }
    refreshReferences(s, k);
  }
  s.sqrtSMus = Math.sqrt(sMus > 0 && Number.isFinite(sMus) ? sMus : 0);
  s.sqrtTC = Math.sqrt(Number.isFinite(carbTolerance) ? clamp01(carbTolerance) : 1);
  s.dayChoOxG = 0;
  s.dayFatOxG = 0;
  s.dayProtOxG = 0;
  s.dayDnlFatG = 0;
  s.dayGngG = 0;
}

const MI_GLY_TOT = MI.glycogenTotal;
const MI_GLY_LIVER = MI.liverGlycogen;
const MI_GLY_MUSCLE = MI.muscleGlycogen;
const MI_CHO_OX = MI.choOxidation;
const MI_DNL = MI.dnl;
const MI_FAT_OX = MI.fatOxidation;

export const fuelModule = defineModule<FuelState, FuelConst>({
  id: 'fuel',
  specSection: '§1.6',
  dossiers: '04 §4.1-4.13, §4.22; 01 §4.1; 20 §4.3.1/§4B.1; 10 §4.4-4.5; 11 §4.2-4.4',
  params: FUEL_PARAMS,
  reads: [
    'raGlcGH', 'raFruGalGH', 'raProtGH', 'alcOxGH', 'insulinUuMl', 'teePreKcalH', 'exIntensityFrac',
    'exMinutesH', 'exActiveMuscleKg', 'ketoAdaptFast', 'brainKetoneShare', 'leanRateKgD', 'fastActive', 'fastProtOxGH', 'eAbsKcalH',
    'sMus', 'carbTolerance', 'skeletalMuscleKg', 'vo2maxMlKgMin',
  ],
  writes: [
    'liverGlycogenG', 'muscleGlycogenG', 'muscleGlycogenRel', 'muscleGlycogenExDefFrac', 'liverGlycogenMaxG', 'choOxGH',
    'fatOxGH', 'protOxGH', 'dnlFatGH', 'dnlHeatKcalH', 'gngGH', 'glycogenChangeKcalH', 'rqHour',
  ],
  records: ['glycogenTotal', 'liverGlycogen', 'muscleGlycogen', 'fatOxidation', 'choOxidation', 'dnl'],
  prepare: (ctx) => prepareFuel(ctx),
  init: (k, ctx, bus) => {
    const s = initFuel(k, ctx, bus.vo2maxMlKgMin);
    bus.liverGlycogenG = s.liverG;
    const gM = muscleGlycogenG(s);
    bus.muscleGlycogenG = gM;
    bus.muscleGlycogenRel = s.gMuscleRefG > 0 ? gM / s.gMuscleRefG : 1;
    bus.muscleGlycogenExDefFrac = 0;
    bus.liverGlycogenMaxG = s.gLMaxG;
    return s;
  },
  startDay: (s, k, bus, _day, clock) => {
    if (clock.day >= -7 && clock.day < 0) {
      const db = (clock.day + 7) * REC_DW;
      s.recDay[db] = bus.skeletalMuscleKg;
      s.recDay[db + 1] = bus.sMus;
      s.recDay[db + 2] = bus.carbTolerance;
    }
    startFuelDay(s, k, bus.skeletalMuscleKg, bus.sMus, bus.carbTolerance);
    bus.liverGlycogenMaxG = s.gLMaxG;
  },
  stepHour: (s, k, bus, hour, _day, clock) => {
    if (clock.day < 0) recordBurnInHour(s, bus, hour, clock.day, clock.hourOfDay);
    stepFuelHour(s, k, bus, hour, clock.hourIndex, clock.day >= 0 ? k.events : null);
  },
  endBurnIn: (s, k, bus) => endBurnInFuel(s, k, bus),
  recordHour: (s, _k, bus, out) => {
    out[MI_GLY_TOT] = bus.liverGlycogenG + bus.muscleGlycogenG;
    out[MI_GLY_LIVER] = bus.liverGlycogenG;
    out[MI_GLY_MUSCLE] = bus.muscleGlycogenG;
    out[MI_CHO_OX] = bus.choOxGH;
    out[MI_DNL] = bus.dnlFatGH;
    void s;
  },
  recordDay: (s, _k, _bus, out) => {
    out[MI_FAT_OX] = s.dayFatOxG;
  },
});
