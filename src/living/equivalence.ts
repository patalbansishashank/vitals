/**
 * Equivalence credit port (docs/SUITE_SPEC.md §8.4, PLANNER_V2 §8.6). The adherence score consumes E8's
 * `stimulusEquivalence` (src/catalogues) through this one function type, so a later API change touches one line and tests
 * can inject a stub. A substitute at parity (S ≥ 0.90) scores 1, a lighter one partially, a different stimulus is credited
 * for what it trains; the engine always simulates what was logged.
 */
import { defaultIntent, stimulusEquivalence } from '@/catalogues';
import type { EquivalenceResult, StimulusIntent, StimulusVector } from './plannerContract';

export type EquivalenceFn = (prescribed: StimulusVector, performed: StimulusVector, alpha?: StimulusIntent) => Pick<EquivalenceResult, 'credit' | 'parity' | 'shortfall'> & { score?: number };

/** E8's scorer with its default intent when the plan supplies none (`PlanSensitivities.intentByItem`). */
export const catalogueEquivalence: EquivalenceFn = (prescribed, performed, alpha) => stimulusEquivalence(prescribed, performed, alpha ?? defaultIntent(prescribed));
