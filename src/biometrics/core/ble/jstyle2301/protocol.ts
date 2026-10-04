/**
 * J-Style 2301 `BleProtocol`: framing, ingest state machine (port of `JStyle2301HistorySync` paging) and the sync planner.
 * Tier P: no timers here; the session runs the 1.2 s settle / 4 s stall timers and calls `timeout`.
 *
 * Paging (R10 §4.3): a page is 50 notifications; mode-2 continuations follow up to `pageLimit` pages; a stream ends on a
 * terminal `[…, opcode, 0xFF]`, on the settle timer or on the stall timer.
 * Planner (R10 §4.4): V0525 drops the GATT link after about 3 minutes, so every open reads ONE page per opcode (mode 0, the
 * newest page) and streams are ordered least-recently-refreshed first. If the link drops mid-sync, the next open resumes
 * with the streams that were not reached. Mode-2 continuation across connections is NOT attempted: whether the ring keeps
 * its read cursor between connections is unverified.
 */
import type { BioStream } from '../../types';
import type { BleProtocol, CommandPlan, IngestResult, ProtocolState, RingCommand, RingDecodedEvent } from '../types';
import {
  HISTORY_CATALOG, OP, authenticationRequest, command, heartRateMeasurement, historyStreamForOpcode, infoRequest, isTerminal,
  prepareRealtimeMeasurement, sportMode,
} from './commands';
import { decodePacket } from './decoder';
import { firmwareProfile } from './firmware';

/** `JStyle2301HistorySync` constants. */
export const PACKETS_PER_PAGE = 50;
export const MAX_PAGES = 20;
export const SETTLE_MS = 1_200;
export const STALL_MS = 4_000;
/** Reply wait for info/auth commands (engineering value; Kotlin has no explicit timeout for them). */
export const REPLY_MS = 4_000;
/** History timestamps this far ahead of the phone clock are reported as clock drift (PROPOSED engineering margin). */
export const DRIFT_REPORT_S = 120;

type Inflight =
  | { kind: 'reply'; opcode: number }
  | { kind: 'history'; opcode: number; stream: BioStream; page: number; packets: number; pageLimit: number; seq: number; newestMs: number | null; aheadMs: number };

export interface J2301State extends ProtocolState {
  firmware: string | null;
  auth: 'none' | 'pending' | 'accepted' | 'rejected';
  battery: number | null;
  tzOffsetS: number;
  nowMs: number;
  inflight: Inflight | null;
  /** Latest cursor string per Vitals stream (merged across the opcodes that feed it). */
  cursors: Partial<Record<BioStream, string>>;
}

// ---------------------------------------------------------------- cursor codec

export interface OpcodeCursor {
  /** Refresh round in which this opcode was last read (higher = more recent). */
  seq: number;
  /** Newest record time seen (epoch s), or null. */
  newestS: number | null;
  /** 'end' = the terminal marker arrived within the page budget (whole archive read); 'more' = bounded or settled. */
  flag: 'end' | 'more';
}

/** `j1|55.3.1790000000.more|54.3..end` (opcode hex, seq, newest epoch s, flag). Garbage decodes to {}. */
export function decodeCursor(s: string | undefined): Record<number, OpcodeCursor> {
  const out: Record<number, OpcodeCursor> = {};
  if (!s?.startsWith('j1')) return out;
  for (const part of s.split('|').slice(1)) {
    const [op, seq, newest, flag] = part.split('.');
    const opcode = parseInt(op ?? '', 16);
    const n = Number(seq);
    if (!Number.isInteger(opcode) || !Number.isInteger(n)) continue;
    out[opcode] = { seq: n, newestS: newest ? Number(newest) : null, flag: flag === 'end' ? 'end' : 'more' };
  }
  return out;
}

export function encodeCursor(c: Record<number, OpcodeCursor>): string {
  const parts = Object.keys(c)
    .map(Number)
    .sort((a, b) => a - b)
    .map((op) => {
      const v = c[op]!;
      return `${op.toString(16).padStart(2, '0')}.${v.seq}.${v.newestS ?? ''}.${v.flag}`;
    });
  return ['j1', ...parts].join('|');
}

// ---------------------------------------------------------------- planner

export interface J2301Options {
  /** Pages per opcode per open; 1 on V0525 (R10 §4.4). Kotlin's sleep-only refresh uses 4. Clamped to 1..20. */
  pageLimit?: number;
}

export function planJ2301Sync(cursor: Partial<Record<BioStream, string>>, opts: J2301Options = {}): RingCommand[] {
  const pageLimit = Math.min(MAX_PAGES, Math.max(1, Math.floor(opts.pageLimit ?? 1)));
  const decoded = HISTORY_CATALOG.map((s) => ({ s, c: decodeCursor(cursor[s.stream])[s.opcode] }));
  const seq = Math.max(0, ...decoded.map((d) => d.c?.seq ?? 0)) + 1;
  // Stable sort: never-read first, then oldest refresh round; catalogue order breaks ties.
  return decoded
    .map((d, i) => ({ ...d, i }))
    .sort((a, b) => (a.c?.seq ?? -1) - (b.c?.seq ?? -1) || a.i - b.i)
    .map(({ s }) => ({ op: 'history', params: { opcode: s.opcode, stream: s.stream, seq, pageLimit, prev: cursor[s.stream] ?? '' } }));
}

// ---------------------------------------------------------------- protocol

const num = (cmd: RingCommand, k: string, d = 0): number => (typeof cmd.params?.[k] === 'number' ? (cmd.params[k] as number) : d);
const str = (cmd: RingCommand, k: string): string => (typeof cmd.params?.[k] === 'string' ? (cmd.params[k] as string) : '');
const bool = (cmd: RingCommand, k: string, d: boolean): boolean => (typeof cmd.params?.[k] === 'boolean' ? (cmd.params[k] as boolean) : d);

const REPLY_OPS: Record<string, number> = { battery: OP.INFO_BATTERY, firmware: OP.INFO_FIRMWARE, chip: OP.INFO_CHIP, name: OP.INFO_NAME, authenticate: OP.AUTHENTICATE };

export function frameJ2301(cmd: RingCommand): Uint8Array[] {
  switch (cmd.op) {
    case 'battery':
    case 'firmware':
    case 'chip':
    case 'name':
      return [infoRequest(REPLY_OPS[cmd.op]!)];
    case 'authenticate':
      return [authenticationRequest(str(cmd, 'credential'))];
    case 'history':
      return [command(num(cmd, 'opcode'), 0)];
    case 'historyContinue':
      return [command(num(cmd, 'opcode'), 2)];
    case 'realtimeSteps':
      return [prepareRealtimeMeasurement(bool(cmd, 'enable', true))];
    case 'hrMeasure':
      return [heartRateMeasurement(bool(cmd, 'start', true), num(cmd, 'seconds', 30))];
    case 'sportMode':
      return [sportMode(num(cmd, 'mode'), num(cmd, 'state'))];
  }
  throw new RangeError(`jstyle2301: unknown command ${cmd.op}`);
}

function eventTime(e: RingDecodedEvent): number | null {
  switch (e.type) {
    case 'sample':
    case 'vendor':
      return e.t;
    case 'activityBucket':
    case 'sleepEpochs':
      return e.start;
    default:
      return null;
  }
}

/** Closes the history read in flight: merges its cursor entry and emits it (plus a drift status when seen). */
function finishHistory(st: J2301State, flag: 'end' | 'more'): { state: J2301State; events: RingDecodedEvent[] } {
  const h = st.inflight;
  if (!h || h.kind !== 'history') return { state: { ...st, inflight: null }, events: [] };
  const all = decodeCursor(st.cursors[h.stream]);
  const prev = all[h.opcode];
  const newestS = h.newestMs !== null ? Math.floor(h.newestMs / 1000) : (prev?.newestS ?? null);
  all[h.opcode] = { seq: h.seq, newestS: prev?.newestS != null && newestS !== null ? Math.max(prev.newestS, newestS) : newestS, flag };
  const value = encodeCursor(all);
  const events: RingDecodedEvent[] = [{ type: 'status', key: 'cursor', value, stream: h.stream }];
  if (h.aheadMs > DRIFT_REPORT_S * 1000) events.push({ type: 'status', key: 'clock_offset_s', value: Math.round(h.aheadMs / 1000), stream: h.stream });
  return { state: { ...st, inflight: null, cursors: { ...st.cursors, [h.stream]: value } }, events };
}

export function createJStyle2301Protocol(opts: J2301Options = {}): BleProtocol {
  return {
    initialState: (): J2301State => ({ firmware: null, auth: 'none', battery: null, tzOffsetS: 0, nowMs: 0, inflight: null, cursors: {} }),

    frame: frameJ2301,

    planSync: (cursor) => planJ2301Sync(cursor, opts),

    begin(cmd, state): CommandPlan {
      const st = state as J2301State;
      const clock = { nowMs: num(cmd, 'nowMs', st.nowMs), tzOffsetS: num(cmd, 'tzOffsetS', st.tzOffsetS) };
      const reply = REPLY_OPS[cmd.op];
      if (reply !== undefined) {
        const auth = cmd.op === 'authenticate' ? 'pending' : st.auth;
        return { state: { ...st, ...clock, auth, inflight: { kind: 'reply', opcode: reply } }, expectReply: true, stallMs: REPLY_MS };
      }
      if (cmd.op === 'history') {
        const opcode = num(cmd, 'opcode');
        const s = historyStreamForOpcode(opcode);
        if (!s) throw new RangeError(`jstyle2301: not a history opcode ${opcode}`);
        const stream = s.stream;
        const prev = str(cmd, 'prev');
        const cursors = st.cursors[stream] === undefined && prev ? { ...st.cursors, [stream]: prev } : st.cursors;
        const inflight: Inflight = {
          kind: 'history', opcode, stream, page: 0, packets: 0, pageLimit: Math.min(MAX_PAGES, Math.max(1, num(cmd, 'pageLimit', 1))),
          seq: num(cmd, 'seq', 1), newestMs: null, aheadMs: 0,
        };
        return { state: { ...st, ...clock, cursors, inflight }, expectReply: true, quietMs: SETTLE_MS, stallMs: STALL_MS };
      }
      return { state: { ...st, ...clock }, expectReply: false };
    },

    ingest(bytes, state): IngestResult {
      let st = state as J2301State;
      const d = decodePacket(bytes, { firmware: st.firmware, tzOffsetS: st.tzOffsetS, nowMs: st.nowMs });
      const events = [...d.events];
      if (d.firmware !== undefined) st = { ...st, firmware: d.firmware };
      if (d.battery !== undefined) st = { ...st, battery: d.battery };
      if (d.authAccepted !== undefined && st.auth === 'pending') st = { ...st, auth: d.authAccepted ? 'accepted' : 'rejected' };
      const h = st.inflight;
      if (!h || bytes.length === 0) return { events, state: st };
      if (h.kind === 'reply') {
        return bytes[0] === h.opcode ? { events, state: { ...st, inflight: null }, done: true } : { events, state: st };
      }
      if (bytes[0] !== h.opcode) return { events, state: st };
      let newestMs = h.newestMs;
      let aheadMs = h.aheadMs;
      for (const e of d.events) {
        const t = eventTime(e);
        if (t === null) continue;
        newestMs = newestMs === null ? t : Math.max(newestMs, t);
        if (st.nowMs > 0) aheadMs = Math.max(aheadMs, t - st.nowMs);
      }
      const cur: Inflight = { ...h, packets: h.packets + 1, newestMs, aheadMs };
      st = { ...st, inflight: cur };
      const s = historyStreamForOpcode(h.opcode)!;
      if (isTerminal(bytes, s)) {
        const f = finishHistory(st, 'end');
        return { events: [...events, ...f.events], state: f.state, done: true };
      }
      if (cur.packets >= PACKETS_PER_PAGE) {
        const page = cur.page + 1;
        if (page >= cur.pageLimit) {
          const f = finishHistory(st, 'more');
          return { events: [...events, ...f.events], state: f.state, done: true };
        }
        return {
          events,
          state: { ...st, inflight: { ...cur, page, packets: 0 } },
          send: [{ op: 'historyContinue', params: { opcode: h.opcode } }],
        };
      }
      return { events, state: st };
    },

    timeout(state, kind): IngestResult {
      const st = state as J2301State;
      const h = st.inflight;
      if (!h) return { events: [], state: st, done: true };
      if (h.kind === 'reply') {
        const auth = st.auth === 'pending' ? 'none' : st.auth;
        return { events: [{ type: 'status', key: 'error', value: `timeout:0x${h.opcode.toString(16)}` }], state: { ...st, auth, inflight: null }, done: true };
      }
      // Kotlin advances to the next stream on both the settle and the stall timer.
      const f = finishHistory(st, 'more');
      return { events: kind === 'stall' && h.packets === 0 ? [...f.events, { type: 'status', key: 'error', value: `stall:${h.stream}` }] : f.events, state: f.state, done: true };
    },
  };
}

/** True when history may be read (`JStyle2301SyncEngine.historyReady`): a known firmware, authenticated if it requires it. */
export function historyReady(st: J2301State): boolean {
  const p = firmwareProfile(st.firmware);
  return p.id !== 'UNKNOWN' && (!p.requiresAuthentication || st.auth === 'accepted');
}
