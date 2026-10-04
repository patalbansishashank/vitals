/**
 * Micronutrient completeness (dossier 15 §4.9 rule table; MODEL_SPEC §1.15). Rule-based flags from typical food
 * density × energy, never a simulated deficiency. Grade D; tone informational.
 *
 *   d_n      = D_TYPICAL[n] · QMULT[Q][n] · PATTERN_MULT(n; carbohydrate, animal level)
 *   intake_n = d_n · E/1000 + multivitamin supplement          (E = 7-d EMA of energy intake)
 *   R_n      = intake_n / EAR_n(sex)      flag: RED R < 0.75 · AMBER < 1.0 · YELLOW < 1.3 · GREEN
 *   add-ons  : FIBRE (14 g/1000 kcal), EFA (fat 20 / 15 g), FAT_SOL_ABSORPTION (fat/meal < 5 g), IODINE (vegan), iron_risk
 *   score    = 100 − 6·#RED − 3·#AMBER (clamped to 0..100)
 */
import type { WellbeingConstants } from './constants';
import type { WellbeingState } from './state';
import { FLAG_EFA, FLAG_FAT_SOL, FLAG_FIBRE, FLAG_IODINE, MICRO_IDX, N_FLAGS, N_MICRO } from './microTables';

/** Flag level codes stored in `WellbeingState.flags`. */
export const FLAG_GREEN = 0;
export const FLAG_YELLOW = 1;
export const FLAG_AMBER = 2;
export const FLAG_RED = 3;

/**
 * Re-evaluate every flag and the score from the state's 7-d EMAs. Allocation-free; writes `s.flags`, `s.nRed`,
 * `s.nAmber`, `s.microScore` and `s.caIntakeMg`.
 */
export function evaluateMicro(k: WellbeingConstants, s: WellbeingState): void {
  const flags = s.flags;
  const nMicro = N_MICRO;
  const nFlags = N_FLAGS;
  const ironIdx = MICRO_IDX.iron;
  const caIdx = MICRO_IDX.ca;
  const e = s.energyEma7 > 0 ? s.energyEma7 : 0;
  const carb = s.carbEma7;
  const q = s.foodQuality;
  const lowCarb = (carb < k.lowCarbG || (e > 0 && (4 * carb) / e < k.lowCarbEnergyFrac)) ? 1 : 0;
  const base = ((q < 1.5 ? 0 : q > 2.5 ? 2 : 1) * 2 + lowCarb) * nMicro;
  const perKcal = e / 1000;
  const ironRisk = k.menstruating === 1 && k.multivitamin === 0 && (e < k.ironRiskKcal || k.animalLevel >= 2);

  for (let i = 0; i < nMicro; i++) {
    const inv = k.microInvEar[i]!;
    const r = k.microD[base + i]! * perKcal * inv + k.microMvmR[i]!;
    let f = r < k.microRedR ? FLAG_RED : r < k.microAmberR ? FLAG_AMBER : r < k.microYellowR ? FLAG_YELLOW : FLAG_GREEN;
    if (i === ironIdx && ironRisk) {
      // iron_risk rule (15 §4.9): AMBER, RED with endurance training ≥ 5 h/wk; the worse of the two flags is kept
      const rr = s.endHrEma * 7 >= k.ironRiskTrainHWk ? FLAG_RED : FLAG_AMBER;
      if (rr > f) f = rr;
    }
    flags[i] = f;
    if (i === caIdx) s.caIntakeMg = inv > 0 ? r / inv : 0;
  }

  const level = k.animalLevel;
  const fibreDensity = e > 1 ? s.fibreEma7 / (e / 1000) : 0;
  flags[FLAG_FIBRE] = fibreDensity < k.fibreTargetPer1000 ? FLAG_AMBER : s.fibreEma7 < k.fibreYellowG ? FLAG_YELLOW : FLAG_GREEN;
  flags[FLAG_EFA] = s.efaLowDays > k.efaRedDays ? FLAG_RED : s.fatEma7 < k.efaAmberG ? FLAG_AMBER : FLAG_GREEN;
  flags[FLAG_FAT_SOL] = s.lowFatMealsEma7 > 0.5 ? FLAG_RED : FLAG_GREEN;
  flags[FLAG_IODINE] = level === 3 && k.multivitamin === 0 ? FLAG_AMBER : FLAG_GREEN;

  let nRed = 0;
  let nAmber = 0;
  for (let i = 0; i < nFlags; i++) {
    const f = flags[i]!;
    if (f === FLAG_RED) nRed++;
    else if (f === FLAG_AMBER) nAmber++;
  }
  s.nRed = nRed;
  s.nAmber = nAmber;
  const score = 100 - k.microRedPts * nRed - k.microAmberPts * nAmber;
  s.microScore = score < 0 ? 0 : score > 100 ? 100 : score;
}
