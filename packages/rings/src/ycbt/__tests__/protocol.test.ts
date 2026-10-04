// @vitest-environment node
/**
 * YCBT behaviours the fixtures do not pin down: the walk is reported finished even when every type was refused (Lumen
 * stayed silent), the TK5 handshake (`02 1b`, the blood pressure monitor), and the live heart-rate run that a `04 0e`
 * does not end.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { toHex, type RingEvent } from '../../types';
import { frameLogical } from '../commands';
import { ycbt } from '../family';
import { initialYcbtState, planYcbtSync, type YcbtState } from '../protocol';
import { ScriptedRing } from './ring';

const opts = { timers: { quietMs: 30, stallMs: 80 }, clock: { now: () => Date.parse('2026-07-06T12:34:14Z'), tzOffsetS: () => 0 } };
const f = (...b: number[]): string => toHex(frameLogical(b));

describe('YCBT protocol', () => {
  it('a walk with nothing left to read still reports history finished, without a write', async () => {
    const st: YcbtState = { ...initialYcbtState('r10m'), startupDone: true, unsupported: [0x02, 0x04, 0x06, 0x09] };
    const plan = planYcbtSync({}, st);
    expect(plan.map((c) => [c.op, c.params?.types ?? ''])).toEqual([['enableLiveStatus', ''], ['history', '']]);
    const ring = new ScriptedRing([], 'R10M 1A2B');
    ring.prelude = 'all';
    const s = await openRingSession(ycbt, ring, opts);
    const before = ring.writes.length;
    const evs: RingEvent[] = [];
    for await (const e of s.runtime.exchange(plan[1]!)) evs.push(e);
    expect(ring.writes.length).toBe(before);
    expect(evs).toEqual([{ type: 'progress', stage: 'history', done: true }]);
    await s.close();
  });

  it('first sync is the startup walk (03 09 after it); later syncs send 03 09 first', () => {
    const cold = planYcbtSync({}, initialYcbtState('r10m'));
    expect(cold.map((c) => c.params?.types ?? c.op)).toEqual(['sport', 'sleep', 'heart', 'all', 'enableLiveStatus']);
    expect(cold.map((c) => c.params?.stream)).toEqual(['steps', 'sleep_stage', 'hr', 'spo2', undefined]);
    const warm = planYcbtSync({}, { ...initialYcbtState('tk5'), startupDone: true });
    expect(warm.map((c) => c.params?.types ?? c.op)).toEqual(['enableLiveStatus', 'sport', 'sleep', 'heart', 'all', 'spo2', 'body_data']);
    expect(warm.filter((c) => c.params?.finish === true).map((c) => c.params?.types)).toEqual(['body_data']);
  });

  it('a TK5 handshake asks the chip scheme and switches the BP monitor on when the bitmap claims BP', async () => {
    const bitmap = [2, 1, 0x01, ...new Array<number>(13).fill(0)]; // byte 0 bit 0: blood pressure
    const ring = new ScriptedRing([], 'TK5 24AA');
    ring.prelude = 'all';
    ring.canned = { [f(2, 0, 0x47, 0x43)]: ['02 00 0c 00 a3 00 05 01 00 64 9b a6'], [f(2, 1, 0x47, 0x46)]: [f(...bitmap)] };
    const s = await openRingSession(ycbt, ring, { ...opts, profile: { metric: false, sex: 'male', ageYears: 31, heightCm: 183, weightKg: 78 } });
    expect(s.info()).toEqual({ firmware: '1.05', battery: 100, model: 'TK5', clockOffsetS: 0 });
    expect(ring.writes.map((w) => w.slice(0, 5))).toEqual(['02 03', '01 00', '02 00', '02 01', '02 1b', '02 07', '01 12', '01 04', '01 0c', '01 1c', '01 26', '01 45', '01 03', '03 09']);
    expect(ring.writes).toContain(f(1, 4, 1, 1, 1, 0, 0, 0)); // imperial units
    expect(ring.writes).toContain(f(1, 3, 183, 78, 1, 31));
    expect(s.handshakeEvents).toContainEqual({ type: 'status', key: 'capabilities', value: 'BLOOD_PRESSURE' });
    await s.close();
  });

  it('an R10M never gets 02 1b nor the BP monitor; no profile means no 01 03', async () => {
    const ring = new ScriptedRing([], 'R10M FCF4');
    ring.prelude = 'all';
    ring.canned = { [f(2, 1, 0x47, 0x46)]: [f(2, 1, 0x01, ...new Array<number>(13).fill(0))] };
    const s = await openRingSession(ycbt, ring, opts);
    expect(ring.writes.map((w) => w.slice(0, 5))).toEqual(['02 03', '01 00', '02 00', '02 01', '02 07', '01 12', '01 04', '01 0c', '01 26', '03 09']);
    await s.close();
  });

  it('live heart rate streams values and ignores 04 0e; a spot ends on it', async () => {
    const ring = new ScriptedRing([{ hex: f(3, 0x2f, 1, 0), replies: [f(4, 0x13, 0, 1, 72), f(4, 0x0e, 0, 1), f(6, 1, 75)], used: false }], 'R10M 1A2B');
    ring.prelude = 'all';
    const s = await openRingSession(ycbt, ring, opts);
    ring.prelude = 'none';
    const ac = new AbortController();
    const got: RingEvent[] = [];
    for await (const e of s.liveHeartRate(ac.signal)) {
      got.push(e);
      if (e.type === 'sample' && e.value === 75) ac.abort();
    }
    expect(got.filter((e) => e.type === 'sample').map((e) => e.type === 'sample' && e.value)).toEqual([72, 75]);
    expect(ring.errors).toEqual([f(4, 0x13, 0), f(4, 0x0e, 0), f(3, 0x2f, 0, 0)]); // acks and the stop, unscripted here
    await s.close();
  });
});
