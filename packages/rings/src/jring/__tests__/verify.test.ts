// @vitest-environment node
/**
 * Independent verifier checks for the Jring family (written against the Kotlin sources, not the author's helpers):
 * own 20-byte framing over every fixture frame, the `JringClock` rule across offsets, the capability bit indices,
 * `matches` rule by rule, fixture decode vectors through `protocol.ingest` with an independent bridge-gate expectation,
 * and state immutability through a history read.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, type Advertisement, type RingEvent } from '../../types';
import { jring } from '../family';
import { jringCapabilities } from '../commands';
import type { JringState } from '../protocol';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/jring');
const json = <T,>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;
const NOW_MS = 1_700_000_000_000;
const NOW_S = NOW_MS / 1000;
const P = jring.protocol;
const state0 = (over: Partial<JringState> = {}): JringState => ({ ...(P.initialState() as JringState), nowMs: NOW_MS + 20 * 60_000, ...over });
const pad20 = (b: number[]): Uint8Array => Uint8Array.from([...b, ...new Array(20 - b.length).fill(0)]);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

interface Ev { kotlin: string; [k: string]: unknown }
interface DecodeVector { name: string; context: { clockOffsetS: number | null }; bytes?: string; bytesSequence?: string[]; events: Ev[]; match: 'exact' | 'first' | 'contains' }

describe('verify: framing', () => {
  it('every encode fixture frame is exactly 20 bytes, byte 0 a known opcode, no byte beyond the Kotlin payload set', () => {
    const { vectors } = json<{ vectors: Array<{ name: string; frame: string }> }>('encode.json');
    const OPS = new Set([0x01, 0x02, 0x04, 0x0c, 0x10, 0x14, 0x15, 0x16, 0x19, 0x1a, 0x20, 0x21, 0x23, 0x33, 0x3a, 0x48, 0x4b]);
    for (const v of vectors) {
      const b = fromHex(v.frame);
      expect(b.length, v.name).toBe(20);
      expect(OPS.has(b[0]!), `${v.name} opcode`).toBe(true);
    }
  });

  it('every decode fixture packet is 20 bytes or a documented negative; non-20 never decodes to data or changes state', () => {
    const { vectors } = json<{ vectors: DecodeVector[] }>('decode.json');
    let negatives = 0;
    for (const v of vectors) {
      for (const hex of v.bytesSequence ?? [v.bytes ?? '']) {
        const b = fromHex(hex);
        if (b.length === 20) continue;
        negatives++;
        const st = deepFreeze(state0());
        const r = P.ingest(b, st);
        expect(r.events, v.name).toEqual([]);
        expect(r.state, v.name).toEqual(st);
        expect(r.done, v.name).toBeUndefined();
      }
    }
    expect(negatives).toBeGreaterThanOrEqual(5); // empty, 5, 4, 19, 21 bytes
  });
});

describe('verify: decode vectors through protocol.ingest (independent bridge gates)', () => {
  const { vectors } = json<{ vectors: DecodeVector[] }>('decode.json');
  const inWindow = (tS: number, horizonDays = 8): boolean => tS >= NOW_S - horizonDays * 86400 && tS <= NOW_S + 3600;
  const tsOf = (e: Ev): number => {
    const t = (e.timestampS ?? (e.also as Record<string, unknown> | undefined)?.timestampS) as number | string | undefined;
    return typeof t === 'number' ? t : e.kotlin === 'SleepTimeline' || (e.kotlin === 'HistoryMeasurement' && e.kind_field === 'HEART_RATE' && !('timestampS' in e)) ? 0 : NOW_S; // vectors that omit a ring time carry zeros; 0x24 uses phone time
  };
  /** RingEventBridge.kt, restated: how many data records one Kotlin event may yield. */
  function dataCount(e: Ev): Record<string, number> {
    const f = { ...(e.also as Record<string, unknown> | undefined), ...e } as Record<string, unknown>;
    const out: Record<string, number> = {};
    const add = (k: string): void => { out[k] = (out[k] ?? 0) + 1; };
    switch (e.kotlin) {
      case 'HeartRateSample': if (!f.isError && (f.bpm as number) >= 30 && (f.bpm as number) <= 220) add('sample'); break;
      case 'Spo2Result': add('sample'); break;
      case 'StressSample': if ((f.value as number) >= 1 && (f.value as number) <= 100) add('vendor'); break;
      case 'ActivityUpdate': add('dailyTotal'); break;
      case 'ActivityBucket': if ((f.steps as number) <= 5000) add('activityBucket'); break;
      case 'SleepTimeline': if (inWindow(tsOf(e))) add('sleepEpochs'); break;
      case 'HistoryMeasurement': {
        const v = Math.trunc(f.value as number);
        const k = f.kind_field as string;
        const ok = k === 'HEART_RATE' ? v >= 30 && v <= 220 : k === 'BLOOD_PRESSURE_SYSTOLIC' ? v >= 60 && v <= 250 : k === 'BLOOD_PRESSURE_DIASTOLIC' ? v >= 30 && v <= 150
          : k === 'FATIGUE' ? v >= 1 && v <= 100 : k === 'BLOOD_SUGAR' ? (f.value as number) >= 20 && (f.value as number) <= 600 : false;
        if (ok && inWindow(tsOf(e))) add(k === 'HEART_RATE' ? 'sample' : 'vendor');
        break;
      }
    }
    return out;
  }
  const tally = (evs: RingEvent[]): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const e of evs) if (['sample', 'vendor', 'dailyTotal', 'activityBucket', 'sleepEpochs'].includes(e.type)) o[e.type] = (o[e.type] ?? 0) + 1;
    return o;
  };

  it('replays all 55 vectors; exact vectors give exactly the gated data records, others at least the listed ones', () => {
    expect(vectors.length).toBe(55);
    for (const v of vectors) {
      // One fixture's negative offset makes a raw local timestamp eight hours ahead of NOW_MS.
      let st: JringState = state0({ clockOffsetS: v.context.clockOffsetS, nowMs: NOW_MS + 9 * 3_600_000 });
      const got: RingEvent[] = [];
      for (const hex of v.bytesSequence ?? [v.bytes ?? '']) {
        const r = P.ingest(fromHex(hex), st);
        got.push(...r.events);
        st = r.state as JringState;
      }
      const want: Record<string, number> = {};
      const listed = v.match === 'first' ? v.events.slice(0, 1) : v.events;
      for (const e of listed) for (const [k, n] of Object.entries(dataCount(e))) want[k] = (want[k] ?? 0) + n;
      const have = tally(got);
      if (v.match === 'exact') expect(have, v.name).toEqual(want);
      else for (const [k, n] of Object.entries(want)) expect(have[k] ?? 0, `${v.name} ${k}`).toBeGreaterThanOrEqual(n);
    }
  });
});

describe('verify: JringClock rule', () => {
  // JringClock.date(ring) = ring - offset; 0x01 ack, 0x03, 0x10, 0x11, 0x14 and 0x16 apply it (Kotlin leaves 0x10 and 0x14
  // raw; port note 1); DST-free zones, negative offset, half hour.
  const ts = (s: number): number[] => [s & 0xff, (s >>> 8) & 0xff, (s >>> 16) & 0xff, (s >>> 24) & 0xff];
  it.each([0, 19_800, 3_600, -28_800, -12_600])('offset %i: acks, activity, sleep, live HR and HR history all subtract it', (off) => {
    const local = NOW_S - 100 + off; // ring wall-clock of "100 s ago"
    const st = state0({ clockOffsetS: off });
    const ack = P.ingest(pad20([0x01, ...ts(local)]), st);
    expect(ack.events).toEqual([{ type: 'status', key: 'ack', value: 'time_sync' }]);
    const sleep = P.ingest(pad20([0x11, ...ts(local), 1, 1, 1]), st).events[0] as Extract<RingEvent, { type: 'sleepEpochs' }>;
    expect(sleep.start).toBe((NOW_S - 100) * 1000);
    const hr = P.ingest(pad20([0x16, 0xa0, ...ts(local), 0, 0, 60, 60, 60, 60, 60, 60, 70, 70, 70, 70, 70, 70]), st).events as Array<Extract<RingEvent, { type: 'sample' }>>;
    expect(hr.map((e) => [e.t, e.value])).toEqual([[(NOW_S - 100) * 1000, 60], [(NOW_S - 100 + 60) * 1000, 70]]);
    const day = P.ingest(pad20([0x03, ...ts(local), ...ts(100), ...ts(50), ...ts(5)]), st).events[0] as Extract<RingEvent, { type: 'dailyTotal' }>;
    expect(day.localDay).toBe((Math.floor(local / 86400) * 86400 - off) * 1000);
    const bucket = P.ingest(pad20([0x10, ...ts(local), 7]), st).events[0] as Extract<RingEvent, { type: 'activityBucket' }>;
    expect(bucket.start).toBe((NOW_S - 100) * 1000);
    const live = P.ingest(pad20([0x14, ...ts(local), 72, 0]), st).events[0] as Extract<RingEvent, { type: 'sample' }>;
    expect(live.t).toBe((NOW_S - 100) * 1000);
  });

  it.each([[-28_800, 0xf8], [-12_600, 0xfd], [19_800, 5], [0, 0], [3_600, 1]])('time sync with offset %i writes u32le(now + off) and hours byte %i (truncating)', (off, hours) => {
    const f = P.frame({ op: 'timeSync', params: { nowMs: NOW_MS + 999, tzOffsetS: off } }, state0())[0]!.bytes;
    const want = NOW_S + off;
    expect([...f.subarray(0, 6)]).toEqual([1, ...ts(want), hours]);
    expect(f.length).toBe(20);
    const plan = P.begin!({ op: 'timeSync', params: { nowMs: NOW_MS, tzOffsetS: off } }, state0());
    expect((plan.state as JringState).clockOffsetS).toBe(off);
    expect(plan.expectReply).toBe(false);
  });

  it('the offset stays latched across commands until the next 0x01, and a no-clock ingest falls back to the stamped offset', () => {
    let st = P.begin!({ op: 'timeSync', params: { nowMs: NOW_MS, tzOffsetS: -28_800 } }, state0()).state as JringState;
    st = P.begin!({ op: 'status', params: { nowMs: NOW_MS, tzOffsetS: 3_600 } }, st).state as JringState; // phone zone changed, no resync yet
    expect(st.clockOffsetS).toBe(-28_800);
    expect(st.tzOffsetS).toBe(3_600);
    const ack = P.ingest(pad20([0x01, ...ts(NOW_S - 28_800)]), state0({ tzOffsetS: 0, clockOffsetS: null })).events;
    expect(ack).toHaveLength(1);
  });
});

describe('verify: capability bitmask', () => {
  const caps = (bits: number[]): ReturnType<typeof jringCapabilities> => {
    const b = new Uint8Array(19);
    for (const n of bits) b[Math.floor(n / 8)]! |= 1 << n % 8;
    return jringCapabilities(b);
  };
  it('RingProtocol.kt bit indices: temperature 10, separate SpO2 65, SpO2 offline 81, pressure 83 (LSB first within a byte)', () => {
    expect(caps([])).toEqual({ hasTemperature: false, separateBloodOxygenMode: false, hasOxygenOfflineHistory: false, hasPressureHistory: false });
    expect(caps([10])).toEqual({ hasTemperature: true, separateBloodOxygenMode: false, hasOxygenOfflineHistory: false, hasPressureHistory: false });
    expect(caps([65])).toEqual({ hasTemperature: false, separateBloodOxygenMode: true, hasOxygenOfflineHistory: false, hasPressureHistory: false });
    expect(caps([81])).toEqual({ hasTemperature: false, separateBloodOxygenMode: false, hasOxygenOfflineHistory: true, hasPressureHistory: false });
    expect(caps([83])).toEqual({ hasTemperature: false, separateBloodOxygenMode: false, hasOxygenOfflineHistory: false, hasPressureHistory: true });
    // neighbours do not leak
    expect(caps([9, 11, 64, 66, 80, 82, 84, 0, 8, 152])).toEqual({ hasTemperature: false, separateBloodOxygenMode: false, hasOxygenOfflineHistory: false, hasPressureHistory: false });
    // MSB-first would flip bit 10 to byte 1 mask 0x20: 0x20 must NOT set it, 0x04 must
    expect(jringCapabilities(Uint8Array.from([0, 0x20])).hasTemperature).toBe(false);
    expect(jringCapabilities(Uint8Array.from([0, 0x04])).hasTemperature).toBe(true);
    // a short payload reads as absent bits (Kotlin: byte >= size -> false)
    expect(jringCapabilities(Uint8Array.from([0xff])).hasPressureHistory).toBe(false);
  });
  it('0x20 reply: payload is bytes 1..19 (bit 0 of the first payload byte is index 0), stored as spaced hex, no write', () => {
    const f = new Uint8Array(20); f[0] = 0x20; f[2] = 0x04; f[11] = 0x02; // payload byte 1 bit 2 = 10; payload byte 10 bit 1 = 81
    const r = P.ingest(f, state0());
    expect(r.events).toEqual([{ type: 'status', key: 'capabilities', value: toHex(f.subarray(1)).toLowerCase() }]);
    expect((r.state as JringState).capabilities).toBe(toHex(f.subarray(1)).toLowerCase());
    expect(r.send).toBeUndefined();
  });
});

describe('verify: scan.match against every JringCoordinator.matches rule', () => {
  const ad = (a: Partial<Advertisement>): Advertisement => ({ serviceUuids: [], manufacturerData: [], ...a });
  const m = (a: Partial<Advertisement>): boolean => jring.scan.match(ad(a));
  const C1 = '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e';
  const C2 = 'de5bf728-d711-4e47-af26-65e3012a5dc7';
  const S = '000056ff-0000-1000-8000-00805f9b34fb';
  it('rule 1: name SMART_RING exact and no Colmi v1/v2 service', () => {
    expect(m({ name: 'SMART_RING' })).toBe(true);
    for (const n of ['smart_ring', 'SMART_RING ', 'SMART_RING1', 'SMART', undefined, '']) expect(m({ name: n }), String(n)).toBe(false);
    expect(m({ name: 'SMART_RING', serviceUuids: [C1] })).toBe(false);
    expect(m({ name: 'SMART_RING', serviceUuids: [C2] })).toBe(false);
    expect(m({ name: 'SMART_RING', serviceUuids: ['0000fdda-0000-1000-8000-00805f9b34fb'] })).toBe(true); // CRP service does not veto
  });
  it('rule 2: the 56ff service wins even against a Colmi service and with any name', () => {
    expect(m({ serviceUuids: [S] })).toBe(true);
    expect(m({ name: 'SMART_RING', serviceUuids: [C1, S] })).toBe(true);
    expect(m({ name: 'Other', serviceUuids: [S.toUpperCase()] })).toBe(true);
    expect(m({ serviceUuids: ['000056fe-0000-1000-8000-00805f9b34fb'] })).toBe(false);
  });
  it('rule 3: manufacturer block whose hex contains 41422ec75b6a anywhere (company id included)', () => {
    expect(m({ manufacturerData: [fromHex('41 42 2e c7 5b 6a')] })).toBe(true);
    expect(m({ manufacturerData: [fromHex('01 02 41 42 2e c7 5b 6a 03')] })).toBe(true);
    expect(m({ manufacturerData: [fromHex('00 00'), fromHex('ff ff 41 42 2e c7 5b 6a')] })).toBe(true);
    expect(m({ manufacturerData: [fromHex('41 42 2e c7 5b 6b')] })).toBe(false);
    expect(m({ manufacturerData: [fromHex('41 42 2e c7 5b'), fromHex('6a')] })).toBe(false); // blocks are matched separately
    expect(m({ name: 'Other', manufacturerData: [] })).toBe(false);
  });
  it('nothing brand-bearing and nothing from sibling families', () => {
    for (const n of ['R02_1234', 'R10M 1234', 'QRing', 'J-Style', 'TK5', 'LuckRing']) expect(m({ name: n }), n).toBe(false);
    expect(JSON.stringify([jring.label, jring.models, jring.scan.requestFilters])).not.toMatch(/youhong|j-style/i);
  });
});

describe('verify: state immutability through a history read', () => {
  it('begin, 0x10/0x11/0x16 packets, timeouts and finish never mutate the state they were given', () => {
    const ts = (s: number): number[] => [s & 0xff, (s >>> 8) & 0xff, (s >>> 16) & 0xff, (s >>> 24) & 0xff];
    const local = NOW_S + 3600;
    let st = deepFreeze(state0({ tzOffsetS: 3600, clockOffsetS: 3600 }));
    const snap = (s: JringState): string => JSON.stringify(s);
    const plan = P.planSync({}, st);
    expect(plan.map((c) => c.op)).toEqual(['historyQuery', 'historyMeasurementQuery']);
    expect(plan[0]!.params!.days).toBe(3);
    const steps: Array<() => { state: unknown }> = [
      () => P.begin!({ ...plan[0]!, params: { ...plan[0]!.params, nowMs: NOW_MS, tzOffsetS: 3600 } }, st),
      () => P.ingest(pad20([0x10, ...ts(local - 1800), 5, 6, 7]), st),
      () => P.ingest(pad20([0x11, ...ts(local - 900), 1, 2, 3]), st),
      () => P.ingest(pad20([0x10, ...ts(local - 900), 5, 6, 7]), st),
      () => P.timeout!(st, 'quiet'),
      () => P.begin!({ ...plan[1]!, params: { ...plan[1]!.params, nowMs: NOW_MS, tzOffsetS: 3600 } }, st),
      () => P.ingest(pad20([0x16, 0xf0]), st),
      () => P.ingest(pad20([0x16, 0xa0, ...ts(local - 600), 0, 0, 60, 60, 60, 60, 60, 60, 70, 70, 70, 70, 70, 70]), st),
      () => P.timeout!(st, 'quiet'),
      () => P.ingest(pad20([0x16, 0xff]), st),
    ];
    const cursorEvents: RingEvent[] = [];
    for (const [i, step] of steps.entries()) {
      const before = snap(st);
      const r = step();
      expect(snap(st), `step ${i} mutated its input`).toBe(before);
      expect(r.state, `step ${i} returned the same object`).not.toBe(st);
      if ('events' in r) cursorEvents.push(...(r as { events: RingEvent[] }).events);
      st = deepFreeze(r.state as JringState);
    }
    const cursors = cursorEvents.filter((e) => e.type === 'status' && e.key === 'cursor');
    expect(cursors.map((e) => (e as { stream?: string }).stream).sort()).toEqual(['hr', 'sleep_stage', 'steps']);
    expect(st.inflight).toBeNull();
    expect(st.historyBackfilled).toBe(true);
    expect(P.planSync({}, st)[0]!.params!.days).toBe(1);
  });

  it('a stalled read ends partial with no cursor event and the old cursor kept', () => {
    let st = state0({ clockOffsetS: 0, cursors: { hr: 'jr1:100' } });
    st = P.begin!({ op: 'historyMeasurementQuery', params: { nowMs: NOW_MS, tzOffsetS: 0, prevHr: 'jr1:100' } }, st).state as JringState;
    st = P.ingest(pad20([0x16, 0xa0, 1, 0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60, 0, 0, 0, 0, 0, 0]), st).state as JringState;
    const r = P.timeout!(st, 'stall');
    expect(r.done).toBe(true);
    expect(r.events.some((e) => e.type === 'status' && e.key === 'cursor')).toBe(false);
    expect(r.events).toEqual([{ type: 'status', key: 'error', value: 'partial:hr:1', stream: 'hr' }]);
    expect((r.state as JringState).cursors.hr).toBe('jr1:100');
  });
});
