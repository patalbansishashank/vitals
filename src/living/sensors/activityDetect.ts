/**
 * Activity candidates from sensor evidence (`detect/1`, energy SPEC §V2.5, notes C11). Product defaults throughout (P,
 * confidence C), to be tuned against the owner's labels.
 *
 * Identity (C11):
 *  - a candidate's key is assigned once, when first created, and persisted by V3. Each source ref (Gauge session id,
 *    Health Connect record id, ring telemetry window id, detector window id) is recorded by V3 in an alias index
 *    `ref → candidateKey`; new evidence with a known ref attaches to that candidate (`matchedKey`);
 *  - otherwise the draft carries a `proposedKey` from the injected `mintKey` (V3 passes a ULID minter: this module is pure
 *    and has no clock or randomness);
 *  - new evidence overlapping a candidate by ≥ 50 % of the shorter one is a merge SUGGESTION shown in review; never an
 *    automatic union, and no explicit duration is extended.
 *
 * Sources and confidence: Gauge sessions (high); Health Connect exercise sessions of other origins (medium, high with HR or
 * a route; `nonActivity` types never become bouts); ring sport telemetry windows (medium); a cadence detector (≥ 10 min
 * with ≥ 80 % of minutes at ≥ 60/min, gaps ≤ 2 min → walk, or run when the median is ≥ 130; low or medium); an HR-only
 * detector (≥ 10 min with ≥ 60 % of minutes at supported HR ≥ 60 % of the basis and fused steps < 30/min → "cardio, type
 * unknown"; low; only where supported HR exists). A detector window that overlaps a recorded session's candidate by ≥ 50 %
 * is evidence for it (`absorbed`), not a second candidate: the same movement must not be offered twice.
 *
 * Revisions, kept apart: `sourceRevision` hashes the input refs and their revisions; `estimateRevision` hashes the
 * estimator versions and outputs; the review decision revision is V3's. A changed source or estimate revision shows as
 * "updated".
 *
 * Warrants: analytically true A for identity and revision bookkeeping; the detector thresholds are product defaults (W8,
 * C): a cadence or HR window is evidence that something happened, never of what it was (RESEARCH E1: "no steps does not
 * establish sitting, and high HR does not establish exercise").
 */
import { resolveActivityAlias } from '@/content/catalogues/activityTypes';
import {
  detectionChoices,
  detectionExerciseId,
  detectionLabelInfo,
  detectionNeedsType,
} from '../detectionLabels';
import { contentHash } from '@/lib/bodyContracts';
import { basisFraction, type ZoneBoundaries } from './hrProfile';
import { SENSOR_VERSIONS, isFiniteNum, median, overlapMs, sp, type Interval, type Ms } from './types';

export type CandidateSource =
  'gaugeSession' | 'hcSession' | 'ringTelemetry' | 'cadenceDetector' | 'hrDetector' | 'automaticDetector';

/** (0.6.7 AD-VITALS) A source that only says movement happened (a detector), never a recording. */
export const isDetectorSource = (s: CandidateSource): boolean =>
  s === 'cadenceDetector' || s === 'hrDetector' || s === 'automaticDetector';

/**
 * (0.6.7 AD-VITALS) One final episode of the server's `detect/2` (contract §2), as `activity.fromGauge` takes it (instants
 * in epoch ms). Its ref is `detect:bout:<id>`: stable across revisions, so a decision (a rejection too) holds.
 */
export interface DetectionEpisodeEvidence {
  id: string;
  revision: number;
  detector: string;
  start: Ms;
  end: Ms;
  label: string;
  alternatives?: readonly string[];
  existence: number;
  typeScore: number;
  level: Confidence;
  reasons?: readonly string[];
  coverage?: { phone?: number; ring?: number; hr?: number; ar?: number; gps?: number };
  evidenceHash?: string;
  /** Recordings the server linked to the episode (`gauge:<id>`, `hc:<id>`): their candidate hosts it. */
  recordingRefs?: readonly string[];
}

/** (0.6.7 AD-VITALS) What a candidate keeps of its detection episode (the review's words and type choice come from it). */
export interface DetectionInfo {
  episodeId: string;
  revision: number;
  detector: string;
  label: string;
  level: Confidence;
  existence: number;
  typeScore: number;
  reasons: string[];
  /** Catalogue types the review offers, the suggestion first when there is one. */
  choices: string[];
  /** No type is preselected: approval needs the person's choice (a `possible_*` label). */
  needsType: boolean;
  coverage?: { phone?: number; ring?: number; hr?: number; ar?: number; gps?: number };
  /** (r070) The recordings the server linked to the episode: a detection on a recording is trusted like the recording. */
  recordingRefs?: string[];
}

/** (0.6.7 AD-VITALS) The candidate ref of a detection episode. */
export const detectionRef = (episodeId: string): string => `detect:bout:${episodeId}`;
export type Confidence = 'low' | 'medium' | 'high';

export interface GaugeSessionEvidence {
  id: string;
  /** Upstream revision (Gauge `updatedAt`). */
  revision: string;
  start: Ms;
  end: Ms;
  /** Gauge workout type (walk, run, cycle, gym, …). */
  type: string;
  /**
   * (0.6.3 S26) The catalogue activity the recording was started as, already checked against the catalogue by the
   * caller: the suggested type instead of the coarse type's alias.
   */
  activityTypeId?: string;
}

/**
 * (r070) How Health Connect says a session was recorded (`recordingMethod`): `manual` typed in by the person, `active` a
 * recording the person started in that app, `auto` detected by the app (Google Fit's automatic walks).
 */
export type HcRecordingMethod = 'manual' | 'active' | 'auto';

/** (r070) Health Connect's recording method (its name or code) in Vitals' words; undefined when unknown. */
export function hcRecordingMethodOf(m: unknown): HcRecordingMethod | undefined {
  if (m === 'manualEntry' || m === 3) return 'manual';
  if (m === 'activelyRecorded' || m === 1) return 'active';
  if (m === 'automaticallyRecorded' || m === 2) return 'auto';
  return undefined;
}

export interface HcSessionEvidence {
  /** Health Connect record id. */
  id: string;
  /** `last_modified`. */
  revision: string;
  start: Ms;
  end: Ms;
  exerciseType: number;
  originPackage: string;
  title?: string;
  hasHr?: boolean;
  hasRoute?: boolean;
  /** (r069) The session's segments (Health Connect `segments`): where in its window the exercise actually was. */
  segments?: readonly Interval[];
  /** (r070) How it was recorded (`hcRecordingMethodOf`). */
  recordingMethod?: HcRecordingMethod;
  /** (r070) How many laps the session has (Health Connect `laps`; a pool swim's lengths). */
  laps?: number;
}

export interface TelemetryWindowEvidence {
  id: string;
  revision: string;
  start: Ms;
  end: Ms;
  /** Ring sport mode when known (`run`, `walk`). */
  mode?: string;
}

/** Minute series on one grid (the server timeline): fused minute-supported steps and supported HR. */
export interface DetectMinutes {
  first: Ms;
  /** Minute-supported selected steps; null = unknown (no minute support). */
  steps: readonly (number | null)[];
  hr?: { bpm: readonly (number | null)[]; supportedS: readonly (number | null)[] };
}

export interface ExistingCandidate {
  key: string;
  window: Interval;
  /** (0.6.7) Approved or edited: a counted activity a near-identical copy attaches to. */
  counted?: boolean;
  /** (0.6.7) One of its refs (the alias a copy is attached under). */
  hostRef?: string;
  /** (r069) An activity (pending, approved, edited, or a decided one withdrawn upstream), not a resolved record. */
  live?: boolean;
}

/**
 * (0.6.7) Two windows of the same bout: each overlaps the other by at least `NEAR_SAME` of its own length (a Health
 * Connect copy of a Gauge recording, written by another app: 10:25–10:50 against 10:26–10:51).
 */
export const NEAR_SAME = 0.8;
export function nearSame(a: Interval, b: Interval): boolean {
  const o = overlapMs(a.start, a.end, b.start, b.end);
  return (
    a.end > a.start &&
    b.end > b.start &&
    o >= NEAR_SAME * (a.end - a.start) &&
    o >= NEAR_SAME * (b.end - b.start)
  );
}

export interface PlannedSessionRef {
  id: string;
  window: Interval;
  exerciseId: string;
}

export interface CandidateDraft {
  version: typeof SENSOR_VERSIONS.detect;
  /** Source refs, `<namespace>:<id>` (gauge:, hc:, ring:, detect:cadence:, detect:hr:). */
  refs: string[];
  /** The persisted candidate this evidence attaches to (a ref already in the alias index), else null. */
  matchedKey: string | null;
  /** A new key, used only when `matchedKey` is null. */
  proposedKey: string;
  sourceRevision: string;
  estimateRevision: string | null;
  window: Interval;
  sources: Array<{
    source: CandidateSource;
    ref: string;
    revision: string;
    confidence: Confidence;
    /** (r070) A Health Connect session's app and recording method. */
    origin?: string;
    method?: HcRecordingMethod;
  }>;
  suggested: { exerciseId: string; confidence: Confidence; needsReview: boolean; why: string[] };
  measures: {
    durationMin: number;
    steps: number | null;
    medianCadence: number | null;
    hrSupportedS: number | null;
    meanHr: number | null;
  };
  /** activityEnergy + zones + points, from the injected estimator (V3 wires it), else null. */
  estimate: unknown;
  /** Detector refs that corroborate this candidate (absorbed, not merged). */
  corroboratedBy: string[];
  mergeSuggestions: Array<{ withKey: string | null; withRef: string; overlapPct: number }>;
  planMatchHint: { plannedId: string; overlapPct: number; sameType: boolean } | null;
  /** (0.6.7 AD-VITALS) The detection episode this draft is (its own draft only; an absorbed one is a corroboration). */
  detection?: DetectionInfo;
}

export interface DetectInput {
  gaugeSessions?: readonly GaugeSessionEvidence[];
  hcSessions?: readonly HcSessionEvidence[];
  telemetry?: readonly TelemetryWindowEvidence[];
  minutes?: DetectMinutes;
  /** (0.6.7 AD-VITALS) The server's final `detect/2` episodes. */
  episodes?: readonly DetectionEpisodeEvidence[];
  /**
   * (0.6.7 AD-VITALS) Run the local `detect/1` cadence and HR detectors (default true). False when the server runs
   * `detect/2`: never both over the same minutes.
   */
  localDetectors?: boolean;
  /** For the HR-only detector (the basis of the person's profile); null/absent: no HR detector. */
  hrBoundaries?: ZoneBoundaries | null;
  /** V3's alias index `ref → candidateKey`. */
  aliasIndex?: ReadonlyMap<string, string>;
  /**
   * (r069) Recording refs deleted upstream (this pass's and those candidates recorded before): a deleted recording hosts
   * nothing, so the server episode it hosted is its candidate's own evidence again.
   */
  goneRefs?: ReadonlySet<string>;
  existing?: readonly ExistingCandidate[];
  planned?: readonly PlannedSessionRef[];
  mintKey: () => string;
  estimate?: (window: Interval, exerciseId: string) => unknown;
}

export interface DetectResult {
  version: typeof SENSOR_VERSIONS.detect;
  drafts: CandidateDraft[];
  /** Detector windows taken as evidence of a recorded candidate. */
  absorbed: Array<{ ref: string; into: string }>;
  /**
   * (audit F2) A detector window whose candidate only detectors ever described (`detectorKey`), now covered by a recorded
   * session of this pass (`hostRef`): the session absorbs the window, and V3 supersedes the detector candidate (pending)
   * or gives it the session as new evidence (decided). The same movement is never offered twice.
   */
  detectorHosts: Array<{ detectorKey: string; detectorRef: string; hostRef: string }>;
  /** Evidence that never becomes a bout (non-activity HC types). */
  skipped: Array<{ ref: string; reason: string }>;
}

// ---------------------------------------------------------------- detectors

export interface DetectorWindow {
  start: Ms;
  end: Ms;
  kind: 'walk' | 'run' | 'cardioUnknown';
  medianCadence: number | null;
  share: number;
  confidence: Confidence;
}

/** Runs of qualifying minutes, joined across gaps of at most `maxGap` minutes; [first, last] minute indices. */
function runs(ok: readonly boolean[], maxGap: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = -1;
  let last = -1;
  for (let k = 0; k < ok.length; k++) {
    if (!ok[k]) continue;
    if (s >= 0 && k - last - 1 <= maxGap) last = k;
    else {
      if (s >= 0) out.push([s, last]);
      s = k;
      last = k;
    }
  }
  if (s >= 0) out.push([s, last]);
  return out;
}

/** Cadence detector (SPEC V2.5): ≥ 10 min, ≥ 80 % of minutes at ≥ 60/min, ≤ 2-min gaps; run when the median is ≥ 130. */
export function cadenceWindows(m: DetectMinutes): DetectorWindow[] {
  const ok = m.steps.map((s) => isFiniteNum(s) && s >= sp('detectCadence'));
  const out: DetectorWindow[] = [];
  for (const [a, b] of runs(ok, sp('detectMaxGapMin'))) {
    const len = b - a + 1;
    if (len < sp('detectMinMin')) continue;
    let n = 0;
    const cad: number[] = [];
    for (let k = a; k <= b; k++)
      if (ok[k]) {
        n++;
        cad.push(m.steps[k] as number);
      }
    const share = n / len;
    if (share < sp('detectCadenceShare')) continue;
    const med = median(cad);
    out.push({
      start: m.first + a * 60_000,
      end: m.first + (b + 1) * 60_000,
      kind: med !== null && med >= sp('detectRunCadence') ? 'run' : 'walk',
      medianCadence: med,
      share,
      confidence: len >= 20 && share >= 0.9 ? 'medium' : 'low',
    });
  }
  return out;
}

/** HR-only detector (SPEC V2.5): ≥ 10 min, ≥ 60 % of minutes with supported HR ≥ 60 % of the basis, steps < 30/min. */
export function hrOnlyWindows(m: DetectMinutes, b: ZoneBoundaries): DetectorWindow[] {
  if (!m.hr) return [];
  const n = m.steps.length;
  const hot: boolean[] = [];
  for (let k = 0; k < n; k++) {
    const v = m.hr.bpm[k];
    const s = m.hr.supportedS[k];
    const st = m.steps[k];
    const still = !isFiniteNum(st) || st < sp('detectHrMaxCadence');
    hot.push(
      isFiniteNum(v) &&
        isFiniteNum(s) &&
        s > 0 &&
        still &&
        100 * basisFraction(v, b) >= sp('detectHrPctOfBasis'),
    );
  }
  const out: DetectorWindow[] = [];
  for (const [a, z] of runs(hot, sp('detectMaxGapMin'))) {
    const len = z - a + 1;
    if (len < sp('detectMinMin')) continue;
    let c = 0;
    let steps = 0;
    let stepsN = 0;
    for (let k = a; k <= z; k++) {
      if (hot[k]) c++;
      const st = m.steps[k];
      if (isFiniteNum(st)) {
        steps += st;
        stepsN++;
      }
    }
    const share = c / len;
    if (share < sp('detectHrShare')) continue;
    if (stepsN > 0 && steps / stepsN >= sp('detectHrMaxCadence')) continue;
    out.push({
      start: m.first + a * 60_000,
      end: m.first + (z + 1) * 60_000,
      kind: 'cardioUnknown',
      medianCadence: null,
      share,
      confidence: 'low',
    });
  }
  return out;
}

// ---------------------------------------------------------------- drafts

const overlapPctOfShorter = (a: Interval, b: Interval): number => {
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? (100 * overlapMs(a.start, a.end, b.start, b.end)) / shorter : 0;
};

function measuresOf(w: Interval, m: DetectMinutes | undefined): CandidateDraft['measures'] {
  const durationMin = (w.end - w.start) / 60_000;
  if (!m) return { durationMin, steps: null, medianCadence: null, hrSupportedS: null, meanHr: null };
  const a = Math.max(0, Math.floor((w.start - m.first) / 60_000));
  const b = Math.min(m.steps.length, Math.ceil((w.end - m.first) / 60_000));
  let steps: number | null = null;
  const cad: number[] = [];
  let sup: number | null = null;
  let hrW = 0;
  for (let k = a; k < b; k++) {
    const st = m.steps[k];
    if (isFiniteNum(st)) {
      steps = (steps ?? 0) + st;
      cad.push(st);
    }
    const v = m.hr?.bpm[k];
    const s = m.hr?.supportedS[k];
    if (isFiniteNum(v) && isFiniteNum(s) && s > 0) {
      sup = (sup ?? 0) + s;
      hrW += v * s;
    }
  }
  return {
    durationMin,
    steps,
    medianCadence: median(cad),
    hrSupportedS: sup,
    meanHr: sup ? hrW / sup : null,
  };
}

interface Evidence {
  source: CandidateSource;
  ref: string;
  revision: string;
  window: Interval;
  confidence: Confidence;
  exerciseId: string;
  needsReview: boolean;
  why: string[];
  detection?: DetectionInfo;
  /** (0.6.7) Recorded refs the server linked to this episode. */
  recordingRefs?: readonly string[];
  /** (r070) A Health Connect session's app and recording method. */
  origin?: string;
  method?: HcRecordingMethod;
}

const RANK: Record<CandidateSource, number> = {
  gaugeSession: 0,
  hcSession: 1,
  ringTelemetry: 2,
  cadenceDetector: 3,
  hrDetector: 4,
  automaticDetector: 5,
};

/** Health Connect's RUNNING_TREADMILL: Google Fit writes a treadmill WALK under it too ("Morning treadmill walk"). */
const HC_RUNNING_TREADMILL = 57;

// ------------------------------------------------------------------------------------------- session blocks (r069)
/** (r069, P) A gap of this many minutes with no segment and near-zero steps ends one activity of a session. */
export const HC_BLOCK_GAP_MIN = 10;
/** (r069, P) Steps per minute at or below this are "near zero" (standing, a few steps about the house). */
export const HC_NEAR_ZERO_STEPS = 20;
/** (r069, P) A block shorter than this is no activity of its own (a session's stray first second of walking). */
export const HC_MIN_BLOCK_MIN = 5;
/** (r069) Health Connect walking, running, treadmill running and hiking: steps tell their pauses. */
const HC_GAIT = new Set([37, 56, 57, 79]);

/** (r069) The recording a ref names: a session block's ref (`hc:<id>@<start>`) is its session's (`hc:<id>`). */
export const recordingRefOf = (ref: string): string => {
  const at = ref.indexOf('@');
  return at > 0 && ref.startsWith('hc:') ? ref.slice(0, at) : ref;
};
/** (r069) The ref of one block of a Health Connect session. */
export const hcBlockRef = (id: string, start: Ms): string => `hc:${id}@${start}`;

/**
 * (r069) The separate activities inside one Health Connect session, or [] when it is one. Google Fit writes one "walking"
 * session over two walks with a break between them (the owner's 13:01–14:53: segments to 13:55:23, none until 14:09:16,
 * and 2–13 steps a minute in between): the outer window is not the activity, its segments are. A gap of
 * `HC_BLOCK_GAP_MIN` or more with no segment ends a block, unless steps say the person kept walking through it (a known
 * minute above `HC_NEAR_ZERO_STEPS`, gait sessions only). A session without segments is split by steps alone (gait only:
 * a cycling session has no steps to read): an interior run of `HC_BLOCK_GAP_MIN` near-zero minutes between walking.
 * Blocks shorter than `HC_MIN_BLOCK_MIN` are dropped. The server's detector reads sessions the same way
 * (`packages/companion/src/home/detect/features.ts`).
 */
export function hcBlocks(h: HcSessionEvidence, minutes?: DetectMinutes | null): Interval[] {
  const gait = HC_GAIT.has(h.exerciseType);
  const stepAt = (t: Ms): number | null => {
    if (!minutes) return null;
    const k = Math.floor((t - minutes.first) / 60_000);
    const v = k >= 0 && k < minutes.steps.length ? minutes.steps[k] : null;
    return v === null || v === undefined || !Number.isFinite(v) ? null : v;
  };
  // every whole minute of [a, b) whose steps are known is near zero (an unknown minute says nothing)
  const quiet = (a: Ms, b: Ms): boolean => {
    if (!gait) return true;
    for (let t = Math.ceil(a / 60_000) * 60_000; t + 60_000 <= b; t += 60_000) {
      const v = stepAt(t);
      if (v !== null && v > HC_NEAR_ZERO_STEPS) return false;
    }
    return true;
  };
  const gapMs = HC_BLOCK_GAP_MIN * 60_000;
  const segs = (h.segments ?? [])
    .map((g) => ({ start: Math.max(g.start, h.start), end: Math.min(g.end, h.end) }))
    .filter((g) => g.end > g.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: Interval[] = [];
  if (segs.length > 0) {
    for (const g of segs) {
      const last = blocks.at(-1);
      if (last && (g.start - last.end < gapMs || !quiet(last.end, g.start))) last.end = Math.max(last.end, g.end);
      else blocks.push({ ...g });
    }
  } else if (gait && minutes) {
    // no segments: interior near-zero runs between walking minutes
    let a = h.start;
    let run: Ms | null = null;
    let walked = false;
    for (let t = Math.ceil(h.start / 60_000) * 60_000; t + 60_000 <= h.end; t += 60_000) {
      const v = stepAt(t);
      if (v !== null && v <= HC_NEAR_ZERO_STEPS) run ??= t;
      else if (v !== null) {
        if (run !== null && walked && t - run >= gapMs) {
          blocks.push({ start: a, end: run });
          a = t;
        }
        run = null;
        walked = true;
      }
    }
    if (blocks.length > 0) blocks.push({ start: a, end: h.end });
  }
  const kept = blocks.filter((b) => b.end - b.start >= HC_MIN_BLOCK_MIN * 60_000);
  return kept.length >= 2 ? kept : [];
}

/**
 * (r069) A Health Connect session's revision is what it says (its window, type and title), never `last_modified`: Google
 * Fit rewrites that on sessions it did not change (the owner's approved bike ride read "updated" three times in a morning).
 */
export const hcRevisionOf = (h: Pick<HcSessionEvidence, 'start' | 'end' | 'exerciseType' | 'title'>): string =>
  contentHash(['hc/1', h.start, h.end, h.exerciseType, h.title ?? null]);

/**
 * (r069) Health Connect sessions two or more of the server's episodes link (`recordingRefs`): Google Fit writes one
 * "walking" session over two walks with a break between them, and the server splits it into its two episodes. Each
 * episode is then its own activity; the session hosts none of them (hung on one, it swallowed the other: the owner's
 * first walk of the day vanished). A Gauge recording is the person's own and stays one activity, whatever the episodes.
 */
export function splitRecordings(episodes: readonly DetectionEpisodeEvidence[]): Set<string> {
  const by = new Map<string, Set<string>>();
  for (const e of episodes) {
    if (!(e.end > e.start) || !e.id) continue;
    for (const r of e.recordingRefs ?? []) {
      if (!r.startsWith('hc:')) continue;
      by.set(r, (by.get(r) ?? new Set()).add(e.id));
    }
  }
  return new Set([...by].filter(([, ids]) => ids.size >= 2).map(([r]) => r));
}

/** Candidate drafts of one import pass. Deterministic for the same input and the same `mintKey` sequence. */
export function detectActivities(i: DetectInput): DetectResult {
  const alias = i.aliasIndex ?? new Map<string, string>();
  const skipped: DetectResult['skipped'] = [];
  const explicit: Evidence[] = [];
  for (const g of i.gaugeSessions ?? []) {
    if (!(g.end > g.start)) continue;
    const a = resolveActivityAlias('gauge', g.type);
    if (a.nonActivity) {
      skipped.push({ ref: `gauge:${g.id}`, reason: 'nonActivity' });
      continue;
    }
    const picked = g.activityTypeId
      ? { exerciseId: g.activityTypeId, needsReview: false }
      : { exerciseId: a.exerciseId, needsReview: a.needsReview === true };
    explicit.push({
      source: 'gaugeSession',
      ref: `gauge:${g.id}`,
      revision: g.revision,
      window: { start: g.start, end: g.end },
      confidence: 'high',
      ...picked,
      why: [`The ring app recorded a ${g.type} session`],
    });
  }
  const split = splitRecordings(i.episodes ?? []);
  /** (r069) Session block refs → their session's ref. */
  const blockOf = new Map<string, string>();
  // (r069) and a session over two or more activities the server's episodes already are (a pass whose detections read
  // failed must not hang it on one of them again)
  const episodeKeys = new Set([...alias].flatMap(([r, k]) => (r.startsWith('detect:bout:') ? [k] : [])));
  for (const h of i.hcSessions ?? []) {
    const w = { start: h.start, end: h.end };
    const inside = (i.existing ?? []).filter(
      (c) =>
        c.live === true &&
        episodeKeys.has(c.key) &&
        c.window.end > c.window.start &&
        overlapMs(w.start, w.end, c.window.start, c.window.end) >= sp('mergeOverlap') * (c.window.end - c.window.start),
    );
    if (inside.length >= 2) split.add(`hc:${h.id}`);
  }
  for (const h of i.hcSessions ?? []) {
    if (!(h.end > h.start)) continue;
    const a = resolveActivityAlias('hc', h.exerciseType);
    if (a.nonActivity) {
      skipped.push({ ref: `hc:${h.id}`, reason: 'nonActivity' });
      continue;
    }
    // (r070) a session the person recorded or typed in that app is as sure as one with heart rate or a route
    const conf: Confidence =
      h.hasHr || h.hasRoute || h.recordingMethod === 'active' || h.recordingMethod === 'manual' ? 'high' : 'medium';
    // (0.6.7 AD-VITALS) a "treadmill running" session its app titled a walk is a treadmill walk (reviewed, never assumed)
    const walkOnBelt = h.exerciseType === HC_RUNNING_TREADMILL && /\bwalk/i.test(h.title ?? '');
    const title = h.title?.trim();
    const kind = {
      source: 'hcSession' as const,
      confidence: conf,
      exerciseId: walkOnBelt ? 'treadmill_walk' : a.exerciseId,
      needsReview: walkOnBelt || a.needsReview === true,
      why: [
        `${h.originPackage} wrote ${walkOnBelt ? 'a treadmill walk' : a.label}`,
        // (r070) what the app called it and its laps, as the app shows them
        ...(title ? [`titled “${title.slice(0, 80)}”`] : []),
        ...(h.laps && h.laps > 0 ? [`${h.laps} ${h.laps === 1 ? 'lap' : 'laps'}`] : []),
      ],
      ...(h.originPackage ? { origin: h.originPackage } : {}),
      ...(h.recordingMethod ? { method: h.recordingMethod } : {}),
    };
    // (r069) a session with separate activities in it (its segments, its steps): each block is its own activity, with its
    // own window, minutes and estimate; the session's own ref hosts nothing
    const blocks = hcBlocks(h, i.minutes);
    if (blocks.length > 0) {
      split.add(`hc:${h.id}`);
      for (const b of blocks) {
        const ref = hcBlockRef(h.id, b.start);
        explicit.push({ ...kind, ref, revision: hcRevisionOf({ ...h, start: b.start, end: b.end }), window: b });
        blockOf.set(ref, `hc:${h.id}`);
      }
      continue;
    }
    // (r069) a session the server's episodes split: each episode is its own activity, the session hosts none of them
    if (split.has(`hc:${h.id}`)) {
      skipped.push({ ref: `hc:${h.id}`, reason: 'splitByDetection' });
      continue;
    }
    explicit.push({ ...kind, ref: `hc:${h.id}`, revision: hcRevisionOf(h), window: { start: h.start, end: h.end } });
  }
  for (const t of i.telemetry ?? []) {
    if (!(t.end > t.start)) continue;
    const a = t.mode ? resolveActivityAlias('ring', t.mode) : resolveActivityAlias('ring', 'unknown');
    explicit.push({
      source: 'ringTelemetry',
      ref: `ring:${t.id}`,
      revision: t.revision,
      window: { start: t.start, end: t.end },
      confidence: 'medium',
      exerciseId: a.exerciseId,
      needsReview: a.needsReview === true,
      why: ['the ring recorded a sport session'],
    });
  }
  const detected: Evidence[] = [];
  // (0.6.7 AD-VITALS) the server's final episodes: detector evidence like the local detectors (absorbed by a recording that
  // covers them), with their label, level and reasons kept for the review
  for (const e of i.episodes ?? []) {
    if (!(e.end > e.start) || !e.id) continue;
    const info = detectionLabelInfo(e.label);
    const detection: DetectionInfo = {
      episodeId: e.id,
      revision: e.revision,
      detector: e.detector,
      label: e.label,
      level: e.level,
      existence: e.existence,
      typeScore: e.typeScore,
      reasons: [...(e.reasons ?? [])],
      choices: detectionChoices(e.label, e.alternatives ?? []),
      needsType: detectionNeedsType(e.label),
      ...(e.coverage ? { coverage: { ...e.coverage } } : {}),
      ...(e.recordingRefs?.length ? { recordingRefs: [...e.recordingRefs] } : {}),
    };
    detected.push({
      source: 'automaticDetector',
      ref: detectionRef(e.id),
      revision: `${e.revision}|${e.evidenceHash ?? contentHash([e.start, e.end, e.label, e.level])}`,
      window: { start: e.start, end: e.end },
      confidence: e.level,
      exerciseId: detectionExerciseId(e.label),
      needsReview: true,
      why: [info.title],
      detection,
      ...(e.recordingRefs?.length ? { recordingRefs: e.recordingRefs } : {}),
    });
  }
  if (i.minutes && i.localDetectors !== false) {
    for (const w of cadenceWindows(i.minutes)) {
      const id = `detect:cadence:${w.start}`;
      detected.push({
        source: 'cadenceDetector',
        ref: id,
        revision: contentHash([w.start, w.end, w.medianCadence]),
        window: w,
        confidence: w.confidence,
        exerciseId: w.kind === 'run' ? 'jog_outdoor' : 'walk',
        needsReview: true,
        why: [
          `${Math.round((w.end - w.start) / 60_000)} min of steady steps, median ${Math.round(w.medianCadence ?? 0)}/min`,
        ],
      });
    }
    if (i.hrBoundaries)
      for (const w of hrOnlyWindows(i.minutes, i.hrBoundaries)) {
        const id = `detect:hr:${w.start}`;
        detected.push({
          source: 'hrDetector',
          ref: id,
          revision: contentHash([w.start, w.end, w.share]),
          window: w,
          confidence: 'low',
          exerciseId: 'other_moderate',
          needsReview: true,
          why: ['cardio, type unknown: raised heart rate with few steps'],
        });
      }
  }

  explicit.sort(
    (a, b) => RANK[a.source] - RANK[b.source] || a.window.start - b.window.start || (a.ref < b.ref ? -1 : 1),
  );
  const drafts: CandidateDraft[] = [];
  const absorbed: DetectResult['absorbed'] = [];
  const detectorHosts: DetectResult['detectorHosts'] = [];
  const isRecorded = (x: CandidateDraft) => !isDetectorSource(x.sources[0]!.source);
  // (r069) the candidate a split session was before (its own ref in the alias index) goes on as the block it overlaps most
  const inherited = new Map<string, string>();
  for (const plain of new Set(blockOf.values())) {
    const k = alias.get(plain);
    const c = k ? (i.existing ?? []).find((x) => x.key === k) : undefined;
    if (!k || !c) continue;
    const best = [...blockOf]
      .filter(([ref, p]) => p === plain && !alias.has(ref))
      .map(([ref]) => {
        const e = explicit.find((x) => x.ref === ref)!;
        return { ref, ov: overlapMs(e.window.start, e.window.end, c.window.start, c.window.end) };
      })
      .sort((x, y) => y.ov - x.ov)[0];
    if (best && best.ov > 0) inherited.set(best.ref, k);
  }
  const mk = (e: Evidence): CandidateDraft => {
    const matchedKey = alias.get(e.ref) ?? inherited.get(e.ref) ?? null;
    return {
      version: SENSOR_VERSIONS.detect,
      refs: [e.ref],
      matchedKey,
      proposedKey: matchedKey ?? i.mintKey(),
      sourceRevision: contentHash([[e.ref, e.revision]]),
      estimateRevision: null,
      window: { ...e.window },
      sources: [
        {
          source: e.source,
          ref: e.ref,
          revision: e.revision,
          confidence: e.confidence,
          ...(e.origin ? { origin: e.origin } : {}),
          ...(e.method ? { method: e.method } : {}),
        },
      ],
      suggested: {
        exerciseId: e.exerciseId,
        confidence: e.confidence,
        needsReview: e.needsReview,
        why: e.why,
      },
      measures: measuresOf(e.window, i.minutes),
      estimate: null,
      corroboratedBy: [],
      mergeSuggestions: [],
      planMatchHint: null,
      ...(e.detection ? { detection: e.detection } : {}),
    };
  };
  for (const e of explicit) drafts.push(mk(e));
  // (0.6.7, owner: Approve "not working" on Health Connect copies of approved workouts) a Health Connect session that is
  // near-identical to a recording of this pass or to an activity already counted is the same bout seen by another app:
  // evidence for it (absorbed), never a second activity to review. A pending candidate it had from an earlier pass is
  // retired under the host (`detectorHosts`). Partial overlaps keep the existing "looks like the same activity" hold.
  for (let k = drafts.length - 1; k >= 0; k--) {
    const x = drafts[k]!;
    if (x.sources[0]!.source !== 'hcSession') continue;
    const twin = drafts.find(
      (y) => y !== x && y.sources[0]!.source === 'gaugeSession' && nearSame(x.window, y.window),
    );
    const counted = twin
      ? undefined
      : (i.existing ?? []).find(
          (c) =>
            c.counted === true &&
            c.key !== x.matchedKey &&
            c.hostRef !== undefined &&
            nearSame(x.window, c.window),
        );
    const hostRef = twin ? twin.refs[0]! : counted?.hostRef;
    if (!hostRef) continue;
    if (twin) twin.corroboratedBy.push(x.refs[0]!);
    absorbed.push({ ref: x.refs[0]!, into: twin ? hostRef : counted!.key });
    if (x.matchedKey) detectorHosts.push({ detectorKey: x.matchedKey, detectorRef: x.refs[0]!, hostRef });
    drafts.splice(k, 1);
  }
  // a candidate only detector windows ever described (r069: a session the episodes split, or one deleted upstream, never
  // counts as its host, though an earlier pass may have hung it on one of them)
  const gone = i.goneRefs ?? new Set<string>();
  const detectorOwned = (key: string): boolean =>
    ![...alias.entries()].some(
      ([r, k]) => k === key && !r.startsWith('detect:') && !split.has(r) && !gone.has(recordingRefOf(r)),
    );
  // (r069) the candidates this pass's server episodes are themselves
  const claimed = new Set(
    detected.flatMap((d) => {
      const k = d.source === 'automaticDetector' ? alias.get(d.ref) : undefined;
      return k && detectorOwned(k) ? [k] : [];
    }),
  );
  // detectors: absorbed by an overlapping recorded draft or an existing candidate, else their own low-confidence draft
  for (const d of detected) {
    const known = alias.get(d.ref);
    // a detector ref already in the alias index attaches to its candidate: to this pass's draft of it, else as absorbed
    const knownHost = known
      ? drafts.find((x) => x.matchedKey === known && !isDetectorSource(x.sources[0]!.source))
      : undefined;
    // a candidate that only detector windows ever described is the detector's own: re-emit its draft (updates show)
    const knownIsDetector = known !== undefined && knownHost === undefined && detectorOwned(known);
    if (known && !knownIsDetector) {
      if (knownHost) {
        knownHost.corroboratedBy.push(d.ref);
        absorbed.push({ ref: d.ref, into: knownHost.refs[0]! });
      } else absorbed.push({ ref: d.ref, into: known });
      continue;
    }
    // a recorded draft of this pass that covers the window absorbs it, even when the detector already has its own candidate;
    // (0.6.7 AD-VITALS) for a server episode: the recording the server linked to it, else the best-overlapping one (never
    // simply the first), and only when it covers at least half of the episode (a long episode around a short recording is
    // its own candidate, held beside the recording for the person, never attached whole to it)
    const covers = (w: Interval) =>
      d.source !== 'automaticDetector' ||
      overlapMs(w.start, w.end, d.window.start, d.window.end) >=
        sp('mergeOverlap') * (d.window.end - d.window.start);
    // (r069) a session's blocks are its recording too: the block the episode overlaps most
    const linked = d.recordingRefs?.length
      ? drafts
          .filter(
            (x) =>
              isRecorded(x) &&
              x.matchedKey !== known &&
              d.recordingRefs!.includes(recordingRefOf(x.refs[0]!)) &&
              overlapMs(x.window.start, x.window.end, d.window.start, d.window.end) > 0,
          )
          .sort(
            (a, b) =>
              overlapMs(b.window.start, b.window.end, d.window.start, d.window.end) -
              overlapMs(a.window.start, a.window.end, d.window.start, d.window.end),
          )[0]
      : undefined;
    const host =
      linked ??
      drafts
        .filter(
          (x) =>
            isRecorded(x) &&
            x.matchedKey !== known &&
            overlapPctOfShorter(x.window, d.window) >= 100 * sp('mergeOverlap') &&
            covers(x.window),
        )
        .sort(
          (a, b) =>
            overlapMs(b.window.start, b.window.end, d.window.start, d.window.end) -
            overlapMs(a.window.start, a.window.end, d.window.start, d.window.end),
        )[0];
    // (r069) a candidate that is another server episode's own is never this one's host: the server's episodes are
    // distinct activities (a pending candidate still spanning a split session would otherwise take the second walk)
    const old = known
      ? null
      : (i.existing ?? []).find(
          (c) =>
            !(d.source === 'automaticDetector' && claimed.has(c.key)) &&
            overlapPctOfShorter(c.window, d.window) >= 100 * sp('mergeOverlap') &&
            covers(c.window),
        );
    if (host && known) {
      host.corroboratedBy.push(d.ref);
      absorbed.push({ ref: d.ref, into: host.refs[0]! });
      detectorHosts.push({ detectorKey: known, detectorRef: d.ref, hostRef: host.refs[0]! });
    } else if (host) {
      host.corroboratedBy.push(d.ref);
      absorbed.push({ ref: d.ref, into: host.refs[0]! });
    } else if (old) absorbed.push({ ref: d.ref, into: old.key });
    else drafts.push(mk(d));
  }
  // merge suggestions (never unions): other drafts of this pass and existing candidates
  const keyOf = (x: CandidateDraft) => x.matchedKey;
  for (let a = 0; a < drafts.length; a++) {
    const A = drafts[a]!;
    for (let b = 0; b < drafts.length; b++) {
      if (a === b) continue;
      const B = drafts[b]!;
      if (A.matchedKey !== null && A.matchedKey === B.matchedKey) continue;
      const pct = overlapPctOfShorter(A.window, B.window);
      if (pct >= 100 * sp('mergeOverlap'))
        A.mergeSuggestions.push({ withKey: keyOf(B), withRef: B.refs[0]!, overlapPct: pct });
    }
    for (const c of i.existing ?? []) {
      if (c.key === A.matchedKey) continue;
      const pct = overlapPctOfShorter(A.window, c.window);
      if (pct >= 100 * sp('mergeOverlap'))
        A.mergeSuggestions.push({ withKey: c.key, withRef: c.key, overlapPct: pct });
    }
    // plan match: the planned session overlapping most
    let best: CandidateDraft['planMatchHint'] = null;
    for (const p of i.planned ?? []) {
      const len = p.window.end - p.window.start;
      const ov = overlapMs(A.window.start, A.window.end, p.window.start, p.window.end);
      if (len <= 0 || ov <= 0) continue;
      const pct = (100 * ov) / len;
      if (!best || pct > best.overlapPct)
        best = { plannedId: p.id, overlapPct: pct, sameType: p.exerciseId === A.suggested.exerciseId };
    }
    A.planMatchHint = best;
    // (r069) the source revision is the draft's own sources: an attached Health Connect copy (0.6.7) and a corroborating
    // detector window are not. Whether a pass read the detections around a recording (a detections read that failed, a
    // window that ended before the episode) must not change what the recording is: the owner's approved walk and bike
    // ride flipped between two revisions on alternate passes and came back to review each time
    A.sourceRevision = contentHash(A.sources.map((s) => [s.ref, s.revision]));
    if (i.estimate) {
      A.estimate = i.estimate(A.window, A.suggested.exerciseId);
      A.estimateRevision = contentHash({ versions: SENSOR_VERSIONS, estimate: A.estimate });
    }
  }
  return { version: SENSOR_VERSIONS.detect, drafts, absorbed, skipped, detectorHosts };
}
