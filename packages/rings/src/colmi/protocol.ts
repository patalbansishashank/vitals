/**
 * Colmi `Protocol` for `@vitals/rings`: command framing, the ingest state machine and the history planner. Tier P: no
 * timers here; the session runs the quiet/stall timers and calls `timeout`.
 * Ported from the upstream Android Kotlin `ColmiDriver.kt` (frame routing, big-data reassembly) and `ColmiSyncEngine.kt`
 * (history walk, handshake reply handling, real-time fallback); research notes in `packages/rings/docs/colmi.md`.
 *
 * History walk (doc §8): one exchange per stage, in the Kotlin order activity → HR → stress → SpO2 → sleep → HRV →
 * temperature. Paged stages ask day 0 first and every next day as a follow-up (`send`) when a day ends; big-data stages
 * end when their transfer completes. The Kotlin keeps no cursor and walks 8 (activity, HR) or 7 days every time; a stage
 * that already completed on this connection reads back to the local day of that walk (today only on the same day, the
 * Kotlin's warm "today only" pass; yesterday too once a long-lived link has crossed midnight).
 *
 * Timers (doc §8 watchdog, 10 s; 20 s for activity): the stage's stall and quiet timers. A quiet timer never ends a day
 * while more packets are expected: the read keeps waiting up to SILENCE_MAX_MS of silence in all, then ends as
 * `partial:<stream>` (a `status:error`) without a cursor, so the next sync reads it again. The Kotlin's watchdog skipped
 * the rest of the stage silently there.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import { normalizeUuid, type CommandPlan, type IngestResult, type OutboundFrame, type Protocol, type ProtocolState, type RingCommand, type RingEvent, type Uuid } from '../types';
import {
  BIG, COLMI_UUIDS, OP, RT_HEART_RATE, SPORT, enc, frame16, hrDayRequestUnix, isValidFrame, isoDay, sportType,
} from './commands';
import {
  decodeAutoHrPrefRead, decodeBigData, decodeDeviceSupport, decodeHistory, decodeIntervalTemperature, decodeNormal, decodeTempPrefRead, isHistoryOpcode, toRingEvents,
  type ColmiDecoded,
} from './decoder';
import { zoneDayIndex } from '../zone';

// ---------------------------------------------------------------- constants

/** `ColmiSyncEngine.watchdogTimeoutMs` / `activityWatchdogTimeoutMs`. */
export const WATCHDOG_MS = 10_000;
export const ACTIVITY_WATCHDOG_MS = 20_000;
/**
 * Longest silence tolerated inside a day or transfer that still expects packets (engineering value: three watchdog
 * periods; two for activity). After it the read ends as partial.
 */
export const SILENCE_MAX_MS = 30_000;
/** Reply wait for the handshake reads (engineering value; the Kotlin never waits for them at all). */
export const REPLY_MS = 3_000;

export type Stage = 'activity' | 'hr' | 'stress' | 'spo2' | 'sleep' | 'hrv' | 'temperature';

interface StageInfo {
  stage: Stage;
  stream: BioStream;
  /** Last "days ago" of a full walk; 0 for the one-shot big-data stages. */
  depth: number;
  /** Normal-channel opcode of a paged stage. */
  opcode?: number;
}

/** `ColmiSyncEngine` stage order and depths (`historyLastDay(7)` for activity/HR, 6 for stress/HRV/temperature). */
export const STAGES: readonly StageInfo[] = [
  { stage: 'activity', stream: 'steps', depth: 7, opcode: OP.SYNC_ACTIVITY },
  { stage: 'hr', stream: 'hr', depth: 7, opcode: OP.SYNC_HEART_RATE },
  { stage: 'stress', stream: 'vendor:stress', depth: 6, opcode: OP.SYNC_STRESS },
  { stage: 'spo2', stream: 'spo2', depth: 0 },
  { stage: 'sleep', stream: 'sleep_stage', depth: 0 },
  { stage: 'hrv', stream: 'hrv', depth: 6, opcode: OP.SYNC_HRV },
  { stage: 'temperature', stream: 'skin_temp', depth: 6 },
];

const stageInfo = (s: string): StageInfo | undefined => STAGES.find((x) => x.stage === s);

// ---------------------------------------------------------------- state

type Inflight =
  | { kind: 'reply'; opcode: number; sub?: number }
  | {
      kind: 'history';
      stage: Stage;
      stream: BioStream;
      daysAgo: number;
      lastDay: number;
      /** Local day number the current day's frames are placed on (`syncDay`; re-anchored by the packet-1 echo). */
      syncDay: number;
      /** Packet count from the day's packet 0 (2..64 trusted) and slot minutes (1..240 trusted). */
      expected: number | null;
      slot: number | null;
      /** Highest packet number seen this day (-1 = none) and packets of this stage since the last request. */
      highest: number;
      packets: number;
      /** Nominal quiet time already waited through (reset on every packet). */
      quietMs: number;
      /** Interval temperature: last packet index seen this day (`lastIntervalTempPacket`). */
      lastIntervalPacket: number;
    }
  | { kind: 'sleepOnly'; packets: number; quietMs: number };

export interface ColmiState extends ProtocolState {
  nowMs: number;
  /** IANA zone stamped by the session (`params.tz`); absent = the fixed `tzOffsetS`. */
  tz?: string;
  tzOffsetS: number;
  firmware: string;
  model: string | null;
  /** The model is on the Kotlin's OS-bond allowlist (R09, R11). */
  bondAllowed: boolean;
  battery: number | null;
  supportsBlePair: boolean;
  supportsIntervalTemp: boolean;
  bondRequested: boolean;
  /** `16 01` and `3a 03 01` replies (the seed the Kotlin persists when the person saved no settings). */
  hrPref: { enabled: boolean; intervalMinutes: number } | null;
  tempPref: boolean | null;
  /** The ring answered `1e` with `9e`: live heart rate runs on `69 01` for the rest of the connection. */
  realtimeRejected: boolean;
  /** Last bpm of a `69/01` stream, reported back in the `6a 01` stop. */
  lastManualBpm: number;
  /** Big-data transfer being reassembled (`ColmiDriver.bigDataBuffer`) and the interval-temperature slot offset. */
  bigData: number[] | null;
  intervalOffset: number;
  /** Local day of each stage's last completed walk on this connection (the Kotlin's `fullHistoryPulled`, per stage). */
  pulled: Partial<Record<Stage, number>>;
  inflight: Inflight | null;
}

export function initialColmiState(): ColmiState {
  return {
    nowMs: 0, tzOffsetS: 0, firmware: '', model: null, bondAllowed: false, battery: null, supportsBlePair: false, supportsIntervalTemp: false,
    bondRequested: false, hrPref: null, tempPref: null, realtimeRejected: false, lastManualBpm: 0, bigData: null, intervalOffset: 0, pulled: {},
    inflight: null,
  };
}

/** Cursor per stream: `c1:<local date of the sync>` once a stream's whole walk completed. The Kotlin keeps none. */
export const encodeCursor = (day: number): string => `c1:${isoDay(day)}`;
export function decodeCursor(s: string | undefined): string | null {
  const m = /^c1:(\d{4}-\d{2}-\d{2})$/.exec(s ?? '');
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------- params

const num = (cmd: RingCommand, k: string, d = 0): number => (typeof cmd.params?.[k] === 'number' ? (cmd.params[k] as number) : d);
const str = (cmd: RingCommand, k: string, d = ''): string => (typeof cmd.params?.[k] === 'string' ? (cmd.params[k] as string) : d);
const bool = (cmd: RingCommand, k: string, d: boolean): boolean => (typeof cmd.params?.[k] === 'boolean' ? (cmd.params[k] as boolean) : d);
const optNum = (cmd: RingCommand, k: string): number | undefined => (typeof cmd.params?.[k] === 'number' ? (cmd.params[k] as number) : undefined);

// ---------------------------------------------------------------- framing

const normal = (content: number[]): OutboundFrame => ({ bytes: frame16(content) });
/** `ColmiDriver.usesCommandChannel`: every big-data request (first byte `bc`) goes to the V2 command characteristic. */
const big = (bytes: Uint8Array): OutboundFrame => ({ bytes, channel: 'command' });

/** First request of a history stage (`requestActivity` / `requestHeartRate` / … / `requestTemperature`) for `daysAgo`. */
function stageRequest(stage: Stage, daysAgo: number, lastDay: number, st: ColmiState): RingCommand {
  const clock = { nowMs: st.nowMs, tzOffsetS: st.tzOffsetS };
  switch (stage) {
    case 'activity':
      return { op: 'syncActivity', params: { daysAgo } };
    case 'hr':
      return { op: 'syncHeartRate', params: { daysAgo, ...clock } };
    case 'stress':
      return { op: 'syncStress', params: { daysAgo } };
    case 'hrv':
      return { op: 'syncHrv', params: { daysAgo } };
    case 'spo2':
      return { op: 'bigDataSpo2' };
    case 'sleep':
      return { op: 'bigDataSleep' };
    case 'temperature':
      // The 0x3C reply's supportIntervalTemp bit picks the path, as in QRing; legacy asks for all days at once.
      return st.supportsIntervalTemp ? { op: 'bigDataIntervalTemperature', params: { daysAgo, packetIndex: 0 } } : { op: 'bigDataTemperature', params: { days: lastDay } };
  }
}

export function frameColmi(cmd: RingCommand, st: ColmiState): OutboundFrame[] {
  switch (cmd.op) {
    case 'identify':
      return []; // state only (see `begin`)
    case 'battery':
      return [normal(enc.battery())];
    case 'phoneName':
      return [normal(enc.phoneName())];
    case 'setTime':
      return [normal(enc.setDateTime(num(cmd, 'nowMs'), num(cmd, 'tzOffsetS'), str(cmd, 'language', 'en')))];
    case 'userPreferences':
      return [
        normal(
          enc.userPreferences({
            metric: typeof cmd.params?.metric === 'boolean' ? cmd.params.metric : undefined,
            sex: str(cmd, 'sex') || undefined,
            ageYears: optNum(cmd, 'ageYears'),
            heightCm: optNum(cmd, 'heightCm'),
            weightKg: optNum(cmd, 'weightKg'),
          }),
        ),
      ];
    case 'deviceSupport':
      return [normal(enc.deviceSupport())];
    case 'readPref':
      return [normal(enc.readPref(num(cmd, 'pref')))];
    case 'writePref':
      return [normal(enc.writePref(num(cmd, 'pref'), bool(cmd, 'enabled', true)))];
    case 'readTempPref':
      return [normal(enc.readTempPref())];
    case 'writeTempPref':
      return [normal(enc.writeTempPref(bool(cmd, 'enabled', true)))];
    case 'readGoals':
      return [normal(enc.readGoals())];
    case 'autoHeartRate':
      return [normal(enc.autoHeartRate(bool(cmd, 'enabled', true), num(cmd, 'intervalMinutes', 5)))];
    case 'realtimeHeartRate':
      return [normal(enc.realtimeHeartRate(bool(cmd, 'enable', true)))];
    case 'realtimeHeartRateContinue':
      return [normal(enc.realtimeHeartRateContinue())];
    case 'manualHeartRate':
      return [normal(bool(cmd, 'enable', true) ? enc.manualHeartRate() : enc.manualHeartRateStop(num(cmd, 'lastBpm', st.lastManualBpm)))];
    case 'manualHeartRateStop':
      return [normal(enc.manualHeartRateStop(num(cmd, 'lastBpm', st.lastManualBpm)))];
    case 'manualSpo2':
      return [normal(bool(cmd, 'enable', true) ? enc.manualSpo2() : enc.manualSpo2Stop())];
    case 'manualSpo2Stop':
      return [normal(enc.manualSpo2Stop())];
    case 'liveHrStart':
      // provenance: Gadgetbridge (AGPL) 0x1E request; 0x69 fallback from the decompiled vendor app, via the Kotlin
      // `startHeartRate`: a ring that refused 0x1E on this connection goes straight to the 0x69 stream.
      return [normal(st.realtimeRejected ? enc.manualHeartRate() : enc.realtimeHeartRate(true))];
    case 'liveHrStop':
      // `stopHeartRate`: the 0x69 stream stops with 6a carrying the last bpm; the 0x1E stream with 1e 02.
      return [normal(st.realtimeRejected ? enc.manualHeartRateStop(st.lastManualBpm) : enc.realtimeHeartRate(false))];
    case 'phoneSport':
      return [normal(enc.phoneSport(num(cmd, 'status', SPORT.START), sportType(str(cmd, 'activityType', 'other'))))];
    case 'findDevice':
      return [normal(enc.findDevice())];
    case 'powerOff':
      return [normal(enc.powerOff())];
    case 'factoryReset':
      return [normal(enc.factoryReset())];
    case 'syncActivity':
      return [normal(enc.syncActivity(num(cmd, 'daysAgo')))];
    case 'syncHeartRate':
      return [normal(enc.syncHeartRate(hrDayRequestUnix(num(cmd, 'nowMs', st.nowMs), num(cmd, 'tzOffsetS', st.tzOffsetS), num(cmd, 'daysAgo'))))];
    case 'syncStress':
      return [normal(enc.syncStress(num(cmd, 'daysAgo')))];
    case 'syncHrv':
      return [normal(enc.syncHrv(num(cmd, 'daysAgo')))];
    case 'bigDataSpo2':
      return [big(enc.bigDataSpo2())];
    case 'bigDataSleep':
    case 'sleepNow':
      return [big(enc.bigDataSleep())];
    case 'bigDataTemperature':
      return [big(enc.bigDataTemperature(num(cmd, 'days', 6)))];
    case 'bigDataIntervalTemperature':
      return [big(enc.bigDataIntervalTemperature(num(cmd, 'daysAgo'), num(cmd, 'packetIndex')))];
    case 'history': {
      const s = stageInfo(str(cmd, 'stage'));
      if (!s) throw new RangeError(`colmi: unknown history stage ${str(cmd, 'stage')}`);
      const at = { ...st, nowMs: num(cmd, 'nowMs', st.nowMs), tzOffsetS: num(cmd, 'tzOffsetS', st.tzOffsetS) };
      return frameColmi(stageRequest(s.stage, 0, historyLastDay(cmd, s, at), at), st);
    }
  }
  throw new RangeError(`colmi: unknown command ${cmd.op}`);
}

// ---------------------------------------------------------------- planner

/**
 * The Kotlin walk, one command per stage (`startHistorySync`). The cursor does not shorten it (the ring keeps about a
 * week and the Kotlin always reads it all); a stage already read in full on this connection carries `sinceDay`, the
 * local day of that walk, and `begin` turns it into the days back to it at the command's own clock (the plan is made
 * with the previous command's clock, which may be before midnight).
 */
export function planColmiSync(_cursor: Partial<Record<BioStream, string>>, state: ProtocolState): RingCommand[] {
  const st = state as ColmiState;
  return STAGES.map((s) => {
    const since = st.pulled?.[s.stage];
    return { op: 'history', params: { stage: s.stage, stream: s.stream, ...(since !== undefined ? { sinceDay: since } : { lastDay: s.depth }) } };
  });
}

/** Last day (days ago) a history command reads: back to `sinceDay` when given, else `lastDay`; within 0..depth. */
function historyLastDay(cmd: RingCommand, s: StageInfo, st: ColmiState): number {
  const since = optNum(cmd, 'sinceDay');
  const want = since !== undefined ? zoneDayIndex(st.nowMs, st) - since : num(cmd, 'lastDay', s.depth);
  return Math.max(0, Math.min(s.depth, want));
}

// ---------------------------------------------------------------- history bookkeeping

type History = Extract<Inflight, { kind: 'history' }>;

const watchdogFor = (stage: Stage): number => (stage === 'activity' ? ACTIVITY_WATCHDOG_MS : WATCHDOG_MS);

/** Fresh per-day bookkeeping (`resetStageMetadata` + `dayStart(daysAgo)`). */
function newDay(h: History, daysAgo: number, st: ColmiState): History {
  return { ...h, daysAgo, syncDay: zoneDayIndex(st.nowMs, st) - daysAgo, expected: null, slot: null, highest: -1, packets: 0, quietMs: 0, lastIntervalPacket: -1 };
}

/** The stage's walk completed: cursor for its stream, reads back to today from now on (`finishSync` sets `fullHistoryPulled`). */
function finishStage(st: ColmiState, h: History): IngestResult {
  const today = zoneDayIndex(st.nowMs, st);
  const value = encodeCursor(today);
  return { events: [{ type: 'status', key: 'cursor', value, stream: h.stream }], state: { ...st, inflight: null, pulled: { ...st.pulled, [h.stage]: today } }, done: true };
}

/** The read ended short (stall, or silence while packets were still expected): reported, no cursor, buffer dropped. */
function abortStage(st: ColmiState, h: History, reason: 'partial' | 'stall'): IngestResult {
  return { events: [{ type: 'status', key: 'error', value: `${reason}:${h.stream}`, stream: h.stream }], state: { ...st, inflight: null, bigData: null }, done: true };
}

/** A paged day ended (`advanceAfterPagedFrame`): ask for the next day, or finish the stage after the last one. */
function nextDay(st: ColmiState, h: History, events: RingEvent[]): IngestResult {
  if (h.daysAgo < h.lastDay) {
    const next = newDay(h, h.daysAgo + 1, st);
    return { events, state: { ...st, inflight: next }, send: [stageRequest(h.stage, next.daysAgo, h.lastDay, st)] };
  }
  const f = finishStage(st, h);
  return { ...f, events: [...events, ...f.events] };
}

/** `captureStageMetadata`: packet 0 gives count and cadence; packet 1 echoes the day (HR: u32 date, stress/HRV: offset). */
function captureMetadata(h: History, v: Uint8Array, st: ColmiState): History {
  if (!isValidFrame(v) || (v[0] !== OP.SYNC_HEART_RATE && v[0] !== OP.SYNC_STRESS && v[0] !== OP.SYNC_HRV)) return h;
  if (v[1] === 0) {
    const count = v[2]!;
    const slot = v[3]!;
    return { ...h, expected: count >= 2 && count <= 64 ? count : null, slot: slot >= 1 && slot <= 240 ? slot : null };
  }
  if (v[1] !== 1) return h;
  if (v[0] === OP.SYNC_HEART_RATE) {
    // The echo is the day as "local wall clock read as UTC"; trusted only within ±2 days of the requested day, so a
    // garbage ring clock (ff ff ff ff) cannot future-date samples.
    const echo = (v[2]! | (v[3]! << 8) | (v[4]! << 16)) + v[5]! * 0x1000000;
    if (echo > 0) {
      const candidate = Math.floor(echo / 86_400);
      if (Math.abs(candidate - h.syncDay) <= 2) return { ...h, syncDay: candidate };
    }
    return h;
  }
  const offset = v[2]!;
  return offset <= 29 ? { ...h, syncDay: zoneDayIndex(st.nowMs, st) - offset } : h;
}

/** `isTerminalPacket`: the day's last data packet. */
function isTerminal(v: Uint8Array, h: History): boolean {
  if (v.length < 7) return false;
  const packetNr = v[1]!;
  switch (v[0]) {
    case OP.SYNC_STRESS:
    case OP.SYNC_HRV:
      return packetNr >= 2 && packetNr === (h.expected ?? 5) - 1;
    case OP.SYNC_HEART_RATE:
      // A day whose packet 0 says count 2 never meets this (packet 1 is not terminal); see `moreExpected`.
      return (packetNr >= 2 && packetNr === (h.expected ?? -1) - 1) || packetNr === 23;
    case OP.SYNC_ACTIVITY:
      // The 0xF0 header packet never ends a day, even when its bytes 5/6 happen to fit.
      return packetNr !== 0xf0 && v[5] === v[6]! - 1;
    default:
      return false;
  }
}

/**
 * Whether the day or transfer in flight still expects packets. Paged HR/stress/HRV days know their count from packet 0
 * (stress/HRV fall back to 5, HR to "unknown"); activity days and big-data transfers end only on their own marker.
 */
function moreExpected(h: History, st: ColmiState): boolean {
  if (h.stage === 'hr' || h.stage === 'stress' || h.stage === 'hrv') {
    const expected = h.expected ?? (h.stage === 'hr' ? null : 5);
    return expected === null || h.highest < expected - 1;
  }
  if (h.stage === 'activity') return true;
  return st.bigData !== null || h.packets > 0;
}

// ---------------------------------------------------------------- ingest

const BIG_DATA_UUID = COLMI_UUIDS.bigData;

function mapEvents(decoded: ColmiDecoded[], st: ColmiState, receivedMs = st.nowMs): RingEvent[] {
  return toRingEvents(decoded, st.firmware, { ...st, nowMs: receivedMs });
}

/** Normal channel: history frames go to the walk, everything else to `decodeNormal` plus the engine's side effects. */
function ingestNormal(bytes: Uint8Array, state: ColmiState, receivedMs = state.nowMs): IngestResult {
  let st = state;
  const op = bytes[0];
  const h = st.inflight?.kind === 'history' ? st.inflight : null;
  if (isHistoryOpcode(op)) {
    const stageOp = h ? stageInfo(h.stage)?.opcode : undefined;
    if (!h || stageOp !== op) {
      // A history frame outside its stage: decoded on today's grid, it advances nothing.
      const today = zoneDayIndex(receivedMs, st);
      return { events: mapEvents(decodeHistory(bytes, { day: today, tz: st.tz, tzOffsetS: st.tzOffsetS, nowMs: receivedMs, slotMinutes: null }), st, receivedMs), state: st };
    }
    let cur = captureMetadata(h, bytes, st);
    const packetNr = bytes[1] ?? 0;
    const highest = op === OP.SYNC_ACTIVITY ? cur.highest : packetNr !== 0xff ? Math.max(cur.highest, packetNr) : cur.highest;
    cur = { ...cur, highest, packets: cur.packets + 1, quietMs: 0 };
    const events = mapEvents(decodeHistory(bytes, { day: cur.syncDay, tz: st.tz, tzOffsetS: st.tzOffsetS, nowMs: receivedMs, slotMinutes: cur.slot }), st, receivedMs);
    st = { ...st, inflight: cur };
    if (packetNr === 0xff || isTerminal(bytes, cur)) return nextDay(st, cur, events);
    return { events, state: st };
  }

  const decoded = decodeNormal(bytes, receivedMs);
  const events = mapEvents(decoded, st, receivedMs);
  let send: RingCommand[] | undefined;
  let done: boolean | undefined;

  if (op === OP.REALTIME_HEART_RATE_ERROR && isValidFrame(bytes)) {
    // `onRealtimeHeartRateRejected`: the first refusal moves the live stream onto 0x69 (UNVERIFIED that no live session
    // is running: the protocol cannot see one, and a 9e only ever answers a 1e start); later ones only keep the mark.
    if (!st.realtimeRejected && !h) send = [{ op: 'manualHeartRate', params: { enable: true } }];
    st = { ...st, realtimeRejected: true };
  } else {
    for (const d of decoded) {
      if (d.kotlin === 'Battery') st = { ...st, battery: d.percent };
      // `handle(event)`: the last bpm of the 0x69 heart-rate stream, for the 6a stop.
      if (d.kotlin === 'HeartRateSample' && op === OP.MANUAL_HEART_RATE && bytes[1] === RT_HEART_RATE) st = { ...st, lastManualBpm: d.bpm };
    }
    // A measurement that ends on the ring's word (error byte, not worn) ends a spot or live stream; never a history read.
    if (!st.inflight && decoded.some((d) => d.kotlin === 'HeartRateComplete' || d.kotlin === 'Spo2Complete')) done = true;
  }

  const support = decodeDeviceSupport(bytes);
  if (support) {
    st = { ...st, supportsBlePair: support.supportsBlePair, supportsIntervalTemp: support.supportsIntervalTemp };
    const caps = [support.supportsBlePair ? 'ble_pair' : '', support.supportsIntervalTemp ? 'interval_temp' : ''].filter(Boolean).join(',');
    events.push({ type: 'status', key: 'capabilities', value: caps });
    // The vendor app bonds every ring with the bit; the Kotlin only the models on its allowlist (the R10 sets it too
    // and must not get the pairing dialog). The platform adapter owns the bond call.
    if (support.supportsBlePair && st.bondAllowed) {
      st = { ...st, bondRequested: true };
      events.push({ type: 'status', key: 'bond_requested', value: st.model ?? '' });
    }
  }
  const hrPref = decodeAutoHrPrefRead(bytes);
  if (hrPref) st = { ...st, hrPref };
  const tempPref = decodeTempPrefRead(bytes);
  if (tempPref !== null) st = { ...st, tempPref };

  // The reply the handshake waits for.
  const r = st.inflight;
  if (r?.kind === 'reply' && isValidFrame(bytes) && op === r.opcode && (r.sub === undefined || bytes[r.opcode === OP.AUTO_TEMP_PREF ? 2 : 1] === r.sub)) {
    st = { ...st, inflight: null };
    done = true;
  }
  return { events, state: st, ...(send ? { send } : {}), ...(done ? { done } : {}) };
}

/** Big-data channel (`ColmiDriver.ingestBigData` + `completeAndDecode` + `handleBigDataComplete`). */
function ingestBig(bytes: Uint8Array, state: ColmiState, receivedMs = state.nowMs): IngestResult {
  let st = state;
  const h = st.inflight?.kind === 'history' ? st.inflight : null;
  if (h) st = { ...st, inflight: { ...h, packets: h.packets + 1, quietMs: 0 } };
  else if (st.inflight?.kind === 'sleepOnly') st = { ...st, inflight: { ...st.inflight, packets: st.inflight.packets + 1, quietMs: 0 } };

  // Idle buffer: only a chunk that starts with bc and holds a header opens a transfer. Mid-transfer EVERY chunk is
  // appended, even one starting with bc (ATT chunk boundaries are arbitrary).
  let buffer: number[];
  if (st.bigData === null) {
    if (bytes.length < 6 || bytes[0] !== OP.BIG_DATA_V2) return { events: [], state: st };
    buffer = Array.from(bytes);
  } else {
    buffer = [...st.bigData, ...bytes];
  }
  const expectedLength = (buffer[2] ?? 0) | ((buffer[3] ?? 0) << 8);
  if (buffer.length < expectedLength + 6) return { events: [], state: { ...st, bigData: buffer } };
  st = { ...st, bigData: null };
  const frame = Uint8Array.from(buffer);
  const type = frame[1]!;
  const ctx = { nowMs: h || st.inflight?.kind === 'sleepOnly' ? st.nowMs : receivedMs, tz: st.tz, tzOffsetS: st.tzOffsetS };

  let decoded: ColmiDecoded[];
  if (type === BIG.INTERVAL_TEMPERATURE) {
    // Slot position is cumulative across a day's packets; packet 0 restarts it.
    const packetIndex = frame.length > 9 ? frame[9]! : 0;
    const offset = packetIndex === 0 ? 0 : st.intervalOffset;
    decoded = decodeIntervalTemperature(frame, offset, ctx);
    st = { ...st, intervalOffset: offset + Math.floor(Math.max(0, frame.length - 10) / 2) };
  } else {
    decoded = decodeBigData(frame, ctx);
  }
  const events = mapEvents(decoded, st, receivedMs);
  return handleBigDataComplete(type, frame, st, events);
}

/** `handleBigDataComplete`: only the stage a completion belongs to advances; strays and naps (0x3e) never do. */
function handleBigDataComplete(type: number, frame: Uint8Array, st: ColmiState, events: RingEvent[]): IngestResult {
  const fl = st.inflight;
  if (fl?.kind === 'sleepOnly') {
    return type === BIG.SLEEP ? { events, state: { ...st, inflight: null }, done: true } : { events, state: st };
  }
  if (fl?.kind !== 'history') return { events, state: st };
  const h = fl;
  if ((type === BIG.SPO2 && h.stage === 'spo2') || (type === BIG.SLEEP && h.stage === 'sleep') || (type === BIG.TEMPERATURE && h.stage === 'temperature')) {
    const f = finishStage(st, h);
    return { ...f, events: [...events, ...f.events] };
  }
  // provenance: decompiled vendor app (interval-temperature paging, action 0x77), via the Kotlin
  if (type === BIG.INTERVAL_TEMPERATURE && h.stage === 'temperature') {
    const packetCount = frame[8] ?? 0;
    const packetIndex = frame[9] ?? 0;
    // Progress guard: page a day only while the index strictly advances, so a ring repeating a packet cannot loop us.
    const advanced = packetIndex > h.lastIntervalPacket;
    const cur: History = { ...h, lastIntervalPacket: packetIndex, packets: 0 };
    if (advanced && packetCount > 0 && packetIndex < packetCount - 1) {
      return { events, state: { ...st, inflight: cur }, send: [{ op: 'bigDataIntervalTemperature', params: { daysAgo: h.daysAgo, packetIndex: packetIndex + 1 } }] };
    }
    return nextDay(st, cur, events);
  }
  return { events, state: st };
}

// ---------------------------------------------------------------- protocol

/** Replies the handshake waits for: opcode, and the sub-byte that tells a read reply from a write ack. */
const REPLIES: Record<string, { opcode: number; sub?: number }> = {
  battery: { opcode: OP.BATTERY },
  deviceSupport: { opcode: OP.DEVICE_SUPPORT },
  readTempPref: { opcode: OP.AUTO_TEMP_PREF, sub: 0x01 },
};

export function createColmiProtocol(): Protocol {
  return {
    initialState: initialColmiState,

    frame: (cmd, state) => frameColmi(cmd, state as ColmiState),

    planSync: planColmiSync,

    begin(cmd, state): CommandPlan {
      const prev = state as ColmiState;
      // Every command starts with nothing in flight unless it sets its own: a history read left over from an aborted
      // sync must not gate a later spot or live run (the HeartRateComplete end and the 69 01 fallback check it).
      const st: ColmiState = { ...prev, nowMs: num(cmd, 'nowMs', prev.nowMs), tz: str(cmd, 'tz') || prev.tz, tzOffsetS: num(cmd, 'tzOffsetS', prev.tzOffsetS), inflight: null };
      if (cmd.op === 'identify') {
        return { state: { ...st, firmware: str(cmd, 'firmware', st.firmware), model: str(cmd, 'model') || st.model, bondAllowed: bool(cmd, 'bond', st.bondAllowed) }, expectReply: false };
      }
      // `16 01` is the only pref read whose reply is decoded; 36/2c/38/21 replies are never consumed by the Kotlin.
      const reply = cmd.op === 'readPref' ? (num(cmd, 'pref') === OP.AUTO_HR_PREF ? { opcode: OP.AUTO_HR_PREF, sub: 0x01 } : undefined) : REPLIES[cmd.op];
      if (reply) return { state: { ...st, inflight: { kind: 'reply', ...reply } }, expectReply: true, stallMs: REPLY_MS };
      if (cmd.op === 'history') {
        const s = stageInfo(str(cmd, 'stage'));
        if (!s) throw new RangeError(`colmi: unknown history stage ${str(cmd, 'stage')}`);
        const lastDay = historyLastDay(cmd, s, st);
        const base: History = {
          kind: 'history', stage: s.stage, stream: s.stream, daysAgo: 0, lastDay, syncDay: 0, expected: null, slot: null, highest: -1, packets: 0, quietMs: 0, lastIntervalPacket: -1,
        };
        const watchdog = watchdogFor(s.stage);
        // A new walk drops any stale half transfer (the Kotlin never did; a leftover buffer would swallow the next reply).
        return { state: { ...st, bigData: null, inflight: newDay(base, 0, st) }, expectReply: true, quietMs: watchdog, stallMs: watchdog };
      }
      if (cmd.op === 'sleepNow') {
        return { state: { ...st, bigData: null, inflight: { kind: 'sleepOnly', packets: 0, quietMs: 0 } }, expectReply: true, quietMs: WATCHDOG_MS, stallMs: WATCHDOG_MS };
      }
      return { state: st, expectReply: false };
    },

    ingest(bytes, state, channel?: Uuid, receivedMs?: number): IngestResult {
      const st = state as ColmiState;
      if (channel !== undefined && normalizeUuid(channel) === BIG_DATA_UUID) return ingestBig(bytes, st, receivedMs);
      return ingestNormal(bytes, st, receivedMs);
    },

    timeout(state, kind): IngestResult {
      const st = state as ColmiState;
      const fl = st.inflight;
      if (!fl) return { events: [], state: st, done: true };
      if (fl.kind === 'reply') {
        // The Kotlin never waits for these; a ring that does not answer is not an error for the handshake.
        return { events: [{ type: 'status', key: 'error', value: `timeout:0x${fl.opcode.toString(16)}` }], state: { ...st, inflight: null }, done: true };
      }
      if (fl.kind === 'sleepOnly') {
        if (kind === 'quiet' && fl.packets > 0 && st.bigData !== null) {
          const quietMs = fl.quietMs + WATCHDOG_MS;
          if (quietMs < SILENCE_MAX_MS) return { events: [], state: { ...st, inflight: { ...fl, quietMs } }, done: false };
          return { events: [{ type: 'status', key: 'error', value: 'partial:sleep_stage', stream: 'sleep_stage' }], state: { ...st, inflight: null, bigData: null }, done: true };
        }
        // `syncSleepNow`'s 10 s timer: the request is dropped quietly.
        return { events: [], state: { ...st, inflight: null, bigData: null }, done: true };
      }
      const h = fl;
      // Nothing of this request arrived (a stray frame may have started the quiet timer): the Kotlin watchdog skips the
      // rest of the stage.
      if (kind === 'stall' || h.packets === 0) return abortStage(st, h, 'stall');
      if (moreExpected(h, st)) {
        const quietMs = h.quietMs + watchdogFor(h.stage);
        if (quietMs < SILENCE_MAX_MS) return { events: [], state: { ...st, inflight: { ...h, quietMs } }, done: false };
        return abortStage(st, h, 'partial');
      }
      // Every packet the day announced is in but the Kotlin's terminal rule never fired (an HR day of count 2): the day
      // is complete, go on with the next one. The Kotlin's watchdog skipped the rest of the stage here.
      return nextDay(st, h, []);
    },

    redactOutbound: (frame) => frame,
  };
}

export const colmiProtocol: Protocol = createColmiProtocol();
