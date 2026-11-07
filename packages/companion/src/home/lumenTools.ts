/**
 * The read-only `gauge_*` MCP tools (docs/SERVER.md "ring app"): what an agent reads from the person's Lumen store
 * (`./lumenStore.ts`) beside the Vitals tools on the same `/mcp`. Times in and out are in the person's time zone; every
 * result names its units, the Lumen installations the data came from and how fresh it is. Nothing here writes.
 */
import { rejected, type JsonSchema, type McpToolDescriptor, type ToolResultEnvelope } from '../toolManifest.ts';
import { avgWorkoutHr, DAY_METRICS_VERSION, idleReadings, nonExerciseHr, peakHr } from './dayMetrics.ts';
import {
  ReadBudgetError, withReadBudget, chargeReadBudget,
  addDays, baselinesFor, FUSE_MAX_WIDEN_MS, fuseRange, hcDailyDistance, hcRestingHr, hcStreams, Inputs, intervalsAll, ringDetailReadAt, metricSamples, ringDaily, samplesAll, sleepBouts, sleepParts, sleepRead, stepEvidence, withMetrics, workoutsOverlapping,
  type Bout, type FusedRange, type Workout,
} from './gaugeDerive.ts';
import { changesSince, FEED_LIMIT, FEED_MAX_LIMIT, parseCursor, parseSubjectRefs, STATE_MAX_REFS, subjectStates } from './changeFeed.ts';
import { contextFor, contextKeyOf, type FusionContextPart, type FusionContextUpdate, type StoredFusionContext } from './fusionContext.ts';
import { HR_SUPPORT_VERSION, median, medianGapS, sampleSupports, supportSegments } from './hrSupport.ts';
import { HC_RECORD_TYPES, instantMs, LumenReadError, READ_MAX_LIMIT, type HcRecordType, type InstallationRow, type LumenStore, type MetricSample } from './lumenStore.ts';
import { SLEEP_METRIC_STATUS, SLEEP_METRICS_VERSION, type SleepMetrics, type Stage } from './sleepMetrics.ts';
import { DEFAULT_PREFERENCE, FUSION_REVISION, FUSION_VERSION, type ActivityKind, type FusionContext, type StepLineage } from './stepFusion.ts';
import { buildTimeline, emptyTimeline } from './timeline.ts';
import { GPS_MOTION_VERSION, gpsSpeedMinutes, sportWindows } from './gpsMotion.ts';
import { DETECT_CONFIG, DETECTOR } from './detect/detect.ts';
import { exerciseTypeOf, normaliseExercisePayload } from './hcExercise.ts';

// ---------------------------------------------------------------------------------------------------------------
// Time in the person's zone

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
const formats = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();

/** The zone's offset at `ms`, uncached. */
function rawOffset(ms: number, tz: string): number {
  let f = formats.get(tz);
  if (!f) formats.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** A UTC hour whose offset changes inside it (a half-hour or odd-minute transition): never cached. */
const MIXED = Number.NaN;

/**
 * Minutes the zone is ahead of UTC at `ms`. Cached per zone and UTC hour only when the offset is the same at both ends
 * of the hour (zones change at most once an hour), so an answer never depends on which instant was asked first.
 */
export function offsetMinutes(ms: number, tz: string): number {
  const hour = Math.floor(ms / HOUR);
  const hourKey = `${tz}|${hour}`;
  const hit = offsets.get(hourKey);
  if (hit !== undefined) return Number.isNaN(hit) ? rawOffset(ms, tz) : hit;
  const a = rawOffset(hour * HOUR, tz);
  const b = rawOffset(hour * HOUR + HOUR - 1000, tz);
  if (offsets.size > 20_000) offsets.clear();
  offsets.set(hourKey, a === b ? a : MIXED);
  return a === b ? a : rawOffset(ms, tz);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** The wall clock at `ms` in `tz`, as a Date whose UTC fields are that wall time. */
const wall = (ms: number, tz: string) => new Date(ms + offsetMinutes(ms, tz) * 60_000);

/** `2026-10-21T07:30:00+05:30`. */
export function isoIn(ms: number, tz: string): string {
  const w = wall(ms, tz);
  const off = offsetMinutes(ms, tz);
  const a = Math.abs(off);
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** `YYYY-MM-DD` of `ms` in `tz`. */
export function localDate(ms: number, tz: string): string {
  return wall(ms, tz).toISOString().slice(0, 10);
}

/** The instant of a wall-clock time in `tz`. */
export function zonedMs(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - offsetMinutes(guess, tz) * 60_000;
  return guess - offsetMinutes(first, tz) * 60_000;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** `[start, end)` of a local date in `tz`, or null for a malformed date. */
export function dayBounds(date: string, tz: string): [number, number] | null {
  const m = DATE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return [zonedMs(y, mo, d, 0, 0, 0, tz), zonedMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, tz)];
}

/** A tool's `from` / `to`: a date (the whole day), a local date-time, or an instant with a zone. */
export function parseWhen(v: unknown, tz: string, edge: 'start' | 'end'): number | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  if (DATE.test(v)) {
    const b = dayBounds(v, tz);
    return b ? (edge === 'start' ? b[0] : b[1] - 1) : null;
  }
  const l = LOCAL.exec(v);
  if (l) return zonedMs(Number(l[1]), Number(l[2]), Number(l[3]), Number(l[4]), Number(l[5]), Number(l[6] ?? 0), tz);
  if (ZONED.test(v)) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** `tz` when it is a time zone this runtime knows (an IANA name, or a fixed offset like `+05:30`), else null. */
export function validZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** The fixed-offset zone of `min` minutes ahead of UTC, e.g. `+05:30`. */
export function offsetZone(min: number): string {
  const a = Math.abs(Math.round(min));
  return `${min < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Ring-derived categories whose events carry `local_offset_min` (§2.1). */
const OFFSET_CATEGORIES = ['activity/buckets', 'activity/daily', 'sleep/timeline', 'activity/session', 'activity/sport_telemetry', 'metrics/hr'] as const;
/** How many of the newest events of each category the offset lookup reads (a bound on its cost). */
const OFFSET_SCAN = 2000;

/** The newest `local_offset_min` observed in `[loMs, hiMs)`, with its instant, or null. */
export function newestOffset(store: LumenStore, loMs: number, hiMs: number): { atMs: number; offsetMin: number } | null {
  let best: { atMs: number; offsetMin: number } | null = null;
  for (const category of OFFSET_CATEGORIES) {
    const r = store.get<{ observed_ms: number; o: unknown }>(
      `SELECT observed_ms, json_extract(data, '$.local_offset_min') AS o FROM (
         SELECT observed_ms, data FROM events WHERE category = ? AND observed_ms >= ? AND observed_ms < ? ORDER BY observed_ms DESC LIMIT ${OFFSET_SCAN}
       ) WHERE o IS NOT NULL ORDER BY observed_ms DESC LIMIT 1`, category, loMs, hiMs);
    const o = r ? num(r.o) : null;
    if (r && o !== null && Math.abs(o) <= 18 * 60 && (!best || r.observed_ms > best.atMs)) best = { atMs: r.observed_ms, offsetMin: o };
  }
  return best;
}

const ZONE_SLACK_MS = 14 * HOUR;

/**
 * The zone a read uses (FIX-CONTRACT F10): the caller's `tz`; else the zone the newest `local_offset_min` in the
 * requested range implies (the person's zone when it has that offset at that instant, else the fixed offset); else the
 * person's zone (itself UTC when the person has none). A tool without a range skips the offset step. The requested
 * range is read in the person's zone, 14 h wider on each side (any zone's offset). Null for a `tz` that is not a zone.
 */
export function zoneFor(store: LumenStore | null, args: Record<string, unknown>, personTz: string): string | null {
  if (args.tz !== undefined && args.tz !== null && args.tz !== '') return validZone(args.tz);
  if (!store) return personTz;
  let span: [number, number] | null = null;
  if (typeof args.date === 'string') span = dayBounds(args.date, personTz);
  else if (args.from !== undefined && args.to !== undefined) {
    const from = parseWhen(args.from, personTz, 'start');
    const to = parseWhen(args.to, personTz, 'end');
    if (from !== null && to !== null && from <= to) span = [from, to + 1];
  }
  if (!span) return personTz;
  const hit = newestOffset(store, span[0] - ZONE_SLACK_MS, span[1] + ZONE_SLACK_MS);
  if (!hit) return personTz;
  return offsetMinutes(hit.atMs, personTz) === hit.offsetMin ? personTz : offsetZone(hit.offsetMin);
}

// ---------------------------------------------------------------------------------------------------------------
// Tool descriptors

const SOURCE_NOTE =
  'Ring and phone data: readings the person\'s phone uploaded from their smart ring or wearable (device estimates, not medical measurements). ' +
  'Vitals combines logs with ring and phone readings: this data is separate from Vitals\' own manual logs, which the person enters by hand (logs, plans, weight); read both and say which source each number comes from. Read-only.';
const RANGE_NOTE = 'Times are in the person\'s time zone: pass a date (YYYY-MM-DD, the whole day) or a date-time (YYYY-MM-DDTHH:mm, or ISO with an offset).';
/** Every gauge_* tool takes `tz`; the result's `tz` names the zone used. */
const TZ_ARG: Record<string, JsonSchema> = {
  tz: { type: 'string', description: 'The time zone for dates, day boundaries and clock times (IANA, e.g. "Asia/Kolkata"). Default: the zone of the newest ring readings in the range, else the person\'s zone. The result\'s tz names the zone used.' },
};

const range = (extra: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties: {
    from: { type: 'string', description: 'Start (inclusive): YYYY-MM-DD or a date-time in the person\'s time zone.' },
    to: { type: 'string', description: 'End (inclusive): YYYY-MM-DD or a date-time in the person\'s time zone.' },
    ...TZ_ARG,
    ...extra,
  },
  required: ['from', 'to', ...required],
  additionalProperties: false,
});

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };

const tool = (name: string, title: string, description: string, inputSchema: JsonSchema, note = SOURCE_NOTE): McpToolDescriptor => ({
  name, title, description: `${description} ${note}`, inputSchema, annotations: { ...READ_ONLY, title },
});

const DATE_ARG = (what: string): JsonSchema => ({
  type: 'object', properties: { date: { type: 'string', description: `YYYY-MM-DD in the person's time zone${what}.` }, ...TZ_ARG }, required: ['date'], additionalProperties: false,
});
const PAGE_ARGS: Record<string, JsonSchema> = {
  cursor: { type: 'string', description: 'The `next` of the previous page (omit for the first page).' },
  limit: { type: 'integer', minimum: 1, maximum: 10000, description: 'Readings per page (default 2000).' },
};

const HR_INTERVALS_MAX_HOURS = 36;
const HR_INTERVALS_LIMIT = 2000;
const HR_INTERVALS_MAX_LIMIT = 5000;
const HR_PAGE_ARGS: Record<string, JsonSchema> = {
  cursor: { type: 'string', description: 'The `next` of the previous page (omit for the first page).' },
  limit: { type: 'integer', minimum: 1, maximum: HR_INTERVALS_MAX_LIMIT, description: `Readings per page (default ${HR_INTERVALS_LIMIT}).` },
};
const WHEN = { type: 'string', description: 'An ISO date-time with an offset (or a local date-time in the zone used).' } as const;
const STEPS_CONTEXT_ARGS: Record<string, JsonSchema> = {
  activities: {
    type: 'array', maxItems: 2000, description: 'Approved activity windows, [start, end), by step behaviour (gait types are locomotor, the rest nonLocomotor).',
    items: {
      type: 'object',
      properties: {
        start: WHEN, end: WHEN, kind: { type: 'string', enum: ['locomotor', 'nonLocomotor', 'unknown'] },
        carry: { type: 'string', enum: ['pocket', 'hand', 'desk'], description: 'Where the phone was during a locomotor bout: pocket selects observed phone steps; hand or desk selects the ring and does not treat the phone\'s missing steps as observed zeros.' },
      },
      required: ['start', 'end', 'kind'], additionalProperties: true,
    },
  },
  corrections: {
    type: 'array', maxItems: 2000, description: 'The person\'s corrections, [start, end): use this lineage there ("ring", "phone" or "hc-other:<origin>").',
    items: { type: 'object', properties: { start: WHEN, end: WHEN, use: { type: 'string' } }, required: ['start', 'end', 'use'], additionalProperties: true },
  },
  preference: {
    type: 'object', description: 'The person\'s step settings (DECISION D1).',
    properties: {
      stepsPreference: { type: 'array', items: { type: 'string', enum: ['ring', 'phone', 'hc-other'] }, minItems: 1, maxItems: 3, description: 'Lineages in order; the rest follow in the default order ring, phone, hc-other, unknown.' },
      soleSustainedGait: { type: 'boolean', description: 'Whether inferred sustained gait and wrist-stall rules apply (default true); explicit carry and corrections still win.' },
    },
    additionalProperties: true,
  },
  bucket: { type: 'string', description: 'Accepted for symmetry with the other range routes; steps has a single shape, so it is ignored.' },
  rolloverH: { type: 'number', minimum: 0, exclusiveMaximum: 24, description: 'The person\'s day rollover (local hour, default midnight): merged intervals also break there, so each lies in one app day.' },
};

export const LUMEN_TOOLS: readonly McpToolDescriptor[] = [
  tool('gauge_data_availability', 'Ring data available', 'What ring and wearable data the server holds: each category with its count, first and last reading and the gauge_* tool that reads it, the metric kinds, the days of short-video counts (habits/short_video, read with gauge_short_video), the number of recorded workouts (activity/session, read with gauge_workouts), and the phone installations (phones) it came from with their last upload. Call this first to see what the other gauge_* tools can return.', { type: 'object', properties: { ...TZ_ARG }, additionalProperties: false }),
  tool('gauge_metric_series', 'Ring metric series', `One metric from the ring or wearable over a time range: raw readings (with id, quality and source, in pages: pass \`next\` as \`cursor\` for the next page), or hourly or daily mean/min/max over every reading. Kinds: hr (heart rate, bpm), spo2 (%), hrv (ms), temp (skin temperature, °C), stress (ring index), fatigue, glucose (mg/dL), resp_rate (breaths/min), vo2max (mL/kg/min), blood_pressure (systolic/diastolic, mmHg), and vendor.<key> estimates. ${RANGE_NOTE}`, range({
    kind: { type: 'string', description: 'Metric kind, e.g. "hr", "spo2", "hrv", "temp", "blood_pressure", "vendor.<key>" (see gauge_data_availability).' },
    bucket: { type: 'string', enum: ['raw', 'hour', 'day'], description: 'raw readings (default, oldest first, a page at a time), or hour / day aggregates in the person\'s time zone.' },
    ...PAGE_ARGS,
  }, ['kind'])),
  tool('gauge_daily_summary', 'Ring day summary', 'One day of ring and wearable data in the person\'s time zone: activity totals (with the fused step headline), the night\'s sleep (the night that ends that morning, with its metrics), on-device legacy scores for the day, per-metric count/mean/min/max/latest/median gap, the ring\'s own step goal, and derived day values: highest heart-rate reading, non-exercise heart rate (sampled; never a resting heart rate) and average workout heart rate.', DATE_ARG('')),
  tool('gauge_sleep', 'Ring sleep', `Sleep sessions the ring classified (minutes of deep, light, REM, awake, and unknown where the ring marked it; noDataMinutes are gaps no ring packet covers), grouped by the day of waking (sleep from 19:00 counts toward the next day), with the stage timeline as blocks; each session is the day's primary sleep or a nap, and a night the ring recorded in parts (wake breaks of an hour to 3 hours between 21:00 and 12:00) is one primary session whose asleep minutes add up, the breaks listed as awakeBreaks (blocks no_data) and counted as awake after sleep onset; each session carries its metrics (sleep-metrics/1): fell asleep and woke (first and last known-asleep minute; the session's start and end are only the ring's recorded window), total sleep as bounds (unknown minutes and gaps are never counted as asleep), window continuity, wake-ups, deep and REM (estimated), sleeping low heart rate, the 5-minute heart-rate trace and its trend, HRV, skin temperature and SpO2. Latency, tosses and turns and respiration rate are not measurable by the ring (null, reason unsupported). ${RANGE_NOTE}`, range()),
  tool('gauge_activity', 'Ring activity', `Daily steps, distance (m), calories (kcal, the ring's own estimate) and active minutes from the ring or wearable (the day's latest total), the fused step headline across the ring and the phone (steps-fuse/1; see gauge_steps), plus the ring's step buckets (per hour when the range is at most 7 days). ${RANGE_NOTE}`, range()),
  tool('gauge_scores', 'On-device scores', `On-device legacy scores and insights derived on the phone (sleep_score, recovery_score, activity_score, hrv_balance, resting_load, vo2max_estimate and others) with value, unit, confidence, algorithm version and inputs; every entry is legacy: Vitals computes its own experimental wellness indices. ${RANGE_NOTE}`, range({
    key: { type: 'string', description: 'Only this insight key (optional).' },
  })),
  tool('gauge_device_state', 'Ring device state', 'The latest state the phone reported per installation: ring battery, connection, device type and capabilities, firmware, whether it is worn, sync stage and the last measurement.', { type: 'object', properties: { ...TZ_ARG }, additionalProperties: false }),
  tool('gauge_short_video', 'Phone short videos', 'The phone\'s count of short-form videos (Reels/Shorts) watched per day — counts only, never content; separate from Vitals\' manual logs. Per day (the phone\'s local date): count per app (instagram, youtube), total, the daily limit the person set, how often the limit was hit and how often they cancelled; plus 7-day and 30-day averages of the days with data ending at `to`.', range(),
    'Phone data, counted by the ring app on the person\'s phone, not by the ring. Vitals combines logs with ring and phone readings: Vitals\' own manual logs are entered by hand; say which source each number comes from. Read-only.'),
  tool('gauge_workouts', 'Phone-recorded workouts', `Workouts the person recorded with the ring app (type such as walk or run, where it came from), one entry per session that overlaps the range, the latest version of each: start, end, pauses, moving time (s), distance (m), calories (kcal, phone estimate with its method), average and max heart rate (bpm), seconds per heart-rate zone (older on-device 220 − age zones), steps, and the GPS route as an encoded polyline with its point count (for maps; no need to decode it); plus totals that count overlapping sessions once. ${RANGE_NOTE}`, range()),
  tool('gauge_steps', 'Fused steps', `Steps fused across the ring, the phone and Health Connect (steps-fuse/1): one source chosen per interval (never the larger, never a sum), each interval with its source, lineage, support, the reason it was chosen and the alternatives; per day the located total, the ring's daily total and its unlocated rest, the headline (at least / located) and coverage minutes. ${RANGE_NOTE} At most 62 days. Without its own context it uses the person's (what Vitals last sent the server). Optional context (what Vitals sends from its approved activities and settings): activities (approved bouts by step behaviour: inside a nonLocomotor one the phone is taken if observed, else the ring flagged nonLocomotorSuspect; a locomotor bout with unknown carry needs sustained gait evidence before phone steps displace a walking ring; explicit pocket or hand/desk carry wins), corrections (the person's "use phone" / "use ring" for an interval) and preference (the lineage order and the inferred-gait switch). Sustained direct phone gait with repeated wrist stalls can win despite complete ring coverage; ordinary disagreement keeps the configured preference and is flagged.`, range(STEPS_CONTEXT_ARGS)),
  tool('gauge_timeline', 'Ring day timeline', 'One local day minute by minute (1440 entries; 1380 or 1500 on a DST change), null where nothing is known: fused steps (with the person\'s approved activities, corrections and step settings) with each minute\'s support (minute or coarse) and each source\'s own, heart rate (time-weighted where a cadence is declared, otherwise the minute\'s sampled mean; the ring\'s first, Health Connect\'s only where the ring has none, each minute naming its source), Health Connect speed and power, which evidence each stream used, sleep stages, recorded workouts and Health Connect exercise, phone acquisition and the ring\'s step coverage, and the day\'s stress readings.', DATE_ARG('')),
  tool('gauge_hr_intervals', 'Ring heart-rate intervals', `Raw heart-rate readings of a bounded window (at most ${HR_INTERVALS_MAX_HOURS} hours), oldest first and in pages (pass \`next\` as \`cursor\`): each reading's time t, bpm, declared cadence (s; null when undeclared), the next reading's time and its hr-support/1 supported interval [start, end) (null when the cadence is undeclared: such a reading stands for no time). Supports are clipped at the midpoints to the neighbouring readings, at workout and pause edges and at the window, so they never overlap and a gap over min(2 × cadence, 60 s) is never bridged. Times are UTC epoch milliseconds. For exact time in heart-rate zones; gauge_timeline has the minute means. ${RANGE_NOTE}`, range(HR_PAGE_ARGS)),
  tool('gauge_baselines', 'Ring baselines', 'Personal baselines for a waking date from the 28 nights before it (that night excluded): usual sleep onset, wake and midpoint (circular means), sleeping low heart rate, HRV (on ln scale), skin temperature (and tonight\'s difference), each with its night count and span, the learning state (night n of 7), and the sampled non-exercise heart rate. Not scores.', DATE_ARG(' (the waking date)')),
  tool('gauge_hc', 'Phone Health Connect records', `Health Connect records ring app read on the phone, by type (Steps, Distance, Speed, Power, HeartRate, ExerciseSession, ActiveCaloriesBurned, TotalCaloriesBurned, BasalMetabolicRate, Weight, RestingHeartRate, SleepSession): the latest revision of each, minus deletions, with its origin app, device and lineage (phone, hc-other:<origin>, unknown); plus \`deleted\`: the records of that type in the range that were deleted in Health Connect (id, start, end, deletedAt), so data imported from them can be withdrawn. ring app's own exports are never included. In pages. ${RANGE_NOTE}`, range({
    type: { type: 'string', description: 'The Health Connect record type, e.g. "Steps" or "ExerciseSession".' },
    ...PAGE_ARGS,
  }, ['type'])),
  tool('gauge_detections', 'Detected activities', `Activities the server detected automatically (${DETECTOR}) from the phone's steps, the ring's steps, heart rate, sleep, Android activity recognition and workout GPS: each episode with a stable id and revision, its window and moving intervals (ISO UTC), state (open while it may still be going on, final, or withdrawn when the evidence no longer supports it), a label (walk, walk_possibly_treadmill, treadmill_walk, run, treadmill_run, cycling, possible_cycling, possible_workout, possible_strength) with alternatives, separate existence and type scores (0–0.95, ranking heuristics, not probabilities) and their level, reason codes, sensor coverage, an evidence hash and overlapping recordings. Detections are suggestions: nothing is logged until the person approves one in Vitals. Follow changes with since (the cursor of a previous answer; withdrawn lists the ids withdrawn since); from/to limit to episodes overlapping that range. In pages (more true: ask again with the new cursor).`, {
    type: 'object', properties: {
      since: { type: 'string', description: 'The cursor of a previous answer: only episodes written after it.' },
      from: { type: 'string', description: 'Only episodes overlapping from..to (a date or a date-time in the person\'s time zone).' },
      to: { type: 'string', description: 'See from.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Episodes per page (default 200).' },
      ...TZ_ARG,
    }, additionalProperties: false,
  }),
  tool('gauge_changes', 'Imported-data changes', `What changed upstream in the data Vitals imports (phone-recorded workouts, Health Connect exercise sessions and weights) after a cursor: each touched record's state now, revised (its latest start, end and revision time) or deleted (with when), and the cursor to pass next. A large deletion is listed across pages too. Without since it answers the current cursor and resync true (check what was imported with gauge_changes_state, then follow the feed); resync true later (a restored store) means the same. In pages (more true: ask again with the new cursor).`, {
    type: 'object',
    properties: {
      since: { type: 'string', description: 'The cursor of the previous answer (omit for the current cursor).' },
      limit: { type: 'integer', minimum: 1, maximum: FEED_MAX_LIMIT, description: `At most this many records touched per page (default ${FEED_LIMIT}).` },
      ...TZ_ARG,
    },
    additionalProperties: false,
  }),
  tool('gauge_changes_state', 'Imported-record state', `The state now of up to ${STATE_MAX_REFS} records Vitals imported (phone-recorded workouts, Health Connect exercise sessions and weights), named as kind:id (workout, hcExercise, hcWeight) and comma-separated: present (with its revision time), deleted upstream (with when, if known), or unknown (the server holds nothing of it; never a deletion). After resync true, Vitals pages its imported records through this before following the feed again.`, {
    type: 'object',
    properties: {
      refs: { type: 'string', description: `Up to ${STATE_MAX_REFS} records as kind:id, comma-separated (e.g. "workout:abc,hcWeight:def").` },
      ...TZ_ARG,
    },
    required: ['refs'],
    additionalProperties: false,
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Results

const METRIC_UNITS: Record<string, string> = {
  hr: 'bpm', spo2: '%', hrv: 'ms', temp: '°C', glucose: 'mg/dL', resp_rate: 'breaths/min', vo2max: 'mL/kg/min', bp_sys: 'mmHg', bp_dia: 'mmHg', blood_pressure: 'mmHg',
  stress: 'index (device scale)', fatigue: 'index (device scale)',
};
const unitOf = (kind: string, unit: unknown) => (typeof unit === 'string' && unit ? unit : METRIC_UNITS[kind] ?? null);
const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MAX_SPAN_DAYS = 400;
const RAW_LIMIT = 2000;

interface Ctx {
  store: LumenStore | null;
  tz: string;
  now: number;
  /** (r063 S6) The person's stored fusion context (`./fusionContext.ts`): every fused read resolves it. */
  fusion: StoredFusionContext | null;
}

/** The part of the person's stored fusion context a fused read of `fromDate`..`toDate` uses (its widened read included). */
function storedContext(c: Ctx, fromDate: string, toDate: string): FusionContextPart {
  const a = dayBounds(fromDate, c.tz);
  const b = dayBounds(toDate, c.tz);
  return a && b ? contextFor(c.fusion, a[0] - FUSE_MAX_WIDEN_MS, b[1] + FUSE_MAX_WIDEN_MS) : {};
}
/** The `inputsHash` version entry naming the context a result used (none without one). */
const contextVersion = (ctx: { contextKey?: string }) => (ctx.contextKey ? [`context:${ctx.contextKey}`] : []);

/** The installations a result drew on (all of them when it names none), and how fresh the data is. */
function provenance(c: Ctx, installationIds: Iterable<string> | null, lastObservedMs: number | null) {
  const all = c.store?.installations() ?? [];
  const ids = installationIds ? new Set(installationIds) : null;
  const used = all.filter((i) => !ids || ids.has(i.id));
  const lastIngest = used.map((i) => i.lastIngestAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const ingestMs = lastIngest ? Date.parse(lastIngest) : null;
  return {
    source: 'lumen_health' as const,
    timeZone: c.tz,
    installations: used.map((i: InstallationRow) => ({ id: i.id, deviceName: i.deviceName, appVersion: i.appVersion, app: i.app, status: i.status, supersededBy: i.supersededBy, lastUploadAt: i.lastIngestAt ? isoIn(Date.parse(i.lastIngestAt), c.tz) : null })),
    freshness: {
      lastUploadAt: ingestMs !== null ? isoIn(ingestMs, c.tz) : null,
      lastReadingAt: lastObservedMs !== null ? isoIn(lastObservedMs, c.tz) : null,
      minutesSinceLastUpload: ingestMs !== null ? Math.max(0, Math.round((c.now - ingestMs) / 60_000)) : null,
      minutesSinceLastReading: lastObservedMs !== null ? Math.max(0, Math.round((c.now - lastObservedMs) / 60_000)) : null,
    },
  };
}

const ok = (summary: string, data: unknown): ToolResultEnvelope => ({ ok: true, status: 'applied', summary, data });
const NO_DATA = 'No ring data on this server yet. The person pairs the old ring app with the server (a pairing code from `vitals-server pair-code`), then ring app uploads its readings.';

function rangeOf(args: Record<string, unknown>, tz: string): { from: number; to: number } | string {
  const from = parseWhen(args.from, tz, 'start');
  const to = parseWhen(args.to, tz, 'end');
  if (from === null || to === null) return 'Give from and to as YYYY-MM-DD or a date-time (YYYY-MM-DDTHH:mm) in the person\'s time zone.';
  if (from > to) return 'from must not be after to.';
  if (to - from > MAX_SPAN_DAYS * DAY) return `The range may span at most ${MAX_SPAN_DAYS} days.`;
  return { from, to };
}

const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

// --- metrics

const kindOf = (category: string) => (category.startsWith('vendor/') ? `vendor.${category.slice(7)}` : category.slice(8));
const isMetricCategory = (category: string) => category.startsWith('metrics/') || category.startsWith('vendor/');

/**
 * The metric kinds with a visible reading: the distinct categories walked through the (category, …) index one seek at a
 * time (a loose index scan: a few dozen seeks, never a scan of every row).
 */
function metricKinds(store: LumenStore): string[] {
  const cats = store.all<{ category: string }>(`WITH RECURSIVE c(category) AS (
      SELECT MIN(category) FROM event_state WHERE category >= 'metrics/'
      UNION ALL SELECT (SELECT MIN(category) FROM event_state WHERE category > c.category) FROM c WHERE c.category IS NOT NULL
    ) SELECT category FROM c WHERE category IS NOT NULL AND ((category >= 'metrics/' AND category < 'metrics0') OR (category >= 'vendor/' AND category < 'vendor0'))
      AND EXISTS (SELECT 1 FROM event_state s WHERE s.category = c.category AND s.hidden = 0) ORDER BY category`);
  return cats.map((c) => kindOf(c.category));
}

type Stats = { count: number; mean: number; min: number; max: number };
function stats(xs: number[]): Stats | null {
  if (!xs.length) return null;
  let sum = 0, min = Infinity, max = -Infinity;
  for (const x of xs) {
    sum += x;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { count: xs.length, mean: r1(sum / xs.length), min: r1(min), max: r1(max) };
}

/** `cursor` / `limit` of a paged tool, or a rejection message. */
function pageOf(args: Record<string, unknown>): { cursor: string | null; limit: number } | string {
  const cursor = args.cursor === undefined || args.cursor === null || args.cursor === '' ? null : args.cursor;
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length > 512)) return 'cursor is the `next` of the previous page.';
  const raw = args.limit === undefined || args.limit === null || args.limit === '' ? RAW_LIMIT : typeof args.limit === 'string' ? Number(args.limit) : args.limit;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > READ_MAX_LIMIT) return `limit is a whole number from 1 to ${READ_MAX_LIMIT}.`;
  return { cursor, limit: raw };
}

function metricSeries(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const kind = typeof args.kind === 'string' ? args.kind.trim() : '';
  if (!kind || kind.length > 128) return rejected('invalid_input', 'Name the metric kind, e.g. "hr" (gauge_data_availability lists them).');
  const bucket = args.bucket ?? 'raw';
  if (bucket !== 'raw' && bucket !== 'hour' && bucket !== 'day') return rejected('invalid_input', 'bucket is "raw", "hour" or "day".');
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  const pg = pageOf(args);
  if (typeof pg === 'string') return rejected('invalid_input', pg);
  if (bucket !== 'raw' && pg.cursor) return rejected('invalid_input', 'cursor pages raw readings only; hour and day aggregates read every reading.');
  if (!c.store) return ok(NO_DATA, { kind, bucket, from: isoIn(r.from, c.tz), to: isoIn(r.to, c.tz), unit: unitOf(kind, null), points: [], next: null, ...provenance(c, [], null) });
  const store = c.store;
  let rows: MetricSample[];
  let next: string | null = null;
  try {
    if (bucket === 'raw') {
      const p = store.readMetricSamples(kind, r.from, r.to + 1, { cursor: pg.cursor, limit: pg.limit });
      rows = p.rows;
      next = p.next;
    } else rows = samplesAll(store, kind, r.from, r.to + 1);
  } catch (e) {
    if (e instanceof LumenReadError) return rejected('invalid_input', e.code === 'invalid_cursor' ? 'cursor is the `next` of the previous page of this same query.' : e.message);
    throw e;
  }
  const unit = unitOf(kind, rows.find((x) => x.unit)?.unit);
  const installs = new Set(rows.map((x) => x.installationId));
  const many = installs.size > 1;
  const isBp = kind === 'blood_pressure';
  let points: unknown[];
  if (bucket === 'raw') {
    points = rows.map((x) => ({
      at: isoIn(x.tMs, c.tz),
      ...(isBp ? { systolic: x.systolic, diastolic: x.diastolic } : { value: x.value }),
      provenance: x.provenance,
      id: x.id, quality: x.quality, source: x.source,
      ...(many ? { installationId: x.installationId } : {}),
    }));
  } else {
    const groups = new Map<string, { start: number; values: number[]; sys: number[]; dia: number[] }>();
    for (const x of rows) {
      const w = wall(x.tMs, c.tz);
      const key = bucket === 'day' ? w.toISOString().slice(0, 10) : w.toISOString().slice(0, 13);
      let g = groups.get(key);
      if (!g) {
        const start = bucket === 'day'
          ? dayBounds(key, c.tz)![0]
          : zonedMs(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), 0, 0, c.tz);
        groups.set(key, (g = { start, values: [], sys: [], dia: [] }));
      }
      if (isBp) {
        if (num(x.systolic) !== null) g.sys.push(x.systolic!);
        if (num(x.diastolic) !== null) g.dia.push(x.diastolic!);
      } else if (num(x.value) !== null) g.values.push(x.value!);
    }
    points = [...groups.entries()].map(([key, g]) => ({
      ...(bucket === 'day' ? { date: key } : {}),
      start: isoIn(g.start, c.tz),
      ...(isBp ? { systolic: stats(g.sys), diastolic: stats(g.dia) } : stats(g.values) ?? { count: 0 }),
    }));
  }
  const truncated = next !== null;
  const data = {
    kind, bucket, unit, from: isoIn(r.from, c.tz), to: isoIn(r.to, c.tz), count: rows.length, truncated, next,
    ...(truncated ? { note: `More readings: pass next as cursor for the next ${pg.limit} (oldest first).` } : {}),
    ...(rows.length === 0 && !pg.cursor ? { availableKinds: metricKinds(store) } : {}),
    points,
    ...provenance(c, installs, rows.length ? rows.at(-1)!.tMs : null),
  };
  return ok(rows.length ? `${rows.length} ring app ${kind} readings (${unit ?? 'no unit'}) from ${data.from} to ${data.to}${bucket === 'raw' ? '' : `, by ${bucket}`}${truncated ? ' (more on the next page)' : ''}.` : `No ring app ${kind} readings from ${data.from} to ${data.to}.`, data);
}

// --- sleep

/** One bout as `gauge_sleep` shows it (the legacy fields kept: `inBedMinutes` for one release, `efficiencyPercent`). */
function publicBout(b: Bout, tz: string) {
  const counts: Record<string, number> = { deep: 0, light: 0, rem: 0, awake: 0, unknown: 0 };
  let noData = 0;
  const blocks: Array<{ start: string; end: string; stage: string; minutes: number }> = [];
  let blockStart = b.startMs;
  b.stages.forEach((st, i) => {
    const stage = st ?? 'no_data';
    if (st === null) noData++;
    else counts[st] = (counts[st] ?? 0) + 1;
    const last = blocks.at(-1);
    if (last && last.stage === stage) last.minutes++;
    else {
      blockStart = b.startMs + i * MINUTE;
      blocks.push({ start: String(blockStart), end: '', stage, minutes: 1 });
    }
  });
  for (const x of blocks) {
    const s = Number(x.start);
    x.start = isoIn(s, tz);
    x.end = isoIn(s + x.minutes * MINUTE, tz);
  }
  const window = Math.round((b.endMs - b.startMs) / MINUTE);
  // (0.6.3 FX5) Health Connect's "sleeping" minutes are asleep, their stage not named (only such a night has them)
  const asleep = counts.deep! + counts.light! + counts.rem! + (counts.asleepUnspecified ?? 0);
  const recorded = window - noData;
  return {
    // (0.6.3 FX5) where the night came from: the ring, or Health Connect (one origin) for a night the ring missed
    source: b.source ?? 'ring', ...(b.source === 'healthConnect' ? { origin: b.origin ?? null, sourceLabel: 'from Health Connect' } : {}),
    wakingDate: b.wakingDate, start: isoIn(b.startMs, tz), end: isoIn(b.endMs, tz), recordedWindowMinutes: window, inBedMinutes: window, asleepMinutes: asleep, minutes: counts, noDataMinutes: noData,
    efficiencyPercent: recorded ? Math.round((asleep / recorded) * 100) : null, kind: b.primary ? 'primary' as const : 'nap' as const, blocks,
    // (r071) a night in parts: the wake breaks between them (blocks `no_data`; they count as awake after sleep onset)
    ...(b.breaks?.length ? { awakeBreaks: b.breaks.map((x) => ({ start: isoIn(x.startMs, tz), end: isoIn(x.endMs, tz), minutes: Math.round((x.endMs - x.startMs) / MINUTE) })) } : {}),
    ...(b.metrics ? { metrics: publicMetrics(b.metrics, tz) } : {}),
  };
}

function publicMetrics(m: SleepMetrics, tz: string) {
  const { onsetMs, finalWakeMs, midpointMs, trace5min, ...rest } = m;
  const at = (ms: number | null) => (ms === null ? null : isoIn(ms, tz));
  return { ...rest, onset: at(onsetMs), finalWake: at(finalWakeMs), midpoint: at(midpointMs), trace5min: trace5min.map((b) => ({ start: isoIn(b.startMs, tz), bpm: b.bpm, n: b.n })), statuses: SLEEP_METRIC_STATUS };
}

/** The `gauge_sleep` sessions of the waking days `fromDate`..`toDate`, without metrics (`vitals-server gauge dedupe` prints them). */
export function sleepNights(store: LumenStore, tz: string, fromDate: string, toDate: string) {
  return sleepBouts(store, tz, fromDate, toDate, new Inputs()).map((b) => publicBout(b, tz));
}

const SLEEP_UNITS = {
  minutes: 'min', noDataMinutes: 'min', recordedWindowMinutes: 'min (the ring\'s recorded window, not time in bed)', inBedMinutes: 'min (deprecated: recordedWindowMinutes)',
  efficiencyPercent: '% of the recorded window asleep (legacy; never shown: use metrics.windowContinuityPct)',
  metrics: 'sleep-metrics/1: min, bpm, ms, °C, %; onset, finalWake and midpoint in the person\'s time zone',
};

function sleep(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  const fromDate = localDate(r.from, c.tz);
  const toDate = localDate(r.to, c.tz);
  const versions = [SLEEP_METRICS_VERSION, HR_SUPPORT_VERSION];
  if (!c.store) return ok(NO_DATA, { from: fromDate, to: toDate, units: SLEEP_UNITS, sessions: [], ...provenance(c, [], null) });
  const inputs = new Inputs();
  const bouts = withMetrics(c.store, sleepBouts(c.store, c.tz, fromDate, toDate, inputs), inputs);
  const installs = new Set(bouts.flatMap((b) => [...b.installs]));
  const data = { from: fromDate, to: toDate, units: SLEEP_UNITS, sessions: bouts.map((b) => publicBout(b, c.tz)), metricsVersion: SLEEP_METRICS_VERSION, inputsHash: inputs.hash(versions), ...provenance(c, installs, bouts.length ? bouts.at(-1)!.endMs : null) };
  return ok(bouts.length ? `${bouts.length} Ring sleep sessions for waking days ${fromDate} to ${toDate}.` : `No Ring sleep from ${fromDate} to ${toDate}.`, data);
}

// --- activity

/** Ranges up to this many days carry the fused headline (P: fusion reads every minute of the range). */
const FUSE_MAX_DAYS = 92;

function activityData(c: Ctx, from: number, to: number, inputs: Inputs) {
  const store = c.store!;
  const fromDate = localDate(from, c.tz);
  const toDate = localDate(to, c.tz);
  const fctx = storedContext(c, fromDate, toDate);
  const fused = toDate <= addDays(fromDate, FUSE_MAX_DAYS - 1) ? fuseRange(store, c.tz, fromDate, toDate, inputs, fctx) : null;
  const evidence = fused?.evidence ?? stepEvidence(store, from, to + 1, inputs);
  const daily = ringDaily(store, from, to + 1, c.tz, inputs);
  type Day = { date: string; steps: number | null; distanceM: number | null; caloriesKcal: number | null; activeMinutes: number | null; bucketSteps: number | null; bucketDistanceM: number | null; lastUpdateMs: number };
  const days = new Map<string, Day>();
  const dayOf = (date: string, ms: number) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = { date, steps: null, distanceM: null, caloriesKcal: null, activeMinutes: null, bucketSteps: null, bucketDistanceM: null, lastUpdateMs: ms }));
    d.lastUpdateMs = Math.max(d.lastUpdateMs, ms);
    return d;
  };
  // the ring's daily totals: the latest revision of the day (it only climbs through the day; a correction can lower it)
  const dailyRows = store.all<{ id: string; installation_id: string; observed_ms: number }>('SELECT id, installation_id, observed_ms FROM daily_activity WHERE observed_ms >= ? AND observed_ms <= ?', from, to);
  chargeReadBudget(dailyRows.length);
  for (const r of dailyRows) dayOf(localDate(r.observed_ms, c.tz), r.observed_ms);
  for (const row of daily.values()) {
    const d = dayOf(row.date, row.observedMs);
    Object.assign(d, { steps: row.steps, distanceM: row.distanceM, caloriesKcal: row.caloriesKcal, activeMinutes: row.activeMinutes });
  }
  // the ring's buckets: native minute detail, and legacy rows where no native detail covers them
  const buckets = evidence.ringBuckets.filter((b) => b.startMs >= from && b.startMs <= to);
  const hours = new Map<number, { steps: number; distanceM: number }>();
  for (const b of buckets) {
    const d = dayOf(localDate(b.startMs, c.tz), b.startMs);
    d.bucketSteps = (d.bucketSteps ?? 0) + b.steps;
    d.bucketDistanceM = (d.bucketDistanceM ?? 0) + b.distanceM;
    const w = wall(b.startMs, c.tz);
    const h = zonedMs(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), 0, 0, c.tz);
    const cur = hours.get(h) ?? { steps: 0, distanceM: 0 };
    cur.steps += b.steps;
    cur.distanceM += b.distanceM;
    hours.set(h, cur);
  }
  const fusedByDate = new Map((fused?.days ?? []).map((d) => [d.date, d]));
  for (const f of fusedByDate.values()) if (f.located !== null && !days.has(f.date)) dayOf(f.date, Math.min(to, dayBounds(f.date, c.tz)![1] - 1));
  // (0.6.3 FX5) a day the ring gave no distance for takes Health Connect's (one origin, labelled); never both
  const allDates: string[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) allDates.push(d);
  const missing = new Set(allDates.filter((d) => (days.get(d)?.distanceM ?? null) === null));
  const hcDist = hcDailyDistance(store, c.tz, from, to + 1, missing, inputs);
  for (const h of hcDist.values()) if (!days.has(h.date)) dayOf(h.date, Math.max(from, Math.min(to, dayBounds(h.date, c.tz)![1] - 1)));
  // (r068) a day's "Updated" is when its steps were last read from the ring, not the start of its last minute with steps
  for (const [date, ms] of ringDetailReadAt(store, inputs, from, to, c.tz)) {
    const d = days.get(date);
    if (d) d.lastUpdateMs = Math.max(d.lastUpdateMs, ms);
  }
  const installs = new Set([...dailyRows.map((x) => x.installation_id), ...buckets.map((x) => x.installationId)]);
  const last = maxOf([...dailyRows.map((x) => x.observed_ms), ...buckets.map((x) => x.startMs)]);
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(({ lastUpdateMs, distanceM, bucketDistanceM, caloriesKcal, ...d }) => {
    const f = fusedByDate.get(d.date);
    const hc = distanceM === null ? hcDist.get(d.date) : undefined;
    return {
      ...d, distanceM: distanceM === null ? (hc ? Math.round(hc.m) : null) : Math.round(distanceM), caloriesKcal: caloriesKcal === null ? null : Math.round(caloriesKcal),
      // the ring's distance carries no mark (as before); Health Connect's says so
      ...(hc ? { distanceSource: 'healthConnect' as const, distanceOrigin: hc.origin, distanceLabel: 'from Health Connect' } : {}),
      bucketDistanceM: bucketDistanceM === null ? null : Math.round(bucketDistanceM), lastUpdate: isoIn(lastUpdateMs, c.tz),
      fusedHeadline: f?.headline ?? null, fusedHeadlinePolicy: f ? f.headlinePolicy : null, fusedLocated: f?.located ?? null, fusionVersion: FUSION_VERSION,
    };
  });
  const hourly = [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({ start: isoIn(h, c.tz), steps: v.steps, distanceM: Math.round(v.distanceM) }));
  return { days: list, hourly, installs, last, fused, context: fused ? contextVersion(fctx) : [] };
}

const ACTIVITY_UNITS = {
  steps: 'steps (the ring\'s daily total, its latest revision)', distanceM: 'm', distanceSource: 'healthConnect (one origin, distanceOrigin) on a day the ring has no distance; absent: the ring\'s', caloriesKcal: 'kcal, Phone estimate (method: the ring vendor\'s daily total; energy basis not stated by the device)',
  activeMinutes: 'min', bucketSteps: 'steps (sum of the ring\'s history buckets)', bucketDistanceM: 'm',
  fusedHeadline: 'steps (steps-fuse/1 headline: at least, or located when the ring\'s detail is complete)', fusedLocated: 'steps placed in time (steps-fuse/1)',
};

function activity(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  const base = { from: isoIn(r.from, c.tz), to: isoIn(r.to, c.tz), units: ACTIVITY_UNITS, fusionVersion: FUSION_VERSION };
  if (!c.store) return ok(NO_DATA, { ...base, days: [], ...provenance(c, [], null) });
  const inputs = new Inputs();
  const a = activityData(c, r.from, r.to, inputs);
  const data = { ...base, days: a.days, ...(r.to - r.from <= 7 * DAY ? { hourly: a.hourly } : {}), inputsHash: inputs.hash([FUSION_VERSION, FUSION_REVISION, ...a.context]), ...provenance(c, a.installs, a.last) };
  return ok(a.days.length ? `Ring activity for ${a.days.length} days from ${base.from} to ${base.to}.` : `No Ring activity from ${base.from} to ${base.to}.`, data);
}

// --- scores

interface InsightRow { installation_id: string; key: string; observed_ms: number; value: number | null; unit: string | null; confidence: string | null; algorithm_version: string | null; note: string | null; inputs: string | null }

function insightRows(c: Ctx, from: number, to: number, key?: string) {
  const sql = 'SELECT installation_id, key, observed_ms, value, unit, confidence, algorithm_version, note, inputs FROM insights WHERE observed_ms >= ? AND observed_ms <= ?';
  return key ? c.store!.all<InsightRow>(`${sql} AND key = ? ORDER BY observed_ms`, from, to, key) : c.store!.all<InsightRow>(`${sql} ORDER BY key, observed_ms`, from, to);
}

const parseJson = (text: string | null): unknown => {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
};

const LEGACY_SCORES_NOTE = 'on-device legacy scores, computed on the phone. Vitals computes its experimental wellness indices itself; label these "On-device (legacy)".';

const scoreOut = (c: Ctx, r: InsightRow) => {
  const inputs = parseJson(r.inputs);
  return { date: localDate(r.observed_ms, c.tz), scopeStart: isoIn(r.observed_ms, c.tz), value: r.value, unit: r.unit, confidence: r.confidence, algorithmVersion: r.algorithm_version, note: r.note, inputs, legacy: true as const };
};

function scores(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  if (args.key !== undefined && (typeof args.key !== 'string' || args.key.length > 128)) return rejected('invalid_input', 'key is an insight name such as "sleep_score".');
  const base = { from: isoIn(r.from, c.tz), to: isoIn(r.to, c.tz), units: { value: 'see each entry\'s unit ("score" is 0–100)' }, legacy: true as const, note: LEGACY_SCORES_NOTE };
  if (!c.store) return ok(NO_DATA, { ...base, scores: {}, ...provenance(c, [], null) });
  const rows = insightRows(c, r.from, r.to, args.key as string | undefined);
  const byKey: Record<string, unknown[]> = {};
  for (const row of rows) (byKey[row.key] ??= []).push(scoreOut(c, row));
  const data = { ...base, scores: byKey, ...provenance(c, new Set(rows.map((x) => x.installation_id)), maxOf(rows.map((x) => x.observed_ms))) };
  return ok(rows.length ? `${rows.length} On-device scores (${Object.keys(byKey).join(', ')}) from ${base.from} to ${base.to}.` : `No On-device scores from ${base.from} to ${base.to}.`, data);
}

// --- device state

function deviceState(c: Ctx): ToolResultEnvelope {
  if (!c.store) return ok(NO_DATA, { devices: [], ...provenance(c, [], null) });
  const rows = c.store.all<{ installation_id: string; category: string; type: string; observed_ms: number; data: string }>('SELECT installation_id, category, type, observed_ms, data FROM device_state ORDER BY installation_id, category');
  const roster = new Map(c.store.installations().map((i) => [i.id, i]));
  const byInstall = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const d = parseJson(r.data);
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    const { schema_version: _v, observed_at: _o, received_at: _r, ...rest } = d as Record<string, unknown>;
    const state = byInstall.get(r.installation_id) ?? {};
    state[r.category.slice('state/'.length)] = { ...rest, event: r.type, at: isoIn(r.observed_ms, c.tz) };
    byInstall.set(r.installation_id, state);
  }
  const devices = [...byInstall.entries()].map(([id, state]) => {
    const i = roster.get(id);
    return { installationId: id, deviceName: i?.deviceName ?? null, app: i?.app ?? 'gauge', status: i?.status ?? 'active', supersededBy: i?.supersededBy ?? null, state };
  });
  const data = { units: { 'battery.percent': '%' }, devices, ...provenance(c, byInstall.keys(), maxOf(rows.map((x) => x.observed_ms))) };
  return ok(devices.length ? `Latest Ring device state for ${devices.length} installation${devices.length === 1 ? '' : 's'}.` : 'ring app has reported no device state yet.', data);
}

// --- short videos

interface ShortVideoRow { installation_id: string; date: string; observed_ms: number; counts: string | null; daily_limit: number | null; limit_hits: number | null; cancels: number | null }

function shortVideoDay(r: ShortVideoRow) {
  const raw = parseJson(r.counts);
  const counts: Record<string, number> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (num(v) !== null) counts[k] = v as number;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { date: r.date, counts, total, limit: num(r.daily_limit), limitHits: num(r.limit_hits), cancels: num(r.cancels) };
}

type ShortVideoDay = ReturnType<typeof shortVideoDay>;

/** The mean per day of the days with data in the `days` days ending at `to`. */
function shortVideoAverage(days: ShortVideoDay[], to: string, n: number) {
  const from = addDays(to, -(n - 1));
  const xs = days.filter((d) => d.date >= from && d.date <= to);
  const apps = [...new Set(xs.flatMap((d) => Object.keys(d.counts)))].sort();
  const avg = (f: (d: ShortVideoDay) => number) => (xs.length ? r1(xs.reduce((a, d) => a + f(d), 0) / xs.length) : null);
  return {
    from, to, daysWithData: xs.length, total: avg((d) => d.total),
    counts: Object.fromEntries(apps.map((a) => [a, avg((d) => d.counts[a] ?? 0)])),
    limitHits: avg((d) => d.limitHits ?? 0), cancels: avg((d) => d.cancels ?? 0),
  };
}

function shortVideo(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  const fromDate = localDate(r.from, c.tz);
  const toDate = localDate(r.to, c.tz);
  const base = { from: fromDate, to: toDate, units: { counts: 'videos per day', limit: 'videos per day', limitHits: 'times per day', cancels: 'times per day', averages: 'mean per day of the days with data' } };
  const empty = { days: [], averages: { last7Days: shortVideoAverage([], toDate, 7), last30Days: shortVideoAverage([], toDate, 30) } };
  if (!c.store) return ok(NO_DATA, { ...base, ...empty, ...provenance(c, [], null) });
  const lo = addDays(toDate, -29) < fromDate ? addDays(toDate, -29) : fromDate;
  const rows = c.store.all<ShortVideoRow>('SELECT installation_id, date, observed_ms, counts, daily_limit, limit_hits, cancels FROM short_video_days WHERE date >= ? AND date <= ? ORDER BY date', lo, toDate);
  const all = rows.map(shortVideoDay);
  const shown = rows.filter((x) => x.date >= fromDate);
  const days = all.filter((d) => d.date >= fromDate);
  const data = {
    ...base, days,
    averages: { last7Days: shortVideoAverage(all, toDate, 7), last30Days: shortVideoAverage(all, toDate, 30) },
    ...provenance(c, new Set(shown.map((x) => x.installation_id)), maxOf(shown.map((x) => x.observed_ms))),
  };
  return ok(days.length ? `Phone short-video counts for ${days.length} day${days.length === 1 ? '' : 's'} from ${fromDate} to ${toDate}.` : `No Phone short-video counts from ${fromDate} to ${toDate}.`, data);
}

// --- workouts

const WORKOUT_UNITS = {
  durationS: 's (moving time)', distanceM: 'm', kcal: 'kcal, Phone estimate (method: each session\'s kcalMethod; energy basis: energyBasis)', avgHr: 'bpm', maxHr: 'bpm',
  zones: 's per heart-rate zone (the old on-device 220 − age zones, zonesVersion)', steps: 'steps', movingS: 's',
};
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function workoutOut(c: Ctx, w: Workout, many: boolean) {
  const d = w.data;
  const route = d.route && typeof d.route === 'object' ? (d.route as { polyline: string; points: number }) : null;
  const pauses = Array.isArray(d.pauses) ? d.pauses.flatMap((p) => {
    const a = isObjOf(p) ? instantMs(p.start) : null;
    const b = isObjOf(p) ? instantMs(p.end) : null;
    return a !== null && b !== null ? [{ start: isoIn(a, c.tz), end: isoIn(b, c.tz) }] : [];
  }) : [];
  const kcalMethod = str(d.kcal_method);
  return {
    id: w.sessionId, date: localDate(w.startMs, c.tz), start: isoIn(w.startMs, c.tz), end: isoIn(w.endMs, c.tz),
    type: d.type as string, source: d.source as string, durationS: Math.round(d.durationS as number),
    distanceM: num(d.distanceM) === null ? null : Math.round(d.distanceM as number), kcal: num(d.kcal) === null ? null : Math.round(d.kcal as number),
    avgHr: num(d.avgHr) === null ? null : Math.round(d.avgHr as number), maxHr: num(d.maxHr) === null ? null : Math.round(d.maxHr as number),
    zones: d.zones && typeof d.zones === 'object' ? (d.zones as Record<string, number>) : null, steps: num(d.steps),
    route: route ? { polyline: route.polyline, points: route.points } : null,
    updatedAt: isoIn(w.receivedMs, c.tz),
    pauses, movingS: num(d.moving_s), kcalMethod, kcalVersion: str(d.kcal_version), energyBasis: str(d.energy_basis), zonesVersion: str(d.zones_version),
    kcalLabel: `Phone estimate (method ${kcalMethod ?? 'not stated'})`,
    // (0.6.3 S26) the catalogue activity chosen when the recording started (ring app 2.8.1), kept through to the candidate
    ...(str(d.activity_type_id) ? { activityTypeId: str(d.activity_type_id) } : {}),
    ...(many ? { installationId: w.installationId } : {}),
  };
}

const isObjOf = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function workouts(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  const base = { from: isoIn(r.from, c.tz), to: isoIn(r.to, c.tz), units: WORKOUT_UNITS };
  const noTotals = { count: 0, durationS: 0, distanceM: 0, kcal: 0, sessions: 0, overlapping: 0 };
  if (!c.store) return ok(NO_DATA, { ...base, sessions: [], totals: noTotals, sportWindows: [], ...provenance(c, [], null) });
  const inputs = new Inputs();
  // every session that overlaps the range (a workout over midnight shows on both days)
  const picked = workoutsOverlapping(c.store, r.from, r.to + 1, inputs).sort((a, b) => a.startMs - b.startMs || a.sessionId.localeCompare(b.sessionId));
  const installs = new Set(picked.map((p) => p.installationId));
  const sessions = picked.map((p) => workoutOut(c, p, installs.size > 1));
  // totals count overlapping sessions once: the longest of each overlapping group
  const groups: number[][] = [];
  let end = -Infinity;
  picked.forEach((p, i) => {
    if (groups.length && p.startMs < end) groups.at(-1)!.push(i);
    else groups.push([i]);
    end = groups.at(-1)!.length === 1 ? p.endMs : Math.max(end, p.endMs);
  });
  const overlaps = new Map<number, string[]>();
  for (const g of groups) if (g.length > 1) for (const i of g) overlaps.set(i, g.filter((k) => k !== i).map((k) => picked[k]!.sessionId));
  const reps = groups.map((g) => g.reduce((best, i) => (sessions[i]!.durationS > sessions[best]!.durationS ? i : best), g[0]!));
  const sum = (f: (s: (typeof sessions)[number]) => number | null) => reps.reduce((a, i) => a + (f(sessions[i]!) ?? 0), 0);
  const totals = { count: reps.length, durationS: sum((s) => s.durationS), distanceM: sum((s) => s.distanceM), kcal: sum((s) => s.kcal), sessions: sessions.length, overlapping: sessions.length - reps.length };
  const out = sessions.map((s, i) => (overlaps.has(i) ? { ...s, overlapsWith: overlaps.get(i)! } : s));
  // (0.6.3 FX5) the ring's sport telemetry windows of the range, each with the workout it belongs to (detector evidence)
  const sport = sportWindows(c.store, r.from, r.to + 1, picked, inputs).map((w) => ({ id: w.id, revision: w.revision, start: isoIn(w.startMs, c.tz), end: isoIn(w.endMs, c.tz), points: w.points, workoutId: w.workoutId, source: 'ring' as const }));
  const data = { ...base, sessions: out, totals, sportWindows: sport, ...provenance(c, installs, maxOf(picked.map((p) => p.endMs))) };
  return ok(sessions.length ? `${sessions.length} phone-recorded workout${sessions.length === 1 ? '' : 's'} from ${base.from} to ${base.to}.` : `No phone-recorded workouts from ${base.from} to ${base.to}.`, data);
}

// --- daily summary

function dailySummary(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const date = typeof args.date === 'string' ? args.date : '';
  const b = dayBounds(date, c.tz);
  if (!b) return rejected('invalid_input', 'Give date as YYYY-MM-DD in the person\'s time zone.');
  const [start, end] = b;
  if (!c.store) return ok(NO_DATA, { date, ...provenance(c, [], null) });
  const store = c.store;
  const inputs = new Inputs();
  const a = activityData(c, start, end - 1, inputs);
  const bouts = withMetrics(store, sleepBouts(store, c.tz, date, date, inputs), inputs);
  const ins = insightRows(c, start, end - 1);
  const latestScore: Record<string, unknown> = {};
  for (const row of ins) latestScore[row.key] = scoreOut(c, row);
  const agg = store.all<{ kind: string; unit: string | null; n: number; mean: number | null; min: number | null; max: number | null; sys: number | null; dia: number | null }>(
    'SELECT kind, MAX(unit) AS unit, COUNT(*) AS n, AVG(value) AS mean, MIN(value) AS min, MAX(value) AS max, AVG(systolic) AS sys, AVG(diastolic) AS dia FROM metric_series WHERE observed_ms >= ? AND observed_ms < ? GROUP BY kind ORDER BY kind', start, end);
  const latest = new Map(store.all<{ kind: string; last_ms: number; value: number | null; systolic: number | null; diastolic: number | null; installation_id: string }>(
    'SELECT kind, MAX(observed_ms) AS last_ms, value, systolic, diastolic, installation_id FROM metric_series WHERE observed_ms >= ? AND observed_ms < ? GROUP BY kind', start, end).map((x) => [x.kind, x]));
  const times = new Map<string, number[]>();
  const dayRows = store.all<{ id: string; kind: string; observed_ms: number }>('SELECT id, kind, observed_ms FROM metric_series WHERE observed_ms >= ? AND observed_ms < ? ORDER BY kind, observed_ms', start, end);
  // (r063 FX2 sR13) a day's every metric row counts in the call's budget
  chargeReadBudget(dayRows.length);
  for (const x of dayRows) {
    inputs.add(x.id);
    const t = times.get(x.kind);
    if (t) t.push(x.observed_ms);
    else times.set(x.kind, [x.observed_ms]);
  }
  const metrics: Record<string, unknown> = {};
  for (const m of agg) {
    const l = latest.get(m.kind);
    const gap = medianGapS(times.get(m.kind) ?? []);
    metrics[m.kind] = m.kind === 'blood_pressure'
      ? { unit: unitOf(m.kind, m.unit), count: m.n, meanSystolic: m.sys === null ? null : r1(m.sys), meanDiastolic: m.dia === null ? null : r1(m.dia), latest: l ? { at: isoIn(l.last_ms, c.tz), systolic: l.systolic, diastolic: l.diastolic } : null, medianGapS: gap === null ? null : Math.round(gap) }
      : { unit: unitOf(m.kind, m.unit), count: m.n, mean: m.mean === null ? null : r1(m.mean), min: m.min, max: m.max, latest: l ? { at: isoIn(l.last_ms, c.tz), value: l.value }: null, medianGapS: gap === null ? null : Math.round(gap) };
  }
  const derived = dayDerived(c, store, date, start, end, a.fused, inputs);
  const installs = new Set([...a.installs, ...bouts.flatMap((x) => [...x.installs]), ...ins.map((x) => x.installation_id), ...[...latest.values()].map((x) => x.installation_id)]);
  const last = maxOf([a.last, bouts.length ? bouts.at(-1)!.endMs : null, ...ins.map((x) => x.observed_ms), ...[...latest.values()].map((x) => x.last_ms)].filter((x): x is number => x !== null));
  const act = a.days.find((d) => d.date === date) ?? null;
  const data = {
    date, from: isoIn(start, c.tz), to: isoIn(end, c.tz),
    units: { ...ACTIVITY_UNITS, sleepMinutes: 'min', metrics: 'see each metric\'s unit; medianGapS in s', ringStepGoal: 'steps (the ring\'s own goal setting)', derived: 'bpm; workoutS in s' },
    activity: act ? { ...act, ringStepGoal: derived.ringStepGoal } : null,
    sleep: bouts.map((x) => publicBout(x, c.tz)),
    scores: latestScore,
    metrics,
    derived,
    inputsHash: inputs.hash([DAY_METRICS_VERSION, FUSION_VERSION, FUSION_REVISION, SLEEP_METRICS_VERSION, HR_SUPPORT_VERSION, ...a.context]),
    ...provenance(c, installs, last),
  };
  const empty = !data.activity && !data.sleep.length && !ins.length && !agg.length;
  return ok(empty ? `No ring data for ${date}.` : `ring data for ${date}: ${[data.activity ? 'activity' : '', data.sleep.length ? 'sleep' : '', ins.length ? 'scores' : '', agg.length ? `${agg.length} metrics` : ''].filter(Boolean).join(', ')}.`, data);
}

/** The `derived` block of a day (`day-metrics/1`) and the ring's step goal. */
function dayDerived(c: Ctx, store: LumenStore, date: string, start: number, end: number, fused: FusedRange | null, inputs: Inputs) {
  const hr = metricSamples(store, 'hr', start, end, inputs);
  const ws = workoutsOverlapping(store, start, end, inputs);
  const telemetry = intervalsAll(store, 'activity/sport_telemetry', start, end);
  inputs.addAll(telemetry);
  const tele = telemetry.flatMap((t) => (num(t.data.bpm) !== null && (t.data.bpm as number) > 0 ? [{ tMs: t.startMs, bpm: t.data.bpm as number, id: t.id }] : []));
  const spans = ws.map((w) => ({ id: w.sessionId, startMs: w.startMs, endMs: w.endMs, avgHr: num(w.data.avgHr), durationS: num(w.data.durationS), samples: tele.filter((t) => t.tMs >= w.startMs && t.tMs < w.endMs) }));
  const readings = hr.map((s) => ({ tMs: s.tMs, bpm: s.value, id: s.id! }));
  const dense = hr.length > 0 && hr.every((s) => s.cadenceS !== null && s.cadenceS <= 60);
  const peak = peakHr(readings, spans, dense);
  // (r071) the stretches slept in: a night's wake break is time awake, its readings are awake readings
  const sleepWindows = sleepRead(store, c.tz, start - DAY, end, inputs).bouts.filter((b) => b.endMs > start && b.startMs < end).flatMap(sleepParts);
  const minuteSteps = fused?.fusion.minuteSelected;
  const nonEx = nonExerciseHr(readings, { workouts: ws, sleep: sleepWindows, ...(minuteSteps ? { minuteSteps } : {}) });
  const goal = store.get<{ id: string; value: number | null; observed_ms: number }>("SELECT id, value, observed_ms FROM metric_series WHERE kind = 'vendor.step_goal' AND observed_ms < ? ORDER BY observed_ms DESC, id DESC LIMIT 1", end);
  if (goal) inputs.add(goal.id);
  return {
    version: DAY_METRICS_VERSION,
    peakHr: peak ? { bpm: peak.bpm, at: isoIn(peak.at, c.tz), source: peak.source, lowerBound: peak.lowerBound, label: 'Highest reading' } : null,
    nonExerciseHr: { ...nonEx, label: 'Non-exercise HR (sampled; not a resting heart rate)' },
    avgWorkoutHr: avgWorkoutHr(spans.filter((w) => localDate(w.startMs, c.tz) === date)),
    ringStepGoal: goal && num(goal.value) !== null ? Math.round(goal.value!) : null,
  };
}

// --- fused steps

const ACTIVITY_KINDS: Record<string, ActivityKind | null> = { locomotor: 'locomotor', nonLocomotor: 'nonLocomotor', unknown: null };
const CONTEXT_MAX = 2000;
const CORRECTION_USE = /^(ring|phone|hc-other:[\w.:-]{1,128})$/;

/**
 * `gauge_steps`'s optional context (FIX-CONTRACT F3): `activities`, `corrections` and `preference` as fusion's rules
 * (a), (b), (c) and (e) read them; `contextKey` names it in `inputsHash` (and so in the ETag). A rejection message for a
 * malformed field.
 */
function stepsContextOf(args: Record<string, unknown>, tz: string): (Omit<FusionContext, 'zeroWindows' | 'breaks'> & { contextKey?: string }) | string {
  const out: Omit<FusionContext, 'zeroWindows' | 'breaks'> & { contextKey?: string } = {};
  const windowOf = (x: unknown, what: string): { startMs: number; endMs: number; x: Record<string, unknown> } | string => {
    if (!isObjOf(x)) return `Each of ${what} is an object with start and end.`;
    const startMs = parseWhen(x.start, tz, 'start');
    const endMs = parseWhen(x.end, tz, 'start');
    if (startMs === null || endMs === null || endMs <= startMs) return `Each of ${what} needs start before end (ISO date-times).`;
    return { startMs, endMs, x };
  };
  if (args.activities !== undefined && args.activities !== null) {
    if (!Array.isArray(args.activities) || args.activities.length > CONTEXT_MAX) return `activities is a list of at most ${CONTEXT_MAX} windows.`;
    const acts: Array<{ startMs: number; endMs: number; kind: ActivityKind }> = [];
    for (const a of args.activities) {
      const w = windowOf(a, 'activities');
      if (typeof w === 'string') return w;
      if (typeof w.x.kind !== 'string' || !Object.hasOwn(ACTIVITY_KINDS, w.x.kind)) return 'Each activity\'s kind is locomotor, nonLocomotor or unknown.';
      const carry = w.x.carry;
      if (carry !== undefined && carry !== null && carry !== 'pocket' && carry !== 'hand' && carry !== 'desk') return 'Each activity\'s carry is pocket, hand or desk.';
      // (r063) a locomotor bout's carry: in the pocket the phone counts the gait; in the hand or on a desk it does not
      const base = ACTIVITY_KINDS[w.x.kind];
      const kind: ActivityKind | null = base === 'locomotor' && carry === 'pocket' ? 'locomotorPocket' : base === 'locomotor' && (carry === 'hand' || carry === 'desk') ? 'locomotorRing' : (base ?? null);
      if (kind) acts.push({ startMs: w.startMs, endMs: w.endMs, kind });
    }
    out.activities = acts.sort((p, q) => p.startMs - q.startMs || p.endMs - q.endMs || (p.kind < q.kind ? -1 : p.kind > q.kind ? 1 : 0));
  }
  if (args.corrections !== undefined && args.corrections !== null) {
    if (!Array.isArray(args.corrections) || args.corrections.length > CONTEXT_MAX) return `corrections is a list of at most ${CONTEXT_MAX} windows.`;
    const corr: Array<{ startMs: number; endMs: number; use: StepLineage }> = [];
    for (const k of args.corrections) {
      const w = windowOf(k, 'corrections');
      if (typeof w === 'string') return w;
      if (typeof w.x.use !== 'string' || !CORRECTION_USE.test(w.x.use)) return 'Each correction\'s use is ring, phone or hc-other:<origin>.';
      corr.push({ startMs: w.startMs, endMs: w.endMs, use: w.x.use as StepLineage });
    }
    out.corrections = corr.sort((p, q) => p.startMs - q.startMs || p.endMs - q.endMs || (p.use < q.use ? -1 : p.use > q.use ? 1 : 0));
  }
  if (args.preference !== undefined && args.preference !== null) {
    const p = args.preference;
    if (!isObjOf(p)) return 'preference is an object { stepsPreference?, soleSustainedGait? }.';
    if (p.stepsPreference !== undefined) {
      const l = p.stepsPreference;
      if (!Array.isArray(l) || l.length < 1 || l.length > 3 || new Set(l).size !== l.length || !l.every((x) => x === 'ring' || x === 'phone' || x === 'hc-other'))
        return 'preference.stepsPreference lists ring, phone and hc-other in order (1 to 3, each once).';
      out.preference = [...(l as string[]), ...DEFAULT_PREFERENCE.filter((x) => !l.includes(x))];
    }
    if (p.soleSustainedGait !== undefined) {
      if (typeof p.soleSustainedGait !== 'boolean') return 'preference.soleSustainedGait is true or false.';
      out.soleSustainedGait = p.soleSustainedGait;
    }
  }
  // (r063 FX2 sR08/aR03) the person's day rollover: merged intervals break there too
  if (args.rolloverH !== undefined && args.rolloverH !== null) {
    const h = typeof args.rolloverH === 'string' ? Number(args.rolloverH) : args.rolloverH;
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0 || h >= 24) return 'rolloverH is the local hour the day rolls over, from 0 to under 24.';
    if (h > 0) out.rolloverH = h;
  }
  const key = contextKeyOf(out);
  if (key) out.contextKey = key;
  return out;
}

/** Whether a `gauge_steps` call brings its own context (else the person's stored one applies). */
const hasOwnContext = (args: Record<string, unknown>) => ['activities', 'corrections', 'preference'].some((k) => args[k] !== undefined && args[k] !== null);

/** The widest window one fusion-context post may replace (P). */
const CONTEXT_WINDOW_MAX_DAYS = 400;

/**
 * `POST /v1/gauge/fusion-context` (r063 S6): `{ window: { start, end }, activities?, corrections?, preference? }` as a
 * store update (the lists replace what starts inside the window), or a rejection message.
 */
export function fusionContextUpdateOf(args: Record<string, unknown>, tz: string): FusionContextUpdate | string {
  const w = args.window;
  if (!isObjOf(w)) return 'window is { start, end } (ISO date-times): the span whose context this replaces.';
  const windowStartMs = parseWhen(w.start, tz, 'start');
  const windowEndMs = parseWhen(w.end, tz, 'start');
  if (windowStartMs === null || windowEndMs === null || windowEndMs <= windowStartMs) return 'window needs start before end (ISO date-times).';
  if (windowEndMs - windowStartMs > CONTEXT_WINDOW_MAX_DAYS * DAY) return `window may span at most ${CONTEXT_WINDOW_MAX_DAYS} days.`;
  const ctx = stepsContextOf(args, tz);
  if (typeof ctx === 'string') return ctx;
  return {
    windowStartMs, windowEndMs, activities: [...(ctx.activities ?? [])], corrections: [...(ctx.corrections ?? [])],
    ...(ctx.preference ? { preference: [...ctx.preference] } : {}), ...(ctx.soleSustainedGait !== undefined ? { soleSustainedGait: ctx.soleSustainedGait } : {}),
    ...(ctx.rolloverH !== undefined ? { rolloverH: ctx.rolloverH } : {}),
  };
}

const STEPS_MAX_DAYS = 62;
const STEPS_UNITS = { steps: 'steps', coverage: 'min of the local day', ringResidual: 'steps the ring counted but did not place in time (never added to located)' };

function steps(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  const fromDate = localDate(r.from, c.tz);
  const toDate = localDate(r.to, c.tz);
  if (toDate > addDays(fromDate, STEPS_MAX_DAYS - 1)) return rejected('invalid_input', `The range may span at most ${STEPS_MAX_DAYS} days.`);
  const base = { fusionVersion: FUSION_VERSION, from: fromDate, to: toDate, units: STEPS_UNITS };
  if (!c.store) return ok(NO_DATA, { ...base, intervals: [], days: [], ...provenance(c, [], null) });
  // a call with its own context (POST /steps/fuse) uses it; any other uses the person's stored context (r063 S6)
  const fctx = hasOwnContext(args) ? stepsContextOf(args, c.tz) : storedContext(c, fromDate, toDate);
  if (typeof fctx === 'string') return rejected('invalid_input', fctx);
  const inputs = new Inputs();
  const f = fuseRange(c.store, c.tz, fromDate, toDate, inputs, fctx);
  const asked = f.fusion.intervals.filter((u) => u.endMs > f.fromMs && u.startMs < f.toMs);
  const intervals = asked.map((u) => ({
    start: isoIn(u.startMs, c.tz), end: isoIn(u.endMs, c.tz), steps: u.steps, source: u.source, lineage: u.lineage, support: u.support, unit: u.unit, selectionReason: u.selectionReason,
    alternatives: u.alternatives, ...(u.disagreement ? { disagreement: true } : {}), ...(u.nonLocomotorSuspect ? { nonLocomotorSuspect: true } : {}),
  }));
  const legacy = new Map<string, number>();
  for (const b of f.evidence.ringBuckets) if (b.endMs === null) legacy.set(localDate(b.startMs, c.tz), (legacy.get(localDate(b.startMs, c.tz)) ?? 0) + b.steps);
  const days = f.days.map((d) => ({ ...d, ...(legacy.has(d.date) ? { legacyRingSteps: legacy.get(d.date)! } : {}) }));
  const installs = new Set(f.evidence.ringBuckets.map((b) => b.installationId));
  const last = maxOf(asked.map((u) => u.endMs));
  const data = { ...base, intervals, days, inputsHash: inputs.hash([FUSION_VERSION, FUSION_REVISION, ...contextVersion(fctx)]), ...provenance(c, installs.size ? installs : null, last) };
  const total = days.reduce((n, d) => n + (d.located ?? 0), 0);
  return ok(intervals.length ? `Fused steps for ${fromDate} to ${toDate}: ${total} located in ${intervals.length} intervals.` : `No step evidence from ${fromDate} to ${toDate}.`, data);
}

// --- timeline

const TIMELINE_UNITS = { steps: 'steps per minute', hr: 'bpm; supportedS in s', stress: 'ring index (device scale, unvalidated)', hc: 'speedMps in m/s, powerW in W (per-minute sampled means)', gps: 'speedMps in m/s (ring app route distance ÷ time per minute)' };

function timeline(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const date = typeof args.date === 'string' ? args.date : '';
  const b = dayBounds(date, c.tz);
  if (!b) return rejected('invalid_input', 'Give date as YYYY-MM-DD in the person\'s time zone.');
  const [start, end] = b;
  const versions = { fusionVersion: FUSION_VERSION, hrSupportVersion: HR_SUPPORT_VERSION, units: TIMELINE_UNITS };
  // (r063 S5) no store yet: the full shape, every minute unknown (null), never a partial object
  if (!c.store) return ok(NO_DATA, { ...emptyTimeline(date, c.tz, start, end, (ms) => isoIn(ms, c.tz)), ...versions, ...provenance(c, [], null) });
  const store = c.store;
  const inputs = new Inputs();
  const fctx = storedContext(c, date, date);
  const f = fuseRange(store, c.tz, date, date, inputs, fctx);
  const ws = workoutsOverlapping(store, start, end, inputs);
  const cuts = sessionCuts(ws);
  const hr = metricSamples(store, 'hr', start - MINUTE, end + MINUTE, inputs);
  const sleepMinutes = sleepRead(store, c.tz, start - DAY, end, inputs).minutes;
  const hc = intervalsAll(store, 'hc/record', start, end, { recordType: 'ExerciseSession' });
  inputs.addAll(hc);
  const stress = metricSamples(store, 'stress', start, end, inputs);
  const t = buildTimeline({
    date, tz: c.tz, startMs: start, endMs: end, fusion: f.fusion, hrSegments: supportSegments(hr, start, end, cuts), hrReadings: hr.filter((s) => s.tMs >= start && s.tMs < end),
    sleepStage: (m) => sleepMinutes.get(m) as Stage | undefined,
    workouts: ws.map((w) => ({ id: w.sessionId, startMs: w.startMs, endMs: w.endMs, type: String(w.data.type), source: String(w.data.source) })),
    hcExercise: hc.filter((x) => x.endMs !== null).map((x) => {
      const p = isObjOf(x.data.payload) ? x.data.payload : {};
      const et = exerciseTypeOf(p);
      return { id: x.subject.slice('ExerciseSession:'.length), startMs: x.startMs, endMs: x.endMs!, exerciseType: et.name, exerciseTypeCode: et.code, title: str(p.title), origin: str(x.data.origin_package), lineage: x.lineage };
    }),
    phoneAcquisition: f.evidence.phoneAcquisition, stress: stress.map((s) => ({ tMs: s.tMs, value: s.value })), iso: (ms) => isoIn(ms, c.tz),
    // (r063 S16) Health Connect HR, speed and power, joined by minute with their lineage (ring app's HR first)
    hcHr: hcStreams(store, 'HeartRate', start, end, inputs, cuts), hcSpeed: hcStreams(store, 'Speed', start, end, inputs), hcPower: hcStreams(store, 'Power', start, end, inputs),
    // (0.6.3 FX5) ring app's route-derived moving speed inside its GPS workouts
    gpsSpeed: gpsSpeedMinutes(store, ws, start, Math.round((end - start) / MINUTE), inputs),
  });
  const data = { ...t, ...versions, inputsHash: inputs.hash([FUSION_VERSION, FUSION_REVISION, HR_SUPPORT_VERSION, 'timeline-hc/1', GPS_MOTION_VERSION, ...contextVersion(fctx)]), ...provenance(c, null, null) };
  return ok(`ring app timeline for ${date}: ${t.minutes} minutes.`, data);
}

// --- heart-rate intervals

/** The instants a support never crosses: each workout's start and end and its pauses' edges. */
function sessionCuts(ws: readonly Workout[]): number[] {
  return ws.flatMap((w) => [w.startMs, w.endMs, ...(Array.isArray(w.data.pauses) ? w.data.pauses.flatMap((p) => (isObjOf(p) ? [instantMs(p.start), instantMs(p.end)].filter((x): x is number => x !== null) : [])) : [])]);
}

const HR_INTERVAL_UNITS = { t: 'UTC epoch ms', bpm: 'bpm', cadenceS: 's (declared; null when undeclared)', nextT: 'UTC epoch ms of the next reading (null for the last)', start: 'UTC epoch ms (supported interval, inclusive)', end: 'UTC epoch ms (supported interval, exclusive)', supportedS: 's' };

/**
 * `gauge_hr_intervals` (docs/SERVER.md "Heart-rate intervals"): the raw HR readings of `[from, to)` with each one's
 * `hr-support/1` supported interval, for exact zone time on the device. The window is bounded and the answer paged; the
 * supports are computed over the whole window (readings a minute past each edge are neighbours, never returned), so a
 * page boundary never changes them, and every page carries the same `inputsHash` while the data stands.
 */
function hrIntervals(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  // a date as `to` is the whole day (parseWhen gives its last millisecond): the window is half-open
  const from = r.from;
  const to = typeof args.to === 'string' && DATE.test(args.to) ? r.to + 1 : r.to;
  if (!(to > from)) return rejected('invalid_input', 'to must be after from.');
  if (to - from > HR_INTERVALS_MAX_HOURS * HOUR) return rejected('invalid_input', `The window may span at most ${HR_INTERVALS_MAX_HOURS} hours.`);
  const rawCursor = args.cursor === undefined || args.cursor === null || args.cursor === '' ? null : args.cursor;
  if (rawCursor !== null && (typeof rawCursor !== 'string' || !/^\d{1,16}$/.test(rawCursor))) return rejected('invalid_input', 'cursor is the `next` of the previous page.');
  const rawLimit = args.limit === undefined || args.limit === null || args.limit === '' ? HR_INTERVALS_LIMIT : typeof args.limit === 'string' ? Number(args.limit) : args.limit;
  if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > HR_INTERVALS_MAX_LIMIT) return rejected('invalid_input', `limit is a whole number from 1 to ${HR_INTERVALS_MAX_LIMIT}.`);
  const after = rawCursor === null ? null : Number(rawCursor);
  const base = { from: isoIn(from, c.tz), to: isoIn(to, c.tz), hrSupportVersion: HR_SUPPORT_VERSION, units: HR_INTERVAL_UNITS };
  if (!c.store) return ok(NO_DATA, { ...base, intervals: [], count: 0, supportedS: 0, next: null, ...provenance(c, [], null) });
  const store = c.store;
  const inputs = new Inputs();
  const ws = workoutsOverlapping(store, from, to, inputs);
  const hr = metricSamples(store, 'hr', from - MINUTE, to + MINUTE, inputs);
  const all = sampleSupports(hr, from, to, sessionCuts(ws)).filter((x) => x.sample.tMs >= from && x.sample.tMs < to);
  const rest = after === null ? all : all.filter((x) => x.sample.tMs > after);
  const page = rest.slice(0, rawLimit);
  const intervals = page.map((x) => ({
    t: x.sample.tMs, bpm: x.sample.value, cadenceS: x.sample.cadenceS, nextT: x.nextMs,
    start: x.support ? x.support.startMs : null, end: x.support ? x.support.endMs : null,
  }));
  const next = rest.length > page.length ? String(page.at(-1)!.sample.tMs) : null;
  const supportedS = all.reduce((n, x) => n + (x.support ? x.support.endMs - x.support.startMs : 0), 0) / 1000;
  const data = {
    ...base, intervals, count: all.length, supportedS, next,
    inputsHash: inputs.hash([HR_SUPPORT_VERSION, 'hr-intervals/1']),
    ...provenance(c, null, all.length ? all.at(-1)!.sample.tMs : null),
  };
  return ok(all.length ? `Heart-rate readings ${base.from} to ${base.to}: ${all.length} (${Math.round(supportedS)} s supported), ${intervals.length} on this page.` : `No heart-rate readings from ${base.from} to ${base.to}.`, data);
}

// --- baselines

function baselines(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const date = typeof args.date === 'string' ? args.date : '';
  const b = dayBounds(date, c.tz);
  if (!b) return rejected('invalid_input', 'Give date as YYYY-MM-DD (the waking date) in the person\'s time zone.');
  if (!c.store) return ok(NO_DATA, { date, ...provenance(c, [], null) });
  const store = c.store;
  const inputs = new Inputs();
  const { baselines: base, bouts } = baselinesFor(store, c.tz, date, inputs);
  // (0.6.3 FX5) while the ring's sleeping low is not ready: Health Connect's resting HR, labelled, as the fallback
  const restingHrFallback = base.sleepLowHr.ready ? null : hcRestingHr(store, c.tz, date, inputs);
  // sampled non-exercise HR over the same 28 days before the date
  const lo = dayBounds(addDays(date, -28), c.tz)![0];
  const hi = b[0];
  const hr = metricSamples(store, 'hr', lo, hi, inputs);
  const ws = workoutsOverlapping(store, lo, hi, inputs);
  const sleepWindows = sleepRead(store, c.tz, lo - DAY, hi, inputs).bouts.flatMap(sleepParts);
  const idle = idleReadings(hr.map((s) => ({ tMs: s.tMs, bpm: s.value })), { workouts: ws, sleep: sleepWindows });
  const idleDays = new Set(idle.map((x) => localDate(x.tMs, c.tz))).size;
  const med = median(idle.map((x) => x.bpm));
  const data = {
    ...base,
    sampledIdleHr: { medianBpm: med === null ? null : r1(med), n: idle.length, days: idleDays, label: 'sampled non-exercise HR (not a resting heart rate)' },
    restingHrFallback,
    labels: { usualOnset: 'Usual time you fell asleep', usualWake: 'Usual time you woke', usualMidpoint: 'Usual sleep midpoint', sleepLowHr: 'Sleeping low HR', hrvBaseline: 'Usual HRV (ring-reported)', tempBaseline: 'Usual skin temperature' },
    units: { clock: 'local HH:MM; minutes since local midnight', sleepLowHr: 'bpm', restingHrFallback: 'bpm (Health Connect RestingHeartRate; only while sleepLowHr is not ready)', hrvBaseline: 'ms; lnMedian and lnS on ln(ms)', tempBaseline: '°C', learning: 'nights' },
    versions: [SLEEP_METRICS_VERSION, HR_SUPPORT_VERSION],
    inputsHash: inputs.hash([SLEEP_METRICS_VERSION, HR_SUPPORT_VERSION, 'baselines/1']),
    ...provenance(c, new Set(bouts.flatMap((x) => [...x.installs])), bouts.length ? bouts.at(-1)!.endMs : null),
  };
  return ok(base.learning.learning ? `Ring baselines for ${date}: learning (night ${base.learning.nights} of ${base.learning.needed}).` : `Ring baselines for ${date} from ${base.learning.nights} nights.`, data);
}

// --- Health Connect records

function hcRecords(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const type = typeof args.type === 'string' ? args.type : '';
  if (!(HC_RECORD_TYPES as readonly string[]).includes(type)) return rejected('invalid_input', `type is one of ${HC_RECORD_TYPES.join(', ')}.`);
  const r = rangeOf(args, c.tz);
  if (typeof r === 'string') return rejected('invalid_input', r);
  const pg = pageOf(args);
  if (typeof pg === 'string') return rejected('invalid_input', pg);
  const base = { type, from: isoIn(r.from, c.tz), to: isoIn(r.to, c.tz) };
  if (!c.store) return ok(NO_DATA, { ...base, records: [], deleted: [], next: null, ...provenance(c, [], null) });
  let page;
  try {
    page = c.store.readIntervals('hc/record', r.from, r.to + 1, { recordType: type as HcRecordType, cursor: pg.cursor, limit: pg.limit });
  } catch (e) {
    if (e instanceof LumenReadError) return rejected('invalid_input', e.code === 'invalid_cursor' ? 'cursor is the `next` of the previous page of this same query.' : e.message);
    throw e;
  }
  // (r063 FX2 sR13/aR17) the installations are read once per page, never once per record
  const multi = c.store.installations().length > 1;
  const records = page.rows.map((x) => ({
    id: x.subject.slice(type.length + 1), recordType: type, start: isoIn(x.startMs, c.tz), end: isoIn(x.endMs ?? x.startMs, c.tz),
    origin: str(x.data.origin_package), deviceNative: x.data.origin_is_device_native === true,
    // the wire's origin_package / origin_is_device_native in the client's names (Vitals' GaugeHcRecord); origin and deviceNative stay for agents
    originPackage: str(x.data.origin_package), originIsDeviceNative: x.data.origin_is_device_native === true, lineage: x.lineage, device: isObjOf(x.data.device) ? x.data.device : null,
    recordingMethod: x.data.recording_method ?? null, lastModified: x.revMs === null ? null : isoIn(x.revMs, c.tz), zoneOffsets: x.data.zone_offsets ?? null,
    // (r067) an ExerciseSession's type normalised: exercise_type the symbolic name, exercise_type_code the integer
    payload: type === 'ExerciseSession' ? normaliseExercisePayload(x.data.payload) : x.data.payload,
    ...(multi ? { installationId: x.installationId } : {}),
  }));
  // (r063) Health Connect deletions: the records of this type overlapping the range whose latest revision a tombstone
  // (`hc/deleted`, from ring app's changes token) retracted, so a client that imported one can drop it; first page only
  const deleted = pg.cursor ? [] : c.store.all<{ subject: string; installation_id: string; start_ms: number; end_ms: number; rev_ms: number | null; deleted_ms: number | null; origin_package: string | null }>(
    `SELECT subject, installation_id, start_ms, end_ms, rev_ms, deleted_ms, origin_package FROM hc_deleted_records
      WHERE subject >= ? AND subject < ? AND start_ms <= ? AND MAX(end_ms, start_ms + 1) > ? ORDER BY start_ms, subject LIMIT ${READ_MAX_LIMIT}`,
    `${type}:`, `${type};`, r.to, r.from,
  ).map((x) => ({
    id: x.subject.slice(type.length + 1), recordType: type, start: isoIn(x.start_ms, c.tz), end: isoIn(x.end_ms, c.tz), originPackage: x.origin_package,
    lastModified: x.rev_ms === null ? null : isoIn(x.rev_ms, c.tz), deletedAt: x.deleted_ms === null ? null : isoIn(x.deleted_ms, c.tz),
    ...(multi ? { installationId: x.installation_id } : {}),
  }));
  const data = { ...base, records, deleted, next: page.next, ...provenance(c, new Set(page.rows.map((x) => x.installationId)), maxOf(page.rows.map((x) => x.endMs ?? x.startMs))) };
  const gone = deleted.length ? ` ${deleted.length} deleted in Health Connect.` : '';
  return ok(records.length ? `${records.length} Health Connect ${type} records from ${base.from} to ${base.to}${page.next ? ' (more on the next page)' : ''}.${gone}` : `No Health Connect ${type} records from ${base.from} to ${base.to}.${gone}`, data);
}

// --- change feed (r063 S13)

function changes(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const since = parseCursor(args.since);
  if (since === 'invalid') return rejected('invalid_input', 'since is the cursor of a previous answer.');
  const raw = args.limit === undefined || args.limit === null || args.limit === '' ? FEED_LIMIT : typeof args.limit === 'string' ? Number(args.limit) : args.limit;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > FEED_MAX_LIMIT) return rejected('invalid_input', `limit is a whole number from 1 to ${FEED_MAX_LIMIT}.`);
  if (!c.store) return ok(NO_DATA, { since: null, cursor: null, more: false, resync: true, changes: [], ...provenance(c, [], null) });
  const page = changesSince(c.store, since, raw);
  const multi = c.store.installations().length > 1;
  const out = page.changes.map((x) => ({
    kind: x.kind, id: x.id, ref: x.ref, change: x.change, start: x.startMs === null ? null : isoIn(x.startMs, c.tz), end: x.endMs === null ? null : isoIn(x.endMs, c.tz),
    at: x.atMs === null ? null : isoIn(x.atMs, c.tz), ...(multi ? { installationId: x.installationId } : {}),
  }));
  const data = { since: typeof args.since === 'string' ? args.since : null, cursor: page.cursor, more: page.more, resync: page.resync, changes: out, ...provenance(c, null, null) };
  const gone = out.filter((x) => x.change === 'deleted').length;
  return ok(page.resync ? 'Read the window again, then follow the feed from this cursor.' : out.length ? `${out.length} imported records changed (${gone} deleted)${page.more ? '; more on the next page' : ''}.` : 'Nothing imported changed.', data);
}

// (0.6.3 FX1, sR02/aR04) the authoritative state now of named imported records (a client's resync pages through it)
function changesState(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const refs = parseSubjectRefs(args.refs);
  if (!refs) return rejected('invalid_input', `refs is up to ${STATE_MAX_REFS} records as kind:id (workout, hcExercise or hcWeight), comma-separated.`);
  if (!c.store) return ok(NO_DATA, { states: refs.map((r) => ({ kind: r.kind, id: r.id, ref: r.kind === 'workout' ? `gauge:${r.id}` : `hc:${r.id}`, state: 'unknown', at: null })), ...provenance(c, [], null) });
  const states = subjectStates(c.store, refs, c.store.installations().map((x) => x.id)).map((x) => ({ kind: x.kind, id: x.id, ref: x.ref, state: x.state, at: x.atMs === null ? null : isoIn(x.atMs, c.tz) }));
  const gone = states.filter((x) => x.state === 'deleted').length;
  const unknown = states.filter((x) => x.state === 'unknown').length;
  return ok(`${states.length} imported records: ${states.length - gone - unknown} present, ${gone} deleted, ${unknown} unknown.`, { states, ...provenance(c, null, null) });
}

// --- detections (r067 AD-SERVER, r065 autodetect CONTRACT §2)

const DETECTIONS_LIMIT = 200;
const DETECTIONS_MAX_LIMIT = 500;
/** `<epoch>.<sequence>`: the epoch names this file's episode table, so a restored store makes the client resync. */
const DETECTION_CURSOR = /^([0-9a-f]{12})\.(\d{1,15})$/;

function detections(c: Ctx, args: Record<string, unknown>): ToolResultEnvelope {
  const since = args.since === undefined || args.since === null || args.since === '' ? null : args.since;
  if (since !== null && (typeof since !== 'string' || !DETECTION_CURSOR.test(since))) return rejected('invalid_input', 'since is the cursor of a previous answer.');
  const raw = args.limit === undefined || args.limit === null || args.limit === '' ? DETECTIONS_LIMIT : typeof args.limit === 'string' ? Number(args.limit) : args.limit;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > DETECTIONS_MAX_LIMIT) return rejected('invalid_input', `limit is a whole number from 1 to ${DETECTIONS_MAX_LIMIT}.`);
  let window: { from: number; to: number } | null = null;
  if (args.from !== undefined || args.to !== undefined) {
    const r = rangeOf(args, c.tz);
    if (typeof r === 'string') return rejected('invalid_input', r);
    window = r;
  }
  const base = { detector: DETECTOR, config: DETECT_CONFIG };
  if (!c.store) return ok(NO_DATA, { ...base, episodes: [], withdrawn: [], cursor: null, more: false, resync: true, processedThrough: null, ...provenance(c, [], null) });
  const d = c.store.detections;
  const epoch = d.epoch();
  const m = since ? DETECTION_CURSOR.exec(since) : null;
  const resync = !m || m[1] !== epoch;
  const after = m && !resync ? Number(m[2]) : 0;
  const page = d.page({ afterSeq: after, fromMs: window?.from ?? null, toMs: window?.to ?? null, limit: raw });
  chargeReadBudget(page.rows.length);
  const episodes = page.rows.filter((r) => r.state !== 'withdrawn').map((r) => r.doc);
  const withdrawn = page.rows.filter((r) => r.state === 'withdrawn').map((r) => r.id);
  // what detection has processed: its newest run, held back by any range still queued
  const queued = d.queue();
  const done = d.processedMs();
  const pendingFrom = queued.length ? Math.min(...queued.map((q) => q.fromMs)) : null;
  const through = done === null ? null : pendingFrom === null ? done : Math.min(done, pendingFrom);
  const data = {
    ...base, episodes, withdrawn, cursor: `${epoch}.${page.lastSeq}`, more: page.more, resync: since !== null && resync,
    processedThrough: through === null ? null : new Date(through).toISOString(), diagnostics: d.diagnostics(), ...provenance(c, null, null),
  };
  return ok(episodes.length || withdrawn.length ? `${episodes.length} detected activities${withdrawn.length ? `, ${withdrawn.length} withdrawn` : ''}${page.more ? '; more on the next page' : ''}. Each is a suggestion until approved.` : 'No detected activities.', data);
}

// --- availability

function availability(c: Ctx): ToolResultEnvelope {
  if (!c.store) return ok(NO_DATA, { categories: [], metricKinds: [], shortVideoDays: 0, workoutSessions: 0, deletions: 0, detection: DETECTOR, detectionConfig: DETECT_CONFIG, ...provenance(c, [], null) });
  // event_state is the materialised visibility (one covering index scan, no per-row deletion check)
  const rows = c.store.all<{ category: string; n: number; first: number; last: number }>('SELECT category, COUNT(*) AS n, MIN(observed_ms) AS first, MAX(observed_ms) AS last FROM event_state WHERE hidden = 0 GROUP BY category ORDER BY category');
  const tools: Record<string, string> = { metrics: 'gauge_metric_series', vendor: 'gauge_metric_series', activity: 'gauge_activity', sleep: 'gauge_sleep', insights: 'gauge_scores', state: 'gauge_device_state', habits: 'gauge_short_video' };
  const exact: Record<string, string> = { 'activity/session': 'gauge_workouts', 'phone/activity_transition': 'gauge_detections', 'phone/activity_recognition_acquisition': 'gauge_detections' };
  const categories = rows.map((r) => ({ category: r.category, count: r.n, firstReadingAt: isoIn(r.first, c.tz), lastReadingAt: isoIn(r.last, c.tz), readWith: exact[r.category] ?? tools[r.category.split('/')[0]!] ?? null }));
  const deletions = c.store.get<{ n: number }>('SELECT COUNT(*) AS n FROM deletions')?.n ?? 0;
  const shortVideoDays = c.store.get<{ n: number }>('SELECT COUNT(*) AS n FROM short_video_days')?.n ?? 0;
  const workoutSessions = c.store.get<{ n: number }>('SELECT COUNT(*) AS n FROM workout_sessions')?.n ?? 0;
  // (r067) the server's automatic detector: a client that sees it never runs its own detect/1 over the same evidence
  const data = { categories, metricKinds: rows.filter((r) => isMetricCategory(r.category)).map((r) => kindOf(r.category)), shortVideoDays, workoutSessions, deletions, detection: DETECTOR, detectionConfig: DETECT_CONFIG, ...provenance(c, null, maxOf(rows.map((r) => r.last))) };
  return ok(rows.length ? `ring data in ${rows.length} categories.` : NO_DATA, data);
}

// ---------------------------------------------------------------------------------------------------------------

export interface LumenToolSet {
  tools(): McpToolDescriptor[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResultEnvelope>;
}

/** The tools for one person: `open()` gives the person's store, or null when Lumen never uploaded anything. */
export function lumenToolSet(open: () => LumenStore | null, timeZone: string, now: () => number = Date.now, fusionContext: () => StoredFusionContext | null = () => null): LumenToolSet {
  return {
    tools: () => [...LUMEN_TOOLS],
    async call(name, args) {
      try {
        const store = open();
        const tz = zoneFor(store, args, timeZone);
        if (tz === null) return rejected('invalid_input', 'tz is a time zone (IANA, e.g. Asia/Kolkata).');
        return withZone(withReadBudget(() => dispatch(name, args, { store, tz, now: now(), fusion: fusionContext() })), tz);
      } catch (e) {
        if (e instanceof ReadBudgetError) return rejected('invalid_input', e.message);
        return rejected('internal', 'The ring data could not be read on the server. Try again in a moment.');
      }
    },
  };
}

/** The result with the zone it used (`tz`, at the top level of its data object). */
function withZone(env: ToolResultEnvelope, tz: string): ToolResultEnvelope {
  return env.ok && isObjOf(env.data) ? { ...env, data: { ...env.data, tz } } : env;
}

function dispatch(name: string, args: Record<string, unknown>, c: Ctx): ToolResultEnvelope {
        switch (name) {
          case 'gauge_data_availability':
            return availability(c);
          case 'gauge_metric_series':
            return metricSeries(c, args);
          case 'gauge_daily_summary':
            return dailySummary(c, args);
          case 'gauge_sleep':
            return sleep(c, args);
          case 'gauge_activity':
            return activity(c, args);
          case 'gauge_scores':
            return scores(c, args);
          case 'gauge_device_state':
            return deviceState(c);
          case 'gauge_short_video':
            return shortVideo(c, args);
          case 'gauge_workouts':
            return workouts(c, args);
          case 'gauge_steps':
            return steps(c, args);
          case 'gauge_timeline':
            return timeline(c, args);
          case 'gauge_hr_intervals':
            return hrIntervals(c, args);
          case 'gauge_baselines':
            return baselines(c, args);
          case 'gauge_hc':
            return hcRecords(c, args);
          case 'gauge_changes':
            return changes(c, args);
          case 'gauge_detections':
            return detections(c, args);
          case 'gauge_changes_state':
            return changesState(c, args);
        }
  return rejected('forbidden', `There is no tool called ${name}.`);
}
