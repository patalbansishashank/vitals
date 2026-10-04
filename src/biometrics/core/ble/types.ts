/**
 * Web Bluetooth driver registry contract (SUITE_SPEC §4.6). Tier P types; the impure transport lives in src/biometrics/ble/.
 * Minimal Web Bluetooth types are declared locally because the DOM lib does not ship them.
 */
import type { BioStream } from '../types';

export type BluetoothServiceUUID = number | string;
export interface BluetoothLEScanFilter {
  services?: BluetoothServiceUUID[];
  name?: string;
  namePrefix?: string;
  manufacturerData?: Array<{ companyIdentifier: number; dataPrefix?: Uint8Array; mask?: Uint8Array }>;
}

/** Protocol-level command, framed by `BleProtocol.frame`. `params` are driver-specific. */
export interface RingCommand {
  op: string;
  params?: Record<string, number | string | boolean>;
}

export type RingDecodedEvent =
  | { type: 'sample'; stream: BioStream; t: number; value: number; unit: string; origin: 'history' | 'spot' | 'live' | 'workout_stream' }
  | { type: 'sleepEpochs'; start: number; epochS: number; stages: string[]; rawCodes: number[]; firmware: string; complete: boolean }
  | { type: 'activityBucket'; start: number; durS: number; steps: number; distanceM?: number; kcal?: number }
  | { type: 'workout'; start: number; end: number; kind: string; distanceM?: number; kcal?: number; hrAvg?: number; hrMax?: number }
  | { type: 'vendor'; key: string; t: number; value: number; unit: string }
  /** Device housekeeping (battery, firmware, clock, page cursors); not mapped to records. */
  | { type: 'status'; key: 'battery' | 'firmware' | 'clock_offset_s' | 'cursor' | 'ack' | 'error'; value: number | string; stream?: BioStream };

/** Opaque, serialisable protocol state threaded through `ingest`. */
export type ProtocolState = Record<string, unknown>;

/**
 * Result of `ingest`. `send` and `done` are optional session hints (additive): follow-up commands the protocol wants
 * written now (e.g. a history continuation page) and whether the command in flight is finished.
 */
export interface IngestResult {
  events: RingDecodedEvent[];
  state: ProtocolState;
  send?: RingCommand[];
  done?: boolean;
  /**
   * The packet is not part of the reply to the command in flight (a battery push, a leftover live sample): the session
   * keeps the stall wait running instead of switching to the quiet timer. Absent = it counts.
   */
  unrelated?: boolean;
}

/** What the session should wait for after writing a command (returned by the optional `BleProtocol.begin`). */
export interface CommandPlan {
  state: ProtocolState;
  /** false = fire and forget. */
  expectReply: boolean;
  /** Finish after this long without a packet once at least one arrived (2301 pager: 1.2 s settle). */
  quietMs?: number;
  /** Give up after this long without any packet after a write (2301 pager: 4 s stall). */
  stallMs?: number;
}

export interface BleProtocol {
  frame(cmd: RingCommand): Uint8Array[];
  ingest(bytes: Uint8Array, state: ProtocolState, channel?: string, receivedMs?: number): IngestResult;
  /** One page per stream per open + resumable backfill (R10 §4.4). */
  planSync(cursor: Partial<Record<BioStream, string>>): RingCommand[];
  initialState(): ProtocolState;
  /**
   * Optional: called by the session right before `cmd` is written. The session stamps `params.nowMs` (epoch ms) and
   * `params.tzOffsetS` (phone UTC offset, s) on every command so pure protocols can resolve relative times.
   */
  begin?(cmd: RingCommand, state: ProtocolState): CommandPlan;
  /** Optional: the session's quiet or stall timer fired for the command in flight. */
  timeout?(state: ProtocolState, kind: 'quiet' | 'stall'): IngestResult;
}

/** The GATT link a session talks through; implemented by the Web Bluetooth transport and by a recorded-frame fake in tests. */
export interface BleLink {
  write(service: BluetoothServiceUUID, characteristic: BluetoothServiceUUID, bytes: Uint8Array, opts?: { withResponse?: boolean }): Promise<void>;
  subscribe(service: BluetoothServiceUUID, characteristic: BluetoothServiceUUID, cb: (bytes: Uint8Array) => void): Promise<() => void>;
  read?(service: BluetoothServiceUUID, characteristic: BluetoothServiceUUID): Promise<Uint8Array>;
  /** Negotiated ATT MTU when the platform reports it (Chrome does not expose it: unverified on Android). */
  mtu?: number;
  readonly deviceName?: string;
  disconnect(): Promise<void>;
}

export interface BleSession {
  info(): Promise<{ firmware: string; battery?: number; clockOffsetS: number }>;
  /** Convenience over `sync` for one stream (`readHistory(stream, since)`). */
  readHistory(stream: BioStream, since: string | undefined, signal: AbortSignal): AsyncIterable<RingDecodedEvent>;
  battery(): Promise<number | undefined>;
  sync(cursor: Partial<Record<BioStream, string>>, onProgress: (p: number) => void, signal: AbortSignal): AsyncIterable<RingDecodedEvent>;
  close(): Promise<void>;
}

export interface BleDriver {
  id: string;
  family: string;
  label: string;
  /** Streams this driver can read. */
  streams: BioStream[];
  requestOptions: { filters: BluetoothLEScanFilter[]; optionalServices: BluetoothServiceUUID[] };
  /** Optional (additive): the service and the write/notify characteristics the session talks through. */
  gatt?: { service: BluetoothServiceUUID; write: BluetoothServiceUUID; notify: BluetoothServiceUUID };
  protocol: BleProtocol;
  /** Any handshake a ring needs (2301 V0789's passcode) is built into the driver; `credential` overrides it in tests only. */
  open(link: BleLink, opts: { credential?: string; signal?: AbortSignal }): Promise<BleSession>;
}
