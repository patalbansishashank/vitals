// @vitest-environment node
/** LuckRing scan match (the `LuckRingCoordinator` and `AdvertisementMatcher` cases), GATT map, reconnect and priority. */
import { describe, expect, it } from 'vitest';
import { ANDROID_RECONNECT, DEFAULT_PRIORITY, fromHex, uuid16, type Advertisement } from '../../types';
import { luckring } from '../family';

const ad = (a: Partial<Advertisement>): Advertisement => ({ serviceUuids: [], manufacturerData: [], ...a });

describe('LuckRing scan match', () => {
  const m = luckring.scan.match;

  it('matches the F618 service with any name or none', () => {
    expect(m(ad({ serviceUuids: [uuid16(0xf618)] }))).toBe(true);
    expect(m(ad({ name: 'Anything', serviceUuids: ['0000F618-0000-1000-8000-00805F9B34FB'] }))).toBe(true);
  });

  it('matches company 0xFF64 in on-air layout with any name, in any block', () => {
    expect(m(ad({ name: 'Unlabeled', manufacturerData: [fromHex('64 ff 01 02 03 04 05')] }))).toBe(true);
    expect(m(ad({ manufacturerData: [fromHex('64 ff 01 02')] }))).toBe(true);
    expect(m(ad({ manufacturerData: [fromHex('4c 00 02 15 00'), fromHex('64 ff 01 02')] }))).toBe(true);
    expect(m(ad({ manufacturerData: [fromHex('ff 64 01 02')] }))).toBe(false);
  });

  it('matches the TK18 name pattern only', () => {
    for (const name of ['TK18', 'TK18_AA11', 'TK18 x', 'TK18-x']) expect(m(ad({ name })), name).toBe(true);
    for (const name of ['TK5 24AA', 'R02_A1B2', 'TK180', 'xTK18']) expect(m(ad({ name })), name).toBe(false);
    expect(m(ad({}))).toBe(false);
  });

  it('gives the model from the name and lists the filters Web Bluetooth needs', () => {
    expect(luckring.modelFromAdvertisement!(ad({ name: 'TK18_AA11' }))).toBe('TK18');
    expect(luckring.modelFromAdvertisement!(ad({ name: 'Unlabeled' }))).toBeUndefined();
    expect(luckring.scan.requestFilters).toEqual([{ services: [uuid16(0xf618)] }, { manufacturerData: [{ companyIdentifier: 0xff64 }] }, { namePrefix: 'TK18' }]);
    expect(luckring.scan.optionalServices).toEqual([uuid16(0xf618)]);
  });
});

describe('LuckRing family map', () => {
  it('GATT: F618 service, B002 write without response, B001 notify', () => {
    expect(luckring.gatt).toEqual({
      service: '0000f618-0000-1000-8000-00805f9b34fb',
      write: '0000b002-0000-1000-8000-00805f9b34fb',
      notify: [{ characteristic: '0000b001-0000-1000-8000-00805f9b34fb', mode: 'notify' }],
      writeMode: 'withoutResponse',
    });
  });

  it('reconnect and priority are the Android defaults', () => {
    expect(luckring.reconnect).toBe(ANDROID_RECONNECT);
    expect(luckring.priority).toBe(DEFAULT_PRIORITY);
    expect(luckring.tier).toBe('C');
  });

  it('decoder tag and live commands', () => {
    expect(luckring.decoderTag('1.2.3.4.5')).toBe('luckring/1.2.3.4.5@1');
    expect(luckring.decoderTag('')).toBe('luckring/unknown@1');
    expect(luckring.liveHeartRate).toEqual({ start: { op: 'realHeartRate', params: { on: true } }, stop: { op: 'realHeartRate', params: { on: false } } });
    expect(luckring.spot?.hr).toEqual(luckring.liveHeartRate?.start);
  });
});
