/**
 * Living-plan executors (E5) for the stubs E4 declared in `../defs/living.ts`: ids, schemas, permissions, surfaces, undo
 * and idempotency stay E4's; importing this module (after the defs) replaces each stub's `execute`. Wiring (E4): add
 * `import './living';` after `import './defs/living';` in `src/commands/index.ts`.
 *
 * The behaviour lives in the pure `@/living` package (docs/LIVING_PLAN.md); these functions only read the documents,
 * call it, and write the result through the command's transaction. Commands that need other packages' ports stay stubs
 * until those land: `log.meal`/`log.mealFromPhoto` (E8 food table, E9 vision), `log.session` (E8 catalogue resolution),
 * `log.bulk`. The adaptation commands (`plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay`,
 * `plan.swapExercise`) are in `./adapt.ts` (E5b).
 */
import { implement as implementShared } from '../implement';
import { MEASUREMENT_METRICS } from '../defs/living';
import { bodyOf, withDocId, type Doc } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { appDay, rolloverOf } from '@/living/appDay';
import * as planner from '@/state/internal/planner';
import * as sched from '@/state/internal/schedule';
import { settingsValues } from '@/state/internal/settings';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import {
  CONTRACT_VERSIONS,
  DAY_INTAKE_ATTESTATIONS,
  SUBSTANCE_UNITS,
  contentHash,
  exactOccurrence,
  intervalOccurrence,
  normalizeSubstanceDose,
  type DayIntakeAttestation,
  type LifecycleBoundary,
  type SafetyCertificate,
} from '@/lib/bodyContracts';
import { runReplay } from '@/engine/assimilation';
import { markerRuleContext } from '@/markers/context';
import { markerRenalFindings } from '@/markers/renal';
import { evaluateMarkers } from '@/markers/rules';
import { readMarkerContextSources } from '@/markers/ui/contextSources';
import { readMarkersDoc } from '@/markers/ui/markersDoc';
import { screeningAnsweredOn, withCurrentSafety, withMarkerSafety } from '@/markers/ui/request';
import { plannerSafetyInputNow, safetyAccessNow, safetyValues } from '@/state/internal/safety';
import { renalSafetyFlags, resolveClinicalNutritionScope } from '@/lib/renalScope';
import { legacyMeasurementContext } from '@/lib/measurementOperators';
import type { PersonProfile, Schedule } from '@/engine';
import type { PlannerRequestV2 } from '@/engine/planner';
import type { ReplanRequest } from '@/engine/planner/domain/replanTypes';
import {
  activateIfDue,
  anchorsFromRecords,
  blockStartsOf,
  canDiscard,
  endPlan,
  headAdopted,
  isLive,
  OPTION_OF_RUNG,
  pausePlan,
  planDay,
  planLength,
  projectLiving,
  projectionSchedule,
  buildReplanRequest,
  confirmedStateFromRecord,
  compositionReadingsFor,
  currentAnchors,
  weighInsFor,
  daysBetween,
  finalAuditAllowed,
  revalidationStartable,
  type ConfirmedState,
  type LifecycleRevalidation,
  type LivingProjection,
  currentExerciseEligibilityOf,
  overlayPrescription,
  certificateSubjectOf,
  currentProfileSafety,
  lifecycleSafetyGate,
  versionInForce,
  resumePlan,
  resumeSchedule,
  RUNG_OF_OPTION,
  startFromRung,
  startFromScenario,
  restoreScenarioGoalTargets,
  checkInEstimate,
  checkInDueAt,
  CHECK_IN_OPT_IN_ACTOR,
  pendingCheckInOf,
  confirmDecision,
  lastConfirmedCheckIn,
  previewDecision,
  splitAnchorDocs,
  storedDecisionOn,
  type CheckInDecisionDoc,
  type StoredCheckInDecision,
  supplementExposures,
  effectiveEntries,
  projectEntries,
  type Actor as LivingActor,
  type ConfirmedStateRecord,
  type DayMarks,
  type DayStatusDoc,
  type EndReason,
  type EntrySource,
  type LivingDocs,
  type LocalDate,
  planGaugeImport,
  gaugeEntryId,
  type LogEntry,
  type StepsFusionDay,
  type Mark,
  type MarkBlock,
  type MeasurementEntry,
  type MeasurementMetric,
  type PlanDoc,
  type PlannerProvenanceV2,
  type PlanVersionDoc,
  type RungId,
  type StartOutcome,
  type Weekday,
  type WellbeingConcern,
  type LifecycleSafetyResult,
  type LifecycleSubject,
} from '@/living';
import { addDays as addLocalDays } from '@/living/dates';
import { diaryOf, diaryProblem, nightOn, nightWithDiary, patchDiary } from '@/living/sleepDiary';
import { fail, getCommand } from '../registry';
import { currentDay, derivedAnchorsOf } from '../livingWiring';
import { T, Value, type JsonSchema } from '../schema';
import type { CommandContext } from '../types';

type Exec = (ctx: CommandContext, input: never) => unknown;

/** Replace a stub's executor; ids E4 no longer declares are skipped. Returns the ids implemented. */
const implemented: string[] = [];
export function implement(id: string, execute: Exec): void {
  // living writes read the store, not each other's buffers: they run one at a time (two taps on "start" started two plans).
  // (0.6.5) Through the shared `implement`, so an executor evaluated before its stub waits for it instead of being dropped.
  implementShared(id, execute as never, 'E5', (def) => (def.perm === 'read' ? {} : { serial: 'living' }));
  implemented.push(id);
}

/** Ids whose stub executor this module replaced (tests, `app.status`). */
export function livingImplemented(): readonly string[] {
  return implemented;
}

// ------------------------------------------------------------------------------------------- documents
export type WithId<T> = T & { id: string };
const withId = <T>(d: Doc<unknown>): WithId<T> => withDocId<T>(d);

/**
 * The Living documents. With `today`, a plan still stored as 'scheduled' whose start date has come reads as 'active'
 * (lifecycle `activateIfDue`, §3.1 "first open on/after the start"): nothing stays locked once day 1 arrives, and the
 * next command that saves the plan stores the new status.
 */
export async function readDocs(
  today: LocalDate = currentDay(),
): Promise<LivingDocs & { plans: WithId<PlanDoc>[] }> {
  const store = getDocumentStore();
  await store.ready;
  const active = store.peek<{ planId: string | null }>('activePlan', 'me');
  const allVersions = store.peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d));
  const plans = store.peekAll<PlanDoc>('plans').map((d) => {
    const p = restoreScenarioGoalTargets(withId<PlanDoc>(d), allVersions);
    const t = today ? activateIfDue(p, today) : null;
    return t?.ok ? { ...t.plan, id: p.id } : p;
  });
  const byActive = active?.planId ? plans.find((p) => p.id === active.planId) : undefined;
  const live = plans.filter(isLive).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const plan = byActive ?? live ?? null;
  const settings = settingsValues() as unknown as Record<string, unknown>;
  // (D5-06) `anchors` holds the confirmed-state records and the stored check-in decisions (a record carries its decision; a
  // confirmation that anchored nothing is a decision-only document)
  const anchored = plan
    ? splitAnchorDocs(
        store
          .peekAll<Record<string, unknown>>('anchors')
          .map((d) => bodyOf<Record<string, unknown>>(d))
          .filter((r) => r.planId === plan.id),
      )
    : { records: [], decisions: [] };
  const currentSafety = currentProfileSafetyNow();
  return {
    plans,
    plan,
    versions: plan ? allVersions.filter((v) => v.planId === plan.id) : [],
    dayStatus: store.peekAll<DayStatusDoc>('dayStatus').map((d) => bodyOf<DayStatusDoc>(d)),
    entries: store.peekAll<LogEntry>('dailyLogs').map((d) => withId<LogEntry>(d)),
    measurements: store.peekAll<MeasurementEntry>('measurements').map((d) => withId<MeasurementEntry>(d)),
    records: anchored.records,
    decisions: anchored.decisions,
    ...(currentSafety ? { currentSafety } : {}),
    // (A1-017) recomputed current-state anchors kept beside the original records (derived; reused while their lineage holds)
    ...(plan ? derivedAnchorsOf(plan.id) : {}),
    settings: {
      ...(typeof settings.quietMode === 'boolean' ? { quietMode: settings.quietMode } : {}),
      ...(typeof settings.dayRolloverH === 'number' ? { dayRolloverH: settings.dayRolloverH } : {}),
    },
  };
}

/** (C5/D5-06) The person's current profile safety (the screening now), or undefined when it cannot be read. */
export function currentProfileSafetyNow(): PersonProfile['safety'] | undefined {
  try {
    return simulatorProfileNow().safety;
  } catch {
    return undefined;
  }
}

export function requirePlan(docs: LivingDocs): WithId<PlanDoc> {
  if (!docs.plan || !isLive(docs.plan))
    fail('precondition_failed', 'There is no running plan.', { precondition: 'activePlan' });
  return docs.plan as WithId<PlanDoc>;
}

function sourceOf(ctx: CommandContext, method: EntrySource['method'] = 'typed'): EntrySource {
  const k = ctx.actor.kind;
  const by: EntrySource['by'] =
    k === 'user' ? 'user' : k === 'system' ? 'system' : k === 'companion' ? 'import' : 'ai';
  return {
    by,
    method: by === 'ai' && method === 'typed' ? 'aiText' : method,
    ...(ctx.actor.conversationId ? { conversationId: ctx.actor.conversationId } : {}),
    ...(ctx.actor.toolCallId ? { toolCallId: ctx.actor.toolCallId } : {}),
    actorId: ctx.actor.id,
  };
}

export function actorOf(ctx: CommandContext): LivingActor {
  const k = ctx.actor.kind;
  return {
    kind: k === 'user' ? 'user' : k === 'system' ? 'system' : k === 'companion' ? 'import' : 'ai',
    id: ctx.actor.id,
  };
}

const planBody = (p: WithId<PlanDoc>): PlanDoc => {
  const { id: _id, ...rest } = p;
  void _id;
  return rest;
};

export async function savePlan(ctx: CommandContext, p: WithId<PlanDoc>): Promise<void> {
  await ctx.docs.put('plans', { ...planBody(p), _id: p.id });
}

export async function appendEntry(
  ctx: CommandContext,
  e: Omit<LogEntry, 'id'> & { id?: string },
): Promise<{ entryId: string }> {
  const id = e.id ?? ctx.newId();
  const docs = await readDocs(ctx.today);
  const plan = docs.plan && isLive(docs.plan) ? docs.plan : null;
  // (C2) an explicit planned-item identity becomes the entry's link (the version in force that day); an extra stays extra
  const day = plan ? planDay(plan, e.date) : 0;
  const inForce = plan ? (versionInForce(docs.versions, day) ?? headAdopted(docs.versions)) : null;
  const link =
    plan && e.itemId && e.extra !== true && e.kind !== 'retract' && !e.link
      ? { link: { planId: plan.id, version: inForce?.version ?? plan.headVersion, itemId: e.itemId } }
      : {};
  const body = { ...e, ...link, ...(plan ? { planId: plan.id, planDay: day } : {}) } as LogEntry;
  const { id: _drop, ...rest } = body;
  void _drop;
  await ctx.docs.append('dailyLogs', { ...rest, _id: id });
  return { entryId: id };
}

// ------------------------------------------------------------------------------------------- reads
implement('today.get', async (ctx, input: { date?: string }) => {
  const docs = await readDocs(ctx.today);
  const date = input.date ?? ctx.today;
  const view = projectLiving({ docs, today: date, tz: ctx.tz, now: ctx.now }).today;
  return view;
});

implement('day.get', async (ctx, input: { date?: string }) => {
  const docs = await readDocs(ctx.today);
  const date = input.date ?? ctx.today;
  const p = projectLiving({
    docs,
    today: date > ctx.today ? date : ctx.today,
    tz: ctx.tz,
    now: ctx.now,
    skipAssimilation: true,
  });
  const day = p.days.find((d) => d.date === date) ?? null;
  // forked versions of one entry are shown once, with their conflict (C-CONFLICT)
  const entries = projectEntries(docs.entries).filter((e) => e.date === date);
  const items = day?.result.loggedDay.items ?? [];
  const score = day?.result.score ?? null;
  // (D4-02/A1-005) today's and future days' unperformed recommendations carry the CURRENT exercise eligibility overlay;
  // a past day keeps exactly what it prescribed (historical provenance)
  const eligibility =
    day && docs.plan && date >= ctx.today
      ? currentExerciseEligibilityOf(
          docs.plan,
          projectEntries(docs.entries),
          docs.currentSafety,
          date,
          day.prescription.steps ?? null,
        )
      : null;
  return {
    date,
    planDay: day?.planDay ?? null,
    prescription: day ? overlayPrescription(day.prescription, eligibility) : null,
    ...(eligibility ? { exerciseEligibility: eligibility } : {}),
    entries,
    measurements: projectEntries(docs.measurements).filter((m) => m.date === date),
    marks: docs.dayStatus.find((s) => s.date === date)?.marks ?? {},
    score,
    items,
    // (W1) what was observed that day, kept apart from completion: per-channel coverage (C1), the entered ratings and
    // concern flags (D2-06/D8-09), the night ending that day (D8-06), the logged sessions' net energy (D3-07/D8-04), active
    // exposures with unknown potency counted (D7-04), nutrient sums with their coverage and how amounts were obtained (D6)
    observed: day
      ? {
          coverage: day.result.coverage,
          wellbeing: day.result.observedWellbeing,
          sleep: day.result.sleep,
          exercise: day.result.exercise,
          actives: day.result.actives,
          nutrients: day.result.nutrients,
          amountMethods: day.result.amountMethods,
        }
      : null,
  };
});

implement('plan.get', async (ctx) => {
  const docs = await readDocs(ctx.today);
  const plan = docs.plan;
  if (!plan) return { plan: null };
  const head = headAdopted(docs.versions);
  return {
    plan: {
      id: plan.id,
      name: plan.name,
      rung: plan.rung,
      status: plan.status,
      startDate: plan.startDate,
      plannedEndDate: plan.plannedEndDate,
      day: planDay(plan, ctx.today) + 1,
      of: planLength(plan),
      headVersion: head?.version ?? null,
      intentions: plan.intentions,
      policy: plan.policy,
      pauses: plan.pauses,
      ended: plan.ended ?? null,
      experimentalTracking: plan.request.constraints?.experimentalTracking === true,
      planningLimits: plan.request.constraints ?? {},
    },
    experimentalWarnings: head?.experimentalWarnings ?? [],
    today: projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true }).today
      .prescription,
  };
});

implement('plan.versions', async (ctx, input: { planId?: string }) => {
  const docs = await readDocs(ctx.today);
  const store = getDocumentStore();
  const pid = input.planId ?? docs.plan?.id;
  const versions = pid
    ? store
        .peekAll<PlanVersionDoc>('planVersions')
        .map((d) => bodyOf<PlanVersionDoc>(d))
        .filter((v) => v.planId === pid)
    : [];
  return versions
    .sort((a, b) => a.version - b.version)
    .map((v) => ({
      version: v.version,
      parent: v.parent,
      status: v.status,
      reason: v.reason,
      effectiveFromDay: v.effectiveFromDay,
      createdAt: v.createdAt,
      explanation: v.explanation,
      diff: v.diff ?? [],
    }));
});

implement('plan.adherence', async (ctx, input: { from?: string; to?: string }) => {
  const docs = await readDocs(ctx.today);
  const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const days = p.days.filter(
    (d) => (!input.from || d.date >= input.from) && (!input.to || d.date <= input.to),
  );
  return {
    days: days.map((d) => ({
      date: d.date,
      score: d.result.score.score,
      coverage: d.result.score.coverage,
      final: d.result.score.final,
    })),
    trend: p.trend,
    blocks: p.blocks,
  };
});

implement('plan.drift', async (ctx) => {
  const docs = await readDocs(ctx.today);
  return (
    projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now }).drift ?? {
      asOf: ctx.today,
      goals: [],
    }
  );
});

implement('log.get', async (ctx, input: { from: string; to: string; kinds?: string[] }) => {
  const docs = await readDocs(ctx.today);
  const inRange = (e: { date: string; kind: string }) =>
    e.date >= input.from && e.date <= input.to && (!input.kinds || input.kinds.includes(e.kind));
  const entries = projectEntries(docs.entries).filter(inRange);
  const measurements = projectEntries(docs.measurements)
    .map((m) => ({ ...m, kind: 'measurement' as const }))
    .filter(inRange);
  return [...entries, ...measurements].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (a.at ?? '').localeCompare(b.at ?? '') || a.id.localeCompare(b.id),
  );
});

// ------------------------------------------------------------------------------------------- lifecycle safety (C5)
/** What a lifecycle boundary decided (C5/A1-001): the gate's result plus the authoritative activation decision. */
export interface LifecycleCheck extends LifecycleSafetyResult {
  /**
   * The planner's authoritative, scope-aware startability for exactly this subject under the current clinical facts: the
   * only permission to activate (an Unchecked label never is). False whenever `blocked`.
   */
  startable: boolean;
  /** The certificate that authorizes the activation: the stored one, or the one declared final audit's of this episode. */
  certificate: SafetyCertificate | null;
  /** The one declared final audit of this decision episode ran (its certificate kept even when it did not pass). */
  audited?: { certificate: SafetyCertificate | null };
  /** (A1-002) Whether the current clinical facts (screening input, marker evaluation) could be read at this boundary. */
  coverage: 'current' | 'unchecked';
  experimentalWarnings?: string[];
}

/**
 * Fresh safety evaluation at a lifecycle boundary (start, scenario start, adopt, resume, re-plan; C5/D4-01/D4-03): the
 * CURRENT profile safety with the symptoms the person logged, the CURRENT clinical safety input (`currentSafetyRequest`:
 * screening locks and the marker evaluation now, never a mounted Planner or a goal), the stored certificate and the
 * planner's revalidation of exactly this subject with the current history and audit-state hashes. Activation needs the
 * planner's authoritative `startable` (A1-001): an absent or failed revalidation, a mandatory bound without a resolved
 * channel, missing current facts or a certificate that does not bind this subject never authorize. When the checks pass
 * but no current certificate binds the subject, ONE declared final audit of exactly this subject may run (the injected
 * `audit` port; never after a failed audit, never retried), retaining the source certificate as history. Logging,
 * monitoring, inspection and simulation never depend on this.
 */
export async function lifecycleCheck(
  ctx: CommandContext,
  docs: LivingDocs,
  i: {
    boundary: LifecycleBoundary;
    request: PlannerRequestV2;
    schedule: Schedule;
    fromDay: number;
    certificate?: SafetyCertificate | null;
    /** The source certificate a changed subject came from (provenance; kept in a final audit's history). */
    source?: SafetyCertificate | null;
    historyHash?: string;
    /** (A1-012) The CURRENT audit initial-state/controller hash; absent = not available (a state-bound certificate then fails). */
    stateHash?: string;
    from?: LifecycleSubject;
    /** (C5) The confirmed state a later day's subject runs from (`confirmedReplanRequest`): the revalidation simulates from it. */
    confirmed?: ReplanRequest;
  },
): Promise<LifecycleCheck> {
  const entries = projectEntries(docs.entries);
  const current = simulatorProfileNow(ctx.now);
  // one rule for the current safety at every boundary and in the re-plan request (C5/D4-02): the current screening, the
  // structured facts it does not express kept as stored, the logged symptoms last
  const safety = currentProfileSafety(i.request.profile.safety, current.safety, entries);
  const now: PersonProfile = { ...current, ...(safety ? { safety } : {}) };
  const withProfile: PlannerRequestV2 = {
    ...i.request,
    profile: { ...i.request.profile, ...(safety ? { safety } : {}) },
  };
  // (A1-002) the current clinical safety input (screening locks with explicit bounds, marker locks/flags, kidney findings)
  const cs = currentSafetyRequest(ctx, withProfile);
  const request = cs.request;
  const experimentalTracking = request.constraints?.experimentalTracking === true;
  const port = ctx.ports.living?.revalidate;
  const revalidate = async (certificate: SafetyCertificate | null): Promise<LifecycleRevalidation | null> => {
    if (!port) return null;
    // built as a value: the port's input grows additively (the CURRENT audit-state hash, A1-012)
    const input = {
      boundary: i.boundary,
      request,
      schedule: i.schedule,
      ...(certificate ? { certificate } : {}),
      ...(i.historyHash ? { historyHash: i.historyHash } : {}),
      ...(i.stateHash ? { stateHash: i.stateHash } : {}),
      ...(i.from ? { from: i.from } : {}),
      ...(i.confirmed ? { confirmed: i.confirmed } : {}),
    };
    try {
      return await port(input);
    } catch {
      return null; // the planner could not run: nothing authorizes the prescription
    }
  };
  let certificate = i.certificate ?? null;
  let revalidation = await revalidate(certificate);
  let audited: LifecycleCheck['audited'];
  // (A1-001/A1-004) the checks pass but no current certificate binds this exact subject: one declared final audit
  const auditPort = ctx.ports.living?.audit;
  const source = i.source ?? i.certificate ?? null;
  if (
    revalidation &&
    !experimentalTracking &&
    !revalidationStartable(revalidation) &&
    revalidation.reasonCode === 'certificateRequired' &&
    cs.status === 'current' &&
    auditPort &&
    finalAuditAllowed(source)
  ) {
    let fresh: SafetyCertificate | null;
    try {
      fresh = await auditPort({
        boundary: i.boundary,
        request,
        schedule: i.schedule,
        ...(source ? { source } : {}),
        ...(i.historyHash ? { historyHash: i.historyHash } : {}),
        ...(i.stateHash ? { stateHash: i.stateHash } : {}),
        ...(i.from ? { from: i.from } : {}),
        ...(i.confirmed ? { confirmed: i.confirmed } : {}),
        // the episode is the subject itself: the same subject reproduces the same declared draws (never reseeded until a pass)
        episodeId: `lifecycle:${i.boundary}:${contentHash({ request, schedule: i.schedule, historyHash: i.historyHash ?? null, stateHash: i.stateHash ?? null, from: i.from ?? null })}`,
        createdAt: ctx.now,
      });
    } catch {
      fresh = null;
    }
    audited = { certificate: fresh };
    if (fresh) {
      certificate = fresh;
      revalidation = await revalidate(fresh);
    }
  }
  const gate = lifecycleSafetyGate({
    boundary: i.boundary,
    schedule: i.schedule,
    fromDay: i.fromDay,
    profile: now,
    entries,
    certificate,
    revalidation,
    today: ctx.today,
    now: ctx.now,
    experimentalTracking,
  });
  const reasons = [...gate.reasons];
  // (A1-002) required current clinical facts that could not be read: Unchecked and not startable (never an older input)
  if (cs.status !== 'current')
    reasons.push({
      code: 'currentSafetyUnavailable',
      text: `Unchecked: current ${cs.missing.join(' and ')} could not be read.`,
    });
  const startable = !gate.blocked && cs.status === 'current' && (revalidationStartable(revalidation) || (experimentalTracking && revalidation?.experimentalTracking?.startable === true));
  if (!startable && reasons.length === 0)
    reasons.push({
      code: 'notStartable',
      text: 'Unchecked: this exact plan needs its safety check run first.',
    });
  const status: LifecycleSafetyResult['status'] = startable
    ? gate.status
    : gate.status === 'verified'
      ? 'unchecked'
      : gate.status;
  return {
    ...gate,
    status,
    blocked: !startable,
    reasons,
    startable,
    certificate: experimentalTracking ? null : certificate,
    ...(experimentalTracking && revalidation?.experimentalTracking ? { experimentalWarnings: revalidation.experimentalTracking.warnings } : {}),
    ...(audited ? { audited } : {}),
    coverage: cs.status,
  };
}

/**
 * (A1-002) The request with the CURRENT clinical safety applied at a boundary, headless: the shared composer
 * (`withCurrentSafety`) over the current screening input, the stored request's explicit clinician/user/import bounds and
 * the marker evaluation read now under the Planner's own rule context at the current app day (`markerRuleContext`), its
 * kidney findings and blocking re-asks — no goal, no mounted Planner and no prepared request are needed for the clinical
 * locks. The screening input is the Planner port's composed current input, else the same screening input built headlessly
 * from the stored screening and intake (`plannerSafetyInputNow`); when the person's current screening input cannot be read
 * here the boundary is Unchecked (`status: 'unchecked'`, not startable) while the current marker locks still
 * join the evaluation, never an older clinical input standing in for the current one.
 */
export function currentSafetyRequest<R extends PlannerRequestV2>(
  ctx: CommandContext,
  request: R,
): { request: R; status: 'current' | 'unchecked'; missing: Array<'screening' | 'markers'> } {
  const result = composeCurrentSafetyRequest(ctx, request);
  const flags = result.request.profile.safety?.flags;
  if (!flags) return result;
  // A fresh certificate cannot restore guidance made obsolete by a dated clinical context change.
  const day = request.startDate && request.startDate > ctx.today ? request.startDate : ctx.today;
  const scope = resolveClinicalNutritionScope(flags, day, result.request.profile.body.weightKg);
  return {
    ...result,
    request: {
      ...result.request,
      profile: {
        ...result.request.profile,
        safety: { ...result.request.profile.safety, flags: { ...flags, ...renalSafetyFlags(scope) } },
      },
    },
  };
}

function composeCurrentSafetyRequest<R extends PlannerRequestV2>(
  ctx: CommandContext,
  request: R,
): { request: R; status: 'current' | 'unchecked'; missing: Array<'screening' | 'markers'> } {
  let markers: ReturnType<typeof evaluateMarkers> | null;
  let markersDoc: ReturnType<typeof readMarkersDoc> | null = null;
  try {
    markersDoc = readMarkersDoc();
    const rules = markerRuleContext(
      {
        profile: simulatorProfileNow(ctx.now),
        flags: safetyAccessNow(ctx.now).outcome.flags,
        ...readMarkerContextSources(),
      },
      ctx.today,
    );
    markers = evaluateMarkers(markersDoc, rules);
  } catch {
    markers = null;
  }
  // the Planner's published composed input; without one, the same screening input composed headlessly (A1-002: no mounted
  // Planner or goal is needed for the current clinical limits)
  const published = currentPlannerSafetyInput(ctx) ?? headlessScreeningInput(ctx, markers);
  const answeredOn = (() => {
    try {
      return screeningAnsweredOn(safetyValues().answeredAt);
    } catch {
      return {};
    }
  })();
  if (published && markers) {
    // the Planner's composed current input stands as is when it already carries every current marker lock and the stored
    // explicit bounds (an identical composition keeps an identical certificate fingerprint); otherwise it is composed again
    if (
      carriesAll(published, markers.safety.plannerLocks) &&
      carriesAll(published, explicitStoredBounds(request.safety))
    )
      return { request: { ...request, safety: published }, status: 'current', missing: [] };
    const r = withCurrentSafety(request, {
      screening: published,
      markers,
      markersDoc,
      today: ctx.today,
      stored: request.safety ?? null,
      answeredOn,
    });
    if (r.status === 'current') return { request: r.request, status: 'current', missing: [] };
  }
  const missing: Array<'screening' | 'markers'> = [
    ...(published ? [] : ['screening' as const]),
    ...(markers ? [] : ['markers' as const]),
  ];
  // the current marker locks still join the evaluation (a known violation is shown as such), but nothing is startable
  const req = markers
    ? withMarkerSafety(
        request,
        markers,
        markersDoc ? markerRenalFindings(markersDoc, markers, ctx.today) : undefined,
      )
    : request;
  return { request: req, status: 'unchecked', missing };
}

/** (A1-002) The Planner's screening input built headlessly from the stored screening, intake and markers; undefined when unreadable. */
function headlessScreeningInput(
  ctx: CommandContext,
  markers: ReturnType<typeof evaluateMarkers> | null,
): PlannerRequestV2['safety'] | undefined {
  try {
    const policyMarkers = markers
      ? {
          flags: [...markers.safety.flags],
          noSuggest: (markers.noSuggest ?? []).map((n) => ({
            rule: n.rule,
            markerId: n.markerId,
            subject: n.subject,
            sampleDate: n.sampleDate,
            stale: n.stale,
            applicability: n.applicability,
          })),
        }
      : null;
    return plannerSafetyInputNow(ctx.now, policyMarkers);
  } catch {
    return undefined;
  }
}

type SafetyLock = NonNullable<NonNullable<PlannerRequestV2['safety']>['plannerLocks']>[number];
const EXPLICIT_SOURCES: ReadonlySet<string> = new Set(['clinician', 'user', 'import']);
/** The stored input's explicit clinician/user/import bounds (they are not part of the screening encoding). */
function explicitStoredBounds(s: PlannerRequestV2['safety'] | undefined): SafetyLock[] {
  return (s?.plannerLocks ?? []).filter((l) => l.source !== undefined && EXPLICIT_SOURCES.has(l.source));
}
/** Whether an input already carries every given lock (same id, the same or a stricter value). */
function carriesAll(input: NonNullable<PlannerRequestV2['safety']>, locks: readonly SafetyLock[]): boolean {
  return locks.every((l) =>
    (input.plannerLocks ?? []).some(
      (x) =>
        x.id === l.id &&
        (l.value === undefined ||
          (x.value !== undefined && (/-floor$|^min-/.test(l.id) ? x.value >= l.value : x.value <= l.value))),
    ),
  );
}

/**
 * (C5/D4-01) The Planner port's composed CURRENT safety input (screening locks with units, opt-ins, marker locks and flags
 * under its own rule context), when the port can build one; undefined otherwise.
 */
export function currentPlannerSafetyInput(ctx: CommandContext): PlannerRequestV2['safety'] | undefined {
  try {
    return (ctx.ports.planner?.prepare()?.request as PlannerRequestV2 | undefined)?.safety;
  } catch {
    return undefined;
  }
}

/** (C2/C5) The CURRENT realised history hash of the documents: a certificate bound to another history is not valid. */
export function currentHistoryHash(ctx: CommandContext, docs: LivingDocs): string | undefined {
  return projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true }).history
    ?.contentHash;
}

/**
 * (A1-012) The confirmed state the living assimilation holds now (what a re-plan from today replays from): the latest
 * confirmed record's state rebuilt on the shared realised schedule, else the plan start's. Null when it cannot be built.
 */
export function currentConfirmedState(
  docs: LivingDocs,
  plan: WithId<PlanDoc>,
  head: PlanVersionDoc,
  p: LivingProjection,
  today: LocalDate,
): ConfirmedState | null {
  try {
    const latest = [...docs.records].sort((a, b) => a.anchorDay - b.anchorDay).pop();
    if (latest) {
      const schedule = projectionSchedule(p, today);
      if (!schedule) return null;
      // (A1-017) the CURRENT anchors: a stored anchor whose evidence was retracted or corrected since, or that was derived
      // under another estimator, is refit from the current graph (the records and their applied corrections stay)
      const measurements = projectEntries(docs.measurements);
      const current = currentAnchors({
        plan,
        schedule,
        records: docs.records,
        weighIns: weighInsFor(plan, measurements, projectEntries(docs.entries), blockStartsOf(head.schedule)),
        composition: compositionReadingsFor(plan, measurements) ?? null,
        ...(docs.derivedAnchors?.length ? { derived: docs.derivedAnchors } : {}),
      });
      return confirmedStateFromRecord(plan, schedule, docs.records, latest, current);
    }
    const r = runReplay({
      profile: plan.baselineProfile,
      schedule: head.schedule,
      captureAt: [0],
      record: 'none',
    });
    const snapshot = r.snapshots[0];
    return snapshot
      ? {
          anchorDate: plan.startDate,
          snapshot,
          energyBiasKcal: { mean: 0, sd: BIAS_PRIOR_SD_KCAL },
          trendWeight: { kg: plan.baselineProfile.body.weightKg, sd: 0.5 },
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * (A1-012) The CURRENT audit initial-state/controller hash (`auditStateHash`: anchor, full snapshot content, particles,
 * energy-bias correction with its law, trend) of the confirmed state the documents imply now; undefined when that state
 * cannot be built (a state-bound certificate is then not valid). Never a certificate's own stored value.
 */
export async function currentStateHash(
  ctx: Pick<CommandContext, 'today' | 'tz' | 'now'>,
  docs: LivingDocs,
  plan: WithId<PlanDoc>,
  head: PlanVersionDoc,
): Promise<string | undefined> {
  const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const state = currentConfirmedState(docs, plan, head, p, ctx.today);
  if (!state) return undefined;
  const { auditStateHash } = await import('@/engine/planner/domain/safetyAudit');
  return auditStateHash({
    anchorDate: state.anchorDate,
    anchorDay: daysBetween(plan.startDate, state.anchorDate),
    snapshot: state.snapshot,
    ...(state.particles ? { particles: state.particles } : {}),
    energyBiasKcal: state.energyBiasKcal,
    trendWeight: state.trendWeight,
  });
}

/**
 * (C5) The confirmed state a later day's subject runs from, as the re-plan request of now (`runReplan` builds the same):
 * the current confirmed state (`currentConfirmedState`, the one `currentStateHash` hashes), every day logged since its
 * anchor and the shared realised history. A lifecycle revalidation simulates the schedule from it, so adopting a re-plan
 * or resuming a paused plan checks the trace-based constraints (the deficit cap) as the re-plan's certification did.
 * Undefined when the state cannot be built (those constraints then stay Unchecked).
 */
export function confirmedReplanRequest(
  ctx: Pick<CommandContext, 'today' | 'tz' | 'now'>,
  docs: LivingDocs,
  plan: WithId<PlanDoc>,
  head: PlanVersionDoc,
): ReplanRequest | undefined {
  try {
    const today = ctx.today < plan.startDate ? plan.startDate : ctx.today;
    const p = projectLiving({ docs, today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
    const state = currentConfirmedState(docs, plan, head, p, today);
    if (!state) return undefined;
    const realised = projectionSchedule(p, today);
    const base = buildReplanRequest({
      decision: { kind: 'event', trigger: 'user', reason: 'lifecycle revalidation' },
      today,
      plan,
      head,
      state,
      logs: p.days.filter((d) => d.date < today).map((d) => d.result.loggedDay),
      adherence: p.blocks,
    });
    return { ...base, ...(realised ? { realisedSchedule: realised } : {}) };
  } catch {
    return undefined;
  }
}

/** Prior SD of the energy-balance bias before the first check-in (R11 δ prior, `biasPriorSdKcal`). */
export const BIAS_PRIOR_SD_KCAL = 150;

const SAFE_ALTERNATIVES: Partial<Record<LifecycleBoundary, string[]>> = {
  start: ['planner.find'],
  scenarioStart: ['planner.find'],
  adopt: ['plan.rejectVersion', 'plan.replan'],
  resume: ['plan.end'],
  replan: ['plan.rejectVersion'],
};

/** Refuse a blocked boundary with its first reason (`safety_blocked`; logging stays available). */
export function requireSafe(r: LifecycleSafetyResult): void {
  if (r.blocked)
    fail('safety_blocked', r.reasons[0]?.text ?? 'Safety needs review first.', {
      rule: `lifecycle:${r.reasons[0]?.code ?? r.status}`,
      reason: r.status,
      allowedAlternatives: SAFE_ALTERNATIVES[r.boundary] ?? [],
    });
}

// ------------------------------------------------------------------------------------------- plan lifecycle
interface StartIn {
  source: { rung: string } | { scenarioId: string };
  startDate: string;
  name?: string;
  enforceDefaultDeficitCap?: boolean;
  experimentalTracking?: boolean;
  intentions?: PlanDoc['intentions'];
  checkInWeekday?: Weekday;
}

/**
 * Build the start documents and check them (`plan.start`, `plan.replace`). Nothing is written: everything that can refuse
 * runs before the first write (the bus keeps what a failed command already wrote).
 */
async function prepareStart(
  ctx: CommandContext,
  input: StartIn,
): Promise<{ ok: Extract<StartOutcome, { ok: true }>; safetyStatus: LifecycleSafetyResult['status']; experimentalWarnings?: string[] }> {
  if (input.experimentalTracking && !('scenarioId' in input.source))
    fail('invalid_input', 'Experimental tracking starts from an explicitly selected Simulator scenario.');
  const sctx = {
    planId: ctx.newId(),
    now: ctx.now,
    today: ctx.today,
    createdBy: actorOf(ctx),
    versions: { engineVersion: '', registryHash: '', catalogueVersion: '' },
  };
  const common = {
    startDate: input.startDate,
    ...(input.enforceDefaultDeficitCap !== undefined ? { enforceDefaultDeficitCap: input.enforceDefaultDeficitCap } : {}),
    ...(input.experimentalTracking ? { experimentalTracking: true } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.intentions ? { intentions: input.intentions } : {}),
    ...(input.checkInWeekday !== undefined ? { checkInWeekday: input.checkInWeekday } : {}),
  };
  let out: StartOutcome;
  if ('rung' in input.source) {
    const run = planner.runState();
    const res = run.result;
    const req = run.request;
    if (!res || !req) fail('not_found', 'Find plans in the Planner first.');
    const key = input.source.rung;
    const optionId = key === 'A' || key === 'B' || key === 'C' ? key : OPTION_OF_RUNG[key as RungId];
    if (!optionId) fail('invalid_input', 'The rung is hard, medium or easy.');
    const option =
      res!.options.find((o) => o.id === optionId) ??
      fail('not_found', 'That plan is not in the current Planner result.');
    const meta = option.simulation?.meta;
    const versions = {
      ...sctx.versions,
      ...(meta ? { engineVersion: meta.engineVersion, registryHash: meta.registryHash } : {}),
    };
    out = startFromRung(
      { ...sctx, versions },
      option,
      req!,
      RUNG_OF_OPTION[option.id],
      res!.provenance as PlannerProvenanceV2,
      common,
    );
  } else {
    const sc = sched.scenarioById(input.source.scenarioId) ?? fail('not_found', 'There is no such scenario.');
    const { explicitPracticalConstraints } = await import('@/features/planner/request');
    // the goal set as the last Planner run saw it (ranked goals); a scenario without a run starts without goals
    const goals = planner.runState().request?.goals ?? [];
    out = startFromScenario(
      sctx,
      { id: sc.id, rev: sc.updatedAt, name: sc.name, schedule: sc.schedule },
      simulatorProfileNow(ctx.now),
      goals,
      { ...common, constraints: explicitPracticalConstraints(planner.goalSet().constraints) },
    );
  }
  if (!out.ok) fail('invalid_input', out.reason);
  const ok = out as Extract<StartOutcome, { ok: true }>;
  // (C5/A1-004) the FINAL prescription is checked afresh now, before any write: exactly the stored request (chosen and
  // profile start date) and the anchored schedule. A source certificate authorizes only when anchoring left its subject
  // unchanged; otherwise it is provenance (kept in the history of the one declared final audit, when that can run). A
  // run's or a stored proposal's result never authorizes by itself; a custom scenario that breaks a rule stays a simulation
  const docs = await readDocs(ctx.today);
  const subject = ok.subject ?? { request: ok.plan.request, schedule: ok.version.schedule };
  const safety = await lifecycleCheck(ctx, docs, {
    boundary: 'rung' in input.source ? 'start' : 'scenarioStart',
    request: subject.request,
    schedule: subject.schedule,
    fromDay: 0,
    certificate: ok.version.certificate ?? null,
    source: ok.sourceCertificate ?? ok.version.certificate ?? null,
  });
  requireSafe(safety);
  // the certificate stored is exactly the one that authorized this subject (the stored one, or the final audit's)
  const { certificate: _source, ...version } = ok.version;
  void _source;
  return {
    ok: {
      ...ok,
      version: { ...version, ...(safety.certificate ? { certificate: safety.certificate } : {}) },
    },
    safetyStatus: safety.status,
    ...(safety.experimentalWarnings ? { experimentalWarnings: safety.experimentalWarnings } : {}),
  };
}

/** Write prepared start documents. */
async function writeStart(
  ctx: CommandContext,
  p: Awaited<ReturnType<typeof prepareStart>>,
): Promise<{ planId: string; version: 1; anchorNotes: string[] }> {
  const { ok } = p;
  await savePlan(ctx, ok.plan);
  await ctx.docs.append('planVersions', {
    ...ok.version,
    safetyStatus: p.safetyStatus,
    ...(p.experimentalWarnings ? { experimentalWarnings: p.experimentalWarnings } : {}),
    _id: `${ok.plan.id}:v1`,
  });
  await ctx.docs.put('activePlan', { _id: 'me', planId: ok.plan.id, since: ok.plan.startDate });
  return { planId: ok.plan.id, version: 1, anchorNotes: ok.anchorNotes };
}

implement('plan.start', async (ctx, input: StartIn) => {
  const docs = await readDocs(ctx.today);
  if (docs.plan && isLive(docs.plan))
    fail('precondition_failed', 'A plan is already running; end or replace it first.', {
      precondition: 'noActivePlan',
    });
  return writeStart(ctx, await prepareStart(ctx, input));
});

implement('plan.replace', async (ctx, input: StartIn & { reason: 'replaced' }) => {
  const docs = await readDocs(ctx.today);
  const plan = requirePlan(docs);
  const t = endPlan(plan, ctx.now, ctx.today, 'replaced');
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  const { reason: _reason, ...start } = input;
  void _reason;
  // the new plan is built and checked first: a refused start never leaves the running plan ended
  const prepared = await prepareStart(ctx, start);
  await savePlan(ctx, { ...t.plan, id: plan.id });
  return { ...(await writeStart(ctx, prepared)), replaced: plan.id };
});

implement('plan.discard', async (ctx, input: { planId: string }) => {
  const docs = await readDocs(ctx.today);
  const plan = docs.plans.find((p) => p.id === input.planId) ?? fail('not_found', 'There is no such plan.');
  const hasLogs = effectiveEntries(docs.entries).some((e) => e.planId === plan.id && !e.assumed);
  const can = canDiscard(plan, ctx.now, hasLogs);
  if (!can.ok) fail('conflict', can.reason ?? 'The plan cannot be discarded.');
  await ctx.docs.remove('plans', plan.id);
  for (const v of docs.versions) await ctx.docs.remove('planVersions', `${plan.id}:v${v.version}`);
  await ctx.docs.put('activePlan', { _id: 'me', planId: null, since: ctx.today });
  return { discarded: true };
});

implement('plan.pause', async (ctx, input: { from?: string; reason?: string }) => {
  const docs = await readDocs(ctx.today);
  const plan = requirePlan(docs);
  const t = pausePlan(plan, input.from ?? ctx.today, input.reason);
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  await savePlan(ctx, { ...t.plan, id: plan.id });
  return { plan: { ...t.plan, id: plan.id }, notes: t.notes };
});

implement('plan.resume', async (ctx, input: { from?: string }) => {
  const docs = await readDocs(ctx.today);
  const plan = requirePlan(docs);
  const t = resumePlan(plan, input.from ?? ctx.today, ctx.actor.kind === 'user' ? 'user' : 'ai');
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  const head = headAdopted(docs.versions) ?? fail('internal', 'The plan has no adopted version.');
  const shifted = !!t.shift && t.shift.R > t.shift.P;
  const resumed = shifted ? resumeSchedule(head.schedule, t.shift!.P, t.shift!.R).schedule : head.schedule;
  // (C5) a shifted schedule was never audited (no certificate applies); an unshifted one keeps its certificate, checked
  // against the current history and safety
  const subject = shifted ? undefined : certificateSubjectOf(plan, head);
  const historyHash = currentHistoryHash(ctx, docs);
  // (A1-012) the current confirmed state/controller the prescription would continue from
  const stateHash = await currentStateHash(ctx, docs, plan, head);
  // (C5) the confirmed state the resumed prescription continues from: the revalidation simulates from it
  const confirmed = confirmedReplanRequest(ctx, docs, plan, head);
  const safety = await lifecycleCheck(ctx, docs, {
    boundary: 'resume',
    request: plan.request,
    schedule: resumed,
    fromDay: Math.max(0, planDay(plan, input.from ?? ctx.today)),
    certificate: shifted ? null : (head.certificate ?? null),
    source: head.certificate ?? null,
    ...(historyHash ? { historyHash } : {}),
    ...(stateHash ? { stateHash } : {}),
    // the certificate's own subject; without one (a start certificate, a shifted schedule) the prescription from today,
    // as a confirmed-state audit certifies it
    ...(subject
      ? { from: subject }
      : confirmed && stateHash
        ? { from: { planStart: plan.startDate, date: confirmed.today } }
        : {}),
    ...(confirmed ? { confirmed } : {}),
  });
  requireSafe(safety);
  let version: number = head.version;
  if (shifted) {
    version = nextVersionNumber(plan);
    const { certificate: _stale, ...rest } = head;
    void _stale;
    // a shifted schedule carries only a certificate a declared final audit issued for it in this episode
    const v: PlanVersionDoc = {
      ...rest,
      version,
      parent: head.version,
      status: 'adopted',
      reason: 'resume',
      effectiveFromDay: t.shift!.R,
      schedule: resumed,
      diff: [],
      explanation: t.notes,
      createdBy: actorOf(ctx),
      createdAt: ctx.now,
      safetyStatus: safety.status,
      ...(safety.experimentalWarnings ? { experimentalWarnings: safety.experimentalWarnings } : {}),
      ...(safety.audited?.certificate && safety.certificate === safety.audited.certificate
        ? { certificate: safety.certificate }
        : {}),
    };
    await ctx.docs.append('planVersions', { ...v, _id: `${plan.id}:v${version}` });
  }
  const next = { ...t.plan, headVersion: version, id: plan.id };
  await savePlan(ctx, next);
  return { plan: next, notes: t.notes };
});

implement('plan.end', async (ctx, input: { reason: EndReason; note?: string }) => {
  const docs = await readDocs(ctx.today);
  const plan = requirePlan(docs);
  const t = endPlan(plan, ctx.now, ctx.today, input.reason, input.note);
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  await savePlan(ctx, { ...t.plan, id: plan.id });
  await ctx.docs.put('activePlan', { _id: 'me', planId: null, since: ctx.today });
  return { plan: { ...t.plan, id: plan.id } };
});

/**
 * The number a new version of `plan` takes: past every version id ever written for it. An undone version leaves a
 * tombstone and append never reuses an id, so `headVersion + 1` collided after an Undo (Q4: "v3 already exists").
 */
export function nextVersionNumber(plan: { id: string; headVersion: number }): number {
  let max = plan.headVersion;
  for (const d of getDocumentStore().peekAll<PlanVersionDoc>('planVersions', { includeDeleted: true })) {
    const m = d._id.startsWith(`${plan.id}:v`) ? /:v(\d+)$/.exec(d._id) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function setVersionStatus(
  ctx: CommandContext,
  input: { planId: string; version: number },
  status: 'adopted' | 'rejected',
): Promise<unknown> {
  const docs = await readDocs(ctx.today);
  const plan = docs.plans.find((p) => p.id === input.planId) ?? fail('not_found', 'There is no such plan.');
  const store = getDocumentStore();
  const v =
    store
      .peekAll<PlanVersionDoc>('planVersions')
      .map((d) => bodyOf<PlanVersionDoc>(d))
      .find((x) => x.planId === plan.id && x.version === input.version) ??
    fail('not_found', 'There is no such version.');
  if (v.status !== 'proposed') fail('conflict', 'Only a proposed version can be adopted or rejected.');
  if (
    store.peekAll<PlanVersionDoc>('planVersions').some((d) => {
      const x = bodyOf<PlanVersionDoc>(d);
      return x.planId === plan.id && x.parent === v.version && x.status !== 'proposed';
    })
  )
    fail('conflict', 'That change was already applied or discarded.');
  // (C5) adopting re-reads current safety: a proposal made before a symptom or a safety change is checked afresh
  let safetyStatus = v.safetyStatus;
  let adoptedCertificate: SafetyCertificate | null = null;
  let experimentalWarnings = v.experimentalWarnings;
  if (status === 'adopted') {
    // the certificate is checked on its own subject against the CURRENT history (a day lived since, or an edited past
    // day, means the proposal was certified for another history: at most Unchecked until a fresh audit)
    const historyHash = docs.plan?.id === plan.id ? currentHistoryHash(ctx, docs) : undefined;
    // (A1-012) the current confirmed state/controller the proposal would run from (a state-bound certificate needs it)
    const head = headAdopted(docs.versions);
    const stateHash =
      docs.plan?.id === plan.id && head ? await currentStateHash(ctx, docs, plan, head) : undefined;
    const subject = certificateSubjectOf(plan, v);
    // (C5) the confirmed state the proposal would run from: the revalidation simulates from it
    const confirmed =
      docs.plan?.id === plan.id && head ? confirmedReplanRequest(ctx, docs, plan, head) : undefined;
    const r = await lifecycleCheck(ctx, docs, {
      boundary: 'adopt',
      request: plan.request,
      schedule: v.schedule,
      fromDay: Math.max(v.effectiveFromDay, planDay(plan, ctx.today)),
      certificate: v.certificate ?? null,
      ...(historyHash ? { historyHash } : {}),
      ...(stateHash ? { stateHash } : {}),
      ...(subject
        ? { from: subject }
        : confirmed && stateHash
          ? { from: { planStart: plan.startDate, date: confirmed.today } }
          : {}),
      ...(confirmed ? { confirmed } : {}),
    });
    requireSafe(r);
    safetyStatus = r.status;
    adoptedCertificate = r.certificate;
    experimentalWarnings = r.experimentalWarnings;
  }
  // planVersions are immutable: the decision is a new version document carrying the same content (and the certificate
  // that authorized it: the proposal's, or the one declared final audit's of this adoption)
  const n = nextVersionNumber(plan);
  const decided: PlanVersionDoc = {
    ...v,
    version: n,
    parent: v.version,
    status,
    createdBy: actorOf(ctx),
    createdAt: ctx.now,
    ...(safetyStatus ? { safetyStatus } : {}),
    ...(experimentalWarnings ? { experimentalWarnings } : {}),
    ...(adoptedCertificate ? { certificate: adoptedCertificate } : {}),
  };
  await ctx.docs.append('planVersions', { ...decided, _id: `${plan.id}:v${n}` });
  await savePlan(ctx, {
    ...plan,
    headVersion: n,
    ...(status === 'adopted' && v.plannedEndDate ? { plannedEndDate: v.plannedEndDate } : {}),
  });
  return { planId: plan.id, version: n, status };
}
implement('plan.adoptVersion', (ctx, input: { planId: string; version: number }) =>
  setVersionStatus(ctx, input, 'adopted'),
);
implement('plan.rejectVersion', (ctx, input: { planId: string; version: number }) =>
  setVersionStatus(ctx, input, 'rejected'),
);

/** What a confirmed check-in returns (and what a retry of the same decision point returns again). */
export interface CheckInOutput {
  verdict: string;
  weighIns7: number;
  weighIns14: number;
  trend: unknown;
  energyBias: {
    mean: number;
    sd: number;
    updated: boolean;
    requested?: number;
    saturated?: boolean;
    stepLimited?: boolean;
  };
  residualSplit: unknown;
  composition: { status: unknown; consumed: unknown; skipped: unknown } | null;
  intakeEvidence: unknown;
  anchors: number;
  blocks: unknown;
  /** (D5-06) The decision recorded: its id, key and review state; `alreadyConfirmed` on a retry of the same decision point. */
  decision: {
    id: string;
    key: string;
    status: 'confirmed';
    anchored: boolean;
    review: StoredCheckInDecision['review'] | null;
    proposalVersion: number | null;
    alreadyConfirmed: boolean;
  };
}

/** A prepared confirmation: nothing is written until `writeCheckIn` (everything that can refuse has run). */
export interface PreparedCheckIn {
  output: CheckInOutput;
  /** False on a retry of an already confirmed decision point (nothing to write, no new proposal). */
  fresh: boolean;
  plan: WithId<PlanDoc>;
  head: PlanVersionDoc;
  /** The confirmed-state record of this decision (null when the estimate could not be anchored). */
  record: ConfirmedStateRecord | null;
  decision: StoredCheckInDecision;
  /** The documents with this decision's record added (what a weekly re-plan from this check-in reads). */
  docsAfter: LivingDocs;
}

/**
 * (D5-06) The explicit check-in, prepared: the stored decision of today is returned unchanged on a retry (another device, a
 * replay, a double tap: one decision, one anchor, one correction step); otherwise the weekly estimate runs on the shared
 * realised history with the composition readings and the window's intake evidence, and a disturbance makes it a Review
 * (no forced tissue anchor). `previewId` names the preview the person saw: evidence that changed since is refused.
 */
export async function prepareCheckIn(
  ctx: CommandContext,
  docs: LivingDocs,
  input: { previewId?: string } = {},
  mode: 'explicit' | 'optIn' = 'explicit',
): Promise<PreparedCheckIn> {
  const plan = requirePlan(docs);
  const head = headAdopted(docs.versions) ?? fail('internal', 'The plan has no adopted version.');
  const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const measurements = projectEntries(docs.measurements);
  const entries = projectEntries(docs.entries);
  const pending =
    pendingCheckInOf({ docs, projection: p, today: ctx.today }) ??
    fail('internal', 'The check-in could not be prepared.');
  const { evidence, review } = pending;
  const stored = storedDecisionOn(
    plan.id,
    ctx.today,
    docs.records,
    (docs.decisions ?? []) as readonly StoredCheckInDecision[],
  );
  const blocks = p.blocks;
  if (stored) {
    // a retry of a confirmed decision point answers again from what was stored (records are immutable; hysteresis and the
    // correction step advance only per persisted decision)
    const r = stored.record;
    const d = stored.decision;
    return {
      fresh: false,
      plan,
      head,
      record: r,
      docsAfter: docs,
      decision: d ?? { ...previewDecision(evidence, ctx.now), status: 'confirmed' },
      output: {
        verdict: r ? 'confirmed' : 'notAnchored',
        weighIns7: 0,
        weighIns14: 0,
        trend: r ? r.trendWeight : null,
        energyBias: { mean: r?.energyBiasKcal.mean ?? 0, sd: r?.energyBiasKcal.sd ?? 0, updated: false },
        residualSplit: r?.residualSplit ?? null,
        composition: null,
        intakeEvidence: null,
        anchors: anchorsFromRecords(docs.records).anchors.length,
        blocks,
        decision: {
          id: d?.id ?? `${plan.id}:${ctx.today}`,
          key: d?.key ?? evidence.key,
          status: 'confirmed',
          anchored: !!r,
          review: d?.review ?? null,
          proposalVersion: d?.proposalVersion ?? null,
          alreadyConfirmed: true,
        },
      },
    };
  }
  if (mode === 'optIn') requireRoutineCheckIn(docs, p, review, ctx.today);
  if (input.previewId && input.previewId !== evidence.previewId)
    fail('conflict', 'The check-in changed since it was read. Look at it again first.', {
      path: '/previewId',
    });
  const past = p.days.filter((d) => d.date < ctx.today);
  // the same realised schedule (shared history, fasts and hash) the daily assimilation and re-planning replay (C2); the
  // estimate is the one the automatic preview computed for the same key (`checkInEstimate`): composition readings at their
  // own time, the exposure-gated intake days and their evidence, the weigh-in revisions consumed (C4/D5-04/D5-07)
  const schedule = projectionSchedule(p, ctx.today) ?? fail('internal', 'The plan has no adopted version.');
  const ci = checkInEstimate({
    plan,
    head,
    records: docs.records,
    measurements,
    entries,
    schedule,
    past,
    today: ctx.today,
    historyHash: p.history?.contentHash ?? null,
    ...(docs.derivedAnchors?.length ? { derived: docs.derivedAnchors } : {}),
  });
  // (D5-06) disturbances since the last check-in make this a Review; they widen the weigh-in noise (weighInsFor) and are
  // reported, they never force a tissue re-anchor (no `hard` request)
  const record = ci.record;
  const decision = confirmDecision(previewDecision(evidence, ctx.now), {
    actor: actorOf(ctx),
    now: ctx.now,
    mode,
    anchored: !!record,
    review,
  });
  const anchors = anchorsFromRecords(record ? [...docs.records, record] : docs.records);
  return {
    fresh: true,
    plan,
    head,
    record,
    decision,
    docsAfter: {
      ...docs,
      records: record ? [...docs.records, record] : docs.records,
      decisions: [...(docs.decisions ?? []), decision],
    },
    output: {
      verdict: ci.output.verdict,
      weighIns7: ci.output.in7,
      weighIns14: ci.output.in14,
      trend: ci.output.trend,
      // (D5-03) the applied correction (after the controller bounds) and what was requested; at-limit is explicit
      energyBias: {
        mean: ci.record?.energyBiasKcal.mean ?? ci.output.bias.mean,
        sd: ci.output.bias.sd,
        updated: ci.output.bias.updated,
        ...(ci.record?.correction
          ? {
              requested: ci.record.correction.requestedKcal,
              saturated: ci.record.correction.saturated,
              stepLimited: ci.record.correction.stepLimited,
            }
          : {}),
      },
      residualSplit: ci.output.residualSplit,
      // (D5-07) what the composition readings did (used once / skipped with a reason); (D6-06) the window's intake evidence
      composition: ci.output.composition
        ? {
            status: ci.output.composition.status,
            consumed: ci.output.composition.consumedObservationIds,
            skipped: ci.output.composition.skipped,
          }
        : null,
      intakeEvidence: ci.output.intakeEvidence,
      anchors: anchors.anchors.length,
      blocks,
      decision: {
        id: decision.id,
        key: decision.key,
        status: 'confirmed',
        anchored: !!record,
        review,
        proposalVersion: null,
        alreadyConfirmed: false,
      },
    },
  };
}

/** Automatic confirmation is authorized by the person's currently stored routine-only policy. */
function requireRoutineCheckIn(
  docs: LivingDocs,
  p: LivingProjection,
  review: StoredCheckInDecision['review'],
  today: LocalDate,
): void {
  if (
    settingsValues().checkInAutoConfirm !== true ||
    !docs.plan ||
    !checkInDueAt(docs.plan, today, lastConfirmedCheckIn(docs.records, docs.decisions ?? [])).due ||
    review?.status !== 'none' ||
    p.eligibility?.blocked ||
    p.eligibility?.safetyChanged
  ) {
    fail('precondition_failed', 'Review this check-in and confirm it yourself.', {
      precondition: 'activePlan',
    });
  }
}

/** Re-read after awaited preparation, before the first authoritative proposal/anchor write. */
export async function authorizePreparedCheckIn(ctx: CommandContext, c: PreparedCheckIn): Promise<void> {
  if (!c.fresh) return;
  const docs = await readDocs(ctx.today);
  const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const pending = pendingCheckInOf({ docs, projection: p, today: ctx.today });
  if (!pending || pending.evidence.key !== c.decision.key)
    fail('conflict', 'The check-in changed since it was read. Look at it again first.', {
      path: '/previewId',
    });
  if (c.decision.mode === 'optIn') requireRoutineCheckIn(docs, p, pending.review, ctx.today);
}

/**
 * Write a prepared check-in exactly once, in the command's change (one transaction with any proposal it carries): the
 * record with its decision, or a decision-only document when nothing was anchored. A retry writes nothing.
 */
export async function writeCheckIn(
  ctx: CommandContext,
  c: PreparedCheckIn,
  proposalVersion?: number,
): Promise<CheckInOutput> {
  if (!c.fresh) return c.output;
  // A proposal already performed the final authorization immediately before its first write.
  if (proposalVersion === undefined) await authorizePreparedCheckIn(ctx, c);
  const decision: StoredCheckInDecision =
    proposalVersion !== undefined ? { ...c.decision, proposalVersion } : c.decision;
  const id = `${c.plan.id}:${ctx.today}`;
  if (c.record) await ctx.docs.append('anchors', { ...c.record, decision, _id: id });
  else {
    const doc: CheckInDecisionDoc = {
      kind: 'checkInDecision',
      planId: c.plan.id,
      anchorDate: ctx.today,
      decision,
    };
    await ctx.docs.append('anchors', { ...doc, _id: id });
  }
  return { ...c.output, decision: { ...c.output.decision, proposalVersion: proposalVersion ?? null } };
}

// the confirmation alone (the adaptation module adds the weekly re-plan proposal in the same change)
implement('plan.checkIn', async (ctx, input: { previewId?: string } = {}) =>
  writeCheckIn(
    ctx,
    await prepareCheckIn(
      ctx,
      await readDocs(ctx.today),
      input ?? {},
      ctx.actor.kind === 'system' && ctx.actor.id === CHECK_IN_OPT_IN_ACTOR ? 'optIn' : 'explicit',
    ),
  ),
);

// ------------------------------------------------------------------------------------------- logs
interface MealMarkIn {
  slot: string;
  mark: Mark;
  replaces?: string[];
  components?: unknown[];
}

/** What a meal's answer did: the entries it replaced and, for "as planned", the meal it logged in their place. */
export interface MealMarkOut {
  slot: string;
  mark: Mark;
  replaced: string[];
  entryId?: string;
}

const MEAL_CHANGED = 'That meal changed since it was read. Look at it again first.';

/**
 * One meal's answer, inside `log.markDay`'s change (one `history.undo` restores it): the entries the answer replaces must
 * be the slot's current food (a stale screen is refused), each is retracted, and "as planned" logs the planned meal
 * through `log.meal`'s own executor (the slot's plan, or the components given: one serving of the chosen recipe). Partly
 * and not log nothing: the answer is the meal's own mark, without an invented amount. Returns the mark to keep (none for
 * "as planned": its entry says it).
 *
 * The bus keeps what a failed command already wrote, so everything that can refuse runs before the first write: the
 * checks, then the planned meal (`log.meal` writes nothing when it asks or fails), and only then the retracts. A refused
 * answer leaves the meal exactly as it was.
 */
async function answerMeal(
  ctx: CommandContext,
  docs: LivingDocs,
  date: string,
  meal: MealMarkIn,
): Promise<{ out: MealMarkOut; keep: Mark | undefined }> {
  if (meal.components && meal.mark !== 'asPlanned')
    fail('invalid_input', 'Components go with a meal marked as planned.', { path: '/meal/components' });
  const day = getCommand('day.get');
  const rx =
    day && !day.notImplemented
      ? (
          (await day.execute(ctx, { date } as never)) as {
            prescription?: { meals?: Array<{ slot: string }> } | null;
          }
        ).prescription
      : null;
  if (!rx?.meals?.some((m) => m.slot === meal.slot))
    fail('invalid_input', 'There is no planned meal in that slot on this day.', { path: '/meal/slot' });
  const food = effectiveEntries(docs.entries).filter(
    (e): e is Extract<LogEntry, { kind: 'meal' }> => e.kind === 'meal' && e.date === date,
  );
  const replaces = [...new Set(meal.replaces ?? [])];
  const replaced = replaces.map((id) => food.find((e) => e.id === id) ?? fail('conflict', MEAL_CHANGED));
  // the slot's food must all be named: a meal logged since the screen read it would otherwise survive the answer
  const unnamed = food.filter((e) => e.slot === meal.slot && !replaces.includes(e.id));
  if (unnamed.length > 0)
    fail(
      'conflict',
      meal.replaces
        ? MEAL_CHANGED
        : `This meal already has food logged. Pass its entries (${unnamed.map((e) => e.id).join(', ')}) in replaces.`,
      { path: '/meal/replaces' },
    );
  let entryId: string | undefined;
  if (meal.mark === 'asPlanned') {
    const logMeal = getCommand('log.meal');
    if (!logMeal || logMeal.notImplemented)
      fail('precondition_failed', 'Meals can’t be logged in this version yet.', {
        precondition: 'implemented',
      });
    const input = { date, slot: meal.slot, components: meal.components ?? [], method: 'asPlanned' };
    const errors = Value.Errors(logMeal.input, input, 1);
    if (errors.length)
      fail('invalid_input', `The planned meal is not valid (${errors[0]!.message}).`, {
        path: `/meal${errors[0]!.path}`,
      });
    const logged = (await logMeal.execute(ctx, input as never)) as {
      status?: unknown;
      entryId?: unknown;
      question?: unknown;
    } | null;
    // a meal the food table can't place is not logged (and nothing was written): the answer is refused whole
    if (logged?.status !== 'logged' || typeof logged.entryId !== 'string')
      fail(
        'invalid_input',
        typeof logged?.question === 'string'
          ? `Not logged yet. ${logged.question}`
          : 'The planned meal could not be logged.',
        { path: '/meal' },
      );
    entryId = logged.entryId as string;
  }
  for (const e of replaced)
    await appendEntry(ctx, { ...base(ctx, date), kind: 'retract', target: e.id } as LogEntry);
  const out: MealMarkOut = {
    slot: meal.slot,
    mark: meal.mark,
    replaced: replaced.map((e) => e.id),
    ...(entryId ? { entryId } : {}),
  };
  return { out, keep: meal.mark === 'asPlanned' ? undefined : meal.mark };
}

/** The marks with one meal's own answer set (or cleared when `mark` is undefined); an empty `meals` is dropped. */
function withMealMark(marks: DayMarks, slot: string, mark: Mark | undefined): DayMarks {
  const { meals: prevMeals, ...rest } = marks;
  const { [slot]: _old, ...others } = prevMeals ?? {};
  void _old;
  const meals = mark ? { ...others, [slot]: mark } : others;
  return Object.keys(meals).length > 0 ? { ...rest, meals } : rest;
}

implement(
  'log.markDay',
  async (ctx, input: { date: string; marks?: Partial<Record<MarkBlock, Mark>>; meal?: MealMarkIn }) => {
    if (!input.marks && !input.meal)
      fail('invalid_input', 'Say what to mark: the day (marks) or one meal (meal).', { path: '/marks' });
    const docs = await readDocs(ctx.today);
    const plan = docs.plan && isLive(docs.plan) ? docs.plan : null;
    const prev = docs.dayStatus.find((s) => s.date === input.date);
    let marks: DayMarks = { ...prev?.marks, ...input.marks };
    // a meal answer that leaves the marks as they were ("as planned" with nothing said before) writes only its entries
    let write = !!input.marks;
    let meal: MealMarkOut | undefined;
    if (input.meal) {
      const a = await answerMeal(ctx, docs, input.date, input.meal);
      write ||= prev?.marks?.meals?.[input.meal.slot] !== a.keep;
      marks = withMealMark(marks, input.meal.slot, a.keep);
      meal = a.out;
    }
    const next: DayStatusDoc = {
      ...prev,
      date: input.date,
      ...(plan ? { planId: plan.id, planDay: planDay(plan, input.date) } : {}),
      marks,
    };
    if (write) await ctx.docs.put('dayStatus', { ...next, _id: `day:${input.date}` });
    return meal ? { ...next, meal } : next;
  },
);

implement('log.confirmDay', async (ctx, input: { date: string; intake?: DayIntakeAttestation }) => {
  if (input.intake !== undefined && !DAY_INTAKE_ATTESTATIONS.includes(input.intake))
    fail('invalid_input', 'Say complete, partial or none.', { path: '/intake' });
  const docs = await readDocs(ctx.today);
  const prev = docs.dayStatus.find((s) => s.date === input.date);
  // (C1/D5-01) the day report is the only thing that makes a day's food complete or a confirmed zero; confirming alone does not
  const withIntake: DayStatusDoc[] = input.intake
    ? docs.dayStatus
        .map((s) => (s.date === input.date ? { ...s, intake: input.intake } : s))
        .concat(prev ? [] : [{ date: input.date, intake: input.intake }])
    : [...docs.dayStatus];
  const p = projectLiving({
    docs: { ...docs, dayStatus: withIntake },
    today: ctx.today,
    tz: ctx.tz,
    now: ctx.now,
    skipAssimilation: true,
  });
  const day = p.days.find((d) => d.date === input.date);
  const next: DayStatusDoc = {
    ...prev,
    date: input.date,
    confirmedAt: ctx.now,
    ...(input.intake ? { intake: input.intake, intakeAt: ctx.now } : {}),
    ...(day ? { prescribed: day.prescription, score: { ...day.result.score, final: true } } : {}),
  };
  await ctx.docs.put('dayStatus', { ...next, _id: `day:${input.date}` });
  return next;
});

const METRICS: ReadonlySet<string> = new Set(MEASUREMENT_METRICS);

/** The unit in a metric's name (`weightKg` → kg). */
const UNIT_OF: ReadonlyArray<[RegExp, string]> = [
  [/Kg$/, 'kg'],
  [/Cm$/, 'cm'],
  [/Pct$/, '%'],
  [/MmHg$/, 'mmhg'],
  [/MmolL$/, 'mmol/l'],
  [/MgL$/, 'mg/l'],
  [/gL$/, 'g/l'],
];
const LB_KG = 0.45359237;
const IN_CM = 2.54;

/**
 * The value in the metric's own unit. The input's `unit` used to be dropped, so "180, lb" was stored as 180 kg; pounds
 * and inches convert (exact factors), any other unit that is not the metric's is refused. Negative values are refused,
 * and zero for every metric but ketones and CRP.
 */
function measurementValue(metric: string, value: number, unit?: string): number {
  const own = UNIT_OF.find(([re]) => re.test(metric))?.[1];
  const u = unit?.trim().toLowerCase().replace(/\s+/g, '');
  let v = value;
  if (u && u !== own) {
    if (own === 'kg' && ['lb', 'lbs', 'pound', 'pounds'].includes(u)) v = value * LB_KG;
    else if (own === 'cm' && ['in', 'inch', 'inches', '"'].includes(u)) v = value * IN_CM;
    else
      fail(
        'invalid_input',
        `Give this measurement in ${own === 'mmhg' ? 'mmHg' : own === 'mmol/l' ? 'mmol/L' : own === 'g/l' ? 'g/L' : own === 'mg/l' ? 'mg/L' : own}.`,
        { path: '/unit' },
      );
  }
  const zeroOk = metric === 'ketonesMmolL' || metric === 'crpMgL';
  if (!Number.isFinite(v) || v < 0 || (v === 0 && !zeroOk))
    fail('invalid_input', 'That value is not a possible reading.', { path: '/value' });
  return v;
}

interface MeasurementIn {
  repeats?: number[];
  repeatsEncoding?: MeasurementEntry['repeatsEncoding'];
  date?: string;
  metric: string;
  value: number;
  unit?: string;
  context?: MeasurementEntry['context'];
  method?: MeasurementEntry['method'];
  occurredAt?: string;
  device?: string;
  protocol?: string;
  scanMassKg?: number;
  scanFatMassKg?: number;
  landmark?: MeasurementEntry['landmark'];
  episodeId?: string;
  restMin?: number;
  setting?: MeasurementEntry['setting'];
  timeOfDay?: MeasurementEntry['timeOfDay'];
  specimen?: MeasurementEntry['specimen'];
  sampleId?: string;
  fastingHours?: number;
}

implement('log.measurement', async (ctx, input: MeasurementIn) => {
  if (!METRICS.has(input.metric)) fail('invalid_input', `Unknown measurement "${input.metric}".`);
  const value = measurementValue(input.metric, input.value, input.unit);
  const id = ctx.newId();
  // (C1/D5-07) a backfilled reading with a known instant belongs to the instant's app day, never to the entry day; a
  // submitted date stays as given (a contradicting one is refused by `occurrenceOf`)
  const date = dateOf(ctx, input.date, input.occurredAt);
  // (C1/C4) when it happened (only if given), its protocol context (unknown stays unknown), and its observation facts
  const facts = {
    ...(input.repeats !== undefined ? { repeats: [...input.repeats] } : {}),
    ...(input.repeatsEncoding !== undefined ? { repeatsEncoding: input.repeatsEncoding } : {}),
    ...(input.device ? { device: input.device } : {}),
    ...(input.protocol ? { protocol: input.protocol } : {}),
    ...(input.scanMassKg !== undefined ? { scanMassKg: input.scanMassKg } : {}),
    ...(input.scanFatMassKg !== undefined ? { scanFatMassKg: input.scanFatMassKg } : {}),
    ...(input.landmark ? { landmark: input.landmark } : {}),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    ...(input.restMin !== undefined ? { restMin: input.restMin } : {}),
    ...(input.setting ? { setting: input.setting } : {}),
    ...(input.timeOfDay ? { timeOfDay: input.timeOfDay } : {}),
    ...(input.specimen ? { specimen: input.specimen } : {}),
    ...(input.sampleId ? { sampleId: input.sampleId } : {}),
    ...(input.fastingHours !== undefined ? { fastingHours: input.fastingHours } : {}),
  };
  const m: Omit<MeasurementEntry, 'id'> = {
    date,
    at: ctx.now,
    recordedAt: ctx.now,
    metric: input.metric as MeasurementMetric,
    value,
    source: sourceOf(ctx),
    ...(input.context ? { context: input.context } : {}),
    measurementContext: legacyMeasurementContext(input.context),
    ...(input.method ? { method: input.method } : {}),
    ...(input.occurredAt ? { occurrence: occurrenceOf(ctx, input.occurredAt, input.date) } : {}),
    ...facts,
  };
  await ctx.docs.append('measurements', { ...m, _id: id });
  return { entryId: id };
});

const day = (ctx: CommandContext, d?: string): string => d ?? ctx.today;
/** (C1) audit time and contract version of every new record; `at` stays as its legacy twin (never the occurrence). */
const base = (ctx: CommandContext, date: string) => ({
  date,
  tz: ctx.tz,
  at: ctx.now,
  recordedAt: ctx.now,
  contract: CONTRACT_VERSIONS.observation,
  source: sourceOf(ctx),
});
/**
 * (C1) An occurrence the person gave (an instant with offset); absent input = not known (never the command time). Its
 * date is the instant's app day in the logging zone (rollover applied); a submitted date is kept as given and must name
 * the same day, as the app day or as the calendar date of the instant (`calendarLocal`): a date that contradicts the
 * instant is refused, never silently resolved either way.
 */
function occurrenceOf(ctx: CommandContext, occurredAt: string, date?: string) {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) fail('invalid_input', 'That time is not valid.', { path: '/occurredAt' });
  const by = sourceOf(ctx).by;
  const source = by === 'device' ? 'device' : by === 'import' ? 'import' : 'user';
  const rolloverH = rolloverOf(settingsValues());
  const app = appDay(t, { tz: ctx.tz, rolloverH });
  const calendar = appDay(t, { tz: ctx.tz, rolloverH: 0 });
  if (date !== undefined && date !== app && date !== calendar)
    fail('invalid_input', `That time is on ${app}, not ${date}. Leave out the date or fix it.`, {
      path: '/date',
    });
  const meaning = date !== undefined && date !== app ? 'calendarLocal' : 'appDay';
  return {
    ...exactOccurrence(occurredAt, { tz: ctx.tz, date: date ?? app, dateMeaning: meaning, source }),
    ...(meaning === 'appDay' ? { rolloverH } : {}),
  };
}

/** The record's date: the submitted one, else the app day of a given occurrence instant, else today (never the entry time). */
function dateOf(ctx: CommandContext, date: string | undefined, occurredAt: string | undefined): string {
  if (date !== undefined) return date;
  if (occurredAt !== undefined && Number.isFinite(Date.parse(occurredAt)))
    return appDay(Date.parse(occurredAt), { tz: ctx.tz, rolloverH: rolloverOf(settingsValues()) });
  return ctx.today;
}
/** (C2) explicit planned-item identity: `itemId` replaces that planned dose; `extra` is an explicit additional one. */
const identity = (i: { itemId?: string; extra?: boolean }) => ({
  ...(i.itemId ? { itemId: i.itemId } : {}),
  ...(i.extra ? { extra: true } : {}),
});

const SUBSTANCE_WORD: Record<'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones', string> = {
  caffeine: 'Caffeine',
  alcohol: 'Alcohol',
  creatine: 'Creatine',
  exogenousKetones: 'Exogenous ketones',
};

/** (D5-01) validate the substance/unit pair and keep the canonical dose beside the raw value (never coerced). */
function substanceNormalized(
  substance: 'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones',
  amount: number,
  unit: string,
): { value: number; unit: 'mg' | 'g'; convention?: 'ethanol14gPerDrink' } {
  const r = normalizeSubstanceDose(substance, amount, unit);
  if (!r.ok) {
    if (r.reason === 'unitNotAllowed')
      fail(
        'invalid_input',
        `${SUBSTANCE_WORD[substance]} is logged in ${SUBSTANCE_UNITS[substance].join(' or ')}.`,
        { path: '/unit' },
      );
    fail('invalid_input', 'That amount is not possible.', { path: '/amount' });
  }
  return { value: r.value, unit: r.unit, ...(r.convention ? { convention: r.convention } : {}) };
}

implement(
  'log.steps',
  (ctx, input: { date?: string; steps: number; scope?: 'totalDay' | 'excludesTraining' | 'unknown' }) =>
    appendEntry(ctx, {
      ...base(ctx, day(ctx, input.date)),
      kind: 'steps',
      steps: input.steps,
      ...(input.scope ? { scope: input.scope } : {}),
    } as LogEntry),
);
/**
 * (energy SPEC §2.3 4(a)) A step correction: "use this source for the steps of [start, end)". Dated on the app day of
 * its start (the day the person sees), kept as the instants given; the Gauge import sends the in-force corrections to
 * the server's step fusion, and `log.retract` removes one. A span that has not started yet is refused.
 */
implement('log.stepsCorrection', (ctx, input: { start: string; end: string; use: string }) => {
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (!(end > start)) fail('invalid_input', 'The end has to be after the start.', { path: '/end' });
  if (end - start > 48 * 3_600_000)
    fail('invalid_input', 'A correction covers at most two days.', { path: '/end' });
  if (start > Date.parse(ctx.now)) fail('invalid_input', 'That time has not come yet.', { path: '/start' });
  const startAt = new Date(start).toISOString();
  const endAt = new Date(end).toISOString();
  const date = minDate(appDayOf(startAt, ctx.tz), ctx.today);
  const by = sourceOf(ctx).by;
  const occurrence = intervalOccurrence(startAt, endAt, {
    tz: ctx.tz,
    date,
    dateMeaning: 'appDay',
    source: by === 'device' ? 'device' : by === 'import' ? 'import' : 'user',
  });
  return appendEntry(ctx, {
    ...base(ctx, date),
    kind: 'stepsCorrection',
    start: startAt,
    end: endAt,
    use: input.use,
    occurrence,
  } as LogEntry);
});
implement(
  'log.sleep',
  (
    ctx,
    input: {
      bedAt: string;
      wakeAt: string;
      quality?: 'poor' | 'fair' | 'good';
      restfulness?: number;
      episodeKind?: 'main' | 'nap';
      lightsOutAt?: string;
      outOfBedAt?: string;
    },
  ) => {
    // V2 (V1a-L9): a wake at or before the bed time reads as 24 h asleep in the engine
    const hours = (Date.parse(input.wakeAt) - Date.parse(input.bedAt)) / 3_600_000;
    if (!(hours > 0 && hours <= 24))
      fail('invalid_input', 'The wake time has to be after the bed time, within a day.', { path: '/wakeAt' });
    // (D8-06) an observed episode belongs to its WAKE date (the night ending D informs D); the raw instants are its occurrence
    const date = minDate(appDayOf(input.wakeAt, ctx.tz), ctx.today);
    const by = sourceOf(ctx).by;
    const occurrence = intervalOccurrence(input.bedAt, input.wakeAt, {
      tz: ctx.tz,
      date,
      dateMeaning: 'wakeDate',
      source: by === 'device' ? 'device' : by === 'import' ? 'import' : 'user',
    });
    // (D8-06) quality and restfulness only as entered (never derived), and a nap stays a nap (never the night's main episode)
    return appendEntry(ctx, {
      ...base(ctx, date),
      kind: 'sleep',
      bedAt: input.bedAt,
      wakeAt: input.wakeAt,
      occurrence,
      sleepDateContract: CONTRACT_VERSIONS.sleepDate,
      ...(input.quality ? { quality: input.quality } : {}),
      ...(input.restfulness !== undefined && Number.isFinite(input.restfulness)
        ? { restfulness: input.restfulness }
        : {}),
      ...(input.episodeKind ? { episodeKind: input.episodeKind } : {}),
      // (energy SPEC §V3.6, D11) the diary times exactly as entered
      ...(input.lightsOutAt ? { lightsOutAt: input.lightsOutAt } : {}),
      ...(input.outOfBedAt ? { outOfBedAt: input.outOfBedAt } : {}),
    } as LogEntry);
  },
);
// (energy SPEC §V3.6, D11, D21) the diary times alone. A night already logged (ring or typed) takes them as a successor that
// keeps its source and its bed and wake times, so a ring night never becomes the person's correction; with no night for
// the date yet ("Going to sleep" before the ring has it) they wait on the date's dayStatus and move onto the night with
// the next change after it arrives
implement(
  'log.sleepTimes',
  async (ctx, input: { date: string; lightsOutAt?: string | null; outOfBedAt?: string | null }) => {
    if (input.date > addLocalDays(ctx.today, 1))
      fail('invalid_input', 'That night has not started yet.', { path: '/date' });
    const docs = await readDocs(ctx.today);
    const night = nightOn(docs.entries, input.date);
    const status = docs.dayStatus.find((s) => s.date === input.date);
    const next = patchDiary(diaryOf(night, status?.sleepDiary), {
      ...(input.lightsOutAt !== undefined ? { lightsOutAt: input.lightsOutAt } : {}),
      ...(input.outOfBedAt !== undefined ? { outOfBedAt: input.outOfBedAt } : {}),
    });
    const problem = diaryProblem(next, input.date);
    if (problem) fail('invalid_input', problem.message, { path: problem.path });
    let entryId: string | null = null;
    if (night) {
      entryId = (await appendEntry(ctx, nightWithDiary(night, next, ctx.now) as unknown as LogEntry)).entryId;
    }
    // what waits on the date: the times while there is no night, nothing once they are on it
    const waiting = night
      ? undefined
      : next.lightsOutAt || next.outOfBedAt
        ? {
            ...(next.lightsOutAt ? { lightsOutAt: next.lightsOutAt } : {}),
            ...(next.outOfBedAt ? { outOfBedAt: next.outOfBedAt } : {}),
            at: ctx.now,
          }
        : undefined;
    if (waiting)
      await ctx.docs.patch('dayStatus', `day:${input.date}`, { date: input.date, sleepDiary: waiting });
    else if (status?.sleepDiary) await ctx.docs.patch('dayStatus', `day:${input.date}`, { sleepDiary: null });
    return { entryId, waiting: !night, lightsOutAt: next.lightsOutAt, outOfBedAt: next.outOfBedAt };
  },
);
// (S1 import) ring steps and main sleep from the home server (`@/state/gaugeImport` fetches them and calls this)
implement(
  'log.fromGauge',
  async (
    ctx,
    input: {
      steps: Array<{ date: string; steps: number; fusion?: StepsFusionDay; sources?: string[] }>;
      sleep: Array<{
        wakingDate: string;
        start: string;
        end: string;
        asleepMinutes: number;
        origin?: string;
      }>;
      weights?: Array<{ id: string; at: string; kg: number; origin?: string }>;
      answered?: { steps?: string[]; sleep?: { from: string; to: string } };
    },
  ) => {
    const docs = await readDocs(ctx.today);
    // (0.6.3 FX1) `answered`: the days the server answered in full, so an imported entry it no longer supports is retracted
    const plan = planGaugeImport({
      entries: docs.entries,
      steps: input.steps,
      sleep: input.sleep,
      tz: ctx.tz,
      rolloverH: rolloverOf(settingsValues()),
      today: ctx.today,
      now: ctx.now,
      ...(input.answered ? { answered: input.answered } : {}),
    });
    const created: Array<{ entryId: string; key: string; stream: 'steps' | 'sleep'; supersedes?: string }> =
      [];
    const store = getDocumentStore();
    for (const c of plan.create) {
      // another device may have written the same reading already (same id): sync made it one document, nothing to add
      if (store.peek('dailyLogs', c.id)) continue;
      const { entryId } = await appendEntry(ctx, { ...c.entry, id: c.id } as LogEntry);
      created.push({
        entryId,
        key: c.key,
        stream: c.stream,
        ...(c.entry.supersedes ? { supersedes: c.entry.supersedes } : {}),
      });
    }
    // (energy SPEC §V3.6, D13) Health Connect weight as device measurements; the person's own weigh-in of that day wins
    if (!input.weights || input.weights.length === 0) return { created, skipped: plan.skipped };
    const weights: { created: string[]; skipped: Array<{ id: string; reason: 'userEntry' | 'unchanged' }> } =
      { created: [], skipped: [] };
    const live = projectEntries(docs.measurements);
    for (const w of input.weights) {
      const date = appDayOf(w.at, ctx.tz);
      if (date > ctx.today) continue;
      const id = gaugeEntryId(date, `hc:weight:${w.id}`);
      if (store.peek('measurements', id) || docs.measurements.some((m) => m.id === id)) {
        weights.skipped.push({ id: w.id, reason: 'unchanged' });
        continue;
      }
      if (
        live.some((m) => m.metric === 'weightKg' && m.date === date && m.source.by !== 'device' && !m.assumed)
      ) {
        weights.skipped.push({ id: w.id, reason: 'userEntry' });
        continue;
      }
      await ctx.docs.append('measurements', {
        date,
        at: ctx.now,
        recordedAt: ctx.now,
        metric: 'weightKg',
        value: w.kg,
        source: {
          by: 'device',
          method: 'biometrics',
          app: 'gauge',
          deviceKey: `hc:weight:${w.id}`,
          actorId: 'gauge-import',
        },
        context: 'unknown',
        measurementContext: legacyMeasurementContext('unknown'),
        method: 'scale',
        occurrence: exactOccurrence(new Date(Date.parse(w.at)).toISOString(), {
          tz: ctx.tz,
          date,
          source: 'device',
        }),
        ...(w.origin ? { device: w.origin.slice(0, 64) } : {}),
        _id: id,
      });
      weights.created.push(id);
    }
    return { created, skipped: plan.skipped, weights };
  },
);
implement(
  'log.substance',
  (
    ctx,
    input: {
      date?: string;
      substance: 'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones';
      clockH: number;
      amount: number;
      unit: 'mg' | 'drinks' | 'g';
      occurredAt?: string;
      itemId?: string;
      extra?: boolean;
    },
  ) => {
    const normalized = substanceNormalized(input.substance, input.amount, input.unit);
    const date = dateOf(ctx, input.date, input.occurredAt);
    return appendEntry(ctx, {
      ...base(ctx, date),
      kind: 'substance',
      substance: input.substance,
      clockH: input.clockH,
      amount: input.amount,
      unit: input.unit,
      normalized,
      ...(input.occurredAt ? { occurrence: occurrenceOf(ctx, input.occurredAt, input.date) } : {}),
      ...identity(input),
    } as LogEntry);
  },
);
implement(
  'log.supplement',
  (
    ctx,
    input: {
      date?: string;
      supplementId: string;
      dose: number;
      unit: string;
      clockH?: number;
      occurredAt?: string;
      servings?: number;
      product?: Extract<LogEntry, { kind: 'supplement' }>['product'];
      itemId?: string;
      extra?: boolean;
    },
  ) => {
    const date = dateOf(ctx, input.date, input.occurredAt);
    const entry = {
      ...base(ctx, date),
      kind: 'supplement',
      supplementId: input.supplementId,
      dose: input.dose,
      unit: input.unit,
      ...(input.clockH !== undefined ? { clockH: input.clockH } : {}),
      ...(input.servings !== undefined ? { servings: input.servings } : {}),
      ...(input.product ? { product: input.product } : {}),
      ...(input.occurredAt ? { occurrence: occurrenceOf(ctx, input.occurredAt, input.date) } : {}),
      ...identity(input),
    } as Extract<LogEntry, { kind: 'supplement' }>;
    // (D7-04) the active exposure from the label arithmetic (servings × label actives, unit-checked; an unknown potency
    // stays null), and two separate statuses: the dose input is valid, its safety assessment is not done at logging
    const id = ctx.newId();
    const exposures = supplementExposures({ ...entry, id });
    const doseValidity = Number.isFinite(input.dose) && input.dose >= 0 ? 'valid' : 'invalid';
    const stored = exposures.map((x) => {
      const { reason: _reason, ...rest } = x as typeof x & { reason?: string };
      void _reason;
      return rest;
    });
    return appendEntry(ctx, {
      ...entry,
      id,
      ...(stored.length > 0 ? { exposures: stored } : {}),
      doseValidity,
      safetyCheck: 'unchecked',
    } as LogEntry);
  },
);
interface SubjectiveIn {
  date?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  hunger?: number;
  energy?: number;
  mood?: number;
  stress?: 'low' | 'moderate' | 'high';
  illness?: boolean;
  /** (D2-06) fixed-time ratings 0–10: felt hunger, fullness and craving are separate, and none is item completion. */
  fullness?: number;
  craving?: number;
  ratedAtClockH?: number;
  /** (D8-09) observed restfulness/fatigue 0–10 and (D8-04/D8-09) the person's own concern flags (never a diagnosis). */
  restfulness?: number;
  fatigue?: number;
  concerns?: WellbeingConcern[];
  symptom?: { category: string; status: string; context?: string; occurredOn?: string };
}
implement('log.subjective', (ctx, input: SubjectiveIn) => {
  // a reported symptom rides on the entry (D4-02): every later lifecycle check and re-plan reads it as the current state;
  // ratings and flags are stored as entered (an unrated scale stays absent, never a zero)
  const { date, ...rest } = input;
  return appendEntry(ctx, { ...base(ctx, day(ctx, date)), kind: 'subjective', ...rest } as LogEntry);
});
implement('log.note', (ctx, input: { date?: string; text: string }) =>
  appendEntry(ctx, { ...base(ctx, day(ctx, input.date)), kind: 'note', text: input.text } as LogEntry),
);

implement(
  'log.fast',
  async (
    ctx,
    input: {
      action: 'start' | 'end' | 'broken' | 'record';
      lastIntakeAt?: string;
      firstIntakeAt?: string;
      protocol?: 'zeroCalorie' | 'modified';
    },
  ) => {
    const docs = await readDocs(ctx.today);
    const open = effectiveEntries(docs.entries)
      .filter((e): e is Extract<LogEntry, { kind: 'fast' }> => e.kind === 'fast' && e.firstIntakeAt === null)
      .sort((a, b) => (a.lastIntakeAt < b.lastIntakeAt ? 1 : -1))[0];
    if (input.action === 'start' || input.action === 'record') {
      // a tap now is a real-time observation; a typed last intake is the person's own instant (both are the occurrence)
      const last = input.lastIntakeAt ?? ctx.now;
      if (input.firstIntakeAt && Date.parse(input.firstIntakeAt) <= Date.parse(last))
        fail('invalid_input', 'The first intake has to be after the last intake.', {
          path: '/firstIntakeAt',
        });
      return appendEntry(ctx, {
        ...base(ctx, appDayOf(last, ctx.tz)),
        kind: 'fast',
        lastIntakeAt: last,
        firstIntakeAt: input.action === 'record' ? (input.firstIntakeAt ?? null) : null,
        ...(input.protocol ? { protocol: input.protocol } : {}),
      } as LogEntry);
    }
    if (!open) fail('conflict', 'No fast is running.');
    const first = input.firstIntakeAt ?? ctx.now;
    // the completion supersedes the open record by identity (no time-window matching); its occurrence is the logged instants
    return appendEntry(ctx, {
      ...open,
      id: undefined,
      at: ctx.now,
      recordedAt: ctx.now,
      source: sourceOf(ctx),
      supersedes: open.id,
      firstIntakeAt: first,
      ...(input.action === 'broken' ? { broken: true } : {}),
    } as unknown as LogEntry);
  },
);

/** A stale id (edited or removed since) would fork the entry or change nothing: the screen reloads instead. */
function current<E extends { id: string; supersedes?: string; kind?: string; target?: string }>(
  all: readonly E[],
  target: E,
): E {
  if (!effectiveEntries(all).some((e) => e.id === target.id))
    fail('conflict', 'That entry was changed or removed since. Look at it again first.');
  return target;
}

implement('log.retract', async (ctx, input: { entryId: string; keepEntryId?: string }) => {
  const docs = await readDocs(ctx.today);
  const found = docs.entries.find((e) => e.id === input.entryId);
  const sameOpenConflict = <
    E extends { id: string; at?: string; supersedes?: string; kind?: string; target?: string },
  >(
    all: readonly E[],
  ) =>
    projectEntries(all).some(
      (e) =>
        e.conflict?.versions.some((v) => v.id === input.entryId) &&
        e.conflict.versions.some((v) => v.id === input.keepEntryId),
    );
  if (
    input.keepEntryId &&
    (input.keepEntryId === input.entryId ||
      !(found ? sameOpenConflict(docs.entries) : sameOpenConflict(docs.measurements)))
  )
    fail('conflict', 'One of these versions changed. Look at them again before choosing.');
  if (found?.kind === 'retract') {
    if (!effectiveEntries(docs.entries, true).some((e) => e.id === found.id))
      fail('conflict', 'That removal was already undone. Look at it again first.');
    const restored =
      docs.entries.find((e) => e.id === found.target) ?? fail('not_found', 'The removed entry is missing.');
    const { id: _old, ...copy } = restored;
    void _old;
    const id = ctx.newId();
    await ctx.docs.append('dailyLogs', { ...copy, at: ctx.now, supersedes: found.id, _id: id });
    return { entryId: id };
  }
  const target = found ? current(docs.entries, found) : undefined;
  // a conflict choice names the version kept, so two opposite choices made at once cancel out (L-REV2 R3-02); it also
  // names the earlier choices over this pair it overrides, so a choice after a crossing settles it
  const over = <E extends { id: string; kind?: string; target?: string; keep?: string }>(all: readonly E[]) =>
    all
      .filter(
        (e) =>
          e.kind === 'retract' &&
          e.keep &&
          ((e.target === input.entryId && e.keep === input.keepEntryId) ||
            (e.target === input.keepEntryId && e.keep === input.entryId)),
      )
      .map((e) => e.id);
  const keepIn = (all: readonly { id: string; kind?: string; target?: string; keep?: string }[]) => {
    if (!input.keepEntryId) return {};
    const overrides = over(all);
    return { keep: input.keepEntryId, ...(overrides.length ? { overrides } : {}) };
  };
  const keep = keepIn(found ? docs.entries : docs.measurements);
  if (target)
    return appendEntry(ctx, {
      ...base(ctx, target.date),
      kind: 'retract',
      target: target.id,
      ...keep,
    } as LogEntry);
  // a weigh-in or measurement: the retract entry goes into the (append-only) measurements collection
  const marker = docs.measurements.find((e) => e.id === input.entryId) as
    (MeasurementEntry & { kind?: string; target?: string }) | undefined;
  if (marker?.kind === 'retract' && marker.target) {
    if (!effectiveEntries(docs.measurements, true).some((e) => e.id === marker.id))
      fail('conflict', 'That removal was already undone. Look at it again first.');
    const restored =
      docs.measurements.find((e) => e.id === marker.target) ??
      fail('not_found', 'The removed measurement is missing.');
    const id = ctx.newId();
    const { id: _old, ...copy } = restored;
    void _old;
    await ctx.docs.append('measurements', { ...copy, at: ctx.now, supersedes: marker.id, _id: id });
    return { entryId: id };
  }
  const m = current(
    docs.measurements,
    docs.measurements.find((e) => e.id === input.entryId) ?? fail('not_found', 'There is no such entry.'),
  );
  const id = ctx.newId();
  await ctx.docs.append('measurements', {
    date: m.date,
    at: ctx.now,
    metric: m.metric,
    value: m.value,
    kind: 'retract',
    target: m.id,
    ...keep,
    source: sourceOf(ctx),
    _id: id,
  });
  return { entryId: id };
});

implement('log.edit', async (ctx, input: { entryId: string; patch: Record<string, unknown> }) => {
  const docs = await readDocs(ctx.today);
  const target = current(
    docs.entries,
    docs.entries.find((e) => e.id === input.entryId) ?? fail('not_found', 'There is no such entry.'),
  );
  const { id: _old, ...rest } = target;
  void _old;
  const patch = checkedPatch(target.kind, input.patch);
  const next = { ...rest, ...patch } as Record<string, unknown>;
  // the successor's identity first: everything derived below (exposures' origin) names the new revision
  const id = ctx.newId();
  // (D5-01) an edited substance dose is validated again; the raw value stays as typed beside its canonical dose
  if (target.kind === 'substance')
    next.normalized = substanceNormalized(
      next.substance as 'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones',
      next.amount as number,
      next.unit as string,
    );
  if (target.kind === 'sleep' && ('bedAt' in patch || 'wakeAt' in patch || 'date' in patch)) {
    // (C1/D8-06) a corrected night: the merged interval passes log.sleep's own checks, and its occurrence, wake date and
    // plan day are derived again from the corrected instants under the record's zone and the wake-date contract (never
    // the correction's entry time); the superseded record stays as it was
    const bedAt = String(next.bedAt);
    const wakeAt = String(next.wakeAt);
    const hours = (Date.parse(wakeAt) - Date.parse(bedAt)) / 3_600_000;
    if (!(Number.isFinite(hours) && hours > 0 && hours <= 24))
      fail('invalid_input', 'The wake time has to be after the bed time, within a day.', {
        path: '/patch/wakeAt',
      });
    const tz = target.tz || ctx.tz;
    const date = minDate(appDayOf(wakeAt, tz), ctx.today);
    const by = sourceOf(ctx).by;
    next.date = date;
    next.occurrence = intervalOccurrence(bedAt, wakeAt, {
      tz,
      date,
      dateMeaning: 'wakeDate',
      source: by === 'device' ? 'device' : by === 'import' ? 'import' : 'user',
    });
    next.sleepDateContract = CONTRACT_VERSIONS.sleepDate;
  } else if (typeof patch.occurredAt === 'string') {
    // a corrected instant: the record moves to the instant's app day unless a matching date is given with it
    next.occurrence = occurrenceOf(
      ctx,
      patch.occurredAt,
      typeof patch.date === 'string' ? patch.date : undefined,
    );
    next.date = (next.occurrence as { date?: string }).date ?? next.date;
    delete next.occurredAt;
  } else if ('clockH' in patch || 'startH' in patch || 'date' in patch) {
    // (C1) a moved clock or date makes a stored instant stale: the occurrence then follows the stated date and clock
    delete next.occurrence;
  }
  if (target.kind === 'supplement') {
    // (D7-04) a corrected supplement: the inherited exposure cache is dropped and the active exposure rebuilt from the
    // merged dose, unit, servings, product and occurrence (explicit servings take precedence over the raw dose in the label
    // arithmetic, as at logging), with the new revision as its origin; unknown potency stays unknown. Dose validity is
    // checked again and the safety assessment returns to unchecked. The superseded record keeps its own values.
    delete next.exposures;
    const entry = { ...next, id } as unknown as Extract<LogEntry, { kind: 'supplement' }>;
    const exposures = supplementExposures(entry).map((x) => {
      const { reason: _reason, ...keep } = x as typeof x & { reason?: string };
      void _reason;
      return keep;
    });
    if (exposures.length > 0) next.exposures = exposures;
    next.doseValidity = Number.isFinite(entry.dose) && entry.dose >= 0 ? 'valid' : 'invalid';
    next.safetyCheck = 'unchecked';
  }
  return appendEntry(ctx, {
    ...next,
    id,
    at: ctx.now,
    recordedAt: ctx.now,
    source: sourceOf(ctx),
    supersedes: target.id,
  } as unknown as LogEntry);
});

/**
 * What `log.edit` may change, by entry kind (review V1c-10). The field schemas are the logging commands' own inputs
 * (`log.steps`, `log.sleep`, …), so an edit can never write what logging could not. Bookkeeping fields (`assumed`,
 * `planId`, `planDay`, `at`, `tz`, `source`, `supersedes`, `id`, `kind`) and anything not listed are refused.
 * Meals and sessions keep their computed parts (components, nutrients, stimulus): log them again to change those.
 */
const EDITABLE: Partial<
  Record<LogEntry['kind'], { from: string; fields?: readonly string[]; extra?: Record<string, JsonSchema> }>
> = {
  steps: { from: 'log.steps' },
  sleep: { from: 'log.sleep' },
  substance: { from: 'log.substance' },
  supplement: { from: 'log.supplement' },
  subjective: { from: 'log.subjective' },
  note: { from: 'log.note' },
  meal: { from: 'log.meal', fields: ['date', 'clockH', 'slot', 'complete'] },
  session: { from: 'log.session', fields: ['date', 'status', 'startH', 'durationMin', 'rpe'] },
  fast: {
    from: 'log.fast',
    fields: ['lastIntakeAt'],
    extra: { firstIntakeAt: T.Nullable(T.Instant()), broken: T.Boolean(), electrolytes: T.Boolean() },
  },
  event: {
    from: '',
    extra: {
      event: T.Enum(['illness', 'travel', 'noTraining', 'socialMeal', 'busy', 'dietBreak', 'creatineStart']),
      to: T.Date(),
    },
  },
};

function checkedPatch(kind: LogEntry['kind'], patch: Record<string, unknown>): Record<string, unknown> {
  const spec = EDITABLE[kind];
  const source = (spec?.from && getCommand(spec.from)?.input.properties) || {};
  const props: Record<string, JsonSchema> = {
    date: T.Date(),
    text: T.String({ minLength: 1, maxLength: 2000 }),
    ...(spec?.extra ?? {}),
  };
  for (const [k, s] of Object.entries(source)) if (!spec?.fields || spec.fields.includes(k)) props[k] = s;
  const errors = Value.Errors({ type: 'object', properties: props, additionalProperties: false }, patch, 1);
  if (errors.length) {
    const field = decodeURIComponent(errors[0]!.path.split('/')[1] ?? '');
    const allowed = Object.keys(props).join(', ');
    fail(
      'invalid_input',
      props[field]
        ? `The new value for ${field} is not valid (${errors[0]!.message}).`
        : `${field} can't be changed on this entry. You can change: ${allowed}.`,
      { path: `/patch${errors[0]!.path}` },
    );
  }
  return patch;
}

/**
 * App day of an instant (sleep: the wake; fasts: the last intake), rolling over like every other log (04:00 by default)
 * a wake at 02:30 belongs to the day before.
 */
function appDayOf(at: string, tz: string): string {
  return appDay(Date.parse(at), { tz, rolloverH: rolloverOf(settingsValues()) });
}
const minDate = (a: string, b: string): string => (a <= b ? a : b);
