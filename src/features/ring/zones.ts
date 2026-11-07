/**
 * Heart-rate zones of a recorded workout from V2 (SPEC A.2 #9, §V2.1–2, §V4.7): `hr-zones/1` over S2's supported HR: each
 * raw reading's own interval (`/hr-intervals`, Codex #11) when the server sent them all, else the timeline's minute means
 * (`timeline.hr`), and the figure says which. The boundaries are, in order (Codex UI #2):
 *
 *  1. the ones frozen into the approved session entry (`entry.zones`, written by `activity.approve`/`edit`): a later
 *     profile change never rewrites a recorded session;
 *  2. for a workout nobody decided yet, the person's current HR profile: Settings › Heart rate (HRmax override, a WAKING
 *     resting HR, the D6 sleeping-low opt-in with S2's sleeping low) and the profile age (Tanaka) — the same inputs the
 *     command freezes at approval, so the preview and the booked zones agree.
 *
 * Gauge's own 220 − age zone seconds are never shown as zone time (`legacyZoneText` only). Pure.
 */
import { freezeZoneBoundaries, hrProfile, resolveHrSegments, segmentsFromHrIntervals, segmentsFromTimeline, zoneOf, zoneTime, type HrMinuteGrid, type HrProfile, type HrSegment, type HrSource, type Interval, type ZoneBoundaries, type ZoneTime } from '@/living/sensors';
import type { GaugeHrIntervals } from '@/net/gauge';
import { zoneBpmRange } from '@/features/lib/zoneRange';
import type { SettingsValues } from '@/state/settingsStore';
import type { GaugeTimeline, GaugeWorkout } from './types';

export interface WorkoutZones {
  time: ZoneTime;
  /** Which HR the time came from (Codex #11). */
  source: HrSource;
  boundaries: ZoneBoundaries;
  /** Zone index over time for the strip: 0 under zone 1, 1–5 the zones. */
  spans: Array<{ from: number; to: number; state: number }>;
}

/** Where a workout's boundaries came from: frozen at approval, or the profile now (an undecided workout). */
export interface ZoneSource {
  boundaries: ZoneBoundaries | null;
  frozen: boolean;
  /** The profile behind current boundaries (null for frozen ones: the entry keeps only the boundaries). */
  profile: HrProfile | null;
}

/** Minute segments of the timeline's supported HR. */
export function timelineSegments(t: GaugeTimeline): HrSegment[] {
  const first = t.start ? Date.parse(t.start) : Date.parse(`${t.date}T00:00:00`);
  return segmentsFromTimeline(first, t.hr.bpm, t.hr.supportedS);
}

/** (r063 FX2) A timeline's minute HR with its per-minute source, as the one source-resolved rule reads it. */
export function timelineGrid(t: GaugeTimeline): HrMinuteGrid {
  const first = t.start ? Date.parse(t.start) : Date.parse(`${t.date}T00:00:00`);
  return { first, bpm: t.hr?.bpm ?? [], supportedS: t.hr?.supportedS ?? [], source: Array.isArray(t.hr?.source) ? t.hr.source : null };
}

/**
 * (r063 FX2, final review sR06/aR06) The supported HR of a window from the one source-resolved rule
 * (`resolveHrSegments`): Gauge's exact readings (`exact`, already checked to cover `window`) for the minutes they cover,
 * the timelines' minute means for every other minute (a Health Connect minute, a minute the answer missed). An empty
 * exact answer therefore never erases Health Connect or minute-mean support. Also what `source` the figure may claim.
 */
export function resolvedWindowHr(timelines: readonly GaugeTimeline[], exact: readonly HrSegment[] | null, window: Interval): { segments: HrSegment[]; source: HrSource } {
  const r = resolveHrSegments({ grids: timelines.map(timelineGrid), exact, range: window });
  return { segments: r.segments.map((g) => ({ start: g.start, end: g.end, bpm: g.bpm })), source: r.source };
}

/** `resolvedWindowHr`'s segments alone (day zones, load). */
export const activitySegments = (timelines: readonly GaugeTimeline[], exact: readonly HrSegment[] | null, window: Interval): HrSegment[] => resolvedWindowHr(timelines, exact, window).segments;

/** The person's HR profile now, from the same inputs `activity.approve` freezes (Settings › Heart rate + age + S2's sleeping low). */
export function currentHrProfile(i: { ageY: number | null; hp: Partial<SettingsValues['hrProfile']> | null | undefined; sleepingLowHr: number | null }): HrProfile {
  return hrProfile({
    ageY: i.ageY,
    hrMaxOverride: i.hp?.hrMaxOverride ?? null,
    hrRestOverride: i.hp?.hrRestOverride ?? null,
    sleepingLowHr: i.sleepingLowHr,
    proxySleepLowOptIn: i.hp?.useSleepLowAsRest === true,
  });
}

/** A stored candidate as far as the zone lookup reads it. */
export interface ZoneCandidate {
  refs?: readonly string[];
  status?: string;
  entryId?: string | null;
  compact?: boolean;
}

/**
 * The boundaries frozen into the approved entry of the Gauge session `workoutId`: the candidate that holds the ref
 * `gauge:<id>` and was approved or edited, then its entry's `zones`. Null when no decided entry holds boundaries.
 */
export function frozenBoundariesFor(workoutId: string, candidates: Iterable<ZoneCandidate>, entryZones: (entryId: string) => ZoneBoundaries | null | undefined): ZoneBoundaries | null {
  const ref = `gauge:${workoutId}`;
  for (const c of candidates) {
    // (A14) a compact tombstone keeps its refs, status and entry id: its boundaries still resolve after compaction
    if (!c.refs?.includes(ref)) continue;
    if ((c.status !== 'approved' && c.status !== 'edited') || !c.entryId) continue;
    const z = entryZones(c.entryId);
    if (z && Array.isArray(z.edgesBpm) && z.edgesBpm.length === 6) return z;
  }
  return null;
}

/** Frozen when the session was approved with boundaries, else the current profile's. */
export function zoneSourceOf(frozen: ZoneBoundaries | null, profile: HrProfile): ZoneSource {
  if (frozen) return { boundaries: frozen, frozen: true, profile: null };
  return { boundaries: freezeZoneBoundaries(profile), frozen: false, profile };
}

/**
 * The exact segments of an `/hr-intervals` answer, or null when it cannot stand for the window: no answer, a truncated one,
 * or one that does not cover `[start, end)` (then the minute means are used).
 */
export function exactSegments(r: GaugeHrIntervals | null | undefined, window?: { start: number; end: number }): HrSegment[] | null {
  if (!r || r.truncated || !Array.isArray(r.intervals)) return null;
  if (window && !(Date.parse(r.from) <= window.start && Date.parse(r.to) >= window.end)) return null;
  return segmentsFromHrIntervals(r.intervals);
}

export function workoutZones(w: GaugeWorkout, timelines: readonly GaugeTimeline[], boundaries: ZoneBoundaries | null, exact: readonly HrSegment[] | null = null): WorkoutZones | null {
  if (!boundaries) return null;
  const window = { start: Date.parse(w.start), end: Date.parse(w.end) };
  // (r063 FX2 sR06) exact vs minute means per source and minute, never "any exact answer wins"
  const { segments, source } = resolvedWindowHr(timelines, exact, window);
  const pauses = (w.pauses ?? []).map((p) => ({ start: Date.parse(p.start), end: Date.parse(p.end) }));
  const time = zoneTime({ window, pauses, segments, boundaries, hrSource: source });
  const spans: WorkoutZones['spans'] = [];
  for (const s of segments) {
    if (s.end <= window.start || s.start >= window.end) continue;
    const z = zoneOf(s.bpm, boundaries);
    // above the configured maximum stays on the top step of the strip (the zone rows name it separately)
    const state = Math.min(5, z + 1);
    const from = Math.max(window.start, s.start);
    const to = Math.min(window.end, s.end);
    const prev = spans.at(-1);
    if (prev && prev.state === state && prev.to === from) prev.to = to;
    else spans.push({ from, to, state });
  }
  return { time, source, boundaries, spans };
}

/** "Share of heart-rate reserve (rest 52, max 182 bpm) · set when you approved it" — what the zones are measured against. */
export function zoneBasisText(s: ZoneSource): string {
  const b = s.boundaries;
  if (!b) return '';
  const max = Math.round(b.hrMax);
  const basis = b.basis === 'hrr' && b.hrRest !== null ? `heart-rate reserve (rest ${Math.round(b.hrRest)}, max ${max} bpm)` : `max heart rate ${max} bpm`;
  if (s.frozen) return `${basis} · set when you approved it`;
  const from = s.profile?.hrMax?.source === 'override' ? 'your setting' : 'your age';
  return `${basis} · from ${from}`;
}

/** The strip's state words (index = `spans[].state`). */
export const ZONE_STATES = ['Under zone 1', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5'] as const;

/** "113 to under 131 bpm" for zone `z` (0-based) from the frozen edges; the top zone "162–180 bpm" (A37: Settings' rule). */
export function zoneRange(b: ZoneBoundaries, z: number): string {
  return zoneBpmRange(b, z);
}
