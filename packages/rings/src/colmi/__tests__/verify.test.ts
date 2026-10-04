// @vitest-environment node
/**
 * Independent verifier checks for the Colmi port (written by a second reader of the Kotlin; no helper from the author's
 * tests is reused). It re-derives every checksum and CRC with its own code, replays EVERY decode vector through
 * `protocol.ingest` and every encode vector through `protocol.frame`, hand-checks the clock/day-stamp rules at month and
 * year boundaries and negative UTC offsets against numbers worked out from `ColmiEncoder.kt` / `ColmiSyncEngine.kt`,
 * checks `scan.match` against the Kotlin name regexes, and replays the sessions the author's tests leave out.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Advertisement, RingEvent } from '../../types';
import { fromHex, toHex } from '../../types';
import { COLMI_UUIDS } from '../commands';
import { colmi, matchColmi } from '../family';
import type { ColmiState } from '../protocol';

const ROOT = join(__dirname, '../../../../..', 'qa/fixtures/rings/colmi');
const load = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const P = colmi.protocol;
const NOTIFY = COLMI_UUIDS.notify;
const BIGDATA = COLMI_UUIDS.bigData;
const bytesOf = (h: string): number[] => h.trim().split(/\s+/).map((x) => parseInt(x, 16));

// ---- my own checksum / CRC (a different formulation from commands.ts: CRC16/MODBUS as poly 0x8005 with reflected in/out)
const sum15 = (b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < 15; i++) s = (s + b[i]!) % 256;
  return s;
};
const reflect = (v: number, bits: number): number => {
  let r = 0;
  for (let i = 0; i < bits; i++) if (v & (1 << i)) r |= 1 << (bits - 1 - i);
  return r;
};
function modbusCrc(payload: number[]): number {
  let crc = 0xffff;
  for (const byte of payload) {
    crc ^= reflect(byte, 8) << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return reflect(crc, 16);
}
const frame16 = (content: number[]): number[] => {
  const b = [...content, ...new Array(15 - content.length).fill(0)];
  return [...b, sum15(b)];
};

// ---- my mapping Kotlin event -> RingEvent (from docs/colmi.md section 12, written independently of toRingEvents)
type K = Record<string, unknown>;
const STAGES = ['light', 'deep', 'rem', 'awake'];
function expectedRingEvents(ks: K[], op: number, tzOffsetS: number): RingEvent[] {
  const out: RingEvent[] = [];
  for (const k of ks) {
    const t = typeof k._timestamp === 'string' ? Date.parse(k._timestamp) : 0;
    switch (k.kotlin) {
      case 'Battery':
        out.push({ type: 'status', key: 'battery', value: k.percent as number });
        break;
      case 'HeartRateSample':
        out.push({ type: 'sample', stream: 'hr', t, value: k.bpm as number, unit: 'bpm', origin: op === 0x78 ? 'workout_stream' : 'live' });
        break;
      case 'HeartRateComplete':
      case 'Spo2Complete':
        out.push({ type: 'status', key: 'error', value: 'no_reading' });
        break;
      case 'Spo2Result':
        out.push({ type: 'sample', stream: 'spo2', t, value: k.value as number, unit: 'pct', origin: 'spot' });
        break;
      case 'ActivityUpdate': {
        const day = Math.floor((t / 1000 + tzOffsetS) / 86400);
        out.push({ type: 'dailyTotal', localDay: (day * 86400 - tzOffsetS) * 1000, steps: k.steps as number, distanceM: k.distanceMeters as number, kcal: k.calories as number });
        break;
      }
      case 'HistoryMeasurement': {
        const kind = k.kind_field as string;
        if (kind === 'HEART_RATE') out.push({ type: 'sample', stream: 'hr', t, value: k.value as number, unit: 'bpm', origin: 'history' });
        else if (kind === 'HRV') out.push({ type: 'sample', stream: 'hrv', t, value: k.value as number, unit: 'ms', origin: 'history' });
        else if (kind === 'SPO2') out.push({ type: 'sample', stream: 'spo2', t, value: k.value as number, unit: 'pct', origin: 'history' });
        break;
      }
      case 'ActivityBucket':
        out.push({ type: 'activityBucket', start: t, durS: 900, steps: k.steps as number, distanceM: k.distanceMeters as number });
        break;
      case 'TemperatureSample':
        out.push({ type: 'sample', stream: 'skin_temp', t, value: k.celsius as number, unit: 'degC', origin: 'history' });
        break;
      case 'SleepTimeline': {
        const runs = k.stagesRunLength as Array<{ stage: string; minutes: number }>;
        const stages: string[] = [];
        for (const r of runs) for (let i = 0; i < r.minutes; i++) stages.push(r.stage.toLowerCase());
        out.push({ type: 'sleepEpochs', start: t, epochS: 60, stages: stages as never, rawCodes: stages.map((s) => (STAGES.indexOf(s) >= 0 ? STAGES.indexOf(s) + 2 : 0)), firmware: '', complete: false } as RingEvent);
        break;
      }
      default:
        break; // Unknown, CommandAck, SportTelemetry, ColmiAutoHRReadout ...: no RingEvent
    }
  }
  return out;
}
const noonOf = (isoDay: string, tz: number): number => Date.parse(`${isoDay}T12:00:00Z`) - tz * 1000;
const base = (nowMs: number, tzOffsetS: number): ColmiState => ({ ...(P.initialState() as ColmiState), nowMs, tzOffsetS });

describe('verify: checksums and CRCs recomputed with my own code', () => {
  const enc = load('encode.json').vectors as Array<{ name: string; frame: string; channel: string; command: { op: string; params: Record<string, unknown> } }>;
  const dec = load('decode.json').vectors as Array<{ name: string; decoder: string; bytes?: string; bytesSequence?: string[]; valid?: boolean; channel?: string }>;
  const sess = load('sessions.json').sessions as Array<{ name: string; steps: Array<{ expectWrite: string; notify?: string[]; notifyChannel?: string }> }>;

  it('every encode.json frame: 16 bytes + sum, or a big-data header with length and CRC16/MODBUS', () => {
    for (const v of enc) {
      const b = bytesOf(v.frame);
      if (b[0] === 0xbc) {
        expect(v.channel, v.name).toBe('command');
        const payload = b.slice(6);
        expect(b[2]! | (b[3]! << 8), v.name).toBe(payload.length);
        expect(b[4]! | (b[5]! << 8), v.name).toBe(modbusCrc(payload));
      } else {
        expect(v.channel, v.name).toBe('write');
        expect(b.length, v.name).toBe(16);
        expect(b[15], v.name).toBe(sum15(b));
      }
    }
  });

  it('my CRC agrees with the two Kotlin comments (ff 01 -> 81 80 on the wire; payload 06 -> 3f 42)', () => {
    expect(modbusCrc([0xff, 0x01])).toBe(0x8081);
    expect(modbusCrc([0x06])).toBe(0x423f);
  });

  it('every valid normal-channel decode and session frame carries a correct checksum; only the declared-invalid one fails', () => {
    for (const v of dec) {
      const seq = v.bytes ? [v.bytes] : v.bytesSequence ?? [];
      for (const h of seq) {
        const b = bytesOf(h);
        if (v.channel === 'bigData' || b[0] === 0xbc) continue;
        if (b.length !== 16) continue;
        const ok = sum15(b) === b[15];
        if (v.decoder === 'ColmiPacket.validating') expect(ok, v.name).toBe(v.valid);
        else if (!ok) expect(/bad checksum/.test(v.name), `decode vector with an undeclared bad checksum: ${v.name} (${h})`).toBe(true);
      }
    }
    for (const s of sess)
      for (const st of s.steps) {
        const w = bytesOf(st.expectWrite);
        if (w[0] !== 0xbc) {
          expect(w.length, s.name).toBe(16);
          expect(w[15], `${s.name} ${st.expectWrite}`).toBe(sum15(w));
        }
        for (const n of st.notify ?? []) {
          const b = bytesOf(n);
          if (st.notifyChannel === 'bigData' || b[0] === 0xbc) continue;
          expect(b[15], `${s.name} notify ${n}`).toBe(sum15(b));
        }
      }
  });
});

describe('verify: every encode vector through protocol.frame', () => {
  const enc = load('encode.json').vectors as Array<{ name: string; frame: string; channel: string; content: string; command: { op: string; params?: Record<string, unknown> } }>;
  it('69 vectors: bytes, channel, and content (frame = content zero padded + checksum)', () => {
    expect(enc.length).toBe(69);
    const st = P.initialState();
    for (const v of enc) {
      const out = P.frame(v.command as never, st);
      expect(out.length, v.name).toBe(1);
      expect(toHex(out[0]!.bytes), v.name).toBe(v.frame);
      expect(out[0]!.channel ?? 'write', v.name).toBe(v.channel);
      if (v.channel === 'write') expect(Array.from(out[0]!.bytes), v.name).toEqual(frame16(bytesOf(v.content)));
    }
  });
});

describe('verify: every decode vector through protocol.ingest', () => {
  const vecs = load('decode.json').vectors as Array<{
    name: string; decoder: string; context?: Record<string, number | string>; bytes?: string; bytesSequence?: string[]; valid?: boolean;
    derivedEvents?: K[]; derivedEventsAfterEachChunk?: K[][];
  }>;
  const g = (d: string) => vecs.filter((v) => v.decoder === d);

  it('covers all 57 vectors in its routing', () => {
    const routed = ['ColmiDecoder.decodeNormal', 'ColmiPacket.validating', 'ColmiDecoder.decodeHistory', 'ColmiDecoder.decodeAutoHRPrefRead', 'ColmiDecoder.decodeTempPrefRead',
      'ColmiDecoder.decodeDeviceSupport', 'ColmiDecoder.decodeBigData', 'ColmiDecoder.decodeIntervalTemperature', 'ColmiDriver.ingest (big-data reassembly)', 'ColmiSyncEngine.handleHistoryFrame'];
    expect(vecs.filter((v) => routed.includes(v.decoder)).length).toBe(57);
  });

  it('decodeNormal (24) and validating (2): events as the mapping table says, state side effects as the Kotlin has them', () => {
    for (const v of [...g('ColmiDecoder.decodeNormal'), ...g('ColmiPacket.validating')]) {
      const b = fromHex(v.bytes!);
      const now = (v.context?.nowMs as number | undefined) ?? 1784282400000;
      const r = P.ingest(b, base(now, 0), NOTIFY);
      const ks = v.derivedEvents ?? [];
      expect(r.events, v.name).toEqual(expectedRingEvents(ks, b[0]!, 0));
      if (v.decoder === 'ColmiPacket.validating' && !v.valid) expect(r.events, v.name).toEqual([]);
    }
  });

  it('decodeHistory (6): each frame as the first frame of its stage, anchored on the vector day', () => {
    const stageOf: Record<number, string> = { 0x15: 'hr', 0x37: 'stress', 0x39: 'hrv', 0x43: 'activity' };
    for (const v of g('ColmiDecoder.decodeHistory')) {
      const c = v.context as { day: string; tzOffsetS: number; nowMs: number };
      const b = fromHex(v.bytes!);
      const todayLocal = new Date(c.nowMs + c.tzOffsetS * 1000).toISOString().slice(0, 10);
      // Activity packets carry their own BCD date; only the paged logs need the vector day to be "today".
      if (b[0] !== 0x43) expect(todayLocal, `${v.name}: vector day must be the local day of nowMs for this routing`).toBe(c.day);
      const st = P.begin!({ op: 'history', params: { stage: stageOf[b[0]!]!, lastDay: 0, nowMs: c.nowMs, tzOffsetS: c.tzOffsetS } }, P.initialState()).state;
      const r = P.ingest(b, st, NOTIFY);
      expect(r.events.filter((e) => e.type !== 'status'), v.name).toEqual(expectedRingEvents(v.derivedEvents!, b[0]!, c.tzOffsetS));
    }
  });

  it('pref and capability replies (14): state carries exactly what the Kotlin decoders return', () => {
    for (const v of g('ColmiDecoder.decodeAutoHRPrefRead')) {
      const r = P.ingest(fromHex(v.bytes!), base(0, 0), NOTIFY).state as ColmiState;
      const e = v.derivedEvents![0] as { enabled: boolean; intervalMinutes: number } | undefined;
      expect(r.hrPref, v.name).toEqual(e ? { enabled: e.enabled, intervalMinutes: e.intervalMinutes } : null);
    }
    for (const v of g('ColmiDecoder.decodeTempPrefRead')) {
      const r = P.ingest(fromHex(v.bytes!), base(0, 0), NOTIFY).state as ColmiState;
      const e = v.derivedEvents![0] as { value: boolean } | undefined;
      expect(r.tempPref, v.name).toBe(e ? e.value : null);
    }
    for (const v of g('ColmiDecoder.decodeDeviceSupport')) {
      const r = P.ingest(fromHex(v.bytes!), base(0, 0), NOTIFY).state as ColmiState;
      const e = v.derivedEvents![0] as { supportsBlePair: boolean; supportsIntervalTemp: boolean } | undefined;
      expect({ p: r.supportsBlePair, t: r.supportsIntervalTemp }, v.name).toEqual({ p: e?.supportsBlePair ?? false, t: e?.supportsIntervalTemp ?? false });
    }
  });

  it('big data (5) and interval temperature (2) on the V2 channel', () => {
    for (const v of g('ColmiDecoder.decodeBigData')) {
      const tz = v.context!.tzOffsetS as number;
      // Some synthetic nap vectors end after noon; stamp the receive clock after their last minute.
      const r = P.ingest(fromHex(v.bytes!), base(noonOf(v.context!.todayLocal as string, tz) + 6 * 3_600_000, tz), BIGDATA);
      expect(r.events, v.name).toEqual(expectedRingEvents(v.derivedEvents!, 0xbc, tz));
    }
    for (const v of g('ColmiDecoder.decodeIntervalTemperature')) {
      const tz = v.context!.tzOffsetS as number;
      const st = { ...base(noonOf(v.context!.todayLocal as string, tz), tz), intervalOffset: v.context!.sampleOffset as number };
      // The Kotlin driver zeroes the offset on packet index 0, so a vector with an offset is reached as packet 1.
      const raw = fromHex(v.bytes!);
      if ((v.context!.sampleOffset as number) > 0) raw[9] = 1;
      const r = P.ingest(raw, st, BIGDATA);
      expect(r.events, v.name).toEqual(expectedRingEvents(v.derivedEvents!, 0xbc, tz));
    }
  });

  it('reassembly (3) chunk by chunk, and the HR echo vector (1)', () => {
    for (const v of g('ColmiDriver.ingest (big-data reassembly)')) {
      const tz = v.context!.tzOffsetS as number;
      let st: ColmiState = base(noonOf(v.context!.todayLocal as string, tz), tz);
      v.bytesSequence!.forEach((h, i) => {
        const r = P.ingest(fromHex(h), st, BIGDATA);
        st = r.state as ColmiState;
        expect(r.events, `${v.name} chunk ${i}`).toEqual(expectedRingEvents(v.derivedEventsAfterEachChunk![i]!, 0xbc, tz));
      });
      expect(st.bigData, v.name).toBeNull();
    }
    const [h] = g('ColmiSyncEngine.handleHistoryFrame');
    const c = h!.context as { nowMs: number; tzOffsetS: number };
    let st = P.begin!({ op: 'history', params: { stage: 'hr', lastDay: 0, nowMs: c.nowMs, tzOffsetS: c.tzOffsetS } }, P.initialState()).state;
    h!.bytesSequence!.forEach((x, i) => {
      const r = P.ingest(fromHex(x), st, NOTIFY);
      st = r.state;
      expect(r.events.filter((e) => e.type !== 'status'), `chunk ${i}`).toEqual(expectedRingEvents(h!.derivedEventsAfterEachChunk![i]!, 0x15, c.tzOffsetS));
    });
  });
});

describe('verify: clock and day-stamp rules (hand-worked from ColmiEncoder.setDateTime / ColmiSyncEngine.requestHeartRate)', () => {
  const T = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => Date.UTC(y, mo - 1, d, h, mi, s);
  const setTime = (nowMs: number, tzOffsetS: number, language?: string): string =>
    toHex(P.frame({ op: 'setTime', params: { nowMs, tzOffsetS, ...(language ? { language } : {}) } }, P.initialState())[0]!.bytes).slice(0, 23);

  it('setTime is the local wall clock in BCD, across a month boundary, a year boundary and a negative offset', () => {
    // 2026-07-31 23:30:15Z at +02:00 is 2026-08-01 01:30:15 local.
    expect(setTime(T(2026, 7, 31, 23, 30, 15), 7200)).toBe('01 26 08 01 01 30 15 01');
    // 2026-08-01 01:30:15Z at -05:00 is 2026-07-31 20:30:15 local (BCD 0x31 for the day).
    expect(setTime(T(2026, 8, 1, 1, 30, 15), -18000)).toBe('01 26 07 31 20 30 15 01');
    // 2027-01-01 02:00:00Z at -08:00 is 2026-12-31 18:00:00 local.
    expect(setTime(T(2027, 1, 1, 2, 0, 0), -28800)).toBe('01 26 12 31 18 00 00 01');
    // Half-hour offset east, leap day: 2028-02-28 22:45:59Z at +05:30 is 2028-02-29 04:15:59.
    expect(setTime(T(2028, 2, 28, 22, 45, 59), 19800)).toBe('01 28 02 29 04 15 59 01');
    // Language byte: 'zh' selects 0x00, anything else 0x01 (ColmiEncoder.setDateTime).
    expect(setTime(T(2026, 7, 31, 23, 30, 15), 7200, 'zh')).toBe('01 26 08 01 01 30 15 00');
  });

  const hr = (nowMs: number, tz: number, daysAgo: number): number[] => {
    const f = P.frame({ op: 'syncHeartRate', params: { daysAgo, nowMs, tzOffsetS: tz } }, P.initialState())[0]!.bytes;
    return Array.from(f.slice(1, 5));
  };
  const le32 = (secs: number): number[] => {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, secs, true);
    return Array.from(new Uint8Array(dv.buffer));
  };

  it('HR day request is the LOCAL calendar date at 00:00 UTC, u32 LE, minus whole days', () => {
    // Local date 2026-08-01 (03:30 at +02:00); one day ago is 2026-07-31.
    expect(hr(T(2026, 8, 1, 1, 30), 7200, 0)).toEqual(le32(T(2026, 8, 1) / 1000));
    expect(hr(T(2026, 8, 1, 1, 30), 7200, 1)).toEqual(le32(T(2026, 7, 31) / 1000));
    // Same instant at -05:00 is still 2026-07-31 locally; 31 days back is 2026-06-30.
    expect(hr(T(2026, 8, 1, 1, 30), -18000, 0)).toEqual(le32(T(2026, 7, 31) / 1000));
    expect(hr(T(2026, 8, 1, 1, 30), -18000, 31)).toEqual(le32(T(2026, 6, 30) / 1000));
    // Year boundary.
    expect(hr(T(2027, 1, 1, 2, 0), -28800, 0)).toEqual(le32(T(2026, 12, 31) / 1000));
    expect(hr(T(2026, 12, 31, 23, 0), 7200, 0)).toEqual(le32(T(2027, 1, 1) / 1000));
  });

  it('HR history is placed on the local grid (packet n offset (9 + (n-2)*13) slots) and the cursor is the LOCAL date, west of UTC', () => {
    const now = T(2026, 8, 1, 1, 30); // local 2026-07-31 20:30 at -05:00
    const tz = -18000;
    let st = P.begin!({ op: 'history', params: { stage: 'hr', lastDay: 0, nowMs: now, tzOffsetS: tz } }, P.initialState()).state;
    const feed = (c: number[]) => {
      const r = P.ingest(Uint8Array.from(frame16(c)), st, NOTIFY);
      st = r.state;
      return r;
    };
    feed([0x15, 0, 3, 5]);
    const p1 = feed([0x15, 1, 0, 0, 0, 0, 60, 61]);
    const mid = T(2026, 7, 31, 5, 0); // local midnight of 07-31 at -05:00
    expect(p1.events).toEqual([
      { type: 'sample', stream: 'hr', t: mid, value: 60, unit: 'bpm', origin: 'history' },
      { type: 'sample', stream: 'hr', t: mid + 5 * 60_000, value: 61, unit: 'bpm', origin: 'history' },
    ]);
    const p2 = feed([0x15, 2, 70]);
    expect(p2.events[0]).toEqual({ type: 'sample', stream: 'hr', t: mid + 45 * 60_000, value: 70, unit: 'bpm', origin: 'history' });
    expect(p2.done).toBe(true);
    expect(p2.events.at(-1)).toEqual({ type: 'status', key: 'cursor', value: 'c1:2026-07-31', stream: 'hr' });
  });

  it('stress packet 1 re-anchors on its day echo; packet 2 sits (12 + 0) slots later at the packet-0 cadence', () => {
    const now = T(2026, 8, 1, 1, 30);
    const tz = 7200; // local 2026-08-01 03:30
    let st = P.begin!({ op: 'history', params: { stage: 'stress', lastDay: 0, nowMs: now, tzOffsetS: tz } }, P.initialState()).state;
    const feed = (c: number[]) => {
      const r = P.ingest(Uint8Array.from(frame16(c)), st, NOTIFY);
      st = r.state;
      return r;
    };
    feed([0x37, 0, 3, 15]);
    const p1 = feed([0x37, 1, 2, 40, 41]); // echo day offset 2 -> 2026-07-30
    const mid = T(2026, 7, 29, 22, 0); // local midnight of 07-30 at +02:00
    expect(p1.events).toEqual([
      { type: 'vendor', key: 'stress', t: mid, value: 40, unit: 'vendor_units', origin: 'history' },
      { type: 'vendor', key: 'stress', t: mid + 15 * 60_000, value: 41, unit: 'vendor_units', origin: 'history' },
    ]);
    const p2 = feed([0x37, 2, 50]);
    expect(p2.events[0]).toMatchObject({ t: mid + 180 * 60_000, value: 50 });
  });

  it('activity window: Kotlin decoder accepts +1h; public events stop at the session clock', () => {
    const tz = -18000;
    const slotT = T(2026, 7, 17, 15, 0); // local 10:00 on 2026-07-17 at -05:00 = slot 40
    const bucket = (now: number) => {
      const st = P.begin!({ op: 'history', params: { stage: 'activity', lastDay: 0, nowMs: now, tzOffsetS: tz } }, P.initialState()).state;
      return P.ingest(Uint8Array.from(frame16([0x43, 0x26, 0x07, 0x17, 40, 0, 5, 0, 0, 0x2c, 0x01, 0x64, 0x00])), st, NOTIFY).events;
    };
    const kept = [{ type: 'activityBucket', start: slotT, durS: 900, steps: 300, distanceM: 100 }];
    expect(bucket(slotT + 8 * 86_400_000)).toEqual(kept); // Kotlin: ts < lower -> drop, so equal is kept
    expect(bucket(slotT + 8 * 86_400_000 - 1)).toEqual(kept);
    expect(bucket(slotT + 8 * 86_400_000 + 1)).toEqual([]);
    expect(bucket(slotT)).toEqual(kept);
    expect(bucket(slotT - 3_600_000)).toEqual([]);
    expect(bucket(slotT - 3_600_000 - 1)).toEqual([]);
  });

  it('big-data day blocks use the local "today" (west of UTC late evening, east of UTC just after midnight)', () => {
    // SpO2 block for daysAgo 0, hour 0 = (90, 94) -> 92.
    const payload = [0, 90, 94, ...new Array(46).fill(0)];
    const frame = [0xbc, 0x2a, payload.length, 0, 0, 0, ...payload];
    const west = P.ingest(Uint8Array.from(frame), base(T(2026, 8, 1, 1, 30), -18000), BIGDATA).events;
    expect(west).toEqual([{ type: 'sample', stream: 'spo2', t: T(2026, 7, 31, 5, 0), value: 92, unit: 'pct', origin: 'history' }]);
    const east = P.ingest(Uint8Array.from(frame), base(T(2026, 7, 31, 23, 30), 7200), BIGDATA).events;
    expect(east).toEqual([{ type: 'sample', stream: 'spo2', t: T(2026, 7, 31, 22, 0), value: 92, unit: 'pct', origin: 'history' }]);
  });
});

describe('verify: scan.match against every Kotlin name rule and service', () => {
  // The 13 Colmi-family regexes of WearableModel.kt (COLMI_R02..R12, YAWELL_R05/R10/R11, H59), copied as written there.
  const KOTLIN = [/^R02_.*/, /^R03_.*/, /^R06_.*/, /^COLMI R07_.*/, /^R08_.*/, /^R09_.*/, /^COLMI R10_.*/, /^R11C_[0-9A-F]{4}$/, /^COLMI R12_.*/, /^R05_[0-9A-F]{4}$/, /^R10_[0-9A-F]{4}$/, /^R11_[0-9A-F]{4}$/, /^H59_.*/];
  const OTHER_FAMILIES = [/^J-Style Smart Ring.*$/, /^SMART_RING$/, /^TK5 [0-9A-Fa-f]{4}$/, /^TK18([ _-].*)?$/, /^R10M[ _][0-9A-F]{4}$/, /^R100(_[0-9A-Fa-f]+)?$/];
  const ad = (name: string | undefined, serviceUuids: string[] = []): Advertisement => ({ name, serviceUuids, manufacturerData: [] });
  const names: string[] = [];
  for (const p of ['R02', 'R03', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R11C', 'R12', 'H59', 'COLMI R07', 'COLMI R10', 'COLMI R12', 'Colmi R10', 'R100', 'R10M', 'R13', 'R1', 'TK5'])
    for (const sep of ['_', ' ', '-', ''])
      for (const tail of ['', '1A2B', '1a2b', '12345', '123', 'ZZZZ', 'x']) names.push(`${p}${sep}${tail}`);
  names.push('', ' R02_1A2B', 'xR02_1A2B', 'r02_1A2B', 'J-Style Smart Ring', 'SMART_RING', 'SMART_RING_2', 'TK5 1234', 'TK18 1', 'R99 54DC', 'RW123');

  it('agrees with the Kotlin regexes on a name grid (first-match catalog semantics: no other family claims these names)', () => {
    for (const n of names) {
      const kotlin = KOTLIN.some((r) => r.test(n)) && !OTHER_FAMILIES.some((r) => r.test(n));
      expect(matchColmi(ad(n)), JSON.stringify(n)).toBe(kotlin);
      expect(colmi.scan.match(ad(n)), JSON.stringify(n)).toBe(kotlin);
    }
  });

  it('every matching name is reachable by a Web Bluetooth namePrefix filter', () => {
    const prefixes = colmi.scan.requestFilters.map((f) => f.namePrefix).filter((p): p is string => !!p);
    for (const n of names) if (KOTLIN.some((r) => r.test(n))) expect(prefixes.some((p) => n.startsWith(p)), n).toBe(true);
  });

  it('claims the V1 and V2 service in any case, ignores a manufacturer block and other services', () => {
    expect(matchColmi(ad(undefined, ['6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E']))).toBe(true);
    expect(matchColmi(ad(undefined, ['de5bf728-d711-4e47-af26-65e3012a5dc7']))).toBe(true);
    expect(matchColmi({ name: undefined, serviceUuids: [], manufacturerData: [Uint8Array.from([0x64, 0xff, 1, 2])] })).toBe(false);
    expect(matchColmi(ad(undefined, ['0000fff0-0000-1000-8000-00805f9b34fb']))).toBe(false);
  });

  it('optionalServices lists V1, V2 and the Device Information service; notify covers both channels', () => {
    expect(new Set(colmi.scan.optionalServices)).toEqual(new Set([COLMI_UUIDS.serviceV1, COLMI_UUIDS.serviceV2, COLMI_UUIDS.deviceInfo]));
    expect(colmi.gatt.notify.map((n) => n.characteristic)).toEqual([COLMI_UUIDS.notify, COLMI_UUIDS.bigData]);
  });
});

describe('verify: the sessions the author leaves out, as far as the contract reaches', () => {
  const sess = load('sessions.json').sessions as Array<{ name: string; steps: Array<{ expectWrite: string; notify?: string[]; action?: string }> }>;
  const get = (n: string) => sess.find((s) => s.name === n)!;
  const clock = { nowMs: 1784282400000, tzOffsetS: 7200 };
  const w = (op: string, params?: Record<string, unknown>, st = P.initialState()) => toHex(P.frame({ op, params } as never, st)[0]!.bytes);

  it('sport-session-rejected: the 77 start frame, the f7 refusal is an ack with no event, the fallback frames are the plain 1e stream', () => {
    const s = get('sport-session-rejected');
    expect(w('phoneSport', { status: 1, activityType: 'run' })).toBe(s.steps[0]!.expectWrite);
    const r = P.ingest(fromHex(s.steps[0]!.notify![0]!), base(clock.nowMs, clock.tzOffsetS), NOTIFY);
    expect(r.events).toEqual([]);
    expect(w('liveHrStart')).toBe(s.steps[1]!.expectWrite);
    expect(w('liveHrStop')).toBe(s.steps[2]!.expectWrite);
    expect(w('liveHrStart')).toBe(s.steps[3]!.expectWrite);
  });

  it('sport-session-ended-by-ring: start frame, the status-3 telemetry yields no HR (bpm 0), fallback frame', () => {
    const s = get('sport-session-ended-by-ring');
    expect(w('phoneSport', { status: 1, activityType: 'run' })).toBe(s.steps[0]!.expectWrite);
    expect(P.ingest(fromHex(s.steps[0]!.notify![0]!), base(clock.nowMs, clock.tzOffsetS), NOTIFY).events).toEqual([]);
    expect(w('liveHrStart')).toBe(s.steps[1]!.expectWrite);
  });

  it('live-hr-realtime-accepted: the 20 s keepalive frame is encodable (the timer itself is not in the contract)', () => {
    const s = get('live-hr-realtime-accepted');
    expect(w('realtimeHeartRateContinue')).toBe(s.steps[1]!.expectWrite);
  });

  // Kotlin ColmiSyncEngine.handleRawNotify (0x78 status 3 / 0x77|0x80) and sportWatchdogTick (45 s resume, then stop) have
  // no counterpart: the protocol keeps no workout state and the family has no workout command.
  it.todo('sport session engine: resume after 45 s of silence, stop and fall back on f7 or 78 status 3 (ColmiSyncEngine.kt:254-268, :746-790)');
  it.todo('live heart-rate keepalive: 1e 03 every 20 s while the 1e stream runs (ColmiSyncEngine.kt:646-665)');
});

describe('verify: purity, timeouts, redaction', () => {
  const deepFreeze = <T,>(o: T): T => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o as object)) deepFreeze(v);
    }
    return o;
  };
  it('begin / ingest / timeout never mutate the state they are given (a whole HR day and a big-data transfer, state deep-frozen)', () => {
    let st: ColmiState = deepFreeze(P.begin!({ op: 'history', params: { stage: 'hr', lastDay: 1, nowMs: 1784282400000, tzOffsetS: 7200 } }, P.initialState()).state as ColmiState);
    for (const c of [[0x15, 0, 4, 5], [0x15, 1, 0, 0, 0, 0, 60], [0x15, 2, 61], [0x15, 3, 62]]) {
      const r = P.ingest(Uint8Array.from(frame16(c)), st, NOTIFY);
      st = deepFreeze(r.state as ColmiState);
    }
    st = deepFreeze(P.timeout!(st, 'quiet').state as ColmiState);
    P.timeout!(st, 'stall');
    let big: ColmiState = deepFreeze(P.begin!({ op: 'history', params: { stage: 'spo2', nowMs: 1784282400000, tzOffsetS: 0 } }, P.initialState()).state as ColmiState);
    const f = [0xbc, 0x2a, 49, 0, 0, 0, ...new Array(49).fill(0)];
    big = deepFreeze(P.ingest(Uint8Array.from(f.slice(0, 20)), big, BIGDATA).state as ColmiState);
    const done = P.ingest(Uint8Array.from(f.slice(20)), big, BIGDATA);
    expect(done.done).toBe(true);
    expect(big.bigData?.length).toBe(20);
  });

  it('stall ends a read as status:error stall:<stream> with done and no cursor; a ring that never answers a handshake read is not an error for the handshake', () => {
    const st = P.begin!({ op: 'history', params: { stage: 'sleep', nowMs: 0, tzOffsetS: 0 } }, P.initialState()).state;
    const r = P.timeout!(st, 'stall');
    expect(r.done).toBe(true);
    expect(r.events).toEqual([{ type: 'status', key: 'error', value: 'stall:sleep_stage', stream: 'sleep_stage' }]);
  });

  it('redactOutbound is the identity on every encode vector (no credential on this family)', () => {
    for (const v of load('encode.json').vectors as Array<{ frame: string }>) {
      const b = fromHex(v.frame);
      expect(toHex(P.redactOutbound(b))).toBe(v.frame);
    }
  });
});
