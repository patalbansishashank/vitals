/**
 * Probe plans for the evidence-coverage audit (PLANNER_V2_SPEC §6.1 `probe`, §6.3 check 2; R6 §7.2 item 2).
 *
 * A probe is a person, a base plan built from the planner's own grammar (`makeStructure` + `decodePlan` + `repairSchedule`,
 * so a lever is switched exactly the way the planner writes it into the Schedule) and a toggle: a gene moved from one
 * corner to the other, a supplement flag, an overlay, a multi-day fast or a different phase sequence. Running the engine
 * on the base and the toggled schedule gives the finite difference of every goal metric (mechanism liveness); running
 * it again with one engine module replaced by an inert stub shows whether that module carries the effect.
 *
 * Pure (no clock, no IO). Engine runs use the Simulator's mode with daily recording of every series.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import { SERIES, type MetricId } from '../../types/metrics';
import type { AnyEngineModule } from '../../types/module';
import type { PersonProfile } from '../../types/profile';
import type { SimulationResult } from '../../types/result';
import type { Schedule } from '../../types/schedule';
import { compileRequest, type PlanningContext } from '../domain/context';
import { decodePlan } from '../domain/decode';
import { goalValue, type GoalBinding } from '../domain/goalSpecs';
import { repairSchedule } from '../domain/repair';
import { makeStructure, type PlanSkeleton, type SegmentSkeleton } from '../domain/skeleton';
import type { ProbePersonaId, ProbePlanId, ProbeToggle } from '../domain/evidenceGraph';
import type { PlannerRequest, RankedGoal } from '../domain/types';

export type ProbePersona = ProbePersonaId;
export type { ProbePlanId, ProbeToggle };

export interface ProbeSpec {
  readonly persona: ProbePersona;
  readonly base: ProbePlanId;
  readonly toggle: ProbeToggle;
}

/** Probe personas (R6 §7.2: three personas). Same shapes as the planner's face-validity personas. */
export const PROBE_PERSONAS: Readonly<Record<ProbePersona, PersonProfile>> = {
  man88: {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 38, heightCm: 180, weightKg: 88, knownBodyFatPct: 25 },
    habits: { typicalSteps: 6500, sessionsPerWeek: 2, trainingHistory: 'lt1y', bedTimeH: 23.5, wakeTimeH: 6 },
    startDate: '2026-10-05',
  },
  woman78: {
    schemaVersion: 1,
    body: { sex: 'female', ageYears: 42, heightCm: 165, weightKg: 78, knownBodyFatPct: 38 },
    habits: { typicalSteps: 6000, sessionsPerWeek: 1, trainingHistory: 'none', bedTimeH: 23, wakeTimeH: 6.5 },
    startDate: '2026-10-05',
  },
  leanTrained: {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 28, heightCm: 178, weightKg: 72, knownBodyFatPct: 13 },
    habits: { typicalSteps: 9000, sessionsPerWeek: 4, trainingHistory: 'gt3y', bedTimeH: 23, wakeTimeH: 6.5 },
    startDate: '2026-10-05',
  },
};

/** Probe horizon, days (long enough for a 72-h fast with its recovery and a diet-break cycle). */
export const PROBE_HORIZON_DAYS = 84;

/**
 * The probe request: a transient-marker goal and a lipid goal (classes that force no training or protein floors, so those
 * genes span their full ranges, while fasting is offered so repair keeps the fasts), every consent the persona can hold
 * (T3 fasting tier, the omega-3 opt-in), sleep free to change and wide practical limits.
 */
export function probeRequest(
  persona: ProbePersona,
  goals: readonly RankedGoal[] = [
    { metric: 'autophagyIdx', direction: 'maximise' },
    { metric: 'ldl', direction: 'minimise' },
  ],
): PlannerRequest {
  return {
    profile: PROBE_PERSONAS[persona],
    goals,
    horizonDays: PROBE_HORIZON_DAYS,
    constraints: {
      trainingDaysPerWeek: { min: 0, max: 4 },
      cardioDaysPerWeek: { min: 0, max: 4 },
      steps: { min: 4000, max: 12000 },
      sleepFixed: false,
      mealsPerDay: { min: 2, max: 4 },
    },
    safety: { optIns: { fastingTier: 'T3', levers: ['L8', 'omega3', 'L7', 'creatine'] } },
  };
}

const ctxCache = new Map<ProbePersona, PlanningContext>();
export function probeContext(persona: ProbePersona): PlanningContext {
  let c = ctxCache.get(persona);
  if (!c) {
    c = compileRequest(probeRequest(persona));
    ctxCache.set(persona, c);
  }
  return c;
}

const BASE_SEGMENTS: Readonly<Record<ProbePlanId, readonly SegmentSkeleton[]>> = {
  maintenance: [{ kind: 'phase', block: 'B0' }],
  deficit: [{ kind: 'phase', block: 'B1' }],
  surplus: [{ kind: 'phase', block: 'B23' }],
  veryLowCarb: [{ kind: 'phase', block: 'B2' }],
};

function baseSkeleton(base: ProbePlanId): PlanSkeleton {
  return { baseline: false, segments: BASE_SEGMENTS[base], overlay: null, event: null, creatine: false, omega3: false, viscousFibre: false, sleepExtension: false };
}

/** Repaired schedule of a skeleton with gene overrides (unit coordinates by path; others at the structure default). */
export function probeSchedule(ctx: PlanningContext, sk: PlanSkeleton, genes: Readonly<Record<string, number>> = {}): { schedule: Schedule; missing: string[] } {
  const st = makeStructure(ctx, sk);
  const x = Float64Array.from(st.x0);
  const missing: string[] = [];
  for (const [path, u] of Object.entries(genes)) {
    const i = st.geneIndex[path];
    if (i === undefined) missing.push(path);
    else x[i] = u;
  }
  const plan = decodePlan(ctx, st, x);
  return { schedule: repairSchedule(ctx, plan.schedule, plan).schedule, missing };
}

/** Base and toggled schedules of a probe (`missing`: gene paths the structure does not carry, i.e. a dead toggle). */
export function probePair(spec: ProbeSpec): { ctx: PlanningContext; base: Schedule; toggled: Schedule; missing: string[] } {
  const ctx = probeContext(spec.persona);
  const sk = baseSkeleton(spec.base);
  const t = spec.toggle;
  if (t.kind === 'gene') {
    const a = probeSchedule(ctx, sk, { [t.path]: t.from ?? 0 });
    const b = probeSchedule(ctx, sk, { [t.path]: t.to ?? 1 });
    return { ctx, base: a.schedule, toggled: b.schedule, missing: [...new Set([...a.missing, ...b.missing])] };
  }
  const base = probeSchedule(ctx, sk).schedule;
  const on: PlanSkeleton =
    t.kind === 'flag'
      ? { ...sk, [t.flag]: true }
      : t.kind === 'overlay'
        ? { ...sk, overlay: t.overlay }
        : t.kind === 'event'
          ? { ...sk, event: { lever: 'waterFast', durationH: t.durationH } }
          : { ...sk, segments: t.segments as readonly SegmentSkeleton[] };
  const tog = probeSchedule(ctx, on, t.genes ?? {});
  return { ctx, base, toggled: tog.schedule, missing: tog.missing };
}

// ---------------------------------------------------------------------------------------------------------------
// engine runs
// ---------------------------------------------------------------------------------------------------------------

/**
 * An inert stand-in for one module: it initialises its state and bus signals as usual and then never changes them (no
 * hourly or daily dynamics, records its initial values). Used to show that an edge's effect travels through that module.
 */
export function inertModule(m: AnyEngineModule): AnyEngineModule {
  return {
    ...m,
    startDay: () => undefined,
    stepHour: () => undefined,
    endOfDay: () => undefined,
    ...(m.endBurnIn ? { endBurnIn: () => undefined } : {}),
  };
}

export function modulesWithout(stub: string | null): readonly AnyEngineModule[] {
  return stub === null ? MODULES : MODULES.map((m) => (m.id === stub ? inertModule(m) : m));
}

/** Simulator-mode run, daily records of every series. Throws are returned as null (a stub may break a run). */
export function runProbe(ctx: PlanningContext, schedule: Schedule, stub: string | null = null): SimulationResult | null {
  try {
    const cs = compileSchedule(schedule, ctx.rp);
    return runEngine(ctx.rp, cs, { mode: 'simulate', record: 'daily', burnInDays: 14 }, modulesWithout(stub));
  } catch {
    return null;
  }
}

/** Goal-eligible metrics (the planner's goal list). */
export const GOAL_METRICS: readonly MetricId[] = SERIES.filter((d) => d.kind === 'metric' && d.goal !== 'none').map((d) => d.id as MetricId);

const bindingCache = new Map<string, GoalBinding>();
/** The planner's own functional for a metric (end mean or horizon mean; scale weight read as tissue mass). */
export function bindingFor(metric: MetricId): GoalBinding {
  let b = bindingCache.get(metric);
  if (!b) {
    const g = compileRequest({ profile: PROBE_PERSONAS.man88, goals: [{ metric, direction: 'maximise' }], horizonDays: PROBE_HORIZON_DAYS }).goals[0];
    b = { metric, functional: g?.functional ?? 'end', useTissueMass: metric === 'scaleWeight' };
    bindingCache.set(metric, b);
  }
  return b;
}

/** Goal functional of a metric on a run (NaN when the run failed). */
export function metricValue(ctx: PlanningContext, sim: SimulationResult | null, metric: MetricId): number {
  if (!sim) return Number.NaN;
  return goalValue(sim, bindingFor(metric), ctx);
}
