/**
 * The ring service state machine over fakes (SUITE_SPEC §15.2): auto-connect, backoff, history since the last read,
 * the lease between two devices, disconnect/pause, live heart rate, spot checks, battery.
 */
import { describe, expect, it } from 'vitest';
import { LEASE_HEARTBEAT_MS, LEASE_STALE_MS, SYNC_EVERY_MS } from '../types';
import { ANOTHER_APP, LIVE_FIRST_MS, createRingService } from '../ringService';
import { devicePorts, FakeClock, FakeRing, MemoryLocal, RING_KEY, settle, SharedStore } from './fakes';

const ADV_NAME = 'Fake Ring 7307';

function setup(o: { syncOn?: boolean; canReconnect?: boolean; known?: boolean; label?: string; deviceId?: string; shell?: Parameters<typeof devicePorts>[0]['shell'] } = {}) {
  const clock = new FakeClock();
  const store = new SharedStore();
  const ring = new FakeRing({ platformIds: ['aa:bb:cc:dd:ee:01', 'web-opaque-id-0001', 'AA:BB:CC:DD:EE:01'] });
  if (o.known !== false) store.addRingSource(RING_KEY, 'jstyle2301');
  const ports = devicePorts({ store, clock, rings: [ring], deviceId: o.deviceId ?? 'DEVICEA000000001', label: o.label ?? 'Phone', syncOn: o.syncOn, canReconnect: o.canReconnect, shell: o.shell });
  const svc = createRingService(ports);
  return { clock, store, ring, ports, svc };
}

describe('auto-connect and history', () => {
  it('availability is not known until start() has asked the platform once (the Ring page waits for it)', async () => {
    const { svc } = setup({ known: false });
    expect(svc.availabilityKnown?.()).toBe(false);
    await svc.start();
    expect(svc.availabilityKnown?.()).toBe(true);
    expect(svc.availability()).toBe('ready');
  });

  it('availability is known even when the store fails to open (the Ring page never waits for ever)', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ports = devicePorts({ store, clock, rings: [new FakeRing()], deviceId: 'DEVICEA000000001', label: 'Phone' });
    ports.store = { ...ports.store, ready: async () => Promise.reject(new Error('backend did not open')) };
    const svc = createRingService(ports);
    await expect(svc.start()).rejects.toThrow('backend did not open');
    expect(svc.availabilityKnown?.()).toBe(true);
  });

  it('coming back to the app asks the platform again, so a permission granted in Android settings clears the prompt', async () => {
    let resume: (() => void) | undefined;
    const clock = new FakeClock();
    const store = new SharedStore();
    const ports = devicePorts({ store, clock, rings: [new FakeRing()], deviceId: 'DEVICEA000000001', label: 'Phone', shell: { onResume: (fn) => ((resume = fn), () => undefined) } });
    let answer: 'ready' | 'permission_needed' = 'permission_needed';
    ports.connector = { ...ports.connector, available: async () => answer };
    const svc = createRingService(ports);
    await svc.start();
    expect(svc.availability()).toBe('permission_needed');
    answer = 'ready';
    resume!();
    await settle();
    expect(svc.availability()).toBe('ready');
  });

  it('connects a known ring at start, reads everything the first time and writes the ring facts (never the cursor) to the source', async () => {
    const { svc, ring, store, ports } = setup();
    await svc.start();
    await settle();
    const st = svc.rings()[0]!;
    expect(st.state).toBe('connected');
    expect(st.battery).toBe(77);
    expect(st.firmware).toBe('V0525');
    expect(st.label).toBe('J-Style 2301');
    expect(st.caps).toEqual({ checks: ['hr', 'spo2'] });
    expect(ring.held?.syncCalls).toEqual([{}]);
    expect(store.batches).toHaveLength(1);
    const src = store.sources.get(RING_KEY)!;
    expect(src.ble).toMatchObject({ driver: 'jstyle2301', ringId: 'mac:aa:bb:cc:dd:ee:01', firmware: 'V0525', battery: 77, lastSyncBy: 'Phone', clockOffsetS: 0 });
    expect(src.ble).not.toHaveProperty('cursor');
    expect((await ports.local.get(RING_KEY))?.cursor).toEqual({ hr: 'j1|55.1' });
    // this device read last: `lastSyncBy` is left out of the status
    expect(st.lastSyncBy).toBeUndefined();
    expect(st.lastSyncAt).toBeDefined();
  });

  it('a second sync passes the device-local cursor; records carry the ring provenance and never the advertised name', async () => {
    const { svc, ring, store } = setup();
    await svc.start();
    await settle();
    await svc.syncNow(RING_KEY);
    expect(ring.held?.syncCalls).toEqual([{}, { hr: 'j1|55.1' }]);
    const rec = store.batches[1]!.records[0]!;
    expect(rec.provenance).toMatchObject({ channel: RING_KEY, recording_method: 'automatic', modality: 'sensed', source_app: 'Vitals', decoder: 'jstyle2301/V0525@1', device: { type: 'ring', manufacturer: 'J-Style', model: '2301', firmware: 'V0525', tier: 'C' } });
    const everything = JSON.stringify({ batches: store.batches, sources: [...store.sources.entries()], status: svc.rings() });
    expect(everything).not.toContain(ADV_NAME);
    expect(everything).not.toContain('web-opaque');
  });

  it('syncs again every 30 minutes while connected', async () => {
    const { svc, ring, clock } = setup();
    await svc.start();
    await settle();
    await clock.advance(30 * 60_000 + 10);
    expect(ring.held?.syncCalls).toHaveLength(2);
    await clock.advance(30 * 60_000 + 10);
    expect(ring.held?.syncCalls).toHaveLength(3);
  });

  it('retries with Lumen\'s backoff (5, 15, 30, 60, 120, 300 s, then 300 s) while the ring cannot be found, and says why', async () => {
    const { svc, ring, clock } = setup();
    ring.refuse = 'not_found';
    await svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('error');
    expect(svc.rings()[0]!.error?.message).toBe(ANOTHER_APP);
    for (const ms of [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000]) await clock.advance(ms);
    const t0 = ring.connectAttempts[0]!.at;
    expect(ring.connectAttempts.map((a) => a.at - t0)).toEqual([0, 5_000, 20_000, 50_000, 110_000, 230_000, 530_000, 830_000]);
    ring.refuse = null;
    await clock.advance(300_000);
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('on the web (no reconnect) a known ring stays idle until the person connects it', async () => {
    const { svc, ring } = setup({ canReconnect: false });
    await svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('idle');
    expect(ring.connectAttempts).toHaveLength(0);
  });

  it('reconnects after the ring drops the link', async () => {
    const { svc, ring, clock } = setup();
    await svc.start();
    await settle();
    ring.held!.drop();
    await settle();
    expect(svc.rings()[0]!.state).toBe('error');
    await clock.advance(5_000);
    expect(svc.rings()[0]!.state).toBe('connected');
  });
});

describe('disconnect, forget, pair', () => {
  it('disconnect pauses auto-connect on this device until Connect is pressed here', async () => {
    const { svc, ring, ports, clock } = setup();
    await svc.start();
    await settle();
    await svc.disconnect(RING_KEY);
    expect(svc.rings()[0]).toMatchObject({ state: 'idle', paused: true });
    expect(ring.held).toBeNull();
    expect((await ports.local.get(RING_KEY))?.paused).toBe(true);
    await clock.advance(10 * 60_000);
    expect(ring.connectAttempts).toHaveLength(1);
    await svc.connectHere(RING_KEY);
    expect(svc.rings()[0]).toMatchObject({ state: 'connected', paused: false });
  });

  it('forget closes the link and removes the ring marking; the source and its data stay', async () => {
    const { svc, ring, store, ports } = setup();
    await svc.start();
    await settle();
    await svc.forget(RING_KEY);
    expect(ring.held).toBeNull();
    expect(svc.rings()).toEqual([]);
    const src = store.sources.get(RING_KEY)!;
    expect(src).toBeDefined();
    expect(src.ble).toBeUndefined();
    expect(src.deviceType).toBeUndefined();
    expect(await ports.local.get(RING_KEY)).toBeUndefined();
  });

  it('pair reads the full history of a new ring and creates its source', async () => {
    const { svc, ring, store } = setup({ known: false });
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    expect(found).toEqual([{ candidateId: 'aa:bb:cc:dd:ee:01', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -60, known: false, idTail: 'ee01' }]);
    const st = await svc.pair(found[0]!.candidateId);
    expect(st.state).toBe('connected');
    expect(ring.held?.syncCalls).toEqual([{}]);
    expect(store.sources.get(RING_KEY)).toMatchObject({ deviceType: 'ring', label: 'J-Style 2301', ble: { driver: 'jstyle2301' } });
  });

  it('stores the driver discovered after an unidentified chooser hit', async () => {
    const { svc, ports, store } = setup({ known: false });
    ports.connector.scan = async function* () {
      yield { candidateId: 'aa:bb:cc:dd:ee:01', platformId: 'aa:bb:cc:dd:ee:01', driverId: 'unidentified', rssi: -60 };
    };
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    expect(found[0]).toMatchObject({ driverId: 'unidentified', label: 'Ring', known: false });
    const status = await svc.pair(found[0]!.candidateId);
    expect(status.label).toBe('J-Style 2301');
    expect(store.sources.get(RING_KEY)?.ble?.driver).toBe('jstyle2301');
  });

  it('offers saved rings for an unidentified chooser hit and checks the selected family', async () => {
    const { svc, ports, store } = setup({ canReconnect: false });
    const otherKey = 'ble:colmi/R02/serial:OTHER';
    store.addRingSource(otherKey, 'colmi');
    ports.connector.scan = async function* () {
      yield { candidateId: 'aa:bb:cc:dd:ee:01', platformId: 'aa:bb:cc:dd:ee:01', driverId: 'unidentified' };
    };
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    expect(found[0]).toMatchObject({ driverId: 'unidentified', known: false, label: 'Ring' });
    expect(found[0]?.matches?.map((m) => m.ringKey)).toEqual([RING_KEY, otherKey]);
    await expect(svc.pair(found[0]!.candidateId, otherKey)).rejects.toThrow(/different family/);
    expect((await svc.pair(found[0]!.candidateId, RING_KEY)).ringKey).toBe(RING_KEY);
  });

  it('refuses a connected family that differs from the existing source key', async () => {
    const { svc, ports, ring, store } = setup();
    ports.connector.reconnect = async (platformId) => {
      const session = ring.open(platformId, ports.clock);
      Object.assign(session.identity, { driverId: 'colmi', family: 'colmi' });
      return session;
    };
    await svc.start();
    await settle();
    expect(ring.held).toBeNull();
    expect(store.batches).toHaveLength(0);
    expect(store.sources.get(RING_KEY)?.ble?.driver).toBe('jstyle2301');
    expect(svc.rings()[0]?.state).toBe('error');
  });
});

describe('live heart rate, checks, battery', () => {
  it('reads live heart rate only while someone watches', async () => {
    const { svc, ring } = setup();
    await svc.start();
    await settle();
    const s = ring.held!;
    expect(s.liveActive).toBe(false);
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    expect(s.liveActive).toBe(true);
    s.pushLive(72, Date.parse('2026-10-04T08:01:00Z'));
    await settle();
    expect(svc.rings()[0]!.liveHr).toEqual({ bpm: 72, at: '2026-10-04T08:01:00.000Z' });
    stop();
    await settle();
    expect(s.liveActive).toBe(false);
    expect(svc.rings()[0]!.liveHr).toBeUndefined();
  });

  it('live heart rate waits for a history read to finish (one command at a time on a ring)', async () => {
    const { svc, ring } = setup();
    let open!: () => void;
    ring.gate = new Promise<void>((r) => (open = r));
    void svc.start();
    await settle();
    const s = ring.held!;
    expect(s.syncCalls).toHaveLength(1);
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    expect(s.liveActive).toBe(false);
    open();
    ring.gate = null;
    await settle();
    expect(s.liveActive).toBe(true);
    stop();
    await settle();
    expect(s.liveActive).toBe(false);
  });

  it('a watcher at a reconnect soon after a read: live heart rate comes back at once, the read waits until the watching ends', async () => {
    const { svc, ring, clock } = setup();
    await svc.start();
    await settle();
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    expect(ring.held!.liveActive).toBe(true);
    ring.held!.drop();
    await settle();
    await clock.advance(5_000);
    const s = ring.held!;
    // the reconnect ran the handshake (a new session) but no read: live heart rate first
    expect(s.syncCalls).toHaveLength(0);
    expect(s.liveActive).toBe(true);
    expect(svc.rings()[0]!.state).toBe('connected');
    stop();
    await settle();
    expect(s.liveActive).toBe(false);
    expect(s.syncCalls).toHaveLength(1);
    expect(s.overlaps).toEqual([]);
  });

  it('live heart rate keeps updating for 2 minutes through a drop: Lumen\'s 5 s reconnect, the handshake, then live again', async () => {
    const { svc, ring, clock } = setup();
    await svc.start();
    await settle();
    const seen: Array<{ at: number; bpm: number }> = [];
    const off = svc.subscribe((rs) => {
      const hr = rs[0]?.liveHr;
      if (hr && seen.at(-1)?.at !== clock.now()) seen.push({ at: clock.now(), bpm: hr.bpm });
    });
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    const t0 = clock.now();
    const opens = ring.connectAttempts.length;
    for (let s = 0; s < 120; s += 2) {
      if (s === 60) {
        ring.held!.drop();
        await settle();
      }
      ring.held?.pushLive(60 + (s % 7), clock.now());
      await clock.advance(2_000);
    }
    // one reconnect, 5 s after the drop
    expect(ring.connectAttempts.slice(opens).map((a) => a.at - t0)).toEqual([65_000]);
    const gaps = seen.slice(1).map((x, i) => x.at - seen[i]!.at);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(8_000);
    expect(seen.at(-1)!.at - t0).toBeGreaterThanOrEqual(116_000);
    expect(ring.held!.liveActive).toBe(true);
    stop();
    off();
  });

  it('a watcher at a reconnect long after the last read: the read comes first, live heart rate after it, never during it', async () => {
    const { svc, ring, clock } = setup();
    await svc.start();
    await settle();
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    await clock.advance(LIVE_FIRST_MS);
    ring.held!.drop();
    await settle();
    let open!: () => void;
    ring.gate = new Promise<void>((r) => (open = r));
    await clock.advance(5_000);
    const s = ring.held!;
    expect(s.syncCalls).toHaveLength(1);
    expect(s.liveActive).toBe(false);
    open();
    ring.gate = null;
    await settle();
    expect(s.liveActive).toBe(true);
    expect(s.overlaps).toEqual([]);
    expect(svc.rings()[0]!.state).toBe('connected');
    stop();
  });

  it('the 30-minute read and Sync now pause live heart rate and resume it after', async () => {
    const { svc, ring, clock } = setup();
    await svc.start();
    await settle();
    const s = ring.held!;
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    expect(s.liveActive).toBe(true);
    await clock.advance(SYNC_EVERY_MS + 1);
    await settle();
    expect(s.syncCalls).toHaveLength(2);
    expect(s.liveActive).toBe(true);
    await svc.syncNow(RING_KEY);
    await settle();
    expect(s.syncCalls).toHaveLength(3);
    expect(s.liveActive).toBe(true);
    expect(s.overlaps).toEqual([]);
    stop();
  });

  it('Check now waits for a running read and pauses live heart rate', async () => {
    const { svc, ring } = setup();
    await svc.start();
    await settle();
    const s = ring.held!;
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    let open!: () => void;
    ring.gate = new Promise<void>((r) => (open = r));
    const reading = svc.syncNow(RING_KEY);
    await settle();
    const check = svc.checkNow(RING_KEY, 'hr');
    await settle();
    expect(s.spotCalls).toEqual([]);
    open();
    ring.gate = null;
    await reading;
    expect(await check).toMatchObject({ value: 64, unit: 'bpm' });
    await settle();
    expect(s.spotCalls).toEqual(['hr']);
    expect(s.liveActive).toBe(true);
    expect(s.overlaps).toEqual([]);
    stop();
  });

  it('checkNow takes one spot reading; stopCheck ends it', async () => {
    const { svc, ring } = setup();
    await svc.start();
    await settle();
    expect(await svc.checkNow(RING_KEY, 'hr')).toEqual({ value: 64, unit: 'bpm', at: '2026-10-04T08:05:00.000Z' });
    expect(await svc.checkNow(RING_KEY, 'spo2')).toEqual({ value: 97, unit: 'pct', at: '2026-10-04T08:05:00.000Z' });
    expect(ring.held?.spotCalls).toEqual(['hr', 'spo2']);
    await svc.stopCheck?.(RING_KEY);
  });

  it('keeps the shell awake while a ring is connected', async () => {
    const calls: Array<[boolean, string]> = [];
    const { svc } = setup({ shell: { keepAlive: (on, why) => void calls.push([on, why]) } });
    await svc.start();
    await settle();
    expect(calls[0]).toEqual([true, 'Ring connected']);
    await svc.disconnect(RING_KEY);
    expect(calls.at(-1)).toEqual([false, 'Ring connected']);
  });
});

describe('the lease between two devices', () => {
  function pair(o: { syncOn?: boolean } = {}) {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing();
    store.addRingSource(RING_KEY, 'jstyle2301');
    const a = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', syncOn: o.syncOn }));
    const b = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEB000000002', label: 'Desktop', syncOn: o.syncOn, local: new MemoryLocal({ [RING_KEY]: { cursor: {}, platformId: 'aa:bb:cc:dd:ee:01' } }) }));
    return { clock, store, ring, a, b };
  }

  it('the holder heartbeats; the other device shows elsewhere with the holder label; connectHere moves the link within 70 s', async () => {
    const { clock, store, ring, a, b } = pair();
    await a.start();
    await settle();
    expect(store.leases.get(RING_KEY)).toMatchObject({ kind: 'ringLease', ringKey: RING_KEY, holder: { deviceId: 'DEVICEA000000001', deviceLabel: 'Phone', platform: 'android' }, heartbeatAt: expect.any(String) });
    const beat0 = store.leases.get(RING_KEY)!.heartbeatAt;
    await clock.advance(LEASE_HEARTBEAT_MS + 1);
    expect(store.leases.get(RING_KEY)!.heartbeatAt).not.toBe(beat0);

    await b.start();
    await settle();
    expect(b.rings()[0]).toMatchObject({ state: 'elsewhere', heldBy: { deviceId: 'DEVICEA000000001', deviceLabel: 'Phone' } });
    expect(ring.connectAttempts.filter((x) => x.at > 0)).toHaveLength(1);

    const t0 = clock.now();
    const moved = b.connectHere(RING_KEY);
    await settle();
    // the holder saw the takeover: link closed, lease released, its own auto-connect paused
    expect(ring.held).toBeNull();
    expect(a.rings()[0]).toMatchObject({ state: 'idle', paused: true });
    expect(store.leases.get(RING_KEY)!.takeover).toMatchObject({ deviceId: 'DEVICEB000000002', deviceLabel: 'Desktop' });
    await clock.advance(70_000);
    await moved;
    expect(clock.now() - t0).toBeLessThanOrEqual(70_000);
    expect(b.rings()[0]!.state).toBe('connected');
    expect(store.leases.get(RING_KEY)!.holder).toMatchObject({ deviceId: 'DEVICEB000000002' });
    expect(a.rings()[0]).toMatchObject({ state: 'elsewhere', paused: true, heldBy: { deviceLabel: 'Desktop' } });
    // the old holder stays away for 12 h even when the ring is free again
    const attempts = ring.connectAttempts.length;
    await b.disconnect(RING_KEY);
    await clock.advance(60 * 60_000);
    expect(a.rings()[0]).toMatchObject({ state: 'idle', paused: true });
    expect(ring.connectAttempts).toHaveLength(attempts);
    await clock.advance(12 * 60 * 60_000);
    expect(a.rings()[0]!.state).toBe('connected');
  });

  it('the old holder posts the shell’s notice shape; a failing shell never throws into the service', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing();
    store.addRingSource(RING_KEY, 'jstyle2301');
    const notices: unknown[] = [];
    const shell = {
      notify: (n: unknown) => {
        notices.push(n);
        return Promise.reject(new Error('no notification permission'));
      },
      keepAlive: () => {
        throw new Error('no foreground service');
      },
    };
    const a = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', shell }));
    const b = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEB000000002', label: 'Desktop', local: new MemoryLocal({ [RING_KEY]: { cursor: {}, platformId: 'aa:bb:cc:dd:ee:01' } }) }));
    await a.start();
    await settle();
    await b.start();
    await settle();
    const moved = b.connectHere(RING_KEY);
    await settle();
    expect(notices).toEqual([{ kind: 'ring_disconnected', title: 'Ring connected elsewhere', text: 'Your J-Style 2301 is now connected to Desktop.' }]);
    await clock.advance(70_000);
    await moved;
    expect(b.rings()[0]!.state).toBe('connected');
  });

  it('a holder that died with a fresh lease: Connect here instead tries the ring after 20 s and gets it (SVC-08)', async () => {
    const { clock, store, ring, b } = pair();
    const now = new Date(clock.now()).toISOString();
    store.leases.set(RING_KEY, { kind: 'ringLease', ringKey: RING_KEY, holder: { deviceId: 'DEVICEA000000001', deviceLabel: 'Phone', platform: 'android', since: now }, heartbeatAt: now, takeover: null });
    await b.start();
    await settle();
    expect(b.rings()[0]!.state).toBe('elsewhere');
    const moved = b.connectHere(RING_KEY);
    await clock.advance(25_000);
    await moved;
    expect(b.rings()[0]!.state).toBe('connected');
    expect(ring.held?.platformId).toBe('aa:bb:cc:dd:ee:01');
    expect(store.leases.get(RING_KEY)!.holder?.deviceId).toBe('DEVICEB000000002');
  });

  it('a store failure while claiming the lease closes the link and shows the error (SVC-09)', async () => {
    const { store, ring, b } = pair();
    let fail = true;
    const leases = store.leases;
    const set = leases.set.bind(leases);
    leases.set = (k, v) => {
      if (fail) {
        fail = false;
        throw new Error('disk full');
      }
      return set(k, v);
    };
    await b.start();
    await settle();
    expect(ring.held).toBeNull();
    expect(b.rings()[0]).toMatchObject({ state: 'error' });
  });

  it('a stale lease is taken at once', async () => {
    const { clock, store, ring, b } = pair();
    const old = new Date(clock.now() - LEASE_STALE_MS - 1).toISOString();
    store.leases.set(RING_KEY, { kind: 'ringLease', ringKey: RING_KEY, holder: { deviceId: 'DEVICEA000000001', deviceLabel: 'Phone', platform: 'android', since: old }, heartbeatAt: old, takeover: null });
    await b.start();
    await settle();
    expect(b.rings()[0]!.state).toBe('connected');
    expect(ring.held?.platformId).toBe('aa:bb:cc:dd:ee:01');
    expect(store.leases.get(RING_KEY)!.holder?.deviceId).toBe('DEVICEB000000002');
  });

  it('a clean disconnect releases the lease', async () => {
    const { store, a } = pair();
    await a.start();
    await settle();
    await a.disconnect(RING_KEY);
    expect(store.leases.get(RING_KEY)).toMatchObject({ holder: null, heartbeatAt: null });
  });

  it('without sync there is no lease and the other-app message covers a busy ring', async () => {
    const { store, a, b } = pair({ syncOn: false });
    await a.start();
    await settle();
    expect(store.leases.size).toBe(0);
    await b.start();
    await settle();
    expect(b.rings()[0]).toMatchObject({ state: 'error', error: { code: 'not_found', message: ANOTHER_APP } });
    expect(store.leaseWrites).toEqual([]);
  });
});
