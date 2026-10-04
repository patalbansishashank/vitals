/**
 * Packet vectors from tahnok/colmi_r02_client tests (MIT, (c) 2024 Wesley Ellis): test_packet.py, test_battery.py,
 * test_set_time.py, test_real_time.py, test_hr.py, test_steps.py. Python bytes literals transcribed to hex.
 */
import { describe, expect, it } from 'vitest';
import {
  byteToBcd, colmiChecksum, createColmiProtocol, daysToRead, hrParse, makePacket, parseBattery, parseRealtime, readStepsPacket, realtimeStartPacket,
  realtimeStopPacket, setTimePacket, sportDetailStart, stepsParse, type ColmiState,
} from '../protocol';

const hex = (s: string): Uint8Array => Uint8Array.from((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** test_hr.py HEART_RATE_PACKETS (24 packets, 2024-08-10 UTC). */
const HR_PACKETS = [
  '15001805000000000000000000000032', '150180adb6660000000000000000005f', '15020000000000000000000000000017', '15030000000000000000000000000018',
  '15040000000000000000000000000019', '1505000000000000000000000000001a', '1506000000000000000000000000001b', '1507000000000000000000000000001c',
  '1508000000000000000000000000001d', '1509000000000000000000000000001e', '150a000000000000000000000000001f', '150b0000000000000000000000000020',
  '150c0000000000000000000000000021', '150d0000000000000000000000000022', '150e0000000000000000000000000023', '150f000059000000000000000000007d',
  '1510006b000000000000000000000090', '15116000000000000000000000006bf1', '15120000000000000000000000000027', '15130000000000000000000050000078',
  '1514000000000000000000460000006f', '1515000000000000000000000000002a', '1516000000000000000000000000002b', '1517000000000000000000000000002c'].map(hex);

describe('Colmi framing [tahnok tests]', () => {
  it('make_packet: 16 bytes, sub data, checksum', () => {
    const p = makePacket(1, [9, 8, 7]);
    expect(p.length).toBe(16);
    expect([...p.subarray(1, 4)]).toEqual([9, 8, 7]);
    expect(p[15]).toBe(colmiChecksum(p));
    expect(() => makePacket(256)).toThrow();
    expect(() => makePacket(1, new Array(15).fill(0))).toThrow();
  });

  it('sample checksum is 0x32', () => {
    expect(colmiChecksum(hex('150018050000000000000000000000'))).toBe(0x32);
  });

  it('BCD and set-time packets (UTC and a −4 h zone instant)', () => {
    expect([byteToBcd(0), byteToBcd(10), byteToBcd(99)]).toEqual([0, 0b00010000, 0b10011001]);
    expect(() => byteToBcd(100)).toThrow();
    expect(setTimePacket(Date.UTC(2024, 0, 1))).toEqual(hex('01240101000000010000000000000028'));
    expect(setTimePacket(Date.parse('2024-01-01T00:00:00-04:00'))).toEqual(hex('0124010104000001000000000000002c'));
    expect(() => setTimePacket(Date.UTC(1999, 0, 1))).toThrow();
  });

  it('battery parse', () => {
    expect(parseBattery(hex('034000000000000000000000000000' + '43'))).toEqual({ level: 64, charging: false });
  });

  it('real-time start/stop packets and readings', () => {
    for (const kind of [1, 2, 3, 4, 5, 7, 8, 9, 10]) {
      const s = realtimeStartPacket(kind);
      expect([s[0], s[1], s[2], s[15]]).toEqual([105, kind, 1, 105 + 1 + kind]);
      const t = realtimeStopPacket(kind);
      expect([t[0], t[1], t[2], t[3], t[15]]).toEqual([106, kind, 0, 0, 106 + kind]);
    }
    expect(parseRealtime(hex('6901004e0000000000000000000000b8'))).toEqual({ kind: 1, error: 0, value: 78 });
    expect(parseRealtime(hex('690101000000000000000000000000' + '6b'))).toEqual({ kind: 1, error: 1, value: 0 });
  });

  it('steps request packet', () => {
    expect([...readStepsPacket(2).subarray(0, 6)]).toEqual([0x43, 2, 0x0f, 0x00, 0x5f, 0x01]);
  });
});

describe('Colmi parsers [tahnok tests]', () => {
  it('HR log: none until the end, then 288 slots for 2024-08-10, index 295', () => {
    expect(HR_PACKETS).toHaveLength(24);
    expect(HR_PACKETS.every((p) => p.length === 16 && p[15] === colmiChecksum(p))).toBe(true);
    let p = { size: 0, range: 5, ts: null as number | null, raw: [] as number[], index: 0 };
    const today = Date.UTC(2026, 9, 1);
    for (const pkt of HR_PACKETS.slice(0, -1)) {
      const r = hrParse(p, pkt, today);
      expect(r.result).toBeUndefined();
      p = r.p;
    }
    expect(p.index + 13).toBe(295); // tahnok reports 295 after the final packet
    const r = hrParse(p, HR_PACKETS[23]!, today);
    expect(r.result).not.toBe('nodata');
    const res = r.result as { ts: number; range: number; rates: number[] };
    expect(res.ts).toBe(Date.UTC(2024, 7, 10));
    expect(res.range).toBe(5);
    expect(res.rates).toHaveLength(288);
    expect(res.rates.filter((v) => v > 0)).toEqual([0x59, 0x6b, 0x60, 0x6b, 0x50, 0x46]);
  });

  it('HR log no-data reply', () => {
    expect(hrParse({ size: 0, range: 5, ts: null, raw: [], index: 0 }, hex('15ff0000000000000000000000000014'), 0).result).toBe('nodata');
  });

  it('steps: simple and multi-packet vectors', () => {
    let p = { newCalorieProtocol: false, index: 0 };
    let r = stepsParse(p, hex('43f00101000000000000000000000035'));
    expect(r.detail).toBeUndefined();
    r = stepsParse(r.p, hex('432410155c0001790015001000000087'));
    expect(r.detail).toEqual({ year: 2024, month: 10, day: 15, timeIndex: 92, calories: 1210, steps: 21, distanceM: 16 });
    expect(r.done).toBe(true);
    expect(sportDetailStart(r.detail!)).toBe(Date.UTC(2024, 9, 15, 23, 0));

    const multi = [
      '43f00501000000000000000000000039', '43230813100005c80030001b000000a9', '43230813140105b618aa046903000083',
      '432308131802053804e1009500000052', '432308131c030505026c004800000060', '432308134c0405ef016300440000006d',
    ].map(hex);
    const got = [];
    p = { newCalorieProtocol: false, index: 0 };
    for (const pkt of multi) {
      const x = stepsParse(p, pkt);
      p = x.p;
      if (x.detail) got.push(x.detail);
      if (pkt !== multi[multi.length - 1]) expect(x.done).toBeFalsy();
      else expect(x.done).toBe(true);
    }
    expect(got.map((d) => [d.timeIndex, d.calories, d.steps, d.distanceM])).toEqual([
      [16, 2000, 48, 27], [20, 63260, 1194, 873], [24, 10800, 225, 149], [28, 5170, 108, 72], [76, 4950, 99, 68],
    ]);
    expect(stepsParse({ newCalorieProtocol: false, index: 0 }, hex('43ff0000000000000000000000000042')).nodata).toBe(true);
  });

  it('slot time indices 0 and 95', () => {
    const d = { year: 2025, month: 1, day: 1, calories: 0, steps: 0, distanceM: 0 };
    expect(sportDetailStart({ ...d, timeIndex: 0 })).toBe(Date.UTC(2025, 0, 1, 0, 0));
    expect(sportDetailStart({ ...d, timeIndex: 95 })).toBe(Date.UTC(2025, 0, 1, 23, 45));
  });
});

describe('Colmi protocol state machine', () => {
  const proto = createColmiProtocol();
  const NOW = Date.UTC(2024, 7, 10, 23, 59);

  it('days to read: capped at 7, resumes after the cursor, always includes today', () => {
    expect(daysToRead(null, NOW)).toHaveLength(7);
    expect(daysToRead('2024-08-08', NOW)).toEqual(['2024-08-09', '2024-08-10']);
    expect(daysToRead('2024-08-10', NOW)).toEqual(['2024-08-10']);
  });

  it('HR log for two days: samples, cursor advance for the finished day only, next-day follow-up', () => {
    let st = proto.begin!({ op: 'hrLog', params: { stream: 'hr', since: 'c1:2024-08-08', nowMs: NOW } }, proto.initialState()).state;
    const ts = Date.UTC(2024, 7, 9) / 1000;
    expect([...proto.frame({ op: 'hrLog', params: { since: 'c1:2024-08-08', nowMs: NOW } })[0]!.subarray(0, 5)]).toEqual([0x15, ts & 0xff, (ts >>> 8) & 0xff, (ts >>> 16) & 0xff, ts >>> 24]);
    const r1 = proto.ingest(hex('15ff0000000000000000000000000014'), st); // 08-09: no data
    expect(r1.events).toEqual([{ type: 'status', key: 'cursor', value: 'c1:2024-08-09', stream: 'hr' }]);
    expect(r1.send?.[0]).toMatchObject({ op: 'hrLog', params: { day: '2024-08-10' } });
    st = r1.state;
    let last;
    for (const pkt of HR_PACKETS) {
      last = proto.ingest(pkt, st);
      st = last.state;
    }
    expect(last!.done).toBe(true);
    const samples = last!.events.filter((e) => e.type === 'sample');
    expect(samples).toHaveLength(6);
    expect(samples[0]).toMatchObject({ stream: 'hr', value: 0x59, unit: 'bpm', origin: 'history' });
    expect(last!.events.some((e) => e.type === 'status' && e.key === 'cursor')).toBe(false); // today is never final
    expect((st as ColmiState).cursors.hr).toBe('c1:2024-08-09');
  });

  it('set time, battery and error-bit replies', () => {
    const st = proto.begin!({ op: 'battery', params: { nowMs: NOW } }, proto.initialState()).state;
    const r = proto.ingest(hex('034000000000000000000000000000' + '43'), st);
    expect(r.done).toBe(true);
    expect((r.state as ColmiState).battery).toBe(64);
    expect(proto.ingest(hex('83000000000000000000000000000083'), r.state).events[0]).toMatchObject({ key: 'error' });
  });
});
