// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CMD, DT, packets, type LogicalFrame } from '../commands';
import { decodeFrame } from '../decoder';
import { createLuckRingProtocol, type LuckRingState } from '../protocol';

const nowMs = Date.UTC(2026, 9, 4, 12);
const frame = (dataType: number, payload: number[]): LogicalFrame => ({ cmdType: CMD.SEND, dataType, payload, seq: 0, devType: 1 });
const stamp = (seconds: number): number[] => [seconds & 255, (seconds >>> 8) & 255, (seconds >>> 16) & 255, (seconds >>> 24) & 255];
const envelope = (record: number[]): number[] => [1, 0, 1, ...record];

describe('LuckRing malformed packet boundaries', () => {
  it('accepts successive live timestamps against each packet receipt', () => {
    const protocol = createLuckRingProtocol();
    let st = { ...protocol.initialState(), nowMs } as LuckRingState;
    const at = Math.floor(nowMs / 1000);
    for (const receipt of [at, at + 60]) {
      const bytes = packets(frame(DT.REAL_HEART, envelope([...stamp(receipt), 72])))[0]!;
      const result = protocol.ingest(bytes, st, undefined, receipt * 1000);
      st = result.state as LuckRingState;
      expect(result.events.find((e) => e.type === 'sample')).toMatchObject({ t: receipt * 1000, value: 72 });
    }
  });

  it('applies Kotlin bridge value windows to complete records', () => {
    expect(decodeFrame(frame(DT.HISTORY_HEART, envelope([...stamp(1_700_000_000), 255])), { firmware: '', nowMs })).toEqual([]);
    expect(decodeFrame(frame(DT.HISTORY_O2, envelope([...stamp(1_700_000_000), 69])), { firmware: '', nowMs })).toEqual([]);
    expect(decodeFrame(frame(DT.HISTORY_HEART, envelope([...stamp(Math.floor(nowMs / 1000) + 7_201), 72])), { firmware: '', nowMs })).toEqual([]);
    expect(decodeFrame(frame(DT.HISTORY_HEART, envelope([...stamp(1), 72])), { firmware: '', nowMs })).toEqual([]);
    expect(decodeFrame(frame(DT.HISTORY_HEART, envelope([...stamp(Math.floor(nowMs / 1000) - 60), 72])), { firmware: '', nowMs })).toMatchObject([{ value: 72 }]);
  });

  it('cannot expand a corrupt sleep gap into an unbounded stage array', () => {
    const entries = [1, ...stamp(1), 2, ...stamp(0xffff_ffff)];
    const p = [0, 0, 1, 2, ...entries, ...new Array<number>(75 - entries.length).fill(0)];
    expect(decodeFrame(frame(DT.SLEEP, p), { firmware: '', nowMs })).toEqual([]);
  });

  it('drops a later sleep session that overlaps an already decoded session', () => {
    const base = Math.floor(nowMs / 1000) - 3_600;
    const entries = [[1, base], [2, base + 120], [4, base + 240], [1, base + 180], [2, base + 240], [4, base + 300]];
    const bytes = entries.flatMap(([type, t]) => [type!, ...stamp(t!)]);
    const p = [0, 0, 1, entries.length, ...bytes, ...new Array<number>(75 - bytes.length).fill(0)];
    const events = decodeFrame(frame(DT.SLEEP, p), { firmware: '', nowMs });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'sleepEpochs', start: base * 1000 });
  });

  it('seeded random and truncated notifications never throw or emit impossible values', () => {
    let seed = 0x6a09e667;
    const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    const protocol = createLuckRingProtocol();
    let st = { ...protocol.initialState(), nowMs } as LuckRingState;
    for (let i = 0; i < 5_000; i++) {
      const bytes = Uint8Array.from({ length: next() % 21 }, () => next() & 255);
      const result = protocol.ingest(bytes, st, undefined, nowMs);
      st = result.state as LuckRingState;
      for (const event of result.events) {
        if (event.type === 'activityBucket') expect(event.steps).toBeLessThanOrEqual(5000);
        if (event.type === 'sample') {
          if (event.stream === 'hr') expect(event.value).toBeGreaterThanOrEqual(30);
          if (event.stream === 'hr') expect(event.value).toBeLessThanOrEqual(220);
          if (event.stream === 'spo2') expect(event.value).toBeGreaterThanOrEqual(70);
          if (event.stream === 'spo2') expect(event.value).toBeLessThanOrEqual(100);
          expect(event.t).toBeLessThanOrEqual(nowMs);
        }
        if (event.type === 'sleepEpochs') {
          expect(event.stages.length).toBeLessThanOrEqual(1_440);
          expect(event.start + event.stages.length * event.epochS * 1000).toBeLessThanOrEqual(nowMs);
        }
      }
    }
  });

  it('truncated frames at every byte boundary do not decode a partial record', () => {
    const whole = packets(frame(DT.HISTORY_HEART, envelope([...stamp(1_700_000_000), 72])))[0]!;
    const protocol = createLuckRingProtocol();
    for (let len = 0; len < 20; len++) {
      const result = protocol.ingest(whole.slice(0, len), { ...protocol.initialState(), nowMs });
      expect(result.events).toEqual([]);
    }
  });

  it('seeded valid wire frames with arbitrary payloads stay bounded after reassembly', () => {
    let seed = 0xbb67ae85;
    const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    const types = [DT.HISTORY_SPORT, DT.SLEEP, DT.HISTORY_HEART, DT.HISTORY_O2, DT.HISTORY_HRV, DT.HISTORY_TEMP];
    const protocol = createLuckRingProtocol();
    for (let i = 0; i < 1_000; i++) {
      let st = { ...protocol.initialState(), nowMs } as LuckRingState;
      const payload = Array.from({ length: next() % 180 }, () => next() & 255);
      for (const packet of packets(frame(types[next() % types.length]!, payload))) {
        const result = protocol.ingest(packet, st, undefined, nowMs);
        st = result.state as LuckRingState;
        for (const event of result.events) {
          if (event.type === 'sleepEpochs') expect(event.stages.length).toBeLessThanOrEqual(1_440);
          if (event.type === 'sample' && event.stream === 'hr') expect(event.value).toBeGreaterThanOrEqual(30);
          if (event.type === 'sample' && event.stream === 'spo2') expect(event.value).toBeLessThanOrEqual(100);
          if (event.type === 'activityBucket') expect(event.steps).toBeLessThanOrEqual(5_000);
        }
      }
    }
  });

  it('history cursor uses the calendar zone when the cached offset is stale at DST', () => {
    const protocol = createLuckRingProtocol();
    const start = protocol.begin!(
      { op: 'history', params: { dataType: DT.HISTORY_HEART, stream: 'hr', nowMs: Date.UTC(2024, 2, 10, 4, 30), tzOffsetS: -14_400, tz: 'America/New_York' } },
      protocol.initialState(),
    );
    const ended = protocol.timeout!(start.state, 'stall');
    expect(ended.events).toContainEqual({ type: 'status', key: 'cursor', value: 'lr1:2024-03-09', stream: 'hr' });
  });
});
