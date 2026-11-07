/**
 * "Start this plan" (docs/SUITE_SPEC.md §3.1-3.2, §6.3): a rung (v1 `PlanOption` today, v2 `RungPlan` later) or a scenario
 * becomes a `PlanDoc` plus its first `PlanVersionDoc` (reason 'start'): schedule anchored to the chosen start date, goal
 * targets frozen as ABSOLUTE values (a "lose 8 kg" goal stays measured from the plan start), the person at day 0 frozen as
 * `baselineProfile`, adherence weights from the planner (or the documented defaults), the forecast digest, implementation
 * intentions. Pure: ids and the clock come from the caller (CommandContext). The Ideal is never startable as is.
 *
 * (C5/A1-004) The safety subject is the FINAL prescription: `result.subject` is exactly the stored request (chosen and
 * profile start date) and the anchored schedule, which the lifecycle check must validate and fingerprint before any write.
 * A source certificate binds the planner's or the Simulator's schedule: it is attached to the version only when anchoring
 * left that subject unchanged; otherwise it stays provenance (`sourceCertificate`, to be kept in the history of the one
 * declared final audit of the changed subject) and never authorizes the changed prescription.
 */
import type { MetricId, PersonProfile, Schedule, SeriesId } from '@/engine';
import type { PlanOption, PlannerRequest, PracticalConstraints, RankedGoal, SafetyNote } from '@/engine/planner/domain/types';
import { addDays, weekdayOf } from './dates';
import { anchorSchedule, isAllowedStartDate } from './calendar';
import { defaultSensitivities } from './prescription';
import { scenarioStartValues } from '@/engine/planner/domain/replan';
import { freezeMuscleRetention } from '@/engine/planner/domain/muscleRetention';
import type { PlannerProvenanceV2, PlannerRequestV2, PlanSensitivities, RungId } from './plannerContract';
import { CONTRACT_FINGERPRINT, LEGACY_BAND_META, bandMetaFor, contentHash, stampDerived, type SafetyCertificate, type SafetyStatus } from '@/lib/bodyContracts';
import type { Actor, Id, Instant, LocalDate, PlanDoc, PlanIntentions, PlanVersionDoc, ProjectionDigest, Weekday } from './types';

export interface StartContext {
  planId: Id;
  now: Instant;
  today: LocalDate;
  createdBy: Actor;
  /** Engine/registry/catalogue versions for scenario-started plans (planner plans carry their provenance). */
  versions: { engineVersion: string; registryHash: string; catalogueVersion: string };
}

export interface StartResult {
  ok: true;
  plan: PlanDoc & { id: Id };
  version: PlanVersionDoc;
  /** Shown in the start dialog ("starting on Wednesday skips the first 2 days of week 1"). */
  anchorNotes: string[];
  /**
   * (C5/A1-004) The exact final safety subject: `plan.request` (chosen start date, profile start date) and
   * `version.schedule` (anchored). The lifecycle check validates and fingerprints this, never the source schedule.
   */
  subject: { request: PlannerRequestV2; schedule: Schedule };
  /** The source's certificate as produced (provenance only when `subjectChanged`). */
  sourceCertificate?: SafetyCertificate;
  /** Anchoring or the chosen date changed the certified subject (dates, days, fasts, blocks): the source certificate cannot bind it. */
  subjectChanged: boolean;
}

/**
 * Whether the final prescription is still the subject a source certificate binds (A1-004): the same schedule content
 * (start date included) and the same plan start for the request. Any date or day change is another subject.
 */
export function sameSafetySubject(
  source: { request: PlannerRequestV2; schedule: Schedule },
  final: { request: PlannerRequestV2; schedule: Schedule },
): boolean {
  const startOf = (r: PlannerRequestV2, sc: Schedule) => r.startDate ?? r.profile.startDate ?? sc.startDate;
  return (
    startOf(source.request, source.schedule) === startOf(final.request, final.schedule) &&
    contentHash(source.schedule) === contentHash(final.schedule)
  );
}

/**
 * (A1-004) The start documents with the one declared final audit's certificate for the changed subject (the caller
 * revalidates it on `subject` before writing). The source certificate stays provenance; nothing else changes.
 */
export function withFinalCertificate(r: StartResult, certificate: SafetyCertificate): StartResult {
  return { ...r, version: { ...r.version, certificate } };
}

export type StartOutcome = StartResult | { ok: false; reason: string };

/** Goals with every 'change' target converted to an absolute value from the plan's start values (§3.2). */
export function freezeGoalTargets(
  goals: readonly RankedGoal[],
  startValues: ReadonlyMap<number, number>,
): RankedGoal[] {
  return goals.map((g, k) => {
    if (g.targetKind !== 'change' || g.target === undefined) return { ...g };
    const start = startValues.get(k);
    if (start === undefined || !Number.isFinite(start)) return { ...g };
    return {
      ...g,
      target: start + g.target,
      targetKind: 'absolute',
      targetOrigin: { kind: 'change', delta: g.target, baseline: start },
    };
  });
}

/** Additive legacy scenario migration: reconstruct only from its frozen original start subject, never today's state. */
export function restoreScenarioGoalTargets<P extends PlanDoc>(
  plan: P,
  versions: readonly PlanVersionDoc[],
): P {
  if (
    plan.origin.kind !== 'scenario' ||
    !plan.request.goals.some(
      (g) => g.targetKind === 'change' && ['sbp', 'glucose', 'fastingGlucose'].includes(g.metric),
    )
  )
    return plan;
  const original = versions.find(
    (v) => v.planId === (plan as P & { id?: string }).id && v.version === 1 && v.reason === 'start',
  );
  if (!original || !plan.baselineProfile || original.schedule.startDate !== plan.startDate) return plan;
  try {
    const request = {
      ...plan.request,
      profile: { ...plan.baselineProfile, startDate: plan.startDate },
      startDate: plan.startDate,
    };
    const goals = freezeGoalTargets(plan.request.goals, scenarioStartValues(original.schedule, request));
    return { ...plan, request: { ...plan.request, goals } };
  } catch {
    return plan; // recorded unresolved intent remains available for explicit absolute-target review
  }
}

function digestFromOption(option: PlanOption): ProjectionDigest {
  const bands = option.bands?.series ?? {};
  const asPrescribed: ProjectionDigest['asPrescribed'] = {};
  const H = option.schedule.horizonDays;
  // planner bands start at t = 0 (length H + 1); the digest is indexed by plan day (index 0 = day 0's value)
  const byDay = (a: Float32Array): number[] => (a.length === H + 1 ? Array.from(a).slice(1) : Array.from(a));
  for (const [k, b] of Object.entries(bands) as Array<[SeriesId, { p10: Float32Array; p50: Float32Array; p90: Float32Array } | undefined]>) {
    if (!b) continue;
    asPrescribed[k] = { p10: byDay(b.p10), p50: byDay(b.p50), p90: byDay(b.p90) };
  }
  // (D8-02) without stochastic bands the forecast is the nominal path alone: it travels as P50 with P10 = P90 = P50 and
  // `bandMeta` 'none', so no reader takes it for a range (drift reads it as Unclear, never ahead/behind)
  const hasBands = Object.values(asPrescribed).some((b) => !!b);
  if (!hasBands && option.simulation.daily.scaleWeight) {
    const s = Array.from(option.simulation.daily.scaleWeight);
    asPrescribed.scaleWeight = { p10: s, p50: s, p90: s };
  }
  const warnings: SafetyNote[] = option.safetyItems ?? option.safetyNotes.map((text) => ({ text, severity: 'caution' as const }));
  const meta = !hasBands
    ? bandMetaFor('none', 0)
    : (Object.values(bands).find((b) => b?.meta)?.meta ?? (option.bands ? bandMetaFor('draws', option.bands.draws) : LEGACY_BAND_META));
  return {
    fromDay: 0,
    asPrescribed,
    // a start forecast has no revealed adherence yet: the realistic variant is explicitly unavailable (C2/D5-05)
    realistic: {},
    realisticStatus: 'unavailable',
    goals: option.scorecard.map((g) => ({ metric: g.metric as MetricId, endP50: g.band?.p50 ?? g.value, dateRange: null, ...(g.status ? { status: g.status } : {}) })),
    warnings,
    bandMeta: meta,
    stamp: stampDerived({ engineVersion: option.simulation.meta.engineVersion, registryHash: option.simulation.meta.registryHash, origin: 'original' }),
  };
}

const RUNG_TITLE: Record<RungId, string> = { hard: 'Hard', medium: 'Medium', easy: 'Easy' };

/** v1 option ids map to the ladder rungs (PLANNER_V2 §1.6: Hard / Medium / Easy replace A / B / C). */
export const RUNG_OF_OPTION: Readonly<Record<PlanOption['id'], RungId>> = { A: 'hard', B: 'medium', C: 'easy' };
export const OPTION_OF_RUNG: Readonly<Record<RungId, PlanOption['id']>> = { hard: 'A', medium: 'B', easy: 'C' };

interface CommonStart {
  startDate: LocalDate;
  name?: string;
  enforceDefaultDeficitCap?: boolean;
  experimentalTracking?: boolean;
  constraints?: PracticalConstraints;
  intentions?: PlanIntentions;
  checkInWeekday?: Weekday;
  sensitivities?: PlanSensitivities;
}

function buildDocs(ctx: StartContext, a: {
  name: string;
  enforceDefaultDeficitCap?: boolean;
  experimentalTracking?: boolean;
  rung: RungId | 'custom';
  origin: PlanDoc['origin'];
  request: PlannerRequestV2;
  profile: PersonProfile;
  schedule: Schedule;
  startDate: LocalDate;
  intentions: PlanIntentions;
  checkInWeekday: Weekday;
  forecast: ProjectionDigest;
  sensitivities: PlanSensitivities;
  provenance: PlanVersionDoc['provenance'];
  explanation: string[];
  /** (C5) the option's certificate as produced (revalidated at every lifecycle boundary; never authorizes by itself). */
  certificate?: SafetyCertificate;
  /** (C5) safety status at start; default 'unchecked' (a missing or unrevalidated certificate is never verified). */
  safetyStatus?: SafetyStatus;
  /** The request the source certificate bound (the planner run's request; default `request`). */
  sourceRequest?: PlannerRequestV2;
}): StartResult {
  const anchored = anchorSchedule(a.schedule, a.startDate);
  const H = anchored.schedule.horizonDays;
  const status: PlanDoc['status'] = a.startDate <= ctx.today ? 'active' : 'scheduled';
  const plan: PlanDoc & { id: Id } = {
    id: ctx.planId,
    name: a.name,
    rung: a.rung,
    origin: a.origin,
    status,
    startDate: a.startDate,
    plannedEndDate: addDays(a.startDate, H),
    request: freezeMuscleRetention({ ...a.request, ...((a.enforceDefaultDeficitCap !== undefined || a.experimentalTracking) ? { constraints: { ...a.request.constraints, ...(a.enforceDefaultDeficitCap !== undefined ? { enforceDefaultDeficitCap: a.enforceDefaultDeficitCap } : {}), ...(a.experimentalTracking ? { experimentalTracking: true, enforceDefaultDeficitCap: false } : {}) } } : {}), startDate: a.startDate, profile: { ...a.profile, startDate: a.startDate } }),
    baselineProfile: { ...a.profile, startDate: a.startDate },
    headVersion: 1,
    pauses: [],
    intentions: a.intentions,
    policy: { checkInWeekday: a.checkInWeekday, autoApplyLoadLowering: !a.experimentalTracking },
    createdAt: ctx.now,
  };
  // the forecast was computed for the unanchored schedule: its index k is the anchored plan day k − skippedDays
  const forecast: ProjectionDigest = { ...a.forecast, fromDay: a.forecast.fromDay - anchored.skippedDays };
  // (A1-004) the source certificate binds the source subject: kept on the version only when the final subject is the same
  const subject = { request: plan.request, schedule: anchored.schedule };
  const subjectChanged = !sameSafetySubject({ request: a.sourceRequest ?? a.request, schedule: a.schedule }, subject);
  const attach = a.certificate && !subjectChanged ? a.certificate : undefined;
  const version: PlanVersionDoc = {
    planId: ctx.planId,
    version: 1,
    parent: null,
    status: 'adopted',
    reason: 'start',
    effectiveFromDay: 0,
    schedule: anchored.schedule,
    genome: null,
    sessions: {},
    sensitivities: a.sensitivities,
    forecast,
    explanation: a.explanation,
    provenance: a.provenance,
    createdBy: ctx.createdBy,
    createdAt: ctx.now,
    ...(attach ? { certificate: attach } : {}),
    safetyStatus: a.safetyStatus ?? 'unchecked',
    contracts: CONTRACT_FINGERPRINT,
  };
  return { ok: true, plan, version, anchorNotes: anchored.notices, subject, ...(a.certificate ? { sourceCertificate: a.certificate } : {}), subjectChanged };
}

/**
 * Start from a planner rung (today a v1 `PlanOption`: options A/B/C map to hard/medium/easy). TODO(E6): accept
 * `RungPlan` and carry its genome and composed sessions; re-run `toActivePlan` when the start weekday moved the schedule.
 */
export function startFromRung(ctx: StartContext, option: PlanOption, request: PlannerRequest, rung: RungId, provenance: PlannerProvenanceV2 | null, s: CommonStart): StartOutcome {
  if (!isAllowedStartDate(ctx.today, s.startDate)) return { ok: false, reason: 'The start date must be today or within the next 28 days.' };
  const startValues = new Map(option.scorecard.map((g) => [g.goal, g.start] as const));
  const goals = freezeGoalTargets(request.goals, startValues);
  const prov: PlannerProvenanceV2 = provenance ?? ({ seed: '', tier: 'S', budgetEU: 0, euUsed: 0, registryHash: option.simulation.meta.registryHash, engineVersion: option.simulation.meta.engineVersion, libraryVersion: 0, structures: 0 } as PlannerProvenanceV2);
  return buildDocs(ctx, {
    name: s.name ?? `${RUNG_TITLE[rung]} plan`,
    ...(s.enforceDefaultDeficitCap !== undefined ? { enforceDefaultDeficitCap: s.enforceDefaultDeficitCap } : {}),
    ...(s.experimentalTracking ? { experimentalTracking: true } : {}),
    rung,
    origin: { kind: 'planner', requestHash: prov.seed, runAt: ctx.now },
    request: { ...request, goals },
    sourceRequest: request,
    profile: request.profile,
    schedule: option.schedule,
    startDate: s.startDate,
    intentions: s.intentions ?? {},
    checkInWeekday: s.checkInWeekday ?? (weekdayOf(s.startDate) as Weekday),
    forecast: digestFromOption(option),
    sensitivities: s.sensitivities ?? defaultSensitivities(`${ctx.planId}@1`),
    provenance: prov,
    explanation: option.explanation,
    ...(option.safety?.certificate ? { certificate: option.safety.certificate } : {}),
  });
}

/** Start from a Simulator scenario (rung 'custom', no genome); goals come from the person's goal set. */
export function startFromScenario(
  ctx: StartContext,
  scenario: { id: Id; rev: string; name: string; schedule: Schedule },
  profile: PersonProfile,
  goals: readonly RankedGoal[],
  s: CommonStart & { startValues?: ReadonlyMap<number, number> },
): StartOutcome {
  if (!isAllowedStartDate(ctx.today, s.startDate))
    return { ok: false, reason: 'The start date must be today or within the next 28 days.' };
  const anchored = anchorSchedule(scenario.schedule, s.startDate).schedule;
  const initial: PlannerRequestV2 = {
    profile: { ...profile, startDate: s.startDate },
    goals,
    horizonDays: anchored.horizonDays,
    startDate: s.startDate,
    ...(s.constraints ? { constraints: s.constraints } : {}),
  };
  // Relative intent belongs to this final scenario's initial operator, never a previous Planner scorecard.
  const startValues = s.startValues ?? scenarioStartValues(anchored, initial);
  const request: PlannerRequestV2 = { ...initial, goals: freezeGoalTargets(goals, startValues) };
  return buildDocs(ctx, {
    name: s.name ?? scenario.name,
    ...(s.enforceDefaultDeficitCap !== undefined ? { enforceDefaultDeficitCap: s.enforceDefaultDeficitCap } : {}),
    ...(s.experimentalTracking ? { experimentalTracking: true } : {}),
    rung: 'custom',
    origin: { kind: 'scenario', scenarioId: scenario.id, scenarioRev: scenario.rev },
    request,
    profile,
    schedule: scenario.schedule,
    startDate: s.startDate,
    intentions: s.intentions ?? {},
    checkInWeekday: s.checkInWeekday ?? (weekdayOf(s.startDate) as Weekday),
    forecast: {
      fromDay: 0,
      asPrescribed: {},
      realistic: {},
      realisticStatus: 'unavailable',
      goals: [],
      warnings: [],
    },
    sensitivities: s.sensitivities ?? defaultSensitivities(`${ctx.planId}@1`),
    provenance: ctx.versions,
    explanation: [],
  });
}
