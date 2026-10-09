// @vitest-environment node
/**
 * Who holds the ring (RINGOWN): with the phone app and the desktop app both open, the J-Style 2301 jumped between the
 * person's devices, each grabbing it whenever it was free. These tests drive two devices (each its own ring service over
 * one shared store, seen through a sync that lags 3 s) and one simulated ring on the FakeClock, and check the ownership
 * rules R1–R6: the holder keeps the ring, the other device waits behind a fresh lease, "Connect here instead" moves it
 * once, a stale lease lets the other take over, the phone gets the head start, and failures back off along Lumen's
 * ladder instead of stealing the ring every 5 s.
 */
import { describe, expect, it } from 'vitest';
import { ANDROID_RECONNECT, reconnectDelayMs } from '../../../../packages/rings/src/types';
import { RingLinkError, type RingConnector, type RingLinkSession, type RingNotice } from '../ports';
import { ANOTHER_APP, CONNECT_ATTEMPT_MS, createRingService } from '../ringService';
import { FREE_GRACE_MS, LEASE_HEARTBEAT_MS, LEASE_STALE_MS, STABLE_LINK_MS, type RingLeaseBody } from '../types';
import { devicePorts, FakeClock, FakeRing, RING_KEY, settle, SharedStore } from './fakes';

const KEY = RING_KEY;
const MIN = 60_000;
/** Sync between the phone and the desktop. */
const LAG = 3_000;
const PHONE = { deviceId: 'DEVICEA000000001', label: 'Phone', platform: 'android' } as const;
const DESKTOP = { deviceId: 'DEVICEB000000002', label: 'Desktop', platform: 'electron' } as const;
type Who = typeof PHONE | typeof DESKTOP;
/** The ring's id on each device: Android spells the address lower case, BlueZ upper case, so a kick tells who lost the ring. */
const PID_PHONE = 'aa:bb:cc:dd:ee:01';
const PID_DESKTOP = 'AA:BB:CC:DD:EE:01';
const pidOf = (who: Who): string => (who === PHONE ? PID_PHONE : PID_DESKTOP);

const DISCONNECTED = 'The ring disconnected. Keep it close; Vitals will reconnect.';
const REFUSED = 'The ring refused the connection. Keep it close and try again.';

/** Lumen's ladder: the wait before retry `n` (0-based) after a failure with `gattStatus`. */
const step = (n: number, gattStatus?: number): number => reconnectDelayMs(ANDROID_RECONNECT, n, gattStatus)!;
const iso = (ms: number): string => new Date(ms).toISOString();
const released = (): RingLeaseBody => ({ kind: 'ringLease', ringKey: KEY, holder: null, heartbeatAt: null, takeover: null });

interface World {
  clock: FakeClock;
  store: SharedStore;
  ring: FakeRing;
}

/**
 * One ring the person has used before: its source is known and, unless `lease: 'none'`, a released lease document
 * exists (some device held it once), so the grace of R6 applies to a device that is not preferred.
 */
function world(o: { second?: FakeRing['onSecondCentral']; lease?: 'released' | 'none' } = {}): World {
  const clock = new FakeClock();
  const store = new SharedStore();
  const ring = new FakeRing({ platformIds: [PID_PHONE, PID_DESKTOP] });
  ring.onSecondCentral = o.second ?? 'refuse';
  store.addRingSource(KEY, 'jstyle2301');
  if (o.lease !== 'none') store.leases.set(KEY, released());
  return { clock, store, ring };
}

/** One device: its service, its attempts at the ring, and `kill()` (the app is gone: no store events, its link closed by the OS). */
function device(w: World, who: Who, o: { clock?: FakeClock; store?: SharedStore; lagMs?: number; syncOn?: boolean; shell?: { notify?: (n: RingNotice) => void } } = {}) {
  const pid = pidOf(who);
  const ports = devicePorts({ store: o.store ?? w.store, clock: o.clock ?? w.clock, rings: [w.ring], deviceId: who.deviceId, label: who.label, platform: who.platform, platformId: pid, lagMs: o.lagMs, syncOn: o.syncOn, shell: o.shell });
  let alive = true;
  const inner = ports.store;
  ports.store = { ...inner, subscribe: (cb) => inner.subscribe(() => (alive ? cb() : undefined)) };
  const svc = createRingService(ports);
  return {
    ports,
    svc,
    pid,
    attempts: () => w.ring.connectAttempts.filter((x) => x.platformId === pid),
    status: () => svc.rings()[0]!,
    kill: async () => {
      alive = false;
      // the OS closes a killed app's link: the ring is free, nothing is released, no drop reaches the dead service
      if (w.ring.held?.platformId === pid) await w.ring.held.close();
    },
  };
}

/** A connector whose first `reconnect` waits until the service aborts it, then fails as a real platform does. */
function abortable(c: RingConnector) {
  const real = c.reconnect!;
  const st = { calls: 0, aborted: false };
  c.reconnect = (pid, d, signal) => {
    if (st.calls++ > 0) return real(pid, d, signal);
    return new Promise<RingLinkSession>((_r, reject) =>
      signal.addEventListener(
        'abort',
        () => {
          st.aborted = true;
          reject(new RingLinkError('cancelled'));
        },
        { once: true },
      ),
    );
  };
  return st;
}

describe('two devices of one person do not bounce the ring (R2, R6)', () => {
  for (const second of ['kick', 'refuse'] as const) {
    for (const order of ['together', 'desktop first'] as const) {
      it(`no ping-pong over 10 simulated minutes; the phone holds (${order}, a second central ${second === 'kick' ? 'takes the ring' : 'is refused'})`, async () => {
        const w = world({ second });
        const a = device(w, PHONE, { lagMs: LAG });
        const b = device(w, DESKTOP, { lagMs: LAG });
        const t0 = w.clock.now();
        if (order === 'together') {
          void a.svc.start();
          void b.svc.start();
          await w.clock.advance(MIN);
        } else {
          void b.svc.start();
          await w.clock.advance(5_000);
          // the desktop is not preferred and a lease document exists: it waits FREE_GRACE_MS before it tries
          expect(b.attempts()).toEqual([]);
          void a.svc.start();
          await w.clock.advance(MIN - 5_000);
          // the phone connects at once, inside the desktop's grace
          expect(a.attempts().map((x) => x.at - t0)).toEqual([5_000]);
        }
        const phoneLink = w.ring.held;
        expect(phoneLink?.platformId).toBe(PID_PHONE);
        expect(b.attempts()).toEqual([]);
        const attempts = w.ring.connectAttempts.length;

        await w.clock.advance(9 * MIN);
        // the same link the whole time after the first minute: a FakeSession never reopens once closed
        expect(w.ring.held).toBe(phoneLink);
        expect(phoneLink!.closed).toBe(false);
        expect(w.ring.connectAttempts).toHaveLength(attempts);
        expect(w.ring.kicks.length).toBeLessThanOrEqual(1);
        expect(a.status().state).toBe('connected');
        expect(b.status()).toMatchObject({ state: 'elsewhere', heldBy: { deviceId: PHONE.deviceId, deviceLabel: 'Phone' } });
        expect(w.store.leases.get(KEY)!.holder).toMatchObject({ deviceId: PHONE.deviceId, deviceLabel: 'Phone', platform: 'android' });
      });
    }
  }
});

describe('"Connect here instead" moves the ring exactly once (R3)', () => {
  it('writes takeover and preferred before the first try, the holder lets go and pauses, and the ring never moves back', async () => {
    const w = world({ second: 'kick' });
    const notices: RingNotice[] = [];
    const a = device(w, PHONE, { lagMs: LAG, shell: { notify: (n) => void notices.push(n) } });
    const b = device(w, DESKTOP, { lagMs: LAG });
    void a.svc.start();
    void b.svc.start();
    await w.clock.advance(MIN);
    expect(a.status().state).toBe('connected');
    expect(b.status()).toMatchObject({ state: 'elsewhere', heldBy: { deviceLabel: 'Phone' } });
    const phoneLink = w.ring.held!;
    const writes = w.store.leaseWrites.length;

    const tc = w.clock.now();
    const moved = b.svc.connectHere(KEY);
    await settle();
    // the lease first: the person chose the desktop, and the phone is told to let go
    expect(w.store.leases.get(KEY)).toMatchObject({ takeover: { deviceId: DESKTOP.deviceId, deviceLabel: 'Desktop' }, preferred: { deviceId: DESKTOP.deviceId, deviceLabel: 'Desktop' } });
    expect(b.attempts().filter((x) => x.at >= tc)).toEqual([]);

    await w.clock.advance(70_000);
    await moved;
    const tries = b.attempts().filter((x) => x.at >= tc);
    expect(tries.length).toBeGreaterThan(0);
    expect(tries[0]!.at - tc).toBeLessThanOrEqual(70_000);
    const mine = w.store.leaseWrites.slice(writes).filter((x) => x.by === DESKTOP.deviceId);
    const takeover = mine.find((x) => x.patch.takeover?.deviceId === DESKTOP.deviceId);
    const preferred = mine.find((x) => x.patch.preferred?.deviceId === DESKTOP.deviceId);
    for (const x of [takeover, preferred]) {
      expect(x).toBeDefined();
      expect(x!.seq!).toBeLessThan(tries[0]!.seq);
      expect(x!.at!).toBeLessThanOrEqual(tries[0]!.at);
    }
    expect(b.status().state).toBe('connected');
    expect(w.ring.held?.platformId).toBe(PID_DESKTOP);
    expect(phoneLink.closed).toBe(true);
    expect(w.store.leases.get(KEY)!.holder).toMatchObject({ deviceId: DESKTOP.deviceId, platform: 'electron' });
    expect(notices).toEqual([{ kind: 'ring_disconnected', title: 'Ring connected elsewhere', text: 'Your J-Style 2301 is now connected to Desktop.' }]);

    const desktopLink = w.ring.held!;
    await w.clock.advance(10 * MIN);
    expect(w.ring.kicks).toEqual([]);
    expect(a.attempts().filter((x) => x.at >= tc)).toEqual([]);
    expect(w.ring.held).toBe(desktopLink);
    expect(desktopLink.closed).toBe(false);
    expect(w.store.leases.get(KEY)!.holder).toMatchObject({ deviceId: DESKTOP.deviceId });
    expect(a.status()).toMatchObject({ state: 'elsewhere', paused: true, heldBy: { deviceId: DESKTOP.deviceId, deviceLabel: 'Desktop' } });
  });
});

describe('a stale lease lets the other device take over (R2, R5)', () => {
  it('a lease 15 min + 1 s without a heartbeat: the desktop connects on its own after the grace and claims', async () => {
    const w = world();
    const old = iso(w.clock.now() - LEASE_STALE_MS - 1_000);
    w.store.leases.set(KEY, { kind: 'ringLease', ringKey: KEY, holder: { deviceId: PHONE.deviceId, deviceLabel: 'Phone', platform: 'android', since: old }, heartbeatAt: old, takeover: null });
    const b = device(w, DESKTOP, { lagMs: LAG });
    const t0 = w.clock.now();
    void b.svc.start();
    await w.clock.advance(FREE_GRACE_MS - 1);
    expect(b.attempts()).toEqual([]);
    await w.clock.advance(5_000);
    expect(b.attempts()).toHaveLength(1);
    expect(b.attempts()[0]!.at - t0).toBeGreaterThanOrEqual(FREE_GRACE_MS);
    expect(b.status().state).toBe('connected');
    expect(w.store.leases.get(KEY)!.holder).toMatchObject({ deviceId: DESKTOP.deviceId, platform: 'electron' });
  });

  it('a holder that was killed (no heartbeat, no release): the desktop takes over once the lease goes stale, without a tap', async () => {
    const w = world();
    // the phone's own clock: it never runs again, so the dead app never heartbeats
    const clockA = new FakeClock();
    const a = device(w, PHONE, { clock: clockA, lagMs: LAG });
    void a.svc.start();
    await settle();
    expect(a.status().state).toBe('connected');
    const claimedAt = clockA.now();
    expect(w.store.leases.get(KEY)!.holder?.deviceId).toBe(PHONE.deviceId);

    const b = device(w, DESKTOP, { lagMs: LAG });
    void b.svc.start();
    await w.clock.advance(FREE_GRACE_MS + 5_000);
    expect(b.status()).toMatchObject({ state: 'elsewhere', heldBy: { deviceLabel: 'Phone' } });
    expect(b.attempts()).toEqual([]);

    await a.kill();
    expect(w.ring.held).toBeNull();
    await w.clock.advance(claimedAt + LEASE_STALE_MS - 1_000 - w.clock.now());
    expect(b.attempts()).toEqual([]);
    expect(b.status().state).toBe('elsewhere');

    await w.clock.advance(1_000 + FREE_GRACE_MS + 5_000);
    expect(b.attempts()).toHaveLength(1);
    expect(b.attempts()[0]!.at).toBeGreaterThan(claimedAt + LEASE_STALE_MS);
    expect(b.status().state).toBe('connected');
    expect(w.store.leases.get(KEY)!.holder).toMatchObject({ deviceId: DESKTOP.deviceId });
  });
});

describe('an unpaired second device backs off (R4)', () => {
  it('sync off, the ring held by the phone: retries 5, 15, 30, 60, 120, 300, 300 s, says "another app or phone" and keeps the readouts', async () => {
    const w = world();
    const lastSyncAt = '2026-10-04T07:30:00.000Z';
    // the desktop's own store (no sync between the two): the ring as it last saw it
    const storeB = new SharedStore();
    storeB.addRingSource(KEY, 'jstyle2301', { ble: { driver: 'jstyle2301', battery: 64, lastSyncAt } });
    const a = device(w, PHONE);
    void a.svc.start();
    await settle();
    expect(a.status().state).toBe('connected');
    const b = device(w, DESKTOP, { store: storeB, syncOn: false });
    const t0 = w.clock.now();
    void b.svc.start();
    await settle();
    // no lease without sync, so no grace: at once
    expect(b.attempts().map((x) => x.at - t0)).toEqual([0]);
    const ladder = Array.from({ length: 7 }, (_, n) => step(n));
    expect(ladder).toEqual([5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000]);
    await w.clock.advance(ladder.reduce((s, x) => s + x, 0) + 1_000);
    const at = b.attempts().map((x) => x.at);
    expect(at.slice(1).map((x, i) => x - at[i]!)).toEqual(ladder);
    expect(b.status()).toMatchObject({ state: 'error', error: { code: 'not_found', message: ANOTHER_APP }, battery: 64, lastSyncAt });
    expect(w.ring.held?.platformId).toBe(PID_PHONE);
    expect(storeB.leaseWrites).toEqual([]);
  });

  it('two unpaired devices on a ring that takes the newest central: each comes back no sooner than its ladder step, and the ring is never left free', async () => {
    const w = world({ second: 'kick' });
    const storeB = new SharedStore();
    storeB.addRingSource(KEY, 'jstyle2301');
    const a = device(w, PHONE);
    void a.svc.start();
    await w.clock.advance(STABLE_LINK_MS + 1_000);
    expect(a.status().state).toBe('connected');
    // a read takes as long as a desktop read, so a link taken away within seconds has no completed read to reset the ladder
    const READ_MS = 40_000;
    w.ring.readMs = READ_MS;
    const b = device(w, DESKTOP, { store: storeB, syncOn: false });
    void b.svc.start();
    // a ring that takes the newest central is never free between owners; sampled (each advance costs real time)
    for (let t = 0; t < 10 * MIN; t += 30_000) {
      await w.clock.advance(30_000);
      expect(w.ring.held).not.toBeNull();
    }
    // a device's retry after losing the ring waits at least the ladder step for the losses in a row since its last
    // link that stayed up (STABLE_LINK_MS) or read to the end (READ_MS)
    const resetAfter = Math.min(STABLE_LINK_MS, READ_MS);
    for (const d of [a, b]) {
      const tries = d.attempts().map((x) => x.at);
      let n = 0;
      for (const k of w.ring.kicks.filter((x) => x.from === d.pid)) {
        const began = tries.filter((t) => t <= k.at).at(-1)!;
        if (k.at - began >= resetAfter) n = 0;
        const next = tries.find((t) => t > k.at);
        if (next !== undefined) expect(next - k.at, `${d.pid} lost the ring at ${k.at - began} ms into its link (loss ${n + 1} in a row)`).toBeGreaterThanOrEqual(step(n));
        n++;
      }
    }
    // Reset on connect (the old rule) gave a kick every 5 s, about 120 in 10 minutes. Climbing the ladder alone gave 13.
    // With the short-link rule (two links in a row taken away within a minute of coming up: wait the slowest step) the
    // loser is answered once by the other, then waits 300 s: the first takeover, two answers each, and the 5-minute
    // come-back, at most 6 in 10 minutes.
    expect(w.ring.kicks.length).toBeLessThanOrEqual(6);
  });
});

describe('Lumen\'s failure modes recover as Lumen does (one device, sync on)', () => {
  function phoneAlone() {
    const w = world();
    const a = device(w, PHONE);
    return { w, a, t0: w.clock.now() };
  }

  it('GATT 133 on an auto attempt: retried after 5 s, connected then', async () => {
    const { w, a, t0 } = phoneAlone();
    w.ring.failOnce = { code: 'failed', gattStatus: 133 };
    void a.svc.start();
    await settle();
    expect(a.status()).toMatchObject({ state: 'error', error: { code: 'failed' } });
    expect(step(0, 133)).toBe(5_000);
    await w.clock.advance(step(0, 133) - 1);
    expect(a.attempts()).toHaveLength(1);
    await w.clock.advance(1);
    expect(a.attempts().map((x) => x.at - t0)).toEqual([0, step(0, 133)]);
    expect(a.status().state).toBe('connected');
  });

  for (const times of [2, 3]) {
    it(`GATT 133 ${times} times, then the link: two fast tries, then the ladder`, async () => {
      const { w, a, t0 } = phoneAlone();
      const g = { code: 'failed', gattStatus: 133 } as const;
      w.ring.failOnce = g;
      void a.svc.start();
      await settle();
      for (let i = 0; i < times; i++) {
        if (i + 1 < times) w.ring.failOnce = g;
        await w.clock.advance(step(i, 133));
      }
      const expected = [0];
      for (let i = 0; i < times; i++) expected.push(expected[i]! + step(i, 133));
      expect(a.attempts().map((x) => x.at - t0)).toEqual(expected);
      // 5 s, 5 s (two fast tries), then the ladder's own step
      expect(expected.slice(1).map((x, i) => x - expected[i]!)).toEqual([5_000, 5_000, 30_000].slice(0, times));
      expect(a.status().state).toBe('connected');
    });
  }

  it('busy or refused: the retry waits 5 s, says the ring refused meanwhile, then connects', async () => {
    const { w, a, t0 } = phoneAlone();
    w.ring.failOnce = { code: 'refused' };
    void a.svc.start();
    await settle();
    expect(a.status()).toMatchObject({ state: 'error', error: { code: 'refused', message: REFUSED } });
    await w.clock.advance(step(0) - 1);
    expect(a.attempts()).toHaveLength(1);
    expect(a.status().error?.message).toBe(REFUSED);
    await w.clock.advance(1);
    expect(a.attempts().map((x) => x.at - t0)).toEqual([0, step(0)]);
    expect(a.status().state).toBe('connected');
  });

  it('slow advertising (40 s): one attempt is not cut off at 30 s and connects at 40 s', async () => {
    const { w, a } = phoneAlone();
    expect(CONNECT_ATTEMPT_MS).toBe(45_000);
    w.ring.connectDelayMs = 40_000;
    void a.svc.start();
    await settle();
    await w.clock.advance(30_000);
    expect(a.status().state).toBe('connecting');
    await w.clock.advance(10_000);
    expect(a.attempts()).toHaveLength(1);
    expect(a.status().state).toBe('connected');
  });

  it('advertising slower than CONNECT_ATTEMPT_MS (50 s): the attempt is given up at 45 s and the next ones follow the ladder', async () => {
    const { w, a, t0 } = phoneAlone();
    w.ring.connectDelayMs = 50_000;
    void a.svc.start();
    await settle();
    await w.clock.advance(CONNECT_ATTEMPT_MS - 1);
    expect(a.status().state).toBe('connecting');
    await w.clock.advance(1);
    expect(a.status().state).toBe('error');
    expect(w.ring.held).toBeNull();
    await w.clock.advance(step(0) + CONNECT_ATTEMPT_MS);
    // the ring answers in time from now on
    w.ring.connectDelayMs = undefined;
    await w.clock.advance(step(1));
    expect(a.attempts().map((x) => x.at - t0)).toEqual([0, CONNECT_ATTEMPT_MS + step(0), 2 * CONNECT_ATTEMPT_MS + step(0) + step(1)]);
    expect(a.status().state).toBe('connected');
  });

  it('a drop keeps the lease and reconnects in 5 s; one early drop climbs the ladder, a second link taken away within a minute waits the slowest step; a link that stays up 60 s starts over at 5 s', async () => {
    const { w, a } = phoneAlone();
    void a.svc.start();
    await w.clock.advance(STABLE_LINK_MS + 1_000);
    expect(a.status().state).toBe('connected');
    // a read that outlasts every link below: only the link's own time can reset the ladder
    w.ring.readMs = 2 * STABLE_LINK_MS;
    const gaps: number[] = [];
    const drop = async (): Promise<number> => {
      const at = w.clock.now();
      w.ring.held!.drop();
      await settle();
      return at;
    };
    // the first link stayed up: its drop retries in 5 s (Lumen); the second link lasted 2 s: one early drop still climbs
    // the ladder (15 s); the third link lasted 2 s again: two links in a row taken away within a minute mean another
    // central wants the ring, so the next try waits the slowest step rather than fight
    const expected = [step(0), step(1), step(ANDROID_RECONNECT.delaysMs.length - 1)];
    for (let i = 0; i < 3; i++) {
      const n = a.attempts().length;
      const at = await drop();
      if (i === 0) {
        expect(a.status()).toMatchObject({ state: 'error', error: { code: 'disconnected', message: DISCONNECTED } });
        // an unexpected drop does not release the lease (R1)
        expect(w.store.leases.get(KEY)!.holder?.deviceId).toBe(PHONE.deviceId);
      }
      await w.clock.advance(expected[i]! - 1_000);
      expect(a.attempts(), `no try before ${expected[i]} ms`).toHaveLength(n);
      await w.clock.advance(1_000);
      expect(a.attempts()).toHaveLength(n + 1);
      gaps.push(a.attempts().at(-1)!.at - at);
      expect(w.ring.held?.platformId).toBe(PID_PHONE);
      // the link is up a moment, then drops again
      await w.clock.advance(2_000);
    }
    expect(gaps).toEqual([5_000, 15_000, 300_000]);
    expect(gaps).toEqual(expected);

    await w.clock.advance(STABLE_LINK_MS);
    const n = a.attempts().length;
    const at = await drop();
    await w.clock.advance(step(0));
    expect(a.attempts()).toHaveLength(n + 1);
    expect(a.attempts().at(-1)!.at - at).toBe(step(0));
    expect(w.store.leases.get(KEY)!.holder?.deviceId).toBe(PHONE.deviceId);
  });

  it('a holder that cannot reach its ring keeps the lease through the first failed retry and lets go by the third (R1)', async () => {
    const { w, a } = phoneAlone();
    void a.svc.start();
    await w.clock.advance(STABLE_LINK_MS + 1_000);
    w.ring.refuse = 'not_found';
    w.ring.held!.drop();
    await settle();
    await w.clock.advance(step(0));
    expect(a.attempts()).toHaveLength(2);
    expect(w.store.leases.get(KEY)!.holder?.deviceId).toBe(PHONE.deviceId);
    await w.clock.advance(step(1));
    expect(a.attempts()).toHaveLength(3);
    expect(w.store.leases.get(KEY)!.holder?.deviceId).toBe(PHONE.deviceId);
    // the third failed retry (the fourth attempt, 50 s after the drop) is the one that lets go
    await w.clock.advance(step(2));
    expect(a.attempts()).toHaveLength(4);
    expect(w.store.leases.get(KEY)!.holder).toBeNull();
  });
});

describe('a claim during an auto attempt (R2)', () => {
  it('a held lease arriving while an auto attempt is in flight aborts it: elsewhere, and no retry for 10 minutes while the phone heartbeats', async () => {
    const w = world({ second: 'kick' });
    const b = device(w, DESKTOP);
    const st = abortable(b.ports.connector);
    void b.svc.start();
    await w.clock.advance(FREE_GRACE_MS + 1_000);
    expect(st.calls).toBe(1);
    expect(b.status().state).toBe('connecting');

    const a = device(w, PHONE);
    void a.svc.start();
    await settle();
    expect(a.status().state).toBe('connected');
    expect(st.aborted).toBe(true);
    expect(b.status()).toMatchObject({ state: 'elsewhere', heldBy: { deviceId: PHONE.deviceId, deviceLabel: 'Phone' } });
    expect(b.status().error).toBeUndefined();

    const phoneLink = w.ring.held!;
    const t1 = w.clock.now();
    await w.clock.advance(10 * MIN);
    expect(st.calls).toBe(1);
    expect(b.attempts()).toEqual([]);
    expect(w.ring.kicks).toEqual([]);
    expect(w.ring.held).toBe(phoneLink);
    expect(phoneLink.closed).toBe(false);
    expect(b.status()).toMatchObject({ state: 'elsewhere', heldBy: { deviceLabel: 'Phone' } });
    const lease = w.store.leases.get(KEY)!;
    expect(lease.holder?.deviceId).toBe(PHONE.deviceId);
    expect(Date.parse(lease.heartbeatAt!)).toBeGreaterThanOrEqual(t1 + 10 * MIN - LEASE_HEARTBEAT_MS);
  });
});
