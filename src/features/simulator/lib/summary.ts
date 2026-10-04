/**
 * Summary strip (task §5): per-week averages computed from the compiled schedule in the UI thread —
 * energy vs maintenance, macros, fasting hours and training sessions.
 */
import type { EnergyUnitChoice } from '@/components';
import type { CompiledSchedule, ResolvedProfile } from '@/engine';
import { dayMaintenance, formatKcal } from './energy';
import { mealHours } from './fasts';

export interface PeriodSummary {
  days: number;
  /** Mean intake, kcal/d, and as % of the mean maintenance reference at this plan's activity (R-MAINT). */
  energyKcal: number;
  energyPct: number;
  /** Mean maintenance reference, kcal/d ("100 % = 2 840 kcal at this plan's activity"). */
  maintKcal: number;
  /** Mean true planned balance, kcal/d (< 0 deficit). */
  balanceKcal: number;
  /** Mean planned-minus-habitual activity energy as booked, and the maintenance adjustment it causes, kcal/d. */
  activityDeltaKcal: number;
  activityAdjKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
  proteinGPerKg: number;
  /** Hours inside fasts of ≥ 12 h (overnight fasts included), clipped to the period. */
  fastingHours: number;
  /** Longest fast overlapping the period, h. */
  longestFastH: number;
  /** Mean eating window of eating days, h. */
  windowH: number;
  resistanceSessions: number;
  cardioSessions: number;
  /** Hard sets over the period (all regions). */
  hardSets: number;
  cardioMin: number;
  avgSteps: number;
  waterOnlyDays: number;
}

/** Inter-meal gaps of ≥ 12 h, in absolute hours (the model of "fasting" this strip reports). */
export function fastingGaps(
  c: CompiledSchedule,
  minH = 12,
  prevLastMealH = -4,
): Array<{ a: number; b: number }> {
  const meals = mealHours(c);
  const gaps: Array<{ a: number; b: number }> = [];
  const end = c.nDays * 24;
  // Before day 0 the habitual day applies (burn-in): its last meal defaults to 20:00 the evening before.
  let prev = prevLastMealH;
  if (meals.length === 0) return [{ a: prev, b: end }];
  for (const m of meals) {
    if (m - prev >= minH) gaps.push({ a: prev, b: m });
    prev = m;
  }
  if (end - prev >= minH) gaps.push({ a: prev, b: end });
  return gaps;
}

export function summarise(
  c: CompiledSchedule,
  profile: ResolvedProfile,
  days: readonly number[],
  gaps = fastingGaps(c),
): PeriodSummary {
  const n = days.length;
  const z: PeriodSummary = {
    days: n,
    energyKcal: 0,
    energyPct: 0,
    maintKcal: 0,
    balanceKcal: 0,
    activityDeltaKcal: 0,
    activityAdjKcal: 0,
    proteinG: 0,
    carbG: 0,
    fatG: 0,
    fibreG: 0,
    proteinGPerKg: 0,
    fastingHours: 0,
    longestFastH: 0,
    windowH: 0,
    resistanceSessions: 0,
    cardioSessions: 0,
    hardSets: 0,
    cardioMin: 0,
    avgSteps: 0,
    waterOnlyDays: 0,
  };
  if (n === 0) return z;
  let eatingDays = 0;
  let window = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of days) {
    const day = c.days[d]!;
    lo = Math.min(lo, d * 24);
    hi = Math.max(hi, d * 24 + 24);
    z.energyKcal += day.energyKcal;
    const ref = dayMaintenance(day, profile.tdee0Kcal);
    z.maintKcal += ref;
    z.balanceKcal += Number.isFinite(day.plannedBalanceKcal) ? day.plannedBalanceKcal! : day.energyKcal - ref;
    z.activityDeltaKcal += Number.isFinite(day.activityDeltaKcal) ? day.activityDeltaKcal! : 0;
    z.activityAdjKcal += Number.isFinite(day.activityAdjKcal) ? day.activityAdjKcal! : 0;
    z.proteinG += day.proteinG;
    z.carbG += day.carbG;
    z.fatG += day.fatG;
    z.fibreG += day.fibreG;
    z.avgSteps += day.steps;
    if (day.zeroIntake) z.waterOnlyDays++;
    else if (day.nMeals > 0) {
      eatingDays++;
      window += day.windowLengthH;
    }
    for (let i = 0; i < day.nSessions; i++) {
      const s = day.sessions[i]!;
      if (s.kind === 'resistance') {
        z.resistanceSessions++;
        for (let k = 0; k < s.setsByRegion.length; k++) z.hardSets += s.setsByRegion[k]!;
      } else {
        z.cardioSessions++;
        z.cardioMin += s.durationMin;
      }
    }
  }
  z.energyKcal /= n;
  z.maintKcal /= n;
  z.balanceKcal /= n;
  z.activityDeltaKcal /= n;
  z.activityAdjKcal /= n;
  z.proteinG /= n;
  z.carbG /= n;
  z.fatG /= n;
  z.fibreG /= n;
  z.avgSteps /= n;
  z.windowH = eatingDays > 0 ? window / eatingDays : 0;
  z.energyPct = z.maintKcal > 0 ? (100 * z.energyKcal) / z.maintKcal : 0;
  z.proteinGPerKg = profile.weightKg > 0 ? z.proteinG / profile.weightKg : 0;
  // fasting inside the period (days are contiguous for weeks; for arbitrary sets clip per day)
  const inPeriod = new Set(days);
  for (const g of gaps) {
    if (g.b <= lo || g.a >= hi) continue;
    let h = 0;
    for (let d = Math.floor(Math.max(g.a, lo) / 24); d * 24 < Math.min(g.b, hi); d++) {
      if (!inPeriod.has(d)) continue;
      h += Math.max(0, Math.min(g.b, d * 24 + 24) - Math.max(g.a, d * 24));
    }
    if (h > 0) {
      z.fastingHours += h;
      z.longestFastH = Math.max(z.longestFastH, g.b - g.a);
    }
  }
  return z;
}

/**
 * Said once, plainly, when the plan's training differs from the usual week (ruling R-MAINT): maintenance — and so
 * "100 %" — already includes the extra (or missing) activity. Uses the whole horizon so it does not flicker per week.
 */
export function activitySentence(deltaKcal: number, unit: EnergyUnitChoice = 'kcal'): string | null {
  if (!Number.isFinite(deltaKcal) || Math.abs(deltaKcal) < 40) return null;
  const k = formatKcal(Math.abs(deltaKcal), unit);
  return deltaKcal > 0
    ? `This plan adds ≈ ${k} ${unit} a day of training over your usual week; maintenance is adjusted for it.`
    : `This plan has ≈ ${k} ${unit} a day less activity than your usual week; maintenance is adjusted for it.`;
}
