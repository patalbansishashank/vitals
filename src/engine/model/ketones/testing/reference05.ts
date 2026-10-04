/**
 * TEST-ONLY: line-by-line transcription of dossier 05 §4.17's calibrated reference model (explicit Euler, Δt = 5 min),
 * including its FALLBACK glycogen and insulin blocks. The engine module does NOT use the fallback (ruling R-KET); this
 * file serves two purposes in the ketones test suite:
 *   1. the 5-min Euler reference for the O-10 numerical check (MODEL_SPEC §9.1, §1.7 "Numerical"), and
 *   2. a generator of hand-built liver-glycogen / muscle-glycogen / insulin-proxy / absorption trajectories that drive
 *      the hourly module while the upstream `fuel` and `intake` modules are written in parallel.
 * Constants are copied verbatim from 05 §4.17 `K` (fallback block included). Allocation is fine here (not engine code).
 */

export interface RefMeal {
  /** Start time, h (absolute, same clock as the scenario). */
  t: number;
  netCarbG: number;
  proteinG: number;
  /** Long-chain fat, g. */
  fatG: number;
  mctC8G?: number;
  mctC10G?: number;
}
export interface RefDrink {
  t: number;
  /** D-BHB grams (salts already halved by the caller). */
  gBhbD: number;
  fed: boolean;
}
export interface RefBout {
  t0: number;
  t1: number;
  /** Intensity, fraction of VO2max. */
  x: number;
}
export interface RefBody {
  BW: number;
  FFM: number;
  /** Insulin-resistance factor multiplying the fallback insulin proxy (1 lean, 1.2-1.4 obese/IR). */
  IR: number;
  /** Total energy expenditure, kcal/d (for the deficit term d). */
  TEE: number;
}
export interface RefScenario {
  body: RefBody;
  meals: RefMeal[];
  drinks?: RefDrink[];
  bouts?: RefBout[];
  /** Simulation window [tStart, tEnd), h. */
  tStart: number;
  tEnd: number;
  /** Habitual protein for the P_ew initial value, g/d. */
  habitualProteinG: number;
  /** Habitual carbohydrate (A_f initial value 1 below 50 g/d, 05 §2). */
  habitualCarbG: number;
  /** Optional override of the partition half-point, g (default 05: 55·FFM/60). */
  g50G?: number;
}

export const K05 = {
  VdPerBW: 0.25, clFFM: 0.0134, Km: 6.0, a_m: 0.35, renal: 0.00025, T_thr: 1.0,
  kP: 0.010, F_hep: 0.15, phi_min: 0.12, G50: 55, nG: 2.5, kI_hep: 0.15,
  a_h: 0.35, a_hs: 0.5, k_prot: 0.15, P_ref: 90, tauProt: 8,
  F0: 0.50, tauF_up: 1.0, tauF_down: 1.5, kFB: 15, e_def: 1.5, k_mgF: 3.0,
  ex_F: 0.4, tau_postF: 3.0, ex_CL: 1.0, post_CL: 0.6, post_dur: 2.0, ex_I: 0.3,
  I_floor: 0.45, Iexp: 0.5, Gref: 60, a_c: 0.12, a_p: 0.04,
  Gmax: 100, f_liver: 0.30, f_gng: 0.10, k_gly: 4.5, Kgly: 10, ex_gly: 30,
  MGmax: 400, f_musc: 0.5, k_mgl: 3.0, mg_ex: 200,
  C50: 100, tauAf_up: 48, tauAf_dn: 40, As_lo: 0.5, As_span: 2.0, tauAs: 120,
  y_C8: 0.5, y_C10: 0.17, mctMealFactor: 0.5,
} as const;

/** Gamma(shape 2) absorption density, area 1, peak at tpk hours (05 §4.17 `kern`). */
export const kern = (t: number, tpk: number): number => (t <= 0 ? 0 : (t * Math.exp(-t / tpk)) / (tpk * tpk));
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** One 5-min sample (values at the END of the step, rates evaluated at its start as in 05 §4.17). */
export interface RefSample {
  t: number;
  TKB: number;
  BHB: number;
  FFA: number;
  GL: number;
  GM: number;
  I: number;
  RaC: number;
  RaP: number;
  RaC8: number;
  RaC10: number;
  /** Exogenous D-BHB appearance before the fed factor, mmol/min. */
  exoMmolMin: number;
  C24: number;
  EI24: number;
  x: number;
  fedRecent: boolean;
  Af: number;
  As: number;
  P: number;
  Ren: number;
}

export interface RefRun {
  dtH: number;
  /** State at tStart (before the first step). */
  initial: { TKB: number; FFA: number; GL: number; GM: number; Af: number; As: number };
  samples: RefSample[];
  Gmax: number;
  MGmax: number;
  G50: number;
}

/** Runs the 05 §4.17 reference model with Δt = 5 min over [tStart, tEnd). */
export function runReference05(sc: RefScenario, dtH = 1 / 12): RefRun {
  const K = K05;
  const { BW, FFM, IR, TEE } = sc.body;
  const Vd = K.VdPerBW * BW;
  const CL0 = K.clFFM * FFM;
  const Vmax = CL0 * K.Km;
  const Gmax = (K.Gmax * FFM) / 60;
  const G50 = sc.g50G ?? (K.G50 * FFM) / 60;
  const Gref = (K.Gref * FFM) / 60;
  const MGmax = (K.MGmax * FFM) / 60;
  const s = {
    TKB: 0.25,
    FFA: 0.5,
    GL: 0.7 * Gmax,
    GM: 0.85 * MGmax,
    Af: sc.habitualCarbG < 50 ? 1 : 0,
    As: 0,
    Pew: sc.habitualProteinG,
    Xpost: 0,
  };
  const initial = { TKB: s.TKB, FFA: s.FFA, GL: s.GL, GM: s.GM, Af: s.Af, As: s.As };
  const meals = [...sc.meals].sort((a, b) => a.t - b.t);
  const drinks = sc.drinks ?? [];
  const bouts = sc.bouts ?? [];
  const samples: RefSample[] = [];
  const nSteps = Math.round((sc.tEnd - sc.tStart) / dtH);
  for (let n = 0; n < nSteps; n++) {
    const t = sc.tStart + n * dtH;
    let RaC = 0;
    let RaP = 0;
    let RaC8 = 0;
    let RaC10 = 0;
    let C24 = 0;
    let EI24 = 0;
    let fedRecent = false;
    for (const m of meals) {
      const dt = t - m.t;
      if (dt < 0) break;
      if (dt < 12) {
        RaC += m.netCarbG * kern(dt, 0.75);
        RaP += m.proteinG * kern(dt, 1.5);
        RaC8 += (m.mctC8G ?? 0) * kern(dt, 1.0);
        RaC10 += (m.mctC10G ?? 0) * kern(dt, 1.2);
      }
      if (dt < 24) {
        C24 += m.netCarbG;
        EI24 += 4 * m.netCarbG + 4 * m.proteinG + 9 * m.fatG + 8.3 * ((m.mctC8G ?? 0) + (m.mctC10G ?? 0));
      }
      const macro = m.netCarbG + m.proteinG + m.fatG + (m.mctC8G ?? 0) + (m.mctC10G ?? 0);
      if (macro > 50 && dt < 3) fedRecent = true;
    }
    let x = 0;
    let post = false;
    for (const b of bouts) {
      if (t >= b.t0 && t < b.t1) x = b.x;
      if (t >= b.t1 && t < b.t1 + K.post_dur) post = true;
    }
    // protein memory
    s.Pew += ((24 * RaP - s.Pew) * dtH) / K.tauProt;
    // insulin proxy (FALLBACK)
    const Ib = K.I_floor + (1 - K.I_floor) * Math.pow(Math.min(1, s.GL / Gref), K.Iexp);
    const I = IR * (Ib + K.a_c * RaC + K.a_p * RaP) * (1 - K.ex_I * x);
    // FFA
    const lipo = 1 / (0.25 + 0.75 * Math.pow(I, 1.2));
    const d = Math.max(0, 1 - EI24 / TEE);
    s.Xpost = x > 0 ? K.ex_F * x : s.Xpost * Math.exp(-dtH / K.tau_postF);
    const dMG = Math.max(0, (0.85 * MGmax - s.GM) / (0.85 * MGmax));
    // R-KETEX (MODEL_SPEC §1.7, final round): every exercise effect wanes with ketonaemia by 05 §4.1's Hill factor
    const exAtt = 1 / (1 + Math.pow(s.TKB / 3, 4));
    const Fstar = (K.F0 * lipo * (1 + K.e_def * d) * (1 + s.Xpost * exAtt) * (1 + K.k_mgF * dMG * (1 - d * (1 - exAtt)))) / (1 + s.TKB / K.kFB);
    s.FFA += ((Fstar - s.FFA) * dtH) / (Fstar > s.FFA ? K.tauF_up : K.tauF_down);
    // liver & muscle glycogen (FALLBACK)
    const sat = s.GL / (s.GL + K.Kgly);
    const outL = K.k_gly * sat * Math.max(0, 1 - RaC / 10) + K.ex_gly * x * sat;
    const mgUse = K.mg_ex * x * x * (s.GM / MGmax);
    const mgFromCarb = K.f_musc * RaC * clamp((MGmax - s.GM) / (0.15 * MGmax), 0, 1);
    const mgFromLiver = K.k_mgl * dMG * sat;
    s.GM = clamp(s.GM + (mgFromCarb + mgFromLiver - mgUse) * dtH, 0, MGmax);
    s.GL = clamp(s.GL + (K.f_liver * RaC + K.f_gng * RaP - outL - mgFromLiver) * dtH, 0, Gmax);
    // adaptation
    const AfStar = 1 / (1 + Math.pow(C24 / K.C50, 3));
    s.Af += ((AfStar - s.Af) * dtH) / (AfStar > s.Af ? K.tauAf_up : K.tauAf_dn);
    const AsStar = clamp((s.TKB - K.As_lo) / K.As_span, 0, 1);
    s.As += ((AsStar - s.As) * dtH) / K.tauAs;
    // production
    const phi = (K.phi_min + (1 - K.phi_min) / (1 + Math.pow(s.GL / G50, K.nG))) * (1 + K.a_h * s.Af) * (1 + K.a_hs * s.As);
    const hI = 1 / (1 + K.kI_hep * I);
    const piP = Math.exp((-K.k_prot * s.Pew) / K.P_ref);
    let P = K.kP * FFM * (s.FFA + K.F_hep) * phi * hI * piP;
    P += ((fedRecent ? K.mctMealFactor : 1) * (K.y_C8 * 6.37 * RaC8 + K.y_C10 * 5.41 * RaC10)) / 60;
    let exoMmolMin = 0;
    for (const dr of drinks) {
      const e = ((dr.gBhbD / 104.1) * 1000 * kern(t - dr.t, dr.fed ? 0.75 : 0.5)) / 60;
      // recorded as intake's contract (`exoKetoneMmolH`): appearance incl. the fed bioavailability 0.75 (05 §4.12)
      exoMmolMin += e * (dr.fed ? 0.75 : 1);
      P += e * (dr.fed ? 0.75 : 1);
    }
    // utilisation & excretion
    let M = 1 + K.ex_CL * x * exAtt;
    if (post && x === 0) M *= 1 - (1 - K.post_CL) * exAtt;
    const U = ((Vmax * s.TKB) / (K.Km + s.TKB)) * M * (1 - K.a_m * s.As);
    const Ren = K.renal * BW * Math.max(0, s.TKB - K.T_thr);
    s.TKB = Math.max(0.01, s.TKB + ((P - U - Ren) * dtH * 60) / Vd);
    const R = 1.5 + 0.3 * s.TKB;
    samples.push({
      t: t + dtH, TKB: s.TKB, BHB: (s.TKB * R) / (1 + R), FFA: s.FFA, GL: s.GL, GM: s.GM, I, RaC, RaP, RaC8, RaC10,
      exoMmolMin, C24, EI24, x, fedRecent, Af: s.Af, As: s.As, P, Ren,
    });
  }
  return { dtH, initial, samples, Gmax, MGmax, G50 };
}

/** BHB from TKB with 05 §4.5's nominal ratio. */
export const bhb05 = (tkb: number): number => {
  const R = 1.5 + 0.3 * tkb;
  return (tkb * R) / (1 + R);
};
