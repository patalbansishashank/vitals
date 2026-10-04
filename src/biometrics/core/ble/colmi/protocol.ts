/**
 * Colmi R02 family (R02/R03/R06/R10 …, QRing firmware, "RF03" SoC) `BleProtocol`. Tier P.
 *
 * Rebuilt ONLY from MIT-licensed sources (see src/biometrics/LICENSES.md):
 *  [T] tahnok/colmi_r02_client, MIT, (c) 2024 Wesley Ellis, https://github.com/tahnok/colmi_r02_client
 *      (main @ 19e70aa, accessed 2026-10-01): packet.py, battery.py, set_time.py, hr.py, steps.py, hr_settings.py, real_time.py
 *      and their tests (vectors reused in __tests__).
 *  [S] servolok84/smart-ring-dashboard docs/protocol.md, MIT, (c) 2026 Smart Ring Dashboard contributors (accessed
 *      2026-10-01): confirms the same V1 commands. Its "V2 big data" sleep/SpO2 section cites Gadgetbridge (AGPL) as a
 *      source, so it is deliberately NOT implemented here (gap: Colmi sleep stages and SpO2 history).
 * Gadgetbridge code was not consulted. Puxtril/colmi-docs has no licence and was not used.
 *
 * Clock convention [T set_time.py]: the ring clock is set to UTC, so HR-log day stamps and step buckets are UTC.
 */
import type { BioStream } from '../../types';
import type { BleProtocol, CommandPlan, IngestResult, ProtocolState, RingCommand, RingDecodedEvent } from '../types';

export const COLMI_UUIDS = {
  service: '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e',
  write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  /** Standard Device Information service / firmware revision characteristic [T client.py]. */
  deviceInfo: '0000180a-0000-1000-8000-00805f9b34fb',
  firmwareRevision: '00002a26-0000-1000-8000-00805f9b34fb',
} as const;

export const COLMI_CMD = {
  SET_TIME: 0x01,
  BATTERY: 0x03,
  READ_HEART_RATE: 0x15,
  HEART_RATE_LOG_SETTINGS: 0x16,
  GET_STEP_SOMEDAY: 0x43,
  START_REAL_TIME: 0x69,
  STOP_REAL_TIME: 0x6a,
} as const;

/** [T real_time.py] reading kinds that are plausible on this hardware: 1 heart rate, 3 SpO2. */
export const REALTIME_KIND = { HEART_RATE: 1, SPO2: 3 } as const;
export const REALTIME_ACTION = { START: 1, PAUSE: 2, CONTINUE: 3, STOP: 4 } as const;

/** Days read per stream per open (PROPOSED engineering cap; the sources document no history depth). */
export const MAX_DAYS = 7;
export const REPLY_MS = 2_000; // [T client.py] waits 2 s for replies
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- framing

/** [T packet.py] checksum = sum of bytes & 0xFF over the first 15 bytes. */
export function colmiChecksum(p: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < 15 && i < p.length; i++) s += p[i] ?? 0;
  return s & 0xff;
}

/** [T packet.py] `make_packet`: command byte, up to 14 sub-data bytes, checksum at byte 15. */
export function makePacket(command: number, sub: ArrayLike<number> = []): Uint8Array {
  if (!Number.isInteger(command) || command < 0 || command > 255) throw new RangeError('Invalid command, must be between 0 and 255');
  if (sub.length > 14) throw new RangeError('Sub data must be less than 14 bytes');
  const p = new Uint8Array(16);
  p[0] = command;
  for (let i = 0; i < sub.length; i++) p[i + 1] = (sub[i] ?? 0) & 0xff;
  p[15] = colmiChecksum(p);
  return p;
}

export function byteToBcd(b: number): number {
  if (!Number.isInteger(b) || b < 0 || b >= 100) throw new RangeError('bcd value must be 0..99');
  return (Math.floor(b / 10) << 4) | b % 10;
}
export const bcdToDecimal = (b: number): number => ((b >> 4) & 15) * 10 + (b & 15);

/** [T set_time.py] UTC BCD `yy mm dd hh mm ss`, then language 1 (English). */
export function setTimePacket(epochMs: number): Uint8Array {
  const d = new Date(epochMs);
  if (d.getUTCFullYear() < 2000) throw new RangeError('year must be >= 2000');
  return makePacket(COLMI_CMD.SET_TIME, [
    byteToBcd(d.getUTCFullYear() % 2000), byteToBcd(d.getUTCMonth() + 1), byteToBcd(d.getUTCDate()),
    byteToBcd(d.getUTCHours()), byteToBcd(d.getUTCMinutes()), byteToBcd(d.getUTCSeconds()), 1,
  ]);
}

export const batteryPacket = (): Uint8Array => makePacket(COLMI_CMD.BATTERY);

/** [T hr.py] u32 LE epoch seconds of the (UTC) midnight of the day of interest. */
export function readHeartRatePacket(dayStartEpochS: number): Uint8Array {
  const v = dayStartEpochS >>> 0;
  return makePacket(COLMI_CMD.READ_HEART_RATE, [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

/** [T steps.py] day offset from the ring's "today", then 0x0f 0x00 0x5f 0x01 (constants not understood upstream). */
export const readStepsPacket = (dayOffset = 0): Uint8Array => makePacket(COLMI_CMD.GET_STEP_SOMEDAY, [dayOffset, 0x0f, 0x00, 0x5f, 0x01]);

/** [T hr_settings.py] read: `01`; write: `02, enabled(1)/disabled(2), interval minutes`. */
export const readHrLogSettingsPacket = (): Uint8Array => makePacket(COLMI_CMD.HEART_RATE_LOG_SETTINGS, [0x01]);
export function writeHrLogSettingsPacket(enabled: boolean, intervalMin: number): Uint8Array {
  if (!(intervalMin > 0 && intervalMin < 256)) throw new RangeError('Interval must be between 0 and 255');
  return makePacket(COLMI_CMD.HEART_RATE_LOG_SETTINGS, [2, enabled ? 1 : 2, intervalMin]);
}

export const realtimeStartPacket = (kind: number): Uint8Array => makePacket(COLMI_CMD.START_REAL_TIME, [kind, REALTIME_ACTION.START]);
export const realtimeContinuePacket = (kind: number): Uint8Array => makePacket(COLMI_CMD.START_REAL_TIME, [kind, REALTIME_ACTION.CONTINUE]);
export const realtimeStopPacket = (kind: number): Uint8Array => makePacket(COLMI_CMD.STOP_REAL_TIME, [kind, 0, 0]);

// ---------------------------------------------------------------- state

interface HrParser { size: number; range: number; ts: number | null; raw: number[]; index: number }
interface StepParser { newCalorieProtocol: boolean; index: number }
type Inflight =
  | { kind: 'reply'; opcode: number }
  | { kind: 'hr'; days: string[]; i: number; p: HrParser; blocked?: boolean }
  | { kind: 'steps'; days: string[]; i: number; p: StepParser; blocked?: boolean };

export interface ColmiState extends ProtocolState {
  nowMs: number;
  battery: number | null;
  charging: boolean | null;
  hrLog: { enabled: boolean; intervalMin: number } | null;
  inflight: Inflight | null;
  cursors: Partial<Record<BioStream, string>>;
}

const freshHr = (): HrParser => ({ size: 0, range: 5, ts: null, raw: [], index: 0 });
const freshSteps = (): StepParser => ({ newCalorieProtocol: false, index: 0 });

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayStartMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Cursor `c1:YYYY-MM-DD` = last UTC day read after it had ended. */
export function decodeColmiCursor(s: string | undefined): string | null {
  const m = /^c1:(\d{4}-\d{2}-\d{2})$/.exec(s ?? '');
  return m ? m[1]! : null;
}

/** UTC days to read: the day after the cursor (at most MAX_DAYS back) up to today. Today is always re-read. */
export function daysToRead(since: string | null, nowMs: number): string[] {
  const today = dayStartMs(isoDay(nowMs));
  const first = Math.max(today - (MAX_DAYS - 1) * DAY_MS, since ? dayStartMs(since) + DAY_MS : -Infinity);
  const out: string[] = [];
  for (let t = Math.min(first, today); t <= today; t += DAY_MS) out.push(isoDay(t));
  return out;
}

// ---------------------------------------------------------------- decoders

/** [T battery.py] byte 1 = level %, byte 2 = charging. */
export const parseBattery = (p: Uint8Array): { level: number; charging: boolean } => ({ level: p[1] ?? 0, charging: (p[2] ?? 0) !== 0 });

/** [T hr_settings.py] byte 2: 1 enabled, 2 disabled (anything else → disabled); byte 3 interval minutes. */
export const parseHrLogSettings = (p: Uint8Array): { enabled: boolean; intervalMin: number } => ({ enabled: p[2] === 1, intervalMin: p[3] ?? 0 });

/** [T real_time.py] byte 1 kind, byte 2 error code, byte 3 value. */
export const parseRealtime = (p: Uint8Array): { kind: number; error: number; value: number } => ({ kind: p[1] ?? 0, error: p[2] ?? 0, value: p[3] ?? 0 });

/** [T hr.py] `HeartRateLog.heart_rates`: pad/trim to 288 five-minute slots. Returns null while incomplete. */
export function hrParse(p: HrParser, pkt: Uint8Array, todayMs: number): { p: HrParser; result?: { ts: number; range: number; rates: number[] } | 'nodata' } {
  const sub = pkt[1] ?? 0;
  const isToday = p.ts !== null && dayStartMs(isoDay(p.ts)) === todayMs;
  const finish = (q: HrParser) => {
    const rates = q.raw.slice(0, 288);
    while (rates.length < 288) rates.push(0);
    return { p: freshHr(), result: { ts: q.ts ?? 0, range: q.range, rates } };
  };
  if (sub === 255) return { p: freshHr(), result: 'nodata' };
  if (isToday && sub === 23) return finish(p);
  if (sub === 0) return { p: { ...freshHr(), size: pkt[2] ?? 0, range: pkt[3] ?? 5, raw: new Array<number>((pkt[2] ?? 0) * 13).fill(-1) } };
  const raw = p.raw.slice();
  if (sub === 1) {
    const ts = ((pkt[2] ?? 0) | ((pkt[3] ?? 0) << 8) | ((pkt[4] ?? 0) << 16) | ((pkt[5] ?? 0) << 24)) * 1000; // signed LE32, s
    raw.splice(0, 9, ...Array.from(pkt.subarray(6, 15)));
    return { p: { ...p, ts, raw, index: p.index + 9 } };
  }
  raw.splice(p.index, 13, ...Array.from(pkt.subarray(2, 15)));
  const q = { ...p, raw, index: p.index + 13 };
  return sub === p.size - 1 ? finish(q) : { p: q };
}

export interface SportDetail { year: number; month: number; day: number; timeIndex: number; calories: number; steps: number; distanceM: number }

/** [T steps.py] `SportDetailParser.parse` for one packet. Done when byte 5 == byte 6 − 1. */
export function stepsParse(p: StepParser, pkt: Uint8Array): { p: StepParser; detail?: SportDetail; done?: boolean; nodata?: boolean } {
  if (p.index === 0 && pkt[1] === 255) return { p: freshSteps(), nodata: true, done: true };
  if (p.index === 0 && pkt[1] === 240) return { p: { newCalorieProtocol: pkt[3] === 1, index: 1 } };
  let calories = (pkt[7] ?? 0) | ((pkt[8] ?? 0) << 8);
  if (p.newCalorieProtocol) calories *= 10;
  const detail: SportDetail = {
    year: bcdToDecimal(pkt[1] ?? 0) + 2000, month: bcdToDecimal(pkt[2] ?? 0), day: bcdToDecimal(pkt[3] ?? 0), timeIndex: pkt[4] ?? 0,
    calories, steps: (pkt[9] ?? 0) | ((pkt[10] ?? 0) << 8), distanceM: (pkt[11] ?? 0) | ((pkt[12] ?? 0) << 8),
  };
  const done = pkt[5] === (pkt[6] ?? 0) - 1;
  return { p: done ? freshSteps() : { ...p, index: p.index + 1 }, detail, done };
}

/** 15-minute slot start, UTC [T steps.py `SportDetail.timestamp`]. */
export const sportDetailStart = (d: SportDetail): number => Date.UTC(d.year, d.month - 1, d.day, Math.floor(d.timeIndex / 4), (d.timeIndex % 4) * 15);

// ---------------------------------------------------------------- protocol

const num = (c: RingCommand, k: string, d = 0): number => (typeof c.params?.[k] === 'number' ? (c.params[k] as number) : d);
const str = (c: RingCommand, k: string): string => (typeof c.params?.[k] === 'string' ? (c.params[k] as string) : '');

export function frameColmi(cmd: RingCommand): Uint8Array[] {
  const now = num(cmd, 'nowMs');
  switch (cmd.op) {
    case 'setTime':
      return [setTimePacket(now)];
    case 'battery':
      return [batteryPacket()];
    case 'hrLogSettings':
      return [readHrLogSettingsPacket()];
    case 'setHrLog':
      return [writeHrLogSettingsPacket(cmd.params?.enabled !== false, num(cmd, 'intervalMin', 5))];
    case 'hrLog': {
      const day = cmd.params?.day !== undefined ? str(cmd, 'day') : daysToRead(decodeColmiCursor(str(cmd, 'since')), now)[0]!;
      return [readHeartRatePacket(dayStartMs(day) / 1000)];
    }
    case 'steps': {
      const day = cmd.params?.day !== undefined ? str(cmd, 'day') : daysToRead(decodeColmiCursor(str(cmd, 'since')), now)[0]!;
      return [readStepsPacket(Math.round((dayStartMs(isoDay(now)) - dayStartMs(day)) / DAY_MS))];
    }
    case 'realtimeStart':
      return [realtimeStartPacket(num(cmd, 'kind', REALTIME_KIND.HEART_RATE))];
    case 'realtimeContinue':
      return [realtimeContinuePacket(num(cmd, 'kind', REALTIME_KIND.HEART_RATE))];
    case 'realtimeStop':
      return [realtimeStopPacket(num(cmd, 'kind', REALTIME_KIND.HEART_RATE))];
  }
  throw new RangeError(`colmi: unknown command ${cmd.op}`);
}

const REPLY_OPS: Record<string, number> = {
  setTime: COLMI_CMD.SET_TIME, battery: COLMI_CMD.BATTERY, hrLogSettings: COLMI_CMD.HEART_RATE_LOG_SETTINGS, setHrLog: COLMI_CMD.HEART_RATE_LOG_SETTINGS,
};

/** Day finished: advance the cursor if the day has ended, then request the next day or finish. */
function nextDay(st: ColmiState, stream: 'hr' | 'steps', events: RingDecodedEvent[]): IngestResult {
  const h = st.inflight as Extract<Inflight, { kind: 'hr' | 'steps' }>;
  const day = h.days[h.i]!;
  let cursors = st.cursors;
  // A day that timed out earlier in this read blocks the cursor, so it is retried next open.
  if (!h.blocked && dayStartMs(day) < dayStartMs(isoDay(st.nowMs))) {
    const prev = decodeColmiCursor(st.cursors[stream]);
    if (!prev || prev < day) {
      cursors = { ...cursors, [stream]: `c1:${day}` };
      events.push({ type: 'status', key: 'cursor', value: `c1:${day}`, stream });
    }
  }
  const i = h.i + 1;
  if (i >= h.days.length) return { events, state: { ...st, cursors, inflight: null }, done: true };
  const inflight = h.kind === 'hr' ? { ...h, i, p: freshHr() } : { ...h, i, p: freshSteps() };
  return { events, state: { ...st, cursors, inflight }, send: [{ op: stream === 'hr' ? 'hrLog' : 'steps', params: { day: h.days[i]!, nowMs: st.nowMs } }] };
}

export function createColmiProtocol(): BleProtocol {
  return {
    initialState: (): ColmiState => ({ nowMs: 0, battery: null, charging: null, hrLog: null, inflight: null, cursors: {} }),
    frame: frameColmi,
    planSync: (cursor) => [
      { op: 'hrLog', params: { stream: 'hr', since: cursor.hr ?? '' } },
      { op: 'steps', params: { stream: 'steps', since: cursor.steps ?? '' } },
    ],

    begin(cmd, state): CommandPlan {
      const st = { ...(state as ColmiState), nowMs: num(cmd, 'nowMs', (state as ColmiState).nowMs) };
      const reply = REPLY_OPS[cmd.op];
      if (reply !== undefined) return { state: { ...st, inflight: { kind: 'reply', opcode: reply } }, expectReply: true, stallMs: REPLY_MS };
      if (cmd.op === 'hrLog' || cmd.op === 'steps') {
        const stream = cmd.op === 'hrLog' ? 'hr' : 'steps';
        const since = str(cmd, 'since');
        const cursors = since && st.cursors[stream] === undefined ? { ...st.cursors, [stream]: since } : st.cursors;
        const days = daysToRead(decodeColmiCursor(since), st.nowMs);
        const inflight: Inflight = cmd.op === 'hrLog' ? { kind: 'hr', days, i: 0, p: freshHr() } : { kind: 'steps', days, i: 0, p: freshSteps() };
        return { state: { ...st, cursors, inflight }, expectReply: true, stallMs: REPLY_MS };
      }
      return { state: st, expectReply: false };
    },

    ingest(bytes, state): IngestResult {
      let st = state as ColmiState;
      const op = bytes[0] ?? 0;
      const events: RingDecodedEvent[] = [];
      if (op >= 127) return { events: [{ type: 'status', key: 'error', value: `error_bit:0x${op.toString(16)}` }], state: st }; // [T client.py]
      if (op === COLMI_CMD.BATTERY) {
        const b = parseBattery(bytes);
        st = { ...st, battery: b.level, charging: b.charging };
        events.push({ type: 'status', key: 'battery', value: b.level });
      } else if (op === COLMI_CMD.HEART_RATE_LOG_SETTINGS) {
        const s = parseHrLogSettings(bytes);
        st = { ...st, hrLog: s };
        events.push({ type: 'status', key: 'ack', value: `hr_log:${s.enabled ? 'on' : 'off'}:${s.intervalMin}` });
      } else if (op === COLMI_CMD.SET_TIME) {
        events.push({ type: 'status', key: 'clock_offset_s', value: 0 }, { type: 'status', key: 'ack', value: 'set_time' });
      } else if (op === COLMI_CMD.START_REAL_TIME) {
        const r = parseRealtime(bytes);
        if (r.error === 0 && r.value > 0 && (r.kind === REALTIME_KIND.HEART_RATE || r.kind === REALTIME_KIND.SPO2)) {
          const hr = r.kind === REALTIME_KIND.HEART_RATE;
          events.push({ type: 'sample', stream: hr ? 'hr' : 'spo2', t: st.nowMs, value: r.value, unit: hr ? 'bpm' : 'pct', origin: 'spot' });
        } else if (r.error !== 0) events.push({ type: 'status', key: 'error', value: `realtime:${r.kind}:${r.error}` });
      }
      const h = st.inflight;
      if (!h) return { events, state: st };
      if (h.kind === 'reply') return op === h.opcode ? { events, state: { ...st, inflight: null }, done: true } : { events, state: st };
      if (h.kind === 'hr' && op === COLMI_CMD.READ_HEART_RATE) {
        const r = hrParse(h.p, bytes, dayStartMs(isoDay(st.nowMs)));
        st = { ...st, inflight: { ...h, p: r.p } };
        if (!r.result) return { events, state: st };
        if (r.result !== 'nodata') {
          // [T hr.py] 288 slots at 5-minute steps from the day's midnight; 0 = no reading; slots after "now" are dropped.
          const day0 = dayStartMs(isoDay(r.result.ts));
          r.result.rates.forEach((v, i) => {
            const t = day0 + i * 300_000;
            if (v > 0 && t <= st.nowMs) events.push({ type: 'sample', stream: 'hr', t, value: v, unit: 'bpm', origin: 'history' });
          });
        }
        return nextDay(st, 'hr', events);
      }
      if (h.kind === 'steps' && op === COLMI_CMD.GET_STEP_SOMEDAY) {
        const r = stepsParse(h.p, bytes);
        st = { ...st, inflight: { ...h, p: r.p } };
        if (r.detail) {
          const start = sportDetailStart(r.detail);
          events.push({ type: 'activityBucket', start, durS: 900, steps: r.detail.steps, distanceM: r.detail.distanceM });
          // Unit undocumented: [T] calls it calories (×10 on the new protocol), [S] "small cal". Kept vendor-namespaced.
          events.push({ type: 'vendor', key: 'colmi_calories_raw', t: start, value: r.detail.calories, unit: 'cal' });
        }
        return r.done ? nextDay(st, 'steps', events) : { events, state: st };
      }
      return { events, state: st };
    },

    timeout(state): IngestResult {
      const st = state as ColmiState;
      const h = st.inflight;
      if (!h) return { events: [], state: st, done: true };
      const ev: RingDecodedEvent = { type: 'status', key: 'error', value: `timeout:${h.kind === 'reply' ? `0x${h.opcode.toString(16)}` : h.kind}` };
      // A day that never answered does not advance the cursor; skip to the next day.
      if (h.kind === 'reply') return { events: [ev], state: { ...st, inflight: null }, done: true };
      const i = h.i + 1;
      if (i >= h.days.length) return { events: [ev], state: { ...st, inflight: null }, done: true };
      const inflight = h.kind === 'hr' ? { ...h, i, p: freshHr(), blocked: true } : { ...h, i, p: freshSteps(), blocked: true };
      return { events: [ev], state: { ...st, inflight }, send: [{ op: h.kind === 'hr' ? 'hrLog' : 'steps', params: { day: h.days[i]!, nowMs: st.nowMs } }] };
    },
  };
}
