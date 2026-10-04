/**
 * Ring service contract (SUITE_SPEC §15.2, plan 04 item 1). Tier H types only.
 *
 * One service per app (`getRingService()`), started at boot after the store opens. It finds, connects and reads the
 * person's rings through whatever transport the platform has, writes records with provenance into the biometrics store
 * (so sync carries them to every device), and keeps "who holds the ring" in the ring's synced source document (the
 * lease). Screens read `rings()` / `subscribe()` and call the actions; history goes through `bio.*` commands.
 */
import type { Instant } from '@/biometrics/core/types';
import type { Platform } from '@/platform';

export type RingLinkState =
  | 'unsupported' // the platform has no Bluetooth the app can use
  | 'bluetooth_off'
  | 'permission_needed'
  | 'idle' // known ring, not connected, not trying
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'elsewhere' // another device of this person holds the ring (fresh lease)
  | 'error';

export type RingServiceErrorCode =
  | 'not_found' // no ring answered (maybe connected to another app or phone)
  | 'refused' // the ring refused the connection or the handshake
  | 'unsupported_firmware'
  | 'bond_required' // the OS pairing prompt was dismissed
  | 'disconnected'
  | 'bluetooth_off'
  | 'permission_needed'
  | 'failed';

export interface RingHolder {
  deviceId: string;
  deviceLabel: string;
  platform: Platform;
  since: Instant;
}

export interface RingStatus {
  /** The ring's source key (`bioSources` id); identical on every device. */
  ringKey: string;
  /** Driver label ('J-Style 2301'); never the advertised name. */
  label: string;
  state: RingLinkState;
  battery?: number;
  charging?: boolean;
  firmware?: string;
  lastSyncAt?: Instant;
  /** Device label of the device that synced last. */
  lastSyncBy?: string;
  /** 0..1 while `state === 'syncing'`. */
  syncProgress?: number;
  /** Latest live heart rate while someone watches it (`watchLiveHeartRate`). */
  liveHr?: { bpm: number; at: Instant };
  /** Set when another device holds the ring (`state === 'elsewhere'`). */
  heldBy?: RingHolder;
  /** The person pressed Disconnect on this device: auto-connect is paused here. */
  paused?: boolean;
  /** Plain words; never names a passcode or a retail brand. */
  error?: { code: RingServiceErrorCode; message: string };
}

export interface RingCandidate {
  candidateId: string;
  /** Driver id ('jstyle2301', 'colmi', …). */
  driverId: string;
  /** Driver label ('J-Style 2301'); the advertised name is never shown or stored. */
  label: string;
  rssi?: number;
  /** Already one of the person's rings. */
  known: boolean;
}

export type CheckMetric = 'hr' | 'spo2' | 'hrv' | 'skin_temp';

export interface RingService {
  /** Starts auto-connect (idempotent). */
  start(): Promise<void>;
  stop(): Promise<void>;
  rings(): RingStatus[];
  subscribe(cb: (rings: RingStatus[]) => void): () => void;
  /** What the platform can do right now (drives the Ring page's first card). */
  availability(): 'ready' | 'unsupported' | 'bluetooth_off' | 'permission_needed';
  /** The pairing list. On the web this opens the browser's chooser and must run inside a click. */
  scan(signal: AbortSignal): AsyncIterable<RingCandidate>;
  /** First connect and the full history the ring holds. */
  pair(candidateId: string): Promise<RingStatus>;
  /** "Connect here instead". */
  connectHere(ringKey: string): Promise<void>;
  syncNow(ringKey: string): Promise<void>;
  checkNow(ringKey: string, metric: CheckMetric): Promise<{ value: number; unit: string; at: Instant }>;
  /** Live heart rate while the returned function is not called (the Ring page while visible). */
  watchLiveHeartRate(ringKey: string): () => void;
  /** Stays known; auto-connect paused on this device until Connect is pressed here. */
  disconnect(ringKey: string): Promise<void>;
  /** Removes the ring from this person (its data stays). */
  forget(ringKey: string): Promise<void>;
}

/** The lease on a ring's synced source document (`SourceBody.ble.link`). */
export interface RingLease {
  deviceId: string;
  deviceLabel: string;
  platform: Platform;
  since: Instant;
  heartbeatAt: Instant;
  takeover?: { deviceId: string; deviceLabel: string; at: Instant };
}

export const LEASE_HEARTBEAT_MS = 60_000;
export const LEASE_STALE_MS = 180_000;
export const SYNC_EVERY_MS = 30 * 60_000;
