// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fromHex } from '../../types';
import { decodeJl, decodeLegacy, jlFrame, legacyFrame } from '../codec';
import { decodeJlHistory, decodeLegacyPayload } from '../decoder';
import { initialRWfitState, rwfitProtocol } from '../protocol';

const ctx = { tzOffsetS: 0, firmware: 'jl' };
const seed = (start: number) => {
  let x = start;
  return () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), x >>> 0);
};

describe('RWfit bounded history and malformed frames', () => {
  it('preserves Kotlin raw decoder bytes and applies bridge bounds at the public protocol', () => {
    const rec = (v: number) => fromHex(`00 00 00 00 ${v.toString(16).padStart(2, '0')} 00`);
    const publicValue = (type: number, value: number) => rwfitProtocol.ingest(jlFrame([0x05, type, 0x10], rec(value)), { ...initialRWfitState(), framing: 'jl' }).events;
    expect(decodeJlHistory(0x03, rec(29), ctx)).toMatchObject([{ value: 29 }]);
    expect(publicValue(0x03, 29)).toEqual([]);
    expect(publicValue(0x03, 30)).toMatchObject([{ stream: 'hr', value: 30 }]);
    expect(publicValue(0x03, 220)).toMatchObject([{ stream: 'hr', value: 220 }]);
    expect(publicValue(0x03, 221)).toEqual([]);
    expect(decodeJlHistory(0x09, rec(69), ctx)).toMatchObject([{ value: 69 }]);
    expect(publicValue(0x09, 69)).toEqual([]);
    expect(publicValue(0x09, 70)).toMatchObject([{ stream: 'spo2', value: 70 }]);
    expect(publicValue(0x09, 100)).toMatchObject([{ stream: 'spo2', value: 100 }]);
    expect(publicValue(0x09, 101)).toEqual([]);
    const lowSpo2 = fromHex('00 00 00 00 00 01 00 00 00 00 45');
    expect(decodeLegacyPayload(0xa5, lowSpo2, ctx).events).toMatchObject([{ value: 69 }]);
    expect(rwfitProtocol.ingest(legacyFrame(0xa5, lowSpo2, 1), initialRWfitState()).events).toEqual([]);
  });

  it('does not emit a future sample or advance its cursor from it', () => {
    const now = 946_684_800_000;
    const body = fromHex('00 00 1c 21 48 00'); // epoch-2000 + 7201 seconds
    const st = { ...initialRWfitState(), framing: 'jl' as const, nowMs: now, inflight: { kind: 'history' as const, types: ['heart_rate' as const], waiting: ['heart_rate' as const], packets: 0, silenceMs: 0, newest: {} } };
    const result = rwfitProtocol.ingest(jlFrame([0x05, 0x03, 0x10], body), st);
    expect(result.events.some((e) => e.type === 'sample' || (e.type === 'status' && e.key === 'cursor'))).toBe(false);
  });

  it('requests the JL history catalog once per connection and rearms on reconnect', () => {
    const selected = rwfitProtocol.begin!({ op: 'selectFraming', params: { framing: 'jl' } }, initialRWfitState()).state;
    const burst = rwfitProtocol.planSync({}, selected);
    expect(burst).toHaveLength(1);
    const started = rwfitProtocol.begin!(burst[0]!, selected).state;
    expect(rwfitProtocol.planSync({}, started)).toEqual([]);
    const reconnected = rwfitProtocol.begin!({ op: 'selectFraming', params: { framing: 'jl' } }, started).state;
    expect(rwfitProtocol.planSync({}, reconnected)).toHaveLength(1);
  });

  it('matches Kotlin legacy winter DST correction when an IANA zone is available', () => {
    const raw = Math.floor(Date.parse('2025-01-15T12:00:00Z') / 1000) - 14_400;
    const bytes = [(raw >>> 24) & 255, (raw >>> 16) & 255, (raw >>> 8) & 255, raw & 255];
    const payload = Uint8Array.from([...bytes, 0, 1, ...bytes, 72]);
    const st = { ...initialRWfitState(), tz: 'America/New_York', tzOffsetS: -18_000, nowMs: Date.parse('2025-01-15T12:00:00Z') };
    const r = rwfitProtocol.ingest(legacyFrame(0xa3, payload, 1), st);
    expect(r.events).toMatchObject([{ type: 'sample', stream: 'hr', t: (raw + 14_400) * 1000, value: 72 }]);
  });

  it('uses notification time for bounds and rejects an old history record', () => {
    const epoch = 946_684_800_000;
    const frame = jlFrame([0x05, 0x03, 0x10], fromHex('00 00 00 00 48 00'));
    const st = { ...initialRWfitState(), framing: 'jl' as const, nowMs: epoch - 10_000 };
    expect(rwfitProtocol.ingest(frame, st).events.some((e) => e.type === 'sample')).toBe(false);
    expect(rwfitProtocol.ingest(frame, st, undefined, epoch + 1_000).events).toMatchObject([{ type: 'sample', stream: 'hr', t: epoch }]);
    expect(rwfitProtocol.ingest(frame, st, undefined, Date.parse('2026-07-06T00:00:00Z')).events.some((e) => e.type === 'sample')).toBe(false);
  });

  it('seeded random and every truncated prefix stay inside the protocol', () => {
    const next = seed(0x52f17);
    for (let k = 0; k < 300; k++) {
      const raw = Uint8Array.from({ length: next() % 64 }, () => next() & 0xff);
      for (const bytes of [raw, ...Array.from({ length: raw.length }, (_, i) => raw.subarray(0, i))]) {
        expect(() => decodeLegacy(bytes, {})).not.toThrow();
        expect(() => decodeJl(bytes, null)).not.toThrow();
        for (const framing of ['legacy', 'jl'] as const) {
          const r = rwfitProtocol.ingest(bytes, { ...initialRWfitState(), framing, nowMs: 946_684_800_000 });
          for (const e of r.events) if (e.type === 'sample') {
            if (e.stream === 'hr') expect(e.value).toBeGreaterThanOrEqual(25);
            if (e.stream === 'spo2') expect(e.value).toBeGreaterThanOrEqual(70);
          }
        }
      }
    }
    expect(() => decodeLegacy(legacyFrame(0xa3, new Uint8Array(0), 1), {})).not.toThrow();
  });
});
