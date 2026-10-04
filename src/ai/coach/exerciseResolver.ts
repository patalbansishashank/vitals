/**
 * Model-backed `ExerciseResolver` (docs/wp/E9.md): for an exercise the catalogue does not know, the model names its
 * stimulus (movement pattern, regions, load type, dose, MET) in the `ExerciseDraft` shape. The answer is coerced onto
 * the catalogue vocabularies and checked with `validateDraft`; anything unusable falls back to the keyword heuristic.
 */
import {
  CARDIO_MODALITIES,
  CONTRA_TAGS,
  INTENSITY_SCALES,
  LOAD_TYPES,
  PATTERNS,
  REGIONS,
  resolveUnknownSync,
  validateDraft,
  VOLUME_UNITS,
  type Catalogue,
  type DefaultDose,
  type ExerciseDraft,
  type ExerciseRecord,
  type ExerciseResolver,
} from '@/catalogues';
import type { ChatModel, JsonSchema } from '../providers/types';
import { askJson, isRecord, num, str } from './modelJson';

export interface ExerciseResolverOptions {
  /** Used for the heuristic fallback when the model's answer is invalid; without it an invalid answer resolves to null. */
  catalogue?: Catalogue;
  /** How many catalogue exercises to show the model as candidates for `basedOn` (default 40). */
  maxCandidates?: number;
}

const DOSE_KEYS = ['sets', 'reps', 'rir', 'restSec', 'holdSec', 'durationSec', 'durationMin', 'rounds', 'workSec', 'secPerRound'] as const;

export const EXERCISE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pattern', 'regions', 'loadType', 'intensityScale', 'volumeUnit', 'defaultDose', 'metGross', 'mechanism', 'confidence'],
  properties: {
    pattern: { type: 'string', enum: [...PATTERNS] },
    regions: { type: 'object', description: 'Region -> share of the work in (0, 1]; regions: ' + REGIONS.join(', '), additionalProperties: { type: 'number' } },
    loadType: { type: 'string', enum: [...LOAD_TYPES] },
    intensityScale: { type: 'string', enum: [...INTENSITY_SCALES] },
    volumeUnit: { type: 'string', enum: [...VOLUME_UNITS] },
    defaultDose: { type: 'object', description: 'Typical dose: sets, reps, rir, restSec, holdSec, durationMin, rounds ...', additionalProperties: { type: 'number' } },
    metGross: { type: 'number', description: 'Gross MET, session average including rest, between 1 and 20.' },
    cardioModality: { type: 'string', enum: [...CARDIO_MODALITIES] },
    hybridCardioShare: { type: 'number' },
    mechanism: { type: 'string', description: 'One sentence: what it trains and why it counts like the closest catalogue item.' },
    basedOn: { type: 'string', description: 'Id of the closest catalogue exercise from CANDIDATES.' },
    aliases: { type: 'array', items: { type: 'string' } },
    contraTags: { type: 'array', items: { type: 'string', enum: [...CONTRA_TAGS] } },
    confidence: { type: 'number', description: '0 to 1.' },
  },
};

const SYSTEM = `You classify an exercise for a training planner. Return JSON only.
Say which movement pattern it is, which muscle regions it loads (weights in (0,1], the main region near 1), how load is applied, a typical dose and a gross MET. Pick the closest catalogue exercise as basedOn and reuse its dose and MET when unsure. Be honest in confidence.`;

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);

/** Coerces a model reply onto an `ExerciseDraft`; null when the shape cannot be rescued. */
export function draftFromModel(raw: Record<string, unknown>, name: string, description?: string): ExerciseDraft | null {
  const pattern = pick(PATTERNS, raw.pattern);
  const loadType = pick(LOAD_TYPES, raw.loadType);
  const intensityScale = pick(INTENSITY_SCALES, raw.intensityScale);
  const volumeUnit = pick(VOLUME_UNITS, raw.volumeUnit);
  const metGross = num(raw.metGross);
  const mechanism = str(raw.mechanism, 300);
  if (!pattern || !loadType || !intensityScale || !volumeUnit || metGross === undefined || !mechanism || !isRecord(raw.regions) || !isRecord(raw.defaultDose)) return null;
  const regions: ExerciseDraft['regions'] = {};
  for (const r of REGIONS) {
    const w = num(raw.regions[r]);
    if (w !== undefined) regions[r] = w;
  }
  const defaultDose: DefaultDose = {};
  for (const k of DOSE_KEYS) {
    const v = num(raw.defaultDose[k]);
    if (v !== undefined) defaultDose[k] = v;
  }
  const modality = pick(CARDIO_MODALITIES, raw.cardioModality);
  const aliases = Array.isArray(raw.aliases) ? raw.aliases.map((a) => str(a, 60)).filter((a): a is string => !!a).slice(0, 6) : [];
  const contra = Array.isArray(raw.contraTags) ? raw.contraTags.map((c) => pick(CONTRA_TAGS, c)).filter((c): c is NonNullable<typeof c> => !!c) : [];
  const basedOn = str(raw.basedOn, 80);
  return {
    name,
    ...(description ? { description } : {}),
    ...(aliases.length ? { aliases } : {}),
    pattern,
    regions,
    loadType,
    intensityScale,
    volumeUnit,
    defaultDose,
    metGross,
    cardioModality: modality ?? null,
    hybridCardioShare: num(raw.hybridCardioShare) ?? 0,
    ...(contra.length ? { contraTags: contra } : {}),
    mechanism,
    confidence: num(raw.confidence) ?? 0.5,
    resolvedBy: 'ai',
    ...(basedOn ? { basedOn } : {}),
  };
}

export function createAiExerciseResolver(model: ChatModel, opts: ExerciseResolverOptions = {}): ExerciseResolver {
  return {
    id: `ai:${model.presetId}:${model.model}`,
    async resolve(input, context) {
      const fallback = (): ExerciseDraft | null => (opts.catalogue ? resolveUnknownSync(input.name, input.description, opts.catalogue) : null);
      try {
        const cands = context.candidates.slice(0, opts.maxCandidates ?? 40).map((e: ExerciseRecord) => `${e.id}: ${e.name}`);
        const json = await askJson(model, {
          system: SYSTEM,
          user: [{ type: 'text', text: `Exercise: ${input.name}${input.description ? `\nDescription: ${input.description}` : ''}\n\nCANDIDATES (id: name):\n${cands.join('\n')}` }],
          schemaName: 'exercise_draft',
          schema: EXERCISE_SCHEMA,
          maxOutputTokens: 800,
        });
        const draft = draftFromModel(json, input.name, input.description);
        if (draft && validateDraft(draft).length === 0) return draft;
      } catch {
        /* provider or parse failure: the heuristic below stands in */
      }
      return fallback();
    },
  };
}
