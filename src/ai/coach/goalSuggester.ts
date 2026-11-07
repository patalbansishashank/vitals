/** Model-assisted prose only. Trusted rule data owns every target, rank and safety fact. */
import type { GoalSuggester } from '@/commands/aiPorts';
import type { GoalSuggestion, GoalSuggestionInput } from '@/engine/planner/domain/suggestGoals';
import type { ChatModel, JsonSchema } from '../providers/types';
import { BRIEFING_VERSION } from './briefing';
import { askJson } from './modelJson';

/** Provider authors prose keyed by metric; all structured fields are merged from the trusted rule. */
export const GOAL_SUGGESTION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rewrites'],
  properties: {
    rewrites: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['metric', 'why'],
        properties: { metric: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
};
const SYSTEM = `Return JSON only. Rewrite each rule goal's reason in plain words. Return exactly one keyed prose rewrite for every rule goal, preserving its metric. The only output fields are rewrites and each item's metric and why. Never propose goals, targets, units, constraints, provenance, marker readings or safety notes. All structured content stays frozen in trusted code.`;

/** The compact facts the model sees (no names; rounded numbers). */
export function suggestionBrief(input: GoalSuggestionInput): Record<string, unknown> {
  const p = input.profile;
  const b = input.body;
  const round = (x: number | null | undefined) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
  return {
    body: p.complete
      ? {
          sex: p.sex,
          ageYears: p.ageYears,
          heightCm: p.heightCm,
          weightKg: round(p.weightKg),
          bodyFatPct: round(b.bfPct),
          likely: b.bfBand?.map(round) ?? null,
        }
      : 'not set up',
    trainingYears: b.trainingAgeY,
    training: input.intake.training?.prefs ?? null,
    markers: input.markers.map((m) => ({
      marker: m.because.label,
      value: m.because.value,
      unit: m.because.unit,
      severity: m.severity,
    })),
    fastingOptedIn: input.safety.optedTier !== null,
    weightLossAllowed: !input.safety.noWeightLossGoal,
  };
}

export function createAiGoalSuggester(model: ChatModel): GoalSuggester {
  return async ({ input, rule, signal }) => {
    const rules: Omit<GoalSuggestion, 'source' | 'version'> = rule;
    const raw = await askJson(model, {
      system: SYSTEM,
      user: [
        {
          type: 'text',
          text: `ANSWERS:\n${JSON.stringify(suggestionBrief(input))}\n\nRULES SUGGESTION:\n${JSON.stringify(rules)}`,
        },
      ],
      schemaName: 'goal_suggestion',
      schema: GOAL_SUGGESTION_SCHEMA,
      maxOutputTokens: 1500,
      ...(signal ? { signal } : {}),
    });
    const patch = raw as { rewrites?: unknown } | null;
    const rewrites =
      patch &&
      typeof patch === 'object' &&
      !Array.isArray(patch) &&
      Object.keys(patch).length === 1 &&
      Array.isArray(patch.rewrites)
        ? patch.rewrites
        : null;
    const seen = new Set<string>();
    const valid =
      rewrites &&
      rewrites.length === rule.goals.length &&
      rewrites.every((v: unknown) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
        const r = v as Record<string, unknown>;
        if (
          Object.keys(r).length !== 2 ||
          typeof r.metric !== 'string' ||
          typeof r.why !== 'string' ||
          !r.why.trim() ||
          seen.has(r.metric) ||
          !rule.goals.some((g) => g.metric === r.metric)
        )
          return false;
        seen.add(r.metric);
        return true;
      });
    const merged = valid
      ? {
          ...rule,
          goals: rule.goals.map((g) => ({
            ...g,
            why: (rewrites!.find((r: { metric: string }) => r.metric === g.metric) as { why: string }).why,
          })),
        }
      : null;
    return { raw: merged, version: `ai:${model.model}@${BRIEFING_VERSION}` };
  };
}
