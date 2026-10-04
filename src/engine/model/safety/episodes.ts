/**
 * safety — fast episodes (dossier 17 §4.3, spec §7.2 W-F01…W-F13).
 *
 * A fast *episode* is a zero-intake run (`hoursSinceIntakeH`, the 17 §2.1 `fast_h` counter, hours since the last intake
 * above 50 kcal) that goes beyond T0 (> 20 h). While it runs the day-level tier follows its progress; when it ends
 * (intake resumes, the counter drops) every day with counter > T0 is raised to the episode's final tier, so a 96-h
 * fast is reported once as one T4 warning instead of a T2 → T3 → T4 staircase. The finished fast is appended to a
 * log used by the HC-F2 spacing check (W-F07) and the W-F13 frequency check.
 *
 * Everything here is allocation-free.
 */
import type { SafetyK, SafetyState } from './state';
import { setHit } from './state';
import { RULE_INDEX as X } from './rules';
import { fastTier, spacingViolation } from './derived';

/** Raise `fastTierDay` to `tier` over days [d0, d1] (never lowers a day that already carries a higher tier). */
export function raiseTier(s: SafetyState, tier: number, d0: number, d1: number): void {
  const lo = d0 < 0 ? 0 : d0;
  const hi = d1 >= s.nDays ? s.nDays - 1 : d1;
  for (let d = lo; d <= hi; d++) if (s.fastTierDay[d]! < tier) s.fastTierDay[d] = tier;
}

/**
 * Meal-to-meal duration (h) of the planned span(s) inside the zero-intake episode that ends at absolute hour `resumeHour`
 * after `cntH` counted hours (the span's masked hours lie within the episode; intake may resume later than the span's end
 * when the first meals after it were dropped), or 0 when the episode holds no planned span (blocker round 2026-10-01).
 * Linear scan of the (few) planned spans; called once per episode.
 */
export function plannedMealToMealH(k: SafetyK, resumeHour: number, cntH: number): number {
  const ends = k.spanEndHour;
  const m2m = k.spanM2mH;
  const first = resumeHour - cntH;
  let best = 0;
  for (let i = 0; i < ends.length; i++) {
    const e = ends[i]!;
    if (e <= resumeHour && e > first && m2m[i]! > best) best = m2m[i]!;
  }
  return best;
}

/**
 * Close the active episode. `lenH` = its final counter, `resumeHour` = absolute hour index at which intake resumed
 * (or the end of the horizon for an episode still running), `byIntake` = whether intake actually resumed, `m2mH` = the
 * meal-to-meal duration of the planned span it belongs to (0 = unplanned). The episode's length for its tier, the fast log
 * (spacing, frequency) and W-F08 is the meal-to-meal duration when planned — the counter is whole zero-intake hours, one
 * less than the meal-to-meal time for whole-hour meals ("72 h" fast → counter 71) — and the counter otherwise.
 */
export function closeEpisode(
  s: SafetyState,
  k: SafetyK,
  cntH: number,
  resumeHour: number,
  byIntake: boolean,
  m2mH = 0,
): void {
  const lenH = m2mH > cntH ? m2mH : cntH;
  const tier = fastTier(k, lenH);
  raiseTier(s, tier, s.epStartDay, s.epLastDay);
  const lastMealHour = resumeHour - 1 - cntH;
  const viol = spacingViolation(k, s.epLog, s.nEp, lastMealHour, resumeHour, lenH);
  if (viol > 0 && s.warn) {
    const lo = s.epStartDay < 0 ? 0 : s.epStartDay;
    const hi = s.epLastDay >= s.nDays ? s.nDays - 1 : s.epLastDay;
    for (let d = lo; d <= hi; d++) setHit(s, X['W-F07'], d, lenH);
  }
  const cap = s.epLog.length / 3;
  if (s.nEp < cap) {
    s.epLog[3 * s.nEp] = lastMealHour;
    s.epLog[3 * s.nEp + 1] = resumeHour;
    s.epLog[3 * s.nEp + 2] = lenH;
    if (s.nEp < s.epNoElec.length) s.epNoElec[s.nEp] = s.epNoElecCur;
    s.nEp++;
  }
  s.epNoElecCur = 0;
  if (byIntake) {
    if (lenH > s.dayEpEndLenH) s.dayEpEndLenH = lenH;
    if (lenH > k.tierT2MaxH) s.hoursSinceLongEnd = 0;
    s.hoursSinceFastEnd = 0;
  }
  s.epActive = 0;
  s.epMaxH = 0;
}

/**
 * Number of finished fasts longer than `minLenH` that started (last meal) within `windowH` hours before `nowHour`, plus
 * the running one when its counter is above `minLenH`.
 */
export function countRecentFasts(
  s: SafetyState,
  nowHour: number,
  windowH: number,
  minLenH: number,
  runningH: number,
): number {
  let n = runningH > minLenH ? 1 : 0;
  const lo = nowHour - windowH;
  // fasts that STARTED (last meal) inside the window (final round 2026-09-30: counting by resume hour put three weekly
  // 36-h fasts "in 14 days" — the first one started before the window)
  for (let i = s.nEp - 1; i >= 0; i--) {
    if (s.epLog[3 * i]! < lo) break;
    if (s.epLog[3 * i + 2]! > minLenH) n++;
  }
  return n;
}
