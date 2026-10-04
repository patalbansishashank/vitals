/**
 * Model-backed goal suggestion (`goals.suggest` with source 'ai', SUITE_SPEC §13.4). The model gets a compact summary
 * of the answers and the built-in rules' suggestion as its starting point, may reword the reasons, add goals below the
 * first two, add notes and ask at most two clarifying questions, and must keep the rules' first goals, targets (±10 %),
 * limits and missing list. The command coerces the reply and checks it against the rules; this module only asks.
 */
import type { GoalSuggester } from '@/commands/aiPorts';
import type { GoalSuggestion, GoalSuggestionInput } from '@/engine/planner/domain/suggestGoals';
import type { ChatModel, JsonSchema } from '../providers/types';
import { BRIEFING_VERSION } from './briefing';
import { askJson } from './modelJson';

export const GOAL_SUGGESTION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['goals', 'constraints', 'notes', 'missing', 'clarify'],
  properties: {
    goals: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['metric', 'mode', 'why'],
        properties: {
          metric: { type: 'string', description: 'A metric id from the rules suggestion or the allowed list.' },
          mode: { type: 'string', enum: ['lose', 'keep', 'gain', 'raise', 'lower'] },
          target: { type: 'number', description: 'kg, only for lose/gain.' },
          unit: { type: 'string' },
          why: { type: 'string', description: 'One plain sentence with the numbers behind it.' },
        },
      },
    },
    constraints: { type: 'object', description: 'Copy of the rules constraints (only those keys and values).' },
    notes: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, text: { type: 'string' } } } },
    missing: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, question: { type: 'string' }, why: { type: 'string' } } } },
    clarify: { type: 'array', maxItems: 2, items: { type: 'string' } },
  },
};

const SYSTEM = `You help a person pick health goals in a planning app. Return JSON only.
You get their answers and a suggestion from the app's built-in rules. Keep the rules' first two goals in the first two places (same metrics), keep targets within 10 % of the rules' targets, copy the constraints exactly, and keep every item of the missing list. You may reword the reasons in plain words, add up to two lower-ranked goals from the allowed metrics when the answers support them, add notes, and ask at most two short clarifying questions when an answer would change the ranking. Never invent goals when the rules have none. Never suggest weight loss when the rules do not. No medical advice.`;

const ALLOWED = ['fatMass', 'leanTissue', 'skeletalMuscle', 'strength', 'vo2max', 'hunger', 'ldl', 'apoB', 'triglycerides', 'fastingGlucose', 'insulinSensitivity', 'liverFat', 'crp', 'sbp', 'visceralFat', 'waist'];

/** The compact facts the model sees (no names; rounded numbers). */
export function suggestionBrief(input: GoalSuggestionInput): Record<string, unknown> {
  const p = input.profile;
  const b = input.body;
  const round = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
  return {
    body: p.complete ? { sex: p.sex, ageYears: p.ageYears, heightCm: p.heightCm, weightKg: round(p.weightKg), bodyFatPct: round(b.bfPct), likely: b.bfBand?.map(round) ?? null } : 'not set up',
    trainingYears: b.trainingAgeY,
    training: input.intake.training?.prefs ?? null,
    markers: input.markers.map((m) => ({ marker: m.because.label, value: m.because.value, unit: m.because.unit, severity: m.severity })),
    sleepShortfallHPerNight: round(input.devices.sleepDebtH),
    fastingOptedIn: input.safety.optedTier !== null,
    weightLossAllowed: !input.safety.noWeightLossGoal,
  };
}

export function createAiGoalSuggester(model: ChatModel): GoalSuggester {
  return async ({ input, rule, signal }) => {
    const rules: Omit<GoalSuggestion, 'source' | 'version'> = { goals: rule.goals, constraints: rule.constraints, notes: rule.notes, missing: rule.missing };
    const raw = await askJson(model, {
      system: SYSTEM,
      user: [
        {
          type: 'text',
          text: `ANSWERS:\n${JSON.stringify(suggestionBrief(input))}\n\nRULES SUGGESTION:\n${JSON.stringify(rules)}\n\nALLOWED METRICS: ${ALLOWED.join(', ')}`,
        },
      ],
      schemaName: 'goal_suggestion',
      schema: GOAL_SUGGESTION_SCHEMA,
      maxOutputTokens: 1500,
      ...(signal ? { signal } : {}),
    });
    return { raw, version: `ai:${model.model}@${BRIEFING_VERSION}` };
  };
}
