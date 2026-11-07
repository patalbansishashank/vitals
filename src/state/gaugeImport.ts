/**
 * The Gauge import's schedule and device-local state (vitals-research/step1/BRIEF.md): on app start and every few minutes
 * while the app is open (web, desktop and Android alike, since all talk to the home server), read the ring's daily steps
 * and sleep sessions (`gaugeApi.activity` / `gaugeApi.sleep`) and hand them to `log.fromGauge`, which writes them as
 * ordinary daily-log entries. The first run fills the last 30 days; later runs re-read from two days before the last
 * day every feed imported (a ring that synced late still lands; a feed that failed is read again from where it stopped).
 * (r063 S14/A21) The advertised 30-day correction window is really revisited: once an hour a rotating chunk of a week of
 * it is read again (late corrections and uploads anywhere in it land within a few hours), and workouts new or revised since
 * the last import get their minute timelines whatever their age (bounded per run).
 *
 * Devices: every paired device imports, and that is safe with Evolu sync because the import is idempotent across devices —
 * an entry's id is computed from its key, reading and predecessor (`gaugeEntryId`), so two devices that read the same
 * value write the same row, which sync merges field by field into one; a device that finds the row already there skips
 * it. Importing on one device only would need an election that survives devices going offline or being erased.
 *
 * `settings.gaugeImport` (synced, on by default) switches it off everywhere. What is kept here is this device's own:
 * when it last imported, whether it filled the 30 days, each feed's last good day and the reconcile cursor
 * (`vitals.gaugeImport.v1`, an internal key, never exported).
 *
 * r063 CORE:
 * - (S6) Each run first posts the person's fusion context (approved bouts, step corrections, D1 settings) to the server
 *   (`POST /v1/gauge/fusion-context`); every fused read (the Ring, timelines, detectors, Heart Points, this import's
 *   `/steps`) then uses it. A change to the log or the step settings posts it again within seconds (`startGaugeImport`).
 * - (S13) The change feed (`/v1/gauge/changes`) tells which imported workouts, Health Connect sessions and weights were
 *   deleted upstream: activities get them as `deletedRefs`, weights are removed (`log.retract`, restorable), and each
 *   retraction is kept in this device's audit trail (`retractions`). The cursor advances only after they were applied.
 * - (S15) Health Connect reads follow every page; the command batches stay within their limits (500 sessions, 400
 *   weights, 500 deleted refs); the watermark (`lastDate`, `backfilled`) advances only when every page and batch succeeded.
 *
 * 0.6.3 FX1 (final review):
 * - (sR02/aR04) `resync: true` from the feed (no cursor yet, a restored store) is never acknowledged blindly: the import
 *   pages what it imported (activity source refs, Health Connect weights) through `/v1/gauge/changes-state`, a bounded
 *   number of pages a run, applies what the server says is deleted (never what it does not know), and only then saves the
 *   feed's cursor (`resync` keeps the progress between runs).
 * - (sR14/aR04) Minute timelines a run could not read (over the per-run cap, a failed read, a workout the feed reports
 *   revised) wait in a bounded queue (`evidence`) and are read by later runs, never dropped; the activities feed counts as
 *   read only when the workouts read succeeded too.
 * - (sR03/aR05) A day the server answered in full without the steps or night imported before is told to `log.fromGauge`
 *   (`answered`), which retracts that entry; today's live snapshot is cleared on the same confirmed answer. A failed or
 *   offline read never retracts anything.
 */
import { assertCurrentWrite, externalRestoreRequired, onDataReplaced, restoreInProgress, writeGeneration } from './writeBarrier';
import { activityTraitsOf, hcExerciseCodeOf } from '@/content/catalogues/activityTypes';
import { knownActivityTypeId } from '@/living/activityCandidates';
import { DEFAULT_ROLLOVER_H, rolloverOf } from '@/living/appDay';
import { addDays, instantToLocal } from '@/living/dates';
import { gaugeDaySteps, type GaugeSleepEpisode, type GaugeStepsDay } from '@/living/gaugeImport';
import { effectiveEntries } from '@/living/logs';
import { exerciseRecordOf } from '@/living/sensors/activityEnergy';
import { hcRecordingMethodOf } from '@/living/sensors/activityDetect';
import { gpsMotionMinutes, hcMotionMinutes } from '@/living/activityCandidates';
import { isOtherHrSource, resolveHrSegments, segmentsFromHrIntervals } from '@/living/sensors/hrZones';
import { movingIntervalsOf } from '@/living/boutParts';
import { appDayStepsOf } from '@/living/stepsAppDay';
import type { LogEntry } from '@/living/types';
import { setLiveTodaySteps } from './liveSteps';
import { setLiveDetections, type LiveDetection } from './liveDetections';
import { gaugeIdentity } from '@/net/gaugeIdentity';
import { GAUGE_DETECTIONS_MAX, GAUGE_STATE_MAX_REFS, gaugeApi, type GaugeApi, type GaugeDetections, type GaugeBaselines, type GaugeChange, type GaugeFuseActivity, type GaugeFuseCorrection, type GaugeHc, type GaugeStepsFuseRequest, type GaugeSteps, type GaugeHrIntervals, type GaugeSubjectRef, type GaugeTimeline, type GaugeV2Api, type GaugeWorkouts, restingProxyOf } from '@/net/gauge';

/** (energy SPEC §V3.6) Only the last few days' minute timelines are read for the detectors (P: one request per day). */
export const GAUGE_TIMELINE_DAYS = 3;

/** What `activity.fromGauge` takes (the import's second half: detected activities, decided at once by `activity.autoAccept`). */
export interface ActivityImportInput {
  /** `activityTypeId` (0.6.3 S26): the catalogue activity a recording was started as, when it names a known exercise. */
  gaugeSessions: Array<{ id: string; revision: string; start: number; end: number; type: string; kcal?: number | null; distanceM?: number | null; pauses?: Array<{ start: number; end: number }>; activityTypeId?: string }>;
  hcSessions: Array<{ id: string; revision: string; start: number; end: number; exerciseType: number; originPackage: string; title?: string; hasHr?: boolean; hasRoute?: boolean; segments?: Array<{ start: number; end: number }>; recordingMethod?: 'manual' | 'active' | 'auto'; laps?: number }>;
  /**
   * (r063 S16/A19) With each day's Health Connect speed (m/s) and power (W) per minute when the timeline has them, and
   * their quality: `speedAccepted` (a measurement in range, not a manual entry) and `powerVerified` (verified external
   * work; the server marks Health Connect power unverified). `gradePct` when a source gives one.
   */
  minutes: Array<{ first: number; steps: Array<number | null>; hrBpm?: Array<number | null>; hrSupportedS?: Array<number | null>; hrExact?: Array<{ start: number; end: number; bpm: number }>; asleep?: boolean[]; speedMps?: Array<number | null>; speedAccepted?: boolean[]; gradePct?: Array<number | null>; powerW?: Array<number | null>; powerVerified?: boolean[]; gpsSpeedMps?: Array<number | null>; gpsSpeedAccepted?: boolean[] }>;
  /**
   * (0.6.3 FX5) The ring's sport telemetry windows that belong to no Gauge workout (the detector's telemetry branch; a
   * window inside a recorded workout is that workout, never offered again).
   */
  telemetry?: Array<{ id: string; revision: string; start: number; end: number; mode?: string }>;
  /** (F11) The S2 "sleeping low HR" baseline (D6: an HRrest proxy only when the person opted in). */
  sleepingLowHr?: number | null;
  /** (0.6.3 FX5) `healthConnect` when `sleepingLowHr` is Health Connect's resting HR (the ring's was not ready). */
  sleepingLowHrSource?: 'ring' | 'healthConnect';
  /** (r063) Health Connect sessions deleted upstream (`/v1/gauge/hc` `deleted`), as `hc:<id>` refs. */
  deletedRefs?: string[];
  /** (0.6.7 AD-VITALS) The server's final detection episodes (`/v1/gauge/detections`), instants in epoch ms. */
  detections?: ActivityDetectionInput[];
  /** (0.6.7 AD-VITALS) Episode ids the server withdrew. */
  withdrawnDetections?: string[];
  /** (0.6.7 AD-VITALS) The server's detector (`detect/2`): the local detect/1 detectors are then off. */
  serverDetector?: string;
}

/** (0.6.7 AD-VITALS) One detection episode as `activity.fromGauge` takes it. */
export interface ActivityDetectionInput {
  id: string;
  revision: number;
  detector: string;
  start: number;
  end: number;
  state: 'final';
  label: string;
  alternatives?: string[];
  existence: number;
  typeScore: number;
  level: 'low' | 'medium' | 'high';
  reasons?: string[];
  coverage?: { phone?: number; ring?: number; hr?: number; ar?: number; gps?: number };
  evidenceHash?: string;
  recordingRefs?: string[];
}

/** (contract F3) What step fusion is told: the approved bouts by kind and the person's D1 settings. */
export interface StepsFuseContext {
  activities: GaugeFuseActivity[];
  preference: NonNullable<GaugeStepsFuseRequest['preference']>;
  /** D3: the day's steps headline (`atLeast`: the server's headline; `located`: only steps placed in time). */
  headline: 'atLeast' | 'located';
  /** (SPEC §2.3 4(a)) The person's in-force step corrections around the range (`log.stepsCorrection`). */
  corrections?: GaugeFuseCorrection[];
}

export const GAUGE_IMPORT_KEY = 'vitals.gaugeImport.v1';
export const GAUGE_IMPORT_INTERVAL_MS = 5 * 60_000;
export const GAUGE_BACKFILL_DAYS = 30;
/** Later runs re-read this many days before the last imported day. */
export const GAUGE_OVERLAP_DAYS = 2;

/** (r063 S13) One retraction the import applied because the source was deleted upstream (this device's audit trail). */
export interface GaugeRetraction {
  ref: string;
  kind: GaugeChange['kind'];
  /** When the source said it was deleted (ISO), if it said. */
  deletedAt: string | null;
  /** When this device applied it (ISO). */
  appliedAt: string;
}

/** The audit trail keeps the newest this many retractions. */
export const GAUGE_RETRACTIONS_KEPT = 200;

export interface GaugeImportState {
  /** The server and person whose watermarks and change cursor these are (absent in older device-local state). */
  identity?: string;
  /** When this device last finished an import (ISO), null when never. */
  lastImportAt: string | null;
  /** The last app day it imported (advanced only by a complete run, r063 S15). */
  lastDate: string | null;
  /** The first run filled the last 30 days (every feed succeeded once over them). */
  backfilled: boolean;
  /** (r063 S13) The change feed's cursor (null: none yet). */
  changesCursor?: string | null;
  /** (r063 S13) The retractions applied, newest last. */
  retractions?: GaugeRetraction[];
  /**
   * (r063 S14/A21) Per feed, the last app day through which it imported successfully. A feed whose read failed keeps its
   * old day, so the next run reads it again from there (absent on a state written before r063: `lastDate` stands in).
   */
  feeds?: Partial<Record<GaugeFeed, string>>;
  /**
   * (r063 S14/A21) The rotating reconcile of the 30-day correction window: the oldest day of the next chunk to re-read and
   * when the last chunk was read (ISO). It advances only when every feed of the chunk succeeded.
   */
  reconcile?: { next: string | null; at: string | null };
  /** (0.6.3 FX1, sR02/aR04) A resync in progress: the feed cursor to save once every imported ref was checked. */
  resync?: GaugeResync;
  /** (0.6.3 FX1, sR14/aR04) The minute timelines still to read for activity evidence (bounded, oldest first). */
  evidence?: GaugeEvidenceQueue;
  /**
   * (0.6.7 AD-VITALS) The detector the server last advertised (`detect/2`): kept so a run whose detections read failed
   * still leaves the local detect/1 off (never both); cleared when the server says it has no detections route.
   */
  detector?: string;
}

/**
 * (0.6.3 FX1) A resync in progress (`v` 1): `target` is the feed cursor to save when it completes; `after` the last
 * imported ref (`<kind>:<id>`, sorted) already checked; `at` when it began (ISO).
 */
export interface GaugeResync {
  v: 1;
  target: string;
  after: string | null;
  at: string;
}

/** (0.6.3 FX1) The pending-evidence queue (`v` 1): local dates whose minute timelines a run still has to read. */
export interface GaugeEvidenceQueue {
  v: 1;
  dates: Array<{ date: string; at: string }>;
}

/** (FX1) The queue keeps at most this many dates (P: a few runs' worth; dates leave it as the 30-day window moves on). */
export const GAUGE_EVIDENCE_QUEUE_MAX = 64;
/** (FX1) A resync checks at most this many pages of `GAUGE_STATE_MAX_REFS` imported refs a run (P). */
export const GAUGE_RESYNC_PAGES_PER_RUN = 10;

/** (r063 S14/A21) The import's feeds, each tracked on its own: ring day totals, sleep, fused steps, detected activities. */
export type GaugeFeed = 'ring' | 'sleep' | 'steps' | 'activities';
/** One chunk of the correction window re-read per reconcile (P: 3-4 requests of a week each). */
export const GAUGE_RECONCILE_CHUNK_DAYS = 7;
/** A reconcile chunk runs at most this often (P), so the whole 30-day window is revisited every few hours of use. */
export const GAUGE_RECONCILE_INTERVAL_MS = 60 * 60_000;
/** At most this many older days get their minute timelines for new or revised workouts in one run (P). */
export const GAUGE_REVISED_TIMELINE_DAYS = 7;

export type GaugeImportOutcome =
  | { ran: true; from: string; to: string; created: number; skipped: number; activities?: { created: number; updated: number }; reconciled?: { from: string; to: string; ok: boolean } }
  | { ran: false; reason: 'off' | 'not_paired' | 'offline' | 'busy' | 'failed' | 'identity_changed' | 'data_replaced' };

export interface GaugeImportDeps {
  /** The client; the §2.2 routes (`steps`, `timeline`, `hc`) are used when it has them. */
  api: GaugeApi & Partial<GaugeV2Api>;
  /** Runs `activity.fromGauge`; resolves its output, or null when the command failed (absent = no activity import). */
  activityImporter?: (input: ActivityImportInput) => Promise<{ created: unknown[]; updated: unknown[] } | null>;
  /** The person's zone (local dates of fused intervals, `tz` of every read); default the runtime zone. */
  tz?: () => string;
  /** (audit F12) The app day's rollover hour (`settings.dayRolloverH`): fused steps are written on app days. Default 4. */
  rolloverH?: () => number;
  /** (contract F3) Approved bouts and the D1/D3 settings for `POST /steps/fuse`; absent = none (the server's defaults). */
  stepsContext?: (from: string, to: string) => Promise<StepsFuseContext | null> | StepsFuseContext | null;
  /** D13 (`settings.importHcWeight`): also bring Health Connect weight in as device measurements. Absent = off. */
  hcWeight?: () => boolean;
  /**
   * (r063 S13) Removes the imported weights of these Health Connect records (deleted upstream; `log.retract`, restorable);
   * resolves how many were removed, or null when it failed. Absent = weights are not retracted.
   */
  retractWeights?: (hcIds: string[]) => Promise<number | null>;
  enabled: () => boolean;
  today: () => string;
  /**
   * Runs `log.fromGauge`; resolves its output, or null when the command failed. (FX1) `answered`: what the server answered
   * in full this run (the steps app days, the sleep wake dates), so entries it no longer supports are retracted.
   */
  importer: (input: { steps: GaugeStepsDay[]; sleep: GaugeSleepEpisode[]; weights?: Array<{ id: string; at: string; kg: number; origin?: string }>; answered?: { steps?: string[]; sleep?: { from: string; to: string } } }) => Promise<{ created: unknown[]; skipped: unknown[] } | null>;
  /**
   * (0.6.3 FX1, sR02/aR04) What this person imported that a resync checks: the source refs of activities still counted
   * or waiting (`gauge:<id>`, `hc:<id>`) and the Health Connect ids of the weights in force. Null when it cannot be read.
   */
  importedRefs?: () => Promise<{ activities: string[]; weights: string[] } | null>;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  /** The paired server and person; injectable for import lifecycle tests. */
  identity?: () => string | null;
}

const EMPTY: GaugeImportState = { lastImportAt: null, lastDate: null, backfilled: false };
/** (FX1) The longest feed cursor kept (a cursor inside a deletion is longer than `c1.<seq>.<rowid>`). */
const GAUGE_CURSOR_MAX = 128;

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readGaugeImportState(storage: Pick<Storage, 'getItem'> | null = defaultStorage(), identity: string | null = null): GaugeImportState {
  try {
    const raw = storage?.getItem(GAUGE_IMPORT_KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<GaugeImportState>;
    // An old unscoped state is deliberately backfilled again when a person is paired. Import commands dedupe source
    // references, whereas trusting another pairing's cursor could permanently skip its older days and deletions.
    if ((typeof v.identity === 'string' ? v.identity : null) !== identity) return EMPTY;
    const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
    const feeds: Partial<Record<GaugeFeed, string>> = {};
    for (const f of ['ring', 'sleep', 'steps', 'activities'] as const) if (isDate(v.feeds?.[f])) feeds[f] = v.feeds![f]!;
    const rc = v.reconcile;
    const retractions = Array.isArray(v.retractions) ? v.retractions.filter((r): r is GaugeRetraction => isObj(r) && typeof r.ref === 'string' && typeof r.appliedAt === 'string').slice(-GAUGE_RETRACTIONS_KEPT) : [];
    // (FX1) the resync and the evidence queue are versioned: another version (or a malformed one) reads as none
    const rs = v.resync;
    const resync = isObj(rs) && rs.v === 1 && typeof rs.target === 'string' && rs.target.length <= GAUGE_CURSOR_MAX && (rs.after === null || (typeof rs.after === 'string' && rs.after.length <= 240)) && typeof rs.at === 'string'
      ? { v: 1 as const, target: rs.target, after: rs.after as string | null, at: rs.at } : null;
    const ev = v.evidence;
    const evidence = isObj(ev) && ev.v === 1 && Array.isArray(ev.dates)
      ? ev.dates.filter((x): x is { date: string; at: string } => isObj(x) && isDate(x.date) && typeof x.at === 'string').slice(-GAUGE_EVIDENCE_QUEUE_MAX) : [];
    return {
      ...(identity ? { identity } : {}),
      lastImportAt: typeof v.lastImportAt === 'string' ? v.lastImportAt : null,
      lastDate: isDate(v.lastDate) ? v.lastDate : null,
      backfilled: v.backfilled === true,
      ...(typeof v.changesCursor === 'string' && v.changesCursor.length <= GAUGE_CURSOR_MAX ? { changesCursor: v.changesCursor } : {}),
      ...(retractions.length ? { retractions } : {}),
      ...(Object.keys(feeds).length > 0 ? { feeds } : {}),
      ...(rc && typeof rc === 'object' ? { reconcile: { next: isDate(rc.next) ? rc.next : null, at: typeof rc.at === 'string' ? rc.at : null } } : {}),
      ...(resync ? { resync } : {}),
      ...(evidence.length ? { evidence: { v: 1 as const, dates: evidence.map((x) => ({ date: x.date, at: x.at })) } } : {}),
      ...(typeof v.detector === 'string' && /^detect\/\d{1,3}$/.test(v.detector) ? { detector: v.detector } : {}),
    };
  } catch {
    return EMPTY;
  }
}

const listeners = new Set<() => void>();
let snapshot: GaugeImportState | null = null;
onDataReplaced(() => {
  snapshot = null;
  setLiveTodaySteps(null);
  listeners.forEach((listener) => listener());
});

/** The device's import state (stable object between changes, for `useSyncExternalStore`). */
export function gaugeImportState(): GaugeImportState {
  const identity = gaugeIdentity();
  if (!snapshot || (snapshot.identity ?? null) !== identity) snapshot = readGaugeImportState(defaultStorage(), identity);
  return snapshot;
}

export function subscribeGaugeImport(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function save(storage: GaugeImportDeps['storage'], s: GaugeImportState): void {
  snapshot = s;
  try {
    storage?.setItem(GAUGE_IMPORT_KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the state lives on in memory this session
  }
  listeners.forEach((l) => l());
}

/**
 * The days to read: the last 30 on the first run, else from two days before the OLDEST feed's last successful day (a
 * failed feed is read again from where it stopped), never more than 30. `feeds` lists the feeds this run has (default
 * all four; a state without per-feed days uses `lastDate` for each).
 */
export function importWindow(state: GaugeImportState, today: string, feeds: readonly GaugeFeed[] = ['ring', 'sleep', 'steps', 'activities']): { from: string; to: string } {
  const earliest = addDays(today, -(GAUGE_BACKFILL_DAYS - 1));
  if (!state.backfilled || !state.lastDate) return { from: earliest, to: today };
  let last = state.lastDate < today ? state.lastDate : today;
  if (state.feeds) for (const f of feeds) {
    const d = state.feeds[f];
    // a feed that never succeeded on this device is read over the whole window
    if (!d) return { from: earliest, to: today };
    if (d < last) last = d;
  }
  const from = addDays(last, -GAUGE_OVERLAP_DAYS);
  return { from: from < earliest ? earliest : from, to: today };
}

/**
 * (r063 S14/A21) The reconcile chunk due now, or null: once the window is filled, at most every
 * `GAUGE_RECONCILE_INTERVAL_MS`, the next `GAUGE_RECONCILE_CHUNK_DAYS` days of the 30-day correction window older than
 * the recent window, rotating from the oldest day (so a late correction or upload anywhere in the advertised window is read
 * again within a few hours, at a bounded 3-4 requests a chunk). `next` is where the following chunk starts.
 */
export function reconcileWindow(state: GaugeImportState, today: string, recentFrom: string, nowMs: number): { from: string; to: string; next: string } | null {
  if (!state.backfilled) return null;
  const at = state.reconcile?.at ? Date.parse(state.reconcile.at) : Number.NaN;
  if (Number.isFinite(at) && nowMs - at < GAUGE_RECONCILE_INTERVAL_MS) return null;
  const earliest = addDays(today, -(GAUGE_BACKFILL_DAYS - 1));
  if (!(earliest < recentFrom)) return null;
  let from = state.reconcile?.next ?? earliest;
  if (from < earliest || from >= recentFrom) from = earliest;
  let to = addDays(from, GAUGE_RECONCILE_CHUNK_DAYS - 1);
  if (to >= recentFrom) to = addDays(recentFrom, -1);
  const after = addDays(to, 1);
  return { from, to, next: after >= recentFrom ? earliest : after };
}

let running: Promise<GaugeImportOutcome> | null = null;
let runningIdentity: string | null = null;
let runningGeneration = 0;

class PairingChanged extends Error {}
class DataReplaced extends Error {}

/** One import now; a pulse can request a guarded fresh read after any already-running import. */
export function runGaugeImport(deps: Partial<GaugeImportDeps> = {}, afterCurrent?: () => boolean): Promise<GaugeImportOutcome> {
  if (externalRestoreRequired()) return Promise.resolve({ ran: false, reason: 'data_replaced' });
  if (restoreInProgress()) return Promise.resolve({ ran: false, reason: 'busy' });
  const generation = writeGeneration();
  const identity = (deps.identity ?? gaugeIdentity)();
  // A data pulse needs a read begun after the pulse, not a joined run that already read detections.
  if (running && afterCurrent) {
    const next = () => {
      if (!afterCurrent()) return { ran: false as const, reason: 'busy' as const };
      if (generation !== writeGeneration()) return { ran: false as const, reason: 'data_replaced' as const };
      if ((deps.identity ?? gaugeIdentity)() !== identity) return { ran: false as const, reason: 'identity_changed' as const };
      return runGaugeImport(deps);
    };
    return running.then(next, next);
  }
  if (running) return runningIdentity === identity && runningGeneration === generation ? running : running.then(() => runGaugeImport(deps), () => runGaugeImport(deps));
  runningIdentity = identity;
  runningGeneration = generation;
  running = importOnce(deps, identity, generation)
    .catch((e: unknown) => {
      if (e instanceof DataReplaced) return { ran: false as const, reason: 'data_replaced' as const };
      if (e instanceof PairingChanged) return { ran: false as const, reason: 'identity_changed' as const };
      throw e;
    })
    .then((o) => {
      // (0.6.3 S28) the screens reading Gauge data (Ring, Progress) ask again after a successful import
      if (o.ran) void import('@/net/gaugeIdentity').then((m) => m.notifyGaugeDataChanged()).catch(() => undefined);
      return o;
    })
    .finally(() => {
      running = null;
      runningIdentity = null;
    });
  return running;
}

async function defaultDeps(): Promise<GaugeImportDeps> {
  const generation = writeGeneration();
  const [{ dispatch, currentDay }, { timeZone }, { settingsValues }] = await Promise.all([import('@/commands'), import('@/commands/bus'), import('./internal/settings')]);
  return {
    api: gaugeApi,
    tz: () => timeZone(),
    rolloverH: () => rolloverOf(settingsValues()),
    stepsContext: async (from, to) => {
      const { readDocs } = await import('@/commands/living');
      const s = settingsValues();
      const docs = await readDocs(currentDay());
      return {
        activities: fuseActivitiesOf(docs.entries, from, to),
        corrections: fuseCorrectionsOf(docs.entries, from, to),
        preference: { stepsPreference: [...s.stepsPreference], soleSustainedGait: s.soleSustainedGait },
        headline: s.stepsHeadline,
      };
    },
    enabled: () => settingsValues().gaugeImport !== false,
    hcWeight: () => settingsValues().importHcWeight !== false,
    retractWeights: async (hcIds) => {
      const [{ readDocs }, { effectiveEntries }] = await Promise.all([import('@/commands/living'), import('@/living/logs')]);
      const keys = new Set(hcIds.map((id) => `hc:weight:${id}`));
      const docs = await readDocs(currentDay());
      const live = effectiveEntries(docs.measurements).filter((m) => m.metric === 'weightKg' && m.source?.by === 'device' && typeof m.source.deviceKey === 'string' && keys.has(m.source.deviceKey));
      let n = 0;
      for (const m of live) {
        assertCurrentWrite(generation);
        const r = await dispatch('log.retract', { entryId: m.id }, { actor: { kind: 'system', id: 'gauge-import' } });
        if (!r.ok) return null;
        n++;
      }
      return n;
    },
    importedRefs: async () => {
      const [{ readDocs }, { readCandidates }, { effectiveEntries }, ac] = await Promise.all([import('@/commands/living'), import('@/commands/living/activity'), import('@/living/logs'), import('@/living/activityCandidates')]);
      const s = await readCandidates();
      const activities = new Set<string>();
      for (const r of s.records) {
        if (r.status !== 'pending' && r.status !== 'possible' && r.status !== 'approved' && r.status !== 'edited') continue;
        for (const ref of ac.sourceRefsOf(r)) if (ac.isDeletableRef(ref)) activities.add(ref);
      }
      const docs = await readDocs(currentDay());
      const weights = effectiveEntries(docs.measurements).flatMap((m) => (m.metric === 'weightKg' && m.source?.by === 'device' && typeof m.source.deviceKey === 'string' && m.source.deviceKey.startsWith('hc:weight:') ? [m.source.deviceKey.slice('hc:weight:'.length)] : []));
      return { activities: [...activities], weights: [...new Set(weights)] };
    },
    today: () => currentDay(),
    importer: async (input) => {
      assertCurrentWrite(generation);
      const r = await dispatch('log.fromGauge', input, { actor: { kind: 'system', id: 'gauge-import' } });
      return r.ok && 'output' in r ? (r.output as { created: unknown[]; skipped: unknown[] }) : null;
    },
    activityImporter: async (input) => {
      assertCurrentWrite(generation);
      const r = await dispatch('activity.fromGauge', input, { actor: { kind: 'system', id: 'gauge-import' } });
      // (r070) what came in is decided at once, as Google Fit counts its own sessions (never a review); a failure here
      // leaves the import as it is and the next one decides again
      assertCurrentWrite(generation);
      if (r.ok) await dispatch('activity.autoAccept', {}, { actor: { kind: 'system', id: 'gauge-import' } }).catch(() => null);
      return r.ok && 'output' in r ? (r.output as { created: unknown[]; updated: unknown[] }) : null;
    },
    storage: defaultStorage(),
    now: () => Date.now(),
  };
}

async function importOnce(over: Partial<GaugeImportDeps>, identity: string | null, generation: number): Promise<GaugeImportOutcome> {
  const needDefaults = !over.api || !over.enabled || !over.today || !over.importer || over.storage === undefined || !over.now;
  const d: GaugeImportDeps = needDefaults ? { ...(await defaultDeps()), ...over } : (over as GaugeImportDeps);
  if (!d.enabled()) return { ran: false, reason: 'off' };
  const identityOf = d.identity ?? gaugeIdentity;
  const assertIdentity = () => {
    if (generation !== writeGeneration() || restoreInProgress() || externalRestoreRequired()) throw new DataReplaced();
    if (identityOf() !== identity) throw new PairingChanged();
  };
  assertIdentity();
  const state = readGaugeImportState(d.storage, identity);
  const today = d.today();
  const feeds = feedsOf(d);
  const { from, to } = importWindow(state, today, feeds);
  const tz = d.tz?.() ?? localZone();
  const nowMs = d.now();
  // (r063 S14/A21) workouts new or revised since the last import get their minute timelines whatever their age
  const revisedSince = state.lastImportAt ? Date.parse(state.lastImportAt) : null;
  // Keep the historical correction due, but read current activity before that older chunk.
  const rc = reconcileWindow(state, today, from, nowMs);
  // (r063 S13) what was deleted upstream since the last run: weights are removed here, activities withdraw it in the
  // recent window's import; the feed's cursor only advances once its deletions landed. (FX1) A resync in progress (or
  // one the feed asks for) checks the imported refs first, and the feed waits until it is done
  let resync: GaugeResync | null = state.resync ?? null;
  const feed = !resync && d.api.changes ? await d.api.changes(state.changesCursor ?? null, { cached: false, tz }).catch(() => null) : null;
  if (feed?.resync) resync = { v: 1, target: feed.cursor, after: null, at: new Date(nowMs).toISOString() };
  const checked = resync ? await resyncPages(d, resync, tz) : null;
  assertIdentity();
  const deleted = uniqueChanges([...(feed?.changes ?? []).filter((c) => c.change === 'deleted'), ...(checked?.deleted ?? [])]);
  const retracted: GaugeRetraction[] = [];
  let applied = true;
  const goneWeights = deleted.filter((c) => c.kind === 'hcWeight');
  if (goneWeights.length) {
    assertIdentity();
    const n = d.retractWeights ? await d.retractWeights(goneWeights.map((c) => c.id)).catch(() => null) : 0;
    assertIdentity();
    if (n === null) applied = false;
    else if (d.retractWeights) retracted.push(...goneWeights.map((c) => retraction(c, d.now())));
  }
  const goneActivities = deleted.filter((c) => c.kind !== 'hcWeight');
  // (FX1, sR14/aR04) the evidence still owed: the queue, plus what the feed reports revised (its days get their timelines)
  const earliest = addDays(today, -(GAUGE_BACKFILL_DAYS - 1));
  const revisedDays = revisedChangeDates(feed?.changes ?? [], tz);
  const queued = (state.evidence?.dates ?? []).filter((x) => x.date >= earliest && x.date <= today);
  const recent = await importRange(d, from, to, today, tz, revisedSince, goneActivities.map((c) => c.ref), { serverDetector: state.detector ?? null, live: true }, assertIdentity);
  assertIdentity();
  const recentProblem = recent.kind === 'unanswered' ? d.api.status().problem : null;
  // Recent detections and summaries reach the store before slower historical reconciliation.
  // Keep writes serialized and finish the due chunk before advancing any run watermarks.
  const chunk = rc ? await importRange(d, rc.from, rc.to, today, tz, revisedSince, [], { serverDetector: state.detector ?? null }, assertIdentity) : null;
  assertIdentity();
  if (recent.kind === 'unanswered') {
    const problem = recentProblem;
    // (FX1, aR11) refused (unpaired, revoked, not allowed): today's live snapshot goes; offline keeps it
    if (problem === 'not_paired' || problem === 'unauthorized') setLiveTodaySteps(null);
    return { ran: false, reason: problem === 'not_paired' ? 'not_paired' : 'offline' };
  }
  if (recent.kind === 'failed') return { ran: false, reason: 'failed' };
  if (goneActivities.length) {
    if (recent.deletedApplied) retracted.push(...goneActivities.map((c) => retraction(c, d.now())));
    else applied = false;
  }
  // (FX1, sR14/aR04) the queued days this run did not read already: one bounded evidence pass
  const readNow = new Set([...recent.evidence.read, ...(chunk?.kind === 'imported' ? chunk.evidence.read : [])]);
  const due = [...new Set([...queued.map((x) => x.date), ...revisedDays])].filter((x) => x >= earliest && x <= today && !readNow.has(x)).sort().slice(0, GAUGE_REVISED_TIMELINE_DAYS);
  // (0.6.7 AD-VITALS) the detector known after the recent read: the evidence pass keeps detect/1 off with it too
  const detectorNow = recent.detector === undefined ? (state.detector ?? null) : recent.detector;
  const pass = due.length && d.activityImporter ? await evidencePass(d, due, today, tz, detectorNow, assertIdentity) : null;
  assertIdentity();
  for (const x of pass?.read ?? []) readNow.add(x);
  const owed = [
    ...queued.map((x) => x.date), ...revisedDays, ...recent.evidence.failed, ...recent.evidence.deferred,
    ...(chunk?.kind === 'imported' ? [...chunk.evidence.failed, ...chunk.evidence.deferred] : []), ...(pass?.failed ?? []),
  ];
  // (without an activity import nothing reads the timelines: nothing is owed)
  const evidence = d.activityImporter ? nextEvidenceQueue(queued, owed, readNow, earliest, today, new Date(nowMs).toISOString()) : [];
  const trail = [...(state.retractions ?? []), ...retracted].slice(-GAUGE_RETRACTIONS_KEPT);
  // (r063 S14/A21) each feed advances only on its own success; the reconcile cursor only when its whole chunk succeeded
  const nextFeeds: Partial<Record<GaugeFeed, string>> = { ...(state.feeds ?? (state.backfilled && state.lastDate ? Object.fromEntries(feeds.map((f) => [f, state.lastDate!])) : {})) };
  for (const f of feeds) if (recent.ok[f]) nextFeeds[f] = today;
  const chunkOk = chunk !== null && chunk.kind === 'imported' && feeds.every((f) => chunk.ok[f]);
  const reconcile = rc ? { next: chunkOk ? rc.next : rc.from, at: new Date(nowMs).toISOString() } : state.reconcile;
  // (FX1, sR02/aR04) the cursor: a resync saves its target only once every imported ref was checked and what was deleted
  // landed (its progress is kept between runs); the feed's own cursor once its deletions landed
  let cursor = state.changesCursor ?? null;
  let resyncNext: GaugeResync | null = resync;
  if (resync && checked) {
    if (applied && (checked.done || checked.unsupported)) {
      cursor = resync.target;
      resyncNext = null;
    } else if (applied) resyncNext = { ...resync, after: checked.after };
  } else if (feed && applied) cursor = feed.cursor;
  save(d.storage, {
    ...(identity ? { identity } : {}),
    lastImportAt: new Date(nowMs).toISOString(),
    // (r063 S15) the watermark moves only when every feed of the recent window succeeded (each feed keeps its own day too)
    lastDate: feeds.every((f) => recent.ok[f]) ? today : state.lastDate,
    backfilled: state.backfilled || feeds.every((f) => recent.ok[f]),
    feeds: nextFeeds,
    ...(reconcile ? { reconcile } : {}),
    ...(cursor ? { changesCursor: cursor } : {}),
    ...(trail.length ? { retractions: trail } : {}),
    ...(resyncNext ? { resync: resyncNext } : {}),
    ...(evidence.length ? { evidence: { v: 1, dates: evidence } } : {}),
    // (0.6.7 AD-VITALS) what the detections read said this run; an unanswered read keeps what was known
    ...(detectorNow ? { detector: detectorNow } : {}),
  });
  const created = recent.created + (chunk?.kind === 'imported' ? chunk.created : 0);
  const skipped = recent.skipped + (chunk?.kind === 'imported' ? chunk.skipped : 0);
  const act = [recent, chunk].flatMap((x) => (x && x.kind === 'imported' && x.activities ? [x.activities] : []));
  return {
    ran: true,
    from,
    to,
    created,
    skipped,
    ...(act.length > 0 ? { activities: { created: act.reduce((a, x) => a + x.created, 0), updated: act.reduce((a, x) => a + x.updated, 0) } } : {}),
    ...(rc ? { reconciled: { from: rc.from, to: rc.to, ok: chunkOk } } : {}),
  };
}

/** (r063 S14/A21) The feeds this client has: ring totals and sleep always, fused steps with a steps route, activities with an importer. */
function feedsOf(d: GaugeImportDeps): GaugeFeed[] {
  return ['ring', 'sleep', ...(d.api.stepsFuse || d.api.steps ? (['steps'] as const) : []), ...(d.activityImporter ? (['activities'] as const) : [])];
}

type RangeResult =
  | { kind: 'unanswered' }
  | { kind: 'failed' }
  | { kind: 'imported'; created: number; skipped: number; ok: Record<GaugeFeed, boolean>; deletedApplied: boolean; activities?: { created: number; updated: number }; evidence: EvidenceOutcome; detector?: string | null };

/** (FX1) The minute timelines a pass read, could not read (failed) and left for a later run (over the per-run cap). */
export interface EvidenceOutcome {
  read: string[];
  failed: string[];
  deferred: string[];
}
const NO_EVIDENCE: EvidenceOutcome = { read: [], failed: [], deferred: [] };

/** One window's reads and imports (the recent days, or a reconcile chunk), with each feed's success. */
async function importRange(d: GaugeImportDeps, from: string, to: string, today: string, tz: string, revisedSince: number | null, feedDeleted: readonly string[], det: { serverDetector: string | null; live?: boolean }, assertIdentity: () => void): Promise<RangeResult> {
  // (FX1, aR11) whose reads these are: a snapshot read under one pairing is never kept under another
  const identity = (d.identity ?? gaugeIdentity)();
  const ctx = d.stepsContext ? await Promise.resolve(d.stepsContext(from, to)).catch(() => null) : null;
  assertIdentity();
  // (r063 S6) the person's context on the server first, so every fused read (this /steps included) uses the same one
  const stored = await pushFusionContext(d, today, tz, d.rolloverH?.() ?? DEFAULT_ROLLOVER_H);
  assertIdentity();
  // fresh answers only: a cached body would write nothing new, and "last import" must mean the server answered
  const [activity, sleep, fused] = await Promise.all([
    d.api.activity(from, to, { cached: false, tz }),
    // (FX1) two days before and one after: a night of every wake date in [from, to] is in the answer whatever day the
    // server dates it by (its 19:00 start rule, another zone), so the absence of one is a real absence
    d.api.sleep(addDays(from, -SLEEP_READ_MARGIN_BEFORE), addDays(to, 1), { cached: false, tz }),
    // (audit F12) one calendar day more: the small hours after `to` belong to the app day `to`
    readFusedSteps(d.api, from, addDays(to, 1), tz, ctx, stored, d.rolloverH?.() ?? DEFAULT_ROLLOVER_H),
  ]);
  assertIdentity();
  if (!activity && !sleep && !fused) return { kind: 'unanswered' };
  // (energy SPEC §V3.6) the fused headline of /steps per day, with its lineages; a day it lacks keeps the ring total
  const fusedDays = fusedStepsDays(fused, tz, ctx?.headline ?? 'atLeast', { rolloverH: d.rolloverH?.() ?? DEFAULT_ROLLOVER_H, from, to });
  // a day /steps answered keeps its fused value (or none), never the bare ring total
  const fusedDates = new Set((fused?.days ?? []).map((x) => x.date));
  const ringDays: GaugeStepsDay[] = (activity?.days ?? []).flatMap((day) => {
    const n = gaugeDaySteps(day);
    return n === null || fusedDates.has(day.date) ? [] : [{ date: day.date, steps: n }];
  });
  const steps: GaugeStepsDay[] = [...fusedDays, ...ringDays];
  // (FX1, sR03/aR05) the app days the fused read answered in full (every calendar day of each, its small hours included)
  const answeredSteps = fused ? answeredAppDays(fused, from, to) : [];
  // (r063 S27/A29) today's freshest reading as the live snapshot (the entry itself stays throttled); (FX1) cleared when the
  // server answered today in full with no steps (the evidence was deleted), never on a failed read
  const live = steps.find((x) => x.date === today);
  if (live) setLiveTodaySteps({ day: live, at: new Date(d.now()).toISOString() }, identity);
  else if (answeredSteps.includes(today)) setLiveTodaySteps(null);
  // (0.6.3 FX5) a night the ring missed comes from Health Connect (the server's fallback): its origin is its lineage
  const episodes: GaugeSleepEpisode[] = (sleep?.sessions ?? []).map((s) => ({ wakingDate: s.wakingDate, start: s.start, end: s.end, asleepMinutes: s.asleepMinutes, ...(s.source === 'healthConnect' && typeof s.origin === 'string' && s.origin ? { origin: s.origin.slice(0, 160) } : {}) }));
  const hcW = d.hcWeight?.() && d.api.hc ? await hcWeightsRead(d.api, from, to, tz) : { weights: [], complete: true };
  assertIdentity();
  let weightsOk = hcW.complete;
  // (r063 S15) log.fromGauge takes at most 400 weights: the rest in further calls (steps and sleep with the first)
  const weightBatches = chunks(hcW.weights, WEIGHTS_BATCH);
  // (FX1) `answered` only with the first call (it carries the steps and nights): the weight batches after it have none
  const answered = { ...(answeredSteps.length ? { steps: answeredSteps } : {}), ...(sleep ? { sleep: { from, to } } : {}) };
  const out = await d.importer({ steps, sleep: episodes, ...(weightBatches[0]?.length ? { weights: weightBatches[0] } : {}), ...(Object.keys(answered).length ? { answered } : {}) });
  assertIdentity();
  if (!out) return { kind: 'failed' };
  for (const w of weightBatches.slice(1)) {
    assertIdentity();
    if (!(await d.importer({ steps: [], sleep: [], weights: w }))) weightsOk = false;
    assertIdentity();
  }
  // (energy SPEC §V3.6) detected activities: Gauge workouts, Health Connect exercise sessions, the recent minute timelines;
  // (r063 S13) with the refs the change feed reports deleted upstream
  let activities: { created: number; updated: number } | undefined;
  let activitiesOk = !d.activityImporter;
  let evidence: EvidenceOutcome = NO_EVIDENCE;
  let detector: string | null | undefined;
  if (d.activityImporter) {
    const report: ActivityInputReport = {};
    const input = await activityInput(d.api, from, to, today, tz, { revisedSince, feedDeleted, report, serverDetector: det.serverDetector });
    assertIdentity();
    const ev = report.evidence ?? NO_EVIDENCE;
    detector = report.detections?.detector;
    // (0.6.7 AD-VITALS) the recent window's open episodes: Today's live line (only a read that answered replaces it)
    if (det.live && report.detections?.open) setLiveDetections(report.detections.open, identity);
    if (input) {
      assertIdentity();
      const r = await importActivities(d.activityImporter, input);
      assertIdentity();
      if (r) {
        activities = { created: r.created, updated: r.updated };
        // (r063 S15) a cut Health Connect read imports what came but does not count as a success; (FX1) nor does a
        // failed workouts read. A timeline that failed or was over the cap waits in the evidence queue instead
        activitiesOk = !input.truncated && report.complete?.workouts !== false;
        evidence = ev;
      } else evidence = { read: [], failed: [...ev.read, ...ev.failed], deferred: ev.deferred };
    } else evidence = ev;
  }
  const ok: Record<GaugeFeed, boolean> = { ring: !!activity && weightsOk, sleep: !!sleep, steps: !!fused || !(d.api.stepsFuse || d.api.steps), activities: activitiesOk };
  return { kind: 'imported', created: out.created.length, skipped: out.skipped.length, ok, deletedApplied: activities !== undefined, ...(activities ? { activities } : {}), evidence, ...(detector !== undefined ? { detector } : {}) };
}

const retraction = (c: GaugeChange, now: number): GaugeRetraction => ({ ref: c.ref, kind: c.kind, deletedAt: c.at, appliedAt: new Date(now).toISOString() });

const problemOf = (api: GaugeImportDeps['api']): string | null => {
  try {
    return typeof api.status === 'function' ? api.status().problem : null;
  } catch {
    return null;
  }
};

/** (FX1) The sleep read starts this many days before the window (the server dates a night by its start). */
const SLEEP_READ_MARGIN_BEFORE = 2;

/** Each change once (by kind and ref), the first kept. */
function uniqueChanges(xs: readonly GaugeChange[]): GaugeChange[] {
  const seen = new Set<string>();
  return xs.filter((c) => {
    const k = `${c.kind}\u0000${c.ref}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * (FX1, sR03/aR05) The app days in [from, to] the fused read answered in full: the server answered the calendar day and
 * the next one (an app day's small hours sit on the next calendar date). Days it did not answer are not listed, so their
 * entries are never retracted.
 */
export function answeredAppDays(fused: GaugeSteps, from: string, to: string): string[] {
  const days = new Set((fused.days ?? []).map((x) => x.date));
  const out: string[] = [];
  for (let x = from; x <= to; x = addDays(x, 1)) if (days.has(x) && days.has(addDays(x, 1))) out.push(x);
  return out;
}

/** (FX1, aR04) The local dates of workouts and Health Connect sessions the feed reports revised (their timelines are owed). */
export function revisedChangeDates(changes: readonly GaugeChange[], tz: string): string[] {
  const out = new Set<string>();
  for (const c of changes) {
    if (c.change !== 'revised' || c.kind === 'hcWeight') continue;
    for (const t of [c.start, c.end]) {
      const ms = typeof t === 'string' ? Date.parse(t) : Number.NaN;
      if (!Number.isFinite(ms)) continue;
      try {
        out.add(instantToLocal(new Date(ms).toISOString(), tz).date);
      } catch {
        // a zone the runtime cannot read: no targeted day
      }
    }
  }
  return [...out].sort();
}

/**
 * (FX1, sR14/aR04) The next evidence queue: what was owed and not read this run, inside the 30-day window, each date
 * once (keeping when it was first queued), oldest first, at most `GAUGE_EVIDENCE_QUEUE_MAX` (the newest kept: the
 * oldest leave the window first).
 */
export function nextEvidenceQueue(queued: ReadonlyArray<{ date: string; at: string }>, owed: readonly string[], read: ReadonlySet<string>, earliest: string, today: string, nowIso: string): Array<{ date: string; at: string }> {
  const since = new Map(queued.map((x) => [x.date, x.at] as const));
  const dates = [...new Set(owed)].filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= earliest && x <= today && !read.has(x)).sort();
  return dates.slice(-GAUGE_EVIDENCE_QUEUE_MAX).map((date) => ({ date, at: since.get(date) ?? nowIso }));
}

/**
 * (FX1, sR02/aR04) One run of a resync: the imported refs after `r.after` (sorted as `<kind>:<id>`), at most
 * `GAUGE_RESYNC_PAGES_PER_RUN` pages of `GAUGE_STATE_MAX_REFS`, asked for their state now. Only `deleted` answers are
 * returned (unknown is never a deletion). `done` when every ref was checked; a failed page stops (`after` = the last page
 * that answered); `unsupported` when the server has no such route (an older server: the feed is followed as before).
 */
async function resyncPages(d: GaugeImportDeps, r: GaugeResync, tz: string): Promise<{ deleted: GaugeChange[]; after: string | null; done: boolean; unsupported: boolean }> {
  if (!d.api.changesState) return { deleted: [], after: r.after, done: false, unsupported: true };
  const refs = d.importedRefs ? await d.importedRefs().catch(() => null) : { activities: [], weights: [] };
  if (!refs) return { deleted: [], after: r.after, done: false, unsupported: false };
  // (r069) a session block's ref (`hc:<id>@<start>`) is its session's
  const keyOf = (ref: string): string | null => (ref.startsWith('gauge:') ? `workout:${ref.slice(6)}` : ref.startsWith('hc:') ? `hcExercise:${ref.slice(3).split('@')[0]}` : null);
  const keys = [...new Set([...refs.activities.map(keyOf), ...refs.weights.map((id) => `hcWeight:${id}`)])]
    .filter((k): k is string => k !== null && !k.includes(',') && k.length <= 240 && (r.after === null || k > r.after)).sort();
  const deleted: GaugeChange[] = [];
  let after = r.after;
  for (let p = 0; p < GAUGE_RESYNC_PAGES_PER_RUN && keys.length > 0; p++) {
    const batch = keys.splice(0, GAUGE_STATE_MAX_REFS);
    const ans = await d.api.changesState(batch.map((k): GaugeSubjectRef => {
      const i = k.indexOf(':');
      return { kind: k.slice(0, i) as GaugeSubjectRef['kind'], id: k.slice(i + 1) };
    }), { cached: false, tz }).catch(() => null);
    if (!ans) {
      if (d.api.status().problem === 'not_supported') return { deleted, after, done: false, unsupported: true };
      return { deleted, after, done: false, unsupported: false };
    }
    for (const a of ans) if (a.state === 'deleted') deleted.push({ kind: a.kind, id: a.id, ref: a.ref, change: 'deleted', start: null, end: null, at: a.at });
    after = batch.at(-1)!;
  }
  return { deleted, after, done: keys.length === 0, unsupported: false };
}

/**
 * (FX1, sR14/aR04) The evidence pass: the queued dates' minute timelines with the workouts and Health Connect sessions of
 * their span, through `activity.fromGauge`. Null when the import failed (the dates stay queued).
 */
async function evidencePass(d: GaugeImportDeps, dates: readonly string[], today: string, tz: string, serverDetector: string | null, assertIdentity: () => void): Promise<EvidenceOutcome | null> {
  if (!d.activityImporter || dates.length === 0) return null;
  const sorted = [...dates].sort();
  const report: ActivityInputReport = {};
  const input = await activityInput(d.api, sorted[0]!, sorted.at(-1)!, today, tz, { timelineDates: sorted, report, serverDetector });
  assertIdentity();
  if (!input) return { read: [], failed: [...sorted], deferred: [] };
  const r = await importActivities(d.activityImporter, input);
  assertIdentity();
  if (!r) return { read: [], failed: [...sorted], deferred: [] };
  return report.evidence ?? { read: [], failed: [...sorted], deferred: [] };
}

/** The command limits (`activity.fromGauge` 500 sessions of each kind and 500 deleted refs; `log.fromGauge` 400 weights). */
export const SESSIONS_BATCH = 500;
export const WEIGHTS_BATCH = 400;

const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * (r063 S15) `activity.fromGauge` in batches within its limits: at most 500 Gauge sessions, 500 Health Connect sessions
 * and 500 deleted refs per call; the minutes go with every call (the command is idempotent over the same evidence).
 * Null when any call failed.
 */
export async function importActivities(run: NonNullable<GaugeImportDeps['activityImporter']>, input: ActivityInputRead): Promise<{ created: number; updated: number } | null> {
  const { truncated: _t, ...rest } = input;
  void _t;
  const g = chunks(rest.gaugeSessions, SESSIONS_BATCH);
  const h = chunks(rest.hcSessions, SESSIONS_BATCH);
  const del = chunks(rest.deletedRefs ?? [], SESSIONS_BATCH);
  const n = Math.max(1, g.length, h.length, del.length);
  let created = 0;
  let updated = 0;
  for (let k = 0; k < n; k++) {
    const { deletedRefs: _d, ...base } = rest;
    void _d;
    const r = await run({ ...base, gaugeSessions: g[k] ?? [], hcSessions: h[k] ?? [], ...(del[k]?.length ? { deletedRefs: del[k] } : {}) });
    if (!r) return null;
    created += r.created.length;
    updated += r.updated.length;
  }
  return { created, updated };
}

/** (r063 S6) The fusion context covers this many days back from today (P: the Ring's month and the import's backfill). */
export const FUSION_CONTEXT_DAYS = 35;

/**
 * (r063 S6) Posts the person's fusion context for the last `FUSION_CONTEXT_DAYS` days (to tomorrow) to the server, which
 * keeps it for every fused read. True when the server holds it now; false without the route, context or an answer.
 */
async function pushFusionContext(d: Pick<GaugeImportDeps, 'api' | 'stepsContext'>, today: string, tz: string, rolloverH: number = DEFAULT_ROLLOVER_H): Promise<boolean> {
  if (!d.api.fusionContext || !d.stepsContext || externalRestoreRequired() || restoreInProgress()) return false;
  const generation = writeGeneration();
  const lo = addDays(today, -(FUSION_CONTEXT_DAYS - 1));
  const hi = addDays(today, 1);
  const c = await Promise.resolve(d.stepsContext(lo, hi)).catch(() => null);
  if (!c || generation !== writeGeneration() || externalRestoreRequired() || restoreInProgress()) return false;
  const r = await d.api.fusionContext({
    window: { start: `${lo}T00:00`, end: `${addDays(hi, 1)}T00:00` }, tz,
    activities: c.activities, corrections: c.corrections ?? [], preference: c.preference,
    // (r063 FX2 sR08/aR03) the person's rollover: fused reads break merged intervals there, so each is on one app day
    rolloverH,
  }, { tz }).catch(() => null);
  return r !== null;
}

/**
 * (r063 S6) Posts the fusion context now (after a decision or a step setting changed), outside a full import. Resolves
 * whether the server holds it.
 */
export async function syncFusionContext(deps: Partial<Pick<GaugeImportDeps, 'api' | 'stepsContext' | 'today' | 'tz' | 'enabled'>> = {}): Promise<boolean> {
  if (externalRestoreRequired() || restoreInProgress()) return false;
  const d = { ...(deps.api && deps.stepsContext && deps.today ? {} : await defaultDeps()), ...deps } as GaugeImportDeps;
  if (d.enabled && !d.enabled()) return false;
  return pushFusionContext(d, d.today(), d.tz?.() ?? localZone(), d.rolloverH?.() ?? DEFAULT_ROLLOVER_H);
}

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * (contract F3) The approved bouts of [from − 1, to + 1] as step-fusion context: every in-force session entry with a known
 * interval (an approved activity, an edit or a manual log with a clock), `locomotor` for a gait type of the catalogue
 * (`stepsLocomotor`), else `nonLocomotor`; a type the catalogue does not know is `unknown`. Skipped sessions never count.
 * `carry` (0.6.3 S7/A10) is the pocket/hand/desk choice saved in the activity sheet, when there is one.
 */
export function fuseActivitiesOf(entries: readonly LogEntry[], from: string, to: string): GaugeFuseActivity[] {
  const lo = addDays(from, -1);
  const hi = addDays(to, 1);
  const out: GaugeFuseActivity[] = [];
  for (const e of effectiveEntries(entries)) {
    if (e.kind !== 'session' || e.status === 'skipped' || e.assumed || e.date < lo || e.date > hi) continue;
    // (r063 S10/A15) a paused bout is its moving intervals: the pauses are no activity, so fusion treats them as ordinary time
    const parts = movingIntervalsOf(e);
    if (!parts) continue;
    const id = e.workout?.exerciseType ?? e.performed[0]?.exerciseId;
    const ex = id ? exerciseRecordOf(id) : undefined;
    const kind = ex ? (activityTraitsOf(ex).stepsLocomotor ? 'locomotor' : 'nonLocomotor') : 'unknown';
    // (0.6.3 S7/A10) the person's "Where was the phone?" travels with the bout (the entry carries the decision's choice)
    const carry = e.carry === 'pocket' || e.carry === 'hand' || e.carry === 'desk' ? e.carry : undefined;
    for (const m of parts) out.push({ start: new Date(m.start).toISOString(), end: new Date(m.end).toISOString(), kind, ...(carry ? { carry } : {}) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/** The server's limit on each context list of `POST /steps/fuse`. */
const FUSE_CONTEXT_MAX = 2000;

/**
 * (SPEC §2.3 4(a)) The person's in-force step corrections (`log.stepsCorrection`) dated in [from − 2, to + 1] (a correction
 * may span two days) as disjoint windows: where two overlap, the one made later wins its span (so "use the ring for the
 * day" after "use the phone for 08:00–09:00" covers that hour too, and the reverse keeps the hour). Sorted by start; the
 * newest 2000 windows when there are more (the server's limit).
 */
export function fuseCorrectionsOf(entries: readonly LogEntry[], from: string, to: string): GaugeFuseCorrection[] {
  const lo = addDays(from, -2);
  const hi = addDays(to, 1);
  const made: Array<{ s: number; t: number; use: string; at: string; id: string }> = [];
  for (const e of effectiveEntries(entries)) {
    if (e.kind !== 'stepsCorrection' || e.assumed || e.date < lo || e.date > hi) continue;
    const s = Date.parse(e.start);
    const t = Date.parse(e.end);
    if (!Number.isFinite(s) || !(t > s)) continue;
    made.push({ s, t, use: e.use, at: e.recordedAt ?? e.at ?? '', id: e.id });
  }
  made.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  let windows: Array<{ s: number; t: number; use: string }> = [];
  for (const m of made) {
    // cut the newer window out of the older ones, then add it
    windows = windows.flatMap((w) => (w.t <= m.s || w.s >= m.t ? [w] : [...(w.s < m.s ? [{ ...w, t: m.s }] : []), ...(w.t > m.t ? [{ ...w, s: m.t }] : [])]));
    windows.push({ s: m.s, t: m.t, use: m.use });
  }
  const out = windows.sort((a, b) => a.s - b.s).map((w) => ({ start: new Date(w.s).toISOString(), end: new Date(w.t).toISOString(), use: w.use }));
  return out.length > FUSE_CONTEXT_MAX ? out.slice(out.length - FUSE_CONTEXT_MAX) : out;
}

/**
 * The fused steps of the range: `POST /steps/fuse` with the activity context and the D1 preference when the client has
 * it (the client asks `GET /steps` itself when the server is older), else `GET /steps`; both in the device zone.
 */
async function readFusedSteps(api: GaugeImportDeps['api'], from: string, to: string, tz: string, ctx: StepsFuseContext | null, stored = false, rolloverH: number = DEFAULT_ROLLOVER_H): Promise<GaugeSteps | null> {
  try {
    // (r063 S6) the server holds the person's context: GET /steps is then exactly what the Ring and timelines read
    if (stored && api.steps) return await api.steps(from, to, { cached: false, tz });
    if (api.stepsFuse) return await api.stepsFuse({ from, to, tz, ...(ctx ? { activities: ctx.activities, preference: ctx.preference, ...(ctx.corrections?.length ? { corrections: ctx.corrections } : {}), rolloverH } : {}) }, { cached: false, tz });
    return api.steps ? await api.steps(from, to, { cached: false, tz }) : null;
  } catch {
    return null;
  }
}

/**
 * The fused days of `/steps` as import rows: the D3 headline (`atLeast`: the server's headline; `located`: the steps
 * placed in time), the fused day and the lineages its intervals used. A supported zero (the day has step coverage) is a
 * reading, so a correction to 0 replaces the old count; a day without coverage and without steps is not written.
 *
 * (audit F12) The rows are APP days: the located steps of the small hours (after midnight, before the rollover) move to
 * the app day they belong to (`appDayStepsOf`), so a walk at 01:00 and its approved session land on the same day. `from`
 * / `to` keep only those app days (the read asks one calendar day more, for the small hours after `to`).
 */
export function fusedStepsDays(fused: GaugeSteps | null, tz: string, headline: 'atLeast' | 'located' = 'atLeast', opts: { rolloverH?: number; from?: string; to?: string } = {}): GaugeStepsDay[] {
  if (!fused) return [];
  const days = appDayStepsOf({ intervals: fused.intervals ?? [], days: fused.days ?? [], tz, rolloverH: opts.rolloverH ?? DEFAULT_ROLLOVER_H });
  return days.flatMap((day) => {
    if ((opts.from && day.date < opts.from) || (opts.to && day.date > opts.to)) return [];
    const value = headline === 'located' ? day.located : day.headline;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return [];
    const supported = (day.coverage?.eitherMin ?? 0) > 0;
    if (value === 0 && !supported) return [];
    return [{
      date: day.date,
      steps: Math.round(value),
      fusion: {
        version: fused.fusionVersion,
        located: day.located,
        headlinePolicy: headline === 'located' ? 'located' : day.headlinePolicy,
        ...(day.ringDailyTotal !== undefined ? { ringDailyTotal: day.ringDailyTotal } : {}),
        ...(day.ringResidual !== undefined ? { ringResidual: day.ringResidual } : {}),
        ...(day.coverage ? { coverage: { ringMin: day.coverage.ringMin, phoneMin: day.coverage.phoneMin, eitherMin: day.coverage.eitherMin, unknownMin: day.coverage.unknownMin } } : {}),
        // (r063 A12) the real coverage spans: today's covered awake time is measured on them, not on the sleep entry
        ...(day.spans.length > 0 ? { spans: day.spans } : {}),
      },
      sources: day.lineages,
    }];
  });
}

/** Health Connect weight records of other apps (D13), for `log.fromGauge`'s device measurements. */
export async function hcWeights(api: GaugeImportDeps['api'], from: string, to: string, tz?: string): Promise<Array<{ id: string; at: string; kg: number; origin?: string }>> {
  return (await hcWeightsRead(api, from, to, tz)).weights;
}

/** (r063 S15) `hcWeights` with whether every page arrived (a failed or cut read is not complete). */
export async function hcWeightsRead(api: GaugeImportDeps['api'], from: string, to: string, tz?: string): Promise<{ weights: Array<{ id: string; at: string; kg: number; origin?: string }>; complete: boolean }> {
  const r = api.hc ? await api.hc('Weight', from, to, { cached: false, ...(tz ? { tz } : {}) }).catch(() => null) : null;
  return { weights: weightsOf(r), complete: !!r && r.truncated !== true };
}

function weightsOf(r: GaugeHc | null): Array<{ id: string; at: string; kg: number; origin?: string }> {
  return (r?.records ?? []).flatMap((x) => {
    const kg = isObj(x?.payload) ? x.payload.kg : undefined;
    const origin = typeof x?.originPackage === 'string' ? x.originPackage : '';
    if (typeof x?.id !== 'string' || !x.id || x.id.length > 120 || origin === 'com.pulseloop' || typeof kg !== 'number' || !Number.isFinite(kg) || kg < 20 || kg > 400 || typeof x.start !== 'string' || !Number.isFinite(Date.parse(x.start))) return [];
    return [{ id: x.id, at: new Date(Date.parse(x.start)).toISOString(), kg, ...(origin ? { origin: origin.slice(0, 120) } : {}) }];
  });
}

/** Health Connect's OTHER_WORKOUT: the generic type of a session whose type cannot be read. */
const HC_OTHER_WORKOUT = 0;
const ASLEEP = new Set(['light', 'deep', 'rem', 'asleepUnspecified']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * One Health Connect exercise session as `activity.fromGauge` takes it, or null when the record cannot be one (audit
 * Codex #1: one malformed record must not refuse the whole batch, so each record is checked against the command's schema
 * here and dropped alone). Lumen's own sessions are skipped (Gauge sends those itself).
 */
export function hcSessionOf(r: unknown): ActivityImportInput['hcSessions'][number] | null {
  if (!isObj(r) || typeof r.id !== 'string' || !r.id) return null;
  const origin = typeof r.originPackage === 'string' ? r.originPackage : typeof r.origin === 'string' ? r.origin : '';
  if (origin === 'com.pulseloop') return null;
  const start = typeof r.start === 'string' ? Date.parse(r.start) : Number.NaN;
  const end = typeof r.end === 'string' ? Date.parse(r.end) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
  const p = isObj(r.payload) ? r.payload : {};
  // (0.6.7 AD-VITALS) Gauge sends the symbolic name AND the code ("running_treadmill" + 57): the integer code first, then a
  // legacy integer `exercise_type`, then a known symbolic name (or "type_<n>"). A named type Vitals does not know is a
  // generic session (OTHER_WORKOUT, reviewed), never dropped; a record with no type, or a malformed one, is not a session
  const type = hcExerciseCodeOf(p.exercise_type_code) ?? hcExerciseCodeOf(p.exercise_type) ?? (typeof p.exercise_type === 'string' && /^[a-z0-9_]{1,64}$/i.test(p.exercise_type.trim()) ? HC_OTHER_WORKOUT : null);
  if (type === null) return null;
  const revision = typeof r.lastModified === 'string' && r.lastModified ? r.lastModified : `${start}|${end}`;
  // (r069) the session's segments: a session over two walks is two activities (its segments show the break)
  const segments = (Array.isArray(p.segments) ? p.segments : []).flatMap((g) => {
    const a = isObj(g) && typeof g.start === 'string' ? Date.parse(g.start) : Number.NaN;
    const b = isObj(g) && typeof g.end === 'string' ? Date.parse(g.end) : Number.NaN;
    return Number.isFinite(a) && Number.isFinite(b) && b > a ? [{ start: a, end: b }] : [];
  }).slice(0, 200);
  return {
    id: r.id,
    revision,
    start,
    end,
    exerciseType: type,
    originPackage: origin,
    ...(typeof p.title === 'string' ? { title: p.title.slice(0, 120) } : {}),
    ...(p.route_state === 'available' ? { hasRoute: true } : {}),
    ...(p.hasHr === true ? { hasHr: true } : {}),
    ...(segments.length ? { segments } : {}),
    // (r070) how the app recorded it (the person's own recording or entry is trusted first) and its laps
    ...(hcRecordingMethodOf(r.recordingMethod) ? { recordingMethod: hcRecordingMethodOf(r.recordingMethod)! } : {}),
    ...(Array.isArray(p.laps) && p.laps.length ? { laps: Math.min(p.laps.length, 10000) } : {}),
  };
}

/**
 * The `activity.fromGauge` input from the server's workouts, Health Connect sessions and recent minute timelines.
 * - `feedDeleted` (r063 S13): refs the change feed reports deleted upstream, added to `deletedRefs`.
 * - `truncated`: the Health Connect read was cut (a page did not arrive), so the input is not complete.
 * - (r063 S14/A21) A workout new or revised since `revisedSince` (the last import) also gets the timelines of its days
 *   whatever its age, at most `GAUGE_REVISED_TIMELINE_DAYS` older days a run, so a late upload can still be estimated.
 * - (FX1, sR14/aR04) `evidence` says which timelines were read, which failed and which were left over the cap (the caller
 *   queues them); `timelineDates` reads exactly those dates' timelines (the evidence pass), nothing recent or revised;
 *   `complete.workouts` is false when the workouts read failed.
 */
export type ActivityInputRead = ActivityImportInput & { truncated?: boolean };

/** (FX1) What `activityInput` reports beside its input (kept off the command input): the evidence and the workouts read. */
export interface ActivityInputReport {
  evidence?: EvidenceOutcome;
  complete?: { workouts: boolean };
  /**
   * (0.6.7 AD-VITALS) The detections read: the open episodes (Today's live line) and the server's detector (`detect/2`),
   * null when the server has no detections route (an older server: detect/1 runs). Absent when the read failed.
   */
  detections?: { open: LiveDetection[]; detector: string | null };
}

export async function activityInput(api: GaugeImportDeps['api'], from: string, to: string, today: string, tz?: string, opts: { revisedSince?: number | null; feedDeleted?: readonly string[]; timelineDates?: readonly string[]; report?: ActivityInputReport; serverDetector?: string | null } = {}): Promise<ActivityInputRead | null> {
  const feedDeleted = opts.feedDeleted ?? [];
  const tlFrom = addDays(today, -(GAUGE_TIMELINE_DAYS - 1));
  const dates: string[] = [];
  if (opts.timelineDates) dates.push(...[...new Set(opts.timelineDates)].sort());
  else for (let x = tlFrom < from ? from : tlFrom; x <= to; x = addDays(x, 1)) dates.push(x);
  const o = { cached: false, ...(tz ? { tz } : {}) };
  const [detectionsRead, workouts, hc, base, ...recentTimelines] = await Promise.all([
    // (0.6.7 AD-VITALS) the server's detection episodes of the window (every page)
    api.detections ? (api.detections({ from, to }, o).catch(() => null) as Promise<GaugeDetections | null>) : Promise.resolve(null),
    typeof api.workouts === 'function' ? (api.workouts(from, to, o).catch(() => null) as Promise<GaugeWorkouts | null>) : Promise.resolve(null),
    api.hc ? (api.hc('ExerciseSession', from, to, o).catch(() => null) as Promise<GaugeHc | null>) : Promise.resolve(null),
    api.baselines ? (api.baselines(today, o).catch(() => null) as Promise<GaugeBaselines | null>) : Promise.resolve(null),
    ...dates.map((date) => (api.timeline ? (api.timeline(date, o).catch(() => null) as Promise<GaugeTimeline | null>) : Promise.resolve(null))),
  ]);
  const revised = api.timeline && !opts.timelineDates ? revisedWorkoutDates(workouts, hc, opts.revisedSince ?? null, tz ?? localZone(), from, to).filter((x) => !dates.includes(x)) : [];
  // (FX1) over the cap: deferred to the evidence queue, never dropped
  const extra = revised.slice(0, GAUGE_REVISED_TIMELINE_DAYS);
  const deferred = revised.slice(GAUGE_REVISED_TIMELINE_DAYS);
  const extraTimelines = await Promise.all(extra.map((date) => api.timeline!(date, o).catch(() => null) as Promise<GaugeTimeline | null>));
  const timelines = [...recentTimelines, ...extraTimelines];
  const asked = [...dates, ...extra];
  const failedDates = new Set(api.timeline ? asked.filter((_, k) => !timelines[k]) : []);
  if (opts.report) opts.report.evidence = { read: [], failed: api.timeline ? [...dates, ...extra] : [], deferred };
  const det = detectionsInput(detectionsRead);
  // a server that answers the detections route runs detect/2 (contract §2), whether or not the page names it
  const answeredDetector = detectionsRead ? (detectionsRead.detector ?? 'detect/2') : null;
  if (opts.report) {
    if (detectionsRead) opts.report.detections = { open: det.open, detector: answeredDetector };
    else if (api.detections && problemOf(api) === 'not_supported') opts.report.detections = { open: [], detector: null };
  }
  // the detector the server advertises now, else the one it advertised before (a failed read never turns detect/1 back on)
  const serverDetector = detectionsRead ? answeredDetector : (opts.report?.detections ? null : (opts.serverDetector ?? null));
  if (!workouts && !hc && timelines.every((t) => !t) && feedDeleted.length === 0 && det.final.length === 0 && det.withdrawn.length === 0) return null;
  const ms = (x: unknown) => (typeof x === 'string' ? Date.parse(x) : Number.NaN);
  const fin = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const gaugeSessions = (workouts?.sessions ?? []).flatMap((w) => {
    if (!isObj(w) || typeof w.id !== 'string' || typeof w.type !== 'string') return [];
    const start = ms(w.start);
    const end = ms(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return [];
    const pauses = (Array.isArray(w.pauses) ? w.pauses : []).map((p) => ({ start: ms(p?.start), end: ms(p?.end) })).filter((p) => Number.isFinite(p.start) && p.end > p.start);
    const revision = typeof w.updatedAt === 'string' && w.updatedAt ? w.updatedAt : `${start}|${end}`;
    // (0.6.3 S26) Gauge 2.8.1 uploads `activity_type_id`; the server may hand it on as either spelling
    const picked = knownActivityTypeId((w as { activityTypeId?: unknown }).activityTypeId ?? (w as { activity_type_id?: unknown }).activity_type_id);
    return [{ id: w.id, revision, start, end, type: w.type, kcal: fin(w.kcal), distanceM: fin(w.distanceM), ...(pauses.length ? { pauses } : {}), ...(picked ? { activityTypeId: picked } : {}) }];
  });
  const hcSessions = (hc?.records ?? []).flatMap((r) => {
    const s = hcSessionOf(r);
    return s ? [s] : [];
  });
  const days = timelines.flatMap((t) => {
    if (!t || !t.start || !t.steps || !Array.isArray(t.steps.selected)) return [];
    const first = ms(t.start);
    if (!Number.isFinite(first)) return [];
    // (r063 S16/A19) the day's Health Connect speed and power with their quality (nothing when the day has none);
    // (0.6.3 FX5) and Gauge's own GPS route speed, kept apart (an activity takes one source)
    const motion = { ...hcMotionMinutes(t, t.steps.selected.length), ...gpsMotionMinutes(t, t.steps.selected.length) };
    return [{ t, first, steps: t.steps.selected, hrBpm: t.hr.bpm, hrSupportedS: t.hr.supportedS, asleep: t.sleep.stage.map((x) => x !== null && ASLEEP.has(x)), ...motion }];
  });
  // (Codex #11) each day's raw HR readings where the timeline has supported HR: zone time from each reading's interval
  const exactReads = await Promise.all(days.map((d) => dayHrExactRead(api, d.t, d.first, o)));
  const exact = exactReads.map((x) => x.segments);
  // (FX1) a day whose raw HR read failed is owed again (its estimate falls back to minute means meanwhile)
  days.forEach((d, k) => {
    if (exactReads[k]!.failed && d.t.date) failedDates.add(d.t.date);
  });
  const minutes = days.map(({ t: _t, ...d }, k) => {
    void _t;
    return { ...d, ...(exact[k] ? { hrExact: exact[k]! } : {}) };
  });
  // (0.6.3 FX5) the ring's sleeping low, else Health Connect's resting HR while the ring's is not ready (labelled)
  const proxy = restingProxyOf(base);
  const low = proxy?.bpm ?? null;
  // (0.6.3 FX5) the ring's sport windows outside every Gauge workout: the detector's telemetry branch
  const telemetry = (Array.isArray(workouts?.sportWindows) ? workouts.sportWindows : []).flatMap((w) => {
    if (!isObj(w) || typeof w.id !== 'string' || !w.id || w.workoutId) return [];
    const start = ms(w.start);
    const end = ms(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return [];
    return [{ id: w.id, revision: typeof w.revision === 'string' && w.revision ? w.revision : `${start}|${end}`, start, end }];
  });
  // (r063) sessions Health Connect deleted: a pending candidate built only on them is superseded, an approved one asks again
  // (r063 S13) and what the change feed reports deleted (Gauge workouts too); batched by `importActivities`
  const deletedRefs = [...new Set([...(Array.isArray(hc?.deleted) ? hc.deleted : []).flatMap((x) => (isObj(x) && typeof x.id === 'string' && x.id ? [`hc:${x.id}`] : [])), ...feedDeleted])];
  if (opts.report) {
    opts.report.evidence = { read: asked.filter((x) => api.timeline && !failedDates.has(x)), failed: [...failedDates].sort(), deferred };
    opts.report.complete = { workouts: typeof api.workouts !== 'function' || workouts !== null };
  }
  return { gaugeSessions, hcSessions, minutes, ...(det.final.length ? { detections: det.final } : {}), ...(det.withdrawn.length ? { withdrawnDetections: det.withdrawn } : {}), ...(serverDetector ? { serverDetector } : {}), ...(telemetry.length ? { telemetry: telemetry.slice(0, 500) } : {}), ...(low !== null ? { sleepingLowHr: low, ...(proxy?.source === 'healthConnect' ? { sleepingLowHrSource: 'healthConnect' as const } : {}) } : {}), ...(deletedRefs.length ? { deletedRefs } : {}), ...(api.hc && (!hc || hc.truncated) ? { truncated: true } : {}) };
}

/**
 * (0.6.7 AD-VITALS) The detections read as `activity.fromGauge` takes them: the final episodes (instants in epoch ms,
 * bounded to 500), the withdrawn ids, and the open episodes for Today's live line.
 */
export function detectionsInput(r: GaugeDetections | null): { final: ActivityDetectionInput[]; withdrawn: string[]; open: LiveDetection[] } {
  if (!r) return { final: [], withdrawn: [], open: [] };
  const final: ActivityDetectionInput[] = [];
  const open: LiveDetection[] = [];
  for (const e of r.episodes) {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    if (!Number.isFinite(start) || !(end > start)) continue;
    if (e.state === 'open') {
      open.push({ id: e.id, label: e.label, start, end });
      continue;
    }
    if (e.state !== 'final') continue;
    final.push({
      id: e.id,
      revision: e.revision,
      detector: e.detector,
      start,
      end,
      state: 'final',
      label: e.label,
      ...(e.alternatives.length ? { alternatives: e.alternatives } : {}),
      existence: e.existence,
      typeScore: e.typeScore,
      level: e.level,
      ...(e.reasons.length ? { reasons: e.reasons } : {}),
      ...(e.coverage ? { coverage: e.coverage } : {}),
      ...(e.evidenceHash ? { evidenceHash: e.evidenceHash } : {}),
      ...(e.recordingRefs?.length ? { recordingRefs: e.recordingRefs } : {}),
    });
  }
  return { final: final.slice(-GAUGE_DETECTIONS_MAX), withdrawn: r.withdrawn.slice(0, GAUGE_DETECTIONS_MAX), open };
}

/**
 * (r063 S14/A21) The local dates (start and end) of the workouts and Health Connect sessions in [from, to] that are new or
 * revised since `since` (their `updatedAt` / `lastModified`; every one when `since` is null or a record has no revision
 * time), newest first.
 */
export function revisedWorkoutDates(workouts: GaugeWorkouts | null, hc: GaugeHc | null, since: number | null, tz: string, from: string, to: string): string[] {
  const hits: Array<{ at: number; dates: string[] }> = [];
  const consider = (start: unknown, end: unknown, rev: unknown) => {
    const s = typeof start === 'string' ? Date.parse(start) : Number.NaN;
    const e = typeof end === 'string' ? Date.parse(end) : Number.NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    const r = typeof rev === 'string' ? Date.parse(rev) : Number.NaN;
    if (since !== null && Number.isFinite(r) && r <= since) return;
    try {
      const ds = [...new Set([instantToLocal(new Date(s).toISOString(), tz).date, instantToLocal(new Date(e).toISOString(), tz).date])].filter((x) => x >= from && x <= to);
      hits.push({ at: Number.isFinite(r) ? r : s, dates: ds });
    } catch {
      // a zone the runtime cannot read: no targeted day
    }
  };
  for (const w of workouts?.sessions ?? []) if (isObj(w)) consider(w.start, w.end, w.updatedAt);
  for (const r of hc?.records ?? []) if (isObj(r)) consider(r.start, r.end, r.lastModified);
  return [...new Set(hits.sort((a, b) => b.at - a.at).flatMap((h) => h.dates))];
}

/**
 * (Codex #11) The exact HR segments of one timeline day from `hr-intervals`, or null when they cannot stand for the day
 * (no such route, the read failed or came back truncated: the minute means are used and the estimate says so). Only the
 * span of the day's Gauge-supported minutes (and a minute either side: a sub-second support rounds to 0 s in the
 * timeline) is read, since outside it nothing has a declared cadence; a day without supported Gauge HR asks nothing and
 * has nothing exact to add: null.
 *
 * (r063 FX2, sR06/aR06) The answer goes through the one source-resolved rule (`resolveHrSegments`): Gauge's readings
 * stand for the minutes they cover, and a Health Connect minute (or a Gauge minute the answer missed) keeps its minute
 * mean, so a day with both no longer drops every exact reading, and exact and mean time never count twice.
 */
export async function dayHrExact(api: GaugeImportDeps['api'], t: GaugeTimeline, first: number, o: { cached: boolean; tz?: string }): Promise<Array<{ start: number; end: number; bpm: number }> | null> {
  return (await dayHrExactRead(api, t, first, o)).segments;
}

/** (FX1) `dayHrExact` with whether its read failed (asked and no answer: the day's evidence is owed again). */
async function dayHrExactRead(api: GaugeImportDeps['api'], t: GaugeTimeline, first: number, o: { cached: boolean; tz?: string }): Promise<{ segments: Array<{ start: number; end: number; bpm: number }> | null; failed: boolean }> {
  const none = { segments: null, failed: false };
  if (!api.hrIntervals) return none;
  const sup = Array.isArray(t.hr?.supportedS) ? t.hr.supportedS : [];
  const src = Array.isArray(t.hr?.source) ? t.hr.source : [];
  let lo = -1;
  let hi = -1;
  sup.forEach((v, k) => {
    if (typeof v === 'number' && v > 0 && !isOtherHrSource(src[k])) {
      if (lo < 0) lo = k;
      hi = k;
    }
  });
  if (lo < 0) return none;
  const range = { start: first + (lo - 1) * 60_000, end: first + (hi + 2) * 60_000 };
  const r: GaugeHrIntervals | null = await api.hrIntervals(new Date(range.start).toISOString(), new Date(range.end).toISOString(), o).catch(() => null);
  // a failed read is owed again; a truncated one is the route's cap (minute means, said so), and a server without the
  // route has nothing more to give: neither is a failure
  if (!r || !Array.isArray(r.intervals)) return { segments: null, failed: problemOf(api) !== 'not_supported' };
  if (r.truncated) return none;
  // clipped to the day, so two days' segments never overlap
  const dayEnd = first + sup.length * 60_000;
  const resolved = resolveHrSegments({ grids: [{ first, bpm: t.hr.bpm, supportedS: sup, source: src }], exact: segmentsFromHrIntervals(r.intervals), range: { start: Math.max(range.start, first), end: Math.min(range.end, dayEnd) } });
  return { segments: resolved.segments.map((g) => ({ start: g.start, end: g.end, bpm: g.bpm })), failed: false };
}

let stopper: (() => void) | null = null;
/** (r063 S6) How long after a change of the log or the step settings the fusion context is posted. */
export const FUSION_CONTEXT_DEBOUNCE_MS = 3000;

/**
 * Runs the import at start, every 5 minutes, when the app comes back to the foreground, when this device pairs with a
 * server and when the person turns the import on; (r069 sync) and starts the Gauge pulse (`./gaugePulse`), which runs it
 * as soon as Gauge's new data reaches the server. Idempotent; returns the stop function.
 */
export function startGaugeImport(): () => void {
  if (stopper) return stopper;
  const report = (e: unknown) => console.error('Vitals: Gauge import failed', e);
  const run = () => void runGaugeImport().catch(report);
  const timer = setInterval(run, GAUGE_IMPORT_INTERVAL_MS);
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') run();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  const offs: Array<() => void> = [];
  void import('@/net/server').then(({ getServerClient }) => {
    const client = getServerClient();
    let paired = client.isPaired();
    offs.push(
      client.subscribe(() => {
        const now = client.isPaired();
        if (now && !paired) run();
        paired = now;
      }),
    );
  });
  // (r063 S6) a decision, a correction or a step setting changes the fusion context: post it within seconds, so the
  // Ring, timelines and Heart Points use it before the next import
  let contextTimer: ReturnType<typeof setTimeout> | null = null;
  const contextSoon = () => {
    if (contextTimer) clearTimeout(contextTimer);
    contextTimer = setTimeout(() => {
      contextTimer = null;
      void syncFusionContext().catch(report);
    }, FUSION_CONTEXT_DEBOUNCE_MS);
  };
  void import('./settingsStore').then(({ useSettingsStore }) => {
    offs.push(
      useSettingsStore.subscribe((s, prev) => {
        if (s.gaugeImport && !prev.gaugeImport) run();
        if (s.stepsPreference !== prev.stepsPreference || s.soleSustainedGait !== prev.soleSustainedGait) contextSoon();
      }),
    );
  });
  void import('./runtime').then(({ getDocumentStore }) => {
    try {
      offs.push(getDocumentStore().watch('dailyLogs', {}, contextSoon));
    } catch {
      // no document store (tests, a locked vault): the next import posts the context
    }
  });
  offs.push(() => {
    if (contextTimer) clearTimeout(contextTimer);
  });
  // (r069 sync) the Gauge pulse: data Gauge uploads reaches the screens within seconds, not at the next run
  void import('./gaugePulse').then(({ startGaugePulse }) => {
    if (stopper) offs.push(startGaugePulse());
  });
  run();
  stopper = () => {
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    offs.forEach((off) => off());
    stopper = null;
  };
  return stopper;
}
