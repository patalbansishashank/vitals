/**
 * Ideal-only genes (PLANNER_V2_SPEC §2.2): sleep duration and midpoint, the training clock and the cardio modality.
 * They exist only where the request has the matching practical limit removed — every one in the Ideal
 * (`idealRequest`: `ideal: true`), one group's in a shadow-price run (`relaxGroup`: `relaxedGroups: [group]`) — so the
 * ordinary plans keep their layouts. Pure helpers shared by the context, the grammar, the decoder and repair.
 */
import type { CardioModality } from '../../types/schedule';
import type { SafetyCaps } from './safety';
import type { PlannerRequest } from './types';

/**
 * Sleep rules of the Ideal (16 §4.1.1-4.1.11, PLANNER_V2_SPEC §2.2): duration 7-8.5 h (default 8, the extension toward
 * 7.5-8.5 h); the midpoint within ±1 h of the habitual midpoint, moved by at most 2 h toward 02:30-04:30 when the habit
 * lies outside that band (advice: the engine credits duration, not timing); both on a 15-minute grid.
 */
export const IDEAL_SLEEP = { minH: 7, maxH: 8.5, defH: 8, bandLoH: 2.5, bandHiH: 4.5, halfWidthH: 1, maxShiftH: 2, grid: 0.25 } as const;
/** Sessions end at least this long before bed (16 §4.2.6; the decoder's placement keeps 1.5 h). */
export const SESSION_BEFORE_BED_H = 1;
/** Longest session the Ideal allows, min (§2.1 `maxSessionMin`). */
export const IDEAL_SESSION_MAX_MIN = 90;
/** Cardio modalities the Ideal's modality gene ranges over (before the safety filter). */
export const IDEAL_MODALITIES: readonly CardioModality[] = ['walk', 'cycle', 'run', 'swim', 'row', 'hiit'];

export interface IdealGeneFlags {
  /** `sleep.durationH` + `sleep.midpointH` (sleep group relaxed). */
  sleep: boolean;
  /** `train.clockH` (session-time group relaxed). */
  clock: boolean;
  /** `cardio.modality` (cardio group relaxed). */
  modality: boolean;
}

export function idealGeneFlags(req: Pick<PlannerRequest, 'ideal' | 'relaxedGroups'>): IdealGeneFlags {
  const all = req.ideal === true;
  const g = req.relaxedGroups ?? [];
  return { sleep: all || g.includes('sleep'), clock: all || g.includes('sessionTime'), modality: all || g.includes('cardio') };
}

export const mod24 = (h: number): number => ((h % 24) + 24) % 24;

/** Signed shortest clock difference `to − from`, h, in (−12, 12]. */
export function clockDiff(from: number, to: number): number {
  const d = mod24(to - from);
  return d > 12 ? d - 24 : d;
}

/** Clock hour of bed counted past midnight for evening arithmetic (01:00 → 25). */
export const bedClockOf = (bedH: number): number => (bedH < 12 ? bedH + 24 : bedH);

/** Sleep duration of a bed/wake pair, h. */
export const sleepHoursOf = (bedH: number, wakeH: number): number => mod24(wakeH - bedH) || 24;

export function habitualMidpointH(bedH: number, wakeH: number): number {
  return mod24(bedH + sleepHoursOf(bedH, wakeH) / 2);
}

export interface MidpointRange {
  /** Gene range, clock h (may run below 0 or past 24; decoded modulo 24). */
  lo: number;
  hi: number;
  /** Centre of the range (the habitual midpoint, moved toward the band when it lies outside). */
  centre: number;
  habitual: number;
}

/** Range of the `sleep.midpointH` gene from the habitual bed and wake times (§2.2 sleep-timing row). */
export function sleepMidpointRange(bedH: number, wakeH: number): MidpointRange {
  const S = IDEAL_SLEEP;
  const m = habitualMidpointH(bedH, wakeH);
  const off = clockDiff(S.bandLoH, m);
  let c = m;
  if (!(off >= 0 && off <= S.bandHiH - S.bandLoH)) {
    const dLo = clockDiff(m, S.bandLoH);
    const dHi = clockDiff(m, S.bandHiH);
    const d = Math.abs(dLo) <= Math.abs(dHi) ? dLo : dHi;
    c = m + Math.sign(d) * Math.min(S.maxShiftH, Math.abs(d));
  }
  return { lo: c - S.halfWidthH, hi: c + S.halfWidthH, centre: c, habitual: m };
}

/** Bed and wake clock (0-24) of a midpoint and a duration. */
export function sleepFromMidpoint(midH: number, durationH: number): { bedH: number; wakeH: number } {
  return { bedH: mod24(midH - durationH / 2), wakeH: mod24(midH + durationH / 2) };
}

/**
 * Widest waking day the sleep genes allow: the earliest wake (shortest sleep at the earliest midpoint) and the latest
 * bed (shortest sleep at the latest midpoint, counted past midnight). The Ideal's eating window and the late-eating
 * rule are set against it; the decoder narrows both to the decoded night.
 */
export function idealSleepEnvelope(bedH: number, wakeH: number): { earliestWakeH: number; latestBedClock: number } {
  const r = sleepMidpointRange(bedH, wakeH);
  return { earliestWakeH: mod24(r.lo + IDEAL_SLEEP.minH / 2), latestBedClock: bedClockOf(mod24(r.hi - IDEAL_SLEEP.minH / 2)) };
}

/**
 * Cardio modalities the safety caps allow (HC-X4 light-moderate only or low impact: no running, no intervals; HC-X5 hot
 * climate: no vigorous outdoor sessions), in the modality gene's order.
 */
export function allowedModalities(caps: Pick<SafetyCaps, 'exercise'>): CardioModality[] {
  const e = caps.exercise;
  const noRun = e.lowImpact || e.lightModerateOnly || e.noVigorousOutdoor;
  const noHiit = e.lowImpact || e.lightModerateOnly || e.noVigorousOutdoor;
  return IDEAL_MODALITIES.filter((m) => !(m === 'run' && noRun) && !(m === 'hiit' && noHiit));
}
