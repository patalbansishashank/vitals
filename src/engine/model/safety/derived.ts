/**
 * safety — pure derived-quantity helpers (docs/MODEL_SPEC.md §1.16; dossier 17 §2.1, §2.3, §4.3.2).
 *
 * Everything here is a pure function of numbers (no allocation, no state) so that the engine module, the planner's
 * constraint margins (`constraints.ts`) and the golden tests share exactly one implementation of the caps, the
 * reference weight, the fasting tiers, the trailing-window regression and the fast-spacing rule.
 */
import type { SafetyConstants } from './params';

/** Tolerance for "exactly at the bound is fine" comparisons on quantities computed in double precision. */
export const EPS = 1e-9;

/** Fasting tiers (17 §4.3.2): 0 = T0 (<= 20 h) … 5 = T5 (> 168 h). */
export type FastTier = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * String ids of the tiers, identical to `FastingTier` in `src/features/onboarding/safetyRules.ts` (the UI-side screening
 * module: T0 <= 20 h, T1 <= 24, T2 <= 48, T3 <= 72, T4 <= 168, T5 beyond). A test cross-checks the boundaries.
 */
export const FAST_TIER_IDS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const;
export type FastTierId = (typeof FAST_TIER_IDS)[number];
export const fastTierId = (t: FastTier): FastTierId => FAST_TIER_IDS[t]!;

/** Tier of a zero-intake run of `hours` (> 20 T1, > 24 T2, > 48 T3, > 72 T4, > 168 T5; upper edges inclusive). */
export function fastTier(k: SafetyConstants, hours: number): FastTier {
  if (!(hours > k.tierT0MaxH)) return 0;
  if (hours <= k.tierT1MaxH) return 1;
  if (hours <= k.tierT2MaxH) return 2;
  if (hours <= k.tierT3MaxH) return 3;
  if (hours <= k.tierT4MaxH) return 4;
  return 5;
}

/** The profile facts W-05-KETO-FED reads (a structural subset of `SafetyFlags`). */
export interface KetoFedFlags {
  readonly type1Diabetes?: boolean;
  readonly diabetesMedication?: string;
  readonly pregnantOrBreastfeeding?: boolean;
}

/**
 * Whether W-05-KETO-FED ("ketones while eating", a ketoacidosis warning sign) applies to this person (ruling
 * R-FAST-GATE, 2026-10-01): the rule's own text names people with diabetes or on diabetes drugs (05 §9: the DKA
 * criterion needs a diabetes history — any treatment, "known diabetes"), and 05 §9 adds lactation ketoacidosis without
 * diabetes. For everyone else the rule does not fire. `needsDiabetes` = `safety.ketoFedNeedsDiabetes` (0 applies it to
 * everyone). Shared by the engine rule and the planner's guard so the two cannot disagree.
 */
export function ketoFedStrict(flags: KetoFedFlags, needsDiabetes: number): boolean {
  if (needsDiabetes === 0) return true;
  const med = flags.diabetesMedication;
  return flags.type1Diabetes === true || (med !== undefined && med !== 'none') || flags.pregnantOrBreastfeeding === true;
}

/** Reference weight for protein floors, 17 §2.1: RW = min(BW, 27.5·H²), kg. */
export function referenceWeightKg(k: SafetyConstants, bodyWeightKg: number, heightM: number): number {
  const cap = k.rwHeightFactor * heightM * heightM;
  return bodyWeightKg < cap ? bodyWeightKg : cap;
}

/**
 * Deficit cap cap_def(BMI, age, BF%) in percent of TDEE_7 (17 §2.3, PROPOSED FIT):
 * 25; BMI >= 30 → 30; BMI < 25 → 20; age >= 65 → min(cap, 15); BF% <= floor + 4 → min(cap, 10).
 */
export function deficitCapPct(
  k: SafetyConstants,
  bmi: number,
  ageYears: number,
  bodyFatPct: number,
  bfFloorPct: number,
): number {
  let cap = k.capDefaultPct;
  if (bmi >= k.capBmiHigh) cap = k.capBmiHighPct;
  if (bmi < k.capBmiLow) cap = k.capBmiLowPct;
  if (ageYears >= k.ageOlderYears && cap > k.capAge65Pct) cap = k.capAge65Pct;
  if (bodyFatPct <= bfFloorPct + k.capLeanMarginPts && cap > k.capLeanPct) cap = k.capLeanPct;
  return cap;
}

/**
 * Rate cap cap_pct(BMI, BF%) in %BW/week (17 §2.3, PROPOSED FIT), evaluated in the dossier's order: default 0.75;
 * BF% <= floor + 6 → 0.5; then BMI >= 30 or BF% >= 30 (M) / 40 (F) → 1.0 (this later branch overrides the lean branch
 * exactly as the pseudo-code is written); age >= 65 → min(cap, 0.5). The absolute 1.5 kg/wk cap is separate.
 */
export function rateCapPct(
  k: SafetyConstants,
  bmi: number,
  ageYears: number,
  bodyFatPct: number,
  bfFloorPct: number,
  isFemale: boolean,
): number {
  let cap = k.rateCapDefaultPct;
  if (bodyFatPct <= bfFloorPct + k.rateLeanMarginPts) cap = k.rateCapLeanPct;
  if (bmi >= k.capBmiHigh || bodyFatPct >= (isFemale ? k.highBfFemale : k.highBfMale)) cap = k.rateCapHighPct;
  if (ageYears >= k.ageOlderYears && cap > k.rateCapAge65Pct) cap = k.rateCapAge65Pct;
  return cap;
}

/** The loss-rate bound of HC-E5 in %BW/wk: min(cap_pct, 1.5 kg/wk expressed in % of the current tissue mass). */
export function rateBoundPct(k: SafetyConstants, capPct: number, tissueMassKg: number): number {
  const abs = tissueMassKg > 0 ? (100 * k.rateCapAbsKgWk) / tissueMassKg : capPct;
  return capPct < abs ? capPct : abs;
}

/** Energy floor (7-d mean) by sex, HC-E1. */
export function energyFloorKcal(k: SafetyConstants, isFemale: boolean): number {
  return isFemale ? k.floorFemaleKcal : k.floorMaleKcal;
}

/** BF% floor by sex, HC-P5. */
export function bfFloorPct(k: SafetyConstants, isFemale: boolean): number {
  return isFemale ? k.bfFloorFemale : k.bfFloorMale;
}

/**
 * Ordinary-least-squares slope (per sample) of the last `n` values of a circular buffer of length `len`, oldest to
 * newest. `head` is the index the NEXT sample will be written to. Returns 0 for n < 3 (too few points for a slope).
 * No allocation; O(n).
 */
export function olsSlope(ring: Float64Array, head: number, len: number, n: number): number {
  if (n < 3) return 0;
  const m = n > len ? len : n;
  let sy = 0;
  for (let j = 0; j < m; j++) sy += ring[(head - m + j + 2 * len) % len]!;
  const ybar = sy / m;
  const xbar = (m - 1) / 2;
  let sxy = 0;
  let sxx = 0;
  for (let j = 0; j < m; j++) {
    const dx = j - xbar;
    sxy += dx * (ring[(head - m + j + 2 * len) % len]! - ybar);
    sxx += dx * dx;
  }
  return sxx > 0 ? sxy / sxx : 0;
}

/** Mean of the last `n` samples of a circular buffer (n clipped to the buffer length); NaN when n < 1. */
export function ringMean(ring: Float64Array, head: number, len: number, n: number): number {
  const m = n > len ? len : n;
  if (m < 1) return Number.NaN;
  let s = 0;
  for (let j = 1; j <= m; j++) s += ring[(head - j + 2 * len) % len]!;
  return s / m;
}

/** Sum of `w` samples that end `skip` samples before the newest one (skip 0 = the newest `w`). */
export function ringSum(ring: Float64Array, head: number, len: number, w: number, skip: number): number {
  let s = 0;
  for (let j = 1 + skip; j <= w + skip && j <= len; j++) s += ring[(head - j + 2 * len) % len]!;
  return s;
}

/** Energy intake that puts EA exactly at the hard floor: EA = (EI − EEE)/FFM ≥ 30 ⇒ EI ≥ 30·FFM + EEE (GT-12: 2 850). */
export function minIntakeForEa(k: SafetyConstants, ffmKg: number, eeeKcal: number): number {
  return k.eaHardMin * ffmKg + eeeKcal;
}

/** Body weight at which BF% equals the floor if fat-free mass is preserved (GT-13: 45.6/0.82 = 55.6 kg). */
export function weightAtBfFloorKg(ffmKg: number, floorPct: number): number {
  return ffmKg / (1 - floorPct / 100);
}

/** Weeks to go from `fromKg` to `toKg` at a %BW/wk loss rate that compounds on the current weight (HC-G1 "earliest date"). */
export function weeksToReach(fromKg: number, toKg: number, ratePctPerWk: number): number {
  if (!(fromKg > toKg) || !(ratePctPerWk > 0)) return 0;
  return Math.log(toKg / fromKg) / Math.log(1 - ratePctPerWk / 100);
}

/**
 * HC-F2 spacing check for a fast that has just ended, against a chronological log of earlier fasts longer than T0.
 * The log stores, per fast, [last-meal hour, resume hour, length h] (absolute hour indices) in `log[3·i …]`.
 * Returns 0 when the pattern is within the envelope, otherwise a code: 1 = eating gap too short, 2 = too many T1+ fasts
 * in 7 d, 3 = too many T2 (> 36 h) fasts in 7 d, 4 = too many T3+ in 30 d, 5 = too many T4+ in 12 wk or 1 y.
 * The new fast is (`lastMealH`, `resumeH`, `lenH`) and is NOT yet in the log (`n` entries).
 */
export function spacingViolation(
  k: SafetyConstants,
  log: Float64Array,
  n: number,
  lastMealH: number,
  resumeH: number,
  lenH: number,
): number {
  const tNew = fastTier(k, lenH);
  // 1. minimum normal eating between this fast and the previous one (24 h; 7 d if either is T3; 28 d if either is T4+)
  if (n > 0) {
    const prevResume = log[3 * (n - 1) + 1]!;
    const prevLen = log[3 * (n - 1) + 2]!;
    const tMax = Math.max(tNew, fastTier(k, prevLen));
    const gapH = lastMealH - prevResume;
    const need = tMax >= 4 ? k.gapT4MinH : tMax === 3 ? k.gapT3MinH : k.gapT12MinH;
    if (gapH < need) return 1;
  }
  // 2-5. counts inside look-back windows (the new fast counts as one)
  let nWeek = 1;
  let nWeekLong = lenH > k.t2SplitH ? 1 : 0;
  let nT3In30 = lenH > k.tierT2MaxH ? 1 : 0;
  let nT4In12wk = lenH > k.tierT3MaxH ? 1 : 0;
  let nT4InYear = nT4In12wk;
  const weekLo = resumeH - 7 * 24;
  const monthLo = resumeH - 30 * 24;
  const wk12Lo = resumeH - 84 * 24;
  const yearLo = resumeH - 365 * 24;
  for (let i = n - 1; i >= 0; i--) {
    const rs = log[3 * i + 1]!;
    if (rs < yearLo) break;
    const ln = log[3 * i + 2]!;
    if (rs >= weekLo) {
      nWeek++;
      if (ln > k.t2SplitH) nWeekLong++;
    }
    if (rs >= monthLo && ln > k.tierT2MaxH) nT3In30++;
    if (ln > k.tierT3MaxH) {
      if (rs >= wk12Lo) nT4In12wk++;
      nT4InYear++;
    }
  }
  if (tNew <= 2) {
    if (nWeek > k.t1MaxPerWeek) return 2;
    if (lenH > k.t2SplitH && nWeekLong > k.t2MaxPerWeekGt36) return 3;
  }
  if (tNew >= 3 && nT3In30 > k.t3MaxPer30d) return 4;
  if (tNew >= 4 && (nT4In12wk > k.t4MaxPer12wk || nT4InYear > k.t4MaxPerYear)) return 5;
  return 0;
}
