/**
 * safety — per-day evaluation of the simulator warning rules (docs/MODEL_SPEC.md §7.2; dossier 17 §3, §4.3).
 *
 * `evaluateDay` reads the day's derived quantities (`state.q`, filled in `endOfDay`), the day inputs and the profile
 * flags, updates the consecutive-day counters and records hits in the rule × day matrix (`setHit`). It allocates
 * nothing. Rules that depend on a whole fast (W-F01…W-F05 tiers, W-F07 spacing) are completed in `finalize` /
 * `closeEpisode`; W-F08 is decided on the day a >= 72 h fast ends.
 *
 * Interpretations made where the dossier row is not exact (each is reported in the WP hand-back):
 *  - "any deficit" = deficit_pct_7 > 5 % (the HC-E7 maintenance band) — `deficitAnyPct`;
 *  - protein, fat and fibre rules use 7-day means (HC-M1/M3/M5 window 7 d) so zero-intake days do not fire them alone;
 *  - W-M08/M09/M10/M24 and the fat/fibre/sodium counters use the day's own values (consecutive-day counters);
 *  - the caution/danger pairs on one quantity (W-E11/E12, W-E15/E16) are exclusive bands like W-E03/E04;
 *  - supplemental potassium / magnesium = intake above the schedule's default dietary level.
 * Integration pass 2026-09-30 (MODEL_SPEC §7.2): planned fast-event days follow the fasting-tier rules (ruling 18:10:
 * W-E01…W-E04 on non-fast days, 28-day floor and tissue trend near fasts); EA rules need a deficit; W-E13 needs a
 * plan-induced tissue loss; W-M11/W-M13 fire only when informative; W-U notes are day-0 header notes; W-F08 honours a
 * planned refeed; W-M19 covers the 24 h before a planned T3+ fast.
 */
import type { DayInput } from '../../types/inputs';
import { RULE_INDEX } from './rules';
import {
  RING as RING_IMPORT,
  RUN as RUN_IMPORT,
  N_REG as N_REG_IMPORT,
  setHit as setHitImport,
  setHitWorst as setHitWorstImport,
} from './state';
import type { SafetyK, SafetyState } from './state';
import { ringSum as ringSumImport } from './derived';
import { countRecentFasts as countRecentFastsImport } from './episodes';

// Local aliases: bundlers inline imported constants, but a test transform (vite-node) turns every use of an imported
// binding into a property read of the module object, which is slow in a loop that runs 100+ rule checks per day.
const X = RULE_INDEX;
const RING = RING_IMPORT;
const RUN = RUN_IMPORT;
const N_REG = N_REG_IMPORT;
const setHit = setHitImport;
const setHitWorst = setHitWorstImport;
const ringSum = ringSumImport;
const countRecentFasts = countRecentFastsImport;

// ------------------------------------------------------------------ attribution of rolling-window rules
// Blocker round 2026-10-01: a warning run's days are the days whose own inputs/state produced it. When a rule on a rolling
// 7-day mean (or a 14/28-day tissue trend) fires on day d, the hit goes to the days of that window (day ≥ 0) whose OWN value
// is on the triggering side — a 14-day high-protein block from day 0 reads days 0-13, not 5-15 (the mean crossed late
// because the window starts with habitual burn-in days, and stayed high for days after the block). The mean itself is
// unchanged ("averaged over the last 7 days" is literal, habitual days included), so the Planner's margins, which read the
// same trace, still see every violation the Simulator reports (R-PLAN-SAFETY). Own-value predicates:
const OWN_EI_BELOW = 1; // non-fast day with intake < lim
const OWN_DEFICIT = 2; // non-fast day in deficit
const OWN_PROT_RW_BELOW = 3; // non-fast day with protein/RW < lim
const OWN_PROT_RW_ABOVE = 4;
const OWN_PROT_PCT_ABOVE = 5; // protein %E > lim
const OWN_PROT_FFM_ABOVE = 6;
const OWN_FAT_LOW = 7; // fat < lim g or < lim2 %E (non-fast days with intake)
const OWN_ALCOHOL = 8;
const OWN_LOSS_PCT = 9; // own tissue loss, %/wk > the day's cap
const OWN_LOSS_KG = 10; // own tissue loss, kg/wk > lim
const OWN_GAIN_PCT = 11; // own tissue gain, %/wk > lim
const OWN_SURPLUS = 12; // non-fast day with intake > TEE·(1 + lim/100)

/** Own daily tissue-mass change of day j, kg/d (end of day j − end of day j − 1; day 0 from t = 0). */
function ownDtm(s: SafetyState, j: number): number {
  return s.dTm[j]! - (j > 0 ? s.dTm[j - 1]! : s.tm0);
}

function ownBad(s: SafetyState, j: number, kind: number, lim: number, lim2: number): boolean {
  const fast = s.dFast[j] === 1;
  switch (kind) {
    case OWN_EI_BELOW:
      return !fast && s.dEi[j]! < lim;
    case OWN_DEFICIT:
      return !fast && s.dDef[j] === 1;
    case OWN_PROT_RW_BELOW:
      return !fast && s.dRw[j]! > 0 && s.dProt[j]! / s.dRw[j]! < lim;
    case OWN_PROT_RW_ABOVE:
      return !fast && s.dRw[j]! > 0 && s.dProt[j]! / s.dRw[j]! > lim;
    case OWN_PROT_PCT_ABOVE:
      return !fast && s.dEi[j]! > 0 && (400 * s.dProt[j]!) / s.dEi[j]! > lim;
    case OWN_PROT_FFM_ABOVE:
      return !fast && s.dFfm[j]! > 0 && s.dProt[j]! / s.dFfm[j]! > lim;
    case OWN_FAT_LOW:
      return !fast && s.dEi[j]! > 0 && (s.dFat[j]! < lim || (900 * s.dFat[j]!) / s.dEi[j]! < lim2);
    case OWN_ALCOHOL:
      return s.dAlc[j]! > 0;
    case OWN_LOSS_PCT: {
      const tm = s.dTm[j]!;
      return tm > 0 && (-700 * ownDtm(s, j)) / tm > s.capPctD[j]!;
    }
    case OWN_LOSS_KG:
      return -7 * ownDtm(s, j) > lim;
    case OWN_GAIN_PCT: {
      const tm = s.dTm[j]!;
      return tm > 0 && (700 * ownDtm(s, j)) / tm > lim;
    }
    case OWN_SURPLUS:
      return !fast && s.dEi[j]! > s.dTdee[j]! * (1 + lim / 100);
    default:
      return false;
  }
}

/**
 * The rule fired on day `d` on a window of `n` days: hit every day of the window (≥ 0) whose own value is on the triggering
 * side, with the window's driving value (worst kept). When no day qualifies (a trend without any single day beyond the
 * limit) the evaluation day itself carries the hit, as before — except for the deficit/surplus rules, which attach only to
 * days that are themselves in deficit/surplus (final round 2026-09-30).
 */
function hitWindow(s: SafetyState, rule: number, d: number, n: number, value: number, kind: number, lim: number, lim2 = 0): void {
  const lo = d - n + 1 > 0 ? d - n + 1 : 0;
  let any = false;
  for (let j = lo; j <= d; j++) {
    if (ownBad(s, j, kind, lim, lim2)) {
      setHitWorst(s, rule, j, value);
      any = true;
    }
  }
  if (!any && kind !== OWN_DEFICIT && kind !== OWN_SURPLUS) setHitWorst(s, rule, d, value);
}

/** Store day `d`'s own values for the window attribution (called before `evaluateDay`). */
export function recordOwnDay(s: SafetyState, k: SafetyK, d: number, rw: number): void {
  const q = s.q;
  s.dEi[d] = q.ei;
  s.dTdee[d] = q.tdee;
  s.dProt[d] = s.dayProtG;
  s.dFat[d] = s.dayFatG;
  s.dAlc[d] = s.dayAlcG;
  s.dTm[d] = q.tm;
  s.dFfm[d] = q.ffm;
  s.dRw[d] = rw;
  s.dFast[d] = q.fastDay ? 1 : 0;
  s.dDef[d] = q.ei < q.tdee * (1 - k.deficitAnyPct / 100) ? 1 : 0;
}

/**
 * Exclusive bands after the window attribution (finalize): a day carrying the danger rule of a pair drops the caution one
 * (W-E04 over W-E03, W-E06 over W-E05).
 */
export function exclusiveBands(s: SafetyState): void {
  const nD = s.nDays;
  const pairs = [X['W-E04'], X['W-E03'], X['W-E06'], X['W-E05']];
  for (let p = 0; p < pairs.length; p += 2) {
    const hi = pairs[p]! * nD;
    const lo = pairs[p + 1]! * nD;
    for (let d = 0; d < nD; d++) if (s.hit[hi + d] === 1) s.hit[lo + d] = 0;
  }
}

/** Evaluate every warning rule for day `d` (>= 0). */
export function evaluateDay(s: SafetyState, k: SafetyK, day: DayInput, d: number): void {
  const q = s.q;
  const runs = s.runs;
  const female = k.isFemale;
  const floor = female ? k.floorFemaleKcal : k.floorMaleKcal;
  const bfFloor = female ? k.bfFloorFemale : k.bfFloorMale;
  const ei7 = q.ei7;
  const def7 = q.def7;
  const ea7 = q.ea7;
  const eaOk = q.eaFinite && q.eaApplies;
  const nowHour = (d + 1) * 24;

  // ------------------------------------------------------------------ energy, rate, body size
  // HC-E1 floor on q.eiFloor: the 7-day mean over non-fast days, or the lower of that and the 28-day mean when a planned
  // fast lies in the trailing 28 d (ruling 18:10); on fast-event days only the 28-day mean is checked
  const eiF = q.eiFloor;
  if (eiF >= k.vledKcal && eiF < floor) hitWindow(s, X['W-E01'], d, 7, eiF, OWN_EI_BELOW, floor);
  if (!q.fastDay) runs[RUN.vled] = eiF < k.vledKcal && q.fastH7 <= 0 ? runs[RUN.vled]! + 1 : 0;
  if (runs[RUN.vled]! >= k.vledDays) setHit(s, X['W-E02'], d, eiF);

  // 7-day deficit rules attach to days that are themselves in deficit (final round 2026-09-30: a day at 100 % right after
  // deficit days was labelled with the 7-day mean; the text says "averaged over the last 7 days")
  // (and, since the blocker round, to every deficit day of the 7-day window that produced the mean, from day 0)
  if (def7 > q.capDef && def7 <= k.deficitDangerPct) hitWindow(s, X['W-E03'], d, 7, def7, OWN_DEFICIT, 0);
  if (def7 > k.deficitDangerPct) hitWindow(s, X['W-E04'], d, 7, def7, OWN_DEFICIT, 0);
  s.capDefD[d] = q.capDef;
  s.capPctD[d] = q.capPct;

  // loss-rate rules: the trend window (14 d, or 28 d with a fast-event day in it) → the days that lost tissue beyond the cap
  // (a fast's drop is attributed to the fast's days, not to the days after it when the 28-day slope peaks)
  const rateN = q.fastIn28 ? 28 : 14;
  if (q.rate14Kg > k.rateCapAbsKgWk) hitWindow(s, X['W-E06'], d, rateN, q.rate14Kg, OWN_LOSS_KG, k.rateCapAbsKgWk);
  else if (q.rate14Pct > q.capPct) hitWindow(s, X['W-E05'], d, rateN, q.rate14Pct, OWN_LOSS_PCT, 0);

  // EA rules use EA_7 over non-fast days (ruling R-FAST-GATE); on a fast-event day EA_7 is not evaluated and the
  // persistence counters pause (they used to reset, so weekly fasts kept "for more than 14 days" from ever counting)
  if (eaOk) {
    runs[RUN.ea3035] = ea7 >= k.eaHardMin && ea7 < k.eaReducedUpper ? runs[RUN.ea3035]! + 1 : 0;
    runs[RUN.eaLow] = ea7 < k.eaHardMin ? runs[RUN.eaLow]! + 1 : 0;
    runs[RUN.ea45] = ea7 < k.eaAdequate ? runs[RUN.ea45]! + 1 : 0;
    if (runs[RUN.ea3035]! > k.eaCautionDays) setHit(s, X['W-E07'], d, ea7);
    if (ea7 < k.eaHardMin) setHit(s, X['W-E08'], d, ea7);
    if (ea7 >= k.eaReducedUpper && ea7 < k.eaAdequate) setHit(s, X['W-E09'], d, ea7);
    if (runs[RUN.eaLow]! > k.eaCautionDays) setHit(s, X['W-E20'], d, ea7);
  } else if (!q.fastDay) {
    runs[RUN.ea3035] = 0;
    runs[RUN.eaLow] = 0;
    runs[RUN.ea45] = 0;
  }
  // deficit-block counters pause on fast-event days (their deficit belongs to the fasting-tier rules, ruling 18:10)
  if (!q.fastDay) runs[RUN.def15] = def7 >= k.blockDeficitPct ? runs[RUN.def15]! + 1 : 0;
  if (runs[RUN.def15]! > k.blockMaxDays) setHit(s, X['W-E10'], d, runs[RUN.def15]!);
  if (runs[RUN.def15]! > k.blockLongDays || runs[RUN.ea45]! > k.eaBoneDays) {
    setHit(s, X['W-E19'], d, runs[RUN.def15]! > runs[RUN.ea45]! ? runs[RUN.def15]! : runs[RUN.ea45]!);
  }
  if (q.cum > k.cumLossDangerPct) setHit(s, X['W-E12'], d, q.cum);
  else if (q.cum > k.cumLossMaxPct) setHit(s, X['W-E11'], d, q.cum);
  // projected (tissue-mass) BMI; W-E13 "this plan takes your BMI to …" needs a plan-induced tissue loss
  if (q.bmi < k.bmiUnderweight) setHit(s, X['W-E14'], d, q.bmi);
  else if (q.bmi < k.bmiCaution && q.cumTm > k.bmiCautionMinLossPct) setHit(s, X['W-E13'], d, q.bmi);
  const bfCaution = female ? k.bfCautionFemale : k.bfCautionMale;
  const bfDanger = female ? k.bfDangerFemale : k.bfDangerMale;
  if (q.bf < bfDanger) setHit(s, X['W-E16'], d, q.bf);
  else if (q.bf < bfCaution) setHit(s, X['W-E15'], d, q.bf);
  runs[RUN.hair] = q.rate14Pct >= k.rateHairPct ? runs[RUN.hair]! + 1 : 0;
  if (runs[RUN.hair]! >= k.rateHairDays) setHit(s, X['W-E17'], d, q.rate14Pct);
  if (female && ((eaOk && runs[RUN.ea45]! >= k.eaFemaleDays) || q.bf < k.bfCautionFemale)) {
    setHit(s, X['W-E18'], d, eaOk ? ea7 : q.bf);
  }

  // ------------------------------------------------------------------ macronutrients, fluids, substances
  if (q.protRw7 < k.proteinFloor) hitWindow(s, X['W-M01'], d, 7, q.protRw7, OWN_PROT_RW_BELOW, k.proteinFloor);
  if (
    q.protRw7 < k.proteinDeficitFloor &&
    (def7 > k.proteinDeficitTriggerPct || (q.rtDays7 >= k.rtDaysProtein && def7 > k.deficitAnyPct))
  ) {
    hitWindow(s, X['W-M02'], d, 7, q.protRw7, OWN_PROT_RW_BELOW, k.proteinDeficitFloor);
  }
  if (q.protPctE7 > k.proteinCapPctEnergy) hitWindow(s, X['W-M03'], d, 7, q.protPctE7, OWN_PROT_PCT_ABOVE, k.proteinCapPctEnergy);
  if (q.protFfm7 > k.proteinCapGPerKgFfm) hitWindow(s, X['W-M04'], d, 7, q.protFfm7, OWN_PROT_FFM_ABOVE, k.proteinCapGPerKgFfm);
  if (k.kidneyFlag && q.protRw7 > k.proteinCkdCapGPerKgRw)
    hitWindow(s, X['W-M05'], d, 7, q.protRw7, OWN_PROT_RW_ABOVE, k.proteinCkdCapGPerKgRw);
  if (ei7 >= k.vledKcal && (q.fat7 < k.fatMinG || q.fatPct7 < k.fatMinPctEnergy))
    hitWindow(s, X['W-M06'], d, 7, q.fat7, OWN_FAT_LOW, k.fatMinG, k.fatMinPctEnergy);
  runs[RUN.fatLow] = q.fat < k.fatVeryLowG ? runs[RUN.fatLow]! + 1 : 0;
  if (runs[RUN.fatLow]! >= k.fatVeryLowDays) setHit(s, X['W-M07'], d, q.fat);

  const carb = q.carb;
  const keto = carb < k.carbKetoG;
  runs[RUN.carbKeto] = keto ? runs[RUN.carbKeto]! + 1 : 0;
  if (keto) {
    setHit(s, X['W-M08'], d, carb);
    if (runs[RUN.carbKeto]! >= k.carbKetoDays) setHit(s, X['W-M09'], d, carb);
    if (k.contraindKeto || q.bmi < k.bmiUnderweight) setHit(s, X['W-M10'], d, carb);
    const fluid = day.fluidL;
    if (k.kidneyStones || (fluid < k.fluidStoneL && Number.isFinite(fluid))) setHit(s, X['W-M24'], d, carb);
  }
  // W-M11 "low fibre with low intake": counts while in a deficit, or when the user entered a low habitual fibre intake
  // (the population default of 8 g/1000 kcal at maintenance is not a plan-induced problem; integration 2026-09-30)
  const fibreInformative = def7 > k.deficitAnyPct || k.habFibreEntered;
  if (!q.fastDay) runs[RUN.fibreLow] = q.fibreDens < k.fibreMinPer1000Kcal && fibreInformative ? runs[RUN.fibreLow]! + 1 : 0;
  if (runs[RUN.fibreLow]! > k.fibreDays) setHit(s, X['W-M11'], d, q.fibreDens);

  const fasting = q.fastHMax > k.tierT0MaxH;
  const sodiumG = day.sodiumMg / 1000;
  if ((fasting || keto) && sodiumG < k.sodiumLowG) setHit(s, X['W-M12'], d, sodiumG);
  const sodiumExempt = fasting || keto || day.sweatLPerH > 0;
  // W-M13 is informative when the sodium is the user's (entered habitual intake) or the plan raises it above the habitual
  // level; the population default habitual sodium (3.0 g) alone does not fire it (integration 2026-09-30)
  const sodiumInformative = k.habSodiumEntered || day.sodiumMg > k.habSodiumMg + 1;
  runs[RUN.sodiumHigh] = sodiumG > k.sodiumHighG && !sodiumExempt && sodiumInformative ? runs[RUN.sodiumHigh]! + 1 : 0;
  if (runs[RUN.sodiumHigh]! > k.sodiumHighDays) setHit(s, X['W-M13'], d, sodiumG);
  const fluidL = day.fluidL;
  if (fluidL < k.fluidMinL) setHit(s, X['W-M14'], d, fluidL);
  if (fluidL > k.fluidMaxL) setHit(s, X['W-M15'], d, fluidL);
  const suppK = (day.potassiumMg - k.potassiumBaseMg) / 1000;
  if (suppK > k.potassiumSuppMaxG) setHit(s, X['W-M16'], d, suppK);
  const suppMg = day.magnesiumMg - k.magnesiumBaseMg;
  if (suppMg > k.magnesiumSuppMaxMg) setHit(s, X['W-M17'], d, suppMg);
  const units7 = q.alc7G / k.alcoholUnitG;
  if (units7 > k.alcoholUnitsPerWeek) hitWindow(s, X['W-M18'], d, 7, units7, OWN_ALCOHOL, 0);
  const alcToday = s.dayAlcG;
  if (alcToday > 0 && (q.tier >= 2 || q.ei < k.alcoholVledKcal || s.dayAlcAfterLong > 0))
    setHit(s, X['W-M19'], d, alcToday);
  if (alcToday > k.alcoholOccasionDrinks * k.alcoholDrinkG) setHit(s, X['W-M20'], d, alcToday);
  if (s.dayCaffMg > k.caffeineDayMg || s.dayCaffDoseMaxMg > k.caffeineDoseMg)
    setHit(s, X['W-M21'], d, s.dayCaffMg);
  if (s.dayCaffBedMg >= k.caffeineBedMg) setHit(s, X['W-M22'], d, s.dayCaffBedMg);
  runs[RUN.creatineLoad] = day.creatineLoading ? runs[RUN.creatineLoad]! + 1 : 0;
  if (
    (day.creatineG > k.creatineMaintG && !day.creatineLoading) ||
    runs[RUN.creatineLoad]! > k.creatineLoadDays
  ) {
    setHit(s, X['W-M23'], d, day.creatineG);
  }

  // ------------------------------------------------------------------ fasting and very-low-energy patterns
  // W-F01…W-F05 are written from the (episode-relabelled) tier array in finalize; the rest are per day.
  if (s.dayNoElecFastH >= k.electrolyteFastH) setHit(s, X['W-F06'], d, s.dayNoElecFastH);
  // W-F08 "fast ≥ 72 h and no refeeding ramp": a planned refeed (refeed 'auto' / custom factors) never fires it; a planned
  // fast without one fires when the next day's planned intake is above refeedFirstDayMaxFrac of TDEE0 (the day the fast
  // ends may be partial); an unplanned zero-intake run falls back to the first eating day's intake
  if (s.dayEpEndLenH >= k.refeedMinFastH && k.plannedRefeedDay[d] !== 1) {
    const planned = k.fastDay[d] === 1 || k.plannedNoRampDay[d] === 1;
    if (planned ? k.plannedNoRampDay[d] === 1 : q.ei > k.refeedFirstDayMaxFrac * q.tdee) setHit(s, X['W-F08'], d, s.dayEpEndLenH);
  }
  if (s.dayHardInFastH >= k.hardFastH) setHit(s, X['W-F09'], d, s.dayHardInFastH);
  const longFast = q.tier >= 3;
  // reported fast length: the planned span's meal-to-meal duration where there is one (the unit the user entered)
  const fastRep = k.spanM2mDay[d]! > q.fastHMax ? k.spanM2mDay[d]! : q.fastHMax;
  if (longFast && q.bmi < k.t3BmiMax) setHit(s, X['W-F10'], d, fastRep);
  if (longFast) setHit(s, X['W-F11'], d, fastRep);
  const psmf =
    q.ei > k.zeroKcalDay && q.ei < k.vledKcal && (4 * s.dayProtG) / q.ei >= k.psmfProteinPctEnergy / 100;
  runs[RUN.psmf] = psmf ? runs[RUN.psmf]! + 1 : 0;
  if (runs[RUN.psmf]! >= k.psmfDays) setHit(s, X['W-F12'], d, runs[RUN.psmf]!);
  const fastsT2 = countRecentFasts(s, nowHour, k.fastWindowDays * 24, k.tierT1MaxH, s.fastRunH);
  // R-T4CAP: the 108-h cap counts T1-T3 fasting hours only (a single T4 fast follows its own tier rule, W-F07 spacing)
  if (fastsT2 >= k.fastsT2In14d || q.fastH7Cap > k.fastH7Max) setHit(s, X['W-F13'], d, q.fastH7Cap);
  if (
    !day.zeroIntake &&
    day.fastHours === 0 &&
    day.nMeals >= 1 &&
    (day.windowLengthH < k.eatingWindowMinH || day.nMeals === 1)
  ) {
    setHit(s, X['W-F14'], d, day.windowLengthH);
  }

  // ------------------------------------------------------------------ exercise
  if (k.novice && s.daysSeen >= RING) {
    const run7 = ringSum(s.runRing, s.ringIdx, RING, 7, 0);
    const runPrev = ringSum(s.runRing, s.ringIdx, RING, 7, 7);
    if (runPrev > 0) {
      const inc = (100 * (run7 - runPrev)) / runPrev;
      if (inc > k.runIncreaseMaxPct) setHit(s, X['W-X01'], d, inc);
    }
  }
  if (k.novice) {
    let maxSets = 0;
    let maxInc = -1e9;
    for (let r = 0; r < N_REG; r++) {
      let a = 0;
      let b = 0;
      for (let j = 1; j <= 7; j++) a += s.setsRing[((s.ringIdx - j + 2 * RING) % RING) * N_REG + r]!;
      for (let j = 8; j <= 14; j++) b += s.setsRing[((s.ringIdx - j + 2 * RING) % RING) * N_REG + r]!;
      if (a > maxSets) maxSets = a;
      if (a - b > maxInc) maxInc = a - b;
    }
    if ((d < 7 && maxSets > k.rtSetsStartMax) || (s.daysSeen >= RING && maxInc > k.rtSetsIncreaseMax))
      setHit(s, X['W-X02'], d, maxSets);
  }
  runs[RUN.training] = day.nSessions > 0 ? runs[RUN.training]! + 1 : 0;
  if (runs[RUN.training]! >= k.restDayRun) setHit(s, X['W-X03'], d, runs[RUN.training]!);
  const vigorous = s.dayVigorousFrac > 0;
  if ((k.hotFlag || day.hotClimate) && vigorous) setHit(s, X['W-X04'], d, s.dayVigorousFrac);
  if (k.exerciseFlag && vigorous) setHit(s, X['W-X05'], d, s.dayVigorousFrac);

  // ------------------------------------------------------------------ surplus
  const gainPct = -q.rate14Pct;
  if (gainPct > k.gainRateMaxPct) hitWindow(s, X['W-S01'], d, rateN, gainPct, OWN_GAIN_PCT, k.gainRateMaxPct);
  const surplusPct = q.tdee7 > 0 ? 100 * (ei7 / q.tdee7 - 1) : Number.NaN;
  // near a fast (fast-event day in the trailing 28 d) a surplus must also hold over 28 days: eating at maintenance after a
  // fast reads as a 7-day "surplus" against the post-fast TDEE but is not a planned gain (final round 2026-09-30)
  const surplus28Ok = !q.fastIn28 || q.def28 < -k.deficitAnyPct;
  if (!q.fastDay) runs[RUN.surplus] = surplusPct > k.surplusMaxPct && surplus28Ok ? runs[RUN.surplus]! + 1 : 0;
  if (runs[RUN.surplus]! > k.surplusDays) setHit(s, X['W-S02'], d, surplusPct);
  const waistLimit = female ? k.waistCautionFemaleCm : k.waistCautionMaleCm;
  if ((k.waistCm0 > waistLimit || k.whtr0 >= k.whtrCaution) && def7 < -k.deficitAnyPct && surplus28Ok)
    hitWindow(s, X['W-S03'], d, 7, k.waistCm0, OWN_SURPLUS, k.deficitAnyPct);

  // ------------------------------------------------------------------ population and medication context
  const anyDef = def7 > k.deficitAnyPct;
  const lowCarb = carb < k.carbLowG;
  const fastT1 = q.fastHMax > k.tierT0MaxH;
  const fastGtT1 = q.fastHMax > k.tierT1MaxH;
  if (k.pregnant && (anyDef || fastT1 || lowCarb)) setHit(s, X['W-P01'], d, def7);
  if (k.edRisk && (anyDef || q.fastHMax > k.restrictedFastH || lowCarb)) setHit(s, X['W-P02'], d, def7);
  if (q.age >= k.ageOlderYears && (def7 > k.olderDeficitPct || fastGtT1)) setHit(s, X['W-P03'], d, def7);
  if (k.diabetesDrug && (anyDef || fastT1 || lowCarb)) setHit(s, X['W-P04'], d, def7);
  if (k.organFlag && (fastGtT1 || def7 > k.organDeficitPct || lowCarb)) setHit(s, X['W-P05'], d, def7);
  if (k.stoneGoutFlag && (fastGtT1 || keto || q.rate14Pct > k.rateStoneFlagPct))
    setHit(s, X['W-P06'], d, def7);
  if (k.medFlag && (fastGtT1 || keto)) setHit(s, X['W-P07'], d, def7);

  // ------------------------------------------------------------------ model uncertainty and outputs
  // always-on notes are header notes (day 0 only) and quiet unless informative (integration 2026-09-30): W-U03 only with
  // slider body-fat input; W-U02 on the entered age/BMI (input ranges), or intake < 500 kcal for > 7 d
  if (d === 0) setHit(s, X['W-U01'], d, 0);
  runs[RUN.eiLow] = q.ei < k.uncertainEiKcal ? runs[RUN.eiLow]! + 1 : 0;
  if (k.bmiTm0 > k.uncertainBmi || k.ageEnteredYears > k.uncertainAgeYears || runs[RUN.eiLow]! > k.uncertainEiDays)
    setHit(s, X['W-U02'], d, k.bmiTm0 > k.uncertainBmi ? k.bmiTm0 : q.bmi);
  if (d === 0 && k.bfFromSliders) setHit(s, X['W-U03'], d, 0);
  if (d === 0 && k.markerShown) setHit(s, X['W-U04'], d, 0);
  if (d === 0 && k.asiShown) setHit(s, X['W-U05'], d, 0);

  // ------------------------------------------------------------------ engine-specific rules (spec §7.2 last rows)
  const alpertCap = k.alpertFraction * k.alpertKcalPerKgFm * q.fm;
  s.alpertCapD[d] = alpertCap;
  const defKcal = q.tdee7 - ei7;
  if (defKcal > alpertCap) hitWindow(s, X['W-13-ALPERT'], d, 7, defKcal, OWN_DEFICIT, 0);
  if (s.dayKetoFedBhb > 0) setHit(s, X['W-05-KETO-FED'], d, s.dayKetoFedBhb);
  if (longFast && q.bf < bfFloor + k.leanFastMarginPts) setHit(s, X['W-20-FAST-LEAN'], d, q.bf);
  if (s.dayFatFloorFmKg < 1e8) setHit(s, X['W-01-FATFLOOR'], d, s.dayFatFloorFmKg);
}
