/**
 * Micronutrient PATTERN heuristic (dossier 15 §4.9 rule table; MODEL_SPEC §1.15): rule-based food-pattern prompts from
 * typical food density × energy. Grade D; archived heuristic (D8-08): never actual intake, a deficiency probability or a
 * nutrient status, not an optimisable objective, and it never overrides known logged amounts (those live in the shared
 * exposure ledger and are summarised by `./dri.ts`).
 *
 *   d_n      = D_TYPICAL[n] · QMULT[Q][n] · PATTERN_MULT(n; carbohydrate, animal level)
 *   pattern_n = d_n · E/1000                                   (E = 7-d EMA of energy intake; no multivitamin credit)
 *   known_n  : the mean KNOWN logged amount over completely covered days (shared ledger) replaces pattern_n when present
 *   R_n      = pattern_n / EAR_n(sex)     flag: RED R < 0.75 · AMBER < 1.0 · YELLOW < 1.3 · GREEN
 *   add-ons  : FIBRE (14 g/1000 kcal), EFA (low-fat PATTERN prompt: fat 20 / 15 g; total fat is not an EFA assay),
 *              FAT_SOL_ABSORPTION (fat/meal < 5 g), IODINE (vegan pattern), iron_risk (stated menstruation only)
 *   score    = 100 − 6·#RED − 3·#AMBER (clamped to 0..100)
 */
import type { WellbeingConstants } from './constants';
import type { WellbeingState } from './state';
import { FLAG_EFA, FLAG_FAT_SOL, FLAG_FIBRE, FLAG_IODINE, MICRO_IDX, MICRO_TRACKED, N_FLAGS, N_MICRO, TRACKED_IDX } from './microTables';

/** Flag level codes stored in `WellbeingState.flags`. */
export const FLAG_GREEN = 0;
export const FLAG_YELLOW = 1;
export const FLAG_AMBER = 2;
export const FLAG_RED = 3;

/**
 * Mean known amount of tracked nutrient `n` over the completely covered logged days of the observation window, or −1 when
 * there is none (unknown is never zero). O(1): reads the incremental window totals.
 */
export function knownCompleteMean(s: WellbeingState, n: number): number {
  const c = s.nutCompleteDays[n]!;
  return c > 0 ? s.nutCompleteSum[n]! / c : -1;
}

/** Flag of an intake-to-EAR ratio under the 15 §4.9 rubric (RED < 0.75 · AMBER < 1.0 · YELLOW < 1.3 · GREEN). */
function rubric(k: WellbeingConstants, r: number): number {
  return r < k.microRedR ? FLAG_RED : r < k.microAmberR ? FLAG_AMBER : r < k.microYellowR ? FLAG_YELLOW : FLAG_GREEN;
}

/**
 * Re-evaluate every flag and the score from the state's 7-d EMAs. Allocation-free; writes `s.flags`, `s.nRed`,
 * `s.nAmber`, `s.microScore` and `s.caPatternMg`.
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
  // D8-08: menstrual losses only when stated; an unknown multivitamin supplies no iron, so it does not lift the rule
  const ironRisk = k.menstruating === 1 && (e < k.ironRiskKcal || k.animalLevel >= 2);

  for (let i = 0; i < nMicro; i++) {
    const inv = k.microInvEar[i]!;
    const r = k.microD[base + i]! * perKcal * inv;
    // D8-08: a KNOWN logged amount (completely covered days of the observation window) takes precedence over the pattern
    // prior, which never overrides known grams; the same rubric is applied to it (a prompt, not a deficiency verdict)
    const t = MICRO_TRACKED[i]!;
    const known = t >= 0 ? knownCompleteMean(s, t) : -1;
    const rf = known >= 0 ? known * inv : r;
    let f = rubric(k, rf);
    if (i === ironIdx && ironRisk && known < 0) {
      // iron_risk rule (15 §4.9): AMBER, RED with endurance training ≥ 5 h/wk; the worse of the two flags is kept
      const rr = s.endHrEma * 7 >= k.ironRiskTrainHWk ? FLAG_RED : FLAG_AMBER;
      if (rr > f) f = rr;
    }
    flags[i] = f;
    if (i === caIdx) s.caPatternMg = inv > 0 ? r / inv : 0;
  }

  const level = k.animalLevel;
  const fibreDensity = e > 1 ? s.fibreEma7 / (e / 1000) : 0;
  flags[FLAG_FIBRE] = fibreDensity < k.fibreTargetPer1000 ? FLAG_AMBER : s.fibreEma7 < k.fibreYellowG ? FLAG_YELLOW : FLAG_GREEN;
  // D8-08: known α-linolenic and linoleic intake (complete logged days) replaces the total-fat proxy; below an AI the
  // adequacy is undetermined, so the prompt is at most YELLOW. Without them, total fat is only a low-fat PATTERN prompt.
  const ala = knownCompleteMean(s, TRACKED_IDX.ala);
  const la = knownCompleteMean(s, TRACKED_IDX.linoleic);
  if (ala >= 0 && la >= 0) flags[FLAG_EFA] = ala >= k.efaAiAlaG && la >= k.efaAiLaG ? FLAG_GREEN : FLAG_YELLOW;
  else flags[FLAG_EFA] = s.efaLowDays > k.efaRedDays ? FLAG_RED : s.fatEma7 < k.efaAmberG ? FLAG_AMBER : FLAG_GREEN;
  flags[FLAG_FAT_SOL] = s.lowFatMealsEma7 > 0.5 ? FLAG_RED : FLAG_GREEN;
  // vegan pattern: review reliable iodine sources (an unknown multivitamin is no known iodine dose); a known logged iodine
  // amount replaces the pattern prompt
  const iod = knownCompleteMean(s, TRACKED_IDX.iodine);
  flags[FLAG_IODINE] = iod >= 0 && k.iodineEarUg > 0 ? rubric(k, iod / k.iodineEarUg) : level === 3 ? FLAG_AMBER : FLAG_GREEN;

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
