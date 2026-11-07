/**
 * Planner-side goal capability (C6): how a goal resolves against the capability registry (`GOAL_CAPABILITY`), and the
 * status of a goal's forecast in one run (engine `outputStatus`, planner conditions, domain validity), closed over the
 * mathematical dependencies of the outputs.
 *
 *  - `resolveGoalCapability(goal)`: a goal the model can optimise plans (`plan` / `scenario`); a goal-shaped metric
 *    without an optimizable capability is `pendingReview` when it is a saved or imported goal (no current
 *    `capabilityVersion`: kept visible with its alternatives and what stays tracked, never remapped silently to another
 *    numeric objective) and `unavailable` when a new request asks for it (D2-06 adherence, D2-07 endocrine indices, D2-08
 *    keto adaptation, D8-05 BMD change, D8-08 micronutrient score, D8-09 generic endurance index).
 *  - `runGoalStatus(sim, metric, conditions)`: the status a goal's number travels with (C6: numbers and statuses travel
 *    separately) — `modelLimit` / `outOfDomain` from the run's domain validity (D1-08), else the worst of the capability
 *    status and the closed run status (an unsupported lean partition also makes fat, scale and body fat conditional,
 *    D1-05; an uncertain ketogenic lipid response makes LDL and ApoB limited, D7-07).
 *  - `guardedGoalValue` / `objectiveWithheld`: the objective value ranking uses — no credited benefit without a warrant
 *    (conservative references, no invented rates); `goalDisplayStatus`: what a score or forecast row shows (a withheld
 *    objective reads Limited, with no range, goal date or target attainment).
 *
 * Pure; no engine runs.
 */
import {
  CONTRACT_VERSIONS,
  hasCurrentTissueFatEndpoint,
  resolveCapabilityObjective,
  INTERPRETABLE_STATUSES,
  OBJECTIVE_STATUSES,
  OUTPUT_DEPENDENCIES,
  closeStatuses,
  worstStatus,
  type CapabilityAvailability,
  type OutputStatus,
} from '@/lib/bodyContracts';
import {
  GOAL_CAPABILITY,
  SERIES,
  SERIES_INDEX,
  isProductionGoalEligible,
  type MetricId,
  type SeriesDef,
  type SeriesId,
} from '../../types/metrics';
import type { SimulationResult } from '../../types/result';
import type { RankedGoal } from './types';
import type { ResolvedGoal } from './context';

/**
 * Version of the planner-side capability resolution and run-condition rules (part of derived planner artifacts, C7).
 * 2 (D4-05): body-fat goals read the tissue fat fraction of the composition binding, unavailable outputs are excluded from
 * objectives, and glycaemia/blood-pressure goals need a target.
 * 3 (A2-002/A2-024): registry-derived objective shapes and explicit saved endpoint identity.
 */
export const PLANNER_CAPABILITY_VERSION = 3;

// ---------------------------------------------------------------------------------------------------------------
// saved / imported / requested goals
// ---------------------------------------------------------------------------------------------------------------

export type GoalResolutionKind = 'plan' | 'scenario' | 'pendingReview' | 'unavailable';

/** What stays useful for a metric that is not an objective: measured values, logged observations, or mechanism only. */
export type GoalTracking = 'measured' | 'logged' | 'mechanism';

export interface GoalCapabilityResolution {
  metric: string;
  /** Registry availability (null for a metric that is not a recorded outcome). */
  availability: CapabilityAvailability | null;
  resolution: GoalResolutionKind;
  /** Inline status of the goal: Estimated / Scenario / Review / Unsupported. */
  status: OutputStatus;
  reasonCode: string;
  /** Goals the person may rank instead (offered, never substituted automatically). */
  alternatives: readonly MetricId[];
  /** What stays tracked when the goal is not planned (null when it plans). */
  tracking: GoalTracking | null;
  /** The goal was validated under an older (or no) capability contract: a saved or imported goal. */
  legacy: boolean;
}

/**
 * Non-objective metrics: what the person can plan instead and what stays tracked. Alternatives are only offered: an
 * adherence goal never silently becomes a hunger goal (D2-06), an adaptation target never becomes longer fasting
 * (D2-08), a BMD goal keeps loading/protein routes and measured DXA (D8-05), the generic endurance index keeps the broad
 * VO2max estimate and task-scoped manual tracking (D8-09), the micronutrient score keeps known nutrient intake (D8-08).
 */
const NON_OBJECTIVE: Readonly<
  Partial<Record<MetricId, { alternatives: readonly MetricId[]; tracking: GoalTracking }>>
> = {
  adherence: { alternatives: ['hunger'], tracking: 'logged' },
  ketoAdaptation: { alternatives: ['bhb'], tracking: 'mechanism' },
  igf1: { alternatives: [], tracking: 'measured' },
  leptin: { alternatives: [], tracking: 'mechanism' },
  t3: { alternatives: [], tracking: 'mechanism' },
  cortisol: { alternatives: [], tracking: 'mechanism' },
  testosterone: { alternatives: [], tracking: 'measured' },
  menstrualRisk: { alternatives: [], tracking: 'logged' },
  enduranceCapacity: { alternatives: ['vo2max', 'strength'], tracking: 'logged' },
  hipBmdChange: { alternatives: ['strength', 'leanTissue'], tracking: 'measured' },
  micronutrientScore: { alternatives: [], tracking: 'logged' },
  moodTier: { alternatives: [], tracking: 'logged' },
  sleepQuality: { alternatives: [], tracking: 'logged' },
  apoB: { alternatives: ['ldl'], tracking: 'measured' },
  hdl: { alternatives: [], tracking: 'measured' },
  leanMass: { alternatives: ['leanTissue', 'fatMass'], tracking: 'measured' },
  energyAvailability: { alternatives: [], tracking: 'mechanism' },
  autophagyIdx: { alternatives: [], tracking: 'mechanism' },
  mtorIdx: { alternatives: [], tracking: 'mechanism' },
  ampkIdx: { alternatives: [], tracking: 'mechanism' },
  mps: { alternatives: ['leanTissue'], tracking: 'mechanism' },
};

const defOf = (metric: string): SeriesDef | undefined => {
  const i = (SERIES_INDEX as Readonly<Record<string, number>>)[metric];
  return i === undefined ? undefined : (SERIES[i] as SeriesDef);
};

/** Whether a goal was validated under the current goal-capability contract (C6/D4-05). */
export function capabilityCurrent(goal: Pick<RankedGoal, 'capabilityVersion'>): boolean {
  return goal.capabilityVersion === CONTRACT_VERSIONS.goalCapability;
}

/**
 * How a ranked goal resolves (C6). Every request route, saved and imported goal goes through this: the capability
 * decides, never the legacy `SeriesDef.goal` shape alone. An outcome without an optimizable capability is
 * `pendingReview` when it comes from a saved/imported goal (`capabilityVersion` absent or older) — visible, with its
 * alternatives, never deleted or remapped — and `unavailable` in a new request.
 */
export function resolveGoalCapability(
  goal: Pick<RankedGoal, 'metric' | 'capabilityVersion'> & Partial<Pick<RankedGoal, 'endpointSemantics'>>,
): GoalCapabilityResolution {
  const metric = goal.metric as string;
  const legacy = !capabilityCurrent(goal);
  const def = defOf(metric);
  if (!def || def.kind !== 'metric') {
    return {
      metric,
      availability: null,
      resolution: 'unavailable',
      status: 'unavailable',
      reasonCode: 'notAnOutcome',
      alternatives: [],
      tracking: null,
      legacy,
    };
  }
  const cap = GOAL_CAPABILITY[metric as MetricId];
  if (metric === 'bodyFatPct' && !hasCurrentTissueFatEndpoint(goal.endpointSemantics)) {
    return {
      metric,
      availability: cap.availability,
      resolution: 'pendingReview',
      status: 'review',
      reasonCode: 'legacyEndpointBasis',
      alternatives: ['bodyFatPct', 'fatMass'],
      tracking: 'measured',
      legacy: true,
    };
  }
  if (isProductionGoalEligible(metric)) {
    const scenario = cap.availability === 'scenario';
    return {
      metric,
      availability: cap.availability,
      resolution: scenario ? 'scenario' : 'plan',
      status: scenario ? 'scenario' : 'estimated',
      reasonCode: cap.reasonCode,
      alternatives: [],
      tracking: null,
      legacy,
    };
  }
  const info = NON_OBJECTIVE[metric as MetricId];
  const alternatives = (info?.alternatives ?? []).filter((m) => isProductionGoalEligible(m));
  const tracking: GoalTracking =
    info?.tracking ?? (cap.availability === 'observedOnly' ? 'logged' : 'mechanism');
  // a saved/imported goal stays visible for review even when its metric is display-only now (e.g. a BMD-change goal from
  // before D8-05); only a new request is refused outright
  const review = legacy;
  return {
    metric,
    availability: cap.availability,
    resolution: review ? 'pendingReview' : 'unavailable',
    status: review ? 'review' : 'unavailable',
    reasonCode: cap.reasonCode,
    alternatives,
    tracking,
    legacy,
  };
}

/**
 * Quantities whose desirability is non-monotone and whose capability requires a target/band (C6/D4-05: glycaemia and
 * blood pressure). Open-ended minimisation of them is never an objective, and no universal target is invented.
 */
export const TARGET_BAND_REQUIRED: ReadonlySet<string> = new Set(
  (Object.keys(GOAL_CAPABILITY) as MetricId[]).filter((m) => GOAL_CAPABILITY[m].satiation === 'required'),
);

/** One capability-driven objective resolver for editor, request, reach, Ideal and replan. */
export function resolveObjectiveShape(goal: Pick<RankedGoal, 'metric' | 'direction' | 'target'>) {
  const cap = GOAL_CAPABILITY[goal.metric as MetricId];
  return resolveCapabilityObjective(cap ?? { objectives: [], satiation: 'none' }, goal);
}

export function objectiveShapeIssue(
  goal: Pick<RankedGoal, 'metric' | 'direction' | 'target'>,
): 'needsTargetBand' | 'unsupportedObjective' | null {
  const resolved = resolveObjectiveShape(goal);
  return resolved.supported
    ? null
    : resolved.reasonCode === 'needsTargetBand'
      ? 'needsTargetBand'
      : 'unsupportedObjective';
}

/** Plain short text of a non-plannable goal for the request's problem list (no explainer paragraph). */
export function goalResolutionText(label: string, r: GoalCapabilityResolution): string {
  const alt = r.alternatives.map((m) => defOf(m)?.label ?? m);
  const instead = alt.length ? ` Rank ${alt.join(' or ')} instead.` : '';
  const tracked =
    r.tracking === 'measured'
      ? ' Measured values stay tracked.'
      : r.tracking === 'logged'
        ? ' What you log stays tracked.'
        : '';
  if (r.reasonCode === 'legacyEndpointBasis')
    return `"${label}": Review — legacy goal basis. Select Tissue fat and confirm its target.`;
  const head =
    r.resolution === 'pendingReview'
      ? `"${label}" cannot be used as a goal any more (Review): the model has no validated objective for it.`
      : `"${label}" cannot be used as a goal: the model has no validated objective for it.`;
  return `${head}${instead}${tracked}`;
}

// ---------------------------------------------------------------------------------------------------------------
// run statuses
// ---------------------------------------------------------------------------------------------------------------

/** A planner-detected condition that changes a series' status from a plan day on (D1-05, D7-07). */
export interface PlannerCondition {
  series: SeriesId;
  status: OutputStatus;
  reasonCode: string;
  fromDay: number;
}

export interface StatusEntry {
  status: OutputStatus;
  reasonCode: string;
}

/**
 * Reason codes under which a lean-tissue status means the surplus/deficit partition is unsupported (D1-05): the planner's
 * own routing flag and the composition provider's protein-domain codes. A positive lean change under such a status earns
 * no objective benefit; other lean statuses (a labelled scenario capability) keep their objective.
 */
export const LEAN_PARTITION_UNSUPPORTED = /protein|partition/i;
/** Reason codes under which an LDL status means the ketogenic lipid response is uncertain (D7-07). */
export const KETOGENIC_RESPONSE_UNCERTAIN = /keto/i;

/** `b` is strictly worse than `a` (or `a` is absent). */
const worse = (a: OutputStatus | undefined, b: OutputStatus): boolean =>
  a === undefined || (worstStatus(a, b) === b && a !== b);

/**
 * The run's per-series statuses (engine `outputStatus` plus planner conditions), closed over `OUTPUT_DEPENDENCIES`.
 * A dependent's reason names its upstream (`dependsOn:leanTissue`).
 */
export function closedRunStatuses(
  sim: Pick<SimulationResult, 'meta'>,
  conditions: readonly PlannerCondition[] = [],
): Record<string, StatusEntry> {
  const base: Record<string, OutputStatus> = {};
  const reason: Record<string, string> = {};
  for (const [id, m] of Object.entries(sim.meta.outputStatus ?? {})) {
    if (!m) continue;
    base[id] = m.status;
    reason[id] = m.reasonCode;
  }
  for (const c of conditions) {
    if (worse(base[c.series], c.status)) {
      base[c.series] = c.status;
      reason[c.series] = c.reasonCode;
    }
  }
  const closed = closeStatuses(base);
  // the root cause of an induced status: the worst upstream (on a tie, one whose status is its own), followed to its root
  const rootOf = (id: string, depth = 0): string => {
    if (closed[id] === base[id] || depth > 16) return id;
    let up: string | null = null;
    for (const u of OUTPUT_DEPENDENCIES[id] ?? []) {
      const su = closed[u];
      if (!su) continue;
      if (
        up === null ||
        worse(closed[up], su) ||
        (su === closed[up] && su === base[u] && closed[up] !== base[up])
      )
        up = u;
    }
    return up === null ? id : rootOf(up, depth + 1);
  };
  const out: Record<string, StatusEntry> = {};
  for (const [id, st] of Object.entries(closed)) {
    out[id] =
      st === base[id]
        ? { status: st, reasonCode: reason[id] ?? 'ok' }
        : { status: st, reasonCode: `dependsOn:${rootOf(id)}` };
  }
  return out;
}

/** Status of a metric from its capability alone (supported → estimated, scenario → scenario, else unavailable). */
export function capabilityStatus(metric: string): OutputStatus {
  const cap = GOAL_CAPABILITY[metric as MetricId];
  if (!cap || !isProductionGoalEligible(metric)) return 'unavailable';
  return cap.availability === 'scenario' ? 'scenario' : 'estimated';
}

/**
 * Status a goal's forecast travels with in one run (C6): the run's domain validity first (D1-08: a model-limit
 * termination or an out-of-domain run is not a forecast), then the worse of the capability status and the closed run
 * status of the metric (scale-weight goals read tissue mass: their status is closed over fat and lean).
 */
export function runGoalStatus(
  sim: Pick<SimulationResult, 'meta'>,
  metric: string,
  conditions: readonly PlannerCondition[] = [],
): StatusEntry {
  return goalStatusFromClosed(closedRunStatuses(sim, conditions), metric, sim.meta.validity);
}

/** `runGoalStatus` from an already closed status map (one closure per run, many goals). */
export function goalStatusFromClosed(
  closed: Readonly<Record<string, StatusEntry>>,
  metric: string,
  validity?: SimulationResult['meta']['validity'],
): StatusEntry {
  if (validity?.status === 'modelLimit') return { status: 'modelLimit', reasonCode: validity.reasonCode };
  if (validity?.status === 'outsideDomain') return { status: 'outOfDomain', reasonCode: validity.reasonCode };
  const capSt = capabilityStatus(metric);
  const run = closed[metric];
  if (run && worse(capSt, run.status)) return run;
  return {
    status: capSt,
    reasonCode:
      capSt === 'unavailable' ? (GOAL_CAPABILITY[metric as MetricId]?.reasonCode ?? 'notAnOutcome') : 'ok',
  };
}

/** Whether a status lets a goal's number count as supported benefit in ranking (C6 `OBJECTIVE_STATUSES` or a labelled scenario capability). */
export function statusAllowsObjective(status: OutputStatus): boolean {
  return OBJECTIVE_STATUSES.has(status) || status === 'scenario';
}

/** Lean-gain goal metrics whose positive change depends on the tissue partition (D1-05). */
export const LEAN_GAIN_METRICS: ReadonlySet<string> = new Set([
  'leanTissue',
  'skeletalMuscle',
  'rtMuscleGain',
  'leanMass',
]);
/** Lipid goal metrics whose response to a ketogenic pattern is uncertain (D7-07). */
export const KETO_LIPID_METRICS: ReadonlySet<string> = new Set(['ldl', 'apoB']);

/** The lean partition of this run is unsupported (D1-05): its closed lean status carries a partition/protein reason. */
export function leanPartitionUnsupported(statuses: Readonly<Record<string, StatusEntry>>): boolean {
  const s = statuses['leanTissue'];
  return !!s && !OBJECTIVE_STATUSES.has(s.status) && LEAN_PARTITION_UNSUPPORTED.test(s.reasonCode);
}

/** The ketogenic lipid response of this run is uncertain (D7-07). */
export function ketogenicLipidUncertain(statuses: Readonly<Record<string, StatusEntry>>): boolean {
  const s = statuses['ldl'];
  return !!s && !OBJECTIVE_STATUSES.has(s.status) && KETOGENIC_RESPONSE_UNCERTAIN.test(s.reasonCode);
}

/**
 * Objective value of a goal functional under the run's statuses (C6; every route that ranks plans applies it): no
 * credited benefit where the model has no warrant for one, using conservative references rather than invented rates.
 *  - D1-05: an unsupported lean partition earns no positive lean change (the conservative dLT = 0 reference: the start
 *    value); a loss stays a loss.
 *  - D7-07: an uncertain ketogenic lipid response earns no LDL/ApoB reduction (zero modelled response is not zero
 *    biological response); a modelled rise stays.
 *  - D1-08: an out-of-domain run credits no change at all (unsupported precision cannot dominate). A model-limit
 *    termination is infeasible through the abort margin, so its clipped value is never selected.
 * `sense` is +1 when the goal wants the metric higher. Time-to-target functionals are left to their own search.
 */
export function guardedGoalValue(
  metric: string,
  sense: 1 | -1,
  value: number,
  start: number,
  statuses: Readonly<Record<string, StatusEntry>>,
  validity?: SimulationResult['meta']['validity'],
): number {
  if (!Number.isFinite(value) || !Number.isFinite(start)) return value;
  if (validity?.status === 'outsideDomain') return start;
  if (LEAN_GAIN_METRICS.has(metric) && sense > 0 && leanPartitionUnsupported(statuses))
    return Math.min(value, start);
  if (KETO_LIPID_METRICS.has(metric) && sense < 0 && ketogenicLipidUncertain(statuses))
    return Math.max(value, start);
  return value;
}

/** Whether `guardedGoalValue` withholds this goal's benefit in the run (its objective is a conservative reference). */
export function objectiveWithheld(
  metric: string,
  sense: 1 | -1,
  statuses: Readonly<Record<string, StatusEntry>>,
  validity?: SimulationResult['meta']['validity'],
): boolean {
  if (validity?.status === 'outsideDomain') return true;
  return (
    (LEAN_GAIN_METRICS.has(metric) && sense > 0 && leanPartitionUnsupported(statuses)) ||
    (KETO_LIPID_METRICS.has(metric) && sense < 0 && ketogenicLipidUncertain(statuses))
  );
}

/** A goal row's displayed status and whether its range, goal date and target attainment are withheld. */
export interface GoalDisplayStatus extends StatusEntry {
  withheld: boolean;
}

/**
 * Status a goal score or forecast row shows (C6): a status that forbids interpretation (model limit, outside the domain,
 * unavailable) withholds the range, the goal date and any target attainment; so does a goal whose benefit the objective
 * guard withholds (D1-05 unsupported lean partition, D7-07 uncertain ketogenic lipid response) — it reads "Limited" with
 * the partition/response reason, never a precise kg or mmol/L range. Other statuses keep their range (D8-02: a
 * parameter-sensitivity range, coverage unvalidated).
 */
export function goalDisplayStatus(
  closed: Readonly<Record<string, StatusEntry>>,
  metric: string,
  sense: 1 | -1,
  validity?: SimulationResult['meta']['validity'],
): GoalDisplayStatus {
  const st = goalStatusFromClosed(closed, metric, validity);
  if (!INTERPRETABLE_STATUSES.has(st.status)) return { ...st, withheld: true };
  if (objectiveWithheld(metric, sense, closed, validity)) {
    const root = LEAN_GAIN_METRICS.has(metric) ? closed['leanTissue'] : closed['ldl'];
    return { status: 'limited', reasonCode: root?.reasonCode ?? st.reasonCode, withheld: true };
  }
  return { ...st, withheld: false };
}

/**
 * +1 when the goal wants its metric higher (maximise, or a target above its start), −1 otherwise. `start` is the run's
 * start value (the profile estimate when not finite).
 */
export function goalSense(
  g: Pick<ResolvedGoal, 'direction' | 'spec' | 'startEstimate' | 'def'>,
  start: number,
): 1 | -1 {
  if (g.direction === 'maximise') return 1;
  if (g.direction === 'minimise') return -1;
  const t = g.spec.target;
  if (t === undefined || !Number.isFinite(t)) return g.def.direction === 'down' ? -1 : 1;
  const ref = Number.isFinite(start) ? start : g.startEstimate;
  const target = g.spec.targetKind === 'change' ? ref + t : t;
  return target < ref ? -1 : 1;
}
