/**
 * `@vitals/rings` contract (plan 04 item 1, A5a). Tier P: types and tiny pure helpers only; no DOM, no Node, no timers.
 *
 * Three layers, each independent of the platform:
 *   1. `Transport`: the GATT link a platform adapter implements (Web Bluetooth, Capacitor BLE, Electron/BlueZ, the fake
 *      peripheral in `./testing`). A transport knows nothing about any ring.
 *   2. `RingFamily`: one per ring family (J-Style 2301, Colmi, CRP, Jring, LuckRing, RWfit, YCBT). It describes how the
 *      family is recognised in a scan, its GATT map and a pure `Protocol` (frame / ingest / plan: a state machine with no
 *      I/O), plus the handshake that runs once after connecting.
 *   3. `RingSession`: what a service drives. `openRingSession(family, transport)` in `./session` runs the protocol over the
 *      transport; the service then asks for `info()`, `sync()` and live streams and maps `RingEvent`s onto biometrics
 *      records with `./records` (content-derived ids, so the same night read by two devices is one record).
 *
 * Ring identity is the ring, never the device: `ringIdentity()` gives the same id on every platform (serial, else
 * Bluetooth address, else the advertised id), and that id is the source key of every record it produces.
 */
import type { BioStream, DeviceTier } from '../../../src/biometrics/core/types';

// ---------------------------------------------------------------- bytes and UUIDs

/** 128-bit lower-case UUID ('0000fff0-0000-1000-8000-00805f9b34fb'); 16-bit aliases are expanded with `uuid16`. */
export type Uuid = string;

const BASE_TAIL = '-0000-1000-8000-00805f9b34fb';

/** `uuid16(0xfff0)` → '0000fff0-0000-1000-8000-00805f9b34fb'. Every transport compares expanded, lower-case UUIDs. */
export function uuid16(alias: number): Uuid {
  if (!Number.isInteger(alias) || alias < 0 || alias > 0xffff) throw new RangeError('a 16-bit UUID alias must fit two bytes');
  return `0000${alias.toString(16).padStart(4, '0')}${BASE_TAIL}`;
}

/** Normalises any UUID spelling a platform may hand back (upper case, braces, 16-bit alias as hex or number). */
export function normalizeUuid(u: Uuid | number): Uuid {
  if (typeof u === 'number') return uuid16(u);
  const s = u.trim().toLowerCase().replace(/^\{|\}$/g, '');
  if (/^(0x)?[0-9a-f]{4}$/.test(s)) return uuid16(parseInt(s.replace(/^0x/, ''), 16));
  return s;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
export const fromHex = (s: string): Uint8Array => Uint8Array.from((s.replace(/[^0-9a-f]/gi, '').match(/../g) ?? []).map((x) => parseInt(x, 16)));

// ---------------------------------------------------------------- scan match (decision 10: no brand name, no brand-bearing filter)

/**
 * What a scan hands to `RingFamily.match`. `manufacturerData` blocks are in on-air layout: little-endian company id
 * first, then the vendor bytes (as CoreBluetooth and Web Bluetooth's `manufacturerData` with the id re-attached give it;
 * Android's ScanRecord strips the id, so the Capacitor adapter re-attaches it, as Lumen's `AdvertisementMatcher` does).
 */
export interface Advertisement {
  name?: string;
  /** Expanded lower-case UUIDs advertised in the scan response. */
  serviceUuids: Uuid[];
  manufacturerData: Uint8Array[];
  /** Platform id of the peripheral: Bluetooth address on Android/BlueZ, Web Bluetooth's opaque `device.id` in Chromium. */
  platformId?: string;
  rssi?: number;
}

/**
 * How a family recognises its rings. `requestFilters` is what Web Bluetooth's chooser can filter on (services, name
 * prefixes, manufacturer-data prefixes); `match` is the exact rule, run on every advertisement a platform can see.
 * Name patterns here are generic model names ('R02_', 'SMART_RING'); the J-Style family matches on its service and the
 * 0x1234 manufacturer marker ending `23 01`, never on the retail name.
 */
export interface ScanMatch {
  /** Web Bluetooth `requestDevice` filters (union); every UUID expanded. */
  requestFilters: Array<{
    services?: Uuid[];
    namePrefix?: string;
    name?: string;
    manufacturerData?: Array<{ companyIdentifier: number; dataPrefix?: Uint8Array; mask?: Uint8Array }>;
  }>;
  /** Services the session will open; Web Bluetooth needs them listed up front (`optionalServices`). */
  optionalServices: Uuid[];
  match(ad: Advertisement): boolean;
}

// ---------------------------------------------------------------- GATT map

export type SubscriptionMode = 'notify' | 'indicate';

export interface GattMap {
  service: Uuid;
  write: Uuid;
  /** Channels the session subscribes to before the handshake; the first is the family's main data channel. */
  notify: Array<{ characteristic: Uuid; mode: SubscriptionMode; service?: Uuid }>;
  /** Some families route certain frames to a second characteristic (`Protocol.frame` returns the channel). */
  command?: Uuid;
  /** The service of `command` when it is not `service` (Colmi's big-data service). */
  commandService?: Uuid;
  /** Standard battery service when the family exposes one (0x180f / 0x2a19). */
  battery?: { service: Uuid; characteristic: Uuid };
  /** Standard Device Information service characteristics the handshake may read (firmware 0x2a26, serial 0x2a25, …). */
  deviceInfo?: { service: Uuid; firmware?: Uuid; serial?: Uuid; model?: Uuid; manufacturer?: Uuid };
  /** Write mode the family wants when the transport can choose (default: with response if the characteristic allows). */
  writeMode?: 'withResponse' | 'withoutResponse';
}

// ---------------------------------------------------------------- transport (implemented per platform)

export type TransportEvent =
  | { type: 'notification'; service: Uuid; characteristic: Uuid; bytes: Uint8Array }
  | { type: 'disconnected'; reason?: string }
  /** Native side asked the person to bond (the OS dialog); informational, the adapter owns the bond call. */
  | { type: 'bonding'; state: 'requested' | 'bonded' | 'failed' }
  | { type: 'mtu'; mtu: number };

/**
 * One connected GATT link, already connected when handed to the session. Implemented by the platform adapters
 * (Web Bluetooth, Capacitor BLE, Electron's Chromium / node-ble) and by `testing/FakePeripheral`.
 * A transport serialises its own GATT operations (one at a time) and copies notification buffers.
 */
export interface Transport {
  /** Stable per-platform peripheral id (address or Chromium device id) and advertised name, when known. */
  readonly peripheral: { id?: string; name?: string; address?: string };
  /** Negotiated ATT MTU when the platform reports it; undefined on Chromium (unknown). */
  readonly mtu?: number;
  write(service: Uuid, characteristic: Uuid, bytes: Uint8Array, mode: 'withResponse' | 'withoutResponse'): Promise<void>;
  read(service: Uuid, characteristic: Uuid): Promise<Uint8Array>;
  /** Subscribes and returns the unsubscribe; notifications arrive on `on('notification')`. */
  subscribe(service: Uuid, characteristic: Uuid, mode: SubscriptionMode): Promise<() => Promise<void>>;
  /** Services the connected device actually exposes (RWfit picks its framing from sibling services). */
  services?(): Promise<Uuid[]>;
  /** Ask the platform for a larger MTU where it can (Android); resolves the MTU in effect. */
  requestMtu?(mtu: number): Promise<number>;
  on(listener: (ev: TransportEvent) => void): () => void;
  disconnect(): Promise<void>;
}

/**
 * How a platform finds and connects rings; the service uses it for scanning, auto-connect and reconnect.
 * Web Bluetooth has no free scan: `scan` resolves with the one device the chooser returned.
 */
export interface TransportFactory {
  readonly platform: 'web-bluetooth' | 'capacitor' | 'electron' | 'node-ble' | 'fake';
  available(): Promise<boolean>;
  /** Streams advertisements until `signal` aborts; `families` narrows platform filters where the platform has any. */
  scan(families: readonly RingFamily[], onFound: (ad: Advertisement) => void, signal: AbortSignal): Promise<void>;
  /** Connects to a peripheral seen in `scan` (or remembered by its `platformId`); resolves once GATT is up. */
  connect(target: { platformId: string }, family: RingFamily, signal?: AbortSignal): Promise<Transport>;
}

// ---------------------------------------------------------------- commands, events, protocol (pure)

/** A protocol-level command. `params` are family-specific; the session stamps `nowMs` and `tzOffsetS` on every one. */
export interface RingCommand {
  op: string;
  params?: Record<string, number | string | boolean>;
}

export type SampleOrigin = 'history' | 'spot' | 'live' | 'workout_stream';

export type SpotKind = 'hr' | 'spo2' | 'hrv' | 'temperature' | 'stress';

/** One frame to write, with the channel when it is not the default write characteristic. */
export interface OutboundFrame {
  bytes: Uint8Array;
  channel?: 'write' | 'command';
}

/**
 * Everything a decoder can say. Streams are the biometrics `BioStream`s; `vendor` carries values Vitals has no stream
 * for (stress, fatigue, blood pressure) and `status` carries housekeeping that never becomes a record.
 */
export type RingEvent =
  | { type: 'sample'; stream: BioStream; t: number; value: number; unit: string; origin: SampleOrigin }
  /** Minute stages from the ring; `rawCodes` keep the vendor codes so a corrected map can rescore (`complete` = the ring closed the night). */
  | { type: 'sleepEpochs'; start: number; epochS: number; stages: SleepStage[]; rawCodes: number[]; firmware: string; complete: boolean }
  | { type: 'activityBucket'; start: number; durS: number; steps: number; distanceM?: number; kcal?: number }
  | { type: 'dailyTotal'; localDay: number; steps?: number; distanceM?: number; kcal?: number; activeS?: number }
  | { type: 'workout'; start: number; end: number; kind: string; steps?: number; distanceM?: number; kcal?: number; hrAvg?: number; hrMax?: number }
  | { type: 'vendor'; key: string; t: number; value: number; unit: string; origin?: SampleOrigin }
  | { type: 'status'; key: StatusKey; value: number | string; stream?: BioStream }
  /** History progress for the UI: `stage` is the family's own stream name; `done` closes the whole sync. */
  | { type: 'progress'; stage: string; done: boolean };

export type SleepStage = 'unknown' | 'awake' | 'light' | 'deep' | 'rem';

export type StatusKey =
  | 'battery'
  | 'charging'
  | 'firmware'
  | 'serial'
  | 'model'
  | 'clock_offset_s'
  | 'cursor'
  | 'ack'
  | 'error'
  | 'auth'
  | 'bond_requested'
  | 'capabilities';

/** Opaque, serialisable protocol state threaded through `ingest`; a family defines its own shape. */
export type ProtocolState = Record<string, unknown>;

export interface IngestResult {
  events: RingEvent[];
  state: ProtocolState;
  /**
   * Follow-up commands the protocol wants written now (a continuation page, a chunk acknowledgement). A follow-up whose
   * `op` is `'ack'` keeps the quiet timer running (the ring is still streaming); any other follow-up starts a fresh wait.
   */
  send?: RingCommand[];
  /** The command in flight is finished. */
  done?: boolean;
  /**
   * The packet is not part of the reply to the command in flight (a battery push, a settings echo, a leftover live
   * sample): the session keeps the stall wait running instead of switching to the quiet timer. Absent = it counts.
   */
  unrelated?: boolean;
}

/** What the session waits for after writing a command (from `Protocol.begin`). */
export interface CommandPlan {
  state: ProtocolState;
  /** false = fire and forget. */
  expectReply: boolean;
  /** Finish after this long without a packet once at least one arrived (a pager's settle time). */
  quietMs?: number;
  /** Give up after this long without any packet after the write. */
  stallMs?: number;
  /** Ceiling on the whole command, however steadily the ring keeps sending; ends as a stall (session default 60 s). */
  maxMs?: number;
}

/**
 * Per-stream sync cursor: an opaque string the family defines (page cursor, last day, last timestamp). A plan command
 * names the stream it feeds in `params.stream`, or several in `params.streams` ('sleep_stage,steps') when one read feeds
 * more than one stream (Jring 0x10).
 */
export type SyncCursor = Partial<Record<BioStream, string>>;

/**
 * The pure protocol: a state machine with no I/O and no timers. `frame` encodes, `ingest` decodes one notification
 * against the state, `planSync` orders the history reads for one open given the cursors from the last sync.
 * Every function is deterministic for a given state, so a family is tested by replaying fixtures.
 */
export interface Protocol {
  initialState(): ProtocolState;
  frame(cmd: RingCommand, state: ProtocolState): OutboundFrame[];
  ingest(bytes: Uint8Array, state: ProtocolState, channel?: Uuid): IngestResult;
  planSync(cursor: SyncCursor, state: ProtocolState): RingCommand[];
  /** Called right before `cmd` is written; sets the reply expectation and the timers. */
  begin?(cmd: RingCommand, state: ProtocolState): CommandPlan;
  /** The session's quiet or stall timer fired for the command in flight. */
  timeout?(state: ProtocolState, kind: 'quiet' | 'stall'): IngestResult;
  /** A copy of an outbound frame safe for logs and captures (the J-Style auth frame loses its 16 passcode bytes). */
  redactOutbound(frame: Uint8Array): Uint8Array;
}

// ---------------------------------------------------------------- handshake (per family, runs once after connect)

export interface HandshakeInfo {
  firmware: string;
  battery?: number;
  serial?: string;
  model?: string;
  /** Ring clock minus phone clock (s) when the family reads its clock; 0 when it never does. */
  clockOffsetS: number;
  /** Set when history must not be read (an unknown firmware); `sync` then yields one `status:error` with this reason. */
  historyBlocked?: string;
}

/** What a handshake and the live-stream helpers get from the session: run one command, inspect state, read a characteristic. */
export interface SessionRuntime {
  readonly transport: Transport;
  readonly state: ProtocolState;
  /** Runs one command to completion and returns every event it produced. */
  run(cmd: RingCommand, signal?: AbortSignal): Promise<RingEvent[]>;
  exchange(cmd: RingCommand, signal?: AbortSignal): AsyncGenerator<RingEvent>;
  /** Reads a characteristic when the transport can; undefined on failure. */
  read(service: Uuid, characteristic: Uuid): Promise<Uint8Array | undefined>;
}

export interface HandshakeOptions {
  signal?: AbortSignal;
  /** Tests only: overrides the family's built-in credential. No screen offers it. */
  credential?: string;
  /** The person's profile when the family pushes one (Colmi, YCBT); omitted = never sent. */
  profile?: { metric: boolean; sex: 'female' | 'male' | 'other'; ageYears: number; heightCm: number; weightKg: number };
}

// ---------------------------------------------------------------- family driver

export type FamilyId = 'jstyle2301' | 'colmi' | 'crp' | 'jring' | 'luckring' | 'rwfit' | 'ycbt';

/** The Android reconnect rules (`ReconnectBackoff.kt`): delays per attempt; GATT status classes. */
export interface ReconnectPolicy {
  /** 5 s, 15 s, 30 s, 60 s, 120 s, 300 s; the last repeats. */
  delaysMs: readonly number[];
  /** A transient stack error (GATT 133, 22, 62) gets this many quick retries at the first delay. */
  fastTransientAttempts: number;
  /** GATT statuses that mean "wait for Bluetooth to come back" instead of retrying (257). */
  waitForBluetoothStatuses: readonly number[];
  transientStatuses: readonly number[];
}

export const ANDROID_RECONNECT: ReconnectPolicy = {
  delaysMs: [5_000, 15_000, 30_000, 60_000, 120_000, 300_000],
  fastTransientAttempts: 2,
  waitForBluetoothStatuses: [257],
  transientStatuses: [133, 22, 62],
};

/** Pure: delay before attempt `attempt` (0-based) after a failure with `gattStatus`, or null to wait for Bluetooth. */
export function reconnectDelayMs(policy: ReconnectPolicy, attempt: number, gattStatus = 0): number | null {
  if (policy.waitForBluetoothStatuses.includes(gattStatus)) return null;
  const i = Math.min(Math.max(0, attempt), policy.delaysMs.length - 1);
  const delay = policy.delaysMs[i] ?? policy.delaysMs[policy.delaysMs.length - 1] ?? 5_000;
  const transient = policy.transientStatuses.includes(gattStatus);
  return transient && attempt + 1 <= policy.fastTransientAttempts ? (policy.delaysMs[0] ?? delay) : delay;
}

/** Link priority a family wants (`ConnectionPriorityPolicy.kt`); only Android can act on it. */
export type LinkPriority = 'default' | 'high' | 'balanced' | 'low_power';

export interface PriorityPolicy {
  /** Priority while a sync, a measurement or a workout stream is running. */
  active: LinkPriority;
  /** Priority when idle for less than `idleLowPowerMs`. */
  idle: LinkPriority;
  /** After this long idle, drop to `idleLong`. */
  idleLowPowerMs: number;
  idleLong: LinkPriority;
}

export const DEFAULT_PRIORITY: PriorityPolicy = { active: 'high', idle: 'balanced', idleLowPowerMs: 300_000, idleLong: 'low_power' };

/**
 * One ring family. Everything a platform needs to find, connect and read a ring of this family, with the whole
 * handshake (passcode, bond, firmware profile) inside; decision 13: no family ever asks the person for anything.
 */
export interface RingFamily {
  id: FamilyId;
  /** Plain words for the scan list and the Devices page ('J-Style 2301 ring'). */
  label: string;
  /** Maker as records carry it in `provenance.device.manufacturer` ('J-Style', 'Colmi'); never a retail brand. */
  maker?: string;
  /** Model names this family covers, for the ledger and the UI (never a retail brand). */
  models: readonly string[];
  scan: ScanMatch;
  gatt: GattMap;
  protocol: Protocol;
  /** Streams this family can read. */
  streams: readonly BioStream[];
  tier: DeviceTier;
  reconnect: ReconnectPolicy;
  priority: PriorityPolicy;
  /** Runs once after subscribing: battery, firmware, authentication, clock, profile. Throws `RingError` on refusal. */
  handshake(rt: SessionRuntime, opts: HandshakeOptions): Promise<HandshakeInfo>;
  /** Commands for a live heart-rate stream (`start` / `stop`); undefined when the family has none. */
  liveHeartRate?: { start: RingCommand; stop: RingCommand };
  /** One-shot measurements the family offers ('hr', 'spo2', 'hrv', …) and the command(s) that start each, in order. */
  spot?: Partial<Record<SpotKind, RingCommand | RingCommand[]>>;
  /** The command(s) that end a spot measurement, per kind, when the family has one. */
  spotStop?: Partial<Record<SpotKind, RingCommand | RingCommand[]>>;
  /** Pause between the start commands of a spot measurement (J-Style: 500 ms between 0x09 and 0x28). */
  spotGapMs?: number;
  /** A command the session writes every `intervalMs` while connected, between frames of any command in flight (Jring 0x3A). */
  keepalive?: { command: RingCommand; intervalMs: number };
  /** Decoder tag for provenance ('jstyle2301/V0789@1'); the version bumps when a decoder's output changes. */
  decoderTag(firmware: string): string;
  /** When the family can tell what the ring is from the advertisement alone (model from the name). */
  modelFromAdvertisement?(ad: Advertisement): string | undefined;
}

// ---------------------------------------------------------------- session (what a service drives)

export type RingErrorCode =
  | 'disconnected'
  | 'aborted'
  | 'timeout'
  | 'auth_rejected'
  | 'credential_invalid'
  | 'unsupported_firmware'
  | 'bond_required'
  | 'closed'
  | 'busy'
  | 'unsupported'
  | 'transport';

export class RingError extends Error {
  constructor(
    message: string,
    readonly code: RingErrorCode,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RingError';
  }
}

export interface SyncProgress {
  /** 0..1 over the planned reads. */
  fraction: number;
  stage?: string;
}

/**
 * An open session: the handshake has run. A service calls `sync` with the cursors it stored from the last sync,
 * stores the `status:cursor` events it gets back, maps the rest onto records (`./records`) and writes them.
 */
export interface RingSession {
  readonly family: RingFamily;
  readonly identity: RingIdentity;
  info(): HandshakeInfo;
  battery(): Promise<number | undefined>;
  sync(cursor: SyncCursor, onProgress: (p: SyncProgress) => void, signal: AbortSignal): AsyncIterable<RingEvent>;
  /** One stream only (`readHistory('sleep_stage', cursor)`). */
  readHistory(stream: BioStream, cursor: SyncCursor, signal: AbortSignal): AsyncIterable<RingEvent>;
  /** Live heart rate until `signal` aborts; the stop command is written on the way out. */
  liveHeartRate(signal: AbortSignal): AsyncIterable<RingEvent>;
  /** One spot measurement; ends when the ring says so or after the family's ceiling. */
  spot(kind: SpotKind, signal: AbortSignal): AsyncIterable<RingEvent>;
  /** Any unsolicited event (live samples the ring pushes, battery changes, disconnect). */
  on(listener: (ev: RingEvent | { type: 'disconnected'; reason?: string }) => void): () => void;
  /** Events the ring produced during the handshake (`status:bond_requested`, `status:capabilities`, …), for the service. */
  readonly handshakeEvents: readonly RingEvent[];
  close(): Promise<void>;
}

// ---------------------------------------------------------------- ring identity (the source key)

/**
 * The ring, not the device. `serial` from the Device Information service or the family's own info reply beats the
 * Bluetooth address (stable on Android/BlueZ, hidden in Chromium) which beats the advertised id (Chromium's `device.id`,
 * stable per origin only). Every platform that reads the same ring must produce the same `ringId`.
 */
export interface RingIdentity {
  family: FamilyId;
  model?: string;
  /** 'serial:<…>' | 'mac:<aa:bb:…>' | 'adv:<…>' in that preference order. */
  ringId: string;
  /** How `ringId` was derived; lets a later, better id replace a weaker one for the same ring. */
  basis: 'serial' | 'mac' | 'advertised';
}

export function ringIdentity(p: { family: FamilyId; model?: string; serial?: string; address?: string; advertisedId?: string }): RingIdentity {
  const serial = p.serial?.trim().replace(/\0+$/, '');
  if (serial) return { family: p.family, model: p.model, ringId: `serial:${serial.toUpperCase()}`, basis: 'serial' };
  const mac = p.address?.trim().toLowerCase().replace(/-/g, ':');
  if (mac && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return { family: p.family, model: p.model, ringId: `mac:${mac}`, basis: 'mac' };
  const adv = p.advertisedId?.trim();
  if (adv) return { family: p.family, model: p.model, ringId: `adv:${adv}`, basis: 'advertised' };
  throw new RingError('no identity for this ring (no serial, address or advertised id)', 'transport');
}

/**
 * The source key records carry (`BioChannel` `ble:<…>`): driver, model and the ring's own id, identical on every
 * platform. `ble:jstyle2301/2301/serial:ABC123`.
 */
export function ringSourceKey(id: RingIdentity): `ble:${string}` {
  return `ble:${id.family}/${id.model ?? '-'}/${id.ringId}`;
}
