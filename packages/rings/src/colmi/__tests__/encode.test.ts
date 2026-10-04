// @vitest-environment node
/**
 * Colmi family: encode vectors (`encode.json`) byte-exact through `protocol.frame`, scan match, GATT map, reconnect and
 * link priority.
 */
import { describe, expect, it } from 'vitest';
import { ANDROID_RECONNECT, DEFAULT_PRIORITY, toHex, uuid16, type Advertisement } from '../../types';
import { COLMI_UUIDS, crc16Modbus } from '../commands';
import { colmi, matchColmi } from '../family';
import { fixture } from './helpers';

interface EncodeVector {
  name: string;
  command: { op: string; params: Record<string, number | string | boolean> };
  frame: string;
  channel: 'write' | 'command';
}

describe('Colmi encode vectors', () => {
  const { vectors } = fixture<{ vectors: EncodeVector[] }>('encode.json');

  it('frames every Kotlin command byte-exact, big data on the command channel', () => {
    expect(vectors.length).toBeGreaterThan(60);
    const st = colmi.protocol.initialState();
    for (const v of vectors) {
      const frames = colmi.protocol.frame(v.command, st);
      expect(frames.length, v.name).toBe(1);
      expect(toHex(frames[0]!.bytes), v.name).toBe(v.frame);
      expect(frames[0]!.channel ?? 'write', v.name).toBe(v.channel);
    }
  });

  it('CRC16/MODBUS of the big-data payload', () => {
    expect(crc16Modbus([0xff, 0x01])).toBe(0x8081);
    expect(crc16Modbus([0x06])).toBe(0x423f);
  });

  it('redactOutbound is the identity (no credential frame on this family)', () => {
    const f = colmi.protocol.frame({ op: 'battery' }, colmi.protocol.initialState())[0]!.bytes;
    expect(colmi.protocol.redactOutbound(f)).toEqual(f);
  });

  it('live heart rate and stops follow the real-time refusal mark and the last bpm', () => {
    const st = { ...colmi.protocol.initialState(), realtimeRejected: true, lastManualBpm: 74 };
    expect(toHex(colmi.protocol.frame({ op: 'liveHrStart' }, st)[0]!.bytes).slice(0, 5)).toBe('69 01');
    expect(toHex(colmi.protocol.frame({ op: 'liveHrStop' }, st)[0]!.bytes).slice(0, 11)).toBe('6a 01 4a 00');
    expect(toHex(colmi.protocol.frame({ op: 'manualHeartRateStop' }, st)[0]!.bytes).slice(0, 11)).toBe('6a 01 4a 00');
    const fresh = colmi.protocol.initialState();
    expect(toHex(colmi.protocol.frame({ op: 'liveHrStart' }, fresh)[0]!.bytes).slice(0, 5)).toBe('1e 01');
    expect(toHex(colmi.protocol.frame({ op: 'liveHrStop' }, fresh)[0]!.bytes).slice(0, 5)).toBe('1e 02');
  });

  it('unknown commands are refused', () => {
    expect(() => colmi.protocol.frame({ op: 'bloodSugar' }, colmi.protocol.initialState())).toThrow(RangeError);
  });
});

describe('Colmi scan match', () => {
  const ad = (name: string | undefined, serviceUuids: string[] = []): Advertisement => ({ name, serviceUuids, manufacturerData: [] });

  it('claims every Colmi name pattern and the V1/V2 services', () => {
    for (const n of ['R02_1A2B', 'R03_00FF', 'R05_12AB', 'R06_X', 'COLMI R07_1234', 'R08_9', 'R09_9D07', 'COLMI R10_1', 'R10_1A2B', 'R11C_1A2B', 'R11_1A2B', 'COLMI R12_7', 'H59_1']) {
      expect(matchColmi(ad(n)), n).toBe(true);
    }
    expect(matchColmi(ad(undefined, [COLMI_UUIDS.serviceV1]))).toBe(true);
    expect(matchColmi(ad(undefined, ['DE5BF728-D711-4E47-AF26-65E3012A5DC7']))).toBe(true);
  });

  it('leaves the look-alikes of other families alone', () => {
    for (const n of ['R10M_1A2B', 'R10M 1A2B', 'R100', 'R100_1A2B', 'TK5 1234', 'R02 1A2B', 'R05_12ab', 'R10_1A2B3', 'R11C_1A2', 'SMART_RING', 'R07_1234']) {
      expect(matchColmi(ad(n)), n).toBe(false);
    }
    expect(matchColmi(ad(undefined, [uuid16(0xfff0)]))).toBe(false);
  });

  it('gives the model from the name and web filters for every prefix', () => {
    expect(colmi.modelFromAdvertisement?.(ad('R11C_1A2B'))).toBe('R11');
    expect(colmi.modelFromAdvertisement?.(ad('COLMI R10_1'))).toBe('R10');
    expect(colmi.modelFromAdvertisement?.(ad('Smart Ring'))).toBeUndefined();
    const prefixes = colmi.scan.requestFilters.map((f) => f.namePrefix).filter(Boolean);
    expect(prefixes).toEqual(expect.arrayContaining(['R02_', 'R10_', 'R11C_', 'COLMI R07_', 'COLMI R10_', 'COLMI R12_', 'H59_']));
    expect(colmi.scan.optionalServices).toEqual([COLMI_UUIDS.serviceV1, COLMI_UUIDS.serviceV2, uuid16(0x180a)]);
  });
});

describe('Colmi family shape', () => {
  it('maps both notify channels and the big-data command characteristic', () => {
    expect(colmi.gatt.service).toBe('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e');
    expect(colmi.gatt.write).toBe('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
    expect(colmi.gatt.notify).toEqual([
      { characteristic: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', mode: 'notify' },
      { characteristic: 'de5bf729-d711-4e47-af26-65e3012a5dc7', mode: 'notify', service: 'de5bf728-d711-4e47-af26-65e3012a5dc7' },
    ]);
    expect(colmi.gatt.command).toBe('de5bf72a-d711-4e47-af26-65e3012a5dc7');
    expect(colmi.gatt.commandService).toBe('de5bf728-d711-4e47-af26-65e3012a5dc7');
    expect(colmi.gatt.battery).toBeUndefined();
  });

  it('uses the Android reconnect rules and the default link priority', () => {
    expect(colmi.reconnect).toBe(ANDROID_RECONNECT);
    expect(colmi.priority).toBe(DEFAULT_PRIORITY);
    expect(colmi.tier).toBe('C');
    expect(colmi.decoderTag('RT09_3.10.22')).toBe('colmi/RT09_3.10.22@1');
    expect(colmi.streams).toEqual(['steps', 'hr', 'vendor:stress', 'spo2', 'sleep_stage', 'hrv', 'skin_temp']);
  });

  it('plans the Kotlin walk in its order, full depth on a fresh connection, back to the last walk after a full read', () => {
    const plan = colmi.protocol.planSync({}, colmi.protocol.initialState());
    expect(plan.map((c) => `${String(c.params?.stage)}:${String(c.params?.lastDay)}`)).toEqual(['activity:7', 'hr:7', 'stress:6', 'spo2:0', 'sleep:0', 'hrv:6', 'temperature:6']);
    const warm = colmi.protocol.planSync({}, { ...colmi.protocol.initialState(), pulled: { hr: 20_651 } });
    expect(warm[1]!.params).toEqual({ stage: 'hr', stream: 'hr', sinceDay: 20_651 });
    expect(warm[0]!.params?.lastDay).toBe(7);
  });
});
