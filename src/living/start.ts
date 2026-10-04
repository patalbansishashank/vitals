/**
 * "Start this plan" (docs/SUITE_SPEC.md §3.1-3.2, §6.3): a rung (v1 `PlanOption` today, v2 `RungPlan` later) or a scenario
 * becomes a `PlanDoc` plus its first `PlanVersionDoc` (reason 'start'): schedule anchored to the chosen start date, goal
 * targets frozen as ABSOLUTE values (a "lose 8 kg" goal stays measured from the plan start), the person at day 0 frozen as
 * `baselineProfile`, adherence weights from the planner (or the documented defaults), the forecast digest, implementation
 * intentions. Pure: ids and the clock come from the caller (CommandContext). The Ideal is never startable as is.
 */
import type { MetricId, PersonProfile, Schedule, SeriesId } from '@/engine';
import type { PlanOption, PlannerRequest, RankedGoal, SafetyNote } from '@/engine/planner/domain/types';
import { addDays, weekdayOf } from './dates';
import { anchorSchedule, isAllowedStartDate } from './calendar';
import { defaultSensitivities } from './prescription';
import type { PlannerProvenanceV2, PlannerRequestV2, PlanSensitivities, RungId } from './plannerContract';
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
}

export type StartOutcome = StartResult | { ok: false; reason: string };

/** Goals with every 'change' target converted to an absolute value from the plan's start values (§3.2). */
export function freezeGoalTargets(goals: readonly RankedGoal[], startValues: ReadonlyMap<number, number>): RankedGoal[] {
  return goals.map((g, k) => {
    if (g.targetKind !== 'change' || g.target === undefined) return { ...g };
    const start = startValues.get(k);
    if (start === undefined || !Number.isFinite(start)) return { ...g };
    return { ...g, target: start + g.target, targetKind: 'absolute' };
  });
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
  if (!asPrescribed.scaleWeight && option.simulation.daily.scaleWeight) {
    const s = Array.from(option.simulation.daily.scaleWeight);
    asPrescribed.scaleWeight = { p10: s, p50: s, p90: s };
  }
  const warnings: SafetyNote[] = option.safetyItems ?? option.safetyNotes.map((text) => ({ text, severity: 'caution' as const }));
  return {
    fromDay: 0,
    asPrescribed,
    realistic: {},
    goals: option.scorecard.map((g) => ({ metric: g.metric as MetricId, endP50: g.band?.p50 ?? g.value, dateRange: null })),
    warnings,
  };
}

const RUNG_TITLE: Record<RungId, string> = { hard: 'Hard', medium: 'Medium', easy: 'Easy' };

/** v1 option ids map to the ladder rungs (PLANNER_V2 §1.6: Hard / Medium / Easy replace A / B / C). */
export const RUNG_OF_OPTION: Readonly<Record<PlanOption['id'], RungId>> = { A: 'hard', B: 'medium', C: 'easy' };
export const OPTION_OF_RUNG: Readonly<Record<RungId, PlanOption['id']>> = { hard: 'A', medium: 'B', easy: 'C' };

interface CommonStart {
  startDate: LocalDate;
  name?: string;
  intentions?: PlanIntentions;
  checkInWeekday?: Weekday;
  sensitivities?: PlanSensitivities;
}

function buildDocs(ctx: StartContext, a: {
  name: string;
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
    request: { ...a.request, startDate: a.startDate, profile: { ...a.profile, startDate: a.startDate } },
    baselineProfile: { ...a.profile, startDate: a.startDate },
    headVersion: 1,
    pauses: [],
    intentions: a.intentions,
    policy: { checkInWeekday: a.checkInWeekday, autoApplyLoadLowering: true },
    createdAt: ctx.now,
  };
  // the forecast was computed for the unanchored schedule: its index k is the anchored plan day k − skippedDays
  const forecast: ProjectionDigest = { ...a.forecast, fromDay: a.forecast.fromDay - anchored.skippedDays };
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
  };
  return { ok: true, plan, version, anchorNotes: anchored.notices };
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
    rung,
    origin: { kind: 'planner', requestHash: prov.seed, runAt: ctx.now },
    request: { ...request, goals },
    profile: request.profile,
    schedule: option.schedule,
    startDate: s.startDate,
    intentions: s.intentions ?? {},
    checkInWeekday: s.checkInWeekday ?? (weekdayOf(s.startDate) as Weekday),
    forecast: digestFromOption(option),
    sensitivities: s.sensitivities ?? defaultSensitivities(`${ctx.planId}@1`),
    provenance: prov,
    explanation: option.explanation,
  });
}

/** Start from a Simulator scenario (rung 'custom', no genome); goals come from the person's goal set. */
export function startFromScenario(ctx: StartContext, scenario: { id: Id; rev: string; name: string; schedule: Schedule }, profile: PersonProfile, goals: readonly RankedGoal[], s: CommonStart & { startValues?: ReadonlyMap<number, number> }): StartOutcome {
  if (!isAllowedStartDate(ctx.today, s.startDate)) return { ok: false, reason: 'The start date must be today or within the next 28 days.' };
  const request: PlannerRequestV2 = { profile, goals: freezeGoalTargets(goals, s.startValues ?? new Map()), horizonDays: scenario.schedule.horizonDays, startDate: s.startDate };
  return buildDocs(ctx, {
    name: s.name ?? scenario.name,
    rung: 'custom',
    origin: { kind: 'scenario', scenarioId: scenario.id, scenarioRev: scenario.rev },
    request,
    profile,
    schedule: scenario.schedule,
    startDate: s.startDate,
    intentions: s.intentions ?? {},
    checkInWeekday: s.checkInWeekday ?? (weekdayOf(s.startDate) as Weekday),
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] },
    sensitivities: s.sensitivities ?? defaultSensitivities(`${ctx.planId}@1`),
    provenance: ctx.versions,
    explanation: [],
  });
}
