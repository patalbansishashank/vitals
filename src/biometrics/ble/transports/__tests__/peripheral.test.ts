// @vitest-environment node
/**
 * Each Bluetooth adapter end to end over the scripted ring (A5a). For every platform a fake of its API is backed by a
 * `FakePeripheral` (`peripheralFakes.ts`); the real adapter (`web`, `capacitor`, `electron`, `rings`) hands a `Transport`
 * to the real `openRingSession(jstyle2301, …)`, and the fixture sessions of `qa/fixtures/rings/jstyle2301` replay through it.
 * The proof is differential: events, ring identity, handshake info and every write the ring saw (channel, mode and
 * exact bytes) must equal the run with the bare `FakePeripheral` as the transport.
 *
 * Nothing here logs or prints a frame. Writes are compared in their redacted form (`redactOutbound`) and, for exact
 * bytes, as a yes or no, so a failing run never shows the J-Style 0x3C frame.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jstyle2301 } from '../../../../../packages/rings/src/jstyle2301/family';
import { openRingSession } from '../../../../../packages/rings/src/session';
import { loadSessions, stepFromFixture, type FakeStep, type FixtureSession } from '../../../../../packages/rings/src/testing';
import {
  RingError, toHex, uuid16,
  type Advertisement, type HandshakeInfo, type RingEvent, type RingFamily, type RingIdentity, type RingSession, type SessionRuntime, type Transport, type TransportEvent,
} from '../../../../../packages/rings/src/types';
import { LINK_RELEASE_MS } from '../../webBluetooth';
import { createCapacitorTransport } from '../capacitor';
import { createElectronTransport } from '../electron';
import { capacitorFactory, chooserFactory, familiesQuery, linkTransport } from '../rings';
import { queryOf } from '../types';
import { webTransport } from '../web';
import {
  FakeCapClient, FakeDesktopBridge, fakeWebBluetooth, newStats, ringFrom,
  type FakeWeb, type PlatformStats, type Ring, type WriteSeen,
} from './peripheralFakes';

const REPO = join(__dirname, '../../../../..');
const fixture = await loadSessions(REPO, 'jstyle2301');
const sessionNamed = (prefix: string): FixtureSession => {
  const s = fixture.sessions.find((x) => x.name.startsWith(prefix));
  if (!s) throw new Error(`no fixture session ${prefix}`);
  return s;
};

/** An address-shaped id that belongs to no real device. */
const MAC = 'E2:80:00:00:00:01';
/** The Device Information serial the ring answers with; "SN007" is made up. */
const SERIAL_READ = { [`${uuid16(0x180a)}/${uuid16(0x2a25)}`]: '53 4e 30 30 37' };
const fast = { timers: { quietMs: 30, stallMs: 80 }, clock: { now: () => Date.parse('2026-09-16T10:00:00Z'), tzOffsetS: () => 0 } };
const abort = (): AbortSignal => new AbortController().signal;

const ringFor = (session: FixtureSession, withSerial = true): Ring => ringFrom(session, withSerial ? { reads: SERIAL_READ, id: MAC, address: MAC } : { id: MAC, address: MAC });

const tapped = (t: Transport): TransportEvent[] => {
  const got: TransportEvent[] = [];
  t.on((e) => got.push(e));
  return got;
};
const disconnects = (events: readonly TransportEvent[]): TransportEvent[] => events.filter((e) => e.type === 'disconnected');

// ---------------------------------------------------------------- the ways to reach the ring

interface Opened {
  transport: Transport;
  stats: PlatformStats;
  /** Every event the adapter's transport emitted, listened to from before the session opened. */
  tap: TransportEvent[];
  web?: FakeWeb;
  client?: FakeCapClient;
  bridge?: FakeDesktopBridge;
}

interface Variant {
  name: string;
  /** Without a serial the ring's identity comes from its address where the platform has one, else the advertised id. */
  noSerial: RingIdentity['basis'];
  /** The spot and budget sessions take a second or more; one way per platform runs them. */
  full: boolean;
  open(ring: Ring): Promise<Opened>;
}

const web = (ring: Ring): FakeWeb => {
  const w = fakeWebBluetooth(ring);
  vi.stubGlobal('navigator', { bluetooth: w.bluetooth });
  return w;
};

const webLink: Variant = {
  name: 'web: requestDevice, then linkTransport',
  noSerial: 'advertised',
  full: true,
  async open(ring) {
    const w = web(ring);
    const transport = linkTransport(await webTransport.requestDevice(familiesQuery([jstyle2301])));
    return { transport, stats: w.device.stats, tap: tapped(transport), web: w };
  },
};

const webChooser: Variant = {
  name: 'web: chooserFactory scan and connect',
  noSerial: 'advertised',
  full: false,
  async open(ring) {
    const w = web(ring);
    const factory = chooserFactory(webTransport, 'web-bluetooth');
    const found: Advertisement[] = [];
    await factory.scan([jstyle2301], (ad) => found.push(ad), abort());
    const transport = await factory.connect({ platformId: found[0]!.platformId! }, jstyle2301);
    return { transport, stats: w.device.stats, tap: tapped(transport), web: w };
  },
};

const capacitorScan: Variant = {
  name: 'capacitor: capacitorFactory scan and connect',
  noSerial: 'mac',
  full: true,
  async open(ring) {
    const client = new FakeCapClient(ring, { deviceId: MAC });
    const factory = capacitorFactory(async () => client, createCapacitorTransport(async () => client));
    const ctl = new AbortController();
    const hits: Advertisement[] = [];
    await factory.scan([jstyle2301], (ad) => {
      if (!jstyle2301.scan.match(ad)) return;
      hits.push(ad);
      ctl.abort();
    }, ctl.signal);
    const transport = await factory.connect({ platformId: hits[0]!.platformId! }, jstyle2301);
    return { transport, stats: client.stats, tap: tapped(transport), client };
  },
};

const capacitorRequest: Variant = {
  name: 'capacitor: requestDevice, then linkTransport',
  noSerial: 'mac',
  full: false,
  async open(ring) {
    const client = new FakeCapClient(ring, { deviceId: MAC });
    const transport = linkTransport(await createCapacitorTransport(async () => client).requestDevice(familiesQuery([jstyle2301])));
    return { transport, stats: client.stats, tap: tapped(transport), client };
  },
};

/** The desktop app: the scan list through the bridge, the page picking the ring. */
const electronOpen = (withActivate: boolean) => async (ring: Ring): Promise<Opened> => {
  const bridge = new FakeDesktopBridge(withActivate);
  const w = fakeWebBluetooth(ring, { desktop: bridge, id: 'opaque-page-id', address: MAC });
  vi.stubGlobal('navigator', { bluetooth: w.bluetooth });
  const factory = chooserFactory(createElectronTransport(() => bridge), 'electron');
  const ctl = new AbortController();
  let first!: (ad: Advertisement) => void;
  const listed = new Promise<Advertisement>((r) => (first = r));
  const scanned = factory.scan([jstyle2301], (ad) => first(ad), ctl.signal);
  const transport = await factory.connect({ platformId: (await listed).platformId! }, jstyle2301);
  await scanned;
  return { transport, stats: w.device.stats, tap: tapped(transport), web: w, bridge };
};

const electronActivate: Variant = { name: 'electron: chooserFactory scan and connect, bridge with activate', noSerial: 'mac', full: true, open: electronOpen(true) };
const electronPlain: Variant = { name: 'electron: chooserFactory scan and connect, bridge without activate', noSerial: 'mac', full: false, open: electronOpen(false) };
const electronRemembered: Variant = {
  name: 'electron: connect a remembered ring by its address',
  noSerial: 'mac',
  full: false,
  async open(ring) {
    const bridge = new FakeDesktopBridge(true);
    const w = fakeWebBluetooth(ring, { desktop: bridge, id: 'opaque-page-id', address: MAC });
    vi.stubGlobal('navigator', { bluetooth: w.bluetooth });
    const transport = await chooserFactory(createElectronTransport(() => bridge), 'electron').connect({ platformId: MAC }, jstyle2301);
    return { transport, stats: w.device.stats, tap: tapped(transport), web: w, bridge };
  },
};

const variants: Variant[] = [webLink, webChooser, capacitorScan, capacitorRequest, electronActivate, electronPlain, electronRemembered];
/** The bare fake as the transport: what every adapter run is compared with. */
const bare = async (ring: Ring): Promise<Opened> => ({ transport: ring.fake, stats: newStats(), tap: tapped(ring.fake) });

// ---------------------------------------------------------------- the sessions to replay

type OpenSession = RingSession & { runtime: SessionRuntime };

interface Scenario {
  name: string;
  session: FixtureSession;
  /** Steps the fixture leaves out: 'hr' history also reads the workout heart-rate archive (0x54), as the family test scripts. */
  extra?: FakeStep[];
  slow?: boolean;
  /** Fills `sink` with what the session yields; throws what it throws. */
  drive(s: OpenSession, sink: RingEvent[]): Promise<void>;
}

const into = async (it: AsyncIterable<RingEvent>, sink: RingEvent[]): Promise<void> => {
  for await (const e of it) sink.push(e);
};
const workoutHrEmpty: FakeStep = { expect: { prefix: '54 00' }, reply: ['54 ff'] };

/** The V0525 session with the link dropping after two heart-rate packets and before the page ends. */
const dropped = ((): FixtureSession => {
  const base = sessionNamed('v0525 handshake');
  const page = base.steps[base.steps.length - 1]!;
  return { ...base, name: 'v0525 link drops mid page', steps: [...base.steps.slice(0, -1), { ...page, notify: page.notify!.slice(0, 2), disconnectAfter: true }] };
})();

const scenarios: Scenario[] = [
  { name: 'v0525 handshake and one HR page', session: sessionNamed('v0525 handshake'), extra: [workoutHrEmpty], drive: (s, sink) => into(s.readHistory('hr', {}, abort()), sink) },
  { name: 'v0789 handshake, auth accepted, one HR page', session: sessionNamed('v0789 handshake, auth accepted'), extra: [workoutHrEmpty], drive: (s, sink) => into(s.readHistory('hr', {}, abort()), sink) },
  { name: 'v0789 auth rejected', session: sessionNamed('v0789 auth rejected'), drive: async () => {} },
  {
    name: 'v0525 page of 50 packets, mode-2 continuation',
    session: sessionNamed('v0525 page of 50 packets'),
    drive: (s, sink) => into(s.runtime.exchange({ op: 'history', params: { opcode: 0x55, stream: 'hr', pageLimit: 2, seq: 1 } }), sink),
  },
  { name: 'v0525 link drops mid page', session: dropped, drive: (s, sink) => into(s.readHistory('hr', {}, abort()), sink) },
  { name: 'v0525 one-page budget, whole sync', session: sessionNamed('v0525 one-page budget'), slow: true, drive: (s, sink) => into(s.sync({}, () => {}, abort()), sink) },
  {
    name: 'v0525 spot heart rate',
    session: sessionNamed('v0525 spot heart rate'),
    slow: true,
    async drive(s, sink) {
      const ac = new AbortController();
      for await (const e of s.spot('hr', ac.signal)) {
        sink.push(e);
        if (sink.filter((x) => x.type === 'sample').length >= 2) ac.abort();
      }
    },
  },
];
const scenario = (name: string): Scenario => scenarios.find((s) => s.name === name)!;
const v0525 = scenario('v0525 handshake and one HR page');
const v0789 = scenario('v0789 handshake, auth accepted, one HR page');
const rejected = scenario('v0789 auth rejected');
const dropMidPage = scenario('v0525 link drops mid page');

interface Outcome {
  /** The `RingError` code, or the error's name. */
  error?: string;
  info?: HandshakeInfo;
  identity?: RingIdentity;
  events: RingEvent[];
  /** The session's own 'disconnected' events. */
  sessionDrops: number;
  seen: WriteSeen[];
  /** Every write, credential removed, as hex: what a log may show. */
  wire: string[];
  /** Every write exactly as the ring got it. Compared with `sameBytes`, never printed. */
  raw: Uint8Array[];
  /** Writes the fixture did not expect (first two bytes only). */
  unexpected: string[];
  ring: Ring;
  opened: Opened;
}

const errorOf = (e: unknown): string => (e instanceof RingError ? e.code : e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Opens the session over `variant`, drives the scenario, then closes: what the ring and the session saw. */
async function replay(variant: Pick<Variant, 'open'>, sc: Scenario, family: RingFamily = jstyle2301): Promise<Outcome> {
  const ring = ringFor(sc.session);
  if (sc.extra) ring.fake.script(...sc.extra);
  const opened = await variant.open(ring);
  const out: Outcome = { events: [], sessionDrops: 0, seen: [], wire: [], raw: [], unexpected: [], ring, opened };
  let session: OpenSession | undefined;
  try {
    session = await openRingSession(family, opened.transport, fast);
    session.on((e) => {
      if (e.type === 'disconnected') out.sessionDrops++;
    });
    await sc.drive(session, out.events);
  } catch (e) {
    out.error = errorOf(e);
  }
  if (session) {
    out.info = session.info();
    out.identity = session.identity;
    await session.close();
  }
  out.seen = ring.seen;
  out.wire = ring.fake.redactedWrites(family.protocol).map(toHex);
  out.raw = ring.fake.writes;
  out.unexpected = ring.fake.errors;
  return out;
}

const references = new Map<string, Promise<Outcome>>();
/** The run over the bare fake, once per scenario and write mode. */
const reference = (sc: Scenario, family: RingFamily = jstyle2301): Promise<Outcome> => {
  const key = `${sc.name}|${family.gatt.writeMode ?? 'default'}`;
  let r = references.get(key);
  if (!r) references.set(key, (r = replay({ open: bare }, sc, family)));
  return r;
};

const sameBytes = (a: readonly Uint8Array[], b: readonly Uint8Array[]): boolean => a.length === b.length && a.every((x, i) => x.length === b[i]!.length && x.every((v, j) => v === b[i]![j]));

function expectSame(got: Outcome, ref: Outcome): void {
  expect(got.error).toBe(ref.error);
  expect(got.info).toEqual(ref.info);
  expect(got.identity).toEqual(ref.identity);
  expect(got.events).toEqual(ref.events);
  expect(got.sessionDrops).toBe(ref.sessionDrops);
  expect(got.seen).toEqual(ref.seen);
  expect(got.wire).toEqual(ref.wire);
  expect(sameBytes(got.raw, ref.raw)).toBe(true);
  expect(got.unexpected).toEqual(ref.unexpected);
}

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------- the bare fake is what the fixtures say

describe('the bare fake (the reference)', () => {
  it('V0525: firmware, battery and serial, one heart-rate page with a cursor, nothing unexpected written', async () => {
    const r = await reference(v0525);
    expect(r.error).toBeUndefined();
    expect(r.info).toMatchObject({ firmware: 'V0525', serial: 'SN007' });
    expect(r.identity).toEqual({ family: 'jstyle2301', model: '2301', ringId: 'serial:SN007', basis: 'serial' });
    expect(r.events.some((e) => e.type === 'sample' && e.stream === 'hr')).toBe(true);
    expect(r.events.some((e) => e.type === 'status' && e.key === 'cursor')).toBe(true);
    expect(r.unexpected).toEqual([]);
  });

  it('V0789: the 0x3C frame goes out whole and every log form of it is redacted', async () => {
    const r = await reference(v0789);
    expect(r.info?.firmware).toBe('V0789');
    const auth = r.raw.findIndex((w) => w[0] === 0x3c);
    expect(auth).toBeGreaterThan(-1);
    expect(r.raw[auth]!.length).toBe(16);
    expect(r.wire[auth]).toBe('3c 00 00 00 00 00 00 00 00 00 00 00 00 00 00 3c');
    expect(r.unexpected).toEqual([]);
  });

  it('a refused passcode is auth_rejected and nothing is written after it', async () => {
    const r = await reference(rejected);
    expect(r.error).toBe('auth_rejected');
    expect(r.raw.map((w) => w[0])).toEqual([0x27, 0x3c]);
    expect(r.ring.fake.connected).toBe(false);
  });

  it('a ring that drops mid page is a disconnected error after the packets that did arrive', async () => {
    const r = await reference(dropMidPage);
    expect(r.error).toBe('disconnected');
    expect(r.events.some((e) => e.type === 'sample')).toBe(true);
    expect(r.sessionDrops).toBe(1);
  });
});

// ---------------------------------------------------------------- the adapters against it

describe.each(variants)('$name', (variant) => {
  it.each(scenarios.filter((s) => variant.full || !s.slow))('replays "$name" like the bare fake does', async (sc) => {
    const got = await replay(variant, sc);
    expectSame(got, await reference(sc));
    // whatever happened, the platform link is closed and the session's teardown asked the platform once (a dropped link needs no call)
    expect(got.ring.fake.connected).toBe(false);
    expect(got.opened.stats.disconnects).toBe(sc === dropMidPage ? 0 : 1);
    expect(got.opened.stats.writesLegacy).toBe(0);
  }, 20_000);

  it('close() unsubscribes, disconnects the platform link once and tells the transport once', async () => {
    const ring = ringFor(v0525.session);
    const op = await variant.open(ring);
    const s = await openRingSession(jstyle2301, op.transport, fast);
    expect(op.stats).toMatchObject({ notifyStarts: 1, notifyStops: 0, disconnects: 0 });
    expect(ring.fake.connected).toBe(true);
    await s.close();
    await s.close();
    expect(op.stats).toMatchObject({ notifyStarts: 1, notifyStops: 1, disconnects: 1 });
    expect(ring.fake.connected).toBe(false);
    expect(disconnects(op.tap)).toEqual([{ type: 'disconnected', reason: 'closed' }]);
  });

  it('a drop mid history is one disconnected RingError, then every command and write says disconnected', async () => {
    const ring = ringFor(dropMidPage.session);
    const op = await variant.open(ring);
    const s = await openRingSession(jstyle2301, op.transport, fast);
    const heard: string[] = [];
    s.on((e) => heard.push(e.type));
    const events: RingEvent[] = [];
    const err = await into(s.readHistory('hr', {}, abort()), events).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RingError);
    expect(err).toMatchObject({ code: 'disconnected' });
    expect(events.some((e) => e.type === 'sample')).toBe(true);
    await expect(s.battery()).rejects.toMatchObject({ code: 'disconnected' });
    // the adapter itself refuses too, rather than writing into a dead link
    await expect(op.transport.write(jstyle2301.gatt.service, jstyle2301.gatt.write, Uint8Array.of(0x13), 'withResponse')).rejects.toThrow(/disconnected/i);
    await s.close();
    expect(heard.filter((t) => t === 'disconnected')).toHaveLength(1);
    expect(disconnects(op.tap)).toHaveLength(1);
  });

  it('writes with response unless the family says without, and the platform sees that mode', async () => {
    const noResponse: RingFamily = { ...jstyle2301, gatt: { ...jstyle2301.gatt, writeMode: 'withoutResponse' } };
    const withResponse = await replay(variant, v0525);
    expect(withResponse.seen.length).toBeGreaterThan(2);
    expect(withResponse.seen.every((w) => w.mode === 'withResponse')).toBe(true);
    expect(withResponse.opened.stats).toMatchObject({ writesWithResponse: withResponse.seen.length, writesWithoutResponse: 0, writesLegacy: 0 });

    const without = await replay(variant, v0525, noResponse);
    expect(without.seen.map((w) => [w.service, w.characteristic])).toEqual(withResponse.seen.map((w) => [w.service, w.characteristic]));
    expect(without.seen.every((w) => w.mode === 'withoutResponse')).toBe(true);
    expect(without.opened.stats).toMatchObject({ writesWithResponse: 0, writesWithoutResponse: without.seen.length, writesLegacy: 0 });
    // the mode changes how a frame is written, not what the ring makes of it
    expect(without.events).toEqual(withResponse.events);
    expectSame(without, await reference(v0525, noResponse));
  });

  it('without a serial the ring is known by its address where the platform has one', async () => {
    const ring = ringFor(v0525.session, false);
    const op = await variant.open(ring);
    const s = await openRingSession(jstyle2301, op.transport, fast);
    expect(s.identity.basis).toBe(variant.noSerial);
    expect(s.identity.ringId).toBe(variant.noSerial === 'mac' ? `mac:${MAC.toLowerCase()}` : 'adv:opaque-web-id');
    await s.close();
  });
});

// ---------------------------------------------------------------- what is specific to one platform

describe('web: what the browser is asked for', () => {
  it('requests the J-Style filters and lets the page open the ring service and Device Information', async () => {
    const w = web(ringFor(v0525.session));
    await webTransport.requestDevice(familiesQuery([jstyle2301]));
    expect(w.requests).toEqual([queryOf(familiesQuery([jstyle2301]))]);
    const { optionalServices } = w.requests[0]!;
    expect(optionalServices).toContain(jstyle2301.gatt.service);
    expect(optionalServices).toContain(jstyle2301.gatt.deviceInfo!.service);
    // the browser offered the ring because the manufacturer filter accepts it: the ring does not advertise FFF0
    expect(w.requests[0]!.filters).toContainEqual({ manufacturerData: [{ companyIdentifier: 0x1234 }] });
  });

  it('a page that left Device Information out of its request cannot read the serial: the identity falls back', async () => {
    // the fake refuses a service the request did not name, as Chrome does; this is what the differential runs depend on
    const ring = ringFor(v0525.session);
    const w = web(ring);
    const link = await webTransport.requestDevice({ filters: [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }], optionalServices: [jstyle2301.gatt.service] });
    const s = await openRingSession(jstyle2301, linkTransport(link), fast);
    expect(s.identity.basis).toBe('advertised');
    expect(w.device.stats.writesLegacy).toBe(0);
    await s.close();
  });
});

describe('capacitor: what the app scans and connects', () => {
  it('re-attaches the company id so the family accepts the advertisement', async () => {
    const client = new FakeCapClient(ringFor(v0525.session), { deviceId: MAC });
    const factory = capacitorFactory(async () => client, createCapacitorTransport(async () => client));
    const ctl = new AbortController();
    const ads: Advertisement[] = [];
    await factory.scan([jstyle2301], (ad) => {
      ads.push(ad);
      if (ads.length === 2) ctl.abort();
    }, ctl.signal);
    expect(client.stoppedScans).toBe(1);
    const [stranger, ring] = ads as [Advertisement, Advertisement];
    // Android hands over the bytes after the company id, keyed by it as a decimal string
    expect(Object.keys(client.scanResults[1]!.manufacturerData!)).toEqual(['4660']);
    expect(Array.from(new Uint8Array(client.scanResults[1]!.manufacturerData!['4660']!.buffer))).toEqual([0x44, 0x23, 0x01]);
    expect(ring.manufacturerData.map(toHex)).toEqual(['34 12 44 23 01']);
    expect(ring.platformId).toBe(MAC);
    expect(ring.name).toBe('J-Style ring');
    expect(jstyle2301.scan.match(ring)).toBe(true);
    // the bare Android payload is not enough: it is the re-attached id that makes the marker readable
    expect(jstyle2301.scan.match({ ...ring, manufacturerData: [Uint8Array.of(0x44, 0x23, 0x01)] })).toBe(false);
    expect(jstyle2301.scan.match(stranger)).toBe(false);
  });

  it('connects a remembered ring without scanning and reports its address, MTU and services', async () => {
    const client = new FakeCapClient(ringFor(v0525.session), { deviceId: MAC, mtu: 185 });
    const factory = capacitorFactory(async () => client, createCapacitorTransport(async () => client));
    const t = await factory.connect({ platformId: MAC }, jstyle2301);
    expect(client.scans).toBe(0);
    expect(client.connects).toEqual([MAC]);
    expect(t.peripheral).toEqual({ id: MAC, address: MAC });
    expect(t.mtu).toBe(185);
    expect(await t.services!()).toEqual([jstyle2301.gatt.service, jstyle2301.gatt.deviceInfo!.service]);
  });
});

describe('electron: the desktop bridge', () => {
  it('with activate: the page gets its click first, then the request, then exactly one answer carrying the ring id', async () => {
    const ring = ringFor(v0525.session);
    const op = await electronOpen(true)(ring);
    expect(op.bridge!.log).toEqual(['activate', 'request', 'choose']);
    expect(op.bridge!.chose).toEqual([MAC]);
    expect(op.transport.peripheral).toEqual({ id: MAC, name: 'J-Style ring', address: MAC });
    await op.transport.disconnect();
  });

  it('without activate (an older main process): the request still works', async () => {
    const op = await electronOpen(false)(ringFor(v0525.session));
    expect(op.bridge!.log).toEqual(['request', 'choose']);
    expect(op.bridge!.chose).toEqual([MAC]);
    await op.transport.disconnect();
  });

  it('a remembered ring is answered from the list without a person choosing: one request, one answer', async () => {
    const op = await electronRemembered.open(ringFor(v0525.session));
    expect(op.bridge!.log).toEqual(['activate', 'request', 'choose']);
    expect(op.bridge!.chose).toEqual([MAC]);
    expect(op.transport.peripheral.address).toBe(MAC);
    await op.transport.disconnect();
  });
});

describe('a reconnect after the ring dropped the link: the whole handshake again (DESKSCAN)', () => {
  /** The V0789 handshake only: firmware, the 0x3C passcode step, battery (and the serial read). */
  const handshake: FixtureSession = { ...v0789.session, steps: v0789.session.steps.slice(0, 3) };
  const again = (ring: Ring): void => ring.fake.script(...handshake.steps.map((x) => stepFromFixture(x)).filter((x): x is FakeStep => x !== undefined));
  /** Opcodes the ring saw from `from` on (first byte only: the 0x3C frame is never shown). */
  const opsFrom = (ring: Ring, from: number): number[] => ring.fake.writes.slice(from).map((w) => w[0]!);

  it('the desktop app: firmware, 0x3C and battery go out again and the new session hears every answer', async () => {
    const ring = ringFor(handshake);
    const bridge = new FakeDesktopBridge(true);
    const w = fakeWebBluetooth(ring, { desktop: bridge, id: 'opaque-page-id', address: MAC });
    vi.stubGlobal('navigator', { bluetooth: w.bluetooth });
    const factory = chooserFactory(createElectronTransport(() => bridge), 'electron');
    const first = await openRingSession(jstyle2301, await factory.connect({ platformId: MAC }, jstyle2301), fast);
    expect(opsFrom(ring, 0)).toEqual([0x27, 0x3c, 0x13]);
    // the link drops mid-session (a BlueZ supervision timeout); the service closes the session, then reconnects
    ring.fake.drop('timeout');
    await first.close();
    again(ring);
    const before = ring.fake.writes.length;
    const second = await openRingSession(jstyle2301, await factory.connect({ platformId: MAC }, jstyle2301), fast);
    expect(opsFrom(ring, before)).toEqual([0x27, 0x3c, 0x13]);
    expect(second.info().firmware).toBe('V0789');
    expect(ring.fake.errors).toEqual([]);
    expect(ring.fake.remaining).toBe(0);
    // reconnected through the device the page already had: no new list, no new request
    expect(bridge.log.filter((x) => x === 'request')).toHaveLength(1);
    await second.close();
  });

  it('the Android app: firmware, 0x3C and battery go out again', async () => {
    const ring = ringFor(handshake);
    const client = new FakeCapClient(ring, { deviceId: MAC });
    const transport = createCapacitorTransport(async () => client);
    const factory = capacitorFactory(async () => client, transport);
    const first = await openRingSession(jstyle2301, await factory.connect({ platformId: MAC }, jstyle2301), fast);
    expect(opsFrom(ring, 0)).toEqual([0x27, 0x3c, 0x13]);
    ring.fake.drop('timeout');
    await first.close();
    again(ring);
    const before = ring.fake.writes.length;
    const second = await openRingSession(jstyle2301, await factory.connect({ platformId: MAC }, jstyle2301), fast);
    expect(opsFrom(ring, before)).toEqual([0x27, 0x3c, 0x13]);
    expect(second.info().firmware).toBe('V0789');
    expect(ring.fake.errors).toEqual([]);
    await second.close();
  });

  describe('the desktop app: every new link runs firmware → 0x3C → battery, then the read finishes', () => {
    const v0789Full = v0789.session;
    const page = v0789Full.steps[v0789Full.steps.length - 1]!;
    /** The V0789 session with the link dropping after two heart-rate packets, before the page ends. */
    const midRead: FixtureSession = { ...v0789Full, steps: [...v0789Full.steps.slice(0, -1), { ...page, notify: page.notify!.slice(0, 2), disconnectAfter: true }] };
    const steps = (s: FixtureSession): FakeStep[] => s.steps.map((x) => stepFromFixture(x)).filter((x): x is FakeStep => x !== undefined);
    const desktop = (ring: Ring) => {
      const bridge = new FakeDesktopBridge(true);
      const w = fakeWebBluetooth(ring, { desktop: bridge, id: 'opaque-page-id', address: MAC });
      vi.stubGlobal('navigator', { bluetooth: w.bluetooth });
      return chooserFactory(createElectronTransport(() => bridge), 'electron');
    };
    /** The second link: the whole handshake again, then the heart-rate read to its end with nothing left over. */
    async function readsAgain(ring: Ring, factory: ReturnType<typeof desktop>): Promise<void> {
      ring.fake.script(...steps(v0789Full), workoutHrEmpty);
      const before = ring.fake.writes.length;
      const s = await openRingSession(jstyle2301, await factory.connect({ platformId: MAC }, jstyle2301), fast);
      const events: RingEvent[] = [];
      await into(s.readHistory('hr', {}, abort()), events);
      expect(opsFrom(ring, before).slice(0, 3)).toEqual([0x27, 0x3c, 0x13]);
      expect(s.info().firmware).toBe('V0789');
      expect(events.some((e) => e.type === 'sample' && e.stream === 'hr')).toBe(true);
      expect(events.some((e) => e.type === 'status' && e.key === 'cursor')).toBe(true);
      expect(events.filter((e) => e.type === 'status' && e.key === 'error')).toEqual([]);
      expect(ring.fake.errors).toEqual([]);
      expect(ring.fake.remaining).toBe(0);
      await s.close();
    }

    it('first read: firmware, 0x3C, battery, then the whole heart-rate read', async () => {
      const ring = ringFor({ ...v0789Full, steps: [] });
      await readsAgain(ring, desktop(ring));
    });

    it('a drop in the middle of the read', async () => {
      const ring = ringFor(midRead);
      const factory = desktop(ring);
      const first = await openRingSession(jstyle2301, await factory.connect({ platformId: MAC }, jstyle2301), fast);
      const err = await into(first.readHistory('hr', {}, abort()), []).then(() => null, (e: unknown) => e);
      expect((err as RingError).code).toBe('disconnected');
      await first.close();
      await readsAgain(ring, factory);
    });

    it('Disconnect, then Connect (the next connect waits for BlueZ to let the link go)', { timeout: 15_000 }, async () => {
      const ring = ringFor(handshake);
      const factory = desktop(ring);
      const first = await openRingSession(jstyle2301, await factory.connect({ platformId: MAC }, jstyle2301), fast);
      await first.close();
      const t0 = Date.now();
      await readsAgain(ring, factory);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(LINK_RELEASE_MS - 100);
    });

    it('a relaunch (a new page that never saw the ring)', async () => {
      const ring = ringFor(handshake);
      const first = await openRingSession(jstyle2301, await desktop(ring).connect({ platformId: MAC }, jstyle2301), fast);
      await first.close();
      await readsAgain(ring, desktop(ring));
    });
  });

  it('a firmware request the session never hears fails the open: no command goes out without the passcode step', async () => {
    const ring = ringFor({ ...handshake, steps: [{ ...handshake.steps[0]!, notify: [] }] });
    const err = await openRingSession(jstyle2301, ring.fake, fast).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RingError);
    expect((err as RingError).code).toBe('timeout');
    expect(opsFrom(ring, 0)).toEqual([0x27]);
  });
});
