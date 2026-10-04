/**
 * The app's ring service (SUITE_SPEC §15.2). `getRingService()` returns the one instance (built over the app's store,
 * sync view and transport on first use; `./app.ts`); tests swap it with `setRingServiceForTests` or build their own
 * with `createRingService` over fake ports. The state machine is in `./ringService.ts`.
 */
import { createAppRingService } from './app';
import type { RingService } from './types';

export type * from './types';
export { LEASE_HEARTBEAT_MS, LEASE_STALE_MS, SYNC_EVERY_MS, TAKEOVER_PAUSE_MS, TAKEOVER_RETRY_MS, leaseDocId, isLeaseDocId } from './types';
export { createRingService, ANOTHER_APP } from './ringService';
export { RingLinkError } from './ports';
export type * from './ports';
export { familyIdentity, ringLabelOf, ringKeyOf, parseRingKey } from './identity';

/** When the app cannot build a service in this context (no store): no Bluetooth, no rings. */
function unsupportedService(): RingService {
  const none = async () => undefined;
  const no = () => Promise.reject(new Error('The ring service is not available here.'));
  return {
    start: none, stop: none, rings: () => [], subscribe: () => () => undefined, availability: () => 'unsupported',
    async *scan() {}, pair: no, connectHere: none, syncNow: none, checkNow: no, stopCheck: none, watchLiveHeartRate: () => () => undefined, disconnect: none, forget: none, syncLink: no,
  };
}

let instance: RingService | null = null;

export function getRingService(): RingService {
  if (!instance) {
    try {
      instance = createAppRingService();
    } catch (e) {
      console.warn('Vitals: the ring service could not start here', e);
      instance = unsupportedService();
    }
  }
  return instance;
}

export function setRingServiceForTests(s: RingService | null): void {
  instance = s;
}
