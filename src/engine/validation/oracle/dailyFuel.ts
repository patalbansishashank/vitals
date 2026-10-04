/**
 * Independent oracle for O-3 (MODEL_SPEC §9.1): the daily reduced-form carbohydrate balance of dossier 04 §4.11
 * ("Hall-type quadratic law"), against which the hourly fuel module's 7-day steady state is checked (±5 %).
 *
 *   dG/dt   = CI + GNG_gly − C_ox − DNL_glc                        [g/d]
 *   C_ox    = min( k_G·G²·(1 − 0.75·A_keto),  (TEE − EE_ex)/4.1 )   k_G = CI_hab / G_ref²
 *   FAT_ox  = TEE − 4.1·C_ox − e_P·P_ox                             [kcal/d]  → grams at `fatKcalPerG`
 *             (e_P = `proteinKcalPerG`: 4.7 in 04 §4.11 as written; the engine books oxidised protein at 4.0 kcal/g —
 *             MODEL_SPEC §0.2, §1.6 step 4 — so O-3 passes 4.0 to compare like with like)
 *   GNG_gly = 0.10 · FAT_ox[g]                                      (glycerol-derived glucose, Owen)
 * Steady state G_ss = G_ref·√(CI/CI_hab), linearised τ = 1/(2·k_G·G_ss) (≈ 1.1 d for G_ref 500 g, CI 330 → 150 g/d).
 * DNL above the glycogen capacity is not modelled here (O-3 stays below capacity at 70 %E carbohydrate).
 *
 * No engine imports: plain numbers in, plain numbers out.
 */

export interface DailyFuelInput {
  /** Initial total glycogen G_ref, g (also the reference for k_G). */
  gRefG: number;
  /** Habitual digestible carbohydrate CI_hab, g/d (defines k_G = CI_hab/G_ref²). */
  ciHabG: number;
  /** Carbohydrate intake, g/d, constant. */
  ciG: number;
  /** Total energy expenditure, kcal/d (isocaloric ⇒ constant). */
  teeKcal: number;
  /** Protein oxidised, g/d (nitrogen balance ≈ 0 ⇒ protein intake). */
  proteinOxG: number;
  /** Exercise energy expenditure carried by carbohydrate cap, kcal/d (default 0). */
  exEeKcal?: number;
  /** Keto-adaptation A_keto (default 0). */
  ketoAdapt?: number;
  /** Energy per gram of fat oxidised, kcal/g (default 9.44 = ρF 9 441 kcal/kg, Hall convention). */
  fatKcalPerG?: number;
  /** Energy per gram of protein oxidised, kcal/g (default 4.7 = 04 §4.11 as written; the engine convention is 4.0). */
  proteinKcalPerG?: number;
  days: number;
}

export interface DailyFuelResult {
  /** Glycogen at the start of day i (i = 0..days), g. */
  gG: Float64Array;
  /** Carbohydrate oxidised during day i (i = 0..days-1), g/d. */
  choOxG: Float64Array;
  /** Fat oxidised during day i, g/d. */
  fatOxG: Float64Array;
  /** k_G, 1/(d·g). */
  kG: number;
}

const C_KCAL = 4.1;
const P_KCAL = 4.7;

export function dailyFuelBalance(inp: DailyFuelInput): DailyFuelResult {
  const kG = inp.ciHabG / (inp.gRefG * inp.gRefG);
  const ket = inp.ketoAdapt ?? 0;
  const fatK = inp.fatKcalPerG ?? 9.44;
  const cap = (inp.teeKcal - (inp.exEeKcal ?? 0)) / C_KCAL;
  const cox = (g: number): number => Math.min(kG * g * g * (1 - 0.75 * ket), cap);
  const pK = inp.proteinKcalPerG ?? P_KCAL;
  const fox = (c: number): number => (inp.teeKcal - C_KCAL * c - pK * inp.proteinOxG) / fatK;
  // state: [G, cumulative C_ox, cumulative FAT_ox] ; the cumulative terms give the exact daily integrals
  const f = (x: Float64Array, out: Float64Array): void => {
    const c = cox(x[0]!);
    const fx = fox(c);
    out[0] = inp.ciG + 0.1 * fx - c;
    out[1] = c;
    out[2] = fx;
  };
  const dt = 1 / 32;
  const steps = 32;
  const x = new Float64Array([inp.gRefG, 0, 0]);
  const k1 = new Float64Array(3);
  const k2 = new Float64Array(3);
  const k3 = new Float64Array(3);
  const k4 = new Float64Array(3);
  const t = new Float64Array(3);
  const gG = new Float64Array(inp.days + 1);
  const choOxG = new Float64Array(inp.days);
  const fatOxG = new Float64Array(inp.days);
  gG[0] = inp.gRefG;
  for (let d = 0; d < inp.days; d++) {
    x[1] = 0;
    x[2] = 0;
    for (let s = 0; s < steps; s++) {
      f(x, k1);
      for (let j = 0; j < 3; j++) t[j] = x[j]! + 0.5 * dt * k1[j]!;
      f(t, k2);
      for (let j = 0; j < 3; j++) t[j] = x[j]! + 0.5 * dt * k2[j]!;
      f(t, k3);
      for (let j = 0; j < 3; j++) t[j] = x[j]! + dt * k3[j]!;
      f(t, k4);
      for (let j = 0; j < 3; j++) x[j] = x[j]! + (dt / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!);
    }
    gG[d + 1] = x[0]!;
    choOxG[d] = x[1]!;
    fatOxG[d] = x[2]!;
  }
  return { gG, choOxG, fatOxG, kG };
}

/** Steady-state glycogen for a constant carbohydrate intake (no cap, no keto): G_ref·√(CI/CI_hab). */
export function steadyGlycogenG(gRefG: number, ciHabG: number, ciG: number): number {
  return gRefG * Math.sqrt(ciG / ciHabG);
}

/** Linearised time constant at the steady state, d: 1/(2·k_G·G_ss). */
export function glycogenTauDays(gRefG: number, ciHabG: number, ciG: number): number {
  const kG = ciHabG / (gRefG * gRefG);
  return 1 / (2 * kG * steadyGlycogenG(gRefG, ciHabG, ciG));
}
