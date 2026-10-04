// @vitest-environment node
/**
 * YCBT encode and decode vectors (`qa/fixtures/rings/ycbt/{encode,decode}.json`) through the port, plus the scan rules
 * and the family values. Decode vectors compare Lumen's event classes (the decoders keep Lumen's names and fields).
 */
import { describe, expect, it } from 'vitest';
import { ANDROID_RECONNECT, DEFAULT_PRIORITY, fromHex, toHex, type Advertisement, type RingCommand } from '../../types';
import { YCBT_COMMAND, YCBT_STREAM, assemble, validateFrame, ringTimeToMs, type AssemblerBuffers } from '../commands';
import { decodeFrame, decodeHistory, score, composite, u24, toRingEvents, type YcbtDecoded } from '../decoder';
import { matchYcbt, ycbt, ycbtVariantOf } from '../family';
import { initialYcbtState, type YcbtState } from '../protocol';
import { UTC, checkEvents, fixture, type Expected } from './helpers';

interface EncodeVector { name: string; command: RingCommand; frame: string | null; frames: string[] | null }
interface DecodeVector {
  name: string;
  context: { layer: string; tz?: string; startedMode?: number | null; historyType?: string; fn?: string; instant?: string; channel?: string; profile?: string };
  bytes?: string;
  bytesSequence?: Array<string>;
  channels?: Array<string | null>;
  framesPerAppend?: string[][];
  frame?: { type: number; cmd: number; payload: string } | null;
  events: Array<Expected | 'ignore' | Expected[]>;
  writesFramed?: string[];
  writes?: string[];
  match: string;
  count?: number;
}

const NOW = Date.parse('2026-07-06T12:34:14Z');
const ctx = { ...UTC, nowMs: NOW };
const shaped = (d: YcbtDecoded[]): Array<Expected> => d as unknown as Expected[];

describe('YCBT encode vectors', () => {
  it('frames every Kotlin command byte-exact', () => {
    const { vectors } = fixture<{ vectors: EncodeVector[] }>('encode.json');
    expect(vectors.length).toBe(39);
    for (const v of vectors) {
      const frames = ycbt.protocol.frame(v.command, ycbt.protocol.initialState()).map((f) => toHex(f.bytes));
      expect(frames, v.name).toEqual(v.frames ?? [v.frame]);
    }
  });
});

describe('YCBT decode vectors', () => {
  const { vectors } = fixture<{ vectors: DecodeVector[] }>('decode.json');
  const byLayer = (layer: string): DecodeVector[] => vectors.filter((v) => v.context.layer === layer);

  it('has the 85 vectors', () => expect(vectors.length).toBe(85));

  it('frame validation', () => {
    for (const v of byLayer('frame')) {
      const f = validateFrame(fromHex(v.bytes!));
      expect(f && { type: f.type, cmd: f.cmd, payload: toHex(f.payload) }, v.name).toEqual(v.frame);
    }
  });

  it('assembler: split, joined, resync, per-channel buffers, reset', () => {
    for (const v of byLayer('assembler')) {
      let buffers: AssemblerBuffers = {};
      v.bytesSequence!.forEach((b, i) => {
        if (b === 'RESET') return void (buffers = {});
        const r = assemble(buffers, fromHex(b), v.channels![i]!);
        buffers = r.buffers;
        expect(r.frames.map(toHex), `${v.name} #${i}`).toEqual(v.framesPerAppend![i]);
      });
    }
  });

  it('decoder: replies and pushes in Lumen terms', () => {
    for (const v of byLayer('decoder')) {
      const f = validateFrame(fromHex(v.bytes!))!;
      const zone = v.context.tz ? { tz: v.context.tz, tzOffsetS: 0, nowMs: NOW } : ctx;
      checkEvents(shaped(decodeFrame(f, zone, v.context.startedMode ?? null)), v.events as Expected[], v.match, v.name);
    }
  });

  it('driver: acknowledgements and the capability gate through protocol.ingest', () => {
    for (const v of byLayer('driver')) {
      let st: YcbtState = { ...initialYcbtState('r10m'), nowMs: NOW, tz: 'UTC' };
      const seq = v.bytesSequence ?? [v.bytes!];
      seq.forEach((b, i) => {
        if (b === 'RECONNECT') return void (st = { ...initialYcbtState('r10m'), nowMs: NOW, tz: 'UTC' });
        const r = ycbt.protocol.ingest(fromHex(b), st, v.context.channel);
        st = r.state as YcbtState;
        const writes = (r.send ?? []).flatMap((c) => ycbt.protocol.frame(c, st)).map((f) => toHex(f.bytes));
        if (v.writesFramed) expect(writes, v.name).toEqual(v.writesFramed);
        if (v.writes && v.writes.length === 0) expect(writes, v.name).toEqual([]);
        const exp = v.bytesSequence ? v.events[i] : v.events;
        if (exp === 'ignore' || exp === undefined) return;
        // The gate works on Lumen's classes; map the RingEvents back for the check.
        const back = r.events.map((e) => {
          if (e.type === 'sample') return { kotlin: { hr: 'HeartRateSample', spo2: 'Spo2Result', hrv: 'HrvSample', skin_temp: 'TemperatureSample' }[e.stream as string] ?? e.stream };
          if (e.type === 'vendor' && e.key === 'ycbt_bp_systolic') return { kotlin: 'BloodPressureSample' };
          if (e.type === 'status' && e.key === 'ack') return { kotlin: 'CommandAck', commandId: e.value };
          return { kotlin: `${e.type}` };
        }) as Expected[];
        // Only class presence is compared here: field values are covered by the decoder layer.
        const classes = (exp as Expected[]).map((e) => ({ kotlin: e.kotlin, ...(e.absent ? { absent: true } : {}), ...(e.commandId !== undefined ? { commandId: e.commandId } : {}) })) as Expected[];
        checkEvents(back, classes, v.match === 'prefix' ? 'contains' : v.match, `${v.name} #${i}`);
      });
    }
  });

  it('history records', () => {
    for (const v of byLayer('healthRecords')) {
      const zone = { tz: v.context.tz, tzOffsetS: 0 };
      const out = shaped(decodeHistory(fromHex(v.bytes!), v.context.historyType as never, zone));
      checkEvents(out, v.events as Expected[], v.match, v.name, v.count);
    }
  });

  it('helpers: digit scores, composites, u24', () => {
    const fns: Record<string, (b: Uint8Array) => number> = { score: (b) => score(b[0]!, b[1]!), composite: (b) => composite(b[0]!, b[1]!), u24: (b) => u24(b, 0) };
    for (const v of byLayer('helper')) {
      const want = (v.events[0] as Expected).value as number;
      expect(fns[v.context.fn!]!(fromHex(v.bytes!)), v.name).toBeCloseTo(want, 3);
    }
  });

  it('clock: ring times read in the zone in force at that record (DST), earlier offset in the overlap', () => {
    for (const v of byLayer('clock')) {
      const b = fromHex(v.bytes!);
      const ringS = (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
      expect(new Date(ringTimeToMs(ringS, { tz: v.context.tz, tzOffsetS: 0 })).toISOString().replace('.000', ''), v.name).toBe((v.events[0] as Expected).value);
    }
    // Without a zone the fixed offset applies.
    expect(ringTimeToMs(836_694_044, { tzOffsetS: 19_800 })).toBe((836_694_044 + 946_684_800 - 19_800) * 1000);
  });

  it('RingEvent mapping: units, origins, sleep stages, day totals', () => {
    const map = (d: YcbtDecoded): ReturnType<typeof toRingEvents> => toRingEvents(d, UTC, '1.18');
    expect(map({ kotlin: 'HistoryMeasurement', kind_field: 'HEART_RATE', value: 66, _timestamp: 1 })).toEqual([{ type: 'sample', stream: 'hr', t: 1, value: 66, unit: 'bpm', origin: 'history' }]);
    expect(map({ kotlin: 'HistoryMeasurement', kind_field: 'STRESS', value: 53, _timestamp: 1 })).toEqual([{ type: 'vendor', key: 'ycbt_stress', t: 1, value: 53, unit: 'score', origin: 'history' }]);
    expect(map({ kotlin: 'BloodPressureSample', systolic: 118, diastolic: 79, _timestamp: 1, isHistory: true }).map((e) => e.type === 'vendor' && e.key)).toEqual(['ycbt_bp_systolic', 'ycbt_bp_diastolic']);
    expect(map({ kotlin: 'ActivityUpdate', steps: 635, distanceMeters: 407, calories: 26, _timestamp: NOW })).toEqual([{ type: 'dailyTotal', localDay: Date.parse('2026-07-06T00:00:00Z'), steps: 635, distanceM: 407, kcal: 26 }]);
    const sleep = decodeHistory(fromHex('af fa 1c 00 1c f0 de 31 2c fe de 31 00 00 00 00 00 00 00 00 f2 1c f0 de 31 08 07 00'), 'sleep', UTC);
    const ev = map(sleep[0]!)[0]!;
    expect(ev.type === 'sleepEpochs' && [ev.stages.length, ev.stages[0], ev.stages[59], ev.rawCodes[0], ev.rawCodes[59], ev.epochS, ev.complete]).toEqual([60, 'light', 'awake', 0xf2, 0, 60, true]);
    const sport = decodeHistory(fromHex('1c f0 de 31 a0 f3 de 31 80 02 e0 01 19 00'), 'sport', UTC);
    expect(map(sport[0]!)).toEqual([{ type: 'activityBucket', start: ringTimeToMs(836_694_044, UTC), durS: 900, steps: 640, distanceM: 480 }]);
  });
});

describe('YCBT scan match and variants', () => {
  const ad = (name: string | undefined, services: string[] = [], mfr: string[] = []): Advertisement => ({ name, serviceUuids: services, manufacturerData: mfr.map(fromHex) });
  it('follows Lumen\'s registry order (the AdvertisementMatcher cases in docs/ycbt.md)', () => {
    const cases: Array<[Advertisement, string | undefined]> = [
      [ad('R10M FCF4'), 'r10m'], [ad('R10M_FCF4'), 'r10m'], [ad('Unlabeled', ['be940000-7333-be46-b7ae-689e71722bd5']), 'r10m'],
      [ad('TK5 24AA'), 'tk5'], [ad('tk5 24aa'), 'tk5'], [ad('TK5_1234'), 'tk5'], [ad(undefined, [], ['10 78 65 01 aa bb']), 'tk5'], [ad('Unlabeled', [], ['10 78 65 01 aa']), 'tk5'],
      [ad('R99 54DC'), 'smarthealth'], [ad('Shop-Name2211 E1C7', ['180d', 'fee7'], ['10 78 d4 08 77 00']), 'smarthealth'],
      [ad('Unlabeled', ['0000180d-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb'], ['10 78 d4 08 77 00']), 'smarthealth'],
      [ad('Unlabeled', [], ['d4 08 77 00']), undefined], [ad('R99 54DC', ['6e40fff0-b5a3-f393-e0a9-e50e24dcca9e']), undefined],
      [ad('R02_A1B2'), undefined], [ad('COLMI R10_9C3F'), undefined], [ad('R09_9D07'), undefined], [ad('R11C_BEEF'), undefined],
      [ad('TK5 1A2B', ['f618']), undefined], [ad(undefined, [], ['10 78']), 'smarthealth'],
    ];
    for (const [a, want] of cases) expect(ycbtVariantOf(a), a.name).toBe(want);
    expect(matchYcbt(ad('T50_1234'))).toBe(false);
    expect(ycbt.modelFromAdvertisement?.(ad('TK5 24AA'))).toBe('TK5');
    expect(ycbt.modelFromAdvertisement?.(ad('R10M FCF4'))).toBe('R10M');
  });

  it('family values: two indicate channels, Android reconnect, default link priority, tier C', () => {
    expect(ycbt.gatt.notify).toEqual([{ characteristic: YCBT_COMMAND, mode: 'indicate' }, { characteristic: YCBT_STREAM, mode: 'indicate' }]);
    expect(ycbt.gatt.write).toBe(YCBT_COMMAND);
    expect(ycbt.reconnect).toBe(ANDROID_RECONNECT);
    expect(ycbt.priority).toEqual({ active: 'default', idle: 'default', idleLowPowerMs: DEFAULT_PRIORITY.idleLowPowerMs, idleLong: 'default' });
    expect(ycbt.tier).toBe('C');
    expect(ycbt.decoderTag('1.18')).toBe('ycbt/1.18@1');
    expect(ycbt.scan.optionalServices).toEqual(['be940000-7333-be46-b7ae-689e71722bd5']);
    expect(ycbt.scan.requestFilters).toContainEqual({ manufacturerData: [{ companyIdentifier: 0x7810 }] });
    expect(ycbt.protocol.redactOutbound(Uint8Array.of(1, 2))).toEqual(Uint8Array.of(1, 2));
  });
});
