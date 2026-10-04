// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodePacket, timestamp } from '../decoder';
import { createJStyle2301Protocol, decodeCursor } from '../legacyProtocol';
import { createJ2301Protocol } from '../protocol';

const NOW = Date.UTC(2026, 9, 4, 12);
const context = { firmware: 'V0789', tzOffsetS: 7_200, tz: 'Europe/Berlin', nowMs: NOW };
const stamp = [0x26, 0x10, 0x04, 0x12, 0x00, 0x00];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe('J-Style 2301 malformed frame invariants', () => {
  it('never throws or publishes impossible health samples on seeded random and truncated frames', () => {
    const next = seeded(0x23010789);
    const opcodes = [0x09, 0x18, 0x28, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x62, 0x66];
    for (let i = 0; i < 4_000; i++) {
      const length = next() % 144;
      const frame = Uint8Array.from({ length }, () => next() & 0xff);
      if (length > 0) frame[0] = opcodes[next() % opcodes.length]!;
      if (length >= 9 && i % 2 === 0) frame.set(stamp, 3);
      const events = decodePacket(frame, context).events;
      for (const e of events) {
        if (e.type === 'sample') {
          if (e.stream === 'hr') expect(e.value).toBeGreaterThanOrEqual(25);
          if (e.stream === 'hr') expect(e.value).toBeLessThanOrEqual(250);
          if (e.stream === 'spo2') expect(e.value).toBeGreaterThanOrEqual(70);
          if (e.stream === 'spo2') expect(e.value).toBeLessThanOrEqual(100);
          expect(e.t).toBeLessThanOrEqual(NOW);
        }
        if (e.type === 'activityBucket') {
          expect(e.steps).toBeGreaterThanOrEqual(0);
          expect(e.distanceM).toBeGreaterThanOrEqual(0);
          expect(e.start).toBeLessThanOrEqual(NOW);
        }
        if (e.type === 'sleepEpochs') {
          expect(e.epochS).toBeGreaterThan(0);
          expect(e.stages.length).toBeLessThanOrEqual(120);
          expect(e.start).toBeLessThanOrEqual(NOW);
        }
      }
    }
  });

  it('rejects future history and invalid HR or SpO2 in otherwise valid records', () => {
    const rec = (op: number, date: number[], value: number): Uint8Array =>
      Uint8Array.from([op, 0, 0, ...date, value]);
    expect(decodePacket(rec(0x55, stamp, 255), context).events).toEqual([]);
    expect(decodePacket(rec(0x66, stamp, 69), context).events).toEqual([]);
    expect(decodePacket(rec(0x55, [0x26, 0x10, 0x05, 0x12, 0, 0], 72), context).events).toEqual([]);
    expect(decodePacket(rec(0x55, [0x00, 0x10, 0x04, 0x12, 0, 0], 72), context).events).toEqual([]);
    expect(decodePacket(rec(0x55, stamp, 72), context).events).toHaveLength(1);
    expect(decodePacket(Uint8Array.from([0x56, 0, 0, ...stamp, 0, 0, 0, 255, 0, 0]), context).events).toEqual([]);
  });

  it('cuts a current sleep packet at the last measured device time', () => {
    const sleep = new Uint8Array(130);
    sleep.set([0x53, 0, 0, 0x26, 0x10, 0x04, 0x13, 0x59, 0x00, 120]);
    sleep.fill(2, 10);
    const events = decodePacket(sleep, { ...context, nowMs: Date.UTC(2026, 9, 4, 12, 0) }).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'sleepEpochs', complete: false });
    if (events[0]?.type === 'sleepEpochs') {
      expect(events[0].stages).toHaveLength(1);
      expect(events[0].rawCodes).toHaveLength(1);
    }
  });

  it('uses each historical date’s offset, including a daylight-saving overlap and gap', () => {
    const rec = (fields: number[]): Uint8Array => Uint8Array.from([0x55, 0, 0, ...fields, 72]);
    const summer = rec([0x26, 0x07, 0x04, 0x12, 0, 0]);
    const winter = rec([0x26, 0x01, 0x04, 0x12, 0, 0]);
    expect(timestamp(summer, 3_600, 3, 'Europe/Berlin')).toBe(Date.UTC(2026, 6, 4, 10));
    expect(timestamp(winter, 7_200, 3, 'Europe/Berlin')).toBe(Date.UTC(2026, 0, 4, 11));
    expect(timestamp(rec([0x26, 0x10, 0x25, 0x02, 0x30, 0]), 3_600, 3, 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(timestamp(rec([0x26, 0x03, 0x29, 0x02, 0x30, 0]), 3_600, 3, 'Europe/Berlin')).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });

  it('carries the session zone into the protocol decoder', () => {
    const p = createJStyle2301Protocol();
    const state = p.begin!({ op: 'history', params: { opcode: 0x55, nowMs: NOW, tzOffsetS: 7_200, tz: 'Europe/Berlin' } }, p.initialState()).state;
    const frame = Uint8Array.from([0x55, 0, 0, 0x26, 0x01, 0x04, 0x12, 0, 0, 72]);
    const result = p.ingest(frame, state);
    expect(result.events.find((e) => e.type === 'sample')).toMatchObject({ t: Date.UTC(2026, 0, 4, 11) });
  });

  it('stamps two live notifications at their receive times without moving the history anchor', () => {
    const p = createJ2301Protocol();
    const initial = p.initialState();
    const anchor = NOW - 60_000;
    const state = p.begin!({ op: 'realtimeSteps', params: { nowMs: anchor, tzOffsetS: 0 } }, initial).state;
    const frame = new Uint8Array(22);
    frame[0] = 0x09;
    frame[21] = 72;
    const first = p.ingest(frame, state, undefined, NOW);
    const second = p.ingest(frame, first.state, undefined, NOW + 60_000);
    expect(first.events.find((e) => e.type === 'sample')).toMatchObject({ t: NOW });
    expect(second.events.find((e) => e.type === 'sample')).toMatchObject({ t: NOW + 60_000 });
    expect((second.state as typeof state & { nowMs: number }).nowMs).toBe(anchor);
  });

  it('reports a valid future record as clock drift without publishing or cursoring its sample', () => {
    const p = createJ2301Protocol();
    const state = p.begin!({ op: 'history', params: { opcode: 0x55, nowMs: NOW, tzOffsetS: 0 } }, p.initialState()).state;
    const future = Uint8Array.from([0x55, 0, 0, 0x26, 0x10, 0x04, 0x12, 0x10, 0, 62]);
    const first = p.ingest(future, state, undefined, NOW);
    expect(first.events).toEqual([]);
    const last = p.ingest(Uint8Array.from([0x55, 0xff]), first.state, undefined, NOW);
    expect(last.events.some((e) => e.type === 'sample')).toBe(false);
    expect(last.events).toContainEqual({ type: 'status', key: 'clock_offset_s', value: 600, stream: 'hr' });
    const cursor = last.events.find((e) => e.type === 'status' && e.key === 'cursor');
    expect(cursor?.type === 'status' ? decodeCursor(String(cursor.value))[0x55]?.newestS : undefined).toBeNull();
  });
});
