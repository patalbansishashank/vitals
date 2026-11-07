/**
 * One night as the sleep sections show it (SPEC §V4.5 as amended by A.0, A.1.1, A.1.2, A.3.4): S2's `sleep-metrics/1`
 * joined with the plan, the D11 entry and the baselines through V2's `sleepNight`. Pure: no React, no IO.
 *
 * Words follow A.0: "Fell asleep" and "Woke" (never "bedtime"), "Window continuity" (never "efficiency": that needs a
 * lights-out time), "Settle time (from the ring's first recorded minute)" (never "latency"), "Sleeping low HR" (never a
 * waking resting HR). Tosses and turns and breathing rate do not appear (A.1.6).
 */
import { clockText, formatNumber, twinFileName, type LineMark, type LinePoint, type LineSpan, type ShareBarRow, type TracePoint, type TrendMagnitude, type TrendWord, type TwinData } from '@/components';
import { sleepNight, type SleepEntryTimes, type SleepNight, type SleepPlanTargets } from '@/living/sensors';
import { STAGE_HUE, clockOf, clockOfMinutes, circularSpreadMin, daysFrom, mainSession, minutesText, shiftDate, wholePercents } from '@/features/ring/model';
import { partOfDay, quietNightFact, sleepGoalWord } from '@/features/ring/quiet';
import type { GaugeBaselines, GaugeClockBaseline, GaugeSleepMetrics, GaugeSleepSession } from '@/features/ring/types';
import { SLEEP_COPY as C } from './copy';

const MIN = 60_000;

export interface NightView {
  session: GaugeSleepSession;
  /** S2's metrics, absent on an older server (then only the legacy facts show). */
  metrics: GaugeSleepMetrics | null;
  windowStart: number;
  windowEnd: number;
  onset: number | null;
  wake: number | null;
  tstLower: number;
  tstUpper: number;
  incomplete: boolean;
  /** "7 h 56", or "7 h 10 to 7 h 40" for an incomplete night. */
  tstText: string;
  /** V2's join; null without metrics. */
  joined: SleepNight | null;
  stages: ShareBarRow[];
  stageNote: string | null;
  /**
   * (r069) Set when the night has named stages but not one REM minute: the device named none (2026-10-29: the ring's
   * own codes had no REM in 384 minutes), which the card says in words rather than as a measured "0 min".
   */
  noRemNote: string | null;
  /** HR bins from onset to wake. */
  hr: { points: TracePoint[]; low: TracePoint | null; trend: { word: TrendWord; magnitude?: TrendMagnitude } | null; sparse: boolean; awake: Array<{ from: number; to: number }> };
  learning: { nights: number; needed: number } | null;
}

const shareOf = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** Minutes of a clock baseline as "23:08 ± 24 min", null when suppressed. */
export function usualText(b: GaugeClockBaseline | null | undefined): string | null {
  if (!b || b.minutes === null || b.suppressed) return null;
  const sd = circularSpreadMin(b.Rbar);
  return `${clockOfMinutes(b.minutes)}${sd !== null && sd >= 1 ? ` ± ${Math.round(sd)} min` : ''}`;
}

/** "Fell asleep 23:14 · Woke 07:26" (or the recorded window on an older server); quiet: the times as parts of the day. */
export function nightFact(v: NightView, quiet = false): string {
  if (quiet) return quietNightFact(v.metrics?.onset, v.metrics?.finalWake, v.session.start, v.session.end);
  if (v.metrics?.onset && v.metrics.finalWake) return `${C.fellAsleep} ${clockOf(v.metrics.onset)} · ${C.woke} ${clockOf(v.metrics.finalWake)}`;
  return `${clockOf(v.session.start)}–${clockOf(v.session.end)}`;
}

export function nightView(i: { session: GaugeSleepSession; baselines: GaugeBaselines | null; plan: SleepPlanTargets | null; entry?: SleepEntryTimes | null }): NightView {
  const s = i.session;
  const m = s.metrics ?? null;
  const windowStart = Date.parse(s.start);
  const windowEnd = Date.parse(s.end);
  const tstLower = m?.tstLowerMin ?? s.asleepMinutes;
  const tstUpper = m?.tstUpperMin ?? s.asleepMinutes;
  const incomplete = m?.incomplete === true;
  const tstText = incomplete && tstUpper > tstLower ? `${minutesText(tstLower)} to ${minutesText(tstUpper)}` : minutesText(tstLower);
  const joined = m ? sleepNight({ metrics: m, baselines: i.baselines, plan: i.plan, entry: i.entry ?? null }) : null;

  // (r068 S08) stage shares over ONE denominator, the whole recorded night (asleep stages, awake and unclassified), each a
  // whole percentage by largest remainder, so the rows add up to 100 % (was asleep stages of the asleep time and awake of
  // the window: 24 + 54 + 22 + 3 = 103 %)
  const st = m?.stageMinutes ?? { deep: s.minutes.deep, light: s.minutes.light, rem: s.minutes.rem, asleepUnspecified: 0, awake: s.minutes.awake, unknown: s.minutes.unknown ?? 0 };
  const parts: Array<{ id: keyof typeof st; label: string; unknown?: boolean }> = [
    { id: 'deep', label: 'Deep' },
    { id: 'light', label: 'Light' },
    { id: 'rem', label: 'REM' },
    ...(st.asleepUnspecified > 0 ? [{ id: 'asleepUnspecified' as const, label: 'Asleep, no stage' }] : []),
    { id: 'awake', label: 'Awake' },
    ...(st.unknown > 0 ? [{ id: 'unknown' as const, label: 'Unclassified', unknown: true }] : []),
  ];
  const whole = parts.reduce((a, p) => a + Math.max(0, st[p.id]), 0);
  const pcts = wholePercents(parts.map((p) => st[p.id]));
  const noRem = noRemMarked(st);
  const stages: ShareBarRow[] = parts.map((p, k) => ({
    id: p.id,
    label: p.label,
    valueText: noRem && p.id === 'rem' ? C.noRemRow : minutesText(st[p.id]),
    share: shareOf(st[p.id], whole),
    shareText: noRem && p.id === 'rem' ? '' : `${pcts[k]}\u00a0%`,
    hue: STAGE_HUE[p.id] ?? 'var(--lm-ink-3)',
    ...(p.unknown ? { unknown: true } : {}),
  }));
  const named = m?.namedCoveragePct;
  const stageNote = incomplete && typeof named === 'number' ? `Incomplete night: ${Math.round(named)} % of the window named` : null;

  // the sleep HR trace (5-min bins from onset)
  const onset = m?.onset ? Date.parse(m.onset) : null;
  const wake = m?.finalWake ? Date.parse(m.finalWake) : null;
  const points: TracePoint[] = [];
  if (m && onset !== null) m.trace5min.forEach((v, k) => (typeof v === 'number' ? points.push({ t: onset + k * 5 * MIN + 2.5 * MIN, v }) : undefined));
  const sparse = !!m && (m.tooFewHrReadings === true || points.length < 8);
  let low: TracePoint | null = null;
  if (!sparse && points.length) for (const p of points) if (!low || p.v < low.v) low = p;
  const t = m?.hrTrend;
  const trend = !sparse && t ? { word: (t.word === 'steady' ? 'Steady' : t.word === 'rising' ? 'Rising' : 'Falling') as TrendWord, ...(t.magnitude ? { magnitude: (t.magnitude[0]!.toUpperCase() + t.magnitude.slice(1)) as TrendMagnitude } : {}) } : null;
  const awake = s.blocks.filter((b) => b.stage === 'awake').map((b) => ({ from: Date.parse(b.start), to: Date.parse(b.end) })).filter((b) => onset === null || (b.to > onset && (wake === null || b.from < wake)));

  const l = i.baselines?.learning;
  return {
    session: s,
    metrics: m,
    windowStart,
    windowEnd,
    onset,
    wake,
    tstLower,
    tstUpper,
    incomplete,
    tstText,
    joined,
    stages,
    stageNote,
    noRemNote: noRem ? (s.source !== 'healthConnect' ? C.noRem : C.noRemOther) : null,
    hr: { points, low, trend, sparse, awake },
    learning: l?.learning ? { nights: l.nights, needed: l.needed } : null,
  };
}

/** (r069) A night staged into deep and light with no REM minute at all. Pure. */
export function noRemMarked(st: { deep: number; light: number; rem: number }): boolean {
  return st.rem <= 0 && st.deep + st.light > 0;
}

/**
 * (r069) The compact card's stage line, "Deep 2 h 21 · Light 3 h 45 · REM 1 h 33" ("… · No REM marked" when the night has
 * none), so REM is on the card whenever the night has it. Null without named stages.
 */
export function stagesLine(v: Pick<NightView, 'session' | 'metrics'>): string | null {
  const st = v.metrics?.stageMinutes ?? v.session.minutes;
  if (st.deep + st.light + st.rem <= 0) return null;
  const rem = noRemMarked(st) ? 'No REM marked' : `REM ${minutesText(st.rem)}`;
  return `Deep ${minutesText(st.deep)} · Light ${minutesText(st.light)} · ${rem}`;
}

/**
 * (r069) Window continuity as shown: the server's figure on a complete night; on an incomplete one (named coverage under
 * 95 %, where the server sends none) the two bounds, the minutes the ring left unnamed counted awake and then asleep,
 * "77–91" (Sleep index keeps the server's null). Null without onset and wake. Pure.
 */
export function continuityShown(m: Pick<GaugeSleepMetrics, 'windowContinuityPct' | 'K' | 'wasoMin' | 'onset' | 'finalWake'> | null): { text: string; range: boolean } | null {
  if (!m) return null;
  if (m.windowContinuityPct != null) return { text: String(Math.round(m.windowContinuityPct)), range: false };
  if (!m.onset || !m.finalWake || m.wasoMin == null) return null;
  const windowMin = (Date.parse(m.finalWake) - Date.parse(m.onset)) / MIN;
  const unnamed = windowMin - m.K - m.wasoMin;
  if (!(windowMin > 0) || unnamed < 0) return null;
  const lo = Math.round((100 * m.K) / windowMin);
  const hi = Math.round((100 * (m.K + unnamed)) / windowMin);
  return lo === hi ? { text: String(lo), range: false } : { text: `${lo}–${hi}`, range: true };
}

/**
 * (r068 S03) "Usually 23:08–07:15 · 27 nights" ("Usually asleep 23:08" or "Usually up 07:15" with one of them), null
 * without usual times. The spread stays in `usualText` (the table and the ⓘ), out of the card's one line.
 */
export function usualLine(b: GaugeBaselines | null): string | null {
  if (!b) return null;
  const clock = (x: GaugeBaselines['usualOnset']) => (x && x.minutes !== null && !x.suppressed ? clockOfMinutes(x.minutes) : null);
  const on = clock(b.usualOnset);
  const up = clock(b.usualWake);
  if (!on && !up) return null;
  const n = Math.max(b.usualOnset?.n ?? 0, b.usualWake?.n ?? 0);
  const span = on && up ? `Usually ${on}–${up}` : on ? `Usually asleep ${on}` : `Usually up ${up}`;
  return `${span} · ${n} night${n === 1 ? '' : 's'}`;
}

/** "Later than usual", "Near usual", "Earlier than usual" from a signed minute difference: quiet mode's words (no figure). Pure. */
export function vsUsualWords(d: number | null): string | null {
  if (d === null) return null;
  return Math.abs(Math.round(d)) < 5 ? 'Near usual' : d > 0 ? 'Later than usual' : 'Earlier than usual';
}

/** "As planned", "Later than planned", "Earlier than planned" from a signed minute difference: quiet mode's words. Pure. */
export function vsPlanWords(d: number | null): string | null {
  if (d === null) return null;
  return Math.round(d) === 0 ? 'As planned' : d > 0 ? 'Later than planned' : 'Earlier than planned';
}

/** "6 min later than usual" from a signed minute difference. */
export function vsUsualClock(d: number | null): string | null {
  if (d === null) return null;
  const r = Math.round(d);
  if (Math.abs(r) < 5) return 'Near usual';
  return `${Math.abs(r)} min ${r > 0 ? 'later' : 'earlier'} than usual`;
}

// ---------------------------------------------------------------------------------------------------------------
// The 4-week history (Claude UI P3-11: it read decimal hours, "7.5", while every other sleep figure reads "7 h 56")

/** Hours as h:mm for the 4-week chart: 7.93 → "7:56", 7.5 → "7:30", 8 → "8:00". */
export function hoursClock(h: number): string {
  if (!Number.isFinite(h)) return '—';
  const total = Math.max(0, Math.round(h * 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The same value for a screen reader: "7 hours 56 minutes", "8 hours", "45 minutes". */
export function hoursSpoken(h: number): string {
  if (!Number.isFinite(h)) return 'no value';
  const total = Math.max(0, Math.round(h * 60));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  const hp = `${hh} hour${hh === 1 ? '' : 's'}`;
  const mp = `${mm} minute${mm === 1 ? '' : 's'}`;
  return hh === 0 ? mp : mm === 0 ? hp : `${hp} ${mp}`;
}

/** "Most", "About half the", … : a share in words, with no digits (quiet mode). */
function shareWord(part: number, of: number): 'every' | 'most' | 'half' | 'few' | 'none' {
  if (part <= 0 || of <= 0) return 'none';
  if (part >= of) return 'every';
  const r = part / of;
  return r >= 0.6 ? 'most' : r >= 0.35 ? 'half' : 'few';
}

/**
 * Quiet mode's 4-week history: words only, no digits (the chart's axis, readout and table are numbers). The caption says
 * how many nights were recorded, the line how many reached the sleep goal (asleep at or above it, as "Goal met" reads).
 */
export function historyWords(hours: readonly number[], goalMin: number): { caption: string; line: string } {
  const nights = hours.filter(Number.isFinite);
  const rec = shareWord(nights.length, hours.length);
  const caption = { every: 'Every night recorded', most: 'Most nights recorded', half: 'About half the nights recorded', few: 'A few nights recorded', none: 'No nights recorded' }[rec];
  if (!nights.length) return { caption, line: 'Nothing to show yet.' };
  const met = shareWord(nights.filter((h) => h * 60 >= goalMin).length, nights.length);
  const line = {
    every: 'Every recorded night reached your sleep goal.',
    most: 'Most nights reached your sleep goal.',
    half: 'About half the nights reached your sleep goal.',
    few: 'A few nights reached your sleep goal.',
    none: 'No recorded night reached your sleep goal.',
  }[met];
  return { caption, line };
}

// ---------------------------------------------------------------------------------------------------------------
// r071: the goal in the foot, the awake breaks, timing against the usual window, the night's heart rate, the history

/** Asleep against the goal as the foot says it: "Goal met", "4 min short", "Goal unclear" (V2 `vsGoal`); quiet: a word with no figure. Pure. */
export function sleepGoalFoot(v: Pick<NightView, 'joined' | 'tstLower'>, goalMin: number, quiet: boolean): string {
  if (quiet) return sleepGoalWord(v.tstLower, goalMin);
  return v.joined?.vsGoal.text ?? (v.tstLower >= goalMin ? 'Goal met' : `${Math.round(goalMin - v.tstLower)} min short`);
}

/**
 * (r071) The waking breaks of a night the ring recorded in two parts, as facts: "Awake break 02:04–03:13 · 1 h 09" (the
 * server counts them as awake after sleep onset, in the stage rows and the awake total). Quiet: one sentence, no figure. Pure.
 */
export function awakeBreakFacts(s: Pick<GaugeSleepSession, 'awakeBreaks'>, quiet = false): string[] {
  const breaks = s.awakeBreaks ?? [];
  if (!breaks.length) return [];
  if (quiet) return [breaks.length === 1 ? 'Awake break in the night' : 'Awake breaks in the night'];
  return breaks.map((b) => `Awake break ${clockOf(b.start)}–${clockOf(b.end)} · ${minutesText(b.minutes)}`);
}

/** "Deep + REM ~3 h 18", "42 %", "Estimate": the ring's estimate of the restorative stages and their share of the night's sleep, null without one. Pure. */
export function restorativeFacts(v: Pick<NightView, 'metrics' | 'tstLower'>): string[] | null {
  const r = v.metrics?.restorativeEstimatedMin;
  if (typeof r !== 'number') return null;
  return [`Deep + REM ~${minutesText(r)}`, `${formatNumber(Math.round((100 * r) / Math.max(1, v.tstLower)), 0)}\u00a0%`, 'Estimate'];
}

/** The offset an instant carries ("+05:30", "Z"); empty when it has none (then the device's zone reads it). Pure. */
export function wallOffset(iso: string): string {
  const m = /(Z|[+-]\d{2}:?\d{2})$/.exec(iso);
  if (!m) return '';
  const o = m[1]!;
  return /^[+-]\d{4}$/.test(o) ? `${o.slice(0, 3)}:${o.slice(3)}` : o;
}

/** A wall-clock date and minute of the day, in the night's own offset, as an instant (ms). */
function wallInstant(date: string, minutes: number, offset: string): number {
  const m = Math.round(minutes);
  return Date.parse(`${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00${offset}`);
}

/** The usual clock of a baseline (minutes after midnight), null while it is suppressed or missing. */
const usualMinutes = (b: GaugeClockBaseline | null | undefined): number | null => (b && b.minutes !== null && !b.suppressed ? b.minutes : null);

/** "22:56–06:39" (or "asleep 22:56", "up 06:39" with one of them): the usual window as the foot says it, null without usual times. Pure. */
export function usualRangeText(b: GaugeBaselines | null): string | null {
  if (!b) return null;
  const clock = (x: GaugeClockBaseline | null | undefined) => (usualMinutes(x) !== null ? clockOfMinutes(usualMinutes(x)!) : null);
  const on = clock(b.usualOnset);
  const up = clock(b.usualWake);
  if (on && up) return `${on}–${up}`;
  return on ? `asleep ${on}` : up ? `up ${up}` : null;
}

export interface TimingWindows {
  /** 20:00 the evening before to 12:00 on the waking date, in the night's own offset (ms). */
  axis: [number, number];
  /** Fell asleep to woke, from the ring's metrics. */
  actual: { from: number; to: number } | null;
  /** The usual window from the baselines (an onset after noon belongs to the evening before). */
  usual: { from: number; to: number } | null;
  midpoint: number | null;
}

/**
 * (r071) The picture of the night's timing: the axis the window bar draws on, the window that happened and the person's
 * usual one, as instants. Built from the night's own wall clock (its offset), so it never moves with the device's zone. Pure.
 */
export function timingWindows(v: Pick<NightView, 'session' | 'metrics'>, baselines: GaugeBaselines | null): TimingWindows {
  const offset = wallOffset(v.session.start);
  const day = v.session.wakingDate;
  const prev = shiftDate(day, -1);
  const axis: [number, number] = [wallInstant(prev, 20 * 60, offset), wallInstant(day, 12 * 60, offset)];
  const m = v.metrics;
  const on = m?.onset ? Date.parse(m.onset) : Number.NaN;
  const wk = m?.finalWake ? Date.parse(m.finalWake) : Number.NaN;
  const mid = m?.midpoint ? Date.parse(m.midpoint) : Number.NaN;
  const usualOn = usualMinutes(baselines?.usualOnset);
  const usualWk = usualMinutes(baselines?.usualWake);
  let usual: TimingWindows['usual'] = null;
  if (usualOn !== null && usualWk !== null) {
    const from = wallInstant(usualOn >= 12 * 60 ? prev : day, usualOn, offset);
    const to = wallInstant(day, usualWk, offset);
    if (to > from) usual = { from, to };
  }
  return { axis, actual: Number.isFinite(on) && Number.isFinite(wk) && wk > on ? { from: on, to: wk } : null, usual, midpoint: Number.isFinite(mid) ? mid : null };
}

/** The timing as a table: when the night began, ended and turned, against the usual clock, and the settle time. Pure. */
export function timingTwin(v: Pick<NightView, 'metrics'>, baselines: GaugeBaselines | null): TwinData {
  const m = v.metrics;
  const usual = (b: GaugeClockBaseline | null | undefined) => (usualMinutes(b) !== null ? clockOfMinutes(usualMinutes(b)!) : '—');
  const rows: string[][] = [];
  if (m?.onset) rows.push(['Fell asleep', clockOf(m.onset), usual(baselines?.usualOnset)]);
  if (m?.finalWake) rows.push(['Woke', clockOf(m.finalWake), usual(baselines?.usualWake)]);
  if (m?.midpoint) rows.push(['Sleep midpoint', clockOf(m.midpoint), usual(baselines?.usualMidpoint)]);
  if (m?.leadingWakeMin != null) rows.push(['Settle time', `${Math.round(m.leadingWakeMin)} min`, '—']);
  const c = continuityShown(m ?? null);
  if (c) rows.push(['Window continuity', `${c.text}\u00a0%`, '—']);
  if (m?.wakeUps != null) rows.push(['Wake-ups', String(m.wakeUps), '—']);
  const caption = m?.onset && m.finalWake ? `Sleep timing: fell asleep ${clockOf(m.onset)}, woke ${clockOf(m.finalWake)}` : 'Sleep timing';
  return { title: 'Sleep timing table', caption, head: ['Moment', 'Last night', 'Usual'], rows, fileName: twinFileName('Sleep timing'), rowNoun: ['row', 'rows'] };
}

/** The reading count behind the time-weighted `avgSleepHr`: S2's `hrReadings`, else the sampled mean's n (same night). */
export function avgReadings(m: Pick<GaugeSleepMetrics, 'hrReadings' | 'sampledMeanSleepHr'>): number | null {
  if (typeof m.hrReadings === 'number' && Number.isFinite(m.hrReadings)) return m.hrReadings;
  return m.sampledMeanSleepHr?.n ?? null;
}

/**
 * (r071) The night's heart rate as the `GlowLine` takes it: the 5-minute bins as points, the awake stretches as hatched
 * spans, the lowest bin as a labelled mark ("Lowest 52 · 04:50"). Pure.
 */
export function sleepHrLine(v: Pick<NightView, 'hr'>): { series: LinePoint[]; spans: LineSpan[]; marks: LineMark[] } {
  const series = v.hr.points.map((p): LinePoint => ({ t: p.t, v: p.v }));
  const spans = v.hr.awake.map((a): LineSpan => ({ from: a.from, to: a.to, kind: 'awake' }));
  const low = v.hr.low;
  const marks: LineMark[] = low ? [{ t: low.t, v: low.v, label: `Lowest ${formatNumber(low.v, 0)} · ${clockText(low.t)}`, placement: 'below' }] : [];
  return { series, spans, marks };
}

/** "Steady through the night", "Rising slightly toward morning": the trace's trend as a fact line. */
export function hrTrendFact(t: NonNullable<NightView['hr']['trend']>): string {
  const w = t.word === 'Steady' ? 'steady through the night' : `${t.word === 'Rising' ? 'rising' : 'falling'}${t.magnitude === 'Slight' ? ' slightly' : t.magnitude === 'Strong' ? ' strongly' : ''} toward morning`;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** The usual sleeping low heart rate as a range, from the baseline's median and scale ("Usual 50–56"), null while it forms. Pure. */
export function usualLowHrRange(b: GaugeBaselines | null): string | null {
  const l = b?.sleepLowHr;
  if (!b || b.learning.learning || !l || l.ready === false || !Number.isFinite(l.median) || !(l.s > 0)) return null;
  return `${formatNumber(Math.round(l.median - l.s), 0)}–${formatNumber(Math.round(l.median + l.s), 0)}`;
}

export interface HistorySeries {
  /** One ISO date per night (the waking day). */
  dates: string[];
  /** Hours asleep (the lower bound on an incomplete night), null where no night was recorded: no bar, never a zero. */
  hours: Array<number | null>;
  /** An incomplete night: drawn as an outline (at least this much). */
  outline: boolean[];
}

/** The main night of every day from `from` to `to` as hours asleep, for the history bars. Pure. */
export function historySeries(sessions: readonly GaugeSleepSession[], from: string, to: string): HistorySeries {
  const dates = daysFrom(from, to);
  const hours: HistorySeries['hours'] = [];
  const outline: boolean[] = [];
  for (const d of dates) {
    const s = mainSession(sessions, d);
    hours.push(s ? (s.metrics?.tstLowerMin ?? s.asleepMinutes) / 60 : null);
    outline.push(s?.metrics?.incomplete === true);
  }
  return { dates, hours, outline };
}

export interface HistoryStats {
  /** Nights recorded of the days shown. */
  nights: number;
  days: number;
  /** The mean of the recorded nights, hours; null with none. */
  meanHours: number | null;
  /** Nights at or above the goal. */
  met: number;
  /** Index of the last recorded night (the bar drawn bright), null with none. */
  last: number | null;
}

/** The hero and the foot of the history: the average night, the nights recorded, the nights that reached the goal. Pure. */
export function historyStats(hours: ReadonlyArray<number | null>, goalMin: number): HistoryStats {
  const known = hours.filter((h): h is number => h !== null && Number.isFinite(h));
  const last = hours.reduce<number | null>((a, h, i) => (h !== null && Number.isFinite(h) ? i : a), null);
  return { nights: known.length, days: hours.length, meanHours: known.length ? known.reduce((a, h) => a + h, 0) / known.length : null, met: known.filter((h) => h * 60 >= goalMin).length, last };
}

/** Hours as the history says them in the person's duration voice: 7.93 → "7 h 56", 8 → "8 h". */
export const hoursText = (h: number): string => (Number.isFinite(h) ? minutesText(h * 60) : '—');

/** "Fell asleep late in the evening": the part of the day of the lowest heart-rate bin, for quiet mode. Pure. */
export const lowestWhenWords = (t: number): string => `Lowest ${partOfDay(t)}`;
