/**
 * (0.6.3 A30/S28) Whose Gauge data a screen cache holds, and when it went out of date.
 *
 * - `gaugeIdentity()`: the paired server and person, null when not paired. Every Ring and
 *   Progress cache keys its answers by it, so another server's or another person's answers are never read back, and
 *   `onGaugeIdentityChange` fires on pair, unpair, revocation (a 401 ends the pairing) and replacement.
 * - `notifyGaugeDataChanged()`: new data reached the server or the app (a successful import, a measurement command that
 *   finished): the screens ask their questions again, keeping what they show until the new answers arrive.
 */
import { getServerClient, type ServerClient } from './server';

type Client = Pick<ServerClient, 'pairing' | 'subscribe'>;

let clientOf: () => Client = () => getServerClient();

/** Stable server/person identity, also used by persisted import watermarks. */
export function gaugeIdentity(): string | null {
  try {
    const p = clientOf().pairing();
    return p ? `${p.baseUrl.replace(/\/+$/, '')}|${p.person.id}` : null;
  } catch {
    return null;
  }
}

const identityListeners = new Set<(identity: string | null) => void>();
let watched: Client | null = null;
let unwatch: (() => void) | null = null;
let last: string | null | undefined;
let lastSession: string | null | undefined;
function sessionIdentity(): string | null {
  try {
    const p = clientOf().pairing();
    return p ? JSON.stringify([p.baseUrl.replace(/\/+$/, ''), p.person.id, p.deviceId, p.pairedAt]) : null;
  } catch { return null; }
}

function check(): void {
  const session = sessionIdentity();
  if (session === lastSession) return;
  lastSession = session;
  const now = gaugeIdentity();
  last = now;
  for (const l of [...identityListeners]) l(now);
}

/** Subscribe to the server client in use (re-attached when it is replaced). */
function ensureWatch(): void {
  let c: Client;
  try {
    c = clientOf();
  } catch {
    return;
  }
  if (c === watched) return;
  unwatch?.();
  watched = c;
  try {
    unwatch = c.subscribe(check);
  } catch {
    unwatch = null;
  }
  if (last === undefined) { last = gaugeIdentity(); lastSession = sessionIdentity(); }
  else { lastSession = undefined; check(); }
}

/** Called on pair/unpair/revocation/client replacement, including a new pairing session for the same person. */
export function onGaugeIdentityChange(fn: (identity: string | null) => void): () => void {
  ensureWatch();
  identityListeners.add(fn);
  return () => void identityListeners.delete(fn);
}

/** Re-read the identity now (a screen mounting; the server client was replaced). Fires the listeners when it moved. */
export function recheckGaugeIdentity(): string | null {
  ensureWatch();
  check();
  return last ?? null;
}

const dataListeners = new Set<() => void>();

/** New Gauge data may exist: an import succeeded, a measurement finished. */
export function notifyGaugeDataChanged(): void {
  for (const l of [...dataListeners]) l();
}

export function onGaugeDataChanged(fn: () => void): () => void {
  dataListeners.add(fn);
  return () => void dataListeners.delete(fn);
}

/** Tests: read the pairing from this client (null restores the app's). */
export function setGaugeIdentityClientForTests(c: Client | null): void {
  clientOf = c ? () => c : () => getServerClient();
  ensureWatch();
  check();
}
