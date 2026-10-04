/**
 * Jring `Protocol` for `@vitals/rings`. Tier P: no timers, no I/O; the session runs the timers and calls `timeout`.
 * Port of Lumen's `JringSyncEngine` (`ring/JringDriver.kt`), `JringClock` and the sync timers of `RingSyncCoordinator`.
 *
 * Kotlin writes every command fire-and-forget and lets replies arrive whenever. Here commands run one at a time; only the
 * ones with a real reply wait for it (0x0C status, the two history reads, forget). Replies and pushes are decoded whatever
 * command is in flight, so interleaving is harmless.
 *
 * Clock (`JringClock`): the offset is latched when 0x01 is begun (`capture`) and subtracted from ring-stamped times until the
 * next 0x01. Before the first 0x01 of a connection the offset stamped on the latest command stands in for Kotlin's
 * construct-time capture.
 *
 * History (`runStartup`, `historyDaysForThisPass`): `10 nn` (3 days on the first pass of a connection, 1 after) gives the
 * 0x10 activity and 0x11 sleep streams, which have no end marker. Then `16 00` gives the heart-rate history, which ends on
 * `16 ff`. Nothing is reported when a read gets no packet at all within the stall (Kotlin drops it silently).
 *
 * Timing (the J-Style lesson, `jstyle2301/legacyProtocol.ts`): a quiet timer never ends a read that still expects packets.
 * After a pause of `QUIET_MS` the read keeps waiting (`timeout` returns `done: false`) until `HISTORY_STALL_MS` of silence in
 * all (Kotlin's 12 s stall); a read still short then ends as `status:error partial:<stream>` and its cursor is not moved.
 * "Still expects packets": 0x16 until `16 ff`; 0x10 until a record reaches "now" (Kotlin's progress rule, a record at or
 * past now ends the sync; here: within one 15-minute packet of now, UNVERIFIED that the ring sends the running slot). The
 * record time has the clock offset taken off like every decoded time, so it is compared with the phone's UTC now.
 * A quiet timeout with no packet of the read yet is stall time too: a push that is not part of the read (battery, a late
 * 0x27) makes the session wait only `QUIET_MS`, and the ring may take longer than that to start answering.
 * 0x27 / 0x28 / 0x24 end a live or spot run (or nothing); during a history read they are decoded and the read goes on.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import type { CommandPlan, IngestResult, OutboundFrame, Protocol, ProtocolState, RingCommand, RingEvent, SyncCursor } from '../types';
import {
  AUTO_HR_CADENCE_MIN, BIND, CMD, DEFAULT_PROFILE, JRING_BACKFILL_DAYS, appIdCommand, autoHeartRateCommand, bandFunctionCommand, bindCommand,
  bpAdjustCommand, findRingCommand, goalCommand, heartRateStartCommand, heartRateStopCommand, historyMeasurementQueryCommand, historyQueryCommand,
  keepaliveCommand, localeCommand, spo2StartCommand, spo2StopCommand, statusCommand, timeSyncCommand, userInfoCommand,
} from './commands';
import { decodeJringPacket, toJringRingEvents, type JringDecoded } from './decoder';

/** Reply wait for 0x0C (docs/jring.md: Kotlin never waits; bounded so the handshake can fall back to 2a26). */
export const REPLY_MS = 4_000;
/** `RingSyncCoordinator`: a history read with no record for 12 s is over. */
export const HISTORY_STALL_MS = 12_000;
/** Pause after which a history read checks whether it is complete. UNVERIFIED: the real inter-packet timing is unknown. */
export const QUIET_MS = 4_000;
/** One 0x10 / 0x11 packet covers 15 one-minute slots. */
const PACKET_SPAN_S = 15 * 60;
/** `RingBLEClient.forgetAndWait`: 1.5 s for UNBOND_ACK before the link is torn down. */
export const FORGET_MS = 1_500;

type Inflight =
  | { kind: 'status' }
  | { kind: 'forget' }
  /** `newestS`: base (epoch s, offset taken off) of the newest 0x10/0x11 packet; `silenceMs`: quiet time since the last packet. */
  | { kind: 'activity'; packets: number; newestSteps: number | null; newestSleep: number | null; newestS: number | null; silenceMs: number }
  | { kind: 'hrHistory'; packets: number; newest: number | null; silenceMs: number };

export interface JringState extends ProtocolState {
  firmware: string | null;
  /** 0x0C address text when not all zero: the ring's serial for identity. */
  address: string | null;
  battery: number | null;
  charging: boolean | null;
  /** 0x20 payload as spaced hex; nothing branches on it yet (as in Kotlin). */
  capabilities: string | null;
  tzOffsetS: number;
  tz?: string;
  nowMs: number;
  /** Offset latched at the last 0x01 (`JringClock.capture`); null before the first one. */
  clockOffsetS: number | null;
  /** True once this connection asked for the deep window (`historyBackfilled`). */
  historyBackfilled: boolean;
  /** Valid readings since the heart-rate / SpO2 run started (0x27 / 0x28 with none = no reading). */
  hrReadings: number;
  spo2Readings: number;
  inflight: Inflight | null;
  cursors: Partial<Record<BioStream, string>>;
}

// ---------------------------------------------------------------- cursor codec

/** `jr1:<newest record epoch s>` per stream. Kotlin keeps no cursor; this one only records progress for the service. */
export function decodeCursor(s: string | undefined): number | null {
  const m = /^jr1:(\d+)$/.exec(s ?? '');
  return m ? Number(m[1]) : null;
}
export const encodeCursor = (newestS: number): string => `jr1:${newestS}`;

/** Merges the newest time a read saw (ms) into the stream's cursor; undefined when there is still nothing to say. */
function mergeCursor(prev: string | undefined, newestMs: number | null): string | undefined {
  const p = decodeCursor(prev);
  const n = newestMs === null ? null : Math.floor(newestMs / 1000);
  if (p === null && n === null) return undefined;
  return encodeCursor(Math.max(p ?? 0, n ?? 0));
}

// ---------------------------------------------------------------- framing

const num = (cmd: RingCommand, k: string, d = 0): number => (typeof cmd.params?.[k] === 'number' ? (cmd.params[k] as number) : d);
const str = (cmd: RingCommand, k: string, d = ''): string => (typeof cmd.params?.[k] === 'string' ? (cmd.params[k] as string) : d);
const bool = (cmd: RingCommand, k: string, d: boolean): boolean => (typeof cmd.params?.[k] === 'boolean' ? (cmd.params[k] as boolean) : d);

/** Every command `JringSyncEngine` and `RingEncoder` can send, by op name (see `encode.json`). */
export function frameJring(cmd: RingCommand): Uint8Array[] {
  switch (cmd.op) {
    case 'timeSync':
      return [timeSyncCommand(num(cmd, 'nowMs'), num(cmd, 'tzOffsetS'))];
    case 'status':
      return [statusCommand()];
    case 'locale':
      return [localeCommand(str(cmd, 'locale', 'en-US'))];
    case 'userInfo':
      return [userInfoCommand({
        ageYears: num(cmd, 'ageYears', DEFAULT_PROFILE.ageYears), isMale: bool(cmd, 'isMale', DEFAULT_PROFILE.isMale),
        heightCm: num(cmd, 'heightCm', DEFAULT_PROFILE.heightCm), weightKg: num(cmd, 'weightKg', DEFAULT_PROFILE.weightKg),
      })];
    case 'autoHeartRate':
      return [autoHeartRateCommand(bool(cmd, 'enabled', true), num(cmd, 'cadenceMinutes', AUTO_HR_CADENCE_MIN))];
    case 'bandFunction':
      return [bandFunctionCommand()];
    case 'historyQuery':
      return [historyQueryCommand(num(cmd, 'days', 1))];
    case 'historyMeasurementQuery':
      return [historyMeasurementQueryCommand()];
    case 'heartRateStart':
      return [heartRateStartCommand()];
    case 'heartRateStop':
      return [heartRateStopCommand()];
    case 'liveStop':
      // `stopHeartRate`: 0x15 also disables the background logging, so 0x19 re-arms it right after.
      return [heartRateStopCommand(), autoHeartRateCommand(true, AUTO_HR_CADENCE_MIN)];
    case 'spo2Start':
    case 'combinedStart':
      return [spo2StartCommand()];
    case 'spo2Stop':
    case 'combinedStop':
      return [spo2StopCommand()];
    case 'findRing':
      return [findRingCommand()];
    case 'goal':
      return [goalCommand(num(cmd, 'steps'))];
    case 'appId':
      return [appIdCommand(str(cmd, 'appId'))];
    case 'bind':
      return [bindCommand(num(cmd, 'action'), num(cmd, 'state', 0), num(cmd, 'type', 1))];
    case 'bpAdjust':
      return [bpAdjustCommand(num(cmd, 'systolic'), num(cmd, 'diastolic'))];
    case 'keepalive':
      return [keepaliveCommand()];
    case 'battery':
      // The family has no battery request: the level comes from the 2a19 read and 0x0B pushes. Nothing is written.
      return [];
  }
  throw new RangeError(`jring: unknown command ${cmd.op}`);
}

// ---------------------------------------------------------------- planner

/**
 * `runStartup`'s history tail: `10 nn` then `16 00`. Days follow Kotlin (3 on the first pass of a connection, 1 after); the
 * cursor does not widen the window. `stream` names the stream the session filters on; the 0x10 read also feeds `steps`
 * (listed in `streams`).
 */
export function planJringSync(cursor: SyncCursor, state: ProtocolState): RingCommand[] {
  const st = state as JringState;
  const days = st.historyBackfilled ? 1 : JRING_BACKFILL_DAYS;
  return [
    { op: 'historyQuery', params: { days, stream: 'sleep_stage', streams: 'sleep_stage,steps', prevSleep: cursor.sleep_stage ?? '', prevSteps: cursor.steps ?? '' } },
    { op: 'historyMeasurementQuery', params: { stream: 'hr', prevHr: cursor.hr ?? '' } },
  ];
}

// ---------------------------------------------------------------- state machine

const timeOf = (d: JringDecoded): number | null => ('tMs' in d ? d.tMs : null);

/** The 0x10 read reached "now": its newest packet's slots run to within one packet of it. Both sides are UTC epoch s. */
function caughtUp(st: JringState, newestS: number | null): boolean {
  if (newestS === null || st.nowMs <= 0) return false;
  return newestS + 2 * PACKET_SPAN_S > Math.floor(st.nowMs / 1000);
}
const maxOrNull = (a: number | null, b: number): number => (a === null ? b : Math.max(a, b));

/**
 * Closes the history read in flight and emits its cursors. `partial` = the read went silent while still short: each of its
 * streams gets a `status:error partial:<stream>:<packets>` and keeps its old cursor (no cursor event).
 */
function finishRead(st: JringState, partial = false): { state: JringState; events: RingEvent[] } {
  const h = st.inflight;
  const cursors = { ...st.cursors };
  const events: RingEvent[] = [];
  const put = (stream: BioStream, newest: number | null): void => {
    if (partial) {
      events.push({ type: 'status', key: 'error', value: `partial:${stream}:${h && 'packets' in h ? h.packets : 0}`, stream });
      return;
    }
    const v = mergeCursor(cursors[stream], newest);
    if (v === undefined) return;
    cursors[stream] = v;
    events.push({ type: 'status', key: 'cursor', value: v, stream });
  };
  if (h?.kind === 'activity') {
    put('sleep_stage', h.newestSleep);
    put('steps', h.newestSteps);
  } else if (h?.kind === 'hrHistory') put('hr', h.newest);
  return { state: { ...st, inflight: null, cursors }, events };
}

export function createJringProtocol(): Protocol {
  return {
    initialState: (): JringState => ({
      firmware: null, address: null, battery: null, charging: null, capabilities: null, tzOffsetS: 0, nowMs: 0, clockOffsetS: null,
      historyBackfilled: false, hrReadings: 0, spo2Readings: 0, inflight: null, cursors: {},
    }),

    frame: (cmd): OutboundFrame[] => frameJring(cmd).map((bytes) => ({ bytes })),

    planSync: planJringSync,

    begin(cmd, state): CommandPlan {
      const st0 = state as JringState;
      let st: JringState = { ...st0, nowMs: num(cmd, 'nowMs', st0.nowMs), tzOffsetS: num(cmd, 'tzOffsetS', st0.tzOffsetS), tz: str(cmd, 'tz', st0.tz ?? '') || undefined };
      switch (cmd.op) {
        case 'timeSync':
          // `enqueueTimeSync`: latch the offset that goes out on the wire; the decoder subtracts this same value.
          return { state: { ...st, clockOffsetS: st.tzOffsetS }, expectReply: false };
        case 'status':
          return { state: { ...st, inflight: { kind: 'status' } }, expectReply: true, stallMs: REPLY_MS };
        case 'historyQuery': {
          const prev = { sleep_stage: str(cmd, 'prevSleep'), steps: str(cmd, 'prevSteps') };
          const cursors = { ...st.cursors };
          for (const [k, v] of Object.entries(prev) as Array<[BioStream, string]>) if (cursors[k] === undefined && v) cursors[k] = v;
          st = { ...st, cursors, historyBackfilled: true, inflight: { kind: 'activity', packets: 0, newestSteps: null, newestSleep: null, newestS: null, silenceMs: 0 } };
          return { state: st, expectReply: true, quietMs: QUIET_MS, stallMs: HISTORY_STALL_MS };
        }
        case 'historyMeasurementQuery': {
          const prev = str(cmd, 'prevHr');
          const cursors = st.cursors.hr === undefined && prev ? { ...st.cursors, hr: prev } : st.cursors;
          return { state: { ...st, cursors, inflight: { kind: 'hrHistory', packets: 0, newest: null, silenceMs: 0 } }, expectReply: true, quietMs: QUIET_MS, stallMs: HISTORY_STALL_MS };
        }
        case 'bind':
          if (num(cmd, 'action') === BIND.UNBOND) return { state: { ...st, inflight: { kind: 'forget' } }, expectReply: true, stallMs: FORGET_MS };
          return { state: st, expectReply: false };
        case 'heartRateStart':
          return { state: { ...st, hrReadings: 0 }, expectReply: false };
        case 'spo2Start':
        case 'combinedStart':
          return { state: { ...st, spo2Readings: 0 }, expectReply: false };
      }
      return { state: st, expectReply: false };
    },

    ingest(bytes, state, _channel, receivedMs): IngestResult {
      let st = state as JringState;
      const offset = st.clockOffsetS ?? st.tzOffsetS;
      const eventNowMs = receivedMs ?? st.nowMs;
      const decoded = decodeJringPacket(bytes, offset, eventNowMs);
      const events: RingEvent[] = [];
      const send: RingCommand[] = [];
      // A completion or result packet during a history read is background logging, not the end of the read (RINGS-11).
      const historyRead = st.inflight?.kind === 'activity' || st.inflight?.kind === 'hrHistory';
      let done = false;
      for (const d of decoded) {
        events.push(...toJringRingEvents(d, { nowMs: eventNowMs, clockOffsetS: offset, tz: st.tz, strictNow: eventNowMs > 0, firmware: st.firmware ?? '' }));
        switch (d.kind) {
          case 'Status':
            st = { ...st, firmware: d.firmware, address: d.address === '00:00:00:00:00:00' ? null : d.address };
            break;
          case 'Battery':
            if (d.percent <= 100) st = { ...st, battery: d.percent, charging: d.charging };
            break;
          case 'BandFunction':
            st = { ...st, capabilities: Array.from(d.payload, (x) => x.toString(16).padStart(2, '0')).join(' ') };
            break;
          case 'HeartRateSample':
            if (!d.isError && d.bpm > 0) st = { ...st, hrReadings: st.hrReadings + 1 };
            break;
          case 'Spo2Result':
            st = { ...st, spo2Readings: st.spo2Readings + 1 };
            break;
          case 'HeartRateComplete':
          case 'Spo2Complete': {
            if (historyRead) break;
            // A completion with no reading yet means the ring gave up (worn badly): the run is "no reading" (coordinator).
            const hr = d.kind === 'HeartRateComplete';
            const readings = hr ? st.hrReadings : st.spo2Readings;
            events.push(readings > 0 ? { type: 'status', key: 'ack', value: hr ? 'hr_complete' : 'spo2_complete' } : { type: 'status', key: 'error', value: 'no_reading' });
            st = hr ? { ...st, hrReadings: 0 } : { ...st, spo2Readings: 0 };
            done = true;
            break;
          }
          case 'BindNotify':
            // `JringSyncEngine.handle`: INIT (state no) -> APP_START; ACK -> SUCCESS. Unbind replies close a forget.
            if (d.action === BIND.INIT && d.state === 0) send.push({ op: 'bind', params: { action: BIND.APP_START } });
            else if (d.action === BIND.ACK) send.push({ op: 'bind', params: { action: BIND.SUCCESS } });
            else if (st.inflight?.kind === 'forget' && (d.action === BIND.UNBOND_ACK || d.action === BIND.ACK_CANCEL)) {
              events.push({ type: 'status', key: 'ack', value: d.action === BIND.UNBOND_ACK ? 'unbound' : 'unbind_cancelled' });
              st = { ...st, inflight: null };
              done = true;
            }
            break;
          default:
            break;
        }
      }
      // One 0x24 packet is the whole answer of a SpO2 or combined run (Kotlin reads one packet per run).
      if (!historyRead && bytes.length === 20 && bytes[0] === CMD.COMBINED_RESULT && decoded.length > 0) done = true;
      if (!historyRead && bytes.length === 20 && bytes[0] === CMD.SPO2_RESULT && decoded.some((d) => d.kind === 'Spo2Result')) done = true;

      const h = st.inflight;
      if (h?.kind === 'status' && bytes.length === 20 && bytes[0] === CMD.STATUS) {
        st = { ...st, inflight: null };
        done = true;
      } else if (h?.kind === 'activity' && bytes.length === 20 && (bytes[0] === CMD.HISTORY_SUMMARY || bytes[0] === CMD.SLEEP_TIMELINE)) {
        let { newestSteps, newestSleep } = h;
        const base = ((bytes[1]! | (bytes[2]! << 8) | (bytes[3]! << 16) | (bytes[4]! << 24)) >>> 0) - offset;
        const newestS = h.newestS === null ? base : Math.max(h.newestS, base);
        for (const d of decoded) {
          const t = timeOf(d);
          if (t === null) continue;
          if (d.kind === 'ActivityBucket') newestSteps = maxOrNull(newestSteps, t);
          if (d.kind === 'SleepTimeline') newestSleep = maxOrNull(newestSleep, t + (d.codes.length - 1) * 60_000);
        }
        st = { ...st, inflight: { ...h, packets: h.packets + 1, newestSteps, newestSleep, newestS, silenceMs: 0 } };
      } else if (h?.kind === 'hrHistory' && bytes.length === 20 && bytes[0] === CMD.HISTORY_MEASUREMENT_STREAM) {
        let newest = h.newest;
        for (const d of decoded) if (d.kind === 'HistoryMeasurement') newest = maxOrNull(newest, d.tMs);
        st = { ...st, inflight: { ...h, packets: h.packets + 1, newest, silenceMs: 0 } };
        if (bytes[1] === 0xff) {
          const f = finishRead(st);
          return { events: [...events, ...f.events], state: f.state, done: true, ...(send.length ? { send } : {}) };
        }
      }
      return { events, state: st, ...(send.length ? { send } : {}), ...(done ? { done } : {}) };
    },

    timeout(state, kind): IngestResult {
      const st = state as JringState;
      const h = st.inflight;
      if (!h) return { events: [], state: st, done: true };
      if (h.kind === 'status') return { events: [{ type: 'status', key: 'error', value: 'timeout:0x0c' }], state: { ...st, inflight: null }, done: true };
      if (h.kind === 'forget') return { events: [], state: { ...st, inflight: null }, done: true };
      if (h.packets > 0 && h.kind === 'activity' && caughtUp(st, h.newestS)) {
        const f = finishRead(st);
        return { events: f.events, state: f.state, done: true };
      }
      // Still short (no packet yet, no `16 ff`, or 0x10 not yet at now): keep waiting through the pause, up to the 12 s
      // stall in all. A quiet timeout with no packet of the read is stall time, not the end (RINGS-01).
      const silenceMs = h.silenceMs + (kind === 'quiet' ? QUIET_MS : HISTORY_STALL_MS);
      if (silenceMs < HISTORY_STALL_MS) return { events: [], state: { ...st, inflight: { ...h, silenceMs } }, done: false };
      // No packet at all: the read is over and nothing is said (Kotlin drops an empty read silently).
      if (h.packets === 0) return { events: [], state: { ...st, inflight: null }, done: true };
      const f = finishRead(st, true);
      return { events: f.events, state: f.state, done: true };
    },

    redactOutbound: (frame) => frame.slice(),
  };
}

export const jringProtocol: Protocol = createJringProtocol();
