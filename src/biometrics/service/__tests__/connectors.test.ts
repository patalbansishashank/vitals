/**
 * The real connector over A5a (`openRingSession` on the fake peripheral) and the identity rules: one ring seen through
 * three platforms (a MAC, an opaque browser id, a Capacitor address) is one `ringKey`; records carry the ring's
 * provenance; nothing stores or shows the advertised name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecordedLink } from '@/biometrics/ble/fakeLink';
import { command } from '@/biometrics/core/ble/jstyle2301/commands';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import { fakeFromSession, type FixtureSession, type SessionsFixture } from '../../../../packages/rings/src/testing';
import { RingError, uuid16, type Advertisement, type RingEvent, type RingFamily, type Transport, type TransportFactory } from '../../../../packages/rings/src/types';
import { createLegacyConnector } from '../connectors/legacy';
import { TRANSIENT_GATT } from '@/biometrics/ble/transports/capacitor';
import { NoDeviceError } from '@/biometrics/ble/transports/types';
import { UNREACHED_GATT, createRingsConnector, toLinkError, wrapSession } from '../connectors/rings';
import { ANOTHER_APP, errorOf } from '../ringService';
import { familyIdentity, parseRingKey, ringKeyFromId, ringKeyOf } from '../identity';
import { buildRingBatch, foldStatus } from '../ingest';

const ADV_NAME = 'Fake Ring 7307';
const REPO = join(__dirname, '../../../..');
const sessions = JSON.parse(readFileSync(join(REPO, 'qa/fixtures/rings/jstyle2301/sessions.json'), 'utf8')) as SessionsFixture;
const session = (prefix: string): FixtureSession => sessions.sessions.find((x) => x.name.startsWith(prefix))!;
const fast = { timers: { quietMs: 30, stallMs: 80 }, clock: { now: () => Date.parse('2026-09-16T10:00:00Z'), tzOffsetS: () => 0 } };
const SERIAL = `${uuid16(0x180a)}/${uuid16(0x2a25)}`;

/** A platform: how it labels the same physical ring. */
function platformFactory(peripheral: { id?: string; address?: string }, reads: Record<string, string> = {}): TransportFactory & { last?: Transport } {
  const f: TransportFactory & { last?: Transport } = {
    platform: 'fake',
    available: async () => true,
    async scan(_families: readonly RingFamily[], onFound: (ad: Advertisement) => void) {
      onFound({ name: ADV_NAME, serviceUuids: [uuid16(0xfff0)], manufacturerData: [], platformId: peripheral.id ?? peripheral.address, rssi: -55 });
    },
    async connect() {
      const fake = fakeFromSession(session('v0525 handshake'), { name: ADV_NAME, id: peripheral.id, address: peripheral.address, reads });
      fake.script({ expect: { prefix: '54 00' }, reply: ['54 ff'] });
      f.last = fake;
      return fake;
    },
  };
  return f;
}

async function connectThrough(factory: TransportFactory) {
  const c = createRingsConnector({ factory, families: [jstyle2301], session: fast });
  const hits = [];
  for await (const h of c.scan(new AbortController().signal)) hits.push(h);
  expect(hits).toHaveLength(1);
  const s = await c.connect(hits[0]!, new AbortController().signal);
  return { c, s, hit: hits[0]! };
}

describe('one ring, three platforms', () => {
  it('a MAC (Android, BlueZ) gives the mac identity; the same ring with a serial gives the serial identity everywhere', async () => {
    const mac = await connectThrough(platformFactory({ address: 'AA:BB:CC:DD:EE:01' }));
    expect(mac.s.identity).toEqual({ driverId: 'jstyle2301', family: 'jstyle2301', maker: 'J-Style', model: '2301', ringId: 'mac:aa:bb:cc:dd:ee:01' });
    expect(mac.s.platformId).toBe('AA:BB:CC:DD:EE:01');
    await mac.s.close();

    const bySerial = await Promise.all([
      connectThrough(platformFactory({ address: 'aa-bb-cc-dd-ee-01' }, { [SERIAL]: '41 42 43 31 32 33' })), // Linux: address
      connectThrough(platformFactory({ id: 'HkT1vP9q+web/opaque==' }, { [SERIAL]: '41 42 43 31 32 33' })), // browser: per-origin id only
      connectThrough(platformFactory({ id: 'AA:BB:CC:DD:EE:01', address: 'AA:BB:CC:DD:EE:01' }, { [SERIAL]: '41 42 43 31 32 33' })), // Capacitor: address as id
    ]);
    const keys = bySerial.map(({ s }) => ringKeyFromId(s.identity.driverId, s.identity.ringId!, s.identity.model));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('ble:jstyle2301/2301/serial:ABC123');
    expect(bySerial.map(({ s }) => s.platformId)).toEqual(['aa-bb-cc-dd-ee-01', 'HkT1vP9q+web/opaque==', 'AA:BB:CC:DD:EE:01']);
    for (const { s } of bySerial) await s.close();
  });

  it('a browser that sees neither serial nor address gets no identity (the service then matches the person’s known ring)', async () => {
    const { s } = await connectThrough(platformFactory({ id: 'HkT1vP9q+web/opaque==' }));
    expect(s.identity.ringId).toBeUndefined();
    expect(JSON.stringify(s.identity)).not.toContain('opaque');
    await s.close();
  });

  it('syncs history and reports the family’s on-demand checks', async () => {
    const { c, s } = await connectThrough(platformFactory({ address: 'AA:BB:CC:DD:EE:01' }));
    expect(await s.info()).toMatchObject({ firmware: 'V0525', clockOffsetS: 0 });
    const events: RingEvent[] = [];
    for await (const e of s.sync({}, () => undefined, new AbortController().signal)) events.push(e);
    expect(events.some((e) => e.type === 'sample' && e.stream === 'hr')).toBe(true);
    expect(foldStatus(events, {}, 0).cursor.hr).toMatch(/^j1\|/);
    expect(c.driverInfo('jstyle2301')).toMatchObject({ label: 'J-Style 2301', maker: 'J-Style', model: '2301', checks: ['hr'] });
    expect(typeof s.liveHeartRate).toBe('function');
    await s.close();
  });
});

describe('records and provenance', () => {
  it('carries the ring provenance, content ids under the ring key, and no advertised name', () => {
    const ringKey = ringKeyOf({ driverId: 'jstyle2301', address: 'AA:BB:CC:DD:EE:01' });
    expect(ringKey).toBe('ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:01');
    const events: RingEvent[] = [
      { type: 'sample', stream: 'hr', t: Date.parse('2026-10-03T23:10:00Z'), value: 58, unit: 'bpm', origin: 'history' },
      { type: 'sample', stream: 'hr', t: Date.parse('2026-10-03T23:20:00Z'), value: 60, unit: 'bpm', origin: 'history' },
      { type: 'status', key: 'cursor', value: 'j1|55.2', stream: 'hr' },
      { type: 'progress', stage: 'hr', done: true },
    ];
    const ctx = { ringKey, driverId: 'jstyle2301', firmware: 'V0525', clockOffsetS: 0, tz: 'UTC', tzOffsetS: 0, nowMs: Date.parse('2026-10-04T08:00:00Z'), producer: { name: 'vitals-ring', version: '1' } };
    const a = buildRingBatch(events, ctx);
    expect(a.records).toHaveLength(1);
    const r = a.records[0]!;
    expect(r.provenance).toEqual({
      channel: ringKey, source_app: 'Vitals', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-04T08:00:00.000Z', decoder: 'jstyle2301/V0525@1',
      device: { type: 'ring', manufacturer: 'J-Style', model: '2301', firmware: 'V0525', tier: 'C' },
    });
    // another device reading the same night an hour later writes the same record id
    const b = buildRingBatch(events, { ...ctx, nowMs: ctx.nowMs + 3_600_000 });
    expect(b.records[0]!.record_id).toBe(r.record_id);
    expect(JSON.stringify(a)).not.toContain(ADV_NAME);
  });

  it('a source from before v0.5.0 keeps its key and channel', () => {
    const old = 'ble:jstyle2301|j-style:2301';
    expect(parseRingKey(old)).toEqual({ family: 'jstyle2301', legacy: true });
    const batch = buildRingBatch([{ type: 'sample', stream: 'hr', t: Date.parse('2026-10-03T23:10:00Z'), value: 58, unit: 'bpm', origin: 'history' }], {
      ringKey: old, driverId: 'jstyle2301', firmware: 'V0789', clockOffsetS: 0, tz: 'UTC', tzOffsetS: 0, nowMs: Date.parse('2026-10-04T08:00:00Z'), producer: { name: 'vitals-ring', version: '1' },
    });
    expect(batch.records[0]!.provenance).toMatchObject({ channel: 'ble:jstyle2301', source_app: 'Vitals', device: { manufacturer: 'J-Style', model: '2301' } });
    const again = buildRingBatch([{ type: 'sample', stream: 'hr', t: Date.parse('2026-10-03T23:10:00Z'), value: 58, unit: 'bpm', origin: 'history' }], {
      ringKey: old, driverId: 'jstyle2301', firmware: 'V0789', clockOffsetS: 0, tz: 'UTC', tzOffsetS: 0, nowMs: Date.parse('2026-10-05T08:00:00Z'), producer: { name: 'vitals-ring', version: '1' },
    });
    expect(again.records[0]!.record_id).toBe(batch.records[0]!.record_id);
  });

  it('the family table never uses a retail name', () => {
    expect(familyIdentity('jstyle2301')).toEqual({ family: 'jstyle2301', maker: 'J-Style', model: '2301', label: 'J-Style 2301' });
    expect(familyIdentity('colmi-r02', { family: 'Colmi R02 (QRing)', label: 'Colmi R02 / R06 / R10 ring' }).label).toBe('Colmi R02 ring');
    expect(familyIdentity('other', { family: 'Other Co', label: 'Other ring (beta)' })).toEqual({ family: 'other', maker: 'Other Co', model: 'other', label: 'Other ring' });
  });
});

describe('the legacy connector (old web drivers through a staged link)', () => {
  it('adopts a RecordedLink, syncs and keys the ring by its address when the link has one', async () => {
    const link = Object.assign(
      new RecordedLink([
        { expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 5, 2, 5)] },
        { expect: command(0x13), reply: [Uint8Array.of(0x13, 88)] },
      ], ADV_NAME),
      { deviceId: 'aa:bb:cc:dd:ee:02' },
    );
    const c = createLegacyConnector({ drivers: () => import('@/biometrics/ble/registry'), session: { clock: { now: () => Date.parse('2026-09-16T10:00:00Z'), tzOffsetS: () => 0 }, timers: { quietMs: 5, stallMs: 20 } } });
    const s = await c.adopt!(link, 'jstyle2301', new AbortController().signal);
    expect(s.identity).toEqual({ driverId: 'jstyle2301', family: 'jstyle2301', maker: 'J-Style', model: '2301', ringId: 'mac:aa:bb:cc:dd:ee:02' });
    expect((await s.info()).firmware).toBe('V0525');
    expect(c.driverInfo('jstyle2301')?.label).toBe('J-Style 2301');
    expect(JSON.stringify(s.identity)).not.toContain(ADV_NAME);
    await s.close();
  });
});

describe('wrapSession', () => {
  it('never promotes an advertised id to a ring identity', () => {
    const transport = { peripheral: { id: 'web-id' } } as Transport;
    const s = wrapSession({ family: jstyle2301, identity: { family: 'jstyle2301', model: '2301', ringId: 'adv:web-id', basis: 'advertised' }, info: () => ({ firmware: 'V0525', clockOffsetS: 0 }), on: () => () => undefined } as never, transport);
    expect(s.identity.ringId).toBeUndefined();
    expect(s.platformId).toBe('web-id');
  });
});

describe('Bluetooth off or permission refused', () => {
  it('a refused permission maps to the allow copy, not to "Turn Bluetooth on"', () => {
    const e = errorOf(toLinkError(new NoDeviceError('permission')));
    expect(e.code).toBe('permission_needed');
    expect(e.message).toBe('Vitals needs the Nearby devices permission to find your ring. Allow it in Android settings for Vitals.');
  });

  it('an adapter that is off still maps to "Turn Bluetooth on"', () => {
    const e = errorOf(toLinkError(new NoDeviceError('unavailable')));
    expect(e.code).toBe('bluetooth_off');
    expect(e.message).toBe('Turn Bluetooth on to reach your ring.');
  });

  it('availability asks what "not available" means each time', async () => {
    let denied = false;
    const factory = { ...platformFactory({ address: 'aa:bb:cc:dd:ee:02' }), available: async () => false };
    const c = createRingsConnector({ factory, unavailable: () => (denied ? 'permission_needed' : 'bluetooth_off') });
    expect(await c.available()).toBe('bluetooth_off');
    denied = true;
    expect(await c.available()).toBe('permission_needed');
  });
});

describe('connect failures in the service’s terms (not every failure is "another app")', () => {
  const status = (message: string, gattStatus: number): Error => Object.assign(new Error(message), { gattStatus });
  const named = (name: string, message: string): Error => Object.assign(new Error(message), { name });

  it.each<[string, unknown]>([
    ['a scan that saw no ring', new NoDeviceError('not_found')],
    ['the plugin’s connect timeout', new Error('Connection timeout.')],
    ['a device the platform does not know', new Error('device not found')],
    ['Chromium could not make the connect', named('NetworkError', 'Connection attempt failed.')],
    ['BlueZ refused the connect', new Error('Connection refused')],
    ...[133, 8, 19, 22, 62].map((s): [string, unknown] => [`GATT ${s}`, new Error(`Connection failed with status ${s} (GATT_ERROR).`)]),
  ])('%s stays not_found', (_label, e) => {
    const le = toLinkError(e);
    expect(le.code).toBe('not_found');
    expect(errorOf(le).message).toBe(ANOTHER_APP);
  });

  it.each<[string, unknown]>([
    ['a failed subscribe', new RingError('could not subscribe to the ring', 'transport', new Error('Setting notification failed.'))],
    ['a missing characteristic', new Error('Characteristic not found.')],
    ['a missing service', named('NotFoundError', 'No Services matching UUID 0000fff0-0000-1000-8000-00805f9b34fb found in Device.')],
    ['a discovery the plugin could not finish', new Error('Service discovery failed.')],
    ['no firmware answer', new RingError('the ring did not answer the firmware request', 'timeout')],
    ['a handshake that failed', new RingError('handshake failed', 'transport', new Error('boom'))],
    ['a write that failed', new RingError('write failed', 'transport', new Error('Writing characteristic failed.'))],
    ['something nobody named', new Error('something odd')],
  ])('%s is failed: "Could not connect to the ring"', (_label, e) => {
    const le = toLinkError(e);
    expect(le.code).toBe('failed');
    expect(errorOf(le).message).toBe('Could not connect to the ring. Try again.');
  });

  it.each<[string, unknown]>([
    ['the ring refused the handshake', new RingError('V0789 ring refused the handshake', 'auth_rejected')],
    ['an invalid handshake value', new RingError('handshake value is invalid', 'credential_invalid')],
  ])('%s is refused', (_label, e) => {
    expect(toLinkError(e).code).toBe('refused');
  });

  it.each<[string, unknown]>([
    ['the ring code asks for pairing', new RingError('pair first', 'bond_required')],
    ['a dismissed pairing prompt during subscribe', new RingError('could not subscribe to the ring', 'transport', new Error('Pairing request was cancelled by the user.'))],
    ['a notification that needs encryption', new RingError('could not subscribe to the ring', 'transport', new Error('Setting notification failed with status code 5.'))],
    ['a bond the OS could not create', new Error('Creating bond failed.')],
    ['GATT insufficient authentication', status('Connection failed with status 5 (unnamed).', 5)],
  ])('%s is bond_required', (_label, e) => {
    expect(toLinkError(e).code).toBe('bond_required');
  });

  it('keeps the GATT status in every branch, from the error or from its cause', () => {
    const cause133 = status('Connection failed with status 133 (GATT_ERROR).', 133);
    expect(toLinkError(cause133)).toMatchObject({ code: 'not_found', gattStatus: 133 });
    expect(toLinkError(status('Connection timeout.', 133))).toMatchObject({ code: 'not_found', gattStatus: 133 });
    expect(toLinkError(new RingError('handshake failed', 'transport', status('x', 257)))).toMatchObject({ code: 'failed', gattStatus: 257 });
    expect(toLinkError(new RingError('refused', 'auth_rejected', cause133))).toMatchObject({ code: 'refused', gattStatus: 133 });
    expect(toLinkError(status('Connection failed with status 5 (unnamed).', 5))).toMatchObject({ code: 'bond_required', gattStatus: 5 });
    expect(toLinkError(new RingError('dropped', 'disconnected', status('y', 8)))).toMatchObject({ code: 'disconnected', gattStatus: 8 });
    expect(toLinkError(new RingError('handshake failed', 'transport', cause133))).toMatchObject({ code: 'not_found', gattStatus: 133 });
  });

  it('a reconnect whose session got no firmware answer is failed, one the platform could not reach is not_found', async () => {
    const transport = { peripheral: { address: 'AA:BB:CC:DD:EE:01' }, disconnect: async () => {} } as unknown as Transport;
    const noAnswer = createRingsConnector({
      factory: { platform: 'fake', available: async () => true, scan: async () => {}, connect: async () => transport },
      families: [jstyle2301],
      open: async () => {
        throw new RingError('the ring did not answer the firmware request', 'timeout');
      },
    });
    await expect(noAnswer.reconnect!('AA:BB:CC:DD:EE:01', 'jstyle2301', new AbortController().signal)).rejects.toMatchObject({ code: 'failed' });
    const unreached = createRingsConnector({
      factory: { platform: 'fake', available: async () => true, scan: async () => {}, connect: async () => Promise.reject(Object.assign(new Error('Connection timeout.'), { gattStatus: 133 })) },
      families: [jstyle2301],
    });
    await expect(unreached.reconnect!('AA:BB:CC:DD:EE:01', 'jstyle2301', new AbortController().signal)).rejects.toMatchObject({ code: 'not_found', gattStatus: 133 });
  });

  it('the status sets match the transport’s: every status the transport retries on quickly is "not reached"', () => {
    for (const s of TRANSIENT_GATT) expect(UNREACHED_GATT.has(s)).toBe(true);
  });
});
