/**
 * Ring service contract (SUITE_SPEC §15.2, plan 04 item 1). Tier H types only.
 *
 * One service per app (`getRingService()`), started at boot after the store opens. It finds, connects and reads the
 * person's rings through whatever transport the platform has, writes records with provenance into the biometrics store
 * (so sync carries them to every device), and keeps "who holds the ring" in a lease document beside the ring's source
 * (`bioSources/lease:<ringKey>`). Screens read `rings()` / `subscribe()` and call the actions; history goes through
 * `bio.*` commands.
 */
import type { BleLink } from '@/biometrics/core/ble/types';
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
  /** What the ring can read on demand (`checkNow`). */
  caps?: { checks: CheckMetric[] };
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
  /** Last 4 hex of the ring's own id when the platform can see it (tells two rings apart; never the advertised name). */
  idTail?: string;
  /**
   * The person has several possible saved rings: those of the advertised family, or all saved rings when the chooser
   * cannot identify a family until connecting. The chosen key is checked against the discovered family before ingest.
   */
  matches?: Array<{ ringKey: string; lastSyncBy?: string; lastSyncAt?: Instant }>;
}

export type CheckMetric = 'hr' | 'spo2' | 'hrv' | 'skin_temp';

/** What one read of a ring brought in (the `bio.deviceConnect` / `bio.deviceSync` job result). */
export interface RingSyncReport {
  sourceKey: string;
  driver: string;
  firmware: string;
  battery: number | null;
  records: number;
  samples: number;
  duplicates: number;
  days: { from: string; to: string } | null;
  warnings: string[];
  scored: number;
}

export interface RingService {
  /** Starts auto-connect (idempotent). */
  start(): Promise<void>;
  stop(): Promise<void>;
  rings(): RingStatus[];
  subscribe(cb: (rings: RingStatus[]) => void): () => void;
  /** What the platform can do right now (drives the Ring page's first card). */
  availability(): 'ready' | 'unsupported' | 'bluetooth_off' | 'permission_needed';
  /** False until `start()` has asked the platform once (`availability()` reads 'unsupported' until then). */
  availabilityKnown?(): boolean;
  /** The pairing list. On the web this opens the browser's chooser and must run inside a click. */
  scan(signal: AbortSignal): AsyncIterable<RingCandidate>;
  /** First connect and the full history the ring holds. `ringKey` answers a candidate's `matches` question. */
  pair(candidateId: string, ringKey?: string): Promise<RingStatus>;
  /** "Connect here instead". */
  connectHere(ringKey: string): Promise<void>;
  syncNow(ringKey: string): Promise<void>;
  /** Rejects with an Error whose `code` is 'no_reading' or 'off_finger' when the ring says so. */
  checkNow(ringKey: string, metric: CheckMetric): Promise<{ value: number; unit: string; at: Instant }>;
  /** Ends a running `checkNow`; nothing is stored. Optional so a test fake needs nothing more. */
  stopCheck?(ringKey: string): Promise<void>;
  /** Live heart rate while the returned function is not called (the Ring page while visible). */
  watchLiveHeartRate(ringKey: string): () => void;
  /** Stays known; auto-connect paused on this device until Connect is pressed here. */
  disconnect(ringKey: string): Promise<void>;
  /** Removes the ring from this person (its data stays). */
  forget(ringKey: string): Promise<void>;
  /**
   * The web chooser path (`bio.deviceConnect` / `bio.deviceSync`): a link the screen opened inside the click and
   * staged with `stageBleLink`. The service takes the link over, reads history (all of it for a new ring, since the
   * last read otherwise) and stays connected afterwards. Resolves with the job's report.
   */
  syncLink(link: BleLink, driverId: string, opts?: { ringKey?: string; create?: boolean; signal?: AbortSignal; onProgress?: (p: number, stage: string) => void }): Promise<RingSyncReport>;
}

/**
 * The lease on a ring: `bioSources` document `lease:<ringKey>`. `bioSources` merges per top-level field, so the holder
 * writes `holder` and `heartbeatAt`, the taker writes `takeover`, and a merge never loses either.
 */
export interface RingLeaseBody {
  kind: 'ringLease';
  ringKey: string;
  holder: RingHolder | null;
  /** Written by the holder only. */
  heartbeatAt: Instant | null;
  /** Written by the taker only. */
  takeover: { deviceId: string; deviceLabel: string; at: Instant } | null;
  /**
   * The device the person last chose with Connect / "Connect here instead": it gets the head start when the lease is
   * free (R6). Absent: the phone does, it runs the background service. Written by `connectHere` only; optional so older
   * lease documents still parse.
   */
  preferred?: { deviceId: string; deviceLabel: string; at: Instant } | null;
}
/** @deprecated first draft's name; the lease is `RingLeaseBody`. */
export type RingLease = RingLeaseBody;

export const leaseDocId = (ringKey: string): string => `lease:${ringKey}`;
export const isLeaseDocId = (id: string): boolean => id.startsWith('lease:');

/** The holder's heartbeat: each write is a synced change kept forever, so not more often than this. */
export const LEASE_HEARTBEAT_MS = 300_000;
export const LEASE_STALE_MS = 900_000;
export const SYNC_EVERY_MS = 30 * 60_000;
/** After `connectHere` the taker keeps trying for this long (BLE needs a few seconds to free the link). */
export const TAKEOVER_RETRY_MS = 60_000;
/** A holder that lost the ring to another device leaves it alone for this long (or until Connect is pressed). */
export const TAKEOVER_PAUSE_MS = 12 * 60 * 60_000;
/**
 * A free or stale lease: the preferred device (the phone unless the person chose another) connects at once; every other
 * device waits this long and looks at the lease again first, so two devices that start together do not both grab the
 * ring (R6).
 */
export const FREE_GRACE_MS = 15_000;
/** A link that has stayed up this long is a real one: the reconnect ladder starts over at the next drop (R4). */
export const STABLE_LINK_MS = 60_000;
/** A holder whose retries failed this many times in a row lets go of the lease, so another device may try (R1). */
export const RELEASE_AFTER_ATTEMPTS = 3;
