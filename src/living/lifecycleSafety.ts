/**
 * Safety at the living plan's lifecycle boundaries (C5; D4-01, D4-02, D4-03): start, scenario start, adopt, resume and
 * re-plan read the CURRENT safety state afresh. A stored proposal, a worker result or a boolean check never authorizes.
 *
 * This module only coordinates: the constraint evaluation, the exercise gate with its clinician envelopes and the
 * certificate fingerprint are the planner's (`revalidatePlanSafety`, reached through `LifecycleRevalidate`, installed by the
 * command wiring). What it decides on its own is what needs no planner mathematics:
 *  - symptoms the person logged join the profile's reported symptoms (latest report per category wins), so every re-plan
 *    and revalidation sees them;
 *  - a failed audit, a known violation or a limit conflict on the stored certificate blocks the prescription;
 *  - (A1-001) activation needs the planner's authoritative, scope-aware `startable` decision for exactly this subject: an
 *    Unchecked status (a mandatory bound without a resolved channel, a missing or stale certificate, a required audit not
 *    run) is never permission, and an absent or failed revalidation never authorizes. The refusal names what is missing
 *    (Unchecked / Review) and the concrete next step (a fresh declared audit or a review); logging, monitoring, inspection
 *    and simulation never depend on it;
 *  - the shared exercise symptom gate still explains a refusal when no revalidation could run: an unresolved concerning
 *    exertional symptom with exercise sessions or a step target above the documented baseline (no baseline: any numeric
 *    step target). Usual ("training as usual") sessions are the person's own routine, not autonomous progression;
 *  - the status is 'verified' only when the revalidation says so and is startable; otherwise at most 'unchecked'.
 * No clinical numeric cutoff is introduced here.
 */
import type { PersonProfile, Schedule } from '@/engine';
import type { PlannerRequestV2 } from '@/engine/planner';
import type { ReplanRequest } from '@/engine/planner/domain/replanTypes';
import type { ExperimentalTrackingReview } from '@/lib/experimentalTracking';
import { isConcerningUnresolved, type LifecycleBoundary, type SafetyCertificate, type SafetyStatus, type SymptomReport } from '@/lib/bodyContracts';
import { exerciseSymptomGate } from '@/lib/safetyPolicy';
import { addDays } from './dates';
import { templateOfDay } from './prescription';
import type { Instant, LocalDate, LogEntry, LoggedSymptom } from './types';

/** What a planner revalidation reports for a stored prescription at a boundary. */
export interface LifecycleRevalidation {
  status: SafetyStatus;
  /**
   * (A1-001) The planner's authoritative, scope-aware decision (`revalidatePlanSafety(...).startable`): true only when every
   * applicable mandatory check of this exact subject passed and a current verified certificate binds it. Absent on a
   * legacy port: only `status: 'verified'` with `certificateValid: true` counts as startable (never an Unchecked label).
   */
  startable?: boolean;
  /** Why not startable (`LifecycleSafety.reasonCode`: 'certificateRequired', 'unchecked', 'review', …). */
  reasonCode?: string | null;
  /** The stored certificate matches the fingerprint recomputed now and is verified. */
  certificateValid?: boolean;
  reasons?: readonly string[];
  experimentalTracking?: ExperimentalTrackingReview;
}

/** The authoritative startability of a revalidation (A1-001): the planner's decision, never inferred from an Unchecked label. */
export function revalidationStartable(r: LifecycleRevalidation | null | undefined): boolean {
  if (!r) return false;
  if (r.startable !== undefined) return r.startable === true && r.status === 'verified';
  return r.status === 'verified' && r.certificateValid === true;
}

/**
 * Where a stored prescription is judged from (C5): a re-plan's certificate covers the plan from the day it was made
 * (`replanSafetySubject`: the schedule from `date`, the request moved to that start, the elapsed days placing it in the
 * plan's weeks). Absent: the whole schedule from its own start (a start certificate).
 */
export interface LifecycleSubject {
  planStart: LocalDate;
  date: LocalDate;
}

/** The planner's revalidation, injected (null when it cannot run: the gate then refuses activation, A1-001). */
export type LifecycleRevalidate = (i: {
  boundary: LifecycleBoundary;
  request: PlannerRequestV2;
  schedule: Schedule;
  certificate?: SafetyCertificate | null;
  /** The CURRENT realised history hash (a certificate bound to another history is not valid). */
  historyHash?: string;
  /**
   * (A1-012) The CURRENT audit initial-state/controller hash (`auditStateHash` of the confirmed state living assimilation
   * holds now: anchor, full snapshot content, particles, energy-bias correction and law, trend). A re-plan certificate
   * binds the state its audit consumed: without the current hash, or with another, it is not valid. Never the
   * certificate's own stored value.
   */
  stateHash?: string;
  /** The certificate's subject (see `LifecycleSubject`). */
  from?: LifecycleSubject;
  /**
   * (C5) The confirmed state a later day's subject runs from (adopt, resume, a re-plan's own boundary): the re-plan request
   * of now (confirmed state, the days logged since, the shared realised history). The revalidation simulates the schedule
   * from it, as the re-plan's certification did, so the trace-based constraints are checked; absent, they stay Unchecked.
   */
  confirmed?: ReplanRequest;
}) => Promise<LifecycleRevalidation | null>;

/**
 * (A1-001/A1-004) One declared final audit of a changed subject: when the actual final prescription (anchored to the
 * chosen start date, or otherwise changed) is not the subject its source certificate binds, the consumer may request ONE
 * automatic audit of exactly that final schedule under the current profile/history/state, in a new decision episode,
 * with the source certificate kept as history. A failed source audit is never re-audited (no reseed until a pass); the
 * result is revalidated like any certificate. Null = the audit cannot run (the prescription stays withheld; the scenario
 * or preview stays inspectable).
 */
export type LifecycleFinalAudit = (i: {
  boundary: LifecycleBoundary;
  request: PlannerRequestV2;
  schedule: Schedule;
  /** (C5) The confirmed state a later day's subject runs from: its audit is the re-plan's certification from that state. */
  confirmed?: ReplanRequest;
  /** The source certificate (provenance; its protocol is reused, its history retained). */
  source?: SafetyCertificate | null;
  historyHash?: string;
  stateHash?: string;
  from?: LifecycleSubject;
  episodeId: string;
  createdAt: Instant;
}) => Promise<SafetyCertificate | null>;

/** Whether a source certificate may be followed by one declared final audit of a changed subject (A1-004). */
export function finalAuditAllowed(source: SafetyCertificate | null | undefined): boolean {
  // a failed audit is final for its episode and for every subject derived from it (never retried until a pass)
  if (source && source.status === 'failed') return false;
  if (source?.history?.some((h) => h.status === 'failed')) return false;
  return true;
}

/** Version reasons whose certificate is a planner option's (the whole schedule from its start), not a re-plan subject. */
const WHOLE_SCHEDULE_REASONS: ReadonlySet<string> = new Set(['start']);

/**
 * The certificate subject of a stored version: a re-plan version is certified from the day it was made (its
 * `effectiveFromDay`, `versionFromReplan`), a start version as a whole. Versions that change a schedule without a new
 * audit (resume shift, exercise swap) carry no certificate.
 */
export function certificateSubjectOf(plan: { startDate: LocalDate }, v: { reason: string; effectiveFromDay: number; certificate?: SafetyCertificate | null }): LifecycleSubject | undefined {
  if (!v.certificate || WHOLE_SCHEDULE_REASONS.has(v.reason)) return undefined;
  return { planStart: plan.startDate, date: addDays(plan.startDate, Math.max(0, v.effectiveFromDay)) };
}

/** Symptom reports in log entries (a `symptom` event, or a subjective entry carrying one), oldest first. */
export function symptomsFromEntries(entries: readonly LogEntry[]): SymptomReport[] {
  const out: SymptomReport[] = [];
  for (const e of entries) {
    if (e.assumed) continue;
    const s: LoggedSymptom | undefined = e.kind === 'event' || e.kind === 'subjective' ? e.symptom : undefined;
    if (!s) continue;
    out.push({
      id: e.id,
      category: s.category,
      status: s.status,
      occurredOn: s.occurredOn ?? e.date,
      reportedAt: e.recordedAt ?? e.at ?? `${e.date}T00:00:00.000Z`,
      ...(s.context ? { context: s.context } : {}),
      source: 'user',
    });
  }
  return out.sort((a, b) => (a.reportedAt < b.reportedAt ? -1 : a.reportedAt > b.reportedAt ? 1 : a.id < b.id ? -1 : 1));
}

/** The current symptom state: profile reports and logged reports, the latest report per category (a resolution included). */
export function currentSymptoms(profile: PersonProfile, entries: readonly LogEntry[]): SymptomReport[] {
  const all = [...(profile.safety?.flags.symptoms ?? []), ...symptomsFromEntries(entries)].sort((a, b) => (a.reportedAt < b.reportedAt ? -1 : a.reportedAt > b.reportedAt ? 1 : a.id < b.id ? -1 : 1));
  const byCategory = new Map<string, SymptomReport>();
  for (const s of all) byCategory.set(s.category, s);
  return [...byCategory.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The profile with the current symptom state on its safety flags (what a re-plan or revalidation must read). */
export function withCurrentSymptoms(profile: PersonProfile, entries: readonly LogEntry[]): PersonProfile {
  const logged = symptomsFromEntries(entries);
  if (logged.length === 0) return profile;
  const safety = profile.safety ?? { mode: 'M0' as const, flags: {} };
  return { ...profile, safety: { ...safety, flags: { ...safety.flags, symptoms: currentSymptoms(profile, entries) } } };
}

type ProfileSafety = NonNullable<PersonProfile['safety']>;

/**
 * The person's CURRENT profile safety at a lifecycle boundary or for a re-plan (C5/D4-02), one rule for both: the current
 * screening encoding (`current`) is the base; structured facts it does not express (the field is absent: "not expressed",
 * never "none") stay as the plan stored them — symptom reports, clinician exercise envelopes and tri-state answers — so a
 * check never sees fewer facts than the plan was made under; the symptoms the person logged join last (latest report per
 * category). Without a current encoding the stored safety is the base.
 */
export function currentProfileSafety(stored: ProfileSafety | undefined, current: ProfileSafety | undefined, entries: readonly LogEntry[]): ProfileSafety | undefined {
  const base = current ?? stored;
  let merged: ProfileSafety | undefined = base;
  if (base && current && stored) {
    const flags = { ...base.flags };
    if (flags.symptoms === undefined && stored.flags.symptoms !== undefined) flags.symptoms = stored.flags.symptoms;
    if (flags.exerciseEnvelopes === undefined && stored.flags.exerciseEnvelopes !== undefined) flags.exerciseEnvelopes = stored.flags.exerciseEnvelopes;
    if (flags.answers === undefined && stored.flags.answers !== undefined) flags.answers = stored.flags.answers;
    // A supplied scope is the authoritative current source, including explicit revocation/replacement/empty history.
    // Legacy absence is unknown and may retain stored facts; it must never resurrect sources after a current decision.
    if (flags.renalScope === undefined) {
      if (flags.renalContext === undefined && stored.flags.renalContext !== undefined) flags.renalContext = stored.flags.renalContext;
      if (flags.nutritionEnvelopes === undefined && stored.flags.nutritionEnvelopes !== undefined) flags.nutritionEnvelopes = stored.flags.nutritionEnvelopes;
      if (flags.renalContext === undefined && flags.nutritionEnvelopes === undefined && stored.flags.renalScope !== undefined) flags.renalScope = stored.flags.renalScope;
    }
    merged = { ...base, flags };
  }
  const holder = { safety: merged } as PersonProfile;
  return withCurrentSymptoms(holder, entries).safety;
}

/** The person's documented habitual steps (an entered weekly mean, else the habits tick), or null when not documented. */
export function documentedBaselineSteps(profile: PersonProfile): number | null {
  const a = profile.habits?.activity?.steps?.weeklyMean;
  if (a !== undefined && Number.isFinite(a)) return a;
  const t = profile.habits?.typicalSteps;
  return t !== undefined && Number.isFinite(t) ? t : null;
}

/** Whether a schedule prescribes exercise sessions, or steps above the baseline, on any day from `fromDay`. */
export function prescribedExerciseFrom(schedule: Schedule, fromDay: number, baselineSteps: number | null): { sessions: boolean; stepsAbove: boolean } {
  let sessions = false;
  let stepsAbove = false;
  for (let d = Math.max(0, fromDay); d < schedule.horizonDays; d++) {
    const t = templateOfDay(schedule, d);
    if ((t.exercise ?? []).length > 0) sessions = true;
    if (t.steps !== undefined && t.steps > 0 && (baselineSteps === null || t.steps > baselineSteps)) stepsAbove = true;
    if (sessions && stepsAbove) break;
  }
  return { sessions, stepsAbove };
}

export interface LifecycleSafetyResult {
  boundary: LifecycleBoundary;
  status: SafetyStatus;
  blocked: boolean;
  /** Short reasons (codes and plain words) for the info sheet; the inline status is one word. */
  reasons: Array<{ code: string; text: string }>;
  /** Unresolved concerning exertional symptoms in force. */
  concerning: SymptomReport[];
}

/** Decide a boundary (see the module comment). Pure. */
export function lifecycleSafetyGate(i: {
  boundary: LifecycleBoundary;
  schedule: Schedule;
  fromDay: number;
  profile: PersonProfile;
  entries: readonly LogEntry[];
  certificate?: SafetyCertificate | null;
  revalidation?: LifecycleRevalidation | null;
  today?: LocalDate;
  now?: Instant;
  experimentalTracking?: boolean;
}): LifecycleSafetyResult {
  const reasons: LifecycleSafetyResult['reasons'] = [];
  const concerning = currentSymptoms(i.profile, i.entries).filter(isConcerningUnresolved);
  // An explicit experimental scenario has its own CURRENT clinical-only review. No certificate is minted or relabelled.
  // Missing or legacy reviews cannot authorize this mode, and checked plans never read this permission.
  if (i.experimentalTracking && i.revalidation?.experimentalTracking) {
    const tracking = i.revalidation.experimentalTracking;
    return { boundary: i.boundary, status: 'unchecked', blocked: !tracking.startable, reasons: tracking.blockers.map((text) => ({ code: 'experimentalClinicalRestriction', text })), concerning };
  }
  let status: SafetyStatus = 'unchecked';
  let blocked = false;
  const cert = i.certificate ?? null;
  if (cert && cert.status === 'failed') {
    blocked = true;
    status = 'review';
    reasons.push({ code: 'auditFailed', text: 'The safety audit of this plan did not pass.' });
  }
  if (cert && (cert.constraintStatus === 'violation' || cert.constraintStatus === 'conflict')) {
    blocked = true;
    status = cert.constraintStatus;
    reasons.push({ code: `certificate:${cert.constraintStatus}`, text: cert.constraintStatus === 'violation' ? 'A safety limit is exceeded.' : 'Two safety limits conflict.' });
  }
  const r = i.revalidation ?? null;
  if (r) {
    if (r.status === 'violation' || r.status === 'conflict' || r.status === 'review') {
      blocked = true;
      status = r.status;
      for (const t of r.reasons ?? []) reasons.push({ code: `revalidation:${r.status}`, text: t });
      if (!r.reasons?.length) reasons.push({ code: `revalidation:${r.status}`, text: r.status === 'review' ? 'Safety needs review.' : r.status === 'violation' ? 'A safety limit is exceeded.' : 'Two safety limits conflict.' });
    } else if (!revalidationStartable(r)) {
      // (A1-001) Unchecked is not permission: a mandatory bound without a resolved channel, or no current certificate for
      // this exact subject, withholds the prescription until a fresh declared audit (logging stays available)
      blocked = true;
      if (status !== 'violation' && status !== 'conflict' && status !== 'review') status = 'unchecked';
      const code = r.reasonCode ?? (r.certificateValid ? 'unchecked' : 'certificateRequired');
      reasons.push(
        code === 'certificateRequired' || code === 'certificateFailed'
          ? { code: `revalidation:${code}`, text: code === 'certificateFailed' ? 'The safety audit of this plan did not pass.' : 'Unchecked: this exact plan needs its safety check run first.' }
          : { code: `revalidation:${code}`, text: 'Unchecked: a required safety limit could not be checked on this plan.' },
      );
    } else if (!blocked) status = 'verified';
  } else {
    // (A1-001) no planner revalidation (none installed, or it failed): nothing authorizes the prescription
    blocked = true;
    if (status !== 'violation' && status !== 'conflict' && status !== 'review') status = 'unchecked';
    reasons.push({ code: 'revalidationUnavailable', text: 'Unchecked: safety could not be checked now.' });
    // the shared exercise gate (D4-02, same semantics as screening and planner) still names a symptom reason
    const flags = i.profile.safety?.flags;
    const g = exerciseSymptomGate({
      screening: flags?.faintingOrChestPain ? 'yes' : (flags?.answers?.faintingOrChestPain ?? null),
      symptoms: currentSymptoms(i.profile, i.entries),
      envelopes: flags?.exerciseEnvelopes ?? [],
      today: i.today ?? '',
    });
    if (g.status === 'suspended' || g.status === 'review') {
      const p = prescribedExerciseFrom(i.schedule, i.fromDay, documentedBaselineSteps(i.profile));
      if (p.sessions || p.stepsAbove) {
        blocked = true;
        status = 'review';
        // the symptom reason comes first (the more specific refusal)
        reasons.unshift(g.status === 'suspended' ? { code: 'symptomExercise', text: 'Exercise is on hold while a symptom is unresolved.' } : { code: 'exerciseScreenReview', text: 'Exercise needs a safety check first.' });
      }
    }
  }
  return { boundary: i.boundary, status, blocked, reasons, concerning };
}
