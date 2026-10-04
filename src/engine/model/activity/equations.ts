/**
 * Pure equations of the activity module (dossier 10; 09 §4.13). Every function is a pure function of numbers and of the
 * constants object `ActivityK` (no allocation), so the unit tests can check each equation against the dossier's worked
 * numbers (10 §4.17 fixtures T1-T14) and the module calls them in its hooks.
 *
 * Units: mass kg, height m, VO2 mL/kg/min, energy kcal, minutes, speed km/h, power W, fractions of VO2max `x`.
 */
import type { SessionResolved } from '../../types/inputs';

/** Constants copied from the registry in `prepare` (never read in the step loop). */
export interface ActivityK {
  kcalPerL: number;
  metVo2: number;
  walkA: number;
  walkB: number;
  runVo2PerM: number;
  runEff: number;
  obesityFactor: number;
  obesityBmi: number;
  cycleBase: number;
  cycleEff: number;
  stepsNet: number;
  displaced: number;
  rtMetDefault: number;
  habitCardioMet: number;
  rpeA: number;
  rpeB: number;
  activeMuscleFrac: number;
  // EPOC
  epocPhiMax: number;
  epocPhiMaxInt: number;
  epocPhiFloor: number;
  epocMidX: number;
  epocSlopeX: number;
  epocDurRef: number;
  epocDurExp: number;
  epocRt: number;
  epocLightX: number;
  epocTauLight: number;
  epocTau1: number;
  epocTau2: number;
  epocFastShare: number;
  epocTrainedMult: number;
  epocTrainedSpan: number;
  postRtRee: number;
  postRtHours: number;
  postRtShield: number;
  // VO2max
  jacksonA: number;
  jacksonPar: number;
  jacksonAge: number;
  jacksonBmi: number;
  jacksonSex: number;
  par1: number;
  par2: number;
  par3: number;
  par4: number;
  par5: number;
  gMax: number;
  memHalf: number;
  gCap: number;
  sexF: number;
  z: number;
  /** Per-day exact rise factors 1 − exp(−1/τ) of the two pools. */
  riseF: number;
  riseS: number;
  tauDn: number;
  fastShare: number;
  rhoMax: number;
  rhoYears: number;
  hiRef: number;
  detrainShield: number;
  trainYears: number;
  // MEM
  memBand1: number;
  memBand2: number;
  memBand3: number;
  memW1: number;
  memW2: number;
  memW3: number;
  hardX: number;
  // mitochondria
  mcMax: number;
  mcHalf: number;
  mcRiseF: number;
  mcFallF: number;
  mrAmp: number;
  mrRiseF: number;
  mrFallF: number;
  aerobicRef: number;
  /** Modality default intensity (fraction VO2max) by modality code 1..7 (10 §4.8 band midpoints, core/defaults). */
  defaultX: Float64Array;
}

const isFin = Number.isFinite;

/** Resting VO2, mL/kg/min, from the person's own RMR (10 §4.17 restVo2): rmr/kcalPerL/1000... per minute per kg. */
export function restVo2(rmrKcalPerMin: number, bwKg: number, kcalPerL: number): number {
  return ((rmrKcalPerMin / kcalPerL) * 1000) / bwKg;
}

/** Level walking net VO2 above own rest, mL/kg/min (Ludlow & Weyand 2016): 3.85 + 5.97·V²/H, V in m/s. */
export function walkNetVo2(speedKmh: number, heightM: number, k: ActivityK): number {
  const v = speedKmh / 3.6;
  return k.walkA + (k.walkB * v * v) / heightM;
}

/** Running net VO2 above own rest, mL/kg/min: runEff · 0.2 mL/kg/m · speed (m/min) (ACSM × efficiency 0.90). */
export function runNetVo2(speedKmh: number, k: ActivityK): number {
  return k.runEff * k.runVo2PerM * ((speedKmh * 1000) / 60);
}

/** Cycling gross metabolic power in kcal/min: 2.4·RMR + P/0.26 (W → kcal/min = ·60/4184). */
export function cycleGrossKcalPerMin(powerW: number, rmrKcalPerMin: number, k: ActivityK): number {
  return k.cycleBase * rmrKcalPerMin + (powerW * 60) / (k.cycleEff * 4184);
}

/** Interim RPE (CR-10) → fraction of VO2max map (see ParamDef note): x = a + b·RPE, clamped to [0.2, 1.2]. */
export function rpeToX(rpe: number, k: ActivityK): number {
  const x = k.rpeA + k.rpeB * rpe;
  return x < 0.2 ? 0.2 : x > 1.2 ? 1.2 : x;
}

/**
 * Gross energy rate of a session in kcal/min (MODEL_SPEC §1.2 steps 1-2, 10 §4.17 exerciseEnergy).
 * Resolution order: given %VO2max → given MET → speed (walk: Ludlow, run: ACSM·runEff) → power (cycling formula) →
 * RPE → modality default %VO2max. Resistance sessions: session MET (style MET from the compiler, else the default).
 */
export function sessionGrossKcalPerMin(
  k: ActivityK,
  s: SessionResolved,
  vo2max: number,
  bwKg: number,
  heightM: number,
  rmrKcalPerMin: number,
  bmi: number,
): number {
  let vo2: number;
  if (s.kind === 'resistance') {
    vo2 = (isFin(s.met) && s.met > 0 ? s.met : k.rtMetDefault) * k.metVo2;
  } else if (isFin(s.met) && s.met > 0) {
    // a stated MET is the session-average gross cost (inputs.ts `met`); an intensity given with it is the work intensity
    // (e.g. HIIT at 90 % VO2max whose work:rest average is 8 MET) and sets only the descriptors (x, EPOC, MEM)
    vo2 = s.met * k.metVo2;
  } else if (isFin(s.intensityFrac)) {
    vo2 = s.intensityFrac * vo2max;
  } else if (s.modality === 1 && isFin(s.speedKmh)) {
    // walking: obesity factor on the net cost per kg (Browning 2006)
    vo2 = restVo2(rmrKcalPerMin, bwKg, k.kcalPerL) + walkNetVo2(s.speedKmh, heightM, k) * (bmi >= k.obesityBmi ? k.obesityFactor : 1);
  } else if (s.modality === 2 && isFin(s.speedKmh)) {
    vo2 = restVo2(rmrKcalPerMin, bwKg, k.kcalPerL) + runNetVo2(s.speedKmh, k);
  } else if (isFin(s.powerW)) {
    return cycleGrossKcalPerMin(s.powerW, rmrKcalPerMin, k);
  } else if (isFin(s.rpe)) {
    vo2 = rpeToX(s.rpe, k) * vo2max;
  } else {
    const code = s.modality;
    vo2 = (code >= 1 && code <= 7 ? k.defaultX[code]! : k.defaultX[7]!) * vo2max;
  }
  return (vo2 * bwKg * k.kcalPerL) / 1000;
}

/** VO2 (mL/kg/min) equivalent of a gross kcal/min rate. */
export const vo2FromKcalPerMin = (kcalPerMin: number, bwKg: number, kcalPerL: number): number => (kcalPerMin * 1000) / (kcalPerL * bwKg);

/** 10 §4.2 EPOC fraction φ of the session's net kcal (10 §4.17 epocKcal). Duration in minutes = the whole session. */
export function epocPhi(x: number, durationMin: number, isRt: boolean, isInterval: boolean, k: ActivityK): number {
  if (isRt) return k.epocRt;
  const s = 1 / (1 + Math.exp(-(x - k.epocMidX) / k.epocSlopeX));
  const dur = durationMin / k.epocDurRef;
  const dfac = dur >= 1 ? 1 : Math.pow(dur, k.epocDurExp);
  const phiMax = isInterval ? k.epocPhiMaxInt : k.epocPhiMax;
  const phi = phiMax * s * dfac;
  return phi < k.epocPhiFloor ? k.epocPhiFloor : phi > phiMax ? phiMax : phi;
}

/** EPOC recovery-speed factor 1 − 0.25·clamp((M_c·M_r − 1)/0.4, 0, 1) (10 §4.2, §4.9: τ × 0.75 at index ≥ 1.4). */
export function trainedTauFactor(mitoIdx: number, k: ActivityK): number {
  const t = (mitoIdx - 1) / k.epocTrainedSpan;
  return 1 - k.epocTrainedMult * (t < 0 ? 0 : t > 1 ? 1 : t);
}

/** 10 §4.8B moderate-equivalent-minute weight per minute at relative intensity x (continuous work). */
export function memWeight(x: number, k: ActivityK): number {
  return x < k.memBand1 ? 0 : x < k.memBand2 ? k.memW1 : x < k.memBand3 ? k.memW2 : k.memW3;
}

/** 10 §4.8A Jackson non-exercise VO2max (mL/kg/min); `male` ∈ {0, 0.5 (unspecified sex), 1}. */
export function jacksonVo2max(male: number, ageY: number, bmi: number, par: number, k: ActivityK): number {
  return k.jacksonA + k.jacksonPar * par + k.jacksonAge * ageY + k.jacksonBmi * bmi + k.jacksonSex * male;
}

/** Steady-state training-induced gain g* = min(cap, gMax·z·sexF·MEM²/(MEM² + K²)) (10 §4.8B). */
export function vo2GainTarget(mem: number, k: ActivityK): number {
  const m2 = mem * mem;
  const d = m2 / (m2 + k.memHalf * k.memHalf);
  const g = k.gMax * k.z * k.sexF * d;
  return g < k.gCap ? g : k.gCap;
}

/** Retention floor ρ = rhoMax·(1 − exp(−trainYears/2)) (10 §4.8C). */
export const retentionRho = (trainYears: number, k: ActivityK): number => k.rhoMax * (1 - Math.exp(-trainYears / k.rhoYears));

/**
 * One-day update of a VO2max gain pool (10 §4.17 updateVo2max `upd`): rise toward `share·g*` with the exact factor
 * `riseF`; below target: decay toward max(target, ρ·share·gPeak) at rate (1/τDn)·(1 − 0.9·m).
 * `fallF` = 1 − exp(−rate·1 d) is supplied by the caller (it depends on the day's high-intensity maintenance m).
 */
export function updateGainPool(g: number, target: number, riseF: number, fallF: number, floor: number): number {
  if (target >= g) return g + (target - g) * riseF;
  const t = target > floor ? target : floor;
  return g + (t - g) * fallF;
}

/** 10 §4.9 content target M_c* = 1 + 0.5·D_c(MEM), D_c = MEM²/(MEM² + 150²). */
export function mitoContentTarget(mem: number, k: ActivityK): number {
  const m2 = mem * mem;
  return 1 + (k.mcMax * m2) / (m2 + k.mcHalf * k.mcHalf);
}

/** 10 §4.9 respiratory-capacity target M_r* = 1 + 0.30·min(1, HImin/30). */
export function mitoRespTarget(hiMinWk: number, k: ActivityK): number {
  const m = hiMinWk / k.hiRef;
  return 1 + k.mrAmp * (m < 1 ? m : 1);
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9), p ∈ (0, 1). */
export function normInv(p: number): number {
  const a1 = -3.969683028665376e1;
  const a2 = 2.209460984245205e2;
  const a3 = -2.759285104469687e2;
  const a4 = 1.38357751867269e2;
  const a5 = -3.066479806614716e1;
  const a6 = 2.506628277459239;
  const b1 = -5.447609879822406e1;
  const b2 = 1.615858368580409e2;
  const b3 = -1.556989798598866e2;
  const b4 = 6.680131188771972e1;
  const b5 = -1.328068155288572e1;
  const c1 = -7.784894002430293e-3;
  const c2 = -3.223964580411365e-1;
  const c3 = -2.400758277161838;
  const c4 = -2.549732539343734;
  const c5 = 4.374664141464968;
  const c6 = 2.938163982698783;
  const d1 = 7.784695709041462e-3;
  const d2 = 3.224671290700398e-1;
  const d3 = 2.445134137142996;
  const d4 = 3.754408661907416;
  const pLow = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let q: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  if (p > 1 - pLow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  q = p - 0.5;
  const r = q * q;
  return ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
}

/** Individual VO2max responsiveness z = clamp(1 + sd·Φ⁻¹(u), zMin, zMax) (10 §4.8B: z ~ N(1, 0.5) truncated [0.2, 2.0]). */
export function responsiveness(u: number, sd: number, zMin: number, zMax: number): number {
  const uu = u < 1e-9 ? 1e-9 : u > 1 - 1e-9 ? 1 - 1e-9 : u;
  const z = 1 + sd * normInv(uu);
  return z < zMin ? zMin : z > zMax ? zMax : z;
}

/** Overlap length (h) of [a0, a1] and [b0, b1]. */
export function overlapH(a0: number, a1: number, b0: number, b1: number): number {
  const lo = a0 > b0 ? a0 : b0;
  const hi = a1 < b1 ? a1 : b1;
  return hi > lo ? hi - lo : 0;
}

/** Net step energy above the habitual baseline for a day (kcal): stepsNet/1000·BW·(steps − habitual) (10 §4.14). */
export function stepEnergyAboveBaseline(steps: number, habitualSteps: number, bwKg: number, k: ActivityK, bmi: number): number {
  return ((k.stepsNet * (bmi >= k.obesityBmi ? k.obesityFactor : 1)) / 1000) * bwKg * (steps - habitualSteps);
}
