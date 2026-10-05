/**
 * Connect regressions from device QA (plan 04, FIX1): a ring forgotten after a relaunch when its first read failed
 * (J1-07), and a ring stuck on "Could not connect" with no retry after a fresh start (J2-07).
 */
import { describe, expect, it } from 'vitest';
import { RingError, type RingSession, type Transport } from '../../../../packages/rings/src/types';
import { toLinkError, wrapSession } from '../connectors/rings';
import { claimPatch } from '../lease';
import { RingLinkError, type RingConnector, type RingLinkSession, type RingServicePorts } from '../ports';
import { ANOTHER_APP, CONNECT_ATTEMPT_MS, createRingService, errorOf, FIRST_RETRY_MS } from '../ringService';
import { devicePorts, FakeClock, FakeRing, MemoryLocal, RING_KEY, settle, SharedStore, type FakeSession } from './fakes';

const PID = 'aa:bb:cc:dd:ee:01';

function known(o: { failSync?: boolean; shell?: RingServicePorts['shell'] } = {}) {
  const clock = new FakeClock();
  const store = new SharedStore();
  const ring = new FakeRing({ platformIds: [PID] });
  if (o.failSync) ring.failSyncOnce = true;
  store.addRingSource(RING_KEY, 'jstyle2301');
  const ports = devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Phone', shell: o.shell });
  return { clock, store, ring, ports, svc: createRingService(ports) };
}

/** A connector whose `reconnect` never settles while `hang` is set (the platform never answers). */
function hanging(c: RingConnector, ring: FakeRing, clock: FakeClock, late: RingLinkSession[]) {
  const st = { hang: true, calls: 0 };
  c.reconnect = (platformId) => {
    st.calls++;
    if (!st.hang) return Promise.resolve(ring.open(platformId, clock));
    // a link that comes up only after the attempt was given up
    return new Promise<RingLinkSession>((r) =>
      clock.setTimeout(() => {
        if (ring.held) return; // the ring allows one central: this open never answers
        const s = ring.open(platformId, clock);
        late.push(s);
        r(s);
      }, CONNECT_ATTEMPT_MS + 1_000),
    );
  };
  return st;
}

describe('J1-07 a ring that connected once survives a relaunch', () => {
  it('pair, the first read fails, the app closes: the next start still shows the ring and reconnects to it', async () => {
    const clock = new FakeClock();
    const store = new SharedStore();
    const local = new MemoryLocal();
    const ring = new FakeRing({ platformIds: [PID] });
    ring.failSyncOnce = true;
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Desktop', local }));
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    await expect(svc.pair(found[0]!.candidateId)).rejects.toThrow();
    const key = svc.rings()[0]!.ringKey;
    expect(store.sources.get(key)).toMatchObject({ deviceType: 'ring', ble: { driver: 'jstyle2301' } });
    await svc.stop();
    expect(ring.held).toBeNull();

    // the relaunch: a new service over the same store and device-local state
    const before = ring.connectAttempts.length;
    const again = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Desktop', local }));
    await again.start();
    await settle();
    expect(again.rings().map((r) => r.ringKey)).toEqual([key]);
    expect(ring.connectAttempts.slice(before).map((a) => a.platformId)).toEqual([PID]);
    expect(again.rings()[0]!.state).toBe('connected');
  });
});

describe('J2-07 a ring never stays stuck after a failed connect or read', () => {
  it('a failed first read lets the link go and reconnects on its own within seconds', async () => {
    const { svc, ring, clock } = known({ failSync: true });
    await svc.start();
    await settle();
    expect(svc.rings()[0]).toMatchObject({ state: 'error', error: { code: 'failed' } });
    expect(ring.held).toBeNull(); // the stale link is released
    await clock.advance(FIRST_RETRY_MS);
    expect(ring.connectAttempts).toHaveLength(2);
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('Connect on a ring whose read failed reconnects rather than doing nothing', async () => {
    const { svc, ring } = known();
    await svc.start();
    await settle();
    // the periodic read fails on a link that is still open (web-like: no retry armed), then Connect is pressed
    ring.failSyncOnce = true;
    await expect(svc.syncNow(RING_KEY)).rejects.toThrow();
    await settle();
    const attempts = ring.connectAttempts.length;
    await svc.connectHere(RING_KEY);
    expect(ring.connectAttempts).toHaveLength(attempts + 1);
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('Connect with a link held open in state error closes it and connects again', async () => {
    const { svc, ring, clock, ports } = known();
    // the read fails with a cancel, so the link stays open in state error (the old stuck shape)
    let n = 0;
    const real = ports.connector.reconnect!;
    ports.connector.reconnect = async (pid, d, sig) => {
      const s = await real(pid, d, sig);
      if (n++ === 0)
        s.sync = async function* () {
          yield* [];
          throw new RingLinkError('cancelled');
        };
      return s;
    };
    await svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('error');
    const first = ring.held;
    expect(first).not.toBeNull();
    await svc.connectHere(RING_KEY);
    await clock.advance(1);
    expect(first!.closed).toBe(true);
    expect(ring.connectAttempts).toHaveLength(2);
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('a connect attempt that never settles is given up after CONNECT_ATTEMPT_MS and retried', async () => {
    const { svc, ring, clock, ports } = known();
    const st = hanging(ports.connector, ring, clock, []);
    void svc.start(); // start waits for the first attempt
    await settle();
    expect(svc.rings()[0]!.state).toBe('connecting');
    await clock.advance(CONNECT_ATTEMPT_MS);
    expect(svc.rings()[0]).toMatchObject({ state: 'error' });
    st.hang = false;
    await clock.advance(FIRST_RETRY_MS);
    expect(st.calls).toBe(2);
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('a desktop reconnect that takes a 15 s look plus most of BlueZ\'s 40 s try is not cut off: one attempt, then the read', async () => {
    const { svc, ring, clock, ports } = known();
    expect(CONNECT_ATTEMPT_MS).toBeGreaterThan(40_000);
    let calls = 0;
    ports.connector.reconnect = (platformId) => {
      calls++;
      return new Promise<RingLinkSession>((r) => clock.setTimeout(() => r(ring.open(platformId, clock)), 41_000));
    };
    void svc.start();
    await settle();
    await clock.advance(30_000);
    expect(svc.rings()[0]!.state).toBe('connecting'); // 30 s (Lumen's Android bound) cut this ring off on the owner's PC
    await clock.advance(11_000);
    await settle();
    expect(calls).toBe(1);
    expect(svc.rings()[0]!.state).toBe('connected');
    expect(ring.held?.syncCalls).toHaveLength(1);
  });

  it('a late link that does come up after the attempt was given up is closed', async () => {
    const { svc, ring, clock, ports } = known();
    const late: RingLinkSession[] = [];
    hanging(ports.connector, ring, clock, late);
    void svc.start();
    await settle();
    await clock.advance(CONNECT_ATTEMPT_MS + 1_500); // given up at 45 s; the first link comes up at 46 s
    expect(late).toHaveLength(1);
    expect((late[0] as unknown as { closed: boolean }).closed).toBe(true);
    expect(ring.held).toBeNull();
    expect(svc.rings()[0]!.state).not.toBe('connected');
  });

  it('syncNow while an attempt hangs does not wait forever', async () => {
    const { svc, ring, clock, ports } = known();
    const st = hanging(ports.connector, ring, clock, []);
    void svc.start();
    await settle();
    let done = false;
    const p = svc.syncNow(RING_KEY).then(() => (done = true), () => (done = true));
    st.hang = false;
    await clock.advance(CONNECT_ATTEMPT_MS + 1);
    await p;
    expect(done).toBe(true);
  });

  it('the retries after a failed start-up connect follow Lumen\'s backoff: 5, 15, 30 s', async () => {
    const { svc, ring, clock } = known();
    ring.refuse = 'not_found';
    await svc.start();
    await settle();
    for (const ms of [5_000, 15_000, 30_000]) await clock.advance(ms);
    const t0 = ring.connectAttempts[0]!.at;
    expect(ring.connectAttempts.map((a) => a.at - t0)).toEqual([0, 5_000, 20_000, 50_000]);
  });
});

/** A connector whose first `reconnect` waits until the service aborts it, then fails as a real platform does. */
function abortable(c: RingConnector) {
  const real = c.reconnect!;
  const st = { calls: 0 };
  c.reconnect = (pid, d, signal) => {
    if (st.calls++ > 0) return real(pid, d, signal);
    return new Promise<RingLinkSession>((_r, reject) => signal.addEventListener('abort', () => reject(new RingLinkError('cancelled')), { once: true }));
  };
  return st;
}

/** Holds the session's `close` until `release` is called (a link that takes its time to go down). */
function slowClose(s: FakeSession) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const close = s.close.bind(s);
  s.close = async () => {
    await gate;
    await close();
  };
  return { release: () => release() };
}

describe('J2-07 verifier fixes (849dcd98)', () => {
  it('a retry armed by an attempt that ends after Forget does nothing', async () => {
    const { svc, clock, ports } = known();
    const st = abortable(ports.connector);
    void svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('connecting');
    await svc.forget(RING_KEY); // aborts the attempt, whose failure arms the retry
    await clock.advance(10 * FIRST_RETRY_MS);
    expect(st.calls).toBe(1);
    expect(svc.rings()).toEqual([]);
  });

  it('a retry armed by an attempt that ends after stop does nothing', async () => {
    const { svc, ring, clock, ports } = known();
    const st = abortable(ports.connector);
    void svc.start();
    await settle();
    await svc.stop();
    await clock.advance(10 * FIRST_RETRY_MS);
    expect(st.calls).toBe(1);
    expect(ring.held).toBeNull();
  });

  it('Disconnect pressed while a failed read closes the link ends idle and paused, with no error and no retry', async () => {
    const { svc, ring, clock } = known();
    await svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('connected');
    const gate = slowClose(ring.held!);
    ring.failSyncOnce = true;
    const read = svc.syncNow(RING_KEY).catch(() => undefined);
    await settle();
    await svc.disconnect(RING_KEY); // the failed read is still closing the link
    gate.release();
    await read;
    await settle();
    expect(svc.rings()[0]).toMatchObject({ state: 'idle', paused: true });
    expect(svc.rings()[0]!.error).toBeUndefined();
    const attempts = ring.connectAttempts.length;
    await clock.advance(60_000);
    expect(ring.connectAttempts).toHaveLength(attempts);
    expect(svc.rings()[0]!.state).toBe('idle');
  });

  it('Disconnect pressed while a dropped link closes ends idle and paused, with no error and no retry', async () => {
    const { svc, ring, clock } = known();
    await svc.start();
    await settle();
    const s = ring.held!;
    const gate = slowClose(s);
    s.drop();
    await settle();
    await svc.disconnect(RING_KEY);
    gate.release();
    await settle();
    expect(svc.rings()[0]).toMatchObject({ state: 'idle', paused: true });
    expect(svc.rings()[0]!.error).toBeUndefined();
    const attempts = ring.connectAttempts.length;
    await clock.advance(60_000);
    expect(ring.connectAttempts).toHaveLength(attempts);
  });

  it('a ring another device took while a failed read closed the link shows elsewhere, with no retry', async () => {
    const { svc, ring, clock, store } = known();
    await svc.start();
    await settle();
    const s = ring.held!;
    const close = s.close.bind(s);
    // the other phone claims the ring while this one lets go of the stale link
    s.close = async () => {
      await store.port().patchLease(RING_KEY, claimPatch({ deviceId: 'DEVICEB000000002', deviceLabel: 'Tablet', platform: 'android' }, new Date(clock.now()).toISOString(), RING_KEY));
      await close();
    };
    ring.failSyncOnce = true;
    await expect(svc.syncNow(RING_KEY)).rejects.toThrow();
    await settle();
    expect(svc.rings()[0]).toMatchObject({ state: 'elsewhere', heldBy: { deviceLabel: 'Tablet' } });
    expect(svc.rings()[0]!.error).toBeUndefined();
    const attempts = ring.connectAttempts.length;
    await clock.advance(FIRST_RETRY_MS + 5_000);
    expect(ring.connectAttempts).toHaveLength(attempts);
  });

  it('a ring error from a read on an open link says "Could not connect", not "another app"', async () => {
    const ringSession = {
      family: { id: 'jstyle2301' },
      identity: { basis: 'address', ringId: 'mac:aa:bb:cc:dd:ee:01' },
      // eslint-disable-next-line require-yield
      async *sync() {
        throw new RingError('no answer from the ring', 'timeout');
      },
    } as unknown as RingSession;
    const transport = { peripheral: { address: 'AA:BB:CC:DD:EE:01' } } as unknown as Transport;
    const link = wrapSession(ringSession, transport);
    let err: unknown;
    try {
      for await (const ev of link.sync({}, () => undefined, new AbortController().signal)) void ev;
    } catch (e) {
      err = e;
    }
    expect(toLinkError(new RingError('no answer from the ring', 'timeout')).code).toBe('not_found'); // as a connect
    expect(err).toBeInstanceOf(RingLinkError);
    expect((err as RingLinkError).code).toBe('failed');
    expect(errorOf(err).message).not.toBe(ANOTHER_APP);
    expect(errorOf(err).message).toMatch(/^Could not connect/);
  });
});

describe('C-RINGX-15 the retry follows the GATT status of the failure', () => {
  /** A connector whose reconnect fails as the Android transport does: with the plugin's GATT status. */
  function gattFailing(c: RingConnector, clock: FakeClock, statuses: number[]) {
    const at: number[] = [];
    const real = c.reconnect!;
    c.reconnect = async (pid, d, signal) => {
      at.push(clock.now());
      const status = statuses.shift();
      if (status === undefined) return real(pid, d, signal);
      throw toLinkError(new RingError('connect failed', 'timeout', Object.assign(new Error(`Connection failed with status ${status} (GATT_ERROR).`), { gattStatus: status })));
    };
    return at;
  }

  it('toLinkError keeps the GATT status from the error or its cause', () => {
    expect(toLinkError(Object.assign(new Error('Connection failed with status 133 (GATT_ERROR).'), { gattStatus: 133 })).gattStatus).toBe(133);
    expect(toLinkError(new RingError('connect failed', 'timeout', new Error('Connection failed with status 257.'))).gattStatus).toBe(257);
    expect(toLinkError(new Error('no status here')).gattStatus).toBeUndefined();
  });

  it('GATT 133 gives two fast 5 s retries, then the usual backoff (Lumen ReconnectBackoff)', async () => {
    const { svc, clock, ports } = known();
    const at = gattFailing(ports.connector, clock, [133, 133, 133, 133]);
    await svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('error');
    for (const ms of [5_000, 5_000, 30_000, 60_000]) await clock.advance(ms);
    expect(at.map((t) => t - at[0]!)).toEqual([0, 5_000, 10_000, 40_000, 100_000]);
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('GATT 257 waits for Bluetooth to come back on, with only the slowest step as a net', async () => {
    let onBt: ((on: boolean) => void) | undefined;
    const { svc, clock, ports } = known({ shell: { onBluetoothState: (cb) => ((onBt = cb), () => undefined) } });
    const at = gattFailing(ports.connector, clock, [257]);
    await svc.start();
    await settle();
    expect(svc.rings()[0]!.state).toBe('error');
    await clock.advance(4 * 60_000);
    expect(at).toHaveLength(1);
    onBt!(true);
    await settle();
    expect(at).toHaveLength(2);
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('GATT 257 with Bluetooth never toggling still retries after the slowest step', async () => {
    const { svc, clock, ports } = known({ shell: { onBluetoothState: () => () => undefined } });
    const at = gattFailing(ports.connector, clock, [257]);
    await svc.start();
    await settle();
    await clock.advance(299_000);
    expect(at).toHaveLength(1);
    await clock.advance(2_000);
    await settle();
    expect(at).toHaveLength(2);
    expect(svc.rings()[0]!.state).toBe('connected');
  });
});
