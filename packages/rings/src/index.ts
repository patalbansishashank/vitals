/*
 * Ring drivers for every supported family; owned by L-RINGS (plan 04 item 1).
 * The app (src/) and the server (packages/companion) import them as `@vitals/rings`.
 * Platform transports live with the app (`src/biometrics/ble`); the fake one is under `./testing`.
 */
export * from './types';
export * from './records';
export * from './session';
export { jstyle2301, createJ2301Family } from './jstyle2301/family';
export { colmi, createColmiFamily } from './colmi/family';
export { jring, createJringFamily } from './jring/family';
export { crp, createCrpFamily } from './crp/family';
export { luckring } from './luckring/family';
export { rwfit } from './rwfit/family';
export { ycbt } from './ycbt/family';
import type { RingFamily, Uuid } from './types';
import { normalizeUuid } from './types';
import { jstyle2301 } from './jstyle2301/family';
import { colmi } from './colmi/family';
import { jring } from './jring/family';
import { crp } from './crp/family';
import { luckring } from './luckring/family';
import { rwfit } from './rwfit/family';
import { ycbt } from './ycbt/family';

/**
 * Every family with a driver, in scan-match order (Lumen's registry order; J-Style first: R10 §6). A family registers here
 * when its port lands; the generic "SMART_RING" name goes to Jring last, so a Colmi ring that also advertises its own
 * service is claimed by Colmi first.
 */
export const RING_FAMILIES: readonly RingFamily[] = [jstyle2301, colmi, crp, luckring, rwfit, ycbt, jring];

const FDDA = normalizeUuid(0xfdda);
const COLMI_UART = normalizeUuid('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e');

/**
 * Lumen's `RingBLEClient.onServicesDiscovered`: a ring claimed by its advertisement (often as the generic "SMART_RING")
 * may show its real family only once connected. Given the connected device's services and the family the scan chose,
 * returns the family that should drive it (the same one when nothing changes). The service calls `transport.services()`
 * after connecting and, if the answer differs, closes and reopens the session with the returned family.
 */
export function rerouteAfterDiscovery(scanned: RingFamily, services: readonly Uuid[], families: readonly RingFamily[] = RING_FAMILIES): RingFamily {
  const has = new Set(services.map(normalizeUuid));
  const byId = (id: string): RingFamily | undefined => families.find((f) => f.id === id);
  if (has.has(COLMI_UART) && scanned.id === 'jring') return byId('colmi') ?? scanned;
  if (has.has(FDDA) && !has.has(COLMI_UART) && (scanned.id === 'jring' || scanned.id === 'colmi')) return byId('crp') ?? scanned;
  return scanned;
}

export function familyById(id: string): RingFamily | undefined {
  return RING_FAMILIES.find((f) => f.id === id);
}

/** First family whose scan rule claims the advertisement, in registry order (Lumen's `AdvertisementMatcher.match`). */
export function matchFamily(ad: Parameters<RingFamily['scan']['match']>[0], families: readonly RingFamily[] = RING_FAMILIES): RingFamily | undefined {
  return families.find((f) => f.scan.match(ad));
}
