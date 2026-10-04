/**
 * R5-01: live heart rate through the REAL connector and session (`createRingsConnector` + `openRingSession`) over a
 * scripted J-Style 2301 transport. The ring answers its commands by opcode and streams 0x09 packets after `09 01 00`
 * whose byte 21 carries heart rate only while a 0x28 heart-rate measurement runs (inferred from the manual heart-rate
 * flow, §5.3 and §10; **unverified** with `09 01 00` alone); the measurement ends on its own after its seconds.
 * Synthetic values only; no hardware.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import type { RingFamily, Transport, TransportEvent, TransportFactory, Uuid } from '../../../../packages/rings/src/types';
import { createRingsConnector } from '../connectors/rings';
import { createRingService } from '../ringService';
import { devicePorts, FakeClock, FakeRing, MemoryLocal, RING_KEY, settle, SharedStore } from './fakes';

const sum = (b: number[]): number => b.reduce((a, x) => a + x, 0) & 0xff;
const frame16 = (...head: number[]): Uint8Array => {
  const p = new Uint8Array(16);
  head.forEach((v, i) => (p[i] = v));
  p[15] = sum([...p.subarray(0, 15)]);
  return p;
};
/** A 22-byte 0x09 realtime packet; byte 21 carries the heart rate (0 = none). */
const livePacket = (bpm: number): Uint8Array => {
  const p = new Uint8Array(22);
  p[0] = 0x09;
  p[21] = bpm;
  return p;
};

/** A J-Style 2301 (V0525) that answers by opcode. Realtime on: one 0x09 packet every `liveEveryMs`. */
class ScriptedRing implements Transport {
  readonly peripheral = { id: 'AA:BB:CC:DD:EE:01', address: 'AA:BB:CC:DD:EE:01' };
  readonly mtu = 247;
  /** Opcode and first payload byte of every write (never a whole frame). */
  readonly writes: string[] = [];
  connected = true;
  realtime = false;
  /** Epoch ms the running heart-rate measurement ends at, or 0. */
  measuringUntil = 0;
  measurements = 0;
  bpm = 61;
  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<(ev: TransportEvent) => void>();
  private channel: Uuid = '';
  private service: Uuid = '';
  /** `msPerSecond` scales the 0x28 duration so a test sees a measurement end. */
  constructor(private readonly o: { liveEveryMs?: number; msPerSecond?: number } = {}) {}

  get measuring(): boolean {
    return Date.now() < this.measuringUntil;
  }

  private push(bytes: Uint8Array): void {
    for (const l of this.listeners) l({ type: 'notification', service: this.service, characteristic: this.channel, bytes });
  }

  async write(_s: Uuid, _c: Uuid, bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error('not connected');
    const op = bytes[0]!;
    this.writes.push(`${op.toString(16).padStart(2, '0')} ${bytes[1]!.toString(16).padStart(2, '0')}`);
    const reply = (...ps: Uint8Array[]): void => void setTimeout(() => ps.forEach((p) => this.push(p)), 2);
    if (op === 0x27) reply(frame16(0x27, 0x00, 0x05, 0x02, 0x05));
    else if (op === 0x13) reply(frame16(0x13, 0x50));
    else if (op === 0x09) {
      this.realtime = bytes[1] === 1;
      clearInterval(this.timer);
      if (this.realtime) this.timer = setInterval(() => this.push(livePacket(this.measuring ? this.bpm : 0)), this.o.liveEveryMs ?? 15);
    } else if (op === 0x28 && bytes[1] === 0x02) {
      const start = bytes[2] === 1;
      if (start) this.measurements++;
      this.measuringUntil = start ? Date.now() + (bytes[3]! | (bytes[4]! << 8)) * (this.o.msPerSecond ?? 1_000) : 0;
      reply(frame16(0x28, 0x02, 0x00));
    } else if ([0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x62, 0x66].includes(op)) reply(new Uint8Array([op, 0xff]));
  }
  async read(): Promise<Uint8Array> {
    throw new Error('not readable');
  }
  async subscribe(service: Uuid, characteristic: Uuid): Promise<() => Promise<void>> {
    this.service = service;
    this.channel = characteristic;
    return async () => undefined;
  }
  async services(): Promise<Uuid[]> {
    return [];
  }
  on(l: (ev: TransportEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  async disconnect(): Promise<void> {
    clearInterval(this.timer);
    this.connected = false;
  }
}

const fast = { timers: { quietMs: 20, stallMs: 40 }, clock: { now: () => Date.now(), tzOffsetS: () => 0 } };

function setup(o: { family?: RingFamily; ring?: ConstructorParameters<typeof ScriptedRing>[0] } = {}) {
  const rings: ScriptedRing[] = [];
  const factory: TransportFactory = {
    platform: 'fake',
    available: async () => true,
    async scan() {},
    async connect() {
      const r = new ScriptedRing(o.ring);
      rings.push(r);
      return r;
    },
  };
  const clock = new FakeClock();
  const store = new SharedStore();
  store.addRingSource(RING_KEY, 'jstyle2301');
  const local = new MemoryLocal({ [RING_KEY]: { cursor: {}, platformId: 'AA:BB:CC:DD:EE:01' } });
  const ports = { ...devicePorts({ store, clock, rings: [], deviceId: 'DEVICEA000000001', label: 'Desktop', local }), connector: createRingsConnector({ factory, families: [o.family ?? jstyle2301], session: fast }), platform: 'electron' as const };
  const svc = createRingService(ports);
  return { svc, rings, clock };
}

/** Real timers drive the session: wait until `ok` holds. */
async function until(ok: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
}

afterEach(() => vi.restoreAllMocks());

/** The J-Style family with its live measurement window shortened, so a test sees the ring end one and Vitals start the next. */
const shortWindow = (windowMs: number): RingFamily => ({ ...jstyle2301, liveHeartRate: { ...jstyle2301.liveHeartRate!, measure: { ...jstyle2301.liveHeartRate!.measure!, gapMs: 20, windowMs } } });

describe('R5-01 live heart rate over the real session', () => {
  it('a watcher from before the connect gets live heart rate after the first read (the ring measures for it)', async () => {
    const { svc, rings } = setup();
    await svc.start();
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await until(() => svc.rings()[0]?.liveHr !== undefined);
    expect(svc.rings()[0]!.state).toBe('connected');
    expect(svc.rings()[0]!.liveHr?.bpm).toBe(61);
    expect(rings[0]!.realtime).toBe(true);
    expect(rings[0]!.measuring).toBe(true);
    // live starts after the read: realtime on, then the heart-rate measurement
    const w = rings[0]!.writes;
    expect(w.indexOf('09 01')).toBeGreaterThan(w.lastIndexOf('66 00'));
    expect(w.indexOf('28 02')).toBeGreaterThan(w.indexOf('09 01'));
    stop();
    await until(() => !rings[0]!.realtime);
    // stop reverses both: measurement off, realtime off
    expect(rings[0]!.measuring).toBe(false);
    expect(rings[0]!.realtime).toBe(false);
    expect(w.slice(-2)).toEqual(['28 02', '09 00']);
    await svc.stop();
  });

  it('a watcher that arrives while the first read runs (the card mounts on "connected")', async () => {
    const { svc, rings } = setup();
    let stop: (() => void) | undefined;
    const off = svc.subscribe((rs) => {
      if (!stop && (rs[0]?.state === 'connected' || rs[0]?.state === 'syncing')) queueMicrotask(() => (stop = svc.watchLiveHeartRate(RING_KEY)));
    });
    await svc.start();
    await until(() => svc.rings()[0]?.liveHr !== undefined);
    expect(svc.rings()[0]!.liveHr?.bpm).toBe(61);
    expect(rings[0]!.realtime).toBe(true);
    off();
    stop?.();
    await svc.stop();
  });

  it('the ring ends its timed measurement: Vitals starts the next one and the reading stays on the card meanwhile', async () => {
    const { svc, rings } = setup({ family: shortWindow(150), ring: { msPerSecond: 5 } });
    await svc.start();
    const shown: Array<number | undefined> = [];
    const off = svc.subscribe((rs) => shown.push(rs[0]?.liveHr?.bpm));
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await until(() => rings[0]?.measurements === 3, 3_000);
    expect(rings[0]!.measurements).toBe(3);
    rings[0]!.bpm = 66;
    await until(() => svc.rings()[0]?.liveHr?.bpm === 66);
    expect(svc.rings()[0]!.liveHr?.bpm).toBe(66);
    // from the first reading on, the card never lost it between two windows
    expect(shown.slice(shown.indexOf(61))).not.toContain(undefined);
    off();
    stop();
    await svc.stop();
  });

  it('Sync now while live: live pauses for the read and comes back', async () => {
    const { svc, rings } = setup();
    await svc.start();
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await until(() => svc.rings()[0]?.liveHr !== undefined);
    await svc.syncNow(RING_KEY);
    rings[0]!.bpm = 64;
    await until(() => svc.rings()[0]?.liveHr?.bpm === 64);
    expect(svc.rings()[0]!.liveHr?.bpm).toBe(64);
    expect(svc.rings()[0]!.state).toBe('connected');
    stop();
    await svc.stop();
  });
});

describe('a live heart-rate failure is said and tried once more', () => {
  function fakeSetup() {
    const clock = new FakeClock();
    const store = new SharedStore();
    const ring = new FakeRing({ platformIds: ['aa:bb:cc:dd:ee:01'] });
    store.addRingSource(RING_KEY, 'jstyle2301');
    const svc = createRingService(devicePorts({ store, clock, rings: [ring], deviceId: 'DEVICEA000000001', label: 'Desktop' }));
    return { svc, ring, clock };
  }

  it('the ring busy: a console line with the code (no bytes), the state stays connected, one retry 3 s later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { svc, ring, clock } = fakeSetup();
    await svc.start();
    await settle();
    const s = ring.held!;
    s.running = 'other';
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    expect(s.liveActive).toBe(false);
    expect(warn).toHaveBeenCalledWith('Vitals: live heart rate stopped', 'failed');
    expect(svc.rings()[0]!.state).toBe('connected');
    expect(svc.rings()[0]!.error).toBeUndefined();
    s.running = null;
    await clock.advance(2_900);
    expect(s.liveActive).toBe(false);
    await clock.advance(200);
    expect(s.liveActive).toBe(true);
    stop();
    await settle();
  });

  it('only one retry: a second failure in a row is left (the next read or watcher starts it again)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { svc, ring, clock } = fakeSetup();
    await svc.start();
    await settle();
    const s = ring.held!;
    s.running = 'other';
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await clock.advance(3_100);
    await clock.advance(10_000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(s.overlaps).toEqual(['live during other', 'live during other']);
    s.running = null;
    await svc.syncNow(RING_KEY);
    await settle();
    expect(s.liveActive).toBe(true);
    stop();
  });

  it('no retry once nobody watches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { svc, ring, clock } = fakeSetup();
    await svc.start();
    await settle();
    const s = ring.held!;
    s.running = 'other';
    const stop = svc.watchLiveHeartRate(RING_KEY);
    await settle();
    stop();
    s.running = null;
    await clock.advance(5_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(s.liveActive).toBe(false);
  });
});
