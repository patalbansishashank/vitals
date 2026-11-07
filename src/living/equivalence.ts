/**
 * Equivalence credit port (docs/SUITE_SPEC.md §8.4, PLANNER_V2 §8.6). The adherence score consumes E8's
 * `stimulusEquivalence` (src/catalogues) through this one function type, so a later API change touches one line and tests
 * can inject a stub. A substitute at parity (S ≥ 0.90) scores 1, a lighter one partially, a different stimulus is credited
 * for what it trains; the engine always simulates what was logged.
 *
 * (D3-02) The credit is observed practice completion, not predicted strength: the catalogue scorer assigns performed to
 * prescribed set capacity once (no performed set completes several prescriptions), and this port adds the accounting
 * invariants every scorer must keep — a finite credit in [0, 1], and no credit from zero performed work against a
 * non-empty prescription. Cross-task transfer coefficients stay the catalogue's named heuristics; a completion score never
 * authorises catch-up work.
 */
import { defaultIntent, stimulusEquivalence } from '@/catalogues';
import type { EquivalenceResult, StimulusIntent, StimulusVector } from './plannerContract';

export type EquivalenceFn = (prescribed: StimulusVector, performed: StimulusVector, alpha?: StimulusIntent) => Pick<EquivalenceResult, 'credit' | 'parity' | 'shortfall'> & { score?: number };

/** Version of the port's credit semantics (C7: recomputed scores carry `ADHERENCE_SCORING_VERSION`, stored ones keep theirs). */
export const EQUIVALENCE_PORT_VERSION = 2;

const positive = (x: number | undefined): boolean => x !== undefined && Number.isFinite(x) && x > 0;

/** Any work at all in a stimulus vector (sets, strength practice, cardio, energy above rest or mobility minutes). */
export function stimulusHasWork(s: StimulusVector): boolean {
  return (
    Object.values(s.effectiveSetsByRegion ?? {}).some(positive) ||
    (s.strength ?? []).some((w) => positive(w.sets)) ||
    positive(s.mem) ||
    positive(s.hiMinutes) ||
    positive(s.netKcal) ||
    Object.values(s.mobilityMinutes ?? {}).some(positive)
  );
}

/**
 * Wrap a scorer with the accounting invariants (D3-02): zero performed work against a prescription with work is credit 0
 * (never parity); every other credit is clamped to a finite value in [0, 1], and parity requires full credit.
 */
export function withCreditInvariants(fn: EquivalenceFn): EquivalenceFn {
  return (prescribed, performed, alpha) => {
    if (stimulusHasWork(prescribed) && !stimulusHasWork(performed)) return { credit: 0, parity: false, shortfall: [], score: 0 };
    const r = fn(prescribed, performed, alpha);
    const credit = Number.isFinite(r.credit) ? Math.min(1, Math.max(0, r.credit)) : 0;
    return { ...r, credit, parity: r.parity && credit >= 0.999 };
  };
}

/** E8's scorer with its default intent when the plan supplies none (`PlanSensitivities.intentByItem`). */
export const catalogueEquivalence: EquivalenceFn = withCreditInvariants((prescribed, performed, alpha) => stimulusEquivalence(prescribed, performed, alpha ?? defaultIntent(prescribed)));
