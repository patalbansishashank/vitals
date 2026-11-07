/**
 * Activity candidates of the living plan (energy SPEC §V3.1-3.3, notes C11, DECISION D8). Pure: the commands in
 * `@/commands/living/activity.ts` read the documents, call these functions and write what they return.
 *
 * What comes in automatically (Gauge sessions, Health Connect exercise sessions of other apps, ring sport windows and the
 * cadence and HR detectors of V2 `detectActivities`) becomes a CANDIDATE: a persisted record the person reviews. Nothing
 * a candidate says enters the plan, the energy ledger or a projection until the person approves it (D8: no auto-approve).
 *
 * Identity (C11):
 *  - a candidate's key is assigned once and persisted (`cand:<key>` in `activityCandidates`). Every source ref is recorded
 *    in the alias index (`ref:<sourceRef>` → key in `activityCandidateRefs`); new evidence with a known ref attaches to its
 *    candidate. Overlap is only a merge suggestion, never a union;
 *  - the key is minted deterministically from the first evidence (its start and first ref), so two devices importing the
 *    same session write the same document and sync merges it into one (the Package I rule, `gaugeEntryId`);
 *  - a rejected key is never re-created, and a compact tombstone `{key, refs, status, decidedRevision}` is kept forever, so
 *    a rejection never resurrects and a late correction still finds its decision. Full records are kept 90 days after
 *    resolution.
 *
 * Revisions: `sourceRevision` and `estimateRevision` come from V2; `revision` (what approve binds to) hashes both. The
 * review decision revision is `decidedRevision` (for an edit, a hash of the revision and the edit); `baseRevision` is the
 * candidate revision the decision was made on. An approved or edited candidate whose `revision` moved on from its
 * `baseRevision` (the EVIDENCE changed, audit F1) reads "updated": the approved entry is never silently rewritten;
 * approving the new revision writes a new entry that supersedes the old one, and an edit's own choices are kept.
 *
 * Approval writes ONE `session` log entry (§V3.2): `status: 'done'`, the V2 estimate as `cost` (ledger terms G, R, A, D, I;
 * provenance always `estimated`, input provenance separate), the V1.5 engine dose (equivalent MET + realised gross +
 * `stepsIncluded` for gait), `physicalBoutId` = the candidate key and the device source (`gauge:activity:<key>`). The
 * entry id is deterministic (candidate key, decided revision, predecessor), so a second device approving the same
 * revision writes the same row.
 */
import { hasPauses, movingField, movingSpans, splitBoutSessions } from './boutParts';
import { contentHash, dateOnlyOccurrence, intervalOccurrence } from '@/lib/bodyContracts';
import type { CardioSession, ExerciseSession, ResistanceSession } from '@/engine';
import { activityTraitsOf } from '@/content/catalogues/activityTypes';
import type { ExerciseRecord } from '@/catalogues/types';
import {
  isDetectorSource,
  nearSame,
  recordingRefOf,
  type HcRecordingMethod,
  type CandidateDraft,
  type CandidateSource,
  type Confidence,
  type DetectionInfo,
} from './sensors/activityDetect';
import {
  activityEnergy,
  exerciseRecordOf,
  type ActivityEnergy,
  type EnergyEstimate,
} from './sensors/activityEnergy';
import { boutSecondsIn, heartPoints, type PointsMinute } from './sensors/heartPoints';
import { hrSegmentsFor, type HrSource } from './sensors/hrZones';
import type { ZoneBoundaries } from './sensors/hrProfile';
import {
  SENSOR_VERSIONS,
  clipSegments,
  overlapMs,
  sp,
  unionMs,
  type Envelope,
  type HrSegment,
  type Interval,
  type Ms,
} from './sensors/types';
import { DEFAULT_ROLLOVER_H } from './appDay';
import { addDays, compareDates } from './dates';
import { appClockH } from './todayReplay';
import { gaugeEntryId } from './gaugeImport';
import {
  GAUGE_APP,
  type EntrySource,
  type Instant,
  type LocalDate,
  type LogEntry,
  type PrescribedSession,
  type SessionInputsProvenance,
} from './types';

// ------------------------------------------------------------------------------------------- constants (P)
/** Full records are retained this long after resolution; a compact tombstone stays forever (§V3.1). */
export const CANDIDATE_RETENTION_DAYS = 90;
/** Plan matching hint: a prescribed slot of the same modality family starting within ±3 h (§V3.3, P). */
export const PLAN_MATCH_WINDOW_H = 3;
/** A manual session overlapping an approved device bout by ≥ 50 % of the shorter raises a conflict (§V3.3, P). */
export const MANUAL_OVERLAP_CONFLICT = 0.5;

export const CANDIDATE_COLLECTION = 'activityCandidates' as const;
export const CANDIDATE_REF_COLLECTION = 'activityCandidateRefs' as const;

export const candidateDocId = (key: string): string => `cand:${key}`;
export const refDocId = (ref: string): string => `ref:${ref}`;
export const deviceKeyOf = (key: string): string => `gauge:activity:${key}`;

// ------------------------------------------------------------------------------------------- documents
export { appClockH };
/**
 * (r070) `possible`: a weak or ambiguous detection (no recording, a low or medium level, or no type): never counted and
 * never a task, shown quietly on its day for the person to add with one tap.
 */
export type CandidateStatus = 'pending' | 'possible' | 'approved' | 'edited' | 'rejected' | 'superseded';
/** (r070) Still open (nothing counted): waiting for its automatic decision, or a quiet possible. */
export const isOpenStatus = (s: CandidateStatus): boolean => s === 'pending' || s === 'possible';
/** (r070) Who decided: the person (the sheet, a hand log, an approval), or the automatic rules of `planAutoAccept`. */
export type DecidedBy = 'user' | 'auto';
export type ActivityIntensity = {
  class?: 'light' | 'moderate' | 'vigorous' | 'unknown';
  talkTest?: 'canSing' | 'talkNotSing' | 'fewWords' | 'fullSentences' | 'unknown';
  rpe?: number;
  rpeScale?: 'rirRpe' | 'cr10' | 'relativeEffort0To10' | 'unknown';
  avgHr?: number;
  speedKmh?: number;
  gradePct?: number;
  powerW?: number;
};
export type ActivityCarry = 'pocket' | 'hand' | 'desk';

/** A compact, JSON-safe copy of the V2 estimate (`act-energy/1`) a candidate or decision carries. */
export interface CandidateEstimate {
  version: string;
  exerciseId: string;
  durationMin: number;
  massKg: number;
  booked: Pick<
    EnergyEstimate,
    'estimator' | 'grossKcal' | 'method' | 'version' | 'envelope' | 'uncertaintyKind' | 'domainFlags'
  > & { provenance?: string };
  comparisons: Array<
    Pick<
      EnergyEstimate,
      'estimator' | 'grossKcal' | 'method' | 'version' | 'envelope' | 'domainFlags' | 'bookable'
    >
  >;
  rejected: Array<{ estimator: string; reason: string }>;
  vendor: Array<{ source: string; kcal: number; method?: string; label: 'comparison, never booked' }>;
  /** The shared ledger of the booked gross (G, R, A, D, I), provenance `estimated`. */
  cost: ActivityEnergy['cost'];
  engineDose: ActivityEnergy['engineDose'];
  hrSummary: ActivityEnergy['hrSummary'];
  /** Heart Points (Fit-compatible estimate) of the bout window, when computed. */
  heartPoints: number | null;
  /** (Codex #11) Which HR the estimate and its points used: the raw readings' own intervals, or minute means. Absent: no HR. */
  hrSource?: HrSource;
  /**
   * (r063 S16/A19) The Health Connect speed and power the window had, and whether the booked estimate used them. Absent
   * when the window had neither (the estimate is then exactly what it was without them).
   */
  evidence?: EstimateEvidence;
}

/**
 * (r063 S16/A19) Health Connect motion evidence of an estimate: speed (accepted minutes only, km/h) and power (W). `used`
 * says the booked estimate rests on it; `reason` says why not otherwise (a stated speed or power first, too few accepted
 * minutes, outside the equation's domain, a type without that estimator, power not verified, another estimator first).
 */
export interface EstimateEvidence {
  /** (0.6.3 FX5) `source`: Health Connect's speed, or Gauge's own GPS route speed (`gaugeGps`); one source per activity. */
  speed?: {
    source: 'healthConnect' | 'gaugeGps';
    kmh: number | null;
    gradePct: number | null;
    coverage: number;
    used: boolean;
    reason?: string;
  };
  power?: {
    source: 'healthConnect';
    avgW: number;
    verified: boolean;
    coverage: number;
    used: boolean;
    reason?: string;
  };
}

/** The prescribed slot a candidate looks like (§V3.3): shown, never applied without the person. */
export interface PlanMatch {
  itemId: string;
  slotKey: string;
  startH: number;
  deltaH: number;
  sameFamily: true;
}

/** What the person decided for a candidate (the fields `activity.edit` may change). */
export interface CandidateDecision {
  exerciseId: string;
  startAt: Instant;
  endAt: Instant;
  intensity?: ActivityIntensity;
  carry?: ActivityCarry;
  asItemId?: string;
  kcalOverride?: number;
}

export interface CandidateAudit {
  status: CandidateStatus;
  revision: string | null;
  entryId: string | null;
  at: Instant;
}

export interface ActivityCandidateDoc {
  key: string;
  compact?: false;
  /** App date of the start (the day the bout counts on) and its zone. */
  date: LocalDate;
  tz: string;
  startAt: Instant;
  endAt: Instant;
  window: Interval;
  refs: string[];
  sources: Array<{
    source: CandidateSource;
    ref: string;
    revision: string;
    confidence: Confidence;
    /** (r070) The app that wrote a Health Connect session (its package). */
    origin?: string;
    /** (r070) How Health Connect says it was recorded: by the person in that app, detected by the app, or typed in. */
    method?: HcRecordingMethod;
  }>;
  sourceRevision: string;
  estimateRevision: string | null;
  /** What `activity.approve` binds to: hash of the source and estimate revisions. */
  revision: string;
  suggested: CandidateDraft['suggested'];
  measures: CandidateDraft['measures'];
  estimate: CandidateEstimate | null;
  corroboratedBy: string[];
  mergeSuggestions: CandidateDraft['mergeSuggestions'];
  planMatch: PlanMatch | null;
  status: CandidateStatus;
  decidedRevision: string | null;
  /** (F1) The candidate `revision` the decision was made on (absent on records written before 2026-10-27). */
  baseRevision?: string | null;
  /** (F2) A detector-only candidate absorbed into a later recorded session: the key that took it over. */
  supersededBy?: string;
  /**
   * (r070) Merged automatically into this candidate (`planAutoAccept`): the same bout, the other source took precedence.
   * Superseded and never counted; open again if that candidate's source is deleted upstream.
   */
  mergedInto?: string;
  /** (Codex #7) Hash of the minute evidence inside the window (supported HR, fused steps); null when none was read. */
  evidenceRevision?: string | null;
  /** (F8) Pauses inside the window (Gauge `pauses`): never booked as exercise time. */
  pauses?: Interval[];
  /** (F11) The S2 sleeping low HR at import (D6: an HRrest proxy only when opted in), for the boundaries frozen at approval. */
  sleepingLowHr?: number | null;
  /** (0.6.3 FX5) `healthConnect` when `sleepingLowHr` is Health Connect's resting HR (the ring's was not ready); absent: the ring's. */
  sleepingLowHrSource?: 'healthConnect';
  /**
   * (0.6.3 S3/A4, A5) Candidates the person said were a separate activity from this one (approve/edit/logManual with
   * `separate`): never held or refused as its duplicate again.
   */
  separateFrom?: string[];
  /** (0.6.3 A5) A recorded activity a manual log replaced (rejected; the manual candidate's key) or was linked into. */
  resolvedBy?: { key: string; resolution: 'replace' | 'link' };
  /** (0.6.3 A27) A manual log whose start the person did not know: its window is a placeholder, never an overlap. */
  timeUnknown?: true;
  /** (0.6.3 S13) Withdrawn because every source was deleted upstream: the retracted entry and when (the audit row). */
  withdrawn?: CandidateWithdrawal;
  /**
   * (0.6.3 FX1, sR01/aR02) The source refs deleted upstream so far, accumulated across import runs (sorted, only refs of
   * `sources`): the candidate is withdrawn once every source is in it, whichever runs reported them.
   */
  deletedSources?: string[];
  entryId: string | null;
  decidedAt: Instant | null;
  /** (r070) `auto`: accepted or merged by `planAutoAccept`, the source's word stands and its changes follow it. */
  decidedBy: DecidedBy | null;
  decision: CandidateDecision | null;
  /** The decided estimate (the one written into the entry). */
  decidedEstimate: CandidateEstimate | null;
  /** Earlier decisions (the audit trail: a late edit or rejection never erases what was decided before). */
  history: CandidateAudit[];
  firstSeenAt: Instant;
  updatedAt: Instant;
  resolvedAt: Instant | null;
  /** The minute evidence around the window (fused steps, supported HR), so an edit can re-estimate a moved window. */
  evidence?: WindowMinutes | null;
  /**
   * (r069) What changed materially since the decision: the evidence at `revision` books something other than what was
   * decided on `base` (the times of an approved activity, its minutes, energy or points). Only this reads "updated"
   * (`isUpdated`). It names both revisions, so a device that imported over an older copy (one that had not seen the
   * decision yet) never sends a decided activity back to review, and a new decision clears it.
   */
  updatedFrom?: { base: string; revision: string; changes: BookingChange[] };
  /**
   * (0.6.7 AD-VITALS) The server's detection episode this candidate is (`detect:bout:<id>`): its label, level, reasons and
   * the type choices the review offers. `needsType`: no type is preselected, approval needs the person's choice.
   */
  detection?: DetectionInfo;
}

/** (0.6.7 AD-VITALS) A detected activity whose type the person has not chosen yet: Approve (and Approve all) waits for it. */
export const needsTypeChoice = (c: Pick<ActivityCandidateDoc, 'detection' | 'decision'>): boolean =>
  c.detection?.needsType === true && !c.decision;

/** (0.6.3 S13) The audit row of a withdrawal: every source was deleted upstream; the session entry it retracted. */
export interface CandidateWithdrawal {
  /** (0.6.7) `detectorWithdrawn`: the server's detector withdrew the episode a pending candidate was. */
  reason: 'sourceDeleted' | 'detectorWithdrawn';
  entryId: string | null;
  at: Instant;
  /** (FX1) The decision withdrawn (absent on rows written before 0.6.3 FX1: the history's last row says it). */
  decided?: { status: CandidateStatus; revision: string | null };
}

/**
 * A resolved candidate's compact tombstone (kept indefinitely: rejections never resurrect). (0.6.3 FX1, sR01/aR02) It keeps
 * what a later upstream deletion needs: the source refs (`sources`; a tombstone from before FX1 has none, its `gauge:`
 * and `hc:` refs stand in), the deletions seen so far and, once withdrawn, the audit row.
 */
export interface CandidateTombstone {
  key: string;
  compact: true;
  refs: string[];
  status: CandidateStatus;
  decidedRevision: string | null;
  entryId: string | null;
  resolvedAt: Instant | null;
  sources?: string[];
  deletedSources?: string[];
  withdrawn?: CandidateWithdrawal;
}

/** (FX1) The refs an upstream deletion can name (Gauge sessions, Health Connect records); detector and ring refs never. */
export const isDeletableRef = (ref: string): boolean => ref.startsWith('gauge:') || ref.startsWith('hc:');

/** (FX1) The source refs of a record: a full candidate's `sources`; a tombstone's kept list, else its deletable refs. */
export function sourceRefsOf(c: CandidateRecord): string[] {
  if (!isTombstone(c)) return [...new Set(c.sources.map((s) => s.ref))].sort();
  return [...new Set(c.sources ?? c.refs.filter(isDeletableRef))].sort();
}

export type CandidateRecord = ActivityCandidateDoc | CandidateTombstone;

export interface CandidateRefDoc {
  ref: string;
  key: string;
}

export const isTombstone = (c: CandidateRecord): c is CandidateTombstone => c.compact === true;

/**
 * The candidate revision a decision was made on (F1): `baseRevision`; for a record from before it, an approval's
 * `decidedRevision`, or the revision an edit's `decidedRevision` hashes (`editRevisionOf(revision, decision)`).
 */
export function reviewedRevisionOf(c: ActivityCandidateDoc): string | null {
  if (c.baseRevision !== undefined && c.baseRevision !== null) return c.baseRevision;
  if (
    c.status === 'edited' &&
    c.decision &&
    c.decidedRevision !== null &&
    c.decidedRevision === editRevisionOf(c.revision, c.decision)
  )
    return c.revision;
  return c.decidedRevision;
}

/**
 * A decided candidate whose evidence moved on since the decision AND books something else now (r069: `updatedFrom` names
 * this revision and the decision's): shown as "updated" and asks the person again. A new revision that books the same
 * activity (a Health Connect copy, a detector window, a re-sent recording) never does: the owner approved the same walk
 * and bike ride three times in a morning.
 */
export const isUpdated = (c: CandidateRecord): boolean => {
  // (r070) the person's own decision is never "updated" (a marker an earlier version left on it says nothing)
  if (isTombstone(c) || (c.status !== 'approved' && c.status !== 'edited') || c.decidedBy !== 'auto') return false;
  const base = reviewedRevisionOf(c);
  return (
    base !== null &&
    base !== c.revision &&
    c.updatedFrom?.base === base &&
    c.updatedFrom.revision === c.revision
  );
};

export const revisionOf = (sourceRevision: string, estimateRevision: string | null): string =>
  contentHash([sourceRevision, estimateRevision]);

// ------------------------------------------------------------------------------------------- keys
/**
 * The persisted key of a new candidate: ULID-shaped (time part = the UTC date of the start, so keys sort by day), the rest
 * a hash of the first ref and the start. Every device computes the same key for the same first evidence, whatever its
 * zone or rollover setting (audit F14: the app date is the candidate's `date`, never part of its identity). `tz` and
 * `rolloverH` are accepted and ignored (old call sites).
 */
export function candidateKeyOf(firstRef: string, startMs: Ms, _tz?: string, _rolloverH?: number): string {
  return gaugeEntryId(new Date(startMs).toISOString().slice(0, 10), `cand|${firstRef}|${startMs}`);
}

// ------------------------------------------------------------------------------------------- estimate copy
export function compactEstimate(
  e: ActivityEnergy,
  durationMin: number,
  massKg: number,
  heartPoints: number | null = null,
  hrSource: HrSource | null = null,
  evidence: EstimateEvidence | null = null,
): CandidateEstimate {
  const pick = (x: EnergyEstimate) => ({
    estimator: x.estimator,
    grossKcal: x.grossKcal,
    method: x.method,
    version: x.version,
    envelope: { ...x.envelope },
    domainFlags: [...x.domainFlags],
    bookable: x.bookable,
  });
  return {
    version: e.version,
    exerciseId: e.exerciseId,
    durationMin,
    massKg,
    booked: {
      estimator: e.booked.estimator,
      grossKcal: e.booked.grossKcal,
      method: e.booked.method,
      version: e.booked.version,
      envelope: { ...e.booked.envelope },
      uncertaintyKind: e.booked.uncertaintyKind,
      domainFlags: [...e.booked.domainFlags],
      ...(e.booked.provenance ? { provenance: e.booked.provenance } : {}),
    },
    comparisons: e.comparisons.map(pick),
    rejected: e.rejected.map((r) => ({ estimator: r.estimator, reason: r.reason })),
    vendor: e.vendor.map((v) => ({ ...v })),
    cost: { ...e.cost },
    engineDose: e.engineDose
      ? {
          ...e.engineDose,
          ...(e.engineDose.phases ? { phases: e.engineDose.phases.map((p) => ({ ...p })) } : {}),
        }
      : null,
    hrSummary: e.hrSummary ? { ...e.hrSummary } : null,
    heartPoints,
    ...(hrSource ? { hrSource } : {}),
    ...(evidence
      ? {
          evidence: {
            ...(evidence.speed ? { speed: { ...evidence.speed } } : {}),
            ...(evidence.power ? { power: { ...evidence.power } } : {}),
          },
        }
      : {}),
  };
}

// ------------------------------------------------------------------------------------------- upsert (import)
export interface CandidateUpsertInput {
  drafts: readonly CandidateDraft[];
  /** Detector windows V2 absorbed into a recorded candidate (`ref` → the ref or key it went into). */
  absorbed?: ReadonlyArray<{ ref: string; into: string }>;
  /** Source refs deleted upstream (a Health Connect deletion, a Gauge session removed). */
  deletedRefs?: readonly string[];
  /**
   * (0.6.7 AD-VITALS) Detection episodes the server withdrew (`detect:bout:<id>` refs): a pending candidate that only they
   * described is superseded; a decided one keeps the person's decision (they said it happened).
   */
  withdrawnRefs?: readonly string[];
  /** Every stored candidate (full or compact), by key. */
  existing: ReadonlyMap<string, CandidateRecord>;
  /** The alias index `ref → key`. */
  refIndex: ReadonlyMap<string, string>;
  /** Compact estimate of a draft (V2 estimate wired by the caller); null when none could be made. */
  estimateOf?: (d: CandidateDraft) => CandidateEstimate | null;
  /**
   * (Codex #7) Revision of the minute evidence inside a draft's window (supported HR and fused steps); null when none was
   * read this pass. A decided candidate whose evidence revision changed is re-estimated (it then reads "updated").
   */
  evidenceRevisionOf?: (d: CandidateDraft) => string | null;
  /**
   * (F2) Detector-only candidates whose window a recorded session of this pass covers (`detectActivities().detectorHosts`):
   * a pending one is superseded by the session's candidate; a decided one takes the session as new evidence.
   */
  detectorHosts?: ReadonlyArray<{ detectorKey: string; detectorRef: string; hostRef: string }>;
  /**
   * (r069) What a decided candidate's decision books over a draft's evidence (its type, window, intensity and kcal; the
   * minutes around the draft and the decided window): the re-approval's estimate. Absent: the draft's own estimate.
   */
  decisionEstimateOf?: (d: CandidateDraft, c: ActivityCandidateDoc) => CandidateEstimate | null;
  /** The day's prescribed sessions (plan matching hint), by app date. */
  prescribedOn?: (date: LocalDate) => readonly PrescribedSession[];
  tz: string;
  rolloverH?: number;
  now: Instant;
}

export type CandidateUpsertOutcome =
  'created' | 'updated' | 'unchanged' | 'attached' | 'blocked' | 'superseded';

export interface CandidateUpsertPlan {
  /** Candidate documents to write (whole bodies). */
  puts: ActivityCandidateDoc[];
  /** Tombstones or records to write as they are. */
  records: CandidateRecord[];
  /** New alias rows. */
  refs: CandidateRefDoc[];
  outcomes: Array<{ key: string; ref: string; outcome: CandidateUpsertOutcome }>;
  /**
   * (0.6.3 S13) Session entries to retract from replay: an approved or edited activity whose every source was deleted
   * upstream (the candidate is withdrawn with an audit row; the command writes the retraction).
   */
  retract: Array<{ key: string; entryId: string }>;
  /**
   * (r069) Decided activities withdrawn because their recording was deleted upstream, read again in this pass (their server
   * episode, a Health Connect session written over the deleted one): back to the decision, and the session entries the
   * withdrawal retracted come back (the command restores them).
   */
  restore: Array<{ key: string; entryId: string | null }>;
}

const toIso = (ms: Ms): Instant => new Date(ms).toISOString();

/** Modality family of an exercise (plan matching): cardio by modality, else resistance. */
function familyOf(ex: ExerciseRecord | undefined): 'cardio' | 'resistance' {
  return ex && ex.cardioModality ? 'cardio' : 'resistance';
}

/**
 * §V3.3 plan matching hint: the prescribed slot that day with the same modality family whose start is closest to the bout
 * and within ±3 h. A hint only; it never links anything.
 */
export function planMatchOf(
  exerciseId: string,
  startMs: Ms,
  tz: string,
  rolloverH: number,
  sessions: readonly PrescribedSession[],
): PlanMatch | null {
  const fam = familyOf(exerciseRecordOf(exerciseId));
  const { clockH } = appClockH(startMs, tz, rolloverH);
  let best: PlanMatch | null = null;
  for (const s of sessions) {
    if (s.kind !== fam) continue;
    const delta = clockH - s.startH;
    if (Math.abs(delta) > PLAN_MATCH_WINDOW_H) continue;
    if (!best || Math.abs(delta) < Math.abs(best.deltaH))
      best = {
        itemId: `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`,
        slotKey: s.slotKey,
        startH: s.startH,
        deltaH: delta,
        sameFamily: true,
      };
  }
  return best;
}

/** What to write for one import pass: new candidates, updated evidence, aliases; never a resurrection. */
export function planCandidateUpsert(i: CandidateUpsertInput): CandidateUpsertPlan {
  const rolloverH = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const puts = new Map<string, ActivityCandidateDoc>();
  const records = new Map<string, CandidateRecord>();
  const refs = new Map<string, CandidateRefDoc>();
  const outcomes: CandidateUpsertPlan['outcomes'] = [];
  const refIndex = new Map(i.refIndex);
  const current = (key: string): CandidateRecord | undefined =>
    puts.get(key) ?? records.get(key) ?? i.existing.get(key);
  const alias = (ref: string, key: string) => {
    if (refIndex.get(ref) === key) return;
    refIndex.set(ref, key);
    refs.set(ref, { ref, key });
  };

  const supersededKeys = new Set<string>();
  for (const h of i.detectorHosts ?? []) {
    const k1 = current(h.detectorKey);
    if (k1 && !isTombstone(k1) && isOpenStatus(k1.status)) supersededKeys.add(h.detectorKey);
  }
  // (F2) a decided detector-only candidate takes the recorded session that covers it (one row, "updated"); a pending one is
  // superseded below by the session's own candidate
  const redirect = new Map<string, string>();
  for (const h of i.detectorHosts ?? []) {
    const k1 = current(h.detectorKey);
    const hostKnown = refIndex.get(h.hostRef);
    // (r069) a decided one withdrawn as "deleted upstream" too: the recording that now covers its episode brings it back
    const decidedBefore =
      k1 &&
      !isTombstone(k1) &&
      k1.status === 'superseded' &&
      k1.withdrawn?.reason === 'sourceDeleted' &&
      (k1.withdrawn.decided?.status === 'approved' || k1.withdrawn.decided?.status === 'edited');
    if (
      k1 &&
      !isTombstone(k1) &&
      (k1.status === 'approved' || k1.status === 'edited' || decidedBefore) &&
      hostKnown === undefined
    )
      redirect.set(h.hostRef, h.detectorKey);
  }

  // (r069) a deleted session's blocks (`hc:<id>@<start>`) are deleted with it
  const deletedRecordings = new Set(i.deletedRefs ?? []);
  const deleted = {
    has: (r: string) => deletedRecordings.has(r) || deletedRecordings.has(recordingRefOf(r)),
    size: deletedRecordings.size,
  };
  const withdrawnSet = new Set(i.withdrawnRefs ?? []);
  const restore: CandidateUpsertPlan['restore'] = [];
  // (r069) a decided activity withdrawn as "deleted upstream" whose evidence this pass reads again (a ref that is neither
  // deleted nor withdrawn): Google Fit deletes a walk's session when it writes one session over two walks, and the
  // approved walk vanished from Today while its episode stood. It goes back to the decision; its entry comes back
  const restoreIfRead = (key: string, readRefs: readonly string[]) => {
    const prev = current(key);
    if (!prev || isTombstone(prev) || prev.status !== 'superseded') return;
    const w = prev.withdrawn;
    if (w?.reason !== 'sourceDeleted' || (w.decided?.status !== 'approved' && w.decided?.status !== 'edited')) return;
    const gone = new Set(prev.deletedSources ?? []);
    if (!readRefs.some((r) => !deleted.has(r) && !withdrawnSet.has(r) && !gone.has(r))) return;
    const { withdrawn: _w, ...rest } = prev;
    void _w;
    puts.set(key, {
      ...rest,
      status: w.decided.status,
      resolvedAt: prev.decidedAt ?? prev.resolvedAt,
      updatedAt: i.now,
      history: [...prev.history, { status: 'superseded', revision: prev.decidedRevision, entryId: null, at: i.now }],
    });
    restore.push({ key, entryId: w.entryId });
  };
  // (r069) a decision another device made stands: an import over an older copy (the candidate still pending there) may
  // have superseded it (field by field, its status won); the decision, its entry and its revision are still there
  for (const c of i.existing.values()) {
    if (isTombstone(c) || c.status !== 'superseded' || !c.decision || !c.decidedRevision || !c.entryId) continue;
    // (r070) an automatic merge is no import over an older copy: the bout counts once, under the candidate it went into
    if (c.mergedInto) continue;
    const ds = c.withdrawn?.decided?.status;
    if (ds === 'approved' || ds === 'edited') continue;
    const base = c.baseRevision ?? c.revision;
    const status = c.decidedRevision === editRevisionOf(base, c.decision) ? 'edited' : 'approved';
    const { withdrawn: _w, supersededBy: _s, ...rest } = c;
    void _w;
    void _s;
    puts.set(c.key, { ...rest, status, resolvedAt: c.decidedAt ?? c.resolvedAt, updatedAt: i.now });
    outcomes.push({ key: c.key, ref: c.refs[0] ?? c.key, outcome: 'updated' });
  }

  for (const draft of i.drafts) {
    let d = draft;
    const known =
      d.matchedKey ??
      d.refs.map((r) => refIndex.get(r)).find((k): k is string => k !== undefined) ??
      redirect.get(d.refs[0]!) ??
      null;
    const key = known ?? candidateKeyOf(d.refs[0]!, d.window.start, i.tz, rolloverH);
    restoreIfRead(key, [...d.refs, ...d.corroboratedBy]);
    const prev = current(key);
    const allRefs = [...new Set([...(prev ? prev.refs : []), ...d.refs, ...d.corroboratedBy])].sort();
    for (const r of [...d.refs, ...d.corroboratedBy]) alias(r, key);
    if (prev && (isTombstone(prev) || prev.status === 'rejected' || prev.status === 'superseded')) {
      // a rejected (or resolved) key is never re-created: the new refs stay attached to it so they do not come back either
      if (allRefs.length !== prev.refs.length) {
        if (isTombstone(prev)) records.set(key, { ...prev, refs: allRefs });
        else puts.set(key, { ...prev, refs: allRefs, updatedAt: i.now });
      }
      outcomes.push({ key, ref: d.refs[0]!, outcome: 'blocked' });
      continue;
    }
    // (0.6.7) the type the person approved or chose stands: a source that later names another type (Gauge re-sending a
    // recording with its picker's type, a Health Connect copy's type) never changes what was decided, and the estimate is
    // the decided type's (the owner saw an approved strength workout come back as HIIT at three times the energy)
    // (r070) only the person's decision: an automatic one follows its source (Google Fit's corrected type is the type)
    const decidedType =
      prev &&
      !isTombstone(prev) &&
      (prev.status === 'approved' || prev.status === 'edited') &&
      prev.decidedBy !== 'auto'
        ? (prev.decision?.exerciseId ?? prev.decidedEstimate?.exerciseId ?? null)
        : null;
    if (decidedType && decidedType !== d.suggested.exerciseId)
      d = { ...d, suggested: { ...d.suggested, exerciseId: decidedType } };
    // a decided candidate keeps its estimate while its sources and its minute evidence are unchanged (a new weigh-in never
    // re-opens a decision; corrected HR or steps inside the window do, Codex #7). Evidence not read this pass (an older
    // day outside the timeline window) is no change.
    const evRev = i.evidenceRevisionOf ? i.evidenceRevisionOf(d) : null;
    const prevEv = prev && !isTombstone(prev) ? (prev.evidenceRevision ?? null) : null;
    // (r063 FX4, M20) evidence that is newly there (the previous pass had none) is a revision too
    const evidenceMoved = evRev !== null && evRev !== prevEv;
    const keep =
      prev &&
      (prev.status === 'approved' || prev.status === 'edited') &&
      prev.sourceRevision === d.sourceRevision &&
      !evidenceMoved;
    const fresh = keep ? prev.estimate : i.estimateOf ? i.estimateOf(d) : null;
    // (0.6.7) a decided activity whose new evidence (a Health Connect copy attached, a newer evidence field) books the
    // same activity, energy and points keeps its decision: it is "attached" evidence, never "updated since you approved
    // it" (the owner saw both counted workouts come back to review after a copy attached)
    const sameBooking =
      !keep &&
      prev !== undefined &&
      !isTombstone(prev) &&
      (prev.status === 'approved' || prev.status === 'edited') &&
      prev.sourceRevision === d.sourceRevision &&
      sameBooked(prev.estimate, fresh);
    const estimate = sameBooking ? prev.estimate : fresh;
    const estimateRevision =
      keep || sameBooking
        ? prev!.estimateRevision
        : estimate
          ? contentHash({ versions: SENSOR_VERSIONS, estimate })
          : d.estimateRevision;
    // (0.6.7, r069) a decided activity keeps its decision while its new evidence books what was decided: the decision's
    // own estimate over the new evidence (the type, window, effort and kcal the person chose) is the same activity,
    // minutes, energy and points, and an approval's recorded times are where they were. Only a material change reads
    // "updated" (`updatedFrom`), never a new copy, a detector window, a recording newly hosting it or Google Fit's
    // `last_modified`: whatever the cause, the same booking keeps the decided revision
    const reviewed =
      prev && !isTombstone(prev) && (prev.status === 'approved' || prev.status === 'edited')
        ? reviewedRevisionOf(prev)
        : null;
    const raw = revisionOf(d.sourceRevision, estimateRevision);
    // (r070) an automatic decision follows its source: what the source books now (its type, window and evidence) against
    // what was booked; the person's own decision is compared as before, and then stands (`frozen` below)
    const auto = prev !== undefined && !isTombstone(prev) && prev.decidedBy === 'auto';
    let changes: BookingChange[] = [];
    if (reviewed !== null && raw !== reviewed && prev && !isTombstone(prev)) {
      const booked = !auto && i.decisionEstimateOf && prev.decision ? i.decisionEstimateOf(d, prev) : estimate;
      changes = bookingChanges(prev.decidedEstimate ?? null, booked);
      // an approval took a recording's times: a recording (re-sent, or newly hosting it) at other times asks again; a
      // detector window never moves them (it only says the activity happened, as when its recording was deleted)
      const recorded = d.sources[0] !== undefined && !isDetectorSource(d.sources[0].source);
      if (prev.status === 'approved' && prev.decision && recorded && !sameTimes(decidedWindowOf(prev), d.window))
        changes = [...new Set<BookingChange>([...changes, 'times'])];
    }
    // (r070, owner 2026-10-30: "I approved something, it comes back in review") the person's decision stands whatever its
    // evidence does later (a session split at its gaps, late heart-rate minutes): it is never "updated" and never asks
    // again. An automatic one with a material change is booked again by `planAutoAccept` (`updatedFrom` says what changed)
    const frozen = reviewed !== null && !auto;
    const healed = reviewed !== null && (frozen || changes.length === 0);
    const revision = healed ? reviewed! : raw;
    const { date } = appClockH(d.window.start, i.tz, rolloverH);
    const planMatch = i.prescribedOn
      ? planMatchOf(d.suggested.exerciseId, d.window.start, i.tz, rolloverH, i.prescribedOn(date))
      : null;
    const evidence = {
      date,
      tz: i.tz,
      startAt: toIso(d.window.start),
      endAt: toIso(d.window.end),
      window: { start: d.window.start, end: d.window.end },
      refs: allRefs,
      sources: mergeSources(prev ? prev.sources : [], d.sources),
      sourceRevision: d.sourceRevision,
      estimateRevision,
      revision,
      suggested: d.suggested,
      measures: d.measures,
      estimate,
      corroboratedBy: [...new Set([...(prev ? prev.corroboratedBy : []), ...d.corroboratedBy])].sort(),
      // (r069) never a candidate already resolved (rejected, superseded): it is not the same activity as anything now
      mergeSuggestions: d.mergeSuggestions.filter((m) => {
        if (m.withKey === key || supersededKeys.has(m.withKey ?? '')) return false;
        const o = m.withKey ? current(m.withKey) : undefined;
        return !o || (!isTombstone(o) && o.status !== 'rejected' && o.status !== 'superseded');
      }),
      planMatch,
      evidenceRevision: evRev ?? prevEv,
      ...(d.detection ? { detection: d.detection } : {}),
      // (FX1) a source this pass reads again is live again: it leaves the deletions seen so far
      ...(prev && !isTombstone(prev) && prev.deletedSources?.some((r) => d.refs.includes(r))
        ? { deletedSources: prev.deletedSources.filter((r) => !d.refs.includes(r)) }
        : {}),
    };
    if (!prev) {
      puts.set(key, {
        key,
        ...evidence,
        status: 'pending',
        decidedRevision: null,
        entryId: null,
        decidedAt: null,
        decidedBy: null,
        decision: null,
        decidedEstimate: null,
        history: [],
        firstSeenAt: i.now,
        updatedAt: i.now,
        resolvedAt: null,
      });
      outcomes.push({ key, ref: d.refs[0]!, outcome: 'created' });
      continue;
    }
    // (r069) the material change of a decided activity, bound to this revision and the decision's
    const { updatedFrom: _u, ...kept } = prev;
    void _u;
    const marker = reviewed !== null && !healed ? { base: reviewed, revision, changes } : null;
    if (
      prev.revision === revision &&
      allRefs.length === prev.refs.length &&
      (prev.evidenceRevision ?? null) === evidence.evidenceRevision &&
      // (r069) a decided activity whose revision held still takes its evidence's window and current suggestions
      prev.window.start === evidence.window.start &&
      prev.window.end === evidence.window.end &&
      JSON.stringify(prev.mergeSuggestions) === JSON.stringify(evidence.mergeSuggestions) &&
      JSON.stringify(prev.updatedFrom ?? null) === JSON.stringify(marker) &&
      // (r070) a source's origin app and recording method, once read
      JSON.stringify(prev.sources) === JSON.stringify(evidence.sources)
    ) {
      outcomes.push({ key, ref: d.refs[0]!, outcome: 'unchanged' });
      continue;
    }
    // new evidence: a pending candidate shows it ("updated"); a decided one keeps its entry and asks again only when it
    // books something else now (isUpdated)
    puts.set(key, { ...kept, ...evidence, ...(marker ? { updatedFrom: marker } : {}), updatedAt: i.now });
    outcomes.push({ key, ref: d.refs[0]!, outcome: prev.revision === revision ? 'attached' : 'updated' });
  }

  for (const a of i.absorbed ?? []) {
    const key = refIndex.get(a.into) ?? (current(a.into) ? a.into : undefined);
    if (!key) continue;
    restoreIfRead(key, [a.ref]);
    alias(a.ref, key);
    const prev = current(key);
    if (prev && !prev.refs.includes(a.ref)) {
      const refsNext = [...prev.refs, a.ref].sort();
      if (isTombstone(prev)) records.set(key, { ...prev, refs: refsNext });
      else
        puts.set(key, {
          ...prev,
          refs: refsNext,
          corroboratedBy: [...new Set([...prev.corroboratedBy, a.ref])].sort(),
          updatedAt: i.now,
        });
      outcomes.push({ key, ref: a.ref, outcome: 'attached' });
    }
  }

  // (F2) a pending detector-only candidate covered by a recorded session of this pass: the session's candidate takes over
  for (const h of i.detectorHosts ?? []) {
    if (!supersededKeys.has(h.detectorKey)) continue;
    const prev = current(h.detectorKey);
    const by = refIndex.get(h.hostRef);
    if (!prev || isTombstone(prev) || !isOpenStatus(prev.status) || !by || by === h.detectorKey) continue;
    puts.set(h.detectorKey, {
      ...prev,
      status: 'superseded',
      supersededBy: by,
      resolvedAt: i.now,
      updatedAt: i.now,
      history: [
        ...prev.history,
        { status: prev.status, revision: prev.revision, entryId: prev.entryId, at: i.now },
      ],
    });
    outcomes.push({ key: h.detectorKey, ref: h.detectorRef, outcome: 'superseded' });
  }

  // (0.6.7 AD-VITALS) withdrawn detection episodes: a pending candidate whose every source is a withdrawn episode is
  // superseded (with the audit row); an approved or edited one stays (the person said it happened); a rejected one stays
  // rejected
  if (withdrawnSet.size > 0) {
    const touched = new Set<string>();
    for (const r of withdrawnSet) {
      const k = refIndex.get(r);
      if (k) touched.add(k);
    }
    for (const key of [...touched].sort()) {
      const prev = current(key);
      if (!prev || isTombstone(prev) || !isOpenStatus(prev.status)) continue;
      const sources = prev.sources.map((x) => x.ref);
      if (sources.length === 0 || !sources.every((r) => withdrawnSet.has(r))) continue;
      puts.set(key, {
        ...prev,
        status: 'superseded',
        withdrawn: {
          reason: 'detectorWithdrawn',
          entryId: null,
          at: i.now,
          decided: { status: prev.status, revision: null },
        },
        resolvedAt: i.now,
        updatedAt: i.now,
        history: [
          ...prev.history,
          { status: prev.status, revision: prev.revision, entryId: prev.entryId, at: i.now },
        ],
      });
      outcomes.push({ key, ref: sources[0]!, outcome: 'superseded' });
    }
  }

  // upstream deletions (0.6.3 S13; FX1 sR01/aR02): each candidate keeps the source refs deleted so far (`deletedSources`),
  // across runs, so sources deleted one run at a time add up. A pending candidate whose every source is gone is
  // superseded; an approved (or edited) one is withdrawn too and its session entry leaves replay (never silently kept),
  // with the decision in its history (a compact tombstone keeps its sources for this, and gets the audit row)
  const retract: CandidateUpsertPlan['retract'] = [];
  if (deleted.size > 0) {
    const touched = new Set<string>();
    for (const [r, k] of refIndex) if (deleted.has(r)) touched.add(k);
    for (const key of [...touched].sort()) {
      const prev = current(key);
      if (!prev) continue;
      const sources = sourceRefsOf(prev);
      const before = new Set(prev.deletedSources ?? []);
      const gone = [...new Set([...before, ...sources.filter((r) => deleted.has(r))])].sort();
      const grew = gone.length > before.size;
      // (r069) a server episode (`detect:bout:`) the candidate holds, not withdrawn, still says it happened: Google Fit
      // deleting its session (to write one over two walks) withdraws nothing
      const episode =
        !isTombstone(prev) &&
        prev.refs.some((r) => r.startsWith('detect:bout:') && !withdrawnSet.has(r) && !gone.includes(r));
      const allGone = sources.length > 0 && sources.every((r) => gone.includes(r)) && !episode;
      if (isTombstone(prev)) {
        if (prev.withdrawn || !grew) continue;
        if (allGone && (prev.status === 'approved' || prev.status === 'edited')) {
          records.set(key, {
            ...prev,
            status: 'superseded',
            deletedSources: gone,
            withdrawn: {
              reason: 'sourceDeleted',
              entryId: prev.entryId,
              at: i.now,
              decided: { status: prev.status, revision: prev.decidedRevision },
            },
          });
          if (prev.entryId) retract.push({ key, entryId: prev.entryId });
          outcomes.push({ key, ref: prev.refs[0] ?? key, outcome: 'superseded' });
        } else records.set(key, { ...prev, deletedSources: gone });
        continue;
      }
      if (!allGone || (!isOpenStatus(prev.status) && prev.status !== 'approved' && prev.status !== 'edited')) {
        // some sources remain (or it is already resolved): only the deletions seen so far are kept
        if (grew) puts.set(key, { ...prev, deletedSources: gone, updatedAt: i.now });
        continue;
      }
      if (isOpenStatus(prev.status)) {
        puts.set(key, {
          ...prev,
          status: 'superseded',
          deletedSources: gone,
          resolvedAt: i.now,
          updatedAt: i.now,
          history: [
            ...prev.history,
            { status: prev.status, revision: prev.revision, entryId: prev.entryId, at: i.now },
          ],
        });
        outcomes.push({ key, ref: prev.refs[0] ?? key, outcome: 'superseded' });
      } else {
        // the activity was deleted at its source: its session leaves replay (the retraction is the command's), the
        // candidate is withdrawn and keeps the decision as an audit row; a later re-import of the same ref stays blocked
        puts.set(key, {
          ...prev,
          status: 'superseded',
          deletedSources: gone,
          withdrawn: {
            reason: 'sourceDeleted',
            entryId: prev.entryId,
            at: i.now,
            decided: { status: prev.status, revision: prev.decidedRevision },
          },
          resolvedAt: i.now,
          updatedAt: i.now,
          history: [
            ...prev.history,
            { status: prev.status, revision: prev.decidedRevision, entryId: prev.entryId, at: i.now },
          ],
        });
        if (prev.entryId) retract.push({ key, entryId: prev.entryId });
        outcomes.push({ key, ref: prev.refs[0] ?? key, outcome: 'superseded' });
      }
    }
  }
  return {
    puts: [...puts.values()],
    records: [...records.values()],
    refs: [...refs.values()],
    outcomes,
    retract,
    restore,
  };
}

function mergeSources(
  a: ActivityCandidateDoc['sources'],
  b: ActivityCandidateDoc['sources'],
): ActivityCandidateDoc['sources'] {
  const by = new Map<string, ActivityCandidateDoc['sources'][number]>();
  for (const s of [...a, ...b]) by.set(s.ref, { ...s });
  return [...by.values()].sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0));
}

/**
 * Retention (§V3.1): a resolved candidate (rejected, superseded, or decided) older than 90 days becomes its compact
 * tombstone; tombstones are never removed.
 */
export function compactResolved(records: readonly CandidateRecord[], now: Instant): CandidateTombstone[] {
  const cutoff = Date.parse(now) - CANDIDATE_RETENTION_DAYS * 86_400_000;
  const out: CandidateTombstone[] = [];
  for (const c of records) {
    if (isTombstone(c) || isOpenStatus(c.status) || isUpdated(c)) continue;
    const at = Date.parse(c.resolvedAt ?? c.decidedAt ?? '');
    if (!Number.isFinite(at) || at > cutoff) continue;
    // (FX1) what a later upstream deletion needs: the source refs, the deletions seen so far and a withdrawal's audit row
    const sources = sourceRefsOf(c);
    out.push({
      key: c.key,
      compact: true,
      refs: [...c.refs],
      status: c.status,
      decidedRevision: c.decidedRevision,
      entryId: c.entryId,
      resolvedAt: c.resolvedAt ?? c.decidedAt,
      ...(sources.length ? { sources } : {}),
      ...(c.deletedSources?.length ? { deletedSources: [...c.deletedSources] } : {}),
      ...(c.withdrawn ? { withdrawn: { ...c.withdrawn } } : {}),
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- the session entry
export interface SessionEntryInput {
  candidate: Pick<ActivityCandidateDoc, 'key' | 'sourceRevision' | 'estimateRevision' | 'measures' | 'refs'> &
    Partial<Pick<ActivityCandidateDoc, 'pauses' | 'evidence' | 'window'>>;
  decision: CandidateDecision;
  estimate: CandidateEstimate;
  /** The revision the decision binds (approve: the candidate's; edit: its hash with the edit). */
  decidedRevision: string;
  /** Stimulus of what was done (`resolveSession` of `performed`), resolved by the command. */
  stimulus: Extract<LogEntry, { kind: 'session' }>['stimulus'];
  catalogueVersion: string;
  edited: boolean;
  tz: string;
  rolloverH?: number;
  now: Instant;
  /** The entry this one supersedes (an earlier decision of the same candidate). */
  supersedes?: string;
  /** Who decided (the person on the ui surface; an agent only through an applied proposal). */
  source?: Partial<EntrySource>;
  distanceM?: number | null;
  /** A manual log without a start clock: the time stays unknown (dated by `date`, replayed at the named default hour). */
  timeUnknown?: { date: LocalDate };
  /** (F11, §V2.1) The zone boundaries in force at approval, frozen into the entry (a later profile change never rewrites them). */
  zones?: ZoneBoundaries | null;
}

/** (F8) Booked (moving) minutes of a window: its length minus the union of the pauses inside it. */
export function movingMinutes(window: Interval, pauses?: readonly Interval[] | null): number {
  const len = window.end - window.start;
  if (!(len > 0)) return 0;
  return Math.max(0, len - (pauses && pauses.length > 0 ? unionMs(pauses, window) : 0)) / 60_000;
}

/**
 * (Codex #9) The fused minute steps inside a window, from the minute evidence around the candidate (partial minutes by
 * overlap); null when any minute of the window is outside the evidence or unknown (the overlap then stays unknown).
 */
export function stepsInWindow(ev: WindowMinutes | null | undefined, window: Interval): number | null {
  if (!ev || !(window.end > window.start)) return null;
  const k0 = Math.floor((window.start - ev.first) / 60_000);
  const k1 = Math.ceil((window.end - ev.first) / 60_000);
  if (k0 < 0 || k1 > ev.steps.length) return null;
  let sum = 0;
  for (let k = k0; k < k1; k++) {
    const v = ev.steps[k];
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const a = ev.first + k * 60_000;
    sum += (v * overlapMs(a, a + 60_000, window.start, window.end)) / 60_000;
  }
  return Math.round(sum);
}

/** (Codex #14) The guideline class a stated intensity establishes, and how: stated class, talk test, the generic 0-10 scale. */
function healthClassOf(it: ActivityIntensity | undefined): {
  healthIntensityClass: 'light' | 'moderate' | 'vigorous';
  healthClassSource: 'stated' | 'talkTest' | 'relativeEffort0To10';
} | null {
  if (!it) return null;
  if (it.class && it.class !== 'unknown')
    return { healthIntensityClass: it.class, healthClassSource: 'stated' };
  const talk =
    it.talkTest === 'canSing'
      ? 'light'
      : it.talkTest === 'talkNotSing'
        ? 'moderate'
        : it.talkTest === 'fewWords'
          ? 'vigorous'
          : null;
  if (talk) return { healthIntensityClass: talk, healthClassSource: 'talkTest' };
  if (it.rpe !== undefined && it.rpeScale === 'relativeEffort0To10')
    return {
      healthIntensityClass: it.rpe >= 7 ? 'vigorous' : it.rpe >= 5 ? 'moderate' : 'light',
      healthClassSource: 'relativeEffort0To10',
    };
  return null;
}

export type SessionDraft = Omit<Extract<LogEntry, { kind: 'session' }>, 'id'>;

/** Gait for engine steps: the type's locomotor flag (V1 activity traits). */
function isGait(ex: ExerciseRecord | undefined): boolean {
  return ex ? activityTraitsOf(ex).stepsLocomotor : false;
}

/** Input provenance of an estimate (the energy itself is always `estimated`). */
export function inputsProvenanceOf(
  e: CandidateEstimate,
  opts: { manual?: boolean; intensity?: ActivityIntensity } = {},
): SessionInputsProvenance {
  const hr = e.hrSummary
    ? e.hrSummary.method === 'manual'
      ? 'reported'
      : 'measured'
    : opts.intensity?.avgHr !== undefined
      ? 'reported'
      : 'assumed';
  const speed =
    e.booked.estimator === 'speedGrade'
      ? e.booked.domainFlags.includes('gpsMovingSpeed') ||
        e.booked.domainFlags.includes('hcSpeed') ||
        !opts.manual
        ? 'measured'
        : 'reported'
      : opts.intensity?.speedKmh !== undefined
        ? 'reported'
        : 'assumed';
  const power =
    e.booked.estimator === 'power'
      ? opts.manual
        ? 'reported'
        : 'measured'
      : opts.intensity?.powerW !== undefined
        ? 'reported'
        : 'assumed';
  return { hr, speed, power, duration: opts.manual ? 'reported' : 'measured' };
}

/** The engine session of an approved bout (V1.5): equivalent MET + realised gross, steps inside the bout for gait. */
export function engineSessionsOf(o: {
  exerciseId: string;
  startH: number;
  durationMin: number;
  estimate: CandidateEstimate;
  sessionId: string;
  stepsIncluded?: number | null;
  intensity?: ActivityIntensity;
}): ExerciseSession[] {
  const ex = exerciseRecordOf(o.exerciseId);
  const dose = o.estimate.engineDose;
  if (!dose || !(o.durationMin > 0)) return [];
  const hr = o.estimate.hrSummary ?? undefined;
  // (Codex #14) the stated class (or talk test, or generic 0-10 rating) classifies the guideline minutes; the rating keeps its scale
  const health = healthClassOf(o.intensity);
  const stated = {
    ...(health
      ? { healthIntensityClass: health.healthIntensityClass, healthClassSource: health.healthClassSource }
      : {}),
    ...(o.intensity?.rpe !== undefined
      ? { rpe: o.intensity.rpe, rpeScale: o.intensity.rpeScale ?? ('unknown' as const) }
      : {}),
  };
  if (ex?.cardioModality) {
    const s: CardioSession = {
      kind: 'cardio',
      modality: ex.cardioModality,
      startH: o.startH,
      durationMin: o.durationMin,
      met: dose.met,
      realisedGrossKcal: dose.realisedGrossKcal,
      ...(dose.phases ? { phases: dose.phases } : {}),
      sessionId: o.sessionId,
      boutId: o.sessionId,
      ...(o.stepsIncluded !== undefined && o.stepsIncluded !== null && o.stepsIncluded > 0
        ? { stepsIncluded: Math.round(o.stepsIncluded) }
        : {}),
      ...(hr ? { hr } : {}),
      ...stated,
    };
    return [s];
  }
  // a calorie or HR estimate never creates sets: the hard-set count stays unknown (no known training equivalence)
  const r: ResistanceSession = {
    kind: 'resistance',
    startH: o.startH,
    durationMin: o.durationMin,
    met: dose.met,
    realisedGrossKcal: dose.realisedGrossKcal,
    doseStatus: 'unknown',
    sessionId: o.sessionId,
    boutId: o.sessionId,
    ...(hr ? { hr } : {}),
    ...stated,
  };
  return [r];
}

/** The deterministic id of a decision's entry (every device writes the same row for the same decision). */
export function decisionEntryId(
  date: LocalDate,
  key: string,
  decidedRevision: string,
  supersedes: string | undefined,
): string {
  return gaugeEntryId(date, `activity|${key}|${decidedRevision}|${supersedes ?? ''}`);
}

/** The one `session` entry an approval or an edit writes (§V3.2). */
export function sessionEntryOf(i: SessionEntryInput): { id: string; entry: SessionDraft } {
  const rolloverH = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const startMs = Date.parse(i.decision.startAt);
  const endMs = Date.parse(i.decision.endAt);
  const placed = appClockH(startMs, i.tz, rolloverH);
  const date = i.timeUnknown?.date ?? placed.date;
  const clockH = i.timeUnknown ? 18 : placed.clockH;
  // (F8) the booked minutes are the moving minutes: pauses are never exercise time (the window keeps the placement)
  const durationMin = movingMinutes({ start: startMs, end: endMs }, i.candidate.pauses);
  const ex = exerciseRecordOf(i.decision.exerciseId);
  const gait = isGait(ex);
  // the selected fused steps of the window are inside the day's total for gait: the overlap is then known (§V3.5)
  const stepsIncluded = gait ? includedSteps(i, startMs, endMs) : null;
  const health = healthClassOf(i.decision.intensity);
  const it = i.decision.intensity;
  const key = i.candidate.key;
  const manual = i.candidate.refs.length === 0 || i.candidate.refs.every((r) => r.startsWith('manual:'));
  const deviceKey = deviceKeyOf(key);
  const source: EntrySource =
    i.edited || manual
      ? {
          by: 'user',
          method: 'typed',
          deviceKey,
          ...(i.source?.actorId ? { actorId: i.source.actorId } : {}),
        }
      : {
          by: 'device',
          method: 'biometrics',
          app: GAUGE_APP,
          deviceKey,
          actorId: i.source?.actorId ?? 'activity-review',
        };
  const cost = {
    ...i.estimate.cost,
    source: 'estimated' as const,
    inputsProvenance: inputsProvenanceOf(i.estimate, {
      manual,
      ...(i.decision.intensity ? { intensity: i.decision.intensity } : {}),
    }),
  };
  const whole = engineSessionsOf({
    exerciseId: i.decision.exerciseId,
    startH: clockH,
    durationMin,
    estimate: i.estimate,
    sessionId: key,
    stepsIncluded,
    ...(it ? { intensity: it } : {}),
  });
  // (r063 S10/A15) a paused bout: one engine session per moving interval (one bout identity, one recovery booking)
  const window = { start: startMs, end: endMs };
  const paused = !i.timeUnknown && hasPauses(window, i.candidate.pauses);
  const engine = paused
    ? splitBoutSessions(
        whole,
        movingSpans(window, i.candidate.pauses).map((m) => ({
          startH: appClockH(m.start, i.tz, rolloverH).clockH,
          durationMin: (m.end - m.start) / 60_000,
        })),
      )
    : whole;
  const entry: SessionDraft = {
    date,
    tz: i.tz,
    at: i.now,
    recordedAt: i.now,
    kind: 'session',
    status: 'done',
    ...(i.timeUnknown ? {} : { startH: clockH }),
    durationMin,
    performed: [
      {
        exerciseId: i.decision.exerciseId,
        minutes: durationMin,
        ...(it?.rpe !== undefined ? { rpe: it.rpe, rpeScale: it.rpeScale ?? 'unknown' } : {}),
        ...(it?.talkTest && it.talkTest !== 'unknown' && it.talkTest !== 'fullSentences'
          ? { talkTest: it.talkTest }
          : {}),
        ...(health ? { healthIntensityClass: health.healthIntensityClass } : {}),
        ...(it?.speedKmh !== undefined ? { speedKmh: it.speedKmh } : {}),
        ...(it?.gradePct !== undefined ? { gradePct: it.gradePct } : {}),
        ...(it?.powerW !== undefined ? { powerW: it.powerW } : {}),
      },
    ],
    stimulus: i.stimulus,
    catalogueVersion: i.catalogueVersion,
    cost,
    ...(engine.length > 0 ? { engine } : {}),
    ...(i.estimate.hrSummary
      ? {
          hr: {
            avgBpm: i.estimate.hrSummary.avgBpm,
            maxBpm: i.estimate.hrSummary.maxBpm,
            supportedS: i.estimate.hrSummary.supportedS,
            method: i.estimate.hrSummary.method,
          },
        }
      : {}),
    workout: {
      exerciseType: i.decision.exerciseId,
      kind: ex?.cardioModality ? 'cardio' : ex ? 'resistance' : 'other',
      ...(i.distanceM !== undefined && i.distanceM !== null && Number.isFinite(i.distanceM)
        ? { distanceM: i.distanceM }
        : {}),
    },
    ...(stepsIncluded !== null && stepsIncluded > 0 ? { stepsIncluded } : {}),
    ...(ex && !ex.cardioModality ? { doseStatus: 'unknown' as const } : {}),
    physicalBoutId: key,
    candidate: {
      key,
      decidedRevision: i.decidedRevision,
      sourceRevision: i.candidate.sourceRevision,
      estimateRevision: i.candidate.estimateRevision,
      estimatorVersion: i.estimate.booked.version,
      ...(manual ? { manual: true as const } : {}),
    },
    source,
    provenance: 'estimated',
    sourceVersion: i.estimate.version,
    occurrence: i.timeUnknown
      ? dateOnlyOccurrence(date, 'appDay', 'user')
      : intervalOccurrence(i.decision.startAt, i.decision.endAt, {
          tz: i.tz,
          date,
          dateMeaning: 'appDay',
          source: source.by === 'device' ? 'device' : 'user',
        }),
    ...(i.decision.asItemId ? { itemId: i.decision.asItemId } : { extra: true }),
    // (0.6.3 S7/A10) where the phone was: step fusion reads it from the entry (`fuseActivitiesOf`)
    ...(i.decision.carry ? { carry: i.decision.carry } : {}),
    ...(i.supersedes ? { supersedes: i.supersedes } : {}),
    ...(i.zones
      ? { zones: { ...i.zones, edgesBpm: [...i.zones.edgesBpm] as unknown as ZoneBoundaries['edgesBpm'] } }
      : {}),
    ...(paused ? movingField(window, i.candidate.pauses) : {}),
  };
  return { id: decisionEntryId(date, key, i.decidedRevision, i.supersedes), entry };
}

/**
 * The located steps inside the decided window (§V3.5, Codex #9): the candidate's measured steps when the window is the
 * recorded one; for a moved or resized window, the fused minute steps inside the new window from the stored evidence;
 * unknown (null) otherwise — an edit never invents an overlap from a scaled count.
 */
function includedSteps(i: SessionEntryInput, startMs: Ms, endMs: Ms): number | null {
  const m = i.candidate.measures.steps;
  const w = i.candidate.window;
  const same = !w || (w.start === startMs && w.end === endMs);
  if (same && m !== null && Number.isFinite(m)) return Math.round(m);
  if (same && !w) return null;
  return stepsInWindow(i.candidate.evidence ?? null, { start: startMs, end: endMs });
}

// ------------------------------------------------------------------------------------------- decisions
export type DecisionRefusal =
  | { code: 'not_found'; message: string }
  | { code: 'conflict'; message: string; current?: string }
  | { code: 'precondition_failed'; message: string };

/**
 * (0.6.7) Two estimates book the same activity for the person: the same type, minutes within 2 (or a tenth), gross energy
 * within 15 kcal (or 15 %) and Heart Points within 3 (or 15 %). A decision is about the activity, not the evidence's
 * decimals: a minute more from a re-sent recording or a few kcal from late heart-rate minutes never re-opens it (what was
 * decided stays booked); a different type or a materially different bout does.
 */
export function sameBooked(
  a: CandidateEstimate | null | undefined,
  b: CandidateEstimate | null | undefined,
): boolean {
  return bookingChanges(a, b).length === 0;
}

/** (r069) What an activity's booking changed in, as the review names it ("updated": its times, minutes, energy, points). */
export type BookingChange = 'type' | 'times' | 'minutes' | 'energy' | 'points' | 'estimate';

const near = (x: number, y: number, abs: number, rel: number) =>
  Math.abs(x - y) <= Math.max(abs, rel * Math.max(Math.abs(x), Math.abs(y)));

/** (r069) How `b` books the activity differently from `a` (`sameBooked`'s tolerances); `estimate` when either is missing. */
export function bookingChanges(
  a: CandidateEstimate | null | undefined,
  b: CandidateEstimate | null | undefined,
): BookingChange[] {
  if (!a || !b) return ['estimate'];
  const out: BookingChange[] = [];
  if (a.exerciseId !== b.exerciseId) out.push('type');
  if (!near(a.durationMin, b.durationMin, 2, 0.1)) out.push('minutes');
  if (!near(a.booked.grossKcal, b.booked.grossKcal, 15, 0.15)) out.push('energy');
  if (!near(a.heartPoints ?? 0, b.heartPoints ?? 0, 3, 0.15)) out.push('points');
  return out;
}

/** (r069) Two windows are the same bout's times: each end within 2 minutes (or a tenth of the longer). */
export function sameTimes(a: Interval, b: Interval): boolean {
  const tol = Math.max(2 * 60_000, 0.1 * Math.max(a.end - a.start, b.end - b.start));
  return Math.abs(a.start - b.start) <= tol && Math.abs(a.end - b.end) <= tol;
}

/** Can this candidate be approved at `revision`? (approve and approve all bind only the visible revision). */
export function checkApprovable(c: CandidateRecord | undefined, revision: string): DecisionRefusal | null {
  if (!c) return { code: 'not_found', message: 'That activity is no longer in the review list.' };
  if (isTombstone(c)) return { code: 'precondition_failed', message: 'That activity was resolved long ago.' };
  if (c.status === 'rejected')
    return {
      code: 'precondition_failed',
      message: 'That activity was rejected; it cannot be approved again.',
    };
  if (c.status === 'superseded')
    return { code: 'precondition_failed', message: 'That activity was withdrawn by its source.' };
  if (c.revision !== revision)
    return {
      code: 'conflict',
      message: 'That activity was updated since you looked. Review it again.',
      current: c.revision,
    };
  return null;
}

/**
 * (0.6.3 S26) A recording's catalogue activity (`activity_type_id`) when it names a known exercise in Gauge's id shape,
 * else null: the activity to review then suggests it instead of the coarse type's guess.
 */
export function knownActivityTypeId(id: unknown): string | null {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_]{0,47}$/.test(id) && exerciseRecordOf(id) !== undefined
    ? id
    : null;
}

/** The default decision of a candidate (what Approve accepts): the suggested type and the recorded window. */
export function defaultDecision(c: ActivityCandidateDoc, asItemId?: string): CandidateDecision {
  return {
    exerciseId: c.suggested.exerciseId,
    startAt: c.startAt,
    endAt: c.endAt,
    ...(asItemId ? { asItemId } : {}),
  };
}

/** The candidate after a decision (audit trail kept). */
export function decided(
  c: ActivityCandidateDoc,
  o: {
    status: 'approved' | 'edited' | 'rejected';
    decidedRevision: string | null;
    entryId: string | null;
    decision: CandidateDecision | null;
    estimate: CandidateEstimate | null;
    now: Instant;
    /** (r070) Who decided: the person (default), or the automatic rules. */
    by?: DecidedBy;
  },
): ActivityCandidateDoc {
  // (r069) a new decision answers whatever had changed
  const { updatedFrom: _u, ...cand } = c;
  void _u;
  const history =
    isOpenStatus(c.status) && c.history.length === 0
      ? c.history
      : [
          ...c.history,
          {
            status: c.status,
            revision: c.decidedRevision,
            entryId: c.entryId,
            at: c.decidedAt ?? c.updatedAt,
          },
        ];
  return {
    ...cand,
    status: o.status,
    decidedRevision: o.decidedRevision,
    // (F1) the evidence revision this decision was made on: only a later change of it reads "updated"
    baseRevision: c.revision,
    entryId: o.entryId,
    decision: o.decision,
    decidedEstimate: o.estimate,
    decidedAt: o.now,
    decidedBy: o.by ?? 'user',
    resolvedAt: o.now,
    updatedAt: o.now,
    history,
  };
}

/** The revision an edit binds: the candidate's revision with the edit's own fields. */
export const editRevisionOf = (revision: string, d: CandidateDecision): string =>
  contentHash(['edit', revision, d]);

// ------------------------------------------------------------------------------------------- manual log
/** A manual candidate key (no device ref): deterministic from the command's own id. */
export const manualRef = (id: string): string => `manual:${id}`;

/** A candidate made by hand (`activity.logManual`): every ref is a `manual:` one. */
export const isManualCandidate = (c: Pick<ActivityCandidateDoc, 'refs'>): boolean =>
  c.refs.length > 0 && c.refs.every((r) => r.startsWith('manual:'));

/** The window a candidate counts over: the decided one, else the recorded one. */
export const decidedWindowOf = (c: ActivityCandidateDoc): Interval =>
  c.decision ? { start: Date.parse(c.decision.startAt), end: Date.parse(c.decision.endAt) } : c.window;

/** Overlap of two windows as a fraction of the shorter (0 when either is empty). */
function overlapOfShorter(a: Interval, b: Interval): number {
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? overlapMs(a.start, a.end, b.start, b.end) / shorter : 0;
}

export interface ManualOverlap {
  key: string;
  entryId: string | null;
  overlapPct: number;
  /** (0.6.3 A5) A pending recording counts too: approving it later would book the same movement twice. */
  status: 'pending' | 'approved' | 'edited';
  /** (r070) Nobody decided it: pending, or counted by the automatic rules. A hand log replaces it without asking. */
  auto: boolean;
  exerciseId: string;
  startAt: Instant;
  endAt: Instant;
}

/**
 * Device bouts (pending, approved or edited) the manual window overlaps by ≥ 50 % of the shorter (§V3.3): raised for the
 * person to resolve before anything is saved (0.6.3 A5: replace, link, or "these were separate"), never merged on its own.
 * Sorted by overlap, largest first.
 */
export function overlappingBouts(window: Interval, candidates: readonly CandidateRecord[]): ManualOverlap[] {
  const out: ManualOverlap[] = [];
  for (const c of candidates) {
    if (isTombstone(c) || (c.status !== 'approved' && c.status !== 'edited' && c.status !== 'pending'))
      continue;
    // (0.6.5) another timed hand log is an overlap too (two logs of one walk counted it twice); a log with no clock time
    // has a placeholder window and never overlaps anything
    if (isManualCandidate(c) && c.timeUnknown === true) continue;
    const w = decidedWindowOf(c);
    const pct = overlapOfShorter(w, window);
    if (pct >= MANUAL_OVERLAP_CONFLICT)
      out.push({
        key: c.key,
        entryId: c.entryId,
        overlapPct: Math.round(pct * 100),
        status: c.status,
        auto: c.status === 'pending' || c.decidedBy === 'auto',
        exerciseId: c.decision?.exerciseId ?? c.suggested.exerciseId,
        startAt: new Date(w.start).toISOString(),
        endAt: new Date(w.end).toISOString(),
      });
  }
  return out.sort((a, b) => b.overlapPct - a.overlapPct || (a.key < b.key ? -1 : 1));
}

/**
 * (0.6.3 S3/A4) The other candidates that look like the same physical bout as `c`, whatever their state (pending, approved
 * or edited): a merge suggestion either way (by key or by a ref of the other), or a hand-logged activity and a recording
 * overlapping by ≥ 50 % of the shorter. Pairs the person said were separate (`separateFrom`, either side) are left out;
 * rejected, superseded and compacted candidates never count.
 */
export function duplicatePartners(
  c: ActivityCandidateDoc,
  records: readonly CandidateRecord[],
): Array<{ key: string; status: 'pending' | 'approved' | 'edited' }> {
  const live = records.filter(
    (o): o is ActivityCandidateDoc =>
      !isTombstone(o) &&
      o.key !== c.key &&
      (o.status === 'pending' || o.status === 'approved' || o.status === 'edited'),
  );
  const points = (a: ActivityCandidateDoc, b: ActivityCandidateDoc) =>
    a.mergeSuggestions.some((m) => m.withKey === b.key || b.refs.includes(m.withRef));
  const manual = isManualCandidate(c);
  const out: Array<{ key: string; status: 'pending' | 'approved' | 'edited' }> = [];
  for (const o of live) {
    if (c.separateFrom?.includes(o.key) || o.separateFrom?.includes(c.key)) continue;
    const timed = c.timeUnknown !== true && o.timeUnknown !== true;
    const same =
      points(c, o) ||
      points(o, c) ||
      (timed &&
        manual !== isManualCandidate(o) &&
        overlapOfShorter(decidedWindowOf(c), decidedWindowOf(o)) >= MANUAL_OVERLAP_CONFLICT);
    if (same) out.push({ key: o.key, status: o.status as 'pending' | 'approved' | 'edited' });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

// ------------------------------------------------------------------------------------------- automatic acceptance (r070)
/**
 * (r070, owner 2026-10-30: "I don't want to review shit at all") What comes in automatically is counted without asking,
 * the way Google Fit counts its own sessions. The rules, in order:
 *  - the person's own decisions stand: an approval, an edit, a hand log or a removal is never changed, merged or asked
 *    about again (an earlier version's "updated since you approved it" marker on one is cleared);
 *  - one bout is one activity. Two candidates are the same bout when one covers at least half of the other
 *    (`AUTO_SAME_BOUT` of the shorter, the old "looks like the same activity" hold); the one of higher precedence stays
 *    and the other is merged into it (superseded, never counted, never shown as a pair). Precedence (`autoRank`): the
 *    person's own decision, a Health Connect entry the person typed in, a Gauge recording, a session the person recorded
 *    in another app, a Health Connect session with heart rate or a route, any other Health Connect session (Google Fit's
 *    automatic walks), a ring sport window, a strong detection, a weak one. Ties: the one already counted, the longer,
 *    the first seen, the key (stable from pass to pass);
 *  - a removal sticks: an open candidate that is the removed one again (the same recording over half of it, or any source
 *    near-identical to it, `nearSame`) is merged into the removal;
 *  - what stays is accepted: a recording (Gauge, Health Connect, the ring), a detection the server linked to a recording,
 *    or a strong detection (level high, its type known). A weak or ambiguous detection becomes a quiet `possible`;
 *  - an automatic decision follows its source: when what it books changed materially (`updatedFrom`: type, times,
 *    minutes, energy, points) it is booked again, silently;
 *  - an activity merged automatically into one that its source later deleted (Google Fit writing one session over
 *    another) is open again and resolved again.
 */
export const AUTO_SAME_BOUT = 0.5;

export type AutoAcceptReason = 'recording' | 'detection' | 'updated';

export interface AutoAcceptPlan {
  /** Book these at their current revision with their default decision, `decidedBy: 'auto'`. */
  accept: Array<{ key: string; reason: AutoAcceptReason }>;
  /** Merge these into `into` (superseded; a counted one's sessions leave the day). */
  merge: Array<{ key: string; into: string }>;
  /** Open candidates that are only a weak or ambiguous detection: `possible`. */
  possible: string[];
  /** Decided candidates that carry a stale "updated" marker: cleared, nothing else changes. */
  clear: string[];
}

/** (r070) Where an automatically counted activity came from (the sheet says "Added automatically from …"). */
export interface AutoOrigin {
  kind: 'healthConnect' | 'gauge' | 'ring' | 'detected';
  /** The Health Connect app (its package). */
  app?: string;
  method?: HcRecordingMethod;
}

const SOURCE_ORDER: Record<CandidateSource, number> = {
  gaugeSession: 0,
  hcSession: 1,
  ringTelemetry: 2,
  automaticDetector: 3,
  cadenceDetector: 4,
  hrDetector: 5,
};

/** The source a candidate's words name: its recording before any detector (a Gauge recording before Health Connect). */
function leadSource(c: ActivityCandidateDoc): ActivityCandidateDoc['sources'][number] | undefined {
  return [...c.sources].sort(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
  )[0];
}

/** (r070) The origin of an automatically counted activity: its lead source, the app from its words for older records. */
export function autoOriginOf(c: ActivityCandidateDoc): AutoOrigin {
  const s = leadSource(c);
  if (!s) return { kind: 'detected' };
  if (s.source === 'gaugeSession') return { kind: 'gauge' };
  if (s.source === 'ringTelemetry') return { kind: 'ring' };
  if (s.source !== 'hcSession') return { kind: 'detected' };
  const app = s.origin ?? /^(\S+) wrote /.exec(c.suggested.why[0] ?? '')?.[1];
  return { kind: 'healthConnect', ...(app ? { app } : {}), ...(s.method ? { method: s.method } : {}) };
}

const isPersonDecision = (c: ActivityCandidateDoc): boolean =>
  (c.status === 'approved' || c.status === 'edited') && c.decidedBy !== 'auto';
const isAutoCounted = (c: ActivityCandidateDoc): boolean =>
  (c.status === 'approved' || c.status === 'edited') && c.decidedBy === 'auto';

/** (r070) A detection-only candidate the automatic rules accept: level high with its type known (or a local high window). */
function strongDetection(c: ActivityCandidateDoc): boolean {
  if (c.detection) return c.detection.level === 'high' && !needsTypeChoice(c);
  return c.suggested.confidence === 'high';
}

/** (r070) Can the automatic rules count this candidate: a recording, a detection on a recording, or a strong detection. */
export function autoAcceptable(c: ActivityCandidateDoc): boolean {
  if (needsTypeChoice(c)) return false;
  if (c.sources.some((s) => !isDetectorSource(s.source))) return true;
  if (c.detection?.recordingRefs?.length) return true;
  return strongDetection(c);
}

/** (r070) Precedence of a candidate (lower wins); see `planAutoAccept`. */
export function autoRank(c: ActivityCandidateDoc): number {
  if (isPersonDecision(c)) return 0;
  let best = 9;
  for (const s of c.sources) {
    const r =
      s.source === 'hcSession'
        ? s.method === 'manual'
          ? 1
          : s.method === 'active'
            ? 3
            : s.confidence === 'high'
              ? 4
              : 5
        : s.source === 'gaugeSession'
          ? 2
          : s.source === 'ringTelemetry'
            ? 6
            : strongDetection(c) || c.detection?.recordingRefs?.length
              ? 7
              : 8;
    best = Math.min(best, r);
  }
  return best;
}

/** The deletable recordings a candidate names (a session block's ref names its session). */
const recordingsOf = (c: ActivityCandidateDoc): Set<string> =>
  new Set(c.refs.filter(isDeletableRef).map(recordingRefOf));

const separated = (a: ActivityCandidateDoc, b: ActivityCandidateDoc): boolean =>
  (a.separateFrom?.includes(b.key) ?? false) || (b.separateFrom?.includes(a.key) ?? false);

/**
 * (r070) The automatic decisions over every stored candidate (`planAutoAccept`'s rules above). Pure and deterministic:
 * the same records give the same plan, and a plan applied gives an empty plan on the next pass.
 */
export function planAutoAccept(records: readonly CandidateRecord[]): AutoAcceptPlan {
  const full = records.filter((c): c is ActivityCandidateDoc => !isTombstone(c));
  const byKey = new Map(full.map((c) => [c.key, c] as const));
  // an automatic merge whose winner its source withdrew (deleted upstream, not brought back): open again
  const revived = new Set(
    full
      .filter((c) => {
        if (c.status !== 'superseded' || !c.mergedInto || c.withdrawn) return false;
        const w = byKey.get(c.mergedInto);
        return w !== undefined && w.status === 'superseded' && w.withdrawn?.reason === 'sourceDeleted';
      })
      .map((c) => c.key),
  );
  const open = (c: ActivityCandidateDoc) => isOpenStatus(c.status) || revived.has(c.key);
  const rebook = (c: ActivityCandidateDoc) => isAutoCounted(c) && isUpdated(c);
  const live = full.filter((c) => c.timeUnknown !== true && (open(c) || isPersonDecision(c) || isAutoCounted(c)));
  const windowOf = (c: ActivityCandidateDoc): Interval => (open(c) || rebook(c) ? c.window : decidedWindowOf(c));
  const len = (w: Interval) => w.end - w.start;
  const ordered = [...live].sort((a, b) => {
    const ra = autoRank(a);
    const rb = autoRank(b);
    if (ra !== rb) return ra - rb;
    const ca = isAutoCounted(a) ? 0 : 1;
    const cb = isAutoCounted(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const la = len(windowOf(a));
    const lb = len(windowOf(b));
    if (la !== lb) return lb - la;
    if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  // the person's removals (a rejected candidate): what is the removed activity again stays removed
  // (a hand log the person removed is not: a recording of the same walk still counts)
  const removals = full.filter((c) => c.status === 'rejected' && c.timeUnknown !== true && !isManualCandidate(c));
  const plan: AutoAcceptPlan = { accept: [], merge: [], possible: [], clear: [] };
  const kept: ActivityCandidateDoc[] = [];
  for (const c of ordered) {
    if (isPersonDecision(c)) {
      kept.push(c);
      if (c.updatedFrom) plan.clear.push(c.key);
      continue;
    }
    const w = windowOf(c);
    if (open(c)) {
      const mine = recordingsOf(c);
      const removed = removals.find(
        (r) =>
          !separated(c, r) &&
          (nearSame(w, r.window) ||
            ([...recordingsOf(r)].some((x) => mine.has(x)) && overlapOfShorter(w, r.window) >= AUTO_SAME_BOUT)),
      );
      if (removed) {
        if (c.mergedInto !== removed.key || c.status !== 'superseded')
          plan.merge.push({ key: c.key, into: removed.key });
        continue;
      }
    }
    const host = kept.find((k) => !separated(c, k) && overlapOfShorter(w, windowOf(k)) >= AUTO_SAME_BOUT);
    if (host) {
      if (c.status !== 'superseded' || c.mergedInto !== host.key) plan.merge.push({ key: c.key, into: host.key });
      continue;
    }
    kept.push(c);
    if (open(c)) {
      if (autoAcceptable(c))
        plan.accept.push({
          key: c.key,
          reason: c.sources.some((s) => !isDetectorSource(s.source)) ? 'recording' : 'detection',
        });
      else if (c.status !== 'possible') plan.possible.push(c.key);
    } else if (rebook(c)) plan.accept.push({ key: c.key, reason: 'updated' });
    else if (c.updatedFrom) plan.clear.push(c.key);
  }
  return plan;
}

// ------------------------------------------------------------------------------------------- review model (V4 hook)
export interface ReviewRow {
  id: string;
  revision: string;
  status: CandidateStatus;
  updated: boolean;
  /** (r069) What an updated activity books differently now (its times, minutes, energy, points). */
  updatedChanges?: BookingChange[];
  exerciseId: string;
  needsReview: boolean;
  confidence: Confidence;
  why: string[];
  date: LocalDate;
  /** (r063 FX2 sR16) `startAt`/`endAt` are a placeholder: the person logged it without a clock time (show no time). */
  timeUnknown?: true;
  startAt: Instant;
  endAt: Instant;
  minutes: number;
  /** Booked gross kcal and its scenario range (null in quiet mode or without an estimate). */
  kcal: { value: number; range: Envelope; method: string; label: 'estimated' } | null;
  heartPoints: number | null;
  sources: Array<{ source: CandidateSource; confidence: Confidence }>;
  /**
   * (r070) Counted by the automatic rules (the person never chose it): `from` says where it came from, for the sheet's
   * "Added automatically from Google Fit". Absent on the person's own decisions.
   */
  auto?: { from: AutoOrigin };
  planMatch: PlanMatch | null;
  mergeSuggestions: CandidateDraft['mergeSuggestions'];
  /**
   * (0.6.7 AD-VITALS) A detected activity (the server's detection episode): its label, level, reasons, the type choices and
   * whether the person must still choose the type (`needsType`: Approve waits for the choice).
   */
  detection?: {
    label: string;
    level: Confidence;
    reasons: string[];
    choices: string[];
    needsType: boolean;
    coverage?: DetectionInfo['coverage'];
  };
}

export interface ReviewSheetModel {
  /**
   * "N activities to review · M min · ~K kcal" (K absent in quiet mode). (0.6.7) `detected`: how many of them were detected
   * (the server's detection episodes), so the strip says so.
   */
  strip: { count: number; minutes: number; kcal: number | null; text: string; detected?: number } | null;
  rows: ReviewRow[];
  /**
   * What Approve all sends: exactly the revisions the sheet shows (D8: nothing else is approved). Rows that look like the
   * same movement as another candidate, open or already approved, are `held` (F2, 0.6.3 S3/A4): the same movement is
   * never booked twice without the person choosing (`withIds` may name approved activities that are not rows).
   */
  approveAll: {
    items: Array<{ id: string; revision: string }>;
    held?: Array<{ id: string; withIds: string[] }>;
  };
  /** Recently decided rows (approved, edited, rejected) for undo and the audit view. */
  decided: ReviewRow[];
  /** (r070) Weak or ambiguous detections, never counted and never a task: the person may add one with one tap. */
  possible: ReviewRow[];
  quiet: boolean;
  provisionalOverlay: boolean;
}

function rowOf(c: ActivityCandidateDoc, quiet: boolean): ReviewRow {
  const e = isOpenStatus(c.status) || isUpdated(c) ? c.estimate : (c.decidedEstimate ?? c.estimate);
  // (Claude P2-18) the moving minutes of the decided window (pauses are never exercise time), as the kcal beside them
  const win = c.decision
    ? { start: Date.parse(c.decision.startAt), end: Date.parse(c.decision.endAt) }
    : c.window;
  const minutes = Math.round(movingMinutes(win, c.pauses));
  return {
    id: c.key,
    revision: c.revision,
    status: c.status,
    updated: isUpdated(c),
    ...(isUpdated(c) && c.updatedFrom?.changes.length ? { updatedChanges: [...c.updatedFrom.changes] } : {}),
    exerciseId: c.decision?.exerciseId ?? c.suggested.exerciseId,
    needsReview: c.suggested.needsReview,
    confidence: c.suggested.confidence,
    why: c.suggested.why,
    date: c.date,
    ...(c.timeUnknown === true ? { timeUnknown: true as const } : {}),
    startAt: c.decision?.startAt ?? c.startAt,
    endAt: c.decision?.endAt ?? c.endAt,
    minutes,
    kcal:
      e && !quiet
        ? {
            value: e.booked.grossKcal,
            range: { ...e.booked.envelope },
            method: e.booked.method,
            label: 'estimated',
          }
        : null,
    heartPoints: e?.heartPoints ?? null,
    sources: c.sources.map((s) => ({ source: s.source, confidence: s.confidence })),
    ...(c.decidedBy === 'auto' && (c.status === 'approved' || c.status === 'edited')
      ? { auto: { from: autoOriginOf(c) } }
      : {}),
    planMatch: c.planMatch,
    mergeSuggestions: c.mergeSuggestions,
    ...(c.detection
      ? {
          detection: {
            label: c.detection.label,
            level: c.detection.level,
            reasons: [...c.detection.reasons],
            choices: [...c.detection.choices],
            needsType: needsTypeChoice(c),
            ...(c.detection.coverage ? { coverage: { ...c.detection.coverage } } : {}),
          },
        }
      : {}),
  };
}

/** The review strip and sheet (§V4.2) over the stored candidates in [from, to]. */
export function reviewSheetModel(
  records: readonly CandidateRecord[],
  o: { from?: LocalDate; to?: LocalDate; quiet?: boolean; provisionalOverlay?: boolean } = {},
): ReviewSheetModel {
  const quiet = o.quiet === true;
  const inRange = (c: ActivityCandidateDoc) =>
    (!o.from || compareDates(c.date, o.from) >= 0) && (!o.to || compareDates(c.date, o.to) <= 0);
  const full = records.filter((c): c is ActivityCandidateDoc => !isTombstone(c)).filter(inRange);
  // (r070) only what cannot be counted yet is open (no weight on record); an automatic decision's "updated" marker is
  // booked again by `planAutoAccept`, never asked about
  const open = full
    .filter((c) => c.status === 'pending')
    .sort((a, b) => a.window.start - b.window.start || (a.key < b.key ? -1 : 1));
  const rows = open.map((c) => rowOf(c, quiet));
  const minutes = rows.reduce((s, r) => s + r.minutes, 0);
  const kcal = quiet ? null : rows.reduce((s, r) => s + (r.kcal?.value ?? 0), 0);
  const n = rows.length;
  const detectedN = rows.filter((r) => r.detection).length;
  const text =
    n === 0
      ? ''
      : `${n} ${n === 1 ? 'activity' : 'activities'} to review · ${minutes} min${kcal !== null && kcal > 0 ? ` · ~${Math.round(kcal)} kcal` : ''}`;
  // (F2, 0.6.3 S3/A4) an open row that describes the same movement as another candidate (open, approved or edited) waits
  // for the person's choice: approving one of two duplicates no longer releases the other into Approve all
  const pairs = new Map<string, Set<string>>();
  for (const c of open) {
    const twins = duplicatePartners(c, records);
    if (twins.length > 0) pairs.set(c.key, new Set(twins.map((t) => t.key)));
  }
  const held = [...pairs]
    .map(([id, w]) => ({ id, withIds: [...w].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const decidedRows = full
    .filter((c) => c.status === 'approved' || c.status === 'edited' || c.status === 'rejected')
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
    .map((c) => rowOf(c, quiet));
  const possibleRows = full
    .filter((c) => c.status === 'possible')
    .sort((a, b) => a.window.start - b.window.start || (a.key < b.key ? -1 : 1))
    .map((c) => rowOf(c, quiet));
  return {
    strip:
      n > 0
        ? {
            count: n,
            minutes,
            kcal: kcal !== null ? Math.round(kcal) : null,
            text,
            ...(detectedN > 0 ? { detected: detectedN } : {}),
          }
        : null,
    rows,
    approveAll: {
      // (0.6.7) a detected activity without a type waits for the person's choice, never approved in bulk
      items: rows
        .filter((r) => !pairs.has(r.id) && !r.detection?.needsType)
        .map((r) => ({ id: r.id, revision: r.revision })),
      ...(held.length > 0 ? { held } : {}),
    },
    decided: decidedRows,
    possible: possibleRows,
    quiet,
    provisionalOverlay: o.provisionalOverlay !== false,
  };
}

/** Pending candidates of a day as provisional bouts (hatched "to review" on Today; never in the plan projection, D8). */
export function provisionalBouts(
  records: readonly CandidateRecord[],
  date: LocalDate,
  enabled: boolean,
): Array<{ id: string; window: Interval; kcal: number | null }> {
  if (!enabled) return [];
  return records
    .filter((c): c is ActivityCandidateDoc => !isTombstone(c) && c.status === 'pending' && c.date === date)
    .map((c) => ({ id: c.key, window: { ...c.window }, kcal: c.estimate?.booked.grossKcal ?? null }));
}

/** The earliest app date a candidate change touches (late edits invalidate the history from there). */
export function earliestChangedDate(
  before: CandidateRecord | undefined,
  after: ActivityCandidateDoc,
): LocalDate {
  const a = before && !isTombstone(before) ? before.date : after.date;
  return compareDates(a, after.date) <= 0 ? a : after.date;
}

/** Dates within the late-correction window (inside it a correction supersedes; older ones only list "changed upstream"). */
export const withinCorrectionWindow = (date: LocalDate, today: LocalDate, days = 30): boolean =>
  compareDates(date, addDays(today, -(days - 1))) >= 0;

// ------------------------------------------------------------------------------------------- the estimate (V2 wiring)
/** The person facts the V2 estimators read (dated mass, age, coefficient set, the engine RMR). */
export interface PersonForEstimate {
  massKg: number;
  ageY: number | null;
  sex: 'male' | 'female' | null;
  rmrKcalPerDay: number | null;
}

/** Minute evidence of the bout window from the fused timeline (steps and supported HR per minute). */
export interface WindowMinutes {
  first: Ms;
  steps: readonly (number | null)[];
  hr?: { bpm: readonly (number | null)[]; supportedS: readonly (number | null)[] };
  /**
   * (Codex #11) The exact supported segments of the raw HR readings over the same span (`hr-intervals`), when the server
   * sent them for all of it: zone time, Keytel and Heart Points then use each reading's own interval, and the minute
   * means only when these are absent.
   */
  hrExact?: readonly HrSegment[];
  /** Known asleep minutes (no Heart Points). */
  asleep?: readonly boolean[];
  /**
   * (r063 S16/A19) Health Connect speed per minute, m/s (the server timeline's `hc.speedMps`), and its quality:
   * `speedAccepted` true where the minute's value is a measurement in range (not a manual entry). Only accepted minutes
   * reach the speed estimator. `gradePct`: the minute's grade, when a source gives one.
   */
  speedMps?: readonly (number | null)[];
  speedAccepted?: readonly boolean[];
  gradePct?: readonly (number | null)[];
  /**
   * (r063 S16/A19) Health Connect power per minute, W, and `powerVerified` (the minute's source is verified external work).
   * Unverified power is evidence only: it never changes the energy.
   */
  powerW?: readonly (number | null)[];
  powerVerified?: readonly boolean[];
  /**
   * (0.6.3 FX5) Gauge's route-derived moving speed per minute, m/s (the server timeline's `gps.speedMps`), and
   * `gpsSpeedAccepted` (a measurement: enough accurate fixes, in range). Kept apart from Health Connect's speed: an
   * activity takes one source.
   */
  gpsSpeedMps?: readonly (number | null)[];
  gpsSpeedAccepted?: readonly boolean[];
}

/** (r063 S16/A19) What `hcMotionMinutes` reads of a server timeline day (`hc` and `evidence`, `GaugeTimeline`). */
export interface TimelineMotion {
  hc?: {
    speedMps?: ReadonlyArray<number | null> | null;
    speedSource?: ReadonlyArray<string | null> | null;
    powerW?: ReadonlyArray<number | null> | null;
    powerSource?: ReadonlyArray<string | null> | null;
  } | null;
  evidence?: {
    speed?: ReadonlyArray<{ source: string; recordingMethod?: unknown; verified?: boolean }>;
    power?: ReadonlyArray<{ source: string; recordingMethod?: unknown; verified?: boolean }>;
  } | null;
}

const isManualEntry = (m: unknown): boolean =>
  Array.isArray(m) ? m.some(isManualEntry) : m === 'manualEntry' || m === 3;
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** (r063 S16/A19) A value outside what `activity.fromGauge` takes (speed 0-100 m/s, power 0-3000 W) is not a reading: null. */
const inRange = (v: unknown, max: number): number | null => {
  const x = finiteOrNull(v);
  return x !== null && x >= 0 && x <= max ? x : null;
};

/** (r063 S16/A19) A day's Health Connect motion minutes (`hcMotionMinutes`). */
export interface MotionMinutes {
  speedMps?: Array<number | null>;
  speedAccepted?: boolean[];
  powerW?: Array<number | null>;
  powerVerified?: boolean[];
}
/**
 * (r063 S16/A19) The per-minute Health Connect speed and power of a timeline day of `n` minutes, with their quality: a
 * speed minute is accepted when its value is in [0, `measuredSpeedMaxMps`] and its source is not a manual entry (Health
 * Connect `recordingMethod`); a power minute is verified only when its source's evidence says `verified: true` (the server
 * marks Health Connect power unverified). Empty when the day has neither, so a day without them adds nothing.
 */
export function hcMotionMinutes(t: TimelineMotion | null | undefined, n: number): MotionMinutes {
  const hc = t?.hc;
  if (!hc || !(n > 0)) return {};
  const methods = (
    list: ReadonlyArray<{ source: string; recordingMethod?: unknown; verified?: boolean }> | null | undefined,
  ) => new Map((Array.isArray(list) ? list : []).map((x) => [x.source, x] as const));
  const out: MotionMinutes = {};
  const speed = Array.isArray(hc.speedMps) ? hc.speedMps : null;
  if (speed && speed.some((v) => inRange(v, 100) !== null)) {
    const ev = methods(t?.evidence?.speed);
    const src = Array.isArray(hc.speedSource) ? hc.speedSource : [];
    const mps = Array.from({ length: n }, (_, k) => inRange(speed[k], 100));
    out.speedMps = mps;
    out.speedAccepted = mps.map((v, k) => {
      const s = src[k];
      return (
        v !== null &&
        v <= sp('measuredSpeedMaxMps') &&
        typeof s === 'string' &&
        !isManualEntry(ev.get(s)?.recordingMethod)
      );
    });
  }
  const power = Array.isArray(hc.powerW) ? hc.powerW : null;
  if (power && power.some((v) => inRange(v, 3000) !== null)) {
    const ev = methods(t?.evidence?.power);
    const src = Array.isArray(hc.powerSource) ? hc.powerSource : [];
    const w = Array.from({ length: n }, (_, k) => inRange(power[k], 3000));
    out.powerW = w;
    out.powerVerified = w.map((v, k) => {
      const s = src[k];
      const e = typeof s === 'string' ? ev.get(s) : undefined;
      return v !== null && e?.verified === true && !isManualEntry(e.recordingMethod);
    });
  }
  return out;
}

/** (0.6.3 FX5) What `gpsMotionMinutes` reads of a server timeline day (`gps`, `GaugeTimeline`). */
export interface TimelineGps {
  gps?: { speedMps?: ReadonlyArray<number | null> | null; accepted?: ReadonlyArray<boolean> | null } | null;
}

/**
 * (0.6.3 FX5) The per-minute Gauge GPS speed of a timeline day of `n` minutes: accepted where the server accepted it
 * (enough accurate fixes) and the value is in [0, `measuredSpeedMaxMps`]. Empty when the day has none.
 */
export function gpsMotionMinutes(
  t: TimelineGps | null | undefined,
  n: number,
): { gpsSpeedMps?: Array<number | null>; gpsSpeedAccepted?: boolean[] } {
  const g = t?.gps;
  const speed = g && Array.isArray(g.speedMps) ? g.speedMps : null;
  if (!speed || !(n > 0) || !speed.some((v) => inRange(v, 100) !== null)) return {};
  const ok = Array.isArray(g!.accepted) ? g!.accepted : [];
  const mps = Array.from({ length: n }, (_, k) => inRange(speed[k], 100));
  return {
    gpsSpeedMps: mps,
    gpsSpeedAccepted: mps.map((v, k) => v !== null && v <= sp('measuredSpeedMaxMps') && ok[k] === true),
  };
}

/** (r063 S16/A19) A window's Health Connect speed and power over its moving seconds (pauses left out). */
export interface WindowMotion {
  /**
   * Mean accepted speed (km/h) and grade (fraction, when every accepted minute has one); coverage of moving time.
   * (0.6.3 FX5) `source`: one per window. Gauge's GPS when it covers enough of the moving time, else Health Connect's
   * when it does, else whichever was there (GPS first) so the estimate can say why it was not used.
   */
  speed: {
    kmh: number | null;
    gradeFrac: number | null;
    coverage: number;
    anyValue: boolean;
    source: 'healthConnect' | 'gaugeGps';
  } | null;
  /** Mean power (W) over the minutes with a value; verified only when every one of them is. */
  power: { avgW: number; verified: boolean; coverage: number } | null;
}

/** (r063 S16/A19) The window's motion evidence from its minutes, each minute weighted by its moving seconds in the bout. */
export function windowMotion(
  m: WindowMinutes | null | undefined,
  window: Interval,
  pauses?: readonly Interval[] | null,
): WindowMotion {
  if (!m || (!m.speedMps && !m.powerW && !m.gpsSpeedMps)) return { speed: null, power: null };
  let moving = 0;
  let sS = 0;
  let sSum = 0;
  let gS = 0;
  let gSum = 0;
  let anySpeed = false;
  // (0.6.3 FX5) Gauge GPS speed, accumulated apart
  let qS = 0;
  let qSum = 0;
  let anyGps = false;
  let pS = 0;
  let pSum = 0;
  let allVerified = true;
  // (r063 FX4, cross-verification M21) walk the source grid: each source minute [first + k·60 s, +60 s) is intersected
  // with the window's moving time, so a window off the grid weights every minute by the seconds it really shares
  const k0 = Math.floor((window.start - m.first) / 60_000);
  for (let t = m.first + k0 * 60_000; t < window.end; t += 60_000) {
    const sec = boutSecondsIn(t, window, pauses);
    if (!(sec > 0)) continue;
    moving += sec;
    const k = Math.round((t - m.first) / 60_000);
    if (k < 0) continue;
    const v = m.speedMps?.[k] ?? null;
    if (v !== null) anySpeed = true;
    if (v !== null && m.speedAccepted?.[k] === true) {
      sS += sec;
      sSum += sec * v;
      const g = m.gradePct?.[k] ?? null;
      if (g !== null && Number.isFinite(g)) {
        gS += sec;
        gSum += sec * g;
      }
    }
    const q = m.gpsSpeedMps?.[k] ?? null;
    if (q !== null) anyGps = true;
    if (q !== null && m.gpsSpeedAccepted?.[k] === true) {
      qS += sec;
      qSum += sec * q;
    }
    const w = m.powerW?.[k] ?? null;
    if (w !== null && w >= 0) {
      pS += sec;
      pSum += sec * w;
      if (m.powerVerified?.[k] !== true) allVerified = false;
    }
  }
  if (!(moving > 0)) return { speed: null, power: null };
  const hcSpeed =
    m.speedMps && anySpeed
      ? {
          kmh: sS > 0 ? (sSum / sS) * 3.6 : null,
          gradeFrac: sS > 0 && gS === sS ? gSum / gS / 100 : null,
          coverage: sS / moving,
          anyValue: true,
          source: 'healthConnect' as const,
        }
      : null;
  // GPS gives no grade (level is assumed)
  const gpsSpeed =
    m.gpsSpeedMps && anyGps
      ? {
          kmh: qS > 0 ? (qSum / qS) * 3.6 : null,
          gradeFrac: null,
          coverage: qS / moving,
          anyValue: true,
          source: 'gaugeGps' as const,
        }
      : null;
  const enough = (x: typeof hcSpeed | typeof gpsSpeed) =>
    x !== null && x.kmh !== null && x.coverage >= sp('measuredMinCoverage');
  const speed = enough(gpsSpeed) ? gpsSpeed : enough(hcSpeed) ? hcSpeed : (gpsSpeed ?? hcSpeed);
  const power = pS > 0 ? { avgW: pSum / pS, verified: allVerified, coverage: pS / moving } : null;
  return { speed, power };
}

/** The window's HR segments and where they came from: exact readings when the evidence has them, else minute means. */
export function windowHrSegments(
  m: WindowMinutes | null | undefined,
  window: Interval,
): { segments: HrSegment[]; source: HrSource | null } {
  if (!m) return { segments: [], source: null };
  const r = hrSegmentsFor({
    exact: m.hrExact ?? null,
    minutes: m.hr ? { first: m.first, bpm: m.hr.bpm, supportedS: m.hr.supportedS } : null,
  });
  const segments = r.segments.filter((g) => g.end > window.start && g.start < window.end);
  return { segments, source: m.hrExact || m.hr ? r.source : null };
}

export interface EstimateRequest {
  exerciseId: string;
  window: Interval;
  person: PersonForEstimate;
  minutes?: WindowMinutes | null;
  intensity?: ActivityIntensity;
  kcalOverride?: number | null;
  /** DECISION D2 (`settings.keytelEnabled`). */
  keytelEnabled: boolean;
  vendor?: ReadonlyArray<{ source: string; kcal: number; method?: string }>;
  /** Pauses inside the window (Gauge `pauses`). */
  pauses?: readonly Interval[];
  inputsRef?: string;
}

/**
 * The bout's V2 estimate (`act-energy/1`) and Heart Points, as a compact copy. Inputs follow the window: supported HR of
 * the timeline minutes inside it (Keytel when D2 is on and the type is eligible), the stated intensity, speed and power, a
 * reported override ("the machine showed N kcal"); vendor kcal stay comparisons. Null for an unknown exercise id or an
 * empty window.
 */
export function estimateFor(r: EstimateRequest): CandidateEstimate | null {
  const ex = exerciseRecordOf(r.exerciseId);
  // (F8) the estimate books the moving minutes only: paused time is neither MET nor Keytel time
  const durationMin = movingMinutes(r.window, r.pauses);
  if (!ex || !(durationMin > 0) || !(r.person.massKg > 0)) return null;
  const m = r.minutes ?? null;
  const { segments, source } = windowHrSegments(m, r.window);
  const it = r.intensity;
  // (r063 S16/A19) Health Connect speed and power of the window: speed reaches the speed estimator only when accepted over
  // enough of the moving time and no speed was stated; power only when verified (unverified power is shown, never booked).
  // Supported Health Connect HR is already in the timeline's HR (`hr.source`), so it is not added here a second time.
  const motion = windowMotion(m, r.window, r.pauses);
  const minCover = sp('measuredMinCoverage');
  const speedGate = !motion.speed
    ? null
    : it?.speedKmh !== undefined
      ? 'statedSpeedFirst'
      : motion.speed.kmh === null
        ? 'speedNotAccepted'
        : motion.speed.coverage < minCover
          ? 'speedCoverageLow'
          : 'pass';
  const powerGate = !motion.power
    ? null
    : it?.powerW !== undefined
      ? 'statedPowerFirst'
      : !motion.power.verified
        ? 'powerNotVerified'
        : motion.power.coverage < minCover
          ? 'powerCoverageLow'
          : 'pass';
  // (0.6.3 FX5) Gauge GPS speed is the energy model's `gps` (moving speed); outdoor cycling never reads speed (V2.4(3))
  const hcSpeed =
    speedGate === 'pass' && motion.speed?.kmh != null
      ? {
          kmh: motion.speed.kmh,
          gradeFrac: motion.speed.gradeFrac,
          source: motion.speed.source === 'gaugeGps' ? ('gps' as const) : ('hc' as const),
        }
      : null;
  const hcPower = powerGate === 'pass' && motion.power ? { avgW: motion.power.avgW, verified: true } : null;
  const e = activityEnergy({
    exerciseId: r.exerciseId,
    durationMin,
    massKg: r.person.massKg,
    ageY: r.person.ageY,
    sex: r.person.sex,
    rmrKcalPerDay: r.person.rmrKcalPerDay,
    d2Keytel: r.keytelEnabled,
    ...(r.kcalOverride !== undefined && r.kcalOverride !== null && Number.isFinite(r.kcalOverride)
      ? { reported: { grossKcal: r.kcalOverride, provenance: 'machine display, typed by the person' } }
      : {}),
    ...(it?.powerW !== undefined
      ? { power: { avgW: it.powerW, verified: false } }
      : hcPower
        ? { power: hcPower }
        : {}),
    ...(it?.speedKmh !== undefined
      ? {
          speed: {
            kmh: it.speedKmh,
            gradeFrac: it.gradePct !== undefined ? it.gradePct / 100 : null,
            source: 'belt' as const,
          },
        }
      : hcSpeed
        ? { speed: hcSpeed }
        : {}),
    ...(segments.length > 0
      ? { hr: { segments, window: r.window, ...(r.pauses ? { pauses: r.pauses } : {}) } }
      : {}),
    ...(it?.avgHr !== undefined && segments.length === 0 ? { manualAvgHr: it.avgHr } : {}),
    ...(it
      ? {
          intensity: {
            ...(it.class ? { class: it.class } : {}),
            ...(it.talkTest ? { talkTest: it.talkTest } : {}),
            ...(it.rpe !== undefined ? { rating: it.rpe, ratingScale: it.rpeScale ?? 'unknown' } : {}),
          },
        }
      : {}),
    ...(r.vendor ? { vendor: r.vendor } : {}),
    ...(r.inputsRef ? { inputsRef: r.inputsRef } : {}),
  });
  return compactEstimate(
    e,
    durationMin,
    r.person.massKg,
    boutPoints(r, e, m),
    segments.length > 0 ? source : null,
    motionEvidence(e, motion, speedGate, powerGate),
  );
}

/** (r063 S16/A19) Whether the booked estimate used the window's Health Connect speed and power, and why not otherwise. */
function motionEvidence(
  e: ActivityEnergy,
  motion: WindowMotion,
  speedGate: string | null,
  powerGate: string | null,
): EstimateEvidence | null {
  if (!motion.speed && !motion.power) return null;
  const why = (
    estimator: 'speedGrade' | 'power',
    gate: string | null,
  ): { used: boolean; reason?: string } => {
    if (gate !== 'pass') return { used: false, ...(gate ? { reason: gate } : {}) };
    if (e.booked.estimator === estimator) return { used: true };
    const rejected = e.rejected.find((x) => x.estimator === estimator);
    // a type without the speed estimator (outdoor cycling, SPEC V2.4(3)) never reads speed
    const reason =
      rejected?.reason ??
      (estimator === 'speedGrade' && !e.traits.estimators.includes('speedGrade')
        ? 'speedNotEligibleForType'
        : 'anotherEstimatorFirst');
    return { used: false, reason };
  };
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  const out: EstimateEvidence = {};
  if (motion.speed) {
    const s = motion.speed;
    out.speed = {
      source: s.source,
      kmh: s.kmh === null ? null : round(s.kmh, 2),
      gradePct: s.gradeFrac === null ? null : round(s.gradeFrac * 100, 1),
      coverage: round(s.coverage, 3),
      ...why('speedGrade', speedGate),
    };
  }
  if (motion.power) {
    const p = motion.power;
    out.power = {
      source: 'healthConnect',
      avgW: round(p.avgW, 1),
      verified: p.verified,
      coverage: round(p.coverage, 3),
      ...why('power', powerGate),
    };
  }
  return out;
}

/** A minute's HR from the timeline's minute mean (null when unsupported). */
function minuteMeanHr(m: WindowMinutes | null, k: number): PointsMinute['hr'] {
  const bpm = m ? m.hr?.bpm[k] : null;
  const sup = m ? m.hr?.supportedS[k] : null;
  return bpm !== null && bpm !== undefined && sup !== null && sup !== undefined && sup > 0
    ? { bpm, supportedS: sup }
    : null;
}

/** A minute's HR from the exact segments inside `[start, end)` without pauses: its parts, mean and supported seconds. */
function exactMinuteHr(
  exact: readonly HrSegment[],
  w: Interval,
  pauses: readonly Interval[],
): PointsMinute['hr'] {
  const segs = clipSegments(
    exact.filter((g) => g.end > w.start && g.start < w.end),
    w,
    pauses,
  );
  let ms = 0;
  let sum = 0;
  const parts = segs.map((g) => {
    const d = g.end - g.start;
    ms += d;
    sum += d * g.bpm;
    return { bpm: g.bpm, seconds: d / 1000 };
  });
  return ms > 0 ? { bpm: sum / ms, supportedS: ms / 1000, parts } : null;
}

/** Heart Points of the bout's minutes as an approved activity (equivalent MET channel when no supported HR). */
function boutPoints(r: EstimateRequest, e: ActivityEnergy, m: WindowMinutes | null): number | null {
  const met = e.engineDose?.met ?? null;
  const ex = exerciseRecordOf(r.exerciseId);
  const gait = ex?.cardioModality === 'walk' ? 'walk' : ex?.cardioModality === 'run' ? 'run' : null;
  const minutes: PointsMinute[] = [];
  for (let t = r.window.start; t < r.window.end; t += 60_000) {
    // (Codex #12) the minute's eligible seconds: clipped to the bout's end and without its pauses
    const end = Math.min(t + 60_000, r.window.end);
    // (r063 S11) the shared rule of the day's points
    const seconds = boutSecondsIn(t, r.window, r.pauses);
    if (!(seconds > 0)) continue;
    const k = m ? Math.floor((t - m.first) / 60_000) : -1;
    const inGrid = m !== null && k >= 0 && k < m.steps.length;
    // (Codex #11) exact readings: each supported sub-interval of the minute rated on its own bpm (pauses left out)
    const hr = m?.hrExact
      ? exactMinuteHr(m.hrExact, { start: t, end }, r.pauses ?? [])
      : minuteMeanHr(inGrid ? m : null, k);
    minutes.push({
      start: t,
      seconds,
      asleep: inGrid ? m.asleep?.[k] === true : false,
      activity: { met, gait },
      cadence: inGrid ? (m.steps[k] ?? null) : null,
      ...(hr ? { hr } : {}),
    });
  }
  if (minutes.length === 0) return null;
  const p = heartPoints({ ageY: r.person.ageY, minutes });
  return Number.isFinite(p.points) ? p.points : null;
}
