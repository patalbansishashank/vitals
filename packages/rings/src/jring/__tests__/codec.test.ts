// @vitest-environment node
/**
 * Jring golden vectors (`qa/fixtures/rings/jring`): every encoder frame byte-exact through `protocol.frame`, every decoder
 * vector against the Kotlin-shaped events, the `JringClock` rules, the mapping onto `RingEvent` through `protocol.ingest`,
 * scan match, reconnect and priority.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANDROID_RECONNECT, fromHex, toHex, type Advertisement, type RingCommand, type RingEvent } from '../../types';
import { JRING_KEEPALIVE_MS, jringKeepalive } from '../commands';
import { decodeJringPacket, ringDateMs, type JringDecoded } from '../decoder';
import { JRING_PRIORITY, jring, matchJring } from '../family';
import type { JringState } from '../protocol';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/jring');
const json = <T,>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;

describe('Jring encode vectors', () => {
  it('frames every Kotlin command byte-exact (20 bytes, zero padded)', () => {
    const { vectors } = json<{ vectors: Array<{ name: string; command: RingCommand; frame: string }> }>('encode.json');
    expect(vectors.length).toBeGreaterThanOrEqual(33);
    const st = jring.protocol.initialState();
    for (const v of vectors) {
      const frames = jring.protocol.frame(v.command, st);
      expect(frames.length, v.name).toBe(1);
      expect(frames[0]!.bytes.length, v.name).toBe(20);
      expect(toHex(frames[0]!.bytes), v.name).toBe(v.frame);
      expect(toHex(jring.protocol.redactOutbound(frames[0]!.bytes)), v.name).toBe(v.frame);
    }
  });

  it('the keepalive is a library command; the stop of a live stream re-arms background logging', () => {
    expect(JRING_KEEPALIVE_MS).toBe(15_000);
    expect(toHex(jring.protocol.frame(jringKeepalive, {})[0]!.bytes)).toMatch(/^3a( 00){19}$/);
    expect(jring.protocol.frame(jring.liveHeartRate!.stop, {}).map((f) => toHex(f.bytes.subarray(0, 8)))).toEqual(['15 00 00 00 00 00 00 00', '19 00 00 17 3b 01 1e 01']);
  });
});

// ---------------------------------------------------------------- decode vectors (Kotlin-shaped events)

type Expected = Record<string, unknown> & { kotlin: string; also?: Record<string, unknown>; tolerance?: number };
interface DecodeVector {
  name: string;
  context: { clockOffsetS: number | null };
  bytes?: string;
  bytesSequence?: string[];
  events: Expected[];
  match: 'exact' | 'first' | 'contains';
  minCount?: number;
}

/** Kotlin fields the port does not carry (always the same value for this family, or a provenance tag). */
const NOT_PORTED = new Set(['activeMinutes', 'replaceActiveMinutes', 'measurementResult', 'measurementStream', 'provenance', 'completeSession']);
const NOW_MS = 1_700_000_000_000;

function field(d: JringDecoded, key: string): unknown {
  const o = d as unknown as Record<string, unknown>;
  switch (key) {
    case 'timestampS':
      return (o.tMs as number) / 1000;
    case 'kind_field':
      return o.measurement;
    case 'raw':
      return toHex(o.raw as Uint8Array);
    case 'stagesPrefix':
    case 'stages':
      return (o.stages as string[]).map((s) => s.toUpperCase());
    case 'stageCount':
      return (o.stages as string[]).length;
    case 'addressNotNull':
      return o.address !== null && o.address !== undefined;
    case 'capabilityBytes':
      return toHex(o.payload as Uint8Array);
    case 'hasTemperature':
    case 'separateBloodOxygenMode':
    case 'hasOxygenOfflineHistory':
    case 'hasPressureHistory':
      return (o.caps as Record<string, boolean>)[key];
  }
  if (!(key in o)) throw new Error(`decoded ${d.kind} has no field ${key}`);
  return o[key];
}

function check(name: string, d: JringDecoded | undefined, e: Expected): void {
  expect(d?.kind, name).toBe(e.kotlin);
  const fields = { ...e.also, ...e };
  for (const [k, want] of Object.entries(fields)) {
    if (['kotlin', 'also', 'tolerance', 'minCount'].includes(k) || NOT_PORTED.has(k)) continue;
    if (want === 'now' || (want === null && k === 'percent')) continue; // phone time is not pinned; Spo2Progress has no percent
    const got = field(d!, k);
    if (k === 'stagesPrefix') expect((got as string[]).slice(0, (want as string[]).length), `${name} ${k}`).toEqual(want);
    else if (typeof want === 'number' && e.tolerance !== undefined) expect(Math.abs((got as number) - want), `${name} ${k}`).toBeLessThanOrEqual(e.tolerance);
    else expect(got, `${name} ${k}`).toEqual(want);
  }
}

describe('Jring decode vectors', () => {
  const fixture = json<{ vectors: DecodeVector[]; clockVectors: Array<{ name: string; steps: Array<Record<string, unknown>> }> }>('decode.json');

  it('every vector decodes as the Kotlin does', () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(55);
    for (const v of fixture.vectors) {
      const packets = v.bytesSequence ?? [v.bytes ?? ''];
      const out = packets.flatMap((p) => decodeJringPacket(fromHex(p), v.context.clockOffsetS, NOW_MS));
      if (v.match === 'exact') {
        expect(out.length, v.name).toBe(v.events.length);
        v.events.forEach((e, i) => check(v.name, out[i], e));
      } else if (v.match === 'first') {
        check(v.name, out[0], v.events[0]!);
      } else {
        expect(out.length, v.name).toBeGreaterThanOrEqual(v.minCount ?? v.events.length);
        for (const e of v.events) {
          const hit = out.find((d) => d.kind === e.kotlin && (e.kind_field === undefined || (d as { measurement?: string }).measurement === e.kind_field));
          check(v.name, hit, e);
        }
      }
    }
  });

  it('JringClock: date subtracts the latched offset; the offset stays until the next capture', () => {
    for (const v of fixture.clockVectors) {
      let offset = 0;
      for (const s of v.steps) {
        if (s.do === 'construct' || s.do === 'capture') offset = s.expectOffsetS as number;
        if (s.do === 'date') expect(ringDateMs(s.ringEpochS as number, offset), v.name).toBe((s.expectEpochS as number) * 1000);
      }
    }
    // The protocol latches the offset stamped on the 0x01 it writes.
    const st = jring.protocol.begin!({ op: 'timeSync', params: { nowMs: NOW_MS, tzOffsetS: -28_800 } }, jring.protocol.initialState()).state as JringState;
    expect(st.clockOffsetS).toBe(-28_800);
  });
});

// ---------------------------------------------------------------- mapping onto RingEvent through protocol.ingest

const ingest = (hex: string, over: Partial<JringState> = {}): RingEvent[] => {
  // The packet with fifteen minute slots is received after its final slot, not at its first slot.
  const st = { ...(jring.protocol.initialState() as JringState), nowMs: NOW_MS + 20 * 60_000, ...over };
  return jring.protocol.ingest(fromHex(hex), st).events;
};
const pad = (hex: string): string => {
  const b = fromHex(hex);
  const out = new Uint8Array(20);
  out.set(b);
  return toHex(out);
};

describe('Jring RingEvent mapping (RingEventBridge gates)', () => {
  it('battery and charging; out-of-range battery is dropped', () => {
    expect(ingest(pad('0b 55 01'))).toEqual([{ type: 'status', key: 'battery', value: 85 }, { type: 'status', key: 'charging', value: 1 }]);
    expect(ingest(pad('0b 65'))).toEqual([]);
  });

  it('0x0C gives firmware and the address as serial unless it is all zero', () => {
    expect(ingest('0c 8a 00 11 22 33 44 55 66 3a 00 2a 00 00 00 00 00 00 00 00')).toEqual([
      { type: 'status', key: 'firmware', value: '003A002AV138' },
      { type: 'status', key: 'serial', value: '11:22:33:44:55:66' },
    ]);
    expect(ingest(pad('0c'))).toEqual([{ type: 'status', key: 'firmware', value: '00000000V0' }]);
  });

  it('heart rate: a zero ring time (error) and values outside 30..220 give nothing', () => {
    expect(ingest(pad('14 00 00 00 00 48'))).toEqual([]);
    expect(ingest(pad('14 01 f1 53 65 1d'))).toEqual([]);
    expect(ingest(pad('14 01 f1 53 65 48'))).toEqual([{ type: 'sample', stream: 'hr', t: 1_700_000_001_000, value: 72, unit: 'bpm', origin: 'live' }]);
  });

  it('history values older than 8 days are dropped; 0x10 buckets over 5000 steps are dropped', () => {
    const old = (NOW_MS / 1000 - 9 * 86_400) >>> 0;
    const le = [old & 0xff, (old >> 8) & 0xff, (old >> 16) & 0xff, (old >> 24) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    expect(ingest(`16 a0 ${le} 00 00 46 46 46 46 46 46 00 00 00 00 00 00`, { clockOffsetS: 0 })).toEqual([]);
    expect(ingest(pad('10 00 f1 53 65 ff')).filter((e) => e.type === 'activityBucket').length).toBe(15);
  });

  it('0x03 becomes a dailyTotal at the instant of the ring-local midnight (what records.ts expects)', () => {
    // Ring time 2023-11-14 06:13:20 local in UTC-8: the local day starts at 2023-11-14T08:00:00Z.
    expect(ingest('03 80 80 53 65 d2 04 00 00 84 03 00 00 2d 00 00 00 00 00 00', { clockOffsetS: -28_800 })).toEqual([
      { type: 'dailyTotal', localDay: 1_699_948_800_000, steps: 1234, distanceM: 900, kcal: 45 },
    ]);
  });

  it('capabilities, unknown ids and the keepalive id map to no record', () => {
    expect(ingest(pad('20 00 00 00 00 00 00 00 00 02'))).toEqual([{ type: 'status', key: 'capabilities', value: '00 00 00 00 00 00 00 00 02 00 00 00 00 00 00 00 00 00 00' }]);
    expect(ingest(pad('3a'))).toEqual([]);
    expect(ingest(pad('fe 01'))).toEqual([]);
    expect(ingest('0b 32')).toEqual([]);
  });

  it('a ring-driven bind INIT is answered with APP_START, ACK with SUCCESS', () => {
    const st = jring.protocol.initialState();
    expect(jring.protocol.ingest(fromHex(pad('4b 00 00')), st).send).toEqual([{ op: 'bind', params: { action: 1 } }]);
    expect(jring.protocol.ingest(fromHex(pad('4b 02 00')), st).send).toEqual([{ op: 'bind', params: { action: 4 } }]);
    expect(jring.protocol.ingest(fromHex(pad('4b 00 01')), st).send).toBeUndefined();
  });
});

// ---------------------------------------------------------------- scan, reconnect, priority

const ad = (a: Partial<Advertisement>): Advertisement => ({ serviceUuids: [], manufacturerData: [], ...a });

describe('Jring scan match and policies', () => {
  it('JringCoordinator.matches: generic name unless Colmi, the 56ff service, or the manufacturer needle', () => {
    expect(matchJring(ad({ name: 'SMART_RING' }))).toBe(true);
    expect(matchJring(ad({ name: 'SMART_RING', serviceUuids: ['6e40fff0-b5a3-f393-e0a9-e50e24dcca9e'] }))).toBe(false);
    expect(matchJring(ad({ name: 'SMART_RING', serviceUuids: ['DE5BF728-D711-4E47-AF26-65E3012A5DC7'] }))).toBe(false);
    expect(matchJring(ad({ name: 'SMART_RING', serviceUuids: ['6e40fff0-b5a3-f393-e0a9-e50e24dcca9e', '56ff'] }))).toBe(true);
    expect(matchJring(ad({ serviceUuids: ['000056ff-0000-1000-8000-00805f9b34fb'] }))).toBe(true);
    expect(matchJring(ad({ serviceUuids: ['56FF'] }))).toBe(true);
    expect(matchJring(ad({ manufacturerData: [fromHex('ff ff 41 42 2e c7 5b 6a 00')] }))).toBe(true);
    expect(matchJring(ad({ manufacturerData: [fromHex('ff ff 41 42 2e c7 5b')] }))).toBe(false);
    expect(matchJring(ad({ name: 'smart_ring' }))).toBe(false);
    expect(matchJring(ad({ name: 'R02_1234' }))).toBe(false);
    expect(matchJring(ad({ name: 'R10M 1234', serviceUuids: ['fff0'] }))).toBe(false);
    expect(jring.modelFromAdvertisement!(ad({ name: 'SMART_RING' }))).toBe('SMART_RING');
  });

  it('lists the CRP and Colmi services so the registry can reroute a SMART_RING after connecting', () => {
    expect(jring.scan.optionalServices).toEqual(expect.arrayContaining([
      '000056ff-0000-1000-8000-00805f9b34fb', '0000180f-0000-1000-8000-00805f9b34fb', '0000180a-0000-1000-8000-00805f9b34fb',
      '0000fdda-0000-1000-8000-00805f9b34fb', '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e', 'de5bf728-d711-4e47-af26-65e3012a5dc7',
    ]));
    expect(jring.scan.requestFilters).toEqual([{ name: 'SMART_RING' }, { services: ['000056ff-0000-1000-8000-00805f9b34fb'] }]);
    expect(jring.gatt).toMatchObject({
      service: '000056ff-0000-1000-8000-00805f9b34fb', write: '000033f3-0000-1000-8000-00805f9b34fb',
      notify: [{ characteristic: '000033f4-0000-1000-8000-00805f9b34fb', mode: 'notify' }],
      battery: { service: '0000180f-0000-1000-8000-00805f9b34fb', characteristic: '00002a19-0000-1000-8000-00805f9b34fb' },
    });
  });

  it('reconnects like Android and never idles below balanced', () => {
    expect(jring.reconnect).toBe(ANDROID_RECONNECT);
    expect(jring.priority).toEqual({ active: 'high', idle: 'balanced', idleLowPowerMs: 300_000, idleLong: 'balanced' });
    expect(JRING_PRIORITY.idleLong).toBe('balanced');
    expect(jring.tier).toBe('C');
    expect(jring.decoderTag('003A002AV138')).toBe('jring/003A002AV138@1');
  });
});
