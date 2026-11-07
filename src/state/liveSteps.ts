/**
 * (r063 S27/A29) Today's live step snapshot: the freshest today reading the Gauge import saw, kept in memory apart from
 * the throttled entries it writes (`liveStepsOverlay` puts it into today's model). One per device session; replaced by
 * every import run that reads today; cleared on another day.
 *
 * (0.6.3 FX1, aR11) Scoped by the Gauge identity (paired server and person): a snapshot taken for one identity is never
 * read under another, and pairing, unpairing or a revoked device clears it. The import also clears it when the server
 * answers that today's evidence is gone (sR03/aR05), never on an offline or failed read.
 */
import type { LiveStepsSnapshot } from '@/living/gaugeImport';
import { gaugeIdentity, onGaugeIdentityChange } from '@/net/gaugeIdentity';

let snap: { value: LiveStepsSnapshot; identity: string | null } | null = null;
const listeners = new Set<() => void>();
let watching = false;

function watch(): void {
  if (watching) return;
  watching = true;
  try {
    onGaugeIdentityChange(() => setLiveTodaySteps(null));
  } catch {
    watching = false;
  }
}

/** Today's snapshot for whoever is paired now (null: none, or taken for another identity). */
export function liveTodaySteps(): LiveStepsSnapshot | null {
  if (!snap) return null;
  return snap.identity === gaugeIdentity() ? snap.value : null;
}

/**
 * Keep `next` (null clears it) for `identity` (default: whoever is paired now); listeners hear only a change of value. A
 * caller that read under another identity than the current one is dropped (an obsolete in-flight read).
 */
export function setLiveTodaySteps(next: LiveStepsSnapshot | null, identity: string | null = gaugeIdentity()): void {
  watch();
  if (next && identity !== gaugeIdentity()) return;
  const prev = snap?.value ?? null;
  const same = (prev === null && next === null) || (prev && next && snap!.identity === identity && prev.day.date === next.day.date && prev.day.steps === next.day.steps && JSON.stringify(prev.day.fusion ?? null) === JSON.stringify(next.day.fusion ?? null));
  snap = next ? { value: next, identity } : null;
  if (!same) listeners.forEach((l) => l());
}

export function subscribeLiveSteps(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
