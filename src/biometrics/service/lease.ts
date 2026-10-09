/**
 * The ring lease, pure (SUITE_SPEC §15.2 "One central at a time"). A `bioSources` document `lease:<ringKey>` says
 * which device holds the ring; the holder writes `holder` and `heartbeatAt`, a device that wants the ring writes
 * `takeover`. `bioSources` merges per top-level field, so the two writers never overwrite each other.
 */
import type { Platform } from '@/platform';
import { LEASE_STALE_MS, type RingHolder, type RingLeaseBody } from './types';

export type LeaseView =
  | { kind: 'free' } // no holder, or sync is off (nothing to read)
  | { kind: 'mine'; takeover: RingLeaseBody['takeover'] } // this device holds it; `takeover` set when another device asked for it
  | { kind: 'stale'; holder: RingHolder } // a holder stopped heartbeating
  | { kind: 'held'; holder: RingHolder }; // another device holds it with a fresh heartbeat

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

export function isStale(lease: Pick<RingLeaseBody, 'heartbeatAt' | 'holder'>, nowMs: number): boolean {
  const beat = ms(lease.heartbeatAt) || ms(lease.holder?.since);
  return !Number.isFinite(beat) || nowMs - beat > LEASE_STALE_MS;
}

/** When a held lease goes stale (ms since the epoch); NaN when there is nothing to wait for. */
export function staleAt(lease: Pick<RingLeaseBody, 'heartbeatAt' | 'holder'> | undefined): number {
  if (!lease?.holder) return NaN;
  const beat = ms(lease.heartbeatAt) || ms(lease.holder.since);
  return Number.isFinite(beat) ? beat + LEASE_STALE_MS + 1 : NaN;
}

/**
 * Whether this device connects at once when the lease is free or stale (R6): the device the person last chose with
 * Connect / "Connect here instead", else the phone (it runs the background service and reads the night). Every other
 * device waits `FREE_GRACE_MS` and looks again first.
 */
export function preferredHere(lease: Pick<RingLeaseBody, 'preferred'> | undefined, me: string, platform: Platform): boolean {
  const p = lease?.preferred;
  return p ? p.deviceId === me : platform === 'android';
}

/** How this device sees the lease. Without sync there is no lease at all. */
export function leaseView(lease: RingLeaseBody | undefined, me: string, nowMs: number, syncOn: boolean): LeaseView {
  if (!syncOn || !lease?.holder) return { kind: 'free' };
  if (lease.holder.deviceId === me) return { kind: 'mine', takeover: lease.takeover ?? null };
  return isStale(lease, nowMs) ? { kind: 'stale', holder: lease.holder } : { kind: 'held', holder: lease.holder };
}

/** A taker that gave up (its 60 s of retries are long over) no longer counts. */
export const TAKEOVER_MAX_AGE_MS = 120_000;

/** A takeover another device wrote after this holder's `since` (an older one was already answered) and not too long ago. */
export function takeoverFor(lease: RingLeaseBody | undefined, me: string, nowMs: number): RingLeaseBody['takeover'] {
  const t = lease?.takeover;
  if (!t || !lease?.holder || lease.holder.deviceId !== me || t.deviceId === me) return null;
  return ms(t.at) >= ms(lease.holder.since) && nowMs - ms(t.at) <= TAKEOVER_MAX_AGE_MS ? t : null;
}

/** The holder's fields only: `takeover` belongs to the taker and is never touched here. */
export function claimPatch(me: { deviceId: string; deviceLabel: string; platform: Platform }, nowIso: string, ringKey: string): Partial<RingLeaseBody> {
  return { kind: 'ringLease', ringKey, holder: { ...me, since: nowIso }, heartbeatAt: nowIso };
}

export const heartbeatPatch = (nowIso: string): Partial<RingLeaseBody> => ({ heartbeatAt: nowIso });
export const releasePatch = (): Partial<RingLeaseBody> => ({ holder: null, heartbeatAt: null });
export const takeoverPatch = (me: { deviceId: string; deviceLabel: string }, nowIso: string): Partial<RingLeaseBody> => ({ takeover: { ...me, at: nowIso } });
/** The person chose this device (Connect / "Connect here instead"): it gets the head start on a free lease from now on. */
export const preferPatch = (me: { deviceId: string; deviceLabel: string }, nowIso: string): Partial<RingLeaseBody> => ({ preferred: { ...me, at: nowIso } });
