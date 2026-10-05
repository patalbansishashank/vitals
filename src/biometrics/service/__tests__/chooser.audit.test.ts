// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { chooserFactory } from '../../ble/transports/rings';
import type { BleTransport, FoundDevice, RequestOptions, RingLink } from '../../ble/transports/types';
import { RING_FAMILIES, matchFamilyByName } from '../../../../packages/rings/src/index';
import type { RingFamily, RingSession, SessionRuntime } from '../../../../packages/rings/src/types';
import { ycbt } from '../../../../packages/rings/src/ycbt/family';
import { YCBT_COMPANY_ID, YCBT_SERVICE } from '../../../../packages/rings/src/ycbt/commands';
import { createRingsConnector } from '../connectors/rings';
import { createRingService } from '../ringService';
import type { RingScanHit } from '../ports';
import { devicePorts, FakeClock, MemoryLocal, SharedStore } from './fakes';

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

/** A session for whichever family the connector opens (no protocol runs). */
const fakeOpen = () =>
  vi.fn(async (family: RingFamily): Promise<RingSession & { runtime: SessionRuntime }> => ({
    family, identity: { family: family.id, ringId: 'adv:E2:80:00:00:73:07', basis: 'advertised' },
    info: () => ({ firmware: 'synthetic', clockOffsetS: 0 }), battery: async () => undefined,
    sync: async function* () {}, readHistory: async function* () {}, liveHeartRate: async function* () {}, spot: async function* () {},
    on: () => () => {}, handshakeEvents: [], close: async () => {}, runtime: {} as SessionRuntime,
  }));

/** A platform list (`kind`: the desktop's Electron bridge, or the Android app's scan) that lists `list` and connects the pick. */
function listing(kind: BleTransport['kind'], list: FoundDevice[], services: string[]) {
  const link = (id: string): RingLink => ({
    deviceId: id, deviceName: list.find((d) => d.id === id)?.name, services: async () => services,
    write: async () => {}, subscribe: async () => () => {}, disconnect: async () => {}, onDisconnect: () => () => {},
  });
  const transport: BleTransport = {
    kind, isAvailable: async () => true,
    requestDevice: async (_q, opts?: RequestOptions) => {
      opts?.chooser?.update(list);
      const id = await opts?.chooser?.chosen;
      if (!id) throw Object.assign(new Error('closed'), { name: 'NotFoundError' });
      return link(id);
    },
  };
  return transport;
}

const ACME = { id: 'E2:80:00:00:73:07', name: 'Acme Smart Ring 7307' };
const FFF0 = '0000fff0-0000-1000-8000-00805f9b34fb';
const ycbtBlock = Uint8Array.of(YCBT_COMPANY_ID & 0xff, YCBT_COMPANY_ID >> 8, 0x01, 0x02);
const j2301Block = Uint8Array.of(0x34, 0x12, 0xe2, 0x80, 0x00, 0x00, 0x73, 0x07, 0x23, 0x01);

async function firstHit(connector: ReturnType<typeof createRingsConnector>, ctl: AbortController): Promise<RingScanHit> {
  const it = connector.scan(ctl.signal)[Symbol.asyncIterator]();
  const r = await it.next();
  return r.value as RingScanHit;
}

describe('DESKSCAN: the desktop list classifies a ring by its name only through a name filter', () => {
  it('the name of the J-Style ring fits YCBT’s name guess, which is why a name alone must not decide', () => {
    expect(ycbt.scan.match({ name: ACME.name, serviceUuids: [], manufacturerData: [] })).toBe(true);
    expect(matchFamilyByName(ACME.name)).toBeUndefined();
  });

  it('a name-only desktop row is "Ring" (unidentified); the tap finds FFF0 over GATT and opens the J-Style 2301 driver', async () => {
    const open = fakeOpen();
    const connector = createRingsConnector({ factory: chooserFactory(listing('electron', [ACME], [FFF0, '0000180a-0000-1000-8000-00805f9b34fb']), 'electron'), open });
    const ports = { ...devicePorts({ store: new SharedStore(), clock: new FakeClock(), rings: [], deviceId: 'DEVICEA000000001', label: 'Desktop', local: new MemoryLocal() }), connector, platform: 'electron' as const };
    const svc = createRingService(ports);
    const ctl = new AbortController();
    const rows = svc.scan(ctl.signal)[Symbol.asyncIterator]();
    const row = (await rows.next()).value!;
    expect(row).toMatchObject({ candidateId: ACME.id, driverId: 'unidentified', label: 'Ring', known: false });
    // the person taps "Ring": the list is answered, GATT discovery picks the driver
    const hit: RingScanHit = { candidateId: row.candidateId, driverId: row.driverId, platformId: ACME.id };
    const session = await connector.connect(hit, ctl.signal);
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]![0].id).toBe('jstyle2301');
    expect(session.identity.driverId).toBe('jstyle2301');
    ctl.abort();
  });

  it('a name a family asks for by name still names the row on the desktop (R10M 1A2B → YCBT, SMART_RING → Jring)', async () => {
    for (const [name, family] of [['R10M 1A2B', 'ycbt'], ['SMART_RING', 'jring'], ['Acme Smart Ring 7307', 'unidentified']] as const) {
      const connector = createRingsConnector({ factory: chooserFactory(listing('electron', [{ id: ACME.id, name }], []), 'electron'), open: fakeOpen() });
      const ctl = new AbortController();
      expect((await firstHit(connector, ctl)).driverId).toBe(family);
      ctl.abort();
    }
  });

  it('YCBT is still identified when its manufacturer data or its service is there', async () => {
    for (const device of [{ ...ACME, manufacturerData: [ycbtBlock] }, { ...ACME, serviceUuids: [YCBT_SERVICE] }] as FoundDevice[]) {
      const connector = createRingsConnector({ factory: chooserFactory(listing('electron', [device], []), 'electron'), open: fakeOpen() });
      const ctl = new AbortController();
      expect((await firstHit(connector, ctl)).driverId).toBe('ycbt');
      ctl.abort();
    }
    // a browser pick whose services show YCBT
    const link: RingLink = { deviceId: 'web-1', deviceName: ACME.name, services: async () => [YCBT_SERVICE], write: async () => {}, subscribe: async () => () => {}, disconnect: async () => {}, onDisconnect: () => () => {} };
    const web = createRingsConnector({ factory: chooserFactory({ kind: 'web', isAvailable: async () => true, requestDevice: async () => link }, 'web-bluetooth'), open: fakeOpen() });
    expect((await firstHit(web, new AbortController())).driverId).toBe('ycbt');
  });

  it('the Android app’s scan (whole advertisements) is matched as before', async () => {
    const cases: Array<[FoundDevice, string]> = [
      // the J-Style ring as the phone sees it: its 0x1234 block ending 23 01 claims it first
      [{ ...ACME, manufacturerData: [j2301Block] }, 'jstyle2301'],
      [{ ...ACME, serviceUuids: [FFF0] }, 'jstyle2301'],
      // a ring that advertises nothing but this name: YCBT's name rule, unchanged on the phone
      [ACME, 'ycbt'],
    ];
    for (const [device, family] of cases) {
      const connector = createRingsConnector({ factory: chooserFactory(listing('capacitor', [device], []), 'electron'), open: fakeOpen() });
      const ctl = new AbortController();
      expect((await firstHit(connector, ctl)).driverId).toBe(family);
      ctl.abort();
    }
  });
});
