/**
 * `goals.suggest` (SUITE_SPEC §13.4, PLAN 02 item 8): a read command that proposes a ranked goal set, practical limits
 * and a missing-answers list from what the person has already answered. It never writes: the Goals page shows the
 * result as a proposal card and "Apply" dispatches `goals.edit` (the goal ops plus `setSuggested`, the provenance
 * record). Nothing runs until the person presses Find plans.
 *
 * Two sources, one output shape. `rule` (default) is the deterministic suggester in the engine (offline, no provider).
 * `ai` asks the Coach's model (through `aiPorts().suggestGoals`) with the rule result as its starting point; the reply
 * is coerced onto the same shape and checked against the rule result (`checkAgainstRule`): anything that disagrees, a
 * missing provider or a failed call returns the rule result with a `fallback` line.
 *
 * Inputs are gathered by the Planner feature through the `goalSuggest` port (body estimate, intake, markers, devices,
 * safety, fastest-safe reach); headless code never reads the UI stores.
 */
import { isGoalMetric } from '@/engine/planner/domain/planner';
import { coerceSuggestion, reconcile, suggestGoals, type GoalSuggestion, type GoalSuggestionInput } from '@/engine/planner/domain/suggestGoals';
import { aiPorts } from '../aiPorts';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import type { Actor } from '../types';
import { ALL, UNDO } from '../defs/_shared';

/** What the Planner feature installs: gathers the suggester's input from the person's answers. */
export interface GoalSuggestPort {
  /** `actor`: who asked (device data the person does not share with the Coach stays out for agents). */
  gather(opts: { signal?: AbortSignal; actor: Actor }): Promise<GoalSuggestionInput>;
}

declare module '../types' {
  interface CommandPorts {
    /** Goal suggestion inputs (installed by the Planner feature). */
    goalSuggest?: GoalSuggestPort;
  }
}

export const AI_FALLBACK = 'The Coach couldn’t answer, so this comes from the built-in rules.';
export const AI_DISAGREED = 'The Coach’s answer did not match your answers, so this comes from the built-in rules.';
export const NO_COACH = 'No Coach is connected, so this comes from the built-in rules.';

const Because = T.Object({ markerId: T.String(), label: T.String(), value: T.Number(), unit: T.String(), date: T.Optional(T.String()) });
const SuggestedGoal = T.Object({
  rank: T.Integer({ minimum: 1, maximum: 6 }),
  metric: T.String({ minLength: 1 }),
  target: T.Optional(T.Number()),
  unit: T.Optional(T.String()),
  mode: T.Enum(['lose', 'keep', 'gain', 'raise', 'lower']),
  targetFrom: T.Enum(['fastestSafeReach', 'band', 'keep', 'direction']),
  why: T.String({ description: 'One plain sentence.' }),
  because: T.Optional(Because),
});
const Range = T.Tuple([T.Number(), T.Number()]);
export const GoalSuggestionSchema = T.Object({
  source: T.Enum(['rule', 'ai']),
  version: T.String({ description: "'rule@1' or 'ai:<model>@<briefing version>'" }),
  goals: T.Array(SuggestedGoal, { maxItems: 6 }),
  constraints: T.Object({
    trainingDays: T.Optional(Range),
    trainingTimeH: T.Optional(T.Number()),
    maxSessionMin: T.Optional(T.Number()),
    earliestH: T.Optional(T.Number()),
    latestH: T.Optional(T.Number()),
    longestFastH: T.Optional(T.NumberEnum([24, 48, 72])),
    sleepFixed: T.Optional(T.Boolean()),
  }),
  notes: T.Array(T.Object({ topic: T.Enum(['sleep', 'recovery', 'marker', 'safety', 'equipment', 'food']), text: T.String() })),
  missing: T.Array(T.Object({ field: T.String(), question: T.String(), why: T.String() })),
  clarify: T.Optional(T.Array(T.String(), { maxItems: 2 })),
  fallback: T.Optional(T.String()),
});

/** Ask the Coach's model; any failure or disagreement returns the rule result with a note. */
export async function aiSuggestion(input: GoalSuggestionInput, rule: GoalSuggestion, signal?: AbortSignal): Promise<GoalSuggestion> {
  const ask = aiPorts().suggestGoals;
  if (!ask) return { ...rule, fallback: NO_COACH };
  let reply: { raw: unknown; version: string };
  try {
    reply = await ask({ input, rule, ...(signal ? { signal } : {}) });
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ...rule, fallback: AI_FALLBACK };
  }
  const ai = coerceSuggestion(reply.raw, reply.version, isGoalMetric);
  return reconcile(rule, ai, ai ? AI_DISAGREED : AI_FALLBACK);
}

export const goalsSuggest = defineCommand({
  id: 'goals.suggest',
  version: 1,
  title: 'Suggest goals from the answers',
  description:
    "Suggest a ranked goal set (at most 6) from the person's answers: body-fat estimate against the healthy band, training history, entered blood markers, device sleep and the intake. Each goal has a target from the fastest safe rate where one applies and one plain sentence of why; limits come only from the answers (fasting only when already opted in); `missing` lists what is not answered instead of guessing (with nothing answered there are no goals). source 'ai' asks the Coach's model, checked against the built-in rules. Never writes: apply with goals.edit (the goal ops plus setSuggested).",
  input: T.Object({ source: T.Optional(T.Enum(['rule', 'ai'])) }),
  output: GoalSuggestionSchema,
  perm: 'read',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx, input) => {
    const port = ctx.ports.goalSuggest ?? fail('precondition_failed', 'Open the Planner once so suggestions can read your answers.', { retryable: true });
    const data = await port.gather({ signal: ctx.signal, actor: ctx.actor });
    const rule = suggestGoals(data);
    const out = input.source === 'ai' ? await aiSuggestion(data, rule, ctx.signal) : rule;
    return out as never;
  },
});

declare module '../types' {
  interface CommandMap {
    'goals.suggest': typeof goalsSuggest;
  }
}
