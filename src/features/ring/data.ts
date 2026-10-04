/**
 * The Ring page's view of the ring service (SUITE_SPEC §15.2, owner L-RINGSVC). The types below are a structural
 * superset of `src/biometrics/service/types.ts` (L-RINGSVC): the real `RingService` and `RingStatus` are assignable
 * to these and every page-only extra is optional; `defaultRingService()` returns `getRingService()`.
 * `RingServiceProvider` injects a service (tests, screenshot fixtures); `unavailableRingService()` is a no-ring stand-in
 * for tests.
 *
 * The master sharing switch (`bio.setRingSharing`, §15.2) follows the same pattern: `RingSharing` is the page's
 * interface; the default reads `bio.sources` (./sharingPolicy.ts).
 */
import { createContext, createElement, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { platform, type Platform } from '@/platform';
import { isWebBluetoothAvailable } from '@/biometrics/ble/webBluetooth';
import { getRingService } from '@/biometrics/service';

/* ------------------------------------------------------------------------------------------------ §15.2 types */

export type Instant = string;

export type RingLinkState =
  | 'unsupported'
  | 'bluetooth_off'
  | 'permission_needed'
  | 'idle'
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'elsewhere'
  | 'error';

export type RingErrorCode = string;

export interface RingStatus {
  ringKey: string;
  /** Driver label, e.g. "J-Style 2301"; never the advertised name. */
  label: string;
  state: RingLinkState;
  battery?: number;
  firmware?: string;
  lastSyncAt?: Instant;
  /** 0..1 while `syncing` (and during a pair's first read). */
  syncProgress?: number;
  heldBy?: { deviceId: string; deviceLabel: string; platform: Platform; since: Instant };
  error?: { code: RingErrorCode; message: string };
  /** Latest live heart rate while the page watches it (`watchLiveHeartRate`). */
  liveHr?: { bpm: number; at: Instant };
  /** The person pressed Disconnect on this device: auto-connect is paused here. */
  paused?: boolean;
  /* Facts the page needs that §15.2 leaves to the driver; optional so the real service may add them later. */
  /** Device label of the device that read the ring last, when it was not this one. */
  lastSyncBy?: string;
  /** Battery is charging (when the driver reports it). */
  charging?: boolean;
  /** The last read failed while the link stayed up ("sync failed"). */
  syncError?: string;
  /** The person refused permission for good (Android): offer "Open app settings". */
  permissionDenied?: boolean;
  /** What the driver can do; a missing capability hides its control (D5). */
  caps?: RingCaps;
}

export type CheckMetric = 'hr' | 'spo2' | 'hrv' | 'skin_temp';

export interface RingCaps {
  /** Spot measurements the ring supports (Check now keys). Default: hr only. */
  checks?: CheckMetric[];
  /** Signals the ring measures at all (today rows show only these). Default: all. */
  measures?: Array<'sleep' | 'hr' | 'hrv' | 'spo2' | 'skin_temp' | 'activity' | 'stress'>;
  /** Driver-supported measuring intervals (minutes) for "how often your ring measures"; absent = row hidden. */
  intervals?: { min: number; max: number; step: number };
  findRing?: boolean;
  factoryReset?: boolean;
  /** How long a spot check takes at most, seconds (the progress rule's ceiling). */
  checkSeconds?: number;
}

export interface RingCandidate {
  candidateId: string;
  driverId: string;
  label: string;
  rssi?: number;
  known: boolean;
  /** Last 4 hex of the ring's own id ("ending 4F2A"), so two identical rings differ. */
  idTail?: string;
}

export interface CheckResult {
  value: number;
  unit: string;
  at: Instant;
}

export type RingAvailability = 'ready' | 'unsupported' | 'bluetooth_off' | 'permission_needed';

export interface RingService {
  rings(): RingStatus[];
  /** What the platform can do right now (drives the first card when there is no ring yet). */
  availability?(): RingAvailability;
  /** False while the first platform check is still running (`availability()` is not an answer yet); absent = known. */
  availabilityKnown?(): boolean;
  /** Live heart rate into `RingStatus.liveHr` until the returned function is called (the real service's way). */
  watchLiveHeartRate?(ringKey: string): () => void;
  subscribe(cb: (rings: RingStatus[]) => void): () => void;
  scan(signal: AbortSignal): AsyncIterable<RingCandidate>;
  pair(candidateId: string): Promise<RingStatus>;
  connectHere(ringKey: string): Promise<void>;
  syncNow(ringKey: string): Promise<void>;
  checkNow(ringKey: string, metric: CheckMetric): Promise<CheckResult>;
  disconnect(ringKey: string): Promise<void>;
  forget(ringKey: string): Promise<void>;
  /* Page-level additions (optional on the real service; use the helpers below, not these members directly): */
  /** "Connect" for an idle known ring; without it the page calls `connectHere` (a free or stale lease connects at once). */
  connect?(ringKey: string): Promise<void>;
  /** Stop searching / connecting this ring (never the service-wide `stop()` of the real service). */
  stopConnecting?(ringKey: string): Promise<void>;
  /** Live heart rate by callback (fakes); the real service uses `watchLiveHeartRate` + `RingStatus.liveHr`. */
  liveHeartRate?(ringKey: string, cb: (bpm: number | null) => void): () => void;
  /** Ask for Bluetooth on (Android) / permission again. */
  requestBluetooth?(): Promise<void>;
  requestPermission?(): Promise<void>;
  openAppSettings?(): Promise<void>;
  findRing?(ringKey: string): Promise<void>;
  factoryReset?(ringKey: string): Promise<void>;
  /** Live values during a check (heart rate shows it as it arrives). */
  checkProgress?(ringKey: string, cb: (live: number | null) => void): () => void;
  /** Battery samples for "battery over time" (ms, %). */
  batteryHistory?(ringKey: string, days: number): Promise<Array<{ t: number; v: number }>>;
  /** Abort a running check (nothing is saved). */
  stopCheck?(ringKey: string): Promise<void>;
}

/* ------------------------------------------------------------------------------------------------ platform */

export interface RingPlatform {
  platform: Platform;
  ble: 'web-bluetooth' | 'capacitor' | 'electron' | null;
  installedApp: boolean;
  keepAlive: boolean;
  /** "this phone" / "this computer" / "this browser". */
  here: string;
}

/** What this copy of Vitals can do with rings (until L-WEB's `platformCaps()` lands, derived from `platform()`). */
export function ringPlatform(): RingPlatform {
  const p = platform();
  const ble = p === 'android' ? 'capacitor' : p === 'electron' ? 'electron' : isWebBluetoothAvailable() ? 'web-bluetooth' : null;
  return {
    platform: p,
    ble,
    installedApp: p === 'android' || p === 'electron',
    keepAlive: p === 'android' || p === 'electron',
    here: p === 'android' ? 'this phone' : p === 'electron' ? 'this computer' : 'this browser',
  };
}

/* ------------------------------------------------------------------------------------------------ sharing (item 11) */

export type SharingState = 'on' | 'off' | 'some';

export interface RingSharing {
  subscribe(fn: () => void): () => void;
  /** null while loading or when there is no ring source. */
  state(): SharingState | null;
  set(on: boolean): Promise<void>;
  /** The one-time notice from the `biometrics.ringDefaults` migration is waiting. */
  noticePending(): boolean;
  dismissNotice(): void;
}

/* ------------------------------------------------------------------------------------------------ defaults + context */

const NO_RINGS: RingStatus[] = [];

/** No ring service in this build yet: no rings, an empty scan. */
export function unavailableRingService(): RingService {
  const nope = () => Promise.reject(new Error('The ring service is not available in this build yet.'));
  return {
    rings: () => NO_RINGS,
    subscribe: () => () => {},
    scan: async function* () {},
    pair: nope,
    connectHere: nope,
    syncNow: nope,
    checkNow: nope,
    disconnect: nope,
    forget: nope,
  };
}

let devRing: { service: RingService; platform?: Partial<RingPlatform>; sharing?: RingSharing } | null = null;
/** Dev builds only: the fixture the screenshot harness named (set by ./fixtures). */
export function setDevRingFixture(f: typeof devRing): void {
  devRing = f;
}

function defaultRingService(): RingService {
  if (import.meta.env.DEV && devRing) return devRing.service;
  // the app's one ring service (L-RINGSVC); the assignment checks the real type still fits the page's contract
  const real: RingService = getRingService();
  return real;
}

interface RingEnv {
  service: RingService;
  platform: RingPlatform;
  sharing: RingSharing | null;
}

const RingEnvContext = createContext<RingEnv | null>(null);

export function RingServiceProvider({ service, platform: plat, sharing, children }: { service: RingService; platform?: Partial<RingPlatform>; sharing?: RingSharing; children: ReactNode }) {
  const value: RingEnv = { service, platform: { ...ringPlatform(), ...plat }, sharing: sharing ?? null };
  return createElement(RingEnvContext.Provider, { value }, children);
}

export function useRingEnv(): RingEnv {
  const ctx = useContext(RingEnvContext);
  if (ctx) return ctx;
  if (import.meta.env.DEV && devRing) return { service: devRing.service, platform: { ...ringPlatform(), ...devRing.platform }, sharing: devRing.sharing ?? null };
  return { service: defaultRingService(), platform: ringPlatform(), sharing: null };
}

export function useRingService(): RingService {
  return useRingEnv().service;
}

/**
 * The last list a service reported, per service: `rings()` may build a new array on every call, and
 * useSyncExternalStore needs the same value back until something changed (else it renders forever).
 */
const ringSnapshots = new WeakMap<RingService, RingStatus[]>();
function ringSnapshot(svc: RingService): RingStatus[] {
  let s = ringSnapshots.get(svc);
  if (!s) ringSnapshots.set(svc, (s = svc.rings()));
  return s;
}

/** Every known ring, live. */
export function useRings(): RingStatus[] {
  const svc = useRingService();
  const subscribe = useCallback(
    (fn: () => void) => {
      const off = svc.subscribe((rings) => {
        ringSnapshots.set(svc, rings ?? svc.rings());
        fn();
      });
      // a change between the first read and the subscription
      const now = svc.rings();
      if (JSON.stringify(now) !== JSON.stringify(ringSnapshot(svc))) {
        ringSnapshots.set(svc, now);
        fn();
      }
      return off;
    },
    [svc],
  );
  return useSyncExternalStore(subscribe, () => ringSnapshot(svc), () => NO_RINGS);
}

/** A last read older than this makes a ring "stale" (§5.2). */
export const STALE_MS = 24 * 3_600_000;

export function isStale(r: RingStatus, now: number): boolean {
  if (r.state !== 'idle' && r.state !== 'elsewhere') return false;
  return !r.lastSyncAt || now - Date.parse(r.lastSyncAt) > STALE_MS;
}

/** The worst state over all rings, for the RingKey light (§4.2). */
export function worstRingState(rings: readonly RingStatus[], now: number): 'none' | 'attention' | 'off' | 'elsewhere' | 'reading' | 'connected' {
  if (!rings.length) return 'none';
  const attention = rings.some((r) => r.state === 'error' || r.state === 'bluetooth_off' || r.state === 'permission_needed' || isStale(r, now));
  if (attention) return 'attention';
  if (rings.some((r) => r.state === 'idle' || r.state === 'searching' || r.state === 'connecting')) return 'off';
  if (rings.some((r) => r.state === 'elsewhere')) return 'elsewhere';
  if (rings.some((r) => r.state === 'syncing')) return 'reading';
  if (rings.every((r) => r.state === 'unsupported')) return 'none';
  return 'connected';
}

/* ------------------------------------------------------------------------------------------------ helpers over both shapes */

/** Connect an idle ring: the page-level `connect` when present, else `connectHere`. */
export function connectRing(svc: RingService, ringKey: string): Promise<void> {
  return svc.connect ? svc.connect(ringKey) : svc.connectHere(ringKey);
}

/** What the platform can do now: the service's own answer, else derived from the platform. */
export function ringAvailability(svc: RingService, plat: RingPlatform): RingAvailability {
  return svc.availability?.() ?? (plat.ble ? 'ready' : 'unsupported');
}

/**
 * What the page shows for the platform: 'checking' while the service's first check is still running on a platform with
 * a Bluetooth API (never "can't connect here" before the check says so); a platform with none is 'unsupported' at once.
 */
export function pageRingAvailability(svc: RingService, plat: RingPlatform): RingAvailability | 'checking' {
  if (svc.availabilityKnown && !svc.availabilityKnown()) return plat.ble ? 'checking' : 'unsupported';
  return ringAvailability(svc, plat);
}

/**
 * Live heart rate for one ring while `active` (the page is visible and the ring connected): `{ bpm, at }` or null.
 * Works with the real service (`watchLiveHeartRate` + `ring.liveHr`) and with callback fakes (`liveHeartRate`).
 */
export function useLiveHeartRate(ring: RingStatus | null, active: boolean, nowMs: () => number = Date.now): { bpm: number; at: number } | null {
  const svc = useRingService();
  const key = ring?.ringKey ?? null;
  const [cb, setCb] = useState<{ key: string; bpm: number; at: number } | null>(null);
  useEffect(() => {
    if (!active || !key) return;
    if (svc.watchLiveHeartRate) return svc.watchLiveHeartRate(key);
    if (svc.liveHeartRate) return svc.liveHeartRate(key, (bpm) => setCb(bpm === null ? null : { key, bpm, at: nowMs() }));
    // `nowMs` is a clock reader, not data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, key, active]);
  if (!active || !key) return null;
  if (svc.watchLiveHeartRate) return ring?.liveHr ? { bpm: ring.liveHr.bpm, at: Date.parse(ring.liveHr.at) } : null;
  return cb && cb.key === key ? { bpm: cb.bpm, at: cb.at } : null;
}
