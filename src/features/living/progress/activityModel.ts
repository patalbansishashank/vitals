/**
 * Pure view model of Progress's activity cards (energy SPEC §V4.6): weekly Heart Points against 150 and 300, the
 * engine's WHO moderate-equivalent minutes, energy out against intake, the fused steps trend, and the sleeping low HR and
 * HRV trends. Nothing here estimates anything new: it groups what V2/V3 (through the adapter), S2 and the engine already
 * computed into weeks and days, and reads it out. A null stays a null (§1.2): a day without data is a gap, never a zero.
 */
import { weeklyDose } from '@/catalogues';
import type { StimulusVector } from '@/catalogues/types';
import { addDays, compareDates, daysBetween, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { GaugeBaselines, GaugeSleepSession, GaugeStepDay } from '@/net/gauge';
import type { ProgressDayActual } from './v3Adapter';

export type WeekStart = 'monday' | 'sunday';

/** Fit's weekly goal and its upper reference (WHO 2020's 150-300 moderate-equivalent minutes, which points approximate). */
export const POINTS_GOAL = 150;
export const POINTS_UPPER = 300;
/** Weeks of Heart Points bars. */
export const POINT_WEEKS = 8;
/** Days of the steps and overnight lanes. */
export const TREND_DAYS = 28;
/** A trailing 7-day mean needs at least this many days with a value (P). */
export const MEAN_MIN_DAYS = 4;
/** A.1.4: the steps goal when the plan sets none (drawn as a default: a dashed goal line). */
export const DEFAULT_STEPS_GOAL = 10_000;

/** The first day of the week holding `date`. */
export function weekOf(date: LocalDate, start: WeekStart): LocalDate {
  const wd = weekdayOf(date); // 0 = Monday
  const back = start === 'monday' ? wd : (wd + 1) % 7;
  return addDays(date, -back);
}

/** The first days of the last `n` weeks up to the week holding `today`, oldest first. */
export function weekStarts(today: LocalDate, n: number, start: WeekStart): LocalDate[] {
  const last = weekOf(today, start);
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
}

/** Every date of [from, to], oldest first. */
export function datesOf(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ------------------------------------------------------------------------------------------ Heart Points by week */

export interface PointsWeek {
  start: LocalDate;
  /** Σ of the days' own points (exact); null when no day of the week has coverage. */
  points: number | null;
  /** Days of the week with a points value. */
  daysWithData: number;
  /** Days of the week elapsed up to today (7 for a past week). */
  daysElapsed: number;
  current: boolean;
}

export function pointsWeeks(actuals: readonly ProgressDayActual[], today: LocalDate, start: WeekStart, n = POINT_WEEKS): PointsWeek[] {
  const byDate = new Map(actuals.map((a) => [a.date, a]));
  return weekStarts(today, n, start).map((ws) => {
    let sum = 0;
    let days = 0;
    let elapsed = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (compareDates(d, today) > 0) break;
      elapsed++;
      const p = byDate.get(d)?.heartPoints;
      if (p !== null && p !== undefined && Number.isFinite(p)) {
        sum += p;
        days++;
      }
    }
    return { start: ws, points: days > 0 ? sum : null, daysWithData: days, daysElapsed: elapsed, current: compareDates(addDays(ws, 6), today) >= 0 };
  });
}

/** Where a week stands against 150 and 300, in words (never good or bad: neither side is styled as a verdict). */
export function pointsStanding(points: number | null, coverage?: { daysWithData: number; daysElapsed: number }): 'unknown' | 'under' | 'goal' | 'upper' | 'partial' {
  if (points === null) return 'unknown';
  if (points >= POINTS_UPPER) return 'upper';
  if (points >= POINTS_GOAL) return 'goal';
  // "under 150" is a claim about the whole week: with days that have no data it is only "so far, on the days with data"
  if (coverage && coverage.daysWithData < coverage.daysElapsed) return 'partial';
  return 'under';
}

/* ------------------------------------------------------------------------- WHO moderate-equivalent minutes (engine) */

export interface WhoWeek {
  /** M + 2V of the week's stated / talk-test / relative-effort classes; null when some aerobic minutes are unclassified or no session is logged (unknown, not 0). */
  minutes: number | null;
  /** Known minutes up to the case that every unclassified minute were vigorous (a range, not a guess). */
  range: readonly [number, number];
  reference: 'met' | 'notMet' | 'unknown' | 'notApplicable';
  /** Logged sessions of the week (with or without ring data: the engine's own stimuli). */
  sessions: number;
}

/** The engine's D3-03 guideline minutes of a week (`weeklyDose`); separate from Heart Points by rule (§V2.3). */
export function whoWeek(actuals: readonly ProgressDayActual[], from: LocalDate, to: LocalDate, ageYears?: number): WhoWeek {
  const stimuli: StimulusVector[] = [];
  for (const a of actuals) if (compareDates(a.date, from) >= 0 && compareDates(a.date, to) <= 0) stimuli.push(...a.sessionStimuli);
  const dose = weeklyDose(stimuli, ageYears !== undefined ? { ageYears } : {});
  // a week with no logged session says nothing about guideline minutes: unknown, never "0 min" (§1.2)
  if (stimuli.length === 0) return { minutes: null, range: [0, 0], reference: dose.aerobicReference === 'notApplicable' ? 'notApplicable' : 'unknown', sessions: 0 };
  return { minutes: dose.healthEquivalentMin, range: dose.healthEquivalentRange, reference: dose.aerobicReference, sessions: stimuli.length };
}

/* ---------------------------------------------------------------------------------------- energy out against intake */

export interface EnergyRow {
  date: LocalDate;
  out: number | null;
  outLo: number | null;
  outHi: number | null;
  intake: number | null;
}

export function energyRows(actuals: readonly ProgressDayActual[], from: LocalDate, to: LocalDate): EnergyRow[] {
  const byDate = new Map(actuals.map((a) => [a.date, a]));
  return datesOf(from, to).map((date) => {
    const a = byDate.get(date);
    const e = a?.energyOut ?? null;
    return { date, out: e ? e.kcal : null, outLo: e ? e.envelope.lo : null, outHi: e ? e.envelope.hi : null, intake: a?.intakeKcal ?? null };
  });
}

export interface EnergyBalance {
  /** Days with both an energy-out estimate and a fully logged intake. */
  days: number;
  outMean: number;
  outLo: number;
  outHi: number;
  intakeMean: number;
  /** intake − out over those days: [low, high] from the envelope (a scenario range, §1.5). */
  balanceLo: number;
  balanceHi: number;
}

/** The mean over the days that carry both numbers (null under 3 such days, P). Never fills a gap with a plan value. */
export function energyBalance(rows: readonly EnergyRow[]): EnergyBalance | null {
  const both = rows.filter((r) => r.out !== null && r.intake !== null && r.outLo !== null && r.outHi !== null);
  if (both.length < 3) return null;
  const mean = (f: (r: EnergyRow) => number) => both.reduce((s, r) => s + f(r), 0) / both.length;
  const outMean = mean((r) => r.out!);
  const outLo = mean((r) => r.outLo!);
  const outHi = mean((r) => r.outHi!);
  const intakeMean = mean((r) => r.intake!);
  return { days: both.length, outMean, outLo, outHi, intakeMean, balanceLo: intakeMean - outHi, balanceHi: intakeMean - outLo };
}

/* ------------------------------------------------------------------------------------------------ fused steps */

export interface StepsRow {
  date: LocalDate;
  /** The day's steps under the person's headline policy (D3); null with no step coverage. */
  steps: number | null;
  /** D3 `atLeast` added ring steps not placed in time. */
  atLeast: boolean;
  /** The trailing 7-day mean (null under MEAN_MIN_DAYS days with a value). */
  mean7: number | null;
}

/**
 * Steps per day from `steps-fuse/1` days. `located` is the authoritative total; `atLeast` (D3) shows the server's
 * headline, max(located, ring daily total), labelled. A day the server did not return is a gap. A located 0 with no
 * coverage minutes is unknown, not zero (§1.2).
 */
export function stepsRows(days: readonly GaugeStepDay[], from: LocalDate, to: LocalDate, policy: 'atLeast' | 'located'): StepsRow[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const values = datesOf(from, to).map((date) => {
    const d = byDate.get(date);
    if (!d) return { date, steps: null, atLeast: false };
    const atLeast = policy === 'atLeast' && d.headlinePolicy === 'atLeast';
    const head = atLeast ? d.headline : d.located;
    // a day with no placed minute and no placed steps has nothing under `located`: unknown, never a 0 bar (the ring's own
    // daily total is not placed in time); `atLeast` still shows the server's headline when it is above 0
    const placed = (d.coverage?.eitherMin ?? 0) > 0 || d.located > 0;
    if (!placed && !(atLeast && head > 0)) return { date, steps: null, atLeast: false };
    return { date, steps: head, atLeast: atLeast && d.headline > d.located };
  });
  return values.map((v, i) => ({ ...v, mean7: trailingMean(values.slice(Math.max(0, i - 6), i + 1).map((x) => x.steps)) }));
}

export function trailingMean(xs: ReadonlyArray<number | null>): number | null {
  const ok = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return ok.length >= MEAN_MIN_DAYS ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

/** The last week's mean against the four weeks' (null when either is missing). */
export function stepsSummary(rows: readonly StepsRow[]): { last7: number | null; all: number | null; days: number } {
  const last = rows.slice(-7).map((r) => r.steps);
  const all = rows.map((r) => r.steps).filter((x): x is number => x !== null);
  return { last7: trailingMean(last), all: all.length >= MEAN_MIN_DAYS ? all.reduce((a, b) => a + b, 0) / all.length : null, days: all.length };
}

/* -------------------------------------------------------------------------- sleeping low HR and HRV, by night */

export interface NightRow {
  /** The waking date. */
  date: LocalDate;
  lowHr: number | null;
  hrv: number | null;
}

/** One row per waking date from the main (longest asleep) session; a night without the metric is a gap. */
export function nightRows(sessions: readonly GaugeSleepSession[], from: LocalDate, to: LocalDate): NightRow[] {
  const main = new Map<string, GaugeSleepSession>();
  for (const s of sessions) {
    const cur = main.get(s.wakingDate);
    if (!cur || s.asleepMinutes > cur.asleepMinutes) main.set(s.wakingDate, s);
  }
  const ok = (x: number | null | undefined) => (x !== null && x !== undefined && Number.isFinite(x) ? x : null);
  return datesOf(from, to).map((date) => {
    const m = main.get(date)?.metrics;
    return { date, lowHr: ok(m?.nightlyLowHrP10), hrv: ok(m?.hrvNightlyMs) };
  });
}

export interface UsualBand {
  median: number;
  lo: number;
  hi: number;
  n: number;
}

/**
 * The S2 baselines as bands, the width of A.1.2's `vsUsual` words: sleeping low HR median ± s (s = max(IQR/1.349, 3 bpm));
 * HRV base ± max(3 ms, 10 % of base). Absent under 7 nights (the baseline is still forming).
 */
export function usualBands(b: GaugeBaselines | null): { lowHr: UsualBand | null; hrv: UsualBand | null; learning: GaugeBaselines['learning'] | null } {
  if (!b) return { lowHr: null, hrv: null, learning: null };
  const lowHr = b.sleepLowHr && b.sleepLowHr.n >= 7 ? { median: b.sleepLowHr.median, lo: b.sleepLowHr.median - b.sleepLowHr.s, hi: b.sleepLowHr.median + b.sleepLowHr.s, n: b.sleepLowHr.n } : null;
  const h = b.hrvBaseline;
  const base = h ? (h.medianMs ?? Math.exp(h.median)) : 0;
  const t = Math.max(3, 0.1 * base);
  const hrv = h && h.n >= 7 ? { median: base, lo: base - t, hi: base + t, n: h.n } : null;
  return { lowHr, hrv, learning: b.learning };
}

/** The last 7 nights' median of a metric (null under 4 nights, P). */
export function recentMedian(rows: readonly NightRow[], key: 'lowHr' | 'hrv'): number | null {
  const xs = rows
    .slice(-7)
    .map((r) => r[key])
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  if (xs.length < MEAN_MIN_DAYS) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

/** "Near usual" within the usual band, else "Below usual" / "Above usual" (A.1.2 vsUsual words). */
export function usualWord(value: number | null, band: UsualBand | null): 'Near usual' | 'Below usual' | 'Above usual' | null {
  if (value === null || !band) return null;
  if (value < band.lo) return 'Below usual';
  if (value > band.hi) return 'Above usual';
  return 'Near usual';
}

/** Index of `date` in a window starting at `from`. */
export const indexOf = (from: LocalDate, date: LocalDate): number => daysBetween(from, date);
