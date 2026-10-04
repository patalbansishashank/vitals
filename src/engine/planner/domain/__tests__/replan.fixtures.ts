/**
 * Fixtures of the re-plan tests: a small genome-based plan (decoded from a real skeleton, no planner run), its confirmed
 * state from a replay with a day-stamped snapshot, logs and adherence.
 */
import { runReplay } from '../../../assimilation/replay';
import type { PersonProfile } from '../../../types/profile';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import { compileRequest, type PlanningContext } from '../context';
import { decodePlan } from '../decode';
import { repairSchedule } from '../repair';
import type { ActivePlanRecord, BlockAdherence, ConfirmedState, LoggedDay, ReplanKind, ReplanRequest, ReplanTrigger } from '../replanTypes';
import { dateAt, dayTemplate } from '../sensitivities';
import { enumerateStructures, type SkeletonStructure } from '../skeleton';
import type { PlannerRequestV2, RankedGoal } from '../types';

export const START = '2026-10-05'; // a Monday

export const PERSON: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95, knownBodyFatPct: 28 },
  habits: { typicalSteps: 6000, sessionsPerWeek: 2, trainingHistory: 'lt1y' },
  startDate: START,
};

/** Fat mass to an absolute 22 kg (frozen), lean tissue kept as high as possible. */
export const GOALS: RankedGoal[] = [
  { metric: 'fatMass', direction: 'target', target: 22, targetKind: 'absolute' },
  { metric: 'leanTissue', direction: 'maximise' },
];

export function baseRequest(extra: Partial<PlannerRequestV2> = {}): PlannerRequestV2 {
  // consented to creatine (supplements are planned only with the opt-in), so the structure set is the full one
  return { profile: PERSON, goals: GOALS, horizonDays: 28, startDate: START, seed: 7, safety: { optIns: { levers: ['L7', 'creatine'] } }, ...extra };
}

export interface Fixture {
  ctx: PlanningContext;
  structure: SkeletonStructure;
  x: Float64Array;
  plan: ActivePlanRecord;
}

/** A plan decoded from skeleton `structureId` (first deficit structure when absent) with genome `x` (block defaults). */
export function makePlan(opts: { request?: PlannerRequestV2; structureId?: string; pick?: (st: SkeletonStructure) => boolean; x?: (st: SkeletonStructure) => Float64Array; kind?: ActivePlanRecord['kind'] } = {}): Fixture {
  const request = opts.request ?? baseRequest();
  const ctx = compileRequest(request);
  const sts = enumerateStructures(ctx);
  const st = sts.find((s) => (opts.structureId ? s.id === opts.structureId : opts.pick ? opts.pick(s) : !s.skeleton.baseline && s.skeleton.segments.length === 1 && s.skeleton.overlay === null && s.skeleton.event === null && s.id.startsWith('B1')))!;
  if (!st) throw new Error(`no structure ${opts.structureId ?? ''}`);
  const x = opts.x ? opts.x(st) : Float64Array.from(st.x0);
  const dec = decodePlan(ctx, st, x);
  const schedule = repairSchedule(ctx, dec.schedule, dec).schedule;
  const plan: ActivePlanRecord = {
    planId: 'p-test',
    version: 1,
    kind: opts.kind ?? 'medium',
    request,
    startDate: START,
    endDate: dateAt(START, request.horizonDays),
    structureId: st.id,
    genome: Array.from(x),
    schedule,
    provenance: { seed: 'fixture', tier: 'S', budgetEU: 0, euUsed: 0, registryHash: '', engineVersion: '', libraryVersion: 0, structures: 0, plannerVersion: 2, replanFrame: { offset: 0, horizonDays: request.horizonDays, weightKg: request.profile.body.weightKg } },
  };
  return { ctx, structure: st, x, plan };
}

/** Confirmed state at `anchorDay` from a replay of `realised` (default: the plan as prescribed). */
export function confirmedState(plan: ActivePlanRecord, anchorDay: number, opts: { realised?: Schedule; deltaMean?: number; deltaSd?: number } = {}): ConfirmedState {
  const r = runReplay({ profile: plan.request.profile, schedule: opts.realised ?? plan.schedule, captureAt: [anchorDay] });
  const snap = r.snapshots[anchorDay]!;
  const kg = r.scaleWakeKg[anchorDay - 1] ?? plan.request.profile.body.weightKg;
  return { anchorDate: dateAt(plan.startDate, anchorDay), snapshot: snap, energyBiasKcal: { mean: opts.deltaMean ?? 0, sd: opts.deltaSd ?? 80 }, trendWeight: { kg, sd: 0.3 } };
}

/** Logged days [from, to) as prescribed, with optional per-day template edits. */
export function logsAsPlanned(plan: ActivePlanRecord, from: number, to: number, edit?: (d: number, t: DayTemplate) => DayTemplate): LoggedDay[] {
  const out: LoggedDay[] = [];
  for (let d = from; d < to; d++) {
    const t = dayTemplate(plan.schedule, d);
    out.push({ date: dateAt(plan.startDate, d), inputs: edit ? edit(d, t) : t, items: [], coverage: 1 });
  }
  return out;
}

export const FULL_ADHERENCE: BlockAdherence[] = (['energy', 'protein', 'window', 'fast', 'rtSession', 'cardioSession', 'steps', 'sleep', 'supplement'] as const).map((type) => ({ type, a: 1000, b: 0, opportunities: 50 }));

export function replanRequest(plan: ActivePlanRecord, state: ConfirmedState, today: number, kind: ReplanKind, extra: Partial<ReplanRequest> = {}): ReplanRequest {
  const trigger: ReplanTrigger = kind === 'light' ? 'nudge' : kind === 'weekly' ? 'checkin' : kind === 'user' ? 'user' : 'absence';
  return { kind, today: dateAt(plan.startDate, today), plan, state, logs: [], adherence: FULL_ADHERENCE, trigger, ...extra };
}
