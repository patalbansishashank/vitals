/**
 * `goals.suggest` (SUITE_SPEC §13.4, PLAN 02 item 8): a read command that proposes a ranked goal set, practical limits
 * and a missing-answers list from what the person has already answered. It never writes: the Goals page shows the
 * result as a proposal card and "Apply" dispatches `goals.edit` (the goal ops plus `setSuggested`, the provenance
 * record). Nothing runs until the person presses Find plans.
 *
 * Two sources, one output shape. `rule` (default) is the deterministic suggester in the engine (offline, no provider).
 * `ai` asks the Coach's model (through `aiPorts().suggestGoals`) with the rule result as its starting point; the reply
 * is coerced onto the same shape and checked against the rule result (`checkAgainstRule`). D4-06: the AI rewrites prose
 * only — the rule's goal ranks, targets (presence, value, unit), target provenance, marker readings, limits and required
 * safety/marker notes are frozen (`structureHash`); a reply that changes any of them, a missing provider or a failed call
 * returns the rule result with a `fallback` line.
 *
 * Inputs are gathered by the Planner feature through the `goalSuggest` port (body estimate, intake, markers, devices,
 * safety, fastest-safe reach); headless code never reads the UI stores.
 */
import { isGoalMetric } from '@/engine/planner/domain/planner';
import {
  coerceSuggestion,
  reconcile,
  suggestGoals,
  type GoalSuggestion,
  type GoalSuggestionInput,
} from '@/engine/planner/domain/suggestGoals';
import { aiPorts } from '../aiPorts';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import type { Actor } from '../types';
import { ALL, UNDO } from '../defs/_shared';

/** What the Planner feature installs: gathers the suggester's input from the person's answers. */
export interface GoalSuggestPort {
  /** `actor`: who asked (device data the person does not share with the Coach stays out for agents). */
  gather(opts: {
    signal?: AbortSignal;
    actor: Actor;
    purpose?: GoalSuggestionInput['purpose'];
  }): Promise<GoalSuggestionInput>;
}

declare module '../types' {
  interface CommandPorts {
    /** Goal suggestion inputs (installed by the Planner feature). */
    goalSuggest?: GoalSuggestPort;
  }
}

export const AI_FALLBACK = 'The Coach couldn’t answer, so this comes from the built-in rules.';
export const AI_DISAGREED =
  'The Coach’s answer did not match your answers, so this comes from the built-in rules.';
export const NO_COACH = 'No Coach is connected, so this comes from the built-in rules.';

const Because = T.Object({
  markerId: T.String(),
  label: T.String(),
  value: T.Number(),
  unit: T.String(),
  date: T.Optional(T.String()),
});
const SuggestedGoal = T.Object({
  rank: T.Integer({ minimum: 1, maximum: 6 }),
  metric: T.String({ minLength: 1 }),
  target: T.Optional(T.Number()),
  unit: T.Optional(T.String()),
  mode: T.Enum(['lose', 'keep', 'gain', 'raise', 'lower']),
  targetFrom: T.Enum(['fastestSafeReach', 'band', 'keep', 'direction', 'user']),
  why: T.String({ description: 'One plain sentence.' }),
  because: T.Optional(Because),
});
const Range = T.Tuple([T.Number(), T.Number()]);
const Purpose = T.Enum(['fatLoss', 'maintenance', 'strength', 'health', 'performance']);
export const GoalSuggestionSchema = T.Object({
  source: T.Enum(['rule', 'ai']),
  version: T.String({ description: "'rule@2' or 'ai:<model>@<briefing version>'" }),
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
  notes: T.Array(
    T.Object({
      topic: T.Enum(['sleep', 'recovery', 'marker', 'safety', 'equipment', 'food']),
      text: T.String(),
    }),
  ),
  missing: T.Array(T.Object({ field: T.String(), question: T.String(), why: T.String() })),
  clarify: T.Optional(T.Array(T.String(), { maxItems: 2 })),
  fallback: T.Optional(T.String()),
  candidates: T.Optional(
    T.Array(
      T.Object({
        metric: T.String({ minLength: 1 }),
        mode: T.Enum(['lose', 'keep', 'gain', 'raise', 'lower']),
        why: T.String(),
      }),
      {
        description:
          'Optional goals offered for an explicit choice (not ranked, no number until the person sets one).',
      },
    ),
  ),
  purposeAsk: T.Optional(
    T.Array(Purpose, { description: 'Purposes to ask about when the answer would change the suggestion.' }),
  ),
  reference: T.Optional(
    T.Object({
      band: Range,
      basis: T.Enum(['gallagher2000Provisional']),
      bfPct: T.Number(),
      interval: T.Nullable(Range),
      overlap: T.Enum(['clearlyAbove', 'overlaps', 'within', 'clearlyBelow', 'unknown']),
    }),
  ),
  purpose: T.Optional(Purpose),
  structureHash: T.Optional(
    T.String({
      description:
        'Fingerprint of the frozen structured result (goals without prose, limits, required notes).',
    }),
  ),
});

/** Ask the Coach's model; any failure or disagreement returns the rule result with a note. */
export async function aiSuggestion(
  input: GoalSuggestionInput,
  rule: GoalSuggestion,
  signal?: AbortSignal,
): Promise<GoalSuggestion> {
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
    "Suggest a ranked goal set (at most 6) from the person's answers: body-fat range against a provisional reference, training, entered blood markers, device sleep and intake. A numeric target needs a supported route estimate of the right sign, rounded toward zero; when the body-fat range overlaps the reference, neutral goals lead and fat loss is an optional candidate. Limits come only from the answers; `missing` lists what is unanswered. source 'ai' only rewords; a change to goals, targets, units, limits or safety notes falls back to the rules. Never writes: apply with goals.edit.",
  input: T.Object({ source: T.Optional(T.Enum(['rule', 'ai'])), purpose: T.Optional(Purpose) }),
  output: GoalSuggestionSchema,
  perm: 'read',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx, input) => {
    const port =
      ctx.ports.goalSuggest ??
      fail('precondition_failed', 'Open the Planner once so suggestions can read your answers.', {
        retryable: true,
      });
    const data = await port.gather({ signal: ctx.signal, actor: ctx.actor, purpose: input.purpose });
    const chosen = { ...data, ...(input.purpose ? { purpose: input.purpose } : {}) };
    const rule = suggestGoals(chosen);
    const out = input.source === 'ai' ? await aiSuggestion(chosen, rule, ctx.signal) : rule;
    return out as never;
  },
});

declare module '../types' {
  interface CommandMap {
    'goals.suggest': typeof goalsSuggest;
  }
}
