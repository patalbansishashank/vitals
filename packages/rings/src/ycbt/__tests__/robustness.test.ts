// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assemble, frameLogical, ringTimeToMs, validateFrame } from '../commands';
import { localDay, toRingEvents, type YcbtDecoded } from '../decoder';
import { initialYcbtState, createYcbtProtocol } from '../protocol';

const seed = (start: number) => {
  let x = start;
  return () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), x >>> 0);
};

describe('YCBT bounded history and malformed frames', () => {
  it('maps local day to the actual midnight offset on DST transition days', () => {
    const zone = { tz: 'America/New_York', tzOffsetS: 0 };
    expect(localDay(Date.parse('2024-03-10T16:00:00Z'), zone)).toBe(Date.parse('2024-03-10T05:00:00Z'));
    expect(localDay(Date.parse('2024-11-03T18:00:00Z'), zone)).toBe(Date.parse('2024-11-03T04:00:00Z'));
  });

  it('applies Kotlin event bridge limits to decoded samples', () => {
    const zone = { tzOffsetS: 0 };
    const mapped = (d: YcbtDecoded) => toRingEvents(d, zone, '1.0');
    for (const bpm of [0, 29, 221, 255]) expect(mapped({ kotlin: 'HeartRateSample', bpm, _timestamp: 1 })).toEqual([]);
    for (const value of [0, 69, 101, 255]) expect(mapped({ kotlin: 'HistoryMeasurement', kind_field: 'SPO2', value, _timestamp: 1 })).toEqual([]);
    expect(mapped({ kotlin: 'HistoryMeasurement', kind_field: 'HEART_RATE', value: 220, _timestamp: 1 })).toMatchObject([{ stream: 'hr', value: 220 }]);
    expect(mapped({ kotlin: 'HistoryMeasurement', kind_field: 'SPO2', value: 70, _timestamp: 1 })).toMatchObject([{ stream: 'spo2', value: 70 }]);
  });

  it('keeps or rejects blood pressure as one pair, as the Kotlin bridge does', () => {
    const zone = { tzOffsetS: 0 };
    const pair = (systolic: number, diastolic: number) => toRingEvents({ kotlin: 'BloodPressureSample', systolic, diastolic, _timestamp: 1, isHistory: true }, zone, '1.0');
    expect(pair(120, 80).map((e) => e.type === 'vendor' ? e.value : null)).toEqual([120, 80]);
    expect(pair(120, 160)).toEqual([]);
    expect(pair(55, 80)).toEqual([]);
  });

  it('rejects timestamps beyond the ring clock at receive time', () => {
    const p = createYcbtProtocol();
    const now = Date.parse('2026-07-06T12:00:00Z');
    const ringS = Math.floor((now + 7_200_000) / 1000) - 946_684_800;
    const bytes = [ringS & 255, (ringS >> 8) & 255, (ringS >> 16) & 255, (ringS >> 24) & 255];
    const st = { ...initialYcbtState(), nowMs: now, tz: 'UTC' };
    const result = p.ingest(frameLogical([0x06, 0x13, ...bytes, 1]), st);
    expect(result.events.some((e) => e.type === 'vendor' && e.key === 'ycbt_worn')).toBe(false);
    expect(ringTimeToMs(ringS, { tz: 'UTC', tzOffsetS: 0 })).toBe(now + 7_200_000);
  });

  it('stamps live frames at notification time while leaving the history anchor unchanged', () => {
    const p = createYcbtProtocol();
    const st = { ...initialYcbtState(), nowMs: 1_000 };
    const r = p.ingest(frameLogical([0x06, 0x01, 72]), st, undefined, 3_000);
    expect(r.events).toMatchObject([{ type: 'sample', stream: 'hr', t: 3_000, value: 72 }]);
    expect(r.state).toMatchObject({ nowMs: 1_000 });
  });

  it('seeded random notifications and all truncated prefixes never throw', () => {
    const next = seed(0x6cb700);
    const p = createYcbtProtocol();
    for (let k = 0; k < 300; k++) {
      const raw = Uint8Array.from({ length: next() % 64 }, () => next() & 0xff);
      for (const bytes of [raw, ...Array.from({ length: raw.length }, (_, i) => raw.subarray(0, i))]) {
        expect(() => validateFrame(bytes)).not.toThrow();
        const assembled = assemble({}, bytes, 'stream');
        expect(assembled.buffers.stream?.length).toBeLessThan(1025);
        const r = p.ingest(bytes, { ...initialYcbtState(), nowMs: Date.parse('2026-07-06T12:00:00Z') });
        for (const e of r.events) if (e.type === 'sample') {
          if (e.stream === 'hr') expect(e.value).toBeGreaterThanOrEqual(25);
          if (e.stream === 'spo2') expect(e.value).toBeGreaterThanOrEqual(70);
        }
      }
    }
  });
});
