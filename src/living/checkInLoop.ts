/**
 * The living loop's check-in coordination (D5-06; C1, C2, C4, C5, C7). Pure decisions over the plan documents; the command
 * layer writes what they return.
 *
 *  - Due rule: the check-in weekday from day 7 on, with a defined late-open catch-up: a scheduled check-in that was not
 *    confirmed stays due on later days, and its decision point is the CURRENT date (catch-up never fabricates a backdated
 *    check-in). The weekly cadence is control policy, not a biological constant.
 *  - Evidence key: the decision point, the observation (revision) ids the decision would consume, the realised-history hash,
 *    the adopted plan version, and the coordinator/evidence/estimator/engine/contract versions. Automatic refresh may store a
 *    derived preview under this key (once per key); only an explicit Check in (or a separately stored opt-in policy)
 *    confirms it, exactly once per plan and decision point. Closing or cancelling confirms nothing.
 *  - A disturbance (illness, travel, a diet break, a symptom, a long fast, a weigh-in gap, a new training block) makes the
 *    check-in a Review: it widens the weigh-in noise and is reported, it never forces a tissue re-anchor.
 *  - Eligibility: a new safety event (a logged symptom, changed screening answers) re-checks the CURRENT prescription at
 *    once with the lifecycle gate (no planner mathematics here), without waiting for a weigh-in or a lock window.
 *  - The energy nudge stays disabled by default; its 10 % / 1–3-day cap is an engineering bound, never escalated.
 *
 * Stored decisions live beside the confirmed-state records in `anchors` (`${planId}:${date}`): a record carries its
 * `decision`; a confirmation that anchored nothing is a decision-only document. Legacy records without a decision stay
 * imported history (never relabelled as automatic decisions).
 */
import type { PersonProfile, Schedule } from '@/engine';
import { ENGINE_VERSION } from '@/engine/core/defaults';
import { ASSIMILATION_DEFAULTS, type AssimilationParams } from '@/engine/assimilation';
import { CONTRACT_FINGERPRINT, CONTRACT_VERSIONS, contentHash, stampDerived, type LifecycleBoundary, type SafetyStatus } from '@/lib/bodyContracts';
import { blockStartsOf, compositionObservations, compositionReadingsFor, estimatorIdentity, intakeEvidenceOf, measurementSample, weeklyCheckIn, weighInIds, weighInsFor, type WeeklyCheckInOutput } from './assimilate';
import type { LoggedDayResult } from './loggedDay';
import { FIRST_CHECK_IN_DAY, planDay, scheduledCheckInDate } from './calendar';
import { addDays, compareDates, daysBetween } from './dates';
import { currentProfileSafety, lifecycleSafetyGate, symptomsFromEntries, type LifecycleSafetyResult } from './lifecycleSafety';
import { projectEntries } from './logs';
import type { LivingDocs, LivingProjection } from './projection';
import { NUDGE_MAX_DAYS, NUDGE_MAX_FRAC } from './replan';
import type { Actor, CheckInDecisionRecord, ConfirmedStateRecord, DerivedAnchorRecord, Instant, LocalDate, LogEntry, MeasurementEntry, PlanDoc, PlanVersionDoc } from './types';

// ------------------------------------------------------------------------------------------- versions and policy
/** Semantics of the coordinator (due rule, keys, preview/confirm split); part of every decision key (C7). */
export const COORDINATOR_VERSION = 2;
/** Semantics of the evidence a decision consumes (weigh-ins of the bias window, composition readings, waist). */
export const CHECKIN_EVIDENCE_VERSION = 2;

/** Check-in cadence: control policy (weekly, first after 7 days), not a biological constant. */
export const CHECK_IN_POLICY = { cadenceDays: 7, firstAfterDays: FIRST_CHECK_IN_DAY, basis: 'controlPolicy' } as const;

/**
 * The energy nudge (spread a logged overshoot over the next 1–3 days, at most 10 % of one day's target): disabled by default
 * and an explicit opt-in experiment only. The cap is an engineering bound, not evidence that repaying a deviation helps;
 * nothing escalates it from retry or event counts.
 */
export const ENERGY_NUDGE_POLICY = { enabled: false, maxFrac: NUDGE_MAX_FRAC, maxDays: NUDGE_MAX_DAYS, basis: 'engineeringBound', escalation: 'none' } as const;

/** Actor id of a confirmation made under the person's stored opt-in policy (never the default refresh). */
export const CHECK_IN_OPT_IN_ACTOR = 'checkInOptIn';

/** Inline status words of the loop (C6: short words; details in the info sheet). */
export const CHECK_IN_STATUS = { ready: 'Check-in ready', updated: 'Estimate updated', change: 'Change ready', changed: 'Plan changed', review: 'Review' } as const;

// ------------------------------------------------------------------------------------------- due rule
export interface CheckInDue {
  due: boolean;
  /** The scheduled date the due check-in belongs to. */
  scheduled: LocalDate | null;
  /** Opened after its scheduled day (catch-up); the decision is still made for the current date. */
  late: boolean;
  /** The decision point: always the current date (never backdated). */
  decisionPoint: LocalDate;
}

/**
 * Whether a check-in is due on `today`: the plan is active and the latest scheduled check-in has no confirmed decision on or
 * after it (`lastConfirmed`). A late open catches up once, on the current date.
 */
export function checkInDueAt(
  plan: Pick<PlanDoc, 'startDate' | 'policy' | 'status'>,
  today: LocalDate,
  lastConfirmed: LocalDate | null,
): CheckInDue {
  const effectiveStatus =
    plan.status === 'scheduled' && compareDates(today, plan.startDate) >= 0 ? 'active' : plan.status;
  const scheduled = effectiveStatus === 'active' ? scheduledCheckInDate(plan, today) : null;
  const due = scheduled !== null && (lastConfirmed === null || compareDates(lastConfirmed, scheduled) < 0);
  return {
    due,
    scheduled,
    late: due && scheduled !== null && compareDates(scheduled, today) < 0,
    decisionPoint: today,
  };
}

// ------------------------------------------------------------------------------------------- stored decisions
/** Why a check-in is a Review rather than a routine update (never a forced tissue anchor). */
export interface CheckInReview {
  status: 'none' | 'review';
  reasons: Array<{
    code:
      | 'illness'
      | 'travel'
      | 'dietBreak'
      | 'creatineStart'
      | 'symptom'
      | 'longFastEnd'
      | 'weighInGap'
      | 'newBlock'
      | 'compositionScan'
      | 'engineVersion'
      | 'eligibility'
      | 'wellbeing'
      | 'repeatedCalendarEaBelowReference';
    date?: LocalDate;
  }>;
  /** Always 'none': a disturbance changes uncertainty and asks for review; it does not move the tissue anchor (D5-06). */
  anchor: 'none';
}

/** A stored check-in decision with its key and the versions it was made under (C7). */
export type StoredCheckInDecision = CheckInDecisionRecord & {
  key: string;
  coordinatorVersion: number;
  evidenceVersion: number;
  adoptedVersion: number;
  /** 'explicit' = the person's Check in; 'optIn' = their separately stored automatic-confirmation policy. */
  mode?: 'explicit' | 'optIn';
  /** Whether the decision produced a confirmed-state record (an anchor) or only recorded the check-in. */
  anchored?: boolean;
  review?: CheckInReview;
};

/** A confirmation that anchored nothing (too few weigh-ins): the check-in is still recorded once. */
export interface CheckInDecisionDoc {
  kind: 'checkInDecision';
  planId: string;
  anchorDate: LocalDate;
  decision: StoredCheckInDecision;
}

export type AnchorDoc = (ConfirmedStateRecord & { decision?: StoredCheckInDecision }) | CheckInDecisionDoc;

const isRecord = (d: unknown): d is ConfirmedStateRecord => !!d && typeof d === 'object' && 'residualSplit' in d && (d as { residualSplit?: unknown }).residualSplit !== undefined;

/** Split the `anchors` documents of a plan into confirmed-state records and stored decisions (read adapter, C7). */
export function splitAnchorDocs(docs: readonly unknown[]): {
  records: ConfirmedStateRecord[];
  decisions: StoredCheckInDecision[];
} {
  const records: ConfirmedStateRecord[] = [];
  const decisions: StoredCheckInDecision[] = [];
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    if (isRecord(d)) records.push(d);
    const dec = (d as { decision?: StoredCheckInDecision }).decision;
    if (dec && typeof dec === 'object' && typeof dec.decisionPoint === 'string') decisions.push(dec);
  }
  return { records, decisions };
}

/** The latest confirmed check-in date: a record's anchor date or a confirmed decision's point. */
export function lastConfirmedCheckIn(records: readonly Pick<ConfirmedStateRecord, 'anchorDate'>[], decisions: readonly Pick<CheckInDecisionRecord, 'decisionPoint' | 'status'>[] = []): LocalDate | null {
  let last: LocalDate | null = null;
  for (const r of records) if (last === null || compareDates(r.anchorDate, last) > 0) last = r.anchorDate;
  for (const d of decisions) if (d.status === 'confirmed' && (last === null || compareDates(d.decisionPoint, last) > 0)) last = d.decisionPoint;
  return last;
}

/** The stored decision (or legacy record) of one plan and decision point, if any: a retry finds it and changes nothing. */
export function storedDecisionOn(planId: string, date: LocalDate, records: readonly ConfirmedStateRecord[], decisions: readonly StoredCheckInDecision[]): { decision: StoredCheckInDecision | null; record: ConfirmedStateRecord | null } | null {
  const decision = decisions.find((d) => d.planId === planId && d.decisionPoint === date && d.status === 'confirmed') ?? null;
  const record = records.find((r) => r.planId === planId && r.anchorDate === date) ?? null;
  return decision || record ? { decision, record } : null;
}

// ------------------------------------------------------------------------------------------- evidence and keys
export interface CheckInEvidence {
  planId: string;
  decisionPoint: LocalDate;
  /** Observation (revision) ids the decision would consume: weigh-ins of the bias window, composition readings, waist. */
  evidenceIds: string[];
  historyHash: string;
  adoptedVersion: number;
  versions: {
    coordinator: number;
    evidence: number;
    estimator: string;
    engine: string;
    contracts: string;
    realisedHistory: number;
    measurementOperator: number;
  };
  /** Content key of everything above (the preview identity; the same key is processed once). */
  key: string;
  /** The preview id a Check in names (`plan.checkIn` previewId). */
  previewId: string;
}

/** The evidence and key of a check-in decision at `today` (see the module comment). */
export function checkInEvidenceOf(i: {
  plan: Pick<PlanDoc, 'startDate'> & { id: string };
  head: Pick<PlanVersionDoc, 'version'>;
  measurements: readonly MeasurementEntry[];
  today: LocalDate;
  historyHash: string | null;
  params?: AssimilationParams;
  /** Canonical effective estimate/review inputs, distinct from immutable history identity. */
  decisionInputs?: CheckInDecisionInputs;
}): CheckInEvidence {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const day = planDay(i.plan, i.today);
  const weigh = weighInIds(i.plan, i.measurements, day - prm.biasWindowDays, day);
  const comp = compositionObservations(i.plan, i.measurements)
    .filter((o) => o.day >= 0 && o.day <= day)
    .map((o) => (o.revision !== undefined ? `${o.observationId}@${o.revision}` : o.observationId));
  // waist readings are placed by their own occurrence instant, as composition readings are (A1-018, `measurementSample`)
  const waist = projectEntries(i.measurements)
    .filter((m) => {
      if (m.metric !== 'waistCm' || m.assumed || !Number.isFinite(m.value)) return false;
      const d = measurementSample(i.plan, m).day;
      return d >= 0 && d <= day;
    })
    .map((m) => (m.revision !== undefined ? `${m.id}@${m.revision}` : m.id));
  const evidenceIds = [...new Set([...weigh, ...comp, ...waist])].sort();
  const est = estimatorIdentity(prm);
  const versions = {
    coordinator: COORDINATOR_VERSION,
    evidence: CHECKIN_EVIDENCE_VERSION,
    estimator: `${est.strategy}@${est.version}:${est.paramsHash}`,
    engine: ENGINE_VERSION,
    contracts: CONTRACT_FINGERPRINT,
    realisedHistory: CONTRACT_VERSIONS.realisedHistory,
    measurementOperator: CONTRACT_VERSIONS.measurementOperator,
  };
  const historyHash = i.historyHash ?? '';
  const key = contentHash({
    planId: i.plan.id,
    decisionPoint: i.today,
    evidenceIds,
    historyHash,
    adoptedVersion: i.head.version,
    versions,
    decisionInputs: i.decisionInputs ?? null,
  });
  return {
    planId: i.plan.id,
    decisionPoint: i.today,
    evidenceIds,
    historyHash,
    adoptedVersion: i.head.version,
    versions,
    key,
    previewId: `ci-${key}`,
  };
}

/** Versioned dependencies consumed by the fixed-prior estimate and pending review. */
export interface CheckInDecisionInputs {
  version: 2;
  measurements: unknown[];
  eventsAndSleep: unknown[];
  priorRecords: unknown[];
  derivedAnchors: unknown[];
  schedule: unknown;
  reviewPolicy: unknown;
}

/** Stable ordering makes sync/permutation/retry the same decision, without ignoring payload corrections. */
const canonicalRows = (rows: readonly unknown[]): unknown[] =>
  [...rows].sort((a, b) => contentHash(a).localeCompare(contentHash(b)));

/** One preparation shared by report, refresh, cache acceptance and authoritative confirmation. */
export function pendingCheckInOf(i: {
  docs: LivingDocs;
  projection: LivingProjection;
  today: LocalDate;
}): { evidence: CheckInEvidence; review: CheckInReview } | null {
  const { docs, projection: p, today } = i;
  const plan = docs.plan;
  const head = p.head;
  if (!plan || !head) return null;
  const entries = projectEntries(docs.entries);
  const measurements = projectEntries(docs.measurements);
  const latest =
    [...docs.records]
      .filter((r) => r.anchorDate <= today)
      .sort((a, b) => a.anchorDay - b.anchorDay)
      .pop() ?? null;
  const review = checkInReview({
    plan,
    today,
    since: lastConfirmedCheckIn(docs.records, docs.decisions ?? []),
    entries,
    measurements,
    blockStarts: blockStartsOf(head.schedule),
    longFastEnded: p.fastEvents.some(
      (f) =>
        f.durationH >= 48 &&
        Math.floor((f.startDay * 24 + f.startH + f.durationH) / 24) >= planDay(plan, today) - 1,
    ),
    lastRecordEngine: latest?.engine ?? null,
  });
  const extra = (code: CheckInReview['reasons'][number]['code']) => {
    if (!review.reasons.some((r) => r.code === code)) review.reasons.push({ code });
  };
  if (p.eligibility?.blocked || p.eligibility?.safetyChanged) extra('eligibility');
  if (p.wellbeing.status === 'review') extra('wellbeing');
  if (p.energyExposure?.review.needed) extra('repeatedCalendarEaBelowReference');
  review.status = review.reasons.length ? 'review' : 'none';
  const decisionInputs: CheckInDecisionInputs = {
    version: 2,
    measurements: canonicalRows(
      measurements.filter(
        (m) => !m.assumed && m.date <= today && ['weightKg', 'bodyFatPct', 'waistCm'].includes(m.metric),
      ),
    ),
    eventsAndSleep: canonicalRows(
      entries.filter((e) => !e.assumed && e.date <= today && (e.kind === 'event' || e.kind === 'sleep')),
    ),
    priorRecords: canonicalRows(
      docs.records
        .filter((r) => r.anchorDate <= today)
        .map(({ decision: _decision, ...r }: ConfirmedStateRecord & { decision?: unknown }) => {
          void _decision;
          return r;
        }),
    ),
    derivedAnchors: canonicalRows((docs.derivedAnchors ?? []).filter((r) => r.anchorDate <= today)),
    schedule: {
      plan: { startDate: plan.startDate, policy: plan.policy, status: plan.status, request: plan.request },
      head: {
        version: head.version,
        schedule: head.schedule,
        provenance: head.provenance,
        contracts: head.contracts,
      },
    },
    reviewPolicy: {
      review,
      eligibility: p.eligibility,
      wellbeing: p.wellbeing,
      energyExposure: p.energyExposure,
    },
  };
  return {
    evidence: checkInEvidenceOf({
      plan,
      head,
      measurements,
      today,
      historyHash: p.history?.contentHash ?? null,
      decisionInputs,
    }),
    review,
  };
}

/** The decision id of a plan's check-in on a date (one per plan and decision point; the anchors document id). */
export const checkInDecisionId = (planId: string, date: LocalDate): string => `${planId}:${date}`;

/** A preview decision (derived; never authoritative, never consumed as evidence). */
export function previewDecision(ev: CheckInEvidence, computedAt?: Instant): StoredCheckInDecision {
  return {
    id: checkInDecisionId(ev.planId, ev.decisionPoint),
    planId: ev.planId,
    decisionPoint: ev.decisionPoint,
    evidenceIds: ev.evidenceIds,
    historyHash: ev.historyHash,
    stamp: stampDerived({
      versions: { realisedHistory: ev.versions.realisedHistory, measurementOperator: ev.versions.measurementOperator, estimator: CONTRACT_VERSIONS.estimator, observation: CONTRACT_VERSIONS.observation },
      engineVersion: ev.versions.engine,
      inputsHash: ev.key,
      ...(computedAt ? { computedAt } : {}),
      origin: 'original',
    }),
    status: 'preview',
    key: ev.key,
    coordinatorVersion: COORDINATOR_VERSION,
    evidenceVersion: CHECKIN_EVIDENCE_VERSION,
    adoptedVersion: ev.adoptedVersion,
  };
}

/** Confirm a preview exactly once (the caller writes it in the same change as its record and proposal). */
export function confirmDecision(
  preview: StoredCheckInDecision,
  i: {
    actor: Actor;
    now: Instant;
    mode: 'explicit' | 'optIn';
    anchored: boolean;
    review: CheckInReview;
    proposalVersion?: number;
  },
): StoredCheckInDecision {
  return {
    ...preview,
    status: 'confirmed',
    confirmedAt: i.now,
    confirmedBy: i.actor,
    mode: i.mode,
    anchored: i.anchored,
    review: i.review,
    ...(i.proposalVersion !== undefined ? { proposalVersion: i.proposalVersion } : {}),
  };
}

// ------------------------------------------------------------------------------------------- the estimate
/**
 * The weekly fixed-prior estimate of a decision point (pure; the preview and the confirmation run the same function): the
 * realised schedule's replay with the plan's weigh-ins (event noise included), the exposure-gated intake days, the window's
 * intake evidence, composition readings at their own time (each revision once), the weigh-in revisions consumed, the
 * decision id and the history hash. No `hard` request: a disturbance is a review, never a forced tissue anchor.
 */
export function checkInEstimate(i: {
  plan: PlanDoc & { id: string };
  head: Pick<PlanVersionDoc, 'schedule'>;
  records: readonly ConfirmedStateRecord[];
  measurements: readonly MeasurementEntry[];
  entries: readonly LogEntry[];
  /** The realised schedule (`projectionSchedule`) and the elapsed days of the same projection. */
  schedule: Schedule;
  past: ReadonlyArray<{
    planDay: number;
    result: Pick<LoggedDayResult, 'coverage' | 'calibrationEligible' | 'amountMethods' | 'uncertaintyGroups'>;
  }>;
  today: LocalDate;
  historyHash: string | null;
  params?: AssimilationParams;
  /** (A1-017) Recomputed current-state anchors kept in `derived` (reused while their lineage holds; never decisions). */
  derived?: readonly DerivedAnchorRecord[];
}): WeeklyCheckInOutput {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const day = planDay(i.plan, i.today);
  const composition = compositionReadingsFor(i.plan, i.measurements);
  return weeklyCheckIn({
    plan: i.plan,
    schedule: i.schedule,
    records: i.records,
    today: i.today,
    weighIns: weighInsFor(i.plan, i.measurements, i.entries, blockStartsOf(i.head.schedule), prm),
    // the balance estimate's exposure gate: complete quantitative or confirmed-zero days only (C1/D5-01)
    intakeDays: i.past.filter((d) => d.result.calibrationEligible).map((d) => d.planDay),
    intakeEvidence: intakeEvidenceOf(i.past),
    ...(composition ? { composition } : {}),
    observationIds: weighInIds(i.plan, i.measurements, day - prm.biasWindowDays, day),
    decisionId: checkInDecisionId(i.plan.id, i.today),
    ...(i.historyHash ? { historyHash: i.historyHash } : {}),
    ...(i.params ? { params: i.params } : {}),
    ...(i.derived?.length ? { derived: i.derived } : {}),
  });
}

/** A compact summary of an estimate for a derived preview (numbers with their status; nothing here is authoritative). */
export function estimateSummary(e: WeeklyCheckInOutput): {
  verdict: string;
  trendKg: number | null;
  trendSdKg: number | null;
  correctionKcal: number | null;
  correctionSdKcal: number | null;
  updated: boolean;
  anchored: boolean;
} {
  const t = e.output.trend;
  return {
    verdict: e.output.verdict,
    trendKg: t && Number.isFinite(t.w) ? t.w : null,
    trendSdKg: t && Number.isFinite(t.wSd) ? t.wSd : null,
    correctionKcal: e.record ? e.record.energyBiasKcal.mean : null,
    correctionSdKcal: e.record ? e.record.energyBiasKcal.sd : null,
    updated: e.output.bias.updated,
    anchored: e.record !== null,
  };
}

// ------------------------------------------------------------------------------------------- disturbance review
const REVIEW_EVENTS: ReadonlySet<string> = new Set(['illness', 'travel', 'dietBreak', 'creatineStart']);

/**
 * Disturbances since the last confirmed check-in (exclusive) through `today`: declared events, reported symptoms, a fast of
 * at least 48 h that ended, a weigh-in gap of 14 days or more, a new training block, a body-composition scan, or a changed
 * engine. Each asks for review; none forces a tissue anchor (D5-06).
 */
export function checkInReview(i: {
  plan: Pick<PlanDoc, 'startDate'>;
  today: LocalDate;
  since: LocalDate | null;
  entries: readonly LogEntry[];
  measurements: readonly MeasurementEntry[];
  blockStarts: readonly number[];
  longFastEnded?: boolean;
  lastRecordEngine?: { engineVersion: string } | null;
}): CheckInReview {
  const from = i.since ?? addDays(i.plan.startDate, -1);
  const inWindow = (date: LocalDate): boolean =>
    compareDates(date, from) > 0 && compareDates(date, i.today) <= 0;
  const reasons: CheckInReview['reasons'] = [];
  const seen = new Set<string>();
  const add = (code: CheckInReview['reasons'][number]['code'], date?: LocalDate): void => {
    const k = `${code}|${date ?? ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    reasons.push({ code, ...(date ? { date } : {}) });
  };
  for (const e of projectEntries(i.entries)) {
    if (e.assumed || e.kind !== 'event') continue;
    const end = e.to ?? e.date;
    if (
      REVIEW_EVENTS.has(e.event) &&
      (inWindow(e.date) ||
        inWindow(end) ||
        (compareDates(e.date, from) <= 0 && compareDates(end, i.today) >= 0))
    )
      add(e.event as 'illness' | 'travel' | 'dietBreak' | 'creatineStart', e.date);
  }
  const symptoms = new Map<string, ReturnType<typeof symptomsFromEntries>[number]>();
  for (const s of symptomsFromEntries(projectEntries(i.entries)))
    if (!s.occurredOn || s.occurredOn <= i.today) symptoms.set(s.category, s);
  for (const s of symptoms.values())
    if (s.status !== 'resolved' && s.occurredOn && inWindow(s.occurredOn)) add('symptom', s.occurredOn);
  if (i.longFastEnded) add('longFastEnd');
  const weighDates = projectEntries(i.measurements)
    .filter((m) => m.metric === 'weightKg' && !m.assumed)
    .map((m) => m.date)
    .sort();
  const lastToday = weighDates.filter((d) => compareDates(d, i.today) <= 0);
  const latest = lastToday[lastToday.length - 1];
  const before = lastToday.filter((d) => compareDates(d, latest ?? i.today) < 0).pop();
  if (latest && before && inWindow(latest) && daysBetween(before, latest) >= 14) add('weighInGap', latest);
  for (const b of i.blockStarts) {
    const date = addDays(i.plan.startDate, b);
    if (b > 0 && inWindow(date)) add('newBlock', date);
  }
  for (const m of projectEntries(i.measurements))
    if (m.metric === 'bodyFatPct' && m.method === 'dxa' && !m.assumed && inWindow(m.date))
      add('compositionScan', m.date);
  if (i.lastRecordEngine && i.lastRecordEngine.engineVersion !== ENGINE_VERSION) add('engineVersion');
  return { status: reasons.length > 0 ? 'review' : 'none', reasons, anchor: 'none' };
}

// ------------------------------------------------------------------------------------------- eligibility (C5)
export interface PrescriptionEligibility {
  boundary: LifecycleBoundary;
  /** Status of the current prescription now: blocked statuses come from the lifecycle gate; a changed screening is at most Unchecked. */
  status: SafetyStatus;
  blocked: boolean;
  /** The screening answers differ from those the plan was made under: the stored certification no longer applies. */
  safetyChanged: boolean;
  reasons: LifecycleSafetyResult['reasons'];
  /** Content key of what was checked (the same key is evaluated once). */
  key: string;
}

type ProfileSafety = NonNullable<PersonProfile['safety']>;

/** The safety answers without the reported symptoms (symptoms are compared by the gate itself, latest per category). */
function screeningOf(s: ProfileSafety | undefined): unknown {
  const { symptoms: _symptoms, fastingOptIn = 'none', ...flags } = s?.flags ?? {};
  void _symptoms;
  return { ...(s ?? { mode: 'M0' }), flags: { ...flags, fastingOptIn } };
}

/**
 * Eligibility of the current prescription from today (C5/D5-06): the lifecycle gate over the head schedule with the CURRENT
 * safety (the screening now when known, the plan's stored facts it does not express, the logged symptoms). Runs on every
 * new event, without waiting for a weigh-in or the lock window. A changed screening invalidates the stored certification
 * (status at most Unchecked); a block comes only from the gate (no generic medical "yes" switches all exercise off).
 */
export function prescriptionEligibility(i: {
  plan: Pick<PlanDoc, 'startDate' | 'baselineProfile' | 'request'>;
  head: Pick<PlanVersionDoc, 'schedule' | 'certificate' | 'version'>;
  today: LocalDate;
  entries: readonly LogEntry[];
  /** The person's CURRENT profile safety (screening now); undefined = not known here (the stored one stands). */
  currentSafety?: ProfileSafety;
}): PrescriptionEligibility {
  const stored = i.plan.request.profile.safety ?? i.plan.baselineProfile.safety;
  const entries = projectEntries(i.entries);
  const safety = currentProfileSafety(stored, i.currentSafety, entries);
  const safetyChanged = i.currentSafety !== undefined && contentHash(screeningOf(i.currentSafety)) !== contentHash(screeningOf(stored));
  const profile: PersonProfile = { ...i.plan.baselineProfile, ...(safety ? { safety } : {}) };
  const symptoms = symptomsFromEntries(entries);
  const boundary: LifecycleBoundary = safetyChanged ? 'safetyChange' : 'symptomChange';
  const fromDay = Math.max(0, planDay(i.plan, i.today));
  const gate = lifecycleSafetyGate({ boundary, schedule: i.head.schedule, fromDay, profile, entries, certificate: i.head.certificate ?? null, revalidation: null, today: i.today });
  // no planner revalidation runs here (eligibility is not activation, A1-001): its absence alone never blocks the current
  // prescription; a failed audit, a certificate violation/conflict or the symptom/exercise gate still does
  const blocked = gate.blocked && gate.reasons.some((r) => r.code !== 'revalidationUnavailable');
  const status: SafetyStatus = blocked ? gate.status : 'unchecked';
  const key = contentHash({ v: COORDINATOR_VERSION, head: i.head.version, fromDay, screening: screeningOf(safety), symptoms: symptoms.map((s) => [s.id, s.category, s.status]), contracts: CONTRACT_FINGERPRINT });
  return { boundary, status, blocked, safetyChanged, reasons: gate.reasons, key };
}

/**
 * Whether an opted-in energy nudge may run (never by default): it is suppressed in a risk context — an unresolved symptom,
 * a concern the person flagged, a Review on energy availability, or a safety review of the prescription.
 */
export function nudgeAllowed(i: { optedIn: boolean; riskContext: boolean }): boolean {
  return ENERGY_NUDGE_POLICY.enabled ? !i.riskContext : i.optedIn && !i.riskContext;
}
