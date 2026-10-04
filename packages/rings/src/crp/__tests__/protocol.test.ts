// @vitest-environment node
/**
 * CRP protocol state machine without a transport: the sync plan per cursor, the next-frame guard, the cursor rules
 * (closed days only, contiguous steps only) and the timers' answers.
 */
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, type ProtocolState, type RingCommand, type RingEvent } from '../../types';
import { crp } from '../family';
import { HISTORY_STALL_MS, QUIET_MS, SILENCE_MAX_MS, planCrpSync, type CrpState } from '../protocol';

const NOW = Date.parse('2026-07-24T12:00:00Z');
const P = crp.protocol;
const stamp = (cmd: RingCommand, nowMs = NOW, tzOffsetS = 0): RingCommand => ({ ...cmd, params: { nowMs, tzOffsetS, ...cmd.params } });
const begin = (cmd: RingCommand, st: ProtocolState = P.initialState()) => P.begin!(stamp(cmd), st);
const frame = (cmd: number, day: number, f: number, fill: Record<number, number> = {}): Uint8Array =>
  Uint8Array.from([0xfd, 0xda, 0x10, 0x98, 0x02, cmd, day, f, ...Array.from({ length: 144 }, (_, i) => fill[i] ?? 0)]);
const cursorEvents = (evs: RingEvent[]): unknown[] => evs.filter((e) => e.type === 'status' && e.key === 'cursor').map((e) => e.type === 'status' && e.value);

describe('CRP planSync', () => {
  const ops = (cmds: RingCommand[]): string[] => cmds.map((c) => `${c.op}@${String(c.params?.date)}`);

  it('no cursor: yesterday and today for each vital (Lumen order), six nights back for sleep, oldest first', () => {
    const plan = planCrpSync({}, NOW, 0);
    expect(ops(plan)).toEqual([
      'history_hr@2026-07-23', 'history_hr@2026-07-24', 'history_spo2@2026-07-23', 'history_spo2@2026-07-24',
      'history_hrv@2026-07-23', 'history_hrv@2026-07-24', 'history_stress@2026-07-23', 'history_stress@2026-07-24',
      'history_temp@2026-07-23', 'history_temp@2026-07-24',
      ...['18', '19', '20', '21', '22', '23', '24'].map((d) => `history_sleep@2026-07-${d}`),
    ]);
    expect(plan[0]!.params).toEqual({ date: '2026-07-23', stream: 'hr', floor: '2026-07-22', frameIndex: 0 });
    expect(plan.at(-1)!.params).toEqual({ date: '2026-07-24', stream: 'sleep_stage', floor: '2026-07-17' });
  });

  it('reads from the day after the cursor; a cursor at today or later (or garbage) still reads today', () => {
    expect(ops(planCrpSync({ hr: 'd:2026-07-23' }, NOW, 0)).filter((o) => o.startsWith('history_hr@'))).toEqual(['history_hr@2026-07-24']);
    expect(ops(planCrpSync({ sleep_stage: 'd:2026-07-21' }, NOW, 0)).filter((o) => o.startsWith('history_sleep@'))).toEqual(['history_sleep@2026-07-22', 'history_sleep@2026-07-23', 'history_sleep@2026-07-24']);
    expect(ops(planCrpSync({ hr: 'd:2026-07-30' }, NOW, 0)).filter((o) => o.startsWith('history_hr@'))).toEqual(['history_hr@2026-07-24']);
    expect(ops(planCrpSync({ hr: 'nonsense' }, NOW, 0)).filter((o) => o.startsWith('history_hr@'))).toHaveLength(2);
    // An old cursor is capped by the depth.
    expect(ops(planCrpSync({ sleep_stage: 'd:2026-06-01' }, NOW, 0)).filter((o) => o.startsWith('history_sleep@'))).toHaveLength(7);
  });

  it('days are local: at 05:00Z in UTC-8 today is the 23rd; the frame asks for the day counted from the stamped clock', () => {
    const at = Date.parse('2026-07-24T05:00:00Z');
    const plan = planCrpSync({ hr: 'd:2026-07-21' }, at, -8 * 3600);
    expect(ops(plan).slice(0, 2)).toEqual(['history_hr@2026-07-22', 'history_hr@2026-07-23']);
    expect(toHex(P.frame(stamp(plan[0]!, at, -8 * 3600), P.initialState())[0]!.bytes)).toBe('fd da 10 08 02 0f 01 00');
  });
});

describe('CRP history reads', () => {
  it('asks for each next frame once; a fresh read of the same day may ask again', () => {
    let st = begin({ op: 'history_hr', params: { day: 0, frameIndex: 0, stream: 'hr' } }).state;
    const a = P.ingest(frame(0x0f, 0, 0), st);
    expect(a.send).toEqual([{ op: 'history_hr', params: { day: 0, frameIndex: 1, stream: 'hr' } }]);
    const b = P.ingest(frame(0x0f, 0, 0), a.state);
    expect(b.send).toBeUndefined();
    expect(b.done).toBeUndefined();
    st = begin({ op: 'history_hr', params: { day: 0, frameIndex: 0, stream: 'hr' } }, b.state).state;
    expect(P.ingest(frame(0x0f, 0, 0), st).send).toHaveLength(1);
  });

  it('frames of another vital or day feed samples but do not move the read', () => {
    const st = begin({ op: 'history_hr', params: { day: 0, frameIndex: 0, stream: 'hr' } }).state;
    const r = P.ingest(frame(0x0f, 1, 1, { 0: 60 }), st);
    expect(r.events).toHaveLength(1);
    expect(r.done).toBeUndefined();
    expect((r.state as CrpState).inflight).toMatchObject({ kind: 'timing', frames: 0 });
  });

  it('the cursor moves one closed day at a time; a partial day stops it; today never closes', () => {
    const stall = (st: ProtocolState) => P.timeout!(st, 'stall');
    // 22nd: no reply (an empty day) is a finished day.
    let r = stall(begin({ op: 'history_hr', params: { date: '2026-07-22', stream: 'hr', floor: '2026-07-21', frameIndex: 0 } }).state);
    expect(cursorEvents(r.events)).toEqual(['d:2026-07-22']);
    // 23rd: frame 0 came, frame 1 never did.
    let st = begin({ op: 'history_hr', params: { date: '2026-07-23', stream: 'hr', frameIndex: 0 } }, r.state).state;
    st = P.ingest(frame(0x0f, 1, 0), st).state;
    r = stall(st);
    expect(r.events).toEqual([{ type: 'status', key: 'error', value: 'partial:hr', stream: 'hr' }]);
    // Today: finished, but the cursor stays on the 22nd so the 23rd is read again next time.
    st = begin({ op: 'history_hr', params: { date: '2026-07-24', stream: 'hr', frameIndex: 0 } }, r.state).state;
    st = P.ingest(frame(0x0f, 0, 0), st).state;
    r = P.ingest(frame(0x0f, 0, 1), st);
    expect(r.done).toBe(true);
    expect(cursorEvents(r.events)).toEqual(['d:2026-07-22']);
    expect((r.state as CrpState).cursors.hr).toBe('d:2026-07-22');
    expect(planCrpSync({ hr: 'd:2026-07-22' }, NOW, 0)[0]!.params?.date).toBe('2026-07-23');
  });

  it('a day past a gap in the cursor does not move it', () => {
    const st = { ...(P.initialState() as CrpState), cursors: { hr: 'd:2026-07-20' } };
    const r = P.timeout!(begin({ op: 'history_hr', params: { date: '2026-07-23', stream: 'hr', frameIndex: 0 } }, st).state, 'stall');
    expect(r.events).toEqual([]);
    expect((r.state as CrpState).cursors.hr).toBe('d:2026-07-20');
  });

  it('quiet timer: keeps waiting mid-frame up to SILENCE_MAX_MS, then partial; with nothing of ours, up to the stall', () => {
    let st = begin({ op: 'history_sleep', params: { day: 0, stream: 'sleep_stage' } }).state;
    st = P.ingest(fromHex('fd da 10 16 02 0e 00 01 17 0a'), st).state; // 22-byte frame, 10 bytes in
    let r = P.timeout!(st, 'quiet');
    let waits = 1;
    for (; r.done === false; waits++) r = P.timeout!(r.state, 'quiet');
    expect(waits).toBe(Math.ceil(SILENCE_MAX_MS / QUIET_MS));
    expect(r.events).toEqual([{ type: 'status', key: 'error', value: 'partial:sleep_stage', stream: 'sleep_stage' }]);
    st = begin({ op: 'history_sleep', params: { day: 0, stream: 'sleep_stage' } }).state;
    st = P.ingest(fromHex('e8 03 00'), st, '0000fdd1-0000-1000-8000-00805f9b34fb').state;
    r = P.timeout!(st, 'quiet');
    for (waits = 1; r.done === false; waits++) r = P.timeout!(r.state, 'quiet');
    expect(waits).toBe(Math.ceil(HISTORY_STALL_MS / QUIET_MS));
    expect(r.events.some((e) => e.type === 'status' && e.key === 'error')).toBe(false);
  });

  it('reply commands: done on their reply, an error on silence', () => {
    const st = begin({ op: 'query_firmware' }).state;
    expect(P.ingest(fromHex('fd da 10 07 02 25 01'), st).done).toBeUndefined();
    expect(P.ingest(fromHex('fd da 10 07 03 03 00'), st).done).toBe(true); // an empty version is an ack of 3/3, still the reply
    expect(P.timeout!(st, 'stall').events).toEqual([{ type: 'status', key: 'error', value: 'timeout:crp:3/3' }]);
    expect(begin({ op: 'set_time' }).expectReply).toBe(false);
    expect(begin({ op: 'timing_hr', params: { intervalMin: 5 } }).expectReply).toBe(false);
  });

  it('measurement streams: a SpO2 value or off the finger ends the run, but never a history read', () => {
    const idle = P.initialState();
    expect(P.ingest(fromHex('fd da 10 07 01 0b 60'), idle).done).toBe(true);
    expect(P.ingest(fromHex('fd da 10 07 03 07 00'), idle).done).toBe(true);
    expect(P.ingest(fromHex('fd da 10 07 01 09 48'), idle).done).toBeUndefined();
    const reading = begin({ op: 'history_hr', params: { day: 0, frameIndex: 0, stream: 'hr' } }).state;
    expect(P.ingest(fromHex('fd da 10 07 01 0b 60'), reading).done).toBeUndefined();
  });
});
