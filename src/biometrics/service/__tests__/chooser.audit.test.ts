// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { chooserFactory } from '../../ble/transports/rings';
import type { BleTransport, RingLink } from '../../ble/transports/types';
import { RING_FAMILIES } from '../../../../packages/rings/src/index';
import type { RingFamily, RingSession, SessionRuntime } from '../../../../packages/rings/src/types';
import { createRingsConnector } from '../connectors/rings';

describe('C-RINGX service handoff', () => {
  for (const selected of [
    { name: 'R02_SYNTHETIC', services: ['6e40fff0-b5a3-f393-e0a9-e50e24dcca9e'], family: 'colmi' },
    { name: 'J-Style ring', services: ['0000fff0-0000-1000-8000-00805f9b34fb'], family: 'jstyle2301' },
  ]) {
    for (const variant of ['normal', 'reversed generic'] as const) it(`routes the chosen ${selected.family} peripheral with ${variant} candidate order`, async () => {
      const name = variant === 'normal' ? selected.name : 'Unlabelled ring';
      const families = variant === 'normal' ? RING_FAMILIES : [...RING_FAMILIES].reverse();
      const link: RingLink = {
        deviceId: 'selected-device', deviceName: name,
        services: async () => selected.services,
        write: async () => {}, subscribe: async () => () => {}, disconnect: async () => {}, onDisconnect: () => () => {},
      };
      const transport: BleTransport = {
        kind: 'web', isAvailable: async () => true,
        requestDevice: async () => link,
      };
      const open = vi.fn(async (family: RingFamily): Promise<RingSession & { runtime: SessionRuntime }> => ({
        family, identity: { family: family.id, ringId: 'adv:selected-device', basis: 'advertised' },
        info: () => ({ firmware: 'synthetic', clockOffsetS: 0 }), battery: async () => undefined,
        sync: async function* () {}, readHistory: async function* () {}, liveHeartRate: async function* () {}, spot: async function* () {},
        on: () => () => {}, handshakeEvents: [], close: async () => {}, runtime: {} as SessionRuntime,
      }));
      const connector = createRingsConnector({ factory: chooserFactory(transport, 'web-bluetooth'), families, open });
      const hits = [];
      for await (const hit of connector.scan(new AbortController().signal)) hits.push(hit);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.driverId).toBe(selected.family);
      const session = await connector.connect(hits[0]!, new AbortController().signal);
      expect(session.identity.driverId).toBe(selected.family);
      expect(open.mock.calls[0]?.[0].id).toBe(selected.family);
    });
  }

  it('routes the peripheral picked from a desktop chooser after GATT discovery', async () => {
    const chosen = 'picked-device';
    const link: RingLink = {
      deviceId: chosen, deviceName: 'Unlabelled ring', services: async () => ['0000fff0-0000-1000-8000-00805f9b34fb'],
      write: async () => {}, subscribe: async () => () => {}, disconnect: async () => {}, onDisconnect: () => () => {},
    };
    const transport: BleTransport = {
      kind: 'electron', isAvailable: async () => true,
      requestDevice: async (_query, opts) => {
        opts?.chooser?.update([{ id: 'other-device', name: 'Unlabelled ring' }, { id: chosen, name: 'Unlabelled ring' }]);
        expect(await opts?.chooser?.chosen).toBe(chosen);
        return link;
      },
    };
    const open = vi.fn(async (family: RingFamily): Promise<RingSession & { runtime: SessionRuntime }> => ({
      family, identity: { family: family.id, ringId: 'adv:picked-device', basis: 'advertised' },
      info: () => ({ firmware: 'synthetic', clockOffsetS: 0 }), battery: async () => undefined,
      sync: async function* () {}, readHistory: async function* () {}, liveHeartRate: async function* () {}, spot: async function* () {},
      on: () => () => {}, handshakeEvents: [], close: async () => {}, runtime: {} as SessionRuntime,
    }));
    const connector = createRingsConnector({ factory: chooserFactory(transport, 'electron'), families: [...RING_FAMILIES].reverse(), open });
    const scan = connector.scan(new AbortController().signal)[Symbol.asyncIterator]();
    expect((await scan.next()).value?.candidateId).toBe('other-device');
    const hit = (await scan.next()).value;
    expect(hit).toMatchObject({ candidateId: chosen, driverId: 'unidentified' });
    const session = await connector.connect(hit!, new AbortController().signal);
    expect(session.identity.driverId).toBe('jstyle2301');
    expect(open.mock.calls[0]?.[0].id).toBe('jstyle2301');
    expect((await scan.next()).done).toBe(true);
  });

  for (const failure of ['unsupported', 'discovery failed'] as const) {
    it(`closes the selected link when ${failure}`, async () => {
      const disconnect = vi.fn(async () => {});
      const link: RingLink = {
        deviceId: 'selected-device', deviceName: 'Unknown ring',
        services: failure === 'unsupported' ? async () => [] : async () => { throw new Error('GATT discovery failed'); },
        write: async () => {}, subscribe: async () => () => {}, disconnect, onDisconnect: () => () => {},
      };
      const transport: BleTransport = { kind: 'web', isAvailable: async () => true, requestDevice: async () => link };
      const connector = createRingsConnector({ factory: chooserFactory(transport, 'web-bluetooth'), families: RING_FAMILIES });
      const hits = [];
      for await (const hit of connector.scan(new AbortController().signal)) hits.push(hit);
      expect(hits[0]?.driverId).toBe('unidentified');
      await expect(connector.connect(hits[0]!, new AbortController().signal)).rejects.toMatchObject({ code: failure === 'unsupported' ? 'unsupported' : 'not_found' });
      expect(disconnect).toHaveBeenCalledOnce();
    });
  }
});
