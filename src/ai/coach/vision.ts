/**
 * Photo recognition over a vision model (R8 photo nutrient estimation: identify components, estimate grams, the app
 * looks the foods up and computes). The model is asked for components and grams only; nothing it says about energy or
 * nutrients is kept, except a label it transcribed from a legible nutrition label.
 */
import { createAiGoalSuggester } from './goalSuggester';
import { installAiPorts, type PhotoComponentGuess, type PhotoRecognition, type PhotoRecognizer } from '@/commands/aiPorts';
import type { FoodTable } from '@/catalogues';
import type { ChatModel, Capabilities, JsonSchema } from '../providers/types';
import { createAiExerciseResolver } from './exerciseResolver';
import { createMarkerVisionPort } from './markers';
import { askJson, isRecord, num, str } from './modelJson';

/** The chosen model cannot read images; the Coach should ask the person to describe the meal in text instead. */
export class VisionUnsupportedError extends Error {
  readonly code = 'vision_unsupported';
  constructor(model: string) {
    super(`${model} cannot read photos. Describe the meal in text instead, or pick a model with image input.`);
    this.name = 'VisionUnsupportedError';
  }
}

export interface PhotoRecognizerOptions {
  /** When supplied, a short list of food names and ids from the table is offered so the model can pick `foodId`. */
  foods?: FoodTable;
  /** How many candidate foods to list (default 120). */
  maxCandidates?: number;
  /** Explicit candidate list (wins over `foods`). */
  candidates?: ReadonlyArray<{ id: string; name: string }>;
}

export const GRAMS_MIN = 1;
export const GRAMS_MAX = 2000;
const FAT_CUES = ['none', 'some', 'glossy', 'pooled'] as const;

export const PHOTO_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['components', 'saw', 'confidence'],
  properties: {
    saw: { type: 'string', description: 'One plain sentence: what is on the plate.' },
    confidence: { type: 'number', description: '0 to 1: how sure you are of the identification.' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'gramsLow', 'gramsHigh', 'confidence'],
        properties: {
          name: { type: 'string' },
          localName: { type: 'string' },
          foodId: { type: 'string', description: 'An id from CANDIDATES when one fits; omit otherwise.' },
          grams: { type: 'number', description: 'Estimated edible weight as served, in grams.' },
          gramsLow: { type: 'number' },
          gramsHigh: { type: 'number' },
          cookingMethod: { type: 'string' },
          visibleFatCue: { type: 'string', enum: [...FAT_CUES] },
          confidence: { type: 'number' },
        },
      },
    },
    labelPer100g: {
      type: 'object',
      description: 'Only if a nutrition label is legible in the photo: values transcribed per 100 g (energyKcal, energyKj when the label gives kJ, proteinG, carbG, fatG, fibreG, sodiumMg ...).',
      additionalProperties: { type: 'number' },
    },
  },
};

const SYSTEM = `You identify foods in a photo of a meal for a nutrition log.
Return JSON only. List each visible component with its name, an estimate of its edible weight in grams as served (with a low and high bound), the cooking method, any visible fat cue (none, some, glossy, pooled), and your confidence.
Do NOT state calories or nutrients for the food. The app looks those up from grams. If a nutrition label is legible, transcribe its per-100 g values into labelPer100g, otherwise omit it.
Use a food id from CANDIDATES only when it clearly matches. Say plainly what you saw in one sentence. Do not guess hidden ingredients.`;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const unit = (v: unknown, dflt: number) => clamp(num(v) ?? dflt, 0, 1);

const LABEL_KEYS = /^(energyKcal|proteinG|carbG|fatG|fibreG|sugarsG|satFatG|sodiumMg|saltG|per100gG)$|^[a-z][A-Za-z]*(G|Mg|Ug|Kcal)$/;

/**
 * Plausible label values per 100 g (V1e-11). Nothing edible is denser than pure fat (~900 kcal per 100 g); no single
 * nutrient can weigh more than the 100 g it is part of; protein + fat + carbs may exceed 100 g only by rounding on
 * the label (105 g). An energy figure above 900 that fits kilojoules (up to 3800 kJ, ~900 kcal) is converted when
 * the label also gave it as `energyKj`, otherwise the whole label is dropped: a misread label is worse than none.
 */
export const LABEL_MAX_KCAL = 900;
export const LABEL_MAX_KJ = 3800;
export const LABEL_MAX_NUTRIENT_G = 100;
export const LABEL_MAX_MACROS_G = 105;
const KJ_PER_KCAL = 4.184;
const LABEL_DROPPED = 'The nutrition label values did not add up, so they were not used.';
const LABEL_KJ = 'The label energy looks like kilojoules, not kcal, so the label values were not used.';

function labelMax(key: string): number {
  if (key === 'per100gG') return 100000;
  if (key.endsWith('Kcal')) return LABEL_MAX_KCAL;
  if (key.endsWith('Mg')) return LABEL_MAX_NUTRIENT_G * 1000;
  if (key.endsWith('Ug')) return LABEL_MAX_NUTRIENT_G * 1_000_000;
  return LABEL_MAX_NUTRIENT_G; // grams
}

/** Checks a transcribed label against the bounds above; returns it, or nothing and a plain-words reason. */
export function normalizeLabel(raw: unknown): { label?: Record<string, number>; problem?: string } {
  if (!isRecord(raw)) return {};
  const out: Record<string, number> = {};
  const kj = num(raw.energyKj);
  for (const [k, v] of Object.entries(raw)) {
    const n = num(v);
    if (n === undefined || n < 0 || !LABEL_KEYS.test(k)) continue;
    if (k === 'energyKcal' && n > LABEL_MAX_KCAL) {
      if (n > LABEL_MAX_KJ) return { problem: LABEL_DROPPED };
      // kJ written into the kcal field: convert only when the label itself says kJ
      if (kj === undefined || Math.abs(kj - n) > 0.05 * n) return { problem: LABEL_KJ };
      out[k] = Math.round((n / KJ_PER_KCAL) * 10) / 10;
      continue;
    }
    if (n > labelMax(k)) return { problem: LABEL_DROPPED };
    out[k] = n;
  }
  if (out.energyKcal === undefined && kj !== undefined && kj >= 0 && kj <= LABEL_MAX_KJ) out.energyKcal = Math.round((kj / KJ_PER_KCAL) * 10) / 10;
  if ((out.proteinG ?? 0) + (out.fatG ?? 0) + (out.carbG ?? 0) > LABEL_MAX_MACROS_G) return { problem: LABEL_DROPPED };
  return Object.keys(out).length ? { label: out } : {};
}

/** Strictly validates a model reply into a `PhotoRecognition`; every number is clamped, unknown fields dropped. */
export function normalizeRecognition(raw: unknown, known?: (id: string) => boolean): PhotoRecognition {
  const root = isRecord(raw) ? raw : {};
  const comps: PhotoComponentGuess[] = [];
  for (const c of Array.isArray(root.components) ? root.components : []) {
    if (!isRecord(c)) continue;
    const name = str(c.name, 80);
    const g = num(c.grams);
    if (!name || g === undefined || g <= 0) continue;
    const grams = clamp(Math.round(g), GRAMS_MIN, GRAMS_MAX);
    const lo = clamp(Math.round(num(c.gramsLow) ?? grams * 0.8), GRAMS_MIN, grams);
    const hi = clamp(Math.round(num(c.gramsHigh) ?? grams * 1.25), grams, GRAMS_MAX * 2);
    const foodId = str(c.foodId, 80);
    const cue = FAT_CUES.find((f) => f === c.visibleFatCue);
    const localName = str(c.localName, 80);
    const method = str(c.cookingMethod, 40);
    comps.push({
      name,
      ...(localName ? { localName } : {}),
      ...(foodId && (!known || known(foodId)) ? { foodId } : {}),
      grams,
      gramsLow: lo,
      gramsHigh: hi,
      ...(method ? { cookingMethod: method } : {}),
      ...(cue ? { visibleFatCue: cue } : {}),
      confidence: unit(c.confidence, 0.5),
    });
  }
  const { label, problem } = normalizeLabel(root.labelPer100g);
  const saw = str(root.saw, 300) ?? (comps.length ? `I see ${comps.map((c) => c.name).join(', ')}.` : 'I could not make out the food.');
  return {
    components: comps.slice(0, 20),
    saw: problem ? `${saw} ${problem}` : saw,
    confidence: unit(root.confidence, comps.length ? Math.min(...comps.map((c) => c.confidence)) : 0),
    ...(label ? { labelPer100g: label } : {}),
  };
}

export function createPhotoRecognizer(model: ChatModel, opts: PhotoRecognizerOptions = {}): PhotoRecognizer {
  const candidates = (): ReadonlyArray<{ id: string; name: string }> =>
    opts.candidates ?? (opts.foods ? opts.foods.all().slice(0, opts.maxCandidates ?? 120).map((f) => ({ id: f.id, name: f.name })) : []);
  const idSet = (): Set<string> | null => {
    if (opts.foods) return null;
    const c = opts.candidates;
    return c ? new Set(c.map((x) => x.id)) : null;
  };
  return async (req, signal) => {
    if (!model.capabilities.vision) throw new VisionUnsupportedError(model.model);
    const list = candidates();
    const lines = [
      ...(req.text?.trim() ? [`The person says: ${req.text.trim().slice(0, 500)}`] : []),
      ...(list.length ? [`CANDIDATES (id: name):\n${list.map((c) => `${c.id}: ${c.name}`).join('\n')}`] : []),
      'Identify the foods and estimate grams.',
    ];
    const json = await askJson(model, {
      system: SYSTEM,
      user: [
        { type: 'image', mime: req.image.type || 'image/jpeg', source: { kind: 'blob', blob: req.image }, localRef: req.attachmentId },
        { type: 'text', text: lines.join('\n\n') },
      ],
      schemaName: 'meal_photo',
      schema: PHOTO_SCHEMA,
      maxOutputTokens: 1500,
      ...(signal ? { signal } : {}),
    });
    const ids = idSet();
    const food = opts.foods;
    // no foods and no candidates offered: any foodId was invented, so none is kept
    return normalizeRecognition(json, food ? (id) => !!food.get(id) : ids ? (id) => ids.has(id) : () => false);
  };
}

/** Installs the model-backed ports: photo recognition only when the model can see, exercise resolution always. */
export function installModelPorts(model: ChatModel, caps: Pick<Capabilities, 'vision'>, opts: PhotoRecognizerOptions = {}): void {
  installAiPorts({
    ...(caps.vision ? { recognizePhoto: createPhotoRecognizer(model, opts) } : {}),
    // E20: blood test report pages without text (masked) are read by the same model
    ...(caps.vision ? { markerVision: createMarkerVisionPort(model) } : {}),
    resolveExercise: createAiExerciseResolver(model),
    suggestGoals: createAiGoalSuggester(model), // E19: goals.suggest source 'ai'
  });
}
