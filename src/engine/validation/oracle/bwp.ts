/**
 * Independent oracle: NIDDK Body Weight Planner = Hall et al. 2011 (Lancet 378:826) two-compartment model.
 * MODEL_SPEC §9.1 O-1/O-2 · dossier research/01-computational-body-weight-models.md §4.2 (equations) and §4.12 (Python
 * reference implementation, DERIVED), §7.11 (model-to-model regression).
 *
 * INDEPENDENCE RULE: this file imports nothing from the engine (no types, no core, no model). It is a standalone
 * re-implementation so a bug in the engine's composition/energy modules cannot also be a bug here. The only shared
 * inputs are plain numbers (see `oracle/bwpAdapter.ts` for the engine-facing glue).
 *
 * Units inside the model follow the paper: energy MJ, mass kg, time d. Public helpers with a `Kcal` suffix convert with
 * 1 kcal = 4.184 kJ. Compartments: fat F, lean tissue L, glycogen G (with 2.7 g water per g), extracellular fluid ECF,
 * adaptive thermogenesis AT. Body weight BW = F + L + G·(1 + h_G) + ECF.
 *
 * Equations (dossier 01 §4.2, web appendix of Hall 2011):
 *   ρG·dG/dt = CI − kG·G²                      kG = CIb/G0²   (glycogen sink, quadratic)
 *   dECF/dt = [−ξNa·(ECF − ECF0) − ξCI·(1 − CI/CIb)] / [Na]
 *   ρF·dF/dt = (1 − p)·(EI − EE − ρG·dG/dt)     ρL·dL/dt = p·(EI − EE − ρG·dG/dt)     p = C/(C + F)
 *   EE = [K + γF·F + γL·L + δ·BW + TEF + AT + (EI − ρG·dG/dt)·s] / (1 + s),  s = p·ηL/ρL + (1 − p)·ηF/ρF
 *   TEF = β_TEF·ΔEI,  τ_AT·dAT/dt = β_AT·ΔEI − AT,  K from EE(0) = EI0.
 */

/** Model constants exactly as printed in dossier 01 §4.2 / §4.12. */
export const BWP = {
  /** Energy densities, MJ/kg. */
  rhoF: 39.5,
  rhoL: 7.6,
  rhoG: 17.6,
  /** Tissue-specific resting expenditure, MJ/kg/d (Nelson 1992). */
  gammaF: 0.013,
  gammaL: 0.092,
  /** Synthesis (deposition) cost, MJ per kg of tissue (Hall 2010 BJN). */
  etaF: 0.75,
  etaL: 0.96,
  /** Thermic effect of the intake CHANGE, and adaptive-thermogenesis gain (Hall & Jordan 2008) and time constant, d. */
  betaTEF: 0.1,
  betaAT: 0.14,
  tauAT: 14,
  /** Water bound per g glycogen (McBride 1941). */
  hG: 2.7,
  /** Forbes constant C = 10.4 kg · ρL/ρF (energy form, kg). */
  forbesC: (10.4 * 7.6) / 39.5,
  /** Forbes mass constant, kg (10.4). */
  forbesMassKg: 10.4,
  /** Initial glycogen, kg. */
  glycogenInitKg: 0.5,
  /** Sodium concentration mg/mL, ξNa mg/L/d, ξCI mg/d. */
  naMgPerMl: 3.22,
  xiNa: 3000,
  xiCI: 4000,
  /** Placeholder initial ECF fraction of body weight (dossier 01 §4.2.6; Silva 2007 regression not reproduced). */
  ecfFrac: 0.2,
  /** Default carbohydrate share of intake energy. */
  carbFraction: 0.5,
  /** Default sedentary physical-activity level. */
  pal: 1.5,
  /** Conversions. */
  kcalPerMj: 1000 / 4.184,
} as const;

export type BwpSex = 'male' | 'female';

/** Inputs of the model. All optional fields default as in dossier 01 §4.12. */
export interface BwpInput {
  sex: BwpSex;
  weightKg: number;
  heightM: number;
  ageYears: number;
  /** Physical activity level (default 1.5). Ignored for EI0 when `baselineEiMj` is given (PAL is then EI0/RMR). */
  pal?: number;
  /** Weight-stable baseline intake EI0, MJ/d. Default PAL·RMR (Mifflin–St Jeor). */
  baselineEiMj?: number;
  /** Measured initial fat mass, kg. Default: Jackson et al. 2002 (Eq. 4). */
  bodyFatKg?: number;
  /** Initial extracellular fluid, kg. Default 0.2·BW. */
  ecfKg?: number;
  /** Carbohydrate share of intake energy (default 0.5); drives the glycogen/ECF fast compartments. */
  carbFraction?: number;
}

/** Derived initial conditions and constants of one person (all MJ, kg, d). */
export interface BwpInit {
  input: BwpInput;
  /** Mifflin–St Jeor RMR, MJ/d. */
  rmrMj: number;
  pal: number;
  /** Baseline intake = baseline expenditure, MJ/d. */
  ei0Mj: number;
  /** Weight-proportional activity coefficient δ, MJ/kg/d. */
  delta: number;
  f0: number;
  l0: number;
  g0: number;
  ecf0: number;
  /** Baseline carbohydrate intake CIb, MJ/d, and glycogen sink kG = CIb/G0². */
  ciBaseMj: number;
  kG: number;
  /** Constant K from EE(0) = EI0, MJ/d. */
  k: number;
  carbFraction: number;
}

/** Mifflin–St Jeor resting metabolic rate, MJ/d (dossier 01 §4.2.4). */
export function mifflinMj(sex: BwpSex, weightKg: number, heightM: number, ageYears: number): number {
  return (10 * weightKg + 6.25 * heightM * 100 - 5 * ageYears + (sex === 'male' ? 5 : -161)) * 4.184e-3;
}

/** Jackson et al. 2002 fat mass from BMI, age and sex (dossier 01 §4.2.3, Eq. 4), kg. */
export function jacksonFatKg(sex: BwpSex, weightKg: number, heightM: number, ageYears: number): number {
  const bmi = weightKg / (heightM * heightM);
  const [a, b] = sex === 'male' ? [37.31, 103.94] : [39.96, 102.01];
  return (weightKg / 100) * (0.14 * ageYears + a * Math.log(bmi) - b);
}

/** Initial conditions. K is chosen so that EE(0) = EI0 exactly. */
export function initBwp(input: BwpInput): BwpInit {
  const rmrMj = mifflinMj(input.sex, input.weightKg, input.heightM, input.ageYears);
  const ei0Mj = input.baselineEiMj ?? (input.pal ?? BWP.pal) * rmrMj;
  const pal = ei0Mj / rmrMj;
  const delta = ((1 - BWP.betaTEF) * pal - 1) * (rmrMj / input.weightKg);
  const f0 = input.bodyFatKg ?? jacksonFatKg(input.sex, input.weightKg, input.heightM, input.ageYears);
  const g0 = BWP.glycogenInitKg;
  const ecf0 = input.ecfKg ?? BWP.ecfFrac * input.weightKg;
  const l0 = input.weightKg - f0 - ecf0 - g0 * (1 + BWP.hG);
  const carbFraction = input.carbFraction ?? BWP.carbFraction;
  const ciBaseMj = carbFraction * ei0Mj;
  const kG = ciBaseMj / (g0 * g0);
  const k = ei0Mj - (BWP.gammaF * f0 + BWP.gammaL * l0 + delta * input.weightKg);
  return { input, rmrMj, pal, ei0Mj, delta, f0, l0, g0, ecf0, ciBaseMj, kG, k, carbFraction };
}

/** Model state: [F, L, G, ECF, AT] (kg, kg, kg, kg, MJ/d). */
export type BwpState = [number, number, number, number, number];

const N = 5;

/** Body weight of a state, kg. */
export function bwpWeight(x: ArrayLike<number>): number {
  return x[0]! + x[1]! + x[2]! * (1 + BWP.hG) + x[3]!;
}

/**
 * Right-hand side. Writes d/dt into `out` and returns EE (MJ/d). `ei` = intake MJ/d held constant over the call.
 * Closed-form EE (Eq. 9) resolves the algebraic loop between EE and the deposition-cost term.
 */
export function bwpDerivatives(init: BwpInit, x: ArrayLike<number>, ei: number, out: Float64Array): number {
  const F = x[0]!;
  const L = x[1]!;
  const G = x[2]!;
  const ECF = x[3]!;
  const AT = x[4]!;
  const bw = F + L + G * (1 + BWP.hG) + ECF;
  const ci = init.carbFraction * ei;
  const dEi = ei - init.ei0Mj;
  const dG = (ci - init.kG * G * G) / BWP.rhoG;
  const p = BWP.forbesC / (BWP.forbesC + F);
  const s = (p * BWP.etaL) / BWP.rhoL + ((1 - p) * BWP.etaF) / BWP.rhoF;
  const ee =
    (init.k + BWP.gammaF * F + BWP.gammaL * L + init.delta * bw + BWP.betaTEF * dEi + AT + (ei - BWP.rhoG * dG) * s) / (1 + s);
  const surplus = ei - ee - BWP.rhoG * dG;
  out[0] = ((1 - p) * surplus) / BWP.rhoF;
  out[1] = (p * surplus) / BWP.rhoL;
  out[2] = dG;
  out[3] = (-BWP.xiNa * (ECF - init.ecf0) - BWP.xiCI * (1 - ci / init.ciBaseMj)) / (BWP.naMgPerMl * 1000);
  out[4] = (BWP.betaAT * dEi - AT) / BWP.tauAT;
  return ee;
}

/** Daily intake in MJ/d: an array (piecewise constant per day; last value held) or a function of time in days. */
export type BwpIntake = ArrayLike<number> | ((tDays: number) => number);

export interface BwpOptions {
  /** Simulated days (default: intake array length, else 730). */
  days?: number;
  /** Step, days. Must divide 1 for daily piecewise-constant intake to be exact (default 1/8). */
  dtDays?: number;
  /** Integrator (default 'rk4'; 'euler' reproduces the dossier's Python at dt = 0.05). */
  method?: 'rk4' | 'euler';
}

export interface BwpTrajectory {
  init: BwpInit;
  /** Sample times, d (0, 1, …, days). Index i is the state at the START of day i (i = days is the end). */
  tDays: Float64Array;
  bwKg: Float64Array;
  fatKg: Float64Array;
  leanKg: Float64Array;
  glycogenKg: Float64Array;
  ecfKg: Float64Array;
  atMj: Float64Array;
  /** Expenditure at the sample time, MJ/d (uses the intake of the day starting there). */
  eeMj: Float64Array;
  /** Intake used for the day starting at each sample, MJ/d. */
  eiMj: Float64Array;
}

function intakeAt(intake: BwpIntake, t: number): number {
  if (typeof intake === 'function') return intake(t);
  const n = intake.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor(t + 1e-9)));
  return intake[i]!;
}

/** Simulate the model and sample once per day. */
export function simulateBwp(input: BwpInput | BwpInit, intake: BwpIntake, opts: BwpOptions = {}): BwpTrajectory {
  const init = 'k' in input && 'kG' in input ? (input as BwpInit) : initBwp(input as BwpInput);
  const dt = opts.dtDays ?? 1 / 8;
  const method = opts.method ?? 'rk4';
  const days = opts.days ?? (typeof intake === 'function' ? 730 : Math.max(1, intake.length));
  const stepsPerDay = Math.round(1 / dt);
  if (Math.abs(stepsPerDay * dt - 1) > 1e-9) throw new Error('bwp: dtDays must divide one day');
  const n = days + 1;
  const tr: BwpTrajectory = {
    init,
    tDays: new Float64Array(n),
    bwKg: new Float64Array(n),
    fatKg: new Float64Array(n),
    leanKg: new Float64Array(n),
    glycogenKg: new Float64Array(n),
    ecfKg: new Float64Array(n),
    atMj: new Float64Array(n),
    eeMj: new Float64Array(n),
    eiMj: new Float64Array(n),
  };
  const x = new Float64Array([init.f0, init.l0, init.g0, init.ecf0, 0]);
  const k1 = new Float64Array(N);
  const k2 = new Float64Array(N);
  const k3 = new Float64Array(N);
  const k4 = new Float64Array(N);
  const tmp = new Float64Array(N);
  const sample = (i: number, ei: number): void => {
    tr.tDays[i] = i;
    tr.bwKg[i] = bwpWeight(x);
    tr.fatKg[i] = x[0]!;
    tr.leanKg[i] = x[1]!;
    tr.glycogenKg[i] = x[2]!;
    tr.ecfKg[i] = x[3]!;
    tr.atMj[i] = x[4]!;
    tr.eiMj[i] = ei;
    tr.eeMj[i] = bwpDerivatives(init, x, ei, tmp);
  };
  for (let d = 0; d < days; d++) {
    const eiDay = intakeAt(intake, d + 0.5 * dt);
    sample(d, intakeAt(intake, d));
    for (let s = 0; s < stepsPerDay; s++) {
      const t = d + s * dt;
      // the intake is held over each step; sampled at the step midpoint (exact for daily piecewise-constant input)
      const ei = typeof intake === 'function' ? intakeAt(intake, t + 0.5 * dt) : eiDay;
      if (method === 'euler') {
        // the dossier's Python evaluates EI at the step start
        const eiStart = typeof intake === 'function' ? intakeAt(intake, t) : eiDay;
        bwpDerivatives(init, x, eiStart, k1);
        for (let j = 0; j < N; j++) x[j] = x[j]! + dt * k1[j]!;
      } else {
        bwpDerivatives(init, x, ei, k1);
        for (let j = 0; j < N; j++) tmp[j] = x[j]! + 0.5 * dt * k1[j]!;
        bwpDerivatives(init, tmp, ei, k2);
        for (let j = 0; j < N; j++) tmp[j] = x[j]! + 0.5 * dt * k2[j]!;
        bwpDerivatives(init, tmp, ei, k3);
        for (let j = 0; j < N; j++) tmp[j] = x[j]! + dt * k3[j]!;
        bwpDerivatives(init, tmp, ei, k4);
        for (let j = 0; j < N; j++) x[j] = x[j]! + (dt / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!);
      }
    }
  }
  sample(days, intakeAt(intake, days));
  return tr;
}

/** Convenience: daily intake in kcal/d in, trajectory out (MJ fields stay in MJ). */
export function simulateBwpKcal(input: BwpInput | BwpInit, dailyKcal: ArrayLike<number>, opts: BwpOptions = {}): BwpTrajectory {
  const mj = Array.from({ length: dailyKcal.length }, (_, i) => dailyKcal[i]! / BWP.kcalPerMj);
  return simulateBwp(input, mj, opts);
}

/** Expenditure at a trajectory sample, kcal/d. */
export function bwpEeKcal(tr: BwpTrajectory, day: number): number {
  return tr.eeMj[day]! * BWP.kcalPerMj;
}

// ------------------------------------------------------------------ linearised long-term dynamics (Eqs. 10-18)

export interface BwpLinear {
  /** α = dL/dF = 10.4/F0. */
  alpha: number;
  /** β = β_AT + β_TEF. */
  beta: number;
  /** Effective energy density of weight change ρ, MJ/kg (includes synthesis cost and 1/(1 − β)). */
  rho: number;
  /** ε, MJ/kg/d. */
  eps: number;
  /** Time constant τ = ρ/ε, d. */
  tau: number;
  /** Pure tissue energy per kg of weight change, MJ/kg (dossier 01 table column: excludes η and 1/(1 − β)). */
  tissueDensityMj: number;
}

/** Eqs. 10-18: linearised rho, eps and tau for a given fat mass and activity coefficient δ (MJ/kg/d). */
export function bwpLinearised(f0Kg: number, delta: number): BwpLinear {
  const alpha = BWP.forbesMassKg / f0Kg;
  const beta = BWP.betaAT + BWP.betaTEF;
  const rho =
    (BWP.etaF + BWP.rhoF + alpha * BWP.etaL + alpha * BWP.rhoL) / ((1 - beta) * (1 + alpha));
  const eps = (1 / (1 - beta)) * ((BWP.gammaF + alpha * BWP.gammaL) / (1 + alpha) + delta);
  const tau =
    (BWP.etaF + BWP.rhoF + alpha * (BWP.etaL + BWP.rhoL)) /
    (BWP.gammaF + delta + alpha * (BWP.gammaL + delta));
  const tissueDensityMj = (BWP.rhoF + alpha * BWP.rhoL) / (1 + alpha);
  return { alpha, beta, rho, eps, tau, tissueDensityMj };
}

/**
 * Eq. 18 steady-state weight change for a permanent intake change dEi (MJ/d), no activity change:
 * dBW = (1 − β)·dEI / [δ + γL − Φ·(γL − γF)], Φ = dF/dBW (fraction of the weight change that is fat).
 */
export function bwpSteadyStateDeltaBw(dEiMj: number, delta: number, phi: number): number {
  const beta = BWP.betaAT + BWP.betaTEF;
  return ((1 - beta) * dEiMj) / (delta + BWP.gammaL - phi * (BWP.gammaL - BWP.gammaF));
}

// ------------------------------------------------------------------ dossier reference numbers (for tests and reports)

/** Paper worked example (dossier 01 §4.2.6): 100 kg, 1.80 m, 23-y sedentary man; −5 MJ/d for 180 d, then 10.9 MJ/d. */
export const BWP_WORKED_EXAMPLE = {
  input: { sex: 'male', weightKg: 100, heightM: 1.8, ageYears: 23, pal: 1.5 } satisfies BwpInput,
  baselineMj: 12.65,
  deficitMj: 5,
  deficitDays: 180,
  holdMj: 10.9,
  /** Dossier reimplementation (Python, dt 0.05 Euler): 79.96 kg at d180, 80.7 kg at d365-730; paper ≈ 80 / 80-81. */
  bwAt180Kg: 79.96,
  bwAt365Kg: 80.7,
  /** First week of the −5 MJ/d case: 1.83 kg = 0.11 glycogen + 0.30 glycogen water + 0.53 ECF. */
  firstWeek: { lossKg: 1.83, glycogenKg: 0.11, glycogenWaterKg: 0.3, ecfKg: 0.53 },
  /** Permanent −2 MJ/d: 87.1 kg at 1 y, 79.3 kg at 3 y, 78.1 kg at 10 y (paper plateau ≈ 75; ±3 kg tolerance). */
  minus2Mj: { bw1y: 87.1, bw3y: 79.3, bw10y: 78.1, paperPlateauKg: 75, plateauTolKg: 3 },
} as const;

/** Intake schedule of the worked example (MJ/d, one value per day). */
export function workedExampleIntake(days = 730): Float64Array {
  const a = new Float64Array(days);
  for (let d = 0; d < days; d++) a[d] = d < BWP_WORKED_EXAMPLE.deficitDays ? BWP_WORKED_EXAMPLE.baselineMj - BWP_WORKED_EXAMPLE.deficitMj : BWP_WORKED_EXAMPLE.holdMj;
  return a;
}
