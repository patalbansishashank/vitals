/**
 * Time in HR zones (`hr-zones/1`, energy SPEC §V2.2, Addendum A.1.2 #35-36, RESEARCH III.C "HR support and time in zones").
 *
 *  - Z1 [50, 60), Z2 [60, 70), Z3 [70, 80), Z4 [80, 90), Z5 [90, 100] % of the session's frozen basis (%HRmax or HRR).
 *    A display convention (P), not lactate or ventilatory thresholds.
 *  - Time is the `hr-support/1` supported seconds only (S2). Sparse HR therefore gives no zone time: it is `unknown`.
 *  - Exact reconciliation: below50 + Z1..Z5 + aboveEstimate + unknown + paused = elapsed, to the millisecond. Values above
 *    the configured maximum stay visible as `aboveEstimate` (a quality prompt), never capped or dropped.
 *  - Also: the raw max, the filtered observed peak (the highest value held for ≥ 2 consecutive supported samples, P) and
 *    the time-weighted mean over supported time.
 *
 * Warrants: analytically true A (time accounting; boundary ownership is half-open, Z5 closed at 100 %); the zone edges are
 * a product convention (P, C); the HR itself is a ring PPG estimate whose validity per modality is unverified (RESEARCH
 * III.C: W1 C for this ring).
 */
import { basisFraction, type ZoneBasis, type ZoneBoundaries } from './hrProfile';
import { SENSOR_VERSIONS, clipSegments, isFiniteNum, overlapMs, unionMs, type HrSegment, type Interval, type Ms } from './types';

export type ZoneIndex = 0 | 1 | 2 | 3 | 4;

export interface ZoneTime {
  version: typeof SENSOR_VERSIONS.hrZones;
  basis: ZoneBasis;
  elapsedS: number;
  pausedS: number;
  /** Supported time under 50 % of the basis. */
  below50S: number;
  /** Z1..Z5 supported seconds. */
  zonesS: [number, number, number, number, number];
  /** Supported time above 100 % of the configured maximum. */
  aboveEstimateS: number;
  /** Moving time with no supported HR. */
  unknownS: number;
  /** Supported ÷ moving time, 0-100; null when nothing moved. */
  coveragePct: number | null;
  rawMaxBpm: number | null;
  observedPeakBpm: number | null;
  meanBpm: number | null;
  /** Which HR the time came from (Codex #11): each reading's own interval, or the timeline's minute means. Absent: unstated. */
  hrSource?: HrSource;
}

/** The zone of a heart rate under frozen boundaries: −1 below 50 %, 0-4 for Z1-Z5, 5 above the maximum. */
export function zoneOf(bpm: number, b: ZoneBoundaries): -1 | ZoneIndex | 5 {
  // compared in bpm against the frozen edges, so an edge value is owned exactly by the zone above it
  const e = b.edgesBpm;
  if (bpm < e[0]) return -1;
  if (bpm > e[5]) return 5;
  if (bpm >= e[4]) return 4;
  if (bpm >= e[3]) return 3;
  if (bpm >= e[2]) return 2;
  if (bpm >= e[1]) return 1;
  return 0;
}

/** Fraction of the basis (exported for display: "72 % of HRmax"). */
export const fractionOfBasis = (bpm: number, b: ZoneBoundaries): number => basisFraction(bpm, b);

/**
 * Filtered observed peak: the highest value v such that at least `hold` consecutive supported samples (adjacent segments)
 * are all ≥ v (= max over runs of `hold` adjacent samples of their minimum). A single spike never sets it.
 */
export function filteredPeakBpm(segments: readonly HrSegment[], hold = 2): number | null {
  let best: number | null = null;
  for (let i = 0; i + hold - 1 < segments.length; i++) {
    let lo = Infinity;
    let ok = true;
    for (let j = i; j < i + hold; j++) {
      if (j > i && segments[j]!.start !== segments[j - 1]!.end) {
        ok = false;
        break;
      }
      lo = Math.min(lo, segments[j]!.bpm);
    }
    if (ok && (best === null || lo > best)) best = lo;
  }
  return best;
}

export interface ZoneTimeInput {
  window: Interval;
  pauses?: readonly Interval[];
  /** `hr-support/1` supported segments (S2). */
  segments: readonly HrSegment[];
  boundaries: ZoneBoundaries;
  /** Where `segments` came from (carried to the result). */
  hrSource?: HrSource;
}

/** Zone time of one window (a bout, or a bout clipped to a day). */
export function zoneTime(i: ZoneTimeInput): ZoneTime {
  const w = i.window;
  const elapsedMs = Math.max(0, w.end - w.start);
  const pausedMs = unionMs(i.pauses ?? [], w);
  const segs = clipSegments(i.segments, w, i.pauses ?? []);
  const zonesMs: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let belowMs = 0;
  let aboveMs = 0;
  let supMs = 0;
  let bpmMs = 0;
  let rawMax: number | null = null;
  for (const s of segs) {
    const d = s.end - s.start;
    supMs += d;
    bpmMs += d * s.bpm;
    rawMax = rawMax === null ? s.bpm : Math.max(rawMax, s.bpm);
    const z = zoneOf(s.bpm, i.boundaries);
    if (z === -1) belowMs += d;
    else if (z === 5) aboveMs += d;
    else zonesMs[z] += d;
  }
  const movingMs = elapsedMs - pausedMs;
  const unknownMs = Math.max(0, movingMs - supMs);
  const s = (ms: number) => ms / 1000;
  return {
    version: SENSOR_VERSIONS.hrZones,
    basis: i.boundaries.basis,
    elapsedS: s(elapsedMs),
    pausedS: s(pausedMs),
    below50S: s(belowMs),
    zonesS: zonesMs.map(s) as ZoneTime['zonesS'],
    aboveEstimateS: s(aboveMs),
    unknownS: s(unknownMs),
    coveragePct: movingMs > 0 ? (100 * supMs) / movingMs : null,
    rawMaxBpm: rawMax,
    observedPeakBpm: filteredPeakBpm(segs),
    meanBpm: supMs > 0 ? bpmMs / supMs : null,
    ...(i.hrSource ? { hrSource: i.hrSource } : {}),
  };
}

/** Sum of the reconciled parts (equals `elapsedS` by construction; exported for tests and audits). */
export const zoneTimeTotalS = (z: ZoneTime): number => z.below50S + z.zonesS.reduce((a, b) => a + b, 0) + z.aboveEstimateS + z.unknownS + z.pausedS;

// ---------------------------------------------------------------- day zones (Addendum A.1.2 #35, #36)

export interface ZoneBout {
  id: string;
  window: Interval;
  pauses?: readonly Interval[];
  segments: readonly HrSegment[];
  /** The bout's frozen boundaries (null: the bout has no HR profile; its time is unknown). */
  boundaries: ZoneBoundaries | null;
  status: 'approved' | 'pending';
}

export interface DayZoneFigures {
  /** Z1..Z5 minutes. */
  zonesMin: [number, number, number, number, number];
  z13Min: number;
  z45Min: number;
  below50Min: number;
  aboveEstimateMin: number;
  unknownMin: number;
  coveragePct: number | null;
  boutIds: string[];
}

export interface DayZones extends DayZoneFigures {
  version: typeof SENSOR_VERSIONS.hrZones;
  /** UTC bounds of the local day. */
  day: Interval;
  /** One basis, or `mixed` when bouts were frozen under different ones (each bout keeps its own). */
  basis: ZoneBasis | 'mixed' | null;
  label: 'from recorded activity';
  status: 'observed';
  byBout: Array<{ id: string; zones: ZoneTime }>;
  /** Pending candidates, only when `provisionalOverlay` is on: a separate "to review" figure, never in the totals. */
  toReview: DayZoneFigures | null;
}

function figures(parts: Array<{ id: string; zones: ZoneTime }>): DayZoneFigures {
  const z: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let below = 0;
  let above = 0;
  let unknown = 0;
  let moving = 0;
  for (const p of parts) {
    for (let k = 0; k < 5; k++) z[k]! += p.zones.zonesS[k]!;
    below += p.zones.below50S;
    above += p.zones.aboveEstimateS;
    unknown += p.zones.unknownS;
    moving += p.zones.elapsedS - p.zones.pausedS;
  }
  const m = (s: number) => s / 60;
  const supported = moving - unknown;
  return {
    zonesMin: z.map(m) as DayZoneFigures['zonesMin'],
    z13Min: m(z[0] + z[1] + z[2]),
    z45Min: m(z[3] + z[4]),
    below50Min: m(below),
    aboveEstimateMin: m(above),
    unknownMin: m(unknown),
    coveragePct: moving > 0 ? (100 * supported) / moving : null,
    boutIds: parts.map((p) => p.id),
  };
}

function boutInDay(b: ZoneBout, day: Interval): { id: string; zones: ZoneTime } | null {
  const w = { start: Math.max(b.window.start, day.start), end: Math.min(b.window.end, day.end) };
  if (w.end <= w.start || overlapMs(b.window.start, b.window.end, day.start, day.end) <= 0) return null;
  if (b.boundaries === null) {
    // no profile: every moving second is unknown (never a zero zone)
    const elapsed = (w.end - w.start) / 1000;
    const paused = unionMs(b.pauses ?? [], w) / 1000;
    return {
      id: b.id,
      zones: { version: SENSOR_VERSIONS.hrZones, basis: 'pctMax', elapsedS: elapsed, pausedS: paused, below50S: 0, zonesS: [0, 0, 0, 0, 0], aboveEstimateS: 0, unknownS: elapsed - paused, coveragePct: null, rawMaxBpm: null, observedPeakBpm: null, meanBpm: null },
    };
  }
  return { id: b.id, zones: zoneTime({ window: w, pauses: b.pauses ?? [], segments: b.segments, boundaries: b.boundaries }) };
}

/**
 * Day zone minutes: Σ over approved bouts of their supported seconds in Z1-Z5, each bout clipped to the local day and
 * under its own frozen boundaries. "From recorded activity": all-day zone minutes are impossible with sparse ring HR.
 */
export function dayZones(i: { day: Interval; bouts: readonly ZoneBout[]; provisionalOverlay?: boolean }): DayZones {
  const approved: Array<{ id: string; zones: ZoneTime }> = [];
  const pending: Array<{ id: string; zones: ZoneTime }> = [];
  const bases = new Set<ZoneBasis>();
  for (const b of i.bouts) {
    const part = boutInDay(b, i.day);
    if (!part) continue;
    if (b.status === 'approved') {
      approved.push(part);
      if (b.boundaries) bases.add(b.boundaries.basis);
    } else if (i.provisionalOverlay === true) pending.push(part);
  }
  return {
    version: SENSOR_VERSIONS.hrZones,
    day: i.day,
    basis: bases.size === 0 ? null : bases.size === 1 ? [...bases][0]! : 'mixed',
    label: 'from recorded activity',
    status: 'observed',
    ...figures(approved),
    byBout: approved,
    toReview: i.provisionalOverlay === true ? figures(pending) : null,
  };
}

/**
 * Minute-mean HR from the server timeline (`timeline.hr`: time-weighted minute means and `supportedS`) as segments. Each
 * minute's supported seconds are placed at the start of the minute: an allocation (the timeline does not say where inside
 * the minute they were), which is exact for minute totals and zone minutes. Null or non-finite minutes are skipped.
 */
export function segmentsFromTimeline(firstMinute: Ms, bpm: readonly (number | null)[], supportedS: readonly (number | null)[]): HrSegment[] {
  const out: HrSegment[] = [];
  for (let k = 0; k < bpm.length; k++) {
    const v = bpm[k];
    const s = supportedS[k];
    if (!isFiniteNum(v) || !isFiniteNum(s) || s <= 0) continue;
    const start = firstMinute + k * 60_000;
    out.push({ start, end: start + Math.min(60, s) * 1000, bpm: v });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- exact intervals (Codex #11)

/**
 * Where a zone figure's HR came from: `samples` = each raw reading's own `hr-support/1` interval (exact: 30 s at 110 bpm
 * then 30 s at 170 stay 30 s in each zone); `minuteMeans` = the timeline's minute means (the fallback when the readings are
 * missing: a minute's mixed readings become one value).
 */
export type HrSource = 'samples' | 'minuteMeans';

/**
 * The longest time one reading may stand for (P, the owner's "a gap longer than 5 min ends the interval"). `hr-support/1`
 * is stricter (a reading holds at most ±30 s and never bridges a gap over min(2c, 60 s)); this is only a guard against an
 * interval the server should never send.
 */
export const HR_INTERVAL_MAX_MS = 5 * 60_000;

/** A raw reading as `hr-intervals` sends it (UTC epoch ms; `start`/`end` null when its cadence is undeclared). */
export interface HrIntervalReading {
  t: number;
  bpm: number;
  nextT?: number | null;
  start: number | null;
  end: number | null;
}

/**
 * The exact supported segments of raw readings: each reading's own interval `[start, end)`, sorted, never overlapping
 * (a later one starts where an earlier one ended), never longer than `HR_INTERVAL_MAX_MS` and never past the next
 * reading. A reading without an interval (undeclared cadence) stands for no time.
 */
export function segmentsFromHrIntervals(readings: readonly HrIntervalReading[]): HrSegment[] {
  const xs = readings
    .filter((r) => isFiniteNum(r.t) && isFiniteNum(r.bpm) && r.bpm > 0 && isFiniteNum(r.start) && isFiniteNum(r.end) && r.end > r.start)
    .slice()
    .sort((a, b) => a.t - b.t);
  const out: HrSegment[] = [];
  let cursor = -Infinity;
  for (const r of xs) {
    const start = Math.max(r.start!, cursor);
    let end = Math.min(r.end!, start + HR_INTERVAL_MAX_MS);
    if (isFiniteNum(r.nextT) && r.nextT > r.t) end = Math.min(end, r.nextT);
    if (!(end > start)) continue;
    cursor = end;
    // one segment per reading (never merged: the filtered peak counts held readings, adjacent segments)
    out.push({ start, end, bpm: r.bpm });
  }
  return out;
}

/**
 * The HR segments a zone figure uses: the exact ones when the readings are there (`exact` not null, even when empty: the
 * server answered and nothing in the window had a declared cadence), else the timeline's minute means.
 */
export function hrSegmentsFor(i: { exact?: readonly HrSegment[] | null; minutes?: { first: Ms; bpm: readonly (number | null)[]; supportedS: readonly (number | null)[] } | null }): { segments: HrSegment[]; source: HrSource } {
  if (i.exact) return { segments: [...i.exact], source: 'samples' };
  return { segments: i.minutes ? segmentsFromTimeline(i.minutes.first, i.minutes.bpm, i.minutes.supportedS) : [], source: 'minuteMeans' };
}

// ------------------------------------------------------------------------- one source-resolved HR contract (r063 FX2)

/**
 * (r063 FX2, final review sR06/aR06) A timeline minute whose supported HR came from another origin than Gauge (the
 * server's `timeline.hr.source`, e.g. `hc:<package>`: Health Connect fills only the minutes Gauge has no reading of). The
 * exact `/hr-intervals` answer holds Gauge's readings only, so it can never stand for such a minute. A minute without a
 * named source (an older server) is Gauge's.
 */
export const isOtherHrSource = (s: unknown): boolean => typeof s === 'string' && s !== '' && s !== 'gauge';

/** The supported ms of sorted, disjoint `segs` inside [a, b) (binary search to the first one that ends after `a`). */
export function segmentsIn(segs: readonly HrSegment[], a: Ms, b: Ms): HrSegment[] {
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (segs[m]!.end <= a) lo = m + 1;
    else hi = m;
  }
  const out: HrSegment[] = [];
  for (let k = lo; k < segs.length && segs[k]!.start < b; k++) {
    const g = segs[k]!;
    const s = Math.max(a, g.start);
    const e = Math.min(b, g.end);
    if (e > s) out.push({ start: s, end: e, bpm: g.bpm });
  }
  return out;
}

/**
 * (r063 FX2) The one rule every HR consumer applies per minute (bout estimates, the day's Heart Points, Ring zones and
 * load): the exact readings stand for a minute when the minute's HR is Gauge's and the exact answer has supported time in
 * it; otherwise the minute's mean does (a Health Connect minute, a minute the exact answer missed, no exact answer at
 * all). So an empty or partial exact answer never erases supported HR, and exact and mean time never count twice.
 */
export const minuteUsesExact = (source: unknown, exactMsInMinute: number): boolean => !isOtherHrSource(source) && exactMsInMinute > 0;

/** A timeline day's minute HR as the resolver reads it (`timeline.hr`, with its per-minute `source`). */
export interface HrMinuteGrid {
  first: Ms;
  bpm: readonly (number | null)[];
  supportedS: readonly (number | null)[];
  source?: readonly (string | null)[] | null;
}

export type ResolvedHrSegment = HrSegment & { from: HrSource };

/**
 * (r063 FX2, sR06/aR06) The source-resolved HR segments of some timeline days: per minute (`minuteUsesExact`), Gauge's
 * exact readings (`exact`, only inside `range`, the span the answer is known to cover) or the timeline's minute mean.
 * Sorted, never overlapping (an exact segment is clipped out of a minute that keeps its mean). `source` is `samples` only
 * when no minute mean was used, else `minuteMeans` (the conservative label for a mixed figure).
 */
export function resolveHrSegments(i: { grids: readonly HrMinuteGrid[]; exact?: readonly HrSegment[] | null; range?: Interval | null }): { segments: ResolvedHrSegment[]; source: HrSource } {
  const means: ResolvedHrSegment[] = [];
  if (!i.exact) {
    for (const g of i.grids) for (const s of segmentsFromTimeline(g.first, g.bpm, g.supportedS)) means.push({ ...s, from: 'minuteMeans' });
    return { segments: means.sort((a, b) => a.start - b.start), source: 'minuteMeans' };
  }
  const r = i.range ?? null;
  const ex = (r ? clipSegments(i.exact, r, []) : [...i.exact].filter((g) => g.end > g.start)).sort((a, b) => a.start - b.start);
  /** Minutes holding exact time that keep their mean (a Health Connect minute): cut out of the exact segments. */
  const cut: Interval[] = [];
  for (const g of i.grids) {
    for (let k = 0; k < g.bpm.length; k++) {
      const ms = g.first + k * 60_000;
      const inMinute = segmentsIn(ex, ms, ms + 60_000).reduce((a, s) => a + (s.end - s.start), 0);
      if (minuteUsesExact(g.source?.[k], inMinute)) continue;
      if (inMinute > 0) cut.push({ start: ms, end: ms + 60_000 });
      const v = g.bpm[k];
      const s = g.supportedS[k];
      if (isFiniteNum(v) && isFiniteNum(s) && s > 0) means.push({ start: ms, end: ms + Math.min(60, s) * 1000, bpm: v, from: 'minuteMeans' });
    }
  }
  const exact: ResolvedHrSegment[] = (cut.length ? clipSegments(ex, { start: -Infinity, end: Infinity }, cut) : ex).map((s) => ({ ...s, from: 'samples' as const }));
  return { segments: [...exact, ...means].sort((a, b) => a.start - b.start), source: means.length > 0 ? 'minuteMeans' : 'samples' };
}
