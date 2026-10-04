/**
 * Progress forwarding for the anytime planner (dossier 18 §4.19; QA item 8). The optimiser reports progress by EU; the
 * worker binding throttles by wall time (≤ 4 Hz). Only pure progress ticks are throttled: an event that carries a new or
 * changed option set (provisional A, then A/B/C after the diversity stage) is always delivered, and once alternatives
 * exist later ticks keep carrying them (a tick that only knows option A must not make B and C disappear in the UI).
 */
import type { OptionSummary, PlannerProgress } from '../optim/pipeline';

/** Stable key of one option (structure + genome quantised like the optimiser's cache). */
export function optionKey(o: Pick<OptionSummary, 'structure' | 'x'>): string {
  let s = String(o.structure);
  for (let i = 0; i < o.x.length; i++) s += `,${Math.round(o.x[i]! * 1e6)}`;
  return s;
}

export interface ProgressGate {
  /**
   * Options to show for this event, or null when the event is a pure progress tick inside the throttle interval (drop
   * it). `changed` is true when the option set differs from the last delivered one.
   */
  (p: PlannerProgress): { list: OptionSummary[]; changed: boolean } | null;
}

/**
 * Gate for progress events. `now` is the wall clock (absent: no time throttling, every event is delivered);
 * `intervalMs` the minimum spacing of pure ticks within one stage.
 */
export function createProgressGate(now: (() => number) | undefined, intervalMs = 250): ProgressGate {
  let lastEmit = -Infinity;
  let lastStage = '';
  let lastSig: string | null = null;
  let sticky: OptionSummary[] | null = null;
  return (p) => {
    if (p.alternatives?.length) sticky = p.alternatives.slice();
    const list = sticky ?? (p.provisional ? [p.provisional] : []);
    const sig = list.map(optionKey).join('|');
    const changed = sig !== lastSig;
    const t = now ? now() : 0;
    if (now && !changed && p.stage === lastStage && t - lastEmit < intervalMs) return null;
    lastEmit = t;
    lastStage = p.stage;
    lastSig = sig;
    return { list, changed };
  };
}
