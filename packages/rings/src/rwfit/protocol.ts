import { plausibleAggregate } from '../plausibility';
/**
 * RWfit `Protocol` for `@vitals/rings`. Tier P: no timers, no I/O. Port of Lumen's `RWfitDriver.kt` (ingest, ACKs, framing
 * switch), `RWfitEncoder.kt` (one op per encoder method) and `RWfitSyncEngine.kt` (legacy cascade, JL burst).
 *
 * Framing: legacy until the handshake runs `selectFraming` with the choice from the discovered services (`chooseFraming`).
 * ACKs: every inbound legacy frame (bad XOR: status 2) and every non-ACK JL frame is answered through `IngestResult.send`
 * with an `appAck` command, ahead of acting on it (the vendor ACKs before it parses).
 * Legacy serials: `begin` takes the next serial for every legacy frame it is about to write; ACKs carry theirs in
 * `params.serial` (taken in `ingest`). The counter restarts at 1 per session (Kotlin keeps it across reconnects; the serial
 * is only an echo token, so nothing depends on it).
 *
 * Sync (`planSync`):
 *   - legacy: the manifest `0xA0`, then one `history` command per legacy stream in cascade order with `ifClaimed`: a
 *     stream the manifest did not claim writes nothing and waits for nothing, as `requestNextStream` skips it.
 *   - JL: one `historyBurst` command writing the nine `05 <type> 10` requests back to back, done when all nine replied.
 * Cursors: the ring always sends everything it holds (no cursor on the wire). `rw1:<newest epoch s>` per stream only
 * records progress for the service; it is emitted when a stream's reply has arrived whole and never on a partial read.
 *
 * Timers (Kotlin has none; engineering values, UNVERIFIED on hardware): replies 4 s; a history reply 10 s before the
 * first packet; mid-read silences are tolerated up to `SILENCE_MAX_MS` in all, then the read ends as `partial:<stream>`.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import type { CommandPlan, IngestResult, OutboundFrame, Protocol, ProtocolState, RingCommand, RingEvent, SyncCursor } from '../types';
import { fromHex } from '../types';
import { zoneOffsetAtS } from '../zone';
import {
  HISTORY, JL, JL_TYPE, LEGACY, decodeJl, decodeLegacy, historyDef, jlAck, jlFrame, jlHistoryTriple, jlTimePayload, legacyAck, legacyFrame,
  legacyTimePayload, nextSerial, wallClock, type Framing, type HistoryDef, type HistoryType, type JlPending, type LegacyParts, type Triple,
} from './codec';
import { decodeJlPayload, decodeLegacyPayload, pendingStreams } from './decoder';

export const REPLY_MS = 4_000;
/** Wait for the first packet of a history reply (the doc's guess; UNVERIFIED). */
export const HISTORY_STALL_MS = 10_000;
/** Settle time between packets of a multi-packet reply. */
export const QUIET_MS = 1_500;
/** Longest silence tolerated inside a history read that still expects packets; then the read is partial. */
export const SILENCE_MAX_MS = 20_000;

/** RWfit history type → Vitals stream (vendor-only types have none: blood pressure, breathing, stress, blood sugar). */
export const BIO_STREAM: Partial<Record<HistoryType, BioStream>> = {
  steps: 'steps', sleep: 'sleep_stage', heart_rate: 'hr', spo2: 'spo2', temperature: 'skin_temp', hrv: 'hrv',
};

export const LEGACY_HISTORY: readonly HistoryDef[] = HISTORY.filter((h) => h.legacy !== null);
export const JL_HISTORY: readonly HistoryDef[] = HISTORY.filter((h) => h.jl !== null);

const streamsOf = (defs: readonly HistoryDef[]): string => defs.map((h) => BIO_STREAM[h.type]).filter((s): s is BioStream => s !== undefined).join(',');

type Inflight =
  | { kind: 'reply'; op: 'battery' | 'syncManifest'; silenceMs: number }
  | { kind: 'history'; types: HistoryType[]; waiting: HistoryType[]; packets: number; silenceMs: number; newest: Partial<Record<HistoryType, number>> };

export interface RWfitState extends ProtocolState {
  framing: Framing;
  /** Last legacy serial written (0 = none yet). */
  serial: number;
  parts: LegacyParts;
  jlPending: JlPending | null;
  tzOffsetS: number;
  tz: string | null;
  nowMs: number;
  battery: number | null;
  charging: boolean | null;
  deviceInfo: boolean;
  /** Kotlin requests the JL catalog once per connection, even when its background pass runs again. */
  jlHistoryRequested: boolean;
  /** Legacy streams the manifest claimed (cascade order); null until a manifest arrived. */
  claimed: HistoryType[] | null;
  inflight: Inflight | null;
  cursors: Partial<Record<BioStream, string>>;
}

// ---------------------------------------------------------------- cursor codec

/** `rw1:<newest record epoch s>`; garbage decodes to null. */
export function decodeCursor(s: string | undefined): number | null {
  const m = /^rw1:(\d+)$/.exec(s ?? '');
  return m ? Number(m[1]) : null;
}
export const encodeCursor = (newestS: number): string => `rw1:${newestS}`;

function eventTime(e: RingEvent): number | null {
  switch (e.type) {
    case 'sample':
    case 'vendor':
      return e.t;
    case 'activityBucket':
      return e.start + e.durS * 1000;
    case 'sleepEpochs':
      return e.start + e.stages.length * e.epochS * 1000;
    case 'dailyTotal':
      return e.localDay;
    default:
      return null;
  }
}

/** Kotlin's plausible-value bridge and the ring-clock future bound for public events. */
function boundedEvents(events: RingEvent[], nowMs: number): RingEvent[] {
  return events.filter((e) => {
      if (!plausibleAggregate(e)) return false;
    const t = eventTime(e);
    if (nowMs > 0 && t !== null && (t > nowMs || t < nowMs - 8 * 86_400_000)) return false;
    if (e.type === 'activityBucket') return e.steps >= 0 && e.steps <= 5_000 && (e.distanceM ?? 0) >= 0 && (e.distanceM ?? 0) <= 6_000;
    if (e.type === 'sample') {
      if (e.stream === 'hr') return e.value >= 30 && e.value <= 220;
      if (e.stream === 'spo2') return e.value >= 70 && e.value <= 100;
      if (e.stream === 'skin_temp') return e.value >= 30 && e.value <= 45;
      if (e.stream === 'hrv') return e.value >= 1 && e.value <= 300;
    }
    if (e.type === 'vendor') {
      if (e.key === 'blood_pressure_systolic_estimate') return e.value >= 60 && e.value <= 250;
      if (e.key === 'blood_pressure_diastolic_estimate') return e.value >= 30 && e.value <= 150;
      if (e.key === 'stress') return e.value >= 1 && e.value <= 100;
      if (e.key === 'blood_glucose_estimate') return e.value >= 20 && e.value <= 600;
    }
    return true;
  });
}

/** Kotlin's legacy decoder uses raw zone offset plus one hour if the zone observes DST at all. */
function legacyCorrectionS(st: RWfitState): number {
  if (!st.tz || st.nowMs <= 0) return st.tzOffsetS;
  const year = new Date(st.nowMs).getUTCFullYear();
  const zone = { tz: st.tz, tzOffsetS: st.tzOffsetS };
  const jan = zoneOffsetAtS(zone, Date.UTC(year, 0, 15));
  const jul = zoneOffsetAtS(zone, Date.UTC(year, 6, 15));
  return jan !== jul ? Math.min(jan, jul) + 3_600 : jan;
}

// ---------------------------------------------------------------- framing

const num = (cmd: RingCommand, k: string, d = 0): number => {
  const v = cmd.params?.[k];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v)) return parseInt(v, 16);
  return d;
};
const str = (cmd: RingCommand, k: string): string => (typeof cmd.params?.[k] === 'string' ? (cmd.params[k] as string) : '');
const bool = (cmd: RingCommand, k: string, d: boolean): boolean => (typeof cmd.params?.[k] === 'boolean' ? (cmd.params[k] as boolean) : d);
const triple = (hex: string): Triple => {
  const b = fromHex(hex);
  return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0];
};

/** Realtime-measure kinds (`RWfitSyncEngine.start*`): the JL data type byte. */
const REALTIME_TYPE: Record<string, number> = { heart_rate: JL_TYPE.HEART_RATE, spo2: JL_TYPE.SPO2, blood_pressure: JL_TYPE.BLOOD_PRESSURE, hrv: JL_TYPE.HRV };

/** The legacy command id an op writes, or null when it writes nothing on this state (`RWfitEncoder`). */
function legacyCommandFor(cmd: RingCommand, st: RWfitState): number | null {
  switch (cmd.op) {
    case 'deviceInfo':
      return LEGACY.DEVICE_INFO;
    case 'battery':
      return LEGACY.BATTERY;
    case 'timeSync':
      return LEGACY.SET_TIME;
    case 'syncManifest':
      return LEGACY.SYNC_MANIFEST;
    case 'unbind':
      return LEGACY.UNBIND;
    case 'raw':
      return num(cmd, 'cmd');
    case 'history': {
      const def = historyDef(str(cmd, 'type') || str(cmd, 'stream'));
      if (!def || def.legacy === null) return null;
      // `requestNextStream`: an unclaimed stream is skipped, so the cascade write never happens.
      if (bool(cmd, 'ifClaimed', false) && !(st.claimed ?? []).includes(def.type)) return null;
      return def.legacy;
    }
    default:
      return null;
  }
}

function frameLegacy(cmd: RingCommand, st: RWfitState): Uint8Array[] {
  const serial = num(cmd, 'serial', st.serial);
  if (cmd.op === 'appAck') return [legacyAck(num(cmd, 'cmd'), num(cmd, 'inboundSerial'), num(cmd, 'status'), serial)];
  if (cmd.op === 'realtimeMeasure') throw new RangeError('rwfit: legacy rings have no on-demand measurement command');
  const id = legacyCommandFor(cmd, st);
  if (id === null) {
    if (cmd.op === 'history') return [];
    throw new RangeError(`rwfit: unknown legacy command ${cmd.op}`);
  }
  const payload =
    cmd.op === 'timeSync'
      ? legacyTimePayload(wallClock(num(cmd, 'nowMs', st.nowMs), num(cmd, 'tzOffsetS', st.tzOffsetS)))
      : cmd.op === 'raw'
        ? fromHex(str(cmd, 'payload'))
        : new Uint8Array(0);
  return [legacyFrame(id, payload, serial)];
}

function frameJlCmd(cmd: RingCommand, st: RWfitState): Uint8Array[] {
  switch (cmd.op) {
    case 'deviceInfo':
      return [jlFrame(JL.DEVICE_INFO)];
    case 'battery':
      return [jlFrame(JL.BATTERY)];
    case 'timeSync':
      return [jlFrame(JL.SET_TIME, jlTimePayload(wallClock(num(cmd, 'nowMs', st.nowMs), num(cmd, 'tzOffsetS', st.tzOffsetS))))];
    case 'history': {
      const def = historyDef(str(cmd, 'type') || str(cmd, 'stream'));
      return def?.jl != null ? [jlFrame(jlHistoryTriple(def.jl))] : [];
    }
    case 'historyBurst':
      // `requestJieliHistory`: every ported type as a bare triple, Kotlin enum order (breathing has no JL type).
      return JL_HISTORY.map((h) => jlFrame(jlHistoryTriple(h.jl!)));
    case 'realtimeMeasure': {
      const type = REALTIME_TYPE[str(cmd, 'kind')];
      if (type === undefined) throw new RangeError(`rwfit: no realtime measure for ${str(cmd, 'kind')}`);
      return [jlFrame(JL.REALTIME_MEASURE, Uint8Array.of(type, 0x05, bool(cmd, 'enable', true) ? 1 : 0))];
    }
    case 'appAck':
      return [jlAck(triple(str(cmd, 'triple')))];
    case 'raw':
      return [jlFrame(triple(str(cmd, 'triple')), fromHex(str(cmd, 'payload')))];
    case 'unbind':
      return []; // no confirmed JL unbind triple (`RWfitEncoder.unbind`): Forget only drops the link
    case 'syncManifest':
      return []; // JL has no manifest
  }
  throw new RangeError(`rwfit: unknown JL command ${cmd.op}`);
}

export function frameRWfit(cmd: RingCommand, state: ProtocolState): OutboundFrame[] {
  const st = state as RWfitState;
  if (cmd.op === 'selectFraming') return [];
  const frames = st.framing === 'jl' ? frameJlCmd(cmd, st) : frameLegacy(cmd, st);
  return frames.map((bytes) => ({ bytes }));
}

// ---------------------------------------------------------------- planner

/** History reads for one open (`RWfitSyncEngine.runStartup` after the handshake frames). */
export function planRWfitSync(cursor: SyncCursor, state: ProtocolState): RingCommand[] {
  const st = state as RWfitState;
  const prev = (defs: readonly HistoryDef[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const h of defs) {
      const s = BIO_STREAM[h.type];
      if (s && cursor[s]) out[`prev:${s}`] = cursor[s];
    }
    return out;
  };
  if (st.framing === 'jl') return st.jlHistoryRequested ? [] : [{ op: 'historyBurst', params: { streams: streamsOf(JL_HISTORY), ...prev(JL_HISTORY) } }];
  return [
    { op: 'syncManifest', params: { streams: streamsOf(LEGACY_HISTORY) } },
    ...LEGACY_HISTORY.map((h): RingCommand => {
      const s = BIO_STREAM[h.type];
      return { op: 'history', params: { type: h.type, ifClaimed: true, ...(s ? { stream: s } : {}), ...prev([h]) } };
    }),
  ];
}

// ---------------------------------------------------------------- history bookkeeping

/** Closes a stream's read: cursor merged with the previous one and emitted when there is anything to say. */
function streamDone(st: RWfitState, type: HistoryType, newestMs: number | undefined): { state: RWfitState; events: RingEvent[] } {
  const s = BIO_STREAM[type];
  if (!s) return { state: st, events: [] };
  const p = decodeCursor(st.cursors[s]);
  const n = newestMs === undefined ? null : Math.floor(newestMs / 1000);
  if (p === null && n === null) return { state: st, events: [] };
  const value = encodeCursor(Math.max(p ?? 0, n ?? 0));
  return { state: { ...st, cursors: { ...st.cursors, [s]: value } }, events: [{ type: 'status', key: 'cursor', value, stream: s }] };
}

/** Ends a history read on a timer: the stream cut mid-reassembly is `partial`, streams never answered `no_reply`. */
function endHistory(st: RWfitState, h: Extract<Inflight, { kind: 'history' }>, cutType: HistoryType | undefined): IngestResult {
  const events: RingEvent[] = h.waiting.map((t) => {
    const stream = BIO_STREAM[t];
    return { type: 'status', key: 'error', value: `${t === cutType ? 'partial' : 'no_reply'}:${stream ?? t}`, ...(stream ? { stream } : {}) };
  });
  return { events, state: { ...st, inflight: null, parts: {}, jlPending: null }, done: true };
}

// ---------------------------------------------------------------- protocol

export function initialRWfitState(): RWfitState {
  return {
    framing: 'legacy', serial: 0, parts: {}, jlPending: null, tzOffsetS: 0, tz: null, nowMs: 0, battery: null, charging: null, deviceInfo: false, jlHistoryRequested: false,
    claimed: null, inflight: null, cursors: {},
  };
}

function begin(cmd: RingCommand, state: ProtocolState): CommandPlan {
  let st = state as RWfitState;
  st = { ...st, nowMs: num(cmd, 'nowMs', st.nowMs), tzOffsetS: num(cmd, 'tzOffsetS', st.tzOffsetS), tz: str(cmd, 'tz') || st.tz };
  if (cmd.op === 'selectFraming') {
    // `RWfitDriver.servicesDiscovered`; the codecs start clean on the new framing.
    const framing: Framing = str(cmd, 'framing') === 'jl' ? 'jl' : 'legacy';
    return { state: { ...st, framing, parts: {}, jlPending: null, claimed: null, inflight: null, jlHistoryRequested: false }, expectReply: false };
  }
  // Legacy: the frame about to be written takes the next serial (ACKs carry their own).
  if (st.framing === 'legacy' && cmd.op !== 'appAck' && cmd.params?.serial === undefined && legacyCommandFor(cmd, st) !== null) {
    st = { ...st, serial: nextSerial(st.serial) };
  }
  // Seed cursors the service handed to planSync (`prev:<stream>`).
  for (const [k, v] of Object.entries(cmd.params ?? {})) {
    if (k.startsWith('prev:') && typeof v === 'string' && v) {
      const s = k.slice(5) as BioStream;
      if (st.cursors[s] === undefined) st = { ...st, cursors: { ...st.cursors, [s]: v } };
    }
  }
  switch (cmd.op) {
    case 'battery':
    case 'syncManifest':
      if (cmd.op === 'syncManifest' && st.framing === 'jl') return { state: st, expectReply: false };
      return { state: { ...st, claimed: cmd.op === 'syncManifest' ? null : st.claimed, inflight: { kind: 'reply', op: cmd.op, silenceMs: 0 } }, expectReply: true, stallMs: REPLY_MS };
    case 'history': {
      const def = historyDef(str(cmd, 'type') || str(cmd, 'stream'));
      const writes = st.framing === 'jl' ? def?.jl != null : legacyCommandFor(cmd, st) !== null;
      if (!def || !writes) return { state: st, expectReply: false };
      const inflight: Inflight = { kind: 'history', types: [def.type], waiting: [def.type], packets: 0, silenceMs: 0, newest: {} };
      return { state: { ...st, inflight }, expectReply: true, quietMs: QUIET_MS, stallMs: HISTORY_STALL_MS };
    }
    case 'historyBurst': {
      if (st.framing !== 'jl') return { state: st, expectReply: false };
      const types = JL_HISTORY.map((h) => h.type);
      const inflight: Inflight = { kind: 'history', types, waiting: types, packets: 0, silenceMs: 0, newest: {} };
      return { state: { ...st, inflight, jlHistoryRequested: true }, expectReply: true, quietMs: QUIET_MS, stallMs: HISTORY_STALL_MS };
    }
    default:
      // deviceInfo, timeSync, realtimeMeasure, unbind, raw, appAck: the Kotlin writes them without waiting.
      return { state: st, expectReply: false };
  }
}

/** Applies one decoded frame to the command in flight. */
function settle(
  st: RWfitState,
  d: { events: RingEvent[]; history?: HistoryDef; battery?: unknown },
  isManifest: boolean,
): { state: RWfitState; events: RingEvent[]; done: boolean } {
  const h = st.inflight;
  let events = d.events;
  if (!h) return { state: st, events, done: false };
  if (h.kind === 'reply') {
    const hit = (h.op === 'battery' && d.battery !== undefined) || (h.op === 'syncManifest' && isManifest);
    return hit ? { state: { ...st, inflight: null }, events, done: true } : { state: st, events, done: false };
  }
  const newest = { ...h.newest };
  if (d.history) {
    for (const e of d.events) {
      const t = eventTime(e);
      if (t !== null) newest[d.history.type] = Math.max(newest[d.history.type] ?? t, t);
    }
  }
  if (!d.history || !h.waiting.includes(d.history.type)) return { state: { ...st, inflight: { ...h, newest } }, events, done: false };
  const waiting = h.waiting.filter((t) => t !== d.history!.type);
  const closed = streamDone({ ...st, inflight: { ...h, waiting, newest } }, d.history.type, newest[d.history.type]);
  events = [...events, ...closed.events];
  if (waiting.length === 0) return { state: { ...closed.state, inflight: null }, events, done: true };
  return { state: closed.state, events, done: false };
}

function ingest(bytes: Uint8Array, state: ProtocolState, _channel?: string, receivedMs?: number): IngestResult {
  let st = state as RWfitState;
  const eventClockMs = receivedMs ?? st.nowMs;
  const ctx = { tzOffsetS: st.framing === 'legacy' ? legacyCorrectionS(st) : st.tzOffsetS, firmware: st.framing };
  if (st.inflight) st = { ...st, inflight: st.inflight.kind === 'history' ? { ...st.inflight, packets: st.inflight.packets + 1, silenceMs: 0 } : { ...st.inflight, silenceMs: 0 } };
  const events: RingEvent[] = [];
  const send: RingCommand[] = [];
  let done = false;

  if (st.framing === 'legacy') {
    const r = decodeLegacy(bytes, st.parts);
    st = { ...st, parts: r.parts };
    for (const item of r.items) {
      if (item.kind === 'ackNeeded' || item.kind === 'checksumFailed') {
        // `ingestLegacy`: ACK every frame before parsing; a bad XOR gets status 2 so the ring sends it again.
        const serial = nextSerial(st.serial);
        st = { ...st, serial };
        send.push({ op: 'appAck', params: { cmd: item.cmd, inboundSerial: item.serial, status: item.kind === 'checksumFailed' ? 2 : 0, serial } });
      } else if (item.kind === 'deviceAck') {
        // `onDeviceAck`: a refusal is only logged by the Kotlin; reported here.
        if (item.status !== 0) events.push({ type: 'status', key: 'error', value: `refused:0x${item.cmd.toString(16).padStart(2, '0')}:${item.status}` });
      } else {
        const decoded = decodeLegacyPayload(item.cmd, item.payload, ctx);
        const d = { ...decoded, events: boundedEvents(decoded.events, eventClockMs) };
        if (d.deviceInfo) st = { ...st, deviceInfo: true };
        if (d.battery) st = { ...st, battery: d.battery.percent, charging: d.battery.charging };
        const isManifest = item.cmd === LEGACY.SYNC_MANIFEST;
        if (isManifest && d.manifest) st = { ...st, claimed: pendingStreams(d.manifest) };
        if (isManifest && !d.manifest) events.push({ type: 'status', key: 'error', value: 'manifest_short' });
        const s = settle(st, d, isManifest);
        st = s.state;
        events.push(...s.events);
        done = done || s.done;
      }
    }
  } else {
    const r = decodeJl(bytes, st.jlPending);
    st = { ...st, jlPending: r.pending };
    for (const item of r.items) {
      if (item.kind === 'checksumFailed') continue; // bad CRC: dropped silently, no ACK (Kotlin)
      // `ingestJieLi`: every non-ACK frame is ACKed before it is decoded.
      if (!item.isAck) send.push({ op: 'appAck', params: { triple: Array.from(item.triple, (b) => b.toString(16).padStart(2, '0')).join(' ') } });
      const decoded = decodeJlPayload(item.triple, item.payload, ctx);
      const d = { ...decoded, events: boundedEvents(decoded.events, eventClockMs) };
      if (d.deviceInfo) st = { ...st, deviceInfo: true };
      if (d.battery !== undefined) st = { ...st, battery: d.battery };
      const s = settle(st, d, false);
      st = s.state;
      events.push(...s.events);
      done = done || s.done;
    }
  }
  return { events, state: st, ...(send.length ? { send } : {}), ...(done ? { done } : {}) };
}

/** The type whose multi-packet body is half-built, if any (legacy buckets are keyed by command id). */
function cutType(st: RWfitState, waiting: readonly HistoryType[]): HistoryType | undefined {
  const defs = HISTORY.filter((h) => waiting.includes(h.type));
  if (st.framing === 'jl') return st.jlPending && st.jlPending.triple[0] === 0x05 ? defs.find((h) => h.jl === st.jlPending!.triple[1])?.type : undefined;
  return defs.find((h) => h.legacy !== null && (st.parts[String(h.legacy)]?.length ?? 0) > 0)?.type;
}

function timeout(state: ProtocolState, kind: 'quiet' | 'stall'): IngestResult {
  const st = state as RWfitState;
  const h = st.inflight;
  if (!h) return { events: [], state: st, done: true };
  const step = kind === 'quiet' ? QUIET_MS : h.kind === 'reply' ? REPLY_MS : HISTORY_STALL_MS;
  if (h.kind === 'reply') {
    // Unrelated packets (device ACKs, pushes) may have reset the timer; the reply budget still holds.
    if (kind === 'quiet' && h.silenceMs + step < REPLY_MS) return { events: [], state: { ...st, inflight: { ...h, silenceMs: h.silenceMs + step } }, done: false };
    return { events: [{ type: 'status', key: 'error', value: `timeout:${h.op}` }], state: { ...st, inflight: null }, done: true };
  }
  // Nothing at all since the write: the ring did not answer.
  if (h.packets === 0) return endHistory(st, h, undefined);
  // Packets came and more are expected (a half-built body or replies still missing): keep waiting up to SILENCE_MAX_MS in
  // all. A timer must never end a multi-packet read silently (the J-Style mid-page pause, 2026-10-04).
  const silenceMs = h.silenceMs + step;
  if (silenceMs < SILENCE_MAX_MS) return { events: [], state: { ...st, inflight: { ...h, silenceMs } }, done: false };
  return endHistory(st, h, cutType(st, h.waiting));
}

export function createRWfitProtocol(): Protocol {
  return {
    initialState: initialRWfitState,
    frame: frameRWfit,
    ingest,
    planSync: planRWfitSync,
    begin,
    timeout,
    redactOutbound: (frame) => frame, // no credential frame in this family
  };
}

export const rwfitProtocol: Protocol = createRWfitProtocol();
