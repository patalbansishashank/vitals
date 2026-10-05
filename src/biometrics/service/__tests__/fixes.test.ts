/**
 * Regressions found by review of the first ring service: one source per ring through the real ingest, a ring whose id
 * basis changes between reads, the heartbeat re-claiming a lost lease, Disconnect during a connect, timer leaks, a
 * failed first sync, a leaked session on a refused pair, duplicate entries, and takeover handling.
 */
import { describe, expect, it } from 'vitest';
import { sourceKeyOf } from '@/biometrics/core/source';
import { ingestBatches } from '@/biometrics/ingest/pipeline';
import { InMemoryBioStore } from '@/biometrics/store/memory';
import type { RingEvent } from '../../../../packages/rings/src/types';
import { buildRingBatch } from '../ingest';
import { claimPatch, takeoverFor } from '../lease';
import { createRingService } from '../ringService';
import { LEASE_HEARTBEAT_MS, SYNC_EVERY_MS } from '../types';
import { devicePorts, FakeClock, FakeRing, MemoryLocal, RING_KEY, settle, SharedStore } from './fakes';

const KEY = 'ble:jstyle2301/2301/serial:ABC123';

describe('1. one source per ring', () => {
  it('sourceKeyOf returns a ring key unchanged and the ingest pipeline files the records under it', async () => {
    const prov = { channel: KEY as `ble:${string}`, device: { type: 'ring' as const, manufacturer: 'J-Style', model: '2301', tier: 'C' as const }, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-04T08:00:00Z' };
    expect(sourceKeyOf(prov)).toBe(KEY);
    expect(sourceKeyOf({ ...prov, channel: 'ble:jstyle2301' })).toBe('ble:jstyle2301|j-style:2301');
    const events: RingEvent[] = [{ type: 'sample', stream: 'hr', t: Date.parse('2026-10-03T23:10:00Z'), value: 58, unit: 'bpm', origin: 'history' }];
    const batch = buildRingBatch(events, { ringKey: KEY, driverId: 'jstyle2301', firmware: 'V0525', clockOffsetS: 0, tz: 'UTC', tzOffsetS: 0, nowMs: Date.parse('2026-10-04T08:00:00Z'), producer: { name: 'vitals-ring', version: '1' } });
    const store = new InMemoryBioStore();
    const rep = await ingestBatches([batch], store, { now: '2026-10-04T08:00:00Z' });
    expect(rep.sources).toEqual([KEY]);
    const sources = await store.sources();
    expect(sources.map((s) => s.sourceKey)).toEqual([KEY]);
    expect(rep.records + rep.samples).toBeGreaterThan(0);
    for (const r of await store.records()) expect(r.sourceKey).toBe(KEY);
  });
});

describe('2. the same ring, a different id basis', () => {
  it('a read that sees the serial after one that saw only the address lands on the existing source, and stores both ids', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing({ ringId: 'serial:ABC123', platformIds: ['aa:bb:cc:dd:ee:01'] });
    store.addRingSource(RING_KEY, 'jstyle2301', { ble: { driver: 'jstyle2301', address: 'aa:bb:cc:dd:ee:01' } });
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    await settle();
    // the staged-link path (a browser: no address) resolves by the stored ring id / address, never opening a second source
    const rep = await svc.syncLink({} as never, 'jstyle2301');
    expect(rep.sourceKey).toBe(RING_KEY);
    expect([...store.sources.keys()]).toEqual([RING_KEY]);
    expect(store.sources.get(RING_KEY)!.ble).toMatchObject({ ringId: 'serial:ABC123', address: 'aa:bb:cc:dd:ee:01' });
    expect(svc.rings()).toHaveLength(1);
  });

  it('outside pair an unknown ring is refused rather than silently given a second source', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing({ ringId: 'serial:OTHER', platformIds: ['aa:bb:cc:dd:ee:09'] });
    store.addRingSource(RING_KEY, 'jstyle2301', { ble: { driver: 'jstyle2301', ringId: 'mac:aa:bb:cc:dd:ee:01' } });
    store.addRingSource('ble:jstyle2301/2301/serial:SECOND', 'jstyle2301', { ble: { driver: 'jstyle2301', ringId: 'serial:SECOND' } });
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    await expect(svc.syncLink({} as never, 'jstyle2301')).rejects.toThrow(/Which ring/);
    expect(store.sources.size).toBe(2);
    expect(ring.held).toBeNull();
  });
});

describe('11. a second ring of one family (SVC-05)', () => {
  it('pairing a ring with another serial opens its own source; the first ring keeps its records', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const first = 'ble:jstyle2301/2301/serial:FIRST1';
    store.addRingSource(first, 'jstyle2301', { ble: { driver: 'jstyle2301', ringId: 'serial:FIRST1' } });
    const ring = new FakeRing({ ringId: 'serial:SECOND2', platformIds: ['aa:bb:cc:dd:ee:02'] });
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    const st = await svc.pair(found[0]!.candidateId);
    expect(st.ringKey).toBe('ble:jstyle2301/2301/serial:SECOND2');
    expect([...store.sources.keys()].sort()).toEqual([first, 'ble:jstyle2301/2301/serial:SECOND2'].sort());
    expect(svc.rings()).toHaveLength(2);
  });

  it('the same serial, or a read without a serial, still lands on the single ring of that family', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const first = 'ble:jstyle2301/2301/serial:FIRST1';
    store.addRingSource(first, 'jstyle2301', { ble: { driver: 'jstyle2301', ringId: 'serial:FIRST1' } });
    const ring = new FakeRing({ ringId: 'mac:aa:bb:cc:dd:ee:01', platformIds: ['aa:bb:cc:dd:ee:01'] });
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    await settle();
    const rep = await svc.syncLink({} as never, 'jstyle2301');
    expect(rep.sourceKey).toBe(first);
    expect([...store.sources.keys()]).toEqual([first]);
  });
});

describe('12. a stored label from the advertised name (J2-04)', () => {
  it('start stores the table label once; a driver the table does not know keeps its label', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    store.addRingSource(RING_KEY, 'jstyle2301', { label: 'ADV-NAME 2301' });
    store.addRingSource('ble:other/other/serial:X1', 'other', { label: 'Other ring' });
    const svc = createRingService(devicePorts({ store, clock, rings: [new FakeRing()], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    await settle();
    expect(store.sources.get(RING_KEY)!.label).toBe('J-Style 2301');
    expect(store.sources.get('ble:other/other/serial:X1')!.label).toBe('Other ring');
  });
});

describe('3. the heartbeat re-claims', () => {
  it('writes the claim again when the lease lost its holder, and lets go when another device holds a fresh lease', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing();
    store.addRingSource(RING_KEY, 'jstyle2301');
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone' }));
    await svc.start();
    await settle();
    store.leases.delete(RING_KEY); // a merge or clean-up dropped it
    await clock.advance(LEASE_HEARTBEAT_MS + 1);
    expect(store.leases.get(RING_KEY)?.holder?.deviceId).toBe('DEVICEA000000001');
    const now = new Date(clock.now()).toISOString();
    store.leases.set(RING_KEY, { kind: 'ringLease', ringKey: RING_KEY, holder: { deviceId: 'DEVICEB000000002', deviceLabel: 'Desktop', platform: 'electron', since: now }, heartbeatAt: now, takeover: null });
    await clock.advance(LEASE_HEARTBEAT_MS + 1);
    expect(ring.held).toBeNull();
    expect(svc.rings()[0]).toMatchObject({ state: 'elsewhere', heldBy: { deviceLabel: 'Desktop' } });
  });
});

describe('4. Disconnect during a connect', () => {
  it('aborts the connect in flight and closes the link that comes up afterwards', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing();
    store.addRingSource(RING_KEY, 'jstyle2301');
    const ports = devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone' });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = ports.connector.reconnect!;
    let seenAbort = false;
    ports.connector = { ...ports.connector, reconnect: async (pid, drv, signal) => { await gate; seenAbort = signal.aborted; return slow(pid, drv, signal); } };
    const svc = createRingService(ports);
    const started = svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('connecting');
    await svc.disconnect(RING_KEY);
    release();
    await started;
    await settle();
    expect(seenAbort).toBe(true);
    expect(ring.held).toBeNull();
    expect(svc.rings()[0]).toMatchObject({ state: 'idle', paused: true });
  });
});

describe('5. and 6. the periodic sync timer', () => {
  it('a sync cut short by a drop does not re-arm a second timer on the next session', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing();
    store.addRingSource(RING_KEY, 'jstyle2301');
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone' }));
    await svc.start();
    await settle();
    let open!: () => void;
    ring.gate = new Promise<void>((r) => (open = r));
    await clock.advance(SYNC_EVERY_MS + 1); // the periodic read starts and waits
    const first = ring.held!;
    expect(first.syncCalls).toHaveLength(2);
    first.drop();
    ring.gate = null;
    open();
    await clock.advance(5_000); // reconnect
    const second = ring.held!;
    expect(second).not.toBe(first);
    expect(second.syncCalls).toHaveLength(1);
    await clock.advance(SYNC_EVERY_MS + 1);
    expect(second.syncCalls).toHaveLength(2); // one periodic read, not two
  });

  it('a failed first sync lets the link go and reconnects; the new link gets the 30-minute timer (J2-07)', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing();
    ring.failSyncOnce = true;
    store.addRingSource(RING_KEY, 'jstyle2301');
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone' }));
    await svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('error');
    expect(ring.held).toBeNull();
    await clock.advance(5_000);
    expect(svc.rings()[0]!.state).toBe('connected');
    expect(ring.held?.syncCalls).toHaveLength(1);
    await clock.advance(SYNC_EVERY_MS + 1);
    expect(ring.held?.syncCalls).toHaveLength(2);
    expect(svc.rings()[0]!.state).toBe('connected');
  });
});

describe('7. pair closes a session it cannot place', () => {
  it('two known rings and a ring without an id: the link is closed', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing({ ringId: undefined as unknown as string, platformIds: ['web-opaque'] });
    Object.assign(ring, { ringId: undefined });
    store.addRingSource(RING_KEY, 'jstyle2301');
    store.addRingSource('ble:jstyle2301/2301/serial:SECOND', 'jstyle2301');
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    expect(found[0]!.matches).toHaveLength(2);
    await expect(svc.pair(found[0]!.candidateId)).rejects.toThrow(/Which ring/);
    expect(ring.held).toBeNull();
    expect(ring.connectAttempts).toHaveLength(1);
  });
});

describe('8. one entry per ring', () => {
  it('two store changes that both see a new ring make one entry and one connect', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing();
    class SlowLocal extends MemoryLocal {
      override async get(k: string) {
        await settle(2);
        return super.get(k);
      }
    }
    const local = new SlowLocal({ [RING_KEY]: { cursor: {}, platformId: 'aa:bb:cc:dd:ee:01' } });
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', local }));
    await svc.start();
    const port = store.port();
    await port.ensureSource(RING_KEY, { driverId: 'jstyle2301', label: 'J-Style 2301', streams: [], channel: RING_KEY, maker: 'J-Style', model: '2301' });
    await port.patchSource(RING_KEY, { deviceType: 'ring' });
    await settle(30);
    expect(svc.rings()).toHaveLength(1);
    expect(ring.connectAttempts).toHaveLength(1);
    expect(svc.rings()[0]!.state).toBe('connected');
  });
});

describe('9. and 10. lease fields', () => {
  it('a claim never touches the taker’s field; a takeover older than two minutes is ignored', () => {
    const claim = claimPatch({ deviceId: 'A', deviceLabel: 'Phone', platform: 'android' }, '2026-10-04T08:00:00.000Z', RING_KEY);
    expect('takeover' in claim).toBe(false);
    const lease = { kind: 'ringLease' as const, ringKey: RING_KEY, holder: { deviceId: 'A', deviceLabel: 'Phone', platform: 'android' as const, since: '2026-10-04T08:00:00.000Z' }, heartbeatAt: '2026-10-04T08:00:00.000Z', takeover: { deviceId: 'B', deviceLabel: 'Desktop', at: '2026-10-04T08:01:00.000Z' } };
    expect(takeoverFor(lease, 'A', Date.parse('2026-10-04T08:02:00Z'))).toMatchObject({ deviceId: 'B' });
    expect(takeoverFor(lease, 'A', Date.parse('2026-10-04T08:03:01Z'))).toBeNull();
    // answered already: the holder's `since` is newer than the takeover
    expect(takeoverFor({ ...lease, holder: { ...lease.holder, since: '2026-10-04T08:01:30.000Z' } }, 'A', Date.parse('2026-10-04T08:02:00Z'))).toBeNull();
  });
});

describe('13. more rings of one family (verifier of SVC-05)', () => {
  it('a third ring with its own serial pairs as a new ring', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    store.addRingSource('ble:jstyle2301/2301/serial:FIRST1', 'jstyle2301', { ble: { driver: 'jstyle2301', ringId: 'serial:FIRST1' } });
    store.addRingSource('ble:jstyle2301/2301/serial:SECOND2', 'jstyle2301', { ble: { driver: 'jstyle2301', ringId: 'serial:SECOND2' } });
    const ring = new FakeRing({ ringId: 'serial:THIRD3', platformIds: ['aa:bb:cc:dd:ee:03'] });
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    expect((await svc.pair(found[0]!.candidateId)).ringKey).toBe('ble:jstyle2301/2301/serial:THIRD3');
    expect(store.sources.size).toBe(3);
  });

  it('a ring at another address is not the stored ring known only by its address', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    store.addRingSource(RING_KEY, 'jstyle2301', { ble: { driver: 'jstyle2301', ringId: 'mac:aa:bb:cc:dd:ee:01', address: 'aa:bb:cc:dd:ee:01' } });
    const ring = new FakeRing({ ringId: 'serial:NEW999', platformIds: ['aa:bb:cc:dd:ee:07'] });
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', canReconnect: false }));
    await svc.start();
    await settle();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    expect((await svc.pair(found[0]!.candidateId)).ringKey).toBe('ble:jstyle2301/2301/serial:NEW999');
    expect(store.sources.size).toBe(2);
  });
});
