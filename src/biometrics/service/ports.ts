/**
 * Ports the ring service drives (tier H, no DOM). Each one has a real implementation in `./app.ts` (the app's store,
 * sync view, platform shell and transport) and a fake in `./__tests__/fakes.ts`, so the service's state machine is
 * tested without hardware and the real transports plug in underneath (`./connectors/legacy.ts` today, A5a's sessions in
 * `./connectors/rings.ts` once `openRingSession` lands).
 */
import type { BleLink } from '@/biometrics/core/ble/types';
import type { BioBatch, BioStream, Instant } from '@/biometrics/core/types';
import type { SourceBody } from '@/biometrics/store/docIndex';
import type { Platform } from '@/platform';
import type { RingEvent, SpotKind } from '../../../packages/rings/src/types';
import type { CheckMetric, RingLeaseBody, RingSyncReport } from './types';

// ---------------------------------------------------------------- the ring link (what a connected ring offers)

export type RingAvailability = 'ready' | 'unsupported' | 'bluetooth_off' | 'permission_needed';

/** The ring, as the driver identifies it; never the advertised name, never the platform's device id. */
export interface RingLinkIdentity {
  driverId: string;
  /** Family id for A5a keys ('jstyle2301'); equals `driverId` for the old web drivers. */
  family: string;
  maker: string;
  model: string;
  /** `serial:<S>` | `mac:<aa:bb:…>` | `adv:<id>`; undefined when this platform cannot see any basis (a browser). */
  ringId?: string;
}

export interface RingLinkInfo {
  firmware: string;
  battery?: number;
  charging?: boolean;
  /** Ring clock minus phone clock, seconds. */
  clockOffsetS: number;
}

export type SyncCursor = Partial<Record<BioStream, string>>;

/** A connected ring with the handshake done. */
export interface RingLinkSession {
  readonly identity: RingLinkIdentity;
  /** The platform's id for this ring (a MAC on Android and Linux, an opaque id in browsers); kept to reconnect later. */
  readonly platformId?: string;
  info(): Promise<RingLinkInfo>;
  battery(): Promise<number | undefined>;
  /** History since `cursor` (everything when empty); `status:cursor` events carry the next cursor per stream. */
  sync(cursor: SyncCursor, onProgress: (p: number) => void, signal: AbortSignal): AsyncIterable<RingEvent>;
  /** Live heart rate until `signal` aborts; undefined when the family has none. */
  liveHeartRate?(signal: AbortSignal): AsyncIterable<{ bpm: number; t: number }>;
  /** One spot measurement. Rejects with `RingLinkError('unsupported')` when the family cannot. */
  spot?(kind: SpotKind, signal: AbortSignal): Promise<{ value: number; unit: string; t: number }>;
  /** Fires once when the ring drops the link. */
  onDisconnected(cb: () => void): () => void;
  close(): Promise<void>;
}

export type RingLinkErrorCode = 'not_found' | 'cancelled' | 'refused' | 'unsupported_firmware' | 'bond_required' | 'disconnected' | 'bluetooth_off' | 'permission_needed' | 'unsupported' | 'no_reading' | 'off_finger' | 'failed';

/** What a connector throws; the service turns the code into plain words. */
export class RingLinkError extends Error {
  constructor(
    readonly code: RingLinkErrorCode,
    message?: string,
    override readonly cause?: unknown,
  ) {
    super(message ?? code);
    this.name = 'RingLinkError';
  }
  /** The Android GATT status of a failed connect (133, 257, ...), when the platform gave one: it picks the backoff. */
  gattStatus?: number;
}

export interface RingScanHit {
  candidateId: string;
  driverId: string;
  rssi?: number;
  platformId?: string;
}

/** How the service finds and connects rings on this platform. */
export interface RingConnector {
  available(): Promise<RingAvailability>;
  /** Rings nearby (on chooser platforms: the one the person picked, already connected underneath). */
  scan(signal: AbortSignal): AsyncIterable<RingScanHit>;
  /** Connects to a ring from `scan`; the handshake runs inside. */
  connect(hit: { candidateId: string; driverId: string }, signal: AbortSignal): Promise<RingLinkSession>;
  /** Connects without a gesture to a ring seen before; absent where the platform cannot (the web today). */
  reconnect?(platformId: string, driverId: string, signal: AbortSignal): Promise<RingLinkSession>;
  /** Takes over a link the screen opened inside the click (the web chooser path). */
  adopt?(link: BleLink, driverId: string, signal: AbortSignal): Promise<RingLinkSession>;
  /** The driver's label, streams (for a new source) and on-demand checks; undefined for an unknown driver. */
  driverInfo(driverId: string): { label: string; maker: string; model: string; streams: readonly BioStream[]; checks?: CheckMetric[] } | undefined;
}

// ---------------------------------------------------------------- the stores

export interface RingIngestContext {
  ringKey: string;
  signal: AbortSignal;
  progress: (p: number, stage: string) => void;
}

/** The biometrics store as the service sees it (synced documents). */
export interface RingStorePort {
  ready(): Promise<void>;
  /** Every source document (the service filters the rings). */
  sources(): SourceBody[];
  source(ringKey: string): SourceBody | undefined;
  /** Writes the batch through the one ingest path (records, chunks, scores). */
  ingest(batch: BioBatch, ctx: RingIngestContext): Promise<RingSyncReport>;
  /** Creates the ring's source document when missing (label from the driver, ring policies from the store). */
  ensureSource(ringKey: string, p: { driverId: string; label: string; streams: readonly BioStream[]; channel: string; maker: string; model: string; firmware?: string }): Promise<void>;
  /** Merge patch on the source document (`null` removes a field). */
  patchSource(ringKey: string, patch: Record<string, unknown>): Promise<void>;
  lease(ringKey: string): RingLeaseBody | undefined;
  /** Merge patch on the lease document (created when absent). */
  patchLease(ringKey: string, patch: Partial<RingLeaseBody>): Promise<void>;
  /** Fires after any change to a `bioSources` document (local or synced). */
  subscribe(cb: () => void): () => void;
}

/** Device-local ring state (never synced): cursor, pause, and the platform id to reconnect with. */
export interface RingLocalState {
  cursor: SyncCursor;
  /** The person pressed Disconnect here: no auto-connect until Connect is pressed here. */
  paused?: boolean;
  /** Lost the ring to another device: no auto-connect until this time. */
  pausedUntil?: Instant;
  platformId?: string;
}

export interface RingLocalPort {
  get(ringKey: string): Promise<RingLocalState | undefined>;
  set(ringKey: string, state: RingLocalState): Promise<void>;
  remove(ringKey: string): Promise<void>;
}

export interface RingSyncView {
  deviceId: string;
  deviceLabel: string;
  /** Sync is set up and on: the lease means something. Off → no lease at all. */
  syncOn: boolean;
}

export interface RingSyncPort {
  view(): RingSyncView;
}

// ---------------------------------------------------------------- clock, shell

export interface RingClockPort {
  now(): number;
  /** Returns the cancel function. */
  setTimeout(fn: () => void, ms: number): () => void;
  tz(): string;
}

/** What the platform shell offers; every member is optional and the service feature-detects. */
/** A system notice; the kinds are the shell's (`src/platform/shell.ts`), each kind replaces its own earlier notice. */
export interface RingNotice {
  kind: 'battery_low' | 'ring_disconnected';
  title: string;
  text: string;
}

export interface RingShellPort {
  keepAlive?(on: boolean, reason: string): void | Promise<void>;
  notify?(n: RingNotice): void | Promise<void>;
  onBluetoothState?(cb: (on: boolean) => void): () => void;
  onResume?(cb: () => void): () => void;
}

export interface RingServicePorts {
  connector: RingConnector;
  store: RingStorePort;
  local: RingLocalPort;
  sync: RingSyncPort;
  clock: RingClockPort;
  shell?: RingShellPort;
  platform: Platform;
  /** Producer stamped on every batch. */
  producer?: { name: string; version: string };
}
