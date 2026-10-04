/**
 * Ports the AI layer fills for command executors that need a model (E9b). Commands never import `src/ai`: the Coach
 * installs these when a provider is configured and clears them when it is removed; without them the executors use
 * their deterministic fallbacks (catalogue parser, heuristic exercise resolution) or fail with `precondition_failed`.
 */
import type { ExerciseResolver } from '@/catalogues';
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
}

export interface PhotoRecognition {
  components: PhotoComponentGuess[];
  /** "What I saw": one plain sentence for the confirmation card and the photo's alt text. */
  saw: string;
  /** Overall identification confidence 0–1. */
  confidence: number;
  /** A transcribed nutrition label (per 100 g), only when one was legible in the photo. */
  labelPer100g?: Record<string, number>;
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
