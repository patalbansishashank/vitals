/**
 * (0.6.7 AD-VITALS) The server's OPEN detection episodes (`detect/2`, still going on), for Today's live line: "Walking now ·
 * detected · 18 min". Kept in memory apart from the candidates: an open episode is never an activity to review (no
 * Approve until it ends), and it is replaced by every import run that read the detections. Scoped by the Gauge identity
 * like today's live steps (`liveSteps.ts`): a snapshot taken for one pairing is never read under another, and pairing,
 * unpairing or a revoked device clears it.
 */
import { gaugeIdentity, onGaugeIdentityChange } from '@/net/gaugeIdentity';

/** One open episode: its label, its start and the end of its newest evidence (epoch ms). */
export interface LiveDetection {
  id: string;
  label: string;
  start: number;
  end: number;
}

let snap: { value: LiveDetection[]; identity: string | null } | null = null;
const EMPTY: LiveDetection[] = [];
const listeners = new Set<() => void>();
let watching = false;

function watch(): void {
  if (watching) return;
  watching = true;
  try {
    onGaugeIdentityChange(() => setLiveDetections(null));
  } catch {
    watching = false;
  }
}

/** The open episodes for whoever is paired now (empty: none, or read for another identity). Stable between changes. */
export function liveDetections(): LiveDetection[] {
  if (!snap) return EMPTY;
  return snap.identity === gaugeIdentity() ? snap.value : EMPTY;
}

/** Keep `next` (null clears) for `identity` (default whoever is paired now); listeners hear only a change. */
export function setLiveDetections(next: readonly LiveDetection[] | null, identity: string | null = gaugeIdentity()): void {
  watch();
  if (next && identity !== gaugeIdentity()) return;
  const value = next && next.length ? next.map((x) => ({ ...x })).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1)) : null;
  const same = JSON.stringify(snap?.value ?? null) === JSON.stringify(value) && (value === null || snap?.identity === identity);
  snap = value ? { value, identity } : null;
  if (!same) listeners.forEach((l) => l());
}

export function subscribeLiveDetections(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** An open episode older than this (its newest evidence) is not shown as going on now (the import has not run since). */
export const LIVE_DETECTION_STALE_MS = 15 * 60_000;
