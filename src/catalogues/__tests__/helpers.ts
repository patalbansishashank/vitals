/** Shared fixtures of the catalogue tests. */
import type { StimulusContext, TrainingProfile } from '@/catalogues';

/** R3 §5.4 worked examples use an 80 kg person with VO2max 40 mL/kg/min. */
export const CTX: StimulusContext = { bodyMassKg: 80, vo2max: 40, heightM: 1.75 };

export function profile(over: Partial<TrainingProfile> = {}): TrainingProfile {
  return {
    owned: [],
    access: [],
    refused: [],
    liked: [],
    injuries: [],
    skill: 2,
    purchaseAllowance: { maxPriceTier: 0, maxItems: 0 },
    ...over,
  };
}

/** Deterministic PRNG for cheap property tests (no Math.random in the catalogue code or its tests). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
