/**
 * Fast-event arithmetic shared by the decoder, repair and descriptors (not by the independent validator).
 * Semantics (ruling 2026-09-30 18:10): `FastEvent.startH` is the clock hour of the last intake and `durationH` is meal
 * to meal (last intake → first intake); meals strictly inside the window are not eaten. Refeed ramps follow the engine
 * compiler (`refeedRamp`, 17 HC-F3) unless the event carries its own `refeedFactors`.
 */
import { refeedRamp } from '../../core/compileSchedule';
import type { FastEvent, Schedule } from '../../types/schedule';
import { HC, tierForHours } from './safety';
import { mealClocks, mergeDay } from './dayMath';
import type { FastingKind } from './types';

/** Multi-day water-fast variants the grammar may use (13 B14/B15/B16; ruling 18:10: 3-7 d fasts in the expert tier). */
export const WATER_FAST_VARIANTS = [48, 72, 120, 168] as const;
export type WaterFastH = (typeof WATER_FAST_VARIANTS)[number];

/**
 * Minimum start-to-start spacing of multi-day fasts, days: 48 h ≤ 1 per 2 weeks (13 B14, PROPOSED); 72 h ≤ 1 per month
 * (13 B15; 17 HC-F2 T3 ≥ 7 d apart and ≤ 2 per 30 d); > 72 h ≤ 1 per 12 weeks (17 HC-F2 T4: ≥ 28 d apart, ≤ 1 per 12 wk).
 */
export function eventPeriodDays(durationH: number): number {
  return durationH > 72 + 1e-6 ? 84 : durationH > 48 + 1e-6 ? 30 : 14;
}

/** Absolute hours of the last intake (t0) and first intake (t1). */
export function fastWindow(e: Pick<FastEvent, 'startDay' | 'startH' | 'durationH'>): { t0: number; t1: number } {
  const t0 = e.startDay * 24 + e.startH;
  return { t0, t1: t0 + e.durationH };
}

/** Day on which the fast ends (the day holding the first intake). */
export function fastEndDay(e: Pick<FastEvent, 'startDay' | 'startH' | 'durationH'>): number {
  return Math.floor((fastWindow(e).t1 + 1e-9) / 24);
}

/** Refeed energy factors of the days from the end day on (engine compiler semantics). */
export function refeedFactorsOf(e: FastEvent): readonly number[] {
  if (e.refeedFactors && e.refeedFactors.length) return e.refeedFactors;
  return e.refeed === 'auto' ? refeedRamp(e.durationH) : [];
}

/** Locked recovery days after a multi-day fast: the refeed ramp days, at least the end day and the next (13 rule 4). */
export function recoveryDayCount(durationH: number): number {
  if (durationH <= 24 + 1e-6) return 0;
  return Math.max(2, refeedRamp(durationH).length);
}

/** Planned-energy factor per day from fast events' refeed ramps (1 = none). */
export function refeedDayFactors(s: Schedule): Float64Array {
  const f = new Float64Array(s.horizonDays).fill(1);
  for (const e of s.events ?? []) {
    const r = refeedFactorsOf(e);
    const end = fastEndDay(e);
    r.forEach((x, i) => {
      const d = end + i;
      if (d >= 0 && d < f.length) f[d] = Math.min(f[d]!, Math.min(1, Math.max(0, x)));
    });
  }
  return f;
}

/** Hours of each day inside fast windows (no intake), and whether a day is a fast day (touched by a ≥ 24 h fast). */
export function fastCoverage(s: Schedule): { covered: Float64Array; fastDay: Uint8Array } {
  const covered = new Float64Array(s.horizonDays);
  const fastDay = new Uint8Array(s.horizonDays);
  for (const e of s.events ?? []) {
    const { t0, t1 } = fastWindow(e);
    for (let d = Math.max(0, Math.floor(t0 / 24)); d <= Math.min(s.horizonDays - 1, Math.floor((t1 - 1e-9) / 24)); d++) {
      covered[d] = covered[d]! + Math.max(0, Math.min(t1, d * 24 + 24) - Math.max(t0, d * 24));
      if (e.durationH >= 24 - 1e-6) fastDay[d] = 1;
    }
  }
  return { covered, fastDay };
}

/**
 * Minimum normal eating between consecutive fasts, h (17 HC-F2, the engine's `spacingViolation`): 24 h for T1/T2, 7 d
 * if either fast is T3, 28 d if either is T4 — so an expert-tier fast is alone in its 28-day window (ruling R-T4CAP).
 */
export function eatingGapNeedH(hoursA: number, hoursB: number): number {
  const t = Math.max(Number(tierForHours(hoursA).slice(1)), Number(tierForHours(hoursB).slice(1)));
  return t >= 4 ? HC.gapH.T4 : t === 3 ? HC.gapH.T3 : HC.gapH.T12;
}

/** Longest eating window (first to last meal, h) that still counts as time-restricted eating, not as a fast. */
export const TRE_WINDOW_MAX_H = 8;

/**
 * How a schedule uses fasting (ruling R-FAST-GATE; PLANNER_V2_SPEC §3.5), precedence multiDay > zeroDays > fast24 >
 * eatingWindow > none: an event longer than 24 h (meal to meal); zero-intake days; events of 20-24 h; no zero-intake span
 * but some day's eating window ≤ 8 h (time-restricted eating, never reported as a fast); otherwise none.
 */
export function fastingKind(s: Schedule): FastingKind {
  const evs = s.events ?? [];
  if (evs.some((e) => e.durationH > HC.tierMaxH.T1 + 1e-6)) return 'multiDay';
  if (s.programs.some((p, i) => p.energy.kind === 'zero' && s.days.some((d) => d.program === i))) return 'zeroDays';
  if (evs.some((e) => e.durationH > HC.tierMaxH.T0 + 1e-6)) return 'fast24';
  for (const d of s.days) {
    const t = mergeDay(s.programs[d.program]!, d.override);
    if (t.energy.kind === 'zero') continue;
    const mc = mealClocks(t);
    if (mc.length && Math.max(...mc) - Math.min(...mc) <= TRE_WINDOW_MAX_H + 1e-9) return 'eatingWindow';
  }
  return 'none';
}

/** True for the kinds that are fasts (a 24-h or longer zero-intake span or zero days), not time-restricted eating. */
export const usesFast = (k: FastingKind): boolean => k === 'fast24' || k === 'zeroDays' || k === 'multiDay';

/**
 * Longest planned zero-intake span of a schedule, h, meal to meal: the longest fast event, or a run of zero-energy days
 * from the last meal before it to the first meal after it (0 when the schedule has neither).
 */
export function longestFastH(s: Schedule): number {
  let h = 0;
  for (const e of s.events ?? []) h = Math.max(h, e.durationH);
  const T = s.days.length;
  const tmpl = (d: number) => mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override);
  for (let d = 0; d < T; d++) {
    if (tmpl(d).energy.kind !== 'zero' || (d > 0 && tmpl(d - 1).energy.kind === 'zero')) continue;
    let e = d;
    while (e + 1 < T && tmpl(e + 1).energy.kind === 'zero') e++;
    const before = d > 0 ? mealClocks(tmpl(d - 1)) : [];
    const after = e + 1 < T ? mealClocks(tmpl(e + 1)) : [];
    const last = before.length ? Math.max(...before) : 20;
    const first = after.length ? Math.min(...after) : 8;
    h = Math.max(h, 24 - last + 24 * (e - d + 1) + first);
  }
  return h;
}
