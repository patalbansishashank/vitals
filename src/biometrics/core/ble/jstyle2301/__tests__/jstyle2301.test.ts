/**
 * Golden vectors ported from the owner's `app/src/test/java/com/pulseloop/ring/JStyle2301ProtocolTest.kt` plus synthetic
 * recorded frames for each decoder. All payloads are synthetic.
 */
import { describe, expect, it } from 'vitest';
import type { RingDecodedEvent } from '../../types';
import {
  HISTORY_STREAMS, authenticationRequest, checksum, heartRateMeasurement, historyRequest, isTerminal, prepareRealtimeMeasurement, redactOutbound,
  sportMode, validateCredential,
} from '../commands';
import { decodePacket } from '../decoder';
import { firmwareProfile } from '../firmware';
import { PACKETS_PER_PAGE, createJStyle2301Protocol, decodeCursor, encodeCursor, planJ2301Sync, type J2301State } from '../protocol';

const bcd = (v: number): number => (Math.floor(v / 10) << 4) | v % 10;
/** Kotlin `stamp`: 2026-09-14 12:34:56 at bytes 3–8. */
const stamp = (p: Uint8Array): Uint8Array => (p.set([26, 9, 14, 12, 34, 56].map(bcd), 3), p);
const putU16 = (d: Uint8Array, o: number, v: number): void => d.set([v & 0xff, (v >>> 8) & 0xff], o);
const putU32 = (d: Uint8Array, o: number, v: number): void => d.set([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff], o);
const T0 = Date.parse('2026-09-14T12:34:56Z');
const NOW = Date.parse('2026-09-16T10:00:00Z');
const dec = (p: Uint8Array | number[], firmware: string | null = 'V0525') => decodePacket(p instanceof Uint8Array ? p : Uint8Array.from(p), { firmware, tzOffsetS: 0, nowMs: NOW });
const rec = (op: number, size: number): Uint8Array => {
  const p = new Uint8Array(size);
  p[0] = op;
  return stamp(p);
};
const sumOk = (f: Uint8Array): boolean => f.length === 16 && f[15] === checksum(f);

describe('2301 framing (Kotlin golden vectors)', () => {
  it('manual HR frames are exact 16-byte SDK commands', () => {
    expect([...prepareRealtimeMeasurement().subarray(0, 3)]).toEqual([0x09, 0x01, 0x00]);
    expect([...prepareRealtimeMeasurement(false).subarray(0, 3)]).toEqual([0x09, 0x00, 0x00]);
    expect([...heartRateMeasurement(true, 30).subarray(0, 5)]).toEqual([0x28, 0x02, 0x01, 0x1e, 0x00]);
    expect([...heartRateMeasurement(false, 30).subarray(0, 5)]).toEqual([0x28, 0x02, 0x00, 0x1e, 0x00]);
    for (const f of [prepareRealtimeMeasurement(), heartRateMeasurement(true), heartRateMeasurement(false)]) expect(sumOk(f)).toBe(true);
    expect(() => heartRateMeasurement(true, 0)).toThrow();
  });

  it('walk and run sport frames preserve mode and lifecycle bytes', () => {
    expect([...sportMode(0, 1).subarray(0, 5)]).toEqual([0x19, 0x01, 0x00, 0x00, 0x02]);
    expect([...sportMode(9, 1).subarray(0, 5)]).toEqual([0x19, 0x01, 0x09, 0x00, 0x02]);
    expect([...sportMode(9, 2).subarray(0, 5)]).toEqual([0x19, 0x02, 0x09, 0x00, 0x02]);
    expect([...sportMode(9, 3).subarray(0, 5)]).toEqual([0x19, 0x03, 0x09, 0x00, 0x02]);
    expect([...sportMode(9, 4).subarray(0, 5)]).toEqual([0x19, 0x04, 0x09, 0x00, 0x02]);
    expect(sumOk(sportMode(9, 4))).toBe(true);
  });

  it('history commands: mode 0 / mode 2 and checksum', () => {
    const first = historyRequest(HISTORY_STREAMS.HEART_RATE);
    const next = historyRequest(HISTORY_STREAMS.HEART_RATE, true);
    expect(first.length).toBe(16);
    expect([first[0], first[1], first[15]]).toEqual([0x55, 0, 0x55]);
    expect([next[1], next[15]]).toEqual([2, 0x57]);
  });

  it('V0789 auth command is exact and its diagnostic copy is redacted', () => {
    const r = authenticationRequest('A1b2C3d4');
    expect(r[0]).toBe(0x3c);
    expect(new TextDecoder().decode(r.subarray(1, 9))).toBe('A1b2C3d4');
    expect(sumOk(r)).toBe(true);
    const red = redactOutbound(r);
    expect(red[0]).toBe(0x3c);
    expect([...red.subarray(1, 15)].every((b) => b === 0)).toBe(true);
  });

  it('credential validation: 1–14 printable ASCII characters', () => {
    expect(validateCredential('A1b2C3d4E5f6G7')).toBe(true);
    expect(validateCredential('x')).toBe(true);
    expect(validateCredential('')).toBe(false);
    expect(validateCredential('A1b2C3d4E5f6G7H')).toBe(false);
    expect(validateCredential('tab\there')).toBe(false);
    expect(validateCredential('naïve')).toBe(false);
    expect(() => authenticationRequest('')).toThrow();
  });

  it('terminal marker standalone or appended', () => {
    const s = HISTORY_STREAMS.SLEEP;
    expect(isTerminal(Uint8Array.of(0x53, 0xff), s)).toBe(true);
    const long = new Uint8Array(132);
    long[0] = 0x53;
    long[130] = 0x53;
    long[131] = 0xff;
    expect(isTerminal(long, s)).toBe(true);
    expect(isTerminal(Uint8Array.of(0x53, 0x00), s)).toBe(false);
  });
});

describe('2301 decoder (Kotlin golden vectors)', () => {
  it('battery and V0525 / V0789 firmware', () => {
    expect(dec([0x13, 100]).events).toEqual([{ type: 'status', key: 'battery', value: 100 }]);
    expect(dec([0x27, 0x00, 0x05, 0x02, 0x05]).firmware).toBe('V0525');
    expect(dec([0x27, 0x00, 0x07, 0x08, 0x09], null).firmware).toBe('V0789');
    expect(firmwareProfile('V0789').id).toBe('V0789');
    expect(firmwareProfile(' v0525 ').id).toBe('V0525');
    expect(dec([0x3c, 0x01]).authAccepted).toBe(true);
    expect(dec([0x3c, 0x00]).authAccepted).toBe(false);
  });

  it('manual HR reply byte 2 is a spot sample; zero is an ack; other types are dropped', () => {
    expect(dec([0x28, 0x02, 72]).events).toEqual([{ type: 'sample', stream: 'hr', t: NOW, value: 72, unit: 'bpm', origin: 'spot' }]);
    expect(dec([0x28, 0x02, 0]).events[0]?.type).toBe('status');
    expect(dec([0x28, 0x03, 98]).events).toEqual([]);
  });

  it('sport telemetry and realtime stream publish plausible HR only', () => {
    expect(dec(new Uint8Array(14).fill(0, 0).map((_, i) => (i === 0 ? 0x18 : 0))).events).toEqual([]);
    const reading = new Uint8Array(14);
    reading[0] = 0x18;
    reading[1] = 81;
    expect(dec(reading).events).toMatchObject([{ stream: 'hr', value: 81, origin: 'live' }]);
    expect(dec([0x09, 1, 0]).events).toEqual([]);
    const rt = new Uint8Array(22);
    rt[0] = 0x09;
    rt[21] = 92;
    expect(dec(rt).events).toMatchObject([{ stream: 'hr', value: 92, origin: 'live' }]);
  });

  it('HR, SpO2 and temperature history keep local timestamps', () => {
    const hr = rec(0x55, 10);
    hr[9] = 72;
    const spo2 = rec(0x66, 10);
    spo2[9] = 98;
    const temp = rec(0x62, 11);
    putU16(temp, 9, 368);
    expect(dec(hr).events).toEqual([{ type: 'sample', stream: 'hr', t: T0, value: 72, unit: 'bpm', origin: 'history' }]);
    expect(dec(spo2).events).toEqual([{ type: 'sample', stream: 'spo2', t: T0, value: 98, unit: 'pct', origin: 'history' }]);
    expect(dec(temp).events).toEqual([{ type: 'sample', stream: 'skin_temp', t: T0, value: 36.8, unit: 'degC', origin: 'history' }]);
    // Ring-local wall time: UTC+5:30 phone offset moves the instant back.
    const ist = decodePacket(hr, { firmware: 'V0525', tzOffsetS: 19_800, nowMs: NOW }).events[0];
    expect(ist).toMatchObject({ t: T0 - 19_800_000 });
  });

  it('several records in one notification, invalid BCD dropped', () => {
    const a = rec(0x55, 10);
    a[9] = 60;
    const b = rec(0x55, 10);
    b[9] = 61;
    b[4] = 0x13; // month 13 → invalid
    const c = rec(0x55, 10);
    c[9] = 62;
    const both = new Uint8Array([...a, ...b, ...c, 0x55, 0xff]);
    expect(dec(both).events.map((e) => (e.type === 'sample' ? e.value : null))).toEqual([60, 62]);
  });

  it('V0525 one-minute sleep packet maps all four stages', () => {
    const p = rec(0x53, 130);
    p.set([4, 5, 1, 2, 3], 9);
    const [ev] = dec(p).events;
    expect(ev).toEqual({ type: 'sleepEpochs', start: T0, epochS: 60, stages: ['awake', 'deep', 'light', 'rem'], rawCodes: [5, 1, 2, 3], firmware: 'V0525', complete: false });
  });

  it('V0789 maps byte 5 and markers to awake; a full packet is complete', () => {
    const p = rec(0x53, 130);
    p.set([5, 1, 2, 3, 10, 5], 9);
    expect((dec(p, 'V0789').events[0] as Extract<RingDecodedEvent, { type: 'sleepEpochs' }>).stages).toEqual(['deep', 'light', 'rem', 'awake', 'awake']);
    const full = rec(0x53, 130);
    full[9] = 120;
    full.fill(2, 10);
    expect(dec(full, 'V0789').events[0]).toMatchObject({ complete: true });
    expect((dec(full, 'V0789').events[0] as Extract<RingDecodedEvent, { type: 'sleepEpochs' }>).stages).toHaveLength(120);
  });

  it('34-byte sleep record: one byte per 5 minutes expands to 1-min epochs', () => {
    const r = rec(0x53, 34);
    r.set([2, 1, 3], 9);
    const ev = dec(r).events[0] as Extract<RingDecodedEvent, { type: 'sleepEpochs' }>;
    expect(ev.rawCodes).toEqual([1, 1, 1, 1, 1, 3, 3, 3, 3, 3]);
    expect(ev.stages.slice(4, 6)).toEqual(['deep', 'rem']);
  });

  it('V0525 HRV bundle keeps raw value and publishes the vendor-app transform', () => {
    const p = rec(0x56, 15);
    p.set([47, 39, 70, 31, 118, 76], 9);
    const evs = dec(p).events;
    expect(evs).toContainEqual({ type: 'vendor', key: 'hrv_raw', t: T0, value: 47, unit: 'vendor_units' });
    expect(evs).toContainEqual({ type: 'sample', stream: 'hrv', t: T0, value: 28, unit: 'ms', origin: 'history' });
    expect(evs).toContainEqual({ type: 'sample', stream: 'hr', t: T0, value: 70, unit: 'bpm', origin: 'history' });
    expect(evs).toContainEqual({ type: 'vendor', key: 'stress', t: T0, value: 31, unit: 'vendor_units' });
    expect(evs).toContainEqual({ type: 'vendor', key: 'vascular_age', t: T0, value: 39, unit: 'years' });
    expect(evs).toContainEqual({ type: 'vendor', key: 'blood_pressure_systolic_estimate', t: T0, value: 118, unit: 'mmHg' });
    expect(evs).toContainEqual({ type: 'vendor', key: 'blood_pressure_diastolic_estimate', t: T0, value: 76, unit: 'mmHg' });
    const v0789 = rec(0x56, 15);
    v0789[9] = 91;
    expect(dec(v0789, 'V0789').events).toContainEqual(expect.objectContaining({ stream: 'hrv', value: 50 }));
    v0789[9] = 113;
    expect(dec(v0789, 'V0789').events).toContainEqual(expect.objectContaining({ stream: 'hrv', value: 61 }));
  });

  it('unknown firmware keeps opaque HRV and refuses sleep labels', () => {
    const p = rec(0x56, 15);
    p[9] = 47;
    const evs = dec(p, null).events;
    expect(evs.some((e) => e.type === 'vendor' && e.key === 'hrv_raw')).toBe(true);
    expect(evs.some((e) => e.type === 'sample' && e.stream === 'hrv')).toBe(false);
    const s = rec(0x53, 130);
    s.set([4, 1, 2, 3, 5], 9);
    expect((dec(s, null).events[0] as Extract<RingDecodedEvent, { type: 'sleepEpochs' }>).stages).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });

  it('activity total: 10 m distance unit, kcal /100, seconds → whole active minutes', () => {
    const p = new Uint8Array(27);
    p[0] = 0x51;
    p.set([26, 9, 14].map(bcd), 2);
    putU32(p, 5, 8_432);
    putU32(p, 9, 735);
    putU32(p, 13, 623);
    putU32(p, 17, 38_800);
    putU16(p, 21, 10_000);
    putU32(p, 23, 62);
    const day = Date.parse('2026-09-14T00:00:00Z');
    const evs = dec(p).events;
    const v = (k: string) => evs.find((e) => e.type === 'vendor' && e.key === k);
    expect(v('daily_steps')).toMatchObject({ value: 8_432, t: day });
    expect(v('daily_distance')).toMatchObject({ value: 6_230, unit: 'm' });
    expect(v('daily_kcal')).toMatchObject({ value: 388 });
    expect(v('active_minutes')).toMatchObject({ value: 12 });
    expect(v('exercise_duration_raw')).toMatchObject({ value: 735, unit: 's' });
    expect(v('step_goal')).toMatchObject({ value: 10_000 });
    expect(v('active_time_raw')).toMatchObject({ value: 62 });
    // V0789 post-OTA vector: 34 s → 0 active minutes.
    const q = new Uint8Array(27);
    q[0] = 0x51;
    q.set([26, 9, 15].map(bcd), 2);
    putU32(q, 5, 77);
    putU32(q, 9, 34);
    expect(dec(q, 'V0789').events.find((e) => e.type === 'vendor' && e.key === 'active_minutes')).toMatchObject({ value: 0 });
    expect(dec(q, null).events.some((e) => e.type === 'vendor' && e.key === 'active_minutes')).toBe(false);
  });

  it('activity detail: vendor kcal and per-minute buckets with distance split', () => {
    const p = rec(0x52, 25);
    putU16(p, 9, 100);
    putU16(p, 11, 435);
    putU16(p, 13, 7);
    p[15] = 60;
    p[16] = 40;
    const evs = dec(p).events;
    expect(evs).toContainEqual({ type: 'vendor', key: 'activity_detail_calories', t: T0, value: 4.35, unit: 'kcal' });
    expect(evs.filter((e) => e.type === 'activityBucket')).toEqual([
      { type: 'activityBucket', start: T0, durS: 60, steps: 60, distanceM: 42 },
      { type: 'activityBucket', start: T0 + 60_000, durS: 60, steps: 40, distanceM: 28 },
    ]);
    const flat = rec(0x52, 25);
    putU16(flat, 9, 33);
    expect(dec(flat).events).toEqual([{ type: 'activityBucket', start: T0, durS: 600, steps: 33, distanceM: 0 }]);
  });

  it('workout HR: 15 bytes 10 s apart, zeros skipped', () => {
    const p = rec(0x54, 24);
    p[9] = 120;
    p[11] = 125;
    expect(dec(p).events.map((e) => (e.type === 'sample' ? [e.t - T0, e.value] : null))).toEqual([[0, 120], [20_000, 125]]);
  });
});

describe('2301 paging, planner and cursor', () => {
  const proto = createJStyle2301Protocol();
  const start = (opcode: number, pageLimit = 1, prev = '') =>
    proto.begin!({ op: 'history', params: { opcode, seq: 4, pageLimit, prev, nowMs: NOW, tzOffsetS: 0 } }, { ...proto.initialState(), firmware: 'V0525' }).state;
  const hrPkt = (): Uint8Array => {
    const p = rec(0x55, 10);
    p[9] = 70;
    return p;
  };

  it('continues at fifty packets then finishes on the terminal (multi-page budget)', () => {
    let st = start(0x55, 2);
    let send: unknown;
    for (let i = 0; i < PACKETS_PER_PAGE; i++) {
      const r = proto.ingest(hrPkt(), st);
      st = r.state;
      send = r.send ?? send;
      if (i < PACKETS_PER_PAGE - 1) expect(r.done).toBeFalsy();
    }
    expect(send).toEqual([{ op: 'historyContinue', params: { opcode: 0x55 } }]);
    expect([...proto.frame({ op: 'historyContinue', params: { opcode: 0x55 } })[0]!.subarray(0, 2)]).toEqual([0x55, 2]);
    const end = proto.ingest(Uint8Array.of(0x55, 0xff), st);
    expect(end.done).toBe(true);
    const cur = end.events.find((e) => e.type === 'status' && e.key === 'cursor');
    expect(cur).toMatchObject({ stream: 'hr' });
    expect(decodeCursor(String((cur as { value: string }).value))[0x55]).toEqual({ seq: 4, newestS: T0 / 1000, flag: 'end' });
  });

  it('one-page budget finishes instead of requesting a continuation', () => {
    let st = start(0x55, 1);
    let last;
    for (let i = 0; i < PACKETS_PER_PAGE; i++) {
      last = proto.ingest(hrPkt(), st);
      st = last.state;
      expect(last.send).toBeUndefined();
    }
    expect(last!.done).toBe(true);
    expect((st as J2301State).inflight).toBeNull();
    expect(decodeCursor((st as J2301State).cursors.hr)[0x55]?.flag).toBe('more');
  });

  it('settle timer finishes the stream and keeps the previous newest time when nothing arrived', () => {
    const prev = encodeCursor({ 0x55: { seq: 2, newestS: 1_700_000_000, flag: 'more' }, 0x54: { seq: 2, newestS: null, flag: 'end' } });
    const st = start(0x55, 1, prev);
    const r = proto.timeout!(st, 'stall');
    expect(r.done).toBe(true);
    const c = decodeCursor((r.state as J2301State).cursors.hr);
    expect(c[0x55]).toEqual({ seq: 4, newestS: 1_700_000_000, flag: 'more' });
    expect(c[0x54]).toEqual({ seq: 2, newestS: null, flag: 'end' });
    expect(r.events.some((e) => e.type === 'status' && e.key === 'error')).toBe(true);
  });

  it('planner: one mode-0 page per opcode, catalogue order on first sync', () => {
    const plan = planJ2301Sync({});
    expect(plan.map((c) => c.params?.opcode)).toEqual([0x51, 0x52, 0x55, 0x54, 0x56, 0x53, 0x66, 0x62]);
    expect(plan.every((c) => c.op === 'history' && c.params?.pageLimit === 1 && c.params.seq === 1)).toBe(true);
    expect(plan.flatMap((c) => proto.frame(c)).map((f) => f[1])).toEqual(new Array(8).fill(0));
  });

  it('planner resumes after a dropped link: unreached streams first', () => {
    // Round 3 reached activity, detail, HR and workout HR before the link dropped.
    const cursor = {
      steps: encodeCursor({ 0x51: { seq: 3, newestS: 1, flag: 'more' }, 0x52: { seq: 3, newestS: 1, flag: 'more' } }),
      hr: encodeCursor({ 0x55: { seq: 3, newestS: 1, flag: 'more' }, 0x54: { seq: 3, newestS: 1, flag: 'more' } }),
      hrv: encodeCursor({ 0x56: { seq: 2, newestS: 1, flag: 'more' } }),
      sleep_stage: encodeCursor({ 0x53: { seq: 2, newestS: 1, flag: 'more' } }),
      spo2: encodeCursor({ 0x66: { seq: 2, newestS: 1, flag: 'more' } }),
    };
    const plan = planJ2301Sync(cursor);
    expect(plan.map((c) => c.params?.opcode)).toEqual([0x62, 0x56, 0x53, 0x66, 0x51, 0x52, 0x55, 0x54]);
    expect(new Set(plan.map((c) => c.params?.seq))).toEqual(new Set([4]));
    expect(planJ2301Sync({}, { pageLimit: 99 })[0]?.params?.pageLimit).toBe(20);
  });

  it('cursor codec round-trips and tolerates garbage', () => {
    const c = { 0x55: { seq: 7, newestS: 1_790_000_000, flag: 'end' as const }, 0x54: { seq: 6, newestS: null, flag: 'more' as const } };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor('nonsense')).toEqual({});
    expect(decodeCursor(undefined)).toEqual({});
  });

  it('reports history timestamps ahead of the phone clock as drift', () => {
    const st = proto.begin!({ op: 'history', params: { opcode: 0x55, seq: 1, nowMs: T0 - 600_000, tzOffsetS: 0 } }, { ...proto.initialState(), firmware: 'V0525' }).state;
    const r = proto.ingest(new Uint8Array([...hrPkt(), 0x55, 0xff]), st);
    expect(r.events).toContainEqual({ type: 'status', key: 'clock_offset_s', value: 600, stream: 'hr' });
  });
});
