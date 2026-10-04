/**
 * The app's ring service (SUITE_SPEC §15.2). `getRingService()` returns the one instance; tests swap it with
 * `setRingServiceForTests`. The implementation is in ./ringService.ts.
 */
import type { RingService, RingStatus } from './types';

export type * from './types';

/** Placeholder until the service lands: no Bluetooth, no rings. */
function unsupportedService(): RingService {
  const none = async () => undefined;
  return {
    start: none, stop: none, rings: () => [] as RingStatus[], subscribe: () => () => undefined, availability: () => 'unsupported',
    async *scan() {}, pair: () => Promise.reject(new Error('unsupported')), connectHere: none, syncNow: none,
    checkNow: () => Promise.reject(new Error('unsupported')), watchLiveHeartRate: () => () => undefined, disconnect: none, forget: none,
  };
}

let instance: RingService | null = null;

export function getRingService(): RingService {
  return (instance ??= unsupportedService());
}

export function setRingServiceForTests(s: RingService | null): void {
  instance = s;
}
