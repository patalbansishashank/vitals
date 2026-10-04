import { plausibleAggregate } from '../plausibility';
/**
 * The LuckRing `Protocol`: a pure state machine over 20-byte packets. Tier P: no timers here; the session runs the
 * settle / stall timers and calls `timeout`. Ported from Lumen's `LuckRingDriver.kt` (ACK before decode),
 * `LuckRingSyncEngine.kt` (connect order, warm pass, per-connection encoder seq) and `LuckRingHistorySync.kt` (the
 * time-settled pager); research in `docs/luckring.md` §5 to §7.
 *
 * Sequence numbers: the encoder keeps one rolling seq per connection and the history pager its own, both from 0
 * (`LuckRingEncoder.nextSeq`, `LuckRingHistorySync.seq`). `frame` cannot return state, so `begin` reserves the seq and
 * `frame` reads it back for the same stamped command. Commands the session writes without `begin` (the live and spot
 * toggles of `session.stream`) use the next free seq without taking it. UNVERIFIED whether the ring checks seq at all.
 *
 * History has no cursor and no end marker: each catalog type is one `REQUEST`, then the ring replays everything it
 * stored as data frames. A type ends 1500 ms after its last complete frame or after 6000 ms of silence. A quiet timer
 * never ends a read while a multi-packet frame is still open: the read keeps waiting up to SILENCE_MAX_MS of silence in
 * all, then ends as `status:error partial:<stream>` without a cursor (the J-Style ring paused mid-page on real hardware).
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import type { CommandPlan, IngestResult, OutboundFrame, Protocol, ProtocolState, RingCommand, RingEvent, SyncCursor } from '../types';
import {
  CMD, DEFAULT_GOAL_STEPS, DEFAULT_PROFILE, DEVICE_TYPE, DT, ackPacket, autoMonitoringBytes, goalBytes, packets, startupBundleBytes, timeBytes,
  userInfoBytes, type CmdName, type LogicalFrame, type LuckRingProfile,
} from './commands';
import { assemble, decodeFrame, type PartialFrame } from './decoder';
import { zoneDayIndex } from '../zone';

/** `LuckRingHistorySync` timers: settle after the last frame of the type, stall when nothing arrived. */
export const SETTLE_MS = 1_500;
export const STALL_MS = 6_000;
/** Longest silence tolerated while a multi-packet frame is open (engineering value, as J-Style's 8 s). */
export const SILENCE_MAX_MS = 8_000;
/** Reply wait for device info / battery / settings sync (engineering value; the Kotlin never waits). */
export const REPLY_MS = 4_000;

/** The history catalog in request order (`LuckRingHistorySync.catalog`; 10 workout records skipped, 207 never sent). */
export const HISTORY_CATALOG: ReadonlyArray<{ dataType: number; stream: BioStream; stage: string }> = [
  { dataType: DT.HISTORY_SPORT, stream: 'steps', stage: 'activity' },
  { dataType: DT.SLEEP, stream: 'sleep_stage', stage: 'sleep' },
  { dataType: DT.HISTORY_HEART, stream: 'hr', stage: 'hr' },
  { dataType: DT.HISTORY_O2, stream: 'spo2', stage: 'spo2' },
  { dataType: DT.HISTORY_BP, stream: 'vendor:bp', stage: 'bp' },
  { dataType: DT.HISTORY_HRV, stream: 'hrv', stage: 'hrv' },
  { dataType: DT.HISTORY_TEMP, stream: 'skin_temp', stage: 'temperature' },
  { dataType: DT.STRESS_HISTORY, stream: 'vendor:stress', stage: 'stress' },
];

type Inflight =
  /** A request whose reply types we wait for (`got` fills as frames of those types arrive). */
  | { kind: 'reply'; want: number[]; got: number[] }
  /** One history type: complete frames seen, silence counted while a frame is open. */
  | { kind: 'history'; dataType: number; stream: BioStream; frames: number; quietMs: number };

export interface LuckRingState extends ProtocolState {
  /** Next encoder seq (`LuckRingEncoder.seq`). */
  seq: number;
  /** Next pager seq (`LuckRingHistorySync.seq`). */
  pagerSeq: number;
  /** The seq `begin` reserved for the command about to be framed. */
  out: { op: string; nowMs: number; seq: number } | null;
  partial: PartialFrame | null;
  firmware: string;
  battery: number | null;
  /** Data types the ring has sent on this connection. */
  seen: number[];
  inflight: Inflight | null;
  nowMs: number;
  tzOffsetS: number;
  tz?: string;
}

export const initialLuckRingState = (): LuckRingState => ({
  seq: 0, pagerSeq: 0, out: null, partial: null, firmware: '', battery: null, seen: [], inflight: null, nowMs: 0, tzOffsetS: 0,
});

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const flag = (cmd: RingCommand): number => (bool(cmd.params?.on, true) ? 1 : 0);
const hexBytes = (s: unknown): number[] => (typeof s === 'string' ? (s.replace(/[^0-9a-f]/gi, '').match(/../g) ?? []).map((x) => parseInt(x, 16)) : []);

/** Profile fields from command params; missing fields take the engine default (sex other, age 0 → 20, 0 cm, 0 kg). */
function profileOf(p: RingCommand['params']): LuckRingProfile {
  const sex = p?.sex === 'male' || p?.sex === 'female' || p?.sex === 'other' ? p.sex : DEFAULT_PROFILE.sex;
  return {
    sex,
    ageYears: num(p?.ageYears, DEFAULT_PROFILE.ageYears),
    heightCm: num(p?.heightCm, DEFAULT_PROFILE.heightCm),
    weightKg: num(p?.weightKg, DEFAULT_PROFILE.weightKg),
    userId: num(p?.userId, 0),
  };
}

/** `YYYY-MM-DD` of the phone's local day. */
const localDay = (nowMs: number, tzOffsetS: number, tz?: string): string => new Date(zoneDayIndex(nowMs, { tz, tzOffsetS }) * 86_400_000).toISOString().slice(0, 10);

/** Ops that wait for a reply, and which data types complete them by default. */
const replyTypes = (cmd: RingCommand): number[] => {
  const w = cmd.params?.waitFor;
  if (typeof w === 'string' && w.trim()) return w.split(',').map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x));
  return [cmd.op === 'battery' ? DT.BATTERY : num(cmd.params?.dataType, 0)];
};

/** The logical frame of one command, with the seq it goes out with. */
function logical(cmd: RingCommand, seq: number): LogicalFrame {
  const p = cmd.params;
  const send = (dataType: number, payload: number[]): LogicalFrame => ({ cmdType: CMD.SEND, dataType, payload, seq, devType: DEVICE_TYPE });
  const request = (dataType: number): LogicalFrame => ({ cmdType: CMD.REQUEST, dataType, payload: [], seq, devType: DEVICE_TYPE });
  const nowMs = num(p?.nowMs, 0);
  const tz = num(p?.tzOffsetS, 0);
  switch (cmd.op) {
    case 'startupBundle':
      return send(DT.MIX_INFO, startupBundleBytes(profileOf(p), num(p?.goalSteps, DEFAULT_GOAL_STEPS), nowMs, tz, num(p?.languageCode, 0)));
    case 'userInfo':
      return send(DT.USER_INFO, userInfoBytes(profileOf(p)));
    case 'setTime':
      return send(DT.TIME, timeBytes(nowMs, tz));
    case 'setGoal':
      return send(DT.GOALS, goalBytes(num(p?.steps, DEFAULT_GOAL_STEPS)));
    case 'dataSwitch':
      return send(DT.DATA_SWITCH, [flag(cmd)]);
    case 'autoMonitoring':
      // The engine default: HR on every 30 min, SpO2 on (the firmware ships with monitoring off).
      return send(DT.HEART_AUTO_SWITCH, autoMonitoringBytes(bool(p?.hrEnabled, true), num(p?.hrIntervalMinutes, 30), bool(p?.spo2Enabled, true)));
    case 'request':
    case 'history':
      return request(num(p?.dataType, 0));
    case 'battery':
      return request(DT.BATTERY);
    case 'realHeartRate':
      return send(DT.REAL_HR, [flag(cmd)]);
    case 'realSpO2':
      return send(DT.REAL_O2, [flag(cmd), 0, 0, 0, 0]);
    case 'realHRV':
      return send(DT.REAL_HRV, [flag(cmd)]);
    case 'realBloodPressure':
      return send(DT.REAL_BP, [flag(cmd), 0, 0, 0, 0, 0]);
    case 'realTemperature':
      return send(DT.REAL_TEMP, [flag(cmd)]);
    case 'findDevice':
      return send(DT.FIND_DEVICE, [1]);
    case 'unbind':
      // UNVERIFIED: Android's forget flow never sends 159.
      return send(DT.UNBIND, [1]);
    case 'frame': {
      // Raw logical frame (tests and tools): cmdType by name, payload as hex.
      const name = String(p?.cmdType ?? 'SEND') as CmdName;
      return { cmdType: CMD[name] ?? CMD.SEND, dataType: num(p?.dataType, 0), payload: hexBytes(p?.payloadHex), seq, devType: num(p?.devType, DEVICE_TYPE) };
    }
  }
  throw new Error(`luckring: unknown command ${cmd.op}`);
}

/** Ends the history type in flight: a cursor per stream, or `partial` with no cursor when a frame was left open. */
function finishHistory(st: LuckRingState, partial: boolean): IngestResult {
  const h = st.inflight;
  const next: LuckRingState = { ...st, inflight: null, out: null, partial: partial ? null : st.partial };
  if (!h || h.kind !== 'history') return { events: [], state: next, done: true };
  const events: RingEvent[] = partial
    ? [{ type: 'status', key: 'error', value: `partial:${h.stream}`, stream: h.stream }]
    : [{ type: 'status', key: 'cursor', value: `lr1:${localDay(st.nowMs, st.tzOffsetS, st.tz)}`, stream: h.stream }];
  return { events, state: next, done: true };
}

export function createLuckRingProtocol(): Protocol {
  return {
    initialState: initialLuckRingState,

    frame(cmd, state): OutboundFrame[] {
      const st = state as LuckRingState;
      if (cmd.op === 'ack') {
        // `LuckRingPacketizer.ack`: echoes the ring's seq and devType; never takes an encoder seq.
        const p = cmd.params;
        return [{ bytes: ackPacket(num(p?.dataType, 0), num(p?.seq, 0), num(p?.devType, DEVICE_TYPE)) }];
      }
      const reserved = st.out && st.out.op === cmd.op && st.out.nowMs === cmd.params?.nowMs ? st.out.seq : undefined;
      const seq = num(cmd.params?.seq, reserved ?? (cmd.op === 'history' ? st.pagerSeq : st.seq));
      // Every packet of a frame is its own 20-byte write; the session writes them back to back with nothing between.
      return packets(logical(cmd, seq)).map((bytes) => ({ bytes }));
    },

    ingest(bytes, state, _channel, receivedMs): IngestResult {
      const st = state as LuckRingState;
      const a = assemble(st.partial, bytes);
      let next: LuckRingState = { ...st, partial: a.partial };
      const f = a.frame;
      if (!f) return { events: [], state: next };
      // `LuckRingDriver.ingest`: ACK a device SEND before decoding; never an ACK or a SEND_NO_ACK.
      const send: RingCommand[] | undefined = f.cmdType === CMD.SEND ? [{ op: 'ack', params: { dataType: f.dataType, seq: f.seq, devType: f.devType } }] : undefined;
      const events = decodeFrame(f, { firmware: next.firmware, nowMs: receivedMs ?? (next.nowMs > 0 ? next.nowMs : undefined) }).filter(plausibleAggregate);
      for (const e of events) {
        if (e.type === 'status' && e.key === 'firmware') next = { ...next, firmware: String(e.value) };
        if (e.type === 'status' && e.key === 'battery' && typeof e.value === 'number') next = { ...next, battery: e.value };
      }
      if (!next.seen.includes(f.dataType)) next = { ...next, seen: [...next.seen, f.dataType] };
      const h = next.inflight;
      const data = f.cmdType === CMD.SEND || f.cmdType === CMD.SEND_NO_ACK;
      // A complete frame the read in flight did not ask for (a battery push, a settings echo) is `unrelated`: the session
      // keeps the stall wait instead of settling on it.
      if (h?.kind === 'reply') {
        if (!h.want.includes(f.dataType)) return { events, state: next, send, unrelated: true };
        const got = h.got.includes(f.dataType) ? h.got : [...h.got, f.dataType];
        if (h.want.every((t) => got.includes(t))) return { events, state: { ...next, inflight: null, out: null }, send, done: true };
        return { events, state: { ...next, inflight: { ...h, got } }, send };
      }
      if (h?.kind === 'history') {
        // `noteReceived`: only a complete data frame of the type in flight re-arms the settle; other types are ignored.
        if (!data || f.dataType !== h.dataType) return { events, state: next, send, unrelated: true };
        return { events, state: { ...next, inflight: { ...h, frames: h.frames + 1, quietMs: 0 } }, send };
      }
      // A live or spot stream: the empty envelope (Kotlin `HeartRateComplete` / `Spo2Complete`) ends the measurement.
      const ended = events.some((e) => e.type === 'status' && e.key === 'ack' && (e.value === 'hr_complete' || e.value === 'spo2_complete'));
      return { events, state: next, send, done: ended || undefined };
    },

    planSync(_cursor: SyncCursor, state): RingCommand[] {
      const st = state as LuckRingState;
      // `runStartup` warm pass: once the pager has run on this connection, battery and settings sync go first again.
      const warm: RingCommand[] = st.pagerSeq > 0
        ? [{ op: 'request', params: { dataType: DT.BATTERY, wait: false } }, { op: 'request', params: { dataType: DT.DEV_SYNC, wait: false } }]
        : [];
      // No cursor in the Kotlin: the whole catalog every time; content-derived record ids make a re-read idempotent.
      return [...warm, ...HISTORY_CATALOG.map((c) => ({ op: 'history', params: { dataType: c.dataType, stream: c.stream, stage: c.stage } }))];
    },

    begin(cmd, state): CommandPlan {
      const st0 = state as LuckRingState;
      const st: LuckRingState = { ...st0, nowMs: num(cmd.params?.nowMs, st0.nowMs), tzOffsetS: num(cmd.params?.tzOffsetS, st0.tzOffsetS), tz: typeof cmd.params?.tz === 'string' ? cmd.params.tz : st0.tz };
      const nowMs = num(cmd.params?.nowMs, 0);
      if (cmd.op === 'ack' || cmd.op === 'frame') return { state: { ...st, out: null }, expectReply: false };
      if (cmd.op === 'history') {
        const dataType = num(cmd.params?.dataType, 0);
        const stream = (typeof cmd.params?.stream === 'string' ? cmd.params.stream : HISTORY_CATALOG.find((c) => c.dataType === dataType)?.stream ?? 'vendor:history') as BioStream;
        const seq = st.pagerSeq;
        return {
          state: { ...st, pagerSeq: (seq + 1) & 0xff, out: { op: cmd.op, nowMs, seq }, inflight: { kind: 'history', dataType, stream, frames: 0, quietMs: 0 } },
          expectReply: true,
          quietMs: SETTLE_MS,
          stallMs: STALL_MS,
        };
      }
      const seq = typeof cmd.params?.seq === 'number' ? cmd.params.seq : st.seq;
      const taken: LuckRingState = { ...st, seq: typeof cmd.params?.seq === 'number' ? st.seq : (seq + 1) & 0xff, out: { op: cmd.op, nowMs, seq }, inflight: null };
      if ((cmd.op === 'request' || cmd.op === 'battery') && cmd.params?.wait !== false) {
        const want = replyTypes(cmd);
        const own = cmd.op === 'battery' ? DT.BATTERY : num(cmd.params?.dataType, 0);
        // Replies to earlier fire-and-forget requests may already be in; the requested type itself must come after the write.
        const got = want.filter((t) => t !== own && st.seen.includes(t));
        return { state: { ...taken, inflight: { kind: 'reply', want, got } }, expectReply: true, stallMs: REPLY_MS };
      }
      // Settings, toggles and the connect bundle: the Kotlin never waits for the ring's ACK.
      return { state: taken, expectReply: false };
    },

    timeout(state, kind): IngestResult {
      const st = state as LuckRingState;
      const h = st.inflight;
      if (!h) return { events: [], state: { ...st, out: null }, done: true };
      if (h.kind === 'reply') {
        // A missing reply never fails the connect (Android never checks); say which types stayed silent.
        const missing = h.want.filter((t) => !h.got.includes(t));
        return { events: missing.length ? [{ type: 'status', key: 'error', value: `timeout:request:${missing.join(',')}` }] : [], state: { ...st, inflight: null, out: null }, done: true };
      }
      if (st.partial) {
        // A frame is still open: the ring owes packets. Keep waiting, up to SILENCE_MAX_MS of silence in all; then the
        // read is partial (reported, no cursor). The Kotlin pager would have advanced on its settle timer here.
        const quietMs = h.quietMs + (kind === 'quiet' ? SETTLE_MS : STALL_MS);
        if (quietMs < SILENCE_MAX_MS) return { events: [], state: { ...st, inflight: { ...h, quietMs } }, done: false };
        return finishHistory(st, true);
      }
      if (kind === 'quiet' && h.frames === 0) {
        // Nothing of this type yet (the quiet timer ran because a packet of an unfinished frame came): still stall time,
        // as `LuckRingHistorySync` holds the stall budget until the first frame of the type. Never a cursor for nothing.
        const quietMs = h.quietMs + SETTLE_MS;
        if (quietMs < STALL_MS) return { events: [], state: { ...st, inflight: { ...h, quietMs } }, done: false };
      }
      // Settle after the last frame, or a stall with nothing at all (an unsupported type answers with nothing): advance.
      return finishHistory(st, false);
    },

    redactOutbound: (frame) => frame, // no credential frame in this family
  };
}

export const luckRingProtocol: Protocol = createLuckRingProtocol();
