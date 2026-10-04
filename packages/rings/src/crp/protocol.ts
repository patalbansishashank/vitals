/**
 * CRP (`fdda`-profile) `Protocol` for `@vitals/rings`: reassembly state, the history walk and the sync planner. Tier P.
 * Port of `CRPSyncEngine.kt` (`queryAllHistory`, `sendSleepBackfill`, `handle` next-frame pull, `terminalFrameIndex`) and
 * `CRPDriver.ingest`. No timers here: the session runs the quiet / stall timers and calls `timeout`.
 *
 * History walk: one command reads one stream for one local day. A timing vital (HR, SpO2, HRV, stress, temperature)
 * answers frame by frame; each frame below the vital's last index sends the next-frame query (guarded per command, day
 * and index so a ring that repeats a frame cannot set off a storm); the last frame ends the read. Sleep is one frame.
 * Lumen fires every query at once and never knows when a pass ends; here each read waits for its own reply, and a day
 * that gets no reply at all (the ring has no record of it) ends on the stall timer as an empty, finished day.
 *
 * Cursor per stream: `d:<YYYY-MM-DD>` = the last local day read to the end and closed (before today). `planSync` reads
 * from the day after it up to today (today is always read again), never further back than the depth limits below.
 * A read cut short (frames came, the last one did not) ends with `status:error partial:<stream>` and leaves the cursor.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import type { CommandPlan, IngestResult, Protocol, ProtocolState, RingCommand, RingEvent, SyncCursor, Uuid } from '../types';
import {
  CMD, CRP_CMD_NOTIFY, GROUP, MAX_HISTORY_DAY, TIMING_VITALS, addDays, daysAgo, frameCrp, historyDay, localDate, timingByOp,
} from './commands';
import { EMPTY_ASSEMBLY, assemble, decodeCrp, toCrpRingEvents, type CrpAssembly, type CrpDecoded } from './decoder';

/** Settle time between the chunks of one frame (crp.md proposes 2–3 s; Lumen has no timer). */
export const QUIET_MS = 2_500;
/** Wait for a history reply after a write; a day with no record gets no reply, so this ends every empty day. */
export const HISTORY_STALL_MS = 6_000;
/** Longest total silence tolerated while a read is mid-way (a frame half-assembled or more frames due). */
export const SILENCE_MAX_MS = 10_000;
/** Wait for the firmware and SpO2-support replies (Lumen never waits; engineering value). */
export const REPLY_MS = 4_000;
/** Sleep nights before today (`SLEEP_BACKFILL_DAYS`). */
export const SLEEP_DEPTH_DAYS = 6;
/**
 * Timing-vital days before today. Lumen reads today only; the vendor names TODAY (0) and YESTERDAY (1) and the decoder
 * takes up to 14. Yesterday is read so a day not synced before midnight is not lost (UNVERIFIED deeper than 1).
 */
export const TIMING_DEPTH_DAYS = 1;

type Inflight =
  | { kind: 'reply'; group: number; cmd: number }
  | { kind: 'timing'; op: string; cmd: number; stream: BioStream; day: number; date: string; terminal: number; frames: number; silenceMs: number }
  | { kind: 'sleep'; day: number; date: string; silenceMs: number };

export interface CrpState extends ProtocolState {
  nowMs: number;
  /** IANA zone stamped by the session (`params.tz`); absent = the fixed `tzOffsetS`. */
  tz?: string;
  tzOffsetS: number;
  asm: CrpAssembly;
  firmware: string | null;
  /** From the 2/37 reply: true (1 or 2), false (anything else), null (never answered). */
  spo2Support: boolean | null;
  worn: boolean | null;
  inflight: Inflight | null;
  /** Latest cursor per stream (`d:<date>`). */
  cursors: Partial<Record<BioStream, string>>;
  /** Next-frame queries already sent (`cmd/day/frame`); a fresh read of the same command and day clears its keys. */
  requested: string[];
}

const num = (cmd: RingCommand, k: string, d = 0): number => (typeof cmd.params?.[k] === 'number' ? (cmd.params[k] as number) : d);
const str = (cmd: RingCommand, k: string): string => (typeof cmd.params?.[k] === 'string' ? (cmd.params[k] as string) : '');

export const encodeCursor = (date: string): string => `d:${date}`;
/** The date in a cursor, or null for garbage. */
export function decodeCursor(s: string | undefined): string | null {
  const m = /^d:(\d{4}-\d{2}-\d{2})$/.exec(s ?? '');
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------- planner

/** History reads for one sync, in Lumen's order (HR, SpO2, HRV, stress, temperature, then sleep), oldest day first. */
export function planCrpSync(cursor: SyncCursor, nowMs: number, tzOffsetS: number): RingCommand[] {
  const today = localDate(nowMs, tzOffsetS);
  const out: RingCommand[] = [];
  const days = (stream: BioStream, op: string, depth: number, extra: Record<string, number>): void => {
    const c = decodeCursor(cursor[stream]);
    let back = c === null ? depth : Math.min(depth, daysAgo(c, nowMs, tzOffsetS) - 1);
    if (back < 0) back = 0; // cursor today or in the future: today only
    const floor = addDays(today, -back - 1);
    for (let d = back; d >= 0; d--) out.push({ op, params: { date: addDays(today, -d), stream, floor, ...extra } });
  };
  for (const v of TIMING_VITALS) days(v.stream, v.op, TIMING_DEPTH_DAYS, { frameIndex: 0 });
  days('sleep_stage', 'history_sleep', SLEEP_DEPTH_DAYS, {});
  return out;
}

// ---------------------------------------------------------------- reads

/** A finished read: the cursor moves to the day read when that day is closed (before today) and follows on from the old cursor. */
function finishRead(st: CrpState, ok: boolean): { state: CrpState; events: RingEvent[] } {
  const h = st.inflight;
  if (!h || h.kind === 'reply') return { state: { ...st, inflight: null }, events: [] };
  const stream: BioStream = h.kind === 'timing' ? h.stream : 'sleep_stage';
  const done = { ...st, inflight: null };
  if (!ok) return { state: done, events: [{ type: 'status', key: 'error', value: `partial:${stream}`, stream }] };
  const prev = decodeCursor(st.cursors[stream]);
  const same = prev !== null ? [{ type: 'status' as const, key: 'cursor' as const, value: encodeCursor(prev), stream }] : [];
  // Today is never closed (the ring keeps writing to it), and a day already behind the cursor changes nothing.
  if (h.date >= localDate(st.nowMs, st.tzOffsetS) || (prev !== null && h.date <= prev)) return { state: done, events: same };
  // Only a contiguous step: after a partial day the later days of the same pass leave the cursor alone.
  if (prev !== null && h.date > addDays(prev, 1)) return { state: done, events: [] };
  const value = encodeCursor(h.date);
  return { state: { ...done, cursors: { ...st.cursors, [stream]: value } }, events: [{ type: 'status', key: 'cursor', value, stream }] };
}

const REPLY_OPS: Record<string, { group: number; cmd: number }> = {
  query_firmware: { group: GROUP.POWER, cmd: CMD.QUERY_FIRMWARE },
  query_spo2_support: { group: GROUP.HISTORY, cmd: CMD.QUERY_SUPPORT_SPO2_TYPE },
};

export function createCrpProtocol(): Protocol {
  return {
    initialState: (): CrpState => ({
      nowMs: 0, tzOffsetS: 0, asm: EMPTY_ASSEMBLY, firmware: null, spo2Support: null, worn: null, inflight: null, cursors: {}, requested: [],
    }),

    frame: (cmd) => frameCrp(cmd).map((bytes) => ({ bytes })),

    planSync: (cursor, state) => {
      const st = state as CrpState;
      return planCrpSync(cursor, st.nowMs, st.tzOffsetS);
    },

    begin(cmd, state): CommandPlan {
      const prev = state as CrpState;
      const st: CrpState = { ...prev, nowMs: num(cmd, 'nowMs', prev.nowMs), tz: str(cmd, 'tz') || prev.tz, tzOffsetS: num(cmd, 'tzOffsetS', prev.tzOffsetS), inflight: null };
      const reply = REPLY_OPS[cmd.op];
      if (reply) return { state: { ...st, inflight: { kind: 'reply', ...reply } }, expectReply: true, stallMs: REPLY_MS };
      const tv = timingByOp(cmd.op);
      if (tv || cmd.op === 'history_sleep') {
        const day = historyDay(cmd);
        if (day > MAX_HISTORY_DAY) return { state: st, expectReply: false }; // nothing is written
        const date = str(cmd, 'date') || addDays(localDate(st.nowMs, st.tzOffsetS), -day);
        const stream: BioStream = tv ? tv.stream : 'sleep_stage';
        // The planner's floor (the day before the first day it plans) stands in for a cursor older than the depth.
        const floor = str(cmd, 'floor');
        const have = decodeCursor(st.cursors[stream] ?? str(cmd, 'prev'));
        const base = floor && (have === null || have < floor) ? floor : have;
        const cursors = base ? { ...st.cursors, [stream]: encodeCursor(base) } : st.cursors;
        if (!tv) return { state: { ...st, cursors, inflight: { kind: 'sleep', day, date, silenceMs: 0 } }, expectReply: true, quietMs: QUIET_MS, stallMs: HISTORY_STALL_MS };
        const requested = st.requested.filter((k) => !k.startsWith(`${tv.cmd}/${day}/`));
        const inflight: Inflight = { kind: 'timing', op: tv.op, cmd: tv.cmd, stream, day, date, terminal: tv.terminalFrame, frames: 0, silenceMs: 0 };
        return { state: { ...st, cursors, requested, inflight }, expectReply: true, quietMs: QUIET_MS, stallMs: HISTORY_STALL_MS };
      }
      return { state: st, expectReply: false };
    },

    ingest(bytes, state, channel?: Uuid): IngestResult {
      let st = state as CrpState;
      const ctx = { nowMs: st.nowMs, tz: st.tz, tzOffsetS: st.tzOffsetS };
      const map = (d: CrpDecoded[]): RingEvent[] => toCrpRingEvents(d, { ...ctx, firmware: st.firmware ?? '' });
      const ch = (channel ?? CRP_CMD_NOTIFY).toLowerCase();
      // `CRPDriver.ingest`: only fdd3 replies reassemble; fdd1 (steps) and anything else decode as they come.
      if (!ch.includes('fdd3')) return { events: map(decodeCrp(bytes, ch, ctx)), state: st };
      const a = assemble(st.asm, bytes);
      const h0 = st.inflight;
      // Any chunk of a reply resets the silence count of the read in flight.
      const fresh = h0 && h0.kind !== 'reply' ? { ...h0, silenceMs: 0 } : h0;
      st = { ...st, asm: a.asm, inflight: fresh };
      if (!a.frame) return { events: [], state: st };
      const decoded = decodeCrp(a.frame, ch, ctx);
      for (const d of decoded) {
        if (d.kotlin === 'FirmwareRevision') st = { ...st, firmware: d.version };
        else if (d.kotlin === 'SupportFunctions') st = { ...st, spo2Support: d.capabilities.includes('SPO2') };
        else if (d.kotlin === 'WearingStatus') st = { ...st, worn: d.worn };
      }
      const events = map(decoded);
      const group = a.frame[4];
      const cmd = a.frame[5];
      const h = st.inflight;
      if (!h) {
        // A measurement stream (spot or live; no read in flight). The first plausible SpO2 ends a spot SpO2 (the ring
        // sends one value, then nothing); off the finger ends any measurement (Lumen: CRP only).
        const end = decoded.some((d) => d.kotlin === 'Spo2Result' || (d.kotlin === 'WearingStatus' && !d.worn));
        return end ? { events, state: st, done: true } : { events, state: st };
      }
      if (h.kind === 'reply') {
        return group === h.group && cmd === h.cmd ? { events, state: { ...st, inflight: null }, done: true } : { events, state: st };
      }
      if (h.kind === 'sleep') {
        if (group !== GROUP.HISTORY || cmd !== CMD.HISTORY_SLEEP) return { events, state: st };
        const f = finishRead(st, true);
        return { events: [...events, ...f.events], state: f.state, done: true };
      }
      const marker = decoded.find((d): d is Extract<CrpDecoded, { kotlin: 'TimingHistoryFrame' }> => d.kotlin === 'TimingHistoryFrame' && d.cmd === h.cmd && d.day === h.day);
      if (!marker) return { events, state: st };
      const cur = { ...h, frames: h.frames + 1 };
      st = { ...st, inflight: cur };
      if (marker.frameIndex >= h.terminal) {
        const f = finishRead(st, true);
        return { events: [...events, ...f.events], state: f.state, done: true };
      }
      // `CRPSyncEngine.handle`: ask for the next frame unless this one was already asked for.
      const next = marker.frameIndex + 1;
      const key = `${h.cmd}/${h.day}/${next}`;
      if (st.requested.includes(key)) return { events, state: st };
      return { events, state: { ...st, requested: [...st.requested, key] }, send: [{ op: h.op, params: { day: h.day, frameIndex: next, stream: h.stream } }] };
    },

    timeout(state, kind): IngestResult {
      const st = state as CrpState;
      const h = st.inflight;
      if (!h) return { events: [], state: st, done: true };
      if (h.kind === 'reply') {
        return { events: [{ type: 'status', key: 'error', value: `timeout:crp:${h.group}/${h.cmd}` }], state: { ...st, inflight: null }, done: true };
      }
      // Mid-read = a frame half-assembled, or frames came and the last one has not.
      const midRead = st.asm.expected > 0 || (h.kind === 'timing' && h.frames > 0);
      if (kind === 'quiet') {
        // Never end a read on the settle timer while more is due: keep waiting up to SILENCE_MAX_MS of silence in all.
        // A quiet with nothing of ours yet (only other packets came) waits like a stall would.
        const silenceMs = h.silenceMs + QUIET_MS;
        if (silenceMs < (midRead ? SILENCE_MAX_MS : HISTORY_STALL_MS)) return { events: [], state: { ...st, inflight: { ...h, silenceMs } }, done: false };
      }
      // No reply at all: the ring has no record of that day (normal). Cut short: partial, cursor left where it was.
      const f = finishRead(st, !midRead);
      return { events: f.events, state: f.state, done: true };
    },

    // CRP sends no credential: frames are safe to log as they are.
    redactOutbound: (frame) => frame,
  };
}

export const crpProtocol: Protocol = createCrpProtocol();
