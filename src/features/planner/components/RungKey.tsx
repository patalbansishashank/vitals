import { RUNG_INITIAL, type PlanKind } from '../ladder';

/**
 * Rung key (COMPONENTS §13.6): 24 × 24, rung colour fill with the inverse initial H / M / E; the Ideal is hollow with
 * "I" and a dashed edge. Identity never by colour alone: the initial and the title always travel with it.
 */
export function RungKey({ kind, pressed, size = 'md' }: { kind: PlanKind; pressed?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className="lp-rkey" data-rung={kind} data-pressed={pressed || undefined} data-size={size} aria-hidden="true">
      {RUNG_INITIAL[kind]}
    </span>
  );
}
