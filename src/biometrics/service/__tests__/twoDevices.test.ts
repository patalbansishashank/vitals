// @vitest-environment node
/**
 * Plan 04 item 1, binding test, run through the ring service: two devices read the same J-Style 2301 while offline from
 * each other, then go online in either order. A reads first; B reads three hours later, after the ring re-classified
 * last night, over more of today and over a window that no longer holds A's earliest minutes. Afterwards every replica
 * (A, B and S, the server's person replica, which only pulls) holds one record per night with the revised night
 * winning, one daily record per day, every sample once, one ring source under A5a's key, and each device keeps its own
 * cursor.
 *
 * Each device is its own replica, built as `src/biometrics/store/__tests__/replicas.test.ts` builds them (a memory sync
 * engine linked to one hub, a chunk store linked to one relay), with the app's own routing in front of the engine
 * (`createSyncedBackend` + `isSyncedCollection`, as `src/state/sync/controller.ts` attaches it), so `deviceSettings`
 * stays in the device's local backend. The ring service runs over the app's real ports (`appStorePort`, `appLocalPort`):
 * every read goes `pair` -> `appStorePort().ingest` -> `ingestRingBatch` -> `ingestAndScore` exactly as in the app.
 *
 * `ingestRingBatch` and `appLocalPort().set` write to the app's document and blob stores (`getDocumentStore()`,
 * `getBlobStore()`), not to the store handed to the port. So the test installs a device's stores as the app's while
 * that device's service runs (one device at a time, as on two separate devices), and every port call checks that its
 * own device is the installed one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleepVersion } from '@/biometrics/core/recordIds';
import type { BioRecord, DailyRecord, SleepRecord } from '@/biometrics/core/types';
import type { DocBioStore } from '@/biometrics/store/docStore';
import { openBioStore } from '@/commands/bio/store';
import { setBlobStore } from '@/state/blobStore';
import { setDocumentStore } from '@/state/runtime';
import { isSyncedCollection } from '@/state/sync/controller';
import { createDocumentStore, createMemoryBackend, type DocumentStore } from '@/store';
import type { Encryptor } from '@/store/types';
import { createChunkStore, createMemoryChunkIndex, type ChunkStore } from '@/sync/blobs/chunkStore';
import { createMemoryBlobBackend } from '@/sync/blobs/memory';
import { createMemoryHub, createMemorySyncStore } from '@/sync/memoryStore';
import { createSyncedBackend } from '@/sync/syncedBackend';
import { ringIdentity, ringSourceKey, type RingEvent, type SleepStage } from '../../../../packages/rings/src/types';
import { appLocalPort, appStorePort } from '../app';
import { createRingService } from '../ringService';
import type { RingStatus } from '../types';
import { FakeClock, FakeRing, fakeConnector, RING_KEY, settle, syncPort } from './fakes';

// ---------------------------------------------------------------- what the ring holds at each read

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (iso: string): number => Date.parse(iso);
const iso = (ms: number): string => new Date(ms).toISOString();
const READ_A = at('2026-10-04T06:00:00.000Z');
const READ_B = at('2026-10-04T09:00:00.000Z');
const N1 = '2026-10-02T23:00:00.000Z';
const N2 = '2026-10-03T23:30:00.000Z';

/** A stored minute does not change between reads: the value depends only on the time. */
const hrAt = (t: number): number => 52 + ((t / (10 * MIN)) % 17);
const stepsAt = (start: number): number => 40 + ((start / HOUR) % 24) * 25;

function hr(from: number, to: number): RingEvent[] {
  const out: RingEvent[] = [];
  for (let t = from; t < to; t += 10 * MIN) out.push({ type: 'sample', stream: 'hr', t, value: hrAt(t), unit: 'bpm', origin: 'history' });
  return out;
}

/** Hourly buckets of `day` that have closed by `until`, plus the ring's own day total (0x51) for them. */
function activity(day: string, until: number): RingEvent[] {
  const d0 = at(`${day}T00:00:00.000Z`);
  const out: RingEvent[] = [];
  let total = 0;
  for (let s = d0; s + HOUR <= until && s < d0 + 24 * HOUR; s += HOUR) {
    total += stepsAt(s);
    out.push({ type: 'activityBucket', start: s, durS: 3600, steps: stepsAt(s) });
  }
  out.push({ type: 'dailyTotal', localDay: d0, steps: total });
  return out;
}

const CODE: Record<SleepStage, number> = { unknown: 0, awake: 1, light: 2, deep: 3, rem: 4 };
function night(start: string, runs: Array<[SleepStage, number]>): RingEvent {
  const stages = runs.flatMap(([s, n]) => Array<SleepStage>(n).fill(s));
  return { type: 'sleepEpochs', start: at(start), epochS: 60, stages, rawCodes: stages.map((s) => CODE[s]), firmware: 'V0525', complete: true };
}

const night1 = night(N1, [['awake', 15], ['light', 150], ['deep', 70], ['rem', 75], ['light', 40], ['awake', 10]]);
/** Last night as the ring classified it by 06:00 (A's read)… */
const night2 = night(N2, [['awake', 10], ['light', 120], ['deep', 60], ['rem', 50], ['light', 100], ['awake', 20]]);
/** …and after the ring re-classified it (B's read): same start, other stages. */
const night2Revised = night(N2, [['awake', 10], ['light', 90], ['deep', 90], ['rem', 70], ['light', 80], ['awake', 20]]);

const cursor = (readAt: number): RingEvent => ({ type: 'status', key: 'cursor', value: `j1|${iso(readAt)}`, stream: 'hr' });

/** A at 06:00: heart rate since 20:00 yesterday. */
const historyA: RingEvent[] = [night1, night2, ...hr(at('2026-10-03T20:00:00.000Z'), READ_A), ...activity('2026-10-03', READ_A), ...activity('2026-10-04', READ_A), cursor(READ_A)];
/** B at 09:00: the ring's heart-rate buffer now starts at 22:00 (A's first two hours are only on A), three more hours today. */
const historyB: RingEvent[] = [night1, night2Revised, ...hr(at('2026-10-03T22:00:00.000Z'), READ_B), ...activity('2026-10-03', READ_B), ...activity('2026-10-04', READ_B), cursor(READ_B)];

// ---------------------------------------------------------------- devices

const secret = new Uint8Array(32).fill(7);
const plain: Encryptor = { seal: async (p) => p, open: async (s) => s };
type Hub = ReturnType<typeof createMemoryHub>;
type Relay = ReturnType<typeof createMemoryBlobBackend>;

interface Device {
  name: string;
  label: string;
  deviceId: string;
  docs: DocumentStore;
  blobs: ChunkStore;
  /** One document round (out and in), as in replicas.test.ts. */
  syncDocs(): Promise<void>;
  /** Uploads chunk bytes to the relay, then one document round. */
  online(): Promise<void>;
  bio(): Promise<DocBioStore>;
}

async function device(name: string, label: string, hub: Hub, relay: Relay): Promise<Device> {
  const deviceId = `DEV${name}`.padEnd(16, '0');
  const engine = createMemorySyncStore();
  await engine.open({ secret, relayUrl: 'memory://relay', deviceId: deviceId as never, memoryOnly: true });
  engine.link(hub);
  // the app's routing: synced collections in the engine, the rest (deviceSettings) only in the local backend
  const backend = createSyncedBackend({ synced: engine, local: createMemoryBackend({ device: deviceId }), isSynced: isSyncedCollection });
  const docs = createDocumentStore({ backend, device: deviceId as never });
  await docs.ready;
  const blobs = createChunkStore({ bytes: createMemoryBlobBackend(), index: createMemoryChunkIndex() });
  await blobs.attachRemote({ seal: plain, backend: relay });
  const d: Device = {
    name,
    label,
    deviceId,
    docs,
    blobs,
    async syncDocs() {
      await engine.push();
      await engine.pull();
      await backend.settled();
      await new Promise((r) => setTimeout(r, 5));
    },
    async online() {
      await blobs.flush();
      await d.syncDocs();
    },
    bio: () => openBioStore({ store: docs, blobs }),
  };
  return d;
}

/** The device whose stores are the app's right now. */
let installed: Device | null = null;
function install(d: Device | null, nowMs?: number): void {
  installed = d;
  setDocumentStore(d?.docs ?? null);
  setBlobStore(d?.blobs ?? null);
  if (nowMs !== undefined) vi.setSystemTime(nowMs);
}

/** A port of `d` that refuses to run while another device's stores are the app's. */
function own<T extends object>(d: Device, port: T): T {
  return new Proxy(port, {
    get(target, key, receiver) {
      const v: unknown = Reflect.get(target, key, receiver);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        if (installed !== d) throw new Error(`device ${d.name}'s ring service ran while ${installed?.name ?? 'no device'} was the app`);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function service(d: Device, ring: FakeRing, clock: FakeClock, availability: 'ready' | 'bluetooth_off' = 'ready') {
  return createRingService({
    connector: fakeConnector({ rings: [ring], clock, availability }),
    store: own(d, appStorePort(d.docs)),
    local: own(d, appLocalPort(d.docs)),
    sync: syncPort(d.deviceId, d.label),
    clock,
    platform: 'android',
    producer: { name: 'vitals-ring', version: '1' },
  });
}

/** The person adds the ring on `d` (offline: `d` has never heard of it) and the service reads it. */
async function readRing(d: Device, ring: FakeRing, readAt: number): Promise<RingStatus> {
  const clock = new FakeClock(iso(readAt));
  install(d, readAt);
  try {
    const svc = service(d, ring, clock);
    await svc.start();
    expect(svc.rings(), `${d.name} has never seen the ring`).toEqual([]);
    const found: string[] = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c.candidateId);
    expect(found).toHaveLength(1);
    const status = await svc.pair(found[0]!);
    await svc.stop();
    await settle();
    return status;
  } finally {
    install(null);
  }
}

/** What the ring service on `d` lists after sync (Bluetooth off, so it reads nothing). */
async function ringsSeenBy(d: Device, ring: FakeRing): Promise<RingStatus[]> {
  install(d);
  try {
    const svc = service(d, ring, new FakeClock(iso(READ_B + HOUR)), 'bluetooth_off');
    await svc.start();
    const rings = svc.rings();
    await svc.stop();
    await settle();
    return rings;
  } finally {
    install(null);
  }
}

// ---------------------------------------------------------------- expectations

/** A5a's key for this ring: the ring's own address, the same on every device. */
const KEY = ringSourceKey(ringIdentity({ family: 'jstyle2301', model: '2301', address: 'AA:BB:CC:DD:EE:01' }));
const DAYS = { from: '2026-10-02', to: '2026-10-04' } as const;
const times = (from: number, to: number, step: number): number[] => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);
/** Every heart-rate minute either device read: A's 20:00–22:00 (B never saw them) through B's 06:00–09:00 (A never saw them). */
const HR_TIMES = times(at('2026-10-03T20:00:00.000Z'), READ_B, 10 * MIN);
const STEP_TIMES = times(at('2026-10-03T00:00:00.000Z'), READ_B, HOUR);
const daySteps = (day: string, until: number): number => STEP_TIMES.filter((s) => iso(s).startsWith(day) && s + HOUR <= until).reduce((n, s) => n + stepsAt(s), 0);

async function contents(d: Device) {
  const bio = await d.bio();
  const records = await bio.records({ from: DAYS.from, to: DAYS.to });
  const hrSamples = await bio.samples({ stream: 'hr', from: DAYS.from, to: DAYS.to });
  const stepSamples = await bio.samples({ stream: 'steps', from: DAYS.from, to: DAYS.to });
  const sources = (await bio.sources()).map((s) => s.sourceKey);
  return { records, hrSamples, stepSamples, sources };
}

const ofKind = <K extends BioRecord['kind']>(rs: Array<{ record: BioRecord }>, kind: K) => rs.map((r) => r.record).filter((r): r is Extract<BioRecord, { kind: K }> => r.kind === kind);

type Order = 'A online first' | 'B online first';
const ORDERS: readonly Order[] = ['A online first', 'B online first'];

/** Both offline: A reads at 06:00, the ring re-classifies last night, B reads at 09:00; then both go online in `order`. */
async function scenario(order: Order) {
  const hub = createMemoryHub();
  const relay = createMemoryBlobBackend();
  const a = await device('A', 'Desktop A', hub, relay);
  const b = await device('B', 'Phone B', hub, relay);
  const s = await device('S', 'Server', hub, relay);
  const ring = new FakeRing({ history: historyA });

  const sa = await readRing(a, ring, READ_A);
  ring.history = historyB;
  const sb = await readRing(b, ring, READ_B);
  for (const [st, readAt] of [[sa, READ_A], [sb, READ_B]] as const) expect(st).toMatchObject({ ringKey: KEY, label: 'J-Style 2301', lastSyncAt: iso(readAt) });
  // offline, each device holds only its own read
  const offline = async (d: Device) => ofKind(await (await d.bio()).records({ kind: 'sleep' }), 'sleep').find((r) => r.time.start === N2)?.deep_s;
  expect(await offline(a)).toBe(60 * 60);
  expect(await offline(b)).toBe(90 * 60);
  expect(hub.size).toBe(0);

  // A->B then B->A, or B->A then A->B; S, the server's replica, pulls last
  const [first, second] = order === 'A online first' ? [a, b] : [b, a];
  await first.online();
  await second.online();
  await first.syncDocs();
  await s.syncDocs();
  return { hub, a, b, s, ring };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  install(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('two devices read the same ring offline, through the ring service (plan 04 item 1)', () => {
  for (const order of ORDERS) {
    it(`one record per night with the revised night winning, every sample once, one ring source, device-local cursors (${order})`, { timeout: 60_000 }, async () => {
      expect(KEY).toBe(RING_KEY);
      const { hub, a, b, s, ring } = await scenario(order);

      const seen = { A: await contents(a), B: await contents(b), S: await contents(s) };
      for (const [name, c] of Object.entries(seen)) {
        // one ring source, A5a's key; every record and sample is filed under it
        expect(c.sources.filter((k) => k.startsWith('ble:')), name).toEqual([KEY]);
        expect(new Set(c.records.map((r) => r.sourceKey)), name).toEqual(new Set([KEY]));
        expect(new Set([...c.hrSamples, ...c.stepSamples].map((x) => x.sourceKey)), name).toEqual(new Set([KEY]));

        // exactly one sleep record per night; the re-classified night is the one B read
        const nights = ofKind(c.records, 'sleep') as SleepRecord[];
        expect(nights.map((r) => r.time.start).sort(), name).toEqual([N1, N2]);
        const n2 = nights.find((r) => r.time.start === N2)!;
        expect(n2.version, name).toBe(sleepVersion(true, READ_B / 1000));
        expect(n2.provenance.ingested_at, name).toBe(iso(READ_B));
        expect({ deep: n2.deep_s, rem: n2.rem_s, light: n2.light_s }, name).toEqual({ deep: 90 * 60, rem: 70 * 60, light: 170 * 60 });
        const n1 = nights.find((r) => r.time.start === N1)!;
        expect({ deep: n1.deep_s, rem: n1.rem_s }, name).toEqual({ deep: 70 * 60, rem: 75 * 60 });
        // one main night per day
        for (const r of nights) expect(r.is_main, `${name} ${r.time.start}`).toBe(true);
        expect(new Set(nights.map((r) => r.time.local_date)).size, name).toBe(nights.length);

        // one daily record per day; today's is B's (it read three more hours)
        const days = ofKind(c.records, 'daily') as DailyRecord[];
        expect(days.map((r) => [r.time.local_date, r.steps]), name).toEqual([
          ['2026-10-03', daySteps('2026-10-03', READ_B)],
          ['2026-10-04', daySteps('2026-10-04', READ_B)],
        ]);

        // every sample once, none lost (A's early minutes and B's late ones), the ring's value at each time
        expect(c.hrSamples.map((x) => x.t).sort((p, q) => p - q), name).toEqual(HR_TIMES);
        for (const x of c.hrSamples) expect(x.value, `${name} hr ${iso(x.t)}`).toBe(hrAt(x.t));
        expect(c.stepSamples.map((x) => x.t).sort((p, q) => p - q), name).toEqual(STEP_TIMES);
        for (const x of c.stepSamples) expect(x.value, `${name} steps ${iso(x.t)}`).toBe(stepsAt(x.t));
      }
      // every replica reads the same
      const view = (c: (typeof seen)['A']) => ({ records: c.records, hr: c.hrSamples.map((x) => [x.t, x.value]), steps: c.stepSamples.map((x) => [x.t, x.value]) });
      expect(view(seen.B)).toEqual(view(seen.A));
      expect(view(seen.S)).toEqual(view(seen.A));

      // both devices' services list the one ring; A sees B's later read
      const ra = await ringsSeenBy(a, ring);
      const rb = await ringsSeenBy(b, ring);
      expect(ra.map((r) => r.ringKey)).toEqual([KEY]);
      expect(rb.map((r) => r.ringKey)).toEqual([KEY]);
      expect(ra[0]).toMatchObject({ label: 'J-Style 2301', lastSyncAt: iso(READ_B), lastSyncBy: 'Phone B' });
      expect(rb[0]).toMatchObject({ label: 'J-Style 2301', lastSyncAt: iso(READ_B) });
      expect(rb[0]!.lastSyncBy).toBeUndefined();

      // each device keeps its own cursor and reconnect id (deviceSettings `ringCursor:<ringKey>`); none reached the relay
      expect((await appLocalPort(a.docs).get(KEY))?.cursor).toEqual({ hr: `j1|${iso(READ_A)}` });
      expect((await appLocalPort(b.docs).get(KEY))?.cursor).toEqual({ hr: `j1|${iso(READ_B)}` });
      for (const d of [a, b]) expect((await appLocalPort(d.docs).get(KEY))?.platformId, d.name).toBe('aa:bb:cc:dd:ee:01');
      expect(await appLocalPort(s.docs).get(KEY)).toBeUndefined();
      expect([...hub.values()].filter((doc) => doc._col === 'deviceSettings')).toEqual([]);
      // no write failed quietly on the way (the cursor write only warns when the store refuses it)
      expect(warn).not.toHaveBeenCalled();
    });
  }
});
