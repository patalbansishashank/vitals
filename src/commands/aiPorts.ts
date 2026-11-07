/**
 * Ports the AI layer fills for command executors that need a model (E9b). Commands never import `src/ai`: the Coach
 * installs these when a provider is configured and clears them when it is removed; without them the executors use
 * their deterministic fallbacks (catalogue parser, heuristic exercise resolution) or fail with `precondition_failed`.
 */
import type { ExerciseResolver } from '@/catalogues';
import type { CarbohydrateBasis } from '@/lib/bodyContracts';
import type { MarkerVisionPort } from './markers/ports';
import type { GoalSuggestion, GoalSuggestionInput } from '@/engine/planner/domain/suggestGoals';

/** One component the vision model saw. Grams only — the app computes nutrients from grams × the food table. */
export interface PhotoComponentGuess {
  name: string;
  localName?: string;
  /** A food-table id when the model picked one from the candidates it was given. */
  foodId?: string;
  grams: number;
  gramsLow: number;
  gramsHigh: number;
  cookingMethod?: string;
  visibleFatCue?: 'none' | 'some' | 'glossy' | 'pooled';
  /** 0–1: how sure the model is of the identification. */
  confidence: number;
  /**
   * (D6-06) Other table foods the model could not tell apart from this one (ids from the candidates it was given): kept as
   * an identity-ambiguity set, never as probabilities. Grams from a photo are always `photoEstimated`, never weighed.
   */
  alternatives?: string[];
}

export interface PhotoRecognition {
  components: PhotoComponentGuess[];
  /** "What I saw": one plain sentence for the confirmation card and the photo's alt text. */
  saw: string;
  /** Overall identification confidence 0–1. */
  confidence: number;
  /**
   * A transcribed nutrition label (per 100 g), only when one was legible in the photo. Only the values printed on it:
   * a value the label does not give is left out (unknown is not zero; C3/D6-02). Energy alone is a valid label. Fields:
   * energyKcal, proteinG, fatG, carbG (as printed, on `labelCarbBasis`), fibreG, satFatG and, when printed, sugarsG,
   * polyolsG (total identified polyols, never subtracted by a factor), sodiumMg, potassiumMg, calciumMg, ironMg,
   * cholesterolMg, vitDUg (D6-01/D6-03).
   */
  labelPer100g?: Record<string, number>;
  /** (D6-01) what the label's carbohydrate means, when the label says (total incl. fibre vs available); absent = not stated. */
  labelCarbBasis?: CarbohydrateBasis;
  /**
   * (C1/D5-01) when the photo was taken, from the image's own capture metadata (ISO instant with offset), when known. Never
   * the upload or recognition time: without it the meal's time stays as the person states it, or date-only.
   */
  capturedAt?: string;
}

export type PhotoRecognizer = (req: { attachmentId: string; image: Blob; text?: string }, signal?: AbortSignal) => Promise<PhotoRecognition>;

/** `goals.suggest` with source 'ai' (E19): the model's raw reply (coerced and checked by the command) and its version. */
export type GoalSuggester = (req: { input: GoalSuggestionInput; rule: GoalSuggestion; signal?: AbortSignal }) => Promise<{ raw: unknown; version: string }>;

export interface AiPorts {
  recognizePhoto?: PhotoRecognizer;
  resolveExercise?: ExerciseResolver;
  /** E20: reads blood-test report pages without a text layer (patient details masked); installed with a vision model. */
  markerVision?: MarkerVisionPort;
  suggestGoals?: GoalSuggester;
}

let ports: AiPorts = {};

export function installAiPorts(next: AiPorts): void {
  ports = { ...next };
}

export function aiPorts(): Readonly<AiPorts> {
  return ports;
}
