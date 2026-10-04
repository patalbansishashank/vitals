/**
 * Planner store: the goal set of the Planner (IA §1 "Goal set") — ranked goals, horizon, practical limits — plus the
 * in-memory state of the optimiser run and its result. A projection of the `goals/me` document; boot cache and export
 * key `vitals.planner`.
 *
 * - Persisted (versioned): goals, horizon, start date, the limits the user changed (`constraints` holds overrides
 *   only; untouched limits are derived from Your body → Habits at render time), strictness, the hash of the last
 *   request that was run and when. Changes go through `goals.edit`.
 * - In memory only: the run (status, progress, convergence traces) and the `PlannerResult`. Results are recomputed,
 *   never stored (IA §6: projections are excluded from exports), and are **stale** when the request built from the
 *   current goals + limits + body + safety differs from `run.requestHash` (`isPlannerResultStale`). The run is driven
 *   by the `planner.find` job; the lifecycle actions below are its derive-scope writers.
 * - Goal rules live in the goal ops so every entry point agrees: at most `MAX_PLANNER_GOALS` goals, no duplicates.
 */
import { dispatchSync, outputOf } from '@/commands/bus';
import '@/commands/defs/goals'; // registers the commands the actions below dispatch
import { registerStore } from './persistence';
import { createProjection } from './projection';
import { createScope, runInScope } from './scope';
import * as run from './internal/planner';
import {
  DEFAULT_PLANNER,
  EMPTY_RUN,
  PLANNER_KEY,
  PLANNER_VERSION,
  isPlannerState,
  mergePlannerStates,
  pickPlannerValues,
  type AddGoalOutcome,
  type PlannerState,
  type PlannerValues,
} from './internal/plannerModel';

export {
  DEFAULT_HORIZON_DAYS,
  DEFAULT_PLANNER,
  EMPTY_RUN,
  MAX_PLANNER_GOALS,
  PLANNER_HORIZON_MAX,
  PLANNER_HORIZON_MIN,
  PLANNER_KEY,
  PLANNER_VERSION,
  isPlannerResultStale,
  isPlannerState,
  mergePlannerStates,
  pickPlannerValues,
  provisionalScore,
  type AddGoalOutcome,
  type ConstraintDraft,
  type FoundSlot,
  type GoalDraft,
  type GoalMode,
  type GoalStrength,
  type HungerTolerance,
  type LongestFast,
  type PlannerActions,
  type PlannerRunState,
  type PlannerState,
  type PlannerValues,
  type RunStatus,
  type RunTraces,
} from './internal/plannerModel';

const PERSISTED = Object.keys(DEFAULT_PLANNER) as Array<keyof PlannerValues & string>;
/** Run lifecycle writes are job results (derive scope), not user edits. */
const derive = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => runInScope(createScope('derive', { label: 'planner run' }), () => fn(...a));
const edit = (ops: Parameters<typeof dispatchSync<'goals.edit'>>[1]['ops']) => dispatchSync('goals.edit', { ops });

export const usePlannerStore = createProjection<PlannerState, PlannerValues>({
  name: 'planner',
  key: PLANNER_KEY,
  version: PLANNER_VERSION,
  persistedFields: PERSISTED,
  creator: () => ({
    ...DEFAULT_PLANNER,
    run: EMPTY_RUN,
    addGoal: (goal) => {
      const out = outputOf(edit([{ op: 'add', goal }]));
      return (out?.outcomes[0] as AddGoalOutcome | undefined) ?? 'full';
    },
    removeGoal: (key) => void edit([{ op: 'remove', key }]),
    moveGoal: (from, to) => void edit([{ op: 'move', from, to }]),
    updateGoal: (key, patch) => void edit([{ op: 'update', key, patch }]),
    setHorizonDays: (days) => void edit([{ op: 'setHorizon', days }]),
    setStartDate: (date) => void edit([{ op: 'setStartDate', date }]),
    setConstraints: (patch) => void edit([{ op: 'setLimits', patch }]),
    resetConstraints: () => void edit([{ op: 'resetLimits' }]),
    setStrictness: (value) => void edit([{ op: 'setStrictness', value }]),
    runStarted: derive(run.runStarted),
    runProgress: derive(run.runProgress),
    runStopping: derive(run.runStopping),
    runFinished: derive(run.runFinished),
    runFailed: derive(run.runFailed),
    runCancelled: derive(run.runCancelled),
    clearRun: derive(run.clearRun),
  }),
  partialize: (s) => pickPlannerValues(s),
  // v1 is the first schema; unknown/older shapes are sanitised field by field.
  migrate: (persisted) => pickPlannerValues(persisted),
  merge: (persisted, current) => ({ ...current, ...pickPlannerValues(persisted) }),
  binding: {
    owns: ['goals'],
    toDocs: (v) => [{ col: 'goals', id: 'me', body: v as unknown as Record<string, unknown> }],
    fromDocs: (read) => {
      const doc = read.get('goals', 'me');
      return doc ? pickPlannerValues(doc) : null;
    },
  },
});

registerStore(PLANNER_KEY, PLANNER_VERSION, {
  label: 'planner goals',
  describe: (s) => {
    const v = pickPlannerValues(s);
    const n = v.goals.length;
    if (n === 0) return 'planner (no goals yet)';
    return `${n} planner goal${n === 1 ? '' : 's'} · ${Math.round(v.horizonDays / 7)} weeks`;
  },
  validate: isPlannerState,
  merge: mergePlannerStates,
  rehydrate: () => usePlannerStore.persist.rehydrate(),
});
