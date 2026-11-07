/**
 * Wiring of the living plan (docs/LIVING_PLAN.md §9, E4 part) around E5's executors (`./living`):
 *
 * - **Ports** (`ctx.ports.living`): the re-planning `PlannerPort` (the planner worker's receding-horizon
 *   `replan`), and the session compiler (E8 `resolveSession` + `toEngineDose` over the seed catalogue). The plan
 *   observes log entries only: what the person logs, plus the ring's steps and main sleep that the Gauge import
 *   (`log.fromGauge`) writes as entries.
 * - **Rollover**: every plan day up to the current day (local date at `dayRolloverH`, default 04:00) gets its
 *   prescription frozen into `dayStatus.prescribed` (`freezePrescription` with the version in force that day; paused
 *   days get the habitual day), so re-plans never rewrite what a past day asked for. Runs at boot, when the day changes
 *   and after plan lifecycle commands.
 * - **Daily assimilation**: after log commands (debounced 1 s) the replay + trend filter runs (`projectLiving`, which
 *   calls `dailyAssimilation`) from the latest confirmed snapshot, cached by the record's `inputsHash` and the estimator
 *   identity (strategy, version, parameter hash — D5-04); the trend is kept in `derived/trend:<planId>` for quick reads,
 *   stamped with that estimator.
 * - **Check-in coordinator** (D5-06): after logs and plan commands (same debounce), at boot and on a new day, a refresh
 *   serialized with the living commands prepares the current-date check-in preview (late-open catch-up included) with its
 *   fixed-prior estimate and re-checks the current prescription's eligibility, in `derived/checkin:<planId>`, once per key.
 *   It never confirms, consumes evidence, advances a correction step or adopts a plan: `plan.checkIn` (the person's Check in,
 *   or their stored opt-in policy) confirms exactly once.
 *
 * Writers here are derive jobs (results the documents imply), never user edits; they emit no bus event (no self-trigger).
 */
import type * as Catalogues from '@/catalogues';
import type * as CatalogueContent from '@/content/catalogues';
import type { PersonProfile } from '@/engine';
import type { SimulationResult } from '@/engine/types/result';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { SIGNAL_BY_NAME } from '@/engine/types/signals';
import {
  addDays,
  blockStartsOf,
  compareDates,
  compositionReadingsFor,
  confirmedStateFromRecord,
  currentAnchors,
  weighInsFor,
  type DerivedAnchorRecord,
  daysBetween,
  estimatorIdentity,
  freezePrescription,
  headAdopted,
  isLive,
  pausedDaySet,
  planDay,
  projectLiving,
  projectionSchedule,
  versionInForce,
  splitAnchorDocs,
  certificateSubjectOf,
  checkInEstimate,
  pendingCheckInOf,
  activateIfDue,
  restoreScenarioGoalTargets,
  currentProfileSafety,
  estimateSummary,
  previewDecision,
  projectEntries,
  CHECK_IN_OPT_IN_ACTOR,
  CHECK_IN_STATUS,
  COORDINATOR_VERSION,
  type LifecycleFinalAudit,
  type LifecycleRevalidate,
  type DayStatusDoc,
  type LivingDocs,
  type LogEntry,
  type MeasurementEntry,
  type PlanDoc,
  type PlannerPort as LivingPlannerPort,
  type PlanVersionDoc,
  type SessionCompiler,
} from '@/living';
import { appDay, DEFAULT_ROLLOVER_H, rolloverOf } from '@/living/appDay';
import { bodyOf, type Doc } from '@/store';
import { settingsValues } from '@/state/internal/settings';
import { getDocumentStore, writeOps } from '@/state/runtime';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import type { DocOpRecord } from '@/state/scope';
import { dispatch, getPorts, installPorts, on, runSerial, timeZone } from './bus';

export interface LivingPorts {
  planner: LivingPlannerPort;
  sessionCompiler: SessionCompiler;
  /**
   * (C5) The planner's revalidation of a stored prescription at a lifecycle boundary (start, adopt, resume, re-plan): the
   * current constraint checks and exercise gate, whether the stored certificate still matches, and the authoritative
   * `startable` decision (A1-001). Optional: without it nothing is startable (logging and inspection stay available).
   */
  revalidate?: LifecycleRevalidate;
  /**
   * (A1-001/A1-004) The one declared final audit of a changed or uncertified subject at a lifecycle boundary (the actual
   * final schedule under the current profile/history/state, a new episode, the source certificate kept as history; never
   * after a failed audit). Optional: without it such a prescription stays withheld until the Planner certifies it.
   */
  audit?: LifecycleFinalAudit;
}

declare module './types' {
  interface CommandPorts {
    /** Living-plan ports (planner re-plan, session compiler). */
    living?: LivingPorts;
  }
}

/* ---------------------------------------------------------------- ports */

/** VO2max for the stimulus context: measured (labs), else the engine bus's safe initial value. */
function stimulusContextOf(profile: PersonProfile) {
  const rp = resolveProfile(profile);
  return {
    bodyMassKg: profile.body.weightKg,
    heightM: profile.body.heightCm / 100,
    vo2max: profile.labs?.vo2maxMlKgMin ?? SIGNAL_BY_NAME.get('vo2maxMlKgMin')!.init,
    rmrKcalPerDay: rp.rmr0Kcal,
  };
}

type CatalogueModules = [typeof Catalogues, typeof CatalogueContent];
let catalogue: CatalogueModules | null = null;
let loading: Promise<void> | null = null;

/** E8's resolver; returns null (the projection then derives sessions from the stimulus) until the catalogue is loaded. */
export const sessionCompiler: SessionCompiler = (performed, startH) => {
  if (!catalogue) {
    loading ??= Promise.all([import('@/catalogues'), import('@/content/catalogues')]).then((m) => {
      catalogue = m;
    });
    return null;
  }
  const [cat, content] = catalogue;
  const resolved = cat.resolveSession(performed, content.SEED_CATALOGUE, stimulusContextOf(simulatorProfileNow()));
  if (resolved.doses.length === 0) return null;
  const dose = cat.toEngineDose(resolved.doses, startH);
  return [...(dose.resistance ? [dose.resistance] : []), ...dose.cardio];
};

/** Load the catalogue now (tests, boot after first paint). */
export function loadSessionCatalogue(): Promise<void> {
  sessionCompiler([], 0);
  return loading ?? Promise.resolve();
}

/** The planner worker's receding-horizon `replan` (PLANNER_V2 §7). */
const plannerPort: LivingPlannerPort = { replan: async (req, options) => (await import('@/workers/plannerClient')).replan(req, options) };

/**
 * The planner's lifecycle revalidation (`revalidatePlanSafety`, loaded on first use). The fingerprint is recomputed with
 * the certificate's own required margins and audit protocol and the CURRENT history and audit-state hashes (A1-012); a
 * certificate stored without them is never reported valid, while known violations, conflicts and review states still
 * block. (A1-001) The planner's authoritative `startable` (only a verified, current certificate on exactly this subject)
 * travels to the consumer with its reason: an Unchecked label is never permission.
 */
const revalidatePort: LifecycleRevalidate = async (i) => {
  const m = await import('@/engine/planner/domain/safetyAudit');
  // a re-plan certificate covers the plan from the day it was made: the planner's own subject (schedule sliced there,
  // request moved to that start) and the elapsed days, so the fingerprint is recomputed on exactly what was certified
  let request = i.request;
  let schedule = i.schedule;
  let elapsedDays = 0;
  if (i.from) {
    const { replanSafetySubject } = await import('@/engine/planner/domain/replan');
    const subject = replanSafetySubject({ request: i.request, schedule: i.schedule, startDate: i.from.planStart }, i.from.date);
    request = subject.request;
    schedule = subject.schedule;
    elapsedDays = Math.max(0, daysBetween(i.from.planStart, i.from.date));
  }
  // the subject is checked on its nominal simulation, as the Planner, the re-plan and the final audit check it: a typed
  // constraint that needs the engine's trace (the 7-day deficit cap every adult has) otherwise stays Unchecked and nothing
  // could start, adopt or resume.
  //  - a start subject (the whole schedule from its start, not bound to a confirmed state: the subjects the final audit
  //    takes): the simulation from the plan start;
  //  - a subject bound to the confirmed state (a later day's, or one with the current audit-state hash: adopt, resume, a
  //    re-plan's boundary): the re-plan's forward run from that confirmed state over the whole schedule with the realised
  //    past, read at the subject's plan day. Without the confirmed state it keeps no simulation (never one from the
  //    baseline in its place).
  // A simulation that cannot run leaves those constraints Unchecked (never a pass)
  let sim: SimulationResult | null = null;
  let simDayOffset: number | undefined;
  try {
    const host = await import('@/engine/planner/domain/evaluatorHost');
    if (!i.from && !i.stateHash) sim = host.startSubjectSimulation(request, schedule);
    else if (i.confirmed) {
      sim = host.confirmedStateSimulation(i.confirmed, i.schedule);
      simDayOffset = elapsedDays;
    }
  } catch {
    sim = null;
    simDayOffset = undefined;
  }
  const r = m.revalidatePlanSafety(request, schedule, {
    boundary: i.boundary,
    certificate: i.certificate ?? null,
    ...(sim ? { sim, ...(simDayOffset !== undefined ? { simDayOffset } : {}) } : {}),
    ...(i.historyHash ? { historyHash: i.historyHash } : {}),
    ...(i.stateHash ? { stateHash: i.stateHash } : {}),
    ...(elapsedDays > 0 ? { elapsedDays } : {}),
  });
  const e = r.evaluation;
  // an incomplete legacy screen (review needed) gates exercise progression only. Explicit distinction (A1-001): on a
  // prescription without gated exercise and without a mandatory lock review it reads Unchecked instead of Review (no global
  // lock from an unrelated screen) — and it is startable only when the certificate binds exactly this subject with a passed
  // audit (it was issued under the same open screen), never from the label
  const screenOnly = r.status === 'review' && e.exercise.gate === 'reviewNeeded' && e.exercise.ok && !e.review.some((x) => x.mandatory) && e.status === 'review';
  const cert = i.certificate ?? null;
  const screenOnlyBound = screenOnly && !!cert && cert.fingerprint === r.fingerprint && cert.status !== 'failed' && cert.audit?.status === 'pass' && e.validator.ok && !e.evaluations.some((x) => x.status === 'violation' || (x.mandatory && x.status !== 'pass'));
  const startable = r.startable || screenOnlyBound;
  return {
    status: screenOnlyBound ? 'verified' : screenOnly ? 'unchecked' : r.status,
    startable,
    reasonCode: startable ? null : screenOnly ? 'certificateRequired' : r.reasonCode,
    certificateValid: r.certificateValid,
    ...(r.experimentalTracking ? { experimentalTracking: r.experimentalTracking } : {}),
    reasons: [...e.exercise.reasons, ...e.validator.reasons],
    // the subject's fingerprint (diagnostics; a consumer never copies it back as the current state)
    fingerprint: r.fingerprint,
  };
};

/**
 * (A1-001/A1-004) The one declared final audit of a changed start subject (`finalSubjectCertificate`, loaded on first use):
 * exactly the anchored schedule from its start under the current profile/screening, in a new decision episode, the source
 * certificate's draw protocol reused and the source kept as history; never after a failed audit and never retried. A later
 * day's subject (`from`) bound to the confirmed audit state (`stateHash`) gets a re-plan's audit: the certification a re-plan
 * runs, from the confirmed state it is given (`confirmedStateCertificate`); without that state the port declines (null)
 * and the prescription stays withheld.
 */
const auditPort: LifecycleFinalAudit = async (i) => {
  const host = await import('@/engine/planner/domain/evaluatorHost');
  if (!i.from && !i.stateHash) {
    const r = host.finalSubjectCertificate({ request: i.request, schedule: i.schedule, source: i.source ?? null, ...(i.historyHash ? { historyHash: i.historyHash } : {}), episodeId: i.episodeId, createdAt: i.createdAt });
    return r.certificate;
  }
  // (C5/A1-004) a subject bound to the confirmed state: the re-plan's own certification from that state and history,
  // under the lifecycle's current request and safety (the same audit, never a bypass). Without the subject, the state
  // hash or the confirmed state it hashes, no audit runs (the prescription stays withheld)
  if (!i.from || !i.stateHash || !i.confirmed) return null;
  const req = {
    ...i.confirmed,
    currentSafety: { ...(i.request.profile.safety ? { profileSafety: i.request.profile.safety } : {}), ...(i.request.safety ? { input: i.request.safety } : {}) },
  };
  const r = host.confirmedStateCertificate({
    req, request: i.request, schedule: i.schedule, from: i.from, stateHash: i.stateHash, ...(i.historyHash ? { historyHash: i.historyHash } : {}),
    source: i.source ?? null, episodeId: i.episodeId, createdAt: i.createdAt,
  });
  return r.certificate;
};

export function installLivingPorts(over: Partial<LivingPorts> = {}): LivingPorts {
  const living: LivingPorts = { planner: plannerPort, sessionCompiler, revalidate: revalidatePort, audit: auditPort, ...over };
  installPorts({ living });
  return living;
}
installLivingPorts();

/* ---------------------------------------------------------------- documents */

type WithId<T> = T & { id: string };
const withId = <T>(d: Doc<unknown>): WithId<T> => ({ ...bodyOf<T>(d), id: d._id });

export function readLivingDocs(today: string = currentDay()): LivingDocs {
  const store = getDocumentStore();
  const active = store.peek<{ planId: string | null }>('activePlan', 'me');
  const allVersions = store.peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d));
  const plans = store.peekAll<PlanDoc>('plans').map((d) => {
    const plan = restoreScenarioGoalTargets(withId<PlanDoc>(d), allVersions);
    const transition = activateIfDue(plan, today);
    return transition.ok ? { ...transition.plan, id: plan.id } : plan;
  });
  const plan =
    (active?.planId ? plans.find((p) => p.id === active.planId) : undefined) ??
    plans.filter(isLive).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ??
    null;
  return {
    plan,
    versions: plan ? allVersions.filter((v) => v.planId === plan.id) : [],
    dayStatus: store.peekAll<DayStatusDoc>('dayStatus').map((d) => bodyOf<DayStatusDoc>(d)),
    entries: store.peekAll<LogEntry>('dailyLogs').map((d) => withId<LogEntry>(d)),
    measurements: store.peekAll<MeasurementEntry>('measurements').map((d) => withId<MeasurementEntry>(d)),
    // (D5-06) records and stored check-in decisions share `anchors`; (C5) the current screening reaches the eligibility check
    ...anchoredOf(
      plan
        ? store
            .peekAll<Record<string, unknown>>('anchors')
            .map((d) => bodyOf<Record<string, unknown>>(d))
            .filter((r) => r.planId === plan.id)
        : [],
    ),
    ...currentSafetyOf(),
    // (A1-017) recomputed current-state anchors kept beside the original records (derived; reused while their lineage holds)
    ...(plan ? derivedAnchorsOf(plan.id) : {}),
    // quiet mode reaches the living screens' projection as it reaches today.get (Q4-17)
    settings: { quietMode: settingsValues().quietMode },
  };
}

/** The anchors documents as records and stored decisions (`splitAnchorDocs`). */
function anchoredOf(docs: readonly Record<string, unknown>[]): Pick<LivingDocs, 'records' | 'decisions'> {
  const { records, decisions } = splitAnchorDocs(docs);
  return { records, decisions };
}

/** Derived id of a recomputed current anchor of a plan day (A1-017). */
export const derivedAnchorDocId = (planId: string, anchorDay: number): string => `anchor:${planId}:${anchorDay}`;

/** (A1-017) The recomputed current-state anchors of a plan kept in `derived` (never decisions, never the records). */
export function derivedAnchorsOf(planId: string): Pick<LivingDocs, 'derivedAnchors'> {
  const all = getDocumentStore().peekAll<Record<string, unknown>>('derived').map((d) => bodyOf<Record<string, unknown>>(d));
  const mine = all.filter((d): d is Record<string, unknown> & DerivedAnchorRecord => d.kind === 'vitals.derivedAnchor' && d.planId === planId) as DerivedAnchorRecord[];
  return mine.length ? { derivedAnchors: mine } : {};
}

/** The person's current profile safety, when it can be read (the screening now). */
function currentSafetyOf(): Pick<LivingDocs, 'currentSafety'> {
  try {
    const safety = simulatorProfileNow().safety;
    return safety ? { currentSafety: safety } : {};
  } catch {
    return {};
  }
}

export { DEFAULT_ROLLOVER_H };

/** The current plan day's date: the day rolls over at `rolloverH` local time (SUITE_SPEC §3.4; `settings.dayRolloverH`). */
export function currentDay(now: number = Date.now(), tz = timeZone(), rolloverH = rolloverOf(settingsValues())): string {
  return appDay(now, { tz, rolloverH });
}

/* ---------------------------------------------------------------- rollover */

/** Freeze the prescription of every unfrozen plan day up to the current day. Returns the dates frozen. */
export async function runRollover(now: number = Date.now()): Promise<string[]> {
  const store = getDocumentStore();
  await store.ready;
  const docs = readLivingDocs(currentDay(now));
  const plan = docs.plan;
  const head = plan ? headAdopted(docs.versions) : null;
  if (!plan || !head || !isLive(plan)) return [];
  const tz = timeZone();
  const today = currentDay(now, tz);
  const last =
    compareDates(today, addDays(plan.plannedEndDate, -1)) < 0 ? today : addDays(plan.plannedEndDate, -1);
  if (compareDates(last, plan.startDate) < 0) return [];
  const status = new Map(docs.dayStatus.map((s) => [s.date, s] as const));
  const paused = pausedDaySet(plan, addDays(today, 1));
  const ops: DocOpRecord[] = [];
  const frozen: string[] = [];
  for (let date = plan.startDate; compareDates(date, last) <= 0; date = addDays(date, 1)) {
    const prev = status.get(date);
    if (prev?.prescribed && prev.prescribed.planId === plan.id) continue;
    const d = planDay(plan, date);
    const version = versionInForce(docs.versions, d) ?? head;
    const prescribed = freezePrescription({
      plan,
      version,
      date,
      tz,
      ...(paused.has(d) ? { paused: true } : {}),
    });
    const after = { ...(prev ?? {}), date, planId: plan.id, planDay: d, prescribed } as unknown as Record<
      string,
      unknown
    >;
    ops.push({
      col: 'dayStatus',
      id: `day:${date}`,
      before: (prev as unknown as Record<string, unknown>) ?? null,
      after,
    });
    frozen.push(date);
  }
  await writeOps('derive', ops, 'rollover');
  return frozen;
}

/* ---------------------------------------------------------------- daily assimilation */

const snapshotCache = new Map<string, { anchorDay: number; inputsHash: string; snapshot: unknown }>();

/** Replay + trend filter from the latest confirmed snapshot; keeps the trend in `derived/trend:<planId>`. */
export async function runAssimilation(
  now: number = Date.now(),
): Promise<{ usedCache: boolean; trendKg: number | null } | null> {
  const store = getDocumentStore();
  await store.ready;
  const tz = timeZone();
  const today = currentDay(now, tz);
  const docs = readLivingDocs(currentDay(now));
  const plan = docs.plan;
  const head = plan ? headAdopted(docs.versions) : null;
  if (!plan || !head || !isLive(plan) || compareDates(today, plan.startDate) < 0) return null;
  const nowIso = new Date(now).toISOString();
  const latest = [...docs.records].sort((a, b) => a.anchorDay - b.anchorDay).pop() ?? null;
  // (C4/C7, D5-04) the cached confirmed snapshot is keyed by the record's replay inputs AND the estimator identity: a
  // changed assimilation parameter or estimator version never reuses a snapshot or a filter state made under the old one.
  // (A1-017) AND the current observation dependency identity of the anchor chain: a retracted or corrected reading, an
  // edited past day or another estimator/operator makes the stored anchors refit, so the old snapshot is never reused
  const estimator = estimatorIdentity();
  let cached: { anchorDay: number; inputsHash: string; snapshot: unknown } | null = null;
  if (latest) {
    // the shared realised history (its fasts and hash), exactly as the check-in and re-planning replay it (C2)
    const proj = projectLiving({ docs, today, tz, now: nowIso, sessionCompiler, skipAssimilation: true });
    const schedule = projectionSchedule(proj, today);
    if (!schedule) return null;
    const measurements = projectEntries(docs.measurements);
    const current = currentAnchors({
      plan,
      schedule,
      records: docs.records,
      weighIns: weighInsFor(plan, measurements, projectEntries(docs.entries), blockStartsOf(head.schedule)),
      composition: compositionReadingsFor(plan, measurements) ?? null,
      ...(docs.derivedAnchors?.length ? { derived: docs.derivedAnchors } : {}),
    });
    const cacheKey = `${latest.inputsHash}|${estimator.strategy}@${estimator.version}:${estimator.paramsHash}|${current.lastFingerprint ?? '-'}|${current.invalidFrom ?? '-'}`;
    cached = snapshotCache.get(cacheKey) ?? null;
    if (!cached) {
      // rebuild the confirmed snapshot of the latest record once per key, from the CURRENT anchors (refit where needed)
      const state = confirmedStateFromRecord(plan, schedule, docs.records, latest, current);
      cached = { anchorDay: latest.anchorDay, inputsHash: latest.inputsHash, snapshot: state.snapshot };
      snapshotCache.clear();
      snapshotCache.set(cacheKey, cached);
    }
  }
  const p = projectLiving({
    docs,
    today,
    tz,
    now: nowIso,
    sessionCompiler,
    ...(cached ? { cached: cached as never } : {}),
  });
  // (A1-017) recomputed current anchors are kept beside the original records (derived; a refit is never a decision)
  const derived = p.assimilation?.current?.derived ?? [];
  const known = new Map(
    (docs.derivedAnchors ?? []).map((d) => [derivedAnchorDocId(d.planId, d.anchorDay), d] as const),
  );
  const anchorOps: DocOpRecord[] = derived
    .filter(
      (d) =>
        JSON.stringify(known.get(derivedAnchorDocId(d.planId, d.anchorDay)) ?? null) !== JSON.stringify(d),
    )
    .map((d) => ({
      col: 'derived',
      id: derivedAnchorDocId(d.planId, d.anchorDay),
      before:
        (known.get(derivedAnchorDocId(d.planId, d.anchorDay)) as unknown as Record<string, unknown>) ?? null,
      after: d as unknown as Record<string, unknown>,
    }));
  if (anchorOps.length) await writeOps('derive', anchorOps, 'derivedAnchors');
  const t = p.assimilation?.trendToday ?? null;
  // (C4/D5-02) the water-adjusted estimate and the raw scale trend are different observables: both kept, each tagged
  const s = p.assimilation?.scaleToday ?? null;
  await writeOps(
    'derive',
    [
      {
        col: 'derived',
        id: `trend:${plan.id}`,
        before: null,
        after: {
          kind: 'trend',
          planId: plan.id,
          asOf: today,
          at: nowIso,
          trendToday: t,
          trendOperator: 'waterAdjustedWake',
          scaleToday: s,
          scaleOperator: 'scaleWake',
          ...(p.history ? { historyHash: p.history.contentHash } : {}),
          estimator,
          usedCache: p.assimilation?.usedCache ?? false,
        },
      },
    ],
    'assimilation',
  );
  return { usedCache: p.assimilation?.usedCache ?? false, trendKg: t?.kg ?? null };
}

/* ---------------------------------------------------------------- check-in coordinator (D5-06) */

/** Derived id of a plan's check-in preview (never authoritative; rewritten only when its key changes). */
export const checkInPreviewDocId = (planId: string): string => `checkin:${planId}`;

export interface CheckInRefresh {
  due: boolean;
  /** Key of the prepared preview (null when no check-in is due) and of the eligibility check. */
  key: string | null;
  eligibilityKey: string | null;
  /** False when the same keys were already processed (nothing written). */
  wrote: boolean;
  /** The person's stored opt-in policy confirmed the due check-in. */
  autoConfirmed: boolean;
}

/**
 * The coordinator's automatic refresh (serialized with the living commands): reduce the documents, compute the versioned
 * fixed-prior check-in preview when one is due (late-open catch-up included, decided for today), re-check the current
 * prescription's eligibility, and keep both in `derived/checkin:<planId>` — once per key. It never confirms a check-in,
 * consumes evidence, advances a correction step or adopts a plan; only an explicit Check in does, or the person's
 * separately stored opt-in policy (`settings.checkInAutoConfirm === true`, off by default). Its derive write emits no bus
 * event, so it never triggers itself.
 */
export async function runCheckInRefresh(now: number = Date.now()): Promise<CheckInRefresh | null> {
  const r = await runSerial('living', () => refreshCheckIn(now));
  if (!r || !r.optIn) return r ? { due: r.due, key: r.key, eligibilityKey: r.eligibilityKey, wrote: r.wrote, autoConfirmed: false } : null;
  // after the serialized section: the confirmation is a command in the same lane (it would wait for us otherwise)
  const res = await dispatch('plan.checkIn', { previewId: r.optIn }, { actor: { kind: 'system', id: CHECK_IN_OPT_IN_ACTOR } });
  return { due: r.due, key: r.key, eligibilityKey: r.eligibilityKey, wrote: r.wrote, autoConfirmed: res.ok };
}

async function refreshCheckIn(
  now: number,
): Promise<{
  due: boolean;
  key: string | null;
  eligibilityKey: string | null;
  wrote: boolean;
  optIn: string | null;
} | null> {
  const store = getDocumentStore();
  await store.ready;
  const tz = timeZone();
  const today = currentDay(now, tz);
  const docs = readLivingDocs(currentDay(now));
  const plan = docs.plan;
  const head = plan ? headAdopted(docs.versions) : null;
  if (!plan || !head || !isLive(plan) || compareDates(today, plan.startDate) < 0) return null;
  const nowIso = new Date(now).toISOString();
  const p = projectLiving({ docs, today, tz, now: nowIso, sessionCompiler, skipAssimilation: true });
  const pending = pendingCheckInOf({ docs, projection: p, today });
  if (!pending) return null;
  const { evidence, review } = pending;
  const due = p.checkInSchedule;
  const preview = due.due ? { ...previewDecision(evidence, nowIso), review } : null;
  const key = preview?.key ?? null;
  const eligibility = p.eligibility;
  const eligibilityKey = eligibility?.key ?? null;
  const id = checkInPreviewDocId(plan.id);
  const prev = store.peek<Record<string, unknown>>('derived', id);
  const prevBody = prev ? bodyOf<Record<string, unknown>>(prev) : null;
  const optInOn = settingsValues().checkInAutoConfirm === true;
  const optIn =
    due.due &&
    optInOn &&
    preview &&
    review.status === 'none' &&
    !p.eligibility?.blocked &&
    !p.eligibility?.safetyChanged
      ? evidence.previewId
      : null;
  // the same document/event hash is processed once (edits, sync, retries and other devices give the same key)
  if (
    prevBody &&
    prevBody.key === key &&
    prevBody.eligibilityKey === eligibilityKey &&
    prevBody.asOf === today
  )
    return { due: due.due, key, eligibilityKey, wrote: false, optIn };
  // a changed screening: the planner's revalidation of the current prescription (C5 'safetyChange'), once per key
  let revalidation: Awaited<ReturnType<LifecycleRevalidate>> = null;
  const port = getPorts().living?.revalidate;
  if (eligibility?.safetyChanged && port) {
    try {
      const safety = currentProfileSafety(
        plan.request.profile.safety,
        docs.currentSafety,
        projectEntries(docs.entries),
      );
      const subject = certificateSubjectOf(plan, head);
      revalidation = await port({
        boundary: 'safetyChange',
        request: { ...plan.request, profile: { ...plan.request.profile, ...(safety ? { safety } : {}) } },
        schedule: head.schedule,
        certificate: head.certificate ?? null,
        ...(p.history ? { historyHash: p.history.contentHash } : {}),
        ...(subject ? { from: subject } : {}),
      });
    } catch {
      revalidation = null;
    }
  }
  // the fixed-prior estimate the confirmation would record for this key (computed once per key; a preview, never evidence)
  let estimate: ReturnType<typeof estimateSummary> | null =
    prevBody && prevBody.key === key && key !== null
      ? ((prevBody.estimate as ReturnType<typeof estimateSummary> | null | undefined) ?? null)
      : null;
  if (preview && !estimate) {
    const schedule = projectionSchedule(p, today);
    if (schedule) {
      try {
        const past = p.days.filter((d) => compareDates(d.date, today) < 0);
        estimate = estimateSummary(
          checkInEstimate({
            plan,
            head,
            records: docs.records,
            measurements: projectEntries(docs.measurements),
            entries: projectEntries(docs.entries),
            schedule,
            past,
            today,
            historyHash: p.history?.contentHash ?? null,
            ...(docs.derivedAnchors?.length ? { derived: docs.derivedAnchors } : {}),
          }),
        );
      } catch {
        estimate = null;
      }
    }
  }
  const after = {
    kind: 'checkInPreview',
    planId: plan.id,
    asOf: today,
    at: nowIso,
    coordinatorVersion: COORDINATOR_VERSION,
    key,
    eligibilityKey,
    estimate,
    review,
    due: { due: due.due, late: due.late, scheduled: due.scheduled, decisionPoint: due.decisionPoint },
    status: due.due ? (review.status === 'review' ? CHECK_IN_STATUS.review : CHECK_IN_STATUS.ready) : null,
    preview,
    eligibility,
    revalidation,
  };
  await writeOps(
    'derive',
    [{ col: 'derived', id, before: prevBody, after: after as unknown as Record<string, unknown> }],
    'checkInRefresh',
  );
  return { due: due.due, key, eligibilityKey, wrote: true, optIn };
}

/* ---------------------------------------------------------------- automation */

let automation: { off: () => void; timer: ReturnType<typeof setInterval> } | null = null;
let assimTimer: ReturnType<typeof setTimeout> | null = null;
let lastDay = '';

const report = (e: unknown) => console.error('Vitals: living-plan upkeep failed', e);

/** Assimilation (when asked) then the check-in refresh, debounced 1 s; a newer request replaces a pending one. */
let pendingAssim = false;
function scheduleUpkeep(assimilate: boolean): void {
  pendingAssim ||= assimilate;
  if (assimTimer) clearTimeout(assimTimer);
  assimTimer = setTimeout(() => {
    const doAssim = pendingAssim;
    pendingAssim = false;
    void (doAssim ? runAssimilation() : Promise.resolve(null))
      .catch(report)
      .then(() => runCheckInRefresh())
      .catch(report);
  }, 1000);
}

/**
 * Hooks the bus: rollover on plan lifecycle commands and day changes, assimilation after logs, and the check-in refresh
 * (D5-06) after both (debounced 1 s), at boot and on a new day (late-open catch-up). Derived writes emit no bus event: the
 * upkeep never triggers itself.
 */
export function startLivingAutomation(): () => void {
  if (automation) return automation.off;
  const off = on((e) => {
    if (e.type !== 'committed') return;
    if (e.commandId.startsWith('plan.')) void runRollover().catch(report);
    if (e.commandId.startsWith('log.') || e.commandId === 'plan.checkIn') scheduleUpkeep(true);
    else if (e.commandId.startsWith('plan.')) scheduleUpkeep(false);
  });
  const timer = setInterval(() => {
    const day = currentDay();
    if (day !== lastDay) {
      lastDay = day;
      void runRollover().catch(report);
      scheduleUpkeep(false);
    }
  }, 60_000);
  lastDay = currentDay();
  void runRollover().catch(report);
  scheduleUpkeep(false);
  automation = {
    timer,
    off: () => {
      off();
      clearInterval(timer);
      if (assimTimer) clearTimeout(assimTimer);
      automation = null;
    },
  };
  return automation.off;
}
