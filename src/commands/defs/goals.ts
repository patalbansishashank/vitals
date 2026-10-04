/** `goals.*` (SUITE_SPEC §1.9 `GoalOp`). */
import { MAX_PLANNER_GOALS, PLANNER_HORIZON_MAX, PLANNER_HORIZON_MIN } from '@/state/internal/plannerModel';
import { applyGoalOps, goalSet } from '@/state/internal/planner';
import { defineCommand } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';

const Goal = T.Object({
  key: T.Optional(T.String({ minLength: 1, maxLength: 80 })),
  metric: T.String({ minLength: 1 }),
  mode: T.Enum(['lose', 'keep', 'gain', 'raise', 'lower', 'reach']),
  amount: T.Nullable(T.Number()),
  strength: T.Enum(['must', 'should', 'nice']),
  functional: T.Nullable(T.Enum(['end', 'mean'])),
});
const GoalPatch = T.Object({
  mode: T.Optional(T.Enum(['lose', 'keep', 'gain', 'raise', 'lower', 'reach'])),
  amount: T.Optional(T.Nullable(T.Number())),
  strength: T.Optional(T.Enum(['must', 'should', 'nice'])),
  functional: T.Optional(T.Nullable(T.Enum(['end', 'mean']))),
});
const Range = T.Tuple([T.Number(), T.Number()]);
const Limits = T.Object({
  trainingDays: T.Optional(Range),
  trainingWeekdays: T.Optional(T.Array(T.Integer({ minimum: 0, maximum: 6 }))),
  trainingTimeH: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  maxSessionMin: T.Optional(T.Number({ minimum: 0 })),
  cardioDays: T.Optional(Range),
  cardioModality: T.Optional(T.String()),
  earliestH: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  latestH: T.Optional(T.Number({ minimum: 0, maximum: 24 })),
  mealsPerDay: T.Optional(Range),
  steps: T.Optional(Range),
  longestFastH: T.Optional(T.NumberEnum([12, 16, 20, 24, 48, 72])),
  prefersFasting: T.Optional(T.Boolean()),
  excluded: T.Optional(T.Array(T.String())),
  proteinFloor: T.Optional(T.Nullable(T.Number({ minimum: 0 }))),
  carbFloorG: T.Optional(T.Number({ minimum: 0 })),
  sleepFixed: T.Optional(T.Boolean()),
  hungerTolerance: T.Optional(T.Enum(['low', 'medium', 'high'])),
});

/** `goals/me.suggested` (SUITE_SPEC §13.4): the applied suggestion with provenance. */
const SuggestedRecordSchema = T.Object({
  suggestion: T.OpenObject({ description: 'The GoalSuggestion that was applied (goals.suggest output).' }),
  at: T.Instant(),
  provenance: T.Object({ source: T.Enum(['rule', 'ai']), version: T.String({ minLength: 1, maxLength: 120 }) }),
  goalKeys: T.Array(T.String({ maxLength: 80 }), { maxItems: 6 }),
});

export const GoalOp = T.Union([
  T.Object({ op: T.Literal('add'), goal: Goal }),
  T.Object({ op: T.Literal('remove'), key: T.String() }),
  T.Object({ op: T.Literal('move'), from: T.Integer({ minimum: 0 }), to: T.Integer() }),
  T.Object({ op: T.Literal('update'), key: T.String(), patch: GoalPatch }),
  T.Object({ op: T.Literal('setHorizon'), days: T.Number({ minimum: 1 }) }),
  T.Object({ op: T.Literal('setStartDate'), date: T.Nullable(T.Date()) }),
  T.Object({ op: T.Literal('setLimits'), patch: Limits }),
  T.Object({ op: T.Literal('resetLimits') }),
  T.Object({ op: T.Literal('setStrictness'), value: T.Enum(['strict', 'balanced', 'flexible']) }),
  T.Object({ op: T.Literal('setSuggested'), record: T.Nullable(SuggestedRecordSchema) }),
]);

export const GoalSet = T.Object({
  goals: T.Array(T.OpenObject()),
  horizonDays: T.Integer(),
  startDate: T.Nullable(T.String()),
  constraints: T.OpenObject(),
  strictness: T.Enum(['strict', 'balanced', 'flexible']),
  lastRequestHash: T.Nullable(T.String()),
  lastRunAt: T.Nullable(T.String()),
  suggested: T.Optional(T.Nullable(T.OpenObject())),
});

const GoalSetWithOutcomes = T.Object({
  goals: T.Array(T.OpenObject()),
  horizonDays: T.Integer(),
  startDate: T.Nullable(T.String()),
  constraints: T.OpenObject(),
  strictness: T.Enum(['strict', 'balanced', 'flexible']),
  lastRequestHash: T.Nullable(T.String()),
  lastRunAt: T.Nullable(T.String()),
  suggested: T.Optional(T.Nullable(T.OpenObject())),
  outcomes: T.Array(T.String()),
});

export const goalsGet = defineCommand({
  id: 'goals.get',
  version: 1,
  title: 'Read the goal set',
  description: `The Planner's ranked goals (metric, direction, amount in metric units, strength), horizon in days (${PLANNER_HORIZON_MIN}–${PLANNER_HORIZON_MAX}), start date, the practical limits the person changed, and strictness.`,
  input: T.Object({}),
  output: GoalSet,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the projection hooks directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: () => goalSet() as never,
});

export const goalsEdit = defineCommand({
  id: 'goals.edit',
  version: 1,
  title: 'Edit the goal set',
  description: `Apply goal ops in order: add (at most ${MAX_PLANNER_GOALS} goals, one per metric), remove, move (rank), update, setHorizon (days), setStartDate, setLimits (practical limits), resetLimits, setStrictness, setSuggested (record the applied goal suggestion with its provenance, or null). Returns the goal set and one outcome per op (added, duplicate, full, applied, unchanged, not-found).`,
  input: T.Object({ ops: T.Array(GoalOp, { minItems: 1, maxItems: 20 }) }),
  output: GoalSetWithOutcomes,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    const outcomes = applyGoalOps(input.ops as never);
    return { ...goalSet(), outcomes } as never;
  },
});

declare module '../types' {
  interface CommandMap {
    'goals.get': typeof goalsGet;
    'goals.edit': typeof goalsEdit;
  }
}
