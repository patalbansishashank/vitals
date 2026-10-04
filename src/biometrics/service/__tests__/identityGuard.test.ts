/**
 * Release guard: the ring's advertised name is never an identity. A ring that advertises 'ADV-NAME 77' gives no key,
 * label, source doc, record provenance or status that carries it, through the real connector (A5a on the fake
 * peripheral) and through the ring service.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RingScanHit } from '../ports';
import { describe, expect, it } from 'vitest';
import { newSourceDoc, sourceKeyOf, sourceLabel } from '@/biometrics/core/source';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import { fakeFromSession, type FixtureSession, type SessionsFixture } from '../../../../packages/rings/src/testing';
import { uuid16, type RingEvent, type Transport, type TransportFactory } from '../../../../packages/rings/src/types';
import { createRingsConnector } from '../connectors/rings';
import { ringKeyFromId, ringLabelOf } from '../identity';
import { buildRingBatch } from '../ingest';
import { RingLinkError } from '../ports';
import { createRingService } from '../ringService';
import { FakeClock, MemoryLocal, SharedStore, settle, syncPort } from './fakes';

const ADV = 'ADV-NAME';
const ADV_NAME = 'ADV-NAME 77';
const REPO = join(__dirname, '../../../..');
const sessions = JSON.parse(readFileSync(join(REPO, 'qa/fixtures/rings/jstyle2301/sessions.json'), 'utf8')) as SessionsFixture;
const handshake = (): FixtureSession => sessions.sessions.find((x) => x.name.startsWith('v0525 handshake'))!;
const fast = { timers: { quietMs: 30, stallMs: 80 }, clock: { now: () => Date.parse('2026-09-16T10:00:00Z'), tzOffsetS: () => 0 } };

/** A platform that sees the ring's advertised name and, maybe, an id or an address (never a serial). */
function platform(peripheral: { id?: string; address?: string }): TransportFactory {
  return {
    platform: 'fake',
    available: async () => true,
    async scan(_families, onFound) {
      onFound({ name: ADV_NAME, serviceUuids: [uuid16(0xfff0)], manufacturerData: [], platformId: peripheral.id ?? peripheral.address, rssi: -55 });
    },
    async connect(): Promise<Transport> {
      const fake = fakeFromSession(handshake(), { name: ADV_NAME, id: peripheral.id, address: peripheral.address });
      // the fake gives every peripheral an id; this platform has none unless it says so
      if (peripheral.id === undefined) (fake.peripheral as { id?: string }).id = undefined;
      fake.script({ expect: { prefix: '54 00' }, reply: ['54 ff'] });
      return fake;
    },
  };
}

async function connectThrough(factory: TransportFactory) {
  const c = createRingsConnector({ factory, families: [jstyle2301], session: fast });
  const hits: RingScanHit[] = [];
  for await (const h of c.scan(new AbortController().signal)) hits.push(h);
  expect(hits).toHaveLength(1);
  expect(JSON.stringify(hits)).not.toContain(ADV);
  return { c, hit: hits[0]!, open: () => c.connect(hits[0]!, new AbortController().signal) };
}

describe('the connector never keys a ring by its advertised name', () => {
  it('a name alone (no id, no address, no serial) is no identity: the connect fails without naming it', async () => {
    const { open } = await connectThrough(platform({}));
    const err = await open().then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(RingLinkError);
    expect(String((err as Error).message)).not.toContain(ADV);
  });

  it('a browser id and a name: no ring id, the platform id is the browser id', async () => {
    const { open } = await connectThrough(platform({ id: 'per-origin-7' }));
    const s = await open();
    expect(s.identity.ringId).toBeUndefined();
    expect(s.platformId).toBe('per-origin-7');
    expect(JSON.stringify(s.identity)).not.toContain(ADV);
    await s.close();
  });

  it('an address and a name: key, label, records, provenance and source doc come from the driver and the address', async () => {
    const { c, open } = await connectThrough(platform({ address: 'AA:BB:CC:DD:EE:07' }));
    const s = await open();
    expect(s.identity).toEqual({ driverId: 'jstyle2301', family: 'jstyle2301', maker: 'J-Style', model: '2301', ringId: 'mac:aa:bb:cc:dd:ee:07' });
    const ringKey = ringKeyFromId(s.identity.driverId, s.identity.ringId!, s.identity.model);
    expect(ringKey).toBe('ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:07');
    expect(ringLabelOf('jstyle2301', c.driverInfo('jstyle2301'))).toBe('J-Style 2301');

    const events: RingEvent[] = [];
    for await (const e of s.sync({}, () => undefined, new AbortController().signal)) events.push(e);
    const info = await s.info();
    await s.close();
    const batch = buildRingBatch(events, { ringKey, driverId: 'jstyle2301', firmware: info.firmware, clockOffsetS: 0, tz: 'UTC', tzOffsetS: 0, nowMs: Date.parse('2026-10-04T08:00:00Z'), producer: { name: 'vitals-ring', version: '1' } });
    expect(batch.records.length).toBeGreaterThan(0);
    const prov = batch.records[0]!.provenance;
    expect(prov.device).toMatchObject({ manufacturer: 'J-Style', model: '2301' });
    expect(sourceKeyOf(prov)).toBe(ringKey);
    expect(sourceLabel(prov)).toBe('J-Style 2301');
    const doc = newSourceDoc(prov, 0, []);
    expect(doc).toMatchObject({ sourceKey: ringKey, label: 'J-Style 2301' });
    expect(JSON.stringify({ batch, doc, platformId: s.platformId })).not.toContain(ADV);
  });
});

describe('the ring service never stores or shows the advertised name', () => {
  it('pairing a ring that advertises a name: no candidate, status, source, record or local state carries it', async () => {
    const store = new SharedStore();
    const local = new MemoryLocal();
    const svc = createRingService({
      connector: createRingsConnector({ factory: platform({ address: 'AA:BB:CC:DD:EE:07' }), families: [jstyle2301], session: fast }),
      store: store.port(),
      local,
      sync: syncPort('device-a', 'Phone A'),
      clock: new FakeClock(),
      platform: 'android',
      producer: { name: 'vitals-ring', version: '1' },
    });
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    expect(found).toHaveLength(1);
    const status = await svc.pair(found[0]!.candidateId);
    await settle();
    expect(status).toMatchObject({ ringKey: 'ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:07', label: 'J-Style 2301' });
    expect([...store.sources.keys()]).toEqual(['ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:07']);
    expect(store.batches.flatMap((b) => b.records).length).toBeGreaterThan(0);
    for (const b of store.batches) for (const r of b.records) expect(r.provenance.device).toMatchObject({ manufacturer: 'J-Style', model: '2301' });
    const seen = { found, status, rings: svc.rings(), sources: [...store.sources.values()], patches: store.sourcePatches, batches: store.batches, local: [...local.docs] };
    expect(JSON.stringify(seen)).not.toContain(ADV);
    await svc.stop();
    await settle();
  });
});
